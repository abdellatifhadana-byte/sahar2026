import { normalizePorts, normalizeCableRecord, evaluateConnection, isCableActive } from './connectivity-contract.js';
import { CONTINUITY_KINDS, normalizeProtectionGroup } from './continuity-contract.js';

const nodeKey = (type, id, parentId = null) => `${type}:${parentId != null ? `${parentId}:` : ''}${id}`;
const portKey = (ownerType, ownerId, portId, parentId = null) => `port:${ownerType}:${parentId != null ? `${parentId}:` : ''}${ownerId}:${portId}`;

export function graphKeyForReference(reference = {}) {
  if (reference.type === 'component') return nodeKey('component', reference.id, reference.parentEquipmentId);
  if (reference.type === 'port') return reference.parentEquipmentId != null
    ? portKey('component', reference.id, reference.portId, reference.parentEquipmentId)
    : portKey('equipment', reference.id, reference.portId);
  if (reference.type === 'signal-path') return nodeKey('signal-path', reference.id);
  if (reference.type === 'router-port') return nodeKey('router-port', reference.id);
  return nodeKey(reference.type || 'equipment', reference.id);
}

function addNode(graph, id, value) {
  if (!id || graph.nodes.has(id)) return;
  graph.nodes.set(id, { id, ...value });
}

function addEdge(graph, edge) {
  if (!edge?.from || !edge?.to) return;
  const normalized = { directed:true, ...edge, id:edge.id || `edge:${graph.edges.length + 1}` };
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
}

function attachPorts(graph, owner, ports, ownerType, ownerId, parentId = null) {
  for (const port of normalizePorts(ports)) {
    const key = portKey(ownerType, ownerId, port.id, parentId);
    addNode(graph, key, { type:'port', ownerType, ownerId, parentId, port, label:`${owner.name || owner.nom || ownerId} / ${port.number}` });
    const ownerKey = nodeKey(ownerType, ownerId, parentId);
    if (['IN', 'IN/OUT'].includes(port.direction)) addEdge(graph, { id:`feeds:${key}`, from:key, to:ownerKey, relation:'feeds', pathRole:'OTHER', inferredForImpact:true });
    if (['OUT', 'IN/OUT'].includes(port.direction)) addEdge(graph, { id:`emits:${key}`, from:ownerKey, to:key, relation:'emits', pathRole:'OTHER', inferredForImpact:true });
  }
}

function resolveEndpoint(snapshot, cable, side) {
  const type = cable[`${side}Type`];
  const id = cable[`${side}Id`];
  const portId = cable[`${side}PortId`];
  if (type === 'equipment') {
    const entity = snapshot.equipments.find(item => String(item.id) === String(id));
    const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
    return { entity, port, key:port ? portKey('equipment', id, port.id) : null };
  }
  if (type === 'screen') {
    const entity = snapshot.screens.find(item => String(item.id) === String(id));
    const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
    return { entity, port, key:port ? portKey('screen', id, port.id) : null };
  }
  if (type === 'component') {
    const parentId = cable[`${side}ParentEquipmentId`];
    const parent = snapshot.equipments.find(item => String(item.id) === String(parentId));
    const entity = (parent?.components || []).find(item => String(item.id) === String(id));
    const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
    return { entity, parent, port, key:port ? portKey('component', id, port.id, parentId) : null };
  }
  return { entity:null, port:null, key:null };
}

