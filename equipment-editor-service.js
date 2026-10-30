import { db } from './db.js';
import Equipements from './equipements.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';
import { generateQR } from './qr.js';
import { normalizeRelationId } from './equipment-write-contract.js';

export const EQUIPMENT_EDITOR_SERVICE_VERSION = 1;

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

function notificationAdapter(notifications = null) {
  if (notifications?.showNotification) return notifications;
  return {
    showNotification(message, type = 'info') {
      if (window.AppDialog?.notice) window.AppDialog.notice(message, type);
      else console[type === 'error' ? 'error' : 'log'](message);
    }
  };
}

async function fillBaiesForRoom(form, selectedBaieId = null) {
  if (!form?.roomId || !form?.baieId) return;
  const roomId = String(form.roomId.value || '');
  const baies = await db.getAll('baies');
  const visible = roomId ? baies.filter(baie => String(baie.roomId) === roomId) : baies;
  form.baieId.innerHTML = `<option value="">Aucun rack / hors baie</option>${visible.map(baie => `<option value="${esc(baie.id)}">${esc(baie.name || baie.nom || baie.id)}</option>`).join('')}`;
  if (selectedBaieId != null && visible.some(baie => String(baie.id) === String(selectedBaieId))) {
    form.baieId.value = String(selectedBaieId);
  }
}

