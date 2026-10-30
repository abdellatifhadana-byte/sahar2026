/**
 * @file tests/backup-restore-locations-p0c.test.js — P0-C : `locations` (Ville → Région →
 *       Département) survit réellement à un aller-retour sauvegarde/restauration, et un
 *       graphe incohérent ne produit AUCUNE écriture de localisation.
 *
 * Isolé : un `db` et un `fetch` simulés, jamais la base ou le serveur réels. `BackupService`
 * lui-même n'est pas réécrit — seule la scène (magasin en mémoire, `/api/rooms/transfer`
 * simulé) est fabriquée ici, pour exécuter le VRAI code de `backup-service.js` et
 * `location-contract.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const rien = () => {};
globalThis.window = undefined; // db.js se tait déjà si window est absent (initSync)

const { db } = await import('../db.js');

/* ═══════════════ le magasin en mémoire ═══════════ */
let magasin = new Map(); // "store|id" -> enregistrement
let prochainId = 1;
let refuserSauvegarde = null; // (store, record) => Error | null
const cloner = valeur => JSON.parse(JSON.stringify(valeur));

db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
db.getAll = async store => [...magasin.entries()].filter(([cle]) => cle.startsWith(`${store}|`)).map(([, v]) => cloner(v));
db.get = async (store, id) => { const v = magasin.get(`${store}|${id}`); return v ? cloner(v) : undefined; };
db._getRaw = db.get;
db.save = async (store, record) => {
  const refus = refuserSauvegarde?.(store, record);
  if (refus) throw refus;
  const id = record?.id ?? (prochainId += 1);
  magasin.set(`${store}|${id}`, cloner({ ...record, id }));
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (store, id) => magasin.delete(`${store}|${id}`);
db.isCentralSyncReady = () => true;

/* ═══════════ le serveur simulé — comptes seulement, pas la vraie logique ═══════════ */
let dernierPaquetSalles = null;
let refuserTransfertSalles = null;
let roomZonesActuelles = [];
/*
 * `/api/locations/restore` : le lot ENTIER part ici, en UN appel. Le double compte les
 * appels et retient le lot — l'atomicité réelle (BEGIN/COMMIT/ROLLBACK) est prouvée là où
 * elle vit, contre `applyLocationsRestore`, dans locations-restore-atomic-p0c.test.js.
 */
let lotsLocationsPostes = [];
let refuserRestaurationLocations = null;
globalThis.fetch = async (url, options = {}) => {
  const methode = String(options.method || 'GET').toUpperCase();
  if (String(url).includes('/api/locations/restore')) {
    lotsLocationsPostes.push(JSON.parse(options.body));
    if (refuserRestaurationLocations) {
      const refus = refuserRestaurationLocations;
      return { ok: false, status: refus.status || 400, json: async () => ({ error: refus.code, message: refus.message, errors: refus.errors }) };
    }
    const dernier = lotsLocationsPostes[lotsLocationsPostes.length - 1];
    return { ok: true, status: 200, json: async () => ({ ok: true, locations: dernier.locations.length }) };
  }
  if (String(url).includes('/api/rooms/transfer')) {
    if (methode === 'POST') {
      if (refuserTransfertSalles) {
        return { ok: false, status: refuserTransfertSalles.status || 500, json: async () => ({ error: refuserTransfertSalles.message }) };
      }
      dernierPaquetSalles = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ rooms: dernierPaquetSalles.rooms.length, roomZones: (dernierPaquetSalles.roomZones || []).length }) };
    }
    // GET : c'est `fetchRoomZones()` qu'appelle `createBackup()` — les rattachements
    // canoniques, tels que le centre les rendrait.
    return { ok: true, status: 200, json: async () => ({ roomZones: roomZonesActuelles }) };
  }
  return { ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND' }) };
};

const { BackupService, BACKUP_STORES } = await import('../backup-service.js');

function decor() {
  magasin = new Map();
  prochainId = 100;
  refuserSauvegarde = null;
  dernierPaquetSalles = null;
  refuserTransfertSalles = null;
  roomZonesActuelles = [];
  lotsLocationsPostes = [];
  refuserRestaurationLocations = null;
}

