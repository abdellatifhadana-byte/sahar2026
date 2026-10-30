import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { buildEquipmentRelationSummary } from './equipment-relations-360.js';
import { normalizeNavigationRole, allowedSectionsForRole, buildHashRoute } from './navigation-contract.js';

export const EQUIPMENT_CONTEXT_ACTIONS_VERSION = 1;

const asArray = value => Array.isArray(value) ? value : [];
const same = (left, right) => left != null && right != null && String(left) === String(right);
const label = equipment => equipment?.name || equipment?.nom || equipment?.modele || `#${equipment?.id ?? '?'}`;

function ticketTouchesEquipment(ticket, equipment) {
  const targetId = ticket?.relatedId ?? ticket?.targetId ?? ticket?.entityId ?? null;
  const targetType = String(ticket?.relatedType || ticket?.targetType || ticket?.type || 'equipment').toLowerCase();
  return same(targetId, equipment.id) && ['equipment','equipement','device'].includes(targetType);
}

export function buildEquipmentContextActionPlan(equipment, summary, {
  user = {}, equipments = [], tickets = []
} = {}) {
  if (!equipment) return Object.freeze({ actions:Object.freeze([]), linkedTickets:0, childModules:0 });
  const role = normalizeNavigationRole(user?.role);
  const allowed = new Set(allowedSectionsForRole(role));
  const childModules = asArray(equipments).filter(item =>
    same(item.hostEquipmentId, equipment.id) && item.entityKind === 'module-card'
  ).length;
  const components = asArray(equipment.components).length + childModules;
  const ports = asArray(equipment.ports).length;
  const cables = asArray(summary?.connectedCables).length;
  const diagrams = asArray(summary?.diagrams).length;
  const topology = asArray(summary?.routers).length + asArray(summary?.mappedRouterPorts).length;
  const locationReady = Boolean(summary?.location?.valid && summary?.location?.room?.id != null);
  const linkedTickets = asArray(tickets).filter(ticket => ticketTouchesEquipment(ticket, equipment)).length;
  const actions = [];

  if (locationReady) actions.push({ id:'map', label:'Localiser sur la carte', icon:'fa-map-marker-alt', count:null, kind:'map' });
  if (ports) actions.push({ id:'ports', label:'Ports physiques', icon:'fa-plug', count:ports, kind:'local' });
  if (cables) actions.push({ id:'cables', label:'Câblage réel', icon:'fa-link', count:cables, kind:'local' });
  if (components) actions.push({ id:'components', label:'Composants / modules', icon:'fa-microchip', count:components, kind:'local' });
  if (diagrams && role !== 'visitor') actions.push({ id:'diagrams', label:'Schémas liés', icon:'fa-project-diagram', count:diagrams, kind:'library' });
  if (topology && role === 'admin' && allowed.has('signalFlow')) {
    actions.push({ id:'signal-flow', label:'Flux de signal', icon:'fa-random', count:topology, kind:'route', section:'signalFlow' });
  }
  actions.push({ id:'new-ticket', label:'Créer un ticket lié', icon:'fa-life-ring', count:null, kind:'ticket' });

  return Object.freeze({
    role,
    actions:Object.freeze(actions.map(action => Object.freeze(action))),
    linkedTickets,
    childModules,
    counts:Object.freeze({ ports, cables, components, diagrams, topology })
  });
}

function injectStyles() {
  if (document.getElementById('equipment-context-actions-styles')) return;
  const style = document.createElement('style');
  style.id = 'equipment-context-actions-styles';
  style.textContent = `
    .ops-context-actions{display:grid;gap:10px}.ops-context-action-grid{display:flex;flex-wrap:wrap;gap:8px}
    .ops-context-action{display:inline-flex;align-items:center;gap:7px}.ops-context-action .ops-context-count{min-width:20px;height:20px;padding:0 6px;border-radius:999px;display:inline-grid;place-items:center;background:rgba(40,116,166,.12);font-size:11px;font-weight:800}
    .ops-context-meta{font-size:12px;color:var(--text-muted,#667783)}
  `;
  document.head.appendChild(style);
}

function notify(message, type = 'info', notifications = null) {
  if (notifications?.showNotification) return notifications.showNotification(message, type);
  return window.AppDialog?.notice?.(message, type);
}

function scrollToSelector(modal, selector, notifications) {
  const target = modal.querySelector(selector);
  if (!target) {
    notify('La relation existe dans les données mais son panneau est encore en cours de chargement.', 'warning', notifications);
    return false;
  }
  (target.closest('.ops-card') || target).scrollIntoView({ behavior:'smooth', block:'center' });
  const card = target.closest('.ops-card') || target;
  card.animate?.([{ outline:'3px solid rgba(40,116,166,.55)' }, { outline:'0 solid transparent' }], { duration:1100, easing:'ease-out' });
  return true;
}

