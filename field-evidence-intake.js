import { db } from './db.js';

export const FIELD_EVIDENCE_INTAKE_VERSION = 1;
export const FIELD_EVIDENCE_BATCH_KIND = 'field_evidence_batch';
export const FIELD_EVIDENCE_ITEM_KIND = 'field_evidence_intake';
export const FIELD_EVIDENCE_LINK_KIND = 'field_evidence_link';
export const FIELD_EVIDENCE_INTAKE_ORIGIN = 'field-evidence-intake';

export const FIELD_EVIDENCE_SOURCE_CONTEXTS = Object.freeze([
  'fixed-site',
  'mobile-production-unit',
  'temporary-installation',
  'unknown'
]);

export const FIELD_EVIDENCE_CAPTURE_TYPES = Object.freeze([
  'field-photo',
  'label-photo',
  'front-panel-photo',
  'rear-panel-photo',
  'rack-overview-photo',
  'patch-panel-photo',
  'cable-trace-photo',
  'document-photo'
]);

export const FIELD_EVIDENCE_CLASSIFICATIONS = Object.freeze([
  'unreviewed',
  'exact-device',
  'family-only',
  'function-only',
  'physical-context',
  'connection-observed',
  'label-only',
  'ambiguous'
]);

export const FIELD_EVIDENCE_REVIEW_STATES = Object.freeze([
  'pending',
  'accepted',
  'needs-more-evidence',
  'rejected'
]);

export const FIELD_EVIDENCE_LINK_STATES = Object.freeze([
  'unlinked',
  'candidate',
  'confirmed'
]);

export const FIELD_EVIDENCE_INTAKE_POLICY = Object.freeze({
  noAutomaticInventoryCreation:true,
  noAutomaticCatalogPromotion:true,
  noAutomaticTopologyCreation:true,
  noAutomaticCableInference:true,
  noAutomaticCrosspointInference:true,
  noFuzzyExactModelPromotion:true,
  preserveOriginalEvidenceReference:true,
  sensitiveVisibleTextRedactedByDefault:true,
  reviewRequiredBeforeConfirmedLink:true,
  ambiguousEvidenceMustRemainAmbiguous:true,
  sourceLayers:Object.freeze(['raw-field-evidence','reviewed-observation','confirmed-link','domain-integration'])
});

export const MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST = Object.freeze([
  Object.freeze({ id:'context-exterior', label:'Vue de contexte extérieur', proves:'Contexte physique uniquement ; ne prouve aucun équipement interne.' }),
  Object.freeze({ id:'context-interior', label:'Vues générales de l’intérieur', proves:'Organisation visuelle et zones observables uniquement.' }),
  Object.freeze({ id:'rack-front', label:'Chaque baie/rack de face, du haut vers le bas', proves:'Présence visible et repères frontaux.' }),
  Object.freeze({ id:'rack-rear', label:'Chaque baie/rack côté arrière si accessible en sécurité', proves:'Connecteurs, câbles et repères réellement visibles.' }),
  Object.freeze({ id:'device-label', label:'Étiquette/référence lisible de chaque équipement', proves:'Constructeur/modèle uniquement si le texte est lisible.' }),
  Object.freeze({ id:'patching', label:'Patch panels, routeurs, matrices et panneaux de raccordement', proves:'Repères visibles ; aucune liaison n’est déduite sans trace physique.' }),
  Object.freeze({ id:'cable-labels', label:'Repères de câbles aux deux extrémités quand ils sont visibles', proves:'Correspondance physique seulement si les deux extrémités sont démontrées.' }),
  Object.freeze({ id:'signal-control', label:'Zones vidéo/audio/sync/intercom/réseau clairement séparées', proves:'Fonction/contextes visibles ; pas de protocole ou flux live déduit.' })
]);

