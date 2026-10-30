// system-settings.js
import { db } from './db.js';
import { eventSystem } from './events.js';

export default class SystemSettings {
  constructor(notifications, backupService) {
    this.notifications = notifications;
    this.backupService = backupService;
    this.currentSettings = {
      id: 1,
      theme: 'light',
      language: 'fr',
      backupFrequency: 'weekly',
      autoLogout: 30,
      notifications: true,
      mapImageUrl: "assets/plan-technique.jpg", // الصورة الافتراضية
    };
  }

  async loadSettings() {
    try {
      const settings = await db.get('settings', 1);
      if (settings) {
        this.currentSettings = { ...this.currentSettings, ...settings };
        this.applySettings();
      }
    } catch (error) {
      console.error('Échec du chargement des paramètres:', error);
      this.notifications.showNotification('Erreur chargement des paramètres système', 'error');
    }
  }

  applySettings() {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${this.currentSettings.theme}-theme`);
    document.documentElement.lang = this.currentSettings.language;
    if (this.currentSettings.autoLogout > 0) this.setupAutoLogout();
  }

  setupAutoLogout() {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    this.logoutTimer = setTimeout(() => {
      eventSystem.dispatch('user-timeout');
    }, this.currentSettings.autoLogout * 60 * 1000);
  }

  async render() {
    await this.loadSettings();
    return `
      <div class="system-settings">
        <div class="settings-section">
          <h3><i class="fas fa-paint-brush"></i> Apparence</h3>
          <div class="settings-group">
            <label>Thème</label>
            <select id="theme-setting">
              <option value="light" ${this.currentSettings.theme === 'light' ? 'selected' : ''}>Clair</option>
              <option value="dark" ${this.currentSettings.theme === 'dark' ? 'selected' : ''}>Sombre</option>
            </select>
          </div>
          <div class="settings-group">
            <label>Langue</label>
            <select id="language-setting">
              <option value="fr" ${this.currentSettings.language === 'fr' ? 'selected' : ''}>Français</option>
              <option value="ar" ${this.currentSettings.language === 'ar' ? 'selected' : ''}>العربية</option>
              <option value="en" ${this.currentSettings.language === 'en' ? 'selected' : ''}>English</option>
            </select>
          </div>
          <div class="settings-group">
            <label>Image du plan (carte technique)</label>
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="${this.currentSettings.mapImageUrl || 'assets/plan-technique.jpg'}" id="plan-img-preview" style="width:120px;height:80px;border-radius:6px;border:1.5px solid #ddd;background:#fafbfd;object-fit:contain;">
              <input type="file" id="map-image-upload" accept="image/png,image/jpeg" style="display:none;">
              <button class="btn" id="upload-map-image-btn" title="Télécharger une nouvelle image"><i class="fas fa-upload"></i></button>
              <button class="btn" id="reset-map-image-btn" title="Image par défaut"><i class="fas fa-redo"></i></button>
            </div>
            <div style="margin-top:8px;">
              <input type="text" id="map-image-link" placeholder="Ou collez un lien d'image..." style="width:320px;" value="${this.currentSettings.mapImageUrl && !this.currentSettings.mapImageUrl.startsWith('assets/') ? this.currentSettings.mapImageUrl : ''}">
              <button class="btn" id="set-map-image-link-btn" style="margin-left:4px;">OK</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <h3><i class="fas fa-shield-alt"></i> Sécurité</h3>
          <div class="settings-group">
            <label>Déconnexion auto (minutes)</label>
            <input type="number" id="autologout-setting" value="${this.currentSettings.autoLogout}" min="0" max="240">
          </div>
          <div class="settings-group">
            <label>
              <input type="checkbox" id="notifications-setting" ${this.currentSettings.notifications ? 'checked' : ''}>
              Activer les notifications
            </label>
          </div>
        </div>
        <div class="settings-section">
          <h3><i class="fas fa-database"></i> Données</h3>
          <div class="settings-group">
            <label>Fréquence Backup</label>
            <select id="backup-frequency-setting">
              <option value="daily" ${this.currentSettings.backupFrequency === 'daily' ? 'selected' : ''}>Quotidien</option>
              <option value="weekly" ${this.currentSettings.backupFrequency === 'weekly' ? 'selected' : ''}>Hebdomadaire</option>
              <option value="monthly" ${this.currentSettings.backupFrequency === 'monthly' ? 'selected' : ''}>Mensuel</option>
            </select>
          </div>
          <div class="settings-actions">
            <button id="create-backup-btn" class="btn"><i class="fas fa-save"></i> Backup maintenant</button>
            <button id="restore-backup-btn" class="btn"><i class="fas fa-upload"></i> Restaurer backup</button>
          </div>
        </div>
        <div class="settings-footer">
          <button id="save-settings-btn" class="btn btn-primary">Enregistrer</button>
          <button id="reset-settings-btn" class="btn">Restaurer défaut</button>
        </div>
        <input type="file" id="backup-file-input" accept=".json" style="display: none;">
      </div>
    `;
  }

  async afterRender() {
    this.bindSettingsForm();
    this.bindBackupActions();
    this.bindMapImageActions();
  }

  bindSettingsForm() {
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
      await this.saveSettings();
    });
    document.getElementById('reset-settings-btn').addEventListener('click', async () => {
      if (confirm('Restaurer les paramètres par défaut ?')) await this.resetSettings();
    });
    document.getElementById('theme-setting').addEventListener('change', (e) => {
      document.body.classList.remove('light-theme', 'dark-theme');
      document.body.classList.add(`${e.target.value}-theme`);
    });
  }

  bindBackupActions() {
    document.getElementById('create-backup-btn').addEventListener('click', async () => {
      try {
        this.notifications.showNotification('Backup en cours...', 'info');
        await this.backupService.exportToFile();
        this.notifications.showNotification('Backup créé avec succès', 'success');
      } catch (error) {
        this.notifications.showNotification(`Erreur backup: ${error.message}`, 'error');
      }
    });
    document.getElementById('restore-backup-btn').addEventListener('click', () => {
      document.getElementById('backup-file-input').click();
    });
    document.getElementById('backup-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (confirm('Attention: toutes les données actuelles seront écrasées. Continuer ?')) {
        try {
          this.notifications.showNotification('Restauration...', 'info');
          await this.backupService.importFromFile(file);
          this.notifications.showNotification('Backup restauré avec succès', 'success');
          eventSystem.dispatch('reload-application');
        } catch (error) {
          this.notifications.showNotification(`Erreur: ${error.message}`, 'error');
        }
      }
      e.target.value = '';
    });
  }

  bindMapImageActions() {
    // زر رفع صورة جديدة
    document.getElementById('upload-map-image-btn').onclick = () => {
      document.getElementById('map-image-upload').click();
    };
    document.getElementById('map-image-upload').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        this.notifications.showNotification("Le fichier doit être une image", "error");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.notifications.showNotification("Taille max: 2Mo", "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = async (evt) => {
        document.getElementById('plan-img-preview').src = evt.target.result;
        document.getElementById('map-image-link').value = "";
        this.currentSettings.mapImageUrl = evt.target.result;
        await this.saveSettings(false);
        this.notifications.showNotification("Image du plan modifiée", "success");
      };
      reader.readAsDataURL(file);
    };
    // زر استرجاع الصورة الافتراضية
    document.getElementById('reset-map-image-btn').onclick = async () => {
      this.currentSettings.mapImageUrl = "assets/plan-technique.jpg";
      document.getElementById('plan-img-preview').src = "assets/plan-technique.jpg";
      document.getElementById('map-image-link').value = "";
      await this.saveSettings(false);
      this.notifications.showNotification("Image réinitialisée", "success");
    };
    // زر تعيين رابط صورة
    document.getElementById('set-map-image-link-btn').onclick = async () => {
      const url = document.getElementById('map-image-link').value.trim();
      if (!url) {
        this.notifications.showNotification("Collez le lien d'une image.", "error");
        return;
      }
      // تحقق من أن الرابط صورة
      if (!url.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
        this.notifications.showNotification("Lien non valide (doit être une image)", "error");
        return;
      }
      document.getElementById('plan-img-preview').src = url;
      this.currentSettings.mapImageUrl = url;
      await this.saveSettings(false);
      this.notifications.showNotification("Image du plan modifiée", "success");
    };
  }

  async saveSettings(showSuccess = true) {
    // ادمج كل الخصائص (بما فيها صورة الخريطة)
    const newSettings = {
      ...this.currentSettings,
      id: 1,
      theme: document.getElementById('theme-setting').value,
      language: document.getElementById('language-setting').value,
      autoLogout: parseInt(document.getElementById('autologout-setting').value),
      notifications: document.getElementById('notifications-setting').checked,
      backupFrequency: document.getElementById('backup-frequency-setting').value,
      mapImageUrl: this.currentSettings.mapImageUrl,
      updatedAt: new Date()
    };
    try {
      await db.save('settings', newSettings);
      this.currentSettings = newSettings;
      this.applySettings();
      if (showSuccess) this.notifications.showNotification('Paramètres enregistrés', 'success');
    } catch (error) {
      this.notifications.showNotification(`Erreur: ${error.message}`, 'error');
    }
  }

  async resetSettings() {
    const defaultSettings = {
      id: 1,
      theme: 'light',
      language: 'fr',
      autoLogout: 30,
      notifications: true,
      backupFrequency: 'weekly',
      mapImageUrl: "assets/plan-technique.jpg",
      updatedAt: new Date()
    };
    try {
      await db.save('settings', defaultSettings);
      this.currentSettings = defaultSettings;
      this.applySettings();
      this.notifications.showNotification('Paramètres par défaut appliqués', 'success');
      this.afterRender();
    } catch (error) {
      this.notifications.showNotification(`Erreur: ${error.message}`, 'error');
    }
  }
}
