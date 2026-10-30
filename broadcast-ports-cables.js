import { db } from './db.js';
import Equipements from './equipements.js';
import AdminUI from './admin-ui.js';
import { generateQR } from './qr.js';
import { PORT_TYPES, CABLE_TYPES, normalizePorts } from './connectivity-contract.js';
import { normalizeRelationId } from './equipment-write-contract.js';

export { PORT_TYPES, CABLE_TYPES } from './connectivity-contract.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

export const EQUIPMENT_CATEGORIES = [
  'Vidéo / Broadcast','Audio','Diffusion / Playout','Réseau / IT',
  'Transmission / RF / Satellite','Infrastructure / Énergie',
  'Contrôle / Mesure / Monitoring','Téléphonie / Communication'
];

const categoryAlias = value => ({'Réseau':'Réseau / IT','Informatique':'Réseau / IT','Énergie':'Infrastructure / Énergie'}[value] || value || '');
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

const originalDeleteEquipmentSafely = db.deleteEquipmentSafely.bind(db);
db.deleteEquipmentSafely = async function deleteEquipmentWithCableGuard(equipmentId) {
  const linked = (await this.getAll('cables')).filter(c => String(c.sourceEquipmentId) === String(equipmentId) || String(c.destinationEquipmentId) === String(equipmentId));
  if (linked.length) {
    const error = new Error(`${linked.length} câble(s) sont encore reliés à cet équipement. Supprimez ou réaffectez les câbles avant la suppression.`);
    error.code = 'EQUIPMENT_HAS_CABLES';
    throw error;
  }
  return originalDeleteEquipmentSafely(equipmentId);
};

const originalAfterRender = Equipements.prototype.afterRender;
Equipements.prototype.afterRender = async function afterRenderBroadcast() {
  await originalAfterRender.call(this);
  const table = document.querySelector('#admin-content table.tableau');
  if (table) {
    const header = table.querySelector('tr');
    const qrHeader = [...header.children].find(th => th.textContent.trim() === 'QR');
    if (qrHeader && ![...header.children].some(th => th.textContent.trim() === 'Ports')) {
      const th = document.createElement('th'); th.textContent = 'Ports'; header.insertBefore(th, qrHeader);
      const eqs = await db.getAll('equipments');
      table.querySelectorAll('tr').forEach((row, idx) => {
        if (!idx) return;
        const link = row.querySelector('.eq-quickview');
        if (!link) return;
        const eq = eqs.find(x => String(x.id) === String(link.dataset.id));
        const qrCell = row.children[[...header.children].findIndex(x => x.textContent.trim() === 'QR')];
        const td = document.createElement('td');
        td.innerHTML = `<span class="port-count-badge"><i class="fas fa-plug"></i> ${(eq?.ports || []).length}</span>`;
        row.insertBefore(td, qrCell || null);
      });
    }
  }
};

Equipements.prototype.openAddForm = function openAddForm() { return this.showEquipementModal(); };

