import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRole, CANONICAL_ROLES, ROLE_ORDER, canWriteStoreByRole
} from '../roles.js';
import { normalizeNavigationRole } from '../navigation-contract.js';
import { createAccessControl, ROLE_CEILINGS, PERMISSIONS } from '../scripts/access-control.js';

/*
 * LE CONTRAT D'AUTORISATION DES SIX RÔLES.
 *
 * MESURÉ SUR LA BASELINE 457fe1dd — trois couches donnaient TROIS réponses différentes à
 * la même question, « quel rôle est-ce ? » :
 *
 *   entrée           roles.js      navigation-contract   ROLE_CEILINGS
 *   administrateur   admin         admin                 ABSENT
 *   chef             chef          chef                  ABSENT
 *   technicien       technician    VISITOR  ←             ABSENT
 *   visiteur         visitor       visitor                ABSENT
 *
 * `technicien` est le libellé FRANÇAIS que la plateforme affiche elle-même
 * (`ROLE_LABELS[TECHNICIAN] === 'Technicien'`). Un compte enregistré ainsi était donc :
 * traité en visiteur par la navigation, privé de TOUT plafond par le serveur — donc un
 * instantané `/api/sync` entièrement vide — mais autorisé à écrire par `canWriteByRole`.
 *
 * `scripts/access-control.js` n'importait rien et indexait `ROLE_CEILINGS[user.role]` avec
 * la chaîne BRUTE. Il rattrapait le problème en DUPLIQUANT des lignes d'alias dans la
 * matrice (`responsible` + `responsable`, `technician` + `tech`) — un rattrapage manuel,
 * donc partiel : `chef`, `administrateur`, `technicien` et `visiteur` manquaient.
 *
 * Ces tests EXÉCUTENT les décisions. Le test de zone existant
 * (`tests/zone-access-control.test.js`) ne fait que du `assert.match` sur le source : il
 * est resté vert pendant toute la durée du défaut.
 */

/* ══════════════════════════════ le double de connexion PostgreSQL
 *
 * Il ne simule PAS l'autorisation — il ne remplace que la couche SQL, qui se réduit à
 * quatre formes de requête. Tout le raisonnement testé ci-dessous est le VRAI code de
 * `createAccessControl`.
 */
function poolDouble(seed = {}) {
  // Un magasin par entrée, et non une clé composite : une clé `store<séparateur>id` oblige
  // à choisir un séparateur qu'aucun identifiant ne contient, et la première version en
  // avait retenu un caractère NUL — invisible à la lecture, et suffisant pour que git
  // classe ce fichier comme binaire, donc illisible en revue.
  const magasins = new Map(); // store -> Map(id -> { data, deleted, updatedAt })
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
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(texte)) return { rows: [] };
      throw new Error(`requête non simulée : ${texte.slice(0, 90)}`);
    },
    release() {}
  };
  return { ...client, connect: async () => client };
}

/** Un décor minimal : une zone, une salle dedans, une salle dehors. */
function decor({ userId = 'u-chef', role = 'chef', permissions = [], zone = 'Z1', responsible = false } = {}) {
  const seed = {
    zones: [{ id: 'Z1', name: 'Régie' }, { id: 'Z2', name: 'Autre' }],
    resource_zones: [
      { id: 'RZ1', resourceType: 'rooms', resourceId: 'salle-dedans', zoneId: 'Z1' },
      { id: 'RZ2', resourceType: 'rooms', resourceId: 'salle-dehors', zoneId: 'Z2' }
    ],
    rooms: [{ id: 'salle-dedans', name: 'STC' }, { id: 'salle-dehors', name: 'Autre salle' }],
    zone_memberships: [{ id: 'M1', userId, zoneId: zone, status: 'active', responsible }],
    zone_grants: permissions.map((permission, i) => ({
      id: `G${i}`, userId, zoneId: zone, permission, status: 'active'
    })),
    // `grantPermission` relit le bénéficiaire dans le magasin des comptes : son rôle EN
    // BASE est ce qui décide, pas celui qu'on passerait en argument.
    users: [
      { id: userId, role }, { id: 'u-chef', role: 'chef' }, { id: 'u-vis', role: 'visitor' },
      { id: 'u-tech', role: 'technicien' }, { id: 1, role: 'admin' }
    ]
  };
  return { access: createAccessControl(poolDouble(seed)), user: { id: userId, role } };
}

const dedans = { id: 'salle-dedans', name: 'STC' };
const dehors = { id: 'salle-dehors', name: 'Autre salle' };

/* ══════════════════════════════ A · une seule résolution canonique */

