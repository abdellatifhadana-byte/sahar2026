/**
 * @file cable-route-layer.js — LE TRACÉ D'UN CÂBLE, DESSINÉ SUR LA SCÈNE OUVERTE.
 *
 * CE QUI S'AFFICHE, ET QUAND.
 *
 * Rien par défaut. La carte reste la carte : aucune forêt de câbles. Un tracé n'apparaît
 * qu'après un geste explicite — « Voir le tracé » depuis une Fiche360 ou la liste des
 * câbles — et seulement pour le câble ainsi choisi.
 *
 * DANS LA SCÈNE COURANTE, ET RIEN QUE LES SIENS.
 *
 * Les coordonnées d'un segment appartiennent à l'image de SA scène. Posées sur une autre,
 * elles placeraient un trait exact au mauvais endroit, ce qui se lit comme un relevé. On ne
 * dessine donc que les segments de la scène ouverte — TOUS, car un câble peut la traverser
 * plusieurs fois — et l'on ne relie jamais deux scènes par un trait : le trou entre elles
 * est un fait, pas un défaut d'affichage.
 *
 * L'ÉCRITURE NE SE DÉCIDE PAS ICI.
 *
 * Le droit de modifier vient du serveur (`cable-route-access.js`), redemandé à l'ouverture
 * de l'éditeur — la capacité déposée par la synchronisation vieillit. Le dessin, lui, se
 * fait sur une copie (`cable-route-session.js`) : le tracé canonique ne bouge pas tant que
 * « Enregistrer » n'a pas été cliqué.
 */

import {
  routeSegmentsForScene, routeIsDocumented, routeIsPartial,
  MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL
} from './connectivity-contract.js';
import { naturalPolylineToDisplay } from './map-coordinates-contract.js';
import { routeSequenceSentence, routeBadge, insertionChoices } from './cable-route-presentation.js';
import { fetchRouteView, ACCES_FERME, peutModifierLeTrace, peutAjouterUnTrace, peutAjouterUnSegment } from './cable-route-access.js';
import { createCableRouteSession } from './cable-route-session.js';

export const CABLE_ROUTE_LAYER_VERSION = 1;

/** L'espace de dessin de la carte — le même que celui des formes de salles. */
export const ESPACE_CARTE = Object.freeze({ width: 2000, height: 1200 });

const TRAIT = Object.freeze({
  verified: { couleur: '#2ecc71', tirets: [] },
  proposed: { couleur: '#f39c12', tirets: [14, 10] },
  unknown:  { couleur: '#95a5a6', tirets: [4, 8] }
});

/*
 * L'ÉTAT DE LA COUCHE — un seul câble à la fois, et il est nommé.
 *
 * Module-level à dessein : la carte est un singleton et le tracé affiché est une propriété
 * de CE qui est montré à l'écran, pas de chaque appel de rendu.
 */
let selection = null;   // { cable, acces, revision, routePresent, session|null }

/** Le câble dont on regarde le tracé, ou `null`. */
export const selectedCable = () => selection?.cable || null;
export const routeSession = () => selection?.session || null;
export const routeAccess = () => selection?.acces || ACCES_FERME;
export const isEditing = () => Boolean(selection?.session);

/**
 * UN TRACÉ EST-IL ENREGISTRÉ POUR CE CÂBLE ? — la question n'est PAS « le voit-on ? ».
 *
 * `readable: false` couvre deux situations opposées : personne n'a jamais relevé le
 * cheminement, ou il en existe un dont pas un segment ne nous regarde. Le serveur les
 * distingue — `route: null` contre `{ segments: [], partial: true }` — et c'est ce fait-là,
 * rien de plus, qu'on retient ici. Il commande la création : on n'ouvre un premier relevé
 * que sur une absence PROUVÉE, jamais sur une invisibilité.
 */
export const routePresent = () => selection?.routePresent === true;

/**
 * Montre le tracé de ce câble — PERMISSION ET GÉOMÉTRIE FRAÎCHES.
 *
 * La copie synchronisée porte la géométrie telle qu'elle était au dernier instantané. Sous
 * une révocation PARTIELLE — un segment retiré, les autres conservés — le serveur répond
 * encore `readable: true`, et se contenter de rafraîchir la permission laisserait dessiner
 * le segment qu'on vient de nous retirer. On remplace donc la géométrie par celle que le
 * serveur vient de servir, et l'on ne retombe jamais sur le cache.
 */
