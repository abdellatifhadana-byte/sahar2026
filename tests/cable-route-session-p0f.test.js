/**
 * @file cable-route-session-p0f.test.js — DESSINER N'ENGAGE RIEN, ET UN TRACÉ MODIFIÉ
 *       N'EST PLUS UN TRACÉ VÉRIFIÉ.
 *
 * Trois familles :
 *
 *   COPIE DE TRAVAIL   le tracé enregistré ne bouge pas pendant le dessin ; « Annuler » le
 *                      rend au caractère près ; une seule sortie mène à l'écriture.
 *
 *   PLUSIEURS PASSAGES un câble peut entrer dans une salle, en sortir, y revenir. Le
 *                      contrat canonique n'impose aucune unicité par scène, et l'éditeur
 *                      doit pouvoir désigner UN passage précis sans toucher aux autres.
 *
 *   VÉRIFIÉ            `status` décrit le tracé ENTIER. Dès que la géométrie change, ce
 *                      n'est plus le cheminement qui a été vérifié sur le terrain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCableRouteSession } from '../cable-route-session.js';
import { sameCableRoute, routeSegmentsForScene } from '../connectivity-contract.js';

const STC = { sceneType: 'room', sceneId: 901 };
const RF1 = { sceneType: 'room', sceneId: 902 };
const PLAN = { sceneType: 'map', sceneId: null };

const segment = (scene, waypoints, dims = { naturalWidth: 2000, naturalHeight: 1000 }) => ({
  sceneType: scene.sceneType, sceneId: scene.sceneId, ...dims, waypoints, anchors: []
});
const TRACE = Object.freeze({
  version: 1, status: 'verified',
  segments: [
    segment(STC, [{ x: 10, y: 10 }, { x: 400, y: 300 }]),
    segment(PLAN, [{ x: 400, y: 300 }, { x: 2200, y: 1500 }], { naturalWidth: 4000, naturalHeight: 3000 }),
    segment(RF1, [{ x: 50, y: 60 }, { x: 777, y: 222 }], { naturalWidth: 1800, naturalHeight: 900 })
  ]
});
const CABLE = Object.freeze({ id: 'CAB-1', reference: 'CAB-2026-1', sourceId: 10, sourcePortId: 'OUT1',
  destinationId: 12, destinationPortId: 'IN9', type: 'SDI', category: 'Vidéo', route: TRACE });

/* ═══════════════ LE TRACÉ ENREGISTRÉ NE BOUGE PAS ═══════════════ */

test('dessiner ne touche JAMAIS le tracé enregistré', () => {
  const avant = JSON.stringify(TRACE);
  const session = createCableRouteSession(TRACE, STC);
  session.addWaypoint({ x: 999, y: 999 });
  session.moveWaypoint(0, { x: 1, y: 1 });
  session.removeWaypoint(1);
  assert.equal(JSON.stringify(TRACE), avant);
});

test('la session travaille sur une COPIE, pas sur une référence partagée', () => {
  const session = createCableRouteSession(TRACE, STC);
  const premier = session.working();
  premier.segments[0].waypoints[0].x = 12345;
  assert.equal(session.working().segments[0].waypoints[0].x, 10);
});

test('ANNULER rend le tracé au caractère près — « vérifié » compris', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.addWaypoint({ x: 500, y: 400 });
  session.moveWaypoint(0, { x: 0, y: 0 });
  session.removeSelectedSegment();
  assert.equal(session.dirty(), true);
  const rendu = session.cancel();
  assert.equal(sameCableRoute(rendu, TRACE), true);
  assert.equal(rendu.status, 'verified', 'annuler ne laisse pas un « proposé » derrière lui');
  assert.equal(session.dirty(), false);
});

test('ANNULER après « supprimer le tracé » rend le tracé entier', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.removeRoute();
  assert.equal(session.working(), null);
  assert.equal(sameCableRoute(session.cancel(), TRACE), true);
});

test('sans modification, la session ne se déclare pas modifiée', () => {
  assert.equal(createCableRouteSession(TRACE, STC).dirty(), false);
  assert.equal(createCableRouteSession(null, STC).dirty(), false);
});

/* ═══════════════ PLUSIEURS PASSAGES DANS LA MÊME SCÈNE ═══════════════ */

/* Le cheminement réel : STC → RF1 → STC. La salle est traversée DEUX fois. */
const ALLER_RETOUR = Object.freeze({
  version: 1, status: 'verified',
  segments: [
    segment(STC, [{ x: 10, y: 10 }, { x: 400, y: 300 }]),
    segment(RF1, [{ x: 50, y: 60 }, { x: 700, y: 200 }], { naturalWidth: 1800, naturalHeight: 900 }),
    segment(STC, [{ x: 900, y: 500 }, { x: 1200, y: 800 }])
  ]
});

