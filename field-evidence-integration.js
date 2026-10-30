import { db } from './db.js';
import { ensureEquipmentFieldEvidence, resolveFieldEvidenceAsset, EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT } from './equipment-field-evidence.js';
import { ensureEquipmentMediaLinkage } from './equipment-media-linkage.js';
import { ensureGrilleCentraleKnowledge } from './grille-centrale-knowledge.js';
import { ensureGrilleCentraleTopology, GRILLE_CENTRALE_ROUTER_ID } from './grille-centrale-topology.js';
import { peekGrilleCentraleDataset } from './grille-centrale-dataset.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';

export const FIELD_EVIDENCE_INTEGRATION_VERSION = 1;
const GRILLE_CATALOG_ID = 'kb-grille-centrale-190x184';

const asArray = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true || record?.imageResearch?.origin === 'admin';
}

function mergeById(current, incoming) {
  const map = new Map();
  for (const item of [...asArray(current), ...asArray(incoming)]) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    map.set(id, { ...(map.get(id) || {}), ...item, id });
  }
  return [...map.values()];
}

/*
 * LA CONFIRMATION TERRAIN NE S'ÉCRIT QU'APRÈS AUTORISATION (#142).
 *
 * Cette fonction appelait bien `ensureGrilleCentraleKnowledge()`, qui se tait sans
 * habilitation — puis écrivait quand même SES PROPRES constantes : l'implantation du
 * châssis de la matrice, son constructeur et sa famille, nommés en clair ici. Un client
 * anonyme repartait donc avec l'identité matérielle de la matrice écrite dans sa base
 * locale, alors que le serveur venait de lui refuser le jeu de données.
 *
 * Un commentaire se télécharge comme le reste du module : celui-ci ne redit donc pas les
 * valeurs qu'il explique.
 *
 * La charge vient maintenant du jeu de données autorisé. `peek` ne déclenche aucune requête
 * supplémentaire : `ensureGrilleCentraleKnowledge()` vient de trancher juste au-dessus.
 * Sans jeu de données, on rend la main sans rien écrire.
 */
async function confirmGrilleCentraleFromFieldPhoto() {
  await ensureGrilleCentraleKnowledge();
  await ensureGrilleCentraleTopology();

  const confirmation = peekGrilleCentraleDataset()?.knowledgeSeed?.fieldPhotoConfirmation;
  if (!confirmation) return { authorized:false, version:FIELD_EVIDENCE_INTEGRATION_VERSION, catalogUpdated:false, routerUpdated:false };
  const GRILLE_FIELD_ASSET_ID = confirmation.assetId;

  await db.open();

  let catalogUpdated = false;
  let routerUpdated = false;
  const catalog = await db.get('docs', GRILLE_CATALOG_ID).catch(() => null);
  if (catalog && !adminLocked(catalog)) {
    const manufacturerValue = String(catalog.manufacturer || '').trim();
    const safeManufacturer = !manufacturerValue || /identifier|inconnu|unknown|harris/i.test(manufacturerValue)
      ? 'Harris Broadcast'
      : manufacturerValue;
    const technicalFacts = mergeById(catalog.technicalFacts || catalog.facts, confirmation.catalogFacts);
    const { imageResearchReason, ...confirmedFields } = confirmation.catalogFields;
    const next = {
      ...catalog,
      ...confirmedFields,
      manufacturer:safeManufacturer,
      technicalFacts,
      imageResearch:{
        ...(catalog.imageResearch || {}),
        status:'model-required',
        modelRequired:true,
        reason:imageResearchReason
      },
      fieldEvidenceIntegrationVersion:FIELD_EVIDENCE_INTEGRATION_VERSION,
      fieldEvidenceIntegrationUpdatedAt:EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT
    };
    if (!recordsExactlyEqual(next, catalog)) {
      await db.save('docs', next);
      catalogUpdated = true;
    }
  }

  const router = await db.get('docs', GRILLE_CENTRALE_ROUTER_ID).catch(() => null);
  if (router && !adminLocked(router)) {
    const baseNote = String(router.note || '').replace(/\s*Photo terrain 2M[^.]*\.?/gi, '').trim();
    const note = `${baseNote}${baseNote ? ' ' : ''}${confirmation.routerNote}`;
    const next = {
      ...router,
      ...confirmation.routerFields,
      fieldEvidenceAssetId:GRILLE_FIELD_ASSET_ID,
      fieldEvidenceObservedAt:EQUIPMENT_FIELD_EVIDENCE_OBSERVED_AT,
      note,
      fieldEvidenceIntegrationVersion:FIELD_EVIDENCE_INTEGRATION_VERSION
    };
    if (!recordsExactlyEqual(next, router)) {
      await db.save('docs', next);
      routerUpdated = true;
    }
  }

  return { catalogUpdated, routerUpdated };
}

