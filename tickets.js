import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { isPlatformAdmin } from './roles.js';
import { eventSystem } from './events.js';
import { openAccessRequestModal } from './zone-access.js';
import { REQUEST_KINDS, requestKindDefinition, requestKindOf, requestSlaMinutes, validateRequestPayload, slaEscalationState } from './service-request-contract.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
const safeClass = value => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '-');
const safeAttachment = value => /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,/i.test(String(value || '')) ? value : '';
const normalizeId = value => (/^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value))) ? Number(value) : value;
const activeStatuses = new Set(['en cours', 'attente', 'prêt-fermeture']);

async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'include', cache:'no-store', headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Erreur serveur (${response.status})`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}

async function refreshCentralTickets() {
  if (typeof db.enableCentralSync === 'function') await db.enableCentralSync({ bootstrapLocal:false });
  if (document.getElementById('tickets-list-container')) await showTicketsList({ target:'tickets-list-container' });
}

function accessContext() {
  try { return JSON.parse(localStorage.getItem('zone-access-context') || '{}'); }
  catch { return {}; }
}

function isActive(record) {
  if (!record || ['inactive','revoked'].includes(record.status)) return false;
  return !record.expiresAt || new Date(record.expiresAt).getTime() > Date.now();
}

function canManageTicket(ticket, user = getCurrentUser()) {
  if (['admin','manager'].includes(user?.role)) return true;
  const zoneId = ticket?.zoneId || ticket?.destinationZoneId;
  if (!zoneId) return false;
  const context = accessContext();
  const member = (context.memberships || []).some(item => isActive(item) && String(item.zoneId) === String(zoneId));
  const granted = (context.grants || []).some(item => isActive(item) && String(item.zoneId) === String(zoneId) && item.permission === 'ticket.edit');
  return member && granted;
}

/**
 * FERMER DÉFINITIVEMENT N'EST PAS UNE NUANCE DE « GÉRER ».
 *
 * Le serveur ne laisse que l'administrateur poser le statut `fermé` — il répond
 * `ADMIN_CLOSE_REQUIRED` à quiconque d'autre. L'écran, lui, proposait ce statut au Manager :
 * une action qui échouait à coup sûr, et dont le refus légitime ressemblait à une panne.
 *
 * Le Manager traite la demande — `en cours`, `attente`, `prêt-fermeture` — et signale ainsi
 * qu'elle est prête. La clôture reste à l'administrateur, et la question se pose ici avec le
 * contrat canonique, jamais avec une nouvelle liste de rôles écrite à la main.
 */
function canCloseTicketPermanently(user = getCurrentUser()) {
  return isPlatformAdmin(user?.role);
}

/** Les statuts de traitement, ouverts à qui gère la demande. */
const STATUTS_DE_TRAITEMENT = Object.freeze(['en cours', 'attente', 'prêt-fermeture']);

/**
 * LES STATUTS RÉELLEMENT PROPOSÉS — ce qui est interdit ne se montre pas.
 *
 * Le rendu affichait les quatre statuts et se contentait de marquer « fermé » `disabled`
 * pour un Manager. Un attribut `disabled` reste dans le document : il s'enlève depuis la
 * console, il se soumet par script, et surtout il MONTRE une issue que le serveur refusera
 * — `ADMIN_CLOSE_REQUIRED`. Proposer une action vouée à l'échec fait passer un refus
 * légitime pour une panne.
 *
 * Le statut COURANT est toujours rendu, même s'il n'est pas proposable : sans lui, une
 * demande déjà fermée s'afficherait « en cours » aux yeux d'un Manager, ce qui serait un
 * mensonge pire que l'option de trop.
 */
export function ticketStatusOptions(user = getCurrentUser(), statutCourant = '') {
  const proposables = canCloseTicketPermanently(user)
    ? [...STATUTS_DE_TRAITEMENT, 'fermé']
    : [...STATUTS_DE_TRAITEMENT];
  const rendus = proposables.includes(statutCourant) || !statutCourant
    ? proposables
    : [...proposables, statutCourant];
  return rendus
    .map(status => `<option value="${escapeHTML(status)}"${statutCourant === status ? ' selected' : ''}>${escapeHTML(status)}</option>`)
    .join('');
}

function isTicketOwner(ticket, user = getCurrentUser()) {
  const actorId = ticket?.createdById ?? ticket?.requestedBy;
  return actorId != null && String(actorId) === String(user?.id);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `notification notification-${type}`;
  toast.textContent = message;
  Object.assign(toast.style, { position:'fixed', bottom:'28px', right:'32px', background:type === 'error' ? '#c0392b' : type === 'warning' ? '#b7791f' : '#2874a6', color:'#fff', padding:'13px 22px', borderRadius:'12px', fontSize:'15px', zIndex:20000, boxShadow:'0 2px 22px #8aaec8' });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function requestLabel(ticket) {
  return requestKindDefinition(requestKindOf(ticket)).shortLabel;
}

export async function showTicketsPage(target = 'admin-content') {
  const tickets = await db.getAll('tickets');
  const openCount = tickets.filter(ticket => activeStatuses.has(ticket.status)).length;
  const urgentCount = tickets.filter(ticket => ticket.prio === 'haute' && activeStatuses.has(ticket.status)).length;
  const readyCount = tickets.filter(ticket => ticket.status === 'prêt-fermeture').length;
  const container = document.getElementById(target);
  if (!container) return;
  container.innerHTML = `
    <div class="card service-requests-card">
      <div class="service-requests-header">
        <div><h2>Tickets & demandes</h2><p>Incidents, services, informations, transferts vidéo et interventions dans un seul suivi.</p></div>
        <button class="btn btn-primary" id="add-ticket-btn"><i class="fas fa-plus"></i> Nouvelle demande</button>
      </div>
      <div class="service-request-stats"><span><b>${openCount}</b><small>Ouvertes</small></span><span class="urgent"><b>${urgentCount}</b><small>Urgentes</small></span><span class="ready"><b>${readyCount}</b><small>Prêtes à fermer</small></span></div>
      <div id="tickets-list-container"></div>
    </div>`;
  await showTicketsList({ target:'tickets-list-container' });
  document.getElementById('add-ticket-btn').onclick = () => openTicketModal({});
}

function renderKindOptions(selected = 'incident') {
  return Object.entries(REQUEST_KINDS).map(([key, definition]) => `<label class="request-kind-option ${key === selected ? 'selected' : ''}"><input type="radio" name="requestKind" value="${escapeHTML(key)}" ${key === selected ? 'checked' : ''}><i class="fas ${escapeHTML(definition.icon)}"></i><span>${escapeHTML(definition.label)}</span></label>`).join('');
}

function renderDynamicFields(kind) {
  const definition = requestKindDefinition(kind);
  if (definition.usesAccessWorkflow) return `<div class="request-access-redirect"><i class="fas fa-user-shield"></i><div><strong>Workflow d'accès sécurisé</strong><p>Choisissez la zone, les permissions et la durée. Une approbation du responsable est obligatoire.</p></div><button type="button" class="btn" id="open-zone-access-workflow">Ouvrir Accès zones</button></div>`;
  return (definition.fields || []).map(field => {
    const required = field.required ? 'required' : '';
    const marker = field.required ? ' <span class="required">*</span>' : '';
    if (field.type === 'select') return `<div class="form-group"><label>${escapeHTML(field.label)}${marker}</label><select data-detail="${escapeHTML(field.key)}" ${required}><option value="">Sélectionner…</option>${field.options.map(option => `<option value="${escapeHTML(option)}">${escapeHTML(option)}</option>`).join('')}</select></div>`;
    if (field.type === 'textarea') return `<div class="form-group request-field-wide"><label>${escapeHTML(field.label)}${marker}</label><textarea data-detail="${escapeHTML(field.key)}" maxlength="${field.maxLength || 1200}" ${required}></textarea></div>`;
    return `<div class="form-group"><label>${escapeHTML(field.label)}${marker}</label><input type="${escapeHTML(field.type || 'text')}" data-detail="${escapeHTML(field.key)}" maxlength="${field.maxLength || 300}" ${required}></div>`;
  }).join('');
}

