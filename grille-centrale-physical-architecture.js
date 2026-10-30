import { db } from './db.js';
import { ensureFieldEvidenceIntegration } from './field-evidence-integration.js';
import { GRILLE_CENTRALE_ROUTER_ID } from './grille-centrale-topology.js';
import { loadGrilleCentraleDataset, jetonDOuverture } from './grille-centrale-dataset.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';
import { matchesPublicGrilleIdentity } from './grille-centrale-public-identity.js';

/*
 * LES BAIES, LES ÉTIQUETTES ET LES LIENS ONT QUITTÉ CE MODULE (#137).
 *
 * `GRILLE_CENTRALE_PHYSICAL_NODES` décrivait les baies de brassage, les libellés lisibles
 * en façade et le rôle de chaque zone — une description de l'installation, pas
 * du produit. Elle arrive maintenant par l'endpoint protégé.
 */

export const GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_VERSION = 1;
export const GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID = 'gc-physical-architecture';
const CATALOG_ID = 'kb-grille-centrale-190x184';
const REVIEWED_AT = '2026-08-16';

const asArray = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim()
  .replace(/\s+/g,' ');



function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true;
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
export async function ensureGrilleCentralePhysicalArchitecture({ revalidate = false, ouverture = null, persister = true } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  if (!dataset) return { authorized:false, dataset:null, record:null, updated:false, protected:false };
  if (!persister) {
    await db.open();
    const lu = await db.get('docs', GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID).catch(() => null);
    return { authorized:true, dataset, record:lu, updated:false, protected:false };
  }
  const seed = dataset.physicalSeed;
  await ensureFieldEvidenceIntegration();
  await db.open();
  const current = await db.get('docs', GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID).catch(() => null);
  if (current && adminLocked(current)) return { authorized:true, dataset, record:current, updated:false, protected:true };
  const next = current ? { ...current, ...seed.record, id:GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID } : seed.record;
  const updated = !current || !recordsExactlyEqual(current, next);
  if (updated) await db.save('docs', next);
  if (updated && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('grille-centrale-physical-architecture-updated', {
      detail:{ version:GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_VERSION, routerId:GRILLE_CENTRALE_ROUTER_ID }
    }));
  }
  return { authorized:true, dataset, record:next, updated, protected:false };
}

function statusLabel(status) {
  if (status === 'field-photo-confirmed' || status === 'physical-role-confirmed') return 'Terrain confirmé';
  if (status === 'documented-internal' || status === 'documented-logical') return 'Documenté 2M';
  return 'À confirmer';
}

function statusClass(status) {
  if (status === 'field-photo-confirmed' || status === 'physical-role-confirmed') return 'confirmed';
  if (status === 'documented-internal' || status === 'documented-logical') return 'documented';
  return 'confirm';
}

