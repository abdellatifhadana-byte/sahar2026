import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch4 } from './equipment-image-coverage-batch4.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH5_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH5_REVIEWED_AT = '2026-08-16';

// Batch 5 traite surtout des références legacy. Une source tierce peut être
// utilisée lorsqu'elle identifie explicitement le modèle, mais elle reste un
// « candidat » tant que l'asset ne provient pas directement du constructeur.
// Pour les familles dont le châssis exact n'est pas relevé à 2M, même une
// image constructeur reste candidate et porte son niveau de correspondance.
const TRUSTED_IMAGE_HOSTS = Object.freeze({
  'cdn-images.av-iq.com':'trusted-technical-catalog',
  'www.riedel.net':'manufacturer-direct',
  'tslproducts.com':'manufacturer-direct',
  'www.mediakind.com':'manufacturer-successor',
  'shop.obvan.tv':'trusted-broadcast-reseller',
  'avsupply.com':'trusted-broadcast-reseller'
});

const TRUSTED_CANDIDATE_IMAGES = Object.freeze([
  {
    id:'kb-tc-dbmax',
    image:{
      url:'https://cdn-images.av-iq.com/products/enlarge/dbmax-front.jpeg',
      sourcePage:'https://www.av-iq.com/avcat/ctl1642/index.cfm?manufacturer=tc-electronic&product=dbmax',
      sourceType:'secondary-source', sourceTrust:'trusted-technical-catalog', verificationStatus:'candidate',
      modelMatch:'exact-name', requiresFieldConfirmation:true,
      matchNote:'Le visuel correspond explicitement au TC Electronic DBMax. La révision/version de l’unité 2M reste à relever.',
      alt:'TC Electronic DBMax — visuel exact du modèle via catalogue technique AV-iQ'
    }
  },
  {
    id:'kb-kramer-vs81av',
    image:{
      url:'https://avsupply.com/wp-content/uploads/2024/05/vs-81av.jpg',
      sourcePage:'https://avsupply.com/ITM/10296/vs-81av.html/',
      sourceType:'secondary-source', sourceTrust:'trusted-broadcast-reseller', verificationStatus:'candidate',
      modelMatch:'exact', requiresFieldConfirmation:false,
      matchNote:'La page et le visuel identifient explicitement le Kramer VS-81AV, modèle déjà lisible sur la photo terrain 2M.',
      alt:'Kramer VS-81AV — visuel exact du modèle via distributeur AV professionnel'
    }
  },
  {
    id:'kb-wohler-amp2am',
    image:{
      url:'https://shop.obvan.tv/html/upload/save_image/0929100156_5f728784ef9f3.jpg',
      sourcePage:'https://shop.obvan.tv/products/detail/385',
      sourceType:'secondary-source', sourceTrust:'trusted-broadcast-reseller', verificationStatus:'candidate',
      modelMatch:'exact', requiresFieldConfirmation:false,
      matchNote:'Le revendeur broadcast identifie explicitement l’unité comme Wohler Technologies AMP2-AM.',
      alt:'Wohler AMP2-AM — visuel exact du modèle via revendeur broadcast professionnel'
    }
  },
  {
    id:'kb-riedel-artist',
    image:{
      url:'https://www.riedel.net/fileadmin/_processed_/3/4/csm_Artist-1024-Front_44069e1d5b.png',
      sourcePage:'https://www.riedel.net/en/products-solutions/intercom/artist-matrix-intercom/hardware',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'candidate',
      modelMatch:'family-example', requiresFieldConfirmation:true,
      matchNote:'Image constructeur de l’Artist-1024. Le catalogue 2M ne précise pas encore si le frame terrain est Artist-32, 64, 128 ou 1024.',
      alt:'Riedel Artist-1024 — exemple constructeur de la famille Artist, frame 2M à confirmer'
    }
  },
  {
    id:'kb-tsl-tallyman',
    image:{
      url:'https://tslproducts.com/wp-content/uploads/tm1-mk3plus-front-and-back-panel.png',
      sourcePage:'https://tslproducts.com/product/tm1-mk3/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'candidate',
      modelMatch:'family-example', requiresFieldConfirmation:true,
      matchNote:'Image constructeur du contrôleur TallyMan TM1-MK3+. La référence exacte du contrôleur TallyMan présent à 2M doit être relevée.',
      alt:'TSL TallyMan TM1-MK3+ — exemple constructeur, contrôleur 2M exact à confirmer'
    }
  },
  {
    id:'kb-harmonic-spectrum-vsx',
    image:{
      url:'https://www.mediakind.com/wp-content/uploads/2026/04/VSX.webp',
      sourcePage:'https://www.mediakind.com/spectrum-x/',
      sourceType:'manufacturer-successor', sourceTrust:'manufacturer-successor', verificationStatus:'candidate',
      modelMatch:'successor-family', requiresFieldConfirmation:true,
      matchNote:'Visuel VSX actuel publié par MediaKind après reprise de l’activité vidéo Harmonic. La génération Spectrum/VSX de l’unité 2M doit être confirmée avant toute promotion.',
      alt:'Spectrum X VSX — visuel actuel MediaKind, génération Harmonic 2M à confirmer'
    }
  }
]);

