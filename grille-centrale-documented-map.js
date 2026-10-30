import { db } from './db.js';
import {
  TOPOLOGY_KINDS,
  loadTopologySnapshot,
  saveTopologyRecord
} from './broadcast-topology.js';
import {
  GRILLE_CENTRALE_ROUTER_ID,
  ensureGrilleCentraleTopology
} from './grille-centrale-topology.js';
import { ensureGrilleCentralePhysicalArchitecture } from './grille-centrale-physical-architecture.js';
import { loadGrilleCentraleDataset, jetonDOuverture } from './grille-centrale-dataset.js';
import { attendreDecisionSync } from './central-sync-decision.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';
import { matchesPublicGrilleIdentity } from './grille-centrale-public-identity.js';

/*
 * CE MODULE N'A PLUS DE DONNÉE, IL N'A QUE DE L'AFFICHAGE (#137).
 *
 * Il portait les libellés d'entrée et de sortie, les repères de câbles, les chemins
 * monitoring et la référence du document source — servis en clair à tout navigateur. Ils vivent
 * maintenant sous `scripts/private-operational-data/`, que le serveur ne sert pas, et
 * n'arrivent ici qu'après autorisation.
 *
 * Les identifiants canoniques restent publics : ce sont des clés, pas des faits
 * d'installation, et le contrat topologie s'appuie dessus.
 */
export const GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION = 1;
export const GRILLE_CENTRALE_SYNOPTIC_ID = 'gc-synoptic-video-2012';
export const GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID = 'gc-evidence-synoptic-photo-2012';
export const GRILLE_CENTRALE_MAP_RECORD_ID = 'gc-documented-port-cable-map';

const now = () => new Date().toISOString();
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function isAdminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true;
}

/*
 * COMPARER SANS SE LAISSER TROMPER PAR L'ORDRE DES CLÉS (#166).
 *
 * PostgreSQL stocke ces fiches en `jsonb`, qui RÉORDONNE les clés d'objet. Une fiche
 * revenue par un instantané n'a donc plus l'ordre du seed, à valeurs pourtant identiques :
 *
 *   local (revenu du central)   {"id":"IN/SDI","to":128,"from":1,"count":128,…}
 *   seed                        {"id":"IN/SDI","direction":"INPUT","from":1,"to":128,…}
 *
 * `JSON.stringify` est sensible à l'ordre : la comparaison était donc TOUJOURS vraie
 * (différente), et chaque battement de synchronisation réécrivait l'intégralité du seed.
 * Mesuré sur « central chaud, IndexedDB froid », sans le moindre geste utilisateur :
 * réécriture à t+4,5 s puis à t+21 s, la seconde partant d'une révision locale périmée —
 * `3 × 409 STALE_WRITE` et trois entrées bloquées dans la file.
 *
 * `recordsExactlyEqual` est la comparaison que `snapshot-store-plan.js` (#171) applique
 * déjà à chaque instantané, pour exactement cette raison. Une seule règle, un seul endroit.
 */
async function saveSeedDoc(record) {
  const current = await db.get('docs', record.id).catch(() => null);
  if (current && isAdminLocked(current)) return { updated:false, protected:true, record:current };
  const next = current ? { ...current, ...record, id:record.id, createdAt:current.createdAt || record.createdAt || now(), updatedAt:now() } : { ...record, createdAt:record.createdAt || now(), updatedAt:now() };
  const comparableCurrent = current ? { ...current, updatedAt:undefined } : null;
  const comparableNext = { ...next, updatedAt:undefined };
  if (current && recordsExactlyEqual(comparableCurrent, comparableNext)) return { updated:false, protected:false, record:current };
  await db.save('docs', next);
  return { updated:true, protected:false, record:next };
}

async function ensureSynopticRecords(seed) {
  const synoptic = await saveSeedDoc(seed.synoptic);
  const evidence = await saveSeedDoc(seed.evidence);
  return { synoptic, evidence };
}