function injectStyles() {
  if (document.getElementById('gc-physical-architecture-styles')) return;
  const style = document.createElement('style');
  style.id = 'gc-physical-architecture-styles';
  style.textContent = `
    .gc-physical-flow{display:grid;grid-template-columns:minmax(0,1fr) 34px minmax(0,1.2fr) 34px minmax(0,1fr);gap:8px;align-items:stretch;margin:10px 0}
    .gc-physical-node{border:1px solid var(--border,#dce4e8);border-radius:12px;padding:10px;background:var(--surface,#fff);display:grid;gap:6px;min-width:0}
    .gc-physical-node strong{font-size:13px}.gc-physical-node small{font-size:11px;line-height:1.45;color:var(--text-muted,#667783)}
    .gc-physical-core{border-width:2px}.gc-physical-arrow{display:flex;align-items:center;justify-content:center;font-size:18px;opacity:.65}
    .gc-physical-side{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}
    .gc-physical-status{display:inline-flex;width:max-content;max-width:100%;font-size:10px;font-weight:800;border-radius:999px;padding:3px 7px;background:rgba(230,126,34,.13)}
    .gc-physical-status.confirmed{background:rgba(39,174,96,.13)}.gc-physical-status.documented{background:rgba(40,116,166,.12)}
    .gc-physical-guard{margin-top:10px;padding:9px 10px;border-radius:10px;background:rgba(127,140,141,.10);font-size:11px;line-height:1.5;color:var(--text-muted,#667783)}
    @media (max-width:780px){.gc-physical-flow{grid-template-columns:1fr}.gc-physical-arrow{transform:rotate(90deg);min-height:24px}.gc-physical-side{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function nodeMarkup(node, core = false) {
  const labels = asArray(node.visibleLabels).length ? `<small>${esc(node.visibleLabels.join(' · '))}</small>` : '';
  const logical = asArray(node.documentedLogicalInterfaces).length ? `<small>Interfaces logiques documentées : ${esc(node.documentedLogicalInterfaces.join(' · '))} — affectation physique à confirmer</small>` : '';
  const cables = asArray(node.documentedCableRefs).length ? `<small>Câbles documentés : ${esc(node.documentedCableRefs.join(' · '))}</small>` : '';
  return `<div class="gc-physical-node${core ? ' gc-physical-core' : ''}">
    <span class="gc-physical-status ${statusClass(node.verificationStatus)}">${statusLabel(node.verificationStatus)}</span>
    <strong>${esc(node.name)}</strong>
    <small>${esc(node.zone)}</small>${labels}${logical}${cables}
    <small>${esc(node.note)}</small>
  </div>`;
}

export async function enhanceGrilleCentralePhysical360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.gcPhysicalArchitecture === '1' || modal.dataset.gcPhysicalArchitectureBusy === '1') return false;
  modal.dataset.gcPhysicalArchitectureBusy = '1';
  try {
    let equipment = null;
    const explicitId = String(modal.dataset.equipmentId || '').trim();
    if (explicitId) equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(explicitId) : explicitId).catch(() => null);
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
   * déconnexion ni rechargement. La mémoire de l'onglet ne décide donc pas ici.
   */
    const ensured = await ensureGrilleCentralePhysicalArchitecture({ revalidate:true, ouverture:jetonDOuverture(modal), persister:false });
    // Hors périmètre : pas de panneau, donc aucune baie, aucune étiquette, aucun lien.
    if (!ensured.authorized) return false;
    // Même règle que le plan documenté : on dessine ce que l'autorisation vient de rendre,
    // jamais une seconde lecture de la mémoire qui peut avoir changé entre-temps.
    const dataset = ensured.dataset;
    injectStyles();
    const nodes = new Map(dataset.physicalSeed.nodes.map(node => [node.id,node]));
    const gr1 = nodes.get('gc-physical-gr1-inputs');
    const core = nodes.get('gc-physical-platinum-core');
    const gr2 = nodes.get('gc-physical-gr2-outputs');
    const gr3 = nodes.get('gc-physical-gr3-control-sync');
    const monitoring = nodes.get('gc-physical-monitoring');
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;

    const section = document.createElement('section');
    section.className = 'ops-card grille-centrale-physical-architecture-card';
    // La capacité de la matrice et la famille confirmée viennent du jeu de données
    // autorisé : les écrire ici les remettrait dans le bundle public (#137).
    const matrice = dataset.invariants ? `${dataset.invariants.logicalInputs} × ${dataset.invariants.logicalOutputs}` : '—';
    const familleConfirmee = core?.note || '';
    section.innerHTML = `<h3><i class="fas fa-sitemap"></i> Architecture physique — Grille Centrale</h3>
      <p class="ops-card-sub">Vue physique prudente issue des photos terrain 2M et du synoptique interne. Les documents constructeur servent uniquement de contexte famille/contrôle et ne créent aucun câblage local.</p>
      <div class="gc-physical-flow">
        ${nodeMarkup(gr1)}<div class="gc-physical-arrow">→</div>${nodeMarkup(core,true)}<div class="gc-physical-arrow">→</div>${nodeMarkup(gr2)}
      </div>
      <div class="gc-physical-side">${nodeMarkup(gr3)}${nodeMarkup(monitoring)}</div>
      <div class="gc-physical-guard"><strong>Contrat d’intégrité :</strong> matrice interne <strong>${esc(matrice)}</strong> conservée ; ${esc(familleConfirmee)} ; châssis/SKU, cartes/slots, mapping connecteurs, câbles des zones de brassage vers ports physiques et affectation contrôle/synchro restent <strong>À confirmer</strong>. Aucun crosspoint actif n’est créé. La famille voisine reste un équipement distinct et ses capacités constructeur ne remplacent jamais la capacité locale.</div>`;
    const topologyCard = target.querySelector('.grille-centrale-topology-card');
    if (topologyCard?.nextSibling) target.insertBefore(section, topologyCard.nextSibling);
    else target.appendChild(section);
    modal.dataset.gcPhysicalArchitecture = '1';
    return true;
  } finally {
    delete modal.dataset.gcPhysicalArchitectureBusy;
  }
}

let reconcileTimer = null;
function scheduleReconcile(delay = 900) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureGrilleCentralePhysicalArchitecture().catch(error => console.warn('Architecture physique Grille Centrale indisponible', error)), delay);
}

function schedule360(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceGrilleCentralePhysical360(modal).catch(() => {}));
  setTimeout(() => enhanceGrilleCentralePhysical360(modal).catch(() => {}), 300);
  setTimeout(() => enhanceGrilleCentralePhysical360(modal).catch(() => {}), 1100);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.gcPhysicalArchitectureObserver === '1') return;
  host.dataset.gcPhysicalArchitectureObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule360(modal);
    }
  });
  observer.observe(host,{ childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360(existing);
}

if (typeof window !== 'undefined') {
  window.GrilleCentralePhysicalArchitecture = Object.freeze({
    version:GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_VERSION,
    id:GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID,
    ensure:ensureGrilleCentralePhysicalArchitecture,
    enhance360:enhanceGrilleCentralePhysical360
  });
  installObserver();
  window.addEventListener('inventory-master-imported', () => scheduleReconcile());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') scheduleReconcile(); });
  window.addEventListener('equipment-field-evidence-updated', () => scheduleReconcile(500));
  ensureGrilleCentralePhysicalArchitecture().catch(error => console.warn('Architecture physique Grille Centrale non initialisée', error));
  scheduleReconcile(3200);
}