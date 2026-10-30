/**
 * @file permissions.js — contrat central des autorisations 2M TECH.
 * @description Toutes les interfaces doivent interroger PermissionManager au lieu de déduire les droits depuis le nom du rôle.
 */

import { normalizeRole, canManageRole, assignableRoles, isPlatformAdmin } from './roles.js';

const PERMISSIONS_MATRIX = {
  admin: {
    system: { view:true, configure:true, backup:true, restore:true },
    users: { view:true, create:true, edit:true, delete:true, changeRole:true, resetPassword:true },
    equipments: { view:true, create:true, edit:true, delete:true, changeStatus:true, export:true, import:true },
    rooms: { view:true, create:true, edit:true, delete:true, assign:true, export:true, import:true },
    baies: { view:true, create:true, edit:true, delete:true, assign:true, export:true, import:true },
    reports: { view:true, generate:true, export:true },
    logs: { view:true, export:true, clear:true },
    walls: { view:true, create:true, edit:true, delete:true, changeImage:true },
    screens: { view:true, create:true, edit:true, delete:true, move:true, diagnose:true, linkEquipment:true, createTicket:true },
    notes: { view:true, create:true, delete:true },
    continuity: { view:true, create:true, edit:true, validate:true, test:true },
    diagrams: { view:true, create:true, edit:true, validate:true, delete:true }
  },

  /**
   * MANAGER — « peut tout voir de la chaîne », sans pouvoir la reconfigurer.
   *
   * Il voyait déjà tout, mais pour une mauvaise raison : `manager` était un ALIAS
   * d'`admin`, ce qui lui donnait aussi `system.restore`, `users.changeRole` et
   * `logs.clear`. La lecture universelle est conservée ; les leviers qui engagent la
   * plateforme elle-même reviennent à l'administrateur.
   *
   * `system.view` reste vrai : suivre l'état de la plateforme fait partie de « tout voir ».
   * `configure`, `backup` et `restore` ne le sont pas — ce sont des actes d'exploitation.
   */
  manager: {
    system: { view:true, configure:false, backup:false, restore:false },
    users: { view:true, create:true, edit:true, delete:false, changeRole:true, resetPassword:true },
    equipments: { view:true, create:true, edit:true, delete:true, changeStatus:true, export:true, import:true },
    rooms: { view:true, create:true, edit:true, delete:true, assign:true, export:true, import:true },
    baies: { view:true, create:true, edit:true, delete:true, assign:true, export:true, import:true },
    reports: { view:true, generate:true, export:true },
    // Consulter et extraire les journaux, jamais les effacer : la trace ne s'efface que
    // sous la responsabilité de l'administrateur.
    logs: { view:true, export:true, clear:false },
    walls: { view:true, create:true, edit:true, delete:true, changeImage:true },
    screens: { view:true, create:true, edit:true, delete:true, move:true, diagnose:true, linkEquipment:true, createTicket:true },
    notes: { view:true, create:true, delete:true },
    continuity: { view:true, create:true, edit:true, validate:true, test:true },
    diagrams: { view:true, create:true, edit:true, validate:true, delete:true }
  },

  /**
   * CHEF — celui qui VALIDE.
   *
   * Décision du client : « le chef valide, mais le technicien et le responsable peuvent
   * modifier avant sa validation ». Le chef porte donc `validate` sur les objets qui se
   * valident, et l'autorité hiérarchique sur responsable, technicien et visiteur.
   *
   * Ce rôle n'existait pas du tout : un compte « chef » retombait sur `visitor` et ne
   * voyait rien, sans le moindre message.
   */
  chef: {
    system: { view:true, configure:false, backup:false, restore:false },
    users: { view:true, create:true, edit:true, delete:false, changeRole:true, resetPassword:true },
    equipments: { view:true, create:true, edit:true, delete:false, changeStatus:true, export:true, import:false },
    /*
     * `rooms.assign` REPASSE À FAUX POUR LE CHEF (A-1).
     *
     * Désigner le responsable d'une salle crée l'autorité de zone qui va avec. Le serveur
     * réserve cet acte à l'administration globale — `RESPONSIBLE_ASSIGN_ADMIN_ONLY`, la
     * même règle que pour nommer un responsable de zone. Laisser `assign:true` ici ferait
     * afficher au chef un champ dont l'enregistrement serait refusé en 403, ce que ce
     * fichier cherche précisément à éviter ailleurs. Éditer la salle (`edit`) reste acquis :
     * qui modifie une fiche ne décide pas pour autant qui en répond.
     */
    rooms: { view:true, create:true, edit:true, delete:false, assign:false, export:true, import:false },
    baies: { view:true, create:true, edit:true, delete:false, assign:true, export:true, import:false },
    reports: { view:true, generate:true, export:true },
    logs: { view:true, export:true, clear:false },
    walls: { view:true, create:true, edit:true, delete:false, changeImage:true },
    screens: { view:true, create:true, edit:true, delete:false, move:true, diagnose:true, linkEquipment:true, createTicket:true },
    notes: { view:true, create:true, delete:true },
    continuity: { view:true, create:true, edit:true, validate:true, test:true },
    diagrams: { view:true, create:true, edit:true, validate:true, delete:false }
  },

  responsible: {
    system: { view:false, configure:false, backup:false, restore:false },
    users: { view:true, create:false, edit:false, delete:false, changeRole:false, resetPassword:false },
    equipments: { view:true, create:true, edit:true, delete:false, changeStatus:true, export:false, import:false },
    rooms: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    baies: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    reports: { view:true, generate:true, export:false },
    logs: { view:true, export:false, clear:false },
    walls: { view:true, create:false, edit:true, delete:false, changeImage:true },
    screens: { view:true, create:false, edit:true, delete:false, move:true, diagnose:true, linkEquipment:true, createTicket:true },
    notes: { view:true, create:true, delete:false },
    continuity: { view:true, create:true, edit:true, validate:true, test:true },
    diagrams: { view:true, create:true, edit:true, validate:true, delete:false }
  },

  technician: {
    system: { view:false, configure:false, backup:false, restore:false },
    users: { view:false, create:false, edit:false, delete:false, changeRole:false, resetPassword:false },
    equipments: { view:true, create:false, edit:false, delete:false, changeStatus:true, export:false, import:false },
    rooms: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    baies: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    reports: { view:false, generate:false, export:false },
    logs: { view:false, export:false, clear:false },
    walls: { view:true, create:false, edit:false, delete:false, changeImage:false },
    screens: { view:true, create:false, edit:false, delete:false, move:false, diagnose:true, linkEquipment:false, createTicket:true },
    notes: { view:true, create:true, delete:false },
    continuity: { view:true, create:false, edit:false, validate:false, test:true },
    diagrams: { view:true, create:false, edit:false, validate:false, delete:false }
  },

  visitor: {
    system: { view:false, configure:false, backup:false, restore:false },
    users: { view:false, create:false, edit:false, delete:false, changeRole:false, resetPassword:false },
    equipments: { view:true, create:false, edit:false, delete:false, changeStatus:false, export:false, import:false },
    rooms: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    baies: { view:true, create:false, edit:false, delete:false, assign:false, export:false, import:false },
    reports: { view:false, generate:false, export:false },
    logs: { view:false, export:false, clear:false },
    walls: { view:true, create:false, edit:false, delete:false, changeImage:false },
    screens: { view:true, create:false, edit:false, delete:false, move:false, diagnose:false, linkEquipment:false, createTicket:false },
    notes: { view:true, create:false, delete:false },
    continuity: { view:false, create:false, edit:false, validate:false, test:false },
    diagrams: { view:false, create:false, edit:false, validate:false, delete:false }
  }
};

