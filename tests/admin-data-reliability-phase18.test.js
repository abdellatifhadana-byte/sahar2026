import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rooms = read('salles.js');
const baies = read('baies.js');
const selectors = read('entity-select-search.js');
const recovery = read('data-visibility-recovery.js');
const mapEditor = read('map-admin-entity-edit.js');
const index = read('index.html');
const worker = read('service-worker.js');

test('Phase 18 UX: une salle existante est réellement modifiable', () => {
  assert.match(rooms,/data-action="edit"/);
  assert.match(rooms,/showEditModal\(idSalle\)/);
  assert.match(rooms,/Salle modifiée avec succès/);
  assert.match(rooms,/\.\.\.salle/);
});

test('Phase 18 UX: une baie existante est modifiable et un changement de salle réaligne ses équipements', () => {
  assert.match(baies,/data-action="edit"/);
  assert.match(baies,/showEditModal\(id\)/);
  assert.match(baies,/linked = equipments\.filter/);
  assert.match(baies,/roomChanged/);
  assert.match(baies,/equipment, roomId: nextRoomId/);
});

test('Phase 18 carte Admin: salle et baie sont modifiables directement depuis la carte sans confondre fiche et géométrie', () => {
  assert.match(mapEditor,/openMapEntityEditor/);
  assert.match(mapEditor,/edit-details/);
  assert.match(mapEditor,/Modifier les informations/);
  assert.match(mapEditor,/Les coordonnées et la zone dessinée sont conservées/);
  assert.match(mapEditor,/platform-map-entity-updated/);
  assert.match(mapEditor,/reopenMapWithFreshData/);
  assert.match(mapEditor,/equipment, roomId: nextRoomId/);
});

test('Phase 18 UX: les grands sélecteurs salle, baie et équipement deviennent recherchables sans réécrire chaque formulaire', () => {
  assert.match(selectors,/inferSearchKind/);
  assert.match(selectors,/eq-roomId/);
  assert.match(selectors,/eq-baieId/);
  assert.match(selectors,/relatedId/);
  assert.match(selectors,/refreshRelatedEntitySelect/);
  assert.match(selectors,/MutationObserver/);
  assert.match(selectors,/normalize\('NFD'\)/);
});

test('Phase 18 fiabilité: une récupération de synchronisation centrale rafraîchit la vue sans F5 et protège les formulaires ouverts', () => {
  assert.match(recovery,/central-sync-status/);
  assert.match(recovery,/central-sync-recovered/);
  assert.match(recovery,/stale-view-after-sync/);
  assert.match(recovery,/sync-before-ui-ready/);
  assert.match(recovery,/uiRetryCount/);
  assert.match(recovery,/ui\.loadSection/);
  assert.match(recovery,/ui\.loadData/);
  assert.match(recovery,/hasBlockingEditor/);
  assert.match(recovery,/platform-data-visible/);
});

test('Phase 18 fiabilité: le shell charge les helpers avant core et le PWA les conserve hors ligne', () => {
  const sync = index.indexOf('src="central-sync.js"');
  const search = index.indexOf('src="entity-select-search.js"');
  const recoveryRuntime = index.indexOf('src="data-visibility-recovery.js"');
  const twin = index.indexOf('src="map-digital-twin.js"');
  const mapEntityEditor = index.indexOf('src="map-admin-entity-edit.js"');
  const core = index.indexOf('src="core.js"');
  assert.ok(sync >= 0 && search > sync && recoveryRuntime > search && twin > recoveryRuntime && mapEntityEditor > twin && core > mapEntityEditor);
  assert.match(worker,/\/entity-select-search\.js/);
  assert.match(worker,/\/data-visibility-recovery\.js/);
  assert.match(worker,/\/map-admin-entity-edit\.js/);
  const cacheVersion = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cacheVersion && Number(cacheVersion[1]) >= 31, 'les correctifs Admin de Phase 18 exigent le cache PWA v5.31 ou supérieur');
});
