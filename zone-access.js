import { db } from './db.js';
import { normalizeRole } from './roles.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));

const PERMISSION_LABELS = Object.freeze({
  'zone.summary.read': 'Voir la zone et son résumé',
  'equipment.read': 'Consulter les équipements / baies',
  'equipment.edit': 'Modifier les équipements',
  'screen.read': "Consulter les écrans / murs d'images",
  'screen.edit': 'Modifier les écrans / murs',
  'cable.read': 'Consulter le câblage / patch',
  'cable.edit': 'Modifier le câblage / patch',
  'topology.read': 'Consulter la topologie / flux',
  'topology.edit': 'Modifier la topologie',
  'continuity.read': 'Consulter Principal / Secours et procédures validées',
  'continuity.edit': 'Documenter Principal / Secours et procédures',
  'continuity.validate': 'Valider les procédures de continuité',
  'continuity.test': 'Exécuter et consigner un test de secours',
  'diagram.read': 'Consulter les plans et synoptiques techniques',
  'diagram.edit': 'Dessiner les plans et synoptiques techniques',
  'diagram.validate': 'Valider les plans et synoptiques techniques',
  'ticket.read': 'Consulter les tickets',
  'ticket.create': 'Créer des tickets',
  'ticket.edit': 'Modifier les tickets',
  'note.read': 'Consulter les notes techniques',
  'note.create': 'Ajouter des notes techniques',
  'diagnostic.run': 'Utiliser le diagnostic et son historique',
  'procedure.read': 'Consulter procédures / secours',
  'access.review': "Traiter les demandes d'accès",
  'users.manage': 'Gérer les comptes',
  'room.edit': 'Modifier une salle',
  'zone.manage': 'Gérer les zones'
});

const REQUESTABLE_BY_ROLE = Object.freeze({
  responsible: Object.keys(PERMISSION_LABELS).filter(p => !['users.manage','zone.manage','room.edit'].includes(p)),
  technician: [
    'zone.summary.read','equipment.read','equipment.edit','screen.read','screen.edit','cable.read','cable.edit',
    'topology.read','topology.edit','continuity.read','continuity.test','diagram.read','ticket.read','ticket.create','ticket.edit','note.read','note.create','diagnostic.run','procedure.read'
  ],
  visitor: ['zone.summary.read','equipment.read','screen.read','ticket.read','note.read','procedure.read'],
  admin: Object.keys(PERMISSION_LABELS)
});

/**
 * Ce rôle dispose-t-il RÉELLEMENT d'un parcours de demande d'accès ?
 *
 * `REQUESTABLE_BY_ROLE` est la seule liste qui le sache. L'exporter sous forme de
 * question évite qu'un écran propose un bouton « Demander un accès » à un rôle pour
 * lequel aucune permission demandable n'est définie — un bouton qui ouvrirait un
 * formulaire sans rien à cocher.
 */
export function roleHasAccessRequestWorkflow(role) {
  const canonique = normalizeRole(role);
  return Boolean(canonique && REQUESTABLE_BY_ROLE[canonique]?.length);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Erreur serveur (${response.status})`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}

const roleLabel = role => ({ admin:'Administrateur', responsible:'Responsable', technician:'Technicien', visitor:'Visiteur' })[normalizeRole(role)] || role || 'Utilisateur';
const expiryValueToIso = value => value === 'never' ? null : new Date(Date.now() + Number(value || 8) * 3600_000).toISOString();
const formatExpiry = value => value ? new Date(value).toLocaleString('fr-FR') : 'Sans expiration';

function notify(notifications, message, type = 'success') {
  if (notifications?.showNotification) notifications.showNotification(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}

function modalShell(id, title, body) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = id;
  modal.style.display = 'flex';
  modal.innerHTML = `<div class="modal-content" style="max-width:780px;width:min(94vw,780px);max-height:88vh;overflow:auto;">
    <button type="button" class="modal-x" aria-label="Fermer">×</button>
    <h3>${esc(title)}</h3>${body}
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
  return modal;
}