test('A1 — les trois couches répondent la MÊME chose pour chaque alias', () => {
  const entrees = ['admin', 'administrateur', 'manager', 'chef', 'responsible', 'responsable',
    'technician', 'technicien', 'tech', 'visitor', 'visiteur', 'inconnu', '', null];
  for (const entree of entrees) {
    assert.equal(normalizeNavigationRole(entree), normalizeRole(entree),
      `« ${entree} » : la navigation et roles.js divergent`);
  }
});

test('A2 — « technicien », le libellé français affiché, n’est pas un visiteur', () => {
  // ROLE_LABELS[TECHNICIAN] vaut « Technicien » : c'est la valeur qu'un humain saisit.
  assert.equal(normalizeRole('technicien'), CANONICAL_ROLES.TECHNICIAN);
  assert.equal(normalizeNavigationRole('technicien'), CANONICAL_ROLES.TECHNICIAN);
});

test('A3 — un rôle inconnu retombe sur visiteur partout, jamais sur « rien »', () => {
  for (const entree of ['superuser', 'root', 'ROOT', '  ', undefined]) {
    assert.equal(normalizeRole(entree), CANONICAL_ROLES.VISITOR);
    assert.equal(normalizeNavigationRole(entree), CANONICAL_ROLES.VISITOR);
  }
});

/* ══════════════════════════════ B · ROLE_CEILINGS indexé canoniquement */

test('B1 — les six rôles canoniques ont un plafond, chef compris', () => {
  for (const role of ROLE_ORDER) {
    assert.ok(ROLE_CEILINGS[role] instanceof Set, `plafond manquant pour « ${role} »`);
    assert.ok(ROLE_CEILINGS[role].size > 0, `plafond vide pour « ${role} »`);
  }
  assert.equal(Object.keys(ROLE_CEILINGS).length, ROLE_ORDER.length,
    `la matrice contient ${Object.keys(ROLE_CEILINGS).length} clés pour ${ROLE_ORDER.length} rôles : des alias y sont dupliqués`);
});

test('B2 — aucune clé d’alias ne subsiste dans la matrice', () => {
  // Dupliquer `responsable` à côté de `responsible` est le rattrapage manuel qui a laissé
  // `chef`, `administrateur`, `technicien` et `visiteur` dehors.
  for (const alias of ['responsable', 'tech', 'technicien', 'administrateur', 'visiteur']) {
    assert.equal(ROLE_CEILINGS[alias], undefined,
      `« ${alias} » est encore une clé de la matrice : la normalisation n’est pas faite en amont`);
  }
});

test('B3 — la hiérarchie des plafonds suit la hiérarchie des rôles', () => {
  const taille = role => ROLE_CEILINGS[role].size;
  assert.equal(taille('admin'), PERMISSIONS.length);
  assert.equal(taille('manager'), PERMISSIONS.length);
  assert.ok(taille('chef') >= taille('responsible'), 'le chef plafonne sous le responsable');
  assert.ok(taille('responsible') > taille('technician'), 'responsable ≤ technicien');
  assert.ok(taille('technician') > taille('visitor'), 'technicien ≤ visiteur');
});

test('B4 — le chef porte ce que la matrice client lui accorde, et RIEN de plus', () => {
  // `permissions.js` donne au chef : users (view/create/edit/changeRole), rooms
  // (create/edit/assign), continuity.validate et diagrams.validate. Le plafond serveur
  // doit les couvrir, sinon l'écran promet ce que l'API refuse.
  for (const permission of ['users.manage', 'room.edit', 'continuity.validate', 'diagram.validate']) {
    assert.ok(ROLE_CEILINGS.chef.has(permission), `le chef devrait plafonner « ${permission} »`);
  }
  // …et l'inverse compte autant. Une première version de ce test lui donnait
  // `new Set(PERMISSIONS)`, donc `zone.manage` et `access.review` : le serveur promettait
  // alors l'administration des accès à un rôle dont `navigation-contract.js` place
  // `zoneAccess` AU-DESSUS. Un plafond trop large est un défaut, pas une générosité.
  for (const permission of ['zone.manage', 'access.review']) {
    assert.ok(!ROLE_CEILINGS.chef.has(permission), `le chef ne devrait pas plafonner « ${permission} »`);
  }
});

/* ══════════════════════════════ C · canWriteByRole, exécutable */

