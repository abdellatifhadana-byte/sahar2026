/**
 * @file tests/sync-queue-truth.test.js — SYNC-RESIDUAL-P0, vérité de la file.
 *
 * CE QUI S'AFFICHAIT
 * -------------------
 * La pastille se lisait sur le seul `state`, qui mélange deux faits distincts : la
 * LIAISON au central et l'ÉTAT DE LA FILE. Deux mensonges en découlaient :
 *
 *   · « Hors ligne / local » alors que le serveur venait de répondre et que
 *     l'instantané venait d'être appliqué — simplement parce qu'une modification
 *     restait à envoyer ;
 *   · « Synchronisé » par-dessus une modification refusée. Une entrée `conflict` ou
 *     `failed` est TERMINALE : plus aucune reprise ne la réclame, donc au passage
 *     suivant elle n'apparaît ni dans les échecs du tour, ni dans les entrées en
 *     attente. Vingt secondes après un refus, l'écran annonçait que tout allait bien.
 *
 * CE QUE CES ÉPREUVES VÉRIFIENT
 * ------------------------------
 * Le résumé et les libellés (fonctions pures), puis le VRAI `central-sync.js` sur une
 * VRAIE IndexedDB : une entrée terminale posée dans `syncQueue` doit interdire
 * « Synchronisé » au cycle suivant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classeQueueSync, libelleQueueSync, queueSyncEstVide, resumeQueueSync } from '../sync-queue-truth.js';

/* ---------------- Le résumé, sur le contenu réel du magasin ---------------- */

test('SYNC_ONLINE_TRUTH — file vide et central joignable : « Synchronisé »', () => {
  const resume = resumeQueueSync([]);
  assert.ok(queueSyncEstVide(resume));
  assert.equal(libelleQueueSync({ connecte:true, resume }), 'Synchronisé');
  assert.equal(classeQueueSync({ connecte:true, resume }), 'synced');
});

test('SYNC_PENDING_TRUTH — en ligne avec des modifications en attente : jamais « Hors ligne »', () => {
  const resume = resumeQueueSync([
    { status:'pending' }, { status:'pending' }, { status:'processing' }
  ]);
  assert.equal(resume.enAttente, 3);
  const libelle = libelleQueueSync({ connecte:true, resume });
  assert.equal(libelle, '3 modifications en attente');
  assert.ok(!/Hors ligne/i.test(libelle), 'le serveur répond : « Hors ligne » est un mensonge');
  assert.ok(!/Synchronisé/.test(libelle));
  assert.equal(classeQueueSync({ connecte:true, resume }), 'pending');
});

test('SYNC_PENDING_TRUTH — une seule modification reste au singulier', () => {
  const resume = resumeQueueSync([{ status:'pending' }]);
  assert.equal(libelleQueueSync({ connecte:true, resume }), '1 modification en attente');
});

test('SYNC_CONFLICT_TRUTH — un conflit est nommé comme tel', () => {
  const resume = resumeQueueSync([{ status:'conflict' }, { status:'conflict' }]);
  assert.equal(libelleQueueSync({ connecte:true, resume }), '2 conflits à résoudre');
  assert.equal(classeQueueSync({ connecte:true, resume }), 'error');
});

test('SYNC_FAILED_TRUTH — un rejet serveur est nommé comme tel', () => {
  const resume = resumeQueueSync([{ status:'failed' }]);
  assert.equal(libelleQueueSync({ connecte:true, resume }), '1 modification rejetée');
  assert.equal(classeQueueSync({ connecte:true, resume }), 'error');
});

test('SYNC_TRUTH — plusieurs situations sont TOUTES nommées, pas seulement la plus grave', () => {
  const resume = resumeQueueSync([
    { status:'pending' }, { status:'processing' }, { status:'conflict' }, { status:'failed' }, { status:'failed' }
  ]);
  const libelle = libelleQueueSync({ connecte:true, resume });
  assert.match(libelle, /2 modifications en attente/);
  assert.match(libelle, /1 conflit à résoudre/);
  assert.match(libelle, /2 modifications rejetées/);
});

test('FALSE_SYNCHRONISE — « Synchronisé » est impossible dès qu\'une entrée subsiste', () => {
  for (const statut of ['pending', 'processing', 'conflict', 'failed', 'statut-inconnu']) {
    const resume = resumeQueueSync([{ status:statut }]);
    const libelle = libelleQueueSync({ connecte:true, resume });
    assert.notEqual(libelle, 'Synchronisé', `« Synchronisé » affiché avec une entrée ${statut}`);
    assert.ok(!queueSyncEstVide(resume), `une entrée ${statut} doit compter comme du travail restant`);
  }
});

test('FALSE_SYNCHRONISE — une entrée `done` ne compte plus', () => {
  const resume = resumeQueueSync([{ status:'done' }, { status:'done' }]);
  assert.ok(queueSyncEstVide(resume));
  assert.equal(libelleQueueSync({ connecte:true, resume }), 'Synchronisé');
});

test('SYNC_OFFLINE_TRUTH — « Hors ligne » reste réservé au central injoignable', () => {
  assert.equal(libelleQueueSync({ connecte:false, resume:resumeQueueSync([]) }), 'Hors ligne');
  assert.match(
    libelleQueueSync({ connecte:false, resume:resumeQueueSync([{ status:'pending' }, { status:'pending' }]) }),
    /^Hors ligne · 2 modifications non synchronisées$/
  );
  assert.equal(
    libelleQueueSync({ connecte:false, resume:resumeQueueSync([]), etat:'unauthenticated' }),
    'Session requise'
  );
});

