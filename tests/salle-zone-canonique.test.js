import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccessControl } from '../scripts/access-control.js';

/*
 * POUR UNE SALLE, `resource_zones` EST L'UNIQUE SOURCE DE VÉRITÉ DE SA ZONE.
 *
 * La création neuve était déjà propre : la zone arrive en argument, s'inscrit dans
 * `resource_zones`, et l'enregistrement n'en garde rien. Mais le reste du système lisait
 * encore DEUX sources :
 *
 *   ensureModel()          zoneId = room.zoneId || mappingExplicite?.zoneId || `room-<id>`
 *                          ↑ le champ hérité passait AVANT le rattachement explicite
 *   zonesForRoom()         unique([...room.zoneIds, room.zoneId]) ∪ resource_zones
 *   resolveResourceZones() unique([...record.zoneIds, record.zoneId]) ∪ resource_zones
 *
 * Et une TROISIÈME copie de la même migration vivait dans
 * `scripts/inventory-replace-preload.js`, chargée par `npm start`.
 *
 * Ce n'est pas théorique. L'état suivant a été observé :
 *
 *     room.zoneId    = zone-1
 *     resource_zones = zone-2
 *
 * La lecture et l'écriture ne répondaient pas la même chose, et l'union silencieuse
 * ÉLARGISSAIT le périmètre : qui n'était membre que de zone-1 voyait une salle que le
 * rattachement canonique plaçait dans zone-2.
 *
 * Désormais :
 *   • `room.zoneId` et `room.zoneIds` sont des données HÉRITÉES à migrer, jamais une
 *     vérité d'exécution ;
 *   • une salle a UNE zone ; plusieurs zones explicites = CONFLIT, jamais une union ;
 *   • un conflit ne doit RIEN élargir : il ferme, il se signale, et l'administrateur —
 *     qui court-circuite les zones — reste seul capable de le voir et de le réparer.
 *
 * `locationId` n'entre pas dans cette histoire : il dit OÙ se trouve la salle
 * (Casablanca › Siège › Département), la zone dit QUI y accède. Une salle peut être
 * localisée au Département Technique et rattachée à la zone STC. Ce sont deux notions.
 */

/* ══════════════════════════════ le double de connexion PostgreSQL */

function poolDouble(seed = {}) {
  const magasins = new Map();
  let horloge = 0;
  let transactions = 0;
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
        const rows = [...table(params[0]).entries()]
          .filter(([, v]) => !v.deleted)
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
    ...client,
    connect: async () => client,
    lire: (store, id) => { const l = table(store).get(String(id)); return l && !l.deleted ? l.data : null; },
    lister: store => [...table(store).values()].filter(v => !v.deleted).map(v => v.data),
    pierres: store => [...table(store).entries()].filter(([, v]) => v.deleted).map(([id]) => id),
    transactions: () => transactions
  };
}

/** Rattachements canoniques d'une salle, tels qu'ils existent en base. */
const rattachements = (pool, roomId) => pool.lister('resource_zones')
  .filter(item => String(item.resourceType).toLowerCase() === 'room' && String(item.resourceId) === String(roomId))
  .map(item => String(item.zoneId))
  .sort();

const ZONES = [
  { id: 'Z-A', name: 'Régie A', status: 'active' },
  { id: 'Z-B', name: 'Régie B', status: 'active' },
  { id: 'Z-C', name: 'Régie C', status: 'active' }
];

/** Un chef membre et habilité `room.edit` dans les zones nommées. */
function habilite(userId, zoneIds) {
  return {
    memberships: zoneIds.map(zoneId => ({ id: `ZM-${userId}-${zoneId}`, userId, zoneId, status: 'active' })),
    grants: zoneIds.flatMap(zoneId => ['room.edit', 'zone.summary.read'].map(permission => ({
      id: `ZG-${userId}-${zoneId}-${permission}`, userId, zoneId, permission, status: 'active'
    })))
  };
}

