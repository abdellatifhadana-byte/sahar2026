import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { createAccessControl, isContradictoryCatalogWrite, hasOperationalAttachment } from './access-control.js';
import { ensureGrilleCentraleOperationalRecords } from './grille-centrale-operational-bootstrap.js';
import { MAP_SOURCE, OPERATIONAL_MAP_FILES, isOperationalMapAsset, classifyOperationalMapSource } from '../map-image-contract.js';

/**
 * QUELLE VERSION TOURNE VRAIMENT.
 *
 * Un correctif qui ne touche QUE du code serveur — une règle de permission, par exemple —
 * ne change aucun fichier servi au navigateur. Comparer les octets des fichiers statiques
 * ne dit alors RIEN : on vérifie des fichiers que le correctif n'a jamais touchés, et on
 * conclut « déployé » sans preuve. C'est arrivé, et il a fallu une capture d'écran de la
 * console Railway pour s'apercevoir que le déploiement était en file d'attente.
 *
 * `/api/health` annonce donc le commit servi et l'heure de démarrage du processus. Une seule
 * requête suffit désormais à savoir si un correctif est en ligne — y compris quand il est
 * invisible depuis le navigateur.
 *
 * L'empreinte courte d'un commit ne donne accès à rien : c'est un numéro de version, et
 * `/api/health` est justement l'endroit où l'on publie un numéro de version.
 */
const VERSION_DEPLOYEE = Object.freeze({
  commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || '').slice(0, 12) || 'inconnu',
  demarreLe: new Date().toISOString()
});
import { evaluatePassword, passwordRejectionMessage } from '../password-policy.js';
import { buildRoomTransfer, readRoomTransfer } from '../room-zone-transfer-contract.js';
import { expectedRevisionFrom, staleWriteResponse, withRevision, REVISION_FIELD } from '../revision-contract.js';
import {
  compareAndWrite, tombstoneWithRevision, tombstoneManyWithRevision, realignEquipmentRoomsForBaie
} from './revision-store.js';
import { applyBaieLocation } from '../equipment-write-contract.js';
import { normalizeRole, resolveKnownRole, canManageRole, assignableRoles, assertRoleAssignment, canWriteStoreByRole, CANONICAL_ROLES, ROLE_ERRORS } from '../roles.js';
import { TOPOLOGY_KINDS, TOPOLOGY_KIND_SET, validateTopologyRecord, validateTopologyReferences } from '../topology-contract.js';
import { REQUEST_STATUSES, RELATED_TYPES, requestKindDefinition, requestSlaMinutes, validateRequestPayload } from '../service-request-contract.js';
import { validateEquipmentKnowledge } from '../equipment-knowledge-contract.js';
import {
  normalizePorts, normalizeCableRecord, validateCableShape, validateEquipmentConnectivity,
  validateScreenConnectivity, evaluateConnection, cableAllowsReverse, isCableActive,
  validateSignalModeForPorts,
  sanitizeCableRoute, sameCableRoute, routeScenes, routeIsDocumented, routeIsPartial,
  ROUTE_SCENE_TYPES
} from '../connectivity-contract.js';
import {
  CONTINUITY_KINDS, CONTINUITY_KIND_SET, normalizeContinuityRecord,
  validateContinuityRecord, applyContinuityApproval
} from '../continuity-contract.js';
import { DIAGRAM_RECORD_KIND, DIAGRAM_RELATION_KINDS, normalizeDiagram, validateDiagram, applyDiagramApproval } from '../diagram-contract.js';

const { Pool } = pg;
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || '';
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGPOOL_MAX || 8)
}) : null;
const access = pool ? createAccessControl(pool) : null;
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET absent : utilisez une valeur Railway stable et secrète avant la mise en production définitive.');
if (!databaseUrl) console.warn('DATABASE_URL absent : la plateforme reste en mode local IndexedDB.');