async function ensureMonitoringTopology(seed) {
  const results = [];
  for (const { patch, path } of seed.monitoring) {
    const currentPatch = await db.get('docs', patch.id).catch(() => null);
    if (!currentPatch || (!isAdminLocked(currentPatch) && currentPatch.grilleCentraleDocumentedMapVersion !== seed.version)) {
      results.push(await saveTopologyRecord(TOPOLOGY_KINDS.PATCH_POINT, patch));
    }
    const currentPath = await db.get('docs', path.id).catch(() => null);
    if (!currentPath || (!isAdminLocked(currentPath) && currentPath.grilleCentraleDocumentedMapVersion !== seed.version)) {
      results.push(await saveTopologyRecord(TOPOLOGY_KINDS.SIGNAL_PATH, path));
    }
  }
  return results;
}

/**
 * Installe le plan documenté — À CONDITION D'Y AVOIR DROIT.
 *
 * Sans jeu de données autorisé, cette fonction n'écrit RIEN et rend `{ authorized:false }`.
 * C'est le point où l'ancien comportement se refermait : le module s'ensemençait au
 * chargement, pour tout le monde, sans jamais demander à personne.
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
export async function ensureGrilleCentraleDocumentedMap({ revalidate = false, ouverture = null, persister = true } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  if (!dataset) return { authorized:false, dataset:null, version:GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION, ports:0, expectedPorts:0, inserted:0, refreshed:0, conflicts:0, protected:0, crosspoints:0, mapRecord:null };
  const seed = dataset.seedRecords;
  if (!persister) {
    // Les compteurs affichés sont ceux de l'état RÉEL, relus : « 0 / 374 » resterait faux
    // s'il venait du seed. Ce que le panneau montre est donc ce que la base contient.
    await db.open();
    const vue = await loadTopologySnapshot();
    const portsVus = vue.routerPorts.filter(port => String(port.routerId) === GRILLE_CENTRALE_ROUTER_ID);
    const croisementsVus = vue.crosspoints.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
    const carteLue = await db.get('docs', seed.mapRecord.id).catch(() => null);
    return { authorized:true, dataset, version:GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION, ports:portsVus.length, expectedPorts:dataset.documentedPorts.length, inserted:0, refreshed:0, conflicts:0, protected:0, crosspoints:croisementsVus.length, mapRecord:carteLue };
  }
  /*
   * L'ENSEMENCEMENT ATTEND QUE LA TENTATIVE CENTRALE SOIT TRANCHÉE (#166, contrat #165).
   *
   * Ce module s'ensemence sur une minuterie posée au chargement (`scheduleReconcile(2800)`)
   * et sur chaque `central-sync-status: synced`. Tant que le jeu de données n'était autorisé
   * pour personne, rien de tout cela n'écrivait. Dès que la fiche canonique existe, si :
   *
   *   · `docs` local est encore VIDE — instantané pas encore appliqué — et
   *   · le central, lui, porte déjà ces fiches,
   *
   * alors `saveSeedDoc` compose une fiche SANS révision et l'envoie sur une fiche que le
   * serveur a déjà. Mesuré sur « central chaud, IndexedDB froid » :
   *
   *     3 × 409 sur /api/data/docs/gc-synoptic-video-2012, 3 entrées bloquées en syncQueue.
   *
   * La barrière est celle que #165 a posée, et pour la même raison : un magasin vide n'est
   * pas une donnée manquante, c'est un instantané qui n'est pas encore arrivé. Un seul
   * point d'entrée à garder — la topologie et l'architecture physique s'ensemencent par
   * ici.
   *
   * Le chemin de CONSULTATION (`persister:false`) est rendu plus haut : il ne franchit
   * jamais cette ligne, et la revalidation d'autorisation de #137 reste immédiate.
   */
  await attendreDecisionSync();
  await ensureGrilleCentraleTopology({ revalidate, ouverture });
  await ensureGrilleCentralePhysicalArchitecture({ revalidate, ouverture });
  await db.open();
  await ensureSynopticRecords(seed);

  const snapshotBefore = await loadTopologySnapshot();
  const existingByPortKey = new Map(snapshotBefore.routerPorts.filter(port => String(port.routerId) === GRILLE_CENTRALE_ROUTER_ID).map(port => [`${port.direction}:${port.portNumber}`, port]));
  let inserted = 0;
  let refreshed = 0;
  let protectedCount = 0;
  let conflicts = 0;

  for (const desired of dataset.documentedPorts) {
    const key = `${desired.direction}:${desired.portNumber}`;
    const byKey = existingByPortKey.get(key);
    const current = await db.get('docs', desired.id).catch(() => null);
    if (byKey && String(byKey.id) !== String(desired.id)) { conflicts += 1; continue; }
    if (current && isAdminLocked(current)) { protectedCount += 1; continue; }
    if (current?.grilleCentraleDocumentedMapVersion === GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION && current.logicalAlias === desired.logicalAlias && current.documentSignalDomain === desired.documentSignalDomain) continue;
    const timestamp = now();
    const next = { ...(current || {}), ...desired, createdAt:current?.createdAt || timestamp, updatedAt:timestamp };
    await db.save('docs', next);
    existingByPortKey.set(key, next);
    if (current) refreshed += 1;
    else inserted += 1;
  }

  await ensureMonitoringTopology(seed);

  const mapRecord = await saveSeedDoc(seed.mapRecord);

  const snapshot = await loadTopologySnapshot();
  const routerPorts = snapshot.routerPorts.filter(port => String(port.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  const crosspoints = snapshot.crosspoints.filter(item => String(item.routerId) === GRILLE_CENTRALE_ROUTER_ID);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('grille-centrale-documented-map-updated', { detail:{ version:GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION, ports:routerPorts.length, inserted, refreshed, conflicts, protected:protectedCount, crosspoints:crosspoints.length } }));
  }
  return { authorized:true, dataset, version:GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION, ports:routerPorts.length, expectedPorts:dataset.documentedPorts.length, inserted, refreshed, conflicts, protected:protectedCount, crosspoints:crosspoints.length, mapRecord:mapRecord.record };
}

