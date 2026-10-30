/**
 * @file cable-route-access-p0f.test.js — LA CAPACITÉ EST DEMANDÉE, PAS DÉDUITE.
 *
 * Ce fichier défend une seule idée, sous plusieurs angles : un écran ne décide jamais
 * lui-même s'il a le droit de dessiner. Il demande, il ferme en cas de doute, et il
 * redemande avant chaque geste — parce que la copie synchronisée vieillit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACCES_FERME, VUE_FERMEE, normalizeRouteAccess, routeAccessUrl, fetchRouteAccess, fetchRouteView,
  peutVoirLeTrace, peutModifierLeTrace, peutAjouterUnTrace, peutAjouterUnSegment
} from '../cable-route-access.js';
import { naturalPolylineToDisplay } from '../map-coordinates-contract.js';

/* ───────────────────────── FERMÉ PAR DÉFAUT ───────────────────────── */

test('sans réponse exploitable, tout est fermé', () => {
  for (const rien of [null, undefined, 'oui', 42, []]) {
    assert.deepEqual(normalizeRouteAccess(rien), ACCES_FERME);
  }
  assert.deepEqual(ACCES_FERME, { readable: false, editable: false, creatableHere: false });
});

test('seul un `true` franc vaut oui — ni « 1 », ni « oui », ni un objet', () => {
  const rusé = normalizeRouteAccess({ readable: 1, editable: 'oui', creatableHere: {} });
  assert.deepEqual({ ...rusé }, { readable: false, editable: false, creatableHere: false });
});

test('sans scène demandée, `creatableHere` reste false — ne pas savoir n\'est pas savoir que oui', () => {
  assert.equal(normalizeRouteAccess({ readable: true, editable: true }).creatableHere, false);
});

test('réseau coupé, réponse illisible ou refus : fermé', async () => {
  const cassé = async () => { throw new Error('réseau'); };
  assert.deepEqual(await fetchRouteAccess('CAB-1', null, { fetchImpl: cassé }), ACCES_FERME);
  const refus = async () => ({ ok: false, status: 403, json: async () => ({ editable: true }) });
  assert.deepEqual(await fetchRouteAccess('CAB-1', null, { fetchImpl: refus }), ACCES_FERME);
  const illisible = async () => ({ ok: true, json: async () => { throw new Error('json'); } });
  assert.deepEqual(await fetchRouteAccess('CAB-1', null, { fetchImpl: illisible }), ACCES_FERME);
  assert.deepEqual(await fetchRouteAccess('', null, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), ACCES_FERME);
});

test('une réponse franche est reprise telle quelle', async () => {
  const serveur = async () => ({ ok: true, json: async () => ({ readable: true, editable: true, creatableHere: true }) });
  assert.deepEqual({ ...(await fetchRouteAccess('CAB-1', null, { fetchImpl: serveur })) },
    { readable: true, editable: true, creatableHere: true });
});

/* ───────────────────────── L'ADRESSE DEMANDÉE ───────────────────────── */

test('la scène voyage dans la demande, et le plan n\'a pas d\'identifiant', () => {
  assert.equal(routeAccessUrl('CAB-1'), '/api/cables/CAB-1/route-access');
  assert.equal(routeAccessUrl('CAB-1', { sceneType: 'room', sceneId: 901 }),
    '/api/cables/CAB-1/route-access?sceneType=room&sceneId=901');
  assert.equal(routeAccessUrl('CAB-1', { sceneType: 'map', sceneId: null }),
    '/api/cables/CAB-1/route-access?sceneType=map');
  // Un identifiant de câble n'est pas toujours sobre : il doit survivre à l'URL.
  assert.equal(routeAccessUrl('CAB/2026 #1'), '/api/cables/CAB%2F2026%20%231/route-access');
});

test('la scène est bien transmise au serveur, pas simplement calculée localement', async () => {
  let vue = null;
  await fetchRouteAccess('CAB-1', { sceneType: 'baie', sceneId: 'B-12' },
    { fetchImpl: async url => { vue = url; return { ok: true, json: async () => ({}) }; } });
  assert.match(vue, /sceneType=baie/);
  assert.match(vue, /sceneId=B-12/);
});

/* ───────────────────── LES TROIS GESTES, ET LEURS EXIGENCES ───────────────────── */

const AVEC = { traceExistante: true };
const SANS = { traceExistante: false };
const AUCUN_TRACE = { routePresent: false };
const TRACE_ENREGISTRE = { routePresent: true };

test('VOIR : il faut un tracé lisible', () => {
  assert.equal(peutVoirLeTrace({ readable: true }), true);
  assert.equal(peutVoirLeTrace({ readable: false, editable: true }), false);
  assert.equal(peutVoirLeTrace(null), false);
});