const clean = value => String(value ?? '').trim();
const asArray = value => Array.isArray(value) ? value : (value == null ? [] : [value]);
const now = () => new Date().toISOString();
const allowed = (set, value) => set.includes(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const normalize = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const CREDENTIAL_RE = /\b(password|passwd|mot\s*de\s*passe|token|api[ _-]?key|secret)\b\s*[:=]\s*([^\s,;]+)/gi;

export function redactFieldEvidenceText(value) {
  const original = clean(value);
  const redactions = [];
  if (!original) return { text:'', redactions };
  let text = original.replace(CREDENTIAL_RE, (_match, label) => {
    redactions.push('credential');
    return `${label}: [MASQUÉ]`;
  });
  text = text.replace(IPV4_RE, () => {
    redactions.push('ipv4');
    return '[IP MASQUÉE]';
  });
  return { text, redactions:[...new Set(redactions)] };
}

function sanitizeTextList(values) {
  const redactions = new Set();
  const sanitized = [];
  for (const value of asArray(values)) {
    const result = redactFieldEvidenceText(value);
    if (result.text) sanitized.push(result.text);
    for (const item of result.redactions) redactions.add(item);
  }
  return { values:sanitized, redactions:[...redactions] };
}

function sanitizeObservedFacts(facts) {
  const redactions = new Set();
  const sanitized = [];
  for (const fact of asArray(facts)) {
    if (!fact || typeof fact !== 'object') continue;
    const label = redactFieldEvidenceText(fact.label || fact.key || 'Observation');
    const value = redactFieldEvidenceText(fact.value ?? fact.text ?? '');
    for (const item of [...label.redactions, ...value.redactions]) redactions.add(item);
    if (!value.text) continue;
    sanitized.push({
      id:clean(fact.id) || `fact-${sanitized.length + 1}`,
      label:label.text || 'Observation',
      value:value.text,
      confidence:['high','medium','low'].includes(clean(fact.confidence).toLowerCase()) ? clean(fact.confidence).toLowerCase() : 'medium',
      exact:Boolean(fact.exact),
      sourceRegion:clean(fact.sourceRegion || '')
    });
  }
  return { values:sanitized, redactions:[...redactions] };
}

function adminLocked(record) {
  const origin = clean(record?.origin).toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true;
}

function uniqueId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function isHistoricalDocumentOnly(record = {}) {
  return clean(record.captureType) === 'document-photo' && /201[0-9]|200[0-9]|histor|archive|synoptique/i.test(`${record.sourceLabel || ''} ${record.notes || ''}`);
}

export function validateFieldEvidenceBatch(input = {}) {
  const errors = [];
  const sourceContext = clean(input.sourceContext || 'unknown').toLowerCase();
  const sourceLabel = clean(input.sourceLabel);
  const observedAt = clean(input.observedAt);
  if (!allowed(FIELD_EVIDENCE_SOURCE_CONTEXTS, sourceContext)) errors.push('Contexte de source terrain invalide.');
  if (!sourceLabel) errors.push('Le libellé de la source/zone est obligatoire.');
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push('La date/heure du lot terrain est obligatoire.');
  return { valid:errors.length === 0, errors, normalized:{ sourceContext, sourceLabel, observedAt } };
}

export function validateFieldEvidenceItem(input = {}) {
  const errors = [];
  const batchId = clean(input.batchId);
  const assetRef = clean(input.assetRef);
  const captureType = clean(input.captureType || 'field-photo').toLowerCase();
  const sourceContext = clean(input.sourceContext || 'unknown').toLowerCase();
  const sourceLabel = clean(input.sourceLabel);
  const observedAt = clean(input.observedAt);
  const classification = clean(input.classification || 'unreviewed').toLowerCase();
  const reviewState = clean(input.reviewState || 'pending').toLowerCase();
  const linkState = clean(input.linkState || 'unlinked').toLowerCase();

  if (!batchId) errors.push('Le lot de preuves est obligatoire.');
  if (!assetRef) errors.push('Une référence média/asset est obligatoire.');
  if (!allowed(FIELD_EVIDENCE_CAPTURE_TYPES, captureType)) errors.push('Type de capture invalide.');
  if (!allowed(FIELD_EVIDENCE_SOURCE_CONTEXTS, sourceContext)) errors.push('Contexte de source invalide.');
  if (!sourceLabel) errors.push('La zone/source de la photo est obligatoire.');
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push('La date/heure d’observation est obligatoire.');
  if (!allowed(FIELD_EVIDENCE_CLASSIFICATIONS, classification)) errors.push('Classification de preuve invalide.');
  if (!allowed(FIELD_EVIDENCE_REVIEW_STATES, reviewState)) errors.push('État de revue invalide.');
  if (!allowed(FIELD_EVIDENCE_LINK_STATES, linkState)) errors.push('État de liaison invalide.');
  if (reviewState === 'accepted' && classification === 'unreviewed') errors.push('Une preuve acceptée doit avoir une classification explicite.');
  if (linkState === 'confirmed' && reviewState !== 'accepted') errors.push('Une liaison confirmée exige une preuve revue et acceptée.');
  if (classification === 'ambiguous' && linkState === 'confirmed') errors.push('Une preuve ambiguë ne peut pas produire une liaison confirmée.');

  return { valid:errors.length === 0, errors, normalized:{ batchId, assetRef, captureType, sourceContext, sourceLabel, observedAt, classification, reviewState, linkState } };
}

export async function createFieldEvidenceBatch(input = {}) {
  await db.open();
  const checked = validateFieldEvidenceBatch(input);
  if (!checked.valid) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_FIELD_EVIDENCE_BATCH';
    error.details = checked.errors;
    throw error;
  }
  const id = clean(input.id) || uniqueId('field-batch');
  const existing = await db.get('docs', id).catch(() => null);
  if (existing && adminLocked(existing)) throw new Error('Lot terrain protégé par une décision Admin.');
  const description = redactFieldEvidenceText(input.description || '');
  const record = {
    ...(existing || {}),
    id,
    kind:FIELD_EVIDENCE_BATCH_KIND,
    targetType:'field_evidence_batch',
    title:clean(input.title) || checked.normalized.sourceLabel,
    sourceContext:checked.normalized.sourceContext,
    sourceLabel:checked.normalized.sourceLabel,
    observedAt:checked.normalized.observedAt,
    description:description.text,
    sensitiveRedactions:description.redactions,
    status:clean(input.status || 'open') === 'closed' ? 'closed' : 'open',
    itemIds:asArray(existing?.itemIds).map(clean).filter(Boolean),
    policy:FIELD_EVIDENCE_INTAKE_POLICY,
    origin:FIELD_EVIDENCE_INTAKE_ORIGIN,
    intakeVersion:FIELD_EVIDENCE_INTAKE_VERSION,
    updatedAt:now(),
    createdAt:existing?.createdAt || now()
  };
  await db.save('docs', record);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('field-evidence-intake-updated', { detail:{ type:'batch', id } }));
  return record;
}