function installCanonicalSubmit({ form, modal, manager, existing, notifications }) {
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const data = {
      name:values.name,
      type:values.type,
      categorie:values.categorie,
      marque:values.marque,
      modele:values.modele,
      numSerie:values.numSerie,
      immoNumber:values.immoNumber,
      statut:values.statut,
      roomId:normalizeRelationId(values.roomId),
      baieId:normalizeRelationId(values.baieId),
      ipAddress:values.ipAddress,
      grilleINOUT:values.grilleINOUT,
      installDate:form.installDate.value,
      garantieDate:form.garantieDate.value,
      notes:form.notes.value,
      images:[]
    };

    // Le panneau « Ports de l'équipement » installe son propre gestionnaire de soumission,
    // que celui-ci remplace. Sans cette lecture, la charge utile ne contenait aucune clé
    // `ports` : le port ajouté par l'utilisateur était perdu en silence, la garde
    // d'écriture le remplaçant par la valeur déjà enregistrée. D'où le « 0 % d'équipements
    // avec ports documentés » affiché par les Rapports — et, sans ports, aucun câble ni
    // schéma possible.
    const portsPanel = modal.querySelector('.equipment-ports-editor');
    if (typeof portsPanel?.resolvePortsForSave === 'function') {
      // Même voie de résolution que l'éditeur historique : un port existant dont le numéro
      // a été vidé, ou un port raccordé à un câble, bloque l'enregistrement au lieu de
      // disparaître en silence.
      const resolved = await portsPanel.resolvePortsForSave();
      if (resolved.errors.length) {
        notifications.showNotification(resolved.errors[0], 'warning');
        return null;
      }
      data.ports = resolved.ports;
    } else if (typeof portsPanel?.currentPorts === 'function') {
      data.ports = portsPanel.currentPorts().filter(port => String(port?.number ?? '').trim());
    }

    // Les photos DÉJÀ enregistrées sont reprises d'abord : téléverser un nouveau fichier
    // ne doit pas effacer celles qui existent. L'ancienne branche `else` les conservait
    // seulement quand aucun fichier n'était ajouté — ajouter une photo faisait donc
    // disparaître toutes les précédentes.
    if (Array.isArray(existing?.images)) data.images = [...existing.images];
    if (form.images?.files?.length) {
      for (const file of form.images.files) data.images.push(await manager.readFile(file));
    }
    // Une adresse d'image constructeur, saisie à la main.
    //
    // C'est le chemin qui manquait : le catalogue porte des visuels officiels pour
    // certains modèles, mais pas pour ceux que 2M possède. Sans champ pour la coller, une
    // adresse trouvée sur le site du constructeur n'avait nulle part où être enregistrée.
    const adresse = String(form.imageUrl?.value || '').trim();
    if (adresse) {
      if (!/^https:\/\//i.test(adresse)) {
        notifications.showNotification("L'adresse de l'image doit commencer par https://", 'warning');
        return;
      }
      // On REMPLACE l'ancienne adresse distante au lieu d'en empiler une seconde :
      // modifier l'URL trois fois laisserait sinon trois visuels concurrents.
      data.images = data.images.filter(item => !/^https?:\/\//i.test(String(item || '')));
      data.images.push(adresse);
    } else if (Array.isArray(existing?.images)) {
      // Champ vidé volontairement : l'adresse distante est retirée, les photos téléversées
      // restent.
      data.images = data.images.filter(item => !/^https?:\/\//i.test(String(item || '')));
    }

    data.qr = await generateQR(data.numSerie);
    data.createdAt = existing?.createdAt || new Date();
    data.updatedAt = new Date();
    if (existing?.id != null) data.id = existing.id;

    const savedId = await db.save('equipments', data);
    notifications.showNotification('Enregistré avec succès', 'success');
    modal.remove();
    window.dispatchEvent(new CustomEvent('equipment-editor-saved', {
      detail:{ equipmentId:savedId, mode:existing ? 'edit' : 'create' }
    }));
    manager.refreshList();
    return savedId;
  };
}

export async function openCanonicalEquipmentEditor({
  equipmentId = null,
  equipment = null,
  roomId = null,
  baieId = null,
  notifications = null
} = {}) {
  const user = getCurrentUser();
  const existing = equipment || (equipmentId != null
    ? await db.get('equipments', db.normalizeKey ? db.normalizeKey(equipmentId) : equipmentId).catch(() => null)
    : null);
  const action = existing ? 'edit' : 'create';
  const notifier = notificationAdapter(notifications);
  if (!PermissionManager.check(user, 'equipments', action)) {
    notifier.showNotification(`Action équipement non autorisée (${action}).`, 'error');
    return null;
  }

  document.querySelectorAll('#eq-modal').forEach(modal => modal.remove());
  const manager = new Equipements(notifier);
  // L'éditeur peut être ouvert depuis la carte, une Fiche 360 ou une future vue
  // Digital Twin sans supposer que #admin-content existe. Le rafraîchissement des listes
  // est porté par `equipment-editor-saved`, émis à l'enregistrement et déjà écouté par
  // `equipment-component-integration.js` : un second signal propre à ce service serait un
  // événement que personne n'entend — un fil qui pend, comme il en existait treize.
  manager.refreshList = () => {};

  await manager.showEquipementModal(existing || null);
  const modal = document.getElementById('eq-modal');
  const form = document.getElementById('eq-form');
  if (!modal || !form) return null;

  form.baieId?.removeAttribute('required');
  // Une adresse déjà enregistrée doit se relire dans son champ, sinon la rouvrir puis
  // enregistrer la ferait disparaître. Seules les adresses http(s) sont reprises : les
  // photos téléversées sont des `data:` de plusieurs kilo-octets, illisibles dans un champ.
  if (form.imageUrl && Array.isArray(existing?.images)) {
    const distante = existing.images.find(item => /^https?:\/\//i.test(String(item || '')));
    if (distante) form.imageUrl.value = distante;
  }
  if (!existing && roomId != null && form.roomId) form.roomId.value = String(roomId);
  const desiredBaieId = existing?.baieId ?? baieId;
  await fillBaiesForRoom(form, desiredBaieId);
  form.roomId?.addEventListener('change', () => fillBaiesForRoom(form, null).catch(() => {}));
  installCanonicalSubmit({ form, modal, manager, existing, notifications:notifier });

  const heading = modal.querySelector('#modal-title-eq');
  if (heading) heading.textContent = existing ? 'Modifier l’équipement' : 'Ajouter un équipement';
  modal.dataset.editorSource = 'canonical-service';
  if (roomId != null) modal.dataset.prefillRoomId = String(roomId);
  if (baieId != null) modal.dataset.prefillBaieId = String(baieId);
  return { modal, form, manager, equipment:existing };
}

if (typeof window !== 'undefined') {
  window.EquipmentEditorService = Object.freeze({
    version:EQUIPMENT_EDITOR_SERVICE_VERSION,
    open:openCanonicalEquipmentEditor
  });
}
