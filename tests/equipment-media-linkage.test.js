import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveCatalogIdForMedia, EQUIPMENT_MEDIA_ALIASES } from '../equipment-media-linkage.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const linkage = read('equipment-media-linkage.js');
const index = read('index.html');
const worker = read('service-worker.js');
const media = read('equipment-media.js');

const catalogs = Object.entries(EQUIPMENT_MEDIA_ALIASES).map(([id, inventoryAliases]) => ({
  id,
  kind:'equipment_catalog',
  inventoryAliases
}));

test('les références média historiques et nouvelles ont des alias déterministes', () => {
  for (const id of ['kb-tc-dbmax','kb-kramer-vs81av','kb-wohler-amp2am','kb-riedel-artist','kb-tsl-tallyman','kb-harmonic-spectrum-vsx','kb-cisco-c9300x12y','kb-grille-centrale-190x184']) {
    assert.ok(EQUIPMENT_MEDIA_ALIASES[id]?.length, `${id} doit avoir au moins un alias`);
  }
});

test('la résolution média relie un équipement importé sans catalogId par référence ou modèle exact', () => {
  assert.equal(resolveCatalogIdForMedia({ inventorySource:{ reference:'TC Electronic DBMAX' } }, catalogs), 'kb-tc-dbmax');
  assert.equal(resolveCatalogIdForMedia({ modele:'VS-81AV' }, catalogs), 'kb-kramer-vs81av');
  assert.equal(resolveCatalogIdForMedia({ name:'WOHLER AMP2-AM' }, catalogs), 'kb-wohler-amp2am');
  assert.equal(resolveCatalogIdForMedia({ modele:'Spectrum VSX' }, catalogs), 'kb-harmonic-spectrum-vsx');
  assert.equal(resolveCatalogIdForMedia({ modele:'C9300X-12Y' }, catalogs), 'kb-cisco-c9300x12y');
  assert.equal(resolveCatalogIdForMedia({ name:'GRILLE CENTRALE' }, catalogs), 'kb-grille-centrale-190x184');
});

test('une correspondance ambiguë ne crée jamais un catalogId inventé', () => {
  const ambiguous = [
    { id:'a', inventoryAliases:['MODEL X'] },
    { id:'b', inventoryAliases:['MODEL X'] }
  ];
  assert.equal(resolveCatalogIdForMedia({ modele:'MODEL X' }, ambiguous), '');
});

test('un lien VALIDE reste prioritaire ; un lien PENDANT est réparé', () => {
  // Un rattachement existant et vérifiable ne doit pas être écrasé par une correspondance
  // de modèle : c'est une décision explicite.
  assert.equal(resolveCatalogIdForMedia({ catalogId:'kb-tsl-tallyman', modele:'MODEL X' }, catalogs), 'kb-tsl-tallyman');

  // MAIS la boucle de réparation sautait TOUTE fiche portant un `catalogId`, sans vérifier
  // qu'il désigne quelque chose. Mesuré en base : douze équipements pointaient vers
  // `kb-sony-vtr`, une entrée de catalogue inexistante. Ils étaient donc écartés de la
  // réparation À CAUSE du lien cassé lui-même, et n'affichaient jamais d'image.
  assert.doesNotMatch(linkage, /if \(String\(equipment\.catalogId \|\| ''\)\.trim\(\)\) continue/);
  assert.match(linkage, /const actuel = String\(equipment\.catalogId \|\| ''\)\.trim\(\);/);
  assert.match(linkage, /if \(actuel && catalogueExiste\(actuel\)\) continue;/);
  // Et la résolution repart bien de zéro quand l'identifiant ne désigne rien.
  assert.equal(resolveCatalogIdForMedia({ catalogId:'kb-inexistant', modele:'VS-81AV' }, catalogs), 'kb-kramer-vs81av');
  // Une réparation qui rendrait le MÊME identifiant cassé n'écrit rien.
  assert.match(linkage, /if \(!catalogId \|\| catalogId === actuel\) continue;/);
  assert.match(linkage, /adminCatalog\(record\)/);
});

test('la réparation persiste les alias et relance le lien après import ou synchronisation centrale', () => {
  assert.match(linkage, /inventoryAliases:merged/);
  assert.match(linkage, /await db\.save\('equipments'/);
  assert.match(linkage, /central-sync-status/);
  assert.match(linkage, /inventory-master-imported/);
  assert.match(linkage, /equipment-media-linkage-updated/);
});

test('le module de liaison charge après batch 8 et Grille Centrale avant inventaire et média', () => {
  const batch7 = index.indexOf('src="equipment-image-coverage-batch7.js"');
  const batch8 = index.indexOf('src="equipment-image-coverage-batch8.js"');
  const grille = index.indexOf('src="grille-centrale-knowledge.js"');
  const linkagePos = index.indexOf('src="equipment-media-linkage.js"');
  const inventory = index.indexOf('src="inventory-master.js"');
  const mediaPos = index.indexOf('src="equipment-media.js"');
  assert.ok(batch7 >= 0 && batch8 > batch7 && grille > batch8);
  assert.ok(linkagePos > grille);
  assert.ok(inventory > linkagePos);
  assert.ok(mediaPos > inventory);
});

test('la PWA embarque la chaîne média courante sans casser la génération de cache', () => {
  const cache = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache, 'Le Service Worker doit déclarer une version de cache 2mtech-v5.x');
  assert.ok(Number(cache[1]) >= 19, 'Le cache courant doit être au moins postérieur à la phase média 5.19');
  assert.ok(worker.includes("'/equipment-media-linkage.js'"));
  assert.ok(worker.includes("'/equipment-image-coverage-batch8.js'"));
  assert.ok(worker.includes("'/grille-centrale-knowledge.js'"));
});

test('une fois catalogId résolu, le rendu affiche le primaire dans le tableau et toutes les galeries dans la fiche 360', () => {
  assert.match(media, /primary:\s*real\[0\]\s*\|\|\s*official\s*\|\|\s*candidates\[0\]/);
  assert.match(media, /cell\.innerHTML = imageMarkup\(media\.primary/);
  assert.match(media, /Photos réelles 2M/);
  assert.match(media, /Photos constructeur du modèle/);
  assert.match(media, /media\.officials\.map\(image => imageMarkup\(image, 'eq-media-large'\)\)\.join\(''\)/);
  assert.match(media, /Visuels externes candidats/);
  assert.match(media, /media\.candidates\.map\(image => imageMarkup\(image, 'eq-media-large'\)\)\.join\(''\)/);
});