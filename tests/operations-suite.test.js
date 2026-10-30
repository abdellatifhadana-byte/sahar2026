import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la suite exploitation reste additive et utilise les stores existants', async () => {
  const source = await read('operations-suite.js');
  const db = await read('db.js');
  assert.match(source, /kind:\s*'handover'/);
  assert.match(source, /targetType:\s*'room'/);
  assert.match(source, /db\.save\('notes'/);
  assert.match(source, /openEquipment360/);
  assert.match(source, /Signal Flow/);
  assert.match(source, /sourceType/);
  assert.match(source, /destinationType/);
  assert.match(source, /central-sync-status/);
  assert.match(source, /entity=equipment&id=/);
  assert.match(source, /generateQR\(deepLink\)/);
  assert.match(db, /this\.version = 14/);
});

test('les profils opérationnels reçoivent un accès sans remplacer leur navigation métier', async () => {
  const source = await read('operations-suite.js');
  assert.match(source, /patchAdmin\(\)/);
  assert.match(source, /patchResponsible\(\)/);
  assert.match(source, /patchTechnician\(\)/);
  assert.match(source, /Centre d'exploitation/);
  assert.match(source, /Cahier de passation/);
  assert.match(source, /Recherche globale/);
});

test('les assets exploitation sont chargés par la plateforme et le PWA', async () => {
  const index = await read('index.html');
  const worker = await read('service-worker.js');
  assert.match(index, /operations-suite\.css/);
  assert.match(index, /operations-suite\.js/);
  assert.match(worker, /operations-suite\.css/);
  assert.match(worker, /operations-suite\.js/);
});
