import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const batch7 = read('equipment-image-coverage-batch7.js');
const batch8 = read('equipment-image-coverage-batch8.js');
const linkage = read('equipment-media-linkage.js');
const media = read('equipment-media.js');
const index = read('index.html');
const worker = read('service-worker.js');

const pos = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `${token} doit être présent`);
  return value;
};

test('batch 7 promeut uniquement des médias constructeur directs pour quatre modèles exacts', () => {
  for (const id of ['kb-leader-lv5300a','kb-leader-lv5350','kb-leader-lt4448','kb-kramer-vs81av']) {
    assert.match(batch7, new RegExp(`id:'${id}'`), `${id} doit être couvert par batch 7`);
  }
  for (const asset of [
    'lv5300a_01main_pc.png','lv5300a_02main_pc.png','LV5300_rear_panel-1.jpg',
    'LV5350_01main_2_1.png','LV5350_01main_2_2.png','lv5350_rear1.png',
    '12_LT4448_01_main_1.png','12_LT4448_01_main_2.png','12_LT4448_03_content_2.jpg',
    'vs-81av.jpg'
  ]) assert.match(batch7, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(batch7, /verificationStatus:'verified'/);
  assert.match(batch7, /sourceTrust:'manufacturer-direct'/);
  assert.doesNotMatch(batch7, /verificationStatus:'candidate'/);
});

test('batch 7 valide strictement HTTPS et les domaines constructeur attendus', () => {
  assert.match(batch7, /'www\.leader\.co\.jp':'manufacturer-direct'/);
  assert.match(batch7, /'k\.kramerav\.com':'manufacturer-direct'/);
  assert.match(batch7, /url\.protocol === 'https:'/);
  assert.match(batch7, /trust === image\?\.sourceTrust/);
});

test('batch 7 conserve plusieurs vues officielles sans dupliquer les URLs ni écraser Admin', () => {
  assert.match(batch7, /officialImages:mergedOfficial/);
  assert.match(batch7, /officialImage:hadOfficial \? record\.officialImage : verified\[0\]/);
  assert.match(batch7, /const merged = new Map\(\)/);
  assert.match(batch7, /merged\.set\(key, \{ \.\.\.previous, \.\.\.image \}\)/);
  assert.match(batch7, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch7, /record\?\.officialImage\?\.locked === true/);
});

test('la fiche 360 affiche toutes les vues constructeur vérifiées et conserve une image primaire compatible', () => {
  assert.match(media, /const officials = normalizeImageList\(/);
  assert.match(media, /\.\.\.asArray\(catalog\?\.officialImages\)/);
  assert.match(media, /const official = officials\[0\] \|\| null/);
  assert.match(media, /officials,/);
  assert.match(media, /Photos constructeur du modèle/);
  assert.match(media, /media\.officials\.map\(image => imageMarkup\(image, 'eq-media-large'\)\)\.join\(''\)/);
  assert.match(media, /primary:\s*real\[0\]\s*\|\|\s*official\s*\|\|\s*candidates\[0\]/);
});

test('batch 7 reste le parent direct de batch 8 et la liaison attend la chaîne courante', () => {
  assert.match(batch8, /import \{ ensureEquipmentImageCoverageBatch7 \} from '\.\/equipment-image-coverage-batch7\.js'/);
  assert.match(batch8, /await ensureEquipmentImageCoverageBatch7\(\)/);
  assert.match(linkage, /import \{ ensureEquipmentImageCoverageBatch8 \} from '\.\/equipment-image-coverage-batch8\.js'/);
  assert.match(linkage, /await ensureEquipmentImageCoverageBatch8\(\)/);
  for (const id of ['kb-leader-lv5300a','kb-leader-lv5350','kb-leader-lt4448']) {
    assert.match(linkage, new RegExp(`'${id}'`));
  }
  assert.match(linkage, /Leader LV5300A/);
  assert.match(linkage, /Leader LV5350/);
  assert.match(linkage, /Leader LT4448/);
});

test('le shell charge batch 7 après batch 6 puis batch 8 avant la liaison et l’inventaire', () => {
  const batch6 = pos(index, 'src="equipment-image-coverage-batch6.js"');
  const batch7Pos = pos(index, 'src="equipment-image-coverage-batch7.js"');
  const batch8Pos = pos(index, 'src="equipment-image-coverage-batch8.js"');
  const linkagePos = pos(index, 'src="equipment-media-linkage.js"');
  const inventory = pos(index, 'src="inventory-master.js"');
  assert.ok(batch6 < batch7Pos && batch7Pos < batch8Pos);
  assert.ok(batch8Pos < linkagePos);
  assert.ok(linkagePos < inventory);
});

test('la PWA met batch 7 et batch 8 en cache', () => {
  assert.ok(worker.includes("'/equipment-image-coverage-batch7.js'"));
  assert.ok(worker.includes("'/equipment-image-coverage-batch8.js'"));
  assert.ok(worker.includes("'/equipment-media-linkage.js'"));
});
