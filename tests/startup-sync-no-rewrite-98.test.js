/**
 * @file tests/startup-sync-no-rewrite-98.test.js — #98 : un aller-retour en base ne
 *       justifie pas une réécriture.
 *
 * CE QUE CETTE PORTE GARDE
 * ------------------------
 * Quatre modules d'ensemencement décidaient d'écrire ou non par `JSON.stringify(next) ===
 * JSON.stringify(current)`. La comparaison paraît stricte ; elle est en réalité AVEUGLE au
 * seul cas qui compte ici.
 *
 * `current` ne vient pas du navigateur. Il revient du serveur, où PostgreSQL le range en
 * `jsonb` — un format qui NORMALISE l'ordre des clés : longueur croissante, puis ordre des
 * octets. Le voici, mesuré sur une vraie base, pour `docs/kb-evertz-x0401h` :
 *
 *     id · kind · type · model · family · origin · category · observed · _revision ·
 *     confidence · targetType · manufacturer · imageResearch · …
 *
 * `next`, lui, est bâti dans l'ordre des littéraux des modules. Deux ordres, donc deux
 * chaînes différentes pour un contenu strictement identique : la garde répondait
 * « différent » à CHAQUE chargement, et la fiche repartait vers le serveur pour rien.
 *
 * Mesuré sur main@f2bc8a6, trois bases neuves, fenêtre de repos de 45 s : cinq PUT
 * automatiques par fenêtre, sur `docs/kb-evertz-x0401h`, `docs/kb-avid-dnxiq` et
 * `docs/kb-leader-lt4448`, dont la révision montait 1 → 2 → 3 → … sans qu'un seul champ
 * métier ne bouge. Aucun 409 : le sérialiseur de `catalog-enrichment-gate.js` les avait
 * déjà supprimés. Restaient les écritures inutiles elles-mêmes.
 *
 * COMMENT ELLE LE GARDE
 * ---------------------
 * Elle n'inspecte aucun texte de code. Elle FAIT TOURNER chaque producteur DEUX FOIS sur
 * une base qui imite l'aller-retour `jsonb` — le magasin réordonne les clés de tout ce
 * qu'il retient, exactement comme PostgreSQL. Le second passage ne doit rien écrire.
 *
 * L'ensemencement du premier passage sert de décor au second : la porte ne peut donc pas
 * se désaccorder du contenu réel des modules, puisqu'elle n'en fixe aucun.
 *
 * Et pour qu'elle ne puisse pas être verte par inertie, chaque cas a sa contre-épreuve :
 * une différence de CONTENU, elle, doit produire exactement une écriture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ─────────────────── L'ALLER-RETOUR `jsonb`, REPRODUIT FIDÈLEMENT ─────────────────── */

/**
 * PostgreSQL range les clés d'un objet `jsonb` par LONGUEUR croissante, puis par ordre
 * d'octets. Les tableaux, eux, gardent leur ordre : ce sont des données ordonnées.
 */
const comparerCommeJsonb = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
function ordreJsonb(valeur) {
  if (Array.isArray(valeur)) return valeur.map(ordreJsonb);
  if (valeur === null || typeof valeur !== 'object') return valeur;
  const sortie = {};
  for (const cle of Object.keys(valeur).sort(comparerCommeJsonb)) sortie[cle] = ordreJsonb(valeur[cle]);
  return sortie;
}
const allerRetourJsonb = valeur => ordreJsonb(JSON.parse(JSON.stringify(valeur)));

/**
 * L'ordre RÉELLEMENT observé dans `platform_records` pour `docs/kb-evertz-x0401h`, relevé
 * par `psql` sur une base issue d'une session complète. Il ancre la simulation dans une
 * mesure : si PostgreSQL changeait de règle, cette épreuve le dirait avant les autres.
 */
