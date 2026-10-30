import { db } from './db.js';
import Users from './users.js';
import Salles from './salles.js';
import Baies from './baies.js';
import Equipements from './equipements.js';
import Rapports from './rapports.js';
import SystemSettings from './system-settings.js';
import LogsSection from './logsSection.js';
import WallManager from './wall-manager.js';
import { PermissionManager } from './permissions.js';
import { allowedSectionsForRole } from './navigation-contract.js';
import { groupSections, groupOfSection, revealGroupOf, sectionTrail } from './navigation-groups.js';
import { normalizeRole, roleLabel } from './roles.js';
import { eventSystem } from './events.js';
import Dashboard from './dashboard.js';
import openInteractiveMap, { closeInteractiveMap } from './interactive-map.js';
import { showTicketsList, openTicketModal } from './tickets.js';
import ScreensDiagnostic from './screens-diagnostic.js'; // Import the ScreensDiagnostic class
import { generateQR } from './qr.js'; // Ensure QR utility is imported if used elsewhere or needed here directly

// Toute valeur issue des données ou de la saisie utilisateur est échappée avant
// insertion dans innerHTML : un nom d'équipement ou de salle est du texte, jamais du balisage.
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

/**
 * Ne garde du registre que les sections autorisées au rôle.
 *
 * L'administrateur répond de tout : son registre n'est pas filtré, ce qui évite qu'une
 * section nouvellement enregistrée disparaisse de son menu tant que le contrat de
 * navigation n'a pas été mis à jour. Pour les autres rôles, le contrat fait foi.
 */
function filterSectionsForRole(sections, role) {
  const canonique = normalizeRole(role);
  if (canonique === 'admin') return sections;
  const autorisees = new Set(allowedSectionsForRole(canonique));
  const retenues = {};
  for (const [cle, valeur] of Object.entries(sections || {})) {
    if (autorisees.has(cle)) retenues[cle] = valeur;
  }
  // Un registre vide priverait le rôle de toute navigation : mieux vaut le registre
  // complet et des refus explicites qu'un écran sans issue.
  return Object.keys(retenues).length ? retenues : sections;
}

export default class AdminUI {
  constructor(user, notifications, backupService) {
    this.user = user;
    this.notifications = notifications;
    this.backupService = backupService;
    this.tabs = [];
    this.currentSection = 'dashboard';
    // Le menu était bâti sur TOUTES les sections enregistrées, quel que soit le rôle.
    // Manager et Chef partagent cette interface : sans filtrage, le menu leur proposait
    // « Paramètres » et « Accès zones » — mesuré dans le navigateur — alors que le contrat
    // de navigation ne les leur accorde pas. Un menu qui propose ce qui sera refusé est
    // une promesse non tenue.
    //
    // Le filtrage a lieu APRÈS `initSections()`, donc après toutes les couches qui
    // enrichissent le registre : le faire avant n'aurait vu que les sections d'origine.
    this.sections = filterSectionsForRole(this.initSections(), this.user?.role);
    this.currentSection = this.sections[this.currentSection] ? this.currentSection
      : (Object.keys(this.sections)[0] || 'dashboard');
    this.renderLayout();
    // La section ouverte EST un onglet dès le premier rendu.
    //
    // Sans ces deux lignes, la bande naissait vide puis recevait son premier onglet au
    // premier clic : le contenu descendait d'un cran sous les yeux de l'utilisateur, une
    // fois par session. La bande a désormais une hauteur fixe ET un contenu dès
    // l'ouverture — la position du contenu ne change plus jamais d'elle-même.
    this.tabs = [this.currentSection];
    this.renderTabs();
    this.bindEvents();
    this.watchContextBar();
    this.loadSection(this.currentSection);
    this.updateStats();
    this.initTheme();
  }

  initSections() {
    return {
      dashboard: { title: 'Tableau de bord', icon: 'fas fa-tachometer-alt' },
      screensDiagnostic: { title: 'Diagnostic Écrans', icon: 'fas fa-tv', component: new ScreensDiagnostic(this.notifications) }, // Added ScreensDiagnostic
      walls: { title: "Mur d'images", icon: 'fas fa-border-all', component: null },
      devices: { title: 'Équipements', icon: 'fas fa-server', component: new Equipements(this.notifications) },
      salles: { title: 'Salles', icon: 'fas fa-door-open', component: new Salles(this.notifications) },
      baies: { title: 'Baies', icon: 'fas fa-cube', component: new Baies(this.notifications) },
      users: { title: 'Utilisateurs', icon: 'fas fa-users-cog', component: new Users(this.notifications) },
      reports: { title: 'Rapports', icon: 'fas fa-chart-bar', component: new Rapports(this.notifications) },
      tickets: { title: 'Tickets', icon: 'fas fa-life-ring' },
      logs: { title: 'Journal', icon: 'fas fa-clipboard-list', component: new LogsSection(this.notifications) },
      settings: { title: 'Paramètres', icon: 'fas fa-cogs', component: new SystemSettings(this.notifications, this.backupService) }
    };
  }

