/**
 * @file roles.js — les six rôles de la plateforme et leur hiérarchie.
 *
 * LA HIÉRARCHIE
 * -------------
 *     admin → manager → chef → responsable → technicien → visiteur
 *
 * Chaque rôle a autorité sur ceux qui le suivent, et sur eux seuls. L'administrateur
 * répond de tout.
 *
 * DEUX DÉFAUTS CORRIGÉS ICI
 * -------------------------
 * 1. `manager` ÉTAIT UN ALIAS D'`admin`. Toute personne portant ce rôle recevait donc les
 *    pleins pouvoirs — `system.restore`, `users.changeRole`, `logs.clear` — alors que le
 *    manager doit VOIR l'ensemble de la chaîne sans pouvoir la reconfigurer. Le même
 *    raccourci existait côté serveur (`isAdminRole = role === 'admin' || role === 'manager'`),
 *    où il ouvrait une vingtaine de points d'entrée. C'était une élévation de privilège
 *    silencieuse : personne ne l'avait accordée, elle découlait d'une ligne d'alias.
 *
 * 2. `chef` N'EXISTAIT PAS. Un rôle inconnu retombe sur `visitor` : un chef nommé dans la
 *    base n'aurait donc rien vu du tout, sans le moindre message.
 *
 * L'ADMINISTRATEUR NE S'ACCORDE PAS
 * ---------------------------------
 * Il est défini par les variables d'environnement Railway, et par elles seules. Aucun
 * écran, aucune API, aucun import ne doit pouvoir en créer un second — d'où `ADMIN_IS_
 * GRANTABLE = false` et l'absence d'`admin` dans `assignableRoles()`, quel que soit
 * l'acteur. Un administrateur ne peut pas non plus se déclasser lui-même par mégarde.
 */

export const CANONICAL_ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  CHEF: 'chef',
  RESPONSIBLE: 'responsible',
  TECHNICIAN: 'technician',
  VISITOR: 'visitor'
});

/**
 * Ordre d'autorité, du plus étendu au plus restreint. L'index EST le rang : c'est lui qui
 * décide qui peut agir sur qui, plutôt qu'une liste de cas particuliers.
 */
export const ROLE_ORDER = Object.freeze([
  CANONICAL_ROLES.ADMIN,
  CANONICAL_ROLES.MANAGER,
  CANONICAL_ROLES.CHEF,
  CANONICAL_ROLES.RESPONSIBLE,
  CANONICAL_ROLES.TECHNICIAN,
  CANONICAL_ROLES.VISITOR
]);

/** Libellés affichés. Un rôle sans libellé se lirait comme une clé technique. */
export const ROLE_LABELS = Object.freeze({
  [CANONICAL_ROLES.ADMIN]: 'Administrateur',
  [CANONICAL_ROLES.MANAGER]: 'Manager',
  [CANONICAL_ROLES.CHEF]: 'Chef',
  [CANONICAL_ROLES.RESPONSIBLE]: 'Responsable',
  [CANONICAL_ROLES.TECHNICIAN]: 'Technicien',
  [CANONICAL_ROLES.VISITOR]: 'Visiteur'
});

const ROLE_ALIASES = Object.freeze({
  admin: CANONICAL_ROLES.ADMIN,
  administrateur: CANONICAL_ROLES.ADMIN,
  // `manager` est un rôle À PART ENTIÈRE, plus un alias d'administrateur.
  manager: CANONICAL_ROLES.MANAGER,
  chef: CANONICAL_ROLES.CHEF,
  responsable: CANONICAL_ROLES.RESPONSIBLE,
  responsible: CANONICAL_ROLES.RESPONSIBLE,
  tech: CANONICAL_ROLES.TECHNICIAN,
  // « technique » est ce qu'on écrit quand on désigne le métier plutôt que la personne :
  // il passe par le formulaire de création de compte comme par un import JSON. Sans cette
  // ligne il n'était pas un alias mais un INCONNU, et un compte enregistré ainsi retombait
  // en visiteur — il perdait `equipment.edit`, `screen.edit` et `diagnostic.run` sans
  // qu'aucun écran ne le dise, et le serveur lui refusait toute écriture.
  technique: CANONICAL_ROLES.TECHNICIAN,
  technicien: CANONICAL_ROLES.TECHNICIAN,
  technician: CANONICAL_ROLES.TECHNICIAN,
  visiteur: CANONICAL_ROLES.VISITOR,
  visitor: CANONICAL_ROLES.VISITOR
});

/**
 * L'administrateur vient des variables d'environnement, jamais d'un écran.
 * Cette constante existe pour être lue par les gardes, et pour qu'un test échoue
 * bruyamment si quelqu'un la retourne un jour.
 */
export const ADMIN_IS_GRANTABLE = false;

