import { db } from './db.js';
import { closeInteractiveMap, contexteCarte } from './interactive-map.js';
import { editableMapEntityFromView } from './map-edit-context-contract.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';

/*
 * DÉSIGNER UN RESPONSABLE N'EST PAS MODIFIER UNE FICHE (A-1).
 *
 * MESURÉ : cet éditeur écrivait `responsibleId` sans le moindre contrôle, alors que
 * `salles.js` — l'autre écran qui édite le même champ — le protège par `rooms.assign`.
 * Deux écrans, deux règles, pour un champ dont le serveur déduisait l'autorité de zone.
 * Le serveur tranche désormais seul (`RESPONSIBLE_ASSIGN_ADMIN_ONLY`) ; cette garde-ci
 * évite simplement de présenter un champ dont l'enregistrement serait refusé.
 */
const peutDesignerUnResponsable = () => PermissionManager.check(getCurrentUser(), 'rooms', 'assign');

const same = (left, right) => left != null && right != null && String(left) === String(right);
const normalizeId = value => typeof db.normalizeKey === 'function'
  ? db.normalizeKey(value)
  : (/^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : value);
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
})[character]);

function currentEditableMapEntity() {
  const panel = document.getElementById('map-panel');
  // La Fiche équipement conserve volontairement la vue salle/baie en arrière-plan pour
  // pouvoir rouvrir la carte au même endroit. Cette vue de reprise n'est PAS l'entité
  // affichée : le bouton salle/baie n'a donc aucune autorité dans le panneau équipement.
  if (!panel || panel.style.display === 'none' || panel.querySelector('#edit-equipment-btn')) return null;
  return editableMapEntityFromView(contexteCarte()?.vue);
}

