import { db } from './db.js';
import { ensureEquipmentFieldEvidence } from './equipment-field-evidence.js';
import { ensureEquipmentMediaLinkage } from './equipment-media-linkage.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';

export const EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION = 2;
export const EQUIPMENT_FIELD_EVIDENCE_PHASE12_OBSERVED_AT = '2026-08-16';
export const FIELD_EVIDENCE_PHASE12_ASSET_ROOT = '/assets/field-evidence/2026-08-16';

export const FIELD_EVIDENCE_PHASE12_ASSETS = Object.freeze([
  { id:'2m-field12-01', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-01.webp` },
  { id:'2m-field12-02', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-02.webp` },
  { id:'2m-field12-03', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-03.webp` },
  { id:'2m-field12-04', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-04.webp` },
  { id:'2m-field12-05', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-05.webp` },
  { id:'2m-field12-06', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-06.webp` },
  { id:'2m-field12-07', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-07.webp` },
  { id:'2m-field12-08', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-08.webp` },
  { id:'2m-field12-09', url:`${FIELD_EVIDENCE_PHASE12_ASSET_ROOT}/phase12-09.webp` }
].map(item => Object.freeze(item)));

const asArray = value => Array.isArray(value) ? value : [];
const normalize = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

/*
 * PHASE 0 (#78) — CES OCTETS NE SONT PLUS LISIBLES DEPUIS UN CHEMIN STATIQUE.
 *
 * `resolveFieldEvidencePhase12Asset` rendait directement `assets/field-evidence/…/phase12-*.webp`
 * comme `src` d'`<img>` : la vignette se chargeait par une requête réseau du navigateur, hors
 * de tout contrôle JS. Le sous-arbre est maintenant fermé côté serveur (#78 Phase 0), donc
 * cette même requête `<img>` échouerait — une icône d'image cassée dans une section qui
 * annonce « Preuves terrain 2M », plutôt qu'une absence propre.
 *
 * Rendre `''` fait prendre à `evidenceMarkup` la même branche que pour un asset introuvable :
 * la carte n'est pas construite, et si aucune ne l'est, la section entière n'est pas insérée
 * — exactement le comportement déjà établi par le module frère `equipment-field-evidence.js`
 * face à un pack indisponible. Aucune image de remplacement n'est inventée ; la fonctionnalité
 * est temporairement absente, pas simulée. La Phase 1 de #78 restaure une lecture autorisée.
 */
export async function resolveFieldEvidencePhase12Asset() {
  return '';
}

function evidence(assetId, caption, zone, note = '', requiresFieldConfirmation = false) {
  return Object.freeze({
    assetId, caption, zone, note, requiresFieldConfirmation,
    sourceType:'2m-field-photo', verificationStatus:'field-observed',
    observedAt:EQUIPMENT_FIELD_EVIDENCE_PHASE12_OBSERVED_AT
  });
}

