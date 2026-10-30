/**
 * @file cable-route-contract-p0f.test.js — LE TRACÉ : CE QU'IL DIT, ET CE QU'IL TAIT.
 *
 * Deux familles d'exigences, et la seconde est la raison d'être de ce lot :
 *
 *   FORME    un tracé corrompu est REFUSÉ, jamais réparé en silence. Une géométrie
 *            « corrigée » devient une géométrie fausse que plus personne ne sait fausse,
 *            et sur un plan d'installation cela se lit comme un relevé.
 *
 *   SECRET   un câble peut être visible alors qu'une partie de son cheminement traverse
 *            une zone protégée. Ces coordonnées ne sortent pas — et, plus important
 *            encore, la vue amputée ne doit jamais pouvoir revenir écraser le tracé
 *            complet. Ce serait détruire par une sauvegarde honnête ce que la protection
 *            venait de mettre à l'abri.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CABLE_ROUTE_VERSION, ROUTE_STATUSES, ROUTE_SCENE_TYPES, ROUTE_STATUS_LABELS,
  MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL,
  normalizeCableRoute, validateCableRoute, routeSegmentsForScene, routeSceneRef, routeScenes,
  routeIsPartial, routeIsDocumented, routeStatusLabel, sanitizeCableRoute, sameCableRoute,
  normalizeCableRecord, validateCableShape
} from '../connectivity-contract.js';
import { MAP_SCENES } from '../map-coordinates-contract.js';

const serve = readFileSync(new URL('../scripts/serve.js', import.meta.url), 'utf8');

/** Le CODE seul : une règle se lit dans ce qui s'exécute, pas dans ce qui l'explique. */
const sansCommentaires = bloc => bloc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(ligne => !/^\s*\/\//.test(ligne)).join('\n');

const point = (x, y) => ({ x, y });
const segment = (extra = {}) => ({
  sceneType: 'room', sceneId: 'STC', naturalWidth: 2000, naturalHeight: 1000,
  waypoints: [point(10, 10), point(500, 400)], anchors: [], ...extra
});
const trace = (segments, status = 'verified') => ({ version: 1, status, segments });

/* Le câble inter-salles du scénario : STC → plan du site → RF1. */
const SEG_STC = segment({ sceneType: 'room', sceneId: 'STC', waypoints: [point(10, 10), point(400, 300)] });
const SEG_PLAN = segment({ sceneType: 'map', sceneId: null, naturalWidth: 4000, naturalHeight: 3000,
  waypoints: [point(400, 300), point(2200, 1500)] });
const SEG_RF1 = segment({ sceneType: 'room', sceneId: 'RF1', waypoints: [point(50, 60), point(700, 200)] });
const TRACE_COMPLET = trace([SEG_STC, SEG_PLAN, SEG_RF1]);

/* ────────────────────────────── FORME ────────────────────────────── */

test('un câble sans tracé n\'en invente pas un', () => {
  assert.equal(normalizeCableRoute(null), null);
  assert.equal(normalizeCableRoute(undefined), null);
  assert.equal(routeIsDocumented(null), false);
  assert.equal(routeStatusLabel(null), MISSING_ROUTE_LABEL);
  assert.equal(MISSING_ROUTE_LABEL, 'Tracé physique non renseigné');
});

test('un tracé valide traverse la normalisation sans perdre sa géométrie', () => {
  const propre = normalizeCableRoute(TRACE_COMPLET);
  assert.equal(propre.version, CABLE_ROUTE_VERSION);
  assert.equal(propre.status, 'verified');
  assert.equal(propre.segments.length, 3);
  assert.deepEqual(propre.segments[1].waypoints, [point(400, 300), point(2200, 1500)]);
  assert.equal(propre.segments[2].sceneId, 'RF1');
});

test('les scènes du tracé sont EXACTEMENT celles de la carte — aucune liste parallèle', () => {
  assert.deepEqual([...ROUTE_SCENE_TYPES], [...MAP_SCENES],
    'deux listes de scènes finiraient par diverger');
});

test('chaque forme corrompue est REFUSÉE, et nommée', () => {
  const cas = [
    ['version non prise en charge', { ...TRACE_COMPLET, version: 2 }],
    ['statut inconnu', { ...TRACE_COMPLET, status: 'peut-être' }],
    ['scène inconnue', trace([segment({ sceneType: 'satellite' })])],
    ['salle sans identifiant', trace([segment({ sceneType: 'room', sceneId: null })])],
    ['baie sans identifiant', trace([segment({ sceneType: 'baie', sceneId: '' })])],
    ['plan avec identifiant', trace([segment({ sceneType: 'map', sceneId: 'STC' })])],
    ['largeur naturelle nulle', trace([segment({ naturalWidth: 0 })])],
    ['hauteur naturelle négative', trace([segment({ naturalHeight: -10 })])],
    ['coordonnée NaN', trace([segment({ waypoints: [point(NaN, 5), point(1, 2)] })])],
    ['coordonnée infinie', trace([segment({ waypoints: [point(Infinity, 5), point(1, 2)] })])],
    ['point hors image', trace([segment({ waypoints: [point(10, 10), point(99999, 5)] })])],
    ['point négatif', trace([segment({ waypoints: [point(-1, 10), point(5, 5)] })])],
    ['point malformé', trace([segment({ waypoints: [point(1, 1), 'ici'] })])],
    ['un seul point ne fait pas un chemin', trace([segment({ waypoints: [point(1, 1)] })])],
    ['waypoints absents', trace([segment({ waypoints: undefined })])],
    ['segments absents', { version: 1, status: 'verified' }],
    ['aucun segment', trace([])],
    ['ancre de rôle inconnu', trace([segment({ anchors: [{ role: 'milieu', x: 1, y: 1 }] })])],
    ['ancre hors image', trace([segment({ anchors: [{ role: 'source', x: 99999, y: 1 }] })])]
  ];
  for (const [nom, valeur] of cas) {
    const verdict = validateCableRoute(valeur);
    assert.equal(verdict.valid, false, `« ${nom} » aurait dû être refusé`);
    assert.ok(verdict.errors.length > 0, `« ${nom} » refusé sans motif`);
    assert.equal(verdict.value, null, `« ${nom} » ne doit produire AUCUNE valeur`);
  }
});

test('un tracé à moitié valide ne rend pas sa moitié valide', () => {
  const moitie = trace([SEG_STC, segment({ naturalWidth: 0 })]);
  const verdict = validateCableRoute(moitie);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.value, null, 'garder le bon segment reviendrait à inventer l\'autre');
});

