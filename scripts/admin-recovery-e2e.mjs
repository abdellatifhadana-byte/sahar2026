import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const username = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const newPassword = process.env.PLATFORM_ADMIN_PASSWORD || '';
const oldPassword = process.env.E2E_OLD_ADMIN_PASSWORD || '';

async function login(password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ username, password })
  });
  return { status:response.status, payload:await response.json() };
}

assert.ok(newPassword.length >= 12, 'mot de passe de récupération E2E absent');
const recovered = await login(newPassword);
assert.equal(recovered.status, 200, `la récupération Admin doit accepter le nouveau secret: ${JSON.stringify(recovered.payload)}`);
assert.equal(recovered.payload.user?.role, 'admin');
assert.equal(recovered.payload.user?.platformAdminResetVersion, undefined, 'la version de récupération reste privée');

if (oldPassword) {
  const revoked = await login(oldPassword);
  assert.equal(revoked.status, 401, 'l’ancien secret Admin doit être révoqué après récupération');
}

console.log('E2E récupération administrateur: PASS');
