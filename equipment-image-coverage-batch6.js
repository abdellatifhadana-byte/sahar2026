import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch5 } from './equipment-image-coverage-batch5.js';
import { ensureGapCatalogSeed } from './equipment-catalog-gap-seed.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH6_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH6_REVIEWED_AT = '2026-08-16';

// Batch 6 couvre les références IT / monitoring legacy et les nouvelles fiches
// issues du gap d'inventaire. Les photos de configurations Dell et les anciens
// équipements dont la variante terrain n'est pas encore lue restent des
// candidats, même lorsque l'image provient directement du constructeur.
const TRUSTED_IMAGE_HOSTS = Object.freeze({
  'supportkb.dell.com':'manufacturer-direct',
  'dl.dell.com':'manufacturer-cdn',
  'c1.neweggimages.com':'trusted-retailer',
  'rvb-img.reverb.com':'trusted-marketplace-reference',
  'studiocare.com':'trusted-broadcast-reseller',
  'www.usbgear.com':'trusted-technical-reseller'
});

const SOURCE_PAGE_UPDATES = Object.freeze([
  { id:'kb-dell-precision3930r', sourcePage:'https://www.dell.com/support/kbdoc/en-us/000144106/precision-3930-rack-workstation-visual-guide-to-your-computer', sourceType:'manufacturer' },
  { id:'kb-dell-r350', sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r350/overview', sourceType:'manufacturer' },
  { id:'kb-dell-r450', sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r450/overview', sourceType:'manufacturer' },
  { id:'kb-dell-r550', sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r550/overview', sourceType:'manufacturer' },
  { id:'kb-dell-r750', sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r750/overview', sourceType:'manufacturer' },
  { id:'kb-hp-lp2475w', sourcePage:'https://support.hp.com/us-en/drivers/selfservice/hp-lp2475w-24-inch-widescreen-lcd-monitor/3648442', sourceType:'manufacturer' },
  { id:'kb-orban2200', sourcePage:'https://www.orban.com/timeline', sourceType:'manufacturer' },
  { id:'kb-titan-usb8comirm', sourcePage:'https://www.titan.tw/product/usb-8comi-rm/', sourceType:'manufacturer' }
]);

const TRUSTED_CANDIDATE_IMAGES = Object.freeze([
  {
    id:'kb-dell-precision3930r',
    image:{
      url:'https://supportkb.dell.com/img/ka0Do0000002BFIIA2/ka0Do0000002BFIIA2_en_US_2.jpeg',
      sourcePage:'https://www.dell.com/support/kbdoc/en-us/000144106/precision-3930-rack-workstation-visual-guide-to-your-computer',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'candidate',
      modelMatch:'probable-exact-front', requiresFieldConfirmation:true,
      view:'front', matchNote:'Vue avant officielle Dell du Precision 3930 Rack. L’inventaire 2M indique DELL 3930/R3930 : confirmer le Service Tag avant promotion en image officielle.',
      alt:'Dell Precision 3930 Rack — vue avant officielle Dell, Service Tag 2M à confirmer'
    }
  },
  {
    id:'kb-dell-precision3930r',
    image:{
      url:'https://supportkb.dell.com/img/ka0Do0000002BFIIA2/ka0Do0000002BFIIA2_en_US_3.jpeg',
      sourcePage:'https://www.dell.com/support/kbdoc/en-us/000144106/precision-3930-rack-workstation-visual-guide-to-your-computer',
      sourceType:'manufacturer', sourceTrust:'manufacturer-direct', verificationStatus:'candidate',
      modelMatch:'probable-exact-rear', requiresFieldConfirmation:true,
      view:'rear', matchNote:'Vue arrière officielle Dell du Precision 3930 Rack. Conserver comme candidat tant que le Service Tag de l’unité 2M n’est pas confirmé.',
      alt:'Dell Precision 3930 Rack — vue arrière officielle Dell, Service Tag 2M à confirmer'
    }
  },
  {
    id:'kb-dell-r350',
    image:{
      url:'https://dl.dell.com/content/guides/public/Html/r350_ism_pub/images/GUID-6F229A2D-FA13-4B33-BF6B-45AFD986DE0F-low.jpg',
      sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r350/overview',
      sourceType:'manufacturer', sourceTrust:'manufacturer-cdn', verificationStatus:'candidate',
      modelMatch:'exact-model-config-example', requiresFieldConfirmation:true,
      view:'front', matchNote:'Vue constructeur du PowerEdge R350 en configuration 4 × 3,5 pouces. Le modèle est vérifié dans l’inventaire, mais la configuration de façade de l’unité 2M doit être confirmée.',
      alt:'Dell PowerEdge R350 — vue avant constructeur, configuration de disques à confirmer'
    }
  },
  {
    id:'kb-dell-r450',
    image:{
      url:'https://dl.dell.com/content/guides/public/Html/per450_ism_pub/images/GUID-E24480D0-7E88-4056-BB75-8A517FEAE910-low.jpg',
      sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r450/overview',
      sourceType:'manufacturer', sourceTrust:'manufacturer-cdn', verificationStatus:'candidate',
      modelMatch:'exact-model-config-example', requiresFieldConfirmation:true,
      view:'front', matchNote:'Vue constructeur du PowerEdge R450. La configuration de baies/disques visible doit être comparée à l’unité 2M avant promotion.',
      alt:'Dell PowerEdge R450 — vue avant constructeur, configuration terrain à confirmer'
    }
  },
  {
    id:'kb-dell-r750',
    image:{
      url:'https://dl.dell.com/content/guides/public/Html/per750_ism_pub/images/GUID-CC4D1B8C-4D80-4084-8337-E8414416E155-low.jpg',
      sourcePage:'https://www.dell.com/support/product-details/en-us/product/poweredge-r750/overview',
      sourceType:'manufacturer', sourceTrust:'manufacturer-cdn', verificationStatus:'candidate',
      modelMatch:'exact-model-config-example', requiresFieldConfirmation:true,
      view:'front', matchNote:'Vue constructeur du PowerEdge R750 en configuration 12 × 3,5 pouces. L’unité 2M doit être comparée visuellement avant promotion.',
      alt:'Dell PowerEdge R750 — vue avant constructeur, configuration de façade à confirmer'
    }
  },
  {
    id:'kb-hp-lp2475w',
    image:{
      url:'https://c1.neweggimages.com/productimage/nb640/24-176-104-02.jpg',
      sourcePage:'https://www.newegg.com/hp-lp2475w-24-wuxga/p/N82E16824176104',
      sourceType:'secondary-source', sourceTrust:'trusted-retailer', verificationStatus:'candidate',
      modelMatch:'exact', requiresFieldConfirmation:false,
      view:'front', matchNote:'Le modèle HP LP2475w est déjà lisible sur la photo terrain 2M ; ce visuel secondaire exact sert de référence produit sans remplacer la photo réelle.',
      alt:'HP LP2475w — visuel exact du modèle via revendeur'
    }
  },
  {
    id:'kb-orban2200',
    image:{
      url:'https://rvb-img.reverb.com/i/s--x58eHLJp--/quality%3Dmedium-low%2Cheight%3D800%2Cwidth%3D800%2Cfit%3Dcontain/qyc5fu3srjdya6v4nh0d.jpg',
      sourcePage:'https://reverb.com/item/81209556-orban-optimod-fm-2200-digital-audio-processor',
      sourceType:'secondary-source', sourceTrust:'trusted-marketplace-reference', verificationStatus:'candidate',
      modelMatch:'2200-family-variant', requiresFieldConfirmation:true,
      view:'front', matchNote:'Visuel d’un Optimod-FM 2200-D/U. L’inventaire 2M indique Orban 2200 sans suffixe : relever la variante exacte sur la face arrière avant promotion.',
      alt:'Orban Optimod-FM 2200-D/U — variante 2200 candidate à confirmer sur l’unité 2M'
    }
  },
  {
    id:'kb-titan-usb8comirm',
    image:{
      url:'https://www.usbgear.com/media/catalog/product/cache/7d57300ba967856f1631f85f9a0f3292/u/s/usbg-8comi-rm-8port-serial-adapter1x800_2nd.jpg',
      sourcePage:'https://www.usbgear.com/usb-8comi-rm.html',
      sourceType:'secondary-source', sourceTrust:'trusted-technical-reseller', verificationStatus:'candidate',
      modelMatch:'exact-model-number-oem-example', requiresFieldConfirmation:true,
      view:'front', matchNote:'Le revendeur montre un USB-8COMi-RM aux mêmes fonctions et au même numéro de modèle, mais sous marque commerciale Coolgear. La source constructeur TITAN reste la référence ; comparer la façade 2M avant promotion.',
      alt:'USB-8COMi-RM — exemple visuel exact du numéro de modèle, branding terrain TITAN à confirmer'
    }
  },
  {
    id:'kb-wohler-amp1a-lp',
    image:{
      url:'https://studiocare.com/cdn/shop/products/SWOHAMP1ALPU-1_700x700.jpg?v=1671464270',
      sourcePage:'https://studiocare.com/products/wohler-amp1a-lp-used',
      sourceType:'secondary-source', sourceTrust:'trusted-broadcast-reseller', verificationStatus:'candidate',
      modelMatch:'exact-name', requiresFieldConfirmation:true,
      view:'front', matchNote:'Le revendeur broadcast identifie explicitement le Wohler AMP1A-LP. La variante exacte de l’unité 2M doit encore être lue sur l’étiquette.',
      alt:'Wohler AMP1A-LP — visuel exact via revendeur broadcast, étiquette 2M à confirmer'
    }
  },
  {
    id:'kb-wohler-lm30-4',
    image:{
      url:'https://rvb-img.reverb.com/i/s--iQTMaPDg--/quality%3Dmedium-low%2Cheight%3D800%2Cwidth%3D800%2Cfit%3Dcontain/vvoh65usmwo3k6lvcewb.jpg',
      sourcePage:'https://reverb.com/item/85028407-wohler-technologies-lm30-4',
      sourceType:'secondary-source', sourceTrust:'trusted-marketplace-reference', verificationStatus:'candidate',
      modelMatch:'exact-name', requiresFieldConfirmation:true,
      view:'front', matchNote:'Visuel identifié comme Wohler Technologies LM30-4. Confirmer la référence sur l’étiquette de l’unité 2M avant promotion.',
      alt:'Wohler LM30-4 — visuel exact candidat, unité 2M à confirmer'
    }
  },
  {
    id:'kb-wohler-vm2a',
    image:{
      url:'https://rvb-img.reverb.com/image/upload/s--9AchurRz--/f_auto%2Ct_large/v1542126645/djavkirw6fsaarzqs03s.jpg',
      sourcePage:'https://reverb.com/item/16833592-wohler-vm-2a-rack-monitor-w-power-cable',
      sourceType:'secondary-source', sourceTrust:'trusted-marketplace-reference', verificationStatus:'candidate',
      modelMatch:'exact-name', requiresFieldConfirmation:true,
      view:'front', matchNote:'La fiche secondaire identifie explicitement le Wohler VM-2A. Confirmer l’étiquette de l’unité 2M avant promotion.',
      alt:'Wohler VM-2A — visuel exact candidat, unité 2M à confirmer'
    }
  }
]);

const MODEL_REQUIRED_IDS = Object.freeze([
  'kb-viewsonic24','kb-blackbox-kvm-generic','kb-genelec-monitor','kb-iiyama43','kb-maudio-device','kb-konvision24','kb-konvision21','kb-elgato-streamdeck','kb-cisco-110series5',
  'kb-gap-monitor-it24','kb-gap-grid72-panel32','kb-gap-grid72-panel48','kb-swit-monitor21-family','kb-gap-quad-av-matrix','kb-gap-sdi-hdmi-converter','kb-gap-gpi-box','kb-gap-sescom-vu','kb-gap-selector-panel','kb-gap-changeover','kb-gap-splitter-automation','kb-gap-fibre-mm-sfp','kb-gap-streaming-speaker'
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

function groupCandidates(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.id)) groups.set(entry.id, []);
    groups.get(entry.id).push(entry.image);
  }
  return groups;
}

async function runEquipmentImageCoverageBatch6Core() {
  await db.open();

  const validCandidates = TRUSTED_CANDIDATE_IMAGES.filter(entry => trustedImage(entry.image));
  const candidates = groupCandidates(validCandidates);
  const sources = new Map(SOURCE_PAGE_UPDATES.map(entry => [entry.id, entry]));
  const protectedGenericIds = new Set(MODEL_REQUIRED_IDS);
  const docs = (await db.getAll('docs')).filter(isCatalog);

  let updated = 0;
  let candidatesAdded = 0;
  let sourcePagesUpdated = 0;
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
      if (Number(record.imageCoverageBatch6Version || 0) < EQUIPMENT_IMAGE_BATCH6_VERSION) {
        await db.save('docs', { ...record, imageCoverageBatch6Version:EQUIPMENT_IMAGE_BATCH6_VERSION });
        updated += 1;
      }
      continue;
    }

    const source = sources.get(id);
    const incomingCandidates = candidates.get(id) || [];
    let next = { ...record, imageCoverageBatch6Version:EQUIPMENT_IMAGE_BATCH6_VERSION };

    if (source) {
      const previousSource = String(record.imageResearch?.sourcePage || '');
      next = {
        ...next,
        imageResearch:{
          ...(record.imageResearch || {}),
          sourcePage:source.sourcePage,
          sourceType:source.sourceType,
          sourceReviewedAt:EQUIPMENT_IMAGE_BATCH6_REVIEWED_AT,
          status:record.officialImage?.url ? 'official-image-verified' : (record.imageResearch?.status === 'model-required' ? 'model-required' : 'source-page-known')
        }
      };
      if (previousSource !== source.sourcePage) sourcePagesUpdated += 1;
    }

    if (incomingCandidates.length) {
      const before = asArray(record.candidateImages).length;
      const merged = mergeImages(record.candidateImages, incomingCandidates);
      const requiresFieldConfirmation = incomingCandidates.some(image => image.requiresFieldConfirmation === true);
      next = {
        ...next,
        candidateImages:merged,
        imageResearch:{
          ...(next.imageResearch || record.imageResearch || {}),
          candidateSourceTrust:[...new Set(incomingCandidates.map(image => image.sourceTrust))].join(','),
          candidateModelMatch:[...new Set(incomingCandidates.map(image => image.modelMatch))].join(','),
          candidateRequiresFieldConfirmation:requiresFieldConfirmation,
          candidateMatchNote:incomingCandidates.map(image => image.matchNote).filter(Boolean).join(' | '),
          candidateReviewedAt:EQUIPMENT_IMAGE_BATCH6_REVIEWED_AT
        }
      };
      candidatesAdded += Math.max(0, merged.length - before);
    }

    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH6_VERSION,
    catalog:docs.length,
    updated,
    candidatesAdded,
    sourcePagesUpdated,
    adminLocked,
    genericProtected,
    trustedCandidateAssets:validCandidates.length,
    candidateTargets:candidates.size
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * Batch 6 cible notamment TITAN/Wohler ajoutés par le catalogue gap : les deux
 * dépendances (lot 5, puis le seed gap qui crée ces fiches) sont résolues avant
 * d'entrer dans la file, jamais depuis l'intérieur d'un tour.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch6() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch5();
    await ensureGapCatalogSeed();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch6Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch6 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH6_VERSION,
    ensure:ensureEquipmentImageCoverageBatch6,
    candidates:TRUSTED_CANDIDATE_IMAGES,
    sourcePages:SOURCE_PAGE_UPDATES,
    trustedHosts:TRUSTED_IMAGE_HOSTS,
    modelRequired:MODEL_REQUIRED_IDS
  });
  await ensureEquipmentImageCoverageBatch6().catch(error => console.warn('Image coverage batch 6 indisponible', error));
}
