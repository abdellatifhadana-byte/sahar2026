import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAccessControl } from '../scripts/access-control.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('zone access model contains memberships grants requests and immutable audit records', () => {
  const source = read('scripts/access-control.js');
  for (const store of ['zones','resource_zones','zone_memberships','zone_grants','access_requests','access_audit']) {
    assert.match(source, new RegExp(store));
  }
  assert.match(source, /access\.review/);
  assert.match(source, /DELEGATION_CEILING/);
  assert.match(source, /RESPONSIBLE_ASSIGN_ADMIN_ONLY/);
});

test('zone permissions are enforced by the server for reads and writes', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /createAccessControl/);
  assert.match(server, /access\.canAccessRecord\(user, row\.store_name, row\.data, 'read'\)/);
  // L'écriture se nomme désormais `create` ou `update` selon qu'une fiche existe déjà.
  // La garde de zone n'a pas changé — elle exige toujours TOUTES les zones — mais le
  // journal avait besoin de distinguer l'ajout d'une trace de la réécriture d'une trace.
  assert.match(server, /access\.canAccessRecord\(user, storeName, record, existing \? 'update' : 'create'\)/);
  assert.match(server, /access\.canAccessRecord\(user, storeName, existing, 'delete'\)/);
  assert.match(server, /ZONE_FORBIDDEN/);
  assert.match(server, /canWriteExisting/);
  assert.match(server, /canWriteIncoming/);
  assert.match(server, /\/api\/access\/context/);
  assert.match(server, /\/api\/access\/memberships/);
  assert.match(server, /\/api\/access\/grants/);
});

/**
 * Un décor à deux zones : le sujet n'est habilité que dans la première.
 *
 * Ce test lisait le TEXTE de la ligne de décision — `action === 'write' || … ? every : some`.
 * Il est donc devenu rouge le jour où cette ligne a gagné un troisième cas, alors même que
 * la règle qu'il prétend garder n'avait pas bougé. Une garde qui casse quand on reformule,
 * et qui reste verte quand on inverse une condition, ne garde rien : elle EXÉCUTE désormais
 * les décisions.
 */
function deuxZones(permissions = ['equipment.edit', 'equipment.read', 'topology.read', 'topology.edit', 'continuity.edit', 'continuity.read']) {
  const records = {
    zones: [{ id: 'Z1', name: 'Une' }, { id: 'Z2', name: 'Deux' }],
    zone_memberships: [{ id: 'M1', userId: 'u1', zoneId: 'Z1', status: 'active' }],
    zone_grants: permissions.map((permission, index) => ({
      id: `G${index}`, userId: 'u1', zoneId: 'Z1', permission, status: 'active'
    }))
  };
  const pool = { async query(sql, params = []) {
    if (sql.startsWith('SELECT data FROM')) {
      return { rows: (records[params[0]] || []).filter(item => String(item.id) === String(params[1])).map(data => ({ data })) };
    }
    if (sql.startsWith('SELECT record_id,data')) return { rows: (records[params[0]] || []).map(data => ({ data })) };
    throw new Error(`Requête inattendue: ${sql}`);
  } };
  return { access: createAccessControl(pool), user: { id: 'u1', role: 'technicien' } };
}

test('une écriture exige TOUTES les zones touchées, une lecture une seule', async () => {
  const { access, user } = deuxZones();
  const surDeuxZones = { id: 'e1', zoneIds: ['Z1', 'Z2'] };
  assert.equal(await access.canAccessRecord(user, 'equipments', surDeuxZones, 'read'), true,
    'une lecture devrait suffire avec une seule zone');
  assert.equal(await access.canAccessRecord(user, 'equipments', surDeuxZones, 'write'), false,
    'une écriture est passée sans autorisation sur la seconde zone');
  const surSaZone = { id: 'e2', zoneIds: ['Z1'] };
  assert.equal(await access.canAccessRecord(user, 'equipments', surSaZone, 'write'), true);
});

test('un document de continuité exige toutes ses zones même en LECTURE', async () => {
  // Il décrit un basculement Principal/Secours qui traverse les zones : le lire à moitié
  // reviendrait à croire connaître un chemin dont on ignore l'autre bout.
  const { access, user } = deuxZones();
  const procedure = { id: 'd1', kind: 'continuity_procedure', zoneIds: ['Z1', 'Z2'] };
  assert.equal(await access.canAccessRecord(user, 'docs', procedure, 'read'), false);
  assert.equal(await access.canAccessRecord(user, 'docs', { ...procedure, zoneIds: ['Z1'] }, 'read'), true);
});

