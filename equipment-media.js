import { db } from './db.js';
import Equipements from './equipements.js';
import { getCatalog } from './equipment-knowledge.js';
import { ensureEquipmentImageSeed } from './equipment-image-seed.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const asArray = value => Array.isArray(value) ? value : [];
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (SAFE_DATA_IMAGE_RE.test(raw) || /^blob:/i.test(raw)) return raw;
  if (/^data:/i.test(raw)) return '';
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}

function normalizeImage(image, defaults = {}) {
  if (typeof image === 'string') {
    const url = safeImageUrl(image);
    return url ? { url, ...defaults } : null;
  }
  const url = safeImageUrl(image?.url || image?.src);
  return url ? { ...defaults, ...image, url } : null;
}

function normalizeImageList(images, defaults = {}) {
  const merged = new Map();
  for (const image of images) {
    const normalized = normalizeImage(image, defaults);
    if (!normalized?.url) continue;
    const previous = merged.get(normalized.url) || {};
    merged.set(normalized.url, { ...previous, ...normalized });
  }
  return [...merged.values()];
}

export function pickEquipmentMedia(equipment = {}, catalog = null) {
  const real = normalizeImageList(asArray(equipment.images), {
    sourceType:'instance', verificationStatus:'observed', label:'Photo réelle 2M'
  });
  const officials = normalizeImageList([
    ...(catalog?.officialImage ? [catalog.officialImage] : []),
    ...asArray(catalog?.officialImages)
  ], {
    sourceType:'manufacturer', verificationStatus:'verified', label:'Photo constructeur'
  });
  const official = officials[0] || null;
  const candidates = normalizeImageList(asArray(catalog?.candidateImages), {
    sourceType:'secondary-source', verificationStatus:'candidate', label:'Visuel externe à vérifier'
  });
  return {
    real,
    official,
    officials,
    candidates,
    primary: real[0] || official || candidates[0] || null,
    research: catalog?.imageResearch || null
  };
}

let catalogCache = null;
let catalogCacheAt = 0;
async function catalogMap(force = false) {
  if (!force && catalogCache && Date.now() - catalogCacheAt < 60_000) return catalogCache;
  await ensureEquipmentImageSeed();
  const catalog = await getCatalog();
  catalogCache = new Map(catalog.map(record => [String(record.id), record]));
  catalogCacheAt = Date.now();
  return catalogCache;
}

function mediaBadge(media) {
  if (!media) return '';
  if (media.sourceType === 'instance') return '<span class="eq-media-badge real">Photo réelle 2M</span>';
  if (media.verificationStatus === 'candidate') return '<span class="eq-media-badge candidate">Source externe · à vérifier</span>';
  return '<span class="eq-media-badge official">Photo constructeur</span>';
}

function researchPlaceholder(research, compact = false) {
  const status = String(research?.status || '');
  let text = 'Image non disponible';
  let icon = 'fa-image';
  if (status === 'model-required' || research?.modelRequired === true) {
    text = compact ? 'Modèle exact requis' : 'Modèle/SKU exact requis avant d’associer une photo produit.';
    icon = 'fa-tag';
  } else if (status === 'source-page-known' || status === 'official-image-verified' || research?.sourcePage) {
    text = compact ? 'Source officielle connue' : 'Source officielle identifiée — image encore à collecter.';
    icon = 'fa-link';
  } else if (status === 'needs-source') {
    text = compact ? 'Source à rechercher' : 'Source constructeur à rechercher.';
    icon = 'fa-search';
  }
  return `<span class="eq-media-empty" title="${esc(research?.reason || text)}"><i class="fas ${icon}"></i><small>${esc(text)}</small></span>`;
}

function imageMarkup(media, className = 'eq-media-thumb', research = null) {
  if (!media?.url) return researchPlaceholder(research, className === 'eq-media-thumb');
  return `<span class="eq-media-visual">${mediaBadge(media)}<img src="${esc(media.url)}" alt="${esc(media.alt || media.label || 'Équipement')}" class="${esc(className)}" loading="lazy" referrerpolicy="no-referrer"></span>`;
}

