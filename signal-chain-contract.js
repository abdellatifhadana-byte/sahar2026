/**
 * @file signal-chain-contract.js — la chaîne du signal, d'un bout à l'autre.
 *
 * POURQUOI CE MODULE
 * ------------------
 * Cette plateforme n'existe que pour une chose : qu'un signal aille de l'acquisition à
 * l'antenne sans rupture. Chaque baie, chaque câble, chaque écran ne sert que cette
 * chaîne. L'interface n'en disait pourtant rien — elle présentait des listes d'objets,
 * comme n'importe quel gestionnaire de parc.
 *
 * Ce module décrit la chaîne, et rien d'autre. Il ne lit pas la base, ne touche pas au
 * DOM, n'affiche rien : il replie des salles et des équipements sur quatre segments et dit
 * l'état de chacun. Il est donc chargeable par le navigateur comme par Node, et testable
 * sans monter une page.
 *
 * CE QU'IL NE FAIT PAS, DÉLIBÉRÉMENT
 * ----------------------------------
 * Il ne DEVINE pas le segment d'une salle à partir de son nom. Il serait tentant de faire
 * correspondre « STC » à la diffusion, « ACQ » à l'acquisition, « RF1 » à la régie : c'est
 * rapide, cela paraît juste, et cela se trompe en silence le jour où une salle est
 * renommée ou ajoutée — sur l'écran le plus visible de la plateforme. Le rattachement est
 * donc une donnée assumée, portée par la salle.
 *
 * Une salle sans rattachement n'est pas une erreur à masquer : c'est une information. Elle
 * apparaît explicitement comme non rattachée, ce qui donne au responsable la liste exacte
 * de ce qui reste à qualifier.
 */

import {
  EQUIPMENT_STATUSES, equipmentStatus, isStatusConfirmed, isDown, isUnderMaintenance
} from './equipment-status-contract.js';

export const SIGNAL_CHAIN_CONTRACT_VERSION = 1;

/** Les quatre segments, dans l'ordre où le signal les traverse. */
export const CHAIN_SEGMENTS = Object.freeze({
  ACQUISITION: 'acquisition',
  REGIE: 'regie',
  CONTINUITE: 'continuite',
  DIFFUSION: 'diffusion'
});

export const CHAIN_ORDER = Object.freeze([
  CHAIN_SEGMENTS.ACQUISITION,
  CHAIN_SEGMENTS.REGIE,
  CHAIN_SEGMENTS.CONTINUITE,
  CHAIN_SEGMENTS.DIFFUSION
]);

/** Segment fictif : ce qui existe mais n'a pas encore de place dans la chaîne. */
export const CHAIN_UNASSIGNED = 'unassigned';

export const CHAIN_LABELS = Object.freeze({
  [CHAIN_SEGMENTS.ACQUISITION]: 'Acquisition',
  [CHAIN_SEGMENTS.REGIE]: 'Régie',
  [CHAIN_SEGMENTS.CONTINUITE]: 'Continuité',
  [CHAIN_SEGMENTS.DIFFUSION]: 'Diffusion',
  [CHAIN_UNASSIGNED]: 'Non rattaché'
});

export const CHAIN_DESCRIPTIONS = Object.freeze({
  [CHAIN_SEGMENTS.ACQUISITION]: 'Prise du signal : caméras, cars, liaisons entrantes.',
  [CHAIN_SEGMENTS.REGIE]: 'Fabrication : mélange, habillage, son, régies finales.',
  [CHAIN_SEGMENTS.CONTINUITE]: 'Continuité antenne : principal, secours, bascule.',
  [CHAIN_SEGMENTS.DIFFUSION]: 'Sortie vers l’antenne : encodage, transport, émission.',
  [CHAIN_UNASSIGNED]: 'Salles qui n’ont pas encore de place déclarée dans la chaîne.'
});

/**
 * ÉTATS D'UN SEGMENT — vocabulaire de diffusion, pas « succès / erreur ».
 *
 * `unverified` est distinct de `degraded` à dessein. Un parc entier « à vérifier » ne
 * signifie pas qu'il est dégradé : il signifie que personne n'est encore allé voir. Les
 * confondre ferait passer un inventaire neuf pour une panne généralisée, et l'alarme
 * perdrait tout sens.
 */
export const SEGMENT_STATES = Object.freeze({
  LOCKED: 'locked',        // verrouillé — tout est confirmé opérationnel
  DEGRADED: 'degraded',    // dégradé — au moins un équipement en maintenance
  LOST: 'lost',            // perdu — au moins un équipement hors service
  UNVERIFIED: 'unverified',// non vérifié — rien de cassé, mais rien de confirmé non plus
  EMPTY: 'empty'           // vide — aucune salle rattachée, ou aucun équipement
});

export const SEGMENT_STATE_LABELS = Object.freeze({
  [SEGMENT_STATES.LOCKED]: 'Verrouillé',
  [SEGMENT_STATES.DEGRADED]: 'Dégradé',
  [SEGMENT_STATES.LOST]: 'Hors service',
  [SEGMENT_STATES.UNVERIFIED]: 'À vérifier',
  [SEGMENT_STATES.EMPTY]: 'Aucun équipement'
});

const texte = value => String(value ?? '').trim().toLowerCase();

/**
 * Le segment déclaré d'une salle. Toute valeur inconnue est traitée comme une absence :
 * mieux vaut afficher « non rattaché » qu'inventer un segment à partir d'une faute de
 * frappe.
 */
