import { db } from './db.js';
import Equipements from './equipements.js';
import { getCurrentUser } from './security.js';
import { OPERATIONAL_RESET_STORES } from './inventory-master.js';

const INSTALL_ORDER = Object.freeze(['rooms','baies','equipments','walls','screens','screen_groups','cables']);
const OPERATIONAL_SET = new Set(OPERATIONAL_RESET_STORES);

const isAdminInstaller = user => ['admin','manager'].includes(String(user?.role || '').toLowerCase());
const notify = (instance, message, type = 'info') => instance?.notifications?.showNotification?.(message, type);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `Erreur serveur (${response.status})`);
    error.status = response.status;
    error.code = payload?.error;
    error.details = payload?.details || [];
    throw error;
  }
  return payload;
}

function centralOperationalCount(snapshot = {}) {
  return OPERATIONAL_RESET_STORES.reduce((total, storeName) => total + (snapshot.data?.[storeName]?.length || 0), 0);
}

function buildInstallData(prepared) {
  const data = { rooms: prepared.rooms, baies: prepared.baies, equipments: prepared.equipments, ...(prepared.optional || {}) };
  return Object.fromEntries(INSTALL_ORDER.map(storeName => [storeName, Array.isArray(data[storeName]) ? data[storeName] : []]));
}

async function clearOperationalSyncQueue() {
  if (!db.db?.objectStoreNames?.contains('syncQueue')) return 0;
  const queue = await db.getAll('syncQueue');
  let removed = 0;
  for (const entry of queue) {
    if (!OPERATIONAL_SET.has(entry.storeName)) continue;
    await db._deleteRaw('syncQueue', entry.id);
    removed += 1;
  }
  return removed;
}

async function verifyLocalMirror(expected) {
  const [rooms, baies, equipments] = await Promise.all([
    db.getAll('rooms'), db.getAll('baies'), db.getAll('equipments')
  ]);
  const actual = { rooms:rooms.length, baies:baies.length, equipments:equipments.length };
  const mismatch = Object.entries(expected).filter(([key, value]) => ['rooms','baies','equipments'].includes(key) && actual[key] !== Number(value || 0));
  if (mismatch.length) {
    throw Object.assign(new Error(`Synchronisation locale incomplète après l’installation centrale (${actual.equipments}/${expected.equipments} équipements). Rechargez la page; aucune nouvelle donnée ne sera réimportée.`), {
      code:'CENTRAL_INVENTORY_LOCAL_MIRROR_MISMATCH',
      details:mismatch.map(([key, value]) => `${key}: attendu ${value}, obtenu ${actual[key]}`)
    });
  }
  return actual;
}

async function installToCentral(prepared) {
  const data = buildInstallData(prepared);
  const response = await api('/api/sync/inventory-replace', { method:'POST', body: JSON.stringify({ data }) });
  const serverCounts = response?.counts || {};
  for (const key of ['rooms','baies','equipments']) {
    if (Number(serverCounts[key] || 0) !== Number(prepared.counts[key] || 0)) {
      throw Object.assign(new Error(`Contrôle post-transaction échoué pour ${key}: serveur=${serverCounts[key] || 0}, attendu=${prepared.counts[key] || 0}.`), { code:'CENTRAL_INVENTORY_SERVER_POSTCHECK_FAILED' });
    }
  }

  /*
   * L'INVARIANT SALLE → ZONE EST VÉRIFIÉ SUR LE SERVEUR, pas supposé.
   *
   * Compter les salles ne suffit pas : une salle enregistrée sans rattachement existe bien
   * en base, et n'appartient pourtant à personne. Elle disparaît de tout écran à périmètre,
   * et l'écran des accès ne la propose même pas au rattachement — l'installation se serait
   * déclarée réussie sur un inventaire que seul l'administrateur peut voir.
   */
  const transfert = await api('/api/rooms/transfer');
  const rattachees = new Set((transfert?.roomZones || []).map(paire => String(paire.roomId)));
  const orphelines = (prepared.rooms || []).map(room => String(room.id)).filter(id => !rattachees.has(id));
  if (orphelines.length) {
    throw Object.assign(
      new Error(`Installation refusée : ${orphelines.length} salle(s) sans zone d’autorisation sur le serveur (${orphelines.slice(0, 3).join(', ')}). Elles ne seraient visibles par personne.`),
      { code:'CENTRAL_INVENTORY_ROOM_ZONE_MISSING', details:orphelines }
    );
  }

  const removedQueuedOperations = await clearOperationalSyncQueue();
  if (typeof db.enableCentralSync === 'function') await db.enableCentralSync({ bootstrapLocal:false });
  await verifyLocalMirror(prepared.counts);

  return {
    ...prepared.counts,
    centralSync:true,
    warnings:prepared.warnings || [],
    removedTrialCatalogEntries:0,
    replacedExisting:Number(response?.replacedExisting || 0),
    beforeByStore:response?.beforeByStore || {},
    removedQueuedOperations
  };
}