test('passages multiples : le contrat canonique en rend DEUX pour la même salle', () => {
  assert.equal(routeSegmentsForScene(ALLER_RETOUR, STC).length, 2,
    'aucune unicité par scène n\'est imposée — un câble peut revenir sur ses pas');
});

test('passages multiples : la session les expose TOUS, dans l\'ordre du cheminement', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  const vus = session.segmentsInCurrentScene();
  assert.equal(vus.length, 2);
  assert.deepEqual(vus[0].waypoints, [{ x: 10, y: 10 }, { x: 400, y: 300 }]);
  assert.deepEqual(vus[1].waypoints, [{ x: 900, y: 500 }, { x: 1200, y: 800 }]);
});

test('passages multiples : on édite CELUI qu\'on a désigné, et lui seul', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  assert.equal(session.selectSegment(1), true);
  assert.deepEqual(session.selectedSegment().waypoints, [{ x: 900, y: 500 }, { x: 1200, y: 800 }]);
  session.moveWaypoint(0, { x: 111, y: 222 });
  const apres = session.segmentsInCurrentScene();
  assert.deepEqual(apres[0].waypoints, [{ x: 10, y: 10 }, { x: 400, y: 300 }], 'le premier passage ne doit pas bouger');
  assert.deepEqual(apres[1].waypoints, [{ x: 111, y: 222 }, { x: 1200, y: 800 }]);
  // Et RF1, qui se trouve ENTRE les deux, est intacte.
  assert.deepEqual(routeSegmentsForScene(session.working(), RF1)[0].waypoints, [{ x: 50, y: 60 }, { x: 700, y: 200 }]);
});

test('passages multiples : retirer le premier laisse le second en place', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  session.selectSegment(0);
  assert.equal(session.removeSelectedSegment(), true);
  const restants = session.segmentsInCurrentScene();
  assert.equal(restants.length, 1);
  assert.deepEqual(restants[0].waypoints, [{ x: 900, y: 500 }, { x: 1200, y: 800 }]);
  // L'ordre du cheminement est conservé : RF1 reste avant le passage restant.
  assert.deepEqual(session.working().segments.map(s => `${s.sceneType}:${s.sceneId}`),
    ['room:902', 'room:901']);
});

test('passages multiples : un TROISIÈME passage peut s\'ouvrir dans la même salle', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  // Un troisième passage par STC, explicitement placé À LA FIN du cheminement.
  assert.equal(session.startSegment({ naturalWidth: 2000, naturalHeight: 1000, insertAt: 3 }), true);
  assert.equal(session.segmentsInCurrentScene().length, 3);
  // Le nouveau devient celui qu'on édite, et il est VIDE.
  assert.deepEqual(session.selectedSegment().waypoints, []);
  session.addWaypoint({ x: 5, y: 5 });
  session.addWaypoint({ x: 6, y: 6 });
  assert.deepEqual(session.segmentsInCurrentScene()[2].waypoints, [{ x: 5, y: 5 }, { x: 6, y: 6 }]);
  assert.deepEqual(session.segmentsInCurrentScene()[0].waypoints, [{ x: 10, y: 10 }, { x: 400, y: 300 }]);
});

test('passages multiples : ANNULER rend le tracé d\'origine exactement', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  session.selectSegment(1);
  session.moveWaypoint(0, { x: 1, y: 1 });
  session.startSegment({ naturalWidth: 2000, naturalHeight: 1000, insertAt: 3 });
  session.selectSegment(0);
  session.removeSelectedSegment();
  assert.equal(sameCableRoute(session.cancel(), ALLER_RETOUR), true);
});

test('passages multiples : aucun segment n\'est fusionné ni réordonné en silence', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  assert.deepEqual(session.working().segments.map(s => `${s.sceneType}:${s.sceneId}`),
    ['room:901', 'room:902', 'room:901']);
});

test('un rang de segment hors bornes ne choisit rien', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  for (const rang of [-1, 2, 1.5, '1', null]) assert.equal(session.selectSegment(rang), false);
  assert.equal(session.selectedIndex(), 0, 'le choix précédent reste celui qui vaut');
});

/* ═══════════════ ON NE DESSINE QUE DANS LA SCÈNE OUVERTE ═══════════════ */