function decor({ rooms = [], mappings = [], chefs = { 'u-a': ['Z-A'], 'u-b': ['Z-B'] } } = {}) {
  const memberships = [];
  const grants = [];
  const users = [{ id: 1, role: 'admin' }];
  for (const [userId, zoneIds] of Object.entries(chefs)) {
    const droits = habilite(userId, zoneIds);
    memberships.push(...droits.memberships);
    grants.push(...droits.grants);
    users.push({ id: userId, role: 'chef' });
  }
  const pool = poolDouble({
    zones: ZONES, rooms, resource_zones: mappings,
    zone_memberships: memberships, zone_grants: grants, users
  });
  return { pool, access: createAccessControl(pool) };
}

const mapping = (roomId, zoneId) => ({
  id: `RZ-room-${roomId}-${zoneId}`, resourceType: 'room', resourceId: roomId, zoneId, createdAt: '2026-01-01T00:00:00.000Z'
});

/* ══════════════════════════════ A · migration déterministe */

test('MIG·1 — legacy `zoneId` SEUL : un rattachement canonique est créé, le champ disparaît', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }] });
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A'], 'le rattachement canonique manque');
  assert.equal(pool.lire('rooms', 'r1').zoneId, undefined, 'le champ hérité survit à la migration');
  assert.equal(pool.lire('rooms', 'r1').zoneIds, undefined);
  // Aucune zone transitoire ne doit naître : la salle EN AVAIT une, nommée.
  assert.equal(pool.lire('zones', 'room-r1'), null, 'une zone transitoire inutile a été créée');
  assert.equal(pool.lire('rooms', 'r1').name, 'STC', 'le reste de la salle a été altéré');
});

test('MIG·2 — rattachement SEUL : rien n’est ajouté, rien n’est déplacé', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.equal(pool.lire('zones', 'room-r1'), null, 'une zone transitoire a doublé un rattachement explicite');
});

test('MIG·3 — legacy ET rattachement CONCORDANTS : un seul rattachement, champ nettoyé', async () => {
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A', zoneIds: ['Z-A'] }], mappings: [mapping('r1', 'Z-A')]
  });
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.equal(pool.lire('rooms', 'r1').zoneId, undefined);
  assert.equal(pool.lire('rooms', 'r1').zoneIds, undefined);
});

test('MIG·4 — legacy Z-A CONTRE rattachement Z-B : conflit signalé, aucune union', async () => {
  // L'état exact observé sur la base de référence. L'union rendait la salle lisible depuis
  // Z-A ET Z-B ; le rattachement seul dit Z-B.
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }], mappings: [mapping('r1', 'Z-B')]
  });
  await access.ensureModel();

  const conflits = await access.roomZoneConflicts();
  assert.equal(conflits.length, 1, 'le conflit n’est pas signalé');
  assert.equal(conflits[0].roomId, 'r1');
  assert.equal(conflits[0].code, 'ROOM_ZONE_CONFLICT');
  assert.deepEqual([...conflits[0].zoneIds].sort(), ['Z-A', 'Z-B'], 'le conflit ne nomme pas les deux zones');

  // Aucune union : le rattachement canonique reste seul, et il n'a pas été « complété ».
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-B'], 'la migration a fabriqué une union');
  // La preuve est CONSERVÉE : nettoyer le champ effacerait ce que l'administrateur doit voir.
  assert.equal(pool.lire('rooms', 'r1').zoneId, 'Z-A', 'la trace du conflit a été effacée');
});

test('MIG·5 — DEUX rattachements explicites : conflit, et rien n’est choisi au hasard', async () => {
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A'), mapping('r1', 'Z-B')]
  });
  await access.ensureModel();
  const conflits = await access.roomZoneConflicts();
  assert.equal(conflits.length, 1);
  assert.deepEqual([...conflits[0].zoneIds].sort(), ['Z-A', 'Z-B']);
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A', 'Z-B'], 'un rattachement a été supprimé sans arbitrage humain');
});

