import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch7 } from './equipment-image-coverage-batch7.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH8_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH8_REVIEWED_AT = '2026-08-16';

// Batch 8 reste volontairement conservateur : une image n'est promue que si
// le modèle catalogue est exact et l'asset est servi directement par le
// constructeur. Pour les autres modèles, on améliore la provenance sans
// transformer un ancien candidat en image officielle.
const TRUSTED_IMAGE_HOSTS = Object.freeze({
  'www.cisco.com':'manufacturer-direct'
});

const VERIFIED_OFFICIAL_IMAGES = Object.freeze([
  {
    id:'kb-cisco-c9300x12y',
    image:{
      url:'https://www.cisco.com/c/dam/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-architecture-cte-en.docx/_jcr_content/renditions/nb-06-cat9300-architecture-cte-en_7.png',
      sourcePage:'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-architecture-cte-en.html',
      sourceType:'manufacturer',
      sourceTrust:'manufacturer-direct',
      verificationStatus:'verified',
      modelMatch:'exact',
      requiresFieldConfirmation:false,
      view:'front',
      matchNote:'Figure constructeur Cisco explicitement légendée C9300X-12Y dans le white paper d’architecture Catalyst 9300.',
      alt:'Cisco Catalyst C9300X-12Y — vue constructeur officielle'
    }
  }
]);

const SOURCE_PAGE_UPDATES = Object.freeze([
  {
    id:'kb-cisco-c9300x12y',
    sourcePage:'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-architecture-cte-en.html',
    sourceType:'manufacturer',
    sourceTrust:'manufacturer-direct',
    status:'official-image-verified'
  },
  {
    id:'kb-decimator-dmonquad',
    sourcePage:'https://decimator.com/Products/MultiViewers/DMON-QUAD%20MultiViewer/DMON-QUAD.html',
    sourceType:'manufacturer',
    status:'source-page-known',
    note:'La page constructeur confirme exactement DMON-QUAD et ses 4 entrées SDI, sorties SDI/HDMI et fonctions multiviewer. Le visuel direct constructeur n’est pas promu tant qu’une URL d’asset stable n’est pas validée.'
  },
  {
    id:'kb-fortigate40f',
    sourcePage:'https://docs.fortinet.com/document/fortigate/hardware/fortigate-fortiwifi-40f-3g4g-60f-series',
    sourceType:'manufacturer',
    status:'source-page-known',
    note:'Documentation matérielle Fortinet officielle identifiée pour la famille 40F. Le candidat existant reste séparé tant qu’un asset constructeur direct du FG-40F exact n’est pas validé.'
  },
  {
    id:'kb-imagine-platinum-vx',
    sourcePage:'https://imaginecommunications.com/make-tv/products/production-infrastructure/platinum-routers/',
    sourceType:'manufacturer',
    status:'source-page-known',
    note:'Imagine Communications confirme Platinum VX comme routeur vidéo small-to-midsize. La taille de châssis installée à 2M reste une donnée terrain distincte.'
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

async function runEquipmentImageCoverageBatch8Core() {
  await db.open();

  const docs = (await db.getAll('docs')).filter(isCatalog);
  const official = new Map(VERIFIED_OFFICIAL_IMAGES.filter(entry => trustedImage(entry.image)).map(entry => [entry.id, entry.image]));
  const sources = new Map(SOURCE_PAGE_UPDATES.map(entry => [entry.id, entry]));
  let updated = 0;
  let officialPromoted = 0;
  let sourcePagesUpdated = 0;
  let adminLocked = 0;

  for (const record of docs) {
    if (isAdminLocked(record)) {
      adminLocked += 1;
      continue;
    }

    const id = String(record.id || '');
    const officialImage = official.get(id);
    const source = sources.get(id);
    if (!officialImage && !source && Number(record.imageCoverageBatch8Version || 0) >= EQUIPMENT_IMAGE_BATCH8_VERSION) continue;

    let next = { ...record, imageCoverageBatch8Version:EQUIPMENT_IMAGE_BATCH8_VERSION };
    if (officialImage) {
      const hadOfficial = Boolean(record.officialImage?.url);
      const mergedOfficial = mergeImages(record.officialImages, [officialImage]);
      next = {
        ...next,
        officialImage:hadOfficial ? record.officialImage : officialImage,
        officialImages:mergedOfficial,
        imageResearch:{
          ...(record.imageResearch || {}),
          sourcePage:officialImage.sourcePage,
          sourceType:'manufacturer',
          sourceTrust:officialImage.sourceTrust,
          status:'official-image-verified',
          modelRequired:false,
          reviewedAt:EQUIPMENT_IMAGE_BATCH8_REVIEWED_AT
        }
      };
      if (!hadOfficial) officialPromoted += 1;
    }

    if (source) {
      const before = JSON.stringify(next.imageResearch || {});
      next = {
        ...next,
        imageResearch:{
          ...(next.imageResearch || record.imageResearch || {}),
          sourcePage:source.sourcePage,
          sourceType:source.sourceType,
          ...(source.sourceTrust ? { sourceTrust:source.sourceTrust } : {}),
          status:officialImage ? 'official-image-verified' : source.status,
          sourceNote:source.note || next.imageResearch?.sourceNote || '',
          reviewedAt:EQUIPMENT_IMAGE_BATCH8_REVIEWED_AT
        }
      };
      if (JSON.stringify(next.imageResearch) !== before) sourcePagesUpdated += 1;
    }

    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH8_VERSION,
    catalog:docs.length,
    updated,
    officialPromoted,
    sourcePagesUpdated,
    adminLocked,
    officialTargets:VERIFIED_OFFICIAL_IMAGES.length,
    sourceTargets:SOURCE_PAGE_UPDATES.length
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * `equipment-media-linkage.js` et `grille-centrale-knowledge.js` importent et
 * rappellent aussi ce module, en plus de son propre déclenchement ci-dessous : la
 * dépendance (lot 7) est résolue avant d'entrer dans la file partagée.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch8() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch7();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch8Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch8 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH8_VERSION,
    ensure:ensureEquipmentImageCoverageBatch8,
    official:VERIFIED_OFFICIAL_IMAGES,
    sources:SOURCE_PAGE_UPDATES
  });
  await ensureEquipmentImageCoverageBatch8().catch(error => console.warn('Image coverage batch 8 indisponible', error));
}
