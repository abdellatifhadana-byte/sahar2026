import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('index loads technical knowledge, internals, component relations and master import', () => {
  const html = read('index.html');
  for (const asset of [
    'equipment-knowledge.js',
    'equipment-knowledge-extra.js',
    'routing-knowledge-seed.js',
    'equipment-internals.js',
    'equipment-smart-knowledge.js',
    'component-relations.js',
    'rf-master-import.js'
  ]) assert.match(html, new RegExp(asset.replaceAll('.', '\\.')));
});

test('equipment internals persist hardware software and flexible port behavior', () => {
  // La normalisation pure (normalizeComponents, normalizeSoftware, PORT_BEHAVIORS…) vit
  // depuis equipment-internals-contract.js — équipement-internals.js l'importe et la
  // réexporte inchangée, mais ne porte plus ces littéraux dans SON propre texte. Voir ce
  // fichier pour pourquoi (normalizeComponents devait rester testable sans navigateur).
  const source = read('equipment-internals.js') + read('equipment-internals-contract.js');
  assert.match(source, /equipmentProfile/);
  assert.match(source, /components/);
  assert.match(source, /software/);
  assert.match(source, /Réversible \/ brassage manuel/);
  assert.match(source, /bidirectional/);
  assert.match(source, /ports: normalizePortsExtended/);
});

test('cable relations support internal components and manual patching', () => {
  const source = read('component-relations.js');
  assert.match(source, /sourceType === 'component'/);
  assert.match(source, /destinationType === 'component'/);
  assert.match(source, /MANUAL_PATCH/);
  assert.match(source, /sourceParentEquipmentId/);
  assert.match(source, /destinationParentEquipmentId/);
  assert.match(source, /canBeSource/);
  assert.match(source, /canBeDestination/);
});

test('RF master importer is conservative and preserves admin corrections', () => {
  const source = read('rf-master-import.js');
  assert.match(source, /2m-tech-master-image-extraction/);
  assert.match(source, /Déjà présent — correction admin conservée/);
  assert.match(source, /physicalBays/);
  assert.match(source, /chassisFrames/);
  assert.match(source, /devicePlacements/);
  // Les blocs hérités sont reconnus par motif de suffixe, pour rester rétro-compatibles
  // sans recopier un nom d'installation protégé dans un module public.
  assert.match(source, /MonitoringWall\$\/i/);
  assert.match(source, /documentedPlans/);
  assert.match(source, /sourceFrameLabels/);
  assert.match(source, /OtherMultiviewLabels\$\/i/);
  assert.match(source, /layerKey/);
});

test('service worker caches the new integration modules and v15 migration', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /2mtech-v\d+\.\d+/);
  assert.match(sw, /db-migration-v15\.js/);
  assert.match(sw, /equipment-internals\.js/);
  assert.match(sw, /equipment-smart-knowledge\.js/);
  assert.match(sw, /component-relations\.js/);
  assert.match(sw, /rf-master-import\.js/);
  assert.match(sw, /topology-contract\.js/);
});
