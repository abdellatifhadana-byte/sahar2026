import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const settings = read('settings-contract.js');
const systemSettings = read('system-settings.js');
const compat = read('compat-integrations.js');
const splash = read('startup-splash.js');
const splashCss = read('startup-splash.css');
const core = read('core.js');
const progres = read('startup-progress.js');
const mapFit = read('map-fit-fix.js');
const writeCoherence = read('write-coherence.js');
const visibility = read('data-visibility-recovery.js');
const canonicalDiagram = read('diagram-canonical-authoring.js');
const diagramWorkspace = read('diagram-workspace.js');
const index = read('index.html');
const worker = read('service-worker.js');

test('Phase 19 settings: global is the single canonical settings record and legacy id 1 is migrated away', () => {
  assert.match(settings,/PLATFORM_SETTINGS_ID = 'global'/);
  assert.match(settings,/ensureCanonicalSettings/);
  assert.match(settings,/String\(record\?\.id\) === '1'/);
  assert.match(settings,/await db\.delete\('settings', legacy\.id\)/);
  assert.match(settings,/language: 'fr'/);
  assert.match(systemSettings,/getPlatformSettings/);
  assert.match(systemSettings,/savePlatformSettings/);
  assert.doesNotMatch(compat,/SystemSettings\.prototype\.(?:loadSettings|saveSettings|resetSettings)/);
});

test('Phase 19 map media: the uploaded plan is durable, keeps natural dimensions and supports large files', () => {
  assert.match(systemSettings,/12 \* 1024 \* 1024/);
  assert.match(systemSettings,/naturalWidth/);
  assert.match(systemSettings,/naturalHeight/);
  assert.match(systemSettings,/mapImageWidth/);
  assert.match(systemSettings,/mapImageHeight/);
  assert.match(mapFit,/image\.naturalWidth/);
  assert.match(mapFit,/image\.naturalHeight/);
  assert.match(mapFit,/["']object-fit["']\s*:\s*["']contain["']/);
  assert.doesNotMatch(mapFit,/objectFit\s*=\s*['"]fill['"]/);
  assert.doesNotMatch(mapFit,/["']object-fit["']\s*:\s*["']fill["']/);
  assert.match(mapFit,/mapWorkspaceWidth/);
  assert.match(mapFit,/map-100-btn/);
});

test('Phase 19 writes: media is normalized before central sync receives the payload and is read back after save', () => {
  const normalize = writeCoherence.indexOf('normalizeRecordBeforeWrite');
  const save = writeCoherence.indexOf('previousSave(storeName, normalized');
  const reread = writeCoherence.indexOf("db._getRaw(storeName, id)");
  assert.ok(normalize >= 0 && save > normalize && reread > save);
  assert.match(writeCoherence,/persistableImageValue/);
  assert.match(writeCoherence,/platform-entity-updated/);
  const sync = index.indexOf('src="central-sync.js"');
  const coherence = index.indexOf('src="write-coherence.js"');
  assert.ok(sync >= 0 && coherence > sync, 'write-coherence doit envelopper le writer central déjà installé');
});

test('Phase 19 startup: the legacy spinner is replaced by an assembling/analyzing branded splash tied to real boot stages', () => {
  assert.match(splash,/startup-logo-assembly/);
  assert.match(splash,/startup-logo-(?:piece|segment)/);
  assert.match(splash,/--piece-index/);
  assert.match(splash,/2M TECH PLATFORM/);
  // Les libellés ont rejoint le modèle de progression, aux côtés des poids mesurés : un
  // libellé ne peut plus nommer une étape qui n'existe pas. « Synchronisation de la
  // plateforme » était annoncée APRÈS la synchronisation — jamais affichée une seule image.
  assert.match(progres,/Vérification de la session/);
  assert.match(progres,/Vérification de l’intégrité/);
  assert.match(progres,/Réception des données centrales/);
  assert.match(splashCss,/startup-piece-in/);
  // La ligne de balayage a cédé la place au fond « signal » : nœuds, liaisons
  // orthogonales et impulsions, plus proche d'un acheminement de signal broadcast.
  assert.match(splashCss,/startup-canvas/);
  assert.match(splash,/drawSignalNetwork/);
  // Les pourcentages écrits à la main ont disparu : une étape n'avance la barre qu'en se
  // TERMINANT. `complete` est le seul événement qui la fait progresser.
  assert.match(core,/startupProgress\.complete\('database'\)/);
  assert.match(core,/startupProgress\.complete\('integrity'\)/);
  assert.match(core,/startupProgress\.complete\('session'\)/);
  assert.doesNotMatch(core,/updateStartupSplash\(/);
  assert.match(core,/finishStartupSplash\(\)/);
});

test('Phase 19 diagram authoring: devices, ports and cables created from the schema write to canonical stores', () => {
  assert.match(canonicalDiagram,/db\.save\('equipments', checked\.value\)/);
  assert.match(canonicalDiagram,/validateEquipmentConnectivity/);
  assert.match(canonicalDiagram,/normalizePort/);
  assert.match(canonicalDiagram,/db\.save\('cables'/);
  assert.match(canonicalDiagram,/validateCableShape/);
  assert.match(canonicalDiagram,/evaluateConnection/);
  assert.match(canonicalDiagram,/physicalColor/);
  assert.match(canonicalDiagram,/diagramRouteStyle/);
  assert.match(canonicalDiagram,/requestSubmit\(\)/);
  assert.doesNotMatch(canonicalDiagram,/mapDevice|diagramDeviceRecord/);
});

test('Phase 19 diagram workspace: very large diagrams zoom without an observer feedback loop', () => {
  assert.match(diagramWorkspace,/Math\.min\(50000/);
  assert.match(diagramWorkspace,/data-workspace="fit"/);
  assert.match(diagramWorkspace,/data-workspace="actual"/);
  assert.match(diagramWorkspace,/ctrlKey/);
  assert.match(diagramWorkspace,/observer\.observe\(canvas, \{ childList:true, subtree:false \}\)/);
  assert.doesNotMatch(diagramWorkspace,/attributeFilter:\['style'\]/);
});

test('Phase 19 live coherence: canonical updates refresh only dependent visible sections and defer while editors are open', () => {
  assert.match(visibility,/platform-entity-updated/);
  assert.match(visibility,/sectionNeedsStore/);
  assert.match(visibility,/hasBlockingEditor/);
  assert.match(visibility,/pendingRefresh/);
  assert.match(visibility,/editor-closed-with-pending-data/);
  assert.match(visibility,/platform-canonical-data-changed/);
  assert.match(visibility,/MapDigitalTwin\?\.refresh/);
});

test('Phase 19 shell and PWA include every new coherence runtime before core starts', () => {
  const corePos = index.indexOf('src="core.js"');
  for (const module of ['write-coherence.js','diagram-canonical-authoring.js','diagram-workspace.js','tech-loading-brand.js']) {
    const position = index.indexOf(`src="${module}"`);
    assert.ok(position >= 0 && position < corePos, `${module} doit être chargé avant core.js`);
  }
  for (const asset of [
    '/startup-splash.css','/startup-splash.js','/settings-contract.js','/write-coherence.js',
    '/tech-loading-brand.js','/tech-loading-brand.css','/diagram-canonical-authoring.js','/diagram-workspace.js','/diagram-workspace.css'
  ]) {
    assert.match(worker,new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`asset PWA Phase 19 manquant: ${asset}`);
  }
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache && Number(cache[1]) >= 33);
});
