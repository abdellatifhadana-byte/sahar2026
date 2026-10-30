import DiagramStudio from './diagram-studio.js';
import { db } from './db.js';
import {
  PORT_TYPES, CABLE_TYPE_DEFINITIONS, normalizePort, normalizePorts,
  normalizeCableRecord, validateCableShape, evaluateConnection, validateEquipmentConnectivity
} from './connectivity-contract.js';

const PATCH = Symbol.for('2m-tech.diagram-canonical-authoring');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const same = (a,b) => a != null && b != null && String(a) === String(b);

function modalShell(idValue, title, body) {
  document.getElementById(idValue)?.remove();
  const modal = document.createElement('div');
  modal.id = idValue;
  modal.className = 'modal diagram-modal';
  modal.innerHTML = `<div class="modal-content diagram-modal-card"><button type="button" class="modal-x" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
  document.body.appendChild(modal);
  modal.style.display = 'flex';
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  return modal;
}

function selectedDiagramNode(studio, editor) {
  const selected = editor.querySelector('.diagram-node.selected[data-node-id]');
  if (!selected) return null;
  const diagram = studio.__advancedDiagram || studio.diagrams.find(item => same(item.id, editor.dataset.diagramId));
  return diagram?.nodes?.find(node => same(node.id, selected.dataset.nodeId))
    || studio.diagrams.flatMap(item => item.nodes || []).find(node => same(node.id, selected.dataset.nodeId));
}

function entityEntry(studio, reference = {}) {
  return studio.entities.find(entry => entry.type === reference.type
    && same(entry.id, reference.id)
    && same(entry.parentEquipmentId || '', reference.parentEquipmentId || '')) || null;
}

async function savePortOnNode(studio, node, values) {
  const reference = node?.entityRef;
  if (!reference || !['equipment','component'].includes(reference.type)) throw new Error('Sélectionnez un équipement ou un composant technique.');
  const equipmentId = reference.type === 'component' ? reference.parentEquipmentId : reference.id;
  const equipment = await db.get('equipments', equipmentId);
  if (!equipment) throw new Error('Équipement canonique introuvable.');
  const port = normalizePort({
    id:id('PORT'), number:values.number, label:values.label, type:values.type,
    direction:values.direction, behavior:values.behavior, verificationStatus:'documented',
    notes:values.notes
  }, 0);
  let candidate;
  if (reference.type === 'equipment') {
    candidate = { ...equipment, ports:[...normalizePorts(equipment.ports), port], updatedAt:new Date().toISOString() };
  } else {
    candidate = {
      ...equipment,
      components:(equipment.components || []).map(component => same(component.id, reference.id)
        ? { ...component, ports:[...normalizePorts(component.ports), port] }
        : component),
      updatedAt:new Date().toISOString()
    };
  }
  const checked = validateEquipmentConnectivity(candidate);
  if (checked.errors.length) throw new Error(checked.errors.join(' '));
  await db.save('equipments', checked.value);
  const entry = entityEntry(studio, reference);
  if (entry) entry.entity = reference.type === 'equipment'
    ? checked.value
    : checked.value.components.find(component => same(component.id, reference.id));
  return port;
}

function endpointFromNode(node) {
  const ref = node?.entityRef || {};
  if (ref.type === 'equipment') return { type:'equipment', id:ref.id, equipmentId:ref.id, parentEquipmentId:null };
  if (ref.type === 'component') return { type:'component', id:ref.id, equipmentId:ref.parentEquipmentId, parentEquipmentId:ref.parentEquipmentId };
  if (ref.type === 'screen') return { type:'screen', id:ref.id, screenId:ref.id, parentEquipmentId:null };
  return null;
}

function portsForNode(studio, node) {
  return normalizePorts(entityEntry(studio, node?.entityRef)?.entity?.ports || []);
}

function optionPorts(ports) {
  return `<option value="">Sélectionner un port…</option>${ports.map(port => `<option value="${esc(port.id)}">${esc(port.number)} · ${esc(port.type)} · ${esc(port.direction)}</option>`).join('')}`;
}

function installAuthoringButtons(studio, modal, source) {
  const toolbar = modal.querySelector('.diagram-toolbar > div:last-child');
  const canvas = modal.querySelector('.diagram-canvas');
  if (!toolbar || !canvas || !modal.querySelector('.add-node') || toolbar.querySelector('[data-canonical-authoring]')) return;
  modal.dataset.diagramId = source.id;

  const equipmentButton = document.createElement('button');
  equipmentButton.type = 'button';
  equipmentButton.className = 'btn gray';
  equipmentButton.dataset.canonicalAuthoring = 'equipment';
  equipmentButton.innerHTML = '<i class="fas fa-server"></i> Équipement +';
  equipmentButton.title = 'Créer un équipement canonique puis l’ajouter au schéma';

  const portButton = document.createElement('button');
  portButton.type = 'button';
  portButton.className = 'btn gray';
  portButton.dataset.canonicalAuthoring = 'port';
  portButton.innerHTML = '<i class="fas fa-plug"></i> Port +';
  portButton.title = 'Ajouter un port à la fiche canonique de l’entité sélectionnée';

  const cableButton = document.createElement('button');
  cableButton.type = 'button';
  cableButton.className = 'btn gray';
  cableButton.dataset.canonicalAuthoring = 'cable';
  cableButton.innerHTML = '<i class="fas fa-link"></i> Câble +';
  cableButton.title = 'Créer un câble canonique puis lier les deux ports sur ce schéma';

  toolbar.prepend(cableButton);
  toolbar.prepend(portButton);
  toolbar.prepend(equipmentButton);

  equipmentButton.onclick = async () => {
    const [rooms, baies] = await Promise.all([db.getAll('rooms'), db.getAll('baies')]);
    const formModal = modalShell('diagram-canonical-equipment-modal','Créer un équipement canonique',`<form class="diagram-form">
      <label>Nom<input name="name" required placeholder="Nom officiel de l’équipement"></label>
      <label>Type<input name="type" required placeholder="Ex. Routeur vidéo, serveur, convertisseur"></label>
      <label>Marque<input name="marque"></label><label>Modèle<input name="modele"></label>
      <label>Salle<select name="roomId" required><option value="">Sélectionner…</option>${rooms.map(room => `<option value="${esc(room.id)}">${esc(room.name || room.id)}</option>`).join('')}</select></label>
      <label>Baie<select name="baieId"><option value="">Aucune / hors baie</option>${baies.map(baie => `<option value="${esc(baie.id)}" data-room="${esc(baie.roomId)}">${esc(baie.name || baie.id)}</option>`).join('')}</select></label>
      <label>N° de série<input name="numSerie"></label><label>Statut<select name="statut"><option>Opérationnel</option><option>Maintenance</option><option>Hors service</option></select></label>
      <label class="span-2">Notes<textarea name="notes" placeholder="Source terrain, rôle, observations…"></textarea></label>
      <div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Créer et préparer l’ajout</button></div>
    </form>`);
    const form = formModal.querySelector('form');
    formModal.querySelector('.cancel').onclick = () => formModal.remove();
    form.roomId.onchange = () => {
      for (const option of form.baieId.options) option.hidden = option.value && !same(option.dataset.room, form.roomId.value);
      if (form.baieId.selectedOptions[0]?.hidden) form.baieId.value = '';
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const equipment = {
          id:Date.now() * 1000 + Math.floor(Math.random() * 1000), name:values.name.trim(), type:values.type.trim(),
          marque:values.marque.trim(), modele:values.modele.trim(), numSerie:values.numSerie.trim(), statut:values.statut,
          roomId:Number(values.roomId), baieId:values.baieId ? Number(values.baieId) : null,
          ports:[], components:[], notes:values.notes.trim(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
          verificationStatus:'documented'
        };
        const checked = validateEquipmentConnectivity(equipment);
        if (checked.errors.length) throw new Error(checked.errors.join(' '));
        await db.save('equipments', checked.value);
        await studio.load();
        formModal.remove();
        modal.querySelector('.add-node')?.click();
        requestAnimationFrame(() => {
          const nodeModal = document.getElementById('diagram-node-modal');
          const select = nodeModal?.querySelector('[name="entityKey"]');
          if (!select) return;
          const key = `equipment::${checked.value.id}`;
          select.value = key;
          select.dispatchEvent(new Event('change', { bubbles:true }));
          // Indice seulement : le champ reste vide pour que le nœud suive le nom officiel
          // de l'équipement, y compris après un renommage.
          const label = nodeModal.querySelector('[name="label"]');
          if (label) label.placeholder = `Laisser vide → ${checked.value.name}`;
        });
        studio.notify('Équipement créé dans l’inventaire. Confirmez son placement sur le schéma.', 'success');
      } catch (error) { studio.notify(error.message, 'error'); }
    };
  };

  portButton.onclick = () => {
    const node = selectedDiagramNode(studio, modal);
    if (!node) return studio.notify('Sélectionnez d’abord un équipement dans le schéma.', 'warning');
    const ref = node.entityRef || {};
    if (!['equipment','component'].includes(ref.type)) return studio.notify('Les ports s’ajoutent à un équipement ou à un composant canonique.', 'warning');
    const formModal = modalShell('diagram-canonical-port-modal',`Ajouter un port — ${studio.nodeLabel(node) || ref.id}`,`<form class="diagram-form">
      <label>N° / repère<input name="number" required placeholder="Ex. IN 1, OUT 12, REF A"></label>
      <label>Nom / signal<input name="label" placeholder="Ex. Programme RF1"></label>
      <label>Type<select name="type">${PORT_TYPES.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select></label>
      <label>Direction<select name="direction"><option>IN</option><option>OUT</option><option>IN/OUT</option></select></label>
      <label>Comportement<select name="behavior"><option value="fixed">Fixe</option><option value="patch">Brassage</option><option value="bidirectional">Bidirectionnel</option><option value="passive">Passif</option></select></label>
      <label>Notes<input name="notes" placeholder="Repérage, panneau, source terrain…"></label>
      <div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Enregistrer le port</button></div>
    </form>`);
    formModal.querySelector('.cancel').onclick = () => formModal.remove();
    formModal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const port = await savePortOnNode(studio, node, values);
        formModal.remove();
        const activeDiagram = studio.__advancedDiagram || source;
        window.DiagramStudioAdvanced?.decorateCanvas?.(studio, activeDiagram, modal);
        studio.notify(`Port ${port.number} ajouté à la fiche canonique.`, 'success');
      } catch (error) { studio.notify(error.message, 'error'); }
    };
  };

  cableButton.onclick = () => {
    const activeDiagram = studio.__advancedDiagram || source;
    const nodes = (activeDiagram.nodes || []).filter(node => ['equipment','component','screen'].includes(node.entityRef?.type));
    if (nodes.length < 2) return studio.notify('Ajoutez au moins deux entités techniques au schéma.', 'warning');
    const categories = Object.keys(CABLE_TYPE_DEFINITIONS);
    // Nom vivant de l'entité, pas l'instantané pris au moment du dessin.
    const nodeOptions = nodes.map(node => `<option value="${esc(node.id)}">${esc(studio.nodeLabel(node) || node.id)}</option>`).join('');
    const formModal = modalShell('diagram-canonical-cable-modal','Créer un câble canonique',`<form class="diagram-form">
      <label>Source<select name="sourceNodeId">${nodeOptions}</select></label><label>Port source<select name="sourcePortId"></select></label>
      <label>Destination<select name="destinationNodeId">${nodeOptions}</select></label><label>Port destination<select name="destinationPortId"></select></label>
      <label>Référence<input name="reference" required value="CAB-${new Date().getFullYear()}-"></label>
      <label>Catégorie<select name="category">${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select></label>
      <label>Type<select name="type"></select></label>
      <label>Rôle<select name="pathRole"><option>PROGRAM</option><option>BACKUP</option><option>MONITORING</option><option>SYNC</option><option>AUDIO</option><option>INTERCOM</option><option>OTHER</option></select></label>
      <label>Mode<select name="signalMode"><option>DIRECT</option><option>MANUAL_PATCH</option><option>BIDIRECTIONAL</option><option>PHYSICAL_ONLY</option></select></label>
      <label>Couleur physique<input name="physicalColor" placeholder="Ex. noir, rouge, bleu"></label>
      <label>Style du tracé<select name="diagramRouteStyle"><option value="orthogonal">Orthogonal 90°</option><option value="straight">Droit</option><option value="curve">Courbe</option><option value="free">Libre / points de passage</option></select></label>
      <label>Longueur<input name="length" placeholder="Ex. 15 m"></label>
      <label class="span-2">Notes<textarea name="notes" placeholder="Cheminement, patch, repérage…"></textarea></label>
      <div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Créer et relier</button></div>
    </form>`);
    const form = formModal.querySelector('form');
    formModal.querySelector('.cancel').onclick = () => formModal.remove();
    const nodeBy = idValue => nodes.find(node => same(node.id, idValue));
    const refreshPorts = (nodeField, portField) => { form[portField].innerHTML = optionPorts(portsForNode(studio, nodeBy(form[nodeField].value))); };
    const refreshTypes = () => { form.type.innerHTML = Object.keys(CABLE_TYPE_DEFINITIONS[form.category.value] || {}).map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join(''); };
    form.sourceNodeId.onchange = () => refreshPorts('sourceNodeId','sourcePortId');
    form.destinationNodeId.onchange = () => refreshPorts('destinationNodeId','destinationPortId');
    form.category.onchange = refreshTypes;
    if (nodes[1]) form.destinationNodeId.value = nodes[1].id;
    refreshPorts('sourceNodeId','sourcePortId'); refreshPorts('destinationNodeId','destinationPortId'); refreshTypes();

    form.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const sourceNode = nodeBy(values.sourceNodeId); const destinationNode = nodeBy(values.destinationNodeId);
      if (!sourceNode || !destinationNode || same(sourceNode.id, destinationNode.id)) return studio.notify('Choisissez deux entités distinctes.', 'warning');
      const sourcePort = portsForNode(studio, sourceNode).find(port => same(port.id, values.sourcePortId));
      const destinationPort = portsForNode(studio, destinationNode).find(port => same(port.id, values.destinationPortId));
      if (!sourcePort || !destinationPort) return studio.notify('Sélectionnez les deux ports réels.', 'warning');
      const sourceEndpoint = endpointFromNode(sourceNode); const destinationEndpoint = endpointFromNode(destinationNode);
      if (!sourceEndpoint || !destinationEndpoint) return studio.notify('Type d’extrémité non pris en charge.', 'error');
      const sourceEquipment = sourceEndpoint.equipmentId ? await db.get('equipments', sourceEndpoint.equipmentId) : null;
      const cable = normalizeCableRecord({
        id:id('CAB'), reference:values.reference.trim(), category:values.category, type:values.type,
        sourceType:sourceEndpoint.type, sourceId:sourceEndpoint.id, sourceEquipmentId:sourceEndpoint.equipmentId,
        sourceParentEquipmentId:sourceEndpoint.parentEquipmentId, sourcePortId:sourcePort.id,
        destinationType:destinationEndpoint.type, destinationId:destinationEndpoint.id, destinationEquipmentId:destinationEndpoint.equipmentId,
        destinationParentEquipmentId:destinationEndpoint.parentEquipmentId, destinationPortId:destinationPort.id,
        pathRole:values.pathRole, signalMode:values.signalMode, physicalColor:values.physicalColor.trim(),
        diagramRouteStyle:values.diagramRouteStyle, length:values.length.trim(), notes:values.notes.trim(),
        roomId:sourceEquipment?.roomId ?? null, status:'Connecté', verificationStatus:'documented',
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
      });
      const shape = validateCableShape(cable);
      if (shape.errors.length) return studio.notify(shape.errors.join(' '), 'error');
      const assessment = evaluateConnection({ sourcePort, destinationPort, cable:shape.value });
      if (assessment.status === 'incompatible') return studio.notify(assessment.reasons.join(' '), 'error');
      try {
        await db.save('cables', { ...shape.value, compatibilityStatus:assessment.status, compatibilityReasons:assessment.reasons });
        studio.cables = [...studio.cables.filter(item => !same(item.id, shape.value.id)), shape.value];
        formModal.remove();
        modal.querySelector('.add-edge')?.click();
        requestAnimationFrame(() => {
          const edgeModal = document.getElementById('diagram-edge-modal');
          const edgeForm = edgeModal?.querySelector('form');
          if (!edgeForm) return;
          edgeForm.sourceNodeId.value = sourceNode.id; edgeForm.sourceNodeId.dispatchEvent(new Event('change'));
          edgeForm.destinationNodeId.value = destinationNode.id; edgeForm.destinationNodeId.dispatchEvent(new Event('change'));
          edgeForm.sourcePortId.value = sourcePort.id; edgeForm.destinationPortId.value = destinationPort.id;
          edgeForm.cableId.value = shape.value.id; edgeForm.cableId.dispatchEvent(new Event('change'));
          edgeForm.pathRole.value = values.pathRole; edgeForm.label.value = shape.value.reference;
          edgeForm.requestSubmit();
        });
        studio.notify(`Câble ${shape.value.reference} créé dans l’inventaire et relié au schéma.`, assessment.status === 'compatible' ? 'success' : 'warning');
      } catch (error) { studio.notify(error.message, 'error'); }
    };
  };
}

if (!DiagramStudio.prototype[PATCH]) {
  const previousOpenEditor = DiagramStudio.prototype.openEditor;
  DiagramStudio.prototype.openEditor = async function openEditorWithCanonicalAuthoring(idValue) {
    const source = this.diagrams.find(item => same(item.id, idValue));
    const result = await previousOpenEditor.call(this, idValue);
    const modal = document.getElementById('diagram-editor-modal');
    if (modal && source && this.canEditRecord(source)) installAuthoringButtons(this, modal, source);
    return result;
  };
  Object.defineProperty(DiagramStudio.prototype, PATCH, { value:true });
}

if (typeof window !== 'undefined') window.DiagramCanonicalAuthoring = Object.freeze({ version:1 });
