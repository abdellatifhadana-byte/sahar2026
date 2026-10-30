// visitor-ui.js
import { db } from './db.js';
import openInteractiveMap from './interactive-map.js';

// دالة مساعدة لرسم Hotspot فوق صورة (للغرفة أو الباي)
function renderHotspotsOnImage({ containerId, imageUrl, items = [], onClick }) {
  // إفراغ العنصر أولاً
  const container = document.getElementById(containerId);
  if (!container) return;

  // بناء الصورة
  container.innerHTML = `
    <div style="position:relative;display:inline-block;">
      <img id="main-img" src="${imageUrl}" style="max-width:90vw;max-height:66vh;border-radius:10px;">
      <div id="img-hotspots" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>
    </div>
  `;
  const img = container.querySelector('#main-img');
  img.onload = () => {
    // رسم النقاط بعد تحميل الصورة
    const imgRect = img.getBoundingClientRect();
    const w = img.width;
    const h = img.height;
    const hotspotLayer = container.querySelector('#img-hotspots');
    hotspotLayer.innerHTML = '';
    items.forEach(item => {
      if (item.coords) {
        const spot = document.createElement('div');
        spot.className = 'img-hotspot';
        spot.style = `
          position:absolute;
          left:${item.coords.x * w / (item.imgNaturalWidth || w)}px;
          top:${item.coords.y * h / (item.imgNaturalHeight || h)}px;
          width:24px;height:24px;
          background:${item.statut === "hors-service" ? "#e74c3c" : "#2874a6"};
          border-radius:50%;box-shadow:0 2px 7px #3337;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;z-index:11;transition:box-shadow .17s;
        `;
        spot.title = item.nom || item.name;
        spot.innerHTML = `<i class="fas fa-server" style="color:#fff;font-size:13px;"></i>`;
        spot.onclick = (e) => {
          e.stopPropagation();
          onClick(item);
        };
        hotspotLayer.appendChild(spot);
      }
    });
  };
}

