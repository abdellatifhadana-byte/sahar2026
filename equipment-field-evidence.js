import { db } from './db.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';

export const EQUIPMENT_FIELD_EVIDENCE_VERSION = 1;
export const EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT = '2026-08-16';
export const FIELD_EVIDENCE_PACK_URL = '/assets/field-evidence/2026-08-16/2m-field-pack.bin';
export const FIELD_EVIDENCE_PACK_BYTES = 200528;

// Le pack contient 20 miniatures WebP concaténées. Les offsets sont stables et
// permettent de garder une seule ressource binaire dans le PWA sans transformer
// ces photos terrain en data: URLs persistées dans IndexedDB.
export const FIELD_EVIDENCE_ASSETS = Object.freeze([
  { id:'2m-field-01', offset:0, length:19360 },
  { id:'2m-field-02', offset:19360, length:18154 },
  { id:'2m-field-03', offset:37514, length:6872 },
  { id:'2m-field-04', offset:44386, length:11874 },
  { id:'2m-field-05', offset:56260, length:8502 },
  { id:'2m-field-06', offset:64762, length:11864 },
  { id:'2m-field-07', offset:76626, length:11126 },
  { id:'2m-field-08', offset:87752, length:10560 },
  { id:'2m-field-09', offset:98312, length:15122 },
  { id:'2m-field-10', offset:113434, length:12704 },
  { id:'2m-field-11', offset:126138, length:8240 },
  { id:'2m-field-12', offset:134378, length:10206 },
  { id:'2m-field-13', offset:144584, length:6800 },
  { id:'2m-field-14', offset:151384, length:8044 },
  { id:'2m-field-15', offset:159428, length:5908 },
  { id:'2m-field-16', offset:165336, length:7656 },
  { id:'2m-field-17', offset:172992, length:8802 },
  { id:'2m-field-18', offset:181794, length:6418 },
  { id:'2m-field-19', offset:188212, length:7054 },
  { id:'2m-field-20', offset:195266, length:5262 }
].map(item => Object.freeze(item)));

const assetIndex = new Map(FIELD_EVIDENCE_ASSETS.map(item => [item.id, item]));
let packPromise = null;
const objectUrlCache = new Map();

async function loadPack() {
  if (!packPromise) {
    packPromise = fetch(FIELD_EVIDENCE_PACK_URL, { cache:'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`Pack preuves terrain indisponible (${response.status})`);
        return response.arrayBuffer();
      })
      .then(buffer => {
        if (buffer.byteLength !== FIELD_EVIDENCE_PACK_BYTES) {
          throw new Error(`Pack preuves terrain invalide (${buffer.byteLength}/${FIELD_EVIDENCE_PACK_BYTES})`);
        }
        return buffer;
      })
      .catch(error => {
        packPromise = null;
        throw error;
      });
  }
  return packPromise;
}

export async function resolveFieldEvidenceAsset(assetId) {
  const id = String(assetId || '').trim();
  if (!id || !assetIndex.has(id)) return '';
  if (objectUrlCache.has(id)) return objectUrlCache.get(id);
  if (typeof fetch !== 'function' || typeof URL === 'undefined' || typeof Blob === 'undefined') return '';
  const item = assetIndex.get(id);
  const pack = await loadPack();
  const end = item.offset + item.length;
  if (item.offset < 0 || item.length <= 0 || end > pack.byteLength) throw new Error(`Segment terrain hors limites: ${id}`);
  const url = URL.createObjectURL(new Blob([pack.slice(item.offset, end)], { type:'image/webp' }));
  objectUrlCache.set(id, url);
  return url;
}

function evidence(assetId, caption, zone, note = '', requiresFieldConfirmation = false) {
  return Object.freeze({
    assetId,
    caption,
    zone,
    sourceType:'2m-field-photo',
    verificationStatus:'field-observed',
    observedAt:EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT,
    requiresFieldConfirmation,
    note
  });
}

/*
 * LES PREUVES PROPRES À LA GRILLE NE SONT PLUS ICI (#142).
 *
 * Ce module est servi à la racine, et il était atteint par la seule forme d'import que la
 * garde publique ne suivait pas — `import './…'`. Il portait donc, sans authentification,
 * les alias de capacité de la matrice et l'implantation de ses baies GR-1/GR-2/GR-3.
 *
 * Ces fiches arrivent maintenant par `knowledgeSeed.fieldEvidencePatches`, après réponse de
 * l'endpoint protégé de #137. La connaissance CONSTRUCTEUR des appareils voisins reste
 * publique : elle vient des façades et des datasheets, pas du plan.
 *
 * Le pack binaire et les preuves des autres zones ne sont pas traités ici : c'est #78.
 */
