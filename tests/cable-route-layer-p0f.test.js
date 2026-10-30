/**
 * @file cable-route-layer-p0f.test.js — CE QUI SE DESSINE, ET CE QUI NE SE DESSINE PAS.
 *
 * La couche est exécutée pour de vrai : un contexte de canevas simulé enregistre chaque
 * ordre de dessin, et les épreuves lisent ce qui a RÉELLEMENT été tracé. Un test qui se
 * contenterait de lire la source ne dirait pas si un trait est apparu au mauvais endroit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESPACE_CARTE, showCableRoute, refreshRouteView, clearCableRoute,
  beginRouteEdit, beginRouteCreate, cancelRouteEdit,
  drawRouteLayer, routeAffichee, routePanelState, isEditing, routeSession,
  routePresent, routeRevision, selectedCable,
  pointNaturelDepuisCanevas, poigneeSousLeClic, sequenceDe
} from '../cable-route-layer.js';
import { MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL } from '../connectivity-contract.js';
import { entryScene, routeHasVisibleGeometry } from '../cable-route-layer.js';
import { readFileSync } from 'node:fs';

/* Un canevas qui ne dessine rien mais retient tout. */
function canevas() {
  const traces = [];
  let courant = null;
  return {
    ordres: traces,
    save() {}, restore() {},
    beginPath() { courant = { points: [], arcs: 0 }; traces.push(courant); },
    moveTo(x, y) { courant?.points.push({ x, y }); },
    lineTo(x, y) { courant?.points.push({ x, y }); },
    arc() { if (courant) courant.arcs += 1; },
    stroke() { if (courant) courant.strokeStyle = this.strokeStyle; },
    fill() {}, fillText() {},
    setLineDash(d) { if (courant) courant.tirets = d; },
    get polylignes() { return traces.filter(t => t.points.length >= 2); },
    get poignees() { return traces.filter(t => t.arcs > 0).length }
  };
}

const STC = { sceneType: 'room', sceneId: 901 };
const RF1 = { sceneType: 'room', sceneId: 902 };
const segment = (scene, waypoints, dims = { naturalWidth: 1000, naturalHeight: 600 }) => ({
  sceneType: scene.sceneType, sceneId: scene.sceneId, ...dims, waypoints, anchors: []
});
const ROUTE = {
  version: 1, status: 'verified',
  segments: [
    segment(STC, [{ x: 0, y: 0 }, { x: 500, y: 300 }]),
    segment(RF1, [{ x: 100, y: 100 }, { x: 900, y: 500 }]),
    segment(STC, [{ x: 250, y: 150 }, { x: 750, y: 450 }])
  ]
};
const CABLE = { id: 'CAB-1', reference: 'CAB-2026-1', route: ROUTE };
const serveur = reponse => async () => ({ ok: true, json: async () => reponse });

const OUVERT = { readable: true, editable: true, creatableHere: true, route: ROUTE };

/*
 * LA RÉPONSE RÉELLE DU SERVEUR POUR UN CÂBLE SANS TRACÉ — mesurée, pas supposée.
 *
 * `readable: false`, parce qu'il n'y a rien à lire ; `route: null`, parce que rien n'est
 * enregistré ; et pourtant `creatableHere: true`, parce que la scène ouverte est
 * inscriptible. Les épreuves qui écrivaient `{ readable: true, route: null }` décrivaient
 * un état que le serveur ne produit JAMAIS, et c'est ce mensonge qui a caché le défaut :
 * la toute première documentation d'un tracé était inatteignable.
 */
const SANS_TRACE = Object.freeze({ readable: false, editable: true, creatableHere: true, route: null, revision: 6 });

/* Un tracé existe, et pas un segment ne nous regarde : même `readable`, sens opposé. */
const TOUT_MASQUE = Object.freeze({
  readable: false, editable: false, creatableHere: true, revision: 9,
  route: { version: 1, status: 'verified', segments: [], partial: true }
});

/* ─────────────── RIEN PAR DÉFAUT ─────────────── */

