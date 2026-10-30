import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { addLog } from './logs.js';
import { eventSystem } from './events.js';

// ========== الصفحة الرئيسية ==========
export async function showTicketsPage(target = 'admin-content') {
  const tickets = await db.getAll('tickets');
  const openCount = tickets.filter(t => t.status !== 'fermé').length;
  const urgentCount = tickets.filter(t => t.prio === 'haute' && t.status !== 'fermé').length;
  const solvedCount = tickets.filter(t => t.status === 'prêt-fermeture').length;

  document.getElementById(target).innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <h2 style="margin:0;">Tickets Support</h2>
        <button class="btn" id="add-ticket-btn"><i class="fas fa-plus"></i> Nouvelle demande</button>
      </div>
      <div style="display:flex;gap:30px;margin-top:12px;margin-bottom:12px;">
        <span><b>${openCount}</b> ouvertes</span>
        <span style="color:#e74c3c;"><b>${urgentCount}</b> urgentes</span>
        <span style="color:#16a085;"><b>${solvedCount}</b> prêtes à fermer</span>
      </div>
      <div id="tickets-list-container"></div>
    </div>
  `;
  showTicketsList({ target: 'tickets-list-container' });

  document.getElementById('add-ticket-btn').onclick = () => openTicketModal({});
}

// ========== واجهة إضافة تذكرة ==========
export async function openTicketModal({ type = '', id = null } = {}) {
  const user = getCurrentUser();
  const [equipements, rooms, baies] = await Promise.all([
    db.getAll('equipments'),
    db.getAll('rooms'),
    db.getAll('baies')
  ]);
  document.getElementById('ticket-modal')?.remove();

  const slaTimes = { basse: 72 * 60, moyenne: 24 * 60, haute: 6 * 60 };

  const modal = document.createElement('div');
  modal.id = 'ticket-modal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="min-width:350px;max-width:420px;">
      <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
      <h3 style="color:#2874a6;">Créer un ticket support</h3>
      <form id="ticket-form">
        <label>Type d'élément</label>
        <select name="relatedType" id="related-type" required>
          <option value="">-- Choisir --</option>
          <option value="equipment">Équipement</option>
          <option value="room">Salle</option>
          <option value="baie">Baie</option>
        </select>
        <div id="related-selector"></div>
        <label>Catégorie</label>
        <select name="category" required>
          <option value="">---</option>
          <option value="panne">Panne</option>
          <option value="maintenance">Maintenance</option>
          <option value="connexion">Connexion</option>
          <option value="autre">Autre</option>
        </select>
        <label>Description <span style="color:#e74c3c;">*</span></label>
        <textarea name="desc" required style="height:60px;"></textarea>
        <label>Priorité</label>
        <select name="prio" id="ticket-prio" required>
          <option value="moyenne">Moyenne</option>
          <option value="haute">Haute</option>
          <option value="basse">Basse</option>
        </select>
        <div id="sla-info" style="color:#888;font-size:13px;margin:3px 0 6px;"></div>
        <label>Pièce jointe</label>
        <input type="file" name="attach" accept="image/*,application/pdf">
        <div style="margin:10px 0;">
          <button type="button" class="btn gray" id="cancel-ticket-btn">Annuler</button>
          <button type="submit" class="btn btn-primary">Envoyer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.close-modal').onclick = () => modal.remove();
  document.getElementById('cancel-ticket-btn').onclick = () => modal.remove();

  // اختيار العنصر مع بحث ذكي
  document.getElementById('related-type').onchange = (e) => {
    const type = e.target.value;
    const relatedDiv = document.getElementById('related-selector');
    if (type === 'equipment') {
      relatedDiv.innerHTML = `
        <label>Équipement</label>
        <input type="text" id="eq-search-input" placeholder="🔍 Recherche équipement... (nom, marque, SN...)" style="width:99%;padding:6px 10px;margin-bottom:5px;border-radius:7px;border:1px solid #ddd;">
        <select name="relatedId" id="eq-select" required style="width:99%;max-width:330px;">
          <option value="">-- Choisir un équipement --</option>
          ${equipements.map(eq => `<option value="${eq.id}">
            ${eq.nom || eq.name || ''} | ${eq.type || ''} | ${eq.marque || ''} | ${eq.modele || ''} | SN:${eq.numSerie || ''}
          </option>`).join('')}
        </select>
      `;
      const eqSearchInput = document.getElementById('eq-search-input');
      const eqSelect = document.getElementById('eq-select');
      eqSearchInput.oninput = function() {
        const q = eqSearchInput.value.toLowerCase();
        eqSelect.innerHTML = `<option value="">-- Choisir un équipement --</option>` +
          equipements
            .filter(eq =>
              (eq.nom || eq.name || '').toLowerCase().includes(q) ||
              (eq.type || '').toLowerCase().includes(q) ||
              (eq.marque || '').toLowerCase().includes(q) ||
              (eq.modele || '').toLowerCase().includes(q) ||
              (eq.numSerie || '').toLowerCase().includes(q)
            )
            .map(eq => `<option value="${eq.id}">
              ${eq.nom || eq.name || ''} | ${eq.type || ''} | ${eq.marque || ''} | ${eq.modele || ''} | SN:${eq.numSerie || ''}
            </option>`).join('');
      };
    } else if (type === 'room') {
      relatedDiv.innerHTML = `
        <label>Salle</label>
        <input type="text" id="room-search-input" placeholder="🔍 Recherche salle..." style="width:99%;padding:6px 10px;margin-bottom:5px;border-radius:7px;border:1px solid #ddd;">
        <select name="relatedId" id="room-select" required style="width:99%;max-width:330px;">
          <option value="">-- Choisir une salle --</option>
          ${rooms.map(r => `<option value="${r.id}">${r.name || r.nom || ''}</option>`).join('')}
        </select>
      `;
      const rSearch = document.getElementById('room-search-input');
      const rSelect = document.getElementById('room-select');
      rSearch.oninput = function() {
        const q = rSearch.value.toLowerCase();
        rSelect.innerHTML = `<option value="">-- Choisir une salle --</option>` +
          rooms.filter(r => (r.name || r.nom || '').toLowerCase().includes(q))
               .map(r => `<option value="${r.id}">${r.name || r.nom || ''}</option>`).join('');
      };
    } else if (type === 'baie') {
      relatedDiv.innerHTML = `
        <label>Baie</label>
        <input type="text" id="baie-search-input" placeholder="🔍 Recherche baie..." style="width:99%;padding:6px 10px;margin-bottom:5px;border-radius:7px;border:1px solid #ddd;">
        <select name="relatedId" id="baie-select" required style="width:99%;max-width:330px;">
          <option value="">-- Choisir une baie --</option>
          ${baies.map(b => `<option value="${b.id}">${b.name || b.nom || ''}</option>`).join('')}
        </select>
      `;
      const bSearch = document.getElementById('baie-search-input');
      const bSelect = document.getElementById('baie-select');
      bSearch.oninput = function() {
        const q = bSearch.value.toLowerCase();
        bSelect.innerHTML = `<option value="">-- Choisir une baie --</option>` +
          baies.filter(b => (b.name || b.nom || '').toLowerCase().includes(q))
               .map(b => `<option value="${b.id}">${b.name || b.nom || ''}</option>`).join('');
      };
    } else {
      relatedDiv.innerHTML = '';
    }
  };

  document.getElementById('ticket-prio').onchange = (e) => {
    const prio = e.target.value;
    const min = slaTimes[prio] || slaTimes.moyenne;
    document.getElementById('sla-info').innerHTML =
      `Délai maximum de résolution : <b>${Math.floor(min/60)}h${(min%60) ? (min%60)+'m' : ''}</b>`;
  };
  document.getElementById('ticket-prio').dispatchEvent(new Event('change'));

  document.getElementById('ticket-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    let attach = '';
    if (form.attach.files.length) attach = await readFile(form.attach.files[0]);
    const relatedType = form.relatedType.value;
    const relatedId = form.relatedId ? form.relatedId.value : '';
    let relatedName = '';
    if (relatedType === 'equipment') {
      relatedName = (equipements.find(eq => eq.id == relatedId) || {}).name || (equipements.find(eq => eq.id == relatedId) || {}).nom || '';
    } else if (relatedType === 'room') {
      relatedName = (rooms.find(r => r.id == relatedId) || {}).name || (rooms.find(r => r.id == relatedId) || {}).nom || '';
    } else if (relatedType === 'baie') {
      relatedName = (baies.find(b => b.id == relatedId) || {}).name || (baies.find(b => b.id == relatedId) || {}).nom || '';
    }
    const prio = form.prio.value;
    const slaMins = slaTimes[prio] || slaTimes.moyenne;
    const deadline = new Date(Date.now() + slaMins*60000);

    const ticket = {
      id: Date.now(),
      type: relatedType,
      relatedId,
      relatedName,
      desc: form.desc.value,
      category: form.category.value,
      prio,
      status: 'en cours',
      solution: '',
      solutionUser: '',
      closedAt: null,
      createdBy: user?.fullName || user?.username || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      comments: [],
      attach,
      slaMinutes: slaMins,
      deadline: deadline,
      readyToClose: false
    };
    await db.save('tickets', ticket);
    addLog({ action: 'ticket-create', type: 'info', details: `Création ticket #${ticket.id}`, target: relatedType, targetId: relatedId });
    notifyAllUsers(`Nouvelle demande support: ${relatedName} (${prio})`);
    modal.remove();
    showTicketsPage();
    showToast('Ticket envoyé!', 'success');
  };
}

