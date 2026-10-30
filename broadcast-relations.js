import { db } from './db.js';
import AdminUI from './admin-ui.js';
import Equipements from './equipements.js';
import WallManager from './wall-manager.js';
import openInteractiveMap from './interactive-map.js';
import { getCurrentUser } from './security.js';
import { PermissionManager } from './permissions.js';
import { CABLE_TYPES, PORT_TYPES } from './broadcast-ports-cables.js';
import { normalizePorts, normalizeCableRecord, portCanSource, portCanDestination, primaryCableRoomId } from './connectivity-contract.js';
import { resolveCableEndpoint, cablesForEquipment, endpointBelongsToEquipment } from './cable-endpoint-contract.js';
import { cableAbilitiesFromContext, cableDenialReason, cableZoneGrantedSomewhere, cableZonePermissionFor,
  cableRecordDenialReason, cableRecordMutationAllowed } from './cable-permissions-contract.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normalizeId = value => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
};
const normalizeCable = cable => normalizeCableRecord(cable);

/*
 * LES EXTRÉMITÉS PASSENT PAR LEUR CONTRAT — `cable-endpoint-contract.js`.
 *
 * Cette page disait « Élément introuvable » dans TROIS cas que rien ne distinguait :
 * l'entité supprimée, l'extrémité que le serveur a retirée parce qu'elle est hors
 * périmètre, et le composant interne — que la recherche cherchait dans la liste des
 * équipements, où il n'est jamais. Un seul message pour trois faits, et faux dans deux
 * cas sur trois.
 *
 * Les helpers reçoivent donc le CÂBLE et le CÔTÉ, non plus un couple type/identifiant :
 * le marqueur de protection et le parent du composant ne vivent que sur le câble.
 */
const flattenComponents = equipments => (Array.isArray(equipments) ? equipments : []).flatMap(equipment =>
  (Array.isArray(equipment?.components) ? equipment.components : []).map(component => ({
    ...component,
    parentEquipmentId: equipment.id,
    parentEquipmentName: equipment.name || equipment.nom || `#${equipment.id}`,
    roomId: equipment.roomId ?? null
  })));

const endpointLabel = (cable, side, equipments, screens, components) =>
  resolveCableEndpoint(cable, side, { equipments, screens, components }).label;

const endpointRoomId = (cable, side, equipments, screens, components) =>
  resolveCableEndpoint(cable, side, { equipments, screens, components }).entity?.roomId ?? null;

/* Le port RÉELLEMENT au bout du câble. Une extrémité protégée n'en expose aucun. */
const endpointPortLabel = (cable, side, equipments, screens, components) => {
  const bout = resolveCableEndpoint(cable, side, { equipments, screens, components });
  return bout.port ? `${bout.port.number} · ${bout.port.type}` : '—';
};

/*
 * LES PORTS D'UNE EXTRÉMITÉ EN COURS DE SAISIE.
 *
 * Le formulaire manipule un type et un identifiant choisis dans des listes, pas un câble
 * enregistré : on construit un câble MINIMAL pour que la saisie obéisse exactement à la
 * même règle d'identité que l'affichage.
 */
const portsForSelection = (type, id, equipments, screens) =>
  normalizePorts(resolveCableEndpoint(
    { sourceType: type, sourceId: id }, 'source', { equipments, screens, components: [] }
  ).entity?.ports);
const compatiblePorts = (ports, side) => ports.filter(port => {
  if (side === 'source') return portCanSource(port);
  return portCanDestination(port);
});

/*
 * LE DROIT DE TOUCHER UN CÂBLE SE DEMANDE, IL NE SE DEVINE PAS.
 *
 * Cette page offrait « Ajouter », « Modifier » et « Supprimer » à tout le monde : la seule
 * barrière était l'API, atteinte APRÈS le geste — et `db.save`/`db.delete` écrivent
 * d'abord dans le magasin local, si bien qu'un refus du serveur arrivait sur une
 * modification déjà visible à l'écran.
 *
 * La décision vient de `cable-permissions-contract.js` : plafond de rôle emprunté aux
 * ÉQUIPEMENTS **et** habilitation de zone `cable.read`/`cable.edit`. Les deux, toujours.
 *
 * ET LE BOUTON CACHÉ N'EST PAS UNE AUTORISATION : chaque gestionnaire redemande la même
 * décision avant d'écrire. Masquer ne protège que la vue ; c'est le refus au moment du
 * geste qui protège la donnée.
 */
