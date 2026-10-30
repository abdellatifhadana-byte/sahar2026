import { db } from './db.js';
import Users from './users.js';
import Salles from './salles.js';
import Baies from './baies.js';
import Equipements from './equipements.js';
import Rapports from './rapports.js';
import SystemSettings from './system-settings.js';
import LogsSection from './LogsSection.js';
import { PermissionManager } from './permissions.js';
import { eventSystem } from './events.js';
import Dashboard from './dashboard.js';
import openInteractiveMap from './interactive-map.js';
import { showTicketsList, openTicketModal } from './tickets.js';
import ScreensDiagnostic from './screens-diagnostic.js'; // Import the ScreensDiagnostic class
import { generateQR } from './qr.js'; // Ensure QR utility is imported if used elsewhere or needed here directly

export default class AdminUI {
  constructor(user, notifications, backupService) {
    this.user = user;
    this.notifications = notifications;
    this.backupService = backupService;
    this.tabs = [];
    this.currentSection = 'dashboard';
    this.sections = this.initSections();
    this.renderLayout();
    this.bindEvents();
    this.loadSection(this.currentSection);
    this.updateStats();
    this.initTheme();
  }

  initSections() {
    return {
      dashboard: { title: 'Dashboard', icon: 'fas fa-tachometer-alt' },
      screensDiagnostic: { title: 'Diagnostic Écrans', icon: 'fas fa-tv', component: new ScreensDiagnostic(this.notifications) }, // Added ScreensDiagnostic
      devices: { title: 'Équipements', icon: 'fas fa-server', component: new Equipements(this.notifications) },
      salles: { title: 'Salles', icon: 'fas fa-door-open', component: new Salles(this.notifications) },
      baies: { title: 'Baies', icon: 'fas fa-cube', component: new Baies(this.notifications) },
      users: { title: 'Utilisateurs', icon: 'fas fa-users-cog', component: new Users(this.notifications) },
      reports: { title: 'Rapports', icon: 'fas fa-chart-bar', component: new Rapports(this.notifications) },
      tickets: { title: 'Tickets', icon: 'fas fa-life-ring' },
      logs: { title: 'Logs', icon: 'fas fa-clipboard-list', component: new LogsSection(this.notifications) },
      settings: { title: 'Paramètres', icon: 'fas fa-cogs', component: new SystemSettings(this.notifications, this.backupService) }
    };
  }

  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="admin-page">
        <header class="admin-header">
          <div style="display:flex;align-items:center;gap:16px;">
            <button id="menu-toggle" class="btn-icon"><i class="fas fa-bars"></i></button>
            <h1 id="platform-title">2M TECH Platform</h1>
          </div>
          <div class="header-center" style="flex:1;text-align:center;">
            <input type="text" id="global-search" placeholder="Recherche rapide..." autocomplete="off">
          </div>
          <div class="header-right" style="display:flex;align-items:center;gap:14px;">
            <button id="open-map-btn" class="btn btn-map" title="Plan interactif">
              <i class="fas fa-map"></i> Carte interactive
            </button>
            <button id="quick-theme" class="btn gray" title="Basculer le thème">
              <i class="fas fa-adjust"></i>
            </button>
            <div class="user-avatar">${this.user.fullName ? this.user.fullName.charAt(0).toUpperCase() : (this.user.username ? this.user.username.charAt(0).toUpperCase() : '?')}</div>
            <div class="user-info">
              <span class="user-name">${this.user.fullName || this.user.username || ''}</span>
              <span class="user-role">${this.user.role}</span>
            </div>
            <button id="logout-btn" class="btn danger" title="Déconnexion"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </header>
        <aside class="admin-sidebar">
          <nav class="sidebar-menu">
            <ul>
              ${Object.entries(this.sections).map(([key, val]) =>
                `<li>
                  <a href="#/${key}" data-section="${key}" class="${key === this.currentSection ? 'active' : ''}">
                    <i class="${val.icon}"></i> <span>${val.title}</span>
                  </a>
                </li>`
              ).join('')}
            </ul>
            <div class="system-status">
              <i class="fas fa-circle"></i>
              <span>En ligne</span>
            </div>
          </nav>
        </aside>
        <div class="admin-tabs" id="admin-tabs">
          <div class="tabs-container"></div>
          <button class="btn-icon close-all-tabs" title="Fermer tous les onglets">
            <i class="fas fa-times-circle"></i>
          </button>
        </div>
        <main class="admin-content" id="admin-content">
          <div class="loading-spinner"><div class="spinner"></div><p>Chargement...</p></div>
        </main>
        <div class="quick-actions">
          <div class="quick-actions-menu">
            <button id="quick-add" class="quick-action-btn main-action" title="Actions rapides">
              <i class="fas fa-bolt"></i>
            </button>
            <div class="quick-actions-dropdown">
              <button class="quick-action-item" data-action="search"><i class="fas fa-search"></i>Recherche</button>
              <button class="quick-action-item" data-action="add"><i class="fas fa-plus"></i>Ajouter</button>
              <button class="quick-action-item" data-action="backup"><i class="fas fa-save"></i>Backup</button>
              <button class="quick-action-item" data-action="export"><i class="fas fa-download"></i>Exporter</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Sidebar navigation & tickets
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.getAttribute('data-section');
        if (section === 'tickets') {
          this.tabs.push('tickets');
          this.renderTabs();
          this.showTicketsSection();
        } else {
          this.openTab(section);
        }
        // Sidebar auto-collapse after selection on mobile
        if (window.innerWidth < 700) {
          document.querySelector('.admin-sidebar').classList.add('collapsed');
        }
      });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => eventSystem.dispatch('logout'));
    // Global Search
    document.getElementById('global-search').addEventListener('input', (e) => this.handleGlobalSearch(e.target.value));
    // Menu
    document.getElementById('menu-toggle').addEventListener('click', () =>
      document.querySelector('.admin-sidebar').classList.toggle('collapsed'));
    // Theme
    document.getElementById('quick-theme').addEventListener('click', () => this.toggleTheme());
    // Map
    document.getElementById('open-map-btn').addEventListener('click', async () => {
      if (document.getElementById('map-modal')) return;
      const [rooms, baies, equipments] = await Promise.all([
        db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments')
      ]);
      openInteractiveMap({
        rooms, baies, equipments,
        user: this.user,
        notifications: this.notifications,
        onClose: () => document.getElementById('map-modal')?.remove()
      });
    });
    // Tabs
    document.querySelector('.close-all-tabs').addEventListener('click', () => {
      this.tabs = [];
      this.renderTabs();
      this.openTab('dashboard');
    });
    // Quick actions
    document.getElementById('quick-add').addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelector('.quick-actions-dropdown').classList.toggle('show');
    });
    document.querySelectorAll('.quick-action-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleQuickAction(btn.dataset.action);
        document.querySelector('.quick-actions-dropdown').classList.remove('show');
      });
    });
    // Close dropdowns on click out
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-actions-menu')) {
        document.querySelector('.quick-actions-dropdown').classList.remove('show');
      }
    });
    // Hash navigation
    window.addEventListener('hashchange', () => {
      const section = window.location.hash.substring(2) || 'dashboard';
      this.openTab(section);
    });
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        document.getElementById('global-search').focus();
      }
      if (e.key === 'Escape') {
        document.getElementById('global-search').value = '';
        this.loadSection(this.currentSection);
      }
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        this.toggleTheme();
      }
    });
  }

  openTab(section) {
    if (!this.sections[section]) section = 'dashboard';
    if (!this.tabs.includes(section)) {
      this.tabs.push(section);
      if (this.tabs.length > 7) this.tabs.shift();
    }
    this.currentSection = section;
    window.location.hash = `#/${section}`;
    this.renderTabs();
    this.loadSection(section);
  }

  renderTabs() {
    const tabsContainer = document.querySelector('.tabs-container');
    tabsContainer.innerHTML = this.tabs.map(section => `
      <div class="tab ${section === this.currentSection ? 'active' : ''}" data-section="${section}">
        <i class="${this.sections[section].icon}"></i>
        <span>${this.sections[section].title}</span>
        <button class="btn-icon close-tab"><i class="fas fa-times"></i></button>
      </div>
    `).join('');
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (!e.target.closest('.close-tab')) {
          this.openTab(tab.dataset.section);
        }
      });
      tab.querySelector('.close-tab').addEventListener('click', (e) => {
        e.stopPropagation();
        this.tabs = this.tabs.filter(t => t !== tab.dataset.section);
        this.renderTabs();
        if (tab.dataset.section === this.currentSection) {
          const last = this.tabs.length ? this.tabs[this.tabs.length - 1] : 'dashboard';
          this.openTab(last);
        }
      });
    });
  }

  async loadSection(section) {
    if (section === 'tickets') {
      this.showTicketsSection();
      return;
    }
    const container = document.getElementById('admin-content');
    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Chargement de ${this.sections[section].title}...</p></div>`;
    try {
      if (section === 'dashboard') {
        new Dashboard(container);
      } else if (!this.sections[section].component) {
        container.innerHTML = `<div class="card"><h2>Bienvenue sur la plateforme 2M TECH !</h2></div>`;
      } else {
        const html = await this.sections[section].component.render();
        container.innerHTML = html;
        if (this.sections[section].component.afterRender) {
          await this.sections[section].component.afterRender();
        }
      }
    } catch (error) {
      container.innerHTML = `
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Échec de chargement: ${this.sections[section].title}</h3>
          <p>${error.message}</p>
          <button class="btn retry-btn">Réessayer</button>
        </div>
      `;
      document.querySelector('.retry-btn').addEventListener('click', () => this.loadSection(section));
    }
  }

  // هنا واجهة التذاكر المتطورة!
  showTicketsSection() {
    const container = document.getElementById('admin-content');
    container.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h2 style="margin:0;">Tickets Support</h2>
          <button class="btn" id="add-ticket-btn" style="background:linear-gradient(90deg,#2874a6 0%,#16a085 100%);font-weight:700;box-shadow:0 2px 10px #d3eaf2;border-radius:8px;">
            <i class="fas fa-plus"></i> Nouvelle demande
          </button>
        </div>
        <div id="tickets-list-container"></div>
      </div>
    `;
    // عرض قائمة التذاكر
    showTicketsList({ target: 'tickets-list-container' });
    // زر إضافة تذكرة جديدة
    document.getElementById('add-ticket-btn').onclick = () => {
      openTicketModal({});
      // إعادة تحميل قائمة التذاكر بعد الإرسال أو الإغلاق
      setTimeout(() => showTicketsList({ target: 'tickets-list-container' }), 1200);
    };
  }

  /* ========== GLOBAL SEARCH ========== */
  async handleGlobalSearch(query) {
    if (!query || query.length < 2) {
      this.loadSection(this.currentSection);
      return;
    }
    const container = document.getElementById('admin-content');
    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Recherche...</p></div>`;
    const results = [];
    // أجهزة
    const eqs = await db.getAll('equipments');
    results.push(...eqs.filter(e =>
      (e.name || '').toLowerCase().includes(query.toLowerCase()) ||
      (e.numSerie || '').toLowerCase().includes(query.toLowerCase())
    ).map(e => ({ ...e, _type: 'Équipement', _section: 'devices' })));
    // غرف
    const salles = await db.getAll('rooms');
    results.push(...salles.filter(r =>
      (r.name || '').toLowerCase().includes(query.toLowerCase())
    ).map(r => ({ ...r, _type: 'Salle', _section: 'salles' })));
    // بايات
    const baies = await db.getAll('baies');
    results.push(...baies.filter(b =>
      (b.name || '').toLowerCase().includes(query.toLowerCase())
    ).map(b => ({ ...b, _type: 'Baie', _section: 'baies' })));
    // مستخدمين
    const users = await db.getAll('users');
    results.push(...users.filter(u =>
      (u.username || '').toLowerCase().includes(query.toLowerCase()) ||
      (u.fullName || '').toLowerCase().includes(query.toLowerCase())
    ).map(u => ({ ...u, _type: 'Utilisateur', _section: 'users' })));
    // شاشات
    const screens = await db.getAll('screens');
    results.push(...screens.filter(s =>
      (s.name || '').toLowerCase().includes(query.toLowerCase()) ||
      (s.location || '').toLowerCase().includes(query.toLowerCase())
    ).map(s => ({ ...s, _type: 'Écran', _section: 'screensDiagnostic' })));

    let html = `<div class="card"><h3>Résultats pour "${query}"</h3>`;
    if (results.length) {
      html += `<ul class="search-list">`;
      results.forEach(item => {
        html += `<li>
          <span class="badge badge-type">${item._type}</span>
          <a href="#" class="go-to-section" data-section="${item._section}" data-id="${item.id}">
            ${item.name || item.username || item.fullName}
          </a>
        </li>`;
      });
      html += `</ul>`;
    } else {
      html += `<div style="color:#a00;">Aucun résultat trouvé.</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
    document.querySelectorAll('.go-to-section').forEach(a => {
      a.onclick = (e) => {
        e.preventDefault();
        const section = a.getAttribute('data-section');
        this.openTab(section);
      };
    });
  }

  handleQuickAction(action) {
    if (action === 'search') {
      document.getElementById('global-search').focus();
    }
    if (action === 'add') {
      if (this.currentSection && this.sections[this.currentSection]?.component?.openAddForm) {
        this.sections[this.currentSection].component.openAddForm();
      } else {
        this.notifications.showNotification('Ajout rapide non disponible pour cette section', 'info');
      }
    }
    if (action === 'backup') {
      this.backupService.exportToFile();
      this.notifications.showNotification('Backup créé avec succès', 'success');
    }
    if (action === 'export') {
      this.handleExportAll();
    }
  }

  async handleExportAll() {
    try {
      const [rooms, baies, equipments, users, rapports, screens, screenIssues] = await Promise.all([
        db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments'), db.getAll('users'), db.getAll('rapports'),
        db.getAll('screens'), db.getAll('screen_issues') // Added screens and screen_issues
      ]);
      const data = {
        rooms, baies, equipments, users, rapports, screens, screenIssues, // Included new data
        exportedAt: new Date().toISOString(),
        exportedBy: this.user.username
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `2mtech-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      this.notifications.showNotification('Export JSON réussi !', 'success');
    } catch (e) {
      this.notifications.showNotification('Erreur export: ' + e.message, 'error');
    }
  }

  async updateStats() {
    try {
      const [equipments, rooms, baies, users, screens] = await Promise.all([ // Added screens
        db.count('equipments'),
        db.count('rooms'),
        db.count('baies'),
        db.count('users'),
        db.count('screens') // Count screens
      ]);
      // يمكنك تطوير عرض إحصائيات سريعة في لوحة التحكم
    } catch (error) { }
  }

  /* ========== THEME ========== */
  initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.classList.add(`${savedTheme}-theme`);
  }
  toggleTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    document.body.classList.toggle('dark-theme', !isDark);
    document.body.classList.toggle('light-theme', isDark);
    const newTheme = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    this.notifications.showNotification(
      `Thème ${newTheme === 'dark' ? 'sombre' : 'clair'} activé`,
      'success'
    );
  }
}