function relatedCollections(equipments, rooms, baies, screens, docs) {
  return {
    equipment:{ label:'Équipement', records:equipments, text:item => `${item.name || item.nom || 'Équipement'} · ${item.marque || ''} ${item.modele || ''}`.trim() },
    room:{ label:'Salle', records:rooms, text:item => item.name || item.nom || `Salle ${item.id}` },
    baie:{ label:'Baie', records:baies, text:item => item.name || item.nom || `Baie ${item.id}` },
    screen:{ label:'Écran', records:screens, text:item => `${item.name || 'Écran'} · ${item.serialNumber || item.id}` },
    'continuity-test':{
      label:'Test de secours', records:docs.filter(item => item.kind === 'continuity_test'),
      text:item => `${new Date(item.performedAt || 0).toLocaleString('fr-FR')} · ${item.result || 'résultat inconnu'}`
    }
  };
}

export async function openTicketModal({ type = '', id = null, requestKind = 'incident', subject = '', description = '' } = {}) {
  const user = getCurrentUser();
  let equipments = [], rooms = [], baies = [], screens = [], docs = [], context = { zones:[] };
  try {
    [equipments, rooms, baies, screens, docs, context] = await Promise.all([db.getAll('equipments'), db.getAll('rooms'), db.getAll('baies'), db.getAll('screens'), db.getAll('docs'), api('/api/access/context')]);
  } catch (error) { showToast(error.message || 'Impossible de préparer le formulaire.', 'error'); return; }
  const collections = relatedCollections(equipments, rooms, baies, screens, docs);
  document.getElementById('ticket-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ticket-modal';
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'ticket-modal-title');
  modal.innerHTML = `
    <div class="modal-content ticket-modal-content service-request-modal">
      <button type="button" class="close-modal" aria-label="Fermer">&times;</button>
      <h3 id="ticket-modal-title">Créer une demande</h3><p class="request-form-intro">La demande sera visible par vous et par l'équipe autorisée de la zone destinataire.</p>
      <form id="ticket-form">
        <fieldset class="request-kind-grid"><legend>Nature de la demande</legend>${renderKindOptions(requestKind)}</fieldset>
        <div id="request-standard-fields">
          <div class="request-form-grid">
            <div class="form-group"><label>Équipe / zone destinataire <span class="required">*</span></label><select name="destinationZoneId" required><option value="">Sélectionner…</option>${(context.zones || []).map(zone => `<option value="${escapeHTML(zone.id)}">${escapeHTML(zone.name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Priorité</label><select name="priority" id="ticket-prio"><option value="basse">Basse</option><option value="moyenne">Moyenne</option><option value="haute">Haute</option></select><small id="sla-info"></small></div>
            <div class="form-group request-field-wide"><label>Objet <span class="required">*</span></label><input name="subject" maxlength="240" required placeholder="Résumé clair de la demande"></div>
            <div class="form-group request-field-wide"><label>Description <span class="required">*</span></label><textarea name="description" maxlength="4000" required></textarea><small id="request-description-hint"></small></div>
          </div>
          <details class="request-related-block" ${type ? 'open' : ''}><summary>Lier un équipement, une salle, une baie ou un écran (facultatif)</summary><div class="request-form-grid"><div class="form-group"><label>Type d'élément</label><select name="relatedType" id="related-type"><option value="">Aucun élément lié</option>${Object.entries(collections).map(([key, item]) => `<option value="${key}">${item.label}</option>`).join('')}</select></div><div class="form-group" id="related-selector"></div></div></details>
          <div class="request-form-grid request-dynamic-fields" id="request-dynamic-fields"></div>
          <div class="form-group"><label>Pièce jointe</label><input type="file" name="attach" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"><small>Image ou PDF, 5 Mo maximum.</small></div>
        </div>
        <div class="ticket-modal-actions"><button type="button" class="btn gray" id="cancel-ticket-btn">Annuler</button><button type="submit" class="btn btn-primary" id="submit-ticket-btn"><i class="fas fa-paper-plane"></i> Envoyer la demande</button></div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const form = modal.querySelector('#ticket-form');
  form.subject.value = subject;
  form.description.value = description;
  const close = () => modal.remove();
  modal.querySelector('.close-modal').onclick = close;
  modal.querySelector('#cancel-ticket-btn').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) close(); });

  const updateSla = () => {
    const minutes = requestSlaMinutes(form.priority.value);
    modal.querySelector('#sla-info').textContent = `Délai cible : ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  };
  const renderRelated = () => {
    const selectedType = form.relatedType.value;
    const target = modal.querySelector('#related-selector');
    target.replaceChildren();
    if (!selectedType || !collections[selectedType]) return;
    const label = document.createElement('label'); label.textContent = collections[selectedType].label;
    const select = document.createElement('select'); select.name = 'relatedId';
    select.appendChild(new Option(`Sélectionner ${collections[selectedType].label.toLowerCase()}…`, ''));
    for (const record of collections[selectedType].records) select.appendChild(new Option(collections[selectedType].text(record), record.id));
    if (id != null && selectedType === type) select.value = String(id);
    target.append(label, select);
  };
  const renderKind = () => {
    const kind = new FormData(form).get('requestKind') || 'incident';
    const definition = requestKindDefinition(kind);
    modal.querySelectorAll('.request-kind-option').forEach(option => option.classList.toggle('selected', option.querySelector('input').checked));
    modal.querySelector('#request-dynamic-fields').innerHTML = renderDynamicFields(kind);
    modal.querySelector('#request-standard-fields').classList.toggle('access-only', Boolean(definition.usesAccessWorkflow));
    form.priority.value = definition.defaultPriority;
    form.description.placeholder = definition.descriptionHint || '';
    modal.querySelector('#request-description-hint').textContent = definition.descriptionHint || '';
    modal.querySelector('#submit-ticket-btn').hidden = Boolean(definition.usesAccessWorkflow);
    modal.querySelector('#open-zone-access-workflow')?.addEventListener('click', () => { close(); openAccessRequestModal(user, { showNotification:showToast }); });
    updateSla();
  };
  form.relatedType.onchange = renderRelated;
  form.priority.onchange = updateSla;
  modal.querySelectorAll('input[name="requestKind"]').forEach(input => input.onchange = renderKind);
  if (type && collections[type]) { form.relatedType.value = type; renderRelated(); }
  renderKind();

  form.onsubmit = async event => {
    event.preventDefault();
    const kind = new FormData(form).get('requestKind');
    if (requestKindDefinition(kind).usesAccessWorkflow) return;
    const file = form.attach.files[0];
    if (file?.size > 5 * 1024 * 1024) return showToast('La pièce jointe dépasse 5 Mo.', 'error');
    const details = Object.fromEntries([...form.querySelectorAll('[data-detail]')].map(input => [input.dataset.detail, input.value]));
    const payload = { requestKind:kind, destinationZoneId:form.destinationZoneId.value, subject:form.subject.value, description:form.description.value, priority:form.priority.value, relatedType:form.relatedType.value, relatedId:form.relatedId?.value || '', details, attachment:file ? await readFile(file) : '' };
    const validation = validateRequestPayload(payload);
    if (validation.errors.length) return showToast(validation.errors[0], 'error');
    const submit = modal.querySelector('#submit-ticket-btn');
    submit.disabled = true; submit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…';
    try {
      const result = await api('/api/service-requests', { method:'POST', body:JSON.stringify(payload) });
      await refreshCentralTickets();
      notifyAllUsers(`Nouvelle demande ${requestKindDefinition(kind).shortLabel} #${result.request.id}`);
      close(); showToast(`Demande ${result.request.id} envoyée.`, 'success');
    } catch (error) {
      showToast(error.status === 503 ? "Serveur indisponible : la demande n'a pas été envoyée. Réessayez en ligne." : error.message, 'error');
      submit.disabled = false; submit.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer la demande';
    }
  };
}

