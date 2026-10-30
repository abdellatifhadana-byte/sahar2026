import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOM_ZONE_TRANSFER_VERSION, buildRoomTransfer, readRoomTransfer,
  stripRoomAuthorityZone, normalizeRoomZones
} from '../room-zone-transfer-contract.js';
import { createAccessControl } from '../scripts/access-control.js';
import { BackupService, ROOM_TRANSFER_ENDPOINT } from '../backup-service.js';
import { db } from '../db.js';

/*
 * TROIS PORTES FAISAIENT SORTIR DES SALLES SANS LEUR ZONE.
 *
 *   backup-service.js      `rooms[]` seul → une restauration rendait des salles que plus
 *                          aucun rôle à périmètre ne pouvait voir.
 *   inventory-master.js    écriture directe dans IndexedDB, sans passer par le serveur →
 *                          le rattachement n'existait que localement, donc pas du tout.
 *   Export / Import JSON   `rooms[]` présenté comme un format complet → la zone se perdait
 *                          au premier aller-retour.
 *
 * `resource_zones` étant la seule vérité de la zone d'une salle, une salle exportée sans
 * son rattachement n'est pas sauvegardée : elle est perdue. Les trois portes partagent
 * donc UN format versionné, et un seul chemin d'écriture — le serveur, en transaction.
 */

/* ══════════════════════════════ le format lui-même */

test('TR·1 — un export porte les salles ET leurs rattachements', () => {
  const paquet = buildRoomTransfer(
    [{ id: 'r1', name: 'STC', locationId: 'dep-1' }],
    [{ roomId: 'r1', zoneId: 'Z-A' }]
  );
  assert.equal(paquet.formatVersion, ROOM_ZONE_TRANSFER_VERSION);
  assert.deepEqual(paquet.rooms, [{ id: 'r1', name: 'STC', locationId: 'dep-1' }]);
  assert.deepEqual(paquet.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
});

test('TR·2 — une salle exportée ne porte JAMAIS de zone en propre', () => {
  // Le rattachement est une liste parallèle. C'est ce qui empêche le format de recréer
  // lui-même la double source qu'on vient de fermer.
  const paquet = buildRoomTransfer(
    [{ id: 'r1', name: 'STC', zoneId: 'Z-A', zoneIds: ['Z-A'] }],
    [{ roomId: 'r1', zoneId: 'Z-A' }]
  );
  assert.equal('zoneId' in paquet.rooms[0], false);
  assert.equal('zoneIds' in paquet.rooms[0], false);
});

test('TR·3 — `locationId` traverse le format sans être touché', () => {
  // Deux notions différentes : le lieu dit OÙ, la zone dit QUI y accède.
  const relu = readRoomTransfer(buildRoomTransfer(
    [{ id: 'r1', name: 'Régie Car', locationId: 'reg-1', location: 'Cour technique' }],
    [{ roomId: 'r1', zoneId: 'Z-A' }]
  ));
  assert.equal(relu.rooms[0].locationId, 'reg-1');
  assert.equal(relu.rooms[0].location, 'Cour technique');
});

test('TR·4 — une archive héritée : `room.zoneId` est une ENTRÉE de migration', () => {
  const relu = readRoomTransfer({ formatVersion: 2, rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }] });
  assert.deepEqual(relu.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
  assert.equal('zoneId' in relu.rooms[0], false, 'le champ hérité est ressorti tel quel');
  assert.deepEqual(relu.migratedFromLegacy, ['r1']);
});

