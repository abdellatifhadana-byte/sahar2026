import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const field = read('equipment-field-evidence.js');
const migration = read('phase11-field-pack-migration.js');
const integration = read('field-evidence-integration.js');
const hostBridge = read('equipment-360-host-bridge.js');
const media = read('equipment-media.js');
/*
 * #137 — LES VALEURS D'INSTALLATION ONT CHANGÉ D'ADRESSE.
 *
 * Elles vivent sous `scripts/private-operational-data/`, que le serveur ne sert pas. Node y
 * accède, HTTP non. Les assertions de contenu lisent donc là ; celles qui portent sur
 * l'écran continuent de lire l'écran.
 */
const grille = read('scripts/private-operational-data/grille-centrale.js');
const topology = read('scripts/private-operational-data/grille-centrale.js');
const grilleEcran = read('grille-centrale-knowledge.js');
const topologyEcran = read('grille-centrale-topology.js');
const { buildGrilleCentraleTopologySeed } = await import('../scripts/private-operational-data/grille-centrale.js');
const routerSeed = buildGrilleCentraleTopologySeed().router;
const { buildGrilleCentraleFieldPhotoConfirmation } = await import('../scripts/private-operational-data/grille-centrale.js');
const confirmation = buildGrilleCentraleFieldPhotoConfirmation();
const worker = read('service-worker.js');
const migrationParts = [
  'assets/field-evidence/2026-08-16/phase11-migration-01.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-02.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-03.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-04.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-05.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-06a.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-06b.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-07a.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-07b.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-08a.b64',
  'assets/field-evidence/2026-08-16/phase11-migration-08b.b64'
];

const legacySegments = [
  [0,19360],[19360,18154],[37514,6872],[44386,11874],[56260,8502],
  [64762,11864],[76626,11126],[87752,10560],[98312,15122],[113434,12704],
  [126138,8240],[134378,10206],[144584,6800],[151384,8044],[159428,5908],
  [165336,7656],[172992,8802],[181794,6418],[188212,7054],[195266,5262]
];

function findCompactSegments(compact) {
  const starts = [];
  for (let offset = 0; offset <= compact.byteLength - 12; offset += 1) {
    if (
      compact.subarray(offset, offset + 4).toString('ascii') === 'RIFF' &&
      compact.subarray(offset + 8, offset + 12).toString('ascii') === 'WEBP'
    ) starts.push(offset);
  }
  assert.equal(starts[0], 0);
  assert.equal(starts.length, 20, `20 signatures RIFF/WEBP attendues, trouvées: ${starts.join(',')}`);
  return starts.map((offset,index) => [offset,(starts[index + 1] ?? compact.byteLength) - offset]);
}

test('Phase 11: les 20 photos terrain sont migrées depuis un pack compact intègre vers le contrat historique', () => {
  assert.match(field, /FIELD_EVIDENCE_PACK_BYTES = 200528/);
  assert.match(field, /\/assets\/field-evidence\/2026-08-16\/2m-field-pack\.bin/);
  assert.match(migration, /PHASE11_FIELD_PACK_COMPACT_BYTES = 27088/);
  assert.match(migration, /PHASE11_FIELD_PACK_LEGACY_BYTES = 200528/);
  assert.match(migration, /PHASE11_FIELD_PACK_IMAGE_COUNT = 20/);
  assert.match(migration, /parseCompactWebpSegments/);
  assert.match(migration, /isWebpStart/);
  assert.match(migration, /padWebpToLegacyLength/);
  assert.match(migration, /0x4a,0x55,0x4e,0x4b/); // JUNK RIFF
  assert.match(migration, /X-2M-Field-Pack-Migration/);

  const encoded = migrationParts.map(path => read(path)).join('').replace(/\s+/g, '');
  const compact = Buffer.from(encoded, 'base64');
  assert.equal(compact.byteLength, 27088);
  const compactSegments = findCompactSegments(compact);
  assert.equal(compactSegments.length, 20);

  let legacyCursor = 0;
  legacySegments.forEach(([offset,targetLength], index) => {
    assert.equal(offset, legacyCursor, `offset legacy ${index + 1}`);
    const [compactOffset,compactLength] = compactSegments[index];
    assert.equal(compact.subarray(compactOffset,compactOffset + 4).toString('ascii'), 'RIFF');
    assert.equal(compact.subarray(compactOffset + 8,compactOffset + 12).toString('ascii'), 'WEBP');
    assert.ok(compactLength <= targetLength, `segment compact ${index + 1} ne doit pas dépasser son segment historique`);
    const padding = targetLength - compactLength;
    assert.ok(padding === 0 || (padding >= 8 && padding % 2 === 0), `padding RIFF impossible pour ${index + 1}: ${padding}`);
    legacyCursor += targetLength;
  });
  assert.equal(legacyCursor, 200528);

  const ids = [...field.matchAll(/\{ id:'2m-field-(\d{2})', offset:(\d+), length:(\d+) \}/g)];
  assert.equal(ids.length, 20);
  let fieldCursor = 0;
  for (let index = 0; index < ids.length; index += 1) {
    assert.equal(Number(ids[index][2]), fieldCursor);
    fieldCursor += Number(ids[index][3]);
  }
  assert.equal(fieldCursor, 200528);
  assert.match(field, /buffer\.byteLength !== FIELD_EVIDENCE_PACK_BYTES/);
  assert.match(field, /Pack preuves terrain invalide/);
});