test('sans câble choisi, la couche ne dessine RIEN', () => {
  clearCableRoute();
  const ctx = canevas();
  assert.equal(drawRouteLayer(ctx, STC), 0);
  assert.equal(ctx.ordres.length, 0, 'la carte reste la carte : aucune forêt de câbles');
  assert.equal(routePanelState(), null);
});

test('un tracé ne s\'affiche qu\'après un geste explicite, et la capacité vient du serveur', async () => {
  clearCableRoute();
  const acces = await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  assert.equal(acces.readable, true);
  assert.equal(drawRouteLayer(canevas(), STC), 2);
});

test('si le serveur dit que le tracé n\'est plus lisible, on ne retombe PAS sur le cache', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  // Une habilitation révoquée entre-temps : la vue se ferme, elle ne se fige pas.
  await showCableRoute(CABLE, { fetchImpl: serveur({ readable: false }) });
  const ctx = canevas();
  assert.equal(drawRouteLayer(ctx, STC), 0);
  assert.equal(ctx.ordres.length, 0);
  assert.equal(routeAffichee(), null);
});

/* ─────────────── LA SCÈNE COURANTE, ET RIEN QU'ELLE ─────────────── */

test('TOUS les passages de la scène ouverte sont dessinés', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const ctx = canevas();
  assert.equal(drawRouteLayer(ctx, STC), 2, 'la salle est traversée deux fois');
  assert.equal(ctx.polylignes.length, 2);
});

test('la géométrie d\'une AUTRE scène ne se dessine jamais ici', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const ctx = canevas();
  drawRouteLayer(ctx, STC);
  // Les points de RF1 (100,100)-(900,500) mis à l'échelle donneraient (200,200)-(1800,1000).
  const tous = ctx.polylignes.flatMap(t => t.points);
  assert.ok(!tous.some(p => Math.round(p.x) === 1800 && Math.round(p.y) === 1000),
    'un trait exact au mauvais endroit se lit comme un relevé');
});

test('aucun trait ne relie deux scènes — le trou est un fait', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const ctx = canevas();
  drawRouteLayer(ctx, STC);
  // Deux polylignes SÉPARÉES, jamais une seule qui les enchaînerait.
  assert.equal(ctx.polylignes.length, 2);
  for (const trace of ctx.polylignes) assert.equal(trace.points.length, 2);
});

test('les points sont mis à l\'échelle de l\'espace de dessin, en pixels naturels', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const ctx = canevas();
  drawRouteLayer(ctx, STC, ESPACE_CARTE);
  // (500,300) sur une image 1000×600, dessinée dans 2000×1200 → (1000,600).
  assert.deepEqual(ctx.polylignes[0].points, [{ x: 0, y: 0 }, { x: 1000, y: 600 }]);
});

test('la même géométrie, un espace deux fois plus petit : même position RELATIVE', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const grand = canevas(); drawRouteLayer(grand, STC, { width: 2000, height: 1200 });
  const petit = canevas(); drawRouteLayer(petit, STC, { width: 1000, height: 600 });
  assert.equal(grand.polylignes[0].points[1].x / 2000, petit.polylignes[0].points[1].x / 1000);
});

test('un segment à moins de deux points n\'est pas dessiné — on ne prolonge rien', async () => {
  clearCableRoute();
  const court = { version: 1, status: 'verified', segments: [segment(STC, [{ x: 1, y: 1 }])] };
  await showCableRoute({ id: 'C', reference: 'C', route: court },
    { fetchImpl: serveur({ ...OUVERT, route: court }) });
  const ctx = canevas();
  drawRouteLayer(ctx, STC);
  assert.equal(ctx.polylignes.length, 0);
});

/* ─────────────── LES POIGNÉES N'EXISTENT QU'EN ÉDITION ─────────────── */

test('en consultation, aucune poignée : un tracé se lit, il ne se manipule pas', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const ctx = canevas();
  drawRouteLayer(ctx, STC);
  assert.equal(ctx.poignees, 0);
  assert.equal(isEditing(), false);
});

