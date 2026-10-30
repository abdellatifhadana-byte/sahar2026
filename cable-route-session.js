/**
 * @file cable-route-session.js — DESSINER SANS RIEN ENGAGER, JUSQU'À « ENREGISTRER ».
 *
 * CE QUE CETTE SESSION GARANTIT.
 *
 * Un exploitant qui déplace un point sur un plan n'a rien décidé. Il essaie. Tant qu'il n'a
 * pas cliqué « Enregistrer », le tracé canonique du câble doit être exactement ce qu'il
 * était — et « Annuler » doit le rendre au caractère près, pas « à peu près ».
 *
 * La session travaille donc sur une COPIE. Le tracé enregistré n'est jamais muté pendant le
 * dessin : ni au glissement, ni au clic, ni au changement de scène, ni à la fermeture du
 * panneau. Une seule sortie mène à l'écriture — `payload()`, que l'appelant passe à un
 * unique `db.save('cables', …)`.
 *
 * CE QU'ELLE NE FAIT PAS.
 *
 * Elle ne connaît ni le DOM, ni IndexedDB, ni le réseau, ni les autorisations. Elle
 * n'invente aucune continuité : un trou entre deux scènes reste un trou, et un segment
 * retiré ne se recolle pas à son voisin. Elle ne décide pas non plus du droit de dessiner —
 * `cable-route-access.js` le demande au serveur, et le serveur reste l'autorité finale.
 *
 * Même discipline que `map-coordinate-edit-session.js` : instantané, copie de travail,
 * restauration exacte.
 */

import {
  CABLE_ROUTE_VERSION, ROUTE_SCENE_TYPES, ROUTE_STATUSES,
  validateCableRoute, sameCableRoute
} from './connectivity-contract.js';

export const CABLE_ROUTE_SESSION_VERSION = 1;

const clone = valeur => {
  if (valeur === null || valeur === undefined) return valeur;
  if (typeof structuredClone === 'function') return structuredClone(valeur);
  return JSON.parse(JSON.stringify(valeur));
};

const memeScene = (a, b) => a?.sceneType === b?.sceneType
  && String(a?.sceneId ?? '') === String(b?.sceneId ?? '');

const sceneUtilisable = scene => ROUTE_SCENE_TYPES.includes(scene?.sceneType)
  && (scene.sceneType === 'map' || (scene.sceneId !== null && scene.sceneId !== undefined && scene.sceneId !== ''));

/**
 * @param routeEnregistree  le tracé canonique du câble, ou `null`
 * @param scene             la scène ouverte à l'écran — c'est LÀ qu'on dessine
 */
/**
 * @param routeEnregistree  le tracé canonique du câble, ou `null`
 * @param scene             la scène ouverte à l'écran — c'est LÀ qu'on dessine
 */
