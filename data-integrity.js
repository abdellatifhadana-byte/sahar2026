import { db } from './db.js';
import { eventSystem } from './events.js';
import { findOrphanReferences } from './wall-model.js';
import { validateEquipmentConnectivity, validateCableShape } from './connectivity-contract.js';
import { validateModuleHierarchy } from './module-hierarchy-contract.js';
import { inspectMediaUrl, isTransientMediaUrl, classifyMediaRecord } from './media-contract.js';
import {
  buildRelationshipIndex,
  resolveEquipmentLocation,
  validateRouterPortPhysicalLink
} from './relationship-contract.js';

export const INTEGRITY_WARNING_KEYS = Object.freeze(['mediaFragileUrls']);

const normalizedText = value => String(value ?? '').trim().toLocaleLowerCase('fr-FR');
const asArray = value => Array.isArray(value) ? value : [];
const duplicatesBy = (records, keyFn) => {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push(record);
  }
  return [...groups.entries()].filter(([,items]) => items.length > 1).map(([key,items]) => ({ key, ids:items.map(item => item.id), items }));
};

function catalogMediaEntries(record) {
  return [
    ...(record?.officialImage ? [{ slot:'officialImage', image:record.officialImage }] : []),
    ...asArray(record?.officialImages).map((image, index) => ({ slot:`officialImages[${index}]`, image })),
    ...asArray(record?.candidateImages).map((image, index) => ({ slot:`candidateImages[${index}]`, image }))
  ];
}

function buildReferenceResolver({ rooms, baies, equipments, walls, screens, docs }) {
  const roomIds = new Set(rooms.map(item => String(item.id)));
  const baieIds = new Set(baies.map(item => String(item.id)));
  const equipmentIds = new Set(equipments.map(item => String(item.id)));
  const wallIds = new Set(walls.map(item => String(item.id)));
  const screenIds = new Set(screens.map(item => String(item.id)));
  const docIds = new Set(docs.map(item => String(item.id)));
  const componentIds = new Set();
  for (const equipment of equipments) {
    for (const component of asArray(equipment.components)) componentIds.add(`${equipment.id}:${component.id}`);
  }

  return reference => {
    if (!reference?.type || reference.id == null) return false;
    const id = String(reference.id);
    if (reference.type === 'room') return roomIds.has(id);
    if (reference.type === 'baie') return baieIds.has(id);
    if (reference.type === 'equipment') return equipmentIds.has(id);
    if (reference.type === 'wall') return wallIds.has(id);
    if (reference.type === 'screen') return screenIds.has(id);
    if (reference.type === 'component') return componentIds.has(`${reference.parentEquipmentId}:${id}`);
    if (['router','router-port','router-interface','signal-path','patch-point','service'].includes(reference.type)) return docIds.has(id);
    return false;
  };
}

export function summarizeIntegrityCounts(counts = {}) {
  const warningKeys = new Set(INTEGRITY_WARNING_KEYS);
  const warnings = Object.entries(counts)
    .filter(([key]) => warningKeys.has(key))
    .reduce((sum, [,value]) => sum + Number(value || 0), 0);
  const blocking = Object.entries(counts)
    .filter(([key]) => !warningKeys.has(key))
    .reduce((sum, [,value]) => sum + Number(value || 0), 0);
  return { blocking, warnings, valid:blocking === 0 };
}

