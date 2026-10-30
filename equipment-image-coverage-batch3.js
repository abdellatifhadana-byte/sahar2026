import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch2 } from './equipment-image-coverage-batch2.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_BATCH3_VERSION = 1;
export const EQUIPMENT_IMAGE_BATCH3_REVIEWED_AT = '2026-08-16';

// Une image n'est promue en « constructeur » que lorsque l'asset est servi
// directement par le domaine du fabricant et que la page produit officielle
// correspond au modèle catalogue. Les autres visuels restent des candidats
// explicitement séparés des photos terrain 2M et des images constructeur.
const VERIFIED_OFFICIAL_IMAGES = Object.freeze([
  {
    id:'kb-ross-opengear-ogx',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2018/04/oGx-Home.jpg',
      sourcePage:'https://www.rossvideo.com/infrastructure/opengear-modular/ogx-platform/',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Ross Video oGx — vue constructeur'
    }
  },
  {
    id:'kb-ross-rcp-me',
    image:{
      url:'https://www.rossvideo.com/wp-content/uploads/2018/06/RCP-ME.jpg',
      sourcePage:'https://www.rossvideo.com/products/routing-systems/ultricore-broadcast-control-system/',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Ross Video Ultricore RCP-ME — vue constructeur'
    }
  },
  {
    id:'kb-leader-lt4610',
    image:{
      url:'https://www.leader.co.jp/uploads/2020/11/LT4610_02main_sp_1.png',
      sourcePage:'https://www.leader.co.jp/en/products/discontinuation/lt4610/',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Leader LT4610 — vue avant constructeur'
    }
  }
]);

const VERIFIED_CANDIDATE_IMAGES = Object.freeze([
  {
    id:'kb-ross-ultritouch',
    image:{
      url:'https://www.videocraft.com.au/cdn/shop/files/ross-video-video-production-default-title-ross-video-ultritouch-4-ethernet-enabled-4ru-lcd-touchscreen-control-panel-30576649207937.jpg?crop=center&height=1200&v=1744597771&width=1200',
      sourcePage:'https://www.videocraft.com.au/products/ross-video-ultritouch-4-ethernet-enabled-4ru-lcd-touchscreen-control-panel',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Ross Video Ultritouch-4 — visuel externe à vérifier avec la variante terrain'
    }
  },
  {
    id:'kb-ross-mc1-panel16',
    image:{
      url:'https://static-data2.manualslib.com/product-images/40c/2062705/ross-master-control-mc1-panel-16-server.jpg',
      sourcePage:'https://www.manualslib.com/manual/2062705/Ross-Master-Control-Mc1-Panel-16.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Ross MC1-PANEL-16 — visuel externe à vérifier'
    }
  },
  {
    id:'kb-ross-mc1uhd',
    image:{
      url:'https://www.opengear.tv/wp-content/uploads/2019/10/mc1-uhd-r.jpg',
      sourcePage:'https://www.opengear.tv/card/mc1-uhd/',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Ross MC1-UHD — rear module, visuel externe à vérifier'
    }
  },
  {
    id:'kb-ross-rcp-qe18',
    image:{
      url:'https://cdn-images.av-iq.com/products/enlarge/RCP-QE.jpg',
      sourcePage:'https://www.av-iq.com/avcat/ctl1642/index.cfm?manufacturer=ross-video&product=rcp-qe',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Ross RCP-QE — visuel de famille à vérifier pour RCP-QE18'
    }
  },
  {
    id:'kb-kaleido-solo',
    image:{
      url:'https://www.bhphotovideo.com/images/fb/Miranda_KS_910_KS_910_HD_SD_to_HDMI_731775.jpg',
      sourcePage:'https://www.bhphotovideo.com/c/product/731775-REG/Miranda_KS_910_KS_910_HD_SD_to_HDMI.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Miranda / Grass Valley Kaleido-Solo KS-910 — visuel externe à vérifier'
    }
  },
  {
    id:'kb-fortigate40f',
    image:{
      url:'https://itk.co.th/media/com_eshop/products/resized/FG-40F-BDL-950-12-NEW-700x700.png',
      sourcePage:'https://itk.co.th/security-firewall/fortigate-firewall/fg-40f-bdl-950-12',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Fortinet FortiGate 40F — visuel externe à vérifier'
    }
  },
  {
    id:'kb-cisco-c9300x12y',
    image:{
      url:'https://media.router-switch.com/media/catalog/product/cache/b90fceee6a5fa7acd36a04c7b968181c/c/i/cisco-c9300x-12y-a.jpg',
      sourcePage:'https://www.router-switch.com/cisco-c9300x-12y-a.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Cisco Catalyst C9300X-12Y — vue avant candidate'
    }
  },
  {
    id:'kb-leader-lt4448',
    image:{
      url:'https://www.markertek.com/productImage/alternate-1/hi-res/LR-LT4448.JPG',
      sourcePage:'https://www.markertek.com/product/lr-lt4448/leader-lt4448-3g-sdi-hd-sdi-sd-sd-signal-changeover-unit-for-lt4610-lt4611-lt4600a-ltc-dual-ac-power-snmp-browser',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Leader LT4448 — vue avant candidate'
    }
  },
  {
    id:'kb-leader-lv5350',
    image:{
      url:'https://www.bhphotovideo.com/images/images1000x1000/leader_lv5350_lv_5350_waveform_monitor_for_1436201.jpg',
      sourcePage:'https://www.bhphotovideo.com/c/product/1436201-REG/leader_lv5350_lv_5350_waveform_monitor_for.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Leader LV5350 — vue avant candidate'
    }
  },
  {
    id:'kb-hp-z440',
    image:{
      url:'https://image-cdn.ubuy.com/hp-workstation-z440-desktop-pc-intel/400_400_100/6362d3253898c473770faed3.jpg',
      sourcePage:'https://www.ubuy.com.pk/en/product/3MRVNUZY8-hp-workstation-z440-desktop-pc-intel-xeon-e5-1607v4-3-1ghz-quad-core-cpu-8gb-ddr4-256gb-ssd-dvdrw-no-graphics-included-8x-usb-3-0-win-10-pro',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'HP Z440 Workstation — vue avant candidate'
    }
  },
  {
    id:'kb-dell-r350',
    image:{
      url:'https://www.serversdirect.co.uk/Images/WXC1F_3_Supersize.jpg?v=3',
      sourcePage:'https://www.serversdirect.co.uk/p/1885583/dell-poweredge-r350-intel-xeon-e-2314-2.8-ghz-16-gb-ssd-480-gb',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Dell PowerEdge R350 — vue avant candidate'
    }
  },
  {
    id:'kb-dell-r550',
    image:{
      url:'https://www.europc.co.uk/96239-large_default/dell-poweredge-r550-rack-server-8x35-hot-plug-bay-chassis-dual-intel-xeon-silver-4309y-64gb-ram-2x-240gb-ssd-boss-s2-6x-8tb-sas-perc-h755-dual-700w-psu-dell-3-yr-wty-164128.jpg',
      sourcePage:'https://www.europc.co.uk/dell-poweredge-r550-rack-server-8x35-hot-plug-bay-chassis-dual-intel-xeon-silver-4309y-64gb-ram-2x-240gb-ssd-boss-s2-6x-8tb-sas-perc-h755-dual-700w-psu-dell-3-yr-wty-164128.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Dell PowerEdge R550 — vue avant candidate'
    }
  },
  {
    id:'kb-imagine-platinum-vx',
    image:{
      url:'https://concilium.co.za/assets/images/platinum-vx.jpg',
      sourcePage:'https://concilium.co.za/infrastructure.html',
      sourceType:'secondary-source', verificationStatus:'candidate',
      alt:'Imagine Communications Platinum VX — visuel externe à vérifier avec le châssis terrain'
    }
  }
]);

