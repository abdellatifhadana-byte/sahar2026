import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRole, resolveKnownRole, canWriteStoreByRole, assertRoleAssignment,
  CANONICAL_ROLES, ROLE_ERRORS
} from '../roles.js';
import { createAccessControl, ROLE_CEILINGS, PERMISSIONS } from '../scripts/access-control.js';

/*
 * REVUE CORRECTIVE DE LOT A — DEUX EXIGENCES BLOQUANTES.
 *
 * ── AUTH-02 · un rôle inconnu doit échouer FERMÉ ────────────────────────────
 *
 * Avant LOT A, `access-control` indexait le plafond avec la chaîne brute : un rôle abîmé
 * comme « supervisor-x » ne trouvait aucun plafond et se voyait tout refuser. LOT A a fait
 * passer la même décision par `normalizeRole()`, qui rend `visitor` pour l'inconnu — un
 * repli SAIN pour l'affichage, DANGEREUX pour l'autorisation : le compte hérite alors du
 * plafond visiteur, et une adhésion plus une habilitation suffisent à lui ouvrir des
 * lectures. C'est un élargissement, introduit par le correctif lui-même.
 *
 * Le remède n'est pas une seconde carte d'alias — ce serait retomber dans le défaut que
 * LOT A vient de fermer. C'est UNE résolution stricte bâtie sur la MÊME carte :
 *
 *     resolveKnownRole(role) → canonique | null
 *     normalizeRole(role)    → resolveKnownRole(role) ?? visitor
 *
 * L'affichage garde son repli ; l'autorisation exige un rôle connu.
 *
 * ── AUTH-03 · une permission, un sens ──────────────────────────────────────
 *
 * `WRITE_PERMISSION_BY_STORE.rooms` valait `zone.manage`, et `zone-access.js:32` étiquette
 * cette permission « Gérer les zones ». Un même nom couvrait donc deux notions : modifier
 * UNE SALLE, et administrer UNE ZONE. Donner au chef de quoi éditer une salle revenait à
 * lui promettre l'administration des accès — que son propre contrat de navigation lui
 * refuse, `zoneAccess` restant au-dessus de lui.
 *
 * Les deux notions sont séparées : `room.edit` pour la salle, `zone.manage` pour la zone.
 */

/* ══════════════════════════════ le double de connexion (couche SQL seule) */
function poolDouble(seed = {}) {
  const table = new Map();
  let horloge = 0;
  const cle = (s, i) => `${s} ${i}`;
  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) table.set(cle(store, record.id), { data: record, deleted: false, u: ++horloge });
  }
  const client = {
    async query(sql, params = []) {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      if (t.startsWith('SELECT data FROM platform_records')) {
        const l = table.get(cle(params[0], String(params[1])));
        return { rows: l && !l.deleted ? [{ data: l.data }] : [] };
      }
      if (t.startsWith('SELECT record_id,data,updated_at FROM platform_records')) {
        return { rows: [...table.entries()].filter(([k, v]) => k.split(' ')[0] === params[0] && !v.deleted)
          .sort((a, b) => a[1].u - b[1].u)
          .map(([k, v]) => ({ record_id: k.split(' ')[1], data: v.data, updated_at: v.u })) };
      }
      if (t.startsWith('INSERT INTO platform_records')) {
        const tombe = t.includes('::jsonb,TRUE');
        table.set(cle(params[0], String(params[1])), { data: tombe ? {} : JSON.parse(params[2]), deleted: tombe, u: ++horloge });
        return { rows: [] };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(t)) return { rows: [] };
      throw new Error(`requête non simulée : ${t.slice(0, 80)}`);
    },
    release() {}
  };
  return { ...client, connect: async () => client };
}

