import { db } from './db.js';
import Equipements from './equipements.js';
import { PORT_TYPES } from './broadcast-ports-cables.js';
import {
  EQUIPMENT_PROFILES, HARDWARE_COMPONENT_TYPES, SOFTWARE_TYPES, PORT_BEHAVIORS,
  makeId, normalizePortsExtended, normalizeComponents, normalizeSoftware
} from './equipment-internals-contract.js';

// Réexportés inchangés : `component-relations.js` et d'autres les importaient déjà d'ici.
// La normalisation elle-même vit désormais dans equipment-internals-contract.js (pur, sans
// DOM ni import de la page Équipements) — voir ce fichier pour pourquoi.
export { EQUIPMENT_PROFILES, HARDWARE_COMPONENT_TYPES, SOFTWARE_TYPES, PORT_BEHAVIORS, normalizePortsExtended, normalizeComponents, normalizeSoftware };

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

const defaultPortBehavior = equipment => {
  const haystack = [equipment?.equipmentProfile, equipment?.type, equipment?.categorie, equipment?.name, equipment?.modele]
    .join(' ').toLowerCase();
  if (haystack.includes('patch') || haystack.includes('ppv') || haystack.includes('brassage')) return 'patch';
  if (haystack.includes('switch') || haystack.includes('routeur') || haystack.includes('router') || haystack.includes('ethernet')) return 'bidirectional';
  return 'fixed';
};

function injectStyles() {
  if (document.getElementById('equipment-internals-styles')) return;
  const style = document.createElement('style');
  style.id = 'equipment-internals-styles';
  style.textContent = `
    .eq-internals{margin:14px 0;padding:14px;border:1px solid var(--border-color,#dbe3ea);border-radius:12px;background:var(--light-bg,#f7f9fb)}
    .eq-internals-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.eq-internals-head h4{margin:0 0 4px}.eq-internals-head p{margin:0;color:var(--text-muted,#667783);font-size:12px}
    .eq-profile-row{display:grid;grid-template-columns:minmax(220px,380px) 1fr;gap:10px;align-items:end;margin-bottom:12px}.eq-profile-row label{display:grid;gap:5px}
    .eq-internal-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.eq-internal-tabs button.active{font-weight:700;box-shadow:inset 0 -2px currentColor}
    .eq-internal-pane{display:none}.eq-internal-pane.active{display:block}.eq-internal-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0}.eq-internal-toolbar small{color:var(--text-muted,#667783)}
    .eq-component-card,.eq-software-card{border:1px solid var(--border-color,#dbe3ea);border-radius:10px;background:var(--card-bg,#fff);padding:10px;margin:8px 0}.eq-component-grid,.eq-software-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.eq-component-grid label,.eq-software-grid label{display:grid;gap:4px;font-size:11px;color:var(--text-muted,#667783)}
    .eq-component-grid input,.eq-component-grid select,.eq-component-grid textarea,.eq-software-grid input,.eq-software-grid select,.eq-software-grid textarea{width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--input-border,#cfd8df);border-radius:7px;background:var(--input-bg,#fff);color:inherit}.eq-component-grid .span-2,.eq-software-grid .span-2{grid-column:span 2}.eq-component-grid .span-4,.eq-software-grid .span-4{grid-column:1/-1}
    .eq-component-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.eq-component-ports{margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-color,#dbe3ea)}.eq-component-port-row{display:grid;grid-template-columns:.65fr 1.1fr .8fr 1fr 1.2fr auto;gap:6px;align-items:center;margin:6px 0}.eq-component-port-row input,.eq-component-port-row select{width:100%;min-width:0;padding:6px;border:1px solid var(--input-border,#cfd8df);border-radius:6px;background:var(--input-bg,#fff);color:inherit}
    .port-behavior{min-width:150px}.equipment-port-row{grid-template-columns:minmax(70px,.65fr) minmax(130px,1.1fr) minmax(90px,.75fr) minmax(150px,1fr) minmax(120px,1fr) auto!important}
    .eq-internals-quick{margin-top:14px;padding-top:12px;border-top:1px solid var(--border-color,#dbe3ea)}.eq-internals-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0}.eq-internals-summary span{padding:9px;border-radius:8px;background:var(--light-bg,#f7f9fb);border:1px solid var(--border-color,#dbe3ea)}.eq-internals-summary b{display:block;font-size:18px}.eq-internals-list{display:grid;gap:6px;margin-top:8px}.eq-internals-list div{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;border-radius:7px;background:var(--light-bg,#f7f9fb)}.eq-internals-list small{color:var(--text-muted,#667783)}
    @media(max-width:900px){.eq-component-grid,.eq-software-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.eq-component-port-row{grid-template-columns:1fr 1fr}.equipment-port-row{grid-template-columns:1fr 1fr!important}.eq-profile-row{grid-template-columns:1fr}}
    @media(max-width:560px){.eq-component-grid,.eq-software-grid{grid-template-columns:1fr}.eq-component-grid .span-2,.eq-software-grid .span-2{grid-column:auto}}
  `;
  document.head.appendChild(style);
}

