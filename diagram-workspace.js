import DiagramStudio from './diagram-studio.js';

const PATCH = Symbol.for('2m-tech.diagram-large-workspace');
const same = (a,b) => a != null && b != null && String(a) === String(b);

function installWorkspace(studio, modal, diagramId) {
  const toolbar = modal.querySelector('.diagram-toolbar');
  const wrap = modal.querySelector('.diagram-canvas-wrap');
  const canvas = modal.querySelector('.diagram-canvas');
  if (!toolbar || !wrap || !canvas || toolbar.querySelector('.diagram-workspace-controls')) return;

  const state = { scale:1, fit:true, renderQueued:false };
  const controls = document.createElement('div');
  controls.className = 'diagram-workspace-controls';
  controls.innerHTML = `
    <button type="button" class="btn gray" data-workspace="fit" title="Ajuster le schéma"><i class="fas fa-arrows-to-eye"></i> Ajuster</button>
    <button type="button" class="btn gray" data-workspace="out" title="Zoom arrière"><i class="fas fa-search-minus"></i></button>
    <button type="button" class="btn gray" data-workspace="actual" title="Taille logique 100 %">100 %</button>
    <button type="button" class="btn gray" data-workspace="in" title="Zoom avant"><i class="fas fa-search-plus"></i></button>
    <span class="diagram-workspace-status" data-workspace-status></span>`;
  toolbar.appendChild(controls);

  const diagram = () => studio.__advancedDiagram || studio.diagrams.find(item => same(item.id, diagramId));
  const dimensions = () => ({
    width:Math.max(1, Math.min(50000, Number(diagram()?.background?.width) || 2000)),
    height:Math.max(1, Math.min(50000, Number(diagram()?.background?.height) || 1200))
  });
  const fitScale = () => {
    const { width, height } = dimensions();
    const availableWidth = Math.max(280, wrap.clientWidth - 30);
    const availableHeight = Math.max(420, Math.min(window.innerHeight * .68, 760));
    return Math.min(1, availableWidth / width, availableHeight / height);
  };
  const render = () => {
    state.renderQueued = false;
    const { width, height } = dimensions();
    if (state.fit) state.scale = fitScale();
    state.scale = Math.max(.02, Math.min(4, state.scale));
    const targetWidth = `${Math.max(1, width * state.scale)}px`;
    const targetHeight = `${Math.max(1, height * state.scale)}px`;
    const targetAspect = `${width}/${height}`;
    if (canvas.style.getPropertyValue('width') !== targetWidth) canvas.style.setProperty('width', targetWidth, 'important');
    if (canvas.style.getPropertyValue('height') !== targetHeight) canvas.style.setProperty('height', targetHeight, 'important');
    if (canvas.style.getPropertyValue('min-width') !== '0px') canvas.style.setProperty('min-width', '0', 'important');
    if (canvas.style.getPropertyValue('aspect-ratio') !== targetAspect) canvas.style.setProperty('aspect-ratio', targetAspect, 'important');
    canvas.dataset.workspaceScale = String(state.scale);
    const status = controls.querySelector('[data-workspace-status]');
    const statusText = `${width} × ${height} · ${Math.round(state.scale * 100)} %`;
    if (status && status.textContent !== statusText) status.textContent = statusText;
  };
  const scheduleRender = () => {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(render);
  };

  controls.querySelector('[data-workspace="fit"]').onclick = () => { state.fit = true; render(); };
  controls.querySelector('[data-workspace="actual"]').onclick = () => { state.fit = false; state.scale = 1; render(); wrap.scrollTo({ left:0, top:0, behavior:'smooth' }); };
  controls.querySelector('[data-workspace="in"]').onclick = () => { state.fit = false; state.scale *= 1.2; render(); };
  controls.querySelector('[data-workspace="out"]').onclick = () => { state.fit = false; state.scale /= 1.2; render(); };

  const onWheel = event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    state.fit = false;
    state.scale *= event.deltaY < 0 ? 1.12 : 1 / 1.12;
    render();
  };
  wrap.addEventListener('wheel', onWheel, { passive:false });

  // The editor rebuilds canvas children whenever nodes/background change. Watching
  // childList is enough to react to those changes without observing our own style
  // writes, which would otherwise create a render feedback loop.
  const observer = new MutationObserver(scheduleRender);
  observer.observe(canvas, { childList:true, subtree:false });
  const resizeObserver = new ResizeObserver(() => { if (state.fit) scheduleRender(); });
  resizeObserver.observe(wrap);
  render();

  const cleanupObserver = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      observer.disconnect();
      resizeObserver.disconnect();
      wrap.removeEventListener('wheel', onWheel);
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(document.body, { childList:true, subtree:true });
}

if (!DiagramStudio.prototype[PATCH]) {
  const previousOpenEditor = DiagramStudio.prototype.openEditor;
  DiagramStudio.prototype.openEditor = async function openEditorWithLargeWorkspace(id) {
    const result = await previousOpenEditor.call(this, id);
    const modal = document.getElementById('diagram-editor-modal');
    if (modal) installWorkspace(this, modal, id);
    return result;
  };
  Object.defineProperty(DiagramStudio.prototype, PATCH, { value:true });
}

if (typeof window !== 'undefined') window.DiagramWorkspace = Object.freeze({ version:1 });