const originalShowEquipementModal = Equipements.prototype.showEquipementModal;
Equipements.prototype.showEquipementModal = async function showEquipementModalBroadcast(equipement = null) {
  document.querySelectorAll('#eq-modal').forEach(node => node.remove());
  await originalShowEquipementModal.call(this, equipement);
  const modal = document.getElementById('eq-modal');
  const form = document.getElementById('eq-form');
  if (!modal || !form) return;

  const category = form.elements.categorie;
  if (category) {
    const selected = categoryAlias(equipement?.categorie);
    category.innerHTML = `<option value="">Catégorie métier TV</option>${EQUIPMENT_CATEGORIES.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
    category.value = selected;
  }

  let ports = normalizePorts(equipement?.ports);
  const panel = document.createElement('section');
  panel.className = 'equipment-ports-editor';
  panel.innerHTML = `
    <div class="ports-editor-head"><div><h4><i class="fas fa-plug"></i> Ports de l'équipement</h4><p>Définissez le numéro, le type et le sens de chaque port.</p></div><button type="button" class="btn" id="add-equipment-port"><i class="fas fa-plus"></i> Ajouter un port</button></div>
    <div id="equipment-ports-list"></div>`;
  const anchor = form.elements.ipAddress || form.elements.grilleINOUT || form.elements.notes;
  form.insertBefore(panel, anchor || null);

  const renderPorts = () => {
    const list = panel.querySelector('#equipment-ports-list');
    list.innerHTML = ports.length ? ports.map((p, i) => `
      <div class="equipment-port-row" data-index="${i}">
        <input class="port-number" value="${esc(p.number)}" placeholder="N° port (ex: IN 1, OUT 12)" aria-label="Numéro du port">
        <select class="port-type" aria-label="Type du port">${PORT_TYPES.map(t => `<option value="${esc(t)}" ${t===p.type?'selected':''}>${esc(t)}</option>`).join('')}</select>
        <select class="port-direction" aria-label="Sens du port"><option ${p.direction==='IN'?'selected':''}>IN</option><option ${p.direction==='OUT'?'selected':''}>OUT</option><option ${p.direction==='IN/OUT'?'selected':''}>IN/OUT</option></select>
        <input class="port-label" value="${esc(p.label)}" placeholder="Libellé / signal">
        <button type="button" class="btn danger remove-port" title="Supprimer le port"><i class="fas fa-trash"></i></button>
      </div>`).join('') : '<div class="ports-empty">Aucun port configuré. Ajoutez les entrées/sorties physiques de cet équipement.</div>';

    list.querySelectorAll('.equipment-port-row').forEach(row => {
      const i = Number(row.dataset.index);
      row.querySelector('.port-number').oninput = e => ports[i].number = e.target.value;
      row.querySelector('.port-type').onchange = e => ports[i].type = e.target.value;
      row.querySelector('.port-direction').onchange = e => ports[i].direction = e.target.value;
      row.querySelector('.port-label').oninput = e => ports[i].label = e.target.value;
      row.querySelector('.remove-port').onclick = async () => {
        const linked = (await db.getAll('cables')).some(c => c.sourcePortId === ports[i].id || c.destinationPortId === ports[i].id);
        if (linked) return this.notifications.showNotification('Ce port est utilisé par un câble. Supprimez ou réaffectez le câble avant de retirer le port.', 'warning');
        ports.splice(i,1); renderPorts();
      };
    });
  };
  panel.querySelector('#add-equipment-port').onclick = () => { ports.push({id:makeId('PORT'),number:String(ports.length+1),type:'BNC / SDI',direction:'IN/OUT',label:''}); renderPorts(); };
  // Point d'entrée unique pour ajouter des ports depuis une autre source (gabarit
  // du catalogue). Aucune liste parallèle : on écrit dans les ports du formulaire.
  panel.appendPorts = added => {
    const list = Array.isArray(added) ? added : [];
    if (!list.length) return 0;
    ports.push(...list);
    renderPorts();
    return list.length;
  };
  panel.currentPorts = () => ports;

  // Identifiants des ports déjà enregistrés à l'ouverture : ils distinguent une ligne
  // neuve abandonnée (à écarter sans bruit) d'un port existant dont on a vidé le numéro
  // (à ne jamais supprimer en silence).
  const initialPortIds = new Set(normalizePorts(equipement?.ports).map(port => String(port.id)));

  /**
   * Seule voie autorisée pour obtenir les ports à enregistrer.
   *
   * Le filtre `p.number.trim()` appliqué au moment de la soumission supprimait tout port
   * dont le numéro était vide — sans le contrôle de câble que le bouton Supprimer applique
   * pourtant. Vider un numéro pour le retaper effaçait donc le port, et les câbles qui s'y
   * raccordaient pointaient dans le vide sans que rien ne le signale.
   */
  panel.resolvePortsForSave = async () => {
    const normalized = normalizePorts(ports);
    const errors = [];
    const kept = [];
    const dropped = [];

    for (const port of normalized) {
      const hasNumber = String(port.number ?? '').trim().length > 0;
      const isExisting = initialPortIds.has(String(port.id));
      if (hasNumber) { kept.push(port); continue; }
      // Ligne ajoutée puis laissée vide : l'écarter est le comportement attendu.
      if (!isExisting) continue;
      errors.push(`Le port « ${port.label || port.id} » n'a plus de numéro. Renseignez-le, ou supprimez le port avec le bouton dédié.`);
      dropped.push(port);
    }

    // Un port retiré de la liste alors qu'un câble s'y raccorde ne peut pas disparaître.
    const keptIds = new Set(kept.map(port => String(port.id)));
    const removedExisting = [...initialPortIds].filter(id => !keptIds.has(id));
    if (removedExisting.length) {
      const cables = await db.getAll('cables');
      for (const id of removedExisting) {
        const linked = cables.filter(cable => String(cable.sourcePortId) === id || String(cable.destinationPortId) === id);
        if (linked.length && !dropped.some(port => String(port.id) === id)) {
          errors.push(`Le port ${id} est utilisé par ${linked.length} câble(s). Réaffectez-les avant de le retirer.`);
        } else if (linked.length) {
          errors.push(`Le port ${id} est utilisé par ${linked.length} câble(s) et ne peut pas être supprimé en vidant son numéro.`);
        }
      }
    }
    return { ports: kept, errors: [...new Set(errors)] };
  };

  renderPorts();

  form.onsubmit = async event => {
    event.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.categorie = categoryAlias(data.categorie);
    // Les identifiants de salle et de baie sont textuels en production
    // (« room-regie-car », « regie-car-baie-1 ») : Number() les transformait en NaN,
    // et l'équipement disparaissait de sa salle sans aucun message.
    data.roomId = normalizeRelationId(data.roomId);
    data.baieId = normalizeRelationId(data.baieId);
    const resolved = await panel.resolvePortsForSave();
    if (resolved.errors.length) {
      this.notifications.showNotification(resolved.errors[0], 'warning');
      return;
    }
    data.ports = resolved.ports;
    data.images = Array.isArray(equipement?.images) ? [...equipement.images] : [];
    if (form.images?.files?.length) for (const file of form.images.files) data.images.push(await this.readFile(file));
    data.installDate = form.installDate?.value || '';
    data.garantieDate = form.garantieDate?.value || '';
    data.notes = form.notes?.value || '';
    data.qr = await generateQR(data.numSerie || data.name);
    data.createdAt = equipement?.createdAt || new Date().toISOString();
    data.updatedAt = new Date().toISOString();
    if (equipement?.id) data.id = equipement.id;
    await db.save('equipments', data);
    this.notifications.showNotification('Équipement et ports enregistrés avec succès.', 'success');
    modal.remove();
    await this.refreshList();
  };
};

