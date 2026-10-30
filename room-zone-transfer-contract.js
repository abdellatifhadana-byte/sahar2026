/**
 * @file room-zone-transfer-contract.js — le format d'échange des salles ET de leur zone.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `resource_zones` est désormais l'unique source de vérité de la zone d'une salle. Trois
 * portes faisaient encore sortir puis rentrer des salles SANS cette information :
 *
 *   backup-service.js      sauvegardait `rooms[]`, jamais les rattachements. Une
 *                          restauration rendait donc des salles sans zone : invisibles à
 *                          tout rôle à périmètre, et impossibles à retrouver depuis
 *                          l'écran des accès.
 *   inventory-master.js    écrivait les salles directement dans IndexedDB, en contournant
 *                          l'écrivain central. Le rattachement n'existait que localement,
 *                          donc pas du tout.
 *   Export / Import JSON   des salles exportait `rooms[]` seul, présenté comme un format
 *                          complet. Réimporté, il perdait la zone — ou pire, réintroduisait
 *                          un `room.zoneId` hérité que le serveur refuse désormais.
 *
 * Une salle sans son rattachement n'est pas une salle sauvegardée : c'est une salle que
 * personne ne pourra plus atteindre. Les trois portes partagent donc UN format versionné,
 * et un seul chemin d'écriture — le serveur, transactionnellement.
 *
 * CE QUE CE FORMAT N'EST PAS
 * --------------------------
 * `locationId` n'y entre pas et n'est jamais touché : il dit OÙ se trouve la salle
 * (Casablanca › Siège › Département), la zone dit QUI y accède. Les deux voyagent
 * ensemble parce qu'ils appartiennent au même enregistrement, pas parce que l'un se
 * déduirait de l'autre.
 *
 * `docs.zoneIds` n'y entre pas non plus : un document de continuité couvre plusieurs zones
 * par contrat, et ce format ne concerne que les salles.
 */

/**
 * Version 3 : `rooms` + `roomZones`.
 *
 * La 2 sauvegardait `rooms[]` seul. Une archive de version 2 reste LISIBLE — son
 * `room.zoneId` est accepté comme entrée de migration — mais plus jamais produite.
 */
export const ROOM_ZONE_TRANSFER_VERSION = 3;

/** Les versions qu'on sait relire, la plus ancienne comprise. */
export const ROOM_ZONE_TRANSFER_READABLE = Object.freeze([2, 3]);

export const ROOM_ZONE_TRANSFER_ERRORS = Object.freeze({
  UNSUPPORTED_VERSION: 'ROOM_TRANSFER_UNSUPPORTED_VERSION',
  MULTIPLE_ZONES: 'ROOM_TRANSFER_MULTIPLE_ZONES',
  INVALID_SHAPE: 'ROOM_TRANSFER_INVALID_SHAPE'
});

const refuser = (message, code) => { throw Object.assign(new Error(message), { code, status: 400 }); };
const identifiant = value => (value === null || value === undefined || value === '' ? null : String(value));

/** L'enregistrement d'une salle, débarrassé de toute zone d'autorisation. */
export function stripRoomAuthorityZone(room) {
  const { zoneId: _zoneAutorite, zoneIds: _zonesAutorite, ...propre } = room || {};
  return propre;
}

/** Les zones d'autorisation portées par un enregistrement hérité, normalisées. */
export function legacyRoomZones(room) {
  const brutes = [...(Array.isArray(room?.zoneIds) ? room.zoneIds : []), room?.zoneId];
  return [...new Set(brutes.map(identifiant).filter(Boolean))];
}

/**
 * Le paquet d'export : les salles nettoyées, et leurs rattachements à côté.
 *
 * Les rattachements sont une LISTE PARALLÈLE, jamais un champ de la salle. C'est ce qui
 * empêche le format lui-même de recréer la double source qu'on vient de fermer.
 */
export function buildRoomTransfer(rooms = [], roomZones = []) {
  return {
    formatVersion: ROOM_ZONE_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    rooms: rooms.map(stripRoomAuthorityZone),
    roomZones: normalizeRoomZones(roomZones)
  };
}

/** Une paire par salle, sans doublon, et une seule zone par salle. */
export function normalizeRoomZones(roomZones = []) {
  const parSalle = new Map();
  for (const paire of roomZones || []) {
    const roomId = identifiant(paire?.roomId ?? paire?.resourceId);
    const zoneId = identifiant(paire?.zoneId);
    if (!roomId || !zoneId) continue;
    const deja = parSalle.get(roomId);
    if (deja && deja !== zoneId) {
      refuser(`La salle « ${roomId} » est rattachée à deux zones dans ce fichier : ${deja} et ${zoneId}.`,
        ROOM_ZONE_TRANSFER_ERRORS.MULTIPLE_ZONES);
    }
    parSalle.set(roomId, zoneId);
  }
  return [...parSalle.entries()].map(([roomId, zoneId]) => ({ roomId, zoneId }));
}

/**
 * Relire un paquet — le nôtre, ou une archive de version 2.
 *
 * `roomZones` fait foi quand il est présent. Le `room.zoneId` d'une archive héritée sert
 * alors d'ENTRÉE DE MIGRATION et de rien d'autre : il n'est ni fusionné avec `roomZones`,
 * ni conservé dans l'enregistrement rendu. Fusionner rouvrirait exactement la double
 * source que ce lot a fermée.
 */
export function readRoomTransfer(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    refuser('Fichier de salles illisible.', ROOM_ZONE_TRANSFER_ERRORS.INVALID_SHAPE);
  }
  // Une liste nue est une archive de version 2 : on la lit, on ne la produit plus.
  const paquet = Array.isArray(bundle) ? { formatVersion: 2, rooms: bundle } : bundle;
  const version = Number(paquet.formatVersion ?? 2);
  if (!ROOM_ZONE_TRANSFER_READABLE.includes(version)) {
    refuser(`Version de fichier inconnue : ${version}. Versions acceptées : ${ROOM_ZONE_TRANSFER_READABLE.join(', ')}.`,
      ROOM_ZONE_TRANSFER_ERRORS.UNSUPPORTED_VERSION);
  }
  const rooms = Array.isArray(paquet.rooms) ? paquet.rooms : [];
  if (!Array.isArray(paquet.rooms)) {
    refuser('Ce fichier ne contient aucune liste de salles.', ROOM_ZONE_TRANSFER_ERRORS.INVALID_SHAPE);
  }

  const declares = normalizeRoomZones(paquet.roomZones);
  const declaresParSalle = new Map(declares.map(paire => [paire.roomId, paire.zoneId]));

  const heritesUtilises = [];
  for (const room of rooms) {
    const roomId = identifiant(room?.id);
    if (!roomId || declaresParSalle.has(roomId)) continue;
    const heritees = legacyRoomZones(room);
    if (!heritees.length) continue;
    if (heritees.length > 1) {
      refuser(`La salle « ${room.name || roomId} » porte plusieurs zones héritées : une salle en a une seule.`,
        ROOM_ZONE_TRANSFER_ERRORS.MULTIPLE_ZONES);
    }
    declaresParSalle.set(roomId, heritees[0]);
    heritesUtilises.push(roomId);
  }

  return {
    formatVersion: version,
    rooms: rooms.map(stripRoomAuthorityZone),
    roomZones: [...declaresParSalle.entries()].map(([roomId, zoneId]) => ({ roomId, zoneId })),
    // Ce que l'appelant peut dire à l'utilisateur : d'où vient la zone quand elle vient
    // d'un champ hérité plutôt que d'une liste explicite.
    migratedFromLegacy: heritesUtilises
  };
}