test('en édition, les poignées n\'apparaissent que sur le passage CHOISI', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const session = await beginRouteEdit(STC, { fetchImpl: serveur(OUVERT) });
  assert.ok(session, 'l\'éditeur doit s\'ouvrir quand le serveur l\'autorise');
  const ctx = canevas();
  drawRouteLayer(ctx, STC);
  assert.equal(ctx.poignees, 2, 'deux points, sur le seul passage choisi');
});

/* ─────────────── L'AUTORITÉ EST REDEMANDÉE, ET ELLE FERME ─────────────── */

test('l\'éditeur ne s\'ouvre pas quand le serveur refuse', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  assert.equal(await beginRouteEdit(STC, { fetchImpl: serveur({ readable: true, editable: false, route: ROUTE }) }), null);
  assert.equal(isEditing(), false);
});

test('un tracé AMPUTÉ ne s\'édite pas — le réenregistrer effacerait ce qu\'on ne voit pas', async () => {
  clearCableRoute();
  const ampute = { ...ROUTE, partial: true };
  await showCableRoute(CABLE, { fetchImpl: serveur({ ...OUVERT, route: ampute }) });
  assert.equal(await beginRouteEdit(STC, { fetchImpl: serveur({ ...OUVERT, route: ampute }) }), null);
});

test('l\'autorité est REDEMANDÉE à l\'ouverture de l\'éditeur, pas reprise du cache', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  let demandes = 0;
  await beginRouteEdit(STC, { fetchImpl: async () => { demandes += 1; return { ok: true, json: async () => OUVERT }; } });
  assert.equal(demandes, 1, 'une habilitation révoquée doit fermer le geste tout de suite');
});

/* ─────────────── ANNULER N'ÉCRIT RIEN ─────────────── */

test('ANNULER referme l\'éditeur et rend la géométrie d\'origine', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const session = await beginRouteEdit(STC, { fetchImpl: serveur(OUVERT) });
  session.moveWaypoint(0, { x: 999, y: 999 });
  assert.equal(routeAffichee().segments[0].waypoints[0].x, 999);
  cancelRouteEdit();
  assert.equal(isEditing(), false);
  assert.equal(routeAffichee().segments[0].waypoints[0].x, 0, 'le tracé montré redevient l\'enregistré');
  assert.equal(ROUTE.segments[0].waypoints[0].x, 0, 'et l\'enregistré n\'a jamais bougé');
});

/* ─────────────── CE QUE LE PANNEAU DIT ─────────────── */

const CONTEXTE = { rooms: [{ id: 901, name: 'STC' }, { id: 902, name: 'RF1' }], baies: [] };

test('le panneau énonce le parcours dans la langue de l\'exploitant', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  const etat = routePanelState(CONTEXTE);
  // STC → RF1 → STC saute deux fois d'une salle à l'autre SANS repasser par le plan général :
  // aucune scène commune ne documente ces passages (voir cable-route-presentation.js).
  assert.equal(etat.sentence, 'STC (1) → Liaison non cartographiée → RF1 → Liaison non cartographiée → STC (2)');
  assert.equal(etat.badge.text, 'Tracé vérifié');
  assert.equal(etat.canEdit, true);
});

test('sans tracé, le panneau dit EXACTEMENT « Tracé physique non renseigné »', async () => {
  clearCableRoute();
  await showCableRoute({ id: 'C2', reference: 'C2', route: null }, { fetchImpl: serveur(SANS_TRACE) });
  assert.equal(routeAffichee(), null);
  const etat = routePanelState(CONTEXTE);
  assert.equal(etat.message, MISSING_ROUTE_LABEL);
  assert.equal(etat.message, 'Tracé physique non renseigné');
  assert.equal(etat.badge.verified, false);
});

