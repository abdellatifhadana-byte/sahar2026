// notifications.js
// نظام إشعارات Toast مرئي وقابل للبرمجة، يدعم كل أنواع الرسائل (نجاح/خطأ/تحذير/معلومة)

export class NotificationSystem {
  constructor() {
    this.notificationCenter = document.createElement('div');
    this.notificationCenter.className = 'notification-center';
    document.body.appendChild(this.notificationCenter);
    this.setupStyles();
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
    `;
    document.head.appendChild(style);
  }

  showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    const icon = this.getIconForType(type);
    notification.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">${message}</div>
      <button class="notification-close">&times;</button>
    `;
    this.notificationCenter.appendChild(notification);
    const timer = setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease-out';
      notification.addEventListener('animationend', () => notification.remove());
    }, duration);
    notification.querySelector('.notification-close').addEventListener('click', () => {
      clearTimeout(timer);
      notification.remove();
    });
    return () => {
      clearTimeout(timer);
      notification.remove();
    };
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
    notification.className = `notification notification-info`;
    notification.innerHTML = `
      <div class="notification-icon">
        <div class="loading-spinner"></div>
      </div>
      <div class="notification-content">${message}</div>
    `;
    this.notificationCenter.appendChild(notification);
    return () => notification.remove();
  }

  clearAllNotifications() {
    this.notificationCenter.innerHTML = '';
  }
}
