/**
 * @file tests/equipment-360-consultation-nowrite.test.js — #165, consulter n'est pas ensemencer.
 *
 * CE QUI SE PASSAIT
 * ------------------
 * `getCatalog()` — une fonction de LECTURE — appelait `ensureCatalogSeed()` en première
 * ligne. `equipment-media.js::catalogMap()` appelle `getCatalog()` pour rendre une Fiche
 * 360 : ouvrir une fiche en simple consultation créait donc des documents `docs/kb-*` et
 * les poussait vers PostgreSQL.
 *
 * Mesuré sur base neuve, APRÈS convergence complète du démarrage, avec une fenêtre témoin
 * de même durée à zéro écriture : 10 ouvertures produisaient 10 `db.save`, 20 `put`
 * IndexedDB et 10 `PUT` HTTP, sur dix fiches `origin:'seed'` absentes avant l'ouverture.
 *
 * CE QUE CETTE ÉPREUVE PROTÈGE
 * -----------------------------
 * Elle EXÉCUTE le vrai chemin de lecture, elle ne relit pas le code source : un module
 * qu'on ne peut pas appeler n'est pas une règle vérifiée. La couche de stockage est
 * remplacée en mémoire sur le singleton partagé — aucune dépendance de développement,
 * la CI installe `--omit=dev`.
 *
 * Elle échouera si quelqu'un rebranche un jour `ensureCatalogSeed()` (ou tout autre
 * persistance) dans `getCatalog()` ou dans un chemin de rendu de Fiche 360.
 *
 * Le témoin de la deuxième épreuve est tout aussi important : il interdit de « corriger »
 * le défaut en supprimant simplement l'ensemencement, ce qui viderait la base de
 * connaissances au lieu de la déplacer au démarrage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/mini-dom.js';

/* ---------------- Stockage en mémoire, installé avant l'import du module ---------------- */

const magasins = new Map();
const magasin = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};
let ecritures = [];

const { db } = await import('../db.js');
db.open = async () => db;
db.getAll = async nom => [...magasin(nom).values()].map(record => structuredClone(record));
db.get = async (nom, id) => {
  const record = magasin(nom).get(String(id));
  return record ? structuredClone(record) : undefined;
};
db.save = async (nom, donnees) => {
  const charge = { ...donnees };
  ecritures.push(`${nom}/${charge.id}`);
  magasin(nom).set(String(charge.id), structuredClone(charge));
  return charge.id;
};

const { getCatalog, ensureCatalogSeed, INITIAL_CATALOG } = await import('../equipment-knowledge.js');

// Le chargement du module peut déclencher son ensemencement de démarrage : on le laisse
// se terminer, puis chaque épreuve part de l'état qu'elle choisit.
await ensureCatalogSeed().catch(() => {});

const viderCatalogue = () => { magasins.delete('docs'); };
const compter = async passage => { ecritures = []; await passage(); return ecritures; };

/* ---------------- La règle ---------------- */

test('CONSULTATION_NE_PERSISTE_PAS — lire le catalogue n\'écrit rien, même s\'il manque', async () => {
  // Le cas exact du défaut : la fiche demandée n'existe pas encore en base au moment du
  // rendu. L'ancien code la créait ET la poussait au serveur depuis le chemin de lecture.
  viderCatalogue();

  const ecrites = await compter(async () => {
    await getCatalog();
    await getCatalog();
  });

  assert.deepEqual(ecrites, [], `la consultation a persisté : ${ecrites.slice(0, 6).join(', ')}`);
  assert.equal(magasin('docs').size, 0, 'la lecture a créé des documents catalogue');
});

test('CONSULTATION_NE_PERSISTE_PAS — une lecture rend ce qui existe, sans rien réécrire', async () => {
  viderCatalogue();
  const exemple = INITIAL_CATALOG[0];
  await db.save('docs', { ...exemple, kind:'equipment_catalog', targetType:'equipment_catalog' });

  const ecrites = await compter(async () => {
    const catalogue = await getCatalog();
    assert.ok(
      catalogue.some(item => String(item.id) === String(exemple.id)),
      'la lecture ne rend pas la fiche pourtant présente'
    );
  });

  assert.deepEqual(ecrites, [], `la lecture a réécrit : ${ecrites.join(', ')}`);
});

