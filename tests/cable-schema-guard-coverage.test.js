import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCableRecord } from '../connectivity-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// H-07 — constat inversé. L'audit soupçonnait les gardes serveur d'ignorer les câbles
// écrits à l'ancien schéma plat, parce qu'elles lisent `cable.sourceType` / `sourceId`
// bruts. L'exécution a montré l'inverse : le serveur normalise TOUT câble à l'écriture,
// ces champs sont donc toujours présents, et les deux gardes refusent bien (409).
//
// Il n'y avait rien à corriger — mais la propriété qui rend les gardes correctes est
// implicite, à distance de leur code. Ces tests la verrouillent : si un jour une voie
// d'écriture contourne la normalisation, les gardes redeviendraient aveugles en silence.

test('un câble au schéma plat acquiert type et identifiant canoniques', () => {
  const flat = {
    id: 'CAB-1', reference: 'CAB-1',
    sourceEquipmentId: 'EQ-A', sourcePortId: 'P-OUT-1',
    destinationEquipmentId: 'EQ-B', destinationPortId: 'P-IN-1'
  };
  const value = normalizeCableRecord(flat);
  assert.equal(value.sourceType, 'equipment');
  assert.equal(value.sourceId, 'EQ-A');
  assert.equal(value.destinationType, 'equipment');
  assert.equal(value.destinationId, 'EQ-B');
});

test('un câble vers un écran au schéma plat est typé « screen »', () => {
  const value = normalizeCableRecord({
    id: 'CAB-2', sourceEquipmentId: 'EQ-A', sourcePortId: 'P1',
    destinationScreenId: 'SCR-9', destinationPortId: 'P2'
  });
  assert.equal(value.sourceType, 'equipment');
  assert.equal(value.destinationType, 'screen');
  assert.equal(value.destinationId, 'SCR-9');
});

test('un composant sans parent explicite retombe sur l’équipement porteur', () => {
  const value = normalizeCableRecord({
    id: 'CAB-3', sourceType: 'component', sourceComponentId: 'CMP-1', sourceEquipmentId: 'EQ-A', sourcePortId: 'P1',
    destinationType: 'equipment', destinationId: 'EQ-B', destinationPortId: 'P2'
  });
  assert.equal(value.sourceType, 'component');
  assert.equal(value.sourceId, 'CMP-1');
  // C'est ce repli que lit la garde de suppression d'équipement pour un bout composant.
  assert.equal(value.sourceParentEquipmentId, 'EQ-A');
});

test('toutes les voies d’écriture serveur passent par la normalisation', () => {
  const server = read('scripts/serve.js');
  // Écriture unitaire, import de bootstrap, et mise en quarantaine d'un câble hérité :
  // aucune ne doit persister un enregistrement brut.
  assert.match(server, /if \(storeName === 'cables'\) \{\s*try \{ record = await normalizeIncomingCable\(record, recordId\); \}/);
  assert.match(server, /normalizedCables\.push\(await normalizeIncomingCable\(record, record\.id, \{ lookup, occupiedPorts \}\)\)/);
  assert.match(server, /function quarantineLegacyCable\(record, error\) \{\s*const normalized = normalizeCableRecord\(record\);/,
    'même un câble hérité refusé doit être normalisé avant d’être conservé en preuve');
  assert.match(server, /async function normalizeIncomingCable[\s\S]{0,600}normalizeCableRecord\(shape\.value\)/);
});

test('les gardes serveur couvrent les extrémités équipement, écran et composant', () => {
  const server = read('scripts/serve.js');
  // ensureResourceDeletable : bout direct + bout composant via l'équipement parent.
  assert.match(server, /cable\[`\$\{side\}Type`\] === endpointType && String\(cable\[`\$\{side\}Id`\]\) === String\(id\)/);
  assert.match(server, /cable\[`\$\{side\}Type`\] === 'component' && String\(cable\[`\$\{side\}ParentEquipmentId`\]\) === String\(id\)/);
  // ensureEquipmentConnectivityRetention : port racine et port de composant.
  assert.match(server, /type === 'equipment' && String\(endpointId\) === String\(existing\.id\) && !rootPorts\.has\(portId\)/);
  assert.match(server, /type === 'component' && String\(parentId\) === String\(existing\.id\)/);
});