async function decorateEquipmentTable() {
  const table = document.querySelector('#admin-content table.tableau');
  if (!table) return;
  const headerRow = table.querySelector('tr');
  const headers = [...(headerRow?.querySelectorAll('th') || [])];
  const imageIndex = headers.findIndex(header => header.textContent.trim().toLowerCase() === 'images');
  if (imageIndex < 0) return;
  const [equipments, catalogs] = await Promise.all([db.getAll('equipments'), catalogMap()]);
  const equipmentById = new Map(equipments.map(item => [String(item.id), item]));
  const rows = [...table.querySelectorAll('tr')].slice(1);
  for (const row of rows) {
    const link = row.querySelector('.eq-quickview[data-id]');
    if (!link) continue;
    const equipment = equipmentById.get(String(link.dataset.id));
    if (!equipment) continue;
    const cell = row.children[imageIndex];
    if (!cell) continue;
    const media = pickEquipmentMedia(equipment, catalogs.get(String(equipment.catalogId || '')));
    cell.classList.add('eq-media-table-cell');
    if (media.real.length) continue;
    cell.innerHTML = imageMarkup(media.primary, 'eq-media-thumb', media.research);
  }
}

function patchTableMedia() {
  if (Equipements.prototype.__equipmentMediaTablePatched) return;
  Equipements.prototype.__equipmentMediaTablePatched = true;
  const previousAfterRender = Equipements.prototype.afterRender;
  Equipements.prototype.afterRender = async function afterRenderWithEquipmentMedia() {
    await previousAfterRender.call(this);
    await decorateEquipmentTable().catch(error => console.warn('Décoration média équipements indisponible', error));
  };
}

function patchImagePreservation() {
  if (Equipements.prototype.__equipmentMediaPreservationPatched) return;
  Equipements.prototype.__equipmentMediaPreservationPatched = true;
  const previousShow = Equipements.prototype.showEquipementModal;
  Equipements.prototype.showEquipementModal = async function showEquipmentPreservingMedia(equipment = null) {
    await previousShow.call(this, equipment);
    if (!equipment?.id) return;
    const form = document.getElementById('eq-form');
    if (!form || form.dataset.mediaPreservationReady === '1') return;
    form.dataset.mediaPreservationReady = '1';
    const previousSubmit = form.onsubmit;
    form.onsubmit = async event => {
      const originalSave = db.save;
      db.save = async function saveWithoutDroppingExistingImages(storeName, record) {
        if (storeName === 'equipments' && String(record?.id ?? '') === String(equipment.id)) {
          const uploaded = Boolean(form.images?.files?.length);
          const incoming = asArray(record?.images);
          if (!uploaded && incoming.length === 0 && asArray(equipment.images).length) {
            record = { ...record, images:[...equipment.images] };
          }
        }
        return originalSave.call(db, storeName, record);
      };
      try {
        if (typeof previousSubmit === 'function') return await previousSubmit.call(form, event);
      } finally {
        db.save = originalSave;
      }
    };

    const existing = asArray(equipment.images).map(image => normalizeImage(image)).filter(Boolean);
    const preview = document.getElementById('modal-images-list');
    if (preview && existing.length && !preview.dataset.existingImagesRendered) {
      preview.dataset.existingImagesRendered = '1';
      preview.innerHTML = `<div class="eq-media-existing"><small>Photos réelles déjà enregistrées — elles sont conservées si vous ne choisissez pas de nouveaux fichiers.</small><div>${existing.map(image => `<img src="${esc(image.url)}" alt="Photo réelle enregistrée" loading="lazy">`).join('')}</div></div>`;
    }
  };
}

async function mediaForEquipmentId(id) {
  const [equipment, catalogs] = await Promise.all([
    db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null),
    catalogMap()
  ]);
  if (!equipment) return null;
  const catalog = catalogs.get(String(equipment.catalogId || '')) || null;
  return { equipment, catalog, media:pickEquipmentMedia(equipment, catalog) };
}

async function equipmentFor360(modal) {
  const explicitId = String(modal?.dataset?.equipmentId || '').trim();
  if (explicitId) {
    const equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(explicitId) : explicitId).catch(() => null);
    if (equipment) return equipment;
  }

  // operations-suite créait historiquement le modal avant que equipment-360-complete
  // n'ajoute data-equipment-id. Les deux observateurs partaient donc en course : la
  // fiche technique était enrichie, mais le module média pouvait sortir trop tôt.
  // La sous-ligne du header contient le nom exact de l'instance : on l'utilise comme
  // récupération déterministe uniquement lorsqu'il n'existe qu'une correspondance.
  const name = modal?.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
  if (!name) return null;
  const equipments = await db.getAll('equipments');
  const matches = equipments.filter(item => String(item.name || item.nom || '').trim() === name);
  return matches.length === 1 ? matches[0] : null;
}

