import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as geographique from '../location-contract.js';
import * as physique from '../relationship-contract.js';
import contratPhysique from '../relationship-contract.js';

/*
 * UN SEUL NOM POUR DEUX COMPORTEMENTS.
 *
 * `locationBreadcrumb` existait DEUX FOIS, dans deux contrats, avec deux signatures et
 * deux comportements :
 *
 *   location-contract.js      (locationId, locations)  remonte l'arbre géographique
 *   relationship-contract.js  (location)               lit un chemin DÉJÀ résolu
 *
 * Le piège était parfaitement silencieux. Importer la mauvaise ne lève rien : la
 * géographique ne trouve aucun lieu et rend `''` ; la physique lit `undefined.path` à
 * travers `asArray` et rend `''` elle aussi. Aucune exception, aucun avertissement —
 * seulement un fil d'Ariane qui disparaît de l'écran.
 *
 * La MOINS employée a été renommée `physicalPathLabel` : aucun module applicatif ne
 * l'appelait, contre deux pour l'autre.
 */

/* ============================================== le nom ambigu a disparu */

test('« locationBreadcrumb » n’existe plus dans le contrat des relations', () => {
  assert.equal(physique.locationBreadcrumb, undefined, 'le nom ambigu est encore exporté');
  assert.equal(contratPhysique.locationBreadcrumb, undefined, 'le nom ambigu est encore dans l’export par défaut');
  assert.equal(typeof physique.physicalPathLabel, 'function');
  assert.equal(typeof contratPhysique.physicalPathLabel, 'function');
});

test('un seul contrat porte encore ce nom', () => {
  assert.equal(typeof geographique.locationBreadcrumb, 'function');
  // Et c'est bien la même fonction des deux côtés de son propre module : une copie
  // textuelle serait un objet différent et passerait inaperçue.
  assert.equal(geographique.default.locationBreadcrumb, geographique.locationBreadcrumb);
});

/* ============================================== les deux font des choses différentes */

const LIEUX = [
  { id: 'v1', name: 'Casablanca', kind: 'city', parentId: null },
  { id: 'd1', name: 'Régie', kind: 'department', parentId: 'v1' }
];
const CHEMIN_RESOLU = { path: [{ label: 'RF1' }, { label: 'B01.RF1' }, { label: 'Routeur' }] };

test('chacune rend son propre chemin', () => {
  assert.equal(geographique.locationBreadcrumb('d1', LIEUX), 'Casablanca › Régie');
  assert.equal(physique.physicalPathLabel(CHEMIN_RESOLU), 'RF1 › B01.RF1 › Routeur');
});

test('et se trompe SILENCIEUSEMENT sur l’entrée de l’autre — c’était tout le danger', () => {
  // Aucune des deux ne lève : elles rendent une chaîne vide. C'est précisément pourquoi
  // deux fonctions différentes ne pouvaient pas garder le même nom.
  assert.equal(geographique.locationBreadcrumb(CHEMIN_RESOLU, LIEUX), '');
  assert.equal(physique.physicalPathLabel({ id: 'd1' }), '');
});

test('ce sont bien deux objets distincts', () => {
  assert.notEqual(geographique.locationBreadcrumb, physique.physicalPathLabel);
});

/* ============================================== plus aucun appelant de l'ancien nom */

test('aucun module applicatif n’appelle encore l’ancien nom du contrat des relations', () => {
  // `equipment-relations-360.js` était le seul module à l'importer, et il était déjà passé
  // à `fullBreadcrumbPath` — qui joint l'échelle géographique au chemin physique.
  const source = fs.readFileSync(new URL('../equipment-relations-360.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /locationBreadcrumb/);
  const contrat = fs.readFileSync(new URL('../relationship-contract.js', import.meta.url), 'utf8');
  assert.doesNotMatch(contrat, /export function locationBreadcrumb/);
});
