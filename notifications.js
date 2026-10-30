// notifications.js
// Système de notifications Toast visuel et programmable.

export class NotificationSystem {
  constructor() {
    this.notificationCenter = document.createElement('div');
    this.notificationCenter.className = 'notification-center';
    document.body.appendChild(this.notificationCenter);
    this.setupStyles();
    this.relayBackgroundFailures();
  }

  // Les écritures d'arrière-plan qui échouent — journal refusé, modification rejetée par le
  // serveur — n'avaient d'autre trace que la console et une pastille de statut absente de la
  // plupart des pages. L'utilisateur croyait son action perdue, ou pire, ne savait pas
  // qu'une partie ne l'était pas. Ces refus remontent ici, sur le même canal visible que le
  // reste, sans interrompre l'opération qui, elle, a abouti.
  relayBackgroundFailures() {
    if (typeof window === 'undefined') return;
    window.addEventListener('log-write-failed', () => {
      this.showNotification("Action effectuée, mais sa trace n'a pas pu être enregistrée au journal.", 'warning');
    });
    // DEUX ÉTATS ARRIVENT ICI, ET LES DEUX DOIVENT SE VOIR.
    //
    // `warning` — une écriture rejetée pour une raison qui lui est propre.
    // `conflict` — quelqu'un d'autre a modifié la même donnée entre-temps. La copie locale
    //   est déjà revenue à la version du serveur ; ce qui reste à faire est humain, et la
    //   phrase émise le dit. Ne relayer que `warning` laissait ce refus sans destinataire :
    //   la saisie disparaissait de l'écran sans un mot, ce qui ressemble à une panne alors
    //   que c'est une protection.
    //
    // Les autres états — `synced`, `offline`, `local` — reviennent à chaque cycle de
    // synchronisation, toutes les vingt secondes. Les afficher noierait le canal.
    window.addEventListener('central-sync-status', event => {
      const etat = event.detail?.state;
      if (!['warning', 'conflict'].includes(etat) || !event.detail?.message) return;
      this.showNotification(event.detail.message, 'warning');
    });
    // `map-admin-entity-edit.js` bascule sur cet événement lorsqu'il ne trouve pas
    // d'interface à qui parler. Personne ne l'écoutait : le message d'une modification
    // faite depuis la carte disparaissait purement et simplement.
    window.addEventListener('platform-notification', event => {
      const message = event.detail?.message;
      if (message) this.showNotification(message, event.detail?.type || 'info');
    });
    // Une image d'équipement qui ne charge pas affiche déjà un substitut à sa place ;
    // mais l'échec lui-même n'atteignait personne, donc rien n'invitait à corriger le lien.
    window.addEventListener('equipment-media-runtime-failure', event => {
      const raison = event.detail?.reason || 'source indisponible';
      this.showNotification(`Média d'équipement illisible : ${raison}`, 'warning');
    });
  }

  setupStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .notification-center {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        max-width: 90vw;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .notification {
        position: relative;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
        display: flex;
        align-items: center;
        overflow: hidden;
      }
      .notification::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0; width: 5px;
      }
      .notification-success { background-color: #2ecc71; }
      .notification-success::before { background-color: #27ae60; }
      .notification-error { background-color: #e74c3c; }
      .notification-error::before { background-color: #c0392b; }
      .notification-warning { background-color: #f39c12; }
      .notification-warning::before { background-color: #d35400; }
      .notification-info { background-color: #3498db; }
      .notification-info::before { background-color: #2980b9; }
      .notification-icon { margin-right: 15px; font-size: 1.5em; }
      .notification-content { flex: 1; }
      .notification-close {
        background: none;
        border: none;
        color: inherit;
        font-size: 1.2em;
        cursor: pointer;
        margin-left: 10px;
        opacity: 0.7;
      }
      .notification-close:hover { opacity: 1; }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(30px); }
      }
    `;
    document.head.appendChild(style);
  }

  showNotification(message, type = 'info', duration = 5000) {
    const normalizedMessage = String(message);

    // Évite d'empiler deux notifications strictement identiques.
    const duplicate = Array.from(this.notificationCenter.querySelectorAll('.notification')).find(item =>
      item.dataset.type === type && item.querySelector('.notification-content')?.textContent === normalizedMessage
    );
    if (duplicate) {
      duplicate.animate?.([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(0)' }
      ], { duration: 180 });
      return () => duplicate.remove();
    }

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.dataset.type = type;

    const iconElement = document.createElement('div');
    iconElement.className = 'notification-icon';
    iconElement.innerHTML = this.getIconForType(type);

    const content = document.createElement('div');
    content.className = 'notification-content';
    content.textContent = normalizedMessage;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'notification-close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = '×';

    notification.append(iconElement, content, closeButton);
    this.notificationCenter.appendChild(notification);

    // Garde la zone lisible : au maximum 4 notifications simultanées.
    const active = Array.from(this.notificationCenter.querySelectorAll('.notification'));
    while (active.length > 4) active.shift()?.remove();

    let timer = null;
    if (duration > 0) timer = setTimeout(() => this.dismiss(notification), duration);

    closeButton.addEventListener('click', () => {
      if (timer) clearTimeout(timer);
      notification.remove();
    });

    return () => {
      if (timer) clearTimeout(timer);
      notification.remove();
    };
  }

  dismiss(notification) {
    if (!notification?.isConnected) return;
    notification.style.animation = 'fadeOut 0.25s ease-out forwards';
    notification.addEventListener('animationend', () => notification.remove(), { once: true });
    setTimeout(() => notification.remove(), 320);
  }

  getIconForType(type) {
    const icons = {
      success: '<i class="fas fa-check-circle"></i>',
      error: '<i class="fas fa-exclamation-circle"></i>',
      warning: '<i class="fas fa-exclamation-triangle"></i>',
      info: '<i class="fas fa-info-circle"></i>'
    };
    return icons[type] || icons.info;
  }

  showPersistentNotification(message, type = 'info') {
    return this.showNotification(message, type, 0);
  }

  showLoadingNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification notification-info';
    notification.dataset.type = 'info';
    const icon = document.createElement('div');
    icon.className = 'notification-icon';
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    icon.appendChild(spinner);
    const content = document.createElement('div');
    content.className = 'notification-content';
    content.textContent = String(message);
    notification.append(icon, content);
    this.notificationCenter.appendChild(notification);
    return () => notification.remove();
  }

  clearAllNotifications() {
    this.notificationCenter.innerHTML = '';
  }
}
