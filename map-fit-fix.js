import { getPlatformSettings } from './settings-contract.js';
import { resolveWorkspaceGeometry } from './map-coordinates-contract.js';

const LEGACY_MAP_WIDTH = 2000;
const LEGACY_MAP_HEIGHT = 1200;

/**
 * `CSSStyleDeclaration.setProperty` attend le nom CSS d'une propriété, pas son nom JS :
 * `setProperty('transformOrigin', …)` ne lève rien et n'écrit rien. Les appelants mélangent
 * les deux formes — `'object-fit'` en toutes lettres, mais `transformOrigin`, `minWidth`,
 * `maxHeight`, `willChange` en camelCase — si bien que la moitié des garde-fous posés ici
 * n'existaient pas.
 *
 * CE QUE CELA COÛTAIT
 * -------------------
 * `transform-origin: 0 0` n'était jamais appliqué. Les trois couches gardaient l'origine par
 * défaut, au centre, alors que `applyFit` calcule `left` et `top` pour une origine en haut à
 * gauche. À 1920, le plan partait donc à −128 px au lieu de 96 : coupé à gauche et en haut,
 * 320 px de vide à droite. Et surtout `#map-hotspots`, qui se ramène de 2000×1200 à
 * l'espace de travail par un `scale()`, se recentrait sur lui-même : les zones cliquables
 * se posaient 486 px à droite et 324 px sous le plan qu'elles désignent.
 *
 * La conversion rend simplement effectif ce que ces appels demandaient déjà. Aucune
 * coordonnée d'entité, aucune géométrie de hotspot, aucun modèle de pan ou de zoom, aucune
 * persistance n'est touché.
 */
const enKebab = propriete => propriete.replace(/[A-Z]/g, lettre => `-${lettre.toLowerCase()}`);

function setImportantStyles(element, styles) {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(enKebab(property), value, 'important');
  }
}

function forceViewport(modal, container) {
  const styles = {
    position:'fixed', inset:'0', left:'0', top:'0', right:'0', bottom:'0',
    width:'100dvw', height:'100dvh', minWidth:'100dvw', minHeight:'100dvh',
    maxWidth:'none', maxHeight:'none', margin:'0', padding:'0', overflow:'hidden',
    boxSizing:'border-box', transform:'none'
  };
  setImportantStyles(modal, styles);
  setImportantStyles(container, styles);
  setImportantStyles(modal, { 'z-index':'2147482000', background:'#101b24' });
  setImportantStyles(container, { background:'#101b24', 'touch-action':'none' });
}

function viewportSize() {
  const visual = window.visualViewport;
  return {
    width:Math.max(1, visual?.width || document.documentElement.clientWidth || window.innerWidth),
    height:Math.max(1, visual?.height || document.documentElement.clientHeight || window.innerHeight)
  };
}

function createStage(container, image, canvas, hotspots) {
  let stage = container.querySelector('#map-stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'map-stage';
    container.insertBefore(stage, container.firstChild);
    stage.append(image, canvas, hotspots);
  }
  setImportantStyles(stage, {
    position:'absolute', left:'0', top:'0', transformOrigin:'0 0', willChange:'transform', overflow:'visible'
  });
  image.draggable = false;
  image.style.userSelect = 'none';
  return stage;
}

function applyWorkspaceGeometry(stage, image, canvas, hotspots, width, height) {
  const workspaceWidth = Math.max(1, Math.round(width || LEGACY_MAP_WIDTH));
  const workspaceHeight = Math.max(1, Math.round(height || LEGACY_MAP_HEIGHT));
  stage.dataset.workspaceWidth = String(workspaceWidth);
  stage.dataset.workspaceHeight = String(workspaceHeight);
  setImportantStyles(stage, { width:`${workspaceWidth}px`, height:`${workspaceHeight}px` });

  setImportantStyles(image, {
    position:'absolute', left:'0', top:'0', width:`${workspaceWidth}px`, height:`${workspaceHeight}px`,
    minWidth:'0', minHeight:'0', maxWidth:'none', maxHeight:'none', transformOrigin:'0 0',
    'object-fit':'contain', transform:'none'
  });

  canvas.width = LEGACY_MAP_WIDTH;
  canvas.height = LEGACY_MAP_HEIGHT;
  setImportantStyles(canvas, {
    position:'absolute', left:'0', top:'0', width:`${workspaceWidth}px`, height:`${workspaceHeight}px`,
    minWidth:'0', minHeight:'0', maxWidth:'none', maxHeight:'none', transform:'none', transformOrigin:'0 0'
  });

  setImportantStyles(hotspots, {
    position:'absolute', left:'0', top:'0', width:`${LEGACY_MAP_WIDTH}px`, height:`${LEGACY_MAP_HEIGHT}px`,
    minWidth:'0', minHeight:'0', maxWidth:'none', maxHeight:'none',
    transform:`scale(${workspaceWidth / LEGACY_MAP_WIDTH}, ${workspaceHeight / LEGACY_MAP_HEIGHT})`, transformOrigin:'0 0'
  });

  return { width:workspaceWidth, height:workspaceHeight };
}

