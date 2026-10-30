import { eventSystem } from './events.js';
import { resolveMapImageUrl } from './map-image-store.js';
import {
  getPlatformSettings, savePlatformSettings, platformSettingsDefaults,
  PLATFORM_SETTINGS_ID
} from './settings-contract.js';

const MAX_MAP_IMAGE_BYTES = 12 * 1024 * 1024;
// Taille lisible. La plateforme manipulait des limites en octets — 3 Mo pour une image de
// mur — sans jamais les afficher autrement qu'en chiffres bruts.
const formatOctets = value => {
  const octets = Number(value);
  if (!Number.isFinite(octets) || octets < 0) return '—';
  const unites = ['o', 'Ko', 'Mo', 'Go'];
  let index = 0; let taille = octets;
  while (taille >= 1024 && index < unites.length - 1) { taille /= 1024; index += 1; }
  return `${index === 0 ? Math.round(taille) : taille.toFixed(1).replace('.', ',')} ${unites[index]}`;
};

const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
})[character]);

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Lecture de l'image impossible."));
    reader.onload = event => {
      const dataUrl = String(event.target?.result || '');
      const image = new Image();
      image.onerror = () => reject(new Error("L'image ne peut pas être décodée."));
      image.onload = () => resolve({ dataUrl, width:image.naturalWidth, height:image.naturalHeight });
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function inspectImageReference(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width:image.naturalWidth, height:image.naturalHeight });
    image.onerror = () => reject(new Error("L'image indiquée n'est pas accessible."));
    image.src = url;
  });
}

export default class SystemSettings {
  constructor(notifications, backupService) {
    this.notifications = notifications;
    this.backupService = backupService;
    this.currentSettings = platformSettingsDefaults();
  }

  async loadSettings() {
    try {
      this.currentSettings = await getPlatformSettings();
      this.applySettings();
    } catch (error) {
      console.error('Échec du chargement des paramètres:', error);
      this.notifications.showNotification('Erreur de chargement des paramètres système.', 'error');
    }
  }

  applySettings() {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${this.currentSettings.theme}-theme`);
    document.documentElement.lang = 'fr';
    document.documentElement.dir = 'ltr';
    localStorage.setItem('theme', this.currentSettings.theme);
    localStorage.setItem('system-settings', JSON.stringify({
      autoLogout:this.currentSettings.autoLogout,
      notifications:this.currentSettings.notifications,
      backupFrequency:this.currentSettings.backupFrequency
    }));
    // Le minuteur d'inactivité appartient à `core.js`, qui le réarme à chaque action de
    // l'utilisateur. Celui qui vivait ici n'était jamais réarmé : il déconnectait
    // l'administrateur en pleine saisie, exactement au délai configuré. Il est supprimé,
    // et un événement signale le changement pour que le minuteur légitime se recale.
    eventSystem.dispatch('platform-settings-updated', { settings: this.currentSettings });
  }

  async render() {
    await this.loadSettings();
    const mapWidth = this.currentSettings.mapImageWidth;
    const mapHeight = this.currentSettings.mapImageHeight;
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
            <label>Langue de la plateforme</label>
            <div class="form-control" aria-label="Langue de la plateforme">Français</div>
            <small>L'interface opérationnelle 2M TECH est normalisée en français.</small>
          </div>
          <div class="settings-group">
            <label>Image du plan — carte technique</label>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <img src="assets/image-indisponible.svg" alt="Aperçu du plan technique" id="plan-img-preview" style="width:160px;height:100px;border-radius:8px;border:1.5px solid #ddd;background:#fafbfd;object-fit:contain;">
              <input type="file" id="map-image-upload" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;">
              <button class="btn" id="upload-map-image-btn"><i class="fas fa-upload"></i> Importer</button>
              <button class="btn gray" id="reset-map-image-btn"><i class="fas fa-redo"></i> Plan par défaut</button>
            </div>
            <small id="map-image-metadata">${mapWidth && mapHeight ? `${mapWidth} × ${mapHeight} px · ` : ''}jusqu'à 12 Mo. Les proportions originales sont conservées.</small>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              <input type="url" id="map-image-link" placeholder="Ou saisir l'URL d'une image…" style="min-width:min(420px,100%);flex:1;" value="${escapeHTML(/^https?:/i.test(this.currentSettings.mapImageUrl) ? this.currentSettings.mapImageUrl : '')}">
              <button class="btn" id="set-map-image-link-btn">Appliquer l'URL</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <h3><i class="fas fa-shield-alt"></i> Sécurité</h3>
          <div class="settings-group"><label>Déconnexion automatique (minutes)</label><input type="number" id="autologout-setting" value="${this.currentSettings.autoLogout}" min="0" max="240"></div>
          <div class="settings-group"><label><input type="checkbox" id="notifications-setting" ${this.currentSettings.notifications ? 'checked' : ''}> Activer les notifications</label></div>
        </div>
        <div class="settings-section">
          <h3><i class="fas fa-database"></i> Données</h3>
          <div class="settings-group">
            <label>Fréquence des sauvegardes</label>
            <select id="backup-frequency-setting">
              <option value="daily" ${this.currentSettings.backupFrequency === 'daily' ? 'selected' : ''}>Quotidienne</option>
              <option value="weekly" ${this.currentSettings.backupFrequency === 'weekly' ? 'selected' : ''}>Hebdomadaire</option>
              <option value="monthly" ${this.currentSettings.backupFrequency === 'monthly' ? 'selected' : ''}>Mensuelle</option>
            </select>
          </div>
          <div class="settings-actions">
            <button id="create-backup-btn" class="btn"><i class="fas fa-save"></i> Sauvegarder maintenant</button>
            <button id="restore-backup-btn" class="btn"><i class="fas fa-upload"></i> Restaurer un fichier</button>
          </div>
          <!-- Les sauvegardes conservées étaient invisibles : la sauvegarde automatique
               déclenchait un téléchargement que le navigateur bloque, et rien n'en
               restait. Elles sont maintenant écrites dans la plateforme, donc elles
               doivent s'y voir — et se restaurer sans passer par un fichier. -->
          <div class="settings-block" id="backup-list-block">
            <label>Sauvegardes conservées</label>
            <div id="backup-list" class="backup-list" aria-live="polite">Chargement…</div>
          </div>
        </div>
        <div class="settings-footer"><button id="save-settings-btn" class="btn btn-primary">Enregistrer</button><button id="reset-settings-btn" class="btn gray">Restaurer les valeurs par défaut</button></div>
        <input type="file" id="backup-file-input" accept=".json" style="display:none;">
      </div>`;
  }

