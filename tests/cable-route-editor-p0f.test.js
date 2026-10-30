/**
 * @file cable-route-editor-p0f.test.js — LA BARRE DU TRACÉ, EXÉCUTÉE.
 *
 * Ces épreuves montent la barre dans un vrai document — celui de `helpers/mini-dom.js` —
 * cliquent ses boutons, dessinent sur le canevas avec de vrais événements de pointeur, et
 * lisent ce qui a RÉELLEMENT changé. Une épreuve qui se contenterait de relire la source ne
 * dirait pas si un bouton atteint quelqu'un, ni si un point s'est posé au bon endroit.
 *
 * Le serveur est simulé par `fetch`, mais avec les réponses qu'il produit VRAIMENT — celles
 * mesurées par `scripts/cable-route-e2e.mjs`, section 19 comprise. Un câble sans tracé
 * répond `readable: false`, et c'est bien ainsi que ces épreuves le posent.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installerDom } from './helpers/mini-dom.js';

const lireFichier = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

const dom = installerDom();
const { document } = dom;

const { openCableRoutePanel, routeSaveMessage, ROUTE_SAVE_MESSAGES, REFUS_PAR_DEFAUT, SESSION_EXPIREE } =
  await import('../cable-route-editor.js');
const { clearCableRoute, showCableRoute, routeSession, routeAffichee, drawRouteLayer, selectedCable } =
  await import('../cable-route-layer.js');
const { MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL } = await import('../connectivity-contract.js');

/* ─────────────────────────── LE DÉCOR ─────────────────────────── */

const STC = { sceneType: 'room', sceneId: 901 };
const RF1 = { sceneType: 'room', sceneId: 902 };
const CONTEXTE = { rooms: [{ id: 901, name: 'STC' }, { id: 902, name: 'RF1' }], baies: [] };

/* Naturel = espace de dessin : les coordonnées du clic sont celles du relevé, sans détour. */
const segment = (scene, waypoints) => ({
  sceneType: scene.sceneType, sceneId: scene.sceneId,
  naturalWidth: 2000, naturalHeight: 1200, waypoints, anchors: []
});
const ROUTE = {
  version: 1, status: 'verified',
  segments: [segment(STC, [{ x: 100, y: 100 }, { x: 500, y: 300 }]), segment(RF1, [{ x: 10, y: 10 }, { x: 20, y: 20 }])]
};
const CABLE = { id: 'CAB-1', reference: 'CAB-2026-1', _revision: 4 };

const OUVERT = { readable: true, editable: true, creatableHere: true, route: ROUTE, revision: 4 };
/* La réponse RÉELLE d'un câble sans tracé — mesurée, pas supposée. */
const SANS_TRACE = { readable: false, editable: true, creatableHere: true, route: null, revision: 6 };
const TOUT_MASQUE = {
  readable: false, editable: false, creatableHere: true, revision: 9,
  route: { version: 1, status: 'verified', segments: [], partial: true }
};

/** Le serveur du moment. Chaque épreuve dit ce qu'il répond, et rien n'est deviné. */
let reponseServeur = OUVERT;
globalThis.fetch = async () => ({ ok: true, json: async () => reponseServeur });

/** Un canevas qui retient ce qu'on lui demande de dessiner. */
function canevas() {
  const noeud = document.createElement('canvas');
  noeud.width = 2000; noeud.height = 1200;
  noeud.style = {};
  return noeud;
}

let notifs = [];
const notifications = { showNotification: (message, type) => notifs.push({ message, type }) };
let dessins = 0;
let ecritures = [];
let refusProchainEcriture = null;

/*
 * CHAQUE ÉPREUVE PART D'UN DOCUMENT PROPRE.
 *
 * La couche du tracé garde son état au niveau du module, et une épreuve qui échoue laisse
 * sa barre dans le document : la suivante mesurait alors la barre de la précédente, et
 * l'échec se propageait en cascade. On purge donc à l'ENTRÉE, jamais seulement à la sortie.
 */
let courant = null;

