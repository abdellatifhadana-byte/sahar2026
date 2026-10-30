/**
 * @file scripts/batch-c-mutations.mjs — la batterie de mutations de Batch C.
 *
 * POURQUOI
 * --------
 * Une garde qu'aucun test ne tue quand on la retire ne garde rien. Chaque mutation
 * ci-dessous rouvre l'un des trois défauts du lot — diff non émis, suppression non
 * signalée, invalidation avant l'écriture — ou l'un des contournements qu'on refuse :
 * invalidation aveugle, éditeur écrasé, révocation ignorée.
 *
 * Usage :  node scripts/batch-c-mutations.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chemin = relatif => path.join(racine, relatif);
const CIBLES = [
  'tests/snapshot-diff-invalidation.test.js',
  'tests/snapshot-divergence-ui.test.js',
  'tests/refresh-blocage-editeur.test.js',
  'tests/propriete-enregistrement.test.js'
];

const MUTATIONS = [
  {
    nom: 'C1 · la différence n’est plus annoncée du tout',
    pourquoi: 'C’est SYNC-01 dans son état d’origine : l’instantané entre en base sans un mot, l’écran reste vieux.',
    fichier: 'central-sync.js',
    de: '  if (diffAAnnoncer && !diffIsEmpty(diffAAnnoncer)) {',
    vers: '  if (false) {'
  },
  {
    nom: 'C2 · la suppression distante cesse d’avoir son événement',
    pourquoi: 'C’est DELETE-SYNC-02 : la fiche quitte la base, le fantôme reste à l’écran.',
    fichier: 'snapshot-diff-contract.js',
    de: `  for (const { store, id } of diff.deletedEntities) {
    emettre(SNAPSHOT_EVENTS.DELETED, { storeName: store, id, deletedAt: new Date().toISOString() });
    emis += 1;
  }`,
    vers: '  void diff.deletedEntities;'
  },
  {
    nom: 'C3 · les événements repartent AVANT l’écriture locale',
    pourquoi: 'Annoncer un changement que la base n’a pas encore invite chaque vue à relire l’ancien état et à se croire à jour.',
    fichier: 'central-sync.js',
    de: `    let ecrits = 0;
    const avantParMagasin = new Map();`,
    vers: `    let ecrits = 0;
    const avantParMagasin = new Map();
    for (const [nomAvance, listeAvance] of parMagasin) {
      const ancien = await db.getAll(nomAvance).catch(() => []);
      const anticipe = buildSnapshotDiff(new Map([[nomAvance, ancien]]), new Map([[nomAvance, listeAvance]]));
      if (!diffIsEmpty(anticipe)) {
        await emitSnapshotDiff(anticipe, (s, i) => db._getRaw(s, normalizeRemoteId(i)), (t, d) => emitEvent(t, d));
      }
    }`
  },
  {
    nom: 'C4 · toute entité paraît changée à chaque instantané',
    pourquoi: 'Comparer des textes sérialisés : PostgreSQL renormalise l’ordre des clés, donc l’invalidation devient globale et permanente — c’est-à-dire sans information.',
    fichier: 'snapshot-diff-contract.js',
    de: '    if (!ancien || !sameReferenceContent(ancien, enregistrement)) changed.push(id);',
    vers: '    if (!ancien || JSON.stringify(ancien) !== JSON.stringify(enregistrement)) changed.push(id);'
  },
  {
    nom: 'C5 · une disparition du périmètre n’est plus une disparition',
    pourquoi: 'Une donnée devenue interdite resterait affichée dans une vue ouverte : la révocation ne servirait à rien côté écran.',
    fichier: 'snapshot-diff-contract.js',
    de: '  return { changed, deleted: [...anciens.keys()] };',
    vers: '  return { changed, deleted: [] };'
  },
  {
    nom: 'C6 · une saisie en cours est écrasée en silence',
    pourquoi: 'Le travail non enregistré d’un humain disparaît sans qu’il l’apprenne : c’est la perte que tout ce chantier cherche à empêcher.',
    fichier: 'snapshot-diff-contract.js',
    de: '    const type = hasDirtyEditor(store, id) ? SNAPSHOT_EVENTS.DIVERGED : SNAPSHOT_EVENTS.UPDATED;',
    vers: '    const type = SNAPSHOT_EVENTS.UPDATED;'
  },
  {
    nom: 'C7 · un éditeur PROPRE est traité comme sale',
    pourquoi: 'Trop protéger revient à ne plus rafraîchir : un formulaire intact afficherait un état périmé sans raison.',
    fichier: 'snapshot-diff-contract.js',
    de: '  return editeursOuverts.get(cle(store, id)) === true;',
    vers: '  return editeursOuverts.has(cle(store, id));'
  },
  {
    nom: 'C8 · l’état d’avant n’est plus celui que cette transaction remplace',
    pourquoi: 'Comparer à un état qu’on n’a pas lu revient à décrire une différence qui n’a jamais eu lieu : plus rien ne peut être vu comme disparu, et tout paraît neuf.',
    fichier: 'central-sync.js',
    de: '      avant = lecture.result || [];',
    vers: '      avant = [];'
  },
  {
    nom: 'C9 · le récapitulatif part même quand rien n’a changé',
    pourquoi: 'Un battement toutes les vingt secondes qu’un consommateur distrait finirait par prendre pour un signal : le bruit que l’invariant interdit.',
    fichier: 'snapshot-diff-contract.js',
    de: '  return !diff?.changedEntities?.length && !diff?.deletedEntities?.length;',
    vers: '  return false;'
  },

  /* ─────────── C-TOMBSTONE-01 · la suppression portée par une pierre tombale ─────────── */

  {
    nom: 'C10 · la pierre tombale n’entre plus dans la différence',
    pourquoi: 'La fiche quitte bien la base locale, mais le diff ne le dit pas : c’est le défaut exact du Runtime Gate — suppression réelle, écran jamais averti, fantôme cliquable.',
    fichier: 'central-sync.js',
    de: '      apresParMagasin.set(storeName, projectStoreAfter(avant, records, { clearFirst, deleted: supprimes, conserves }));',
    vers: '      apresParMagasin.set(storeName, projectStoreAfter(avant, records, { clearFirst, deleted: [], conserves }));'
  },
  {
    nom: 'C11 · le magasin visé par une pierre tombale n’entre dans aucune carte',
    pourquoi: 'Reproduit le défaut d’origine : un magasin ni autoritaire ni présent dans `data` reste hors du diff, et sa suppression n’a aucun chemin vers l’écran.',
    fichier: 'central-sync.js',
    de: `    for (const storeName of tombesParMagasin.keys()) {
      if (!parMagasin.has(storeName)) parMagasin.set(storeName, []);
    }`,
    vers: '    void tombesParMagasin;'
  },

  /* ─────────── C-DIRTY-UI-01 · la divergence doit atteindre un humain ─────────── */

  {
    nom: 'C12 · plus personne n’écoute la divergence',
    pourquoi: 'L’état exact avant ce lot : l’événement était émis et n’atteignait personne. Une protection que rien ne reçoit n’est pas une protection.',
    fichier: 'snapshot-divergence-ui.js',
    de: `  window.addEventListener(SNAPSHOT_EVENTS.DIVERGED, evenement => {
    const { storeName, id, record } = evenement.detail || {};
    if (!storeName || id === undefined || id === null) return;
    afficherDivergence(storeName, id, record);
  });`,
    vers: '  void afficherDivergence;'
  },
  {
    nom: 'C13 · une saisie en cours n’est plus reconnue comme telle',
    pourquoi: 'Sans reconnaissance de la saisie, la condition qui produit la divergence n’est jamais vraie : le chaînon manquant côté écran, et le plus facile à réintroduire.',
    fichier: 'snapshot-divergence-ui.js',
    de: `  document.addEventListener('input', marquerSale, true);
  document.addEventListener('change', marquerSale, true);`,
    vers: '  void marquerSale;'
  },
  {
    nom: 'C14 · la suppression distante ne traverse plus la protection',
    pourquoi: 'On garderait une saisie sur une fiche qui n’existe plus, et le bouton « Enregistrer » resterait actif : l’utilisateur croirait perdre son travail sans comprendre pourquoi.',
    fichier: 'snapshot-divergence-ui.js',
    de: `  window.addEventListener(SNAPSHOT_EVENTS.DELETED, evenement => {`,
    vers: `  window.addEventListener('divergence-suppression-desactivee', evenement => {`
  },
  {
    nom: 'C15 · le module n’est plus chargé par le document',
    pourquoi: 'Un module parfait que la page ne charge pas ne protège personne. Cette mutation vérifie que les épreuves mesurent l’application ASSEMBLÉE, et non un module choisi à la main.',
    fichier: 'index.html',
    de: '  <script type="module" src="snapshot-divergence-ui.js"></script>',
    vers: '  <!-- module retiré par la mutation C15 -->'
  },

  /* ─────────── BLOCK-C-UI-01 · l'écran qui ne bouge plus ─────────── */

  {
    nom: 'C16 · une fenêtre d’édition cachée redevient bloquante',
    pourquoi: 'C’est le défaut mesuré : la page Équipements monte `#eq-modal` caché en permanence, tout rafraîchissement était différé pour toujours, et l’écran gardait un nom périmé ou un fantôme jusqu’à un F5.',
    fichier: 'data-visibility-recovery.js',
    de: '  if (Array.from(document.querySelectorAll(FENETRES_EDITION)).some(estVisible)) return true;',
    vers: '  if (document.querySelector(FENETRES_EDITION)) return true;'
  },
  {
    nom: 'C17 · une saisie déclarée sale cesse de bloquer',
    pourquoi: 'La protection reposerait de nouveau sur la seule présence d’un nœud : un formulaire en cours pourrait être détruit par une reconstruction de section.',
    fichier: 'data-visibility-recovery.js',
    de: '  if (anyDirtyEditor()) return true;',
    vers: '  if (false) return true;'
  },

  /* ─────────── BLOCK-C-LOCAL-CHURN-01 · à qui appartient la fiche ─────────── */

  {
    nom: 'C18 · une fiche strictement locale est de nouveau effacée par le vidage',
    pourquoi: 'Mesuré : `map-image-cache` était détruite et jamais recréée — les octets du plan réellement perdus, puis retéléchargés. Ce n’était pas du bruit, c’était une perte de donnée.',
    fichier: 'record-ownership-contract.js',
    de: '  return recordOwnership(storeName, recordOrId) !== OWNERSHIP.SERVER;',
    vers: '  return false;'
  },
  {
    nom: 'C19 · l’état « après » oublie ce qui a survécu au vidage',
    pourquoi: 'Les fiches conservées seraient annoncées supprimées alors qu’elles sont toujours en base : la différence mentirait, et l’écran retirerait ce qui est là.',
    fichier: 'snapshot-diff-contract.js',
    de: '    if (!clearFirst || survivants.has(id)) etat.set(id, enregistrement);',
    vers: '    if (!clearFirst) etat.set(id, enregistrement);'
  },
  {
    nom: 'C20 · un ensemencement retenu retombe dans le vidage',
    pourquoi: 'Détruire → annoncer supprimé → ré-ensemencer, toutes les vingt secondes, pour ~450 documents : la boucle exacte que le Runtime Gate a mesurée à ~45 événements par seconde.',
    fichier: 'record-ownership-contract.js',
    de: "  if (storeName === 'docs' && ensemencementsRetenus.has(id)) return OWNERSHIP.CATALOG_BUFFERED;",
    vers: "  if (false) return OWNERSHIP.CATALOG_BUFFERED;"
  },
  {
    nom: 'C21 · la retenue du catalogue devient perpétuelle',
    pourquoi: 'Sans cession d’autorité, une fiche installée au centre resterait protégée pour toujours : deux sources durables pour la même donnée, et une suppression centrale sans effet.',
    fichier: 'central-sync.js',
    de: "    for (const record of parMagasin.get('docs') || []) releaseCatalogBuffered(record?.id);",
    vers: '    // cession retirée par la mutation C21'
  },
  {
    nom: 'C22 · le faux « supprimé » est masqué au lieu d’être supprimé',
    pourquoi: 'C’est le remède qu’il fallait refuser : filtrer l’annonce laisse la destruction en place. La donnée continuerait de disparaître, en silence cette fois — et une VRAIE suppression centrale passerait inaperçue avec elle.',
    fichier: 'snapshot-diff-contract.js',
    de: '    for (const id of deleted) deletedEntities.push({ store, id });',
    vers: "    if (!['settings', 'docs'].includes(store)) for (const id of deleted) deletedEntities.push({ store, id });"
  },
  {
    nom: 'C23 · la préférence de poste est réécrite à chaque passage',
    pourquoi: 'Réécrire `current-room` à chaque cycle avec un `updatedAt` neuf la faisait paraître modifiée sans l’être — l’autre moitié de la boucle, celle qui la relançait.',
    fichier: 'central-sync.js',
    de: '      if ((currentRoom?.currentRoomId ?? null) !== roomRetenue || !currentRoom) {',
    vers: '      if (true) {'
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

console.log('\n╔═══ mutations BATCH C ═══╗\n');

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
