/**
 * @file tests/startup-sync-storage-failure.test.js — #98 / A01.
 *
 * LE DÉFAUT
 * ----------
 * `db.enableCentralSync()` termine son démarrage dans cet ordre :
 *
 *      await applySnapshot(snapshot);                 // l'instantané est POSÉ
 *      remoteReady = true;                            // la plateforme se déclare PRÊTE
 *      localStorage.setItem('central-sync-initialized', '1');
 *      localStorage.setItem('zone-access-context', …); // ← peut LEVER
 *      const queue = await db.processSyncQueue();      // ← jamais atteint
 *      …
 *      emitStatus({ state: … });                      // ← jamais émis
 *
 * Seul le téléchargement de `/api/sync` est protégé par un `try/catch`. Tout ce qui suit ne
 * l'est pas. Si `localStorage.setItem` lève — `QuotaExceededError`, mode privé, stockage
 * bloqué par la politique du navigateur — le démarrage s'interrompt APRÈS avoir posé
 * `remoteReady = true` et AVANT de vider la file :
 *
 *   · `db.isCentralSyncReady()` répond OUI ;
 *   · les modifications locales en attente ne sont JAMAIS poussées ;
 *   · aucun `central-sync-status` n'est émis — la pastille reste muette, et les
 *     réconciliateurs qui attendent leur premier `synced` ne partent jamais.
 *
 * Ce n'est pas une gêne d'affichage : c'est un état incohérent du chemin de démarrage.
 *
 * CE QUE LES DEUX CLÉS SONT VRAIMENT
 * -----------------------------------
 * Aucune n'est une autorité. `zone-access-context` sert d'EMPREINTE de portée à
 * `grille-centrale-dataset.js` — « une empreinte, pas une copie » — et tous ses lecteurs
 * (`tickets.js`, `rf-master-import.js`, `zone-scope-notice.js`) la lisent défensivement
 * (`|| '{}'`, `|| 'null'`, sous `try`). Son absence invalide le cache et force une
 * revalidation auprès du serveur, qui reste seul juge. Une valeur PÉRIMÉE serait donc pire
 * qu'une valeur absente : le correctif retire la clé quand il ne peut pas la réécrire.
 *
 * Aucune dépendance de développement.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * `central-sync.js` pose un battement périodique (`setInterval`) à l'import. Sans le
 * relâcher, le fichier d'épreuves ne rendrait jamais la main. On garde les poignées pour
 * les libérer à la fin — le battement n'est pas le sujet de ce fichier.
 */
const battements = [];
const vraiSetInterval = globalThis.setInterval;
globalThis.setInterval = (...arguments_) => { const jeton = vraiSetInterval(...arguments_); battements.push(jeton); return jeton; };
after(() => { for (const jeton of battements) clearInterval(jeton); });

/* ---------------- Un navigateur minimal ---------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) { if (!auditeurs.has(type)) auditeurs.set(type, []); auditeurs.get(type).push(fonction); },
  removeEventListener() {},
  dispatchEvent(evenement) { for (const fonction of [...(auditeurs.get(evenement.type) || [])]) fonction(evenement); return true; }
};
const element = () => ({
  id: '', className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, enfants: [],
  classList: { add() {}, remove() {}, contains: () => false },
  appendChild(noeud) { this.enfants.push(noeud); return noeud; },
  remove() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
});
globalThis.document = {
  createElement: () => element(), body: element(), head: element(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, visibilityState: 'visible'
};

/**
 * Un stockage local qui SATURE sur une clé donnée — la panne réelle qu'on reproduit.
 *
 * `QuotaExceededError` est ce que lèvent les navigateurs quand le quota est atteint ; le
 * mode privé et certaines politiques d'entreprise lèvent de la même façon.
 */
