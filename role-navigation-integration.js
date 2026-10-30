import AdminUI from './admin-ui.js';
import TechUI from './techui.js';
import ResponsibleUI from './responsible-ui.js';
import Equipements from './equipements.js';
import Salles from './salles.js';
import Baies from './baies.js';
import LogsSection from './logsSection.js';
import { showTicketsPage } from './tickets.js';
import { eventSystem } from './events.js';
import { parseHashRoute, buildHashRoute } from './navigation-contract.js';

export const ROLE_NAVIGATION_INTEGRATION_VERSION = 1;
const PATCH_FLAG = Symbol.for('2m-tech.role-navigation-integration.v1');
const technicianComponents = new WeakMap();

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

function canonicalHash(section, query = {}) {
  return buildHashRoute({ section, query });
}

function syncHash(section, query = {}) {
  const next = canonicalHash(section, query);
  if (window.location.hash !== next) window.location.hash = next;
}

function normalizeAdminSection(ui, rawSection) {
  const hash = String(rawSection || '').startsWith('#') ? String(rawSection) : `#/${rawSection || ''}`;
  return parseHashRoute(hash, { role:'admin', allowedSections:Object.keys(ui.sections || {}), defaultSection:'dashboard' }).section;
}

function installAdminNavigation() {
  if (AdminUI.prototype[PATCH_FLAG]) return;
  const originalOpenTab = AdminUI.prototype.openTab;
  const originalBindEvents = AdminUI.prototype.bindEvents;

  AdminUI.prototype.openTab = function openCanonicalAdminTab(rawSection) {
    const section = normalizeAdminSection(this, rawSection);
    return originalOpenTab.call(this, section);
  };

  AdminUI.prototype.bindEvents = function bindCanonicalAdminEvents() {
    originalBindEvents.call(this);
    const ticketLink = document.querySelector('.admin-sidebar a[data-section="tickets"]');
    if (ticketLink && ticketLink.dataset.canonicalNav !== '1') {
      ticketLink.dataset.canonicalNav = '1';
      ticketLink.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.openTab('tickets');
      }, true);
    }
    queueMicrotask(() => {
      const route = parseHashRoute(window.location.hash, {
        role:'admin', allowedSections:Object.keys(this.sections || {}), defaultSection:'dashboard'
      });
      if (route.section !== this.currentSection) this.openTab(route.section);
    });
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

function installResponsibleNavigation() {
  if (ResponsibleUI.prototype[PATCH_FLAG]) return;
  const originalNavigate = ResponsibleUI.prototype.navigateToSection;
  const originalBindEvents = ResponsibleUI.prototype.bindEvents;

  ResponsibleUI.prototype.navigateToSection = async function navigateCanonicalResponsible(rawSection, options = {}) {
    const hash = String(rawSection || '').startsWith('#') ? String(rawSection) : `#/${rawSection || ''}`;
    const route = parseHashRoute(hash, {
      role:'responsible', allowedSections:Object.keys(this.sections || {}), defaultSection:'devices'
    });
    const result = await originalNavigate.call(this, route.section);
    if (options.syncHash !== false) syncHash(route.section, route.query);
    return result;
  };

  ResponsibleUI.prototype.bindEvents = function bindCanonicalResponsibleEvents() {
    originalBindEvents.call(this);
    queueMicrotask(() => {
      const route = parseHashRoute(window.location.hash, {
        role:'responsible', allowedSections:Object.keys(this.sections || {}), defaultSection:'devices'
      });
      this.navigateToSection(route.section, { syncHash:true });
    });
  };
  Object.defineProperty(ResponsibleUI.prototype, PATCH_FLAG, { value:true });
}

function techComponents(ui) {
  if (!technicianComponents.has(ui)) {
    technicianComponents.set(ui, {
      devices:new Equipements(ui.notifications),
      salles:new Salles(ui.notifications),
      baies:new Baies(ui.notifications),
      logs:new LogsSection(ui.notifications)
    });
  }
  return technicianComponents.get(ui);
}

function technicianRouteShell(title, body = '<div class="loading-spinner"><div class="spinner"></div></div>') {
  return `<div class="tech-route-view" style="min-height:100vh;background:var(--body-bg,#f5f7fa);padding:18px;box-sizing:border-box">
    <header class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">
      <div><button class="btn gray" id="tech-route-home"><i class="fas fa-arrow-left"></i> Tableau technicien</button></div>
      <h2 style="margin:0">${esc(title)}</h2>
      <div style="min-width:140px;text-align:right"><span class="badge">Lecture / opérations autorisées</span></div>
    </header>
    <main id="tech-route-content">${body}</main>
  </div>`;
}

