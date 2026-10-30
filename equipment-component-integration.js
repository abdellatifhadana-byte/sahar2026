import Equipements from './equipements.js';
import { db } from './db.js';
import { openCanonicalEquipmentEditor } from './equipment-editor-service.js';

export const EQUIPMENT_COMPONENT_INTEGRATION_VERSION = 1;
const PATCH_FLAG = Symbol.for('2m-tech.equipment-component-integration.v1');

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const keyOf = value => db.normalizeKey ? db.normalizeKey(value) : value;

function componentHost(manager) {
  const ids = [manager.hostElementId, 'admin-content', 'responsible-content', 'tech-route-content'].filter(Boolean);
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

async function safeEquipmentById(rawId) {
  if (rawId == null || rawId === '') return null;
  return db.get('equipments', keyOf(rawId)).catch(() => null);
}

function installEditorRefresh(manager) {
  if (manager._canonicalEditorRefreshBound || typeof window === 'undefined') return;
  manager._canonicalEditorRefreshBound = true;
  window.addEventListener('equipment-editor-saved', () => {
    const host = componentHost(manager);
    if (!host || !host.isConnected) return;
    manager.refreshList();
  });
}

function secureQuickView(eq, manager) {
  document.getElementById('equip-quickview-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'equip-quickview-modal';
  modal.className = 'modal';
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.style.cssText = 'min-width:350px;max-width:620px;';
  content.innerHTML = `<button class="btn danger" data-close style="float:right"><i class="fas fa-times"></i></button>
    <h3 style="color:#2874a6">Détails de l’équipement</h3>
    <div class="equipment-secure-summary"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <button class="btn" data-open-360><i class="fas fa-cube"></i> Ouvrir la Fiche 360</button>
      <button class="btn gray" data-close>Fermer</button>
    </div>`;
  const fields = [
    ['Nom',eq?.name || eq?.nom],['Type',eq?.type],['Catégorie',eq?.categorie],['Marque',eq?.marque],
    ['Modèle',eq?.modele],['Numéro série',eq?.numSerie],['Statut',eq?.statut || eq?.status],
    ['Adresse IP',eq?.ipAddress],['N° Grille IN/OUT',eq?.grilleINOUT],['Notes',eq?.notes]
  ];
  const table = document.createElement('table');
  table.className = 'table details-table';
  const body = document.createElement('tbody');
  for (const [label,value] of fields) {
    const row = document.createElement('tr');
    const left = document.createElement('td'); const right = document.createElement('td');
    const strong = document.createElement('strong'); strong.textContent = label;
    left.appendChild(strong); right.textContent = String(value ?? ''); row.append(left,right); body.appendChild(row);
  }
  table.appendChild(body);
  content.querySelector('.equipment-secure-summary').appendChild(table);
  modal.appendChild(content); document.body.appendChild(modal);
  content.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.remove()));
  content.querySelector('[data-open-360]')?.addEventListener('click', () => {
    modal.remove();
    if (window.TechOperations?.openEquipment360) window.TechOperations.openEquipment360(eq.id);
    else manager.notifications?.showNotification?.('Fiche 360 indisponible dans cette vue.', 'info');
  });
  return modal;
}

if (!Equipements.prototype[PATCH_FLAG]) {
  const originalAfterRender = Equipements.prototype.afterRender;

  Equipements.prototype.refreshList = function refreshInCurrentHost() {
    const host = componentHost(this);
    if (!host) {
      this.notifications?.showNotification?.('Impossible de rafraîchir la liste: conteneur de vue absent.', 'warning');
      return Promise.resolve(false);
    }
    return this.render().then(async html => {
      host.innerHTML = html;
      await this.afterRender();
      return true;
    });
  };

  Equipements.prototype.showQuickView = async function showCanonicalQuickView(eq) {
    if (!eq) return null;
    if (window.TechOperations?.openEquipment360) {
      window.TechOperations.openEquipment360(eq.id);
      return eq;
    }
    return secureQuickView(eq, this);
  };

  Equipements.prototype.afterRender = async function afterRenderWithCanonicalEditor() {
    await originalAfterRender.call(this);
    installEditorRefresh(this);

    const addButton = document.getElementById('open-add-eq');
    if (addButton) addButton.onclick = () => openCanonicalEquipmentEditor({ notifications:this.notifications });

    document.querySelectorAll('button[data-action="edit"]').forEach(button => {
      button.onclick = async () => {
        const equipment = await safeEquipmentById(button.dataset.id);
        if (!equipment) {
          this.notifications?.showNotification?.('Équipement introuvable.', 'error');
          return;
        }
        await openCanonicalEquipmentEditor({ equipment, notifications:this.notifications });
      };
    });

    document.querySelectorAll('button[data-action="del"]').forEach(button => {
      button.onclick = async () => {
        const equipment = await safeEquipmentById(button.dataset.id);
        if (!equipment) {
          this.notifications?.showNotification?.('Équipement introuvable.', 'error');
          return;
        }
        if (!window.confirm(`Supprimer ${equipment.name || equipment.nom || 'cet équipement'} ?`)) return;
        try {
          await db.deleteEquipmentSafely(keyOf(equipment.id));
          this.notifications?.showNotification?.('Suppression réussie', 'success');
          await this.refreshList();
        } catch (error) {
          this.notifications?.showNotification?.(error.message, 'error');
        }
      };
    });

    document.querySelectorAll('.eq-quickview').forEach(link => {
      link.onclick = async event => {
        event.preventDefault();
        const equipment = await safeEquipmentById(link.dataset.id);
        if (!equipment) {
          this.notifications?.showNotification?.('Équipement introuvable.', 'error');
          return;
        }
        await this.showQuickView(equipment);
      };
    });
  };

  Object.defineProperty(Equipements.prototype, PATCH_FLAG, { value:true });
}

if (typeof window !== 'undefined') {
  window.EquipmentComponentIntegration = Object.freeze({
    version:EQUIPMENT_COMPONENT_INTEGRATION_VERSION,
    escape:esc,
    resolveHost:componentHost
  });
}
