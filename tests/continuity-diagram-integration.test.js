import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('interfaces: continuité et schémas sont des modules additifs sans nouveau store dupliqué', async () => {
  const [html, worker, database, continuity, diagrams] = await Promise.all([
    source('index.html'), source('service-worker.js'), source('db.js'), source('continuity-center.js'), source('diagram-studio.js')
  ]);
  assert.match(html, /continuity-center\.js/);
  assert.match(html, /diagram-studio\.js/);
  assert.match(html, /continuity-center\.css/);
  assert.match(html, /diagram-studio\.css/);
  assert.match(worker, /continuity-contract\.js/);
  assert.match(worker, /diagram-contract\.js/);
  assert.match(worker, /technical-graph\.js/);
  assert.doesNotMatch(database, /ensure\('diagrams'/);
  assert.doesNotMatch(database, /ensure\('continuity'/);
  assert.match(continuity, /db\.save\('docs'/);
  assert.match(diagrams, /db\.save\('docs'/);
});

test('continuité: l’exploitation sécurise le direct avant le diagnostic et conserve une preuve', async () => {
  const ui = await source('continuity-center.js');
  assert.match(ui, /Sécuriser le direct/);
  assert.match(ui, /Aucune commande n'est envoyée aux équipements réels/);
  assert.match(ui, /\/api\/continuity\/\$\{encodeURIComponent\(group\.id\)\}\/tests/);
  assert.match(ui, /restoredPrimary/);
  assert.match(ui, /Créer le ticket \/ incident/);
  assert.match(ui, /saveVerifiedDocument/);
});

test('schémas: les nœuds et liaisons restent liés aux entités, ports, câbles et relations réels', async () => {
  const ui = await source('diagram-studio.js');
  assert.match(ui, /entityRef/);
  assert.match(ui, /physical-cable/);
  assert.match(ui, /relationId/);
  assert.match(ui, /Le câble sélectionné ne relie pas ces deux entités/);
  assert.match(ui, /Un schéma validé est immuable/);
  assert.match(ui, /Nouvelle révision/);
  assert.match(ui, /supersedesId/);
  assert.match(ui, /\/api\/diagrams\/\$\{encodeURIComponent\(id\)\}\/validate/);
});

test('serveur: contrôle les références à la création, à la validation, au retrait et à la modification des ports', async () => {
  const server = await source('scripts/serve.js');
  assert.match(server, /validateDiagramReferences/);
  assert.match(server, /validateContinuityReferences/);
  assert.match(server, /ensureResourceDeletable/);
  assert.match(server, /RESOURCE_HAS_TECHNICAL_DEPENDENCIES/);
  assert.match(server, /ensureEquipmentConnectivityRetention/);
  assert.match(server, /EQUIPMENT_CONNECTIVITY_IN_USE/);
  assert.match(server, /INVALID_DIAGRAM_REFERENCES/);
  assert.match(server, /INVALID_CONTINUITY_REFERENCES/);
  assert.match(server, /Cette donnée de continuité validée est immuable/);
  assert.match(server, /Ce schéma validé est immuable/);
  assert.match(server, /validateRevisionLink/);
  assert.match(server, /hasValidatedSuccessor/);
  assert.match(server, /authorId:existing\?\.authorId \?\? user\.id/);
});

test('rôles: technicien consulte et teste, responsable documente et valide', async () => {
  const permissions = await source('permissions.js');
  const access = await source('scripts/access-control.js');
  assert.match(permissions, /continuity:\s*\{\s*view:\s*true,\s*create:\s*false,\s*edit:\s*false,\s*validate:\s*false,\s*test:\s*true\s*\}/);
  assert.match(permissions, /diagrams:\s*\{\s*view:\s*true,\s*create:\s*false,\s*edit:\s*false,\s*validate:\s*false,\s*delete:\s*false\s*\}/);
  assert.match(access, /continuity\.validate/);
  assert.match(access, /continuity\.test/);
  assert.match(access, /diagram\.validate/);
});