function renderComponentPorts(component, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'eq-component-ports';
  const render = () => {
    wrap.innerHTML = `<div class="eq-internal-toolbar"><strong>Ports du composant</strong><button type="button" class="btn gray add-component-port"><i class="fas fa-plus"></i> Ajouter un port</button></div>
      <div>${component.ports.length ? component.ports.map((port,index) => `<div class="eq-component-port-row" data-index="${index}">
        <input data-field="number" value="${esc(port.number)}" placeholder="N°">
        <select data-field="type">${PORT_TYPES.map(type => `<option value="${esc(type)}" ${type===port.type?'selected':''}>${esc(type)}</option>`).join('')}</select>
        <select data-field="direction"><option ${port.direction==='IN'?'selected':''}>IN</option><option ${port.direction==='OUT'?'selected':''}>OUT</option><option ${port.direction==='IN/OUT'?'selected':''}>IN/OUT</option></select>
        <select data-field="behavior">${PORT_BEHAVIORS.map(item => `<option value="${item.value}" ${item.value===port.behavior?'selected':''}>${esc(item.label)}</option>`).join('')}</select>
        <input data-field="label" value="${esc(port.label)}" placeholder="Libellé / signal">
        <button type="button" class="btn danger remove-component-port" title="Supprimer"><i class="fas fa-trash"></i></button>
      </div>`).join('') : '<small>Aucun port interne configuré.</small>'}</div>`;
    wrap.querySelector('.add-component-port')?.addEventListener('click', () => {
      component.ports.push({ id:makeId('CPORT'), number:String(component.ports.length+1), type:'BNC / SDI', direction:'IN/OUT', behavior:'fixed', label:'' });
      onChange(); render();
    });
    wrap.querySelectorAll('.eq-component-port-row').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, event => { component.ports[index][field] = event.target.value; onChange(); });
      });
      row.querySelector('.remove-component-port')?.addEventListener('click', async () => {
        const port = component.ports[index];
        const linked = (await db.getAll('cables')).some(cable => cable.sourcePortId === port.id || cable.destinationPortId === port.id);
        if (linked) return window.AppDialog?.alert?.('Ce port interne est utilisé par une liaison. Réaffectez la liaison avant de le supprimer.');
        component.ports.splice(index,1); onChange(); render();
      });
    });
  };
  render();
  return wrap;
}

