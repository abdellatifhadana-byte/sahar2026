import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch6 } from './equipment-image-coverage-batch6.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH7_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH7_REVIEWED_AT = '2026-08-16';

// Batch 7 consolide les modèles dont la référence exacte est déjà vérifiée
// dans le catalogue 2M et pour lesquels une page produit constructeur expose
// directement plusieurs vues fiables. Les anciennes images secondaires restent
// conservées comme candidats ; elles ne remplacent jamais une décision Admin.
const TRUSTED_IMAGE_HOSTS = Object.freeze({
  'www.leader.co.jp':'manufacturer-direct',
  'k.kramerav.com':'manufacturer-direct'
});

const VERIFIED_OFFICIAL_MEDIA = Object.freeze([
  {
    id:'kb-leader-lv5300a',
    sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
    images:[
      {
        url:'https://www.leader.co.jp/uploads/2021/08/lv5300a_01main_pc.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-primary',
        alt:'Leader LV5300A — vue avant constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2021/08/lv5300a_02main_pc.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-secondary',
        alt:'Leader LV5300A — seconde vue constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2018/12/LV5300_rear_panel-1.jpg',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact-product-page', view:'rear',
        alt:'Leader LV5300A — panneau arrière publié sur la page constructeur'
      }
    ]
  },
  {
    id:'kb-leader-lv5350',
    sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
    images:[
      {
        url:'https://www.leader.co.jp/uploads/2018/05/LV5350_01main_2_1.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-primary',
        alt:'Leader LV5350 — vue avant constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2018/05/LV5350_01main_2_2.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-secondary',
        alt:'Leader LV5350 — seconde vue constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2022/03/lv5350_rear1.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'rear',
        alt:'Leader LV5350 — panneau arrière constructeur'
      }
    ]
  },
  {
    id:'kb-leader-lt4448',
    sourcePage:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
    images:[
      {
        url:'https://www.leader.co.jp/uploads/2018/03/12_LT4448_01_main_1.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-primary',
        alt:'Leader LT4448 — vue avant constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2018/03/12_LT4448_01_main_2.png',
        sourcePage:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front-secondary',
        alt:'Leader LT4448 — seconde vue constructeur'
      },
      {
        url:'https://www.leader.co.jp/uploads/2018/03/12_LT4448_03_content_2.jpg',
        sourcePage:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'rear',
        alt:'Leader LT4448 — panneau arrière constructeur'
      }
    ]
  },
  {
    id:'kb-kramer-vs81av',
    sourcePage:'https://k.kramerav.com/mobile/model.asp?pid=310',
    images:[
      {
        url:'https://k.kramerav.com/images/products/vs-81av.jpg',
        sourcePage:'https://k.kramerav.com/mobile/model.asp?pid=310',
        sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
        modelMatch:'exact', view:'front',
        alt:'Kramer VS-81AV — vue constructeur exacte'
      }
    ]
  }
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

async function runEquipmentImageCoverageBatch7Core() {
  await db.open();

  const targets = new Map(VERIFIED_OFFICIAL_MEDIA.map(entry => [entry.id, entry]));
  const docs = (await db.getAll('docs')).filter(isCatalog);
  let updated = 0;
  let officialPromoted = 0;
  let officialViewsAdded = 0;
  let adminLocked = 0;

  for (const record of docs) {
    const target = targets.get(String(record.id));
    if (!target) continue;
    if (isAdminLocked(record)) {
      adminLocked += 1;
      continue;
    }

    const verified = target.images.filter(trustedImage);
    if (!verified.length) continue;
    const before = asArray(record.officialImages).length;
    const mergedOfficial = mergeImages(record.officialImages, verified);
    const hadOfficial = Boolean(record.officialImage?.url);
    const next = {
      ...record,
      officialImage:hadOfficial ? record.officialImage : verified[0],
      officialImages:mergedOfficial,
      imageResearch:{
        ...(record.imageResearch || {}),
        sourcePage:target.sourcePage,
        sourceType:'manufacturer',
        sourceTrust:'manufacturer-direct',
        status:'official-image-verified',
        modelRequired:false,
        reviewedAt:EQUIPMENT_IMAGE_BATCH7_REVIEWED_AT
      },
      imageCoverageBatch7Version:EQUIPMENT_IMAGE_BATCH7_VERSION
    };

    if (!hadOfficial) officialPromoted += 1;
    officialViewsAdded += Math.max(0, mergedOfficial.length - before);
    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH7_VERSION,
    catalog:docs.length,
    targets:VERIFIED_OFFICIAL_MEDIA.length,
    updated,
    officialPromoted,
    officialViewsAdded,
    adminLocked
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 * Même principe que le lot 2 : la dépendance est résolue avant d'entrer dans la file.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch7() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch6();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch7Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch7 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH7_VERSION,
    ensure:ensureEquipmentImageCoverageBatch7,
    official:VERIFIED_OFFICIAL_MEDIA,
    trustPolicy:TRUSTED_IMAGE_HOSTS
  });
  await ensureEquipmentImageCoverageBatch7().catch(error => console.warn('Image coverage batch 7 indisponible', error));
}
