import DiagramStudio from './diagram-studio.js';
import { normalizePorts } from './connectivity-contract.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const clamp = (value,min,max) => Math.max(min,Math.min(max,Number(value) || 0));
const cssNumber = value => Number.parseFloat(String(value || '0')) || 0;

function modalShell(id,title,body) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id; modal.className = 'modal diagram-modal';
  modal.innerHTML = `<div class="modal-content diagram-modal-card"><button class="modal-x" type="button" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
  document.body.appendChild(modal); modal.style.display = 'flex';
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  return modal;
}

function entitySignature(reference = {}) {
  return `${reference.type || 'equipment'}:${reference.parentEquipmentId || ''}:${reference.id ?? ''}`;
}

function entryFor(studio,node) {
  if (!node?.entityRef) return null;
  return studio.entities.find(entry => entitySignature(entry) === entitySignature(node.entityRef)) || null;
}

function nodePorts(studio,node) {
  return normalizePorts(entryFor(studio,node)?.entity?.ports || []);
}

function nodeRectPercent(element) {
  return {
    x:cssNumber(element.style.left), y:cssNumber(element.style.top),
    width:cssNumber(element.style.width), height:cssNumber(element.style.height)
  };
}

function portPoint(studio,node,nodeElement,portId,side) {
  const rect = nodeRectPercent(nodeElement);
  const ports = nodePorts(studio,node);
  const index = Math.max(0,ports.findIndex(port => String(port.id) === String(portId)));
  const port = ports[index] || null;
  const fraction = ports.length ? (index + 1) / (ports.length + 1) : 0.5;
  const direction = String(port?.direction || '').toUpperCase();
  const preferRight = side === 'source' ? direction !== 'IN' : direction === 'OUT';
  return {
    x:rect.x + (preferRight ? rect.width : 0),
    y:rect.y + rect.height * fraction,
    direction,
    port
  };
}

function decorateNode(studio,node,element) {
  element.classList.add(`diagram-node-${node.type}`);
  element.style.zIndex = String(node.zIndex ?? (node.type === 'boundary' ? 0 : 10));
  if (node.locked) element.classList.add('locked');

  if (node.type === 'boundary') {
    element.setAttribute('aria-label', `Cadre ${node.label}`);
    element.innerHTML = `<span class="diagram-boundary-title">${esc(node.label)}</span>`;
    return;
  }
  if (node.type === 'label') {
    element.innerHTML = `<span class="diagram-free-label">${esc(node.label)}</span>`;
    return;
  }
  if (node.type === 'off-page-reference') {
    const target = node.targetDiagramId ? studio.diagrams.find(item => String(item.id) === String(node.targetDiagramId)) : null;
    element.innerHTML = `<span class="diagram-offpage-icon">↗</span><span>${esc(node.label || 'Renvoi')}</span><small>${esc(node.referenceText || target?.title || 'Autre page')}</small>`;
    return;
  }
  if (node.type !== 'entity') return;

  const ports = nodePorts(studio,node);
  const title = element.querySelector(':scope > span')?.textContent || node.label || node.id;
  const visible = ports.slice(0,10);
  const left = visible.filter(port => String(port.direction).toUpperCase() === 'IN');
  const right = visible.filter(port => String(port.direction).toUpperCase() !== 'IN');
  const chip = (port,side) => `<span class="diagram-port-chip ${side}" data-port-id="${esc(port.id)}" title="${esc(`${port.number} · ${port.direction} · ${port.type}`)}">${esc(port.number || port.label || port.id)}</span>`;
  element.innerHTML = `<span class="diagram-device-title">${esc(title)}</span>${ports.length ? `<span class="diagram-device-port-count">${ports.length} ports</span><span class="diagram-port-stack left">${left.map(port => chip(port,'left')).join('')}</span><span class="diagram-port-stack right">${right.map(port => chip(port,'right')).join('')}</span>${ports.length > 10 ? `<small class="diagram-port-more">+${ports.length - 10}</small>` : ''}` : '<small class="diagram-port-empty">Ports non relevés</small>'}`;
}

function decorateEdges(studio,diagram,canvas) {
  const svg = canvas.querySelector('svg.diagram-edges');
  if (!svg) return;
  svg.querySelectorAll('.diagram-edge-label').forEach(node => node.remove());
  for (const edge of diagram?.edges || []) {
    const line = svg.querySelector(`[data-edge-id="${CSS.escape(String(edge.id))}"]`);
    if (!line) continue;
    const sourceNode = diagram.nodes.find(node => String(node.id) === String(edge.sourceNodeId));
    const destinationNode = diagram.nodes.find(node => String(node.id) === String(edge.destinationNodeId));
    const sourceElement = canvas.querySelector(`.diagram-node[data-node-id="${CSS.escape(String(edge.sourceNodeId))}"]`);
    const destinationElement = canvas.querySelector(`.diagram-node[data-node-id="${CSS.escape(String(edge.destinationNodeId))}"]`);
    if (!sourceNode || !destinationNode || !sourceElement || !destinationElement) continue;

    const sourceRect = nodeRectPercent(sourceElement); const destinationRect = nodeRectPercent(destinationElement);
    const sourcePoint = edge.sourcePortId ? portPoint(studio,sourceNode,sourceElement,edge.sourcePortId,'source') : { x:sourceRect.x + sourceRect.width / 2, y:sourceRect.y + sourceRect.height / 2 };
    const destinationPoint = edge.destinationPortId ? portPoint(studio,destinationNode,destinationElement,edge.destinationPortId,'destination') : { x:destinationRect.x + destinationRect.width / 2, y:destinationRect.y + destinationRect.height / 2 };
    line.setAttribute('x1',`${clamp(sourcePoint.x,0,100)}%`); line.setAttribute('y1',`${clamp(sourcePoint.y,0,100)}%`);
    line.setAttribute('x2',`${clamp(destinationPoint.x,0,100)}%`); line.setAttribute('y2',`${clamp(destinationPoint.y,0,100)}%`);

    const cable = edge.cableId ? studio.cables.find(item => String(item.id) === String(edge.cableId)) : null;
    const label = edge.label || cable?.reference || '';
    if (label) {
      const textNode = document.createElementNS('http://www.w3.org/2000/svg','text');
      textNode.classList.add('diagram-edge-label');
      textNode.setAttribute('x',`${(sourcePoint.x + destinationPoint.x) / 2}%`);
      textNode.setAttribute('y',`${(sourcePoint.y + destinationPoint.y) / 2}%`);
      textNode.setAttribute('text-anchor','middle');
      textNode.textContent = label;
      svg.appendChild(textNode);
    }
  }
}

function decorateCanvas(studio,diagram,modal) {
  const canvas = modal?.querySelector('.diagram-canvas');
  if (!canvas || !diagram) return;
  for (const element of canvas.querySelectorAll('.diagram-node[data-node-id]')) {
    const node = diagram.nodes.find(item => String(item.id) === String(element.dataset.nodeId));
    if (node) decorateNode(studio,node,element);
  }
  decorateEdges(studio,diagram,canvas);
}

function installDecorationObserver(studio,modal,initialDiagram) {
  const canvas = modal?.querySelector('.diagram-canvas');
  if (!canvas) return;
  studio.__advancedDiagram = studio.__advancedDiagram || initialDiagram;
  let scheduled = false;
  let observer;
  const observe = () => observer.observe(canvas,{ childList:true,subtree:true,attributes:true,attributeFilter:['style','x1','x2','y1','y2'] });
  const refresh = () => {
    scheduled = false; observer.disconnect();
    decorateCanvas(studio,studio.__advancedDiagram || initialDiagram,modal);
    observe();
  };
  observer = new MutationObserver(() => {
    if (scheduled) return; scheduled = true; requestAnimationFrame(refresh);
  });
  observe(); refresh();
  const cleanup = new MutationObserver(() => { if (!document.body.contains(modal)) { observer.disconnect(); cleanup.disconnect(); } });
  cleanup.observe(document.body,{ childList:true,subtree:true });
}

const originalOpenEditor = DiagramStudio.prototype.openEditor;
DiagramStudio.prototype.openEditor = async function openAdvancedEditor(id) {
  await this.load();
  this.__advancedDiagram = this.diagrams.find(item => String(item.id) === String(id)) || null;
  const result = await originalOpenEditor.call(this,id);
  const modal = document.getElementById('diagram-editor-modal');
  if (modal) {
    const button = modal.querySelector('.add-node');
    if (button) button.innerHTML = '<i class="fas fa-plus-square"></i> Élément';
    installDecorationObserver(this,modal,this.__advancedDiagram);
  }
  return result;
};

DiagramStudio.prototype.openNodeForm = function openAdvancedNodeForm(diagram,onChange) {
  this.__advancedDiagram = diagram;
  const entityEntries = this.entities.filter(entry => entry.type !== 'cable');
  const targetDiagrams = this.diagrams.filter(item => String(item.id) !== String(diagram.id));
  const modal = modalShell('diagram-node-modal','Ajouter un élément au schéma',`<form class="diagram-form">
    <label>Type d’élément<select name="nodeType"><option value="entity">Entité existante</option><option value="boundary">Cadre / zone</option><option value="label">Texte libre</option><option value="off-page-reference">Renvoi hors page</option></select></label>
    <label class="node-entity-field">Entité<select name="entityKey"><option value="">Sélectionner…</option>${entityEntries.map(entry => `<option value="${esc(entry.key)}">${esc(entry.label)}</option>`).join('')}</select></label>
    <label>Libellé affiché<input name="label" required placeholder="Nom visible sur le schéma"></label>
    <label class="node-reference-field" hidden>Référence / page<input name="referenceText" placeholder="Ex. Suite sur RF2 — plan 4058"></label>
    <label class="node-target-field" hidden>Schéma cible<select name="targetDiagramId"><option value="">Aucun / référence externe</option>${targetDiagrams.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · Rév. ${esc(item.revision)}</option>`).join('')}</select></label>
    <label>Largeur %<input name="width" type="number" min="1" max="90" value="14"></label><label>Hauteur %<input name="height" type="number" min="1" max="90" value="9"></label>
    <div class="modal-actions span-2"><button type="button" class="btn gray cancel">Annuler</button><button class="btn" type="submit">Ajouter</button></div>
  </form>`);
  const form = modal.querySelector('form');
  const syncType = () => {
    const type = form.elements.nodeType.value;
    modal.querySelector('.node-entity-field').hidden = type !== 'entity';
    modal.querySelector('.node-reference-field').hidden = type !== 'off-page-reference';
    modal.querySelector('.node-target-field').hidden = type !== 'off-page-reference';
    if (type === 'boundary') { form.elements.width.value = 32; form.elements.height.value = 22; }
    else if (type === 'label') { form.elements.width.value = 20; form.elements.height.value = 5; }
    else if (type === 'off-page-reference') { form.elements.width.value = 18; form.elements.height.value = 8; }
    else { form.elements.width.value = 14; form.elements.height.value = 9; }
  };
  form.elements.nodeType.onchange = syncType; syncType();
  form.elements.entityKey.onchange = () => {
    const entry = entityEntries.find(item => item.key === form.elements.entityKey.value);
    if (entry && !form.elements.label.value) form.elements.label.value = entry.label.replace(/^.*? · /,'');
  };
  modal.querySelector('.cancel').onclick = () => modal.remove();
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const type = values.nodeType;
    const entry = type === 'entity' ? entityEntries.find(item => item.key === values.entityKey) : null;
    if (type === 'entity' && !entry) return this.notify('Sélectionnez une entité canonique.', 'warning');
    if (type === 'off-page-reference' && !values.referenceText && !values.targetDiagramId) return this.notify('Indiquez la page/référence ou choisissez un schéma cible.', 'warning');
    const index = diagram.nodes.length;
    const node = {
      id:makeId('node'), type, layerId:'main', label:values.label,
      entityRef:entry ? { type:entry.type,id:entry.id,parentEquipmentId:entry.parentEquipmentId || null,label:entry.label,verificationStatus:'documented' } : null,
      referenceText:values.referenceText || '', targetDiagramId:values.targetDiagramId || null,
      x:5 + (index * 13) % 70, y:8 + (index * 17) % 68,
      width:Number(values.width), height:Number(values.height), zIndex:type === 'boundary' ? 0 : 10,
      style:type === 'boundary'
        ? { borderColor:'#64748b',backgroundColor:'transparent',color:'#334155',icon:'' }
        : type === 'label'
          ? { borderColor:'transparent',backgroundColor:'transparent',color:'#153047',icon:'' }
          : type === 'off-page-reference'
            ? { borderColor:'#64748b',backgroundColor:'#ffffff',color:'#153047',icon:'external-link' }
            : { borderColor:'#0b6b96',backgroundColor:'#ffffff',color:'#153047',icon:'' }
    };
    diagram.nodes.push(node); modal.remove(); onChange();
    requestAnimationFrame(() => decorateCanvas(this,diagram,document.getElementById('diagram-editor-modal')));
  };
};

for (const methodName of ['openEdgeForm','openBackgroundForm']) {
  const original = DiagramStudio.prototype[methodName];
  DiagramStudio.prototype[methodName] = function advancedChangeAware(diagram,onChange,...rest) {
    this.__advancedDiagram = diagram;
    return original.call(this,diagram,() => {
      this.__advancedDiagram = diagram; onChange();
      requestAnimationFrame(() => decorateCanvas(this,diagram,document.getElementById('diagram-editor-modal')));
    },...rest);
  };
}

if (typeof window !== 'undefined') {
  window.DiagramStudioAdvanced = Object.freeze({ decorateCanvas, version:1 });
}

export { decorateCanvas };