export async function openAccessRequestModal(user, notifications) {
  try {
    const [context, requestPayload] = await Promise.all([api('/api/access/context'), api('/api/access/requests')]);
    const role = normalizeRole(user?.role);
    const permissions = REQUESTABLE_BY_ROLE[role] || REQUESTABLE_BY_ROLE.visitor;
    const ownRequests = (requestPayload.requests || []).filter(item => String(item.requestedBy) === String(user?.id));
    const memberships = context.memberships || [];
    const grants = context.grants || [];

    const modal = modalShell('zone-access-request-modal', 'Mes accès aux zones', `
      <div class="zone-access-current" style="margin:12px 0 18px;display:grid;gap:8px;">
        ${(context.zones || []).map(zone => {
          const member = memberships.find(item => String(item.zoneId) === String(zone.id));
          const activeGrants = grants.filter(item => String(item.zoneId) === String(zone.id));
          return `<article class="card" style="padding:12px;">
            <div style="display:flex;gap:12px;align-items:center;">
              ${zone.imageUrl ? `<img src="${esc(zone.imageUrl)}" alt="" style="width:76px;height:52px;object-fit:cover;border-radius:8px;">` : ''}
              <div style="flex:1"><strong>${esc(zone.name)}</strong><div style="font-size:13px;color:#667085;">${esc(zone.publicSummary || '')}</div></div>
              <span class="status-badge ${member ? 'active' : 'inactive'}">${member ? `${activeGrants.length} droit(s)` : 'Hors périmètre — résumé public'}</span>
            </div>
          </article>`;
        }).join('') || '<p>Aucune zone publiée.</p>'}
      </div>
      <hr>
      <h4>Demander un accès</h4>
      <form id="zone-access-request-form">
        <div class="form-row">
          <div class="form-group"><label>Zone</label><select name="zoneId" required>
            <option value="">Sélectionner…</option>${(context.zones || []).map(zone => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>Durée demandée</label><select name="durationHours">
            <option value="8">8 heures</option><option value="24">24 heures</option><option value="168">7 jours</option><option value="720">30 jours</option>
          </select></div>
        </div>
        <div class="form-group"><label>Permissions nécessaires</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px;">
            ${permissions.map(permission => `<label class="permission-option"><input type="checkbox" name="permission" value="${esc(permission)}"> ${esc(PERMISSION_LABELS[permission])}</label>`).join('')}
          </div>
        </div>
        <div class="form-group"><label>Motif</label><textarea name="reason" required maxlength="1000" placeholder="Expliquez brièvement pourquoi cet accès est nécessaire."></textarea></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Envoyer la demande</button></div>
      </form>
      <h4 style="margin-top:22px;">Mes demandes récentes</h4>
      <div style="display:grid;gap:6px;">
        ${ownRequests.slice(-8).reverse().map(item => `<div class="card" style="padding:10px;display:flex;justify-content:space-between;gap:10px;">
          <span>${esc((context.zones || []).find(z => String(z.id) === String(item.zoneId))?.name || item.zoneId)}</span>
          <span>${esc(item.status)}</span><small>${formatExpiry(item.expiresAt)}</small>
        </div>`).join('') || '<small>Aucune demande.</small>'}
      </div>`);

    modal.querySelector('#zone-access-request-form').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const requestedPermissions = [...form.querySelectorAll('input[name="permission"]:checked')].map(input => input.value);
      if (!requestedPermissions.length) return notify(notifications, 'Sélectionnez au moins une permission.', 'warning');
      try {
        await api('/api/access/requests', {
          method: 'POST',
          body: JSON.stringify({ zoneId: form.zoneId.value, durationHours: Number(form.durationHours.value), requestedPermissions, reason: form.reason.value })
        });
        notify(notifications, "Demande d'accès envoyée au responsable de la zone.");
        modal.remove();
      } catch (error) { notify(notifications, error.message, 'error'); }
    };
  } catch (error) { notify(notifications, error.message, 'error'); }
}

