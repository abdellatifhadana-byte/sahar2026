import { db } from './db.js';
import { startupLogoMarkup } from './startup-splash.js';
import { startupProgress, STARTUP_PHASES } from './startup-progress.js';

const PRIVATE_LOCAL_STORES = [
  'users','rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','docs','faq','notifications','logs','attachments',
  'cables','cable_reports','syncQueue'
];

export default class Auth {
  constructor() {
    this.form = null;
    this.errorDiv = null;
    this.usernameInput = null;
    this.passwordInput = null;
  }

  async clearStore(storeName) {
    await db.open();
    if (!db.db?.objectStoreNames.contains(storeName)) return;
    await new Promise((resolve, reject) => {
      const request = db.db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearLocalCredentialCache() {
    try { await this.clearStore('users'); }
    catch (error) { console.warn('Impossible de purger le cache local des identités.', error); }
  }

  async clearPrivateLocalData() {
    try {
      await db.open();
      for (const storeName of PRIVATE_LOCAL_STORES) await this.clearStore(storeName);
      if (db.db?.objectStoreNames.contains('settings')) {
        const global = await db._getRaw('settings', 'global').catch(() => null);
        await this.clearStore('settings');
        if (global) await db.save('settings', { ...global, id: 'global' });
      }
      localStorage.removeItem('zone-access-context');
    } catch (error) {
      console.warn('Impossible de purger toutes les données privées locales.', error);
    }
  }

  async syncCentralSafely(options = {}) {
    if (typeof db.enableCentralSync !== 'function') return { enabled: false, reason: 'Synchronisation centrale indisponible' };
    try {
      return await db.enableCentralSync(options);
    } catch (error) {
      console.warn('Connexion validée, mais la synchronisation centrale est temporairement indisponible.', error);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('central-sync-status', {
          detail: { state: 'warning', message: 'Session ouverte. Synchronisation des données en attente.' }
        }));
      }
      return { enabled: false, reason: error.message || 'Synchronisation en attente' };
    }
  }

  async login(username, password) {
    await db.open();
    const cleanUsername = String(username || '').trim();

    let response;
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password })
      });
    } catch (error) {
      console.warn('Authentification centrale indisponible.', error);
      throw new Error('Connexion au serveur central requise pour ouvrir une nouvelle session. Réessayez lorsque le réseau est disponible.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.user) {
      if (response.status === 503) throw new Error(payload.message || 'Serveur central temporairement indisponible.');
      throw new Error(payload.message || "Nom d'utilisateur ou mot de passe incorrect");
    }

    const userData = payload.user;
    localStorage.setItem('auth', JSON.stringify(userData));
    await this.clearLocalCredentialCache();
    await this.syncCentralSafely({ bootstrapLocal: true });
    this.applyRoleTheme(userData.role);
    return userData;
  }

  async checkSession() {
    const local = localStorage.getItem('auth');
    let localUser = null;
    try { localUser = local ? JSON.parse(local) : null; }
    catch { localStorage.removeItem('auth'); }

    // L'absence de session locale avant connexion est un état anonyme normal.
    // Ne pas provoquer un GET /api/auth/session → 401 à chaque arrivée sur l'écran de connexion.
    if (!localUser) {
      localStorage.removeItem('session');
      return null;
    }

    try {
      const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.user) {
        localStorage.setItem('auth', JSON.stringify(payload.user));
        await db.open();
        await this.clearLocalCredentialCache();
        await this.syncCentralSafely({ bootstrapLocal: true });
        this.applyRoleTheme(payload.user.role);
        return payload.user;
      }
      if (response.status === 401 && payload.error === 'UNAUTHENTICATED') {
        localStorage.removeItem('auth');
        localStorage.removeItem('session');
        await this.clearPrivateLocalData();
        return null;
      }
    } catch (error) {
      console.warn('Serveur central indisponible : la session locale déjà ouverte est conservée temporairement.', error);
    }

    await db.open();
    this.applyRoleTheme(localUser.role);
    return localUser;
  }

  applyRoleTheme(role) {
    let roleClass = 'theme-visitor';
    if (role === 'admin' || role === 'manager') roleClass = 'theme-admin';
    else if (role === 'tech' || role === 'technician') roleClass = 'theme-tech';
    else if (role === 'responsible' || role === 'responsable') roleClass = 'theme-responsible';
    const themeClass = localStorage.getItem('theme') === 'dark' ? 'dark-theme' : 'light-theme';
    document.body.className = `${roleClass} ${themeClass}`;
  }

  /**
   * Unique page de connexion de la plateforme.
   *
   * Elle était auparavant éclatée sur cinq fichiers : une implémentation ici, une seconde
   * qui l'écrasait dans `compat-integrations.js`, et trois couches de style empilées
   * (`ui-refresh.css`, `ui-final.css`, `ui-tune.css`) totalisant plus de quarante
   * déclarations `!important`. Cet empilement produisait trois défauts concrets :
   *
   * - le sous-titre n'existait que comme `content:` d'un pseudo-élément : ni sélectionnable,
   *   ni traduisible, absent du DOM et donc des outils d'accessibilité ;
   * - les icônes des champs étaient liées à `:nth-of-type(1)` et `(2)` : ajouter ou
   *   réordonner un champ les déplaçait en silence sur le mauvais ;
   * - le symbole affiché était une image bitmap (`images/2m-logo.webp`) tandis que l'écran
   *   de démarrage dessine le logo en vectoriel — deux représentations de la même marque.
   *
   * Tout est désormais ici, en balisage réel, avec le symbole vectoriel de la plateforme.
   */
  showLogin() {
    document.getElementById('app').innerHTML = `
      <main id="login-box" class="login-screen" role="main">
        <div class="login-card">
          <div class="login-brand">
            <span class="login-mark">${startupLogoMarkup({ compact:true, revealed:true })}</span>
            <h2>2M TECH Platform</h2>
            <p class="login-subtitle">Plateforme de gestion technique et opérationnelle</p>
          </div>
          <div id="login-error" class="login-error" role="alert" aria-live="assertive" hidden></div>
          <form id="login-form" novalidate>
            <div class="form-group login-field" data-field="username">
              <label for="login-username">Nom d'utilisateur</label>
              <input id="login-username" name="username" type="text" autocomplete="username" required autocapitalize="none" spellcheck="false">
            </div>
            <div class="form-group login-field" data-field="password">
              <label for="login-password">Mot de passe</label>
              <input id="login-password" name="password" type="password" autocomplete="current-password" required>
            </div>
            <button id="login-submit" class="btn login-submit" type="submit">Se connecter</button>
            <p id="login-progress" class="login-progress" aria-live="polite" hidden></p>
          </form>
        </div>
      </main>`;
    this.form = document.getElementById('login-form');
    this.errorDiv = document.getElementById('login-error');
    this.usernameInput = document.getElementById('login-username');
    this.passwordInput = document.getElementById('login-password');
    const submitButton = document.getElementById('login-submit');
    const progress = document.getElementById('login-progress');
    this.usernameInput.focus();

    return new Promise(resolve => {
      let inFlight = false;
      this.form.onsubmit = async event => {
        event.preventDefault();
        // Un double clic lançait deux authentifications concurrentes, donc deux
        // synchronisations initiales complètes.
        if (inFlight) return;
        inFlight = true;
        submitButton.disabled = true;
        this.errorDiv.hidden = true;
        // L'écran de connexion remplace le splash : sans ce retour, la synchronisation
        // initiale — l'étape la plus longue du démarrage — se déroulait devant un
        // formulaire figé, sans aucune indication.
        progress.textContent = 'Vérification des identifiants…';
        progress.hidden = false;
        // Le message suivait un CHRONOMÈTRE : « Synchronisation de vos données… »
        // s'affichait au bout de 900 ms, que la synchronisation ait commencé ou non, puis
        // ne bougeait plus — le même défaut que la barre de l'écran de démarrage, à un
        // autre endroit. Il suit maintenant le travail réel : la synchronisation initiale
        // s'exécute ICI, dans `login()`, et pèse à elle seule les deux tiers du démarrage
        // (285,5 kio mesurés, 864 ms sur une liaison à 400 kio/s).
        const desabonner = startupProgress.subscribe(etat => {
          if (etat.phase === STARTUP_PHASES.AWAITING_HUMAN || !etat.status) return;
          progress.textContent = `${etat.status} ${etat.value}%`;
        });
        try {
          const user = await this.login(this.usernameInput.value, this.passwordInput.value);
          desabonner();
          progress.textContent = 'Ouverture de votre espace…';
          resolve(user);
        } catch (error) {
          desabonner();
          progress.hidden = true;
          this.errorDiv.textContent = error.message;
          this.errorDiv.hidden = false;
          submitButton.disabled = false;
          inFlight = false;
          this.passwordInput.value = '';
          this.passwordInput.focus();
        }
      };
    });
  }

  hideLogin() { document.getElementById('app').style.display = 'block'; }

  showSuccess(message) {
    if (!this.errorDiv) return;
    this.errorDiv.style.display = 'block'; this.errorDiv.style.color = '#27ae60'; this.errorDiv.textContent = message;
    setTimeout(() => { this.errorDiv.style.display = 'none'; this.errorDiv.style.color = '#e74c3c'; }, 1500);
  }

  async logout() {
    try {
      if (typeof db.enableCentralSync === 'function') await db.enableCentralSync({ bootstrapLocal: false });
    } catch (error) {
      console.warn('Certaines modifications hors ligne n’ont pas pu être envoyées avant la déconnexion.', error);
    }

    // Une dernière poussée vient d'avoir lieu ci-dessus ; ce qui reste en vol appartient
    // à la session qui se ferme et ne doit plus aboutir sous son identité.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('platform-session-closing'));
    }

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true
      });
    } catch (error) {
      console.warn('Déconnexion centrale indisponible, fermeture de la session locale.', error);
    } finally {
      localStorage.removeItem('auth');
      localStorage.removeItem('session');
      localStorage.removeItem('central-sync-initialized');
      await this.clearPrivateLocalData();
      document.body.className = 'theme-visitor light-theme';
      window.location.replace('/');
    }
  }
}