const SYNC_STORES = new Set([
  'users','locations','rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','docs','faq','notifications','logs','attachments',
  'cables','cable_reports','settings'
]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

const PRIVATE_PREFIXES = new Set(['.git', '.github', 'scripts', 'tests', 'node_modules', 'LEGACY-ROOT', 'SOURCE-WALLS']);
const PRIVATE_FILES = new Set(['package.json', 'package-lock.json', '.env', '.env.local', '.env.production']);
/** Le dossier des relevés d'installation : jamais servi, où qu'il se trouve (A-5). */
const PRIVATE_OPERATIONAL_DIR = 'private-operational-data';
const normalizeUsername = value => String(value || '').trim().toLocaleLowerCase('fr-FR');
/**
 * DEUX QUESTIONS DISTINCTES, LONGTEMPS CONFONDUES.
 *
 * `isAdminRole = role === 'admin' || role === 'manager'` répondait « oui » au manager pour
 * les VINGT-SIX points d'entrée qui l'interrogeaient — y compris la fermeture définitive
 * d'une demande, l'écriture des réglages, et le contournement des permissions de zone.
 * Le manager doit voir toute la chaîne ; il n'a pas à la reconfigurer.
 *
 * - `isPlatformAdmin` : l'administrateur global, celui des variables Railway. Lui seul
 *   dispose des leviers qui engagent la plateforme.
 * - `seesEverything`  : lecture sans restriction de zone. Le manager en fait partie, car
 *   « voir tout ce qui concerne la chaîne » est précisément son rôle.
 */
const isPlatformAdmin = role => normalizeRole(role) === CANONICAL_ROLES.ADMIN;
const seesEverything = role => {
  const canonique = normalizeRole(role);
  return canonique === CANONICAL_ROLES.ADMIN || canonique === CANONICAL_ROLES.MANAGER;
};
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(password), salt, 64);
  return `scrypt-v1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(record, password) {
  const encoded = String(record?.passwordHash || '');
  if (encoded.startsWith('scrypt-v1$')) {
    const [, saltText, hashText] = encoded.split('$');
    try {
      const expected = Buffer.from(hashText, 'base64url');
      const actual = scryptSync(String(password), Buffer.from(saltText, 'base64url'), expected.length);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch { return false; }
  }
  if (record?.password) {
    return safeEqualText(record.password, Buffer.from(String(password), 'utf8').toString('base64'));
  }
  return false;
}

function safeUserRecord(record = {}) {
  const {
    password: _legacy,
    passwordHash: _hash,
    passwordScheme: _scheme,
    platformAdminResetVersion: _resetVersion,
    platformAdminResetAt: _resetAt,
    ...safe
  } = record;
  return {
    ...safe,
    username: escapeHtml(safe.username || ''),
    fullName: escapeHtml(safe.fullName || '')
  };
}

function sanitizeDisplayRecord(storeName, record) {
  if (!['logs', 'screen_issues'].includes(storeName)) return record;
  const visit = value => {
    if (typeof value === 'string') return escapeHtml(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(record);
}

/**
 * L'image du plan quitte l'instantané.
 *
 * Mesuré : `MAX_MAP_IMAGE_BYTES` autorise 12 Mo, soit environ 16 Mo une fois encodés en
 * base64, et cette image vit dans `settings/global` — l'enregistrement que CHAQUE
 * utilisateur reçoit dans CHAQUE instantané. La synchronisation repartant toutes les vingt
 * secondes, cela représente près de trois gigaoctets par heure ET PAR POSTE, pour une image
 * qui ne change jamais. Sur le forfait mobile d'un technicien en intervention, c'est
 * intenable.
 *
 * L'instantané ne transporte donc plus qu'une empreinte. Le poste télécharge les octets une
 * seule fois, quand l'empreinte change, par `/api/settings/map-image`, et les conserve
 * localement. « Transmettre une fois, pas toutes les vingt secondes. »
 */
/*
 * ET DEPUIS #131, CE N'EST PLUS SEULEMENT UNE QUESTION DE POIDS.
 *
 * L'allègement ne s'appliquait qu'aux charges `data:` : un plan désigné par un CHEMIN
 * traversait l'instantané tel quel. Le poste apprenait donc où le prendre, et allait le
 * chercher comme un fichier statique ordinaire — hors de toute autorisation.
 *
 * La source est désormais retirée DANS TOUS LES CAS. L'instantané ne porte qu'une
 * empreinte, et `/api/settings/map-image` est le seul chemin vers les octets. Un poste
 * qui n'a pas le droit au plan n'apprend même pas comment il s'appelle.
 */
function mapImageFingerprint(url) {
  return createHmac('sha256', 'map-image').update(String(url || '')).digest('hex').slice(0, 32);
}

function stripMapImagePayload(record) {
  const empreinte = effectiveMapImageRef(record);
  const allege = { ...record };
  delete allege.mapImageUrl;
  if (empreinte) allege.mapImageRef = empreinte;
  else delete allege.mapImageRef;
  return allege;
}

/**
 * Le plan opérationnel intégré — celui que `settings-contract.js` désigne par défaut.
 *
 * Il n'est plus servi comme fichier statique (voir `isPrivateStaticPath`) : ses octets ne
 * sortent que par la route autorisée, exactement comme un plan téléversé. Sans cette
 * lecture, une installation neuve — dont le plan EST ce fichier — n'aurait plus de carte
 * du tout, y compris pour l'administrateur.
 */
let planIntegreEnMemoire;
function builtinOperationalMapDataUrl() {
  // Lu une seule fois : le fichier ne change pas en cours d'exécution, et l'empreinte de
  // l'instantané le consulte à chaque synchronisation.
  if (planIntegreEnMemoire !== undefined) return planIntegreEnMemoire;
  planIntegreEnMemoire = '';
  for (const relatif of OPERATIONAL_MAP_FILES) {
    const chemin = join(root, relatif);
    if (!existsSync(chemin) || !statSync(chemin).isFile()) continue;
    planIntegreEnMemoire = `data:image/png;base64,${readFileSync(chemin).toString('base64')}`;
    break;
  }
  return planIntegreEnMemoire;
}

/**
 * LA RÉFÉRENCE DU PLAN EFFECTIVEMENT EN VIGUEUR — quatre cas, pas deux.
 *
 * La première version retombait sur le plan intégré dès que la valeur n'était pas du
 * `data:`. Une image distante configurée par « Appliquer l'URL » était donc remplacée en
 * silence, et l'écran des réglages annonçait un enregistrement qui n'avait aucun effet.
 *
 * LE SERVEUR NE TÉLÉCHARGE RIEN. Pour une image distante il rend l'URL, et c'est le
 * navigateur qui va la chercher — exactement comme avant ce lot. Faire relayer cette URL
 * par le serveur transformerait une case de formulaire d'administration en requête sortante
 * choisie par l'utilisateur, c'est-à-dire en SSRF. Ce qui change n'est pas QUI charge
 * l'image, c'est QUI a le droit d'en apprendre l'adresse : elle ne sort plus qu'après
 * `canReadOperationalMap`.
 *
 * Une valeur inclassable ne rend RIEN : mieux vaut pas de plan qu'un plan deviné.
 */
function effectiveOperationalMap(settings) {
  const configuree = String(settings?.mapImageUrl || '');
  switch (classifyOperationalMapSource(configuree)) {
    case MAP_SOURCE.BUILTIN: return builtinOperationalMapDataUrl();
    case MAP_SOURCE.UPLOAD:
    case MAP_SOURCE.REMOTE:  return configuree;
    default:                 return '';
  }
}

/**
 * L'empreinte du plan en vigueur — la MÊME des deux côtés.
 *
 * L'instantané l'annonce, la route la confirme. Calculées séparément, elles finiraient par
 * diverger et le poste retéléchargerait le plan à chaque synchronisation.
 */
function effectiveMapImageRef(settings) {
  const octets = effectiveOperationalMap(settings);
  return octets ? mapImageFingerprint(octets) : '';
}

function sanitizeForSync(user, storeName, record) {
  if (storeName === 'settings' && String(record?.id) === 'global') {
    return stripMapImagePayload(sanitizeDisplayRecord(storeName, record));
  }
  if (storeName === 'users') {
    if (!seesEverything(user?.role)) return null;
    return safeUserRecord(record);
  }
  return sanitizeDisplayRecord(storeName, record);
}

async function protectedDependencyStub(user, storeName, id, permission = 'cable.read') {
  if (!id || !access) return null;
  const record = await access.get(storeName, id);
  if (!record) return null;
  const zoneIds = await access.resolveResourceZones(storeName, record);
  if (!zoneIds.length) return { relation: 'external-protected', publicStatus: 'dependency-present' };
  for (const zoneId of zoneIds) if (await access.hasPermission(user, zoneId, permission)) return null;
  const zones = await access.publicZoneSummaries();
  const zone = zones.find(item => zoneIds.includes(String(item.id)));
  return {
    relation: 'external-protected',
    zone: zone ? { id: zone.id, name: zone.name } : undefined,
    publicStatus: 'dependency-present'
  };
}

async function protectedTechnicalReference(user, reference) {
  const target = await technicalReferenceTarget(
    reference,
    (storeName, id) => access.get(storeName, id),
    id => access.get('docs', id)
  );
  if (target?.record && await access.canAccessRecord(user, target.storeName, target.record, 'read')) {
    return { visible:true, reference };
  }
  const zoneIds = target?.record ? await access.resolveResourceZones(target.storeName, target.record) : [];
  const zones = await access.publicZoneSummaries();
  const zone = zones.find(item => zoneIds.includes(String(item.id)));
  return {
    visible:false,
    reference:{
      type:'protected', protected:true, relation:'external-protected',
      publicStatus:'dependency-present',
      zone:zone ? { id:zone.id, name:zone.name } : undefined
    }
  };
}

async function redactTechnicalDocument(user, record) {
  const output = structuredClone(record);
  if (output.kind === DIAGRAM_RECORD_KIND) {
    const protectedNodeIds = new Map(); let protectedIndex = 0;
    for (const node of output.nodes || []) {
      if (!node.entityRef) continue;
      const checked = await protectedTechnicalReference(user, node.entityRef);
      if (checked.visible) continue;
      const previousId = String(node.id);
      const replacementId = `protected-node-${++protectedIndex}`;
      protectedNodeIds.set(previousId, replacementId);
      node.id = replacementId;
      node.label = 'Dépendance protégée';
      node.entityRef = checked.reference;
      delete node.portId;
    }
    for (const edge of output.edges || []) {
      let touchesProtectedNode = false;
      if (protectedNodeIds.has(String(edge.sourceNodeId))) {
        edge.sourceNodeId = protectedNodeIds.get(String(edge.sourceNodeId)); delete edge.sourcePortId; touchesProtectedNode = true;
      }
      if (protectedNodeIds.has(String(edge.destinationNodeId))) {
        edge.destinationNodeId = protectedNodeIds.get(String(edge.destinationNodeId)); delete edge.destinationPortId; touchesProtectedNode = true;
      }
      if (touchesProtectedNode) {
        edge.label = 'Dépendance protégée';
        delete edge.notes;
        delete edge.description;
      }
      if (edge.cableId) {
        const checked = await protectedTechnicalReference(user, { type:'cable', id:edge.cableId });
        if (!checked.visible) { delete edge.cableId; edge.cableProtected = checked.reference; }
      }
      if (edge.relationId) {
        const relation = await access.get('docs', edge.relationId);
        if (!relation || !await access.canAccessRecord(user, 'docs', relation, 'read')) {
          delete edge.relationId;
          edge.relationProtected = { type:'protected', protected:true, relation:'external-protected', publicStatus:'dependency-present' };
        }
      }
    }
  }

  if (output.kind === CONTINUITY_KINDS.PROTECTION_GROUP) {
    for (const path of [output.primaryPath, ...(output.backupPaths || [])]) {
      for (const key of ['entityRefs', 'dependencyRefs']) {
        const references = [];
        for (const reference of path?.[key] || []) references.push((await protectedTechnicalReference(user, reference)).reference);
        if (path) path[key] = references;
      }
      if (path?.signalPathId) {
        const checked = await protectedTechnicalReference(user, { type:'signal-path', id:path.signalPathId });
        if (!checked.visible) { delete path.signalPathId; path.signalPathProtected = checked.reference; }
      }
    }
    if (output.switchoverPoint) output.switchoverPoint = (await protectedTechnicalReference(user, output.switchoverPoint)).reference;
    const common = [];
    for (const reference of output.commonDependencyRefs || []) common.push((await protectedTechnicalReference(user, reference)).reference);
    output.commonDependencyRefs = common;
  }

  if (output.kind === CONTINUITY_KINDS.PROCEDURE) {
    for (const step of output.steps || []) {
      const references = [];
      for (const reference of step.entityRefs || []) references.push((await protectedTechnicalReference(user, reference)).reference);
      step.entityRefs = references;
    }
  }
  return output;
}


/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LE TRACÉ D'UN CÂBLE NE CONTOURNE PAS L'AUTORISATION DES SCÈNES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un câble peut être parfaitement visible alors que son cheminement traverse une salle ou
 * une baie que le lecteur n'a pas le droit de voir. Les coordonnées de ce passage sont de
 * l'information physique sur une zone protégée : servies telles quelles, elles feraient du
 * tracé un canal détourné autour de l'autorisation de la carte et des zones.
 *
 * L'AUTORISATION EST CELLE DE LA RESSOURCE, PAS CELLE DU CÂBLE — et surtout pas
 * `cable.roomId`, qui est un cache écrit une fois depuis la salle de la source, jamais
 * rafraîchi, et qui ne dit rien du cheminement.
 *
 *   segment `room`  → la salle elle-même, permission canonique de lecture des salles
 *   segment `baie`  → la baie elle-même, permission canonique de lecture des baies
 *   segment `map`   → le contrat existant du plan opérationnel, qui exige déjà
 *                     `zone.summary.read` sur TOUTES les zones que le plan représente
 *
 * `protectedDependencyStub` est la même primitive qui masque déjà les extrémités
 * hors périmètre : elle rend `null` quand la ressource est visible. Une scène dont la
 * ressource n'existe pas ferme — on ne prête pas d'autorisation à ce qu'on ne trouve pas.
 */
const ROUTE_SCENE_STORES = Object.freeze({ room: 'rooms', baie: 'baies' });
// Les mêmes permissions que `READ_PERMISSION_BY_STORE` (access-control.js) : une salle se
// lit sur le résumé de zone, une baie sur la lecture des équipements.
const ROUTE_SCENE_PERMISSIONS = Object.freeze({ room: 'zone.summary.read', baie: 'equipment.read' });

/*
 * D'ABORD LA RESSOURCE EXISTE, ENSUITE SEULEMENT LA QUESTION DES DROITS.
 *
 * La dérogation globale — administrateur, gestionnaire — signifie « franchir les
 * habilitations de zone sur une ressource RÉELLE ». Elle ne peut pas signifier « inventer
 * une ressource qui n'existe pas ». Placée en tête, elle le faisait pourtant.
 *
 * MESURÉ avant correction, serveur réel : administrateur ET gestionnaire, salle inexistante
 * ET baie inexistante — quatre écritures acceptées en 200, la scène fantôme persistée telle
 * quelle. Le jumeau numérique héritait d'une géométrie dont la scène ne s'ouvre jamais, et
 * c'est le rôle censé garantir la cohérence qui l'avait écrite.
 *
 * La RÉSOLUTION CANONIQUE est donc séparée de la décision d'accès : elle ne connaît aucun
 * rôle, et personne ne la contourne.
 */
async function routeSceneResolution(scene) {
  if (!access) return { exists: false, zoneIds: [] };
  if (scene?.sceneType === 'map') {
    // Le plan du site n'a pas d'enregistrement : il existe par construction, et le contrat
    // interdit déjà qu'un segment `map` porte un identifiant. Ses zones sont celles que le
    // contrat de la carte connaît déjà — aucun cache n'est fabriqué ici.
    const nu = scene.sceneId === null || scene.sceneId === undefined || scene.sceneId === '';
    return { exists: nu, zoneIds: nu ? await access.operationalMapZones() : [] };
  }
  const storeName = ROUTE_SCENE_STORES[scene?.sceneType];
  if (!storeName) return { exists: false, zoneIds: [] };
  if (scene.sceneId === null || scene.sceneId === undefined || scene.sceneId === '') return { exists: false, zoneIds: [] };
  const record = await access.get(storeName, scene.sceneId);
  if (!record) return { exists: false, zoneIds: [] };
  return { exists: true, zoneIds: await access.resolveResourceZones(storeName, record) };
}

/** La scène désigne-t-elle quelque chose de RÉEL ? Question de données, jamais de droits. */
const routeSceneExists = async scene => (await routeSceneResolution(scene)).exists;

async function routeSceneReadable(user, scene) {
  if (!access) return false;
  const { exists, zoneIds } = await routeSceneResolution(scene);
  if (!exists) return false;
  // Le plan a son propre contrat de lecture, qui exige déjà TOUTES les zones qu'il
  // représente et accorde déjà leur dérogation aux rôles globaux.
  if (scene.sceneType === 'map') return access.canReadOperationalMap(user);
  if (seesEverything(user?.role)) return true;
  if (!zoneIds.length) return false;
  return !(await protectedDependencyStub(user, ROUTE_SCENE_STORES[scene.sceneType],
    scene.sceneId, ROUTE_SCENE_PERMISSIONS[scene.sceneType]));
}

const cleScene = scene => `${scene.sceneType}:${scene.sceneId ?? ''}`;

/** Une décision par SCÈNE, pas par segment — un tracé repasse souvent dans la même salle. */
async function decisionsParScene(route, decide) {
  const decisions = new Map();
  for (const scene of routeScenes(route)) decisions.set(cleScene(scene), await decide(scene));
  return scene => decisions.get(cleScene(scene)) === true;
}

/** Les scènes d'un tracé que ce lecteur peut VOIR. Sert à la sanitisation, jamais à écrire. */
const readableRouteScenes = (user, route) => decisionsParScene(route, scene => routeSceneReadable(user, scene));

async function routeSceneWritable(user, scene) {
  if (!access) return false;
  const { exists, zoneIds } = await routeSceneResolution(scene);
  // L'existence AVANT toute dérogation : un rôle global franchit les zones, pas le néant.
  if (!exists) return false;
  // Écrire de la géométrie dans une scène qu'on n'a pas le droit de VOIR n'a pas de sens
  // légitime : la lecture est un préalable, pas une alternative.
  if (!(await routeSceneReadable(user, scene))) return false;
  /*
   * L'APPARTENANCE CANONIQUE DOIT SE RÉSOUDRE AVANT TOUTE DÉROGATION.
   *
   * MESURÉ sur PostgreSQL réel, avant cette ligne : une salle qui EXISTE sans rattachement
   * de zone — et une baie posée dans une telle salle — acceptaient l'écriture d'un tracé
   * par un administrateur comme par un gestionnaire, en 200, géométrie persistée. Le rôle
   * à périmètre, lui, était déjà refusé en 403. L'ordre en était la cause : la dérogation
   * globale répondait `true` AVANT que `!zoneIds.length` ne soit lu, si bien que seuls les
   * rôles à périmètre atteignaient ce garde-fou.
   *
   * « Voir toutes les zones » veut dire franchir les HABILITATIONS de zone sur une
   * ressource dont l'appartenance est connue. Cela ne peut pas vouloir dire écrire dans une
   * ressource dont l'appartenance ne se résout pas : personne ne pourrait alors dire de
   * quel périmètre relève la géométrie écrite, ni la protéger ensuite, ni la relire avec la
   * même règle. C'est le rôle censé garantir la cohérence qui fabriquerait l'incohérence.
   *
   * LE PLAN GÉNÉRAL EST HORS DE CETTE RÈGLE, et volontairement. Il n'est pas une ressource
   * rattachée : il n'a pas d'enregistrement, ses zones sont celles que le contrat de la
   * carte dérive des salles, et sa lecture passe déjà par `canReadOperationalMap`, qui les
   * exige TOUTES. Lui appliquer ce garde-fou changerait une sémantique que ce correctif
   * n'a pas mandat de toucher.
   */
  if (scene.sceneType !== 'map' && !zoneIds.length) return false;
  // Même dérogation globale que le reste du contrôle d'accès — admin et manager. Aucune
  // sémantique nouvelle, et elle ne porte que sur une scène RÉELLE et RATTACHÉE.
  if (seesEverything(user?.role)) return true;
  if (!zoneIds.length) return false;
  const decisions = await Promise.all(zoneIds.map(zoneId => access.hasPermission(user, zoneId, 'cable.edit')));
  return decisions.every(Boolean);
}

/** Les scènes d'un tracé où cet utilisateur peut réellement ÉCRIRE. */
const writableRouteScenes = (user, route) => decisionsParScene(route, scene => routeSceneWritable(user, scene));


/*
 * ═══════════════════════════════════════════════════════════════════════════
 * UN TRACÉ PARTIEL NE PEUT PAS ÉCRASER CE QU'IL NE CONTIENT PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * LE DANGER, EXACTEMENT.
 * Le serveur sert à un lecteur restreint un câble dont le tracé a été amputé de ses
 * segments protégés. Ce client fait ensuite une modification parfaitement légitime — il
 * corrige la référence du câble — et renvoie l'enregistrement tel qu'il l'a reçu. Sans
 * cette garde, l'écriture remplacerait le tracé complet par la vue amputée : les segments
 * que le serveur venait de PROTÉGER seraient DÉTRUITS, par une sauvegarde honnête, sans
 * que personne — ni l'écrivain, ni le propriétaire de la zone masquée — ne le sache.
 *
 * LA DÉCISION, EN TROIS TEMPS.
 *
 *   1 · Tout segment ENTRANT doit être dans une scène que l'écrivain peut voir. Écrire la
 *       géométrie d'une salle qu'on n'a pas le droit de regarder n'a pas de sens légitime,
 *       et fabriquerait de la donnée physique sur le périmètre d'autrui.
 *
 *   2 · Si le tracé STOCKÉ est entièrement visible pour cet écrivain, il peut le remplacer :
 *       il en a vu la totalité, sa version est une version informée.
 *
 *   3 · Sinon — il en existe des segments qu'il n'a jamais reçus :
 *         · s'il renvoie EXACTEMENT la vue qu'on lui avait servie, il n'a pas touché au
 *           tracé : on PRÉSERVE le tracé stocké, intact. Ce n'est pas une correction
 *           silencieuse de sa charge, c'est le refus de laisser une vue partielle valoir
 *           pour le tout.
 *         · s'il l'a modifiée, il tente un remplacement qu'il ne peut pas faire fidèlement :
 *           on REFUSE, et on le nomme. Fusionner à sa place inventerait un tracé que
 *           personne n'a relevé.
 *
 * Cette garde est INDÉPENDANTE de celle du client : elle tient même si l'écran ment, est
 * contourné, ou appelle l'API directement.
 */
async function resolveIncomingCableRoute(user, incoming, existing) {
  const entrant = incoming?.route ?? null;
  const stocke = existing?.route ?? null;
  const refus = (message, code) => Object.assign(new Error(message), { status: 403, code });

  const vueServie = routeIsDocumented(stocke)
    ? sanitizeCableRoute(stocke, await readableRouteScenes(user, stocke))
    : null;

  /*
   * LE TRACÉ A-T-IL BOUGÉ ? C'EST LA PREMIÈRE QUESTION, ET ELLE PASSE AVANT TOUTES LES
   * AUTRES.
   *
   * Renvoyer inchangé le tracé qu'on vient de recevoir est le comportement NORMAL d'un
   * client honnête qui corrige un autre champ du câble. Exiger de lui une autorité sur le
   * tracé rendrait inéditable tout câble dont le cheminement sort de son périmètre — la
   * protection deviendrait un blocage de l'exploitation courante. (Défaut mesuré une
   * première fois en épreuve de bout en bout, puis fermé ; l'ordre est ce qui le ferme.)
   *
   * On rend le tracé STOCKÉ, jamais celui qu'il a renvoyé : quand sa vue était amputée,
   * c'est la seule façon de ne pas effacer ce qu'il n'a jamais reçu.
   */
  if (sameCableRoute(entrant, vueServie)) return stocke;

  /* ─── À partir d'ici, le tracé CHANGE : créé, modifié, remplacé ou supprimé. ─── */

  /*
   * UNE SCÈNE PROPOSÉE DOIT EXISTER. C'est une question de DONNÉES, pas de droits, et elle
   * se pose avant toute autre : dessiner dans une salle absente produit une géométrie que
   * le jumeau numérique ne pourra jamais ouvrir. Le refus porte son propre nom — « cette
   * scène n'existe pas » et « cette scène ne vous appartient pas » sont deux faits.
   */
  for (const scene of routeIsDocumented(entrant) ? routeScenes(entrant) : []) {
    if (!(await routeSceneExists(scene))) {
      throw Object.assign(new Error("Le tracé désigne une scène qui n'existe pas."),
        { status: 400, code: 'ROUTE_SCENE_INVALID' });
    }
  }

  /*
   * CE QUI EST MASQUÉ PAR DROIT, ET CE QUI EST SIMPLEMENT CORROMPU.
   *
   * Le tracé stocké peut cacher des segments pour deux raisons très différentes : une scène
   * réelle hors périmètre — c'est une PROTECTION, et elle interdit le remplacement — ou une
   * scène qui n'existe plus, par exemple une salle supprimée depuis le relevé. La seconde
   * ne protège rien : traiter les deux pareil rendrait un tracé corrompu impossible à
   * réparer, y compris par un administrateur, et la donnée fausse resterait pour toujours.
   */
  // La MÊME règle que celle servie à l'écran (`cableRouteAccess`) : une capacité et une
  // garde qui divergeraient proposeraient un geste voué au refus, ou cacheraient un droit.
  const { existences, masqueeParDroit } = await routeAuthority(user, stocke);

  // Il n'a jamais vu en entier ce qu'il remplace : il ne peut pas le faire fidèlement.
  if (masqueeParDroit) {
    throw refus("Vous ne pouvez pas remplacer un tracé dont une partie est hors de votre périmètre.",
      'ROUTE_SCOPE_INSUFFICIENT');
  }
  // Un tracé marqué `partial` est une VUE, pas un relevé : il ne s'enregistre jamais.
  if (routeIsPartial(entrant)) {
    throw refus("Un tracé partiel ne peut pas être enregistré comme un relevé.", 'ROUTE_SCOPE_INSUFFICIENT');
  }

  /*
   * L'AUTORITÉ D'ÉCRITURE PORTE SUR TOUT CE QUE L'OPÉRATION TOUCHE.
   *
   * Les deux tracés comptent, et pour deux raisons distinctes : celui qu'il PROPOSE, parce
   * qu'on n'écrit pas de géométrie dans une scène où l'on n'a pas autorité ; celui qui est
   * STOCKÉ, parce que le remplacer ou le supprimer, c'est effacer chacun de ses segments —
   * y compris ceux d'une scène qu'il peut lire sans pouvoir la modifier.
   *
   * Aucune fusion n'est tentée : garder d'office les segments non modifiables et accepter
   * le reste fabriquerait un tracé que personne n'a relevé. Quand une seule scène du tracé
   * échappe à son autorité, la seule opération qui reste ouverte est celle qui ne change
   * rien — traitée plus haut.
   */
  for (const route of [entrant, stocke]) {
    if (!routeIsDocumented(route)) continue;
    const inscriptible = await writableRouteScenes(user, route);
    for (const scene of routeScenes(route)) {
      // Une scène du tracé STOCKÉ qui n'existe plus ne confère aucune protection : exiger
      // une autorité sur elle interdirait la réparation. Les scènes ENTRANTES, elles, ont
      // déjà toutes été prouvées réelles plus haut.
      if (route === stocke && !existences.get(cleScene(scene))) continue;
      if (inscriptible(scene)) continue;
      // On nomme le fait — une autorité manque sur une scène du tracé — sans dire
      // LAQUELLE, ni quelle habilitation : ce serait décrire le périmètre d'autrui.
      throw refus("Votre périmètre ne vous permet pas de modifier le tracé de ce câble.",
        'ROUTE_SCENE_EDIT_FORBIDDEN');
    }
  }
  return entrant;
}


/*
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CET UTILISATEUR PEUT FAIRE DU TRACÉ STOCKÉ — UNE SEULE RÈGLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux appelants ont besoin de la même réponse, et il serait fatal qu'ils en obtiennent
 * deux versions : la GARDE d'écriture, qui refuse, et la CAPACITÉ servie à l'écran, qui
 * décide d'afficher « Modifier le tracé ». Une capacité plus généreuse que la garde
 * proposerait un geste voué au 403 ; plus stricte, elle cacherait un droit réel.
 *
 * Trois faits, calculés une fois :
 *   masqueeParDroit   une scène RÉELLE du tracé échappe à sa lecture — il ne l'a pas vu
 *                     en entier, il ne peut pas le remplacer fidèlement ;
 *   toutInscriptible  il a l'autorité d'écriture sur chacune de ses scènes réelles ;
 *   existences        quelles scènes existent encore — une salle supprimée depuis le
 *                     relevé ne protège rien et n'exige aucune autorité.
 */
async function routeAuthority(user, storedRoute) {
  const scenes = routeIsDocumented(storedRoute) ? routeScenes(storedRoute) : [];
  const existences = new Map();
  for (const scene of scenes) existences.set(cleScene(scene), await routeSceneExists(scene));
  const reelles = scenes.filter(scene => existences.get(cleScene(scene)));
  if (!reelles.length) return { existences, masqueeParDroit: false, toutInscriptible: true };
  const lisible = await readableRouteScenes(user, storedRoute);
  const inscriptible = await writableRouteScenes(user, storedRoute);
  return {
    existences,
    masqueeParDroit: reelles.some(scene => !lisible(scene)),
    toutInscriptible: reelles.every(scene => inscriptible(scene))
  };
}

/*
 * LA CAPACITÉ SERVIE À L'ÉCRAN — ÉPHÉMÈRE, JAMAIS ENREGISTRÉE.
 *
 * Le navigateur ne peut PAS établir seul l'autorité d'écriture sur un tracé :
 * `/api/access/context` porte les zones, les adhésions et les habilitations, mais aucune
 * cartographie enregistrement → zones. Un écran qui déduirait « modifiable » de
 * `route.partial === false` ou d'un `cable.edit` détenu quelque part rouvrirait exactement
 * l'écart que le serveur vient de fermer : le bouton s'afficherait, le geste partirait, et
 * le refus arriverait après une modification déjà visible en local.
 *
 * Le serveur répond donc lui-même, avec la MÊME sémantique que sa garde. La réponse ne dit
 * QUE cela — ni zone, ni habilitation manquante, ni identifiant de scène, ni combien de
 * segments sont masqués.
 *
 * `editable` répond « puis-je remplacer, modifier ou supprimer CE tracé ? ». Quand il n'y
 * en a pas encore, elle répond « puis-je en créer un pour ce câble ? » — la scène choisie
 * étant, elle, revérifiée à l'enregistrement.
 */
const ROUTE_ACCESS_FIELD = 'routeAccess';

/*
 * TROIS QUESTIONS DISTINCTES, ET IL NE FAUT PAS EN DÉDUIRE UNE DE L'AUTRE.
 *
 *   readable        ce tracé, tel qu'il existe, m'est-il montré ?
 *   editable        puis-je REMPLACER, modifier ou supprimer ce tracé en entier ?
 *   creatableHere   puis-je écrire de la géométrie DANS CETTE SCÈNE-CI ?
 *
 * POURQUOI LA TROISIÈME EXISTE — défaut mesuré sur serveur réel.
 * Sur un câble SANS tracé, `routeAuthority(null)` ne rencontre aucune scène : rien n'est
 * masqué, tout est « inscriptible », et `editable` valait donc `true` dès que le câble
 * lui-même était modifiable. Or cela ne dit RIEN de la scène ouverte à l'écran. Mesuré :
 * un pilote habilité sur STC, la carte ouverte sur RF1 où il n'a que la lecture, recevait
 * `editable: true` — l'écran aurait affiché « Ajouter un tracé », et le serveur aurait
 * refusé le dessin en 403 une fois le trait posé. Une carte ne promet pas ce qu'elle
 * refusera ensuite.
 *
 * `creatableHere` n'est donc calculé QUE pour une scène explicitement demandée, jamais
 * déduit. Ajouter un segment à un tracé existant demande les DEUX : `editable` — on
 * remplace le tracé entier — et `creatableHere` pour la scène visée.
 */
/**
 * LE TRACÉ TEL QUE CET UTILISATEUR A LE DROIT DE LE VOIR, MAINTENANT.
 *
 * Une seule façon de le calculer, deux usages : la capacité qui en tire `readable`, et la
 * route de consultation qui le RENVOIE. Deux calculs finiraient par diverger, et c'est
 * précisément la divergence — permission fraîche, géométrie périmée — qu'on ferme ici.
 */
async function cableRouteView(user, storedCable) {
  const stockee = storedCable?.route ?? null;
  if (!routeIsDocumented(stockee)) return null;
  return sanitizeCableRoute(stockee, await readableRouteScenes(user, stockee));
}

async function cableRouteAccess(user, storedCable, scene = null) {
  const stockee = storedCable?.route ?? null;
  const vue = await cableRouteView(user, storedCable);
  const readable = routeIsDocumented(vue);
  const avecScene = (base, creatableHere) => (scene ? { ...base, creatableHere } : base);

  // Écrire le tracé, c'est écrire le câble : ce préalable n'est pas négociable.
  if (!(await access.canAccessRecord(user, 'cables', storedCable, 'update'))) {
    return avecScene({ readable, editable: false }, false);
  }
  const { masqueeParDroit, toutInscriptible } = await routeAuthority(user, stockee);
  const editable = !masqueeParDroit && toutInscriptible;
  if (!scene) return { readable, editable };
  // La scène vient de la DEMANDE, pas d'un cache : elle est résolue et jugée ici même.
  return avecScene({ readable, editable }, await routeSceneWritable(user, scene));
}

/** Pose la capacité sur le câble servi. Pour TOUS les rôles, y compris globaux. */
async function attachRouteAccess(user, storeName, served, stored) {
  if (storeName !== 'cables' || !served || !access) return served;
  return { ...served, [ROUTE_ACCESS_FIELD]: await cableRouteAccess(user, stored) };
}

async function redactCrossZoneRelations(user, storeName, record) {
  if (seesEverything(user?.role) || !record) return record;
  const output = structuredClone(record);

  if (storeName === 'cables') {
    for (const side of ['source', 'destination']) {
      const type = output[`${side}Type`] || (output[`${side}ScreenId`] != null ? 'screen' : 'equipment');
      const parentEquipmentId = output[`${side}ParentEquipmentId`];
      const rawId = type === 'component'
        ? parentEquipmentId
        : (output[`${side}Id`] ?? output[`${side}EquipmentId`] ?? output[`${side}ScreenId`]);
      const endpointStore = type === 'screen' ? 'screens' : 'equipments';
      const stub = await protectedDependencyStub(user, endpointStore, rawId, 'cable.read');
      if (!stub) continue;
      delete output[`${side}Id`];
      delete output[`${side}EquipmentId`];
      delete output[`${side}ScreenId`];
      delete output[`${side}ComponentId`];
      delete output[`${side}ParentEquipmentId`];
      delete output[`${side}PortId`];
      output[`${side}Protected`] = { ...stub, direction: side === 'source' ? 'upstream' : 'downstream' };
    }
    // Le tracé suit le même chemin que les extrémités : ce qui sort est ce que le lecteur
    // a le droit de voir, et un tracé amputé se déclare `partial` — sans dire combien de
    // segments manquent, ce qui serait déjà une information de topologie.
    if (routeIsDocumented(output.route)) {
      output.route = sanitizeCableRoute(output.route, await readableRouteScenes(user, output.route));
    }
  }

  if (storeName === 'screens' && output.equipmentId != null) {
    const stub = await protectedDependencyStub(user, 'equipments', output.equipmentId, 'equipment.read');
    if (stub) {
      delete output.equipmentId;
      output.equipmentProtected = stub;
    }
  }

  if (storeName === 'tickets' && output.relatedType && output.relatedId != null) {
    const relatedStore = relatedStoreForRequest(output.relatedType);
    const related = relatedStore ? await access.get(relatedStore, output.relatedId) : null;
    if (related && !await access.canAccessRecord(user, relatedStore, related, 'read')) {
      delete output.relatedId;
      output.relatedProtected = { relation:'external-protected', publicStatus:'dependency-present' };
    }
  }

  if (storeName === 'docs' && (output.kind === DIAGRAM_RECORD_KIND || CONTINUITY_KIND_SET.has(output.kind))) {
    return redactTechnicalDocument(user, output);
  }

  return output;
}

let schemaReady = false;
async function ensureSchema() {
  if (!pool) throw Object.assign(new Error('Base PostgreSQL non configurée'), { status: 503 });
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_records (
      store_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (store_name, record_id)
    );
    CREATE INDEX IF NOT EXISTS platform_records_store_idx ON platform_records(store_name, deleted);
  `);

  const legacyUsers = await pool.query("SELECT record_id,data FROM platform_records WHERE store_name='users' AND deleted=FALSE AND data ? 'password'");
  for (const row of legacyUsers.rows) {
    const record = { ...row.data };
    if (record.password) {
      let plain = '';
      try { plain = Buffer.from(String(record.password), 'base64').toString('utf8'); } catch {}
      if (plain) {
        record.passwordHash = hashPassword(plain);
        record.passwordScheme = 'scrypt-v1';
      }
    }
    delete record.password;
    record.authVersion = Math.max(1, Number(record.authVersion || 0) + 1);
    // Migration serveur : elle ne se compare à rien, mais elle FAIT AVANCER le compteur.
    // Un `UPDATE` direct changeait `passwordHash` et `authVersion` en laissant la révision
    // où elle était : un navigateur resté sur l'ancienne version se croyait alors à jour et
    // pouvait réécrire des données antérieures à la migration.
    await compareAndWrite(pool, { storeName: 'users', recordId: String(row.record_id), record, force: true });
  }

  const adminOne = await pool.query("SELECT data FROM platform_records WHERE store_name='users' AND record_id='1' AND deleted=FALSE LIMIT 1");
  if (!adminOne.rowCount || adminOne.rows[0]?.data?.role !== 'admin') {
    const historicalAdmin = await pool.query("SELECT record_id,data FROM platform_records WHERE store_name='users' AND deleted=FALSE AND data->>'role'='admin' ORDER BY updated_at DESC LIMIT 1");
    if (historicalAdmin.rowCount) {
      const sourceId = historicalAdmin.rows[0].record_id;
      const record = { ...historicalAdmin.rows[0].data, id: 1, role: 'admin', status: 'active', authVersion: Math.max(1, Number(historicalAdmin.rows[0].data?.authVersion || 1)) };
      await compareAndWrite(pool, { storeName: 'users', recordId: '1', record, force: true });
      // Le compte historique est retiré par une pierre tombale À RÉVISION : sans elle, une
      // session encore ouverte dessus resterait « à jour » et pourrait le faire revivre.
      if (String(sourceId) !== '1') await tombstoneWithRevision(pool, { storeName: 'users', recordId: String(sourceId) });
    } else {
      const username = String(process.env.PLATFORM_ADMIN_USERNAME || '').trim();
      const password = String(process.env.PLATFORM_ADMIN_PASSWORD || '');
      const fullName = String(process.env.PLATFORM_ADMIN_FULLNAME || 'Administrateur plateforme').trim();
      if (!username || password.length < 12) {
        throw Object.assign(new Error('Aucun administrateur global valide. Configurez PLATFORM_ADMIN_USERNAME et PLATFORM_ADMIN_PASSWORD (12 caractères minimum) dans Railway.'), { status: 503 });
      }
      const record = {
        id: 1, username, passwordHash: hashPassword(password), passwordScheme: 'scrypt-v1',
        role: 'admin', fullName, status: 'active', authVersion: 1,
        createdAt: new Date().toISOString(), lastLogin: null
      };
      await compareAndWrite(pool, { storeName: 'users', recordId: '1', record, force: true });
    }
  }

  const resetVersion = String(process.env.PLATFORM_ADMIN_RESET_VERSION || '').trim();
  if (resetVersion) {
    const username = String(process.env.PLATFORM_ADMIN_USERNAME || '').trim();
    const password = String(process.env.PLATFORM_ADMIN_PASSWORD || '');
    const fullName = String(process.env.PLATFORM_ADMIN_FULLNAME || 'Administrateur plateforme').trim();
    if (!username || password.length < 12 || resetVersion.length > 128) {
      throw Object.assign(new Error('Récupération administrateur invalide. Configurez PLATFORM_ADMIN_USERNAME, PLATFORM_ADMIN_PASSWORD (12 caractères minimum) et une PLATFORM_ADMIN_RESET_VERSION courte.'), { status:503 });
    }
    const currentResult = await pool.query("SELECT data FROM platform_records WHERE store_name='users' AND record_id='1' AND deleted=FALSE LIMIT 1");
    const current = currentResult.rows[0]?.data || {};
    if (String(current.platformAdminResetVersion || '') !== resetVersion) {
      const conflict = await pool.query("SELECT record_id FROM platform_records WHERE store_name='users' AND deleted=FALSE AND record_id<>'1' AND LOWER(data->>'username')=$1 LIMIT 1", [normalizeUsername(username)]);
      if (conflict.rowCount) throw Object.assign(new Error('PLATFORM_ADMIN_USERNAME est déjà utilisé par un autre compte actif.'), { status:409 });
      const record = {
        ...current,
        id:1,
        username,
        fullName,
        role:'admin',
        status:'active',
        passwordHash:hashPassword(password),
        passwordScheme:'scrypt-v1',
        authVersion:Math.max(1, Number(current.authVersion || 0) + 1),
        platformAdminResetVersion:resetVersion,
        platformAdminResetAt:new Date().toISOString()
      };
      delete record.password;
      await compareAndWrite(pool, { storeName: 'users', recordId: '1', record, force: true });
      console.log(`Récupération administrateur appliquée pour ${username} (version ${resetVersion}).`);
    }
  }

  /*
   * MÉNAGE DES COMPTES EN DOUBLE — la désignation reste en SQL, la mutation passe par le
   * magasin.
   *
   * L'instruction faisait tout d'un bloc : elle DÉSIGNAIT les doublons et les faisait
   * disparaître par un `UPDATE … SET deleted=TRUE`. Le compteur ne bougeait pas, si bien
   * qu'un navigateur resté ouvert sur un compte retiré le croyait toujours à jour.
   *
   * Désigner reste l'affaire du SQL — c'est une fenêtre analytique, rien ne la remplace.
   * Faire disparaître devient l'affaire du magasin, qui pose des pierres tombales À
   * RÉVISION, en une seule instruction elle aussi.
   */
  const doublons = await pool.query(`
    WITH ranked AS (
      SELECT record_id,
             ROW_NUMBER() OVER (PARTITION BY LOWER(data->>'username') ORDER BY updated_at DESC, record_id) AS rn
      FROM platform_records
      WHERE store_name='users' AND deleted=FALSE AND COALESCE(data->>'username','')<>''
    )
    SELECT record_id FROM ranked WHERE rn > 1
  `);
  if (doublons.rowCount) {
    await tombstoneManyWithRevision(pool, {
      storeName: 'users', recordIds: doublons.rows.map(ligne => ligne.record_id)
    });
  }

  // L'index est une contrainte de schéma, pas une mutation de donnée : il reste ici.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS platform_users_username_lower_unique
    ON platform_records ((LOWER(data->>'username')))
    WHERE store_name='users' AND deleted=FALSE AND COALESCE(data->>'username','')<>''`);

  /*
   * LA GRILLE CENTRALE REÇOIT SA FICHE CANONIQUE AVANT `ensureModel()` (#166).
   *
   * Placé APRÈS, la salle nouvellement posée attendrait le démarrage SUIVANT pour recevoir
   * sa zone de transition et son rattachement `resource_zones` — le jeu de données resterait
   * donc fermé aux rôles à périmètre pendant tout un cycle. Placé ICI, la migration de
   * `ensureModel()` le voit dans la même passe, et l'autorisation est complète dès le
   * premier démarrage.
   *
   * L'écriture est conditionnelle : elle ne se produit que si AUCUN candidat Grille n'existe
   * déjà. Un démarrage suivant n'écrit rien.
   */
  try {
    const grille = await ensureGrilleCentraleOperationalRecords(access);
    if (grille?.created) console.log(`Grille Centrale — fiche opérationnelle canonique posée (${grille.stores.join(', ')}).`);
  } catch (error) {
    // Un bootstrap de données ne doit pas empêcher la plateforme de démarrer : sans lui, le
    // jeu de données protégé reste simplement fermé, ce qu'il était déjà.
    console.warn('Grille Centrale — fiche opérationnelle canonique non posée:', error?.message || error);
  }

  await access.ensureModel();
  schemaReady = true;
}

async function usernameConflict(client, username, recordId) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await client.query(
    "SELECT record_id FROM platform_records WHERE store_name='users' AND deleted=FALSE AND LOWER(data->>'username')=$1 AND record_id<>$2 LIMIT 1",
    [normalized, String(recordId)]
  );
  return result.rows[0]?.record_id || null;
}

/**
 * Limitation des tentatives d'authentification.
 *
 * `/api/auth/login` n'imposait aucune limite : ni compteur, ni temporisation, ni
 * verrouillage. Deux conséquences — une attaque par force brute à pleine vitesse, et un déni
 * de service non authentifié, chaque tentative déclenchant une dérivation scrypt coûteuse.
 *
 * Le compteur est double : par identifiant (protège un compte visé) et par adresse
 * (protège le serveur d'un balayage). En mémoire volontairement : une seule instance sert la
 * plateforme, et une remise à zéro au redéploiement est sans danger.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_USERNAME = 8;
const LOGIN_MAX_PER_ADDRESS = 30;
const loginAttempts = new Map();

function loginThrottleKey(req, username) {
  const address = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'inconnu';
  return { address, username: normalizeUsername(username) };
}

function loginAttemptState(key, limit, now) {
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) return { count: 0, blocked: false, retryAfter: 0 };
  return {
    count: entry.count,
    blocked: entry.count >= limit,
    retryAfter: Math.max(1, Math.ceil((entry.first + LOGIN_WINDOW_MS - now) / 1000))
  };
}

function recordLoginFailure(key, now) {
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) loginAttempts.set(key, { count: 1, first: now });
  else entry.count += 1;
  // Purge opportuniste : sans elle la table grossit indéfiniment sous balayage.
  if (loginAttempts.size > 5000) {
    for (const [name, value] of loginAttempts) if (now - value.first > LOGIN_WINDOW_MS) loginAttempts.delete(name);
  }
}

function clearLoginFailures(...keys) {
  for (const key of keys) loginAttempts.delete(key);
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req, limit = 30 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

const encode = value => Buffer.from(value).toString('base64url');
const decode = value => Buffer.from(value, 'base64url').toString('utf8');
function signSession(user) {
  const payload = encode(JSON.stringify({
    id: user.id, username: user.username, role: user.role, fullName: user.fullName,
    authVersion: Number(user.authVersion || 1), exp: Date.now() + 12 * 60 * 60 * 1000
  }));
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(decode(payload));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('='); return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
async function currentUser(req) {
  const session = verifySession(cookies(req).tp_session);
  if (!session) return null;
  const result = await pool.query("SELECT data FROM platform_records WHERE store_name='users' AND record_id=$1 AND deleted=FALSE LIMIT 1", [String(session.id)]);
  const record = result.rows[0]?.data;
  if (!record || record.status === 'inactive') return null;
  if (Number(record.authVersion || 1) !== Number(session.authVersion || 0)) return null;
  return safeUserRecord(record);
}
function sessionCookie(req, token, maxAge = 43200) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || production;
  return `tp_session=${encodeURIComponent(token || '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// La règle vit dans `roles.js`, partagée avec le navigateur ET exécutable dans un test.
// Écrite ici, elle ne pouvait être que grepée : `serve.js` ouvre un port et une base, donc
// aucun test ne l'importe. Ce contrôle n'autorise que l'ACCÈS au magasin ; c'est
// `assertUserHierarchy` qui décide ensuite de quel compte précisément, car « sait modifier
// des comptes » et « peut modifier CE compte » sont deux questions.
/*
 * DEUX REFUS, DEUX NOMS.
 *
 * « votre rôle n'a pas le droit de faire cet acte »  → ROLE_ACTION_FORBIDDEN
 * « vous n'avez pas autorité sur ce périmètre »      → ZONE_FORBIDDEN
 *
 * Les confondre envoyait un administrateur chercher dans les habilitations de zone un
 * refus qui venait de la matrice des rôles. Le message reste volontairement sobre : il dit
 * QUE l'acte est refusé à ce rôle, jamais quelle règle interne l'a décidé.
 */
function refusDeRole(res, action) {
  const actes = { create: 'créer', update: 'modifier', delete: 'supprimer' };
  json(res, 403, {
    error: 'ROLE_ACTION_FORBIDDEN',
    message: `Votre rôle ne permet pas de ${actes[action] || 'modifier'} cette ressource.`
  });
}

function canWriteByRole(user, storeName) {
  if (!user) return false;
  return canWriteStoreByRole(user.role, storeName);
}

/**
 * L'acteur a-t-il autorité sur ce compte, et sur le rôle qu'il lui attribue ?
 *
 * Sans ce contrôle, `users.edit` suffisait à tout : un chef pouvait promouvoir un compte
 * manager, et un manager fabriquer un administrateur. La règle « aucun second
 * administrateur ne peut être ajouté » ne tient que si elle est vérifiée ICI, côté
 * serveur — une liste déroulante côté navigateur n'est pas une garde.
 */
function assertUserHierarchy(acteur, cible, roleDemande) {
  // La règle vit dans roles.js, partagée avec le navigateur et exécutable dans un test.
  // Tant qu'elle était écrite ici, aucun test ne pouvait l'exécuter — `scripts/serve.js`
  // ouvre un port et une base. Un test de mutation l'a prouvé : remplacer le `throw` par
  // un `void` laissait toute la suite au vert pendant que la plateforme acceptait un
  // second administrateur.
  return assertRoleAssignment(acteur, cible, roleDemande);
}

async function validateIncomingTopology(record, lookup = id => access.get('docs', id)) {
  if (!record || !String(record.kind || '').startsWith('topology_')) return;
  if (!TOPOLOGY_KIND_SET.has(record.kind)) {
    throw Object.assign(new Error('Type de topologie inconnu.'), { status:400, code:'INVALID_TOPOLOGY_RECORD', details:['Type de topologie inconnu.'] });
  }
  const errors = validateTopologyRecord(record);
  errors.push(...await validateTopologyReferences(record, lookup));
  if (errors.length) {
    throw Object.assign(new Error(errors.join(' ')), { status: 400, code: 'INVALID_TOPOLOGY_RECORD', details: errors });
  }
}

async function ensureTopologyUnique(record) {
  if (record?.kind === TOPOLOGY_KINDS.ROUTER_PORT) {
    const result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND record_id<>$1 AND data->>'kind'=$2 AND data->>'routerId'=$3 AND data->>'direction'=$4 AND data->>'portNumber'=$5 LIMIT 1", [String(record.id), TOPOLOGY_KINDS.ROUTER_PORT, String(record.routerId), String(record.direction), String(record.portNumber)]);
    if (result.rowCount) throw Object.assign(new Error(`Le port ${record.direction} ${record.portNumber} existe déjà sur cette grille.`), { status:409, code:'TOPOLOGY_PORT_EXISTS' });
  }
  if (record?.kind === TOPOLOGY_KINDS.ROUTER) {
    const result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND record_id<>$1 AND data->>'kind'=$2 AND LOWER(data->>'routerKey')=LOWER($3) LIMIT 1", [String(record.id), TOPOLOGY_KINDS.ROUTER, String(record.routerKey || record.id)]);
    if (result.rowCount) throw Object.assign(new Error('Cette clé stable de grille existe déjà.'), { status:409, code:'TOPOLOGY_ROUTER_KEY_EXISTS' });
  }
}

async function ensureTopologyDeletable(record) {
  if (!record || !TOPOLOGY_KIND_SET.has(record.kind)) return;
  let result = { rowCount: 0 };
  if (record.kind === TOPOLOGY_KINDS.ROUTER) {
    result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND data->>'routerId'=$1 LIMIT 1", [String(record.id)]);
  } else if (record.kind === TOPOLOGY_KINDS.ROUTER_PORT) {
    result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND data->>'kind'=$1 AND (data->>'inputPortId'=$2 OR data->>'outputPortId'=$2) LIMIT 1", [TOPOLOGY_KINDS.CROSSPOINT, String(record.id)]);
  }
  if (result.rowCount) throw Object.assign(new Error('Cette donnée de topologie est encore référencée.'), { status: 409, code: 'TOPOLOGY_DEPENDENCY' });
}

async function ensureDocumentDeletable(record) {
  if (!record) return;
  await ensureTopologyDeletable(record);
  if (record.kind === CONTINUITY_KINDS.TEST) throw Object.assign(new Error("Un test de continuité est une preuve d'audit immuable et ne peut pas être supprimé."), { status:409, code:'CONTINUITY_TEST_IMMUTABLE' });
  if ((CONTINUITY_KIND_SET.has(record.kind) || record.kind === DIAGRAM_RECORD_KIND) && ['validated','retired'].includes(record.status)) {
    throw Object.assign(new Error('Cette donnée validée ou retirée appartient à l’historique immuable et ne peut pas être supprimée.'), { status:409, code:'VALIDATED_DOCUMENT_IMMUTABLE' });
  }
  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) {
    const result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND data->>'protectionGroupId'=$1 LIMIT 1", [String(record.id)]);
    if (result.rowCount) throw Object.assign(new Error('Ce groupe de protection possède encore une procédure ou un test.'), { status:409, code:'CONTINUITY_DEPENDENCY' });
  }
  if (record.kind === CONTINUITY_KINDS.PROCEDURE) {
    const result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND data->>'procedureId'=$1 LIMIT 1", [String(record.id)]);
    if (result.rowCount) throw Object.assign(new Error('Cette procédure possède encore des tests enregistrés.'), { status:409, code:'CONTINUITY_DEPENDENCY' });
  }
}

function documentEntityReferences(record = {}) {
  const references = [];
  if (record.kind === DIAGRAM_RECORD_KIND) references.push(...(record.nodes || []).map(node => node.entityRef).filter(Boolean));
  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) {
    for (const path of [record.primaryPath, ...(record.backupPaths || [])]) references.push(...(path?.entityRefs || []), ...(path?.dependencyRefs || []));
    references.push(record.switchoverPoint, ...(record.commonDependencyRefs || []));
  }
  if (record.kind === CONTINUITY_KINDS.PROCEDURE) for (const step of record.steps || []) references.push(...(step.entityRefs || []));
  return references.filter(Boolean);
}

