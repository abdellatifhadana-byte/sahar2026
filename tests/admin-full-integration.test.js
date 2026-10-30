import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin navigation exposes every operational section through one additive patch chain', () => {
  const base = read('admin-ui.js');
  const signalFlow = read('signal-flow.js');
  const continuity = read('continuity-center.js');
  const diagram = read('diagram-studio.js');
  const integrity = read('integrity-center.js');

  for (const section of ['dashboard','screensDiagnostic','walls','devices','salles','baies','users','reports','tickets','logs','settings']) {
    assert.match(base, new RegExp(`${section}:|['"]${section}['"]`), `section admin de base manquante: ${section}`);
  }

  // Les domaines opérationnels sont volontairement additifs: chaque module étend
  // initSections sans dupliquer AdminUI ni exiger une clé legacy dans admin-ui.js.
  assert.match(signalFlow, /AdminUI\.prototype\.initSections = function initSectionsWithSignalFlow/);
  assert.match(signalFlow, /ordered\.signalFlow/);
  assert.match(continuity, /ordered\.continuity/);
  assert.match(diagram, /ordered\.diagrams/);
  assert.match(integrity, /ordered\.integrity/);
});

test('all module scripts referenced by the application shell exist', () => {
  const source = read('index.html');
  const scripts = [...source.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 10);
  for (const script of scripts) assert.equal(fs.existsSync(new URL(`../${script}`, import.meta.url)), true, `module shell introuvable: ${script}`);
});

test('critical admin extensions load before core creates the role interface', () => {
  const source = read('index.html');
  const core = source.indexOf('src="core.js"');
  assert.ok(core > 0);
  for (const module of ['signal-flow.js','continuity-center.js','diagram-studio.js','integrity-center.js']) {
    const position = source.indexOf(`src="${module}"`);
    assert.ok(position > 0 && position < core, `${module} doit être chargé avant core.js`);
  }
});

test('equipment 360 keeps catalog, inventory, modules, ports and internal components visible', () => {
  const source = read('equipment-360-complete.js');
  for (const token of ['catalogId','inventoryKey','inventorySource','hostEquipmentId','module-card','modular-chassis','ports','components','technicalFacts','assignmentStatus','planEvidence']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `champ 360 non exposé: ${token}`);
  }
  assert.match(source, /MutationObserver/);
  assert.match(source, /ops-equipment-360/);
});

test('integrity page runs store, media and canonical graph audits together', () => {
  const source = read('integrity-center.js');
  assert.match(source, /import \{ inspectDataIntegrity \} from '\.\/data-integrity\.js'/);
  assert.match(source, /import \{ inspectPlatformIntegrity \} from '\.\/platform-integrity\.js'/);
  assert.match(source, /inspectDataIntegrity\(\), inspectMediaCoverage\(\), inspectPlatformIntegrity\(\)/);
  assert.match(source, /mergeIntegrityReports\(baseReport, platformAudit\)/);
  assert.match(source, /catalogLinked/);
  assert.match(source, /unassignedModuleCards/);
  assert.match(source, /equipmentConnectivity/);
  assert.match(source, /cableShape/);
  assert.match(source, /Santé du graphe canonique/);
  assert.match(source, /Couverture photos & média/);
  for (const token of ['officialImages','candidates','sourceKnown','modelRequired','needsSource','realPhotoInstances','realPhotoFiles']) {
    assert.match(source, new RegExp(token));
  }
});

test('PWA caches the complete admin integration surface', () => {
  const worker = read('service-worker.js');
  for (const asset of ['/app-dialog-safe-confirm.js','/equipment-360-complete.js','/integrity-center.js','/platform-integrity.js','/inventory-master.js','/inventory-central-install.js','/module-assignment.js','/diagram-studio-advanced.js','/equipment-image-seed.js','/equipment-image-coverage-batch2.js','/equipment-image-coverage-batch3.js','/equipment-image-coverage-batch4.js','/equipment-image-coverage-batch5.js','/equipment-media.js','/equipment-media.css']) {
    assert.match(worker, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `asset PWA manquant: ${asset}`);
  }
});

test('core starts both before and after DOMContentLoaded and never leaves an empty app shell', () => {
  const source = read('core.js');
  assert.match(source, /function startCore\(\)/);
  assert.match(source, /renderStartupShell\(\)/);
  assert.match(source, /new Core\(\)/);
  assert.match(source, /document\.readyState === 'loading'/);
  assert.match(source, /document\.addEventListener\('DOMContentLoaded', startCore, \{ once: true \}\)/);
  assert.match(source, /else \{\s*startCore\(\);\s*\}/);
  assert.match(source, /document\.getElementById\('app'\)/);
});

test('confirmation dialogs are runtime-overridden without a Valeur field', () => {
  const source = read('app-dialog-safe-confirm.js');
  assert.match(source, /export function safeConfirm/);
  assert.match(source, /confirm:\s*safeConfirm/);
  assert.match(source, /window\.__APP_DIALOG_CONFIRM_NO_VALUE__\s*=\s*true/);
  assert.doesNotMatch(source, /Valeur/);
  assert.doesNotMatch(source, /<input|createElement\(['"]input['"]\)/);
});

test('central inventory installer detects real server mode and performs atomic replacement instead of partial bootstrap', () => {
  const source = read('inventory-central-install.js');
  assert.match(source, /api\('\/api\/health'\)/);
  assert.match(source, /health\?\.centralSync === true/);
  assert.match(source, /api\('\/api\/sync'\)/);
  assert.match(source, /api\('\/api\/sync\/inventory-replace'/);
  assert.match(source, /clearOperationalSyncQueue\(\)/);
  assert.match(source, /enableCentralSync\(\{ bootstrapLocal:false \}\)/);
  assert.match(source, /verifyLocalMirror\(prepared\.counts\)/);
  assert.match(source, /inventory-master-imported/);
});

test('service worker registration bypasses HTTP cache and reloads on controller change', () => {
  const source = read('sw-register.js');
  assert.match(source, /updateViaCache:\s*['"]none['"]/);
  assert.match(source, /controllerchange/);
  assert.match(source, /location\.reload/);
});