async function chargerContexteAcces() {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const response = await fetch('/api/access/context', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

/** Le refus, nommé. Deux causes distinctes méritent deux phrases distinctes. */
const MESSAGE_REFUS = Object.freeze({
  ROLE_ACTION_FORBIDDEN: 'Votre rôle ne permet pas cette action sur les câbles.',
  ZONE_FORBIDDEN: 'Vous n’avez pas l’habilitation de câblage sur votre périmètre.',
  // Ni le rôle ni l'habilitation ne sont en cause : c'est CE câble qui sort du périmètre.
  // On dit ce qui manque sans décrire l'autre côté.
  ENDPOINT_OUT_OF_SCOPE: 'Une extrémité de ce câble est hors de votre périmètre : sa modification revient à la zone qui la détient.',
  UNKNOWN_ACTION: 'Action inconnue sur les câbles.'
});

class CableRelationsPage {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { search: '', category: '', status: '' };
    // `undefined` = jamais demandé ; `null` = demandé sans réponse exploitable.
    this.accessContext = undefined;
    this.droits = null;
  }

  /*
   * Les droits sont relus à chaque rendu, mais le contexte n'est demandé qu'UNE fois :
   * la page se redessine à chaque frappe dans la recherche, et une requête réseau par
   * caractère ferait payer la saisie sans rien apprendre de nouveau.
   */
  async chargerDroits() {
    if (this.accessContext === undefined) this.accessContext = await chargerContexteAcces();
    this.droits = cableAbilitiesFromContext(getCurrentUser(), this.accessContext);
    return this.droits;
  }

  /**
   * Le garde-fou du GESTE, pas celui de la vue.
   *
   * Rend `true` si l'acte est permis ; sinon prévient avec la cause exacte et rend `false`.
   */
  autorise(action) {
    const user = getCurrentUser();
    const zone = cableZonePermissionFor(action);
    const cause = cableDenialReason(user, action, {
      zoneAccorde: zone === null ? true : cableZoneGrantedSomewhere(this.accessContext, zone)
    });
    if (!cause) return true;
    this.notifications?.showNotification(MESSAGE_REFUS[cause] || 'Action refusée.', 'error');
    return false;
  }

  /**
   * LE GARDE-FOU DE L'ENREGISTREMENT — celui qui doit passer avant toute écriture.
   *
   * `autorise` répond « cet utilisateur édite-t-il des câbles ? ». Ici on demande
   * « édite-t-il CELUI-CI ? », ce qui n'est pas la même question : le serveur exige
   * l'habilitation sur TOUTES les zones que le câble touche. Mesuré — un chef habilité sur
   * la seule STC obtenait 403 ZONE_FORBIDDEN sur un câble STC→RF1, après que `db.save` eut
   * déjà écrit en local.
   */
  autoriseSur(action, cable) {
    const cause = cableRecordDenialReason(getCurrentUser(), action, cable, this.accessContext);
    if (!cause) return true;
    this.notifications?.showNotification(MESSAGE_REFUS[cause] || 'Action refusée.', 'error');
    return false;
  }

  /** Ce que cet utilisateur peut faire sur CE câble — pour composer la ligne du tableau. */
  droitsSur(cable) {
    const user = getCurrentUser();
    return {
      edit: cableRecordMutationAllowed(user, 'edit', cable, this.accessContext),
      delete: cableRecordMutationAllowed(user, 'delete', cable, this.accessContext)
    };
  }

  async loadData() {
    const [rawCables, equipments, screens, rooms, baies, walls] = await Promise.all([
      db.getAll('cables'), db.getAll('equipments'), db.getAll('screens'),
      db.getAll('rooms'), db.getAll('baies'), db.getAll('walls')
    ]);
    const cables = rawCables.map(normalizeCable);
    return { cables, equipments, screens, rooms, baies, walls, components: flattenComponents(equipments) };
  }

  /*
   * CONSULTER N'ÉCRIT PAS. (résidu antérieur à ce lot, mesuré puis retiré)
   * ------------------------------------------------------------------
   * `render()` appelait ici une « normalisation des enregistrements hérités » qui faisait
   * un `db.save('cables', …)` : ouvrir la page, taper dans la recherche ou changer un
   * filtre persistait, et `cables` étant un magasin synchronisé, la charge partait au
   * serveur.
   *
   * Ce que la mesure a montré : la migration qu'elle visait n'a plus rien à faire —
   * `loadData()` normalise déjà chaque câble EN MÉMOIRE, si bien qu'un vrai câble hérité
   * (anciens `sourceEquipmentId`/`destinationScreenId`) ressort complet et passe la
   * condition sans être écrit. Le SEUL enregistrement qu'elle réécrivait encore était le
   * câble dont le serveur a délibérément retiré une extrémité hors périmètre : privé de
   * `destinationId`, il échouait au test et repartait vers le serveur amputé de sa
   * destination et de son port. Une consultation pouvait donc effacer la donnée qu'elle
   * n'avait pas le droit de voir.
   *
   * La compatibilité de LECTURE est conservée telle quelle. Une migration persistante, si
   * elle redevient nécessaire, sera un acte d'administration explicite — jamais un effet
   * de bord du rendu.
   */

  async render() {
    const droits = await this.chargerDroits();
    if (!droits.view) {
      // Refuser sans expliquer laisse croire à une panne. On nomme ce qui manque, sans
      // décrire le périmètre d'autrui ni ce qu'il contient.
      return `<div class="card cable-inventory-card relation-cables-card"><div class="cable-empty">
        <i class="fas fa-lock"></i><strong>Câblage non accessible</strong>
        <span>${esc(MESSAGE_REFUS[cableDenialReason(getCurrentUser(), 'view', { zoneAccorde: cableZoneGrantedSomewhere(this.accessContext, 'cable.read') })] || 'Accès refusé.')}</span>
      </div></div>`;
    }
    const { cables, equipments, screens, components } = await this.loadData();
    const filtered = cables.filter(cable => {
      const source = endpointLabel(cable, 'source', equipments, screens, components);
      const destination = endpointLabel(cable, 'destination', equipments, screens, components);
      const haystack = [cable.reference, cable.category, cable.type, source, destination, cable.notes].join(' ').toLowerCase();
      return (!this.filters.search || haystack.includes(this.filters.search.toLowerCase())) &&
        (!this.filters.category || cable.category === this.filters.category) &&
        (!this.filters.status || cable.status === this.filters.status);
    });

    const portLabel = (cable, side) => endpointPortLabel(cable, side, equipments, screens, components);

    return `<div class="card cable-inventory-card relation-cables-card">
      <div class="card-header">
        <div><h2>Gestion des câbles & relations</h2><p class="section-subtitle">Un équipement peut être relié à plusieurs équipements et plusieurs écrans, port par port.</p></div>
        ${droits.create ? '<button class="btn" id="add-cable"><i class="fas fa-plus"></i> Ajouter une liaison</button>' : ''}
      </div>
      <div class="relation-summary">
        <span><b>${equipments.length}</b><small>Équipements</small></span>
        <span><b>${screens.length}</b><small>Écrans</small></span>
        <span><b>${cables.length}</b><small>Liaisons enregistrées</small></span>
      </div>
      <div class="filters-container cable-filters">
        <input id="cable-search" class="form-control" placeholder="Recherche câble, équipement, écran…" value="${esc(this.filters.search)}">
        <select id="cable-category" class="form-control"><option value="">Catégorie: Toutes</option>${Object.keys(CABLE_TYPES).map(value => `<option value="${esc(value)}" ${this.filters.category === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>
        <select id="cable-status" class="form-control"><option value="">Statut: Tous</option>${['Connecté','Réserve','Déconnecté','À vérifier'].map(value => `<option value="${value}" ${this.filters.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select>
      </div>
      <div class="cable-table-wrap"><table class="tableau cable-table"><thead><tr>
        <th>Référence</th><th>Catégorie</th><th>Type</th><th>Source</th><th>Port source</th><th>Destination</th><th>Port destination</th><th>Longueur</th><th>Statut</th><th>Actions</th>
      </tr></thead><tbody>
        ${filtered.length ? filtered.map(cable => `<tr>
          <td><strong>${esc(cable.reference || cable.id)}</strong></td><td>${esc(cable.category || '—')}</td><td>${esc(cable.type || '—')}</td>
          <td><span class="endpoint-badge ${cable.sourceType}">${esc(endpointLabel(cable, 'source', equipments, screens, components))}</span></td>
          <td><span class="cable-port-pill">${esc(portLabel(cable, 'source'))}</span></td>
          <td><span class="endpoint-badge ${cable.destinationType}">${esc(endpointLabel(cable, 'destination', equipments, screens, components))}</span></td>
          <td><span class="cable-port-pill">${esc(portLabel(cable, 'destination'))}</span></td>
          <td>${esc(cable.length || '—')}</td><td><span class="cable-status">${esc(cable.status || 'Connecté')}</span></td>
          <td class="relation-actions"><button class="btn-icon locate-cable" data-id="${esc(cable.id)}" title="Afficher sur la carte"><i class="fas fa-map-marker-alt"></i></button>${/* chaque ligne décide pour elle-même : un câble hors périmètre n'offre pas un bouton que le serveur refusera */''}${this.droitsSur(cable).edit ? `<button class="btn-icon edit-cable" data-id="${esc(cable.id)}" title="Modifier"><i class="fas fa-edit"></i></button>` : ''}${this.droitsSur(cable).delete ? `<button class="btn-icon delete-cable" data-id="${esc(cable.id)}" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="10"><div class="cable-empty"><i class="fas fa-project-diagram"></i><strong>Aucune liaison enregistrée</strong><span>Ajoutez une liaison Équipement ↔ Équipement ou Équipement ↔ Écran.</span></div></td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  async afterRender() {
    document.getElementById('add-cable')?.addEventListener('click', () => { if (this.autorise('create')) this.openAddForm(); });
    document.getElementById('cable-search')?.addEventListener('input', event => { this.filters.search = event.target.value; this.refresh(); });
    document.getElementById('cable-category')?.addEventListener('change', event => { this.filters.category = event.target.value; this.refresh(); });
    document.getElementById('cable-status')?.addEventListener('change', event => { this.filters.status = event.target.value; this.refresh(); });
    document.querySelectorAll('.edit-cable').forEach(button => button.onclick = async () => {
      const cable = await db.get('cables', button.dataset.id);
      if (!this.autoriseSur('edit', cable)) return;
      this.openAddForm(cable);
    });
    document.querySelectorAll('.delete-cable').forEach(button => button.onclick = async () => {
      // La décision porte sur l'enregistrement, et elle précède `db.delete` — qui supprime
      // EN LOCAL D'ABORD : après lui, le refus du serveur arrive sur une ligne déjà disparue.
      const cable = await db.get('cables', button.dataset.id);
      if (!this.autoriseSur('delete', cable)) return;
      if (!confirm('Supprimer cette liaison ?')) return;
      await db.delete('cables', button.dataset.id);
      this.notifications?.showNotification('Liaison supprimée.', 'success');
      await this.refresh();
    });
    document.querySelectorAll('.locate-cable').forEach(button => button.onclick = async () => this.openOnMap(await db.get('cables', button.dataset.id)));
  }

  async refresh() {
    const container = document.getElementById('admin-content');
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  }

  async openAddForm(rawCable = null) {
    // Le formulaire est le dernier endroit avant l'écriture : c'est ici que le refus doit
    // tenir même si le bouton a été atteint autrement.
    if (!(rawCable ? this.autoriseSur('edit', rawCable) : this.autorise('create'))) return;
    document.getElementById('cable-modal')?.remove();
    const { equipments, screens } = await this.loadData();
    const cable = rawCable ? normalizeCable(rawCable) : null;
    const categories = Object.keys(CABLE_TYPES);
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.id = 'cable-modal';
    modal.innerHTML = `<div class="modal-content cable-modal-content relation-modal"><button type="button" class="modal-x" aria-label="Fermer">×</button>
      <h3>${cable ? 'Modifier' : 'Ajouter'} une liaison</h3>
      <p class="relation-modal-help">Choisissez le type d'élément, l'élément puis son port. Une même source peut avoir plusieurs liaisons enregistrées.</p>
      <form id="cable-form" class="cable-form"><div class="form-grid">
        <label>Référence câble<input name="reference" required value="${esc(cable?.reference || `CAB-${new Date().getFullYear()}-`)}"></label>
        <label>Catégorie<select name="category" required>${categories.map(value => `<option value="${esc(value)}" ${cable?.category === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>
        <label>Type de câble<select name="type" required></select></label>
        <label>Statut<select name="status">${['Connecté','Réserve','Déconnecté','À vérifier'].map(value => `<option value="${value}" ${cable?.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <fieldset class="endpoint-fieldset"><legend>Source</legend>
          <label>Type de source<select name="sourceType"><option value="equipment" ${cable?.sourceType !== 'screen' ? 'selected' : ''}>Équipement</option><option value="screen" ${cable?.sourceType === 'screen' ? 'selected' : ''}>Écran</option></select></label>
          <label>Source<select name="sourceId" required></select></label><label>Port source<select name="sourcePortId" required></select></label>
        </fieldset>
        <fieldset class="endpoint-fieldset"><legend>Destination</legend>
          <label>Type de destination<select name="destinationType"><option value="equipment" ${cable?.destinationType !== 'screen' ? 'selected' : ''}>Équipement</option><option value="screen" ${cable?.destinationType === 'screen' ? 'selected' : ''}>Écran</option></select></label>
          <label>Destination<select name="destinationId" required></select></label><label>Port destination<select name="destinationPortId" required></select></label>
        </fieldset>
        <label>Longueur<input name="length" placeholder="ex: 15 m" value="${esc(cable?.length || '')}"></label>
        <label class="span-2">Notes<textarea name="notes" placeholder="Signal, cheminement, patch, secours…">${esc(cable?.notes || '')}</textarea></label>
      </div><div class="modal-actions"><button type="button" class="btn gray cancel-cable">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div></form></div>`;
    document.body.appendChild(modal);
    const form = modal.querySelector('#cable-form');

    const listForType = type => type === 'screen' ? screens : equipments;
    const updateEntities = (side, selectedId = null) => {
      const type = form[`${side}Type`].value;
      const select = form[`${side}Id`];
      const list = listForType(type);
      select.innerHTML = `<option value="">Sélectionner</option>${list.map(item => `<option value="${item.id}" ${String(selectedId) === String(item.id) ? 'selected' : ''}>${esc(item.name || item.nom || `#${item.id}`)}</option>`).join('')}`;
      updatePorts(side, side === 'source' ? cable?.sourcePortId : cable?.destinationPortId);
    };
    const updatePorts = (side, selectedPortId = null) => {
      const type = form[`${side}Type`].value;
      const id = form[`${side}Id`].value;
      const ports = compatiblePorts(portsForSelection(type, id, equipments, screens), side);
      const select = form[`${side}PortId`];
      select.innerHTML = `<option value="">${ports.length ? 'Sélectionner un port' : type === 'screen' ? "Aucun port — configurez l'écran dans Mur d'images" : 'Aucun port configuré'}</option>${ports.map(port => `<option value="${esc(port.id)}" ${selectedPortId === port.id ? 'selected' : ''}>${esc(port.number)} — ${esc(port.type)} (${esc(port.direction)})${port.label ? ` · ${esc(port.label)}` : ''}</option>`).join('')}`;
    };
    const updateTypes = () => {
      const list = CABLE_TYPES[form.category.value] || [];
      form.type.innerHTML = list.map(type => `<option value="${esc(type)}" ${cable?.type === type ? 'selected' : ''}>${esc(type)}</option>`).join('');
    };

    updateTypes();
    updateEntities('source', cable?.sourceId);
    updateEntities('destination', cable?.destinationId);
    form.category.onchange = updateTypes;
    form.sourceType.onchange = () => updateEntities('source');
    form.destinationType.onchange = () => updateEntities('destination');
    form.sourceId.onchange = () => updatePorts('source');
    form.destinationId.onchange = () => updatePorts('destination');
    modal.querySelector('.modal-x').onclick = modal.querySelector('.cancel-cable').onclick = () => modal.remove();

    form.onsubmit = async event => {
      event.preventDefault();
      if (!(cable ? this.autoriseSur('edit', cable) : this.autorise('create'))) return;
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.sourceId || !values.destinationId || !values.sourcePortId || !values.destinationPortId) {
        return this.notifications?.showNotification('Sélectionnez la source, la destination et les deux ports.', 'warning');
      }
      if (values.sourceType === values.destinationType && values.sourceId === values.destinationId && values.sourcePortId === values.destinationPortId) {
        return this.notifications?.showNotification('La source et la destination ne peuvent pas être le même port.', 'warning');
      }
      const sourcePorts = portsForSelection(values.sourceType, values.sourceId, equipments, screens);
      const destinationPorts = portsForSelection(values.destinationType, values.destinationId, equipments, screens);
      const sourcePort = sourcePorts.find(port => port.id === values.sourcePortId);
      const destinationPort = destinationPorts.find(port => port.id === values.destinationPortId);
      if (!sourcePort || !destinationPort) return this.notifications?.showNotification('Un des ports sélectionnés est introuvable.', 'error');
      if (!['OUT','IN/OUT'].includes(sourcePort.direction) || !['IN','IN/OUT'].includes(destinationPort.direction)) {
        return this.notifications?.showNotification('Sens de ports incompatible : utilisez OUT/IN-OUT vers IN/IN-OUT.', 'warning');
      }
      const record = {
        ...cable, reference: values.reference.trim(), category: values.category, type: values.type, status: values.status,
        length: values.length.trim(), notes: values.notes.trim(), id: cable?.id || makeId('CAB'),
        sourceType: values.sourceType, sourceId: normalizeId(values.sourceId), sourcePortId: values.sourcePortId,
        destinationType: values.destinationType, destinationId: normalizeId(values.destinationId), destinationPortId: values.destinationPortId,
        // Cache : la salle de la source, ou celle de la destination si la source n'en a
        // pas — au lieu d'un `null` qui laissait le câble sans salle du tout.
        roomId: primaryCableRoomId({
          sourceType:values.sourceType, sourceId:values.sourceId,
          destinationType:values.destinationType, destinationId:values.destinationId
        }, { equipments, screens }),
        createdAt: cable?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      delete record.sourceEquipmentId; delete record.destinationEquipmentId; delete record.sourceScreenId; delete record.destinationScreenId;
      if (record.sourceType === 'equipment') record.sourceEquipmentId = record.sourceId; else record.sourceScreenId = record.sourceId;
      if (record.destinationType === 'equipment') record.destinationEquipmentId = record.destinationId; else record.destinationScreenId = record.destinationId;
      await db.save('cables', record);
      this.notifications?.showNotification('Liaison enregistrée et persistée.', 'success');
      modal.remove();
      await this.refresh();
    };
    modal.style.display = 'block';
  }

  async openOnMap(rawCable) {
    const cable = normalizeCable(rawCable || {});
    const { equipments, screens, rooms, baies, walls, components } = await this.loadData();
    const sourceRoomId = endpointRoomId(cable, 'source', equipments, screens, components);
    const destinationRoomId = endpointRoomId(cable, 'destination', equipments, screens, components);
    const focusRoomId = sourceRoomId ?? destinationRoomId;
    if (focusRoomId != null) await db.setCurrentRoomId(focusRoomId);
    const user = getCurrentUser();
    openInteractiveMap({ rooms, baies, equipments, walls, user, notifications: this.notifications,
      onOpenWall: async roomId => { await db.setCurrentRoomId(roomId); window.location.hash = '#/walls'; }
    });
    const sourceLabel = endpointLabel(cable, 'source', equipments, screens, components);
    const destinationLabel = endpointLabel(cable, 'destination', equipments, screens, components);
    const sourceRoom = rooms.find(room => String(room.id) === String(sourceRoomId));
    const destinationRoom = rooms.find(room => String(room.id) === String(destinationRoomId));
    const observer = new MutationObserver(() => {
      const modal = document.getElementById('map-modal');
      if (!modal || modal.querySelector('.relation-map-banner')) return;
      const banner = document.createElement('div'); banner.className = 'relation-map-banner';
      banner.innerHTML = `<i class="fas fa-project-diagram"></i><div><strong>${esc(cable.reference || 'Liaison')}</strong><span>${esc(sourceLabel)} → ${esc(destinationLabel)}</span><small>${esc(sourceRoom?.name || 'Salle source inconnue')} → ${esc(destinationRoom?.name || 'Salle destination inconnue')}</small></div>`;
      modal.appendChild(banner); observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }
}

const previousDeleteEquipment = db.deleteEquipmentSafely.bind(db);
db.deleteEquipmentSafely = async function deleteEquipmentRelationSafe(equipmentId) {
  const linked = (await this.getAll('cables')).map(normalizeCable).filter(cable =>
    (cable.sourceType === 'equipment' && String(cable.sourceId) === String(equipmentId)) ||
    (cable.destinationType === 'equipment' && String(cable.destinationId) === String(equipmentId))
  );
  if (linked.length) {
    const error = new Error(`${linked.length} liaison(s) utilisent encore cet équipement. Réaffectez-les avant la suppression.`);
    error.code = 'EQUIPMENT_HAS_RELATIONS'; throw error;
  }
  return previousDeleteEquipment(equipmentId);
};

const previousDeleteScreen = db.deleteScreenSafely.bind(db);
db.deleteScreenSafely = async function deleteScreenRelationSafe(screenId) {
  const linked = (await this.getAll('cables')).map(normalizeCable).filter(cable =>
    (cable.sourceType === 'screen' && String(cable.sourceId) === String(screenId)) ||
    (cable.destinationType === 'screen' && String(cable.destinationId) === String(screenId))
  );
  if (linked.length) {
    const error = new Error(`${linked.length} liaison(s) utilisent encore cet écran. Réaffectez-les avant la suppression.`);
    error.code = 'SCREEN_HAS_RELATIONS'; throw error;
  }
  return previousDeleteScreen(screenId);
};

const previousInitSections = AdminUI.prototype.initSections;
AdminUI.prototype.initSections = function initSectionsWithRelationCables() {
  const sections = previousInitSections.call(this);
  if (sections.cables) sections.cables.component = new CableRelationsPage(this.notifications);
  return sections;
};

const previousScreenEditor = WallManager.prototype.renderScreenEditor;
WallManager.prototype.renderScreenEditor = function renderScreenEditorWithPorts(screen) {
  previousScreenEditor.call(this, screen);
  const editor = document.getElementById('wall-editor');
  if (!editor) return;
  let ports = normalizePorts(screen.ports);
  const canEdit = PermissionManager.check(this.user, 'screens', 'edit');
  const section = document.createElement('section'); section.className = 'screen-ports-editor';
  const render = async () => {
    const cables = (await db.getAll('cables')).map(normalizeCable).filter(cable =>
      (cable.sourceType === 'screen' && String(cable.sourceId) === String(screen.id)) ||
      (cable.destinationType === 'screen' && String(cable.destinationId) === String(screen.id))
    );
    section.innerHTML = `<div class="screen-ports-head"><div><h4><i class="fas fa-plug"></i> Ports de l'écran</h4><p>Configurez les entrées/sorties avant de créer les câbles.</p></div>${canEdit ? '<button type="button" class="btn add-screen-port"><i class="fas fa-plus"></i> Ajouter un port</button>' : ''}</div>
      <div class="screen-port-list">${ports.length ? ports.map((port, index) => `<div class="screen-port-row" data-index="${index}"><input class="screen-port-number" value="${esc(port.number)}" ${canEdit ? '' : 'disabled'}><select class="screen-port-type" ${canEdit ? '' : 'disabled'}>${PORT_TYPES.map(type => `<option value="${esc(type)}" ${type === port.type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select><select class="screen-port-direction" ${canEdit ? '' : 'disabled'}><option ${port.direction === 'IN' ? 'selected' : ''}>IN</option><option ${port.direction === 'OUT' ? 'selected' : ''}>OUT</option><option ${port.direction === 'IN/OUT' ? 'selected' : ''}>IN/OUT</option></select>${canEdit ? '<button type="button" class="btn danger remove-screen-port"><i class="fas fa-trash"></i></button>' : ''}</div>`).join('') : '<div class="ports-empty">Aucun port configuré pour cet écran.</div>'}</div>
      <div class="screen-relations"><strong>${cables.length} liaison(s)</strong><button type="button" class="btn gray open-cables-section">Gérer les câbles</button></div>`;
    section.querySelector('.add-screen-port')?.addEventListener('click', () => { ports.push({ id: makeId('SPORT'), number: `IN ${ports.length + 1}`, type: 'BNC / SDI', direction: 'IN', label: '' }); render(); });
    section.querySelectorAll('.screen-port-row').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelector('.screen-port-number')?.addEventListener('input', event => { ports[index].number = event.target.value; });
      row.querySelector('.screen-port-type')?.addEventListener('change', event => { ports[index].type = event.target.value; });
      row.querySelector('.screen-port-direction')?.addEventListener('change', event => { ports[index].direction = event.target.value; });
      row.querySelector('.remove-screen-port')?.addEventListener('click', async () => {
        const linked = (await db.getAll('cables')).map(normalizeCable).some(cable => cable.sourcePortId === ports[index].id || cable.destinationPortId === ports[index].id);
        if (linked) return this.notify('Ce port est utilisé par une liaison. Réaffectez-la avant la suppression.', 'warning');
        ports.splice(index, 1); await render();
      });
    });
    section.querySelector('.open-cables-section')?.addEventListener('click', () => { window.location.hash = '#/cables'; });
    if (canEdit && ports.length) {
      const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary save-screen-ports'; save.textContent = 'Enregistrer les ports';
      save.onclick = async () => {
        const updated = { ...screen, ports: normalizePorts(ports), updatedAt: new Date().toISOString() };
        await db.save('screens', updated);
        const index = this.screens.findIndex(item => String(item.id) === String(screen.id)); if (index >= 0) this.screens[index] = updated;
        this.notify('Ports de l’écran enregistrés.', 'success');
      };
      section.querySelector('.screen-port-list').after(save);
    }
  };
  editor.appendChild(section); render();
};

const previousQuickView = Equipements.prototype.showQuickView;
Equipements.prototype.showQuickView = async function showQuickViewWithRelations(equipment) {
  await previousQuickView.call(this, equipment);
  const modal = document.getElementById('equip-quickview-modal');
  const content = modal?.querySelector('.modal-content'); if (!content) return;
  const [cables, equipments, screens] = await Promise.all([db.getAll('cables'), db.getAll('equipments'), db.getAll('screens')]);
  // Un câble branché sur une CARTE INTERNE est branché sur l'appareil : il appartient à
  // ses relations directes. Le filtre `sourceType === 'equipment'` l'en excluait.
  //
  // L'ensemble passé est CANONIQUE — tous les équipements, pas seulement celui-ci : c'est
  // ce qui permet au contrat de refuser d'attribuer un composant homonyme sans parent.
  const components = flattenComponents(equipments);
  const linked = cablesForEquipment(cables.map(normalizeCable), equipment.id, { components });
  const relations = document.createElement('section'); relations.className = 'equipment-relations-overview';
  relations.innerHTML = `<h4><i class="fas fa-network-wired"></i> Relations directes</h4>${linked.length ? `<ul>${linked.map(cable => {
    const fromSource = endpointBelongsToEquipment(cable, 'source', equipment.id, { components });
    const autre = fromSource ? 'destination' : 'source';
    return `<li><span>${esc(cable.reference || cable.id)}</span><b>${fromSource ? '→' : '←'} ${esc(endpointLabel(cable, autre, equipments, screens, components))}</b></li>`;
  }).join('')}</ul>` : '<p>Aucune liaison directe enregistrée.</p>'}`;
  content.appendChild(relations);
};

export { CableRelationsPage, normalizeCable };