function referenceMatchesResource(reference, storeName, id) {
  const typeByStore = { equipments:'equipment', screens:'screen', walls:'wall', rooms:'room', baies:'baie', cables:'cable' };
  if (reference.type === typeByStore[storeName] && String(reference.id) === String(id)) return true;
  if (storeName === 'equipments' && ['component', 'port'].includes(reference.type) && String(reference.parentEquipmentId || reference.id) === String(id)) return true;
  return false;
}

async function dependencyDocumentLabel(user, document) {
  if (seesEverything(user?.role) || await access.canAccessRecord(user, 'docs', document, 'read')) {
    return `${document.kind || 'document'} ${document.title || document.name || document.id}`;
  }
  return 'document technique protégé';
}

async function ensureResourceDeletable(storeName, record, user) {
  if (!record || !['equipments','screens','walls','rooms','baies','cables'].includes(storeName)) return;
  const id = record.id;
  const dependencies = [];
  const [documents, cables, equipments, screens, baies, walls, tickets] = await Promise.all([
    access.list('docs'), access.list('cables'), access.list('equipments'), access.list('screens'),
    access.list('baies'), access.list('walls'), access.list('tickets')
  ]);

  // Les tickets n'étaient consultés par AUCUNE garde de suppression côté serveur. Un
  // équipement décommissionné laissait donc ses tickets pointer dans le vide : la fiche
  // continuait d'afficher l'ancien nom, les compteurs comptaient une ressource inexistante,
  // et la page Intégrité ne le signalait même pas. Un ticket ne peut pas non plus être
  // supprimé (l'historique des demandes est immuable), donc la seule issue correcte est de
  // bloquer tant qu'une demande ouverte le référence.
  const singularType = { equipments:'equipment', screens:'screen', rooms:'room', baies:'baie', walls:'wall', cables:'cable' }[storeName];
  const closedStates = new Set(['fermé','ferme','closed','résolu','resolu','resolved','annulé','annule']);
  const openTicketsOnResource = tickets.filter(ticket => {
    const relatedType = String(ticket.relatedType || ticket.targetType || ticket.type || '').toLowerCase();
    const relatedId = ticket.relatedId ?? ticket.targetId ?? ticket.entityId ?? ticket.idElement;
    if (relatedType !== singularType || String(relatedId ?? '') !== String(id)) return false;
    return !closedStates.has(String(ticket.status || '').trim().toLowerCase());
  });
  if (openTicketsOnResource.length) {
    dependencies.push(`${openTicketsOnResource.length} demande(s) ouverte(s) sur cette ressource`);
  }
  if (storeName === 'rooms') {
    if (baies.some(item => String(item.roomId) === String(id))) dependencies.push('baie dans cette salle');
    if (equipments.some(item => String(item.roomId) === String(id))) dependencies.push('équipement dans cette salle');
    if (screens.some(item => String(item.roomId) === String(id))) dependencies.push('écran dans cette salle');
    if (walls.some(item => String(item.roomId) === String(id))) dependencies.push("mur d'images dans cette salle");
  }
  if (storeName === 'baies' && equipments.some(item => String(item.baieId) === String(id))) dependencies.push('équipement dans cette baie');
  if (storeName === 'walls' && screens.some(item => String(item.wallId) === String(id))) dependencies.push('écran rattaché à ce mur');
  if (['equipments','screens'].includes(storeName)) {
    const endpointType = storeName === 'equipments' ? 'equipment' : 'screen';
    if (cables.some(cable => ['source','destination'].some(side => {
      if (cable[`${side}Type`] === endpointType && String(cable[`${side}Id`]) === String(id)) return true;
      return storeName === 'equipments' && cable[`${side}Type`] === 'component' && String(cable[`${side}ParentEquipmentId`]) === String(id);
    }))) dependencies.push('câble raccordé à cette ressource');
  }
  for (const document of documents) {
    const referenced = documentEntityReferences(document).some(reference => referenceMatchesResource(reference, storeName, id))
      || (storeName === 'cables' && ((document.edges || []).some(edge => String(edge.cableId) === String(id)) || (document.cableRefs || []).map(String).includes(String(id))))
      || (storeName === 'equipments' && ['sourceEquipmentId','destinationEquipmentId','routerEquipmentId'].some(field => String(document[field] ?? '') === String(id)))
      || (storeName === 'screens' && ['sourceScreenId','destinationScreenId','screenId'].some(field => String(document[field] ?? '') === String(id)));
    if (referenced) dependencies.push(await dependencyDocumentLabel(user, document));
  }
  if (dependencies.length) throw Object.assign(new Error(`Suppression impossible: ${[...new Set(dependencies)].slice(0, 8).join(', ')}. Réaffectez ou révisez ces dépendances d'abord.`), { status:409, code:'RESOURCE_HAS_TECHNICAL_DEPENDENCIES' });
}

async function ensureEquipmentConnectivityRetention(existing, incoming, user) {
  if (!existing) return;
  const rootPorts = new Set(normalizePorts(incoming.ports).map(port => String(port.id)));
  const components = new Map((incoming.components || []).map(component => [String(component.id), new Set(normalizePorts(component.ports).map(port => String(port.id)))]));
  const problems = [];
  for (const cable of await access.list('cables')) for (const side of ['source','destination']) {
    if (!isCableActive(cable)) continue;
    const type = cable[`${side}Type`]; const endpointId = cable[`${side}Id`]; const parentId = cable[`${side}ParentEquipmentId`]; const portId = String(cable[`${side}PortId`] ?? '');
    if (type === 'equipment' && String(endpointId) === String(existing.id) && !rootPorts.has(portId)) problems.push(`port ${portId} utilisé par le câble ${cable.reference || cable.id}`);
    if (type === 'component' && String(parentId) === String(existing.id) && (!components.has(String(endpointId)) || !components.get(String(endpointId)).has(portId))) problems.push(`composant/port ${endpointId}/${portId} utilisé par le câble ${cable.reference || cable.id}`);
  }
  for (const document of await access.list('docs')) {
    const documentLabel = await dependencyDocumentLabel(user, document);
    for (const reference of documentEntityReferences(document)) {
      if (reference.type === 'component' && String(reference.parentEquipmentId) === String(existing.id) && !components.has(String(reference.id))) problems.push(`composant ${reference.id} référencé par ${documentLabel}`);
      if (reference.type === 'port' && String(reference.parentEquipmentId || reference.id) === String(existing.id)) {
        const retained = reference.parentEquipmentId ? components.get(String(reference.id))?.has(String(reference.portId)) : rootPorts.has(String(reference.portId));
        if (!retained) problems.push(`port ${reference.portId} référencé par ${documentLabel}`);
      }
    }
    if (document.kind === DIAGRAM_RECORD_KIND) {
      const nodes = new Map((document.nodes || []).map(node => [String(node.id), node]));
      for (const edge of document.edges || []) for (const side of ['source','destination']) {
        const node = nodes.get(String(edge[`${side}NodeId`])); const reference = node?.entityRef; const portId = edge[`${side}PortId`];
        if (!portId || !['equipment','component'].includes(reference?.type)) continue;
        if (reference.type === 'equipment' && String(reference.id) === String(existing.id) && !rootPorts.has(String(portId))) {
          problems.push(`port ${portId} dessiné dans ${documentLabel}`);
        }
        if (reference.type === 'component' && String(reference.parentEquipmentId) === String(existing.id) && !components.get(String(reference.id))?.has(String(portId))) {
          problems.push(`port ${reference.id}/${portId} dessiné dans ${documentLabel}`);
        }
      }
    }
  }
  if (problems.length) throw connectivityError('EQUIPMENT_CONNECTIVITY_IN_USE', [...new Set(problems)], 409);
}

function connectivityError(code, errors, status = 400) {
  return Object.assign(new Error(errors.join(' ')), { status, code, details:errors });
}

function normalizeIncomingEquipment(record) {
  const knowledge = validateEquipmentKnowledge(record);
  if (knowledge.errors.length) throw connectivityError('INVALID_EQUIPMENT_KNOWLEDGE', knowledge.errors);
  const connectivity = validateEquipmentConnectivity(knowledge.value);
  if (connectivity.errors.length) throw connectivityError('INVALID_EQUIPMENT_CONNECTIVITY', connectivity.errors);
  return connectivity.value;
}

/**
 * Vérifie que la salle et la baie référencées existent réellement.
 *
 * Asymétrie corrigée : un câble vers un équipement inexistant était refusé, et un nœud de
 * schéma vers une entité inexistante aussi — mais un équipement pouvait être enregistré
 * dans une salle et une baie qui n'existent pas. Il disparaissait alors de sa salle, de la
 * carte et du parcours visiteur, et la page Intégrité se contentait de le signaler après
 * coup, sans jamais l'empêcher ni offrir de correction.
 *
 * La cohérence salle/baie est vérifiée au passage : rattacher un équipement à une baie
 * située dans une autre salle est une incohérence, pas une préférence.
 */
async function assertEquipmentLocationExists(record, lookup = (store, id) => access.get(store, id)) {
  const errors = [];
  const roomId = record?.roomId;
  const baieId = record?.baieId;

  let baie = null;
  if (baieId !== null && baieId !== undefined && baieId !== '') {
    baie = await lookup('baies', baieId);
    if (!baie) errors.push(`La baie référencée est introuvable (${baieId}).`);
  }
  if (roomId !== null && roomId !== undefined && roomId !== '') {
    const room = await lookup('rooms', roomId);
    if (!room) errors.push(`La salle référencée est introuvable (${roomId}).`);
    else if (baie && baie.roomId != null && String(baie.roomId) !== String(roomId)) {
      errors.push("La baie sélectionnée n'appartient pas à la salle indiquée.");
    }
  }
  if (errors.length) throw connectivityError('INVALID_EQUIPMENT_LOCATION', errors);
}

/*
 * UN GROUPE D'ÉCRANS NE PEUT PAS ÉLARGIR SA PORTÉE PAR SES `screenIds` — #119.
 *
 * La lecture ferme désormais les groupes incohérents déjà persistés. Cette garde-ci
 * empêche d'en écrire de nouveaux : sans elle, on se contenterait de rendre invisible une
 * donnée qu'on laisserait continuer à naître.
 *
 * L'invariant vaut AUSSI pour l'administrateur et le manager. Leur privilège global les
 * autorise à écrire partout ; il ne les autorise pas à écrire une structure contradictoire,
 * dont personne d'autre ne pourra ensuite rien lire. C'est pourquoi cet appel est placé
 * avec les autres normalisations d'entrée, avant le court-circuit `isPlatformAdmin`.
 *
 * Aucun second résolveur de zones : chaque écran repasse par `access.resolveResourceZones`,
 * le contrat qui sait déjà remonter au mur puis à la salle.
 *
 * `screenIds` vide est une forme légitime — `deleteScreenSafely` retire un écran d'un
 * groupe et peut le laisser vide, et le décor de #110 en écrit. Elle n'est donc pas
 * refusée. Un `roomId` absent ne l'est pas non plus : la contradiction ne se juge alors
 * qu'entre les écrans entre eux.
 */
