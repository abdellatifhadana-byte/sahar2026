import './equipment-component-integration.js';
import Equipements from './equipements.js';
import Salles from './salles.js';
import Baies from './baies.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';

export const ENTITY_PERMISSION_INTEGRATION_VERSION = 1;
const PATCH_FLAG = Symbol.for('2m-tech.entity-permission-integration.v1');

function allowed(entity, action) {
  return PermissionManager.check(getCurrentUser(), entity, action);
}

function removeDenied(selector, entity, action) {
  if (allowed(entity, action)) return;
  document.querySelectorAll(selector).forEach(element => element.remove());
}

function notifyDenied(instance, label) {
  instance?.notifications?.showNotification?.(`${label} non autorisée pour votre rôle.`, 'error');
  return null;
}

function installViewGuard(Component, entity, label) {
  const originalRender = Component.prototype.render;
  Component.prototype.render = async function permissionAwareRender(...args) {
    if (!allowed(entity, 'view')) {
      return `<div class="error-message"><h3>Accès refusé</h3><p>Vous n'êtes pas autorisé à consulter ${label}.</p></div>`;
    }
    return originalRender.apply(this, args);
  };
}

function installAfterRenderGuard(Component, prune) {
  const originalAfterRender = Component.prototype.afterRender;
  Component.prototype.afterRender = async function permissionAwareAfterRender(...args) {
    prune();
    return originalAfterRender?.apply(this, args);
  };
}

if (!Equipements.prototype[PATCH_FLAG]) {
  installViewGuard(Equipements, 'equipments', 'les équipements');
  installAfterRenderGuard(Equipements, () => {
    removeDenied('#open-add-eq', 'equipments', 'create');
    removeDenied('button[data-action="edit"]', 'equipments', 'edit');
    removeDenied('button[data-action="del"]', 'equipments', 'delete');
    removeDenied('#export-eq', 'equipments', 'export');
    removeDenied('#import-eq, #import-file', 'equipments', 'import');
  });

  const originalEquipmentModal = Equipements.prototype.showEquipementModal;
  Equipements.prototype.showEquipementModal = async function permissionAwareEquipmentModal(equipment = null, ...args) {
    const action = equipment?.id != null ? 'edit' : 'create';
    if (!allowed('equipments', action)) return notifyDenied(this, `Action équipement (${action})`);
    return originalEquipmentModal.call(this, equipment, ...args);
  };

  Object.defineProperty(Equipements.prototype, PATCH_FLAG, { value:true });
}

if (!Salles.prototype[PATCH_FLAG]) {
  installViewGuard(Salles, 'rooms', 'les salles');
  installAfterRenderGuard(Salles, () => {
    removeDenied('#add-salle-form', 'rooms', 'create');
    removeDenied('button[data-action="edit"]', 'rooms', 'edit');
    removeDenied('button[data-action="del"]', 'rooms', 'delete');
    removeDenied('button[data-action="coord"]', 'rooms', 'edit');
    removeDenied('#export-salles', 'rooms', 'export');
    removeDenied('#import-salles, #import-salles-file', 'rooms', 'import');
  });

  const originalRoomEdit = Salles.prototype.showEditModal;
  Salles.prototype.showEditModal = async function permissionAwareRoomEdit(...args) {
    if (!allowed('rooms', 'edit')) return notifyDenied(this, 'Modification de salle');
    return originalRoomEdit.apply(this, args);
  };

  const originalRoomCoordinates = Salles.prototype.showCoordModal;
  Salles.prototype.showCoordModal = async function permissionAwareRoomCoordinates(...args) {
    if (!allowed('rooms', 'edit')) return notifyDenied(this, 'Modification des coordonnées de salle');
    return originalRoomCoordinates.apply(this, args);
  };

  Object.defineProperty(Salles.prototype, PATCH_FLAG, { value:true });
}

if (!Baies.prototype[PATCH_FLAG]) {
  installViewGuard(Baies, 'baies', 'les baies');
  installAfterRenderGuard(Baies, () => {
    removeDenied('#add-baie-form', 'baies', 'create');
    removeDenied('button[data-action="edit"]', 'baies', 'edit');
    removeDenied('button[data-action="del"]', 'baies', 'delete');
    removeDenied('#export-baies', 'baies', 'export');
    removeDenied('#import-baies, #import-baies-file', 'baies', 'import');
  });

  const originalBaieEdit = Baies.prototype.showEditModal;
  Baies.prototype.showEditModal = async function permissionAwareBaieEdit(...args) {
    if (!allowed('baies', 'edit')) return notifyDenied(this, 'Modification de baie');
    return originalBaieEdit.apply(this, args);
  };

  Object.defineProperty(Baies.prototype, PATCH_FLAG, { value:true });
}

if (typeof window !== 'undefined') {
  window.EntityPermissionIntegration = Object.freeze({
    version:ENTITY_PERMISSION_INTEGRATION_VERSION,
    allowed
  });
}
