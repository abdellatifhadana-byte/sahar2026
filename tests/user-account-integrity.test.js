import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('IndexedDB v15 migrates the historical username index without blocking central sync', () => {
  const migration = read('db-migration-v15.js');
  assert.match(migration, /TARGET_VERSION = 15/);
  assert.match(migration, /users\.index\('username'\)\.unique/);
  assert.match(migration, /deleteIndex\('username'\)/);
  assert.match(migration, /createIndex\('username', 'username', \{ unique: false \}\)/);
});

test('user management creates separate canonical roles and rejects duplicate logins', () => {
  const users = read('users.js');
  // La liste des rôles n'est plus FIGÉE dans le gabarit. Elle commençait par
  // « Administrateur » : quiconque atteignait ce formulaire pouvait fabriquer un second
  // administrateur. Elle est désormais construite à partir des rôles réellement
  // attribuables par l'acteur — et `admin` n'en fait jamais partie.
  assert.match(users, /<select id="role" required>\$\{optionsDeRole\(this\.user\)\}<\/select>/);
  assert.match(users, /function optionsDeRole\(acteur\)/);
  assert.match(users, /const disponibles = assignableRoles\(acteur\?\.role\)/);
  assert.doesNotMatch(users, /<option value="admin">/);
  assert.match(users, /Le nom d'utilisateur « \$\{username\} » est déjà utilisé/);
  /*
   * La modification part TOUJOURS de la fiche existante — sans quoi une modification de
   * profil effacerait les champs absents du formulaire. Elle en part désormais ASSAINIE
   * (B-4) : le cache local ne conserve plus de matière d'authentification, et reconduire
   * `oldUser.password` revenait à traîner une clé vide jusqu'au serveur tout en rendant
   * une modification de profil indiscernable d'un vrai changement d'identifiant.
   */
  assert.match(users, /\.\.\.sanitizeLocalUserCredentialFields\(oldUser\)/);
  assert.doesNotMatch(users, /oldUser\.password/,
    'reconduire l’ancien champ rendrait une modification de profil indiscernable d’un changement d’identifiant');
  assert.match(users, /Vous ne pouvez pas supprimer votre propre compte/);
});

test('new logins require the central authority while an existing session can survive a network outage', () => {
  const auth = read('auth.js');
  assert.match(auth, /syncCentralSafely/);
  assert.match(auth, /Connexion au serveur central requise pour ouvrir une nouvelle session/);
  assert.doesNotMatch(auth, /db\.getAll\('users', 'username', cleanUsername\)/);
  assert.match(auth, /session locale déjà ouverte est conservée temporairement/);
  assert.match(auth, /clearLocalCredentialCache/);
  assert.match(auth, /clearPrivateLocalData/);
});

test('central API hashes passwords, revalidates sessions and protects the global admin', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /scrypt-v1/);
  assert.match(server, /PLATFORM_ADMIN_USERNAME/);
  assert.match(server, /PLATFORM_ADMIN_PASSWORD/);
  assert.match(server, /platform_users_username_lower_unique/);
  assert.match(server, /async function currentUser/);
  assert.match(server, /authVersion/);
  assert.match(server, /GLOBAL_ADMIN_INVARIANT/);
  assert.match(server, /USERNAME_EXISTS/);
  assert.doesNotMatch(server, /Buffer\.from\(['"]admin123['"]/);
  assert.doesNotMatch(server, /password\s*:\s*['"]admin123['"]/);
});

test('global admin recovery is explicit, one-time and never exposed by the API', () => {
  const server = read('scripts/serve.js');
  const recoveryE2e = read('scripts/admin-recovery-e2e.mjs');
  assert.match(server, /PLATFORM_ADMIN_RESET_VERSION/);
  assert.match(server, /current\.platformAdminResetVersion \|\| ''\) !== resetVersion/);
  assert.match(server, /authVersion:Math\.max\(1, Number\(current\.authVersion \|\| 0\) \+ 1\)/);
  assert.match(server, /platformAdminResetVersion: _resetVersion/);
  assert.match(server, /platformAdminResetAt: _resetAt/);
  assert.match(server, /PLATFORM_ADMIN_USERNAME est déjà utilisé par un autre compte actif/);
  assert.match(recoveryE2e, /l’ancien secret Admin doit être révoqué après récupération/);
});

test('PWA refresh reports offline API failure and caches security/access modules', () => {
  const sw = read('service-worker.js');
  const html = read('index.html');
  assert.match(sw, /2mtech-v\d+\.\d+/);
  assert.match(sw, /status: 503/);
  assert.match(sw, /db-migration-v15\.js/);
  assert.match(sw, /zone-access\.js/);
  assert.match(sw, /zone-access-integration\.js/);
  assert.match(sw, /diagnostic-xss-guard\.js/);
  assert.match(sw, /credential-cache-guard\.js/);
  assert.match(html, /credential-cache-guard\.js/);
});
