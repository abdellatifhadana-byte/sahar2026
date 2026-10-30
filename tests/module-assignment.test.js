import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isModuleCard, isModularChassis, validateModuleHierarchy } from '../module-hierarchy-contract.js';

test('inventory cards and openGear chassis are classified without duplication', () => {
  assert.equal(isModuleCard({ inventorySource:{ sheet:'cartes' } }), true);
  assert.equal(isModuleCard({ entityKind:'module-card' }), true);
  assert.equal(isModularChassis({ entityKind:'modular-chassis' }), true);
  assert.equal(isModularChassis({ equipmentProfile:'Châssis modulaire' }), true);
  assert.equal(isModularChassis({ modele:'Ross oGx openGear Frame' }), true);
});

test('module hierarchy rejects missing hosts, location mismatches and slot collisions', () => {
  const equipments = [
    { id:1, name:'OGX-01', entityKind:'modular-chassis', roomId:10, baieId:20 },
    { id:2, name:'CARD-A', entityKind:'module-card', hostEquipmentId:1, slot:'Slot 05', assignmentStatus:'assigned', roomId:10, baieId:20 },
    { id:3, name:'CARD-B', entityKind:'module-card', hostEquipmentId:1, slot:'slot 05', assignmentStatus:'assigned', roomId:10, baieId:20 },
    { id:4, name:'CARD-C', entityKind:'module-card', hostEquipmentId:999, slot:'Slot 01', assignmentStatus:'assigned', roomId:10, baieId:20 },
    { id:5, name:'CARD-D', entityKind:'module-card', hostEquipmentId:1, slot:'Slot 07', assignmentStatus:'assigned', roomId:99, baieId:20 }
  ];
  const errors = validateModuleHierarchy(equipments);
  assert.ok(errors.some(error => error.code === 'SLOT_COLLISION'));
  assert.ok(errors.some(error => error.code === 'HOST_NOT_FOUND'));
  assert.ok(errors.some(error => error.code === 'HOST_LOCATION_MISMATCH'));
});

test('unassigned cards are valid while impossible assigned state is rejected', () => {
  assert.deepEqual(validateModuleHierarchy([
    { id:1, entityKind:'module-card', assignmentStatus:'unassigned-to-chassis', slot:'' }
  ]), []);
  const invalid = validateModuleHierarchy([
    { id:2, name:'CARD-X', entityKind:'module-card', assignmentStatus:'assigned', hostEquipmentId:null }
  ]);
  assert.ok(invalid.some(error => error.code === 'ASSIGNED_WITHOUT_HOST'));
});

test('one hierarchy contract is reused by assignment, import and integrity audit', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const file of ['module-assignment.js','inventory-master.js','data-integrity.js']) {
    const source = fs.readFileSync(`${root}/${file}`, 'utf8');
    assert.match(source, /module-hierarchy-contract\.js/);
  }
});

test('application shell loads assignment and offline cache includes its pure contract', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const index = fs.readFileSync(`${root}/index.html`, 'utf8');
  const worker = fs.readFileSync(`${root}/service-worker.js`, 'utf8');
  assert.match(index, /src="module-assignment\.js"/);
  assert.match(worker, /'\/module-assignment\.js'/);
  assert.match(worker, /'\/module-hierarchy-contract\.js'/);
});
