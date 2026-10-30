import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manager = read('wall-manager.js');
const permissions = read('permissions.js');
const admin = read('admin-ui.js');
const tech = read('techui.js');
const responsible = read('responsible-ui.js');
const visitor = read('visitor-ui.js');
const visitorIntegration = read('visitor-canonical-integration.js');
const hostIntegration = read('screens-diagnostic-host-integration.js');
const wallInteraction = read('wall-interaction-integration.js');
const css = read('wall.css');
const index = read('index.html');
const worker = read('service-worker.js');

test("Phase 22: un seul gestionnaire canonique porte le Mur d'images et les écrans", () => {
  assert.match(manager, /import \{ normalizeId, normalizePosition, toCanonicalScreen \} from '\.\/wall-model\.js'/);
  assert.match(manager, /PermissionManager\.check\(this\.user, 'walls',/);
  assert.match(manager, /PermissionManager\.check\(this\.user, 'screens',/);
  assert.match(manager, /db\.getAll\('walls'\)/);
  assert.match(manager, /db\.getAll\('screens'\)/);
  assert.match(manager, /wallId/);
  assert.match(manager, /equipmentId/);
  assert.doesNotMatch(index, /wallsManager\.js|mur-dimage-loader\.js/);
  assert.doesNotMatch(worker, /wallsManager\.js|mur-dimage-loader\.js/);
});

test('Phase 22: les six rôles ont le droit de consulter le mur sans élargir les permissions métier', () => {
  // Six rôles désormais : admin, manager, chef, responsable, technicien, visiteur.
  // Tous consultent le mur ; c'est ce qu'ils peuvent y FAIRE qui les sépare.
  const wallViewGrants = permissions.match(/walls:\s*\{\s*view:\s*true/g) || [];
  assert.equal(wallViewGrants.length, 6);
  assert.match(permissions, /technician:[\s\S]*?walls:\s*\{\s*view:\s*true,\s*create:\s*false,\s*edit:\s*false/);
  assert.match(permissions, /visitor:[\s\S]*?walls:\s*\{\s*view:\s*true,\s*create:\s*false,\s*edit:\s*false/);
});

test("Phase 22: Admin et Technicien conservent leur accès canonique au Mur d'images", () => {
  assert.match(admin, /import WallManager from '\.\/wall-manager\.js'/);
  assert.match(admin, /title:\s*["']Mur d'images["']/);
  assert.match(tech, /import WallManager from '\.\/wall-manager\.js'/);
  assert.match(tech, /id="btn-wall"/);
  assert.match(tech, /getElementById\('btn-wall'\)\.onclick\s*=\s*\(\)\s*=>\s*this\.showWall\(\)/);
  assert.match(tech, /onOpenWall:/);
});

test("Phase 22: Responsable dispose d'une section Mur d'images reliée à la carte et au diagnostic", () => {
  assert.match(responsible, /import WallManager from '\.\/wall-manager\.js'/);
  assert.match(responsible, /PermissionManager\.check\(this\.user, 'walls', 'view'\)/);
  assert.match(responsible, /title:\s*["']Mur d'images["']/);
  assert.match(responsible, /async showWall\(\)/);
  assert.match(responsible, /async openWallMap\(\)/);
  assert.match(responsible, /onOpenWall:/);
  assert.match(responsible, /async showScreenDiagnostic\(screenId\)/);
  assert.match(responsible, /selectScreenById\(screenId\)/);
  assert.match(responsible, /Retour au mur d'images/);
});

test("Phase 22: Visiteur peut ouvrir le Mur d'images depuis l'accueil, la carte et la vue salle canonique", () => {
  assert.match(visitor, /import WallManager from '\.\/wall-manager\.js'/);
  assert.match(visitor, /id="visitor-wall-btn"/);
  assert.match(visitor, /> Mur d'images</);
  assert.match(visitor, /async showWall\(roomId = null\)/);
  assert.match(visitor, /onOpenWall:/);
  assert.match(visitorIntegration, /PermissionManager\.check\(this\.user, 'walls', 'view'\)/);
  assert.match(visitorIntegration, /id="visitor-canonical-room-wall"/);
  assert.match(visitorIntegration, /Voir le mur d'images/);
  assert.match(visitorIntegration, /this\.showWall\(room\.id\)/);
});

test("Phase 22: l'éditeur du mur expose la fiche écran canonique sans contourner les permissions", () => {
  assert.match(manager, /const SCREEN_STATUSES = Object\.freeze/);
  for (const label of ['Nom', 'État', 'Type', 'Modèle', 'Numéro de série', 'Équipement associé']) {
    assert.match(manager, new RegExp(label));
  }
  assert.match(manager, /const canEdit = PermissionManager\.check\(this\.user, 'screens', 'edit'\)/);
  assert.match(manager, /Enregistrer la fiche écran/);
  assert.match(manager, /await this\.saveScreen\(/);
  assert.match(manager, /toCanonicalScreen\(screen\)/);
  assert.match(css, /\.wall-screen-form/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('Phase 22: le diagnostic se rafraîchit dans le host de chaque rôle sans casser la navigation', () => {
  assert.match(hostIntegration, /import ScreensDiagnostic from '\.\/screens-diagnostic\.js'/);
  assert.match(hostIntegration, /responsible-screen-diagnostic/);
  assert.match(hostIntegration, /admin-content/);
  assert.match(hostIntegration, /responsible-content/);
  assert.match(hostIntegration, /getElementById\('app'\)/);
  assert.match(hostIntegration, /ScreensDiagnostic\.prototype\.refreshView/);
  const hostPos = index.indexOf('screens-diagnostic-host-integration.js');
  const corePos = index.indexOf('core.js');
  assert.ok(hostPos >= 0 && corePos > hostPos, 'le host diagnostic doit être installé avant core.js');
  assert.match(worker, /'\/screens-diagnostic-host-integration\.js'/);
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache && Number(cache[1]) >= 35);
});

test('Phase 22: les interactions du mur ne multiplient pas les listeners Pan ou Dessin', () => {
  assert.match(wallInteraction, /import WallManager from '\.\/wall-manager\.js'/);
  assert.match(wallInteraction, /this\.__wallPanCanvas === canvas && this\.__wallPanPointerDown/);
  assert.match(wallInteraction, /removeEventListener\('pointerdown', this\.__wallPanPointerDown\)/);
  assert.match(wallInteraction, /if \(this\.drawing\)/);
  assert.match(wallInteraction, /Le mode dessin est déjà actif/);
  const interactionPos = index.indexOf('wall-interaction-integration.js');
  const corePos = index.indexOf('core.js');
  assert.ok(interactionPos >= 0 && corePos > interactionPos, 'les interactions Mur doivent être installées avant core.js');
  assert.match(worker, /'\/wall-interaction-integration\.js'/);
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache && Number(cache[1]) >= 36);
});