const asArray = value => Array.isArray(value) ? value : [];
const isCatalog = record => record?.kind === 'equipment_catalog' || record?.targetType === 'equipment_catalog';
const mediaKey = image => String(image?.url || '').trim();

function mergeImages(current, incoming) {
  const merged = [];
  const seen = new Set();
  for (const image of [...asArray(current), ...asArray(incoming)]) {
    const key = mediaKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(image);
  }
  return merged;
}

function isAdminLocked(record) {
  return record?.imageResearch?.origin === 'admin'
    || record?.imageResearch?.locked === true
    || record?.officialImage?.origin === 'admin'
    || record?.officialImage?.locked === true;
}

async function runEquipmentImageCoverageBatch3Core() {
  await db.open();

  const docs = (await db.getAll('docs')).filter(isCatalog);
  const official = new Map(VERIFIED_OFFICIAL_IMAGES.map(record => [record.id, record.image]));
  const candidates = new Map(VERIFIED_CANDIDATE_IMAGES.map(record => [record.id, record.image]));
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
    let next = { ...record, imageCoverageBatch3Version:EQUIPMENT_IMAGE_BATCH3_VERSION };

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
          status:'official-image-verified',
          modelRequired:false,
          reviewedAt:EQUIPMENT_IMAGE_BATCH3_REVIEWED_AT
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
          candidateReviewedAt:EQUIPMENT_IMAGE_BATCH3_REVIEWED_AT
        }
      };
      if (merged.length > before) candidatesAdded += 1;
    }

    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return {
    version:EQUIPMENT_IMAGE_BATCH3_VERSION,
    catalog:docs.length,
    updated,
    officialPromoted,
    candidatesAdded,
    adminLocked,
    officialTargets:VERIFIED_OFFICIAL_IMAGES.length,
    candidateTargets:VERIFIED_CANDIDATE_IMAGES.length
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 * Même principe que le lot 2 : la dépendance est résolue avant d'entrer dans la file.
 */
let vol = null;
export function ensureEquipmentImageCoverageBatch3() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch2();
    return withCatalogEnrichmentGate(runEquipmentImageCoverageBatch3Core);
  })().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageCoverageBatch3 = Object.freeze({
    version:EQUIPMENT_IMAGE_BATCH3_VERSION,
    ensure:ensureEquipmentImageCoverageBatch3,
    official:VERIFIED_OFFICIAL_IMAGES,
    candidates:VERIFIED_CANDIDATE_IMAGES
  });
  await ensureEquipmentImageCoverageBatch3().catch(error => console.warn('Image coverage batch 3 indisponible', error));
}