function galleryMarkup(media) {
  const real = media.real.length
    ? `<div class="eq-media-group"><h4>Photos réelles 2M</h4><div class="eq-media-gallery">${media.real.map(image => imageMarkup(image, 'eq-media-large')).join('')}</div></div>`
    : '<div class="eq-media-group"><h4>Photos réelles 2M</h4><div class="eq-media-placeholder">Aucune photo terrain enregistrée pour cette instance.</div></div>';

  const official = media.officials?.length
    ? `<div class="eq-media-group"><h4>Photos constructeur du modèle</h4><div class="eq-media-gallery">${media.officials.map(image => imageMarkup(image, 'eq-media-large')).join('')}</div></div>`
    : '';

  const candidates = media.candidates.length
    ? `<div class="eq-media-group"><h4>Visuels externes candidats</h4><div class="eq-media-gallery">${media.candidates.map(image => imageMarkup(image, 'eq-media-large')).join('')}</div><p class="eq-media-warning">Ces visuels correspondent au modèle ou à une configuration documentée, mais ne sont pas promus comme photo constructeur tant que la correspondance terrain n’est pas confirmée.</p></div>`
    : '';

  const missing = !official && !candidates
    ? `<div class="eq-media-group"><h4>Photo constructeur du modèle</h4><div class="eq-media-placeholder">${media.research?.status === 'model-required' || media.research?.modelRequired === true ? 'Modèle/SKU exact requis avant d’associer une photo produit.' : (media.research?.sourcePage ? 'Source officielle identifiée — image encore à collecter.' : 'Source image à rechercher.')}</div></div>`
    : '';

  return real + official + candidates + missing;
}

async function enhance360Media(modal) {
  if (!modal || modal.dataset.mediaEnhanced === '1' || modal.dataset.mediaEnhancing === '1') return false;
  modal.dataset.mediaEnhancing = '1';
  try {
    const equipment = await equipmentFor360(modal);
    if (!equipment) return false;
    modal.dataset.equipmentId = String(equipment.id);
    const catalogs = await catalogMap();
    const catalog = catalogs.get(String(equipment.catalogId || '')) || null;
    const media = pickEquipmentMedia(equipment, catalog);
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;
    const section = document.createElement('section');
    section.className = 'ops-card equipment-media-card';
    section.innerHTML = `<h3><i class="fas fa-images"></i> Photos & média</h3><p class="ops-card-sub">Les photos terrain de cette instance restent séparées des visuels constructeur partagés par le catalogue.</p>${galleryMarkup(media)}`;
    target.prepend(section);
    modal.dataset.mediaEnhanced = '1';
    return true;
  } finally {
    delete modal.dataset.mediaEnhancing;
  }
}

async function enhanceLegacyQuickView(modal) {
  if (!modal || modal.dataset.mediaEnhanced === '1') return;
  const title = modal.querySelector('h3')?.textContent?.trim();
  const equipments = await db.getAll('equipments');
  const equipment = equipments.find(item => String(item.name || item.nom || '').trim() === title);
  if (!equipment) return;
  const catalogs = await catalogMap();
  const host = modal.querySelector('.modal-content') || modal.firstElementChild;
  if (!host) return;
  const section = document.createElement('section');
  section.className = 'equipment-media-legacy';
  section.innerHTML = `<h4>Photos & média</h4>${galleryMarkup(pickEquipmentMedia(equipment, catalogs.get(String(equipment.catalogId || ''))))}`;
  host.appendChild(section);
  modal.dataset.mediaEnhanced = '1';
}

function schedule360Enhancement(modal) {
  if (!modal) return;
  // Exécution immédiate + deux reprises courtes : protège aussi les anciennes
  // fiches ouvertes pendant une migration où catalogId est relié juste après le modal.
  queueMicrotask(() => enhance360Media(modal).catch(() => {}));
  setTimeout(() => enhance360Media(modal).catch(() => {}), 80);
  setTimeout(() => enhance360Media(modal).catch(() => {}), 450);
}

function installMediaObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.equipmentMediaObserver === '1') return;
  host.dataset.equipmentMediaObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const complete = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      const legacy = node.id === 'equip-quickview-modal' ? node : node.querySelector?.('#equip-quickview-modal');
      if (complete) schedule360Enhancement(complete);
      if (legacy) setTimeout(() => enhanceLegacyQuickView(legacy).catch(() => {}), 0);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360Enhancement(existing);
}

patchTableMedia();
patchImagePreservation();
if (typeof window !== 'undefined') {
  installMediaObserver();
  window.addEventListener('equipment-media-linkage-updated', async () => {
    await catalogMap(true).catch(() => null);
    await decorateEquipmentTable().catch(() => null);
    const modal = document.getElementById('ops-equipment-360');
    if (modal && modal.dataset.mediaEnhanced !== '1') schedule360Enhancement(modal);
  });
  window.EquipmentMedia = Object.freeze({
    pick:pickEquipmentMedia,
    enhance360:enhance360Media,
    refreshCatalog:() => catalogMap(true),
    decorateTable:decorateEquipmentTable
  });
}
