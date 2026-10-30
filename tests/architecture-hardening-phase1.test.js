import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyMediaRecord,
  inspectMediaUrl,
  mediaTypeLabel,
  MEDIA_TYPES
} from '../media-contract.js';
import { summarizeIntegrityCounts, INTEGRITY_WARNING_KEYS } from '../data-integrity.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const runtime = read('media-runtime-health.js');
const persistence = read('persistent-image-guard.js');
const integrityCenter = read('integrity-center.js');
const index = read('index.html');
const serviceWorker = read('service-worker.js');
const activeModules = read('scripts/check-active-modules.js');

test('le contrat média distingue terrain, produit, vue technique, schéma et candidat', () => {
  assert.deepEqual(MEDIA_TYPES, [
    'field-photo','product-photo','technical-view','manufacturer-diagram','candidate-reference'
  ]);
  assert.equal(classifyMediaRecord({ sourceType:'instance', url:'data:image/png;base64,AA==' }), 'field-photo');
  assert.equal(classifyMediaRecord({
    sourceType:'manufacturer', verificationStatus:'verified',
    url:'https://www.cisco.com/example.docx/_jcr_content/renditions/figure.png',
    matchNote:'Figure constructeur Cisco'
  }), 'manufacturer-diagram');
  assert.equal(classifyMediaRecord({
    sourceType:'manufacturer', verificationStatus:'verified',
    url:'https://www.cisco.com/example.docx/_jcr_content/renditions/figure.png'
  }), 'manufacturer-diagram');
  assert.equal(classifyMediaRecord({
    sourceType:'manufacturer', verificationStatus:'verified',
    url:'https://dl.dell.com/content/guides/public/Html/per750/images/front.jpg'
  }), 'technical-view');
  assert.equal(classifyMediaRecord({ sourceType:'secondary-source', verificationStatus:'candidate', url:'https://example.com/device.jpg' }), 'candidate-reference');
  assert.equal(classifyMediaRecord({ sourceType:'manufacturer', verificationStatus:'verified', url:'https://example.com/product.jpg' }), 'product-photo');
  assert.equal(mediaTypeLabel('manufacturer-diagram'), 'Schéma constructeur');
});

test('le contrat signale les assets de documentation et les sources secondaires fragiles', () => {
  assert.equal(inspectMediaUrl({ url:'https://www.cisco.com/a.docx/_jcr_content/renditions/a.png' }).fragile, true);
  assert.equal(inspectMediaUrl({ url:'https://dl.dell.com/content/guides/public/Html/r750/front.jpg' }).fragile, true);
  assert.equal(inspectMediaUrl({ url:'https://rvb-img.reverb.com/example.jpg' }).fragile, true);
  assert.equal(inspectMediaUrl({ url:'http://example.com/insecure.jpg' }).valid, false);
});

test('les médias fragiles restent des avertissements et ne rendent pas seuls la base invalide', () => {
  assert.deepEqual(INTEGRITY_WARNING_KEYS, ['mediaFragileUrls']);
  assert.deepEqual(summarizeIntegrityCounts({ mediaFragileUrls:4, cableShape:0 }), { blocking:0, warnings:4, valid:true });
  assert.deepEqual(summarizeIntegrityCounts({ mediaFragileUrls:4, cableShape:2 }), { blocking:2, warnings:4, valid:false });
  assert.match(integrityCenter, /Liens média à surveiller/);
  assert.match(integrityCenter, /avertissement\(s\)/);
});

test('le runtime média prévoit badge de type, échec visible et fallback pour la miniature', () => {
  assert.match(runtime, /eq-media-kind-badge/);
  assert.match(runtime, /Média indisponible/);
  assert.match(runtime, /tryTableFallback/);
  assert.match(runtime, /equipment-media-runtime-failure/);
  assert.match(runtime, /document\.addEventListener\('error', handleImageError, true\)/);
});

test('les images blob des salles et baies sont converties avant écriture', () => {
  assert.match(persistence, /GUARDED_STORES = new Set\(\['rooms', 'baies'\]\)/);
  assert.match(persistence, /isTransientMediaUrl\(record\?\.image\)/);
  assert.match(persistence, /readAsDataURL/);
  assert.match(persistence, /MAX_PERSISTED_IMAGE_BYTES/);
  assert.match(persistence, /saveWithPersistentImages/);
});

test('les nouveaux modules sont dans le shell actif et le cache PWA', () => {
  for (const file of ['media-contract.js','persistent-image-guard.js','media-runtime-health.js']) {
    assert.match(index, new RegExp(`src="${file.replace('.', '\\.')}`));
    assert.match(serviceWorker, new RegExp(`/${file.replace('.', '\\.')}`));
  }
  assert.match(index, /media-runtime-health\.css/);
  assert.match(serviceWorker, /media-runtime-health\.css/);
  assert.match(index, /db-migration-v15\.js/);
});

test('le graphe actif refuse les anciennes copies dupliquées', () => {
  assert.match(activeModules, /FORBIDDEN_ACTIVE_PREFIXES/);
  for (const prefix of ['LEGACY-ROOT/','SOURCE-WALLS/','app/','assets/js/app/']) {
    assert.match(activeModules, new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
