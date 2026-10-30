import VisitorUI from './visitor-ui.js';
import { db } from './db.js';
import { eventSystem } from './events.js';
import { PermissionManager } from './permissions.js';
import { toDisplayCoordinates } from './map-coordinates-contract.js';

export const VISITOR_CANONICAL_INTEGRATION_VERSION = 2;
const PATCH_FLAG = Symbol.for('2m-tech.visitor-canonical-integration.v2');
const same = (left, right) => left != null && right != null && String(left) === String(right);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
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

function safeImageUrl(value, fallback = PLACEHOLDER_IMAGE) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^(?:https?:|data:image\/|\/|\.\/|assets\/|images\/)/i.test(raw)) return raw;
  return fallback;
}

function appendHotspotImage(container, { imageUrl, items = [], onClick }) {
  if (!container) return;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;max-width:100%';
  const image = document.createElement('img');
  image.alt = 'Vue technique';
  image.src = safeImageUrl(imageUrl);
  image.style.cssText = 'max-width:90vw;max-height:66vh;border-radius:10px;display:block';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0';
  wrapper.append(image, layer); container.replaceChildren(wrapper);

  const redraw = () => {
    layer.replaceChildren();
    const width = image.clientWidth || image.width || 1;
    const height = image.clientHeight || image.height || 1;
    for (const item of items) {
      const coords = item?.coords;
      if (!coords) continue;
      const naturalWidth = Number(item.imgNaturalWidth || image.naturalWidth || width) || width;
      const naturalHeight = Number(item.imgNaturalHeight || image.naturalHeight || height) || height;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'img-hotspot';
      button.title = String(item.name || item.nom || 'Équipement');
      button.setAttribute('aria-label', button.title);
      // Même contrat que la pose des repères de salle : une seule implémentation de la
      // remise à l'échelle, pour que saisie et affichage ne puissent pas diverger.
      const { x, y } = toDisplayCoordinates(coords, {
        displayWidth: width, displayHeight: height, naturalWidth, naturalHeight,
        // Les repères d'équipement ont toujours été posés en pixels de l'image naturelle :
        // sans dimensions enregistrées, celles de l'image courante sont les bonnes.
        assumeNaturalWhenUnknown: true
      });
      button.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:26px;height:26px;transform:translate(-50%,-50%);border:2px solid #fff;border-radius:50%;background:${String(item.statut || item.status).toLowerCase().includes('hors') ? '#e74c3c' : '#2874a6'};color:#fff;cursor:pointer;box-shadow:0 2px 7px #3337;z-index:2`;
      const icon = document.createElement('i'); icon.className = 'fas fa-server'; button.appendChild(icon);
      button.addEventListener('click', event => { event.stopPropagation(); onClick?.(item); });
      layer.appendChild(button);
    }
  };
  image.addEventListener('load', redraw);
  if (image.complete) queueMicrotask(redraw);
  return { image, layer, redraw };
}

