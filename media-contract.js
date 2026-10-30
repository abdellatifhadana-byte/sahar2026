export const MEDIA_TYPES = Object.freeze([
  'field-photo',
  'product-photo',
  'technical-view',
  'manufacturer-diagram',
  'candidate-reference'
]);

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLocaleLowerCase('fr-FR');
const DOCUMENT_RENDITION_RE = /\.docx\/_jcr_content\/renditions\//i;

export function mediaUrl(value) {
  const raw = clean(typeof value === 'object' ? (value?.url || value?.src) : value);
  if (!raw) return '';
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw) || /^blob:/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function mediaTypeLabel(type) {
  return ({
    'field-photo':'Photo réelle 2M',
    'product-photo':'Photo produit',
    'technical-view':'Vue technique constructeur',
    'manufacturer-diagram':'Schéma constructeur',
    'candidate-reference':'Référence candidate'
  })[type] || 'Média';
}

export function classifyMediaRecord(record = {}, defaults = {}) {
  const explicit = clean(record.mediaType || defaults.mediaType);
  if (MEDIA_TYPES.includes(explicit)) return explicit;

  const sourceType = lower(record.sourceType || defaults.sourceType);
  const verification = lower(record.verificationStatus || defaults.verificationStatus);
  if (sourceType === 'instance') return 'field-photo';

  const url = lower(mediaUrl(record));
  const text = lower([
    record.alt,
    record.label,
    record.matchNote,
    record.view,
    record.caption,
    record.description,
    defaults.alt,
    defaults.label
  ].filter(Boolean).join(' '));

  if (
    DOCUMENT_RENDITION_RE.test(url)
    || /\b(block diagram|schematic|schema|schéma|diagramme|architecture figure|figure constructeur|figure officielle)\b/i.test(text)
  ) return 'manufacturer-diagram';

  if (
    url.includes('/content/guides/public/html/')
    || /\b(visual guide|vue technique|technical view|annotated|annotée|rear panel|front panel|vue arrière|configuration de façade|configuration de disques|ports?)\b/i.test(text)
  ) return 'technical-view';

  if (verification === 'candidate' || sourceType === 'secondary-source') return 'candidate-reference';
  return 'product-photo';
}

export function isTransientMediaUrl(value) {
  return /^blob:/i.test(clean(typeof value === 'object' ? (value?.url || value?.src) : value));
}

export function inspectMediaUrl(record = {}) {
  const url = mediaUrl(record);
  if (!url) return { valid:false, external:false, fragile:false, reason:'URL média invalide ou non sécurisée' };
  if (/^(?:data:image\/|blob:)/i.test(url)) {
    return {
      valid:true,
      external:false,
      fragile:isTransientMediaUrl(url),
      reason:isTransientMediaUrl(url) ? 'URL blob temporaire non persistante' : ''
    };
  }

  const lowerUrl = lower(url);
  let reason = '';
  if (DOCUMENT_RENDITION_RE.test(lowerUrl)) reason = 'Rendition interne d’un document constructeur; lien potentiellement fragile';
  else if (lowerUrl.includes('/content/guides/public/html/')) reason = 'Asset extrait d’un guide technique; vérifier la stabilité du lien';
  else if (/\b(rvb-img\.reverb\.com|cdn-images\.av-iq\.com)\b/i.test(lowerUrl)) reason = 'Asset hébergé par une source secondaire; disponibilité à surveiller';

  return { valid:true, external:true, fragile:Boolean(reason), reason };
}

export function normalizeMediaRecord(record = {}, defaults = {}) {
  const url = mediaUrl(record);
  if (!url) return null;
  return {
    ...defaults,
    ...record,
    url,
    mediaType:classifyMediaRecord(record, defaults)
  };
}

export default Object.freeze({
  MEDIA_TYPES,
  mediaUrl,
  mediaTypeLabel,
  classifyMediaRecord,
  isTransientMediaUrl,
  inspectMediaUrl,
  normalizeMediaRecord
});