export async function stageFieldEvidenceItem(input = {}) {
  await db.open();
  const checked = validateFieldEvidenceItem(input);
  if (!checked.valid) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_FIELD_EVIDENCE_ITEM';
    error.details = checked.errors;
    throw error;
  }
  const batch = await db.get('docs', checked.normalized.batchId).catch(() => null);
  if (!batch || batch.kind !== FIELD_EVIDENCE_BATCH_KIND) throw new Error('Lot de preuves terrain introuvable.');
  if (batch.status === 'closed') throw new Error('Ce lot terrain est fermé.');

  const id = clean(input.id) || uniqueId('field-evidence');
  const existing = await db.get('docs', id).catch(() => null);
  if (existing && adminLocked(existing)) throw new Error('Preuve terrain protégée par une décision Admin.');
  const visible = sanitizeTextList(input.visibleText);
  const facts = sanitizeObservedFacts(input.observedFacts);
  const notes = redactFieldEvidenceText(input.notes || '');
  const proposed = input.proposedLink && typeof input.proposedLink === 'object' ? {
    targetType:clean(input.proposedLink.targetType),
    targetId:clean(input.proposedLink.targetId),
    reason:redactFieldEvidenceText(input.proposedLink.reason || '').text,
    confidence:['high','medium','low'].includes(clean(input.proposedLink.confidence).toLowerCase()) ? clean(input.proposedLink.confidence).toLowerCase() : 'low'
  } : null;

  const sensitiveRedactions = [...new Set([...visible.redactions, ...facts.redactions, ...notes.redactions])];
  const record = {
    ...(existing || {}),
    id,
    kind:FIELD_EVIDENCE_ITEM_KIND,
    targetType:'field_evidence',
    batchId:checked.normalized.batchId,
    assetRef:checked.normalized.assetRef,
    captureType:checked.normalized.captureType,
    sourceContext:checked.normalized.sourceContext,
    sourceLabel:checked.normalized.sourceLabel,
    observedAt:checked.normalized.observedAt,
    classification:checked.normalized.classification,
    reviewState:checked.normalized.reviewState,
    linkState:checked.normalized.linkState,
    visibleText:visible.values,
    observedFacts:facts.values,
    notes:notes.text,
    sensitiveRedactions,
    proposedLink:proposed,
    historicalDocumentOnly:isHistoricalDocumentOnly({ ...input, captureType:checked.normalized.captureType, sourceLabel:checked.normalized.sourceLabel, notes:notes.text }),
    automaticPromotionApplied:false,
    topologyCreated:false,
    cableCreated:false,
    crosspointCreated:false,
    originalEvidenceRef:checked.normalized.assetRef,
    origin:FIELD_EVIDENCE_INTAKE_ORIGIN,
    intakeVersion:FIELD_EVIDENCE_INTAKE_VERSION,
    updatedAt:now(),
    createdAt:existing?.createdAt || now()
  };
  await db.save('docs', record);
  const itemIds = [...new Set([...asArray(batch.itemIds).map(clean).filter(Boolean), id])];
  await db.save('docs', { ...batch, itemIds, updatedAt:now() });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('field-evidence-intake-updated', { detail:{ type:'item', id, batchId:batch.id } }));
  return record;
}

