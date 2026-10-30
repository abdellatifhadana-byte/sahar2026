/**
 * @file cable-route-access.js — CE QUE J'AI LE DROIT DE FAIRE DU TRACÉ, DEMANDÉ AU SERVEUR.
 *
 * POURQUOI CE MODULE EXISTE.
 *
 * Le navigateur ne peut pas établir seul l'autorité d'écriture sur un tracé.
 * `/api/access/context` lui donne les zones, ses adhésions et ses habilitations — jamais la
 * cartographie enregistrement → zones. Un écran qui déduirait « modifiable » de
 * `route.partial === false`, d'un `cable.edit` détenu quelque part, du rôle seul ou de
 * `cable.roomId` afficherait un bouton que le serveur refuserait ensuite. Une carte ne
 * promet pas ce qu'elle refusera.
 *
 * LA CAPACITÉ SYNCHRONISÉE EST UN INDICE, PAS UN VERDICT.
 *
 * L'instantané dépose bien `routeAccess` sur la copie locale, et il est utile pour composer
 * une liste sans une requête par ligne. Mais il vieillit : entre deux synchronisations, une
 * habilitation peut être révoquée. Avant CHAQUE geste — voir, modifier, ajouter — on
 * redemande, et c'est la réponse fraîche qui décide.
 *
 * FERMÉ PAR DÉFAUT. Réseau coupé, réponse illisible, session expirée : on ne montre ni le
 * tracé ni les outils. L'inverse — ouvrir en cas de doute — est exactement ce qu'un écran
 * ne doit jamais faire d'une décision d'accès.
 */

export const CABLE_ROUTE_ACCESS_VERSION = 1;

/** Le refus par défaut : rien n'est lisible, rien n'est modifiable, rien n'est créable. */
export const ACCES_FERME = Object.freeze({ readable: false, editable: false, creatableHere: false });

/**
 * La forme canonique d'une réponse, quelle qu'en soit la provenance.
 *
 * `creatableHere` n'est un booléen que si le serveur a répondu POUR UNE SCÈNE. Sans scène
 * demandée, il reste `false` : ne pas savoir n'est pas savoir que oui.
 */
export function normalizeRouteAccess(source) {
  if (!source || typeof source !== 'object') return ACCES_FERME;
  return Object.freeze({
    readable: source.readable === true,
    editable: source.editable === true,
    creatableHere: source.creatableHere === true
  });
}

/** L'adresse de la capacité, scène comprise quand il y en a une. */
export function routeAccessUrl(cableId, scene = null) {
  const base = `/api/cables/${encodeURIComponent(cableId)}/route-access`;
  if (!scene || !scene.sceneType) return base;
  const parametres = new URLSearchParams({ sceneType: String(scene.sceneType) });
  // Le plan du site n'a pas d'identifiant de scène : ne pas en envoyer un vide.
  if (scene.sceneId !== null && scene.sceneId !== undefined && scene.sceneId !== '') {
    parametres.set('sceneId', String(scene.sceneId));
  }
  return `${base}?${parametres}`;
}

/**
 * Le refus par défaut, géométrie comprise : on ne montre rien qu'on n'a pas su relire.
 *
 * `served: false` dit que la question n'a PAS reçu de réponse — réseau coupé, session
 * expirée, câble hors périmètre. Ce n'est pas la même chose que « le serveur a répondu
 * qu'il n'y a pas de tracé », et les confondre ferait dire à l'écran « Tracé physique non
 * renseigné » d'un câble dont il ne sait rien.
 */
export const VUE_FERMEE = Object.freeze({
  served: false, access: ACCES_FERME, route: null, routePresent: false, revision: null
});

/**
 * LA VUE FRAÎCHE : PERMISSION **ET** GÉOMÉTRIE.
 *
 * Ne rendre que la permission laissait une faille sous révocation PARTIELLE. Le serveur
 * répond encore `readable: true` — une partie du tracé reste légitimement visible — et un
 * écran qui garderait sa copie locale continuerait d'afficher le segment qu'on vient de
 * lui retirer, son identifiant de scène et sa place dans le parcours. La permission était
 * à jour, la géométrie ne l'était pas, et c'est la géométrie qu'on voit.
 *
 * On rend donc les deux ensemble, et l'appelant remplace sa copie par CELLE-CI.
 *
 * `revision` dit si la copie locale est en retard. Elle ne sert JAMAIS à écrire : une
 * révision fraîche posée sur des champs périmés contournerait le contrat de concurrence
 * et écraserait la modification légitime d'un autre.
 */