function installInternalsEditor(instance, equipment, form) {
  injectStyles();
  let components = normalizeComponents(equipment?.components);
  let software = normalizeSoftware(equipment?.software);
  let equipmentProfile = equipment?.equipmentProfile || 'Standard';
  const initialBehavior = defaultPortBehavior({ ...equipment, equipmentProfile });
  let portBehaviors = normalizePortsExtended(equipment?.ports, initialBehavior).map(port => port.behavior || initialBehavior);

  const section = document.createElement('section');
  section.className = 'eq-internals';
  section.innerHTML = `<div class="eq-internals-head"><div><h4><i class="fas fa-microchip"></i> Composition interne & logiciels</h4><p>Inventoriez les composants physiques, modules, cartes, RAM, disques, CPU, systèmes, firmwares et logiciels sans les confondre avec l’équipement parent.</p></div></div>
    <div class="eq-profile-row"><label>Profil de l’équipement<select id="eq-equipment-profile">${EQUIPMENT_PROFILES.map(profile => `<option value="${esc(profile)}" ${profile===equipmentProfile?'selected':''}>${esc(profile)}</option>`).join('')}</select></label><small>Le profil aide à organiser la fiche. Il ne crée aucune donnée technique automatiquement.</small></div>
    <div class="eq-internal-tabs"><button type="button" class="btn active" data-pane="hardware"><i class="fas fa-memory"></i> Matériel interne</button><button type="button" class="btn gray" data-pane="software"><i class="fas fa-code"></i> Systèmes & logiciels</button></div>
    <div class="eq-internal-pane active" data-pane-content="hardware"><div class="eq-internal-toolbar"><small>Cartes, CPU, RAM, disques, alimentations, modules…</small><button type="button" class="btn" id="eq-add-component"><i class="fas fa-plus"></i> Ajouter un composant</button></div><div id="eq-components-list"></div></div>
    <div class="eq-internal-pane" data-pane-content="software"><div class="eq-internal-toolbar"><small>OS, firmware, BIOS, pilotes, applications, services, licences…</small><button type="button" class="btn" id="eq-add-software"><i class="fas fa-plus"></i> Ajouter un logiciel / système</button></div><div id="eq-software-list"></div></div>`;

  const anchor = form.elements.notes || form.querySelector('.equipment-ports-editor')?.nextSibling;
  if (anchor?.parentNode === form) form.insertBefore(section, anchor);
  else form.appendChild(section);

  const renderComponents = () => {
    const list = section.querySelector('#eq-components-list');
    list.innerHTML = '';
    components.forEach((component,index) => {
      const card = document.createElement('div');
      card.className = 'eq-component-card';
      const parentOptions = components.filter(item => item.id !== component.id).map(item => `<option value="${esc(item.id)}" ${String(item.id)===String(component.parentComponentId)?'selected':''}>${esc(item.name || item.type)}</option>`).join('');
      card.innerHTML = `<div class="eq-component-grid">
        <label>Type<select data-field="type">${HARDWARE_COMPONENT_TYPES.map(type => `<option value="${esc(type)}" ${type===component.type?'selected':''}>${esc(type)}</option>`).join('')}</select></label>
        <label>Nom / repère<input data-field="name" value="${esc(component.name)}" placeholder="ex: CPU 1, Carte DVN-E05"></label>
        <label>Constructeur<input data-field="manufacturer" value="${esc(component.manufacturer)}"></label>
        <label>Modèle<input data-field="model" value="${esc(component.model)}"></label>
        <label>N° série<input data-field="serialNumber" value="${esc(component.serialNumber)}"></label>
        <label>Part number<input data-field="partNumber" value="${esc(component.partNumber)}"></label>
        <label>Capacité / caractéristiques<input data-field="capacity" value="${esc(component.capacity)}" placeholder="ex: 32 GB, 1.92 TB, 16 cœurs"></label>
        <label>Slot / emplacement<input data-field="slot" value="${esc(component.slot)}" placeholder="ex: Slot 5-6, DIMM A1"></label>
        <label>Parent interne<select data-field="parentComponentId"><option value="">Aucun — directement dans l’équipement</option>${parentOptions}</select></label>
        <label>Statut<select data-field="status">${['Opérationnel','Maintenance','Hors service','Réserve','À vérifier'].map(status => `<option ${status===component.status?'selected':''}>${status}</option>`).join('')}</select></label>
        <label>Validation<select data-field="verificationStatus"><option value="verified" ${component.verificationStatus==='verified'?'selected':''}>Vérifié</option><option value="documented" ${component.verificationStatus==='documented'?'selected':''}>Documenté</option><option value="to-confirm" ${component.verificationStatus==='to-confirm'?'selected':''}>À confirmer</option></select></label>
        <label>Remplaçable<select data-field="replaceable"><option value="true" ${component.replaceable!==false?'selected':''}>Oui</option><option value="false" ${component.replaceable===false?'selected':''}>Non</option></select></label>
        <label class="span-4">Notes<textarea data-field="notes" rows="2">${esc(component.notes)}</textarea></label>
      </div><div class="eq-component-actions"><button type="button" class="btn danger remove-component"><i class="fas fa-trash"></i> Supprimer le composant</button></div>`;
      card.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, event => {
          let value = event.target.value;
          if (field === 'replaceable') value = value === 'true';
          if (field === 'parentComponentId') value = value || null;
          components[index][field] = value;
        });
      });
      card.querySelector('.remove-component').onclick = async () => {
        const cableUse = (await db.getAll('cables')).some(cable =>
          (cable.sourceType === 'component' && String(cable.sourceId) === String(component.id)) ||
          (cable.destinationType === 'component' && String(cable.destinationId) === String(component.id))
        );
        if (cableUse) return instance.notifications?.showNotification('Ce composant est utilisé par une liaison. Réaffectez-la avant la suppression.', 'warning');
        components.splice(index,1);
        components.forEach(item => { if (String(item.parentComponentId) === String(component.id)) item.parentComponentId = null; });
        renderComponents();
      };
      card.appendChild(renderComponentPorts(component, () => {}));
      list.appendChild(card);
    });
    if (!components.length) list.innerHTML = '<small>Aucun composant interne enregistré. Ajoutez uniquement ce qui est réellement présent ou à vérifier.</small>';
  };

  const renderSoftware = () => {
    const list = section.querySelector('#eq-software-list');
    list.innerHTML = '';
    software.forEach((item,index) => {
      const card = document.createElement('div');
      card.className = 'eq-software-card';
      card.innerHTML = `<div class="eq-software-grid">
        <label>Type<select data-field="type">${SOFTWARE_TYPES.map(type => `<option value="${esc(type)}" ${type===item.type?'selected':''}>${esc(type)}</option>`).join('')}</select></label>
        <label>Nom<input data-field="name" value="${esc(item.name)}"></label>
        <label>Version<input data-field="version" value="${esc(item.version)}"></label>
        <label>Éditeur<input data-field="vendor" value="${esc(item.vendor)}"></label>
        <label>Licence / clé de référence<input data-field="license" value="${esc(item.license)}"></label>
        <label>Installé le<input data-field="installedOn" type="date" value="${esc(item.installedOn)}"></label>
        <label>Statut<select data-field="status">${['Actif','Inactif','À mettre à jour','Obsolète','À vérifier'].map(status => `<option ${status===item.status?'selected':''}>${status}</option>`).join('')}</select></label>
        <label>Validation<select data-field="verificationStatus"><option value="verified" ${item.verificationStatus==='verified'?'selected':''}>Vérifié</option><option value="documented" ${item.verificationStatus==='documented'?'selected':''}>Documenté</option><option value="to-confirm" ${item.verificationStatus==='to-confirm'?'selected':''}>À confirmer</option></select></label>
        <label class="span-4">Notes<textarea data-field="notes" rows="2">${esc(item.notes)}</textarea></label>
      </div><div class="eq-component-actions"><button type="button" class="btn danger remove-software"><i class="fas fa-trash"></i> Supprimer</button></div>`;
      card.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, event => { software[index][field] = event.target.value; });
      });
      card.querySelector('.remove-software').onclick = () => { software.splice(index,1); renderSoftware(); };
      list.appendChild(card);
    });
    if (!software.length) list.innerHTML = '<small>Aucun système ou logiciel enregistré.</small>';
  };

  section.querySelectorAll('[data-pane]').forEach(button => button.onclick = () => {
    section.querySelectorAll('[data-pane]').forEach(item => item.classList.toggle('active', item === button));
    section.querySelectorAll('[data-pane-content]').forEach(pane => pane.classList.toggle('active', pane.dataset.paneContent === button.dataset.pane));
  });
  section.querySelector('#eq-equipment-profile').onchange = event => { equipmentProfile = event.target.value; };
  section.querySelector('#eq-add-component').onclick = () => {
    components.push(normalizeComponents([{ id:makeId('COMP'), type:'Autre', name:'', status:'À vérifier', verificationStatus:'to-confirm', ports:[] }])[0]);
    renderComponents();
  };
  section.querySelector('#eq-add-software').onclick = () => {
    software.push(normalizeSoftware([{ id:makeId('SW'), type:'Application', name:'', status:'À vérifier', verificationStatus:'to-confirm' }])[0]);
    renderSoftware();
  };
  renderComponents(); renderSoftware();

  const portsList = form.querySelector('#equipment-ports-list');
  const decorateEquipmentPorts = () => {
    if (!portsList) return;
    const rows = [...portsList.querySelectorAll('.equipment-port-row')];
    while (portBehaviors.length < rows.length) portBehaviors.push(defaultPortBehavior({ ...equipment, equipmentProfile }));
    if (portBehaviors.length > rows.length) portBehaviors.length = rows.length;
    rows.forEach((row,index) => {
      if (row.querySelector('.port-behavior')) return;
      const select = document.createElement('select');
      select.className = 'port-behavior';
      select.setAttribute('aria-label', 'Comportement du port');
      select.innerHTML = PORT_BEHAVIORS.map(item => `<option value="${item.value}" ${item.value===portBehaviors[index]?'selected':''}>${esc(item.label)}</option>`).join('');
      select.onchange = event => { portBehaviors[index] = event.target.value; };
      const label = row.querySelector('.port-label');
      if (label) row.insertBefore(select,label); else row.appendChild(select);
    });
  };
  decorateEquipmentPorts();
  portsList?.addEventListener('click', event => {
    const remove = event.target.closest('.remove-port');
    if (!remove) return;
    const index = Number(remove.closest('.equipment-port-row')?.dataset.index);
    if (Number.isInteger(index)) portBehaviors.splice(index,1);
    setTimeout(decorateEquipmentPorts,0);
  }, true);
  form.querySelector('#add-equipment-port')?.addEventListener('click', () => setTimeout(decorateEquipmentPorts,0));
  if (portsList) new MutationObserver(() => decorateEquipmentPorts()).observe(portsList,{childList:true,subtree:true});

  const previousSubmit = form.onsubmit;
  form.onsubmit = async event => {
    const originalSave = db.save;
    let intercepted = false;
    db.save = async function saveEquipmentWithInternals(store, record) {
      if (store === 'equipments' && !intercepted) {
        intercepted = true;
        const fallback = defaultPortBehavior({ ...record, equipmentProfile });
        record.equipmentProfile = equipmentProfile;
        record.components = normalizeComponents(components);
        record.software = normalizeSoftware(software);
        record.ports = normalizePortsExtended(record.ports, fallback).map((port,index) => ({
          ...port,
          behavior: portBehaviors[index] || port.behavior || fallback
        }));
        record.configurationVersion = 2;
      }
      return originalSave.call(db, store, record);
    };
    try {
      if (typeof previousSubmit === 'function') return await previousSubmit.call(form,event);
    } finally {
      db.save = originalSave;
    }
  };
}