function canManageCurrentMap() {
  return Boolean(document.getElementById('map-modal') && document.getElementById('edit-mode-btn'));
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

function notify(message, type = 'success') {
  const app = globalThis.__APP;
  const ui = app?.UIs?.admin || app?.UIs?.responsible || app?.UIs?.tech;
  if (ui?.notifications?.showNotification) ui.notifications.showNotification(message, type);
  else window.dispatchEvent(new CustomEvent('platform-notification', { detail:{ message, type } }));
}

function reopenMapWithFreshData() {
  const reopen = document.querySelector('#open-map-btn, .btn-map, [data-action="open-map"]');
  closeInteractiveMap({ notify:false });
  if (reopen instanceof HTMLElement) setTimeout(() => reopen.click(), 80);
}

async function saveRoom(room, form) {
  let image = room.image || room.imageUrl || '';
  if (form.image.files.length) image = await readFile(form.image.files[0]);
  // Sans autorisation, le champ n'existe pas dans le formulaire : on réenregistre la valeur
  // actuelle telle quelle, pour que l'écriture ne soit pas lue comme un changement d'autorité.
  const responsibleId = form.responsibleId
    ? (form.responsibleId.value ? normalizeId(form.responsibleId.value) : '')
    : (room.responsibleId ?? '');
  await db.save('rooms', {
    ...room,
    name: form.name.value.trim(),
    location: form.location.value.trim(),
    responsibleId,
    image,
    updatedAt: new Date()
  });
}

async function saveBaie(baie, form, equipments) {
  const nextRoomId = normalizeId(form.roomId.value);
  let image = baie.image || baie.imageUrl || '';
  if (form.image.files.length) image = await readFile(form.image.files[0]);
  const roomChanged = !same(nextRoomId, baie.roomId);
  await db.save('baies', {
    ...baie,
    name: form.name.value.trim(),
    roomId: nextRoomId,
    image,
    updatedAt: new Date()
  });
  if (roomChanged) {
    // Voir `baies.js` : le serveur réaligne les équipements dans la transaction qui écrit la
    // baie. Les repousser ici produirait une écriture par équipement, et un `409` sur
    // chacune — leur révision vient d'avancer. On corrige la projection locale, rien de plus.
    const linked = equipments.filter(equipment => same(equipment.baieId, baie.id));
    for (const equipment of linked) {
      await db.saveLocalOnly('equipments', { ...equipment, roomId: nextRoomId });
    }
    return linked.length;
  }
  return 0;
}

export async function openMapEntityEditor(type, rawId) {
  if (!canManageCurrentMap() || !['room','baie'].includes(type)) return;
  const id = normalizeId(rawId);
  const [record, rooms, users, equipments] = await Promise.all([
    db.get(type === 'room' ? 'rooms' : 'baies', id),
    db.getAll('rooms'),
    db.getAll('users').catch(() => []),
    type === 'baie' ? db.getAll('equipments') : Promise.resolve([])
  ]);
  if (!record) {
    notify(type === 'room' ? 'Salle introuvable.' : 'Baie introuvable.', 'error');
    return;
  }

  document.getElementById('map-entity-edit-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'map-entity-edit-modal';
  modal.className = 'modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:var(--z-carte-fenetre, 2147483000);background:rgba(8,18,28,.72);display:flex;align-items:center;justify-content:center;padding:18px;';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  // Même déclaration que dans `salles.js` : la fenêtre nomme la fiche qu'elle édite, pour
  // qu'une modification distante soit signalée au lieu d'écraser la saisie en cours.
  modal.dataset.entityStore = type === 'room' ? 'rooms' : 'baies';
  modal.dataset.entityId = String(record.id);

  const responsibles = users.filter(user => ['admin','manager','responsible','responsable'].includes(user.role));
  const roomFields = type === 'room' ? `
    <div class="form-group"><label>Emplacement</label><input name="location" type="text" value="${escapeHTML(record.location || '')}" placeholder="Emplacement de la salle"></div>
    <div class="form-group"><label>Responsable</label>${peutDesignerUnResponsable()
      ? `<select name="responsibleId"><option value="">Aucun responsable</option>${responsibles.map(user => `<option value="${escapeHTML(user.id)}" ${same(user.id, record.responsibleId) ? 'selected' : ''}>${escapeHTML(user.fullName || user.username || user.id)}</option>`).join('')}</select>`
      : `<p class="salle-responsable-fige">${escapeHTML((responsibles.find(user => same(user.id, record.responsibleId)) || {}).fullName || 'Aucun responsable')}</p>`}</div>
  ` : `
    <div class="form-group"><label>Salle</label><select name="roomId" required data-entity-search="room" data-entity-search-placeholder="Rechercher une salle…"><option value="">Sélectionner une salle</option>${rooms.map(room => `<option value="${escapeHTML(room.id)}" ${same(room.id, record.roomId) ? 'selected' : ''}>${escapeHTML(room.name || room.nom || room.id)}</option>`).join('')}</select></div>
  `;

  modal.innerHTML = `
    <div class="modal-content" style="width:min(620px,96vw);max-height:90vh;overflow:auto;">
      <button type="button" class="close-modal" aria-label="Fermer">&times;</button>
      <h3><i class="fas fa-${type === 'room' ? 'door-open' : 'cube'}"></i> Modifier ${type === 'room' ? 'la salle' : 'la baie'}</h3>
      <p style="margin-top:-4px;color:#667085;">Les coordonnées et la zone dessinée sont conservées. Utilisez « Modifier les positions » pour la géométrie.</p>
      <form id="map-entity-edit-form">
        <div class="form-group"><label>Nom</label><input name="name" type="text" value="${escapeHTML(record.name || record.nom || '')}" required autofocus></div>
        ${roomFields}
        <div class="form-group"><label>Image</label><input name="image" type="file" accept="image/*"><small>Laissez vide pour conserver l’image actuelle.</small></div>
        ${(record.image || record.imageUrl) ? `<img src="${escapeHTML(record.image || record.imageUrl)}" alt="Aperçu" style="max-width:150px;max-height:100px;object-fit:cover;border-radius:8px;">` : ''}
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
          <button type="button" class="btn gray" id="map-entity-edit-cancel">Annuler</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Enregistrer</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.close-modal').onclick = close;
  modal.querySelector('#map-entity-edit-cancel').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.querySelector('#map-entity-edit-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      let moved = 0;
      if (type === 'room') await saveRoom(record, form);
      else moved = await saveBaie(record, form, equipments);
      close();
      window.dispatchEvent(new CustomEvent('platform-map-entity-updated', { detail:{ type, id, movedEquipments:moved } }));
      notify(moved ? `Baie modifiée ; ${moved} équipement(s) réaligné(s) sur la nouvelle salle.` : `${type === 'room' ? 'Salle' : 'Baie'} modifiée avec succès.`, 'success');
      reopenMapWithFreshData();
    } catch (error) {
      submit.disabled = false;
      notify(error.message || 'Modification impossible.', 'error');
    }
  };
}

function ensureContextEditAction() {
  if (!canManageCurrentMap()) return;
  const menu = document.getElementById('admin-context-menu');
  if (!menu || menu.querySelector('[data-action="edit-details"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'context-menu-item';
  button.dataset.action = 'edit-details';
  button.setAttribute('role', 'menuitem');
  button.innerHTML = '<i class="fas fa-pen-to-square"></i><span>Modifier les informations</span>';
  menu.insertBefore(button, menu.firstChild);
}

/*
 * IDEMPOTENTE, VOLONTAIREMENT — L'OBSERVATEUR PLUS BAS Y REVIENT SUR CHAQUE MUTATION DU
 * DOCUMENT ENTIER.
 *
 * DÉFAUT MESURÉ, en Chromium réel : réécrire `existing.innerHTML` était INCONDITIONNEL,
 * même quand le texte à poser était déjà celui affiché. Or réécrire `innerHTML` DÉTRUIT et
 * RECRÉE les nœuds enfants — c'est une mutation `childList`, que le `MutationObserver`
 * ci-dessous, posé sur `document.documentElement` avec `subtree:true`, ne pouvait pas
 * ignorer : il rappelait cette fonction, qui réécrivait `innerHTML` de nouveau, ce qui
 * produisait la mutation suivante. Boucle auto-entretenue, sans jamais qu'aucune autre
 * partie de la page n'ait à bouger : ouvrir un simple panneau Salle ou Baie suffisait à la
 * démarrer, et l'onglet se figeait.
 *
 * Le remède n'est pas de cesser d'observer, ni de retirer ce bouton : c'est de ne toucher
 * au DOM QUE lorsque ce que ce bouton doit dire a RÉELLEMENT changé. Le seul fait qui varie
 * dans son texte est le TYPE de l'entité (« la salle » / « la baie ») — jamais son
 * identifiant, puisque le clic relit `currentEditableMapEntity()` à l'instant où il a lieu,
 * jamais une valeur figée ici. Le comparer avant d'écrire suffit à rendre l'appel neutre
 * quand rien n'a changé, et donc à rompre la boucle à sa source.
 */
function ensurePanelEditAction() {
  if (!canManageCurrentMap()) return;
  const panel = document.getElementById('map-panel');
  if (!panel) return;
  const existing = panel.querySelector('#map-edit-entity-details');
  const current = currentEditableMapEntity();
  if (panel.style.display === 'none' || !current) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.dataset.entityType !== current.type) {
      existing.dataset.entityType = current.type;
      existing.innerHTML = `<i class="fas fa-edit"></i> Modifier ${current.type === 'room' ? 'la salle' : 'la baie'}`;
    }
    return;
  }
  const back = panel.querySelector('#panel-back-btn');
  if (!back) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'map-edit-entity-details';
  button.className = 'btn';
  button.style.marginLeft = '12px';
  button.dataset.entityType = current.type;
  button.innerHTML = `<i class="fas fa-edit"></i> Modifier ${current.type === 'room' ? 'la salle' : 'la baie'}`;
  back.insertAdjacentElement('afterend', button);
  button.addEventListener('click', () => {
    const target = currentEditableMapEntity();
    if (target) openMapEntityEditor(target.type, target.id);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    const hotspot = event.target.closest?.('.map-hotspot[data-type][data-id]');
    if (hotspot) setTimeout(ensurePanelEditAction, 30);

    const edit = event.target.closest?.('#admin-context-menu [data-action="edit-details"]');
    if (!edit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const menu = edit.closest('#admin-context-menu');
    const type = menu?.getAttribute('data-type');
    const id = menu?.getAttribute('data-id');
    menu.style.display = 'none';
    if (['room','baie'].includes(type)) openMapEntityEditor(type, id);
  }, true);

  const observer = new MutationObserver(() => {
    ensureContextEditAction();
    ensurePanelEditAction();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  globalThis.__mapAdminEntityEditObserver = observer;
}
