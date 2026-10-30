import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
/*
 * #137 — LES DONNÉES ONT CHANGÉ D'ADRESSE, PAS DE CONTENU.
 *
 * Le jeu de données Grille Centrale vit désormais sous `scripts/private-operational-data/`,
 * que le serveur refuse de servir. Node y accède, HTTP non : ces vérifications gardent
 * exactement les mêmes valeurs, à leur nouvelle adresse.
 */
import {
  GRILLE_CENTRALE_FIELD_POLICY,
  validateGrilleCentraleFieldEvidence
} from '../grille-centrale-field-verification.js';
import { buildGrilleCentraleDataset } from '../scripts/private-operational-data/grille-centrale.js';

/*
 * La checklist ne se calcule plus à l'import : elle se construit depuis le jeu de données
 * autorisé. Le test la construit donc à partir du même jeu, et vérifie les mêmes 387 cibles.
 */
const dataset = buildGrilleCentraleDataset();

/*
 * VALIDER UNE PREUVE EXIGE DE CONNAÎTRE LA CIBLE, DONC D'Y AVOIR DROIT (#137).
 *
 * `validateGrilleCentraleFieldEvidence` retrouve sa cible dans la checklist, qui vient
 * désormais du jeu de données autorisé. Le test ouvre donc la même porte que le navigateur :
 * une identité, et un réseau qui rend le jeu de données.
 */
globalThis.localStorage = { getItem: cle => (cle === 'auth' ? JSON.stringify({ id:1, authVersion:1 }) : null), setItem() {}, removeItem() {} };
globalThis.fetch = async chemin => (String(chemin).includes('/api/operational/grille-centrale/documented-map')
  ? { ok:true, status:200, json: async () => ({ dataset }) }
  : { ok:false, status:404, json: async () => ({}) });
const { loadGrilleCentraleDataset } = await import('../grille-centrale-dataset.js');
await loadGrilleCentraleDataset();
const GRILLE_CENTRALE_FIELD_TARGETS = [
  ...dataset.documentedPorts.map(port => ({ id:`gc-field-port-${port.id}`, category:'ROUTER_PORT_PHYSICAL_MAPPING' })),
  ...dataset.grObservations.map(observation => ({ id:`gc-field-gr-${observation.id}`, category:'GR_PATCH_PAIR' })),
  ...dataset.monitoringPaths.map(path => ({ id:`gc-field-monitoring-${path.id}`, category:'MONITORING_CURRENT_PATH' })),
  ...dataset.physicalFactTargets
];

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('grille-centrale-field-verification.js');
const hostBridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

test('Phase 14: la checklist couvre tous les ports, repères GR, Monitoring et inconnues physiques', () => {
  assert.equal(GRILLE_CENTRALE_FIELD_TARGETS.length, 387);
  assert.equal(GRILLE_CENTRALE_FIELD_TARGETS.filter(item => item.category === 'ROUTER_PORT_PHYSICAL_MAPPING').length, 374);
  assert.equal(GRILLE_CENTRALE_FIELD_TARGETS.filter(item => item.category === 'GR_PATCH_PAIR').length, 4);
  assert.equal(GRILLE_CENTRALE_FIELD_TARGETS.filter(item => item.id.startsWith('gc-field-monitoring-gc-monitoring-path-')).length, 2);
  for (const id of ['gc-field-core-chassis-sku','gc-field-core-slot-population','gc-field-gr1-port-map','gc-field-gr2-port-map','gc-field-gr3-assignment','gc-field-gr3-protocol-wiring','gc-field-monitoring-endpoints']) {
    assert.ok(GRILLE_CENTRALE_FIELD_TARGETS.some(item => item.id === id), `cible manquante: ${id}`);
  }
});

test('Phase 14: la frontière design 2012 / as-built actuel est contractuelle', () => {
  assert.equal(GRILLE_CENTRALE_FIELD_POLICY.documentaryBaselineImmutable, true);
  assert.equal(GRILLE_CENTRALE_FIELD_POLICY.document2012NeverEqualsCurrentAsBuilt, true);
  assert.equal(GRILLE_CENTRALE_FIELD_POLICY.noActiveCrosspointInference, true);
  assert.equal(GRILLE_CENTRALE_FIELD_POLICY.verifiedRequiresExplicitCurrentFieldEvidence, true);
  assert.deepEqual(GRILLE_CENTRALE_FIELD_POLICY.sourceLayers, ['design-2012','field-evidence','current-as-built','live-routing']);
});

test('Phase 14: le synoptique historique seul ne peut pas valider une cible as-built', () => {
  const result = validateGrilleCentraleFieldEvidence({
    targetId:'gc-field-core-chassis-sku',
    result:'verified',
    verificationMode:'label-read',
    observedAt:'2026-08-16T10:00:00+01:00',
    sourceRef:'DT/EH/11/2011 synoptique 2012',
    claims:['SKU exact lu']
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => /2012 seul/i.test(error)));
});

test('Phase 14: une preuve terrain actuelle explicite est acceptée sans fabriquer de crosspoint', () => {
  const result = validateGrilleCentraleFieldEvidence({
    targetId:'gc-field-core-chassis-sku',
    result:'verified',
    verificationMode:'field-photo',
    observedAt:'2026-08-16T10:00:00+01:00',
    assetRefs:['field-photo-future-001.webp'],
    claims:['Étiquette constructeur lisible sur le châssis']
  });
  assert.equal(result.valid, true);
  assert.doesNotMatch(source, /saveTopologyRecord\(TOPOLOGY_KINDS\.CROSSPOINT/);
  assert.match(source, /currentAsBuiltEvidence:true/);
  assert.match(source, /contradictedEvidenceNeverDeletesHistoricalDocument:true/);
});

test('Phase 14: la Fiche 360 expose la checklist, la recherche, le filtre et exporte sans modifier les faits', () => {
  for (const token of ['Vérification terrain / As-Built','data-gc-field-search','data-gc-field-status','data-gc-field-export','Export checklist','maximum 100']) assert.ok(source.includes(token), `UI manquante: ${token}`);
  assert.match(source, /format:'2m-tech-grille-centrale-field-checklist'/);
  assert.match(source, /baselineAsBuiltClaim:false/);
});

test('Phase 14: le module est chargé après le plan documentaire et reste disponible hors ligne', () => {
  const documented = hostBridge.indexOf("import './grille-centrale-documented-map.js'");
  const field = hostBridge.indexOf("import './grille-centrale-field-verification.js'");
  assert.ok(documented >= 0 && field > documented);
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/grille-centrale-field-verification\.js/);
});
