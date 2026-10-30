/**
 * Planifie un remplacement de magasin IndexedDB sans réécriture inutile.
 *
 * Contrat:
 * - un entrant identique ne produit aucun put;
 * - un entrant nouveau/modifié produit un put;
 * - dans un magasin autoritaire, une fiche serveur absente est supprimée;
 * - un tombstone l'emporte toujours sur un entrant contradictoire;
 * - une fiche protégée par survivesAuthoritativeClear survit à l'absence autoritaire;
 * - dans un magasin non autoritaire, l'absence seule ne supprime rien.
 */

const hasUsableId = record => record?.id !== undefined && record?.id !== null && record?.id !== '';
const idKey = value => String(value);

function stableShape(value) {
  if (value instanceof Date) return `@date:${value.toISOString()}`;
  if (Array.isArray(value)) return value.map(stableShape);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableShape(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function recordsExactlyEqual(left, right) {
  try {
    return JSON.stringify(stableShape(left)) === JSON.stringify(stableShape(right));
  } catch {
    return false;
  }
}

export function planStoreReplacement(
  before = [],
  incoming = [],
  {
    authoritative = false,
    tombstones = [],
    survivesAuthoritativeClear = () => false
  } = {}
) {
  const beforeById = new Map();
  for (const record of before || []) {
    if (!hasUsableId(record)) continue;
    beforeById.set(idKey(record.id), record);
  }

  // Un doublon d'ID dans l'instantané se résout comme store.put(): la dernière valeur gagne.
  const incomingById = new Map();
  const incomingWithoutId = [];
  for (const record of incoming || []) {
    if (!hasUsableId(record)) {
      incomingWithoutId.push(record);
      continue;
    }
    incomingById.set(idKey(record.id), record);
  }

  const tombstoneKeys = new Set(
    (tombstones || [])
      .filter(id => id !== undefined && id !== null && id !== '')
      .map(idKey)
  );

  const deletes = [];
  const deleteKeys = new Set();
  const addDelete = id => {
    const key = idKey(id);
    if (deleteKeys.has(key)) return;
    deleteKeys.add(key);
    deletes.push(id);
  };

  const conserves = [];

  // Suppression explicite: elle gagne sur tout entrant contradictoire.
  for (const key of tombstoneKeys) {
    const local = beforeById.get(key);
    if (local) addDelete(local.id);
  }

  if (authoritative) {
    for (const local of before || []) {
      if (!hasUsableId(local)) continue;
      const key = idKey(local.id);
      if (tombstoneKeys.has(key)) continue;
      if (incomingById.has(key)) continue;
      if (survivesAuthoritativeClear(local)) {
        conserves.push(String(local.id));
        continue;
      }
      addDelete(local.id);
    }
  }

  const puts = [];
  for (const [key, record] of incomingById) {
    if (tombstoneKeys.has(key)) continue;
    const local = beforeById.get(key);
    if (local && recordsExactlyEqual(local, record)) continue;
    puts.push(record);
  }

  // Une fiche sans id ne peut pas être comparée de façon sûre; préserver le contrat existant
  // d'auto-incrément et l'émettre comme écriture.
  puts.push(...incomingWithoutId);

  return { puts, deletes, conserves };
}
