import { db } from './db.js';
import { getCurrentUser } from './security.js';

// ============ Salles (Rooms) =============
export default class Salles {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { responsible: '', search: '' };
  }

  async render() {
    const [rooms, users] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('users'),
    ]);
    const responsibles = users.filter(u => u.role === 'responsible' || u.role === 'manager');
    let filteredRooms = rooms;
    if (this.filters.responsible) filteredRooms = filteredRooms.filter(r => r.responsibleId == this.filters.responsible);
    if (this.filters.search)
      filteredRooms = filteredRooms.filter(r => (r.name || '').toLowerCase().includes(this.filters.search.toLowerCase()));

    const currentUser = getCurrentUser();
    const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'responsible';

    return `
      <div class="card">
        <div class="card-header">
          <h2>Gestion des Salles</h2>
          <div class="card-actions">
            ${canEdit ? `
              <button id="export-salles" class="btn gray">Exporter JSON</button>
              <button id="import-salles" class="btn gray">Importer JSON</button>
              <input type="file" id="import-salles-file" style="display:none">
            ` : ''}
          </div>
        </div>
        <div class="filters-container">
          <input type="text" id="salle-search" class="form-control" style="width:140px;" placeholder="Recherche salle..." value="${this.filters.search}">
          <select id="filter-responsible" class="form-control">
            <option value="">Responsable: Tous</option>
            ${responsibles.map(u => `<option value="${u.id}" ${this.filters.responsible == u.id ? 'selected' : ''}>${u.fullName || u.username}</option>`).join('')}
          </select>
          <button id="reset-salle-filters" class="btn gray"><i class="fas fa-times"></i></button>
        </div>
        ${canEdit ? `
        <form id="add-salle-form" class="flex" enctype="multipart/form-data" style="margin-bottom:20px;gap:10px;">
          <input name="name" type="text" placeholder="Nom salle" required>
          <input name="location" type="text" placeholder="Emplacement">
          <select name="responsibleId">
            <option value="">Responsable</option>
            ${responsibles.map(u => `<option value="${u.id}">${u.fullName || u.username}</option>`).join('')}
          </select>
          <input name="image" type="file" accept="image/*">
          <div id="custom-fields-list"></div>
          <button type="button" class="btn" id="add-custom-field-btn"><i class="fas fa-plus"></i> Ajouter champ</button>
          <button class="btn">Ajouter</button>
        </form>
        ` : ''}
        <div style="overflow-x:auto;">
        <table class="tableau">
          <tr>
            <th>Nom</th>
            <th>Image</th>
            <th>Emplacement</th>
            <th>Responsable</th>
            <th>Position</th>
            <th>Champs personnalisés</th>
            ${canEdit ? `<th></th>` : ''}
          </tr>
          ${filteredRooms.map(salle => `
            <tr>
              <td>${salle.name}</td>
              <td>${salle.image ? `<img src="${salle.image}" class="img-preview">` : ''}</td>
              <td>${salle.location || ''}</td>
              <td>${(users.find(u => u.id == salle.responsibleId) || {}).fullName || ''}</td>
              <td>
                ${salle.coordinates ? `X:${salle.coordinates.x}, Y:${salle.coordinates.y}` : ''}
                ${canEdit ? `<button class="btn gray" data-id="${salle.id}" data-action="coord">Coord.</button>` : ''}
              </td>
              <td>
                ${salle.customFields && salle.customFields.length ? `
                  <ul>${salle.customFields.map(f => `<li><b>${f.key}</b>: ${f.value}</li>`).join('')}</ul>
                ` : ''}
              </td>
              ${canEdit ? `<td>
                <button class="btn danger" data-id="${salle.id}" data-action="del">Supprimer</button>
              </td>` : ''}
            </tr>
          `).join('')}
        </table>
        </div>
      </div>
    `;
  }

  async afterRender() {
    // البحث والفلاتر
    document.getElementById('salle-search').oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    document.getElementById('filter-responsible').onchange = e => { this.filters.responsible = e.target.value; this.refreshList(); };
    document.getElementById('reset-salle-filters').onclick = () => { this.filters = { responsible: '', search: '' }; this.refreshList(); };

    const currentUser = getCurrentUser();
    const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'responsible';

    // إضافة/تعديل غرفة
    if (canEdit && document.getElementById('add-salle-form')) {
      // حقول مخصصة
      let customFields = [];
      const customFieldsList = document.getElementById('custom-fields-list');
      const updateFieldsList = () => {
        customFieldsList.innerHTML = customFields.map((f, i) => `
          <div class="cf-row" data-index="${i}" style="display:flex;gap:4px;">
            <input type="text" class="cf-key" placeholder="Clé" value="${f.key || ''}" style="width:80px;">
            <input type="text" class="cf-value" placeholder="Valeur" value="${f.value || ''}" style="width:130px;">
            <button type="button" class="btn-icon remove-cf" title="Supprimer"><i class="fas fa-times"></i></button>
          </div>
        `).join('');
        // Bind remove btns
        customFieldsList.querySelectorAll('.remove-cf').forEach(btn => {
          btn.onclick = () => {
            const idx = +btn.parentElement.dataset.index;
            customFields.splice(idx, 1);
            updateFieldsList();
          };
        });
        // Mise à jour key/value live
        customFieldsList.querySelectorAll('.cf-key').forEach((inp, idx) => {
          inp.oninput = e => { customFields[idx].key = e.target.value; };
        });
        customFieldsList.querySelectorAll('.cf-value').forEach((inp, idx) => {
          inp.oninput = e => { customFields[idx].value = e.target.value; };
        });
      };

      document.getElementById('add-custom-field-btn').onclick = () => {
        customFields.push({ key: '', value: '' });
        updateFieldsList();
      };

      document.getElementById('add-salle-form').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        let imgData = '';
        if (form.image.files.length) imgData = await this.readFile(form.image.files[0]);
        await db.save('rooms', {
          name: form.name.value,
          image: imgData,
          location: form.location.value,
          responsibleId: form.responsibleId.value,
          coordinates: null,
          customFields: customFields.filter(f => f.key && f.value),
          createdAt: new Date(),
          updatedAt: new Date()
        });
        form.reset();
        customFields = [];
        updateFieldsList();
        this.refreshList();
      };
      // تحديث الحقول عند كل إعادة رسم
      updateFieldsList();
    }

    // حذف غرفة
    if (canEdit) {
      document.querySelectorAll('button[data-action="del"]').forEach(btn => {
        btn.onclick = async () => {
          if (confirm("Supprimer cette salle ?")) {
            await db.delete('rooms', Number(btn.getAttribute('data-id')));
            this.refreshList();
          }
        };
      });
      document.querySelectorAll('button[data-action="coord"]').forEach(btn => {
        btn.onclick = () => this.showCoordModal(Number(btn.getAttribute('data-id')));
      });
    }

    // تصدير/استيراد
    if (document.getElementById('export-salles')) {
      document.getElementById('export-salles').onclick = async () => {
        const salles = await db.getAll('rooms');
        const blob = new Blob([JSON.stringify(salles, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "salles.json";
        a.click();
      };
    }
    if (document.getElementById('import-salles')) {
      document.getElementById('import-salles').onclick = () => {
        document.getElementById('import-salles-file').click();
      };
      document.getElementById('import-salles-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const salles = JSON.parse(text);
          for (const s of salles) await db.save('rooms', s);
          alert("Importation réussie !");
          this.refreshList();
        } catch(err) {
          alert("Erreur lors de l'importation !");
        }
      };
    }
  }

  refreshList() {
    this.render().then(html => {
      document.getElementById('admin-content').innerHTML = html;
      this.afterRender();
    });
  }

  readFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  async showCoordModal(idSalle) {
    const salle = await db.get('rooms', idSalle);
    // احرص على استخدام صورة الخريطة الرئيسية من الإعدادات، وليس صورة الغرفة!
    let mapImg = 'assets/plan-technique.jpg';
    try {
      const settings = await db.get('settings', 1);
      if (settings && settings.mapImageUrl) mapImg = settings.mapImageUrl;
    } catch {}
    const modal = document.createElement('div');
    modal.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;";
    modal.innerHTML = `
      <div style="background:#fff;padding:25px;border-radius:12px;max-width:540px;margin:10vh auto;position:relative;">
        <h3>Définir la position de la salle <span style="color:#2874a6">${salle.name}</span></h3>
        <div style="position:relative;">
          <img src="${mapImg}" id="plan-img" style="max-width:430px;border:1px solid #888;border-radius:8px;">
          <div id="marker" style="position:absolute;left:${salle.coordinates?.x || 20}px;top:${salle.coordinates?.y || 20}px;width:22px;height:22px;background:#2980b9b0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;border-radius:50%;">S</div>
        </div>
        <br>
        <button class="btn gray" id="close-coord-modal">Annuler</button>
        <button class="btn" id="save-coord-modal">Enregistrer</button>
      </div>
    `;
    document.body.appendChild(modal);

    const planImg = modal.querySelector('#plan-img');
    const marker = modal.querySelector('#marker');
    let coords = salle.coordinates || {x: 20, y: 20};
    planImg.onclick = (e) => {
      const rect = planImg.getBoundingClientRect();
      coords.x = Math.round(e.clientX - rect.left);
      coords.y = Math.round(e.clientY - rect.top);
      marker.style.left = coords.x + 'px';
      marker.style.top = coords.y + 'px';
    };
    modal.querySelector('#close-coord-modal').onclick = () => modal.remove();
    modal.querySelector('#save-coord-modal').onclick = async () => {
      await db.save('rooms', { ...salle, coordinates: coords });
      modal.remove();
      this.refreshList();
    };
  }
}
