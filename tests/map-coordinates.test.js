import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  toNaturalCoordinates, toDisplayCoordinates, normalizeMapCoordinates, coordinatesAreResolvable
} from '../map-coordinates-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Piège C-10. Deux conventions incompatibles cohabitaient sur les repères de plan. Les
// équipements enregistraient des pixels de l'image NATURELLE avec ses dimensions, et les
// remettaient à l'échelle — correct. Les salles enregistraient l'écart en pixels par
// rapport à l'image TELLE QU'AFFICHÉE, dans une fenêtre plafonnée à 430 px, sans noter à
// quelle taille : le repère changeait de place dès que le plan s'affichait autrement.

const plan = { naturalWidth: 2000, naturalHeight: 1200 };
const fenêtreDeSaisie = { width: 430, height: 258, left: 100, top: 50 };

test('un clic est enregistré en pixels de l’image naturelle, dimensions comprises', () => {
  const posé = toNaturalCoordinates({
    clientX: fenêtreDeSaisie.left + fenêtreDeSaisie.width / 2,
    clientY: fenêtreDeSaisie.top + fenêtreDeSaisie.height / 2,
    rect: fenêtreDeSaisie, ...plan
  });
  assert.deepEqual(posé, { x: 1000, y: 600, imgNaturalWidth: 2000, imgNaturalHeight: 1200, unit: 'natural-px' });
});

test('le repère ne bouge pas quand l’image s’affiche à une autre taille', () => {
  const posé = { x: 1000, y: 600, imgNaturalWidth: 2000, imgNaturalHeight: 1200 };
  for (const [width, height] of [[430, 258], [860, 516], [1720, 1032]]) {
    const affiché = toDisplayCoordinates(posé, { displayWidth: width, displayHeight: height, ...plan });
    assert.ok(Math.abs(affiché.x - width / 2) < 1e-6, `à ${width} px le repère doit rester au centre`);
    assert.ok(Math.abs(affiché.y - height / 2) < 1e-6);
    assert.equal(affiché.scaled, true);
  }
});

test('un repère hérité, sans dimensions, est repris tel quel plutôt que déplacé', () => {
  // Pixels d'affichage à une échelle jamais notée : les prendre pour des pixels naturels
  // les déplacerait franchement. Mieux vaut la position approximative d'avant.
  const hérité = { x: 215, y: 129 };
  const affiché = toDisplayCoordinates(hérité, { displayWidth: 860, displayHeight: 516, ...plan });
  assert.deepEqual(affiché, { x: 215, y: 129, scaled: false });
  assert.equal(coordinatesAreResolvable(hérité), false);
});

test('les repères d’équipement gardent leur remise à l’échelle historique', () => {
  // Eux ont toujours été posés en pixels naturels : sans dimensions enregistrées, celles
  // de l'image courante sont les bonnes. L'appelant le déclare explicitement.
  const équipement = { x: 1000, y: 600 };
  const affiché = toDisplayCoordinates(équipement, {
    displayWidth: 1000, displayHeight: 600, ...plan, assumeNaturalWhenUnknown: true
  });
  assert.deepEqual(affiché, { x: 500, y: 300, scaled: true });
});

test('un clic hors de l’image est ramené dans ses bornes', () => {
  const horsCadre = toNaturalCoordinates({
    clientX: fenêtreDeSaisie.left + 9999, clientY: fenêtreDeSaisie.top - 9999,
    rect: fenêtreDeSaisie, ...plan
  });
  assert.equal(horsCadre.x, 2000);
  assert.equal(horsCadre.y, 0);
});

test('aucune entrée illisible ne produit de valeur non finie', () => {
  const corrompu = toNaturalCoordinates({
    clientX: 'abc', clientY: null, rect: { width: 0, height: 0, left: 0, top: 0 },
    naturalWidth: NaN, naturalHeight: undefined
  });
  for (const value of [corrompu.x, corrompu.y]) assert.ok(Number.isFinite(value));
  assert.equal(normalizeMapCoordinates({ x: 'abc', y: 2 }), null);
  assert.equal(normalizeMapCoordinates(null), null);
});

test('la normalisation est idempotente', () => {
  const once = normalizeMapCoordinates({ x: 10, y: 20, imgNaturalWidth: 2000, imgNaturalHeight: 1200 });
  assert.deepEqual(normalizeMapCoordinates(once), once);
});

test('les deux voies passent par le contrat, plus par leur propre arithmétique', () => {
  const salles = read('salles.js');
  assert.match(salles, /import \{ toNaturalCoordinates, toDisplayCoordinates, normalizeMapCoordinates \} from '\.\/map-coordinates-contract\.js'/);
  assert.doesNotMatch(salles, /coords\.x = Math\.round\(e\.clientX - rect\.left\)/,
    "l'écart brut en pixels d'affichage perdait son sens dès que le plan changeait de taille");

  const visitor = read('visitor-canonical-integration.js');
  assert.match(visitor, /toDisplayCoordinates\(coords, \{/);
  assert.doesNotMatch(visitor, /Number\(coords\.x \|\| 0\) \* width \/ naturalWidth/,
    'une seule implémentation de la remise à l’échelle, partagée par la saisie et l’affichage');
});
