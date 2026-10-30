import { normalizePorts } from './connectivity-contract.js';

export const RELATIONSHIP_CONTRACT_VERSION = 1;
export const PHYSICAL_PORT_OWNER_TYPES = Object.freeze(['equipment','component']);

const asArray = value => Array.isArray(value) ? value : [];
const key = value => value == null ? '' : String(value);
const label = entity => entity?.name || entity?.nom || entity?.modele || entity?.title || (entity?.id != null ? `#${entity.id}` : '—');

export function buildRelationshipIndex({ rooms = [], baies = [], equipments = [] } = {}) {
  const roomById = new Map(asArray(rooms).map(item => [key(item.id), item]));
  const baieById = new Map(asArray(baies).map(item => [key(item.id), item]));
  const equipmentById = new Map(asArray(equipments).map(item => [key(item.id), item]));
  const componentsByEquipmentId = new Map();
  for (const equipment of asArray(equipments)) {
    componentsByEquipmentId.set(key(equipment.id), new Map(asArray(equipment.components).map(component => [key(component.id), component])));
  }
  return { roomById, baieById, equipmentById, componentsByEquipmentId };
}

export function resolveEquipmentLocation(equipment = {}, index = buildRelationshipIndex()) {
  const issues = [];
  const roomId = equipment.roomId == null ? '' : key(equipment.roomId);
  const baieId = equipment.baieId == null ? '' : key(equipment.baieId);
  const room = roomId ? index.roomById.get(roomId) || null : null;
  const baie = baieId ? index.baieById.get(baieId) || null : null;

  if (roomId && !room) issues.push({ code:'room-missing', roomId:equipment.roomId, message:`Salle introuvable: ${equipment.roomId}` });
  if (baieId && !baie) issues.push({ code:'baie-missing', baieId:equipment.baieId, message:`Baie introuvable: ${equipment.baieId}` });
  if (baie && baie.roomId != null) {
    const baieRoomId = key(baie.roomId);
    if (!roomId) {
      issues.push({ code:'equipment-room-missing-for-baie', roomId:baie.roomId, baieId:baie.id, message:`La baie ${label(baie)} appartient à la salle ${baie.roomId}, mais l’équipement n’a pas de roomId.` });
    } else if (roomId !== baieRoomId) {
      issues.push({ code:'baie-room-mismatch', roomId:equipment.roomId, baieRoomId:baie.roomId, baieId:baie.id, message:`La baie ${label(baie)} appartient à la salle ${baie.roomId}, pas à ${equipment.roomId}.` });
    }
  }

  const effectiveRoom = room || (baie?.roomId != null ? index.roomById.get(key(baie.roomId)) || null : null);
  const path = [
    ...(effectiveRoom ? [{ type:'room', id:effectiveRoom.id, label:label(effectiveRoom), entity:effectiveRoom }] : []),
    ...(baie ? [{ type:'baie', id:baie.id, label:label(baie), entity:baie }] : []),
    ...(equipment?.id != null ? [{ type:'equipment', id:equipment.id, label:label(equipment), entity:equipment }] : [])
  ];
  return { room:effectiveRoom, baie, equipment, path, issues, valid:issues.length === 0 };
}

/**
 * Étiquette du chemin PHYSIQUE : « RF1 › B01.RF1 › Routeur ».
 *
 * Elle s'appelait `locationBreadcrumb` — exactement le nom que porte, dans
 * `location-contract.js`, une fonction TOTALEMENT DIFFÉRENTE : celle-là remonte l'arbre
 * géographique depuis un identifiant, `(locationId, locations)`, tandis que celle-ci lit
 * un chemin DÉJÀ RÉSOLU par `resolveEquipmentLocation`, `(location)`.
 *
 * Deux comportements sous un seul nom, et un piège parfaitement silencieux : importer la
 * mauvaise ne lève rien: `asArray(undefined.path)` rend `[]`, donc une chaîne vide. Pas
 * d'exception, pas d'avertissement — juste un fil d'Ariane qui disparaît de l'écran.
 *
 * C'est celle-ci qui est renommée parce que c'est la MOINS employée : aucun module
 * applicatif ne l'appelle (`equipment-relations-360.js` est passé à `fullBreadcrumbPath`,
 * qui joint les deux échelles), contre deux pour l'autre — `salles.js` et
 * `locations-section.js`. Renommer la plus employée aurait touché trois fichiers pour le
 * même résultat.
 */
