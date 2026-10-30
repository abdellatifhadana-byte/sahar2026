/**
 * @file zone-scope-notice.js — dire à un rôle à périmètre qu'il n'a pas d'habilitation.
 *
 * CE QUE CE MODULE FERME
 * ----------------------
 * Un Chef, un Technicien ou un Responsable sans aucune habilitation sur une zone reçoit
 * un instantané filtré VIDE. Les pages Salles, Baies et Équipements affichaient alors la
 * carte, les filtres, et un tableau réduit à sa ligne d'en-tête — mesuré au navigateur :
 * `table.tableau tr` = 1, aucune phrase. Rien ne distinguait « il n'y a rien ici » de
 * « vous n'avez pas le droit d'y voir quoi que ce soit ». La plateforme paraissait cassée
 * alors qu'elle appliquait exactement sa politique d'accès.
 *
 * DEUX ABSENCES, DEUX PHRASES
 * ---------------------------
 *   A. autorisé, mais la zone est vide      → « Aucune salle dans votre périmètre. »
 *   B. aucune habilitation dans la zone     → la phrase d'habilitation, ci-dessous.
 *
 * CE QU'IL NE FAIT PAS
 * --------------------
 * Il n'élargit AUCUNE permission et ne lit aucune donnée hors périmètre : la phrase ne
 * nomme ni zone, ni salle, ni personne. Il ne fait pas non plus de requête : le contexte
 * d'accès est déjà écrit par `central-sync.js` dans `zone-access-context` à chaque
 * instantané — la même source que `tickets.js`.
 *
 * L'ACTION N'EST OFFERTE QUE SI ELLE EXISTE
 * -----------------------------------------
 * Le bouton « Demander un accès » n'apparaît que pour les rôles dont
 * `zone-access.js` définit réellement les permissions demandables. Pour les autres, la
 * phrase seule : un bouton qui n'aboutit à rien coûte plus qu'une absence de bouton.
 */
import { roleSeesEveryZone, normalizeRole } from './roles.js';
import { roleHasAccessRequestWorkflow, openAccessRequestModal } from './zone-access.js';

export const ZONE_SCOPE_NOTICE_VERSION = 1;

/** La phrase, mot pour mot. Elle est la même partout : c'est le même fait. */
export const SANS_HABILITATION = 'Vous n’avez pas encore d’autorisation dans cette zone.';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

const actif = item => item && item.status !== 'revoked' && item.status !== 'inactive'
  && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now());

/** Le contexte d'accès de la session, tel que l'instantané l'a laissé. Jamais de requête. */
export function contexteDAcces() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const brut = JSON.parse(localStorage.getItem('zone-access-context') || 'null');
    return brut && typeof brut === 'object' ? brut : null;
  } catch { return null; }
}

/**
 * L'état du périmètre, en quatre valeurs — et `unknown` en est une.
 *
 * Sans contexte lisible, on ne conclut RIEN : affirmer « vous n'avez pas d'autorisation »
 * à quelqu'un qui en a, parce que l'instantané n'a pas encore été écrit, serait un
 * mensonge de plus, exactement du même genre que celui qu'on répare.
 */
export function etatDuPerimetre(user, { permission = null, contexte = contexteDAcces() } = {}) {
  if (roleSeesEveryZone(user?.role)) return 'global';
  if (!normalizeRole(user?.role)) return 'unknown';
  if (!contexte) return 'unknown';
  if (contexte.isGlobalAdmin) return 'global';
  const grants = Array.isArray(contexte.grants) ? contexte.grants.filter(actif) : null;
  if (grants === null) return 'unknown';
  /*
   * L'HABILITATION EST DEMANDÉE PAR PAGE, ET NON EN BLOC.
   *
   * Mesuré : un Chef habilité `room.edit` et `equipment.read` — mais PAS
   * `zone.summary.read` — voyait ses baies et ses équipements, et une liste de salles
   * vide. Conclure « il a des habilitations, donc la zone est vide » aurait été un
   * second mensonge, du même genre que celui qu'on répare. Chaque page nomme donc la
   * permission de LECTURE que le serveur lui demande — celle de `access-control.js`,
   * pas une nouvelle.
   */
  const retenus = permission ? grants.filter(item => item.permission === permission) : grants;
  return retenus.length ? 'granted' : 'no-grant';
}

/**
 * Le bloc à insérer À LA PLACE d'une liste vide.
 *
 * `vide` est décidé par l'appelant : lui seul sait ce qu'il vient de compter. Une liste
 * non vide ne reçoit jamais de message — la donnée parle d'elle-même.
 */
export function messageDePerimetre(user, { vide, aucuneDonnee, permission = null }) {
  if (!vide) return '';
  const etat = etatDuPerimetre(user, { permission });
  if (etat === 'no-grant') {
    const action = roleHasAccessRequestWorkflow(user?.role)
      ? `<button type="button" class="btn" data-action="demander-acces">
           <i class="fas fa-user-shield"></i> Demander un accès
         </button>`
      : '';
    return `<p class="zone-scope-notice" data-scope="no-grant" role="status">
        <span>${esc(SANS_HABILITATION)}</span>${action}
      </p>`;
  }
  if (etat === 'granted' && aucuneDonnee) {
    return `<p class="zone-scope-notice" data-scope="empty" role="status"><span>${esc(aucuneDonnee)}</span></p>`;
  }
  return '';
}

/**
 * Le bouton est branché UNE FOIS, par délégation.
 *
 * Trois pages rendent ce message ; leur faire brancher chacune son écouteur après chaque
 * rendu aurait fait trois occasions de l'oublier. La délégation sur le document survit à
 * tous les `innerHTML`, qui sont la règle dans cette interface.
 */
function brancherAction() {
  if (typeof document === 'undefined' || document.documentElement.dataset.zoneScopeNotice === '1') return;
  document.documentElement.dataset.zoneScopeNotice = '1';
  document.addEventListener('click', event => {
    const bouton = event.target.closest?.('.zone-scope-notice [data-action="demander-acces"]');
    if (!bouton) return;
    event.preventDefault();
    let utilisateur = null;
    try { utilisateur = JSON.parse(localStorage.getItem('auth') || 'null'); } catch { utilisateur = null; }
    openAccessRequestModal(utilisateur, window.platformNotifications || null);
  });
}

brancherAction();

export default Object.freeze({
  version: ZONE_SCOPE_NOTICE_VERSION,
  SANS_HABILITATION, contexteDAcces, etatDuPerimetre, messageDePerimetre
});
