import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePosition, toCanonicalScreen } from '../wall-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Piège H-08 : un écran de mur portait deux géométries concurrentes — la canonique
// `position: {x,y,width,height}` et le miroir plat `positionX/positionY/width/height`.
// Seule la canonique était réécrite au déplacement et au redimensionnement ; le miroir,
// lu par le plan de salle du Diagnostic écrans, restait figé à la position de création.

const screen = () => ({
  id: 1, name: 'Écran 1', roomId: 1, wallId: 'wall-1', status: 'ok',
  position: { x: 10, y: 20, width: 30, height: 25, unit: '%' },
  positionX: 10, positionY: 20, width: 30, height: 25
});

test('le miroir plat suit le déplacement de la géométrie canonique', () => {
  const moved = toCanonicalScreen({ ...screen(), position: { x: 70, y: 65, width: 30, height: 25, unit: '%' } });
  assert.equal(moved.position.x, 70);
  assert.equal(moved.positionX, 70, 'le miroir plat ne doit pas rester figé à la création');
  assert.equal(moved.positionY, 65);
});

test('le miroir plat suit le redimensionnement', () => {
  const resized = toCanonicalScreen({ ...screen(), position: { x: 10, y: 20, width: 45, height: 40, unit: '%' } });
  assert.equal(resized.width, 45);
  assert.equal(resized.height, 40);
});

test('un écran hérité n’ayant que les champs plats garde ses coordonnées', () => {
  const legacy = { id: 2, name: 'Hérité', status: 'ok', positionX: 42, positionY: 58, width: 12, height: 9 };
  assert.deepEqual(normalizePosition(legacy), { x: 42, y: 58, width: 12, height: 9, unit: '%' });
  assert.equal(toCanonicalScreen(legacy).position.x, 42,
    'sans cette lecture, un écran hérité retombait silencieusement en 0,0');
});

test('la géométrie canonique prime sur le miroir plat quand les deux existent', () => {
  const conflicted = { ...screen(), positionX: 99, positionY: 99 };
  assert.equal(normalizePosition(conflicted).x, 10);
  assert.equal(toCanonicalScreen(conflicted).positionX, 10, 'le miroir est réaligné, pas cru');
});

test('aucune valeur illisible ne peut atteindre une feuille de style', () => {
  const corrupt = normalizePosition({ position: { x: 'abc', y: null, width: undefined, height: NaN } });
  for (const value of [corrupt.x, corrupt.y, corrupt.width, corrupt.height]) {
    assert.ok(Number.isFinite(value), `« left: ${value}% » serait ignoré par le navigateur`);
  }
  assert.deepEqual(corrupt, { x: 0, y: 0, width: 20, height: 20, unit: '%' });
});

test('les bornes restent appliquées', () => {
  const out = normalizePosition({ position: { x: -40, y: 900, width: 0, height: 500 } });
  assert.deepEqual(out, { x: 0, y: 100, width: 1, height: 100, unit: '%' });
});

test('le plan de salle du Diagnostic passe par le contrat de géométrie', () => {
  const diagnostic = read('screens-diagnostic.js');
  assert.match(diagnostic, /import \{ normalizePosition \} from '\.\/wall-model\.js'/);
  assert.doesNotMatch(diagnostic, /left: \$\{screen\.positionX\}/,
    'lire le champ plat brut produisait « left: undefined% » pour tout écran créé hors éditeur de mur');

  const manager = read('wall-manager.js');
  assert.match(manager, /const geometry = normalizePosition\(\{ position \}\)/,
    'la création doit normaliser la géométrie comme le font le déplacement et le redimensionnement');
});