/**
 * La pastille SLA d'UN ticket — le texte reste la source de vérité (jamais la couleur
 * seule) : `3 h 24 min`, `SLA dépassé de 18 min`, `Fermé`… `data-sla-deadline`/`data-sla-status`
 * portent tout ce qu'un tick périodique doit relire pour recalculer SANS jamais retoucher
 * `ticket.deadline` lui-même — ce champ reste écrit une seule fois, par le serveur.
 */
function slaPill(ticket) {
  const etat = slaEscalationState(ticket);
  const deadline = ticket.deadline ? escapeHTML(ticket.deadline) : '';
  return `<span class="sla-pill sla-${etat.state}" data-sla-deadline="${deadline}" data-sla-status="${escapeHTML(ticket.status || '')}" data-sla-minutes="${escapeHTML(ticket.slaMinutes ?? '')}" data-sla-prio="${escapeHTML(ticket.prio || ticket.priority || '')}"><i class="fas fa-circle"></i> ${escapeHTML(etat.label)}</span>`;
}

/**
 * Un tick périodique, UNE SEULE FOIS installé pour toute la page (jamais un par rendu de
 * tableau, qui s'empilerait à chaque changement de filtre) : il relit `data-sla-*` sur
 * CHAQUE pastille actuellement dans le DOM — tableau ou fiche détaillée — et recalcule son
 * état SANS recharger `tickets` depuis la base. Une pastille absente (page quittée) ne coûte
 * rien : `querySelectorAll` ne trouve alors personne.
 */