export async function reviewFieldEvidenceItem(id, review = {}) {
  await db.open();
  const record = await db.get('docs', clean(id)).catch(() => null);
  if (!record || record.kind !== FIELD_EVIDENCE_ITEM_KIND) throw new Error('Preuve terrain introuvable.');
  if (adminLocked(record)) throw new Error('Preuve terrain protégée par une décision Admin.');
  const reviewState = clean(review.reviewState || record.reviewState).toLowerCase();
  const classification = clean(review.classification || record.classification).toLowerCase();
  const linkState = clean(review.linkState || record.linkState || 'unlinked').toLowerCase();
  const checked = validateFieldEvidenceItem({ ...record, reviewState, classification, linkState });
  if (!checked.valid) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_FIELD_EVIDENCE_REVIEW';
    throw error;
  }
  const reviewerNote = redactFieldEvidenceText(review.reviewerNote || '');
  const next = {
    ...record,
    reviewState,
    classification,
    linkState,
    reviewer:clean(review.reviewer),
    reviewerNote:reviewerNote.text,
    sensitiveRedactions:[...new Set([...asArray(record.sensitiveRedactions), ...reviewerNote.redactions])],
    reviewedAt:now(),
    updatedAt:now()
  };
  await db.save('docs', next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('field-evidence-intake-updated', { detail:{ type:'review', id:next.id } }));
  return next;
}

const LINK_TARGET_STORES = Object.freeze({
  equipment:'equipments',
  room:'rooms',
  baie:'baies',
  document:'docs',
  catalog:'docs',
  topology:'docs'
});