test('un tracé amputé le dit, et ne se présente pas comme vérifié', async () => {
  clearCableRoute();
  await showCableRoute({ id: 'C3', reference: 'C3', route: null },
    { fetchImpl: serveur({ readable: true, editable: false, route: { version: 1, status: 'verified', segments: [segment(STC, [{ x: 1, y: 1 }, { x: 2, y: 2 }]) ], partial: true } }) });
  const etat = routePanelState(CONTEXTE);
  // Le tracé reste DOCUMENTÉ — il lui reste un segment visible — donc l'écran ne dit pas
  // « rien à montrer » : c'est la PASTILLE qui porte l'incomplétude, et elle la porte.
  assert.equal(etat.badge.text, PARTIAL_ROUTE_LABEL);
  assert.equal(etat.message, '', 'il y a quelque chose à voir : pas d\'état vide');
  assert.equal(etat.badge.verified, false);
  assert.equal(etat.canEdit, false, 'on ne modifie pas un tracé qu\'on n\'a pas vu en entier');
});

test('les positions d\'insertion viennent de la SÉQUENCE, pas de la scène ouverte', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(OUVERT) });
  await beginRouteEdit(STC, { fetchImpl: serveur(OUVERT) });
  const etat = routePanelState(CONTEXTE);
  assert.deepEqual(etat.insertions.map(i => i.insertAt), [0, 1, 2, 3]);
  assert.equal(etat.insertions[3].label, 'Après STC (2)');
});

/* ─────────────── DU CLIC AU POINT NATUREL ─────────────── */

test('un clic devient un point en pixels NATURELS de l\'image du segment', () => {
  const seg = segment(STC, [{ x: 0, y: 0 }]);
  assert.deepEqual(pointNaturelDepuisCanevas({ x: 1000, y: 600 }, seg, ESPACE_CARTE), { x: 500, y: 300 });
  assert.equal(pointNaturelDepuisCanevas({ x: 1, y: 1 }, { naturalWidth: 0, naturalHeight: 1 }), null);
});

test('une poignée ne se saisit que si le clic est réellement dessus', () => {
  const seg = segment(STC, [{ x: 0, y: 0 }, { x: 500, y: 300 }]);
  assert.equal(poigneeSousLeClic({ x: 1000, y: 600 }, seg, ESPACE_CARTE), 1);
  assert.equal(poigneeSousLeClic({ x: 5, y: 5 }, seg, ESPACE_CARTE), 0);
  assert.equal(poigneeSousLeClic({ x: 700, y: 400 }, seg, ESPACE_CARTE), -1, 'loin de tout : rien');
});

test('`sequenceDe` rend l\'ordre STOCKÉ, sans le trier', () => {
  assert.deepEqual(sequenceDe(ROUTE).map(e => `${e.sceneType}:${e.sceneId}`),
    ['room:901', 'room:902', 'room:901']);
  assert.deepEqual(sequenceDe(null), []);
});

/* ══════════════════════════════════════════════════════════════════════════
 * PERMISSION FRAÎCHE **ET** GÉOMÉTRIE FRAÎCHE
 *
 * Ne rafraîchir que la permission laissait une faille sous révocation PARTIELLE : le
 * serveur répond encore `readable: true` — une partie du tracé reste légitimement visible —
 * et l'écran continuait d'afficher, depuis son cache, le segment qu'on venait de lui
 * retirer, son identifiant de scène et sa place dans le parcours.
 * ══════════════════════════════════════════════════════════════════════════ */

/* La vue amputée que le serveur sert après révocation de RF1 : STC seul, `partial`. */
const VUE_AMPUTEE = {
  readable: true, editable: false,
  route: { version: 1, status: 'verified', partial: true, segments: [segment(STC, [{ x: 0, y: 0 }, { x: 500, y: 300 }])] },
  revision: 7
};

