import { db } from './db.js';
import Auth from './auth.js';
import ResponsibleUI from './responsible-ui.js';
import VisitorUI from './visitor-ui.js';
import ScreensDiagnostic from './screens-diagnostic.js';
import WallManager from './wall-manager.js';
import openInteractiveMap from './interactive-map.js';
import { normalizeRole } from './roles.js';

// Compatibilité centrale : les anciennes valeurs de rôles restent lisibles,
// mais toute décision d'interface utilise le contrat canonique.
Auth.prototype.applyRoleTheme = function applyRoleTheme(role) {
  const canonical = normalizeRole(role);
  const roleClass = canonical === 'technician' ? 'theme-tech' : `theme-${canonical}`;
  const themeClass = localStorage.getItem('theme') === 'dark' ? 'dark-theme' : 'light-theme';
  document.body.className = `${roleClass} ${themeClass}`;
  document.documentElement.lang = 'fr';
  document.documentElement.dir = 'ltr';
};

// La page de connexion n'est volontairement plus redéfinie ici. Une seconde
// implémentation écrasait celle d'`auth.js`, si bien que corriger « la page de
// connexion » revenait à choisir laquelle des deux gagnait au chargement. `auth.js`
// est désormais l'unique chemin.

// Les identifiants IndexedDB auto-incrémentés sont numériques : normaliser aussi
// les IDs venant de dataset/prompt pour les stores non structurels.
const originalDelete = db.delete.bind(db);
db.delete = async function deleteCompat(storeName, id) {
  if (['rooms', 'baies', 'equipments', 'screens'].includes(storeName)) return originalDelete(storeName, id);
  return this._deleteRaw(storeName, this.normalizeKey(id));
};

// Le diagnostic complet peut être ouvert depuis Admin, Responsable ou Technicien.
ScreensDiagnostic.prototype.refreshView = async function refreshView() {
  const container = document.getElementById('admin-content')
    || document.getElementById('responsible-content')
    || document.getElementById('tech-content')
    || document.getElementById('app');
  if (!container) return;
  container.innerHTML = await this.render();
  await this.afterRender();
};

const originalTechnicianView = ScreensDiagnostic.prototype.showTechnicianView;
ScreensDiagnostic.prototype.showTechnicianView = async function showTechnicianViewCompat() {
  if (!document.getElementById('admin-content') && !document.getElementById('responsible-content')) {
    const app = document.getElementById('app');
    if (app) app.innerHTML = '<main id="admin-content" class="admin-content"></main>';
  }
  return originalTechnicianView.call(this);
};

// Les libellés « Tableau de bord » et « Journal » ne sont plus rétablis ici.
//
// Ils l'étaient parce que `admin-ui.js` déclarait « Dashboard » et « Logs » — deux titres
// anglais au milieu d'un registre français. Trois couches réparaient la même chose : cette
// redéfinition, `french-ui-guard.js` qui retraduisait le texte rendu, et le registre
// lui-même qui restait faux. Le registre porte désormais les bons libellés ; réparer par-
// dessus n'aurait fait que masquer une éventuelle régression à la source.

// L'export global n'est volontairement plus redéfini ici : il vivait en deux
// exemplaires, dont celui d'`admin-ui.js` lisait un magasin `rapports` inexistant et
// aurait fait échouer l'export si cette redéfinition avait disparu. `admin-ui.js` porte
// désormais l'unique implémentation.

// Les paramètres système ne sont volontairement plus redéfinis ici.
// `settings-contract.js` + `system-settings.js` constituent l'unique chemin canonique.

// Responsable : conserver l'interface historique et lui ajouter Carte + Mur + Diagnostic.
const originalResponsibleRender = ResponsibleUI.prototype.renderBaseLayout;
ResponsibleUI.prototype.renderBaseLayout = function renderResponsibleIntegrated() {
  this.sections.walls = { title: "Mur d'images", icon: 'fas fa-border-all', component: null };
  this.sections.screensDiagnostic = { title: 'Diagnostic écrans', icon: 'fas fa-tv', component: new ScreensDiagnostic(this.notifications) };
  originalResponsibleRender.call(this);
  const header = document.querySelector('.responsible-header');
  if (header && !document.getElementById('responsible-map')) {
    const button = document.createElement('button');
    button.id = 'responsible-map';
    button.className = 'btn';
    button.innerHTML = '<i class="fas fa-map"></i> Carte interactive';
    const last = header.lastElementChild;
    header.insertBefore(button, last || null);
  }
};

const originalResponsibleBind = ResponsibleUI.prototype.bindEvents;
ResponsibleUI.prototype.bindEvents = function bindResponsibleIntegrated() {
  originalResponsibleBind.call(this);
  document.getElementById('responsible-map')?.addEventListener('click', () => this.openMap());
};

ResponsibleUI.prototype.openMap = async function openResponsibleMap() {
  const [rooms, baies, equipments, walls] = await Promise.all(['rooms','baies','equipments','walls'].map(store => db.getAll(store)));
  openInteractiveMap({
    rooms, baies, equipments, walls,
    user:this.user,
    notifications:this.notifications,
    onOpenWall:async roomId => {
      await db.setCurrentRoomId(roomId);
      document.getElementById('map-modal')?.remove();
      await this.navigateToSection('walls');
    }
  });
};

const originalResponsibleLoad = ResponsibleUI.prototype.loadSection;
ResponsibleUI.prototype.loadSection = async function loadResponsibleIntegrated(section) {
  if (section !== 'walls') return originalResponsibleLoad.call(this, section);
  const container = document.getElementById('responsible-content');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Chargement…</p></div>';
  try {
    const manager = new WallManager({
      notifications:this.notifications,
      onBack:()=>this.navigateToSection('devices'),
      onOpenMap:()=>this.openMap(),
      onOpenDiagnostic:async screenId => {
        await this.navigateToSection('screensDiagnostic');
        await this.sections.screensDiagnostic.component.selectScreenById(screenId);
      }
    });
    container.innerHTML = await manager.render();
    await manager.afterRender();
  } catch (error) {
    container.innerHTML = `<div class="error-message"><h3>Erreur</h3><p>${String(error.message || error)}</p></div>`;
  }
};

// Le Visiteur garde son parcours historique Salle → Baie → Équipement et obtient
// en plus l'accès lecture seule au Mur d'images via la carte.
VisitorUI.prototype.showRoomsMap = async function showRoomsMapIntegrated() {
  const [rooms, baies, equipments, walls] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments'), db.getAll('walls')
  ]);
  openInteractiveMap({
    rooms, baies, equipments, walls,
    user:this.user,
    notifications:this.notifications,
    onOpenWall: async roomId => {
      await db.setCurrentRoomId(roomId);
      document.getElementById('map-modal')?.remove();
      await this.showWall();
    },
    onClose: () => document.getElementById('map-modal')?.remove()
  });
};

VisitorUI.prototype.showWall = async function showWallReadOnly() {
  const manager = new WallManager({
    notifications:this.notifications,
    onBack:()=>this.showSplash(),
    onOpenMap:()=>this.showRoomsMap()
  });
  const app = document.getElementById('app');
  app.innerHTML = await manager.render();
  await manager.afterRender();
};