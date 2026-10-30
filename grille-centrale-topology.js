import { db } from './db.js';
import { ensureGrilleCentraleKnowledge } from './grille-centrale-knowledge.js';
import { TOPOLOGY_KINDS, loadTopologySnapshot, saveTopologyRecord } from './broadcast-topology.js';
import { loadGrilleCentraleDataset, jetonDOuverture } from './grille-centrale-dataset.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';
import { matchesPublicGrilleIdentity } from './grille-centrale-public-identity.js';

/*
 * CE MODULE PORTAIT AUSSI DES DONNÉES D'INSTALLATION (#137).
 *
 * `GRILLE_CENTRALE_TOPOLOGY_INTERFACES` nommait les postes de contrôle et les repères de
 * câbles réels ; la fiche du routeur composée plus bas portait la capacité de la matrice,
 * son implantation en baie et le constructeur candidat. Déplacer le seul
 * `grille-centrale-documented-map.js` aurait laissé tout cela public : le jeu de données
 * n'est pas un fichier, c'est une nature.
 *
 * `GRILLE_CENTRALE_ROUTER_ID` reste ici : c'est la clé canonique sur laquelle s'appuient le
 * contrat topologie, les fiches déjà écrites et l'autorisation serveur.
 */

export const GRILLE_CENTRALE_TOPOLOGY_VERSION = 1;
export const GRILLE_CENTRALE_ROUTER_ID = 'router-gc190x184';
const CATALOG_ID = 'kb-grille-centrale-190x184';
const UPDATED_AT = '2026-08-16';

const asArray = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

/*
 * L'IDENTITÉ EST DÉCIDÉE AILLEURS, UNE SEULE FOIS (#166).
 *
 * Ce filtre existait ici en quatre exemplaires légèrement différents — l'un lisait
 * `inventorySource.name` sans `reference`, les autres l'inverse — et le serveur, qui doit
 * s'aligner sur eux pour ne pas autoriser ce qu'ils n'afficheront pas, ne pouvait s'aligner
 * que sur une partie. `grille-centrale-public-identity.js` porte désormais la réponse, et
 * les quatre panneaux comme la vérification serveur l'appellent.
 */
const equipmentMatches = matchesPublicGrilleIdentity;


function adminTopology(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true;
}

async function findGrilleEquipment() {
  const matches = (await db.getAll('equipments')).filter(equipmentMatches);
  if (matches.length === 1) return matches[0];
  const direct = matches.filter(item => String(item.catalogId || '') === CATALOG_ID);
  return direct.length === 1 ? direct[0] : null;
}

/*
 * LA PREUVE TERRAIN A PRÉSÉANCE SUR L'HYPOTHÈSE DOCUMENTAIRE (#166).
 *
 * `field-evidence-integration.js` fait passer la fiche du routeur de « candidat historique »
 * à « confirmé terrain » — la façade `2m-field-06` porte PLATINUM | Harris. Ce seed, lui,
 * réaffirmait la formulation documentaire par-dessus, à chaque consultation :
 *
 *   seed        manufacturer: 'Harris Broadcast — candidat historique'
 *   confirmé    manufacturer: 'Harris Broadcast — confirmé terrain'
 *
 * Les deux se défaisaient sans fin. `preserve` nomme les champs dont la confirmation est
 * propriétaire ; ils ne sont conservés QUE si la fiche porte déjà la marque de ce passage
 * (`preserveWhen`), pour qu'une base neuve reçoive bien la base documentaire d'abord.
 */
async function upsertSeedRecord(kind, desired, { preserve = [], preserveWhen = '' } = {}) {
  const current = await db.get('docs', desired.id).catch(() => null);
  if (current && adminTopology(current)) return { record:current, updated:false, protected:true };
  const confirme = Boolean(current && preserveWhen && current[preserveWhen] !== undefined);
  const conserves = confirme
    ? Object.fromEntries(preserve.filter(cle => cle in current).map(cle => [cle, current[cle]]))
    : {};
  const payload = current ? { ...current, ...desired, ...conserves, id:desired.id } : desired;
  const comparable = current && recordsExactlyEqual({ ...payload, updatedAt:current.updatedAt }, current);
  if (comparable) return { record:current, updated:false, protected:false };
  const record = await saveTopologyRecord(kind, payload);
  return { record, updated:true, protected:false };
}

/**
 * Installe la topologie de la Grille Centrale — SEULEMENT si le jeu de données est dû.
 *
 * Rend `{ authorized:false }` sans rien écrire quand il ne l'est pas : c'est ce qui empêche
 * un poste hors périmètre, ou sans session, de s'ensemencer tout seul au chargement.
 */