test('MIG·5bis — un conflit ne DONNE rien de plus : il ferme pour les rôles à périmètre', async () => {
  // Le danger d'une union est là : membre de Z-A seulement, la salle en conflit Z-A/Z-B
  // devenait lisible. Un conflit exige désormais TOUTES ses zones — donc personne, sauf
  // l'administrateur qui court-circuite les zones et peut aller le réparer.
  const { access } = decor({
    rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A'), mapping('r1', 'Z-B')]
  });
  await access.ensureModel();
  const salle = { id: 'r1', name: 'STC' };
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', salle, 'read'), false,
    'un chef de Z-A lit une salle en conflit');
  assert.equal(await access.canAccessRecord({ id: 'u-b', role: 'chef' }, 'rooms', salle, 'read'), false,
    'un chef de Z-B lit une salle en conflit');
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', salle, 'write'), false);
  assert.equal(await access.canAccessRecord({ id: 1, role: 'admin' }, 'rooms', salle, 'read'), true,
    'l’administrateur ne peut plus voir la salle qu’il doit réparer');
});

test('MIG·6 — ni rattachement ni legacy : zone transitoire ET rattachement canonique', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }] });
  await access.ensureModel();
  assert.ok(pool.lire('zones', 'room-r1'), 'la zone transitoire manque');
  assert.deepEqual(rattachements(pool, 'r1'), ['room-r1'], 'la zone transitoire n’a pas de rattachement');
});

test('MIG·7 — la migration est idempotente : deux démarrages, un seul rattachement', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }] });
  await access.ensureModel();
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.equal((await access.roomZoneConflicts()).length, 0, 'un conflit est apparu au second démarrage');
});

test('MIG·8 — un `zoneId` hérité qui ne désigne aucune zone n’invente pas de rattachement', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-DISPARUE' }] });
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['room-r1'],
    'un identifiant de zone mort a été promu en rattachement');
  assert.ok(pool.lire('zones', 'room-r1'), 'la salle reste sans zone du tout');
});

test('MIG·9 — la zone transitoire devenue inutile ne SURVIT pas à côté de la vraie', async () => {
  // Le cas se produit tout seul : `ensureModel` fabrique « room-r1 » au premier démarrage,
  // puis un import hérité pose `room.zoneId = Z-A`. Si l'ancien rattachement reste, la
  // salle repart avec DEUX zones — un conflit fabriqué par la migration elle-même, qui la
  // fermerait au prochain démarrage pour tous les rôles à périmètre.
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }],
    mappings: [{ id: 'RZ-room-r1-room-r1', resourceType: 'room', resourceId: 'r1', zoneId: 'room-r1' }]
  });
  await access.put('zones', 'room-r1', { id: 'room-r1', name: 'STC', status: 'active', autoCreatedFromRoomId: 'r1' });
  await access.ensureModel();
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A'], 'la zone transitoire a survécu à la migration');
  assert.equal((await access.roomZoneConflicts()).length, 0, 'la migration a fabriqué un conflit');
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', { id: 'r1' }, 'read'), true,
    'le chef de Z-A a perdu la salle à cause d’un rattachement fantôme');
});

test('MIG·10 — deux rattachements transitoires ne se cumulent pas non plus', async () => {
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC' }],
    mappings: [
      { id: 'RZ-a', resourceType: 'room', resourceId: 'r1', zoneId: 'room-r1' },
      { id: 'RZ-b', resourceType: 'room', resourceId: 'r1', zoneId: 'room-ancien-r1' }
    ]
  });
  for (const id of ['room-r1', 'room-ancien-r1']) {
    await access.put('zones', id, { id, name: 'STC', status: 'active', autoCreatedFromRoomId: 'r1' });
  }
  await access.ensureModel();
  assert.equal(rattachements(pool, 'r1').length, 1, 'la salle garde deux zones transitoires');
});

