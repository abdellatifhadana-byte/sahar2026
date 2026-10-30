// core.js — point d'entrée principal de 2M TECH Platform
import { db } from './db.js';
import { forgetMapImage } from './map-image-store.js';
import Auth from './auth.js';
import AdminUI from './admin-ui.js';
import TechUI from './techui.js';
import ResponsibleUI from './responsible-ui.js';
import VisitorUI from './visitor-ui.js';
import { NotificationSystem } from './notifications.js';
import { eventSystem } from './events.js';
import { BackupService } from './backup-service.js';
import { normalizeRole } from './roles.js';
import { inspectDataIntegrity } from './data-integrity.js';
import { ensureCanonicalSettings, getPlatformSettings } from './settings-contract.js';
import { renderStartupSplash, finishStartupSplash, failStartupSplash } from './startup-splash.js';
import { startupProgress } from './startup-progress.js';

class Core {
  constructor() {
    this.currentUser = null;
    this.notifications = new NotificationSystem();
    this.backupService = new BackupService();
    this.UIs = {};
    this._logoutInProgress = false;
    this.ready = this.init();
  }

  async init() {
    try {
      // Chaque étape rend compte en se TERMINANT, jamais en s'annonçant. Le détail du
      // raisonnement — et les mesures qui fixent les poids — sont dans startup-progress.js.
      startupProgress.enter('database');
      await db.open();
      await ensureCanonicalSettings();
      startupProgress.complete('database');

      startupProgress.enter('integrity');
      const integrity = await inspectDataIntegrity();
      if (!integrity.valid) console.warn('Des relations de données invalides ont été détectées.', integrity.counts);
      startupProgress.complete('integrity');

      startupProgress.enter('session');
      this.auth = new Auth();
      // `checkSession()` ne se contente pas de vérifier l'identité : lorsqu'une session est
      // déjà ouverte, il déclenche la synchronisation initiale COMPLÈTE (auth.js:113). Les
      // étapes `download` et `apply` sont donc renseignées depuis central-sync.js, qui est
      // le seul endroit à connaître le coût réel de ce transfert.
      this.currentUser = await this.auth.checkSession();
      if (!this.currentUser) {
        // Attendre qu'une personne saisisse ses identifiants n'est pas un chargement. Le
        // modèle se fige : laisser courir une barre de progression devant un formulaire
        // était le mensonge le plus visible de l'écran de démarrage.
        startupProgress.awaitHuman();
        // L'écran de connexion réécrit `#app` et détruit donc le splash. Les étapes
        // suivantes n'avaient plus rien où s'afficher : après une connexion, l'utilisateur
        // passait du formulaire à un écran vide pendant toute la synchronisation initiale,
        // l'étape la plus longue du démarrage. Le splash est reconstruit — et comme le
        // modèle est monotone, il reprend à sa valeur réelle au lieu de repartir de 4 %.
        this.currentUser = await this.auth.showLogin();
        startupProgress.resumeAfterHuman();
        renderStartupSplash();
      }
      this.auth.hideLogin();
      startupProgress.complete('session');

      startupProgress.enter('interface');
      this.applyRoleTheme(this.currentUser.role);
      eventSystem.setupCoreEvents();
      this.setupGlobalEventListeners();
      this.backupService.startAutoBackup('weekly');
      this.checkForUpdates();
      this.setupIdleTimeout();
      this.initSystemNotifications();
      eventSystem.register('reload-application', () => window.location.reload());

      startupProgress.complete('interface');

      // `loadRoleSpecificUI()` ne peut PAS être avancé avant la sortie de l'écran : les
      // quatre interfaces de rôle commencent par `document.getElementById('app').innerHTML = …`
      // (admin-ui.js:56), ce qui détruirait l'écran de démarrage au lieu de se préparer
      // derrière lui. Le faire supposerait de leur donner un conteneur distinct de `#app` —
      // un changement qui touche les quatre rôles, hors de la portée de cette correction.
      await finishStartupSplash();
      this.loadRoleSpecificUI();
    } catch (error) {
      console.error("Échec de l'initialisation de l'application", error);
      try { this.notifications.showNotification("Échec de l'initialisation de l'application", 'error'); } catch {}
      // Le splash reste à l'écran pendant tout le démarrage : sans cet état d'échec, il
      // demeurait figé à mi-course, sans dire ce qui s'était passé.
      try { failStartupSplash(error); } catch {}
      this.showFatalError(error);
    }
  }

  applyRoleTheme(role) {
    // Trois implémentations concurrentes existaient (ici, dans auth.js et dans
    // compat-integrations.js) et celle-ci gagnait, car appelée en dernier. Elle traitait
    // 'responsable' comme theme-admin alors que 'responsible' recevait theme-responsible :
    // le même rôle canonique changeait de couleur selon son orthographe. Le rôle est
    // désormais normalisé avant toute décision d'affichage.
    const canonical = normalizeRole(role);
    const roleClass = canonical === 'technician' ? 'theme-tech' : `theme-${canonical}`;
    const theme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    document.body.className = `${roleClass} ${theme}-theme`;
  }

