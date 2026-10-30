// equipements.js — منصة 2M TECH، إدارة الأجهزة (إصدار كامل)
// يعتمد على: db.js, qr.js, security.js, notifications.js ... إلخ

import { db } from './db.js';
import { generateQR } from './qr.js';
import { getCurrentUser } from './security.js';
import { NotificationSystem } from './notifications.js';

export default class Equipements {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { type: '', statut: '', salle: '', search: '' };
    this.sortField = 'name';
    this.sortDirection = 'asc';
    this.editingEquip = null;
  }

  /** =========== العرض الرئيسي =========== */
  async render() {
    const [salles, baies, eqs] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('baies'),
      this.getFilteredEquipements()
    ]);
    const currentUser = getCurrentUser();
    const canEdit = currentUser && ['admin', 'manager', 'responsable'].includes(currentUser.role);

    return `
      <div class="card">
        <div class="card-header">
          <h2>Équipements</h2>
          <div class="card-actions">
            ${canEdit ? `
              <button id="open-add-eq" class="btn"><i class="fas fa-plus"></i> Ajouter</button>
              <button id="export-eq" class="btn gray">Exporter JSON</button>
              <button id="import-eq" class="btn gray">Importer JSON</button>
              <input type="file" id="import-file" style="display:none">
            ` : ''}
          </div>
        </div>
        <div class="filters-container">
          <input type="text" id="equip-search" class="form-control" style="width:140px;" placeholder="Recherche rapide..." value="${this.filters.search}">
          <select id="filter-type" class="form-control">
            <option value="">Type: Tous</option>
            ${[...new Set(eqs.map(eq => eq.type))].map(type => `
              <option value="${type}" ${this.filters.type === type ? 'selected' : ''}>${type}</option>
            `).join('')}
          </select>
          <select id="filter-statut" class="form-control">
            <option value="">Statut: Tous</option>
            <option value="Opérationnel" ${this.filters.statut === 'Opérationnel' ? 'selected' : ''}>Opérationnel</option>
            <option value="Maintenance" ${this.filters.statut === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
            <option value="Hors service" ${this.filters.statut === 'Hors service' ? 'selected' : ''}>Hors service</option>
          </select>
          <select id="filter-salle" class="form-control">
            <option value="">Salle: Toutes</option>
            ${salles.map(s => `
              <option value="${s.id}" ${this.filters.salle == s.id ? 'selected' : ''}>${s.name || s.nom}</option>
            `).join('')}
          </select>
          <button id="reset-filters" class="btn gray"><i class="fas fa-times"></i></button>
        </div>
        <div style="overflow-x:auto;">
          <table class="tableau">
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Catégorie</th>
              <th>Marque</th>
              <th>Modèle</th>
              <th>Numéro de série</th>
              <th>N° d’Immobilisation</th>
              <th>Statut</th>
              <th>Salle</th>
              <th>Rack</th>
              <th>Adresse IP</th>
              <th>N° Grille IN/OUT</th>
              <th>Date installation</th>
              <th>Fin garantie</th>
              <th>Notes</th>
              <th>QR</th>
              <th>Images</th>
              <th>Actions</th>
            </tr>
            ${eqs.map(eq => `
              <tr>
                <td><a href="#" class="eq-quickview" data-id="${eq.id}" style="font-weight:600;">${eq.name || ''}</a></td>
                <td>${eq.type || ''}</td>
                <td>${eq.categorie || ''}</td>
                <td>${eq.marque || ''}</td>
                <td>${eq.modele || ''}</td>
                <td>${eq.numSerie || ''}</td>
                <td>${eq.immoNumber || ''}</td>
                <td>${eq.statut || ''}</td>
                <td>${(salles.find(s => s.id == eq.roomId) || {}).name || (salles.find(s => s.id == eq.roomId) || {}).nom || ''}</td>
                <td>${(baies.find(b => b.id == eq.baieId) || {}).name || (baies.find(b => b.id == eq.baieId) || {}).nom || ''}</td>
                <td>${eq.ipAddress || ''}</td>
                <td>${eq.grilleINOUT || ''}</td>
                <td>${eq.installDate || ''}</td>
                <td>${eq.garantieDate || ''}</td>
                <td>${eq.notes || ''}</td>
                <td>${eq.qr ? `<img src="${eq.qr}" width="32">` : ''}</td>
                <td>
                  ${(eq.images || []).map(img => `<img src="${img}" class="img-preview">`).join('')}
                </td>
                <td>
                  ${canEdit ? `<button class="btn" data-id="${eq.id}" data-action="edit"><i class="fas fa-edit"></i></button>` : ''}
                  ${canEdit ? `<button class="btn danger" data-id="${eq.id}" data-action="del"><i class="fas fa-trash"></i></button>` : ''}
                </td>
              </tr>
            `).join('')}
          </table>
        </div>
        ${this.renderModal()}
      </div>
    `;
  }

  /** =========== أحداث بعد العرض =========== */
  async afterRender() {
    document.getElementById('equip-search').oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    document.getElementById('filter-type').onchange = e => { this.filters.type = e.target.value; this.refreshList(); };
    document.getElementById('filter-statut').onchange = e => { this.filters.statut = e.target.value; this.refreshList(); };
    document.getElementById('filter-salle').onchange = e => { this.filters.salle = e.target.value; this.refreshList(); };
    document.getElementById('reset-filters').onclick = () => { this.filters = { type: '', statut: '', salle: '', search: '' }; this.refreshList(); };

    // إضافة
    if (document.getElementById('open-add-eq')) {
      document.getElementById('open-add-eq').onclick = () => this.showEquipementModal();
    }

    // تعديل
    document.querySelectorAll('button[data-action="edit"]').forEach(btn => {
      btn.onclick = async () => {
        const eq = await db.get('equipments', Number(btn.getAttribute('data-id')));
        this.showEquipementModal(eq);
      };
    });
    // حذف
    document.querySelectorAll('button[data-action="del"]').forEach(btn => {
      btn.onclick = async () => {
        if (confirm("Supprimer cet équipement ?")) {
          await db.delete('equipments', Number(btn.getAttribute('data-id')));
          this.notifications.showNotification("Suppression réussie", "success");
          this.refreshList();
        }
      };
    });

    // عرض سريع
    document.querySelectorAll('.eq-quickview').forEach(a => {
      a.onclick = async (e) => {
        e.preventDefault();
        const eq = await db.get('equipments', Number(a.dataset.id));
        this.showQuickView(eq);
      };
    });

    // تصدير/استيراد JSON
    if (document.getElementById('export-eq')) {
      document.getElementById('export-eq').onclick = async () => {
        const eqs = await db.getAll('equipments');
        const blob = new Blob([JSON.stringify(eqs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "equipements.json";
        a.click();
      };
    }
    if (document.getElementById('import-eq')) {
      document.getElementById('import-eq').onclick = () => document.getElementById('import-file').click();
      document.getElementById('import-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const eqs = JSON.parse(text);
          for (const eq of eqs) await db.save('equipments', eq);
          this.notifications.showNotification("Importation réussie !", "success");
          this.refreshList();
        } catch (err) {
          this.notifications.showNotification("Erreur lors de l'importation !", "error");
        }
      };
    }
  }

  /** =========== نموذج الإضافة/التعديل =========== */
  renderModal() {
    return `
      <div class="modal" id="eq-modal" style="display:none;">
        <div class="modal-content" style="min-width:360px;">
          <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
          <h3 id="modal-title-eq">Ajouter équipement</h3>
          <form id="eq-form">
            <input type="hidden" id="eq-id">
            <input name="name"         type="text"  placeholder="Nom équipement (ex: Switch Core Principal)" required>
            <input name="type"         type="text"  placeholder="Type (ex: Switch, Serveur)" required>
            <select name="categorie"   required>
              <option value="">Catégorie</option>
              <option value="Réseau">Réseau</option>
              <option value="Informatique">Informatique</option>
              <option value="Énergie">Énergie</option>
            </select>
            <input name="marque"       type="text"  placeholder="Marque (ex: Cisco, Dell...)">
            <input name="modele"       type="text"  placeholder="Modèle (ex: Catalyst 9300)">
            <input name="numSerie"     type="text"  placeholder="Numéro de série" required>
            <input name="immoNumber"   type="text"  placeholder="N° d’Immobilisation (ex: 2M-IMMO-12345)">
            <select name="statut"      required>
              <option value="Opérationnel">Opérationnel</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Hors service">Hors service</option>
            </select>
            <select name="roomId" required id="eq-roomId"></select>
            <select name="baieId" required id="eq-baieId"></select>
            <input name="ipAddress"    type="text"  placeholder="Adresse IP (ex: 192.168.1.10)">
            <input name="grilleINOUT"  type="text"  placeholder="N° de la grille IN/OUT (ex: GR-IN-05 / GR-OUT-12)">
            <input name="installDate"  type="date"  placeholder="Date d’installation">
            <input name="garantieDate" type="date"  placeholder="Date de fin de garantie">
            <textarea name="notes"     placeholder="Notes ou commentaires (config, historique...)"></textarea>
            <input name="images" id="eq-images" type="file" accept="image/*" multiple>
            <div id="modal-images-list"></div>
            <div style="margin-top:10px;">
              <button type="button" class="btn" id="cancel-eq-btn">Annuler</button>
              <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  async showEquipementModal(equipement = null) {
    document.body.insertAdjacentHTML('beforeend', this.renderModal());
    const modal = document.getElementById('eq-modal');
    const form = document.getElementById('eq-form');
    const salles = await db.getAll('rooms');
    const baies = await db.getAll('baies');
    form.roomId.innerHTML = `<option value="">Sélectionner une salle</option>${salles.map(s => `<option value="${s.id}">${s.name || s.nom}</option>`).join('')}`;
    form.baieId.innerHTML = `<option value="">Sélectionner un rack</option>${baies.map(b => `<option value="${b.id}">${b.name || b.nom}</option>`).join('')}`;

    if (equipement) {
      form['name'].value = equipement.name || '';
      form['type'].value = equipement.type || '';
      form['categorie'].value = equipement.categorie || '';
      form['marque'].value = equipement.marque || '';
      form['modele'].value = equipement.modele || '';
      form['numSerie'].value = equipement.numSerie || '';
      form['immoNumber'].value = equipement.immoNumber || '';
      form['statut'].value = equipement.statut || 'Opérationnel';
      form['roomId'].value = equipement.roomId || '';
      form['baieId'].value = equipement.baieId || '';
      form['ipAddress'].value = equipement.ipAddress || '';
      form['grilleINOUT'].value = equipement.grilleINOUT || '';
      form['installDate'].value = equipement.installDate || '';
      form['garantieDate'].value = equipement.garantieDate || '';
      form['notes'].value = equipement.notes || '';
      document.getElementById('eq-id').value = equipement.id || '';
    }

    form.images.onchange = async (e) => {
      const imgsList = document.getElementById('modal-images-list');
      imgsList.innerHTML = '';
      for (const f of e.target.files) {
        const imgData = await this.readFile(f);
        imgsList.innerHTML += `<img src="${imgData}" style="max-width:40px;max-height:40px;margin:2px;">`;
      }
    };

    document.getElementById('cancel-eq-btn').onclick = () => { modal.remove(); };
    modal.querySelector('.close-modal').onclick = () => { modal.remove(); };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      data.roomId = Number(data.roomId);
      data.baieId = Number(data.baieId);
      data.images = [];
      if (form.images.files.length) {
        for (const f of form.images.files) {
          data.images.push(await this.readFile(f));
        }
      }
      data.installDate = form.installDate.value;
      data.garantieDate = form.garantieDate.value;
      data.notes = form.notes.value;
      data.qr = await generateQR(data.numSerie);
      data.createdAt = equipement?.createdAt || new Date();
      data.updatedAt = new Date();
      if (equipement && equipement.id) {
        data.id = equipement.id;
      }
      await db.save('equipments', data);
      this.notifications.showNotification("Enregistré avec succès", "success");
      modal.remove();
      this.refreshList();
    };

    modal.style.display = 'block';
  }

  async showQuickView(eq) {
    document.getElementById('equip-quickview-modal')?.remove();
    const salles = await db.getAll('rooms');
    const baies = await db.getAll('baies');
    const modal = document.createElement('div');
    modal.id = 'equip-quickview-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="min-width:350px;max-width:540px;">
        <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
        <h3 style="color:#2874a6;">Détails de l'équipement</h3>
        <table class="table details-table" style="margin-bottom:16px;">
          <tbody>
            <tr><td><b>Nom</b></td><td>${eq.name}</td></tr>
            <tr><td><b>Type</b></td><td>${eq.type}</td></tr>
            <tr><td><b>Catégorie</b></td><td>${eq.categorie || ''}</td></tr>
            <tr><td><b>Marque</b></td><td>${eq.marque}</td></tr>
            <tr><td><b>Modèle</b></td><td>${eq.modele}</td></tr>
            <tr><td><b>Numéro série</b></td><td>${eq.numSerie}</td></tr>
            <tr><td><b>N° d’Immobilisation</b></td><td>${eq.immoNumber || ''}</td></tr>
            <tr><td><b>Statut</b></td><td>${eq.statut}</td></tr>
            <tr><td><b>Salle</b></td><td>${(salles.find(s => s.id == eq.roomId) || {}).name || (salles.find(s => s.id == eq.roomId) || {}).nom || ''}</td></tr>
            <tr><td><b>Rack</b></td><td>${(baies.find(b => b.id == eq.baieId) || {}).name || (baies.find(b => b.id == eq.baieId) || {}).nom || ''}</td></tr>
            <tr><td><b>Adresse IP</b></td><td>${eq.ipAddress || ''}</td></tr>
            <tr><td><b>N° Grille IN/OUT</b></td><td>${eq.grilleINOUT || ''}</td></tr>
            <tr><td><b>Date installation</b></td><td>${eq.installDate || ''}</td></tr>
            <tr><td><b>Fin garantie</b></td><td>${eq.garantieDate || ''}</td></tr>
            <tr><td><b>Notes</b></td><td>${eq.notes || ''}</td></tr>
            <tr><td><b>QR</b></td><td>${eq.qr ? `<img src="${eq.qr}" width="70">` : ''}</td></tr>
          </tbody>
        </table>
        ${eq.images && eq.images.length ? eq.images.map(img => `<img src="${img}" style="max-width:60px;max-height:38px;margin:2px;">`).join('') : ''}
        <hr>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn gray" onclick="document.getElementById('equip-quickview-modal').remove()">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close-modal').onclick = () => modal.remove();
  }

  readFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  async getFilteredEquipements() {
    let eqs = await db.getAll('equipments');
    if (this.filters.type) eqs = eqs.filter(eq => eq.type === this.filters.type);
    if (this.filters.statut) eqs = eqs.filter(eq => eq.statut === this.filters.statut);
    if (this.filters.salle) eqs = eqs.filter(eq => eq.roomId == this.filters.salle);
    if (this.filters.search) {
      const q = this.filters.search.toLowerCase();
      eqs = eqs.filter(eq =>
        (eq.name || '').toLowerCase().includes(q) ||
        (eq.numSerie || '').toLowerCase().includes(q) ||
        (eq.marque || '').toLowerCase().includes(q) ||
        (eq.modele || '').toLowerCase().includes(q)
      );
    }
    eqs.sort((a, b) => {
      const valA = a[this.sortField] || '';
      const valB = b[this.sortField] || '';
      if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return eqs;
  }

  refreshList() {
    this.render().then(html => {
      document.getElementById('admin-content').innerHTML = html;
      this.afterRender();
    });
  }
}
