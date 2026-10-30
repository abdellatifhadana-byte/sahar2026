import { buildTechnicalGraph, graphKeyForReference } from './technical-graph.js';
import { TOPOLOGY_KINDS } from './topology-contract.js';
import {
  buildRelationshipIndex,
  resolveEquipmentLocation,
  validateRouterPortPhysicalLink
} from './relationship-contract.js';

export const PLATFORM_ENTITY_GRAPH_VERSION = 1;

const asArray = value => Array.isArray(value) ? value : [];
const same = (left, right) => left != null && right != null && String(left) === String(right);
const key = (type, id) => `${type}:${id}`;

function topologyFromDocs(docs = []) {
  const records = asArray(docs);
  return {
    routers:records.filter(item => item.kind === TOPOLOGY_KINDS.ROUTER),
    routerPorts:records.filter(item => item.kind === TOPOLOGY_KINDS.ROUTER_PORT),
    routerInterfaces:records.filter(item => item.kind === TOPOLOGY_KINDS.ROUTER_INTERFACE),
    crosspoints:records.filter(item => item.kind === TOPOLOGY_KINDS.CROSSPOINT),
    signalPaths:records.filter(item => item.kind === TOPOLOGY_KINDS.SIGNAL_PATH),
    patchPoints:records.filter(item => item.kind === TOPOLOGY_KINDS.PATCH_POINT),
    synoptics:records.filter(item => item.kind === TOPOLOGY_KINDS.SYNOPTIC)
  };
}

function addNode(graph, id, value) {
  if (!id || graph.nodes.has(id)) return graph.nodes.get(id) || null;
  const node = { id, ...value };
  graph.nodes.set(id, node);
  return node;
}

function addEdge(graph, edge) {
  if (!edge?.from || !edge?.to) return null;
  if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) return null;
  const id = edge.id || `platform-edge:${graph.edges.length + 1}`;
  if (graph.edges.some(item => String(item.id) === String(id))) return graph.edges.find(item => String(item.id) === String(id));
  const normalized = { directed:true, structural:true, ...edge, id };
  graph.edges.push(normalized);
  if (!graph.outgoing.has(normalized.from)) graph.outgoing.set(normalized.from, []);
  if (!graph.incoming.has(normalized.to)) graph.incoming.set(normalized.to, []);
  graph.outgoing.get(normalized.from).push(normalized);
  graph.incoming.get(normalized.to).push(normalized);
  if (normalized.directed === false) {
    const reverse = { ...normalized, id:`${normalized.id}:reverse`, from:normalized.to, to:normalized.from, reverseOf:normalized.id };
    if (!graph.outgoing.has(reverse.from)) graph.outgoing.set(reverse.from, []);
    if (!graph.incoming.has(reverse.to)) graph.incoming.set(reverse.to, []);
    graph.outgoing.get(reverse.from).push(reverse);
    graph.incoming.get(reverse.to).push(reverse);
  }
  return normalized;
}

function addUnresolved(graph, issue) {
  const signature = JSON.stringify(issue);
  if (!graph.unresolved.some(item => JSON.stringify(item) === signature)) graph.unresolved.push(issue);
}

function physicalGraphKey(reference) {
  if (!reference) return '';
  if (reference.ownerType === 'component') {
    return graphKeyForReference({
      type:'port', id:reference.ownerId, parentEquipmentId:reference.parentEquipmentId, portId:reference.portId
    });
  }
  return graphKeyForReference({ type:'port', id:reference.ownerId, portId:reference.portId });
}

function diagramReferenceKey(reference = {}) {
  if (!reference?.type || reference.id == null) return '';
  if (reference.type === 'diagram') return key('diagram', reference.id);
  return graphKeyForReference(reference);
}