test('la topologie a ses propres permissions, distinctes de celles des équipements', async () => {
  const { access, user } = deuxZones(['equipment.read', 'equipment.edit']);
  const routeur = { id: 'd2', kind: 'topology_router', zoneIds: ['Z1'] };
  assert.equal(await access.canAccessRecord(user, 'docs', routeur, 'read'), false,
    '`equipment.read` a suffi à lire une topologie');
  const { access: avecTopologie, user: sujet } = deuxZones(['topology.read']);
  assert.equal(await avecTopologie.canAccessRecord(sujet, 'docs', routeur, 'read'), true);
  assert.equal(await avecTopologie.canAccessRecord(sujet, 'docs', routeur, 'write'), false,
    'lire la topologie a suffi à l’écrire');
});

test('le serveur garde les écritures de topologie', () => {
  // Ces trois-là restent des gardes de SOURCE : elles nomment des chemins de `serve.js`,
  // qui ouvre un port et une base — aucun test unitaire ne peut les exécuter.
  const server = read('scripts/serve.js');
  assert.match(server, /validateIncomingTopology/);
  assert.match(server, /INVALID_TOPOLOGY_RECORD/);
  assert.match(server, /TOPOLOGY_DEPENDENCY/);
});

test('une zone room-<id> transitoire ne réapparaît pas dans le périmètre après mapping explicite', async () => {
  const records = {
    rooms:[{ id:2, name:'Régie Finale RF1' }],
    zones:[
      { id:'room-2', name:'Legacy RF1', autoCreatedFromRoomId:2 },
      { id:'rf1', name:'Régie Finale RF1' }
    ],
    resource_zones:[
      { id:'legacy', resourceType:'room', resourceId:2, zoneId:'room-2' },
      { id:'explicit', resourceType:'room', resourceId:2, zoneId:'rf1' }
    ]
  };
  const pool = { async query(sql, params = []) {
    if (sql.startsWith('SELECT data FROM')) {
      return { rows:(records[params[0]] || []).filter(item => String(item.id) === String(params[1])).map(data => ({ data })) };
    }
    if (sql.startsWith('SELECT record_id,data')) return { rows:(records[params[0]] || []).map(data => ({ data })) };
    throw new Error(`Requête inattendue: ${sql}`);
  } };
  const access = createAccessControl(pool);
  assert.deepEqual(await access.resolveResourceZones('equipments', { id:20, roomId:2 }), ['rf1']);
});

test('sync is authoritative and removes data after permission revocation', () => {
  const server = read('scripts/serve.js');
  const sync = read('central-sync.js');
  assert.match(server, /authoritativeStores/);
  assert.match(sync, /authoritativeStores/);
  assert.match(sync, /source de vérité/);
  // Le delta autoritaire retire toute fiche absente (donc révoquée) dans la transaction,
  // sans réécrire les fiches identiques qui restent visibles.
  assert.match(sync, /authoritative:\s*clearFirst/);
  assert.match(sync, /for \(const id of plan\.deletes\) store\.delete\(id\)/);
  assert.match(sync, /const clearFirst = autoritaires\.has\(storeName\)/);
  assert.match(sync, /replaceStoreAtomically\(storeName, records, \{ clearFirst, supprimes \}\)/);
  // Un magasin autoritaire vidé de tout ne doit pas être oublié faute d'enregistrements.
  assert.match(sync, /if \(!parMagasin\.has\(storeName\)\) parMagasin\.set\(storeName, \[\]\)/);
});

test('cross-zone cable relations are redacted instead of leaking endpoints', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /external-protected/);
  assert.match(server, /output\[`\$\{side\}Protected`\]/);
  assert.match(server, /direction: side === 'source' \? 'upstream' : 'downstream'/);
  assert.match(server, /delete output\[`\$\{side\}PortId`\]/);
  assert.match(server, /delete output\[`\$\{side\}ComponentId`\]/);
});

test('all role interfaces expose access workflow and visitor logout uses central logout', () => {
  const html = read('index.html');
  const integration = read('zone-access-integration.js');
  const ui = read('zone-access.js');
  assert.match(html, /zone-access-integration\.js/);
  assert.match(integration, /Accès zones/);
  assert.match(integration, /Accès de ma zone/);
  assert.match(integration, /Mes accès/);
  assert.match(integration, /eventSystem\.dispatch\('logout'\)/);
  assert.match(ui, /Demander un accès/);
  assert.match(ui, /approvedPermissions/);
});
