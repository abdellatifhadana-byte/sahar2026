import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const batch6 = read('equipment-image-coverage-batch6.js');
const batch7 = read('equipment-image-coverage-batch7.js');
const batch8 = read('equipment-image-coverage-batch8.js');
const linkage = read('equipment-media-linkage.js');
const media = read('equipment-media.js');
const gap = read('equipment-catalog-gap-seed.js');
const index = read('index.html');
const worker = read('service-worker.js');

const pos = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `${token} doit être présent`);
  return value;
};

test('batch 6 initialise le catalogue gap avant les médias TITAN et Wohler', () => {
  assert.match(batch6, /import \{ ensureGapCatalogSeed \} from '\.\/equipment-catalog-gap-seed\.js'/);
  assert.match(batch6, /await ensureEquipmentImageCoverageBatch5\(\)/);
  assert.match(batch6, /await ensureGapCatalogSeed\(\)/);
  for (const id of ['kb-titan-usb8comirm','kb-wohler-amp1a-lp','kb-wohler-lm30-4','kb-wohler-vm2a']) {
    assert.match(gap, new RegExp(`'${id}'`), `${id} doit exister dans le catalogue gap`);
    assert.match(batch6, new RegExp(`id:'${id}'`), `${id} doit être couvert par batch 6`);
  }
});

test('batch 6 ajoute les références Dell, HP, Orban, TITAN et Wohler sans promotion risquée', () => {
  for (const id of ['kb-dell-precision3930r','kb-dell-r350','kb-dell-r450','kb-dell-r750','kb-hp-lp2475w','kb-orban2200','kb-titan-usb8comirm','kb-wohler-amp1a-lp','kb-wohler-lm30-4','kb-wohler-vm2a']) {
    assert.match(batch6, new RegExp(`id:'${id}'`), `${id} doit avoir un média ou une source batch 6`);
  }
  assert.match(batch6, /supportkb\.dell\.com/);
  assert.match(batch6, /dl\.dell\.com/);
  assert.match(batch6, /neweggimages\.com/);
  assert.match(batch6, /rvb-img\.reverb\.com/);
  assert.match(batch6, /studiocare\.com/);
  assert.match(batch6, /usbgear\.com/);
  assert.match(batch6, /verificationStatus:'candidate'/);
  assert.doesNotMatch(batch6, /officialImage\s*:/);
  assert.doesNotMatch(batch6, /officialImages\s*:/);
});

test('les vues Dell restent candidates quand la configuration ou le Service Tag terrain doit être confirmé', () => {
  assert.match(batch6, /probable-exact-front/);
  assert.match(batch6, /probable-exact-rear/);
  assert.match(batch6, /exact-model-config-example/);
  assert.match(batch6, /Service Tag/);
  assert.match(batch6, /configuration de façade/);
  assert.match(batch6, /requiresFieldConfirmation:true/);
});

test('TITAN conserve la page constructeur comme référence malgré le visuel OEM secondaire', () => {
  assert.match(batch6, /sourcePage:'https:\/\/www\.titan\.tw\/product\/usb-8comi-rm\/'/);
  assert.match(batch6, /exact-model-number-oem-example/);
  assert.match(batch6, /branding terrain TITAN à confirmer/);
  assert.match(batch6, /trusted-technical-reseller/);
});

test('les références génériques du gap restent protégées contre les photos inventées', () => {
  for (const id of ['kb-gap-monitor-it24','kb-swit-monitor21-family','kb-gap-quad-av-matrix','kb-gap-sdi-hdmi-converter','kb-gap-gpi-box','kb-gap-sescom-vu','kb-gap-streaming-speaker']) {
    assert.match(batch6, new RegExp(`'${id}'`), `${id} doit rester model-required/protégé`);
  }
  assert.match(batch6, /protectedGenericIds\.has\(id\)/);
  assert.match(batch6, /genericProtected/);
});

test('batch 6 protège les décisions Admin, valide HTTPS et déduplique les URLs', () => {
  assert.match(batch6, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch6, /record\?\.imageResearch\?\.locked === true/);
  assert.match(batch6, /record\?\.officialImage\?\.origin === 'admin'/);
  assert.match(batch6, /record\?\.officialImage\?\.locked === true/);
  assert.match(batch6, /url\.protocol === 'https:'/);
  assert.match(batch6, /const merged = new Map\(\)/);
  assert.match(batch6, /merged\.set\(key, \{ \.\.\.previous, \.\.\.image \}\)/);
});

test('la chaîne média conserve batch 6 puis batch 7 puis batch 8 avant de résoudre les instances', () => {
  assert.match(batch7, /import \{ ensureEquipmentImageCoverageBatch6 \} from '\.\/equipment-image-coverage-batch6\.js'/);
  assert.match(batch7, /await ensureEquipmentImageCoverageBatch6\(\)/);
  assert.match(batch8, /import \{ ensureEquipmentImageCoverageBatch7 \} from '\.\/equipment-image-coverage-batch7\.js'/);
  assert.match(batch8, /await ensureEquipmentImageCoverageBatch7\(\)/);
  assert.match(linkage, /import \{ ensureEquipmentImageCoverageBatch8 \} from '\.\/equipment-image-coverage-batch8\.js'/);
  assert.match(linkage, /await ensureEquipmentImageCoverageBatch8\(\)/);
  assert.doesNotMatch(linkage, /ensureEquipmentImageCoverageBatch5/);
});

test('la fiche 360 montre tous les candidats collectés et le tableau se rafraîchit après liaison tardive', () => {
  assert.match(media, /Visuels externes candidats/);
  assert.match(media, /media\.candidates\.map\(image => imageMarkup\(image, 'eq-media-large'\)\)\.join\(''\)/);
  assert.match(media, /equipment-media-linkage-updated/);
  assert.match(media, /catalogMap\(true\)/);
  assert.match(media, /decorateEquipmentTable\(\)/);
});

test('le shell conserve batch 6 avant batch 7 batch 8 puis la liaison média et l’inventaire', () => {
  const batch5 = pos(index, 'src="equipment-image-coverage-batch5.js"');
  const batch6Pos = pos(index, 'src="equipment-image-coverage-batch6.js"');
  const batch7Pos = pos(index, 'src="equipment-image-coverage-batch7.js"');
  const batch8Pos = pos(index, 'src="equipment-image-coverage-batch8.js"');
  const linkagePos = pos(index, 'src="equipment-media-linkage.js"');
  const inventory = pos(index, 'src="inventory-master.js"');
  assert.ok(batch5 < batch6Pos && batch6Pos < batch7Pos && batch7Pos < batch8Pos);
  assert.ok(batch8Pos < linkagePos);
  assert.ok(linkagePos < inventory);
});

test('la PWA met batch 6 et la chaîne média courante en cache', () => {
  assert.ok(worker.includes("'/equipment-image-coverage-batch6.js'"));
  assert.ok(worker.includes("'/equipment-image-coverage-batch8.js'"));
  assert.ok(worker.includes("'/equipment-media-linkage.js'"));
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache, 'Le Service Worker doit déclarer une version de cache 2mtech-v5.x');
  assert.ok(Number(cache[1]) >= 19, 'La version du cache doit rester au moins égale à la phase média 5.19');
});