test('sans segment dans la scène ouverte, aucun geste ne prend', () => {
  const session = createCableRouteSession({ version: 1, status: 'verified', segments: [segment(STC, [{ x: 1, y: 1 }, { x: 2, y: 2 }])] }, RF1);
  assert.equal(session.selectedSegment(), null);
  assert.deepEqual(session.segmentsInCurrentScene(), []);
  assert.equal(session.selectedIndex(), -1);
  assert.equal(session.addWaypoint({ x: 5, y: 5 }), false);
  assert.equal(session.moveWaypoint(0, { x: 5, y: 5 }), false);
  assert.equal(session.removeWaypoint(0), false);
  assert.equal(session.removeSelectedSegment(), false);
});

test('une scène inutilisable ferme tous les gestes', () => {
  for (const scene of [null, { sceneType: 'satellite' }, { sceneType: 'room', sceneId: null }, { sceneType: 'room' }]) {
    const session = createCableRouteSession(TRACE, scene);
    assert.equal(session.scene, null);
    assert.equal(session.startSegment({ naturalWidth: 100, naturalHeight: 100 }), false);
    assert.equal(session.selectedSegment(), null);
  }
  assert.deepEqual(createCableRouteSession(TRACE, PLAN).scene, { sceneType: 'map', sceneId: null });
});

/* ═══════════════ AUCUNE CONTINUITÉ INVENTÉE ═══════════════ */

test('un segment neuf commence VIDE — rien ne le relie aux autres scènes', () => {
  const session = createCableRouteSession(null, STC);
  assert.equal(session.startSegment({ naturalWidth: 2000, naturalHeight: 1000 }), true);
  assert.deepEqual(session.selectedSegment().waypoints, []);
});

test('retirer un segment laisse un TROU — les voisins ne se recollent pas', () => {
  const session = createCableRouteSession(TRACE, PLAN);
  session.removeSelectedSegment();
  const restant = session.working();
  assert.equal(restant.segments.length, 2);
  assert.deepEqual(routeSegmentsForScene(restant, PLAN), []);
  assert.deepEqual(restant.segments[0].waypoints, TRACE.segments[0].waypoints);
  assert.deepEqual(restant.segments[1].waypoints, TRACE.segments[2].waypoints);
});

test('retirer le dernier segment rend `null`, jamais une coquille vide', () => {
  const seul = { version: 1, status: 'verified', segments: [segment(STC, [{ x: 1, y: 1 }, { x: 2, y: 2 }])] };
  const session = createCableRouteSession(seul, STC);
  session.removeSelectedSegment();
  assert.equal(session.working(), null);
  assert.equal(session.payload(CABLE).cable.route, null);
});

/* ═══════════════ UN TRACÉ MODIFIÉ N'EST PLUS VÉRIFIÉ ═══════════════ */

const modifie = geste => {
  const session = createCableRouteSession(TRACE, STC);
  assert.equal(session.working().status, 'verified', 'départ : un relevé vérifié');
  geste(session);
  return session;
};

test('vérifié → un point déplacé → proposé', () => {
  assert.equal(modifie(s => s.moveWaypoint(0, { x: 11, y: 11 })).working().status, 'proposed');
});

test('vérifié → un point ajouté → proposé', () => {
  assert.equal(modifie(s => s.addWaypoint({ x: 700, y: 700 })).working().status, 'proposed');
});

test('vérifié → un point retiré → proposé', () => {
  assert.equal(modifie(s => s.removeWaypoint(0)).working().status, 'proposed');
});

test('vérifié → un segment ajouté → proposé', () => {
  assert.equal(modifie(s => s.startSegment({ naturalWidth: 2000, naturalHeight: 1000, insertAt: 3 })).working().status, 'proposed');
});

test('vérifié → un segment retiré → proposé', () => {
  assert.equal(modifie(s => s.removeSelectedSegment()).working().status, 'proposed');
});

test('un statut « inconnu » devient lui aussi « proposé » quand on dessine', () => {
  // Ce que l'on vient de tracer est, précisément, ce que son auteur propose.
  const inconnu = { ...TRACE, status: 'unknown' };
  const session = createCableRouteSession(inconnu, STC);
  session.moveWaypoint(0, { x: 3, y: 3 });
  assert.equal(session.working().status, 'proposed');
});

test('OUVRIR, CHOISIR, LIRE ou ANNULER ne dégrade rien — aucun de ces gestes n\'est une modification', () => {
  const session = createCableRouteSession(ALLER_RETOUR, STC);
  session.segmentsInCurrentScene();
  session.selectSegment(1);
  session.selectedSegment();
  session.working();
  assert.equal(session.working().status, 'verified');
  session.moveWaypoint(0, { x: 9, y: 9 });
  assert.equal(session.working().status, 'proposed');
  assert.equal(session.cancel().status, 'verified', 'annuler restaure le statut d\'origine');
});