let slaTickerInstalled = false;
function ensureSlaTicker() {
  if (slaTickerInstalled) return;
  slaTickerInstalled = true;
  setInterval(() => {
    document.querySelectorAll('.sla-pill[data-sla-deadline]').forEach(pill => {
      const etat = slaEscalationState({
        status: pill.dataset.slaStatus,
        deadline: pill.dataset.slaDeadline,
        slaMinutes: pill.dataset.slaMinutes ? Number(pill.dataset.slaMinutes) : undefined,
        prio: pill.dataset.slaPrio
      });
      pill.className = `sla-pill sla-${etat.state}`;
      pill.innerHTML = `<i class="fas fa-circle"></i> ${escapeHTML(etat.label)}`;
    });
  }, 30_000);
}

/**
 * Les tickets encore ouverts remontent par URGENCE — proportion de délai restant, pas
 * minutes brutes, exactement la règle de `slaEscalationState` — jamais par simple date de
 * création : c'est le point même de l'escalade visuelle. `remainingRatio` vaut `null` pour
 * un ticket clos : il retombe en fin de liste, faute d'avoir encore besoin d'attention. À
 * urgence égale, la création la plus récente reste le repère précédent.
 */
function sortByUrgency(tickets) {
  const rang = ticket => { const ratio = slaEscalationState(ticket).remainingRatio; return ratio == null ? Infinity : ratio; };
  return tickets.slice().sort((left, right) => rang(left) - rang(right) || new Date(right.createdAt) - new Date(left.createdAt));
}