function monter({ sceneCourante = STC, overlays = [] } = {}) {
  for (const reste of document.body.querySelectorAll('.route-editor-bar')) reste.parentNode?.removeChild(reste);
  for (const reste of document.body.querySelectorAll('canvas')) reste.parentNode?.removeChild(reste);
  notifs = []; dessins = 0; ecritures = []; refusProchainEcriture = null;
  const toile = canevas();
  document.body.appendChild(toile);
  const panneau = openCableRoutePanel({
    canvas: toile,
    overlays,
    // L'espace de dessin est l'espace naturel : un clic à (300, 200) est le point (300, 200).
    eventToPoint: event => ({ x: event.clientX, y: event.clientY }),
    displayScale: () => 1,
    redraw: () => { dessins += 1; },
    scene: () => sceneCourante,
    context: () => CONTEXTE,
    notifications,
    save: async cable => {
      if (refusProchainEcriture) { const refus = refusProchainEcriture; refusProchainEcriture = null; throw refus; }
      ecritures.push(cable);
      /*
       * LA « FICHE LOCALE COMPLÈTE », ESTAMPILLÉE COMME LE FERAIT `accorderRevision()`.
       *
       * En production, `save` (interactive-map.js) rend `db.get('cables', id)` APRÈS que
       * `central-sync.js` a estampillé la copie locale de la révision que LE SERVEUR vient
       * d'accorder À CETTE écriture — dans la MÊME transaction que la lecture, sans fenêtre
       * pour un tiers. `compareAndWrite` (`scripts/revision-store.js`) incrémente toujours
       * de exactement `courante + 1` ; ce mock fait de même sur la révision ENVOYÉE, jamais
       * sur une autre lue ailleurs. Rendre autre chose qu'un objet romprait
       * `refreshRouteView({ acknowledging })`, qui étale ses champs directement sur
       * `selection.cable`.
       */
      return { ...cable, _revision: (Number(cable._revision) || 0) + 1 };
    }
  });
  courant = panneau;
  return { panneau, toile };
}

/* La barre DE CE panneau — jamais « la première trouvée dans le document ». */
const barre = () => courant.element;
const boutons = () => [...barre().querySelectorAll('button')];
const boutonDit = texte => boutons().find(item => item.textContent.includes(texte)) || null;
const textes = () => boutons().map(item => item.textContent);
const cliquer = async element => {
  assert.ok(element, 'le bouton attendu n\'existe pas');
  const evenement = new globalThis.Event('click', { bubbles: true });
  element.dispatchEvent(evenement);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  /*
   * UN TOUR DE MACROTÂCHE, PAS SEULEMENT TROIS MICROTÂCHES.
   *
   * MESURÉ : un « Enregistrer » réussi chaîne `save()` PUIS `refreshRouteView()` — qui
   * chaîne elle-même `fetchRouteView()` (`fetch` + `.json()`) — avant son `rendre()` final,
   * qui bascule la barre en consultation. Trois microtâches suffisaient à chaque épreuve
   * existante, qui ne relit jamais la barre après un enregistrement complet ; une épreuve
   * qui enchaîne deux tours dans le MÊME panneau, elle, lisait la barre AVANT que ce dernier
   * `rendre()` n'ait tourné, et ne trouvait donc jamais « Modifier le tracé ». Une tâche
   * macro vide la queue de microtâches en ENTIER, quelle que soit sa profondeur de chaînage.
   */
  await new Promise(resolve => setTimeout(resolve, 0));
};
const pointer = (cible, type, { x = 0, y = 0, altKey = false } = {}) => {
  const evenement = new globalThis.Event(type, { bubbles: true });
  Object.assign(evenement, { clientX: x, clientY: y, altKey, pointerId: 1 });
  cible.dispatchEvent(evenement);
};

/*
 * Le démontage est INCONDITIONNEL : une épreuve qui échoue ne doit pas léguer sa barre ni
 * sa session à la suivante. Sans cela, un seul vrai défaut faisait tomber vingt épreuves,
 * et l'on ne voyait plus laquelle disait quelque chose.
 */
afterEach(() => {
  courant?.close?.();
  courant = null;
  clearCableRoute();
  for (const reste of document.body.querySelectorAll('.route-editor-bar')) reste.parentNode?.removeChild(reste);
  delete document.body.dataset.shapeEditing;
});

async function nettoyer(panneau) {
  panneau?.close();
  courant = null;
  clearCableRoute();
  for (const reste of document.body.querySelectorAll('.route-editor-bar')) reste.parentNode?.removeChild(reste);
}

/* ═══════════════════════ CE QUE LA BARRE DIT, ET À QUI ═══════════════════════ */

test('sans câble choisi, la barre existe mais ne dit RIEN', async () => {
  clearCableRoute();
  const { panneau } = monter();
  assert.equal(barre().hidden, true, 'la carte reste la carte');
  assert.equal(boutons().length, 0);
  await nettoyer(panneau);
});

