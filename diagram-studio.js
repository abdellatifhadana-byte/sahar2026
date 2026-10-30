import { db } from './db.js';
import AdminUI from './admin-ui.js';
import ResponsibleUI from './responsible-ui.js';
import TechUISmart from './techui.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';
import { normalizePorts, normalizeCableRecord, cableAllowsReverse, PATH_ROLE_COLORS } from './connectivity-contract.js';
import {
  DIAGRAM_RECORD_KIND, DIAGRAM_TYPES, DIAGRAM_EDGE_TYPES,
  DIAGRAM_RELATION_KINDS, normalizeDiagram, validateDiagram, diagramNodeDisplayLabel
} from './diagram-contract.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const typeLabel = value => ({
  'physical-plan':'Plan physique', 'room-layout':'Implantation salle', 'rack-elevation':'Élévation baie',
  'chassis-layout':'Implantation châssis', 'signal-synoptic':'Synoptique signal',
  'network-topology':'Topologie réseau', 'router-matrix':'Matrice grille',
  'power-sync-control':'Énergie / synchro / contrôle', 'wall-layout':"Mur d'images"
})[value] || value;
const statusLabel = value => ({ draft:'Brouillon', documented:'Documenté', validated:'Validé', retired:'Retiré' })[value] || value;
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
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `Erreur serveur (${response.status})`), { status:response.status, code:payload.error, details:payload.details });
  return payload;
}

async function saveVerifiedDiagram(record) {
  const payload = await api(`/api/data/docs/${encodeURIComponent(record.id)}`, { method:'PUT', body:JSON.stringify(record) });
  const saved = payload.record || record;
  await (db.saveLocalOnly ? db.saveLocalOnly('docs', saved) : db.save('docs', saved));
  return saved;
}