test('C1 — canWriteStoreByRole est importable et se prononce pour les six rôles', () => {
  // Elle vivait dans `scripts/serve.js`, qui ouvre un port et une base : aucun test ne
  // pouvait l'exécuter, seulement chercher des chaînes dedans.
  assert.equal(typeof canWriteStoreByRole, 'function');
  assert.equal(canWriteStoreByRole('admin', 'equipments'), true);
  assert.equal(canWriteStoreByRole('visitor', 'equipments'), false);
});

test('C2 — les réglages n’appartiennent qu’à l’administrateur', () => {
  assert.equal(canWriteStoreByRole('admin', 'settings'), true);
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(canWriteStoreByRole(role, 'settings'), false, `« ${role} » écrit dans settings`);
  }
});

test('C3 — les comptes suivent la hiérarchie, pas le nom du magasin', () => {
  for (const role of ['admin', 'manager', 'chef']) {
    assert.equal(canWriteStoreByRole(role, 'users'), true, `« ${role} » ne peut pas gérer de comptes`);
  }
  for (const role of ['responsible', 'technician', 'visitor']) {
    assert.equal(canWriteStoreByRole(role, 'users'), false, `« ${role} » accède au magasin des comptes`);
  }
});

test('C4 — les alias écrivent exactement comme leur forme canonique', () => {
  for (const [alias, canonique] of [['technicien', 'technician'], ['tech', 'technician'],
    ['responsable', 'responsible'], ['administrateur', 'admin'], ['visiteur', 'visitor']]) {
    for (const store of ['equipments', 'settings', 'users']) {
      assert.equal(canWriteStoreByRole(alias, store), canWriteStoreByRole(canonique, store),
        `« ${alias} » et « ${canonique} » divergent sur ${store}`);
    }
  }
});

test('C5 — un rôle inconnu n’écrit nulle part', () => {
  for (const store of ['equipments', 'settings', 'users', 'tickets']) {
    assert.equal(canWriteStoreByRole('superuser', store), false);
  }
});

/* ══════════════════════════════ D · chef + zone, exécution réelle */

test('D1 — un chef muni d’une adhésion ET d’une habilitation lit dans sa zone', async () => {
  const { access, user } = decor({ permissions: ['zone.summary.read'] });
  assert.equal(await access.canAccessRecord(user, 'rooms', dedans, 'read'), true);
});

test('D2 — le même chef ne lit RIEN hors de sa zone', async () => {
  const { access, user } = decor({ permissions: ['zone.summary.read'] });
  assert.equal(await access.canAccessRecord(user, 'rooms', dehors, 'read'), false);
});

test('D3 — sans habilitation, l’adhésion seule ne suffit pas', async () => {
  const { access, user } = decor({ permissions: [] });
  assert.equal(await access.canAccessRecord(user, 'rooms', dedans, 'read'), false);
});

test('D4 — le chef n’a PAS le court-circuit d’admin/manager', async () => {
  // admin et manager passent avant toute résolution de zone. Le chef, non : c'est ce qui
  // fait de lui un rôle de périmètre et non un second administrateur.
  const { access, user } = decor({ permissions: ['zone.summary.read'], zone: 'Z2' });
  assert.equal(await access.canAccessRecord(user, 'rooms', dedans, 'read'), false,
    'le chef franchit les zones : il est traité comme un administrateur');
});

test('D5 — admin et manager, eux, court-circuitent bien', async () => {
  for (const role of ['admin', 'manager', 'administrateur']) {
    const { access } = decor({ permissions: [] });
    assert.equal(await access.canAccessRecord({ id: 'x', role }, 'rooms', dehors, 'read'), true,
      `« ${role} » ne court-circuite plus`);
  }
});

test('D6 — les réglages restent fermés en écriture à tous sauf l’administrateur', async () => {
  const { access } = decor({ permissions: PERMISSIONS });
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(await access.canAccessRecord({ id: 'u-chef', role }, 'settings', { id: 'global' }, 'write'), false,
      `« ${role} » écrit dans les réglages`);
  }
  assert.equal(await access.canAccessRecord({ id: 'a', role: 'admin' }, 'settings', { id: 'global' }, 'write'), true);
});

/* ══════════════════════════════ E · l’habilitation d’un chef */

test('E1 — l’administrateur peut habiliter un chef dans son plafond', async () => {
  const { access } = decor({ permissions: [] });
  const resultat = await access.grantPermission(
    { id: 1, role: 'admin' }, { userId: 'u-chef', zoneId: 'Z1', permission: 'equipment.edit' });
  assert.ok(resultat, 'l’habilitation d’un chef est refusée');
});

