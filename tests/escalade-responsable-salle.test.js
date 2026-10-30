import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccessControl } from '../scripts/access-control.js';

/*
 * A-1 — `room.responsibleId` NE FABRIQUE PLUS D'AUTORITÉ.
 *
 * MESURÉ au commit a3e2dd0, sur PostgreSQL réel et par HTTP (chef ne détenant que
 * `room.edit` + `zone.summary.read` dans sa zone) :
 *
 *     PUT /api/data/rooms/r1 {responsibleId:"u-chef"}   → 200
 *     redémarrage du serveur → ensureModel()
 *     habilitations NOUVELLES du chef                   → 23
 *       dont equipment.edit, topology.edit,
 *            continuity.validate, access.review         → true
 *       attribuées par (grantedBy)                      → [1]  (l'ADMINISTRATEUR)
 *     entrées access_audit                              → 0
 *     retrait de responsibleId → révocation             → aucune
 *     responsibleId vers un VISITEUR                    → 24 habilitations,
 *       dont 4 AU-DESSUS de son plafond de rôle, et une adhésion `responsible: true`
 *
 * Quatre gardes existaient pour ce même acte, sur le chemin explicite du même fichier :
 * `RESPONSIBLE_ASSIGN_ADMIN_ONLY`, `ROLE_CEILING`, `DELEGATION_CEILING` et `audit()`.
 * Un `put()` direct dans `ensureModel()` les contournait toutes les quatre, et l'escalade
 * était DIFFÉRÉE au démarrage suivant — donc invisible à l'instant de l'écriture.
 *
 * L'invariant que ces épreuves tiennent : une modification de salle ne crée JAMAIS
 * d'adhésion, d'habilitation ni d'autorité de zone en dehors du chemin canonique —
 * celui qui porte un acteur, des plafonds et une trace.
 */

/* ══════════════════════════════ le double de connexion PostgreSQL */

function poolDouble(seed = {}) {
  const magasins = new Map();
  let horloge = 0;
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
        const tombe = texte.includes('::jsonb,TRUE');
        table(params[0]).set(String(params[1]), {
          data: tombe ? {} : JSON.parse(params[2]), deleted: tombe, updatedAt: ++horloge
        });
        return { rows: [] };
      }
      if (texte === 'BEGIN') return { rows: [] };
      if (/^(COMMIT|ROLLBACK)$/.test(texte)) return { rows: [] };
      throw new Error(`requête non simulée : ${texte.slice(0, 90)}`);
    },
    release() {}
  };
  return {
    ...client,
    connect: async () => client,
    lire: (store, id) => { const l = table(store).get(String(id)); return l && !l.deleted ? l.data : null; },
    lister: store => [...table(store).values()].filter(v => !v.deleted).map(v => v.data)
  };
}

const ADMIN = { id: 1, role: 'admin' };
const CHEF = { id: 'u-chef', role: 'chef' };

/**
 * Désigner un responsable comme le fait le serveur : ÉCRIRE LA SALLE, PUIS réconcilier.
 *
 * L'ordre n'est pas cosmétique. Le réconciliateur décompte les salles qui nomment
 * l'utilisateur ; il doit donc lire la décision qui vient d'être prise, pas celle d'avant.
 * `serve.js` écrit la salle dans la transaction avant d'appeler — ces épreuves font pareil,
 * sans quoi elles testeraient une séquence qui n'existe nulle part.
 */
async function assigner(access, pool, actor, roomId, responsibleId, previous) {
  const salle = pool.lire('rooms', roomId);
  const avant = previous !== undefined ? previous : (salle?.responsibleId ?? '');
  if (salle) salle.responsibleId = responsibleId;
  return access.applyResponsibleAssignment(actor, { roomId, responsibleId, previousResponsibleId: avant });
}

/**
 * Le décor minimal : une zone, une salle rattachée, et des comptes.
 *
 * Le chef y détient EXACTEMENT ce qu'il faut pour modifier la salle — `room.edit` et
 * `zone.summary.read` — et rien de plus. C'est tout l'intérêt : l'escalade partait de là.
 */
function decor({ responsibleId, grantsSupplementaires = [] } = {}) {
  const salle = { id: 'r1', name: 'STC', ...(responsibleId ? { responsibleId } : {}) };
  const pool = poolDouble({
    zones: [{ id: 'Z-A', name: 'Régie A', status: 'active' }],
    rooms: [salle],
    resource_zones: [{ id: 'RZ-room-r1-Z-A', resourceType: 'room', resourceId: 'r1', zoneId: 'Z-A', createdAt: '2026-01-01T00:00:00.000Z' }],
    users: [ADMIN, CHEF,
      { id: 'u-resp', role: 'responsible' }, { id: 'u-resp2', role: 'responsible' },
      { id: 'u-visit', role: 'visitor' }],
    zone_memberships: [{ id: 'ZM-u-chef-Z-A', userId: 'u-chef', zoneId: 'Z-A', status: 'active' }],
    zone_grants: [
      ...['room.edit', 'zone.summary.read'].map(permission => ({
        id: `ZG-u-chef-Z-A-${permission}`, userId: 'u-chef', zoneId: 'Z-A', permission, status: 'active'
      })),
      ...grantsSupplementaires
    ]
  });
  return { pool, access: createAccessControl(pool), salle };
}

const habilitations = (pool, userId) => pool.lister('zone_grants')
  .filter(item => String(item.userId) === String(userId) && item.status === 'active')
  .map(item => item.permission).sort();

const estResponsable = (pool, userId, zoneId = 'Z-A') =>
  pool.lister('zone_memberships').some(item =>
    String(item.userId) === String(userId) && String(item.zoneId) === zoneId && item.responsible === true);

/* ══════════════════════════════ A · le démarrage ne crée plus d'autorité */

