import { db } from './db.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';
import { indexEngineeringLinks, linksForEntity } from './engineering-refs.js';
import { openProcedureById } from './procedures-center.js';

/**
 * @file equipment-360-engineering-links.js — la fiche 360 dit enfin ce qui la documente.
 *
 * LE LIEN EXISTAIT DÉJÀ, DANS UN SEUL SENS
 * ----------------------------------------
 * Une procédure de continuité cite ses entités (`steps[].entityRefs`) ; un schéma technique
 * cite les siennes (`nodes[].entityRef`). Ces références sont écrites, persistées et
 * validées côté serveur. Mais on ne pouvait les lire que depuis la procédure ou depuis le
 * schéma — jamais depuis l'équipement.
 *
 * Le technicien, lui, part de l'équipement : il ouvre la fiche 360 de l'encodeur devant
 * lui, et veut savoir quelle procédure le concerne. Cette carte répond à cette question, et
 * à elle seule.
 *
 * CE QU'ELLE N'INVENTE PAS
 * ------------------------
 * Elle n'écrit rien, ne déduit rien et ne propose aucune action qu'elle ne sait pas rendre.
 * Si aucun schéma ni aucune procédure ne cite l'équipement, elle le DIT — c'est une réponse,
 * pas un vide à masquer. Un schéma n'a pas d'ouvreur autonome dans la plateforme : il est
 * donc listé avec son titre, son type et son statut réels, sans bouton qui n'ouvrirait rien.
 *
 * ELLE NE TOUCHE PAS À LA CARTE
 * -----------------------------
 * Aucun fichier `map-*`, `interactive-map` ni `pilot-technique-shell` n'est modifié ni
 * importé : cette carte s'ajoute à la fiche 360 par la même mécanique d'observation que les
 * autres enrichisseurs, en couche, depuis son propre fichier.
 */

export const EQUIPMENT_360_ENGINEERING_LINKS_VERSION = 1;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const STATUS_LABELS = Object.freeze({ draft:'Brouillon', documented:'Documenté', validated:'Validé', suspended:'Suspendu', retired:'Retiré' });
const DIAGRAM_TYPE_LABELS = Object.freeze({
  'physical-plan':'Plan physique', 'room-layout':'Implantation salle', 'rack-elevation':'Élévation baie',
  'chassis-layout':'Implantation châssis', 'signal-synoptic':'Synoptique signal',
  'network-topology':'Topologie réseau', 'router-matrix':'Matrice routeur',
  'power-sync-control':'Alimentation / synchro', 'wall-layout':'Implantation mur'
});
const statusLabel = value => STATUS_LABELS[value] || value || '—';

/** L'identifiant de l'équipement affiché, tel que `equipment-360-complete.js` le pose. */
function equipmentIdFromModal(modal) {
  const brut = modal?.dataset?.equipmentId;
  return brut === undefined || brut === null || brut === '' ? null : String(brut);
}

export async function enhanceEquipment360EngineeringLinks(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.engineeringLinks === '1') return false;
  // La carte ne s'affiche qu'à qui a le droit de lire la continuité : ce sont les mêmes
  // données, servies au même titre. Aucune ACL nouvelle n'est créée ici.
  if (!PermissionManager.check(getCurrentUser(), 'continuity', 'view')) return false;

  const equipmentId = equipmentIdFromModal(modal);
  if (!equipmentId) return false;

  const cible = modal.querySelector('.ops-modal-body');
  if (!cible) return false;
  modal.dataset.engineeringLinks = '1';

  let docs = [];
  try { docs = await db.getAll('docs'); }
  catch { docs = []; }

  const { procedures, diagrams } = linksForEntity(indexEngineeringLinks(docs), 'equipment', equipmentId);

  const section = document.createElement('section');
  section.className = 'ops-card ops-engineering-links';
  section.innerHTML = `<h3><i class="fas fa-list-check"></i> Schémas & procédures</h3>
    ${procedures.length || diagrams.length ? '' : '<p class="engineering-links-empty">Aucun schéma ni aucune procédure ne cite cet équipement.</p>'}
    ${procedures.length ? `<h4>Procédures (${procedures.length})</h4>
      <ul class="engineering-links-list">${procedures.map(procedure => `
        <li>
          <button type="button" class="engineering-link-open" data-open-procedure="${esc(procedure.id)}">
            <i class="fas fa-book-open"></i> ${esc(procedure.title || 'Procédure sans titre')}
          </button>
          <span class="engineering-link-meta">Révision ${esc(procedure.revision || '1')} · ${esc(statusLabel(procedure.status))}</span>
        </li>`).join('')}</ul>` : ''}
    ${diagrams.length ? `<h4>Schémas (${diagrams.length})</h4>
      <ul class="engineering-links-list">${diagrams.map(diagram => `
        <li>
          <span class="engineering-link-static"><i class="fas fa-project-diagram"></i> ${esc(diagram.title || 'Schéma sans titre')}</span>
          <span class="engineering-link-meta">${esc(DIAGRAM_TYPE_LABELS[diagram.diagramType] || diagram.diagramType || 'Schéma')} · ${esc(statusLabel(diagram.status))}</span>
        </li>`).join('')}</ul>
      <p class="engineering-links-note">Les schémas s’ouvrent depuis la section <strong>Schémas techniques</strong>.</p>` : ''}`;

  cible.appendChild(section);

  section.querySelectorAll('[data-open-procedure]').forEach(bouton => {
    bouton.onclick = () => openProcedureById(bouton.dataset.openProcedure).catch(() => {});
  });
  return true;
}

function schedule360(modal) {
  if (!modal) return;
  /*
   * TROIS TENTATIVES, ET C'EST NÉCESSAIRE — mesuré, pas supposé.
   *
   * `dataset.equipmentId` est posé par `equipment-360-complete.js`, qui résout l'équipement
   * de façon ASYNCHRONE. Au moment où l'observateur voit la fiche entrer dans `#app`, cet
   * identifiant n'est pas encore écrit : une tentative unique repartait donc sans rien
   * poser, et la carte restait muette alors que toutes ses données étaient disponibles —
   * observé sur ce dépôt, l'appel direct au pont réussissant sur la même fiche.
   *
   * Le même échelonnement que `grille-centrale-field-verification.js`, pour la même raison.
   * La garde `dataset.engineeringLinks` rend les tentatives surnuméraires inoffensives.
   */
  queueMicrotask(() => { enhanceEquipment360EngineeringLinks(modal).catch(() => {}); });
  setTimeout(() => { enhanceEquipment360EngineeringLinks(modal).catch(() => {}); }, 500);
  setTimeout(() => { enhanceEquipment360EngineeringLinks(modal).catch(() => {}); }, 1500);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.engineeringLinksObserver === '1') return;
  host.dataset.engineeringLinksObserver = '1';
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
  window.Equipment360EngineeringLinks = Object.freeze({
    version:EQUIPMENT_360_ENGINEERING_LINKS_VERSION,
    enhance:enhanceEquipment360EngineeringLinks
  });
  installObserver();
}

export default enhanceEquipment360EngineeringLinks;
