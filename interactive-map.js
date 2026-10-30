import { db } from './db.js';
import { resolveMapImageUrl } from './map-image-store.js';
import { resolveEntityPlacement, toNaturalCoordinates } from './map-coordinates-contract.js';
import { readShape, shapeToSvgGeometry, normalizeShape, shapeContains } from './map-shape-contract.js';
import { openShapeEditor, paintShape } from './map-shape-editor.js';
import {
  SHAPE_IN_ROOM_FIELD, SHAPE_IN_BAIE_FIELD, nestedPlacement, withNestedShape, shapeWithinBounds
} from './nested-shape-contract.js';
import { openCanonicalEquipmentEditor } from './equipment-editor-service.js';
import { openTicketModal } from './tickets.js';
import { PermissionManager } from './permissions.js';
import { addLog } from './logs.js';
import { eventSystem } from './events.js';
import { pucesActifs, detailSalle } from './pilot-technique-shell.js';
import { fullBreadcrumbPath } from './breadcrumb-contract.js';
import { buildHashRoute, allowedSectionsForRole } from './navigation-contract.js';
import { indexEngineeringLinks, linksForEntity } from './engineering-refs.js';
import { cableEndpointRefs, cableTouchesRoom } from './connectivity-contract.js';
import { mapAbilities, mapCan } from './map-permissions-contract.js';
import { sceneForTarget, cableReturnPath } from './map-navigation-contract.js';
import { createCoordinateEditSession, saveCoordinateEditSession } from './map-coordinate-edit-session.js';
import { coordinateEditViewMatches, describeCoordinateSaveOutcome } from './map-coordinate-edit-outcome.js';
import { drawRouteLayer, selectedCable } from './cable-route-layer.js';
import { openCableRoutePanel } from './cable-route-editor.js';

// Les panneaux de la carte interpolaient noms et images d'entités directement dans
// innerHTML. Une salle ou une baie nommée avec une charge utile exécutait donc du script
// pour tout rôle capable d'ouvrir la carte — y compris le Visiteur.
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

// Une URL d'image ne doit jamais pouvoir devenir `javascript:` ni un autre schéma actif.
const safeImageUrl = (value, fallback) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/^(https?:|data:image\/|blob:)/i.test(raw)) return esc(raw);
  if (/^[./]|^[\w-]+[\w./-]*$/.test(raw) && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return esc(raw);
  return fallback;
};

/*
 * L'IMAGE D'ATTENTE N'EST PLUS LE PLAN DU SITE.
 *
 * `assets/plan-technique.PNG` servait de repli quand une salle ou une baie n'a pas de
 * photo. Une fiche sans image affichait donc le plan technique complet — RF1, RF2,
 * acquisition, salles serveurs — à qui pouvait ouvrir cette fiche, Visiteur compris.
 * Le repli est désormais neutre : il dit qu'il n'y a pas d'image, sans en montrer une autre.
 */
const PLACEHOLDER_IMAGE = 'assets/image-indisponible.svg';

let activeMapClose = null;

/*
 * ROUVRIR LE PLAN LÀ OÙ ON L'A QUITTÉ.
 *
 * `map-equipment-360-bridge.js` ferme la carte avant d'ouvrir la Fiche 360, et il a raison :
 * mesuré, une fiche posée PAR-DESSUS le plan n'est pas fiablement cliquable — un clic réel
 * sur sa fermeture expire. Mais refermer la fiche ramenait alors au tableau de bord, et le
 * chemin parcouru — ville, salle, baie — était perdu : il fallait rouvrir la carte et
 * re-naviguer à chaque appareil consulté.
 *
 * On mémorise donc de QUOI la carte a été ouverte et OÙ l'on était, pour la remonter
 * ensuite à l'identique. Le zoom et le panoramique ne sont volontairement PAS restaurés :
 * ils appartiennent à `map-fit-fix.js`, qui recalcule son ajustement à chaque ouverture, et
 * les forcer depuis l'extérieur reviendrait à écrire dans un état dont ce module est seul
 * propriétaire.
 */
let derniereOuverture = null;

/** La vue courante du plan, ou `null` si aucune carte n'a encore été ouverte. */
export function contexteCarte() {
  if (!derniereOuverture) return null;
  const vue = derniereOuverture.vue();
  return vue ? { vue: { ...vue } } : null;
}

/** Remonte le plan tel qu'on l'a laissé. Rend `false` si aucune carte n'est mémorisée. */
export async function rouvrirCarte(contexte = null) {
  if (!derniereOuverture) return false;
  openInteractiveMap(derniereOuverture.options);
  const vue = contexte?.vue;
  if (!vue || (vue.type !== 'room' && vue.type !== 'baie')) return true;
  // `openInteractiveMap` vient de réenregistrer l'instance : c'est la NOUVELLE qu'on pilote.
  const instance = derniereOuverture;
  // Le plan se monte de façon asynchrone (réglages, image, ajustement). On attend son
  // panneau plutôt que de parier sur un délai.
  for (let essai = 0; essai < 60 && !document.getElementById('map-panel'); essai += 1) {
    await new Promise(resoudre => setTimeout(resoudre, 50));
  }
  if (!document.getElementById('map-panel')) return true;
  await instance.ouvrir(vue.type, vue.id);
  return true;
}

/**
 * Localiser une fiche SUR le plan, depuis l'extérieur du module.
 *
 * Rend `true` si la cible a été atteinte et désignée. Rend `false` — sans rien inventer —
 * quand la fiche n'a pas de position exploitable : c'est une information utile, pas un
 * échec à masquer.
 */
export async function localiserSurCarte(type, id) {
  if (!derniereOuverture?.localiser) return false;
  // Le plan se monte de façon asynchrone : on attend son panneau plutôt que de parier sur
  // un délai, exactement comme `rouvrirCarte`.
  for (let essai = 0; essai < 60 && !document.getElementById('map-panel'); essai += 1) {
    await new Promise(resoudre => setTimeout(resoudre, 50));
  }
  if (!document.getElementById('map-panel')) return false;
  return Boolean(await derniereOuverture.localiser(type, id));
}

/**
 * OUVRIR LA CARTE SUR LA SCÈNE D'UN TRACÉ — et poser le chemin du retour.
 *
 * `localiserSurCarte` ne convient PAS ici, et le défaut est mesurable : elle se place dans
 * la scène du PARENT pour y désigner la cible. Pour une salle, ce parent est le plan
 * général — on atterrissait donc sur le plan, la salle entourée d'un halo, et pas un
 * segment du tracé n'était dessiné, puisque la couche ne dessine que les segments de la
 * scène OUVERTE. Un tracé de salle exige d'ENTRER dans la salle.
 *
 * Le chemin de retour est posé au même moment. Sans lui l'historique est vide — on n'est
 * arrivé là par aucune navigation — et « Retour » renvoyait au plan général, à côté de
 * l'endroit d'où l'on venait. `cableReturnPath` remonte la chaîne de l'équipement
 * d'origine : Câble → Équipement → Baie → Salle.
 *
 * Rend `false` sans rien inventer quand la scène n'existe pas dans ce plan.
 */
export async function ouvrirTraceSurCarte(scene, { equipmentId = null } = {}) {
  if (!derniereOuverture?.entrerDansTrace) return false;
  // Le plan se monte de façon asynchrone : on attend son panneau plutôt que de parier sur
  // un délai, exactement comme `localiserSurCarte`.
  for (let essai = 0; essai < 60 && !document.getElementById('map-panel'); essai += 1) {
    await new Promise(resoudre => setTimeout(resoudre, 50));
  }
  if (!document.getElementById('map-panel')) return false;
  return Boolean(await derniereOuverture.entrerDansTrace(scene, { equipmentId }));
}

export function closeInteractiveMap(options = {}) {
  if (typeof activeMapClose === 'function') {
    activeMapClose(options);
    return;
  }
  document.getElementById('welcome-screen')?.remove();
  document.getElementById('map-modal')?.remove();
}

// ======= أدوات البحث =======
/**
 * Repli d'accents et de casse, pour que « Regie » trouve « Régie ».
 *
 * La comparaison était un `toLowerCase().includes()` nu : sur une plateforme dont presque
 * tous les noms portent un accent — Régie, Réception, Éclairage —, taper sans accent ne
 * rendait RIEN, et l'utilisateur en concluait que la fiche n'existait pas. `NFD` sépare la
 * lettre de son signe, et l'intervalle des diacritiques combinants les retire.
 *
 * Les chiffres arabo-indiens (٠١٢…) sont ramenés à leur équivalent latin : un libellé
 * saisi avec ces chiffres reste trouvable en chiffres latins, et réciproquement.
 */