test('A-1·1 — `ensureModel()` n’écrit AUCUNE habilitation depuis `room.responsibleId`', async () => {
  // Le cœur de la faille : la salle porte déjà un responsable, et le démarrage suffisait
  // à le doter de 24 habilitations. Il ne doit plus rien en tirer.
  const { pool, access } = decor({ responsibleId: 'u-resp' });
  await access.ensureModel();

  assert.deepEqual(habilitations(pool, 'u-resp'), [],
    'aucune habilitation ne doit naître d’un démarrage');
  assert.equal(estResponsable(pool, 'u-resp'), false,
    'aucune adhésion responsable ne doit naître d’un démarrage');
  assert.deepEqual(pool.lister('access_audit'), [],
    'et rien à auditer, puisque rien n’est écrit');
});

test('A-1·2 — un chef qui se désigne lui-même ne gagne rien au redémarrage', async () => {
  // La variante mesurée : le chef passe de 2 à 25 habilitations, dont `equipment.edit`,
  // `continuity.validate` et `diagram.validate`.
  const { pool, access } = decor({ responsibleId: 'u-chef' });
  const avant = habilitations(pool, 'u-chef');
  await access.ensureModel();

  assert.deepEqual(habilitations(pool, 'u-chef'), avant,
    'le chef sort du démarrage avec exactement ce qu’il y est entré');
  assert.deepEqual(avant, ['room.edit', 'zone.summary.read']);
  assert.equal(estResponsable(pool, 'u-chef'), false);
});

test('A-1·3 — un redémarrage RÉPÉTÉ n’introduit aucune habilitation', async () => {
  // La faille était différée : c'est le énième démarrage qui la matérialisait.
  const { pool, access } = decor({ responsibleId: 'u-visit' });
  for (let i = 0; i < 3; i++) await access.ensureModel();

  assert.deepEqual(habilitations(pool, 'u-visit'), []);
  assert.equal(estResponsable(pool, 'u-visit'), false);
});

/* ══════════════════════════════ B · le serveur tranche qui peut désigner */

