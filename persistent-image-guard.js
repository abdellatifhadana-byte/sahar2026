import { db } from './db.js';
import { isTransientMediaUrl } from './media-contract.js';

export const PERSISTENT_IMAGE_GUARD_VERSION = 1;
export const MAX_PERSISTED_IMAGE_BYTES = 12 * 1024 * 1024;

const GUARDED_STORES = new Set(['rooms', 'baies']);

export function needsPersistentImageConversion(storeName, record = {}) {
  return GUARDED_STORES.has(String(storeName || '')) && isTransientMediaUrl(record?.image);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Lecture image impossible.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

export async function persistableImageValue(value) {
  if (!isTransientMediaUrl(value)) return value;
  const response = await fetch(value);
  if (!response.ok) throw new Error(`Image temporaire inaccessible (${response.status}).`);
  const blob = await response.blob();
  if (!/^image\//i.test(blob.type || '')) throw new Error('Le fichier sélectionné n’est pas une image valide.');
  if (blob.size > MAX_PERSISTED_IMAGE_BYTES) throw new Error('Image trop volumineuse pour être enregistrée dans la carte (12 Mo maximum).');
  const dataUrl = await blobToDataUrl(blob);
  if (!/^data:image\//i.test(dataUrl)) throw new Error('Conversion persistante de l’image impossible.');
  return dataUrl;
}

function installGuard() {
  if (!db?.save || db.__persistentImageGuardInstalled) return;
  const originalSave = db.save.bind(db);
  db.save = async function saveWithPersistentImages(storeName, record, ...rest) {
    if (!needsPersistentImageConversion(storeName, record)) return originalSave(storeName, record, ...rest);
    const image = await persistableImageValue(record.image);
    return originalSave(storeName, { ...record, image }, ...rest);
  };
  Object.defineProperty(db, '__persistentImageGuardInstalled', { value:true, configurable:false });
}

installGuard();

if (typeof window !== 'undefined') {
  window.PersistentImageGuard = Object.freeze({
    version:PERSISTENT_IMAGE_GUARD_VERSION,
    maxBytes:MAX_PERSISTED_IMAGE_BYTES,
    needsPersistentImageConversion,
    persistableImageValue
  });
}
