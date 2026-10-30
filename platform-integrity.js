import { db } from './db.js';
import { buildPlatformEntityGraph } from './platform-entity-graph.js';
import { cableRoomIds } from './connectivity-contract.js';

export const PLATFORM_INTEGRITY_VERSION = 1;

const asArray = value => Array.isArray(value) ? value : [];
const same = (left, right) => left != null && right != null && String(left) === String(right);
const BASE_AUDIT_TYPES = new Set([
  'equipment-location', 'router-equipment', 'router-port-physical-port',
  'diagram-entity', 'baie-room', 'wall-room'
]);

function screenWallRoomMismatches({ screens = [], walls = [] } = {}) {
  const wallById = new Map(asArray(walls).map(wall => [String(wall.id), wall]));
  return asArray(screens).flatMap(screen => {
    if (screen.wallId == null || screen.roomId == null) return [];
    const wall = wallById.get(String(screen.wallId));
    if (!wall || wall.roomId == null || same(wall.roomId, screen.roomId)) return [];
    return [{
      type:'screen-wall-room-mismatch',
      screenId:screen.id,
      screenName:screen.name || screen.nom || screen.id,
      screenRoomId:screen.roomId,
      wallId:wall.id,
      wallRoomId:wall.roomId,
      message:`L’écran « ${screen.name || screen.nom || screen.id} » est déclaré dans la salle ${screen.roomId}, mais son mur ${wall.id} appartient à la salle ${wall.roomId}.`
    }];
  });
}

/**
 * `cable.roomId` est un cache écrit à la création du câble et jamais rafraîchi ensuite.
 * Plus aucune décision ne s'appuie dessus — suppression de salle et autorisations
 * déduisent la salle des extrémités — mais il reste lisible dans les exports et les
 * sauvegardes. Le signaler évite qu'une valeur périmée y passe pour une vérité.
 */
function cableRoomCacheMismatches({ cables = [], equipments = [], screens = [] } = {}) {
  return asArray(cables).flatMap(cable => {
    if (cable.roomId == null) return [];
    const derived = cableRoomIds(cable, { equipments, screens });
    if (!derived.length || derived.some(roomId => same(roomId, cable.roomId))) return [];
    return [{
      type:'cable-room-cache-stale',
      cableId:cable.id,
      cableReference:cable.reference || cable.id,
      storedRoomId:cable.roomId,
      derivedRoomIds:derived,
      message:`Le câble « ${cable.reference || cable.id} » est étiqueté salle ${cable.roomId}, mais ses extrémités se trouvent en salle ${derived.join(' / ')}.`
    }];
  });
}

export function auditPlatformSnapshot(snapshot = {}) {
  const graph = buildPlatformEntityGraph(snapshot);
  const unresolved = asArray(graph.unresolved);
  const quarantine = unresolved.filter(issue => issue.type === 'quarantined-cable');
  const novelUnresolved = unresolved.filter(issue => issue.type !== 'quarantined-cable' && !BASE_AUDIT_TYPES.has(issue.type));
  const mismatches = screenWallRoomMismatches(snapshot);
  const compatibility = asArray(graph.compatibilityIssues);
  const connectionToConfirm = compatibility.filter(issue => issue.status === 'to-confirm');
  const incompatibleConnections = compatibility.filter(issue => issue.status !== 'to-confirm');

  // Avertissement et non blocage : la valeur périmée n'oriente plus aucune décision,
  // elle doit seulement cesser d'être invisible.
  const staleCableRooms = cableRoomCacheMismatches(snapshot);

  const blocking = novelUnresolved.length + mismatches.length + incompatibleConnections.length;
  const warnings = connectionToConfirm.length + quarantine.length + staleCableRooms.length;
  return {
    valid:blocking === 0,
    blocking,
    warnings,
    graph:graph.platformSummary || {
      nodes:graph.nodes?.size || 0,
      edges:graph.edges?.length || 0,
      structuralEdges:graph.structuralEdges?.length || 0,
      unresolved:unresolved.length
    },
    issues:{
      graphUnresolved:novelUnresolved,
      screenWallRoomMismatch:mismatches,
      graphIncompatibleConnections:incompatibleConnections,
      graphConnectionsToConfirm:connectionToConfirm,
      graphQuarantinedCables:quarantine,
      cableRoomCacheStale:staleCableRooms
    },
    rawUnresolved:unresolved
  };
}

export async function inspectPlatformIntegrity() {
  const [rooms, baies, equipments, walls, screens, cables, docs] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments'), db.getAll('walls'),
    db.getAll('screens'), db.getAll('cables'), db.getAll('docs')
  ]);
  return auditPlatformSnapshot({
    rooms, baies, equipments, walls, screens, cables, docs,
    continuityRecords:docs
  });
}
