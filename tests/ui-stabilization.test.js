import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('primary creation modals use centered flex layout with internal scrolling and sticky actions', async () => {
  const [equipments, users, tickets, css] = await Promise.all([
    source('equipements.js'),
    source('users.js'),
    source('tickets.js'),
    source('ui-shell-fixes.css')
  ]);

  assert.match(equipments, /modal-content equipment-modal-content/);
  assert.match(equipments, /class="equipment-modal-actions"/);
  assert.match(equipments, /modal\.style\.display = 'flex'/);
  assert.match(users, /modal-content user-modal-content/);
  assert.match(users, /modal\.style\.display = 'flex'/);
  assert.match(tickets, /modal-content ticket-modal-content/);
  assert.match(tickets, /class="ticket-modal-actions"/);
  assert.match(css, /#eq-form[\s\S]*overflow-y: auto/);
  assert.match(css, /#eq-form \.equipment-modal-actions[\s\S]*position: sticky/);
  assert.match(css, /#user-modal #user-form,[\s\S]*#ticket-modal #ticket-form[\s\S]*overflow-y: auto/);
});

test('interactive map has a single close lifecycle wired to application navigation', async () => {
  const [map, admin] = await Promise.all([
    source('interactive-map.js'),
    source('admin-ui.js')
  ]);

  assert.match(map, /export function closeInteractiveMap/);
  assert.match(map, /previousClose\?\.\(\{ notify: false \}\)/);
  assert.match(map, /if \(closed\) return/);
  assert.match(map, /mapCleanup\?\.\(\)/);
  assert.match(map, /closeMap\(\{ notify: false \}\);[\s\S]*onOpenWall/);
  assert.match(admin, /import openInteractiveMap, \{ closeInteractiveMap \}/);
  assert.match(admin, /openTab\(section\) \{\s*closeInteractiveMap\(\{ notify: false \}\)/);
});

test('map fit owns zoom and forces one stable stage transform', async () => {
  const [fit, map] = await Promise.all([
    source('map-fit-fix.js'),
    source('interactive-map.js')
  ]);

  // Le nom passe par `enKebab` : `setProperty` attend la forme CSS d'une propriété, et
  // `setProperty('transformOrigin', …)` n'écrivait rien. L'imposition en `!important`,
  // elle, est inchangée — c'est ce que cette ligne défend.
  assert.match(fit, /element\.style\.setProperty\(enKebab\(property\), value, 'important'\)/);
  assert.match(fit, /const enKebab = propriete => propriete\.replace\(/);
  assert.match(fit, /transform\s*:\s*['"]none['"]/);
  assert.match(fit, /state\.displayScale = state\.baseScale \* state\.zoom/);
  assert.match(fit, /stage\.style\.setProperty\('transform', `translate3d\(/);
  assert.match(fit, /modal\.dataset\.mapDisplayScale = String\(state\.displayScale\)/);
  assert.match(fit, /zoomInButton\.onclick/);
  assert.match(fit, /zoomOutButton\.onclick/);
  assert.match(map, /const eventToCanvasPoint = event =>/);
  assert.match(map, /dx \/ getDisplayScale\(\)/);
});