export function buildTechnicalGraph(input = {}) {
  const snapshot = {
    equipments:Array.isArray(input.equipments) ? input.equipments : [],
    screens:Array.isArray(input.screens) ? input.screens : [],
    cables:Array.isArray(input.cables) ? input.cables : [],
    topology:input.topology || {},
    continuityRecords:Array.isArray(input.continuityRecords) ? input.continuityRecords : []
  };
  const graph = { nodes:new Map(), edges:[], outgoing:new Map(), incoming:new Map(), unresolved:[], compatibilityIssues:[], snapshot };

  for (const equipment of snapshot.equipments) {
    const equipmentKey = nodeKey('equipment', equipment.id);
    addNode(graph, equipmentKey, { type:'equipment', entity:equipment, label:equipment.name || equipment.nom || `Équipement ${equipment.id}` });
    attachPorts(graph, equipment, equipment.ports, 'equipment', equipment.id);
    for (const component of Array.isArray(equipment.components) ? equipment.components : []) {
      const componentKey = nodeKey('component', component.id, equipment.id);
      addNode(graph, componentKey, { type:'component', entity:component, parentEquipmentId:equipment.id, label:component.name || component.nom || `Composant ${component.id}` });
      addEdge(graph, { id:`contains:${equipment.id}:${component.id}`, from:equipmentKey, to:componentKey, relation:'contains', directed:false });
      attachPorts(graph, component, component.ports, 'component', component.id, equipment.id);
    }
  }

  for (const screen of snapshot.screens) {
    const screenKey = nodeKey('screen', screen.id);
    addNode(graph, screenKey, { type:'screen', entity:screen, label:screen.name || screen.nom || `Écran ${screen.id}` });
    attachPorts(graph, screen, screen.ports, 'screen', screen.id);
    if (screen.equipmentId != null) {
      const equipmentKey = nodeKey('equipment', screen.equipmentId);
      if (graph.nodes.has(equipmentKey)) addEdge(graph, { id:`display-equipment:${screen.id}`, from:equipmentKey, to:screenKey, relation:'displays-on' });
      else graph.unresolved.push({ type:'screen-equipment', screenId:screen.id, equipmentId:screen.equipmentId });
    }
  }

  for (const rawCable of snapshot.cables) {
    if (!isCableActive(rawCable)) {
      if (rawCable?.integrityState === 'quarantined') graph.unresolved.push({ type:'quarantined-cable', cableId:rawCable.id });
      continue;
    }
    const cable = normalizeCableRecord(rawCable);
    const source = resolveEndpoint(snapshot, cable, 'source');
    const destination = resolveEndpoint(snapshot, cable, 'destination');
    if (!source.key || !destination.key) {
      graph.unresolved.push({ type:'cable-endpoint', cableId:cable.id, sourceResolved:Boolean(source.key), destinationResolved:Boolean(destination.key) });
      continue;
    }
    const compatibility = evaluateConnection({ sourcePort:source.port, destinationPort:destination.port, cable });
    if (compatibility.status !== 'compatible') graph.compatibilityIssues.push({ cableId:cable.id, reference:cable.reference, ...compatibility });
    addEdge(graph, {
      id:`cable:${cable.id}`, from:source.key, to:destination.key, relation:'physical-cable',
      pathRole:cable.pathRole, signalDomains:cable.signalDomains, protocols:cable.protocols,
      cable, compatibility
    });
  }

  const topology = snapshot.topology;
  for (const router of topology.routers || []) {
    const routerKey = nodeKey('router', router.id);
    addNode(graph, routerKey, { type:'router', entity:router, label:router.name || router.title || router.routerKey || `Routeur ${router.id}` });
    if (router.routerEquipmentId != null) {
      const equipmentKey = nodeKey('equipment', router.routerEquipmentId);
      if (graph.nodes.has(equipmentKey)) {
        addEdge(graph, {
          id:`implements-router:${router.id}`,
          from:equipmentKey,
          to:routerKey,
          relation:'implements-topology',
          directed:false,
          structural:true,
          verificationStatus:router.verificationStatus || 'documented'
        });
      } else {
        graph.unresolved.push({ type:'router-equipment', routerId:router.id, equipmentId:router.routerEquipmentId });
      }
    }
  }

  for (const port of topology.routerPorts || []) {
    const portNodeKey = nodeKey('router-port', port.id);
    addNode(graph, portNodeKey, { type:'router-port', entity:port, label:port.logicalAlias || `${port.direction} ${port.portNumber}` });
    if (port.routerId != null) {
      const routerKey = nodeKey('router', port.routerId);
      if (graph.nodes.has(routerKey)) {
        addEdge(graph, { id:`router-port-parent:${port.id}`, from:routerKey, to:portNodeKey, relation:'contains-router-port', directed:false, structural:true });
      } else {
        graph.unresolved.push({ type:'router-port-router', routerPortId:port.id, routerId:port.routerId });
      }
    }
  }

  for (const routerInterface of topology.routerInterfaces || []) {
    const interfaceKey = nodeKey('router-interface', routerInterface.id);
    addNode(graph, interfaceKey, { type:'router-interface', entity:routerInterface, label:routerInterface.name || routerInterface.interfaceType || routerInterface.id });
    if (routerInterface.routerId != null) {
      const routerKey = nodeKey('router', routerInterface.routerId);
      if (graph.nodes.has(routerKey)) {
        addEdge(graph, { id:`router-interface-parent:${routerInterface.id}`, from:routerKey, to:interfaceKey, relation:'contains-router-interface', directed:false, structural:true });
      } else {
        graph.unresolved.push({ type:'router-interface-router', routerInterfaceId:routerInterface.id, routerId:routerInterface.routerId });
      }
    }
  }

  for (const crosspoint of topology.crosspoints || []) {
    const from = nodeKey('router-port', crosspoint.inputPortId); const to = nodeKey('router-port', crosspoint.outputPortId);
    if (graph.nodes.has(from) && graph.nodes.has(to)) addEdge(graph, { id:`crosspoint:${crosspoint.id}`, from, to, relation:'crosspoint', pathRole:'PROGRAM', record:crosspoint });
    else graph.unresolved.push({ type:'crosspoint', id:crosspoint.id });
  }
  for (const path of topology.signalPaths || []) {
    const pathKey = nodeKey('signal-path', path.id);
    addNode(graph, pathKey, { type:'signal-path', entity:path, label:path.name || path.sourceLabel || path.id });
    const from = path.sourcePortId ? nodeKey('router-port', path.sourcePortId) : path.sourceEquipmentId != null ? nodeKey('equipment', path.sourceEquipmentId) : null;
    const to = path.destinationPortId ? nodeKey('router-port', path.destinationPortId) : path.destinationEquipmentId != null ? nodeKey('equipment', path.destinationEquipmentId) : null;
    if (from && graph.nodes.has(from)) addEdge(graph, { id:`path-in:${path.id}`, from, to:pathKey, relation:'signal-path', pathRole:path.pathRole || 'PROGRAM', record:path });
    if (to && graph.nodes.has(to)) addEdge(graph, { id:`path-out:${path.id}`, from:pathKey, to, relation:'signal-path', pathRole:path.pathRole || 'PROGRAM', record:path });
  }

  return graph;
}

