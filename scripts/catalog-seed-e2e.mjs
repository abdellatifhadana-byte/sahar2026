import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const username = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const password = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const version = Number(process.env.E2E_CATALOG_VERSION || 240001);

async function request(path, { method='GET', cookie='', body, expected=200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers:{
      ...(body === undefined ? {} : { 'content-type':'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.equal(response.status, expected, `${method} ${path}: attendu ${expected}, reçu ${response.status} ${text}`);
  return { payload, cookie:response.headers.get('set-cookie')?.split(';')[0] || '' };
}

const login = await request('/api/auth/login', { method:'POST', body:{ username, password } });
assert.ok(login.cookie.startsWith('tp_session='), 'cookie administrateur absent');

await request('/api/sync/catalog-install', {
  method:'POST',
  body:{ version, records:[{ id:'phase24-unauth-catalog', kind:'equipment_catalog', title:'Ne doit pas être écrit' }] },
  expected:401
});

const records = [
  { id:'phase24-catalog-alpha', kind:'equipment_catalog', title:'Catalogue Alpha', origin:'phase24-e2e', status:'documented' },
  { id:'phase24-catalog-beta', kind:'equipment_catalog', title:'Catalogue Beta', origin:'phase24-e2e', status:'documented' }
];
const first = await request('/api/sync/catalog-install', { method:'POST', cookie:login.cookie, body:{ version, records } });
assert.equal(first.payload.ok, true);
assert.equal(first.payload.version, version);
assert.equal(first.payload.installed, true);
assert.equal(first.payload.written, records.length);

const second = await request('/api/sync/catalog-install', { method:'POST', cookie:login.cookie, body:{ version, records } });
assert.equal(second.payload.ok, true);
assert.equal(second.payload.installed, false, 'la même version ne doit jamais être rejouée');
assert.equal(second.payload.written, 0, 'deuxième installation = zéro écriture catalogue');
assert.equal(second.payload.reason, 'already-current');

const sync = await request('/api/sync', { cookie:login.cookie });
for (const record of records) {
  const stored = sync.payload.data?.docs?.find(item => String(item.id) === record.id);
  assert.ok(stored, `${record.id} absent du snapshot central`);
  assert.equal(Number(stored.catalogSeedVersion), version);
}
const settings = sync.payload.data?.settings?.find(item => String(item.id) === 'global');
assert.ok(settings, 'settings/global absent après migration catalogue');
assert.equal(Number(settings.catalogSeedVersion), version);
assert.ok(settings.catalogSeedUpdatedAt, 'date de migration catalogue absente');

console.log('Catalog seed E2E: OK — installation atomique, persistante et idempotente.');
