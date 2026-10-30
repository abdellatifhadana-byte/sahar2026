import { db } from './db.js';
import Equipements from './equipements.js';
import { getCurrentUser } from './security.js';
import { getCatalog } from './equipment-knowledge.js';
import { ensureGapCatalogSeed } from './equipment-catalog-gap-seed.js';
import { validateModuleHierarchy } from './module-hierarchy-contract.js';

export const INVENTORY_MASTER_VERSION = 1;
export const OPERATIONAL_RESET_STORES = Object.freeze([
  'rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','attachments','cables','cable_reports'
]);

const ROOM_NAMES_BY_SHEET = Object.freeze({ STC:'STC',RF1:'Régie Finale 1 (RF1)',RF2:'Régie Finale 2 (RF2)',ACQ:'Acquisition (ACQ)',CHCH:'Chef de Chaîne (CHCH)',PUB:'Publicité (PUB)' });
const text = (value,max = 500) => String(value ?? '').trim().slice(0,max);
const normalizedText = value => text(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const asArray = value => Array.isArray(value) ? value : [];
const normalizeId = value => { if (value === '' || value === null || value === undefined) return null; const number = Number(value); return Number.isNaN(number) ? value : number; };
const fullInstallAllowed = user => ['admin','manager'].includes(String(user?.role || '').toLowerCase());

export function unwrapInventoryBundle(raw) {
  const data = raw?.data || raw?.database || raw;
  if (!data || typeof data !== 'object') throw new Error('Format inventaire invalide.');
  return data;
}

export function inventoryKey(record = {}) {
  if (record.inventoryKey) return text(record.inventoryKey,320);
  const source = record.inventorySource || {};
  if (!source.sheet || source.row == null || source.unitIndex == null) return '';
  return ['2m-inventory',normalizedText(source.sheet),String(source.row),String(source.unitIndex),normalizedText(source.reference || record.modele || record.name || record.nom)].join(':');
}

function deriveEntityKind(record = {}) {
  const sourceSheet = text(record.inventorySource?.sheet,40).toLowerCase();
  if (sourceSheet === 'cartes') return 'module-card';
  const haystack = [record.type,record.categorie,record.modele,record.operationalRole].join(' ').toLowerCase();
  if (haystack.includes('châssis') || haystack.includes('chassis') || haystack.includes('opengear frame')) return 'modular-chassis';
  if (haystack.includes('patch') || haystack.includes('ppv')) return 'patch-panel';
  if (haystack.includes('jarretière') || haystack.includes('jarretiere') || haystack.includes('fibre optique')) return 'accessory';
  return 'equipment';
}

function deriveMissingRooms(rooms,equipments) {
  const output = rooms.map(room => ({ ...room,id:normalizeId(room.id) }));
  const knownIds = new Set(output.map(room => String(room.id))); const byMissingId = new Map();
  for (const equipment of equipments) {
    const roomId = normalizeId(equipment.roomId); if (roomId == null || knownIds.has(String(roomId))) continue;
    const sheet = text(equipment.inventorySource?.sheet,40).toUpperCase(); const name = ROOM_NAMES_BY_SHEET[sheet]; if (!name) continue;
    if (!byMissingId.has(String(roomId))) byMissingId.set(String(roomId),{ id:roomId,name,nom:name,imageUrl:'',source:'Inventaire XLSX 2M — salle dérivée de la feuille source',verificationStatus:'documented',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() });
  }
  return [...output,...byMissingId.values()];
}

function catalogMap(records) { return new Map(asArray(records).map(record => [String(record.id),record])); }
function catalogForInventory(record,catalogs) {
  if (record.catalogId) return catalogs.get(String(record.catalogId)) || null;
  const needles = new Set([record.inventorySource?.reference,record.modele].map(normalizedText).filter(Boolean));
  if (!needles.size) return null;
  const matches = [...catalogs.values()].filter(catalog => asArray(catalog.inventoryAliases).some(alias => needles.has(normalizedText(alias))));
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeInventoryEquipment(record = {},catalogs = new Map()) {
  const key = inventoryKey(record); const catalog = catalogForInventory(record,catalogs); const entityKind = deriveEntityKind(record); const status = record.status || record.statut || 'À vérifier';
  const normalized = {
    ...record,id:normalizeId(record.id),name:text(record.name || record.nom,240),nom:text(record.nom || record.name,240),roomId:normalizeId(record.roomId),baieId:normalizeId(record.baieId),
    catalogId:text(record.catalogId || catalog?.id,160),marque:text(record.marque || catalog?.manufacturer,160),categorie:text(record.categorie || catalog?.category,160),
    type:text(record.type || catalog?.type || 'Équipement',180),modele:text(record.modele || catalog?.model,240),knowledgeProfile:text(record.knowledgeProfile || catalog?.knowledgeProfile,120),
    status,statut:record.statut || status,inventoryKey:key,entityKind,
    assignmentStatus:entityKind === 'module-card' ? (record.assignmentStatus || 'unassigned-to-chassis') : (record.assignmentStatus || ''),
    equipmentProfile:record.equipmentProfile || (entityKind === 'modular-chassis' ? 'Châssis modulaire' : record.equipmentProfile || 'Standard'),
    ports:asArray(record.ports),components:asArray(record.components),images:asArray(record.images),technicalFacts:asArray(record.technicalFacts),inventoryMasterVersion:INVENTORY_MASTER_VERSION,updatedAt:record.updatedAt || new Date().toISOString()
  };
  if (!normalized.createdAt) normalized.createdAt = normalized.updatedAt;
  return normalized;
}

function uniqueCheck(records,keyFn,label,errors) {
  const seen = new Map(); for (const record of records) { const key = keyFn(record); if (!key) continue; if (seen.has(key)) errors.push(`${label} dupliqué: ${key}`); else seen.set(key,record); }
}

export async function prepareInventoryBundle(raw,{ existingEquipments = null } = {}) {
  const data = unwrapInventoryBundle(raw);
  await ensureGapCatalogSeed();
  const catalogs = catalogMap(await getCatalog());
  const originalEquipments = asArray(data.equipments); const rooms = deriveMissingRooms(asArray(data.rooms),originalEquipments);
  const baies = asArray(data.baies).map(record => ({ ...record,id:normalizeId(record.id),roomId:normalizeId(record.roomId) }));
  let equipments = originalEquipments.map(record => normalizeInventoryEquipment(record,catalogs)); const errors = []; const warnings = [];
  uniqueCheck(rooms,record => String(record.id ?? ''),'ID salle',errors); uniqueCheck(baies,record => String(record.id ?? ''),'ID baie',errors); uniqueCheck(equipments,record => String(record.id ?? ''),'ID équipement',errors); uniqueCheck(equipments,record => normalizedText(record.name),'Nom équipement',errors); uniqueCheck(equipments,record => record.inventoryKey,'Clé inventaire',errors);

  const roomIds = new Set(rooms.map(record => String(record.id))); const baieIds = new Set(baies.map(record => String(record.id))); const catalogIds = new Set(catalogs.keys());
  for (const baie of baies) if (baie.roomId != null && !roomIds.has(String(baie.roomId))) errors.push(`Baie ${baie.name || baie.id}: salle ${baie.roomId} introuvable.`);
  for (const equipment of equipments) {
    if (!equipment.name) errors.push(`Équipement ${equipment.id ?? '?'} sans nom.`);
    if (equipment.roomId != null && !roomIds.has(String(equipment.roomId))) errors.push(`${equipment.name}: salle ${equipment.roomId} introuvable.`);
    if (equipment.baieId != null && !baieIds.has(String(equipment.baieId))) errors.push(`${equipment.name}: baie ${equipment.baieId} introuvable.`);
    if (equipment.catalogId && !catalogIds.has(String(equipment.catalogId))) errors.push(`${equipment.name}: catalogId ${equipment.catalogId} introuvable.`);
    if (!equipment.inventoryKey) warnings.push(`${equipment.name}: clé inventaire absente; l'idempotence s'appuiera uniquement sur l'ID.`);
  }

  const existing = existingEquipments || await db.getAll('equipments');
  const existingByKey = new Map(existing.map(record => [inventoryKey(record),record]).filter(([key]) => key)); const existingById = new Map(existing.map(record => [String(record.id),record])); const existingByName = new Map(existing.map(record => [normalizedText(record.name || record.nom),record]).filter(([key]) => key));
  equipments = equipments.map(record => {
    const sameSource = record.inventoryKey ? existingByKey.get(record.inventoryKey) : null; if (sameSource) return { ...record,id:sameSource.id,createdAt:sameSource.createdAt || record.createdAt };
    const idCollision = record.id != null ? existingById.get(String(record.id)) : null; if (idCollision && inventoryKey(idCollision) !== record.inventoryKey) errors.push(`${record.name}: l'ID ${record.id} appartient déjà à une autre source.`);
    const nameCollision = existingByName.get(normalizedText(record.name)); if (nameCollision && String(nameCollision.id) !== String(record.id) && inventoryKey(nameCollision) !== record.inventoryKey) errors.push(`${record.name}: un équipement existant porte déjà ce nom avec une autre identité.`); return record;
  });
  for (const issue of validateModuleHierarchy(equipments)) errors.push(issue.message);

  return { formatVersion:Number(raw?.formatVersion || 0),schemaVersion:Number(raw?.schemaVersion || 0),rooms,baies,equipments,
    optional:Object.fromEntries(['walls','screens','screen_groups','screen_issues','diagnosis_history','tickets','notes','attachments','cables','cable_reports'].filter(name => Array.isArray(data[name])).map(name => [name,data[name]])),
    errors:[...new Set(errors)],warnings:[...new Set(warnings)],counts:{ rooms:rooms.length,baies:baies.length,equipments:equipments.length,cards:equipments.filter(record => record.entityKind === 'module-card').length,chassis:equipments.filter(record => record.entityKind === 'modular-chassis').length,catalogLinked:equipments.filter(record => record.catalogId).length,quantityToConfirm:equipments.filter(record => record.quantityToConfirm === true).length,planEvidence:equipments.filter(record => record.planEvidence).length }
  };
}

function transactionDone(tx) { return new Promise((resolve,reject) => { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error || new Error('Transaction inventaire échouée.')); tx.onabort = () => reject(tx.error || new Error('Transaction inventaire annulée.')); }); }

/**
 * Message quand la plateforme travaille sans serveur central.
 *
 * `resource_zones` — la seule vérité de la zone d'une salle — vit sur le serveur. Une
 * installation d'inventaire écrite uniquement dans IndexedDB dépose donc des salles
 * rattachées à RIEN : elles s'affichent à l'administrateur qui vient de les installer,
 * et à personne d'autre. Le succès local était un mensonge, découvert bien plus tard.
 */
export const INVENTAIRE_SANS_AUTORITE =
  'L’installation de l’inventaire exige la connexion centrale : sans elle, la zone d’autorisation des salles ne peut pas être enregistrée.';

/** L'autorité centrale est-elle disponible pour recevoir les salles et leurs zones ? */
export function centralAuthorityAvailable() {
  if (typeof db.isCentralSyncReady === 'function') return db.isCentralSyncReady() === true;
  return false;
}

export async function importInventoryBundle(raw,{ replaceOperational = false } = {}) {
  if (replaceOperational && typeof window !== 'undefined' && !fullInstallAllowed(getCurrentUser())) {
    throw Object.assign(new Error('Seul un administrateur ou manager peut remplacer l’inventaire opérationnel.'),{ code:'INVENTORY_REPLACE_FORBIDDEN' });
  }
  // Sans autorité centrale, on REFUSE au lieu de réussir localement : les salles
  // écrites ici n'auraient aucun rattachement, donc aucun périmètre, donc aucun
  // propriétaire. Mieux vaut un refus net qu'un inventaire que personne ne voit.
  if (typeof window !== 'undefined' && !centralAuthorityAvailable()) {
    throw Object.assign(new Error(INVENTAIRE_SANS_AUTORITE),{ code:'CENTRAL_AUTHORITY_REQUIRED' });
  }
  await db.open(); const prepared = await prepareInventoryBundle(raw,{ existingEquipments:replaceOperational ? [] : await db.getAll('equipments') });
  if (prepared.errors.length) throw Object.assign(new Error(`Import refusé: ${prepared.errors.length} erreur(s) de cohérence.`),{ code:'INVENTORY_VALIDATION_FAILED',details:prepared.errors });
  const incomingCatalogIds = new Set(prepared.equipments.filter(record => record.catalogId).map(record => String(record.catalogId)));
  const trialCatalogEntries = replaceOperational ? (await db.getAll('docs')).filter(record => record.origin === 'admin' && (record.kind === 'equipment_catalog' || record.targetType === 'equipment_catalog') && !incomingCatalogIds.has(String(record.id))) : [];
  const importData = { rooms:prepared.rooms,baies:prepared.baies,equipments:prepared.equipments,...prepared.optional }; const importStores = Object.keys(importData).filter(name => db.db.objectStoreNames.contains(name)); const resetStores = replaceOperational ? OPERATIONAL_RESET_STORES.filter(name => db.db.objectStoreNames.contains(name)) : [];
  const stores = [...new Set([...importStores,...resetStores,'settings',...(trialCatalogEntries.length ? ['docs'] : [])])].filter(name => db.db.objectStoreNames.contains(name)); const tx = db.db.transaction(stores,'readwrite');
  if (replaceOperational) for (const storeName of resetStores) tx.objectStore(storeName).clear();
  for (const [storeName,records] of Object.entries(importData)) { if (!stores.includes(storeName)) continue; const store = tx.objectStore(storeName); for (const record of records) store.put({ ...record }); }
  if (trialCatalogEntries.length && stores.includes('docs')) for (const record of trialCatalogEntries) tx.objectStore('docs').delete(record.id);
  if (stores.includes('settings')) tx.objectStore('settings').put({ id:'current-room',currentRoomId:null,updatedAt:new Date().toISOString() }); await transactionDone(tx);
  const result = { ...prepared.counts,warnings:prepared.warnings,replaceOperational,removedTrialCatalogEntries:trialCatalogEntries.length }; window.dispatchEvent?.(new CustomEvent('inventory-master-imported',{ detail:result })); return result;
}

export async function importEquipmentArraySafely(records) {
  if (!Array.isArray(records)) throw new Error('Le fichier doit contenir une liste d’équipements.'); await db.open(); await ensureGapCatalogSeed();
  const [rooms,baies,existing,catalog] = await Promise.all([db.getAll('rooms'),db.getAll('baies'),db.getAll('equipments'),getCatalog()]); const roomIds = new Set(rooms.map(record => String(record.id))); const baieIds = new Set(baies.map(record => String(record.id))); const catalogs = catalogMap(catalog); const normalized = records.map(record => normalizeInventoryEquipment(record,catalogs)); const errors = [];
  uniqueCheck(normalized,record => String(record.id ?? ''),'ID équipement',errors); uniqueCheck(normalized,record => normalizedText(record.name),'Nom équipement',errors); const existingByName = new Map(existing.map(record => [normalizedText(record.name || record.nom),record]));
  for (const record of normalized) { if (record.roomId != null && !roomIds.has(String(record.roomId))) errors.push(`${record.name}: salle introuvable.`); if (record.baieId != null && !baieIds.has(String(record.baieId))) errors.push(`${record.name}: baie introuvable.`); const conflict = existingByName.get(normalizedText(record.name)); if (conflict && String(conflict.id) !== String(record.id)) errors.push(`${record.name}: nom déjà utilisé par l'équipement ${conflict.id}.`); }
  const combined = new Map(existing.map(record => [String(record.id),record])); for (const record of normalized) combined.set(String(record.id),record); for (const issue of validateModuleHierarchy([...combined.values()])) errors.push(issue.message);
  if (errors.length) throw Object.assign(new Error(`Import équipements refusé: ${errors.length} conflit(s).`),{ code:'EQUIPMENT_IMPORT_CONFLICT',details:[...new Set(errors)] }); const tx = db.db.transaction('equipments','readwrite'); for (const record of normalized) tx.objectStore('equipments').put(record); await transactionDone(tx); return { equipments:normalized.length };
}

function notify(instance,message,type = 'info') { instance?.notifications?.showNotification?.(message,type); }
function patchSafeImports() {
  if (Equipements.prototype.__inventoryMasterImportPatched) return; Equipements.prototype.__inventoryMasterImportPatched = true; const previousAfterRender = Equipements.prototype.afterRender;
  Equipements.prototype.afterRender = async function afterRenderWithSafeInventoryImport() {
    await previousAfterRender.call(this);
    const user = getCurrentUser();
    const canControlledImport = ['admin','manager','responsable'].includes(String(user?.role || '').toLowerCase());
    const canInstallRealInventory = fullInstallAllowed(user);
    if (!canControlledImport && !canInstallRealInventory) return;
    const legacyButton = document.getElementById('import-eq'); const legacyInput = document.getElementById('import-file');
    if (canControlledImport && legacyButton) legacyButton.innerHTML = '<i class="fas fa-file-import"></i> Importer équipements (contrôlé)';
    if (canControlledImport && legacyInput) legacyInput.onchange = async event => { const file = event.target.files?.[0]; if (!file) return; try { const result = await importEquipmentArraySafely(JSON.parse(await file.text())); notify(this,`${result.equipments} équipement(s) importé(s) sans conflit.`,'success'); this.refreshList(); } catch (error) { console.error(error); notify(this,`${error.message}${error.details?.[0] ? ` — ${error.details[0]}` : ''}`,'error'); } finally { event.target.value = ''; } };
    if (canInstallRealInventory && !document.getElementById('import-master-inventory')) {
      const button = document.createElement('button'); button.id = 'import-master-inventory'; button.className = 'btn'; button.innerHTML = '<i class="fas fa-database"></i> Installer inventaire réel 2M'; const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true; input.id = 'import-master-inventory-file'; legacyButton?.parentElement?.append(button,input); button.onclick = () => input.click();
      input.onchange = async event => { const file = event.target.files?.[0]; if (!file) return; try { const accepted = window.AppDialog?.confirm ? await window.AppDialog.confirm('Installer l’inventaire réel 2M en remplaçant uniquement les données opérationnelles d’essai ? Les utilisateurs, la base de connaissances vérifiée et les paramètres globaux sont conservés; les références catalogue manuelles d’essai non utilisées seront retirées.') : confirm('Remplacer les données opérationnelles d’essai par l’inventaire réel 2M ?'); if (!accepted) return; const result = await importInventoryBundle(JSON.parse(await file.text()),{ replaceOperational:true }); notify(this,`${result.equipments} équipements, ${result.rooms} salles et ${result.baies} baies installés. ${result.catalogLinked}/${result.equipments} sont liés au catalogue. ${result.cards} cartes restent non affectées à un châssis tant que le slot réel n’est pas confirmé. ${result.removedTrialCatalogEntries} référence(s) manuelle(s) d’essai inutilisée(s) retirée(s).`,'success'); this.refreshList(); } catch (error) { console.error(error); notify(this,`${error.message}${error.details?.[0] ? ` — ${error.details[0]}` : ''}`,'error'); } finally { event.target.value = ''; } };
    }
  };
}

function patchMetadataPreservation() {
  if (Equipements.prototype.__inventoryMetadataPreservationPatched) return; Equipements.prototype.__inventoryMetadataPreservationPatched = true; const previousShow = Equipements.prototype.showEquipementModal;
  Equipements.prototype.showEquipementModal = async function showEquipmentPreservingImportedMetadata(equipment = null) { await previousShow.call(this,equipment); if (!equipment?.id) return; const form = document.getElementById('eq-form'); if (!form || form.dataset.inventoryMetadataReady === '1') return; form.dataset.inventoryMetadataReady = '1'; const previousSubmit = form.onsubmit; form.onsubmit = async event => { const originalSave = db.save; let intercepted = false; db.save = async function savePreservingImportedMetadata(store,record) { if (store === 'equipments' && !intercepted) { intercepted = true; return originalSave.call(db,store,{ ...equipment,...record,id:equipment.id,updatedAt:new Date().toISOString() }); } return originalSave.call(db,store,record); }; try { if (typeof previousSubmit === 'function') return await previousSubmit.call(form,event); } finally { db.save = originalSave; } }; };
}

patchSafeImports(); patchMetadataPreservation();
if (typeof window !== 'undefined') window.InventoryMaster = Object.freeze({ version:INVENTORY_MASTER_VERSION,prepare:prepareInventoryBundle,importBundle:importInventoryBundle,importEquipments:importEquipmentArraySafely,inventoryKey });