async function equipmentFrom360(modal) {
  const explicitId = String(modal?.dataset?.equipmentId || '').trim();
  if (explicitId) {
    const equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(explicitId) : explicitId).catch(() => null);
    if (equipment) return equipment;
  }
  const name = modal?.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
  if (!name) return null;
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const target = normalized(name);
  const matches = (await db.getAll('equipments')).filter(item => normalized(item.name || item.nom || item.reference) === target);
  return matches.length === 1 ? matches[0] : null;
}

function injectStyles() {
  if (document.getElementById('field-evidence-360-styles')) return;
  const style = document.createElement('style');
  style.id = 'field-evidence-360-styles';
  style.textContent = `
    .field-evidence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
    .field-evidence-item{border:1px solid var(--border,#dce4e8);border-radius:12px;overflow:hidden;background:var(--surface,#fff)}
    .field-evidence-item img{display:block;width:100%;height:150px;object-fit:cover;background:#101820}
    .field-evidence-copy{padding:9px;display:grid;gap:5px}.field-evidence-copy strong{font-size:12px;line-height:1.35}.field-evidence-copy small{font-size:11px;color:var(--text-muted,#667783);line-height:1.35}
    .field-evidence-tags{display:flex;flex-wrap:wrap;gap:5px}.field-evidence-tag{font-size:10px;font-weight:800;border-radius:999px;padding:3px 7px;background:rgba(40,116,166,.12)}
    .field-evidence-tag.confirm{background:rgba(230,126,34,.13)}.field-evidence-warning{font-size:12px;line-height:1.5;color:var(--text-muted,#667783);margin:0 0 10px}
  `;
  document.head.appendChild(style);
}

async function evidenceMarkup(items) {
  const cards = [];
  for (const item of items) {
    const url = await resolveFieldEvidenceAsset(item.assetId).catch(() => '');
    if (!url) continue;
    cards.push(`<article class="field-evidence-item">
      <img src="${esc(url)}" alt="${esc(item.caption || 'Preuve terrain 2M')}" loading="lazy">
      <div class="field-evidence-copy">
        <div class="field-evidence-tags"><span class="field-evidence-tag">Terrain 2M</span>${item.zone ? `<span class="field-evidence-tag">${esc(item.zone)}</span>` : ''}${item.requiresFieldConfirmation ? '<span class="field-evidence-tag confirm">À confirmer</span>' : ''}</div>
        <strong>${esc(item.caption || 'Photo terrain 2M')}</strong>
        ${item.note ? `<small>${esc(item.note)}</small>` : ''}
      </div>
    </article>`);
  }
  return cards.join('');
}

