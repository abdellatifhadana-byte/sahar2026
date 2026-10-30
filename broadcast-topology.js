import { db } from './db.js';
import {
  TOPOLOGY_KINDS,
  TOPOLOGY_KIND_SET,
  SIGNAL_TYPES,
  PATH_ROLES,
  CONFIDENCE_LEVELS,
  VERIFICATION_STATUSES,
  ROUTER_INTERFACE_TYPES,
  normalizeDirection,
  normalizeConfidence,
  normalizeVerification,
  normalizeStringArray,
  deriveRouterId,
  validateTopologyRecord,
  validateTopologyReferences
} from './topology-contract.js';

export {
  TOPOLOGY_KINDS,
  TOPOLOGY_KIND_SET,
  SIGNAL_TYPES,
  PATH_ROLES,
  CONFIDENCE_LEVELS,
  VERIFICATION_STATUSES,
  ROUTER_INTERFACE_TYPES,
  normalizeDirection,
  normalizeConfidence,
  normalizeVerification,
  validateTopologyRecord,
  validateTopologyReferences
} from './topology-contract.js';

const TOPOLOGY_TARGET = 'broadcast_topology';
const now = () => new Date().toISOString();

export function makeTopologyId(prefix = 'topology') {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

export function normalizeTopologyRecord(kind, input = {}, current = null) {
  if (!TOPOLOGY_KIND_SET.has(kind)) throw new Error(`Type de topologie inconnu: ${kind}`);
  const id = input.id || current?.id || makeTopologyId(kind.replace('topology_', 'tp-'));
  const base = {
    ...(current || {}),
    ...input,
    id,
    kind,
    targetType: TOPOLOGY_TARGET,
    targetId: id,
    origin: input.origin || current?.origin || 'admin-topology',
    visibility: input.visibility || current?.visibility || 'technical',
    confidence: normalizeConfidence(input.confidence ?? current?.confidence),
    verificationStatus: normalizeVerification(input.verificationStatus ?? current?.verificationStatus),
    createdAt: current?.createdAt || input.createdAt || now(),
    updatedAt: now()
  };

  if (kind === TOPOLOGY_KINDS.ROUTER) {
    base.name = String(input.name ?? input.routerLabel ?? current?.name ?? '').trim();
    base.routerKey = String(input.routerKey ?? current?.routerKey ?? id).trim();
    base.inputCapacity = input.inputCapacity === '' || input.inputCapacity == null ? null : Number(input.inputCapacity);
    base.outputCapacity = input.outputCapacity === '' || input.outputCapacity == null ? null : Number(input.outputCapacity);
    base.matrixLabel = String(input.matrixLabel ?? current?.matrixLabel ?? '').trim();
    base.signalDomains = normalizeStringArray(input.signalDomains ?? current?.signalDomains);
    base.distinctFrom = normalizeStringArray(input.distinctFrom ?? current?.distinctFrom);
  }

  if (kind === TOPOLOGY_KINDS.ROUTER_PORT) {
    base.routerId = deriveRouterId({ ...(current || {}), ...input });
    base.direction = normalizeDirection(input.direction ?? current?.direction);
    base.portNumber = String(input.portNumber ?? current?.portNumber ?? '').trim();
    base.logicalAlias = String(input.logicalAlias ?? current?.logicalAlias ?? '').trim();
    base.logicalRole = String(input.logicalRole ?? current?.logicalRole ?? '').trim().toUpperCase();
    base.signalType = String(input.signalType ?? current?.signalType ?? 'SDI').trim().toUpperCase();
  }

  if (kind === TOPOLOGY_KINDS.ROUTER_INTERFACE) {
    base.routerId = deriveRouterId({ ...(current || {}), ...input });
    base.interfaceType = String(input.interfaceType ?? current?.interfaceType ?? 'OTHER').trim().toUpperCase();
    base.name = String(input.name ?? current?.name ?? '').trim();
    base.function = String(input.function ?? current?.function ?? '').trim();
    base.cableRefs = normalizeStringArray(input.cableRefs ?? input.cableRef ?? current?.cableRefs);
  }

  if (kind === TOPOLOGY_KINDS.CROSSPOINT) {
    base.routerId = deriveRouterId({ ...(current || {}), ...input });
    base.state = String(input.state ?? current?.state ?? 'DOCUMENTED').trim().toUpperCase();
    base.observedAt = input.observedAt || current?.observedAt || null;
  }

  if (kind === TOPOLOGY_KINDS.RV_LINK) {
    base.signalType = String(input.signalType ?? current?.signalType ?? 'SDI').trim().toUpperCase();
    base.cableRefs = normalizeStringArray(input.cableRefs ?? current?.cableRefs);
    base.segmentRefs = normalizeStringArray(input.segmentRefs ?? current?.segmentRefs);
  }

  if (kind === TOPOLOGY_KINDS.SIGNAL_PATH) {
    base.signalType = String(input.signalType ?? current?.signalType ?? 'SDI').trim().toUpperCase();
    base.pathRole = String(input.pathRole ?? current?.pathRole ?? 'PROGRAM').trim().toUpperCase();
    base.cableRefs = normalizeStringArray(input.cableRefs ?? current?.cableRefs);
    base.routerPortIds = normalizeStringArray(input.routerPortIds ?? current?.routerPortIds);
    base.evidenceIds = normalizeStringArray(input.evidenceIds ?? current?.evidenceIds);
  }

  if (kind === TOPOLOGY_KINDS.PATCH_POINT) {
    base.signalType = String(input.signalType ?? current?.signalType ?? 'SDI').trim().toUpperCase();
    base.cableRefs = normalizeStringArray(input.cableRefs ?? current?.cableRefs);
  }
  return base;
}

export async function getTopologyRecords() {
  const docs = await db.getAll('docs');
  return docs.filter(item => TOPOLOGY_KIND_SET.has(item.kind));
}

export async function getTopologyByKind(kind) {
  return (await getTopologyRecords()).filter(item => item.kind === kind);
}

export async function saveTopologyRecord(kind, input) {
  const current = input?.id ? await db.get('docs', input.id).catch(() => null) : null;
  const record = normalizeTopologyRecord(kind, input, current);
  const errors = validateTopologyRecord(record);
  errors.push(...await validateTopologyReferences(record, id => db.get('docs', id).catch(() => null)));
  const records = await getTopologyRecords();
  if (record.kind === TOPOLOGY_KINDS.ROUTER_PORT && records.some(item => item.kind === TOPOLOGY_KINDS.ROUTER_PORT && String(item.id) !== String(record.id) && String(item.routerId) === String(record.routerId) && item.direction === record.direction && String(item.portNumber) === String(record.portNumber))) {
    errors.push(`Le port ${record.direction} ${record.portNumber} existe déjà sur cette grille.`);
  }
  if (record.kind === TOPOLOGY_KINDS.ROUTER && records.some(item => item.kind === TOPOLOGY_KINDS.ROUTER && String(item.id) !== String(record.id) && String(item.routerKey).toLowerCase() === String(record.routerKey).toLowerCase())) {
    errors.push('Cette clé stable de grille existe déjà.');
  }
  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'INVALID_TOPOLOGY_RECORD';
    error.details = errors;
    throw error;
  }
  await db.save('docs', record);
  return record;
}

