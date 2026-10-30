import { normalizePhysicalPortRef } from './relationship-contract.js';
// LE VOCABULAIRE DE VÉRIFICATION VIENT DE `connectivity-contract.js`, ET DE LUI SEUL.
//
// Les deux contrats en portaient chacun une liste. Elles n'étaient PAS les mêmes :
// « observed » figurait chez connectivity et manquait ici. Or `normalizeVerification`
// remplace toute valeur absente de la liste par « to-confirm ».
//
// Conséquence mesurée en base : 8 enregistrements portent « observed ». Lus par la voie
// topologie, ils devenaient « to-confirm » — l'observation terrain enregistrée disparaissait
// et l'équipement semblait redemander une vérification que quelqu'un avait déjà faite.
//
// `connectivity-contract.js` n'importe rien : c'est une feuille, donc le bon endroit pour un
// vocabulaire partagé, et aucun cycle n'est créé.
import { PATH_ROLES, VERIFICATION_STATUSES } from './connectivity-contract.js';

export { PATH_ROLES, VERIFICATION_STATUSES };

export const TOPOLOGY_KINDS = Object.freeze({
  ROUTER: 'topology_router',
  ROUTER_PORT: 'topology_router_port',
  ROUTER_INTERFACE: 'topology_router_interface',
  CROSSPOINT: 'topology_crosspoint',
  RV_LINK: 'topology_rv_link',
  SIGNAL_PATH: 'topology_signal_path',
  PATCH_POINT: 'topology_patch_point',
  SYNOPTIC: 'topology_synoptic',
  EVIDENCE: 'topology_evidence'
});

export const TOPOLOGY_KIND_SET = new Set(Object.values(TOPOLOGY_KINDS));
export const SIGNAL_TYPES = Object.freeze(['SDI', 'AUDIO', 'REF_BB', 'ETHERNET', 'SERIAL', 'KVM', 'INTERCOM', 'IP', 'AUTRE']);
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const ROUTER_INTERFACE_TYPES = Object.freeze(['SYNC_REFERENCE', 'CONTROL', 'MONITORING_OUTPUT', 'CONTROL_STATION', 'OTHER']);

const slugify = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

export const normalizeDirection = value => {
  const normalized = String(value || '').trim().toUpperCase();
  if (['IN', 'INPUT', 'ENTREE', 'ENTRÉE'].includes(normalized)) return 'INPUT';
  if (['OUT', 'OUTPUT', 'SORTIE'].includes(normalized)) return 'OUTPUT';
  return normalized;
};

export const normalizeConfidence = value => {
  const normalized = String(value || '').trim().toLowerCase();
  return CONFIDENCE_LEVELS.includes(normalized) ? normalized : 'medium';
};

export const normalizeVerification = value => {
  const normalized = String(value || '').trim().toLowerCase();
  return VERIFICATION_STATUSES.includes(normalized) ? normalized : 'to-confirm';
};

export const normalizeStringArray = value => {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
};

export const deriveRouterId = input => {
  if (input?.routerId) return String(input.routerId);
  if (input?.routerEquipmentId) return `router-equipment-${slugify(input.routerEquipmentId)}`;
  const label = input?.routerEquipmentKey || input?.routerLabel;
  if (!label) return '';
  if (/grille\s*72/i.test(label)) return 'router-grille72';
  if (/grille\s+centrale/i.test(label) && /190|184/i.test(label)) return 'router-gc190x184';
  return `router-${slugify(label)}`;
};