/**
 * RÉSOLUTION STRICTE — le rôle inconnu rend `null`, jamais un visiteur.
 *
 * C'est celle-ci que TOUTE décision d'autorisation doit employer. Un rôle abîmé
 * (« supervisor-x », une faute de frappe, un import douteux) ne doit hériter d'AUCUN
 * plafond : sans cela, une adhésion et une habilitation suffisent à lui ouvrir les
 * lectures du visiteur. Mesuré sur le candidat précédent : un tel compte LISAIT.
 *
 * Elle dérive de la MÊME carte d'alias que `normalizeRole` — une seconde carte serait
 * exactement le défaut que ce lot vient de fermer, avec trois couches qui divergent.
 */
export function resolveKnownRole(role) {
  return ROLE_ALIASES[String(role ?? '').trim().toLowerCase()] || null;
}

/**
 * Repli d'AFFICHAGE : un rôle inconnu se présente comme visiteur, ce qui est sain pour
 * une interface — mieux vaut un écran réduit qu'un écran vide. À ne jamais employer pour
 * décider d'une autorisation : `resolveKnownRole` est là pour cela.
 */
export function normalizeRole(role) {
  return resolveKnownRole(role) ?? CANONICAL_ROLES.VISITOR;
}

export function isHistoricalRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_ALIASES, String(role || '').trim().toLowerCase());
}

/** Rang d'autorité : 0 pour l'administrateur, 5 pour le visiteur. */
export function roleRank(role) {
  const index = ROLE_ORDER.indexOf(normalizeRole(role));
  return index === -1 ? ROLE_ORDER.length - 1 : index;
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || 'Utilisateur';
}

export function isPlatformAdmin(role) {
  return normalizeRole(role) === CANONICAL_ROLES.ADMIN;
}

/**
 * Ce rôle voit-il TOUTES les zones sans y être affilié ?
 *
 * L'administrateur répond de la plateforme entière ; le manager doit pouvoir suivre la
 * chaîne de bout en bout. Les quatre autres rôles ne voient que les zones où ils sont
 * membres et habilités.
 *
 * La règle vit ICI parce que deux couches la posent : le serveur, pour court-circuiter la
 * résolution de zone, et l'écran, pour savoir s'il doit demander à l'utilisateur dans
 * quelle zone il crée. Écrite deux fois, elle divergerait — c'est exactement le défaut que
 * ce lot ferme. Elle est STRICTE : un rôle inconnu ne voit rien.
 */
export function roleSeesEveryZone(role) {
  const canonique = resolveKnownRole(role);
  return canonique === CANONICAL_ROLES.ADMIN || canonique === CANONICAL_ROLES.MANAGER;
}

/**
 * L'acteur a-t-il autorité sur la cible ?
 *
 * STRICTEMENT supérieur : un manager n'administre pas un autre manager, et surtout
 * personne n'a autorité sur l'administrateur — pas même un autre administrateur, ce qui
 * interdit à un compte usurpé de déclasser le compte défini par Railway.
 */
export function canManageRole(actorRole, targetRole) {
  const cible = normalizeRole(targetRole);
  if (cible === CANONICAL_ROLES.ADMIN) return false;
  return roleRank(actorRole) < roleRank(cible);
}

/**
 * Rôles qu'un acteur peut attribuer.
 *
 * `admin` n'y figure JAMAIS, pour aucun acteur : c'est la règle « aucun second
 * administrateur ne peut être ajouté ».
 */
export function assignableRoles(actorRole) {
  const rang = roleRank(actorRole);
  return Object.freeze(ROLE_ORDER.filter(role =>
    role !== CANONICAL_ROLES.ADMIN && ROLE_ORDER.indexOf(role) > rang));
}

/** Rôles visibles dans les listes, du plus étendu au plus restreint. */
export function orderedRoles() {
  return ROLE_ORDER;
}

/**
 * Ce rôle peut-il seulement ATTEINDRE ce magasin en écriture ?
 *
 * C'est un premier filtre, pas l'autorisation finale : le périmètre de zone est décidé
 * ensuite par `canAccessRecord`. « Sait écrire dans ce magasin » et « peut écrire CET
 * enregistrement » restent deux questions.
 *
 * ELLE VIT ICI, ET NON DANS LE SERVEUR. Elle était écrite dans `scripts/serve.js`, qui
 * ouvre un port et une base de données : aucun test ne pouvait l'exécuter, seulement y
 * chercher des chaînes de caractères. Or c'est exactement le motif qui avait laissé passer
 * l'absence de `chef` — une matrice indexée sur le rôle brut, vérifiée par des tests qui
 * ne l'exécutaient jamais.
 */
