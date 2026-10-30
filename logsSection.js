/**
 * @file logsSection.js — le journal des événements, et qui peut en faire quoi.
 *
 * FERMÉ PAR DÉFAUT POUR LA VERSION RÉUNION
 * -----------------------------------------
 * Cette section offrait Exporter, Importer, Vider et une suppression ligne par ligne à
 * quiconque l'atteignait — sans consulter la matrice de rôles une seule fois. Un
 * Responsable, à qui `logs.export` est refusé, pouvait extraire le journal ; n'importe qui
 * pouvait l'effacer, c'est-à-dire effacer la preuve de ce que les autres ont fait.
 *
 * Le contrat retenu est celui de `permissions.js`, sans rien y ajouter :
 *
 *   Admin        consulter · exporter · vider
 *   Manager      consulter · exporter
 *   Chef         consulter · exporter
 *   Responsable  consulter
 *   Technique    rien
 *   Visiteur     rien
 *
 * IMPORTER et SUPPRIMER UNE LIGNE n'y figurent pas, et aucune permission ne les décrit.
 * Plutôt que d'inventer `logs.import` et `logs.delete` avant que la question soit tranchée,
 * ce lot les FERME : ni bouton, ni gestionnaire, ni chemin caché. Un contrat séparé pourra
 * les définir ensuite — l'inverse aurait consacré par le code une décision que personne
 * n'a prise.
 *
 * L'ajout automatique au journal n'est pas touché : c'est l'écriture de la trace, pas sa
 * gestion.
 */