test('les trois statuts restent DISTINCTS et « proposé » ne se dit jamais vérifié', () => {
  assert.deepEqual([...ROUTE_STATUSES], ['verified', 'proposed', 'unknown']);
  assert.equal(routeStatusLabel(trace([SEG_STC], 'verified')), 'Tracé vérifié');
  assert.equal(routeStatusLabel(trace([SEG_STC], 'proposed')), 'Tracé proposé');
  assert.match(ROUTE_STATUS_LABELS.proposed, /Proposé/i);
  assert.ok(!/vérifié/i.test(ROUTE_STATUS_LABELS.proposed));
  assert.ok(!/vérifié$/i.test(ROUTE_STATUS_LABELS.unknown.replace(/non vérifié/i, '')));
});

/* ────────────────────────── LECTURE PAR SCÈNE ────────────────────────── */

test('seule la scène COURANTE rend ses segments', () => {
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'map', sceneId: null }), [SEG_PLAN]);
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'room', sceneId: 'STC' }), [SEG_STC]);
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'room', sceneId: 'RF1' }), [SEG_RF1]);
});

test('la géométrie d\'une AUTRE scène ne se dessine jamais ici', () => {
  // Les coordonnées de STC appartiennent à l'image de STC : posées sur RF1, elles
  // placeraient un trait exact au mauvais endroit, ce qui se lit comme un relevé.
  const dansRF1 = routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'room', sceneId: 'RF1' });
  assert.ok(!dansRF1.includes(SEG_STC));
  assert.ok(!dansRF1.includes(SEG_PLAN));
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'room', sceneId: 'AUTRE' }), []);
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'baie', sceneId: 'STC' }), [],
    'même identifiant, autre type de scène : ce n\'est pas la même image');
  assert.deepEqual(routeSegmentsForScene(TRACE_COMPLET, { sceneType: 'room' }), [],
    'une salle sans identifiant ne désigne aucune image');
});

test('le tracé inter-salles reste SÉPARÉ — jamais une polyligne continue inventée', () => {
  assert.equal(TRACE_COMPLET.segments.length, 3);
  const scenes = routeScenes(TRACE_COMPLET);
  assert.deepEqual(scenes.map(s => `${s.sceneType}:${s.sceneId ?? ''}`), ['room:STC', 'map:', 'room:RF1']);
  // Chaque scène a ses PROPRES dimensions d'image : il n'existe aucun espace commun où
  // relier ces points sans mentir.
  assert.notEqual(SEG_STC.naturalWidth, SEG_PLAN.naturalWidth);
});

test('un segment intermédiaire manquant RESTE manquant', () => {
  const sansPlan = trace([SEG_STC, SEG_RF1]);
  const propre = normalizeCableRoute(sansPlan);
  assert.equal(propre.segments.length, 2);
  assert.deepEqual(routeSegmentsForScene(propre, { sceneType: 'map', sceneId: null }), [],
    'aucun segment de plan ne doit être synthétisé pour combler le trou');
});

test('les coordonnées restent en pixels NATURELS — invariantes au redimensionnement', () => {
  // Rien dans le contrat ne dépend d'une taille d'affichage : la même donnée relue rend
  // les mêmes points, quel que soit l'écran.
  const propre = normalizeCableRoute(TRACE_COMPLET);
  assert.deepEqual(normalizeCableRoute(propre), propre);
  assert.deepEqual(propre.segments[0].waypoints, SEG_STC.waypoints);
  assert.equal(propre.segments[0].naturalWidth, 2000);
});

/* ────────────────────────── PROTECTION ────────────────────────── */

const seulementSTC = scene => scene.sceneType === 'room' && scene.sceneId === 'STC';

test('un tracé dont TOUTES les scènes sont autorisées sort intact et sans marqueur', () => {
  const complet = sanitizeCableRoute(TRACE_COMPLET, () => true);
  assert.equal(routeIsPartial(complet), false);
  assert.equal(complet.segments.length, 3);
  assert.ok(!('partial' in complet));
});

test('un segment hors périmètre ne laisse RIEN passer', () => {
  const vue = sanitizeCableRoute(TRACE_COMPLET, seulementSTC);
  assert.equal(routeIsPartial(vue), true);
  assert.equal(vue.segments.length, 1);
  const rendu = JSON.stringify(vue);
  for (const secret of ['RF1', '2200', '1500', '4000', '3000', '700']) {
    assert.ok(!rendu.includes(secret), `fuite : « ${secret} » survit à la sanitisation`);
  }
});

test('le tracé partiel ne dit pas COMBIEN de segments manquent', () => {
  // Le nombre de scènes traversées est une information de topologie.
  const vue = sanitizeCableRoute(TRACE_COMPLET, seulementSTC);
  const cles = Object.keys(vue).sort();
  assert.deepEqual(cles, ['partial', 'segments', 'status', 'version'],
    'aucune clé de comptage ne doit apparaître');
  assert.equal(vue.partial, true);
});

test('un tracé entièrement masqué se déclare hors périmètre, pas absent', () => {
  const vue = sanitizeCableRoute(TRACE_COMPLET, () => false);
  assert.equal(vue.segments.length, 0);
  assert.equal(routeIsPartial(vue), true);
  // « Non renseigné » dirait que personne ne l'a relevé : c'est faux, et cela enverrait un
  // exploitant relever un cheminement déjà documenté.
  assert.equal(routeStatusLabel(vue), PARTIAL_ROUTE_LABEL);
  assert.notEqual(routeStatusLabel(vue), MISSING_ROUTE_LABEL);
});

