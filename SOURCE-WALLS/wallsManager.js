// wallsManager.js - Version كاملة 100% متكاملة مع salles.js, equipements.js, qr.js وخصائص متقدمة
import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { showTicketsList, openTicketModal } from './tickets.js';
import { NotificationSystem } from './notifications.js'; 
import equipements from './equipements.js'; 
import salles from './salles.js'; 
import { generateQR } from './qr.js';
import ScreensDiagnostic from './screens-diagnostic.js'; // استيراد ScreensDiagnostic

const notifications = new NotificationSystem();

const WallsManager = {
  walls: [],
  currentWall: null,
  currentRoomId: null,
  selectedScreenId: null,
  isDrawingMode: false,
  isDraggingScreen: false,
  isResizingScreen: false,
  dragStartX: 0,
  dragStartY: 0,
  initialScreenX: 0,
  initialScreenY: 0,
  initialScreenWidth: 0,
  initialScreenHeight: 0,
  drawRect: { x: 0, y: 0, width: 0, height: 0 },
  screensDiagnosticInstance: null,

  async initWall(roomId) {
    this.currentRoomId = roomId;
    this.walls = await db.getAll('walls') || [];
    const wall = this.walls.find(w => w.roomId === roomId);

    if (!wall) {
      notifications.showNotification('لا يوجد جدار شاشات مرتبط بهذه القاعة. يمكنك إضافة واحد كمسؤول.', 'warning');
      this.currentWall = {
        id: `wall-${roomId}`,
        roomId,
        nom: `جدار القاعة ${roomId}`,
        image: 'https://placehold.co/1200x800/4a4a4a/ffffff?text=No+Wall+Image',
        screens: []
      };
      await db.save('walls', this.currentWall);
    } else {
      this.currentWall = wall;
    }

    this.renderWall(this.currentWall);

    const user = getCurrentUser();
    if (user && user.role === 'admin') {
      this.adminEditMode();
      this.setupDrawingMode();
    }

    if (!this.screensDiagnosticInstance) {
      this.screensDiagnosticInstance = new ScreensDiagnostic(notifications);
    }
  },

  renderWall(wall) {
    const container = document.getElementById('mur-container');
    if (!container) return;
    container.innerHTML = '';
    container.style.backgroundImage = `url('${wall.image}')`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center center';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '80vh';
    container.style.overflow = 'hidden';
    container.style.border = '1px solid #ddd';

    wall.screens.forEach(screen => {
      const div = document.createElement('div');
      div.className = 'screen-box';
      div.style.position = 'absolute';
      div.style.left = screen.position.x + 'px';
      div.style.top = screen.position.y + 'px';
      div.style.width = screen.position.width + 'px';
      div.style.height = screen.position.height + 'px';

      let borderColor, bgColor;
      switch (screen.status) {
        case 'ok':
          borderColor = '#27ae60';
          bgColor = 'rgba(39, 174, 96, 0.4)';
          break;
        case 'error':
          borderColor = '#e74c3c';
          bgColor = 'rgba(231, 76, 60, 0.4)';
          break;
        case 'maintenance':
          borderColor = '#f39c12';
          bgColor = 'rgba(243, 156, 18, 0.4)';
          break;
        default:
          borderColor = '#95a5a6';
          bgColor = 'rgba(149, 165, 166, 0.4)';
      }

      div.style.border = `2px solid ${borderColor}`;
      div.style.backgroundColor = bgColor;
      div.style.color = 'white';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';
      div.style.fontSize = '14px';
      div.style.fontWeight = 'bold';
      div.style.cursor = 'pointer';
      div.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
      div.style.borderRadius = '5px';
      div.title = screen.nom;
      div.dataset.screenId = screen.id;

      div.innerHTML = `<span>${screen.nom}</span><span style="font-size:11px; font-weight:normal;">(${this.getScreenStatusText(screen.status)})</span>`;
      div.onclick = e => {
        e.stopPropagation();
        this.selectScreen(screen.id);
      };
      container.appendChild(div);

      const user = getCurrentUser();
      if (user && user.role === 'admin') this.makeDraggableAndResizable(div, screen);
    });

    if (this.isDrawingMode && this.drawRect.width > 0 && this.drawRect.height > 0) {
      const drawDiv = document.createElement('div');
      drawDiv.style.position = 'absolute';
      drawDiv.style.left = this.drawRect.x + 'px';
      drawDiv.style.top = this.drawRect.y + 'px';
      drawDiv.style.width = this.drawRect.width + 'px';
      drawDiv.style.height = this.drawRect.height + 'px';
      drawDiv.style.border = '2px dashed #3498db';
      drawDiv.style.backgroundColor = 'rgba(52, 152, 219, 0.2)';
      drawDiv.style.pointerEvents = 'none';
      container.appendChild(drawDiv);
    }
  },

  getScreenStatusText(status) {
    switch (status) {
      case 'ok': return 'جيد';
      case 'error': return 'عطل';
      case 'maintenance': return 'صيانة';
      default: return 'غير معروف';
    }
  },

  makeDraggableAndResizable(element, screen) {
    element.addEventListener('mousedown', e => {
      if (getCurrentUser().role !== 'admin' || this.isDrawingMode) return;
      e.stopPropagation();
      this.selectedScreenId = screen.id;
      this.populateScreenEditor(screen);
      const rect = element.getBoundingClientRect();
      const resizeHandleSize = 10;
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      if (clickX > rect.width - resizeHandleSize && clickY > rect.height - resizeHandleSize) {
        this.isResizingScreen = true;
        element.style.cursor = 'nwse-resize';
      } else {
        this.isDraggingScreen = true;
        element.style.cursor = 'grabbing';
      }
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.initialScreenX = screen.position.x;
      this.initialScreenY = screen.position.y;
      this.initialScreenWidth = screen.position.width;
      this.initialScreenHeight = screen.position.height;
      document.addEventListener('mousemove', this.dragOrResizeHandler);
      document.addEventListener('mouseup', this.stopDragResizeHandler);
    });
  },

  dragOrResizeHandler: e => {
    const container = document.getElementById('mur-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    if (WallsManager.isDraggingScreen) {
      const dx = e.clientX - WallsManager.dragStartX;
      const dy = e.clientY - WallsManager.dragStartY;
      const screen = WallsManager.currentWall.screens.find(s => s.id === WallsManager.selectedScreenId);
      if (screen) {
        screen.position.x = Math.max(0, Math.min(WallsManager.initialScreenX + dx, containerRect.width - screen.position.width));
        screen.position.y = Math.max(0, Math.min(WallsManager.initialScreenY + dy, containerRect.height - screen.position.height));
        WallsManager.renderWall(WallsManager.currentWall);
        WallsManager.populateScreenEditor(screen);
      }
    } else if (WallsManager.isResizingScreen) {
      const dx = e.clientX - WallsManager.dragStartX;
      const dy = e.clientY - WallsManager.dragStartY;
      const screen = WallsManager.currentWall.screens.find(s => s.id === WallsManager.selectedScreenId);
      if (screen) {
        screen.position.width = Math.min(Math.max(50, WallsManager.initialScreenWidth + dx), containerRect.width - screen.position.x);
        screen.position.height = Math.min(Math.max(50, WallsManager.initialScreenHeight + dy), containerRect.height - screen.position.y);
        WallsManager.renderWall(WallsManager.currentWall);
        WallsManager.populateScreenEditor(screen);
      }
    }
  },

  stopDragResizeHandler: () => {
    document.removeEventListener('mousemove', WallsManager.dragOrResizeHandler);
    document.removeEventListener('mouseup', WallsManager.stopDragResizeHandler);
    WallsManager.isDraggingScreen = false;
    WallsManager.isResizingScreen = false;
    notifications.showNotification('تم تحديث موضع/حجم الشاشة. لا تنس الحفظ!', 'info');
    WallsManager.enableSaveButton();
  },

  setupDrawingMode() {
    const container = document.getElementById('mur-container');
    if (!container) return;
    container.addEventListener('mousedown', e => {
      if (!this.isDrawingMode) return;
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      this.drawRect.x = e.clientX - rect.left;
      this.drawRect.y = e.clientY - rect.top;
      this.drawRect.width = 0;
      this.drawRect.height = 0;

      const onMouseMove = moveEvent => {
        this.drawRect.width = (moveEvent.clientX - rect.left) - this.drawRect.x;
        this.drawRect.height = (moveEvent.clientY - rect.top) - this.drawRect.y;
        this.renderWall(this.currentWall);
      };

      const onMouseUp = () => {
        container.removeEventListener('mousemove', onMouseMove);
        container.removeEventListener('mouseup', onMouseUp);
        this.isDrawingMode = false;
        if (this.drawRect.width > 20 && this.drawRect.height > 20) {
          const newScreen = {
            id: `screen-${Date.now()}`,
            nom: `شاشة جديدة ${this.currentWall.screens.length + 1}`,
            position: { x: this.drawRect.x, y: this.drawRect.y, width: this.drawRect.width, height: this.drawRect.height },
            status: 'ok',
            deviceLinked: null,
            qrCode: null,
            problems: []
          };
          this.currentWall.screens.push(newScreen);
          this.renderWall(this.currentWall);
          this.selectedScreenId = newScreen.id;
          this.adminEditMode();
          notifications.showNotification('تمت إضافة شاشة جديدة. قم بتحريكها وتغيير حجمها وحفظ التغييرات.', 'success');
          this.enableSaveButton();
        } else {
          notifications.showNotification('حجم الشاشة صغير جدًا. يرجى الرسم بحجم أكبر.', 'warning');
          this.renderWall(this.currentWall);
        }
        this.drawRect = { x: 0, y: 0, width: 0, height: 0 };
      };

      container.addEventListener('mousemove', onMouseMove);
      container.addEventListener('mouseup', onMouseUp);
    });
  },

  selectScreen(screenId) {
    this.selectedScreenId = screenId;
    const screen = this.currentWall.screens.find(s => s.id === screenId);
    if (!screen) return;
    document.querySelectorAll('.screen-box').forEach(box => { box.style.outline = 'none'; });
    const selectedElement = document.querySelector(`[data-screen-id="${screenId}"]`);
    if (selectedElement) selectedElement.style.outline = '2px dashed #3498db';
    const user = getCurrentUser();
    if (user.role === 'admin') {
      this.populateScreenEditor(screen);
      this.adminEditMode();
    } else {
      this.openDiagnosticModal(screen);
    }
  },

  adminEditMode() {
    const container = document.getElementById('mur-container');
    if (!container) return;
    let tools = document.getElementById('admin-wall-tools');
    if (tools) tools.remove();
    tools = document.createElement('div');
    tools.id = 'admin-wall-tools';
    tools.innerHTML = `
      <button class="btn primary" onclick="WallsManager.toggleDrawingMode()"><i class="fas fa-paint-brush"></i> ${this.isDrawingMode ? 'إلغاء وضع الرسم' : 'وضع الرسم'}</button>
      <button class="btn gray" onclick="document.getElementById('wall-image-upload').click()">🖼️ تغيير صورة الجدار</button>
      <input type="file" id="wall-image-upload" accept="image/*" style="display:none;" onchange="WallsManager.uploadNewImage(event)" />
      <select id="select-screen-to-edit" onchange="WallsManager.selectScreenToEdit(this.value)"><option value="">-- اختر شاشة للتعديل --</option>${this.currentWall.screens.map(s => `<option value="${s.id}" ${this.selectedScreenId === s.id ? 'selected' : ''}>${s.nom}</option>`).join('')}</select>
      <div id="edit-screen-zone"></div>
      <button class="btn success" onclick="WallsManager.saveCurrentWall()" disabled id="save-wall-btn">💾 حفظ التغييرات</button>
      <button class="btn danger" onclick="WallsManager.deleteSelectedScreen()" ${!this.selectedScreenId ? 'disabled' : ''} id="delete-screen-btn">🗑️ حذف الشاشة المحددة</button>
      <button class="btn info" onclick="WallsManager.resetWall()" id="reset-wall-btn">🔄 إعادة تعيين الجدار</button>`;
    container.parentNode.insertBefore(tools, container.nextSibling);
    this.enableSaveButton();
    if (this.selectedScreenId) this.populateScreenEditor(this.currentWall.screens.find(s => s.id === this.selectedScreenId));
  },

  toggleDrawingMode() {
    this.isDrawingMode = !this.isDrawingMode;
    this.selectedScreenId = null;
    const edit = document.getElementById('edit-screen-zone');
    if (edit) edit.innerHTML = '';
    this.renderWall(this.currentWall);
    this.adminEditMode();
    notifications.showNotification(this.isDrawingMode ? 'وضع الرسم مفعل. انقر واسحب لرسم شاشة جديدة.' : 'وضع الرسم معطل.', 'info');
  },

  populateScreenEditor(screen) {
    const editZone = document.getElementById('edit-screen-zone');
    if (!editZone || !screen) return;
    editZone.innerHTML = `
      <h4>تعديل الشاشة: ${screen.nom}</h4>
      <div class="form-group"><label>الاسم:</label><input type="text" value="${screen.nom || ''}" onchange="WallsManager.updateScreenProperty('${screen.id}', 'nom', this.value)"></div>
      <div class="form-group"><label>الحالة:</label><select onchange="WallsManager.updateScreenProperty('${screen.id}', 'status', this.value)"><option value="ok" ${screen.status === 'ok' ? 'selected' : ''}>جيد</option><option value="error" ${screen.status === 'error' ? 'selected' : ''}>عطل</option><option value="maintenance" ${screen.status === 'maintenance' ? 'selected' : ''}>صيانة</option></select></div>
      <div class="form-group"><label>الجهاز المرتبط (ID):</label><input type="text" value="${screen.deviceLinked || ''}" onchange="WallsManager.updateScreenProperty('${screen.id}', 'deviceLinked', this.value)"></div>
      <button class="btn small primary" onclick="WallsManager.generateQrForScreen('${screen.id}')">إنشاء/تحديث QR</button>
      <button class="btn small info" onclick="WallsManager.openScreenTickets('${screen.id}')">عرض التذاكر</button>
      <button class="btn small warning" onclick="WallsManager.openDiagnostic('${screen.id}')">تشخيص الشاشة</button>`;
    this.enableSaveButton();
    const del = document.getElementById('delete-screen-btn');
    if (del) del.disabled = false;
  },

  updateScreenProperty(screenId, propertyPath, value) {
    const screen = this.currentWall.screens.find(s => s.id === screenId);
    if (!screen) return;
    const pathParts = propertyPath.split('.');
    let current = screen;
    for (let i = 0; i < pathParts.length - 1; i++) current = current[pathParts[i]];
    current[pathParts[pathParts.length - 1]] = value;
    this.renderWall(this.currentWall);
    this.enableSaveButton();
  },

  addScreen() { this.toggleDrawingMode(); },

  deleteSelectedScreen() {
    if (!this.selectedScreenId) return notifications.showNotification('الرجاء تحديد شاشة للحذف أولاً.', 'warning');
    if (!confirm('هل أنت متأكد من حذف هذه الشاشة؟')) return;
    this.currentWall.screens = this.currentWall.screens.filter(s => s.id !== this.selectedScreenId);
    this.selectedScreenId = null;
    this.renderWall(this.currentWall);
    this.adminEditMode();
    notifications.showNotification('تم حذف الشاشة بنجاح.', 'success');
    this.enableSaveButton();
  },

  async uploadNewImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      this.currentWall.image = e.target.result;
      this.renderWall(this.currentWall);
      notifications.showNotification('تم تغيير صورة الجدار. لا تنس الحفظ!', 'info');
      this.enableSaveButton();
    };
    reader.readAsDataURL(file);
  },

  selectScreenToEdit(screenId) {
    this.selectedScreenId = screenId;
    if (screenId) this.populateScreenEditor(this.currentWall.screens.find(s => s.id === screenId));
  },

  async saveCurrentWall() {
    const idx = this.walls.findIndex(w => w.id === this.currentWall.id);
    if (idx !== -1) this.walls[idx] = this.currentWall;
    else this.walls.push(this.currentWall);
    await db.save('walls', this.walls);
    notifications.showNotification('تم تحديث جدار الشاشات بنجاح!', 'success');
    const btn = document.getElementById('save-wall-btn');
    if (btn) btn.disabled = true;
  },

  enableSaveButton() {
    const saveBtn = document.getElementById('save-wall-btn');
    if (saveBtn) saveBtn.disabled = false;
  },

  async resetWall() {
    if (!confirm('هل أنت متأكد من إعادة تعيين هذا الجدار؟ سيتم حذف جميع الشاشات والصورة الحالية.')) return;
    this.currentWall.image = 'https://placehold.co/1200x800/4a4a4a/ffffff?text=No+Wall+Image';
    this.currentWall.screens = [];
    this.selectedScreenId = null;
    await this.saveCurrentWall();
    this.renderWall(this.currentWall);
    this.adminEditMode();
    notifications.showNotification('تم إعادة تعيين الجدار بنجاح.', 'info');
  },

  async generateQrForScreen(screenId) {
    const screen = this.currentWall.screens.find(s => s.id === screenId);
    if (!screen) return;
    screen.qrCode = await generateQR(JSON.stringify({ type: 'screen', id: screen.id, name: screen.nom }));
    this.populateScreenEditor(screen);
    notifications.showNotification('تم إنشاء رمز QR للشاشة.', 'success');
    this.enableSaveButton();
  },

  openScreenTickets(screenId) {
    openTicketModal({ user: getCurrentUser(), targetType: 'screen', targetId: screenId, notifications });
    notifications.showNotification(`فتح التذاكر للشاشة ${screenId}.`, 'info');
  },

  openDiagnostic(screenId) {
    const screen = this.currentWall.screens.find(s => s.id === screenId);
    if (screen) this.openDiagnosticModal(screen);
  },

  async openDiagnosticModal(screen) {
    const user = getCurrentUser();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content" style="max-width:550px;"><span class="close-modal">&times;</span><h4>تفاصيل الشاشة: ${screen.nom}</h4><p><b>الحالة:</b> ${this.getScreenStatusText(screen.status)}</p><p><b>الجهاز المرتبط:</b> ${screen.deviceLinked || 'لا يوجد'}</p>${user.role === 'admin' || user.role === 'technician' ? `<button class="btn info" id="btn-open-screen-tickets-modal">فتح التذاكر</button><button class="btn warning" id="btn-run-diagnostic">تشغيل التشخيص</button>` : ''}</div>`;
    document.body.appendChild(modal);
    modal.querySelector('.close-modal').onclick = () => modal.remove();
    const ticketsBtn = modal.querySelector('#btn-open-screen-tickets-modal');
    if (ticketsBtn) ticketsBtn.onclick = () => { this.openScreenTickets(screen.id); modal.remove(); };
    const diagnosticBtn = modal.querySelector('#btn-run-diagnostic');
    if (diagnosticBtn) diagnosticBtn.onclick = () => {
      if (this.screensDiagnosticInstance) {
        notifications.showNotification(`بدء تشخيص الشاشة: ${screen.nom}`, 'info');
      }
      modal.remove();
    };
  }
};

if (typeof window !== 'undefined') window.WallsManager = WallsManager;
export default WallsManager;