export default class VisitorUI {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.state = {
      view: "splash",
      selectedRoom: null,
      selectedBaie: null,
      selectedDevice: null,
    };
    this.showSplash();
  }

  showSplash() {
    document.getElementById('app').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
        <img src="assets/logo-2mtech.png" alt="2M TECH" style="width:120px; margin-bottom: 24px;">
        <h1 style="color:#2874a6;font-size:32px;margin-bottom:12px;letter-spacing:2px;">Bienvenue sur la plateforme 2M TECH !</h1>
        <p style="font-size:18px;color:#555;margin-bottom:22px;">Cliquez pour découvrir le centre technique interactif.</p>
        <button id="enter-map-btn" class="btn" style="padding:12px 38px;font-size:19px;background:#2874a6;color:#fff;border-radius:14px;">
          <i class="fas fa-map-marked-alt"></i> Voir la carte interactive
        </button>
        <button id="visitor-logout-btn" class="btn" style="margin-top:30px;background:#e74c3c;color:#fff;border-radius:14px;">
          <i class="fas fa-sign-out-alt"></i> Déconnexion
        </button>
      </div>
    `;
    document.getElementById('enter-map-btn').onclick = () => this.showRoomsMap();
    document.getElementById('visitor-logout-btn').onclick = () => this.logout();
    setTimeout(() => {
      document.getElementById('enter-map-btn').focus();
    }, 700);
  }

  async showRoomsMap() {
    // جلب كل البيانات اللازمة للخريطة
    const [rooms, baies, equipments] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('baies'),
      db.getAll('equipments')
    ]);
    // أظهر الخريطة التفاعلية، ومرر دوال onClick المناسبة
    openInteractiveMap({
      rooms, baies, equipments,
      user: this.user,
      notifications: this.notifications,
      onRoomClick: (room) => {
        // عند الضغط على غرفة: اغلق المودال وانتقل لتفاصيل الغرفة
        document.getElementById('map-modal')?.remove();
        this.showRoomDetails(room);
      },
      onBaieClick: (baie) => {
        document.getElementById('map-modal')?.remove();
        this.showBaieDetails(baie);
      },
      onEquipmentClick: (device) => {
        document.getElementById('map-modal')?.remove();
        this.showDeviceDetails(device);
      }
    });
  }

  // تفاصيل الغرفة مع الأجهزة كنقاط فوق الصورة
  async showRoomDetails(room) {
    const [baies, equipments, users] = await Promise.all([
      db.getAll('baies', 'roomId', room.id),
      db.getAll('equipments', 'roomId', room.id),
      db.getAll('users')
    ]);
    document.getElementById('app').innerHTML = `
      <div class="visitor-room-view" style="padding:32px;">
        <button class="btn" style="margin-bottom:22px;" id="back-map"><i class="fas fa-arrow-left"></i> Retour</button>
        <h2 style="color:#2874a6;margin-bottom:18px;">Salle: ${room.name}</h2>
        <div id="room-img-container" style="position:relative;max-width:95vw;">
          <!-- ستُضاف الصورة والنقاط عبر renderHotspotsOnImage -->
        </div>
        <div style="margin-bottom:14px;">
          <strong>Emplacement:</strong> ${room.location || '--'}<br>
          <strong>Responsable:</strong> ${(users.find(u => u.id == room.responsibleId)?.fullName || '--')}
        </div>
        <div>
          <h4>Baies dans cette salle</h4>
          <ul>
            ${baies.length ? baies.map(b => `<li><a href="#" data-baie="${b.id}" class="baie-link">${b.name}</a></li>`).join('') : '<li>---</li>'}
          </ul>
        </div>
      </div>
    `;
    // رسم الأجهزة كنقاط فوق الصورة
    renderHotspotsOnImage({
      containerId: "room-img-container",
      imageUrl: room.image || 'assets/plan-technique.png',
      items: equipments.filter(e => e.coords),
      onClick: device => this.showDeviceDetails(device)
    });
    document.getElementById('back-map').onclick = () => this.showSplash();
    document.querySelectorAll('.baie-link').forEach(a => {
      a.onclick = (e) => {
        e.preventDefault();
        const id = Number(a.getAttribute('data-baie'));
        this.showBaieDetails(baies.find(b => b.id === id));
      };
    });
  }

  // تفاصيل الباي مع الأجهزة كنقاط فوق صورة الباي
  async showBaieDetails(baie) {
    const [equipments] = await Promise.all([
      db.getAll('equipments', 'baieId', baie.id)
    ]);
    document.getElementById('app').innerHTML = `
      <div class="visitor-baie-view" style="padding:32px;">
        <button class="btn" style="margin-bottom:22px;" id="back-room"><i class="fas fa-arrow-left"></i> Retour à la salle</button>
        <h2 style="color:#9b59b6;margin-bottom:18px;">Baie: ${baie.name}</h2>
        <div id="baie-img-container" style="position:relative;max-width:92vw;">
          <!-- ستُضاف الصورة والنقاط -->
        </div>
        <div style="margin-bottom:12px;">
          <strong>Dans la salle:</strong> ${baie.roomId || '--'}
        </div>
      </div>
    `;
    // رسم الأجهزة كنقاط فوق صورة الباي
    renderHotspotsOnImage({
      containerId: "baie-img-container",
      imageUrl: baie.image || 'assets/plan-technique.png',
      items: equipments.filter(e => e.coords),
      onClick: device => this.showDeviceDetails(device)
    });
    document.getElementById('back-room').onclick = () => {
      db.get('rooms', baie.roomId).then(room => this.showRoomDetails(room));
    };
  }

  // نافذة تفاصيل جهاز (احترافية)
  async showDeviceDetails(device) {
    document.getElementById('details-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:22000;
      display:flex;align-items:center;justify-content:center;background:rgba(35,35,55,0.24);
    `;
    let detailsHTML = `
      <div style="background:#fff;padding:32px 44px 24px 42px;border-radius:18px;min-width:360px;max-width:610px;box-shadow:0 2px 32px #2229;position:relative;">
        <button id="close-details-modal" class="btn danger" style="position:absolute;right:8px;top:8px;"><i class="fas fa-times"></i></button>
        <h3 style="color:#2874a6;font-size:22px;margin-bottom:14px;"><i class="fas fa-server"></i> ${device.nom || device.name}</h3>
        <div style="display:flex;gap:18px;">
          ${device.image ? `<img src="${device.image}" style="max-width:130px;border-radius:9px;margin-bottom:10px;">` : ''}
          <table class="table details-table" style="margin-bottom:12px;">
            <tbody>
              ${Object.entries(device)
                .filter(([k, v]) => typeof v !== "object" && k !== "id" && k !== "coords" && k !== "image")
                .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:18px;">
          <button class="btn" id="show-shema-btn"><i class="fas fa-project-diagram"></i> Schéma</button>
        </div>
      </div>
    `;
    modal.innerHTML = detailsHTML;
    document.body.appendChild(modal);

    document.getElementById('close-details-modal').onclick = () => modal.remove();
    document.getElementById('show-shema-btn').onclick = () => {
      if (device.shemaImage) {
        const win = window.open();
        win.document.write(`<img src="${device.shemaImage}" style="width:100%;">`);
      } else {
        alert("Aucun schéma disponible pour cet équipement !");
      }
    };
  }

  logout() {
    localStorage.removeItem('auth');
    window.location.reload();
  }
}
