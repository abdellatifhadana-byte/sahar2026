import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch3 } from './equipment-image-coverage-batch3.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH4_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH4_REVIEWED_AT = '2026-08-16';

const TRUSTED_IMAGE_HOSTS = Object.freeze({
  'www.rossvideo.com':'manufacturer-direct',
  'd26ddnfpy9hzf8.cloudfront.net':'manufacturer-cdn',
  'cobaltdigital.com':'manufacturer-direct',
  'evs.com':'manufacturer-direct',
  'cdn-images.av-iq.com':'trusted-technical-catalog'
});

const VERIFIED_OFFICIAL_IMAGES = Object.freeze([
  {
    id:'kb-ross-sra8802',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/05/SRA-8602-1024x686.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/sra-8802/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video SRA-8802 — visuel constructeur fourni sur la page produit'
    }
  },
  {
    id:'kb-ross-sfs8622a',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/05/SFS-8622-A.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/timing-synchronization/sfs-8622-a/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video SFS-8622-A — visuel constructeur'
    }
  },
  {
    id:'kb-ross-dra8804',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/05/DRA-8804-1-1024x816.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/dra-8804/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video DRA-8804 — visuel constructeur'
    }
  },
  {
    id:'kb-ross-uda8705a',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/05/UDA-8705A-1024x926.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/uda-8705a/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video UDA-8705A — visuel constructeur'
    }
  },
  {
    id:'kb-ross-ada8405c',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2018/03/ADA-8405-C-1024x1022.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/ada-8405-c/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video ADA-8405-C — visuel constructeur'
    }
  },
  {
    id:'kb-ross-aap8644',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2018/10/AAP-8644.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/processing-monitoring/aap-8644/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video AAP-8644 — visuel constructeur'
    }
  },
  {
    id:'kb-ross-hdc8223as',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/09/HDC-8223A-S-1024x765.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/conversion/hdc-8223a-s/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video HDC-8223A-S — visuel constructeur'
    }
  },
  {
    id:'kb-ross-dmx82594c',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2016/05/DMX-8259-4C_DMX-82259-8C.jpg',
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/audio-embedding/dmx-8259-4c-8c/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Ross Video DMX-8259-4C / 8C — visuel constructeur'
    }
  },
  {
    id:'kb-aja-ogfsmini',
    image:{
      url:'https://d26ddnfpy9hzf8.cloudfront.net/aja-web/public/assets/products/img/530/open_fs_mini_3600.png',
      sourcePage:'https://www.aja.com/products/og-fs-mini',
      sourceType:'manufacturer', sourceTrust:'manufacturer-cdn', verificationStatus:'verified',
      alt:'AJA OG-FS-Mini — visuel constructeur'
    }
  },
  {
    id:'kb-cobalt-9940aco',
    image:{
      url:'https://cobaltdigital.com/wp-content/uploads/2025/12/9940-ACO-RF.png',
      sourcePage:'https://cobaltdigital.com/products/9940-aco/',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'verified',
      alt:'Cobalt Digital 9940-ACO — visuel constructeur'
    }
  }
]);

const TRUSTED_CANDIDATE_IMAGES = Object.freeze([
  {
    id:'kb-axon-sfr08',
    image:{
      url:'https://evs.com/sites/default/files/styles/convert_webp/public/2021-05/2021-04-EVS-07795-light.png.jpg?itok=aZ4-M1lW',
      sourcePage:'https://evs.com/products/real-time-media-processing/synapse',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'candidate',
      alt:'EVS Synapse SFR08/SFR18 — visuel constructeur de famille, confirmer le châssis SFR08 exact'
    }
  },
  {
    id:'kb-decimator-dmon12s',
    image:{
      url:'https://cdn-images.av-iq.com/products/enlarge/stacks_image_19641.png',
      sourcePage:'https://www.av-iq.com/avcat/ctl1642/index.cfm?manufacturer=decimator-design&product=dmon-12s',
      sourceType:'secondary-source', sourceTrust:'trusted-technical-catalog', verificationStatus:'candidate',
      alt:'Decimator Design DMON-12S — visuel AV-iQ à vérifier avant promotion constructeur'
    }
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

async function runEquipmentImageCoverageBatch4Core() {
  await db.open();

  const officialEntries = VERIFIED_OFFICIAL_IMAGES.filter(entry => trustedImage(entry.image));
  const candidateEntries = TRUSTED_CANDIDATE_IMAGES.filter(entry => trustedImage(entry.image));
  const official = new Map(officialEntries.map(entry => [entry.id, entry.image]));
  const candidates = new Map(candidateEntries.map(entry => [entry.id, entry.image]));
  const docs = (await db.getAll('docs')).filter(isCatalog);

  let updated = 0;
  let officialPromoted = 0;
  let candidatesAdded = 0;
  let adminLocked = 0;

  for (const record of docs) {
    if (isAdminLocked(record)) {
      adminLocked += 1;
      continue;
    }

    const officialImage = official.get(String(record.id));
    const candidateImage = candidates.get(String(record.id));
    let next = { ...record, imageCoverageBatch4Version:EQUIPMENT_IMAGE_BATCH4_VERSION };

    if (officialImage) {
      const hadOfficial = Boolean(record.officialImage?.url);
      next = {
        ...next,
        officialImage:hadOfficial ? record.officialImage : officialImage,
        officialImages:mergeImages(record.officialImages, [officialImage]),
        imageResearch:{
          ...(record.imageResearch || {}),
          sourcePage:officialImage.sourcePage,
          sourceType:'manufacturer',
          sourceTrust:officialImage.sourceTrust,
          status:'official-image-verified',
          modelRequired:false,
          reviewedAt:EQUIPMENT_IMAGE_BATCH4_REVIEWED_AT
        }
      };
      if (!hadOfficial) officialPromoted += 1;
    }

    if (candidateImage) {
      const before = asArray(record.candidateImages).length;
      const merged = mergeImages(record.candidateImages, [candidateImage]);
      next = {
        ...next,
        candidateImages:merged,
        imageResearch:{
          ...(next.imageResearch || record.imageResearch || {}),
          candidateSourceTrust:candidateImage.sourceTrust,
          candidateReviewedAt:EQUIPMENT_IMAGE_BATCH4_REVIEWED_AT
        }
      };
      if (merged.length > before) candidatesAdded += 1;
    }

    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH4_VERSION,
    catalog:docs.length,
    updated,
    officialPromoted,
    candidatesAdded,
    adminLocked,
    trustedOfficialTargets:officialEntries.length,
    trustedCandidateTargets:candidateEntries.length
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 * Même principe que le lot 2 : la dépendance est résolue avant d'entrer dans la file.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch4() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch3();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch4Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch4 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH4_VERSION,
    ensure:ensureEquipmentImageCoverageBatch4,
    official:VERIFIED_OFFICIAL_IMAGES,
    candidates:TRUSTED_CANDIDATE_IMAGES,
    trustedHosts:TRUSTED_IMAGE_HOSTS
  });
  await ensureEquipmentImageCoverageBatch4().catch(error => console.warn('Image coverage batch 4 indisponible', error));
}