test('A-1·4 — un chef ne peut PAS se désigner responsable (auto-escalade)', () => {
  const { access, salle } = decor();
  assert.throws(
    () => access.assertResponsibleAssignment(CHEF, 'rooms', { ...salle, responsibleId: 'u-chef' }, salle),
    error => error.status === 403 && error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
});

test('A-1·5 — un chef ne peut PAS désigner un TIERS responsable', () => {
  // Poser un responsable de zone sans administrateur : la seconde conséquence mesurée.
  const { access, salle } = decor();
  assert.throws(
    () => access.assertResponsibleAssignment(CHEF, 'rooms', { ...salle, responsibleId: 'u-resp' }, salle),
    error => error.status === 403 && error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
});

test('A-1·6 — un chef ne peut pas davantage RETIRER le responsable', () => {
  // Retirer est aussi un acte d'autorité : il démet quelqu'un.
  const { access, salle } = decor({ responsibleId: 'u-resp' });
  assert.throws(
    () => access.assertResponsibleAssignment(CHEF, 'rooms', { ...salle, responsibleId: '' }, salle),
    error => error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
});

test('A-1·7 — modifier une salle SANS toucher au responsable reste libre', () => {
  // La garde ne doit pas confisquer `room.edit` : un chef renomme toujours sa salle, et
  // réémettre le responsable actuel — ce que fait tout enregistrement de formulaire —
  // n'est pas un changement d'autorité.
  const { access, salle } = decor({ responsibleId: 'u-resp' });
  assert.equal(access.assertResponsibleAssignment(CHEF, 'rooms', { ...salle, name: 'STC 2' }, salle), false);
  assert.equal(access.assertResponsibleAssignment(CHEF, 'rooms', { ...salle, name: 'STC 2', responsibleId: 'u-resp' }, salle), false);
});

test('A-1·8 — la garde ne vise que les salles', () => {
  const { access } = decor();
  assert.equal(access.assertResponsibleAssignment(CHEF, 'baies', { id: 'b1', responsibleId: 'u-chef' }, { id: 'b1' }), false);
});

/* ══════════════════════════════ C · le chemin légitime, lui, fonctionne */

test('A-1·9 — l’administrateur désigne un responsable : adhésion, habilitations, audit', async () => {
  const { pool, access, salle } = decor();
  assert.equal(access.assertResponsibleAssignment(ADMIN, 'rooms', { ...salle, responsibleId: 'u-resp' }, salle), true);
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');

  assert.equal(estResponsable(pool, 'u-resp'), true, 'l’adhésion responsable est posée');
  const acquises = habilitations(pool, 'u-resp');
  assert.ok(acquises.includes('access.review'), 'le responsable peut revoir les accès de sa zone');
  assert.ok(acquises.includes('equipment.edit'));

  // L'IMPUTATION — c'est ce que `grantedBy: 1` en dur détruisait.
  const octrois = pool.lister('zone_grants').filter(item => item.userId === 'u-resp');
  assert.deepEqual([...new Set(octrois.map(item => item.grantedBy))], [ADMIN.id],
    'chaque habilitation est attribuée à l’acteur réel');

  // LA TRACE — il n'y en avait aucune.
  const trace = pool.lister('access_audit');
  assert.ok(trace.length >= octrois.length,
    'chaque octroi laisse une entrée d’audit');
  assert.deepEqual([...new Set(trace.map(item => String(item.actorId)))], [String(ADMIN.id)]);
  assert.ok(trace.some(item => item.action === 'membership.upsert'));
  assert.ok(trace.some(item => item.action === 'grant.upsert'));
});

test('A-1·10 — aucune habilitation n’échappe au chemin canonique', async () => {
  // L'invariant, dit frontalement : toute habilitation présente porte un acteur, une
  // date d'octroi et un statut — la forme que seul `grantPermission` produit.
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');

  for (const octroi of pool.lister('zone_grants').filter(item => item.userId === 'u-resp')) {
    assert.equal(octroi.grantedBy, ADMIN.id, `${octroi.permission} sans acteur`);
    assert.ok(octroi.grantedAt, `${octroi.permission} sans date`);
    assert.equal(octroi.status, 'active');
    assert.equal(octroi.source, 'room-responsible', `${octroi.permission} sans provenance`);
  }
});

test('A-1·18 — l’imputation nomme l’ACTEUR, pas l’administrateur global', async () => {
  /*
   * `grantedBy: 1` était écrit EN DUR par l'ancien chemin : toute habilitation, quelle que
   * soit son origine, était attribuée au compte administrateur `1`. L'audit désignait donc
   * systématiquement la mauvaise personne.
   *
   * L'acteur de cette épreuve est un MANAGER d'identifiant 7 — et non l'administrateur `1` —
   * précisément pour que la valeur codée en dur et l'acteur réel ne puissent pas coïncider.
   */
  const MANAGER = { id: 7, role: 'manager' };
  const { pool, access, salle } = decor();
  assert.equal(access.assertResponsibleAssignment(MANAGER, 'rooms', { ...salle, responsibleId: 'u-resp' }, salle), true);
  await assigner(access, pool, MANAGER, 'r1', 'u-resp', '');

  const octrois = pool.lister('zone_grants').filter(item => item.userId === 'u-resp');
  assert.ok(octrois.length > 0);
  assert.deepEqual([...new Set(octrois.map(item => item.grantedBy))], [7],
    'les habilitations sont imputées au manager qui les a décidées');

  const adhesion = pool.lister('zone_memberships').find(item => item.userId === 'u-resp' && item.responsible === true);
  assert.ok(adhesion, 'l’adhésion responsable existe');

  const trace = pool.lister('access_audit');
  assert.deepEqual([...new Set(trace.map(item => String(item.actorId)))], ['7'],
    'et la trace nomme le même acteur');
});

test('A-1·19 — la révocation aussi nomme son acteur', async () => {
  const MANAGER = { id: 7, role: 'manager' };
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');
  await assigner(access, pool, MANAGER, 'r1', '', 'u-resp');

  const revocations = pool.lister('zone_grants').filter(item => item.userId === 'u-resp' && item.status === 'revoked');
  assert.ok(revocations.length > 0);
  assert.deepEqual([...new Set(revocations.map(item => item.revokedBy))], [7],
    'celui qui révoque est nommé, et ce n’est pas l’administrateur par défaut');
});

/* ══════════════════════════════ D · les plafonds tiennent */

test('A-1·11 — un VISITEUR ne reçoit aucune habilitation au-dessus de son plafond', async () => {
  // La troisième conséquence mesurée : 24 habilitations persistées hors plafond, prêtes
  // à s'activer le jour d'une promotion.
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-visit', '');

  const acquises = habilitations(pool, 'u-visit');
  const plafond = access.ROLE_CEILINGS.visitor;
  for (const permission of acquises) {
    assert.ok(plafond.has(permission), `${permission} dépasse le plafond du visiteur`);
  }
  for (const interdite of ['equipment.edit', 'continuity.validate', 'diagram.edit', 'access.review', 'topology.edit']) {
    assert.ok(!acquises.includes(interdite), `${interdite} n’aurait jamais dû être écrite`);
  }
});

test('A-1·12 — le plafond tient AUSSI au redémarrage suivant', async () => {
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-visit', '');
  const apresAssignation = habilitations(pool, 'u-visit');
  await access.ensureModel();
  assert.deepEqual(habilitations(pool, 'u-visit'), apresAssignation,
    'le démarrage ne complète pas ce que le plafond a refusé');
});

/* ══════════════════════════════ E · retrait et changement ne laissent pas d'orphelin */

test('A-1·13 — retirer le responsable révoque l’autorité qu’il en tenait', async () => {
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');
  assert.ok(habilitations(pool, 'u-resp').length > 0);

  await assigner(access, pool, ADMIN, 'r1', '', 'u-resp');

  assert.equal(estResponsable(pool, 'u-resp'), false, 'l’autorité de zone tombe');
  assert.deepEqual(habilitations(pool, 'u-resp'), [],
    'et les habilitations qui en découlaient aussi — c’est ce qui était irréversible');
});

test('A-1·14 — changer de responsable démet le sortant et dote l’entrant', async () => {
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'r1', 'u-resp2', 'u-resp');

  assert.equal(estResponsable(pool, 'u-resp'), false);
  assert.deepEqual(habilitations(pool, 'u-resp'), []);
  assert.equal(estResponsable(pool, 'u-resp2'), true);
  assert.ok(habilitations(pool, 'u-resp2').includes('access.review'));
});

test('A-1·15 — la révocation est TRACÉE, comme l’octroi', async () => {
  const { pool, access } = decor();
  await assigner(access, pool, ADMIN, 'r1', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'r1', '', 'u-resp');

  const revocations = pool.lister('access_audit').filter(item => item.action === 'grant.revoke');
  assert.ok(revocations.length > 0, 'une révocation sans trace ne vaut pas mieux qu’un octroi sans trace');
  assert.deepEqual([...new Set(revocations.map(item => String(item.actorId)))], [String(ADMIN.id)]);
});

/* ══════════════════════════════ F · la sûreté des données */

test('A-1·16 — un octroi EXPLICITE survit au retrait du responsable', async () => {
  /*
   * L'identifiant d'une habilitation est déterministe : `ZG-utilisateur-zone-permission`.
   * Un octroi explicite et un octroi induit par la salle visent donc LA MÊME ligne.
   *
   * MESURÉ pendant la mise au point de ce correctif, sur PostgreSQL réel : sans la garde
   * de provenance, désigner un visiteur responsable réécrivait son `equipment.read`
   * octroyé à la main, et le retrait du responsable le révoquait ensuite. Une décision
   * d'administrateur disparaissait sans que personne l'ait demandé.
   */
  const { pool, access } = decor({
    grantsSupplementaires: [{
      id: 'ZG-u-visit-Z-A-equipment.read', userId: 'u-visit', zoneId: 'Z-A',
      permission: 'equipment.read', status: 'active', grantedBy: 1, grantedAt: '2026-01-01T00:00:00.000Z'
    }]
  });

  await assigner(access, pool, ADMIN, 'r1', 'u-visit', '');
  const capture = pool.lire('zone_grants', 'ZG-u-visit-Z-A-equipment.read');
  assert.notEqual(capture.source, 'room-responsible',
    'l’assignation ne s’approprie pas un octroi qu’elle n’a pas fait');

  await assigner(access, pool, ADMIN, 'r1', '', 'u-visit');
  assert.ok(habilitations(pool, 'u-visit').includes('equipment.read'),
    'l’octroi explicite survit au retrait du responsable');
});

test('A-1·17 — les lignes héritées de la migration ne sont PAS supprimées', async () => {
  /*
   * SÛRETÉ DES DONNÉES. Les habilitations écrites par l'ancien `ensureModel()` portent
   * `source: 'room-responsible-migration'`. Leur origine n'est pas imputable une à une :
   * on ne sait pas si un administrateur aurait pris la même décision. Un démarrage n'est
   * pas le lieu d'une purge — leur sort relève d'une migration auditée, décidée à part.
   */
  const { pool, access } = decor({
    responsibleId: 'u-resp',
    grantsSupplementaires: [{
      id: 'ZG-u-resp-Z-A-equipment.edit', userId: 'u-resp', zoneId: 'Z-A', permission: 'equipment.edit',
      status: 'active', grantedBy: 1, grantedAt: '2026-01-01T00:00:00.000Z', source: 'room-responsible-migration'
    }]
  });

  await access.ensureModel();
  assert.ok(habilitations(pool, 'u-resp').includes('equipment.edit'),
    'le démarrage ne purge rien de lui-même');
  assert.equal(pool.lire('zone_grants', 'ZG-u-resp-Z-A-equipment.edit').source, 'room-responsible-migration',
    'et la provenance héritée reste lisible, pour que la migration puisse la reconnaître');
});

/* ══════════════════════════════ G · cycle de vie multi-salles (revue indépendante)
 *
 * Les épreuves ci-dessus tiennent l'escalade. Celles-ci tiennent le CYCLE DE VIE, et elles
 * viennent d'une revue indépendante qui a trouvé trois défauts que les dix-neuf premières
 * ne voyaient pas : toutes étaient bâties autour d'une seule salle `r1`.
 */

/** Un décor à plusieurs salles et plusieurs zones. */
function decorMulti({ rooms = [], mappings = [], memberships = [], grants = [], zones = ['Z', 'Z2'] } = {}) {
  const pool = poolDouble({
    zones: zones.map(id => ({ id, name: `Zone ${id}`, status: 'active' })),
    rooms,
    resource_zones: mappings,
    users: [ADMIN, CHEF,
      { id: 'u-resp', role: 'responsible' }, { id: 'u-resp2', role: 'responsible' },
      { id: 'u-visit', role: 'visitor' }],
    zone_memberships: memberships,
    zone_grants: grants
  });
  return { pool, access: createAccessControl(pool) };
}

const rattachement = (roomId, zoneId) => ({
  id: `RZ-room-${roomId}-${zoneId}`, resourceType: 'room', resourceId: roomId, zoneId,
  createdAt: '2026-01-01T00:00:00.000Z'
});

const actives = (pool, userId, zoneId) => pool.lister('zone_grants')
  .filter(item => String(item.userId) === String(userId) && String(item.zoneId) === String(zoneId) && item.status === 'active')
  .map(item => item.permission).sort();

const responsableDe = (pool, userId, zoneId) => pool.lister('zone_memberships')
  .some(item => String(item.userId) === String(userId) && String(item.zoneId) === String(zoneId) && item.responsible === true);

test('A-1·20 — deux salles d’une MÊME zone : retirer l’une ne détruit pas l’autre', async () => {
  /*
   * A1-R1. `ZG-utilisateur-zone-permission` est deterministe : les salles A et B de la zone
   * Z partagent UNE ligne par permission. Avant correction, retirer le responsable de A
   * revoquait les 24 habilitations et l'adhesion, alors que B le nommait toujours.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' },
            { id: 'rB', name: 'Salle B', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z'), rattachement('rB', 'Z')]
  });

  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rB', 'u-resp', '');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true);
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24);

  // On retire u-resp de la salle A. La salle B le nomme TOUJOURS.
  pool.lire('rooms', 'rA').responsibleId = '';
  const bilan = await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true,
    'la salle B justifie encore l’autorité : elle ne tombe pas');
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24,
    'et aucune habilitation n’est révoquée');
  assert.deepEqual(bilan.revoked, []);
  assert.deepEqual(bilan.retenu, [{ userId: 'u-resp', zoneId: 'Z', rooms: ['rB'] }],
    'le bilan nomme la salle qui retient l’autorité');
});

test('A-1·21 — retirer la DERNIÈRE salle justificative retire bien l’autorité', async () => {
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' },
            { id: 'rB', name: 'Salle B', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z'), rattachement('rB', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rB', 'u-resp', '');

  // La salle A cesse de le nommer — le décor doit refléter la décision avant le calcul.
  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true, 'B justifie encore');

  // Puis la salle B, la dernière.
  await assigner(access, pool, ADMIN, 'rB', '', 'u-resp');

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'plus aucune salle ne le nomme');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), [], 'l’autorité dérivée disparaît entièrement');
});

test('A-1·22 — un responsable de zone EXPLICITE survit au retrait de la salle', async () => {
  /*
   * A1-R2. `ZM-utilisateur-zone` est deterministe lui aussi. Une decision prise dans Acces
   * Zone ne porte aucune provenance : avant correction, le cycle de vie d'une salle la
   * rétrogradait en `responsible: false`. C'est la symetrie exacte de la capture d'octroi
   * explicite déjà fermée par A-1·16.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{
      id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: true, status: 'active',
      startsAt: '2026-01-01T00:00:00.000Z', expiresAt: null, authVersion: 3,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }]
  });
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true, 'décision explicite de départ');

  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').responsibleSource, undefined,
    'l’assignation ne s’approprie pas une autorité qu’elle n’a pas créée');

  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true,
    'la décision d’administration de zone survit au cycle de vie de la salle');
});

test('A-1·23 — l’autorité POSÉE par une salle porte sa provenance et retombe', async () => {
  // Le pendant du précédent : ce que la salle a créé, la salle peut le reprendre.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').responsibleSource, 'room-responsible');

  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false);
});

test('A-1·24 — une adhésion SIMPLE (non responsable) n’est pas détruite par le passage', async () => {
  // Rétrograder le drapeau ne doit pas retirer l'appartenance à la zone.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{ id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: false, status: 'active', authVersion: 2 }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');

  const adhesion = pool.lire('zone_memberships', 'ZM-u-resp-Z');
  assert.equal(adhesion.responsible, false, 'le drapeau retombe');
  assert.equal(adhesion.status, 'active', 'mais l’adhésion à la zone demeure');
});

test('A-1·25 — une habilitation EXPIRÉE ne bloque pas la création d’une habilitation effective', async () => {
  /*
   * A1-R3. Le raccourci « déjà détenue » lisait `status === 'active'` sans consulter
   * `expiresAt`. Une ligne périmée faisait donc réussir l'assignation en apparence, en
   * laissant le responsable SANS la permission.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [{
      id: 'ZG-u-resp-Z-equipment.edit', userId: 'u-resp', zoneId: 'Z', permission: 'equipment.edit',
      status: 'active', grantedBy: 1, grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z'
    }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');

  assert.equal(await access.hasPermission({ id: 'u-resp', role: 'responsible' }, 'Z', 'equipment.edit'), true,
    'la permission est RÉELLEMENT détenue, pas seulement inscrite');
  assert.equal(pool.lire('zone_grants', 'ZG-u-resp-Z-equipment.edit').expiresAt, null,
    'la ligne périmée a été remplacée par une ligne effective');
});

test('A-1·26 — une habilitation explicite ENCORE EFFECTIVE reste intouchée', async () => {
  // La contrepartie : `activeAt()` ne doit pas servir de prétexte à tout réécrire.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [{
      id: 'ZG-u-resp-Z-equipment.edit', userId: 'u-resp', zoneId: 'Z', permission: 'equipment.edit',
      status: 'active', grantedBy: 9, grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');

  const ligne = pool.lire('zone_grants', 'ZG-u-resp-Z-equipment.edit');
  assert.equal(ligne.grantedBy, 9, 'l’octroi explicite garde son auteur');
  assert.equal(ligne.source, undefined, 'et n’est pas réétiqueté');

  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.ok(actives(pool, 'u-resp', 'Z').includes('equipment.edit'),
    'il survit au retrait du responsable');
});

test('A-1·27 — deux salles dans des zones DIFFÉRENTES restent indépendantes', async () => {
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' },
            { id: 'rB', name: 'Salle B', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z'), rattachement('rB', 'Z2')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rB', 'u-resp', '');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true);
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true);

  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'la zone Z perd son responsable');
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true, 'la zone Z2 n’est pas concernée');
  assert.equal(actives(pool, 'u-resp', 'Z2').length, 24);
});

test('A-1·28 — une salle SANS zone ne peut pas recevoir de responsable (fermé)', async () => {
  /*
   * Sans zone canonique, aucune autorité ne peut être posée. Rendre 200 en enregistrant
   * `responsibleId` afficherait un responsable qui n'en est pas un — et l'écart ne se
   * verrait qu'au moment où quelqu'un compterait sur lui.
   */
  const { pool, access } = decorMulti({ rooms: [{ id: 'orphan', name: 'Salle orpheline' }], mappings: [] });
  await assert.rejects(
    () => assigner(access, pool, ADMIN, 'orphan', 'u-resp', ''),
    error => error.status === 409 && error.code === 'ROOM_ZONE_REQUIRED_FOR_RESPONSIBLE');
});

test('A-1·29 — mais on peut toujours RETIRER le responsable d’une salle sans zone', async () => {
  // Fermer la promotion ne doit pas interdire de réparer une salle héritée.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'orphan', name: 'Salle orpheline', responsibleId: 'u-resp' }], mappings: []
  });
  const bilan = await assigner(access, pool, ADMIN, 'orphan', '', 'u-resp');
  assert.deepEqual(bilan.zones, []);
});

