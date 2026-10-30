import { db } from './db.js';
import { openTicketModal } from './tickets.js';

// ======= أدوات البحث =======
function searchAll({ query, rooms, baies, equipments }) {
  const q = (query || '').toLowerCase();
  if (!q) return [];
  let results = [];
  results.push(...equipments.filter(eq =>
    (eq.name || '').toLowerCase().includes(q) ||
    (eq.nom || '').toLowerCase().includes(q) ||
    (eq.numSerie || '').toLowerCase().includes(q) ||
    (eq.type || '').toLowerCase().includes(q) ||
    (eq.marque || '').toLowerCase().includes(q) ||
    (eq.modele || '').toLowerCase().includes(q)
  ).map(eq => ({ type: 'equipment', id: eq.id, name: eq.name || eq.nom, ...eq })));
  results.push(...rooms.filter(r =>
    (r.name || '').toLowerCase().includes(q) ||
    (r.location || '').toLowerCase().includes(q)
  ).map(r => ({ type: 'room', id: r.id, name: r.name, ...r })));
  results.push(...baies.filter(b =>
    (b.name || '').toLowerCase().includes(q)
  ).map(b => ({ type: 'baie', id: b.id, name: b.name, ...b })));
  return results;
}

// ================ الوظيفة الرئيسية =====================
export default function openInteractiveMap({
  rooms = [], baies = [], equipments = [],
  user = {}, notifications = null
}) {
  let mapImage = "assets/plan-technique.png";
  let zoom = 1, panX = 0, panY = 0;
  let currentView = { type: "map" };
  let drawing = false;
  let history = [];
  let dragMode = false;
  let locked = false;

  db.get('settings', 'global').then(settings => {
    if (settings?.mapImageUrl) mapImage = settings.mapImageUrl;
    showWelcome(() => renderMapUI());
  }).catch(() => showWelcome(() => renderMapUI()));

  function showWelcome(callback) {
    const welcome = document.createElement('div');
    welcome.id = "welcome-screen";
    welcome.style.cssText = `
      position: fixed; inset: 0; z-index: 30000; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(120deg, #2874a6 65%, #4acfff 100%); animation: fadein 1s;`;
    welcome.innerHTML = `
      <div style="background: rgba(255,255,255,0.97); border-radius: 22px; padding: 40px 45px; text-align: center; box-shadow: 0 6px 40px #0135;">
        <img src="images/2m-logo.webp" style="height: 60px;"><br>
        <h1 style="font-size: 2.05em; color: #2874a6; margin: 18px 0 9px 0; font-weight: 800;">
          مرحبًا بكم في الخريطة التفاعلية <span style="color: #1a4b6e;">2M</span>
        </h1>
        <div style="font-size: 1.13em; margin-bottom: 16px; color: #364656;">
          اكتشف وحدد جميع المعدات والغرف والخزائن في الوقت الفعلي!
        </div>
        <ul style="text-align: left; max-width: 340px; margin: 14px auto 22px auto; line-height: 1.75; font-size: 1.04em; color:#222">
          <li><i class="fas fa-search"></i> <b>بحث متقدم:</b> اكتب أي معلومات للعثور بسرعة.</li>
          <li><i class="fas fa-mouse-pointer"></i> <b>تنقل:</b> انقر على غرفة أو خزانة أو معدات لرؤية التفاصيل.</li>
          <li><i class="fas fa-plus"></i> <b>تذاكر:</b> افتح تذكرة من أي عنصر.</li>
          <li><i class="fas fa-ruler-combined"></i> <b>إدارة:</b> يمكن للمسؤولين تعديل المواقع والأحجام بسهولة.</li>
        </ul>
        <div style="color: #888; font-size: 1.05em; margin-bottom: 12px;">هل أنت مستعد للبدء؟</div>
        <button id="welcome-start-btn" class="btn" style="font-size: 1.12em; padding: 11px 38px;">ابدأ الآن</button>
        <div style="color: #1a4b6e; margin-top: 19px; font-size: 1.08em;">— المنصة التقنية 2M —</div>
      </div>
    `;
    document.body.appendChild(welcome);
    document.getElementById('welcome-start-btn').onclick = () => {
      welcome.style.opacity = 0;
      setTimeout(() => welcome.remove(), 600);
      if (callback) callback();
    };
  }

  function renderMapUI() {
    document.getElementById('map-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = "map-modal";
    modal.className = "modal-map";
    modal.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 9999; overflow: hidden; background: #19242d;
    `;
    // إضافة أزرار الأدمن (داخل التولبار، مرئية فقط للأدمن)
    modal.innerHTML = `
      <div id="map-container" style="position: fixed; inset: 0; width: 100vw; height: 100vh;">
        <img src="${mapImage}" id="main-map-img"
          style="width: 100vw; height: 100vh; object-fit: cover; user-select: none; position: absolute; top: 0; left: 0;">
        <canvas id="areas-canvas" width="2000" height="1200"
          style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none;"></canvas>
        <div id="map-hotspots"
          style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 30;"></div>
        <div id="map-toolbar" class="map-toolbar"
          style="position: absolute; top: 25px; right: 34px; z-index: 40; display: flex; gap: 7px; align-items: center; background: rgba(34, 44, 66, 0.86); border-radius: 12px; padding: 6px 12px;">
          <input type="search" id="map-search" placeholder="بحث (معدات، غرفة، خزانة، رقم تسلسلي...)" style="padding: 6px 13px; border-radius: 7px; border: 1px solid #d6dae1; font-size: 15px; min-width: 150px;">
          <button id="zoom-in" title="تكبير" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-search-plus"></i></button>
          <button id="zoom-out" title="تصغير" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-search-minus"></i></button>
          <button id="reset-zoom" title="إعادة تعيين" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-compress"></i></button>
          <button id="fullscreen-btn" title="ملء الشاشة" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-expand"></i></button>
          ${user.role === 'admin' ? `
            <button id="edit-mode-btn" title="وضع التعديل" class="btn ${dragMode ? 'success' : 'gray'}" style="padding: 5px 10px;"><i class="fas fa-edit"></i></button>
            <button id="add-room-btn" title="إضافة غرفة" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-door-open"></i></button>
            <button id="add-baie-btn" title="إضافة خزانة" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-cube"></i></button>
            <button id="lock-btn" title="قفل/فتح الخريطة" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-${locked ? 'lock' : 'unlock'}"></i></button>
            <button id="save-all-btn" title="حفظ الكل" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-save"></i></button>
            <button id="export-btn" title="تصدير البيانات" class="btn gray" style="padding: 5px 10px;"><i class="fas fa-file-export"></i></button>
          ` : ''}
          <button id="close-map" class="btn danger" style="margin-left: 6px; padding: 5px 10px;"><i class="fas fa-times"></i></button>
        </div>
        <div id="map-search-results" style="position: absolute; top: 65px; right: 37px; z-index: 50; max-height: 320px; overflow-y: auto; width: 320px; background: #fff; border-radius: 13px; box-shadow: 0 2px 22px #1117; display: none;"></div>
        <div id="map-panel" style="display: none; position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 90; background: rgba(15,25,40,0.94);"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const img = document.getElementById('main-map-img');
    const canvas = document.getElementById('areas-canvas');
    const ctx = canvas.getContext('2d');
    const hotspots = document.getElementById('map-hotspots');
    const panel = document.getElementById('map-panel');
    let lastResults = [];
    let isDragging = false, dragTarget = null, offsetX = 0, offsetY = 0;

    // الأزرار الرئيسية
    document.getElementById('zoom-in').onclick = () => { zoom = Math.min(2.4, zoom + 0.13); applyTransform(); };
    document.getElementById('zoom-out').onclick = () => { zoom = Math.max(0.55, zoom - 0.13); applyTransform(); };
    document.getElementById('reset-zoom').onclick = () => { zoom = 1; panX = 0; panY = 0; applyTransform(); };
    document.getElementById('fullscreen-btn').onclick = () => {
      if (modal.requestFullscreen) modal.requestFullscreen();
      else if (modal.webkitRequestFullscreen) modal.webkitRequestFullscreen();
    };
    document.getElementById('close-map').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      modal.remove();
    };

    // أزرار الأدمن بعد رسم التولبار
    if (user.role === 'admin') {
      document.getElementById('edit-mode-btn').onclick = () => {
        dragMode = !dragMode;
        document.getElementById('edit-mode-btn').classList.toggle('success', dragMode);
        document.getElementById('edit-mode-btn').classList.toggle('gray', !dragMode);
        drawAreasAndHotspots(currentView);
      };

      document.getElementById('add-room-btn').onclick = () => addNewItem('room');
      document.getElementById('add-baie-btn').onclick = () => addNewItem('baie');
      document.getElementById('lock-btn').onclick = () => {
        locked = !locked;
        document.getElementById('lock-btn').innerHTML = `<i class="fas fa-${locked ? 'lock' : 'unlock'}"></i>`;
        notifications?.showNotification(`الخريطة ${locked ? 'مقفولة' : 'مفتوحة'}`, locked ? 'warning' : 'success');
      };

      document.getElementById('save-all-btn').onclick = async () => {
        try {
          for (let room of rooms) await db.save('rooms', room);
          for (let baie of baies) await db.save('baies', baie);
          for (let eq of equipments) await db.save('equipments', eq);
          notifications?.showNotification("تم حفظ جميع التغييرات بنجاح!", "success");
        } catch (e) {
          notifications?.showNotification("حدث خطأ أثناء الحفظ!", "error");
        }
      };

      document.getElementById('export-btn').onclick = () => {
        const data = { rooms, baies, equipments };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `map-export-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        notifications?.showNotification("تم تصدير البيانات بنجاح", "success");
      };
    }

    function applyTransform() {
      img.style.transform = canvas.style.transform = hotspots.style.transform =
        `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    }

    document.getElementById('map-search').oninput = e => {
      const q = e.target.value;
      const res = searchAll({ query: q, rooms, baies, equipments });
      lastResults = res;
      showSearchResults(res);
    };

    function showSearchResults(results) {
      const cont = document.getElementById('map-search-results');
      if (!results.length) { cont.innerHTML = ''; cont.style.display = "none"; return; }
      cont.style.display = "block";
      cont.innerHTML = `
        <ul style="list-style:none;margin:0;padding:7px;">
          ${results.map(r => `
            <li data-type="${r.type}" data-id="${r.id}" style="cursor: pointer; padding: 8px 0 6px 8px; border-bottom: 1px solid #eee;">
              <span class="badge badge-${r.type}" style="margin-right: 9px; background: ${r.type == 'room' ? '#2874a6' : r.type == 'baie' ? '#8e44ad' : '#27ae60'}; color: #fff; padding: 2px 10px; border-radius: 7px;">
                ${r.type === 'room' ? 'غرفة' : r.type === 'baie' ? 'خزانة' : 'معدات'}
              </span>
              <span>${r.name || r.nom || r.numSerie}</span>
            </li>
          `).join('')}
        </ul>
      `;
      cont.querySelectorAll('li').forEach(li => {
        li.onclick = () => {
          cont.style.display = "none";
          openPanel(li.dataset.type, li.dataset.id);
        };
      });
    }

    // =========== رسم الخريطة + النقاط ===========
    function drawAreasAndHotspots(view = currentView) {
      ctx.clearRect(0, 0, 2000, 1200);
      hotspots.innerHTML = '';

      // العرض الرئيسي للخريطة
      if (view.type === "map") {
        if (user.role === 'admin') {
          rooms.forEach(room => { if (room.rect) drawRect(room.rect, "#5bb2ff33"); });
          baies.forEach(baie => { if (baie.rect) drawRect(baie.rect, "#b86fff33"); });
        }
        rooms.forEach(room => {
          const x = room.rect ? (room.rect.x + room.rect.w / 2) : (room.x || 90);
          const y = room.rect ? (room.rect.y + room.rect.h / 2) : (room.y || 120);
          hotspots.appendChild(makeHotspot({
            x, y, color: "#2d7dfc", size: 40, type: "room", id: room.id, title: room.name,
            onClick: () => openPanel('room', room.id),
            onRightClick: user.role === "admin" ? (e) => { e.preventDefault(); showContextMenu(e, 'room', room.id); } : null
          }));
        });
        baies.forEach(baie => {
          if (!baie.roomId) return;
          const x = baie.rect ? (baie.rect.x + baie.rect.w / 2) : (baie.x_inMap || 180);
          const y = baie.rect ? (baie.rect.y + baie.rect.h / 2) : (baie.y_inMap || 180);
          hotspots.appendChild(makeHotspot({
            x, y, color: "#914bce", size: 28, type: "baie", id: baie.id, title: baie.name,
            onClick: () => openPanel('baie', baie.id),
            onRightClick: user.role === "admin" ? (e) => { e.preventDefault(); showContextMenu(e, 'baie', baie.id); } : null
          }));
        });
      }
      // عرض غرفة
      if (view.type === "room") {
        let room = rooms.find(r => r.id == view.id);
        if (user.role === 'admin' && room.rect) drawRect(room.rect, "#5bb2ff33");
        baies.filter(b => b.roomId == room.id).forEach(baie => {
          let x = baie.rect ? (baie.rect.x + baie.rect.w / 2) : (baie.x_inRoom || 200);
          let y = baie.rect ? (baie.rect.y + baie.rect.h / 2) : (baie.y_inRoom || 120);
          hotspots.appendChild(makeHotspot({
            x, y, color: "#914bce", size: 28, type: "baie", id: baie.id, title: baie.name,
            onClick: () => openPanel('baie', baie.id),
            onRightClick: user.role === "admin" ? (e) => { e.preventDefault(); showContextMenu(e, 'baie', baie.id, room); } : null
          }));
        });
        equipments.filter(eq => eq.roomId == room.id && !eq.baieId).forEach(eq => {
          let x = eq.x_inRoom || (room.rect ? (room.rect.x + 30) : 130);
          let y = eq.y_inRoom || (room.rect ? (room.rect.y + 30) : 120);
          hotspots.appendChild(makeHotspot({
            x, y, color: eq.status === "faulty" ? "#e74c3c" : "#16a085", size: 22, type: "equipment", id: eq.id, title: eq.nom || eq.name,
            onClick: () => openPanel('equipment', eq.id),
            draggable: user.role === "admin" && dragMode && !locked,
            onDrag: (dx, dy) => {
              eq.x_inRoom = (eq.x_inRoom || x) + dx / zoom;
              eq.y_inRoom = (eq.y_inRoom || y) + dy / zoom;
              drawAreasAndHotspots(currentView);
            },
            onRightClick: user.role === "admin" ? (e) => { e.preventDefault(); showContextMenu(e, 'equipment', eq.id, room); } : null
          }));
        });
      }
      // عرض باي
      if (view.type === "baie") {
        let baie = baies.find(b => b.id == view.id);
        if (user.role === 'admin' && baie.rect) drawRect(baie.rect, "#b86fff33");
        equipments.filter(eq => eq.baieId == baie.id).forEach(eq => {
          let x = eq.x_inBaie || (baie.rect ? (baie.rect.x + 20) : 140);
          let y = eq.y_inBaie || (baie.rect ? (baie.rect.y + 20) : 110);
          hotspots.appendChild(makeHotspot({
            x, y, color: eq.status === "faulty" ? "#e74c3c" : "#16a085", size: 20, type: "equipment", id: eq.id, title: eq.nom || eq.name,
            onClick: () => openPanel('equipment', eq.id),
            draggable: user.role === "admin" && dragMode && !locked,
            onDrag: (dx, dy) => {
              eq.x_inBaie = (eq.x_inBaie || x) + dx / zoom;
              eq.y_inBaie = (eq.y_inBaie || y) + dy / zoom;
              drawAreasAndHotspots(currentView);
            },
            onRightClick: user.role === "admin" ? (e) => { e.preventDefault(); showContextMenu(e, 'equipment', eq.id, baie); } : null
          }));
        });
      }
    }

    function drawRect(rect, color = "#2277ee33") {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color.replace('33', '77');
      ctx.stroke();
    }

    // hotspot تفاعلي (يدعم drag في وضع التعديل فقط للأدمن)
    function makeHotspot({ x, y, color, size, type, id, title, onClick, onRightClick, draggable, onDrag }) {
      const spot = document.createElement('div');
      spot.className = 'map-hotspot ' + type;
      spot.setAttribute('data-type', type);
      spot.setAttribute('data-id', id);
      spot.title = title || "";
      spot.style.cssText = `
        position: absolute; left: ${x - size / 2}px; top: ${y - size / 2}px; width: ${size}px; height: ${size}px;
        background: ${color}; border: 2px solid #fff; box-shadow: 0 2px 10px #2b7bc49b; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center; z-index: 12;
        transition: box-shadow 0.17s, transform 0.13s;
      `;
      spot.innerHTML = `<i class="fas fa-${type === 'room' ? 'door-open' : type === 'baie' ? 'cube' : 'server'}" style="color: #fff;"></i>`;
      spot.onclick = (e) => { e.stopPropagation(); if (onClick && !dragMode) onClick(); };
      if (onRightClick) spot.oncontextmenu = onRightClick;
      // سحب hotspot لأي جهاز (للأدمن فقط وفي وضع التعديل)
      if (draggable) {
        spot.onmousedown = (e) => {
          if (locked) return;
          isDragging = true;
          dragTarget = spot;
          offsetX = e.clientX;
          offsetY = e.clientY;
          document.onmousemove = (moveEv) => {
            if (!isDragging) return;
            let dx = moveEv.clientX - offsetX, dy = moveEv.clientY - offsetY;
            offsetX = moveEv.clientX; offsetY = moveEv.clientY;
            if (onDrag) onDrag(dx, dy);
          };
          document.onmouseup = () => {
            isDragging = false; dragTarget = null;
            document.onmousemove = null; document.onmouseup = null;
          };
        };
      }
      return spot;
    }

    // ============= القائمة السياقية للأدمن ============
    function showContextMenu(e, type, id, parent = null) {
      if (locked) return;
      
      const contextMenu = document.getElementById('admin-context-menu');
      contextMenu.style.display = 'block';
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.setAttribute('data-type', type);
      contextMenu.setAttribute('data-id', id);
      contextMenu.setAttribute('data-parent', parent ? parent.id : '');
      contextMenuVisible = true;

      // إخفاء القائمة عند النقر في أي مكان آخر
      setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
      }, 10);
    }

    function hideContextMenu() {
      if (!contextMenuVisible) return;
      const contextMenu = document.getElementById('admin-context-menu');
      contextMenu.style.display = 'none';
      contextMenuVisible = false;
      document.removeEventListener('click', hideContextMenu);
    }

    // معالجة أحداث القائمة السياقية
    if (user.role === 'admin') {
      document.querySelectorAll('.context-menu-item').forEach(item => {
        item.onclick = function() {
          const action = this.getAttribute('data-action');
          const contextMenu = document.getElementById('admin-context-menu');
          const type = contextMenu.getAttribute('data-type');
          const id = contextMenu.getAttribute('data-id');
          const parentId = contextMenu.getAttribute('data-parent');
          
          let obj = type === 'room' ? rooms.find(r => r.id === id) : 
                   type === 'baie' ? baies.find(b => b.id === id) : 
                   equipments.find(e => e.id === id);
          
          let parent = parentId ? (parentId.startsWith('room') ? rooms.find(r => r.id === parentId) : baies.find(b => b.id === parentId)) : null;

          hideContextMenu();

          switch(action) {
            case 'edit':
              if (type === 'room' || type === 'baie') {
                editArea(type, id);
              } else {
                openEditEquipmentModal(obj);
              }
              break;
            case 'move':
              dragMode = true;
              document.getElementById('edit-mode-btn').classList.add('success');
              document.getElementById('edit-mode-btn').classList.remove('gray');
              drawAreasAndHotspots(currentView);
              break;
            case 'resize':
              if (type === 'room' || type === 'baie') {
                resizeArea(type, id);
              }
              break;
            case 'change-image':
              changeImage(type, id);
              break;
            case 'delete':
              deleteItem(type, id, parent);
              break;
          }
        };
      });
    }

    // ============= إضافة عنصر جديد ============
    function addNewItem(type) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن إضافة عناصر!", "error");
        return;
      }

      let name = prompt(`أدخل اسم ${type === 'room' ? 'الغرفة' : 'الخزانة'} الجديدة:`);
      if (!name) return;

      const newId = type === 'room' ? `room-${Date.now()}` : `baie-${Date.now()}`;
      const newItem = {
        id: newId,
        name: name,
        rect: null
      };

      if (type === 'room') {
        rooms.push(newItem);
      } else {
        if (currentView.type === 'room') {
          newItem.roomId = currentView.id;
        } else {
          let roomId = prompt("أدخل معرف الغرفة التي تنتمي إليها هذه الخزانة:");
          if (!roomId) return;
          newItem.roomId = roomId;
        }
        baies.push(newItem);
      }

      notifications?.showNotification(`تمت إضافة ${type === 'room' ? 'غرفة' : 'خزانة'} جديدة`, "success");
      drawAreasAndHotspots(currentView);
      editArea(type, newId);
    }

    // ============= تغيير صورة العنصر ============
    function changeImage(type, id) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن تعديل الصور!", "error");
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          // هنا يمكنك رفع الصورة إلى الخادم وحفظ الرابط
          // لأغراض العرض، سنستخدم URL.createObjectURL لعرض الصورة محليًا
          const imageUrl = URL.createObjectURL(file);
          
          if (type === 'room') {
            const room = rooms.find(r => r.id === id);
            room.image = imageUrl;
            await db.save('rooms', room);
          } else if (type === 'baie') {
            const baie = baies.find(b => b.id === id);
            baie.image = imageUrl;
            await db.save('baies', baie);
          }

          notifications?.showNotification("تم تحديث الصورة بنجاح!", "success");
          drawAreasAndHotspots(currentView);
          if (panel.style.display === 'flex') {
            openPanel(type, id);
          }
        } catch (error) {
          notifications?.showNotification("حدث خطأ أثناء تحديث الصورة!", "error");
        }
      };
      input.click();
    }

    // ============= حذف عنصر ============
    async function deleteItem(type, id, parent = null) {
  if (locked) {
    notifications?.showNotification("الخريطة مقفولة، لا يمكن حذف العناصر!", "error");
    return;
  }

  if (!confirm(`هل أنت متأكد من حذف ${type === 'room' ? 'الغرفة' : type === 'baie' ? 'الخزانة' : 'المعدات'}؟`)) {
    return;
  }

  try {
    if (type === 'room') {
      // حذف جميع الخزانات والمعدات المرتبطة بالغرفة
      const roomBaies = baies.filter(b => b.roomId === id);
      const roomEquipments = equipments.filter(e => e.roomId === id);
      
      for (let baie of roomBaies) {
        await db.delete('baies', baie.id);
      }
      for (let eq of roomEquipments) {
        await db.delete('equipments', eq.id);
      }
      
      // حذف الغرفة
      rooms = rooms.filter(r => r.id !== id);
      await db.delete('rooms', id);
    } 
    else if (type === 'baie') {
      // حذف جميع المعدات المرتبطة بالخزانة
      const baieEquipments = equipments.filter(e => e.baieId === id);
      for (let eq of baieEquipments) {
        await db.delete('equipments', eq.id);
      }
      
      // حذف الخزانة
      baies = baies.filter(b => b.id !== id);
      await db.delete('baies', id);
    } 
    else {
      // حذف المعدات
      equipments = equipments.filter(e => e.id !== id);
      await db.delete('equipments', id);
    }

    notifications?.showNotification(`تم الحذف بنجاح!`, "success");
    drawAreasAndHotspots(currentView);
    if (panel.style.display === 'flex') {
      panel.style.display = 'none';
      currentView = { type: "map" };
      drawAreasAndHotspots();
    }
  } catch (error) {
    notifications?.showNotification("حدث خطأ أثناء الحذف!", "error");
  }
}

    // ============= تعديل مستطيل لأي غرفة/باي للأدمن ============
    function editArea(type, id) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن التعديل!", "error");
        return;
      }

      let obj = type === 'room' ? rooms.find(r => r.id === id) : baies.find(b => b.id === id);
      let color = type === 'room' ? "#4acfff" : "#b86fff";
      let startX = 0, startY = 0, rect = obj.rect ? { ...obj.rect } : null;
      drawing = false;
      canvas.style.pointerEvents = 'auto';
      document.body.style.cursor = 'crosshair';
      
      canvas.onmousedown = e => {
        drawing = true;
        const rectB = canvas.getBoundingClientRect();
        startX = (e.clientX - rectB.left) / zoom;
        startY = (e.clientY - rectB.top) / zoom;
      };
      
      canvas.onmouseup = e => {
        if (!drawing) return;
        const rectB = canvas.getBoundingClientRect();
        let endX = (e.clientX - rectB.left) / zoom;
        let endY = (e.clientY - rectB.top) / zoom;
        rect = {
          x: Math.min(startX, endX),
          y: Math.min(startY, endY),
          w: Math.abs(endX - startX),
          h: Math.abs(endY - startY)
        };
        drawing = false;
        obj.rect = rect;
        db.save(type === 'room' ? 'rooms' : 'baies', obj).then(() => {
          notifications?.showNotification("تم حفظ المنطقة بنجاح!", "success");
          stopEdit();
        });
      };
      
      canvas.onmousemove = e => {
        if (!drawing) return;
        const rectB = canvas.getBoundingClientRect();
        let currX = (e.clientX - rectB.left) / zoom, currY = (e.clientY - rectB.top) / zoom;
        drawAreasAndHotspots(currentView);
        drawRect({ x: Math.min(startX, currX), y: Math.min(startY, currY), w: Math.abs(currX - startX), h: Math.abs(currY - startY) }, color + "77");
      };
      
      document.onkeydown = e => { if (e.key === "Escape") stopEdit(); };
      
      function stopEdit() {
        drawing = false;
        canvas.style.pointerEvents = 'none';
        canvas.onmousedown = canvas.onmouseup = canvas.onmousemove = null;
        document.body.style.cursor = '';
        document.onkeydown = null;
        drawAreasAndHotspots(currentView);
      }
    }

    // ============= تغيير حجم المنطقة ============
    function resizeArea(type, id) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن التعديل!", "error");
        return;
      }

      let obj = type === 'room' ? rooms.find(r => r.id === id) : baies.find(b => b.id === id);
      if (!obj.rect) {
        notifications?.showNotification("يجب تحديد المنطقة أولاً!", "warning");
        return editArea(type, id);
      }

      let rect = { ...obj.rect };
      let resizeHandle = null;
      let startX = 0, startY = 0;
      let startWidth = 0, startHeight = 0;
      
      // رسم مقابض التغيير
      drawResizeHandles(rect);
      
      function drawResizeHandles(rect) {
        // مسح المقابض القديمة
        document.querySelectorAll('.resize-handle').forEach(el => el.remove());
        
        // إنشاء مقابض جديدة
        const handleSize = 12;
        const positions = [
          { x: rect.x + rect.w - handleSize/2, y: rect.y + rect.h - handleSize/2, cursor: 'nwse-resize', type: 'se' }
        ];
        
        positions.forEach(pos => {
          const handle = document.createElement('div');
          handle.className = 'resize-handle';
          handle.style.cssText = `
            position: absolute; width: ${handleSize}px; height: ${handleSize}px;
            background: #fff; border: 2px solid #2874a6; border-radius: 2px;
            cursor: ${pos.cursor}; z-index: 100;
            left: ${pos.x}px; top: ${pos.y}px;
          `;
          handle.setAttribute('data-type', pos.type);
          hotspots.appendChild(handle);
          
          handle.onmousedown = e => {
            e.stopPropagation();
            resizeHandle = pos.type;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = rect.w;
            startHeight = rect.h;
            document.onmousemove = handleMouseMove;
            document.onmouseup = handleMouseUp;
          };
        });
      }
      
      function handleMouseMove(e) {
        if (!resizeHandle) return;
        
        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;
        
        if (resizeHandle === 'se') {
          rect.w = Math.max(30, startWidth + dx);
          rect.h = Math.max(30, startHeight + dy);
        }
        
        obj.rect = rect;
        drawAreasAndHotspots(currentView);
        drawResizeHandles(rect);
      }
      
      function handleMouseUp() {
        resizeHandle = null;
        document.onmousemove = null;
        document.onmouseup = null;
        db.save(type === 'room' ? 'rooms' : 'baies', obj).then(() => {
          notifications?.showNotification("تم تغيير الحجم بنجاح!", "success");
        });
      }
      
      // إلغاء التغيير بالضغط على ESC
      document.onkeydown = e => {
        if (e.key === "Escape") {
          document.querySelectorAll('.resize-handle').forEach(el => el.remove());
          document.onmousemove = null;
          document.onmouseup = null;
          document.onkeydown = null;
          drawAreasAndHotspots(currentView);
        }
      };
    }

    // ============= PANEL / DETAILS ============
    function openPanel(type, id) {
      history.push({ ...currentView });
      let html = '';
      let showEditBtn = user.role === 'admin' && (type === 'room' || type === 'baie');
      let showSaveBtns = false;
      let eqs = [];
      
      // Panel Room
      if (type === 'room') {
        let room = rooms.find(r => r.id == id);
        eqs = equipments.filter(eq => eq.roomId == room.id && !eq.baieId);
        html = `
          <div style="width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <img src="${room.image || room.imageUrl || 'assets/room-default.jpg'}" style="max-width:96vw;max-height:78vh;border-radius:14px;box-shadow:0 2px 32px #0005;">
            <div style="margin-top:14px;color:#fff;font-size:1.35em;">${room.name}</div>
            <div style="margin-top:18px;">
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> رجوع</button>
              ${showEditBtn ? `<button class="btn" id="edit-coords-btn" style="margin-left:12px;"><i class="fas fa-arrows-alt"></i> تعديل المواقع</button>` : ''}
              ${user.role === 'admin' ? `<button class="btn" id="add-equipment-btn" style="margin-left:12px;"><i class="fas fa-plus"></i> إضافة معدات</button>` : ''}
              ${showSaveBtns ? `
                <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> حفظ</button>
                <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> إلغاء</button>
              ` : ''}
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { type: "room", id: room.id };
        drawAreasAndHotspots(currentView);

        // Back
        document.getElementById('panel-back-btn').onclick = () => goBack();
        
        if (showEditBtn) {
          document.getElementById('edit-coords-btn').onclick = () => {
            dragMode = true;
            panel.innerHTML += `
              <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> حفظ</button>
              <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> إلغاء</button>
            `;
            drawAreasAndHotspots(currentView);
            // Save
            document.getElementById('save-coords-btn').onclick = async () => {
              for (let eq of eqs) await db.save('equipments', eq);
              dragMode = false;
              notifications?.showNotification("تم حفظ الإحداثيات بنجاح!", "success");
              drawAreasAndHotspots(currentView);
              openPanel('room', id);
            };
            // Cancel
            document.getElementById('cancel-coords-btn').onclick = () => {
              dragMode = false;
              drawAreasAndHotspots(currentView);
              openPanel('room', id);
            };
          };
        }
        
        if (user.role === 'admin') {
          document.getElementById('add-equipment-btn').onclick = () => {
            openAddEquipmentModal(room);
          };
        }
      }
      
      // Panel Baie
      if (type === 'baie') {
        let baie = baies.find(b => b.id == id);
        eqs = equipments.filter(eq => eq.baieId == baie.id);
        html = `
          <div style="width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <img src="${baie.image || baie.imageUrl || 'assets/baie-default.jpg'}" style="max-width:96vw;max-height:78vh;border-radius:14px;box-shadow:0 2px 32px #0005;">
            <div style="margin-top:13px;color:#fff;font-size:1.2em;">${baie.name}</div>
            <div style="margin-top:15px;">
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> رجوع</button>
              ${showEditBtn ? `<button class="btn" id="edit-coords-btn" style="margin-left:12px;"><i class="fas fa-arrows-alt"></i> تعديل المواقع</button>` : ''}
              ${user.role === 'admin' ? `<button class="btn" id="add-equipment-btn" style="margin-left:12px;"><i class="fas fa-plus"></i> إضافة معدات</button>` : ''}
              ${showSaveBtns ? `
                <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> حفظ</button>
                <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> إلغاء</button>
              ` : ''}
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { type: "baie", id: baie.id };
        drawAreasAndHotspots(currentView);

        document.getElementById('panel-back-btn').onclick = () => goBack();
        
        if (showEditBtn) {
          document.getElementById('edit-coords-btn').onclick = () => {
            dragMode = true;
            panel.innerHTML += `
              <button class="btn success" id="save-coords-btn" style="margin-left:12px;"><i class="fas fa-save"></i> حفظ</button>
              <button class="btn danger" id="cancel-coords-btn" style="margin-left:9px;"><i class="fas fa-times"></i> إلغاء</button>
            `;
            drawAreasAndHotspots(currentView);
            // Save
            document.getElementById('save-coords-btn').onclick = async () => {
              for (let eq of eqs) await db.save('equipments', eq);
              dragMode = false;
              notifications?.showNotification("تم حفظ الإحداثيات بنجاح!", "success");
              drawAreasAndHotspots(currentView);
              openPanel('baie', id);
            };
            // Cancel
            document.getElementById('cancel-coords-btn').onclick = () => {
              dragMode = false;
              drawAreasAndHotspots(currentView);
              openPanel('baie', id);
            };
          };
        }
        
        if (user.role === 'admin') {
          document.getElementById('add-equipment-btn').onclick = () => {
            openAddEquipmentModal(null, baie);
          };
        }
      }
      
      // Panel Equipment
      if (type === 'equipment') {
        let eq = equipments.find(e => e.id == id);
        html = `
          <div style="width: 95vw; height: 95vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="background:#fff; color:#1a253b; border-radius:19px; box-shadow:0 4px 44px #011a; padding:38px 45px; min-width:370px; max-width:520px;">
              <div style="font-size:1.28em;font-weight:700; color:#2874a6;">${eq.nom || eq.name}</div>
              <div style="margin:16px 0 10px 0;">
                النوع: ${eq.type || '-'}<br>
                الماركة: ${eq.marque || '-'}<br>
                الموديل: ${eq.modele || '-'}<br>
                الرقم التسلسلي: ${eq.numSerie || '-'}<br>
                الحالة: ${eq.status === 'faulty' ? '<span style="color:red;">معطلة</span>' : '<span style="color:green;">تعمل</span>'}
              </div>
              <div style="margin-bottom:13px;">
                <button class="btn mini" id="add-ticket-eq"><i class="fas fa-life-ring"></i> فتح تذكرة</button>
                ${user.role === 'admin' ? `<button class="btn mini" id="edit-equipment-btn" style="margin-left:8px;"><i class="fas fa-edit"></i> تعديل</button>` : ''}
              </div>
              <button class="btn gray" id="panel-back-btn"><i class="fas fa-arrow-left"></i> رجوع</button>
            </div>
          </div>
        `;
        panel.innerHTML = html;
        panel.style.display = "flex";
        currentView = { ...currentView };
        document.getElementById('panel-back-btn').onclick = () => goBack();
        document.getElementById('add-ticket-eq').onclick = () => openTicketModal({ type: 'equipment', id: eq.id });
        
        if (user.role === 'admin') {
          document.getElementById('edit-equipment-btn').onclick = () => {
            openEditEquipmentModal(eq);
          };
        }
      }
    }

    // ============= إضافة معدات جديدة ============
    function openAddEquipmentModal(room = null, baie = null) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن إضافة معدات!", "error");
        return;
      }

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999;
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
      `;
      modal.innerHTML = `
        <div style="background: #fff; border-radius: 12px; padding: 25px; width: 90%; max-width: 500px;">
          <h3 style="margin-top: 0; color: #2874a6;">إضافة معدات جديدة</h3>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">اسم المعدات</label>
            <input type="text" id="eq-name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">النوع</label>
            <input type="text" id="eq-type" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">الرقم التسلسلي</label>
            <input type="text" id="eq-serial" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
            <button class="btn gray" id="cancel-add-eq" style="margin-right: 10px;">إلغاء</button>
            <button class="btn" id="confirm-add-eq">إضافة</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('cancel-add-eq').onclick = () => {
        modal.remove();
      };

      document.getElementById('confirm-add-eq').onclick = async () => {
        const name = document.getElementById('eq-name').value;
        const type = document.getElementById('eq-type').value;
        const serial = document.getElementById('eq-serial').value;

        if (!name) {
          notifications?.showNotification("يجب إدخال اسم المعدات!", "error");
          return;
        }

        const newEq = {
          id: `eq-${Date.now()}`,
          nom: name,
          name: name,
          type: type,
          numSerie: serial,
          status: "working"
        };

        if (room) {
          newEq.roomId = room.id;
        } else if (baie) {
          newEq.baieId = baie.id;
          newEq.roomId = baie.roomId;
        }

        try {
          equipments.push(newEq);
          await db.save('equipments', newEq);
          notifications?.showNotification("تمت إضافة المعدات بنجاح!", "success");
          modal.remove();
          drawAreasAndHotspots(currentView);
        } catch (error) {
          notifications?.showNotification("حدث خطأ أثناء إضافة المعدات!", "error");
        }
      };
    }

    // ============= تعديل المعدات ============
    function openEditEquipmentModal(eq) {
      if (locked) {
        notifications?.showNotification("الخريطة مقفولة، لا يمكن التعديل!", "error");
        return;
      }

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999;
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
      `;
      modal.innerHTML = `
        <div style="background: #fff; border-radius: 12px; padding: 25px; width: 90%; max-width: 500px;">
          <h3 style="margin-top: 0; color: #2874a6;">تعديل المعدات</h3>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">اسم المعدات</label>
            <input type="text" id="eq-name" value="${eq.nom || eq.name || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">النوع</label>
            <input type="text" id="eq-type" value="${eq.type || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">الرقم التسلسلي</label>
            <input type="text" id="eq-serial" value="${eq.numSerie || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">الحالة</label>
            <select id="eq-status" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="working" ${eq.status === 'working' ? 'selected' : ''}>تعمل</option>
              <option value="faulty" ${eq.status === 'faulty' ? 'selected' : ''}>معطلة</option>
            </select>
          </div>
          <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
            <button class="btn gray" id="cancel-edit-eq" style="margin-right: 10px;">إلغاء</button>
            <button class="btn" id="confirm-edit-eq">حفظ</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('cancel-edit-eq').onclick = () => {
        modal.remove();
      };

      document.getElementById('confirm-edit-eq').onclick = async () => {
        const name = document.getElementById('eq-name').value;
        const type = document.getElementById('eq-type').value;
        const serial = document.getElementById('eq-serial').value;
        const status = document.getElementById('eq-status').value;

        if (!name) {
          notifications?.showNotification("يجب إدخال اسم المعدات!", "error");
          return;
        }

        const updatedEq = {
          ...eq,
          nom: name,
          name: name,
          type: type,
          numSerie: serial,
          status: status
        };

        try {
          const index = equipments.findIndex(e => e.id === eq.id);
          if (index !== -1) {
            equipments[index] = updatedEq;
          }
          await db.save('equipments', updatedEq);
          notifications?.showNotification("تم تحديث المعدات بنجاح!", "success");
          modal.remove();
          drawAreasAndHotspots(currentView);
          if (panel.style.display === 'flex') {
            openPanel('equipment', eq.id);
          }
        } catch (error) {
          notifications?.showNotification("حدث خطأ أثناء تحديث المعدات!", "error");
        }
      };
    }

    // --- تاريخ تنقل للرجوع الصحيح ---
    function goBack() {
      let prev = history.pop();
      if (!prev) {
        panel.style.display = "none";
        currentView = { type: "map" };
        drawAreasAndHotspots();
        return;
      }
      currentView = prev;
      panel.style.display = "none";
      drawAreasAndHotspots(currentView);
    }

    // بدأ العرض الأولي
    drawAreasAndHotspots();

    // العودة من أي panel
    panel.onclick = function (e) {
      if (e.target.id === 'map-panel' || e.target.id === 'panel-back-btn') {
        goBack();
      }
    };

    // إغلاق نتائج البحث عند النقر خارجها
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#map-search-results') && !e.target.closest('#map-search')) {
        document.getElementById('map-search-results').style.display = 'none';
      }
    });
  }
}
