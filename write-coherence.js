import { db } from './db.js';
import { persistableImageValue } from './persistent-image-guard.js';
import { isTransientMediaUrl } from './media-contract.js';
import { installCentralSyncTransitionGuard } from './central-sync-transition-guard.js';

export const WRITE_COHERENCE_VERSION = 2;
const MEDIA_STORES = new Set(['rooms', 'baies']);
const EVENT_STORES = new Set(['rooms','baies','equipments','walls','screens','cables','docs','tickets','settings']);

/*
 * Installer la garde AVANT que les modules d'enrichissement chargés plus tard ne posent
 * leurs listeners `central-sync-status`. Un heartbeat `synced` périodique ne doit jamais
 * redevenir un ordre d'écriture. Le premier `synced` et un vrai recovery restent visibles.
 */
installCentralSyncTransitionGuard();

async function normalizeRecordBeforeWrite(storeName, source = {}) {
  const record = { ...source };
  if (MEDIA_STORES.has(storeName)) {
    if (isTransientMediaUrl(record.image)) record.image = await persistableImageValue(record.image);
    if (isTransientMediaUrl(record.imageUrl)) record.imageUrl = await persistableImageValue(record.imageUrl);
  }
  return record;
}

function verifyDurableMedia(storeName, requested, stored) {
  if (!MEDIA_STORES.has(storeName)) return;
  for (const key of ['image','imageUrl']) {
    const value = stored?.[key];
    if (value && isTransientMediaUrl(value)) throw new Error(`Enregistrement non durable détecté pour ${storeName}.${key}.`);
    if (requested?.[key] && !stored?.[key]) throw new Error(`L'image ${key} n'a pas été conservée après l'enregistrement.`);
  }
}

function install() {
  if (!db?.save || db.__writeCoherenceInstalled) return;
  const previousSave = db.save.bind(db);
  db.save = async function coherentSave(storeName, source, ...rest) {
    const normalized = await normalizeRecordBeforeWrite(storeName, source);
    const id = await previousSave(storeName, normalized, ...rest);
    const stored = typeof db._getRaw === 'function' ? await db._getRaw(storeName, id) : await db.get(storeName, id);
    if (!stored) throw new Error(`L'enregistrement ${storeName}/${id} n'est pas relisible après écriture.`);
    verifyDurableMedia(storeName, normalized, stored);
    if (EVENT_STORES.has(storeName) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('platform-entity-updated', {
        detail:{ storeName, id, record:stored, updatedAt:new Date().toISOString() }
      }));
    }
    return id;
  };
  Object.defineProperty(db, '__writeCoherenceInstalled', { value:true, configurable:false });
}

install();

if (typeof window !== 'undefined') {
  window.WriteCoherence = Object.freeze({ version:WRITE_COHERENCE_VERSION, normalizeRecordBeforeWrite });
}

export { normalizeRecordBeforeWrite };