const PATCHES = [
  {
    id:'kb-sonifex-rb-ds2', manufacturer:'Sonifex', model:'RB-DS2', family:'Redbox', type:'Distribution / synchronisation audio', category:'Audio broadcast',
    inventoryAliases:['RB-DS2','Sonifex RB-DS2']
  },
  {
    id:'kb-harris-6800plus', manufacturer:'Harris Broadcast', model:'6800+ — variantes de châssis à confirmer', family:'6800+', type:'Châssis modulaire broadcast', category:'Infrastructure broadcast',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['Harris 6800+','6800+','FR6822+'],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Famille 6800+ observée, mais la variante/configuration exacte doit être lue sur l’étiquette.' }
  },
  {
    id:'kb-sam-iq-modular', manufacturer:'SAM / Snell', model:'IQ Modular Infrastructure — configuration à confirmer', family:'IQ Modular Infrastructure', type:'Châssis modulaire', category:'Infrastructure broadcast',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['IQ Modular Infrastructure','SAM IQ Modular Infrastructure','Snell IQ Modular Infrastructure'],
    fieldEvidenceImages:[
      evidence('2m-field-17','Deux châssis SAM IQ Modular Infrastructure, repérés RACK 3.BAIE 2 et RACK 4.BAIE 2.','RACK/BAIE','Marquage SAM et IQ Modular Infrastructure lisible en façade.',true)
    ],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Le châssis IQ est confirmé terrain, mais la configuration de cartes/slots reste spécifique à chaque instance.' }
  },
  {
    id:'kb-harris-integrator', manufacturer:'Harris Broadcast', model:'Integrator — référence exacte à confirmer', family:'Integrator', type:'Châssis / contrôle broadcast', category:'Infrastructure broadcast',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['Harris Integrator','INTEGRATOR'],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Le nom Integrator est lisible, pas le SKU exact.' }
  },
  {
    id:'kb-hp-workstation-family', manufacturer:'HP', model:'Workstations rack/desktop — modèles exacts à confirmer', family:'HP Workstation', type:'Station de travail', category:'IT / Workstation',
    verificationStatus:'observed-family', confidence:'medium', inventoryAliases:['HP Workstation'],
    fieldEvidenceImages:[evidence('2m-field-08','Baie contenant plusieurs stations/serveurs HP observés sur site.','BAIE IT','Vue de baie seulement : aucun modèle précis n’est attribué automatiquement.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Vue de baie : les modèles individuels ne sont pas tous lisibles.' }
  },
  {
    id:'kb-hp-z4-family', manufacturer:'HP', model:'Z4 — génération exacte à confirmer', family:'Z4 Workstation', type:'Station de travail', category:'IT / Workstation',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['HP Z4','Z4 Workstation'],
    fieldEvidenceImages:[evidence('2m-field-09','Station HP Z4 avec badge Intel Xeon observée sur site.','BAIE IT','La famille Z4 est lisible ; génération et configuration exactes à confirmer.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'La façade confirme Z4, pas la génération/configuration exacte.' }
  },
  {
    id:'kb-hp-z2-family', manufacturer:'HP', model:'Z2 — génération exacte à confirmer', family:'Z2 Workstation', type:'Station de travail', category:'IT / Workstation',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['HP Z2','Z2 Workstation'],
    fieldEvidenceImages:[evidence('2m-field-10','Station HP Z2 observée sur site.','BAIE IT','La famille Z2 est lisible ; génération et configuration exactes à confirmer.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'La façade confirme Z2, pas la génération/configuration exacte.' }
  },
  {
    id:'kb-gorgy-ledi-network-ats', manufacturer:'Gorgy Timing', model:'LEDI NETWORK ATS', family:'LEDI', type:'Serveur / équipement de temps réseau', category:'Synchronisation',
    inventoryAliases:['LEDI NETWORK ATS','Gorgy LEDI NETWORK ATS'],
    fieldEvidenceImages:[evidence('2m-field-11','Deux unités Gorgy Timing LEDI NETWORK ATS observées dans POOL 2 - BETA.','POOL 2 - BETA','Nom produit lisible sur la façade supérieure.')]
  },
  {
    id:'kb-tektronix-spg600', manufacturer:'Tektronix', model:'SPG600', family:'Sync Pulse Generator', type:'Générateur de synchronisation', category:'Synchronisation',
    inventoryAliases:['SPG600','SPG 600','Tektronix SPG600','Tektronix SPG 600'],
    fieldEvidenceImages:[evidence('2m-field-12','Deux Tektronix SPG 600 Sync Pulse Generator observés.','BAIE SYNC','SPG 600 lisible en façade.')]
  },
  {
    id:'kb-tektronix-eco422d', manufacturer:'Tektronix', model:'ECO422D', family:'Changeover Unit', type:'Changeover SD/HD', category:'Synchronisation',
    inventoryAliases:['ECO422D','ECO 422D','Tektronix ECO422D','Tektronix ECO 422D'],
    fieldEvidenceImages:[evidence('2m-field-12','Tektronix ECO 422D SD/HD Changeover Unit entre deux SPG 600.','BAIE SYNC','Référence lisible en façade.')]
  },
  {
    id:'kb-tektronix-spg422', manufacturer:'Tektronix', model:'SPG422', family:'Component Digital Sync Generator', type:'Générateur de synchronisation', category:'Synchronisation',
    inventoryAliases:['SPG422','SPG 422','Tektronix SPG422','Tektronix SPG 422'],
    fieldEvidenceImages:[evidence('2m-field-13','Tektronix SPG 422 Component Digital Sync Generator observé.','BAIE SYNC','Référence SPG 422 lisible en façade.')]
  },
  {
    id:'kb-sony-hd-ccu-legacy', manufacturer:'Sony', model:'HD Camera Control Unit — modèle exact à confirmer', family:'HD CCU', type:'Camera Control Unit', category:'Caméra / Production',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['Sony HD Camera Control Unit','HD CAMERA CONTROL UNIT'],
    fieldEvidenceImages:[evidence('2m-field-14','Quatre Sony HD CAMERA CONTROL UNIT observées.','BAIE CCU','Les numéros de caméra 7, 8, 3 et 4 sont visibles ; le modèle exact n’est pas lisible, donc aucune référence précise n’est inventée.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Le type HD CAMERA CONTROL UNIT est confirmé, mais l’étiquette modèle n’est pas visible.' }
  },
  {
    id:'kb-harris-neo-dvr', manufacturer:'Harris Broadcast', model:'NEO Digital Video Recorder / frame — SKU exact à confirmer', family:'NEO', type:'Enregistreur / châssis modulaire', category:'Video / Recording',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['Harris NEO','NEO Digital Video Recorder','NEO VR Digital Video Recorder'],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'La famille NEO et la fonction DVR sont visibles, le SKU exact reste à confirmer.' }
  },
  {
    id:'kb-evertz-x0401h', manufacturer:'Evertz', model:'X0401H', family:'4x1 HD Router', type:'Routeur vidéo 4×1 HD', category:'Routing',
    inventoryAliases:['X0401H','Evertz X0401H','4x1 HD ROUTER'],
    fieldEvidenceImages:[evidence('2m-field-16','Evertz 4x1 HD ROUTER model X0401H observé.','BAIE VIDEO','Modèle X0401H lisible en façade.')]
  },
  {
    id:'kb-selenio-6800plus', manufacturer:'Imagine Communications', model:'Selenio 6800+ — configuration à confirmer', family:'Selenio 6800+', type:'Châssis modulaire broadcast', category:'Infrastructure broadcast',
    verificationStatus:'observed-family', confidence:'high', inventoryAliases:['Selenio 6800+','Imagine Selenio 6800+'],
    fieldEvidenceImages:[evidence('2m-field-16','Deux châssis Imagine Selenio 6800+ observés sous le routeur Evertz.','BAIE VIDEO','Famille lisible ; cartes internes/configuration à confirmer.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'La famille Selenio 6800+ est confirmée terrain, la configuration interne ne l’est pas.' }
  },
  {
    id:'kb-miranda-kaleido-quad', manufacturer:'Miranda', model:'Kaleido QUAD', family:'Kaleido', type:'Multiviewer', category:'Monitoring',
    inventoryAliases:['Kaleido QUAD','Miranda Kaleido QUAD'],
    fieldEvidenceImages:[evidence('2m-field-18','Quatre Miranda KALEIDO QUAD : QUAD1 MON3 .3, QUAD2 MON4 .4, QUAD3 MON5 .5, QUAD4 MON6 .6.','BAIE MONITORING','Les libellés terrain montrent 192.168.0.3 à 192.168.0.6.')]
  },
  {
    id:'kb-miranda-kaleido-alto', manufacturer:'Miranda', model:'Kaleido ALTO', family:'Kaleido', type:'Multiviewer', category:'Monitoring',
    inventoryAliases:['Kaleido ALTO','Miranda Kaleido ALTO'],
    fieldEvidenceImages:[evidence('2m-field-18','Miranda KALEIDO ALTO étiqueté ALTO3 MON7 192.168.0.7.','BAIE MONITORING','Nom produit et IP terrain lisibles.')]
  },
  {
    id:'kb-sony-pmw-rx50', manufacturer:'Sony', model:'PMW-RX50 — identification probable, étiquette à confirmer', family:'XDCAM / SxS', type:'Portable Memory Recorder / deck', category:'Video / Recording',
    verificationStatus:'probable', confidence:'medium-high', inventoryAliases:['PMW-RX50','Sony PMW-RX50'],
    fieldEvidenceImages:[evidence('2m-field-19','Deck Sony XDCAM/SxS portable avec écran rabattable et deux slots SxS.','BAIE VIDEO','Correspondance visuelle probable avec PMW-RX50 ; l’étiquette modèle n’est pas lisible sur la photo, donc l’identification reste à confirmer.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Identification probable PMW-RX50 sur la morphologie ; confirmer l’étiquette modèle avant de traiter cette référence comme exacte.' }
  },
  {
    id:'kb-avid-dnxiq', manufacturer:'Avid', model:'Artist | DNxIQ', family:'DNxIQ', type:'I/O vidéo', category:'Acquisition / I/O',
    inventoryAliases:['DNxIQ','Avid DNxIQ','Artist DNxIQ','Avid Artist DNxIQ'],
    fieldEvidenceImages:[evidence('2m-field-20','Deux Avid Artist | DNxIQ étiquetés ACQ-S STC et ACQ-P STC.','STC Acquisition','Nom DNxIQ clairement lisible en façade.')]
  },
  {
    id:'kb-kramer-vs81av', manufacturer:'Kramer', model:'VS-81AV', family:'VS', type:'8×1 Video/Audio Stereo Switcher', category:'Routing / Switching',
    inventoryAliases:['VS-81AV','Kramer VS-81AV'],
    fieldEvidenceImages:[evidence('2m-field-20','Kramer VS-81AV observé sous les deux DNxIQ.','STC Acquisition','Référence VS-81AV lisible en façade.')]
  }
];

export const FIELD_EVIDENCE_CATALOG_PATCHES = Object.freeze(PATCHES.map(record => Object.freeze({
  kind:'equipment_catalog',
  targetType:'equipment_catalog',
  origin:'seed-field-evidence',
  observed:true,
  verificationStatus:record.verificationStatus || 'observed',
  confidence:record.confidence || 'high',
  ...record,
  fieldEvidenceImages:Object.freeze((record.fieldEvidenceImages || []).map(item => Object.freeze(item)))
})));

const asArray = value => Array.isArray(value) ? value : [];
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim()
  .replace(/\s+/g,' ');

function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin')
    || record?.locked === true
    || record?.adminLocked === true
    || record?.imageResearch?.origin === 'admin'
    || record?.imageResearch?.locked === true;
}

function mergeAliases(current, incoming) {
  const merged = new Map();
  for (const value of [...asArray(current), ...asArray(incoming)]) {
    const key = normalize(value);
    if (!key || merged.has(key)) continue;
    merged.set(key, String(value).trim());
  }
  return [...merged.values()];
}

/*
 * NE VALIDER QUE CE QUE CE PACK APPORTE (#98).
 *
 * Le filtre `assetIndex.has(key)` s'appliquait à l'ensemble FUSIONNÉ : il supprimait donc
 * aussi les preuves déjà portées par la fiche et appartenant à un AUTRE pack — celles de
 * la Phase 12 (`2m-field12-*`), absentes de l'index de ce module-ci. Phase 12 les
 * reposait au passage suivant, ce module les retirait de nouveau : un aller-retour sans
 * fin sur kb-evertz-x0401h et kb-avid-dnxiq, masqué jusqu'ici par les conflits de
 * révision.
 *
 * L'index reste la garde de ce que CE module ajoute : une preuve entrante dont l'asset
 * n'existe pas dans le pack n'est toujours pas posée. Ce qui est déjà là est conservé.
 */
function mergeEvidence(current, incoming) {
  const merged = new Map();
  for (const item of asArray(current)) {
    const key = String(item?.assetId || '').trim();
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...item, assetId:key });
  }
  for (const item of asArray(incoming)) {
    const key = String(item?.assetId || '').trim();
    if (!key || !assetIndex.has(key)) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...item, assetId:key });
  }
  return [...merged.values()];
}

async function runEquipmentFieldEvidenceCore() {
  await db.open();
  let created = 0;
  let updated = 0;
  let protectedRecords = 0;
  let evidenceLinks = 0;

  for (const patch of FIELD_EVIDENCE_CATALOG_PATCHES) {
    const current = await db.get('docs', patch.id).catch(() => null);
    if (current && adminLocked(current)) {
      protectedRecords += 1;
      continue;
    }
    const evidence = mergeEvidence(current?.fieldEvidenceImages, patch.fieldEvidenceImages);
    const next = {
      ...patch,
      ...(current || {}),
      id:patch.id,
      kind:current?.kind || 'equipment_catalog',
      targetType:current?.targetType || 'equipment_catalog',
      origin:current?.origin || patch.origin,
      inventoryAliases:mergeAliases(current?.inventoryAliases, patch.inventoryAliases),
      fieldEvidenceImages:evidence,
      observed:current?.observed ?? true,
      imageResearch:current?.imageResearch || patch.imageResearch,
      fieldEvidenceVersion:EQUIPMENT_FIELD_EVIDENCE_VERSION,
      fieldEvidenceObservedAt:EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT
    };
    evidenceLinks += evidence.length;
    /*
     * COMPARER LE CONTENU, PAS L'ORDRE DES CLÉS (#98).
     *
     * Cette garde existe depuis toujours et n'a jamais rien gardé. `current` ne vient pas
     * d'ici : il revient du serveur, où PostgreSQL le range en `jsonb` — un format qui
     * RÉORDONNE les clés, par longueur puis par alphabet. `next`, lui, est construit dans
     * l'ordre des littéraux de ce fichier. Deux ordres, donc deux chaînes différentes pour
     * un contenu strictement identique : `JSON.stringify` répondait « différent » à chaque
     * chargement, et cette fiche repartait vers le serveur pour rien.
     *
     * Mesuré sur main@f2bc8a6, base neuve : `kb-evertz-x0401h` et `kb-avid-dnxiq`
     * réécrites à CHAQUE chargement, révision 1 → 2 → 3 → … sans qu'un seul champ métier
     * ne bouge.
     *
     * `recordsExactlyEqual` est la comparaison que le dépôt s'est déjà donnée en #171 :
     * même contenu, clés triées d'abord. Elle ne relâche rien — elle ignore l'ordre, et
     * l'ordre n'a jamais été de l'information.
     */
    if (current && recordsExactlyEqual(next, current)) continue;
    await db.save('docs', next);
    if (current) updated += 1;
    else created += 1;
  }

  if ((created || updated) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('equipment-field-evidence-updated', {
      detail:{ version:EQUIPMENT_FIELD_EVIDENCE_VERSION, created, updated, protectedRecords, evidenceLinks }
    }));
  }
  return {
    version:EQUIPMENT_FIELD_EVIDENCE_VERSION,
    assets:FIELD_EVIDENCE_ASSETS.length,
    packBytes:FIELD_EVIDENCE_PACK_BYTES,
    catalogTargets:FIELD_EVIDENCE_CATALOG_PATCHES.length,
    created,
    updated,
    protectedRecords,
    evidenceLinks
  };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * `field-evidence-integration.js` et `equipment-field-evidence-phase12.js`
 * importent ce module et rappellent `ensureEquipmentFieldEvidence()` depuis leur
 * propre code de chargement, en plus du déclenchement propre de ce fichier. Sans
 * cette garde, kb-harris-neo-dvr et kb-miranda-kaleido-alto recevaient chacun deux
 * écritures concurrentes fondées sur la même lecture, et le serveur répondait 409
 * STALE_WRITE sur la seconde.
 */
let vol = null;
export function ensureEquipmentFieldEvidence() {
  if (vol) return vol;
  vol = withCatalogEnrichmentGate(runEquipmentFieldEvidenceCore).finally(() => { vol = null; });
  return vol;
}

let reconcileTimer = null;
function schedule(delay = 300) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureEquipmentFieldEvidence().catch(error => console.warn('Preuves terrain 2M indisponibles', error)), delay);
}

if (typeof window !== 'undefined') {
  window.EquipmentFieldEvidence = Object.freeze({
    version:EQUIPMENT_FIELD_EVIDENCE_VERSION,
    packUrl:FIELD_EVIDENCE_PACK_URL,
    assets:FIELD_EVIDENCE_ASSETS,
    catalogPatches:FIELD_EVIDENCE_CATALOG_PATCHES,
    resolveAsset:resolveFieldEvidenceAsset,
    ensure:ensureEquipmentFieldEvidence
  });
  window.addEventListener('inventory-master-imported', () => schedule());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') schedule(); });
  await ensureEquipmentFieldEvidence().catch(error => console.warn('Preuves terrain 2M non initialisées', error));
  schedule(1800);
}
