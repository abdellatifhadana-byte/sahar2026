const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const same = (a,b) => String(a ?? '') === String(b ?? '');
export const slotKey = value => text(value, 80).toLocaleLowerCase('fr-FR').replace(/\s+/g,' ');

export function isModuleCard(record = {}) {
  return record.entityKind === 'module-card' || String(record.inventorySource?.sheet || '').toLowerCase() === 'cartes';
}

export function isModularChassis(record = {}) {
  if (record.entityKind === 'modular-chassis' || record.equipmentProfile === 'Châssis modulaire') return true;
  const haystack = [record.type,record.categorie,record.modele,record.name,record.operationalRole].join(' ').toLowerCase();
  return haystack.includes('châssis') || haystack.includes('chassis') || haystack.includes('opengear frame') || haystack.includes('ogx frame');
}

export function validateModuleHierarchy(equipments = []) {
  const errors = [];
  const byId = new Map((Array.isArray(equipments) ? equipments : []).map(record => [String(record.id),record]));
  const occupiedSlots = new Map();
  for (const card of (Array.isArray(equipments) ? equipments : []).filter(isModuleCard)) {
    const hostId = card.hostEquipmentId;
    if (hostId == null || hostId === '') {
      if (card.assignmentStatus === 'assigned' || card.assignmentStatus === 'assigned-host-slot-to-confirm') {
        errors.push({ cardId:card.id, code:'ASSIGNED_WITHOUT_HOST', message:`${card.name || card.id}: état affecté sans châssis hôte.` });
      }
      continue;
    }
    const host = byId.get(String(hostId));
    if (!host) { errors.push({ cardId:card.id, code:'HOST_NOT_FOUND', message:`${card.name || card.id}: châssis hôte ${hostId} introuvable.` }); continue; }
    if (!isModularChassis(host)) errors.push({ cardId:card.id, code:'HOST_NOT_CHASSIS', message:`${card.name || card.id}: l'hôte ${host.name || host.id} n'est pas identifié comme châssis modulaire.` });
    if (same(card.id,host.id)) errors.push({ cardId:card.id, code:'SELF_HOST', message:`${card.name || card.id}: une carte ne peut pas être son propre hôte.` });
    if (card.assignmentStatus?.startsWith('assigned') && (!same(card.roomId,host.roomId) || !same(card.baieId,host.baieId))) {
      errors.push({ cardId:card.id, code:'HOST_LOCATION_MISMATCH', message:`${card.name || card.id}: salle/baie incohérente avec le châssis ${host.name || host.id}.` });
    }
    const slot = slotKey(card.slot);
    if (!slot) continue;
    const key = `${hostId}:${slot}`;
    if (occupiedSlots.has(key)) {
      const other = occupiedSlots.get(key);
      errors.push({ cardId:card.id, code:'SLOT_COLLISION', message:`Slot ${card.slot} du châssis ${host.name || host.id} utilisé par ${other.name || other.id} et ${card.name || card.id}.` });
    } else occupiedSlots.set(key,card);
  }
  return errors;
}

export const MODULE_HIERARCHY_VERSION = 1;