export async function deleteTopologyRecord(id) {
  const record = await db.get('docs', id);
  if (!record || !TOPOLOGY_KIND_SET.has(record.kind)) throw new Error('Élément de topologie introuvable.');
  const records = await getTopologyRecords();
  if (record.kind === TOPOLOGY_KINDS.ROUTER && records.some(item => String(item.routerId) === String(record.id))) {
    throw new Error('Cette grille possède encore des ports, interfaces ou crosspoints. Supprimez-les d’abord.');
  }
  if (record.kind === TOPOLOGY_KINDS.ROUTER_PORT && records.some(item => item.kind === TOPOLOGY_KINDS.CROSSPOINT && [item.inputPortId, item.outputPortId].map(String).includes(String(record.id)))) {
    throw new Error('Ce port est utilisé par un crosspoint documenté.');
  }
  await db.delete('docs', id);
  return true;
}

export async function loadTopologySnapshot() {
  const records = await getTopologyRecords();
  const byKind = Object.fromEntries(Object.values(TOPOLOGY_KINDS).map(kind => [kind, []]));
  for (const record of records) byKind[record.kind].push(record);
  return {
    records,
    routers: byKind[TOPOLOGY_KINDS.ROUTER],
    routerPorts: byKind[TOPOLOGY_KINDS.ROUTER_PORT],
    routerInterfaces: byKind[TOPOLOGY_KINDS.ROUTER_INTERFACE],
    crosspoints: byKind[TOPOLOGY_KINDS.CROSSPOINT],
    rvLinks: byKind[TOPOLOGY_KINDS.RV_LINK],
    signalPaths: byKind[TOPOLOGY_KINDS.SIGNAL_PATH],
    patchPoints: byKind[TOPOLOGY_KINDS.PATCH_POINT],
    synoptics: byKind[TOPOLOGY_KINDS.SYNOPTIC],
    evidence: byKind[TOPOLOGY_KINDS.EVIDENCE]
  };
}

