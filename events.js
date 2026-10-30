/**
 * Centralized Event System
 * Manages all application events and communication between components
 */
class EventSystem {
  constructor() {
    this.events = {};
    this.history = [];
    this.maxHistory = 100;
  }

  // Register an event handler
  register(eventName, callback, options = {}) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }

    const handler = {
      callback,
      once: options.once || false,
      async: options.async || false
    };

    this.events[eventName].push(handler);
    return () => this.unregister(eventName, callback);
  }

  // Register a one-time event handler
  once(eventName, callback) {
    return this.register(eventName, callback, { once: true });
  }

  // Unregister an event handler
  unregister(eventName, callback) {
    if (this.events[eventName]) {
      this.events[eventName] = this.events[eventName].filter(
        handler => handler.callback !== callback
      );
    }
  }

  // Dispatch an event
  async dispatch(eventName, data = null) {
    // Add to history
    this.history.push({
      event: eventName,
      data,
      timestamp: new Date()
    });

    // Keep history size limited
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Execute handlers
    if (this.events[eventName]) {
      for (const handler of [...this.events[eventName]]) {
        try {
          if (handler.async) {
            await handler.callback(data);
          } else {
            handler.callback(data);
          }

          if (handler.once) {
            this.unregister(eventName, handler.callback);
          }
        } catch (error) {
          console.error(`Error in ${eventName} handler:`, error);
        }
      }
    }
  }

  // Setup core system events
  //
  // Idempotent : cette méthode est appelée à l'import du module ET par `core.js`. Sans
  // garde, chaque gestionnaire était enregistré deux fois — `reload-application` en
  // comptait trois, d'où trois rechargements après une restauration de sauvegarde.
  setupCoreEvents() {
    if (this._coreEventsInstalled) return;
    this._coreEventsInstalled = true;
    // Database events
    this.register('database-connected', () => {
      console.log('Database connection established');
    });

    this.register('database-error', (error) => {
      console.error('Database error:', error);
    });

    // Authentication events
    this.register('user-login', (user) => {
      console.log(`User logged in: ${user.username}`);
    });

    this.register('user-logout', () => {
      console.log('User logged out');
    });

    this.register('user-timeout', () => {
      this.dispatch('user-logout');
      // Le seul message de cette famille qui restait en anglais : il s'affichait tel quel,
      // en toutes lettres, à côté de l'avis français que `core.js` publie pour le même
      // événement. Deux avis pour une seule déconnexion, dont un dans la mauvaise langue.
      this.dispatch('show-notification', {
        message: "Session expirée pour cause d'inactivité",
        type: 'warning'
      });
    });

    // UI events
    // Ce gestionnaire était vide : `show-notification` n'atteignait donc personne, et les
    // avis de création ou de changement d'état d'une demande étaient silencieusement
    // perdus. Il relaie désormais vers le système de notifications réel.
    this.register('show-notification', (notification = {}) => {
      const message = notification.message || notification.text || notification.title;
      if (!message) return;
      const notifier = typeof window !== 'undefined' ? window.__APP?.notifications : null;
      if (notifier?.showNotification) notifier.showNotification(message, notification.type || 'info');
      else if (typeof window !== 'undefined') window.AppDialog?.notice?.(message, notification.type || 'info');
    });

    // `theme` était toujours indéfini : les appelants ne transmettent aucune charge utile,
    // si bien que ce gestionnaire retirait les classes de thème et ajoutait
    // `undefined-theme`. Sans valeur explicite, il n'y a rien à faire ici.
    this.register('toggle-theme', (payload = {}) => {
      const theme = payload.theme;
      if (theme !== 'light' && theme !== 'dark') return;
      document.body.classList.remove('light-theme', 'dark-theme');
      document.body.classList.add(`${theme}-theme`);
    });

    // System events
    this.register('reload-application', () => {
      window.location.reload();
    });

    this.register('offline-mode', (isOffline) => {
      console.log(`Application is ${isOffline ? 'offline' : 'online'}`);
    });
  }

  // Get event history
  getEventHistory() {
    return [...this.history];
  }

  // Clear all event handlers
  clear() {
    this.events = {};
    this.history = [];
  }
}

// Create singleton instance
export const eventSystem = new EventSystem();

// Initialize core events when loaded
eventSystem.setupCoreEvents();