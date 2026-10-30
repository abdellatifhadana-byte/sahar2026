import { db } from './db.js';
import { ensureEquipmentImageSeed } from './equipment-image-seed.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH2_VERSION = 1;

const EXACT_SOURCE_PATCHES = Object.freeze([
  ['kb-ross-ultritouch','https://www.rossvideo.com/products/routing-systems/ultritouch/','Ross Video'],
  ['kb-ross-ada8405c','https://www.rossvideo.com/products/signal-processing/opengear/distribution/ada-8405-c/','Ross Video'],
  ['kb-ross-aap8644','https://www.rossvideo.com/products/signal-processing/opengear/processing-monitoring/aap-8644/','Ross Video'],
  ['kb-ross-dmx82594c','https://www.rossvideo.com/products/signal-processing/opengear/audio-embedding/dmx-8259-4c-8c/','Ross Video'],
  ['kb-ross-hdc8223as','https://www.rossvideo.com/products/signal-processing/opengear/conversion/hdc-8223a-s/','Ross Video'],
  ['kb-kaleido-solo','https://www.grassvalley.com/products/multiviewers-hardware/kaleido-solo/','Grass Valley'],
  ['kb-decimator-dmon12s','https://decimator.com/Products/MultiViewers/DMON-12S%20MultiViewer/DMON-12S.html','Decimator Design'],
  ['kb-fortigate40f','https://www.fortinet.com/products/next-generation-firewall/fortigate-40f-series','Fortinet'],
  ['kb-dell-r350','https://www.dell.com/support/home/fr-ma/product-support/product/poweredge-r350/overview','Dell'],
  ['kb-dell-r550','https://www.dell.com/support/home/fr-ma/product-support/product/poweredge-r550/overview','Dell'],
  ['kb-cobalt-9940aco','https://cobaltdigital.com/products/9940-aco/','Cobalt Digital'],
  ['kb-imagine-platinum-vx','https://imaginecommunications.com/make-tv/products/production-infrastructure/platinum-routers/','Imagine Communications'],
  ['kb-tsl-tallyman','https://www.tslproducts.com/products/control-solutions/tallyman-control-system-overview/','TSL Products'],
  ['kb-orban2200','https://www.orban.com/timeline','Orban'],
  ['kb-raritan-kvm','https://www.raritan.com/products/kvm-serial/rackmount-console-drawers','Raritan']
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

const CATALOG_KIND = record => record?.kind === 'equipment_catalog' || record?.targetType === 'equipment_catalog';

export const EQUIPMENT_IMAGE_BATCH2_REVIEWED_AT = '2026-08-15';

function isAdminLocked(record) {
  return record?.imageResearch?.origin === 'admin' || record?.imageResearch?.locked === true;
}

/*
 * UNE REVUE PLUS RÉCENTE NE SE RAMÈNE PAS EN ARRIÈRE (#98).
 *
 * Les lots s'enchaînent dans l'ordre 2 → 8, chacun attendant le précédent : un lot
 * ultérieur porte donc, par construction, une revue plus récente que celle-ci. Ce lot
 * réaffirmait pourtant SES valeurs du 2026-08-15 à chaque passage — `reviewedAt`, mais
 * aussi la page source des fiches Dell, que le lot 6 avait depuis remplacée par l'URL
 * `product-details` canonique. Les deux lots se réécrivaient donc l'un l'autre sans fin
 * dès que les conflits de révision ont cessé de le masquer.
 *
 * Ce lot ne repose plus son `imageResearch` sur une fiche déjà revue plus tard ; il
 * continue de poser son propre marqueur de version, qui ne dépend d'aucun autre lot.
 */
function revuePlusRecente(record) {
  const revue = record?.imageResearch || {};
  // Les lots ultérieurs datent leur passage soit par `reviewedAt`, soit — pour une
  // simple mise à jour de page source (lot 6) — par `sourceReviewedAt`.
  return String(revue.reviewedAt || '') > EQUIPMENT_IMAGE_BATCH2_REVIEWED_AT
    || String(revue.sourceReviewedAt || '') > EQUIPMENT_IMAGE_BATCH2_REVIEWED_AT;
}

async function runEquipmentImageCoverageBatch2Core() {
  await db.open();
  const docs = (await db.getAll('docs')).filter(CATALOG_KIND);
  const exact = new Map(EXACT_SOURCE_PATCHES.map(([id,sourcePage,manufacturer]) => [id,{sourcePage,manufacturer}]));
  const modelRequired = new Set(MODEL_REQUIRED_IDS);
  let updated = 0;
  let exactCovered = 0;
  let awaitingModel = 0;

  for (const record of docs) {
    if (isAdminLocked(record)) continue;
    let next = record;
    const dejaRevuPlusTard = revuePlusRecente(record);
    const exactPatch = dejaRevuPlusTard ? null : exact.get(String(record.id));
    if (exactPatch) {
      exactCovered += 1;
      next = {
        ...record,
        imageCoverageBatch2Version:EQUIPMENT_IMAGE_BATCH2_VERSION,
        imageResearch:{
          ...(record.imageResearch || {}),
          sourcePage:exactPatch.sourcePage,
          sourceType:'manufacturer',
          manufacturer:exactPatch.manufacturer,
          status:record.officialImage?.url ? 'official-image-verified' : 'source-page-known',
          modelRequired:false,
          reviewedAt:EQUIPMENT_IMAGE_BATCH2_REVIEWED_AT
        }
      };
    } else if (!dejaRevuPlusTard && modelRequired.has(String(record.id))) {
      awaitingModel += 1;
      next = {
        ...record,
        imageCoverageBatch2Version:EQUIPMENT_IMAGE_BATCH2_VERSION,
        imageResearch:{
          ...(record.imageResearch || {}),
          status:'model-required',
          modelRequired:true,
          reason:'Référence catalogue volontairement générique : relever le modèle/SKU exact avant d’associer une photo produit.',
          reviewedAt:EQUIPMENT_IMAGE_BATCH2_REVIEWED_AT
        }
      };
    } else if (Number(record.imageCoverageBatch2Version || 0) < EQUIPMENT_IMAGE_BATCH2_VERSION) {
      next = { ...record, imageCoverageBatch2Version:EQUIPMENT_IMAGE_BATCH2_VERSION };
    }

    if (JSON.stringify(next) !== JSON.stringify(record)) {
      await db.save('docs', next);
      updated += 1;
    }
  }

  return { version:EQUIPMENT_IMAGE_BATCH2_VERSION, catalog:docs.length, updated, exactCovered, awaitingModel };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * La dépendance (`ensureEquipmentImageSeed`) est attendue AVANT d'entrer dans la
 * file partagée, jamais depuis l'intérieur d'un tour : elle a sa propre garde et
 * acquiert elle-même la file en temps voulu. `equipment-image-coverage-batch3.js`
 * rappelle ce module en plus de son propre déclenchement ci-dessous.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch2() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageSeed();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch2Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch2 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH2_VERSION,
    ensure:ensureEquipmentImageCoverageBatch2,
    exactSources:EXACT_SOURCE_PATCHES,
    modelRequired:MODEL_REQUIRED_IDS
  });
  await ensureEquipmentImageCoverageBatch2().catch(error => console.warn('Image coverage batch 2 indisponible', error));
}