const PATCHES = [
  {
    id:'kb-kub-usb-scan-station', manufacturer:'À identifier',
    model:'KUB — borne de contrôle de médias USB', family:'KUB',
    type:'Borne de scan antivirus / média amovible', category:'IT / Sécurité',
    verificationStatus:'field-observed-function', confidence:'high',
    inventoryAliases:['KUB','KUB.01','KUB.02','KUB 01','KUB 02'],
    fieldEvidenceImages:[evidence('2m-field12-01','KUB.02 — borne STC de contrôle des clés/disques USB.','STC','L’écran décrit explicitement le scan des médias USB à la recherche de menaces. Constructeur et SKU matériel non lisibles.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Fonction KUB confirmée terrain ; constructeur/SKU à relever.' }
  },
  {
    id:'kb-harmonic-spectrum',
    inventoryAliases:['Harmonic Spectrum','Spectrum'],
    fieldEvidenceImages:[
      evidence('2m-field12-02','Rack Harmonic Spectrum : deux nœuds repérés DEC / ENC et un Spectrum MediaCenter.','STC','Famille Spectrum confirmée. Les SKU des nœuds DEC/ENC ne sont pas déduits.',true),
      evidence('2m-field12-03','Harmonic Spectrum MediaCenter au-dessus d’un châssis Axon Synapse.','STC','Contexte terrain de la plateforme Spectrum ; génération matérielle exacte à confirmer.',true)
    ]
  },
  {
    id:'kb-harmonic-spectrum-vsx',
    fieldEvidenceImages:[evidence('2m-field12-02','Plateforme Harmonic Spectrum observée avec DEC / ENC et Spectrum MediaCenter.','STC','Cette photo confirme la famille Spectrum mais ne confirme pas le suffixe VSX de l’instance inventoriée.',true)]
  },
  {
    id:'kb-harmonic-spectrum-mediacenter', manufacturer:'Harmonic',
    model:'Spectrum MediaCenter — génération exacte à confirmer', family:'Spectrum',
    type:'Serveur / appliance média', category:'Diffusion / Playout',
    verificationStatus:'observed-family', confidence:'high',
    inventoryAliases:['Spectrum MediaCenter','Harmonic Spectrum MediaCenter'],
    fieldEvidenceImages:[
      evidence('2m-field12-02','Harmonic Spectrum MediaCenter observé sous deux nœuds Spectrum DEC/ENC.','STC','Le nom Spectrum MediaCenter est lisible ; génération/SKU exact à confirmer.',true),
      evidence('2m-field12-03','Façade Harmonic Spectrum MediaCenter observée sur site.','STC','Produit/famille confirmé ; modèle matériel précis non lisible.',true)
    ],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Spectrum MediaCenter est lisible, pas la génération/SKU exact.' }
  },
  {
    id:'kb-axon-sfr08',
    fieldEvidenceImages:[evidence('2m-field12-03','Axon Synapse Modular Media System SFR08 observé sous le Spectrum MediaCenter.','STC','Référence SFR08 visible sur la façade du châssis.')]
  },
  {
    id:'kb-ross-opengear-ogx',
    fieldEvidenceImages:[evidence('2m-field12-03','Châssis Ross openGear observé sous l’Axon Synapse.','STC','Famille openGear visible ; configuration des cartes internes non déduite.',true)]
  },
  {
    id:'kb-blackmagic-hyperdeck-legacy', manufacturer:'Blackmagic Design',
    model:'HyperDeck Studio — génération exacte à confirmer', family:'HyperDeck',
    type:'Enregistreur / lecteur vidéo sur SSD', category:'Video / Recording',
    verificationStatus:'observed-family', confidence:'high',
    inventoryAliases:['Blackmagic HyperDeck','HyperDeck Studio','HyperDeck'],
    fieldEvidenceImages:[evidence('2m-field12-04','Enregistreur rack Blackmagic Design à deux logements média, commandes transport, écran et jog.','BAIE VIDEO','Famille HyperDeck Studio cohérente avec la façade ; génération/SKU exact non lisible.',true)],
    imageResearch:{ status:'model-required', modelRequired:true, reason:'Famille HyperDeck observée ; confirmer l’étiquette avant de fixer la génération.' }
  },
  {
    id:'kb-dell-poweredge',
    fieldEvidenceImages:[evidence('2m-field12-04','Serveur Dell PowerEdge visible sous l’enregistreur Blackmagic.','BAIE VIDEO','Vue de contexte : modèle PowerEdge exact non attribué.',true)]
  },
  {
    id:'kb-orban2200',
    fieldEvidenceImages:[evidence('2m-field12-05','Orban 2200 OPTIMOD-FM DIGITAL AUDIO PROCESSOR observé en rack.','BAIE AUDIO','Modèle de base 2200 et fonction Optimod-FM lisibles ; suffixe éventuel à confirmer.',true)]
  },
  {
    id:'kb-evertz-x0401h',
    fieldEvidenceImages:[evidence('2m-field12-06','Evertz 4×1 HD ROUTER model X0401H observé en façade.','BAIE VIDEO','Référence X0401H clairement lisible. L’état affiché est ponctuel, pas une donnée permanente.')]
  },
  {
    id:'kb-ross-ultrix',
    fieldEvidenceImages:[evidence('2m-field12-06','Deux châssis Ross Ultrix observés sous le routeur Evertz X0401H.','BAIE VIDEO','Famille Ultrix visible ; taille et configuration internes non déduites.',true)]
  },
  {
    id:'kb-imagine-platinum-vx',
    fieldEvidenceImages:[evidence('2m-field12-07','Imagine Communications Platinum VX — façade terrain 2M.','BAIE VIDEO','Le nom Platinum VX et le constructeur Imagine Communications sont lisibles.')]
  },
  {
    id:'kb-avid-nexis',
    fieldEvidenceImages:[evidence('2m-field12-08','Avid NEXIS observé dans la baie CONFORMITE - 1.','CONFORMITE - 1','Produit Avid NEXIS visible ; capacité/configuration de stockage non déduite.',true)]
  },
  {
    id:'kb-avid-dnxiq',
    fieldEvidenceImages:[evidence('2m-field12-08','Avid Artist | DNxIQ observé dans la baie CONFORMITE - 1.','CONFORMITE - 1','DNxIQ clairement visible en façade.')]
  },
  {
    id:'kb-lenovo-thinkstation',
    fieldEvidenceImages:[evidence('2m-field12-08','Station Lenovo ThinkStation observée dans la baie CONFORMITE - 1.','CONFORMITE - 1','Famille ThinkStation visible ; modèle exact non lisible.',true)]
  },
  {
    id:'kb-leader-lv5300a',
    fieldEvidenceImages:[evidence('2m-field12-09','Leader LV5300A Waveform Monitor en fonctionnement sur une entrée SDI.','STC','Référence LV5300A clairement lisible ; preuve terrain distincte de la photo constructeur.')]
  }
];

export const FIELD_EVIDENCE_PHASE12_CATALOG_PATCHES = Object.freeze(PATCHES.map(record => Object.freeze({
  kind:'equipment_catalog', targetType:'equipment_catalog', origin:'seed-field-evidence-phase12',
  observed:true, verificationStatus:record.verificationStatus || 'observed', confidence:record.confidence || 'high',
  ...record,
  fieldEvidenceImages:Object.freeze(asArray(record.fieldEvidenceImages).map(item => Object.freeze(item)))
})));

const FIELD_CONFIRMATIONS = Object.freeze([
  { id:'kb-evertz-x0401h', manufacturer:'Evertz', model:'X0401H', family:'4x1 HD Router', assetId:'2m-field12-06' },
  { id:'kb-imagine-platinum-vx', manufacturer:'Imagine Communications', model:'Platinum VX', family:'Platinum', assetId:'2m-field12-07' },
  { id:'kb-leader-lv5300a', manufacturer:'Leader Electronics', model:'LV5300A', family:'ZEN', assetId:'2m-field12-09' }
]);

function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true
    || record?.imageResearch?.origin === 'admin' || record?.imageResearch?.locked === true;
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

function mergeEvidence(current, incoming) {
  const merged = new Map();
  for (const item of [...asArray(current), ...asArray(incoming)]) {
    const key = String(item?.assetId || '').trim();
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...item, assetId:key });
  }
  return [...merged.values()];
}