  /**
   * Le repli est mémorisé PAR UTILISATEUR : deux personnes partageant un poste n'ont pas
   * le même travail, et imposer à l'une les groupes repliés par l'autre est une gêne
   * gratuite.
   */
  get groupStorageKey() {
    return `2m-nav-groups:${this.user?.username || 'anonyme'}`;
  }

  readCollapsedGroups() {
    try {
      const brut = JSON.parse(localStorage.getItem(this.groupStorageKey) || '[]');
      return new Set(Array.isArray(brut) ? brut.map(String) : []);
    } catch { return new Set(); }
  }

  writeCollapsedGroups(replies) {
    try { localStorage.setItem(this.groupStorageKey, JSON.stringify([...replies])); }
    catch { /* stockage refusé : le repli ne survivra pas au rechargement, sans plus. */ }
  }

  /**
   * Le menu, groupé. Les intertitres sont des <button> et jamais des <a> : `ticket-nav-fix`
   * et `french-ui-guard` sélectionnent `.sidebar-menu a[data-section]`, qui doit continuer
   * à ne rendre que les sections.
   */
  renderMenuGroups() {
    // Le groupe de la section ouverte est déplié, ET oublié du repli mémorisé : ainsi
    // « ce qui est mémorisé » et « ce qui est affiché » ne peuvent pas diverger. Se
    // retrouver sur une page dont l'entrée de menu est cachée ne laisse aucun moyen de
    // comprendre où l'on est.
    const replies = revealGroupOf(this.readCollapsedGroups(), this.currentSection);
    this.writeCollapsedGroups(replies);
    return groupSections(Object.keys(this.sections)).map(groupe => {
      const replie = replies.has(groupe.id);
      const entete = `<li class="nav-group">
                  <button class="nav-group-header" type="button" data-group="${groupe.id}" aria-expanded="${replie ? 'false' : 'true'}">
                    <i class="${groupe.icon}"></i>
                    <span>${escapeHTML(groupe.title)}</span>
                    <i class="fas fa-chevron-down nav-group-chevron"></i>
                  </button>
                </li>`;
      const entrees = groupe.sections.map(key => {
        const val = this.sections[key] || {};
        return `<li class="nav-item" data-group="${groupe.id}"${replie ? ' hidden' : ''}>
                  <a href="#/${key}" data-section="${key}" class="${key === this.currentSection ? 'active' : ''}">
                    <i class="${val.icon || 'fas fa-circle'}"></i> <span>${escapeHTML(val.title || key)}</span>
                  </a>
                </li>`;
      }).join('');
      return entete + entrees;
    }).join('');
  }

  /**
   * Rend visible l'entrée de menu d'une section, en dépliant son groupe au besoin.
   *
   * Le menu est construit AVANT que la route ne soit lue — `currentSection` vaut encore
   * « dashboard » à ce moment-là. Vérifier au rendu ne suffit donc pas : mesuré, arriver
   * sur `#/devices` avec « Parc technique » replié ouvrait bien la page, mais son entrée
   * restait cachée.
   */
  revealSectionInMenu(section) {
    const groupe = groupOfSection(section);
    const replies = this.readCollapsedGroups();
    if (!replies.has(groupe)) return;
    this.writeCollapsedGroups(revealGroupOf(replies, section));
    document.querySelector(`.nav-group-header[data-group="${groupe}"]`)
      ?.setAttribute('aria-expanded', 'true');
    document.querySelectorAll(`.sidebar-menu li.nav-item[data-group="${groupe}"]`)
      .forEach(item => { item.hidden = false; });
  }

  /** Replie ou déplie un groupe, et retient le choix. */
  toggleMenuGroup(groupId) {
    const entete = document.querySelector(`.nav-group-header[data-group="${groupId}"]`);
    if (!entete) return;
    const replie = entete.getAttribute('aria-expanded') === 'true';
    entete.setAttribute('aria-expanded', replie ? 'false' : 'true');
    document.querySelectorAll(`.sidebar-menu li.nav-item[data-group="${groupId}"]`)
      .forEach(item => { item.hidden = replie; });
    const replies = this.readCollapsedGroups();
    if (replie) replies.add(groupId); else replies.delete(groupId);
    this.writeCollapsedGroups(replies);
  }

