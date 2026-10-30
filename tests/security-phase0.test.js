import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('central sync never exposes password material and hides users from non-admin roles', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /safeUserRecord/);
  assert.match(server, /passwordHash: _hash/);
  // La liste des comptes reste réservée aux rôles qui voient toute la chaîne —
  // administrateur et manager. `isAdminRole` confondait cette question de LECTURE avec le
  // pouvoir d'administration ; les deux sont désormais distinctes.
  assert.match(server, /if \(row\.store_name === 'users'\) \{\s*if \(!seesEverything\(user\.role\)\) continue;/s);
  assert.match(server, /access\.canAccessRecord\(user, row\.store_name, row\.data, 'read'\)/);
  assert.match(server, /sanitizeForSync/);
});

test('logout reaches the central logout endpoint through Core', () => {
  const core = read('core.js');
  const auth = read('auth.js');
  assert.match(core, /await this\.auth\.logout\(\)/);
  assert.match(auth, /fetch\('\/api\/auth\/logout'/);
  assert.match(auth, /localStorage\.removeItem\('auth'\)/);
});

test('private repository paths are blocked by the static server', () => {
  const server = read('scripts/serve.js');
  assert.match(server, /PRIVATE_PREFIXES/);
  assert.match(server, /\.git/);
  assert.match(server, /scripts/);
  assert.match(server, /tests/);
  assert.match(server, /isPrivateStaticPath/);
});

test('sync queue isolates permanent client errors and keeps processing later records', () => {
  /*
   * LE COMPORTEMENT EST ÉPROUVÉ AILLEURS, EN L'EXÉCUTANT.
   *
   * Ce test lisait le TEXTE de la file — dont `status: 'failed'`. Il est devenu rouge le
   * jour où ces états ont reçu un nom partagé (`QUEUE_STATUSES`), c'est-à-dire le jour où
   * la règle qu'il prétend protéger a été rendue plus explicite. Une chaîne qui n'a pas
   * bougé ne prouve pas qu'une opération rejetée est isolée ni que la file continue.
   *
   * `tests/concurrence-client-conflit.test.js` · CONF·17 le fait tourner pour de vrai :
   * deux opérations en attente, l'une refusée en 400, l'autre acceptée — la seconde part,
   * la première est isolée, et le cycle suivant ne la rejoue pas.
   *
   * Ne restent ici que les invariants de FORME, ceux qu'aucune exécution ne montre : la
   * frontière 4xx, et le fait que les enregistrements strictement locaux — `current-room` —
   * ne partent jamais vers le serveur.
   */
  const sync = read('central-sync.js');
  assert.match(sync, /status >= 400 && status < 500/);
  assert.match(sync, /continue;/);
  assert.match(sync, /isLocalOnlyRecord/);
  assert.match(sync, /current-room/);
});

test('service worker API failures are explicit 503 responses', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /error: 'OFFLINE'/);
  assert.match(sw, /status: 503/);
  assert.match(sw, /Cache-Control': 'no-store/);
});

test('pull requests are verified by CI', () => {
  const workflow = read('.github/workflows/verify.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /\.git\/config/);
});