test('un tracé lisible : la référence, la pastille, le parcours, et « Modifier »', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau } = monter();
  assert.equal(barre().querySelector('.route-editor-title').textContent, 'Tracé — CAB-2026-1');
  assert.equal(barre().querySelector('.route-editor-badge').textContent, 'Tracé vérifié');
  // STC → RF1 saute directement d'une salle à l'autre SANS passer par le plan général :
  // aucune scène commune ne documente ce passage (voir cable-route-presentation.js).
  assert.equal(barre().querySelector('.route-editor-sentence').textContent, 'STC → Liaison non cartographiée → RF1');
  assert.deepEqual(textes(), ['Modifier le tracé', 'Fermer']);
  await nettoyer(panneau);
});

test('un tracé AMPUTÉ se lit, ne se modifie pas, et le dit', async () => {
  clearCableRoute();
  reponseServeur = { readable: true, editable: false, creatableHere: true, revision: 4,
    route: { version: 1, status: 'verified', partial: true, segments: [segment(STC, [{ x: 1, y: 1 }, { x: 2, y: 2 }])] } };
  await showCableRoute(CABLE);
  const { panneau } = monter();
  assert.equal(barre().querySelector('.route-editor-badge').textContent, PARTIAL_ROUTE_LABEL);
  assert.deepEqual(textes(), ['Fermer'], 'ni modifier, ni ajouter : il n\'a pas vu le tracé en entier');
  assert.match(barre().querySelector('.route-editor-hint').textContent, /Consultation seule/);
  await nettoyer(panneau);
});

test('un câble SANS tracé propose « Ajouter », et NOMME la scène ouverte', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { scene: STC });
  const { panneau } = monter();
  assert.equal(barre().querySelector('.route-editor-message').textContent, MISSING_ROUTE_LABEL);
  assert.deepEqual(textes(), ['Ajouter un tracé dans STC', 'Fermer']);
  await nettoyer(panneau);
});

test('un tracé HORS PÉRIMÈTRE ne propose PAS d\'en « ajouter » un', async () => {
  clearCableRoute();
  reponseServeur = TOUT_MASQUE;
  await showCableRoute({ id: 'C-CACHE', reference: 'C-CACHE' }, { scene: STC });
  const { panneau } = monter();
  assert.equal(barre().querySelector('.route-editor-message').textContent, PARTIAL_ROUTE_LABEL);
  assert.deepEqual(textes(), ['Fermer'],
    'un cheminement invisible est bien enregistré : « ajouter » l\'écraserait');
  await nettoyer(panneau);
});

/* ═══════════════════════ OUVRIR, DESSINER, ANNULER ═══════════════════════ */

test('« Modifier » ouvre l\'éditeur, et la barre change de visage', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  assert.equal(panneau.isEditing(), true);
  assert.ok(boutonDit('Enregistrer'));
  assert.ok(boutonDit('Annuler'));
  assert.equal(boutonDit('Enregistrer').disabled, true, 'rien n\'a bougé : il n\'y a rien à enregistrer');
  await nettoyer(panneau);
});

test('un clic sur le plan POSE un point, et le dessin le montre', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  const avant = routeSession().selectedSegment().waypoints.length;
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  assert.equal(routeSession().selectedSegment().waypoints.length, avant + 1);
  assert.deepEqual(routeSession().selectedSegment().waypoints.at(-1), { x: 900, y: 700 });
  assert.equal(boutonDit('Enregistrer').disabled, false, 'maintenant il y a quelque chose à enregistrer');
  await nettoyer(panneau);
});

test('tirer une poignée DÉPLACE le point, et lui seul', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  // Le premier point du passage STC est à (100, 100) : on l'attrape et on l'emmène.
  pointer(toile, 'pointerdown', { x: 100, y: 100 });
  pointer(toile, 'pointermove', { x: 640, y: 480 });
  pointer(document, 'pointerup', { x: 640, y: 480 });
  const points = routeSession().selectedSegment().waypoints;
  assert.deepEqual(points[0], { x: 640, y: 480 });
  assert.deepEqual(points[1], { x: 500, y: 300 }, 'le voisin n\'a pas bougé');
  assert.equal(points.length, 2, 'tirer un point n\'en crée pas un autre');
  await nettoyer(panneau);
});

test('Alt+clic sur une poignée RETIRE le point', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 100, y: 100, altKey: true });
  assert.deepEqual(routeSession().selectedSegment().waypoints, [{ x: 500, y: 300 }]);
  await nettoyer(panneau);
});