function modalShell(id, title, body, wide = false) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id; modal.className = 'modal diagram-modal';
  modal.innerHTML = `<div class="modal-content diagram-modal-card ${wide ? 'diagram-modal-wide' : ''}"><button class="modal-x" type="button" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
  document.body.appendChild(modal); modal.style.display = 'flex';
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  return modal;
}

function referenceSignature(reference = {}) {
  return `${reference.type}:${reference.parentEquipmentId || ''}:${reference.id}`;
}

function cableEndpointSignature(cable, side) {
  return `${cable[`${side}Type`] || 'equipment'}:${cable[`${side}ParentEquipmentId`] || ''}:${cable[`${side}Id`]}`;
}

function nodePorts(entry) {
  return normalizePorts(entry?.entity?.ports || []);
}

export class DiagramStudio {
  constructor(user = getCurrentUser(), notifications = null, { readOnly = false } = {}) {
    this.user = user; this.notifications = notifications; this.readOnly = readOnly;
    this.diagrams = []; this.documents = []; this.cables = []; this.entities = []; this.access = { zones:[] };
  }

  notify(message, type = 'success') {
    if (this.notifications?.showNotification) this.notifications.showNotification(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  }

  canView() { return PermissionManager.check(this.user, 'diagrams', 'view') && (this.isGlobalAdmin() || this.zoneIdsWith('diagram.read').size > 0); }
  isGlobalAdmin() { return ['admin','manager'].includes(this.user?.role); }
  zoneIdsWith(permission) {
    if (this.isGlobalAdmin()) return new Set((this.access?.zones || []).map(zone => String(zone.id)));
    const memberships = new Set((this.access?.memberships || []).filter(item => !['inactive','revoked'].includes(item.status) && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).map(item => String(item.zoneId)));
    return new Set((this.access?.grants || []).filter(item => item.permission === permission && !['inactive','revoked'].includes(item.status) && memberships.has(String(item.zoneId)) && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).map(item => String(item.zoneId)));
  }
  canEdit() { return !this.readOnly && PermissionManager.check(this.user, 'diagrams', 'edit') && (this.isGlobalAdmin() || this.zoneIdsWith('diagram.edit').size > 0); }
  canCreate() { return !this.readOnly && PermissionManager.check(this.user, 'diagrams', 'create') && (this.isGlobalAdmin() || this.zoneIdsWith('diagram.edit').size > 0); }
  canValidate() { return !this.readOnly && PermissionManager.check(this.user, 'diagrams', 'validate') && (this.isGlobalAdmin() || this.zoneIdsWith('diagram.validate').size > 0); }
  hasRecordPermission(record, permission) {
    if (this.isGlobalAdmin()) return true;
    const allowed = this.zoneIdsWith(permission);
    const zones = Array.isArray(record?.zoneIds) ? record.zoneIds.map(String) : [];
    return zones.length > 0 && zones.every(zoneId => allowed.has(zoneId));
  }
  canEditRecord(record) { return this.canEdit() && !['validated','retired'].includes(record?.status) && this.hasRecordPermission(record, 'diagram.edit'); }
  canReviseRecord(record) { return this.canEdit() && record?.status === 'validated' && this.hasRecordPermission(record, 'diagram.edit'); }
  canValidateRecord(record) { return this.canValidate() && ['draft','documented'].includes(record?.status) && this.hasRecordPermission(record, 'diagram.validate'); }
  canRetireRecord(record) { return this.canValidate() && record?.status === 'validated' && this.hasRecordPermission(record, 'diagram.validate'); }

  async load() {
    const [documents, equipments, screens, rooms, baies, walls, cables, access] = await Promise.all([
      db.getAll('docs'), db.getAll('equipments'), db.getAll('screens'), db.getAll('rooms'),
      db.getAll('baies'), db.getAll('walls'), db.getAll('cables'),
      api('/api/access/context').catch(() => ({ zones:[] }))
    ]);
    this.documents = documents;
    this.diagrams = documents.filter(item => item.kind === DIAGRAM_RECORD_KIND);
    this.cables = cables.map(normalizeCableRecord);
    this.access = access;
    this.entities = [
      ...rooms.map(entity => ({ key:`room::${entity.id}`, type:'room', id:entity.id, label:`Salle · ${entity.name || entity.id}`, entity })),
      ...baies.map(entity => ({ key:`baie::${entity.id}`, type:'baie', id:entity.id, label:`Baie · ${entity.name || entity.id}`, entity })),
      ...walls.map(entity => ({ key:`wall::${entity.id}`, type:'wall', id:entity.id, label:`Mur · ${entity.name || entity.id}`, entity })),
      ...equipments.flatMap(entity => [
        { key:`equipment::${entity.id}`, type:'equipment', id:entity.id, label:`Équipement · ${entity.name || entity.nom || entity.id}`, entity },
        ...(entity.components || []).map(component => ({ key:`component:${entity.id}:${component.id}`, type:'component', id:component.id, parentEquipmentId:entity.id, label:`Composant · ${entity.name || entity.id} / ${component.name || component.nom || component.id}`, entity:component }))
      ]),
      ...screens.map(entity => ({ key:`screen::${entity.id}`, type:'screen', id:entity.id, label:`Écran · ${entity.name || entity.id}`, entity })),
      ...this.cables.map(entity => ({ key:`cable::${entity.id}`, type:'cable', id:entity.id, label:`Câble · ${entity.reference || entity.id}`, entity })),
      ...documents.flatMap(entity => {
        const type = ({ topology_router:'router', topology_router_port:'router-port', topology_router_interface:'router-interface', topology_signal_path:'signal-path', topology_patch_point:'patch-point', continuity_protection_group:'service' })[entity.kind];
        return type ? [{ key:`${type}::${entity.id}`, type, id:entity.id, label:`${type} · ${entity.title || entity.name || entity.serviceName || entity.logicalAlias || entity.id}`, entity }] : [];
      })
    ];
  }

  async render() {
    await this.load();
    if (!this.canView()) return '<div class="error-message">Accès aux schémas non autorisé.</div>';
    return `<section class="diagram-studio">
      <header class="diagram-hero"><div><h2><i class="fas fa-project-diagram"></i> Schémas techniques liés</h2><p>Le dessin visualise les données réelles; il ne crée jamais une deuxième fiche d'équipement, de port ou de câble.</p></div>${this.canCreate() ? '<button class="btn" data-diagram-new><i class="fas fa-plus"></i> Nouveau schéma</button>' : ''}</header>
      <div class="diagram-principles"><span><i class="fas fa-link"></i> Entités canoniques</span><span><i class="fas fa-plug"></i> Câbles existants</span><span><i class="fas fa-user-check"></i> Validation à quatre yeux</span></div>
      <div class="diagram-library">${this.diagrams.length ? this.diagrams.map(diagram => this.renderCard(diagram)).join('') : '<div class="diagram-empty">Aucun schéma lié. Commencez par un périmètre pilote RF1/RF2 et conservez les autres plans comme preuves jusqu’à leur vérification.</div>'}</div>
    </section>`;
  }

  renderCard(diagram) {
    const editable = this.canEditRecord(diagram);
    return `<article class="diagram-card status-${esc(diagram.status)}">
      <div class="diagram-preview" data-background-image="${esc(diagram.background?.imageUrl || '')}"><i class="fas fa-drafting-compass"></i><span>${diagram.nodes?.length || 0} éléments · ${diagram.edges?.length || 0} liaisons</span></div>
      <div class="diagram-card-body"><span class="diagram-status">${esc(statusLabel(diagram.status))}</span><h3>${esc(diagram.title)}</h3><p>${esc(typeLabel(diagram.diagramType))} · Rév. ${esc(diagram.revision)}</p><div class="diagram-card-actions"><button class="btn gray" data-diagram-open="${esc(diagram.id)}">${editable ? 'Ouvrir / modifier' : 'Consulter'}</button>${this.canReviseRecord(diagram) ? `<button class="btn gray" data-diagram-revise="${esc(diagram.id)}">Nouvelle révision</button>` : ''}${this.canValidateRecord(diagram) ? `<button class="btn" data-diagram-approve="${esc(diagram.id)}">Valider</button>` : ''}${this.canRetireRecord(diagram) ? `<button class="btn danger" data-diagram-retire="${esc(diagram.id)}">Retirer</button>` : ''}</div></div>
    </article>`;
  }

  async afterRender(root = document) {
    root.querySelectorAll('.diagram-preview[data-background-image]').forEach(element => {
      const reference = element.dataset.backgroundImage;
      if (reference) element.style.backgroundImage = `url("${reference.replace(/["\\]/g, '')}")`;
    });
    root.querySelector('[data-diagram-new]')?.addEventListener('click', () => this.openCreateForm());
    root.querySelectorAll('[data-diagram-open]').forEach(button => button.onclick = () => this.openEditor(button.dataset.diagramOpen));
    root.querySelectorAll('[data-diagram-revise]').forEach(button => button.onclick = () => this.createRevision(button.dataset.diagramRevise));
    root.querySelectorAll('[data-diagram-approve]').forEach(button => button.onclick = () => this.approve(button.dataset.diagramApprove));
    root.querySelectorAll('[data-diagram-retire]').forEach(button => button.onclick = () => this.retire(button.dataset.diagramRetire));
  }

  async refresh() {
    const container = document.getElementById('admin-content') || document.getElementById('responsible-content') || document.querySelector('.diagram-library-host');
    if (!container) return;
    container.innerHTML = await this.render(); await this.afterRender(container);
  }

  openCreateForm() {
    if (!this.canCreate()) return this.notify("Vous n'êtes pas autorisé à créer un schéma.", 'error');
    const allowedZoneIds = this.zoneIdsWith('diagram.edit');
    const zones = (this.access.zones || []).filter(zone => allowedZoneIds.has(String(zone.id)));
    const modal = modalShell('diagram-create-modal', 'Nouveau schéma technique', `<form class="diagram-form"><label>Titre<input name="title" required placeholder="Ex. Synoptique RF1 Principal / Secours"></label><label>Type<select name="diagramType">${DIAGRAM_TYPES.map(type => `<option value="${type}">${esc(typeLabel(type))}</option>`).join('')}</select></label><label>Zone<select name="zoneId" required><option value="">Sélectionner…</option>${zones.map(zone => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select></label><label>Révision<input name="revision" value="1"></label><label class="span-2">Chemin interne de l'image de fond<input name="imageUrl" placeholder="assets/plan-technique.PNG"></label><label class="span-2">Notes / source du plan<textarea name="notes" required placeholder="Référence du plan, date, auteur du relevé…"></textarea></label><div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Créer le brouillon</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const diagram = normalizeDiagram({ title:values.title, diagramType:values.diagramType, revision:values.revision, zoneIds:[values.zoneId], status:'draft', authorId:this.user.id, notes:values.notes, background:{ imageUrl:values.imageUrl, width:2000, height:1200 }, nodes:[], edges:[] });
        await saveVerifiedDiagram(diagram); modal.remove(); await this.load(); this.notify('Schéma créé en brouillon.'); await this.openEditor(diagram.id); await this.refresh();
      } catch (error) { this.notify(error.message, 'error'); }
    };
  }

  entityEntry(reference) {
    return this.entities.find(entry => referenceSignature(entry) === referenceSignature(reference));
  }

  /**
   * Nom affiché d'un nœud, résolu sur l'entité vivante plutôt que sur l'instantané pris
   * au moment du dessin. Un libellé réellement saisi par l'auteur reste prioritaire.
   */
  nodeLabel(node) {
    if (!node?.entityRef) return node?.label || node?.id || '';
    return diagramNodeDisplayLabel(node, this.entityEntry(node.entityRef)?.label);
  }

  async createRevision(id) {
    try {
      await this.load();
      const source = this.diagrams.find(item => String(item.id) === String(id));
      if (!source || !this.canReviseRecord(source)) throw new Error("Vous n'êtes pas autorisé à réviser ce schéma.");
      const revision = normalizeDiagram({
        ...clone(source), id:undefined, createdAt:undefined, updatedAt:undefined,
        status:'draft', validation:null, authorId:this.user.id,
        supersedesId:source.id, revision:nextRevision(source.revision)
      });
      await saveVerifiedDiagram(revision);
      this.notify(`Révision ${revision.revision} créée en brouillon; la version validée reste inchangée.`);
      await this.load(); await this.openEditor(revision.id); await this.refresh();
    } catch (error) { this.notify(error.message, 'error'); }
  }

  openNodeForm(diagram, onChange) {
    const modal = modalShell('diagram-node-modal', 'Ajouter une entité existante', `<form class="diagram-form"><label>Entité<select name="entityKey" required><option value="">Sélectionner…</option>${this.entities.map(entry => `<option value="${esc(entry.key)}">${esc(entry.label)}</option>`).join('')}</select></label><label>Libellé affiché<input name="label" placeholder="Laisser vide pour reprendre le nom officiel"></label><label>Rôle visuel<select name="pathRole">${Object.keys(PATH_ROLE_COLORS).map(role => `<option value="${role}">${role}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Ajouter</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    const select = modal.querySelector('[name="entityKey"]');
    // Indice, plus pré-remplissage. Recopier le nom officiel dans le champ contredisait sa
    // propre promesse — « laisser vide pour reprendre le nom officiel » — et, si l'auteur
    // changeait ensuite d'entité, le nom de la précédente restait en place et devenait un
    // libellé personnalisé par accident, figé sur une entité qui ne le portait pas.
    select.onchange = () => {
      const entry = this.entities.find(item => item.key === select.value);
      const input = modal.querySelector('[name="label"]');
      if (!entry || !input) return;
      input.placeholder = `Laisser vide → ${entry.label.replace(/^[^·]+·\s+/, '')}`;
    };
    modal.querySelector('form').onsubmit = event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const entry = this.entities.find(item => item.key === values.entityKey); if (!entry) return;
      // « Laisser vide pour reprendre le nom officiel » : un libellé égal au nom officiel
      // n'est pas un choix de l'auteur, c'est ce nom recopié. Le stocker gèlerait le nœud
      // sur le nom du jour du dessin. Seul un libellé réellement différent est conservé.
      const authoredLabel = String(values.label || '').trim();
      const officialName = entry.label.replace(/^[^·]+·\s+/, '');
      const label = authoredLabel && authoredLabel !== officialName && authoredLabel !== entry.label ? authoredLabel : '';
      diagram.nodes.push({ id:`node-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, type:'entity', layerId:'main', label, entityRef:{ type:entry.type, id:entry.id, parentEquipmentId:entry.parentEquipmentId || null, label:entry.label, verificationStatus:'documented' }, x:5 + (diagram.nodes.length * 13) % 72, y:8 + (diagram.nodes.length * 17) % 70, width:14, height:9, style:{ borderColor:PATH_ROLE_COLORS[values.pathRole] || PATH_ROLE_COLORS.OTHER, backgroundColor:'#ffffff', color:'#153047', icon:'' } });
      modal.remove(); onChange();
    };
  }

  openEdgeForm(diagram, onChange) {
    if (diagram.nodes.length < 2) return this.notify('Ajoutez au moins deux entités avant de créer une liaison.', 'warning');
    const nodeOptions = diagram.nodes.filter(node => node.type === 'entity').map(node => `<option value="${esc(node.id)}">${esc(this.nodeLabel(node) || node.id)}</option>`).join('');
    const relationDocuments = this.documents.filter(item => DIAGRAM_RELATION_KINDS.includes(item.kind));
    const modal = modalShell('diagram-edge-modal', 'Relier des entités documentées', `<form class="diagram-form"><label>Source<select name="sourceNodeId" required>${nodeOptions}</select></label><label>Port source<select name="sourcePortId"><option value="">Sans port</option></select></label><label>Destination<select name="destinationNodeId" required>${nodeOptions}</select></label><label>Port destination<select name="destinationPortId"><option value="">Sans port</option></select></label><label>Type de liaison<select name="type">${DIAGRAM_EDGE_TYPES.map(type => `<option value="${type}">${esc(type)}</option>`).join('')}</select></label><label>Rôle<select name="pathRole">${Object.keys(PATH_ROLE_COLORS).map(role => `<option value="${role}">${role}</option>`).join('')}</select></label><label class="span-2">Câble physique existant<select name="cableId"><option value="">Aucun</option>${this.cables.map(cable => `<option value="${esc(cable.id)}">${esc(cable.reference || cable.id)} · ${esc(cable.type || '')}</option>`).join('')}</select></label><label class="span-2">Relation métier existante<select name="relationId"><option value="">Aucune</option>${relationDocuments.map(item => `<option value="${esc(item.id)}">${esc(item.title || item.name || item.serviceName || item.kind)} · ${esc(item.kind)}</option>`).join('')}</select></label><label class="span-2">Libellé<input name="label" placeholder="Ex. Programme RF1 / Secours RF1"></label><div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Ajouter la liaison</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    const form = modal.querySelector('form');
    const fillPorts = (nodeSelectName, portSelectName) => {
      const node = diagram.nodes.find(item => String(item.id) === String(form.elements[nodeSelectName].value));
      const entry = this.entityEntry(node?.entityRef || {}); const ports = nodePorts(entry);
      form.elements[portSelectName].innerHTML = '<option value="">Sans port</option>' + ports.map(port => `<option value="${esc(port.id)}">${esc(port.number)} · ${esc(port.direction)} · ${esc(port.type)}</option>`).join('');
    };
    for (const [nodeName, portName] of [['sourceNodeId','sourcePortId'],['destinationNodeId','destinationPortId']]) {
      form.elements[nodeName].onchange = () => fillPorts(nodeName, portName); fillPorts(nodeName, portName);
    }
    form.elements.cableId.onchange = () => { if (form.elements.cableId.value) form.elements.type.value = 'physical-cable'; };
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      if (String(values.sourceNodeId) === String(values.destinationNodeId)) return this.notify('La source et la destination doivent être distinctes.', 'warning');
      if (values.type === 'physical-cable' && !values.cableId) return this.notify('Une liaison physique doit sélectionner un câble existant.', 'warning');
      if (values.type === 'physical-cable' && (!values.sourcePortId || !values.destinationPortId)) return this.notify('Une liaison physique doit sélectionner les deux ports réellement raccordés.', 'warning');
      if (values.type !== 'physical-cable' && values.type !== 'contains' && !values.relationId) return this.notify('Sélectionnez la relation métier qui justifie cette liaison.', 'warning');
      const sourceNode = diagram.nodes.find(item => String(item.id) === String(values.sourceNodeId));
      const destinationNode = diagram.nodes.find(item => String(item.id) === String(values.destinationNodeId));
      const cable = this.cables.find(item => String(item.id) === String(values.cableId));
      if (cable) {
        const sourceSignature = referenceSignature(sourceNode.entityRef); const destinationSignature = referenceSignature(destinationNode.entityRef);
        const actualSource = cableEndpointSignature(cable, 'source'); const actualDestination = cableEndpointSignature(cable, 'destination');
        const direct = sourceSignature === actualSource && destinationSignature === actualDestination
          && String(values.sourcePortId) === String(cable.sourcePortId) && String(values.destinationPortId) === String(cable.destinationPortId);
        const reverse = cableAllowsReverse(cable) && sourceSignature === actualDestination && destinationSignature === actualSource
          && String(values.sourcePortId) === String(cable.destinationPortId) && String(values.destinationPortId) === String(cable.sourcePortId);
        if (!direct && !reverse) return this.notify("Le câble sélectionné ne relie pas ces deux entités. Corrigez d'abord sa fiche canonique.", 'error');
      }
      diagram.edges.push({ id:`edge-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, type:values.type, layerId:'main', sourceNodeId:values.sourceNodeId, sourcePortId:values.sourcePortId || null, destinationNodeId:values.destinationNodeId, destinationPortId:values.destinationPortId || null, cableId:values.cableId || null, relationId:values.relationId || null, pathRole:values.pathRole, label:values.label, style:{ color:cable?.diagramColor || PATH_ROLE_COLORS[values.pathRole] || PATH_ROLE_COLORS.OTHER, width:3, dashed:values.pathRole === 'BACKUP' } });
      modal.remove(); onChange();
    };
  }

  openBackgroundForm(diagram, onChange) {
    const modal = modalShell('diagram-background-modal', 'Fond et dimensions', `<form class="diagram-form"><label class="span-2">URL de l'image<input name="imageUrl" value="${esc(diagram.background?.imageUrl || '')}"></label><label>Largeur source<input name="width" type="number" min="1" max="50000" value="${esc(diagram.background?.width || 2000)}"></label><label>Hauteur source<input name="height" type="number" min="1" max="50000" value="${esc(diagram.background?.height || 1200)}"></label><div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Appliquer</button></div></form>`);
    modal.querySelector('.cancel').onclick = () => modal.remove();
    modal.querySelector('form').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); diagram.background = { ...diagram.background, imageUrl:values.imageUrl, width:Number(values.width), height:Number(values.height) }; modal.remove(); onChange(); };
  }

  async openEditor(id) {
    await this.load();
    const source = this.diagrams.find(item => String(item.id) === String(id));
    if (!source) return this.notify('Schéma introuvable.', 'error');
    const editable = this.canEditRecord(source);
    const validatable = this.canValidateRecord(source);
    const diagram = clone(source); let selectedNodeId = null; let dirty = false;
    const modal = modalShell('diagram-editor-modal', source.title, `<div class="diagram-editor"><div class="diagram-toolbar"><span class="diagram-editor-state">${esc(statusLabel(source.status))} · Rév. ${esc(source.revision)}</span><div>${editable ? '<button class="btn gray add-node"><i class="fas fa-plus-square"></i> Entité</button><button class="btn gray add-edge"><i class="fas fa-link"></i> Liaison</button><button class="btn gray background"><i class="fas fa-image"></i> Fond</button><button class="btn danger delete-selected" disabled><i class="fas fa-trash"></i></button><button class="btn save-diagram"><i class="fas fa-save"></i> Enregistrer</button>' : ''}${validatable ? '<button class="btn approve-diagram"><i class="fas fa-user-check"></i> Valider</button>' : ''}</div></div><div class="diagram-editor-body"><div class="diagram-canvas-wrap"><div class="diagram-canvas"></div></div><aside class="diagram-inspector"><h4>Sélection</h4><div class="selection-details">Cliquez sur une entité.</div><h4>Règles</h4><ul><li>Les équipements restent liés à leur fiche unique.</li><li>Une liaison physique référence un câble enregistré.</li><li>Une relation logique référence une donnée de topologie/continuité.</li><li>Un schéma validé est immuable; une nouvelle révision doit être créée.</li></ul></aside></div></div>`, true);
    const canvas = modal.querySelector('.diagram-canvas'); const details = modal.querySelector('.selection-details');

    const renderEdges = () => {
      const svg = canvas.querySelector('svg'); if (!svg) return;
      svg.innerHTML = `<defs><marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path></marker></defs>` + diagram.edges.map(edge => {
        const sourceNode = diagram.nodes.find(node => String(node.id) === String(edge.sourceNodeId)); const destinationNode = diagram.nodes.find(node => String(node.id) === String(edge.destinationNodeId));
        if (!sourceNode || !destinationNode) return '';
        const x1 = sourceNode.x + sourceNode.width / 2; const y1 = sourceNode.y + sourceNode.height / 2; const x2 = destinationNode.x + destinationNode.width / 2; const y2 = destinationNode.y + destinationNode.height / 2;
        return `<line data-edge-id="${esc(edge.id)}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%" stroke="${esc(edge.style?.color || PATH_ROLE_COLORS[edge.pathRole] || '#64748b')}" stroke-width="${clamp(edge.style?.width || 2,1,10)}" ${edge.style?.dashed ? 'stroke-dasharray="8 5"' : ''} marker-end="url(#diagram-arrow)"><title>${esc(edge.label || edge.type)}</title></line>`;
      }).join('');
    };
    const selectNode = node => {
      selectedNodeId = node?.id || null;
      canvas.querySelectorAll('.diagram-node').forEach(element => element.classList.toggle('selected', String(element.dataset.nodeId) === String(selectedNodeId)));
      modal.querySelector('.delete-selected') && (modal.querySelector('.delete-selected').disabled = !selectedNodeId);
      const entry = node ? this.entityEntry(node.entityRef) : null;
      details.innerHTML = node ? `<strong>${esc(this.nodeLabel(node))}</strong><small>${esc(entry?.label || node.entityRef?.type || '')}</small><span>${nodePorts(entry).length} port(s) documenté(s)</span>` : 'Cliquez sur une entité.';
    };
    const renderCanvas = () => {
      canvas.style.aspectRatio = `${diagram.background?.width || 2000}/${diagram.background?.height || 1200}`;
      canvas.style.backgroundImage = diagram.background?.imageUrl ? `url("${String(diagram.background.imageUrl).replace(/["\\]/g, '')}")` : 'none';
      canvas.innerHTML = '<svg class="diagram-edges" aria-hidden="true"></svg>' + diagram.nodes.map(node => `<button type="button" class="diagram-node ${String(node.id)===String(selectedNodeId)?'selected':''}" data-node-id="${esc(node.id)}" style="left:${node.x}%;top:${node.y}%;width:${node.width}%;height:${node.height}%;border-color:${esc(node.style?.borderColor || '#0b6b96')};background:${esc(node.style?.backgroundColor || '#fff')};color:${esc(node.style?.color || '#153047')}" title="${esc(this.nodeLabel(node))}"><span>${esc(this.nodeLabel(node) || node.id)}</span></button>`).join('');
      renderEdges();
      canvas.querySelectorAll('.diagram-node').forEach(element => {
        const node = diagram.nodes.find(item => String(item.id) === String(element.dataset.nodeId));
        element.onclick = () => selectNode(node);
        if (!editable || node.locked) return;
        element.onpointerdown = event => {
          event.preventDefault(); selectNode(node); element.setPointerCapture(event.pointerId);
          const bounds = canvas.getBoundingClientRect(); const offsetX = event.clientX - element.getBoundingClientRect().left; const offsetY = event.clientY - element.getBoundingClientRect().top;
          element.onpointermove = move => {
            if (!element.hasPointerCapture(move.pointerId)) return;
            node.x = clamp(((move.clientX - bounds.left - offsetX) / bounds.width) * 100, 0, 100 - node.width);
            node.y = clamp(((move.clientY - bounds.top - offsetY) / bounds.height) * 100, 0, 100 - node.height);
            element.style.left = `${node.x}%`; element.style.top = `${node.y}%`; dirty = true; renderEdges();
          };
          element.onpointerup = up => { if (element.hasPointerCapture(up.pointerId)) element.releasePointerCapture(up.pointerId); element.onpointermove = null; };
        };
      });
    };
    const changed = () => { dirty = true; renderCanvas(); };
    modal.querySelector('.add-node')?.addEventListener('click', () => this.openNodeForm(diagram, changed));
    modal.querySelector('.add-edge')?.addEventListener('click', () => this.openEdgeForm(diagram, changed));
    modal.querySelector('.background')?.addEventListener('click', () => this.openBackgroundForm(diagram, changed));
    modal.querySelector('.delete-selected')?.addEventListener('click', () => {
      if (!selectedNodeId) return; diagram.nodes = diagram.nodes.filter(node => String(node.id) !== String(selectedNodeId)); diagram.edges = diagram.edges.filter(edge => ![edge.sourceNodeId, edge.destinationNodeId].map(String).includes(String(selectedNodeId))); selectedNodeId = null; changed();
    });
    modal.querySelector('.save-diagram')?.addEventListener('click', async () => {
      try {
        const candidate = normalizeDiagram({ ...diagram, status:source.status === 'validated' ? 'draft' : diagram.status, validation:source.status === 'validated' ? null : diagram.validation, revision:source.status === 'validated' ? String(Number(source.revision || 0) + 1) : diagram.revision }, source);
        const checked = validateDiagram(candidate); if (checked.errors.length) throw new Error(checked.errors.join(' '));
        await saveVerifiedDiagram(checked.value); Object.assign(diagram, checked.value); dirty = false; this.notify(source.status === 'validated' ? 'Modification enregistrée comme nouvelle révision brouillon.' : 'Schéma enregistré et vérifié par le serveur.'); modal.remove(); await this.refresh();
      } catch (error) { this.notify(error.message, 'error'); }
    });
    modal.querySelector('.approve-diagram')?.addEventListener('click', async () => { if (dirty) return this.notify("Enregistrez d'abord les modifications.", 'warning'); modal.remove(); await this.approve(source.id); });
    renderCanvas();
  }

  async approve(id) {
    try {
      const payload = await api(`/api/diagrams/${encodeURIComponent(id)}/validate`, { method:'POST', body:'{}' });
      await (db.saveLocalOnly ? db.saveLocalOnly('docs', payload.record) : db.save('docs', payload.record)); this.notify('Schéma validé avec contrôle des références et audit.'); await this.refresh();
    } catch (error) { this.notify(error.message, 'error'); }
  }

  async retire(id) {
    const reason = window.prompt('Motif du retrait de ce schéma validé :', 'Remplacé ou retiré du service');
    if (reason == null) return;
    try {
      const payload = await api(`/api/data/docs/${encodeURIComponent(id)}/retire`, { method:'POST', body:JSON.stringify({ reason }) });
      await (db.saveLocalOnly ? db.saveLocalOnly('docs', payload.record) : db.save('docs', payload.record));
      this.notify('Schéma retiré et conservé dans l’historique.'); await this.refresh();
    } catch (error) { this.notify(error.message, 'error'); }
  }
}