/*
 * CONSULTER N'EST PAS ENSEMENCER (#108).
 *
 * Ce module est monté par un MutationObserver sur `#app` : il se réveille dès qu'une fiche
 * 360 y est insérée. Tant qu'il appelait l'ensemencement complet à ce réveil, OUVRIR une
 * fiche en lecture seule écrivait — dix ouvertures de la MÊME fiche produisaient 974 PUT,
 * sans la moindre intention de l'utilisateur.
 *
 * `persister:false` sépare les deux moitiés que cette fonction confondait : la
 * revalidation d'autorisation auprès du serveur (#137), qui DOIT rester — une habilitation
 * peut avoir été retirée depuis le chargement — et l'ensemencement, qui n'appartient qu'au
 * démarrage et aux workflows explicites. La consultation lit et rend ce qui existe ; elle
 * ne crée rien. Rien n'est masqué : l'ensemencement garde exactement le même code.
 */
export async function ensureGrilleCentraleTopology({ revalidate = false, ouverture = null, persister = true } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  if (!dataset) return { authorized:false, version:GRILLE_CENTRALE_TOPOLOGY_VERSION, router:null, equipment:null, routerUpdated:false, routerProtected:false, interfacesUpdated:0, interfacesProtected:0, interfaces:0, ports:0, crosspoints:0 };
  const seed = dataset.topologySeed;
  if (!persister) return { authorized:true, version:GRILLE_CENTRALE_TOPOLOGY_VERSION, router:seed.router, equipment:null, routerUpdated:false, routerProtected:false, interfacesUpdated:0, interfacesProtected:0, interfaces:0, ports:0, crosspoints:0 };
  await ensureGrilleCentraleKnowledge();
  await db.open();
  const equipment = await findGrilleEquipment();

  // Les champs que la confirmation terrain possède sont nommés par le jeu de données
  // autorisé lui-même — ce module n'en recopie aucun.
  const confirmation = dataset.knowledgeSeed?.fieldPhotoConfirmation || null;
  const champsConfirmes = confirmation ? [...Object.keys(confirmation.routerFields || {}), 'note'] : [];

  const routerResult = await upsertSeedRecord(TOPOLOGY_KINDS.ROUTER, {
    ...seed.router,
    routerEquipmentId:equipment?.id ?? null
  }, { preserve:champsConfirmes, preserveWhen:'fieldEvidenceIntegrationVersion' });

  let interfacesUpdated = 0;
  let interfacesProtected = 0;
  for (const item of seed.interfaces) {
    const result = await upsertSeedRecord(TOPOLOGY_KINDS.ROUTER_INTERFACE, item);
    if (result.updated) interfacesUpdated += 1;
    if (result.protected) interfacesProtected += 1;
  }

  // Intégrité volontaire : aucune entrée ni sortie de la matrice n’est créée
  // artificiellement si son alias/câble n’est pas documenté, et aucun crosspoint
  // n’est déduit d’un synoptique statique.
  const snapshot = await loadTopologySnapshot();
  const router = snapshot.routers.find(item => String(item.id) === GRILLE_CENTRALE_ROUTER_ID) || routerResult.record;
  const interfaces = snapshot.routerInterfaces.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const ports = snapshot.routerPorts.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const crosspoints = snapshot.crosspoints.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('grille-centrale-topology-updated', {
      detail:{ routerId:GRILLE_CENTRALE_ROUTER_ID, equipmentId:equipment?.id ?? null, interfaces:interfaces.length, ports:ports.length, crosspoints:crosspoints.length }
    }));
  }
  return {
    authorized:true,
    version:GRILLE_CENTRALE_TOPOLOGY_VERSION,
    router,
    equipment,
    routerUpdated:routerResult.updated,
    routerProtected:routerResult.protected,
    interfacesUpdated,
    interfacesProtected,
    interfaces:interfaces.length,
    ports:ports.length,
    crosspoints:crosspoints.length
  };
}