export function canWriteStoreByRole(role, storeName) {
  // STRICTE : un rôle inconnu n'écrit nulle part. Passer par le repli d'affichage le
  // ferait retomber sur « visiteur », qui n'écrit rien non plus — mais pour la mauvaise
  // raison, et la moindre extension du visiteur rouvrirait la porte.
  const canonique = resolveKnownRole(role);
  if (!canonique) return false;
  /*
   * LE JOURNAL S'AJOUTE, IL NE SE GAGNE PAS.
   *
   * `addLog()` suit presque chaque action métier. Refuser l'ajout à un rôle revient à
   * interrompre l'opération qui vient de réussir, et surtout à effacer de la trace
   * précisément les acteurs qu'on surveille le moins. Mesuré sur `6c3e766` : le Visiteur
   * recevait `403 FORBIDDEN` ici, AVANT même que le contrat Journal du serveur ne soit
   * consulté — donc ses actions n'étaient jamais journalisées.
   *
   * Cette ligne n'ouvre QUE l'ajout : l'immuabilité du journal (`LOG_IMMUTABLE`) et la
   * suppression réservée à l'administrateur sont décidées par le serveur, plus loin. Elle
   * reste sous le refus des rôles inconnus, juste au-dessus : un rôle qu'on ne sait pas
   * lire n'écrit toujours rien, nulle part.
   */
  if (storeName === 'logs') return true;
  if (canonique === CANONICAL_ROLES.ADMIN) return true;
  // Les réglages engagent la plateforme entière : l'administrateur seul y touche.
  if (storeName === 'settings') return false;
  // Les comptes se gèrent selon la hiérarchie : encadrer un responsable, au minimum.
  if (storeName === 'users') return canManageRole(canonique, CANONICAL_ROLES.RESPONSIBLE);
  return canonique !== CANONICAL_ROLES.VISITOR;
}

/** Codes d'erreur, partagés entre le serveur et les tests. */
export const ROLE_ERRORS = Object.freeze({
  INVALID_ROLE: 'INVALID_ROLE',
  ADMIN_NOT_GRANTABLE: 'ADMIN_NOT_GRANTABLE',
  ROLE_HIERARCHY_FORBIDDEN: 'ROLE_HIERARCHY_FORBIDDEN',
  ROLE_ASSIGNMENT_FORBIDDEN: 'ROLE_ASSIGNMENT_FORBIDDEN'
});

/**
 * LA règle d'écriture sur les comptes. Lève une erreur portant un `code` et un `status`.
 *
 * Elle vit ICI, et non dans le serveur, pour une raison précise : `scripts/serve.js` ne
 * peut pas être importé par un test — il ouvre un port et une base. Tant que la règle y
 * était écrite, les tests ne pouvaient qu'y chercher des chaînes de caractères. Un test de
 * mutation l'a montré : remplacer `throw` par `void` laissait TOUS les tests au vert,
 * alors que la plateforme acceptait dès lors un second administrateur. Une règle de
 * sécurité qu'on ne peut pas exécuter dans un test n'est pas vérifiée.
 */
export function assertRoleAssignment(actor, target, requestedRole) {
  const erreur = (message, code, status = 403) =>
    Object.assign(new Error(message), { code, status });

  // Un rôle inconnu était converti en visiteur : demander « foobar » créait donc un
  // visiteur sans que personne ne l'ait voulu, et sans le moindre message.
  if (requestedRole !== undefined && resolveKnownRole(requestedRole) === null) {
    throw erreur(`Rôle inconnu : « ${String(requestedRole)} ». Les rôles valides sont ${ROLE_ORDER.join(', ')}.`,
      ROLE_ERRORS.INVALID_ROLE, 400);
  }
  const demande = requestedRole === undefined ? undefined : normalizeRole(requestedRole);

  // Personne, y compris l'administrateur en place, ne fabrique un second administrateur.
  if (demande === CANONICAL_ROLES.ADMIN) {
    const dejaAdmin = target && normalizeRole(target.role) === CANONICAL_ROLES.ADMIN;
    if (!dejaAdmin) {
      throw erreur(
        "L'administrateur global est défini par les variables d'environnement Railway : aucun second administrateur ne peut être créé.",
        ROLE_ERRORS.ADMIN_NOT_GRANTABLE);
    }
  }

  if (isPlatformAdmin(actor?.role)) return true;

  if (target && !canManageRole(actor?.role, target.role)) {
    throw erreur("Vous n'avez pas autorité sur ce compte.", ROLE_ERRORS.ROLE_HIERARCHY_FORBIDDEN);
  }
  if (demande !== undefined && !assignableRoles(actor?.role).includes(demande)) {
    throw erreur("Vous ne pouvez pas attribuer ce rôle : il est au moins au niveau du vôtre.",
      ROLE_ERRORS.ROLE_ASSIGNMENT_FORBIDDEN);
  }
  return true;
}

export default Object.freeze({
  CANONICAL_ROLES, ROLE_ORDER, ROLE_LABELS, ADMIN_IS_GRANTABLE, ROLE_ERRORS,
  normalizeRole, isHistoricalRole, roleRank, roleLabel,
  isPlatformAdmin, canManageRole, assignableRoles, orderedRoles, canWriteStoreByRole,
  resolveKnownRole,
  assertRoleAssignment
});
