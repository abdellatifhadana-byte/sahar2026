import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { enPilote, relationsAvecDetail, cablerRelationsDetaillees } from '../pilot-technique-shell.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ops = lire('operations-suite.js');
const css = lire('pilot-technique-preview.css');

/*
 * @file PILOTE-UI-01 — « 3 Écrans » devient un compteur qu'on peut ouvrir.
 *
 * CE QUE CE FICHIER DÉFEND
 * -------------------------
 * `operations-suite.js` calcule déjà, pour chaque équipement, ses écrans liés, ses murs, ses
 * tickets et ses notes — la carte « Relations » de la Fiche 360 n'en montrait que la
 * LONGUEUR. `relationsAvecDetail()` (pilot-technique-shell.js) est PUR : il ne lit ni ne
 * demande aucune donnée, il décide seulement de la présentation d'un tableau déjà construit
 * par l'appelant. On l'exécute donc réellement ici, comme `pilote-creation-repliee.test.js`
 * le fait déjà pour `replierLaCreation`.
 */

const avecCorps = (classes, fn) => {
  const precedent = globalThis.document;
  globalThis.document = { body: { classList: { contains: c => classes.includes(c) } } };
  try { return fn(); } finally { globalThis.document = precedent; }
};

/* ── L'INTERFACE CLASSIQUE REÇOIT EXACTEMENT CE QU'ELLE RECEVAIT ──────────────────── */

test('hors prévisualisation, la carte reste de simples compteurs — aucun bouton, aucune liste', () => {
  const groupes = [
    { cle: 'screens', titre: 'Écrans', items: [{ labelHTML: 'Écran 1' }, { labelHTML: 'Écran 2' }] },
    { cle: 'walls', titre: 'Murs', items: [] }
  ];
  const rendu = avecCorps([], () => relationsAvecDetail(groupes));
  assert.doesNotMatch(rendu, /<button/);
  assert.doesNotMatch(rendu, /ops-relation-list/);
  assert.match(rendu, /<div class="ops-stat"><strong>2<\/strong><span>Écrans<\/span><\/div>/);
  assert.match(rendu, /<div class="ops-stat"><strong>0<\/strong><span>Murs<\/span><\/div>/);
});

/* ── SOUS PRÉVISUALISATION : DES BOUTONS RÉELS, DES LISTES REPLIÉES PAR DÉFAUT ────── */

test('sous prévisualisation, chaque compteur devient un bouton, et sa liste part repliée', () => {
  const groupes = [{ cle: 'tickets', titre: 'Tickets', items: [{ labelHTML: 'TKT-1' }] }];
  const rendu = avecCorps(['pilot-technique-ui'], () => relationsAvecDetail(groupes));
  assert.match(rendu, /<button type="button" class="ops-stat ops-stat-toggle" data-relation-toggle="tickets" aria-expanded="false"><strong>1<\/strong><span>Tickets<\/span><\/button>/);
  assert.match(rendu, /<div class="ops-relation-list" data-relation-list="tickets" hidden>/);
  assert.match(rendu, /<li>TKT-1<\/li>/);
});

test('un groupe vide affiche un état vide honnête, jamais une liste muette', () => {
  const groupes = [{ cle: 'notes', titre: 'Notes', items: [] }];
  const rendu = avecCorps(['pilot-technique-ui'], () => relationsAvecDetail(groupes));
  assert.match(rendu, /<p class="ops-empty">Aucun élément\.<\/p>/);
});

test('les libellés ne sont jamais ré-échappés ni transformés : l’appelant les fournit déjà prêts', () => {
  // `relationsAvecDetail` ne connaît pas la forme d'une entité de la plateforme — lui faire
  // échapper les libellés obligerait chaque appelant à un double-échappement ou à un oubli.
  const groupes = [{ cle: 'x', titre: 'X', items: [{ labelHTML: '<button>déjà construit</button>' }] }];
  const rendu = avecCorps(['pilot-technique-ui'], () => relationsAvecDetail(groupes));
  assert.match(rendu, /<li><button>déjà construit<\/button><\/li>/);
});

/* ── LE DÉPLI/REPLI : UN SEUL ÉCOUTEUR, POSÉ UNE SEULE FOIS ───────────────────────── */

