import { db } from './db.js';
import Equipements from './equipements.js';
import Salles from './salles.js';
import Baies from './baies.js';
import Rapports from './rapports.js';
import Users from './users.js';
import { eventSystem } from './events.js';

export default class ResponsibleUI {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.sections = {
      devices: {
        title: 'Équipements',
        icon: 'fas fa-server',
        component: new Equipements(this.notifications)
      },
      salles: {
        title: 'Salles',
        icon: 'fas fa-door-open',
        component: new Salles(this.notifications)
      },
      baies: {
        title: 'Baies',
        icon: 'fas fa-cube',
        component: new Baies(this.notifications)
      },
      reports: {
        title: 'Rapports',
        icon: 'fas fa-chart-bar',
        component: new Rapports(this.notifications)
      },
      users: {
        title: 'Utilisateurs',
        icon: 'fas fa-users-cog',
        component: new Users(this.notifications)
      }
    };
    this.currentSection = 'devices';
    this.renderBaseLayout();
    this.bindEvents();
    this.loadSection(this.currentSection);
  }

  renderBaseLayout() {
    document.getElementById('app').innerHTML = `
      <div class="responsible-page">
        <header class="responsible-header">
          <div><h1>2M TECH Platform - Responsable</h1></div>
          <div style="flex:1"></div>
          <div>
            <span class="user-badge">${this.user.fullName || this.user.username}</span>
            <button id="logout-btn" class="btn danger" title="Déconnexion"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </header>
        <aside class="responsible-sidebar">
          <nav class="sidebar-menu">
            <ul>
              ${Object.entries(this.sections).map(([key, val]) =>
                `<li>
                  <a href="#/${key}" data-section="${key}" class="${key === this.currentSection ? 'active' : ''}">
                    <i class="${val.icon}"></i> ${val.title}
                  </a>
                </li>`
              ).join('')}
            </ul>
          </nav>
        </aside>
        <main class="responsible-content" id="responsible-content">
          <div class="loading-spinner"><div class="spinner"></div><p>Chargement...</p></div>
        </main>
      </div>
    `;
  }

  bindEvents() {
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.getAttribute('data-section');
        this.navigateToSection(section);
      });
    });
    document.getElementById('logout-btn').addEventListener('click', () => {
      eventSystem.dispatch('logout');
    });
    window.addEventListener('hashchange', () => {
      const section = window.location.hash.substring(2) || 'devices';
      this.navigateToSection(section);
    });
  }

  async navigateToSection(section) {
    if (!this.sections[section]) section = 'devices';
    this.currentSection = section;
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('data-section') === section) link.classList.add('active');
    });
    document.title = `${this.sections[section].title} | 2M TECH`;
    await this.loadSection(section);
  }

  async loadSection(section) {
    const contentContainer = document.getElementById('responsible-content');
    contentContainer.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Chargement...</p></div>`;
    try {
      const sectionContent = await this.sections[section].component.render();
      contentContainer.innerHTML = sectionContent;
      if (this.sections[section].component.afterRender) {
        await this.sections[section].component.afterRender();
      }
    } catch (error) {
      contentContainer.innerHTML = `<div class="error-message"><h3>Erreur</h3><p>${error.message}</p></div>`;
    }
  }
}