function ensureToolbar(modal, resetButton, refit, zoom100) {
  const toolbar = modal.querySelector('#map-toolbar');
  if (!toolbar) return;
  if (!toolbar.querySelector('#fit-map-btn')) {
    const button = document.createElement('button');
    button.id = 'fit-map-btn';
    button.className = 'btn gray';
    button.title = "Ajuster toute la carte à l'écran";
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<i class="fas fa-arrows-to-eye"></i>';
    button.onclick = event => { event.stopPropagation(); refit(true, true); };
    resetButton?.insertAdjacentElement('afterend', button);
  }
  if (!toolbar.querySelector('#map-100-btn')) {
    const button = document.createElement('button');
    button.id = 'map-100-btn';
    button.className = 'btn gray';
    button.title = 'Afficher le plan à 100 %';
    button.textContent = '100 %';
    button.onclick = event => { event.stopPropagation(); zoom100(); };
    toolbar.querySelector('#fit-map-btn')?.insertAdjacentElement('afterend', button);
  }
  Object.assign(toolbar.style, {
    position:'fixed', top:'18px', left:'50%', right:'auto', transform:'translateX(-50%)',
    zIndex:'2147482100', maxWidth:'calc(100vw - 32px)', overflowX:'auto', overflowY:'hidden',
    whiteSpace:'nowrap', boxSizing:'border-box'
  });
}

function ensureNavigationUI(container) {
  if (!container.querySelector('#map-navigation-hint')) {
    const hint = document.createElement('div');
    hint.id = 'map-navigation-hint';
    hint.innerHTML = '<i class="fas fa-hand"></i><span>Glisser : déplacer · Molette : zoomer · Ajuster : voir tout le plan</span>';
    Object.assign(hint.style, {
      position:'fixed', left:'20px', bottom:'18px', zIndex:'2147482050', display:'flex', alignItems:'center', gap:'9px',
      maxWidth:'min(560px,calc(100vw - 40px))', padding:'9px 13px', border:'1px solid rgba(255,255,255,.18)',
      borderRadius:'11px', background:'rgba(20,34,47,.82)', color:'#eef6fc', fontSize:'12px',
      boxShadow:'0 8px 26px rgba(0,0,0,.2)', backdropFilter:'blur(8px)', pointerEvents:'none'
    });
    container.appendChild(hint);
  }
  if (!container.querySelector('#map-fit-status')) {
    const badge = document.createElement('div');
    badge.id = 'map-fit-status';
    Object.assign(badge.style, {
      position:'fixed', right:'20px', bottom:'18px', zIndex:'2147482050', padding:'8px 12px', borderRadius:'10px',
      background:'rgba(20,34,47,.82)', border:'1px solid rgba(255,255,255,.16)', color:'#dcebf5', fontSize:'12px', pointerEvents:'none'
    });
    container.appendChild(badge);
  }
}