const originalShowQuickView = Equipements.prototype.showQuickView;
Equipements.prototype.showQuickView = async function showQuickViewBroadcast(eq) {
  await originalShowQuickView.call(this, eq);
  const modal = document.getElementById('equip-quickview-modal');
  const content = modal?.querySelector('.modal-content');
  if (!content) return;
  const cables = (await db.getAll('cables')).filter(c => String(c.sourceEquipmentId) === String(eq.id) || String(c.destinationEquipmentId) === String(eq.id));
  const block = document.createElement('section');
  block.className = 'quickview-connectivity';
  block.innerHTML = `<h4><i class="fas fa-project-diagram"></i> Ports & câbles</h4>
    <div class="quickview-port-grid">${normalizePorts(eq.ports).length ? normalizePorts(eq.ports).map(p => `<span><b>${esc(p.number)}</b><small>${esc(p.type)} · ${esc(p.direction)}</small></span>`).join('') : '<em>Aucun port configuré</em>'}</div>
    <p><strong>${cables.length}</strong> câble(s) relié(s) à cet équipement.</p>`;
  content.appendChild(block);
};

class CableInventory {
  constructor(notifications) { this.notifications = notifications; this.filters = {search:'',category:'',status:''}; }
  async render() {
    const [cables,equipments] = await Promise.all([db.getAll('cables'),db.getAll('equipments')]);
    const portBy = (eqId,portId) => normalizePorts(equipments.find(e=>String(e.id)===String(eqId))?.ports).find(p=>p.id===portId);
    const eqName = id => equipments.find(e=>String(e.id)===String(id))?.name || '—';
    const filtered = cables.filter(c => (!this.filters.search || [c.reference,c.type,eqName(c.sourceEquipmentId),eqName(c.destinationEquipmentId)].join(' ').toLowerCase().includes(this.filters.search.toLowerCase())) && (!this.filters.category || c.category===this.filters.category) && (!this.filters.status || c.status===this.filters.status));
    return `<div class="card cable-inventory-card"><div class="card-header"><div><h2>Gestion des câbles</h2><p class="section-subtitle">Reliez précisément les ports des équipements de la chaîne TV.</p></div><button class="btn" id="add-cable"><i class="fas fa-plus"></i> Ajouter un câble</button></div>
      <div class="filters-container cable-filters"><input id="cable-search" class="form-control" placeholder="Recherche câble, équipement…" value="${esc(this.filters.search)}"><select id="cable-category" class="form-control"><option value="">Catégorie: Toutes</option>${Object.keys(CABLE_TYPES).map(v=>`<option ${this.filters.category===v?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="cable-status" class="form-control"><option value="">Statut: Tous</option>${['Connecté','Réserve','Déconnecté','À vérifier'].map(v=>`<option ${this.filters.status===v?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="cable-table-wrap"><table class="tableau cable-table"><thead><tr><th>Référence</th><th>Catégorie</th><th>Type</th><th>Source</th><th>Port source</th><th>Destination</th><th>Port destination</th><th>Longueur</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${filtered.length ? filtered.map(c=>`<tr><td><strong>${esc(c.reference)}</strong></td><td>${esc(c.category)}</td><td>${esc(c.type)}</td><td>${esc(eqName(c.sourceEquipmentId))}</td><td><span class="cable-port-pill">${esc(portBy(c.sourceEquipmentId,c.sourcePortId)?.number || '—')}</span></td><td>${esc(eqName(c.destinationEquipmentId))}</td><td><span class="cable-port-pill">${esc(portBy(c.destinationEquipmentId,c.destinationPortId)?.number || '—')}</span></td><td>${esc(c.length || '—')}</td><td><span class="cable-status">${esc(c.status || 'Connecté')}</span></td><td><button class="btn-icon edit-cable" data-id="${esc(c.id)}"><i class="fas fa-edit"></i></button><button class="btn-icon delete-cable" data-id="${esc(c.id)}"><i class="fas fa-trash"></i></button></td></tr>`).join('') : '<tr><td colspan="10"><div class="cable-empty"><i class="fas fa-plug"></i><strong>Aucun câble enregistré</strong><span>Ajoutez un câble puis choisissez précisément le port source et le port destination.</span></div></td></tr>'}</tbody></table></div></div>`;
  }
  async afterRender() {
    document.getElementById('add-cable')?.addEventListener('click',()=>this.openAddForm());
    document.getElementById('cable-search')?.addEventListener('input',e=>{this.filters.search=e.target.value;this.refresh();});
    document.getElementById('cable-category')?.addEventListener('change',e=>{this.filters.category=e.target.value;this.refresh();});
    document.getElementById('cable-status')?.addEventListener('change',e=>{this.filters.status=e.target.value;this.refresh();});
    document.querySelectorAll('.edit-cable').forEach(b=>b.onclick=async()=>this.openAddForm(await db.get('cables',b.dataset.id)));
    document.querySelectorAll('.delete-cable').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer ce câble ?')){await db.delete('cables',b.dataset.id);this.notifications.showNotification('Câble supprimé.','success');this.refresh();}});
  }
  async refresh(){ const container=document.getElementById('admin-content'); if(container){container.innerHTML=await this.render();await this.afterRender();} }
  async openAddForm(cable=null) {
    document.getElementById('cable-modal')?.remove();
    const equipments = await db.getAll('equipments');
    const categories = Object.keys(CABLE_TYPES);
    const modal=document.createElement('div'); modal.className='modal'; modal.id='cable-modal';
    modal.innerHTML=`<div class="modal-content cable-modal-content"><button type="button" class="modal-x" aria-label="Fermer">×</button><h3>${cable?'Modifier':'Ajouter'} un câble</h3><form id="cable-form" class="cable-form">
      <div class="form-grid"><label>Référence câble<input name="reference" required value="${esc(cable?.reference || `CAB-${new Date().getFullYear()}-`)}"></label><label>Catégorie<select name="category" required>${categories.map(v=>`<option ${cable?.category===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Type de câble<select name="type" required></select></label><label>Statut<select name="status">${['Connecté','Réserve','Déconnecté','À vérifier'].map(v=>`<option ${cable?.status===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Équipement source<select name="sourceEquipmentId" required><option value="">Sélectionner</option>${equipments.map(e=>`<option value="${e.id}" ${String(cable?.sourceEquipmentId)===String(e.id)?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><label>Port source<select name="sourcePortId" required></select></label><label>Équipement destination<select name="destinationEquipmentId" required><option value="">Sélectionner</option>${equipments.map(e=>`<option value="${e.id}" ${String(cable?.destinationEquipmentId)===String(e.id)?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><label>Port destination<select name="destinationPortId" required></select></label><label>Longueur<input name="length" placeholder="ex: 15 m" value="${esc(cable?.length)}"></label><label class="span-2">Notes<textarea name="notes" placeholder="Signal, cheminement, patch…">${esc(cable?.notes)}</textarea></label></div>
      <div class="modal-actions"><button type="button" class="btn gray cancel-cable">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div></form></div>`;
    document.body.appendChild(modal);
    const form=modal.querySelector('#cable-form');
    const updateTypes=()=>{const list=CABLE_TYPES[form.category.value]||[];form.type.innerHTML=list.map(t=>`<option ${cable?.type===t?'selected':''}>${esc(t)}</option>`).join('');};
    const updatePorts=(equipmentField,portField,selected)=>{const eq=equipments.find(e=>String(e.id)===String(form[equipmentField].value));const ports=normalizePorts(eq?.ports);form[portField].innerHTML=`<option value="">Sélectionner un port</option>${ports.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>${esc(p.number)} — ${esc(p.type)} (${esc(p.direction)})</option>`).join('')}`;};
    updateTypes(); updatePorts('sourceEquipmentId','sourcePortId',cable?.sourcePortId); updatePorts('destinationEquipmentId','destinationPortId',cable?.destinationPortId);
    form.category.onchange=updateTypes;
    form.sourceEquipmentId.onchange=()=>updatePorts('sourceEquipmentId','sourcePortId');
    form.destinationEquipmentId.onchange=()=>updatePorts('destinationEquipmentId','destinationPortId');
    modal.querySelector('.modal-x').onclick=modal.querySelector('.cancel-cable').onclick=()=>modal.remove();
    form.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form).entries());if(d.sourceEquipmentId===d.destinationEquipmentId&&d.sourcePortId===d.destinationPortId)return this.notifications.showNotification('La source et la destination ne peuvent pas être le même port.','warning');const src=equipments.find(x=>String(x.id)===String(d.sourceEquipmentId));const data={...cable,...d,id:cable?.id||makeId('CAB'),sourceEquipmentId:Number(d.sourceEquipmentId),destinationEquipmentId:Number(d.destinationEquipmentId),roomId:src?.roomId??null,createdAt:cable?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};await db.save('cables',data);this.notifications.showNotification('Câble enregistré avec ses ports source/destination.','success');modal.remove();await this.refresh();};
    modal.style.display='block';
  }
}

const originalInitSections = AdminUI.prototype.initSections;
AdminUI.prototype.initSections = function initSectionsWithCables() {
  const sections = originalInitSections.call(this);
  const ordered = {};
  for (const [key,value] of Object.entries(sections)) {
    ordered[key]=value;
    if (key==='devices') ordered.cables={title:'Câbles',icon:'fas fa-project-diagram',component:new CableInventory(this.notifications)};
  }
  return ordered;
};
