import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pucesActifs } from '../pilot-technique-shell.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const salles = lire('salles.js');
const baies = lire('baies.js');

/*
 * @file PILOTE-UI-01 — Salles et Baies deviennent des inventaires d'actifs.
 *
 * CE QUE CE FICHIER DÉFEND
 * -------------------------
 * « Gestion des Salles » et « Gestion des Baies » ne montraient aucun compte réel : ni
 * baies, ni équipements, ni relation au mur d'images — exactement les faits que le panneau
 * de la carte affiche déjà pour la MÊME salle (`interactive-map.js`, `openPanel('room', …)`).
 * `pucesActifs()` reprend cette grammaire dans les deux listes. Un bogue RÉEL a été commis
 * en l'écrivant : l'appel pour le mur passait son texte dans `valeur` au lieu de
 * `libelleUn`, et la puce affichait « undefined » au lieu de « Aucun mur relié ». Ce test
 * protège spécifiquement contre cette régression-là, pas seulement contre une régression
 * générique.
 */

/* ── `pucesActifs` NE REND QUE SOUS PRÉVISUALISATION : LE MÊME REPÈRE PARTOUT ─────── */

const avecCorps = (classes, fn) => {
  const precedent = globalThis.document;
  globalThis.document = { body: { classList: { contains: c => classes.includes(c) } } };
  try { return fn(); } finally { globalThis.document = precedent; }
};

/* ── LE BOGUE RÉEL, NOMMÉ ─────────────────────────────────────────────────────────── */

test('un élément sans valeur numérique affiche son libellé — jamais « undefined »', () => {
  const rendu = avecCorps(['pilot-technique-ui'], () =>
    pucesActifs([{ icone: 'fa-border-all', libelleUn: 'Aucun mur relié' }]));
  assert.doesNotMatch(rendu, /undefined/,
    'un élément texte doit passer par `libelleUn`, pas par `valeur` — c’est exactement le bogue commis dans salles.js');
  assert.match(rendu, /Aucun mur relié/);
});

test('un élément numérique accorde singulier/pluriel via libelleUn/libelleN', () => {
  const rend = n => avecCorps(['pilot-technique-ui'], () => pucesActifs([{ icone: 'fa-cube', valeur: n, libelleUn: 'baie', libelleN: 'baies' }]));
  assert.match(rend(1), /> 1 baie</);
  assert.match(rend(6), /> 6 baies</);
  assert.match(rend(0), /> 0 baie</);
});

test('sans libelleN, le singulier sert aussi au pluriel plutôt que de rendre "undefined"', () => {
  const rendu = avecCorps(['pilot-technique-ui'], () => pucesActifs([{ icone: 'fa-tv', valeur: 3, libelleUn: 'écran' }]));
  assert.doesNotMatch(rendu, /undefined/);
  assert.match(rendu, /> 3 écran</);
});

test('hors prévisualisation, pucesActifs ne rend rien — les colonnes classiques restent inchangées', () => {
  const rendu = avecCorps([], () => pucesActifs([{ icone: 'fa-cube', valeur: 4, libelleUn: 'baie', libelleN: 'baies' }]));
  assert.equal(rendu, '');
});

test('une liste vide ne rend rien, même sous prévisualisation', () => {
  const rendu = avecCorps(['pilot-technique-ui'], () => pucesActifs([]));
  assert.equal(rendu, '');
});

/* ── LES DEUX POINTS D'APPEL RÉELS : MÊMES COMPTES QUE LE PANNEAU DE LA CARTE ─────── */

test('salles.js compte baies/équipements/mur à partir des tableaux DÉJÀ chargés pour la liste, sans nouvel appel par ligne', () => {
  const debut = salles.indexOf('${filteredRooms.map(salle => {');
  const fin = salles.indexOf('}).join(\'\')}');
  assert.ok(debut > 0 && fin > debut, 'la boucle de rendu des salles a-t-elle changé de forme ?');
  const boucle = salles.slice(debut, fin);
  // `db.getAll` doit apparaître dans `render()` AVANT la boucle (chargement une fois pour
  // toute la liste), jamais À L'INTÉRIEUR d'elle (chargement par ligne).
  assert.doesNotMatch(boucle, /db\.getAll/,
    'un chargement par ligne a été introduit dans la boucle de rendu des salles');
  assert.match(boucle, /baies\.filter\(b => String\(b\.roomId\) === String\(salle\.id\)\)\.length/);
  assert.match(boucle, /equipments\.filter\(eq => String\(eq\.roomId\) === String\(salle\.id\)\)\.length/);
  assert.match(boucle, /walls\.some\(w => String\(w\.roomId\) === String\(salle\.id\)\)/);
});

test('render() charge baies/equipments/walls UNE fois pour toute la liste, dans le même Promise.all que rooms/users/locations', () => {
  const bloc = salles.slice(salles.indexOf('async render() {'), salles.indexOf('this.locations = locations'));
  assert.match(bloc, /Promise\.all\(\[/);
  for (const magasin of ["db.getAll('rooms')", "db.getAll('baies')", "db.getAll('equipments')", "db.getAll('walls')"]) {
    assert.ok(bloc.includes(magasin), `${magasin} doit être chargé dans le même Promise.all`);
  }
});

test('baies.js compte les équipements par baie à partir du tableau déjà chargé, sans nouvel appel par ligne', () => {
  const debut = baies.indexOf('${filteredBaies.map(baie => {');
  const fin = baies.indexOf('}).join(\'\')}');
  assert.ok(debut > 0 && fin > debut, 'la boucle de rendu des baies a-t-elle changé de forme ?');
  const boucle = baies.slice(debut, fin);
  assert.doesNotMatch(boucle, /db\.getAll/);
  assert.match(boucle, /equipments\.filter\(eq => String\(eq\.baieId\) === String\(baie\.id\)\)\.length/);
});

/* ── LES MÊMES COMPTES QUE LE PANNEAU DE LA CARTE, PAS UNE FORMULE DIFFÉRENTE ─────── */

test('le compte de murs suit exactement la même formule que le panneau salle de la carte', () => {
  // interactive-map.js: `walls.find(wall => String(wall.roomId) === String(room.id))`
  // — même comparaison de champs, ici en `.some()` puisqu'on ne veut qu'un booléen.
  const carte = lire('interactive-map.js');
  assert.match(carte, /walls\.find\(wall => String\(wall\.roomId\) === String\(room\.id\)\)/);
});
