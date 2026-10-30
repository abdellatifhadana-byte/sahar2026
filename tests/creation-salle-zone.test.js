import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccessControl } from '../scripts/access-control.js';

/*
 * CRÉER UNE SALLE — LE CHEMIN QUI N'EXISTAIT PAS.
 *
 * Le contrat dit deux choses qui, ensemble, ne mènent nulle part :
 *
 *   • `PERMISSIONS_MATRIX.chef.rooms.create === true` — le chef crée des salles ;
 *   • `ROLE_CEILINGS[chef]` contient `room.edit`, mais le chef NE court-circuite PAS les
 *     zones : son écriture doit tomber dans une zone où il est membre et habilité.
 *
 * Or une salle QU'ON CRÉE n'a, par construction, aucune zone :
 *
 *     resolveResourceZones('rooms', nouvelle) →
 *       direct  = [] car le formulaire n'offre aucun champ de zone
 *       mapped  = [] car `resource_zones` ne peut pas encore la référencer
 *       zonesForRoom(id) → la salle n'est pas en base → []
 *     canAccessRecord → `if (!zoneIds.length) return false`
 *
 * Donc : 403 systématique, pour tout chef, sur toute création — avec pour seule
 * explication « Vous devez être autorisé dans toutes les zones avant et après la
 * modification », qui ne nomme aucune zone et n'indique aucune action.
 *
 * Ce n'est pas la garde de zone qu'il faut désarmer : c'est la zone qu'il faut DEMANDER.
 * Elle devient un argument de création, vérifié par la même garde, puis inscrite dans
 * `resource_zones` — le modèle qui existe déjà — et retirée de l'enregistrement pour
 * qu'il n'y ait jamais deux endroits où lire la zone d'une salle.
 *
 * Ces tests EXÉCUTENT les décisions et la persistance sur un double de connexion. Le
 * parcours HTTP complet, lui, est prouvé sur PostgreSQL réel par `roles-sync-e2e.mjs`.
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
    lire: (store, id) => table(store).get(String(id))?.data ?? null,
    lister: store => [...table(store).values()].filter(v => !v.deleted).map(v => v.data),
    transactions: () => transactions
  };
}

/**
 * Le décor : DEUX zones réelles, le chef membre et habilité dans la première seulement.
 *
 * `Z-STC` et `Z-RF1` ne portent pas `autoCreatedFromRoomId` : ce sont des zones
 * d'exploitation, pas les zones transitoires que `ensureModel` fabrique au démarrage.
 */
function decor({ role = 'chef', permissions = ['room.edit'], zone = 'Z-STC', responsible = false } = {}) {
  const userId = `u-${role}`;
  const pool = poolDouble({
    zones: [
      { id: 'Z-STC', name: 'Régie STC', status: 'active' },
      { id: 'Z-RF1', name: 'RF1', status: 'active' }
    ],
    rooms: [{ id: 'salle-existante', name: 'Studio 1' }],
    resource_zones: [
      { id: 'RZ-room-salle-existante-Z-STC', resourceType: 'room', resourceId: 'salle-existante', zoneId: 'Z-STC' }
    ],
    zone_memberships: [{ id: 'M1', userId, zoneId: zone, status: 'active', responsible }],
    zone_grants: permissions.map((permission, index) => ({
      id: `G${index}`, userId, zoneId: zone, permission, status: 'active'
    })),
    users: [{ id: userId, role }]
  });
  return { pool, access: createAccessControl(pool), user: { id: userId, role } };
}

/** Une salle telle que le formulaire d'ajout l'envoie aujourd'hui : aucune zone. */
const nouvelleSalle = (extra = {}) => ({
  id: 'salle-neuve',
  name: 'Nouvelle régie',
  image: '',
  location: '',
  locationId: null,
  responsibleId: '',
  coordinates: null,
  customFields: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
});