test('un câble sans tracé ne devient pas « partiel » par sanitisation', () => {
  assert.equal(sanitizeCableRoute(null, () => false), null);
  assert.equal(sanitizeCableRoute(trace([]), () => false), null);
});

/* ────────────────── LE TRACÉ EST UN CHAMP FORMEL DU CÂBLE ────────────────── */

test('le tracé est un champ FORMEL du câble, pas un rescapé du `...source`', () => {
  const cable = normalizeCableRecord({
    id: 'CAB-1', reference: 'CAB-1', category: 'Vidéo', type: 'SDI',
    sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT1',
    destinationType: 'equipment', destinationId: 20, destinationPortId: 'IN1',
    route: TRACE_COMPLET
  });
  assert.ok('route' in cable, 'le champ doit exister même quand il est nul');
  assert.equal(cable.route.segments.length, 3);
  const sansTrace = normalizeCableRecord({ id: 'CAB-2', reference: 'CAB-2' });
  assert.equal(sansTrace.route, null);
});

test('un tracé MALFORMÉ fait échouer la forme du câble — il ne disparaît pas en silence', () => {
  const base = {
    id: 'CAB-3', reference: 'CAB-3', category: 'Vidéo', type: 'SDI',
    sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT1',
    destinationType: 'equipment', destinationId: 20, destinationPortId: 'IN1'
  };
  const verdict = validateCableShape({ ...base, route: trace([segment({ naturalWidth: 0 })]) });
  assert.ok(verdict.errors.some(erreur => erreur.startsWith('Tracé :')),
    'la forme du câble doit porter le refus du tracé');
  assert.equal(validateCableShape({ ...base, route: TRACE_COMPLET }).errors.length, 0);
});

test('`connectivity-contract.js` reste une FEUILLE — le tracé n\'y introduit aucun cycle', () => {
  const source = readFileSync(new URL('../connectivity-contract.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m,
    'quinze modules en dépendent : un import ici rouvre le risque de cycle');
});

/* ────────────────── COMPARAISON — LA QUESTION DÉCISIVE DU SERVEUR ────────────────── */

test('deux tracés identiques se reconnaissent, un point déplacé ne passe pas', () => {
  assert.equal(sameCableRoute(normalizeCableRoute(TRACE_COMPLET), normalizeCableRoute(TRACE_COMPLET)), true);
  const bouge = trace([{ ...SEG_STC, waypoints: [point(10, 10), point(401, 300)] }, SEG_PLAN, SEG_RF1]);
  assert.equal(sameCableRoute(normalizeCableRoute(TRACE_COMPLET), normalizeCableRoute(bouge)), false);
});

test('l\'ORDRE des segments compte : c\'est l\'ordre du cheminement', () => {
  const inverse = trace([SEG_RF1, SEG_PLAN, SEG_STC]);
  assert.equal(sameCableRoute(normalizeCableRoute(TRACE_COMPLET), normalizeCableRoute(inverse)), false);
});

test('une vue partielle n\'est jamais « la même » que le tracé complet', () => {
  const vue = sanitizeCableRoute(TRACE_COMPLET, seulementSTC);
  assert.equal(sameCableRoute(vue, TRACE_COMPLET), false,
    'c\'est cette différence qui empêche une vue amputée de passer pour le tout');
  assert.equal(sameCableRoute(null, null), true);
  assert.equal(sameCableRoute(null, TRACE_COMPLET), false);
});

/* ────────────────── LE SERVEUR — CE QUE LE CÂBLAGE DOIT PORTER ────────────────── */

test('serveur : la sanitisation du tracé passe par l\'autorisation CANONIQUE des scènes', () => {
  assert.match(serve, /async function routeSceneReadable\(user, scene\)/);
  // Salle et baie : les permissions canoniques de lecture, pas des permissions inventées.
  assert.match(serve, /ROUTE_SCENE_PERMISSIONS = Object\.freeze\(\{ room: 'zone\.summary\.read', baie: 'equipment\.read' \}\)/);
  // Plan du site : le contrat existant, qui exige déjà toutes les zones représentées.
  assert.match(serve, /sceneType === 'map'\) return access\.canReadOperationalMap\(user\)/);
  // Et surtout PAS le cache hérité.
  const bloc = serve.slice(serve.indexOf('async function routeSceneReadable'), serve.indexOf('const cleScene'));
  assert.ok(!/roomId/.test(bloc), 'le cache `cable.roomId` ne doit jamais décider d\'une autorisation');
});

test('serveur : une scène introuvable FERME, elle ne s\'ouvre pas par défaut', () => {
  // La résolution canonique porte désormais cette décision, et elle précède tout jugement
  // de droit — y compris la dérogation des rôles globaux.
  const bloc = blocServeur('async function routeSceneResolution', 'const routeSceneExists');
  assert.match(bloc, /if \(!record\) return \{ exists: false, zoneIds: \[\] \};/,
    'protectedDependencyStub rend `null` pour un identifiant introuvable : cela se lirait « visible »');
  assert.match(blocServeur('async function routeSceneReadable', 'async function routeSceneWritable'),
    /if \(!exists\) return false;/);
});

test('serveur : le tracé sortant est sanitisé sur le MÊME chemin que les extrémités', () => {
  const bloc = serve.slice(serve.indexOf("if (storeName === 'cables') {", serve.indexOf('async function redactCrossZoneRelations')));
  assert.match(bloc, /output\.route = sanitizeCableRoute\(output\.route, await readableRouteScenes\(user, output\.route\)\)/);
});