export async function enhanceFieldEvidence360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.fieldEvidence360 === '1' || modal.dataset.fieldEvidence360Busy === '1') return false;
  modal.dataset.fieldEvidence360Busy = '1';
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
    const evidence = asArray(catalog?.fieldEvidenceImages);
    if (!evidence.length) return false;
    const markup = await evidenceMarkup(evidence);
    if (!markup) return false;

    injectStyles();
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;
    const section = document.createElement('section');
    section.className = 'ops-card equipment-field-evidence-card';
    section.innerHTML = `<h3><i class="fas fa-camera-retro"></i> Preuves terrain 2M (baie / famille)</h3>
      <p class="field-evidence-warning">Ces photos documentent la baie, la famille ou le contexte 2M. Elles ne sont jamais affectées automatiquement comme photo de l’instance, et ne remplacent jamais une photo constructeur. Une identification « à confirmer » reste explicitement non résolue.</p>
      <div class="field-evidence-grid">${markup}</div>`;
    const mediaCard = target.querySelector('.equipment-media-card');
    if (mediaCard?.nextSibling) target.insertBefore(section, mediaCard.nextSibling);
    else if (mediaCard) target.appendChild(section);
    else target.prepend(section);
    modal.dataset.fieldEvidence360 = '1';
    return true;
  } finally {
    delete modal.dataset.fieldEvidence360Busy;
  }
}

async function runFieldEvidenceIntegrationCore() {
  const field = await ensureEquipmentFieldEvidence();
  const linkage = await ensureEquipmentMediaLinkage();
  const grille = await confirmGrilleCentraleFromFieldPhoto();
  return { version:FIELD_EVIDENCE_INTEGRATION_VERSION, field, linkage, grille };
}

/*
 * UN SEUL PASSAGE EN COURS (#98).
 *
 * `grille-centrale-physical-architecture.js` importe et rappelle aussi cette
 * fonction, en plus du déclenchement propre de ce fichier et de ses reprises
 * différées (`scheduleReconcile`). `ensureEquipmentFieldEvidence()` et
 * `ensureEquipmentMediaLinkage()` ont chacune leur propre garde (voir
 * catalog-enrichment-gate.js) ; cette garde locale évite en plus que
 * `confirmGrilleCentraleFromFieldPhoto()` — qui n'a pas cette garde partagée,
 * la Grille Centrale n'étant pas touchée par cette correction — ne s'exécute
 * deux fois en parallèle sur elle-même.
 */
let vol = null;
export function ensureFieldEvidenceIntegration() {
  if (vol) return vol;
  vol = runFieldEvidenceIntegrationCore().finally(() => { vol = null; });
  return vol;
}

let reconcileTimer = null;
function scheduleReconcile(delay = 700) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureFieldEvidenceIntegration().catch(error => console.warn('Intégration preuves terrain 2M indisponible', error)), delay);
}

function schedule360(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceFieldEvidence360(modal).catch(() => {}));
  setTimeout(() => enhanceFieldEvidence360(modal).catch(() => {}), 180);
  setTimeout(() => enhanceFieldEvidence360(modal).catch(() => {}), 900);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.fieldEvidence360Observer === '1') return;
  host.dataset.fieldEvidence360Observer = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule360(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360(existing);
}

if (typeof window !== 'undefined') {
  window.FieldEvidenceIntegration = Object.freeze({
    version:FIELD_EVIDENCE_INTEGRATION_VERSION,
    ensure:ensureFieldEvidenceIntegration,
    enhance360:enhanceFieldEvidence360,
    confirmGrille:confirmGrilleCentraleFromFieldPhoto
  });
  installObserver();
  window.addEventListener('inventory-master-imported', () => scheduleReconcile(900));
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') scheduleReconcile(900); });
  window.addEventListener('equipment-field-evidence-updated', () => scheduleReconcile(500));
  await ensureFieldEvidenceIntegration().catch(error => console.warn('Intégration preuves terrain 2M non initialisée', error));
  // Les seeds historiques Grille Centrale ont leur propre reprise différée ; ces
  // deux passages garantissent que la preuve terrain, plus récente et plus forte,
  // reste l’état final sans modifier les décisions Admin.
  setTimeout(() => scheduleReconcile(0), 2600);
  setTimeout(() => scheduleReconcile(0), 5200);
}