/* ══════════════════════════════ l'autorisation de CRÉER
 *
 * Elle ne passe plus par `canAccessRecord`. Le résolveur générique lit `resource_zones`,
 * et une salle qu'on crée n'y figure pas encore ; lui faire lire aussi la charge utile
 * rouvrirait la double source que ce lot vient de fermer. La zone demandée est donc un
 * ARGUMENT, vérifié explicitement par `authorizeRoomCreation` — avec la même règle
 * « membre ∧ habilité » que partout ailleurs.
 *
 * Le refus attendu est décrit par son CODE, pas par un booléen : c'est ce que
 * l'utilisateur lira.
 */

/** Le verdict de la porte de création, réduit à ce qu'un appelant en fait. */
async function creer(access, user, salle) {
  try {
    const accorde = await access.authorizeRoomCreation(user, 'rooms', salle, null);
    return accorde ? { ok: true, zoneId: accorde.zoneId } : { ok: false, code: 'PAS_DE_PORTE' };
  } catch (error) {
    return { ok: false, code: error.code, status: error.status };
  }
}

test('CREATE·1 — chef DANS sa zone : accordé, sur la zone demandée', async () => {
  const { access, user } = decor();
  assert.deepEqual(await creer(access, user, nouvelleSalle({ zoneId: 'Z-STC' })), { ok: true, zoneId: 'Z-STC' });
});

test('CREATE·2 — chef HORS de sa zone : refusé', async () => {
  const { access, user } = decor();
  const verdict = await creer(access, user, nouvelleSalle({ zoneId: 'Z-RF1' }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'ZONE_FORBIDDEN');
  assert.equal(verdict.status, 403);
});

test('CREATE·2bis — une zone qui n’existe pas rend le MÊME refus qu’une zone interdite', async () => {
  // Distinguer les deux dirait à qui n'y a pas accès quelles zones existent.
  const { access, user } = decor();
  const inexistante = await creer(access, user, nouvelleSalle({ zoneId: 'Z-INVENTEE' }));
  const interdite = await creer(access, user, nouvelleSalle({ zoneId: 'Z-RF1' }));
  assert.deepEqual(inexistante, interdite);
});

test('CREATE·3 — chef SANS habilitation `room.edit` dans sa zone : refusé', async () => {
  const { access, user } = decor({ permissions: ['equipment.edit'] });
  assert.equal((await creer(access, user, nouvelleSalle({ zoneId: 'Z-STC' }))).code, 'ZONE_FORBIDDEN');
});

test('CREATE·4 — responsable, technicien et visiteur : aucune porte, même dans leur zone', async () => {
  // Leur plafond exclut `room.edit` : aucune habilitation de zone ne peut le leur rendre,
  // et la garde ordinaire refusera — une salle sans rattachement n'appartient à personne.
  for (const role of ['responsible', 'responsable', 'technician', 'technicien', 'technique', 'visitor', 'visiteur']) {
    const { access, user } = decor({ role, permissions: ['room.edit'], responsible: true });
    assert.equal((await creer(access, user, nouvelleSalle({ zoneId: 'Z-STC' }))).ok, false, `« ${role} » peut créer une salle`);
    assert.equal(await access.canAccessRecord(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), 'write'), false,
      `« ${role} » écrit une salle par la garde ordinaire`);
  }
});

test('CREATE·5 — admin et manager : accordés, avec ou sans zone', async () => {
  for (const role of ['admin', 'administrateur', 'manager']) {
    const { access, user } = decor({ role, permissions: [] });
    assert.deepEqual(await creer(access, user, nouvelleSalle()), { ok: true, zoneId: null },
      `« ${role} » ne peut plus créer de salle sans zone`);
    assert.deepEqual(await creer(access, user, nouvelleSalle({ zoneId: 'Z-RF1' })), { ok: true, zoneId: 'Z-RF1' },
      `« ${role} » ne peut plus créer de salle dans une zone`);
  }
});