test('serveur : une vue partielle ne peut pas remplacer le tracé complet', () => {
  const bloc = serve.slice(serve.indexOf('async function resolveIncomingCableRoute'), serve.indexOf('async function redactCrossZoneRelations'));
  // Le cas qui compte : il n'a pas touché au tracé → on PRÉSERVE le stocké.
  assert.match(bloc, /if \(sameCableRoute\(entrant, vueServie\)\) return stocke;/);
  // Il l'a modifié sans l'avoir vu en entier → refus nommé.
  assert.match(bloc, /'ROUTE_SCOPE_INSUFFICIENT'/);
  // Aucune géométrie écrite dans une scène où l'on n'a pas AUTORITÉ.
  assert.match(bloc, /'ROUTE_SCENE_EDIT_FORBIDDEN'/);
  // Les deux refus portent des NOMS distincts : « je n'ai pas vu tout ce que je remplace »
  // et « je le vois mais je n'ai pas le droit de le modifier » sont deux faits différents.
  assert.notEqual('ROUTE_SCENE_EDIT_FORBIDDEN', 'ROUTE_SCOPE_INSUFFICIENT');
  // Et jamais de fusion inventée à la place de l'écrivain — dans le CODE, pas dans la prose.
  assert.ok(!/merge|fusion/i.test(sansCommentaires(bloc)),
    'fusionner inventerait un tracé que personne n\'a relevé');
});

test('serveur : la décision de tracé précède TOUTE persistance', () => {
  const appel = serve.indexOf('resolveIncomingCableRoute(user, record, existing)');
  assert.ok(appel > 0, 'le point d\'appel canonique doit exister');
  const normalisation = serve.indexOf('await normalizeIncomingCable(record, recordId)');
  assert.ok(normalisation < appel, 'la forme se valide avant : il faut un enregistrement canonique');
  const ecriture = serve.indexOf('access.roleAllowsStoreAction(user, storeName, existing', appel);
  assert.ok(ecriture > appel, 'la garde de tracé doit précéder les gardes d\'écriture et la persistance');
});

/* ────────────────── L'ORDRE DES QUESTIONS DU SERVEUR ──────────────────
 *
 * Défaut trouvé en épreuve de bout en bout, sur serveur réel, et corrigé : une première
 * version refusait tout tracé marqué `partial` AVANT de regarder s'il s'agissait de la vue
 * qu'on venait de servir. Un pilote qui corrigeait la simple RÉFÉRENCE d'un câble recevait
 * alors 403 — un câble dont une partie du cheminement est protégée devenait totalement
 * inéditable, et la protection se muait en blocage de l'exploitation courante.
 * ──────────────────────────────────────────────────────────────────── */

test('serveur : « a-t-il touché au tracé ? » se demande AVANT « son tracé est-il une vue ? »', () => {
  const bloc = serve.slice(serve.indexOf('async function resolveIncomingCableRoute'),
                           serve.indexOf('async function redactCrossZoneRelations'));
  const preservation = bloc.indexOf('if (sameCableRoute(entrant, vueServie)) return stocke;');
  const refusPartiel = bloc.indexOf("Un tracé partiel ne peut pas être enregistré comme un relevé.");
  assert.ok(preservation > 0, 'la préservation du tracé stocké doit exister');
  assert.ok(refusPartiel > preservation,
    'le refus général d\'un tracé partiel ne doit jamais précéder la question « l\'a-t-il modifié ? »');
});

test('serveur : effacer un tracé qu\'on n\'a pas vu en entier tombe sous le même refus', () => {
  const bloc = serve.slice(serve.indexOf('async function resolveIncomingCableRoute'),
                           serve.indexOf('async function redactCrossZoneRelations'));
  // `entrant === null` n'est pas égal à la vue servie : il traverse donc le dernier `throw`.
  // Aucune branche ne doit lui ouvrir un passage.
  assert.ok(!/entrant === null|!entrant\s*\)\s*return/.test(bloc),
    'une exception pour la suppression laisserait effacer un tracé protégé');
});