const MODEL_REQUIRED_IDS = Object.freeze([
  'kb-viewsonic24',
  'kb-blackbox-kvm-generic',
  'kb-genelec-monitor',
  'kb-iiyama43',
  'kb-maudio-device',
  'kb-konvision24',
  'kb-konvision21',
  'kb-elgato-streamdeck',
  'kb-cisco-110series5'
]);

const asArray = value => Array.isArray(value) ? value : [];
const isCatalog = record => record?.kind === 'equipment_catalog' || record?.targetType === 'equipment_catalog';

function trustedImage(image) {
  try {
    const url = new URL(String(image?.url || ''));
    const trust = TRUSTED_IMAGE_HOSTS[url.hostname];
    return url.protocol === 'https:' && Boolean(trust) && trust === image?.sourceTrust;
  } catch {
    return false;
  }
}

function mergeImages(current, incoming) {
  const merged = new Map();
  for (const image of [...asArray(current), ...asArray(incoming)]) {
    const key = String(image?.url || '').trim();
    if (!key) continue;
    const previous = merged.get(key) || {};
    merged.set(key, { ...previous, ...image });
  }
  return [...merged.values()];
}

function isAdminLocked(record) {
  return record?.imageResearch?.origin === 'admin'
    || record?.imageResearch?.locked === true
    || record?.officialImage?.origin === 'admin'
    || record?.officialImage?.locked === true;
}

async function runEquipmentImageCoverageBatch5Core() {
  await db.open();

  const candidateEntries = TRUSTED_CANDIDATE_IMAGES.filter(entry => trustedImage(entry.image));
  const candidates = new Map(candidateEntries.map(entry => [entry.id, entry.image]));
  const protectedGenericIds = new Set(MODEL_REQUIRED_IDS);
  const docs = (await db.getAll('docs')).filter(isCatalog);

  let updated = 0;
  let candidatesAdded = 0;
  let adminLocked = 0;
  let genericProtected = 0;

  for (const record of docs) {
    if (isAdminLocked(record)) {
      adminLocked += 1;
      continue;
    }

    const id = String(record.id);
    if (protectedGenericIds.has(id)) {
      genericProtected += 1;
      if (Number(record.imageCoverageBatch5Version || 0) < EQUIPMENT_IMAGE_BATCH5_VERSION) {
        await db.save('docs', { ...record, imageCoverageBatch5Version:EQUIPMENT_IMAGE_BATCH5_VERSION });
        updated += 1;
      }
      continue;
    }

    const candidateImage = candidates.get(id);
    let next = { ...record, imageCoverageBatch5Version:EQUIPMENT_IMAGE_BATCH5_VERSION };

    if (candidateImage) {
      const before = asArray(record.candidateImages).length;
      const merged = mergeImages(record.candidateImages, [candidateImage]);
      next = {
        ...next,
        candidateImages:merged,
        imageResearch:{
          ...(record.imageResearch || {}),
          candidateSourcePage:candidateImage.sourcePage,
          candidateSourceType:candidateImage.sourceType,
          candidateSourceTrust:candidateImage.sourceTrust,
          candidateModelMatch:candidateImage.modelMatch,
          candidateRequiresFieldConfirmation:Boolean(candidateImage.requiresFieldConfirmation),
          candidateMatchNote:candidateImage.matchNote,
          candidateReviewedAt:EQUIPMENT_IMAGE_BATCH5_REVIEWED_AT
        }
      };
      if (merged.length > before) candidatesAdded += 1;
    }

    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH5_VERSION,
    catalog:docs.length,
    updated,
    candidatesAdded,
    adminLocked,
    genericProtected,
    trustedCandidateTargets:candidateEntries.length
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 * Même principe que le lot 2 : la dépendance est résolue avant d'entrer dans la file.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch5() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch4();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch5Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch5 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH5_VERSION,
    ensure:ensureEquipmentImageCoverageBatch5,
    candidates:TRUSTED_CANDIDATE_IMAGES,
    trustedHosts:TRUSTED_IMAGE_HOSTS,
    modelRequired:MODEL_REQUIRED_IDS
  });
  await ensureEquipmentImageCoverageBatch5().catch(error => console.warn('Image coverage batch 5 indisponible', error));
}