async function assertScreenGroupScope(record, existing = null) {
  const errors = [];

  /*
   * UNE REVENDICATION DE ZONE PORTÉE PAR LE GROUPE N'EST PAS UNE AUTORITÉ.
   *
   * Mesuré sur `be5f549` : un technicien porteur d'un `screen.edit` LÉGITIME sur la zone A
   * écrivait `{ zoneId: A, screenIds: [écran B] }`, obtenait 200, et relisait l'identifiant
   * de l'écran de la zone B. La lecture ne s'y fie plus ; on empêche ici d'en fabriquer
   * davantage, plutôt que de réécrire en silence une revendication contradictoire.
   *
   * Le report À L'IDENTIQUE reste permis, et c'est délibéré : `deleteScreenSafely`
   * (db.js) réenregistre un groupe par `{...g, screenIds: filtrés}` et reporterait donc un
   * `zoneId` hérité. Refuser cela empêcherait de supprimer un écran d'un groupe ancien.
   * Une valeur reportée telle quelle n'accorde rien : elle est devenue inerte.
   */
  for (const champ of ['zoneId', 'zoneIds']) {
    if (record?.[champ] === undefined) continue;
    const propose = JSON.stringify(record[champ] ?? null);
    const connu = JSON.stringify(existing?.[champ] ?? null);
    const vide = record[champ] === null || record[champ] === ''
      || (Array.isArray(record[champ]) && !record[champ].length);
    if (vide || propose === connu) continue;
    errors.push(`Un groupe d'écrans ne déclare pas sa zone : « ${champ} » n'est pas une source d'autorisation pour ce type. Sa portée vient de sa salle et de ses écrans.`);
  }

  const screenIds = [...new Set((Array.isArray(record?.screenIds) ? record.screenIds : [])
    .filter(value => value !== null && value !== undefined && value !== '').map(String))];

  /*
   * UNE SALLE DÉCLARÉE MAIS IRRÉSOLVABLE N'EST PAS UNE SALLE ABSENTE.
   *
   * Sans cette distinction, `roomId` pointant vers une salle inexistante ou sans
   * rattachement était traité comme « pas de salle » : la portée se décidait alors sur les
   * seuls écrans, et une salle fantôme passait sans bruit.
   */
  const roomId = record?.roomId;
  const zonesSalle = new Set();
  if (roomId !== undefined && roomId !== null && roomId !== '') {
    const salle = await access.get('rooms', roomId);
    if (!salle) {
      errors.push(`La salle « ${roomId} » déclarée par ce groupe est introuvable.`);
    } else {
      const zones = (await access.zonesForRoom(roomId)).map(String);
      if (!zones.length) errors.push(`La salle « ${roomId} » n'est rattachée à aucune zone : la portée du groupe ne peut pas être établie.`);
      for (const zone of zones) zonesSalle.add(zone);
    }
  }

  if (!screenIds.length) {
    if (errors.length) throw connectivityError('INVALID_SCREEN_GROUP_SCOPE', errors);
    return record;
  }

  const zonesParEcran = new Map();
  for (const screenId of screenIds) {
    const screen = await access.get('screens', screenId);
    if (!screen) {
      errors.push(`L'écran « ${screenId} » référencé par ce groupe est introuvable.`);
      continue;
    }
    const zones = (await access.resolveResourceZones('screens', screen)).map(String);
    if (!zones.length) {
      errors.push(`L'écran « ${screenId} » n'est rattaché à aucune zone : la portée du groupe ne peut pas être établie.`);
      continue;
    }
    zonesParEcran.set(screenId, zones);
  }

  if (zonesSalle.size) {
    for (const [screenId, zones] of zonesParEcran) {
      const dehors = zones.filter(zone => !zonesSalle.has(zone));
      if (dehors.length) {
        errors.push(`L'écran « ${screenId} » relève de la zone « ${dehors.join(', ')} », hors de la portée de la salle de ce groupe.`);
      }
    }
  } else {
    // Sans salle, la contradiction se juge entre les écrans : deux zones distinctes dans
    // un même groupe, et plus personne de scopé ne peut le lire.
    const toutes = new Set([...zonesParEcran.values()].flat());
    if (toutes.size > 1) {
      errors.push(`Les écrans de ce groupe relèvent de zones différentes (${[...toutes].join(', ')}) : un groupe ne peut pas s'étendre sur plusieurs zones.`);
    }
  }

  if (errors.length) throw connectivityError('INVALID_SCREEN_GROUP_SCOPE', errors);
  return record;
}

function normalizeIncomingScreen(record) {
  const connectivity = validateScreenConnectivity(record);
  if (connectivity.errors.length) throw connectivityError('INVALID_SCREEN_CONNECTIVITY', connectivity.errors);
  return connectivity.value;
}

async function resolveCableEndpoint(record, side, lookup = (store, id) => access.get(store, id)) {
  const type = record[`${side}Type`];
  const id = record[`${side}Id`];
  const portId = record[`${side}PortId`];
  if (type === 'screen') {
    const entity = await lookup('screens', id);
    const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
    return { type, id, entity, port, identity:`screen:${id}:${portId}` };
  }
  if (type === 'component') {
    const parentId = record[`${side}ParentEquipmentId`];
    const parent = await lookup('equipments', parentId);
    const entity = (parent?.components || []).find(item => String(item.id) === String(id));
    const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
    return { type, id, parentId, parent, entity, port, identity:`component:${parentId}:${id}:${portId}` };
  }
  const entity = await lookup('equipments', id);
  const port = normalizePorts(entity?.ports).find(item => String(item.id) === String(portId));
  return { type:'equipment', id, entity, port, identity:`equipment:${id}:${portId}` };
}

function stripClientCableIntegrity(record = {}) {
  const {
    integrityState:ignoredState,
    integrityErrorCode:ignoredCode,
    integrityIssues:ignoredIssues,
    originalStatus:ignoredOriginalStatus,
    // `routeAccess` est une RÉPONSE, pas une donnée : le serveur la calcule à chaque envoi
    // et le client la renvoie sans y penser. Persistée, elle figerait le verdict d'UN
    // lecteur dans un enregistrement lu par tous — et un client pourrait se l'accorder.
    routeAccess:ignoredRouteAccess,
    ...safe
  } = record;
  return safe;
}

async function normalizeIncomingCable(record, recordId, {
  lookup = (store, id) => access.get(store, id),
  listCables = () => access.list('cables'),
  occupiedPorts = null
} = {}) {
  const clientRecord = stripClientCableIntegrity(record);
  const shape = validateCableShape({ ...clientRecord, id:clientRecord.id ?? recordId });
  if (shape.errors.length) throw connectivityError('INVALID_CABLE', shape.errors);
  const value = normalizeCableRecord(shape.value);
  const [source, destination] = await Promise.all([
    resolveCableEndpoint(value, 'source', lookup), resolveCableEndpoint(value, 'destination', lookup)
  ]);
  const errors = [];
  if (!source.entity) errors.push('La source du câble est introuvable.');
  if (value.sourceType === 'component' && !source.parent) errors.push("L'équipement parent du composant source est introuvable.");
  if (!source.port) errors.push('Le port source est introuvable sur cette instance ou ce composant.');
  if (!destination.entity) errors.push('La destination du câble est introuvable.');
  if (value.destinationType === 'component' && !destination.parent) errors.push("L'équipement parent du composant destination est introuvable.");
  if (!destination.port) errors.push('Le port destination est introuvable sur cette instance ou ce composant.');
  if (errors.length) throw connectivityError('INVALID_CABLE_REFERENCE', errors);
  const signalModeErrors = validateSignalModeForPorts(value, source.port, destination.port);
  if (signalModeErrors.length) throw connectivityError('INVALID_SIGNAL_MODE_FOR_PORTS', signalModeErrors);

  const compatibility = evaluateConnection({ sourcePort:source.port, destinationPort:destination.port, cable:value });
  if (['incompatible', 'requires-converter', 'requires-adapter'].includes(compatibility.status)) {
    throw connectivityError('INCOMPATIBLE_CABLE', [...compatibility.reasons, ...compatibility.suggestions]);
  }

  if (isCableActive(value)) {
    const occupied = [];
    if (occupiedPorts) {
      if (occupiedPorts.has(source.identity)) occupied.push(`Le port source est déjà utilisé par ${occupiedPorts.get(source.identity)}.`);
      if (occupiedPorts.has(destination.identity)) occupied.push(`Le port destination est déjà utilisé par ${occupiedPorts.get(destination.identity)}.`);
    } else {
      const existingCables = await listCables();
      for (const current of existingCables) {
        if (String(current.id) === String(recordId) || !isCableActive(current)) continue;
        const normalized = normalizeCableRecord(current);
        const currentSource = await resolveCableEndpoint(normalized, 'source', lookup);
        const currentDestination = await resolveCableEndpoint(normalized, 'destination', lookup);
        if ([currentSource.identity, currentDestination.identity].includes(source.identity)) occupied.push(`Le port source est déjà utilisé par ${normalized.reference || normalized.id}.`);
        if ([currentSource.identity, currentDestination.identity].includes(destination.identity)) occupied.push(`Le port destination est déjà utilisé par ${normalized.reference || normalized.id}.`);
      }
    }
    if (occupied.length) throw connectivityError('PORT_ALREADY_CONNECTED', [...new Set(occupied)], 409);
    if (occupiedPorts) {
      const label = value.reference || value.id;
      occupiedPorts.set(source.identity, label);
      occupiedPorts.set(destination.identity, label);
    }
  }

  const normalized = { ...value, compatibility, connectivityVersion:1 };
  if (compatibility.status === 'to-confirm') {
    normalized.status = 'À vérifier';
    normalized.verificationStatus = 'to-confirm';
  }
  return normalized;
}

function quarantineLegacyCable(record, error) {
  const normalized = normalizeCableRecord(record);
  return {
    ...normalized,
    originalStatus:normalized.status,
    status:'À vérifier',
    verificationStatus:'to-confirm',
    integrityState:'quarantined',
    integrityErrorCode:error?.code || 'INVALID_LEGACY_CABLE',
    integrityIssues:(error?.details?.length ? error.details : [error?.message || 'Câble legacy à vérifier']).slice(0, 20),
    connectivityVersion:1
  };
}

async function resolveTechnicalEntityReference(reference, lookupResource, lookupDocument) {
  if (!reference?.type || reference.id == null) return null;
  const id = reference.id;
  const storeByType = { equipment:'equipments', screen:'screens', wall:'walls', room:'rooms', baie:'baies', cable:'cables' };
  if (storeByType[reference.type]) return lookupResource(storeByType[reference.type], id);
  if (reference.type === 'component') {
    const parent = await lookupResource('equipments', reference.parentEquipmentId);
    return (parent?.components || []).find(component => String(component.id) === String(id)) || null;
  }
  if (reference.type === 'port') {
    const owner = reference.parentEquipmentId
      ? (await lookupResource('equipments', reference.parentEquipmentId))?.components?.find(component => String(component.id) === String(id))
      : await lookupResource('equipments', id);
    return normalizePorts(owner?.ports).find(port => String(port.id) === String(reference.portId)) || null;
  }
  if (reference.type === 'service') {
    const service = await lookupDocument(id);
    return service?.kind === CONTINUITY_KINDS.PROTECTION_GROUP ? service : null;
  }
  if (diagramTopologyKinds[reference.type]) {
    const document = await lookupDocument(id);
    return document?.kind === diagramTopologyKinds[reference.type] ? document : null;
  }
  return null;
}

async function validateContinuityReferences(
  record,
  lookup = id => access.get('docs', id),
  lookupResource = (store, id) => access.get(store, id)
) {
  const errors = [];
  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) {
    const paths = [record.primaryPath, ...(record.backupPaths || [])];
    for (const path of paths) {
      if (path?.signalPathId) {
        const signalPath = await lookup(path.signalPathId);
        if (!signalPath || signalPath.kind !== TOPOLOGY_KINDS.SIGNAL_PATH) errors.push(`Le Signal Path « ${path.signalPathId} » est introuvable.`);
      }
      for (const reference of [...(path?.entityRefs || []), ...(path?.dependencyRefs || [])]) {
        if (!await resolveTechnicalEntityReference(reference, lookupResource, lookup)) errors.push(`Le chemin « ${path?.label || path?.id} » référence une entité technique introuvable.`);
      }
    }
    for (const reference of [record.switchoverPoint, ...(record.commonDependencyRefs || [])].filter(Boolean)) {
      if (!await resolveTechnicalEntityReference(reference, lookupResource, lookup)) errors.push('Le groupe de protection référence un point de bascule ou une dépendance introuvable.');
    }
  }
  if ([CONTINUITY_KINDS.PROCEDURE, CONTINUITY_KINDS.TEST].includes(record.kind)) {
    const group = await lookup(record.protectionGroupId);
    if (!group || group.kind !== CONTINUITY_KINDS.PROTECTION_GROUP) errors.push('Le groupe de protection référencé est introuvable.');
  }
  if (record.kind === CONTINUITY_KINDS.PROCEDURE) {
    for (const step of record.steps || []) for (const reference of step.entityRefs || []) {
      if (!await resolveTechnicalEntityReference(reference, lookupResource, lookup)) errors.push(`L'étape ${step.order || step.id} référence une entité technique introuvable.`);
    }
  }
  if (record.kind === CONTINUITY_KINDS.TEST) {
    const procedure = await lookup(record.procedureId);
    if (!procedure || procedure.kind !== CONTINUITY_KINDS.PROCEDURE) errors.push('La procédure testée est introuvable.');
  }
  return errors;
}

const diagramTopologyKinds = Object.freeze({
  'signal-path':TOPOLOGY_KINDS.SIGNAL_PATH,
  router:TOPOLOGY_KINDS.ROUTER,
  'router-port':TOPOLOGY_KINDS.ROUTER_PORT,
  'router-interface':TOPOLOGY_KINDS.ROUTER_INTERFACE,
  'patch-point':TOPOLOGY_KINDS.PATCH_POINT
});

function diagramNodeEndpoint(node, portId) {
  const reference = node?.entityRef;
  if (!reference) return null;
  if (reference.type === 'equipment' || reference.type === 'screen') {
    return { type:reference.type, id:String(reference.id), parentEquipmentId:'', portId:String(portId || reference.portId || '') };
  }
  if (reference.type === 'component') {
    return { type:'component', id:String(reference.id), parentEquipmentId:String(reference.parentEquipmentId || ''), portId:String(portId || reference.portId || '') };
  }
  return null;
}

function cableEndpoint(cable, side) {
  return {
    type:String(cable?.[`${side}Type`] || 'equipment'),
    id:String(cable?.[`${side}Id`] ?? ''),
    parentEquipmentId:String(cable?.[`${side}ParentEquipmentId`] ?? ''),
    portId:String(cable?.[`${side}PortId`] ?? '')
  };
}

function endpointsEqual(left, right) {
  return Boolean(left && right)
    && left.type === right.type
    && left.id === right.id
    && left.parentEquipmentId === right.parentEquipmentId
    && left.portId === right.portId;
}

async function validateDiagramReferences(record, lookupResource, lookupDocument) {
  const errors = [];
  const nodeById = new Map((record.nodes || []).map(node => [String(node.id), node]));
  for (const node of record.nodes || []) {
    if (!['entity', 'port-anchor'].includes(node.type)) continue;
    if (!await resolveTechnicalEntityReference(node.entityRef, lookupResource, lookupDocument)) {
      errors.push(`Le nœud « ${node.label || node.id} » référence une entité technique introuvable.`);
    }
  }
  for (const edge of record.edges || []) {
    if (edge.relationId) {
      const relation = await lookupDocument(edge.relationId);
      if (!relation) errors.push(`La relation ${edge.id} référence une relation métier introuvable.`);
      else if (!DIAGRAM_RELATION_KINDS.includes(relation.kind)) errors.push(`La relation ${edge.id} doit référencer un Signal Path, Crosspoint, RV Link ou groupe Principal/Secours.`);
    }
    if (!edge.cableId) continue;
    const cable = await lookupResource('cables', edge.cableId);
    if (!cable) {
      errors.push(`La liaison ${edge.id} référence un câble introuvable.`);
      continue;
    }
    if (edge.type !== 'physical-cable') errors.push(`La liaison ${edge.id} référence un câble physique mais son type graphique n'est pas physical-cable.`);
    const drawnSource = diagramNodeEndpoint(nodeById.get(String(edge.sourceNodeId)), edge.sourcePortId);
    const drawnDestination = diagramNodeEndpoint(nodeById.get(String(edge.destinationNodeId)), edge.destinationPortId);
    const actualSource = cableEndpoint(cable, 'source');
    const actualDestination = cableEndpoint(cable, 'destination');
    const direct = endpointsEqual(drawnSource, actualSource) && endpointsEqual(drawnDestination, actualDestination);
    const reverse = cableAllowsReverse(cable) && endpointsEqual(drawnSource, actualDestination) && endpointsEqual(drawnDestination, actualSource);
    if (!direct && !reverse) errors.push(`Le câble ${cable.reference || cable.id} ne relie pas les deux entités/ports indiqués par la liaison ${edge.id}.`);
  }
  return errors;
}

async function technicalReferenceTarget(reference, lookupResource, lookupDocument) {
  if (!reference?.type || reference.id == null) return null;
  const storeByType = { equipment:'equipments', screen:'screens', wall:'walls', room:'rooms', baie:'baies', cable:'cables' };
  if (storeByType[reference.type]) {
    const storeName = storeByType[reference.type];
    return { storeName, record:await lookupResource(storeName, reference.id) };
  }
  if (['component','port'].includes(reference.type)) {
    const equipmentId = reference.parentEquipmentId || reference.id;
    return { storeName:'equipments', record:await lookupResource('equipments', equipmentId) };
  }
  if (reference.type === 'service' || diagramTopologyKinds[reference.type]) return { storeName:'docs', record:await lookupDocument(reference.id) };
  return null;
}

async function assertDocumentReferencesVisible(user, record) {
  if (seesEverything(user?.role)) return;
  const targets = [];
  const lookupResource = (storeName, id) => access.get(storeName, id);
  const lookupDocument = id => access.get('docs', id);
  for (const reference of documentEntityReferences(record)) {
    targets.push(await technicalReferenceTarget(reference, lookupResource, lookupDocument));
  }
  if (record.kind === DIAGRAM_RECORD_KIND) for (const edge of record.edges || []) {
    if (edge.cableId) targets.push({ storeName:'cables', record:await lookupResource('cables', edge.cableId) });
    if (edge.relationId) targets.push({ storeName:'docs', record:await lookupDocument(edge.relationId) });
  }
  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) for (const path of [record.primaryPath, ...(record.backupPaths || [])]) {
    if (path?.signalPathId) targets.push({ storeName:'docs', record:await lookupDocument(path.signalPathId) });
  }
  if ([CONTINUITY_KINDS.PROCEDURE, CONTINUITY_KINDS.TEST].includes(record.kind)) {
    targets.push({ storeName:'docs', record:await lookupDocument(record.protectionGroupId) });
  }
  if (record.kind === CONTINUITY_KINDS.TEST) targets.push({ storeName:'docs', record:await lookupDocument(record.procedureId) });
  if (record.supersedesId) targets.push({ storeName:'docs', record:await lookupDocument(record.supersedesId) });

  for (const target of targets) {
    if (!target?.record || !await access.canAccessRecord(user, target.storeName, target.record, 'read')) {
      throw Object.assign(new Error("Une ou plusieurs références techniques ne sont pas disponibles dans votre périmètre."), {
        status:404, code:'DOCUMENT_REFERENCE_UNAVAILABLE'
      });
    }
  }
}

async function targetZones(storeName, record, lookupResource, depth = 0) {
  if (!record || depth > 5) return [];
  // La zone d'une SALLE se lit dans `resource_zones` et nulle part ailleurs — c'est la même
  // règle que dans `access-control.js`, et la répéter ici évite qu'un enregistrement hérité
  // non encore migré fasse dire à cette couverture documentaire autre chose que l'autorisation.
  if (storeName === 'rooms') return access.resolveResourceZones('rooms', record).catch(() => []);
  const direct = [...new Set([...(Array.isArray(record.zoneIds) ? record.zoneIds : []), record.zoneId].filter(value => value !== null && value !== undefined && value !== '').map(String))];
  if (direct.length) return direct;
  if (record.roomId != null) {
    const room = await lookupResource('rooms', record.roomId);
    const zones = await targetZones('rooms', room, lookupResource, depth + 1);
    if (zones.length) return zones;
  }
  if (storeName === 'equipments' && record.baieId != null) {
    const baie = await lookupResource('baies', record.baieId);
    const zones = await targetZones('baies', baie, lookupResource, depth + 1);
    if (zones.length) return zones;
  }
  if (storeName === 'screens' && record.wallId != null) {
    const wall = await lookupResource('walls', record.wallId);
    const zones = await targetZones('walls', wall, lookupResource, depth + 1);
    if (zones.length) return zones;
  }
  if (storeName === 'cables') {
    const zones = [];
    for (const side of ['source','destination']) {
      const endpointType = record[`${side}Type`];
      const endpointStore = endpointType === 'screen' ? 'screens' : 'equipments';
      const endpointId = endpointType === 'component' ? record[`${side}ParentEquipmentId`] : record[`${side}Id`];
      if (endpointId == null) continue;
      zones.push(...await targetZones(endpointStore, await lookupResource(endpointStore, endpointId), lookupResource, depth + 1));
    }
    if (zones.length) return [...new Set(zones)];
  }
  return access.resolveResourceZones(storeName, record).catch(() => []);
}

async function validateDocumentZoneCoverage(record, lookupResource, lookupDocument) {
  const declared = new Set((record.zoneIds || []).map(String));
  const targets = [];
  for (const reference of documentEntityReferences(record)) {
    const target = await technicalReferenceTarget(reference, lookupResource, lookupDocument);
    if (target?.record) targets.push(target);
  }
  if (record.kind === DIAGRAM_RECORD_KIND) for (const edge of record.edges || []) {
    if (edge.cableId) targets.push({ storeName:'cables', record:await lookupResource('cables', edge.cableId) });
    if (edge.relationId) targets.push({ storeName:'docs', record:await lookupDocument(edge.relationId) });
  }
  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) for (const path of [record.primaryPath, ...(record.backupPaths || [])]) {
    if (path?.signalPathId) targets.push({ storeName:'docs', record:await lookupDocument(path.signalPathId) });
  }
  if ([CONTINUITY_KINDS.PROCEDURE, CONTINUITY_KINDS.TEST].includes(record.kind)) targets.push({ storeName:'docs', record:await lookupDocument(record.protectionGroupId) });
  if (record.kind === CONTINUITY_KINDS.TEST) targets.push({ storeName:'docs', record:await lookupDocument(record.procedureId) });

  const missing = new Set();
  for (const target of targets.filter(item => item.record)) {
    for (const zoneId of await targetZones(target.storeName, target.record, lookupResource)) if (!declared.has(String(zoneId))) missing.add(String(zoneId));
  }
  return missing.size ? [`Le document doit couvrir toutes les zones de ses références techniques: ${[...missing].join(', ')}.`] : [];
}

async function validateRevisionLink(record, existing, lookupDocument) {
  if (!record?.supersedesId) return [];
  const errors = [];
  const predecessor = await lookupDocument(record.supersedesId);
  if (!predecessor) return ['La révision remplacée est introuvable.'];
  if (predecessor.kind !== record.kind) errors.push('Une révision doit remplacer un document du même type.');
  if (predecessor.status !== 'validated') errors.push('Seule une version validée peut servir de base à une nouvelle révision.');
  const zones = new Set((record.zoneIds || []).map(String));
  const missingZones = (predecessor.zoneIds || []).map(String).filter(zoneId => !zones.has(zoneId));
  if (missingZones.length) errors.push(`La nouvelle révision doit conserver les zones déjà couvertes: ${missingZones.join(', ')}.`);
  if (record.kind === CONTINUITY_KINDS.PROCEDURE && String(record.protectionGroupId) !== String(predecessor.protectionGroupId)) {
    errors.push('Une révision de procédure doit rester rattachée au même groupe Principal/Secours.');
  }
  if (!existing) {
    const duplicate = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND record_id<>$1 AND data->>'kind'=$2 AND data->>'supersedesId'=$3 AND COALESCE(data->>'status','draft')<>'retired' LIMIT 1", [String(record.id), String(record.kind), String(record.supersedesId)]);
    if (duplicate.rowCount) errors.push('Une révision active existe déjà pour cette version. Terminez-la ou supprimez son brouillon avant d’en créer une autre.');
  }
  return errors;
}

async function hasValidatedSuccessor(record) {
  if (!record?.id) return false;
  const result = await pool.query("SELECT 1 FROM platform_records WHERE store_name='docs' AND deleted=FALSE AND data->>'kind'=$1 AND data->>'status'='validated' AND data->>'supersedesId'=$2 LIMIT 1", [String(record.kind), String(record.id)]);
  return result.rowCount > 0;
}