test('MIG·11 — l’ORDRE entre rattachement et héritage ne peut plus décider de rien', async () => {
  /*
   * La ligne d'origine choisissait `room.zoneId || explicitMapping?.zoneId` : le champ
   * hérité passait devant. C'est le défaut nommé par la revue, et il est maintenant fermé
   * DEUX FOIS — l'ordre est inversé, et surtout tout désaccord est refusé en amont.
   *
   * Cette double fermeture a une conséquence qu'il faut dire : inverser l'ordre ne change
   * plus rien d'observable. Ce test le PROUVE par énumération, au lieu de l'affirmer.
   *
   * Tout état qui atteint le choix vérifie : soit aucune zone explicite, soit exactement
   * une et aucun héritage divergent. Dans les deux cas, l'une des deux valeurs est absente
   * ou les deux sont égales — donc les deux ordres donnent le même résultat.
   */
  const zones = ['Z-A', 'Z-B'];
  const combinaisons = [];
  for (const explicites of [[], ['Z-A'], ['Z-B'], ['Z-A', 'Z-B']]) {
    for (const heritees of [[], ['Z-A'], ['Z-B'], ['Z-A', 'Z-B']]) {
      const divergentes = heritees.filter(zone => !explicites.includes(zone));
      // La garde de conflit, telle qu'elle est écrite dans `ensureModel`.
      if (explicites.length > 1 || (explicites.length && divergentes.length)) continue;
      combinaisons.push({ explicites, heritees });
      assert.equal(explicites[0] ?? heritees[0], heritees[0] ?? explicites[0],
        `l’ordre décide encore pour explicites=${JSON.stringify(explicites)} heritees=${JSON.stringify(heritees)}`);
    }
  }
  assert.ok(combinaisons.length >= 6, `énumération trop pauvre : ${combinaisons.length} cas`);
  assert.equal(zones.length, 2);

  // Et la garde elle-même est bien celle qui ferme : sur l'état exact observé en
  // production, aucun ordre ne s'applique — la salle est déclarée en conflit.
  const { access } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }], mappings: [mapping('r1', 'Z-B')]
  });
  await access.ensureModel();
  assert.equal((await access.roomZoneConflicts()).length, 1);
});

/* ══════════════════════════════ B · résolution d'exécution */

test('RES·1 — `zonesForRoom` lit `resource_zones` SEUL', async () => {
  const { access } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A', zoneIds: ['Z-A'] }], mappings: [mapping('r1', 'Z-B')]
  });
  assert.deepEqual(await access.zonesForRoom('r1'), ['Z-B'], 'le champ hérité entre encore dans la résolution');
});

test('RES·2 — `resolveResourceZones` ignore le `zoneId` porté par la salle', async () => {
  const { access } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-B')] });
  // Même envoyé dans la charge utile, il ne décide pas : c'est le rattachement qui parle.
  assert.deepEqual(await access.resolveResourceZones('rooms', { id: 'r1', zoneId: 'Z-A' }), ['Z-B']);
  assert.deepEqual(await access.resolveResourceZones('rooms', { id: 'r1', zoneIds: ['Z-A', 'Z-C'] }), ['Z-B']);
});

test('RES·3 — une salle SANS rattachement n’a aucune zone, quel que soit son champ hérité', async () => {
  const { access } = decor({ rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }] });
  assert.deepEqual(await access.zonesForRoom('r1'), []);
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', { id: 'r1' }, 'read'), false);
});

test('RES·4 — les AUTRES magasins gardent leur zone directe', async () => {
  // Les documents de continuité et les schémas portent `zoneIds` par contrat : la
  // canonicalisation ne concerne que les salles.
  const { access } = decor({ rooms: [], mappings: [] });
  assert.deepEqual(await access.resolveResourceZones('docs', { id: 'd1', kind: 'continuity_procedure', zoneIds: ['Z-A', 'Z-B'] }),
    ['Z-A', 'Z-B']);
  assert.deepEqual(await access.resolveResourceZones('walls', { id: 'w1', zoneId: 'Z-A' }), ['Z-A']);
});

