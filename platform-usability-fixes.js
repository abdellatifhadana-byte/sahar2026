import { db } from './db.js';
import Equipements from './equipements.js';
import AdminUI from './admin-ui.js';
import { EQUIPMENT_CATEGORIES } from './broadcast-ports-cables.js';
import { openTicketModal } from './tickets.js';
import './equipment-knowledge-compat.js';

const EXTRA_CATEGORIES = [
  'Poste de travail / Bureautique',
  'Caméra / Acquisition',
  'Production / Régie',
  'Impression / Périphériques',
  'Affichage / Moniteurs',
  'Mobilier / Accessoires techniques'
];
for (const category of EXTRA_CATEGORIES) {
  if (!EQUIPMENT_CATEGORIES.includes(category)) EQUIPMENT_CATEGORIES.push(category);
}

// Le modèle historique considère la baie comme facultative dans IndexedDB.
// On normalise donc explicitement les équipements hors rack au lieu de sauver baieId=0.
const saveBeforeLocationFix = db.save.bind(db);
db.save = async function saveWithOptionalRack(storeName, data) {
  if (storeName !== 'equipments') return saveBeforeLocationFix(storeName, data);
  const payload = { ...data };
  if (payload.baieId === '' || payload.baieId === 0 || payload.baieId === '0' || payload.baieId === undefined) {
    payload.baieId = null;
  }
  payload.placementMode = payload.baieId == null ? 'hors-rack' : 'rack';
  return saveBeforeLocationFix(storeName, payload);
};

const showEquipmentBeforeLocationFix = Equipements.prototype.showEquipementModal;
Equipements.prototype.showEquipementModal = async function showEquipmentWithOptionalRack(equipement = null) {
  await showEquipmentBeforeLocationFix.call(this, equipement);
  const form = document.getElementById('eq-form');
  if (!form) return;
  const rack = form.elements.baieId;
  if (rack) {
    rack.required = false;
    const first = rack.querySelector('option[value=""]');
    if (first) first.textContent = 'Aucun rack — équipement hors baie';
    rack.setAttribute('aria-label', 'Rack facultatif');
    rack.title = 'Facultatif : laissez « Aucun rack » pour un PC, téléphone, caméra, écran, imprimante ou autre équipement posé hors baie.';
  }
};

function waitFor(selector, timeout = 1800) {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const started = Date.now();
    const timer = setInterval(() => {
      const node = document.querySelector(selector);
      if (node || Date.now() - started >= timeout) {
        clearInterval(timer);
        resolve(node || null);
      }
    }, 45);
  });
}

function closeQuickAdd() {
  document.getElementById('platform-quick-add-modal')?.remove();
}

function openQuickAdd(ui) {
  closeQuickAdd();
  const modal = document.createElement('div');
  modal.id = 'platform-quick-add-modal';
  modal.className = 'platform-quick-add-backdrop';
  modal.innerHTML = `
    <section class="platform-quick-add-card" role="dialog" aria-modal="true" aria-label="Ajouter un élément">
      <header>
        <div><strong>Ajouter un élément</strong><small>Choisissez ce que vous souhaitez créer.</small></div>
        <button type="button" class="platform-quick-add-close" aria-label="Fermer">×</button>
      </header>
      <div class="platform-quick-add-grid">
        <button data-create="equipment"><i class="fas fa-server"></i><span>Équipement</span><small>Avec ou sans rack</small></button>
        <button data-create="room"><i class="fas fa-door-open"></i><span>Salle</span><small>Nouvel espace</small></button>
        <button data-create="rack"><i class="fas fa-cube"></i><span>Baie / Rack</span><small>Dans une salle</small></button>
        <button data-create="ticket"><i class="fas fa-life-ring"></i><span>Ticket</span><small>Incident ou demande</small></button>
        <button data-create="handover"><i class="fas fa-book-open"></i><span>Passation</span><small>Main courante</small></button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.platform-quick-add-close').onclick = closeQuickAdd;
  modal.addEventListener('mousedown', event => { if (event.target === modal) closeQuickAdd(); });
  modal.querySelectorAll('[data-create]').forEach(button => {
    button.onclick = async () => {
      const type = button.dataset.create;
      closeQuickAdd();
      if (type === 'equipment') {
        ui.openTab('devices');
        await waitFor('#admin-content');
        setTimeout(() => ui.sections.devices.component.openAddForm?.(), 80);
        return;
      }
      if (type === 'room') {
        ui.openTab('salles');
        const input = await waitFor('#add-salle-form input[name="name"]');
        input?.focus();
        return;
      }
      if (type === 'rack') {
        ui.openTab('baies');
        const input = await waitFor('#add-baie-form input[name="name"]');
        input?.focus();
        return;
      }
      if (type === 'ticket') {
        ui.openTab('tickets');
        await waitFor('#tickets-list-container');
        openTicketModal({});
        return;
      }
      if (type === 'handover') {
        window.TechOperations?.openCenter?.();
        const field = await waitFor('#ops-handover-form textarea[name="summary"]');
        field?.focus();
      }
    };
  });
}

const quickActionBeforeFix = AdminUI.prototype.handleQuickAction;
AdminUI.prototype.handleQuickAction = function handleQuickActionReliable(action) {
  if (action === 'add') return openQuickAdd(this);
  return quickActionBeforeFix.call(this, action);
};

const renderLayoutBeforeSidebarFix = AdminUI.prototype.renderLayout;
AdminUI.prototype.renderLayout = function renderLayoutWithSidebarState() {
  renderLayoutBeforeSidebarFix.call(this);
  const page = document.querySelector('.admin-page');
  const sidebar = document.querySelector('.admin-sidebar');
  if (localStorage.getItem('2mtech-sidebar-closed') === '1') {
    page?.classList.add('sidebar-closed');
    sidebar?.classList.add('collapsed');
  }
};

const bindEventsBeforeSidebarFix = AdminUI.prototype.bindEvents;
AdminUI.prototype.bindEvents = function bindEventsWithRealSidebarClose() {
  bindEventsBeforeSidebarFix.call(this);
  const button = document.getElementById('menu-toggle');
  const page = document.querySelector('.admin-page');
  const sidebar = document.querySelector('.admin-sidebar');
  button?.addEventListener('click', () => {
    const closed = sidebar?.classList.contains('collapsed') ?? false;
    page?.classList.toggle('sidebar-closed', closed);
    localStorage.setItem('2mtech-sidebar-closed', closed ? '1' : '0');
  });
};

export { EXTRA_CATEGORIES };
