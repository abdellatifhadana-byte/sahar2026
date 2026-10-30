import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMasterTopology } from '../rf-master-import.js';
import { TOPOLOGY_KINDS } from '../topology-contract.js';
import {
  buildProtectedFingerprints,
  findOperationalResiduesInSource
} from '../scripts/public-bundle-residue-guard.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('rf-master-import.js');
const fingerprints = buildProtectedFingerprints(read('scripts/private-operational-data/grille-centrale.js'));

// Payload HÉRITÉ : clés nommées d'après l'installation, telles qu'elles existent déjà chez les
// utilisateurs. Il doit continuer à s'importer à l'identique après le nettoyage du bundle.
const legacyPayload = () => ({
  format:'2m-tech-master-image-extraction', version:5,
  centralGrid190x184:{
    identity:{ location:'BAIE 3 GRILLE CENTRALE', relationshipNote:'Distincte de GRILLE72.' },
    inputsVisible:[{ number:1, label:'VTR 1', confidence:'high', status:'documented' }],
    outputsVisible:[{ number:184, label:'RESERVE 26', confidence:'high', status:'documented' }],
    interfaces:{ sync:[{ port:'SYNCH 1', function:'BLACK', cableRef:'GR1021' }], control:['ENET-1'], monitoringOutputs:[{ name:'MONITORING/OUT.1', segmentRefs:['GR691'] }] },
    controlMonitoringStations:[{ name:'CTRL-STC 1', location:'PUPITRE' }],
    interBayLinks:{ rvBaie1ToBaie2:[{ left:'RV1-GR375', right:'RV6-GR401', via:'GR375 ↔ GR401' }] },
    handwrittenOperationalAnnotations:[{ target:'NEWS 9', annotation:'MUR STC SAT9', status:'observed-handwritten' }]
  },
  grille72OperationalModel:{ manufacturer:'IMAGINE COMMUNICATIONS', model:'PLATINUM VX' }
});

test('rétro-compatibilité: les identifiants générés historiques ne changent pas', () => {
  const topology = buildMasterTopology(legacyPayload());
  const ids = topology[TOPOLOGY_KINDS.ROUTER_PORT].map(port => port.id);
  // Des entityRefs, diagrammes et tickets déjà persistés pointent sur ces identifiants :
  // les renommer casserait silencieusement les données existantes.
  assert.deepEqual(ids, ['gc190-in-001','gc190-out-184']);
  assert.ok(topology[TOPOLOGY_KINDS.ROUTER_INTERFACE].some(item => item.id === 'gc190-if-synch-1'));
  assert.ok(topology[TOPOLOGY_KINDS.ROUTER_INTERFACE].some(item => item.id === 'gc190-station-ctrl-stc-1'));
  assert.ok(topology[TOPOLOGY_KINDS.EVIDENCE].some(item => item.id === 'gc190-handwritten-01'));
  assert.ok(topology[TOPOLOGY_KINDS.RV_LINK][0].id.startsWith('gc190-rv-baie1-to-baie2-'));
});