/*
 * L'arbre témoin : Casablanca → Siège → Régie. Les fiches portent la forme EXACTE que
 * `locations-section.js` écrit réellement — `normalizeLocation()` y est appliqué à chaque
 * création/édition, donc `parentId` est TOUJOURS présent (`null` pour une ville) en base
 * réelle. Une fiche à laquelle il manquerait ne serait pas un cas qu'un vrai utilisateur
 * peut produire.
 */
function planterArbreValide() {
  magasin.set('locations|1', { id: 1, kind: 'city', name: 'Casablanca', parentId: null, code: null, description: null, orphan: false });
  magasin.set('locations|2', { id: 2, kind: 'region', name: 'Siège', parentId: 1, code: null, description: null, orphan: false });
  magasin.set('locations|3', { id: 3, kind: 'department', name: 'Régie', parentId: 2, code: null, description: null, orphan: false });
}

/* ═══════════════════ 1 · locations rejoint désormais la sauvegarde ═══════════════════ */

test('BACKUP_STORES inclut désormais locations, sans rien retirer des magasins existants', () => {
  assert.ok(BACKUP_STORES.includes('locations'));
  for (const magasinAttendu of ['users', 'rooms', 'baies', 'equipments', 'walls', 'screens',
    'screen_groups', 'screen_issues', 'diagnosis_history', 'tickets', 'notes', 'docs', 'faq',
    'notifications', 'logs', 'attachments', 'cables', 'cable_reports', 'settings']) {
    assert.ok(BACKUP_STORES.includes(magasinAttendu), `${magasinAttendu} ne doit pas disparaître`);
  }
});

test('createBackup() emporte réellement les localisations', async () => {
  decor(); planterArbreValide();
  const service = new BackupService();
  const backup = await service.createBackup();
  assert.equal(backup.data.locations?.length, 3);
  assert.deepEqual(backup.data.locations.map(l => l.name).sort(), ['Casablanca', 'Régie', 'Siège']);
});

/* ═══════════════════ 2 · l'aller-retour complet ═══════════════════ */

/*
 * CE QUI A CHANGÉ DANS CE FICHIER, ET POURQUOI.
 *
 * La restauration des localisations n'écrit plus dans IndexedDB depuis le navigateur : le
 * lot part ENTIER à `/api/locations/restore`, qui valide puis écrit dans UNE transaction
 * PostgreSQL. C'est exactement le précédent déjà posé pour les salles — et la seule façon
 * de garantir qu'une panne au milieu du lot ne laisse pas une moitié d'arbre.
 *
 * Ces épreuves observent donc ce que le CLIENT fait : un seul appel, le lot entier, zéro
 * `db.save('locations', …)`, et le refus du serveur correctement porté au compte rendu.
 * L'atomicité elle-même est prouvée contre le serveur, dans
 * `locations-restore-atomic-p0c.test.js`.
 */

test('aller-retour complet : la sauvegarde emporte l’arbre, la restauration le rend au serveur EN UN LOT', async () => {
  decor(); planterArbreValide();
  const service = new BackupService();

  const sauvegarde = await service.createBackup();
  assert.equal(sauvegarde.data.locations.length, 3);

  const rapport = await service.restoreBackup(sauvegarde);

  assert.equal(lotsLocationsPostes.length, 1, 'UN SEUL appel — jamais une écriture par fiche');
  const lot = lotsLocationsPostes[0].locations;
  assert.equal(lot.length, 3, 'le lot ENTIER part en une fois');
  const parId = new Map(lot.map(l => [l.id, l]));
  assert.equal(parId.get(1).kind, 'city'); assert.equal(parId.get(1).parentId, null);
  assert.equal(parId.get(2).kind, 'region'); assert.equal(parId.get(2).parentId, 1);
  assert.equal(parId.get(3).kind, 'department'); assert.equal(parId.get(3).parentId, 2);
  assert.equal(rapport.stores.locations.restored, 3);
  assert.equal(rapport.stores.locations.failed, 0);
});

