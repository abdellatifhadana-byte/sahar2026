/**
 * @file equipment-status-contract.js — vocabulaire unique de l'état d'un équipement.
 *
 * Trois vocabulaires concurrents coexistaient pour le même concept :
 *   - le semeur écrit  `status:'Opérationnel — état actuel à confirmer'` et `statut:'À vérifier'`
 *   - le tableau de bord comptait `status ∈ {actif, active}` / `maintenance` / {hors-service, faulty, hs}
 *   - la page Équipements filtrait `statut ∈ {Opérationnel, Maintenance, Hors service}`
 *
 * Aucun des trois ne rencontrait les autres : le tableau de bord affichait 0 actif, 0 en
 * maintenance et 0 en panne sur un parc de 51 équipements, et le filtre de la page
 * Équipements ne renvoyait jamais aucune ligne.
 *
 * Ce module est une feuille sans import : il peut être chargé par le navigateur comme par
 * Node. Il ne réécrit aucune donnée — il lit les deux champs historiques et les replie sur
 * un état canonique, pour que toutes les surfaces comptent la même chose.
 */

export const EQUIPMENT_STATUS_CONTRACT_VERSION = 1;

/** États canoniques. `unknown` n'est jamais une valeur saisie : c'est l'absence d'information. */
export const EQUIPMENT_STATUSES = Object.freeze({
  OPERATIONAL: 'operational',
  MAINTENANCE: 'maintenance',
  DOWN: 'down',
  TO_VERIFY: 'to-verify',
  RESERVE: 'reserve',
  UNKNOWN: 'unknown'
});

export const EQUIPMENT_STATUS_ORDER = Object.freeze([
  EQUIPMENT_STATUSES.OPERATIONAL,
  EQUIPMENT_STATUSES.MAINTENANCE,
  EQUIPMENT_STATUSES.DOWN,
  EQUIPMENT_STATUSES.TO_VERIFY,
  EQUIPMENT_STATUSES.RESERVE,
  EQUIPMENT_STATUSES.UNKNOWN
]);

export const EQUIPMENT_STATUS_LABELS = Object.freeze({
  [EQUIPMENT_STATUSES.OPERATIONAL]: 'Opérationnel',
  [EQUIPMENT_STATUSES.MAINTENANCE]: 'Maintenance',
  [EQUIPMENT_STATUSES.DOWN]: 'Hors service',
  [EQUIPMENT_STATUSES.TO_VERIFY]: 'À vérifier',
  [EQUIPMENT_STATUSES.RESERVE]: 'Réserve',
  [EQUIPMENT_STATUSES.UNKNOWN]: 'Non renseigné'
});

const fold = value => String(value ?? '')
  .trim()
  .toLocaleLowerCase('fr-FR')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

// Ordre significatif : le premier motif rencontré gagne. « hors service » est testé avant
// « service », et « a verifier » avant « operationnel », pour que
// « Opérationnel — état actuel à confirmer » reste opérationnel tout en restant marqué
// comme non confirmé par `isConfirmed()`.
const PATTERNS = Object.freeze([
  [EQUIPMENT_STATUSES.DOWN, ['hors service', 'hors-service', 'horsservice', 'panne', 'faulty', 'critical', 'defaillant', 'defectueux', 'ko', 'down', 'error', 'hs']],
  [EQUIPMENT_STATUSES.MAINTENANCE, ['maintenance', 'entretien', 'reparation', 'revision']],
  [EQUIPMENT_STATUSES.RESERVE, ['reserve', 'spare', 'stock', 'retire', 'retired', 'deconnecte', 'disconnected']],
  [EQUIPMENT_STATUSES.TO_VERIFY, ['a verifier', 'a confirmer', 'to-confirm', 'to confirm', 'to verify', 'inconnu', 'unknown']],
  [EQUIPMENT_STATUSES.OPERATIONAL, ['operationnel', 'operational', 'actif', 'active', 'ok', 'en service', 'fonctionnel', 'working', 'up', 'online', 'connecte']]
]);