test('A-1·30 — la provenance ne se déclare pas depuis la requête HTTP', async () => {
  /*
   * `POST /api/access/grants` et `/api/access/memberships` passent `await readJson(req)`
   * tel quel au chemin canonique. Si la provenance se lisait dans cet objet, un appelant
   * pourrait estampiller son propre octroi « né d'une salle » — donc en programmer la
   * révocation automatique — ou faire révoquer celui d'un tiers au prochain retrait de
   * responsable. Elle est un argument positionnel du serveur, et cette épreuve le tient.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  // Exactement la forme d'un corps HTTP hostile.
  await access.grantPermission(ADMIN, {
    userId: 'u-resp', zoneId: 'Z', permission: 'equipment.read',
    source: 'room-responsible', roomId: 'rA'
  });
  const octroi = pool.lire('zone_grants', 'ZG-u-resp-Z-equipment.read');
  assert.equal(octroi.source, undefined, 'la provenance déclarée par la requête est ignorée');
  assert.equal(octroi.roomId, undefined);

  await access.ensureMembership(ADMIN, {
    userId: 'u-resp', zoneId: 'Z', responsible: true, responsibleSource: 'room-responsible'
  });
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').responsibleSource, undefined,
    'et l’adhésion reste une décision explicite');
});

test('A-1·31 — le démarrage ne ressuscite pas une autorité retirée', async () => {
  // Le scénario complet : on pose, on retire, on redémarre.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false);

  await access.ensureModel();
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'le démarrage n’invente rien');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), []);
});

/* ══════════════════════════════ H · TOUS les écrivains, une seule règle (ronde 3)
 *
 * La réconciliation ne vivait que dans le `PUT` ordinaire. Quatre autres chemins touchent
 * au même concept : le dépôt, la suppression, le remap de zone et l'amorçage. Ces épreuves
 * tiennent la règle commune — l'autorité dérivée vaut ce que disent les salles — à
 * l'endroit du modèle, là où les preuves PostgreSQL la tiennent de bout en bout.
 */

test('A-1·32 — le dépôt refuse un changement de responsable par un rôle à périmètre', async () => {
  /*
   * R4. MESURÉ : `PUT {responsibleId}` rendait 403 à un chef, et le MÊME changement passé
   * par `POST /api/rooms/transfer` rendait 200 — la salle nommait alors un responsable que
   * `zone_grants` ignorait. Deux écrivains, deux règles, un seul concept.
   */
  const { access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [{ id: 'ZG-u-chef-Z-room.edit', userId: 'u-chef', zoneId: 'Z', permission: 'room.edit', status: 'active' }],
    memberships: [{ id: 'ZM-u-chef-Z', userId: 'u-chef', zoneId: 'Z', status: 'active' }]
  });
  await assert.rejects(
    () => access.applyRoomTransfer(CHEF, {
      rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
      roomZones: [{ roomId: 'rA', zoneId: 'Z' }]
    }),
    error => error.status === 403 && error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
});

test('A-1·33 — le dépôt laisse passer un responsable INCHANGÉ pour un rôle à périmètre', async () => {
  // Un aller-retour export/import ne doit pas devenir un refus : rien ne change.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [{ id: 'ZG-u-chef-Z-room.edit', userId: 'u-chef', zoneId: 'Z', permission: 'room.edit', status: 'active' }],
    memberships: [{ id: 'ZM-u-chef-Z', userId: 'u-chef', zoneId: 'Z', status: 'active' }]
  });
  await access.applyRoomTransfer(CHEF, {
    rooms: [{ id: 'rA', name: 'Salle A renommée', responsibleId: 'u-resp' }],
    roomZones: [{ roomId: 'rA', zoneId: 'Z' }]
  });
  assert.equal(pool.lire('rooms', 'rA').name, 'Salle A renommée');
});