test('CREATE·6 — un rôle inconnu ne crée rien', async () => {
  const { access, user } = decor({ role: 'superuser', permissions: ['room.edit'] });
  assert.equal((await creer(access, user, nouvelleSalle({ zoneId: 'Z-STC' }))).ok, false);
  assert.equal(await access.canAccessRecord(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), 'write'), false);
});

/* ══════════════════════════════ la zone ne se DEVINE pas */

test('CREATE·7 — la zone ne se déduit ni du nom de la salle ni du texte libre', async () => {
  // Un nom ou un emplacement qui reprend mot pour mot le nom d'une zone reste du texte.
  const { access, user } = decor();
  for (const salle of [
    nouvelleSalle({ name: 'Régie STC' }),
    nouvelleSalle({ name: 'Z-STC' }),
    nouvelleSalle({ location: 'Régie STC' }),
    nouvelleSalle({ location: 'Z-STC', name: 'Régie STC' })
  ]) {
    assert.equal((await creer(access, user, salle)).code, 'ROOM_ZONE_REQUIRED',
      `la zone a été devinée depuis « ${salle.name} / ${salle.location} »`);
  }
});

test('CREATE·8 — l’absence de zone ne vaut ni « la première » ni « la sienne »', async () => {
  // Le chef n'est membre que de Z-STC. Retomber sur « sa » zone serait commode et faux :
  // il tient plusieurs zones dès qu'on lui en octroie une seconde, et le formulaire ne
  // dirait jamais laquelle a été retenue.
  const { access, user } = decor();
  assert.equal((await creer(access, user, nouvelleSalle())).code, 'ROOM_ZONE_REQUIRED');
  assert.equal(await access.canAccessRecord(user, 'rooms', nouvelleSalle(), 'write'), false,
    'une salle sans zone a été rattachée toute seule');
});

/* ══════════════════════════════ le refus qui NOMME ce qu'il faut faire */

test('CREATE·9 — sans zone, le refus est explicite et en français', async () => {
  // Le défaut mesuré : le chef recevait « Vous devez être autorisé dans toutes les zones
  // avant et après la modification » — un message qui ne nomme aucune zone, n'indique
  // aucune action, et laisse croire à une panne d'habilitation alors qu'il manque une
  // donnée que le formulaire ne demandait pas.
  const { access, user } = decor();
  const erreur = await assert.rejects(
    () => access.authorizeRoomCreation(user, 'rooms', nouvelleSalle(), null),
    error => {
      assert.equal(error.code, 'ROOM_ZONE_REQUIRED');
      assert.equal(error.status, 400);
      assert.match(error.message, /zone/i, 'le message ne parle pas de zone');
      assert.doesNotMatch(error.message, /[a-z]{4,}\.[a-z]{4,}/,
        'le message montre un identifiant technique au lieu d’une phrase');
      return true;
    }
  );
  assert.equal(erreur, undefined);
});

test('CREATE·10 — admin et manager sans zone ne sont pas refusés : leur zone est créée au démarrage', async () => {
  for (const role of ['admin', 'manager']) {
    const { access, user } = decor({ role, permissions: [] });
    await access.authorizeRoomCreation(user, 'rooms', nouvelleSalle(), null);
  }
});

test('CREATE·11 — une MODIFICATION n’exige aucune zone : rien n’est redéplacé', async () => {
  const { access, user } = decor();
  await access.authorizeRoomCreation(user, 'rooms', { id: 'salle-existante', name: 'Studio 1 bis' },
    { id: 'salle-existante', name: 'Studio 1' });
});

test('CREATE·12 — deux zones à la fois sont refusées, pas silencieusement réduites à une', async () => {
  const { access, user } = decor();
  await assert.rejects(
    () => access.authorizeRoomCreation(user, 'rooms', nouvelleSalle({ zoneIds: ['Z-STC', 'Z-RF1'] }), null),
    error => error.code === 'ROOM_ZONE_SINGLE' && error.status === 400
  );
});