function interfaceRows(items) {
  return items.map(item => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(item.name)}</strong><small>${esc(item.function || item.interfaceType)}${asArray(item.cableRefs).length ? ` · ${esc(item.cableRefs.join(' / '))}` : ''}</small></div><span class="ops-badge normal">Documenté</span></div>`).join('');
}

export async function enhanceGrilleCentrale360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.grilleTopologyEnhanced === '1') return false;
  const id = String(modal.dataset.equipmentId || '').trim();
  let equipment = id ? await db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null) : null;
  if (!equipment) {
    const name = modal.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
    if (name) {
      const matches = (await db.getAll('equipments')).filter(item => String(item.name || item.nom || '').trim() === name);
      if (matches.length === 1) equipment = matches[0];
    }
  }
  if (!equipment || !equipmentMatches(equipment)) return false;

  /*
   * OUVRIR UN ÉCRAN REDEMANDE AU SERVEUR (#137).
   *
   * Une habilitation peut avoir été retirée depuis le chargement du jeu de données, sans
   * déconnexion ni rechargement. La mémoire de l'onglet ne décide donc pas ici.
   */
  const ensured = await ensureGrilleCentraleTopology({ revalidate:true, ouverture:jetonDOuverture(modal), persister:false });
  // Hors périmètre : aucun panneau, donc aucune capacité, aucune interface, aucun repère.
  if (!ensured.authorized) return false;
  const snapshot = await loadTopologySnapshot();
  const router = snapshot.routers.find(item => String(item.id) === GRILLE_CENTRALE_ROUTER_ID) || ensured.router;
  const interfaces = snapshot.routerInterfaces.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const ports = snapshot.routerPorts.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const crosspoints = snapshot.crosspoints.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const paths = snapshot.signalPaths.filter(path => asArray(path.routerPortIds).some(portId => ports.some(port => String(port.id) === String(portId))));

  const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
  if (!target) return false;
  const section = document.createElement('section');
  section.className = 'ops-card grille-centrale-topology-card';
  section.innerHTML = `<h3><i class="fas fa-project-diagram"></i> Flux de signal & grille centrale</h3>
    <p class="ops-card-sub">Cette fiche est liée au même modèle de topologie que la page « Flux de signal & grille centrale ». La page documente la matrice et ses relations ; elle n’envoie aucune commande à la grille réelle.</p>
    <div class="ops-facts">
      <div class="ops-fact"><small>Matrice</small><strong>${esc(router?.matrixLabel || '—')}</strong></div>
      <div class="ops-fact"><small>Équipement lié</small><strong>${esc(equipment.name || equipment.nom || equipment.id)}</strong></div>
      <div class="ops-fact"><small>Interfaces documentées</small><strong>${interfaces.length}</strong></div>
      <div class="ops-fact"><small>Ports détaillés</small><strong>${ports.length} · seulement si documentés</strong></div>
      <div class="ops-fact"><small>Flux liés</small><strong>${paths.length}</strong></div>
      <div class="ops-fact"><small>Crosspoints documentés</small><strong>${crosspoints.length} · aucun état actif déduit</strong></div>
    </div>
    <h4 style="margin:14px 0 8px">Monitoring, Sync/Ref et contrôle</h4>
    <div class="ops-list" style="max-height:360px;overflow:auto">${interfaces.length ? interfaceRows(interfaces) : '<div class="ops-empty">Interfaces en cours de synchronisation.</div>'}</div>
    <div class="ops-empty" style="margin-top:10px">Capacité connue : ${esc(router?.inputCapacity ?? '—')} entrées / ${esc(router?.outputCapacity ?? '—')} sorties. Les ports non nommés et les crosspoints actifs restent volontairement non inventés.</div>`;
  target.appendChild(section);
  modal.dataset.grilleTopologyEnhanced = '1';
  return true;
}

let reconcileTimer = null;
function scheduleReconcile(delay = 250) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureGrilleCentraleTopology().catch(error => console.warn('Topologie Grille Centrale indisponible', error)), delay);
}

function scheduleModalEnhancement(modal) {
  queueMicrotask(() => enhanceGrilleCentrale360(modal).catch(() => {}));
  setTimeout(() => enhanceGrilleCentrale360(modal).catch(() => {}), 120);
  setTimeout(() => enhanceGrilleCentrale360(modal).catch(() => {}), 700);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.grilleCentraleTopologyObserver === '1') return;
  host.dataset.grilleCentraleTopologyObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) scheduleModalEnhancement(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) scheduleModalEnhancement(existing);
}

if (typeof window !== 'undefined') {
  window.GrilleCentraleTopology = Object.freeze({
    version:GRILLE_CENTRALE_TOPOLOGY_VERSION,
    routerId:GRILLE_CENTRALE_ROUTER_ID,
    ensure:ensureGrilleCentraleTopology,
    enhance360:enhanceGrilleCentrale360
  });
  installObserver();
  window.addEventListener('inventory-master-imported', () => scheduleReconcile());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') scheduleReconcile(); });
  window.addEventListener('equipment-media-linkage-updated', () => scheduleReconcile(400));
  await ensureGrilleCentraleTopology().catch(error => console.warn('Topologie Grille Centrale non initialisée', error));
  scheduleReconcile(1800);
}