async function normalizeIncomingDocument(
  record,
  existing,
  user,
  lookup = id => access.get('docs', id),
  lookupResource = (store, id) => access.get(store, id)
) {
  if (String(record.kind || '').startsWith('topology_')) {
    await validateIncomingTopology(record, lookup);
    await ensureTopologyUnique(record);
    return record;
  }
  if (CONTINUITY_KIND_SET.has(record.kind)) {
    if (record.kind === CONTINUITY_KINDS.TEST) {
      throw Object.assign(new Error("Les tests de continuité sont créés uniquement par l'endpoint d'exécution contrôlée."), { status:409, code:'DEDICATED_CONTINUITY_TEST_ENDPOINT' });
    }
    let normalized = normalizeContinuityRecord(record.kind, {
      ...record,
      authorId:existing?.authorId ?? user.id
    }, existing);
    if (normalized.status === 'retired' && existing?.status !== 'retired') {
      throw Object.assign(new Error('Utilisez le retrait documentaire dédié afin de conserver l’auteur, la date et le motif.'), { status:409, code:'DEDICATED_DOCUMENT_RETIREMENT' });
    }
    if (existing?.status === 'retired') {
      if (JSON.stringify({ ...existing, updatedAt:null }) !== JSON.stringify({ ...normalized, updatedAt:null })) {
        throw Object.assign(new Error('Cette donnée retirée appartient à l’historique immuable.'), { status:409, code:'RETIRED_DOCUMENT_IMMUTABLE' });
      }
      return existing;
    }
    if (normalized.status === 'validated' && existing?.status !== 'validated') {
      throw Object.assign(new Error('Utilisez la validation dédiée afin de conserver le principe des quatre yeux.'), { status:409, code:'DEDICATED_CONTINUITY_APPROVAL' });
    }
    if (existing?.status === 'validated' && JSON.stringify({ ...existing, updatedAt:null }) !== JSON.stringify({ ...normalized, updatedAt:null })) {
      throw Object.assign(new Error('Cette donnée de continuité validée est immuable. Créez une nouvelle révision avec un nouvel identifiant.'), { status:409, code:'VALIDATED_DOCUMENT_IMMUTABLE' });
    }
    if (existing?.status === 'validated') return existing;
    const errors = validateContinuityRecord(normalized);
    errors.push(...await validateRevisionLink(normalized, existing, lookup));
    errors.push(...await validateContinuityReferences(normalized, lookup, lookupResource));
    errors.push(...await validateDocumentZoneCoverage(normalized, lookupResource, lookup));
    if (errors.length) throw connectivityError('INVALID_CONTINUITY_RECORD', errors);
    return normalized;
  }
  if (record.kind === DIAGRAM_RECORD_KIND) {
    let normalized = normalizeDiagram({ ...record, authorId:existing?.authorId ?? user.id }, existing);
    if (normalized.status === 'retired' && existing?.status !== 'retired') {
      throw Object.assign(new Error('Utilisez le retrait documentaire dédié afin de conserver l’auteur, la date et le motif.'), { status:409, code:'DEDICATED_DOCUMENT_RETIREMENT' });
    }
    if (existing?.status === 'retired') {
      if (JSON.stringify({ ...existing, updatedAt:null }) !== JSON.stringify({ ...normalized, updatedAt:null })) {
        throw Object.assign(new Error('Ce schéma retiré appartient à l’historique immuable.'), { status:409, code:'RETIRED_DOCUMENT_IMMUTABLE' });
      }
      return existing;
    }
    if (normalized.status === 'validated' && existing?.status !== 'validated') {
      throw Object.assign(new Error('Utilisez la validation dédiée du diagramme afin de conserver le principe des quatre yeux.'), { status:409, code:'DEDICATED_DIAGRAM_APPROVAL' });
    }
    if (existing?.status === 'validated' && JSON.stringify({ ...existing, updatedAt:null }) !== JSON.stringify({ ...normalized, updatedAt:null })) {
      throw Object.assign(new Error('Ce schéma validé est immuable. Créez une nouvelle révision avec un nouvel identifiant.'), { status:409, code:'VALIDATED_DOCUMENT_IMMUTABLE' });
    }
    if (existing?.status === 'validated') return existing;
    const checked = validateDiagram(normalized);
    checked.errors.push(...await validateRevisionLink(checked.value, existing, lookup));
    checked.errors.push(...await validateDiagramReferences(checked.value, lookupResource, lookup));
    checked.errors.push(...await validateDocumentZoneCoverage(checked.value, lookupResource, lookup));
    if (checked.errors.length) throw connectivityError('INVALID_DIAGRAM', checked.errors);
    return checked.value;
  }
  return record;
}

function coerceId(value) {
  if (/^-?\d+$/.test(String(value))) {
    const number = Number(value); if (Number.isSafeInteger(number)) return number;
  }
  return value;
}

async function normalizeIncomingUser(recordId, body) {
  const existingResult = await pool.query("SELECT data FROM platform_records WHERE store_name='users' AND record_id=$1 LIMIT 1", [String(recordId)]);
  const existing = existingResult.rows[0]?.data || {};
  const record = { ...existing, ...body, id: body.id ?? coerceId(recordId) };
  record.username = String(record.username || '').trim();
  if (!record.username) throw Object.assign(new Error("Le nom d'utilisateur est obligatoire."), { status: 400, code: 'USERNAME_REQUIRED' });

  let passwordChanged = false;
  if (body.password) {
    let plain = '';
    try { plain = Buffer.from(String(body.password), 'base64').toString('utf8'); } catch {}
    if (!plain) throw Object.assign(new Error('Mot de passe invalide.'), { status: 400, code: 'INVALID_PASSWORD' });
    // Même politique que le formulaire, appliquée ici parce que c'est le passage obligé
    // de toute écriture d'utilisateur : un contrôle qui ne vivrait que dans le navigateur
    // serait contourné par n'importe quel appel direct à l'API.
    const evaluation = evaluatePassword(plain, { username: record.username, fullName: record.fullName });
    if (!evaluation.valide) {
      throw Object.assign(new Error(passwordRejectionMessage(evaluation)),
        { status: 400, code: 'WEAK_PASSWORD', details: evaluation.problemes });
    }
    record.passwordHash = hashPassword(plain);
    record.passwordScheme = 'scrypt-v1';
    passwordChanged = true;
  } else if (body.passwordHash && body.passwordHash !== existing.passwordHash) {
    throw Object.assign(new Error('Modification directe du hash interdite.'), { status: 400, code: 'PASSWORD_HASH_FORBIDDEN' });
  }
  delete record.password;

  const sensitiveChanged = passwordChanged ||
    String(record.role || '') !== String(existing.role || '') ||
    String(record.status || '') !== String(existing.status || '') ||
    normalizeUsername(record.username) !== normalizeUsername(existing.username || record.username);
  record.authVersion = sensitiveChanged ? Math.max(1, Number(existing.authVersion || 1) + 1) : Math.max(1, Number(existing.authVersion || 1));

  if (String(recordId) === '1' && (record.role !== 'admin' || record.status === 'inactive')) {
    throw Object.assign(new Error("Le compte administrateur global ne peut pas être rétrogradé ni désactivé."), { status: 409, code: 'GLOBAL_ADMIN_INVARIANT' });
  }

  // Invariant : au moins un administrateur actif doit subsister à tout instant. La règle
  // sur l'enregistrement `1` ci-dessus protège UNE ligne, pas la propriété — rien
  // n'empêchait de rétrograder tous les autres administrateurs.
  const losesAdmin = isPlatformAdmin(existing.role) && (!isPlatformAdmin(record.role) || record.status === 'inactive');
  if (losesAdmin) await assertAnotherActiveAdminExists(recordId);

  return record;
}

/**
 * Vérifie qu'un administrateur actif autre que `excludedRecordId` subsiste.
 *
 * `FOR UPDATE` n'est pas optionnel : sans verrou, deux rétrogradations concurrentes des
 * deux derniers administrateurs passeraient chacune un comptage non verrouillé, et la
 * plateforme se retrouverait sans aucun administrateur.
 */
async function assertAnotherActiveAdminExists(excludedRecordId, client = pool) {
  const result = await client.query(
    `SELECT count(*)::int AS total FROM platform_records
       WHERE store_name='users' AND deleted=FALSE AND record_id <> $1
         AND data->>'role' IN ('admin','manager') AND coalesce(data->>'status','active') <> 'inactive'
       FOR UPDATE`,
    [String(excludedRecordId)]
  );
  if ((result.rows[0]?.total || 0) < 1) {
    throw Object.assign(
      new Error("Cette opération laisserait la plateforme sans aucun administrateur actif."),
      { status: 409, code: 'LAST_ADMIN' }
    );
  }
}

function accessError(res, error) {
  json(res, error.status || 500, { error: error.code || 'ACCESS_ERROR', message: error.message || 'Erreur de contrôle d’accès.' });
}

const relatedStoreForRequest = type => ({ equipment:'equipments', room:'rooms', baie:'baies', screen:'screens', 'continuity-test':'docs' })[type] || null;
const requestActorName = user => String(user?.fullName || user?.username || 'Utilisateur').slice(0, 180);
const safeRequestAttachment = value => {
  const attachment = String(value || '');
  if (!attachment) return '';
  if (attachment.length > 7_500_000 || !/^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,[a-z0-9+/=\s]+$/i.test(attachment)) {
    throw Object.assign(new Error('Pièce jointe invalide ou supérieure à 5 Mo.'), { status: 400, code: 'INVALID_ATTACHMENT' });
  }
  return attachment;
};

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function requestForUpdate(client, requestId) {
  const result = await client.query("SELECT data FROM platform_records WHERE store_name='tickets' AND record_id=$1 AND deleted=FALSE FOR UPDATE", [String(requestId)]);
  return result.rows[0]?.data || null;
}

async function createServiceRequest(user, body) {
  const { value, errors } = validateRequestPayload(body);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400, code: 'INVALID_SERVICE_REQUEST', details: errors });
  return inTransaction(async client => {
    const zone = await access.get('zones', value.destinationZoneId, client);
    if (!zone || zone.status === 'inactive') throw Object.assign(new Error('La zone destinataire est introuvable ou inactive.'), { status: 404, code: 'DESTINATION_ZONE_NOT_FOUND' });
    let related = null;
    if (value.relatedType) {
      if (!RELATED_TYPES.includes(value.relatedType)) throw Object.assign(new Error("Type d'élément inconnu."), { status: 400, code: 'INVALID_RELATED_TYPE' });
      const relatedStore = relatedStoreForRequest(value.relatedType);
      related = await access.get(relatedStore, value.relatedId, client);
      if (!related) throw Object.assign(new Error("L'élément lié est introuvable."), { status: 404, code: 'RELATED_RESOURCE_NOT_FOUND' });
      if (!seesEverything(user.role) && !await access.canAccessRecord(user, relatedStore, related, 'read', client)) {
        throw Object.assign(new Error("Vous ne pouvez lier que les éléments auxquels vous avez accès."), { status: 403, code: 'RELATED_RESOURCE_FORBIDDEN' });
      }
    }

    const now = new Date();
    const id = `REQ-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex')}`;
    const slaMinutes = requestSlaMinutes(value.priority);
    const definition = requestKindDefinition(value.requestKind);
    const record = {
      id,
      requestKind: value.requestKind,
      subject: value.subject,
      title: value.subject,
      desc: value.description,
      description: value.description,
      details: value.details,
      category: definition.category,
      prio: value.priority,
      status: 'en cours',
      zoneId: zone.id,
      destinationZoneId: zone.id,
      destinationZoneName: String(zone.name || zone.id).slice(0, 180),
      type: value.relatedType || 'zone',
      relatedType: value.relatedType || '',
      relatedId: value.relatedId || '',
      relatedName: related ? String(related.name || related.nom || related.serialNumber || `${value.relatedType} ${value.relatedId}`).slice(0, 240) : '',
      createdById: user.id,
      requestedBy: user.id,
      createdBy: requestActorName(user),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      comments: [],
      attach: safeRequestAttachment(value.attachment),
      slaMinutes,
      deadline: new Date(now.getTime() + slaMinutes * 60_000).toISOString(),
      solution: '',
      solutionUser: '',
      closedAt: null,
      readyToClose: false,
      workflowVersion: 2
    };
    await access.put('tickets', id, record, client);
    await access.audit({ actorId:user.id, subjectId:user.id, zoneId:zone.id, action:'service-request.create', after:{ id, requestKind:value.requestKind, subject:value.subject } }, client);
    return record;
  });
}

async function canManageServiceRequest(user, record, client = pool) {
  return isPlatformAdmin(user.role) || await access.canAccessRecord(user, 'tickets', record, 'write', client);
}

async function updateServiceRequest(user, requestId, body) {
  return inTransaction(async client => {
    const current = await requestForUpdate(client, requestId);
    if (!current) throw Object.assign(new Error('Demande introuvable.'), { status: 404, code: 'SERVICE_REQUEST_NOT_FOUND' });
    if (!await canManageServiceRequest(user, current, client)) throw Object.assign(new Error("Vous ne pouvez pas traiter cette demande."), { status: 403, code: 'SERVICE_REQUEST_FORBIDDEN' });
    const next = { ...current };
    if (body.status !== undefined) {
      if (!REQUEST_STATUSES.includes(body.status)) throw Object.assign(new Error('Statut de demande invalide.'), { status: 400, code: 'INVALID_REQUEST_STATUS' });
      if (body.status === 'fermé' && !isPlatformAdmin(user.role)) throw Object.assign(new Error("Seul l'administrateur global peut fermer définitivement une demande."), { status: 403, code: 'ADMIN_CLOSE_REQUIRED' });
      next.status = body.status;
      next.readyToClose = body.status === 'prêt-fermeture';
      next.closedAt = body.status === 'fermé' ? new Date().toISOString() : null;
    }
    if (body.solution !== undefined) {
      next.solution = String(body.solution || '').trim().slice(0, 4000);
      next.solutionUser = requestActorName(user);
      next.solutionUserId = user.id;
    }
    next.updatedAt = new Date().toISOString();
    await access.put('tickets', requestId, next, client);
    await access.audit({ actorId:user.id, subjectId:current.createdById ?? current.requestedBy ?? null, zoneId:current.zoneId, action:'service-request.update', before:{ status:current.status }, after:{ status:next.status } }, client);
    return next;
  });
}

async function mutateServiceRequestComment(user, requestId, operation, commentId, body = {}) {
  return inTransaction(async client => {
    const current = await requestForUpdate(client, requestId);
    if (!current) throw Object.assign(new Error('Demande introuvable.'), { status: 404, code: 'SERVICE_REQUEST_NOT_FOUND' });
    const owner = String(current.createdById ?? current.requestedBy ?? '') === String(user.id);
    const manager = await canManageServiceRequest(user, current, client);
    if (!owner && !manager) throw Object.assign(new Error("Vous ne pouvez pas commenter cette demande."), { status: 403, code: 'SERVICE_REQUEST_FORBIDDEN' });
    if (current.status === 'fermé' && !manager) throw Object.assign(new Error('Cette demande est fermée.'), { status: 409, code: 'SERVICE_REQUEST_CLOSED' });
    const comments = Array.isArray(current.comments) ? [...current.comments] : [];

    if (operation === 'create') {
      const text = String(body.text || '').trim().slice(0, 2000);
      const attachment = safeRequestAttachment(body.attachment);
      if (!text && !attachment) throw Object.assign(new Error('Ajoutez un commentaire ou une pièce jointe.'), { status: 400, code: 'EMPTY_COMMENT' });
      const id = `CMT-${Date.now()}-${randomBytes(3).toString('hex')}`;
      comments.push({ id, userId:user.id, user:requestActorName(user), text, attachment, date:new Date().toISOString() });
    } else {
      const index = comments.findIndex(comment => String(comment.id) === String(commentId));
      if (index < 0) throw Object.assign(new Error('Commentaire introuvable.'), { status: 404, code: 'COMMENT_NOT_FOUND' });
      const commentOwner = String(comments[index].userId || '') === String(user.id);
      if (!commentOwner && !manager) throw Object.assign(new Error('Vous ne pouvez pas modifier ce commentaire.'), { status: 403, code: 'COMMENT_FORBIDDEN' });
      if (operation === 'delete') comments.splice(index, 1);
      else {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) throw Object.assign(new Error('Le commentaire ne peut pas être vide.'), { status: 400, code: 'EMPTY_COMMENT' });
        comments[index] = { ...comments[index], text, editedAt:new Date().toISOString() };
      }
    }

    const next = { ...current, comments, updatedAt:new Date().toISOString() };
    await access.put('tickets', requestId, next, client);
    await access.audit({ actorId:user.id, subjectId:current.createdById ?? current.requestedBy ?? null, zoneId:current.zoneId, action:`service-request.comment.${operation}`, after:{ requestId, commentId:commentId || comments.at(-1)?.id } }, client);
    return next;
  });
}