const previousShowEquipmentModal = Equipements.prototype.showEquipementModal;
Equipements.prototype.showEquipementModal = async function showEquipmentWithInternals(equipment = null) {
  await previousShowEquipmentModal.call(this,equipment);
  const form = document.getElementById('eq-form');
  if (!form || form.dataset.internalsReady === '1') return;
  form.dataset.internalsReady = '1';
  installInternalsEditor(this,equipment,form);
};

const previousQuickView = Equipements.prototype.showQuickView;
Equipements.prototype.showQuickView = async function showQuickViewWithInternals(equipment) {
  await previousQuickView.call(this,equipment);
  injectStyles();
  const modal = document.getElementById('equip-quickview-modal');
  const content = modal?.querySelector('.modal-content');
  if (!content) return;
  const components = normalizeComponents(equipment?.components);
  const software = normalizeSoftware(equipment?.software);
  const ports = normalizePortsExtended(equipment?.ports, defaultPortBehavior(equipment));
  const componentPorts = components.reduce((count,item) => count + item.ports.length,0);
  const block = document.createElement('section');
  block.className = 'eq-internals-quick';
  block.innerHTML = `<h4><i class="fas fa-microchip"></i> Composition & configuration</h4>
    <div class="eq-internals-summary"><span><b>${esc(components.length)}</b><small>Composants matériels</small></span><span><b>${esc(software.length)}</b><small>Systèmes / logiciels</small></span><span><b>${esc(componentPorts)}</b><small>Ports internes</small></span><span><b>${esc(ports.filter(port => port.behavior !== 'fixed').length)}</b><small>Ports réversibles / bidirectionnels</small></span></div>
    ${components.length ? `<strong>Matériel interne</strong><div class="eq-internals-list">${components.slice(0,12).map(item => `<div><span>${esc(item.name || item.type)}${item.slot ? ` · ${esc(item.slot)}` : ''}</span><small>${esc([item.manufacturer,item.model,item.capacity].filter(Boolean).join(' · ') || item.status)}</small></div>`).join('')}</div>` : ''}
    ${software.length ? `<strong style="display:block;margin-top:10px">Systèmes & logiciels</strong><div class="eq-internals-list">${software.slice(0,12).map(item => `<div><span>${esc(item.name || item.type)}</span><small>${esc([item.version,item.vendor,item.status].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>` : ''}`;
  content.appendChild(block);
};

if (typeof window !== 'undefined') {
  window.EquipmentInternals = Object.freeze({
    profiles:EQUIPMENT_PROFILES,
    componentTypes:HARDWARE_COMPONENT_TYPES,
    softwareTypes:SOFTWARE_TYPES,
    portBehaviors:PORT_BEHAVIORS,
    normalizeComponents,
    normalizeSoftware,
    normalizePorts:normalizePortsExtended
  });
}

export default window.EquipmentInternals;