test('révocation partielle : la géométrie en cache est REMPLACÉE par la vue servie', async () => {
  clearCableRoute();
  // Le câble local porte encore les deux segments : c'est l'état du dernier instantané.
  await showCableRoute(CABLE, { fetchImpl: serveur(VUE_AMPUTEE) });
  const affichee = routeAffichee();
  assert.equal(affichee.segments.length, 1, 'seul le segment autorisé subsiste');
  assert.equal(affichee.partial, true);
  const rendu = JSON.stringify(affichee);
  for (const secret of ['902', '900', '500"', 'RF1']) {
    assert.ok(!rendu.includes(secret), `fuite : « ${secret} » survit dans la vue`);
  }
});

test('révocation partielle : la scène retirée ne se dessine plus, même en cache', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(VUE_AMPUTEE) });
  const ctx = canevas();
  assert.equal(drawRouteLayer(ctx, RF1), 0, 'RF1 n\'existe plus dans la vue autorisée');
  assert.equal(ctx.ordres.length, 0);
  assert.equal(drawRouteLayer(canevas(), STC), 1, 'STC reste visible, et c\'est légitime');
});

test('révocation partielle : le parcours affiché ne NOMME plus la scène retirée', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(VUE_AMPUTEE) });
  const etat = routePanelState(CONTEXTE);
  assert.equal(etat.sentence, 'STC');
  assert.ok(!etat.sentence.includes('RF1'), 'la topologie retirée ne doit pas rester dans la phrase');
  assert.equal(etat.badge.text, PARTIAL_ROUTE_LABEL, 'et l\'écran dit que le tracé est incomplet');
});

test('la géométrie servie ne se replie JAMAIS sur le cache local', async () => {
  clearCableRoute();
  // Le serveur ne rend aucune géométrie : il n'y en a aucune, et le cache local en a une.
  await showCableRoute(CABLE, { fetchImpl: serveur(SANS_TRACE) });
  assert.equal(routeAffichee(), null);
  assert.equal(drawRouteLayer(canevas(), STC), 0);
});

test('l\'éditeur part de la vue FRAÎCHE, pas du magasin local', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur({ ...OUVERT, route: ROUTE, revision: 4 }) });
  const fraiche = { version: 1, status: 'verified', segments: [segment(STC, [{ x: 7, y: 7 }, { x: 8, y: 8 }])] };
  const session = await beginRouteEdit(STC, { fetchImpl: serveur({ ...OUVERT, route: fraiche, revision: 9 }) });
  assert.ok(session);
  assert.deepEqual(session.working().segments[0].waypoints, [{ x: 7, y: 7 }, { x: 8, y: 8 }],
    'éditer une géométrie périmée écraserait ce qu\'un autre vient de relever');
});

/* ═══════════ UN TRACÉ AMPUTÉ N'EST PAS UN TRACÉ VIDE ═══════════ */

test('amputé avec un segment visible : on peut VOIR, pas modifier', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur(VUE_AMPUTEE) });
  const etat = routePanelState(CONTEXTE);
  assert.equal(routeHasVisibleGeometry(routeAffichee()), true, 'il reste quelque chose à montrer');
  assert.equal(etat.badge.text, PARTIAL_ROUTE_LABEL);
  assert.equal(etat.canEdit, false, 'on ne remplace pas un tracé qu\'on n\'a pas vu en entier');
  assert.equal(drawRouteLayer(canevas(), STC), 1);
});

test('amputé sans aucun segment visible : il n\'y a rien à ouvrir', async () => {
  clearCableRoute();
  await showCableRoute(CABLE, { fetchImpl: serveur({ readable: true, editable: false,
    route: { version: 1, status: 'verified', partial: true, segments: [] } }) });
  assert.equal(routeHasVisibleGeometry(routeAffichee()), false);
  assert.equal(drawRouteLayer(canevas(), STC), 0);
});

/* ═══════════ LE PREMIER TRACÉ D'UN CÂBLE QUI N'EN A PAS ═══════════ */

/*
 * `readable: false` NE VEUT PAS DIRE « il n'y a pas de tracé ».
 *
 * Sur un câble sans cheminement relevé, le serveur répond `readable: false` — il n'y a rien
 * à lire — et pourtant `creatableHere: true`. La couche jetait la sélection sur ce `false`,
 * et le geste le plus courant du terrain — documenter un tracé pour la première fois —
 * n'existait tout simplement pas. Ces épreuves-ci défendent le contraire, sans jamais
 * ouvrir la porte à l'écrasement d'un relevé qu'on ne voit pas.
 */

