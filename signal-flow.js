import AdminUI from './admin-ui.js';
import { db } from './db.js';
import { getCurrentUser } from './security.js';
import {
  TOPOLOGY_KINDS,
  SIGNAL_TYPES,
  PATH_ROLES,
  loadTopologySnapshot,
  saveTopologyRecord,
  deleteTopologyRecord,
  exportTopologyPayload,
  importTopologyPayload,
  buildSignalGraph
} from './broadcast-topology.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const statusLabel = value => ({ verified:'Vérifié', documented:'Documenté', 'observed-handwritten':'Observation manuscrite', 'to-confirm':'À confirmer', draft:'Brouillon' }[value] || value || 'À confirmer');
const confidenceLabel = value => ({ high:'Haute', medium:'Moyenne', low:'Faible' }[value] || value || 'Moyenne');
const roleLabel = value => ({ PROGRAM:'Programme', BACKUP:'Secours', MONITORING:'Monitoring', SYNC:'Synchronisation', AUDIO:'Audio', INTERCOM:'Intercom', OTHER:'Autre' }[value] || value || 'Autre');

function injectStyles() {
  if (document.getElementById('signal-flow-styles')) return;
  const style = document.createElement('style');
  style.id = 'signal-flow-styles';
  style.textContent = `
    .sf-page{display:grid;gap:16px}.sf-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:20px;border:1px solid var(--border-color,#dbe3ea);border-radius:16px;background:var(--card-bg,#fff)}
    .sf-hero h2{margin:0 0 6px}.sf-hero p{margin:0;color:var(--text-muted,#617180);max-width:850px}.sf-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
    .sf-warning{padding:11px 14px;border-radius:10px;background:#fff7dc;color:#735c00;border:1px solid #f0d67a;font-size:13px}.dark-theme .sf-warning{background:#302a16;color:#f8df7c;border-color:#6d5d22}
    .sf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.sf-stat{padding:15px;border-radius:14px;background:var(--card-bg,#fff);border:1px solid var(--border-color,#dbe3ea)}.sf-stat strong{display:block;font-size:25px}.sf-stat span{font-size:12px;color:var(--text-muted,#617180)}
    .sf-grid{display:grid;grid-template-columns:1fr;gap:14px}.sf-panel{background:var(--card-bg,#fff);border:1px solid var(--border-color,#dbe3ea);border-radius:14px;padding:16px;overflow:auto}.sf-panel h3{margin:0 0 12px}
    .sf-table{width:100%;border-collapse:collapse;min-width:760px}.sf-table th,.sf-table td{padding:9px 8px;text-align:left;border-bottom:1px solid var(--border-color,#e5e9ed);vertical-align:top}.sf-table th{font-size:12px;color:var(--text-muted,#667783);text-transform:uppercase;letter-spacing:.03em}.sf-muted{color:var(--text-muted,#667783);font-size:12px}
    .sf-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#edf3f8;color:#304a5f}.sf-badge.ok{background:#e8f7ee;color:#176c3a}.sf-badge.pending{background:#fff4d7;color:#7b5b00}.sf-badge.draft{background:#eceff3;color:#59636e}.sf-badge.role{background:#e9efff;color:#274f95}
    .sf-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sf-node{padding:6px 9px;border-radius:8px;border:1px solid var(--border-color,#dbe3ea);background:var(--light-bg,#f7f9fb);font-weight:600}.sf-arrow{opacity:.6}
    .sf-empty{padding:22px;text-align:center;color:var(--text-muted,#667783);border:1px dashed var(--border-color,#dbe3ea);border-radius:10px}
    .sf-modal{position:fixed;inset:0;z-index:45000;background:rgba(10,18,28,.58);display:flex;align-items:center;justify-content:center;padding:20px}.sf-modal-card{width:min(760px,96vw);max-height:90vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text-color,#1d2a34);border-radius:16px;box-shadow:0 24px 70px #0007}.sf-modal-card header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border-color,#dbe3ea)}.sf-modal-card form,.sf-modal-body{padding:18px}.sf-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sf-modal label{display:grid;gap:5px;font-size:13px}.sf-modal input,.sf-modal select,.sf-modal textarea{width:100%;box-sizing:border-box;padding:9px;border-radius:8px;border:1px solid var(--input-border,#cfd8df);background:var(--input-bg,#fff);color:inherit}.sf-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.sf-close{border:0;background:transparent;font-size:24px;cursor:pointer;color:inherit}.sf-file{display:none}
    @media(max-width:720px){.sf-hero{flex-direction:column}.sf-actions{justify-content:flex-start}.sf-form-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

class SignalFlow {
  constructor(notifications) {
    this.notifications = notifications;
    this.snapshot = null;
    this.equipments = [];
    this.rooms = [];
    this.baies = [];
  }

  async load() {
    [this.snapshot, this.equipments, this.rooms, this.baies] = await Promise.all([
      loadTopologySnapshot(),
      db.getAll('equipments'),
      db.getAll('rooms'),
      db.getAll('baies')
    ]);
    return this.snapshot;
  }

  canEdit() {
    return ['admin', 'manager'].includes(getCurrentUser()?.role);
  }

  async render() {
    injectStyles();
    await this.load();
    const s = this.snapshot;
    const graph = buildSignalGraph(s);
    const canEdit = this.canEdit();
    return `
      <div class="sf-page">
        <section class="sf-hero">
          <div>
            <h2><i class="fas fa-project-diagram"></i> Flux de signal & grille centrale</h2>
            <p>Documentation structurée des entrées/sorties de grille, crosspoints, flux programme/secours, monitoring, synchro, points de brassage et synoptiques. Les données validées sont conservées dans la base centrale.</p>
          </div>
          ${canEdit ? `<div class="sf-actions">
            <button class="btn" data-sf-add="path"><i class="fas fa-plus"></i> Ajouter un flux</button>
            <button class="btn gray" data-sf-add="router"><i class="fas fa-th"></i> Ajouter une grille</button>
            <button class="btn gray" data-sf-add="router-port"><i class="fas fa-random"></i> Port de grille</button>
            <button class="btn gray" data-sf-add="router-interface"><i class="fas fa-plug"></i> Interface</button>
            <button class="btn gray" data-sf-add="rv-link"><i class="fas fa-link"></i> Liaison RV</button>
            <button class="btn gray" data-sf-add="crosspoint"><i class="fas fa-exchange-alt"></i> Crosspoint</button>
            <button class="btn gray" data-sf-add="synoptic"><i class="fas fa-file-alt"></i> Synoptique</button>
            <button class="btn gray" id="sf-import"><i class="fas fa-file-import"></i> Importer</button>
            <input class="sf-file" type="file" id="sf-import-file" accept="application/json,.json">
            <button class="btn gray" id="sf-export"><i class="fas fa-file-export"></i> Exporter</button>
          </div>` : ''}
        </section>

        <div class="sf-warning"><strong>Mode documentation uniquement.</strong> Cette section n’envoie aucune commande à la grille réelle. Un crosspoint enregistré ici décrit un état ou une relation documentée, pas une action de routage exécutée sur l’infrastructure.</div>

        <section class="sf-stats">
          ${this.stat('Grilles matricielles', s.routers.length)}
          ${this.stat('Flux documentés', s.signalPaths.length)}
          ${this.stat('Ports de grille', s.routerPorts.length)}
          ${this.stat('Interfaces', s.routerInterfaces.length)}
          ${this.stat('Crosspoints', s.crosspoints.length)}
          ${this.stat('Liaisons RV', s.rvLinks.length)}
          ${this.stat('Nœuds / relations', `${graph.nodes.length} / ${graph.edges.length}`)}
        </section>

        <div class="sf-grid">
          <section class="sf-panel">
            <h3>Grilles matricielles distinctes</h3>
            ${this.renderRouters(s.routers, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Flux documentés</h3>
            ${this.renderPaths(s.signalPaths, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Entrées / sorties de grille</h3>
            ${this.renderRouterPorts(s.routerPorts, s.routers, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Monitoring, Sync/Ref et contrôle</h3>
            ${this.renderRouterInterfaces(s.routerInterfaces, s.routers, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Liaisons RV inter-baies</h3>
            ${this.renderRvLinks(s.rvLinks, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Crosspoints documentés</h3>
            ${this.renderCrosspoints(s.crosspoints, s.routerPorts, canEdit)}
          </section>
          <section class="sf-panel">
            <h3>Synoptiques techniques</h3>
            ${this.renderSynoptics(s.synoptics, canEdit)}
          </section>
        </div>
      </div>
    `;
  }

  stat(label, value) {
    return `<div class="sf-stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
  }

  badge(record) {
    const cls = record.verificationStatus === 'verified' || record.verificationStatus === 'documented' ? 'ok' : record.verificationStatus === 'draft' ? 'draft' : 'pending';
    return `<span class="sf-badge ${cls}">${esc(statusLabel(record.verificationStatus))}</span> <span class="sf-badge">Confiance ${esc(confidenceLabel(record.confidence))}</span>`;
  }

  actionCell(record, canEdit) {
    if (!canEdit) return '';
    return `<button class="btn-icon sf-delete" data-id="${esc(record.id)}" title="Supprimer"><i class="fas fa-trash"></i></button>`;
  }

  renderRouters(routers, canEdit) {
    if (!routers.length) return `<div class="sf-empty">Aucune grille matricielle enregistrée.</div>`;
    return `<table class="sf-table"><thead><tr><th>Grille</th><th>Matrice</th><th>Constructeur / modèle</th><th>Localisation</th><th>Distincte de</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${routers.map(router => `
      <tr><td><strong>${esc(router.name)}</strong><div class="sf-muted">${esc(router.routerKey || router.id)}</div></td><td>${esc(router.matrixLabel || `${router.inputCapacity || '?'} × ${router.outputCapacity || '?'}`)}</td><td>${esc([router.manufacturer, router.model].filter(Boolean).join(' · ') || '—')}</td><td>${esc(router.location || '—')}</td><td>${esc(router.distinctFrom?.join(', ') || '—')}</td><td>${this.badge(router)}</td>${canEdit?`<td>${this.actionCell(router, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  renderPaths(paths, canEdit) {
    if (!paths.length) return `<div class="sf-empty">Aucun flux validé pour le moment. Utilisez « Ajouter un flux » ou importez un fichier structuré après validation du synoptique.</div>`;
    return `<table class="sf-table"><thead><tr><th>Flux</th><th>Chemin</th><th>Rôle</th><th>Signal</th><th>Preuve</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${paths.map(path => `
      <tr>
        <td><strong>${esc(path.name || 'Flux')}</strong><div class="sf-muted">${esc(path.cableRefs?.join(', ') || '')}</div></td>
        <td><div class="sf-flow"><span class="sf-node">${esc(path.sourceLabel)}</span><span class="sf-arrow">→</span><span class="sf-node">${esc(path.destinationLabel)}</span></div></td>
        <td><span class="sf-badge role">${esc(roleLabel(path.pathRole))}</span></td>
        <td>${esc(path.signalType || 'SDI')}</td>
        <td>${esc(path.evidenceRef || path.sourceRef || '—')}</td>
        <td>${this.badge(path)}</td>
        ${canEdit?`<td>${this.actionCell(path, canEdit)}</td>`:''}
      </tr>`).join('')}</tbody></table>`;
  }

  renderRouterPorts(ports, routers, canEdit) {
    if (!ports.length) return `<div class="sf-empty">Aucune entrée/sortie de grille enregistrée.</div>`;
    const routerName = port => routers.find(router => String(router.id) === String(port.routerId))?.name || port.routerLabel || this.equipmentName(port.routerEquipmentId) || 'Grille';
    return `<table class="sf-table"><thead><tr><th>Grille</th><th>Direction</th><th>Port</th><th>Alias logique</th><th>Rôle</th><th>Signal</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${ports.map(port => `
      <tr><td>${esc(routerName(port))}</td><td><span class="sf-badge role">${esc(port.direction)}</span></td><td>${esc(port.portNumber || '—')}</td><td><strong>${esc(port.logicalAlias || '—')}</strong></td><td>${esc(port.logicalRole || '—')}</td><td>${esc(port.signalType || 'SDI')}</td><td>${this.badge(port)}</td>${canEdit?`<td>${this.actionCell(port, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  renderRouterInterfaces(items, routers, canEdit) {
    if (!items.length) return `<div class="sf-empty">Aucune interface de monitoring, référence ou contrôle enregistrée.</div>`;
    const routerName = id => routers.find(router => String(router.id) === String(id))?.name || id;
    return `<table class="sf-table"><thead><tr><th>Grille</th><th>Type</th><th>Interface</th><th>Fonction</th><th>Câbles</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${items.map(item => `<tr><td>${esc(routerName(item.routerId))}</td><td><span class="sf-badge role">${esc(item.interfaceType)}</span></td><td><strong>${esc(item.name)}</strong></td><td>${esc(item.function || item.location || '—')}</td><td>${esc(item.cableRefs?.join(', ') || '—')}</td><td>${this.badge(item)}</td>${canEdit?`<td>${this.actionCell(item, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  renderRvLinks(items, canEdit) {
    if (!items.length) return `<div class="sf-empty">Aucune liaison RV inter-baies documentée.</div>`;
    return `<table class="sf-table"><thead><tr><th>Source</th><th></th><th>Destination</th><th>Câbles / segments</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.sourceLabel)}</strong></td><td>↔</td><td><strong>${esc(item.destinationLabel)}</strong></td><td>${esc(item.cableRefs?.join(' ↔ ') || '—')}</td><td>${this.badge(item)}</td>${canEdit?`<td>${this.actionCell(item, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  renderCrosspoints(crosspoints, ports, canEdit) {
    if (!crosspoints.length) return `<div class="sf-empty">Aucun crosspoint documenté. Les crosspoints doivent rester distincts du câblage physique.</div>`;
    const label = id => ports.find(port => String(port.id) === String(id))?.logicalAlias || ports.find(port => String(port.id) === String(id))?.portNumber || id;
    return `<table class="sf-table"><thead><tr><th>Entrée</th><th></th><th>Sortie</th><th>État</th><th>Observation</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${crosspoints.map(cp => `
      <tr><td><strong>${esc(label(cp.inputPortId))}</strong></td><td>→</td><td><strong>${esc(label(cp.outputPortId))}</strong></td><td>${esc(cp.state || 'DOCUMENTED')}</td><td>${esc(cp.observedAt || '—')}</td><td>${this.badge(cp)}</td>${canEdit?`<td>${this.actionCell(cp, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  renderSynoptics(items, canEdit) {
    if (!items.length) return `<div class="sf-empty">Aucun synoptique référencé dans la base.</div>`;
    return `<table class="sf-table"><thead><tr><th>Titre</th><th>Référence</th><th>Révision</th><th>Périmètre</th><th>Source</th><th>Validation</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${items.map(item => `
      <tr><td><strong>${esc(item.title || 'Synoptique')}</strong></td><td>${esc(item.reference || '—')}</td><td>${esc(item.revision || '—')}</td><td>${esc(item.scope || item.system || '—')}</td><td>${item.imageUrl ? `<a href="${esc(item.imageUrl)}" target="_blank" rel="noopener">Ouvrir</a>` : esc(item.sourceRef || '—')}</td><td>${this.badge(item)}</td>${canEdit?`<td>${this.actionCell(item, canEdit)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }

  equipmentName(id) {
    const eq = this.equipments.find(item => String(item.id) === String(id));
    return eq?.name || eq?.nom || '';
  }

  async afterRender() {
    if (!this.canEdit()) return;
    document.querySelectorAll('[data-sf-add]').forEach(button => {
      button.addEventListener('click', () => this.openForm(button.dataset.sfAdd));
    });
    document.getElementById('sf-export')?.addEventListener('click', () => this.exportData());
    document.getElementById('sf-import')?.addEventListener('click', () => document.getElementById('sf-import-file')?.click());
    document.getElementById('sf-import-file')?.addEventListener('change', event => this.importData(event.target.files?.[0]));
    document.querySelectorAll('.sf-delete').forEach(button => button.addEventListener('click', () => this.confirmDelete(button.dataset.id)));
  }

  openAddForm() {
    this.openForm('path');
  }

  openForm(type) {
    if (type === 'router') return this.routerForm();
    if (type === 'router-port') return this.routerPortForm();
    if (type === 'router-interface') return this.routerInterfaceForm();
    if (type === 'rv-link') return this.rvLinkForm();
    if (type === 'crosspoint') return this.crosspointForm();
    if (type === 'synoptic') return this.synopticForm();
    return this.pathForm();
  }

  modal(title, body, onSubmit) {
    document.getElementById('sf-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'sf-modal';
    modal.id = 'sf-modal';
    modal.innerHTML = `<section class="sf-modal-card" role="dialog" aria-modal="true"><header><strong>${esc(title)}</strong><button class="sf-close" type="button">×</button></header>${body}</section>`;
    document.body.appendChild(modal);
    modal.querySelector('.sf-close').onclick = () => modal.remove();
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    const form = modal.querySelector('form');
    if (form && onSubmit) form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await onSubmit(new FormData(form));
        modal.remove();
        await this.refresh();
      } catch (error) {
        this.notifications?.showNotification(error.message, 'error');
        if (submit) submit.disabled = false;
      }
    };
    return modal;
  }

  commonValidationFields() {
    return `<label>Validation<select name="verificationStatus"><option value="documented">Documenté</option><option value="verified">Vérifié</option><option value="observed-handwritten">Observation manuscrite</option><option value="to-confirm" selected>À confirmer</option><option value="draft">Brouillon</option></select></label><label>Confiance<select name="confidence"><option value="high">Haute</option><option value="medium" selected>Moyenne</option><option value="low">Faible</option></select></label>`;
  }

  routerOptions(selected = '') {
    return this.snapshot.routers.map(router => `<option value="${esc(router.id)}" ${String(router.id)===String(selected)?'selected':''}>${esc(router.name)} · ${esc(router.matrixLabel || `${router.inputCapacity || '?'}×${router.outputCapacity || '?'}`)}</option>`).join('');
  }

  routerForm() {
    this.modal('Ajouter une grille matricielle', `<form><div class="sf-form-grid">
      <label>Nom de la grille<input name="name" required placeholder="Ex. Grille vidéo principale"></label>
      <label>Clé stable<input name="routerKey" required placeholder="ROUTER_MAIN"></label>
      <label>Nombre d’entrées<input name="inputCapacity" type="number" min="1" required></label>
      <label>Nombre de sorties<input name="outputCapacity" type="number" min="1" required></label>
      <label>Constructeur<input name="manufacturer" placeholder="À confirmer si inconnu"></label>
      <label>Modèle<input name="model" placeholder="À confirmer si inconnu"></label>
      <label>Localisation<input name="location" placeholder="Baie / salle"></label>
      <label>Équipement lié<select name="routerEquipmentId"><option value="">— Non lié —</option>${this.equipments.map(eq => `<option value="${esc(eq.id)}">${esc(eq.name || eq.nom || eq.id)}</option>`).join('')}</select></label>
      <label>Domaines de signal<input name="signalDomains" placeholder="SDI, REF_BB, AUDIO"></label>
      <label>Distincte de<input name="distinctFrom" placeholder="IDs de grilles, séparés par virgules"></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.ROUTER, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Grille matricielle enregistrée.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  pathForm() {
    this.modal('Ajouter un flux documenté', `<form><div class="sf-form-grid">
      <label>Nom du flux<input name="name" placeholder="Ex. Chemin programme RF"></label>
      <label>Rôle<select name="pathRole">${PATH_ROLES.map(v => `<option value="${v}">${roleLabel(v)}</option>`).join('')}</select></label>
      <label>Type de signal<select name="signalType">${SIGNAL_TYPES.map(v => `<option>${v}</option>`).join('')}</select></label>
      <label>Référence de preuve<input name="evidenceRef" placeholder="Plan / feuille / photo / relevé"></label>
      <label>Source<input name="sourceLabel" required placeholder="Source logique ou équipement"></label>
      <label>Destination<input name="destinationLabel" required placeholder="Destination logique ou équipement"></label>
      <label>Références câbles<input name="cableRefs" placeholder="D..., A..., séparées par virgules"></label>
      <label>Statut opérationnel<input name="status" placeholder="documenté / actif / secours..."></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.SIGNAL_PATH, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Flux enregistré dans la base centrale.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  routerPortForm() {
    this.modal('Ajouter une entrée / sortie de grille', `<form><div class="sf-form-grid">
      <label>Grille matricielle<select name="routerId" required><option value="">— Sélectionner —</option>${this.routerOptions()}</select></label>
      <label>Direction<select name="direction"><option value="INPUT">ENTRÉE</option><option value="OUTPUT">SORTIE</option></select></label>
      <label>N° port physique<input name="portNumber" placeholder="Ex. 29"></label>
      <label>Alias logique<input name="logicalAlias" placeholder="À saisir depuis la base locale"></label>
      <label>Rôle logique<select name="logicalRole"><option value="SOURCE">SOURCE</option><option value="DESTINATION">DESTINATION</option></select></label>
      <label>Type de signal<select name="signalType">${SIGNAL_TYPES.map(v => `<option>${v}</option>`).join('')}</select></label>
      <label>Référence de preuve<input name="sourceRef" placeholder="Plan / feuille / photo"></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.ROUTER_PORT, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Port de grille enregistré.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  routerInterfaceForm() {
    this.modal('Ajouter une interface de grille', `<form><div class="sf-form-grid">
      <label>Grille matricielle<select name="routerId" required><option value="">— Sélectionner —</option>${this.routerOptions()}</select></label>
      <label>Type<select name="interfaceType"><option value="SYNC_REFERENCE">Sync / Référence</option><option value="CONTROL">Contrôle</option><option value="MONITORING_OUTPUT">Sortie monitoring</option><option value="CONTROL_STATION">Station de contrôle</option><option value="OTHER">Autre</option></select></label>
      <label>Nom<input name="name" required placeholder="SYNCH X, ENET-X, MONITORING/OUT.X..."></label>
      <label>Fonction<input name="function" placeholder="BLACK, Tri-Level, contrôle..."></label>
      <label>Références câbles<input name="cableRefs" placeholder="REF-001, REF-002"></label>
      <label>Localisation<input name="location" placeholder="Baie / pupitre"></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.ROUTER_INTERFACE, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Interface de grille enregistrée.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  rvLinkForm() {
    this.modal('Ajouter une liaison RV inter-baies', `<form><div class="sf-form-grid">
      <label>Grille associée<select name="routerId"><option value="">— Non liée —</option>${this.routerOptions()}</select></label>
      <label>Type de signal<select name="signalType">${SIGNAL_TYPES.map(v => `<option>${v}</option>`).join('')}</select></label>
      <label>Source<input name="sourceLabel" required placeholder="BAIE A / repère"></label>
      <label>Destination<input name="destinationLabel" required placeholder="BAIE B / repère"></label>
      <label>Références câbles<input name="cableRefs" required placeholder="REF-101, REF-102"></label>
      <label>Référence de preuve<input name="sourceRef" placeholder="Plan / photo"></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.RV_LINK, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Liaison RV enregistrée.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  crosspointForm() {
    const inputs = this.snapshot.routerPorts.filter(port => port.direction === 'INPUT');
    const outputs = this.snapshot.routerPorts.filter(port => port.direction === 'OUTPUT');
    this.modal('Documenter un crosspoint', `<form><div class="sf-form-grid">
      <label>Grille matricielle<select name="routerId" required><option value="">— Sélectionner —</option>${this.routerOptions()}</select></label>
      <label>Entrée grille<select name="inputPortId" required><option value="">— Entrée —</option>${inputs.map(port => `<option data-router="${esc(port.routerId)}" value="${esc(port.id)}">IN.${esc(port.portNumber)} · ${esc(port.logicalAlias || port.id)}</option>`).join('')}</select></label>
      <label>Sortie grille<select name="outputPortId" required><option value="">— Sortie —</option>${outputs.map(port => `<option data-router="${esc(port.routerId)}" value="${esc(port.id)}">OUT.${esc(port.portNumber)} · ${esc(port.logicalAlias || port.id)}</option>`).join('')}</select></label>
      <label>État<select name="state"><option value="DOCUMENTED">Documenté</option><option value="ACTIVE">Actif observé</option><option value="UNKNOWN">Inconnu</option></select></label>
      <label>Date d’observation<input name="observedAt" type="datetime-local"></label>
      <label>Référence de preuve<input name="sourceRef" placeholder="Plan / photo / relevé"></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      const record = Object.fromEntries(data.entries());
      if (record.observedAt) record.observedAt = new Date(record.observedAt).toISOString();
      await saveTopologyRecord(TOPOLOGY_KINDS.CROSSPOINT, record);
      this.notifications?.showNotification('Crosspoint documenté. Aucune commande n’a été envoyée à la grille.', 'success');
    });
    const modal = document.getElementById('sf-modal');
    const router = modal?.querySelector('[name="routerId"]');
    const scopePorts = () => {
      for (const select of modal?.querySelectorAll('[name="inputPortId"], [name="outputPortId"]') || []) {
        select.value = '';
        for (const option of select.querySelectorAll('option[data-router]')) option.hidden = option.dataset.router !== router.value;
      }
    };
    router?.addEventListener('change', scopePorts);
    scopePorts();
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  synopticForm() {
    this.modal('Référencer un synoptique technique', `<form><div class="sf-form-grid">
      <label>Titre<input name="title" required placeholder="Synoptique diffusion ..."></label>
      <label>Référence<input name="reference" placeholder="N° plan"></label>
      <label>Révision<input name="revision"></label>
      <label>Périmètre<input name="scope" placeholder="Zone A / Zone B..."></label>
      <label>Référence source<input name="sourceRef" placeholder="Document / archive"></label>
      <label>URL image/document<input name="imageUrl" type="url" placeholder="https://..."></label>
      ${this.commonValidationFields()}
    </div><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="sf-form-actions"><button type="button" class="btn gray sf-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`, async data => {
      await saveTopologyRecord(TOPOLOGY_KINDS.SYNOPTIC, Object.fromEntries(data.entries()));
      this.notifications?.showNotification('Synoptique référencé.', 'success');
    });
    document.querySelector('#sf-modal .sf-cancel').onclick = () => document.getElementById('sf-modal')?.remove();
  }

  confirmDelete(id) {
    this.modal('Supprimer cet élément ?', `<div class="sf-modal-body"><p>La suppression concerne uniquement cet enregistrement de topologie. Les équipements et câbles existants ne seront pas supprimés.</p><div class="sf-form-actions"><button type="button" class="btn gray sf-no">Annuler</button><button type="button" class="btn danger sf-yes">Supprimer</button></div></div>`);
    document.querySelector('#sf-modal .sf-no').onclick = () => document.getElementById('sf-modal')?.remove();
    document.querySelector('#sf-modal .sf-yes').onclick = async () => {
      try {
        await deleteTopologyRecord(id);
        document.getElementById('sf-modal')?.remove();
        this.notifications?.showNotification('Élément supprimé.', 'success');
        await this.refresh();
      } catch (error) {
        this.notifications?.showNotification(error.message, 'error');
      }
    };
  }

  async importData(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const result = await importTopologyPayload(payload);
      this.notifications?.showNotification(`${result.imported.length} élément(s) importé(s)${result.rejected.length ? `, ${result.rejected.length} rejeté(s)` : ''}.`, result.rejected.length ? 'warning' : 'success');
      await this.refresh();
    } catch (error) {
      this.notifications?.showNotification(`Import impossible : ${error.message}`, 'error');
    }
  }

  async exportData() {
    const payload = await exportTopologyPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `2m-tech-topologie-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.notifications?.showNotification('Topologie exportée.', 'success');
  }

  async refresh() {
    const container = document.getElementById('admin-content');
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  }
}

const PATCH_FLAG = Symbol.for('2m-tech.signal-flow.admin-patched');
if (!AdminUI.prototype[PATCH_FLAG]) {
  const originalInitSections = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithSignalFlow() {
    const sections = originalInitSections.call(this);
    const ordered = {};
    for (const [key, value] of Object.entries(sections)) {
      ordered[key] = value;
      if (key === 'devices') ordered.signalFlow = { title:'Flux de signal', icon:'fas fa-project-diagram', component:new SignalFlow(this.notifications) };
    }
    if (!ordered.signalFlow) ordered.signalFlow = { title:'Flux de signal', icon:'fas fa-project-diagram', component:new SignalFlow(this.notifications) };
    return ordered;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

export default SignalFlow;
