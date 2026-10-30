/**
 * @file scripts/concurrence-mutations.mjs — la batterie de mutations du contrat de version.
 *
 * POURQUOI
 * --------
 * Un test qui passe ne prouve rien tant qu'on n'a pas montré qu'il ÉCHOUE quand la garde
 * qu'il surveille disparaît. Chaque mutation ci-dessous retire ou renverse une pièce du
 * contrat de version ; chacune doit être TUÉE par au moins un test.
 *
 * Une mutation SURVIVANTE n'est pas un détail : soit la garde ne sert à rien, soit aucun
 * test ne la couvre. Les deux se corrigent, jamais ne se contournent.
 *
 * Usage :  node scripts/concurrence-mutations.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chemin = relatif => path.join(racine, relatif);

const CIBLES = [
  'tests/concurrence-revision.test.js',
  'tests/concurrence-client-conflit.test.js',
  'tests/creation-salle-zone.test.js',
  'tests/salle-zone-canonique.test.js',
  'tests/transfert-salles-zone.test.js',
  'tests/roles-autorisation-serveur.test.js',
  'tests/conflit-visible.test.js',
  'tests/log-write-resilience.test.js'
];

// Certaines gardes vivent dans la couche HTTP : aucun test unitaire ne les atteint, et
// prétendre le contraire donnerait une batterie qui se rassure elle-même. Pour celles-là on
// relance un VRAI serveur sur une VRAIE base et on rejoue la reproduction de bout en bout.
const PORT_E2E = Number(process.env.MUTATION_PORT || 4196);
const BASE_E2E = process.env.MUTATION_DATABASE_URL
  || 'postgres://tech:tech@127.0.0.1:5432/batch_b_mutations';
const ADMIN = { user: 'conc-admin', pass: 'Qw4-Zephyr-Tulipe-Nx8!' };

/**
 * Chaque mutation dit ce qu'elle casse et où. `de` doit apparaître EXACTEMENT une fois :
 * une substitution ambiguë muterait autre chose que ce qu'on croit mesurer.
 *
 * `niveau` dit quelle batterie doit la tuer : `unite` pour une garde interne, `serveur`
 * pour une garde qui n'existe qu'au niveau HTTP.
 */