test('A-1·34 — le dépôt par un acteur global réconcilie l’autorité', async () => {
  // R7·1 — même zone, le responsable change : l'entrant reçoit, le sortant perd.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true);

  await access.applyRoomTransfer(ADMIN, {
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp2' }],
    roomZones: [{ roomId: 'rA', zoneId: 'Z' }]
  });
  assert.equal(responsableDe(pool, 'u-resp2', 'Z'), true, 'l’entrant reçoit son autorité');
  assert.equal(actives(pool, 'u-resp2', 'Z').length, 24);
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'le sortant la perd');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), []);
});

test('A-1·35 — le dépôt qui DÉPLACE une salle déplace l’autorité', async () => {
  // R7·2 — responsable inchangé, zone Z -> Z2.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await access.applyRoomTransfer(ADMIN, {
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
    roomZones: [{ roomId: 'rA', zoneId: 'Z2' }]
  });
  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'l’ancienne zone est libérée');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), []);
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true, 'la nouvelle zone reçoit l’autorité');
  assert.equal(actives(pool, 'u-resp', 'Z2').length, 24);
});

test('A-1·36 — supprimer la DERNIÈRE salle justificative retire l’autorité', async () => {
  /*
   * R5. MESURÉ : après la suppression, l'adhésion et les 24 habilitations restaient
   * actives — et plus rien ne pouvait les retirer par le chemin normal, puisque ce chemin
   * passe par la salle qui venait de disparaître.
   *
   * La suppression est simulée dans l'ordre du serveur : pierre tombale, puis
   * réconciliation avec les zones capturées AVANT.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24);

  const zonesAvant = await access.zonesForRoom('rA');
  await access.tombstone('rooms', 'rA');
  await access.reconcileRoomResponsible(ADMIN,
    { roomId: 'rA', previousResponsibleId: 'u-resp', previousZoneIds: zonesAvant });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false);
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), [], 'plus aucune autorité orpheline');
});

test('A-1·37 — supprimer une salle NON dernière ne retire rien', async () => {
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }, { id: 'rB', name: 'Salle B' }],
    mappings: [rattachement('rA', 'Z'), rattachement('rB', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rB', 'u-resp', '');

  const zonesAvant = await access.zonesForRoom('rA');
  await access.tombstone('rooms', 'rA');
  await access.reconcileRoomResponsible(ADMIN,
    { roomId: 'rA', previousResponsibleId: 'u-resp', previousZoneIds: zonesAvant });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true, 'la salle B justifie encore');
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24);
});

test('A-1·38 — une autorité EXPLICITE survit à la suppression de la salle', async () => {
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{
      id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: true, status: 'active',
      startsAt: '2026-01-01T00:00:00.000Z', expiresAt: null, authVersion: 4, updatedAt: '2026-01-01T00:00:00.000Z'
    }],
    grants: [{
      id: 'ZG-u-resp-Z-equipment.read', userId: 'u-resp', zoneId: 'Z', permission: 'equipment.read',
      status: 'active', grantedBy: 9, grantedAt: '2026-01-01T00:00:00.000Z'
    }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  const zonesAvant = await access.zonesForRoom('rA');
  await access.tombstone('rooms', 'rA');
  await access.reconcileRoomResponsible(ADMIN,
    { roomId: 'rA', previousResponsibleId: 'u-resp', previousZoneIds: zonesAvant });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true, 'la décision de zone survit');
  assert.ok(actives(pool, 'u-resp', 'Z').includes('equipment.read'), 'l’octroi explicite aussi');
});

test('A-1·39 — déplacer une salle de zone déplace son autorité', async () => {
  /*
   * R6. MESURÉ : après un remap Z -> Z2, le responsable gardait ses 24 habilitations dans
   * la zone qu'il venait de QUITTER, et n'en recevait aucune dans la nouvelle.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  const zonesAvant = await access.zonesForRoom('rA');
  await access.setRoomZone(ADMIN, 'rA', 'Z2');
  await access.reconcileRoomResponsible(ADMIN,
    { roomId: 'rA', previousResponsibleId: 'u-resp', previousZoneIds: zonesAvant });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'l’ancienne zone est libérée');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), []);
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true, 'la nouvelle zone reçoit l’autorité');
  assert.equal(actives(pool, 'u-resp', 'Z2').length, 24);
});

test('A-1·40 — un déplacement ne vole pas l’autorité qu’une autre salle justifie', async () => {
  // rB reste dans Z et nomme le même responsable : Z ne doit RIEN perdre.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }, { id: 'rB', name: 'Salle B' }],
    mappings: [rattachement('rA', 'Z'), rattachement('rB', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  await assigner(access, pool, ADMIN, 'rB', 'u-resp', '');
  const zonesAvant = await access.zonesForRoom('rA');
  await access.setRoomZone(ADMIN, 'rA', 'Z2');
  await access.reconcileRoomResponsible(ADMIN,
    { roomId: 'rA', previousResponsibleId: 'u-resp', previousZoneIds: zonesAvant });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), true, 'rB justifie encore la zone Z');
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24);
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true, 'et Z2 reçoit la sienne');
});

test('A-1·41 — le réconciliateur est idempotent', async () => {
  // Rejoué, il ne doit ni doubler les octrois ni produire d'entrées d'audit nouvelles.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  const apres = actives(pool, 'u-resp', 'Z').length;
  const traceAvant = pool.lister('access_audit').length;

  await access.reconcileRoomResponsible(ADMIN, { roomId: 'rA', previousResponsibleId: 'u-resp' });
  assert.equal(actives(pool, 'u-resp', 'Z').length, apres, 'aucun octroi en double');
  assert.ok(pool.lister('access_audit').length >= traceAvant);
});

test('A-1·42 — le plafond de rôle tient aussi sur les chemins de dépôt', async () => {
  // Le réconciliateur est commun : le plafond ne peut pas dépendre de la porte d'entrée.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await access.applyRoomTransfer(ADMIN, {
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-visit' }],
    roomZones: [{ roomId: 'rA', zoneId: 'Z' }]
  });
  const plafond = access.ROLE_CEILINGS.visitor;
  for (const permission of actives(pool, 'u-visit', 'Z')) {
    assert.ok(plafond.has(permission), `${permission} dépasse le plafond du visiteur`);
  }
  assert.ok(!actives(pool, 'u-visit', 'Z').includes('access.review'));
});

test('A-1·43 — un rôle à périmètre ne peut pas DÉPLACER une salle qui porte un responsable', async () => {
  /*
   * Déplacer une salle qui nomme un responsable emporte son autorité d'une zone à l'autre :
   * c'est le même acte que la nommer. Trouvé en écrivant A-1·33 — la première version de la
   * garde réconciliait pour tout acteur, et un chef au dépôt légitime tombait sur
   * `ZONE_FORBIDDEN` levé depuis `ensureMembership`, c'est-à-dire au milieu de l'écriture
   * plutôt qu'avant elle.
   */
  const { access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [
      { id: 'ZG-u-chef-Z-room.edit', userId: 'u-chef', zoneId: 'Z', permission: 'room.edit', status: 'active' },
      { id: 'ZG-u-chef-Z2-room.edit', userId: 'u-chef', zoneId: 'Z2', permission: 'room.edit', status: 'active' }
    ],
    memberships: [
      { id: 'ZM-u-chef-Z', userId: 'u-chef', zoneId: 'Z', status: 'active' },
      { id: 'ZM-u-chef-Z2', userId: 'u-chef', zoneId: 'Z2', status: 'active' }
    ]
  });
  await assert.rejects(
    () => access.applyRoomTransfer(CHEF, {
      rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
      roomZones: [{ roomId: 'rA', zoneId: 'Z2' }]
    }),
    error => error.status === 403 && error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
});