test('l\'épreuve de bout en bout du tracé est un GATE de la CI, pas un script oublié', () => {
  const ci = readFileSync(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8');
  assert.match(ci, /node scripts\/cable-route-e2e\.mjs/,
    'la garde la plus importante de ce lot doit tourner à chaque vérification');
});

/* ══════════════════════════════════════════════════════════════════════════
 * F2a — CLÔTURE DE SÉCURITÉ : VOIR UNE SCÈNE ≠ POUVOIR Y MODIFIER LE TRACÉ
 *
 * FAILLE MESURÉE SUR SERVEUR RÉEL avant correction. Un câble dont les deux EXTRÉMITÉS sont
 * dans STC satisfait la garde d'écriture du câble avec le seul `cable.edit` sur STC. Si son
 * cheminement traverse RF1 et que l'utilisateur y détient de quoi LIRE mais aucun
 * `cable.edit`, le tracé lui arrivait complet — donc non `partial` — et la décision
 * d'écriture se fondait sur la même primitive que la lecture :
 *
 *   déplacer un point DANS RF1  → 200, la géométrie stockée passait de x=777 à x=2
 *   retirer le segment RF1      → 200
 *   supprimer le tracé entier   → 200, RF1 compris
 *
 * Trois écritures sur la métadonnée physique d'une zone sans aucune autorité d'édition.
 * ══════════════════════════════════════════════════════════════════════════ */

/*
 * Le marqueur de fin se cherche APRÈS le début — sinon une occurrence antérieure rend une
 * tranche vide, et une assertion sur du vide ne prouve rien tout en semblant échouer
 * franchement.
 */
const blocServeur = (depuis, jusqu) => {
  const debut = serve.indexOf(depuis);
  assert.ok(debut >= 0, `repère introuvable dans serve.js : ${depuis}`);
  const fin = serve.indexOf(jusqu, debut + depuis.length);
  assert.ok(fin > debut, `repère de fin introuvable après « ${depuis} » : ${jusqu}`);
  return serve.slice(debut, fin);
};

test('clôture : LECTURE et ÉCRITURE sont deux décisions SÉPARÉES et nommées', () => {
  assert.match(serve, /async function routeSceneReadable\(user, scene\)/);
  assert.match(serve, /async function routeSceneWritable\(user, scene\)/);
  // Plus aucune trace de l'ancienne primitive unique.
  assert.ok(!/routeSceneVisible|visibleRouteScenes/.test(serve),
    'une seule primitive pour lire et pour écrire est exactement la faille refermée');
});

test('clôture : la SANITISATION sortante n\'utilise que l\'autorité de LECTURE', () => {
  const bloc = blocServeur("if (storeName === 'cables') {", "if (storeName === 'screens'");
  assert.match(bloc, /sanitizeCableRoute\(output\.route, await readableRouteScenes\(user, output\.route\)\)/);
  assert.ok(!/writableRouteScenes/.test(bloc),
    'exiger l\'autorité d\'écriture pour AFFICHER cacherait le tracé à ceux qui ont le droit de le voir');
});

test('clôture : l\'ÉCRITURE exige `cable.edit` sur TOUTES les zones de la scène', () => {
  const bloc = blocServeur('async function routeSceneWritable', 'const writableRouteScenes');
  assert.match(bloc, /access\.hasPermission\(user, zoneId, 'cable\.edit'\)/);
  assert.match(bloc, /decisions\.every\(Boolean\)/,
    '« habilité dans l\'une de ses zones » ne suffit pas là où le contrat d\'écriture les exige toutes');
  // La lecture est un préalable, pas une alternative.
  assert.match(bloc, /if \(!\(await routeSceneReadable\(user, scene\)\)\) return false;/);
});

test('clôture : ressource introuvable ou zones indécidables → FERMÉ', () => {
  const resolution = blocServeur('async function routeSceneResolution', 'const routeSceneExists');
  assert.match(resolution, /if \(!record\) return \{ exists: false, zoneIds: \[\] \};/,
    'une scène introuvable n\'existe pas et ne rend aucune zone');
  const writable = blocServeur('async function routeSceneWritable', "/** Les scènes d'un tracé où cet utilisateur");
  assert.match(writable, /if \(!exists\) return false;/, 'ressource absente = refus');
  assert.match(writable, /if \(!zoneIds\.length\) return false;/,
    'aucune zone résolue = autorité indécidable = refus');
});

test('clôture : le plan du site exige sa LECTURE et l\'autorité sur TOUTES ses zones', () => {
  const resolution = blocServeur('async function routeSceneResolution', 'const routeSceneExists');
  assert.match(resolution, /await access\.operationalMapZones\(\)/,
    'la liste des zones du plan est celle du contrat existant — aucun cache inventé');
  // `routeSceneWritable` impose déjà `routeSceneReadable`, qui pour la carte est
  // `canReadOperationalMap` : lire le plan ET détenir cable.edit sur toutes ses zones.
  const readable = blocServeur('async function routeSceneReadable', 'async function routeSceneWritable');
  assert.match(readable, /canReadOperationalMap\(user\)/);
});

test('clôture : la dérogation globale reste celle du contrôle d\'accès, pas une nouvelle', () => {
  const bloc = blocServeur('async function routeSceneWritable', 'const writableRouteScenes');
  assert.match(bloc, /if \(seesEverything\(user\?\.role\)\) return true;/);
  // `seesEverything` (serve.js) et `roleSeesEveryZone` (roles.js) désignent le même
  // couple administrateur + manager : aucune sémantique nouvelle n'est créée ici.
  const roles = readFileSync(new URL('../roles.js', import.meta.url), 'utf8');
  assert.match(roles, /export function roleSeesEveryZone\(role\) \{[\s\S]*?ADMIN[\s\S]*?MANAGER/);
});

test('clôture : l\'autorité d\'écriture porte sur le tracé PROPOSÉ **et** sur le tracé STOCKÉ', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  assert.match(bloc, /for \(const route of \[entrant, stocke\]\)/,
    'remplacer ou supprimer un tracé efface CHACUN de ses segments, y compris ceux qu\'on ne peut pas modifier');
  assert.match(bloc, /writableRouteScenes\(user, route\)/);
  assert.match(bloc, /'ROUTE_SCENE_EDIT_FORBIDDEN'/);
});

test('clôture : un tracé INCHANGÉ n\'exige aucune autorité d\'écriture', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  const preservation = bloc.indexOf('if (sameCableRoute(entrant, vueServie)) return stocke;');
  const controleEcriture = bloc.indexOf('for (const route of [entrant, stocke])');
  assert.ok(preservation > 0 && preservation < controleEcriture,
    'sinon un câble dont le cheminement sort du périmètre deviendrait totalement inéditable');
});

test('clôture : aucune fusion inventée — la seule opération ouverte est celle qui ne change rien', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  assert.ok(!/merge|fusion|concat|\.\.\.stocke\.segments/i.test(sansCommentaires(bloc)),
    'garder d\'office les segments non modifiables fabriquerait un tracé que personne n\'a relevé');
});

test('clôture : le refus ne dit pas QUELLE scène ni QUELLE habilitation manque', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  const message = bloc.slice(bloc.indexOf('ROUTE_SCENE_EDIT_FORBIDDEN') - 220, bloc.indexOf('ROUTE_SCENE_EDIT_FORBIDDEN'));
  for (const fuite of ['sceneId', 'cable.edit', 'zoneId', 'RF1']) {
    assert.ok(!message.includes(fuite), `le refus révèle « ${fuite} » : c'est décrire le périmètre d'autrui`);
  }
});

test('clôture : la décision précède TOUTE persistance', () => {
  const appel = serve.indexOf('resolveIncomingCableRoute(user, record, existing)');
  const ecriture = serve.indexOf('access.roleAllowsStoreAction(user, storeName, existing', appel);
  assert.ok(appel > 0 && ecriture > appel,
    'la garde de tracé doit précéder les gardes d\'écriture et la persistance');
});

