/**
 * @file tests/conflit-visible.test.js — le refus doit ATTEINDRE l'utilisateur.
 *
 * CE QUI MANQUAIT
 * ---------------
 * Le serveur refuse une écriture périmée, `central-sync.js` la nomme conflit et émet la
 * phrase française qui dit quoi faire. Tout cela ne vaut rien si personne ne l'affiche.
 *
 * Or `notifications.js` ne relayait qu'un seul état :
 *
 *     if (event.detail?.state !== 'warning' || !event.detail?.message) return;
 *
 * Un conflit portant `state:'conflict'` tombait donc dans le vide. La seule trace restante
 * était l'infobulle d'une pastille de statut — visible au survol, sur les pages qui en
 * portent une. Autrement dit : l'utilisateur voyait sa saisie disparaître de l'écran, sans
 * un mot d'explication.
 *
 * C'est pire que l'état d'avant ce lot, où le même refus passait pour un avertissement et
 * était, lui, affiché. Une protection qu'on n'annonce pas ressemble à une panne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_WRITE_MESSAGE, DELETED_ELSEWHERE_MESSAGE } from '../revision-contract.js';

/* ---------------- Un DOM minimal, juste assez pour construire le système ---------------- */

const auditeurs = new Map();
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
    for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement);
    return true;
  }
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const elementFactice = () => ({
  className: '', id: '', textContent: '', innerHTML: '', style: {}, dataset: {}, enfants: [],
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  appendChild(noeud) { this.enfants.push(noeud); return noeud; },
  removeChild() {}, remove() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
});
globalThis.document = {
  createElement: () => elementFactice(),
  body: elementFactice(),
  head: elementFactice(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};

const { NotificationSystem } = await import('../notifications.js');
const systeme = new NotificationSystem();

// On observe l'APPEL au canal visible, pas le rendu : c'est la décision « faut-il le dire ? »
// qui manquait, et c'est elle qu'on éprouve.
const affiches = [];
systeme.showNotification = (message, type) => { affiches.push({ message, type }); };

const emettre = detail => {
  affiches.length = 0;
  window.dispatchEvent(new CustomEvent('central-sync-status', { detail }));
};

test('VIS·1 — un conflit de version est AFFICHÉ, pas seulement émis', () => {
  emettre({ state: 'conflict', message: STALE_WRITE_MESSAGE });
  assert.equal(affiches.length, 1,
    'le refus n’a atteint aucun canal visible : l’utilisateur voit sa saisie disparaître sans explication');
  assert.equal(affiches[0].message, STALE_WRITE_MESSAGE);
});

test('VIS·2 — la phrase affichée dit quoi faire, et jamais « 409 »', () => {
  emettre({ state: 'conflict', message: STALE_WRITE_MESSAGE });
  const { message } = affiches[0];
  assert.match(message, /recharg/i, 'le message doit indiquer le geste à faire');
  assert.doesNotMatch(message, /409|STALE_WRITE/, 'un code de plomberie n’est pas un message d’utilisateur');
});

test('VIS·3 — une suppression concurrente a sa propre phrase, elle aussi affichée', () => {
  emettre({ state: 'conflict', message: DELETED_ELSEWHERE_MESSAGE });
  assert.equal(affiches.length, 1);
  assert.equal(affiches[0].message, DELETED_ELSEWHERE_MESSAGE);
  assert.match(affiches[0].message, /supprim/i);
});

test('VIS·4 — l’avertissement ordinaire reste affiché comme avant', () => {
  // Non-régression : le canal existant ne doit pas être remplacé, seulement élargi.
  emettre({ state: 'warning', message: 'Modification refusée par le serveur: quota dépassé.' });
  assert.equal(affiches.length, 1);
  assert.equal(affiches[0].type, 'warning');
});

test('VIS·5 — un état ordinaire ne déclenche aucune notification', () => {
  // Sinon chaque cycle de synchronisation — toutes les vingt secondes — ferait apparaître
  // une bulle, et le canal deviendrait du bruit que plus personne ne lit.
  for (const state of ['synced', 'offline', 'local', 'unauthenticated']) {
    emettre({ state, message: 'état courant' });
    assert.equal(affiches.length, 0, `l’état « ${state} » ne doit rien afficher`);
  }
});

test('VIS·6 — un conflit sans message ne produit pas une bulle vide', () => {
  emettre({ state: 'conflict' });
  assert.equal(affiches.length, 0, 'une notification vide n’apprend rien et masque le reste');
});