  /**
   * L'APERÇU DU PLAN PASSE PAR LA MÊME PORTE QUE LA CARTE.
   *
   * Il affichait `this.currentSettings.mapImageUrl` — c'est-à-dire, sur une installation
   * ordinaire, le chemin `assets/plan-technique.PNG`. Ce chemin n'est plus servi : l'aperçu
   * serait devenu une image cassée. Et le rétablir en actif public rouvrirait exactement la
   * fuite que ce lot ferme.
   *
   * On demande donc les octets comme la carte les demande. Un refus laisse le visuel neutre
   * en place : l'écran des réglages n'est pas un contournement.
   */
  async rafraichirApercuDuPlan() {
    const apercu = document.getElementById('plan-img-preview');
    if (!apercu) return;
    let octets = '';
    try { octets = await resolveMapImageUrl(this.currentSettings) || ''; } catch { octets = ''; }
    apercu.src = octets || 'assets/image-indisponible.svg';
    apercu.alt = octets ? 'Aperçu du plan technique' : 'Plan technique indisponible dans votre périmètre';
  }

  async afterRender() {
    this.bindSettingsForm();
    await this.bindBackupActions();
    this.bindMapImageActions();
    await this.rafraichirApercuDuPlan();
  }

  bindSettingsForm() {
    document.getElementById('save-settings-btn')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
      const accepted = window.AppDialog ? await window.AppDialog.confirm('Restaurer les paramètres par défaut ?') : confirm('Restaurer les paramètres par défaut ?');
      if (accepted) await this.resetSettings();
    });
    document.getElementById('theme-setting')?.addEventListener('change', event => {
      document.body.classList.remove('light-theme', 'dark-theme');
      document.body.classList.add(`${event.target.value}-theme`);
    });
  }

  async bindBackupActions() {
    document.getElementById('create-backup-btn')?.addEventListener('click', async () => {
      try {
        this.notifications.showNotification('Sauvegarde en cours…', 'info');
        // Conservée dans la plateforme, plus seulement téléchargée : une sauvegarde qui
        // n'existe que dans le dossier Téléchargements de l'utilisateur n'est pas une
        // sauvegarde de la plateforme.
        const record = await this.backupService.storeBackup({ reason:'manuelle' });
        this.notifications.showNotification(`Sauvegarde conservée (${formatOctets(record.sizeBytes)}).`, 'success');
        await this.refreshBackupList();
      } catch (error) { this.notifications.showNotification(`Erreur de sauvegarde : ${error.message}`, 'error'); }
    });
    await this.refreshBackupList();
    this.bindBackupAnnouncements();
    document.getElementById('restore-backup-btn')?.addEventListener('click', () => document.getElementById('backup-file-input')?.click());
    document.getElementById('backup-file-input')?.addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      const accepted = window.AppDialog
        ? await window.AppDialog.confirm('La restauration est additive : les enregistrements du fichier seront ajoutés ou mis à jour. Continuer ?')
        : confirm('La restauration est additive : les enregistrements du fichier seront ajoutés ou mis à jour. Continuer ?');
      if (accepted) {
        try {
          this.notifications.showNotification('Restauration en cours…', 'info');
          const report = await this.backupService.importFromFile(file);
          // Rendre compte de ce qui s'est réellement passé : annoncer un succès complet
          // alors que des enregistrements ont été rejetés masquait une restauration
          // partielle et incohérente.
          const parts = [`${report.restored} enregistrement(s) restauré(s)`];
          if (report.skipped) parts.push(`${report.skipped} demande(s) laissée(s) au serveur`);
          if (report.failed) parts.push(`${report.failed} rejeté(s)`);
          this.notifications.showNotification(parts.join(' · '), report.failed ? 'warning' : 'success');
          if (report.failed) console.warn('Enregistrements rejetés pendant la restauration', report.errors);
          eventSystem.dispatch('reload-application');
        } catch (error) { this.notifications.showNotification(`Erreur : ${error.message}`, 'error'); }
      }
      event.target.value = '';
    });
  }

  bindMapImageActions() {
    document.getElementById('upload-map-image-btn').onclick = () => document.getElementById('map-image-upload').click();
    document.getElementById('map-image-upload').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) return this.notifications.showNotification('Le fichier sélectionné doit être une image.', 'error');
      if (file.size > MAX_MAP_IMAGE_BYTES) return this.notifications.showNotification('L’image dépasse la limite de 12 Mo.', 'error');
      try {
        const image = await readImageFile(file);
        await this.persistMapImage(image.dataUrl, image.width, image.height);
        document.getElementById('map-image-link').value = '';
        this.notifications.showNotification('Image du plan enregistrée durablement.', 'success');
      } catch (error) { this.notifications.showNotification(error.message, 'error'); }
      event.target.value = '';
    };

    document.getElementById('reset-map-image-btn').onclick = async () => {
      await this.persistMapImage('assets/plan-technique.PNG', null, null);
      document.getElementById('map-image-link').value = '';
      this.notifications.showNotification('Plan technique par défaut restauré.', 'success');
    };

    document.getElementById('set-map-image-link-btn').onclick = async () => {
      const url = document.getElementById('map-image-link').value.trim();
      if (!/^https?:\/\//i.test(url)) return this.notifications.showNotification('Saisissez une URL HTTP ou HTTPS valide.', 'error');
      try {
        const metadata = await inspectImageReference(url);
        await this.persistMapImage(url, metadata.width, metadata.height);
        this.notifications.showNotification('URL du plan enregistrée.', 'success');
      } catch (error) { this.notifications.showNotification(error.message, 'error'); }
    };
  }

  async persistMapImage(mapImageUrl, width, height) {
    this.currentSettings = await savePlatformSettings({
      ...this.collectFormValues(),
      mapImageUrl,
      mapImageWidth:width,
      mapImageHeight:height
    });
    // Ré-résolu, jamais posé tel quel : « Plan par défaut » enregistre un CHEMIN, qui
    // désigne le plan intégré sans être une URL chargeable.
    await this.rafraichirApercuDuPlan();
    const meta = document.getElementById('map-image-metadata');
    if (meta) meta.textContent = `${width && height ? `${width} × ${height} px · ` : ''}jusqu'à 12 Mo. Les proportions originales sont conservées.`;
    this.applySettings();
  }

  /**
   * CE QUE CET ÉCRAN DÉCLARE — ses champs, et la révision qu'il avait sous les yeux.
   *
   * Deux ajouts, pour deux défauts distincts.
   *
   * LA SOURCE DU PLAN N'EN FAIT PAS PARTIE. Elle ne figure dans aucun champ de ce
   * formulaire : l'administrateur la change par « Importer », « Plan par défaut » ou
   * « Appliquer l'URL », jamais en cochant une case. Un enregistrement ordinaire doit donc
   * l'OMETTRE, pour que le serveur conserve celle qu'il détient.
   *
   * LA RÉVISION, ELLE, EN FAIT PARTIE. Sans elle, `savePlatformSettings` retombe sur la
   * révision de la projection locale — relue à l'instant, donc EN AVANCE sur l'écran, que
   * l'instantané central rafraîchit toutes les vingt secondes. Déclarer cette révision-là
   * reviendrait à prétendre avoir vu une version qu'on n'a jamais regardée, et un second
   * administrateur écraserait le travail du premier sans le moindre 409. C'est exactement
   * la course fermée par #120 ; elle restait ouverte sur les actions de plan, qui ne
   * passaient pas par le chemin corrigé.
   *
   * `_revision` n'est posée que lorsqu'il y en a une : sur une plateforme neuve la fiche
   * n'existe pas encore, et déclarer `undefined` vaudrait 0 — ce que le contrat lit déjà
   * comme « aucune version vue ».
   */
  collectFormValues() {
    const revisionVue = Number(this.currentSettings?._revision);
    return {
      id:PLATFORM_SETTINGS_ID,
      theme:document.getElementById('theme-setting')?.value || this.currentSettings.theme,
      language:'fr',
      autoLogout:parseInt(document.getElementById('autologout-setting')?.value || this.currentSettings.autoLogout, 10),
      notifications:Boolean(document.getElementById('notifications-setting')?.checked),
      backupFrequency:document.getElementById('backup-frequency-setting')?.value || this.currentSettings.backupFrequency,
      ...(Number.isSafeInteger(revisionVue) && revisionVue > 0 ? { _revision:revisionVue } : {})
    };
  }

  async saveSettings(showSuccess = true) {
    try {
      /*
       * LE PATCH DU FORMULAIRE, ET RIEN D'AUTRE.
       *
       * On envoyait `{ ...this.currentSettings, ...this.collectFormValues() }`. Or
       * `currentSettings` sort de `normalizeSettings()`, qui SUBSTITUE le désignateur par
       * défaut à une source de plan absente — et elle est absente par construction, puisque
       * le serveur la retire de l'instantané. Changer le thème renvoyait donc
       * `mapImageUrl: 'assets/plan-technique.PNG'`, que le serveur ne pouvait lire que comme
       * « l'administrateur demande le plan intégré ». Une image téléversée ou une URL
       * distante étaient détruites par un geste qui ne les concernait pas.
       *
       * La conservation côté serveur ne pouvait rien y faire : elle ne s'applique qu'à une
       * OMISSION, et le champ n'était pas omis. C'est ici qu'il faut le taire.
       *
       * Les champs non éditables ne sont pas perdus pour autant : `savePlatformSettings`
       * fusionne ce patch avec la fiche canonique. Il les relit à leur source plutôt que de
       * les recopier depuis un écran ouvert depuis longtemps.
       */
      this.currentSettings = await savePlatformSettings(this.collectFormValues());
      this.applySettings();
      if (showSuccess) this.notifications.showNotification('Paramètres enregistrés.', 'success');
    } catch (error) { this.notifications.showNotification(`Erreur : ${error.message}`, 'error'); }
  }

  async resetSettings() {
    try {
      /*
       * « Restaurer les valeurs par défaut » EST une action explicite : elle remet aussi le
       * plan intégré, et c'est le comportement d'origine — on ne change pas la sémantique
       * du bouton dans ce lot. Elle déclare en revanche la révision de l'écran, comme les
       * autres écritures : un retour aux valeurs par défaut ne doit pas davantage emprunter
       * une version qu'on n'a pas regardée.
       */
      const revisionVue = Number(this.currentSettings?._revision);
      this.currentSettings = await savePlatformSettings({
        ...platformSettingsDefaults(),
        ...(Number.isSafeInteger(revisionVue) && revisionVue > 0 ? { _revision:revisionVue } : {})
      });
      this.applySettings();
      this.notifications.showNotification('Paramètres par défaut appliqués.', 'success');
      const host = document.querySelector('.system-settings')?.parentElement;
      if (host) { host.innerHTML = await this.render(); await this.afterRender(); }
    } catch (error) { this.notifications.showNotification(`Erreur : ${error.message}`, 'error'); }
  }

  /**
   * Liste des sauvegardes conservées, avec restauration et téléchargement à la demande.
   * Une capacité qui n'apparaît nulle part à l'écran n'existe pas pour l'utilisateur.
   */
  /**
   * La sauvegarde automatique se déclenche sur minuterie et annonce sa réussite. Personne
   * n'écoutait : la liste affichée ici restait celle du dernier affichage, et l'utilisateur
   * voyait « Aucune sauvegarde » alors qu'une venait d'être conservée. La plateforme faisait
   * le travail sans jamais le montrer.
   *
   * L'enregistrement est fait une seule fois — `afterRender` s'exécute à chaque retour sur
   * Paramètres — et le rafraîchissement se protège déjà de l'absence de la liste à l'écran.
   */
  bindBackupAnnouncements() {
    if (this._backupAnnouncementsBound) return;
    this._backupAnnouncementsBound = true;
    const rafraichir = () => { this.refreshBackupList(); };
    // Nommés un par un plutôt qu'en boucle : on doit pouvoir chercher « backup-created »
    // dans le dépôt et trouver son gestionnaire.
    eventSystem.register('backup-created', rafraichir);
    eventSystem.register('auto-backup-completed', rafraichir);
    eventSystem.register('backup-restored', rafraichir);
    eventSystem.register('auto-backup-failed', ({ error } = {}) => {
      // Un échec silencieux de la sauvegarde automatique est le pire des cas : on croit
      // protégé ce qui ne l'est plus.
      this.notifications?.showNotification?.(
        `Sauvegarde automatique échouée : ${error?.message || 'raison inconnue'}`, 'error');
    });
  }

  async refreshBackupList() {
    const host = document.getElementById('backup-list');
    if (!host) return;
    let sauvegardes = [];
    try { sauvegardes = await this.backupService.listBackups(); }
    catch (error) { host.textContent = `Liste indisponible : ${error.message}`; return; }

    if (!sauvegardes.length) {
      host.innerHTML = '<p class="backup-empty">Aucune sauvegarde conservée pour l’instant. La sauvegarde automatique en créera une selon la fréquence choisie.</p>';
      return;
    }
    host.innerHTML = sauvegardes.map(item => {
      const total = Object.values(item.counts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
      return `<div class="backup-row" data-backup-id="${escapeHTML(item.id)}">
        <div class="backup-meta">
          <strong>${escapeHTML(new Date(item.createdAt).toLocaleString('fr-FR'))}</strong>
          <span>${escapeHTML(item.reason === 'auto' ? 'automatique' : 'manuelle')} · ${escapeHTML(formatOctets(item.sizeBytes))} · ${total} enregistrement(s)</span>
        </div>
        <div class="backup-row-actions">
          <button type="button" class="btn gray" data-backup-download="${escapeHTML(item.id)}"><i class="fas fa-download"></i> Télécharger</button>
          <button type="button" class="btn" data-backup-restore="${escapeHTML(item.id)}"><i class="fas fa-rotate-left"></i> Restaurer</button>
        </div>
      </div>`;
    }).join('');

    host.querySelectorAll('[data-backup-download]').forEach(button => {
      button.addEventListener('click', async () => {
        try { await this.backupService.downloadStoredBackup(button.dataset.backupDownload); }
        catch (error) { this.notifications.showNotification(`Téléchargement impossible : ${error.message}`, 'error'); }
      });
    });
    host.querySelectorAll('[data-backup-restore]').forEach(button => {
      button.addEventListener('click', async () => {
        const message = 'La restauration est additive : les enregistrements de cette sauvegarde seront ajoutés ou mis à jour. Continuer ?';
        const accepted = window.AppDialog ? await window.AppDialog.confirm(message) : confirm(message);
        if (!accepted) return;
        try {
          this.notifications.showNotification('Restauration en cours…', 'info');
          const report = await this.backupService.restoreStoredBackup(button.dataset.backupRestore);
          this.notifications.showNotification(
            `Restauration terminée : ${report.restored} enregistrement(s) restauré(s), ${report.skipped} ignoré(s), ${report.failed} en échec.`,
            report.failed ? 'warning' : 'success');
        } catch (error) { this.notifications.showNotification(`Restauration impossible : ${error.message}`, 'error'); }
      });
    });
  }
}