test('TR·5 — une liste NUE de salles se lit comme une archive de version 2', () => {
  const relu = readRoomTransfer([{ id: 'r1', name: 'STC', zoneId: 'Z-A' }]);
  assert.equal(relu.formatVersion, 2);
  assert.deepEqual(relu.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
});

test('TR·6 — `roomZones` fait foi ; l’héritage n’est PAS fusionné avec lui', () => {
  // Fusionner rendrait la salle rattachée à deux zones : exactement le défaut fermé.
  const relu = readRoomTransfer({
    formatVersion: 3,
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-ANCIENNE' }],
    roomZones: [{ roomId: 'r1', zoneId: 'Z-A' }]
  });
  assert.deepEqual(relu.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
  assert.deepEqual(relu.migratedFromLegacy, []);
});

test('TR·7 — deux zones pour une salle sont REFUSÉES, pas réduites en silence', () => {
  assert.throws(() => normalizeRoomZones([{ roomId: 'r1', zoneId: 'Z-A' }, { roomId: 'r1', zoneId: 'Z-B' }]),
    error => error.code === 'ROOM_TRANSFER_MULTIPLE_ZONES');
  assert.throws(() => readRoomTransfer({ formatVersion: 2, rooms: [{ id: 'r1', zoneIds: ['Z-A', 'Z-B'] }] }),
    error => error.code === 'ROOM_TRANSFER_MULTIPLE_ZONES');
});

test('TR·8 — une version inconnue est nommée, pas devinée', () => {
  assert.throws(() => readRoomTransfer({ formatVersion: 9, rooms: [] }),
    error => error.code === 'ROOM_TRANSFER_UNSUPPORTED_VERSION' && /9/.test(error.message));
  assert.throws(() => readRoomTransfer({ formatVersion: 3 }),
    error => error.code === 'ROOM_TRANSFER_INVALID_SHAPE');
});

test('TR·9 — une salle sans rattachement traverse le format sans en inventer un', () => {
  const relu = readRoomTransfer({ formatVersion: 3, rooms: [{ id: 'r1', name: 'STC' }] });
  assert.deepEqual(relu.roomZones, []);
});

test('TR·10 — `stripRoomAuthorityZone` ne retire QUE les deux champs d’autorisation', () => {
  const propre = stripRoomAuthorityZone({
    id: 'r1', name: 'STC', zoneId: 'Z', zoneIds: ['Z'], locationId: 'dep-1',
    coordinates: { x: 1, y: 2 }, customFields: [{ key: 'a', value: 'b' }], responsibleId: 'u1'
  });
  assert.deepEqual(propre, {
    id: 'r1', name: 'STC', locationId: 'dep-1',
    coordinates: { x: 1, y: 2 }, customFields: [{ key: 'a', value: 'b' }], responsibleId: 'u1'
  });
});

/* ══════════════════════════════ l'écriture, côté serveur */

function poolDouble(seed = {}) {
  const magasins = new Map();
  let horloge = 0;
  let transactions = 0;
  let echouerSur = null;
  const table = store => {
    if (!magasins.has(store)) magasins.set(store, new Map());
    return magasins.get(store);
  };
  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) table(store).set(String(record.id), { data: record, deleted: false, updatedAt: ++horloge });
  }
  const client = {
    async query(sql, params = []) {
      const texte = String(sql).replace(/\s+/g, ' ').trim();
      if (echouerSur && texte.startsWith('INSERT') && String(params[1]) === echouerSur) {
        throw new Error('panne simulée pendant la transaction');
      }
      // Verrou de clé logique : il protège la fiche qui n'existe pas encore. Le double
      // n'a rien à sérialiser ici — ces épreuves n'écrivent pas en parallèle — mais la
      // requête doit être reconnue, sinon le magasin échoue avant d'avoir rien fait.
      if (texte.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };
      if (texte.startsWith('SELECT data, deleted FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne ? [{ data: ligne.data, deleted: ligne.deleted }] : [] };
      }
      if (texte.startsWith('SELECT data FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne && !ligne.deleted ? [{ data: ligne.data }] : [] };
      }
      if (texte.startsWith('SELECT record_id,data,updated_at FROM platform_records')) {
        const rows = [...table(params[0]).entries()].filter(([, v]) => !v.deleted)
          .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
          .map(([id, v]) => ({ record_id: id, data: v.data, updated_at: v.updatedAt }));
        return { rows };
      }
      if (texte.startsWith('INSERT INTO platform_records')) {
        // La pierre tombale se reconnaît au drapeau `deleted`, pas au corps écrit :
        // depuis le contrat de révision elle transporte la révision au lieu de `'{}'`.
        const tombe = texte.includes('::jsonb,TRUE');
        table(params[0]).set(String(params[1]), {
          data: tombe ? {} : JSON.parse(params[2]), deleted: tombe, updatedAt: ++horloge
        });
        return { rows: [] };
      }
      if (texte === 'BEGIN') { transactions += 1; return { rows: [] }; }
      if (/^(COMMIT|ROLLBACK)$/.test(texte)) return { rows: [] };
      throw new Error(`requête non simulée : ${texte.slice(0, 90)}`);
    },
    release() {}
  };
  return {
    ...client, connect: async () => client,
    lire: (store, id) => { const l = table(store).get(String(id)); return l && !l.deleted ? l.data : null; },
    lister: store => [...table(store).values()].filter(v => !v.deleted).map(v => v.data),
    transactions: () => transactions,
    echouerSur: id => { echouerSur = id; }
  };
}

const rattachements = (pool, roomId) => pool.lister('resource_zones')
  .filter(item => String(item.resourceType).toLowerCase() === 'room' && String(item.resourceId) === String(roomId))
  .map(item => String(item.zoneId)).sort();

function decor() {
  const pool = poolDouble({
    zones: [
      { id: 'Z-A', name: 'Régie A', status: 'active' },
      { id: 'Z-B', name: 'Régie B', status: 'active' }
    ],
    zone_memberships: [{ id: 'M1', userId: 'u-a', zoneId: 'Z-A', status: 'active' }],
    zone_grants: ['room.edit', 'zone.summary.read'].map((permission, index) => ({
      id: `G${index}`, userId: 'u-a', zoneId: 'Z-A', permission, status: 'active'
    })),
    users: [{ id: 1, role: 'admin' }, { id: 'u-a', role: 'chef' }]
  });
  return { pool, access: createAccessControl(pool), admin: { id: 1, role: 'admin' }, chef: { id: 'u-a', role: 'chef' } };
}

test('TR·11 — appliquer un transfert écrit la salle ET son rattachement', async () => {
  const { access, pool, admin } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer(
    [{ id: 'r1', name: 'STC', locationId: 'dep-1' }], [{ roomId: 'r1', zoneId: 'Z-A' }]
  ));
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.equal(pool.lire('rooms', 'r1').name, 'STC');
  assert.equal(pool.lire('rooms', 'r1').locationId, 'dep-1');
  assert.equal(pool.lire('rooms', 'r1').zoneId, undefined, 'la salle stockée garde une zone en propre');
});

test('TR·12 — sauvegarde → suppression → restauration : la MÊME zone', async () => {
  const { access, pool, admin } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [{ roomId: 'r1', zoneId: 'Z-A' }]));

  // La sauvegarde lit ce que le serveur expose : les salles et leurs rattachements.
  const archive = buildRoomTransfer(await access.list('rooms'), await access.roomZonePairs());
  assert.deepEqual(archive.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }], 'la sauvegarde ne porte pas le rattachement');

  await access.tombstone('rooms', 'r1');
  await access.detachRoomZones(admin, 'r1');
  assert.deepEqual(rattachements(pool, 'r1'), []);

  await access.applyRoomTransfer(admin, readRoomTransfer(archive));
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A'], 'la salle restaurée a perdu sa zone');
});