test('modifier la géométrie retire le « vérifié », et la barre le dit TOUT DE SUITE', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  assert.equal(barre().querySelector('.route-editor-badge').textContent, 'Tracé vérifié');
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  assert.equal(barre().querySelector('.route-editor-badge').textContent, 'Tracé proposé',
    'une vérification n\'a pas eu lieu : l\'écran ne doit pas prétendre le contraire');
  await nettoyer(panneau);
});

test('ANNULER restitue l\'instantané au caractère près, et n\'écrit rien', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  pointer(toile, 'pointerdown', { x: 950, y: 750 });
  await cliquer(boutonDit('Annuler'));
  assert.equal(panneau.isEditing(), false);
  assert.deepEqual(routeAffichee().segments[0].waypoints, [{ x: 100, y: 100 }, { x: 500, y: 300 }]);
  assert.equal(routeAffichee().status, 'verified', 'le « vérifié » revient : il n\'a jamais été retiré du relevé');
  assert.equal(ecritures.length, 0);
  await nettoyer(panneau);
});

/* ═══════════════ L'ORDRE DES PASSAGES EST UNE AFFIRMATION PHYSIQUE ═══════════════ */

test('« Ouvrir un passage ici » insère au rang CHOISI, sans déplacer les autres', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  const choix = barre().querySelector('[data-role="insertion"]');
  assert.ok(choix, 'le choix de position doit être proposé, pas supposé');
  assert.deepEqual([...choix.querySelectorAll('option')].map(item => item.textContent),
    ['Avant STC', 'Entre STC et RF1', 'Après RF1']);

  // « Entre STC et RF1 » — rang absolu 1.
  choix.value = '1';
  choix.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  await cliquer(boutonDit('Ouvrir un passage ici'));

  const sequence = routeSession().sequence();
  assert.deepEqual(sequence.map(etape => `${etape.sceneType}#${etape.sceneId}`),
    ['room#901', 'room#901', 'room#902'], 'le nouveau passage s\'intercale, RF1 reste APRÈS');
  assert.equal(sequence[1].waypoints, 0, 'un passage neuf est vide : rien ne le raccorde à ses voisins');
  await nettoyer(panneau);
});

test('la position d\'insertion CHOISIE survit aux redessins', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  const choix = barre().querySelector('[data-role="insertion"]');
  choix.value = '0';
  choix.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  // La barre est reconstruite à chaque point posé : le choix ne doit pas glisser.
  pointer(toile, 'pointerdown', { x: 800, y: 600 });
  assert.equal(barre().querySelector('[data-role="insertion"]').value, '0');
  await cliquer(boutonDit('Ouvrir un passage ici'));
  assert.equal(routeSession().sequence()[0].waypoints, 0, 'le passage neuf est bien EN TÊTE');
  assert.equal(routeSession().sequence()[1].sceneType, 'room');
  await nettoyer(panneau);
});

test('plusieurs passages dans la MÊME scène : on choisit celui qu\'on travaille', async () => {
  clearCableRoute();
  reponseServeur = { ...OUVERT, route: { version: 1, status: 'proposed', segments: [
    segment(STC, [{ x: 100, y: 100 }, { x: 200, y: 200 }]),
    segment(RF1, [{ x: 10, y: 10 }, { x: 20, y: 20 }]),
    segment(STC, [{ x: 700, y: 700 }, { x: 800, y: 800 }])
  ] } };
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  const passages = barre().querySelector('[data-role="passage"]');
  assert.ok(passages, 'une salle traversée deux fois doit être désambiguïsée');
  assert.deepEqual([...passages.querySelectorAll('option')].map(item => item.textContent), ['STC (1)', 'STC (2)']);

  passages.value = '1';
  passages.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  pointer(toile, 'pointerdown', { x: 900, y: 900 });
  const sequence = routeSession().sequence();
  assert.deepEqual(sequence.map(etape => etape.waypoints), [2, 2, 3],
    'le point est allé dans le SECOND passage de STC, pas dans le premier');
  await nettoyer(panneau);
});

/* ═══════════════════════ ENREGISTRER, ET LES REFUS ═══════════════════════ */

test('ENREGISTRER écrit le câble ENTIER, une seule fois', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(ecritures.length, 1, 'une seule écriture, jamais un fragment par segment');
  const ecrit = ecritures[0];
  assert.equal(ecrit.id, 'CAB-1');
  assert.equal(ecrit.reference, 'CAB-2026-1', 'le reste du câble part tel quel');
  assert.equal(ecrit._revision, 4, 'la révision est celle de la copie SYNCHRONISÉE');
  assert.equal(ecrit.route.segments[0].waypoints.length, 3);
  assert.equal(notifs.at(-1).type, 'success');
  assert.equal(panneau.isEditing(), false);
  await nettoyer(panneau);
});

