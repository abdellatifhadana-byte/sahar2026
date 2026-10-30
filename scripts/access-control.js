/**
 * UNE SEULE RÉSOLUTION DE RÔLE, EN AMONT DE TOUTE DÉCISION.
 *
 * Ce fichier n'importait rien et indexait `ROLE_CEILINGS[user.role]` avec la chaîne BRUTE
 * telle qu'elle dort en base. Il rattrapait le problème en DUPLIQUANT des lignes d'alias
 * dans la matrice — `responsible` + `responsable`, `technician` + `tech`. Un rattrapage
 * manuel est partiel par nature : `chef`, `administrateur`, `technicien` et `visiteur`
 * manquaient.
 *
 * Mesuré sur la baseline 457fe1dd, trois couches répondaient TROIS choses différentes à la
 * même question :
 *
 *     entrée           roles.js      navigation-contract   ROLE_CEILINGS
 *     technicien       technician    visitor               ABSENT
 *     chef             chef          chef                  ABSENT
 *
 * Or « Technicien » est le libellé que la plateforme AFFICHE elle-même. Un compte
 * enregistré ainsi était traité en visiteur par la navigation, privé de tout plafond ici —
 * donc un instantané `/api/sync` entièrement vide — et pourtant autorisé à écrire par
 * `canWriteByRole`, qui, lui, normalisait déjà.
 *
 * Le remède n'est pas d'ajouter `chef:` à la matrice : c'est de normaliser AVANT de
 * décider, une fois, avec la fonction que le reste de la plateforme utilise déjà.
 */
import { resolveGrilleCentraleCandidate, estReconnuParLesEcransPublics } from './grille-centrale-identity.js';
import { resolveKnownRole, roleSeesEveryZone, CANONICAL_ROLES, ROLE_ERRORS } from '../roles.js';
import { PermissionManager } from '../permissions.js';
import { compareAndWrite, tombstoneWithRevision } from './revision-store.js';
import { withRevision } from '../revision-contract.js';
import { validateLocationHierarchy, locationLevel, locationPath } from '../location-contract.js';

/**
 * Le rôle canonique d'un utilisateur — ou `null` s'il est inconnu.
 *
 * STRICT, délibérément. Le repli d'affichage de `normalizeRole` rend « visiteur » pour
 * l'inconnu ; ici, cela vaudrait plafond visiteur, et une adhésion plus une habilitation
 * ouvriraient des lectures à un rôle abîmé. Mesuré : un compte « supervisor-x » ainsi
 * équipé LISAIT. `null` ne trouve aucun plafond, donc tout est refusé.
 */
const roleOf = user => resolveKnownRole(user?.role);
const isAdmin = user => roleOf(user) === CANONICAL_ROLES.ADMIN;
/**
 * Admin et manager voient l'ensemble de la chaîne sans passer par les zones.
 *
 * La règle est énoncée dans `roles.js` : l'écran a besoin de la même réponse pour savoir
 * s'il doit demander dans quelle zone on crée. Deux formulations divergeraient.
 */
const seesEveryZone = user => roleSeesEveryZone(user?.role);

/** Une salle rattachée à plusieurs zones qui se contredisent : arbitrage humain requis. */
const ROOM_ZONE_CONFLICT = 'ROOM_ZONE_CONFLICT';

/*
 * COMMENT ON RECONNAÎT LA GRILLE CENTRALE PARMI LES ÉQUIPEMENTS.
 *
 * Ce ne sont pas des données d'installation : c'est la clé de catalogue qui relie une fiche
 * à un modèle, et les libellés sous lesquels l'inventaire 2M a pu la saisir avant que cette
 * clé existe. Ils ne disent ni où l'appareil est posé, ni à quoi il est relié, ni ce qu'il
 * route — donc rien de ce que #137 retire du bundle.
 */
/*
 * L'IDENTITÉ DE LA GRILLE N'EST PLUS DÉCIDÉE ICI — ELLE EST LUE (#166).
 *
 * Ces deux constantes vivaient dans ce fichier, et le bootstrap opérationnel en avait sa
 * propre version, PLUS LARGE. Une fiche réelle nommée d'un libellé documenté que seul le
 * bootstrap connaissait était donc reconnue par lui, ignorée par ce resolver, et gelée par
 * le marqueur : 403 permanent, sans récupération automatique.
 *
 * `scripts/grille-centrale-identity.js` porte désormais la règle, une seule fois, avec les
 * libellés que le dossier documente. Rien n'est élargi : lien de catalogue d'abord, alias de
 * nom ensuite, refus dès qu'il y a deux candidats.
 */

const ACCESS_STORES = new Set([
  'zones', 'resource_zones', 'zone_memberships', 'zone_grants', 'access_requests', 'access_audit'
]);

const PERMISSIONS = Object.freeze([
  'zone.summary.read',
  'equipment.read', 'equipment.edit',
  'screen.read', 'screen.edit',
  'cable.read', 'cable.edit',
  'topology.read', 'topology.edit',
  'ticket.read', 'ticket.create', 'ticket.edit',
  'note.read', 'note.create',
  'diagnostic.run', 'procedure.read',
  'continuity.read', 'continuity.edit', 'continuity.validate', 'continuity.test',
  'diagram.read', 'diagram.edit', 'diagram.validate',
  'access.review', 'users.manage',
  // DEUX NOTIONS, DEUX NOMS.
  //
  // `rooms` était gardé par `zone.manage`, que `zone-access.js:32` étiquette « Gérer les
  // zones ». Un même nom couvrait donc « modifier UNE SALLE » et « administrer UNE ZONE ».
  // Donner au chef de quoi éditer une salle revenait à lui promettre l'administration des
  // accès — que son contrat de navigation lui refuse, `zoneAccess` restant au-dessus de lui.
  //
  // La séparation n'ouvre aucune porte : `zone.manage` ne gardait QUE l'écriture des
  // salles (`canManageZone` se décide sur le rôle et la responsabilité de zone, jamais sur
  // cette permission), et seuls admin et manager pouvaient la détenir — or ils
  // court-circuitent déjà les zones.
  'room.edit', 'zone.manage'
]);

const sauf = (...exclues) => new Set(PERMISSIONS.filter(permission => !exclues.includes(permission)));

/**
 * Le PLAFOND de chaque rôle — ce qu'il peut au maximum détenir, jamais ce qu'il détient.
 * L'autorité réelle reste « plafond ∧ adhésion ∧ habilitation », zone par zone.
 *
 * Indexé par les SIX rôles canoniques, et par eux seuls : plus aucune ligne d'alias, parce
 * que `roleOf()` a déjà tranché en amont.
 *
 * Le plafond du chef reprend ce que `permissions.js` lui accorde déjà côté écran — comptes,
 * salles, validation de continuité et de schémas — sinon l'interface promettrait ce que
 * l'API refuse. Il ne reçoit PAS pour autant le court-circuit d'admin/manager : c'est ce
 * qui en fait un rôle de périmètre et non un second administrateur.
 */
const ROLE_CEILINGS = Object.freeze({
  [CANONICAL_ROLES.ADMIN]: new Set(PERMISSIONS),
  [CANONICAL_ROLES.MANAGER]: new Set(PERMISSIONS),
  // Le chef édite les salles — `permissions.js` lui donne create/edit/assign — mais
  // n'administre NI les zones NI la revue des accès : `navigation-contract.js` place
  // `zoneAccess` et `integrity` au-dessus de lui. Le serveur dit désormais la même chose
  // que l'écran, au lieu de promettre plus.
  [CANONICAL_ROLES.CHEF]: sauf('zone.manage', 'access.review'),
  // Le responsable ne crée, ne modifie ni n'assigne de salle côté écran : son plafond ne
  // doit pas lui en donner le moyen par appel direct.
  [CANONICAL_ROLES.RESPONSIBLE]: sauf('users.manage', 'zone.manage', 'room.edit'),
  [CANONICAL_ROLES.TECHNICIAN]: sauf('users.manage', 'zone.manage', 'room.edit', 'access.review',
    'continuity.edit', 'continuity.validate', 'diagram.edit', 'diagram.validate'),
  [CANONICAL_ROLES.VISITOR]: new Set(['zone.summary.read', 'equipment.read', 'screen.read',
    'ticket.read', 'note.read', 'procedure.read'])
});

const READ_PERMISSION_BY_STORE = Object.freeze({
  rooms: 'zone.summary.read',
  baies: 'equipment.read', equipments: 'equipment.read',
  walls: 'screen.read', screens: 'screen.read', screen_groups: 'screen.read',
  cables: 'cable.read', cable_reports: 'cable.read',
  tickets: 'ticket.read', notes: 'note.read',
  docs: 'procedure.read', faq: 'procedure.read',
  screen_issues: 'diagnostic.run', diagnosis_history: 'diagnostic.run',
  attachments: 'note.read',
  // `logs` n'apparaît plus ici : le journal a son propre contrat, décidé par la matrice
  // canonique dans `journalAutorise`. Le laisser pointer vers `ticket.read` faisait
  // dépendre la lecture du journal des droits d'un AUTRE objet, et d'une zone qu'une
  // entrée de journal n'a pas.
  logs: null
});

/*
 * LA MATRICE CANONIQUE FAIT AUTORITÉ SUR LES MUTATIONS — TYPE PAR TYPE, ACTION PAR ACTION.
 *
 * `permissionForStore()` ramène toute action non-lecture à la permission d'ÉCRITURE du
 * magasin. C'est assez pour décider d'une ZONE, jamais pour décider d'un ACTE : trois
 * divergences mesurées contre `permissions.js` en découlaient, toutes du même raccourci.
 *
 *   Chef        `delete` se résolvait en `room.edit` / `equipment.edit`, qu'il détient.
 *               Il supprimait donc salles, baies et équipements — la matrice lui déclare
 *               `delete:false` sur les trois.
 *   Responsable `baies` partage `equipment.edit`, qu'il détient. Il éditait donc une BAIE
 *               — la matrice lui déclare `baies.edit:false`.
 *   Technicien  détient `equipment.edit` à son plafond : il éditait équipements et baies
 *               — la matrice les lui déclare `false`.
 *
 * La zone dit OÙ l'on peut agir ; la matrice dit CE QU'on a le droit de faire. Les deux
 * sont nécessaires, et celle-ci manquait. Elle est consultée AVANT `seesEveryZone` — même
 * emplacement, et même raison, que le contrat du journal : une règle qui ne vaut pas pour
 * tous ne prouve rien. Les rôles globaux la passent parce que la matrice les autorise,
 * non parce qu'ils court-circuitent.
 *
 * Ne sont couverts que les magasins dont la matrice porte une entrée qui leur est PROPRE.
 * Les autres gardent exactement le contrat d'aujourd'hui : cette garde ferme un écart,
 * elle n'en invente pas un second.
 */
const MATRIX_ENTITY_BY_STORE = Object.freeze({
  rooms: 'rooms', baies: 'baies', equipments: 'equipments', walls: 'walls', screens: 'screens',
  /*
   * LE CÂBLE EMPRUNTE LE PLAFOND DES ÉQUIPEMENTS — DÉCISION MÉTIER, PAS DÉDUCTION.
   *
   * `cables` n'est pas une entité de la matrice canonique, et il a été décidé de ne pas
   * l'y ajouter cette semaine. Sans plafond, un câble n'était gouverné que par
   * l'habilitation de zone `cable.edit` : un technicien qui la recevait agissait comme un
   * chef, ce qu'aucun rôle ne devrait pouvoir gagner par une habilitation.
   *
   * Le câble relie des équipements ; il emprunte donc leur plafond. L'habilitation de zone
   * reste exigée par ailleurs (`WRITE_PERMISSION_BY_STORE.cables = 'cable.edit'`), si bien
   * que l'autorisation demande LES DEUX — plafond de rôle ET périmètre. La règle est
   * écrite une seule fois côté écran dans `cable-permissions-contract.js`, et le serveur
   * en applique ici la même moitié « plafond ».
   */
  cables: 'equipments'
});

/*
 * LA MATRICE CANONIQUE EST LE PLAFOND DE TOUTE MUTATION — DÉCISION MÉTIER.
 *
 * Une habilitation de zone DÉLÈGUE un pouvoir à l'intérieur d'un périmètre ; elle
 * n'ÉLÈVE pas le rôle qui la reçoit. Un technicien porteur d'`equipment.edit` sur sa zone
 * agit dans cette zone AVEC les droits de son rôle — il n'acquiert pas ceux d'un rôle
 * supérieur. Les deux questions sont distinctes et doivent toutes deux répondre oui :
 *
 *     « ce rôle a-t-il le droit de faire cet acte ? »   ← la matrice, ici
 *     « et a-t-il autorité sur CE périmètre ? »         ← la zone, plus bas
 *
 * Avant cette garde, seule la seconde était posée, et la première était déduite de la
 * permission d'ÉCRITURE du magasin (`permissionForStore`). D'où trois écarts mesurés :
 * le Chef supprimait les trois types (`delete:false` dans la matrice), le Responsable
 * éditait une baie (`baies.edit:false` — `baies` partage `equipment.edit`), et le
 * technicien éditait équipements et baies (`edit:false`).
 *
 * Placée AVANT `seesEveryZone`, elle vaut pour tous, administrateur compris — même
 * emplacement, et même raison, que le contrat du journal juste au-dessus : une règle qui
 * ne vaut pas pour tous ne prouve rien. Les rôles globaux la passent parce que la matrice
 * les autorise, non parce qu'ils court-circuitent.
 *
 * Ne sont couverts que les magasins dont la matrice porte une entrée qui leur est PROPRE :
 * cette garde ferme un écart, elle n'en invente pas un second.
 */
const MATRIX_ACTION_BY_ACTION = Object.freeze({
  create: 'create', update: 'edit', delete: 'delete'
});

/** La matrice autorise-t-elle CET acte, sur CE type ? `null` quand elle ne se prononce pas. */
function matriceCanoniqueAutorise(user, storeName, action) {
  const entite = MATRIX_ENTITY_BY_STORE[storeName];
  const acte = MATRIX_ACTION_BY_ACTION[action];
  if (!entite || !acte) return null;
  return PermissionManager.check(user, entite, acte);
}

const WRITE_PERMISSION_BY_STORE = Object.freeze({
  rooms: 'room.edit',
  baies: 'equipment.edit', equipments: 'equipment.edit',
  walls: 'screen.edit', screens: 'screen.edit', screen_groups: 'screen.edit',
  cables: 'cable.edit', cable_reports: 'cable.edit',
  tickets: 'ticket.edit', notes: 'note.create',
  docs: null, faq: null,
  screen_issues: 'diagnostic.run', diagnosis_history: 'diagnostic.run',
  attachments: 'note.create',
  // Idem : aucune écriture de journal ne passe plus par le contrat des tickets.
  logs: null
});

