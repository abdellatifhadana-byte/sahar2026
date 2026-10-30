import { db } from './db.js';
import Equipements from './equipements.js';
import { isModuleCard, isModularChassis, validateModuleHierarchy, slotKey } from './module-hierarchy-contract.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeId = value => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
};
const same = (a,b) => String(a ?? '') === String(b ?? '');

export async function assignModuleToChassis(cardId, hostId, { slot = '', verificationStatus = 'to-confirm' } = {}) {
  await db.open();
  const [card,host,equipments] = await Promise.all([
    db.get('equipments',normalizeId(cardId)),
    db.get('equipments',normalizeId(hostId)),
    db.getAll('equipments')
  ]);
  if (!card || !isModuleCard(card)) throw Object.assign(new Error('La carte/module est introuvable ou son type est invalide.'), { code:'INVALID_MODULE_CARD' });
  if (!host || !isModularChassis(host)) throw Object.assign(new Error('Le châssis hôte est introuvable ou invalide.'), { code:'INVALID_MODULE_HOST' });
  if (same(card.id,host.id)) throw Object.assign(new Error('Une carte ne peut pas être son propre hôte.'), { code:'SELF_HOST' });

  const normalizedSlot = text(slot,80);
  const candidate = {
    ...card,
    entityKind:'module-card', hostEquipmentId:host.id, slot:normalizedSlot,
    roomId:host.roomId ?? null, baieId:host.baieId ?? null,
    assignmentStatus:normalizedSlot ? 'assigned' : 'assigned-host-slot-to-confirm',
    hostVerificationStatus:verificationStatus,
    updatedAt:new Date().toISOString()
  };
  const hierarchyErrors = validateModuleHierarchy(equipments.map(record => same(record.id,card.id) ? candidate : record));
  const cardError = hierarchyErrors.find(error => same(error.cardId,card.id));
  if (cardError) throw Object.assign(new Error(cardError.message), { code:cardError.code });
  await db.save('equipments',candidate);
  return candidate;
}

export async function unassignModuleFromChassis(cardId) {
  const card = await db.get('equipments',normalizeId(cardId));
  if (!card || !isModuleCard(card)) throw Object.assign(new Error('Carte/module introuvable.'), { code:'INVALID_MODULE_CARD' });
  const updated = {
    ...card, hostEquipmentId:null, slot:'', assignmentStatus:'unassigned-to-chassis',
    hostVerificationStatus:'to-confirm', updatedAt:new Date().toISOString()
  };
  await db.save('equipments',updated);
  return updated;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char] || char));
}

function patchEquipmentModuleEditor() {
  if (Equipements.prototype.__moduleAssignmentPatched) return;
  Equipements.prototype.__moduleAssignmentPatched = true;
  const previousShow = Equipements.prototype.showEquipementModal;
  Equipements.prototype.showEquipementModal = async function showEquipmentWithModuleHost(equipment = null) {
    await previousShow.call(this,equipment);
    if (!isModuleCard(equipment || {})) return;
    const form = document.getElementById('eq-form');
    if (!form || form.dataset.moduleHostReady === '1') return;
    form.dataset.moduleHostReady = '1';
    const equipments = await db.getAll('equipments');
    const chassis = equipments.filter(record => isModularChassis(record) && !same(record.id,equipment.id));
    const section = document.createElement('section');
    section.className = 'eq-module-host-section';
    section.innerHTML = `<div style="margin:12px 0;padding:12px;border:1px solid var(--border-color,#dbe3ea);border-radius:10px">
      <strong><i class="fas fa-layer-group"></i> Implantation modulaire</strong>
      <small style="display:block;margin:4px 0 8px">Une carte garde une seule identité. Le châssis et le slot sont une relation, pas une copie dans « composants internes ».</small>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
        <label>Châssis hôte<select name="hostEquipmentId" id="eq-host-equipment"><option value="">Non affecté / à relever</option>${chassis.map(host => `<option value="${esc(host.id)}" ${same(host.id,equipment.hostEquipmentId)?'selected':''}>${esc(host.name || host.nom || host.modele || host.id)}</option>`).join('')}</select></label>
        <label>Slot<input name="moduleSlot" id="eq-module-slot" value="${esc(equipment.slot || '')}" placeholder="ex. Slot 05"></label>
      </div>
    </div>`;
    const anchor = form.querySelector('.eq-internals') || form.elements.notes;
    if (anchor?.parentNode === form) form.insertBefore(section,anchor); else form.appendChild(section);

    const hostSelect = section.querySelector('#eq-host-equipment');
    hostSelect.onchange = () => {
      const host = chassis.find(record => same(record.id,hostSelect.value));
      if (!host) return;
      if (form.elements.roomId) form.elements.roomId.value = host.roomId ?? '';
      if (form.elements.baieId) form.elements.baieId.value = host.baieId ?? '';
    };

    const previousSubmit = form.onsubmit;
    form.onsubmit = async event => {
      const selectedHostId = normalizeId(hostSelect.value);
      const selectedSlot = text(section.querySelector('#eq-module-slot').value,80);
      if (selectedHostId != null) {
        const host = chassis.find(record => same(record.id,selectedHostId));
        if (!host) {
          event.preventDefault();
          return this.notifications?.showNotification('Châssis hôte introuvable.', 'error');
        }
        const candidate = {
          ...equipment, hostEquipmentId:selectedHostId, slot:selectedSlot,
          roomId:host.roomId ?? null, baieId:host.baieId ?? null,
          assignmentStatus:selectedSlot ? 'assigned' : 'assigned-host-slot-to-confirm'
        };
        const hierarchyError = validateModuleHierarchy(equipments.map(record => same(record.id,equipment.id) ? candidate : record))
          .find(error => same(error.cardId,equipment.id));
        if (hierarchyError) {
          event.preventDefault();
          return this.notifications?.showNotification(hierarchyError.message, 'error');
        }
      }

      const originalSave = db.save;
      let intercepted = false;
      db.save = async function saveWithModuleRelation(store,record) {
        if (store === 'equipments' && !intercepted) {
          intercepted = true;
          const host = selectedHostId == null ? null : chassis.find(item => same(item.id,selectedHostId));
          record.entityKind = 'module-card';
          record.hostEquipmentId = host?.id ?? null;
          record.slot = selectedSlot;
          record.assignmentStatus = host ? (selectedSlot ? 'assigned' : 'assigned-host-slot-to-confirm') : 'unassigned-to-chassis';
          record.hostVerificationStatus = host ? (equipment.hostVerificationStatus || 'to-confirm') : 'to-confirm';
          if (host) { record.roomId = host.roomId ?? null; record.baieId = host.baieId ?? null; }
        }
        return originalSave.call(db,store,record);
      };
      try {
        if (typeof previousSubmit === 'function') return await previousSubmit.call(form,event);
      } finally { db.save = originalSave; }
    };
  };
}

