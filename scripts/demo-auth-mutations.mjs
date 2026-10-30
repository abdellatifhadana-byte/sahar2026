/**
 * @file scripts/demo-auth-mutations.mjs — la batterie de mutations de DEMO-AUTH-01.
 *
 * POURQUOI CELLE-CI EXISTE
 * ------------------------
 * Ce lot a fourni sa propre leçon : une épreuve verte peut consacrer la MAUVAISE règle.
 * `SIX·11` affirmait que « les quatre statuts restent proposés » et se contentait de
 * vérifier que « fermé » portait `disabled` — elle était verte, la suite entière était
 * verte, et le contrat #94 était pourtant violé. Le nombre de tests au vert ne prouve rien
 * si l'un d'eux fige une acceptance affaiblie.
 *
 * Chaque mutation ci-dessous restaure exactement l'un des comportements que le Gate a
 * refusés. Si une seule survit, c'est qu'aucune épreuve ne garde ce point.
 *
 * Usage :  node scripts/demo-auth-mutations.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chemin = relatif => path.join(racine, relatif);
const CIBLES = [
  'tests/demo-auth-contract.test.js',
  'tests/demo-auth-six-roles.test.js',
  'tests/log-write-resilience.test.js'
];

const MUTATIONS = [
  /* ─────────── Blocker 1 · le statut interdit ne doit pas se montrer ─────────── */
  {
    nom: 'M1 · « fermé » redevient visible mais désactivé pour tous',
    pourquoi: 'C’est exactement l’état que le Gate a refusé : un `disabled` reste dans le document, s’enlève depuis la console, et MONTRE une issue que le serveur refusera.',
    fichier: 'tickets.js',
    de: `  const proposables = canCloseTicketPermanently(user)
    ? [...STATUTS_DE_TRAITEMENT, 'fermé']
    : [...STATUTS_DE_TRAITEMENT];`,
    vers: `  const proposables = [...STATUTS_DE_TRAITEMENT, 'fermé'];`
  },
  {
    nom: 'M2 · la clôture s’ouvre à tous les rôles',
    pourquoi: 'Le Manager retrouverait une option que le serveur refuse par `ADMIN_CLOSE_REQUIRED` : un refus légitime déguisé en panne.',
    fichier: 'tickets.js',
    de: '  return isPlatformAdmin(user?.role);',
    vers: '  return true;'
  },
  {
    nom: 'M3 · le statut courant cesse d’être rendu',
    pourquoi: 'Une demande déjà fermée s’afficherait « en cours » aux yeux d’un Manager — un mensonge pire que l’option de trop.',
    fichier: 'tickets.js',
    de: `  const rendus = proposables.includes(statutCourant) || !statutCourant
    ? proposables
    : [...proposables, statutCourant];`,
    vers: '  const rendus = proposables;'
  },

  /* ─────────── Blocker 2 · le contrat serveur du journal ─────────── */
  {
    nom: 'M4 · le journal redevient gouverné par le contrat des tickets',
    pourquoi: 'La cause mesurée de l’aveuglement : Chef et Responsable ne voyaient AUCUNE entrée, parce que la lecture dépendait d’une zone qu’un journal n’a pas.',
    fichier: 'scripts/access-control.js',
    de: "    if (storeName === 'logs') return journalAutorise(user, action);",
    vers: "    if (storeName === 'logs' && action !== 'read') return true;"
  },
  {
    nom: 'M5 · l’administrateur peut réécrire une entrée du journal',
    pourquoi: 'Un journal qu’un rôle peut réécrire ne prouve plus rien — et c’est la trace des rôles globaux qui compte le plus.',
    fichier: 'scripts/access-control.js',
    de: `    if (action === 'delete') return PermissionManager.check(user, 'logs', 'clear');
    return false;`,
    vers: `    if (action === 'delete') return PermissionManager.check(user, 'logs', 'clear');
    return PermissionManager.check(user, 'logs', 'clear');`
  },
  {
    nom: 'M6 · effacer le journal cesse d’exiger `logs.clear`',
    pourquoi: 'Le Manager pouvait supprimer une entrée par appel direct malgré l’absence de bouton : cacher n’est pas protéger.',
    fichier: 'scripts/access-control.js',
    de: "    if (action === 'delete') return PermissionManager.check(user, 'logs', 'clear');",
    vers: "    if (action === 'delete') return true;"
  },
  {
    nom: 'M7 · la lecture du journal s’ouvre à tout le monde',
    pourquoi: 'Technicien et Visiteur verraient la trace de tous les autres, alors que la matrice le leur refuse.',
    fichier: 'scripts/access-control.js',
    de: "    if (action === 'read') return PermissionManager.check(user, 'logs', 'view');",
    vers: "    if (action === 'read') return true;"
  },
  {
    nom: 'M8 · le contrat du journal repasse APRÈS le court-circuit des rôles globaux',
    pourquoi: 'Admin et Manager retrouveraient tous les droits sur le journal, y compris celui de le réécrire : la place de cette ligne EST la garde.',
    fichier: 'scripts/access-control.js',
    de: `    if (storeName === 'logs') return journalAutorise(user, action);
    if (seesEveryZone(user)) return true;`,
    vers: `    if (seesEveryZone(user)) return true;
    if (storeName === 'logs') return journalAutorise(user, action);`
  },
  {
    nom: 'M9 · le serveur cesse de refuser la modification d’une entrée existante',
    pourquoi: 'La dernière barrière : sans elle, un rôle qui passerait la garde d’autorisation réécrirait la trace.',
    fichier: 'scripts/serve.js',
    de: `      if (storeName === 'logs' && existing) {
        json(res, 403, {
          error: 'LOG_IMMUTABLE',
          message: "Le journal ne se modifie pas : une trace déjà enregistrée est définitive."
        }); return true;
      }`,
    vers: '      void existing;'
  },
  {
    nom: 'M10 · le client peut de nouveau antidater son entrée',
    pourquoi: 'Sans horodatage posé par le serveur, une trace peut être placée avant l’action qu’elle est censée prouver.',
    fichier: 'scripts/serve.js',
    de: '            timestamp: maintenant.getTime(),',
    vers: ''
  },
  {
    nom: 'M11 · l’ajout d’une trace redevient soumis aux zones',
    pourquoi: 'C’est le piège H-15 : `addLog()` suit presque chaque action métier, et son refus faisait sauter la notification de succès et le rafraîchissement — l’opération réussissait, l’écran restait muet.',
    fichier: 'scripts/access-control.js',
    de: "    if (action === 'create') return true;",
    vers: "    if (action === 'create') return PermissionManager.check(user, 'logs', 'clear');"
  },

  /* ─────────── Intégration finale · les cinq points que le Gate a refusés ─────────── */
  {
    nom: 'M12 · le Visiteur redevient refusé sur la CRÉATION d’une trace',
    pourquoi: 'C’est l’état mesuré sur `6c3e766` : `canWriteStoreByRole` répondait `403 FORBIDDEN` AVANT le contrat Journal, si bien qu’aucune action de Visiteur n’était jamais journalisée. Un journal qui omet un rôle ne prouve rien sur ce rôle.',
    fichier: 'roles.js',
    de: "  if (storeName === 'logs') return true;",
    vers: ''
  },
  {
    nom: 'M13 · l’horodatage redevient une chaîne ISO',
    pourquoi: '`logs.js` trie par `b.timestamp - a.timestamp`. Deux chaînes ISO se soustraient en `NaN` : le tri cesse de trier et le journal s’affiche dans un ordre arbitraire — mesuré, B créé après A apparaissait avant lui.',
    fichier: 'scripts/serve.js',
    de: '            timestamp: maintenant.getTime(),',
    vers: '            timestamp: maintenant.toISOString(),'
  },
  {
    nom: 'M14 · `fullName` retombe sur la valeur envoyée par le client',
    pourquoi: 'Le repli `|| record.fullName` laissait un compte au nom vide se déclarer « Direction Générale » : le champ le plus lu du journal redevenait le seul que son auteur pouvait choisir.',
    fichier: 'scripts/serve.js',
    de: "            fullName: user.fullName || '',",
    vers: "            fullName: user.fullName || record.fullName || '',"
  },
  {
    nom: 'M15 · la date affichée redevient celle du client',
    pourquoi: 'Sans réécriture, `dateStr` survivait tel quel : une entrée datée « 01/01/2000 » à l’écran, horodatée aujourd’hui en base. L’affichage et la preuve se contredisaient.',
    fichier: 'scripts/serve.js',
    de: "            dateStr: maintenant.toLocaleString('fr-FR'),",
    vers: ''
  },
  {
    nom: 'M16 · un rôle inconnu obtient le droit d’écrire dans le journal',
    pourquoi: 'L’ouverture au journal doit rester SOUS le refus des rôles inconnus. Sinon une valeur héritée illisible — le cas réel qui a motivé `resolveKnownRole` — obtiendrait une écriture que personne ne lui a accordée.',
    fichier: 'roles.js',
    de: '  if (!canonique) return false;',
    vers: "  if (!canonique) return storeName === 'logs';"
  }
];