function secureDeviceFallback(device) {
  document.getElementById('details-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'details-modal'; modal.className = 'modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:22000;display:flex;align-items:center;justify-content:center;background:rgba(35,35,55,.35);padding:18px';
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--card-bg,#fff);color:var(--text-color,#1d2a34);padding:26px;border-radius:16px;width:min(650px,96vw);max-height:88vh;overflow:auto;box-shadow:0 18px 50px #0005';
  const header = document.createElement('div'); header.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:center';
  const title = document.createElement('h3'); title.textContent = device?.name || device?.nom || 'Équipement';
  const close = document.createElement('button'); close.className = 'btn danger'; close.innerHTML = '<i class="fas fa-times"></i>'; close.addEventListener('click', () => modal.remove());
  header.append(title, close); card.appendChild(header);
  const table = document.createElement('table'); table.className = 'table details-table';
  const body = document.createElement('tbody');
  const hidden = new Set(['id','coords','image','images','qr','password','token','secret']);
  for (const [field,value] of Object.entries(device || {})) {
    if (hidden.has(field) || value == null || typeof value === 'object') continue;
    const row = document.createElement('tr'); const left = document.createElement('td'); const right = document.createElement('td');
    left.textContent = field; right.textContent = String(value); row.append(left,right); body.appendChild(row);
  }
  table.appendChild(body); card.appendChild(table); modal.appendChild(card); document.body.appendChild(modal);
  return modal;
}

if (!VisitorUI.prototype[PATCH_FLAG]) {
  VisitorUI.prototype.logout = function canonicalVisitorLogout() {
    eventSystem.dispatch('logout');
  };

  VisitorUI.prototype.showDeviceDetails = async function canonicalVisitorEquipment(device) {
    if (!device) return null;
    if (window.TechOperations?.openEquipment360) {
      window.TechOperations.openEquipment360(device.id);
      return device;
    }
    return secureDeviceFallback(device);
  };

  VisitorUI.prototype.showRoomDetails = async function secureVisitorRoom(room) {
    if (!room) return this.showSplash();
    await db.setCurrentRoomId(room.id);
    const [allBaies, allEquipments, users] = await Promise.all([db.getAll('baies'), db.getAll('equipments'), db.getAll('users')]);
    const baies = allBaies.filter(item => same(item.roomId, room.id));
    const equipments = allEquipments.filter(item => same(item.roomId, room.id));
    const responsible = users.find(user => same(user.id, room.responsibleId));
    const canViewWall = PermissionManager.check(this.user, 'walls', 'view');
    const app = document.getElementById('app');
    app.innerHTML = `<div class="visitor-room-view" style="padding:32px">
      <button class="btn" id="visitor-room-back"><i class="fas fa-arrow-left"></i> Retour</button>
      <h2 style="color:#2874a6">Salle: ${esc(room.name || room.nom || room.id)}</h2>
      ${canViewWall ? `<button type="button" class="btn gray" id="visitor-canonical-room-wall" style="margin:0 0 14px"><i class="fas fa-border-all"></i> Voir le mur d'images</button>` : ''}
      <div id="visitor-room-image" style="position:relative;max-width:95vw"></div>
      <div class="card" style="margin-top:14px"><strong>Emplacement:</strong> ${esc(room.location || '—')}<br><strong>Responsable:</strong> ${esc(responsible?.fullName || '—')}</div>
      <div class="card" style="margin-top:14px"><h4>Baies dans cette salle</h4><div id="visitor-room-baies" style="display:flex;flex-wrap:wrap;gap:8px"></div></div>
    </div>`;
    document.getElementById('visitor-room-back')?.addEventListener('click', () => this.showSplash());
    document.getElementById('visitor-canonical-room-wall')?.addEventListener('click', () => this.showWall(room.id));
    appendHotspotImage(document.getElementById('visitor-room-image'), {
      imageUrl:room.image || room.imageUrl,
      items:equipments.filter(item => item.coords),
      onClick:item => this.showDeviceDetails(item)
    });
    const list = document.getElementById('visitor-room-baies');
    if (!baies.length) list.textContent = 'Aucune baie documentée.';
    for (const baie of baies) {
      const button = document.createElement('button'); button.className = 'btn gray'; button.textContent = baie.name || baie.nom || String(baie.id);
      button.addEventListener('click', () => this.showBaieDetails(baie)); list.appendChild(button);
    }
  };

  VisitorUI.prototype.showBaieDetails = async function secureVisitorBaie(baie) {
    if (!baie) return this.showSplash();
    const [allEquipments, room] = await Promise.all([
      db.getAll('equipments'), db.get('rooms', db.normalizeKey ? db.normalizeKey(baie.roomId) : baie.roomId).catch(() => null)
    ]);
    const equipments = allEquipments.filter(item => same(item.baieId, baie.id));
    const app = document.getElementById('app');
    app.innerHTML = `<div class="visitor-baie-view" style="padding:32px">
      <button class="btn" id="visitor-baie-back"><i class="fas fa-arrow-left"></i> Retour à la salle</button>
      <h2 style="color:#9b59b6">Baie: ${esc(baie.name || baie.nom || baie.id)}</h2>
      <div id="visitor-baie-image" style="position:relative;max-width:92vw"></div>
      <div class="card" style="margin-top:14px"><strong>Salle:</strong> ${esc(room?.name || room?.nom || baie.roomId || '—')}</div>
      <div class="card" style="margin-top:14px"><h4>Équipements dans cette baie</h4><div id="visitor-baie-equipments" style="display:grid;gap:8px"></div></div>
    </div>`;
    document.getElementById('visitor-baie-back')?.addEventListener('click', () => room ? this.showRoomDetails(room) : this.showSplash());
    appendHotspotImage(document.getElementById('visitor-baie-image'), {
      imageUrl:baie.image || baie.imageUrl,
      items:equipments.filter(item => item.coords),
      onClick:item => this.showDeviceDetails(item)
    });
    const list = document.getElementById('visitor-baie-equipments');
    if (!equipments.length) list.textContent = 'Aucun équipement documenté.';
    for (const equipment of equipments) {
      const button = document.createElement('button'); button.className = 'btn gray'; button.style.textAlign = 'left';
      button.textContent = `${equipment.name || equipment.nom || equipment.id}${equipment.modele ? ` · ${equipment.modele}` : ''}`;
      button.addEventListener('click', () => this.showDeviceDetails(equipment)); list.appendChild(button);
    }
  };

  Object.defineProperty(VisitorUI.prototype, PATCH_FLAG, { value:true });
}

if (typeof window !== 'undefined') {
  window.VisitorCanonicalIntegration = Object.freeze({
    version:VISITOR_CANONICAL_INTEGRATION_VERSION,
    safeImageUrl,
    appendHotspotImage
  });
}
