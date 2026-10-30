/**
 * @file map-permissions-contract.js — QUI A LE DROIT DE FAIRE QUOI SUR LA CARTE.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME.
 *
 * Toute l'administration de la carte reposait sur UN booléen :
 *
 *     const canManageMap = PermissionManager.check(user, 'rooms', 'edit');
 *
 * Il commandait à la fois le dessin des formes, les menus contextuels, l'ajout, le
 * changement d'image, le glisser-déposer des ÉQUIPEMENTS et la suppression — trois types
 * d'objets et six actes, décidés par la permission d'UN SEUL type. Deux effets opposés,
 * tous deux contraires à la matrice canonique :
 *
 *   · le Chef recevait l'édition des équipements par la porte des salles, et surtout la
 *     SUPPRESSION des trois types, alors que la matrice lui déclare `delete:false` ;
 *   · le Responsable, qui détient `equipments.edit`, ne pouvait ni placer ni déplacer un
 *     équipement, parce que son `rooms.edit` est faux.
 *
 * Et `deleteItem()` ne vérifiait RIEN : ni type, ni action. Cacher un bouton n'est pas une
 * autorisation — le serveur le refuse désormais aussi, mais l'écran ne doit pas proposer
 * un acte qu'il sait voué au refus.
 *
 * Ce module ne décide rien lui-même : il DEMANDE à `PermissionManager`, type par type et
 * acte par acte. Pur — sans DOM, sans IndexedDB, sans réseau — donc exécutable dans un
 * test, ce qu'un booléen enterré dans 1700 lignes de câblage ne pouvait pas être.
 */
import { PermissionManager } from './permissions.js';

export const MAP_PERMISSIONS_VERSION = 1;

/** Le type manipulé par la carte → l'entité de la matrice canonique. */
export const MAP_TYPE_TO_ENTITY = Object.freeze({
  room: 'rooms', baie: 'baies', equipment: 'equipments', wall: 'walls'
});

const ACTES = Object.freeze(['create', 'edit', 'delete']);

/**
 * Ce que CET utilisateur peut faire, type par type.
 *
 * Rendu figé : un appelant qui voudrait « juste forcer une case » doit passer par la
 * matrice, pas par l'objet rendu.
 */
export function mapAbilities(user) {
  const droits = {};
  for (const [type, entite] of Object.entries(MAP_TYPE_TO_ENTITY)) {
    const parActe = {};
    for (const acte of ACTES) parActe[acte] = PermissionManager.check(user, entite, acte);
    droits[type] = Object.freeze(parActe);
  }
  /*
   * Le MODE ÉDITION s'ouvre dès qu'un seul acte d'administration est permis — mais chaque
   * outil reste gardé par SON acte. Sans cela, le Responsable n'aurait aucun moyen
   * d'atteindre le placement d'équipement que la matrice lui accorde.
   */
  droits.anyEdition = ACTES.some(acte => Object.values(MAP_TYPE_TO_ENTITY)
    .some(entite => PermissionManager.check(user, entite, acte)));
  return Object.freeze(droits);
}

/**
 * L'utilisateur peut-il faire CET acte sur CE type ?
 *
 * Un type inconnu rend `false` : une carte ne doit pas autoriser un acte sur un objet
 * dont elle ne sait pas quelle entité de la matrice le gouverne.
 */
export function mapCan(user, type, acte) {
  const entite = MAP_TYPE_TO_ENTITY[type];
  if (!entite || !ACTES.includes(acte)) return false;
  return PermissionManager.check(user, entite, acte);
}

export default Object.freeze({
  version: MAP_PERMISSIONS_VERSION, MAP_TYPE_TO_ENTITY, mapAbilities, mapCan
});