export async function fetchRouteView(cableId, scene = null, { fetchImpl } = {}) {
  const appel = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!appel || cableId === null || cableId === undefined || cableId === '') return VUE_FERMEE;
  try {
    const reponse = await appel(routeAccessUrl(cableId, scene), { credentials: 'include', cache: 'no-store' });
    if (!reponse.ok) return VUE_FERMEE;
    const charge = await reponse.json();
    // Pas de repli sur une géométrie locale : ce que le serveur sert est tout ce qu'on montre.
    const route = charge?.route ?? null;
    return Object.freeze({
      served: true,
      access: normalizeRouteAccess(charge),
      route,
      /*
       * `routePresent` — LE SEUL FAIT NEUTRE QU'ON RETIENT D'UN TRACÉ QU'ON NE VOIT PAS.
       *
       * `readable: false` ne veut PAS dire « il n'y a pas de tracé ». Le serveur répond
       * ainsi dans DEUX situations opposées : aucun cheminement n'a jamais été relevé — il
       * rend alors `route: null` — ou bien il en existe un dont pas un segment ne nous
       * regarde, et il rend `{ segments: [], partial: true }`. Les confondre laisserait un
       * premier relevé ÉCRASER le tracé d'un autre, invisible pour nous mais bien réel.
       *
       * Ce booléen ne dit rien d'autre : ni combien de segments sont masqués, ni quelles
       * scènes, ni quelle zone, ni quelle habilitation manque.
       */
      routePresent: Boolean(route),
      revision: charge?.revision ?? null
    });
  } catch {
    return VUE_FERMEE;
  }
}

/**
 * La permission seule, quand la géométrie n'est pas en jeu — l'ouverture d'un éditeur sur
 * une scène, par exemple, où c'est l'autorité qui décide.
 */
export async function fetchRouteAccess(cableId, scene = null, options = {}) {
  return (await fetchRouteView(cableId, scene, options)).access;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * LES TROIS GESTES, ET CE QUE CHACUN EXIGE
 *
 * Ils sont énoncés ici plutôt que dans les écrans : trois copies de la règle finiraient
 * par différer, et c'est toujours la plus permissive qui ferait la faille.
 * ───────────────────────────────────────────────────────────────────────────── */

/** VOIR le tracé : il faut qu'il y en ait un, et qu'on ait le droit de le regarder. */
export const peutVoirLeTrace = acces => normalizeRouteAccess(acces).readable;

/**
 * MODIFIER un tracé existant : il faut pouvoir le remplacer EN ENTIER.
 *
 * Sans tracé enregistré, ce geste n'existe pas — il n'y a rien à modifier. `editable` seul
 * ne suffit donc pas : sur un câble sans tracé il vaut `true` dès que le câble est
 * modifiable, ce qui ne dit rien de la scène ouverte.
 */
export function peutModifierLeTrace(acces, { traceExistante }) {
  return Boolean(traceExistante) && normalizeRouteAccess(acces).editable;
}

/**
 * AJOUTER un PREMIER tracé : aucun cheminement enregistré, et la scène OUVERTE inscriptible.
 *
 * Le fait exigé est `routePresent === false` — le serveur a répondu qu'il n'y a rien —, pas
 * « aucun segment visible ». Un cheminement entièrement hors périmètre se lit exactement
 * comme une absence, et le « créer » l'écraserait. `routePresent` inconnu ferme donc le
 * geste : ne pas savoir n'est pas savoir que non.
 */
export function peutAjouterUnTrace(acces, { routePresent } = {}) {
  return routePresent === false && normalizeRouteAccess(acces).creatableHere;
}

/**
 * AJOUTER un segment à un tracé existant : les DEUX autorités.
 *
 * On remplace le tracé entier — d'où `editable` — et l'on écrit dans cette scène-ci —
 * d'où `creatableHere`. L'une sans l'autre laisserait passer un geste que le serveur
 * refuserait.
 */
export function peutAjouterUnSegment(acces, { traceExistante }) {
  const propre = normalizeRouteAccess(acces);
  return Boolean(traceExistante) && propre.editable && propre.creatableHere;
}

export default Object.freeze({
  version: CABLE_ROUTE_ACCESS_VERSION,
  ACCES_FERME, VUE_FERMEE, normalizeRouteAccess, routeAccessUrl, fetchRouteAccess, fetchRouteView,
  peutVoirLeTrace, peutModifierLeTrace, peutAjouterUnTrace, peutAjouterUnSegment
});