test('A-1·44 — la ROUTE de remap réconcilie, pas seulement `setRoomZone`', async () => {
  /*
   * A-1·39 tient la règle, mais en appelant `setRoomZone` puis le réconciliateur à la main :
   * elle ne dit donc rien du CÂBLAGE de `POST /api/access/resource-zones`. Une mutation qui
   * retirait la réconciliation de `mapResource()` y survivait — la règle était juste, et
   * personne ne l'appelait. Cette épreuve passe par la route elle-même.
   */
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(actives(pool, 'u-resp', 'Z').length, 24);

  await access.mapResource(ADMIN, { resourceType: 'room', resourceId: 'rA', zoneId: 'Z2' });

  assert.equal(responsableDe(pool, 'u-resp', 'Z'), false, 'l’ancienne zone est libérée');
  assert.deepEqual(actives(pool, 'u-resp', 'Z'), []);
  assert.equal(responsableDe(pool, 'u-resp', 'Z2'), true, 'la nouvelle zone reçoit l’autorité');
  assert.equal(actives(pool, 'u-resp', 'Z2').length, 24);
});

/* ══════════════════════════════ I · omission et durée de vie (revue finale)
 *
 * Deux confusions de contrat, l'une sur ce que veut dire un champ ABSENT, l'autre sur ce
 * qu'une écriture emporte avec elle.
 */