async function openEquipmentLocation(equipment, summary, modal, user, notifications) {
  const roomId = summary?.location?.room?.id;
  const baieId = summary?.location?.baie?.id;
  if (roomId == null) return notify('Emplacement canonique non résolu.', 'warning', notifications);
  const [rooms, baies, equipments, walls, mapModule] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments'), db.getAll('walls'), import('./interactive-map.js')
  ]);
  const openInteractiveMap = mapModule.default;
  modal.remove();
  openInteractiveMap({ rooms, baies, equipments, walls, user, notifications });

  document.getElementById('welcome-start-btn')?.click();

  /*
   * ON NAVIGUE PAR LE MODÈLE, PLUS PAR LE DOM.
   *
   * Cette fonction cherchait le repère de la salle ou de la baie parmi les nœuds rendus, au
   * niveau où l'on se trouvait, puis le cliquait. Elle dépendait donc de ce que le plan
   * général affichait à cet instant — et depuis qu'il ne pose plus les baies, elle ne
   * trouvait plus rien : un équipement monté en baie n'était plus localisable du tout.
   *
   * `localiserSurCarte` descend jusqu'à la scène qui CONTIENT l'équipement — sa baie s'il
   * en a une, sa salle sinon — et l'y désigne par un halo temporaire. On vise désormais
   * l'ÉQUIPEMENT lui-même, et non plus le contenant : c'est lui que l'utilisateur cherche.
   */
  const localise = await mapModule.localiserSurCarte('equipment', equipment.id);
  if (localise) {
    notify(`Emplacement ouvert : ${summary.breadcrumb}.`, 'info', notifications);
    return;
  }
  // Repli : la salle ou la baie, quand l'équipement lui-même n'a pas de point exploitable.
  const replié = await mapModule.localiserSurCarte(baieId != null ? 'baie' : 'room', baieId != null ? baieId : roomId);
  notify(replié
    ? `Emplacement ouvert : ${summary.breadcrumb}.`
    : 'La salle ou la baie est documentée mais ne possède pas encore de point exploitable sur la carte.',
    replié ? 'info' : 'warning', notifications);
}

async function loadContext(equipment) {
  const [rooms, baies, walls, screens, cables, docs, equipments, tickets] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('walls'), db.getAll('screens'),
    db.getAll('cables'), db.getAll('docs'), db.getAll('equipments'), db.getAll('tickets')
  ]);
  const summary = buildEquipmentRelationSummary(equipment, {
    rooms, baies, walls, screens, cables, docs, equipments, continuityRecords:docs
  });
  return { summary, equipments, tickets };
}

async function equipmentFromModal(modal) {
  const id = modal?.dataset?.equipmentId;
  if (!id) return null;
  return db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
}

export async function enhanceEquipment360ContextActions(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.contextActions360 === '1') return false;
  const equipment = await equipmentFromModal(modal);
  if (!equipment) return false;
  const user = getCurrentUser() || {};
  const notifications = window.__APP?.notifications || null;
  const { summary, equipments, tickets } = await loadContext(equipment);
  const plan = buildEquipmentContextActionPlan(equipment, summary, { user, equipments, tickets });
  const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
  if (!target) return false;

  injectStyles();
  const card = document.createElement('section');
  card.className = 'ops-card ops-context-actions';
  card.innerHTML = `<div><h3><i class="fas fa-compass"></i> Actions contextuelles</h3><p class="ops-card-sub">Seules les actions reliées à des données ou à un workflow réellement disponible sont proposées.</p></div>`;
  const grid = document.createElement('div');
  grid.className = 'ops-context-action-grid';
  for (const action of plan.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn gray ops-context-action';
    button.dataset.contextAction = action.id;
    const icon = document.createElement('i');
    icon.className = `fas ${action.icon}`;
    const text = document.createElement('span');
    text.textContent = action.label;
    button.append(icon, text);
    if (action.count != null) {
      const count = document.createElement('span');
      count.className = 'ops-context-count';
      count.textContent = String(action.count);
      button.appendChild(count);
    }
    grid.appendChild(button);
  }
  const meta = document.createElement('div');
  meta.className = 'ops-context-meta';
  meta.textContent = `${plan.linkedTickets} ticket(s) déjà lié(s) · ${summary.breadcrumb}`;
  card.append(grid, meta);
  target.prepend(card);

  grid.addEventListener('click', async event => {
    const button = event.target.closest('[data-context-action]');
    if (!button) return;
    const id = button.dataset.contextAction;
    try {
      if (id === 'map') return await openEquipmentLocation(equipment, summary, modal, user, notifications);
      if (id === 'ports') return scrollToSelector(modal, '.ops-port-integrations', notifications);
      if (id === 'cables') return scrollToSelector(modal, '.ops-flow', notifications);
      if (id === 'components') return scrollToSelector(modal, '.ops-component-integrations, .ops-module-integrations', notifications);
      if (id === 'diagrams') {
        const { openDiagramLibrary } = await import('./diagram-studio.js');
        return await openDiagramLibrary(user, notifications);
      }
      if (id === 'signal-flow') {
        modal.remove();
        window.location.hash = buildHashRoute({ section:'signalFlow' });
        return;
      }
      if (id === 'new-ticket') {
        const { openTicketModal } = await import('./tickets.js');
        return await openTicketModal({
          type:'equipment', id:equipment.id, requestKind:'incident',
          subject:`Incident — ${label(equipment)}`,
          description:`Équipement concerné : ${label(equipment)}.\nEmplacement : ${summary.breadcrumb}.`
        });
      }
    } catch (error) {
      console.error('Action contextuelle Fiche 360 impossible', error);
      notify(error.message || 'Action indisponible.', 'error', notifications);
    }
  });

  modal.dataset.contextActions360 = '1';
  return true;
}

function schedule(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceEquipment360ContextActions(modal).catch(() => {}));
  setTimeout(() => enhanceEquipment360ContextActions(modal).catch(() => {}), 160);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.contextActions360Observer === '1') return;
  host.dataset.contextActions360Observer = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule(existing);
}

if (typeof window !== 'undefined') {
  installObserver();
  window.EquipmentContextActions = Object.freeze({
    version:EQUIPMENT_CONTEXT_ACTIONS_VERSION,
    enhance:enhanceEquipment360ContextActions,
    buildPlan:buildEquipmentContextActionPlan
  });
}
