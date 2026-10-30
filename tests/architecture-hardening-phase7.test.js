import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const integration = read('equipment-component-integration.js');
const editor = read('equipment-editor-service.js');
const equipment = read('equipements.js');
const index = read('index.html');
const sw = read('service-worker.js');

test('le composant équipements n’est plus lié exclusivement à #admin-content', () => {
  assert.match(equipment, /document\.getElementById\('admin-content'\)/);
  assert.match(integration, /'admin-content', 'responsible-content', 'tech-route-content'/);
  assert.match(integration, /Equipements\.prototype\.refreshList = function refreshInCurrentHost/);
  assert.match(integration, /componentHost\(this\)/);
});

test('ajout et édition passent par l’éditeur canonique qui préserve les relations et images', () => {
  assert.match(integration, /openCanonicalEquipmentEditor/);
  assert.match(integration, /addButton\.onclick = \(\) => openCanonicalEquipmentEditor/);
  assert.match(integration, /await openCanonicalEquipmentEditor\(\{ equipment, notifications:this\.notifications \}\)/);
  assert.match(editor, /normalizeRelationId\(values\.roomId\)/);
  assert.match(editor, /normalizeRelationId\(values\.baieId\)/);
  assert.match(editor, /else if \(Array\.isArray\(existing\?\.images\)\)/);
});

test('les actions équipement résolvent les clés via db.normalizeKey au lieu de forcer Number(id)', () => {
  // Cette assertion exigeait auparavant la PRÉSENCE de `Number(btn.getAttribute('data-id'))`
  // dans equipements.js, c'est-à-dire exactement le défaut que son titre dit interdire.
  // Les identifiants de production sont textuels (« regie-car-b1-ccu1 ») : Number() les
  // transforme en NaN. Le module d'intégration masquait le problème en réassignant les
  // gestionnaires, mais la voie de base restait fausse si ce module ne se chargeait pas.
  assert.doesNotMatch(equipment, /Number\(btn\.getAttribute\('data-id'\)\)/);
  assert.match(equipment, /normalizeRelationId\(btn\.getAttribute\('data-id'\)\)/);
  assert.match(integration, /const keyOf = value => db\.normalizeKey/);
  assert.match(integration, /safeEquipmentById\(button\.dataset\.id\)/);
  assert.match(integration, /db\.deleteEquipmentSafely\(keyOf\(equipment\.id\)\)/);
});

test('la vue rapide de secours écrit les valeurs par textContent et privilégie la Fiche 360', () => {
  assert.match(integration, /window\.TechOperations\?\.openEquipment360/);
  assert.match(integration, /right\.textContent = String\(value \?\? ''\)/);
  assert.doesNotMatch(integration, /<td>\$\{eq\.notes/);
});

test('l’intégration est chargée après le service éditeur, avant la navigation/core, et mise en cache', () => {
  const editorIndex = index.indexOf('src="equipment-editor-service.js"');
  const componentIndex = index.indexOf('src="equipment-component-integration.js"');
  const navigationIndex = index.indexOf('src="role-navigation-integration.js"');
  const coreIndex = index.indexOf('src="core.js"');
  assert.ok(editorIndex >= 0 && componentIndex > editorIndex);
  assert.ok(navigationIndex > componentIndex && coreIndex > navigationIndex);
  assert.match(sw, /\/equipment-component-integration\.js/);
});
