import { db } from './db.js';
import { getCurrentUser } from './security.js';

export default class Baies {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { roomId: '', search: '' };
  }

  async render() {
    const [baies, rooms] = await Promise.all([
      db.getAll('baies'),
      db.getAll('rooms')
    ]);

    // بحث وفلاتر
    let filteredBaies = baies;
    if (this.filters.roomId) filteredBaies = filteredBaies.filter(b => b.roomId == this.filters.roomId);
    if (this.filters.search)
      filteredBaies = filteredBaies.filter(b => (b.name || '').toLowerCase().includes(this.filters.search.toLowerCase()));

    const currentUser = getCurrentUser();
    const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'responsible';

    return `
      <div class="card">
        <div class="card-header">
          <h2>Gestion des Baies</h2>
          <div class="card-actions">
            ${canEdit ? `
              <button id="export-baies" class="btn gray">Exporter JSON</button>
              <button id="import-baies" class="btn gray">Importer JSON</button>
              <input type="file" id="import-baies-file" style="display:none">
            ` : ''}
          </div>
        </div>
        <div class="filters-container">
          <input type="text" id="baie-search" class="form-control" style="width:120px;" placeholder="Recherche baie..." value="${this.filters.search}">
          <select id="filter-room" class="form-control">
            <option value="">Salle: Toutes</option>
            ${rooms.map(r => `<option value="${r.id}" ${this.filters.roomId == r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
          </select>
          <button id="reset-baie-filters" class="btn gray"><i class="fas fa-times"></i></button>
        </div>
        ${canEdit ? `
        <form id="add-baie-form" class="flex" style="margin-bottom:20px;gap:10px;">
          <input name="name" type="text" placeholder="Nom baie" required>
          <select name="roomId" required>
            <option value="">Salle</option>
            ${rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
          </select>
          <input name="image" type="file" accept="image/*">
          <button class="btn">Ajouter</button>
        </form>
        ` : ''}
        <div style="overflow-x:auto;">
        <table class="tableau">
          <tr>
            <th>Nom</th>
            <th>Salle</th>
            <th>Image</th>
            ${canEdit ? `<th></th>` : ''}
          </tr>
          ${filteredBaies.map(baie => `
            <tr>
              <td>${baie.name}</td>
              <td>${(rooms.find(r => r.id == baie.roomId) || {}).name || ''}</td>
              <td>${baie.image ? `<img src="${baie.image}" class="img-preview">` : ''}</td>
              ${canEdit ? `<td>
                <button class="btn danger" data-id="${baie.id}" data-action="del">Supprimer</button>
              </td>` : ''}
            </tr>
          `).join('')}
        </table>
        </div>
      </div>
    `;
  }

  async afterRender() {
    document.getElementById('baie-search').oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    document.getElementById('filter-room').onchange = e => { this.filters.roomId = e.target.value; this.refreshList(); };
    document.getElementById('reset-baie-filters').onclick = () => { this.filters = { roomId: '', search: '' }; this.refreshList(); };

    const currentUser = getCurrentUser();
    const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'responsible';

    if (canEdit && document.getElementById('add-baie-form')) {
      document.getElementById('add-baie-form').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        let imgData = '';
        if (form.image.files.length) imgData = await this.readFile(form.image.files[0]);
        await db.save('baies', {
          name: form.name.value,
          roomId: form.roomId.value,
          image: imgData,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        form.reset();
        this.refreshList();
      };
    }
    if (canEdit) {
      document.querySelectorAll('button[data-action="del"]').forEach(btn => {
        btn.onclick = async () => {
          if (confirm("Supprimer cette baie ?")) {
            await db.delete('baies', Number(btn.getAttribute('data-id')));
            this.refreshList();
          }
        };
      });
    }

    // تصدير/استيراد
    if (document.getElementById('export-baies')) {
      document.getElementById('export-baies').onclick = async () => {
        const baies = await db.getAll('baies');
        const blob = new Blob([JSON.stringify(baies, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "baies.json";
        a.click();
      };
    }
    if (document.getElementById('import-baies')) {
      document.getElementById('import-baies').onclick = () => {
        document.getElementById('import-baies-file').click();
      };
      document.getElementById('import-baies-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const baies = JSON.parse(text);
          for (const b of baies) await db.save('baies', b);
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
}