const ORDRE_MESURE_EN_BASE = [
  'id', 'kind', 'type', 'model', 'family', 'origin', 'category', 'observed', '_revision',
  'confidence', 'targetType', 'manufacturer', 'imageResearch', 'officialImages',
  'candidateImages', 'imageSeedVersion', 'inventoryAliases', 'catalogSeedVersion',
  'verificationStatus', 'fieldEvidenceImages', 'mediaLinkageVersion', 'fieldEvidenceVersion',
  'mediaLinkageUpdatedAt', 'fieldEvidenceObservedAt', 'fieldHardwareConfirmation',
  'imageCoverageBatch2Version'
];

test("la simulation d'aller-retour jsonb reproduit l'ordre RÉELLEMENT observé en base", () => {
  const melange = {};
  for (const cle of [...ORDRE_MESURE_EN_BASE].reverse()) melange[cle] = 1;
  assert.deepEqual(Object.keys(allerRetourJsonb(melange)), ORDRE_MESURE_EN_BASE,
    "la simulation ne range plus les clés comme PostgreSQL : le décor de cette porte n'est plus fidèle");
  // Et elle ne touche pas à l'ordre des tableaux, qui est de l'information.
  assert.deepEqual(allerRetourJsonb({ liste: ['b', 'a', 'c'] }).liste, ['b', 'a', 'c']);
});

test("un contenu identique rangé en jsonb TROMPE JSON.stringify — c'est tout le défaut", () => {
  const ecritParLeModule = { kind: 'equipment_catalog', targetType: 'equipment_catalog', id: 'kb-x', observed: true };
  const reluDepuisLaBase = allerRetourJsonb(ecritParLeModule);
  assert.notEqual(JSON.stringify(ecritParLeModule), JSON.stringify(reluDepuisLaBase),
    'sans divergence d’ordre, cette porte ne mesurerait rien');
  assert.deepEqual(ecritParLeModule, reluDepuisLaBase, 'le contenu, lui, est bien le même');
});

/* ─────────────────────────── UN NAVIGATEUR ET UNE BASE MINIMAUX ─────────────────────────── */

const minuteries = [];
const vraiSetTimeout = globalThis.setTimeout;
const vraiSetInterval = globalThis.setInterval;
globalThis.setTimeout = (...arguments_) => { const jeton = vraiSetTimeout(...arguments_); minuteries.push(jeton); return jeton; };
globalThis.setInterval = (...arguments_) => { const jeton = vraiSetInterval(...arguments_); minuteries.push(jeton); return jeton; };
test.after(() => { for (const jeton of minuteries) { clearTimeout(jeton); clearInterval(jeton); } });

const rien = () => {};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = { addEventListener: rien, removeEventListener: rien, dispatchEvent: () => true };
globalThis.document = {
  addEventListener: rien, removeEventListener: rien,
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
/*
 * UNE SESSION AUTORISÉE, PARCE QUE L'AMORÇAGE RÉGIE CAR EN EXIGE UNE (A-5).
 *
 * Le relevé ne vit plus dans le module : il arrive par `/api/operational/regie-car/inventory`,
 * et la mémoire du transport est indexée sur l'identité ET le contexte d'accès. Sans `auth`,
 * le module se tait — ce qui est le comportement voulu, mais ne prouve rien sur la
 * répétabilité de l'écriture, qui est l'objet de cette épreuve.
 */
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 'u-admin-98', authVersion: 1 }) : null),
  setItem: rien, removeItem: rien
};
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
// Aucun octet ne doit être inventé : les ressources binaires sont simplement absentes.
const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
const JEU_REGIE_CAR = buildRegieCarDataset();
const FETCH_MUET = async (url = '') => {
  // Seule la route autorisée répond : le relevé n'a aucun autre chemin, et surtout pas un
  // repli local.
  if (String(url).includes('/api/operational/regie-car/inventory')) {
    return { ok: true, status: 200, async json() { return { dataset: JEU_REGIE_CAR }; }, async arrayBuffer() { return new ArrayBuffer(0); } };
  }
  return { ok: false, status: 404, async json() { return {}; }, async arrayBuffer() { return new ArrayBuffer(0); } };
};
globalThis.fetch = FETCH_MUET;