export function roomChainSegment(room) {
  const declare = texte(room?.chainSegment);
  return CHAIN_ORDER.includes(declare) ? declare : CHAIN_UNASSIGNED;
}

/** Le segment d'un équipement découle de sa salle : c'est la salle qui tient la position. */
export function equipmentChainSegment(equipment, roomsById) {
  const roomId = equipment?.roomId;
  if (roomId === null || roomId === undefined || roomId === '') return CHAIN_UNASSIGNED;
  return roomChainSegment(roomsById?.get?.(String(roomId)) ?? null);
}

/**
 * L'état d'un segment, déduit des équipements qu'il contient.
 *
 * L'ordre de priorité n'est pas arbitraire : un équipement hors service prime sur tout le
 * reste, parce que c'est lui qui coupe le signal. Vient ensuite la maintenance, qui
 * l'affaiblit. L'absence de vérification vient en dernier — elle ne casse rien, elle
 * signale seulement qu'on ne sait pas.
 */
export function segmentState(equipments = []) {
  if (!equipments.length) return SEGMENT_STATES.EMPTY;
  let maintenance = false;
  let nonConfirme = false;
  for (const equipment of equipments) {
    const etat = equipmentStatus(equipment);
    if (etat === EQUIPMENT_STATUSES.DOWN) return SEGMENT_STATES.LOST;
    if (etat === EQUIPMENT_STATUSES.MAINTENANCE) maintenance = true;
    else if (!isStatusConfirmed(equipment)) nonConfirme = true;
  }
  if (maintenance) return SEGMENT_STATES.DEGRADED;
  if (nonConfirme) return SEGMENT_STATES.UNVERIFIED;
  return SEGMENT_STATES.LOCKED;
}

/**
 * Résumé complet de la chaîne : un segment par étape, plus le hors-chaîne.
 *
 * Le segment « non rattaché » n'est renvoyé que s'il contient quelque chose. Afficher un
 * cinquième bloc vide sur une plateforme entièrement qualifiée serait du bruit.
 */
export function summarizeSignalChain({ rooms = [], equipments = [] } = {}) {
  const roomsById = new Map();
  for (const room of rooms) {
    if (room?.id === null || room?.id === undefined) continue;
    roomsById.set(String(room.id), room);
  }

  const parSegment = new Map();
  for (const segment of [...CHAIN_ORDER, CHAIN_UNASSIGNED]) {
    parSegment.set(segment, { rooms: [], equipments: [] });
  }
  for (const room of rooms) parSegment.get(roomChainSegment(room)).rooms.push(room);
  for (const equipment of equipments) {
    parSegment.get(equipmentChainSegment(equipment, roomsById)).equipments.push(equipment);
  }

  /*
   * TROIS GRANDEURS DISTINCTES, ET NON UNE SEULE.
   *
   * `equipmentCount` — combien d'équipements le segment porte ;
   * `downCount`      — combien sont RÉELLEMENT hors service ;
   * `state`          — l'état du segment, qui bascule à `lost` dès UN seul hors service.
   *
   * Les confondre est ce que l'écran faisait : il affichait le total à côté du libellé
   * d'état, ce qui se lisait « 18 hors service » pour dix-huit équipements dont UN seul
   * était en panne. Le compte des pannes n'existait tout simplement pas — il est calculé
   * ici, avec `isDown`/`isUnderMaintenance` du contrat d'état, et non par une seconde
   * définition de la panne.
   */
  const construire = segment => {
    const groupe = parSegment.get(segment);
    const etat = segmentState(groupe.equipments);
    return Object.freeze({
      segment,
      label: CHAIN_LABELS[segment],
      description: CHAIN_DESCRIPTIONS[segment],
      state: etat,
      stateLabel: SEGMENT_STATE_LABELS[etat],
      roomCount: groupe.rooms.length,
      equipmentCount: groupe.equipments.length,
      downCount: groupe.equipments.filter(isDown).length,
      maintenanceCount: groupe.equipments.filter(isUnderMaintenance).length,
      roomIds: Object.freeze(groupe.rooms.map(room => String(room.id)))
    });
  };

  const segments = CHAIN_ORDER.map(construire);
  const horsChaine = construire(CHAIN_UNASSIGNED);

  return Object.freeze({
    segments: Object.freeze(segments),
    // Renvoyé seulement s'il y a effectivement quelque chose à qualifier.
    unassigned: horsChaine.roomCount || horsChaine.equipmentCount ? horsChaine : null,
    // La chaîne est intacte quand aucun segment ne perd le signal. Un segment vide ne la
    // rompt pas : il n'est pas encore renseigné, ce qui est différent d'être coupé.
    intact: segments.every(item => item.state !== SEGMENT_STATES.LOST),
    // Ce qui reste à qualifier, dit une fois, pour que la plateforme puisse le demander.
    pendingRooms: horsChaine.roomCount
  });
}

/** Les choix proposés à la saisie, dans l'ordre de la chaîne. */
export function chainSegmentOptions() {
  return CHAIN_ORDER.map(segment => ({ value: segment, label: CHAIN_LABELS[segment] }));
}

export default Object.freeze({
  version: SIGNAL_CHAIN_CONTRACT_VERSION,
  CHAIN_SEGMENTS, CHAIN_ORDER, CHAIN_LABELS, CHAIN_UNASSIGNED, SEGMENT_STATES,
  roomChainSegment, equipmentChainSegment, segmentState, summarizeSignalChain, chainSegmentOptions
});