test('E2 — le refus hors plafond reste un vrai refus, pas un rôle manquant', async () => {
  // Le message « Cette permission dépasse le rôle global du bénéficiaire » doit sanctionner
  // un DÉPASSEMENT, jamais l'absence du rôle dans la matrice.
  const { access } = decor({ permissions: [] });
  await assert.rejects(
    () => access.grantPermission({ id: 1, role: 'admin' }, { userId: 'u-vis', zoneId: 'Z1', permission: 'users.manage' }),
    error => error.code === 'ROLE_CEILING');
});

test('E3 — un bénéficiaire au libellé français est habilitable', async () => {
  const { access } = decor({ permissions: [] });
  assert.ok(await access.grantPermission(
    { id: 1, role: 'admin' }, { userId: 'u-tech', zoneId: 'Z1', permission: 'equipment.edit' }));
});

/* ══════════════════════════════ F · l’instantané /api/sync */

/** Le filtre EXACT de `GET /api/sync` : `canAccessRecord(user, store, data, 'read')`. */
async function instantane(access, user, lignes) {
  const vues = [];
  for (const [store, data] of lignes) {
    if (await access.canAccessRecord(user, store, data, 'read')) vues.push(data.id);
  }
  return vues;
}

const LIGNES = [['rooms', dedans], ['rooms', dehors]];

test('F1 — l’instantané d’un chef n’est PAS vide', async () => {
  const { access, user } = decor({ permissions: ['zone.summary.read'] });
  const vues = await instantane(access, user, LIGNES);
  assert.ok(vues.length > 0, 'le chef reçoit un instantané entièrement vide');
  assert.deepEqual(vues, ['salle-dedans']);
});

test('F2 — un « technicien » français reçoit ce que reçoit un « technician »', async () => {
  const fr = decor({ userId: 'u1', role: 'technicien', permissions: ['zone.summary.read'] });
  const en = decor({ userId: 'u1', role: 'technician', permissions: ['zone.summary.read'] });
  assert.deepEqual(await instantane(fr.access, fr.user, LIGNES),
    await instantane(en.access, en.user, LIGNES));
});

test('F3 — le visiteur voit sa zone, et rien au-delà', async () => {
  const { access, user } = decor({ userId: 'u-vis', role: 'visiteur', permissions: ['zone.summary.read'] });
  assert.deepEqual(await instantane(access, user, LIGNES), ['salle-dedans']);
});

/* ══════════════════════════════ G · la matrice des six rôles */

test('G1 — matrice lecture/écriture des six rôles, exécutée', async () => {
  // Retirer un rôle du plafond, ou contourner la normalisation, doit rendre ce test rouge.
  const attendu = {
    admin: { lecture: true, ecriture: true, horsZone: true },
    manager: { lecture: true, ecriture: true, horsZone: true },
    chef: { lecture: true, ecriture: true, horsZone: false },
    responsible: { lecture: true, ecriture: true, horsZone: false },
    technician: { lecture: true, ecriture: true, horsZone: false },
    visitor: { lecture: true, ecriture: false, horsZone: false }
  };
  for (const [role, cas] of Object.entries(attendu)) {
    const { access, user } = decor({
      userId: `u-${role}`, role,
      permissions: ['zone.summary.read', 'equipment.read', 'equipment.edit']
    });
    const equipDedans = { id: 'eq1', roomId: 'salle-dedans' };
    const equipDehors = { id: 'eq2', roomId: 'salle-dehors' };
    assert.equal(await access.canAccessRecord(user, 'equipments', equipDedans, 'read'), cas.lecture,
      `${role} · lecture dans la zone`);
    assert.equal(await access.canAccessRecord(user, 'equipments', equipDedans, 'write'), cas.ecriture,
      `${role} · écriture dans la zone`);
    assert.equal(await access.canAccessRecord(user, 'equipments', equipDehors, 'read'), cas.horsZone,
      `${role} · lecture HORS zone`);
  }
});

test('G2 — chaque rôle canonique est atteignable par son libellé français', async () => {
  const paires = [['admin', 'administrateur'], ['responsible', 'responsable'],
    ['technician', 'technicien'], ['visitor', 'visiteur']];
  const equip = { id: 'eq1', roomId: 'salle-dedans' };
  for (const [canonique, francais] of paires) {
    const a = decor({ userId: 'u1', role: canonique, permissions: ['equipment.read'] });
    const b = decor({ userId: 'u1', role: francais, permissions: ['equipment.read'] });
    assert.equal(
      await a.access.canAccessRecord(a.user, 'equipments', equip, 'read'),
      await b.access.canAccessRecord(b.user, 'equipments', equip, 'read'),
      `« ${francais} » et « ${canonique} » ne décident pas pareil`);
  }
});
