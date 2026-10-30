// techui.js — لوحة التقني المتكاملة لمنصة 2M TECH 2025
import { db } from './db.js';
import { eventSystem } from './events.js';
import { openTicketModal } from './tickets.js';
import openInteractiveMap from './interactive-map.js';
import { arSupport } from './ar-support.js';
// import * as ... بقية الملفات حسب الحاجة (لن تحتاجها هنا لأننا نستعمل واجهة الداشبورد فقط)

export default class TechUISmart {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.state = {};
    this.init();
  }

  async init() {
    document.getElementById('app').innerHTML = this.renderLoading();
    await this.loadData();
    this.render();
    this.bindGlobalActions();
    this.initMotivationBackground();
    this.setupSmartChat();
    // this.arSupport = new arSupport(); // إذا لديك دعم AR
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
    this.state.todayTasks = JSON.parse(localStorage.getItem('maintenance-tasks') || '[]');
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
    const { equipments, rooms, baies, tickets, logs, notifications, todayTasks } = this.state;
    const stats = this.state.stats;

    document.getElementById('app').innerHTML = `
      <div class="smart-tech-board${localStorage.getItem('theme') === 'dark' ? ' dark-theme' : ''}">
        <div class="tech-bg-motivation" id="motivation-bg"></div>
        <header class="smart-tech-header">
          <div class="header-left">
            <img src="images/tech-icon.svg" class="tech-logo" alt="2M Tech">
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
              <i class="fas fa-tv"></i> الشاشات بالغرف
            </button>
            <div class="user-block" tabindex="0">
              <div class="user-avatar" style="background-color: ${this.generateUserColor()}">
                ${this.getUserInitials()}
              </div>
              <span class="user-name">${this.user.fullName || this.user.username}</span>
              <div class="user-dropdown" id="user-dropdown">
                <button id="btn-profile"><i class="fas fa-user"></i> Profil</button>
                <button id="btn-settings"><i class="fas fa-cog"></i> Paramètres</button>
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
              <div class="card-header">
                <h3><i class="fas fa-history"></i> Activités Récentes</h3>
                <button class="btn-more" data-action="show-all-activities">Voir tout</button>
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
              <div class="card-header">
                <h3><i class="fas fa-tasks"></i> Mes Tâches du Jour</h3>
                <button class="btn-more" data-action="show-all-tasks">Tout afficher</button>
              </div>
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
              <button class="btn-more" id="btn-refresh-chart"><i class="fas fa-sync-alt"></i></button>
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
            <button class="btn-refresh-tip" id="btn-refresh-tip"><i class="fas fa-sync-alt"></i></button>
          </div>
        </div>
        <div class="tech-float-actions">
          <button class="float-btn btn-primary" id="btn-quick-ticket" title="Nouveau ticket"><i class="fas fa-plus"></i><span>Ticket</span></button>
          <button class="float-btn btn-secondary" id="btn-map" title="Carte interactive"><i class="fas fa-map-marked-alt"></i></button>
          <button class="float-btn btn-secondary" id="btn-theme-switch" title="Changer le thème"><i class="fas fa-adjust"></i></button>
          <button class="float-btn btn-secondary" id="btn-help" title="Aide rapide"><i class="fas fa-question"></i></button>
          <button class="float-btn btn-secondary" id="btn-chat" title="Chat équipe"><i class="fas fa-comments"></i></button>
        </div>
        <div id="tech-chat-modal"></div>
        <div id="modal-screens-diagnostic"></div>
      </div>
    `;
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
    return `
      <div class="ticket-item ${ticket.status}" data-id="${ticket.id}" data-type="ticket">
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
    return `
      <div class="critical-item" data-id="${equip.id}" data-type="equipment">
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

  getQuickTip() {
    const tips = [
      "Utilisez la carte interactive pour localiser rapidement les équipements défaillants.",
      "Vérifiez toujours les câbles avant toute opération.",
      "Consultez l'historique des tickets pour voir les solutions proposées.",
      "Utilisez le mode sombre la nuit pour plus de confort.",
      "Gardez votre liste de tâches à jour pour ne rien oublier.",
      "Scannez le QR code d'un équipement pour obtenir ses informations instantanément.",
      "Utilisez la fonctionnalité de réalité augmentée pour visualiser les équipements sur site."
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
        <h3 style="margin-bottom:20px;"><i class="fas fa-tv"></i> شاشات المنصة حسب الغرف</h3>
        <div style="margin-bottom:14px;">
          <label style="font-weight:bold;">اختر غرفة:</label>
          <select id="room-select-modal" class="form-control" style="margin-right:7px;">
            <option value="">-- اختر غرفة --</option>
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
            <div class="screen-meta"><b>Serial:</b> ${s.serialNumber || "-"}</div>
            <div class="screen-status">${s.status ? `<span class="status-${s.status}">${s.status}</span>` : ''}</div>
          </div>`
        ).join('') + "</div>";
      } else {
        html = `<div style="text-align:center;padding:24px;">لا توجد شاشات في هذه الغرفة</div>`;
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

    document.querySelector('.card-activity .btn-more').onclick = () => window.location.hash = "#/logs";
    document.querySelector('.card-tickets .btn-more').onclick = () => openTicketModal({});
    document.querySelector('.card-critical .btn-more').onclick = () => window.location.hash = "#/devices?status=critical";
    document.querySelector('.card-tasks .btn-more').onclick = () => window.location.hash = "#/maintenance";

    document.getElementById('btn-map').onclick = async () => {
      const { rooms, baies, equipments } = this.state;
      openInteractiveMap({
        rooms, baies, equipments,
        user: this.user,
        notifications: this.notifications,
        onClose: () => document.getElementById('map-modal')?.remove()
      });
    };
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
            this.notifications.showNotification("Chart refreshed!", "info");
        };
    }
    document.getElementById('btn-refresh-tip').onclick = () => {
        this.render();
        this.notifications.showNotification("New tip loaded!", "info");
    };
  }

  bindGlobalActions() {
    window.addEventListener('hashchange', async () => {
      await this.loadData();
      this.render();
    });
    eventSystem.on('dataUpdated', async () => {
      await this.loadData();
      this.render();
      this.notifications.showNotification("Data updated across the platform!", "info");
    });
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

  initTaskList() {
    const form = document.getElementById('add-task-form');
    if (!form) return;
    form.onsubmit = e => {
      e.preventDefault();
      let tasks = JSON.parse(localStorage.getItem('maintenance-tasks') || '[]');
      const val = document.getElementById('new-task').value.trim();
      if (!val) return;
      tasks.push({ text: val, done: false });
      localStorage.setItem('maintenance-tasks', JSON.stringify(tasks));
      this.render();
      document.getElementById('new-task').value = '';
    };
    document.querySelectorAll('#daily-tasks-list input[type="checkbox"]').forEach(chk => {
      chk.onchange = () => {
        let tasks = JSON.parse(localStorage.getItem('maintenance-tasks') || '[]');
        tasks[chk.dataset.idx].done = chk.checked;
        localStorage.setItem('maintenance-tasks', JSON.stringify(tasks));
        this.render();
      }
    });
  }

  initMotivationBackground() {
    const phrases = [
      "أنت صانع الحلول.", "كل عطل وله حل.", "ابدأ يومك بطاقة!", "لا وجود للمستحيل معك.", "حلول ذكية... نتائج رائعة.",
      "أنت محترف الشبكات.", "2M TECH تدعمك دائما.", "التقنية حياتك!", "مغامرة جديدة كل يوم.", "المستقبل لك!"
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

  showHelpCenter() {
    alert("Bienvenue dans le centre d'aide intelligent!\n\n- Cherchez n'importe quel appareil, salle, baie, écran ou ticket en haut.\n- Cliquez sur une statistique ou une activité pour plus de détails.\n- Créez des tickets ou tâches facilement.\n- Accédez à la carte interactive pour visualiser l'infrastructure.\n- Utilisez le scanner QR et la Réalité Augmentée pour interagir avec les équipements.\n\nEt plus encore bientôt !");
  }

  setupSmartChat() {}
  showChatModal() {
    if (document.getElementById('chat-modal-smart')) return;
    const chatKey = 'smart-tech-chat-messages';
    const messages = JSON.parse(localStorage.getItem(chatKey) || '[]');
    const chatHtml = `
      <div class="modal" id="chat-modal-smart" tabindex="-1" role="dialog" aria-modal="true" style="display:block; background: rgba(0,0,0,0.5);">
        <div class="modal-content" style="max-width:420px;min-height:340px;margin: 50px auto; padding: 20px; border-radius: 8px; position: relative;">
          <span class="close-modal" style="position:absolute; top:10px; right:15px; cursor:pointer; font-size:22px; color:#555;">&times;</span>
          <h3 style="color:#2874a6; margin-top: 0;">Support Chat — Équipe Technique</h3>
          <div id="chat-messages" style="background:#f3f7fb; height:220px; overflow-y:auto; margin-bottom:9px; border-radius:7px; padding:7px 10px; display:flex; flex-direction:column;"></div>
          <form id="chat-form" style="display:flex;gap:6px;">
            <input type="text" id="chat-msg" placeholder="Écrire un message..." style="flex:1;padding:8px;border-radius:5px;border:1px solid #ddd;">
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
  renderInventoryChart() {
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
    if (typeof Chart !== 'undefined') {
      this.chartInstance = new Chart(ctx, { type: 'bar', data, options });
    } else {
      ctx.parentNode.innerHTML = '<p style="text-align:center; padding:20px; color:#888;">Charting library (Chart.js) not loaded. Please ensure it is included for data visualization.</p>';
    }
  }
}
