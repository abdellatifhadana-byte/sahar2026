import { db } from './db.js';
import { cableEndpointRefs, cableTouchesRoom } from './connectivity-contract.js';

const originalPopulateDummyData = db.populateDummyData.bind(db);

// Les données de démonstration ne doivent jamais réapparaître automatiquement en production.
// Pour les réactiver volontairement sur un navigateur de test :
// localStorage.setItem('2mtech-demo-mode', '1')
db.populateDummyData = async function populateDummyDataProductionSafe() {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem('2mtech-demo-mode') !== '1') return;
  return originalPopulateDummyData();
};

const sameId = (left, right) => String(left) === String(right);

/**
 * Supprime une salle et son contenu opérationnel de manière contrôlée.
 * Les écrans possédant tickets, problèmes ou historique de diagnostic bloquent
 * l'opération afin de ne jamais détruire silencieusement l'historique technique.
 */
db.deleteRoomWithContentsSafely = async function deleteRoomWithContentsSafely(roomId) {
  const id = this.normalizeKey(roomId);
  const room = await this.get('rooms', id);
  if (!room) {
    const error = new Error('La salle sélectionnée est introuvable.');
    error.code = 'ROOM_NOT_FOUND';
    throw error;
  }

  const deps = await this.getRoomDependencies(id);

  // Prévalidation complète avant la première suppression.
  //
  // La cascade est une suite d'écritures indépendantes : IndexedDB ouvre une transaction
  // par suppression et chacune part ensuite au serveur séparément. Aucune transaction ne
  // les englobe, et aucune ne peut le faire depuis le navigateur. Un refus à mi-parcours
  // — le serveur oppose un 409 sur un équipement qu'un schéma référence, une coupure
  // réseau — laissait donc câbles, écrans et murs définitivement supprimés, la salle
  // toujours là, et son contenu amputé sans trace de ce qui manquait.
  //
  // Tout ce qui peut être su à l'avance est donc éprouvé AVANT la première suppression,
  // de sorte que le cas « à demi supprimée » devienne « rien supprimé ». Ce que le
  // serveur seul peut refuser reste possible : c'est le rapport d'échec, plus bas, qui
  // rend alors l'état exact lisible au lieu de le laisser deviner.
  const blockers = [];
  for (const screen of deps.screens) {
    const screenDeps = await this.getScreenDependencies(screen.id);
    if (screenDeps.tickets.length || screenDeps.issues.length || screenDeps.history.length) {
      blockers.push(`l’écran « ${screen.name || screen.id} » porte des tickets, problèmes ou un historique de diagnostic`);
    }
  }

  // Mêmes dépendances que celles opposées par le serveur : un document technique qui
  // référence une entité de la salle, ou une demande encore ouverte sur elle.
  const [documents, tickets] = await Promise.all([
    this.db.objectStoreNames.contains('docs') ? this.getAll('docs') : [],
    this.db.objectStoreNames.contains('tickets') ? this.getAll('tickets') : []
  ]);
  const closedStates = new Set(['fermé','ferme','closed','résolu','resolu','resolved','annulé','annule']);
  const referencedByDocument = (type, entityId) => documents.some(document => {
    const nodes = Array.isArray(document.nodes) ? document.nodes : [];
    if (nodes.some(node => node.entityRef?.type === type && sameId(node.entityRef.id, entityId))) return true;
    if (type === 'equipment' && ['sourceEquipmentId','destinationEquipmentId','routerEquipmentId'].some(field => sameId(document[field], entityId))) return true;
    if (type === 'screen' && ['sourceScreenId','destinationScreenId','screenId'].some(field => sameId(document[field], entityId))) return true;
    return false;
  });
  const hasOpenTicket = (type, entityId) => tickets.some(ticket => {
    const relatedType = String(ticket.relatedType || ticket.targetType || ticket.type || '').toLowerCase();
    const relatedId = ticket.relatedId ?? ticket.targetId ?? ticket.entityId ?? ticket.idElement;
    if (relatedType !== type || !sameId(relatedId, entityId)) return false;
    return !closedStates.has(String(ticket.status || '').trim().toLowerCase());
  });

  for (const [type, list] of [['equipment', deps.equipments], ['screen', deps.screens], ['baie', deps.baies], ['wall', deps.walls]]) {
    for (const item of list) {
      const label = item.name || item.nom || item.id;
      if (referencedByDocument(type, item.id)) blockers.push(`« ${label} » est référencé par un schéma ou un document technique`);
      if (hasOpenTicket(type, item.id)) blockers.push(`« ${label} » porte une demande encore ouverte`);
    }
  }
  if (referencedByDocument('room', id) || hasOpenTicket('room', id)) {
    blockers.push(`la salle elle-même est référencée par un document technique ou une demande ouverte`);
  }

  if (blockers.length) {
    const unique = [...new Set(blockers)];
    const error = new Error(
      `Suppression impossible, rien n’a été supprimé : ${unique.slice(0, 6).join(' ; ')}` +
      `${unique.length > 6 ? ` (et ${unique.length - 6} autre(s))` : ''}. Réaffectez ou archivez ces dépendances d’abord.`
    );
    error.code = 'ROOM_HAS_PROTECTED_DEPENDENCIES';
    error.blockers = unique;
    throw error;
  }

  const equipmentIds = new Set(deps.equipments.map(item => String(item.id)));
  const screenIds = new Set(deps.screens.map(item => String(item.id)));

  // Les liaisons physiques vers des éléments supprimés doivent disparaître avec eux.
  //
  // La condition portait auparavant sur `cable.roomId`, un cache écrit à la création du
  // câble depuis la salle de la source et jamais rafraîchi ensuite. Déplacer un équipement
  // vers une autre salle laissait donc ses câbles étiquetés de l'ancienne : supprimer
  // cette ancienne salle détruisait des câbles dont les deux extrémités vivaient ailleurs,
  // sans le moindre message. La salle d'un câble est désormais déduite de ses extrémités
  // réelles, `cable.roomId` ne servant plus que pour un câble dont plus aucune extrémité
  // n'existe — le seul cas où il reste la dernière trace de localisation.
  if (this.db.objectStoreNames.contains('cables')) {
    const [cables, equipments, screens] = await Promise.all([
      this.getAll('cables'), this.getAll('equipments'), this.getAll('screens')
    ]);
    for (const cable of cables) {
      const touchesDeletedEntity = cableEndpointRefs(cable).some(reference => (reference.type === 'screen'
        ? screenIds.has(String(reference.id))
        : equipmentIds.has(String(reference.id))));
      const touchesDeletedRoom = cableTouchesRoom(cable, id, { equipments, screens });
      if (touchesDeletedEntity || touchesDeletedRoom) await this._deleteRaw('cables', cable.id);
    }
  }

  // Ordre de suppression : écrans -> murs -> équipements -> baies -> salle.
  // Cet ordre respecte les protections relationnelles déjà présentes dans db.js.
  //
  // La prévalidation a écarté tout ce qui pouvait l'être ; il reste ce que seul le
  // serveur peut opposer. Si cela survient, l'échec est enrichi de l'état EXACT — ce qui
  // a été retiré, ce qui reste — pour que l'opération puisse être reprise en connaissance
  // de cause. Sans ce rapport, l'opérateur découvrait une salle amputée sans savoir de quoi.
  const removed = { screens: [], walls: [], equipments: [], baies: [] };
  const remaining = () => ({
    screens: deps.screens.filter(item => !removed.screens.includes(String(item.id))).map(item => item.name || item.id),
    walls: deps.walls.filter(item => !removed.walls.includes(String(item.id))).map(item => item.name || item.id),
    equipments: deps.equipments.filter(item => !removed.equipments.includes(String(item.id))).map(item => item.name || item.nom || item.id),
    baies: deps.baies.filter(item => !removed.baies.includes(String(item.id))).map(item => item.name || item.id)
  });

  try {
    for (const screen of deps.screens) { await this.deleteScreenSafely(screen.id); removed.screens.push(String(screen.id)); }
    for (const wall of deps.walls) { await this._deleteRaw('walls', wall.id); removed.walls.push(String(wall.id)); }
    for (const equipment of deps.equipments) { await this.deleteEquipmentSafely(equipment.id); removed.equipments.push(String(equipment.id)); }
    for (const baie of deps.baies) { await this.deleteBaieSafely(baie.id); removed.baies.push(String(baie.id)); }
    await this._deleteRaw('rooms', id);
  } catch (cause) {
    const left = remaining();
    const total = Object.values(left).reduce((sum, list) => sum + list.length, 0);
    const error = new Error(
      `Suppression interrompue : ${cause.message} — la salle « ${room.name || id} » existe toujours et contient encore ` +
      `${total} élément(s). Déjà retiré : ${removed.screens.length} écran(s), ${removed.walls.length} mur(s), ` +
      `${removed.equipments.length} équipement(s), ${removed.baies.length} baie(s). Levez le blocage puis relancez la suppression.`
    );
    error.code = 'ROOM_DELETION_INTERRUPTED';
    error.cause = cause;
    error.removed = { screens:removed.screens.length, walls:removed.walls.length, equipments:removed.equipments.length, baies:removed.baies.length };
    error.remaining = left;
    throw error;
  }

  if (sameId(await this.getCurrentRoomId(), id)) await this.setCurrentRoomId(null);

  return {
    deleted: true,
    roomId: id,
    removed: {
      baies: deps.baies.length,
      equipments: deps.equipments.length,
      walls: deps.walls.length,
      screens: deps.screens.length
    }
  };
};

export default db;
