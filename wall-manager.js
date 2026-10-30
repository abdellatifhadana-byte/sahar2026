import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { PermissionManager } from './permissions.js';
import { addLog } from './logs.js';
import { eventSystem } from './events.js';
import { openTicketModal } from './tickets.js';
import { openNotesModal } from './notes.js';
import { generateQR } from './qr.js';
import { normalizeId, normalizePosition, toCanonicalScreen } from './wall-model.js';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SCREEN_STATUSES = Object.freeze([
  ['ok', 'Fonctionnel'],
  ['error', 'En panne'],
  ['maintenance', 'Maintenance']
]);

export default class WallManager {
  constructor({ notifications, onOpenDiagnostic, onBack, onOpenMap } = {}) {
    this.notifications = notifications;
    this.onOpenDiagnostic = onOpenDiagnostic;
    this.onBack = onBack;
    this.onOpenMap = onOpenMap;
    this.user = getCurrentUser();
    this.rooms = [];
    this.walls = [];
    this.screens = [];
    this.equipments = [];
    this.currentRoomId = null;
    this.currentWall = null;
    this.dragState = null;
    this.drawing = false;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
  }

  async render() {
    [this.rooms, this.walls, this.screens, this.equipments] = await Promise.all([
      db.getAll('rooms'), db.getAll('walls'), db.getAll('screens'), db.getAll('equipments')
    ]);
    this.currentRoomId = await db.getCurrentRoomId() ?? this.rooms[0]?.id ?? null;
    return `<section class="wall-page card">
      <header class="wall-header"><div><h2>Mur d'images</h2><p>Disposez les écrans d'une salle sur une image de référence.</p></div>
        <div class="wall-navigation"><button type="button" id="wall-back" class="btn gray">Retour</button>
          <button type="button" id="wall-map" class="btn gray">Retour à la carte</button>
          <label>Salle <select id="wall-room-select"></select></label></div>
      </header>
      <div id="wall-empty" class="empty-note" hidden></div>
      <div id="wall-toolbar" class="wall-toolbar"></div>
      <div id="wall-canvas" class="wall-canvas" aria-label="Disposition du mur d'images"></div>
      <div id="wall-editor" class="wall-editor"></div>
    </section>`;
  }

  async afterRender() {
    const select = document.getElementById('wall-room-select');
    document.getElementById('wall-back').addEventListener('click', () => this.onBack?.());
    document.getElementById('wall-map').addEventListener('click', () => this.onOpenMap?.());
    for (const room of this.rooms) {
      const option = document.createElement('option');
      option.value = room.id;
      option.textContent = room.name || room.nom || `Salle ${room.id}`;
      option.selected = String(room.id) === String(this.currentRoomId);
      select.appendChild(option);
    }
    select.addEventListener('change', async event => this.selectRoom(event.target.value));
    if (this.currentRoomId != null) await this.selectRoom(this.currentRoomId);
    else this.showEmpty('Créez d’abord une salle pour configurer un mur d’images.');
  }

  async selectRoom(roomId) {
    this.currentRoomId = normalizeId(roomId);
    await db.setCurrentRoomId(this.currentRoomId);
    this.currentWall = this.walls.find(wall => String(wall.roomId) === String(this.currentRoomId)) || null;
    this.renderCurrentWall();
  }

  renderCurrentWall() {
    const canvas = document.getElementById('wall-canvas');
    const toolbar = document.getElementById('wall-toolbar');
    const empty = document.getElementById('wall-empty');
    canvas.replaceChildren();
    toolbar.replaceChildren();
    if (!this.currentWall) {
      canvas.hidden = true;
      empty.hidden = false;
      empty.textContent = "Aucun mur n'est configuré pour cette salle.";
      if (PermissionManager.check(this.user, 'walls', 'create')) {
        toolbar.appendChild(this.button('Dessiner/configurer le mur', () => this.createWall(), 'btn primary'));
      }
      return;
    }
    empty.hidden = true;
    canvas.hidden = false;
    canvas.style.backgroundImage = this.currentWall.image ? `url("${this.currentWall.image}")` : 'none';
    this.renderToolbar(toolbar);
    const screens = this.screens.filter(screen => String(screen.wallId) === String(this.currentWall.id));
    for (const screen of screens) canvas.appendChild(this.createScreenElement(screen));
    if (!screens.length) this.showEmpty("Ce mur ne contient encore aucun écran.", false);
  }

