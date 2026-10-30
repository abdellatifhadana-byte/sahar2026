import { db } from './db.js';
import { getCatalog } from './equipment-knowledge.js';
import {
  classifyMediaRecord,
  inspectMediaUrl,
  mediaTypeLabel,
  normalizeMediaRecord
} from './media-contract.js';

export const MEDIA_RUNTIME_HEALTH_VERSION = 1;

const failures = new Map();
let catalogCache = null;
let catalogCacheAt = 0;

const asArray = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

async function catalogMap(force = false) {
  if (!force && catalogCache && Date.now() - catalogCacheAt < 60_000) return catalogCache;
  const catalog = await getCatalog();
  catalogCache = new Map(catalog.map(record => [String(record.id), record]));
  catalogCacheAt = Date.now();
  return catalogCache;
}

export function buildEquipmentMediaPlan(equipment = {}, catalog = null) {
  const entries = [
    ...asArray(equipment.images).map(image => normalizeMediaRecord(
      typeof image === 'string' ? { url:image } : image,
      { sourceType:'instance', verificationStatus:'observed', label:'Photo réelle 2M' }
    )),
    ...(catalog?.officialImage ? [normalizeMediaRecord(catalog.officialImage, { sourceType:'manufacturer', verificationStatus:'verified', label:'Média constructeur' })] : []),
    ...asArray(catalog?.officialImages).map(image => normalizeMediaRecord(image, { sourceType:'manufacturer', verificationStatus:'verified', label:'Média constructeur' })),
    ...asArray(catalog?.candidateImages).map(image => normalizeMediaRecord(image, { sourceType:'secondary-source', verificationStatus:'candidate', label:'Visuel externe à vérifier' }))
  ].filter(Boolean);

  const unique = new Map();
  for (const entry of entries) {
    if (!unique.has(entry.url)) unique.set(entry.url, entry);
    else unique.set(entry.url, { ...unique.get(entry.url), ...entry });
  }
  return [...unique.values()];
}

function equipmentIdForImage(image) {
  const modal = image.closest?.('#ops-equipment-360[data-equipment-id]');
  if (modal?.dataset?.equipmentId) return String(modal.dataset.equipmentId);
  const row = image.closest?.('tr');
  const quickView = row?.querySelector?.('.eq-quickview[data-id]');
  return quickView?.dataset?.id ? String(quickView.dataset.id) : '';
}

async function contextForImage(image) {
  const equipmentId = equipmentIdForImage(image);
  if (!equipmentId) return { equipment:null, catalog:null, plan:[] };
  const [equipment, catalogs] = await Promise.all([
    db.get('equipments', db.normalizeKey ? db.normalizeKey(equipmentId) : equipmentId).catch(() => null),
    catalogMap()
  ]);
  const catalog = equipment ? catalogs.get(String(equipment.catalogId || '')) || null : null;
  return { equipment, catalog, plan:equipment ? buildEquipmentMediaPlan(equipment, catalog) : [] };
}

function currentRecordForImage(image, plan = []) {
  const current = String(image.currentSrc || image.src || '').trim();
  return plan.find(entry => entry.url === current) || {
    url:current,
    alt:image.alt || '',
    verificationStatus:image.closest?.('.eq-media-visual')?.querySelector?.('.eq-media-badge.candidate') ? 'candidate' : '',
    sourceType:image.closest?.('.eq-media-visual')?.querySelector?.('.eq-media-badge.real') ? 'instance' : 'manufacturer'
  };
}

function ensureKindBadge(image, record) {
  const host = image.closest?.('.eq-media-visual');
  if (!host || host.querySelector('.eq-media-kind-badge')) return;
  const kind = classifyMediaRecord(record);
  const badge = document.createElement('span');
  badge.className = `eq-media-kind-badge kind-${kind}`;
  badge.textContent = mediaTypeLabel(kind);
  badge.title = kind;
  host.appendChild(badge);
}

function updateGroupHeading(image, record) {
  const group = image.closest?.('.eq-media-group');
  const heading = group?.querySelector?.(':scope > h4');
  if (!heading) return;
  const kind = classifyMediaRecord(record);
  if (/Photos constructeur/i.test(heading.textContent || '') && ['technical-view','manufacturer-diagram'].includes(kind)) {
    heading.textContent = 'Médias constructeur du modèle';
  }
}