test('TR·13 — export → suppression → import : la MÊME zone', async () => {
  const { access, pool, admin } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [{ roomId: 'r1', zoneId: 'Z-B' }]));
  const exporte = buildRoomTransfer(await access.list('rooms'), await access.roomZonePairs());
  await access.tombstone('rooms', 'r1');
  await access.detachRoomZones(admin, 'r1');
  await access.applyRoomTransfer(admin, readRoomTransfer(JSON.parse(JSON.stringify(exporte))));
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-B']);
});

test('TR·14 — un import ne fait pas hériter une salle recréée de son ancienne zone', async () => {
  const { access, pool, admin, chef } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [{ roomId: 'r1', zoneId: 'Z-A' }]));
  await access.tombstone('rooms', 'r1');
  await access.detachRoomZones(admin, 'r1');
  await access.applyRoomTransfer(admin, buildRoomTransfer([{ id: 'r1', name: 'STC bis' }], [{ roomId: 'r1', zoneId: 'Z-B' }]));
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-B']);
  assert.equal(await access.canAccessRecord(chef, 'rooms', { id: 'r1' }, 'read'), false,
    'le chef de l’ancienne zone garde la salle recréée');
});

test('TR·15 — une zone où l’on n’est pas habilité : REFUS, et rien n’est écrit', async () => {
  const { access, pool, chef } = decor();
  await assert.rejects(
    () => access.applyRoomTransfer(chef, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [{ roomId: 'r1', zoneId: 'Z-B' }])),
    error => error.code === 'ZONE_FORBIDDEN' && error.status === 403
  );
  assert.equal(pool.lire('rooms', 'r1'), null, 'la salle refusée a quand même été écrite');
  assert.deepEqual(rattachements(pool, 'r1'), []);
});