  renderToolbar(toolbar) {
    toolbar.append(
      this.button('Zoom +', () => this.setZoom(this.zoom + 0.1), 'btn gray'),
      this.button('Zoom −', () => this.setZoom(this.zoom - 0.1), 'btn gray'),
      this.button('Recentrer', () => this.resetView(), 'btn gray'),
      ...(PermissionManager.check(this.user, 'notes', 'view') ? [this.button('Notes du mur', () => openNotesModal(this.currentWall.id, 'wall', { notifications: this.notifications, canCreate: PermissionManager.check(this.user, 'notes', 'create'), canDelete: PermissionManager.check(this.user, 'notes', 'delete') }), 'btn gray')] : [])
    );
    if (PermissionManager.check(this.user, 'screens', 'create')) {
      toolbar.appendChild(this.button('Ajouter un écran', () => this.createScreen()));
      toolbar.appendChild(this.button('Dessiner un écran', () => this.enableDrawing(), 'btn primary'));
      toolbar.appendChild(this.button('Lier un écran existant', () => this.linkExistingScreen(), 'btn gray'));
    }
    if (PermissionManager.check(this.user, 'walls', 'edit')) toolbar.appendChild(this.button('Modifier le mur', () => this.renameWall(), 'btn gray'));
    if (PermissionManager.check(this.user, 'walls', 'delete')) toolbar.appendChild(this.button('Supprimer le mur', () => this.deleteWall(), 'btn danger'));
    if (PermissionManager.check(this.user, 'walls', 'changeImage')) {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true;
      input.addEventListener('change', async event => {
        try { await this.changeImage(event.target.files[0]); }
        catch (error) { this.notify(error.message, 'error'); await this.audit('wall-image-error', "Échec de l'image du mur", { wallId: this.currentWall?.id, error: error.message }); }
      });
      toolbar.append(this.button("Changer l'image", () => input.click(), 'btn gray'), input);
    }
    this.enablePan();
  }

  assertPermission(entity, action) {
    if (!PermissionManager.check(this.user, entity, action)) {
      const error = new Error("Vous n'êtes pas autorisé à effectuer cette action.");
      error.code = 'FORBIDDEN';
      throw error;
    }
  }

  setZoom(value) {
    this.zoom = Math.max(0.5, Math.min(2.5, Number(value.toFixed(2))));
    this.applyViewTransform();
  }