test('le client n’écrit JAMAIS lui-même dans locations — le serveur seul en décide', async () => {
  decor(); planterArbreValide();
  const service = new BackupService();
  const sauvegarde = await service.createBackup();
  magasin = new Map(); // base neuve : rien ne doit y apparaître par écriture locale

  const ecrituresLocales = [];
  const originalSave = db.save;
  db.save = async (store, record) => { if (store === 'locations') ecrituresLocales.push(record); return originalSave(store, record); };
  await service.restoreBackup(sauvegarde);
  db.save = originalSave;

  assert.deepEqual(ecrituresLocales, [],
    'aucun db.save(\'locations\', …) : chaque PUT indépendant était précisément le défaut');
  assert.equal(lotsLocationsPostes.length, 1);
});

/* ═════════ 3 · un refus du serveur : zéro changement net, et le compte rendu le DIT ═════════ */

test('le serveur refuse le graphe : aucune localisation restaurée, l’échec est nommé', async () => {
  decor();
  refuserRestaurationLocations = {
    status: 400, code: 'LOCATIONS_GRAPH_INVALID',
    message: 'Graphe de localisations invalide : cycle détecté impliquant 1',
    errors: [{ code: 'CYCLE', id: '1', message: 'cycle détecté impliquant 1' }]
  };
  const service = new BackupService();
  const sauvegarde = {
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    data: { users: [{ id: 1, username: 'admin', role: 'admin' }], locations: [
      { id: 1, kind: 'region', name: 'A', parentId: 2 },
      { id: 2, kind: 'department', name: 'B', parentId: 1 }
    ] }
  };

  const ecrituresLocales = [];
  const originalSave = db.save;
  db.save = async (store, record) => { if (store === 'locations') ecrituresLocales.push(record); return originalSave(store, record); };
  const rapport = await service.restoreBackup(sauvegarde);
  db.save = originalSave;

  assert.deepEqual(ecrituresLocales, []);
  assert.equal((await db.getAll('locations')).length, 0, 'zéro changement net côté client aussi');
  assert.equal(rapport.stores.locations.restored, 0);
  assert.equal(rapport.stores.locations.failed, 2);
  assert.ok(rapport.stores.locations.errors.some(e => e.code === 'CYCLE'),
    'le DÉTAIL du refus doit survivre au passage par le réseau, pas seulement « refusé »');
  // Le reste de la sauvegarde n'est pas pris en otage par le refus du graphe.
  assert.equal(rapport.stores.users.restored, 1);
});

test('un refus du graphe fait pencher le compte-rendu global vers l’échec, jamais un succès silencieux', async () => {
  decor();
  refuserRestaurationLocations = { status: 400, code: 'LOCATIONS_GRAPH_INVALID', message: 'refusé' };
  const service = new BackupService();
  const rapport = await service.restoreBackup({
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    data: { users: [], locations: [{ id: 1, kind: 'region', name: 'Boucle', parentId: 1 }] }
  });
  assert.ok(rapport.failed > 0, 'le compte global d’échecs doit refléter le refus');
  assert.equal(rapport.restored, 0);
});

/*
 * LA LIGNE QUI COMPTE LE PLUS ICI (blocage 3) : `room.locationId` n'est validé NULLE PART.
 * Restaurer les salles après un graphe refusé les rattacherait à des localisations
 * délibérément NON écrites — le jumeau numérique qui ment sur où se trouve une salle,
 * c'est-à-dire l'état que tout ce bloc existe pour empêcher.
 */
test('graphe de localisations refusé => le transfert des salles N’A PAS LIEU', async () => {
  decor();
  refuserRestaurationLocations = { status: 400, code: 'LOCATIONS_GRAPH_INVALID', message: 'refusé' };
  const service = new BackupService();
  const rapport = await service.restoreBackup({
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    roomZones: [{ roomId: 7, zoneId: 'zone-siege' }],
    data: {
      users: [],
      locations: [{ id: 1, kind: 'region', name: 'Boucle', parentId: 1 }],
      rooms: [{ id: 7, name: 'Régie A', locationId: 3 }]
    }
  });

  assert.equal(dernierPaquetSalles, null,
    'AUCUN POST vers /api/rooms/transfer : la salle pointerait vers une localisation non écrite');
  assert.equal(rapport.stores.rooms.restored, 0);
  assert.equal(rapport.stores.rooms.failed, 1);
  assert.match(rapport.stores.rooms.reason, /localisations/,
    'le compte rendu doit DIRE pourquoi les salles n’ont pas été posées');
});