async function installInventory(raw, instance) {
  const user = getCurrentUser();
  if (!isAdminInstaller(user)) throw Object.assign(new Error('Seul un administrateur ou manager peut installer l’inventaire réel 2M.'), { code:'INVENTORY_REPLACE_FORBIDDEN' });
  const prepared = await window.InventoryMaster.prepare(raw, { existingEquipments: [] });
  if (prepared.errors?.length) throw Object.assign(new Error(`Import refusé: ${prepared.errors.length} erreur(s) de cohérence.`), { code:'INVENTORY_VALIDATION_FAILED', details: prepared.errors });

  const health = await api('/api/health');
  const centralMode = health?.centralSync === true;
  let existingOperational = 0;
  if (centralMode) existingOperational = centralOperationalCount(await api('/api/sync'));

  const replacementLine = centralMode
    ? `\n${existingOperational} donnée(s) opérationnelle(s) d’essai actuellement présentes dans PostgreSQL seront remplacée(s) dans une transaction unique.`
    : '\nLe serveur est en mode local IndexedDB: seules les données opérationnelles locales d’essai seront remplacées.';
  const summary = `Installer l’inventaire réel 2M ?\n\n${prepared.counts.equipments} équipements, ${prepared.counts.rooms} salles, ${prepared.counts.baies} baies.\n${prepared.counts.catalogLinked}/${prepared.counts.equipments} liés au catalogue.${replacementLine}\n\nLes utilisateurs, la base de connaissances vérifiée, les paramètres globaux, les logs et les notifications sont conservés.`;
  const accepted = window.AppDialog?.confirm ? await window.AppDialog.confirm(summary) : confirm(summary);
  if (!accepted) return null;

  const result = centralMode
    ? await installToCentral(prepared)
    : await window.InventoryMaster.importBundle(raw, { replaceOperational:true });

  const replacedText = result.centralSync ? ` ${result.replacedExisting} donnée(s) opérationnelle(s) d’essai remplacée(s) côté PostgreSQL.` : '';
  notify(instance, `${result.equipments} équipements, ${result.rooms} salles et ${result.baies} baies installés. ${result.catalogLinked}/${result.equipments} liés au catalogue.${replacedText}`, 'success');
  window.dispatchEvent?.(new CustomEvent('inventory-master-imported', { detail: result }));
  return result;
}

function patchInstaller() {
  if (Equipements.prototype.__centralInventoryInstallerPatched) return;
  Equipements.prototype.__centralInventoryInstallerPatched = true;
  const previousAfterRender = Equipements.prototype.afterRender;
  Equipements.prototype.afterRender = async function afterRenderWithCentralInstaller() {
    await previousAfterRender.call(this);
    const input = document.getElementById('import-master-inventory-file');
    if (!input || input.dataset.centralInstallerReady === '1') return;
    input.dataset.centralInstallerReady = '1';
    input.onchange = async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        const result = await installInventory(raw, this);
        if (result) this.refreshList();
      } catch (error) {
        console.error(error);
        notify(this, `${error.message}${error.details?.[0] ? ` — ${error.details[0]}` : ''}`, 'error');
      } finally {
        event.target.value = '';
      }
    };
  };
}

patchInstaller();
if (typeof window !== 'undefined') window.InventoryCentralInstall = Object.freeze({ install: installInventory, installToCentral });