export async function showCableRoute(cable, { scene = null, fetchImpl } = {}) {
  if (!cable?.id) return clearCableRoute();
  const vue = await fetchRouteView(cable.id, scene, { fetchImpl });
  /*
   * SEUL UN SILENCE FERME LA VUE — pas une réponse « rien à vous montrer ».
   *
   * `readable: false` était traité ici comme « il n'y a rien », et la sélection était
   * jetée. Deux conséquences, mesurées sur serveur réel : un câble SANS tracé — la réponse
   * est alors `readable: false, creatableHere: true` — devenait impossible à documenter,
   * puisque plus aucune sélection ne portait le geste ; et un tracé entièrement hors
   * périmètre disparaissait au lieu de se dire. On ne ferme donc que lorsque la question
   * n'a pas reçu de réponse : là, et là seulement, on ne sait rien.
   */
  if (!vue.served) { selection = null; return ACCES_FERME; }
  // Le câble retenu porte la route SERVIE, pas celle du magasin local.
  selection = {
    cable: { ...cable, route: vue.route }, acces: vue.access,
    revision: vue.revision, routePresent: vue.routePresent, session: null
  };
  return vue.access;
}

/**
 * LA MÊME VUE, REDEMANDÉE POUR LA SCÈNE OUVERTE.
 *
 * `creatableHere` n'a de sens que pour une scène nommée : sans elle, le serveur ne le
 * calcule pas et le contrat le laisse à `false`. Quand la carte change de scène, l'écran
 * repose donc la question — c'est la « preuve fraîche de la scène courante » sans laquelle
 * aucun bouton de création ne doit apparaître.
 *
 * `acknowledging` — ET C'EST LE SEUL CAS OÙ CE CÂBLE-CI ADOPTE UNE RÉVISION FRAÎCHE.
 *
 * DÉFAUT MESURÉ (1er correctif) : après un premier « Enregistrer » réussi, cette fonction
 * ne touchait QUE `selection.revision` (un champ informatif, jamais écrit) et
 * `selection.cable.route`. Le reste de `selection.cable` — donc son `_revision` — restait
 * celui d'AVANT le premier enregistrement. Un second « Modifier » puis « Enregistrer », dans
 * le MÊME panneau sans rien refermer, repartait donc de `session.payload(selectedCable())`
 * avec cette révision périmée : le serveur, déjà à N+1, refusait en 409 STALE_WRITE un câble
 * que personne d'autre n'avait touché.
 *
 * DÉFAUT MESURÉ (2e correctif — TOCTOU) : le premier correctif collait ici
 * `vue.revision` — celle que CETTE vue, fraîchement redemandée par un appel HTTP SÉPARÉ,
 * rapporte À L'INSTANT. Entre l'écriture qui vient de réussir et cet appel-ci, un AUTRE
 * auteur a pu écrire un AUTRE champ du même câble : le serveur serait alors déjà à N+2, et
 * `vue.revision` le rapporterait fidèlement — mais posée sur les champs métier d'`aEcrire`
 * (ceux d'AVANT l'écriture de cet autre auteur), elle fabriquait une fiche locale
 * incohérente : contenu à N+1, révision affichée à N+2. Un second enregistrement repartant
 * de cette fiche déclarait alors N+2 comme révision attendue — exactement ce que le serveur
 * vient d'accepter de l'autre auteur — et écrasait son écriture en silence, sans jamais
 * produire le STALE_WRITE qui aurait dû protéger ce second auteur.
 *
 * `acknowledging` doit donc porter la fiche LOCALE, COMPLÈTE, DÉJÀ ESTAMPILLÉE par
 * `accorderRevision()` (`central-sync.js`) — jamais un objet pré-écriture recombiné avec la
 * révision d'un appel réseau distinct. `accorderRevision()` relit et estampille dans UNE
 * SEULE transaction IndexedDB : il n'existe pas de fenêtre entre « lire le contenu » et
 * « poser la révision » où un autre écrivain pourrait s'intercaler. Sa révision est donc la
 * SEULE source sûre ici ; celle de `vue` ne sert plus qu'à la géométrie et au statut
 * d'accès, jamais à corriger `_revision`.
 *
 * Ce n'est PAS un raccourci général : un appel ORDINAIRE (sans `acknowledging`, comme au
 * changement de scène) continue de ne jamais coller la révision d'une vue sur
 * `selection.cable` — ses autres champs métier peuvent être périmés, et une révision
 * fraîche posée dessus masquerait la modification concurrente d'un AUTRE auteur sur un
 * AUTRE champ. Le raccourci n'est sûr que pour la fiche ATOMIQUEMENT à jour que l'appelant
 * vient de relire après sa propre écriture.
 */
