import { db } from './db.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_IMAGE_SEED_VERSION = 2;

export const CATALOG_IMAGE_PATCHES = Object.freeze([
  {
    id:'kb-ross-ultrix',
    officialImage:{
      url:'https://www.rossvideo.com/wp-content/uploads/2024/12/FR12-1920px_square_backup.png',
      sourcePage:'https://www.rossvideo.com/infrastructure/routing-systems/ultrix/',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Ross Video Ultrix FR12'
    },
    officialImages:[
      {
        url:'https://www.rossvideo.com/wp-content/uploads/2024/12/FR12-1920px_square_backup.png',
        sourcePage:'https://www.rossvideo.com/infrastructure/routing-systems/ultrix/',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Ross Video Ultrix FR12 — vue avant'
      },
      {
        url:'https://www.rossvideo.com/wp-content/uploads/2024/05/FR12-Hero-front-and-back-1-scaled.jpg',
        sourcePage:'https://www.rossvideo.com/blog/all-i-need-is-a-router/',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Ross Video Ultrix FR12 — vues avant et arrière'
      }
    ]
  },
  {
    id:'kb-ross-opengear-ogx',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/frames-accessories/ogx-frame/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-sra8802',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/sra-8802/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-sfs8622a',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/timing-synchronization/sfs-8622-a/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-dra8804',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/dra-8804/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-uda8705a',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/uda-8705a/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-mc1-panel16',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/mc1-panel-16/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-ross-mc1uhd',
    imageResearch:{
      sourcePage:'https://www.rossvideo.com/products/signal-processing/mc1/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-aja-ogfsmini',
    imageResearch:{
      sourcePage:'https://www.aja.com/products/og-fs-mini',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://hdsourceonline.com/cdn/shop/products/openfsmini.png?v=1689004207&width=1946',
        sourcePage:'https://hdsourceonline.com/products/aja-fs-range-of-1ru-frame-synchronizers-and-multi-capable-converters',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'AJA OG-FS-Mini — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-decimator-dmonquad',
    imageResearch:{
      sourcePage:'https://decimator.com/Products/MultiViewers/DMON-QUAD%20MultiViewer/DMON-QUAD.html',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://www.markertek.com/productImage/alternate-1/hi-res/DEC-DMON-QUAD.JPG',
        sourcePage:'https://www.markertek.com/product/dec-dmon-quad/decimator-design-dmon-quad-3g-hd-sd-sdi-to-hdmi-converter-with-1-to-4-multiviewer-with-8-channel-audio-meters',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Decimator DMON-QUAD — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-dell-precision3930r',
    imageResearch:{
      sourcePage:'https://www.dell.com/support/product-details/fr-ma/product/precision-3930r-workstation/overview',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://apiv2.exceldisc.com/media/11166/0804bc19-652a-4163-b2a2-25f272d7cca4.jpg',
        sourcePage:'https://exceldisc.com/product/dell-precision-3930-rack-workstation',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Dell Precision 3930 Rack — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-dell-r450',
    imageResearch:{
      sourcePage:'https://www.dell.com/support/home/fr-ma/product-support/product/poweredge-r450/overview',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://expresscomputersystems.com/cdn/shop/products/R450-front_2000x.jpg?v=1674172771',
        sourcePage:'https://expresscomputersystems.com/products/dell-poweredge-r450-server',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Dell PowerEdge R450 — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-dell-r750',
    imageResearch:{
      sourcePage:'https://www.dell.com/support/home/fr-ma/product-support/product/poweredge-r750/overview',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://sourceit.com.sg/cdn/shop/products/dell-poweredge-r750-rack-server-798946_2048x.jpg?v=1701337554',
        sourcePage:'https://sourceit.com.sg/products/dell-poweredge-r750-rack-server',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Dell PowerEdge R750 — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-cisco-c9300x12y',
    imageResearch:{
      sourcePage:'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-architecture-cte-en.html',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://serverorbit.com/images/detailed/306/Cisco-C9300X-12Y-A-12-Ports-Ethernet-Switch.jpg',
        sourcePage:'https://serverorbit.com/networking/switches/cisco-switches/c9300x-12y-a/',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Cisco Catalyst C9300X-12Y — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-sony-pdw-hd1200',
    officialImage:{
      url:'https://www.sony.com/image/0ef02372635ba1923351c417dad1dcc8?fmt=jpeg&hei=1000&wid=1000',
      sourcePage:'https://pro.sony/en_MA/products/xdcam-disc-memory/pdw-hd1200',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Sony PDW-HD1200 — vue constructeur'
    },
    officialImages:[
      {
        url:'https://www.sony.com/image/0ef02372635ba1923351c417dad1dcc8?fmt=jpeg&hei=1000&wid=1000',
        sourcePage:'https://pro.sony/en_MA/products/xdcam-disc-memory/pdw-hd1200',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Sony PDW-HD1200 — vue avant constructeur'
      },
      {
        url:'https://www.sony.com/image/e486a54ca09e0d297a35b6f7fe3f6442?fmt=jpeg&hei=410&wid=680',
        sourcePage:'https://pro.sony/en_MA/products/xdcam-disc-memory/pdw-hd1200',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Sony PDW-HD1200 — vue arrière constructeur'
      }
    ]
  },
  {
    id:'kb-sony-pdw-hd1550',
    officialImage:{
      url:'https://www.sony.jp/products/picture/PDW-HD1550.jpg',
      sourcePage:'https://www.sony.jp/xdcam/products/PDW-HD1550/',
      sourceType:'manufacturer',
      verificationStatus:'verified',
      alt:'Sony PDW-HD1550 — vue constructeur'
    },
    officialImages:[
      {
        url:'https://www.sony.jp/products/picture/PDW-HD1550.jpg',
        sourcePage:'https://www.sony.jp/xdcam/products/PDW-HD1550/',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Sony PDW-HD1550 — vue constructeur'
      },
      {
        url:'https://www.sony.jp/products/picture/PDW-HD1550_001.jpg',
        sourcePage:'https://www.sony.jp/xdcam/products/PDW-HD1550/',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Sony PDW-HD1550 — vue complémentaire constructeur'
      },
      {
        url:'https://www.sony.jp/products/picture/PDW-HD1550_002.jpg',
        sourcePage:'https://www.sony.jp/xdcam/products/PDW-HD1550/',
        sourceType:'manufacturer',
        verificationStatus:'verified',
        alt:'Sony PDW-HD1550 — vue arrière constructeur'
      }
    ]
  },
  {
    id:'kb-leader-lv5300a',
    imageResearch:{
      sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5300a/',
      sourceType:'manufacturer',
      status:'source-page-known'
    },
    candidateImages:[
      {
        url:'https://d1mv2b9v99cq0i.cloudfront.net/eyJidWNrZXQiOiJ3ZWItbmluamEtaW1hZ2VzIiwia2V5IjoicHJvdGVsXC9pbWFnZXNcL3Byb2RpbWdcLzM4OThfMS5qcGciLCJlZGl0cyI6eyJyZXNpemUiOnsid2lkdGgiOjcwMCwiaGVpZ2h0Ijo3MDAsImZpdCI6Imluc2lkZSIsIndpdGhvdXRFbmxhcmdlbWVudCI6dHJ1ZX19LCJ2ZXJzaW9uIjoiNjQ5ODcwOTBiZjdjMDVkOWQwMDQ2YmFjNTcwNjhhNzc2NWVmZDYxZCJ9',
        sourcePage:'https://www.protel.co.nz/product/3898-leader-lv5300-waveform-monitor-for-sdi-video-signals',
        sourceType:'secondary-source',
        verificationStatus:'candidate',
        alt:'Leader LV5300A — visuel externe à vérifier'
      }
    ]
  },
  {
    id:'kb-leader-lv5350',
    imageResearch:{
      sourcePage:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-leader-lt4610',
    imageResearch:{
      sourcePage:'https://www.leader.co.jp/products/discontinuation/lt4610/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  },
  {
    id:'kb-leader-lt4448',
    imageResearch:{
      sourcePage:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
      sourceType:'manufacturer',
      status:'source-page-known'
    }
  }
]);

const asArray = value => Array.isArray(value) ? value : [];
const isCatalog = record => record?.kind === 'equipment_catalog' || record?.targetType === 'equipment_catalog';
const imageKey = image => String(image?.url || '');

function mergeImages(current, incoming) {
  const result = [];
  const seen = new Set();
  for (const image of [...asArray(current), ...asArray(incoming)]) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
  }
  return result;
}

async function runEquipmentImageSeedCore() {
  await db.open();
  const docs = (await db.getAll('docs')).filter(isCatalog);
  const patches = new Map(CATALOG_IMAGE_PATCHES.map(record => [String(record.id), record]));
  let updated = 0;

  for (const record of docs) {
    const patch = patches.get(String(record.id)) || {};
    const existingVersion = Number(record.imageSeedVersion || 0);
    const adminImage = record.officialImage?.origin === 'admin' || record.officialImage?.locked === true;
    const next = {
      ...record,
      imageSeedVersion: Math.max(existingVersion, EQUIPMENT_IMAGE_SEED_VERSION),
      /*
       * ENSEMENCER, C'EST COMBLER — PAS RÉÉCRIRE (#98).
       *
       * Deux défauts distincts se cumulaient ici, tous deux invisibles tant que les
       * conflits de révision rejetaient une écriture sur deux :
       *
       * 1. `imageResearch` était reconstruit à partir de ces trois clés SEULEMENT :
       *    chaque passage effaçait donc les clés posées par les lots 2 à 8
       *    (`manufacturer`, `modelRequired`, `reviewedAt`, `candidate*`, `sourceNote`,
       *    `sourceReviewedAt`…), que ces lots reposaient ensuite. Tous les autres lots
       *    reprennent déjà l'existant de cette manière.
       *
       * 2. La constante de ce module passait AVANT la valeur déjà présente sur la fiche.
       *    Ce lot est pourtant le PREMIER de la chaîne (2 → 8) : une valeur déjà posée
       *    vient forcément d'une revue plus tardive et mieux informée. Mesuré :
       *    `status` retombait de `official-image-verified` (lot 7, image constructeur
       *    vérifiée) à `source-page-known`, et la page source Dell revenait à l'URL de
       *    ce lot alors que le lot 6 l'avait canonisée — indéfiniment.
       *
       * L'ensemencement comble donc ce qui manque et ne remplace plus ce qui existe.
       */
      imageResearch: {
        ...(record.imageResearch || {}),
        sourcePage: record.imageResearch?.sourcePage || patch.imageResearch?.sourcePage || patch.officialImage?.sourcePage || record.documentationUrl || '',
        sourceType: record.imageResearch?.sourceType || patch.imageResearch?.sourceType || patch.officialImage?.sourceType || (record.documentationUrl ? 'manufacturer-or-documentation' : ''),
        status: record.imageResearch?.status || patch.imageResearch?.status || (patch.officialImage?.url ? 'official-image-verified' : (record.documentationUrl ? 'source-page-known' : 'needs-source'))
      },
      officialImages: mergeImages(record.officialImages, patch.officialImages),
      candidateImages: mergeImages(record.candidateImages, patch.candidateImages)
    };
    if (!adminImage && !record.officialImage?.url && patch.officialImage?.url) next.officialImage = patch.officialImage;
    if (existingVersion >= EQUIPMENT_IMAGE_SEED_VERSION && JSON.stringify(next) === JSON.stringify(record)) continue;
    await db.save('docs', next);
    updated += 1;
  }

  return { catalog:docs.length, updated, seeded:CATALOG_IMAGE_PATCHES.length, version:EQUIPMENT_IMAGE_SEED_VERSION };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * Ce module est aussi importé et rappelé par `equipment-image-coverage-batch2.js`
 * et par `equipment-media.js` (cache catalogue), en plus de son propre
 * déclenchement ci-dessous : sans cette garde, ces passages concurrents relisaient
 * le même enregistrement `docs/kb-*` puis écrivaient chacun dessus.
 */
let vol = null;
export function ensureEquipmentImageSeed() {
  if (vol) return vol;
  vol = withCatalogEnrichmentGate(runEquipmentImageSeedCore).finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.EquipmentImageSeed = Object.freeze({ version:EQUIPMENT_IMAGE_SEED_VERSION, ensure:ensureEquipmentImageSeed, patches:CATALOG_IMAGE_PATCHES });
  queueMicrotask(() => ensureEquipmentImageSeed().catch(error => console.warn('Image catalogue seed indisponible', error)));
}
