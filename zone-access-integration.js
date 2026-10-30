import AdminUI from './admin-ui.js';
import ResponsibleUI from './responsible-ui.js';
import TechUI from './techui.js';
import VisitorUI from './visitor-ui.js';
import ZoneAccessManager, { openAccessRequestModal } from './zone-access.js';
import { eventSystem } from './events.js';

const adminInitSections = AdminUI.prototype.initSections;
AdminUI.prototype.initSections = function initSectionsWithZoneAccess() {
  const sections = adminInitSections.call(this);
  sections.zoneAccess = {
    title: 'Accès zones',
    icon: 'fas fa-user-shield',
    component: new ZoneAccessManager(this.notifications)
  };
  return sections;
};

const responsibleRenderBaseLayout = ResponsibleUI.prototype.renderBaseLayout;
ResponsibleUI.prototype.renderBaseLayout = function renderResponsibleWithZoneAccess() {
  if (!this.sections.zoneAccess) {
    this.sections.zoneAccess = {
      title: 'Accès de ma zone',
      icon: 'fas fa-user-shield',
      component: new ZoneAccessManager(this.notifications)
    };
  }
  // Le responsable ne gère plus les comptes globaux; il gère seulement les accès de ses zones.
  delete this.sections.users;
  return responsibleRenderBaseLayout.call(this);
};

const techRender = TechUI.prototype.render;
TechUI.prototype.render = function renderTechWithZoneAccess() {
  const result = techRender.call(this);
  const headerActions = document.querySelector('.smart-tech-header .header-actions');
  if (headerActions && !document.getElementById('btn-zone-access')) {
    const button = document.createElement('button');
    button.className = 'btn gray';
    button.id = 'btn-zone-access';
    button.innerHTML = '<i class="fas fa-user-shield"></i> Mes accès';
    button.addEventListener('click', () => openAccessRequestModal(this.user, this.notifications));
    headerActions.insertBefore(button, headerActions.firstChild);
  }
  return result;
};

const visitorShowSplash = VisitorUI.prototype.showSplash;
VisitorUI.prototype.showSplash = function showVisitorWithZoneAccess() {
  const result = visitorShowSplash.call(this);
  const enter = document.getElementById('enter-map-btn');
  if (enter && !document.getElementById('visitor-access-btn')) {
    const button = document.createElement('button');
    button.id = 'visitor-access-btn';
    button.className = 'btn';
    button.style.cssText = 'margin-top:12px;background:#34495e;color:#fff;border-radius:14px;';
    button.innerHTML = '<i class="fas fa-user-shield"></i> Mes accès / Demander un accès';
    button.onclick = () => openAccessRequestModal(this.user, this.notifications);
    enter.insertAdjacentElement('afterend', button);
  }
  return result;
};

// Toutes les interfaces doivent terminer la session centrale, y compris Visiteur.
VisitorUI.prototype.logout = function secureVisitorLogout() {
  eventSystem.dispatch('logout');
};

export { ZoneAccessManager, openAccessRequestModal };
