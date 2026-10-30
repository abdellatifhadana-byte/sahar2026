import { db } from './db.js';
import AdminUI from './admin-ui.js';
import ResponsibleUI from './responsible-ui.js';
import TechUISmart from './techui.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';
import { openTicketModal } from './tickets.js';
import { loadTopologySnapshot } from './broadcast-topology.js';
import { analyzeTechnicalSnapshot } from './technical-graph.js';
import {
  CONTINUITY_KINDS, PROTECTION_TYPES, normalizeProtectionGroup,
  normalizeContinuityProcedure, validateContinuityRecord
} from './continuity-contract.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const formatDate = value => value ? new Date(value).toLocaleString('fr-FR') : 'Jamais';
const protectionLabel = value => ({
  'dedicated-device':'Équipement secours dédié', 'alternate-path':'Chemin alternatif',
  'secondary-source':'Source secondaire', 'manual-patch':'Brassage manuel',
  'automatic-failover':'Basculement automatique', 'cold-spare':'Spare à froid',
  'shared-backup':'Secours partagé', 'no-verified-backup':'Aucun secours vérifié'
})[value] || value;
const statusLabel = value => ({ draft:'Brouillon', documented:'Documenté', validated:'Validé', suspended:'Suspendu', retired:'Retiré' })[value] || value;
const equipmentName = item => item?.name || item?.nom || `#${item?.id ?? '?'}`;
const nextRevision = value => {
  const parts = String(value || '1').split('.');
  if (parts.every(part => /^\d+$/.test(part))) { parts[parts.length - 1] = String(Number(parts.at(-1)) + 1); return parts.join('.'); }
  return `${String(value || '1')}.1`;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials:'include', cache:'no-store',
    headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `Erreur serveur (${response.status})`), { status:response.status, code:payload.error });
  return payload;
}

async function saveVerifiedDocument(record) {
  const payload = await api(`/api/data/docs/${encodeURIComponent(record.id)}`, { method:'PUT', body:JSON.stringify(record) });
  const saved = payload.record || record;
  await (db.saveLocalOnly ? db.saveLocalOnly('docs', saved) : db.save('docs', saved));
  return saved;
}

