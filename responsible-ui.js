import { db } from './db.js';
import Equipements from './equipements.js';
import Salles from './salles.js';
import Baies from './baies.js';
import Rapports from './rapports.js';
import Users from './users.js';
import WallManager from './wall-manager.js';
import ScreensDiagnostic from './screens-diagnostic.js';
import openInteractiveMap from './interactive-map.js';
import { PermissionManager } from './permissions.js';
import { eventSystem } from './events.js';
import { roleLabel } from './roles.js';
import { showTicketsPage } from './tickets.js';

// Même règle que dans `admin-ui.js` : un nom de compte ou un titre de section est du
// texte, jamais du balisage. Ces titres viennent du registre, que quatre modules tiers
// enrichissent — les insérer bruts ferait de chacun d'eux une porte d'entrée.
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export default class ResponsibleUI {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.screensDiagnostic = new ScreensDiagnostic(notifications);
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
      }
    };
    if (PermissionManager.check(this.user, 'walls', 'view')) {
      this.sections.walls = {
        title: "Mur d'images",
        icon: 'fas fa-border-all',
        component: null
      };
    }
    Object.assign(this.sections, {
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
      tickets: {
        title: 'Tickets & demandes',
        icon: 'fas fa-life-ring',
        component: null
      },
      users: {
        title: 'Utilisateurs',
        icon: 'fas fa-users-cog',
        component: new Users(this.notifications)
      }
    });
    this.currentSection = 'devices';
    this.renderBaseLayout();
    this.bindEvents();
    this.loadSection(this.currentSection);
  }

  renderBaseLayout() {
    /*
     * LA MÊME EN-TÊTE QUE L'ADMINISTRATEUR, AVEC LES MÊMES REPÈRES.
     *
     * Elle disait « 2M TECH Platform - Responsable » et n'affichait qu'un nom : ni le rôle
     * en toutes lettres — que l'administrateur, lui, voit sous son nom — ni le bouton de
     * thème présent partout ailleurs. Le titre porte désormais le nom de la plateforme, et
     * le rôle est un libellé à part, pris dans `roles.js` : une seule source pour les six
     * intitulés, au lieu d'un mot recopié dans un gabarit.
     */
    const nomAffiche = this.user?.fullName || this.user?.username || '';
    document.getElementById('app').innerHTML = `
      <div class="responsible-page">
        <header class="responsible-header">
          <div><h1>2M TECH Platform</h1></div>
          <div style="flex:1"></div>
          <div class="responsible-header-actions">
            <button id="responsible-theme" class="btn gray" type="button" title="Basculer le thème" aria-label="Basculer le thème"><i class="fas fa-adjust"></i></button>
            <span class="user-badge" title="${escapeHTML(nomAffiche)}">${escapeHTML(nomAffiche)}</span>
            <span class="user-badge user-badge-role">${escapeHTML(roleLabel(this.user?.role))}</span>
            <button id="logout-btn" class="btn danger" type="button" title="Déconnexion" aria-label="Déconnexion"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </header>
        <aside class="responsible-sidebar">
          <nav class="sidebar-menu">
            <ul>
              ${Object.entries(this.sections).map(([key, val]) =>
                `<li>
                  <a href="#/${key}" data-section="${key}" class="${key === this.currentSection ? 'active' : ''}">
                    <i class="${escapeHTML(val.icon || 'fas fa-circle')}"></i> <span>${escapeHTML(val.title || key)}</span>
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
    // Le thème se bascule par l'événement central, celui que `core.js` écoute déjà : un
    // second commutateur local aurait fait diverger la classe du <body> et la préférence
    // enregistrée dès qu'on aurait basculé depuis un autre écran.
    document.getElementById('responsible-theme')?.addEventListener('click', () => eventSystem.dispatch('toggle-theme'));
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
      if (section === 'tickets') {
        await showTicketsPage('responsible-content');
        return;
      }
      if (section === 'walls') {
        await this.showWall();
        return;
      }
      const component = this.sections[section]?.component;
      if (!component) throw new Error('Section indisponible.');
      const sectionContent = await component.render();
      contentContainer.innerHTML = sectionContent;
      if (component.afterRender) await component.afterRender();
    } catch (error) {
      // Le message vient parfois du serveur : il est affiché comme du texte, et la page
      // dit LAQUELLE a échoué plutôt qu'un « Erreur » seul, qui n'aide personne.
      contentContainer.innerHTML = `<div class="error-message">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Échec de chargement : ${escapeHTML(this.sections[section]?.title || section)}</h3>
        <p>${escapeHTML(error.message)}</p>
        <button type="button" class="btn retry-btn">Réessayer</button>
      </div>`;
      contentContainer.querySelector('.retry-btn')?.addEventListener('click', () => this.loadSection(section));
    }
  }

  async showWall() {
    if (!PermissionManager.check(this.user, 'walls', 'view')) throw new Error("Vous n'êtes pas autorisé à consulter le mur d'images.");
    const contentContainer = document.getElementById('responsible-content');
    const manager = new WallManager({
      notifications: this.notifications,
      onBack: () => this.navigateToSection('salles'),
      onOpenDiagnostic: screenId => this.showScreenDiagnostic(screenId),
      onOpenMap: () => this.openWallMap()
    });
    contentContainer.innerHTML = await manager.render();
    await manager.afterRender();
  }

  async openWallMap() {
    const [rooms, baies, equipments] = await Promise.all([
      db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments')
    ]);
    openInteractiveMap({
      rooms,
      baies,
      equipments,
      user: this.user,
      notifications: this.notifications,
      onOpenWall: async roomId => {
        await db.setCurrentRoomId(roomId);
        document.getElementById('map-modal')?.remove();
        await this.navigateToSection('walls');
      },
      onClose: () => document.getElementById('map-modal')?.remove()
    });
  }

  async showScreenDiagnostic(screenId) {
    if (!PermissionManager.check(this.user, 'screens', 'diagnose')) {
      this.notifications?.showNotification("Vous n'êtes pas autorisé à diagnostiquer cet écran.", 'error');
      return;
    }
    const contentContainer = document.getElementById('responsible-content');
    contentContainer.innerHTML = `<div class="responsible-diagnostic-view"><button type="button" id="responsible-back-wall" class="btn gray" style="margin-bottom:12px;"><i class="fas fa-arrow-left"></i> Retour au mur d'images</button><div id="responsible-screen-diagnostic"></div></div>`;
    document.getElementById('responsible-back-wall').onclick = () => this.navigateToSection('walls');
    const host = document.getElementById('responsible-screen-diagnostic');
    host.innerHTML = await this.screensDiagnostic.render();
    await this.screensDiagnostic.afterRender?.();
    await this.screensDiagnostic.selectScreenById(screenId);
  }
}