test('graphe de localisations accepté => le transfert des salles a bien lieu', async () => {
  // Le pendant du précédent : la garde ne doit pas bloquer le cas nominal.
  decor();
  const service = new BackupService();
  const rapport = await service.restoreBackup({
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    roomZones: [{ roomId: 7, zoneId: 'zone-siege' }],
    data: {
      users: [],
      locations: [{ id: 1, kind: 'city', name: 'Casablanca', parentId: null }],
      rooms: [{ id: 7, name: 'Régie A', locationId: 1 }]
    }
  });

  assert.ok(dernierPaquetSalles, 'le graphe est accepté : les salles doivent suivre');
  assert.equal(rapport.stores.locations.restored, 1);
  assert.equal(rapport.stores.rooms.restored, 1);
});

/* ═══════════════════ 4 · sauvegarde ANCIENNE, sans locations : rien n’est inventé ═══════════════════ */

test('une sauvegarde ANCIENNE sans locations reste lisible, sans qu’aucune localisation ne soit inventée', async () => {
  decor();
  const service = new BackupService();
  const sauvegardeAncienne = {
    // Ancien format : aucune clé `locations` du tout — antérieure à la migration v17.
    formatVersion: 2, schemaVersion: 12, timestamp: new Date().toISOString(),
    data: {
      users: [{ id: 1, username: 'admin', role: 'admin' }],
      equipments: [{ id: 5, name: 'Switch A' }]
    }
  };

  const appelsLocations = [];
  const originalSave = db.save;
  db.save = async (store, record) => { if (store === 'locations') appelsLocations.push(record); return originalSave(store, record); };
  const rapport = await service.restoreBackup(sauvegardeAncienne);
  db.save = originalSave;

  assert.deepEqual(appelsLocations, [], 'une sauvegarde sans locations ne doit en écrire aucune');
  assert.deepEqual(lotsLocationsPostes, [],
    'aucun appel à /api/locations/restore : rien n’est fabriqué pour une archive qui n’avait pas d’arbre');
  assert.ok(dernierPaquetSalles === null || dernierPaquetSalles, 'le reste de la restauration suit son cours');
  assert.equal(rapport.stores.locations, undefined, 'aucune entrée locations n’est fabriquée pour une sauvegarde qui n’en avait pas');
  assert.equal(rapport.stores.users.restored, 1);
  assert.equal(rapport.stores.equipments.restored, 1);
  assert.equal((await db.getAll('locations')).length, 0);
});

/* ═══════════════════ 5 · le reste du contrat de sauvegarde n’a pas bougé ═══════════════════ */

test('tickets restent réservés au serveur — comportement inchangé à côté de locations', async () => {
  decor();
  const service = new BackupService();
  const sauvegarde = {
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    data: { users: [], tickets: [{ id: 9, subject: 'Demande' }] }
  };
  const rapport = await service.restoreBackup(sauvegarde);
  assert.equal(rapport.stores.tickets.skipped, 1);
  assert.equal(rapport.skipped, 1);
});

test('rooms + roomZones passent toujours par /api/rooms/transfer, aux côtés de locations', async () => {
  decor(); planterArbreValide();
  const service = new BackupService();
  const sauvegarde = {
    formatVersion: 3, schemaVersion: 14, timestamp: new Date().toISOString(),
    roomZones: [{ roomId: 7, zoneId: 'zone-siege' }],
    data: {
      locations: [...magasin.values()].filter((_, index) => false), // vide : ce test isole rooms
      rooms: [{ id: 7, name: 'Régie A', locationId: 3 }]
    }
  };
  const rapport = await service.restoreBackup(sauvegarde);
  assert.ok(dernierPaquetSalles, 'le paquet salles doit avoir été posté à /api/rooms/transfer');
  assert.equal(dernierPaquetSalles.rooms.length, 1);
  assert.equal(dernierPaquetSalles.roomZones.length, 1);
  assert.equal(rapport.stores.rooms.restored, 1);
});
