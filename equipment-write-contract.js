export const EQUIPMENT_WRITE_CONTRACT_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function normalizeRelationId(value) {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  return value;
}

export function definedFields(record = {}) {
  return Object.fromEntries(Object.entries(record).filter(([,value]) => value !== undefined));
}

export function mergeEquipmentRecord(existing = null, incoming = {}) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const next = { ...base, ...definedFields(incoming) };

  if (hasOwn(incoming, 'roomId')) next.roomId = normalizeRelationId(incoming.roomId);
  else if (hasOwn(base, 'roomId')) next.roomId = normalizeRelationId(base.roomId);

  if (hasOwn(incoming, 'baieId')) next.baieId = normalizeRelationId(incoming.baieId);
  else if (hasOwn(base, 'baieId')) next.baieId = normalizeRelationId(base.baieId);

  if (base.createdAt != null && (incoming.createdAt === undefined || incoming.createdAt === null || incoming.createdAt === '')) {
    next.createdAt = base.createdAt;
  }
  return next;
}

export function applyBaieLocation(record = {}, baie = null) {
  const next = { ...record };
  if (next.baieId == null) return next;
  if (!baie || String(baie.id) !== String(next.baieId)) return next;
  const roomId = normalizeRelationId(baie.roomId);
  if (roomId != null) next.roomId = roomId;
  return next;
}

export function equipmentWriteDiff(existing = {}, next = {}) {
  const changed = [];
  const keys = new Set([...Object.keys(existing || {}), ...Object.keys(next || {})]);
  for (const key of keys) {
    const left = existing?.[key];
    const right = next?.[key];
    if (JSON.stringify(left) !== JSON.stringify(right)) changed.push(key);
  }
  return changed.sort();
}

export default Object.freeze({
  version:EQUIPMENT_WRITE_CONTRACT_VERSION,
  normalizeRelationId,
  definedFields,
  mergeEquipmentRecord,
  applyBaieLocation,
  equipmentWriteDiff
});
