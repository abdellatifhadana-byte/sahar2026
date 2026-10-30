import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';

async function request(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers:{ ...(body === undefined ? {} : { 'content-type':'application/json' }), ...(cookie ? { cookie } : {}) },
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.equal(response.status, expected, `${method} ${path}: attendu ${expected}, reçu ${response.status} ${text}`);
  return { payload, cookie:response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { method:'POST', body:{ username, password } });
  assert.ok(result.cookie.startsWith('tp_session='));
  return result.cookie;
}

const adminCookie = await login(adminUsername, adminPassword);
const responsibleCookie = await login('resp.rf1', 'Resp-RF1-Verrou-2026!');
const adminSync = await request('/api/sync', { cookie:adminCookie });
assert.ok(!adminSync.payload.access.zones.some(zone => String(zone.id) === 'room-2'), 'le redémarrage a recréé une zone transitoire malgré le mapping RF1');

await request('/api/data/docs/restart-diagram', { method:'PUT', cookie:adminCookie, body:{
  id:'restart-diagram', kind:'technical_diagram', title:'Régression redémarrage RF1', diagramType:'signal-synoptic',
  status:'draft', zoneIds:['rf1'],
  nodes:[{ id:'rf1-main', type:'entity', label:'Principal', entityRef:{ type:'equipment', id:20 } }], edges:[]
} });
await request('/api/diagrams/restart-diagram/validate', { method:'POST', cookie:responsibleCookie, body:{} });

const responsibleSync = await request('/api/sync', { cookie:responsibleCookie });
assert.equal(responsibleSync.payload.data.docs.find(item => item.id === 'restart-diagram')?.status, 'validated');
assert.ok(responsibleSync.payload.data.equipments.some(item => String(item.id) === '20'));

console.log('E2E sécurité après redémarrage: PASS');