test('409 STALE_WRITE : la phrase exacte, l\'éditeur RESTE ouvert, le dessin est intact', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  refusProchainEcriture = Object.assign(new Error('conflit'), { status: 409, code: 'STALE_WRITE' });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(notifs.at(-1).type, 'error');
  assert.equal(notifs.at(-1).message, ROUTE_SAVE_MESSAGES.STALE_WRITE);
  assert.equal(panneau.isEditing(), true, 'on ne jette pas le travail de quelqu\'un sur un refus');
  assert.equal(routeSession().selectedSegment().waypoints.length, 3);
  assert.equal(ecritures.length, 0);
  await nettoyer(panneau);
});

test('un second ENREGISTRER, MÊME panneau, part de la révision que LE PREMIER vient de produire', async () => {
  /*
   * REPRODUIT LE DÉFAUT MESURÉ (faux 409 STALE_WRITE au second « Enregistrer ») AU NIVEAU
   * LE PLUS PRÉCIS : sans navigateur ni serveur réel. Avant le correctif, `ecritures[1]._revision`
   * valait encore 4 (la révision D'AVANT le premier Enregistrer) ; le serveur, lui, en était
   * déjà à 5, et aurait refusé ce second envoi pour rien.
   */
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();

  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(ecritures.length, 1);
  assert.equal(ecritures[0]._revision, 4, 'le premier envoi part de la révision synchronisée');
  assert.equal(notifs.at(-1).type, 'success');

  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 200, y: 150 });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(ecritures.length, 2);
  assert.equal(ecritures[1]._revision, 5,
    'le second envoi doit partir de la révision que LE PREMIER enregistrement vient de produire, pas de celle d\'avant');
  assert.equal(notifs.at(-1).type, 'success', 'le second enregistrement, dans le même panneau, ne doit PAS être un faux STALE_WRITE');
  await nettoyer(panneau);
});

test('la révision locale vient de LA PROPRE écriture, jamais d\'une vue-tracé redemandée séparément (TOCTOU)', async () => {
  /*
   * REPRODUIT LE DÉFAUT MESURÉ DANS LA PREMIÈRE VERSION DE CE CORRECTIF.
   *
   * Cette première version collait ici `vue.revision` — celle qu'une vue-tracé REDEMANDÉE,
   * par un second appel HTTP séparé de l'écriture elle-même, rapporte À CET INSTANT. Entre
   * l'écriture de A et cet appel-là, un AUTRE auteur peut avoir écrit un AUTRE champ du même
   * câble : le serveur en serait déjà plus loin, et cette vue le rapporterait fidèlement —
   * mais posée sur les champs métier d'AVANT cette écriture-là, elle fabriquait une fiche
   * locale incohérente que A pouvait ensuite réécrire en silence, sans jamais produire le
   * STALE_WRITE qui aurait dû protéger le second auteur.
   *
   * On simule ici exactement cette divergence : la vue-tracé rapporte une révision (99)
   * SANS AUCUN RAPPORT avec ce que la propre écriture de A vient de produire (5). Si la
   * révision locale du câble adoptait cette valeur, ce serait la preuve que le correctif a
   * régressé vers le défaut TOCTOU.
   */
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();

  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  reponseServeur = { ...reponseServeur, revision: 99 };
  await cliquer(boutonDit('Enregistrer'));

  assert.equal(notifs.at(-1).type, 'success');
  assert.equal(selectedCable()?._revision, 5,
    'la révision locale doit venir de la PROPRE écriture (4 + 1), jamais de la vue-tracé (99) redemandée séparément');
  await nettoyer(panneau);
});

test('un ENREGISTRER refusé ne fait PAS avancer la révision LOCALE du câble', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  refusProchainEcriture = Object.assign(new Error('conflit'), { status: 409, code: 'STALE_WRITE' });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(notifs.at(-1).type, 'error');
  assert.equal(selectedCable()?._revision, 4, 'un refus ne doit PAS toucher la révision locale du câble');
  await nettoyer(panneau);
});

test('403 sur la scène : le motif est dit, sans nommer ni zone ni habilitation', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  refusProchainEcriture = Object.assign(new Error('refus'),
    { status: 403, code: 'ROUTE_SCENE_EDIT_FORBIDDEN' });
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(notifs.at(-1).message, ROUTE_SAVE_MESSAGES.ROUTE_SCENE_EDIT_FORBIDDEN);
  for (const secret of ['RF1', 'zone', 'cable.edit', '902']) {
    assert.equal(notifs.at(-1).message.includes(secret), false, `le refus ne doit pas révéler ${secret}`);
  }
  await nettoyer(panneau);
});

