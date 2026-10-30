import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const verifyOnly = process.env.E2E_VERIFY_ONLY === '1';

const OPERATIONAL_STORES = [
  'rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','attachments','cables','cable_reports'
];
const OPERATIONAL_DOC_KINDS = new Set([
  'technical_diagram',
  'topology_router','topology_router_port','topology_router_interface','topology_crosspoint',
  'topology_rv_link','topology_signal_path','topology_patch_point','topology_synoptic','topology_evidence',
  'continuity_protection_group','continuity_procedure','continuity_test'
]);

async function request(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.equal(response.status, expected, `${method} ${path}: attendu ${expected}, reçu ${response.status} ${text}`);
  return { payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function login() {
  const result = await request('/api/auth/login', { method:'POST', body:{ username:adminUsername, password:adminPassword } });
  assert.ok(result.cookie.startsWith('tp_session='), 'cookie de session administrateur absent');
  assert.ok(['admin','manager'].includes(String(result.payload.user?.role || '').toLowerCase()), 'rôle installateur central invalide');
  return result;
}

function assertInstalledSnapshot(snapshot) {
  assert.equal(snapshot.data?.equipments?.length, 397, '397 équipements doivent persister côté PostgreSQL');
  assert.equal(snapshot.data?.rooms?.length, 1, 'la salle synthétique doit être la seule salle opérationnelle');
  assert.equal(snapshot.data?.baies?.length, 1, 'la baie synthétique doit être la seule baie opérationnelle');
  assert.equal(String(snapshot.data.rooms[0].id), 'INV-R1');
  assert.equal(String(snapshot.data.baies[0].id), 'INV-B1');
  assert.ok(snapshot.data.docs?.some(doc => doc.id === 'inventory-preserved-knowledge'), 'la connaissance catalogue doit être conservée');
  assert.ok(snapshot.data.faq?.some(item => item.id === 'inventory-preserved-faq'), 'la FAQ doit être conservée');
  assert.ok(!snapshot.data.docs?.some(doc => OPERATIONAL_DOC_KINDS.has(doc.kind)), 'aucun schéma/topologie/continuité d’essai ne doit survivre au remplacement');
  for (const storeName of OPERATIONAL_STORES.filter(name => !['rooms','baies','equipments'].includes(name))) {
    assert.equal(snapshot.data?.[storeName]?.length || 0, 0, `${storeName} doit être réinitialisé par l’installation réelle`);
  }
}

const health = await request('/api/health');
assert.equal(health.payload.database, 'postgresql');
assert.equal(health.payload.centralSync, true);

const admin = await login();

if (verifyOnly) {
  const sync = await request('/api/sync', { cookie:admin.cookie });
  assertInstalledSnapshot(sync.payload);
  const access = await request('/api/access/manage', { cookie:admin.cookie });
  assert.ok(access.payload.zones?.some(zone => zone.id === 'inventory-explicit-zone'), 'la zone explicite doit persister après redémarrage');
  assert.ok(access.payload.audit?.some(entry => entry.action === 'inventory.replace-operational'), 'la preuve d’audit du remplacement doit persister');
  console.log('Inventory replacement persistence E2E: OK');
  process.exit(0);
}

await request('/api/data/docs/inventory-preserved-knowledge', {
  method:'PUT', cookie:admin.cookie,
  body:{ id:'inventory-preserved-knowledge', kind:'equipment_catalog', title:'Knowledge E2E préservée', origin:'verified', status:'documented' }
});
await request('/api/data/faq/inventory-preserved-faq', {
  method:'PUT', cookie:admin.cookie,
  body:{ id:'inventory-preserved-faq', question:'FAQ E2E préservée ?', answer:'Oui', status:'documented' }
});
await request('/api/access/zones', {
  method:'POST', cookie:admin.cookie,
  body:{ id:'inventory-explicit-zone', name:'Zone explicite inventaire E2E', publicSummary:'Zone explicite à préserver' }
});
await request('/api/data/rooms/99101', {
  method:'PUT', cookie:admin.cookie,
  body:{ id:99101, name:'Salle opérationnelle d’essai à remplacer' }
});
await request('/api/access/resource-zones', {
  method:'POST', cookie:admin.cookie,
  body:{ resourceType:'room', resourceId:99101, zoneId:'inventory-explicit-zone' }
});
await request('/api/data/equipments/99102', {
  method:'PUT', cookie:admin.cookie,
  body:{ id:99102, name:'Équipement opérationnel d’essai à remplacer', roomId:99101, ports:[], components:[] }
});
await request('/api/data/docs/inventory-trial-diagram', {
  method:'PUT', cookie:admin.cookie,
  body:{
    id:'inventory-trial-diagram', kind:'technical_diagram', title:'Schéma opérationnel E2E à retirer',
    diagramType:'signal-synoptic', status:'draft', zoneIds:['inventory-explicit-zone'],
    nodes:[{ id:'trial-node', type:'entity', entityRef:{ type:'equipment', id:99102 } }], edges:[]
  }
});

const before = await request('/api/sync', { cookie:admin.cookie });
const beforeUserIds = (before.payload.data?.users || []).map(user => String(user.id)).sort();
assert.ok(beforeUserIds.length >= 1, 'au moins le compte administrateur doit exister');
assert.ok(before.payload.data.docs?.some(doc => doc.id === 'inventory-preserved-knowledge'));
assert.ok(before.payload.data.docs?.some(doc => doc.id === 'inventory-trial-diagram'));

const equipments = Array.from({ length:397 }, (_, index) => ({
  id:900000 + index,
  name:`E2E Equipment ${String(index + 1).padStart(3, '0')}`,
  nom:`E2E Equipment ${String(index + 1).padStart(3, '0')}`,
  type:'Équipement', categorie:'E2E', marque:'Synthetic', modele:`MODEL-${String(index + 1).padStart(3, '0')}`,
  roomId:'INV-R1', baieId:'INV-B1', status:'À vérifier', statut:'À vérifier',
  ports:[], components:[], images:[], technicalFacts:[]
}));
const replacement = {
  data:{
    rooms:[{ id:'INV-R1', name:'Inventaire réel E2E', nom:'Inventaire réel E2E' }],
    baies:[{ id:'INV-B1', name:'Baie inventaire E2E', nom:'Baie inventaire E2E', roomId:'INV-R1' }],
    equipments,
    walls:[], screens:[], screen_groups:[], cables:[]
  }
};

const replaced = await request('/api/sync/inventory-replace', { method:'POST', cookie:admin.cookie, body:replacement });
assert.equal(replaced.payload.ok, true);
assert.equal(replaced.payload.counts?.equipments, 397);
assert.equal(replaced.payload.counts?.rooms, 1);
assert.equal(replaced.payload.counts?.baies, 1);
assert.ok(Number(replaced.payload.replacedExisting || 0) > 0, 'les données opérationnelles d’essai doivent être détectées et remplacées');
assert.ok(Number(replaced.payload.removedOperationalDocuments || 0) >= 1, 'le schéma opérationnel d’essai doit être retiré');

const after = await request('/api/sync', { cookie:admin.cookie });
assertInstalledSnapshot(after.payload);
assert.deepEqual((after.payload.data?.users || []).map(user => String(user.id)).sort(), beforeUserIds, 'les utilisateurs doivent rester inchangés');

const access = await request('/api/access/manage', { cookie:admin.cookie });
assert.ok(access.payload.zones?.some(zone => zone.id === 'inventory-explicit-zone'), 'la zone explicite doit être conservée');
assert.ok(!access.payload.resourceZones?.some(mapping => String(mapping.resourceId) === '99101'), 'le mapping de la salle d’essai supprimée doit être retiré');
assert.ok(access.payload.resourceZones?.some(mapping => String(mapping.resourceId) === 'INV-R1'), 'la nouvelle salle doit recevoir un mapping de zone valide');
assert.ok(access.payload.audit?.some(entry => entry.action === 'inventory.replace-operational'), 'le remplacement doit être audité');

console.log('Inventory replacement E2E: OK — 397 synthetic equipments persisted and trial operational data retired.');