  /**
   * LA COUCHE DE CONTEXTE — où l'on se trouve, en une ligne, au-dessus du contenu.
   *
   * POURQUOI ELLE VIT DANS `#admin-content`
   * ---------------------------------------
   * `#admin-content` porte une marge gauche qui suit la largeur de la barre latérale, et
   * cette largeur change à chaque palier : 236 px, puis 74, puis 52, puis 46. Mesuré.
   * Poser la barre de contexte À CÔTÉ du contenu obligerait à recopier ces quatre paliers
   * dans une seconde règle — deux géométries à tenir d'accord à la main, exactement le genre
   * de doublon qui finit par diverger. Placée DEDANS, elle hérite de la bonne marge sans
   * qu'aucun chiffre ne soit répété.
   *
   * En contrepartie, `loadSection()` remplace tout le contenu du conteneur : la barre doit
   * donc être reposée après chaque rendu. C'est le rôle de l'appel en fin de `loadSection`
   * et en fin de `showTicketsSection`.
   *
   * CE QU'ELLE N'AFFICHE PAS
   * ------------------------
   * L'entité ouverte — salle, baie, appareil. Les sections n'exposent pas encore de
   * « sélection courante » de façon uniforme ; l'inventer ici reviendrait à afficher une
   * position que personne n'a déclarée. Le chemin complet jusqu'à l'appareil existe déjà,
   * dans la Fiche 360, et se raccordera ici quand l'Inspector unifié le fournira.
   */
  renderContextBar(section = this.currentSection) {
    const contenu = document.getElementById('admin-content');
    if (!contenu) return null;
    contenu.querySelector(':scope > .context-bar')?.remove();

    const titres = Object.fromEntries(
      Object.entries(this.sections || {}).map(([cle, valeur]) => [cle, valeur?.title]));
    const chemin = sectionTrail(section, titres);
    if (!chemin.length) return null;

    const barre = document.createElement('nav');
    barre.className = 'context-bar';
    barre.setAttribute('aria-label', 'Contexte');
    barre.innerHTML = chemin.map((maillon, index) => {
      const dernier = index === chemin.length - 1;
      const icone = maillon.icon ? `<i class="${escapeHTML(maillon.icon)}"></i>` : '';
      // Le dernier maillon est la page ouverte : en faire un lien renverrait l'utilisateur
      // là où il est déjà.
      return dernier
        ? `<span class="ctx-crumb is-current" aria-current="page">${escapeHTML(maillon.label)}</span>`
        : `<span class="ctx-crumb is-group">${icone}${escapeHTML(maillon.label)}</span>`;
    }).join('<i class="ctx-sep" aria-hidden="true">›</i>');

    contenu.prepend(barre);
    return barre;
  }