function modalShell(id, title, body) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div'); modal.id = id; modal.className = 'modal continuity-modal';
  modal.innerHTML = `<div class="modal-content continuity-modal-card"><button class="modal-x" type="button" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
  document.body.appendChild(modal); modal.style.display = 'flex';
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  return modal;
}

export class ContinuityCenter {
  constructor(user = getCurrentUser(), notifications = null, { compact = false } = {}) {
    this.user = user; this.notifications = notifications; this.compact = compact;
    this.groups = []; this.procedures = []; this.tests = []; this.equipments = []; this.report = null; this.access = null;
  }

  notify(message, type = 'success') {
    if (this.notifications?.showNotification) this.notifications.showNotification(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  }

  async load() {
    const [docs, equipments, screens, cables, topology] = await Promise.all([
      db.getAll('docs'), db.getAll('equipments'), db.getAll('screens'), db.getAll('cables'), loadTopologySnapshot()
    ]);
    this.groups = docs.filter(item => item.kind === CONTINUITY_KINDS.PROTECTION_GROUP);
    this.procedures = docs.filter(item => item.kind === CONTINUITY_KINDS.PROCEDURE);
    this.tests = docs.filter(item => item.kind === CONTINUITY_KINDS.TEST);
    this.equipments = equipments;
    this.report = analyzeTechnicalSnapshot({ equipments, screens, cables, topology, continuityRecords:[...this.groups, ...this.tests] });
    this.access = await api('/api/access/context').catch(() => ({ zones:[] }));
  }

  proceduresFor(groupId, validatedOnly = false) {
    const candidates = this.procedures.filter(item => String(item.protectionGroupId) === String(groupId));
    const current = validatedOnly ? candidates.filter(item => item.status === 'validated' && !candidates.some(successor => successor.status === 'validated' && String(successor.supersedesId || '') === String(item.id))) : candidates;
    return current.sort((left, right) => new Date(right.validation?.validatedAt || right.updatedAt || 0) - new Date(left.validation?.validatedAt || left.updatedAt || 0));
  }

  latestTest(groupId) {
    return this.tests.filter(item => String(item.protectionGroupId) === String(groupId)).sort((a,b) => new Date(b.performedAt || 0) - new Date(a.performedAt || 0))[0] || null;
  }

  isGlobalAdmin() { return ['admin','manager'].includes(this.user?.role); }
  zoneIdsWith(permission) {
    if (this.isGlobalAdmin()) return new Set((this.access?.zones || []).map(zone => String(zone.id)));
    const memberships = new Set((this.access?.memberships || []).filter(item => !['inactive','revoked'].includes(item.status) && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).map(item => String(item.zoneId)));
    return new Set((this.access?.grants || []).filter(item => item.permission === permission && !['inactive','revoked'].includes(item.status) && memberships.has(String(item.zoneId)) && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).map(item => String(item.zoneId)));
  }
  canEdit() { return PermissionManager.check(this.user, 'continuity', 'edit') && (this.isGlobalAdmin() || this.zoneIdsWith('continuity.edit').size > 0); }
  canValidate() { return PermissionManager.check(this.user, 'continuity', 'validate') && (this.isGlobalAdmin() || this.zoneIdsWith('continuity.validate').size > 0); }
  hasRecordPermission(record, permission) {
    if (this.isGlobalAdmin()) return true;
    const allowed = this.zoneIdsWith(permission);
    const zones = Array.isArray(record?.zoneIds) ? record.zoneIds.map(String) : [];
    return zones.length > 0 && zones.every(zoneId => allowed.has(zoneId));
  }
  canEditRecord(record) { return this.canEdit() && !['validated','retired'].includes(record?.status) && this.hasRecordPermission(record, 'continuity.edit'); }
  canReviseRecord(record) { return this.canEdit() && record?.status === 'validated' && this.hasRecordPermission(record, 'continuity.edit'); }
  canValidateRecord(record) { return this.canValidate() && ['draft','documented'].includes(record?.status) && this.hasRecordPermission(record, 'continuity.validate'); }
  canRetireRecord(record) { return this.canValidate() && record?.status === 'validated' && this.hasRecordPermission(record, 'continuity.validate'); }
  canTestRecord(record) { return PermissionManager.check(this.user, 'continuity', 'test') && this.hasRecordPermission(record, 'continuity.test'); }

  async render() {
    await this.load();
    const s = this.report.summary;
    const groups = this.compact ? this.groups.filter(group => group.status === 'validated' && !this.groups.some(successor => successor.status === 'validated' && String(successor.supersedesId || '') === String(group.id))) : this.groups;
    return `<section class="continuity-center">
      <header class="continuity-hero"><div><h2><i class="fas fa-shield-alt"></i> Continuité antenne</h2><p>Priorité opérationnelle: sécuriser le direct, vérifier le secours, puis diagnostiquer.</p></div>
        ${this.canEdit() && !this.compact ? '<div class="continuity-actions"><button class="btn" data-continuity-add="group"><i class="fas fa-plus"></i> Groupe Principal/Secours</button><button class="btn gray" data-continuity-add="procedure"><i class="fas fa-list-ol"></i> Procédure</button></div>' : ''}
      </header>
      ${!this.compact ? `<div class="continuity-stats">
        <span><b>${this.groups.length}</b><small>Services protégés</small></span>
        <span><b>${s.servicesWithoutAvailableBackup}</b><small>Sans secours disponible</small></span>
        <span><b>${s.singlePointsOfFailure}</b><small>Dépendances communes</small></span>
        <span><b>${s.compatibilityIssues}</b><small>Liaisons à contrôler</small></span>
        <span><b>${s.unresolved}</b><small>Relations non résolues</small></span>
      </div>` : ''}
      <div class="continuity-grid">${groups.length ? groups.map(group => this.renderGroup(group)).join('') : '<div class="continuity-empty">Aucun groupe Principal/Secours visible. Commencez par RF1 sur un périmètre pilote validé.</div>'}</div>
      ${!this.compact && this.report.compatibilityIssues.length ? `<section class="continuity-alerts"><h3>Contrôles de connectivité</h3>${this.report.compatibilityIssues.slice(0,20).map(issue => `<div><strong>${esc(issue.reference || issue.cableId)}</strong><span>${esc(issue.status)}</span><small>${esc(issue.reasons.join(' '))}</small></div>`).join('')}</section>` : ''}
    </section>`;
  }

  renderGroup(group) {
    const procedures = this.proceduresFor(group.id);
    const validated = procedures.filter(item => item.status === 'validated');
    const latest = this.latestTest(group.id);
    const analysis = this.report.protectionGroups.find(item => String(item.groupId) === String(group.id));
    const backup = group.backupPaths?.[0];
    return `<article class="continuity-card status-${esc(group.status)}">
      <div class="continuity-card-head"><div><span class="continuity-status">${esc(statusLabel(group.status))}</span><h3>${esc(group.serviceName || group.name)}</h3><small>${esc(protectionLabel(group.protectionType))} · Rév. ${esc(group.revision || '1')}</small></div><i class="fas fa-broadcast-tower"></i></div>
      <div class="continuity-paths"><div><span>Principal</span><strong>${esc(group.primaryPath?.label || 'À documenter')}</strong></div><i class="fas fa-arrow-right-arrow-left"></i><div><span>Secours</span><strong>${esc(backup?.label || 'Non vérifié')}</strong><small>${esc(backup?.availability || 'unknown')}</small></div></div>
      <div class="continuity-health">
        <span class="${analysis?.hasVerifiedBackup ? 'ok' : analysis?.configurationVerified ? 'warning' : 'danger'}">${analysis?.hasVerifiedBackup ? 'Secours testé disponible' : analysis?.configurationVerified ? 'Configuration validée · test requis' : 'Disponibilité non validée'}</span>
        <span class="${analysis?.singlePointsOfFailure?.length ? 'warning' : 'ok'}">${analysis?.singlePointsOfFailure?.length || 0} dépendance(s) commune(s)</span>
        <span>${procedures.length} procédure(s) · ${validated.length} validée(s)</span>
        <span>Dernier test: ${esc(formatDate(latest?.performedAt))}</span>
      </div>
      <div class="continuity-card-actions">
        ${validated.length && this.canTestRecord(group) ? `<button class="btn warning continuity-secure" data-group-id="${esc(group.id)}"><i class="fas fa-shield-alt"></i> Sécuriser le direct</button>` : `<button class="btn gray" disabled>${validated.length ? 'Exécution non autorisée' : 'Aucune procédure validée'}</button>`}
        <button class="btn gray continuity-details" data-group-id="${esc(group.id)}">Détails</button>
        ${this.canReviseRecord(group) ? `<button class="btn gray continuity-revise" data-id="${esc(group.id)}">Nouvelle révision</button>` : ''}
        ${this.canValidateRecord(group) ? `<button class="btn continuity-validate" data-id="${esc(group.id)}">Valider</button>` : ''}
        ${this.canRetireRecord(group) ? `<button class="btn danger continuity-retire" data-id="${esc(group.id)}">Retirer</button>` : ''}
      </div>
    </article>`;
  }

  async afterRender(root = document) {
    root.querySelectorAll('[data-continuity-add="group"]').forEach(button => button.onclick = () => this.openGroupForm());
    root.querySelectorAll('[data-continuity-add="procedure"]').forEach(button => button.onclick = () => this.openProcedureForm());
    root.querySelectorAll('.continuity-secure').forEach(button => button.onclick = () => this.openSecureWorkflow(button.dataset.groupId));
    root.querySelectorAll('.continuity-details').forEach(button => button.onclick = () => this.openDetails(button.dataset.groupId));
    root.querySelectorAll('.continuity-revise').forEach(button => button.onclick = () => { const group = this.groups.find(item => String(item.id) === String(button.dataset.id)); this.openGroupForm(group, { asRevision:true }); });
    root.querySelectorAll('.continuity-validate').forEach(button => button.onclick = () => this.approve(button.dataset.id));
    root.querySelectorAll('.continuity-retire').forEach(button => button.onclick = () => this.retire(button.dataset.id));
  }

  equipmentOptions(selected = '') {
    return `<option value="">Sélectionner…</option>${this.equipments.map(item => `<option value="${esc(item.id)}" ${String(selected)===String(item.id)?'selected':''}>${esc(equipmentName(item))}</option>`).join('')}`;
  }

  async openGroupForm(group = null, { asRevision = false } = {}) {
    if (!this.canEdit()) return this.notify("Vous n'êtes pas autorisé à documenter la continuité.", 'error');
    if (group && !this.hasRecordPermission(group, 'continuity.edit')) return this.notify("Vous n'êtes pas autorisé dans toutes les zones de ce groupe.", 'error');
    const allowedZoneIds = this.zoneIdsWith('continuity.edit');
    const zones = (this.access?.zones || []).filter(zone => allowedZoneIds.has(String(zone.id)));
    const modal = modalShell('continuity-group-modal', asRevision ? 'Nouvelle révision Principal/Secours' : group ? 'Modifier le groupe Principal/Secours' : 'Nouveau groupe Principal/Secours', `<form class="continuity-form"><div class="continuity-form-grid">
      <label>Service protégé<input name="serviceName" required value="${esc(group?.serviceName || '')}" placeholder="Ex. Diffusion RF1"></label>
      <label>Nom du groupe<input name="name" required value="${esc(group?.name || '')}" placeholder="Ex. RF1 Principal / Secours"></label>
      <label>Zone<select name="zoneId" required><option value="">Sélectionner…</option>${zones.map(zone => `<option value="${esc(zone.id)}" ${(group?.zoneIds||[]).map(String).includes(String(zone.id))?'selected':''}>${esc(zone.name)}</option>`).join('')}</select></label>
      <label>Type de protection<select name="protectionType">${PROTECTION_TYPES.map(type => `<option value="${type}" ${group?.protectionType===type?'selected':''}>${esc(protectionLabel(type))}</option>`).join('')}</select></label>
      <label>Équipement principal<select name="primaryEquipmentId" required>${this.equipmentOptions(group?.primaryPath?.entityRefs?.[0]?.id)}</select></label>
      <label>Libellé chemin principal<input name="primaryLabel" required value="${esc(group?.primaryPath?.label || 'Principal')}"></label>
      <label>Équipement secours<select name="backupEquipmentId">${this.equipmentOptions(group?.backupPaths?.[0]?.entityRefs?.[0]?.id)}</select></label>
      <label>Libellé chemin secours<input name="backupLabel" value="${esc(group?.backupPaths?.[0]?.label || 'Secours')}"></label>
      <label>Disponibilité secours<select name="backupAvailability">${['unknown','not-tested','available','degraded','unavailable'].map(value => `<option value="${value}" ${group?.backupPaths?.[0]?.availability===value?'selected':''}>${value}</option>`).join('')}</select></label>
      <label>Point de bascule / brassage<select name="switchoverEquipmentId">${this.equipmentOptions(group?.switchoverPoint?.id)}</select></label>
      <label class="span-2">Preuve / plan de référence<input name="sourceRef" required value="${esc(group?.sourceRefs?.[0] || '')}" placeholder="Plan, photo, relevé ou rapport"></label>
      <label class="span-2">Notes<textarea name="notes">${esc(group?.notes || '')}</textarea></label>
    </div><div class="modal-actions"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Enregistrer le brouillon</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const backupPaths = values.backupEquipmentId ? [{ id:group?.backupPaths?.[0]?.id, label:values.backupLabel, availability:values.backupAvailability, pathRole:'BACKUP', verificationStatus:'to-confirm', entityRefs:[{ type:'equipment', id:values.backupEquipmentId, role:'BACKUP', verificationStatus:'to-confirm', sourceRef:values.sourceRef }] }] : [];
        const revisionBase = asRevision ? { ...group, id:undefined, createdAt:undefined, updatedAt:undefined, validation:null, authorId:this.user.id, supersedesId:group.id, revision:nextRevision(group.revision), procedureIds:[] } : group;
        const record = normalizeProtectionGroup({
          ...revisionBase, serviceName:values.serviceName, name:values.name, protectionType:values.protectionType,
          zoneIds:[values.zoneId], status:'draft', verificationStatus:'draft', validation:null,
          primaryPath:{ id:group?.primaryPath?.id, label:values.primaryLabel, availability:'available', pathRole:'PROGRAM', verificationStatus:'to-confirm', entityRefs:[{ type:'equipment', id:values.primaryEquipmentId, role:'PRIMARY', verificationStatus:'to-confirm', sourceRef:values.sourceRef }] },
          backupPaths,
          switchoverPoint:values.switchoverEquipmentId ? { type:'equipment', id:values.switchoverEquipmentId, role:'SWITCHOVER', verificationStatus:'to-confirm', sourceRef:values.sourceRef } : null,
          sourceRefs:[values.sourceRef], notes:values.notes, authorId:asRevision ? this.user.id : group?.authorId ?? this.user.id
        }, asRevision ? null : group);
        const errors = validateContinuityRecord(record);
        if (errors.length) throw new Error(errors.join(' '));
        await saveVerifiedDocument(record); modal.remove(); this.notify('Groupe Principal/Secours enregistré en brouillon.'); await this.refresh();
      } catch (error) { this.notify(error.message, 'error'); }
    };
  }

  async openProcedureForm(procedure = null, presetGroupId = null, { asRevision = false } = {}) {
    if (!this.canEdit()) return this.notify("Vous n'êtes pas autorisé à documenter une procédure.", 'error');
    if (procedure?.status === 'validated' && !asRevision) return this.notify("Une procédure validée est immuable. Utilisez « Nouvelle révision ».", 'warning');
    const editableGroups = this.groups.filter(group => this.isGlobalAdmin() || this.hasRecordPermission(group, 'continuity.edit'));
    if (!editableGroups.length) return this.notify("Aucun groupe Principal/Secours modifiable dans vos zones.", 'warning');
    const selectedGroupId = procedure?.protectionGroupId || presetGroupId || editableGroups[0].id;
    const step = type => procedure?.steps?.find(item => item.type === type)?.instruction || '';
    const modal = modalShell('continuity-procedure-modal', asRevision ? 'Nouvelle révision de procédure' : procedure ? 'Modifier la procédure' : 'Nouvelle procédure de continuité', `<form class="continuity-form"><div class="continuity-form-grid">
      <label>Groupe<select name="protectionGroupId" required>${editableGroups.map(group => `<option value="${esc(group.id)}" ${String(group.id)===String(selectedGroupId)?'selected':''}>${esc(group.serviceName || group.name)}</option>`).join('')}</select></label>
      <label>Titre<input name="title" required value="${esc(procedure?.title || '')}" placeholder="Passage RF1 vers secours"></label>
      <label>Révision<input name="revision" value="${esc(asRevision ? nextRevision(procedure?.revision) : procedure?.revision || '1')}" ${asRevision ? 'readonly' : ''}></label>
      <label>Temps cible (secondes)<input name="estimatedSeconds" type="number" min="0" max="14400" value="${esc(procedure?.estimatedSeconds || '')}"></label>
      <label class="span-2">1. Sécuriser / préparer<textarea name="secure" required placeholder="Préconditions et contrôles avant bascule">${esc(step('secure'))}</textarea></label>
      <label class="span-2">2. Basculer<textarea name="switch" required placeholder="Action opératoire exacte validée sur site">${esc(step('switch'))}</textarea></label>
      <label class="span-2">3. Vérifier<textarea name="verify" required placeholder="Image, audio, monitoring, alarmes">${esc(step('verify'))}</textarea></label>
      <label class="span-2">Fallback si le secours échoue<textarea name="fallbackSummary">${esc(procedure?.fallbackSummary || '')}</textarea></label>
      <label class="span-2">Retour contrôlé au principal<textarea name="rollbackSummary">${esc(procedure?.rollbackSummary || '')}</textarea></label>
      <label class="span-2">Escalade / responsable<textarea name="escalation">${esc(procedure?.escalation || '')}</textarea></label>
      <label class="span-2">Preuve / document<input name="evidenceRef" required value="${esc(procedure?.evidenceRefs?.[0] || '')}"></label>
    </div><div class="modal-actions"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Enregistrer le brouillon</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const group = this.groups.find(item => String(item.id) === String(values.protectionGroupId));
        const backupRefs = group?.backupPaths?.[0]?.entityRefs || [];
        const switchRefs = group?.switchoverPoint ? [group.switchoverPoint] : backupRefs;
        const revisionBase = asRevision ? { ...procedure, id:undefined, createdAt:undefined, updatedAt:undefined, validation:null, authorId:this.user.id, supersedesId:procedure.id } : procedure;
        const record = normalizeContinuityProcedure({
          ...revisionBase, protectionGroupId:values.protectionGroupId, title:values.title, revision:asRevision ? nextRevision(procedure.revision) : values.revision,
          estimatedSeconds:values.estimatedSeconds, status:'draft', verificationStatus:'draft', validation:null,
          zoneIds:group?.zoneIds || [], authorId:asRevision ? this.user.id : procedure?.authorId ?? this.user.id,
          steps:[
            { type:'secure', title:'Sécuriser et préparer', instruction:values.secure, expectedResult:'Secours disponible et action autorisée.', entityRefs:backupRefs, requiresConfirmation:true },
            { type:'switch', title:'Passer au secours', instruction:values.switch, expectedResult:'Chemin secours actif.', entityRefs:switchRefs, requiresConfirmation:true },
            { type:'verify', title:'Vérifier le direct', instruction:values.verify, expectedResult:'Image, audio et monitoring conformes.', entityRefs:backupRefs, requiresConfirmation:true }
          ],
          verificationChecks:['Image présente et stable','Audio présent et conforme','Monitoring et alarmes contrôlés'],
          fallbackSummary:values.fallbackSummary, rollbackSummary:values.rollbackSummary,
          escalation:values.escalation, evidenceRefs:[values.evidenceRef]
        }, asRevision ? null : procedure);
        const errors = validateContinuityRecord(record);
        if (errors.length) throw new Error(errors.join(' '));
        await saveVerifiedDocument(record); modal.remove(); this.notify('Procédure enregistrée en brouillon.'); await this.refresh();
      } catch (error) { this.notify(error.message, 'error'); }
    };
  }

  async approve(id) {
    try {
      const payload = await api(`/api/continuity/${encodeURIComponent(id)}/validate`, { method:'POST', body:'{}' });
      await (db.saveLocalOnly ? db.saveLocalOnly('docs', payload.record) : db.save('docs', payload.record)); this.notify('Donnée de continuité validée avec audit.'); await this.refresh();
    } catch (error) { this.notify(error.message, 'error'); }
  }

  async retire(id) {
    const reason = window.prompt('Motif du retrait de ce document validé :', 'Remplacé ou retiré du service');
    if (reason == null) return;
    try {
      const payload = await api(`/api/data/docs/${encodeURIComponent(id)}/retire`, { method:'POST', body:JSON.stringify({ reason }) });
      await (db.saveLocalOnly ? db.saveLocalOnly('docs', payload.record) : db.save('docs', payload.record));
      this.notify('Document retiré et conservé dans l’historique.'); await this.refresh();
    } catch (error) { this.notify(error.message, 'error'); }
  }

  openDetails(groupId) {
    const group = this.groups.find(item => String(item.id) === String(groupId));
    if (!group) return;
    const procedures = this.proceduresFor(group.id);
    const tests = this.tests.filter(item => String(item.protectionGroupId) === String(group.id)).sort((a,b) => new Date(b.performedAt || 0)-new Date(a.performedAt || 0));
    const modal = modalShell('continuity-details-modal', group.serviceName || group.name, `<div class="continuity-detail-grid">
      <section><h4>Principal</h4><p>${esc(group.primaryPath?.label || '—')}</p>${(group.primaryPath?.entityRefs||[]).map(ref => `<small>${esc(ref.label || ref.id)}</small>`).join('')}</section>
      <section><h4>Secours</h4>${(group.backupPaths||[]).map(path => `<p><strong>${esc(path.label)}</strong> · ${esc(path.availability)}</p>`).join('') || '<p>Non documenté</p>'}</section>
      <section class="span-2"><h4>Procédures</h4>${procedures.map(item => `<div class="continuity-list-row"><span>${esc(item.title)} · Rév. ${esc(item.revision || '1')} · ${esc(statusLabel(item.status))}</span>${this.canEditRecord(item)?`<button class="btn gray edit-procedure" data-id="${esc(item.id)}">Modifier</button>`:''}${this.canReviseRecord(item)?`<button class="btn gray revise-procedure" data-id="${esc(item.id)}">Nouvelle révision</button>`:''}${this.canValidateRecord(item)?`<button class="btn validate-procedure" data-id="${esc(item.id)}">Valider</button>`:''}${this.canRetireRecord(item)?`<button class="btn danger retire-procedure" data-id="${esc(item.id)}">Retirer</button>`:''}</div>`).join('') || '<p>Aucune.</p>'}</section>
      <section class="span-2"><h4>Historique tests</h4>${tests.slice(0,20).map(item => `<div class="continuity-list-row"><span>${esc(formatDate(item.performedAt))} · ${esc(item.result)}</span><small>${esc(item.observations || '')}</small></div>`).join('') || '<p>Aucun test.</p>'}</section>
    </div><div class="modal-actions">${this.hasRecordPermission(group, 'continuity.edit')?`<button class="btn gray add-procedure">Ajouter une procédure</button>`:''}</div>`);
    modal.querySelector('.add-procedure')?.addEventListener('click', () => { modal.remove(); this.openProcedureForm(null, group.id); });
    modal.querySelectorAll('.edit-procedure').forEach(button => button.onclick = () => { const procedure = this.procedures.find(item => String(item.id)===String(button.dataset.id)); modal.remove(); this.openProcedureForm(procedure); });
    modal.querySelectorAll('.revise-procedure').forEach(button => button.onclick = () => { const procedure = this.procedures.find(item => String(item.id)===String(button.dataset.id)); modal.remove(); this.openProcedureForm(procedure, procedure.protectionGroupId, { asRevision:true }); });
    modal.querySelectorAll('.validate-procedure').forEach(button => button.onclick = async () => { await this.approve(button.dataset.id); modal.remove(); });
    modal.querySelectorAll('.retire-procedure').forEach(button => button.onclick = async () => { modal.remove(); await this.retire(button.dataset.id); });
  }

  openSecureWorkflow(groupId) {
    const group = this.groups.find(item => String(item.id) === String(groupId));
    const procedures = this.proceduresFor(groupId, true);
    if (!group || !procedures.length) return this.notify('Aucune procédure validée disponible.', 'warning');
    if (!this.canTestRecord(group)) return this.notify("Vous n'êtes pas autorisé à exécuter un test de secours dans toutes les zones concernées.", 'error');
    const procedure = procedures[0]; let index = 0; const startedAt = Date.now();
    const modal = modalShell('continuity-run-modal', `Sécuriser le direct — ${group.serviceName}`, `<div class="continuity-run-warning"><strong>Guide documentaire.</strong> Aucune commande n'est envoyée aux équipements réels. Vérifiez l'autorisation d'exploitation avant toute action.</div><div class="continuity-run-progress"></div><div class="continuity-run-step"></div><div class="modal-actions continuity-run-actions"><button class="btn gray abort">Abandonner</button><button class="btn warning confirm-step">Confirmer et continuer</button></div>`);
    const progress = modal.querySelector('.continuity-run-progress'); const content = modal.querySelector('.continuity-run-step');
    const renderStep = () => {
      const step = procedure.steps[index];
      progress.innerHTML = procedure.steps.map((_, i) => `<span class="${i<index?'done':i===index?'active':''}">${i+1}</span>`).join('');
      content.innerHTML = `<span class="continuity-step-type">${esc(step.type)}</span><h4>${esc(step.title)}</h4><p>${esc(step.instruction)}</p>${step.warning?`<div class="continuity-step-warning">${esc(step.warning)}</div>`:''}<strong>Résultat attendu</strong><p>${esc(step.expectedResult || 'Confirmer le résultat observé.')}</p><label class="continuity-check"><input type="checkbox" required> J'ai exécuté ou vérifié cette étape et le résultat est conforme.</label>`;
    };
    const finish = () => {
      content.innerHTML = `<h4>Clôturer l'exécution</h4><form class="continuity-test-form"><label>Résultat<select name="result"><option value="passed">Secours validé</option><option value="partial">Partiel / à surveiller</option><option value="failed">Échec</option><option value="aborted">Abandonné</option></select></label><label>Observations<textarea name="observations" required placeholder="Image, audio, alarmes, écarts constatés…"></textarea></label><label><input type="checkbox" name="restoredPrimary"> Retour au principal effectué et vérifié</label><button class="btn" type="submit">Enregistrer la preuve d'exécution</button></form>`;
      modal.querySelector('.confirm-step').hidden = true;
      modal.querySelector('.continuity-test-form').onsubmit = async event => {
        event.preventDefault();
        try {
          const values = Object.fromEntries(new FormData(event.currentTarget).entries());
          const result = await api(`/api/continuity/${encodeURIComponent(group.id)}/tests`, { method:'POST', body:JSON.stringify({ procedureId:procedure.id, result:values.result, observations:values.observations, restoredPrimary:Boolean(values.restoredPrimary), measuredSwitchSeconds:Math.round((Date.now()-startedAt)/1000) }) });
          this.notify("Exécution enregistrée. Créez un ticket pour poursuivre le diagnostic si nécessaire.");
          modal.querySelector('.continuity-run-actions').innerHTML = '<button class="btn warning create-incident">Créer le ticket / incident</button><button class="btn gray close-run">Fermer</button>';
          modal.querySelector('.create-incident').onclick = () => {
            modal.remove();
            openTicketModal({
              type:'continuity-test', id:result.record.id, requestKind:'incident',
              subject:`Suivi continuité — ${group.serviceName || group.name}`,
              description:`Test de secours ${values.result}. Observations: ${values.observations}`
            });
          };
          modal.querySelector('.close-run').onclick = () => { modal.remove(); this.refresh(); };
        } catch (error) { this.notify(error.message, 'error'); }
      };
    };
    modal.querySelector('.confirm-step').onclick = () => {
      if (!content.querySelector('input[type="checkbox"]')?.checked) return this.notify('Confirmez le résultat observé avant de continuer.', 'warning');
      index += 1; if (index >= procedure.steps.length) finish(); else renderStep();
    };
    modal.querySelector('.abort').onclick = () => modal.remove(); renderStep();
  }

  async refresh() {
    const container = document.getElementById('admin-content') || document.getElementById('responsible-content') || document.querySelector('.continuity-modal-host');
    if (!container) return;
    container.innerHTML = await this.render(); await this.afterRender(container);
  }
}