const DEFAULT_SIGNAL_RELATIONS = new Set(['feeds', 'emits', 'physical-cable', 'crosspoint', 'signal-path', 'displays-on']);

export function traceGraph(graph, startId, { direction = 'downstream', relations = DEFAULT_SIGNAL_RELATIONS, maxDepth = 100 } = {}) {
  if (!graph?.nodes?.has(startId)) return { startId, nodes:[], edges:[], truncated:false };
  const relationSet = relations instanceof Set ? relations : new Set(relations || []);
  const visited = new Set([startId]); const edges = []; const queue = [{ id:startId, depth:0 }];
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) { truncated = true; continue; }
    const candidates = direction === 'upstream' ? (graph.incoming.get(current.id) || []) : (graph.outgoing.get(current.id) || []);
    for (const edge of candidates) {
      if (relationSet.size && !relationSet.has(edge.relation)) continue;
      const next = direction === 'upstream' ? edge.from : edge.to;
      edges.push(edge);
      if (!visited.has(next)) { visited.add(next); queue.push({ id:next, depth:current.depth + 1 }); }
    }
  }
  return { startId, nodes:[...visited].map(id => graph.nodes.get(id)).filter(Boolean), edges:[...new Map(edges.map(edge => [edge.id, edge])).values()], truncated };
}

export function findGraphPath(graph, startId, destinationId, { relations = DEFAULT_SIGNAL_RELATIONS, pathRoles = null } = {}) {
  if (!graph?.nodes?.has(startId) || !graph.nodes.has(destinationId)) return null;
  const relationSet = relations instanceof Set ? relations : new Set(relations || []);
  const roleSet = pathRoles ? new Set(pathRoles) : null;
  const queue = [startId]; const previous = new Map([[startId, null]]); const previousEdge = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (current === destinationId) break;
    for (const edge of graph.outgoing.get(current) || []) {
      if (relationSet.size && !relationSet.has(edge.relation)) continue;
      if (roleSet && edge.pathRole && !roleSet.has(edge.pathRole)) continue;
      if (previous.has(edge.to)) continue;
      previous.set(edge.to, current); previousEdge.set(edge.to, edge); queue.push(edge.to);
    }
  }
  if (!previous.has(destinationId)) return null;
  const nodeIds = []; const edges = []; let current = destinationId;
  while (current != null) {
    nodeIds.unshift(current);
    if (previousEdge.has(current)) edges.unshift(previousEdge.get(current));
    current = previous.get(current);
  }
  return { nodes:nodeIds.map(id => graph.nodes.get(id)), edges };
}