const fitInteractiveMap = async modal => {
  const container = modal?.querySelector('#map-container');
  const image = modal?.querySelector('#main-map-img');
  const canvas = modal?.querySelector('#areas-canvas');
  const hotspots = modal?.querySelector('#map-hotspots');
  if (!container || !image || !canvas || !hotspots) return;

  modal.__mapFitCleanup?.();
  forceViewport(modal, container);
  const stage = createStage(container, image, canvas, hotspots);
  const settings = await getPlatformSettings().catch(() => ({}));
  const state = {
    // Les réglages peuvent porter les dimensions d'une image de REMPLACEMENT — mesuré :
    // 4 × 4 px quand aucun plan n'est configuré. Les accepter faisait rendre toute la
    // carte dans une scène de quatre pixels agrandie 198 fois. Voir resolveWorkspaceGeometry.
    workspace: resolveWorkspaceGeometry({
      settingsWidth: settings.mapImageWidth, settingsHeight: settings.mapImageHeight,
      fallbackWidth: LEGACY_MAP_WIDTH, fallbackHeight: LEGACY_MAP_HEIGHT
    }),
    baseScale:1, zoom:1, displayScale:1, left:0, top:0, panX:0, panY:0,
    panning:false, pointerId:null, startX:0, startY:0, startPanX:0, startPanY:0
  };

  const updateGeometryFromImage = () => {
    // Une image de substitution ne définit pas l'espace de travail : sans ce filtre, un
    // pixel de remplacement de 4 × 4 devenait la taille du plan tout entier.
    const geometrie = resolveWorkspaceGeometry({
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      settingsWidth: state.workspace.width, settingsHeight: state.workspace.height,
      fallbackWidth: LEGACY_MAP_WIDTH, fallbackHeight: LEGACY_MAP_HEIGHT
    });
    state.workspace = applyWorkspaceGeometry(stage, image, canvas, hotspots, geometrie.width, geometrie.height);
    modal.dataset.mapWorkspaceWidth = String(state.workspace.width);
    modal.dataset.mapWorkspaceHeight = String(state.workspace.height);
  };

  const updateStatus = () => {
    const badge = container.querySelector('#map-fit-status');
    if (badge) badge.textContent = `${state.workspace.width} × ${state.workspace.height} px · vue ${Math.round(state.displayScale * 100)} % · zoom ${Math.round(state.zoom * 100)} %`;
  };

  const applyFit = (resetPan = false, resetZoom = false) => {
    forceViewport(modal, container);
    if (resetPan) { state.panX = 0; state.panY = 0; }
    if (resetZoom) state.zoom = 1;
    const viewport = viewportSize();
    const mobilePortrait = viewport.width < 760 && viewport.height > viewport.width;
    const marginX = mobilePortrait ? 8 : 20;
    const marginTop = mobilePortrait ? 62 : (viewport.height < 620 ? 68 : 82);
    const marginBottom = mobilePortrait ? 38 : (viewport.height < 620 ? 12 : 26);
    const usableWidth = Math.max(1, viewport.width - marginX * 2);
    const usableHeight = Math.max(1, viewport.height - marginTop - marginBottom);
    state.baseScale = Math.min(usableWidth / state.workspace.width, usableHeight / state.workspace.height);
    state.displayScale = state.baseScale * state.zoom;
    const renderedWidth = state.workspace.width * state.displayScale;
    const renderedHeight = state.workspace.height * state.displayScale;
    state.left = (viewport.width - renderedWidth) / 2;
    state.top = mobilePortrait ? marginTop + 8 : marginTop + (usableHeight - renderedHeight) / 2;
    stage.style.setProperty('transform', `translate3d(${state.left + state.panX}px,${state.top + state.panY}px,0) scale(${state.displayScale})`, 'important');
    modal.dataset.mapFitScale = String(state.baseScale);
    modal.dataset.mapDisplayScale = String(state.displayScale);
    modal.dataset.mapLayout = mobilePortrait ? 'mobile-portrait' : 'centered';
    updateStatus();
  };

  const zoomToActualSize = () => {
    state.zoom = Math.min(12, Math.max(.1, 1 / Math.max(.0001, state.baseScale)));
    state.panX = 0;
    state.panY = 0;
    applyFit(false, false);
  };

  const resetButton = modal.querySelector('#reset-zoom');
  ensureToolbar(modal, resetButton, applyFit, zoomToActualSize);
  ensureNavigationUI(container);

  const zoomBy = factor => {
    state.zoom = Math.min(12, Math.max(.25, state.zoom * factor));
    applyFit(false, false);
  };
  const zoomInButton = modal.querySelector('#zoom-in');
  const zoomOutButton = modal.querySelector('#zoom-out');
  if (zoomInButton) zoomInButton.onclick = event => { event.stopPropagation(); zoomBy(1.18); };
  if (zoomOutButton) zoomOutButton.onclick = event => { event.stopPropagation(); zoomBy(1 / 1.18); };
  if (resetButton) resetButton.onclick = event => { event.stopPropagation(); applyFit(true, true); };

  const isMapTarget = target => target instanceof Element
    && !target.closest('#map-toolbar,#map-search-results,#map-panel,.map-hotspot,button,input,select,textarea,a')
    && (target === container || target === stage || target === image || target === canvas || target === hotspots || Boolean(target.closest('#map-stage')));

  const onPointerDown = event => {
    if (event.button !== 0 || !isMapTarget(event.target)) return;
    if (modal.querySelector('#edit-mode-btn')?.classList.contains('success')) return;
    // Pendant l'édition d'une forme, le déplacement du plan doit céder le geste.
    //
    // `setPointerCapture` ci-dessous détourne TOUS les événements suivants vers le
    // conteneur : mesuré, le canevas recevait un `mousedown` puis plus rien, et le
    // `mouseup` était rapporté aux mêmes coordonnées que l'appui. Aucun tracé n'était
    // donc possible — ce qui condamnait déjà l'ancien dessin de zone.
    if (document.body.dataset.shapeEditing === '1') return;
    state.panning = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startPanX = state.panX;
    state.startPanY = state.panY;
    container.style.cursor = 'grabbing';
    try { container.setPointerCapture(event.pointerId); } catch {}
  };
  const onPointerMove = event => {
    if (!state.panning || event.pointerId !== state.pointerId) return;
    state.panX = state.startPanX + event.clientX - state.startX;
    state.panY = state.startPanY + event.clientY - state.startY;
    applyFit(false, false);
  };
  const stopPan = event => {
    if (!state.panning || (event?.pointerId !== undefined && event.pointerId !== state.pointerId)) return;
    state.panning = false;
    try { container.releasePointerCapture(state.pointerId); } catch {}
    state.pointerId = null;
    container.style.cursor = '';
  };
  const onWheel = event => {
    if (event.target instanceof Element && event.target.closest('#map-toolbar,#map-search-results,#map-panel')) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };
  const onDoubleClick = event => { if (isMapTarget(event.target)) applyFit(true, true); };
  const onViewportChange = () => requestAnimationFrame(() => applyFit(false, false));
  const onKeyDown = event => {
    if (!modal.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && event.key === '0') { event.preventDefault(); applyFit(true, true); }
    if ((event.ctrlKey || event.metaKey) && event.key === '1') { event.preventDefault(); zoomToActualSize(); }
  };
  const onImageLoad = () => { updateGeometryFromImage(); applyFit(true, true); };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', stopPan);
  container.addEventListener('pointercancel', stopPan);
  container.addEventListener('wheel', onWheel, { passive:false });
  container.addEventListener('dblclick', onDoubleClick);
  image.addEventListener('load', onImageLoad);
  document.addEventListener('fullscreenchange', onViewportChange);
  window.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.addEventListener('keydown', onKeyDown);
  const resizeObserver = new ResizeObserver(onViewportChange);
  resizeObserver.observe(document.documentElement);

  updateGeometryFromImage();
  requestAnimationFrame(() => applyFit(true, true));

  modal.__mapFitCleanup = () => {
    resizeObserver.disconnect();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', stopPan);
    container.removeEventListener('pointercancel', stopPan);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('dblclick', onDoubleClick);
    image.removeEventListener('load', onImageLoad);
    document.removeEventListener('fullscreenchange', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
    window.visualViewport?.removeEventListener('resize', onViewportChange);
    window.removeEventListener('keydown', onKeyDown);
  };
};

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const modal = node.id === 'map-modal' ? node : node.querySelector?.('#map-modal');
      if (modal) requestAnimationFrame(() => fitInteractiveMap(modal).catch(error => console.warn('Ajustement de la carte impossible.', error)));
    }
    for (const node of mutation.removedNodes) {
      if (node instanceof HTMLElement && node.id === 'map-modal') node.__mapFitCleanup?.();
    }
  }
});

if (typeof document !== 'undefined') {
  observer.observe(document.documentElement, { childList:true, subtree:true });
  const existing = document.getElementById('map-modal');
  if (existing) fitInteractiveMap(existing).catch(() => {});
}

export { fitInteractiveMap, LEGACY_MAP_WIDTH, LEGACY_MAP_HEIGHT, setImportantStyles };