async function applyFieldConfirmations() {
  let confirmed = 0;
  for (const confirmation of FIELD_CONFIRMATIONS) {
    const current = await db.get('docs', confirmation.id).catch(() => null);
    if (!current || adminLocked(current)) continue;
    const next = {
      ...current,
      manufacturer:confirmation.manufacturer,
      model:confirmation.model,
      family:current.family || confirmation.family,
      verificationStatus:'field-photo-confirmed', confidence:'high', observed:true,
      fieldHardwareConfirmation:{
        ...(current.fieldHardwareConfirmation || {}),
        assetId:confirmation.assetId,
        observedAt:EQUIPMENT_FIELD_EVIDENCE_PHASE12_OBSERVED_AT,
        manufacturer:confirmation.manufacturer, model:confirmation.model,
        exactFrontModelConfirmed:true,
        note:'Constructeur et référence de façade confirmés par photo terrain 2M. Cartes/options internes non déduites.'
      },
      fieldEvidencePhase12Version:EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION,
      fieldEvidencePhase12ObservedAt:EQUIPMENT_FIELD_EVIDENCE_PHASE12_OBSERVED_AT
    };
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    await db.save('docs', next);
    confirmed += 1;
  }
  return confirmed;
}

async function runEquipmentFieldEvidencePhase12Core() {
  await db.open();
  let created = 0;
  let updated = 0;
  let protectedRecords = 0;
  let evidenceLinks = 0;

  for (const patch of FIELD_EVIDENCE_PHASE12_CATALOG_PATCHES) {
    const current = await db.get('docs', patch.id).catch(() => null);
    if (current && adminLocked(current)) { protectedRecords += 1; continue; }
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
      fieldEvidencePhase12Version:EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION,
      fieldEvidencePhase12ObservedAt:EQUIPMENT_FIELD_EVIDENCE_PHASE12_OBSERVED_AT
    };
    evidenceLinks += evidence.length;
    // Même garde, même défaut, même remède qu'en phase 11 : `current` revient du serveur
    // en ordre `jsonb`, `next` est bâti dans l'ordre de ce fichier. Voir le commentaire
    // détaillé dans `equipment-field-evidence.js` — c'est la même fiche qui repartait.
    if (current && recordsExactlyEqual(next, current)) continue;
    await db.save('docs', next);
    current ? updated++ : created++;
  }

  const confirmed = await applyFieldConfirmations();
  if ((created || updated || confirmed) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('equipment-field-evidence-updated', {
      detail:{ phase:12, version:EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION, created, updated, confirmed, protectedRecords, evidenceLinks }
    }));
  }
  return { phase:12, version:EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION, assets:FIELD_EVIDENCE_PHASE12_ASSETS.length,
    catalogTargets:FIELD_EVIDENCE_PHASE12_CATALOG_PATCHES.length, created, updated, confirmed, protectedRecords, evidenceLinks };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * La dépendance (preuves terrain de base) est attendue AVANT d'entrer dans la file
 * partagée, jamais depuis l'intérieur d'un tour.
 */