test('clôture : l\'épreuve LECTURE > ÉDITION est dans le gate de bout en bout', () => {
  const e2e = readFileSync(new URL('../scripts/cable-route-e2e.mjs', import.meta.url), 'utf8');
  assert.match(e2e, /LECTURE > ÉDITION/);
  assert.match(e2e, /verifie\('modifier un point dans RF1 est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN'/);
  assert.match(e2e, /verifie\('retirer le segment RF1 est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN'/);
  assert.match(e2e, /verifie\('supprimer le tracé entier est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN'/);
  // Et la contrepartie : la protection ne doit pas bloquer l'exploitation courante.
  assert.match(e2e, /verifie\('la correction de référence aboutit', 200/);
  assert.match(e2e, /verifie\('la modification est acceptée', 200/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * F2a — CLÔTURE D'INTÉGRITÉ : LA DÉROGATION GLOBALE N'INVENTE PAS UNE RESSOURCE
 *
 * MESURÉ sur serveur réel avant correction : la dérogation des rôles globaux était la
 * PREMIÈRE ligne des deux décisions, avant toute vérification d'existence.
 *
 *   administrateur → room « ROOM-NOT-FOUND »   200 ACCEPTÉ, scène fantôme persistée
 *   gestionnaire   → room « ROOM-NOT-FOUND »   200 ACCEPTÉ
 *   administrateur → baie « BAIE-NOT-FOUND »   200 ACCEPTÉ
 *   gestionnaire   → baie « BAIE-NOT-FOUND »   200 ACCEPTÉ
 *
 * « Voir toutes les zones » veut dire franchir les habilitations sur une ressource RÉELLE.
 * Cela ne peut pas vouloir dire inventer une ressource : le jumeau numérique héritait d'une
 * géométrie dont la scène ne s'ouvre jamais, écrite par le rôle censé garantir la cohérence.
 * ══════════════════════════════════════════════════════════════════════════ */

test('intégrité : la résolution canonique ne connaît AUCUN rôle', () => {
  const bloc = blocServeur('async function routeSceneResolution', 'const routeSceneExists');
  assert.ok(!/seesEverything|isPlatformAdmin|user/.test(bloc),
    'une résolution qui consulte le rôle peut être contournée par le rôle');
  assert.match(bloc, /if \(!record\) return \{ exists: false, zoneIds: \[\] \};/);
});

test('intégrité : l\'EXISTENCE précède la dérogation globale, des deux côtés', () => {
  for (const [nom, depuis, jusqu] of [
    ['lecture', 'async function routeSceneReadable', 'async function routeSceneWritable'],
    ['écriture', 'async function routeSceneWritable', "/** Les scènes d'un tracé où cet utilisateur"]
  ]) {
    const bloc = blocServeur(depuis, jusqu);
    const existence = bloc.indexOf('if (!exists) return false;');
    const derogation = bloc.indexOf('seesEverything(user?.role)');
    assert.ok(existence > 0, `${nom} : la vérification d'existence doit exister`);
    assert.ok(derogation > existence,
      `${nom} : la dérogation globale ne doit JAMAIS précéder l'existence de la ressource`);
  }
});

test('intégrité : le plan du site n\'est pas traité comme une salle', () => {
  const bloc = blocServeur('async function routeSceneResolution', 'const routeSceneExists');
  // Pas d'enregistrement à chercher : il existe par construction, et le contrat interdit
  // déjà qu'un segment `map` porte un identifiant.
  assert.match(bloc, /sceneType === 'map'/);
  assert.match(bloc, /zoneIds: nu \? await access\.operationalMapZones\(\) : \[\]/);
  assert.ok(!/access\.get\('map'|ROUTE_SCENE_STORES\[.map.\]/.test(bloc),
    'aucun faux enregistrement de plan ne doit être fabriqué');
  // Un segment `map` porteur d'un identifiant n'existe pas : le contrat le refuse déjà,
  // et la résolution le confirme.
  assert.match(bloc, /const nu = scene\.sceneId === null \|\| scene\.sceneId === undefined \|\| scene\.sceneId === '';/);
});

test('intégrité : une scène ENTRANTE inexistante porte son propre refus', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  assert.match(bloc, /code: 'ROUTE_SCENE_INVALID'/);
  // « Cette scène n'existe pas » et « cette scène ne vous appartient pas » sont deux faits.
  assert.match(bloc, /'ROUTE_SCENE_EDIT_FORBIDDEN'/);
  const invalide = bloc.indexOf('ROUTE_SCENE_INVALID');
  const interdit = bloc.indexOf("'ROUTE_SCENE_EDIT_FORBIDDEN'");
  assert.ok(invalide < interdit,
    'l\'existence est une question de données : elle se pose avant celle des droits');
});

test('intégrité : une scène STOCKÉE disparue ne confère AUCUNE protection', () => {
  /*
   * Conséquence de la correction elle-même, et il fallait la traiter : si une salle est
   * supprimée après le relevé, son segment devient irrésolvable. Le compter comme
   * « protégé » rendrait le tracé corrompu impossible à réparer — y compris par un
   * administrateur — et la donnée fausse resterait pour toujours.
   */
  // La règle vit désormais dans `routeAuthority`, partagée par la garde et par la capacité
  // servie à l'écran : deux versions divergentes seraient pires que la duplication.
  const regle = blocServeur('async function routeAuthority', 'const ROUTE_ACCESS_FIELD');
  assert.match(regle, /const reelles = scenes\.filter\(scene => existences\.get\(cleScene\(scene\)\)\);/,
    'seules les scènes RÉELLES entrent dans le jugement');
  assert.match(regle, /masqueeParDroit: reelles\.some\(scene => !lisible\(scene\)\)/);
  assert.match(regle, /toutInscriptible: reelles\.every\(scene => inscriptible\(scene\)\)/);
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function routeAuthority');
  assert.match(bloc, /const \{ existences, masqueeParDroit \} = await routeAuthority\(user, stocke\);/,
    'la garde doit consommer la règle partagée, pas en réécrire une');
  assert.match(bloc, /if \(route === stocke && !existences\.get\(cleScene\(scene\)\)\) continue;/,
    'une scène stockée disparue ne doit pas exiger d\'autorité d\'écriture');
});

test('intégrité : le refus de scène ne révèle rien de la ressource', () => {
  const bloc = blocServeur('async function resolveIncomingCableRoute', 'async function redactCrossZoneRelations');
  const message = bloc.slice(bloc.indexOf("Le tracé désigne une scène"), bloc.indexOf("ROUTE_SCENE_INVALID"));
  for (const fuite of ['sceneId', 'zoneId', 'room', 'baie']) {
    assert.ok(!message.includes(fuite), `le refus révèle « ${fuite} »`);
  }
});

test('intégrité : les scènes fantômes sont éprouvées de bout en bout, pour les DEUX rôles globaux', () => {
  const e2e = readFileSync(new URL('../scripts/cable-route-e2e.mjs', import.meta.url), 'utf8');
  assert.match(e2e, /scène FANTÔME est refusée/);
  assert.match(e2e, /role:'manager'/, 'le gestionnaire doit être éprouvé, pas seulement l\'administrateur');
  // Les deux rôles globaux ET les deux types de scène sont parcourus par la même boucle :
  // c'est elle qu'on vérifie, les libellés étant construits à l'exécution.
  assert.match(e2e, /\[\['administrateur', A\.cookie\], \['gestionnaire', G\.cookie\]\]/);
  assert.match(e2e, /\['salle', fantome\('room','ROOM-NOT-FOUND'\)\], \['baie', fantome\('baie','BAIE-NOT-FOUND'\)\]/);
  assert.match(e2e, /'ROUTE_SCENE_INVALID', r\.payload\.error/);
  assert.ok(e2e.includes('aucune scène fantôme'));
});

/* ══════════════════════════════════════════════════════════════════════════
 * F2b — LA CAPACITÉ D'ÉDITION EST SERVIE PAR LE SERVEUR, PAS DEVINÉE PAR L'ÉCRAN
 *
 * Le navigateur ne peut pas établir seul l'autorité d'écriture sur un tracé :
 * `/api/access/context` porte les zones, les adhésions et les habilitations, mais aucune
 * cartographie enregistrement → zones. Un écran qui déduirait « modifiable » de
 * `route.partial === false`, d'un `cable.edit` détenu quelque part, du rôle seul ou de
 * `cable.roomId` rouvrirait l'écart LECTURE > ÉDITION fermé côté serveur.
 * ══════════════════════════════════════════════════════════════════════════ */

test('capacité : la garde et l\'écran consomment LA MÊME règle', () => {
  const capacite = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  const garde = blocServeur('async function resolveIncomingCableRoute', 'async function routeAuthority');
  assert.match(capacite, /await routeAuthority\(user, stockee\)/);
  assert.match(garde, /await routeAuthority\(user, stocke\)/);
  // Une capacité plus généreuse que la garde proposerait un geste voué au 403 ; plus
  // stricte, elle cacherait un droit réel.
  assert.match(capacite, /const editable = !masqueeParDroit && toutInscriptible;/);
});

test('capacité : écrire le CÂBLE est un préalable à écrire son tracé', () => {
  const bloc = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  assert.match(bloc, /access\.canAccessRecord\(user, 'cables', storedCable, 'update'\)/);
  assert.match(bloc, /if \(!\(await access\.canAccessRecord\(user, 'cables', storedCable, 'update'\)\)\) \{[\s\S]*?editable: false/);
});

test('capacité : elle est calculée sur le tracé STOCKÉ, jamais sur la vue servie', () => {
  const bloc = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  assert.match(bloc, /const stockee = storedCable\?\.route \?\? null;/);
  assert.match(bloc, /await routeAuthority\(user, stockee\)/,
    'juger sur la vue reviendrait à laisser le client décider de ce qu\'il a le droit de faire');
  // `readable` porte sur ce que l'utilisateur VOIT. La vue est calculée à UN seul endroit —
  // `cableRouteView` — et servie aussi bien à la capacité qu'à la route de consultation :
  // deux calculs finiraient par diverger, et c'est cette divergence qu'on ferme.
  assert.match(bloc, /const vue = await cableRouteView\(user, storedCable\);/);
  assert.match(bloc, /const readable = routeIsDocumented\(vue\);/);
  const vue = blocServeur('async function cableRouteView', 'async function cableRouteAccess');
  assert.match(vue, /sanitizeCableRoute\(stockee, await readableRouteScenes\(user, stockee\)\)/);
});

test('capacité : elle atteint AUSSI les rôles globaux', () => {
  // `redactCrossZoneRelations` court-circuite admin et manager ; la capacité se pose donc
  // après elle, sur son propre chemin, sinon les deux rôles n'en recevraient jamais.
  const redaction = blocServeur('async function redactCrossZoneRelations', 'if (storeName === \'screens\'');
  assert.match(redaction, /if \(seesEverything\(user\?\.role\) \|\| !record\) return record;/);
  const attache = blocServeur('async function attachRouteAccess', 'async function redactCrossZoneRelations');
  assert.ok(!/seesEverything/.test(attache), 'aucun rôle ne doit être privé de la réponse');
  const sync = blocServeur('safe = await redactCrossZoneRelations(user, row.store_name, safe);', '(data[row.store_name]');
  assert.match(sync, /safe = await attachRouteAccess\(user, row\.store_name, safe, row\.data\);/);
});

test('capacité : elle ne dit QUE oui ou non — aucun périmètre, aucune topologie', () => {
  const bloc = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  // La forme rendue est exactement { readable, editable } : rien d'autre ne sort.
  // Les TROIS formes rendues, épinglées : aucune autre clef ne peut s'y glisser.
  assert.match(bloc, /return avecScene\(\{ readable, editable: false \}, false\);/);
  assert.match(bloc, /if \(!scene\) return \{ readable, editable \};/);
  assert.match(bloc, /return avecScene\(\{ readable, editable \}, await routeSceneWritable\(user, scene\)\);/);
  // `creatableHere` est ajouté par `avecScene`, et seulement sur demande explicite.
  assert.match(bloc, /const avecScene = \(base, creatableHere\) => \(scene \? \{ \.\.\.base, creatableHere \} : base\);/);
  for (const fuite of ['zoneId', 'grant', 'hidden', 'segments.length']) {
    assert.ok(!bloc.includes(fuite), `la capacité révèle « ${fuite} »`);
  }
});

test('capacité : elle ne revient JAMAIS s\'enregistrer', () => {
  // Le client la renvoie sans y penser. Persistée, elle figerait le verdict d'UN lecteur
  // dans un enregistrement lu par tous — et un client pourrait se l'accorder lui-même.
  const strip = blocServeur('function stripClientCableIntegrity', 'async function normalizeIncomingCable');
  assert.match(strip, /routeAccess:ignoredRouteAccess/);
  assert.match(serve, /const clientRecord = stripClientCableIntegrity\(record\);/);
});

test('capacité : `routeAccess` n\'est pas un champ du contrat de câble', () => {
  // Le CODE, pas la prose : le contrat explique pourquoi il l'écarte, ce qui fait
  // légitimement apparaître le nom dans ses commentaires.
  const contrat = readFileSync(new URL('../connectivity-contract.js', import.meta.url), 'utf8');
  const code = contrat.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(ligne => !/^\s*\/\//.test(ligne)).join('\n');
  assert.match(code, /const \{ routeAccess: capaciteServie, \.\.\.reste \} = source;/,
    'la forme canonique doit ÉCARTER la capacité, explicitement');
  const cable = normalizeCableRecord({ id: 'C', reference: 'C', routeAccess: { editable: true } });
  assert.equal(cable.routeAccess, undefined,
    'un client qui s\'accorderait la capacité ne doit pas la voir survivre à la normalisation');
});

/* ══════════════════════════════════════════════════════════════════════════
 * F2b — « PUIS-JE DESSINER ICI ? » EST UNE AUTRE QUESTION QUE « PUIS-JE MODIFIER CECI ? »
 *
 * MESURÉ avant correction : sur un câble SANS tracé, `routeAuthority(null)` ne rencontre
 * aucune scène — rien n'est masqué, tout est « inscriptible » — et `editable` valait donc
 * `true` dès que le câble était modifiable. Un pilote habilité sur STC, la carte ouverte
 * sur RF1 où il n'a que la lecture, recevait `editable: true` : l'écran aurait proposé de
 * dessiner, et le serveur aurait refusé le trait en 403 une fois posé.
 * ══════════════════════════════════════════════════════════════════════════ */

test('création : la scène est NOMMÉE dans la demande, jamais déduite', () => {
  const bloc = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  assert.match(bloc, /async function cableRouteAccess\(user, storedCable, scene = null\)/);
  assert.match(bloc, /if \(!scene\) return \{ readable, editable \};/,
    'sans scène demandée, la réponse ne doit pas contenir de verdict de création');
  assert.match(bloc, /await routeSceneWritable\(user, scene\)/,
    'le verdict de scène doit passer par la même autorité d\'écriture que la garde');
});

test('création : `creatableHere` exige aussi de pouvoir écrire le câble', () => {
  const bloc = blocServeur('async function cableRouteAccess', 'async function attachRouteAccess');
  const prealable = bloc.indexOf("access.canAccessRecord(user, 'cables', storedCable, 'update')");
  const verdictScene = bloc.indexOf('await routeSceneWritable(user, scene)');
  assert.ok(prealable > 0 && prealable < verdictScene,
    'un câble qu\'on ne peut pas écrire ne devient pas dessinable parce que la scène l\'est');
  assert.match(bloc, /return avecScene\(\{ readable, editable: false \}, false\);/);
});

test('création : la capacité posée par la synchronisation ne porte AUCUNE scène', () => {
  const attache = blocServeur('async function attachRouteAccess', 'async function redactCrossZoneRelations');
  assert.match(attache, /await cableRouteAccess\(user, stored\)/,
    'un instantané ne connaît pas la scène ouverte à l\'écran : il ne peut pas y répondre');
  assert.ok(!/creatableHere/.test(attache));
});

test('création : la route de capacité est en LECTURE SEULE et ne révèle rien', () => {
  const bloc = blocServeur("const routeAccessMatch = url.pathname.match", 'route: await cableRouteView(user, cable),');
  assert.match(bloc, /req\.method === 'GET'/, 'une capacité ne se demande pas par une écriture');
  // Un câble hors périmètre répond comme s'il n'existait pas : distinguer « absent » de
  // « interdit » révélerait son existence.
  assert.match(bloc, /if \(!cable \|\| !await access\.canAccessRecord\(user, 'cables', cable, 'read'\)\)/);
  assert.match(bloc, /error: 'CABLE_NOT_FOUND'/);
  // La liste des scènes vient du contrat, pas d'une seconde copie.
  assert.match(bloc, /ROUTE_SCENE_TYPES\.includes\(sceneType\)/);
  assert.match(bloc, /error: 'ROUTE_SCENE_INVALID'/);
});

test('création : la scène demandée n\'est jamais prise dans un cache local', () => {
  const bloc = blocServeur("const routeAccessMatch = url.pathname.match", 'route: await cableRouteView(user, cable),');
  assert.match(bloc, /url\.searchParams\.get\('sceneType'\)/);
  assert.match(bloc, /url\.searchParams\.get\('sceneId'\)/);
  // Le câble lui-même est relu côté serveur, pas reçu du client.
  assert.match(bloc, /await access\.get\('cables', cableId\)/);
});

test('création : les six cas sont éprouvés de bout en bout', () => {
  const e2e = readFileSync(new URL('../scripts/cable-route-e2e.mjs', import.meta.url), 'utf8');
  for (const attendu of [
    "verifie('sans scène, la réponse ne contient PAS creatableHere', undefined",
    "verifie('scène STC (édition) : créable', true",
    "verifie('scène RF1 (lecture seule) : NON créable', false",
    "verifie('salle fantôme : NON créable', false",
    "creatableHere annonce ce que le serveur fait",
    "après révocation : NON créable dans RF1"
  ]) {
    assert.ok(e2e.includes(attendu), `cas manquant dans le gate : ${attendu}`);
  }
});