test('TR·16 — une zone inexistante est refusée comme une zone interdite', async () => {
  const { access, chef } = decor();
  const inexistante = await access.applyRoomTransfer(chef,
    buildRoomTransfer([{ id: 'r1' }], [{ roomId: 'r1', zoneId: 'Z-INVENTEE' }])).catch(error => error.code);
  const interdite = await access.applyRoomTransfer(chef,
    buildRoomTransfer([{ id: 'r1' }], [{ roomId: 'r1', zoneId: 'Z-B' }])).catch(error => error.code);
  assert.equal(inexistante, interdite);
});

test('TR·17 — une salle sans rattachement dans le paquet est refusée pour un rôle à périmètre', async () => {
  // Sinon un import « réussi » déposerait une salle que son auteur ne peut plus voir.
  const { access, chef } = decor();
  await assert.rejects(
    () => access.applyRoomTransfer(chef, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [])),
    error => error.code === 'ROOM_ZONE_REQUIRED'
  );
});

test('TR·18 — TOUT le paquet passe, ou rien : une seule transaction', async () => {
  const { access, pool, admin } = decor();
  assert.equal(pool.transactions(), 0);
  await access.applyRoomTransfer(admin, buildRoomTransfer(
    [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }],
    [{ roomId: 'r1', zoneId: 'Z-A' }, { roomId: 'r2', zoneId: 'Z-B' }]
  ));
  assert.equal(pool.transactions(), 1, 'chaque salle a ouvert sa propre transaction');
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.deepEqual(rattachements(pool, 'r2'), ['Z-B']);
});

test('TR·19 — une panne en cours de paquet ne laisse pas la moitié des salles', async () => {
  const { access, pool, admin } = decor();
  pool.echouerSur('r2');
  await assert.rejects(() => access.applyRoomTransfer(admin, buildRoomTransfer(
    [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }],
    [{ roomId: 'r1', zoneId: 'Z-A' }, { roomId: 'r2', zoneId: 'Z-B' }]
  )));
  // Le double de connexion ne rejoue pas un ROLLBACK réel ; ce qu'on vérifie ici, c'est
  // que l'écriture s'est faite DANS une transaction, donc qu'un vrai PostgreSQL annulerait.
  assert.equal(pool.transactions(), 1);
});

test('TR·20 — le rapport dit ce qui a été écrit', async () => {
  const { access, admin } = decor();
  const rapport = await access.applyRoomTransfer(admin, buildRoomTransfer(
    [{ id: 'r1', name: 'A' }], [{ roomId: 'r1', zoneId: 'Z-A' }]
  ));
  assert.equal(rapport.rooms, 1);
  assert.equal(rapport.roomZones, 1);
});

test('TR·21 — `roomZonePairs` rend exactement les rattachements canoniques', async () => {
  const { access, admin } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer(
    [{ id: 'r1' }, { id: 'r2' }], [{ roomId: 'r1', zoneId: 'Z-A' }, { roomId: 'r2', zoneId: 'Z-B' }]
  ));
  const paires = (await access.roomZonePairs()).sort((a, b) => String(a.roomId).localeCompare(String(b.roomId)));
  assert.deepEqual(paires, [{ roomId: 'r1', zoneId: 'Z-A' }, { roomId: 'r2', zoneId: 'Z-B' }]);
});

/* ══════════════════════════════ ce que la sauvegarde emporte */