test('rétro-compatibilité: la provenance persistée reste celle des imports précédents', () => {
  const topology = buildMasterTopology(legacyPayload());
  assert.equal(topology[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-gc190x184').origin, 'master-rf-import-v5');
});

test('rétro-compatibilité: les blocs auxiliaires hérités restent importés avec leur identifiant', () => {
  for (const pattern of [
    /rf-master-bay-/, /rf-master-chassis-/, /rf-master-aux-/, /rf-master-placement-/,
    /rf-master-stc-window-/, /rf-master-plan-/, /rf-master-multiview-/, /rf-master-layer-/,
    /rf-master-source-label-/, /rf-master-zone-/,
    /rf-master-grille72-operational-model/, /rf-master-grille-centrale-190x184-summary/,
    /rf-master-review-required/, /rf_review_required/
  ]) assert.match(source, pattern);
  // `layerKey` avait disparu de l'import : sans lui, la légende des plans n'est plus créée.
  assert.match(source, /payload\.layerKey/);
  assert.match(source, /rf_plan_layer_key/);
});

test('les capacités viennent du payload et ne sont jamais écrites dans le module public', () => {
  const payload = legacyPayload();
  const topology = buildMasterTopology(payload);
  const central = topology[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-gc190x184');
  const secondary = topology[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-grille72');
  assert.equal(central.inputCapacity, 190);
  assert.equal(central.outputCapacity, 184);
  assert.equal(secondary.inputCapacity, 72);
  assert.equal(secondary.outputCapacity, 72);

  // Preuve que la valeur suit le fichier importé au lieu d'être codée en dur : un autre
  // dimensionnement produit d'autres capacités.
  const autre = { format:'2m-tech-master-image-extraction', centralGrid32x16:{ inputsVisible:[] } };
  const central32 = buildMasterTopology(autre)[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-gc190x184');
  assert.equal(central32.inputCapacity, 32);
  assert.equal(central32.outputCapacity, 16);

  assert.doesNotMatch(source, /(?:input|output)Capacity\s*:\s*(?:190|184)\b/);
});

test('une capacité explicite du payload prime sur les dimensions portées par la clé', () => {
  const payload = { format:'2m-tech-master-image-extraction', centralGrid190x184:{ identity:{ inputCapacity:64, outputCapacity:48 } } };
  const central = buildMasterTopology(payload)[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-gc190x184');
  assert.equal(central.inputCapacity, 64);
  assert.equal(central.outputCapacity, 48);
});

test('les noms de blocs neutres sont acceptés comme les noms hérités', () => {
  const payload = {
    format:'2m-tech-master-image-extraction',
    centralGrid:{ identity:{ name:'Grille A', inputCapacity:8, outputCapacity:8 }, inputsVisible:[{ number:2, label:'SRC 2' }] },
    secondaryRouter:{ manufacturer:'ACME' }
  };
  const topology = buildMasterTopology(payload);
  assert.ok(topology[TOPOLOGY_KINDS.ROUTER].some(item => item.id === 'router-gc190x184'));
  assert.ok(topology[TOPOLOGY_KINDS.ROUTER].some(item => item.id === 'router-grille72'));
  assert.equal(topology[TOPOLOGY_KINDS.ROUTER_PORT][0].id, 'gc190-in-002');
});

test('les deux grilles canoniques restent déclarées distinctes sans le préciser dans le payload', () => {
  const topology = buildMasterTopology(legacyPayload());
  const central = topology[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-gc190x184');
  const secondary = topology[TOPOLOGY_KINDS.ROUTER].find(item => item.id === 'router-grille72');
  assert.deepEqual(central.distinctFrom, ['router-grille72']);
  assert.deepEqual(secondary.distinctFrom, ['router-gc190x184']);
});

test('aucune implantation, zone ou référence terrain réelle n’est inventée par le module public', () => {
  // Un payload vide ne doit produire aucune valeur d'installation : tout vient du fichier.
  const central = buildMasterTopology({ format:'2m-tech-master-image-extraction', centralGrid:{} })[TOPOLOGY_KINDS.ROUTER][0];
  assert.equal(central.location, 'À confirmer');
  assert.deepEqual(central.zoneHints, []);
  assert.deepEqual(central.zoneIds, []);
  assert.equal(central.sourceRef, 'Dataset Master importé');
  assert.deepEqual(findOperationalResiduesInSource('rf-master-import.js', source, fingerprints), []);
});

test('la garde accepte les identifiants machine canoniques et les données numériques sans rapport', () => {
  const benign = `
    const routers = ['router-gc190x184', 'kb-grille-centrale-190x184', 'router-grille72'];
    const resolutions = ['1920x1080', '1280x720', '3840x2160'];
    const gamme = ['16×16 à 288×288', '36×36 / 72×72 / 160×160'];
  `;
  assert.deepEqual(findOperationalResiduesInSource('benign.js', benign, fingerprints), []);
});

test('la garde rejette une table d’alias qui réintroduit la capacité sous une clé renommée', () => {
  const evasion = `export const MEDIA_ALIASES = Object.freeze({ 'kb-anonyme': Object.freeze(['GRILLE CENTRALE 190×184']) });`;
  const issues = findOperationalResiduesInSource('equipment-media-linkage.js', evasion, fingerprints);
  assert.ok(issues.length >= 1, 'Renommer la clé ne doit pas suffire à faire passer la donnée.');
});