/** Un intrus PLEINEMENT équipé : adhésion active et toutes les habilitations. */
function decorIntrus(role = 'supervisor-x') {
  const userId = 'u-intrus';
  return {
    access: createAccessControl(poolDouble({
      zones: [{ id: 'Z1' }],
      resource_zones: [{ id: 'RZ1', resourceType: 'rooms', resourceId: 'salle-1', zoneId: 'Z1' }],
      rooms: [{ id: 'salle-1', name: 'STC' }],
      zone_memberships: [{ id: 'M1', userId, zoneId: 'Z1', status: 'active', responsible: true }],
      zone_grants: PERMISSIONS.map((permission, i) => ({ id: `G${i}`, userId, zoneId: 'Z1', permission, status: 'active' })),
      users: [{ id: userId, role }, { id: 1, role: 'admin' }]
    })),
    user: { id: userId, role }
  };
}

const SALLE = { id: 'salle-1', name: 'STC' };
const EQUIP = { id: 'eq-1', roomId: 'salle-1' };

/* ══════════════════════════════ AUTH-02 · résolution stricte */

test('AUTH-02·1 — resolveKnownRole rend null pour l’inconnu, jamais visiteur', () => {
  for (const connu of ['admin', 'administrateur', 'manager', 'chef', 'responsable',
    'responsible', 'technicien', 'technician', 'tech', 'visiteur', 'visitor']) {
    assert.equal(resolveKnownRole(connu), normalizeRole(connu), `« ${connu} » devrait être connu`);
  }
  for (const inconnu of ['supervisor-x', 'intrus', 'root', 'foobar', '', '   ', null, undefined, 42]) {
    assert.equal(resolveKnownRole(inconnu), null, `« ${inconnu} » est traité comme connu`);
  }
});

test('AUTH-02·2 — normalizeRole garde son repli d’affichage, bâti sur la MÊME carte', () => {
  // Deux cartes d'alias, c'est le défaut que LOT A vient de fermer : la stricte doit
  // dériver de la même source, sinon elles divergeront comme les trois précédentes.
  assert.equal(normalizeRole('intrus'), CANONICAL_ROLES.VISITOR);
  assert.equal(resolveKnownRole('intrus'), null);
  for (const entree of ['chef', 'technicien', 'administrateur', 'visiteur']) {
    assert.equal(normalizeRole(entree), resolveKnownRole(entree));
  }
});

test('AUTH-02·3 — canWriteStoreByRole échoue fermé sur un rôle inconnu', () => {
  for (const store of ['equipments', 'settings', 'users', 'tickets', 'rooms', 'notes']) {
    assert.equal(canWriteStoreByRole('supervisor-x', store), false, `écrit dans ${store}`);
    assert.equal(canWriteStoreByRole('', store), false);
    assert.equal(canWriteStoreByRole(null, store), false);
  }
  // …et les six rôles connus restent inchangés.
  assert.equal(canWriteStoreByRole('technicien', 'equipments'), true);
  assert.equal(canWriteStoreByRole('visiteur', 'equipments'), false);
});

test('AUTH-02·4 — un intrus muni d’adhésion ET de toutes les habilitations ne lit RIEN', async () => {
  const { access, user } = decorIntrus();
  assert.equal(await access.canAccessRecord(user, 'rooms', SALLE, 'read'), false);
  assert.equal(await access.canAccessRecord(user, 'equipments', EQUIP, 'read'), false);
  assert.equal(await access.canAccessRecord(user, 'tickets', { id: 't1', roomId: 'salle-1' }, 'read'), false);
});

