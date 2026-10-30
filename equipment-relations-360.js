import { db } from './db.js';
import {
  buildRelationshipIndex,
  resolveEquipmentLocation,
  validateRouterPortPhysicalLink
} from './relationship-contract.js';
import { buildPlatformEntityGraph, directPlatformRelations } from './platform-entity-graph.js';
import { fullBreadcrumbPath, breadcrumbText } from './breadcrumb-contract.js';

export const EQUIPMENT_RELATIONS_360_VERSION = 2;

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const asArray = value => Array.isArray(value) ? value : [];
const same = (left, right) => left != null && right != null && String(left) === String(right);

/**
 * Le fil d'Ariane, en maillons cliquables.
 *
 * Le DERNIER maillon est l'appareil qu'on regarde : en faire un lien vers la liste des
 * équipements enverrait l'utilisateur ailleurs pour lui montrer là où il est déjà.
 */
function filArianeMarkup(chemin = []) {
  const maillons = asArray(chemin);
  if (!maillons.length) return '<strong>Emplacement non documenté</strong>';
  return `<nav class="ops-fil-ariane" aria-label="Emplacement">${maillons.map((maillon, index) => {
    const titre = `${esc(maillon.typeLabel || '')} · ${esc(maillon.label)}`;
    if (index === maillons.length - 1) {
      return `<span class="ops-crumb is-current" aria-current="page" title="${titre}">${esc(maillon.label)}</span>`;
    }
    // `#/section` et non `#/section/id` : la route à l'identifiant n'est pas encore servie
    // par les sections, et un lien qui promet plus qu'il ne tient est pire qu'un lien court.
    return `<a class="ops-crumb" href="#/${esc(maillon.section)}" data-section="${esc(maillon.section)}" data-entity-id="${esc(maillon.id)}" title="${titre}">${esc(maillon.label)}</a>`;
  }).join('<i class="ops-crumb-sep" aria-hidden="true">›</i>')}</nav>`;
}

function cableTouchesEquipment(cable, equipment) {
  return ['source','destination'].some(side => {
    const type = cable?.[`${side}Type`] || 'equipment';
    if (type === 'equipment') return same(cable?.[`${side}Id`], equipment.id);
    if (type === 'component') return same(cable?.[`${side}ParentEquipmentId`], equipment.id);
    return false;
  });
}

function diagramTouchesEquipment(diagram, equipment) {
  return asArray(diagram?.nodes).some(node => {
    const reference = node?.entityRef;
    if (!reference) return false;
    if (reference.type === 'equipment') return same(reference.id, equipment.id);
    if (reference.type === 'component') return same(reference.parentEquipmentId, equipment.id);
    return false;
  });
}

function routerPortTargetsEquipment(record, equipment) {
  const ref = record?.physicalPortRef;
  if (!ref) return false;
  if ((ref.ownerType || ref.type) === 'equipment') return same(ref.ownerId ?? ref.id, equipment.id);
  if ((ref.ownerType || ref.type) === 'component') return same(ref.parentEquipmentId, equipment.id);
  return false;
}

export function buildEquipmentRelationSummary(equipment, {
  rooms = [], baies = [], walls = [], screens = [], cables = [], docs = [], equipments = [], continuityRecords = [],
  locations = []
} = {}) {
  const index = buildRelationshipIndex({ rooms, baies, equipments });
  const location = resolveEquipmentLocation(equipment, index);
  const connectedCables = asArray(cables).filter(cable => cableTouchesEquipment(cable, equipment));
  const diagrams = asArray(docs).filter(record => record.kind === 'technical_diagram' && diagramTouchesEquipment(record, equipment));
  const routers = asArray(docs).filter(record => record.kind === 'topology_router' && same(record.routerEquipmentId, equipment.id));
  const declaredRouterPortLinks = asArray(docs).filter(record => record.kind === 'topology_router_port' && routerPortTargetsEquipment(record, equipment));
  const routerPortChecks = declaredRouterPortLinks.map(record => validateRouterPortPhysicalLink(record, index));
  const mappedRouterPorts = routerPortChecks.filter(check => check.valid && check.status === 'mapped').map(check => check.routerPort);
  const invalidRouterPortLinks = routerPortChecks.filter(check => !check.valid);

  const platformGraph = buildPlatformEntityGraph({ rooms, baies, walls, screens, cables, docs, equipments, continuityRecords });
  const graphRelations = directPlatformRelations(platformGraph, { type:'equipment', id:equipment.id });
  const graphRelationKinds = graphRelations.reduce((counts, relation) => {
    counts[relation.relation] = (counts[relation.relation] || 0) + 1;
    return counts;
  }, {});

  // Le fil d'Ariane joint enfin les deux moitiés qui existaient sans se parler : l'échelle
  // géographique au-dessus de la salle, et le chemin physique en dessous. Sans `locations`,
  // il rend exactement ce que rendait `physicalPathLabel` — donc rien ne régresse chez les
  // appelants qui n'en fournissent pas encore.
  const breadcrumbPath = fullBreadcrumbPath(location.path, locations);

  return {
    location,
    breadcrumbPath,
    breadcrumb:breadcrumbText(breadcrumbPath) || 'Emplacement non documenté',
    connectedCables,
    diagrams,
    routers,
    declaredRouterPortLinks,
    mappedRouterPorts,
    invalidRouterPortLinks,
    platformGraph,
    graphRelations,
    graphRelationKinds,
    counts:{
      cables:connectedCables.length,
      diagrams:diagrams.length,
      routers:routers.length,
      mappedRouterPorts:mappedRouterPorts.length,
      invalidRouterPortLinks:invalidRouterPortLinks.length,
      canonicalLinks:graphRelations.length,
      locationIssues:location.issues.length
    }
  };
}


/**
 * TABLEAU DES PORTS DE LA GRILLE CENTRALE rattachés à cet équipement.
 *
 * Le défaut corrigé : la fiche ne montrait qu'un NOMBRE — « Ports grille ↔ physiques
 * validés : 3 ». Or un port de grille porte beaucoup plus : son numéro physique, sa
 * direction, son nom, son alias logique, le type de signal, l'état de vérification et le
 * port physique de l'équipement auquel il aboutit. Toute cette information était calculée,
 * puis réduite à un compteur.
 *
 * Un numéro seul ne permet ni de repiquer un signal, ni de retrouver une entrée sur la
 * face arrière : c'est précisément ce qu'un technicien vient chercher ici.
 */
function grillePortsMarkup(ports = []) {
  if (!ports.length) {
    return `<p class="ops-empty" style="margin-top:10px">Aucun port de grille rattaché à cet équipement.
      Les rattachements se déclarent depuis la topologie de diffusion.</p>`;
  }
  const ligne = port => {
    const ref = port?.physicalPortRef || {};
    return `<tr>
      <td class="gc-port-num">${esc(port.portNumber ?? '—')}</td>
      <td><span class="gc-port-dir gc-${esc(String(port.direction || '').toLowerCase())}">${esc(port.direction || '—')}</span></td>
      <td>${esc(port.name || port.label || '—')}</td>
      <td>${esc(port.logicalAlias || '—')}</td>
      <td>${esc(port.signalType || '—')}</td>
      <td>${esc(ref.portId || ref.portNumber || '—')}</td>
      <td>${esc(port.verificationStatus || '—')}</td>
    </tr>`;
  };
  // Entrées puis sorties, chacune par numéro croissant : c'est l'ordre de la face arrière,
  // donc l'ordre dans lequel on cherche.
  const tri = (a, b) => String(a.direction || '').localeCompare(String(b.direction || ''))
    || (Number(a.portNumber || 0) - Number(b.portNumber || 0));
  return `<div class="gc-ports-wrap">
    <table class="gc-ports">
      <thead><tr><th>N°</th><th>Sens</th><th>Nom</th><th>Alias</th><th>Signal</th><th>Port physique</th><th>Vérif.</th></tr></thead>
      <tbody>${[...ports].sort(tri).map(ligne).join('')}</tbody>
    </table>
  </div>`;
}

async function equipmentFromModal(modal) {
  const id = modal?.dataset?.equipmentId;
  if (!id) return null;
  return db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
}

export async function enhanceEquipment360Relations(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.relations360 === '1') return false;
  const equipment = await equipmentFromModal(modal);
  if (!equipment) return false;
  const [rooms, baies, walls, screens, cables, docs, equipments, locations] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('walls'), db.getAll('screens'),
    db.getAll('cables'), db.getAll('docs'), db.getAll('equipments'),
    // Le magasin `locations` n'existe que depuis la migration v17 : une base plus ancienne
    // rend une liste vide, et le fil d'Ariane commence alors à la salle.
    db.getAll('locations').catch(() => [])
  ]);
  const summary = buildEquipmentRelationSummary(equipment, { rooms, baies, walls, screens, cables, docs, equipments, continuityRecords:docs, locations });
  const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
  if (!target) return false;

  const card = document.createElement('section');
  card.className = 'ops-card ops-relationship-integrations';
  card.innerHTML = `<h3><i class="fas fa-link"></i> Relations canoniques</h3>
    <p class="ops-card-sub">Cette fiche interroge le même graphe canonique que la localisation, les câbles, la topologie et les schémas; elle ne crée aucune copie de l’équipement.</p>
    <div class="ops-facts">
      <div class="ops-fact ops-fact-wide"><small>Emplacement</small>${filArianeMarkup(summary.breadcrumbPath)}</div>
      <div class="ops-fact"><small>Liens graphe directs</small><strong>${summary.counts.canonicalLinks}</strong></div>
      <div class="ops-fact"><small>Câbles reliés</small><strong>${summary.counts.cables}</strong></div>
      <div class="ops-fact"><small>Schémas liés</small><strong>${summary.counts.diagrams}</strong></div>
      <div class="ops-fact"><small>Routeurs logiques</small><strong>${summary.counts.routers}</strong></div>
      <div class="ops-fact"><small>Ports grille ↔ physiques validés</small><strong>${summary.counts.mappedRouterPorts}</strong></div>
      <div class="ops-fact"><small>Mappings ports invalides</small><strong>${summary.counts.invalidRouterPortLinks}</strong></div>
      <div class="ops-fact"><small>Cohérence localisation</small><strong>${summary.location.valid ? 'OK' : `${summary.counts.locationIssues} anomalie(s)`}</strong></div>
    </div>
    <h4 class="gc-ports-title"><i class="fas fa-network-wired"></i> Ports de la grille centrale</h4>
    ${grillePortsMarkup(summary.mappedRouterPorts)}
    ${summary.location.issues.length ? `<div class="ops-empty" style="margin-top:10px">${summary.location.issues.map(issue => esc(issue.message)).join('<br>')}</div>` : ''}
    ${summary.invalidRouterPortLinks.length ? `<div class="ops-empty" style="margin-top:10px">${summary.invalidRouterPortLinks.flatMap(check => check.errors).map(error => esc(error)).join('<br>')}</div>` : ''}`;
  target.prepend(card);
  modal.dataset.relations360 = '1';
  return true;
}

function schedule(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceEquipment360Relations(modal).catch(() => {}));
  setTimeout(() => enhanceEquipment360Relations(modal).catch(() => {}), 120);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.relations360Observer === '1') return;
  host.dataset.relations360Observer = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule(existing);
}

if (typeof window !== 'undefined') {
  installObserver();
  window.EquipmentRelations360 = Object.freeze({
    version:EQUIPMENT_RELATIONS_360_VERSION,
    enhance:enhanceEquipment360Relations,
    summarize:buildEquipmentRelationSummary
  });
}