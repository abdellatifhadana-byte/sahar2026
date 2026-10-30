import { db } from './db.js';
import openInteractiveMap from './interactive-map.js';
import WallManager from './wall-manager.js';
import { PermissionManager } from './permissions.js';
import { roleLabel } from './roles.js';
import { showTicketsPage } from './tickets.js';

// Le nom d'un compte est du texte, jamais du balisage : la même règle que dans les trois
// autres coques. Elle vaut aussi ici, où le nom est le seul contenu de l'en-tête qui ne
// soit pas écrit dans le gabarit.
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

/*
 * L'IMAGE D'ATTENTE N'EST PLUS LE PLAN DU SITE.
 *
 * `assets/plan-technique.PNG` servait de repli quand une salle ou une baie n'a pas de
 * photo. Une fiche sans image affichait donc le plan technique complet — RF1, RF2,
 * acquisition, salles serveurs — à qui pouvait ouvrir cette fiche, Visiteur compris.
 * Le repli est désormais neutre : il dit qu'il n'y a pas d'image, sans en montrer une autre.
 */
const PLACEHOLDER_IMAGE = 'assets/image-indisponible.svg';

function renderHotspotsOnImage({ containerId, imageUrl, items = [], onClick }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="position:relative;display:inline-block;">
      <img id="main-img" src="${imageUrl}" style="max-width:90vw;max-height:66vh;border-radius:10px;">
      <div id="img-hotspots" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>
    </div>
  `;
  const img = container.querySelector('#main-img');
  img.onload = () => {
    const w = img.width;
    const h = img.height;
    const hotspotLayer = container.querySelector('#img-hotspots');
    hotspotLayer.innerHTML = '';
    items.forEach(item => {
      if (!item.coords) return;
      const spot = document.createElement('div');
      spot.className = 'img-hotspot';
      spot.style = `
        position:absolute;
        left:${item.coords.x * w / (item.imgNaturalWidth || w)}px;
        top:${item.coords.y * h / (item.imgNaturalHeight || h)}px;
        width:24px;height:24px;
        background:${item.statut === 'hors-service' ? '#e74c3c' : '#2874a6'};
        border-radius:50%;box-shadow:0 2px 7px #3337;
        display:flex;align-items:center;justify-content:center;
        cursor:pointer;z-index:11;transition:box-shadow .17s;
      `;
      spot.title = item.nom || item.name;
      spot.innerHTML = `<i class="fas fa-server" style="color:#fff;font-size:13px;"></i>`;
      spot.onclick = event => {
        event.stopPropagation();
        onClick(item);
      };
      hotspotLayer.appendChild(spot);
    });
  };
}

export default class VisitorUI {
  constructor(user, notifications) {
    this.user = user;
    this.notifications = notifications;
    this.state = {
      view: 'splash',
      selectedRoom: null,
      selectedBaie: null,
      selectedDevice: null
    };
    this.showSplash();
  }

  showSplash() {
    /*
     * LE VISITEUR AVAIT UNE PAGE, PAS UNE COQUE.
     *
     * Les trois autres rôles ouvrent sur une en-tête qui dit la plateforme, qui est
     * connecté et avec quel rôle. Le visiteur, lui, arrivait sur quatre boutons flottant
     * au milieu d'un écran vide : rien ne nommait la plateforme une fois passé le titre de
     * bienvenue, rien ne disait sous quel compte on se trouvait, et la déconnexion était un
     * bouton rouge perdu au centre. Sur un vidéoprojecteur, l'écran ne se rattachait à rien.
     *
     * L'en-tête reprend donc les repères des autres coques — identité, compte, rôle,
     * déconnexion — et les boutons d'action deviennent une rangée cohérente au lieu de
     * quatre styles écrits à la main. Aucun identifiant ni libellé ne change :
     * `zone-access-integration.js` insère son bouton après `#enter-map-btn`, et les tests
     * de demandes cherchent « Mes demandes » et `#visitor-requests-btn`.
     */
    const canViewWalls = PermissionManager.check(this.user, 'walls', 'view');
    const nomAffiche = this.user?.fullName || this.user?.username || '';
    document.getElementById('app').innerHTML = `
      <div class="visitor-page">
        <header class="visitor-header">
          <div class="visitor-brand">
            <img src="assets/images/2m-logo.webp" alt="2M TECH" class="visitor-brand-logo">
            <h1>2M TECH Platform</h1>
          </div>
          <div class="visitor-header-actions">
            <span class="user-badge" title="${escapeHTML(nomAffiche)}">${escapeHTML(nomAffiche)}</span>
            <span class="user-badge user-badge-role">${escapeHTML(roleLabel(this.user?.role))}</span>
            <button id="visitor-logout-btn" class="btn danger" type="button" title="Déconnexion" aria-label="Déconnexion">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </header>
        <main class="visitor-splash">
          <h2>Bienvenue sur la plateforme 2M TECH !</h2>
          <p>Cliquez pour découvrir le centre technique interactif.</p>
          <div class="visitor-actions">
            <button id="enter-map-btn" class="btn visitor-action-main" type="button">
              <i class="fas fa-map-marked-alt"></i> Voir la carte interactive
            </button>
            ${canViewWalls ? `<button id="visitor-wall-btn" class="btn gray" type="button"><i class="fas fa-border-all"></i> Mur d'images</button>` : ''}
            <button id="visitor-requests-btn" class="btn gray" type="button">
              <i class="fas fa-life-ring"></i> Mes demandes
            </button>
          </div>
        </main>
      </div>
    `;
    document.getElementById('enter-map-btn').onclick = () => this.showRoomsMap();
    document.getElementById('visitor-wall-btn')?.addEventListener('click', () => this.showWall());
    document.getElementById('visitor-requests-btn').onclick = () => this.showRequests();
    document.getElementById('visitor-logout-btn').onclick = () => this.logout();
    setTimeout(() => document.getElementById('enter-map-btn')?.focus(), 700);
  }

  async showRequests() {
    document.getElementById('app').innerHTML = `<div class="visitor-requests-view" style="padding:24px;max-width:1500px;margin:auto;"><button class="btn" id="visitor-requests-back" style="margin-bottom:14px;"><i class="fas fa-arrow-left"></i> Retour</button><main id="visitor-requests-content"></main></div>`;
    document.getElementById('visitor-requests-back').onclick = () => this.showSplash();
    await showTicketsPage('visitor-requests-content');
  }

  async showWall(roomId = null) {
    if (!PermissionManager.check(this.user, 'walls', 'view')) {
      this.notifications?.showNotification("Vous n'êtes pas autorisé à consulter le mur d'images.", 'error');
      return;
    }
    if (roomId != null) await db.setCurrentRoomId(roomId);
    const manager = new WallManager({
      notifications: this.notifications,
      onBack: () => this.showSplash(),
      onOpenMap: () => this.showRoomsMap()
    });
    const app = document.getElementById('app');
    app.innerHTML = await manager.render();
    await manager.afterRender();
  }

  async showRoomsMap() {
    const [rooms, baies, equipments] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('baies'),
      db.getAll('equipments')
    ]);
    const canViewWalls = PermissionManager.check(this.user, 'walls', 'view');
    openInteractiveMap({
      rooms,
      baies,
      equipments,
      user: this.user,
      notifications: this.notifications,
      onRoomClick: room => {
        document.getElementById('map-modal')?.remove();
        this.showRoomDetails(room);
      },
      onBaieClick: baie => {
        document.getElementById('map-modal')?.remove();
        this.showBaieDetails(baie);
      },
      onEquipmentClick: device => {
        document.getElementById('map-modal')?.remove();
        this.showDeviceDetails(device);
      },
      onOpenWall: canViewWalls ? async roomId => {
        document.getElementById('map-modal')?.remove();
        await this.showWall(roomId);
      } : undefined,
      onClose: () => document.getElementById('map-modal')?.remove()
    });
  }

  async showRoomDetails(room) {
    await db.setCurrentRoomId(room.id);
    const [baies, equipments, users] = await Promise.all([
      db.getAll('baies', 'roomId', room.id),
      db.getAll('equipments', 'roomId', room.id),
      db.getAll('users')
    ]);
    const canViewWalls = PermissionManager.check(this.user, 'walls', 'view');
    document.getElementById('app').innerHTML = `
      <div class="visitor-room-view" style="padding:32px;">
        <button class="btn" style="margin-bottom:22px;" id="back-map"><i class="fas fa-arrow-left"></i> Retour</button>
        <h2 style="color:#2874a6;margin-bottom:18px;">Salle: ${room.name}</h2>
        ${canViewWalls ? `<button type="button" class="btn gray" id="visitor-room-wall-btn" style="margin-bottom:16px;"><i class="fas fa-border-all"></i> Voir le mur d'images</button>` : ''}
        <div id="room-img-container" style="position:relative;max-width:95vw;"></div>
        <div style="margin-bottom:14px;">
          <strong>Emplacement:</strong> ${room.location || '--'}<br>
          <strong>Responsable:</strong> ${(users.find(user => user.id == room.responsibleId)?.fullName || '--')}
        </div>
        <div>
          <h4>Baies dans cette salle</h4>
          <ul>
            ${baies.length ? baies.map(baie => `<li><a href="#" data-baie="${baie.id}" class="baie-link">${baie.name}</a></li>`).join('') : '<li>---</li>'}
          </ul>
        </div>
      </div>
    `;
    renderHotspotsOnImage({
      containerId: 'room-img-container',
      imageUrl: room.image || PLACEHOLDER_IMAGE,
      items: equipments.filter(equipment => equipment.coords),
      onClick: device => this.showDeviceDetails(device)
    });
    document.getElementById('back-map').onclick = () => this.showSplash();
    document.getElementById('visitor-room-wall-btn')?.addEventListener('click', () => this.showWall(room.id));
    document.querySelectorAll('.baie-link').forEach(anchor => {
      anchor.onclick = event => {
        event.preventDefault();
        const id = anchor.getAttribute('data-baie');
        this.showBaieDetails(baies.find(baie => String(baie.id) === String(id)));
      };
    });
  }

  async showBaieDetails(baie) {
    if (!baie) return this.notifications?.showNotification('Baie introuvable.', 'error');
    const equipments = await db.getAll('equipments', 'baieId', baie.id);
    document.getElementById('app').innerHTML = `
      <div class="visitor-baie-view" style="padding:32px;">
        <button class="btn" style="margin-bottom:22px;" id="back-room"><i class="fas fa-arrow-left"></i> Retour à la salle</button>
        <h2 style="color:#9b59b6;margin-bottom:18px;">Baie: ${baie.name}</h2>
        <div id="baie-img-container" style="position:relative;max-width:92vw;"></div>
        <div style="margin-bottom:12px;">
          <strong>Dans la salle:</strong> ${baie.roomId || '--'}
        </div>
      </div>
    `;
    renderHotspotsOnImage({
      containerId: 'baie-img-container',
      imageUrl: baie.image || PLACEHOLDER_IMAGE,
      items: equipments.filter(equipment => equipment.coords),
      onClick: device => this.showDeviceDetails(device)
    });
    document.getElementById('back-room').onclick = () => {
      db.get('rooms', baie.roomId).then(room => this.showRoomDetails(room));
    };
  }

  async showDeviceDetails(device) {
    document.getElementById('details-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:22000;
      display:flex;align-items:center;justify-content:center;background:rgba(35,35,55,0.24);
    `;
    modal.innerHTML = `
      <div style="background:#fff;padding:32px 44px 24px 42px;border-radius:18px;min-width:360px;max-width:610px;box-shadow:0 2px 32px #2229;position:relative;">
        <button id="close-details-modal" class="btn danger" style="position:absolute;right:8px;top:8px;"><i class="fas fa-times"></i></button>
        <h3 style="color:#2874a6;font-size:22px;margin-bottom:14px;"><i class="fas fa-server"></i> ${device.nom || device.name}</h3>
        <div style="display:flex;gap:18px;">
          ${device.image ? `<img src="${device.image}" style="max-width:130px;border-radius:9px;margin-bottom:10px;">` : ''}
          <table class="table details-table" style="margin-bottom:12px;">
            <tbody>
              ${Object.entries(device)
                .filter(([key, value]) => typeof value !== 'object' && key !== 'id' && key !== 'coords' && key !== 'image')
                .map(([key, value]) => `<tr><td><b>${key}</b></td><td>${value}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:18px;">
          <button class="btn" id="show-shema-btn"><i class="fas fa-project-diagram"></i> Schéma</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-details-modal').onclick = () => modal.remove();
    document.getElementById('show-shema-btn').onclick = () => {
      if (device.shemaImage) {
        const win = window.open();
        win.document.write(`<img src="${device.shemaImage}" style="width:100%;">`);
      } else {
        alert('Aucun schéma disponible pour cet équipement !');
      }
    };
  }

  logout() {
    localStorage.removeItem('auth');
    window.location.reload();
  }
}