test('« proposé » le reste ; un geste échoué ne dégrade pas', () => {
  const propose = { ...TRACE, status: 'proposed' };
  const session = createCableRouteSession(propose, STC);
  session.moveWaypoint(0, { x: 4, y: 4 });
  assert.equal(session.working().status, 'proposed');

  const intact = createCableRouteSession(TRACE, RF1);
  assert.equal(intact.moveWaypoint(99, { x: 1, y: 1 }), false);
  assert.equal(intact.working().status, 'verified',
    'un geste qui n\'a rien changé ne peut pas retirer une vérification');
});

test('confirmer « vérifié » reste possible — mais une modification ultérieure le retire', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.moveWaypoint(0, { x: 5, y: 5 });
  assert.equal(session.working().status, 'proposed');
  assert.equal(session.setStatus('verified'), true);
  assert.equal(session.working().status, 'verified');
  session.moveWaypoint(1, { x: 6, y: 6 });
  assert.equal(session.working().status, 'proposed', 'la confirmation ne survit pas au geste suivant');
});

test('enregistrer SANS toucher à la géométrie préserve « vérifié »', () => {
  const session = createCableRouteSession(TRACE, STC);
  const { ok, cable } = session.payload(CABLE);
  assert.equal(ok, true);
  assert.equal(cable.route.status, 'verified',
    'ouvrir puis enregistrer un tracé intact ne doit pas le déclasser');
});

/* ═══════════════ UNE SEULE SORTIE VERS L'ÉCRITURE ═══════════════ */

test('`payload` rend le câble ENTIER, sans rien perdre de son identité', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.moveWaypoint(0, { x: 20, y: 20 });
  const { ok, cable } = session.payload(CABLE);
  assert.equal(ok, true);
  for (const champ of ['id', 'reference', 'sourceId', 'sourcePortId', 'destinationId', 'destinationPortId', 'type', 'category']) {
    assert.equal(cable[champ], CABLE[champ], `« ${champ} » doit survivre à une modification de tracé`);
  }
  assert.equal(cable.route.segments[0].waypoints[0].x, 20);
});

test('« supprimer le tracé » préserve le CÂBLE — ce sont deux gestes distincts', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.removeRoute();
  const { ok, cable } = session.payload(CABLE);
  assert.equal(ok, true);
  assert.equal(cable.route, null);
  assert.equal(cable.id, 'CAB-1');
  assert.equal(cable.sourcePortId, 'OUT1');
  assert.equal(cable.destinationPortId, 'IN9');
});

test('une géométrie invalide REFUSE de produire une charge', () => {
  const session = createCableRouteSession(TRACE, STC);
  session.removeWaypoint(1);
  const verdict = session.validate();
  assert.equal(verdict.valid, false);
  const { ok, cable, errors } = session.payload(CABLE);
  assert.equal(ok, false);
  assert.equal(cable, null);
  assert.ok(errors.length > 0);
});

test('le statut se pose seulement parmi les valeurs connues', () => {
  const session = createCableRouteSession(TRACE, STC);
  assert.equal(session.setStatus('parfait'), false);
  assert.equal(session.working().status, 'verified');
});

test('un tracé créé de zéro naît « proposé », jamais « vérifié »', () => {
  const session = createCableRouteSession(null, STC);
  session.startSegment({ naturalWidth: 2000, naturalHeight: 1000 });
  session.addWaypoint({ x: 10, y: 10 });
  session.addWaypoint({ x: 90, y: 90 });
  assert.equal(session.working().status, 'proposed');
  assert.equal(session.payload(CABLE).ok, true);
});

/* ═══════════════ L'ORDRE DES SEGMENTS EST UNE AFFIRMATION PHYSIQUE ═══════════════
 *
 * `segments` se lit comme l'ordre du cheminement RÉEL. Ajouter d'office à la fin déclarait
 * donc que tout nouveau passage vient après tous les autres. Sur un relevé incomplet, cela
 * transformait STC(1) → plan → RF1 → STC(2) en STC(1) → plan → STC(2) → RF1 : aucune ligne
 * fictive n'était tracée, mais un ORDRE fictif l'était — et il se lit comme un relevé.
 * ═════════════════════════════════════════════════════════════════════════════ */