test('DEMARRAGE_POSE_LE_CATALOGUE — l\'ensemencement de démarrage crée bien ce qui manque', async () => {
  // Témoin : interdit de « corriger » #165 en supprimant l'ensemencement. Ce qui a été
  // retiré du chemin de LECTURE doit rester présent dans le cycle de DÉMARRAGE.
  //
  // L'ensemencement ne s'exécute qu'UNE fois par session — il ne doit pas pouvoir
  // reposer, à chaque appel, ce qu'un instantané autoritaire vient légitimement de
  // retirer. On instancie donc un module neuf pour observer son PREMIER passage.
  viderCatalogue();
  const neuf = await import(`../equipment-knowledge.js?bootstrap=${Date.now()}`);

  const ecrites = await compter(async () => { await neuf.ensureCatalogSeed(); });

  assert.ok(ecrites.length > 0, 'le démarrage ne pose plus aucun document catalogue');
  const pose = await neuf.getCatalog();
  for (const attendu of INITIAL_CATALOG.slice(0, 5)) {
    assert.ok(
      pose.some(item => String(item.id) === String(attendu.id)),
      `le démarrage ne pose plus ${attendu.id}`
    );
  }
});

test('ORDRE_CENTRAL — l\'ensemencement n\'inspecte pas `docs` avant la décision centrale', async () => {
  /*
   * Le scénario « central CHAUD, IndexedDB local FROID » : PostgreSQL contient déjà tout
   * le catalogue, mais l'utilisateur arrive d'un profil neuf. Un `docs` local encore vide
   * n'est pas un catalogue manquant — c'est un instantané qui n'est pas encore arrivé.
   *
   * Mesuré en navigateur réel AVANT la barrière : première écriture d'ensemencement à
   * t+587 ms, première preuve d'instantané appliqué à t+1182 ms, soit 70 écritures
   * spéculatives sur des fiches DÉJÀ présentes côté serveur.
   *
   * Cette épreuve retient la décision centrale, puis observe : tant qu'elle n'est pas
   * tranchée, l'ensemencement ne doit NI lire `docs` NI écrire.
   */
  viderCatalogue();
  ecritures = [];

  let decisionTranchee = false;
  let lecturesAvantDecision = 0;
  const vraiGetAll = db.getAll;
  db.getAll = async nom => {
    if (nom === 'docs' && !decisionTranchee) lecturesAvantDecision += 1;
    return vraiGetAll(nom);
  };
  const vraiGet = db.get;
  db.get = async (nom, id) => {
    if (nom === 'docs' && !decisionTranchee) lecturesAvantDecision += 1;
    return vraiGet(nom, id);
  };

  // `attendreDecisionSync()` se libère sur un évènement porteur de `updatedAt`, ou sur un
  // état terminal. Tant qu'aucun n'est émis, la barrière retient — encore faut-il un
  // `window` qui porte réellement des évènements, sinon la barrière se croit hors
  // navigateur et ne retient rien.
  const fenetrePrecedente = globalThis.window;
  globalThis.window = new EventTarget();
  const module = await import(`../equipment-knowledge.js?ordre=${Date.now()}`);

  const enCours = module.ensureCatalogSeed();
  await new Promise(resolve => setTimeout(resolve, 60));
  const ecritesAvant = ecritures.length;
  const luesAvant = lecturesAvantDecision;

  // La décision tombe : instantané appliqué (porteur de `updatedAt`).
  decisionTranchee = true;
  globalThis.window.dispatchEvent(Object.assign(new Event('central-sync-status'), {
    detail: { state: 'synced', updatedAt: new Date().toISOString() }
  }));
  await enCours;

  db.getAll = vraiGetAll;
  db.get = vraiGet;
  globalThis.window = fenetrePrecedente;

  assert.equal(ecritesAvant, 0, `l'ensemencement a écrit avant la décision centrale : ${ecritures.slice(0, 5).join(', ')}`);
  assert.equal(luesAvant, 0, 'l\'ensemencement a inspecté `docs` avant la décision centrale');
  assert.ok(ecritures.length > 0, 'après la décision, l\'ensemencement doit poser ce qui manque');
});

