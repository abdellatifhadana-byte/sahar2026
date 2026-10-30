import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db.js';
import { declareCatalogBuffered, resetCatalogBuffer } from '../record-ownership-contract.js';

function makeLocalStorage() {
  const values = new Map([['auth', JSON.stringify({ id:'admin-test' })]]);
  return {
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear()
  };
}

function makeFakeIndexedDb(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, records]) => [
    name,
    new Map((records || []).map(record => [String(record.id), structuredClone(record)]))
  ]));
  const counts = { put:0, delete:0, clear:0 };
  let generatedId = 1000;

  const ensureStore = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };

  const transaction = storeName => {
    const data = ensureStore(storeName);
    let pending = 0;
    let completionQueued = false;
    const tx = { oncomplete:null, onerror:null, onabort:null, error:null };

    const maybeComplete = () => {
      if (pending !== 0 || completionQueued) return;
      completionQueued = true;
      queueMicrotask(() => {
        completionQueued = false;
        if (pending === 0) tx.oncomplete?.();
      });
    };

    const request = (compute, mutate = false) => {
      pending += 1;
      const req = { result:undefined, error:null, onsuccess:null, onerror:null };
      queueMicrotask(() => {
        try {
          req.result = compute();
          req.onsuccess?.({ target:req });
        } catch (error) {
          req.error = error;
          tx.error = error;
          req.onerror?.({ target:req });
          tx.onerror?.();
        } finally {
          pending -= 1;
          maybeComplete();
        }
      });
      if (mutate) completionQueued = false;
      return req;
    };

    tx.objectStore = () => ({
      // `Array.prototype.map` passe (élément, index, tableau) : `structuredClone` recevait
      // donc l'index comme dictionnaire d'options et levait « Options cannot be converted
      // to a dictionary » dès que le magasin n'était pas vide.
      getAll: () => request(() => [...data.values()].map(valeur => structuredClone(valeur))),
      get: id => request(() => {
        const value = data.get(String(id));
        return value === undefined ? undefined : structuredClone(value);
      }),
      put: payload => request(() => {
        const record = structuredClone(payload);
        if (record.id === undefined || record.id === null || record.id === '') record.id = ++generatedId;
        data.set(String(record.id), record);
        counts.put += 1;
        return record.id;
      }, true),
      delete: id => request(() => {
        data.delete(String(id));
        counts.delete += 1;
        return undefined;
      }, true),
      clear: () => request(() => {
        data.clear();
        counts.clear += 1;
        return undefined;
      }, true)
    });

    return tx;
  };

  return {
    db: {
      objectStoreNames: { contains: name => stores.has(name) },
      transaction
    },
    stores,
    counts,
    resetCounts() { counts.put = 0; counts.delete = 0; counts.clear = 0; },
    read(name, id) { return stores.get(name)?.get(String(id)); }
  };
}

test('central-sync applique un snapshot identique sans mutation et garde update/delete/survivor', async () => {
  resetCatalogBuffer();
  declareCatalogBuffered('local-buffer');
  globalThis.localStorage = makeLocalStorage();

  const fake = makeFakeIndexedDb({
    docs: [
      { id:'kb-1', title:'A', nested:{ a:1, b:2 }, _revision:3 },
      { id:'local-buffer', kind:'catalog_seed', title:'local' }
    ],
    syncQueue: []
  });

  db.db = fake.db;
  db.open = async () => db.db;
  db._getRaw = async (storeName, id) => {
    const value = fake.read(storeName, id);
    return value === undefined ? undefined : structuredClone(value);
  };
  db.getAll = async storeName => [...(fake.stores.get(storeName)?.values() || [])].map(valeur => structuredClone(valeur));
  db.save = async (storeName, data) => {
    const store = fake.stores.get(storeName) || new Map();
    fake.stores.set(storeName, store);
    const record = structuredClone(data);
    const id = record.id ?? `generated-${store.size + 1}`;
    record.id = id;
    store.set(String(id), record);
    return id;
  };
  db._deleteRaw = async (storeName, id) => {
    fake.stores.get(storeName)?.delete(String(id));
    return true;
  };

  let snapshot = {
    initialized:true,
    authoritativeStores:['docs'],
    data:{ docs:[{ _revision:3, nested:{ b:2, a:1 }, title:'A', id:'kb-1' }] },
    deleted:[],
    access:{},
    serverTime:'2026-09-05T00:00:00.000Z'
  };
  globalThis.fetch = async () => new Response(JSON.stringify(snapshot), {
    status:200,
    headers:{ 'content-type':'application/json' }
  });

  await import(new URL(`../central-sync.js?noop-integration=${Date.now()}`, import.meta.url).href);

  fake.resetCounts();
  await db.enableCentralSync({ bootstrapLocal:false });
  assert.deepEqual(fake.counts, { put:0, delete:0, clear:0 },
    'un premier snapshot déjà identique ne doit pas réécrire IndexedDB');
  assert.ok(fake.read('docs', 'local-buffer'), 'le document buffered local doit survivre au snapshot autoritaire');

  fake.resetCounts();
  await db.enableCentralSync({ bootstrapLocal:false });
  assert.deepEqual(fake.counts, { put:0, delete:0, clear:0 },
    'un second snapshot identique doit rester un no-op complet');

  snapshot = {
    ...snapshot,
    data:{ docs:[{ id:'kb-1', title:'B', nested:{ a:1, b:2 }, _revision:4 }] },
    serverTime:'2026-09-05T00:00:20.000Z'
  };
  fake.resetCounts();
  await db.enableCentralSync({ bootstrapLocal:false });
  assert.equal(fake.counts.put, 1, 'une vraie mise à jour distante doit produire exactement un put');
  assert.equal(fake.read('docs', 'kb-1')?.title, 'B');
  assert.ok(fake.read('docs', 'local-buffer'), 'le survivor doit rester présent après update distante');

  snapshot = {
    ...snapshot,
    data:{ docs:[] },
    serverTime:'2026-09-05T00:00:40.000Z'
  };
  fake.resetCounts();
  await db.enableCentralSync({ bootstrapLocal:false });
  assert.equal(fake.counts.delete, 1, 'une disparition autoritaire doit supprimer la fiche serveur');
  assert.equal(fake.read('docs', 'kb-1'), undefined);
  assert.ok(fake.read('docs', 'local-buffer'), 'le survivor local ne doit pas être supprimé par la révocation/absence');

  resetCatalogBuffer();
});