export async function refreshRouteView(scene, { fetchImpl, acknowledging } = {}) {
  if (!selection?.cable?.id) return ACCES_FERME;
  const vue = await fetchRouteView(selection.cable.id, scene, { fetchImpl });
  if (!vue.served) { selection = null; return ACCES_FERME; }
  selection.acces = vue.access;
  selection.cable = acknowledging
    ? { ...acknowledging, route: vue.route }
    : { ...selection.cable, route: vue.route };
  selection.revision = vue.revision;
  selection.routePresent = vue.routePresent;
  return vue.access;
}

/** La révision que le serveur portait lors de la dernière vue. Informative, jamais écrite. */
export const routeRevision = () => selection?.revision ?? null;

export function clearCableRoute() {
  selection = null;
  return ACCES_FERME;
}

/**
 * Ouvre l'éditeur sur la scène courante — après avoir REDEMANDÉ l'autorité.
 *
 * Rend `null` quand le geste n'est pas permis : c'est l'appelant qui décide quoi dire,
 * mais il ne peut pas décider que c'est permis.
 */
export async function beginRouteEdit(scene, { fetchImpl } = {}) {
  if (!selection?.cable) return null;
  /*
   * L'INSTANTANÉ DE L'ÉDITEUR PART DE LA VUE FRAÎCHE, PAS DU MAGASIN LOCAL.
   *
   * Éditer une géométrie périmée puis l'enregistrer écraserait ce qu'un autre vient de
   * relever. La révision, elle, reste celle de la copie synchronisée : c'est ce qui laisse
   * le contrat de concurrence prononcer un vrai STALE_WRITE au lieu d'être contourné par
   * une révision fraîche collée sur des champs anciens.
   */
  const vue = await fetchRouteView(selection.cable.id, scene, { fetchImpl });
  if (!vue.served) { selection = null; return null; }
  selection.acces = vue.access;
  selection.cable = { ...selection.cable, route: vue.route };
  selection.revision = vue.revision;
  selection.routePresent = vue.routePresent;
  const traceExistante = routeIsDocumented(vue.route);
  // Rien de relevé, ou rien de visible : ce geste-ci n'a pas d'objet. Le PREMIER relevé
  // passe par `beginRouteCreate`, qui exige une absence prouvée et la scène ouverte.
  if (!traceExistante) return null;
  // Un tracé amputé ne s'édite pas : le réenregistrer effacerait ce qu'on ne voit pas.
  if (routeIsPartial(vue.route)) return null;
  if (!peutModifierLeTrace(vue.access, { traceExistante })) return null;
  selection.session = createCableRouteSession(vue.route, scene);
  return selection.session;
}

/**
 * OUVRE LE PREMIER RELEVÉ D'UN CÂBLE QUI N'EN A PAS — et n'exige donc PAS `readable`.
 *
 * Sur un câble sans tracé, le serveur répond `readable: false` : il n'y a rien à lire. En
 * faire une fermeture rendait la première documentation inatteignable — le geste le plus
 * courant du terrain. La lecture n'est pas la condition de la création ; l'absence l'est,
 * et elle se prouve.
 *
 * TROIS EXIGENCES, TOUTES FRAÎCHES, AUCUNE DÉDUITE :
 *
 *   1. le serveur RÉPOND — un silence ne prouve pas une absence ;
 *   2. il répond qu'il n'y a AUCUN tracé (`routePresent === false`). Entre l'affichage de
 *      la fiche et le clic, un autre exploitant a pu relever ce cheminement : ouvrir
 *      malgré tout, c'est l'écraser au premier enregistrement. Un tracé hors périmètre
 *      compte comme présent — invisible n'est pas inexistant ;
 *   3. la scène OUVERTE est inscriptible (`creatableHere`), et non « le câble est
 *      modifiable quelque part ».
 *
 * La révision retenue pour l'écriture reste celle de la copie SYNCHRONISÉE du câble : une
 * révision fraîche posée sur des champs anciens contournerait le contrat de concurrence.
 */
export async function beginRouteCreate(cable, scene, { fetchImpl } = {}) {
  if (!cable?.id || !scene?.sceneType) return null;
  const vue = await fetchRouteView(cable.id, scene, { fetchImpl });
  if (!vue.served) { selection = null; return null; }
  // La sélection est posée dans TOUS les cas servis : si un tracé vient d'apparaître,
  // l'écran doit le montrer plutôt que de rester muet sur un refus.
  selection = {
    cable: { ...cable, route: vue.route }, acces: vue.access,
    revision: vue.revision, routePresent: vue.routePresent, session: null
  };
  if (!peutAjouterUnTrace(vue.access, { routePresent: vue.routePresent })) return null;
  selection.session = createCableRouteSession(null, scene);
  return selection.session;
}

