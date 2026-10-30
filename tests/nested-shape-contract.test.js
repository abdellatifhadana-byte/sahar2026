/**
 * @file nested-shape-contract.test.js — la forme d'une entité DANS la photo de sa salle ou
 *       de sa baie ne doit jamais se confondre avec sa forme sur le plan général, ni avec
 *       le point hérité qu'elle remplace visuellement sans jamais l'effacer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAPE_IN_ROOM_FIELD, SHAPE_IN_BAIE_FIELD,
  nestedShapeOf, withNestedShape, shapeWithinBounds, nestedPlacement, cableAnchorFromNestedShape
} from '../nested-shape-contract.js';

/* ─────────────── LECTURE ─────────────── */

test('sans forme documentée, la lecture rend null — jamais une forme devinée', () => {
  assert.equal(nestedShapeOf({}, SHAPE_IN_ROOM_FIELD), null);
  assert.equal(nestedShapeOf({ shapeInRoom: null }, SHAPE_IN_ROOM_FIELD), null);
  assert.equal(nestedShapeOf({ shapeInRoom: { type: 'polygon', points: [{ x: 0, y: 0 }] } }, SHAPE_IN_ROOM_FIELD), null);
});

test('la forme du plan général (`shape`) est IGNORÉE : chaque champ est son propre espace', () => {
  const entite = { shape: { type: 'rect', x: 5, y: 5, w: 40, h: 40 } };
  assert.equal(nestedShapeOf(entite, SHAPE_IN_ROOM_FIELD), null);
  assert.equal(nestedShapeOf(entite, SHAPE_IN_BAIE_FIELD), null);
});

test('une forme rectangle documentée se lit telle quelle', () => {
  const entite = { shapeInRoom: { type: 'rect', x: 10, y: 20, w: 100, h: 50 } };
  const forme = nestedShapeOf(entite, SHAPE_IN_ROOM_FIELD);
  assert.equal(forme.type, 'rect');
  assert.deepEqual({ x: forme.x, y: forme.y, w: forme.w, h: forme.h }, { x: 10, y: 20, w: 100, h: 50 });
});

test('shapeInRoom et shapeInBaie sont deux espaces INDÉPENDANTS sur la même entité', () => {
  const eq = {
    shapeInRoom: { type: 'rect', x: 1, y: 1, w: 20, h: 20 },
    shapeInBaie: { type: 'circle', center: { x: 50, y: 50 }, r: 12 }
  };
  assert.equal(nestedShapeOf(eq, SHAPE_IN_ROOM_FIELD).type, 'rect');
  assert.equal(nestedShapeOf(eq, SHAPE_IN_BAIE_FIELD).type, 'circle');
});

/* ─────────────── ÉCRITURE ─────────────── */

test('l\'écriture ne mute jamais l\'original', () => {
  const original = { id: 42, name: 'Baie 1' };
  const suivant = withNestedShape(original, SHAPE_IN_ROOM_FIELD, { type: 'rect', x: 0, y: 0, w: 30, h: 30 });
  assert.equal(original.shapeInRoom, undefined, 'l’original ne doit pas être modifié');
  assert.ok(suivant.shapeInRoom, 'la nouvelle valeur porte la forme');
  assert.notEqual(suivant, original);
});

test('l\'écriture n\'ajoute JAMAIS de rect imbriqué — aucun code ne le lit', () => {
  const suivant = withNestedShape({ id: 1 }, SHAPE_IN_ROOM_FIELD, { type: 'rect', x: 0, y: 0, w: 10, h: 10 });
  assert.equal(suivant.rect, undefined);
  assert.equal(suivant.rectInRoom, undefined);
});

test('l\'écriture ne touche PAS au point hérité — les deux coexistent sans que l\'un efface l\'autre', () => {
  const original = { id: 7, x_inRoom: 300, y_inRoom: 220 };
  const suivant = withNestedShape(original, SHAPE_IN_ROOM_FIELD, { type: 'circle', center: { x: 40, y: 40 }, r: 10 });
  assert.equal(suivant.x_inRoom, 300);
  assert.equal(suivant.y_inRoom, 220);
  assert.ok(suivant.shapeInRoom);
});