export default class ZoneAccessManager {
  constructor(notifications) {
    this.notifications = notifications;
    this.user = JSON.parse(localStorage.getItem('auth') || '{}');
    this.data = null;
    this.selectedZoneId = '';
  }

  async load() {
    this.data = await api('/api/access/manage');
    if (!this.selectedZoneId) this.selectedZoneId = this.data.zones?.[0]?.id || '';
    return this.data;
  }

  zoneName(id) { return this.data?.zones?.find(zone => String(zone.id) === String(id))?.name || id || '—'; }
  userName(id) {
    const user = this.data?.users?.find(item => String(item.id) === String(id));
    return user ? `${user.fullName || user.username} · ${roleLabel(user.role)}` : `#${id}`;
  }

  async render() {
    await this.load();
    const { zones = [], users = [], memberships = [], grants = [], requests = [], permissions = [], resourceZones = [] } = this.data;
    const selectedMemberships = memberships.filter(item => !this.selectedZoneId || String(item.zoneId) === String(this.selectedZoneId));
    const pending = requests.filter(item => item.status === 'pending');
    const isAdmin = normalizeRole(this.user.role) === 'admin';
    const rooms = isAdmin ? await db.getAll('rooms') : [];

    return `<section class="zone-access-management">
      <div class="section-header"><div><h2><i class="fas fa-user-shield"></i> Accès par zone</h2>
        <p class="section-subtitle">Rôle global + appartenance à une zone + permissions précises. Les contrôles sont appliqués par le serveur.</p></div>
        <button class="btn gray" id="zone-access-refresh"><i class="fas fa-sync-alt"></i> Actualiser</button></div>

      <div class="relation-summary" style="margin:12px 0 18px;">
        <span><b>${zones.length}</b><small>Zones</small></span><span><b>${memberships.filter(m => m.status !== 'revoked').length}</b><small>Affectations</small></span>
        <span><b>${grants.filter(g => g.status !== 'revoked').length}</b><small>Permissions</small></span><span><b>${pending.length}</b><small>Demandes en attente</small></span>
      </div>

      <div class="card" style="padding:16px;margin-bottom:16px;">
        <h3>Affecter un utilisateur et ses droits</h3>
        <form id="zone-membership-form">
          <div class="form-row">
            <div class="form-group"><label>Zone</label><select name="zoneId" required>${zones.map(zone => `<option value="${esc(zone.id)}" ${String(zone.id)===String(this.selectedZoneId)?'selected':''}>${esc(zone.name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Utilisateur</label><select name="userId" required><option value="">Sélectionner…</option>${users.filter(u => normalizeRole(u.role)!=='admin').map(u => `<option value="${esc(u.id)}">${esc(u.fullName || u.username)} · ${esc(roleLabel(u.role))}</option>`).join('')}</select></div>
            <div class="form-group"><label>Expiration</label><select name="expiry"><option value="never">Sans expiration</option><option value="8">8 heures</option><option value="24">24 heures</option><option value="168">7 jours</option><option value="720">30 jours</option></select></div>
          </div>
          ${isAdmin ? `<label style="display:block;margin:8px 0;"><input type="checkbox" name="responsible"> Nommer responsable de cette zone</label>` : ''}
          <div class="form-group"><label>Permissions accordées</label><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:6px;">
            ${permissions.filter(p => !['users.manage','zone.manage'].includes(p)).map(p => `<label><input type="checkbox" name="permission" value="${esc(p)}"> ${esc(PERMISSION_LABELS[p] || p)}</label>`).join('')}
          </div></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fas fa-save"></i> Enregistrer les droits</button></div>
        </form>
      </div>

      ${isAdmin ? `<div class="card" style="padding:16px;margin-bottom:16px;"><h3>Zones et périmètres</h3>
        <div class="form-row"><form id="zone-create-form" style="flex:1"><div class="form-group"><label>Nouvelle zone</label><input name="name" required placeholder="Ex. STC, Régie Finale, Transmission"></div><div class="form-group"><label>Résumé public</label><input name="publicSummary" placeholder="Description visible sans accès détaillé"></div><button class="btn" type="submit">Créer la zone</button></form>
        <form id="zone-room-map-form" style="flex:1"><div class="form-group"><label>Associer une salle à une zone</label><select name="roomId" required><option value="">Salle…</option>${rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name || r.nom || `Salle ${r.id}`)}</option>`).join('')}</select></div><div class="form-group"><select name="zoneId" required>${zones.map(z=>`<option value="${esc(z.id)}">${esc(z.name)}</option>`).join('')}</select></div><button class="btn" type="submit">Associer</button></form></div>
        <small>${resourceZones.length} relation(s) ressource-zone actuellement enregistrée(s).</small></div>` : ''}

      <div class="card" style="padding:16px;margin-bottom:16px;"><h3>Demandes d'accès en attente</h3>
        <div style="display:grid;gap:8px;">${pending.length ? pending.map(request => `<article style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;display:flex;align-items:center;gap:10px;">
          <div style="flex:1"><strong>${esc(this.userName(request.requestedBy))}</strong> → ${esc(this.zoneName(request.zoneId))}<br><small>${esc(request.reason || 'Sans motif')}</small><br><small>${request.requestedPermissions.map(p=>esc(PERMISSION_LABELS[p]||p)).join(' · ')}</small></div>
          <button class="btn review-access-request" data-id="${esc(request.id)}">Examiner</button></article>`).join('') : '<div class="empty-state">Aucune demande en attente.</div>'}</div>
      </div>

      <div class="card" style="padding:16px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><h3>Membres et permissions</h3><select id="zone-access-filter">${zones.map(z=>`<option value="${esc(z.id)}" ${String(z.id)===String(this.selectedZoneId)?'selected':''}>${esc(z.name)}</option>`).join('')}</select></div>
        <div style="overflow:auto"><table class="tableau"><thead><tr><th>Utilisateur</th><th>Zone</th><th>Responsable</th><th>Expiration</th><th>Permissions</th></tr></thead><tbody>
          ${selectedMemberships.length ? selectedMemberships.map(m => {
            const userGrants = grants.filter(g => String(g.userId)===String(m.userId) && String(g.zoneId)===String(m.zoneId) && g.status!=='revoked');
            return `<tr><td>${esc(this.userName(m.userId))}</td><td>${esc(this.zoneName(m.zoneId))}</td><td>${m.responsible?'Oui':'Non'}</td><td>${esc(formatExpiry(m.expiresAt))}</td><td>${userGrants.map(g=>`<span class="role-badge" title="${esc(g.permission)}">${esc(PERMISSION_LABELS[g.permission]||g.permission)} <button class="revoke-zone-grant" data-id="${esc(g.id)}" title="Retirer">×</button></span>`).join(' ') || '—'}</td></tr>`;
          }).join('') : '<tr><td colspan="5">Aucun membre dans cette zone.</td></tr>'}
        </tbody></table></div>
      </div>
    </section>`;
  }

  async afterRender() {
    document.getElementById('zone-access-refresh')?.addEventListener('click', () => this.refresh());
    document.getElementById('zone-access-filter')?.addEventListener('change', event => { this.selectedZoneId = event.target.value; this.refresh(); });

    const membershipForm = document.getElementById('zone-membership-form');
    if (membershipForm) membershipForm.onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const userId = form.userId.value;
      const zoneId = form.zoneId.value;
      const expiresAt = expiryValueToIso(form.expiry.value);
      const selected = [...form.querySelectorAll('input[name="permission"]:checked')].map(input => input.value);
      if (!userId) return notify(this.notifications, 'Sélectionnez un utilisateur.', 'warning');
      try {
        await api('/api/access/memberships', { method:'POST', body:JSON.stringify({ userId, zoneId, responsible:Boolean(form.responsible?.checked), expiresAt }) });
        const existing = (this.data.grants || []).filter(g => String(g.userId)===String(userId) && String(g.zoneId)===String(zoneId) && g.status!=='revoked');
        for (const grant of existing.filter(g => !selected.includes(g.permission))) await api(`/api/access/grants/${encodeURIComponent(grant.id)}`, { method:'DELETE' });
        for (const permission of selected) await api('/api/access/grants', { method:'POST', body:JSON.stringify({ userId, zoneId, permission, expiresAt }) });
        notify(this.notifications, 'Affectation et permissions enregistrées.');
        this.selectedZoneId = zoneId;
        await this.refresh();
      } catch (error) { notify(this.notifications, error.message, 'error'); }
    };

    document.querySelectorAll('.revoke-zone-grant').forEach(button => button.onclick = async event => {
      event.preventDefault(); event.stopPropagation();
      try { await api(`/api/access/grants/${encodeURIComponent(button.dataset.id)}`, { method:'DELETE' }); notify(this.notifications, 'Permission retirée.'); await this.refresh(); }
      catch (error) { notify(this.notifications, error.message, 'error'); }
    });

    document.querySelectorAll('.review-access-request').forEach(button => button.onclick = () => this.openReview(button.dataset.id));

    const zoneForm = document.getElementById('zone-create-form');
    if (zoneForm) zoneForm.onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget;
      try { await api('/api/access/zones', { method:'POST', body:JSON.stringify({ name:form.name.value, publicSummary:form.publicSummary.value }) }); notify(this.notifications, 'Zone créée.'); await this.refresh(); }
      catch (error) { notify(this.notifications, error.message, 'error'); }
    };