  /**
   * Certaines sections se rendent en DEUX temps : `loadSection` se termine, puis un
   * `afterRender` asynchrone remplace à nouveau tout le contenu. Mesuré sur « Équipements » :
   * la barre posée en fin de `loadSection` avait disparu 500 ms plus tard, et ne revenait
   * qu'au rechargement suivant — donc par accident.
   *
   * Plutôt que de courir après chaque chemin de rendu, présent ou futur, on surveille le
   * conteneur : dès que la barre manque, elle est reposée. La reposer déclenche
   * l'observateur une fois de plus, mais la barre est alors présente et le second passage ne
   * fait rien — il n'y a donc pas de boucle.
   */
  watchContextBar() {
    if (this._observateurContexte) return this._observateurContexte;
    const contenu = document.getElementById('admin-content');
    if (!contenu || typeof MutationObserver === 'undefined') return null;
    this._observateurContexte = new MutationObserver(() => {
      if (!contenu.querySelector(':scope > .context-bar')) this.renderContextBar();
    });
    this._observateurContexte.observe(contenu, { childList: true });
    return this._observateurContexte;
  }

  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="admin-page">
        <header class="admin-header">
          <div style="display:flex;align-items:center;gap:16px;">
            <button id="menu-toggle" class="btn-icon" type="button" title="Afficher ou masquer le menu" aria-label="Afficher ou masquer le menu"><i class="fas fa-bars"></i></button>
            <h1 id="platform-title">2M TECH Platform</h1>
          </div>
          <div class="header-center" style="flex:1;text-align:center;">
            <input type="text" id="global-search" placeholder="Recherche rapide..." autocomplete="off">
          </div>
          <div class="header-right" style="display:flex;align-items:center;gap:14px;">
            <button id="open-map-btn" class="btn btn-map" title="Plan interactif">
              <i class="fas fa-map"></i> Carte interactive
            </button>
            <button id="quick-theme" class="btn gray" type="button" title="Basculer le thème" aria-label="Basculer le thème">
              <i class="fas fa-adjust"></i>
            </button>
            <div class="user-avatar">${this.user.fullName ? this.user.fullName.charAt(0).toUpperCase() : (this.user.username ? this.user.username.charAt(0).toUpperCase() : '?')}</div>
            <div class="user-info">
              <!-- L'attribut title : un nom exceptionnellement long s'abrège à l'écran
                   plutôt que de pousser la déconnexion dehors ; il reste lisible au survol. -->
              <span class="user-name" title="${escapeHTML(this.user.fullName || this.user.username || '')}">${this.user.fullName || this.user.username || ''}</span>
              <span class="user-role">${escapeHTML(roleLabel(this.user.role))}</span>
            </div>
            <button id="logout-btn" class="btn danger" type="button" title="Déconnexion" aria-label="Déconnexion"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </header>
        <aside class="admin-sidebar">
          <nav class="sidebar-menu">
            <ul>
              ${this.renderMenuGroups()}
            </ul>
            <div class="system-status">
              <i class="fas fa-circle"></i>
              <span>En ligne</span>
            </div>
          </nav>
        </aside>
        <div class="admin-tabs" id="admin-tabs">
          <div class="tabs-container"></div>
          <button class="btn-icon close-all-tabs" type="button" title="Fermer tous les onglets" aria-label="Fermer tous les onglets">
            <i class="fas fa-times-circle"></i>
          </button>
        </div>
        <main class="admin-content" id="admin-content">
          <div class="loading-spinner"><div class="spinner"></div><p>Chargement...</p></div>
        </main>
        <div class="quick-actions">
          <div class="quick-actions-menu">
            <button id="quick-add" class="quick-action-btn main-action" type="button" title="Actions rapides" aria-label="Actions rapides">
              <i class="fas fa-bolt"></i>
            </button>
            <div class="quick-actions-dropdown">
              <button class="quick-action-item" data-action="search"><i class="fas fa-search"></i>Recherche</button>
              <button class="quick-action-item" data-action="add"><i class="fas fa-plus"></i>Ajouter</button>
              ${PermissionManager.check(this.user, 'system', 'backup') ? '<button class="quick-action-item" data-action="backup"><i class="fas fa-save"></i>Sauvegarde</button>' : ''}
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