export function physicalPathLabel(location = {}) {
  return asArray(location.path).map(item => item.label).filter(Boolean).join(' › ');
}

export function normalizePhysicalPortRef(reference = null) {
  if (!reference || typeof reference !== 'object') return null;
  const ownerType = String(reference.ownerType || reference.type || '').trim().toLowerCase();
  const ownerId = reference.ownerId ?? reference.id;
  const portId = reference.portId;
  const parentEquipmentId = reference.parentEquipmentId ?? null;
  if (!PHYSICAL_PORT_OWNER_TYPES.includes(ownerType) || ownerId == null || portId == null) return null;
  if (ownerType === 'component' && parentEquipmentId == null) return null;
  return {
    ownerType,
    ownerId,
    portId,
    parentEquipmentId:ownerType === 'component' ? parentEquipmentId : null,
    verificationStatus:reference.verificationStatus || 'to-confirm',
    evidenceRef:reference.evidenceRef || reference.sourceRef || null
  };
}

export function resolvePhysicalPortReference(reference, index = buildRelationshipIndex()) {
  const normalized = normalizePhysicalPortRef(reference);
  if (!normalized) return { valid:false, reference:null, owner:null, port:null, error:'Référence de port physique invalide.' };

  let owner = null;
  if (normalized.ownerType === 'equipment') {
    owner = index.equipmentById.get(key(normalized.ownerId)) || null;
  } else {
    const components = index.componentsByEquipmentId.get(key(normalized.parentEquipmentId));
    owner = components?.get(key(normalized.ownerId)) || null;
  }
  if (!owner) return { valid:false, reference:normalized, owner:null, port:null, error:'Propriétaire du port physique introuvable.' };
  const port = normalizePorts(owner.ports).find(item => key(item.id) === key(normalized.portId) || key(item.number) === key(normalized.portId)) || null;
  if (!port) return { valid:false, reference:normalized, owner, port:null, error:`Port physique introuvable: ${normalized.portId}` };
  return { valid:true, reference:normalized, owner, port, error:'' };
}

export function validateRouterPortPhysicalLink(routerPort = {}, index = buildRelationshipIndex()) {
  if (!routerPort.physicalPortRef) return { status:'unmapped', valid:true, routerPort, physical:null, errors:[] };
  const physical = resolvePhysicalPortReference(routerPort.physicalPortRef, index);
  const errors = physical.valid ? [] : [physical.error];
  if (physical.valid) {
    const routerDirection = String(routerPort.direction || '').toUpperCase();
    const physicalDirection = String(physical.port.direction || '').toUpperCase();
    const directionCompatible = routerDirection === 'INPUT'
      ? ['IN','IN/OUT'].includes(physicalDirection)
      : routerDirection === 'OUTPUT'
        ? ['OUT','IN/OUT'].includes(physicalDirection)
        : true;
    if (!directionCompatible) errors.push(`Direction incompatible: port grille ${routerDirection}, port physique ${physicalDirection || 'non renseigné'}.`);
  }
  return { status:errors.length ? 'invalid' : 'mapped', valid:errors.length === 0, routerPort, physical, errors };
}

export default Object.freeze({
  version:RELATIONSHIP_CONTRACT_VERSION,
  buildRelationshipIndex,
  resolveEquipmentLocation,
  physicalPathLabel,
  normalizePhysicalPortRef,
  resolvePhysicalPortReference,
  validateRouterPortPhysicalLink
});
