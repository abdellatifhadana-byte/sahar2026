import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mergeEquipmentRecord,
  normalizeRelationId,
  applyBaieLocation,
  equipmentWriteDiff,
  EQUIPMENT_WRITE_CONTRACT_VERSION
} from '../equipment-write-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const guard = read('equipment-write-guard.js');
const editor = read('equipment-editor-service.js');
const mapBridge = read('map-equipment-editor-bridge.js');
const index = read('index.html');
const serviceWorker = read('service-worker.js');

test('une édition partielle conserve les métadonnées riches non éditées', () => {
  assert.equal(EQUIPMENT_WRITE_CONTRACT_VERSION, 1);
  const existing = {
    id:'eq-1', name:'Ancien nom', roomId:'room-stc', baieId:null,
    catalogId:'kb-ross-ultrix', inventoryKey:'INV-001',
    inventorySource:{ sheet:'STC' },
    ports:[{ id:'p1' }], components:[{ id:'c1' }], images:['data:image/png;base64,AA==']
  };
  const merged = mergeEquipmentRecord(existing, { id:'eq-1', name:'Nouveau nom', type:'Routeur' });
  assert.equal(merged.name, 'Nouveau nom');
  assert.equal(merged.catalogId, 'kb-ross-ultrix');
  assert.deepEqual(merged.inventorySource, { sheet:'STC' });
  assert.deepEqual(merged.ports, [{ id:'p1' }]);
  assert.deepEqual(merged.components, [{ id:'c1' }]);
  assert.deepEqual(merged.images, ['data:image/png;base64,AA==']);
});

test('les identifiants relationnels acceptent les IDs numériques et les IDs carte textuels', () => {
  assert.equal(normalizeRelationId('42'), 42);
  assert.equal(normalizeRelationId('room-172345'), 'room-172345');
  assert.equal(normalizeRelationId('baie-rf1-b01'), 'baie-rf1-b01');
  assert.equal(normalizeRelationId(''), null);
  assert.equal(normalizeRelationId(0), null);
});

test('une baie documentée impose la salle canonique de la baie', () => {
  const result = applyBaieLocation({ id:'eq', roomId:'ancienne-salle', baieId:'b01' }, { id:'b01', roomId:'rf1' });
  assert.equal(result.roomId, 'rf1');
  assert.equal(result.baieId, 'b01');
});

test('le diff d’écriture identifie précisément les champs modifiés', () => {
  assert.deepEqual(equipmentWriteDiff({ name:'A', catalogId:'kb-a' }, { name:'B', catalogId:'kb-a', roomId:2 }), ['name','roomId']);
});

test('le garde d’écriture fusionne avant la sauvegarde centrale et recale la salle depuis la baie', () => {
  assert.match(guard, /mergeEquipmentRecord\(existing, record\)/);
  assert.match(guard, /db\.get\('baies'/);
  assert.match(guard, /applyBaieLocation\(payload, baie\)/);
  assert.match(guard, /originalSave\(storeName, payload/);
  assert.match(guard, /equipment-record-normalized/);
});

test('l’éditeur canonique ne convertit plus les IDs textuels avec Number et préserve les photos existantes', () => {
  assert.match(editor, /normalizeRelationId\(values\.roomId\)/);
  assert.match(editor, /normalizeRelationId\(values\.baieId\)/);
  assert.doesNotMatch(editor, /Number\(data\.roomId\)/);
  assert.doesNotMatch(editor, /Number\(data\.baieId\)/);
  assert.match(editor, /Array\.isArray\(existing\?\.images\)/);
  assert.match(editor, /form\.baieId\?\.removeAttribute\('required'\)/);
  assert.match(editor, /PermissionManager\.check\(user, 'equipments', action\)/);
});

test('le pont carte bloque l’ancien handler avant toute résolution asynchrone', () => {
  const listenerStart = mapBridge.indexOf("document.addEventListener('click'");
  assert.ok(listenerStart >= 0, 'listener capture de la carte introuvable');
  const listenerBlock = mapBridge.slice(listenerStart);
  const stopIndex = listenerBlock.indexOf('event.stopImmediatePropagation()');
  const asyncIndex = listenerBlock.indexOf('handleMapEditorIntent(intent)');
  assert.ok(stopIndex >= 0 && asyncIndex > stopIndex, 'le handler historique doit être bloqué avant la résolution DB');
  // L'AJOUT N'EST PLUS INTERCEPTÉ, délibérément. Le pont détournait ce bouton vers
  // l'éditeur canonique en mode création et fermait la carte au passage : un administrateur
  // voulant poser sur le plan un appareil DÉJÀ inventorié — le cas courant, la plateforme en
  // comptant des centaines — n'avait d'autre issue que d'en saisir un doublon. La carte
  // porte désormais le choix (rattacher un existant, ou créer en déléguant au MÊME éditeur).
  assert.doesNotMatch(mapBridge, /if \(target\.closest\('#map-panel #add-equipment-btn'\)\)/);
  assert.match(read('interactive-map.js'), /Depuis la plateforme/);
  assert.match(read('interactive-map.js'), /openCanonicalEquipmentEditor\(\{ \.\.\.contexte, notifications \}\)/);
  // Les deux intentions de MODIFICATION restent interceptées : elles doivent passer par
  // l'éditeur canonique, seul endroit qui applique les contrôles d'écriture.
  assert.match(mapBridge, /\.context-menu-item\[data-action="edit"\]/);
  assert.match(mapBridge, /#map-panel #edit-equipment-btn/);
  assert.match(mapBridge, /Contexte de la carte ambigu/);
});

test('le garde d’écriture est chargé après central-sync et les modules sont dans le cache PWA', () => {
  const syncIndex = index.indexOf('src="central-sync.js"');
  const guardIndex = index.indexOf('src="equipment-write-guard.js"');
  const mediaIndex = index.indexOf('src="equipment-media.js"');
  const editorIndex = index.indexOf('src="equipment-editor-service.js"');
  assert.ok(syncIndex >= 0 && guardIndex > syncIndex, 'le garde doit envelopper la sauvegarde centrale déjà installée');
  assert.ok(mediaIndex >= 0 && editorIndex > mediaIndex, 'le service doit voir les protections média déjà installées');
  for (const file of ['equipment-write-contract.js','equipment-write-guard.js','equipment-editor-service.js','map-equipment-editor-bridge.js']) {
    assert.match(index, new RegExp(`src="${file.replace('.', '\\.')}`));
    assert.match(serviceWorker, new RegExp(`/${file.replace('.', '\\.')}`));
  }
});