test('un tracé NON conforme n\'est même pas envoyé', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  // Un passage neuf, sans aucun point : le contrat de relevé le refuse.
  await cliquer(boutonDit('Ouvrir un passage ici'));
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(ecritures.length, 0, 'aucune écriture spéculative');
  assert.equal(notifs.at(-1).type, 'warning');
  assert.match(notifs.at(-1).message, /pas enregistrable/);
  await nettoyer(panneau);
});

test('chaque refus connu a SA phrase, et l\'inconnu en a une aussi', () => {
  assert.equal(routeSaveMessage({ code: 'ROUTE_SCOPE_INSUFFICIENT' }), ROUTE_SAVE_MESSAGES.ROUTE_SCOPE_INSUFFICIENT);
  // Le code arrive parfois dans la charge du refus plutôt que sur l'erreur elle-même.
  assert.equal(routeSaveMessage({ payload: { error: 'ROUTE_SCENE_INVALID' } }), ROUTE_SAVE_MESSAGES.ROUTE_SCENE_INVALID);
  assert.equal(routeSaveMessage({ status: 401 }), SESSION_EXPIREE);
  assert.equal(routeSaveMessage(null), REFUS_PAR_DEFAUT);
  // Aucune phrase ne doit livrer un code brut à l'exploitant.
  for (const phrase of Object.values(ROUTE_SAVE_MESSAGES)) {
    assert.equal(/[A-Z]{4,}_[A-Z_]+/.test(phrase), false, `« ${phrase} » laisse fuir un code`);
  }
});

/* ═══════════ SUPPRIMER LE TRACÉ N'EST PAS SUPPRIMER LE CÂBLE ═══════════ */

test('« Supprimer le tracé » écrit route:null et CONSERVE tout le reste du câble', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  globalThis.window.AppDialog = { confirm: async () => true };
  await showCableRoute({ ...CABLE, sourceId: 910, sourcePortId: 'OUT1', destinationId: 912, status: 'Connecté' });
  const { panneau } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  await cliquer(boutonDit('Supprimer le tracé'));
  await cliquer(boutonDit('Enregistrer'));
  assert.equal(ecritures.length, 1);
  assert.equal(ecritures[0].route, null);
  assert.equal(ecritures[0].sourceId, 910, 'les extrémités restent');
  assert.equal(ecritures[0].sourcePortId, 'OUT1', 'les ports restent');
  assert.equal(ecritures[0].status, 'Connecté', 'l\'état technique reste');
  assert.match(notifs.at(-1).message, /Le câble est conservé/);
  delete globalThis.window.AppDialog;
  await nettoyer(panneau);
});

test('une suppression REFUSÉE ne supprime rien à l\'écran', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  globalThis.window.AppDialog = { confirm: async () => false };
  await showCableRoute(CABLE);
  const { panneau } = monter();
  await cliquer(boutonDit('Modifier le tracé'));
  await cliquer(boutonDit('Supprimer le tracé'));
  assert.equal(routeSession().working()?.segments?.length, 2, 'le relevé est toujours là');
  delete globalThis.window.AppDialog;
  await nettoyer(panneau);
});

/* ═══════════ LE PREMIER RELEVÉ, DEPUIS LA BARRE ═══════════ */

test('« Ajouter un tracé » ouvre une copie VIDE, sur la scène ouverte', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF', _revision: 6 }, { scene: STC });
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Ajouter un tracé dans STC'));
  assert.equal(panneau.isEditing(), true);
  assert.equal(routeSession().working(), null, 'rien n\'est inventé : la copie part de zéro');
  assert.ok(boutonDit('Ouvrir un passage ici'),
    'le premier passage d\'une création doit être atteignable');
  await cliquer(boutonDit('Ouvrir un passage ici'));
  pointer(toile, 'pointerdown', { x: 300, y: 200 });
  pointer(toile, 'pointerdown', { x: 800, y: 600 });
  assert.deepEqual(routeSession().working().segments[0].waypoints, [{ x: 300, y: 200 }, { x: 800, y: 600 }]);
  assert.equal(routeSession().working().segments[0].sceneId, 901);
  await nettoyer(panneau);
});

