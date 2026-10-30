/**
 * @file tests/refresh-blocage-editeur.test.js — BLOCK-C-UI-01, l'écran qui ne bouge plus.
 *
 * LE DÉFAUT
 * ---------
 * Batch C a fermé la chaîne jusqu'à l'événement : un changement distant entre en base, et
 * `platform-entity-updated` / `platform-entity-deleted` partent correctement. Le Runtime
 * Gate a pourtant mesuré que `#/devices` n'affichait toujours rien de neuf :
 *
 *   C1   renommage distant : IndexedDB à jour, événement correct, DOM inchangé.
 *   C2-A suppression distante : fiche retirée de la base, événement correct, fantôme à l'écran.
 *
 * La cause est dans `data-visibility-recovery.js::hasBlockingEditor()`. La première ligne
 * traite la simple PRÉSENCE de `#eq-modal`, `#edit-room-modal`, … comme bloquante. Or la
 * page Équipements rend sa fenêtre d'édition À L'INTÉRIEUR de la section
 * (`equipements.js`, `${this.renderModal()}`), avec `style="display:none"`. La fenêtre est
 * donc montée en permanence et cachée : `hasBlockingEditor()` répond VRAI en permanence,
 * et tout rafraîchissement est différé pour toujours.
 *
 * Le repli `.modal`, lui, testait déjà la visibilité correctement. Il ne servait à rien :
 * la première ligne avait déjà tranché.
 *
 * CE QUE CES ÉPREUVES EXIGENT
 * ---------------------------
 * Qu'une fenêtre CACHÉE ne bloque pas, qu'une fenêtre VISIBLE bloque toujours, et qu'une
 * saisie réellement déclarée sale reste protégée. La protection des éditeurs ne doit pas
 * être supprimée — elle doit cesser d'être déclenchée par la présence d'un nœud.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installerDom } from './helpers/mini-dom.js';

const dom = installerDom();
const { document } = dom;

globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, username: 'admin', role: 'admin' }) : null),
  setItem() {}, removeItem() {}
};

/* ------------------------------ Base locale ------------------------------ */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

const { db } = await import('../db.js');
db.open = async () => ({});
db.getAll = async nom => [...table(nom).values()];
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fonction, delai, ...reste) => {
  const minuterie = vraiSetTimeout(fonction, delai, ...reste);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};

const recuperation = await import('../data-visibility-recovery.js');

/* -------------------- Une interface qui compte ses recharges -------------------- */

/*
 * CHAQUE ÉPREUVE A SON INTERFACE, ET SON PROPRE COMPTEUR.
 *
 * Le relais garde un état de module — minuterie, rafraîchissement en attente, dernier
 * passage — et son observateur de DOM peut relancer un rafraîchissement différé pendant
 * l'épreuve suivante. Avec un compteur partagé, on mesurerait le résidu de l'épreuve
 * précédente ; avec un compteur par interface, un passage tardif s'inscrit chez son
 * propriétaire et ne trompe personne.
 */
function poserInterface(section = 'devices') {
  const ui = {
    currentSection: section,
    rechargements: [],
    state: { equipments: [], rooms: [], baies: [] },
    async loadSection(nom) { ui.rechargements.push(nom); },
    async updateStats() {}
  };
  globalThis.__APP = { UIs: { admin: ui } };
  return ui;
}

/** La fenêtre d'édition telle que `equipements.js` la rend : DANS la section, et cachée. */
function monterFenetreCachee() {
  const modale = document.createElement('div');
  modale.id = 'eq-modal';
  modale.className = 'modal';
  modale.setAttribute('style', 'display:none;');
  modale.style.display = 'none';
  document.body.appendChild(modale);
  return modale;
}

function monterFenetreVisible() {
  const modale = document.createElement('div');
  modale.id = 'edit-room-modal';
  modale.className = 'modal';
  modale.setAttribute('style', 'display:flex;');
  modale.style.display = 'flex';
  document.body.appendChild(modale);
  return modale;
}

/** Laisse s'écouler les minuteries de `scheduleRefresh` (180 ms) et le verrou de 700 ms. */
const attendre = (millisecondes = 320) => new Promise(resolve => vraiSetTimeout(resolve, millisecondes));

async function repartirDeZero() {
  for (const noeud of [...document.body.childNodes]) document.body.removeChild(noeud);
  magasins.clear();
  const contrat = await import('../snapshot-diff-contract.js');
  contrat.resetOpenEditors();
  // Le relais s'impose 700 ms entre deux recharges. On laisse ce verrou expirer AVANT
  // d'agir, sinon l'épreuve mesurerait un silence dû au minutage et non à la règle.
  await attendre(820);
}

