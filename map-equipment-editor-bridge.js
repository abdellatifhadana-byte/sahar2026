import { db } from './db.js';
import { closeInteractiveMap } from './interactive-map.js';
import { openCanonicalEquipmentEditor } from './equipment-editor-service.js';

export const MAP_EQUIPMENT_EDITOR_BRIDGE_VERSION = 1;

const text = value => String(value ?? '').trim();

async function resolveRoomContext() {
  if (!document.querySelector('#map-panel #room-detail-image')) return null;
  return db.getCurrentRoomId().catch(() => null);
}

async function resolveBaieContext() {
  const panel = document.getElementById('map-panel');
  if (!panel || panel.querySelector('#room-detail-image')) return null;
  const leafLabels = [...panel.querySelectorAll('div')]
    .filter(element => element.children.length === 0)
    .map(element => text(element.textContent))
    .filter(Boolean);
  const baies = await db.getAll('baies');
  const matches = baies.filter(baie => leafLabels.includes(text(baie.name || baie.nom || baie.id)));
  return matches.length === 1 ? matches[0] : null;
}

async function resolveEquipmentFromPanel() {
  const panel = document.getElementById('map-panel');
  if (!panel) return null;
  const labels = [...panel.querySelectorAll('div')]
    .filter(element => element.children.length === 0)
    .map(element => text(element.textContent))
    .filter(Boolean);
  const equipments = await db.getAll('equipments');
  const matches = equipments.filter(item => labels.includes(text(item.name || item.nom || item.id)));
  return matches.length === 1 ? matches[0] : null;
}

function editorIntentForTarget(target) {
  if (!(target instanceof Element) || !document.getElementById('map-modal')) return null;
  // L'AJOUT N'EST PLUS INTERCEPTÉ ICI.
  //
  // Le pont détournait ce bouton vers l'éditeur canonique en mode création, et fermait la
  // carte au passage. L'administrateur qui voulait poser sur le plan un appareil DÉJÀ
  // inventorié — le cas courant, la plateforme en comptant des centaines — n'avait donc
  // aucune issue : on ne lui proposait que d'en saisir un nouveau, c'est-à-dire un doublon.
  //
  // La carte porte désormais le choix elle-même : rattacher un équipement existant sans
  // quitter le plan, ou créer, auquel cas elle délègue au MÊME éditeur canonique. Le pont
  // garde ses deux autres intentions, qui restent des modifications.
  if (target.closest('#map-panel #edit-equipment-btn')) return { type:'panel-edit' };
  if (target.closest('.context-menu-item[data-action="edit"]')) {
    const menu = document.getElementById('admin-context-menu');
    if (menu?.dataset?.type === 'equipment' && menu.dataset.id) return { type:'context-edit', equipmentId:menu.dataset.id };
  }
  return null;
}

async function requestForIntent(intent) {
  if (intent.type === 'context-edit') return { equipmentId:intent.equipmentId };
  if (intent.type === 'panel-edit') {
    const equipment = await resolveEquipmentFromPanel();
    return equipment ? { equipment } : null;
  }
  if (intent.type === 'add') {
    const roomId = await resolveRoomContext();
    if (roomId != null) return { roomId, baieId:null };
    const baie = await resolveBaieContext();
    return baie ? { roomId:baie.roomId ?? null, baieId:baie.id } : null;
  }
  return null;
}

async function handleMapEditorIntent(intent) {
  const request = await requestForIntent(intent);
  if (!request) {
    window.AppDialog?.notice?.('Contexte de la carte ambigu : l’éditeur central n’a pas modifié les données.', 'warning');
    return false;
  }
  closeInteractiveMap({ notify:false });
  await openCanonicalEquipmentEditor(request);
  return true;
}

function installBridge() {
  if (typeof document === 'undefined' || document.documentElement.dataset.mapEquipmentEditorBridge === '1') return;
  document.documentElement.dataset.mapEquipmentEditorBridge = '1';
  document.addEventListener('click', event => {
    const intent = editorIntentForTarget(event.target);
    if (!intent) return;
    // L’ancien handler est bloqué immédiatement. La résolution DB se fait ensuite,
    // ce qui évite qu’un formulaire local écrive en parallèle de l’éditeur canonique.
    event.preventDefault();
    event.stopImmediatePropagation();
    handleMapEditorIntent(intent).catch(error => {
      console.error('Éditeur équipement canonique indisponible depuis la carte', error);
      window.AppDialog?.notice?.('Impossible d’ouvrir l’éditeur équipement central.', 'error');
    });
  }, true);
}

if (typeof window !== 'undefined') {
  installBridge();
  window.MapEquipmentEditorBridge = Object.freeze({
    version:MAP_EQUIPMENT_EDITOR_BRIDGE_VERSION,
    open:openCanonicalEquipmentEditor
  });
}