test('cablerRelationsDetaillees bascule hidden et aria-expanded au clic, par délégation', () => {
  const gestionnaires = new Map();
  const bouton = { dataset: { relationToggle: 'screens' }, setAttribute(nom, val) { this._expanded = val; }, getAttribute: () => 'false' };
  const panneau = { hidden: true };
  const racine = {
    dataset: {},
    addEventListener(type, fn) { gestionnaires.set(type, fn); },
    contains: () => true,
    querySelector: sel => sel.includes('data-relation-list') ? panneau : null
  };
  cablerRelationsDetaillees(racine);
  assert.equal(racine.dataset.relationsWired, '1');
  const clic = gestionnaires.get('click');
  assert.ok(clic, 'aucun écouteur de clic posé');

  const evenement = { target: { closest: sel => sel === '[data-relation-toggle]' ? bouton : null } };
  clic(evenement);
  assert.equal(panneau.hidden, false, 'le premier clic doit déplier');
  assert.equal(bouton._expanded, 'true');

  clic(evenement);
  assert.equal(panneau.hidden, true, 'le second clic doit replier');
  assert.equal(bouton._expanded, 'false');
});

test('cablerRelationsDetaillees est idempotent : un second appel ne pose pas un second écouteur', () => {
  let poses = 0;
  const racine = { dataset: {}, addEventListener() { poses += 1; }, contains: () => true, querySelector: () => null };
  cablerRelationsDetaillees(racine);
  cablerRelationsDetaillees(racine);
  assert.equal(poses, 1);
});

/* ── LE POINT D'APPEL RÉEL : AUCUNE NOUVELLE DONNÉE DEMANDÉE ──────────────────────── */

/**
 * LA GARANTIE QUI COMPTE.
 *
 * Les quatre tableaux passés à `relationsAvecDetail` doivent être ceux que
 * `openEquipment360` calcule DÉJÀ pour peupler `relatedScreens`/`relatedWalls`/
 * `relatedTickets`/`relatedNotes` — pas un nouvel appel à `db.getAll`. Ce test lit le point
 * d'appel réel et vérifie qu'aucun `db.getAll` ne s'intercale entre le calcul des quatre
 * listes et leur passage à `relationsAvecDetail`.
 */
test('le point d’appel réel réutilise les quatre listes déjà calculées, sans nouvel appel de données', () => {
  const debut = ops.indexOf('const relatedScreens = screens.filter');
  const fin = ops.indexOf('const groupesRelations = [') + ops.slice(ops.indexOf('const groupesRelations = [')).indexOf('];') + 2;
  assert.ok(debut > 0 && fin > debut, 'point de calcul introuvable — a-t-il été renommé ?');
  const bloc = ops.slice(debut, fin);
  assert.doesNotMatch(bloc, /db\.getAll/, 'un nouvel appel de données a été introduit entre le calcul et le rendu');
  assert.match(bloc, /relatedScreens\.map/);
  assert.match(bloc, /relatedWalls\.map/);
  assert.match(bloc, /relatedTickets\.map/);
  assert.match(bloc, /relatedNotes\.map/);
});

test('un ticket listé ouvre le MÊME openTicket que le reste de la fiche — aucune navigation nouvelle', () => {
  assert.match(ops, /const ticket = relatedTickets\.find\(item => String\(item\.id\) === String\(bouton\.dataset\.ticketId\)\);/);
  assert.match(ops, /if \(ticket\) openTicket\(ticket\);/);
  // `openTicket` est définie UNE fois dans ce module : le point d'appel n'en écrit pas une
  // seconde variante.
  const definitions = ops.match(/function openTicket\(/g) || [];
  assert.equal(definitions.length, 1, 'openTicket ne doit être défini qu’une seule fois');
});

/* ── LE STYLE : LE BOUTON RESSEMBLE À LA CARTE QU’IL REMPLACE, PAS À UN BOUTON PAR DÉFAUT ── */

test('.ops-stat-toggle retire les à-plats par défaut d’un <button> plutôt que d’en ajouter de nouveaux', () => {
  assert.match(css, /body\.pilot-technique-ui \.ops-stat-toggle \{[^}]*cursor:\s*pointer/);
  // `.ops-stat` porte déjà fond/bordure/couleur (vérifié par un autre test) : ce bloc ne
  // doit pas les redéfinir en double, seulement neutraliser le rendu natif du bouton.
  const bloc = css.slice(css.indexOf('.ops-stat-toggle {'), css.indexOf('.ops-stat-toggle {') + 200);
  assert.doesNotMatch(bloc, /background:\s*#|border:\s*\d/);
});