const changementDistant = (type, storeName, id) =>
  window.dispatchEvent(new globalThis.CustomEvent(type, { detail: { storeName, id, record: { id, name: 'x' } } }));

/* ═══════════ La fenêtre cachée ne doit plus bloquer quoi que ce soit ═══════════ */

test('BLOC·1 — une fenêtre d’édition CACHÉE ne bloque pas le rafraîchissement', async () => {
  await repartirDeZero();
  const ui = poserInterface('devices');
  monterFenetreCachee();

  changementDistant('platform-entity-updated', 'equipments', 'eq-1');
  await attendre();

  assert.deepEqual(ui.rechargements, ['devices'],
    'la page Équipements monte sa fenêtre d’édition cachée en permanence : la traiter comme '
    + 'bloquante fige l’écran pour toujours');
});

test('BLOC·2 — une suppression distante retire le fantôme, fenêtre cachée comprise', async () => {
  await repartirDeZero();
  const ui = poserInterface('devices');
  monterFenetreCachee();

  changementDistant('platform-entity-deleted', 'equipments', 'eq-1');
  await attendre();

  assert.deepEqual(ui.rechargements, ['devices'],
    'la fiche a quitté la base ; sans rechargement elle reste cliquable à l’écran');
});

/* ═══════════ Mais une saisie réelle reste protégée ═══════════ */

test('BLOC·3 — une fenêtre d’édition VISIBLE bloque toujours', async () => {
  await repartirDeZero();
  const ui = poserInterface('salles');
  monterFenetreVisible();

  changementDistant('platform-entity-updated', 'rooms', 'salle-A');
  await attendre();

  assert.deepEqual(ui.rechargements, [],
    'reconstruire la section sous une fenêtre ouverte détruirait le formulaire en cours');
});

test('BLOC·4 — une saisie DÉCLARÉE sale bloque, même sans fenêtre visible', async () => {
  /*
   * Le registre du contrat d'instantané sait exactement quelles fiches portent une saisie
   * non enregistrée. C'est un fait déclaré, pas une présomption tirée du DOM : il doit
   * bloquer le rafraîchissement même si la fenêtre concernée est rendue autrement.
   */
  await repartirDeZero();
  const contrat = await import('../snapshot-diff-contract.js');
  const ui = poserInterface('devices');
  monterFenetreCachee();
  contrat.declareOpenEditor('equipments', 'eq-7', { dirty: true });
  try {
    changementDistant('platform-entity-updated', 'equipments', 'eq-1');
    await attendre();
    assert.deepEqual(ui.rechargements, [],
      'une saisie non enregistrée doit continuer de suspendre le rafraîchissement');
  } finally {
    contrat.releaseOpenEditor('equipments', 'eq-7');
  }
});

test('BLOC·5 — la saisie relâchée, le rafraîchissement en attente repart', async () => {
  await repartirDeZero();
  const contrat = await import('../snapshot-diff-contract.js');
  const ui = poserInterface('devices');
  monterFenetreCachee();
  contrat.declareOpenEditor('equipments', 'eq-7', { dirty: true });
  changementDistant('platform-entity-updated', 'equipments', 'eq-1');
  await attendre();
  assert.deepEqual(ui.rechargements, []);

  contrat.releaseOpenEditor('equipments', 'eq-7');
  // Le relais reprend sur le prochain signal : une fermeture de fenêtre, un retour d'onglet,
  // ou simplement le changement distant suivant.
  changementDistant('platform-entity-updated', 'equipments', 'eq-2');
  await attendre();
  assert.deepEqual(ui.rechargements, ['devices'],
    'le rafraîchissement différé doit finir par avoir lieu, sinon il est perdu');
});

test('BLOC·6 — le plan interactif marqué « modifié » bloque, visible ou non', () => {
  /*
   * `#map-modal.map-digital-dirty` est une DÉCLARATION explicite de saisie en cours, posée
   * par le jumeau cartographique. Elle n'est pas une présomption tirée de la présence d'un
   * nœud, et doit donc continuer de bloquer sans condition de visibilité.
   */
  const source = readFileSync(new URL('../data-visibility-recovery.js', import.meta.url), 'utf8');
  const debut = source.indexOf('function hasBlockingEditor');
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  assert.match(corps, /map-digital-dirty/,
    'la marque de plan modifié doit rester une condition bloquante à part entière');
});