function technicianMaintenanceMarkup(ui) {
  const tasks = Array.isArray(ui.state?.todayTasks) ? ui.state.todayTasks : [];
  return `<section class="card"><h3><i class="fas fa-tasks"></i> Tâches de maintenance</h3>
    <p>Les tâches locales du technicien sont affichées ici sans créer de faux enregistrements de maintenance dans l’inventaire.</p>
    <ul>${tasks.length ? tasks.map(task => `<li>${task.done ? '✓' : '○'} ${esc(task.text)}</li>`).join('') : '<li>Aucune tâche locale.</li>'}</ul>
  </section>`;
}

function technicianNotificationsMarkup(ui) {
  const items = Array.isArray(ui.state?.notifications) ? [...ui.state.notifications].reverse().slice(0, 100) : [];
  return `<section class="card"><h3><i class="fas fa-bell"></i> Notifications</h3>
    ${items.length ? `<div style="display:grid;gap:8px">${items.map(item => `<div style="padding:10px;border:1px solid var(--border-color,#e3e8ec);border-radius:9px"><strong>${esc(item.title || item.type || 'Notification')}</strong><div>${esc(item.message || item.text || item.details || '')}</div></div>`).join('')}</div>` : '<p>Aucune notification.</p>'}
  </section>`;
}

async function renderTechnicianRoute(ui) {
  const route = parseHashRoute(window.location.hash, { role:'technician', defaultSection:'dashboard' });
  if (route.section === 'dashboard') {
    ui.render();
    return route;
  }

  const titles = {
    devices:'Équipements', salles:'Salles', baies:'Baies', tickets:'Tickets & demandes',
    maintenance:'Maintenance', notifications:'Notifications', screens:'Écrans & diagnostic', logs:'Activités'
  };
  const app = document.getElementById('app');
  if (!app) return route;
  app.innerHTML = technicianRouteShell(titles[route.section] || route.section);
  document.getElementById('tech-route-home')?.addEventListener('click', () => syncHash('dashboard'));
  const content = document.getElementById('tech-route-content');

  try {
    if (route.section === 'tickets') {
      await showTicketsPage('tech-route-content');
    } else if (route.section === 'maintenance') {
      content.innerHTML = technicianMaintenanceMarkup(ui);
    } else if (route.section === 'notifications') {
      content.innerHTML = technicianNotificationsMarkup(ui);
    } else if (route.section === 'screens') {
      content.innerHTML = await ui.screensDiagnostic.render();
      await ui.screensDiagnostic.afterRender?.();
      if (route.entityId) await ui.screensDiagnostic.selectScreenById?.(route.entityId);
    } else {
      const component = techComponents(ui)[route.section];
      if (!component) throw new Error(`Section technicien non prise en charge: ${route.section}`);
      if (route.section === 'devices' && route.query.status) {
        const statusMap = { faulty:'Hors service', critical:'Hors service', maintenance:'Maintenance' };
        component.filters.statut = statusMap[route.query.status] || '';
      }
      content.innerHTML = await component.render();
      await component.afterRender?.();
      if (route.section === 'devices' && route.entityId) {
        queueMicrotask(() => window.TechOperations?.openEquipment360?.(route.entityId));
      }
    }
  } catch (error) {
    content.innerHTML = `<div class="error-message"><h3>Section indisponible</h3><p>${esc(error.message)}</p></div>`;
    ui.notifications?.showNotification?.(`Navigation technicien: ${error.message}`, 'error');
  }
  return route;
}

function installTechnicianNavigation() {
  if (TechUI.prototype[PATCH_FLAG]) return;
  const originalInit = TechUI.prototype.init;

  TechUI.prototype.bindGlobalActions = function bindCanonicalTechActions() {
    if (this._canonicalNavigationBound) return;
    this._canonicalNavigationBound = true;
    window.addEventListener('hashchange', async () => {
      await this.loadData();
      await renderTechnicianRoute(this);
    });
    eventSystem.register('dataUpdated', async () => {
      await this.loadData();
      await renderTechnicianRoute(this);
      this.notifications?.showNotification?.('Les données de la plateforme ont été actualisées.', 'info');
    });
  };

  TechUI.prototype.init = async function initWithCanonicalNavigation() {
    await originalInit.call(this);
    await renderTechnicianRoute(this);
  };
  TechUI.prototype.renderCanonicalRoute = function renderCanonicalRoute() { return renderTechnicianRoute(this); };
  Object.defineProperty(TechUI.prototype, PATCH_FLAG, { value:true });
}

installAdminNavigation();
installResponsibleNavigation();
installTechnicianNavigation();

if (typeof window !== 'undefined') {
  window.RoleNavigationIntegration = Object.freeze({
    version:ROLE_NAVIGATION_INTEGRATION_VERSION,
    renderTechnicianRoute
  });
}