let vol = null;
export function ensureEquipmentFieldEvidencePhase12() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentFieldEvidence();
    return withCatalogEnrichmentGate(runEquipmentFieldEvidencePhase12Core);
  })().finally(() => { vol = null; });
  return vol;
}

async function equipmentFrom360(modal) {
  const id = String(modal?.dataset?.equipmentId || '').trim();
  if (id) {
    const equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
    if (equipment) return equipment;
  }
  const name = modal?.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
  if (!name) return null;
  const target = normalize(name);
  const matches = (await db.getAll('equipments')).filter(item => normalize(item.name || item.nom || item.reference) === target);
  return matches.length === 1 ? matches[0] : null;
}

function injectStyles() {
  if (document.getElementById('field-evidence-phase12-360-styles')) return;
  const style = document.createElement('style');
  style.id = 'field-evidence-phase12-360-styles';
  style.textContent = `
    .field-evidence-phase12-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
    .field-evidence-phase12-item{border:1px solid var(--border,#dce4e8);border-radius:12px;overflow:hidden;background:var(--surface,#fff)}
    .field-evidence-phase12-item img{display:block;width:100%;height:150px;object-fit:cover;background:#101820}
    .field-evidence-phase12-copy{padding:9px;display:grid;gap:5px}.field-evidence-phase12-copy strong{font-size:12px;line-height:1.35}.field-evidence-phase12-copy small{font-size:11px;color:var(--text-muted,#667783);line-height:1.35}
    .field-evidence-phase12-tags{display:flex;flex-wrap:wrap;gap:5px}.field-evidence-phase12-tag{font-size:10px;font-weight:800;border-radius:999px;padding:3px 7px;background:rgba(40,116,166,.12)}
    .field-evidence-phase12-tag.confirm{background:rgba(230,126,34,.13)}
  `;
  document.head.appendChild(style);
}

async function evidenceMarkup(items) {
  const cards = [];
  for (const item of items) {
    if (!String(item?.assetId || '').startsWith('2m-field12-')) continue;
    const url = await resolveFieldEvidencePhase12Asset(item.assetId);
    if (!url) continue;
    cards.push(`<article class="field-evidence-phase12-item">
      <img src="${esc(url)}" alt="${esc(item.caption || 'Preuve terrain 2M')}" loading="lazy">
      <div class="field-evidence-phase12-copy">
        <div class="field-evidence-phase12-tags"><span class="field-evidence-phase12-tag">Terrain 2M</span>${item.zone ? `<span class="field-evidence-phase12-tag">${esc(item.zone)}</span>` : ''}${item.requiresFieldConfirmation ? '<span class="field-evidence-phase12-tag confirm">À confirmer</span>' : ''}</div>
        <strong>${esc(item.caption || 'Photo terrain 2M')}</strong>${item.note ? `<small>${esc(item.note)}</small>` : ''}
      </div></article>`);
  }
  return cards.join('');
}