    // Intertitres du menu : replier une famille entière. Ce sont des <button>, donc la
    // boucle ci-dessus — qui ne prend que les <a> — ne les a pas vus.
    document.querySelectorAll('.sidebar-menu .nav-group-header').forEach(entete => {
      entete.addEventListener('click', () => this.toggleMenuGroup(entete.dataset.group));
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
        onOpenWall: async roomId => { await db.setCurrentRoomId(roomId); this.openTab('walls'); },
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
    // Le hash brut est transmis TEL QUEL : `role-navigation-integration.js` enveloppe
    // `openTab` et le fait passer par `parseHashRoute`, qui découpe segments et paramètres.
    // Découper ici aussi ferait deux endroits à tenir d'accord pour un seul résultat.
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
    closeInteractiveMap({ notify: false });
    if (!this.sections[section]) section = 'dashboard';
    if (!this.tabs.includes(section)) {
      this.tabs.push(section);
      if (this.tabs.length > 7) this.tabs.shift();
    }
    this.currentSection = section;
    window.location.hash = `#/${section}`;
    this.revealSectionInMenu(section);
    this.renderTabs();
    this.loadSection(section);
  }

  renderTabs() {
    const tabsContainer = document.querySelector('.tabs-container');
    tabsContainer.innerHTML = this.tabs.map(section => `
      <div class="tab ${section === this.currentSection ? 'active' : ''}" data-section="${section}">
        <i class="${this.sections[section].icon}"></i>
        <span>${this.sections[section].title}</span>
        <button class="btn-icon close-tab" type="button" title="Fermer l'onglet" aria-label="Fermer l'onglet ${this.sections[section].title}"><i class="fas fa-times"></i></button>
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
        const dashboard = new Dashboard(container, { navigate: destination => this.openTab(destination) });
        await dashboard.ready;
      } else if (section === 'walls') {
        const wallManager = new WallManager({
          notifications: this.notifications,
          onBack: () => this.openTab('dashboard'),
          onOpenMap: async () => {
            const [rooms, baies, equipments] = await Promise.all([db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments')]);
            openInteractiveMap({ rooms, baies, equipments, user: this.user, notifications: this.notifications, onOpenWall: async roomId => { await db.setCurrentRoomId(roomId); this.openTab('walls'); } });
          },
          onOpenDiagnostic: async screenId => {
            await this.loadSection('screensDiagnostic');
            await this.sections.screensDiagnostic.component.selectScreenById(screenId);
          }
        });
        container.innerHTML = await wallManager.render();
        await wallManager.afterRender();
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
    } finally {
      // `container.innerHTML = …` a effacé la barre de contexte — y compris sur le chemin
      // d'erreur, où savoir sur quelle page on se trouve est le plus utile.
      this.renderContextBar(section);
    }
  }

  // هنا واجهة التذاكر المتطورة!
  showTicketsSection() {
    const container = document.getElementById('admin-content');
    container.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div><h2 style="margin:0;">Tickets & demandes</h2><small>Incidents, services, informations, vidéo et interventions.</small></div>
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
    };
    // Cette méthode est aussi appelée directement depuis `bindEvents`, sans passer par
    // `loadSection` : elle repose donc la barre de contexte elle-même.
    this.renderContextBar('tickets');
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

    let html = `<div class="card"><h3>Résultats pour "${escapeHTML(query)}"</h3>`;
    if (results.length) {
      html += `<ul class="search-list">`;
      results.forEach(item => {
        html += `<li>
          <span class="badge badge-type">${escapeHTML(item._type)}</span>
          <a href="#" class="go-to-section" data-section="${escapeHTML(item._section)}" data-id="${escapeHTML(item.id)}">
            ${escapeHTML(item.name || item.username || item.fullName)}
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

  async handleQuickAction(action) {
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
      /*
       * TROIS DÉFAUTS TENAIENT DANS CES DEUX LIGNES.
       *
       *   · `AdminUI` sert Admin, Manager ET Chef, alors que `system.backup` n'est accordé
       *     qu'à l'Admin : deux rôles sur trois voyaient une promesse intenable ;
       *   · l'export n'était pas attendu — le succès s'annonçait avant que l'écriture ait
       *     commencé à aboutir, si bien qu'un échec passait inaperçu et que l'utilisateur
       *     repartait convaincu d'avoir une sauvegarde ;
       *   · rien n'empêchait un second clic de lancer un second export par-dessus le premier.
       *
       * La garde se refait ici même si le bouton n'est pas rendu : un gestionnaire reste
       * atteignable autrement, et un refus doit se dire plutôt que se contourner.
       */
      if (!PermissionManager.check(this.user, 'system', 'backup')) {
        this.notifications.showNotification("Vous n'êtes pas autorisé à créer une sauvegarde.", 'error');
        return;
      }
      const bouton = document.querySelector('[data-action="backup"]');
      if (bouton?.disabled) return;
      if (bouton) bouton.disabled = true;
      try {
        await this.backupService.exportToFile();
        this.notifications.showNotification('Sauvegarde créée avec succès.', 'success');
      } catch (error) {
        console.warn('Sauvegarde impossible.', error);
        this.notifications.showNotification(
          error?.message ? `Sauvegarde impossible : ${error.message}` : "La sauvegarde n'a pas pu être créée.",
          'error'
        );
      } finally {
        if (bouton) bouton.disabled = false;
      }
    }
    if (action === 'export') {
      this.handleExportAll();
    }
  }

  /**
   * Export global de l'inventaire.
   *
   * Cette méthode lisait `db.getAll('rapports')` — un magasin qui n'a jamais existé.
   * Dans un `Promise.all`, ce seul appel faisait échouer l'export entier. Le défaut
   * restait invisible parce que `compat-integrations.js` redéfinissait la méthode par
   * une version correcte : deux implémentations, dont la cassée ne s'exécutait jamais.
   * Le jour où la redéfinition aurait disparu, l'export aurait cessé de fonctionner sans
   * que rien n'explique pourquoi. L'implémentation valable vit désormais ici, une fois.
   */
  async handleExportAll() {
    try {
      const stores = ['rooms', 'baies', 'equipments', 'users', 'walls', 'screens', 'screen_issues', 'tickets', 'notes', 'cables'];
      const valeurs = await Promise.all(stores.map(store => db.getAll(store)));
      const data = Object.fromEntries(stores.map((store, index) => [store, valeurs[index]]));
      data.exportedAt = new Date().toISOString();
      data.exportedBy = this.user.username;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(blob);
      lien.download = `2mtech-export-${new Date().toISOString().slice(0, 10)}.json`;
      lien.click();
      URL.revokeObjectURL(lien.href);
      this.notifications.showNotification('Export JSON réussi.', 'success');
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
