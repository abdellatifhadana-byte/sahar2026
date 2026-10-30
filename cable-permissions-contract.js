/**
 * @file cable-permissions-contract.js — QUI A LE DROIT DE FAIRE QUOI SUR UN CÂBLE.
 *
 * POURQUOI CE CONTRAT EXISTE.
 *
 * `cables` n'est PAS une entité de la matrice canonique : celle-ci couvre baies,
 * continuity, diagrams, equipments, logs, notes, reports, rooms, screens, system, users et
 * walls — pas les câbles. Jusqu'ici, un câble n'était donc gouverné que par les
 * habilitations de zone `cable.read` / `cable.edit`, sans aucun plafond de rôle : un
 * technicien porteur d'un `cable.edit` agissait comme un chef.
 *
 * DÉCISION MÉTIER (arbitrée, pas déduite) : sans ajouter `cables` à la matrice, un câble
 * emprunte le plafond de rôle des ÉQUIPEMENTS — ce sont eux qu'il relie — ET reste soumis
 * à l'habilitation de zone qui existe déjà. LES DEUX sont exigées :
 *
 *     PLAFOND DE RÔLE (matrice canonique)   ∧   HABILITATION DE ZONE
 *
 * La conséquence qui compte : une habilitation de zone ne peut JAMAIS élever un rôle
 * au-dessus de la matrice. Accorder `cable.edit` à un technicien ne lui donne pas
 * `equipments.edit` — donc il n'édite pas de câble. C'est la même règle que la carte
 * applique déjà à ses propres actes (`map-permissions-contract.js`), écrite une seule fois
 * ici plutôt que dispersée dans les trois écrans qui manipulent des câbles.
 *
 * Pur : ni DOM, ni IndexedDB, ni réseau. La décision est donc EXÉCUTABLE dans une épreuve,
 * et le client comme le serveur appliquent littéralement la même fonction.
 */
import { PermissionManager } from './permissions.js';
import { endpointIdentity } from './cable-endpoint-contract.js';

export const CABLE_PERMISSIONS_VERSION = 1;

/** Les actes qu'on peut demander sur un câble ou sur son tracé. */
export const CABLE_ACTIONS = Object.freeze([
  'view', 'create', 'edit', 'delete', 'routeView', 'routeEdit'
]);

/**
 * Pour chaque acte : le plafond de rôle emprunté aux équipements, et l'habilitation de
 * zone exigée. `null` côté zone signifie « aucune habilitation supplémentaire ».
 *
 * Le tracé n'a pas de plafond à lui : le VOIR relève de la lecture d'un câble, le
 * MODIFIER relève de son édition. Un tracé est une documentation du câble, pas un objet
 * dont on pourrait hériter des droits séparément.
 */
export const CABLE_ACTION_RULES = Object.freeze({
  view:      Object.freeze({ matrice: 'view',   zone: 'cable.read' }),
  create:    Object.freeze({ matrice: 'create', zone: 'cable.edit' }),
  edit:      Object.freeze({ matrice: 'edit',   zone: 'cable.edit' }),
  delete:    Object.freeze({ matrice: 'delete', zone: 'cable.edit' }),
  routeView: Object.freeze({ matrice: 'view',   zone: 'cable.read' }),
  routeEdit: Object.freeze({ matrice: 'edit',   zone: 'cable.edit' })
});

/** L'entité de la matrice dont le câble emprunte le plafond. */
export const CABLE_CEILING_ENTITY = 'equipments';

/**
 * Le PLAFOND DE RÔLE seul — sans regarder la zone.
 *
 * Exposé séparément pour que l'appelant puisse NOMMER son refus : « votre rôle ne le
 * permet pas » et « vous n'avez pas ce périmètre » sont deux messages différents, et les
 * confondre envoie un administrateur chercher dans les habilitations un refus qui vient
 * de la matrice.
 */
export function cableRoleCeilingAllows(user, action) {
  const regle = CABLE_ACTION_RULES[action];
  if (!regle) return false;
  return PermissionManager.check(user, CABLE_CEILING_ENTITY, regle.matrice);
}

/** L'habilitation de zone exigée par cet acte — `null` s'il n'en exige aucune. */
export function cableZonePermissionFor(action) {
  return CABLE_ACTION_RULES[action]?.zone ?? null;
}

