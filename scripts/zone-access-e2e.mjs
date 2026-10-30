import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const userId = 92401;
const zoneId = 'phase24-zone-access';
const username = 'phase24-responsable';

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

const admin = await request('/api/auth/login', { method:'POST', body:{ username:adminUsername, password:adminPassword } });
assert.ok(admin.cookie.startsWith('tp_session='));

const encodedPassword = Buffer.from('Zone-Verrou-Antenne-2026!').toString('base64');
await request(`/api/data/users/${userId}`, {
  method:'PUT', cookie:admin.cookie,
  body:{
    id:userId,
    username,
    fullName:'Responsable Phase 24',
    role:'responsible',
    status:'active',
    password:encodedPassword,
    authVersion:1
  }
});

await request('/api/access/zones', {
  method:'POST', cookie:admin.cookie,
  body:{ id:zoneId, name:'Zone Phase 24', publicSummary:'Zone de validation des affectations et permissions.' }
});

await request('/api/access/memberships', {
  method:'POST', cookie:admin.cookie,
  body:{ userId, zoneId, responsible:true, expiresAt:null }
});

await request('/api/access/grants', {
  method:'POST', cookie:admin.cookie,
  body:{ userId, zoneId, permission:'equipment.read', expiresAt:null }
});

const manage = await request('/api/access/manage', { cookie:admin.cookie });
const users = manage.payload.users || [];
const zones = manage.payload.zones || [];
const memberships = manage.payload.memberships || [];
const grants = manage.payload.grants || [];

assert.ok(users.some(user => String(user.id) === String(userId) && user.username === username), 'l’utilisateur assignable doit apparaître dans Accès zones');
assert.ok(zones.some(zone => String(zone.id) === zoneId), 'la zone créée doit apparaître dans Accès zones');
assert.ok(memberships.some(item => String(item.userId) === String(userId) && String(item.zoneId) === zoneId), 'l’affectation utilisateur-zone doit persister');
assert.ok(grants.some(item => String(item.userId) === String(userId) && String(item.zoneId) === zoneId && item.permission === 'equipment.read'), 'la permission de zone doit persister');

const safeUser = users.find(user => String(user.id) === String(userId));
assert.equal(safeUser.password, undefined, 'le mot de passe ne doit jamais être exposé par /api/access/manage');
assert.equal(safeUser.passwordHash, undefined, 'le hash du mot de passe ne doit jamais être exposé');

const responsibleLogin = await request('/api/auth/login', {
  method:'POST',
  body:{ username, password:'Zone-Verrou-Antenne-2026!' }
});
assert.equal(responsibleLogin.payload.user?.role, 'responsible');
const context = await request('/api/access/context', { cookie:responsibleLogin.cookie });
assert.ok((context.payload.memberships || context.payload.context?.memberships || []).some(item => String(item.zoneId) === zoneId), 'le responsable doit récupérer son affectation après connexion');

console.log('Zone access E2E: OK — utilisateur, zone, affectation et permission persistent et sont visibles.');