test('un câble SANS tracé garde sa sélection : la vue ne se ferme pas sur un `readable:false`', async () => {
  clearCableRoute();
  const acces = await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' }, { fetchImpl: serveur(SANS_TRACE) });
  assert.equal(acces.readable, false);
  assert.ok(selectedCable(), 'sans sélection, aucun geste de création ne peut être porté');
  assert.equal(routePresent(), false, 'le serveur a répondu : rien n\'est enregistré');
  assert.equal(routeAffichee(), null);
  assert.equal(drawRouteLayer(canevas(), STC), 0, 'rien à dessiner, et rien d\'inventé');
});

test('un SILENCE, lui, ferme tout : on ne crée pas sur un câble dont on ne sait rien', async () => {
  clearCableRoute();
  const muet = async () => { throw new Error('réseau'); };
  assert.deepEqual({ ...(await showCableRoute(CABLE, { fetchImpl: muet })) },
    { readable: false, editable: false, creatableHere: false });
  assert.equal(selectedCable(), null);
  assert.equal(await beginRouteCreate({ id: 'C-NEUF' }, STC, { fetchImpl: muet }), null);
  assert.equal(selectedCable(), null,
    'une vue qui n\'a pas répondu ne doit surtout pas se dire « Tracé physique non renseigné »');
  assert.equal(routePanelState(CONTEXTE), null);
});

test('BLOCKER : sur une absence prouvée et une scène inscriptible, le premier relevé s\'ouvre', async () => {
  clearCableRoute();
  const session = await beginRouteCreate({ id: 'C-NEUF', reference: 'C-NEUF', _revision: 6 }, STC,
    { fetchImpl: serveur(SANS_TRACE) });
  assert.ok(session, 'le premier tracé doit être atteignable');
  assert.equal(isEditing(), true);
  assert.equal(session.working(), null, 'la copie de travail part de rien, elle n\'invente aucun segment');
  assert.equal(session.segmentsInCurrentScene().length, 0);
});

test('le premier relevé REDEMANDE l\'autorité pour la scène ouverte, il ne la déduit pas', async () => {
  clearCableRoute();
  let demandes = 0;
  let vue = null;
  await showCableRoute({ id: 'C-NEUF' }, { fetchImpl: serveur(SANS_TRACE) });
  await beginRouteCreate({ id: 'C-NEUF' }, RF1, { fetchImpl: async url => {
    demandes += 1; vue = url; return { ok: true, json: async () => SANS_TRACE };
  } });
  assert.equal(demandes, 1, 'la capacité d\'une vue précédente ne vaut pas pour la scène ouverte');
  assert.match(vue, /sceneType=room/);
  assert.match(vue, /sceneId=902/);
});

test('scène NON inscriptible : `editable` général ne suffit pas à ouvrir un relevé ici', async () => {
  clearCableRoute();
  // Le pilote est habilité sur STC ; la carte est ouverte sur RF1, où il n'a que la lecture.
  const session = await beginRouteCreate({ id: 'C-NEUF' }, RF1,
    { fetchImpl: serveur({ ...SANS_TRACE, creatableHere: false }) });
  assert.equal(session, null, 'une carte ne promet pas ce que le serveur refusera');
  assert.equal(isEditing(), false);
  assert.equal(routePanelState(CONTEXTE).canCreate, false);
});