/** Replie une valeur brute — quel que soit son vocabulaire d'origine — sur un état canonique. */
export function normalizeStatusValue(value) {
  const text = fold(value);
  if (!text) return EQUIPMENT_STATUSES.UNKNOWN;
  for (const [status, tokens] of PATTERNS) {
    if (tokens.some(token => text.includes(token))) return status;
  }
  return EQUIPMENT_STATUSES.UNKNOWN;
}

/**
 * État canonique d'un équipement, en lisant les deux champs historiques.
 *
 * `statut` est prioritaire parce que c'est le champ que l'éditeur de la plateforme écrit :
 * une modification faite par un utilisateur doit toujours l'emporter sur la valeur d'origine
 * du semeur restée dans `status`.
 */
export function equipmentStatus(equipment) {
  if (!equipment || typeof equipment !== 'object') return EQUIPMENT_STATUSES.UNKNOWN;
  if (equipment.panne === true) return EQUIPMENT_STATUSES.DOWN;

  const fromStatut = normalizeStatusValue(equipment.statut);
  if (fromStatut !== EQUIPMENT_STATUSES.UNKNOWN) return fromStatut;

  const fromStatus = normalizeStatusValue(equipment.status ?? equipment.state);
  if (fromStatus !== EQUIPMENT_STATUSES.UNKNOWN) return fromStatus;

  return EQUIPMENT_STATUSES.UNKNOWN;
}

export function equipmentStatusLabel(equipment) {
  return EQUIPMENT_STATUS_LABELS[equipmentStatus(equipment)];
}

/** Vrai quand l'état est déclaré sans réserve. « Opérationnel — à confirmer » renvoie false. */
export function isStatusConfirmed(equipment) {
  const raw = fold(`${equipment?.statut ?? ''} ${equipment?.status ?? ''}`);
  if (!raw.trim()) return false;
  return !['a confirmer', 'a verifier', 'to-confirm', 'to confirm', 'probable', 'suppose'].some(token => raw.includes(token));
}

export const isOperational = equipment => equipmentStatus(equipment) === EQUIPMENT_STATUSES.OPERATIONAL;
export const isUnderMaintenance = equipment => equipmentStatus(equipment) === EQUIPMENT_STATUSES.MAINTENANCE;
export const isDown = equipment => equipmentStatus(equipment) === EQUIPMENT_STATUSES.DOWN;

/** Un équipement « en anomalie » demande une action : hors service, ou en maintenance. */
export const isFaulty = equipment =>
  [EQUIPMENT_STATUSES.DOWN, EQUIPMENT_STATUSES.MAINTENANCE].includes(equipmentStatus(equipment));

/** Répartition complète du parc. Toute clé canonique est présente, même à zéro. */
export function summarizeEquipmentStatuses(equipments = []) {
  const counts = Object.fromEntries(EQUIPMENT_STATUS_ORDER.map(status => [status, 0]));
  for (const equipment of Array.isArray(equipments) ? equipments : []) counts[equipmentStatus(equipment)] += 1;
  return Object.freeze({
    total: Array.isArray(equipments) ? equipments.length : 0,
    counts: Object.freeze(counts),
    unconfirmed: (Array.isArray(equipments) ? equipments : []).filter(item => !isStatusConfirmed(item)).length
  });
}

/** Options du sélecteur de filtre, dans l'ordre canonique. */
export function statusFilterOptions() {
  return EQUIPMENT_STATUS_ORDER.map(status => ({ value: status, label: EQUIPMENT_STATUS_LABELS[status] }));
}

/** Options de saisie : `unknown` n'est jamais proposé, on ne choisit pas « non renseigné ». */
export function statusInputOptions() {
  return EQUIPMENT_STATUS_ORDER
    .filter(status => status !== EQUIPMENT_STATUSES.UNKNOWN)
    .map(status => ({ value: EQUIPMENT_STATUS_LABELS[status], label: EQUIPMENT_STATUS_LABELS[status] }));
}

export default Object.freeze({
  version: EQUIPMENT_STATUS_CONTRACT_VERSION,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  normalizeStatusValue,
  equipmentStatus,
  equipmentStatusLabel,
  isStatusConfirmed,
  isOperational,
  isUnderMaintenance,
  isDown,
  isFaulty,
  summarizeEquipmentStatuses,
  statusFilterOptions,
  statusInputOptions
});
