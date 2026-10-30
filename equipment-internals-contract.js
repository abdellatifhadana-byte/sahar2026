/**
 * @file equipment-internals-contract.js — la composition interne d'un équipement (cartes,
 *       CPU, RAM, disques, logiciels…) SANS DOM : ce que `equipment-internals.js` normalise
 *       et enregistre, séparé de l'éditeur qui le dessine.
 *
 * POURQUOI CETTE SÉPARATION, MAINTENANT.
 * --------------------------------------------------------------------------------------
 * `equipment-internals.js` mélangeait cette normalisation avec l'installation de
 * l'éditeur DOM (`installInternalsEditor`, `injectStyles`…) et importait `Equipements`, la
 * page admin elle-même — l'import de ce SEUL fichier suffisait à exiger un `window` complet
 * (jusqu'à `window.addEventListener`), rendant `normalizeComponents` invérifiable par un
 * test unitaire pur. Cette scission suit exactement le partage déjà en place ailleurs dans
 * la carte : `map-shape-contract.js` (pur) et `map-shape-editor.js` (DOM),
 * `nested-shape-contract.js` (pur) et `interactive-map.js` (DOM). Aucun comportement ne
 * change : `equipment-internals.js` réexporte ces mêmes noms, inchangés pour qui les
 * importait déjà (`component-relations.js` notamment).
 *
 * `component.shapeInEquipment` — LE CHAMP QUI MANQUAIT.
 * --------------------------------------------------------------------------------------
 * `normalizeComponents` reconstruit CHAQUE composant depuis une liste de champs fixe : un
 * champ absent de cette liste ne survit à AUCUN appel, silencieusement. Cette fonction
 * tourne à l'ouverture de l'éditeur ET à chaque enregistrement — sans cette entrée
 * explicite, dessiner une carte sur la photo d'un châssis puis modifier n'importe quel
 * AUTRE champ de ce composant aurait effacé la forme sans erreur ni trace. `normalizeShape`
 * (map-shape-contract.js, déjà le même contrat que shapeInRoom/shapeInBaie) rend `null`
 * pour une entrée absente ou illisible — jamais une forme réparée ou devinée.
 */
import { normalizeShape } from './map-shape-contract.js';
import { normalizePorts as normalizeConnectivityPorts } from './connectivity-contract.js';

export const EQUIPMENT_INTERNALS_CONTRACT_VERSION = 1;

export const EQUIPMENT_PROFILES = Object.freeze([
  'Standard',
  'PC / Workstation',
  'Serveur',
  'Switch / Routeur',
  'Châssis modulaire',
  'Patch panel / PPV',
  'Stockage',
  'Écran / Multiviewer',
  'Équipement broadcast',
  'Autre'
]);

export const HARDWARE_COMPONENT_TYPES = Object.freeze([
  'Processeur / CPU',
  'Mémoire RAM',
  'Disque HDD',
  'Disque SSD',
  'Disque NVMe',
  'GPU / Carte graphique',
  'Carte réseau / NIC',
  'Carte PCIe',
  'Carte broadcast / traitement',
  'Contrôleur RAID / stockage',
  'Carte mère',
  'Alimentation / PSU',
  'Ventilateur / refroidissement',
  'Module SFP / SFP+',
  'Module interne',
  'Châssis / frame interne',
  'Autre'
]);

export const SOFTWARE_TYPES = Object.freeze([
  "Système d'exploitation",
  'Firmware',
  'BIOS / UEFI',
  'Pilote / Driver',
  'Application',
  'Service',
  'Middleware',
  'Base de données',
  'Machine virtuelle',
  'Container',
  'Licence',
  'Autre'
]);

export const PORT_BEHAVIORS = Object.freeze([
  { value:'fixed', label:'Fixe — respecter IN/OUT' },
  { value:'patch', label:'Réversible / brassage manuel' },
  { value:'bidirectional', label:'Bidirectionnel' },
  { value:'passive', label:'Passif / sens défini par le câblage' }
]);

export const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const normalizePortsExtended = (ports, fallbackBehavior = 'fixed') => normalizeConnectivityPorts(ports, { fallbackBehavior });

export const normalizeComponents = components => (Array.isArray(components) ? components : []).map(component => ({
  id: component.id || makeId('COMP'),
  type: component.type || 'Autre',
  name: component.name || component.nom || '',
  manufacturer: component.manufacturer || component.marque || '',
  model: component.model || component.modele || '',
  serialNumber: component.serialNumber || component.numSerie || '',
  partNumber: component.partNumber || '',
  capacity: component.capacity || '',
  slot: component.slot || component.location || '',
  parentComponentId: component.parentComponentId || null,
  status: component.status || component.statut || 'Opérationnel',
  replaceable: component.replaceable !== false,
  verificationStatus: component.verificationStatus || 'to-confirm',
  notes: component.notes || '',
  // La carte/module de CE composant sur la photo de SON équipement — voir
  // nested-shape-contract.js#SHAPE_IN_EQUIPMENT_FIELD. `null` si absente ou illisible :
  // jamais devinée depuis le slot, jamais réparée.
  shapeInEquipment: normalizeShape(component.shapeInEquipment) || null,
  ports: normalizePortsExtended(component.ports, 'fixed')
}));

export const normalizeSoftware = software => (Array.isArray(software) ? software : []).map(item => ({
  id: item.id || makeId('SW'),
  type: item.type || 'Application',
  name: item.name || item.nom || '',
  version: item.version || '',
  vendor: item.vendor || item.editeur || '',
  license: item.license || item.licence || '',
  installedOn: item.installedOn || item.installDate || '',
  status: item.status || item.statut || 'Actif',
  verificationStatus: item.verificationStatus || 'to-confirm',
  notes: item.notes || ''
}));

export default Object.freeze({
  version: EQUIPMENT_INTERNALS_CONTRACT_VERSION,
  EQUIPMENT_PROFILES, HARDWARE_COMPONENT_TYPES, SOFTWARE_TYPES, PORT_BEHAVIORS,
  makeId, normalizePortsExtended, normalizeComponents, normalizeSoftware
});