export function buildPlatformEntityGraph(input = {}) {
  const rooms = asArray(input.rooms);
  const baies = asArray(input.baies);
  const equipments = asArray(input.equipments);
  const walls = asArray(input.walls);
  const screens = asArray(input.screens);
  const cables = asArray(input.cables);
  const docs = asArray(input.docs);
  const topology = input.topology || topologyFromDocs(docs);
  const relationshipIndex = buildRelationshipIndex({ rooms, baies, equipments });

  const graph = buildTechnicalGraph({
    equipments,
    screens,
    cables,
    topology,
    continuityRecords:asArray(input.continuityRecords)
  });
  graph.kind = 'platform-entity-graph';
  graph.version = PLATFORM_ENTITY_GRAPH_VERSION;
  graph.structuralEdges = [];

  const structural = edge => {
    const added = addEdge(graph, { ...edge, structural:true });
    if (added && !graph.structuralEdges.some(item => item.id === added.id)) graph.structuralEdges.push(added);
    return added;
  };

  for (const room of rooms) addNode(graph, key('room', room.id), { type:'room', entity:room, label:room.name || room.nom || `Salle ${room.id}` });
  for (const baie of baies) {
    const baieKey = key('baie', baie.id);
    addNode(graph, baieKey, { type:'baie', entity:baie, label:baie.name || baie.nom || `Baie ${baie.id}` });
    const roomKey = baie.roomId != null ? key('room', baie.roomId) : '';
    if (roomKey && graph.nodes.has(roomKey)) {
      structural({ id:`room-baie:${baie.id}`, from:roomKey, to:baieKey, relation:'contains-baie', directed:false });
    } else if (baie.roomId != null) {
      addUnresolved(graph, { type:'baie-room', baieId:baie.id, roomId:baie.roomId });
    }
  }

  for (const equipment of equipments) {
    const equipmentKey = key('equipment', equipment.id);
    const location = resolveEquipmentLocation(equipment, relationshipIndex);
    for (const issue of location.issues) addUnresolved(graph, { type:'equipment-location', equipmentId:equipment.id, code:issue.code, message:issue.message });
    if (location.baie) {
      structural({ id:`baie-equipment:${equipment.id}`, from:key('baie', location.baie.id), to:equipmentKey, relation:'contains-equipment', directed:false });
    } else if (location.room) {
      structural({ id:`room-equipment:${equipment.id}`, from:key('room', location.room.id), to:equipmentKey, relation:'contains-equipment', directed:false });
    }
  }

  for (const wall of walls) {
    const wallKey = key('wall', wall.id);
    addNode(graph, wallKey, { type:'wall', entity:wall, label:wall.name || wall.nom || `Mur ${wall.id}` });
    const roomKey = wall.roomId != null ? key('room', wall.roomId) : '';
    if (roomKey && graph.nodes.has(roomKey)) structural({ id:`room-wall:${wall.id}`, from:roomKey, to:wallKey, relation:'contains-wall', directed:false });
    else if (wall.roomId != null) addUnresolved(graph, { type:'wall-room', wallId:wall.id, roomId:wall.roomId });
  }

  for (const screen of screens) {
    const screenKey = key('screen', screen.id);
    if (!graph.nodes.has(screenKey)) continue;
    if (screen.wallId != null && graph.nodes.has(key('wall', screen.wallId))) {
      structural({ id:`wall-screen:${screen.id}`, from:key('wall', screen.wallId), to:screenKey, relation:'contains-screen', directed:false });
    } else if (screen.roomId != null && graph.nodes.has(key('room', screen.roomId))) {
      structural({ id:`room-screen:${screen.id}`, from:key('room', screen.roomId), to:screenKey, relation:'contains-screen', directed:false });
    }
  }

  for (const routerPort of topology.routerPorts || []) {
    if (!routerPort.physicalPortRef) continue;
    const checked = validateRouterPortPhysicalLink(routerPort, relationshipIndex);
    if (!checked.valid || checked.status !== 'mapped') {
      addUnresolved(graph, { type:'router-port-physical-port', routerPortId:routerPort.id, errors:checked.errors });
      continue;
    }
    const physicalKey = physicalGraphKey(checked.physical.reference);
    const routerPortKey = key('router-port', routerPort.id);
    if (!graph.nodes.has(physicalKey) || !graph.nodes.has(routerPortKey)) {
      addUnresolved(graph, { type:'router-port-physical-port-node', routerPortId:routerPort.id, physicalKey, routerPortKey });
      continue;
    }
    structural({
      id:`implements-router-port:${routerPort.id}`,
      from:physicalKey,
      to:routerPortKey,
      relation:'implements-router-port',
      directed:false,
      verificationStatus:checked.physical.reference.verificationStatus,
      evidenceRef:checked.physical.reference.evidenceRef || null
    });
  }

  for (const diagram of docs.filter(item => item.kind === 'technical_diagram')) {
    const diagramKey = key('diagram', diagram.id);
    addNode(graph, diagramKey, { type:'diagram', entity:diagram, label:diagram.title || diagram.name || `Schéma ${diagram.id}` });
    for (const node of asArray(diagram.nodes)) {
      if (!node?.entityRef) continue;
      const targetKey = diagramReferenceKey(node.entityRef);
      if (targetKey && graph.nodes.has(targetKey)) {
        structural({ id:`diagram-ref:${diagram.id}:${node.id}`, from:diagramKey, to:targetKey, relation:'visualizes', directed:false });
      } else {
        addUnresolved(graph, { type:'diagram-entity', diagramId:diagram.id, nodeId:node.id, reference:node.entityRef });
      }
    }
  }

  const structuralByRelation = graph.structuralEdges.reduce((counts, edge) => {
    counts[edge.relation] = (counts[edge.relation] || 0) + 1;
    return counts;
  }, {});
  graph.platformSummary = {
    nodes:graph.nodes.size,
    edges:graph.edges.length,
    structuralEdges:graph.structuralEdges.length,
    unresolved:graph.unresolved.length,
    physicalRouterPortLinks:structuralByRelation['implements-router-port'] || 0,
    diagramLinks:structuralByRelation.visualizes || 0,
    locationLinks:(structuralByRelation['contains-baie'] || 0) + (structuralByRelation['contains-equipment'] || 0) + (structuralByRelation['contains-wall'] || 0) + (structuralByRelation['contains-screen'] || 0)
  };
  return graph;
}

export function directPlatformRelations(graph, reference, { structuralOnly = true } = {}) {
  const start = diagramReferenceKey(reference);
  if (!start || !graph?.nodes?.has(start)) return [];
  const edges = [
    ...(graph.outgoing.get(start) || []),
    ...(graph.incoming.get(start) || [])
  ].filter(edge => !structuralOnly || edge.structural === true);
  const unique = new Map();
  for (const edge of edges) {
    const otherId = same(edge.from, start) ? edge.to : edge.from;
    const node = graph.nodes.get(otherId);
    if (!node) continue;
    unique.set(`${edge.relation}:${node.id}`, { relation:edge.relation, edge, node });
  }
  return [...unique.values()];
}

if (typeof window !== 'undefined') {
  window.PlatformEntityGraph = Object.freeze({
    version:PLATFORM_ENTITY_GRAPH_VERSION,
    build:buildPlatformEntityGraph,
    relations:directPlatformRelations
  });
}