function resolveRoleKey(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw && Object.prototype.hasOwnProperty.call(PERMISSIONS_MATRIX, raw)) return raw;
  const canonical = normalizeRole(raw);
  return Object.prototype.hasOwnProperty.call(PERMISSIONS_MATRIX, canonical) ? canonical : 'visitor';
}

class PermissionManager {
  /** Vérifie une autorisation pour un utilisateur. */
  static check(user, entity, action) {
    if (!user?.role || !entity || !action) return false;
    return Boolean(PERMISSIONS_MATRIX[resolveRoleKey(user.role)]?.[entity]?.[action]);
  }

  /** Retourne les autorisations d'un rôle canonique, historique ou personnalisé. */
  static getRolePermissions(role) {
    return PERMISSIONS_MATRIX[resolveRoleKey(role)] || {};
  }

  /**
   * Peut-on agir sur CE compte-ci ?
   *
   * `users.edit` ne suffit pas : il dit qu'on sait modifier des comptes, pas lesquels.
   * Sans cette seconde question, un chef pouvait modifier un manager, et un manager
   * l'administrateur. L'autorité s'arrête strictement au rang inférieur.
   */
  static canActOnUser(actor, target) {
    if (!actor?.role) return false;
    // Chacun reste maître de son propre compte pour ce qui ne touche pas au rôle.
    if (target?.id !== undefined && String(actor.id) === String(target.id)) return true;
    return canManageRole(actor.role, target?.role);
  }

  /**
   * Rôles que cet acteur peut ATTRIBUER. `admin` n'y figure jamais : il vient des
   * variables d'environnement Railway et d'elles seules.
   */
  static assignableRoles(actor) {
    if (!actor?.role) return [];
    return assignableRoles(actor.role);
  }

  /** L'attribution demandée est-elle permise ? */
  static canAssignRole(actor, targetRole) {
    return this.assignableRoles(actor).includes(normalizeRole(targetRole));
  }

  static isPlatformAdmin(role) { return isPlatformAdmin(role); }

  /** Modifie une autorisation existante. */
  static updatePermission(role, entity, action, value) {
    const roleKey = resolveRoleKey(role);
    if (!PERMISSIONS_MATRIX[roleKey]?.[entity] || typeof value !== 'boolean') return false;
    PERMISSIONS_MATRIX[roleKey][entity][action] = value;
    return true;
  }

  /** Crée un rôle personnalisé sans écraser les rôles/alias historiques. */
  static createCustomRole(roleName, permissions) {
    const raw = String(roleName || '').trim().toLowerCase();
    if (!raw || !permissions || typeof permissions !== 'object') return false;
    const canonical = normalizeRole(raw);
    const isHistoricalAlias = raw === canonical || canonical !== 'visitor' || raw === 'visitor';
    if (PERMISSIONS_MATRIX[raw] || isHistoricalAlias) return false;
    PERMISSIONS_MATRIX[raw] = structuredClone(permissions);
    return true;
  }
}

/** Vérification pratique à partir d'un nom de rôle. */
function checkPermission(role, entity, action) {
  if (!role) return false;
  return Boolean(PERMISSIONS_MATRIX[resolveRoleKey(role)]?.[entity]?.[action]);
}

export { PermissionManager, checkPermission };