// ========== قائمة التذاكر ==========
export async function showTicketsList({ filterType = '', filterStatus = '', search = '', target = 'admin-content' } = {}) {
  let tickets = await db.getAll('tickets');
  const user = getCurrentUser();

  if (filterType) tickets = tickets.filter(t => t.type === filterType);
  if (filterStatus) tickets = tickets.filter(t => t.status === filterStatus);
  if (search && search.length > 1) {
    const q = search.toLowerCase();
    tickets = tickets.filter(t =>
      (t.desc && t.desc.toLowerCase().includes(q)) ||
      (t.relatedName && t.relatedName.toLowerCase().includes(q)) ||
      (t.category && t.category.toLowerCase().includes(q)) ||
      (t.createdBy && t.createdBy.toLowerCase().includes(q)) ||
      (t.status && t.status.toLowerCase().includes(q))
    );
  }
  tickets = tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  document.getElementById(target).innerHTML = `
    <div style="margin-bottom:12px;">
      <input id="tickets-search" type="search" placeholder="Recherche..." style="min-width:160px;padding:6px 14px;border-radius:8px;border:1px solid #b4bfc9;margin-right:10px;">
      <select id="tickets-type-filter" class="form-control" style="margin-right:8px;">
        <option value="">Tous types</option>
        <option value="equipment">Équipements</option>
        <option value="room">Salles</option>
        <option value="baie">Baies</option>
      </select>
      <select id="tickets-status-filter" class="form-control">
        <option value="">Tous statuts</option>
        <option value="en cours">En cours</option>
        <option value="attente">En attente</option>
        <option value="prêt-fermeture">Prêt à fermer</option>
        <option value="fermé">Fermé</option>
      </select>
    </div>
    <div style="overflow-x:auto;">
      <table class="tableau">
        <tr>
          <th>N°</th>
          <th>Élément</th>
          <th>Type</th>
          <th>Description</th>
          <th>Priorité</th>
          <th>Status</th>
          <th>SLA</th>
          <th>Date</th>
          <th>Par</th>
          <th></th>
        </tr>
        ${tickets.length ? tickets.map(t => {
          let slaLabel = '';
          let timeLeft = Math.max(0, (new Date(t.deadline) - Date.now())/60000);
          if (t.status === 'fermé') slaLabel = 'Fermé';
          else if (t.status === 'prêt-fermeture') slaLabel = 'Prêt à fermer';
          else if (timeLeft > 0) slaLabel = timeLeft > 60 ? `${Math.floor(timeLeft/60)}h${Math.floor(timeLeft%60)}m` : `${Math.ceil(timeLeft)}m`;
          else slaLabel = '<span style="color:#e74c3c;">⚠️ Dépassé</span>';
          let trColor = '';
          if (t.status === 'prêt-fermeture') trColor = 'background:#d0f5e2;';
          else if (t.status === 'fermé') trColor = 'background:#f2f2f2;';
          else if (t.prio === 'haute' && timeLeft < 60) trColor = 'background:#fdecea;';

          return `
            <tr class="ticket-row" style="cursor:pointer;${trColor}" data-id="${t.id}">
              <td><span class="badge" style="background:#555;color:#fff;">${t.id}</span></td>
              <td>${t.relatedName || '-'}</td>
              <td>${t.type}</td>
              <td>${t.desc.length > 40 ? t.desc.substring(0,37)+'...' : t.desc}</td>
              <td><span class="status-badge ${t.prio}">${t.prio}</span></td>
              <td><span class="status-badge status-${t.status.replace(/ /g,'-')}">${t.status}</span></td>
              <td>${slaLabel}</td>
              <td>${formatDate(t.createdAt)}</td>
              <td>${t.createdBy || ''}</td>
              <td>
                <button class="btn-icon" data-id="${t.id}" data-action="view"><i class="fas fa-eye"></i></button>
              </td>
            </tr>
          `;
        }).join('') : `<tr><td colspan="10" style="text-align:center;color:#aaa;">Aucun ticket trouvé.</td></tr>`}
      </table>
    </div>
  `;
  document.getElementById('tickets-type-filter').onchange = e =>
    showTicketsList({ filterType: e.target.value, filterStatus: document.getElementById('tickets-status-filter').value, search: document.getElementById('tickets-search').value, target });
  document.getElementById('tickets-status-filter').onchange = e =>
    showTicketsList({ filterType: document.getElementById('tickets-type-filter').value, filterStatus: e.target.value, search: document.getElementById('tickets-search').value, target });
  document.getElementById('tickets-search').oninput = e =>
    setTimeout(() =>
      showTicketsList({
        filterType: document.getElementById('tickets-type-filter').value,
        filterStatus: document.getElementById('tickets-status-filter').value,
        search: e.target.value,
        target
      }), 350);

  document.querySelectorAll('button[data-action="view"], .ticket-row').forEach(btn => {
    btn.onclick = async (ev) => {
      const tid = btn.getAttribute('data-id') || btn.closest('tr').getAttribute('data-id');
      const ticket = await db.get('tickets', Number(tid));
      showTicketDetails(ticket, target);
    };
  });
}