test('une création peut ouvrir un SECOND passage dans la même scène', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { scene: STC });
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Ajouter un tracé dans STC'));
  await cliquer(boutonDit('Ouvrir un passage ici'));
  pointer(toile, 'pointerdown', { x: 300, y: 200 });
  pointer(toile, 'pointerdown', { x: 400, y: 300 });
  /*
   * Le défaut que cette épreuve ferme : `canInsert` exige un tracé ENREGISTRÉ, et pendant
   * une création il n'y en a pas encore. Le bouton disparaissait donc après le premier
   * passage — alors que l'autorité de la scène, elle, venait d'être accordée.
   */
  assert.ok(boutonDit('Ouvrir un passage ici'), 'la scène reste inscriptible : le geste reste ouvert');
  await cliquer(boutonDit('Ouvrir un passage ici'));
  assert.equal(routeSession().sequence().length, 2);
  await nettoyer(panneau);
});

test('COURSE : un tracé apparu entre-temps s\'AFFICHE, il n\'est pas remplacé', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { scene: STC });
  const { panneau } = monter();
  // Entre l'affichage et le clic, un autre exploitant a relevé le cheminement.
  reponseServeur = OUVERT;
  await cliquer(boutonDit('Ajouter un tracé dans STC'));
  assert.equal(panneau.isEditing(), false, 'on n\'ouvre pas un éditeur qui écraserait le relevé d\'un autre');
  assert.match(notifs.at(-1).message, /vient d'être relevé/);
  assert.equal(routeAffichee()?.segments?.length, 2, 'et son tracé s\'affiche');
  await nettoyer(panneau);
});

test('une révocation entre l\'affichage et le clic ferme le geste, sans mentir sur le motif', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { scene: STC });
  const { panneau } = monter();
  reponseServeur = { ...SANS_TRACE, editable: false, creatableHere: false };
  await cliquer(boutonDit('Ajouter un tracé dans STC'));
  assert.equal(panneau.isEditing(), false);
  assert.match(notifs.at(-1).message, /Vous ne pouvez pas ouvrir de tracé/);
  await nettoyer(panneau);
});

/* ═══════════ LE PLAN NE SE LAISSE DESSINER QU'EN ÉDITION ═══════════ */

test('en CONSULTATION, le plan garde ses clics et son déplacement', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const marqueurs = document.createElement('div');
  marqueurs.id = 'couche-marqueurs';
  marqueurs.style = { pointerEvents: '' };
  document.body.appendChild(marqueurs);
  const { panneau, toile } = monter({ overlays: ['#couche-marqueurs'] });
  assert.notEqual(toile.style.pointerEvents, 'auto', 'le canevas ne confisque pas la carte');
  assert.equal(document.body.dataset.shapeEditing, undefined, 'le plan se déplace encore');
  assert.equal(marqueurs.style.pointerEvents, '', 'les marqueurs restent cliquables');

  await cliquer(boutonDit('Modifier le tracé'));
  assert.equal(toile.style.pointerEvents, 'auto');
  assert.equal(document.body.dataset.shapeEditing, '1', 'le déplacement du plan cède la main au dessin');
  assert.equal(marqueurs.style.pointerEvents, 'none');

  await cliquer(boutonDit('Annuler'));
  assert.equal(document.body.dataset.shapeEditing, undefined);
  assert.equal(marqueurs.style.pointerEvents, '', 'la valeur EXACTE d\'origine est restituée, chaîne vide comprise');
  await nettoyer(panneau);
  marqueurs.parentNode?.removeChild(marqueurs);
});

test('« Fermer » retire la barre, oublie le câble, et ne laisse aucun écouteur', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  await showCableRoute(CABLE);
  const { panneau, toile } = monter();
  await cliquer(boutonDit('Fermer'));
  assert.equal(document.body.querySelectorAll('.route-editor-bar').length, 0);
  assert.equal(routeAffichee(), null, 'plus de câble choisi : la carte redevient la carte');
  assert.equal(drawRouteLayer({ save() {}, restore() {} }, STC), 0);
  // Un événement de pointeur après fermeture ne doit plus rien atteindre.
  const avant = dessins;
  pointer(toile, 'pointerdown', { x: 500, y: 500 });
  assert.equal(dessins, avant);
  await nettoyer(panneau);
});

/* ═══════════ CHANGER DE SCÈNE REDEMANDE LA CAPACITÉ ═══════════ */