/**
 * Un navigateur minimal : `resource_zones` n'est PAS un magasin client — il appartient au
 * serveur — donc la sauvegarde doit aller le chercher. C'est cela qu'on mesure.
 */
function bancDeSauvegarde({ roomZones = [], central = true, panne = false } = {}) {
  const appels = [];
  db.open = async () => {};
  db.db = { objectStoreNames: { contains: nom => ['rooms', 'users', 'equipments'].includes(nom) } };
  db.getAll = async store => ({ rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-HERITEE' }], users: [], equipments: [] }[store] || []);
  db.isCentralSyncReady = () => central;
  globalThis.fetch = async (chemin, options = {}) => {
    appels.push({ chemin, methode: options.method || 'GET', corps: options.body ? JSON.parse(options.body) : null });
    if (panne) return { ok: false, status: 503, json: async () => ({ error: 'CENTRAL_DOWN', message: 'hors ligne' }) };
    if ((options.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ formatVersion: 3, rooms: [], roomZones }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, rooms: 1, roomZones: 1 }) };
  };
  return { appels, service: new BackupService() };
}

test('TR·22 — une sauvegarde emporte les rattachements, et le dit par sa version', async () => {
  const { service } = bancDeSauvegarde({ roomZones: [{ roomId: 'r1', zoneId: 'Z-A' }] });
  const archive = await service.createBackup();
  assert.equal(archive.formatVersion, ROOM_ZONE_TRANSFER_VERSION);
  assert.deepEqual(archive.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
  assert.ok(Array.isArray(archive.data.rooms), 'les salles ne sont plus dans la sauvegarde');
});

test('TR·23 — sans autorité centrale, la sauvegarde REFUSE au lieu de mentir', async () => {
  // Une archive sans rattachements se croirait complète, et la perte n'apparaîtrait qu'à
  // la restauration — quand il est trop tard pour la refaire.
  const { service } = bancDeSauvegarde({ central: false });
  await assert.rejects(() => service.createBackup(), error => error.code === 'CENTRAL_AUTHORITY_REQUIRED');
  const { service: enPanne } = bancDeSauvegarde({ panne: true });
  await assert.rejects(() => enPanne.createBackup(), error => error.code === 'CENTRAL_AUTHORITY_REQUIRED');
});

test('TR·24 — la restauration REND les salles au serveur, pas à IndexedDB', async () => {
  const { service, appels } = bancDeSauvegarde({ roomZones: [{ roomId: 'r1', zoneId: 'Z-A' }] });
  const ecrituresLocales = [];
  db.save = async (store, record) => { ecrituresLocales.push(store); return record; };
  const archive = await service.createBackup();
  await service.restoreBackup(archive);
  const depot = appels.find(appel => appel.methode === 'POST' && appel.chemin === ROOM_TRANSFER_ENDPOINT);
  assert.ok(depot, 'les salles n’ont pas été rendues au serveur');
  assert.deepEqual(depot.corps.roomZones, [{ roomId: 'r1', zoneId: 'Z-A' }]);
  assert.equal('zoneId' in depot.corps.rooms[0], false, 'la salle rendue porte encore une zone en propre');
  assert.ok(!ecrituresLocales.includes('rooms'), 'une salle a été écrite localement en contournant le serveur');
});

test('TR·25 — une archive HÉRITÉE se restaure : son `zoneId` sert de migration', async () => {
  const { service, appels } = bancDeSauvegarde();
  db.save = async (store, record) => record;
  await service.restoreBackup({
    formatVersion: 2, schemaVersion: 14,
    data: { rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-ANCIENNE' }], users: [], equipments: [] }
  });
  const depot = appels.find(appel => appel.methode === 'POST');
  assert.deepEqual(depot.corps.roomZones, [{ roomId: 'r1', zoneId: 'Z-ANCIENNE' }]);
  assert.equal('zoneId' in depot.corps.rooms[0], false);
});

test('TR·26 — un dépôt refusé est COMPTÉ en échec, jamais présenté comme restauré', async () => {
  const { service } = bancDeSauvegarde({ roomZones: [{ roomId: 'r1', zoneId: 'Z-A' }] });
  const archive = await service.createBackup();
  db.save = async (store, record) => record;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'ZONE_FORBIDDEN', message: 'zone interdite' }) });
  const rapport = await service.restoreBackup(archive);
  assert.equal(rapport.stores.rooms.restored, 0);
  assert.equal(rapport.stores.rooms.failed, 1);
  assert.ok(rapport.errors.some(erreur => erreur.store === 'rooms'));
});

