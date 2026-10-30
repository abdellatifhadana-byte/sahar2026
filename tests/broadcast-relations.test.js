import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

test('relations broadcast support equipment and screen endpoints', () => {
  assert.match(source, /sourceType/);
  assert.match(source, /destinationType/);
  assert.match(source, /sourceScreenId/);
  assert.match(source, /destinationScreenId/);
  assert.match(source, /Équipement/);
  assert.match(source, /Écran/);
});

test('relations persist in the existing cables store', () => {
  assert.match(source, /db\.save\('cables', record\)/);
  assert.match(source, /db\.getAll\('cables'\)/);
  assert.match(source, /Liaison enregistrée et persistée/);
});

test('screen ports are persisted and protected when linked', () => {
  assert.match(source, /db\.save\('screens', updated\)/);
  assert.match(source, /SCREEN_HAS_RELATIONS/);
  assert.match(source, /EQUIPMENT_HAS_RELATIONS/);
  assert.match(source, /Ce port est utilisé par une liaison/);
});

test('relation layer is active and cached by the PWA', () => {
  assert.match(index, /broadcast-relations\.js/);
  assert.match(index, /broadcast-relations\.css/);
  assert.match(sw, /broadcast-relations\.js/);
  assert.match(sw, /broadcast-relations\.css/);
});

test('relation workflow integrates with the interactive map', () => {
  assert.match(source, /openInteractiveMap/);
  assert.match(source, /Afficher sur la carte/);
  assert.match(source, /relation-map-banner/);
});