export async function inspectDataIntegrity() {
  const [rooms, baies, equipments, walls, screens, groups, tickets, docs, cables] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments'), db.getAll('walls'),
    db.getAll('screens'), db.getAll('screen_groups'), db.getAll('tickets'),
    db.getAll('docs'), db.getAll('cables')
  ]);

  const relationshipIndex = buildRelationshipIndex({ rooms, baies, equipments });
  const issues = findOrphanReferences({ rooms, baies, equipments, walls, screens });
  const screenIds = new Set(screens.map(x => String(x.id)));
  issues.screenGroups = groups.filter(group => (group.screenIds || []).some(id => !screenIds.has(String(id))));

  const catalogRecords = docs.filter(item => item.kind === 'equipment_catalog' || item.targetType === 'equipment_catalog');
  const catalogIds = new Set(catalogRecords.map(item => String(item.id)));
  issues.catalogLinks = equipments.filter(item => item.catalogId && !catalogIds.has(String(item.catalogId))).map(item => ({ id:item.id, name:item.name || item.nom, catalogId:item.catalogId }));
  issues.inventoryKeys = duplicatesBy(equipments.filter(item => item.inventoryKey), item => String(item.inventoryKey));
  issues.equipmentNames = duplicatesBy(equipments, item => normalizedText(item.name || item.nom));
  issues.moduleHierarchy = validateModuleHierarchy(equipments);

  issues.equipmentLocations = equipments.flatMap(item => {
    const location = resolveEquipmentLocation(item, relationshipIndex);
    return location.issues.map(issue => ({
      id:item.id,
      name:item.name || item.nom,
      code:issue.code,
      roomId:item.roomId ?? null,
      baieId:item.baieId ?? null,
      message:issue.message
    }));
  });

  issues.equipmentConnectivity = equipments.flatMap(item => {
    const checked = validateEquipmentConnectivity(item);
    return checked.errors.length ? [{ id:item.id, name:item.name || item.nom, errors:checked.errors }] : [];
  });
  issues.cableShape = cables.flatMap(item => {
    const checked = validateCableShape(item);
    return checked.errors.length ? [{ id:item.id, reference:item.reference, errors:checked.errors }] : [];
  });

  issues.mapTransientImages = [
    ...rooms.filter(item => isTransientMediaUrl(item.image)).map(item => ({ type:'room', id:item.id, name:item.name, message:'Image de salle stockée avec une URL blob temporaire.' })),
    ...baies.filter(item => isTransientMediaUrl(item.image)).map(item => ({ type:'baie', id:item.id, name:item.name, message:'Image de baie stockée avec une URL blob temporaire.' }))
  ];

  issues.mediaInvalidUrls = [];
  issues.mediaFragileUrls = [];
  for (const record of catalogRecords) {
    for (const { slot, image } of catalogMediaEntries(record)) {
      const checked = inspectMediaUrl(image);
      const detail = {
        catalogId:record.id,
        model:record.model || record.family || record.title || record.id,
        slot,
        url:image?.url || image?.src || '',
        mediaType:classifyMediaRecord(image),
        reason:checked.reason || ''
      };
      if (!checked.valid) issues.mediaInvalidUrls.push(detail);
      else if (checked.fragile) issues.mediaFragileUrls.push(detail);
    }
  }

  const equipmentIds = new Set(equipments.map(item => String(item.id)));
  issues.topologyEquipmentLinks = docs
    .filter(item => item.kind === 'topology_router' && item.routerEquipmentId != null && !equipmentIds.has(String(item.routerEquipmentId)))
    .map(item => ({ id:item.id, name:item.name || item.title || item.id, routerEquipmentId:item.routerEquipmentId, message:'Le routeur topologique pointe vers un équipement absent.' }));

  issues.topologyPhysicalPortLinks = docs
    .filter(item => item.kind === 'topology_router_port' && item.physicalPortRef)
    .flatMap(item => {
      const checked = validateRouterPortPhysicalLink(item, relationshipIndex);
      return checked.valid ? [] : [{
        id:item.id,
        name:item.logicalAlias || `${item.direction || ''} ${item.portNumber || ''}`.trim() || item.id,
        routerId:item.routerId || null,
        physicalPortRef:item.physicalPortRef,
        errors:checked.errors
      }];
    });

  const resolvesReference = buildReferenceResolver({ rooms, baies, equipments, walls, screens, docs });
  const cableIds = new Set(cables.map(item => String(item.id)));
  const docIds = new Set(docs.map(item => String(item.id)));
  issues.diagramReferences = [];
  for (const diagram of docs.filter(item => item.kind === 'technical_diagram')) {
    for (const node of asArray(diagram.nodes)) {
      if (node.entityRef && !resolvesReference(node.entityRef)) {
        issues.diagramReferences.push({
          diagramId:diagram.id,
          nodeId:node.id,
          message:`Référence d’entité introuvable: ${node.entityRef.type}:${node.entityRef.id}`
        });
      }
      if (node.targetDiagramId != null && !docIds.has(String(node.targetDiagramId))) {
        issues.diagramReferences.push({ diagramId:diagram.id, nodeId:node.id, message:`Schéma cible introuvable: ${node.targetDiagramId}` });
      }
    }
    for (const edge of asArray(diagram.edges)) {
      if (edge.cableId != null && !cableIds.has(String(edge.cableId))) {
        issues.diagramReferences.push({ diagramId:diagram.id, edgeId:edge.id, message:`Câble de schéma introuvable: ${edge.cableId}` });
      }
      if (edge.relationId != null && !docIds.has(String(edge.relationId))) {
        issues.diagramReferences.push({ diagramId:diagram.id, edgeId:edge.id, message:`Relation de schéma introuvable: ${edge.relationId}` });
      }
    }
  }

  const counts = Object.fromEntries(Object.entries(issues).map(([key,value]) => [key,value.length]));
  const summary = summarizeIntegrityCounts(counts);
  const report = {
    valid:summary.valid,
    counts,
    severity:{ blocking:summary.blocking, warnings:summary.warnings, warningKeys:[...INTEGRITY_WARNING_KEYS] },
    issues,
    inventory:{
      equipments:equipments.length,
      catalogLinked:equipments.filter(item => item.catalogId).length,
      moduleCards:equipments.filter(item => item.entityKind === 'module-card').length,
      unassignedModuleCards:equipments.filter(item => item.entityKind === 'module-card' && item.assignmentStatus === 'unassigned-to-chassis').length,
      quantityToConfirm:equipments.filter(item => item.quantityToConfirm === true).length,
      planEvidence:equipments.filter(item => item.planEvidence).length,
      technicalDiagrams:docs.filter(item => item.kind === 'technical_diagram').length,
      fragileMedia:issues.mediaFragileUrls.length,
      transientMapImages:issues.mapTransientImages.length,
      locationIssues:issues.equipmentLocations.length,
      mappedTopologyPorts:docs.filter(item => item.kind === 'topology_router_port' && item.physicalPortRef).length
    },
    checkedAt:new Date().toISOString()
  };
  eventSystem.dispatch('data-integrity-checked', report);
  return report;
}