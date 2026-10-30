import { db } from './db.js';
import openInteractiveMap from './interactive-map.js';
import { resolveCableEndpoint, cablesForEquipment } from './cable-endpoint-contract.js';
import { getCurrentUser } from './security.js';
import { CableRelationsPage, normalizeCable } from './broadcast-relations.js';
import { CABLE_TYPES } from './broadcast-ports-cables.js';
import { normalizeComponents, normalizePortsExtended, PORT_BEHAVIORS } from './equipment-internals.js';
import { evaluateConnection, normalizeCableRecord, portCanSource, portCanDestination, PATH_ROLES } from './connectivity-contract.js';
import { compatibleCableTypes } from './equipment-port-template.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const normalizeId = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
};
const FLEXIBLE_BEHAVIORS = new Set(['patch','bidirectional','passive']);
const isFlexible = port => FLEXIBLE_BEHAVIORS.has(port?.behavior);
const canBeSource = port => portCanSource(port);
const canBeDestination = port => portCanDestination(port);
const behaviorLabel = value => PORT_BEHAVIORS.find(item => item.value === value)?.label || value || 'Fixe';

function flattenComponents(equipments) {
  return equipments.flatMap(equipment => normalizeComponents(equipment.components).map(component => ({
    ...component,
    parentEquipmentId: equipment.id,
    parentEquipmentName: equipment.name || equipment.nom || `#${equipment.id}`,
    roomId: equipment.roomId ?? null,
    baieId: equipment.baieId ?? null
  })));
}

/*
 * LA RÉSOLUTION D'UNE EXTRÉMITÉ VIT DANS SON CONTRAT — `cable-endpoint-contract.js`.
 *
 * Deux défauts fermés au passage :
 *   · un composant était cherché par son seul `componentId`, qui n'est unique que DANS son
 *     équipement parent : un câble vers EQ-B/slot-1 pouvait désigner EQ-A/slot-1 ;
 *   · une extrémité PROTÉGÉE tombait dans « Élément introuvable », disant que la donnée
 *     n'existe pas alors qu'elle existe et ne nous regarde pas.
 *
 * Les fonctions ci-dessous conservent leur signature — les appelants sont nombreux — mais
 * délèguent au contrat, qui reçoit le CÂBLE et non plus un couple type/identifiant :
 * lui seul porte le parent et le marqueur de protection.
 */
function endpointEntity(cable, side, equipments, screens, components) {
  return resolveCableEndpoint(cable, side, { equipments, screens, components }).entity;
}

function endpointLabel(cable, side, equipments, screens, components) {
  return resolveCableEndpoint(cable, side, { equipments, screens, components }).label;
}

function endpointPorts(cable, side, equipments, screens, components) {
  const entity = endpointEntity(cable, side, equipments, screens, components);
  return normalizePortsExtended(entity?.ports, 'fixed');
}

/*
 * LES PORTS D'UNE EXTRÉMITÉ EN COURS DE SAISIE.
 *
 * Le formulaire ne manipule pas un câble enregistré mais un type et un identifiant
 * choisis dans des listes. On passe donc par un câble MINIMAL, ce qui garantit que la
 * saisie obéit exactement à la même règle d'identité que l'affichage — y compris la
 * levée d'ambiguïté des composants homonymes, dont la liste déroulante porte le parent.
 */
function portsForSelection(type, id, parentEquipmentId, equipments, screens, components) {
  const fictif = { sourceType: type, sourceId: id, sourceParentEquipmentId: parentEquipmentId ?? null };
  return endpointPorts(fictif, 'source', equipments, screens, components);
}

/** Le parent d'un composant choisi dans la liste — sa seule identité désambiguïsante. */
function parentOfSelectedComponent(type, id, components) {
  if (type !== 'component') return null;
  const trouve = (Array.isArray(components) ? components : [])
    .filter(item => String(item?.id) === String(id));
  return trouve.length === 1 ? (trouve[0].parentEquipmentId ?? trouve[0].equipmentId ?? null) : null;
}

function endpointRoomId(type,id,equipments,screens,components) {
  const entity = endpointEntity(type,id,equipments,screens,components);
  return entity?.roomId ?? null;
}

function endpointParentEquipmentId(type,id,equipments,screens,components) {
  if (type === 'component') return endpointEntity(type,id,equipments,screens,components)?.parentEquipmentId ?? null;
  if (type === 'equipment') return normalizeId(id);
  return null;
}