// ========== تفاصيل التذكرة (عداد حي/تعليقات بصورة/بحث ذكي/إشعارات) ==========
export function showTicketDetails(ticket, refreshTarget = null) {
  document.getElementById('ticket-detail-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ticket-detail-modal';
  modal.className = 'modal';
  const user = getCurrentUser();
  const isAdmin = user?.role === 'admin';

  // Helper
  function isMyUser(u) {
    return u === (user?.fullName || user?.username) || isAdmin;
  }

  let slaDivId = `sla-timer-${ticket.id}`;
  function formatSLA(sec) {
    if (ticket.status === 'fermé') return 'Fermé';
    if (ticket.status === 'prêt-fermeture') return 'Prêt à fermer';
    if (sec <= 0) return '<span style="color:#e74c3c;">⚠️ Dépassé</span>';
    let h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
    return `${h ? h+'h ' : ''}${m}m ${s}s`;
  }

  let commentSearchValue = '';
  function renderComments() {
    let commentsToShow = (ticket.comments||[]);
    if (commentSearchValue) {
      const q = commentSearchValue.toLowerCase();
      commentsToShow = commentsToShow.filter(c =>
        (c.text || '').toLowerCase().includes(q) ||
        (c.user || '').toLowerCase().includes(q) ||
        (c.date || '').toLowerCase().includes(q)
      );
    }
    return commentsToShow.map((c, i) => `
      <div style="background:#f6f6fb;padding:6px 8px;margin:4px 0;border-radius:6px;position:relative;" id="cmt-${i}">
        <b>${c.user}</b>
        <span style="color:#aaa;font-size:12px;">${c.date}</span>
        ${isMyUser(c.user) ? `
          <button class="btn-icon" title="تعديل" style="position:absolute;right:28px;top:4px;" onclick="window.editCmt${ticket.id}(${i})"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" title="حذف" style="position:absolute;right:3px;top:4px;" onclick="window.delCmt${ticket.id}(${i})"><i class="fas fa-trash"></i></button>
        ` : ''}
        <div id="cmt-text-${i}">
          ${c.text}
          ${c.img ? `<br><img src="${c.img}" style="max-width:180px;margin-top:4px;border-radius:5px;">` : ''}
          ${c.pdf ? `<br><a href="${c.pdf}" target="_blank"><i class="fas fa-file-pdf"></i> PDF joint</a>` : ''}
        </div>
      </div>
    `).join('');
  }

  modal.innerHTML = `
    <div class="modal-content" style="min-width:430px;max-width:680px;">
      <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
      <h3 style="color:#2874a6;">Ticket #${ticket.id}</h3>
      <div>
        <b>Élément:</b> ${ticket.relatedName || '-'} <span style="font-size:13px;">[${ticket.type}]</span><br>
        <b>Description:</b> <span>${ticket.desc}</span><br>
        <b>Créé par:</b> ${ticket.createdBy || '-'}<br>
        <b>Date:</b> ${formatDate(ticket.createdAt)}<br>
        <b>Priorité:</b> <span class="status-badge ${ticket.prio}">${ticket.prio}</span>
        <b> | SLA restant:</b> <span id="${slaDivId}"></span><br>
        <b>Status:</b>
        <select id="ticket-status-select" style="margin:3px;" ${(isAdmin||['manager','responsible','technician'].includes(user?.role)) && ticket.status!=='fermé' ? '' : 'disabled'}>
          <option value="en cours" ${ticket.status==='en cours'?'selected':''}>En cours</option>
          <option value="attente" ${ticket.status==='attente'?'selected':''}>En attente</option>
          <option value="prêt-fermeture" ${ticket.status==='prêt-fermeture'?'selected':''}>Prêt à fermer</option>
          <option value="fermé" ${ticket.status==='fermé'?'selected':''}>Fermé</option>
        </select>
        ${ticket.attach ? `<br><a href="${ticket.attach}" target="_blank"><i class="fas fa-paperclip"></i> Pièce jointe</a>` : ''}
      </div>
      <div style="margin-top:8px;">
        <label>Solution proposée:</label>
        <div id="solution-block">
          <textarea id="ticket-solution" rows="2" style="width:95%;" 
            ${(isAdmin || ticket.solutionUser === (user?.fullName || user?.username)) && ticket.status!=='fermé' ? '' : 'readonly'}>
            ${ticket.solution || ''}
          </textarea>
          ${(isAdmin || ticket.solutionUser === (user?.fullName || user?.username)) && ticket.status!=='fermé' ? `
            <button id="save-solution-btn" class="btn" style="margin:5px 0;">Enregistrer solution</button>
          ` : ''}
        </div>
      </div>
      <hr>
      <div>
        <h4>Commentaires</h4>
        <input type="text" id="comment-search" placeholder="Recherche dans les commentaires..." style="width:98%;margin-bottom:4px;padding:4px 8px;">
        <div id="ticket-comments-list">
          ${renderComments()}
        </div>
        <div style="margin-top:8px;">
          <input type="text" id="new-ticket-comment" class="form-control" placeholder="Ajouter un commentaire...">
          <input type="file" id="comment-attach" accept="image/*,application/pdf" style="width:53%;">
          <button id="add-ticket-comment-btn" class="btn gray" style="margin-left:5px;">Ajouter</button>
        </div>
      </div>
      <hr>
      <div style="margin:10px 0;">
        <button class="btn" id="close-ticket-detail">Fermer</button>
        ${(isAdmin && ticket.status === 'prêt-fermeture') ? `<button class="btn danger" id="admin-close-btn">Fermer le ticket</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // عداد حي للوقت المتبقي
  function updateSLATimer() {
    let el = document.getElementById(slaDivId);
    if (!el) return;
    let now = Date.now(), left = Math.max(0, (new Date(ticket.deadline)-now)/1000);
    el.innerHTML = formatSLA(left);
    if (ticket.status!=='fermé' && ticket.status!=='prêt-fermeture') setTimeout(updateSLATimer, 1000);
  }
  updateSLATimer();

  modal.querySelector('.close-modal').onclick = () => modal.remove();
  document.getElementById('close-ticket-detail').onclick = () => modal.remove();

  // تغيير الحالة
  document.getElementById('ticket-status-select').onchange = async (e) => {
    const newStatus = e.target.value;
    if (newStatus === 'fermé' && !isAdmin) {
      showToast("Seul l'administrateur peut fermer ce ticket.", "error");
      document.getElementById('ticket-status-select').value = ticket.status;
      return;
    }
    ticket.status = newStatus;
    ticket.updatedAt = new Date();
    await db.save('tickets', ticket);
    addLog({ action: 'ticket-status', type: 'info', details: `Ticket #${ticket.id} -> ${ticket.status}` });
    notifyAllUsers(`Changement statut ticket #${ticket.id} à ${newStatus}.`);
    if (refreshTarget) showTicketsList({ target: refreshTarget });
    showToast('Statut mis à jour!', 'success');
    modal.remove();
    showTicketDetails(await db.get('tickets', ticket.id), refreshTarget);
  };

  // إغلاق نهائي للأدمن
  if (document.getElementById('admin-close-btn')) {
    document.getElementById('admin-close-btn').onclick = async () => {
      ticket.status = 'fermé';
      ticket.closedAt = new Date();
      ticket.updatedAt = new Date();
      await db.save('tickets', ticket);
      addLog({ action: 'ticket-close', type: 'info', details: `Ticket #${ticket.id} fermé par admin` });
      notifyAllUsers(`Ticket #${ticket.id} fermé par administrateur.`);
      showToast("Ticket fermé avec succès !", "success");
      if (refreshTarget) showTicketsList({ target: refreshTarget });
      modal.remove();
    };
  }

  // حل التذكرة (تعديل فقط لصاحب الحل أو الأدمن)
  if ((isAdmin || ticket.solutionUser === (user?.fullName || user?.username)) && document.getElementById('save-solution-btn')) {
    document.getElementById('save-solution-btn').onclick = async () => {
      const val = document.getElementById('ticket-solution').value.trim();
      ticket.solution = val;
      ticket.solutionUser = user?.fullName || user?.username; // سجل من كتب الحل
      ticket.updatedAt = new Date();
      await db.save('tickets', ticket);
      addLog({ action: 'ticket-solution', type: 'info', details: `Ticket #${ticket.id} solution modifiée.` });
      notifyAllUsers(`Ticket #${ticket.id}: Solution ajoutée ou modifiée.`);
      showToast('Solution enregistrée.', 'success');
      if (refreshTarget) showTicketsList({ target: refreshTarget });
      showTicketDetails(ticket, refreshTarget);
    };
  }

  // بحث حي في التعليقات
  document.getElementById('comment-search').oninput = function(e) {
    commentSearchValue = e.target.value.trim();
    document.getElementById('ticket-comments-list').innerHTML = renderComments();
  };

  // إضافة تعليق بصورة
  document.getElementById('add-ticket-comment-btn').onclick = async () => {
    const txt = document.getElementById('new-ticket-comment').value.trim();
    const file = document.getElementById('comment-attach').files[0];
    let img = '', pdf = '';
    if (file) {
      if (file.type.startsWith('image/')) img = await readFile(file);
      else if (file.type === 'application/pdf') pdf = await readFile(file);
    }
    if (!txt && !img && !pdf) return;
    const comment = {
      user: user?.fullName || user?.username || 'N/A',
      text: txt,
      img,
      pdf,
      date: formatDate(new Date())
    };
    ticket.comments.push(comment);
    ticket.updatedAt = new Date();
    await db.save('tickets', ticket);
    addLog({ action: 'ticket-comment', type: 'info', details: `Ticket #${ticket.id} commentaire.` });
    notifyAllUsers(`Nouveau commentaire sur ticket #${ticket.id}.`);
    showTicketDetails(await db.get('tickets', ticket.id), refreshTarget);
  };

  // ============ تعديل أو حذف التعليق ============
  window['editCmt'+ticket.id] = function(i) {
    const cmt = ticket.comments[i];
    if (!cmt) return;
    const cmtDiv = document.getElementById(`cmt-${i}`);
    cmtDiv.innerHTML = `
      <b>${cmt.user}</b> <span style="color:#aaa;font-size:12px;">${cmt.date}</span>
      <textarea id="edit-cmt-text" style="width:90%;">${cmt.text}</textarea>
      <button class="btn gray" onclick="window.saveCmt${ticket.id}(${i})">Sauvegarder</button>
      <button class="btn" onclick="window.cancelEditCmt${ticket.id}(${i})">Annuler</button>
    `;
    window['saveCmt'+ticket.id] = function(idx) {
      const val = document.getElementById('edit-cmt-text').value.trim();
      if (!val) return;
      ticket.comments[idx].text = val;
      ticket.updatedAt = new Date();
      db.save('tickets', ticket).then(() => {
        addLog({ action: 'ticket-comment-edit', type: 'info', details: `Ticket #${ticket.id} commentaire modifié.` });
        notifyAllUsers(`Un commentaire a été modifié sur ticket #${ticket.id}.`);
        showToast('Commentaire modifié.', 'success');
        showTicketDetails(ticket, refreshTarget);
      });
    };
    window['cancelEditCmt'+ticket.id] = function(idx) {
      showTicketDetails(ticket, refreshTarget);
    };
  };
  window['delCmt'+ticket.id] = function(i) {
    if (!confirm('Supprimer ce commentaire ?')) return;
    ticket.comments.splice(i,1);
    ticket.updatedAt = new Date();
    db.save('tickets', ticket).then(() => {
      addLog({ action: 'ticket-comment-delete', type: 'info', details: `Ticket #${ticket.id} commentaire supprimé.` });
      notifyAllUsers(`Un commentaire a été supprimé sur ticket #${ticket.id}.`);
      showToast('Commentaire supprimé.', 'success');
      showTicketDetails(ticket, refreshTarget);
    });
  };
}

// ========== أدوات ==========
function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
function readFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}
function showToast(msg, type = "info") {
  let toast = document.createElement('div');
  toast.className = `notification notification-${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '28px',
    right: '32px',
    background: type === "error" ? "#e74c3c" : "#2874a6",
    color: "#fff",
    padding: "13px 22px",
    borderRadius: "12px",
    fontSize: "16px",
    zIndex: 20000,
    boxShadow: "0 2px 22px #c3e3fc"
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}
export function notifyAllUsers(msg) {
  eventSystem.dispatch('show-notification', {
    message: msg,
    type: 'info'
  });
}