/* ---------------- Le vrai central-sync, sur une vraie IndexedDB ---------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  removeEventListener() {},
  dispatchEvent(evenement) {
    for (const fonction of [...(auditeurs.get(evenement.type) || [])]) fonction(evenement);
    return true;
  }
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.localStorage = {
  store: new Map(),
  getItem(cle) { return this.store.has(cle) ? this.store.get(cle) : null; },
  setItem(cle, valeur) { this.store.set(cle, String(valeur)); },
  removeItem(cle) { this.store.delete(cle); }
};
globalThis.localStorage.setItem('auth', JSON.stringify({ id: 1, role: 'admin' }));
globalThis.setInterval = () => 0;
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};

const snapshotVide = {
  initialized: true, authoritativeStores: [], data: {}, deleted: [], access: {},
  serverTime: new Date().toISOString()
};
const reponse = (status, corps) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null }, text: async () => JSON.stringify(corps)
});
globalThis.fetch = async chemin => {
  const url = String(chemin);
  if (url.includes('/api/sync/bootstrap')) return reponse(200, {});
  if (url.includes('/api/sync')) return reponse(200, snapshotVide);
  return reponse(404, { error: 'not-found' });
};

/*
 * La couche de STOCKAGE est remplacée en mémoire, avant l'import de `central-sync.js` —
 * qui capture `db.save`/`db.open` à son chargement. L'instantané servi est vide, donc
 * `applySnapshot` n'ouvre aucune transaction : ce qui est exercé ici est la CONCLUSION
 * tirée de la file, pas le stockage. Aucune dépendance de développement n'est requise
 * (la CI installe `--omit=dev`).
 */
const magasins = new Map();
const magasin = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

const { db } = await import('../db.js');
db.open = async () => db;
db.getAll = async nom => [...magasin(nom).values()].map(record => structuredClone(record));
db.get = async (nom, id) => {
  const record = magasin(nom).get(String(id));
  return record ? structuredClone(record) : undefined;
};
db.save = async (nom, donnees) => {
  const charge = { ...donnees };
  if (charge.id === '' || charge.id === undefined || charge.id === null) charge.id = `auto-${magasin(nom).size + 1}`;
  magasin(nom).set(String(charge.id), structuredClone(charge));
  return charge.id;
};
// `central-sync.js` enveloppe `_deleteRaw` et relit la fiche par `_getRaw` avant de la
// retirer : les deux doivent donc passer par le même stockage en mémoire.
db._getRaw = async (nom, id) => {
  const record = magasin(nom).get(String(id));
  return record ? structuredClone(record) : undefined;
};
db._deleteRaw = async (nom, id) => { magasin(nom).delete(String(id)); return true; };

await import('../central-sync.js');

const statuts = [];
globalThis.window.addEventListener('central-sync-status', evenement => statuts.push(evenement.detail));

async function viderFile() {
  for (const entree of await db.getAll('syncQueue')) await db._deleteRaw('syncQueue', entree.id);
}

test('FALSE_SYNCHRONISE — le cycle SUIVANT ne recouvre pas un conflit resté en base', async () => {
  await db.open();
  await viderFile();
  statuts.length = 0;

  // Une entrée terminale : plus aucune reprise ne la réclame (`queueEntryIsClaimable`
  // l'exclut). `syncQueue` n'est pas un magasin synchronisé, cette écriture reste locale.
  await db.save('syncQueue', {
    action:'save', storeName:'rooms', entityId:'room-1', data:{ id:'room-1' },
    status:'conflict', attempts:1, lastError:'STALE_WRITE', timestamp:new Date().toISOString()
  });

  // CYCLE 1 — le refus vient d'être constaté ; le compte rendu du passage le porte encore.
  await db.enableCentralSync({ bootstrapLocal:false });

  // Seule l'entrée terminale subsiste : c'est l'état durable, celui qu'un humain doit
  // résoudre en relisant puis en ressaisissant.
  for (const entree of await db.getAll('syncQueue')) {
    if (entree.status !== 'conflict') await db._deleteRaw('syncQueue', entree.id);
  }
  const restant = await db.getAll('syncQueue');
  assert.equal(restant.length, 1);
  assert.equal(restant[0].status, 'conflict');

  // CYCLE 2 — vingt secondes plus tard. Le passage ne réclame rien, donc ne rejette rien :
  // c'est ICI que l'ancien code annonçait « Données synchronisées avec la base centrale ».
  statuts.length = 0;
  await db.enableCentralSync({ bootstrapLocal:false });

  const dernier = statuts.at(-1);
  assert.ok(dernier, 'aucun statut émis au second cycle');
  assert.notEqual(dernier.state, 'synced', '« Synchronisé » annoncé alors qu\'un conflit dort en base');
  assert.equal(dernier.state, 'conflict');
  assert.equal(dernier.queue?.conflict, 1, 'le conflit en base n\'est pas compté');
  assert.equal(dernier.connecte, true, 'le central a répondu : la liaison doit être annoncée');
  assert.equal(
    libelleQueueSync({ connecte:dernier.connecte === true, resume:dernier.queue, etat:dernier.state }),
    '1 conflit à résoudre'
  );
});

test('SYNC_ONLINE_TRUTH — file réellement vide : le cycle conclut « Synchronisé »', async () => {
  await db.open();
  await viderFile();
  statuts.length = 0;

  await db.enableCentralSync({ bootstrapLocal:false });

  const dernier = statuts.at(-1);
  assert.equal(dernier.queue?.total, 0);
  assert.equal(dernier.connecte, true);
  assert.equal(dernier.state, 'synced');
  assert.equal(
    libelleQueueSync({ connecte:true, resume:dernier.queue, etat:dernier.state }),
    'Synchronisé'
  );
  // La preuve d'instantané appliqué doit rester portée : `attendreDecisionSync()` en dépend.
  assert.ok(dernier.updatedAt, 'l\'évènement ne porte plus `updatedAt`');
});