/** Ferme l'éditeur en restaurant l'état d'origine. Aucune écriture. */
export function cancelRouteEdit() {
  if (!selection?.session) return null;
  const restaure = selection.session.cancel();
  selection.session = null;
  return restaure;
}

/** L'éditeur peut-il ouvrir un passage ICI, maintenant ? Les deux autorités. */
export const peutInsererIci = () => peutAjouterUnSegment(routeAccess(), {
  traceExistante: routeIsDocumented(selection?.cable?.route)
});

/* ─────────────────────────────────────────────────────────────────────────────
 * LE DESSIN
 * ───────────────────────────────────────────────────────────────────────────── */

/** Le tracé à montrer : celui qu'on dessine s'il y a une session, sinon l'enregistré. */
export function routeAffichee() {
  if (!selection) return null;
  return selection.session ? selection.session.working() : (selection.cable.route ?? null);
}

/**
 * Dessine les segments de CETTE scène — tous — sur le canevas de la carte.
 *
 * Rend le nombre de segments dessinés, pour que l'appelant puisse le dire sans le deviner.
 */
export function drawRouteLayer(ctx, scene, dimensions = ESPACE_CARTE) {
  if (!ctx || !selection) return 0;
  const route = routeAffichee();
  if (!routeIsDocumented(route)) return 0;
  const segments = routeSegmentsForScene(route, scene);
  if (!segments.length) return 0;

  const style = TRAIT[route.status] || TRAIT.unknown;
  const session = selection.session;
  const choisi = session ? session.selectedIndex() : -1;

  ctx.save();
  segments.forEach((segment, rang) => {
    const points = naturalPolylineToDisplay(segment, dimensions);
    // Un seul point ne décrit aucun chemin : on ne referme pas, on ne prolonge pas.
    if (points.length < 2) return;
    const actif = rang === choisi;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.setLineDash(style.tirets);
    ctx.lineWidth = actif ? 9 : 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = actif ? '#ffffff' : style.couleur;
    ctx.stroke();
    if (actif) {
      // Le passage en cours d'édition garde la couleur de l'état SOUS un liseré blanc :
      // la sélection ne doit pas déguiser un tracé proposé en tracé vérifié.
      ctx.setLineDash(style.tirets);
      ctx.lineWidth = 4;
      ctx.strokeStyle = style.couleur;
      ctx.stroke();
    }
    // Les poignées n'existent qu'en édition : en consultation, un tracé se lit, il ne se
    // manipule pas, et des poignées suggéreraient le contraire.
    if (session && actif) {
      points.forEach((point, index) => {
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.couleur;
        ctx.stroke();
        ctx.fillStyle = '#19242d';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), point.x, point.y);
      });
    }
  });
  ctx.restore();
  return segments.length;
}

/**
 * Le point de la scène, en pixels NATURELS, à partir d'un clic sur le canevas.
 *
 * Les dimensions naturelles viennent du SEGMENT — c'est son image de référence — et non de
 * l'écran : c'est ce qui rend le point relu identique après un redimensionnement.
 */
export function pointNaturelDepuisCanevas(clic, segment, dimensions = ESPACE_CARTE) {
  if (!segment?.naturalWidth || !segment?.naturalHeight) return null;
  if (!dimensions.width || !dimensions.height) return null;
  return {
    x: clic.x * segment.naturalWidth / dimensions.width,
    y: clic.y * segment.naturalHeight / dimensions.height
  };
}