export function validateTopologyRecord(record) {
  const errors = [];
  if (!record || !TOPOLOGY_KIND_SET.has(record.kind)) return ['Type de topologie invalide.'];

  if (record.kind === TOPOLOGY_KINDS.ROUTER) {
    if (!String(record.name || record.routerLabel || '').trim()) errors.push('La grille doit avoir un nom.');
    for (const [field, label] of [['inputCapacity', 'entrées'], ['outputCapacity', 'sorties']]) {
      if (record[field] != null && record[field] !== '' && (!Number.isInteger(Number(record[field])) || Number(record[field]) < 1)) {
        errors.push(`La capacité ${label} doit être un entier positif.`);
      }
    }
  }

  if (record.kind === TOPOLOGY_KINDS.ROUTER_PORT) {
    if (!record.routerId) errors.push('La grille parente du port est obligatoire.');
    if (!['INPUT', 'OUTPUT'].includes(record.direction)) errors.push('La direction du port grille doit être INPUT ou OUTPUT.');
    if (!record.portNumber && !record.logicalAlias) errors.push('Indiquez au moins le numéro physique ou l’alias logique du port grille.');
    if (record.portNumber && (!Number.isInteger(Number(record.portNumber)) || Number(record.portNumber) < 1)) errors.push('Le numéro de port doit être un entier positif.');
    if (record.physicalPortRef && !normalizePhysicalPortRef(record.physicalPortRef)) {
      errors.push('Le mapping vers le port physique est invalide : ownerType, ownerId et portId sont requis; un composant exige parentEquipmentId.');
    }
  }

  if (record.kind === TOPOLOGY_KINDS.ROUTER_INTERFACE) {
    if (!record.routerId) errors.push('La grille parente de l’interface est obligatoire.');
    if (!ROUTER_INTERFACE_TYPES.includes(record.interfaceType)) errors.push('Le type d’interface de grille est invalide.');
    if (!String(record.name || '').trim()) errors.push('Le nom de l’interface est obligatoire.');
  }

  if (record.kind === TOPOLOGY_KINDS.CROSSPOINT) {
    if (!record.routerId) errors.push('La grille du crosspoint est obligatoire.');
    if (!record.inputPortId) errors.push('Le port d’entrée de la grille est obligatoire.');
    if (!record.outputPortId) errors.push('Le port de sortie de la grille est obligatoire.');
    if (record.inputPortId && record.outputPortId && String(record.inputPortId) === String(record.outputPortId)) errors.push('Une entrée et une sortie de grille doivent être distinctes.');
  }

  if (record.kind === TOPOLOGY_KINDS.RV_LINK) {
    if (!String(record.sourceLabel || '').trim()) errors.push('La source de la liaison RV est obligatoire.');
    if (!String(record.destinationLabel || '').trim()) errors.push('La destination de la liaison RV est obligatoire.');
    if (!normalizeStringArray(record.cableRefs).length) errors.push('Au moins une référence câble est obligatoire pour la liaison RV.');
  }

  if (record.kind === TOPOLOGY_KINDS.SIGNAL_PATH) {
    if (!String(record.sourceLabel || '').trim()) errors.push('La source du flux est obligatoire.');
    if (!String(record.destinationLabel || '').trim()) errors.push('La destination du flux est obligatoire.');
  }

  if (record.kind === TOPOLOGY_KINDS.PATCH_POINT && !String(record.name || record.panel || '').trim()) errors.push('Le point de brassage doit avoir un nom ou un panneau.');
  if (record.kind === TOPOLOGY_KINDS.SYNOPTIC && !String(record.title || record.reference || '').trim()) errors.push('Le synoptique doit avoir un titre ou une référence.');
  if (record.kind === TOPOLOGY_KINDS.EVIDENCE && !String(record.sourceRef || record.sourceType || '').trim()) errors.push('La preuve doit indiquer une source ou une référence.');
  return errors;
}

export async function validateTopologyReferences(record, lookup) {
  const errors = [];
  if (!record || typeof lookup !== 'function') return errors;

  if ([TOPOLOGY_KINDS.ROUTER_PORT, TOPOLOGY_KINDS.ROUTER_INTERFACE].includes(record.kind)) {
    const router = await lookup(record.routerId);
    if (!router || router.kind !== TOPOLOGY_KINDS.ROUTER) errors.push('La grille parente est introuvable.');
    if (router && record.kind === TOPOLOGY_KINDS.ROUTER_PORT && record.portNumber) {
      const capacity = record.direction === 'INPUT' ? router.inputCapacity : router.outputCapacity;
      if (capacity && Number(record.portNumber) > Number(capacity)) errors.push(`Le port ${record.portNumber} dépasse la capacité ${capacity} de la grille.`);
    }
  }

  if (record.kind === TOPOLOGY_KINDS.CROSSPOINT) {
    const [input, output, router] = await Promise.all([
      lookup(record.inputPortId), lookup(record.outputPortId), lookup(record.routerId)
    ]);
    if (!router || router.kind !== TOPOLOGY_KINDS.ROUTER) errors.push('La grille du crosspoint est introuvable.');
    if (!input || input.kind !== TOPOLOGY_KINDS.ROUTER_PORT || input.direction !== 'INPUT') errors.push('Le port source du crosspoint doit être une entrée de grille existante.');
    if (!output || output.kind !== TOPOLOGY_KINDS.ROUTER_PORT || output.direction !== 'OUTPUT') errors.push('Le port destination du crosspoint doit être une sortie de grille existante.');
    if (input && String(input.routerId) !== String(record.routerId)) errors.push('Le port d’entrée appartient à une autre grille.');
    if (output && String(output.routerId) !== String(record.routerId)) errors.push('Le port de sortie appartient à une autre grille.');
  }
  return errors;
}

export const isTopologyRecord = record => Boolean(record && TOPOLOGY_KIND_SET.has(record.kind));