test('AUTH-02·4bis — même sur SON PROPRE ticket, qui court-circuite le plafond', async () => {
  // `canAccessRecord` rend `true` pour le créateur d'un ticket AVANT toute résolution de
  // permission (`access-control.js:481`). C'est le seul chemin par lequel un rôle inconnu
  // pouvait encore lire quelque chose — et c'est exactement ce que la garde fail-closed
  // placée en tête intercepte. Sans ce cas, une mutation retirant cette garde survivait.
  const { access, user } = decorIntrus();
  const sien = { id: 't-sien', createdById: 'u-intrus', roomId: 'salle-1' };
  assert.equal(await access.canAccessRecord(user, 'tickets', sien, 'read'), false,
    'un rôle inconnu lit son propre ticket : la garde en tête a disparu');
  // …tandis qu'un rôle CONNU garde bien ce raccourci.
  const connu = createAccessControl(poolDouble({
    users: [{ id: 'u-t', role: 'technicien' }],
    zone_memberships: [], zone_grants: [], zones: [], resource_zones: [], rooms: []
  }));
  assert.equal(
    await connu.canAccessRecord({ id: 'u-t', role: 'technicien' }, 'tickets',
      { id: 't2', createdById: 'u-t' }, 'read'),
    true, 'le raccourci créateur a été cassé pour les rôles légitimes');
});

test('AUTH-02·5 — …et n’écrit RIEN', async () => {
  const { access, user } = decorIntrus();
  for (const [store, record] of [['rooms', SALLE], ['equipments', EQUIP], ['settings', { id: 'global' }]]) {
    assert.equal(await access.canAccessRecord(user, store, record, 'write'), false, `écrit dans ${store}`);
  }
});

test('AUTH-02·6 — son instantané /api/sync est vide', async () => {
  const { access, user } = decorIntrus();
  const vues = [];
  for (const [store, data] of [['rooms', SALLE], ['equipments', EQUIP]]) {
    if (await access.canAccessRecord(user, store, data, 'read')) vues.push(data.id);
  }
  assert.deepEqual(vues, [], 'un rôle inconnu reçoit des données opérationnelles');
});

test('AUTH-02·7 — on ne peut pas habiliter un rôle inconnu', async () => {
  const { access } = decorIntrus();
  await assert.rejects(
    () => access.grantPermission({ id: 1, role: 'admin' }, { userId: 'u-intrus', zoneId: 'Z1', permission: 'equipment.read' }),
    error => error.code === ROLE_ERRORS.INVALID_ROLE,
    'le refus devrait nommer le rôle invalide, pas un dépassement de plafond');
});

test('AUTH-02·8 — ni lui donner une adhésion', async () => {
  const { access } = decorIntrus();
  await assert.rejects(
    () => access.ensureMembership({ id: 1, role: 'admin' }, { userId: 'u-intrus', zoneId: 'Z1' }),
    error => error.code === ROLE_ERRORS.INVALID_ROLE);
});

test('AUTH-02·9 — attribuer un rôle inconnu est refusé, pas converti en visiteur', () => {
  const admin = { id: 1, role: 'admin' };
  const cible = { id: 2, role: 'technician' };
  assert.throws(() => assertRoleAssignment(admin, cible, 'foobar'),
    error => error.code === ROLE_ERRORS.INVALID_ROLE,
    'un rôle inconnu devient silencieusement visiteur');
  // Les attributions légitimes continuent de passer.
  assert.equal(assertRoleAssignment(admin, cible, 'chef'), true);
  assert.equal(assertRoleAssignment(admin, cible, 'visiteur'), true);
});

/* ══════════════════════════════ AUTH-03 · room.edit ≠ zone.manage */

test('AUTH-03·1 — écrire une salle exige `room.edit`, pas `zone.manage`', () => {
  assert.ok(PERMISSIONS.includes('room.edit'), '`room.edit` n’existe pas');
  assert.ok(PERMISSIONS.includes('zone.manage'), '`zone.manage` a disparu du vocabulaire');
});

test('AUTH-03·2 — le chef édite une salle sans obtenir l’administration des zones', async () => {
  // Son contrat de navigation lui refuse `zoneAccess` : le serveur doit dire la même chose.
  assert.ok(ROLE_CEILINGS.chef.has('room.edit'), 'le chef ne peut pas modifier de salle');
  assert.ok(!ROLE_CEILINGS.chef.has('zone.manage'), 'le chef administre les zones');
  assert.ok(!ROLE_CEILINGS.chef.has('access.review'), 'la revue des accès lui est implicitement donnée');
});