export async function openDiagramLibrary(user = getCurrentUser(), notifications = null) {
  const modal = modalShell('diagram-library-modal', 'Schémas techniques validés', '<div class="diagram-library-host"><div class="loading-spinner"><p>Chargement…</p></div></div>', true);
  const host = modal.querySelector('.diagram-library-host'); const studio = new DiagramStudio(user, notifications, { readOnly:true });
  host.innerHTML = await studio.render(); await studio.afterRender(host); return studio;
}

const PATCH_FLAG = Symbol.for('2m-tech.diagram-studio.patched');
if (!AdminUI.prototype[PATCH_FLAG]) {
  const previous = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithDiagrams() {
    const sections = previous.call(this); const ordered = {};
    for (const [key, value] of Object.entries(sections)) { ordered[key] = value; if (key === 'continuity' || key === 'signalFlow') ordered.diagrams = ordered.diagrams || { title:'Schémas techniques', icon:'fas fa-project-diagram', component:new DiagramStudio(this.user, this.notifications) }; }
    if (!ordered.diagrams) ordered.diagrams = { title:'Schémas techniques', icon:'fas fa-project-diagram', component:new DiagramStudio(this.user, this.notifications) };
    return ordered;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

if (!ResponsibleUI.prototype[PATCH_FLAG]) {
  const previous = ResponsibleUI.prototype.renderBaseLayout;
  ResponsibleUI.prototype.renderBaseLayout = function renderResponsibleWithDiagrams() {
    if (!this.sections.diagrams) this.sections = { diagrams:{ title:'Schémas techniques', icon:'fas fa-project-diagram', component:new DiagramStudio(this.user, this.notifications) }, ...this.sections };
    return previous.call(this);
  };
  Object.defineProperty(ResponsibleUI.prototype, PATCH_FLAG, { value:true });
}

if (!TechUISmart.prototype[PATCH_FLAG]) {
  const previous = TechUISmart.prototype.bindGlobalActions;
  TechUISmart.prototype.bindGlobalActions = function bindTechnicalDiagrams(...args) {
    const result = previous ? previous.apply(this, args) : undefined; const host = document.querySelector('.smart-tech-header .header-actions');
    if (host && !host.querySelector('#tech-diagrams-btn')) { const button = document.createElement('button'); button.id = 'tech-diagrams-btn'; button.className = 'btn gray'; button.innerHTML = '<i class="fas fa-project-diagram"></i> Schémas'; button.onclick = () => openDiagramLibrary(this.user, this.notifications); host.prepend(button); }
    return result;
  };
  Object.defineProperty(TechUISmart.prototype, PATCH_FLAG, { value:true });
}

export default DiagramStudio;
