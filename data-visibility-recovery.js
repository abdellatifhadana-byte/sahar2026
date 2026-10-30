import { db } from './db.js';
import { anyDirtyEditor } from './snapshot-diff-contract.js';

const SECTION_STORES = Object.freeze({
  devices:new Set(['equipments','cables']),
  salles:new Set(['rooms','baies','equipments','walls','screens']),
  baies:new Set(['baies','rooms','equipments']),
  cables:new Set(['cables','equipments','screens']),
  screensDiagnostic:new Set(['screens','screen_groups','screen_issues','diagnosis_history','rooms','walls']),
  diagrams:new Set(['docs','equipments','screens','cables','rooms','baies','walls']),
  continuity:new Set(['docs','equipments','screens','cables']),
  signalFlow:new Set(['docs','equipments','cables']),
  tickets:new Set(['tickets','equipments','rooms','baies','screens','walls']),
  reports:new Set(['equipments','rooms','baies','users','tickets','screens','cables']),
  settings:new Set(['settings'])
});
let previousSyncState = 'initial';
let pendingRefresh = false;
let refreshTimer = null;
let refreshInFlight = null;
let lastRefreshAt = 0;
let uiRetryCount = 0;

function activeUI() {
  const app = globalThis.__APP;
  if (!app?.UIs) return null;
  return app.UIs.admin || app.UIs.responsible || app.UIs.tech || app.UIs.visitor || null;
}

const FENETRES_EDITION = '#eq-modal, #edit-room-modal, #edit-baie-modal, #map-entity-edit-modal, #ticket-modal, #platform-quick-add-modal, #diagram-editor-modal, #diagram-node-modal, #diagram-edge-modal, #diagram-canonical-equipment-modal, #diagram-canonical-port-modal, #diagram-canonical-cable-modal';

/** Affichée à l'écran, et pas seulement présente dans le document. */
function estVisible(element) {
  if (!element) return false;
  if (typeof getComputedStyle !== 'function') return true;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return element.getClientRects().length > 0;
}

/**
 * UNE FENÊTRE PRÉSENTE N'EST PAS UNE FENÊTRE OUVERTE.
 *
 * Ce test décidait naguère sur la seule PRÉSENCE de `#eq-modal`, `#edit-room-modal`, … dans
 * le document. Or la page Équipements rend sa fenêtre d'édition À L'INTÉRIEUR de la section
 * (`equipements.js`, `${this.renderModal()}`), avec `style="display:none"`. Elle est donc
 * montée en permanence et cachée : le test répondait VRAI en permanence, et TOUT
 * rafraîchissement de `#/devices` était différé pour toujours. Un renommage distant entrait
 * en base, son événement partait — et l'écran gardait l'ancien nom jusqu'à un F5. Une
 * suppression distante laissait un fantôme cliquable.
 *
 * La protection des éditeurs n'est pas retirée : elle est fondée sur des faits.
 *
 *   · une fenêtre RÉELLEMENT VISIBLE bloque — la reconstruire détruirait le formulaire ;
 *   · une saisie DÉCLARÉE non enregistrée bloque, où qu'elle soit rendue ;
 *   · le plan interactif marqué « modifié » bloque, visible ou non : cette marque est une
 *     déclaration explicite du jumeau cartographique, pas une présomption.
 */
function hasBlockingEditor() {
  if (Array.from(document.querySelectorAll(FENETRES_EDITION)).some(estVisible)) return true;
  if (document.querySelector('#map-modal.map-digital-dirty')) return true;
  if (anyDirtyEditor()) return true;
  return Array.from(document.querySelectorAll('.modal')).some(modal => {
    if (modal.id === 'map-modal') return false;
    return estVisible(modal);
  });
}

function sectionNeedsStore(ui, storeName) {
  if (!ui || !storeName) return false;
  const section = ui.currentSection;
  if (!section) return Boolean(ui.state);
  if (section === 'dashboard') return ['equipments','rooms','baies','tickets','screens','screen_issues','notifications'].includes(storeName);
  const stores = SECTION_STORES[section];
  return stores ? stores.has(storeName) : false;
}

async function currentViewLooksStale(ui) {
  if (!ui) return false;
  const section = ui.currentSection;
  const stores = SECTION_STORES[section];
  if (stores?.size === 1) {
    const storeName = [...stores][0];
    const records = await db.getAll(storeName);
    const host = document.getElementById('admin-content') || document.getElementById('responsible-content');
    const visibleRows = Math.max(0, (host?.querySelectorAll('.tableau tr').length || 0) - 1);
    return records.length > 0 && visibleRows === 0;
  }

  if (ui.state && typeof ui.loadData === 'function') {
    const [equipments, rooms, baies] = await Promise.all([
      db.getAll('equipments'), db.getAll('rooms'), db.getAll('baies')
    ]);
    return (equipments.length > 0 && (ui.state.equipments?.length || 0) === 0)
      || (rooms.length > 0 && (ui.state.rooms?.length || 0) === 0)
      || (baies.length > 0 && (ui.state.baies?.length || 0) === 0);
  }

  const loading = document.querySelector('#admin-content .loading-spinner, #responsible-content .loading-spinner, .tech-loading-screen');
  return Boolean(loading);
}