export async function confirmFieldEvidenceLink(itemId, target = {}) {
  await db.open();
  const item = await db.get('docs', clean(itemId)).catch(() => null);
  if (!item || item.kind !== FIELD_EVIDENCE_ITEM_KIND) throw new Error('Preuve terrain introuvable.');
  if (item.reviewState !== 'accepted') throw new Error('La preuve doit être revue et acceptée avant une liaison confirmée.');
  if (item.classification === 'ambiguous' || item.classification === 'unreviewed') throw new Error('Une preuve ambiguë/non revue ne peut pas être liée comme fait confirmé.');
  const targetType = clean(target.targetType).toLowerCase();
  const targetId = clean(target.targetId);
  const store = LINK_TARGET_STORES[targetType];
  if (!store || !targetId) throw new Error('Cible de liaison invalide.');
  const targetRecord = await db.get(store, db.normalizeKey && store !== 'docs' ? db.normalizeKey(targetId) : targetId).catch(() => null);
  if (!targetRecord) throw new Error('La cible de liaison n’existe pas dans les données canoniques.');
  if (item.historicalDocumentOnly && ['connection-observed','exact-device'].includes(item.classification)) {
    throw new Error('Un document historique seul ne peut pas être promu en preuve as-built actuelle.');
  }
  const id = `field-link-${item.id}-${targetType}-${targetId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const link = {
    id,
    kind:FIELD_EVIDENCE_LINK_KIND,
    targetType:'field_evidence_link',
    evidenceItemId:item.id,
    linkedTargetType:targetType,
    linkedTargetId:targetId,
    classification:item.classification,
    observedAt:item.observedAt,
    assetRef:item.assetRef,
    linkStatus:'confirmed',
    doesNotMutateTarget:true,
    domainIntegrationRequired:true,
    origin:FIELD_EVIDENCE_INTAKE_ORIGIN,
    intakeVersion:FIELD_EVIDENCE_INTAKE_VERSION,
    createdAt:now(),
    updatedAt:now()
  };
  await db.save('docs', link);
  await db.save('docs', { ...item, linkState:'confirmed', confirmedLinkId:id, confirmedTarget:{ targetType, targetId }, updatedAt:now() });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('field-evidence-intake-updated', { detail:{ type:'link', id, itemId:item.id } }));
  return link;
}

export async function getFieldEvidenceIntakeSnapshot() {
  await db.open();
  const docs = await db.getAll('docs');
  const batches = docs.filter(item => item?.kind === FIELD_EVIDENCE_BATCH_KIND);
  const items = docs.filter(item => item?.kind === FIELD_EVIDENCE_ITEM_KIND);
  const links = docs.filter(item => item?.kind === FIELD_EVIDENCE_LINK_KIND);
  const counts = {
    batches:batches.length,
    openBatches:batches.filter(item => item.status !== 'closed').length,
    items:items.length,
    pending:items.filter(item => item.reviewState === 'pending').length,
    accepted:items.filter(item => item.reviewState === 'accepted').length,
    needsMoreEvidence:items.filter(item => item.reviewState === 'needs-more-evidence').length,
    rejected:items.filter(item => item.reviewState === 'rejected').length,
    confirmedLinks:links.filter(item => item.linkStatus === 'confirmed').length,
    redacted:items.filter(item => asArray(item.sensitiveRedactions).length > 0).length
  };
  return { version:FIELD_EVIDENCE_INTAKE_VERSION, policy:FIELD_EVIDENCE_INTAKE_POLICY, counts, batches, items, links };
}

export function exportFieldEvidenceManifest(snapshot) {
  return {
    format:'2m-tech-field-evidence-manifest',
    version:FIELD_EVIDENCE_INTAKE_VERSION,
    exportedAt:now(),
    policy:FIELD_EVIDENCE_INTAKE_POLICY,
    counts:snapshot.counts,
    batches:snapshot.batches,
    items:snapshot.items,
    links:snapshot.links
  };
}

export class FieldEvidenceInbox {
  constructor(notifications = null) {
    this.notifications = notifications;
    this.snapshot = null;
  }

  async render() {
    this.snapshot = await getFieldEvidenceIntakeSnapshot();
    const c = this.snapshot.counts;
    return `<div class="card field-evidence-intake-page">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div><h2 style="margin:0 0 4px"><i class="fas fa-camera-retro"></i> Preuves terrain — Inbox</h2><small>Zone de staging/revue avant toute intégration dans l’inventaire, le catalogue, les câbles ou la topologie.</small></div>
        <button class="btn" id="field-evidence-export"><i class="fas fa-download"></i> Export manifeste</button>
      </div>
      <div class="field-intake-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:14px 0">
        ${[['Lots',c.batches],['Photos/éléments',c.items],['À revoir',c.pending],['Acceptés',c.accepted],['Preuve insuffisante',c.needsMoreEvidence],['Liens confirmés',c.confirmedLinks]].map(([label,value]) => `<div style="border:1px solid var(--border,#dce4e8);border-radius:10px;padding:10px"><small>${esc(label)}</small><strong style="display:block;font-size:20px">${esc(value)}</strong></div>`).join('')}
      </div>
      <div style="padding:10px;border-radius:10px;background:rgba(142,68,173,.08);font-size:12px;line-height:1.5"><strong>Contrat de preuve :</strong> aucune photo n’ajoute automatiquement un équipement, un modèle exact, un câble, un port physique ou un crosspoint. Les données visibles sensibles sont masquées par défaut et une liaison confirmée exige une revue explicite.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><input id="field-evidence-search" placeholder="Rechercher lot, zone, asset, texte visible…" style="flex:1;min-width:240px;padding:8px"><select id="field-evidence-filter" style="padding:8px"><option value="all">Tous</option><option value="pending">À revoir</option><option value="accepted">Acceptés</option><option value="needs-more-evidence">Preuve insuffisante</option><option value="rejected">Rejetés</option></select></div>
      <div id="field-evidence-list" style="display:grid;gap:8px">${this.renderItems(this.snapshot.items)}</div>
      <details style="margin-top:14px"><summary><strong>Checklist photo — unité de production mobile / Régie car</strong></summary><div style="display:grid;gap:6px;margin-top:8px">${MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST.map(item => `<div style="padding:8px;border:1px solid var(--border,#dce4e8);border-radius:8px"><strong>${esc(item.label)}</strong><br><small>${esc(item.proves)}</small></div>`).join('')}</div></details>
    </div>`;
  }

  renderItems(items) {
    if (!items.length) return '<div class="empty-state"><p>Aucune preuve en attente. La plateforme est prête à recevoir un futur lot terrain sans pré-créer de faits.</p></div>';
    return items.slice().sort((a,b) => clean(b.observedAt).localeCompare(clean(a.observedAt))).map(item => {
      const search = normalize(`${item.assetRef} ${item.sourceLabel} ${item.classification} ${asArray(item.visibleText).join(' ')} ${asArray(item.observedFacts).map(f => `${f.label} ${f.value}`).join(' ')}`);
      return `<article class="field-intake-item" data-review-state="${esc(item.reviewState)}" data-search="${esc(search)}" style="border:1px solid var(--border,#dce4e8);border-radius:10px;padding:10px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>${esc(item.sourceLabel || item.assetRef)}</strong><span>${esc(item.reviewState)} · ${esc(item.classification)}</span></div><small>${esc(item.assetRef)} · ${esc(item.captureType)} · ${esc(item.observedAt)}</small>${item.sensitiveRedactions?.length ? `<div><small>Masquages sensibles: ${esc(item.sensitiveRedactions.join(', '))}</small></div>` : ''}</article>`;
    }).join('');
  }

  async afterRender() {
    const list = document.getElementById('field-evidence-list');
    const search = document.getElementById('field-evidence-search');
    const filter = document.getElementById('field-evidence-filter');
    const apply = () => {
      const query = normalize(search?.value || '');
      const state = clean(filter?.value || 'all');
      for (const row of list?.querySelectorAll('.field-intake-item') || []) {
        row.hidden = Boolean(query && !row.dataset.search.includes(query)) || (state !== 'all' && row.dataset.reviewState !== state);
      }
    };
    search?.addEventListener('input', apply);
    filter?.addEventListener('change', apply);
    document.getElementById('field-evidence-export')?.addEventListener('click', async () => {
      const snapshot = await getFieldEvidenceIntakeSnapshot();
      const blob = new Blob([JSON.stringify(exportFieldEvidenceManifest(snapshot), null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `2m-field-evidence-manifest-${new Date().toISOString().slice(0,10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}

if (typeof window !== 'undefined') {
  window.FieldEvidenceIntake = Object.freeze({
    version:FIELD_EVIDENCE_INTAKE_VERSION,
    policy:FIELD_EVIDENCE_INTAKE_POLICY,
    mobileCaptureChecklist:MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST,
    validateBatch:validateFieldEvidenceBatch,
    validateItem:validateFieldEvidenceItem,
    createBatch:createFieldEvidenceBatch,
    stage:stageFieldEvidenceItem,
    review:reviewFieldEvidenceItem,
    confirmLink:confirmFieldEvidenceLink,
    snapshot:getFieldEvidenceIntakeSnapshot,
    exportManifest:exportFieldEvidenceManifest
  });
}

export default FieldEvidenceInbox;
