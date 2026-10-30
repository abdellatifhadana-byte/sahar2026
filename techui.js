// techui.js — لوحة التقني المتكاملة لمنصة 2M TECH 2025
import { db } from './db.js';
import { eventSystem } from './events.js';
import { openTicketModal, showTicketDetails } from './tickets.js';
import openInteractiveMap from './interactive-map.js';
import WallManager from './wall-manager.js';
import ScreensDiagnostic from './screens-diagnostic.js';
// import * as ... بقية الملفات حسب الحاجة (لن تحتاجها هنا لأننا نستعمل واجهة الداشبورد فقط)

export default class TechUISmart {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.screensDiagnostic = new ScreensDiagnostic(notifications);
    this.state = {};
    /*
     * QUELLE SURFACE OCCUPE L'ÉCRAN — et pourquoi il faut le savoir.
     *
     * Mesuré au navigateur : un clic sur « Mur d'images » peignait le mur, puis le
     * tableau de bord revenait par-dessus au bout de deux cents millisecondes. La chaîne
     * est mécanique : `showWall()` appelle `WallManager.afterRender()`, qui appelle
     * `db.setCurrentRoomId()`, qui émet `dataUpdated` ; la coque technicien écoute cet
     * événement, recharge ses données et REPEINT le tableau de bord — sur le mur.
     *
     * Le rafraîchissement n'est pas en cause : il doit continuer. Ce qui manquait, c'est
     * que la coque sache ce qu'elle affiche. `surface` porte cette connaissance, et
     * `render()` — qui est le peintre du TABLEAU DE BORD, pas un peintre universel —
     * s'abstient quand une sous-vue occupe l'écran.
     */
    this.surface = 'dashboard';
    this.init();
  }

  /**
   * Marquer la surface qui vient d'être peinte.
   *
   * La marque est posée sur le premier élément de `#app`, et non sur `#app` lui-même :
   * elle disparaît donc avec le contenu dès que QUELQUE CHOSE D'AUTRE le remplace — une
   * route technicien, par exemple. La coque ne peut pas rester persuadée d'afficher un
   * mur que le routeur a déjà effacé.
   */
  marquerSurface(nom) {
    this.surface = nom;
    document.getElementById('app')?.firstElementChild?.setAttribute('data-tech-surface', nom);
  }

  /** Une sous-vue occupe-t-elle RÉELLEMENT l'écran en ce moment ? */
  surfaceOccupee() {
    if (this.surface === 'dashboard') return false;
    const marque = document.querySelector('#app > [data-tech-surface]')?.getAttribute('data-tech-surface');
    if (marque === this.surface) return true;
    // La sous-vue n'est plus là : la coque redevient responsable du tableau de bord.
    this.surface = 'dashboard';
    return false;
  }

  async init() {
    document.getElementById('app').innerHTML = this.renderLoading();
    /*
     * Une navigation par l'adresse est une intention EXPLICITE de quitter la sous-vue.
     * L'écouteur est posé AVANT `bindGlobalActions()` — donc avant celui du routeur —
     * pour que la surface soit déjà retombée sur le tableau de bord quand le routeur
     * décide quoi peindre.
     */
    window.addEventListener('hashchange', () => { this.surface = 'dashboard'; });
    await this.loadData();
    this.render();
    this.bindGlobalActions();
    this.initMotivationBackground();
    this.setupSmartChat();
    /*
     * `ar-support.js` N'EST PLUS IMPORTÉ ICI.
     *
     * Il l'était sans jamais servir — la seule ligne qui s'en servait était commentée. Or
     * un import n'est pas inerte : le module s'exécute, et il se termine par
     * `new ARSupport()`, dont le constructeur interroge WebXR au chargement de la coque
     * technicien. La plateforme téléchargeait donc, à chaque ouverture, un prototype que
     * rien n'appelle et dont aucun geste de ce parcours n'expose la fonction.
     *
     * Le fichier reste en place, intact, pour un lot qui lui sera consacré. Ce qui change
     * ici, c'est que la coque technicien ne le réveille plus.
     */
  }

  renderLoading() {
    return `
      <div class="tech-loading-screen">
        <div class="tech-loader">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" stroke="#3498db" stroke-width="8" fill="none" />
          </svg>
          <div>Chargement de l'espace technicien...</div>
        </div>
      </div>`;
  }

  async loadData() {
    const [equipments, rooms, baies, tickets, logs, notifications, screens, screenIssues] = await Promise.all([
      db.getAll('equipments'),
      db.getAll('rooms'),
      db.getAll('baies'),
      db.getAll('tickets'),
      db.getAll('logs'),
      db.getAll('notifications'),
      db.getAll('screens'),
      db.getAll('screen_issues')
    ]);
    this.state = { equipments, rooms, baies, tickets, logs, notifications, screens, screenIssues };
    this.state.stats = this.calculateStats(equipments, tickets, notifications, screens, screenIssues);
    this.state.todayTasks = this.lireTachesLocales();
  }

  calculateStats(equipments, tickets, notifications, screens, screenIssues) {
    return {
      active: equipments.filter(e => ['actif', 'active'].includes((e.status || '').toLowerCase())).length,
      faulty: equipments.filter(e => ['hors-service', 'faulty', 'hs', 'critical'].includes((e.status || '').toLowerCase()) || e.panne).length,
      maint: equipments.filter(e => (e.status || '').toLowerCase() === 'maintenance').length,
      unreadNotifs: notifications.filter(n => !n.read).length,
      myTickets: tickets.filter(t => t.createdBy === (this.user.fullName || this.user.username)),
      eqsCritical: equipments.filter(e => e.status === 'critical' || e.panne),
      totalScreens: screens.length,
      screensWithIssues: screenIssues.length,
    };
  }

  render() {
    /*
     * `render()` peint LE TABLEAU DE BORD. Quand une sous-vue occupe l'écran — le mur
     * d'images, le diagnostic d'un écran — la repeindre reviendrait à effacer ce que
     * l'utilisateur regarde parce que des données ont changé ailleurs. Les données ont
     * déjà été rechargées par `loadData()` ; la sous-vue les relira quand elle en aura
     * besoin.
     */
    if (this.surfaceOccupee()) return;
    const { equipments, rooms, baies, tickets, logs, notifications, todayTasks } = this.state;
    const stats = this.state.stats;

    document.getElementById('app').innerHTML = `
      <div class="smart-tech-board${localStorage.getItem('theme') === 'dark' ? ' dark-theme' : ''}">
        <div class="tech-bg-motivation" id="motivation-bg"></div>
        <header class="smart-tech-header">
          <div class="header-left">
            <img src="assets/images/tech-icon.webp" class="tech-logo" alt="2M Tech">
            <h1>Espace Technicien</h1>
          </div>
          <div class="header-search">
            <div class="search-container">
              <input type="search" id="global-tech-search" placeholder="🔍 Recherche appareil, salle, ticket...">
              <div id="search-results" class="search-results"></div>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn gray" id="btn-show-screens">
              <i class="fas fa-tv"></i> Écrans par salle
            </button>
            <div class="user-block" tabindex="0">
              <div class="user-avatar" style="background-color: ${this.generateUserColor()}">
                ${this.getUserInitials()}
              </div>
              <span class="user-name">${this.user.fullName || this.user.username}</span>
              <!--
                P0-1 ET P0-2 — « Profil » et « Paramètres » ont été RETIRÉS.

                Mesuré au navigateur, session technicien réelle : les deux boutons étaient
                rendus, portaient un curseur de main, et leur clic ne produisait
                strictement rien — aucun gestionnaire ne leur était attaché.

                Pourquoi les retirer plutôt que les brancher :
                  · PROFIL — la plateforme n'expose AUCUN écran de profil, pour aucun rôle.
                    Il n'y a donc rien à quoi les relier, et ce lot n'a pas mandat d'en
                    inventer un.
                  · PARAMÈTRES — l'écran existe, mais il appartient à l'administrateur :
                    permissions.js refuse au technicien system.view comme system.configure, et le
                    contrat de navigation ne lui accorde pas la section. Le brancher aurait supposé d'élargir ses droits, ce qui est
                    exactement ce que ce lot s'interdit.

                Reste la déconnexion, qui, elle, fait ce qu'elle annonce.
              -->
              <div class="user-dropdown" id="user-dropdown">
                <button id="btn-logout"><i class="fas fa-sign-out-alt"></i> Déconnexion</button>
              </div>
            </div>
          </div>
        </header>
        <div class="smart-dashboard">
          <div class="tech-stats-grid">
            ${this.renderStatCard('Équipements', equipments.length, 'server', 'blue', 'open-equipments')}
            ${this.renderStatCard('Défaillants', stats.faulty, 'bolt', 'red', 'show-faulty', stats.faulty > 0 ? 'pulse-alert' : '')}
            ${this.renderStatCard('Maintenance', stats.maint, 'tools', 'orange', 'open-maintenance')}
            ${this.renderStatCard('Salles', rooms.length, 'building', 'purple', 'open-rooms')}
            ${this.renderStatCard('Baies', baies.length, 'cube', 'teal', 'open-baies')}
            ${this.renderStatCard('Tickets', tickets.length, 'life-ring', 'yellow', 'open-tickets')}
            ${this.renderStatCard('Tâches', todayTasks.filter(t => !t.done).length, 'tasks', 'green', 'show-tasks')}
            ${this.renderStatCard('Notifications', stats.unreadNotifs, 'bell', 'pink', 'show-notifs', stats.unreadNotifs > 0 ? 'pulse-alert' : '')}
            ${this.renderStatCard('Écrans', stats.totalScreens, 'tv', 'cyan', 'open-screens')}
            ${this.renderStatCard('Problèmes Écrans', stats.screensWithIssues, 'bug', 'brown', 'open-screen-issues', stats.screensWithIssues > 0 ? 'pulse-alert' : '')}
          </div>
          <div class="tech-info-cards">
            <div class="tech-card card-activity">
              <!--
                P0-3 — « Voir tout » a été RETIRÉ.

                Il conduisait à la route #/logs. Or le contrat de navigation n'accorde pas cette
                section au technicien, et permissions.js lui refuse logs.view : la route
                retombait donc EN SILENCE sur le tableau de bord. L'utilisateur
                cliquait, l'adresse changeait, et il se retrouvait là d'où il venait sans
                qu'un mot lui dise pourquoi.

                Aucune autre destination n'existe : le technicien n'a pas de vue
                « activités » qui lui soit ouverte. L'envoyer vers ses notifications aurait
                été un second détournement — ce ne sont pas les mêmes faits. Les six
                dernières activités restent affichées ici ; ce qui disparaît, c'est la
                promesse d'en voir davantage.
              -->
              <div class="card-header">
                <h3><i class="fas fa-history"></i> Activités récentes</h3>
              </div>
              <div class="activity-stream">
                ${logs.slice(-6).reverse().map(log => this.renderActivityItem(log)).join('') ||
                '<div class="empty-state">Aucune activité récente</div>'}
              </div>
            </div>
            <div class="tech-card card-tickets">
              <div class="card-header">
                <h3><i class="fas fa-ticket-alt"></i> Mes Tickets</h3>
                <button class="btn-more" data-action="create-ticket">+ Nouveau</button>
              </div>
              <div class="tickets-list">
                ${stats.myTickets.slice(-5).reverse().map(ticket => this.renderTicketItem(ticket)).join('') ||
                '<div class="empty-state">Aucun ticket récent</div>'}
              </div>
            </div>
            <div class="tech-card card-critical">
              <div class="card-header">
                <h3><i class="fas fa-exclamation-triangle"></i> Équipements Critiques</h3>
                <button class="btn-more" data-action="show-all-critical">Voir tout</button>
              </div>
              <div class="critical-list">
                ${stats.eqsCritical.slice(0, 5).map(equip => this.renderCriticalItem(equip)).join('') ||
                '<div class="empty-state">Aucun équipement critique</div>'}
              </div>
            </div>
            <div class="tech-card card-tasks">
              <!--
                P0-7 — ces tâches vivent dans le stockage local du navigateur (maintenance-tasks), sur
                CET appareil. Les intituler « Mes Tâches du Jour » laissait croire à un
                planning tenu avec l'équipe : rien n'en part vers le serveur, et un
                technicien qui change de poste ne les retrouve pas. Le titre et la mention
                ci-dessous disent ce qu'elles sont.
              -->
              <div class="card-header">
                <h3><i class="fas fa-tasks"></i> Mes tâches (sur cet appareil)</h3>
                <button class="btn-more" data-action="show-all-tasks">Tout afficher</button>
              </div>
              <p class="tech-local-only"><i class="fas fa-mobile-alt"></i> Conservées uniquement sur cet appareil, sans synchronisation.</p>
              <ul class="daily-tasks-list" id="daily-tasks-list">
                ${
                  todayTasks.length
                    ? todayTasks.map((t, i) => `
                        <li>
                          <input type="checkbox" data-idx="${i}" ${t.done ? 'checked' : ''}>
                          <span style="${t.done ? 'text-decoration:line-through;color:#aaa;' : ''}">${t.text}</span>
                        </li>
                      `).join('')
                    : `<li class="empty-state">Aucune tâche aujourd'hui.</li>`
                }
              </ul>
              <form id="add-task-form" style="margin-top:12px;display:flex;gap:6px;">
                <input type="text" id="new-task" placeholder="Nouvelle tâche..." style="flex:1;">
                <button type="submit" class="btn btn-primary btn-mini"><i class="fas fa-plus"></i></button>
              </form>
            </div>
          </div>
          <div class="tech-card card-chart">
            <div class="card-header">
              <h3><i class="fas fa-chart-bar"></i> Vue d'ensemble du Parc</h3>
              <button type="button" class="btn-more" id="btn-refresh-chart" title="Actualiser le graphique" aria-label="Actualiser le graphique"><i class="fas fa-sync-alt"></i></button>
            </div>
            <div class="chart-container">
              <canvas id="inventory-chart"></canvas>
            </div>
          </div>
          <div class="tech-tip-card">
            <div class="tip-icon"><i class="fas fa-lightbulb"></i></div>
            <div class="tip-content">
              <h4>Astuce du Jour</h4>
              <p>${this.getQuickTip()}</p>
            </div>
            <button type="button" class="btn-refresh-tip" id="btn-refresh-tip" title="Afficher une autre astuce" aria-label="Afficher une autre astuce"><i class="fas fa-sync-alt"></i></button>
          </div>
        </div>
        <div class="tech-float-actions">
          <button class="float-btn btn-primary" id="btn-quick-ticket" title="Nouveau ticket"><i class="fas fa-plus"></i><span>Ticket</span></button>
          <button class="float-btn btn-secondary" id="btn-map" title="Carte interactive"><i class="fas fa-map-marked-alt"></i></button>
          <button class="float-btn btn-secondary" id="btn-wall" title="Mur d'images"><i class="fas fa-border-all"></i></button>
          <button class="float-btn btn-secondary" id="btn-theme-switch" title="Changer le thème"><i class="fas fa-adjust"></i></button>
          <button class="float-btn btn-secondary" id="btn-help" title="Aide rapide"><i class="fas fa-question"></i></button>
          <button class="float-btn btn-secondary" id="btn-chat" title="Notes locales"><i class="fas fa-sticky-note"></i></button>
        </div>
        <div id="tech-chat-modal"></div>
        <div id="modal-screens-diagnostic"></div>
      </div>
    `;
    this.marquerSurface('dashboard');
    this.bindBoardEvents();
    this.initTaskList();
    this.renderInventoryChart();
  }

  renderStatCard(title, value, icon, color, action, extraClass = '') {
    return `
      <div class="tech-stat-card ${extraClass}" data-action="${action}">
        <div class="stat-icon bg-${color}">
          <i class="fas fa-${icon}"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${value}</div>
          <div class="stat-title">${title}</div>
        </div>
        ${value > 0 ? `<div class="stat-badge">${value}</div>` : ''}
      </div>
    `;
  }

  renderActivityItem(log) {
    return `
      <div class="activity-item">
        <div class="activity-icon ${log.type || 'info'}">
          <i class="fas fa-${this.getActivityIcon(log.type)}"></i>
        </div>
        <div class="activity-details">
          <div class="activity-message">${log.action || log.details || 'Activité système'}</div>
          <div class="activity-meta">
            <span class="activity-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
            <span class="activity-date">${new Date(log.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    `;
  }

  getActivityIcon(type) {
    switch (type) {
      case 'error': return 'exclamation-circle';
      case 'warning': return 'exclamation-triangle';
      case 'success': return 'check-circle';
      default: return 'bolt';
    }
  }

  renderTicketItem(ticket) {
    /*
     * P0-4 — la carte porte un identifiant, un chevron et un curseur de main : elle
     * annonce qu'on peut l'ouvrir. Elle ne le faisait pas. `role` et `tabindex` disent
     * maintenant la même chose au clavier qu'à la souris ; le geste est branché dans
     * `bindBoardEvents`, sur le workflow Tickets déjà existant.
     */
    return `
      <div class="ticket-item ${ticket.status}" data-id="${ticket.id}" data-type="ticket"
           role="button" tabindex="0" aria-label="Ouvrir la demande ${ticket.id}">
        <div class="ticket-priority ${ticket.prio || 'medium'}"></div>
        <div class="ticket-content">
          <div class="ticket-title">${ticket.title || 'Sans titre'}</div>
          <div class="ticket-meta">
            <span class="ticket-id">#${ticket.id || '0000'}</span>
            <span class="ticket-status ${ticket.status || 'ouvert'}">${ticket.status || 'ouvert'}</span>
          </div>
        </div>
        <div class="ticket-arrow"><i class="fas fa-chevron-right"></i></div>
      </div>
    `;
  }

  renderCriticalItem(equip) {
    /* P0-5 — même exigence que pour les tickets : la carte s'ouvre pour de vrai, sur la
       fiche 360° de CET équipement, et le clavier y accède comme la souris. */
    return `
      <div class="critical-item" data-id="${equip.id}" data-type="equipment"
           role="button" tabindex="0" aria-label="Ouvrir la fiche de ${equip.name || 'l’équipement'}">
        <div class="critical-icon">
          <i class="fas fa-${this.getEquipmentIcon(equip.type)}"></i>
        </div>
        <div class="critical-details">
          <div class="critical-name">${equip.name || 'Équipement'}</div>
          <div class="critical-location">${this.getEquipmentLocation(equip)}</div>
        </div>
        <div class="critical-status">CRITIQUE</div>
      </div>
    `;
  }

  getEquipmentIcon(type) {
    if (!type) return 'microchip';
    if (type.includes('cam')) return 'video';
    if (type.includes('switch')) return 'network-wired';
    if (type.includes('pc')) return 'desktop';
    if (type.includes('server')) return 'server';
    if (type.includes('routeur') || type.includes('router')) return 'project-diagram';
    return 'cogs';
  }

  getEquipmentLocation(equip) {
    if (!equip) return '';
    let room = this.state.rooms.find(r => r.id == equip.roomId);
    let baie = this.state.baies.find(b => b.id == equip.baieId);
    return [
      room ? `<i class="fas fa-building"></i> ${room.name}` : '',
      baie ? `<i class="fas fa-cube"></i> ${baie.name}` : ''
    ].filter(Boolean).join(' ');
  }

  getUserInitials() {
    const name = this.user.fullName || this.user.username || '';
    return name.split(' ').slice(0, 2).map(n => n[0].toUpperCase()).join('');
  }
  generateUserColor() {
    let str = this.user.username || '';
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${hash % 360}, 63%, 51%)`;
  }

  /**
   * L'ASTUCE DU JOUR NE PROMET QUE DES GESTES QUI EXISTENT.
   *
   * Deux des sept astuces annonçaient « Scannez le QR code d'un équipement… » et
   * « Utilisez la fonctionnalité de réalité augmentée… ». Aucune des deux capacités n'est
   * exposée dans ce parcours : le centre d'aide avait cessé de les promettre, mais cette
   * carte les remettait à l'écran au hasard d'un rendu — un rafraîchissement suffisait à
   * les faire réapparaître pendant une démonstration.
   *
   * Elles sont remplacées par deux gestes que le technicien peut faire ICI, et que
   * l'épreuve de navigateur clique : ouvrir une demande depuis sa carte, ouvrir la fiche
   * d'un équipement critique depuis la sienne. Les cinq autres décrivaient déjà des
   * gestes réels et ne changent pas.
   */
  getQuickTip() {
    const tips = [
      "Utilisez la carte interactive pour localiser rapidement les équipements défaillants.",
      "Vérifiez toujours les câbles avant toute opération.",
      "Consultez l'historique des tickets pour voir les solutions proposées.",
      "Utilisez le mode sombre la nuit pour plus de confort.",
      "Gardez votre liste de tâches à jour pour ne rien oublier.",
      "Cliquez une demande récente pour ouvrir son suivi et ses échanges.",
      "Cliquez un équipement critique pour ouvrir sa fiche technique, avec sa salle et sa baie."
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  // --- التكامل مع نظام الشاشات بالغرف
  async showScreensModal() {
    const rooms = this.state.rooms;
    const screens = this.state.screens;

    let modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = "modal-screens-diagnostic";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:950px;min-height:400px;">
        <span class="close-modal" style="position:absolute; top:12px; right:16px; cursor:pointer; font-size:26px; color:#555;">&times;</span>
        <h3 style="margin-bottom:20px;"><i class="fas fa-tv"></i> Écrans de la plateforme par salle</h3>
        <div style="margin-bottom:14px;">
          <label style="font-weight:bold;">Choisir une salle :</label>
          <select id="room-select-modal" class="form-control" style="margin-right:7px;">
            <option value="">-- Choisir une salle --</option>
            ${rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
          </select>
        </div>
        <div id="screens-room-container" style="min-height:250px;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close-modal').onclick = () => modal.remove();

    modal.querySelector('#room-select-modal').onchange = (e) => {
      const roomId = e.target.value;
      const screensInRoom = screens.filter(s => s.roomId == roomId);
      let html = "";
      if (screensInRoom.length) {
        html += `<div class="screens-grid-modal" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px;">`
        + screensInRoom.map(s =>
          `<div class="screen-card-modal">
            <div class="screen-image"><i class="fas fa-tv" style="font-size:46px;color:#2874a6;"></i></div>
            <div class="screen-title">${s.name}</div>
            <div class="screen-meta"><b>Numéro de série :</b> ${s.serialNumber || "-"}</div>
            <div class="screen-status">${s.status ? `<span class="status-${s.status}">${s.status}</span>` : ''}</div>
          </div>`
        ).join('') + "</div>";
      } else {
        html = `<div style="text-align:center;padding:24px;">Aucun écran dans cette salle</div>`;
      }
      document.getElementById('screens-room-container').innerHTML = html;
    };
  }

  // ========== الأحداث والرابطات ==========
  bindBoardEvents() {
    document.querySelectorAll('.tech-stat-card').forEach(card => {
      card.onclick = () => {
        let action = card.getAttribute('data-action');
        if (action === 'open-equipments') window.location.hash = "#/devices";
        else if (action === 'show-faulty') window.location.hash = "#/devices?status=faulty";
        else if (action === 'open-maintenance' || action === 'show-tasks') window.location.hash = "#/maintenance";
        else if (action === 'open-rooms') window.location.hash = "#/salles";
        else if (action === 'open-baies') window.location.hash = "#/baies";
        else if (action === 'open-tickets') window.location.hash = "#/tickets";
        else if (action === 'show-notifs') window.location.hash = "#/notifications";
        else if (action === 'open-screens') window.location.hash = "#/screens";
        else if (action === 'open-screen-issues') window.location.hash = "#/screens/issues";
      };
    });

    document.getElementById('btn-show-screens').onclick = () => this.showScreensModal();

    // `.card-activity` n'a plus de bouton : sa seule destination était une route interdite.
    document.querySelector('.card-tickets .btn-more').onclick = () => openTicketModal({});
    document.querySelector('.card-critical .btn-more').onclick = () => window.location.hash = "#/devices?status=critical";
    document.querySelector('.card-tasks .btn-more').onclick = () => window.location.hash = "#/maintenance";

    /*
     * LES CARTES S'OUVRENT SUR L'ENTITÉ EXACTE — P0-4 et P0-5.
     *
     * Aucune fiche n'est réinventée ici : on appelle les deux workflows canoniques déjà
     * en place, et on leur passe l'IDENTIFIANT porté par la carte.
     *
     *   · `showTicketDetails` (tickets.js) affiche la demande, ses échanges et ses
     *     actions — lesquelles restent bornées par `canManageTicket`/`isTicketOwner`.
     *   · `openEquipment360` (operations-suite.js) affiche la fiche complète, salle et
     *     baie comprises.
     *
     * Les deux relisent l'enregistrement DANS LA BASE, qui est déjà filtrée par zone :
     * un technicien ne peut donc pas ouvrir ce que son périmètre ne contient pas, et
     * aucune permission n'est élargie pour autant. Si l'enregistrement a disparu entre
     * l'affichage et le clic, on le dit plutôt que d'ouvrir une fiche vide.
     */
    this.bindEntityCards();

    document.getElementById('btn-map').onclick = async () => {
      const { rooms, baies, equipments } = this.state;
      openInteractiveMap({
        rooms, baies, equipments,
        user: this.user,
        notifications: this.notifications,
        onOpenWall: async roomId => { await db.setCurrentRoomId(roomId); document.getElementById('map-modal')?.remove(); await this.showWall(); },
        onClose: () => document.getElementById('map-modal')?.remove()
      });
    };
    document.getElementById('btn-wall').onclick = () => this.showWall();
    document.getElementById('btn-quick-ticket').onclick = () => openTicketModal({});
    document.getElementById('btn-theme-switch').onclick = () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
      this.render();
    };

    document.getElementById('btn-help').onclick = () => this.showHelpCenter();
    document.getElementById('btn-chat').onclick = () => this.showChatModal();

    // القائمة المنسدلة للمستخدم
    let userBlock = document.querySelector('.user-block');
    let dropdown = document.getElementById('user-dropdown');
    userBlock.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    };
    document.getElementById('btn-logout').onclick = () => eventSystem.dispatch('logout');
    document.addEventListener('click', (e) => {
      if (!userBlock.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    // البحث الفوري
    document.getElementById('global-tech-search').oninput = (e) => {
      this.fastSearch(e.target.value);
    };

    // زر تحديث الرسم البياني
    const refreshChartBtn = document.getElementById('btn-refresh-chart');
    if (refreshChartBtn) {
        refreshChartBtn.onclick = () => {
            this.renderInventoryChart();
            this.notifications.showNotification("Graphique actualisé.", "info");
        };
    }
    document.getElementById('btn-refresh-tip').onclick = () => {
        this.render();
        this.notifications.showNotification("Nouvelle astuce chargée.", "info");
    };
  }

  /**
   * Ouvrir l'entité exacte que la carte désigne.
   *
   * Le geste est posé sur la LISTE et non sur chaque carte : les listes sont réécrites à
   * chaque rendu, et rebrancher carte par carte laissait des gestes orphelins derrière
   * chaque rafraîchissement.
   */
  bindEntityCards() {
    const ouvrir = async (type, id) => {
      if (!id) return;
      try {
        if (type === 'ticket') {
          const ticket = await db.get('tickets', db.normalizeKey ? db.normalizeKey(id) : id);
          if (!ticket) {
            this.notifications?.showNotification?.('Cette demande n’est plus disponible dans votre périmètre.', 'warning');
            return;
          }
          showTicketDetails(ticket);
          return;
        }
        // La fiche 360° est posée par `operations-suite.js`, chargé pour tous les rôles.
        // Absente — page ouverte avant son chargement — on se rabat sur la route
        // équipement, qui est autorisée au technicien : jamais sur une fiche inventée.
        if (window.TechOperations?.openEquipment360) await window.TechOperations.openEquipment360(id);
        else window.location.hash = `#/devices/${encodeURIComponent(id)}`;
      } catch (error) {
        this.notifications?.showNotification?.(`Ouverture impossible : ${error.message}`, 'error');
      }
    };

    for (const liste of document.querySelectorAll('.tickets-list, .critical-list')) {
      liste.onclick = event => {
        const carte = event.target.closest('[data-id][data-type]');
        if (!carte || !liste.contains(carte)) return;
        ouvrir(carte.dataset.type, carte.dataset.id);
      };
      liste.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const carte = event.target.closest('[data-id][data-type]');
        if (!carte || !liste.contains(carte)) return;
        event.preventDefault();
        ouvrir(carte.dataset.type, carte.dataset.id);
      };
    }
  }

  bindGlobalActions() {
    window.addEventListener('hashchange', async () => {
      await this.loadData();
      this.render();
    });
    eventSystem.register('dataUpdated', async () => {
      await this.loadData();
      this.render();
      this.notifications.showNotification("Les données de la plateforme ont été actualisées.", "info");
    });
  }

  async showWall() {
    const manager = new WallManager({
      notifications: this.notifications,
      /*
       * Le retour rend EXPLICITEMENT la surface au tableau de bord. Sans cette remise à
       * zéro, `render()` constaterait la marque « wall » toujours posée et s'abstiendrait :
       * le bouton Retour resterait sans effet visible — le défaut déplacé, pas corrigé.
       */
      onBack: () => { this.surface = 'dashboard'; this.render(); },
      onOpenDiagnostic: screenId => this.showScreenDiagnostic(screenId),
      onOpenMap: () => {
        const { rooms, baies, equipments } = this.state;
        openInteractiveMap({ rooms, baies, equipments, user: this.user, notifications: this.notifications, onOpenWall: async roomId => { await db.setCurrentRoomId(roomId); document.getElementById('map-modal')?.remove(); await this.showWall(); } });
      }
    });
    const app = document.getElementById('app');
    app.innerHTML = await manager.render();
    /*
     * La marque est posée AVANT `afterRender()`, et c'est tout l'enjeu : c'est
     * `afterRender()` qui appelle `db.setCurrentRoomId()` et déclenche `dataUpdated`. Si
     * la coque n'avait pas encore appris qu'elle affiche le mur, elle repeindrait le
     * tableau de bord par-dessus — le défaut mesuré à t+200 ms.
     */
    this.marquerSurface('wall');
    await manager.afterRender();
  }

  async showScreenDiagnostic(screenId) {
    const app = document.getElementById('app');
    app.innerHTML = await this.screensDiagnostic.render();
    // Même exposition que le mur : le diagnostic lit la base et peut déclencher un
    // rafraîchissement pendant qu'il se pose.
    this.marquerSurface('diagnostic');
    this.screensDiagnostic.afterRender();
    await this.screensDiagnostic.selectScreenById(screenId);
  }

  fastSearch(q) {
    q = (q || '').toLowerCase();
    const { equipments, rooms, baies, tickets, screens } = this.state;
    let res = [];
    if (!q.trim()) {
      document.getElementById('search-results').style.display = "none";
      document.getElementById('search-results').innerHTML = "";
      return;
    }
    res.push(...equipments.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.numSerie || '').toLowerCase().includes(q) ||
      (e.type || '').toLowerCase().includes(q) ||
      (e.marque || '').toLowerCase().includes(q)
    ).map(e => `<div class="search-hit" data-type="equipment" data-id="${e.id}"><b>EQ:</b> ${e.name || '-'} — SN:${e.numSerie || '-'}</div>`));
    res.push(...rooms.filter(r => (r.name || '').toLowerCase().includes(q)).map(r => `<div class="search-hit" data-type="room" data-id="${r.id}"><b>Salle:</b> ${r.name}</div>`));
    res.push(...baies.filter(b => (b.name || '').toLowerCase().includes(q)).map(b => `<div class="search-hit" data-type="baie" data-id="${b.id}"><b>Baie:</b> ${b.name}</div>`));
    res.push(...tickets.filter(t => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)).map(t => `<div class="search-hit" data-type="ticket" data-id="${t.id}"><b>Ticket:</b> ${t.title} (ID:${t.id})</div>`));
    res.push(...screens.filter(s => (s.name || '').toLowerCase().includes(q) || (s.location || '').toLowerCase().includes(q)).map(s => `<div class="search-hit" data-type="screen" data-id="${s.id}"><b>Écran:</b> ${s.name} (${s.location})</div>`));
    let sr = document.getElementById('search-results');
    sr.innerHTML = res.length ? res.slice(0, 10).join('') : `<div class="search-hit" style="color:#bbb;">Aucun résultat.</div>`;
    sr.style.display = "block";
    sr.querySelectorAll('.search-hit').forEach(hit => {
      hit.onclick = () => {
        let type = hit.dataset.type;
        let id = hit.dataset.id;
        if (type === "equipment") window.location.hash = "#/devices/" + id;
        else if (type === "room") window.location.hash = "#/salles/" + id;
        else if (type === "baie") window.location.hash = "#/baies/" + id;
        else if (type === "ticket") window.location.hash = "#/tickets/" + id;
        else if (type === "screen") window.location.hash = "#/screens/" + id;
        sr.style.display = "none";
      };
    });
    document.addEventListener('click', (e) => {
      if (!sr.contains(e.target) && e.target.id !== 'global-tech-search') {
        sr.style.display = "none";
      }
    });
  }

  /** Les tâches locales, telles que cet appareil les a gardées. */
  lireTachesLocales() {
    try {
      const brut = JSON.parse(localStorage.getItem('maintenance-tasks') || '[]');
      return Array.isArray(brut) ? brut : [];
    } catch { return []; }
  }

  /**
   * LA SEULE PORTE D'ÉCRITURE DES TÂCHES LOCALES.
   *
   * Mesuré : la saisie était bien enregistrée, mais la liste continuait d'afficher
   * « Aucune tâche aujourd'hui » jusqu'au rechargement de la page. L'écriture touchait le
   * stockage, puis `render()` redessinait à partir de `this.state.todayTasks` — la copie
   * chargée par le dernier `loadData()`, donc l'ancienne. Deux vérités, et c'est la
   * périmée qui s'affichait.
   *
   * Les deux gestes — ajouter, cocher — passent désormais par ici : le stockage et la
   * projection avancent ensemble, AVANT le rendu. Le compteur « Tâches » de la grille lit
   * la même projection, il suit donc sans rien de plus.
   *
   * Rien ne part vers le serveur : ces tâches restent sur cet appareil, comme le dit la
   * carte qui les affiche.
   */
  ecrireTachesLocales(muter) {
    const suivantes = muter(this.lireTachesLocales());
    if (!Array.isArray(suivantes)) return;
    localStorage.setItem('maintenance-tasks', JSON.stringify(suivantes));
    this.state.todayTasks = suivantes;
    this.state.stats = this.calculateStats(
      this.state.equipments, this.state.tickets, this.state.notifications,
      this.state.screens, this.state.screenIssues
    );
    this.render();
  }

  initTaskList() {
    const form = document.getElementById('add-task-form');
    if (!form) return;
    form.onsubmit = e => {
      e.preventDefault();
      const val = document.getElementById('new-task').value.trim();
      if (!val) return;
      this.ecrireTachesLocales(taches => [...taches, { text: val, done: false }]);
    };
    document.querySelectorAll('#daily-tasks-list input[type="checkbox"]').forEach(chk => {
      chk.onchange = () => {
        const index = Number(chk.dataset.idx);
        const coche = chk.checked;
        this.ecrireTachesLocales(taches => taches.map((tache, rang) =>
          rang === index ? { ...tache, done: coche } : tache));
      };
    });
  }

  initMotivationBackground() {
    const phrases = [
      "Vous construisez les solutions.", "Chaque panne a sa solution.", "Commencez la journée avec énergie !", "Votre expertise fait la différence.", "Des solutions intelligentes, des résultats fiables.",
      "Vous maîtrisez les réseaux.", "2M TECH vous accompagne.", "La technique est votre métier.", "Chaque journée apporte un nouveau défi.", "Le futur se construit aujourd’hui."
    ];
    let bg = document.getElementById('motivation-bg');
    if (!bg) return;
    bg.innerHTML = "";
    for (let i = 0; i < 30; i++) {
      let el = document.createElement('div');
      el.className = 'tech-motivation-phrase color' + ((i % 6) + 1);
      el.style.top = (7 + Math.random() * 80) + 'vh';
      el.style.left = (8 + Math.random() * 80) + 'vw';
      el.style.animationDelay = (Math.random() * 18).toFixed(2) + 's';
      el.style.opacity = (0.09 + Math.random() * 0.15).toFixed(2);
      el.textContent = phrases[Math.floor(Math.random() * phrases.length)];
      bg.appendChild(el);
    }
  }

  /**
   * P0-8 — le centre d'aide ne décrit QUE ce qui est réellement accessible d'ici.
   *
   * L'ancien texte promettait « le scanner QR et la Réalité Augmentée pour interagir avec
   * les équipements ». Ni l'un ni l'autre n'existe dans ce parcours : aucun écran ne
   * scanne un QR d'équipement, et la prise en charge de la réalité augmentée n'est
   * branchée à aucun geste. Une aide qui promet ce qu'on ne trouvera pas coûte plus qu'une
   * absence d'aide — on cherche, puis on doute du reste.
   *
   * Chaque ligne ci-dessous correspond à un contrôle présent à l'écran, et l'épreuve
   * `scripts/techui-controls-audit.mjs` les clique tous.
   */
  showHelpCenter() {
    alert([
      "Centre d'aide — espace technicien",
      '',
      "· Recherche : retrouvez un équipement, une salle, une baie, un écran ou une demande depuis la barre du haut.",
      "· Vignettes : chaque compteur ouvre la liste correspondante — équipements, salles, baies, demandes, écrans.",
      "· Demandes : « Nouveau » ouvre le formulaire ; une demande de la liste s'ouvre d'un clic sur sa carte.",
      "· Équipements critiques : cliquez une carte pour ouvrir la fiche 360° de l'appareil, avec sa salle et sa baie.",
      "· Carte interactive et mur d'images : accessibles par les boutons flottants, à droite.",
      "· Écrans par salle : diagnostic et historique depuis le bouton de l'en-tête.",
      "· Mes tâches et Notes locales restent sur cet appareil : rien n'en part vers le serveur.",
      '',
      "Les sections qui ne vous sont pas ouvertes ne sont pas affichées : ce que vous voyez, vous pouvez le faire."
    ].join('\n'));
  }

  setupSmartChat() {}

  /**
   * P0-6 — « Support Chat — Équipe Technique » était un mensonge de bonne foi.
   *
   * Rien n'est envoyé nulle part : les messages vivent dans `smart-tech-chat-messages`,
   * dans le stockage local de CE navigateur. Personne d'autre ne les reçoit, et personne
   * n'y répondra jamais. Un technicien qui signale une panne là croit avoir prévenu son
   * équipe ; il a écrit dans un carnet que lui seul ouvrira.
   *
   * Ce lot n'a pas mandat de construire un vrai canal partagé. La surface est donc
   * conservée pour ce qu'elle est — un carnet de notes local — et le dit. La clé de
   * stockage ne change pas : ce qui a déjà été écrit reste lisible.
   */
  showChatModal() {
    if (document.getElementById('chat-modal-smart')) return;
    const chatKey = 'smart-tech-chat-messages';
    const messages = JSON.parse(localStorage.getItem(chatKey) || '[]');
    const chatHtml = `
      <div class="modal" id="chat-modal-smart" tabindex="-1" role="dialog" aria-modal="true" style="display:block; background: rgba(0,0,0,0.5);">
        <div class="modal-content" style="max-width:420px;min-height:340px;margin: 50px auto; padding: 20px; border-radius: 8px; position: relative;">
          <span class="close-modal" style="position:absolute; top:10px; right:15px; cursor:pointer; font-size:22px; color:#555;">&times;</span>
          <h3 style="color:#2874a6; margin-top: 0;">Notes locales</h3>
          <p class="tech-local-only" style="margin:0 0 9px;"><i class="fas fa-mobile-alt"></i> Conservées uniquement sur cet appareil. Personne d'autre ne les reçoit.</p>
          <div id="chat-messages" style="background:#f3f7fb; height:220px; overflow-y:auto; margin-bottom:9px; border-radius:7px; padding:7px 10px; display:flex; flex-direction:column;"></div>
          <form id="chat-form" style="display:flex;gap:6px;">
            <input type="text" id="chat-msg" placeholder="Écrire une note…" style="flex:1;padding:8px;border-radius:5px;border:1px solid #ddd;">
            <button class="btn" type="submit" style="padding:8px 12px;border-radius:5px;background:#2874a6;color:#fff;border:none;cursor:pointer;"><i class="fas fa-paper-plane"></i></button>
          </form>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHtml);
    const chatMessagesDiv = document.getElementById('chat-messages');
    const renderMsgs = () => {
      chatMessagesDiv.innerHTML = messages.map(m =>
        `<div style="margin-bottom:6px;${m.user === (this.user.fullName || this.user.username) ? 'text-align:right;' : 'text-align:left;'}">
           <b style="color:${m.user === (this.user.fullName || this.user.username) ? '#16a085' : '#2874a6'}">${m.user}</b>: 
           <span>${m.text}</span>
           <span style="color:#bbb;font-size:11px;display:block;">${new Date(m.time).toLocaleTimeString()}</span>
         </div>`
      ).join('');
      chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    };
    renderMsgs();
    document.getElementById('chat-form').onsubmit = (e) => {
      e.preventDefault();
      const txt = document.getElementById('chat-msg').value.trim();
      if (!txt) return;
      messages.push({ user: this.user.fullName || this.user.username, text: txt, time: new Date() });
      localStorage.setItem(chatKey, JSON.stringify(messages));
      renderMsgs();
      document.getElementById('chat-msg').value = '';
    };
    document.querySelector('#chat-modal-smart .close-modal').onclick = () => {
      document.getElementById('chat-modal-smart').remove();
    };
    document.getElementById('chat-msg').focus();
    document.getElementById('chat-modal-smart').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('chat-modal-smart').remove();
      }
    });
  }

  // ========== رسم بياني للبيانات ==========
  /**
   * Charge Chart.js à la demande.
   *
   * POURQUOI CE GRAPHIQUE NE S'AFFICHAIT JAMAIS
   * -------------------------------------------
   * `index.html` chargeait `assets/chart.js` — 36 Ko qui définissent `window.BarChart`, une
   * petite bibliothèque de barres SANS aucun rapport avec Chart.js, et que personne
   * n'utilisait. La vraie bibliothèque dormait à la racine sous le nom `Chart.js`, jamais
   * chargée. `typeof Chart` restait donc « undefined », et le technicien voyait à la place
   * un message d'erreur en anglais — que `french-ui-guard.js` avait fini par traduire, preuve
   * que quelqu'un l'avait bien rencontré en production.
   *
   * POURQUOI À LA DEMANDE, ET NON DANS LA PAGE
   * ------------------------------------------
   * Chart.js pèse 70 Ko compressés, et SEUL le technicien voit ce graphique. La poser dans
   * `index.html` la ferait télécharger par l'administrateur, le manager, le chef, le
   * responsable et le visiteur, qui ne l'ouvriront jamais. Le service worker la garde en
   * cache, donc le hors ligne fonctionne quand même.
   */
  async chargerChartJs() {
    if (typeof Chart !== 'undefined') return true;
    if (typeof document === 'undefined') return false;
    this.constructor._chargementChart ??= new Promise(resolve => {
      const existant = document.querySelector('script[data-chartjs]');
      if (existant) { existant.addEventListener('load', () => resolve(typeof Chart !== 'undefined')); return; }
      const script = document.createElement('script');
      script.src = 'Chart.js';
      script.dataset.chartjs = '1';
      script.onload = () => resolve(typeof Chart !== 'undefined');
      // Un échec réseau ne doit pas rester en attente : on rend « false », et l'appelant
      // affiche une phrase utile au lieu d'un cadre vide pour toujours.
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    return this.constructor._chargementChart;
  }

  async renderInventoryChart() {
    const ctx = document.getElementById('inventory-chart');
    if (!ctx) return;
    if (this.chartInstance) this.chartInstance.destroy();
    const { rooms, baies, equipments, screens, tickets, screenIssues } = this.state;
    const data = {
      labels: ['Salles', 'Baies', 'Équipements', 'Écrans', 'Tickets', 'Problèmes Écrans'],
      datasets: [{
        label: 'Nombre d\'éléments',
        data: [
          rooms.length,
          baies.length,
          equipments.length,
          screens.length,
          tickets.length,
          screenIssues.length
        ],
        backgroundColor: [
          'rgba(153, 102, 255, 0.7)',
          'rgba(75, 192, 192, 0.7)',
          'rgba(54, 162, 235, 0.7)',
          'rgba(255, 206, 86, 0.7)',
          'rgba(255, 99, 132, 0.7)',
          'rgba(201, 203, 207, 0.7)'
        ],
        borderColor: [
          'rgba(153, 102, 255, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(255, 99, 132, 1)',
          'rgba(201, 203, 207, 1)'
        ],
        borderWidth: 1
      }]
    };
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) { if (value % 1 === 0) { return value; } }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.parsed.y !== null) label += context.parsed.y;
              return label;
            }
          }
        }
      }
    };
    if (await this.chargerChartJs()) {
      this.chartInstance = new Chart(ctx, { type: 'bar', data, options });
      return;
    }
    // La bibliothèque n'a pas pu être chargée — hors ligne au tout premier passage, par
    // exemple. On le dit en français et sans jargon, et on donne quand même les chiffres :
    // c'est eux qu'on venait chercher, le graphique n'était qu'une mise en forme.
    const chiffres = data.labels
      .map((etiquette, index) => `${etiquette} : ${data.datasets[0].data[index]}`)
      .join(' · ');
    const repli = document.createElement('div');
    repli.className = 'chart-fallback';
    repli.style.cssText = 'padding:16px;text-align:center;color:#5a7386;font-size:14px;line-height:1.7';
    repli.textContent = `Graphique indisponible pour le moment. ${chiffres}`;
    ctx.parentNode.replaceChild(repli, ctx);
  }
}