test('A-1·45 — omettre `responsibleId` sur une salle EXISTANTE préserve la valeur', async () => {
  /*
   * R9. MESURÉ : un chef renommait la salle sans envoyer `responsibleId` — 200 — et la
   * déclaration disparaissait, laissant l'adhésion et les 24 habilitations sans plus
   * aucune salle pour les justifier. Deux lectures de `undefined` se contredisaient : la
   * garde y voyait « rien ne change », l'écriture — qui REMPLACE la fiche entière — y
   * voyait « champ absent ».
   */
  const existante = { id: 'r1', name: 'STC', responsibleId: 'u-resp' };
  const { access } = decor({ responsibleId: 'u-resp' });
  const normalisee = access.normalizeRoomResponsible('rooms', { id: 'r1', name: 'STC renommée' }, existante);
  assert.equal(normalisee.responsibleId, 'u-resp', 'la valeur en base est réinscrite');
  assert.equal(access.responsibleChangeRequested('rooms', normalisee, existante), false,
    'et la garde voit bien qu’aucune autorité ne change');
});

test('A-1·46 — omettre `responsibleId` sur une salle NEUVE n’hérite de rien', async () => {
  const { access } = decor();
  const normalisee = access.normalizeRoomResponsible('rooms', { id: 'rNeuve', name: 'Neuve' }, null);
  assert.equal(normalisee.responsibleId, undefined);
});