/** Le point de la polyligne affichée le plus proche du clic, s'il est à portée. */
export function poigneeSousLeClic(clic, segment, dimensions = ESPACE_CARTE, rayon = 14) {
  const points = naturalPolylineToDisplay(segment || {}, dimensions);
  let meilleur = -1;
  let distance = rayon;
  points.forEach((point, index) => {
    const ecart = Math.hypot(point.x - clic.x, point.y - clic.y);
    if (ecart <= distance) { distance = ecart; meilleur = index; }
  });
  return meilleur;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LE PANNEAU DOIT DIRE
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * L'état lisible du tracé pour l'écran — texte d'abord, jamais une couleur seule.
 *
 * Aucune décision d'accès n'est prise ici : `canEdit` et `canInsert` viennent de la
 * capacité SERVIE, et l'appelant n'a qu'à les lire.
 */
export function routePanelState(contexte = {}) {
  if (!selection) return null;
  const route = routeAffichee();
  const session = selection.session;
  const documente = routeIsDocumented(route);
  return Object.freeze({
    reference: selection.cable.reference || selection.cable.id,
    badge: routeBadge(route),
    // Deux faits distincts : « personne ne l'a relevé » et « il existe et ne vous regarde pas ».
    message: documente ? '' : (routeIsPartial(route) ? PARTIAL_ROUTE_LABEL : MISSING_ROUTE_LABEL),
    sentence: documente ? routeSequenceSentence(session ? session.sequence() : sequenceDe(route), contexte) : '',
    editing: Boolean(session),
    dirty: Boolean(session?.dirty()),
    canEdit: peutModifierLeTrace(selection.acces, { traceExistante: routeIsDocumented(selection.cable.route) }),
    // La création se juge sur l'EXISTENCE côté serveur, pas sur ce qui est visible : un
    // cheminement entièrement hors périmètre ressemble à une absence et n'en est pas une.
    canCreate: peutAjouterUnTrace(selection.acces, { routePresent: selection.routePresent }),
    canInsert: peutInsererIci(),
    /*
     * OUVRIR UN PASSAGE DANS LA SCÈNE OUVERTE — et la règle dépend de ce qui est enregistré.
     *
     * Sur un relevé EXISTANT, il faut les deux autorités : on remplace le tracé entier, et
     * l'on écrit dans cette scène-ci. Sur une création — rien d'enregistré —, la seule
     * autorité en jeu est celle de la scène, et c'est précisément celle que le serveur a
     * accordée en ouvrant la session. Exiger `editable` en plus fermait le deuxième passage
     * d'un premier relevé : le tracé stocké est encore `null`, donc « il n'y a rien à
     * modifier », et le bouton disparaissait après le premier segment.
     */
    canAddSegment: selection.routePresent
      ? peutInsererIci()
      : peutAjouterUnTrace(selection.acces, { routePresent: selection.routePresent }),
    insertions: session ? insertionChoices(session.sequence(), contexte) : []
  });
}

/**
 * PAR OÙ ENTRER POUR MONTRER CE TRACÉ.
 *
 * Jamais par `cable.roomId` : le contrat de connectivité le déclare cache hérité, écrit une
 * fois depuis la salle de la source et jamais rafraîchi. Il ne dit rien du cheminement, et
 * s'en servir enverrait l'exploitant dans une salle que le tracé ne traverse peut-être pas.
 *
 * On entre par le tracé lui-même : de préférence par un segment VISIBLE qui coïncide avec
 * le contexte de l'équipement d'où l'on vient — c'est la scène qu'il a sous les yeux —
 * sinon par le premier segment visible, dans l'ordre du cheminement. Aucune scène
 * intermédiaire n'est inventée ; sans segment visible, on n'ouvre rien.
 */
export function entryScene(route, contexte = {}) {
  const segments = route?.segments || [];
  if (!segments.length) return null;
  const memeContexte = segments.find(segment =>
    (segment.sceneType === 'room' && contexte.roomId != null && String(segment.sceneId) === String(contexte.roomId))
    || (segment.sceneType === 'baie' && contexte.baieId != null && String(segment.sceneId) === String(contexte.baieId)));
  const choisi = memeContexte || segments[0];
  return Object.freeze({ sceneType: choisi.sceneType, sceneId: choisi.sceneId ?? null });
}

/**
 * Y a-t-il quelque chose à MONTRER ?
 *
 * Un tracé amputé n'est pas un tracé vide : le serveur conserve les segments autorisés et
 * n'ajoute que `partial: true`. Refuser la vue parce qu'une partie est protégée priverait
 * l'exploitant de ce qu'il a parfaitement le droit de voir. On n'ouvre rien, en revanche,
 * quand il ne reste aucun segment visible.
 */
export const routeHasVisibleGeometry = route => routeIsDocumented(route);

/** La séquence d'un tracé qu'aucune session ne porte encore. */
export function sequenceDe(route) {
  return (route?.segments || []).map((segment, position) => ({
    insertAt: position, sceneType: segment.sceneType, sceneId: segment.sceneId ?? null,
    waypoints: segment.waypoints?.length ?? 0
  }));
}

export default Object.freeze({
  version: CABLE_ROUTE_LAYER_VERSION,
  ESPACE_CARTE,
  showCableRoute, refreshRouteView, clearCableRoute, beginRouteEdit, beginRouteCreate, cancelRouteEdit,
  selectedCable, routeSession, routeAccess, routeRevision, routePresent, isEditing, peutInsererIci,
  routeAffichee, drawRouteLayer, pointNaturelDepuisCanevas, poigneeSousLeClic,
  entryScene, routeHasVisibleGeometry,
  routePanelState, sequenceDe
});