test('MODIFIER n\'existe pas sans tracé — même quand `editable` vaut true', () => {
  /*
   * C'est le défaut mesuré sur serveur réel : sur un câble sans tracé, `editable` vaut
   * `true` dès que le câble est modifiable, ce qui ne dit RIEN de la scène ouverte.
   */
  assert.equal(peutModifierLeTrace({ readable: false, editable: true }, SANS), false);
  assert.equal(peutModifierLeTrace({ readable: true, editable: true }, AVEC), true);
  assert.equal(peutModifierLeTrace({ readable: true, editable: false }, AVEC), false);
});

test('AJOUTER un premier tracé exige la scène OUVERTE, pas une autorité générale', () => {
  assert.equal(peutAjouterUnTrace({ editable: true, creatableHere: false }, AUCUN_TRACE), false);
  assert.equal(peutAjouterUnTrace({ editable: true, creatableHere: true }, AUCUN_TRACE), true);
  // Il y a déjà un tracé : ce geste-là n'est pas « ajouter un tracé ».
  assert.equal(peutAjouterUnTrace({ editable: true, creatableHere: true }, TRACE_ENREGISTRE), false);
});

test('AJOUTER un premier tracé exige une absence PROUVÉE, pas une absence supposée', () => {
  /*
   * `routePresent` inconnu ferme le geste. Un écran qui n'a pas posé la question ne peut pas
   * conclure qu'il n'y a rien : la seule chose qu'il sait, c'est qu'il ne sait pas.
   */
  assert.equal(peutAjouterUnTrace({ creatableHere: true }, {}), false);
  assert.equal(peutAjouterUnTrace({ creatableHere: true }, { routePresent: undefined }), false);
  assert.equal(peutAjouterUnTrace({ creatableHere: true }), false);
  // Et « aucun segment visible » n'est PAS « aucun tracé » : un cheminement entièrement
  // hors périmètre est bien enregistré, et le créer l'écraserait.
  assert.equal(peutAjouterUnTrace({ readable: false, creatableHere: true }, TRACE_ENREGISTRE), false);
});

test('AJOUTER un segment exige LES DEUX autorités', () => {
  assert.equal(peutAjouterUnSegment({ editable: true, creatableHere: false }, AVEC), false);
  assert.equal(peutAjouterUnSegment({ editable: false, creatableHere: true }, AVEC), false);
  assert.equal(peutAjouterUnSegment({ editable: true, creatableHere: true }, AVEC), true);
});

test('les trois gestes sont énoncés UNE fois, dans ce contrat', () => {
  // Trois copies de la règle finiraient par différer, et c'est toujours la plus permissive
  // qui ferait la faille.
  const source = readFileSync(new URL('../cable-route-access.js', import.meta.url), 'utf8');
  for (const geste of ['peutVoirLeTrace', 'peutModifierLeTrace', 'peutAjouterUnTrace', 'peutAjouterUnSegment']) {
    assert.match(source, new RegExp(`export (const|function) ${geste}`));
  }
});

/* ═════════ `readable: false` NE VEUT PAS DIRE « IL N'Y A PAS DE TRACÉ » ═════════ */

const repond = charge => async () => ({ ok: true, json: async () => charge });

test('un câble SANS tracé : le serveur répond readable:false ET creatableHere:true', async () => {
  /*
   * C'est la réponse MESURÉE du serveur réel, pas une hypothèse d'écran : `cableRouteView`
   * rend `null` quand rien n'est enregistré, et `readable` en découle. Le premier relevé
   * doit rester possible malgré ce `false`.
   */
  const vue = await fetchRouteView('CAB-SANS', { sceneType: 'room', sceneId: 901 },
    { fetchImpl: repond({ readable: false, editable: true, creatableHere: true, route: null, revision: 6 }) });
  assert.equal(vue.served, true);
  assert.equal(vue.access.readable, false);
  assert.equal(vue.route, null);
  assert.equal(vue.routePresent, false, 'le serveur a répondu : il n\'y a rien');
  assert.equal(peutAjouterUnTrace(vue.access, vue), true, 'le premier relevé reste atteignable');
});

test('un tracé entièrement hors périmètre : readable:false AUSSI, mais il existe', async () => {
  const vue = await fetchRouteView('CAB-CACHE', { sceneType: 'room', sceneId: 901 },
    { fetchImpl: repond({ readable: false, editable: false, creatableHere: true,
      route: { version: 1, status: 'verified', segments: [], partial: true }, revision: 9 }) });
  assert.equal(vue.access.readable, false, 'même booléen que le câble sans tracé');
  assert.equal(vue.routePresent, true, 'et pourtant un cheminement est bien enregistré');
  assert.equal(peutAjouterUnTrace(vue.access, vue), false,
    'créer ici écraserait le relevé d\'un autre, invisible mais réel');
});

