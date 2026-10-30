/**
 * @file tests/catalog-enrichment-convergence.test.js — SYNC-RESIDUAL-P0, #98 volet convergence.
 *
 * CE QUI SE PASSAIT
 * ------------------
 * Les producteurs `docs/kb-*` se déclenchent chacun depuis leur propre <script type="module">
 * et se rappellent en plus les uns les autres. Tant que leurs écritures concurrentes se
 * heurtaient (409 STALE_WRITE), une écriture sur deux était rejetée — ce qui MASQUAIT un
 * défaut plus profond : ces passages ne convergent pas. Chacun réaffirmait ses propres
 * constantes par-dessus celles d'un autre, indéfiniment.
 *
 * Une fois les passages sérialisés (catalog-enrichment-gate.js), plus rien ne rejetait ces
 * écritures : l'aller-retour est devenu permanent — 337 `db.save()` mesurés sur soixante
 * secondes d'immobilité, dont un même document réécrit neuf fois.
 *
 * Trois inversions de préséance, toutes de la même famille — un passage détruisait ce qu'il
 * ne possède pas :
 *   1. `equipment-image-seed.js` reconstruisait `imageResearch` sur trois clés, effaçant
 *      celles des lots 2 à 8 ; et sa constante passait AVANT la valeur déjà posée, faisant
 *      retomber `status` de `official-image-verified` (lot 7) à `source-page-known`.
 *   2. `equipment-image-coverage-batch2.js` (revue du 2026-08-15) réaffirmait sa page source
 *      et sa date par-dessus celles du lot 6 / lot 8 (2026-08-16).
 *   3. `equipment-field-evidence.js` filtrait l'ensemble FUSIONNÉ des preuves contre son
 *      propre pack, supprimant donc les preuves Phase 12 (`2m-field12-*`) que Phase 12
 *      reposait au passage suivant.
 *
 * CE QUE CES ÉPREUVES VÉRIFIENT
 * ------------------------------
 * Elles exécutent la VRAIE logique des producteurs. Seule la couche de STOCKAGE est
 * remplacée : `db.open/get/getAll/save` sont réimplémentés en mémoire sur le singleton
 * partagé, avant l'import des producteurs. Ces modules ne connaissent rien d'IndexedDB —
 * ils lisent et écrivent par ces quatre méthodes — donc leur comportement est intégralement
 * exercé, sans dépendance de développement (la CI installe `--omit=dev`).
 *
 * La propriété décisive est la dernière : un second passage identique n'écrit RIEN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Un navigateur minimal, installé avant l'import ---------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  removeEventListener() {},
  dispatchEvent(evenement) {
    for (const fonction of [...(auditeurs.get(evenement.type) || [])]) fonction(evenement);
    return true;
  }
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  head: { appendChild() {} }, body: null
};
globalThis.localStorage = {
  store: new Map(),
  getItem(cle) { return this.store.has(cle) ? this.store.get(cle) : null; },
  setItem(cle, valeur) { this.store.set(cle, String(valeur)); },
  removeItem(cle) { this.store.delete(cle); }
};
globalThis.setInterval = () => 0;
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
// Aucun réseau : ces modules doivent se contenter de la base locale.
globalThis.fetch = async () => ({ ok: false, status: 503, headers: { get: () => null }, text: async () => '{}' });

/* ---------------- La couche de stockage, en mémoire ---------------- */

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
  // `db.save` réel retire une clé vide avant d'écrire ; on garde ce contrat.
  const charge = { ...donnees };
  if (charge.id === '' || charge.id === undefined || charge.id === null) delete charge.id;
  ecritures.push(`${nom}/${charge.id}`);
  magasin(nom).set(String(charge.id), structuredClone(charge));
  return charge.id;
};

const { ensureEquipmentImageSeed } = await import('../equipment-image-seed.js');
const { ensureEquipmentImageCoverageBatch2 } = await import('../equipment-image-coverage-batch2.js');
const { ensureEquipmentFieldEvidence, FIELD_EVIDENCE_CATALOG_PATCHES } = await import('../equipment-field-evidence.js');

/* ---------------- Outils ---------------- */

const CATALOGUE = { kind: 'equipment_catalog', targetType: 'equipment_catalog' };
const poser = async record => { await db.save('docs', { ...CATALOGUE, ...record }); };
const lire = async id => db.get('docs', id);

async function compterEcritures(passage) {
  ecritures = [];
  await passage();
  return ecritures;
}

/* ---------------- SEED_PRESERVE ---------------- */

test('SEED_PRESERVE — l\'ensemencement image ne détruit pas les clés imageResearch des lots suivants', async () => {
  await poser({
    id: 'kb-ross-ultrix',
    imageResearch: {
      sourcePage: 'https://www.rossvideo.com/revue-lot-8/',
      sourceType: 'manufacturer',
      status: 'official-image-verified',
      manufacturer: 'Ross Video',
      modelRequired: false,
      reviewedAt: '2026-08-16',
      candidateReviewedAt: '2026-08-16',
      sourceNote: 'Note posée par un lot ultérieur.'
    }
  });

  await ensureEquipmentImageSeed();

  const apres = await lire('kb-ross-ultrix');
  assert.equal(apres.imageResearch.manufacturer, 'Ross Video', 'la clé d\'un autre lot a été effacée');
  assert.equal(apres.imageResearch.modelRequired, false);
  assert.equal(apres.imageResearch.reviewedAt, '2026-08-16');
  assert.equal(apres.imageResearch.candidateReviewedAt, '2026-08-16');
  assert.equal(apres.imageResearch.sourceNote, 'Note posée par un lot ultérieur.');
});