export function createCableRouteSession(routeEnregistree = null, scene = null) {
  // L'instantané ne sert qu'à une chose : rendre « Annuler » exact. On ne le touche plus.
  const instantane = clone(routeEnregistree) ?? null;
  const sceneCourante = sceneUtilisable(scene) ? { sceneType: scene.sceneType, sceneId: scene.sceneId ?? null } : null;

  let travail = clone(routeEnregistree) ?? null;
  // Le rang du segment choisi PARMI CEUX DE LA SCÈNE (0, 1, 2…), pas son rang dans le
  // tracé entier : c'est ce que l'exploitant désigne quand il clique « le 2ᵉ passage ».
  let rangChoisi = 0;

  const segments = () => (travail?.segments || []);

  /* Les rangs ABSOLUS des segments de cette scène, dans l'ordre du cheminement. */
  const positionsDeLaScene = () => {
    if (!sceneCourante) return [];
    const sortie = [];
    segments().forEach((segment, position) => { if (memeScene(segment, sceneCourante)) sortie.push(position); });
    return sortie;
  };

  const positionChoisie = () => {
    const positions = positionsDeLaScene();
    if (!positions.length) return -1;
    const rang = Math.min(Math.max(rangChoisi, 0), positions.length - 1);
    return positions[rang];
  };

  /*
   * UNE MODIFICATION DE GÉOMÉTRIE RETIRE LE « VÉRIFIÉ ».
   *
   * `status` décrit le tracé ENTIER — le contrat ne le porte pas segment par segment. Un
   * relevé vérifié atteste d'un cheminement observé sur le terrain ; dès qu'on déplace un
   * point, ajoute ou retire un segment, ce n'est plus ce cheminement-là. Laisser la pastille
   * « Tracé vérifié » sur une géométrie modifiée il y a cinq secondes ferait dire à l'écran
   * qu'une vérification a eu lieu alors qu'elle n'a pas eu lieu.
   *
   * `unknown` bascule aussi : la géométrie qui vient d'être dessinée est, précisément, ce
   * que son auteur propose. Rien ne bascule en revanche à l'OUVERTURE, au choix d'un
   * segment, au rendu, ni à « Annuler » — aucun de ces gestes ne touche à la géométrie.
   *
   * `setStatus('verified')` reste possible pour qui a le droit de confirmer ; une
   * modification ultérieure le retire de nouveau.
   */
  const marquerGeometrieModifiee = () => {
    if (travail && travail.status !== 'proposed') travail.status = 'proposed';
  };

  /** Le tracé de travail, ou `null` s'il ne reste plus rien à documenter. */
  const materialiser = () => {
    if (!travail) return null;
    // Un tracé sans segment ne documente rien : il vaut `null`, pas `{segments:[]}`.
    // Enregistrer une coquille vide affirmerait qu'un relevé existe et qu'il est vide.
    if (!travail.segments.length) return null;
    return travail;
  };

  const assurerTrace = () => {
    if (!travail) travail = { version: CABLE_ROUTE_VERSION, status: 'proposed', segments: [] };
    return travail;
  };

  return Object.freeze({
    scene: sceneCourante ? Object.freeze({ ...sceneCourante }) : null,

    /** Le tracé tel qu'il est en cours de dessin. Jamais l'enregistré. */
    working: () => clone(materialiser()),

    /**
     * TOUS les segments de la scène courante, dans l'ordre du cheminement.
     *
     * Un câble peut entrer dans une salle, en sortir, et y revenir : le contrat canonique
     * n'impose aucune unicité par scène, et le rendu doit les dessiner tous.
     */
    segmentsInCurrentScene() {
      return positionsDeLaScene().map(position => clone(segments()[position]));
    },

    /** Le rang, parmi les segments de cette scène, de celui qu'on édite. */
    selectedIndex: () => (positionsDeLaScene().length ? Math.min(Math.max(rangChoisi, 0), positionsDeLaScene().length - 1) : -1),

    /** Désigne le segment à éditer. L'édition ne porte QUE sur celui-là. */
    selectSegment(rang) {
      const positions = positionsDeLaScene();
      if (!Number.isInteger(rang) || rang < 0 || rang >= positions.length) return false;
      rangChoisi = rang;
      return true;
    },

    /** Le segment choisi, ou `null` si cette scène n'en porte aucun. */
    selectedSegment() {
      const position = positionChoisie();
      return position < 0 ? null : clone(segments()[position]);
    },

    /**
     * Ouvre un NOUVEAU segment dans la scène courante — même si elle en porte déjà.
     *
     * L'ORDRE DES SEGMENTS EST UNE AFFIRMATION PHYSIQUE, PAS UN ORDRE D'AFFICHAGE.
     *
     * Le contrat lit `segments` comme l'ordre du cheminement réel. Ajouter d'office à la
     * fin — ce que faisait cette méthode — revenait donc à déclarer que le nouveau passage
     * vient APRÈS tous les autres. Sur un relevé incomplet où il manquait le couloir entre
     * deux salles, cela transformait
     *
     *     STC(1) → plan → RF1 → STC(2)          le cheminement réel
     *  en STC(1) → plan → STC(2) → RF1          celui qu'on venait d'inventer.
     *
     * Aucune ligne fictive n'était tracée, mais un ORDRE fictif l'était — et il se lit
     * comme un relevé. La position est donc EXIGÉE dès qu'un tracé existe : c'est à celui
     * qui documente de dire où le passage s'insère, pas au code de le supposer.
     *
     * Le nouveau segment commence vide, rien ne le raccorde à ses voisins, aucun segment
     * existant n'est déplacé, et c'est lui qu'on édite ensuite.
     *
     * @param insertAt  rang ABSOLU dans le cheminement, de 0 à `segments.length`.
     *                  Facultatif UNIQUEMENT quand il n'y a pas encore de tracé.
     */
    startSegment({ naturalWidth, naturalHeight, insertAt } = {}) {
      if (!sceneCourante) return false;
      const existants = segments().length;
      let position;
      if (!existants) {
        // Premier segment : la seule position possible est 0, et l'exiger n'apprendrait rien.
        if (insertAt !== undefined && insertAt !== null && insertAt !== 0) return false;
        position = 0;
      } else {
        if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > existants) return false;
        position = insertAt;
      }
      assurerTrace().segments.splice(position, 0, {
        sceneType: sceneCourante.sceneType, sceneId: sceneCourante.sceneId,
        naturalWidth, naturalHeight, waypoints: [], anchors: []
      });
      marquerGeometrieModifiee();
      rangChoisi = Math.max(0, positionsDeLaScene().indexOf(position));
      return true;
    },

    /**
     * LE CHEMINEMENT, TEL QU'IL EST DOCUMENTÉ — pour que l'écran puisse demander « où ? ».
     *
     * Rend la suite ordonnée des passages, chacun avec son rang absolu, afin qu'un écran
     * propose « avant 1 », « entre 2 et 3 », « après 4 » plutôt que de deviner. Aucun tri
     * n'est appliqué : l'ordre rendu est celui du relevé.
     */
    sequence() {
      return segments().map((segment, position) => Object.freeze({
        insertAt: position,
        sceneType: segment.sceneType,
        sceneId: segment.sceneId ?? null,
        waypoints: segment.waypoints.length
      }));
    },

    /** Pose un point à la fin du segment CHOISI. Coordonnées NATURELLES. */
    addWaypoint(point) {
      const position = positionChoisie();
      if (position < 0) return false;
      segments()[position].waypoints.push({ x: point.x, y: point.y });
      marquerGeometrieModifiee();
      return true;
    },

    /** Déplace un point du segment CHOISI. C'est le geste le plus fréquent. */
    moveWaypoint(rang, point) {
      const position = positionChoisie();
      if (position < 0) return false;
      const points = segments()[position].waypoints;
      if (rang < 0 || rang >= points.length) return false;
      points[rang] = { x: point.x, y: point.y };
      marquerGeometrieModifiee();
      return true;
    },

    /** Retire un point. Le segment peut devenir trop court : c'est `validate` qui le dira. */
    removeWaypoint(rang) {
      const position = positionChoisie();
      if (position < 0) return false;
      const points = segments()[position].waypoints;
      if (rang < 0 || rang >= points.length) return false;
      points.splice(rang, 1);
      marquerGeometrieModifiee();
      return true;
    },

    /**
     * Retire le segment CHOISI — et lui seul.
     *
     * Les autres passages dans la même scène ne bougent pas, les autres scènes non plus, et
     * le trou qu'il laisse reste un trou : recoller ses voisins fabriquerait un cheminement
     * que personne n'a relevé.
     */
    removeSelectedSegment() {
      const position = positionChoisie();
      if (position < 0) return false;
      segments().splice(position, 1);
      marquerGeometrieModifiee();
      rangChoisi = Math.max(0, Math.min(rangChoisi, positionsDeLaScene().length - 1));
      return true;
    },

    /** « Supprimer le tracé » : tout le relevé, et rien d'autre du câble. */
    removeRoute() {
      travail = null;
      rangChoisi = 0;
      return true;
    },

    /** Le statut du relevé — « vérifié » ne se pose pas à la légère. */
    setStatus(status) {
      if (!ROUTE_STATUSES.includes(status) || !travail) return false;
      travail.status = status;
      return true;
    },

    /** A-t-on touché à quoi que ce soit depuis l'ouverture ? */
    dirty: () => !sameCableRoute(materialiser(), instantane),

    /** ANNULER : l'instantané, au caractère près — statut « vérifié » compris. */
    cancel() {
      travail = clone(instantane) ?? null;
      rangChoisi = 0;
      return clone(materialiser());
    },

    /** Le tracé est-il enregistrable en l'état ? Le contrat canonique tranche, pas nous. */
    validate() {
      const valeur = materialiser();
      if (valeur === null) return { valid: true, errors: [], value: null };
      return validateCableRoute(valeur);
    },

    /**
     * LA SEULE SORTIE VERS L'ÉCRITURE.
     *
     * Rend le câble complet à enregistrer, tracé compris — jamais un fragment. L'appelant
     * en fait UN `db.save('cables', …)`, et rien d'autre du câble n'est touché ici :
     * identité, extrémités, ports, type, statut technique restent ce qu'ils étaient.
     */
    payload(cable) {
      const verdict = this.validate();
      if (!verdict.valid) return { ok: false, errors: verdict.errors, cable: null };
      return { ok: true, errors: [], cable: { ...cable, route: verdict.value } };
    }
  });
}

export default Object.freeze({
  version: CABLE_ROUTE_SESSION_VERSION,
  createCableRouteSession
});