export async function enhancePhase12FieldEvidence360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.fieldEvidencePhase12 === '1' || modal.dataset.fieldEvidencePhase12Busy === '1') return false;
  modal.dataset.fieldEvidencePhase12Busy = '1';
  try {
    /*
     * CONSULTER N'EST PAS ENSEMENCER (#108).
     *
     * Ce panneau se réveille sur un MutationObserver de `#app`, donc à CHAQUE fiche 360
     * insérée. L'ensemencement appelé ici s'exécutait alors à chaque ouverture : dix
     * consultations de la même fiche produisaient 974 PUT, sans intention utilisateur.
     * Le démarrage pose ces données une fois ; une lecture n'a pas à les reposer. Le
     * panneau rend donc ce qui existe, et se tait quand il n'existe pas encore.
     */
    const equipment = await equipmentFrom360(modal);
    if (!equipment) return false;
    // La relation catalogue peut être posée par l'ensemencement du démarrage APRÈS l'ouverture
    // de cette fiche : on relit donc l'équipement quand elle manque. C'est une LECTURE, pas
    // la réparation par `ensureEquipmentMediaLinkage()` qui écrivait ici à chaque ouverture.
    const refreshed = equipment.catalogId
      ? equipment
      : await db.get('equipments', db.normalizeKey ? db.normalizeKey(equipment.id) : equipment.id).catch(() => equipment);
    const catalogId = String(refreshed?.catalogId || '').trim();
    if (!catalogId) return false;
    const catalog = await db.get('docs', catalogId).catch(() => null);
    const evidence = asArray(catalog?.fieldEvidenceImages).filter(item => String(item?.assetId || '').startsWith('2m-field12-'));
    if (!evidence.length) return false;
    const markup = await evidenceMarkup(evidence);
    if (!markup) return false;
    injectStyles();
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;
    const section = document.createElement('section');
    section.className = 'ops-card equipment-field-evidence-phase12-card';
    section.innerHTML = `<h3><i class="fas fa-camera-retro"></i> Preuves terrain 2M — complément</h3>
      <p class="field-evidence-warning">Nouvelles vues terrain : équipement, famille ou baie. Elles ne deviennent ni photo constructeur ni photo d’instance ; les références non lisibles restent « à confirmer ».</p>
      <div class="field-evidence-phase12-grid">${markup}</div>`;
    const previous = target.querySelector('.equipment-field-evidence-card');
    const media = target.querySelector('.equipment-media-card');
    if (previous?.nextSibling) target.insertBefore(section, previous.nextSibling);
    else if (previous) target.appendChild(section);
    else if (media?.nextSibling) target.insertBefore(section, media.nextSibling);
    else target.prepend(section);
    modal.dataset.fieldEvidencePhase12 = '1';
    return true;
  } finally { delete modal.dataset.fieldEvidencePhase12Busy; }
}

let timer = null;
function schedule(delay = 450) {
  clearTimeout(timer);
  timer = setTimeout(() => ensureEquipmentFieldEvidencePhase12().catch(error => console.warn('Preuves terrain Phase 12 indisponibles', error)), delay);
}
function scheduleModal(modal) {
  if (!modal) return;
  queueMicrotask(() => enhancePhase12FieldEvidence360(modal).catch(() => {}));
  setTimeout(() => enhancePhase12FieldEvidence360(modal).catch(() => {}), 220);
  setTimeout(() => enhancePhase12FieldEvidence360(modal).catch(() => {}), 1100);
}
function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.fieldEvidencePhase12Observer === '1') return;
  host.dataset.fieldEvidencePhase12Observer = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) scheduleModal(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) scheduleModal(existing);
}

if (typeof window !== 'undefined') {
  window.EquipmentFieldEvidencePhase12 = Object.freeze({
    version:EQUIPMENT_FIELD_EVIDENCE_PHASE12_VERSION,
    assets:FIELD_EVIDENCE_PHASE12_ASSETS,
    catalogPatches:FIELD_EVIDENCE_PHASE12_CATALOG_PATCHES,
    resolveAsset:resolveFieldEvidencePhase12Asset,
    ensure:ensureEquipmentFieldEvidencePhase12,
    enhance360:enhancePhase12FieldEvidence360
  });
  installObserver();
  window.addEventListener('inventory-master-imported', () => schedule());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') schedule(); });
  await ensureEquipmentFieldEvidencePhase12().catch(error => console.warn('Preuves terrain Phase 12 non initialisées', error));
  schedule(2200);
}