function portText(port) {
  if (!port) return '—';
  const flexible = port.behavior && port.behavior !== 'fixed' ? ` · ${behaviorLabel(port.behavior)}` : '';
  return `${port.number} · ${port.type} · ${port.direction}${flexible}`;
}

const previousRender = CableRelationsPage.prototype.render;
CableRelationsPage.prototype.render = async function renderWithComponents() {
  /*
   * CETTE PAGE REMPLACE LE RENDU DE BASE : elle doit donc reprendre elle-même la décision
   * d'accès, sinon la surcharge rouvrirait en grand ce que la classe de base a fermé.
   * `chargerDroits` et `autorise` viennent de `broadcast-relations.js` et appliquent le
   * même contrat — plafond de rôle des équipements ET habilitation de câblage.
   */
  const droits = await this.chargerDroits();
  if (!droits.view) return previousRender.call(this);
  const { cables:rawCables, equipments, screens } = await this.loadData();
  const cables = rawCables.map(normalizeCable);
  const components = flattenComponents(equipments);
  const filtered = cables.filter(cable => {
    const source = endpointLabel(cable,'source',equipments,screens,components);
    const destination = endpointLabel(cable,'destination',equipments,screens,components);
    const haystack = [cable.reference,cable.category,cable.type,source,destination,cable.notes,cable.signalMode].join(' ').toLowerCase();
    return (!this.filters.search || haystack.includes(this.filters.search.toLowerCase())) &&
      (!this.filters.category || cable.category === this.filters.category) &&
      (!this.filters.status || cable.status === this.filters.status);
  });
  /*
   * Le port se lit sur l'extrémité RÉSOLUE : pour une extrémité protégée, le serveur a
   * déjà retiré `{side}PortId`, et il n'y a donc rien à afficher — surtout rien à deviner.
   */
  const portLabel = (cable, side) => {
    const bout = resolveCableEndpoint(cable, side, { equipments, screens, components });
    if (bout.state === 'protected') return '—';
    return portText(normalizePortsExtended(bout.entity?.ports, 'fixed').find(port => port.id === bout.portId));
  };
  return `<div class="card cable-inventory-card relation-cables-card">
    <div class="card-header"><div><h2>Gestion des câbles & relations</h2><p class="section-subtitle">Relations Équipement, Composant interne et Écran. Les ports de brassage peuvent être utilisés manuellement dans les deux sens.</p></div>${droits.create ? '<button class="btn" id="add-cable"><i class="fas fa-plus"></i> Ajouter une liaison</button>' : ''}</div>
    <div class="relation-summary"><span><b>${equipments.length}</b><small>Équipements</small></span><span><b>${components.length}</b><small>Composants internes</small></span><span><b>${screens.length}</b><small>Écrans</small></span><span><b>${cables.length}</b><small>Liaisons</small></span></div>
    <div class="filters-container cable-filters"><input id="cable-search" class="form-control" placeholder="Recherche câble, équipement, composant, écran…" value="${esc(this.filters.search)}"><select id="cable-category" class="form-control"><option value="">Catégorie: Toutes</option>${Object.keys(CABLE_TYPES).map(value => `<option value="${esc(value)}" ${this.filters.category===value?'selected':''}>${esc(value)}</option>`).join('')}</select><select id="cable-status" class="form-control"><option value="">Statut: Tous</option>${['Connecté','Réserve','Déconnecté','À vérifier'].map(value => `<option value="${value}" ${this.filters.status===value?'selected':''}>${value}</option>`).join('')}</select></div>
    <div class="cable-table-wrap"><table class="tableau cable-table"><thead><tr><th>Référence</th><th>Catégorie</th><th>Type</th><th>Source</th><th>Port source</th><th>Destination</th><th>Port destination</th><th>Mode</th><th>Statut</th><th>Actions</th></tr></thead><tbody>
      ${filtered.length ? filtered.map(cable => `<tr><td><strong>${esc(cable.reference || cable.id)}</strong></td><td>${esc(cable.category || '—')}</td><td>${esc(cable.type || '—')}</td><td><span class="endpoint-badge ${esc(cable.sourceType)}">${esc(endpointLabel(cable,'source',equipments,screens,components))}</span></td><td><span class="cable-port-pill">${esc(portLabel(cable,'source'))}</span></td><td><span class="endpoint-badge ${esc(cable.destinationType)}">${esc(endpointLabel(cable,'destination',equipments,screens,components))}</span></td><td><span class="cable-port-pill">${esc(portLabel(cable,'destination'))}</span></td><td>${esc(cable.signalMode || 'DIRECT')}</td><td><span class="cable-status">${esc(cable.status || 'Connecté')}</span></td><td class="relation-actions"><button class="btn-icon locate-cable" data-id="${esc(cable.id)}" title="Afficher sur la carte"><i class="fas fa-map-marker-alt"></i></button>${this.droitsSur(cable).edit ? `<button class="btn-icon edit-cable" data-id="${esc(cable.id)}" title="Modifier"><i class="fas fa-edit"></i></button>` : ''}${this.droitsSur(cable).delete ? `<button class="btn-icon delete-cable" data-id="${esc(cable.id)}" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}</td></tr>`).join('') : '<tr><td colspan="10"><div class="cable-empty"><i class="fas fa-project-diagram"></i><strong>Aucune liaison enregistrée</strong><span>Ajoutez une liaison entre équipements, composants internes ou écrans.</span></div></td></tr>'}
    </tbody></table></div>
  </div>`;
};

CableRelationsPage.prototype.openAddForm = async function openAddFormWithComponents(rawCable = null) {
  // Le bouton caché n'est pas une autorisation : le geste redemande la décision.
  if (!(rawCable ? this.autoriseSur('edit', rawCable) : this.autorise('create'))) return;
  document.getElementById('cable-modal')?.remove();
  const { equipments, screens } = await this.loadData();
  const components = flattenComponents(equipments);
  const cable = rawCable ? normalizeCable(rawCable) : null;
  const categories = Object.keys(CABLE_TYPES);
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'cable-modal';
  modal.innerHTML = `<div class="modal-content cable-modal-content relation-modal"><button type="button" class="modal-x" aria-label="Fermer">×</button>
    <h3>${cable ? 'Modifier' : 'Ajouter'} une liaison</h3>
    <p class="relation-modal-help">Une carte, un module ou un composant interne peut être un véritable point de connexion. Pour un PPV / patch panel, définissez le port « Réversible / brassage manuel » dans la fiche de l’équipement.</p>
    <form id="cable-form" class="cable-form"><div class="form-grid">
      <label>Référence câble<input name="reference" required value="${esc(cable?.reference || `CAB-${new Date().getFullYear()}-`)}"></label>
      <label>Catégorie<select name="category" required>${categories.map(value => `<option value="${esc(value)}" ${cable?.category===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>
      <label>Type de câble<select name="type" required></select></label>
      <small class="cable-compat-hint span-2">Choisissez les deux ports pour ne voir que les câbles réellement compatibles.</small>
      <label>Statut<select name="status">${['Connecté','Réserve','Déconnecté','À vérifier'].map(value => `<option value="${value}" ${cable?.status===value?'selected':''}>${value}</option>`).join('')}</select></label>
      <label>Mode du signal<select name="signalMode"><option value="DIRECT" ${!cable?.signalMode || cable?.signalMode==='DIRECT'?'selected':''}>Source → destination</option><option value="MANUAL_PATCH" ${cable?.signalMode==='MANUAL_PATCH'?'selected':''}>Brassage manuel / réversible</option><option value="BIDIRECTIONAL" ${cable?.signalMode==='BIDIRECTIONAL'?'selected':''}>Bidirectionnel</option><option value="PHYSICAL_ONLY" ${cable?.signalMode==='PHYSICAL_ONLY'?'selected':''}>Connexion physique — sens à confirmer</option></select></label>
      <label>Longueur<input name="length" placeholder="ex: 15 m" value="${esc(cable?.length || '')}"></label>
      <label>Rôle du chemin<select name="pathRole">${PATH_ROLES.map(role => `<option value="${role}" ${cable?.pathRole===role?'selected':''}>${({PROGRAM:'Programme',BACKUP:'Secours',MONITORING:'Monitoring',SYNC:'Synchronisation',AUDIO:'Audio',INTERCOM:'Intercom',OTHER:'Autre'})[role]}</option>`).join('')}</select></label>
      <label>Couleur physique<input name="physicalColor" placeholder="ex: bleu / rouge" value="${esc(cable?.physicalColor || '')}"></label>
      <fieldset class="endpoint-fieldset"><legend>Source</legend><label>Type<select name="sourceType"><option value="equipment">Équipement</option><option value="component">Composant interne</option><option value="screen">Écran</option></select></label><label>Source<select name="sourceId" required></select></label><label>Port source<select name="sourcePortId" required></select></label></fieldset>
      <fieldset class="endpoint-fieldset"><legend>Destination</legend><label>Type<select name="destinationType"><option value="equipment">Équipement</option><option value="component">Composant interne</option><option value="screen">Écran</option></select></label><label>Destination<select name="destinationId" required></select></label><label>Port destination<select name="destinationPortId" required></select></label></fieldset>
      <label class="span-2">Notes<textarea name="notes" placeholder="Signal, cheminement, patch, secours, repère PPV…">${esc(cable?.notes || '')}</textarea></label>
    </div><div class="modal-actions"><button type="button" class="btn gray cancel-cable">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div></form></div>`;
  document.body.appendChild(modal);
  const form = modal.querySelector('#cable-form');
  form.sourceType.value = ['equipment','component','screen'].includes(cable?.sourceType) ? cable.sourceType : 'equipment';
  form.destinationType.value = ['equipment','component','screen'].includes(cable?.destinationType) ? cable.destinationType : 'equipment';

  const listForType = type => type === 'screen' ? screens : type === 'component' ? components : equipments;
  const labelForOption = (type,item) => type === 'component' ? `${item.parentEquipmentName} › ${item.name || item.type}${item.slot ? ` · ${item.slot}` : ''}` : (item.name || item.nom || `#${item.id}`);
  const updateEntities = (side,selectedId=null) => {
    const type = form[`${side}Type`].value;
    const select = form[`${side}Id`];
    const list = listForType(type);
    select.innerHTML = `<option value="">Sélectionner</option>${list.map(item => `<option value="${esc(item.id)}" ${String(selectedId)===String(item.id)?'selected':''}>${esc(labelForOption(type,item))}</option>`).join('')}`;
    updatePorts(side, side === 'source' ? cable?.sourcePortId : cable?.destinationPortId);
  };
  const updatePorts = (side,selectedPortId=null) => {
    const type = form[`${side}Type`].value;
    const id = form[`${side}Id`].value;
    const allPorts = portsForSelection(type, id, parentOfSelectedComponent(type, id, components), equipments, screens, components);
    const ports = allPorts.filter(port => side === 'source' ? canBeSource(port) : canBeDestination(port));
    const select = form[`${side}PortId`];
    const emptyText = ports.length ? 'Sélectionner un port' : type === 'component' ? 'Aucun port sur ce composant' : 'Aucun port compatible/configuré';
    select.innerHTML = `<option value="">${emptyText}</option>${ports.map(port => `<option value="${esc(port.id)}" ${String(selectedPortId)===String(port.id)?'selected':''}>${esc(portText(port))}</option>`).join('')}`;
  };
  const selectedPort = side => {
    const values = { type:form[`${side}Type`].value, id:form[`${side}Id`].value, portId:form[`${side}PortId`].value };
    if (!values.id || !values.portId) return null;
    return portsForSelection(values.type, values.id, parentOfSelectedComponent(values.type, values.id, components), equipments, screens, components)
      .find(port => String(port.id) === String(values.portId)) || null;
  };
  // Tant que les deux ports ne sont pas choisis, on présente le catalogue complet.
  // Dès qu'ils le sont, on n'affiche que ce que le serveur accepterait, jugé par
  // le même moteur — aucune règle de compatibilité n'est réécrite ici.
  const updateTypes = () => {
    const category = form.category.value;
    const all = CABLE_TYPES[category] || [];
    const source = selectedPort('source'); const destination = selectedPort('destination');
    const verdicts = source && destination
      ? new Map(compatibleCableTypes(source, destination).filter(item => item.category === category).map(item => [item.type, item]))
      : null;
    const usable = verdicts ? all.filter(type => verdicts.get(type)?.usable) : all;
    const hint = form.querySelector('.cable-compat-hint');

    if (verdicts && !usable.length) {
      form.type.innerHTML = '<option value="">Aucun type compatible dans cette catégorie</option>';
      form.type.value = '';
      form.type.disabled = true;
    } else {
      form.type.disabled = false;
      form.type.innerHTML = usable.map(type => {
        const verdict = verdicts?.get(type);
        const suffix = verdict?.status === 'to-confirm' ? ' — à confirmer' : '';
        return `<option value="${esc(type)}" ${cable?.type===type?'selected':''}>${esc(type)}${suffix}</option>`;
      }).join('');
    }

    if (!hint) return;
    if (!verdicts) hint.textContent = 'Choisissez les deux ports pour ne voir que les câbles réellement compatibles.';
    else if (!usable.length) {
      const reason = [...verdicts.values()].flatMap(item => item.reasons)[0] || '';
      hint.textContent = `Aucun câble de la catégorie « ${category} » ne relie ces deux ports. ${reason}`;
    } else hint.textContent = `${usable.length} type(s) compatible(s) sur ${all.length} dans cette catégorie.`;
  };
  updateTypes(); updateEntities('source',cable?.sourceId); updateEntities('destination',cable?.destinationId);
  form.category.onchange = updateTypes;
  form.sourceType.onchange = () => updateEntities('source');
  form.destinationType.onchange = () => updateEntities('destination');
  form.sourceId.onchange = () => { updatePorts('source'); updateTypes(); };
  form.destinationId.onchange = () => { updatePorts('destination'); updateTypes(); };
  form.sourcePortId.onchange = updateTypes;
  form.destinationPortId.onchange = updateTypes;
  modal.querySelector('.modal-x').onclick = modal.querySelector('.cancel-cable').onclick = () => modal.remove();

  form.onsubmit = async event => {
    event.preventDefault();
    // Dernier point avant `db.save` : un formulaire resté ouvert ne doit pas écrire après
    // un changement d'habilitation.
    if (!(cable ? this.autoriseSur('edit', cable) : this.autorise('create'))) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.sourceId || !values.destinationId || !values.sourcePortId || !values.destinationPortId) return this.notifications?.showNotification('Sélectionnez la source, la destination et les deux ports.', 'warning');
    if (!values.type) return this.notifications?.showNotification('Aucun type de câble compatible n’est sélectionnable pour ces deux ports.', 'warning');
    if (values.sourceType === values.destinationType && values.sourceId === values.destinationId && values.sourcePortId === values.destinationPortId) return this.notifications?.showNotification('La source et la destination ne peuvent pas être le même port.', 'warning');
    const sourcePort = portsForSelection(values.sourceType, values.sourceId, parentOfSelectedComponent(values.sourceType, values.sourceId, components), equipments, screens, components).find(port => port.id === values.sourcePortId);
    const destinationPort = portsForSelection(values.destinationType, values.destinationId, parentOfSelectedComponent(values.destinationType, values.destinationId, components), equipments, screens, components).find(port => port.id === values.destinationPortId);
    if (!sourcePort || !destinationPort) return this.notifications?.showNotification('Un des ports sélectionnés est introuvable.', 'error');
    if (!canBeSource(sourcePort) || !canBeDestination(destinationPort)) return this.notifications?.showNotification('Sens incompatible. Pour un brassage manuel, passez le port concerné en « Réversible / brassage manuel » dans la fiche équipement.', 'warning');
    const compatibility = evaluateConnection({ sourcePort, destinationPort, cable:{ category:values.category, type:values.type, pathRole:values.pathRole } });
    if (['incompatible','requires-converter','requires-adapter'].includes(compatibility.status)) {
      const advice = [...compatibility.reasons, ...compatibility.suggestions].join(' ');
      return this.notifications?.showNotification(`Liaison refusée: ${advice}`, 'error');
    }
    const inferredPatch = isFlexible(sourcePort) || isFlexible(destinationPort);
    let record = {
      ...cable,
      id:cable?.id || makeId('CAB'),
      reference:values.reference.trim(), category:values.category, type:values.type, status:values.status,
      signalMode: inferredPatch && values.signalMode === 'DIRECT' ? 'MANUAL_PATCH' : values.signalMode,
      length:values.length.trim(), notes:values.notes.trim(), pathRole:values.pathRole, physicalColor:values.physicalColor.trim(),
      sourceType:values.sourceType, sourceId:normalizeId(values.sourceId), sourcePortId:values.sourcePortId,
      destinationType:values.destinationType, destinationId:normalizeId(values.destinationId), destinationPortId:values.destinationPortId,
      sourceParentEquipmentId:endpointParentEquipmentId(values.sourceType,values.sourceId,equipments,screens,components),
      destinationParentEquipmentId:endpointParentEquipmentId(values.destinationType,values.destinationId,equipments,screens,components),
      roomId:endpointRoomId(values.sourceType,values.sourceId,equipments,screens,components) ?? endpointRoomId(values.destinationType,values.destinationId,equipments,screens,components),
      createdAt:cable?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    record = normalizeCableRecord(record);
    record.compatibility = compatibility;
    if (compatibility.status === 'to-confirm') { record.status = 'À vérifier'; record.verificationStatus = 'to-confirm'; }
    delete record.sourceEquipmentId; delete record.destinationEquipmentId; delete record.sourceScreenId; delete record.destinationScreenId; delete record.sourceComponentId; delete record.destinationComponentId;
    if (record.sourceType === 'screen') record.sourceScreenId = record.sourceId;
    else if (record.sourceType === 'component') { record.sourceComponentId = record.sourceId; record.sourceEquipmentId = record.sourceParentEquipmentId; }
    else record.sourceEquipmentId = record.sourceId;
    if (record.destinationType === 'screen') record.destinationScreenId = record.destinationId;
    else if (record.destinationType === 'component') { record.destinationComponentId = record.destinationId; record.destinationEquipmentId = record.destinationParentEquipmentId; }
    else record.destinationEquipmentId = record.destinationId;
    await db.save('cables',record);
    this.notifications?.showNotification(inferredPatch ? 'Brassage / liaison réversible enregistré.' : 'Liaison enregistrée et persistée.', 'success');
    modal.remove(); await this.refresh();
  };
  modal.style.display = 'block';
};

CableRelationsPage.prototype.openOnMap = async function openComponentRelationOnMap(rawCable) {
  const cable = normalizeCable(rawCable || {});
  const { equipments, screens, rooms, baies, walls } = await this.loadData();
  const components = flattenComponents(equipments);
  const sourceRoomId = endpointRoomId(cable.sourceType,cable.sourceId,equipments,screens,components);
  const destinationRoomId = endpointRoomId(cable.destinationType,cable.destinationId,equipments,screens,components);
  const focusRoomId = sourceRoomId ?? destinationRoomId;
  if (focusRoomId != null) await db.setCurrentRoomId(focusRoomId);
  openInteractiveMap({ rooms,baies,equipments,walls,user:getCurrentUser(),notifications:this.notifications,onOpenWall:async roomId => { await db.setCurrentRoomId(roomId); window.location.hash = '#/walls'; } });
  const source = endpointLabel(cable,'source',equipments,screens,components);
  const destination = endpointLabel(cable,'destination',equipments,screens,components);
  const observer = new MutationObserver(() => {
    const mapModal = document.getElementById('map-modal');
    if (!mapModal || mapModal.querySelector('.relation-map-banner')) return;
    const banner = document.createElement('div'); banner.className = 'relation-map-banner';
    banner.innerHTML = `<i class="fas fa-project-diagram"></i><div><strong>${esc(cable.reference || 'Liaison')}</strong><span>${esc(source)} → ${esc(destination)}</span><small>${esc(cable.signalMode || 'DIRECT')}</small></div>`;
    mapModal.appendChild(banner); observer.disconnect();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(() => observer.disconnect(),15000);
};

const previousDeleteEquipmentSafely = db.deleteEquipmentSafely.bind(db);
db.deleteEquipmentSafely = async function deleteEquipmentWithInternalRelations(equipmentId) {
  const equipment = await this.get('equipments',equipmentId).catch(() => null);
  const componentIds = new Set(normalizeComponents(equipment?.components).map(component => String(component.id)));
  if (componentIds.size) {
    const linked = (await this.getAll('cables')).map(normalizeCable).filter(cable =>
      (cable.sourceType === 'component' && componentIds.has(String(cable.sourceId))) ||
      (cable.destinationType === 'component' && componentIds.has(String(cable.destinationId)))
    );
    if (linked.length) {
      const error = new Error(`${linked.length} liaison(s) utilisent encore un composant interne de cet équipement. Réaffectez-les avant la suppression.`);
      error.code = 'EQUIPMENT_COMPONENT_HAS_RELATIONS';
      throw error;
    }
  }
  return previousDeleteEquipmentSafely(equipmentId);
};

if (typeof window !== 'undefined') {
  window.ComponentRelations = Object.freeze({ flattenComponents, canBeSource, canBeDestination, flexibleBehaviors:[...FLEXIBLE_BEHAVIORS] });
}

export { flattenComponents, canBeSource, canBeDestination };