export function buildSignalGraph(snapshot) {
  const nodes = new Map();
  const edges = [];
  const addNode = (id, label, type) => {
    if (id && !nodes.has(id)) nodes.set(id, { id, label: label || id, type });
  };
  for (const port of snapshot?.routerPorts || []) addNode(port.id, port.logicalAlias || `${port.direction} ${port.portNumber || ''}`.trim(), 'router-port');
  for (const path of snapshot?.signalPaths || []) {
    const sourceId = path.sourcePortId || path.sourceEquipmentId || `source:${path.sourceLabel}`;
    const destinationId = path.destinationPortId || path.destinationEquipmentId || `destination:${path.destinationLabel}`;
    addNode(sourceId, path.sourceLabel, 'source');
    addNode(destinationId, path.destinationLabel, 'destination');
    edges.push({ id:path.id, from:sourceId, to:destinationId, role:path.pathRole, signalType:path.signalType, record:path });
  }
  for (const link of snapshot?.rvLinks || []) {
    const sourceId = link.sourceId || `rv-source:${link.sourceLabel}`;
    const destinationId = link.destinationId || `rv-destination:${link.destinationLabel}`;
    addNode(sourceId, link.sourceLabel, 'rv-source');
    addNode(destinationId, link.destinationLabel, 'rv-destination');
    edges.push({ id:link.id, from:sourceId, to:destinationId, role:'RV_LINK', signalType:link.signalType, record:link });
  }
  for (const crosspoint of snapshot?.crosspoints || []) {
    addNode(crosspoint.inputPortId, crosspoint.inputLabel || crosspoint.inputPortId, 'router-input');
    addNode(crosspoint.outputPortId, crosspoint.outputLabel || crosspoint.outputPortId, 'router-output');
    edges.push({ id:crosspoint.id, from:crosspoint.inputPortId, to:crosspoint.outputPortId, role:'CROSSPOINT', signalType:crosspoint.signalType || 'SDI', record:crosspoint });
  }
  return { nodes:[...nodes.values()], edges };
}

export async function exportTopologyPayload() {
  const snapshot = await loadTopologySnapshot();
  return {
    format: '2m-tech-broadcast-topology',
    version: 2,
    exportedAt: now(),
    data: Object.fromEntries(Object.values(TOPOLOGY_KINDS).map(kind => [kind, snapshot.records.filter(record => record.kind === kind)]))
  };
}

export async function importTopologyPayload(payload) {
  const source = payload?.data || payload;
  if (!source || typeof source !== 'object') throw new Error('Fichier de topologie invalide.');
  const imported = [];
  const rejected = [];
  const candidates = Object.fromEntries(Object.values(TOPOLOGY_KINDS).map(kind => [kind, Array.isArray(source[kind]) ? [...source[kind]] : []]));
  const knownRouterIds = new Set(candidates[TOPOLOGY_KINDS.ROUTER].map(record => String(record.id)));

  for (const port of candidates[TOPOLOGY_KINDS.ROUTER_PORT]) {
    const routerId = deriveRouterId(port);
    if (!routerId || knownRouterIds.has(routerId)) continue;
    candidates[TOPOLOGY_KINDS.ROUTER].push({ id:routerId, name:port.routerLabel || port.routerEquipmentKey || 'Grille importée', routerEquipmentId:port.routerEquipmentId || null, verificationStatus:'documented', confidence:port.confidence || 'medium', origin:'import-topology-v1' });
    knownRouterIds.add(routerId);
  }

  for (const kind of Object.values(TOPOLOGY_KINDS)) {
    for (const candidate of candidates[kind]) {
      try {
        imported.push(await saveTopologyRecord(kind, { ...candidate, origin:candidate.origin || 'import-topology' }));
      } catch (error) {
        rejected.push({ kind, id:candidate?.id || null, reason:error.message });
      }
    }
  }
  return { imported, rejected };
}