/*
 * CATALOGUE vs OPÉRATIONNEL — #118.
 *
 * `screen_issues` mélangeait deux natures sous un seul magasin : une DÉFINITION DE
 * DIAGNOSTIC générique (« Écran noir », ses étapes) et un INCIDENT OPÉRATIONNEL attaché à
 * un écran réel. La première n'a pas de zone par construction ; `resolveResourceZones` en
 * rendait donc `[]`, et la règle fail-closed de `canAccessRecord` refusait TOUT rôle à
 * périmètre — y compris ceux que `diagnostic.run` habilite explicitement à diagnostiquer.
 * Admin et Manager ne le voyaient pas : ils court-circuitent les zones plus haut.
 *
 * `appliesToAll` NE PEUT PAS trancher cette question : c'est un indice de RAPPROCHEMENT
 * (« à quels écrans ce problème s'applique »), pas une classification de CONFIANCE. Un
 * enregistrement peut porter `appliesToAll:true` ET `screenIds:['écran de Zone A']` en même
 * temps — le décor `scripts/screen-diag-decor.mjs` le fait déjà. Traiter `appliesToAll`
 * comme « donc lisible sans zone » aurait publié les identifiants de CET écran à qui n'y a
 * aucun droit.
 *
 * La classification explicite est donc `scope:'catalog' | 'operational'`, avec un défaut
 * fail-closed : tout ce qui n'est pas EXPLICITEMENT `catalog`, et sans le moindre
 * attachement opérationnel, reste `operational` et suit `resolveResourceZones` comme avant.
 */
const SCREEN_ISSUE_ATTACHMENT_FIELDS = Object.freeze(['screenId', 'screenIds', 'groupIds', 'roomId']);

/**
 * Ce `screen_issues` désigne-t-il une ressource opérationnelle réelle ?
 *
 * Un tableau vide ou `null` ne compte pas : c'est l'absence d'attachement, pas un
 * attachement vide. Un identifiant réel — scalaire ou dans un tableau non vide — compte,
 * quel que soit le champ qui le porte.
 */
function hasOperationalAttachment(record) {
  for (const field of SCREEN_ISSUE_ATTACHMENT_FIELDS) {
    const value = record?.[field];
    if (Array.isArray(value)) { if (value.length) return true; continue; }
    if (value !== undefined && value !== null && value !== '') return true;
  }
  return false;
}

/**
 * Ce `screen_issues` est-il une définition de CATALOGUE, lisible sans zone ?
 *
 * VRAI seulement si les deux tiennent À LA FOIS :
 *   1. `scope:'catalog'` explicite, OU le repli historique décrit ci-dessous ;
 *   2. AUCUN attachement opérationnel.
 *
 * Un attachement disqualifie IMMÉDIATEMENT, avant même de regarder `scope` — un
 * enregistrement `scope:'catalog'` qui porterait quand même un `screenIds` ne devient pas
 * lisible sans zone pour autant : l'écriture qui produirait cette contradiction est refusée
 * ailleurs (`isContradictoryCatalogWrite`), et si un tel enregistrement existait malgré
 * tout — donnée héritée, bogue futur — cette fonction le fait retomber sur le chemin
 * opérationnel normal plutôt que de le rendre globalement lisible.
 *
 * REPLI HISTORIQUE, LECTURE SEULEMENT : `appliesToAll===true` sans attachement et sans
 * `scope` explicite est traité comme une définition de catalogue historique. Il ne devient
 * PAS le nouveau contrat d'écriture — un nouvel enregistrement doit porter `scope:'catalog'`
 * explicitement. Un `scope:'operational'` explicite, lui, n'entre jamais dans ce repli, même
 * sans attachement : une classification énoncée prime sur une déduction.
 */
function isCatalogDefinition(record) {
  if (!record || hasOperationalAttachment(record)) return false;
  if (record.scope === 'catalog') return true;
  if (record.scope === undefined && record.appliesToAll === true) return true;
  return false;
}

/**
 * Une ÉCRITURE qui affirme `scope:'catalog'` tout en désignant une ressource opérationnelle
 * est une contradiction, jamais une donnée à corriger en silence. La stripper produirait un
 * enregistrement dont le sens a changé sans que personne ne l'ait demandé ; le serveur
 * refuse l'écriture entière à la place — voir `scripts/serve.js`, route `/api/data/:store/:id`.
 */
function isContradictoryCatalogWrite(record) {
  return record?.scope === 'catalog' && hasOperationalAttachment(record);
}

const permissionForRecord = (storeName, record, action) => {
  if (storeName === 'docs' && String(record?.kind || '').startsWith('topology_')) {
    return action === 'read' ? 'topology.read' : 'topology.edit';
  }
  if (storeName === 'docs' && String(record?.kind || '').startsWith('continuity_')) {
    return action === 'read' ? 'continuity.read' : 'continuity.edit';
  }
  if (storeName === 'docs' && record?.kind === 'technical_diagram') {
    return action === 'read' ? 'diagram.read' : 'diagram.edit';
  }
  return action === 'read' ? READ_PERMISSION_BY_STORE[storeName] : WRITE_PERMISSION_BY_STORE[storeName];
};

const singularType = value => ({
  rooms: 'room', baies: 'baie', equipments: 'equipment', walls: 'wall', screens: 'screen',
  screen_groups: 'screen_group', screen_issues: 'screen_issue', diagnosis_history: 'diagnosis',
  tickets: 'ticket', notes: 'note', docs: 'doc', faq: 'faq', attachments: 'attachment',
  cables: 'cable', cable_reports: 'cable_report', logs: 'log'
})[String(value)] || String(value || '').replace(/s$/, '');

const pluralStore = value => ({
  room: 'rooms', salle: 'rooms', rooms: 'rooms',
  baie: 'baies', baies: 'baies',
  equipment: 'equipments', equipments: 'equipments', equipement: 'equipments', equipements: 'equipments',
  wall: 'walls', walls: 'walls', mur: 'walls',
  screen: 'screens', screens: 'screens', ecran: 'screens',
  ticket: 'tickets', tickets: 'tickets',
  note: 'notes', notes: 'notes',
  doc: 'docs', docs: 'docs', faq: 'faq',
  cable: 'cables', cables: 'cables',
  screen_issue: 'screen_issues', issue: 'screen_issues',
  diagnosis: 'diagnosis_history', diagnostic: 'diagnosis_history',
  attachment: 'attachments', attachments: 'attachments',
  log: 'logs', logs: 'logs'
})[String(value || '').toLowerCase()] || null;

const nowIso = () => new Date().toISOString();
const activeAt = (record, now = Date.now()) => {
  if (!record || record.status === 'inactive' || record.status === 'revoked') return false;
  if (record.startsAt && new Date(record.startsAt).getTime() > now) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) return false;
  return true;
};

/**
 * Les zones où `permission` est RÉELLEMENT détenue — UNE SEULE ÉCRITURE DE LA RÈGLE.
 *
 * La règle elle-même n'a jamais varié : il faut une adhésion ACTIVE **et** une habilitation
 * ACTIVE portant cette permission, DANS LA MÊME ZONE. Une adhésion en zone A plus une
 * habilitation en zone B ne se combinent jamais.
 *
 * Elle était pourtant écrite DEUX fois — dans `hasPermission` et dans
 * `hasEffectivePermissionSomewhere` — et le périmètre d'image de `contextFor` (A02) allait
 * en produire une troisième. Trois copies d'une règle d'autorisation, ce sont trois
 * occasions de diverger : la porte de l'image se serait ouverte là où celle de la lecture
 * reste fermée, sans qu'aucun test ne le voie. Il n'y a plus qu'une règle, et les trois
 * appelants la consultent.
 *
 * Elle ne lit rien elle-même : les listes lui arrivent DÉJÀ FILTRÉES par `activeAt`. C'est
 * ce qui rend une révocation immédiate — le dossier révoqué quitte ces listes, donc la zone
 * quitte l'ensemble au tout prochain appel, sans cache à invalider.
 */
const zonesOuLaPermissionEstDetenue = (memberships, grants, permission) => {
  const zonesAdherees = new Set(memberships.map(item => String(item.zoneId)));
  return new Set(grants
    .filter(item => item.permission === permission && zonesAdherees.has(String(item.zoneId)))
    .map(item => String(item.zoneId)));
};

const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const slugify = value => String(value || 'zone').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'zone';
const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined && value !== '').map(String))];