  loadRoleSpecificUI() {
    const role = normalizeRole(this.currentUser?.role);
    // Manager et Chef partagent l'ossature de l'administrateur : c'est la seule interface
    // qui expose l'ensemble des sections techniques, et le manager doit « tout voir de la
    // chaîne ». Ce qu'ils peuvent y FAIRE est borné ailleurs — par ROLE_ROUTES pour les
    // sections, par PERMISSIONS_MATRIX pour les actions, par la hiérarchie pour les
    // comptes. Sans cette ligne, les deux nouveaux rôles retombaient sur VisitorUI et ne
    // voyaient presque rien.
    if (role === 'admin' || role === 'manager' || role === 'chef') {
      this.UIs.admin = new AdminUI(this.currentUser, this.notifications, this.backupService);
    } else if (role === 'technician') {
      this.UIs.tech = new TechUI(this.currentUser, this.notifications);
    } else if (role === 'responsible') {
      this.UIs.responsible = new ResponsibleUI(this.currentUser, this.notifications);
    } else {
      this.UIs.visitor = new VisitorUI(this.currentUser, this.notifications);
    }
  }

  setupGlobalEventListeners() {
    eventSystem.register('logout', () => this.logout());

    eventSystem.register('backup-restored', () => {
      this.notifications.showNotification('Sauvegarde restaurée avec succès.', 'success');
      setTimeout(() => window.location.reload(), 1000);
    });

    eventSystem.register('auto-backup-failed', ({ error }) => {
      this.notifications.showNotification(`Échec de la sauvegarde automatique : ${error.message}`, 'error');
    });

    eventSystem.register('user-timeout', () => {
      this.notifications.showNotification("Déconnexion automatique pour cause d'inactivité", 'warning');
      setTimeout(() => this.logout(), 3000);
    });

    eventSystem.register('reload-ui', () => window.location.reload());
    eventSystem.register('toggle-theme', () => this.toggleTheme());
  }

  setupIdleTimeout() {
    let idleTimer;
    // Le délai vient des paramètres canoniques, plus de `localStorage['system-settings']`
    // qui n'était écrit que par la page Paramètres — donc jamais pour un non-admin, dont
    // la session gardait silencieusement 30 minutes quelle que soit la politique définie.
    let timeoutMs = 30 * 60 * 1000;
    const refreshTimeout = async () => {
      try {
        const settings = await getPlatformSettings();
        const minutes = Number(settings?.autoLogout);
        if (Number.isFinite(minutes) && minutes > 0) timeoutMs = minutes * 60 * 1000;
      } catch {}
    };
    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        this.notifications.showNotification("Vous allez être déconnecté pour cause d'inactivité", 'warning');
        setTimeout(() => this.logout(), 30000);
      }, timeoutMs);
    };
    ['mousemove', 'keypress', 'click', 'scroll'].forEach(event => window.addEventListener(event, resetTimer));
    resetTimer();
    refreshTimeout().then(resetTimer);
    // Une modification des paramètres par l'administrateur prend effet sans rechargement.
    eventSystem.register('platform-settings-updated', () => refreshTimeout().then(resetTimer));
  }

  async logout() {
    if (this._logoutInProgress) return;
    this._logoutInProgress = true;
    try {
      /*
       * LE PLAN QUITTE LE POSTE AVANT LA SESSION.
       *
       * Les octets du plan opérationnel ne vivent plus qu'en mémoire de session, mais un
       * poste ayant tourné sur une version précédente porte encore l'ancien cache
       * persistant. `forgetMapImage()` oublie les deux, ici, avant que le compte suivant
       * n'arrive sur la même machine.
       */
      await forgetMapImage().catch(() => {});
      if (!this.auth) this.auth = new Auth();
      await this.auth.logout();
    } catch (error) {
      console.error('Échec de la déconnexion', error);
      localStorage.removeItem('auth');
      localStorage.removeItem('session');
      window.location.replace('/');
    }
  }

  showFatalError(error) {
    const message = String(error?.message || error || 'Erreur inconnue');
    document.body.replaceChildren();
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100vh;padding:20px;box-sizing:border-box;background:#f5f8fb;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(460px,100%);background:#fff;padding:34px 38px 28px;border-radius:12px;box-shadow:0 2px 10px #e5e7e9;text-align:center;';
    const title = document.createElement('h2');
    title.style.color = '#e74c3c';
    title.textContent = 'Erreur critique';
    const text = document.createElement('p');
    text.style.cssText = 'color:#b23232;font-size:16px;overflow-wrap:anywhere;';
    text.textContent = message;
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = "Recharger l'application";
    button.addEventListener('click', () => window.location.reload());
    box.append(title, text, button);
    wrapper.appendChild(box);
    document.body.appendChild(wrapper);
  }

  async checkForUpdates() {}
  initSystemNotifications() {}

  toggleTheme() {
    const roleClass = Array.from(document.body.classList).find(c => c.startsWith('theme-')) || 'theme-visitor';
    const isDark = document.body.classList.contains('dark-theme');
    const newTheme = isDark ? 'light-theme' : 'dark-theme';
    document.body.className = `${roleClass} ${newTheme}`;
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    this.notifications.showNotification(`Thème ${isDark ? 'clair' : 'sombre'} activé`, 'success');
  }
}

function renderStartupShell() {
  const host = document.getElementById('app');
  if (!host || host.childElementCount || host.textContent.trim()) return;
  renderStartupSplash();
  // Le graphe de modules est chargé et l'écran est posé : l'étape `boot` est FINIE, pas
  // en cours. C'est la seule raison pour laquelle la barre part à sa valeur et non à zéro.
  startupProgress.complete('boot');
}

let coreStarted = false;
function startCore() {
  if (coreStarted || window.__APP) return window.__APP;
  coreStarted = true;
  renderStartupShell();
  const app = new Core();
  window.__APP = app;
  return app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startCore, { once: true });
} else {
  startCore();
}

export { Core, startCore, renderStartupShell };