/*
 * LA BASE EST POSÉE AVANT LES MODULES, ET C'EST ESSENTIEL.
 *
 * Plusieurs de ces modules s'amorcent d'eux-mêmes au chargement. Installer la base APRÈS
 * les avoir importés les laisserait atteindre le vrai IndexedDB — absent ici — et leur
 * premier passage échouerait en silence, dans un `catch` qui ne fait qu'avertir. La porte
 * serait alors verte sans avoir rien exécuté.
 */
const { db } = await import('../db.js');

const donnees = new Map();
const ecritures = [];
const cle = (store, id) => `${store}|${id}`;

db.open = async () => ({});
db.normalizeKey = valeur => String(valeur);
db.isCentralSyncReady = () => true;
db.get = async (store, id) => {
  const trouve = donnees.get(cle(store, String(id)));
  return trouve ? JSON.parse(JSON.stringify(trouve)) : undefined;
};
db._getRaw = db.get;
db.getAll = async store => [...donnees.entries()]
  .filter(([clef]) => clef.startsWith(`${store}|`))
  .map(([, valeur]) => JSON.parse(JSON.stringify(valeur)));
db.save = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${donnees.size}`);
  ecritures.push({ store, id });
  // Le serveur retient en `jsonb` : c'est CET état-là que le prochain passage relira.
  donnees.set(cle(store, id), allerRetourJsonb({ ...enregistrement, id }));
  return id;
};
db.saveLocalOnly = db.save;
db.delete = async (store, id) => donnees.delete(cle(store, String(id)));
db._deleteRaw = db.delete;
db.count = async store => (await db.getAll(store)).length;

/** Repartir d'une base vide, sans réinstaller la couche : les modules la tiennent déjà. */
function magasin() {
  donnees.clear();
  ecritures.length = 0;
  globalThis.fetch = FETCH_MUET;
  return {
    depuis: () => ecritures.length,
    ecritesDepuis: reprise => ecritures.slice(reprise),
    lire: (store, id) => donnees.get(cle(store, String(id))) || null,
    poser: (store, enregistrement) => donnees.set(cle(store, String(enregistrement.id)), allerRetourJsonb(enregistrement))
  };
}

/**
 * DEUX PASSAGES, ET SEUL LE SECOND EST JUGÉ.
 *
 * Le premier ensemence — c'est le travail légitime de la première convergence. Le second
 * rejoue le même producteur sur ce que la base a retenu : il ne doit plus rien écrire.
 */
async function deuxPassages(producteur) {
  const base = magasin();
  await producteur();
  const ensemencement = base.depuis();
  assert.ok(ensemencement > 0, 'le premier passage n’a rien écrit : le décor ne prouve rien');
  const reprise = base.depuis();
  await producteur();
  return { base, ensemencement, secondPassage: base.ecritesDepuis(reprise) };
}

/* ─────────────────────────────── LES QUATRE PRODUCTEURS ─────────────────────────────── */

const preuves = await import('../equipment-field-evidence.js');
const phase12 = await import('../equipment-field-evidence-phase12.js');
const regieCar = await import('../regie-car-prephoto-readiness.js');
const catalogueExtra = await import('../equipment-knowledge-extra.js');

test("equipment-field-evidence : un second passage n'écrit RIEN", async () => {
  const { secondPassage } = await deuxPassages(() => preuves.ensureEquipmentFieldEvidence());
  assert.deepEqual(secondPassage, [],
    `réécriture sans changement : ${secondPassage.map(e => `${e.store}/${e.id}`).join(', ')}`);
});

test("equipment-field-evidence-phase12 : un second passage n'écrit RIEN", async () => {
  const { secondPassage } = await deuxPassages(() => phase12.ensureEquipmentFieldEvidencePhase12());
  assert.deepEqual(secondPassage, [],
    `réécriture sans changement : ${secondPassage.map(e => `${e.store}/${e.id}`).join(', ')}`);
});

test("regie-car-prephoto-readiness : un second passage n'écrit RIEN", async () => {
  const { secondPassage } = await deuxPassages(() => regieCar.ensureRegieCarPrephotoReadiness());
  assert.deepEqual(secondPassage, [],
    `réécriture sans changement : ${secondPassage.map(e => `${e.store}/${e.id}`).join(', ')}`);
});

/* ──────── CONTRE-ÉPREUVE : UNE VRAIE DIFFÉRENCE DOIT, ELLE, PRODUIRE UNE ÉCRITURE ──────── */

test("une différence de CONTENU produit bien une écriture — la porte peut virer au rouge", async () => {
  const base = magasin();
  await preuves.ensureEquipmentFieldEvidence();
  const cible = preuves.FIELD_EVIDENCE_CATALOG_PATCHES[0].id;
  const avant = base.lire('docs', cible);
  assert.ok(avant, `la fiche ${cible} devrait exister après l’ensemencement`);

  // On efface un champ que le producteur RÉTABLIT : c'est une différence réelle.
  base.poser('docs', { ...avant, inventoryAliases: [] });
  const reprise = base.depuis();
  await preuves.ensureEquipmentFieldEvidence();
  const ecrites = base.ecritesDepuis(reprise).filter(e => e.id === cible);
  assert.equal(ecrites.length, 1,
    'une différence de contenu réelle doit produire exactement une écriture — sinon la garde est devenue aveugle');
});

test("un simple réordonnancement des clés, lui, ne produit AUCUNE écriture", async () => {
  const base = magasin();
  await preuves.ensureEquipmentFieldEvidence();
  const cible = preuves.FIELD_EVIDENCE_CATALOG_PATCHES[0].id;
  const avant = base.lire('docs', cible);

  // Le même contenu, rangé dans l'ordre INVERSE de celui de la base.
  const inverse = {};
  for (const clef of Object.keys(avant).reverse()) inverse[clef] = avant[clef];
  base.poser('docs', inverse);

  const reprise = base.depuis();
  await preuves.ensureEquipmentFieldEvidence();
  assert.deepEqual(base.ecritesDepuis(reprise).filter(e => e.id === cible), [],
    'l’ordre des clés ne doit jamais justifier une écriture');
});

/* ─────────── LA CORRECTION QUI SE REDÉCLENCHAIT ÉTERNELLEMENT (kb-leader-lt4448) ─────────── */

const FICHE_LT = Object.freeze({
  id: 'kb-leader-lt4448', kind: 'equipment_catalog', targetType: 'equipment_catalog',
  manufacturer: 'Leader Electronics', model: 'LT 4448', origin: 'seed',
  sourceNote: 'Relevé B01.RF2 — générateur de synchronisation en baie.'
});

async function reconcilier(base) {
  const distant = base.lire('docs', 'kb-leader-lt4448');
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    async json() { return { data: { docs: distant ? [distant] : [] } }; }
  });
  await catalogueExtra.reconcileCentralCatalog();
}

test('la correction du LT4448 s’applique UNE fois, puis se tait', async () => {
  const base = magasin();
  base.poser('docs', FICHE_LT);

  const avant = base.depuis();
  await reconcilier(base);
  const premier = base.ecritesDepuis(avant).filter(e => e.id === 'kb-leader-lt4448');
  assert.equal(premier.length, 1, 'la correction doit bien s’appliquer une première fois');

  const corrigee = base.lire('docs', 'kb-leader-lt4448');
  assert.equal(corrigee.observed, false);
  assert.equal(corrigee.verificationStatus, 'verified-family');
  // La note corrigée CITE toujours B01.RF2 — c'est son propos, et c'est ce qui faisait
  // que la condition de déclenchement restait vraie après la correction.
  assert.ok(String(corrigee.sourceNote).includes('B01.RF2'));
  assert.equal(corrigee.origin, 'seed');

  const reprise = base.depuis();
  await reconcilier(base);
  await reconcilier(base);
  assert.deepEqual(base.ecritesDepuis(reprise).filter(e => e.id === 'kb-leader-lt4448'), [],
    'la correction se redéclenche : elle réécrit une fiche déjà corrigée');
});

test('la correction du LT4448 reste capable d’agir sur une fiche NON corrigée', async () => {
  const base = magasin();
  base.poser('docs', FICHE_LT);
  const reprise = base.depuis();
  await reconcilier(base);
  assert.equal(base.ecritesDepuis(reprise).filter(e => e.id === 'kb-leader-lt4448').length, 1,
    'sans cette écriture, le cas précédent serait vert pour la mauvaise raison');
});

/* ────────── LE CHEMIN D'AMORÇAGE — CELUI QUE LA PREMIÈRE CORRECTION AVAIT MANQUÉ ────────── */

/**
 * DEUX CHEMINS APPLIQUAIENT LA MÊME CORRECTION, ET UN SEUL AVAIT ÉTÉ TENU.
 *
 * `reconcileCentralCatalog()` corrige la fiche DISTANTE à chaque `synced`. Mais
 * `seedExtraCatalog()` — appelé automatiquement au CHARGEMENT du module, lui-même chargé
 * par `index.html` — corrige la fiche LOCALE par `correctLegacyLt4448()`. Rendre le premier
 * idempotent laissait le second réécrire la fiche à chaque chargement de page.
 *
 * Une revue extérieure l'a vu ; l'épreuve précédente ne le voyait pas, parce qu'elle
 * n'exerçait que `reconcileCentralCatalog()`. C'est corrigé ici : les deux chemins passent
 * désormais par `correctionLt4448()`, et les DEUX sont éprouvés.
 */
test('amorçage : seedExtraCatalog corrige le LT4448 UNE fois, puis se tait', async () => {
  const base = magasin();
  base.poser('docs', FICHE_LT);

  const avant = base.depuis();
  await catalogueExtra.seedExtraCatalog();
  const premier = base.ecritesDepuis(avant).filter(e => e.id === 'kb-leader-lt4448');
  assert.equal(premier.length, 1, 'l’amorçage doit bien appliquer la correction une première fois');

  const corrigee = base.lire('docs', 'kb-leader-lt4448');
  // La vérité métier ne bouge pas : la note corrigée CITE toujours la photo B01.RF2 —
  // c'est tout son propos — et l'origine reste « seed ». Ce sont ces deux faits qui
  // maintenaient la condition vraie, et c'est la comparaison, pas eux, qui arrête l'écriture.
  assert.ok(String(corrigee.sourceNote).includes('B01.RF2'),
    'la note corrigée doit continuer de citer la photo B01.RF2');
  assert.equal(corrigee.origin, 'seed', 'l’origine « seed » ne doit pas être réécrite pour faire taire la correction');
  assert.equal(corrigee.observed, false);
  assert.equal(corrigee.verificationStatus, 'verified-family');

  // La base a rangé la fiche en ordre `jsonb`, comme le ferait le serveur : c'est cet
  // état-là que le chargement suivant relira.
  const reprise = base.depuis();
  await catalogueExtra.seedExtraCatalog();
  await catalogueExtra.seedExtraCatalog();
  assert.deepEqual(base.ecritesDepuis(reprise).filter(e => e.id === 'kb-leader-lt4448'), [],
    'le chemin d’amorçage réécrit une fiche déjà corrigée à chaque chargement de page');
});

test('les deux chemins du LT4448 partagent la MÊME règle, ils ne peuvent plus diverger', async () => {
  const base = magasin();
  base.poser('docs', FICHE_LT);

  // L'amorçage corrige…
  await catalogueExtra.seedExtraCatalog();
  const corrigee = base.lire('docs', 'kb-leader-lt4448');

  // …et la réconciliation, sur la même fiche, n'a plus rien à faire.
  const reprise = base.depuis();
  await reconcilier(base);
  assert.deepEqual(base.ecritesDepuis(reprise).filter(e => e.id === 'kb-leader-lt4448'), [],
    'la réconciliation réécrit ce que l’amorçage vient de corriger : les deux chemins divergent');

  // Et la règle elle-même, prise isolément, refuse de réécrire une fiche déjà corrigée.
  assert.equal(catalogueExtra.correctionLt4448(corrigee), null,
    'la règle partagée doit rendre null sur une fiche déjà corrigée');
  assert.ok(catalogueExtra.correctionLt4448(FICHE_LT),
    'et rendre une fiche à écrire sur une fiche non corrigée — sinon elle ne corrige plus rien');
});

test('la règle du LT4448 n’est écrite qu’une fois dans le module', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../equipment-knowledge-extra.js', import.meta.url), 'utf8');
  const notes = source.match(/La photo B01\.RF2 montre un LT4610/g) || [];
  assert.equal(notes.length, 1,
    `la note corrigée est écrite ${notes.length} fois : deux copies d’une correction, c’est deux occasions de diverger`);
  const appels = source.match(/correctionLt4448\(/g) || [];
  assert.equal(appels.length, 3,
    `la règle doit avoir une définition et deux appelants — amorçage et réconciliation — trouvé ${appels.length} occurrences`);
});

/* ─────────── LE REMÈDE N'A PAS RELÂCHÉ LE CONTRAT DE RÉVISION ─────────── */

/**
 * Il y avait plusieurs façons de faire taire ces écritures, et toutes sauf une auraient
 * été des régressions : ignorer le 409, rejouer une écriture périmée, toucher au
 * `_revision`, avaler l'erreur, vider la file, couper la synchronisation, ou désactiver
 * un ensemencement légitime. Aucune n'est employée ici — le remède décide seulement s'il
 * y a lieu d'écrire, et laisse intacte la machinerie qui arbitre les conflits réels.
 *
 * Cette épreuve le vérifie sur les quatre fichiers touchés. Elle ne remplace pas les
 * portes existantes du conflit (`sync-queue-truth`, `conflit-visible`,
 * `concurrence-revision`, `scripts/concurrence-e2e.mjs`) : elle empêche qu'on les
 * contourne DEPUIS ICI.
 */
test('aucun des quatre producteurs ne relâche la révision ni n’avale un conflit', async () => {
  const { readFileSync } = await import('node:fs');
  const fichiers = [
    'equipment-field-evidence.js', 'equipment-field-evidence-phase12.js',
    'equipment-knowledge-extra.js', 'regie-car-prephoto-readiness.js'
  ];
  const interdits = [
    [/STALE_WRITE/, 'un traitement particulier du conflit de révision'],
    [/\b409\b/, 'une réaction au code 409'],
    [/_revision\s*[:=]/, 'une écriture directe de la révision'],
    [/syncQueue/, 'une manipulation de la file de synchronisation'],
    [/disableCentralSync|enableCentralSync/, 'une bascule de la synchronisation centrale']
  ];
  /*
   * On regarde le CODE, pas les commentaires. Ces fichiers racontent longuement l'histoire
   * des 409 de #98 — c'est leur mémoire, et elle doit rester lisible. Une garde qui
   * confondrait ce récit avec du comportement interdirait d'expliquer le défaut qu'elle
   * garde : on retire donc les blocs `/* … *​/` et les lignes de commentaire avant de lire.
   */
  const sansCommentaires = source => source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter(ligne => !/^\s*(\/\/|\*)/.test(ligne))
    .join('\n');

  for (const fichier of fichiers) {
    const code = sansCommentaires(readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8'));
    for (const [motif, quoi] of interdits) {
      assert.ok(!motif.test(code), `${fichier} : ${quoi} est apparu — le remède de #98 ne doit rien relâcher`);
    }
  }
});