export function createAccessControl(pool) {
  async function get(storeName, id, client = pool) {
    if (id === null || id === undefined || id === '') return null;
    const result = await client.query(
      'SELECT data FROM platform_records WHERE store_name=$1 AND record_id=$2 AND deleted=FALSE LIMIT 1',
      [storeName, String(id)]
    );
    return result.rows[0]?.data || null;
  }

  async function list(storeName, client = pool) {
    const result = await client.query(
      'SELECT record_id,data,updated_at FROM platform_records WHERE store_name=$1 AND deleted=FALSE ORDER BY updated_at,record_id',
      [storeName]
    );
    return result.rows.map(row => row.data);
  }

  /**
   * Écriture SERVEUR : elle ne se compare à rien, mais elle fait avancer la révision.
   *
   * Migration au démarrage, rattachement de zone, restauration d'archive, import : ce sont
   * des décisions prises sur un ensemble, pas la modification d'une fiche ouverte. Les
   * soumettre à la comparaison bloquerait un import légitime ; ne pas faire avancer la
   * révision laisserait les sessions déjà ouvertes écraser ce qui vient d'être écrit.
   */
  async function put(storeName, id, record, client = pool) {
    const payload = { ...record, id: record?.id ?? id };
    const ecriture = await compareAndWrite(pool, {
      storeName, recordId: String(id), record: payload, force: true, client: client === pool ? null : client
    });
    // `withRevision` pose le compteur sur SON champ. L'écrire à la main sous le nom
    // `revision` écraserait l'étiquette métier d'un schéma ou d'un groupe de continuité.
    return ecriture.revision ? withRevision(payload, ecriture.revision) : payload;
  }

  async function tombstone(storeName, id, client = pool) {
    // La pierre tombale conserve la révision : sans elle, une recréation repartirait sous
    // les sessions restées ouvertes sur l'ancienne version.
    await tombstoneWithRevision(pool, {
      storeName, recordId: String(id), client: client === pool ? null : client
    });
  }

  async function audit(entry, client = pool) {
    const id = makeId('AUD');
    await put('access_audit', id, {
      id,
      actorId: entry.actorId ?? null,
      subjectId: entry.subjectId ?? null,
      zoneId: entry.zoneId ?? null,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: entry.requestId ?? null,
      at: nowIso()
    }, client);
    return id;
  }

  async function ensureModel() {
    // Automatic transitional zones: every existing room gets a zone summary and resource mapping.
    // This gives the admin something immediately assignable without leaking room details to users.
    const rooms = await list('rooms');
    const zones = await list('zones');
    const zoneIds = new Set(zones.map(zone => String(zone.id)));
    const zonesById = new Map(zones.map(zone => [String(zone.id), zone]));
    const mappings = await list('resource_zones');
    const mappingKeys = new Set(mappings.map(mapping => `${mapping.resourceType}:${mapping.resourceId}:${mapping.zoneId}`));

    for (const room of rooms) {
      /*
       * MIGRATION DÉTERMINISTE — quatre cas, et un seul résultat par cas.
       *
       * L'ancienne ligne était `room.zoneId || explicitMapping?.zoneId || 'room-'+id` :
       * le champ HÉRITÉ passait AVANT le rattachement explicite. Une salle déplacée par
       * l'écran des accès revenait donc à son ancienne zone au redémarrage suivant, sans
       * que rien ne le dise.
       */
      const existingRoomMappings = mappings.filter(mapping =>
        singularType(mapping.resourceType) === 'room' && String(mapping.resourceId) === String(room.id)
      );
      const explicites = unique(existingRoomMappings
        .filter(mapping => !zonesById.get(String(mapping.zoneId))?.autoCreatedFromRoomId)
        .map(mapping => mapping.zoneId));
      const transitoires = unique(existingRoomMappings
        .filter(mapping => zonesById.get(String(mapping.zoneId))?.autoCreatedFromRoomId)
        .map(mapping => mapping.zoneId));
      // Un identifiant hérité ne vaut que s'il désigne une zone qui existe : promouvoir un
      // identifiant mort fabriquerait un rattachement vers rien, donc une salle que
      // personne ne peut plus atteindre.
      const heritees = unique([...(Array.isArray(room.zoneIds) ? room.zoneIds : []), room.zoneId])
        .filter(zoneId => zoneIds.has(String(zoneId)));
      const divergentes = heritees.filter(zoneId => !explicites.includes(String(zoneId)));

      // CAS 4 — plusieurs zones explicites, ou un héritage qui contredit le rattachement.
      // On ne fusionne pas, on ne choisit pas : on signale et on laisse en l'état. La
      // preuve — y compris le champ hérité — est CONSERVÉE pour que l'administrateur voie
      // ce qu'il doit arbitrer. La fermeture est assurée à l'exécution : une salle à
      // plusieurs zones exige TOUTES ses zones, donc elle n'élargit rien.
      if (explicites.length > 1 || (explicites.length && divergentes.length)) {
        await audit({
          actorId: null, subjectId: null, zoneId: explicites[0] ?? null,
          action: 'room-zone.conflict',
          before: { legacyZoneIds: heritees }, after: { canonicalZoneIds: explicites }
        });
        continue;
      }

      // CAS 1 — un rattachement explicite : c'est LA vérité.
      // CAS 2 — aucun, mais un héritage valide : il devient le rattachement.
      // CAS 3 — ni l'un ni l'autre : zone transitoire, et son rattachement canonique.
      const zoneId = String(explicites[0] ?? heritees[0] ?? transitoires[0] ?? `room-${room.id}`);
      if (!zoneIds.has(zoneId)) {
        const createdZone = {
          id: zoneId,
          name: room.name || room.nom || `Salle ${room.id}`,
          slug: slugify(room.name || room.nom || `salle-${room.id}`),
          publicSummary: room.publicSummary || 'Zone technique 2M. Accès détaillé soumis à autorisation.',
          imageUrl: room.imageUrl || room.image || '',
          status: 'active',
          autoCreatedFromRoomId: room.id,
          createdAt: nowIso(), updatedAt: nowIso()
        };
        await put('zones', zoneId, createdZone);
        zoneIds.add(zoneId);
        zonesById.set(zoneId, createdZone);
      }
      const key = `room:${room.id}:${zoneId}`;
      if (!mappingKeys.has(key)) {
        const id = `RZ-room-${room.id}-${zoneId}`;
        await put('resource_zones', id, { id, resourceType: 'room', resourceId: room.id, zoneId, createdAt: nowIso() });
        mappingKeys.add(key);
      }
      // Une zone transitoire devenue inutile ne doit pas survivre à côté du rattachement
      // retenu : deux rattachements pour une salle, c'est le conflit qu'on vient d'écarter.
      for (const mapping of existingRoomMappings) {
        if (String(mapping.zoneId) !== zoneId) await tombstone('resource_zones', mapping.id);
      }
      // Le champ hérité a fini son office : il devient une seconde vérité s'il reste.
      if (room.zoneId !== undefined || room.zoneIds !== undefined) {
        const { zoneId: _herite, zoneIds: _herites, ...propre } = room;
        await put('rooms', room.id, propre);
      }

      /*
       * `room.responsibleId` NE FABRIQUE PLUS D'AUTORITÉ AU DÉMARRAGE (A-1).
       *
       * Ce bloc lisait `room.responsibleId` et écrivait, par `put()` direct, une adhésion
       * `responsible: true` puis vingt-quatre habilitations — `equipment.edit`,
       * `topology.edit`, `continuity.validate`, `diagram.validate`, `access.review` — en
       * les attribuant toutes à `grantedBy: 1`, c'est-à-dire à l'administrateur global.
       *
       * Mesuré au commit a3e2dd0, sur PostgreSQL réel : un chef ne détenant que `room.edit`
       * et `zone.summary.read` écrivait `responsibleId` sur sa propre salle — le serveur ne
       * validait pas ce champ — et obtenait 23 habilitations NOUVELLES au redémarrage
       * suivant, sans une seule entrée dans `access_audit`. Pointé vers un tiers, le même
       * champ installait un responsable de zone ; pointé vers un visiteur, il persistait
       * quatre habilitations AU-DESSUS de son plafond de rôle, prêtes à s'activer le jour
       * d'une promotion. Retirer le champ ne révoquait rien.
       *
       * Les quatre gardes qui existent pour ce même acte vivent sur le chemin explicite,
       * dans ce fichier : `RESPONSIBLE_ASSIGN_ADMIN_ONLY` et `audit()` dans
       * `ensureMembership`, `ROLE_CEILING` et `DELEGATION_CEILING` dans `grantPermission`.
       * Un `put()` direct les contournait toutes les quatre.
       *
       * Une modification de salle ne crée donc plus AUCUNE autorité ici. L'assignation
       * légitime passe par `applyResponsibleAssignment()`, au moment de l'écriture, avec
       * son acteur réel, ses plafonds et sa trace — et non « au prochain démarrage ».
       *
       * Les lignes héritées (`source: 'room-responsible-migration'`) ne sont PAS supprimées
       * ici : leur origine n'est pas imputable individuellement, et un démarrage n'est pas
       * le lieu d'une purge. Voir le rapport de migration qui accompagne ce correctif.
       */
    }
  }

  function roleAllows(user, permission) {
    if (!user) return false;
    return Boolean(ROLE_CEILINGS[roleOf(user)]?.has(permission));
  }

  /**
   * LE CONTRAT DU JOURNAL — quatre actions, quatre réponses.
   *
   *   lire      `logs.view`   Admin, Manager, Chef, Responsable. La matrice le disait déjà ;
   *                           le serveur, lui, gouvernait par `ticket.read`, si bien qu'un
   *                           Chef ou un Responsable ne voyait AUCUNE entrée.
   *   ajouter   tout utilisateur authentifié. `addLog()` suit presque chaque action métier :
   *                           le refuser interromprait l'opération qui vient de réussir.
   *                           L'identité et l'horodatage sont posés par `serve.js`, jamais
   *                           déclarés par le client.
   *   modifier  PERSONNE. Un journal réécrit ne prouve plus rien de ce qu'il enregistre —
   *                           pas même par l'administrateur, qui est aussi celui dont la
   *                           trace compte le plus.
   *   effacer   `logs.clear`  l'administrateur seul, selon la matrice actuelle.
   *
   * Aucune permission n'est inventée ici : `logs.view` et `logs.clear` existent déjà dans
   * `permissions.js`. `logs.import` et `logs.delete` restent indéfinis, donc fermés.
   */
  function journalAutorise(user, action) {
    if (action === 'read') return PermissionManager.check(user, 'logs', 'view');
    if (action === 'create') return true;
    if (action === 'delete') return PermissionManager.check(user, 'logs', 'clear');
    return false;
  }

  async function activeMemberships(userId, client = pool) {
    return (await list('zone_memberships', client)).filter(item => String(item.userId) === String(userId) && activeAt(item));
  }

  async function activeGrants(userId, client = pool) {
    return (await list('zone_grants', client)).filter(item => String(item.userId) === String(userId) && activeAt(item));
  }

  async function hasPermission(user, zoneId, permission, client = pool) {
    if (!user) return false;
    if (seesEveryZone(user)) return true;
    if (!roleAllows(user, permission)) return false;
    const [memberships, grants] = await Promise.all([activeMemberships(user.id, client), activeGrants(user.id, client)]);
    return zonesOuLaPermissionEstDetenue(memberships, grants, permission).has(String(zoneId));
  }

  /**
   * Cet utilisateur détient-il RÉELLEMENT `permission`, dans AU MOINS UNE zone ?
   *
   * `roleAllows()` ne dit que le PLAFOND — « ce qu'un rôle peut au maximum détenir, jamais
   * ce qu'il détient » (voir l'en-tête de ce fichier). L'utiliser seul pour une décision de
   * lecture fait exactement l'erreur que ce commentaire prévient depuis le début : un
   * Technicien SANS LA MOINDRE adhésion ni habilitation passait quand même, du seul fait
   * que son rôle autorise `diagnostic.run` en théorie.
   *
   * `hasPermission()` exige une zone précise, connue d'avance. Le catalogue de diagnostic
   * n'EN A PAS — c'est ce qui le définit — donc aucune zone à lui passer. Cette fonction
   * porte la même exigence — adhésion ET habilitation, dans LA MÊME zone active — sans
   * exiger de connaître laquelle : elle vérifie qu'il EN EXISTE au moins une où les deux se
   * recoupent. Une adhésion en zone A et une habilitation en zone B ne se combinent jamais :
   * `grants` est filtré aux zones où l'appelant est membre AVANT la recherche.
   */
  async function hasEffectivePermissionSomewhere(user, permission, client = pool) {
    if (!user) return false;
    if (seesEveryZone(user)) return true;
    if (!roleAllows(user, permission)) return false;
    const [memberships, grants] = await Promise.all([activeMemberships(user.id, client), activeGrants(user.id, client)]);
    return zonesOuLaPermissionEstDetenue(memberships, grants, permission).size > 0;
  }

  async function isZoneResponsible(user, zoneId, client = pool) {
    if (!user) return false;
    if (seesEveryZone(user)) return true;
    if (roleOf(user) !== CANONICAL_ROLES.RESPONSIBLE) return false;
    const memberships = await activeMemberships(user.id, client);
    return memberships.some(item => String(item.zoneId) === String(zoneId) && item.responsible === true) &&
      await hasPermission(user, zoneId, 'access.review', client);
  }

  async function preferExplicitZones(zoneIds, client = pool) {
    const candidates = unique(zoneIds);
    if (candidates.length < 2) return candidates;
    const zones = await list('zones', client);
    const zonesById = new Map(zones.map(zone => [String(zone.id), zone]));
    const explicit = candidates.filter(zoneId => !zonesById.get(String(zoneId))?.autoCreatedFromRoomId);
    // Transitional zones exist only to make an unmapped legacy room assignable.
    // Once an explicit mapping exists they must not expand authorization scope.
    return explicit.length ? explicit : candidates;
  }

  async function directMappings(resourceType, resourceId, client = pool) {
    const normalized = singularType(resourceType);
    const mappings = await list('resource_zones', client);
    return preferExplicitZones(mappings
      .filter(mapping => singularType(mapping.resourceType) === normalized && String(mapping.resourceId) === String(resourceId))
      .map(mapping => mapping.zoneId), client);
  }

  /* ────────────────────────── une salle, une zone, une source
   *
   * `room.zoneId` et `room.zoneIds` sont des données HÉRITÉES : elles servent d'entrée à la
   * migration, jamais de vérité d'exécution. Lire les deux sources et en faire l'union
   * élargissait le périmètre — l'état `room.zoneId = zone-1` avec `resource_zones = zone-2`
   * a été observé, et la salle devenait lisible depuis zone-1 comme depuis zone-2.
   *
   * `locationId` est une autre notion et n'entre pas ici : il dit OÙ la salle se trouve
   * (Casablanca › Siège › Département), la zone dit QUI y accède. Une salle du Département
   * Technique peut relever de la zone STC ; l'un ne se déduit jamais de l'autre.
   */
  async function zonesForRoom(roomId, client = pool) {
    if (roomId === null || roomId === undefined || roomId === '') return [];
    return directMappings('room', roomId, client);
  }

  /** Les rattachements bruts d'une salle, y compris ceux qui se contredisent. */
  async function roomMappings(roomId, client = pool) {
    const mappings = await list('resource_zones', client);
    return mappings.filter(mapping =>
      singularType(mapping.resourceType) === 'room' && String(mapping.resourceId) === String(roomId));
  }

  async function resolveResourceZones(storeName, record, client = pool, depth = 0) {
    if (!record || depth > 5) return [];
    // La salle ne consulte QUE son rattachement, même si la charge utile porte un `zoneId` :
    // à la création il est un argument, consommé et retiré par `attachCreationZone`.
    if (storeName === 'rooms') return zonesForRoom(record.id, client);

    /*
     * UN GROUPE D'ÉCRANS SE RÉSOUT SUR SA SALLE ET SES ÉCRANS — ET SUR RIEN D'AUTRE. #119.
     *
     * PLACÉ ICI, ET NON PLUS BAS : LE COURT-CIRCUIT SUIVANT RÉPONDRAIT AVANT.
     * ---------------------------------------------------------------------
     * La première version de ce lot posait cette branche après `direct`/`mapped`. Elle
     * n'était donc atteinte que pour un groupe SANS revendication de zone. Trois
     * contournements restaient vivants, tous mesurés sur `be5f549` :
     *
     *   · `{ roomId: A, zoneId: A, screenIds: [écran B] }`   — servi au technicien de A ;
     *   · `{ zoneIds: [A], screenIds: [écran B] }`            — idem ;
     *   · `{ screenIds: [écran B] }` + `resource_zones` groupe→A — idem.
     *
     * Et surtout, par l'API ordinaire : un technicien porteur d'un `screen.edit` LÉGITIME
     * sur la zone A créait `{ zoneId: A, screenIds: [écran B] }`, obtenait 200, et relisait
     * l'identifiant de l'écran de la zone B. Le défaut n'était plus seulement hérité : il
     * était fabricable à volonté.
     *
     * POURQUOI CES CHAMPS NE SONT PAS UNE SOURCE DE VÉRITÉ ICI
     * --------------------------------------------------------
     * Un groupe possède déjà une vérité plus forte, et à deux voies concordantes :
     * `salle → zone` et `écran → mur → salle → zone`. Admettre `screen_group.zoneId`, ou un
     * `resource_zones` posé sur le groupe, ajouterait une TROISIÈME source qui peut
     * contredire les deux autres — c'est-à-dire exactement la contradiction que ce lot
     * existe pour fermer. Ces champs restent lisibles et réparables ; ils ne décident plus.
     *
     * Une salle déclarée mais irrésolvable n'est pas une salle absente : la portée devient
     * indécidable, et rendre `[]` ferme le groupe pour tout rôle scopé.
     */
    if (storeName === 'screen_groups') {
      const zones = [];
      if (record.roomId !== undefined && record.roomId !== null) {
        const zonesSalle = await zonesForRoom(record.roomId, client);
        if (!zonesSalle.length) return [];
        zones.push(...zonesSalle);
      }
      for (const screenId of unique(Array.isArray(record.screenIds) ? record.screenIds : [])) {
        const screen = await get('screens', screenId, client);
        // Un écran référencé introuvable rend la portée INDÉCIDABLE. L'ignorer laisserait le
        // groupe résolu sur la seule salle — le défaut d'origine de #119.
        if (!screen) return [];
        const zonesEcran = await resolveResourceZones('screens', screen, client, depth + 1);
        if (!zonesEcran.length) return [];
        zones.push(...zonesEcran);
      }
      return unique(zones);
    }

    const direct = unique([...(Array.isArray(record.zoneIds) ? record.zoneIds : []), record.zoneId]);
    const mapped = record.id !== undefined ? await directMappings(storeName, record.id, client) : [];
    if (direct.length || mapped.length) return preferExplicitZones([...direct, ...mapped], client);

    // Les câbles sont traités AVANT le repli générique `record.roomId`, et non après.
    // `cable.roomId` est un cache écrit une seule fois depuis la salle de la source ;
    // il n'est jamais rafraîchi quand un équipement change de salle, et un câble
    // inter-salles n'y tient pas. Placé après, ce repli court-circuitait la résolution
    // par extrémités : l'autorisation d'un câble se décidait sur une salle périmée —
    // refusée à qui possède désormais les deux bouts, accordée à qui n'en possède plus
    // aucun. `serve.js` résolvait déjà les câbles par leurs extrémités : les deux
    // chemins concordent maintenant.
    if (storeName === 'cables') {
      const zones = await cableEndpointZones(record, client, depth);
      // Repli conservé pour un câble hérité dont aucune extrémité n'est résolvable :
      // sans lui, il n'appartiendrait à aucune zone et deviendrait invisible.
      if (zones.length) return zones;
    }

    /*
     * UN ÉQUIPEMENT DANS UNE BAIE SUIT LA ZONE DE SA BAIE, PAS SON `roomId`.
     *
     * Le repli générique `record.roomId` passait AVANT ce cas, exactement comme il passait
     * avant les câbles jusqu'à ce qu'on le corrige — et pour la même raison. La chaîne
     * physique canonique est `Équipement → Baie → Salle` : la salle d'un équipement en baie
     * est DÉRIVÉE, et un `roomId` stocké n'en est qu'un reflet.
     *
     * Ce reflet pouvait être périmé : déplacer une baie ne réécrivait pas ses équipements.
     * L'autorisation se décidait alors sur une salle où l'équipement n'est plus — accordée à
     * qui possède l'ancienne salle, refusée à qui possède la nouvelle. L'écriture maintient
     * désormais l'invariant ; cette lecture ne s'y fie pas pour autant, parce qu'une base
     * héritée peut encore porter des paires contredites, et qu'une décision d'autorisation
     * ne doit pas dépendre d'une migration.
     */
    if (storeName === 'equipments' && record.baieId != null) {
      const baie = await get('baies', record.baieId, client);
      if (baie) return resolveResourceZones('baies', baie, client, depth + 1);
    }

    if (record.roomId !== undefined && record.roomId !== null) return zonesForRoom(record.roomId, client);
    if (storeName === 'screens' && record.wallId) {
      const wall = await get('walls', record.wallId, client);
      if (wall) return resolveResourceZones('walls', wall, client, depth + 1);
    }
    if (['screen_issues','diagnosis_history'].includes(storeName)) {
      const screenIds = unique([record.screenId, ...(record.screenIds || [])]);
      const zones = [];
      for (const screenId of screenIds) {
        const screen = await get('screens', screenId, client);
        if (screen) zones.push(...await resolveResourceZones('screens', screen, client, depth + 1));
      }
      return unique(zones);
    }

    if (storeName === 'docs' && String(record.kind || '').startsWith('topology_')) {
      const zones = [];
      if (record.routerId) {
        const router = await get('docs', record.routerId, client);
        if (router && String(router.id) !== String(record.id)) zones.push(...await resolveResourceZones('docs', router, client, depth + 1));
      }
      const equipmentIds = unique([record.routerEquipmentId, record.sourceEquipmentId, record.destinationEquipmentId]);
      for (const equipmentId of equipmentIds) {
        const equipment = await get('equipments', equipmentId, client);
        if (equipment) zones.push(...await resolveResourceZones('equipments', equipment, client, depth + 1));
      }
      if (zones.length) return unique(zones);
    }

    if (['tickets','notes','docs','faq','attachments','logs'].includes(storeName)) {
      const targetType = record.resourceType || record.relatedType || record.targetType || record.entityType || record.typeElement;
      const targetId = record.resourceId ?? record.relatedId ?? record.targetId ?? record.entityId ?? record.idElement;
      const targetStore = pluralStore(targetType);
      if (targetStore && targetId != null) {
        const target = await get(targetStore, targetId, client);
        if (target) return resolveResourceZones(targetStore, target, client, depth + 1);
      }
    }

    return [];
  }

  // Zones d'un câble déduites de ses deux extrémités physiques. Un connecteur
  // `component` n'a pas de localisation propre : c'est son équipement parent qui la porte.
  async function cableEndpointZones(record, client = pool, depth = 0) {
    const zones = [];
    for (const side of ['source', 'destination']) {
      // Câble hérité sans `sourceType` / `destinationType` : le type se déduit du champ
      // d'identifiant renseigné, comme le fait `normalizeCableRecord` côté navigateur.
      const type = record[`${side}Type`] || (record[`${side}ScreenId`] != null ? 'screen' : 'equipment');
      const endpointStore = pluralStore(type === 'component' ? 'equipment' : type);
      // Le calcul du parent utilisait `type === record.sourceType` pour choisir le côté :
      // quand les deux extrémités étaient des composants, la destination était résolue
      // avec l'équipement parent de la SOURCE, donc dans la mauvaise zone.
      const endpointId = type === 'component'
        ? record[`${side}ParentEquipmentId`]
        : (record[`${side}Id`] ?? record[`${side}EquipmentId`] ?? record[`${side}ScreenId`] ?? record[`${side}ParentEquipmentId`]);
      if (!endpointStore || endpointId == null) continue;
      const endpoint = await get(endpointStore, endpointId, client);
      if (endpoint) zones.push(...await resolveResourceZones(endpointStore, endpoint, client, depth + 1));
    }
    return unique(zones);
  }

  async function canAccessRecord(user, storeName, record, action = 'read', client = pool) {
    if (!user) return false;
    // CONFIGURER LA PLATEFORME EST RÉSERVÉ À L'ADMINISTRATEUR — y compris au manager.
    //
    // Le manager voit tout ce qui concerne la chaîne, et c'est voulu ; mais configurer la
    // plateforme est un autre acte. Les deux gardes côté client le lui refusaient déjà —
    // il n'a ni la permission `system.configure` ni la section « Paramètres » — tandis que
    // le serveur, lui, acceptait son écriture. Un manager pouvait donc remplacer l'image du
    // plan technique et les réglages globaux par appel direct à l'API, sans qu'aucun écran
    // ne le lui propose.
    //
    // C'est l'écriture qui est fermée, pas la lecture : les réglages sont une politique, et
    // le plan technique doit atteindre tout le monde.
    // Rôle inconnu : on refuse ici, avant toute autre considération. Sans cette ligne, la
    // décision dépendrait du hasard des plafonds absents plutôt que d'une règle énoncée.
    if (!roleOf(user)) return false;
    if (storeName === 'settings' && action !== 'read' && !isAdmin(user)) return false;
    /*
     * LE JOURNAL SE DÉCIDE ICI, AVANT LE COURT-CIRCUIT DES RÔLES GLOBAUX.
     *
     * Il était gouverné par `ticket.read` / `ticket.edit` — le contrat d'un AUTRE objet —
     * et une exception laissait chacun écrire le log qui lui appartenait. Comme la
     * suppression générique s'appuie sur cette même autorisation, un appel direct à l'API
     * suffisait à effacer sa propre trace : la preuve de ce qu'on venait de faire.
     * Mesuré : le Manager supprimait, l'Admin ET le Manager réécrivaient une entrée
     * existante, et le Chef comme le Responsable ne voyaient RIEN — leurs `logs.view` de la
     * matrice ne gouvernaient rien du tout.
     *
     * Placé avant `seesEveryZone`, ce contrat vaut pour TOUS, administrateur compris : un
     * journal qu'un rôle peut réécrire ne prouve plus rien de ce qu'il enregistre.
     */
    if (storeName === 'logs') return journalAutorise(user, action);
    // La matrice canonique, avant le court-circuit des rôles globaux : une habilitation de
    // zone délègue un pouvoir dans un périmètre, elle n'élève jamais le rôle qui la reçoit.
    if (matriceCanoniqueAutorise(user, storeName, action) === false) return false;
    if (seesEveryZone(user)) return true;
    // Les paramètres de plateforme sont une politique, pas une donnée privée : ils doivent
    // être LISIBLES par tout utilisateur authentifié, sinon le délai de déconnexion et le
    // plan technique définis par l'administrateur n'atteignent jamais personne d'autre que
    // lui. L'écriture reste réservée aux rôles globaux, qui ont court-circuité plus haut.
    if (storeName === 'settings') return action === 'read' && String(record?.id ?? '') === 'global';
    if (storeName === 'users') return false;
    // La lecture d'une notification diffusée (userId absent) est légitime pour tous ;
    // son ÉCRITURE ne l'est pas. Sans cette distinction, n'importe quelle session
    // technicien pouvait créer ou écraser une notification vue par toute la plateforme.
    if (storeName === 'notifications') {
      if (record.userId == null) return action === 'read';
      return String(record.userId) === String(user.id);
    }
    if (storeName === 'zones') return action === 'read';
    /*
     * UNE LOCALISATION N'EST LISIBLE QUE SI ELLE MÈNE À UNE SALLE DÉJÀ AUTORISÉE.
     *
     * `locationId` (Ville › Région › Département) est orthogonal aux zones — voir le
     * commentaire de `zonesForRoom` plus haut : la géographie n'est pas la sécurité. Mais un
     * rôle à périmètre ne doit pas non plus apprendre le nom de départements auxquels il n'a
     * AUCUNE salle rattachée : ce serait publier la carte de l'organisation entière à qui n'en
     * gère qu'un coin. `locations` n'a donc pas sa propre permission — la visibilité SUIT les
     * salles déjà autorisées : une localisation est lisible si elle est elle-même, ou un
     * ANCÊTRE de, l'emplacement d'au moins une salle que ce rôle peut déjà lire.
     */
    if (storeName === 'locations' && action === 'read') {
      const rooms = await list('rooms', client);
      const locations = await list('locations', client);
      const visible = new Set();
      for (const room of rooms) {
        if (room.locationId == null) continue;
        if (!(await canAccessRecord(user, 'rooms', room, 'read', client))) continue;
        for (const ancestor of locationPath(room.locationId, locations)) visible.add(String(ancestor.id));
      }
      return visible.has(String(record.id));
    }
    // Une entrée de journal atteste de ce qu'un utilisateur a FAIT ; ce n'est pas une
    // donnée de zone. Elle ne porte aucun champ dont une zone puisse se déduire, si bien
    // que la résolution rendait une liste vide et que l'écriture était refusée — pour
    if (storeName === 'tickets' && action === 'read' && String(record.createdById ?? record.requestedBy ?? '') === String(user.id)) return true;
    /*
     * UNE DÉFINITION DE CATALOGUE SE LIT SUR LA PERMISSION DE DIAGNOSTIC, PAS SUR UNE ZONE.
     *
     * Elle n'en a pas — c'est ce qui la définit. Court-circuiter ici, avant la résolution
     * de zones qui rendrait `[]` et fermerait fail-closed, est la SEULE façon de la rendre
     * atteignable à un rôle à périmètre sans lui prêter une zone qu'elle n'a pas. Aucune
     * permission n'est créée : `diagnostic.run` existe déjà et gouverne déjà l'écriture des
     * incidents opérationnels du même magasin.
     */
    if (storeName === 'screen_issues' && action === 'read' && isCatalogDefinition(record)) {
      /*
       * `roleAllows` seul disait « ce rôle peut, au plafond » — pas « cet utilisateur a
       * effectivement ce droit quelque part ». Un Technicien sans la moindre adhésion ni
       * habilitation passait donc, ce qui BLOQUE ce lot tant que ce n'est pas corrigé.
       * `hasEffectivePermissionSomewhere` exige adhésion ET habilitation actives dans la
       * MÊME zone, sans exiger de connaître laquelle — exactement l'exigence du catalogue,
       * qui n'a par construction aucune zone à lui-même.
       */
      return hasEffectivePermissionSomewhere(user, 'diagnostic.run', client);
    }

    const permission = permissionForRecord(storeName, record, action);
    if (!permission || !roleAllows(user, permission)) return false;
    const zoneIds = await resolveResourceZones(storeName, record, client);
    if (!zoneIds.length) return false;
    const decisions = await Promise.all(zoneIds.map(zoneId => hasPermission(user, zoneId, permission, client)));
    const criticalCrossZoneDocument = storeName === 'docs'
      && (String(record?.kind || '').startsWith('continuity_') || record?.kind === 'technical_diagram');
    // Une salle a UNE zone. Plus d'une, c'est un conflit non arbitré : on exige alors
    // TOUTES ses zones. Un conflit doit fermer, jamais élargir — avec `some`, être membre
    // de l'une des deux zones qui se contredisent aurait suffi à ouvrir la salle.
    // L'administrateur et le manager court-circuitent les zones plus haut : ils restent
    // seuls à la voir, et donc seuls à pouvoir la réparer.
    const salleEnConflit = storeName === 'rooms' && zoneIds.length > 1;
    // Un groupe d'écrans qui s'étend sur plusieurs zones est le même conflit non arbitré
    // qu'une salle à deux rattachements : sans cette ligne, la lecture ordinaire se
    // contenterait d'UNE zone accordée et servirait le groupe entier — c'est-à-dire les
    // identifiants d'écrans des autres zones — à qui n'en possède qu'une. On exige donc
    // TOUTES ses zones. Aucun modèle de privilège n'est créé : c'est la règle de la salle
    // en conflit, appliquée au même genre de contradiction.
    const groupeEnConflit = storeName === 'screen_groups' && zoneIds.length > 1;
    // `create`, `update` et `delete` sont des écritures : elles exigent TOUTES les zones,
    // comme `write`. Les nommer précisément sert au journal, pas à assouplir le reste.
    return action !== 'read' || criticalCrossZoneDocument || salleEnConflit || groupeEnConflit
      ? decisions.every(Boolean)
      : decisions.some(Boolean);
  }

  async function publicZoneSummaries() {
    return (await list('zones')).filter(zone => zone.status !== 'inactive').map(zone => ({
      id: zone.id, name: zone.name, slug: zone.slug, publicSummary: zone.publicSummary || '', imageUrl: zone.imageUrl || '', status: zone.status || 'active'
    }));
  }

  /* ────────────────────────── LE PLAN OPÉRATIONNEL EST UNE RESSOURCE MULTI-ZONE
   *
   * Un bitmap est INDIVISIBLE. Le plan technique du site porte, sur les mêmes pixels,
   * STC, RF1, RF2, l'acquisition, les salles serveurs, les portes et les circulations.
   * On ne peut donc pas l'envoyer à qui n'est habilité que sur une zone en prétendant
   * que les autres y sont masquées : aucune règle d'affichage ne retire une information
   * déjà présente dans l'image reçue.
   *
   * Tant qu'il n'existe pas de séparation « fond public + couches restreintes » ni
   * d'images par zone, la seule décision honnête est celle-ci : il faut couvrir TOUTES
   * les zones que le plan représente pour en recevoir les octets. Un périmètre partiel
   * ferme, il n'ouvre pas — c'est la même règle que la salle en conflit de zones.
   */

  /**
   * Les zones que le plan représente — celles qui portent au moins une salle.
   *
   * Le plan dessine des salles ; une zone sans salle n'y figure pas et ne doit donc pas
   * durcir l'accès pour rien. La liste est LUE À CHAQUE FOIS, jamais mise en cache : une
   * zone créée après le démarrage doit resserrer l'accès immédiatement, pas au prochain
   * redémarrage.
   */
  async function operationalMapZones(client = pool) {
    const [mappings, zones] = await Promise.all([list('resource_zones', client), list('zones', client)]);
    const actives = new Map(zones.filter(zone => zone.status !== 'inactive').map(zone => [String(zone.id), zone]));
    return unique(mappings
      .filter(mapping => singularType(mapping.resourceType) === 'room' && actives.has(String(mapping.zoneId)))
      .map(mapping => mapping.zoneId));
  }

  /**
   * Cet utilisateur peut-il recevoir les octets du plan opérationnel ?
   *
   * AUCUNE permission n'est inventée : c'est `zone.summary.read`, celle qui gouverne déjà
   * la lecture d'une salle, exigée sur CHAQUE zone représentée.
   *
   * La porte des rôles à portée globale reste `seesEveryZone`, c'est-à-dire le prédicat
   * du moteur — et non un `role === 'manager'` écrit ici. #133 redéfinira ce prédicat
   * pour les périmètres confiés ; cette fonction suivra sans être réécrite.
   */
  async function canReadOperationalMap(user, client = pool) {
    if (!user || !roleOf(user)) return false;
    if (seesEveryZone(user)) return true;
    const zoneIds = await operationalMapZones(client);
    // Aucune zone connue : on ne sait pas ce que le plan représente, donc on ferme.
    if (!zoneIds.length) return false;
    const decisions = await Promise.all(
      zoneIds.map(zoneId => hasPermission(user, zoneId, 'zone.summary.read', client)));
    return decisions.every(Boolean);
  }

  /* ───────────────── LE CATALOGUE DES ZONES EST DÉCOUVRABLE — SON IMAGE NE L'EST PAS (A02)
   *
   * `context.zones` alimente délibérément l'écran « Mes accès aux zones » : sans le nom
   * d'une zone, personne ne pourrait DEMANDER l'accès qu'il n'a pas encore. Ce parcours est
   * voulu, et `publicSummary` — le champ s'appelle ainsi — est précisément le texte que
   * l'administrateur publie pour lui. Rien de tout cela ne bouge ici : ni le nom, ni le
   * résumé, ni le statut, ni la liste déroulante de la demande d'accès.
   *
   * `imageUrl` est d'une autre nature. Un administrateur y met la photo d'une salle, d'une
   * baie, d'un plan : de l'information VISUELLE sur l'installation, pas une étiquette de
   * découverte. Le dépôt tient déjà ce raisonnement quelques lignes plus haut pour le plan
   * du site — « un bitmap est INDIVISIBLE » — et il vaut identiquement ici : une image
   * déjà reçue ne se masque pas après coup, donc elle ne doit pas partir.
   *
   * ALORS QUELLE EST LA PORTE ? Pas une nouvelle. C'est `zone.summary.read`, la permission
   * qui gouverne DÉJÀ la lecture d'une salle et l'envoi des octets du plan opérationnel
   * (`canReadOperationalMap`). Aucune permission n'est inventée, aucun rôle n'est élargi :
   * les six rôles canoniques la portent tous à leur plafond, et la détenir exige la même
   * chose que partout ailleurs — une adhésion active ET une habilitation active dans LA
   * MÊME zone, ce que `zonesOuLaPermissionEstDetenue` décide pour tout le fichier.
   *
   * Conséquence directe : révoquer l'habilitation, révoquer l'adhésion ou la laisser
   * expirer retire l'image au prochain appel, sans code de révocation dédié.
   */
  const ZONE_IMAGE_PERMISSION = 'zone.summary.read';
  const sansImage = zone => ({ ...zone, imageUrl: '' });

  async function contextFor(user) {
    const zones = await publicZoneSummaries();
    if (seesEveryZone(user)) {
      return { zones, memberships: await list('zone_memberships'), grants: await list('zone_grants'), isGlobalAdmin: true };
    }

    const memberships = await activeMemberships(user.id);
    const grants = await activeGrants(user.id);
    const avecImage = roleAllows(user, ZONE_IMAGE_PERMISSION)
      ? zonesOuLaPermissionEstDetenue(memberships, grants, ZONE_IMAGE_PERMISSION)
      : new Set();

    return {
      // Hors périmètre, la zone garde exactement la forme qu'elle a lorsqu'aucune image
      // n'a été publiée : `imageUrl: ''`. Une clé retirée changerait la forme du document
      // selon le lecteur, et deux formes pour une même zone, c'est de la réécriture au
      // repos pour les consommateurs qui comparent des instantanés (#164).
      zones: zones.map(zone => (avecImage.has(String(zone.id)) ? zone : sansImage(zone))),
      memberships,
      grants,
      isGlobalAdmin: false
    };
  }

  async function canManageZone(user, zoneId, client = pool) {
    if (seesEveryZone(user)) return true;
    return isZoneResponsible(user, zoneId, client);
  }

  /*
   * LA PROVENANCE EST UN ARGUMENT DU SERVEUR, JAMAIS UN CHAMP DE LA REQUÊTE.
   *
   * Elle n'est pas décorative : elle seule rend une habilitation révocable sans risque.
   * L'identifiant est déterministe (`ZG-utilisateur-zone-permission`), si bien qu'un octroi
   * explicite et un octroi induit par un responsable de salle occupent LA MÊME ligne. Sans
   * provenance, révoquer « ce que l'assignation a créé » supprimerait aussi ce qu'un
   * administrateur a octroyé à la main.
   *
   * Elle est donc un argument POSITIONNEL, hors de l'objet issu du corps HTTP :
   * `POST /api/access/grants` passe `await readJson(req)` tel quel, et une provenance
   * lisible depuis la requête laisserait un appelant estampiller son propre octroi
   * « né d'une salle » — donc programmer sa révocation automatique par le retrait d'un
   * responsable, ou faire révoquer celui d'un tiers. Le serveur seul la pose.
   */
  async function grantPermission(actor, { userId, zoneId, permission, expiresAt = null }, client = pool, provenance = null) {
    const source = provenance?.source || null;
    const roomId = provenance?.roomId || null;
    if (!PERMISSIONS.includes(permission)) throw Object.assign(new Error('Permission inconnue.'), { status: 400, code: 'INVALID_PERMISSION' });
    if (!(await canManageZone(actor, zoneId, client))) throw Object.assign(new Error("Vous ne pouvez pas gérer les accès de cette zone."), { status: 403, code: 'ZONE_FORBIDDEN' });
    const subject = await get('users', userId, client);
    if (!subject) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404, code: 'USER_NOT_FOUND' });
    if (!roleOf(subject)) throw Object.assign(new Error(`Rôle inconnu : « ${String(subject.role)} ». Corrigez le compte avant de l'habiliter.`), { status: 409, code: ROLE_ERRORS.INVALID_ROLE });
    if (!ROLE_CEILINGS[roleOf(subject)]?.has(permission)) throw Object.assign(new Error("Cette permission dépasse le rôle global du bénéficiaire."), { status: 409, code: 'ROLE_CEILING' });
    if (!seesEveryZone(actor) && !await hasPermission(actor, zoneId, permission, client)) {
      throw Object.assign(new Error("Vous ne pouvez pas déléguer une permission que vous ne possédez pas."), { status: 403, code: 'DELEGATION_CEILING' });
    }
    const id = `ZG-${userId}-${zoneId}-${permission}`;
    const before = await get('zone_grants', id, client);
    const after = {
      id, userId, zoneId, permission, grantedBy: actor.id, grantedAt: nowIso(), expiresAt: expiresAt || null, status: 'active',
      ...(source ? { source } : {}), ...(roomId ? { roomId: String(roomId) } : {})
    };
    await put('zone_grants', id, after, client);
    await audit({ actorId: actor.id, subjectId: userId, zoneId, action: 'grant.upsert', before, after }, client);
    return after;
  }

  /*
   * `provenance.responsibleSource` dit D'OÙ VIENT le drapeau `responsible` — et il n'est
   * lui aussi jamais lu depuis la requête, pour la même raison que ci-dessus.
   *
   * `null` signifie « décision explicite d'administration de zone ». C'est le défaut, donc
   * l'état de toute adhésion existante, héritée comprise : ce qu'on ne sait pas attribuer
   * est traité comme une décision humaine, et n'est jamais retiré automatiquement.
   */
  async function ensureMembership(actor, { userId, zoneId, responsible = false, expiresAt = null }, client = pool, provenance = null) {
    if (!(await canManageZone(actor, zoneId, client))) throw Object.assign(new Error("Vous ne pouvez pas gérer les membres de cette zone."), { status: 403, code: 'ZONE_FORBIDDEN' });
    if (responsible && !seesEveryZone(actor)) throw Object.assign(new Error("Seul l'administrateur global peut nommer un responsable de zone."), { status: 403, code: 'RESPONSIBLE_ASSIGN_ADMIN_ONLY' });
    const subject = await get('users', userId, client);
    if (!subject) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404, code: 'USER_NOT_FOUND' });
    // Affilier un rôle inconnu reviendrait à préparer une autorisation qui ne pourra
    // jamais s'exercer, et à le laisser croire le contraire.
    if (!roleOf(subject)) throw Object.assign(new Error(`Rôle inconnu : « ${String(subject.role)} ». Corrigez le compte avant de l'affilier.`), { status: 409, code: ROLE_ERRORS.INVALID_ROLE });
    const zone = await get('zones', zoneId, client);
    if (!zone) throw Object.assign(new Error('Zone introuvable.'), { status: 404, code: 'ZONE_NOT_FOUND' });
    const id = `ZM-${userId}-${zoneId}`;
    const before = await get('zone_memberships', id, client);
    const responsibleSource = Boolean(responsible) ? (provenance?.responsibleSource || null) : null;
    const after = {
      id, userId, zoneId, responsible: Boolean(responsible), status: 'active', startsAt: before?.startsAt || nowIso(), expiresAt: expiresAt || null,
      authVersion: Number(before?.authVersion || 0) + 1, updatedAt: nowIso(),
      ...(responsibleSource ? { responsibleSource } : {})
    };
    await put('zone_memberships', id, after, client);
    await audit({ actorId: actor.id, subjectId: userId, zoneId, action: 'membership.upsert', before, after }, client);
    return after;
  }

  /*
   * CE QU'UN RESPONSABLE DE SALLE REÇOIT — la liste qui vivait en dur dans `ensureModel()`.
   *
   * Elle est ici, nommée et gelée, parce qu'elle décrit une DÉCISION (« de quoi répond le
   * responsable d'une salle ») et non un détail d'amorçage. Chaque entrée repasse malgré
   * tout par `grantPermission`, donc par `ROLE_CEILING` et `DELEGATION_CEILING` : la liste
   * propose, les gardes disposent.
   */
  const RESPONSIBLE_DEFAULT_PERMISSIONS = Object.freeze([
    'zone.summary.read', 'equipment.read', 'equipment.edit', 'screen.read', 'screen.edit',
    'cable.read', 'cable.edit', 'topology.read', 'topology.edit', 'continuity.read',
    'continuity.edit', 'continuity.validate', 'continuity.test', 'diagram.read',
    'diagram.edit', 'diagram.validate', 'ticket.read', 'ticket.create', 'ticket.edit',
    'note.read', 'note.create', 'diagnostic.run', 'procedure.read', 'access.review'
  ]);

  /**
   * Marque ce qu'une assignation de responsable de salle a créé — habilitations ET drapeau
   * `responsible` d'adhésion. Un seul jeton pour les deux : c'est la même origine.
   */
  const RESPONSIBLE_GRANT_SOURCE = 'room-responsible';

  const responsableDeclare = value =>
    (value === null || value === undefined || value === '') ? '' : String(value);

  /**
   * Une écriture de salle change-t-elle le responsable déclaré ?
   *
   * La comparaison se fait sur la fiche EXISTANTE, jamais sur ce que le client affirme :
   * une charge utile qui réémet le responsable actuel n'est pas un changement d'autorité,
   * et ne doit rien déclencher — c'est le cas de tout enregistrement de formulaire.
   */
  function responsibleChangeRequested(storeName, record, existing) {
    if (storeName !== 'rooms') return false;
    if (record?.responsibleId === undefined) return false;
    return responsableDeclare(record?.responsibleId) !== responsableDeclare(existing?.responsibleId);
  }

  /**
   * L'OMISSION DE `responsibleId` PRÉSERVE — elle ne supprime pas (R9).
   *
   * MESURÉ : un chef renommait une salle en n'envoyant PAS `responsibleId`, et la
   * déclaration disparaissait de la fiche :
   *
   *     avant   responsibleId = "u-resp",  adhésion responsable + 24 habilitations
   *     PUT     {name: "…"}   sans responsibleId        -> 200
   *     après   responsibleId = undefined,  adhésion et 24 habilitations INCHANGÉES
   *
   * Deux lectures de `undefined` se contredisaient : la garde y voyait « rien ne change »
   * — et se taisait, à raison — tandis que l'écriture, qui REMPLACE la fiche entière et
   * n'applique aucun correctif partiel, y voyait « champ absent ». Un rôle à périmètre
   * défaisait donc une désignation sans jamais croiser `RESPONSIBLE_ASSIGN_ADMIN_ONLY`, et
   * l'autorité restait derrière, sans plus aucune salle pour la justifier.
   *
   * La règle, posée AVANT la comparaison, pour TOUS les écrivains de fiche entière :
   *
   *   salle EXISTANTE, champ absent   -> on réinscrit la valeur en base (préservation)
   *   salle EXISTANTE, champ déclaré  -> c'est une décision, la garde s'applique
   *   salle NEUVE,     champ absent   -> aucune salle n'hérite de rien
   *
   * Retirer un responsable reste donc possible, mais se DIT : `responsibleId: ''` ou
   * `null`, et franchit la garde comme toute autre décision d'autorité.
   */
  function normalizeRoomResponsible(storeName, record, existing) {
    if (storeName !== 'rooms' || !existing) return record;
    if (record?.responsibleId !== undefined) return record;
    if (existing.responsibleId === undefined) return record;
    return { ...record, responsibleId: existing.responsibleId };
  }

  /**
   * LE SERVEUR TRANCHE QUI PEUT NOMMER UN RESPONSABLE — avant d'écrire quoi que ce soit.
   *
   * Même règle, et même code d'erreur, que `ensureMembership` : nommer un responsable de
   * zone est un acte d'administration globale. La garde est posée AVANT l'écriture pour
   * qu'un refus ne laisse jamais une salle modifiée et une autorité à moitié posée.
   */
  function assertResponsibleAssignment(actor, storeName, record, existing) {
    if (!responsibleChangeRequested(storeName, record, existing)) return false;
    if (!seesEveryZone(actor)) {
      throw Object.assign(
        new Error("Seul l'administrateur global peut désigner le responsable d'une salle."),
        { status: 403, code: 'RESPONSIBLE_ASSIGN_ADMIN_ONLY' });
    }
    return true;
  }

  /**
   * QUELLES SALLES DE CETTE ZONE DÉSIGNENT ENCORE CET UTILISATEUR ?
   *
   * C'est le compteur de références de l'autorité dérivée d'une salle — et il n'est pas
   * stocké : il est RECALCULÉ depuis les salles, qui sont la seule vérité sur « qui répond
   * de quoi ». Un compteur dénormalisé dériverait au premier import, à la première
   * restauration, au premier `ensureModel()` ; celui-ci ne peut pas mentir.
   *
   * MESURÉ (revue indépendante, A1-R1) : l'identifiant d'une habilitation est déterministe
   * (`ZG-utilisateur-zone-permission`), donc DEUX salles de la même zone partagent UNE
   * ligne. Sans ce décompte, retirer l'utilisateur de la salle A révoquait l'autorité que
   * la salle B justifiait encore — 24 habilitations et l'adhésion responsable perdues alors
   * qu'une salle la nommait toujours.
   *
   * Appelée APRÈS l'écriture de la salle, dans la même transaction : elle lit donc l'état
   * qui vient d'être décidé, pas celui d'avant.
   */
  async function roomsDeclarantResponsable(userId, zoneId, client = pool) {
    const cible = responsableDeclare(userId);
    if (!cible) return [];
    const salles = await list('rooms', client);
    const rattachements = await list('resource_zones', client);
    const zonesParSalle = new Map();
    for (const mapping of rattachements) {
      if (singularType(mapping.resourceType) !== 'room') continue;
      const cle = String(mapping.resourceId);
      if (!zonesParSalle.has(cle)) zonesParSalle.set(cle, new Set());
      zonesParSalle.get(cle).add(String(mapping.zoneId));
    }
    return salles
      .filter(salle => responsableDeclare(salle?.responsibleId) === cible
        && zonesParSalle.get(String(salle.id))?.has(String(zoneId)))
      .map(salle => String(salle.id));
  }

  /** Le drapeau `responsible` de cette adhésion vient-il d'une salle, ou d'une décision ? */
  const adhesionDeriveeDUneSalle = adhesion =>
    adhesion?.responsible === true && adhesion?.responsibleSource === RESPONSIBLE_GRANT_SOURCE;

  /**
   * L'AUTORITÉ D'UNE SALLE SUIT LES SALLES — une seule règle, pour TOUS les écrivains.
   *
   * MESURÉ (revue indépendante, ronde 3) : la réconciliation ne vivait que dans le `PUT`
   * ordinaire. Les quatre autres chemins qui touchent au même concept la contournaient :
   *
   *   `POST /api/rooms/transfer`        un chef écrivait `responsibleId` sans la garde —
   *                                     la salle nommait un responsable, `zone_grants` ne
   *                                     le connaissait pas : état incohérent, pas escalade
   *   `DELETE /api/data/rooms/:id`      la salle disparaissait, l'adhésion et les 24
   *                                     habilitations restaient actives
   *   `POST /api/access/resource-zones` la salle changeait de zone, l'autorité restait
   *                                     dans l'ancienne et n'apparaissait pas dans la neuve
   *   `POST /api/sync/bootstrap`        `responsibleId` importé sans aucune autorité
   *
   * La règle, désormais unique et énoncée une fois : **pour chaque couple (utilisateur,
   * zone) concerné, l'autorité dérivée vaut exactement ce que disent les salles.** Une
   * salle la justifie : elle existe. Aucune ne la justifie : elle tombe. C'est le même
   * décompte que `roomsDeclarantResponsable()`, appliqué aux zones d'AVANT **et** d'APRÈS
   * l'écriture — sans quoi un déplacement A→B ne verrait jamais la zone A qu'il quitte.
   *
   * `previousZoneIds` est indispensable : après un déplacement ou une suppression, la zone
   * quittée n'est plus lisible depuis la salle. L'appelant la capture AVANT d'écrire.
   *
   * Appelée APRÈS l'écriture (ou la pierre tombale), dans la même transaction : elle lit
   * l'état décidé, jamais celui d'avant. Une salle supprimée ne justifie donc plus rien.
   */
  async function reconcileRoomResponsible(actor, { roomId, previousResponsibleId = '', previousZoneIds = [] }, client = pool) {
    const salle = await get('rooms', roomId, client);
    const entrant = responsableDeclare(salle?.responsibleId);
    const sortant = responsableDeclare(previousResponsibleId);
    const zonesActuelles = salle ? await zonesForRoom(roomId, client) : [];
    const zones = unique([...previousZoneIds, ...zonesActuelles].map(String).filter(Boolean));

    if (!zones.length) {
      if (entrant) {
        throw Object.assign(
          new Error("Cette salle n'est rattachée à aucune zone : rattachez-la avant de lui désigner un responsable."),
          { status: 409, code: 'ROOM_ZONE_REQUIRED_FOR_RESPONSIBLE' });
      }
      return { zones: [], promoted: null, demoted: null, grants: [], revoked: [], retenu: [] };
    }

    const concernes = unique([sortant, entrant].filter(Boolean));
    const resultat = { zones, promoted: entrant || null, demoted: sortant || null, grants: [], revoked: [], retenu: [] };

    for (const zoneId of zones) {
      for (const userId of concernes) {
        // Le décompte tranche, et lui seul : aucun cas particulier par appelant.
        const justifications = await roomsDeclarantResponsable(userId, zoneId, client);

        if (!justifications.length) {
          // ── plus aucune salle ne le nomme dans cette zone : ce que ce chemin a posé tombe
          const adhesion = await get('zone_memberships', `ZM-${userId}-${zoneId}`, client);
          if (adhesionDeriveeDUneSalle(adhesion)) {
            // R10 — la durée de vie se REPORTE. Sans elle, `ensureMembership` réécrit
            // `expiresAt: null` et une adhésion à échéance ressortait illimitée de son
            // passage par une salle.
            await ensureMembership(actor,
              { userId, zoneId, responsible: false, expiresAt: adhesion?.expiresAt ?? null }, client);
          }
          const habilitations = (await list('zone_grants', client)).filter(item =>
            String(item.userId) === userId && String(item.zoneId) === String(zoneId) &&
            item.status === 'active' && item.source === RESPONSIBLE_GRANT_SOURCE);
          for (const habilitation of habilitations) {
            await revokeGrant(actor, habilitation.id, client);
            resultat.revoked.push(habilitation.id);
          }
          continue;
        }

        // ── au moins une salle le nomme : l'autorité existe, et on la (re)pose
        resultat.retenu.push({ userId, zoneId, rooms: justifications });
        const adhesionEntrant = await get('zone_memberships', `ZM-${userId}-${zoneId}`, client);
        const dejaExplicite = adhesionEntrant?.responsible === true
          && adhesionEntrant?.responsibleSource !== RESPONSIBLE_GRANT_SOURCE;

        /*
         * R10 — UNE DÉCISION EXPLICITE NE SE RÉÉCRIT PAS, MÊME À L'IDENTIQUE.
         *
         * MESURÉ : une adhésion responsable explicite portant
         * `expiresAt: "2026-09-30T00:00:00.000Z"` ressortait d'une désignation de salle
         * avec `expiresAt: null` et `authVersion` incrémenté. Le code savait déjà que la
         * décision était indépendante (`dejaExplicite`) — et la réécrivait quand même,
         * parce que le chemin salle ne transmet aucune échéance et que `ensureMembership`
         * écrit `expiresAt || null`. Une autorité temporaire devenait permanente.
         *
         * Le plus petit correctif sûr est de NE PAS ÉCRIRE : l'utilisateur est déjà
         * responsable de cette zone, il n'y a rien à ajouter. Pas d'écriture, donc pas de
         * durée élargie, pas de `authVersion` incrémenté, pas de trace d'un acte qui n'a
         * pas eu lieu.
         *
         * Le cas d'une adhésion explicite EXPIRÉE se ferme du même geste : on n'y touche
         * pas davantage. L'utilisateur n'a alors aucune autorité effective, et la salle ne
         * la lui rend pas — ce serait réécrire l'échéance qu'un administrateur a posée.
         * Fail-closed, et documenté : la réparation passe par Accès Zone.
         */
        if (!dejaExplicite) {
          // Adhésion absente, simple, ou déjà nôtre : la durée EXISTANTE se reporte, pour
          // qu'une adhésion simple à échéance ne ressorte pas illimitée de sa promotion.
          await ensureMembership(actor,
            { userId, zoneId, responsible: true, expiresAt: adhesionEntrant?.expiresAt ?? null },
            client, { responsibleSource: RESPONSIBLE_GRANT_SOURCE });
        }

        const beneficiaire = await get('users', userId, client);
        const plafond = ROLE_CEILINGS[roleOf(beneficiaire)];
        for (const permission of RESPONSIBLE_DEFAULT_PERMISSIONS) {
          if (!plafond?.has(permission)) continue;
          const existant = await get('zone_grants', `ZG-${userId}-${zoneId}-${permission}`, client);
          const notre = existant?.source === RESPONSIBLE_GRANT_SOURCE;
          if (existant && activeAt(existant) && !notre) continue;
          await grantPermission(actor, { userId, zoneId, permission }, client,
            { source: RESPONSIBLE_GRANT_SOURCE, roomId });
          resultat.grants.push(permission);
        }
      }
    }
    return resultat;
  }

  /**
   * Le `PUT` ordinaire d'une salle — même règle, zones inchangées.
   *
   * Conservée comme point d'entrée nommé : c'est elle que `serve.js` appelle, et son nom
   * dit l'intention (« on vient de changer le responsable ») là où le réconciliateur dit
   * le mécanisme.
   */
  async function applyResponsibleAssignment(actor, { roomId, responsibleId, previousResponsibleId }, client = pool) {
    return reconcileRoomResponsible(actor, { roomId, previousResponsibleId }, client);
  }

  /** Réconcilie plusieurs salles d'un coup — dépôt, import, amorçage. */
  async function reconcileRoomsResponsible(actor, entrees, client = pool) {
    const bilans = [];
    for (const entree of entrees) bilans.push(await reconcileRoomResponsible(actor, entree, client));
    return bilans;
  }

  async function revokeGrant(actor, grantId, client = pool) {
    const before = await get('zone_grants', grantId, client);
    if (!before) return null;
    if (!(await canManageZone(actor, before.zoneId, client))) throw Object.assign(new Error("Vous ne pouvez pas gérer les accès de cette zone."), { status: 403, code: 'ZONE_FORBIDDEN' });
    const after = { ...before, status: 'revoked', revokedBy: actor.id, revokedAt: nowIso() };
    await put('zone_grants', grantId, after, client);
    await audit({ actorId: actor.id, subjectId: before.userId, zoneId: before.zoneId, action: 'grant.revoke', before, after }, client);
    return after;
  }

  async function createRequest(user, body) {
    const zone = await get('zones', body.zoneId);
    if (!zone) throw Object.assign(new Error('Zone introuvable.'), { status: 404, code: 'ZONE_NOT_FOUND' });
    const requestedPermissions = unique(body.requestedPermissions || []).filter(permission => PERMISSIONS.includes(permission) && roleAllows(user, permission));
    if (!requestedPermissions.length) throw Object.assign(new Error('Sélectionnez au moins une permission compatible avec votre rôle.'), { status: 400, code: 'NO_PERMISSION' });
    const maxDurationHours = 24 * 30;
    const durationHours = Math.min(maxDurationHours, Math.max(1, Number(body.durationHours || 8)));
    const id = makeId('AR');
    const record = {
      id, requestedBy: user.id, zoneId: body.zoneId, requestedPermissions, approvedPermissions: [],
      reason: String(body.reason || '').slice(0, 1000), requestedAt: nowIso(), approvedBy: null, approvedAt: null,
      expiresAt: new Date(Date.now() + durationHours * 3600_000).toISOString(), status: 'pending'
    };
    await put('access_requests', id, record);
    await audit({ actorId: user.id, subjectId: user.id, zoneId: body.zoneId, action: 'request.create', after: record, requestId: id });
    return record;
  }

  async function requestsFor(user) {
    const requests = await list('access_requests');
    if (seesEveryZone(user)) return requests;
    const memberships = await activeMemberships(user.id);
    const responsibleZones = new Set(memberships.filter(item => item.responsible).map(item => String(item.zoneId)));
    return requests.filter(request => String(request.requestedBy) === String(user.id) || responsibleZones.has(String(request.zoneId)));
  }

  async function reviewRequest(actor, requestId, body) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const request = await get('access_requests', requestId, client);
      if (!request) throw Object.assign(new Error("Demande d'accès introuvable."), { status: 404, code: 'REQUEST_NOT_FOUND' });
      if (request.status !== 'pending') throw Object.assign(new Error('Cette demande a déjà été traitée.'), { status: 409, code: 'REQUEST_ALREADY_REVIEWED' });
      if (!(await canManageZone(actor, request.zoneId, client))) throw Object.assign(new Error("Vous ne pouvez pas traiter cette demande."), { status: 403, code: 'ZONE_FORBIDDEN' });

      const approved = body.status === 'rejected' ? [] : unique(body.approvedPermissions || []).filter(permission => request.requestedPermissions.includes(permission));
      const reviewed = {
        ...request,
        status: body.status === 'rejected' ? 'rejected' : 'approved',
        approvedPermissions: approved,
        approvedBy: actor.id,
        approvedAt: nowIso(),
        expiresAt: body.expiresAt || request.expiresAt
      };

      if (reviewed.status === 'approved') {
        await ensureMembership(actor, { userId: request.requestedBy, zoneId: request.zoneId, responsible: false, expiresAt: reviewed.expiresAt }, client);
        for (const permission of approved) await grantPermission(actor, { userId: request.requestedBy, zoneId: request.zoneId, permission, expiresAt: reviewed.expiresAt }, client);
      }
      await put('access_requests', requestId, reviewed, client);
      await audit({ actorId: actor.id, subjectId: request.requestedBy, zoneId: request.zoneId, action: `request.${reviewed.status}`, before: request, after: reviewed, requestId }, client);
      await client.query('COMMIT');
      return reviewed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function mapResource(actor, body) {
    if (!seesEveryZone(actor)) throw Object.assign(new Error("Seul l'administrateur global peut modifier le périmètre d'une ressource."), { status: 403, code: 'ADMIN_REQUIRED' });
    const zone = await get('zones', body.zoneId);
    if (!zone) throw Object.assign(new Error('Zone introuvable.'), { status: 404, code: 'ZONE_NOT_FOUND' });
    const type = singularType(body.resourceType);

    // UNE SALLE = UN RATTACHEMENT. Déplacer une salle de la zone A vers la zone B retire
    // A et pose B, dans la même transaction : écrit en deux temps, un échec du second
    // laisserait la salle dans les deux zones, ou dans aucune.
    //
    // Les autres ressources gardent leur rattachement multiple : un équipement, un écran
    // ou un câble peuvent légitimement toucher plusieurs zones.
    if (type === 'room') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        /*
         * R6 — DÉPLACER UNE SALLE DÉPLACE L'AUTORITÉ QU'ELLE JUSTIFIE.
         *
         * MESURÉ : après un remap A→B, le responsable gardait ses 24 habilitations dans A
         * — la zone qu'il venait de quitter — et n'en recevait aucune dans B. La salle
         * nommait toujours la même personne ; seule la zone avait bougé, et l'autorité
         * était restée derrière.
         *
         * Les zones d'AVANT sont capturées ici, avant `setRoomZone` : une fois le
         * rattachement remplacé, la zone quittée n'est plus lisible depuis la salle, et
         * rien ne dirait plus où révoquer.
         */
        const salle = await get('rooms', body.resourceId, client);
        const zonesAvant = await zonesForRoom(body.resourceId, client);
        const after = await setRoomZone(actor, body.resourceId, body.zoneId, client);
        if (salle?.responsibleId) {
          await reconcileRoomResponsible(actor, {
            roomId: String(body.resourceId),
            previousResponsibleId: salle.responsibleId,
            previousZoneIds: zonesAvant
          }, client);
        }
        await client.query('COMMIT');
        return after;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }

    const id = `RZ-${type}-${body.resourceId}-${body.zoneId}`;
    const before = await get('resource_zones', id);
    const after = { id, resourceType: type, resourceId: body.resourceId, zoneId: body.zoneId, createdAt: before?.createdAt || nowIso(), updatedAt: nowIso() };
    await put('resource_zones', id, after);
    await audit({ actorId: actor.id, zoneId: body.zoneId, action: 'resource-zone.upsert', before, after });
    return after;
  }

  /* ────────────────────────── créer une salle : la zone est un ARGUMENT
   *
   * Une salle qu'on crée n'a, par construction, aucune zone : `resource_zones` ne peut pas
   * encore la référencer, aucune baie ne pend d'elle, et elle n'est pas en base. La
   * résolution rendait donc une liste vide, et `canAccessRecord` refuse une liste vide —
   * comme il le doit. Résultat : un chef ne pouvait créer AUCUNE salle, alors que la
   * matrice lui accorde `rooms.create` et que son plafond porte l'écriture de salle.
   *
   * On ne désarme pas la garde de zone : on demande la zone. Elle arrive avec la création,
   * la MÊME garde la vérifie — membre de la zone et habilité à y écrire — puis elle est
   * inscrite dans `resource_zones` et RETIRÉE de l'enregistrement. Il n'y a ainsi jamais
   * deux endroits où lire la zone d'une salle, et la salle créée se relit ensuite par le
   * chemin ordinaire, comme toutes les autres.
   */

  /**
   * POSER LE rattachement d'une salle — un seul, qui REMPLACE les précédents.
   *
   * Ajouter un rattachement sans retirer l'ancien laissait la salle dans deux zones à la
   * fois : l'ancienne équipe la gardait, la nouvelle la recevait, et personne ne l'avait
   * décidé. Un déplacement est un remplacement.
   */
  /**
   * Une zone transitoire que plus rien ne référence n'a plus de raison d'exister.
   *
   * Elle naît AVEC la salle, pour que celle-ci appartienne à une zone dès sa création.
   * Quand la salle est ensuite rattachée à une vraie zone d'exploitation — ou supprimée —
   * la zone fabriquée reste derrière, vide, dans la liste que voient l'écran des accès et
   * le sélecteur de zone. Ce n'est pas une nuisance théorique : chaque salle créée par
   * l'administrateur en laissait une, définitivement.
   *
   * On ne retire QUE celle qui a été fabriquée pour CETTE salle, et seulement si plus
   * aucun rattachement, adhésion ou habilitation ne s'y accroche.
   */
  /**
   * La zone d'une salle qu'on dépose sans en nommer une — NEUVE, et à son nom.
   *
   * Retomber sur une zone existante — « la première », « celle de l'auteur » — donnerait à
   * la salle un périmètre que personne n'a choisi.
   */
  async function zoneTransitoirePour(room, client = pool) {
    const zoneId = `room-${room.id}`;
    if (!(await get('zones', zoneId, client))) {
      await put('zones', zoneId, {
        id: zoneId,
        name: room.name || room.nom || `Salle ${room.id}`,
        slug: slugify(room.name || room.nom || `salle-${room.id}`),
        publicSummary: room.publicSummary || 'Zone technique 2M. Accès détaillé soumis à autorisation.',
        imageUrl: room.imageUrl || room.image || '',
        status: 'active', autoCreatedFromRoomId: room.id,
        createdAt: nowIso(), updatedAt: nowIso()
      }, client);
    }
    return zoneId;
  }

  async function retirerZoneTransitoireOrpheline(roomId, zoneId, client = pool) {
    const zone = await get('zones', zoneId, client);
    if (!zone?.autoCreatedFromRoomId || String(zone.autoCreatedFromRoomId) !== String(roomId)) return false;
    const [mappings, memberships, grants] = await Promise.all([
      list('resource_zones', client), list('zone_memberships', client), list('zone_grants', client)
    ]);
    const encoreUtilisee = mappings.some(item => String(item.zoneId) === String(zoneId))
      || memberships.some(item => String(item.zoneId) === String(zoneId) && item.status !== 'revoked')
      || grants.some(item => String(item.zoneId) === String(zoneId) && item.status !== 'revoked');
    if (encoreUtilisee) return false;
    await tombstone('zones', zoneId, client);
    return true;
  }

  async function setRoomZone(actor, roomId, zoneId, client = pool) {
    const anciens = await roomMappings(roomId, client);
    const id = `RZ-room-${roomId}-${zoneId}`;
    // On garde comme « avant » le rattachement de MÊME zone s'il existe (simple mise à
    // jour), sinon le premier des anciens : la trace doit dire d'où la salle vient.
    const before = anciens.find(mapping => String(mapping.id) === id) ?? anciens[0] ?? null;
    for (const ancien of anciens) {
      if (String(ancien.id) !== id) {
        await tombstone('resource_zones', ancien.id, client);
        await retirerZoneTransitoireOrpheline(roomId, ancien.zoneId, client);
      }
    }
    const after = {
      id, resourceType: 'room', resourceId: roomId, zoneId,
      createdAt: before?.createdAt || nowIso(), updatedAt: nowIso()
    };
    await put('resource_zones', id, after, client);
    await audit({ actorId: actor?.id ?? null, zoneId, action: 'resource-zone.upsert', before, after }, client);
    return after;
  }

  /**
   * RETIRER les rattachements d'une salle — appelé à sa suppression.
   *
   * `resource_zones` est indexé par `resourceId`. Sans ce nettoyage, une salle recréée sous
   * le même identifiant héritait de la zone de la précédente : un accès que personne
   * n'avait accordé, à des données qui n'ont rien à voir.
   */
  async function detachRoomZones(actor, roomId, client = pool) {
    const anciens = await roomMappings(roomId, client);
    for (const ancien of anciens) {
      await tombstone('resource_zones', ancien.id, client);
      await audit({
        actorId: actor?.id ?? null, zoneId: ancien.zoneId,
        action: 'resource-zone.detach', before: ancien, after: null
      }, client);
      await retirerZoneTransitoireOrpheline(roomId, ancien.zoneId, client);
    }
    return anciens;
  }

  /** Les rattachements canoniques, sous la forme que le format d'échange attend. */
  async function roomZonePairs(client = pool) {
    const mappings = await list('resource_zones', client);
    return mappings
      .filter(mapping => singularType(mapping.resourceType) === 'room')
      .map(mapping => ({ roomId: String(mapping.resourceId), zoneId: String(mapping.zoneId) }));
  }

  /**
   * ÉCRIRE UN PAQUET DE SALLES AVEC LEURS ZONES — sauvegarde, import, inventaire.
   *
   * Trois portes déposaient des salles sans rattachement : la restauration d'une archive,
   * l'import JSON d'une liste de salles, et le remplacement d'inventaire qui écrivait
   * directement dans IndexedDB. Une salle sans zone n'appartient à personne : elle
   * disparaît de tous les écrans à périmètre, et l'écran des accès ne la propose même pas
   * au rattachement. Les trois passent désormais ici.
   *
   * TOUT est vérifié avant que QUOI QUE CE SOIT ne soit écrit, et l'écriture entière tient
   * dans une seule transaction : un paquet à moitié appliqué laisserait des salles
   * orphelines, c'est-à-dire exactement ce qu'on ferme.
   */
  async function applyRoomTransfer(actor, bundle, client = null) {
    const rooms = Array.isArray(bundle?.rooms) ? bundle.rooms : [];
    const zoneParSalle = new Map((bundle?.roomZones || [])
      .map(paire => [String(paire.roomId), String(paire.zoneId)]));
    if (!rooms.length) return { rooms: 0, roomZones: 0 };

    // ── 1 · tout vérifier, sans rien écrire
    const aEcrire = [];
    const aReconcilier = [];
    for (let room of rooms) {
      const roomId = String(room?.id ?? '');
      if (!roomId) {
        throw Object.assign(new Error('Une salle du fichier n’a pas d’identifiant.'),
          { status: 400, code: 'ROOM_ID_REQUIRED' });
      }
      let zoneId = zoneParSalle.get(roomId) || null;

      if (!seesEveryZone(actor)) {
        if (!zoneId) {
          throw Object.assign(new Error(`La salle « ${room.name || roomId} » n’indique aucune zone : votre rôle ne peut pas en déposer une sans zone.`),
            { status: 400, code: 'ROOM_ZONE_REQUIRED' });
        }
        // Zone inexistante et zone interdite rendent le MÊME refus : distinguer les deux
        // dirait à qui n'y a pas accès quelles zones existent.
        if (!(await hasPermission(actor, zoneId, 'room.edit'))) {
          throw Object.assign(new Error(`Vous n’êtes pas autorisé à déposer une salle dans la zone « ${zoneId} ».`),
            { status: 403, code: 'ZONE_FORBIDDEN' });
        }
        // Et sur une salle qui existe déjà, l'autorisation d'écriture ACTUELLE est requise :
        // sinon un import servirait à s'emparer d'une salle qu'on ne peut pas modifier.
        const existante = await get('rooms', roomId);
        if (existante && !(await canAccessRecord(actor, 'rooms', existante, 'write'))) {
          throw Object.assign(new Error(`Vous n’êtes pas autorisé à modifier la salle « ${room.name || roomId} ».`),
            { status: 403, code: 'ZONE_FORBIDDEN' });
        }
      } else if (zoneId && !(await get('zones', zoneId))) {
        throw Object.assign(new Error(`Zone introuvable : « ${zoneId} ».`), { status: 404, code: 'ZONE_NOT_FOUND' });
      }

      /*
       * R4 — LE DÉPÔT N'EST PAS UNE PORTE DÉROBÉE VERS `responsibleId`.
       *
       * MESURÉ : `PUT /api/data/rooms/:id {responsibleId}` rendait 403
       * RESPONSIBLE_ASSIGN_ADMIN_ONLY à un chef, et le MÊME changement passé par
       * `POST /api/rooms/transfer` rendait 200. Le contrat de dépôt ne dépouille que
       * `zoneId`/`zoneIds` ; `responsibleId` traversait intact et s'écrivait par `put()`
       * direct. Depuis A-1 le redémarrage n'octroie plus rien, si bien que le résultat
       * n'était plus une escalade mais une INCOHÉRENCE : la salle nommait un responsable
       * que `zone_memberships` et `zone_grants` ne connaissaient pas.
       *
       * DEUX actes touchent à l'autorité, pas un seul : changer le responsable, et
       * DÉPLACER une salle qui en porte un — le second emporte l'autorité d'une zone à
       * l'autre. Les deux relèvent donc de la même règle que nommer un responsable de zone.
       *
       * Un dépôt qui ne change NI l'un NI l'autre reste ouvert à un rôle à périmètre :
       * c'est l'aller-retour export/import ordinaire, et le refuser casserait un usage
       * légitime sans rien protéger.
       */
      const existantePourResponsable = await get('rooms', roomId, client || pool);
      // R9 — même règle qu'au `PUT` : un dépôt qui n'énonce pas le responsable ne le
      // retire pas. `room` est réaffectée pour que la comparaison ET l'écriture plus bas
      // portent sur la fiche normalisée.
      room = normalizeRoomResponsible('rooms', room, existantePourResponsable);
      const zonesAvantDepot = await zonesForRoom(roomId, client || pool);
      const porteUnResponsable = Boolean(existantePourResponsable?.responsibleId || room?.responsibleId);
      const changeLeResponsable = responsibleChangeRequested('rooms', room, existantePourResponsable);
      const deplaceUnResponsable = porteUnResponsable && Boolean(zoneId)
        && zonesAvantDepot.length > 0 && !zonesAvantDepot.map(String).includes(String(zoneId));

      if ((changeLeResponsable || deplaceUnResponsable) && !seesEveryZone(actor)) {
        throw Object.assign(
          new Error(`Seul l'administrateur global peut désigner ou déplacer le responsable de la salle « ${room.name || roomId} ».`),
          { status: 403, code: 'RESPONSIBLE_ASSIGN_ADMIN_ONLY' });
      }
      // Seul un acteur global réconcilie : lui seul peut écrire une autorité de zone, et
      // `ensureMembership` le lui redemandera de toute façon.
      if (porteUnResponsable && seesEveryZone(actor)) {
        aReconcilier.push({
          roomId,
          previousResponsibleId: existantePourResponsable?.responsibleId ?? '',
          previousZoneIds: zonesAvantDepot
        });
      }

      aEcrire.push({ room, roomId, zoneId });
    }

    // ── 2 · tout écrire, dans une seule transaction
    const propre = client || await pool.connect();
    const transactionLocale = !client;
    try {
      if (transactionLocale) await propre.query('BEGIN');
      let rattachements = 0;
      for (const { room, roomId, zoneId } of aEcrire) {
        const { zoneId: _a, zoneIds: _b, ...sansZone } = room;
        await put('rooms', roomId, sansZone, propre);
        // Un rôle global peut déposer une salle sans zone : elle reçoit alors la sienne,
        // neuve et à son nom, tout de suite — jamais une zone existante, jamais « plus tard ».
        const cible = zoneId || await zoneTransitoirePour(room, propre);
        await setRoomZone(actor, roomId, cible, propre);
        rattachements += 1;
      }
      /*
       * R7 — la réconciliation vient APRÈS le lot ENTIER, jamais salle par salle.
       *
       * Le décompte de `roomsDeclarantResponsable()` lit toutes les salles : l'appliquer
       * au milieu du lot le ferait raisonner sur un état à moitié écrit — une salle déjà
       * déposée et sa voisine pas encore, donc une autorité révoquée puis reposée, avec
       * deux entrées d'audit pour une seule décision.
       */
      await reconcileRoomsResponsible(actor, aReconcilier, propre);
      if (transactionLocale) await propre.query('COMMIT');
      return { rooms: aEcrire.length, roomZones: rattachements };
    } catch (error) {
      if (transactionLocale) await propre.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (transactionLocale) propre.release();
    }
  }

  /**
   * ÉCRIRE UN GRAPHE DE LOCALISATIONS — TOUT, OU RIEN (P0-C).
   *
   * LE DÉFAUT QUE CETTE FONCTION FERME. La restauration écrivait les localisations une par
   * une depuis le navigateur : `for (record of ordonnees) { try { await db.save(...) }
   * catch { continue } }`. Chaque `db.save` part en PUT indépendant vers le serveur. Une
   * Ville acceptée puis une Région refusée — 409, permission, refus définitif — laissait la
   * Ville écrite et l'arbre coupé en deux, derrière une restauration qui se croyait
   * réussie. Valider le graphe avant la boucle ne protège de rien ici : la validation
   * répond « ce lot est cohérent », pas « les N écritures qui suivent aboutiront toutes ».
   *
   * Aucune compensation côté client ne répare cela : supprimer après coup ce qui a été
   * écrit est une seconde série d'écritures, qui peut échouer à son tour ou courir contre
   * un autre auteur. La seule garantie qui tienne est que la base n'expose jamais l'état
   * intermédiaire — donc UNE transaction PostgreSQL, ici, côté serveur.
   *
   * On suit exactement le chemin d'`applyRoomTransfer`, juste au-dessus : tout vérifier
   * sans rien écrire, puis tout écrire dans une seule transaction, `ROLLBACK` sur le
   * moindre échec. `put()` passe par `compareAndWrite` avec le `client` de la transaction,
   * donc les révisions avancent normalement et les sessions ouvertes ne réécrasent rien.
   *
   * ACL INCHANGÉE : `system.restore` est déjà défini dans `permissions.js`, et n'est vrai
   * que pour l'administrateur — le même rôle qui seul dispose de `system.backup`, donc du
   * bouton qui appelle cette route. On réutilise cette porte, on n'en ouvre pas une.
   */
  async function applyLocationsRestore(actor, bundle) {
    const records = Array.isArray(bundle?.locations) ? bundle.locations : [];

    // ── 1 · la porte : restaurer est une décision d'administrateur, comme sauvegarder
    if (!PermissionManager.check(actor, 'system', 'restore')) {
      throw Object.assign(new Error('Vous n’êtes pas autorisé à restaurer des localisations.'),
        { status: 403, code: 'LOCATIONS_RESTORE_FORBIDDEN' });
    }

    if (!records.length) return { locations: 0 };

    // ── 2 · le graphe ENTIER, contre le lot ET la base : toujours avant la moindre écriture
    const existantes = await list('locations');
    const verdict = validateLocationHierarchy(records, { existingLocations: existantes });
    if (!verdict.ok) {
      throw Object.assign(
        new Error(`Graphe de localisations invalide : ${verdict.errors.map(e => e.message).join(' · ')}`),
        { status: 400, code: 'LOCATIONS_GRAPH_INVALID', errors: verdict.errors }
      );
    }

    // Ville, puis Région, puis Département : un parent est écrit avant l'enfant qui le
    // réclame, y compris dans l'état transitoire à l'intérieur de la transaction.
    const ordonnees = [...records].sort((a, b) => locationLevel(a?.kind) - locationLevel(b?.kind));
    for (const record of ordonnees) {
      if (record?.id === undefined || record?.id === null || String(record.id) === '') {
        throw Object.assign(new Error('Une localisation du fichier n’a pas d’identifiant.'),
          { status: 400, code: 'LOCATION_ID_REQUIRED' });
      }
    }

    // ── 3 · tout écrire, dans une seule transaction
    const propre = await pool.connect();
    try {
      await propre.query('BEGIN');
      for (const record of ordonnees) {
        await put('locations', String(record.id), record, propre);
      }
      await propre.query('COMMIT');
      return { locations: ordonnees.length };
    } catch (error) {
      // Zéro changement net : ni la Ville déjà passée, ni rien de ce qui suivait.
      await propre.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      propre.release();
    }
  }

  /**
   * Les salles dont la zone se contredit — lues à la demande, jamais mises en cache.
   *
   * Un conflit se répare ; le lire depuis la base plutôt que depuis un instantané de
   * démarrage évite de continuer à l'annoncer une fois réglé.
   */
  async function roomZoneConflicts(client = pool) {
    const [rooms, mappings, zones] = await Promise.all([
      list('rooms', client), list('resource_zones', client), list('zones', client)
    ]);
    const zonesById = new Map(zones.map(zone => [String(zone.id), zone]));
    const conflits = [];
    for (const room of rooms) {
      const siennes = mappings.filter(mapping =>
        singularType(mapping.resourceType) === 'room' && String(mapping.resourceId) === String(room.id));
      const explicites = unique(siennes
        .filter(mapping => !zonesById.get(String(mapping.zoneId))?.autoCreatedFromRoomId)
        .map(mapping => mapping.zoneId));
      const heritees = unique([...(Array.isArray(room.zoneIds) ? room.zoneIds : []), room.zoneId]);
      const divergentes = heritees.filter(zoneId => !explicites.includes(String(zoneId)));
      if (explicites.length > 1 || (explicites.length && divergentes.length)) {
        conflits.push({
          code: ROOM_ZONE_CONFLICT, roomId: room.id, roomName: room.name || room.nom || '',
          zoneIds: unique([...explicites, ...heritees]),
          canonicalZoneIds: explicites, legacyZoneIds: heritees,
          message: `La salle « ${room.name || room.id} » est rattachée à plusieurs zones qui se contredisent. Choisissez celle qui fait foi depuis la gestion des accès.`
        });
      }
    }
    return conflits;
  }

  /**
   * L'exigence, énoncée AVANT toute lecture de base — donc sans rien révéler des zones.
   *
   * Elle ne s'applique qu'à qui pourrait effectivement créer : à un technicien, ce n'est
   * pas la zone qui manque mais le droit, et lui réclamer une zone laisserait croire
   * qu'elle suffirait.
   */
  async function authorizeRoomCreation(user, storeName, record, existing, client = pool) {
    if (storeName !== 'rooms' || existing) return null;
    const demandees = unique([...(Array.isArray(record?.zoneIds) ? record.zoneIds : []), record?.zoneId]);
    if (demandees.length > 1) {
      throw Object.assign(new Error("Une salle appartient à une seule zone : choisissez laquelle."),
        { status: 400, code: 'ROOM_ZONE_SINGLE' });
    }
    // Admin et manager court-circuitent les zones : sans zone demandée, la leur sera
    // fabriquée par `attachCreationZone`, immédiatement.
    if (seesEveryZone(user)) return { zoneId: demandees[0] ?? null };
    // Ce n'est pas la zone qui manque à un technicien : c'est le droit. Lui réclamer une
    // zone laisserait croire qu'elle suffirait. On rend la main, et la garde ordinaire
    // refusera — une salle sans rattachement n'appartient à personne.
    if (!roleAllows(user, 'room.edit')) return null;
    if (!demandees.length) {
      throw Object.assign(new Error("Choisissez la zone dans laquelle créer cette salle : votre habilitation « Modifier une salle » ne vaut que dans les zones où elle vous a été accordée."),
        { status: 400, code: 'ROOM_ZONE_REQUIRED' });
    }
    // L'AUTORISATION DE CRÉER SE DÉCIDE ICI, sur la zone demandée.
    //
    // Elle ne peut pas passer par le résolveur ordinaire : celui-ci lit `resource_zones`,
    // et une salle qu'on crée n'y figure pas encore. Le faire lire aussi la charge utile
    // rouvrirait la double source que ce lot vient de fermer. La zone demandée est donc un
    // argument, vérifié explicitement — par la même règle « membre ∧ habilité » que
    // partout ailleurs.
    //
    // Une zone inexistante et une zone interdite rendent le MÊME refus : distinguer les
    // deux dirait à qui n'y a pas accès quelles zones existent.
    const zoneId = demandees[0];
    if (!(await hasPermission(user, zoneId, 'room.edit', client))) {
      throw Object.assign(new Error("Vous n'êtes pas autorisé à créer une salle dans cette zone."),
        { status: 403, code: 'ZONE_FORBIDDEN' });
    }
    return { zoneId };
  }

  /**
   * Le rattachement canonique, écrit APRÈS que l'autorisation a été accordée.
   *
   * Rend l'enregistrement débarrassé de sa zone : c'est cette version-là qu'il faut
   * stocker, et elle doit l'être dans la même transaction que le rattachement — une salle
   * enregistrée sans son rattachement n'appartiendrait à aucune zone, donc plus personne
   * ne pourrait ni la voir ni la corriger, sauf l'administrateur global.
   */
  async function attachCreationZone(actor, storeName, record, existing, client = pool) {
    if (storeName !== 'rooms' || existing) return record;
    const demandees = unique([...(Array.isArray(record?.zoneIds) ? record.zoneIds : []), record?.zoneId]);
    if (demandees.length > 1) {
      throw Object.assign(new Error("Une salle appartient à une seule zone : choisissez laquelle."),
        { status: 400, code: 'ROOM_ZONE_SINGLE' });
    }

    let zoneId = demandees[0];
    if (zoneId) {
      const zone = await get('zones', zoneId, client);
      if (!zone) throw Object.assign(new Error('Zone introuvable.'), { status: 404, code: 'ZONE_NOT_FOUND' });
    } else {
      // Aucune zone demandée : seul un rôle global en arrive ici — `assertCreationZone`
      // a déjà refusé les autres. Sa salle reçoit sa zone transitoire MAINTENANT, et non
      // « au prochain démarrage » : d'ici là elle n'appartiendrait à aucune zone, donc
      // aucun rôle à périmètre ne pourrait la voir et l'écran des accès ne la listerait
      // même pas pour la rattacher. La cohérence ne doit pas dépendre d'un redémarrage.
      //
      // La zone est NEUVE et porte l'identité de la salle. Retomber sur une zone
      // existante — « la première », « celle de l'auteur » — donnerait à la salle un
      // périmètre que personne n'a choisi.
      if (!seesEveryZone(actor)) return record;
      zoneId = await zoneTransitoirePour(record, client);
    }

    // Un rattachement qui REMPLACE : recréer une salle sous un identifiant déjà employé ne
    // doit pas lui rendre la zone de la précédente.
    await setRoomZone(actor, record.id, zoneId, client);
    const { zoneId: _zoneEnDoublon, zoneIds: _zonesEnDoublon, ...propre } = record;
    return propre;
  }

  async function createZone(actor, body) {
    if (!seesEveryZone(actor)) throw Object.assign(new Error("Seul l'administrateur global peut gérer les zones."), { status: 403, code: 'ADMIN_REQUIRED' });
    const id = String(body.id || `zone-${slugify(body.name)}-${Math.random().toString(36).slice(2, 6)}`);
    const before = await get('zones', id);
    const after = {
      ...before, id,
      name: String(body.name || before?.name || '').trim(),
      slug: slugify(body.slug || body.name || before?.slug || id),
      publicSummary: String(body.publicSummary ?? before?.publicSummary ?? '').slice(0, 2000),
      imageUrl: String(body.imageUrl ?? before?.imageUrl ?? ''),
      status: body.status || before?.status || 'active',
      createdAt: before?.createdAt || nowIso(), updatedAt: nowIso()
    };
    if (!after.name) throw Object.assign(new Error('Le nom de la zone est obligatoire.'), { status: 400, code: 'ZONE_NAME_REQUIRED' });
    await put('zones', id, after);
    await audit({ actorId: actor.id, zoneId: id, action: 'zone.upsert', before, after });
    return after;
  }

  async function safeUsersForManager(user) {
    if (seesEveryZone(user)) return (await list('users')).map(record => {
      const { password, passwordHash, passwordScheme, ...safe } = record; return safe;
    });
    const memberships = await activeMemberships(user.id);
    const zones = memberships.filter(item => item.responsible).map(item => String(item.zoneId));
    if (!zones.length) return [];
    const allMemberships = await list('zone_memberships');
    const ids = new Set(allMemberships.filter(item => zones.includes(String(item.zoneId))).map(item => String(item.userId)));
    return (await list('users')).filter(record => ids.has(String(record.id))).map(record => {
      const { password, passwordHash, passwordScheme, ...safe } = record; return safe;
    });
  }

  /* ────────────────────────── LE PLAN DOCUMENTÉ SUIT SON ÉQUIPEMENT
   *
   * Le jeu de données de la Grille Centrale décrit UN appareil réel : une matrice posée
   * dans une baie, dans une salle, donc dans une zone. Son autorisation n'a pas à être
   * inventée — elle est déjà écrite, et c'est celle de cet équipement.
   *
   * On résout donc la fiche canonique, puis on pose au moteur la question ordinaire :
   * `canAccessRecord(user, 'equipments', …, 'read')`. Aucun `role === 'admin'` n'est écrit
   * ici : administrateur et manager passent par le court-circuit `seesEveryZone` que le
   * moteur applique déjà à tout équipement, et un rôle à périmètre passe par
   * « membre ∧ habilité », zone par zone. Une seule règle, un seul endroit.
   *
   * L'IDENTIFICATION DOIT ÊTRE CERTAINE, SINON ON FERME.
   *
   * `catalogId` est le lien canonique ; les alias de nom ne servent qu'à rattraper une
   * fiche saisie avant lui. Deux candidats, c'est deux zones possibles et donc une
   * décision indécidable : on refuse. Zéro candidat, c'est un périmètre inconnu : on
   * refuse aussi. Rendre le jeu de données « parce que le rôle paraît puissant » ferait
   * exactement ce que ce lot ferme.
   */
  async function resolveGrilleCentraleEquipment(client = pool) {
    return resolveGrilleCentraleCandidate(await list('equipments', client));
  }

  /** Cet utilisateur peut-il recevoir le plan documenté de la Grille Centrale ? */
  /**
   * LE RELEVÉ DE LA RÉGIE CAR EST-IL DÛ À CETTE SESSION ? (A-5)
   *
   * Même contrat de confidentialité que la Grille Centrale, appliqué ici via la représentation
   * de compatibilité actuelle dans `rooms`. Ce rattachement par salle est TRANSITOIRE : la
   * Régie Car elle-même est une unité technique mobile, pas une salle. La décision passe
   * encore par le moteur d'accès ordinaire — jamais « authentifié donc autorisé ».
   *
   * CE QUE CETTE RECHERCHE REPRÉSENTE — ET CE QU'ELLE NE REPRÉSENTE PAS.
   *
   * Une Régie Car est une UNITÉ TECHNIQUE MOBILE, pas une salle : plusieurs unités peuvent
   * coexister, et une même unité se déplace entre villes et sites sans que son identité ni
   * celle de ses baies change. La recherche par salle ci-dessous est donc une COMPATIBILITÉ
   * avec l'unité actuellement inventoriée, pas le modèle métier définitif.
   *
   * Elle est volontairement isolée ici : le jour où l'unité mobile devient une entité de
   * premier ordre, c'est CETTE fonction qui résout l'unité et son déploiement courant, et
   * rien d'autre dans la chaîne de confidentialité n'a à changer.
   *
   * LE CAS DE LA PREMIÈRE FOIS. `ensureRegieCarPhase16()` CRÉE cette salle : exiger qu'elle
   * existe déjà rendrait l'amorçage impossible pour tout le monde, à jamais. Tant qu'elle
   * n'existe pas, seul un rôle global — le seul qui puisse légitimement créer une salle et
   * la rattacher à une zone — obtient le relevé. Un visiteur ne reçoit rien, ni avant ni
   * après : c'est fermé dans les deux états, et la porte ne s'ouvre pas d'elle-même.
   */
  async function canReadRegieCarDataset(user, client = pool) {
    if (!user || !roleOf(user)) return { allowed: false, reason: 'unknown-role' };
    const salles = await list('rooms', client);
    const salle = salles.find(item =>
      String(item?.id) === 'room-regie-car'
      || String(item?.fieldIdentityKey || '') === 'field-room:regie-car');
    if (!salle) {
      const global = seesEveryZone(user);
      return { allowed: global, reason: global ? 'bootstrap-global-role' : 'no-canonical-room' };
    }
    const allowed = await canAccessRecord(user, 'rooms', salle, 'read', client);
    return { allowed, reason: allowed ? 'room-scope' : 'room-forbidden', roomId: salle.id };
  }

  async function canReadGrilleCentraleDataset(user, client = pool) {
    if (!user || !roleOf(user)) return { allowed: false, reason: 'unknown-role' };
    const { equipment, reason, candidates } = await resolveGrilleCentraleEquipment(client);
    // Ni l'administrateur ni le manager ne court-circuitent CECI : sans fiche canonique, le
    // périmètre du jeu de données est inconnu, et un périmètre inconnu ferme.
    if (!equipment) return { allowed: false, reason, candidates };

    // Une identité que les écrans ne reconnaîtraient pas n'est pas ACHEVÉE : on ferme, et on
    // dit pourquoi (#166 — le raisonnement est dans `grille-centrale-identity.js`).
    if (!estReconnuParLesEcransPublics(equipment)) {
      return { allowed: false, reason: 'canonical-link-required', equipmentId: equipment.id };
    }

    const allowed = await canAccessRecord(user, 'equipments', equipment, 'read', client);
    return { allowed, reason: allowed ? 'equipment-scope' : 'equipment-forbidden', equipmentId: equipment.id };
  }

  return {
    ACCESS_STORES, PERMISSIONS, ROLE_CEILINGS,
    ensureModel, list, get, put, tombstone, audit,
    roleAllows, activeMemberships, activeGrants, hasPermission, hasEffectivePermissionSomewhere, isZoneResponsible,
    resolveResourceZones, canAccessRecord, publicZoneSummaries, contextFor, canManageZone,
    operationalMapZones, canReadOperationalMap,
    resolveGrilleCentraleEquipment, canReadGrilleCentraleDataset, canReadRegieCarDataset,
    grantPermission, ensureMembership, revokeGrant, createRequest, requestsFor, reviewRequest,
    RESPONSIBLE_DEFAULT_PERMISSIONS, RESPONSIBLE_GRANT_SOURCE,
    responsibleChangeRequested, assertResponsibleAssignment, applyResponsibleAssignment,
    normalizeRoomResponsible,
    reconcileRoomResponsible, reconcileRoomsResponsible, roomsDeclarantResponsable,
    mapResource, createZone, safeUsersForManager,
    authorizeRoomCreation, attachCreationZone,
    zonesForRoom, roomMappings, setRoomZone, detachRoomZones, roomZoneConflicts,
    roomZonePairs, applyRoomTransfer, applyLocationsRestore,
    /*
     * LA DÉCISION DE RÔLE, SÉPARÉE DE CELLE DE ZONE.
     *
     * `canAccessRecord` répond par un booléen : la route ne pouvait donc pas distinguer
     * « votre rôle n'a pas le droit de faire cela » de « vous n'avez pas autorité sur ce
     * périmètre », et rendait `ZONE_FORBIDDEN` dans les deux cas. Un administrateur
     * cherchait alors du côté des habilitations de zone un refus qui n'en venait pas.
     *
     * La garde reste DANS `canAccessRecord` — tout appelant en bénéficie, y compris ceux
     * qui n'utilisent pas cette route. Celle-ci sert uniquement à nommer correctement le
     * refus, jamais à le décider une seconde fois.
     */
    roleAllowsStoreAction: (user, storeName, action) =>
      matriceCanoniqueAutorise(user, storeName, action) !== false
  };
}

export { ACCESS_STORES, PERMISSIONS, ROLE_CEILINGS, ROOM_ZONE_CONFLICT, isCatalogDefinition, isContradictoryCatalogWrite, hasOperationalAttachment };