test('COURSE : un autre exploitant vient de relever le tracé — on ne l\'écrase pas', async () => {
  clearCableRoute();
  /*
   * Entre l'affichage de la fiche et le clic, le cheminement est apparu. Ouvrir un éditeur
   * vide puis l'enregistrer effacerait le relevé de l'autre. La preuve d'absence est donc
   * refaite au moment du geste, et c'est elle qui décide.
   */
  const session = await beginRouteCreate({ id: 'C-NEUF' }, STC,
    { fetchImpl: serveur({ readable: true, editable: true, creatableHere: true, route: ROUTE, revision: 7 }) });
  assert.equal(session, null);
  assert.equal(isEditing(), false);
  // Et l'écran ne reste pas muet : il montre ce qui vient d'apparaître.
  assert.equal(routePresent(), true);
  assert.equal(drawRouteLayer(canevas(), STC), 2, 'le tracé de l\'autre s\'affiche, il ne disparaît pas');
});

test('COURSE INVISIBLE : le tracé existe et nous échappe — c\'est encore un refus', async () => {
  clearCableRoute();
  /*
   * Le cas dangereux : `readable: false` comme sur un câble vierge, `creatableHere: true`,
   * et pourtant un cheminement bel et bien enregistré. Confondre les deux réponses ferait
   * écraser un relevé hors périmètre par un tracé neuf.
   */
  const session = await beginRouteCreate({ id: 'C-CACHE' }, STC, { fetchImpl: serveur(TOUT_MASQUE) });
  assert.equal(session, null, 'invisible n\'est pas inexistant');
  assert.equal(routePresent(), true);
  const etat = routePanelState(CONTEXTE);
  assert.equal(etat.canCreate, false);
  assert.equal(etat.message, PARTIAL_ROUTE_LABEL, 'et l\'écran le dit, au lieu de « non renseigné »');
});

test('un tracé hors périmètre ne se lit JAMAIS « Tracé physique non renseigné »', async () => {
  clearCableRoute();
  await showCableRoute({ id: 'C-CACHE', reference: 'C-CACHE' }, { fetchImpl: serveur(TOUT_MASQUE) });
  const etat = routePanelState(CONTEXTE);
  assert.equal(etat.message, PARTIAL_ROUTE_LABEL);
  assert.notEqual(etat.message, MISSING_ROUTE_LABEL,
    'dire « non renseigné » enverrait un exploitant relever un cheminement déjà documenté');
  assert.equal(etat.canCreate, false);
  assert.equal(etat.canEdit, false);
});

test('la révision écrite reste celle de la copie SYNCHRONISÉE, pas celle de la preuve fraîche', async () => {
  clearCableRoute();
  const local = { id: 'C-NEUF', reference: 'C-NEUF', _revision: 3 };
  const session = await beginRouteCreate(local, STC, { fetchImpl: serveur({ ...SANS_TRACE, revision: 11 }) });
  assert.ok(session);
  assert.equal(routeRevision(), 11, 'la révision servie est informative : elle dit qu\'on est en retard');
  session.startSegment({ naturalWidth: 1000, naturalHeight: 600 });
  session.addWaypoint({ x: 10, y: 10 });
  session.addWaypoint({ x: 90, y: 90 });
  const { ok, cable } = session.payload(local);
  assert.equal(ok, true);
  assert.equal(cable._revision, 3,
    'une révision fraîche collée sur des champs anciens contournerait le contrat de concurrence');
  assert.equal(cable.route.segments.length, 1);
});

test('« Modifier » n\'est plus un « Ajouter » déguisé : sans tracé, il n\'ouvre rien', async () => {
  clearCableRoute();
  await showCableRoute({ id: 'C-NEUF' }, { fetchImpl: serveur(SANS_TRACE) });
  assert.equal(await beginRouteEdit(STC, { fetchImpl: serveur(SANS_TRACE) }), null,
    'modifier suppose un tracé ; le premier relevé passe par sa propre porte');
  assert.equal(isEditing(), false);
});