test('ORDRE_CENTRAL — la barrière partagée n\'a pas dérivé de la copie vérifiée', async () => {
  /*
   * `central-sync-decision.js` publie la barrière pour les producteurs qui ne peuvent pas
   * importer `equipment-knowledge-extra.js` (celui-ci installe un `MutationObserver` au
   * chargement, sans garde `typeof window`). Le dépôt garde déjà la copie de ce module
   * frère alignée sur la version dont `regie-car-inventory-phase16.test.js` prouve le
   * comportement en EXÉCUTION ; celle-ci doit l'être aussi, sinon elle pourrait diverger
   * en silence et ne plus retenir ce qu'elle prétend retenir.
   */
  const { readFileSync } = await import('node:fs');
  const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8');
  const sansCommentaires = texte => texte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const extraire = (source, motif) => {
    const debut = source.search(motif);
    assert.notEqual(debut, -1, 'motif introuvable');
    let profondeur = 0, i = source.indexOf('{', debut);
    for (let j = i; j < source.length; j += 1) {
      if (source[j] === '{') profondeur += 1;
      else if (source[j] === '}') { profondeur -= 1; if (profondeur === 0) return source.slice(debut, j + 1); }
    }
    throw new Error('bloc non terminé');
  };

  const partagee = lire('../central-sync-decision.js');
  const verifiee = lire('../regie-car-inventory-phase16.js');

  assert.equal(
    sansCommentaires(extraire(partagee, /export function attendreDecisionSync\(\)/)),
    sansCommentaires(extraire(verifiee, /export function attendreDecisionSync\(\)/)),
    'attendreDecisionSync a divergé de la copie vérifiée'
  );

  // `decisionSyncEtablie` est une expression fléchée : on compare la ligne, pas un bloc.
  const ligne = (source, motif) => sansCommentaires(source.split('\n').filter(l => motif.test(l)).join(' '));
  assert.equal(
    ligne(partagee, /etat === 'local' \|\| etat === 'unauthenticated'/),
    ligne(verifiee, /etat === 'local' \|\| etat === 'unauthenticated'/),
    'decisionSyncEtablie a divergé de la copie vérifiée'
  );

  // Et le contrat lui-même, exécuté : un signal de file ne libère pas, un instantané oui.
  const { decisionSyncEtablie } = await import('../central-sync-decision.js');
  assert.equal(decisionSyncEtablie({ state:'offline' }), false);
  assert.equal(decisionSyncEtablie({ state:'warning' }), false);
  assert.equal(decisionSyncEtablie({ state:'synced', updatedAt:'2026-01-01T00:00:00Z' }), true);
  assert.equal(decisionSyncEtablie({ state:'unauthenticated' }), true);
});

test('PROPRIETE_INITIAL — ce module ne pose que INITIAL_CATALOG', async () => {
  // `EXTRA_EQUIPMENT_CATALOG` a son propre propriétaire de démarrage
  // (`equipment-knowledge-extra.js`), qui le dédoublonne aussi par clé sémantique.
  // Le poser ici également serait une double propriété.
  viderCatalogue();
  const fenetrePrecedente = globalThis.window;
  globalThis.window = new EventTarget();
  const module = await import(`../equipment-knowledge.js?propriete=${Date.now()}`);
  const enCours = module.ensureCatalogSeed();
  globalThis.window.dispatchEvent(Object.assign(new Event('central-sync-status'), {
    detail: { state: 'synced', updatedAt: new Date().toISOString() }
  }));
  await enCours;
  globalThis.window = fenetrePrecedente;

  const { EXTRA_EQUIPMENT_CATALOG } = await import('../equipment-catalog-extra-seed.js');
  const posees = new Set([...magasin('docs').keys()].map(String));
  const idsInitial = new Set(INITIAL_CATALOG.map(item => String(item.id)));
  const extraPosees = EXTRA_EQUIPMENT_CATALOG
    .map(item => String(item.id))
    .filter(id => posees.has(id) && !idsInitial.has(id));

  assert.deepEqual(extraPosees, [], `ce module pose du catalogue EXTRA : ${extraPosees.slice(0, 5).join(', ')}`);
  for (const attendu of INITIAL_CATALOG.slice(0, 5)) {
    assert.ok(posees.has(String(attendu.id)), `INITIAL_CATALOG incomplet : ${attendu.id} manque`);
  }
});

test('DEMARRAGE_POSE_LE_CATALOGUE — l\'ensemencement est idempotent sur un catalogue déjà posé', async () => {
  viderCatalogue();
  const premier = await import(`../equipment-knowledge.js?idempotence=${Date.now()}`);
  await premier.ensureCatalogSeed();

  // Un module neuf, sur une base qui contient DÉJÀ le catalogue : rien à reposer.
  const second = await import(`../equipment-knowledge.js?idempotence2=${Date.now()}`);
  const ecrites = await compter(async () => { await second.ensureCatalogSeed(); });

  assert.deepEqual(ecrites, [], `l'ensemencement n'est pas idempotent : ${ecrites.slice(0, 6).join(', ')}`);
});
