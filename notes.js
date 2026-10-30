import { db } from './db.js';
import { getCurrentUser } from './security.js';

// فتح نافذة إدارة الملاحظات لأي عنصر
export function openNotesModal(targetId, targetType = 'equipments', options = {}) {
  showNotesList(targetId, targetType, options);
}

async function showNotesList(targetId, targetType, { notifications, canCreate = true, canDelete = true } = {}) {
  const notes = await getNotes(targetId, targetType);
  const currentUser = getCurrentUser();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.zIndex = 21000;
  modal.innerHTML = `
    <div class="modal-content" style="min-width:340px;max-width:500px;">
      <button class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</button>
      <h3>Notes rapides</h3>
      ${canCreate ? `<form id="add-note-form" style="margin-bottom:12px;">
        <textarea id="note-msg" placeholder="Ajouter une note..."></textarea>
        <button type="submit" class="btn small"><i class="fas fa-sticky-note"></i> Ajouter</button>
      </form>` : ''}
      <div id="notes-list">
        ${notes.length ? notes.map(note => noteHTML(note, currentUser, canDelete)).join('') : '<div style="color:#888;">Aucune note.</div>'}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-modal').onclick = () => modal.remove();

  const noteForm = modal.querySelector('#add-note-form');
  if (noteForm) noteForm.onsubmit = async (e) => {
    e.preventDefault();
    const msg = modal.querySelector('#note-msg').value.trim();
    if (msg.length < 2) return;
    await db.save('notes', {
      id: Date.now(),
      targetId,
      targetType,
      message: msg,
      author: currentUser.fullName || currentUser.username,
      createdAt: new Date().toISOString()
    });
    notifications?.showNotification('Note ajoutée !', 'success');
    modal.remove();
    showNotesList(targetId, targetType, { notifications, canCreate, canDelete });
  };

  modal.querySelectorAll('.remove-note').forEach(btn => {
    btn.onclick = async () => {
      await db.delete('notes', Number(btn.dataset.id));
      notifications?.showNotification('Note supprimée.', 'info');
      modal.remove();
      showNotesList(targetId, targetType, { notifications, canCreate, canDelete });
    };
  });
}

// جلب كل الملاحظات لهذا العنصر
export async function getNotes(targetId, targetType = 'equipments') {
  const all = await db.getAll('notes');
  return all.filter(n => n.targetType === targetType && n.targetId === targetId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// HTML ملاحظة واحدة
function noteHTML(note, user, deletionAllowed) {
  const canDelete = deletionAllowed && (note.author === (user.fullName || user.username) || ['admin', 'manager'].includes(user.role));
  return `
    <div class="note-item" style="background:#fffae6;padding:7px 10px;margin-bottom:7px;border-radius:7px;position:relative;">
      <div style="font-size:15px;">${escapeHTML(note.message)}</div>
      <div style="font-size:12px;color:#999;">
        — <b>${escapeHTML(note.author)}</b>, ${formatDate(note.createdAt)}
        ${canDelete ? `<button class="btn-icon remove-note" data-id="${note.id}" style="float:right;"><i class="fas fa-times"></i></button>` : ''}
      </div>
    </div>
  `;
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