function patchModuleQuickView() {
  if (Equipements.prototype.__moduleQuickViewPatched) return;
  Equipements.prototype.__moduleQuickViewPatched = true;
  const previousQuick = Equipements.prototype.showQuickView;
  Equipements.prototype.showQuickView = async function showQuickViewWithModuleRelations(equipment) {
    await previousQuick.call(this,equipment);
    const modal = document.getElementById('equip-quickview-modal');
    const content = modal?.querySelector('.modal-content');
    if (!content) return;
    const equipments = await db.getAll('equipments');
    const children = equipments.filter(record => same(record.hostEquipmentId,equipment?.id) && isModuleCard(record));
    const host = equipment?.hostEquipmentId != null ? equipments.find(record => same(record.id,equipment.hostEquipmentId)) : null;
    if (!children.length && !host && !isModuleCard(equipment || {}) && !isModularChassis(equipment || {})) return;
    const block = document.createElement('section');
    block.style.marginTop = '12px';
    block.innerHTML = `<hr><h4><i class="fas fa-layer-group"></i> Implantation modulaire</h4>
      ${host ? `<p><b>Châssis:</b> ${esc(host.name || host.nom || host.modele || host.id)} · <b>Slot:</b> ${esc(equipment.slot || 'à confirmer')}</p>` : ''}
      ${isModuleCard(equipment || {}) && !host ? '<p><b>Châssis:</b> non affecté — relevé terrain requis.</p>' : ''}
      ${children.length ? `<div>${children.sort((a,b)=>slotKey(a.slot).localeCompare(slotKey(b.slot),'fr')).map(card => `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0"><span>${esc(card.slot || 'Slot ?')} · ${esc(card.name || card.modele)}</span><small>${esc(card.modele || card.catalogId || '')}</small></div>`).join('')}</div>` : ''}`;
    content.appendChild(block);
  };
}

const previousDeleteEquipmentSafely = db.deleteEquipmentSafely.bind(db);
db.deleteEquipmentSafely = async function deleteEquipmentProtectingHostedModules(equipmentId) {
  const children = (await this.getAll('equipments')).filter(record => same(record.hostEquipmentId,equipmentId) && isModuleCard(record));
  if (children.length) {
    const error = new Error(`${children.length} carte(s)/module(s) sont encore affectés à ce châssis. Désaffectez-les avant la suppression.`);
    error.code = 'CHASSIS_HAS_MODULES';
    throw error;
  }
  return previousDeleteEquipmentSafely(equipmentId);
};

patchEquipmentModuleEditor();
patchModuleQuickView();

if (typeof window !== 'undefined') {
  window.ModuleAssignment = Object.freeze({
    isModuleCard,isModularChassis,validate:validateModuleHierarchy,
    assign:assignModuleToChassis,unassign:unassignModuleFromChassis
  });
}

export { isModuleCard, isModularChassis, validateModuleHierarchy, slotKey } from './module-hierarchy-contract.js';