function plier(valeur) {
  return String(valeur ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[٠-٩]/g, chiffre => String(chiffre.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, chiffre => String(chiffre.charCodeAt(0) - 0x06f0))
    .toLowerCase().trim();
}

/**
 * LA RECHERCHE DE LA CARTE — trois types, et elle le dit.
 *
 * Elle ne couvre que salles, baies et équipements : les câbles, ports, procédures, tickets
 * et schémas n'y sont pas, et prétendre le contraire serait pire que l'absence. Ce qu'elle
 * couvre, en revanche, doit être fiable — d'où le repli d'accents ci-dessus.
 */
function searchAll({ query, rooms, baies, equipments }) {
  const q = plier(query);
  if (!q) return [];
  const contient = (...champs) => champs.some(champ => plier(champ).includes(q));
  let results = [];
  results.push(...equipments.filter(eq =>
    contient(eq.name, eq.nom, eq.numSerie, eq.type, eq.marque, eq.modele)
  ).map(eq => ({ type: 'equipment', id: eq.id, name: eq.name || eq.nom, ...eq })));
  results.push(...rooms.filter(r => contient(r.name, r.location))
    .map(r => ({ type: 'room', id: r.id, name: r.name, ...r })));
  results.push(...baies.filter(b => contient(b.name))
    .map(b => ({ type: 'baie', id: b.id, name: b.name, ...b })));
  return results;
}

export { searchAll as __searchAllPourEpreuves };

// ================ الوظيفة الرئيسية =====================
export default function openInteractiveMap(optionsCarte = {}) {
  // L'objet entier est conservé : c'est lui qui permettra de rouvrir ce même plan, avec les
  // mêmes données et les mêmes rappels, après un détour par la Fiche 360.
  // `let`, et non `const` : la déstructuration d'origine était dans la liste des paramètres,
  // donc modifiable — et `walls` EST réaffecté plus bas (`walls = storedWalls`). La figer
  // levait un `TypeError` avalé par le `.catch()` de l'initialisation, qui basculait la
  // carte en « Accès restreint » sans rien dire.
  let {
    rooms = [], baies = [], equipments = [], walls = [],
    user = {}, notifications = null, onClose = null, onOpenWall = null
  } = optionsCarte;
  const previousClose = activeMapClose;
  let welcome = null;
  let mapModal = null;
  let mapCleanup = null;
  let closed = false;
  let closeNotified = false;
  /*
   * LE NETTOYAGE DES FORMES IMBRIQUÉES, ATTEIGNABLE DEPUIS LA FERMETURE (MAP-01).
   *
   * MESURÉ dans un vrai Chromium, sur le chemin de l'audience :
   *
   *     ReferenceError: fermerFormesImbriquees is not defined
   *         at closeMap (interactive-map.js:220)
   *         at closeInteractiveMap (interactive-map.js:143)
   *         at openMapEquipment360 (map-equipment-360-bridge.js:39)
   *
   * `closeMap` vit ici, dans la portée de `openInteractiveMap`. `fermerFormesImbriquees`,
   * elle, est déclarée dans `renderMapUI()` — une portée ENFANT — parce qu'elle referme des
   * objets qui n'existent que là : l'éditeur de forme imbriquée et le canevas des formes de
   * la photo. Une portée parente ne voit pas une liaison déclarée dans une portée fille :
   * l'appel levait donc, et la ligne étant la DEUXIÈME du nettoyage, tout ce qui suivait —
   * retrait de l'écran d'accueil, `mapCleanup`, `__mapFitCleanup`, retrait de `#map-modal`,
   * sortie du plein écran, libération de `activeMapClose`, notification — ne s'exécutait
   * jamais. Le plan restait monté, et la Fiche 360 n'était jamais atteinte.
   *
   * Un CROCHET, et non un déplacement de la fonction : elle doit rester au contact des
   * objets qu'elle détruit. Il vaut « rien à faire » tant que le panneau n'existe pas —
   * c'est l'état d'une carte restreinte, qui n'initialise jamais cette interface et doit
   * pourtant se fermer normalement.
   */
  let fermerFormesImbriqueesDuPanneau = () => {};
  const closeMap = ({ notify = true } = {}) => {
    if (closed) return;
    closed = true;
    // Fermer la carte pendant une édition de coordonnées en cours ne doit pas laisser un
    // brouillon muté en mémoire : voir `cancelCoordinateSession` plus bas — sans elle, une
    // fiche `equipments` partagée resterait déplacée dans le tableau réutilisé par l'appelant,
    // prête à être enregistrée par erreur au prochain « Enregistrer » sans rapport.
    cancelCoordinateSession();
    fermerFormesImbriqueesDuPanneau();
    welcome?.remove();
    mapCleanup?.();
    mapModal?.__mapFitCleanup?.();
    mapModal?.remove();
    if (document.fullscreenElement === mapModal) document.exitFullscreen?.();
    if (activeMapClose === closeMap) activeMapClose = null;
    if (notify && !closeNotified) {
      closeNotified = true;
      onClose?.();
    }
  };
  previousClose?.({ notify: false });
  activeMapClose = closeMap;

  /*
   * L'ÉCHELLE GÉOGRAPHIQUE, CHARGÉE UNE FOIS — JAMAIS PAR LIGNE.
   *
   * `rooms.locationId` existe depuis la migration v17 et `breadcrumb-contract.js` sait
   * déjà joindre « Ville › Région › Département » au chemin physique « Salle › Baie ›
   * Équipement ». La carte, elle, ne lisait pas `locations` : elle affichait le nom de la
   * salle et rien au-dessus. Sur un parc réparti, le plan ne disait donc pas DANS QUELLE
   * VILLE on se trouve.
   *
   * Une seule lecture à l'ouverture, partagée par tous les panneaux. Une salle sans
   * rattachement rend un chemin qui commence à la salle : le contrat n'invente aucun
   * niveau, et cette carte non plus.
   */
  const localisationsChargees = db.getAll('locations')
    .then(liste => (Array.isArray(liste) ? liste : []))
    .catch(() => []);
  let localisations = [];
  localisationsChargees.then(liste => { localisations = liste; });

  /*
   * CE QUI PERMET DE DIRE « CETTE SALLE A DES SCHÉMAS » — ET DE SE TAIRE SINON.
   *
   * Trois lectures, UNE fois à l'ouverture, jamais par panneau : les documents
   * d'ingénierie (dont `engineering-refs.js` tire l'index des procédures et des schémas),
   * les câbles, et les écrans. Sans elles, une action « Schémas » ne pourrait qu'être
   * affichée au jugé — c'est-à-dire mentie une fois sur deux.
   */
  const contexteCharge = Promise.all([
    db.getAll('docs').catch(() => []),
    db.getAll('cables').catch(() => []),
    db.getAll('screens').catch(() => [])
  ]).then(([docs, cables, ecrans]) => ({
    liens: indexEngineeringLinks(Array.isArray(docs) ? docs : []),
    cables: Array.isArray(cables) ? cables : [],
    ecrans: Array.isArray(ecrans) ? ecrans : []
  })).catch(() => ({ liens: indexEngineeringLinks([]), cables: [], ecrans: [] }));
  let contexte = { liens: indexEngineeringLinks([]), cables: [], ecrans: [] };
  contexteCharge.then(valeur => { contexte = valeur; });

  /*
   * OUVRIR UNE SECTION DEPUIS LE PLAN — SANS AJOUTER DIX RAPPELS.
   *
   * Chaque coque qui ouvre cette carte est déjà routée par l'adresse :
   * `role-navigation-integration.js` câble `hashchange` pour toutes, et
   * `broadcast-relations.js` navigue DÉJÀ ainsi depuis ce plan (`#/walls`). Le contrat
   * existe donc ; il suffisait de s'en servir. Ajouter `onNavigate` aux dix sites d'appel
   * aurait créé un second modèle, à tenir d'accord avec le premier.
   *
   * La route ne porte QUE la section : `admin-ui.js` lit le hash par `substring(2)` et le
   * passe tel quel à `openTab`. Un `#/devices/salle-3` deviendrait « devices/salle-3 »,
   * qui n'est le nom d'aucune section — le lien profond casserait la navigation au lieu de
   * l'affiner. Les libellés restent donc sobres : ils promettent d'ouvrir la section, rien
   * de plus.
   *
   * `onOpenWall` n'est PAS remplacé : il fait un travail que le hash ne fait pas
   * (`db.setCurrentRoomId`), et surtout `walls` n'est dans les sections d'AUCUN rôle
   * visiteur — router le Mur d'images retirerait au Visiteur un accès légitime.
   */
  const sectionsDuRole = allowedSectionsForRole(user?.role) || [];

  function ouvrirSection(section) {
    if (!sectionsDuRole.includes(section)) return;
    closeMap({ notify: false });
    window.location.hash = buildHashRoute({ section });
  }

  /**
   * Les actions RÉELLEMENT disponibles depuis une salle ou une baie.
   *
   * Trois conditions, toutes obligatoires : la section est ouverte au rôle, la donnée est
   * réellement rattachée à cette entité, et l'autorisation existe. Si l'une manque,
   * l'action est ABSENTE — jamais grisée : un bouton désactivé promet quand même quelque
   * chose, et il faudrait ensuite expliquer pourquoi il ne répond pas.
   */
  function actionsContextuelles(type, id) {
    const entite = type === 'room'
      ? rooms.find(salle => String(salle.id) === String(id))
      : baies.find(baie => String(baie.id) === String(id));
    if (!entite) return [];
    const salleId = type === 'room' ? entite.id : entite.roomId;
    const liens = linksForEntity(contexte.liens, type, entite.id);
    const equipementsLies = type === 'room'
      ? equipments.filter(eq => String(eq.roomId) === String(entite.id))
      : equipments.filter(eq => String(eq.baieId) === String(entite.id));
    const baiesLiees = type === 'room' ? baies.filter(baie => String(baie.roomId) === String(entite.id)) : [];

    /*
     * CE QUI RATTACHE VRAIMENT UN CÂBLE — ET CE QUI N'EN EST QU'UN CACHE.
     *
     * `cable.roomId` est écrit UNE fois à la création, depuis la salle de la source, et
     * jamais rafraîchi ensuite : `connectivity-contract.js` le documente,
     * `platform-integrity.js` en audite la dérive, et `room-deletion.js` a déjà cessé de
     * s'y fier pour décider d'une suppression. Le lien réel passe par les extrémités —
     * `sourceEquipmentId` / `destinationEquipmentId`, ou l'équipement parent d'un
     * connecteur.
     *
     * S'en tenir au cache produisait deux mensonges symétriques : une baie dont les
     * appareils sont réellement câblés restait SANS bouton Câblage dès que le champ
     * manquait, et une baie sans le moindre câble en héritait un parce qu'une AUTRE baie
     * de la même salle en avait. Une salle admet le repli sur le champ stocké — c'est le
     * seul cas où il reste la dernière trace de localisation d'un câble dont plus aucune
     * extrémité n'est résolvable, et `cableTouchesRoom` ne l'applique qu'alors. Une baie,
     * jamais : le cache est écrit à l'échelle de la salle et ne descend pas jusqu'à elle.
     */
    const idsEquipements = new Set(equipementsLies.map(equipement => String(equipement.id)));
    const cablesLies = type === 'room'
      ? contexte.cables.filter(cable => cableTouchesRoom(cable, salleId, { equipments, screens: contexte.ecrans }))
      : contexte.cables.filter(cable => cableEndpointRefs(cable)
        .some(extremite => extremite.type === 'equipment' && idsEquipements.has(String(extremite.id))));

    /*
     * DIAGNOSTIQUER SUPPOSE UN ÉCRAN — ENCORE FAUT-IL QUE CE SOIT LE SIEN.
     *
     * La salle ne regardait que son PREMIER mur : une salle en portant deux perdait
     * silencieusement les écrans du second. Et la baie héritait de ce mur de salle, alors
     * qu'un écran n'a pas de `baieId` — il tient à un mur, à une salle, et à l'équipement
     * qui le pilote (`db.js` indexe `wallId`, `roomId`, `equipmentId`, rien d'autre).
     *
     * Une salle regarde donc TOUS ses murs, plus les écrans qu'elle porte directement.
     * Une baie ne regarde que les écrans pilotés par SES équipements : c'est le seul lien
     * que le modèle établisse entre un écran et une baie, et à défaut l'action est absente.
     */
    const idsMursDeLaSalle = new Set(walls
      .filter(mur => String(mur.roomId) === String(salleId))
      .map(mur => String(mur.id)));
    const ecransLies = type === 'room'
      ? contexte.ecrans.filter(ecran => (ecran.roomId != null && String(ecran.roomId) === String(salleId))
        || (ecran.wallId != null && idsMursDeLaSalle.has(String(ecran.wallId))))
      : contexte.ecrans.filter(ecran => ecran.equipmentId != null && idsEquipements.has(String(ecran.equipmentId)));

    return [
      { section: 'devices', libelle: 'Équipements', icone: 'fa-server',
        lie: equipementsLies.length, permis: PermissionManager.check(user, 'equipments', 'view') },
      { section: 'baies', libelle: 'Baies', icone: 'fa-cube',
        lie: baiesLiees.length, permis: PermissionManager.check(user, 'baies', 'view') },
      // `cables` n'a pas d'entité dans `permissions.js` : la section, elle, est déclarée par
      // rôle dans `navigation-contract.js`, et c'est elle qui gouverne ici.
      { section: 'cables', libelle: 'Câblage', icone: 'fa-plug',
        lie: cablesLies.length, permis: true },
      { section: 'diagrams', libelle: 'Schémas', icone: 'fa-project-diagram',
        lie: liens.diagrams.length, permis: PermissionManager.check(user, 'diagrams', 'view') },
      { section: 'procedures', libelle: 'Procédures', icone: 'fa-list-ol',
        lie: liens.procedures.length, permis: PermissionManager.check(user, 'continuity', 'view') },
      // Sans écran réellement rattaché à CETTE entité, il n'y a rien à diagnostiquer et
      // l'action n'a pas lieu d'exister.
      { section: 'screensDiagnostic', libelle: 'Diagnostic', icone: 'fa-stethoscope',
        lie: ecransLies.length, permis: PermissionManager.check(user, 'screens', 'diagnose') }
    ].filter(action => action.lie && action.permis && sectionsDuRole.includes(action.section));
  }


  /*
   * UN BOOLÉEN NE PEUT PAS AUTORISER SIX ACTES SUR TROIS TYPES.
   *
   * `canManageMap` valait `rooms.edit` et commandait pourtant le dessin, l'ajout, le
   * changement d'image, le glisser-déposer des ÉQUIPEMENTS et la SUPPRESSION des trois
   * types. Le Chef y gagnait la suppression que la matrice lui refuse ; le Responsable y
   * perdait le placement d'équipement qu'elle lui accorde. Chaque outil interroge
   * désormais SON acte, sur SON type — `map-permissions-contract.js`.
   */
  const droitsCarte = mapAbilities(user);
  const peutEditerCarte = droitsCarte.anyEdition;
  /** Au moins un acte d'administration sur ce type : sinon aucun menu ne s'ouvre. */
  const peutAdministrer = type => mapCan(user, type, 'edit') || mapCan(user, type, 'delete') || mapCan(user, type, 'create');
  const canViewWalls = PermissionManager.check(user, 'walls', 'view');
  /*
   * LE PLAN N'A PLUS DE VALEUR PAR DÉFAUT.
   *
   * `mapImage` valait `assets/plan-technique.PNG` avant même la première lecture des
   * réglages. Le rendu partait donc du plan opérationnel, et le serveur n'avait jamais été
   * consulté : c'est cette valeur, et non l'API, qui affichait le site entier à un
   * Visiteur d'un autre département. La carte commence désormais SANS plan, et n'en
   * obtient un que si le serveur le lui accorde.
   */
  let mapImage = '';
  let planAutorise = false;
  let zoom = 1, panX = 0, panY = 0;
  let currentView = { type: "map" };
  let ouvrirVue = null;
  let localiserVue = null;
  let entrerDansTraceVue = null;
  derniereOuverture = {
    options: optionsCarte,
    vue: () => (closed ? null : { ...currentView }),
    ouvrir: (type, id) => ouvrirVue?.(type, id),
    localiser: (type, id) => localiserVue?.(type, id),
    entrerDansTrace: (scene, contexte) => entrerDansTraceVue?.(scene, contexte)
  };
  let drawing = false;
  let history = [];
  let dragMode = false;
  let locked = false;

  /*
   * LA SESSION D'ÉDITION DE COORDONNÉES — UNE SEULE À LA FOIS, ET SON PROPRIÉTAIRE EST CONNU.
   *
   * `coordinateSession` (voir `map-coordinate-edit-session.js`) ne connaît ni IndexedDB ni le
   * serveur : elle snapshot les seuls champs de géométrie de la scène courante, permet un
   * `restore()` EXACT — absence de propriété comprise — et ne marque acquitté que ce qui a
   * réellement été enregistré. `coordinateSessionView` retient QUELLE vue (salle ou baie) l'a
   * ouverte, pour qu'une navigation vers une AUTRE vue l'abandonne automatiquement plutôt que
   * de laisser un déplacement muté survivre en mémoire sans plus aucun bouton pour le voir.
   */
  let coordinateSession = null;
  let coordinateSessionView = null;

  function coordinateSessionMatches(type, id) {
    return coordinateEditViewMatches(coordinateSessionView, type, id);
  }

  /*
   * Tant qu'une édition de coordonnées est active, le bouton global « Enregistrer » ne doit
   * pas pouvoir persister un brouillon non acquitté : il ne connaît que les tableaux en
   * mémoire, pas la session, et boucler sur `equipments` enverrait aussi les fiches en cours
   * de glisser-déposer. On le désactive plutôt que d'ouvrir un second chemin de sauvegarde.
   */
  function refreshSaveAllAvailability() {
    const bouton = document.getElementById('save-all-btn');
    if (!bouton) return;
    bouton.disabled = !!coordinateSession;
    bouton.title = coordinateSession
      ? 'Terminez ou annulez la modification des positions en cours avant d’enregistrer tout.'
      : 'Enregistrer';
  }

  function beginCoordinateSession(type, id, recordsDeLaScene, fields) {
    coordinateSession = createCoordinateEditSession(recordsDeLaScene, fields);
    coordinateSessionView = { type, id };
    dragMode = true;
    refreshSaveAllAvailability();
    return coordinateSession;
  }

  /** Fin normale : la sauvegarde a réussi (ou n'a jamais eu lieu) — rien à restaurer. */
  function endCoordinateSession() {
    coordinateSession = null;
    coordinateSessionView = null;
    dragMode = false;
    refreshSaveAllAvailability();
  }

  /**
   * Abandon d'une session — clic sur « Annuler » ou sortie de la vue éditée sans sauvegarde.
   * Restaure EXACTEMENT l'état d'avant édition, puis referme la session. Ne fait rien si
   * aucune session n'est active : chaque point de sortie peut donc l'appeler sans condition.
   */
  function cancelCoordinateSession() {
    if (coordinateSession) coordinateSession.restore();
    endCoordinateSession();
  }

  Promise.all([db.get('settings', 'global'), db.getAll('walls')]).then(async ([settings, storedWalls]) => {
    if (closed) return;
    // Les octets du plan ne voyagent plus dans l'instantané : on les résout ici, depuis le
    // cache local ou d'un unique téléchargement (voir map-image-store.js). La résolution est
    // ATTENDUE : la lancer sans l'attendre ferait rendre le plan par défaut, puis basculer.
    // Le coût d'un aller-retour n'est payé qu'au premier affichage ; ensuite le cache répond.
    try { const url = await resolveMapImageUrl(settings); if (url) { mapImage = url; planAutorise = true; } } catch {}
    if (!walls.length) walls = storedWalls;
    // Sans plan autorisé, il n'y a pas de carte à préparer : ni briefing, ni fond, ni
    // point chaud. On dit pourquoi, et on s'arrête là.
    if (!planAutorise) { renderRestrictedMap(); return; }
    showWelcome(() => renderMapUI());
  }).catch(() => { if (!closed) renderRestrictedMap(); });

  /**
   * L'ÉTAT RESTREINT — ce qu'on voit quand le plan n'est pas dû.
   *
   * Il ne masque rien : il n'y a rien à masquer. Aucun fond, aucun canevas, aucun point
   * chaud n'est construit, et aucune salle, baie ou équipement n'est lu pour le rendre.
   * Un plan caché derrière un voile resterait dans le document, donc dans le poste ;
   * l'absence est la seule forme de refus qui ne se contourne pas avec l'inspecteur.
   *
   * Le plan technique porte plusieurs périmètres sur les mêmes pixels — c'est pourquoi la
   * phrase parle de périmètres, et non d'une salle en particulier : nommer la zone
   * manquante apprendrait déjà quelque chose.
   */
  function renderRestrictedMap() {
    if (closed) return;
    document.getElementById('map-modal')?.remove();
    const modal = document.createElement('div');
    mapModal = modal;
    modal.id = 'map-modal';
    modal.className = 'modal-map map-restricted';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Plan technique — accès restreint');
    modal.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;overflow:hidden;background:#19242d;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="max-width:520px;padding:34px 30px;text-align:center;color:#e8eff2;">
        <i class="fas fa-lock" style="font-size:42px;color:#5bb2ff;margin-bottom:18px;display:block;"></i>
        <h2 style="font-size:24px;margin:0 0 12px;">Accès restreint</h2>
        <p style="font-size:16px;line-height:1.6;color:#a9bcc6;margin:0 0 24px;">
          Ce plan contient des informations hors de votre périmètre autorisé.
        </p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="map-request-access">
            <i class="fas fa-user-shield"></i> Demander un accès
          </button>
          <button type="button" class="btn gray" id="map-restricted-close">Fermer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#map-restricted-close').onclick = () => closeMap();
    // Le parcours de demande existe déjà : on l'ouvre, on n'en écrit pas un second.
    modal.querySelector('#map-request-access').onclick = async () => {
      try {
        const { openAccessRequestModal } = await import('./zone-access.js');
        await openAccessRequestModal(user, notifications);
      } catch {
        notifications?.showNotification("Le formulaire de demande d'accès n'a pas pu s'ouvrir.", 'error');
      }
    };
    const surEchap = event => { if (event.key === 'Escape') closeMap(); };
    document.addEventListener('keydown', surEchap, true);
    mapCleanup = () => document.removeEventListener('keydown', surEchap, true);
  }

  /**
   * BRIEFING D'ENTRÉE — posé SUR la carte, plus devant elle.
   *
   * L'écran précédent était un portail plein écran, sur un dégradé bleu générique, qu'il
   * fallait congédier à chaque ouverture avant de voir quoi que ce soit. La carte ne
   * commençait à se construire qu'après le clic : on attendait devant une porte fermée.
   *
   * Le plan s'affiche désormais tout de suite, et l'orientation vient se poser par-dessus,
   * en retrait, à travers un voile flouté qui laisse voir le plan derrière. Le premier
   * geste — clic, Échap, ou le bouton — la retire. Aucune information n'est perdue : les
   * quatre repères sont les mêmes, écrits dans le langage de la plateforme.
   */
  function showWelcome(callback) {
    if (closed) return;
    // La carte d'abord : le briefing se pose dessus, il ne la remplace plus.
    if (callback) callback();

    welcome = document.createElement('div');
    welcome.id = 'welcome-screen';
    welcome.className = 'map-briefing';
    welcome.setAttribute('role', 'dialog');
    welcome.setAttribute('aria-modal', 'false');
    welcome.setAttribute('aria-label', 'Repères de la carte interactive');
    welcome.innerHTML = `
      <div class="map-briefing-panel">
        <span class="map-briefing-mark tl"></span><span class="map-briefing-mark br"></span>
        <header class="map-briefing-head">
          <span class="map-briefing-eyebrow">Jumeau opérationnel</span>
          <h2>Carte interactive</h2>
          <p>Salles, baies et équipements techniques, à leur place réelle.</p>
        </header>
        <dl class="map-briefing-keys">
          <div><dt><i class="fas fa-search" aria-hidden="true"></i> Recherche</dt><dd>Retrouver un élément par son nom ou sa référence.</dd></div>
          <div><dt><i class="fas fa-mouse-pointer" aria-hidden="true"></i> Navigation</dt><dd>Ouvrir une salle, une baie ou un équipement.</dd></div>
          <div><dt><i class="fas fa-life-ring" aria-hidden="true"></i> Tickets</dt><dd>Créer une demande depuis l'élément concerné.</dd></div>
          <div><dt><i class="fas fa-ruler-combined" aria-hidden="true"></i> Administration</dt><dd>Ajuster positions et dimensions autorisées.</dd></div>
        </dl>
        <button id="welcome-start-btn" type="button" class="map-briefing-go">Explorer le plan</button>
        <p class="map-briefing-hint">Un clic n'importe où ferme ce rappel.</p>
      </div>`;
    document.body.appendChild(welcome);

    const fermer = () => {
      if (!welcome) return;
      welcome.classList.add('is-leaving');
      const partant = welcome;
      welcome = null;
      setTimeout(() => partant.remove(), 420);
      document.removeEventListener('keydown', surEchap, true);
    };
    function surEchap(event) { if (event.key === 'Escape') { event.stopPropagation(); fermer(); } }

    welcome.addEventListener('click', fermer);
    document.addEventListener('keydown', surEchap, true);
    document.getElementById('welcome-start-btn')?.focus?.();
    requestAnimationFrame(() => welcome?.classList.add('is-open'));
  }

  function renderMapUI() {
    if (closed) return;
    document.getElementById('map-modal')?.remove();
    const modal = document.createElement('div');
    mapModal = modal;
    modal.id = "map-modal";
    modal.className = "modal-map";
    modal.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 9999; overflow: hidden; background: #19242d;
    `;
    // Ajouter أزرار الأدمن (داخل التولبار، مرئية فقط للأدمن)
    modal.innerHTML = `
      <div id="map-container" style="position: fixed; inset: 0; width: 100vw; height: 100vh;">
        <img src="${safeImageUrl(mapImage, '')}" id="main-map-img"
          style="width: 100vw; height: 100vh; object-fit: cover; user-select: none; position: absolute; top: 0; left: 0;">
        <canvas id="areas-canvas" width="2000" height="1200"
          style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none;"></canvas>
        <!--
          LA ZONE DOCUMENTÉE EST LA CIBLE DU CLIC.
          Même repère que le canevas — 2000 × 1200, étiré sur la fenêtre — donc les
          coordonnées du contrat de formes s'y posent sans conversion.
        -->
        <svg id="map-shape-hits" viewBox="0 0 2000 1200" preserveAspectRatio="none"
          style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 20; overflow: visible;"></svg>
        <div id="map-hotspots"
          style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 30;"></div>
        <div id="map-toolbar" class="map-toolbar"
          style="position: absolute; top: 25px; right: 34px; z-index: 40; display: flex; gap: 7px; align-items: center; background: rgba(34, 44, 66, 0.86); border-radius: 12px; padding: 6px 12px;">
          <input type="search" id="map-search" placeholder="Rechercher une salle, une baie, un équipement…" style="padding: 6px 13px; border-radius: 7px; border: 1px solid #d6dae1; font-size: 15px; min-width: 150px;">
          <button id="zoom-in" title="Zoom avant" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-search-plus"></i></button>
          <button id="zoom-out" title="Zoom arrière" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-search-minus"></i></button>
          <button id="reset-zoom" title="Réinitialiser la vue" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-compress"></i></button>
          <button id="fullscreen-btn" title="Plein écran" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-expand"></i></button>
          ${peutEditerCarte ? `
            <button id="edit-mode-btn" title="Mode édition" class="btn ${dragMode ? 'success' : 'gray'}" style="padding: 5px 10px;"><i class="fas fa-edit"></i></button>
            ${droitsCarte.room.create ? `<button id="add-room-btn" title="Ajouter une salle" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-door-open"></i></button>` : ''}
            ${droitsCarte.baie.create ? `<button id="add-baie-btn" title="Ajouter une baie" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-cube"></i></button>` : ''}
            <button id="lock-btn" title="Verrouiller ou déverrouiller" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-${locked ? 'lock' : 'unlock'}"></i></button>
            <button id="save-all-btn" title="Enregistrer" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-save"></i></button>
            <button id="export-btn" title="Exporter" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-file-export"></i></button>
          ` : ''}
          <button id="close-map" class="btn danger" style="margin-left: 6px; padding: 5px 10px;"><i class="fas fa-times"></i></button>
        </div>
        <div id="map-search-results" style="position: absolute; top: 65px; right: 37px; z-index: 50; max-height: 320px; overflow-y: auto; width: 320px; background: #fff; border-radius: 13px; box-shadow: 0 2px 22px #1117; display: none;"></div>
        <!--
          Les non positionnés vivent À CÔTÉ du plan, jamais dessus : leur place sur le plan
          est précisément ce qu'on ne connaît pas.
        -->
        <div id="map-non-positionnes" style="position: absolute; bottom: 18px; left: 18px; z-index: 40; max-height: 240px; overflow-y: auto; width: 232px; background: rgba(16,26,36,.93); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 9px 10px; display: none;"></div>
        <div id="map-panel" style="display: none; position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 90; background: rgba(15,25,40,0.94);"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const img = document.getElementById('main-map-img');
    const canvas = document.getElementById('areas-canvas');
    const ctx = canvas.getContext('2d');
    const hotspots = document.getElementById('map-hotspots');
    const zonesCliquables = document.getElementById('map-shape-hits');
    const panel = document.getElementById('map-panel');
    const getDisplayScale = () => Math.max(.01, Number(modal.dataset.mapDisplayScale) || zoom || 1);
    const eventToCanvasPoint = event => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) * (canvas.width / Math.max(1, bounds.width)),
        y: (event.clientY - bounds.top) * (canvas.height / Math.max(1, bounds.height))
      };
    };
    let lastResults = [];
    let isDragging = false, dragTarget = null, offsetX = 0, offsetY = 0;

    // الأزرار الرئيسية
    document.getElementById('zoom-in').onclick = () => { zoom = Math.min(2.4, zoom + 0.13); applyTransform(); };
    document.getElementById('zoom-out').onclick = () => { zoom = Math.max(0.55, zoom - 0.13); applyTransform(); };
    document.getElementById('reset-zoom').onclick = () => { zoom = 1; panX = 0; panY = 0; applyTransform(); };
    document.getElementById('fullscreen-btn').onclick = () => {
      if (modal.requestFullscreen) modal.requestFullscreen();
      else if (modal.webkitRequestFullscreen) modal.webkitRequestFullscreen();
    };
    document.getElementById('close-map').onclick = () => {
      closeMap();
    };

    // أزرار الأدمن بعد رسم التولبار
    if (peutEditerCarte) {
      document.getElementById('edit-mode-btn').onclick = () => {
        dragMode = !dragMode;
        document.getElementById('edit-mode-btn').classList.toggle('success', dragMode);
        document.getElementById('edit-mode-btn').classList.toggle('gray', !dragMode);
        drawAreasAndHotspots(currentView);
      };

      /*
       * CHAQUE BOUTON EST CÂBLÉ SOUS LA MÊME CONDITION QUI L'A RENDU.
       *
       * Le défaut, trouvé par la recette navigateur : « Ajouter une salle » et « Ajouter
       * une baie » sont rendus sous `room.create` / `baie.create`, mais leur câblage était
       * inconditionnel. Un Responsable — le SEUL rôle qui atteint le mode édition sans
       * pouvoir créer — tombait donc sur `null.onclick`, et l'exception remontait jusqu'au
       * `.catch()` du chargement, qui affiche « Accès restreint ». Le rôle avait pourtant
       * tous ses droits : la carte lui refusait l'accès à cause d'un bouton absent.
       *
       * Aucune erreur en console, puisque l'exception était rattrapée : c'est exactement le
       * genre de panne qu'une épreuve de source ne voit pas, et qu'un vrai navigateur voit.
       */
      document.getElementById('add-room-btn')?.addEventListener('click', () => addNewItem('room'));
      document.getElementById('add-baie-btn')?.addEventListener('click', () => addNewItem('baie'));
      document.getElementById('lock-btn').onclick = () => {
        locked = !locked;
        document.getElementById('lock-btn').innerHTML = `<i class="fas fa-${locked ? 'lock' : 'unlock'}"></i>`;
        notifications?.showNotification(`Carte ${locked ? 'verrouillée' : 'déverrouillée'}.`, locked ? 'warning' : 'success');
      };

      document.getElementById('save-all-btn').onclick = async () => {
        /*
         * TANT QU'UNE ÉDITION DE COORDONNÉES EST ACTIVE, CE BOUTON NE PEUT PAS PERSISTER SON
         * BROUILLON. Il boucle sur `equipments` en mémoire, exactement les fiches que
         * `coordinateSession` a en cours de glisser-déposer — et sans garde, une valeur non
         * acquittée (voire un E2 laissé `pending` après un 409) partirait ici, hors de la
         * dette que la session est censée protéger. L'attribut `disabled` (voir
         * `refreshSaveAllAvailability`) empêche déjà le clic ; ce garde reste la seconde
         * ligne, pour rester correct même si l'attribut n'est pas honoré par l'appelant.
         */
        if (coordinateSession) {
          notifications?.showNotification(
            'Terminez ou annulez la modification des positions en cours avant d’enregistrer tout.', 'warning');
          return;
        }
        try {
          for (let room of rooms) await db.save('rooms', room);
          for (let baie of baies) await db.save('baies', baie);
          for (let eq of equipments) await db.save('equipments', eq);
          notifications?.showNotification("Toutes les modifications ont été enregistrées.", "success");
        } catch (e) {
          notifications?.showNotification(`Échec de l'enregistrement : ${e.message}`, "error");
        }
      };

      document.getElementById('export-btn').onclick = () => {
        const data = { rooms, baies, equipments };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `map-export-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        notifications?.showNotification("Données de la carte exportées.", "success");
      };
    }

    function applyTransform() {
      img.style.transform = canvas.style.transform = hotspots.style.transform =
        `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    }

    document.getElementById('map-search').oninput = e => {
      const q = e.target.value;
      const res = searchAll({ query: q, rooms, baies, equipments });
      lastResults = res;
      showSearchResults(res);
    };

    function showSearchResults(results) {
      const cont = document.getElementById('map-search-results');
      if (!results.length) { cont.innerHTML = ''; cont.style.display = "none"; return; }
      cont.style.display = "block";
      cont.innerHTML = `
        <ul style="list-style:none;margin:0;padding:7px;">
          ${results.map(r => `
            <li data-type="${r.type}" data-id="${r.id}" style="cursor: pointer; padding: 8px 0 6px 8px; border-bottom: 1px solid #eee;">
              <span class="badge badge-${r.type}" style="margin-right: 9px; background: ${r.type == 'room' ? '#2874a6' : r.type == 'baie' ? '#8e44ad' : '#27ae60'}; color: #fff; padding: 2px 10px; border-radius: 7px;">
                ${r.type === 'room' ? 'Salle' : r.type === 'baie' ? 'Baie' : 'Équipement'}
              </span>
              <span>${esc(r.name || r.nom || r.numSerie)}</span>
            </li>
          `).join('')}
        </ul>
      `;
      cont.querySelectorAll('li').forEach(li => {
        li.onclick = async () => {
          cont.style.display = "none";
          /*
           * Un résultat de recherche conduit à la SCÈNE où la fiche se trouve, et l'y
           * désigne — puis ouvre son panneau. Ouvrir le panneau seul laissait l'utilisateur
           * sans repère visuel : il savait quoi, jamais où.
           */
          await localiserVue?.(li.dataset.type, li.dataset.id);
          openPanel(li.dataset.type, li.dataset.id);
        };
      });
    }

    // =========== رسم الخريطة + النقاط ===========
    /*
     * CE QUE LA CARTE MONTRE, ET DANS QUEL ORDRE — DIVULGATION PROGRESSIVE.
     *
     * LE DÉFAUT FERMÉ ICI. À l'ouverture, la vue générale posait un repère permanent pour
     * CHAQUE salle ET CHAQUE baie de la plateforme, plus — pour qui peut éditer — la forme
     * de chacune. On ne voyait plus un plan : on voyait un semis de pastilles. Les entités
     * sans position documentée recevaient en outre un repère de repli sur une grille : une
     * position inventée, indiscernable d'une position réelle.
     *
     * La règle, désormais :
     *
     *   plan général   les SALLES seules, et discrètes : la zone reste cliquable, elle se
     *                  déclare au survol ou au focus clavier. Ni baies ni équipements.
     *   scène Salle    ses baies, et ses équipements HORS baie.
     *   scène Baie     ses équipements, et rien d'autre.
     *
     * Et le CHROME D'ÉDITION — formes, repères de repli, pictogrammes permanents — n'existe
     * qu'en mode édition. En consultation, une entité non positionnée n'est pas dessinée :
     * elle est listée dans « Non positionnés », où l'on peut la voir sans qu'elle mente sur
     * l'endroit où elle se trouve.
     */
    /*
     * LE TRACÉ D'UN CÂBLE SE DESSINE APRÈS LES ZONES, ET SEULEMENT S'IL A ÉTÉ DEMANDÉ.
     *
     * `cable-route-layer.js` ne dessine rien tant qu'aucun câble n'a été choisi — la carte
     * par défaut reste la carte. Quand un câble l'est, la couche pose les segments de LA
     * SCÈNE OUVERTE, dans le même espace 2000 × 1200 que les formes de salles, si bien
     * qu'ils s'alignent sur l'image comme tout le reste du dessin.
     */
    const sceneDeLaVue = view => (view.type === 'map'
      ? { sceneType: 'map', sceneId: null }
      : { sceneType: view.type, sceneId: view.id });

    /*
     * `synchroniserTrace` — LE PANNEAU NE SE REDESSINE PAS LUI-MÊME EN BOUCLE.
     *
     * Le panneau du tracé demande un redessin à chaque geste, et le redessin décide de
     * l'ouverture du panneau : les deux enchaînés tourneraient sans fin. Le redessin que
     * le panneau demande ne repasse donc pas par cette synchronisation — il ne fait que
     * remettre le plan à jour sous la barre.
     */
    function drawAreasAndHotspots(view = currentView, { synchroniserTrace = true } = {}) {
      ctx.clearRect(0, 0, 2000, 1200);
      hotspots.innerHTML = '';
      if (zonesCliquables) zonesCliquables.innerHTML = '';
      // `dragMode` est l'interrupteur du mode édition ; sans droit d'administration il ne
      // s'allume pas, et la carte reste en consultation pour tout le monde.
      const modeEdition = dragMode && peutEditerCarte;
      const nonPositionnes = [];

      /*
       * Un repère n'est dessiné que si sa position est DOCUMENTÉE. Sinon il rejoint la
       * liste des non positionnés — sauf en mode édition, où le repli sur grille est
       * précisément l'outil qui permet de les saisir et de les placer.
       */
      const poser = (entite, placement, options) => {
        if (!placement.placed && !modeEdition) {
          nonPositionnes.push({ type: options.type, id: options.id, nom: options.title });
          return;
        }
        hotspots.appendChild(makeHotspot({ ...options, x: placement.x, y: placement.y, placed: placement.placed }));
      };

      if (view.type === "map") {
        // Les formes sont du chrome d'édition : elles ne s'affichent qu'en mode édition.
        if (modeEdition && droitsCarte.room.edit) rooms.forEach(room => drawEntityShape(room, "#5bb2ff33"));

        rooms.forEach((room, rang) => {
          const placement = resolveEntityPlacement(room, { rank: rang, pointKeys: ['x', 'y'], scene: 'map' });
          /*
           * TROIS CAS, ET UN SEUL EST UNE PASTILLE.
           *
           *   forme documentée   la SURFACE est la cible : on ne pose aucun repère.
           *   point seul         un repère discret, qui ne prétend pas être la pièce.
           *   rien de documenté  aucune cible sur le plan — la salle rejoint la liste.
           */
          if (!modeEdition && poserZoneCliquable(room, {
            type: 'room', nom: room.name, onOpen: () => openPanel('room', room.id)
          })) return;
          poser(room, placement, {
            color: "#2d7dfc", size: modeEdition ? 40 : 30, type: "room", id: room.id,
            title: placement.placed ? room.name : `${room.name} — à placer`,
            discret: !modeEdition,
            /*
             * NON PLACÉE **ET** ÉDITABLE PAR CE RÔLE — les deux, jamais la première seule.
             *
             * Avec le droit : le clic va directement au même éditeur de forme que
             * « Modifier » au clic droit, puisque la salle n'a alors pas de panneau utile.
             *
             * Sans lui : on garde le panneau de consultation. Le cas n'est pas théorique —
             * le Responsable détient `equipments.edit`, ce qui lui OUVRE le mode édition
             * (map-permissions-contract.js#mapAbilities, délibéré), mais pas `rooms.edit`.
             * `editArea` le refuserait de toute façon ; seulement, un écran ne propose pas
             * un geste dont il connaît déjà l'issue. Le repère reste visible et marqué
             * « à placer » — le fait n'est pas caché — et le clic mène à ce que le rôle
             * peut réellement faire.
             */
            onClick: !placement.placed && droitsCarte.room.edit
              ? () => editArea('room', room.id)
              : () => openPanel('room', room.id),
            onRightClick: peutAdministrer('room') ? (e) => { e.preventDefault(); showContextMenu(e, 'room', room.id); } : null
          });
        });
        /*
         * LES BAIES NE SONT PLUS POSÉES SUR LE PLAN GÉNÉRAL.
         *
         * Elles y recevaient un second repère, en plus de celui qu'elles ont déjà dans leur
         * salle — la même baie, dessinée deux fois, à deux niveaux. C'était la moitié de
         * l'encombrement de la vue d'entrée, et aucune information n'est perdue : on les
         * retrouve en entrant dans la salle qui les contient, avec leur position propre.
         * En mode édition, elles restent accessibles pour être positionnées sur le plan.
         */
        if (modeEdition) {
          if (droitsCarte.baie.edit) baies.forEach(baie => drawEntityShape(baie, "#b86fff33"));
          baies.forEach((baie, rang) => {
            if (!baie.roomId) return;
            const placement = resolveEntityPlacement(baie, { rank: rang, pointKeys: ['x_inMap', 'y_inMap'], options: { originY: 320 }, scene: 'map' });
            poser(baie, placement, {
              color: "#914bce", size: 28, type: "baie", id: baie.id,
              title: placement.placed ? baie.name : `${baie.name} — à placer`,
              // Même règle que la salle ci-dessus, et pour la même raison : `baies.edit`
              // est faux pour le Responsable, à qui le mode édition est pourtant ouvert.
              onClick: !placement.placed && droitsCarte.baie.edit
                ? () => editArea('baie', baie.id)
                : () => openPanel('baie', baie.id),
              onRightClick: peutAdministrer('baie') ? (e) => { e.preventDefault(); showContextMenu(e, 'baie', baie.id); } : null
            });
          });
        }
      }

      if (view.type === "room") {
        let room = rooms.find(r => r.id == view.id);
        const roomWall = walls.find(wall => String(wall.roomId) === String(room.id));
        if (roomWall?.layout?.roomRect) drawResponsiveRect(roomWall.layout.roomRect, '#00bcd455');
        if (modeEdition && droitsCarte.room.edit) drawEntityShape(room, "#5bb2ff33");

        baies.filter(b => b.roomId == room.id).forEach((baie, rang) => {
          const placement = resolveEntityPlacement(baie, { rank: rang, pointKeys: ['x_inRoom', 'y_inRoom'], scene: 'room' });
          poser(baie, placement, {
            color: "#914bce", size: 28, type: "baie", id: baie.id,
            title: placement.placed ? baie.name : `${baie.name} — à placer`,
            discret: !modeEdition,
            onClick: () => openPanel('baie', baie.id),
            onRightClick: peutAdministrer('baie') ? (e) => { e.preventDefault(); showContextMenu(e, 'baie', baie.id, room); } : null
          });
        });
        // Les équipements MONTÉS EN BAIE appartiennent à la scène de leur baie, pas à
        // celle-ci : `!eq.baieId` est la condition qui les y laisse.
        equipments.filter(eq => eq.roomId == room.id && !eq.baieId).forEach((eq, rang) => {
          const placement = resolveEntityPlacement(eq, { rank: rang, pointKeys: ['x_inRoom', 'y_inRoom'], options: { originY: 420, columns: 8, stepX: 34, stepY: 34 }, scene: 'room' });
          poser(eq, placement, {
            color: eq.status === "faulty" ? "#e74c3c" : "#16a085", size: 22, type: "equipment", id: eq.id,
            title: placement.placed ? (eq.nom || eq.name) : `${eq.nom || eq.name} — à placer`,
            discret: !modeEdition,
            onClick: () => openPanel('equipment', eq.id),
            // Le glisser-déposer exige une session active pour CETTE vue : sans elle, un
            // déplacement muterait `x_inRoom/y_inRoom` sans aucun moyen de l'annuler ni de
            // le distinguer d'une saisie enregistrée — voir `cancelCoordinateSession`.
            draggable: droitsCarte.equipment.edit && dragMode && !locked && coordinateSessionMatches('room', room.id),
            onDrag: (dx, dy) => {
              eq.x_inRoom = (eq.x_inRoom || placement.x) + dx / getDisplayScale();
              eq.y_inRoom = (eq.y_inRoom || placement.y) + dy / getDisplayScale();
              coordinateSession?.markDirty(eq);
              drawAreasAndHotspots(currentView);
            },
            onRightClick: peutAdministrer('equipment') ? (e) => { e.preventDefault(); showContextMenu(e, 'equipment', eq.id, room); } : null
          });
        });
      }

      if (view.type === "baie") {
        let baie = baies.find(b => b.id == view.id);
        if (modeEdition && droitsCarte.baie.edit) drawEntityShape(baie, "#b86fff33");
        equipments.filter(eq => eq.baieId == baie.id).forEach((eq, rang) => {
          const placement = resolveEntityPlacement(eq, { rank: rang, pointKeys: ['x_inBaie', 'y_inBaie'], options: { originY: 400, columns: 8, stepX: 32, stepY: 32 }, scene: 'baie' });
          poser(eq, placement, {
            color: eq.status === "faulty" ? "#e74c3c" : "#16a085", size: 20, type: "equipment", id: eq.id,
            title: placement.placed ? (eq.nom || eq.name) : `${eq.nom || eq.name} — à placer`,
            discret: !modeEdition,
            onClick: () => openPanel('equipment', eq.id),
            draggable: droitsCarte.equipment.edit && dragMode && !locked && coordinateSessionMatches('baie', baie.id),
            onDrag: (dx, dy) => {
              eq.x_inBaie = (eq.x_inBaie || placement.x) + dx / getDisplayScale();
              eq.y_inBaie = (eq.y_inBaie || placement.y) + dy / getDisplayScale();
              coordinateSession?.markDirty(eq);
              drawAreasAndHotspots(currentView);
            },
            onRightClick: peutAdministrer('equipment') ? (e) => { e.preventDefault(); showContextMenu(e, 'equipment', eq.id, baie); } : null
          });
        });
      }

      // Outil d'AUTEUR : il n'a pas sa place au-dessus d'un plan qu'on vient consulter.
      renderNonPositionnes(modeEdition ? nonPositionnes : []);

      // Le tracé passe EN DERNIER : il se lit par-dessus les zones, jamais sous elles.
      drawRouteLayer(ctx, sceneDeLaVue(view), { width: 2000, height: 1200 });
      if (synchroniserTrace) synchroniserPanneauTrace(view);
    }

    /* ═════════════════════════════════════════════════════════════════════════
     * LE PANNEAU DU TRACÉ — il suit le câble choisi, et la scène ouverte
     * ═════════════════════════════════════════════════════════════════════════
     *
     * Il n'existe que lorsqu'un câble a été désigné — depuis une Fiche360 ou la liste des
     * câbles. Aucun câble choisi : pas de barre, et la carte reste la carte.
     *
     * CHANGER DE SCÈNE REDEMANDE LA CAPACITÉ. `creatableHere` ne vaut que pour la scène
     * qui a été nommée dans la requête : la garder en passant de STC à RF1 proposerait
     * « Ajouter un tracé » là où le serveur refusera le trait. Une édition en cours, elle,
     * ne change pas de scène sous les pieds de son auteur — `rescene()` s'en abstient.
     */
    let panneauTrace = null;
    let sceneDuPanneau = null;

    function synchroniserPanneauTrace(view) {
      const cable = selectedCable();
      if (!cable) {
        if (panneauTrace) { const ancien = panneauTrace; panneauTrace = null; sceneDuPanneau = null; ancien.close(); }
        return;
      }
      if (!panneauTrace) {
        panneauTrace = openCableRoutePanel({
          canvas, ctx,
          /*
           * DEUX COUCHES RECOUVRENT LE CANEVAS, ET IL FAUT LES NEUTRALISER TOUTES LES DEUX.
           *
           * MESURÉ dans Chromium : `document.elementsFromPoint` au milieu du plan rend
           * [svg#map-shape-hits, canvas#areas-canvas, …] — la couche des ZONES CLIQUABLES
           * est PREMIÈRE, avant même celle des marqueurs. Elle avalait donc chaque appui,
           * et pas un seul point ne pouvait être posé : le relevé restait vide, sans le
           * moindre message. N'en neutraliser qu'une revenait à n'en neutraliser aucune.
           */
          overlays: ['#map-hotspots', '#map-shape-hits'],
          eventToPoint: eventToCanvasPoint,
          displayScale: getDisplayScale,
          redraw: () => drawAreasAndHotspots(currentView, { synchroniserTrace: false }),
          scene: () => sceneDeLaVue(currentView),
          context: () => ({ rooms, baies }),
          notifications,
          /*
           * RENDRE LA FICHE LOCALE COMPLÈTE, PAS SEULEMENT L'IDENTIFIANT.
           *
           * `db.save` (enveloppée par `central-sync.js`) écrit LOCALEMENT, pousse au
           * serveur, PUIS estampille la copie locale de la révision accordée — le tout
           * dans une transaction IndexedDB unique via `accorderRevision()`. Au moment où
           * cette promesse se résout, cette fiche locale porte donc, ensemble et sans
           * fenêtre entre les deux, les champs métier ENVOYÉS et la révision que LE
           * SERVEUR vient d'attribuer À CETTE écriture précise. `cable-route-editor.js` en
           * a besoin pour fermer un faux STALE_WRITE sans jamais coller la révision d'un
           * appel réseau distinct — potentiellement plus récent — sur des champs plus
           * anciens.
           */
          save: async cable => { const id = await db.save('cables', cable); return db.get('cables', id); },
          onClose: () => { panneauTrace = null; sceneDuPanneau = null; }
        });
        sceneDuPanneau = null;
      }
      const cle = `${view.type}#${view.id ?? ''}`;
      if (cle === sceneDuPanneau) { panneauTrace.refresh(); return; }
      sceneDuPanneau = cle;
      panneauTrace.rescene();
    }

    /*
     * « NON POSITIONNÉS » — ce qui existe mais n'a pas de place documentée.
     *
     * Ces fiches ne sont pas perdues : elles sont dites, comptées et ouvrables. Ce qu'on
     * refuse, c'est de leur inventer un point sur le plan — une position fabriquée est
     * indiscernable d'une position relevée, et c'est exactement ce qu'un jumeau numérique
     * ne doit jamais laisser croire.
     */
    function renderNonPositionnes(liste) {
      const hote = document.getElementById('map-non-positionnes');
      if (!hote) return;
      /*
       * CE TIROIR NE S'AFFICHE QU'EN MODE ÉDITION.
       *
       * Il sert à repérer et à placer ce qui n'a pas de position documentée : c'est un outil
       * de QUALITÉ DE DONNÉES. Posé en permanence au-dessus du plan, il redevenait
       * exactement ce qu'on venait de retirer — du mobilier qui masque la carte pour un
       * utilisateur qui n'a rien à corriger.
       *
       * La fiche n'est pas cachée de la plateforme pour autant : elle reste atteignable par
       * les listes, la recherche et sa fiche. Seule la CARTE reste honnête et nette.
       */
      if (!liste.length) { hote.style.display = 'none'; hote.innerHTML = ''; return; }
      hote.style.display = 'block';
      hote.innerHTML = `
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9fb6c6;margin-bottom:6px;">
          Non positionnés · ${liste.length}
        </div>
        <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;">
          ${liste.map(item => `
            <li><button type="button" class="map-nonplace-item" data-type="${esc(item.type)}" data-id="${esc(item.id)}"
              style="width:100%;text-align:left;font:inherit;font-size:12.5px;padding:4px 7px;border-radius:5px;
                     border:1px dashed rgba(255,212,121,.55);background:rgba(255,212,121,.08);color:#f0e2c4;cursor:pointer;">
              ${esc(item.nom || item.id)}
            </button></li>`).join('')}
        </ul>`;
      hote.querySelectorAll('.map-nonplace-item').forEach(bouton => {
        bouton.onclick = () => openPanel(bouton.getAttribute('data-type'), bouton.getAttribute('data-id'));
      });
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /*
     * UNE ZONE DOCUMENTÉE, RENDUE INTERACTIVE — ET RIEN D'AUTRE.
     *
     * Le premier jet du mode consultation retirait bien la pastille, mais posait à la place
     * un disque transparent de 46 px au point d'ancrage : il fallait donc viser un cercle
     * invisible au milieu de la pièce. L'icône avait disparu, pas le problème.
     *
     * Ici, c'est la SURFACE DOCUMENTÉE qui reçoit le survol, le focus et le clic —
     * transposée depuis la forme canonique par `shapeToSvgGeometry`, sans second format de
     * géométrie. Au repos, elle est parfaitement transparente : le plan reste un plan.
     */
    function poserZoneCliquable(entite, { type, nom, onOpen }) {
      const geometrie = shapeToSvgGeometry(readShape(entite));
      if (!geometrie) return false;

      const forme = document.createElementNS(SVG_NS, geometrie.tag);
      for (const [cle, valeur] of Object.entries(geometrie.attrs)) forme.setAttribute(cle, String(valeur));
      forme.setAttribute('fill', 'transparent');
      forme.setAttribute('stroke', 'transparent');
      forme.setAttribute('stroke-width', '3');
      forme.setAttribute('vector-effect', 'non-scaling-stroke');
      forme.setAttribute('tabindex', '0');
      forme.setAttribute('role', 'button');
      forme.setAttribute('aria-label', nom || String(entite?.id ?? ''));
      forme.setAttribute('data-type', type);
      forme.setAttribute('data-id', String(entite?.id ?? ''));
      forme.classList.add('map-zone-cliquable');
      forme.style.cursor = 'pointer';
      forme.style.outline = 'none';
      forme.style.transition = 'fill .14s, stroke .14s';

      // L'étiquette suit la zone : elle se pose au point d'ancrage GARANTI INTÉRIEUR du
      // contrat de formes, jamais au centre d'une boîte englobante qui peut tomber dehors.
      const ancre = resolveEntityPlacement(entite, { pointKeys: ['x', 'y'], scene: 'map' });
      const etiquette = document.createElementNS(SVG_NS, 'text');
      etiquette.setAttribute('x', String(ancre.x));
      etiquette.setAttribute('y', String(ancre.y));
      etiquette.setAttribute('text-anchor', 'middle');
      etiquette.setAttribute('dominant-baseline', 'middle');
      etiquette.setAttribute('fill', '#ffffff');
      etiquette.setAttribute('stroke', 'rgba(10,18,26,.85)');
      etiquette.setAttribute('stroke-width', '4');
      etiquette.setAttribute('paint-order', 'stroke');
      etiquette.setAttribute('font-size', '22');
      etiquette.setAttribute('font-weight', '600');
      etiquette.style.pointerEvents = 'none';
      etiquette.style.opacity = '0';
      etiquette.style.transition = 'opacity .14s';
      etiquette.textContent = nom || '';

      const montrer = () => {
        forme.setAttribute('fill', 'rgba(45,125,252,.20)');
        forme.setAttribute('stroke', '#ffffff');
        etiquette.style.opacity = '1';
      };
      const cacher = () => {
        forme.setAttribute('fill', 'transparent');
        forme.setAttribute('stroke', 'transparent');
        etiquette.style.opacity = '0';
      };
      forme.addEventListener('mouseenter', montrer);
      forme.addEventListener('mouseleave', cacher);
      forme.addEventListener('focus', montrer);
      forme.addEventListener('blur', cacher);
      forme.addEventListener('click', event => { event.stopPropagation(); if (!dragMode) onOpen(); });
      forme.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!dragMode) onOpen();
      });

      zonesCliquables.appendChild(forme);
      zonesCliquables.appendChild(etiquette);
      return true;
    }

    function drawRect(rect, color = "#2277ee33") {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color.replace('33', '77');
      ctx.stroke();
    }

    /**
     * Dessine la zone d'une entité SELON SA FORME.
     *
     * Le plan dessinait `entity.rect` — donc un rectangle, toujours. Un cercle enregistré
     * se serait affiché comme le carré de sa boîte englobante, et un polygone comme le
     * rectangle qui l'entoure : la forme aurait été perdue à l'affichage tout en restant
     * correcte en base, ce qui est le pire des deux mondes.
     */
    function drawEntityShape(entity, color = "#2277ee33") {
      const forme = readShape(entity);
      if (!forme) return;
      paintShape(ctx, forme, { fond: color, trait: color.replace('33', '77') });
    }

    function drawResponsiveRect(rect, color) {
      drawRect({ x: rect.x / 100 * canvas.width, y: rect.y / 100 * canvas.height, w: rect.width / 100 * canvas.width, h: rect.height / 100 * canvas.height }, color);
    }

    // hotspot تفاعلي (يدعم drag في وضع التعديل فقط للأدمن)
    function makeHotspot({ x, y, color, size, type, id, title, onClick, onRightClick, draggable, onDrag, placed = true, discret = false }) {
      const spot = document.createElement('div');
      spot.className = 'map-hotspot ' + type + (placed ? '' : ' is-unplaced') + (discret ? ' is-discret' : '');
      spot.setAttribute('data-type', type);
      spot.setAttribute('data-id', id);
      spot.setAttribute('data-placed', placed ? 'oui' : 'non');
      spot.title = title || "";

      /*
       * MODE CONSULTATION : LE PLAN D'ABORD, LES REPÈRES ENSUITE.
       *
       * En consultation, un repère permanent et coloré par salle transformait le plan en
       * semis de pastilles : on ne voyait plus le bâtiment, on voyait les marqueurs. La
       * zone reste donc cliquable, mais ne se DÉCLARE qu'au survol ou à la prise de focus
       * clavier — contour net et nom lisible. Rien n'est retiré : ce qui était visible en
       * permanence devient visible à la demande.
       *
       * Le clavier est un chemin de plein droit, pas un repli : `tabindex`, `role` et
       * `aria-label` rendent la salle atteignable et annonçable, et Entrée ou Espace
       * l'ouvre comme le ferait un clic.
       */
      if (discret) {
        spot.tabIndex = 0;
        spot.setAttribute('role', 'button');
        spot.setAttribute('aria-label', title || String(id));
        const etiquette = document.createElement('span');
        etiquette.className = 'map-hotspot-label';
        etiquette.textContent = title || '';
        etiquette.style.cssText = `
          position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%);
          white-space: nowrap; font-size: 12px; font-weight: 600; color: #f2f8fc;
          background: rgba(12,22,32,.88); padding: 2px 8px; border-radius: 5px;
          pointer-events: none; opacity: 0; transition: opacity .14s;
        `;
        const montrer = () => {
          spot.style.opacity = '1';
          spot.style.borderColor = '#ffffff';
          spot.style.background = `${color}55`;
          spot.style.boxShadow = `0 0 0 3px ${color}66`;
          etiquette.style.opacity = '1';
        };
        const cacher = () => {
          spot.style.opacity = '0';
          spot.style.borderColor = 'transparent';
          spot.style.background = 'transparent';
          spot.style.boxShadow = 'none';
          etiquette.style.opacity = '0';
        };
        spot.addEventListener('mouseenter', montrer);
        spot.addEventListener('mouseleave', cacher);
        spot.addEventListener('focus', montrer);
        spot.addEventListener('blur', cacher);
        spot.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (onClick && !dragMode) onClick();
        });
        spot.appendChild(etiquette);
      }
      // Un élément non placé se distingue AU PREMIER COUP D'ŒIL : contour discontinu et
      // teinte atténuée. Le ranger sans le signaler laisserait croire à une position réelle,
      // ce qui serait un mensonge sur un plan technique.
      spot.style.cssText = `
        position: absolute; left: ${x - size / 2}px; top: ${y - size / 2}px; width: ${size}px; height: ${size}px;
        background: ${discret ? 'transparent' : color};
        border: 2px ${discret ? 'solid transparent' : (placed ? 'solid #fff' : 'dashed #ffd479')};
        opacity: ${discret ? 0 : (placed ? 1 : 0.82)};
        box-shadow: ${discret ? 'none' : '0 2px 10px #2b7bc49b'}; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center; z-index: 12;
        transition: opacity .14s, box-shadow 0.17s, transform 0.13s, background .14s, border-color .14s;
      `;
      // En consultation, pas de pictogramme permanent : c'est lui qui encombrait le plan.
      if (!discret) {
        spot.innerHTML = `<i class="fas fa-${type === 'room' ? 'door-open' : type === 'baie' ? 'cube' : 'server'}" style="color: #fff;"></i>`;
      }
      /*
       * `dragMode` TAIT LE CLIC GAUCHE POUR LAISSER PLACE AU GLISSER — ET L'EXCEPTION SE
       * MESURE SUR `draggable`, PAS SUR `placed`.
       *
       * Une salle ou une baie de repli du plan général n'est jamais `draggable` : rien à
       * protéger d'elle, et la taire la rendait totalement inerte au clic ET au glisser
       * tant qu'elle est visible — or elle ne l'est QU'en mode édition. Son clic reste donc
       * ouvert, c'est tout l'objet du correctif du repli sur grille.
       *
       * Un ÉQUIPEMENT non placé, lui, est bel et bien `draggable` dès qu'une session de
       * coordonnées est ouverte sur sa scène : la condition qui l'accorde ne regarde pas
       * `placed`. Lui rouvrir le clic sur le seul critère `!placed` rouvrait donc un chemin
       * vers `openPanel('equipment', …)`, qui quitte la vue propriétaire de la session et
       * exécute `cancelCoordinateSession()` : tous les déplacements non enregistrés
       * restaurés, Enregistrer/Annuler disparus, au milieu d'un relevé en cours. L'exception
       * porte donc sur ce qu'elle prétendait viser depuis le début — un repère qu'AUCUN
       * geste de glisser n'occupe.
       */
      spot.onclick = (e) => { e.stopPropagation(); if (onClick && (!dragMode || (!placed && !draggable))) onClick(); };
      if (onRightClick) spot.oncontextmenu = onRightClick;
      // سحب hotspot لأي جهاز (للأدمن فقط وفي وضع التعديل)
      if (draggable) {
        spot.onmousedown = (e) => {
          if (locked) return;
          isDragging = true;
          dragTarget = spot;
          offsetX = e.clientX;
          offsetY = e.clientY;
          document.onmousemove = (moveEv) => {
            if (!isDragging) return;
            let dx = moveEv.clientX - offsetX, dy = moveEv.clientY - offsetY;
            offsetX = moveEv.clientX; offsetY = moveEv.clientY;
            if (onDrag) onDrag(dx, dy);
          };
          document.onmouseup = () => {
            isDragging = false; dragTarget = null;
            document.onmousemove = null; document.onmouseup = null;
          };
        };
      }
      return spot;
    }

    // ============= القائمة السياقية للأدمن ============
    /*
     * CHAQUE ENTRÉE DU MENU A SON PROPRE ACTE.
     *
     * « Modifier », « Déplacer », « Redimensionner » et « Changer l'image » modifient :
     * elles relèvent d'`edit`. « Supprimer » relève de `delete`, que la matrice refuse au
     * Chef sur les trois types. Un menu qui les offrait toutes ensemble promettait un acte
     * que le serveur refuse désormais — et proposer un refus est une faute d'interface.
     */
    const ACTE_DU_MENU = Object.freeze({
      edit: 'edit', move: 'edit', resize: 'edit', 'change-image': 'edit', delete: 'delete'
    });

    function showContextMenu(e, type, id, parent = null) {
      if (locked) return;

      const contextMenu = document.getElementById('admin-context-menu');
      // Filtrage AVANT l'affichage : on ne montre jamais une entrée pour la retirer ensuite.
      let offertes = 0;
      contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        const permis = mapCan(user, type, ACTE_DU_MENU[item.getAttribute('data-action')]);
        item.hidden = !permis;
        if (permis) offertes += 1;
      });
      // Aucun acte permis sur ce type : pas de menu du tout, plutôt qu'un cadre vide.
      if (!offertes) return;
      contextMenu.style.display = 'block';
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.setAttribute('data-type', type);
      contextMenu.setAttribute('data-id', id);
      contextMenu.setAttribute('data-parent', parent ? parent.id : '');
      contextMenuVisible = true;

      // إخفاء القائمة عند النقر في أي مكان آخر
      setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
      }, 10);
    }

    function hideContextMenu() {
      if (!contextMenuVisible) return;
      const contextMenu = document.getElementById('admin-context-menu');
      contextMenu.style.display = 'none';
      contextMenuVisible = false;
      document.removeEventListener('click', hideContextMenu);
    }

    // معالجة أحداث القائمة السياقية
    if (peutEditerCarte) {
      document.querySelectorAll('.context-menu-item').forEach(item => {
        item.onclick = function() {
          const action = this.getAttribute('data-action');
          const contextMenu = document.getElementById('admin-context-menu');
          const type = contextMenu.getAttribute('data-type');
          const id = contextMenu.getAttribute('data-id');
          const parentId = contextMenu.getAttribute('data-parent');
          
          let obj = type === 'room' ? rooms.find(r => r.id === id) : 
                   type === 'baie' ? baies.find(b => b.id === id) : 
                   equipments.find(e => e.id === id);
          
          let parent = parentId ? (parentId.startsWith('room') ? rooms.find(r => r.id === parentId) : baies.find(b => b.id === parentId)) : null;

          hideContextMenu();

          switch(action) {
            case 'edit':
              if (type === 'room' || type === 'baie') {
                editArea(type, id);
              } else {
                openEditEquipmentModal(obj);
              }
              break;
            case 'move':
              dragMode = true;
              document.getElementById('edit-mode-btn').classList.add('success');
              document.getElementById('edit-mode-btn').classList.remove('gray');
              drawAreasAndHotspots(currentView);
              break;
            case 'resize':
              if (type === 'room' || type === 'baie') {
                resizeArea(type, id);
              }
              break;
            case 'change-image':
              changeImage(type, id);
              break;
            case 'delete':
              deleteItem(type, id, parent);
              break;
          }
        };
      });
    }

    // ============= Ajouter عنصر جديد ============
    function addNewItem(type) {
      if (!mapCan(user, type, 'create')) {
        notifications?.showNotification("Votre rôle ne permet pas cette création.", "error");
        return;
      }
      if (locked) {
        notifications?.showNotification("La carte est verrouillée : ajout impossible.", "error");
        return;
      }

      let name = prompt(`Saisissez le nom de ${type === 'room' ? 'la nouvelle salle' : 'la nouvelle baie'} :`);
      if (!name) return;

      const newId = type === 'room' ? `room-${Date.now()}` : `baie-${Date.now()}`;
      const newItem = {
        id: newId,
        name: name,
        rect: null
      };

      if (type === 'room') {
        rooms.push(newItem);
      } else {
        if (currentView.type === 'room') {
          newItem.roomId = currentView.id;
        } else {
          let roomId = prompt("Saisissez l’identifiant de la salle associée à cette baie :");
          if (!roomId) return;
          newItem.roomId = roomId;
        }
        baies.push(newItem);
      }

      notifications?.showNotification(`Ajout effectué : ${type === 'room' ? 'salle' : 'baie'} ajouté(e)`, "success");
      drawAreasAndHotspots(currentView);
      editArea(type, newId);
    }

    // ============= تغيير صورة العنصر ============
    function changeImage(type, id) {
      if (!mapCan(user, type, 'edit')) {
        notifications?.showNotification("Votre rôle ne permet pas de changer cette image.", "error");
        return;
      }
      if (locked) {
        notifications?.showNotification("La carte est verrouillée : modification d’image impossible.", "error");
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          // هنا يمكنك رفع الصورة إلى الخادم وEnregistrer الرابط
          // لأغراض العرض، سنستخدم URL.createObjectURL لعرض الصورة محليًا
          const imageUrl = URL.createObjectURL(file);
          
          if (type === 'room') {
            const room = rooms.find(r => r.id === id);
            room.image = imageUrl;
            await db.save('rooms', room);
          } else if (type === 'baie') {
            const baie = baies.find(b => b.id === id);
            baie.image = imageUrl;
            await db.save('baies', baie);
          }

          notifications?.showNotification("Image mise à jour.", "success");
          drawAreasAndHotspots(currentView);
          if (panel.style.display === 'flex') {
            openPanel(type, id);
          }
        } catch (error) {
          notifications?.showNotification("Impossible de mettre à jour l’image.", "error");
        }
      };
      input.click();
    }

    // ============= حذف عنصر ============
    async function deleteItem(type, id, parent = null) {
  if (locked) {
    notifications?.showNotification("La carte est verrouillée : suppression impossible.", "error");
    return;
  }

  /*
   * LA GARDE QUI MANQUAIT.
   *
   * Cette fonction ne vérifiait QUE le verrou. Sa seule autre barrière était l'affichage
   * de l'entrée de menu, conditionnée par `rooms.edit` — donc un Chef, qui détient
   * `rooms.edit`, supprimait salles, baies et équipements alors que la matrice lui déclare
   * `delete:false` sur les trois. Cacher un bouton n'est pas une autorisation : le chemin
   * reste atteignable par le clavier, par un menu resté ouvert, ou par un appel direct.
   * Le serveur refuse désormais aussi ; l'écran ne doit pas pour autant proposer l'acte.
   */
  if (!mapCan(user, type, 'delete')) {
    notifications?.showNotification("Votre rôle ne permet pas cette suppression.", "error");
    return;
  }

  if (!confirm(`Confirmer la suppression de ${type === 'room' ? 'la salle' : type === 'baie' ? 'la baie' : 'l’équipement'} ?`)) {
    return;
  }

  try {
    if (type === 'room') {
      await db.deleteRoomSafely(id);
      rooms = rooms.filter(r => r.id !== id);
    } 
    else if (type === 'baie') {
      await db.deleteBaieSafely(id);
      baies = baies.filter(b => b.id !== id);
    } 
    else {
      await db.deleteEquipmentSafely(id);
      equipments = equipments.filter(e => e.id !== id);
    }

    notifications?.showNotification(`Suppression effectuée.`, "success");
    drawAreasAndHotspots(currentView);
    if (panel.style.display === 'flex') {
      panel.style.display = 'none';
      currentView = { type: "map" };
      drawAreasAndHotspots();
    }
  } catch (error) {
    notifications?.showNotification(error.message || "Une erreur est survenue pendant la suppression.", "error");
  }
}

    // ============= FORMES : rectangle, cercle, polygone ============
    //
    // Deux fonctions séparées vivaient ici : `editArea`, qui ne savait TRACER qu'un
    // rectangle par un glisser sans jamais pouvoir le reprendre, et `resizeArea`, qui
    // posait UNE SEULE poignée au coin bas-droit. Aucune des deux ne connaissait autre
    // chose que le rectangle — or une régie n'est pas un rectangle, un pupitre courbe non
    // plus. Les deux appellent désormais le même éditeur, qui gère les trois formes et
    // tous les gestes : tracer, déplacer, tirer une poignée, ajouter ou retirer un point.
    let editeurForme = null;
    // L'éditeur de forme IMBRIQUÉE (baie/équipement sur la photo de sa salle ou de sa
    // baie — voir plus bas) est un second éditeur, distinct de celui du plan général :
    // les deux ne dessinent jamais sur le même canevas, mais un seul doit rester actif à
    // la fois pour qu'un « Retour » ou une navigation n'abandonne pas un brouillon sans
    // bouton pour le revoir.
    let editeurFormeImbriquee = null;
    // Le montage courant du canevas de formes imbriquées (voir `installerFormesPhoto` plus
    // bas) — distinct de l'éditeur : celui-ci existe dès qu'un panneau salle/baie est
    // ouvert, que son mode édition soit actif ou non.
    let formesPhotoActuelles = null;
    /** Ferme SEULEMENT l'éditeur ouvert — le canevas qui l'accueille continue de vivre. */
    function fermerEditionFormeImbriquee() {
      editeurFormeImbriquee?.close();
      editeurFormeImbriquee = null;
    }
    /**
     * Ferme TOUT ce que ce panneau porte sur les formes imbriquées — appelée partout où la
     * session de coordonnées l'est déjà, pour la même raison : `panel.innerHTML` s'apprête
     * à remplacer le nœud qui les hébergeait tous les deux.
     */
    function fermerFormesImbriquees() {
      fermerEditionFormeImbriquee();
      formesPhotoActuelles?.destroy();
      formesPhotoActuelles = null;
    }
    // Le panneau existe : la fermeture de la carte sait désormais quoi appeler. Posé ici,
    // au contact de la déclaration, pour qu'on ne puisse pas ajouter un nettoyage à cette
    // fonction en oubliant qu'une portée parente en dépend.
    fermerFormesImbriqueesDuPanneau = fermerFormesImbriquees;

    function editArea(type, id) {
      if (!mapCan(user, type, 'edit')) {
        notifications?.showNotification("Votre rôle ne permet pas de modifier cette zone.", "error");
        return;
      }
      if (locked) {
        notifications?.showNotification("La carte est verrouillée : modification impossible.", "error");
        return;
      }
      const obj = type === 'room' ? rooms.find(r => r.id === id) : baies.find(b => b.id === id);
      if (!obj) {
        notifications?.showNotification("Élément introuvable.", "error");
        return;
      }
      // Un second éditeur ouvert par-dessus le premier laisserait deux jeux d'écouteurs
      // sur le canevas, et la forme suivrait deux gestes à la fois.
      editeurForme?.close();
      fermerEditionFormeImbriquee();
      editeurForme = openShapeEditor(obj, {
        canvas, ctx, type,
        /*
         * DEUX COUCHES RECOUVRENT LE CANEVAS, PAS UNE.
         *
         * Ce tableau n'en nommait qu'une, et il datait d'avant C3 — qui a fait de la ZONE
         * documentée elle-même la cible du clic, en posant `svg#map-shape-hits` par-dessus
         * le plan. MESURÉ dans Chromium : `elementsFromPoint` au milieu du plan rend
         * [svg#map-shape-hits, canvas#areas-canvas, …], et un glisser complet ne traçait
         * plus RIEN — `shape()` restait `null`. Le mode édition ne permettait donc plus de
         * dessiner une forme de salle du tout, sans le moindre message.
         */
        overlays: ['#map-hotspots', '#map-shape-hits'],
        eventToPoint: eventToCanvasPoint,
        displayScale: getDisplayScale,
        redraw: () => drawAreasAndHotspots(currentView),
        notifications,
        save: async entite => {
          const enregistre = await db.save(type === 'room' ? 'rooms' : 'baies', entite);
          // La liste en mémoire doit refléter l'enregistrement, sinon le plan continue
          // d'afficher l'ancienne forme jusqu'au prochain rechargement complet.
          const liste = type === 'room' ? rooms : baies;
          const index = liste.findIndex(item => String(item.id) === String(entite.id));
          if (index > -1) liste[index] = { ...liste[index], ...(enregistre || entite) };
          return enregistre;
        },
        onClose: () => { editeurForme = null; drawAreasAndHotspots(currentView); }
      });
    }

    // « Redimensionner » ouvre le même éditeur : la distinction entre tracer et
    // redimensionner n'avait de sens que tant qu'on ne savait faire ni l'un ni l'autre
    // correctement.
    function resizeArea(type, id) { editArea(type, id); }

    /* ═════════════════════════════════════════════════════════════════════
     * FORMES IMBRIQUÉES — la baie sur la photo de sa salle, l'équipement sur
     * la photo de sa salle ou de sa baie. Voir nested-shape-contract.js.
     * ═════════════════════════════════════════════════════════════════════
     *
     * `#map-panel` recouvre `#areas-canvas` (z-index 90 contre 30/20/rien) dès qu'une
     * salle ou une baie est ouverte — mesuré par `document.elementFromPoint` : les repères
     * `x_inRoom`/`x_inBaie` que le plan général dessine sur SON canevas n'ont jamais été
     * visibles ni cliquables une fois ce panneau ouvert, et « Modifier les positions » y
     * déplaçait un repère que personne ne pouvait voir. Cette section leur donne enfin une
     * vraie surface, À L'ÉCHELLE DE LA PHOTO — ses pixels naturels, jamais ceux, sans
     * rapport, du canevas 2000×1200 du plan général (voir map-coordinates-contract.js).
     *
     * Le canevas de forme et celui du plan général ne sont jamais visibles en même temps :
     * un seul éditeur (`editeurForme` OU `editeurFormeImbriquee`) est donc actif à la fois.
     */

    /** Entité fraîche depuis les tableaux en mémoire — jamais une copie figée au premier rendu. */
    function entiteFraiche(type, id) {
      const liste = type === 'baie' ? baies : equipments;
      return liste.find(item => String(item.id) === String(id)) || null;
    }

    /** Qui apparaît sur CETTE photo, avec le champ de forme et le droit propres à SON type. */
    function descripteursScenePhoto(sceneType, sceneId) {
      if (sceneType === 'room') {
        const surBaies = baies.filter(baie => String(baie.roomId) === String(sceneId)).map(baie => Object.freeze({
          type: 'baie', id: baie.id, shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'],
          peutEditer: droitsCarte.baie.edit, couleur: '#914bce', nom: baie.name
        }));
        const surEquipements = equipments
          .filter(eq => String(eq.roomId) === String(sceneId) && !eq.baieId)
          .map(eq => Object.freeze({
            type: 'equipment', id: eq.id, shapeField: SHAPE_IN_ROOM_FIELD, pointKeys: ['x_inRoom', 'y_inRoom'],
            peutEditer: droitsCarte.equipment.edit, couleur: eq.status === 'faulty' ? '#e74c3c' : '#16a085',
            nom: eq.nom || eq.name
          }));
        return [...surBaies, ...surEquipements];
      }
      if (sceneType === 'baie') {
        return equipments.filter(eq => String(eq.baieId) === String(sceneId)).map(eq => Object.freeze({
          type: 'equipment', id: eq.id, shapeField: SHAPE_IN_BAIE_FIELD, pointKeys: ['x_inBaie', 'y_inBaie'],
          peutEditer: droitsCarte.equipment.edit, couleur: eq.status === 'faulty' ? '#e74c3c' : '#16a085',
          nom: eq.nom || eq.name
        }));
      }
      return [];
    }

    /**
     * Monte le canevas de formes d'UNE photo (salle ou baie) : dessin, clic pour ouvrir,
     * et — pour qui en a le droit — un mode d'édition qui réutilise `openShapeEditor` tel
     * quel, via un petit adaptateur qui redirige `.shape` vers le bon champ imbriqué au
     * lieu du `shape` du plan général.
     *
     * `stage`, `img` et `canvas` sont les nœuds FRAÎCHEMENT posés par `openPanel` : cette
     * fonction est appelée une fois par ouverture de panneau, jamais mise en cache d'un
     * appel à l'autre — `panel.innerHTML` recrée ces nœuds à chaque fois.
     */
    function installerFormesPhoto({ sceneType, sceneId, img, canvas, listeAPlacer, boutonFormes }) {
      const ctx = canvas.getContext('2d');
      let modeFormes = false;
      let detruit = false;

      const rayonPoint = () => Math.max(6, canvas.width * 0.008);

      function dimensionnerCanevas() {
        const largeur = img.naturalWidth;
        const hauteur = img.naturalHeight;
        if (!largeur || !hauteur) return false;
        if (canvas.width !== largeur) canvas.width = largeur;
        if (canvas.height !== hauteur) canvas.height = hauteur;
        return true;
      }

      function dessiner() {
        if (detruit || !dimensionnerCanevas()) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const nonPlaces = [];
        for (const d of descripteursScenePhoto(sceneType, sceneId)) {
          const entite = entiteFraiche(d.type, d.id);
          if (!entite) continue;
          const place = nestedPlacement(entite, { shapeField: d.shapeField, pointKeys: d.pointKeys });
          if (place.kind === 'shape') {
            paintShape(ctx, place.shape, { trait: d.couleur, fond: `${d.couleur}33`, epaisseur: modeFormes ? 3 : 2 });
          } else if (place.kind === 'point') {
            ctx.beginPath();
            ctx.arc(place.x, place.y, rayonPoint(), 0, Math.PI * 2);
            ctx.fillStyle = d.couleur; ctx.fill();
            ctx.lineWidth = Math.max(1, canvas.width * 0.0015); ctx.strokeStyle = '#fff'; ctx.stroke();
          } else {
            nonPlaces.push(d);
          }
        }
        peindreListeAPlacer(nonPlaces);
      }

      function peindreListeAPlacer(nonPlaces) {
        if (!listeAPlacer) return;
        if (!modeFormes || !nonPlaces.length) {
          listeAPlacer.style.display = 'none';
          listeAPlacer.innerHTML = '';
          return;
        }
        listeAPlacer.style.display = 'block';
        listeAPlacer.innerHTML = `<div class="nested-shapes-unplaced-title">À placer sur cette photo</div>`
          + nonPlaces.map(d => `<button type="button" class="nested-shapes-unplaced-item" data-type="${esc(d.type)}" data-id="${esc(String(d.id))}">${esc(d.nom || '')}</button>`).join('');
        listeAPlacer.querySelectorAll('.nested-shapes-unplaced-item').forEach(bouton => {
          bouton.onclick = () => {
            const d = descripteursScenePhoto(sceneType, sceneId)
              .find(item => item.type === bouton.dataset.type && String(item.id) === bouton.dataset.id);
            if (d) ouvrirEditeur(d);
          };
        });
      }

      function pointNaturelDepuisEvenement(event) {
        return toNaturalCoordinates({
          clientX: event.clientX, clientY: event.clientY,
          rect: canvas.getBoundingClientRect(),
          naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight
        });
      }

      function descripteurAuPoint(point) {
        const liste = descripteursScenePhoto(sceneType, sceneId);
        // Dernier dessiné = au-dessus : on cherche à l'envers, comme un empilement visuel.
        for (let i = liste.length - 1; i >= 0; i -= 1) {
          const d = liste[i];
          const entite = entiteFraiche(d.type, d.id);
          if (!entite) continue;
          const place = nestedPlacement(entite, { shapeField: d.shapeField, pointKeys: d.pointKeys });
          if (place.kind === 'shape' && shapeContains(place.shape, point)) return d;
          if (place.kind === 'point' && Math.hypot(point.x - place.x, point.y - place.y) <= rayonPoint() * 1.6) return d;
        }
        return null;
      }

      function ouvrirEditeur(d) {
        if (!d.peutEditer) {
          notifications?.showNotification("Votre rôle ne permet pas de modifier cette forme.", "error");
          return;
        }
        if (locked) {
          notifications?.showNotification("La carte est verrouillée : modification impossible.", "error");
          return;
        }
        const entiteActuelle = entiteFraiche(d.type, d.id);
        if (!entiteActuelle) {
          notifications?.showNotification("Élément introuvable.", "error");
          return;
        }
        editeurForme?.close();
        fermerEditionFormeImbriquee();
        const vue = { ...entiteActuelle, shape: entiteActuelle[d.shapeField] };
        editeurFormeImbriquee = openShapeEditor(vue, {
          canvas, ctx, type: d.type,
          overlays: [],
          eventToPoint: pointNaturelDepuisEvenement,
          displayScale: () => canvas.getBoundingClientRect().width / Math.max(1, canvas.width),
          redraw: dessiner,
          notifications,
          save: async patch => {
            const forme = normalizeShape(patch.shape);
            if (!shapeWithinBounds(forme, img.naturalWidth, img.naturalHeight)) {
              throw new Error('Cette forme est entièrement hors de la photo : elle n’a pas été enregistrée.');
            }
            const fraiche = entiteFraiche(d.type, d.id) || entiteActuelle;
            const aEnregistrer = withNestedShape(fraiche, d.shapeField, forme);
            const store = d.type === 'baie' ? 'baies' : 'equipments';
            // `db.save` (central-sync.js, write-coherence.js) ne rend que l'IDENTIFIANT — sa
            // chaîne de wrappers le documente elle-même ainsi (`return id`). On tient donc à
            // jour le tableau en mémoire avec la valeur qu'on vient d'écrire, jamais avec un
            // retour qui ne l'a jamais porté.
            await db.save(store, aEnregistrer);
            const liste = d.type === 'baie' ? baies : equipments;
            const index = liste.findIndex(item => String(item.id) === String(d.id));
            if (index > -1) liste[index] = { ...liste[index], ...aEnregistrer };
            return aEnregistrer;
          },
          onClose: () => { editeurFormeImbriquee = null; dessiner(); }
        });
      }

      function surClicCanevas(event) {
        // Un geste de l'éditeur de forme (tracer, tirer une poignée) ne doit jamais
        // rouvrir un AUTRE éditeur par-dessus le sien.
        if (editeurFormeImbriquee) return;
        if (!img.naturalWidth) return;
        const d = descripteurAuPoint(pointNaturelDepuisEvenement(event));
        if (!d) return;
        // Cliquer une entité qu'on ne peut pas éditer reste consultable — la permission
        // se juge PAR TYPE, pas par un mode global qui bloquerait la vue elle-même.
        if (modeFormes && d.peutEditer) ouvrirEditeur(d);
        else openPanel(d.type, d.id);
      }

      canvas.addEventListener('click', surClicCanevas);
      if (boutonFormes) {
        boutonFormes.onclick = () => {
          modeFormes = !modeFormes;
          boutonFormes.classList.toggle('success', modeFormes);
          boutonFormes.innerHTML = modeFormes
            ? '<i class="fas fa-check"></i> Terminé'
            : '<i class="fas fa-draw-polygon"></i> Modifier les formes';
          if (!modeFormes) fermerEditionFormeImbriquee();
          dessiner();
        };
      }

      if (img.complete && img.naturalWidth) dessiner();
      else img.addEventListener('load', dessiner);

      /*
       * SÉLECTEUR EXPLICITE PAR TYPE — « Dessiner une baie », « Dessiner un équipement ».
       *
       * Le seul point d'entrée était jusqu'ici « Modifier les formes », un bouton générique
       * qu'il fallait ACTIVER puis DEVINER quoi cliquer sur la photo. Ces sélecteurs ne
       * dessinent rien de nouveau : ils listent — filtrée par TYPE et par SCÈNE, via
       * `descripteursScenePhoto`, exactement comme le fait déjà la liste « À placer » — les
       * entités canoniques existantes, et ouvrent le MÊME `ouvrirEditeur` que le clic sur le
       * canevas ou sur un bouton « à placer ». Aucun inventaire n'est inventé ; une entité
       * déjà positionnée reste sélectionnable, pour la reprendre.
       */
      function entitesDuType(type) {
        return descripteursScenePhoto(sceneType, sceneId)
          .filter(d => d.type === type)
          .map(d => {
            const entite = entiteFraiche(d.type, d.id);
            const place = entite ? nestedPlacement(entite, { shapeField: d.shapeField, pointKeys: d.pointKeys }) : { kind: 'unplaced' };
            return { ...d, placee: place.kind !== 'unplaced' };
          });
      }

      function ouvrirSelecteurType(type, hote) {
        if (!hote) return;
        // Un second clic sur le même déclencheur referme le sélecteur déjà ouvert, comme
        // le bouton « Modifier les formes » lui-même bascule entre ses deux états.
        if (hote.dataset.type === type && hote.style.display !== 'none') {
          hote.style.display = 'none'; hote.innerHTML = ''; delete hote.dataset.type;
          return;
        }
        const liste = entitesDuType(type);
        hote.dataset.type = type;
        hote.style.display = 'block';
        const titre = type === 'baie' ? 'Choisir une baie à dessiner sur cette photo' : 'Choisir un équipement à dessiner sur cette photo';
        if (!liste.length) {
          hote.innerHTML = `<div class="nested-shapes-unplaced-title">${esc(titre)}</div><div class="nested-shapes-unplaced-item is-empty">Aucune entité de ce type ici.</div>`;
          return;
        }
        hote.innerHTML = `<div class="nested-shapes-unplaced-title">${esc(titre)}</div>`
          + liste.map(d => `<button type="button" class="nested-shapes-unplaced-item${d.placee ? ' is-placed' : ''}" data-type="${esc(d.type)}" data-id="${esc(String(d.id))}">${esc(d.nom || '')} <small>${d.placee ? '· déjà positionné' : '· à placer'}</small></button>`).join('');
        hote.querySelectorAll('.nested-shapes-unplaced-item[data-id]').forEach(bouton => {
          bouton.onclick = () => {
            const d = liste.find(item => String(item.id) === bouton.dataset.id);
            hote.style.display = 'none'; hote.innerHTML = ''; delete hote.dataset.type;
            if (d) ouvrirEditeur(d);
          };
        });
      }

      return {
        redraw: dessiner,
        // Appelé si `panel.innerHTML` remplace ce nœud pendant qu'une image tardait encore
        // à charger : un `load` qui arrive après coup ne doit pas dessiner sur un canevas
        // détaché, ni chercher un bouton qui n'existe plus.
        destroy: () => { detruit = true; },
        entitesDuType,
        ouvrirSelecteurType
      };
    }

    // ============= PANEL / DETAILS ============
    //
    // Le bandeau de contexte de la salle passe par `pucesActifs()` (socle Pilote), comme
    // Salles et Baies. Écrit en dur, il était injecté AUSSI en `?pilote=0`, où aucune règle
    // ne le style — les seules le sont sous `body.pilot-technique-ui` : ses trois spans
    // retombaient sur la couleur héritée du corps, sombre sur le fond sombre de
    // `#map-panel`. Le contrat rend '' hors prévisualisation, et relit la classe à chaque
    // rendu : une sortie par `?pilote=0` en cours de session est suivie.
    /** Le nom d'affichage d'une entité, sous les deux orthographes que porte la base. */
    const nomEntite = entite => String(entite?.nom ?? entite?.name ?? '').trim();

    /**
     * Le chemin PHYSIQUE de la vue courante, reconstruit depuis les tableaux DÉJÀ en
     * mémoire — aucune lecture supplémentaire. `fullBreadcrumbPath` y ajoutera l'échelle
     * géographique en remontant `room.locationId`.
     */
    function cheminPhysique(type, id) {
      const maillonSalle = salle => salle
        ? [{ type: 'room', id: salle.id, label: nomEntite(salle), entity: salle }] : [];
      if (type === 'room') return maillonSalle(rooms.find(salle => String(salle.id) === String(id)));
      if (type === 'baie') {
        const baie = baies.find(item => String(item.id) === String(id));
        if (!baie) return [];
        return [
          ...maillonSalle(rooms.find(salle => String(salle.id) === String(baie.roomId))),
          { type: 'baie', id: baie.id, label: nomEntite(baie), entity: baie }
        ];
      }
      if (type === 'equipment') {
        const equipement = equipments.find(item => String(item.id) === String(id));
        if (!equipement) return [];
        const baie = equipement.baieId != null
          ? baies.find(item => String(item.id) === String(equipement.baieId)) : null;
        const salle = rooms.find(item => String(item.id) === String(baie ? baie.roomId : equipement.roomId));
        return [
          ...maillonSalle(salle),
          ...(baie ? [{ type: 'baie', id: baie.id, label: nomEntite(baie), entity: baie }] : []),
          { type: 'equipment', id: equipement.id, label: nomEntite(equipement), entity: equipement }
        ];
      }
      return [];
    }

    /*
     * LE FIL D'ARIANE DE LA CARTE.
     *
     * Les maillons SALLE et BAIE sont des vues que ce plan sait réellement ouvrir : ils
     * sont donc des boutons. Les maillons géographiques — Ville, Région, Département — ne
     * correspondent à aucune vue de la carte : ils sont affichés parce que l'information
     * est vraie et utile (« où faut-il envoyer quelqu'un ? »), et laissés NON cliquables
     * plutôt que de promettre une navigation qui n'existe pas.
     *
     * Le dernier maillon est la vue courante : il ne se clique pas non plus.
     */
    function filArianeHtml(type, id) {
      const chemin = fullBreadcrumbPath(cheminPhysique(type, id), localisations);
      if (chemin.length < 2) return '';
      const separateur = '<span aria-hidden="true" style="color:#5a7a94;">›</span>';
      const maillons = chemin.map((maillon, index) => {
        const dernier = index === chemin.length - 1;
        const navigable = !dernier && (maillon.type === 'room' || maillon.type === 'baie');
        const corps = `<span style="opacity:.62;font-size:.82em;text-transform:uppercase;letter-spacing:.04em;">${esc(maillon.typeLabel)}</span> ${esc(maillon.label)}`;
        const styleCommun = 'font:inherit;font-size:12.5px;padding:3px 7px;border-radius:6px;';
        return navigable
          ? `<button type="button" data-fil-type="${esc(maillon.type)}" data-fil-id="${esc(maillon.id)}" style="${styleCommun}border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#dce9f5;cursor:pointer;">${corps}</button>`
          : `<span style="${styleCommun}border:1px solid transparent;color:${dernier ? '#ffffff' : '#b9cddd'};">${corps}</span>`;
      });
      return `<nav aria-label="Chemin" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px;justify-content:center;">${maillons.join(separateur)}</nav>`;
    }

    /** Les actions disponibles, rendues seulement s'il y en a. */
    function actionsHtml(type, id) {
      const actions = actionsContextuelles(type, id);
      if (!actions.length) return '';
      return `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px;">${actions.map(action =>
        `<button type="button" class="btn gray" data-carte-section="${esc(action.section)}" style="font-size:12.5px;"><i class="fas ${esc(action.icone)}"></i> ${esc(action.libelle)}</button>`
      ).join('')}</div>`;
    }

    /** Chaque action ouvre la section qu'elle nomme, par la route déjà en place. */
    function cablerActions() {
      panel.querySelectorAll('[data-carte-section]').forEach(bouton => {
        bouton.onclick = event => {
          event.stopPropagation();
          ouvrirSection(bouton.dataset.carteSection);
        };
      });
    }

    /** Un seul écouteur pour tout le panneau : les maillons ouvrent la vue qu'ils nomment. */
    function cablerFilAriane() {
      panel.querySelectorAll('[data-fil-type]').forEach(bouton => {
        bouton.onclick = event => {
          event.stopPropagation();
          openPanel(bouton.dataset.filType, bouton.dataset.filId);
        };
      });
    }

    ouvrirVue = (type, id) => openPanel(type, id);

    /*
     * LOCALISER : ALLER À LA SCÈNE, PUIS DÉSIGNER — pas revenir au plan général.
     *
     * « Localiser sur la carte » cherchait le repère DANS LE DOM au niveau du plan, puis
     * le cliquait. Deux faiblesses : il fallait que la cible soit déjà rendue au niveau où
     * l'on se trouvait, et la désignation se confondait avec une ouverture. Depuis que le
     * plan général ne pose plus les baies, cette recherche ne trouvait simplement plus
     * rien — un équipement monté en baie n'était plus localisable du tout.
     *
     * On navigue désormais par le MODÈLE : un équipement mène à sa baie s'il en a une,
     * sinon à sa salle ; une baie mène à sa salle. Puis la cible reçoit un halo TEMPORAIRE
     * — jamais une icône permanente, qui rendrait au plan l'encombrement qu'on vient d'en
     * retirer.
     */
    localiserVue = async (type, id) => {
      /*
       * La scène se décide par le CONTRAT, pas ici : `map-navigation-contract.js` est pur,
       * donc la règle « on se place chez le parent » est exécutée par une épreuve au lieu
       * d'être cherchée dans ce fichier. Rendre `null` veut dire « je ne sais pas situer
       * cette fiche » — on ne fabrique alors aucune scène.
       */
      const scene = sceneForTarget(type, id, { rooms, baies, equipments });
      if (!scene) return false;
      currentView = scene.type === 'map' ? { type: 'map' } : { type: scene.type, id: scene.id };
      drawAreasAndHotspots(currentView);
      return designerCible(type, id);
    };

    /*
     * ENTRER DANS LA SCÈNE D'UN TRACÉ, ET POSER LE CHEMIN DU RETOUR.
     *
     * On ENTRE dans la scène — on ne se place pas chez son parent : les segments d'une
     * salle ne se dessinent que dans la scène de cette salle. Et l'on n'ouvre que ce qui
     * EXISTE dans ce plan : une salle absente ne se remplace pas par le plan général, qui
     * afficherait un tracé vide sans dire pourquoi.
     */
    entrerDansTraceVue = (scene, { equipmentId = null } = {}) => {
      const type = scene?.sceneType ?? scene?.type ?? null;
      const identifiant = scene?.sceneId ?? scene?.id ?? null;
      if (!type) return false;
      if (type === 'room' && !rooms.some(salle => String(salle.id) === String(identifiant))) return false;
      if (type === 'baie' && !baies.some(baie => String(baie.id) === String(identifiant))) return false;
      if (!['map', 'room', 'baie'].includes(type)) return false;

      // Le retour est CALCULÉ par le contrat, pas assemblé ici : la règle reste exécutable
      // par une épreuve, et une seule lecture de la chaîne de rattachement fait foi.
      history = [...cableReturnPath(equipmentId, { rooms, baies, equipments })];
      currentView = type === 'map' ? { type: 'map' } : { type, id: identifiant };
      panel.style.display = 'none';
      drawAreasAndHotspots(currentView);
      return true;
    };

    /** Un halo bref sur la cible : on la montre, on ne la marque pas. */
    function designerCible(type, id) {
      const repere = [...hotspots.querySelectorAll(`.map-hotspot.${type}`)]
        .find(node => String(node.dataset.id) === String(id));
      if (!repere) return false;
      repere.classList.add('is-localise');
      repere.style.opacity = '1';
      repere.style.boxShadow = '0 0 0 4px #ffd479, 0 0 22px 6px #ffd47988';
      repere.scrollIntoView?.({ block: 'center', inline: 'center' });
      // Le halo s'efface de lui-même : une désignation permanente redeviendrait un repère.
      setTimeout(() => {
        repere.classList.remove('is-localise');
        repere.style.boxShadow = '';
        if (repere.classList.contains('is-discret')) repere.style.opacity = '0';
      }, 2600);
      return true;
    }

    /*
     * ENREGISTRER / ANNULER — UN SEUL CÂBLAGE, QU'ON VIENNE DE CLIQUER « Modifier les
     * positions » OU QU'ON REPRENNE UNE SESSION DÉJÀ ACTIVE (reprise après sauvegarde
     * partielle : voir `openPanel`, où `showSaveBtns` redevient vrai sans qu'on reclique).
     *
     * Enregistrer ne pousse QUE les fiches sales (`saveCoordinateEditSession`) : plus de
     * boucle sur `eqs` entier. Un succès complet clôt la session ; une sauvegarde PARTIELLE
     * ou un échec total la laissent délibérément active — l'élément en dette reste sale,
     * visible, et l'utilisateur garde Annuler ou une nouvelle tentative. Jamais de message
     * « tout enregistré » dans ces deux cas.
     */
    function wireCoordinateSaveCancel(type, id) {
      const saveButton = document.getElementById('save-coords-btn');
      const cancelButton = document.getElementById('cancel-coords-btn');
      if (saveButton) saveButton.onclick = async () => {
        const session = coordinateSession;
        if (!session) return;
        const result = await saveCoordinateEditSession(session, record => db.save('equipments', record));
        // La session ne se referme QUE sur un succès complet : un `partial` ou un `failed`
        // la laisse active, l'élément en dette reste sale, et le libellé — voir
        // `map-coordinate-edit-outcome.js` — ne dit jamais « tout enregistré » à sa place.
        if (result.status === 'success') endCoordinateSession();
        const { level, message } = describeCoordinateSaveOutcome(result);
        notifications?.showNotification(message, level);
        drawAreasAndHotspots(currentView);
        openPanel(type, id);
      };
      if (cancelButton) cancelButton.onclick = () => {
        cancelCoordinateSession();
        fermerFormesImbriquees();
        drawAreasAndHotspots(currentView);
        openPanel(type, id);
      };
    }

    async function openPanel(type, id, { historique = true } = {}) {
      // Le fil d'Ariane a besoin de l'échelle géographique : une seule attente, résolue
      // dès l'ouverture de la carte, jamais une lecture par panneau.
      localisations = await localisationsChargees;
      contexte = await contexteCharge;
      /*
       * QUITTER LA VUE ÉDITÉE ABANDONNE LE BROUILLON — JAMAIS UNE PERSISTANCE SILENCIEUSE.
       *
       * Rouvrir CETTE MÊME salle/baie (après Enregistrer ou Annuler) ne doit rien annuler :
       * c'est le seul cas où `coordinateSessionMatches` répond vrai ici, et la session
       * survit alors intacte pour que le panneau puisse la ré-afficher (sauvegarde
       * partielle, par exemple). Toute AUTRE destination — fil d'Ariane, hotspot, panneau
       * équipement — referme la session en restaurant l'état d'avant édition.
       */
      if (coordinateSession && !coordinateSessionMatches(type, id)) cancelCoordinateSession();
      // Contrairement à la session de coordonnées, les formes imbriquées sont toujours
      // fermées ici, MÊME en rouvrant la même salle/baie : leur canevas vit dans le
      // panneau que `panel.innerHTML` s'apprête à remplacer, jamais dans une variable qui
      // survivrait au remplacement.
      fermerFormesImbriquees();
      if (historique) history.push({ ...currentView });
      let html = '';
      let showEditBtn = (type === 'room' || type === 'baie') && mapCan(user, type, 'edit');
      let showSaveBtns = coordinateSessionMatches(type, id);
      let eqs = [];
      
      // Panel Room
      if (type === 'room') {
        let room = rooms.find(r => r.id == id);
        const roomWall = walls.find(wall => String(wall.roomId) === String(room.id));
        const wallRect = roomWall?.layout?.roomRect;
        eqs = equipments.filter(eq => eq.roomId == room.id && !eq.baieId);
        // Les baies de la salle : même tableau que le plan, filtré en mémoire — aucune lecture
        // supplémentaire, la carte possède déjà `baies`.
        const baiesSalle = baies.filter(baie => String(baie.roomId) === String(room.id));
        // Une baie OU un équipement direct peut porter une forme imbriquée sur cette photo :
        // le bouton s'offre dès que l'un des deux droits existe, la permission FINE restant
        // jugée par entité au moment du clic (voir `installerFormesPhoto`).
        const peutModifierFormesRoom = droitsCarte.baie.edit || droitsCarte.equipment.edit;
        html = `
          <div style="width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div id="room-image-stage" style="position:relative;display:inline-block;max-width:96vw;max-height:78vh;">
              <img id="room-detail-image" src="${safeImageUrl(room.image || room.imageUrl, PLACEHOLDER_IMAGE)}" style="display:block;max-width:96vw;max-height:78vh;border-radius:14px;box-shadow:0 2px 32px #0005;">
              <canvas id="room-shapes-canvas" aria-label="Baies et équipements sur cette photo" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
              ${wallRect ? `<button type="button" id="room-wall-hotspot" aria-label="Ouvrir le mur d'images" style="position:absolute;left:${wallRect.x}%;top:${wallRect.y}%;width:${wallRect.width}%;height:${wallRect.height}%;border:3px solid #00bcd4;background:#00bcd433;color:#fff;cursor:pointer;">Mur d'images</button>` : ''}
            </div>
            <div id="room-shapes-unplaced" class="nested-shapes-unplaced" style="display:none;"></div>
            <div id="room-shapes-picker" class="nested-shapes-unplaced" style="display:none;"></div>
            ${filArianeHtml('room', room.id)}
            <div style="color:#fff;font-size:1.35em;">${esc(room.name)}</div>
            ${pucesActifs([
              { icone: 'fa-cube', valeur: baiesSalle.length, libelleUn: 'baie', libelleN: 'baies' },
              { icone: 'fa-server', valeur: eqs.length, libelleUn: 'équipement', libelleN: 'équipements' },
              { icone: 'fa-border-all', libelleUn: roomWall ? 'Mur d’images relié' : 'Aucun mur relié' },
              { icone: 'fa-image', libelleUn: room.image || room.imageUrl ? 'Photo disponible' : 'Aucune photo' },
              ...(room.mobileUnit ? [{ icone: 'fa-truck-moving', libelleUn: 'Unité mobile' }] : [])
            ])}
            ${detailSalle({
              description: room.description,
              faits: [
                { libelle: 'Emplacement', valeur: room.location },
                { libelle: 'Origine', valeur: room.source }
              ]
            })}
            ${actionsHtml('room', room.id)}
            <div style="margin-top:18px;">
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> Retour</button>
              ${canViewWalls && onOpenWall ? `<button class="btn" id="open-wall-btn" style="margin-left:12px;"><i class="fas fa-border-all"></i> Mur d'images</button>` : ''}
              ${showEditBtn && !showSaveBtns ? `<button class="btn" id="edit-coords-btn" style="margin-left:12px;"><i class="fas fa-arrows-alt"></i> Modifier les positions</button>` : ''}
              ${droitsCarte.baie.edit ? `<button class="btn" id="draw-baie-btn" style="margin-left:12px;"><i class="fas fa-vector-square"></i> Dessiner une baie</button>` : ''}
              ${droitsCarte.equipment.edit ? `<button class="btn" id="draw-equipment-btn" style="margin-left:12px;"><i class="fas fa-vector-square"></i> Dessiner un équipement</button>` : ''}
              ${peutModifierFormesRoom ? `<button class="btn" id="edit-shapes-btn" style="margin-left:12px;"><i class="fas fa-draw-polygon"></i> Modifier les formes</button>` : ''}
              ${droitsCarte.equipment.create ? `<button class="btn" id="add-equipment-btn" style="margin-left:12px;"><i class="fas fa-plus"></i> Ajouter un équipement</button>` : ''}
              ${droitsCarte.wall.edit && roomWall ? `<button class="btn" id="edit-wall-area-btn" style="margin-left:12px;"><i class="fas fa-vector-square"></i> Dessiner la zone du mur</button>` : ''}
              ${showSaveBtns ? `
                <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> Enregistrer</button>
                <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> Annuler</button>
              ` : ''}
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { type: "room", id: room.id };
        cablerFilAriane();
        cablerActions();
        db.setCurrentRoomId(room.id).catch(error => console.error('Impossible de mémoriser la salle courante', error));
        drawAreasAndHotspots(currentView);
        formesPhotoActuelles = installerFormesPhoto({
          sceneType: 'room', sceneId: room.id,
          img: document.getElementById('room-detail-image'),
          canvas: document.getElementById('room-shapes-canvas'),
          listeAPlacer: document.getElementById('room-shapes-unplaced'),
          boutonFormes: document.getElementById('edit-shapes-btn')
        });
        const drawBaieButton = document.getElementById('draw-baie-btn');
        if (drawBaieButton) drawBaieButton.onclick = () => formesPhotoActuelles.ouvrirSelecteurType('baie', document.getElementById('room-shapes-picker'));
        const drawEquipmentButtonRoom = document.getElementById('draw-equipment-btn');
        if (drawEquipmentButtonRoom) drawEquipmentButtonRoom.onclick = () => formesPhotoActuelles.ouvrirSelecteurType('equipment', document.getElementById('room-shapes-picker'));

        const wallButton = document.getElementById('open-wall-btn');
        if (wallButton) wallButton.onclick = async () => {
            await db.setCurrentRoomId(room.id);
            closeMap({ notify: false });
            onOpenWall(room.id);
          };
        const wallHotspot = document.getElementById('room-wall-hotspot');
        if (wallHotspot) wallHotspot.onclick = async () => {
          await db.setCurrentRoomId(room.id);
          closeMap({ notify: false });
          onOpenWall?.(room.id);
        };
        const editWallAreaButton = document.getElementById('edit-wall-area-btn');
        if (editWallAreaButton) editWallAreaButton.onclick = () => editWallArea(roomWall, room);
        
        if (showEditBtn && !showSaveBtns) {
          document.getElementById('edit-coords-btn').onclick = () => {
            beginCoordinateSession('room', room.id, eqs, ['x_inRoom', 'y_inRoom']);
            openPanel('room', id);
          };
        }
        if (showSaveBtns) wireCoordinateSaveCancel('room', id);

        if (droitsCarte.equipment.create) {
          document.getElementById('add-equipment-btn').onclick = () => {
            openAddEquipmentModal(room);
          };
        }
      }

      // Panel Baie
      if (type === 'baie') {
        let baie = baies.find(b => b.id == id);
        eqs = equipments.filter(eq => eq.baieId == baie.id);
        html = `
          <div style="width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div id="baie-image-stage" style="position:relative;display:inline-block;max-width:96vw;max-height:78vh;">
              <img id="baie-detail-image" src="${safeImageUrl(baie.image || baie.imageUrl, 'assets/baie-default.jpg')}" style="display:block;max-width:96vw;max-height:78vh;border-radius:14px;box-shadow:0 2px 32px #0005;">
              <canvas id="baie-shapes-canvas" aria-label="Équipements sur cette photo" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
            </div>
            <div id="baie-shapes-unplaced" class="nested-shapes-unplaced" style="display:none;"></div>
            <div id="baie-shapes-picker" class="nested-shapes-unplaced" style="display:none;"></div>
            ${filArianeHtml('baie', baie.id)}
            <div style="color:#fff;font-size:1.2em;">${esc(baie.name)}</div>
            ${pucesActifs([
              { icone: 'fa-server', valeur: eqs.length, libelleUn: 'équipement', libelleN: 'équipements' },
              { icone: 'fa-image', libelleUn: baie.image || baie.imageUrl ? 'Photo disponible' : 'Aucune photo' }
            ])}
            ${actionsHtml('baie', baie.id)}
            <div style="margin-top:15px;">
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> Retour</button>
              ${showEditBtn && !showSaveBtns ? `<button class="btn" id="edit-coords-btn" style="margin-left:12px;"><i class="fas fa-arrows-alt"></i> Modifier les positions</button>` : ''}
              ${droitsCarte.equipment.edit ? `<button class="btn" id="draw-equipment-btn" style="margin-left:12px;"><i class="fas fa-vector-square"></i> Dessiner un équipement</button>` : ''}
              ${droitsCarte.equipment.edit ? `<button class="btn" id="edit-shapes-btn" style="margin-left:12px;"><i class="fas fa-draw-polygon"></i> Modifier les formes</button>` : ''}
              ${droitsCarte.equipment.create ? `<button class="btn" id="add-equipment-btn" style="margin-left:12px;"><i class="fas fa-plus"></i> Ajouter un équipement</button>` : ''}
              ${showSaveBtns ? `
                <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> Enregistrer</button>
                <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> Annuler</button>
              ` : ''}
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { type: "baie", id: baie.id };
        cablerFilAriane();
        cablerActions();
        drawAreasAndHotspots(currentView);
        formesPhotoActuelles = installerFormesPhoto({
          sceneType: 'baie', sceneId: baie.id,
          img: document.getElementById('baie-detail-image'),
          canvas: document.getElementById('baie-shapes-canvas'),
          listeAPlacer: document.getElementById('baie-shapes-unplaced'),
          boutonFormes: document.getElementById('edit-shapes-btn')
        });
        const drawEquipmentButtonBaie = document.getElementById('draw-equipment-btn');
        if (drawEquipmentButtonBaie) drawEquipmentButtonBaie.onclick = () => formesPhotoActuelles.ouvrirSelecteurType('equipment', document.getElementById('baie-shapes-picker'));

        if (showEditBtn && !showSaveBtns) {
          document.getElementById('edit-coords-btn').onclick = () => {
            beginCoordinateSession('baie', baie.id, eqs, ['x_inBaie', 'y_inBaie']);
            openPanel('baie', id);
          };
        }
        if (showSaveBtns) wireCoordinateSaveCancel('baie', id);

        if (droitsCarte.equipment.create) {
          document.getElementById('add-equipment-btn').onclick = () => {
            openAddEquipmentModal(null, baie);
          };
        }
      }
      
      // Panel Equipment
      if (type === 'equipment') {
        let eq = equipments.find(e => e.id == id);
        html = `
          <div style="width: 95vw; height: 95vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="background:#fff; color:#1a253b; border-radius:19px; box-shadow:0 4px 44px #011a; padding:38px 45px; min-width:370px; max-width:520px;">
              <div style="font-size:1.28em;font-weight:700; color:#2874a6;">${esc(eq.nom || eq.name)}</div>
              <div style="margin:16px 0 10px 0;">
                Type : ${esc(eq.type || '-')}<br>
                Marque : ${esc(eq.marque || '-')}<br>
                Modèle : ${esc(eq.modele || '-')}<br>
                Numéro de série : ${esc(eq.numSerie || '-')}<br>
                État : ${eq.status === 'faulty' ? '<span style="color:red;">En panne</span>' : '<span style="color:green;">Opérationnel</span>'}
              </div>
              <div style="margin-bottom:13px;">
                <button class="btn mini" id="add-ticket-eq"><i class="fas fa-life-ring"></i> Ouvrir un ticket</button>
                ${droitsCarte.equipment.edit ? `<button class="btn mini" id="edit-equipment-btn" style="margin-left:8px;"><i class="fas fa-edit"></i> Modifier</button>` : ''}
              </div>
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> Retour</button>
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { ...currentView };
        document.getElementById('add-ticket-eq').onclick = () => openTicketModal({ type: 'equipment', id: eq.id });
        
        if (droitsCarte.equipment.edit) {
          document.getElementById('edit-equipment-btn').onclick = () => {
            openEditEquipmentModal(eq);
          };
        }
      }
    }

    function editWallArea(wall, room) {
      if (!droitsCarte.wall.edit || locked) return notifications?.showNotification('La carte est verrouillée ou cette action est interdite.', 'error');
      const stage = document.getElementById('room-image-stage');
      const image = document.getElementById('room-detail-image');
      if (!stage || !image) return;
      notifications?.showNotification('Cliquez et faites glisser sur l’image pour définir la zone du mur.', 'info');
      const start = event => {
        if (event.target !== image) return;
        event.preventDefault();
        const bounds = image.getBoundingClientRect();
        const origin = { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 };
        const preview = document.createElement('div');
        preview.style.cssText = 'position:absolute;border:3px dashed #00bcd4;background:#00bcd433;pointer-events:none;';
        stage.appendChild(preview);
        const move = moveEvent => {
          const x = Math.max(0, Math.min(100, (moveEvent.clientX - bounds.left) / bounds.width * 100));
          const y = Math.max(0, Math.min(100, (moveEvent.clientY - bounds.top) / bounds.height * 100));
          const left = Math.min(origin.x, x); const top = Math.min(origin.y, y);
          Object.assign(preview.style, { left: `${left}%`, top: `${top}%`, width: `${Math.abs(x - origin.x)}%`, height: `${Math.abs(y - origin.y)}%` });
        };
        const end = async () => {
          image.removeEventListener('pointermove', move); image.removeEventListener('pointerup', end);
          const roomRect = { x: parseFloat(preview.style.left), y: parseFloat(preview.style.top), width: parseFloat(preview.style.width), height: parseFloat(preview.style.height), unit: '%' };
          preview.remove();
          if (roomRect.width < 3 || roomRect.height < 3) return notifications?.showNotification('La zone du mur est trop petite.', 'warning');
          const updated = { ...wall, layout: { ...(wall.layout || {}), roomRect }, updatedAt: new Date().toISOString() };
          await db.save('walls', updated);
          walls = walls.map(item => String(item.id) === String(updated.id) ? updated : item);
          await addLog('wall-area-updated', 'Zone du mur modifiée sur l’image de la salle', { wallId: wall.id, roomId: room.id, roomRect }, user);
          await db.save('notifications', { userId: user.id ?? null, type: 'wall-area-updated', message: 'Zone du mur mise à jour', read: false, createdAt: new Date().toISOString(), details: { wallId: wall.id, roomId: room.id } });
          eventSystem.dispatch('wall-data-changed', { type: 'wall-area-updated', wallId: wall.id, roomId: room.id });
          notifications?.showNotification('Zone du mur enregistrée.', 'success');
          openPanel('room', room.id);
        };
        image.addEventListener('pointermove', move); image.addEventListener('pointerup', end, { once: true });
      };
      image.addEventListener('pointerdown', start, { once: true });
    }

    // ============= Ajouter un équipement ============
    function openAddEquipmentModal(room = null, baie = null) {
      if (locked) {
        notifications?.showNotification("La carte est verrouillée : ajout d’équipement impossible.", "error");
        return;
      }

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: var(--z-carte-fenetre, 2147483000);
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
      `;
      // DEUX VOIES, et la première est celle qui manquait.
      //
      // La fenêtre ne proposait QUE de créer un équipement neuf. Un administrateur qui
      // voulait poser sur le plan un appareil déjà inventorié — le cas courant, puisque la
      // plateforme en compte des centaines — n'avait aucun moyen de le faire, et se
      // retrouvait à saisir un doublon. On propose donc d'abord de choisir dans l'existant,
      // et seulement ensuite de créer.
      const cible = room || baie;
      const dejaIci = new Set(equipments
        .filter(item => room ? String(item.roomId) === String(room.id) && !item.baieId
                             : String(item.baieId) === String(baie?.id))
        .map(item => String(item.id)));
      const disponibles = equipments
        .filter(item => !dejaIci.has(String(item.id)))
        .sort((a, b) => String(a.nom || a.name || '').localeCompare(String(b.nom || b.name || ''), 'fr'));

      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:560px;max-height:88vh;overflow:auto">
          <h3 style="margin-top:0;color:#2874a6">Ajouter un équipement ${cible ? `— ${esc(cible.name || cible.nom || '')}` : ''}</h3>

          <div role="tablist" style="display:flex;gap:8px;margin-bottom:16px">
            <button type="button" class="btn" id="mode-existant" aria-pressed="true" style="flex:1">Depuis la plateforme</button>
            <button type="button" class="btn gray" id="mode-nouveau" aria-pressed="false" style="flex:1">Nouvel équipement</button>
          </div>

          <section id="panneau-existant">
            <p style="margin:0 0 10px;font-size:13px;color:#5b7385">
              ${disponibles.length} équipement(s) de l’inventaire peuvent être placés ici.
            </p>
            <input type="search" id="eq-filtre" placeholder="Filtrer par nom, type, marque ou n° de série…"
                   style="width:100%;padding:9px;border:1px solid #d8e4ee;border-radius:8px;margin-bottom:10px">
            <select id="eq-existant" size="8" style="width:100%;padding:6px;border:1px solid #d8e4ee;border-radius:8px">
              ${disponibles.map(item => `<option value="${esc(item.id)}">${esc(item.nom || item.name || `#${item.id}`)}${item.numSerie ? ` — ${esc(item.numSerie)}` : ''}</option>`).join('')}
            </select>
          </section>

          <section id="panneau-nouveau" hidden>
            <p style="margin:0;font-size:13px;line-height:1.5;color:#5b7385">
              La création ouvre l’éditeur complet de la plateforme — celui de la page Équipements,
              avec catégorie, statut, ports, baie et fiche technique. L’équipement sera rattaché
              d’office à ${esc(cible ? (cible.name || cible.nom || '') : 'cet emplacement')}.
            </p>
          </section>

          <div style="display:flex;justify-content:flex-end;margin-top:20px;gap:10px">
            <button class="btn gray" id="cancel-add-eq">Annuler</button>
            <button class="btn" id="confirm-add-eq">Ajouter</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('cancel-add-eq').onclick = () => {
        modal.remove();
      };

      // Bascule entre les deux voies.
      let mode = 'existant';
      const boutonExistant = document.getElementById('mode-existant');
      const boutonNouveau = document.getElementById('mode-nouveau');
      const basculer = choix => {
        mode = choix;
        const versExistant = choix === 'existant';
        boutonExistant.className = versExistant ? 'btn' : 'btn gray';
        boutonNouveau.className = versExistant ? 'btn gray' : 'btn';
        boutonExistant.setAttribute('aria-pressed', String(versExistant));
        boutonNouveau.setAttribute('aria-pressed', String(!versExistant));
        document.getElementById('panneau-existant').hidden = !versExistant;
        document.getElementById('panneau-nouveau').hidden = versExistant;
      };
      boutonExistant.onclick = () => basculer('existant');
      boutonNouveau.onclick = () => basculer('nouveau');
      if (!disponibles.length) basculer('nouveau');

      // Filtre : sur des centaines d'équipements, une liste brute est inutilisable.
      const champFiltre = document.getElementById('eq-filtre');
      const liste = document.getElementById('eq-existant');
      champFiltre.oninput = () => {
        const terme = champFiltre.value.trim().toLowerCase();
        const retenus = disponibles.filter(item => !terme || [item.nom, item.name, item.type, item.marque, item.modele, item.numSerie]
          .some(valeur => String(valeur || '').toLowerCase().includes(terme)));
        liste.innerHTML = retenus
          .map(item => `<option value="${esc(item.id)}">${esc(item.nom || item.name || `#${item.id}`)}${item.numSerie ? ` — ${esc(item.numSerie)}` : ''}</option>`)
          .join('');
      };

      document.getElementById('confirm-add-eq').onclick = async () => {
        // VOIE 1 — rattacher un équipement déjà inventorié.
        if (mode === 'existant') {
          const choisi = liste.value;
          if (!choisi) {
            notifications?.showNotification("Choisissez un équipement dans la liste.", "error");
            return;
          }
          const existant = equipments.find(item => String(item.id) === String(choisi));
          if (!existant) {
            notifications?.showNotification("Équipement introuvable dans l’inventaire.", "error");
            return;
          }
          // On ne DUPLIQUE pas : on déplace l'équipement existant vers cet emplacement.
          // Créer une copie ferait diverger l'inventaire de la réalité, et c'est
          // précisément ce que l'ancienne fenêtre imposait.
          const rattache = { ...existant };
          if (room) { rattache.roomId = room.id; delete rattache.baieId; }
          else if (baie) { rattache.baieId = baie.id; rattache.roomId = baie.roomId; }
          try {
            await db.save('equipments', rattache);
            const rang = equipments.findIndex(item => String(item.id) === String(existant.id));
            if (rang >= 0) equipments[rang] = rattache; else equipments.push(rattache);
            notifications?.showNotification(`« ${rattache.nom || rattache.name} » placé ici.`, "success");
            modal.remove();
            drawAreasAndHotspots(currentView);
          } catch (error) {
            notifications?.showNotification("Impossible de rattacher cet équipement.", "error");
          }
          return;
        }

        // VOIE 2 — créer un équipement qui n'existe pas encore.
        //
        // On DÉLÈGUE à l'éditeur canonique au lieu des trois champs bruts d'ici. Cette
        // fenêtre ne demandait que nom, type et numéro de série : un équipement créé depuis
        // la carte naissait donc sans catégorie, sans statut normalisé, sans ports, sans
        // rattachement de baie — un enregistrement de seconde classe, à recompléter ailleurs.
        // L'éditeur canonique est le même que celui de la page Équipements ; il n'y a aucune
        // raison d'en entretenir un second, plus pauvre.
        modal.remove();
        const contexte = room ? { roomId: room.id, baieId: null }
                              : baie ? { roomId: baie.roomId ?? null, baieId: baie.id }
                                     : { roomId: null, baieId: null };
        closeInteractiveMap({ notify: false });
        // `openCanonicalEquipmentEditor` n'accepte pas de pré-remplissage : lui en passer un
        // serait ignoré en silence et donnerait l'illusion que la saisie a été reprise.
        await openCanonicalEquipmentEditor({ ...contexte, notifications });
        return;
      };

    }

    // ============= Modifier l’équipement ============
    function openEditEquipmentModal(eq) {
      if (locked) {
        notifications?.showNotification("La carte est verrouillée : modification impossible.", "error");
        return;
      }

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: var(--z-carte-fenetre, 2147483000);
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
      `;
      modal.innerHTML = `
        <div style="background: #fff; border-radius: 12px; padding: 25px; width: 90%; max-width: 500px;">
          <h3 style="margin-top: 0; color: #2874a6;">Modifier l’équipement</h3>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Nom de l’équipement</label>
            <input type="text" id="eq-name" value="${esc(eq.nom || eq.name || '')}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Type</label>
            <input type="text" id="eq-type" value="${esc(eq.type || '')}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Numéro de série</label>
            <input type="text" id="eq-serial" value="${esc(eq.numSerie || '')}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">État</label>
            <select id="eq-status" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="working" ${eq.status === 'working' ? 'selected' : ''}>Opérationnel</option>
              <option value="faulty" ${eq.status === 'faulty' ? 'selected' : ''}>En panne</option>
            </select>
          </div>
          <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
            <button class="btn gray" id="cancel-edit-eq" style="margin-right: 10px;">Annuler</button>
            <button class="btn" id="confirm-edit-eq">Enregistrer</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('cancel-edit-eq').onclick = () => {
        modal.remove();
      };

      document.getElementById('confirm-edit-eq').onclick = async () => {
        const name = document.getElementById('eq-name').value;
        const type = document.getElementById('eq-type').value;
        const serial = document.getElementById('eq-serial').value;
        const status = document.getElementById('eq-status').value;

        if (!name) {
          notifications?.showNotification("Le nom de l’équipement est obligatoire.", "error");
          return;
        }

        const updatedEq = {
          ...eq,
          nom: name,
          name: name,
          type: type,
          numSerie: serial,
          status: status
        };

        try {
          const index = equipments.findIndex(e => e.id === eq.id);
          if (index !== -1) {
            equipments[index] = updatedEq;
          }
          await db.save('equipments', updatedEq);
          notifications?.showNotification("Équipement mis à jour.", "success");
          modal.remove();
          drawAreasAndHotspots(currentView);
          if (panel.style.display === 'flex') {
            openPanel('equipment', eq.id);
          }
        } catch (error) {
          notifications?.showNotification("Impossible de mettre à jour l’équipement.", "error");
        }
      };
    }

    // --- تاريخ تنقل للRetour الصحيح ---
    function goBack() {
      // « Retour » quitte forcément la vue éditée : jamais de coordonnée mutée qui survit
      // sans bouton pour la voir ni la reprendre.
      cancelCoordinateSession();
      fermerFormesImbriquees();
      let prev = history.pop();
      if (!prev) {
        panel.style.display = "none";
        currentView = { type: "map" };
        drawAreasAndHotspots();
        return;
      }
      /*
       * TROUVAILLE DE REVUE INDÉPENDANTE — Retour doit rouvrir la SCÈNE parente, pas
       * seulement son scope de fond. `openPanel` construit déjà ce panneau au complet
       * (photo réelle, canevas de formes, boutons) à partir de la donnée vivante — on le
       * rappelle ici pour room/baie/equipment, avec `historique:false` pour ne PAS
       * repousser la vue qu'on quitte (elle vient d'être dépilée, pas ouverte). Les autres
       * types de vue (ex. « map ») gardent l'ancien comportement léger.
       */
      if (prev.type === 'room' || prev.type === 'baie' || prev.type === 'equipment') {
        openPanel(prev.type, prev.id, { historique: false });
        return;
      }
      currentView = prev;
      panel.style.display = "none";
      drawAreasAndHotspots(currentView);
    }

    // بدأ العرض الأولي
    drawAreasAndHotspots();

    // العودة من أي panel
    // SEUL point d'écoute du clic « Retour » (#panel-back-btn) : ne JAMAIS lui ajouter un
    // second `onclick` direct dans une vue (room/baie/equipment) — un clic déclencherait
    // goBack() deux fois et sauterait un niveau de navigation (Baie → Retour atterrissait
    // directement sur la carte, sautant Room). Voir « Retour exact » dans
    // map-panel-mutation-browser-gate.mjs.
    panel.onclick = function (e) {
      if (e.target.id === 'map-panel' || e.target.id === 'panel-back-btn') {
        goBack();
      }
    };

    // إغلاق نتائج البحث عند النقر خارجها
    const hideSearchResults = (e) => {
      if (!e.target.closest('#map-search-results') && !e.target.closest('#map-search')) {
        const results = document.getElementById('map-search-results');
        if (results) results.style.display = 'none';
      }
    };
    document.addEventListener('click', hideSearchResults);
    mapCleanup = () => document.removeEventListener('click', hideSearchResults);
  }

  return Object.freeze({ close: closeMap });
}
