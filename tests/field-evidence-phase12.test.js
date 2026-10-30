import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const field = read('equipment-field-evidence-phase12.js');
const hostBridge = read('equipment-360-host-bridge.js');
const media = read('equipment-media.js');
const linkage = read('equipment-media-linkage.js');
const worker = read('service-worker.js');

const assetSizes = [1290, 4514, 3566, 4332, 6550, 3880, 6665, 4182, 4122];

test('Phase 12: les 9 nouvelles vues terrain sont des assets WebP compacts et présents', () => {
  let total = 0;
  for (let index = 1; index <= 9; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const path = new URL(`../assets/field-evidence/2026-08-16/phase12-${suffix}.webp`, import.meta.url);
    const bytes = fs.readFileSync(path);
    assert.equal(bytes.length, assetSizes[index - 1], `taille inattendue phase12-${suffix}.webp`);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', `signature RIFF manquante phase12-${suffix}.webp`);
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', `signature WEBP manquante phase12-${suffix}.webp`);
    total += bytes.length;
    assert.match(field, new RegExp(`2m-field12-${suffix}`));
    assert.match(field, new RegExp(`phase12-${suffix}\\.webp`));
  }
  assert.equal(total, 39101);
  assert.equal([...field.matchAll(/\{ id:'2m-field12-(\d{2})', url:/g)].length, 9);
});

test('Phase 12: les identifications lisibles sont documentées et les variantes ambiguës restent protégées', () => {
  for (const token of ['KUB.02','Spectrum MediaCenter','SFR08','HyperDeck Studio','Orban 2200','X0401H','Ross Ultrix','Platinum VX','Avid NEXIS','Artist | DNxIQ','LV5300A']) {
    assert.ok(field.includes(token), `référence terrain manquante: ${token}`);
  }
  assert.match(field, /KUB[^\n]*constructeur\/SKU/i);
  assert.match(field, /HyperDeck Studio — génération exacte à confirmer/);
  assert.match(field, /ne confirme pas le suffixe VSX/);
  assert.match(field, /ThinkStation[^\n]*modèle exact non lisible/);
  assert.doesNotMatch(field, /172\.31\./);
});

test('Phase 12: X0401H, Platinum VX et LV5300A sont promus uniquement en confirmation terrain', () => {
  for (const id of ['kb-evertz-x0401h','kb-imagine-platinum-vx','kb-leader-lv5300a']) {
    assert.match(field, new RegExp(`id:'${id}'`));
  }
  assert.match(field, /verificationStatus:'field-photo-confirmed'/);
  assert.match(field, /exactFrontModelConfirmed:true/);
  assert.match(field, /Cartes\/options internes non déduites/);
});

test('Phase 12: field evidence reste séparé des photos constructeur et instance', () => {
  assert.match(field, /fieldEvidenceImages/);
  assert.match(field, /sourceType:'2m-field-photo'/);
  assert.doesNotMatch(field, /officialImage\s*[:=]/);
  assert.doesNotMatch(field, /equipment\.images\s*=/);
  assert.match(field, /ne deviennent ni photo constructeur ni photo d’instance/);
  assert.match(media, /real\[0\] \|\| official \|\| candidates\[0\]/);
  assert.doesNotMatch(media, /fieldEvidencePhase12/);
});

test('Phase 12: la liaison catalogue reste exacte et sans alias génériques dangereux', () => {
  // Plancher, pas égalité : toute modification de la table d'alias DOIT incrémenter cette
  // version pour rejouer la migration. Figer la valeur faisait échouer le test au moment
  // précis où le code se comportait correctement.
  const version = linkage.match(/EQUIPMENT_MEDIA_LINKAGE_VERSION = (\d+)/);
  assert.ok(version && Number(version[1]) >= 3, 'La version de liaison média doit rester au niveau Phase 12 ou au-dessus.');
  assert.match(linkage, /'kb-kub-usb-scan-station'/);
  assert.match(linkage, /'kb-harmonic-spectrum-mediacenter'/);
  assert.match(linkage, /'kb-blackmagic-hyperdeck-legacy'/);
  assert.match(linkage, /'kb-evertz-x0401h'/);
  assert.match(linkage, /'kb-avid-dnxiq'/);
  assert.match(linkage, /'kb-imagine-platinum-vx'/);
  assert.doesNotMatch(linkage, /'kb-blackmagic-hyperdeck-legacy': Object\.freeze\(\[[^\]]*'HyperDeck'\]/);
  assert.doesNotMatch(linkage, /'kb-kub-usb-scan-station': Object\.freeze\(\[[^\]]*'KUB'\]/);
});

test('Phase 12: Fiche 360 et PWA chargent le module de complément terrain', () => {
  assert.match(field, /Preuves terrain 2M — complément/);
  assert.match(field, /startsWith\('2m-field12-'\)/);
  assert.match(hostBridge, /import '\.\/equipment-field-evidence-phase12\.js'/);
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/equipment-field-evidence-phase12\.js/);
});

test('#78 Phase 0: les images phase12 ne sont plus précachées, et la fiche ne rend plus le chemin statique', () => {
  /*
   * Ces neuf chemins étaient exigés dans `ASSETS_TO_CACHE` — la fuite mesurée par #78. Ils
   * ne sont plus précachés, et `resolveFieldEvidencePhase12Asset` ne rend plus le chemin
   * statique bloqué : un `<img>` cassé aurait remplacé la fuite par une régression visuelle
   * silencieuse. `tests/field-evidence-containment.test.js` porte la couverture du
   * confinement lui-même.
   */
  const precacheList = worker.slice(worker.indexOf('const ASSETS_TO_CACHE'), worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE')));
  for (let index = 1; index <= 9; index += 1) {
    const suffix = String(index).padStart(2, '0');
    assert.doesNotMatch(precacheList, new RegExp(`/assets/field-evidence/2026-08-16/phase12-${suffix}\\.webp`));
  }
  assert.doesNotMatch(field, /return assetIndex\.get/);
  assert.match(field, /export async function resolveFieldEvidencePhase12Asset\(\)\s*\{\s*return '';/);
});