function stockage({ saturePour = null, preexistant = {} } = {}) {
  const valeurs = new Map([
    ['auth', JSON.stringify({ id: 'u-admin', role: 'admin', authVersion: 1 })],
    ...Object.entries(preexistant)
  ]);
  const tentatives = [];
  return {
    tentatives,
    getItem: cle => (valeurs.has(String(cle)) ? valeurs.get(String(cle)) : null),
    setItem(cle, valeur) {
      tentatives.push(String(cle));
      if (saturePour && String(cle) === saturePour) {
        const erreur = new Error('The quota has been exceeded.');
        erreur.name = 'QuotaExceededError';
        throw erreur;
      }
      valeurs.set(String(cle), String(valeur));
    },
    removeItem(cle) { valeurs.delete(String(cle)); },
    clear() { valeurs.clear(); },
    contient: cle => valeurs.has(String(cle))
  };
}

/* ---------------- Une base locale minimale ---------------- */

function baseDouble(initial = {}) {
  const magasins = new Map(Object.entries(initial).map(([nom, liste]) => [
    nom, new Map((liste || []).map(enregistrement => [String(enregistrement.id), structuredClone(enregistrement)]))
  ]));
  const magasin = nom => { if (!magasins.has(nom)) magasins.set(nom, new Map()); return magasins.get(nom); };
  const transaction = nom => {
    const donnees = magasin(nom);
    let enVol = 0; let planifiee = false;
    const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
    const terminer = () => {
      if (enVol !== 0 || planifiee) return;
      planifiee = true;
      queueMicrotask(() => { planifiee = false; if (enVol === 0) tx.oncomplete?.(); });
    };
    const requete = calcul => {
      enVol += 1;
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        try { req.result = calcul(); req.onsuccess?.({ target: req }); }
        catch (erreur) { req.error = erreur; req.onerror?.({ target: req }); }
        finally { enVol -= 1; terminer(); }
      });
      return req;
    };
    return {
      ...tx,
      objectStore: () => ({
        get: id => requete(() => structuredClone(donnees.get(String(id)))),
        getAll: () => requete(() => [...donnees.values()].map(valeur => structuredClone(valeur))),
        put: valeur => requete(() => { donnees.set(String(valeur.id), structuredClone(valeur)); return valeur.id; }),
        delete: id => requete(() => { donnees.delete(String(id)); return undefined; }),
        clear: () => requete(() => { donnees.clear(); return undefined; })
      }),
      get oncomplete() { return tx.oncomplete; }, set oncomplete(valeur) { tx.oncomplete = valeur; terminer(); },
      get onerror() { return tx.onerror; }, set onerror(valeur) { tx.onerror = valeur; },
      get onabort() { return tx.onabort; }, set onabort(valeur) { tx.onabort = valeur; }
    };
  };
  return { magasins, magasin, db: { objectStoreNames: { contains: () => true }, transaction } };
}

const INSTANTANE = Object.freeze({
  initialized: true,
  data: { docs: [{ id: 'kb-1', titre: 'A' }] },
  deleted: [],
  authoritativeStores: ['docs'],
  access: { memberships: [], grants: [], isGlobalAdmin: true, zones: [] },
  serverTime: '2026-09-10T08:00:00.000Z'
});

/*
 * `central-sync.js` installe `enableCentralSync` sur le singleton `db` À L'IMPORT. Il faut
 * donc l'importer — sinon l'épreuve mesurerait l'absence de la fonction, pas le défaut.
 * Le stockage local est relu à CHAQUE appel, il peut donc être remplacé entre les cas.
 */
globalThis.localStorage = stockage();
globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
const { db } = await import('../db.js');
await import('../central-sync.js');