const referenceSignature = reference => `${reference.type}:${reference.parentEquipmentId || ''}:${reference.id}:${reference.portId || ''}`;

function graphDependenciesForPath(path, graph) {
  if (!graph) return new Set();
  const references = [...(path?.entityRefs || []), ...(path?.dependencyRefs || [])];
  const keys = references.map(graphKeyForReference).filter(key => graph.nodes.has(key));
  if (path?.signalPathId) {
    const signalPathKey = graphKeyForReference({ type:'signal-path', id:path.signalPathId });
    if (graph.nodes.has(signalPathKey)) keys.push(signalPathKey);
  }
  const dependencies = new Set(keys);
  if (keys.length === 1) {
    for (const node of traceGraph(graph, keys[0], { direction:'downstream' }).nodes) dependencies.add(node.id);
  } else {
    for (let index = 0; index < keys.length - 1; index += 1) {
      for (const node of findGraphPath(graph, keys[index], keys[index + 1])?.nodes || []) dependencies.add(node.id);
    }
  }
  return dependencies;
}

export function analyzeProtectionGroup(rawGroup, { graph = null, tests = [] } = {}) {
  const group = normalizeProtectionGroup(rawGroup);
  const declaredPrimary = new Set([...(group.primaryPath.entityRefs || []), ...(group.primaryPath.dependencyRefs || [])].map(referenceSignature));
  const graphPrimary = graphDependenciesForPath(group.primaryPath, graph);
  const backups = group.backupPaths.map(path => {
    const declared = new Set([...(path.entityRefs || []), ...(path.dependencyRefs || [])].map(referenceSignature));
    const graphDependencies = graphDependenciesForPath(path, graph);
    const sharedDeclared = [...declared].filter(signature => declaredPrimary.has(signature));
    const sharedGraph = [...graphDependencies].filter(signature => graphPrimary.has(signature));
    const shared = [...new Set([...sharedDeclared, ...sharedGraph])];
    return {
      id:path.id, label:path.label, availability:path.availability,
      sharedDependencies:shared, graphDependencies:[...graphDependencies], independent:shared.length === 0
    };
  });
  const relevantTests = (tests || []).filter(test => String(test.protectionGroupId) === String(group.id))
    .sort((left, right) => new Date(right.performedAt || 0) - new Date(left.performedAt || 0));
  const latestTest = relevantTests[0] || null;
  const configurationVerified = group.status === 'validated' && group.verificationStatus === 'verified'
    && group.protectionType !== 'no-verified-backup'
    && group.backupPaths.some(path => path.availability === 'available' && path.verificationStatus === 'verified');
  return {
    groupId:group.id,
    serviceName:group.serviceName,
    configurationVerified,
    latestTestResult:latestTest?.result || null,
    hasVerifiedBackup:configurationVerified && latestTest?.result === 'passed',
    backups,
    declaredCommonDependencies:group.commonDependencyRefs.map(referenceSignature),
    singlePointsOfFailure:[...new Set([...backups.flatMap(item => item.sharedDependencies), ...group.commonDependencyRefs.map(referenceSignature)])]
  };
}

export function analyzeTechnicalSnapshot(input = {}) {
  const graph = buildTechnicalGraph(input);
  const continuityRecords = input.continuityRecords || [];
  const tests = continuityRecords.filter(record => record.kind === CONTINUITY_KINDS.TEST);
  const protectionGroups = continuityRecords.filter(record => record.kind === CONTINUITY_KINDS.PROTECTION_GROUP)
    .map(group => analyzeProtectionGroup(group, { graph, tests }));
  return {
    graph,
    summary:{
      nodes:graph.nodes.size,
      edges:graph.edges.length,
      unresolved:graph.unresolved.length,
      compatibilityIssues:graph.compatibilityIssues.length,
      protectionGroups:protectionGroups.length,
      servicesWithoutAvailableBackup:protectionGroups.filter(group => !group.hasVerifiedBackup).length,
      singlePointsOfFailure:protectionGroups.reduce((sum, group) => sum + group.singlePointsOfFailure.length, 0)
    },
    unresolved:graph.unresolved,
    compatibilityIssues:graph.compatibilityIssues,
    protectionGroups
  };
}

export const TECHNICAL_GRAPH_VERSION = 2;