test('Phase 11: une preuve terrain ne devient jamais une photo constructeur ou une photo instance', () => {
  assert.match(field, /fieldEvidenceImages/);
  assert.match(field, /sourceType:'2m-field-photo'/);
  assert.doesNotMatch(field, /officialImage\s*[:=]/);
  assert.doesNotMatch(field, /equipment\.images\s*=/);
  assert.match(integration, /Elles ne sont jamais affectées automatiquement comme photo de l’instance/);
  assert.match(integration, /ne remplacent jamais une photo constructeur/);
  assert.match(media, /real\[0\] \|\| official \|\| candidates\[0\]/);
  assert.doesNotMatch(media, /fieldEvidenceImages/);
});

test('Phase 11: les références lisibles sur les photos sont documentées sans inventer les variantes', () => {
  for (const token of ['RB-DS2','SPG600','ECO422D','SPG422','X0401H','Artist | DNxIQ','Kaleido QUAD','Kaleido ALTO','VS-81AV','LEDI NETWORK ATS']) {
    assert.ok(field.includes(token), `référence terrain manquante: ${token}`);
  }
  assert.match(field, /HP[^\n]*Z4[^\n]*génération exacte à confirmer/);
  assert.match(field, /HP[^\n]*Z2[^\n]*génération exacte à confirmer/);
  assert.match(field, /PMW-RX50 — identification probable, étiquette à confirmer/);
  assert.match(field, /verificationStatus:'probable'/);
  assert.match(field, /HD Camera Control Unit — modèle exact à confirmer/);
  assert.doesNotMatch(field, /HDCU-2000/);
});

test('Phase 11: la photo CHASSIS 4 élève Harris Platinum de l’hypothèse à la confirmation terrain', () => {
  /*
   * #142 — LA CHARGE DE CONFIRMATION A CHANGÉ D'ADRESSE, PAS DE CONTENU.
   *
   * Ces valeurs étaient affirmées DANS `field-evidence-integration.js`, un module servi à la
   * racine et atteint par le seul `import './…'` que la garde publique ne suivait pas. Le
   * module les écrivait même quand le serveur venait de refuser le jeu de données.
   *
   * La couverture n'est pas retirée : elle est lue là où la valeur vit désormais, et le
   * module public est éprouvé pour son ABSENCE. La frontière autorisé / non autorisé est
   * tenue par `tests/grille-centrale-evidence-boundary.test.js`.
   */
  assert.equal(confirmation.assetId, '2m-field-06');
  assert.equal(confirmation.catalogFields.manufacturerCandidateStatus, 'field-photo-confirmed');
  assert.equal(confirmation.catalogFields.hardwareFamilyCandidateStatus, 'field-photo-confirmed');
  assert.match(confirmation.catalogFacts.map(fact => fact.value).join(' '), /Harris Platinum — famille confirmée terrain ; châssis exact à confirmer/);
  assert.equal(confirmation.catalogFields.fieldHardwareConfirmation.exactChassisConfirmed, false);
  assert.match(confirmation.routerNote, /aucun SKU de châssis, port non documenté ou crosspoint actif n’est déduit/);

  // Le module public ne porte plus ni l'implantation, ni la confirmation matérielle.
  assert.doesNotMatch(integration, /CHASSIS 4/);
  assert.doesNotMatch(integration, /field-photo-confirmed/);
  assert.doesNotMatch(integration, /PLATINUM \| Harris/);
  // Et il ne s'exécute qu'après autorisation.
  assert.match(integration, /peekGrilleCentraleDataset\(\)\?\.knowledgeSeed\?\.fieldPhotoConfirmation/);
  assert.match(integration, /if \(!confirmation\) return \{ authorized:false/);

  assert.match(grille, /190\s*[×x]\s*184/i);
  assert.match(grille, /190\s*[×x]\s*190/i);
  // La capacité se dérive désormais des invariants : on la vérifie sur la fiche produite (#137).
  assert.equal(routerSeed.inputCapacity, 190);
  assert.equal(routerSeed.outputCapacity, 184);
  assert.doesNotMatch(integration, /topology_crosspoint|kind:'crosspoint'|kind:"crosspoint"/i);
});

test('Phase 11: la Fiche 360 expose une section terrain séparée et seulement sur relation catalogue réelle', () => {
  assert.match(integration, /Preuves terrain 2M \(baie \/ famille\)/);
  assert.match(integration, /const catalogId = String\(refreshed\?\.catalogId/);
  assert.match(integration, /catalog\?\.fieldEvidenceImages/);
  assert.match(integration, /resolveFieldEvidenceAsset/);
  assert.match(integration, /requiresFieldConfirmation/);
});

test('Phase 11: le shell installe la migration avant les preuves terrain', () => {
  assert.ok(hostBridge.indexOf("import './phase11-field-pack-migration.js'") < hostBridge.indexOf("import './field-evidence-integration.js'"));
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/equipment-field-evidence\.js/);
  assert.match(worker, /\/phase11-field-pack-migration\.js/);
  assert.match(worker, /\/field-evidence-integration\.js/);
});

test('#78 Phase 0: les segments compacts de la migration ne sont plus précachés', () => {
  /*
   * Cette assertion exigeait la présence de ces chemins dans `ASSETS_TO_CACHE`. C'était
   * exactement la fuite : le pack, ses fragments et les preuves terrain étaient téléchargés
   * d'avance, avant toute session, et restaient lisibles hors ligne après déconnexion. Ils
   * ne sont plus précachés ; `tests/field-evidence-containment.test.js` porte la couverture
   * du confinement lui-même.
   */
  for (const path of migrationParts) assert.ok(!worker.includes(`/${path}`), `segment encore précaché : ${path}`);
  // Le commentaire d'en-tête NOMME le chemin pour expliquer la fermeture ; seule la liste
  // de précache elle-même doit en être exempte.
  const precacheList = worker.slice(worker.indexOf('const ASSETS_TO_CACHE'), worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE')));
  assert.doesNotMatch(precacheList, /assets\/field-evidence/);
});