test('AUTH-03·3 — le responsable reste incapable de modifier une salle', () => {
  // `permissions.js` ne lui donne ni create, ni edit, ni assign sur `rooms`.
  assert.ok(!ROLE_CEILINGS.responsible.has('room.edit'));
  assert.ok(!ROLE_CEILINGS.technician.has('room.edit'));
  assert.ok(!ROLE_CEILINGS.visitor.has('room.edit'));
});

test('AUTH-03·4 — admin et manager gardent tout', () => {
  for (const role of ['admin', 'manager']) {
    for (const permission of PERMISSIONS) {
      assert.ok(ROLE_CEILINGS[role].has(permission), `« ${role} » a perdu ${permission}`);
    }
  }
});

test('AUTH-03·5 — exécuté : le chef écrit une salle de sa zone, pas ailleurs', async () => {
  const seed = {
    zones: [{ id: 'Z1' }, { id: 'Z2' }],
    resource_zones: [
      { id: 'RZ1', resourceType: 'rooms', resourceId: 'salle-1', zoneId: 'Z1' },
      { id: 'RZ2', resourceType: 'rooms', resourceId: 'salle-2', zoneId: 'Z2' }
    ],
    rooms: [{ id: 'salle-1' }, { id: 'salle-2' }],
    zone_memberships: [{ id: 'M1', userId: 'u-chef', zoneId: 'Z1', status: 'active' }],
    zone_grants: [{ id: 'G1', userId: 'u-chef', zoneId: 'Z1', permission: 'room.edit', status: 'active' }],
    users: [{ id: 'u-chef', role: 'chef' }]
  };
  const access = createAccessControl(poolDouble(seed));
  const chef = { id: 'u-chef', role: 'chef' };
  assert.equal(await access.canAccessRecord(chef, 'rooms', { id: 'salle-1' }, 'write'), true);
  assert.equal(await access.canAccessRecord(chef, 'rooms', { id: 'salle-2' }, 'write'), false);
});

test('AUTH-03·6 — exécuté : le responsable est refusé même habilité au maximum', async () => {
  const seed = {
    zones: [{ id: 'Z1' }],
    resource_zones: [{ id: 'RZ1', resourceType: 'rooms', resourceId: 'salle-1', zoneId: 'Z1' }],
    rooms: [{ id: 'salle-1' }],
    zone_memberships: [{ id: 'M1', userId: 'u-resp', zoneId: 'Z1', status: 'active' }],
    zone_grants: PERMISSIONS.map((p, i) => ({ id: `G${i}`, userId: 'u-resp', zoneId: 'Z1', permission: p, status: 'active' })),
    users: [{ id: 'u-resp', role: 'responsable' }]
  };
  const access = createAccessControl(poolDouble(seed));
  assert.equal(await access.canAccessRecord({ id: 'u-resp', role: 'responsable' }, 'rooms', { id: 'salle-1' }, 'write'), false,
    'le plafond du responsable ne retient plus l’écriture de salle');
});

test('AUTH-03·7 — `zone.manage` n’ouvre à personne de nouvelle porte', async () => {
  // Elle ne gate plus les salles. Seuls admin et manager peuvent la détenir — et ils
  // court-circuitent déjà les zones : la séparation ne donne donc AUCUN pouvoir nouveau.
  for (const role of ['chef', 'responsible', 'technician', 'visitor']) {
    assert.ok(!ROLE_CEILINGS[role].has('zone.manage'), `« ${role} » peut détenir zone.manage`);
  }
});

test('AUTH-03·8 — l’interface nomme la nouvelle permission', async () => {
  const { default: fs } = await import('node:fs');
  const zoneAccess = fs.readFileSync(new URL('../zone-access.js', import.meta.url), 'utf8');
  assert.match(zoneAccess, /'room\.edit':/, '`room.edit` n’a pas d’étiquette dans l’écran des accès');
});