/**
 * La décision complète.
 *
 * `zoneAccorde` est fourni par l'appelant : le client le tient de son contexte
 * d'habilitations, le serveur de `hasPermission` sur les zones réellement touchées par le
 * câble. Ce contrat ne va chercher aucune donnée lui-même — c'est ce qui le rend pur, et
 * identique des deux côtés.
 */
export function cableActionAllowed(user, action, { zoneAccorde = false } = {}) {
  if (!CABLE_ACTIONS.includes(action)) return false;
  if (!cableRoleCeilingAllows(user, action)) return false;
  return cableZonePermissionFor(action) === null ? true : Boolean(zoneAccorde);
}

/**
 * Pourquoi c'est refusé — pour que l'interface et l'API disent la même chose.
 *
 * Rend `null` quand c'est autorisé.
 */
export function cableDenialReason(user, action, { zoneAccorde = false } = {}) {
  if (!CABLE_ACTIONS.includes(action)) return 'UNKNOWN_ACTION';
  if (!cableRoleCeilingAllows(user, action)) return 'ROLE_ACTION_FORBIDDEN';
  if (cableZonePermissionFor(action) !== null && !zoneAccorde) return 'ZONE_FORBIDDEN';
  return null;
}

/** Ce que CE rôle peut au maximum, si le périmètre suit. Utile pour composer un écran. */
export function cableAbilities(user, { zoneAccorde = false } = {}) {
  const droits = {};
  for (const action of CABLE_ACTIONS) droits[action] = cableActionAllowed(user, action, { zoneAccorde });
  return Object.freeze(droits);
}

/* ------------------------------------------------------------------------- *
 * LE CÔTÉ « ZONE » DE LA DÉCISION, LU DANS LE CONTEXTE D'HABILITATIONS
 * ------------------------------------------------------------------------- */

const vivant = item => item && !['inactive', 'revoked'].includes(String(item.status || ''))
  && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now());

/**
 * L'utilisateur détient-il cette habilitation de câblage QUELQUE PART ?
 *
 * DEUX CONDITIONS DANS LA MÊME ZONE — adhésion active ET habilitation active. Une
 * habilitation sur une zone dont on n'est pas membre ne vaut rien, et c'est exactement ce
 * que le serveur revérifie (`hasEffectivePermissionSomewhere`) : le client ne doit pas
 * proposer un geste que l'API refusera.
 *
 * `isGlobalAdmin` court-circuite le périmètre, jamais le plafond de rôle : c'est le
 * serveur qui pose ce drapeau, et il ne dit rien du rôle — `cableActionAllowed` continue
 * d'exiger la matrice par-dessus.
 *
 * Cette réponse est un MAXIMUM sur l'ensemble des zones : elle sert à composer l'écran
 * (faut-il seulement montrer le bouton ?). Le serveur, lui, tranche zone par zone sur le
 * câble réellement visé, et c'est sa décision qui fait foi.
 */
export function cableZoneGrantedSomewhere(accessContext, permission) {
  if (!permission) return true;
  if (!accessContext) return false;
  if (accessContext.isGlobalAdmin) return true;
  const membreDe = new Set((accessContext.memberships || []).filter(vivant).map(item => String(item.zoneId)));
  return (accessContext.grants || []).some(item => vivant(item)
    && item.permission === permission
    && membreDe.has(String(item.zoneId)));
}

/**
 * Les six droits de câble d'un utilisateur, plafond de rôle ET périmètre compris.
 *
 * C'est la forme qu'un écran consomme : il ne redérive ni la matrice ni les habilitations,
 * il ne fait que lire le verdict. Sans contexte d'habilitations chargé, le périmètre est
 * absent — donc refusé : on ne suppose pas un droit qu'on n'a pas lu.
 */
export function cableAbilitiesFromContext(user, accessContext) {
  const droits = {};
  for (const action of CABLE_ACTIONS) {
    const zone = cableZonePermissionFor(action);
    droits[action] = cableActionAllowed(user, action, {
      zoneAccorde: zone === null ? true : cableZoneGrantedSomewhere(accessContext, zone)
    });
  }
  return Object.freeze(droits);
}