test('« Ajouter un tracé » n\'apparaît qu\'après une preuve pour la SCÈNE ouverte', async () => {
  clearCableRoute();
  // Sans scène demandée, le serveur ne calcule pas `creatableHere` : le bouton reste fermé.
  await showCableRoute({ id: 'C-NEUF', reference: 'C-NEUF' },
    { fetchImpl: serveur({ readable: false, editable: true, route: null, revision: 6 }) });
  assert.equal(routePanelState(CONTEXTE).canCreate, false, 'ne pas savoir n\'est pas savoir que oui');
  // La carte s'ouvre sur STC : la question est reposée POUR CETTE SCÈNE.
  await refreshRouteView(STC, { fetchImpl: serveur(SANS_TRACE) });
  const etat = routePanelState(CONTEXTE);
  assert.equal(etat.canCreate, true);
  assert.equal(etat.canEdit, false, 'il n\'y a rien à modifier');
  assert.equal(etat.message, MISSING_ROUTE_LABEL);
});

test('une révocation pendant la consultation ferme aussi la création', async () => {
  clearCableRoute();
  await showCableRoute({ id: 'C-NEUF' }, { fetchImpl: serveur(SANS_TRACE) });
  await refreshRouteView(STC, { fetchImpl: serveur(SANS_TRACE) });
  assert.equal(routePanelState(CONTEXTE).canCreate, true);
  await refreshRouteView(STC, { fetchImpl: serveur({ ...SANS_TRACE, editable: false, creatableHere: false }) });
  assert.equal(routePanelState(CONTEXTE).canCreate, false);
});

test('aucun écran ne déduit la création : la règle est énoncée dans le contrat d\'accès', () => {
  const couche = readFileSync(new URL('../cable-route-layer.js', import.meta.url), 'utf8');
  const executable = couche.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Le seul juge de la création est `peutAjouterUnTrace`, et il exige `routePresent`.
  assert.match(executable, /peutAjouterUnTrace\(vue\.access, \{ routePresent: vue\.routePresent \}\)/);
  assert.equal(/routeIsDocumented\([^)]*\)\s*[,)]\s*creatableHere/.test(executable), false);
});

/* ═══════════ ON N'ENTRE JAMAIS PAR `cable.roomId` ═══════════ */

test('la scène d\'entrée vient du TRACÉ, et préfère le contexte de l\'équipement', () => {
  // Le tracé passe par RF1 puis STC : depuis un équipement de STC, on entre par STC.
  const parcours = { version: 1, status: 'verified', segments: [segment(RF1, [{ x: 1, y: 1 }, { x: 2, y: 2 }]), segment(STC, [{ x: 3, y: 3 }, { x: 4, y: 4 }])] };
  assert.deepEqual(entryScene(parcours, { roomId: 901 }), { sceneType: 'room', sceneId: 901 });
  // Sans contexte correspondant : le PREMIER segment du cheminement, jamais un autre.
  assert.deepEqual(entryScene(parcours, { roomId: 999 }), { sceneType: 'room', sceneId: 902 });
  assert.deepEqual(entryScene(parcours, {}), { sceneType: 'room', sceneId: 902 });
});

test('sans segment visible, aucune scène d\'entrée n\'est inventée', () => {
  assert.equal(entryScene(null, { roomId: 901 }), null);
  assert.equal(entryScene({ version: 1, status: 'verified', segments: [] }, { roomId: 901 }), null);
});

test('un tracé qui ne passe que par le plan entre par le plan', () => {
  const surLePlan = { version: 1, status: 'verified',
    segments: [{ sceneType: 'map', sceneId: null, naturalWidth: 100, naturalHeight: 100, waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }], anchors: [] }] };
  assert.deepEqual(entryScene(surLePlan, { roomId: 901 }), { sceneType: 'map', sceneId: null });
});

test('la Fiche360 n\'ouvre plus le tracé depuis `cable.roomId`', () => {
  const source = readFileSync(new URL('../operations-suite.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!code.includes('cable.roomId'),
    'ce champ est un cache hérité : il ne dit rien du cheminement');
  assert.match(code, /entryScene\(vue, \{ roomId: equipment\.roomId, baieId: equipment\.baieId \}\)/);
  assert.match(code, /routeHasVisibleGeometry\(cable\.route\)/,
    'le bouton dépend de ce qu\'il reste à montrer, pas de la pastille');
});