export async function openContinuityModal(user = getCurrentUser(), notifications = null) {
  const modal = modalShell('continuity-center-modal', 'Continuité antenne', '<div class="continuity-modal-host"><div class="loading-spinner"><p>Chargement…</p></div></div>');
  const host = modal.querySelector('.continuity-modal-host');
  const center = new ContinuityCenter(user, notifications, { compact:true });
  host.innerHTML = await center.render(); await center.afterRender(host);
  return center;
}

const PATCH_FLAG = Symbol.for('2m-tech.continuity-center.patched');
if (!AdminUI.prototype[PATCH_FLAG]) {
  const originalInitSections = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithContinuity() {
    const sections = originalInitSections.call(this); const ordered = {};
    for (const [key,value] of Object.entries(sections)) { ordered[key] = value; if (key === 'signalFlow' || key === 'devices') ordered.continuity = ordered.continuity || { title:'Continuité antenne', icon:'fas fa-shield-alt', component:new ContinuityCenter(this.user, this.notifications) }; }
    if (!ordered.continuity) ordered.continuity = { title:'Continuité antenne', icon:'fas fa-shield-alt', component:new ContinuityCenter(this.user, this.notifications) };
    return ordered;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

if (!ResponsibleUI.prototype[PATCH_FLAG]) {
  const originalRender = ResponsibleUI.prototype.renderBaseLayout;
  ResponsibleUI.prototype.renderBaseLayout = function renderResponsibleWithContinuity() {
    if (!this.sections.continuity) this.sections = { continuity:{ title:'Continuité antenne', icon:'fas fa-shield-alt', component:new ContinuityCenter(this.user, this.notifications) }, ...this.sections };
    return originalRender.call(this);
  };
  Object.defineProperty(ResponsibleUI.prototype, PATCH_FLAG, { value:true });
}

if (!TechUISmart.prototype[PATCH_FLAG]) {
  const originalBind = TechUISmart.prototype.bindGlobalActions;
  TechUISmart.prototype.bindGlobalActions = function bindTechnicianContinuity(...args) {
    const result = originalBind ? originalBind.apply(this, args) : undefined;
    const host = document.querySelector('.smart-tech-header .header-actions');
    if (host && !host.querySelector('#tech-continuity-btn')) {
      const button = document.createElement('button'); button.id = 'tech-continuity-btn'; button.className = 'btn warning';
      button.innerHTML = '<i class="fas fa-shield-alt"></i> Sécuriser le direct'; button.onclick = () => openContinuityModal(this.user, this.notifications); host.prepend(button);
    }
    return result;
  };
  Object.defineProperty(TechUISmart.prototype, PATCH_FLAG, { value:true });
}

export default ContinuityCenter;