export async function showTicketsList({ filterType = '', filterKind = '', filterStatus = '', search = '', target = 'admin-content' } = {}) {
  let tickets = await db.getAll('tickets');
  if (filterType) tickets = tickets.filter(ticket => (ticket.relatedType || ticket.type) === filterType);
  if (filterKind) tickets = tickets.filter(ticket => requestKindOf(ticket) === filterKind);
  if (filterStatus) tickets = tickets.filter(ticket => ticket.status === filterStatus);
  if (search.trim().length > 1) {
    const query = search.toLowerCase();
    tickets = tickets.filter(ticket => [ticket.id, ticket.subject, ticket.title, ticket.desc, ticket.relatedName, ticket.destinationZoneName, ticket.createdBy, requestLabel(ticket)].some(value => String(value || '').toLowerCase().includes(query)));
  }
  tickets = sortByUrgency(tickets);
  const container = document.getElementById(target);
  if (!container) return;
  ensureSlaTicker();
  container.innerHTML = `
    <div class="service-request-filters"><input id="tickets-search" type="search" placeholder="Rechercher une demande…" value="${escapeHTML(search)}"><select id="tickets-kind-filter"><option value="">Toutes les demandes</option>${Object.entries(REQUEST_KINDS).filter(([, item]) => !item.usesAccessWorkflow).map(([key, item]) => `<option value="${key}" ${filterKind === key ? 'selected' : ''}>${escapeHTML(item.shortLabel)}</option>`).join('')}</select><select id="tickets-status-filter"><option value="">Tous les statuts</option>${['en cours','attente','prêt-fermeture','fermé'].map(status => `<option value="${status}" ${filterStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
    <div class="service-requests-table-wrap"><table class="tableau service-requests-table"><thead><tr><th>N°</th><th>Demande</th><th>Destination / Élément</th><th>Objet</th><th>Priorité</th><th>Statut</th><th>SLA</th><th>Créée</th><th>Par</th><th></th></tr></thead><tbody>
      ${tickets.length ? tickets.map(ticket => `<tr class="ticket-row" data-id="${escapeHTML(ticket.id)}"><td><span class="request-number">${escapeHTML(ticket.id)}</span></td><td><span class="request-kind-badge kind-${safeClass(requestKindOf(ticket))}">${escapeHTML(requestLabel(ticket))}</span></td><td><strong>${escapeHTML(ticket.destinationZoneName || '—')}</strong>${ticket.relatedName ? `<small>${escapeHTML(ticket.relatedName)}</small>` : ''}</td><td>${escapeHTML(ticket.subject || ticket.title || ticket.desc || 'Sans objet')}</td><td><span class="status-badge ${safeClass(ticket.prio)}">${escapeHTML(ticket.prio || 'moyenne')}</span></td><td><span class="status-badge status-${safeClass(ticket.status)}">${escapeHTML(ticket.status || 'en cours')}</span></td><td>${slaPill(ticket)}</td><td>${formatDate(ticket.createdAt)}</td><td>${escapeHTML(ticket.createdBy || '—')}</td><td><button class="btn-icon view-ticket" data-id="${escapeHTML(ticket.id)}" aria-label="Voir la demande"><i class="fas fa-eye"></i></button></td></tr>`).join('') : '<tr><td colspan="10" class="empty-state">Aucune demande trouvée.</td></tr>'}
    </tbody></table></div>`;
  const rerender = () => showTicketsList({ filterKind:container.querySelector('#tickets-kind-filter').value, filterStatus:container.querySelector('#tickets-status-filter').value, search:container.querySelector('#tickets-search').value, target });
  container.querySelector('#tickets-kind-filter').onchange = rerender;
  container.querySelector('#tickets-status-filter').onchange = rerender;
  let searchTimer;
  container.querySelector('#tickets-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(rerender, 300); };
  container.querySelector('tbody').onclick = async event => {
    const row = event.target.closest('.ticket-row');
    if (!row) return;
    const ticket = await db.get('tickets', normalizeId(row.dataset.id));
    if (ticket) showTicketDetails(ticket, target);
  };
}

function detailRows(ticket) {
  const definition = requestKindDefinition(requestKindOf(ticket));
  return (definition.fields || []).filter(field => ticket.details?.[field.key]).map(field => `<div><dt>${escapeHTML(field.label)}</dt><dd>${escapeHTML(ticket.details[field.key])}</dd></div>`).join('');
}

function commentAttachment(comment) {
  const attachment = safeAttachment(comment.attachment || comment.img || comment.pdf);
  if (!attachment) return '';
  return attachment.startsWith('data:image/') ? `<a href="${attachment}" target="_blank" rel="noopener"><img src="${attachment}" alt="Pièce jointe"></a>` : `<a href="${attachment}" target="_blank" rel="noopener"><i class="fas fa-file-pdf"></i> PDF joint</a>`;
}

export function showTicketDetails(ticket, refreshTarget = null) {
  document.getElementById('ticket-detail-modal')?.remove();
  ensureSlaTicker();
  const user = getCurrentUser();
  const manager = canManageTicket(ticket, user);
  const owner = isTicketOwner(ticket, user);
  const canComment = owner || manager;
  const definition = requestKindDefinition(requestKindOf(ticket));
  const modal = document.createElement('div');
  modal.id = 'ticket-detail-modal'; modal.className = 'modal'; modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content service-request-detail"><button type="button" class="close-modal" aria-label="Fermer">&times;</button>
      <div class="request-detail-heading"><span class="request-kind-badge kind-${safeClass(requestKindOf(ticket))}">${escapeHTML(definition.label)}</span><h3>${escapeHTML(ticket.subject || ticket.title || `Demande ${ticket.id}`)}</h3><span class="request-number">${escapeHTML(ticket.id)}</span></div>
      <dl class="request-detail-grid"><div><dt>Destination</dt><dd>${escapeHTML(ticket.destinationZoneName || '—')}</dd></div><div><dt>Élément lié</dt><dd>${escapeHTML(ticket.relatedName || 'Aucun')}</dd></div><div><dt>Créée par</dt><dd>${escapeHTML(ticket.createdBy || '—')}</dd></div><div><dt>Date</dt><dd>${formatDate(ticket.createdAt)}</dd></div><div><dt>Priorité</dt><dd><span class="status-badge ${safeClass(ticket.prio)}">${escapeHTML(ticket.prio || 'moyenne')}</span></dd></div><div><dt>SLA</dt><dd>${slaPill(ticket)}</dd></div>${detailRows(ticket)}</dl>
      <section class="request-description"><h4>Description</h4><p>${escapeHTML(ticket.desc || ticket.description || '—')}</p>${safeAttachment(ticket.attach) ? `<a href="${safeAttachment(ticket.attach)}" target="_blank" rel="noopener"><i class="fas fa-paperclip"></i> Pièce jointe</a>` : ''}</section>
      <section class="request-processing"><h4>Traitement</h4><div class="request-form-grid"><div class="form-group"><label>Statut</label><select id="ticket-status-select" ${manager && ticket.status !== 'fermé' ? '' : 'disabled'}>${ticketStatusOptions(user, ticket.status || 'en cours')}</select></div><div class="form-group request-field-wide"><label>Solution / réponse</label><textarea id="ticket-solution" rows="3" ${manager && ticket.status !== 'fermé' ? '' : 'readonly'}>${escapeHTML(ticket.solution || '')}</textarea>${manager && ticket.status !== 'fermé' ? '<button id="save-solution-btn" class="btn">Enregistrer la réponse</button>' : ''}</div></div></section>
      <section class="request-comments"><h4>Échanges</h4><div id="ticket-comments-list">${(ticket.comments || []).map(comment => `<article class="request-comment" data-id="${escapeHTML(comment.id || '')}"><header><strong>${escapeHTML(comment.user || 'Utilisateur')}</strong><time>${formatDate(comment.date)}</time></header><p>${escapeHTML(comment.text || '')}</p>${commentAttachment(comment)}${comment.id && (manager || String(comment.userId || '') === String(user?.id)) ? `<div class="comment-actions"><button class="btn-icon edit-comment" title="Modifier"><i class="fas fa-edit"></i></button><button class="btn-icon delete-comment" title="Supprimer"><i class="fas fa-trash"></i></button></div>` : ''}</article>`).join('') || '<p class="empty-state">Aucun échange.</p>'}</div>${canComment ? `<div class="request-new-comment"><textarea id="new-ticket-comment" maxlength="2000" placeholder="Ajouter un commentaire…"></textarea><input type="file" id="comment-attach" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"><button id="add-ticket-comment-btn" class="btn"><i class="fas fa-paper-plane"></i> Ajouter</button></div>` : ''}</section>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.close-modal').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  const reload = async () => { await refreshCentralTickets(); const updated = await db.get('tickets', normalizeId(ticket.id)); close(); if (updated) showTicketDetails(updated, refreshTarget); };
  if (manager && ticket.status !== 'fermé') {
    modal.querySelector('#ticket-status-select').onchange = async event => {
      const select = event.currentTarget; select.disabled = true;
      try { await api(`/api/service-requests/${encodeURIComponent(ticket.id)}`, { method:'PATCH', body:JSON.stringify({ status:select.value }) }); notifyAllUsers(`Demande #${ticket.id} : statut ${select.value}`); showToast('Statut mis à jour.', 'success'); await reload(); }
      catch (error) { showToast(error.message, 'error'); select.disabled = false; select.value = ticket.status; }
    };
    modal.querySelector('#save-solution-btn')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await api(`/api/service-requests/${encodeURIComponent(ticket.id)}`, { method:'PATCH', body:JSON.stringify({ solution:modal.querySelector('#ticket-solution').value }) }); showToast('Réponse enregistrée.', 'success'); await reload(); }
      catch (error) { showToast(error.message, 'error'); event.currentTarget.disabled = false; }
    });
  }
  modal.querySelector('#add-ticket-comment-btn')?.addEventListener('click', async event => {
    const text = modal.querySelector('#new-ticket-comment').value.trim();
    const file = modal.querySelector('#comment-attach').files[0];
    if (!text && !file) return;
    if (file?.size > 5 * 1024 * 1024) return showToast('La pièce jointe dépasse 5 Mo.', 'error');
    event.currentTarget.disabled = true;
    try { await api(`/api/service-requests/${encodeURIComponent(ticket.id)}/comments`, { method:'POST', body:JSON.stringify({ text, attachment:file ? await readFile(file) : '' }) }); await reload(); }
    catch (error) { showToast(error.message, 'error'); event.currentTarget.disabled = false; }
  });
  modal.querySelectorAll('.edit-comment').forEach(button => button.onclick = async () => {
    const article = button.closest('.request-comment');
    const currentText = article.querySelector('p').textContent;
    const nextText = prompt('Modifier le commentaire', currentText)?.trim();
    if (!nextText || nextText === currentText) return;
    try { await api(`/api/service-requests/${encodeURIComponent(ticket.id)}/comments/${encodeURIComponent(article.dataset.id)}`, { method:'PATCH', body:JSON.stringify({ text:nextText }) }); await reload(); }
    catch (error) { showToast(error.message, 'error'); }
  });
  modal.querySelectorAll('.delete-comment').forEach(button => button.onclick = async () => {
    const article = button.closest('.request-comment');
    if (!confirm('Supprimer ce commentaire ?')) return;
    try { await api(`/api/service-requests/${encodeURIComponent(ticket.id)}/comments/${encodeURIComponent(article.dataset.id)}`, { method:'DELETE' }); await reload(); }
    catch (error) { showToast(error.message, 'error'); }
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = event => resolve(event.target.result); reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.')); reader.readAsDataURL(file); });
}

export function notifyAllUsers(message) {
  eventSystem.dispatch('show-notification', { message, type:'info' });
}