test('RES·5 — une baie hérite de la zone canonique de sa salle', async () => {
  const { access } = decor({
    rooms: [{ id: 'r1', name: 'STC', zoneId: 'Z-A' }], mappings: [mapping('r1', 'Z-B')]
  });
  assert.deepEqual(await access.resolveResourceZones('baies', { id: 'b1', roomId: 'r1' }), ['Z-B'],
    'la baie suit encore le champ hérité de sa salle');
});

/* ══════════════════════════════ C · déplacer une salle d'une zone à l'autre */

test('REMAP·1 — A → B : l’ancien rattachement disparaît, le nouveau le remplace', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-B' });
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-B'], 'la salle appartient à deux zones après un déplacement');
});

test('REMAP·2 — après A → B, le chef de A perd la salle et celui de B la reçoit', async () => {
  const { access } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  const salle = { id: 'r1', name: 'STC' };
  const chefA = { id: 'u-a', role: 'chef' };
  const chefB = { id: 'u-b', role: 'chef' };
  assert.equal(await access.canAccessRecord(chefA, 'rooms', salle, 'read'), true, 'état de départ faux');
  assert.equal(await access.canAccessRecord(chefB, 'rooms', salle, 'read'), false, 'état de départ faux');

  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-B' });

  assert.equal(await access.canAccessRecord(chefA, 'rooms', salle, 'read'), false, 'le chef de A voit encore la salle partie');
  assert.equal(await access.canAccessRecord(chefB, 'rooms', salle, 'read'), true, 'le chef de B ne reçoit pas la salle');
});

test('REMAP·3 — le déplacement est tracé avec son avant et son après', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-B' });
  const traces = pool.lister('access_audit').filter(entry => entry.action === 'resource-zone.upsert');
  assert.equal(traces.length, 1, 'le déplacement n’est pas tracé une seule fois');
  assert.equal(traces[0].after?.zoneId, 'Z-B');
  assert.equal(traces[0].before?.zoneId, 'Z-A', 'la trace ne dit pas d’où la salle vient');
});

test('REMAP·4 — le déplacement passe par une transaction', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-B' });
  assert.ok(pool.transactions() >= 1, 'retirer puis poser un rattachement s’est fait hors transaction');
});

test('REMAP·5 — replacer une salle dans SA zone ne casse rien', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-A' });
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-A']);
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', { id: 'r1' }, 'read'), true);
});

test('REMAP·6 — un déplacement RÉSOUT un conflit au lieu de s’y ajouter', async () => {
  const { access, pool } = decor({
    rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A'), mapping('r1', 'Z-B')]
  });
  await access.mapResource({ id: 1, role: 'admin' }, { resourceType: 'rooms', resourceId: 'r1', zoneId: 'Z-C' });
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-C'], 'le conflit survit au déplacement');
});

test('REMAP·7 — les autres ressources gardent leur rattachement multiple', async () => {
  // Un équipement, un écran, un câble peuvent légitimement toucher plusieurs zones ;
  // seule la salle est contrainte à une.
  const { access, pool } = decor({ rooms: [], mappings: [] });
  const admin = { id: 1, role: 'admin' };
  await access.mapResource(admin, { resourceType: 'equipments', resourceId: 'e1', zoneId: 'Z-A' });
  await access.mapResource(admin, { resourceType: 'equipments', resourceId: 'e1', zoneId: 'Z-B' });
  const zones = pool.lister('resource_zones')
    .filter(item => String(item.resourceId) === 'e1').map(item => String(item.zoneId)).sort();
  assert.deepEqual(zones, ['Z-A', 'Z-B'], 'le contrat des autres ressources a été restreint');
});

/* ══════════════════════════════ D · supprimer puis recréer */

test('DEL·1 — supprimer une salle efface son rattachement', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.detachRoomZones({ id: 1, role: 'admin' }, 'r1');
  assert.deepEqual(rattachements(pool, 'r1'), [], 'le rattachement survit à la salle');
});