const A_B_C = Object.freeze({
  version: 1, status: 'verified',
  segments: [
    segment(STC, [{ x: 10, y: 10 }, { x: 400, y: 300 }]),
    segment(PLAN, [{ x: 1, y: 1 }, { x: 2, y: 2 }], { naturalWidth: 4000, naturalHeight: 3000 }),
    segment(STC, [{ x: 900, y: 500 }, { x: 1200, y: 800 }])
  ]
});

test('ordre : un segment manquant s\'insère À SA PLACE dans le cheminement', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  assert.equal(session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 2 }), true);
  assert.deepEqual(session.working().segments.map(s => `${s.sceneType}:${s.sceneId}`),
    ['room:901', 'map:null', 'room:902', 'room:901']);
});

test('ordre : les segments existants ne sont ni déplacés ni modifiés par une insertion', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 2 });
  const apres = session.working().segments;
  assert.deepEqual(apres[0], A_B_C.segments[0]);
  assert.deepEqual(apres[1], A_B_C.segments[1]);
  assert.deepEqual(apres[3], A_B_C.segments[2]);
  assert.deepEqual(apres[2].waypoints, [], 'le nouveau passage commence vide');
});

test('ordre : le segment inséré devient celui qu\'on édite', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 2 });
  session.addWaypoint({ x: 5, y: 5 });
  session.addWaypoint({ x: 6, y: 6 });
  assert.deepEqual(session.working().segments[2].waypoints, [{ x: 5, y: 5 }, { x: 6, y: 6 }]);
});

test('ordre : insérer AU DÉBUT et À LA FIN sont deux positions valides', () => {
  const debut = createCableRouteSession(A_B_C, RF1);
  assert.equal(debut.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 0 }), true);
  assert.equal(debut.working().segments[0].sceneId, 902);

  const fin = createCableRouteSession(A_B_C, RF1);
  assert.equal(fin.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 3 }), true);
  assert.equal(fin.working().segments[3].sceneId, 902);
});

test('ordre : sur un tracé EXISTANT, la position est EXIGÉE — jamais supposée', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  assert.equal(session.startSegment({ naturalWidth: 1800, naturalHeight: 900 }), false,
    'sans position, le code inventerait un ordre physique');
  assert.equal(session.working().segments.length, 3, 'rien n\'a été inséré');
  assert.equal(session.working().status, 'verified', 'un geste refusé ne dégrade pas le statut');
});

test('ordre : une position invalide n\'insère rien et ne dégrade rien', () => {
  for (const mauvaise of [-1, 4, 1.5, '2', null, NaN]) {
    const session = createCableRouteSession(A_B_C, RF1);
    assert.equal(session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: mauvaise }), false,
      `position « ${String(mauvaise)} » acceptée à tort`);
    assert.equal(session.working().segments.length, 3);
    assert.equal(session.working().status, 'verified');
    assert.equal(session.dirty(), false);
  }
});

test('ordre : sans tracé, la position peut être omise — il n\'y a qu\'une place', () => {
  const vide = createCableRouteSession(null, STC);
  assert.equal(vide.startSegment({ naturalWidth: 2000, naturalHeight: 1000 }), true);
  const explicite = createCableRouteSession(null, STC);
  assert.equal(explicite.startSegment({ naturalWidth: 2000, naturalHeight: 1000, insertAt: 0 }), true);
  const absurde = createCableRouteSession(null, STC);
  assert.equal(absurde.startSegment({ naturalWidth: 2000, naturalHeight: 1000, insertAt: 5 }), false);
});

test('ordre : une insertion valide dégrade le statut, comme toute modification', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 2 });
  assert.equal(session.working().status, 'proposed');
});

test('ordre : ANNULER après insertion rend le cheminement d\'origine exactement', () => {
  const session = createCableRouteSession(A_B_C, RF1);
  session.startSegment({ naturalWidth: 1800, naturalHeight: 900, insertAt: 2 });
  session.addWaypoint({ x: 1, y: 1 });
  assert.equal(sameCableRoute(session.cancel(), A_B_C), true);
});

test('ordre : `sequence()` donne à l\'écran de quoi DEMANDER où insérer', () => {
  const session = createCableRouteSession(A_B_C, STC);
  assert.deepEqual(session.sequence(), [
    { insertAt: 0, sceneType: 'room', sceneId: 901, waypoints: 2 },
    { insertAt: 1, sceneType: 'map', sceneId: null, waypoints: 2 },
    { insertAt: 2, sceneType: 'room', sceneId: 901, waypoints: 2 }
  ]);
  // Aucun tri : l'ordre rendu est celui du relevé, pas un classement par salle.
  assert.deepEqual(createCableRouteSession(null, STC).sequence(), []);
});