test('CREATE·13 — les autres magasins ne sont pas touchés par cette exigence', async () => {
  // Une baie, un équipement, un câble tiennent leur zone de leur salle : leur imposer un
  // `zoneId` casserait leur création sans rien y gagner.
  const { access, user } = decor();
  for (const store of ['baies', 'equipments', 'cables', 'notes', 'logs']) {
    await access.authorizeRoomCreation(user, store, { id: 'x', name: 'x' }, null);
  }
});

/* ══════════════════════════════ UNE seule vérité pour la zone d'une salle */

test('CREATE·14 — la création inscrit le rattachement canonique dans `resource_zones`', async () => {
  const { access, pool, user } = decor();
  const salle = nouvelleSalle({ zoneId: 'Z-STC' });
  await access.attachCreationZone(user, 'rooms', salle, null);
  const mappings = pool.lister('resource_zones')
    .filter(item => String(item.resourceId) === 'salle-neuve');
  assert.equal(mappings.length, 1, 'la salle créée n’a pas exactement un rattachement');
  assert.equal(mappings[0].zoneId, 'Z-STC');
  assert.equal(mappings[0].resourceType, 'room', 'le type doit être celui que lit `directMappings`');
});

test('CREATE·15 — l’enregistrement stocké ne garde PAS de zone en propre', async () => {
  // Deux endroits où lire la zone d'une salle, c'est deux réponses possibles le jour où
  // l'un est modifié sans l'autre. `resource_zones` est le seul.
  const { access, user } = decor();
  const propre = await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), null);
  assert.equal('zoneId' in propre, false, 'la salle stockée garde un `zoneId` en doublon');
  assert.equal('zoneIds' in propre, false, 'la salle stockée garde un `zoneIds` en doublon');
  assert.equal(propre.name, 'Nouvelle régie', 'le reste de la salle a été altéré');
});

test('CREATE·16 — une fois créée, la salle se relit par son rattachement seul', async () => {
  // La preuve que le rattachement suffit : on relit la salle SANS zone en propre, comme
  // le fera le client à la modification suivante, et l'autorisation tient toujours.
  const { access, pool, user } = decor();
  const propre = await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), null);
  await access.put('rooms', propre.id, propre);
  assert.deepEqual(await access.resolveResourceZones('rooms', propre), ['Z-STC']);
  assert.equal(await access.canAccessRecord(user, 'rooms', propre, 'write'), true,
    'le chef ne peut plus modifier la salle qu’il vient de créer');
  assert.equal(pool.lire('rooms', 'salle-neuve').zoneId, undefined);
});

test('CREATE·17 — une baie posée dans cette salle hérite de la même zone', async () => {
  // Le rattachement doit servir toute la chaîne, pas seulement la salle elle-même.
  const { access, user } = decor({ permissions: ['room.edit', 'equipment.edit'] });
  const propre = await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), null);
  await access.put('rooms', propre.id, propre);
  const baie = { id: 'baie-neuve', name: 'Baie 1', roomId: 'salle-neuve' };
  assert.deepEqual(await access.resolveResourceZones('baies', baie), ['Z-STC']);
  assert.equal(await access.canAccessRecord(user, 'baies', baie, 'write'), true);
});

test('CREATE·18 — une zone inexistante est nommée comme telle, pas acceptée', async () => {
  const { access, user } = decor({ role: 'admin', permissions: [] });
  await assert.rejects(
    () => access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-INVENTEE' }), null),
    error => error.code === 'ZONE_NOT_FOUND' && error.status === 404
  );
});

test('CREATE·19 — le rattachement et la salle sont écrits dans la MÊME transaction', async () => {
  // Écrire la salle puis son rattachement en deux temps laisse, si le second échoue, une
  // salle que plus personne ne peut ni voir ni corriger : sans zone, elle est refusée à
  // tout le monde sauf à l'administrateur global.
  const { access, pool, user } = decor();
  const client = await pool.connect();
  await client.query('BEGIN');
  const propre = await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), null, client);
  await access.put('rooms', propre.id, propre, client);
  await client.query('COMMIT');
  assert.equal(pool.transactions(), 1, 'la création de salle n’a pas ouvert de transaction');
  assert.equal(pool.lister('resource_zones').filter(m => m.resourceId === 'salle-neuve').length, 1);
});

