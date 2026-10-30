import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const permissions = read('permissions.js');
const integration = read('entity-permission-integration.js');
const equipmentIntegration = read('equipment-component-integration.js');
const editor = read('equipment-editor-service.js');
const index = read('index.html');
const worker = read('service-worker.js');

test('Phase 23: le contrat de permissions central est documenté en français et résout les alias avant toute décision', () => {
  assert.doesNotMatch(permissions, /[\u0600-\u06ff]/);
  assert.match(permissions, /contrat central des autorisations 2M TECH/);
  assert.match(permissions, /function resolveRoleKey\(role\)/);
  assert.match(permissions, /normalizeRole\(raw\)/);
  assert.match(permissions, /PERMISSIONS_MATRIX\[resolveRoleKey\(user\.role\)\]/);
  assert.match(permissions, /static updatePermission\(role, entity, action, value\)[\s\S]*?const roleKey = resolveRoleKey\(role\)/);
});

test('Phase 23: Responsable conserve exactement ses droits métier sur équipements, salles et baies', () => {
  assert.match(permissions, /responsible:\s*\{[\s\S]*?equipments:\s*\{\s*view:true,\s*create:true,\s*edit:true,\s*delete:false,\s*changeStatus:true,\s*export:false,\s*import:false\s*\}/);
  assert.match(permissions, /responsible:\s*\{[\s\S]*?rooms:\s*\{\s*view:true,\s*create:false,\s*edit:false,\s*delete:false,\s*assign:false,\s*export:false,\s*import:false\s*\}/);
  assert.match(permissions, /responsible:\s*\{[\s\S]*?baies:\s*\{\s*view:true,\s*create:false,\s*edit:false,\s*delete:false,\s*assign:false,\s*export:false,\s*import:false\s*\}/);
});

test('Phase 23: le contrat protège aussi explicitement import et export', () => {
  assert.match(permissions, /admin:\s*\{[\s\S]*?equipments:\s*\{[^}]*export:true,\s*import:true/);
  assert.match(permissions, /admin:\s*\{[\s\S]*?rooms:\s*\{[^}]*export:true,\s*import:true/);
  assert.match(permissions, /admin:\s*\{[\s\S]*?baies:\s*\{[^}]*export:true,\s*import:true/);
  assert.match(permissions, /technician:\s*\{[\s\S]*?equipments:\s*\{[^}]*export:false,\s*import:false/);
  assert.match(permissions, /visitor:\s*\{[\s\S]*?rooms:\s*\{[^}]*export:false,\s*import:false/);
});

test('Phase 23: la couche de permissions entités enveloppe le patch équipement sécurisé, pas le contraire', () => {
  assert.match(integration, /import '\.\/equipment-component-integration\.js'/);
  assert.match(integration, /import \{ PermissionManager \} from '\.\/permissions\.js'/);
  assert.match(integration, /PermissionManager\.check\(getCurrentUser\(\), entity, action\)/);
  assert.match(equipmentIntegration, /const keyOf = value => db\.normalizeKey/);
  assert.match(editor, /PermissionManager\.check\(user, 'equipments', action\)/);

  const equipmentPos = index.indexOf('src="equipment-component-integration.js"');
  const permissionPos = index.indexOf('src="entity-permission-integration.js"');
  const corePos = index.indexOf('src="core.js"');
  assert.ok(equipmentPos >= 0 && permissionPos > equipmentPos && corePos > permissionPos,
    'equipment-component-integration -> entity-permission-integration -> core.js');
});

test('Phase 23: les actions Équipements sont retirées selon create/edit/delete/export/import', () => {
  assert.match(integration, /removeDenied\('#open-add-eq', 'equipments', 'create'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="edit"\]', 'equipments', 'edit'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="del"\]', 'equipments', 'delete'\)/);
  assert.match(integration, /removeDenied\('#export-eq', 'equipments', 'export'\)/);
  assert.match(integration, /removeDenied\('#import-eq, #import-file', 'equipments', 'import'\)/);
  assert.match(integration, /showEquipementModal = async function permissionAwareEquipmentModal/);
  assert.match(integration, /if \(!allowed\('equipments', action\)\)/);
});

test('Phase 23: les actions Salles sont retirées et les éditeurs directs sont gardés', () => {
  assert.match(integration, /removeDenied\('#add-salle-form', 'rooms', 'create'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="edit"\]', 'rooms', 'edit'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="del"\]', 'rooms', 'delete'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="coord"\]', 'rooms', 'edit'\)/);
  assert.match(integration, /removeDenied\('#export-salles', 'rooms', 'export'\)/);
  assert.match(integration, /removeDenied\('#import-salles, #import-salles-file', 'rooms', 'import'\)/);
  assert.match(integration, /showEditModal = async function permissionAwareRoomEdit/);
  assert.match(integration, /showCoordModal = async function permissionAwareRoomCoordinates/);
});

test('Phase 23: les actions Baies sont retirées et le modal direct est gardé', () => {
  assert.match(integration, /removeDenied\('#add-baie-form', 'baies', 'create'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="edit"\]', 'baies', 'edit'\)/);
  assert.match(integration, /removeDenied\('button\[data-action="del"\]', 'baies', 'delete'\)/);
  assert.match(integration, /removeDenied\('#export-baies', 'baies', 'export'\)/);
  assert.match(integration, /removeDenied\('#import-baies, #import-baies-file', 'baies', 'import'\)/);
  assert.match(integration, /showEditModal = async function permissionAwareBaieEdit/);
});

test('Phase 23: le pruning se produit avant que les composants historiques ne branchent leurs handlers', () => {
  assert.match(integration, /Component\.prototype\.afterRender = async function permissionAwareAfterRender\([\s\S]*?prune\(\);[\s\S]*?originalAfterRender\?\.apply/);
  assert.match(integration, /document\.querySelectorAll\(selector\)\.forEach\(element => element\.remove\(\)\)/);
});

test('Phase 23: le contrat de permissions est disponible hors connexion et ne régresse pas le cache PWA', () => {
  assert.match(worker, /'\/entity-permission-integration\.js'/);
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache && Number(cache[1]) >= 37, `version PWA attendue >= 37, reçue ${cache?.[1] || 'absente'}`);
});