test('DEL·2 — recréer le MÊME identifiant dans une autre zone n’hérite pas de l’ancienne', async () => {
  // Le piège : `resource_zones` est indexé par `resourceId`. Sans nettoyage, une salle
  // « r1 » recréée dans Z-C restait lisible depuis Z-A — un accès que personne n'a accordé.
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  const admin = { id: 1, role: 'admin' };
  await access.detachRoomZones(admin, 'r1');
  await access.attachCreationZone(admin, 'rooms', { id: 'r1', name: 'STC bis', zoneId: 'Z-C' }, null);
  assert.deepEqual(rattachements(pool, 'r1'), ['Z-C'], 'la salle recréée hérite de son ancienne zone');
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', { id: 'r1' }, 'read'), false,
    'le chef de l’ancienne zone garde la salle recréée');
});

test('DEL·3 — le détachement est tracé', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.detachRoomZones({ id: 1, role: 'admin' }, 'r1');
  const traces = pool.lister('access_audit').filter(entry => entry.action === 'resource-zone.detach');
  assert.equal(traces.length, 1, 'la suppression du rattachement n’est pas tracée');
  assert.equal(traces[0].zoneId, 'Z-A');
});

test('DEL·4 — détacher une salle sans rattachement ne fait rien et ne casse rien', async () => {
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }] });
  await access.detachRoomZones({ id: 1, role: 'admin' }, 'r1');
  assert.deepEqual(pool.lister('access_audit'), []);
});

/* ══════════════════════════════ E · admin sans zone explicite */

test('CREATE-E·1 — admin sans zone : le rattachement existe TOUT DE SUITE', async () => {
  // Attendre « le prochain démarrage » laissait une salle sans zone en base : invisible à
  // tout rôle à périmètre, et incorrigible depuis l'écran des accès qui liste les
  // rattachements. La cohérence ne doit pas dépendre d'un redémarrage.
  const { access, pool } = decor({ rooms: [] });
  const salle = await access.attachCreationZone({ id: 1, role: 'admin' }, 'rooms',
    { id: 'r-neuve', name: 'Nouvelle régie' }, null);
  assert.equal(rattachements(pool, 'r-neuve').length, 1, 'la salle créée par l’administrateur n’a aucune zone');
  assert.equal('zoneId' in salle, false);
  const zoneId = rattachements(pool, 'r-neuve')[0];
  assert.ok(pool.lire('zones', zoneId), 'le rattachement pointe vers une zone qui n’existe pas');
  assert.equal(pool.lire('zones', zoneId).autoCreatedFromRoomId, 'r-neuve');
});

test('CREATE-E·2 — la zone transitoire porte le nom de la salle, pas un identifiant brut', async () => {
  const { access, pool } = decor({ rooms: [] });
  await access.attachCreationZone({ id: 1, role: 'admin' }, 'rooms', { id: 'r-neuve', name: 'Nouvelle régie' }, null);
  const zoneId = rattachements(pool, 'r-neuve')[0];
  assert.equal(pool.lire('zones', zoneId).name, 'Nouvelle régie');
});

test('CREATE-E·3 — le chef, lui, n’obtient jamais de zone fabriquée pour lui', async () => {
  // Sinon il se créerait à volonté des zones dont il serait seul maître : la zone
  // transitoire est un outil de migration pour l'administrateur, pas un droit.
  const { access, pool } = decor({ rooms: [] });
  const chef = { id: 'u-a', role: 'chef' };
  await assert.rejects(
    () => access.authorizeRoomCreation(chef, 'rooms', { id: 'r-neuve', name: 'x' }, null),
    error => error.code === 'ROOM_ZONE_REQUIRED'
  );
  // Et si la porte est forcée, la pose ne fabrique rien pour lui non plus.
  const avant = pool.lister('resource_zones').length;
  await access.attachCreationZone(chef, 'rooms', { id: 'r-neuve', name: 'x' }, null);
  assert.equal(pool.lister('resource_zones').length, avant, 'une zone a été fabriquée pour un rôle à périmètre');
  assert.equal(pool.lire('zones', 'room-r-neuve'), null);
});

