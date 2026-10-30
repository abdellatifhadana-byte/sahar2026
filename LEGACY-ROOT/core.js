// core.js
// نقطة التشغيل الرئيسية لمنصة 2M TECH Platform

import { db } from './db.js';
import Auth from './auth.js';
import AdminUI from './admin-ui.js';
import TechUI from './techui.js';
import ResponsibleUI from './responsible-ui.js';
import VisitorUI from './visitor-ui.js';
import { NotificationSystem } from './notifications.js';
import { eventSystem } from './events.js';
import { BackupService } from './backup-service.js';
import { PermissionManager } from './permissions.js';
// يمكنك استيراد المزيد مستقبلاً

class Core {
  constructor() {
    this.currentUser = null;
    this.notifications = new NotificationSystem();
    this.backupService = new BackupService();
    this.UIs = {};
    this.init();
  }

  async init() {
    try {
      await db.open();
      this.auth = new Auth();

      // التحقق من الجلسة أو تسجيل الدخول
      this.currentUser = await this.auth.checkSession();
      if (!this.currentUser) {
        this.currentUser = await this.auth.showLogin();
      }
      this.auth.hideLogin();

      // تفعيل كلاس الدور والثيم تلقائيًا
      this.applyRoleTheme(this.currentUser.role);

      // الأحداث العامة
      eventSystem.setupCoreEvents();
      this.setupGlobalEventListeners();

      // واجهة حسب الدور
      this.loadRoleSpecificUI();

      // نسخ احتياطي تلقائي أسبوعي
      this.backupService.startAutoBackup('weekly');

      // تحديثات مستقبلية
      this.checkForUpdates();

      // الخروج التلقائي عند الخمول
      this.setupIdleTimeout();

      // إشعارات النظام
      this.initSystemNotifications();

      // دعم إعادة تحميل الواجهة عند تحديث البيانات
      eventSystem.register('reload-application', () => window.location.reload());

    } catch (error) {
      this.notifications.showNotification(
        'Échec de l\'initialisation de l\'application', 'error'
      );
      this.showFatalError(error);
    }
  }

  /**
   * تطبيق كلاس الدور والثيم على body
   */
  applyRoleTheme(role) {
    // مسح جميع الكلاسات السابقة
    document.body.className = '';

    // ألوان مخصصة لكل دور
    let roleClass = 'theme-visitor';
    if (role === "admin" || role === "manager" || role === "responsable") roleClass = 'theme-admin';
    else if (role === "tech" || role === "technician") roleClass = 'theme-tech';
    else if (role === "responsible") roleClass = 'theme-responsible';
    else roleClass = 'theme-visitor';

    // تحديد الثيم المحفوظ (light/dark)
    let theme = localStorage.getItem('theme') || 'light';
    document.body.classList.add(roleClass, `${theme}-theme`);
  }

  /**
   * تحميل واجهة المستخدم حسب الدور
   */
  loadRoleSpecificUI() {
    const role = (this.currentUser?.role || '').toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'responsable') {
      this.UIs.admin = new AdminUI(this.currentUser, this.notifications, this.backupService);
    } else if (role === 'tech' || role === 'technician') {
      this.UIs.tech = new TechUI(this.currentUser, this.notifications);
    } else if (role === 'responsible') {
      this.UIs.responsible = new ResponsibleUI(this.currentUser, this.notifications);
    } else {
      this.UIs.visitor = new VisitorUI(this.currentUser, this.notifications);
    }
  }

  /**
   * ربط الأحداث العامة
   */
  setupGlobalEventListeners() {
    eventSystem.register('logout', () => this.logout());

    eventSystem.register('backup-restored', () => {
      this.notifications.showNotification('Backup restored!', 'success');
      setTimeout(() => window.location.reload(), 1000);
    });

    eventSystem.register('auto-backup-failed', ({ error }) => {
      this.notifications.showNotification('Backup failed: ' + error.message, 'error');
    });

    eventSystem.register('user-timeout', () => {
      this.notifications.showNotification('Déconnexion automatique pour inactivité', 'warning');
      setTimeout(() => this.logout(), 3000);
    });

    eventSystem.register('reload-ui', () => {
      window.location.reload();
    });

    // تبديل الثيم من أي واجهة
    eventSystem.register('toggle-theme', () => {
      this.toggleTheme();
    });
  }

  /**
   * تفعيل الخروج التلقائي عند الخمول (Inactivity Auto-Logout)
   */
  setupIdleTimeout() {
    let idleTimer;
    const getTimeout = () => {
      // ديناميكي من الإعدادات
      try {
        const settings = JSON.parse(localStorage.getItem('system-settings'));
        if (settings && settings.autoLogout) return settings.autoLogout * 60 * 1000;
      } catch {}
      return 30 * 60 * 1000; // 30 min افتراضي
    };
    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        this.notifications.showNotification(
          'Vous allez être déconnecté pour cause d\'inactivité', 'warning'
        );
        setTimeout(() => this.logout(), 30000);
      }, getTimeout());
    };
    ['mousemove', 'keypress', 'click', 'scroll'].forEach(event =>
      window.addEventListener(event, resetTimer)
    );
    resetTimer();
  }

  /**
   * تسجيل الخروج النهائي
   */
  logout() {
    localStorage.removeItem('auth');
    localStorage.removeItem('session');
    window.location.reload();
  }

  /**
   * إظهار رسالة خطأ حرجة
   */
  showFatalError(error) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="max-width:420px;background:#fff;padding:34px 38px 28px 38px;border-radius:12px;box-shadow:0 2px 10px #e5e7e9;text-align:center;">
          <h2 style="color:#e74c3c;">Erreur critique</h2>
          <p style="color:#b23232;font-size:16px;">${error.message || error}</p>
          <button class="btn" onclick="location.reload()">Recharger l'application</button>
        </div>
      </div>
    `;
  }

  /**
   * نقطة توسيع مستقبلية: فحص التحديثات أو ربط AI/AR/خدمات جديدة
   */
  async checkForUpdates() {
    // مستقبلاً: فحص النسخة/تحديثات/AI/AR
  }

  /**
   * دعم إرسال إشعارات ذكية مستقبلية
   */
  initSystemNotifications() {
    // إشعارات دورية/ذكاء اصطناعي/مهام...
  }

  /**
   * تبديل الثيم (يعمل من أي مكان في المنصة)
   */
  toggleTheme() {
    // احتفظ بكلاس الدور
    let roleClass = Array.from(document.body.classList).find(c => c.startsWith('theme-')) || 'theme-visitor';
    let isDark = document.body.classList.contains('dark-theme');
    let newTheme = isDark ? 'light-theme' : 'dark-theme';
    document.body.className = `${roleClass} ${newTheme}`;
    localStorage.setItem("theme", isDark ? "light" : "dark");
    this.notifications.showNotification(
      `Thème ${isDark ? 'clair' : 'sombre'} activé`, 'success'
    );
  }
}

// التشغيل الفوري عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  const app = new Core();
  window.__APP = app;
});