/** Monte un démarrage central complet, avec le stockage local demandé. */
async function demarrage({ saturePour = null, preexistant = {} } = {}) {
  const magasin = stockage({ saturePour, preexistant });
  globalThis.localStorage = magasin;
  auditeurs.clear();

  const base = baseDouble({ docs: [], syncQueue: [] });
  db.db = base.db;
  db.open = async () => db.db;
  db._getRaw = async (nom, id) => structuredClone(base.magasin(nom).get(String(id)));
  db.getAll = async nom => [...base.magasin(nom).values()].map(valeur => structuredClone(valeur));
  db.get = db._getRaw;
  db.normalizeKey = valeur => String(valeur);

  let filesTraitees = 0;
  const traiterOriginal = db.processSyncQueue?.bind(db);
  db.processSyncQueue = async (...arguments_) => {
    filesTraitees += 1;
    if (typeof traiterOriginal === 'function') {
      try { return await traiterOriginal(...arguments_); } catch { /* la file réelle n'est pas le sujet */ }
    }
    return { processed: 0, failed: 0, pending: 0 };
  };

  globalThis.fetch = async () => new Response(JSON.stringify(INSTANTANE), {
    status: 200, headers: { 'content-type': 'application/json' }
  });

  const etats = [];
  window.addEventListener('central-sync-status', evenement => etats.push(evenement.detail?.state));

  let leve = null;
  try { await db.enableCentralSync({ bootstrapLocal: false }); }
  catch (erreur) { leve = erreur; }

  return { db, magasin, etats, leve, filesTraitees: () => filesTraitees };
}

/* ═══════════════════ LE CONTRAT ═══════════════════ */

test('#98/A01 · un stockage local SATURÉ ne casse pas la synchronisation', async () => {
  /*
   * ROUGE avant correctif : `remoteReady` passe à VRAI, puis `setItem` lève, et
   * `processSyncQueue()` n'est jamais atteint. La plateforme se croit prête alors que la
   * file n'a jamais été vidée, et aucun statut n'est émis.
   */
  const { db, etats, filesTraitees } = await demarrage({ saturePour: 'zone-access-context' });

  assert.equal(filesTraitees(), 1,
    'la file de synchronisation DOIT être traitée même si le stockage local sature');
  assert.ok(etats.length > 0,
    'un `central-sync-status` DOIT être émis — sans lui, la pastille reste muette et les ' +
    'réconciliateurs n’ont jamais leur premier « synced »');
  assert.equal(db.isCentralSyncReady(), true,
    'l’instantané ayant été appliqué, la synchronisation centrale est bien prête');
});

test('#98/A01 · une empreinte de portée PÉRIMÉE est retirée, pas conservée', async () => {
  /*
   * `zone-access-context` n'est pas une autorité : c'est l'empreinte qui invalide le cache
   * du jeu de données protégé. Si on ne peut pas la réécrire, la laisser telle quelle
   * ferait travailler la session sur l'empreinte de la PRÉCÉDENTE autorité. On la retire :
   * l'empreinte change, le cache se revalide, et le serveur tranche — comme il doit.
   */
  const PERIMEE = JSON.stringify({ memberships: [{ zoneId: 'zone-precedente', status: 'active' }], grants: [], isGlobalAdmin: true });
  const { magasin } = await demarrage({
    saturePour: 'zone-access-context',
    preexistant: { 'zone-access-context': PERIMEE }
  });

  assert.ok(magasin.tentatives.includes('zone-access-context'),
    'l’écriture de l’empreinte doit bien avoir été TENTÉE');
  assert.equal(magasin.contient('zone-access-context'), false,
    'faute de pouvoir l’écrire, l’empreinte de l’autorité PRÉCÉDENTE ne doit pas subsister');
  assert.notEqual(magasin.getItem('zone-access-context'), PERIMEE,
    'la session ne doit pas continuer sur l’empreinte périmée');
});

test('#98/A01 · sans panne de stockage, le démarrage reste inchangé', async () => {
  const { db, magasin, etats, leve, filesTraitees } = await demarrage();

  assert.equal(leve, null, 'un démarrage normal ne lève pas');
  assert.equal(filesTraitees(), 1, 'la file est traitée une fois');
  assert.ok(etats.length > 0, 'le statut est émis');
  assert.equal(db.isCentralSyncReady(), true);
  assert.equal(magasin.contient('zone-access-context'), true, 'l’empreinte est écrite normalement');
  assert.equal(magasin.contient('central-sync-initialized'), true);
});