const MUTATIONS = [
  {
    nom: 'M1 · la révision déclarée est ignorée',
    pourquoi: 'Sans `expectedRevision`, toute écriture se croit à jour : c’est le défaut d’origine.',
    fichier: 'scripts/revision-store.js',
    // Le motif porte la ligne qui précède : la même déclaration existe aussi dans
    // `tombstoneWithRevision`, et muter les deux à la fois ne dirait pas laquelle est gardée.
    de: `    const courante = ligne ? revisionOf(ligne.data) : 0;
    const declaree = Number(expectedRevision) || 0;`,
    vers: `    const courante = ligne ? revisionOf(ligne.data) : 0;
    const declaree = courante;`
  },
  {
    nom: 'M2 · la comparaison est renversée',
    pourquoi: 'Refuser les écritures à jour et accepter les périmées : le contraire de la règle.',
    fichier: 'scripts/revision-store.js',
    de: '} else if (declaree !== courante) {',
    vers: '} else if (declaree === courante) {'
  },
  {
    nom: 'M3 · une révision périmée est acceptée',
    pourquoi: 'La comparaison reste écrite mais ne refuse plus rien : garde décorative.',
    fichier: 'scripts/revision-store.js',
    de: '        return refus(creationConcurrente ? REVISION_ERRORS.ALREADY_EXISTS : REVISION_ERRORS.STALE_WRITE, courante);',
    vers: '        void creationConcurrente;'
  },
  {
    nom: 'M4 · la révision rendue est toujours la plus récente',
    pourquoi: 'Estampiller depuis la charge utile suffirait à n’être jamais refusé : il suffirait d’envoyer un grand nombre.',
    fichier: 'scripts/revision-store.js',
    de: '    await propre.query(ECRITURE, [storeName, String(recordId), JSON.stringify(withRevision(record, suivante))]);',
    vers: '    await propre.query(ECRITURE, [storeName, String(recordId), JSON.stringify(record)]);'
  },
  {
    nom: 'M5 · le 409 disparaît du serveur',
    pourquoi: 'Le refus existe mais n’est plus annoncé : le client croit avoir enregistré.',
    niveau: 'serveur',
    fichier: 'scripts/serve.js',
    de: `      if (!ecriture.ok) {
        json(res, 409, staleWriteResponse(ecriture.code, ecriture.currentRevision, { store: storeName, id: recordId }));
        return true;
      }`,
    vers: '      if (!ecriture.ok) { json(res, 200, { ok: true, id: record.id }); return true; }'
  },
  {
    nom: 'M6 · le retour arrière local est désactivé',
    pourquoi: 'Sans lui l’écran garde une modification que le serveur a refusée : un mensonge affiché.',
    fichier: 'central-sync.js',
    de: `          if (previous) await originalSave(storeName, previous);
          else await originalDeleteRaw(storeName, id);
          await recordRejectedOperation('save', storeName, id, saved, error);`,
    vers: `          await recordRejectedOperation('save', storeName, id, saved, error);`
  },
  {
    nom: 'M7 · un conflit n’est plus nommé comme tel',
    pourquoi: 'Rangé parmi les échecs ordinaires, il ne dit plus à l’utilisateur quoi faire.',
    fichier: 'central-sync.js',
    de: '  const conflit = isConflictCode(error.code);',
    vers: '  const conflit = false;'
  },
  {
    nom: 'M8 · la pierre tombale oublie la révision',
    pourquoi: 'Supprimer puis recréer remettrait le compteur à zéro : une session ouverte pourrait écraser la nouvelle fiche.',
    fichier: 'scripts/revision-store.js',
    de: `      JSON.stringify(storeUsesRevision(storeName) ? withRevision({}, suivante) : {})]);`,
    vers: '      JSON.stringify({})]);'
  },
  {
    nom: 'M9 · le verrou de ligne devient une lecture ordinaire',
    pourquoi: 'Sans `FOR UPDATE`, deux sessions lisent la même révision et écrivent l’une après l’autre : la comparaison redevient décorative.',
    fichier: 'scripts/revision-store.js',
    de: '  WHERE store_name=$1 AND record_id=$2 FOR UPDATE`;',
    vers: '  WHERE store_name=$1 AND record_id=$2`;'
  },
  {
    nom: 'M10 · une écriture SERVEUR cesse de faire avancer la révision',
    pourquoi: 'Un import ou une migration laisserait les sessions ouvertes AVANT lui écraser ce qu’il vient d’écrire.',
    fichier: 'scripts/revision-store.js',
    de: `    const suivante = courante + 1;
    // La révision est posée ICI.`,
    vers: `    const suivante = force ? courante : courante + 1;
    // La révision est posée ICI.`
  },
  {
    nom: 'M11 · la suppression ne compare plus rien',
    pourquoi: 'Supprimer une fiche qu’un autre vient de modifier effacerait son travail aussi sûrement qu’une écriture périmée.',
    fichier: 'scripts/revision-store.js',
    de: '    if (expectedRevision !== null && storeUsesRevision(storeName)) {',
    vers: '    if (false) {'
  },
  {
    nom: 'M12 · la révision déclarée n’est plus lue dans la charge utile',
    pourquoi: 'Une fiche supprimée par un autre serait ressuscitée en silence par l’enregistrement de celui qui l’avait ouverte.',
    niveau: 'serveur',
    fichier: 'scripts/serve.js',
    de: '      const revisionAttendue = expectedRevisionFrom(body, record);',
    vers: '      const revisionAttendue = existing ? expectedRevisionFrom(body, record) : 0;'
  },
  {
    nom: 'M13 · la suppression HTTP cesse de lire `expectedRevision`',
    pourquoi: 'Supprimer depuis une fiche ouverte périmée redeviendrait silencieux.',
    niveau: 'serveur',
    fichier: 'scripts/serve.js',
    de: '        ? revisionSupprimee : null;',
    vers: '        ? null : null;'
  },
  {
    nom: 'M15 · `conflict` redevient rejouable',
    pourquoi: 'La file repart toutes les vingt secondes : une entrée en conflit repartirait sans fin vers un refus certain.',
    fichier: 'revision-contract.js',
    de: "  return String(status ?? QUEUE_STATUSES.PENDING) === QUEUE_STATUSES.PENDING;",
    vers: "  return !['done', 'failed'].includes(String(status ?? QUEUE_STATUSES.PENDING));"
  },
  {
    nom: 'M16 · la suppression repart sans déclarer de révision',
    pourquoi: 'Le serveur la prend alors pour inconditionnelle et efface ce qu’un autre vient d’écrire.',
    fichier: 'central-sync.js',
    de: '  const declaration = observee ? `?expectedRevision=${encodeURIComponent(Number(expectedRevision))}` : \'\';',
    vers: "  const declaration = '';"
  },
  {
    nom: 'M17 · la suppression hors ligne oublie la révision du clic',
    pourquoi: 'À la reconnexion elle repart à l’aveugle, alors même que l’écran l’avait bien lue.',
    fichier: 'central-sync.js',
    de: '  const revisionVue = previous ? revisionOf(previous) : null;',
    vers: '  const revisionVue = null;'
  },
  {
    nom: 'M18 · la file rejoue la révision du moment, pas celle du clic',
    pourquoi: 'Prétendre avoir vu un état arrivé APRÈS le geste : la suppression passerait alors qu’elle doit être refusée.',
    fichier: 'central-sync.js',
    de: "      if (item.action === 'delete') await pushDelete(item.storeName, item.entityId, item.expectedRevision ?? null);",
    vers: "      if (item.action === 'delete') await pushDelete(item.storeName, item.entityId, revisionOf(await db._getRaw(item.storeName, item.entityId)));"
  },
  {
    nom: 'M19 · le verrou de clé logique disparaît',
    pourquoi: '`FOR UPDATE` ne verrouille pas une ligne absente : deux créations simultanées se croiraient toutes deux premières.',
    niveau: 'serveur',
    fichier: 'scripts/revision-store.js',
    de: '    await propre.query(VERROU_CLE_LOGIQUE, [String(storeName), String(recordId)]);',
    vers: '    void VERROU_CLE_LOGIQUE;'
  },
  {
    nom: 'M20 · une pierre tombale en masse cesse de faire avancer le compteur',
    pourquoi: 'Les fiches retirées garderaient leur ancien compteur : une session ouverte dessus les ressusciterait.',
    fichier: 'scripts/revision-store.js',
    de: '  const requete = storeUsesRevision(storeName) ? PIERRES_TOMBALES_EN_MASSE : PIERRES_TOMBALES_BRUTES;',
    vers: '  const requete = PIERRES_TOMBALES_BRUTES;'
  },
  {
    nom: 'M21 · l’intention se déduit à nouveau d’une lecture hors verrou',
    pourquoi: 'Sous une course, celui qui crée recevrait « donnée modifiée » au lieu de « déjà créée ».',
    niveau: 'serveur',
    fichier: 'scripts/serve.js',
    de: "      const intention = revisionAttendue === 0 ? 'create' : 'update';",
    vers: "      const intention = existing ? 'update' : 'create';"
  },
  {
    nom: 'M22 · la connexion cesse de faire avancer le compteur',
    pourquoi: 'La fiche utilisateur changerait sans que le compteur bouge : une session ouverte réécrirait des données antérieures.',
    niveau: 'integrite',
    fichier: 'scripts/serve.js',
    de: `    await compareAndWrite(pool, {
      storeName: 'users', recordId: String(result.rows[0].record_id), record: updated, force: true
    });`,
    vers: `    await pool.query("UPDATE platform_records SET data=$1::jsonb,updated_at=NOW() WHERE store_name='users' AND record_id=$2", [JSON.stringify(updated), result.rows[0].record_id]);`
  },
  {
    nom: 'M14 · le conflit cesse d’être affiché à l’utilisateur',
    pourquoi: 'Émis mais jamais montré, le refus ressemble à une saisie qui s’évapore : pire que l’état d’avant ce lot.',
    fichier: 'notifications.js',
    de: "      if (!['warning', 'conflict'].includes(etat) || !event.detail?.message) return;",
    vers: "      if (etat !== 'warning' || !event.detail?.message) return;"
  }
];