  resetView() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.applyViewTransform(); }

  applyViewTransform() {
    const canvas = document.getElementById('wall-canvas');
    if (canvas) canvas.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  enablePan() {
    const canvas = document.getElementById('wall-canvas');
    canvas.addEventListener('pointerdown', event => {
      if (event.target !== canvas || this.drawing || !event.shiftKey) return;
      const start = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
      const move = moveEvent => {
        this.pan = { x: start.panX + moveEvent.clientX - start.x, y: start.panY + moveEvent.clientY - start.y };
        this.applyViewTransform();
      };
      const end = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end, { once: true });
    });
  }

  createScreenElement(rawScreen) {
    const screen = toCanonicalScreen(rawScreen);
    const position = normalizePosition(screen);
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `wall-screen status-${screen.status}`;
    element.dataset.screenId = screen.id;
    element.textContent = screen.name;
    Object.assign(element.style, { left: `${position.x}%`, top: `${position.y}%`, width: `${position.width}%`, height: `${position.height}%` });
    element.addEventListener('click', () => this.renderScreenEditor(screen));
    if (PermissionManager.check(this.user, 'screens', 'move')) {
      element.addEventListener('pointerdown', event => this.startDrag(event, element, screen));
      const handle = document.createElement('span');
      handle.className = 'wall-resize-handle';
      handle.setAttribute('aria-label', "Redimensionner l'écran");
      handle.addEventListener('pointerdown', event => this.startResize(event, element, screen));
      element.appendChild(handle);
    }
    return element;
  }

  startDrag(event, element, screen) {
    this.assertPermission('screens', 'move');
    if (event.button !== 0) return;
    event.preventDefault();
    const canvas = document.getElementById('wall-canvas');
    const position = normalizePosition(screen);
    this.dragState = { element, screen, canvas, startX: event.clientX, startY: event.clientY, position };
    element.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(100 - position.width, position.x + (moveEvent.clientX - this.dragState.startX) / rect.width * 100));
      const y = Math.max(0, Math.min(100 - position.height, position.y + (moveEvent.clientY - this.dragState.startY) / rect.height * 100));
      element.style.left = `${x}%`; element.style.top = `${y}%`;
    };
    const end = async () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end);
      const updated = { ...screen, position: { ...position, x: parseFloat(element.style.left), y: parseFloat(element.style.top) } };
      await this.saveScreen(updated, 'Écran déplacé');
      this.dragState = null;
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end, { once: true });
  }

  startResize(event, element, screen) {
    this.assertPermission('screens', 'move');
    event.preventDefault(); event.stopPropagation();
    const canvas = document.getElementById('wall-canvas');
    const position = normalizePosition(screen);
    element.setPointerCapture(event.pointerId);
    const startX = event.clientX; const startY = event.clientY;
    const move = moveEvent => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(5, Math.min(100 - position.x, position.width + (moveEvent.clientX - startX) / rect.width * 100));
      const height = Math.max(5, Math.min(100 - position.y, position.height + (moveEvent.clientY - startY) / rect.height * 100));
      element.style.width = `${width}%`; element.style.height = `${height}%`;
    };
    const end = async () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end);
      await this.saveScreen({ ...screen, position: { ...position, width: parseFloat(element.style.width), height: parseFloat(element.style.height) } }, 'Écran redimensionné');
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end, { once: true });
  }

  enableDrawing() {
    this.assertPermission('screens', 'create');
    const canvas = document.getElementById('wall-canvas');
    this.drawing = true;
    canvas.classList.add('is-drawing');
    this.notify('Cliquez et faites glisser pour dessiner un écran.', 'info');
    const start = event => {
      if (!this.drawing || event.target !== canvas) return;
      const rect = canvas.getBoundingClientRect();
      const origin = { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 };
      const preview = document.createElement('div');
      preview.className = 'wall-draw-preview';
      Object.assign(preview.style, { left: `${origin.x}%`, top: `${origin.y}%`, width: '0%', height: '0%' });
      canvas.appendChild(preview);
      const move = moveEvent => {
        const x = (moveEvent.clientX - rect.left) / rect.width * 100;
        const y = (moveEvent.clientY - rect.top) / rect.height * 100;
        const left = Math.max(0, Math.min(origin.x, x));
        const top = Math.max(0, Math.min(origin.y, y));
        Object.assign(preview.style, { left: `${left}%`, top: `${top}%`, width: `${Math.min(100 - left, Math.abs(x - origin.x))}%`, height: `${Math.min(100 - top, Math.abs(y - origin.y))}%` });
      };
      const end = async () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointerdown', start);
        const position = { x: parseFloat(preview.style.left), y: parseFloat(preview.style.top), width: parseFloat(preview.style.width), height: parseFloat(preview.style.height), unit: '%' };
        preview.remove();
        this.drawing = false;
        canvas.classList.remove('is-drawing');
        if (position.width < 5 || position.height < 5) return this.notify("La zone dessinée est trop petite.", 'warning');
        await this.createScreen(position);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
    };
    canvas.addEventListener('pointerdown', start);
  }

  async createWall() {
    this.assertPermission('walls', 'create');
    const now = new Date().toISOString();
    const wall = { id: `wall-${this.currentRoomId}`, roomId: this.currentRoomId, name: 'Mur principal', image: '', layout: { unit: '%' }, createdAt: now, updatedAt: now };
    await db.save('walls', wall);
    this.walls.push(wall);
    this.currentWall = wall;
    await this.audit('wall-created', 'Mur créé', { wallId: wall.id, roomId: wall.roomId });
    this.notify('Mur créé avec succès.', 'success');
    this.renderCurrentWall();
  }

  async createScreen(position = { x: 5, y: 5, width: 20, height: 15, unit: '%' }) {
    this.assertPermission('screens', 'create');
    const count = this.screens.filter(item => String(item.wallId) === String(this.currentWall.id)).length;
    // Même normalisation qu'au déplacement et au redimensionnement : une géométrie hors
    // bornes ne peut pas entrer par la création. Le miroir plat est dérivé de la
    // géométrie canonique, jamais saisi séparément.
    const geometry = normalizePosition({ position });
    const screen = {
      roomId: this.currentRoomId,
      wallId: this.currentWall.id,
      name: `Écran ${count + 1}`,
      status: 'ok',
      position: geometry,
      positionX: geometry.x,
      positionY: geometry.y,
      width: geometry.width,
      height: geometry.height,
      equipmentId: null,
      createdAt: new Date().toISOString()
    };
    screen.id = await db.save('screens', screen);
    this.screens.push({ ...screen });
    await this.audit('screen-created', 'Écran créé', { screenId: screen.id, wallId: screen.wallId });
    this.notify('Écran créé.', 'success');
    this.renderCurrentWall();
  }

  renderScreenEditor(rawScreen) {
    const screen = toCanonicalScreen(rawScreen);
    const editor = document.getElementById('wall-editor');
    editor.replaceChildren();

    const title = document.createElement('h3');
    title.textContent = screen.name;
    editor.appendChild(title);

    const canEdit = PermissionManager.check(this.user, 'screens', 'edit');
    const form = document.createElement('div');
    form.className = 'wall-screen-form';

    const makeField = (labelText, control) => {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = labelText;
      label.append(caption, control);
      return label;
    };

    const name = document.createElement('input');
    name.type = 'text'; name.value = screen.name || ''; name.disabled = !canEdit;

    const status = document.createElement('select');
    for (const [value, label] of SCREEN_STATUSES) status.appendChild(new Option(label, value));
    status.value = screen.status; status.disabled = !canEdit;

    const type = document.createElement('input');
    type.type = 'text'; type.value = screen.type || ''; type.placeholder = 'Ex. moniteur broadcast'; type.disabled = !canEdit;

    const model = document.createElement('input');
    model.type = 'text'; model.value = screen.model || ''; model.placeholder = 'Modèle'; model.disabled = !canEdit;

    const serialNumber = document.createElement('input');
    serialNumber.type = 'text'; serialNumber.value = screen.serialNumber || screen.numSerie || ''; serialNumber.placeholder = 'Numéro de série'; serialNumber.disabled = !canEdit;

    form.append(
      makeField('Nom', name),
      makeField('État', status),
      makeField('Type', type),
      makeField('Modèle', model),
      makeField('Numéro de série', serialNumber)
    );

    const equipment = document.createElement('select');
    equipment.appendChild(new Option('Aucun équipement', ''));
    for (const item of this.equipments.filter(item => String(item.roomId) === String(this.currentRoomId))) {
      equipment.appendChild(new Option(item.name || item.nom || `Équipement ${item.id}`, item.id));
    }
    equipment.value = screen.equipmentId ?? '';
    equipment.disabled = !PermissionManager.check(this.user, 'screens', 'linkEquipment');
    equipment.addEventListener('change', async () => {
      try {
        this.assertPermission('screens', 'linkEquipment');
        await this.saveScreen({ ...screen, equipmentId: normalizeId(equipment.value) }, 'Écran lié à un équipement');
      } catch (error) {
        this.notify(error.message, 'error');
      }
    });
    form.appendChild(makeField('Équipement associé', equipment));

    if (canEdit) {
      form.appendChild(this.button('Enregistrer la fiche écran', async () => {
        const nextName = name.value.trim();
        if (!nextName) throw new Error("Le nom de l'écran est obligatoire.");
        await this.saveScreen({
          ...screen,
          name: nextName,
          status: status.value,
          type: type.value.trim(),
          model: model.value.trim(),
          serialNumber: serialNumber.value.trim()
        }, 'Fiche écran mise à jour');
      }, 'btn primary'));
    }
    editor.appendChild(form);

    if (PermissionManager.check(this.user, 'screens', 'diagnose')) editor.appendChild(this.button('Diagnostiquer', () => this.onOpenDiagnostic?.(screen.id), 'btn warning'));
    if (PermissionManager.check(this.user, 'screens', 'createTicket')) editor.appendChild(this.button('Créer un ticket', () => openTicketModal({ type: 'screen', id: screen.id }), 'btn info'));
    if (PermissionManager.check(this.user, 'notes', 'view')) editor.appendChild(this.button('Notes', () => openNotesModal(screen.id, 'screen', { notifications: this.notifications, canCreate: PermissionManager.check(this.user, 'notes', 'create'), canDelete: PermissionManager.check(this.user, 'notes', 'delete') }), 'btn gray'));
    editor.appendChild(this.button('Afficher le QR', async () => this.showQr(screen), 'btn gray'));
    if (PermissionManager.check(this.user, 'screens', 'delete')) editor.appendChild(this.button('Supprimer', () => this.deleteScreen(screen), 'btn danger'));
  }

  async saveScreen(screen, label) {
    this.assertPermission('screens', label.includes('déplacé') || label.includes('redimensionné') ? 'move' : 'edit');
    const canonical = toCanonicalScreen(screen);
    await db.save('screens', canonical);
    const index = this.screens.findIndex(item => String(item.id) === String(canonical.id));
    if (index >= 0) this.screens[index] = canonical;
    await this.audit('screen-updated', label, { screenId: canonical.id, wallId: canonical.wallId, equipmentId: canonical.equipmentId });
    this.notify(`${label}.`, 'success');
    this.renderCurrentWall();
  }

  async deleteScreen(screen) {
    this.assertPermission('screens', 'delete');
    if (!confirm(`Supprimer l'écran « ${screen.name} » ? Les tickets et diagnostics seront conservés.`)) return;
    await db.deleteScreenSafely(screen.id);
    this.screens = this.screens.filter(item => String(item.id) !== String(screen.id));
    await this.audit('screen-deleted', 'Écran supprimé', { screenId: screen.id, wallId: screen.wallId });
    this.notify('Écran supprimé.', 'success');
    document.getElementById('wall-editor').replaceChildren();
    this.renderCurrentWall();
  }

  async changeImage(file) {
    this.assertPermission('walls', 'changeImage');
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Format d'image non autorisé");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("L'image dépasse la limite de 3 Mo");
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    this.currentWall = { ...this.currentWall, image, updatedAt: new Date().toISOString() };
    await db.save('walls', this.currentWall);
    const index = this.walls.findIndex(item => String(item.id) === String(this.currentWall.id));
    if (index >= 0) this.walls[index] = this.currentWall;
    await this.audit('wall-image-changed', 'Image du mur modifiée', { wallId: this.currentWall.id });
    this.notify('Image du mur mise à jour.', 'success');
    this.renderCurrentWall();
  }

  async showQr(screen) {
    const dataUrl = await generateQR(JSON.stringify({ version: 1, type: 'screen', id: screen.id }));
    if (!dataUrl) return this.notify('Le générateur QR est indisponible.', 'warning');
    const image = new Image();
    image.src = dataUrl;
    image.alt = `QR de ${screen.name}`;
    const editor = document.getElementById('wall-editor');
    editor.appendChild(image);
  }

  async linkExistingScreen() {
    this.assertPermission('screens', 'edit');
    const available = this.screens.filter(screen => String(screen.roomId) === String(this.currentRoomId) && !screen.wallId);
    if (!available.length) return this.notify("Aucun écran non lié n'est disponible dans cette salle.", 'info');
    const selection = prompt(`ID de l'écran à lier :\n${available.map(screen => `${screen.id} — ${screen.name}`).join('\n')}`);
    const screen = available.find(item => String(item.id) === String(selection));
    if (!screen) return this.notify("L'écran sélectionné est introuvable.", 'error');
    await this.saveScreen({ ...screen, wallId: this.currentWall.id }, 'Écran lié au mur');
  }

  async renameWall() {
    this.assertPermission('walls', 'edit');
    const name = prompt('Nom du mur', this.currentWall.name || 'Mur principal')?.trim();
    if (!name) return;
    this.currentWall = { ...this.currentWall, name, updatedAt: new Date().toISOString() };
    await db.save('walls', this.currentWall);
    const index = this.walls.findIndex(item => String(item.id) === String(this.currentWall.id));
    if (index >= 0) this.walls[index] = this.currentWall;
    await this.audit('wall-updated', 'Mur modifié', { wallId: this.currentWall.id, name });
    this.notify('Mur modifié.', 'success');
    this.renderCurrentWall();
  }

  async deleteWall() {
    this.assertPermission('walls', 'delete');
    const linkedScreens = this.screens.filter(screen => String(screen.wallId) === String(this.currentWall.id));
    if (linkedScreens.length) return this.notify('Dissociez ou supprimez les écrans avant de supprimer le mur.', 'error');
    if (!confirm(`Supprimer le mur « ${this.currentWall.name} » ?`)) return;
    const wallId = this.currentWall.id;
    await db.delete('walls', wallId);
    this.walls = this.walls.filter(wall => String(wall.id) !== String(wallId));
    this.currentWall = null;
    await this.audit('wall-deleted', 'Mur supprimé', { wallId, roomId: this.currentRoomId });
    this.notify('Mur supprimé.', 'success');
    this.renderCurrentWall();
  }

  // La traçabilité accompagne l'opération, elle ne la conditionne pas. Chaque appelant
  // enchaîne ensuite sa notification de succès et le réaffichage du mur : si l'écriture du
  // journal ou de la notification échouait, ces deux étapes sautaient et un enregistrement
  // pourtant réussi paraissait avoir échoué.
  //
  // `wall-data-changed` est une ANNONCE, pas le mécanisme de rafraîchissement : vérifié,
  // aucun module ne l'écoute. Ce qui remet le mur à l'écran, c'est le `renderCurrentWall()`
  // de l'appelant ; ce qui remet les vues dérivées à jour, c'est `refreshOpenDerivedViews`
  // dans data-visibility-recovery.js, déclenché par l'écriture en base. Le commentaire
  // précédent affirmait l'inverse — croire l'événement suffisant conduirait à retirer ces
  // deux rafraîchissements et à laisser l'écran figé sur des données périmées.
  async audit(type, action, details) {
    await addLog(type, action, details, this.user);
    try {
      await db.save('notifications', {
        userId: this.user?.id ?? null,
        message: action,
        type,
        read: false,
        createdAt: new Date().toISOString(),
        details
      });
    } catch (error) {
      console.warn("Notification d'audit non enregistrée ; l'action elle-même a bien abouti.", error);
    }
    eventSystem.dispatch('wall-data-changed', { type, ...details });
  }

  button(label, handler, className = 'btn') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', async event => {
      try {
        await handler(event);
      } catch (error) {
        console.error(error);
        this.notify(error.message || 'Une erreur est survenue.', 'error');
      }
    });
    return button;
  }

  notify(message, type) {
    this.notifications?.showNotification(message, type);
  }

  showEmpty(message, hideCanvas = true) {
    const empty = document.getElementById('wall-empty');
    empty.textContent = message;
    empty.hidden = false;
    if (hideCanvas) document.getElementById('wall-canvas').hidden = true;
  }
}
