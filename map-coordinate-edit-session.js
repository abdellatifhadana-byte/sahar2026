const cloneValue = value => {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const keyOf = record => String(record?.id ?? '');

/**
 * Session réversible d'édition de coordonnées.
 *
 * Elle ne connaît ni IndexedDB ni le serveur. L'appelant choisit explicitement les champs
 * de géométrie concernés par la scène courante. Annuler restaure ces champs à l'identique,
 * y compris l'ABSENCE d'une propriété : écrire `undefined` à la place ferait croire qu'une
 * coordonnée existe alors qu'elle n'a jamais été saisie.
 */
export function createCoordinateEditSession(records = [], fields = []) {
  const trackedFields = [...new Set((fields || []).filter(Boolean).map(String))];
  const byId = new Map((records || []).filter(record => record?.id != null).map(record => [keyOf(record), record]));
  const snapshots = new Map();
  const dirty = new Set();

  const snapshotOf = record => Object.fromEntries(trackedFields.map(field => [field, {
    present: Object.prototype.hasOwnProperty.call(record, field),
    value: cloneValue(record?.[field])
  }]));

  for (const [id, record] of byId) snapshots.set(id, snapshotOf(record));

  const restoreRecord = (record, snapshot) => {
    for (const field of trackedFields) {
      const saved = snapshot[field];
      if (saved?.present) record[field] = cloneValue(saved.value);
      else delete record[field];
    }
  };

  return Object.freeze({
    fields: Object.freeze([...trackedFields]),
    markDirty(recordOrId) {
      const id = typeof recordOrId === 'object' ? keyOf(recordOrId) : String(recordOrId ?? '');
      if (byId.has(id)) dirty.add(id);
      return dirty.has(id);
    },
    isDirty(recordOrId) {
      const id = typeof recordOrId === 'object' ? keyOf(recordOrId) : String(recordOrId ?? '');
      return dirty.has(id);
    },
    dirtyRecords() {
      return [...dirty].map(id => byId.get(id)).filter(Boolean);
    },
    dirtyIds() { return [...dirty]; },
    restore() {
      for (const [id, snapshot] of snapshots) {
        const record = byId.get(id);
        if (record) restoreRecord(record, snapshot);
      }
      dirty.clear();
    },
    acknowledge(recordOrId) {
      const id = typeof recordOrId === 'object' ? keyOf(recordOrId) : String(recordOrId ?? '');
      const record = byId.get(id);
      if (!record) return false;
      snapshots.set(id, snapshotOf(record));
      dirty.delete(id);
      return true;
    }
  });
}

/**
 * Sauvegarde uniquement les éléments sales et rend un résultat explicite par élément.
 * Une réussite partielle n'est jamais convertie en « tout enregistré » : les échecs restent
 * sales et peuvent être montrés/repris par l'interface.
 */
export async function saveCoordinateEditSession(session, save) {
  if (!session || typeof session.dirtyRecords !== 'function' || typeof save !== 'function') {
    throw new TypeError('Session de coordonnées ou fonction de sauvegarde invalide.');
  }
  const saved = [];
  const failed = [];
  for (const record of session.dirtyRecords()) {
    try {
      await save(record);
      session.acknowledge(record);
      saved.push(String(record.id));
    } catch (error) {
      failed.push({ id:String(record.id), error, code:error?.code || null, status:Number(error?.status || 0) || null });
    }
  }
  return Object.freeze({
    status: failed.length ? (saved.length ? 'partial' : 'failed') : 'success',
    saved:Object.freeze(saved),
    failed:Object.freeze(failed),
    pending:Object.freeze(session.dirtyIds())
  });
}