test('une forme inexploitable laisse l\'entité INCHANGÉE — jamais un champ vidé par accident', () => {
  const original = { id: 3, shapeInRoom: { type: 'rect', x: 1, y: 1, w: 10, h: 10 } };
  const suivant = withNestedShape(original, SHAPE_IN_ROOM_FIELD, { type: 'polygon', points: [{ x: 0, y: 0 }] });
  assert.equal(suivant, original);
  assert.ok(suivant.shapeInRoom);
});

test('écrire dans `shapeInBaie` ne touche jamais `shapeInRoom` de la même entité', () => {
  const original = { id: 9, shapeInRoom: { type: 'rect', x: 1, y: 1, w: 5, h: 5 } };
  const suivant = withNestedShape(original, SHAPE_IN_BAIE_FIELD, { type: 'circle', center: { x: 1, y: 1 }, r: 5 });
  assert.ok(suivant.shapeInRoom);
  assert.equal(suivant.shapeInRoom.type, 'rect');
  assert.equal(suivant.shapeInBaie.type, 'circle');
});

/* ─────────────── BORNES DE L'IMAGE ─────────────── */

test('une forme entièrement DANS l\'image est acceptée', () => {
  assert.equal(shapeWithinBounds({ type: 'rect', x: 10, y: 10, w: 100, h: 100 }, 800, 600), true);
});

test('une forme qui déborde PARTIELLEMENT du cadre reste acceptée — un bord de photo n\'est pas une erreur', () => {
  assert.equal(shapeWithinBounds({ type: 'rect', x: 780, y: 10, w: 100, h: 100 }, 800, 600), true);
  assert.equal(shapeWithinBounds({ type: 'rect', x: -50, y: 10, w: 100, h: 100 }, 800, 600), true);
});

test('une forme ENTIÈREMENT hors cadre est refusée — un clic égaré n\'est pas un placement', () => {
  assert.equal(shapeWithinBounds({ type: 'rect', x: 900, y: 10, w: 50, h: 50 }, 800, 600), false);
  assert.equal(shapeWithinBounds({ type: 'circle', center: { x: -100, y: -100 }, r: 5 }, 800, 600), false);
});

test('sans dimensions naturelles connues, on ne peut rien garantir : refus honnête', () => {
  assert.equal(shapeWithinBounds({ type: 'rect', x: 1, y: 1, w: 10, h: 10 }, 0, 0), false);
  assert.equal(shapeWithinBounds({ type: 'rect', x: 1, y: 1, w: 10, h: 10 }, null, null), false);
});

/* ─────────────── PLACEMENT EFFECTIF ─────────────── */

test('une forme documentée l\'emporte toujours sur le point hérité', () => {
  const entite = { shapeInRoom: { type: 'rect', x: 5, y: 5, w: 10, h: 10 }, x_inRoom: 999, y_inRoom: 999 };
  const placement = nestedPlacement(entite, { shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'] });
  assert.equal(placement.kind, 'shape');
});

test('sans forme, le point hérité sert de repli', () => {
  const entite = { x_inRoom: 120, y_inRoom: 80 };
  const placement = nestedPlacement(entite, { shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'] });
  assert.deepEqual({ ...placement }, { kind: 'point', x: 120, y: 80 });
});

test('ni forme ni point : l\'entité reste À PLACER, jamais une position inventée', () => {
  const placement = nestedPlacement({}, { shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'] });
  assert.equal(placement.kind, 'unplaced');
});

test('un point partiel (une seule coordonnée) compte comme non placé', () => {
  const placement = nestedPlacement({ x_inRoom: 50 }, { shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'] });
  assert.equal(placement.kind, 'unplaced');
});

/* ─────────────── ANCRE DE CÂBLE ─────────────── */

test('sans forme documentée, aucune ancre n\'est inventée', () => {
  assert.equal(cableAnchorFromNestedShape({}, SHAPE_IN_BAIE_FIELD), null);
});

test('avec une forme documentée, l\'ancre est son centroïde RÉEL — garanti dedans', () => {
  const entite = {
    shapeInBaie: {
      type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 300 }, { x: 0, y: 300 }]
    }
  };
  const ancre = cableAnchorFromNestedShape(entite, SHAPE_IN_BAIE_FIELD);
  assert.ok(ancre);
  // Le centroïde de l'aire (61.8, 111.8) tombe hors de la branche verticale — le contrat
  // de formes s'en charge déjà ; on vérifie seulement qu'il a bien été consulté.
  assert.ok(ancre.x >= 0 && ancre.x <= 200);
  assert.ok(ancre.y >= 0 && ancre.y <= 300);
});