test('SEED_PRESERVE — l\'ensemencement ne fait pas retomber un statut déjà promu par un lot ultérieur', async () => {
  // `kb-leader-lv5300a` porte, dans les constantes de l'ensemencement, le statut
  // `source-page-known`. Le lot 7 l'a promu après avoir vérifié une image constructeur.
  await poser({
    id: 'kb-leader-lv5300a',
    imageResearch: {
      sourcePage: 'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
      sourceType: 'manufacturer',
      status: 'official-image-verified',
      reviewedAt: '2026-08-16'
    }
  });

  await ensureEquipmentImageSeed();

  const apres = await lire('kb-leader-lv5300a');
  assert.equal(apres.imageResearch.status, 'official-image-verified', 'le statut a été ramené en arrière');
});

/* ---------------- BATCH2_YIELD ---------------- */

test('BATCH2_YIELD — le lot 2 ne ramène pas en arrière une page source revue plus tard', async () => {
  const PAGE_LOT6 = 'https://www.dell.com/support/product-details/en-us/product/poweredge-r550/overview';
  await poser({
    id: 'kb-dell-r550',
    imageResearch: {
      sourcePage: PAGE_LOT6,
      sourceType: 'manufacturer',
      sourceReviewedAt: '2026-08-16',
      status: 'source-page-known'
    }
  });

  await ensureEquipmentImageCoverageBatch2();

  const apres = await lire('kb-dell-r550');
  assert.equal(apres.imageResearch.sourcePage, PAGE_LOT6, 'le lot 2 a réécrit une page source plus récente');
});

test('BATCH2_YIELD — sans revue plus récente, le lot 2 pose bien sa propre valeur', async () => {
  await poser({ id: 'kb-tsl-tallyman' });

  await ensureEquipmentImageCoverageBatch2();

  const apres = await lire('kb-tsl-tallyman');
  assert.equal(apres.imageResearch.sourcePage, 'https://www.tslproducts.com/products/control-solutions/tallyman-control-system-overview/');
  assert.equal(apres.imageResearch.reviewedAt, '2026-08-15');
  assert.equal(apres.imageCoverageBatch2Version, 1);
});

/* ---------------- EVIDENCE_PACK_PRESERVED ---------------- */

test('EVIDENCE_PACK_PRESERVED — les preuves d\'un autre pack ne sont pas supprimées', async () => {
  const preuvePhase12 = {
    assetId: '2m-field12-06',
    caption: 'Evertz 4×1 HD ROUTER model X0401H observé en façade.',
    zone: 'BAIE VIDEO',
    sourceType: '2m-field-photo',
    verificationStatus: 'field-observed',
    observedAt: '2026-08-16'
  };
  await poser({ id: 'kb-evertz-x0401h', fieldEvidenceImages: [preuvePhase12] });

  await ensureEquipmentFieldEvidence();

  const apres = await lire('kb-evertz-x0401h');
  const identifiants = apres.fieldEvidenceImages.map(item => item.assetId);
  assert.ok(identifiants.includes('2m-field12-06'), 'la preuve Phase 12 a été supprimée par le pack de base');
  assert.ok(identifiants.includes('2m-field-16'), 'la preuve de ce pack-ci n\'a pas été posée');
});

test('EVIDENCE_PACK_PRESERVED — une preuve ENTRANTE dont l\'asset est inconnu reste refusée', async () => {
  // La garde d'origine sert toujours à ce pour quoi elle existe : ce module ne pose pas
  // une preuve pointant vers un asset absent de son pack.
  const poses = FIELD_EVIDENCE_CATALOG_PATCHES.flatMap(patch => patch.fieldEvidenceImages || []);
  assert.ok(poses.length > 0);
  assert.ok(
    poses.every(item => /^2m-field-\d{2}$/.test(item.assetId)),
    'ce module ne doit poser que des preuves de son propre pack'
  );
});

/* ---------------- CONVERGENCE ---------------- */

test('CONVERGENCE — un second passage identique n\'écrit plus rien', async () => {
  // Premier passage : il pose ce qu'il doit poser.
  await ensureEquipmentImageSeed();
  await ensureEquipmentImageCoverageBatch2();
  await ensureEquipmentFieldEvidence();

  // Second passage, sur exactement le même contenu : point fixe attendu.
  const ecrites = await compterEcritures(async () => {
    await ensureEquipmentImageSeed();
    await ensureEquipmentImageCoverageBatch2();
    await ensureEquipmentFieldEvidence();
  });

  assert.deepEqual(ecrites, [], `passage non convergent : ${ecrites.join(', ')}`);
});
