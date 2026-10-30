import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { PermissionManager } from './permissions.js';
import { messageDePerimetre } from './zone-scope-notice.js';
import { replierLaCreation, pucesActifs } from './pilot-technique-shell.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
})[character]);
const normalizeId = value => typeof db.normalizeKey === 'function'
  ? db.normalizeKey(value)
  : (/^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : value);

export default class Baies {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { roomId: '', search: '' };
  }

  async render() {
    const [baies, rooms, equipments] = await Promise.all([
      db.getAll('baies'),
      db.getAll('rooms'),
      // Chargé une fois pour la liste entière, pas par ligne — pour que « Gestion des
      // Baies » puisse dire, sous Pilote, combien d'équipements chaque baie porte.
      db.getAll('equipments')
    ]);

    let filteredBaies = baies;
    if (this.filters.roomId) filteredBaies = filteredBaies.filter(b => b.roomId == this.filters.roomId);
    if (this.filters.search) {
      const query = this.filters.search.toLowerCase();
      filteredBaies = filteredBaies.filter(b =>
        (b.name || '').toLowerCase().includes(query) ||
        (b.reference || '').toLowerCase().includes(query)
      );
    }

    const currentUser = getCurrentUser();
    // Le contrat de permissions décide, action par action — la même correction que sur la
    // page Salles, où la même ligne de comparaison de chaînes produisait les deux mêmes
    // erreurs : le CHEF privé d'un écran que la matrice et le serveur lui accordent, le
    // RESPONSABLE muni de boutons qui finissent tous en 403.
    const canCreate = PermissionManager.check(currentUser, 'baies', 'create');
    const canEdit = PermissionManager.check(currentUser, 'baies', 'edit');
    const canDelete = PermissionManager.check(currentUser, 'baies', 'delete');
    const canExport = PermissionManager.check(currentUser, 'baies', 'export');
    const canImport = PermissionManager.check(currentUser, 'baies', 'import');
    const canAct = canEdit || canDelete;

    return `
      <div class="card">
        <div class="card-header">
          <h2>Gestion des Baies</h2>
          <div class="card-actions">
            ${canExport ? `<button id="export-baies" class="btn gray">Exporter JSON</button>` : ''}
            ${canImport ? `
              <button id="import-baies" class="btn gray">Importer JSON</button>
              <input type="file" id="import-baies-file" style="display:none">
            ` : ''}
          </div>
        </div>
        ${messageDePerimetre(currentUser, {
          permission: 'equipment.read',
          vide: filteredBaies.length === 0 && !this.filters.search && !this.filters.roomId,
          aucuneDonnee: 'Aucune baie dans votre périmètre pour le moment.'
        })}
        <div class="filters-container">
          <input type="text" id="baie-search" class="form-control" style="width:180px;" placeholder="Recherche baie..." value="${escapeHTML(this.filters.search)}">
          <select id="filter-room" class="form-control" data-entity-search="room" data-entity-search-placeholder="Rechercher une salle…">
            <option value="">Salle: Toutes</option>
            ${rooms.map(r => `<option value="${escapeHTML(r.id)}" ${this.filters.roomId == r.id ? 'selected' : ''}>${escapeHTML(r.name)}</option>`).join('')}
          </select>
          <button type="button" id="reset-baie-filters" class="btn gray" title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres"><i class="fas fa-times"></i></button>
        </div>
        ${replierLaCreation(canCreate ? `
        <form id="add-baie-form" class="flex" style="margin-bottom:20px;gap:10px;">
          <input name="name" type="text" placeholder="Nom baie" required>
          <select name="roomId" required data-entity-search="room" data-entity-search-placeholder="Rechercher la salle de la baie…">
            <option value="">Salle</option>
            ${rooms.map(r => `<option value="${escapeHTML(r.id)}">${escapeHTML(r.name)}</option>`).join('')}
          </select>
          <input name="image" type="file" accept="image/*">
          <button class="btn">Ajouter</button>
        </form>
        ` : '', 'Ajouter une baie')}
        <div style="overflow-x:auto;">
        <table class="tableau">
          <tr><th>Nom</th><th>Salle</th><th>Image</th>${canAct ? `<th>Actions</th>` : ''}</tr>
          ${filteredBaies.map(baie => {
            // Même principe que Salles : compté une fois par ligne à partir du tableau
            // chargé pour la liste entière, pas d'un nouvel appel par baie.
            const equipementsBaie = equipments.filter(eq => String(eq.baieId) === String(baie.id)).length;
            return `<tr>
            <td>${escapeHTML(baie.name)}${pucesActifs([
              { icone: 'fa-server', valeur: equipementsBaie, libelleUn: 'équipement', libelleN: 'équipements' }
            ])}</td>
            <td>${escapeHTML((rooms.find(r => r.id == baie.roomId) || {}).name || '')}</td>
            <td>${baie.image ? `<img src="${escapeHTML(baie.image)}" class="img-preview" alt="${escapeHTML(baie.name || 'Baie')}">` : ''}</td>
            ${canAct ? `<td style="white-space:nowrap;">${canEdit ? `<button class="btn" data-id="${escapeHTML(baie.id)}" data-action="edit"><i class="fas fa-edit"></i> Modifier</button>` : ''}${canDelete ? ` <button class="btn danger" data-id="${escapeHTML(baie.id)}" data-action="del">Supprimer</button>` : ''}</td>` : ''}
          </tr>`;
          }).join('')}
        </table>
        </div>
      </div>`;
  }

  async afterRender() {
    const search = document.getElementById('baie-search');
    const roomFilter = document.getElementById('filter-room');
    const reset = document.getElementById('reset-baie-filters');
    if (search) search.oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    if (roomFilter) roomFilter.onchange = e => { this.filters.roomId = e.target.value; this.refreshList(); };
    if (reset) reset.onclick = () => { this.filters = { roomId: '', search: '' }; this.refreshList(); };

    const currentUser = getCurrentUser();
    // Les mêmes autorisations qu'au rendu : un gestionnaire posé sur un bouton que le rôle
    // ne devrait pas avoir le rend cliquable dès qu'un rendu partiel le réintroduit.
    const canCreate = PermissionManager.check(currentUser, 'baies', 'create');
    const canEdit = PermissionManager.check(currentUser, 'baies', 'edit');
    const canDelete = PermissionManager.check(currentUser, 'baies', 'delete');

    if (canCreate && document.getElementById('add-baie-form')) {
      document.getElementById('add-baie-form').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        let imgData = '';
        if (form.image.files.length) imgData = await this.readFile(form.image.files[0]);
        try {
          await db.save('baies', {
            name: form.name.value.trim(),
            roomId: normalizeId(form.roomId.value),
            image: imgData,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } catch (error) {
          this.notifications?.showNotification(error.message || 'Impossible de créer cette baie.', 'error');
          return;
        }
        form.reset();
        this.notifications?.showNotification('Baie ajoutée avec succès.', 'success');
        this.refreshList();
      };
    }

    if (canEdit) {
      document.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.onclick = () => this.showEditModal(normalizeId(btn.getAttribute('data-id')));
      });
    }

    if (canDelete) {
      document.querySelectorAll('button[data-action="del"]').forEach(btn => {
        btn.onclick = async () => {
          const id = normalizeId(btn.getAttribute('data-id'));
          const accepted = window.AppDialog
            ? await window.AppDialog.confirm('Supprimer cette baie ?')
            : confirm('Supprimer cette baie ?');
          if (!accepted) return;
          try {
            await db.deleteBaieSafely(id);
            this.notifications?.showNotification('Baie supprimée.', 'success');
            this.refreshList();
          } catch (error) {
            this.notifications?.showNotification(error.message, 'error');
          }
        };
      });
    }

    if (document.getElementById('export-baies')) {
      document.getElementById('export-baies').onclick = async () => {
        const baies = await db.getAll('baies');
        const blob = new Blob([JSON.stringify(baies, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'baies.json';
        a.click();
      };
    }
    if (document.getElementById('import-baies')) {
      document.getElementById('import-baies').onclick = () => document.getElementById('import-baies-file').click();
      document.getElementById('import-baies-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const baies = JSON.parse(await file.text());
          for (const b of baies) await db.save('baies', b);
          this.notifications?.showNotification('Importation réussie.', 'success');
          this.refreshList();
        } catch {
          this.notifications?.showNotification("Erreur lors de l'importation.", 'error');
        }
      };
    }
  }

  async showEditModal(id) {
    const [baie, rooms, equipments] = await Promise.all([
      db.get('baies', id),
      db.getAll('rooms'),
      db.getAll('equipments')
    ]);
    if (!baie) {
      this.notifications?.showNotification('Baie introuvable.', 'error');
      return;
    }
    document.getElementById('edit-baie-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'edit-baie-modal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    // Voir `salles.js` : la fenêtre déclare la fiche qu'elle édite, faute de quoi une
    // modification distante viendrait écraser la saisie sans le dire.
    modal.dataset.entityStore = 'baies';
    modal.dataset.entityId = String(baie.id);
    modal.innerHTML = `
      <div class="modal-content" style="max-width:560px;">
        <button type="button" class="close-modal" aria-label="Fermer">&times;</button>
        <h3>Modifier la baie</h3>
        <form id="edit-baie-form">
          <div class="form-group"><label>Nom</label><input name="name" type="text" value="${escapeHTML(baie.name || '')}" required></div>
          <div class="form-group"><label>Salle</label>${
            // Déplacer une baie d'une salle à l'autre est `baies.assign`, pas `baies.edit` :
            // l'opération réaligne aussi tous les équipements liés, donc elle change de
            // salle un contenu entier. Sans l'autorisation, la salle actuelle est montrée
            // mais figée, et c'est elle qui est réenregistrée.
            PermissionManager.check(getCurrentUser(), 'baies', 'assign')
              ? `<select name="roomId" required data-entity-search="room" data-entity-search-placeholder="Rechercher une salle…"><option value="">Sélectionner une salle</option>${rooms.map(room => `<option value="${escapeHTML(room.id)}" ${room.id == baie.roomId ? 'selected' : ''}>${escapeHTML(room.name || room.nom || room.id)}</option>`).join('')}</select>`
              : `<p class="baie-salle-figee">${escapeHTML((rooms.find(room => room.id == baie.roomId) || {}).name || 'Salle inconnue')}</p>`
          }</div>
          <div class="form-group"><label>Image</label><input name="image" type="file" accept="image/*"><small>Laissez vide pour conserver l’image actuelle.</small></div>
          ${baie.image ? `<img src="${escapeHTML(baie.image)}" class="img-preview" alt="Aperçu baie" style="max-width:120px;max-height:90px;">` : ''}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;"><button type="button" class="btn gray" id="cancel-edit-baie">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#cancel-edit-baie').onclick = close;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('#edit-baie-form').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const nextRoomId = form.roomId ? normalizeId(form.roomId.value) : baie.roomId;
      let image = baie.image || '';
      if (form.image.files.length) image = await this.readFile(form.image.files[0]);
      const linked = equipments.filter(equipment => String(equipment.baieId) === String(baie.id));
      const roomChanged = String(nextRoomId) !== String(baie.roomId ?? '');
      try {
        await db.save('baies', {
          ...baie,
          name: form.name.value.trim(),
          roomId: nextRoomId,
          image,
          updatedAt: new Date()
        });
        /*
         * LE RÉALIGNEMENT APPARTIENT AU SERVEUR, PAS À CET ÉCRAN.
         *
         * Cette boucle poussait une écriture PAR ÉQUIPEMENT, hors transaction : une panne au
         * milieu laissait la baie déménagée et une partie de ses équipements dans l'ancienne
         * salle. Le serveur réaligne désormais dans la transaction qui écrit la baie, si bien
         * que ces écritures seraient devenues doublement fautives — une tempête d'écritures
         * proportionnelle à la taille de la baie, et un `409` garanti sur chacune, puisque le
         * serveur vient d'avancer leur révision.
         *
         * Il reste à ne pas mentir à l'écran pendant les vingt secondes qui séparent de
         * l'instantané suivant : la projection locale est corrigée SANS repartir vers le
         * serveur, qui a déjà fait le travail et reste seul maître de la vérité.
         */
        if (roomChanged) {
          for (const equipment of linked) {
            await db.saveLocalOnly('equipments', { ...equipment, roomId: nextRoomId });
          }
        }
        close();
        this.notifications?.showNotification(
          roomChanged && linked.length
            ? `Baie modifiée et ${linked.length} équipement(s) réaligné(s) sur la nouvelle salle.`
            : 'Baie modifiée avec succès.',
          'success'
        );
        this.refreshList();
      } catch (error) {
        this.notifications?.showNotification(error.message || 'Impossible de modifier cette baie.', 'error');
      }
    };
  }

  refreshList() {
    this.render().then(html => {
      const target = document.getElementById('admin-content') || document.getElementById('responsible-content');
      if (target) {
        target.innerHTML = html;
        this.afterRender();
      }
    });
  }

  readFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }
}