function recordFailure(image, record, equipmentId = '') {
  const url = String(image.currentSrc || image.src || record?.url || '').trim();
  const key = `${equipmentId}:${url}`;
  const failure = {
    equipmentId:equipmentId || null,
    url,
    mediaType:classifyMediaRecord(record || { url }),
    sourcePage:record?.sourcePage || null,
    sourceTrust:record?.sourceTrust || null,
    reason:inspectMediaUrl(record || { url }).reason || 'Échec de chargement dans le navigateur',
    failedAt:new Date().toISOString()
  };
  failures.set(key, failure);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('equipment-media-runtime-failure', { detail:failure }));
  }
  return failure;
}

function renderBrokenPlaceholder(image, record, failure) {
  const host = image.closest?.('.eq-media-visual') || image.parentElement;
  if (!host || host.querySelector('.eq-media-broken')) return;
  image.hidden = true;
  host.classList.add('media-broken');
  const source = record?.sourcePage && /^https:\/\//i.test(record.sourcePage)
    ? `<a href="${esc(record.sourcePage)}" target="_blank" rel="noopener noreferrer">Ouvrir la source</a>`
    : '';
  const placeholder = document.createElement('span');
  placeholder.className = 'eq-media-broken';
  placeholder.innerHTML = `<i class="fas fa-triangle-exclamation"></i><strong>Média indisponible</strong><small>${esc(failure.reason)}</small>${source}`;
  host.appendChild(placeholder);
}

async function tryTableFallback(image, plan, failedUrl) {
  if (!image.classList.contains('eq-media-thumb')) return false;
  const attempted = new Set(String(image.dataset.mediaAttempted || '').split('|').filter(Boolean));
  attempted.add(failedUrl);
  const next = plan.find(entry => entry.url && !attempted.has(entry.url));
  image.dataset.mediaAttempted = [...attempted].join('|');
  if (!next) return false;
  image.hidden = false;
  image.src = next.url;
  image.alt = next.alt || next.label || 'Équipement';
  image.dataset.mediaFallbackActive = '1';
  const host = image.closest?.('.eq-media-visual');
  host?.querySelector?.('.eq-media-kind-badge')?.remove();
  ensureKindBadge(image, next);
  return true;
}

async function handleImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.matches('.eq-media-thumb, .eq-media-large, .eq-media-existing img')) return;
  if (image.dataset.mediaHandlingError === '1') return;
  image.dataset.mediaHandlingError = '1';
  try {
    const { equipment, plan } = await contextForImage(image);
    const record = currentRecordForImage(image, plan);
    const failedUrl = String(image.currentSrc || image.src || record.url || '').trim();
    const failure = recordFailure(image, record, equipment?.id ? String(equipment.id) : equipmentIdForImage(image));
    if (await tryTableFallback(image, plan, failedUrl)) return;
    renderBrokenPlaceholder(image, record, failure);
  } finally {
    delete image.dataset.mediaHandlingError;
  }
}

async function decorateImage(image) {
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.matches('.eq-media-thumb, .eq-media-large, .eq-media-existing img')) return;
  const { plan } = await contextForImage(image);
  const record = currentRecordForImage(image, plan);
  ensureKindBadge(image, record);
  updateGroupHeading(image, record);
}

function scan(root = document) {
  root.querySelectorAll?.('.eq-media-thumb, .eq-media-large, .eq-media-existing img').forEach(image => {
    decorateImage(image).catch(() => {});
  });
}

function installRuntimeHealth() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document.documentElement.dataset.mediaRuntimeHealth === '1') return;
  document.documentElement.dataset.mediaRuntimeHealth = '1';
  document.addEventListener('error', handleImageError, true);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('.eq-media-thumb, .eq-media-large, .eq-media-existing img')) decorateImage(node).catch(() => {});
      scan(node);
    }
  });
  observer.observe(document.body, { childList:true, subtree:true });
  scan(document);
}

if (typeof window !== 'undefined') {
  installRuntimeHealth();
  window.EquipmentMediaRuntimeHealth = Object.freeze({
    version:MEDIA_RUNTIME_HEALTH_VERSION,
    getFailures:() => [...failures.values()],
    clearFailures:() => failures.clear(),
    scan:() => scan(document),
    buildEquipmentMediaPlan
  });
}