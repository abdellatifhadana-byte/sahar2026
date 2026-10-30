import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const legacy = read('visitor-ui.js');
const integration = read('visitor-canonical-integration.js');
const index = read('index.html');
const sw = read('service-worker.js');

test('la consultation visiteur conserve le patch canonique et ne réintroduit pas les identifiants numériques forcés', () => {
  assert.match(legacy, /localStorage\.removeItem\('auth'\)/);
  assert.match(legacy, /const id = anchor\.getAttribute\('data-baie'\)/);
  assert.match(legacy, /String\(baie\.id\) === String\(id\)/);
  assert.doesNotMatch(legacy, /Number\(.*data-baie/);
  assert.match(legacy, /Object\.entries\(device\)/);
  assert.match(integration, /VisitorUI\.prototype\.logout = function canonicalVisitorLogout/);
  assert.match(integration, /eventSystem\.dispatch\('logout'\)/);
  assert.match(integration, /VisitorUI\.prototype\.showRoomDetails = async function secureVisitorRoom/);
  assert.match(integration, /VisitorUI\.prototype\.showBaieDetails = async function secureVisitorBaie/);
});

test('les identifiants visiteur restent compatibles avec les clés numériques et texte', () => {
  assert.match(integration, /const same = \(left, right\)/);
  assert.match(integration, /same\(item\.roomId, room\.id\)/);
  assert.match(integration, /same\(item\.baieId, baie\.id\)/);
  assert.match(integration, /db\.normalizeKey \? db\.normalizeKey\(baie\.roomId\)/);
  assert.doesNotMatch(integration, /Number\(.*data-baie/);
});

test('la fiche équipement visiteur privilégie la Fiche 360 et sécurise son fallback', () => {
  assert.match(integration, /window\.TechOperations\?\.openEquipment360/);
  assert.match(integration, /for \(const \[field,value\] of Object\.entries\(device \|\| \{\}\)\)/);
  assert.match(integration, /left\.textContent = field; right\.textContent = String\(value\)/);
  assert.match(integration, /new Set\(\['id','coords','image','images','qr','password','token','secret'\]\)/);
  assert.doesNotMatch(integration, /right\.innerHTML\s*=\s*String\(value\)/);
});

test('les images et hotspots visiteur sont construits avec des nœuds DOM et URL contrôlée', () => {
  assert.match(integration, /function safeImageUrl/);
  assert.match(integration, /data:image\\\//);
  assert.match(integration, /document\.createElement\('img'\)/);
  assert.match(integration, /document\.createElement\('button'\)/);
  assert.match(integration, /button\.title = String\(item\.name \|\| item\.nom/);
  assert.match(integration, /container\.replaceChildren\(wrapper\)/);
});

test("la vue salle visiteur canonique conserve l'accès au Mur d'images sous contrôle des permissions", () => {
  assert.match(integration, /import \{ PermissionManager \} from '\.\/permissions\.js'/);
  assert.match(integration, /PermissionManager\.check\(this\.user, 'walls', 'view'\)/);
  assert.match(integration, /id="visitor-canonical-room-wall"/);
  assert.match(integration, /Voir le mur d'images/);
  assert.match(integration, /this\.showWall\(room\.id\)/);
});

test('le patch visiteur est installé avant Core et disponible dans le cache PWA', () => {
  const visitorPatch = index.indexOf('src="visitor-canonical-integration.js"');
  const rolePatch = index.indexOf('src="role-navigation-integration.js"');
  const core = index.indexOf('src="core.js"');
  assert.ok(visitorPatch >= 0 && rolePatch > visitorPatch && core > rolePatch);
  assert.match(sw, /\/visitor-canonical-integration\.js/);
});
