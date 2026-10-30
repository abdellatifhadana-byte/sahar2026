import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INVENTORY_MASTER_VERSION,
  OPERATIONAL_RESET_STORES,
  inventoryKey,
  unwrapInventoryBundle,
  normalizeInventoryEquipment
} from '../inventory-master.js';
import { GAP_EQUIPMENT_CATALOG } from '../equipment-catalog-gap-seed.js';

test('inventory identity is stable across source file renames', () => {
  const base = { inventorySource:{ file:'Inventaire (1).xlsx', sheet:'cartes', row:2, unitIndex:7, reference:'SRA8802-R2' } };
  const renamed = { inventorySource:{ ...base.inventorySource, file:'Inventaire final 2026.xlsx' } };
  assert.equal(inventoryKey(base), inventoryKey(renamed));
  assert.equal(inventoryKey(base), '2m-inventory:cartes:2:7:sra8802-r2');
});

test('inventory normalizer enriches catalog fields without overwriting the observed model', () => {
  const catalogs = new Map([['kb-ross-mc1uhd', {
    id:'kb-ross-mc1uhd', manufacturer:'Ross Video', model:'MC1-UHD',
    type:'Master Control Switcher', category:'Diffusion / Playout', knowledgeProfile:'broadcast-processor'
  }]]);
  const record = normalizeInventoryEquipment({
    id:42, name:'MEL.1-P-F01', modele:'Ross MC1-UHD-R4', type:'Mélangeur',
    catalogId:'kb-ross-mc1uhd', roomId:1, baieId:2,
    inventorySource:{ sheet:'cartes', row:8, unitIndex:1, reference:'MC1-UHD-R4' },
    ports:[], components:[], images:[]
  }, catalogs);
  assert.equal(INVENTORY_MASTER_VERSION, 1);
  assert.equal(record.marque, 'Ross Video');
  assert.equal(record.categorie, 'Diffusion / Playout');
  assert.equal(record.modele, 'Ross MC1-UHD-R4');
  assert.equal(record.entityKind, 'module-card');
  assert.equal(record.assignmentStatus, 'unassigned-to-chassis');
  assert.equal(record.inventoryKey, '2m-inventory:cartes:8:1:mc1-uhd-r4');
});

test('remaining inventory can link by one exact alias without fuzzy guessing', () => {
  const gapCatalogs = new Map(GAP_EQUIPMENT_CATALOG.map(record => [record.id,record]));
  const exact = normalizeInventoryEquipment({
    id:88, name:'USB-COM-01', modele:'Boîtier USB COM (USB-8COMI-RM)',
    inventorySource:{ sheet:'STC', row:19, unitIndex:1, reference:'Boîtier USB COM (USB-8COMI-RM)' }
  },gapCatalogs);
  assert.equal(exact.catalogId,'kb-titan-usb8comirm');
  assert.equal(exact.marque,'TITAN Electronics');

  const closeButNotExact = normalizeInventoryEquipment({
    id:89, name:'USB-COM-X', modele:'USB 8 COM RM guessed',
    inventorySource:{ sheet:'STC', row:20, unitIndex:1, reference:'USB 8 COM RM guessed' }
  },gapCatalogs);
  assert.equal(closeButNotExact.catalogId,'');
});

test('gap catalog is compact and normalized aliases never belong to two different records', () => {
  assert.equal(GAP_EQUIPMENT_CATALOG.length,17);
  const owner = new Map();
  for (const record of GAP_EQUIPMENT_CATALOG) {
    for (const alias of record.inventoryAliases || []) {
      const key = alias.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if (owner.has(key)) assert.equal(owner.get(key),record.id,`alias partagé entre deux fiches: ${alias}`);
      else owner.set(key,record.id);
    }
  }
});

test('fibre/SFP remains explicitly modeled as an accessory family in the integration', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const inventorySource = fs.readFileSync(`${root}/inventory-master.js`,'utf8');
  const gap = GAP_EQUIPMENT_CATALOG.find(record => record.id === 'kb-gap-fibre-mm-sfp');
  assert.match(inventorySource,/fibre optique/);
  assert.ok(gap);
  assert.equal(gap.type,'Accessoire fibre / module optique');
  assert.equal(gap.verificationStatus,'to-confirm');
});

test('bundle wrapper accepts the backup/import envelope used by 2M TECH', () => {
  const data = { rooms:[], baies:[], equipments:[] };
  assert.equal(unwrapInventoryBundle({ schemaVersion:15, formatVersion:2, data }), data);
  assert.equal(unwrapInventoryBundle(data), data);
});

test('operational replacement preserves knowledge/users/settings by design', () => {
  for (const preserved of ['users','docs','faq','settings']) assert.equal(OPERATIONAL_RESET_STORES.includes(preserved), false);
  for (const replaced of ['rooms','baies','equipments','cables','attachments']) assert.equal(OPERATIONAL_RESET_STORES.includes(replaced), true);
});

test('inventory modules and catalog gap seed are available offline', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const index = fs.readFileSync(`${root}/index.html`, 'utf8');
  const worker = fs.readFileSync(`${root}/service-worker.js`, 'utf8');
  assert.match(index, /src="inventory-master\.js"/);
  assert.match(worker, /'\/inventory-master\.js'/);
  assert.match(worker, /'\/equipment-catalog-gap-seed\.js'/);
});

test('standalone import can derive the missing STC room from source evidence', () => {
  const here = fileURLToPath(new URL('../inventory-master.js', import.meta.url));
  const source = fs.readFileSync(here, 'utf8');
  assert.match(source, /STC:'STC'/);
  assert.match(source, /deriveMissingRooms/);
  assert.match(source, /salle dérivée de la feuille source/);
});

test('real inventory install only removes unreferenced manual trial catalog entries', () => {
  const here = fileURLToPath(new URL('../inventory-master.js', import.meta.url));
  const source = fs.readFileSync(here,'utf8');
  assert.match(source,/record\.origin === 'admin'/);
  assert.match(source,/!incomingCatalogIds\.has\(String\(record\.id\)\)/);
  assert.doesNotMatch(source,/tx\.objectStore\('docs'\)\.clear/);
});

test('destructive real-inventory replacement is restricted to admin and manager', () => {
  const here = fileURLToPath(new URL('../inventory-master.js', import.meta.url));
  const source = fs.readFileSync(here,'utf8');
  assert.match(source,/fullInstallAllowed = user => \['admin','manager'\]/);
  assert.match(source,/INVENTORY_REPLACE_FORBIDDEN/);
  assert.match(source,/canInstallRealInventory && !document\.getElementById\('import-master-inventory'\)/);
  assert.match(source,/canControlledImport = \['admin','manager','responsable'\]/);
});