async function handleApi(req, res, url) {
  if (!url.pathname.startsWith('/api/')) return false;
  if (req.method === 'GET' && url.pathname === '/api/health') {
    if (!pool) return json(res, 200, { ok: true, database: 'local-only', centralSync: false, ...VERSION_DEPLOYEE }), true;
    try { await ensureSchema(); await pool.query('SELECT 1'); return json(res, 200, { ok: true, database: 'postgresql', centralSync: true, zoneAccess: true, ...VERSION_DEPLOYEE }), true; }
    catch (error) { return json(res, 503, { ok: false, database: 'postgresql', error: error.message, ...VERSION_DEPLOYEE }), true; }
  }

  if (!pool) { json(res, 503, { error: 'CENTRAL_DATABASE_UNAVAILABLE', message: 'DATABASE_URL n’est pas configurée sur Railway.' }); return true; }
  await ensureSchema();

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req, 1024 * 1024);
    const username = String(body.username || '').trim();

    // Refuser AVANT toute dérivation scrypt : c'est ce qui rend la limite efficace aussi
    // contre le déni de service, et pas seulement contre la force brute.
    const now = Date.now();
    const { address, username: normalized } = loginThrottleKey(req, username);
    const userKey = `u:${normalized}`;
    const addressKey = `a:${address}`;
    const byUser = loginAttemptState(userKey, LOGIN_MAX_PER_USERNAME, now);
    const byAddress = loginAttemptState(addressKey, LOGIN_MAX_PER_ADDRESS, now);
    if (byUser.blocked || byAddress.blocked) {
      const retryAfter = Math.max(byUser.retryAfter, byAddress.retryAfter);
      json(res, 429, {
        error: 'TOO_MANY_ATTEMPTS',
        message: `Trop de tentatives de connexion. Réessayez dans ${Math.ceil(retryAfter / 60)} minute(s).`,
        retryAfter
      }, { 'Retry-After': String(retryAfter) });
      return true;
    }

    const result = await pool.query("SELECT record_id,data FROM platform_records WHERE store_name='users' AND deleted=FALSE AND LOWER(data->>'username')=$1 ORDER BY updated_at DESC LIMIT 1", [normalizeUsername(username)]);
    const record = result.rows[0]?.data;
    if (!record || !verifyPassword(record, body.password || '') || record.status === 'inactive') {
      recordLoginFailure(userKey, now);
      recordLoginFailure(addressKey, now);
      json(res, 401, { error: 'INVALID_CREDENTIALS', message: "Nom d'utilisateur ou mot de passe incorrect" }); return true;
    }
    clearLoginFailures(userKey, addressKey);

    /*
     * UN RÔLE INCONNU NE REÇOIT PAS DE SESSION.
     *
     * Mesuré : un compte au rôle hérité illisible obtenait `200` à la connexion, puis un
     * instantané `/api/sync` ENTIÈREMENT VIDE, puis une navigation de visiteur. Chaque
     * couche faisait bien son travail — fermer — mais l'utilisateur voyait une plateforme
     * vide sans qu'aucun écran ne dise pourquoi, et appelait pour signaler « une panne ».
     *
     * Un échec silencieux qui ressemble à une panne coûte plus cher qu'un refus. On refuse
     * donc ici, en nommant la cause et l'action. Le mot de passe a été vérifié : ce n'est
     * pas un secret qu'on révèle, c'est l'état de son propre compte.
     *
     * `resolveKnownRole` est la MÊME résolution que celle des autorisations : les alias
     * historiques — « technicien », « technique », « responsable », « administrateur » —
     * restent valides et entrent normalement.
     */
    if (!resolveKnownRole(record.role)) {
      json(res, 403, {
        error: ROLE_ERRORS.INVALID_ROLE,
        message: "Le rôle de ce compte est invalide. Contactez un administrateur."
      }); return true;
    }

    const updated = { ...record, authVersion: Math.max(1, Number(record.authVersion || 1)), lastLogin: new Date().toISOString() };
    if (!updated.passwordHash && updated.password) {
      updated.passwordHash = hashPassword(String(body.password || ''));
      updated.passwordScheme = 'scrypt-v1';
      delete updated.password;
      updated.authVersion += 1;
    }
    // CHAQUE CONNEXION écrit ici. C'était la porte dérobée la plus fréquente de toutes :
    // `lastLogin` et `authVersion` changeaient sans que le compteur bouge, si bien qu'une
    // fiche utilisateur pouvait être modifiée des dizaines de fois par jour sans qu'aucune
    // session ouverte ne s'en aperçoive.
    await compareAndWrite(pool, {
      storeName: 'users', recordId: String(result.rows[0].record_id), record: updated, force: true
    });
    const safeUser = safeUserRecord(updated);
    json(res, 200, { user: safeUser, centralSync: true }, { 'Set-Cookie': sessionCookie(req, signSession(safeUser)) }); return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) }); return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = await currentUser(req);
    if (!user) { json(res, 401, { error: 'UNAUTHENTICATED' }, { 'Set-Cookie': sessionCookie(req, '', 0) }); return true; }
    json(res, 200, { user, centralSync: true, access: await access.contextFor(user) }); return true;
  }

  const user = await currentUser(req);
  if (!user) { json(res, 401, { error: 'UNAUTHENTICATED', message: 'Session requise.' }, { 'Set-Cookie': sessionCookie(req, '', 0) }); return true; }

  if (req.method === 'GET' && url.pathname === '/api/access/context') {
    json(res, 200, await access.contextFor(user)); return true;
  }

  /*
   * CE QUE JE PEUX FAIRE DU TRACÉ DE CE CÂBLE, ICI, MAINTENANT.
   *
   * Lecture seule, et la seule façon honnête de répondre à « puis-je dessiner dans cette
   * scène ? ». Le navigateur ne peut pas la calculer : son contexte d'accès porte les zones
   * et les habilitations, jamais la cartographie enregistrement → zones.
   *
   * L'écran interroge cette route AU MOMENT d'ouvrir l'éditeur, et non la copie locale : une
   * habilitation révoquée depuis la dernière synchronisation doit fermer le bouton tout de
   * suite, pas au prochain instantané.
   *
   * La réponse ne dit QUE des booléens. Un câble hors périmètre répond 404 comme s'il
   * n'existait pas : distinguer « absent » de « interdit » révélerait son existence.
   */
  const routeAccessMatch = url.pathname.match(/^\/api\/cables\/([^/]+)\/route-access$/);
  if (req.method === 'GET' && routeAccessMatch) {
    const cableId = decodeURIComponent(routeAccessMatch[1]);
    const cable = await access.get('cables', cableId);
    if (!cable || !await access.canAccessRecord(user, 'cables', cable, 'read')) {
      json(res, 404, { error: 'CABLE_NOT_FOUND', message: 'Câble introuvable ou hors de votre périmètre.' }); return true;
    }
    const sceneType = url.searchParams.get('sceneType');
    let scene = null;
    if (sceneType !== null) {
      if (!ROUTE_SCENE_TYPES.includes(sceneType)) {
        json(res, 400, { error: 'ROUTE_SCENE_INVALID', message: 'Scène inconnue.' }); return true;
      }
      // Un identifiant de scène arrive toujours en texte dans une requête ; on lui rend la
      // forme qu'il a dans l'enregistrement, comme partout ailleurs dans ce serveur.
      const brut = url.searchParams.get('sceneId');
      scene = { sceneType, sceneId: brut === null || brut === '' ? null : coerceId(brut) };
    }
    /*
     * LA GÉOMÉTRIE FRAÎCHE PART AVEC LA PERMISSION FRAÎCHE.
     *
     * Rendre le seul booléen `readable` laissait une faille : sous une révocation
     * PARTIELLE — RF1 retiré, STC conservé — le serveur répond encore `readable: true`, et
     * un écran qui garderait sa copie locale continuerait d'afficher le segment RF1, son
     * identifiant de scène et sa place dans le parcours. La permission était à jour, la
     * géométrie ne l'était pas, et c'est la géométrie qu'on voit.
     *
     * La réponse porte donc la vue SANITISÉE du moment. `revision` accompagne la charge
     * pour que l'écran sache si sa copie est en retard ; il ne s'en sert JAMAIS pour
     * écrire — une révision fraîche collée sur des champs périmés contournerait le
     * contrat de concurrence.
     */
    json(res, 200, {
      ...(await cableRouteAccess(user, cable, scene)),
      route: await cableRouteView(user, cable),
      revision: cable[REVISION_FIELD] ?? null
    }); return true;
  }

  /*
   * LES SALLES ET LEURS ZONES VOYAGENT ENSEMBLE.
   *
   * Sauvegarde, export JSON et remplacement d'inventaire sortaient tous `rooms[]` seul.
   * `resource_zones` étant la seule vérité de la zone d'une salle, une salle exportée sans
   * son rattachement n'est pas sauvegardée : réimportée, elle n'appartient à personne, donc
   * plus aucun rôle à périmètre ne la voit et l'écran des accès ne la propose même pas.
   *
   * Ce couple de routes est le SEUL chemin. L'export est filtré par le périmètre du
   * demandeur ; l'écriture est vérifiée puis appliquée en une transaction, par le serveur.
   */
  if (req.method === 'GET' && url.pathname === '/api/rooms/transfer') {
    const rooms = [];
    for (const room of await access.list('rooms')) {
      if (isPlatformAdmin(user.role) || await access.canAccessRecord(user, 'rooms', room, 'read')) rooms.push(room);
    }
    const visibles = new Set(rooms.map(room => String(room.id)));
    const roomZones = (await access.roomZonePairs()).filter(paire => visibles.has(String(paire.roomId)));
    json(res, 200, buildRoomTransfer(rooms, roomZones)); return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms/transfer') {
    const body = await readJson(req);
    try {
      const paquet = readRoomTransfer(body);
      const rapport = await access.applyRoomTransfer(user, paquet);
      json(res, 200, { ok: true, ...rapport, migratedFromLegacy: paquet.migratedFromLegacy }); return true;
    } catch (error) {
      json(res, error.status || 400, {
        error: error.code || 'ROOM_TRANSFER_FAILED',
        message: error.message || 'Le dépôt des salles a échoué.'
      }); return true;
    }
  }

  /**
   * RESTAURER UN GRAPHE DE LOCALISATIONS — TOUT, OU RIEN (P0-C).
   *
   * Même raison d'être que `/api/rooms/transfer` juste au-dessus : le navigateur ne peut
   * pas garantir qu'une suite de PUT indépendants aboutisse entièrement. Une Ville écrite
   * puis une Région refusée laissait un arbre coupé en deux. `applyLocationsRestore`
   * vérifie le graphe entier, puis écrit dans UNE transaction PostgreSQL — au moindre
   * échec, `ROLLBACK` : zéro changement net.
   *
   * La porte est `system.restore` (administrateur seul, déjà dans `permissions.js`),
   * vérifiée dans `applyLocationsRestore` — pas ici, pour qu'aucun autre appelant ne
   * puisse l'oublier.
   */
  if (req.method === 'POST' && url.pathname === '/api/locations/restore') {
    const body = await readJson(req);
    try {
      const rapport = await access.applyLocationsRestore(user, body);
      json(res, 200, { ok: true, ...rapport }); return true;
    } catch (error) {
      json(res, error.status || 400, {
        error: error.code || 'LOCATIONS_RESTORE_FAILED',
        message: error.message || 'La restauration des localisations a échoué.',
        errors: error.errors || undefined
      }); return true;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/access/manage') {
    try {
      const context = await access.contextFor(user);
      const users = await access.safeUsersForManager(user);
      const requests = await access.requestsFor(user);
      const responsibleZones = new Set((context.memberships || []).filter(item => item.responsible).map(item => String(item.zoneId)));
      const admin = seesEverything(user.role);
      const allMemberships = admin ? await access.list('zone_memberships') : (await access.list('zone_memberships')).filter(item => responsibleZones.has(String(item.zoneId)));
      const allGrants = admin ? await access.list('zone_grants') : (await access.list('zone_grants')).filter(item => responsibleZones.has(String(item.zoneId)));
      const resourceZones = admin ? await access.list('resource_zones') : (await access.list('resource_zones')).filter(item => responsibleZones.has(String(item.zoneId)));
      const audit = admin ? (await access.list('access_audit')).slice(-300) : (await access.list('access_audit')).filter(item => responsibleZones.has(String(item.zoneId))).slice(-200);
      json(res, 200, { ...context, zones: admin ? await access.list('zones') : context.zones, users, requests, memberships: allMemberships, grants: allGrants, resourceZones, audit, permissions: access.PERMISSIONS });
    } catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/access/requests') {
    json(res, 200, { requests: await access.requestsFor(user) }); return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/requests') {
    try { json(res, 201, { request: await access.createRequest(user, await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  const reviewMatch = url.pathname.match(/^\/api\/access\/requests\/([^/]+)\/review$/);
  if (req.method === 'POST' && reviewMatch) {
    try { json(res, 200, { request: await access.reviewRequest(user, decodeURIComponent(reviewMatch[1]), await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/zones') {
    try { json(res, 200, { zone: await access.createZone(user, await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/memberships') {
    try { json(res, 200, { membership: await access.ensureMembership(user, await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/grants') {
    try { json(res, 200, { grant: await access.grantPermission(user, await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  const grantDeleteMatch = url.pathname.match(/^\/api\/access\/grants\/([^/]+)$/);
  if (req.method === 'DELETE' && grantDeleteMatch) {
    try { json(res, 200, { grant: await access.revokeGrant(user, decodeURIComponent(grantDeleteMatch[1])) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/resource-zones') {
    try { json(res, 200, { mapping: await access.mapResource(user, await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/service-requests') {
    try { json(res, 201, { request: await createServiceRequest(user, await readJson(req, 8 * 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  const serviceRequestMatch = url.pathname.match(/^\/api\/service-requests\/([^/]+)$/);
  if (req.method === 'PATCH' && serviceRequestMatch) {
    try { json(res, 200, { request: await updateServiceRequest(user, decodeURIComponent(serviceRequestMatch[1]), await readJson(req, 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  const requestCommentsMatch = url.pathname.match(/^\/api\/service-requests\/([^/]+)\/comments$/);
  if (req.method === 'POST' && requestCommentsMatch) {
    try { json(res, 201, { request: await mutateServiceRequestComment(user, decodeURIComponent(requestCommentsMatch[1]), 'create', null, await readJson(req, 8 * 1024 * 1024)) }); }
    catch (error) { accessError(res, error); }
    return true;
  }

  const requestCommentMatch = url.pathname.match(/^\/api\/service-requests\/([^/]+)\/comments\/([^/]+)$/);
  if (requestCommentMatch && ['PATCH','DELETE'].includes(req.method)) {
    try {
      const body = req.method === 'PATCH' ? await readJson(req, 1024 * 1024) : {};
      json(res, 200, { request: await mutateServiceRequestComment(user, decodeURIComponent(requestCommentMatch[1]), req.method === 'DELETE' ? 'delete' : 'update', decodeURIComponent(requestCommentMatch[2]), body) });
    } catch (error) { accessError(res, error); }
    return true;
  }

  const continuityApprovalMatch = url.pathname.match(/^\/api\/continuity\/([^/]+)\/validate$/);
  if (req.method === 'POST' && continuityApprovalMatch) {
    try {
      const id = decodeURIComponent(continuityApprovalMatch[1]);
      const current = await access.get('docs', id);
      if (!current || !CONTINUITY_KIND_SET.has(current.kind)) throw Object.assign(new Error('Donnée de continuité introuvable.'), { status:404, code:'CONTINUITY_NOT_FOUND' });
      if (!seesEverything(user.role) && !await access.canAccessRecord(user, 'docs', current, 'read')) {
        throw Object.assign(new Error('Donnée de continuité introuvable.'), { status:404, code:'CONTINUITY_NOT_FOUND' });
      }
      await assertDocumentReferencesVisible(user, current);
      if (![CONTINUITY_KINDS.PROTECTION_GROUP, CONTINUITY_KINDS.PROCEDURE].includes(current.kind)) throw Object.assign(new Error("Ce type de preuve de continuité n'utilise pas le workflow d'approbation."), { status:409, code:'CONTINUITY_APPROVAL_NOT_APPLICABLE' });
      if (current.status === 'validated') throw Object.assign(new Error('Cette donnée de continuité est déjà validée.'), { status:409, code:'CONTINUITY_ALREADY_VALIDATED' });
      const continuityReferenceErrors = await validateContinuityReferences(current);
      continuityReferenceErrors.push(...await validateDocumentZoneCoverage(current, (storeName, resourceId) => access.get(storeName, resourceId), documentId => access.get('docs', documentId)));
      if (continuityReferenceErrors.length) throw connectivityError('INVALID_CONTINUITY_REFERENCES', continuityReferenceErrors, 409);
      const zoneIds = await access.resolveResourceZones('docs', current);
      if (!isPlatformAdmin(user.role)) {
        if (!zoneIds.length || !(await Promise.all(zoneIds.map(zoneId => access.hasPermission(user, zoneId, 'continuity.validate')))).every(Boolean)) {
          throw Object.assign(new Error("Vous devez être validateur autorisé dans toutes les zones concernées."), { status:403, code:'CONTINUITY_VALIDATE_FORBIDDEN' });
        }
      }
      const approved = applyContinuityApproval(current, user);
      await access.put('docs', id, approved);
      await access.audit({ actorId:user.id, action:'continuity.validate', after:{ id, kind:approved.kind, revision:approved.revision || null } });
      json(res, 200, { record:approved });
    } catch (error) { accessError(res, error); }
    return true;
  }

  const continuityTestMatch = url.pathname.match(/^\/api\/continuity\/([^/]+)\/tests$/);
  if (req.method === 'POST' && continuityTestMatch) {
    try {
      const protectionGroupId = decodeURIComponent(continuityTestMatch[1]);
      const group = await access.get('docs', protectionGroupId);
      if (!group || group.kind !== CONTINUITY_KINDS.PROTECTION_GROUP || (!seesEverything(user.role) && !await access.canAccessRecord(user, 'docs', group, 'read'))) {
        throw Object.assign(new Error('Groupe de protection introuvable.'), { status:404, code:'PROTECTION_GROUP_NOT_FOUND' });
      }
      if (group.status !== 'validated') throw Object.assign(new Error('Le groupe de protection doit être validé avant un test opérationnel.'), { status:409, code:'PROTECTION_GROUP_NOT_VALIDATED' });
      if (await hasValidatedSuccessor(group)) throw Object.assign(new Error('Ce groupe a été remplacé par une révision validée plus récente.'), { status:409, code:'PROTECTION_GROUP_SUPERSEDED' });
      const zoneIds = await access.resolveResourceZones('docs', group);
      if (!isPlatformAdmin(user.role)) {
        if (!zoneIds.length || !(await Promise.all(zoneIds.map(zoneId => access.hasPermission(user, zoneId, 'continuity.test')))).every(Boolean)) {
          throw Object.assign(new Error("Vous n'êtes pas autorisé à exécuter cette procédure dans toutes les zones concernées."), { status:403, code:'CONTINUITY_TEST_FORBIDDEN' });
        }
      }
      const body = await readJson(req, 1024 * 1024);
      const procedure = await access.get('docs', body.procedureId);
      if (!procedure || (!seesEverything(user.role) && !await access.canAccessRecord(user, 'docs', procedure, 'read'))) {
        throw Object.assign(new Error('Procédure introuvable.'), { status:404, code:'PROCEDURE_NOT_FOUND' });
      }
      if (procedure.kind !== CONTINUITY_KINDS.PROCEDURE || procedure.status !== 'validated' || String(procedure.protectionGroupId) !== String(group.id)) {
        throw Object.assign(new Error('La procédure sélectionnée est absente, non validée ou rattachée à un autre service.'), { status:409, code:'PROCEDURE_NOT_VALIDATED' });
      }
      if (await hasValidatedSuccessor(procedure)) throw Object.assign(new Error('Cette procédure a été remplacée par une révision validée plus récente.'), { status:409, code:'PROCEDURE_SUPERSEDED' });
      const id = `continuity-test-${Date.now()}-${randomBytes(5).toString('hex')}`;
      const record = normalizeContinuityRecord(CONTINUITY_KINDS.TEST, {
        id, protectionGroupId:group.id, procedureId:procedure.id, status:'documented',
        performedAt:new Date().toISOString(), performedBy:user.id,
        result:body.result, observations:String(body.observations || '').slice(0, 2000),
        measuredSwitchSeconds:body.measuredSwitchSeconds, restoredPrimary:body.restoredPrimary === true,
        evidenceRefs:Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [], immutable:true, authorId:user.id,
        zoneIds:group.zoneIds
      });
      const errors = validateContinuityRecord(record);
      if (errors.length) throw connectivityError('INVALID_CONTINUITY_TEST', errors);
      await access.put('docs', id, record);
      await access.audit({ actorId:user.id, action:'continuity.test', after:{ id, protectionGroupId:group.id, procedureId:procedure.id, result:record.result } });
      json(res, 201, { record });
    } catch (error) { accessError(res, error); }
    return true;
  }

  const diagramApprovalMatch = url.pathname.match(/^\/api\/diagrams\/([^/]+)\/validate$/);
  if (req.method === 'POST' && diagramApprovalMatch) {
    try {
      const id = decodeURIComponent(diagramApprovalMatch[1]);
      const current = await access.get('docs', id);
      if (!current || current.kind !== DIAGRAM_RECORD_KIND) throw Object.assign(new Error('Diagramme introuvable.'), { status:404, code:'DIAGRAM_NOT_FOUND' });
      if (!seesEverything(user.role) && !await access.canAccessRecord(user, 'docs', current, 'read')) {
        throw Object.assign(new Error('Diagramme introuvable.'), { status:404, code:'DIAGRAM_NOT_FOUND' });
      }
      await assertDocumentReferencesVisible(user, current);
      if (current.status === 'validated') throw Object.assign(new Error('Ce diagramme est déjà validé.'), { status:409, code:'DIAGRAM_ALREADY_VALIDATED' });
      const diagramReferenceErrors = await validateDiagramReferences(current, (storeName, resourceId) => access.get(storeName, resourceId), documentId => access.get('docs', documentId));
      diagramReferenceErrors.push(...await validateDocumentZoneCoverage(current, (storeName, resourceId) => access.get(storeName, resourceId), documentId => access.get('docs', documentId)));
      if (diagramReferenceErrors.length) throw connectivityError('INVALID_DIAGRAM_REFERENCES', diagramReferenceErrors, 409);
      const zoneIds = await access.resolveResourceZones('docs', current);
      if (!isPlatformAdmin(user.role)) {
        if (!zoneIds.length || !(await Promise.all(zoneIds.map(zoneId => access.hasPermission(user, zoneId, 'diagram.validate')))).every(Boolean)) {
          throw Object.assign(new Error("Vous devez être validateur autorisé dans toutes les zones concernées."), { status:403, code:'DIAGRAM_VALIDATE_FORBIDDEN' });
        }
      }
      const approved = applyDiagramApproval(current, user);
      await access.put('docs', id, approved);
      await access.audit({ actorId:user.id, action:'diagram.validate', after:{ id, diagramType:approved.diagramType, revision:approved.revision } });
      json(res, 200, { record:approved });
    } catch (error) { accessError(res, error); }
    return true;
  }

  const documentRetireMatch = url.pathname.match(/^\/api\/(?:data\/docs|documents)\/([^/]+)\/retire$/);
  if (req.method === 'POST' && documentRetireMatch) {
    try {
      const id = decodeURIComponent(documentRetireMatch[1]);
      const current = await access.get('docs', id);
      const retireable = current && (current.kind === DIAGRAM_RECORD_KIND
        || [CONTINUITY_KINDS.PROTECTION_GROUP, CONTINUITY_KINDS.PROCEDURE].includes(current.kind));
      if (!retireable || (!seesEverything(user.role) && !await access.canAccessRecord(user, 'docs', current, 'read'))) {
        throw Object.assign(new Error('Document introuvable.'), { status:404, code:'DOCUMENT_NOT_FOUND' });
      }
      if (current.status === 'retired') throw Object.assign(new Error('Ce document est déjà retiré.'), { status:409, code:'DOCUMENT_ALREADY_RETIRED' });
      if (current.status !== 'validated') throw Object.assign(new Error('Seul un document validé peut être retiré.'), { status:409, code:'DOCUMENT_NOT_VALIDATED' });
      const permission = current.kind === DIAGRAM_RECORD_KIND ? 'diagram.validate' : 'continuity.validate';
      const zoneIds = await access.resolveResourceZones('docs', current);
      if (!isPlatformAdmin(user.role) && (!zoneIds.length || !(await Promise.all(zoneIds.map(zoneId => access.hasPermission(user, zoneId, permission)))).every(Boolean))) {
        throw Object.assign(new Error('Retrait non autorisé dans toutes les zones concernées.'), { status:403, code:'DOCUMENT_RETIRE_FORBIDDEN' });
      }
      const body = await readJson(req, 1024 * 1024);
      const reason = String(body.reason || '').trim().slice(0, 1000);
      if (reason.length < 3) throw Object.assign(new Error('Le motif du retrait est obligatoire.'), { status:400, code:'RETIREMENT_REASON_REQUIRED' });
      const now = new Date().toISOString();
      const retired = {
        ...current,
        status:'retired',
        updatedAt:now,
        retirement:{ retiredAt:now, retiredBy:user.id, reason }
      };
      await access.put('docs', id, retired);
      await access.audit({ actorId:user.id, action:'document.retire', before:{ id, status:current.status }, after:{ id, kind:current.kind, status:'retired', reason } });
      json(res, 200, { record:retired });
    } catch (error) { accessError(res, error); }
    return true;
  }

  /*
   * LE PLAN DOCUMENTÉ DE LA GRILLE CENTRALE — LA SEULE PORTE (#137).
   *
   * Ce jeu de données vivait dans quatre modules servis à la racine. Mesuré sur la base
   * 8f51238d, un `curl` sans le moindre cookie en recevait les 190 libellés d'entrée, les
   * 184 de sortie, les repères GR, les chemins monitoring vers BAIE 3 / CHASSIS 5 et la
   * référence du synoptique interne. La fuite était donc EN AMONT de tout : avant
   * `canAccessRecord`, avant `resource_zones`, avant `/api/sync`.
   *
   * Il n'est plus servi comme un actif. Il vit sous `scripts/`, que `isPrivateStaticPath`
   * refuse déjà, et ne sort que par ici — après session, puis après autorisation.
   *
   * `Cache-Control: no-store` vient de `json()`, et le Service Worker ne met jamais en
   * cache une route sous `/api/` : ces octets ne survivent donc dans aucun cache une fois
   * l'habilitation retirée.
   */
  if (req.method === 'GET' && url.pathname === '/api/operational/grille-centrale/documented-map') {
    const decision = await access.canReadGrilleCentraleDataset(user);
    if (!decision.allowed) {
      /*
       * UN SEUL REFUS POUR DEUX CAUSES.
       *
       * « Vous n'y avez pas droit » et « l'appareil n'est pas identifiable » rendent le
       * même corps : distinguer les deux dirait à qui n'a pas accès si la Grille Centrale
       * est inventoriée, et sous quelle forme. La cause précise part au journal du serveur,
       * pas au client.
       */
      console.warn(`Plan Grille Centrale refusé (${decision.reason}${decision.candidates ? `, ${decision.candidates} candidats` : ''}).`);
      json(res, 403, {
        error: 'GRILLE_SCOPE_FORBIDDEN',
        message: "Ce plan technique dépasse vos habilitations."
      });
      return true;
    }
    const { buildGrilleCentraleDataset } = await import('./private-operational-data/grille-centrale.js');
    json(res, 200, { dataset: buildGrilleCentraleDataset() });
    return true;
  }

  /*
   * LE RELEVÉ DE LA RÉGIE CAR — MÊME PORTE, MÊME GARDE (A-5).
   *
   * MESURÉ sur `096cb47`, serveur local, sans cookie ni en-tête d'autorisation :
   *
   *     GET /regie-car-inventory-phase16.js    200   38 361 octets
   *     GET /regie-car-prephoto-readiness.js   200   25 732 octets
   *
   * Ces octets nommaient les baies réellement présentes, le matériel monté dans chacune,
   * les repères d'exploitation et un numéro d'inventaire interne. Ils vivent désormais sous
   * `scripts/private-operational-data/`, que `isPrivateStaticPath` refuse, et ne sortent
   * que d'ici — après session, puis après autorisation sur la salle.
   */
  if (req.method === 'GET' && url.pathname === '/api/operational/regie-car/inventory') {
    const decision = await access.canReadRegieCarDataset(user);
    if (!decision.allowed) {
      // Un seul refus pour toutes les causes : distinguer « pas le droit » de « pas encore
      // inventoriée » apprendrait déjà quelque chose sur l'installation.
      console.warn(`Relevé Régie Car refusé (${decision.reason}).`);
      json(res, 403, {
        error: 'REGIE_CAR_SCOPE_FORBIDDEN',
        message: "Ce relevé d'installation dépasse vos habilitations."
      });
      return true;
    }
    const { buildRegieCarDataset } = await import('./private-operational-data/regie-car.js');
    json(res, 200, { dataset: buildRegieCarDataset() });
    return true;
  }

  /*
   * LES OCTETS DU PLAN — LA SEULE PORTE, ET ELLE EST GARDÉE.
   *
   * Cette route ne vérifiait que la session. Un Visiteur d'un autre département recevait
   * donc le plan technique entier — mesuré au navigateur, puis conservé sur son poste.
   *
   * Le plan est une ressource MULTI-ZONE : les mêmes pixels portent STC, RF1, RF2,
   * l'acquisition et les salles serveurs. La décision revient au moteur d'accès, qui exige
   * `zone.summary.read` sur CHAQUE zone représentée — voir `canReadOperationalMap`.
   * Elle est prise ici, avant toute lecture des octets : un refus ne doit pas même coûter
   * la lecture du fichier.
   */
  if (req.method === 'GET' && url.pathname === '/api/settings/map-image') {
    if (!await access.canReadOperationalMap(user)) {
      // `json()` pose déjà `Cache-Control: no-store` sur toute réponse d'API : ces octets
      // ne survivent donc dans aucun cache navigateur ou intermédiaire après la perte de
      // l'habilitation qui les a autorisés.
      json(res, 403, {
        error: 'MAP_SCOPE_FORBIDDEN',
        message: "Ce plan couvre des périmètres qui dépassent vos habilitations."
      });
      return true;
    }
    const ligne = await pool.query("SELECT data FROM platform_records WHERE store_name='settings' AND record_id='global' AND deleted=FALSE LIMIT 1");
    const charge = (() => {
      const octets = effectiveOperationalMap(ligne.rows[0]?.data);
      return octets ? { mapImageRef: mapImageFingerprint(octets), mapImageUrl: octets } : null;
    })();
    if (!charge) { json(res, 404, { error: 'NO_MAP_IMAGE' }); return true; }
    json(res, 200, charge);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/sync') {
    const result = await pool.query('SELECT store_name,record_id,data,deleted,updated_at FROM platform_records ORDER BY store_name,record_id');
    const data = {}; const deleted = [];
    for (const row of result.rows) {
      if (!SYNC_STORES.has(row.store_name)) continue;
      if (row.deleted) continue;
      if (row.store_name === 'users') {
        if (!seesEverything(user.role)) continue;
      } else if (!await access.canAccessRecord(user, row.store_name, row.data, 'read')) {
        continue;
      }
      let safe = sanitizeForSync(user, row.store_name, row.data);
      if (safe) {
        safe = await redactCrossZoneRelations(user, row.store_name, safe);
        // La capacité se pose APRÈS la rédaction — elle décrit ce que l'utilisateur peut
        // faire de ce qu'il vient de recevoir — et pour TOUS les rôles : la rédaction, elle,
        // court-circuite les rôles globaux, qui ont pourtant besoin de la même réponse.
        safe = await attachRouteAccess(user, row.store_name, safe, row.data);
        (data[row.store_name] ||= []).push(safe);
      }
    }
    const initialized = result.rows.some(row => !row.deleted && !(row.store_name === 'users' && String(row.record_id) === '1'));
    json(res, 200, {
      initialized,
      data,
      deleted,
      authoritativeStores: [...SYNC_STORES],
      access: await access.contextFor(user),
      serverTime: new Date().toISOString()
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/bootstrap') {
    if (!isPlatformAdmin(user.role)) { json(res, 403, { error: 'FORBIDDEN' }); return true; }
    const body = await readJson(req);
    if (Array.isArray(body.data?.docs) && body.data.docs.some(record => record?.id == null || record.id === '')) {
      json(res, 400, { error:'INVALID_BOOTSTRAP_DOCUMENT', message:'Chaque document importé doit posséder un identifiant stable.' }); return true;
    }
    const bootstrapDocs = new Map((body.data?.docs || []).filter(record => record?.id != null).map(record => [String(record.id), record]));
    const normalizedDocs = [];
    const bootstrapStores = new Map(Object.entries(body.data || {}).map(([storeName, records]) => [
      storeName,
      new Map((Array.isArray(records) ? records : []).filter(item => item?.id != null).map(item => [String(item.id), item]))
    ]));
    const bootstrapDocumentLookup = async id => bootstrapDocs.get(String(id)) || await access.get('docs', id);
    const bootstrapResourceLookup = async (storeName, id) => bootstrapStores.get(storeName)?.get(String(id)) || await access.get(storeName, id);
    for (const record of bootstrapDocs.values()) normalizedDocs.push(await normalizeIncomingDocument(
      record, await access.get('docs', record.id), user, bootstrapDocumentLookup, bootstrapResourceLookup
    ));
    if (body.data?.docs) body.data.docs = normalizedDocs;
    if (Array.isArray(body.data?.equipments)) {
      try {
        body.data.equipments = body.data.equipments.map(normalizeIncomingEquipment);
        /*
         * L'IMPORT DÉRIVE LA SALLE DE LA BAIE, IL NE LA CROIT PAS.
         *
         * Cette porte ne vérifiait que la connaissance et la connectivité : une sauvegarde
         * ancienne, ou un fichier retouché à la main, pouvait donc réintroduire en une seule
         * requête toutes les contradictions salle/baie que l'écriture unitaire refuse depuis
         * longtemps. Restaurer devenait un moyen de contourner l'invariant.
         *
         * On dérive plutôt que de refuser : la salle d'une baie connue n'est pas ambiguë, et
         * rejeter une restauration entière pour une salle recalculable la rendrait
         * impossible. Ce qui reste vraiment ambigu — baie introuvable, salle inexistante —
         * est refusé juste après par `assertEquipmentLocationExists`, qui ne devine rien.
         */
        for (const [index, record] of body.data.equipments.entries()) {
          if (record?.baieId == null || record.baieId === '') continue;
          const baie = await bootstrapResourceLookup('baies', record.baieId);
          body.data.equipments[index] = applyBaieLocation(record, baie);
        }
        for (const record of body.data.equipments) await assertEquipmentLocationExists(record, bootstrapResourceLookup);
      }
      catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_EQUIPMENT_CONNECTIVITY', message:error.message, details:error.details || [] }); return true; }
    }
    if (Array.isArray(body.data?.screens)) {
      try { body.data.screens = body.data.screens.map(normalizeIncomingScreen); }
      catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_SCREEN_CONNECTIVITY', message:error.message, details:error.details || [] }); return true; }
    }
    if (Array.isArray(body.data?.cables)) {
      const equipmentMap = new Map((body.data.equipments || []).map(record => [String(record.id), record]));
      const screenMap = new Map((body.data.screens || []).map(record => [String(record.id), record]));
      const lookup = async (store, id) => (store === 'equipments' ? equipmentMap : screenMap).get(String(id)) || await access.get(store, id);
      const occupiedPorts = new Map();
      const normalizedCables = [];
      for (const record of body.data.cables) {
        try {
          normalizedCables.push(await normalizeIncomingCable(record, record.id, { lookup, occupiedPorts }));
        } catch (error) {
          // A legacy conflict must not poison the complete bootstrap. Preserve it
          // as inactive evidence, make the integrity issue explicit, and require
          // a deliberate correction before it can become an active connection.
          normalizedCables.push(quarantineLegacyCable(record, error));
        }
      }
      body.data.cables = normalizedCables;
    }
    /*
     * Ce que les salles importées disent du responsable, comparé à ce que la base dit
     * DÉJÀ — capturé avant la moindre écriture, puisque l'amorçage écrase.
     */
    /*
     * LES RÉFÉRENCES DE RESPONSABLE SONT VALIDÉES AVANT LE PREMIER `COMMIT`.
     *
     * La canonisation des responsables importés s'exécute APRÈS `ensureModel()`, donc après
     * que les données d'amorçage sont durables. Une référence morte — un `responsibleId`
     * pointant vers un compte absent du fichier ET de la base, ou portant un rôle que
     * `roles.js` ne connaît pas — ferait donc échouer la réconciliation sur un import déjà
     * validé, et laisserait une salle nommant quelqu'un sans autorité.
     *
     * On refuse ici, avant toute écriture. Le compte est cherché d'abord dans le FICHIER —
     * un amorçage légitime apporte ses utilisateurs et ses salles dans la même charge — puis
     * en base.
     */
    const utilisateursImportes = new Map((Array.isArray(body.data?.users) ? body.data.users : [])
      .filter(item => item?.id !== undefined && item?.id !== null)
      .map(item => [String(item.id), item]));
    const aReconcilierApresAmorcage = [];
    for (const salleImportee of (Array.isArray(body.data?.rooms) ? body.data.rooms : [])) {
      const roomId = salleImportee?.id === undefined || salleImportee?.id === null ? '' : String(salleImportee.id);
      if (!roomId) continue;
      const existante = await access.get('rooms', roomId);
      const avant = existante?.responsibleId ?? '';
      const declare = salleImportee?.responsibleId;
      if (declare !== undefined && declare !== null && String(declare) !== '') {
        const reference = String(declare);
        const compte = utilisateursImportes.get(reference) || await access.get('users', reference);
        if (!compte) {
          json(res, 400, {
            error: 'RESPONSIBLE_USER_NOT_FOUND',
            message: `La salle « ${salleImportee.name || roomId} » désigne un responsable introuvable : « ${reference} ».`
          }); return true;
        }
        if (!resolveKnownRole(compte.role)) {
          json(res, 409, {
            error: ROLE_ERRORS.INVALID_ROLE,
            message: `Le responsable « ${reference} » porte un rôle inconnu : « ${String(compte.role)} ». Corrigez le compte avant d'importer.`
          }); return true;
        }
      }
      if (!avant && !declare) continue;
      aReconcilierApresAmorcage.push({
        roomId, previousResponsibleId: avant,
        previousZoneIds: await access.zonesForRoom(roomId)
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [storeName, records] of Object.entries(body.data || {})) {
        if (!SYNC_STORES.has(storeName) || !Array.isArray(records)) continue;
        for (const sourceRecord of records) {
          if (sourceRecord?.id === undefined || sourceRecord?.id === null) continue;
          let record = { ...sourceRecord };
          // Préférences de poste et cache local du plan : ils n'ont rien à faire au centre.
          if (storeName === 'settings' && ['current-room', 'map-image-cache'].includes(String(record.id))) continue;
          if (storeName === 'users') {
            record.username = String(record.username || '').trim();
            if (!record.username) continue;
            if (normalizeUsername(record.username) === 'admin' && String(record.id) !== '1') continue;
            const conflictId = await usernameConflict(client, record.username, record.id);
            if (conflictId) continue;
            const existingResult = await client.query("SELECT data FROM platform_records WHERE store_name='users' AND record_id=$1 LIMIT 1", [String(record.id)]);
            const existing = existingResult.rows[0]?.data || {};
            record = { ...existing, ...record };
            if (record.password) {
              let plain = '';
              try { plain = Buffer.from(String(record.password), 'base64').toString('utf8'); } catch {}
              // Même politique que le formulaire, appliquée ici parce que le serveur est
              // l'autorité : un contrôle qui ne vivrait que dans le navigateur serait
              // contourné par n'importe quel appel direct à l'API.
              if (plain) {
                const evaluation = evaluatePassword(plain, { username:record.username, fullName:record.fullName });
                if (!evaluation.valide) {
                  json(res, 400, { error:'WEAK_PASSWORD', message:passwordRejectionMessage(evaluation), details:evaluation.problemes });
                  return true;
                }
                record.passwordHash = hashPassword(plain);
                record.passwordScheme = 'scrypt-v1';
              }
            }
            delete record.password;
            record.authVersion = Math.max(1, Number(existing.authVersion || record.authVersion || 1));
            if (String(record.id) === '1') { record.role = 'admin'; record.status = 'active'; }
          }
          if (storeName === 'equipments') {
            record = normalizeIncomingEquipment(record);
          }
          // Amorçage : une décision sur un ensemble, donc `force`. Le compteur avance
          // quand même — un amorçage qui le remettrait à zéro ferait redevenir « à jour »
          // une session ouverte avant lui.
          await compareAndWrite(pool, {
            storeName, recordId: String(record.id), record, force: true, client
          });
        }
      }
      await client.query('COMMIT');
      await access.ensureModel();
      /*
       * R8 — L'AMORÇAGE CANONISE LES RESPONSABLES QU'IL IMPORTE.
       *
       * MESURÉ : un amorçage portant `room.responsibleId` écrivait le champ et ne créait
       * aucune autorité — `ensureModel()` ne le fait plus, et c'est voulu. Le résultat
       * était la même incohérence que par le dépôt : la salle nomme quelqu'un que les
       * habilitations ignorent.
       *
       * CE N'EST PAS UN RETOUR À L'ANCIEN COMPORTEMENT. L'ancien octroyait au DÉMARRAGE,
       * sans acteur, sans plafond et sans trace. Ici l'acte appartient à l'administrateur
       * qui a lancé l'amorçage — la route est déjà `isPlatformAdmin` — et il passe par le
       * chemin canonique : plafonds de rôle, provenance, une entrée d'audit par octroi.
       *
       * Après `ensureModel()`, parce que c'est lui qui garantit à chaque salle son
       * rattachement : réconcilier avant laisserait une salle neuve sans zone, donc
       * refusée par la garde de fermeture.
       */
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    if (aReconcilierApresAmorcage.length) {
      // Transaction PROPRE : celle de l'amorçage est déjà validée, et un `ROLLBACK` sur
      // elle ne défairait rien tout en masquant l'erreur réelle.
      const reconciliation = await pool.connect();
      try {
        await reconciliation.query('BEGIN');
        await access.reconcileRoomsResponsible(user, aReconcilierApresAmorcage, reconciliation);
        await reconciliation.query('COMMIT');
      } catch (error) {
        await reconciliation.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { reconciliation.release(); }
    }
    json(res, 200, { ok: true, message: 'Données locales transférées vers la base centrale.' }); return true;
  }

  const dataMatch = url.pathname.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
  if (dataMatch) {
    const storeName = decodeURIComponent(dataMatch[1]); const recordId = decodeURIComponent(dataMatch[2]);
    if (!SYNC_STORES.has(storeName)) { json(res, 400, { error: 'INVALID_STORE' }); return true; }
    if (!canWriteByRole(user, storeName)) { json(res, 403, { error: 'FORBIDDEN', message: 'Action non autorisée pour ce rôle.' }); return true; }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      let record = { ...body, id: body.id ?? coerceId(recordId) };
      // Posé par la garde `responsibleId` plus bas, relu par la transaction d'écriture :
      // l'autorité ne se pose qu'une fois la salle réellement écrite.
      let changeLeResponsable = false;
      const existing = await access.get(storeName, recordId);
      if (storeName === 'tickets') {
        json(res, 409, { error: 'DEDICATED_REQUEST_ENDPOINT', message: 'Créez et traitez les demandes depuis le workflow Tickets afin que leur auteur, leur destination et leur historique restent validés par le serveur.' }); return true;
      }
      if (storeName === 'settings' && ['current-room', 'map-image-cache'].includes(String(recordId))) {
        json(res, 400, { error: 'LOCAL_PREFERENCE', message: 'La salle courante est une préférence locale et ne doit pas être synchronisée.' }); return true;
      }
      /*
       * L'IMMUABILITÉ DU JOURNAL SE DÉCIDE AVANT TOUTE QUESTION DE RÔLE OU DE ZONE.
       *
       * Elle vivait plus bas, APRÈS la garde de zone. Conséquence mesurée sur `6c3e766` :
       * une même tentative de réécriture recevait trois réponses différentes selon qui la
       * faisait — `LOG_IMMUTABLE` pour l'administrateur, `ZONE_FORBIDDEN` pour le manager,
       * le chef, le responsable et le technicien, `FORBIDDEN` pour le visiteur. Trois codes
       * pour une seule règle, et deux d'entre eux désignent une cause qui n'est pas la
       * bonne : ce n'est pas la zone qui interdit, c'est la nature du journal.
       *
       * Remontée ici, la règle est énoncée une fois, pour tout le monde, et elle ne dépend
       * plus de l'ordre dans lequel les gardes se présentent. `existing` est une lecture
       * non filtrée par le périmètre : l'entrée existe ou elle n'existe pas.
       */
      if (storeName === 'logs' && existing) {
        json(res, 403, {
          error: 'LOG_IMMUTABLE',
          message: "Le journal ne se modifie pas : une trace déjà enregistrée est définitive."
        }); return true;
      }
      /*
       * `scope:'catalog'` + un attachement opérationnel EST UNE CONTRADICTION (#118).
       *
       * Rien ne la strippe en silence : un enregistrement qui affirme être un catalogue
       * global tout en désignant un écran, un groupe ou une salle réels changerait de sens
       * sans que personne ne l'ait demandé si le champ contradictoire disparaissait
       * discrètement. Le serveur refuse l'écriture ENTIÈRE, avant toute question de rôle ou
       * de zone : rien n'est persisté, rien ne part en synchronisation.
       */
      if (storeName === 'screen_issues' && isContradictoryCatalogWrite(record)) {
        json(res, 400, {
          error: 'INVALID_CATALOG_DEFINITION',
          message: "Une définition de catalogue ne peut pas désigner un écran, un groupe ou une salle : cela la rendrait globalement lisible avec des identifiants opérationnels."
        }); return true;
      }
      /*
       * TOUTE NOUVELLE ÉCRITURE PORTE UNE CLASSIFICATION EXPLICITE (#150, blocker 2).
       *
       * Le repli historique de lecture — `appliesToAll===true`, aucun attachement, `scope`
       * absent — n'était censé s'appliquer QU'aux enregistrements déjà persistés avant ce
       * contrat. Rien n'empêchait pourtant un écrivain autorisé d'en CRÉER un nouveau dans
       * exactement cette forme : il traversait alors la même porte de lecture globale sans
       * jamais avoir été validé. « Repli — lecture seule » n'était donc vrai qu'en
       * intention, pas en application.
       *
       * Une CRÉATION exige donc un `scope` explicite et connu — le client de la plateforme
       * le fournit déjà systématiquement (`screens-diagnostic.js`), fermer ce chemin ne lui
       * coûte rien. Une MISE À JOUR d'un enregistrement déjà existant reste possible sans le
       * fournir — un ancien écrivain n'a pas à apprendre ce champ pour continuer à
       * fonctionner — mais le serveur normalise alors la valeur que la LECTURE aurait de
       * toute façon déduite : jamais plus permissif que `isCatalogDefinition`, jamais
       * `catalog` par défaut.
       */
      if (storeName === 'screen_issues') {
        const SCREEN_ISSUE_SCOPES = new Set(['catalog', 'operational']);
        if (record.scope !== undefined && !SCREEN_ISSUE_SCOPES.has(record.scope)) {
          json(res, 400, {
            error: 'INVALID_SCREEN_ISSUE_SCOPE',
            message: "scope doit valoir 'catalog' ou 'operational'."
          }); return true;
        }
        if (record.scope === undefined) {
          if (!existing) {
            json(res, 400, {
              error: 'INVALID_SCREEN_ISSUE_SCOPE',
              message: "Une nouvelle définition doit préciser scope:'catalog' ou scope:'operational'."
            }); return true;
          }
          record.scope = (!hasOperationalAttachment(record) && record.appliesToAll === true) ? 'catalog' : 'operational';
        }
      }
      if (storeName === 'users') {
        // Nul ne modifie son propre rôle ni son propre statut, dans aucun sens. La raison
        // est mécanique autant que prudentielle : un changement de rôle incrémente
        // `authVersion`, ce qui invalide la session de l'acteur au milieu de sa propre
        // requête — l'administrateur était déconnecté par sa propre modification, ce qui
        // se présentait comme un plantage plutôt que comme un refus.
        if (String(recordId) === String(user.id) && existing) {
          const changesRole = body.role !== undefined && String(body.role) !== String(existing.role || '');
          const changesStatus = body.status !== undefined && String(body.status) !== String(existing.status || '');
          if (changesRole || changesStatus) {
            json(res, 409, {
              error: 'SELF_ROLE_CHANGE_FORBIDDEN',
              message: "Vous ne pouvez pas modifier votre propre rôle ni votre propre statut. Demandez-le à un autre administrateur."
            }); return true;
          }
        }
        // Autorité hiérarchique : sur CE compte, et sur le rôle demandé.
        try { assertUserHierarchy(user, existing, body.role); }
        catch (error) { json(res, error.status || 403, { error: error.code, message: error.message }); return true; }
        try { record = await normalizeIncomingUser(recordId, body); }
        catch (error) { json(res, error.status || 400, { error: error.code || 'INVALID_USER', message: error.message }); return true; }
        const conflictId = await usernameConflict(pool, record.username, recordId);
        if (conflictId) { json(res, 409, { error: 'USERNAME_EXISTS', message: "Ce nom d'utilisateur est déjà utilisé." }); return true; }
      } else {
        // La zone d'une salle qu'on CRÉE est un argument de création : elle ne peut se
        // déduire de rien, puisque la salle n'existe pas encore. Sans elle, la garde de
        // zone refusait avec « Vous devez être autorisé dans toutes les zones », un message
        // qui ne nomme ni la zone manquante ni ce qu'il faut faire. On le dit ici, avant
        // toute lecture de base, et donc sans rien révéler des zones à qui n'y a pas accès.
        let creationDeSalle = null;
        try { creationDeSalle = await access.authorizeRoomCreation(user, storeName, record, existing); }
        catch (error) { json(res, error.status || 400, { error: error.code, message: error.message }); return true; }
        // Une salle ne garde JAMAIS sa zone en propre : `resource_zones` la porte seul. À la
        // création, le champ est un argument déjà consommé ci-dessus ; à la modification,
        // le laisser passer rouvrirait la double source — un export JSON réimporté suffirait
        // à réécrire une zone périmée dans l'enregistrement.
        if (storeName === 'rooms' && (record.zoneId !== undefined || record.zoneIds !== undefined)) {
          const demandee = [...(Array.isArray(record.zoneIds) ? record.zoneIds : []), record.zoneId]
            .filter(value => value !== null && value !== undefined && value !== '').map(String);
          if (existing) {
            const actuelles = await access.zonesForRoom(recordId);
            const deplace = demandee.some(zoneId => !actuelles.includes(zoneId));
            if (deplace) {
              json(res, 409, {
                error: 'ROOM_ZONE_REMAP_ENDPOINT',
                message: "Déplacer une salle vers une autre zone se fait depuis la gestion des accès, pas en modifiant la salle."
              }); return true;
            }
          }
          const { zoneId: _zoneArgument, zoneIds: _zonesArgument, ...sansZone } = record;
          record = creationDeSalle ? record : sansZone;
        }

        /*
         * `responsibleId` EST UN ACTE D'AUTORISATION, PAS UN CHAMP DE FICHE (A-1).
         *
         * MESURÉ au commit a3e2dd0, sur PostgreSQL réel : le PUT dépouillait `zoneId` et
         * `zoneIds` — juste au-dessus — mais laissait passer `responsibleId` sans le
         * moindre contrôle (`grep -c responsibleId scripts/serve.js` → 0). Un chef ne
         * détenant que `room.edit` l'écrivait sur sa propre salle et récoltait, au
         * redémarrage suivant, 23 habilitations qu'aucun administrateur n'avait accordées,
         * imputées à l'administrateur global et absentes de `access_audit`.
         *
         * Le champ est désormais gouverné par la MÊME règle que nommer un responsable de
         * zone, et l'autorité qu'il induit est posée par le chemin canonique, dans la même
         * transaction que l'écriture de la salle. Le serveur tranche : aucun écran n'est
         * en mesure de garantir cela, et deux des quatre écrans qui écrivent ce champ ne
         * le contrôlaient pas du tout.
         */
        // R9 — l'omission préserve. Posée AVANT la garde, pour que la comparaison et
        // l'écriture lisent exactement la même fiche.
        record = access.normalizeRoomResponsible(storeName, record, existing);
        try { changeLeResponsable = access.assertResponsibleAssignment(user, storeName, record, existing); }
        catch (error) { json(res, error.status || 403, { error: error.code, message: error.message }); return true; }
        if (existing && !access.roleAllowsStoreAction(user, storeName, 'update')) { refusDeRole(res, 'update'); return true; }
        /*
         * LE PLAFOND DE RÔLE, EN CRÉATION, AUSSI TÔT QU'EN MODIFICATION.
         *
         * MESURÉ : cette garde n'existait qu'au-dessus, `existing &&`-conditionnée. Une
         * CRÉATION (`existing` absent) filait donc directement dans les blocs propres à
         * chaque magasin — `normalizeIncomingCable` puis `resolveIncomingCableRoute` pour
         * les câbles — et le seul plafond de rôle pour `create` arrivait plus bas, une fois
         * ces blocs déjà exécutés. Un technicien (plafond canonique : `equipments.create`
         * FAUX) pouvait ainsi soumettre un câble tout neuf portant un tracé, et apprendre —
         * à la seule différence entre 400 `ROUTE_SCENE_INVALID` et 403
         * `ROUTE_SCENE_EDIT_FORBIDDEN` — si une salle ou une baie qu'il ne peut pas
         * consulter EXISTE, avant même d'être refusé pour son rôle. La modification, elle,
         * était déjà protégée par la ligne au-dessus : seule la création manquait sa moitié.
         */
        if (!existing && !access.roleAllowsStoreAction(user, storeName, 'create')) { refusDeRole(res, 'create'); return true; }
        if (!isPlatformAdmin(user.role) && existing && !await access.canAccessRecord(user, storeName, existing, 'update')) {
          if (storeName === 'docs') {
            json(res, 404, { error:'DOCUMENT_NOT_FOUND', message:'Document introuvable ou indisponible dans votre périmètre.' }); return true;
          }
          json(res, 403, { error: 'ZONE_FORBIDDEN', message: "Vous devez être autorisé dans toutes les zones avant la modification." }); return true;
        }
        /*
         * CE QU'ON RETIRE EN SORTIE, ON LE PRÉSERVE EN ENTRÉE.
         *
         * `stripMapImagePayload` retire `mapImageUrl` de l'instantané : aucun poste ne le
         * reçoit donc plus, et aucun ne peut le renvoyer. Or `savePlatformSettings`
         * réenvoie la fiche entière à chaque enregistrement — thème, délai de déconnexion,
         * notifications. Sans cette règle, le premier « Enregistrer » venu remplaçait la
         * source du plan par le désignateur par défaut, et un plan téléversé ou une URL
         * distante configurée par l'administrateur étaient PERDUS, en silence.
         *
         * Une omission n'est donc pas une intention d'effacer : elle veut dire « je ne sais
         * pas », et la valeur du serveur fait foi. Modifier le plan reste possible — il
         * suffit d'envoyer le champ, ce que fait l'écran des réglages quand l'administrateur
         * agit vraiment sur le plan.
         */
        if (storeName === 'settings' && String(recordId) === 'global'
            && record?.mapImageUrl === undefined && existing?.mapImageUrl !== undefined) {
          record = { ...record, mapImageUrl: existing.mapImageUrl };
        }
        if (storeName === 'equipments') {
          try {
            record = normalizeIncomingEquipment(record);
            await assertEquipmentLocationExists(record);
            await ensureEquipmentConnectivityRetention(existing, record, user);
          }
          catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_EQUIPMENT_CONNECTIVITY', message:error.message, details:error.details || [] }); return true; }
        }
        if (storeName === 'screens') {
          try { record = normalizeIncomingScreen(record); }
          catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_SCREEN_CONNECTIVITY', message:error.message, details:error.details || [] }); return true; }
        }
        if (storeName === 'screen_groups') {
          try { record = await assertScreenGroupScope(record, existing); }
          catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_SCREEN_GROUP_SCOPE', message:error.message, details:error.details || [] }); return true; }
        }
        // Le journal est une preuve de ce qu'un utilisateur a fait : son auteur ne peut pas
        // être déclaré par le client. Le client fournissait `username` librement, donc une
        // entrée pouvait être attribuée à n'importe qui. L'identité et l'horodatage sont
        // désormais posés ici, à partir de la session — l'écriture reste ouverte à tout
        // utilisateur authentifié, mais uniquement en son propre nom.
        if (storeName === 'logs') {
          /*
           * L'IDENTITÉ ET LA DATE SONT POSÉES ICI, JAMAIS DÉCLARÉES PAR LE CLIENT.
           *
           * L'immuabilité est déjà tranchée plus haut ; il ne reste que l'estampille. Trois
           * défauts mesurés sur `6c3e766`, et chacun laissait passer quelque chose :
           *
           *   · `fullName: user.fullName || record.fullName || ''` — le repli sur la valeur
           *     CLIENT. Un compte au `fullName` vide envoyait « Direction Générale » et
           *     l'entrée le portait. Le champ le plus lu d'un journal était donc le seul
           *     que son auteur pouvait choisir.
           *   · `timestamp` en chaîne ISO, alors que `logs.js` trie par
           *     `b.timestamp - a.timestamp` : la soustraction de deux chaînes vaut `NaN`,
           *     le tri ne trie plus, et le journal s'affiche dans un ordre arbitraire.
           *     Le timestamp canonique est un NOMBRE de millisecondes.
           *   · `dateStr` n'était pas réécrit du tout : la valeur client survivait telle
           *     quelle. Une entrée datée « 01/01/2000 » à l'écran, horodatée aujourd'hui
           *     en base — l'affichage et la preuve se contredisaient.
           *
           * UN SEUL INSTANT pour les trois valeurs : deux appels à `new Date()` pouvaient
           * différer d'une milliseconde, et une preuve dont les dates ne concordent pas
           * entre elles se conteste.
           */
          const maintenant = new Date();
          record = {
            ...record,
            userId: user.id,
            username: user.username,
            fullName: user.fullName || '',
            timestamp: maintenant.getTime(),
            dateStr: maintenant.toLocaleString('fr-FR'),
            serverReceivedAt: maintenant.toISOString()
          };
        }
        if (storeName === 'cables') {
          try { record = await normalizeIncomingCable(record, recordId); }
          catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_CABLE', message:error.message, details:error.details || [] }); return true; }
          // Le tracé se décide APRÈS la validation de forme — il faut un enregistrement
          // canonique — et AVANT toute persistance : c'est la seule position où l'on peut
          // encore empêcher une vue partielle d'effacer les segments protégés.
          try { record = { ...record, route: await resolveIncomingCableRoute(user, record, existing) }; }
          catch (error) { json(res, error.status || 403, { error:error.code || 'ROUTE_SCOPE_INSUFFICIENT', message:error.message }); return true; }
        }
        if (storeName === 'docs') {
          try {
            await assertDocumentReferencesVisible(user, record);
            record = await normalizeIncomingDocument(record, existing, user);
          }
          catch (error) { json(res, error.status || 400, { error:error.code || 'INVALID_DOCUMENT', message:error.message, details:error.details || [] }); return true; }
        }
        if (!access.roleAllowsStoreAction(user, storeName, existing ? 'update' : 'create')) {
          refusDeRole(res, existing ? 'update' : 'create'); return true;
        }
        if (!isPlatformAdmin(user.role)) {
          const canWriteExisting = !existing || await access.canAccessRecord(user, storeName, existing, 'update');
          // Une salle QU'ON CRÉE n'a pas encore de rattachement : la garde ordinaire lui
          // demanderait une zone qu'elle ne peut pas avoir. Son autorisation vient d'être
          // décidée, plus précisément, sur la zone demandée.
          const canWriteIncoming = creationDeSalle
            ? true
            : await access.canAccessRecord(user, storeName, record, existing ? 'update' : 'create');
          if (!canWriteExisting || !canWriteIncoming) {
            json(res, 403, { error: 'ZONE_FORBIDDEN', message: "Vous devez être autorisé dans toutes les zones avant et après la modification." }); return true;
          }
        }
      }
      /*
       * L'ÉCRITURE COMPARE LA VERSION AVANT D'ÉCRASER.
       *
       * `PUT` remplaçait l'enregistrement ENTIER sans jamais comparer de version : la
       * copie périmée d'une session effaçait la modification récente d'une autre, en
       * silence, dans les deux sens. Mesuré sur six magasins, géométrie comprise.
       *
       * L'autorisation a déjà tranché ci-dessus et garde la priorité : un utilisateur
       * non autorisé reçoit un refus d'autorisation, jamais la révision d'une donnée
       * qu'il n'a pas le droit de voir.
       */
      // La révision déclarée se lit dans la CHARGE UTILE, même quand le serveur ne trouve
      // plus l'enregistrement : c'est précisément le cas d'une fiche supprimée par un autre
      // pendant qu'on l'avait ouverte. L'ignorer alors ressuscitait la fiche en silence.
      const revisionAttendue = expectedRevisionFrom(body, record);
      /*
       * L'INTENTION SE LIT DANS LA DÉCLARATION, PAS DANS UNE LECTURE HORS VERROU.
       *
       * Elle valait `existing ? 'update' : 'create'`. Or `existing` est lu AVANT le verrou :
       * sous une vraie course, le troisième écrivain lisait la fiche que le premier venait
       * de créer, se croyait en train de modifier, et recevait `STALE_WRITE` alors qu'il
       * était en train de créer. Mesuré : trois créations simultanées rendaient
       * `ALREADY_EXISTS` et `STALE_WRITE` selon l'ordre d'arrivée.
       *
       * La déclaration, elle, ne dépend d'aucune course :
       *   révision 0 déclarée  « je crois que cette fiche n'existe pas »  → création
       *   révision N déclarée  « je l'ai lue à N »                        → modification
       */
      const intention = revisionAttendue === 0 ? 'create' : 'update';

      // Une salle CRÉÉE emporte son rattachement de zone : les deux partent ensemble, ou
      // aucun des deux ne part — y compris celle qu'un rôle global crée sans nommer de
      // zone, dont la zone transitoire doit exister avant la réponse 200.
      const rattacheUneZone = storeName === 'rooms' && !existing;
      /*
       * DÉPLACER UNE BAIE DÉPLACE SES ÉQUIPEMENTS, DANS LA MÊME TRANSACTION.
       *
       * C'est le seul écrivain qui rompt `Équipement → Baie → Salle` SANS toucher au moindre
       * équipement : aucune validation d'équipement ne pouvait donc le voir. Le client
       * réalignait ensuite fiche par fiche, hors transaction — une panne au milieu laissait
       * la baie déménagée et une partie de ses équipements dans l'ancienne salle.
       *
       * La conséquence dépassait l'affichage : `resolveResourceZones` décide de la zone d'un
       * équipement à partir de son `roomId`. Une salle périmée donnait donc l'autorisation à
       * qui possédait l'ancienne salle, et la refusait à qui possède la nouvelle.
       */
      const deplaceUneBaie = storeName === 'baies' && existing
        && String(record?.roomId ?? '') !== String(existing?.roomId ?? '');
      let equipementsRealignes = [];
      let ecriture;
      if (deplaceUneBaie) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          ecriture = await compareAndWrite(pool, {
            storeName, recordId, record, expectedRevision: revisionAttendue, intent: intention, client
          });
          if (!ecriture.ok) { await client.query('ROLLBACK'); }
          else {
            const realignement = await realignEquipmentRoomsForBaie(client, {
              baieId: recordId, roomId: record?.roomId
            });
            equipementsRealignes = realignement.ids;
            await client.query('COMMIT');
          }
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          json(res, error.status || 500, {
            error: error.code || 'BAIE_MOVE_FAILED',
            message: error.message || "Le déplacement de la baie n'a pas pu être appliqué à ses équipements."
          }); return true;
        } finally { client.release(); }
      } else if (rattacheUneZone || changeLeResponsable) {
        /*
         * LA SALLE ET L'AUTORITÉ QU'ELLE INDUIT SONT ÉCRITES ENSEMBLE, OU PAS DU TOUT.
         *
         * Une assignation de responsable posée hors transaction laisserait, sur panne au
         * milieu, soit une salle qui désigne un responsable sans autorité, soit une autorité
         * sans salle qui la justifie. Le rattachement de zone précède l'assignation : sans
         * zone, il n'y a pas d'adhésion à écrire.
         */
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const aStocker = await access.attachCreationZone(user, storeName, record, existing, client);
          ecriture = await compareAndWrite(pool, {
            storeName, recordId, record: aStocker, expectedRevision: revisionAttendue,
            intent: intention, client
          });
          if (!ecriture.ok) { await client.query('ROLLBACK'); }
          else {
            if (changeLeResponsable) {
              await access.applyResponsibleAssignment(user, {
                roomId: recordId,
                responsibleId: aStocker?.responsibleId,
                previousResponsibleId: existing?.responsibleId
              }, client);
            }
            await client.query('COMMIT'); record = aStocker;
          }
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          // Le repli nomme l'acte qui a échoué : rattacher la salle, ou lui poser son
          // responsable. Un code d'erreur qui désigne le mauvais acte envoie chercher la
          // panne au mauvais endroit.
          json(res, error.status || 500, {
            error: error.code || (changeLeResponsable ? 'ROOM_RESPONSIBLE_ASSIGN_FAILED' : 'ROOM_ZONE_ATTACH_FAILED'),
            message: error.message || (changeLeResponsable
              ? "La salle n'a pas pu recevoir son responsable."
              : "La salle n'a pas pu être rattachée à sa zone.")
          }); return true;
        } finally { client.release(); }
      } else {
        ecriture = await compareAndWrite(pool, {
          storeName, recordId, record, expectedRevision: revisionAttendue, intent: intention
        });
      }

      if (!ecriture.ok) {
        json(res, 409, staleWriteResponse(ecriture.code, ecriture.currentRevision, { store: storeName, id: recordId }));
        return true;
      }
      // `withRevision` et non `{ ...record, revision }` : le compteur a son propre champ, et
      // l'écrire à la main rouvrirait la collision avec l'étiquette métier des schémas.
      record = withRevision(record, ecriture.revision);
      /*
       * L'ACCUSÉ DE RÉCEPTION PORTE LA RÉVISION — et c'est tout l'objet de #120.
       *
       * Le compteur vient d'être calculé par `compareAndWrite`, et il était jeté ici : la
       * réponse ne disait que « c'est écrit ». Le client repartait donc avec la révision
       * qu'il avait AVANT son propre succès, et sa deuxième écriture légitime se faisait
       * refuser en 409 STALE_WRITE — un conflit inventé, sans deuxième auteur.
       *
       * Ce que le refus disait déjà (`currentRevision` dans la réponse 409), le succès le
       * dit maintenant aussi. Aucune donnée métier nouvelle ne circule : un entier que
       * l'auteur de l'écriture vient lui-même de faire naître.
       *
       * `docs` continue de renvoyer sa fiche assainie : ce contrat-là ne change pas.
       */
      json(res, 200, { ok: true, id: record.id, revision: ecriture.revision, ...(storeName === 'docs' ? { record:sanitizeForSync(user, storeName, record) } : {}) }); return true;
    }

    if (req.method === 'DELETE') {
      if (storeName === 'tickets') {
        json(res, 409, { error: 'REQUEST_HISTORY_IMMUTABLE', message: 'Une demande doit être clôturée et conservée dans l’historique, pas supprimée.' }); return true;
      }
      if (storeName === 'users' && String(recordId) === '1') {
        json(res, 409, { error: 'GLOBAL_ADMIN_INVARIANT', message: "Le compte administrateur global ne peut pas être supprimé." }); return true;
      }
      if (storeName === 'users' && String(recordId) === String(user.id)) {
        json(res, 409, { error: 'CANNOT_DELETE_CURRENT_ACCOUNT', message: 'Impossible de supprimer le compte de la session active.' }); return true;
      }
      if (storeName === 'users') {
        // Même invariant qu'à l'écriture : supprimer un administrateur ne doit jamais
        // laisser la plateforme sans aucun administrateur actif.
        const target = await access.get(storeName, recordId);
        // On ne supprime que des comptes situés STRICTEMENT sous son propre rang : sans
        // cela, un chef pouvait supprimer un manager, et un manager l'administrateur.
        try { assertUserHierarchy(user, target); }
        catch (error) { json(res, error.status || 403, { error: error.code, message: error.message }); return true; }
        if (target && isPlatformAdmin(target.role)) {
          try { await assertAnotherActiveAdminExists(recordId); }
          catch (error) { json(res, error.status || 409, { error: error.code, message: error.message }); return true; }
        }
      }
      const existing = storeName === 'users' ? null : await access.get(storeName, recordId);
      if (storeName !== 'users' && !access.roleAllowsStoreAction(user, storeName, 'delete')) {
        refusDeRole(res, 'delete'); return true;
      }
      if (!isPlatformAdmin(user.role) && storeName !== 'users') {
        if (!existing || !await access.canAccessRecord(user, storeName, existing, 'delete')) {
          json(res, 403, { error: 'ZONE_FORBIDDEN', message: "Vous n'avez pas l'autorisation de supprimer cette ressource dans cette zone." }); return true;
        }
      }
      if (storeName === 'docs') {
        try { await ensureDocumentDeletable(existing); }
        catch (error) { json(res, error.status || 409, { error:error.code || 'DOCUMENT_DEPENDENCY', message:error.message }); return true; }
      } else if (storeName !== 'users') {
        try { await ensureResourceDeletable(storeName, existing, user); }
        catch (error) { json(res, error.status || 409, { error:error.code || 'RESOURCE_DEPENDENCY', message:error.message }); return true; }
      }
      /*
       * DEUX SUPPRESSIONS, ET L'API LES DISTINGUE PAR UNE DÉCLARATION EXPLICITE.
       *
       *   AVEC `expectedRevision`   la suppression part d'une fiche qu'on avait sous les
       *     yeux. Si un autre l'a modifiée depuis, l'appliquer effacerait son travail —
       *     davantage même qu'une écriture périmée. On compare, et on refuse.
       *
       *   SANS `expectedRevision`   suppression INCONDITIONNELLE. Elle ne se compare à
       *     rien et emporte tout ce qui a pu être écrit depuis. C'est une opération
       *     d'administration — nettoyage, remplacement d'inventaire, réparation — et non
       *     ce qu'un écran fait en réponse à un clic.
       *
       * Aucun chemin du navigateur n'emprunte plus le second : `pushDelete` déclare
       * TOUJOURS la révision qu'il a lue, y compris quand elle vaut 0. « Paramètre oublié
       * = suppression forcée » n'est donc plus un piège qu'un écran puisse déclencher par
       * distraction — c'est un choix qu'il faut poser en toutes lettres dans l'URL.
       *
       * ABSENT et ZÉRO ne sont pas la même chose : `Number(null)` vaut 0, et les confondre
       * transformerait toute suppression inconditionnelle en conflit contre la révision 0.
       */
      const revisionSupprimeeBrute = url.searchParams.get('expectedRevision');
      const revisionSupprimee = Number(revisionSupprimeeBrute);
      const revisionDeclaree = revisionSupprimeeBrute !== null && revisionSupprimeeBrute !== ''
        && Number.isSafeInteger(revisionSupprimee) && revisionSupprimee >= 0
        ? revisionSupprimee : null;
      const suppressionInconditionnelle = revisionDeclaree === null;
      const attendueSuppression = suppressionInconditionnelle ? null : revisionDeclaree;
      if (suppressionInconditionnelle) {
        // Tracée, parce qu'elle n'a pas de garde : c'est la seule façon de savoir après coup
        // qu'une donnée récente a pu disparaître sans que personne ne soit prévenu.
        await access.audit({
          actorId: user.id, action: 'data.delete-unconditional',
          after: { store: storeName, id: recordId }
        }).catch(() => {});
      }
      // Supprimer une salle emporte son rattachement, dans la même transaction.
      //
      // `resource_zones` est indexé par `resourceId`. Laissé derrière, le rattachement
      // rendait la zone de l'ancienne salle à toute salle recréée sous le même identifiant :
      // un accès que personne n'avait accordé, à des données sans rapport. Maintenant que ce
      // magasin est la source de vérité de la zone, la fuite est fermée.
      if (storeName === 'rooms') {
        // Les zones de la salle AVANT toute écriture : après la pierre tombale et le
        // détachement, plus rien ne dirait dans quelle zone révoquer.
        const zonesAvantSuppression = await access.zonesForRoom(recordId);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const suppression = await tombstoneWithRevision(pool, {
            storeName, recordId, expectedRevision: attendueSuppression, client
          });
          if (!suppression.ok) {
            await client.query('ROLLBACK');
            json(res, 409, staleWriteResponse(suppression.code, suppression.currentRevision, { store: storeName, id: recordId }));
            return true;
          }
          /*
           * R5 — UNE SALLE SUPPRIMÉE NE JUSTIFIE PLUS AUCUNE AUTORITÉ.
           *
           * MESURÉ : après la suppression de la DERNIÈRE salle qui nommait un responsable,
           * son adhésion `responsible` et ses 24 habilitations restaient actives. La salle
           * n'existait plus, l'autorité qu'elle avait créée survivait — et plus rien ne
           * pouvait la retirer par le chemin normal, puisque ce chemin passe par la salle.
           *
           * L'ORDRE COMPTE, et il est celui-ci :
           *   1. la pierre tombale — la salle cesse de compter dans le décompte ;
           *   2. la réconciliation — les zones d'avant sont passées explicitement, donc
           *      lisibles même si le rattachement a déjà disparu ;
           *   3. le détachement des zones.
           * Réconcilier avant la pierre tombale laisserait la salle se justifier elle-même.
           */
          await access.reconcileRoomResponsible(user, {
            roomId: recordId,
            previousResponsibleId: existing?.responsibleId ?? '',
            previousZoneIds: zonesAvantSuppression
          }, client);
          await access.detachRoomZones(user, recordId, client);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          json(res, error.status || 500, {
            error: error.code || 'ROOM_DELETE_FAILED',
            message: error.message || "La salle n'a pas pu être supprimée."
          }); return true;
        } finally { client.release(); }
        json(res, 200, { ok: true }); return true;
      }
      const suppression = await tombstoneWithRevision(pool, { storeName, recordId, expectedRevision: attendueSuppression });
      if (!suppression.ok) {
        json(res, 409, staleWriteResponse(suppression.code, suppression.currentRevision, { store: storeName, id: recordId }));
        return true;
      }
      json(res, 200, { ok: true }); return true;
    }
  }

  json(res, 404, { error: 'API_NOT_FOUND' }); return true;
}

function isPrivateStaticPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent((urlPath || '/').split('?')[0]); }
  catch { return true; }
  const segments = decoded.replaceAll('\\', '/').split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.') || PRIVATE_PREFIXES.has(segment))) return true;
  if (segments.length === 1 && PRIVATE_FILES.has(segments[0])) return true;
  if (segments.some(segment => segment.toLowerCase().endsWith('.md'))) return true;
  /*
   * LE PLAN OPÉRATIONNEL N'EST PAS UN ACTIF STATIQUE.
   *
   * `assets/plan-technique.PNG` dessine RF1, RF2, l'acquisition, les salles serveurs et
   * STC, avec les portes et les circulations. Il était servi comme une feuille de style :
   * sans session, à qui le demandait, et le Service Worker le mettait en cache d'avance.
   * Mesuré sur la base : 46 276 octets rendus à un client NON AUTHENTIFIÉ.
   *
   * La fermeture est CIBLÉE — ce fichier, ses deux casses, et rien d'autre du dossier
   * `assets`. Les octets restent disponibles, mais par `/api/settings/map-image`, qui
   * demande au moteur d'accès s'ils sont dus.
   */
  /*
   * LE RÉPERTOIRE DES DONNÉES OPÉRATIONNELLES PRIVÉES, EN ENTIER (A-5).
   *
   * Il est déjà couvert par le préfixe `scripts`, et c'est ce qui le protège aujourd'hui.
   * Mais cette protection est INCIDENTE : elle tient à l'endroit où le dossier se trouve,
   * pas à ce qu'il contient. Le jour où il déménage — ou qu'un second jeu de données naît
   * ailleurs — la garde tomberait sans que personne ne s'en aperçoive.
   *
   * La règle suit donc le NOM DU RÉPERTOIRE, à n'importe quelle profondeur, et vaut pour
   * tout ce qu'il contient, quel que soit le nom ou l'extension du fichier.
   */
  if (segments.includes(PRIVATE_OPERATIONAL_DIR)) return true;
  if (isOperationalMapAsset(decoded)) return true;
  /*
   * LES PREUVES TERRAIN NE SONT PAS DES ACTIFS STATIQUES (#78, Phase 0).
   *
   * `assets/field-evidence/**` portait le pack binaire, les fragments `.b64` et les images
   * `.webp` — servis avec `Cache-Control: public, max-age=3600` à qui les demandait, sans
   * session, et précachés d'avance par le Service Worker. La fermeture porte sur le SOUS-ARBRE
   * entier, pas sur une liste de trois noms de fichier : tout ce qui vit sous
   * `assets/field-evidence/` est privé, quel que soit son nom exact ou une extension future.
   *
   * Aucun contrat d'autorisation correct n'existe encore pour ces octets — ni zone, ni
   * ressource, ni rôle ne les couvre aujourd'hui. La Phase 1 de #78 pose ce contrat ; la
   * Phase 0 se contente de fermer la porte, quitte à rendre la fonctionnalité
   * temporairement indisponible plutôt que d'inventer une autorisation approximative.
   */
  if (segments[0]?.toLowerCase() === 'assets' && segments[1]?.toLowerCase() === 'field-evidence') return true;
  return false;
}

function resolveRequestPath(urlPath) {
  if (isPrivateStaticPath(urlPath)) return null;
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = join(root, relative || 'index.html');
  if (!candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`) && candidate !== join(root, 'index.html')) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html');
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (!extname(relative)) return join(root, 'index.html');
  return candidate;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (await handleApi(req, res, url)) return;

    const filePath = resolveRequestPath(url.pathname);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end('Fichier introuvable'); return;
    }
    const extension = extname(filePath).toLowerCase();
    const isServiceWorker = filePath === join(root, 'service-worker.js');
    res.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' || isServiceWorker ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Erreur serveur:', error?.message || error);
    if (!res.headersSent) json(res, error.status || 500, { error: 'SERVER_ERROR', message: error.message || 'Erreur interne du serveur' });
    else res.end();
  }
});

server.listen(port, host, () => console.log(`2M TECH Platform disponible sur http://${host}:${port} · central=${Boolean(pool)}`));

async function shutdown(signal) {
  console.log(`${signal} reçu, arrêt du serveur...`);
  server.close(async () => { try { await pool?.end(); } finally { process.exit(0); } });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