const lire = fichier => fs.readFileSync(chemin(fichier), 'utf8');
const ecrire = (fichier, contenu) => fs.writeFileSync(chemin(fichier), contenu);

function lancerTests() {
  try {
    execFileSync('node', ['--test', ...CIBLES], { cwd: racine, stdio: 'pipe' });
    return { vert: true, sortie: '' };
  } catch (erreur) {
    return { vert: false, sortie: String(erreur.stdout || '') };
  }
}

const attendre = ms => new Promise(resoudre => setTimeout(resoudre, ms));

/** Démarre un serveur neuf : le module muté n'est lu qu'au chargement. */
async function demarrerServeur() {
  const processus = spawn('node', ['scripts/serve.js'], {
    cwd: racine,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(PORT_E2E),
      DATABASE_URL: BASE_E2E,
      PLATFORM_ADMIN_USERNAME: ADMIN.user,
      PLATFORM_ADMIN_PASSWORD: ADMIN.pass,
      SESSION_SECRET: 'batch-b-mutations-test-uniquement'
    }
  });
  for (let essai = 0; essai < 40; essai += 1) {
    await attendre(500);
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT_E2E}/api/health`);
      if (reponse.ok) return processus;
    } catch { /* pas encore prêt */ }
  }
  processus.kill('SIGKILL');
  throw new Error('le serveur muté n’a pas démarré');
}

async function arreterServeur(processus) {
  if (!processus || processus.killed) return;
  processus.kill('SIGTERM');
  for (let essai = 0; essai < 20 && processus.exitCode === null; essai += 1) await attendre(150);
  if (processus.exitCode === null) processus.kill('SIGKILL');
}

/**
 * La reproduction de bout en bout, sur un serveur neuf et une base neuve.
 *
 * La base est recréée à chaque passage : une base héritée d'un passage précédent porterait
 * des révisions déjà avancées, et le résultat ne dirait plus rien de la mutation.
 */
async function lancerE2E(script) {
  execFileSync('psql', [
    'postgres://tech:tech@127.0.0.1:5432/postgres', '-q',
    '-c', 'DROP DATABASE IF EXISTS batch_b_mutations;',
    '-c', 'CREATE DATABASE batch_b_mutations OWNER tech;'
  ], { stdio: 'pipe' });

  let processus = null;
  try {
    processus = await demarrerServeur();
    execFileSync('node', [script], {
      cwd: racine, stdio: 'pipe',
      env: {
        ...process.env,
        E2E_BASE_URL: `http://127.0.0.1:${PORT_E2E}`,
        DATABASE_URL: BASE_E2E,
        PLATFORM_ADMIN_USERNAME: ADMIN.user,
        PLATFORM_ADMIN_PASSWORD: ADMIN.pass
      }
    });
    return { vert: true, sortie: '' };
  } catch (erreur) {
    return { vert: false, sortie: String(erreur.stdout || erreur.message || '') };
  } finally {
    await arreterServeur(processus);
  }
}