test('CREATE·20 — le rattachement est tracé dans le journal d’accès', async () => {
  const { access, pool, user } = decor();
  await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: 'Z-STC' }), null);
  const traces = pool.lister('access_audit').filter(entry => entry.action === 'resource-zone.upsert');
  assert.equal(traces.length, 1, 'la création du rattachement n’est pas tracée');
  assert.equal(traces[0].actorId, 'u-chef');
  assert.equal(traces[0].zoneId, 'Z-STC');
});

test('CREATE·21bis — admin sans zone : un rattachement, vers une zone NEUVE, jamais vers une existante', async () => {
  // Ce test disait l'inverse — « aucune zone attribuée d'office, la salle recevra la
  // sienne au prochain démarrage ». La revue a tranché autrement, et pour une bonne
  // raison : une salle sans rattachement n'appartient à personne, donc aucun rôle à
  // périmètre ne la voit, et l'écran des accès ne la propose même pas au rattachement.
  //
  // Ce qu'il protégeait reste entier, et c'est ce qui est vérifié ici : la zone fabriquée
  // est NEUVE et porte l'identité de la salle. Retomber sur une zone existante — « la
  // première », « celle de l'auteur » — donnerait à la salle un périmètre que personne
  // n'a choisi. Z-STC et Z-RF1 existent : aucune des deux ne doit être retenue.
  for (const role of ['admin', 'manager']) {
    const { access, pool, user } = decor({ role, permissions: [] });
    const avant = pool.lister('resource_zones').length;
    const salle = await access.attachCreationZone(user, 'rooms', nouvelleSalle(), null);
    const siennes = pool.lister('resource_zones').filter(item => String(item.resourceId) === 'salle-neuve');
    assert.equal(siennes.length, 1, `« ${role} » : la salle créée n’a pas exactement un rattachement`);
    assert.equal(pool.lister('resource_zones').length, avant + 1, `« ${role} » : un autre rattachement a bougé`);
    assert.ok(!['Z-STC', 'Z-RF1'].includes(siennes[0].zoneId),
      `« ${role} » : une zone d’exploitation existante a été attribuée d’office`);
    assert.equal(pool.lire('zones', siennes[0].zoneId).autoCreatedFromRoomId, 'salle-neuve');
    assert.equal(salle.name, 'Nouvelle régie');
  }
});

test('CREATE·21ter — un `zoneId` vide ou nul ne vaut pas « la première zone »', async () => {
  const { access, pool, user } = decor({ role: 'admin', permissions: [] });
  for (const vide of ['', null, undefined]) {
    const salle = await access.attachCreationZone(user, 'rooms', nouvelleSalle({ zoneId: vide }), null);
    const siennes = pool.lister('resource_zones').filter(item => String(item.resourceId) === 'salle-neuve');
    assert.equal(siennes.length, 1, `« ${String(vide)} » : plus d’un rattachement`);
    assert.ok(!['Z-STC', 'Z-RF1'].includes(siennes[0].zoneId),
      `« ${String(vide)} » a été interprété comme une zone existante`);
    assert.equal('zoneId' in salle, false);
  }
});

test('CREATE·21 — modifier une salle existante n’écrit aucun rattachement', async () => {
  const { access, pool, user } = decor();
  const avant = pool.lister('resource_zones').length;
  const inchangee = await access.attachCreationZone(user, 'rooms',
    { id: 'salle-existante', name: 'Studio 1 bis' }, { id: 'salle-existante', name: 'Studio 1' });
  assert.equal(pool.lister('resource_zones').length, avant, 'une modification a créé un rattachement');
  assert.equal(inchangee.name, 'Studio 1 bis');
});