test('la géométrie servie traverse même quand `readable` vaut false', async () => {
  // Elle ne porte alors AUCUN segment — c'est précisément ce qui fait `readable: false` —
  // mais l'écran doit pouvoir dire « hors périmètre » plutôt que « non renseigné ».
  const ampute = { version: 1, status: 'proposed', segments: [], partial: true };
  const vue = await fetchRouteView('CAB-CACHE', null, { fetchImpl: repond({ readable: false, route: ampute }) });
  assert.deepEqual(vue.route, ampute);
  assert.equal(vue.route.segments.length, 0, 'aucune géométrie masquée ne fuit');
  assert.equal(Object.keys(vue.route).includes('hidden'), false, 'ni le nombre de segments masqués');
});

test('`routePresent` ne dit QUE la présence : aucun identifiant, aucun compte, aucune zone', async () => {
  const vue = await fetchRouteView('CAB-CACHE', null,
    { fetchImpl: repond({ readable: false, route: { version: 1, status: 'verified', segments: [], partial: true } }) });
  assert.equal(typeof vue.routePresent, 'boolean');
  const rendu = JSON.stringify(vue);
  for (const secret of ['zoneId', 'zoneIds', 'grant', 'membership', 'hiddenCount', 'sceneId']) {
    assert.equal(rendu.includes(secret), false, `la vue ne doit pas porter ${secret}`);
  }
});

test('un silence n\'est pas une absence : sans réponse, on ne crée RIEN', async () => {
  /*
   * Réseau coupé, session expirée, câble hors périmètre (404) : la vue fermée dit
   * `served: false`. La confondre avec « le serveur a répondu qu'il n'y a rien » ferait
   * ouvrir un premier relevé sur un câble dont on ne sait strictement rien.
   */
  const casse = async () => { throw new Error('réseau'); };
  const refus = async () => ({ ok: false, status: 404, json: async () => ({ creatableHere: true }) });
  for (const impl of [casse, refus]) {
    const vue = await fetchRouteView('CAB-1', { sceneType: 'room', sceneId: 901 }, { fetchImpl: impl });
    assert.equal(vue.served, false);
    assert.equal(vue.routePresent, false);
    assert.equal(peutAjouterUnTrace(vue.access, vue), false, 'fermé par défaut, création comprise');
  }
  assert.equal(VUE_FERMEE.served, false);
});

/* ───────────────────── LA GÉOMÉTRIE AFFICHÉE ───────────────────── */

test('pixels naturels → espace de dessin : une mise à l\'échelle, rien d\'autre', () => {
  const points = naturalPolylineToDisplay(
    { naturalWidth: 1000, naturalHeight: 500, waypoints: [{ x: 0, y: 0 }, { x: 500, y: 250 }, { x: 1000, y: 500 }] },
    { width: 2000, height: 1200 });
  assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 1000, y: 600 }, { x: 2000, y: 1200 }]);
});

test('le même point relu désigne le même endroit, quelle que soit la taille affichée', () => {
  const segment = { naturalWidth: 800, naturalHeight: 400, waypoints: [{ x: 200, y: 100 }] };
  const petit = naturalPolylineToDisplay(segment, { width: 400, height: 200 });
  const grand = naturalPolylineToDisplay(segment, { width: 1600, height: 800 });
  // La position RELATIVE à l'image est l'invariant — c'est tout l'objet de #170.
  assert.equal(petit[0].x / 400, grand[0].x / 1600);
  assert.equal(petit[0].y / 200, grand[0].y / 800);
  assert.equal(petit[0].x / 400, 0.25);
});

test('une géométrie inutilisable ne rend AUCUN point plutôt qu\'une approximation', () => {
  const cible = { width: 2000, height: 1200 };
  for (const cassé of [
    { naturalWidth: 0, naturalHeight: 500, waypoints: [{ x: 1, y: 1 }] },
    { naturalWidth: 100, naturalHeight: 0, waypoints: [{ x: 1, y: 1 }] },
    { naturalWidth: 100, naturalHeight: 100, waypoints: [{ x: NaN, y: 1 }] },
    { naturalWidth: 100, naturalHeight: 100, waypoints: [{ x: 1, y: 1 }, 'ici'] }
  ]) {
    assert.deepEqual(naturalPolylineToDisplay(cassé, cible), [],
      'une polyligne à demi convertie se lirait comme un relevé');
  }
  assert.deepEqual(naturalPolylineToDisplay({ naturalWidth: 100, naturalHeight: 100, waypoints: [{ x: 1, y: 1 }] },
    { width: 0, height: 100 }), []);
});