/*
 * L'IDENTITÉ EST DÉCIDÉE AILLEURS, UNE SEULE FOIS (#166).
 *
 * Ce filtre existait ici en quatre exemplaires légèrement différents — l'un lisait
 * `inventorySource.name` sans `reference`, les autres l'inverse — et le serveur, qui doit
 * s'aligner sur eux pour ne pas autoriser ce qu'ils n'afficheront pas, ne pouvait s'aligner
 * que sur une partie. `grille-centrale-public-identity.js` porte désormais la réponse, et
 * les quatre panneaux comme la vérification serveur l'appellent.
 */
const grilleEquipmentMatches = matchesPublicGrilleIdentity;


function portRow(port) {
  const number = `${port.direction === 'INPUT' ? 'IN' : 'OUT'}.${port.portNumber}`;
  return `<div class="gc-map-port" data-search="${esc(normalize(`${number} ${port.logicalAlias} ${port.documentSignalDomain}`))}"><strong>${esc(number)} · ${esc(port.logicalAlias)}</strong><small>${esc(port.documentSignalDomain)} · design 2M confirmé · connecteur arrière actuel à confirmer</small></div>`;
}

function installMapStyles() {
  if (document.getElementById('gc-documented-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'gc-documented-map-styles';
  style.textContent = `.gc-map-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}.gc-map-fact{border:1px solid var(--border,#dce4e8);border-radius:10px;padding:8px;background:var(--surface,#fff)}.gc-map-fact small{display:block;color:var(--text-muted,#667783);font-size:10px}.gc-map-fact strong{font-size:16px}.gc-map-search{width:100%;padding:9px 10px;border:1px solid var(--border,#dce4e8);border-radius:9px;background:var(--surface,#fff);color:inherit;margin:8px 0}.gc-map-list{display:grid;gap:5px;max-height:360px;overflow:auto}.gc-map-port{padding:7px 9px;border-radius:8px;background:rgba(127,140,141,.08);display:grid;gap:2px}.gc-map-port strong{font-size:11px}.gc-map-port small{font-size:10px;color:var(--text-muted,#667783)}.gc-map-port[hidden]{display:none}.gc-map-chain{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.5;padding:8px;border-radius:8px;background:rgba(40,116,166,.08);margin-top:6px}@media(max-width:780px){.gc-map-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  document.head.appendChild(style);
}

function bindPortSearch(section) {
  const input = section.querySelector('[data-gc-map-search]');
  const rows = [...section.querySelectorAll('.gc-map-port')];
  if (!input) return;
  const apply = () => {
    const query = normalize(input.value);
    let shown = 0;
    for (const row of rows) {
      const match = !query || row.dataset.search.includes(query);
      const visible = match && shown < 50;
      row.hidden = !visible;
      if (visible) shown += 1;
    }
    const count = section.querySelector('[data-gc-map-result-count]');
    if (count) count.textContent = `${shown} résultat(s) affiché(s)${query ? ' · filtre actif' : ' · maximum 50'}`;
  };
  input.addEventListener('input', apply);
  apply();
}

export async function enhanceGrilleCentraleDocumentedMap360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.gcDocumentedMap === '1' || modal.dataset.gcDocumentedMapBusy === '1') return false;
  modal.dataset.gcDocumentedMapBusy = '1';
  try {
    let equipment = null;
    const id = String(modal.dataset.equipmentId || '').trim();
    if (id) equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
    if (!equipment) {
      const name = modal.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
      if (name) {
        const matches = (await db.getAll('equipments')).filter(item => normalize(item.name || item.nom || '') === normalize(name));
        if (matches.length === 1) equipment = matches[0];
      }
    }
    if (!equipment || !grilleEquipmentMatches(equipment)) return false;
  /*
   * OUVRIR UN ÉCRAN REDEMANDE AU SERVEUR (#137).
   *
   * Une habilitation peut avoir été retirée depuis le chargement du jeu de données, sans
   * déconnexion ni rechargement. La mémoire de l'onglet ne décide donc pas ici. Le jeton
   * regroupe les modules de CETTE modale ; une modale suivante en obtient un autre, et le
   * serveur retranche — même cent millisecondes plus tard.
   */
    const ensured = await ensureGrilleCentraleDocumentedMap({ revalidate:true, ouverture:jetonDOuverture(modal), persister:false });
    /*
     * PAS DE PANNEAU DÉGRADÉ POUR QUI N'Y A PAS DROIT.
     *
     * Un utilisateur hors périmètre ne voit rien de ce panneau : ni ports vides, ni
     * compteur, ni chaîne monitoring. Annoncer « 0 / 374 » lui apprendrait déjà la taille
     * de la matrice, et lister des libellés grisés la composition du site.
     */
    if (!ensured.authorized) return false;
    /*
     * LE PANNEAU DESSINE CE QUE L'AUTORISATION VIENT DE RENDRE.
     *
     * Il relisait la mémoire par `peek`. Or la portée peut bouger entre la revalidation et
     * cette relecture — un instantané qui atterrit entre les deux suffit — et `peek` rend
     * alors `null` : l'écran restait vide pour un utilisateur pourtant autorisé. On prend
     * donc le jeu de données que `ensure` a validé, pas une seconde lecture qui peut différer.
     */
    const dataset = ensured.dataset;
    installMapStyles();
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;

    const section = document.createElement('section');
    section.className = 'ops-card grille-centrale-documented-map-card';
    const portRows = dataset.documentedPorts.map(portRow).join('');
    const invariants = dataset.invariants;
    const chaines = dataset.seedRecords.monitoring
      .map(({ path }, index) => `<strong>Monitoring ${index + 1}</strong> : ${esc(path.sourceLabel)} → ${esc(path.cableRefs.join(' → connexion/normalisation → '))} → ${esc(path.destinationLabel)}`)
      .join('<br>');
    section.innerHTML = `<h3><i class="fas fa-network-wired"></i> Plan documenté des ports & câbles</h3><p class="ops-card-sub">Transcription du synoptique interne. Elle décrit le design documenté, pas l’état instantané des crosspoints ni la continuité as-built actuelle.</p><div class="gc-map-facts"><div class="gc-map-fact"><small>Entrées logiques</small><strong>${esc(invariants.logicalInputs)}</strong></div><div class="gc-map-fact"><small>Sorties logiques</small><strong>${esc(invariants.logicalOutputs)}</strong></div><div class="gc-map-fact"><small>Monitoring dédié</small><strong>${esc(invariants.dedicatedMonitoringOutputs)}</strong></div><div class="gc-map-fact"><small>Ports topology installés</small><strong>${esc(ensured.ports)} / ${esc(ensured.expectedPorts)}</strong></div></div><div class="gc-map-chain">${chaines}</div><input class="gc-map-search" data-gc-map-search placeholder="Rechercher un port, un alias ou un domaine…" autocomplete="off"><small data-gc-map-result-count></small><div class="gc-map-list">${portRows}</div><div class="gc-map-chain"><strong>Intégrité :</strong> les références de synchronisation ne sont pas des entrées de matrice. Les sorties monitoring ne sont pas des sorties de matrice. Les repères de câble ne sont pas des numéros de port constructeur. Aucun crosspoint actif n’est créé ou inféré. Les connecteurs arrière et l’état actuel des câbles restent à vérifier sur site.</div>`;

    const physical = target.querySelector('.grille-centrale-physical-architecture-card');
    if (physical?.nextSibling) target.insertBefore(section, physical.nextSibling);
    else target.appendChild(section);
    bindPortSearch(section);
    modal.dataset.gcDocumentedMap = '1';
    return true;
  } finally {
    delete modal.dataset.gcDocumentedMapBusy;
  }
}

let reconcileTimer = null;
function scheduleReconcile(delay = 1400) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureGrilleCentraleDocumentedMap().catch(error => console.warn('Plan documenté Grille Centrale indisponible', error)), delay);
}

function schedule360(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceGrilleCentraleDocumentedMap360(modal).catch(() => {}));
  setTimeout(() => enhanceGrilleCentraleDocumentedMap360(modal).catch(() => {}), 400);
  setTimeout(() => enhanceGrilleCentraleDocumentedMap360(modal).catch(() => {}), 1400);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.gcDocumentedMapObserver === '1') return;
  host.dataset.gcDocumentedMapObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule360(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360(existing);
}

if (typeof window !== 'undefined') {
  /*
   * LA SURFACE `window` N'EXPOSE PLUS DE DONNÉES.
   *
   * Elle portait `inputLabels`, `outputLabels`, `ports`, `monitoring`, `grObservations` et
   * le document source : n'importe quelle console, sur n'importe quel poste, y compris
   * déconnecté, lisait le plan complet en une ligne. Il ne reste que les opérations.
   */
  window.GrilleCentraleDocumentedMap = Object.freeze({ version:GRILLE_CENTRALE_DOCUMENTED_MAP_VERSION, ensure:ensureGrilleCentraleDocumentedMap, enhance360:enhanceGrilleCentraleDocumentedMap360 });
  installObserver();
  window.addEventListener('inventory-master-imported', () => scheduleReconcile());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') scheduleReconcile(); });
  window.addEventListener('grille-centrale-physical-architecture-updated', () => scheduleReconcile(500));
  scheduleReconcile(2800);
}