test('changer de scène redemande la capacité — `creatableHere` ne se transporte pas', async () => {
  clearCableRoute();
  reponseServeur = SANS_TRACE;
  let sceneCourante = STC;
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { scene: STC });
  const toile = canevas();
  document.body.appendChild(toile);
  notifs = []; ecritures = [];
  const panneau = openCableRoutePanel({
    canvas: toile, eventToPoint: event => ({ x: event.clientX, y: event.clientY }),
    redraw: () => {}, scene: () => sceneCourante, context: () => CONTEXTE, notifications,
    save: async () => 'C-NEUF'
  });
  courant = panneau;
  assert.ok(boutonDit('Ajouter un tracé dans STC'));

  // La carte s'ouvre sur RF1, où le serveur refuse l'écriture.
  sceneCourante = RF1;
  reponseServeur = { ...SANS_TRACE, creatableHere: false };
  await panneau.rescene();
  assert.equal(boutonDit('Ajouter un tracé'), null,
    'une carte ne promet pas dans RF1 ce que le serveur refusera');
  await nettoyer(panneau);
});

test('une édition en cours ne change PAS de scène sous les pieds de son auteur', async () => {
  clearCableRoute();
  reponseServeur = OUVERT;
  let sceneCourante = STC;
  await showCableRoute(CABLE);
  const toile = canevas();
  document.body.appendChild(toile);
  notifs = [];
  const panneau = openCableRoutePanel({
    canvas: toile, eventToPoint: event => ({ x: event.clientX, y: event.clientY }),
    redraw: () => {}, scene: () => sceneCourante, context: () => CONTEXTE, notifications,
    save: async () => 'CAB-1'
  });
  courant = panneau;
  await cliquer(boutonDit('Modifier le tracé'));
  pointer(toile, 'pointerdown', { x: 900, y: 700 });
  sceneCourante = RF1;
  await panneau.rescene();
  assert.equal(panneau.isEditing(), true);
  assert.equal(routeSession().scene.sceneId, 901,
    'le dessin en cours porte les coordonnées de SON image : le déplacer ailleurs le fausserait');
  assert.equal(routeSession().selectedSegment().waypoints.length, 3, 'et le travail est intact');
  await nettoyer(panneau);
});

/* ═══════════ LE MODULE EST DISPONIBLE HORS LIGNE ═══════════ */

test('la barre du tracé est précachée : `interactive-map.js` l\'importe de façon STATIQUE', () => {
  /*
   * DÉFAUT MESURÉ : `interactive-map.js` importe statiquement `cable-route-editor.js`
   * (`import { openCableRoutePanel } from './cable-route-editor.js'`), au même titre que
   * `cable-route-layer.js` — qui importe lui-même, tout aussi statiquement,
   * `cable-route-access.js`, `cable-route-session.js` et `cable-route-presentation.js`.
   * Les quatre autres étaient précachés dans `ASSETS_TO_CACHE` ; `cable-route-editor.js`,
   * seul, en était absent. Une carte ouverte hors ligne, ou après une mise à jour du Service
   * Worker sans réseau au moment de l'installation, aurait échoué à charger
   * `interactive-map.js` tout entier — l'import statique manquant fait échouer le module qui
   * le porte, pas seulement le tracé.
   *
   * Cette épreuve suit la CHAÎNE réelle d'imports statiques — `interactive-map.js` vers
   * `cable-route-layer.js` et `cable-route-editor.js`, puis `cable-route-layer.js` vers ses
   * trois propres dépendances — plutôt que de supposer que la carte les importe tous
   * directement. Elle couvre ainsi la régression mesurée ET ses voisins déjà corrects, pour
   * la même famille de modules et la même raison de les précacher.
   */
  const carte = lireFichier('interactive-map.js');
  const couche = lireFichier('cable-route-layer.js');
  const worker = lireFichier('service-worker.js');
  const precacheList = worker.slice(worker.indexOf('const ASSETS_TO_CACHE'), worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE')));

  for (const module of ['cable-route-layer', 'cable-route-editor']) {
    assert.match(carte, new RegExp(`from '\\./${module}\\.js'`),
      `\`interactive-map.js\` doit toujours importer ${module}.js statiquement pour que cette épreuve garde un sens`);
  }
  for (const module of ['cable-route-access', 'cable-route-session', 'cable-route-presentation']) {
    assert.match(couche, new RegExp(`from '\\./${module}\\.js'`),
      `\`cable-route-layer.js\` doit toujours importer ${module}.js statiquement pour que cette épreuve garde un sens`);
  }
  for (const module of ['cable-route-access', 'cable-route-session', 'cable-route-presentation', 'cable-route-layer', 'cable-route-editor']) {
    assert.match(precacheList, new RegExp(`'/${module}\\.js'`),
      `${module}.js est importé STATIQUEMENT depuis interactive-map.js : il doit être précaché`);
  }
});