test('A-1·47 — un retrait EXPLICITE reste un changement, et franchit la garde', async () => {
  // Préserver l'omission ne doit pas rendre le retrait impossible : il se DIT.
  const existante = { id: 'r1', name: 'STC', responsibleId: 'u-resp' };
  const { access } = decor({ responsibleId: 'u-resp' });
  for (const retrait of [{ responsibleId: '' }, { responsibleId: null }]) {
    const demande = access.normalizeRoomResponsible('rooms', { id: 'r1', name: 'STC', ...retrait }, existante);
    assert.equal(access.responsibleChangeRequested('rooms', demande, existante), true,
      `${JSON.stringify(retrait)} doit être lu comme un retrait`);
    assert.throws(
      () => access.assertResponsibleAssignment(CHEF, 'rooms', demande, existante),
      error => error.code === 'RESPONSIBLE_ASSIGN_ADMIN_ONLY');
  }
});

test('A-1·48 — le dépôt applique la MÊME normalisation', async () => {
  // R9·C — mesuré sur la route : le dépôt faisait tomber la déclaration par simple omission.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A', responsibleId: 'u-resp' }],
    mappings: [rattachement('rA', 'Z')],
    grants: [{ id: 'ZG-u-chef-Z-room.edit', userId: 'u-chef', zoneId: 'Z', permission: 'room.edit', status: 'active' }],
    memberships: [{ id: 'ZM-u-chef-Z', userId: 'u-chef', zoneId: 'Z', status: 'active' }]
  });
  await access.applyRoomTransfer(CHEF, {
    rooms: [{ id: 'rA', name: 'Salle A renommée' }],   // `responsibleId` ABSENT
    roomZones: [{ roomId: 'rA', zoneId: 'Z' }]
  });
  assert.equal(pool.lire('rooms', 'rA').name, 'Salle A renommée');
  assert.equal(pool.lire('rooms', 'rA').responsibleId, 'u-resp', 'la déclaration survit à l’omission');
});

test('A-1·49 — une adhésion EXPLICITE à durée finie n’est pas réécrite', async () => {
  /*
   * R10. MESURÉ : une adhésion responsable explicite portant
   * `expiresAt: "2026-09-30T00:00:00.000Z"` ressortait d'une désignation de salle avec
   * `expiresAt: null` et `authVersion` incrémenté. Une autorité temporaire devenait
   * permanente — une extension de privilège, silencieuse.
   *
   * Le correctif n'écrit RIEN : l'utilisateur est déjà responsable, il n'y a rien à
   * ajouter. L'épreuve tient donc la stabilité octet par octet.
   */
  const echeance = '2026-09-30T00:00:00.000Z';
  const avant = {
    id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: true, status: 'active',
    startsAt: '2026-01-01T00:00:00.000Z', expiresAt: echeance, authVersion: 3,
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{ ...avant }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');

  assert.deepEqual(pool.lire('zone_memberships', 'ZM-u-resp-Z'), avant,
    'l’adhésion explicite est intacte, champ pour champ');
});

test('A-1·50 — une adhésion SIMPLE à durée finie garde son échéance', async () => {
  // R10·2 — promotion puis retrait ne doivent pas rendre une adhésion illimitée.
  const echeance = '2026-09-30T00:00:00.000Z';
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{
      id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: false, status: 'active',
      startsAt: '2026-01-01T00:00:00.000Z', expiresAt: echeance, authVersion: 2
    }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').expiresAt, echeance,
    'la promotion reporte l’échéance');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').responsible, true);

  await assigner(access, pool, ADMIN, 'rA', '', 'u-resp');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').expiresAt, echeance,
    'et le retrait ne l’élargit pas davantage');
  assert.equal(pool.lire('zone_memberships', 'ZM-u-resp-Z').responsible, false);
});

test('A-1·51 — une adhésion explicite EXPIRÉE n’est pas ressuscitée par une salle', async () => {
  /*
   * Fail-closed, et assumé : la salle ne rend pas une autorité dont un administrateur a
   * laissé passer l'échéance — ce serait réécrire sa décision. La réparation passe par
   * Accès Zone.
   */
  const perime = {
    id: 'ZM-u-resp-Z', userId: 'u-resp', zoneId: 'Z', responsible: true, status: 'active',
    startsAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z', authVersion: 3
  };
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }],
    mappings: [rattachement('rA', 'Z')],
    memberships: [{ ...perime }]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');

  assert.deepEqual(pool.lire('zone_memberships', 'ZM-u-resp-Z'), perime,
    'l’adhésion périmée reste telle quelle');
  assert.equal(await access.hasPermission({ id: 'u-resp', role: 'responsible' }, 'Z', 'equipment.edit'), false,
    'et aucune permission n’est effective : l’échéance tient');
});

test('A-1·52 — sans adhésion préalable, la désignation reste sans échéance', async () => {
  // La contrepartie : reporter une durée ne doit pas en inventer une.
  const { pool, access } = decorMulti({
    rooms: [{ id: 'rA', name: 'Salle A' }], mappings: [rattachement('rA', 'Z')]
  });
  await assigner(access, pool, ADMIN, 'rA', 'u-resp', '');
  const adhesion = pool.lire('zone_memberships', 'ZM-u-resp-Z');
  assert.equal(adhesion.expiresAt, null);
  assert.equal(adhesion.responsible, true);
  assert.equal(adhesion.responsibleSource, 'room-responsible');
});