async function refreshVisibleData(reason = 'sync-recovered') {
  if (refreshInFlight) return refreshInFlight;
  const now = Date.now();
  if (now - lastRefreshAt < 700) return;
  const ui = activeUI();
  if (!ui) {
    pendingRefresh = true;
    if (uiRetryCount < 8) {
      uiRetryCount += 1;
      scheduleRefresh(`${reason}-ui-ready`, Math.min(1200, 120 + uiRetryCount * 120));
    }
    return;
  }
  uiRetryCount = 0;
  if (hasBlockingEditor()) {
    pendingRefresh = true;
    return;
  }

  refreshInFlight = (async () => {
    try {
      if (typeof ui.loadSection === 'function' && ui.currentSection) {
        await ui.loadSection(ui.currentSection);
        if (typeof ui.updateStats === 'function') await ui.updateStats();
      } else if (typeof ui.loadData === 'function' && typeof ui.render === 'function') {
        await ui.loadData();
        if (typeof ui.renderCanonicalRoute === 'function') await ui.renderCanonicalRoute();
        else ui.render();
      }
      lastRefreshAt = Date.now();
      pendingRefresh = false;
      window.dispatchEvent(new CustomEvent('platform-data-visible', { detail:{ reason, refreshedAt:new Date().toISOString() } }));
    } catch (error) {
      pendingRefresh = true;
      console.warn('Rafraîchissement visuel des données différé.', error);
      if (uiRetryCount < 4) {
        uiRetryCount += 1;
        scheduleRefresh(`${reason}-retry`, 250 * uiRetryCount);
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function scheduleRefresh(reason, delay = 80) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshVisibleData(reason), delay);
}

async function verifyVisibleDataAfterSync() {
  const ui = activeUI();
  if (!ui) {
    pendingRefresh = true;
    scheduleRefresh('sync-before-ui-ready', 180);
    return;
  }
  if (hasBlockingEditor()) {
    pendingRefresh = true;
    return;
  }
  try {
    if (await currentViewLooksStale(ui)) scheduleRefresh('stale-view-after-sync', 40);
  } catch (error) {
    console.warn('Contrôle de visibilité des données impossible.', error);
  }
}

function refreshOpenDerivedViews(storeName) {
  if (['rooms','baies','equipments','walls','screens','cables','docs','tickets'].includes(storeName)) {
    Promise.resolve(globalThis.MapDigitalTwin?.refresh?.()).catch(error => console.warn('Actualisation du jumeau cartographique différée.', error));
  }
  window.dispatchEvent(new CustomEvent('platform-canonical-data-changed', { detail:{ storeName } }));
}

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    const state = event.detail?.state || '';
    const recovered = state === 'synced' && !['initial', 'synced'].includes(previousSyncState);
    previousSyncState = state || previousSyncState;
    if (recovered) scheduleRefresh('central-sync-recovered', 60);
    else if (state === 'synced') setTimeout(verifyVisibleDataAfterSync, 120);
  });

  window.addEventListener('platform-map-entity-updated', () => scheduleRefresh('map-entity-updated', 120));

  window.addEventListener('platform-entity-updated', event => {
    const storeName = event.detail?.storeName;
    refreshOpenDerivedViews(storeName);
    const ui = activeUI();
    if (sectionNeedsStore(ui, storeName)) scheduleRefresh(`canonical-${storeName}-updated`, 180);
  });

  /*
   * UNE SUPPRESSION DISTANTE SE RAFRAÎCHIT COMME UNE MODIFICATION.
   *
   * La plateforme n'avait d'événement que pour la sauvegarde. Une fiche supprimée ailleurs
   * quittait la base locale et RESTAIT à l'écran — un fantôme sur lequel on pouvait encore
   * cliquer, et dont le détail ouvert continuait de montrer une donnée qui n'existe plus.
   *
   * Le même relais qu'une modification suffit : les vues se reconstruisent depuis la base,
   * et ce qui n'y est plus n'y réapparaît pas. On y ajoute le cas d'une révocation d'accès —
   * la fiche n'est pas supprimée pour tout le monde, mais elle a quitté le périmètre
   * autorisé, et l'écran ne doit pas continuer de la montrer.
   */
  window.addEventListener('platform-entity-deleted', event => {
    const storeName = event.detail?.storeName;
    refreshOpenDerivedViews(storeName);
    const ui = activeUI();
    if (sectionNeedsStore(ui, storeName)) scheduleRefresh(`canonical-${storeName}-deleted`, 180);
  });

  window.addEventListener('focus', () => {
    if (pendingRefresh) scheduleRefresh('focus-after-data-change', 80);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingRefresh) scheduleRefresh('visible-after-data-change', 80);
  });

  // If a write arrives while a modal/editor is open we deliberately defer the
  // refresh. Resume it as soon as the blocking editor leaves the DOM.
  const editorObserver = new MutationObserver(() => {
    if (pendingRefresh && !hasBlockingEditor()) scheduleRefresh('editor-closed-with-pending-data', 100);
  });
  editorObserver.observe(document.documentElement, { childList:true, subtree:true });
  globalThis.__platformDataVisibilityObserver = editorObserver;
}

export { refreshVisibleData, currentViewLooksStale, sectionNeedsStore };