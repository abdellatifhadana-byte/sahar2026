import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const preload = read('scripts/inventory-replace-preload.js');
const client = read('inventory-central-install.js');
const sw = read('service-worker.js');
const workflow = read('.github/workflows/verify.yml');

test('production start preloads the isolated atomic inventory replacement endpoint', () => {
  assert.match(packageJson.scripts.start, /--import \.\/scripts\/inventory-replace-preload\.js/);
  assert.match(packageJson.scripts.start, /scripts\/serve\.js/);
  assert.match(preload, /\/api\/sync\/inventory-replace/);
  assert.match(preload, /\/api\/auth\/session/);
  assert.match(preload, /\['admin','manager'\]/);
});

test('replacement is transactional and resets only operational stores', () => {
  assert.match(preload, /await client\.query\('BEGIN'\)/);
  assert.match(preload, /await client\.query\('COMMIT'\)/);
  assert.match(preload, /await client\.query\('ROLLBACK'\)/);
  for (const store of ['rooms','baies','equipments','walls','screens','screen_groups','tickets','notes','attachments','cables']) {
    assert.match(preload, new RegExp(`'${store}'`));
  }
  const operationalDeclaration = preload.match(/export const OPERATIONAL_STORES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
  for (const preserved of ['users','docs','faq','settings','logs','notifications']) {
    assert.doesNotMatch(operationalDeclaration, new RegExp(`'${preserved}'`), `${preserved} ne doit pas être supprimé globalement`);
  }
});

test('mixed docs store retires only canonical operational document kinds', () => {
  assert.match(preload, /TOPOLOGY_KIND_SET/);
  assert.match(preload, /CONTINUITY_KIND_SET/);
  assert.match(preload, /DIAGRAM_RECORD_KIND/);
  assert.match(preload, /retireOperationalDocuments/);
  assert.match(preload, /knowledge-and-catalog-docs/);
  assert.doesNotMatch(preload, /store_name='docs'[^\n]*SET deleted=TRUE/);
});

test('central client detects production mode, replaces on server, clears only stale operational queue and re-pulls snapshot', () => {
  assert.match(client, /api\('\/api\/health'\)/);
  assert.match(client, /health\?\.centralSync === true/);
  assert.match(client, /\/api\/sync\/inventory-replace/);
  assert.match(client, /clearOperationalSyncQueue/);
  assert.match(client, /OPERATIONAL_SET\.has\(entry\.storeName\)/);
  assert.match(client, /enableCentralSync\(\{ bootstrapLocal:false \}\)/);
  assert.match(client, /verifyLocalMirror/);
  assert.doesNotMatch(client, /CENTRAL_OPERATIONAL_DATA_PRESENT/);
});

test('PWA and CI exercise the production inventory path and current media-aware cache', () => {
  assert.match(sw, /2mtech-v5\.19/);
  assert.match(sw, /inventory-central-install\.js/);
  assert.match(sw, /equipment-image-coverage-batch2\.js/);
  assert.match(sw, /equipment-image-coverage-batch3\.js/);
  assert.match(sw, /equipment-image-coverage-batch4\.js/);
  assert.match(sw, /equipment-image-coverage-batch5\.js/);
  assert.match(sw, /equipment-media\.js/);
  assert.match(workflow, /npm start/);
  assert.match(workflow, /inventory-replace-e2e\.mjs/);
  assert.match(workflow, /E2E_VERIFY_ONLY='1'/);
  assert.match(workflow, /scripts\/inventory-replace-preload\.js/);
});