/* ------------------------------------------------------------------------- *
 * DEUX NIVEAUX DE DÉCISION, ET IL NE FAUT PAS LES CONFONDRE
 *
 * CAPACITÉ D'ÉCRAN   « cet utilisateur peut-il, en général, modifier des câbles ? »
 *                    Réponse : plafond de rôle ET `cable.edit` QUELQUE PART. Elle sert à
 *                    composer la page — faut-il seulement afficher des outils d'édition ?
 *
 * AUTORITÉ SUR UN ENREGISTREMENT   « peut-il modifier CE câble-ci ? »
 *                    Le serveur, lui, exige `cable.edit` sur TOUTES les zones que le câble
 *                    touche (`decisions.every`, access-control.js). Une habilitation
 *                    « quelque part » ne répond donc pas à cette question.
 *
 * MESURÉ sur serveur réel — un chef habilité `cable.edit` sur STC seulement :
 *
 *   CAB-INTRA  (STC → STC)   client: edit=true   serveur: PUT 200
 *   CAB-CROSS  (STC → RF1)   client: edit=true   serveur: PUT 403 ZONE_FORBIDDEN
 *
 * Et comme `db.save` écrit EN LOCAL D'ABORD puis pousse (`central-sync.js`), la
 * modification refusée devenait visible à l'écran avant de disparaître au rollback.
 *
 * CE QUE LE CLIENT PEUT PROUVER, ET CE QU'IL NE PEUT PAS
 * ------------------------------------------------------
 * Le serveur marque lui-même les câbles dont une extrémité sort du périmètre du lecteur :
 * il retire les identifiants et pose `{side}Protected`. Ce marqueur est une PREUVE,
 * portée par la donnée, qu'une extrémité au moins échappe à l'utilisateur — donc que
 * l'autorité complète sur ce câble n'est pas établie. On ferme là-dessus, sans rien
 * reconstruire de ce qui a été retiré.
 *
 * Reste un cas que le client ne peut PAS trancher : un périmètre de LECTURE plus large que
 * le périmètre d'ÉDITION. Mesuré également — avec `cable.read` sur STC et RF1 mais
 * `cable.edit` sur STC seulement, CAB-CROSS arrive SANS marqueur et le serveur refuse
 * quand même. Aucune donnée servie au client ne distingue alors ce câble d'un câble
 * autorisé. Le serveur reste l'autorité finale ; ce cas est signalé, pas deviné.
 * ------------------------------------------------------------------------- */

/** Les actes qui ÉCRIVENT. Voir un câble protégé reste légitime : c'est l'affichage prévu. */
const CABLE_MUTATIONS = Object.freeze(['create', 'edit', 'delete', 'routeEdit']);

/**
 * Ce câble porte-t-il une extrémité que le serveur a retirée ?
 *
 * La forme du marqueur n'est connue qu'à un seul endroit — `cable-endpoint-contract.js` —
 * et c'est lui qu'on interroge : deux lectures du même marqueur finiraient par diverger.
 */
export function cableHasProtectedEndpoint(cable = {}) {
  return ['source', 'destination'].some(side => Boolean(endpointIdentity(cable, side).protege));
}

/**
 * Pourquoi cet acte est-il refusé SUR CE CÂBLE — avant toute écriture locale.
 *
 * Trois refus, trois noms : le rôle, le périmètre, l'enregistrement. Les confondre
 * enverrait un administrateur corriger une habilitation quand c'est la matrice qui ferme,
 * ou l'inverse.
 */
export function cableRecordDenialReason(user, action, cable, accessContext) {
  const zone = cableZonePermissionFor(action);
  const capacite = cableDenialReason(user, action, {
    zoneAccorde: zone === null ? true : cableZoneGrantedSomewhere(accessContext, zone)
  });
  if (capacite) return capacite;
  if (CABLE_MUTATIONS.includes(action) && cableHasProtectedEndpoint(cable)) return 'ENDPOINT_OUT_OF_SCOPE';
  return null;
}

/** L'acte est-il permis sur CE câble ? À demander juste avant d'écrire, jamais après. */
export function cableRecordMutationAllowed(user, action, cable, accessContext) {
  return cableRecordDenialReason(user, action, cable, accessContext) === null;
}

export default Object.freeze({
  version: CABLE_PERMISSIONS_VERSION,
  CABLE_ACTIONS, CABLE_ACTION_RULES, CABLE_CEILING_ENTITY,
  cableRoleCeilingAllows, cableZonePermissionFor, cableActionAllowed, cableDenialReason, cableAbilities,
  cableZoneGrantedSomewhere, cableAbilitiesFromContext,
  cableHasProtectedEndpoint, cableRecordDenialReason, cableRecordMutationAllowed
});