    const mappingForm = document.getElementById('zone-room-map-form');
    if (mappingForm) mappingForm.onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget;
      try { await api('/api/access/resource-zones', { method:'POST', body:JSON.stringify({ resourceType:'room', resourceId:form.roomId.value, zoneId:form.zoneId.value }) }); notify(this.notifications, 'Salle associée à la zone.'); await this.refresh(); }
      catch (error) { notify(this.notifications, error.message, 'error'); }
    };
  }

  async openReview(requestId) {
    const request = this.data.requests.find(item => String(item.id) === String(requestId));
    if (!request) return;
    const modal = modalShell('zone-review-modal', "Traiter la demande d'accès", `<p><strong>${esc(this.userName(request.requestedBy))}</strong> demande l'accès à <strong>${esc(this.zoneName(request.zoneId))}</strong>.</p>
      <p>${esc(request.reason || '')}</p><form id="zone-review-form"><div class="form-group"><label>Permissions approuvées</label>
        ${request.requestedPermissions.map(permission => `<label style="display:block;margin:5px 0"><input type="checkbox" name="permission" value="${esc(permission)}" checked> ${esc(PERMISSION_LABELS[permission]||permission)}</label>`).join('')}</div>
        <div class="form-actions"><button type="button" class="btn danger" id="reject-access">Refuser</button><button type="submit" class="btn btn-primary">Approuver la sélection</button></div></form>`);
    const submitReview = async status => {
      const approvedPermissions = status === 'approved' ? [...modal.querySelectorAll('input[name="permission"]:checked')].map(input=>input.value) : [];
      try { await api(`/api/access/requests/${encodeURIComponent(request.id)}/review`, { method:'POST', body:JSON.stringify({ status, approvedPermissions }) }); notify(this.notifications, status==='approved'?'Accès approuvé.':'Demande refusée.'); modal.remove(); await this.refresh(); }
      catch (error) { notify(this.notifications, error.message, 'error'); }
    };
    modal.querySelector('#zone-review-form').onsubmit = event => { event.preventDefault(); submitReview('approved'); };
    modal.querySelector('#reject-access').onclick = () => submitReview('rejected');
  }

  async refresh() {
    const container = document.getElementById('admin-content') || document.getElementById('responsible-content');
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  }
}

export { PERMISSION_LABELS, REQUESTABLE_BY_ROLE };
