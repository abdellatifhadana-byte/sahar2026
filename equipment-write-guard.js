import { db } from './db.js';
import { eventSystem } from './events.js';
import {
  mergeEquipmentRecord,
  applyBaieLocation,
  equipmentWriteDiff,
  normalizeRelationId
} from './equipment-write-contract.js';

export const EQUIPMENT_WRITE_GUARD_VERSION = 1;

function installGuard() {
  if (!db?.save || db.__equipmentWriteGuardInstalled) return;
  const originalSave = db.save.bind(db);

  db.save = async function saveWithEquipmentIntegrity(storeName, record, ...rest) {
    if (storeName !== 'equipments' || !record || typeof record !== 'object') {
      return originalSave(storeName, record, ...rest);
    }

    const incomingId = normalizeRelationId(record.id);
    const existing = incomingId == null
      ? null
      : await db.get('equipments', db.normalizeKey ? db.normalizeKey(incomingId) : incomingId).catch(() => null);

    let payload = mergeEquipmentRecord(existing, record);
    if (payload.baieId != null) {
      const baieId = db.normalizeKey ? db.normalizeKey(payload.baieId) : payload.baieId;
      const baie = await db.get('baies', baieId).catch(() => null);
      payload = applyBaieLocation(payload, baie);
    }

    const changedFields = equipmentWriteDiff(existing || {}, payload);
    const savedId = await originalSave(storeName, payload, ...rest);
    const detail = {
      equipmentId:savedId,
      existing:Boolean(existing),
      changedFields,
      roomId:payload.roomId ?? null,
      baieId:payload.baieId ?? null,
      catalogId:payload.catalogId ?? null
    };
    eventSystem.dispatch('equipment-record-normalized', detail);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('equipment-record-normalized', { detail }));
    }
    return savedId;
  };

  Object.defineProperty(db, '__equipmentWriteGuardInstalled', { value:true, configurable:false });
}

installGuard();

if (typeof window !== 'undefined') {
  window.EquipmentWriteGuard = Object.freeze({ version:EQUIPMENT_WRITE_GUARD_VERSION });
}