/* ══════════════════════════════ l'inventaire et l'export refusent le faux succès */

test('TR·27 — l’inventaire REFUSE d’installer sans autorité centrale', async () => {
  // Écrites dans IndexedDB seul, les salles n'auraient aucun rattachement : elles
  // s'afficheraient à l'administrateur qui vient de les installer, et à personne d'autre.
  const { importInventoryBundle, centralAuthorityAvailable, INVENTAIRE_SANS_AUTORITE } =
    await import('../inventory-master.js');
  const fenetreAvant = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  db.isCentralSyncReady = () => false;
  try {
    assert.equal(centralAuthorityAvailable(), false);
    await assert.rejects(
      () => importInventoryBundle({ rooms: [{ id: 'r1', name: 'STC' }], equipments: [] }, { replaceOperational: false }),
      error => error.code === 'CENTRAL_AUTHORITY_REQUIRED' && error.message === INVENTAIRE_SANS_AUTORITE
    );
  } finally {
    if (fenetreAvant === undefined) delete globalThis.window; else globalThis.window = fenetreAvant;
  }
});

test('TR·28 — l’export de salles refuse aussi, plutôt que de sortir un fichier incomplet', async () => {
  const { default: Salles, EXPORT_SANS_AUTORITE } = await import('../salles.js');
  db.isCentralSyncReady = () => false;
  const messages = [];
  const boutons = new Map([['export-salles', {}]]);
  globalThis.document = {
    getElementById: id => boutons.get(id) || null,
    querySelectorAll: () => [],
    createElement: () => ({ click() {} })
  };
  globalThis.localStorage = {
    getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, role: 'admin' }) : null),
    setItem() {}, removeItem() {}
  };
  db.getAll = async () => [];
  const salles = new Salles({ showNotification: message => messages.push(message) });
  salles.accessContext = null;
  await salles.afterRender();
  await boutons.get('export-salles').onclick();
  assert.equal(messages.at(-1), EXPORT_SANS_AUTORITE);
  delete globalThis.document;
});

test('TR·29 — un paquet qui porte encore `zoneId` dans la salle est nettoyé à l’écriture', async () => {
  // Un fichier fabriqué à la main, ou un ancien export réinjecté sans passer par le
  // contrat, ne doit pas rouvrir la double source par la porte de l'API.
  const { access, pool, admin } = decor();
  await access.applyRoomTransfer(admin, {
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-B', zoneIds: ['Z-B'] }],
    roomZones: [{ roomId: 'r1', zoneId: 'Z-A' }]
  });
  assert.equal(pool.lire('rooms', 'r1').zoneId, undefined, 'la salle stockée garde une zone en propre');
  assert.equal(pool.lire('rooms', 'r1').zoneIds, undefined);
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A'], 'le champ de la salle a primé sur le rattachement');
});

test('TR·30 — un import ne sert pas à s’emparer d’une salle qu’on ne peut pas modifier', async () => {
  // Le chef est habilité dans Z-A. Une salle qui vit dans Z-B ne doit pas pouvoir être
  // ramenée chez lui par un simple fichier.
  const { access, pool, admin, chef } = decor();
  await access.applyRoomTransfer(admin, buildRoomTransfer([{ id: 'r1', name: 'STC' }], [{ roomId: 'r1', zoneId: 'Z-B' }]));
  await assert.rejects(
    () => access.applyRoomTransfer(chef, buildRoomTransfer([{ id: 'r1', name: 'Détournée' }], [{ roomId: 'r1', zoneId: 'Z-A' }])),
    error => error.code === 'ZONE_FORBIDDEN'
  );
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-B'], 'la salle a changé de zone malgré le refus');
  assert.equal(pool.lire('rooms', 'r1').name, 'STC', 'la salle a été renommée malgré le refus');
});