/*
 * Trois batteries, parce que trois gardes vivent à trois endroits différents.
 *
 *   unite      une garde interne au magasin ou au client ;
 *   serveur    une garde qui n'existe qu'au niveau HTTP — refus, codes, verrous ;
 *   integrite  une garde qui ne se voit qu'en LISANT la base : le compteur a-t-il suivi ?
 */
const BATTERIES = {
  unite: () => Promise.resolve(lancerTests()),
  serveur: () => lancerE2E('scripts/concurrence-e2e.mjs'),
  integrite: () => lancerE2E('scripts/revision-integrite-e2e.mjs')
};

const lancer = niveau => (BATTERIES[niveau] || BATTERIES.unite)();

const tuePar = sortie => {
  const unitaires = (sortie.match(/^not ok \d+ - (.+)$/gm) || [])
    .map(ligne => ligne.replace(/^not ok \d+ - /, ''));
  if (unitaires.length) return unitaires;
  return (sortie.match(/^ {2}❌ (.+)$/gm) || []).map(ligne => ligne.replace(/^ {2}❌ /, '').split(' → ')[0]);
};

console.log('\n╔═══ mutations du contrat de version ═══╗\n');

for (const niveau of Object.keys(BATTERIES)) {
  const reference = await lancer(niveau);
  if (!reference.vert) {
    console.log(`❌ la batterie « ${niveau} » n’est pas verte AVANT mutation : rien de ce qui suit n’aurait de sens.`);
    console.log(tuePar(reference.sortie).join('\n'));
    process.exit(1);
  }
  console.log(`✅ référence « ${niveau} » verte avant toute mutation`);
}
console.log('');

const survivantes = [];
for (const mutation of MUTATIONS) {
  const niveau = mutation.niveau || 'unite';
  const original = lire(mutation.fichier);
  const occurrences = original.split(mutation.de).length - 1;
  if (occurrences !== 1) {
    console.log(`⚠️  ${mutation.nom} — motif trouvé ${occurrences} fois dans ${mutation.fichier}, mutation non appliquée`);
    survivantes.push({ ...mutation, raison: 'motif ambigu ou absent' });
    continue;
  }
  ecrire(mutation.fichier, original.replace(mutation.de, mutation.vers));
  let resultat;
  try { resultat = await lancer(niveau); }
  finally { ecrire(mutation.fichier, original); }

  if (resultat.vert) {
    console.log(`❌ SURVIVANTE — ${mutation.nom}  [${niveau}]`);
    console.log(`   ${mutation.pourquoi}`);
    survivantes.push({ ...mutation, raison: 'aucun test ne la tue' });
  } else {
    const morts = tuePar(resultat.sortie);
    console.log(`✅ tuée — ${mutation.nom}  [${niveau}]`);
    console.log(`   par ${morts.length} contrôle(s), dont : ${morts.slice(0, 2).join(' · ') || '(échec au chargement)'}`);
  }
}

console.log(`\n╚═══ ${survivantes.length === 0 ? '✅ AUCUNE SURVIVANTE' : `❌ ${survivantes.length} SURVIVANTE(S)`} ═══╝\n`);
process.exit(survivantes.length === 0 ? 0 : 1);