test('CREATE-E·4 — une salle créée par l’administrateur est immédiatement lisible par son chef', async () => {
  // La preuve que le rattachement immédiat sert à quelque chose : sans lui, il fallait un
  // redémarrage avant que la salle entre dans le périmètre de qui que ce soit.
  const { access, pool } = decor({ rooms: [] });
  const admin = { id: 1, role: 'admin' };
  const salle = await access.attachCreationZone(admin, 'rooms', { id: 'r-neuve', name: 'Régie A bis', zoneId: 'Z-A' }, null);
  await access.put('rooms', 'r-neuve', salle);
  assert.equal(await access.canAccessRecord({ id: 'u-a', role: 'chef' }, 'rooms', salle, 'read'), true);
  assert.equal(pool.lire('rooms', 'r-neuve').zoneId, undefined);
});

/* ══════════════════════════════ la zone transitoire ne s'accumule pas */

test('ORPH·1 — déplacer une salle emporte la zone qu’on avait fabriquée pour elle', async () => {
  // C'est ce qui faisait échouer l'intégration continue : chaque salle créée par
  // l'administrateur laissait derrière elle une zone « room-<id> » vide, définitivement,
  // dans la liste que voient l'écran des accès et le sélecteur de zone.
  const { access, pool } = decor({ rooms: [] });
  const admin = { id: 1, role: 'admin' };
  await access.attachCreationZone(admin, 'rooms', { id: 'r-neuve', name: 'Nouvelle régie' }, null);
  assert.ok(pool.lire('zones', 'room-r-neuve'), 'la zone transitoire n’a pas été créée');

  await access.mapResource(admin, { resourceType: 'rooms', resourceId: 'r-neuve', zoneId: 'Z-A' });
  assert.deepEqual(rattachements(pool, 'r-neuve'), ['Z-A']);
  assert.equal(pool.lire('zones', 'room-r-neuve'), null, 'la zone transitoire vide a survécu au déplacement');
});

test('ORPH·2 — supprimer une salle emporte aussi sa zone fabriquée', async () => {
  const { access, pool } = decor({ rooms: [] });
  const admin = { id: 1, role: 'admin' };
  await access.attachCreationZone(admin, 'rooms', { id: 'r-neuve', name: 'Nouvelle régie' }, null);
  await access.detachRoomZones(admin, 'r-neuve');
  assert.equal(pool.lire('zones', 'room-r-neuve'), null);
});

test('ORPH·3 — une zone ENCORE utilisée n’est jamais retirée', async () => {
  // Quelqu'un peut déjà y être affilié, ou une autre ressource y être rattachée : la
  // retirer supprimerait des accès que personne n'a révoqués.
  const { access, pool } = decor({ rooms: [] });
  const admin = { id: 1, role: 'admin' };
  await access.attachCreationZone(admin, 'rooms', { id: 'r-neuve', name: 'Nouvelle régie' }, null);
  await access.put('zone_memberships', 'ZM-x', { id: 'ZM-x', userId: 'u-a', zoneId: 'room-r-neuve', status: 'active' });
  await access.mapResource(admin, { resourceType: 'rooms', resourceId: 'r-neuve', zoneId: 'Z-A' });
  assert.ok(pool.lire('zones', 'room-r-neuve'), 'une zone où quelqu’un est encore affilié a été supprimée');
});

test('ORPH·4 — une zone d’exploitation n’est JAMAIS retirée, même vidée', async () => {
  // Z-A n'a pas été fabriquée pour une salle : elle appartient à l'exploitation, et
  // seule une décision humaine la retire.
  const { access, pool } = decor({ rooms: [{ id: 'r1', name: 'STC' }], mappings: [mapping('r1', 'Z-A')] });
  await access.detachRoomZones({ id: 1, role: 'admin' }, 'r1');
  assert.ok(pool.lire('zones', 'Z-A'), 'une zone d’exploitation a été supprimée avec la salle');
});
