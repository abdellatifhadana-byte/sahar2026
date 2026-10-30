import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('serveur: applique le même contrat de connectivité aux équipements, écrans et câbles', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /normalizeIncomingEquipment/);
  assert.match(server, /normalizeIncomingScreen/);
  assert.match(server, /normalizeIncomingCable/);
  assert.match(server, /INCOMPATIBLE_CABLE/);
  assert.match(server, /PORT_ALREADY_CONNECTED/);
  assert.match(server, /stripClientCableIntegrity/);
  assert.match(server, /INVALID_SIGNAL_MODE_FOR_PORTS/);
  assert.match(server, /delete output\[`\$\{side\}ComponentId`\]/);
});

test('serveur: la validation continuité et diagramme passe par des endpoints dédiés', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /\/api\\\/continuity\\\/\(\[\^\/\]\+\)\\\/validate/);
  assert.match(server, /DEDICATED_CONTINUITY_APPROVAL/);
  assert.match(server, /DEDICATED_DIAGRAM_APPROVAL/);
  assert.match(server, /applyContinuityApproval/);
  assert.match(server, /applyDiagramApproval/);
  assert.match(server, /documentRetireMatch/);
  assert.match(server, /document\.retire/);
});

test('accès: sépare lecture, édition et validation des données critiques', () => {
  const access = read('scripts/access-control.js');
  assert.match(access, /continuity\.read/);
  assert.match(access, /continuity\.edit/);
  assert.match(access, /continuity\.validate/);
  assert.match(access, /continuity\.test/);
  assert.match(access, /diagram\.read/);
  assert.match(access, /diagram\.edit/);
  assert.match(access, /diagram\.validate/);
  assert.match(access, /criticalCrossZoneDocument/);
});