const lire = fichier => fs.readFileSync(chemin(fichier), 'utf8');
const ecrire = (fichier, contenu) => fs.writeFileSync(chemin(fichier), contenu);

function lancerTests() {
  try {
    execFileSync('node', ['--test', ...CIBLES], { cwd: racine, stdio: 'pipe', timeout: 180000 });
    return { vert: true, sortie: '' };
  } catch (erreur) {
    return { vert: false, sortie: String(erreur.stdout || '') };
  }
}

const tuePar = sortie => (sortie.match(/^not ok \d+ - (.+)$/gm) || [])
  .map(ligne => ligne.replace(/^not ok \d+ - /, ''));

console.log('\n╔═══ mutations DEMO-AUTH-01 ═══╗\n');

const reference = lancerTests();
if (!reference.vert) {
  console.log('❌ la suite n’est pas verte AVANT mutation : rien de ce qui suit n’aurait de sens.');
  console.log(tuePar(reference.sortie).join('\n'));
  process.exit(1);
}
console.log('✅ référence verte avant toute mutation\n');

const survivantes = [];
for (const mutation of MUTATIONS) {
  const original = lire(mutation.fichier);
  const occurrences = original.split(mutation.de).length - 1;
  if (occurrences !== 1) {
    console.log(`⚠️  ${mutation.nom} — motif trouvé ${occurrences} fois dans ${mutation.fichier}`);
    survivantes.push({ ...mutation, raison: 'motif ambigu ou absent' });
    continue;
  }
  ecrire(mutation.fichier, original.replace(mutation.de, mutation.vers));
  let resultat;
  try { resultat = lancerTests(); }
  finally { ecrire(mutation.fichier, original); }

  if (resultat.vert) {
    console.log(`❌ SURVIVANTE — ${mutation.nom}`);
    console.log(`   ${mutation.pourquoi}`);
    survivantes.push({ ...mutation, raison: 'aucun test ne la tue' });
  } else {
    const morts = tuePar(resultat.sortie);
    console.log(`✅ tuée — ${mutation.nom}`);
    console.log(`   par ${morts.length} test(s), dont : ${morts.slice(0, 2).join(' · ') || '(échec au chargement)'}`);
  }
}

console.log(`\n╚═══ ${survivantes.length === 0 ? '✅ AUCUNE SURVIVANTE' : `❌ ${survivantes.length} SURVIVANTE(S)`} ═══╝\n`);
process.exit(survivantes.length === 0 ? 0 : 1);