import { getRecentLogs, clearLogs, exportLogs } from './logs.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export default class LogsSection {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { type: '', user: '', action: '', search: '' };
  }

  async render() {
    let logs = await getRecentLogs(100);
    if (this.filters.type) logs = logs.filter(l => l.type === this.filters.type);
    if (this.filters.user) logs = logs.filter(l => (l.fullName || l.username || '').toLowerCase().includes(this.filters.user.toLowerCase()));
    if (this.filters.action) logs = logs.filter(l => l.action === this.filters.action);
    if (this.filters.search) {
      logs = logs.filter(l =>
        (l.details && JSON.stringify(l.details).toLowerCase().includes(this.filters.search.toLowerCase())) ||
        (l.type && l.type.toLowerCase().includes(this.filters.search.toLowerCase())) ||
        (l.action && l.action.toLowerCase().includes(this.filters.search.toLowerCase()))
      );
    }

    const types = Array.from(new Set(logs.map(l => l.type))).filter(Boolean);
    const users = Array.from(new Set(logs.map(l => l.fullName || l.username))).filter(Boolean);
    const actions = Array.from(new Set(logs.map(l => l.action))).filter(Boolean);

    // Le rendu suit la matrice canonique, et rien d'autre.
    const utilisateur = getCurrentUser();
    const peutExporter = PermissionManager.check(utilisateur, 'logs', 'export');
    const peutVider = PermissionManager.check(utilisateur, 'logs', 'clear');

    return `
      <div class="card">
        <div class="card-header">
          <h2><i class="fas fa-file-alt"></i> Journal des événements</h2>
          <div class="card-actions">
            ${peutExporter ? '<button id="export-logs-btn" class="btn gray"><i class="fas fa-download"></i> Exporter</button>' : ''}
            ${peutVider ? '<button id="clear-logs-btn" class="btn danger"><i class="fas fa-trash"></i> Vider</button>' : ''}
          </div>
        </div>
        <div class="filters-container">
          <select id="logs-type-filter" class="form-control" style="min-width:120px;">
            <option value="">Type: Tous</option>
            ${types.map(t => `<option value="${esc(t)}" ${this.filters.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
          <select id="logs-user-filter" class="form-control" style="min-width:120px;">
            <option value="">Utilisateur: Tous</option>
            ${users.map(u => `<option value="${esc(u)}" ${this.filters.user === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
          </select>
          <select id="logs-action-filter" class="form-control" style="min-width:120px;">
            <option value="">Action: Toutes</option>
            ${actions.map(a => `<option value="${esc(a)}" ${this.filters.action === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
          </select>
          <input type="text" id="logs-search" class="form-control" style="width:190px;" placeholder="Recherche...">
          <button type="button" id="reset-logs-filters" class="btn gray" title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres"><i class="fas fa-times"></i></button>
        </div>
        <div style="overflow-x:auto;max-height:62vh;overflow-y:auto;">
          <table class="tableau" style="font-size:15px;">
            <tr><th>Date</th><th>Utilisateur</th><th>Type</th><th>Action</th><th>Détails</th></tr>
            ${logs.length ? logs.map(l => `
              <tr>
                <td>${esc(l.dateStr || new Date(l.timestamp).toLocaleString())}</td>
                <td>${esc(l.fullName || l.username || '-')}</td>
                <td><span class="role-badge">${esc(l.type || '-')}</span></td>
                <td>${esc(l.action || '-')}</td>
                <td><button class="btn-icon show-log-details" data-id="${esc(l.id)}" title="Voir plus"><i class="fas fa-eye"></i></button></td>
              </tr>
            `).join('') : `<tr><td colspan="5" style="text-align:center;color:#888;">Aucun événement trouvé.</td></tr>`}
          </table>
        </div>
      </div>
      <div id="log-detail-modal"></div>
    `;
  }

  async afterRender() {
    /*
     * La permission se revérifie AU GESTE, pas seulement au rendu.
     *
     * Un bouton non rendu n'est pas une garde : le gestionnaire resterait atteignable
     * autrement — une console, un script, une vue qui réutilise ce composant. La question
     * se repose donc au moment où l'action part.
     */
    document.getElementById('export-logs-btn')?.addEventListener('click', () => {
      if (!PermissionManager.check(getCurrentUser(), 'logs', 'export')) {
        this.notifications?.showNotification("Vous n'êtes pas autorisé à exporter le journal.", 'error');
        return;
      }
      exportLogs();
    });

    document.getElementById('clear-logs-btn')?.addEventListener('click', async () => {
      if (!PermissionManager.check(getCurrentUser(), 'logs', 'clear')) {
        this.notifications?.showNotification("Vous n'êtes pas autorisé à vider le journal.", 'error');
        return;
      }
      if (!confirm('Effacer tous les logs ?')) return;
      await clearLogs();
      this.notifications.showNotification('Journal vidé.', 'success');
      this.refreshList();
    });

    document.getElementById('logs-type-filter').onchange = e => { this.filters.type = e.target.value; this.refreshList(); };
    document.getElementById('logs-user-filter').onchange = e => { this.filters.user = e.target.value; this.refreshList(); };
    document.getElementById('logs-action-filter').onchange = e => { this.filters.action = e.target.value; this.refreshList(); };
    document.getElementById('logs-search').oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    document.getElementById('reset-logs-filters').onclick = () => { this.filters = { type: '', user: '', action: '', search: '' }; this.refreshList(); };

    document.querySelectorAll('.show-log-details').forEach(btn => {
      btn.onclick = async () => {
        const logId = Number(btn.dataset.id);
        const log = (await getRecentLogs(200)).find(l => Number(l.id) === logId);
        if (log) this.showLogDetails(log);
      };
    });

  }

  refreshList() {
    this.render().then(html => {
      document.getElementById('admin-content').innerHTML = html;
      this.afterRender();
    });
  }

  showLogDetails(log) {
    const details = esc(JSON.stringify(log.details ?? {}, null, 2));
    document.getElementById('log-detail-modal').innerHTML = `
      <div class="modal" style="z-index:3000;">
        <div class="modal-content" style="min-width:360px;max-width:520px;">
          <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
          <h3 style="color:#2874a6;">Détail du log</h3>
          <div>
            <b>Date:</b> ${esc(log.dateStr || new Date(log.timestamp).toLocaleString())}<br>
            <b>Utilisateur:</b> ${esc(log.fullName || log.username || '-')}<br>
            <b>Type:</b> ${esc(log.type || '-')}<br>
            <b>Action:</b> ${esc(log.action || '-')}<br>
            <b>Détails:</b>
            <pre style="background:#f8f8fb;padding:10px 13px;border-radius:8px;margin-top:4px;max-height:220px;overflow:auto;font-size:13px;">${details}</pre>
          </div>
          <button class="btn" id="close-log-detail">Fermer</button>
        </div>
      </div>`;
    document.querySelector('#log-detail-modal .close-modal').onclick = () => document.getElementById('log-detail-modal').innerHTML = '';
    document.getElementById('close-log-detail').onclick = () => document.getElementById('log-detail-modal').innerHTML = '';
  }
}
