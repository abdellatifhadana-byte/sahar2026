/**
 * @file tests/propriete-enregistrement.test.js — BLOCK-C-LOCAL-CHURN-01, à qui est la fiche.
 *
 * CE QUI A ÉTÉ MESURÉ, PAS SUPPOSÉ
 * ---------------------------------
 * `scripts/churn-instrumentation.mjs`, contre un serveur et une base PostgreSQL réels,
 * donne le cycle exact — et il ne s'agit pas de faux événements :
 *
 *   fiche                      avant  snapshot  autoritaire  après tx  après apply  ré-ensemencée
 *   settings/current-room      oui    NON       oui          NON       oui          OUI
 *   settings/map-image-cache   oui    NON       oui          NON       NON          non
 *   docs/gc-in-001             oui    NON       oui          NON       NON          non
 *   docs/kb-ultrix-fr          oui    NON       oui          NON       NON          non
 *   users/<réel>               oui    oui       oui          oui       oui          non
 *
 * Autrement dit : le vidage autoritaire DÉTRUIT réellement ces fiches. `current-room` est
 * ensuite recréée par `applySnapshot` lui-même, ce qui rejoue la destruction au cycle
 * suivant — la boucle qui ne s'arrêtait jamais. `map-image-cache` n'est pas recréée du
 * tout : les octets du plan étaient PERDUS, puis retéléchargés. Et onze modules écoutent
 * `central-sync-status: synced` pour ré-ensemencer leurs documents, d'où les ~450 entités
 * qui revenaient à chaque cycle.
 *
 * Une fiche centrale réelle, elle, traverse intacte et n'émet rien : la machinerie de
 * différence n'a jamais été en cause. C'est le MODÈLE DE PROPRIÉTÉ qui manquait.
 *
 * POURQUOI ON NE FILTRE PAS LES ÉVÉNEMENTS
 * -----------------------------------------
 * Masquer l'annonce laisserait la destruction en place. La donnée continuerait de
 * disparaître — en silence. Ces épreuves vérifient donc la SURVIE des fiches, pas seulement
 * le silence du canal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Navigateur minimal, installé avant l'import ---------------- */

const auditeurs = new Map();
const evenements = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
    evenements.push({ type: evenement.type, detail: evenement.detail });
    for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement);
    return true;
  }
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
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, username: 'admin', role: 'admin' }) : null),
  setItem() {}, removeItem() {}
};

/* ---------------- Base locale, avec de vraies transactions ---------------- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

const MAGASINS = ['rooms', 'equipments', 'docs', 'settings', 'syncQueue', 'notes'];

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = {
  objectStoreNames: { contains: nom => MAGASINS.includes(nom) },
  transaction(nom) {
    const magasin = table(nom);
    const operations = [];
    const transaction = {
      objectStore: () => ({
        clear() { operations.push(() => magasin.clear()); },
        put(enregistrement) { operations.push(() => magasin.set(String(enregistrement.id), enregistrement)); },
        delete(id) { operations.push(() => magasin.delete(String(id))); },
        getAll() {
          const requete = { result: [...magasin.values()], onsuccess: null, onerror: null };
          // La requête rend la main dans une micro-tâche, et les gestes émis DEPUIS son
          // succès rejoignent la même transaction : c'est ainsi qu'IndexedDB enchaîne.
          queueMicrotask(() => requete.onsuccess?.());
          return requete;
        }
      }),
      oncomplete: null, onerror: null, onabort: null
    };
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
      for (const operation of operations) operation();
      transaction.oncomplete?.();
    })));
    return transaction;
  }
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()];

const ecrituresLocales = [];
db.save = async (nom, enregistrement) => {
  ecrituresLocales.push({ nom, id: String(enregistrement?.id ?? '') });
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

/* ------------------------------ Serveur simulé ------------------------------ */

/** Le serveur déclare autoritaires les VINGT magasins — `settings` et `docs` compris. */
const MAGASINS_AUTORITAIRES = ['rooms', 'equipments', 'docs', 'notes', 'settings'];
let instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z' };
const ecrituresServeur = [];
globalThis.fetch = async (chemin, options = {}) => {
  if (['PUT', 'POST', 'DELETE'].includes(options.method || 'GET')) ecrituresServeur.push(`${options.method} ${chemin}`);
  const corps = String(chemin).startsWith('/api/sync')
    ? { authoritativeStores: MAGASINS_AUTORITAIRES, ...instantaneServeur }
    : { ok: true };
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(corps) };
};

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

await import('../central-sync.js');
const propriete = await import('../record-ownership-contract.js');

/* ------------------------------- Utilitaires ------------------------------- */

const CONTRAT = ['platform-entity-updated', 'platform-entity-deleted', 'platform-entity-diverged'];

async function appliquer(serveur = {}) {
  evenements.length = 0;
  ecrituresLocales.length = 0;
  ecrituresServeur.length = 0;
  instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z', ...serveur };
  await db.enableCentralSync({ bootstrapLocal: false });
}

const annonces = () => evenements
  .filter(entree => CONTRAT.includes(entree.type))
  .map(entree => `${entree.type.replace('platform-entity-', '')} ${entree.detail?.storeName}/${entree.detail?.id}`);

const annoncesPour = (store, id) => annonces().filter(ligne => ligne.endsWith(` ${store}/${id}`));

function repartirDeZero() {
  magasins.clear();
  propriete.resetCatalogBuffer();
}

/** L'instantané que le serveur enverrait : le central, et rien du local. */
const INSTANTANE_CENTRAL = {
  data: {
    rooms: [{ id: 'salle-A', name: 'Régie A', _revision: 1 }],
    settings: [{ id: 'global', language: 'fr', _revision: 1 }],
    docs: [{ id: 'doc-central', title: 'Procédure centrale', _revision: 1 }]
  }
};

/* ═══════════════ RED-LOCAL-1 · la préférence de poste survit ═══════════════ */

test('LOCAL·1 — settings/current-room survit à un instantané qui ne la porte pas', async () => {
  /*
   * Mesuré : détruite par le vidage autoritaire, puis recréée par `applySnapshot` à la fin
   * du même passage. D'où un faux « supprimé » à chaque cycle, indéfiniment — c'est la
   * source de bruit la plus tenace des 45 événements par seconde.
   */
  repartirDeZero();
  table('settings').set('current-room', { id: 'current-room', currentRoomId: 'salle-A', updatedAt: 'hier' });
  table('rooms').set('salle-A', { id: 'salle-A', name: 'Régie A', _revision: 1 });

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('settings').has('current-room'), true,
    'la préférence de poste ne doit pas être détruite par un instantané qui ne la connaît pas');
  assert.deepEqual(annoncesPour('settings', 'current-room'), [],
    'et son absence de l’instantané n’est pas une suppression : c’est sa nature');
});

test('LOCAL·2 — settings/map-image-cache survit, et n’est pas retéléchargé', async () => {
  // Mesuré : détruite et JAMAIS recréée. Les octets du plan étaient réellement perdus.
  repartirDeZero();
  const octets = 'data:image/png;base64,AAAA';
  table('settings').set('map-image-cache', { id: 'map-image-cache', dataUrl: octets });

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('settings').get('map-image-cache')?.dataUrl, octets,
    'les octets du plan doivent survivre : les perdre les fait retélécharger à chaque cycle');
  assert.deepEqual(annoncesPour('settings', 'map-image-cache'), []);
});

test('LOCAL·3 — la fiche centrale du même magasin reste, elle, gouvernée par le serveur', async () => {
  // La protection vise DEUX identifiants nommés, pas le magasin `settings` entier.
  repartirDeZero();
  table('settings').set('global', { id: 'global', language: 'fr', _revision: 1 });
  table('settings').set('obsolete', { id: 'obsolete', valeur: 1 });

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('settings').has('obsolete'), false,
    'une fiche centrale disparue de l’instantané doit continuer de disparaître localement');
  assert.deepEqual(annoncesPour('settings', 'obsolete'), ['deleted settings/obsolete'],
    'et sa disparition doit rester annoncée');
});

/* ═══════════════ RED-CATALOG-1 · l'ensemencement retenu ═══════════════ */

test('CATALOG·1 — un ensemencement retenu n’est pas détruit puis ré-ensemencé en boucle', async () => {
  /*
   * `catalog-seed-guard` retient les fiches d'ensemencement en attendant leur installation
   * centrale. Le vidage autoritaire les détruisait, et onze modules de réconciliation les
   * ré-écrivaient au signal `synced` suivant : détruire → annoncer supprimé → ré-ensemencer,
   * toutes les vingt secondes, pour ~450 documents.
   */
  repartirDeZero();
  table('docs').set('gc-in-001', { id: 'gc-in-001', kind: 'equipment_catalog', title: 'Entrée 001' });
  table('docs').set('kb-ultrix-fr', { id: 'kb-ultrix-fr', kind: 'equipment_catalog', title: 'Ultrix' });
  propriete.declareCatalogBuffered('gc-in-001');
  propriete.declareCatalogBuffered('kb-ultrix-fr');

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('docs').has('gc-in-001'), true,
    'un ensemencement retenu doit rester en base pendant sa phase transitoire');
  assert.equal(table('docs').has('kb-ultrix-fr'), true);
  assert.deepEqual(annoncesPour('docs', 'gc-in-001'), []);
  assert.deepEqual(annoncesPour('docs', 'kb-ultrix-fr'), []);
  assert.equal(table('docs').has('doc-central'), true,
    'et la fiche centrale du même magasin doit être posée normalement');
});

test('CATALOG·2 — quand le centre porte la fiche, l’autorité lui revient', async () => {
  /*
   * La propriété transitoire doit CESSER, sans quoi on aurait deux sources durables pour la
   * même donnée. Dès que l'instantané porte la fiche, le registre la relâche : le serveur
   * la gouverne, et une suppression centrale ultérieure redevient effective.
   */
  repartirDeZero();
  table('docs').set('gc-in-001', { id: 'gc-in-001', kind: 'equipment_catalog', title: 'Entrée 001' });
  propriete.declareCatalogBuffered('gc-in-001');

  // Le catalogue est installé : le centre porte désormais la fiche.
  await appliquer({ data: { ...INSTANTANE_CENTRAL.data, docs: [
    { id: 'doc-central', title: 'Procédure centrale', _revision: 1 },
    { id: 'gc-in-001', kind: 'equipment_catalog', title: 'Entrée 001', _revision: 1 }
  ] } });

  assert.equal(propriete.catalogBufferedIds().includes('gc-in-001'), false,
    'la phase transitoire doit se terminer d’elle-même : pas de double source permanente');

  // Le serveur la supprime ensuite : la suppression doit être effective ET annoncée.
  await appliquer(INSTANTANE_CENTRAL);
  assert.equal(table('docs').has('gc-in-001'), false,
    'une fiche redevenue centrale doit pouvoir être supprimée par le centre');
  assert.deepEqual(annoncesPour('docs', 'gc-in-001'), ['deleted docs/gc-in-001']);
});

/* ═══════════════ RED-DIFF · un instantané stable ne dit rien ═══════════════ */

test('DIFF·STABLE — trois cycles identiques, zéro événement et zéro destruction', async () => {
  repartirDeZero();
  table('settings').set('current-room', { id: 'current-room', currentRoomId: 'salle-A', updatedAt: 'hier' });
  table('settings').set('map-image-cache', { id: 'map-image-cache', dataUrl: 'data:image/png;base64,AAAA' });
  table('docs').set('gc-in-001', { id: 'gc-in-001', kind: 'equipment_catalog', title: 'Entrée 001' });
  propriete.declareCatalogBuffered('gc-in-001');

  await appliquer(INSTANTANE_CENTRAL);   // premier passage : la base se remplit

  for (const passage of ['deuxième', 'troisième', 'quatrième']) {
    await appliquer(INSTANTANE_CENTRAL);
    assert.deepEqual(annonces(), [],
      `${passage} instantané identique, et pourtant annoncé : ${annonces().join(' · ')}`);
    assert.deepEqual(ecrituresLocales, [],
      `${passage} passage : aucune écriture locale ne doit être provoquée par un instantané identique`);
    assert.deepEqual(ecrituresServeur, [], `${passage} passage : aucune écriture réseau`);
  }

  assert.equal(table('settings').has('current-room'), true);
  assert.equal(table('settings').has('map-image-cache'), true);
  assert.equal(table('docs').has('gc-in-001'), true);
  assert.equal((await db.getAll('syncQueue')).length, 0, 'la file d’attente doit rester vide');
});

/* ═══════════════ NON-RÉGRESSION · ce qui doit continuer de marcher ═══════════════ */

test('NON-RÉG·1 — une vraie suppression serveur reste détectée', async () => {
  repartirDeZero();
  table('rooms').set('salle-A', { id: 'salle-A', name: 'Régie A', _revision: 1 });
  table('rooms').set('salle-B', { id: 'salle-B', name: 'Régie B', _revision: 1 });

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('rooms').has('salle-B'), false);
  assert.deepEqual(annoncesPour('rooms', 'salle-B'), ['deleted rooms/salle-B']);
});

test('NON-RÉG·2 — la pierre tombale seule reste détectée', async () => {
  repartirDeZero();
  table('notes').set('N-TOMB', { id: 'N-TOMB', name: 'Note supprimée ailleurs', _revision: 1 });
  table('notes').set('N-RESTE', { id: 'N-RESTE', name: 'Note conservée', _revision: 1 });

  await appliquer({
    data: { rooms: [] },
    authoritativeStores: ['rooms'],
    deleted: [{ store: 'notes', id: 'N-TOMB' }]
  });

  assert.equal(table('notes').has('N-TOMB'), false);
  assert.equal(table('notes').has('N-RESTE'), true);
  assert.deepEqual(annoncesPour('notes', 'N-TOMB'), ['deleted notes/N-TOMB']);
});

test('NON-RÉG·3 — une révocation de zone reste détectée', async () => {
  repartirDeZero();
  table('equipments').set('eq-zone-perdue', { id: 'eq-zone-perdue', name: 'Ultrix', _revision: 3 });
  table('equipments').set('eq-visible', { id: 'eq-visible', name: 'Kahuna', _revision: 1 });

  await appliquer({ data: { equipments: [{ id: 'eq-visible', name: 'Kahuna', _revision: 1 }] } });

  assert.equal(table('equipments').has('eq-zone-perdue'), false,
    'une donnée devenue interdite ne reste pas dans la projection locale');
  assert.deepEqual(annoncesPour('equipments', 'eq-zone-perdue'), ['deleted equipments/eq-zone-perdue']);
});

test('NON-RÉG·4 — un vrai changement distant reste annoncé', async () => {
  repartirDeZero();
  table('rooms').set('salle-A', { id: 'salle-A', name: 'Ancien nom', _revision: 1 });

  await appliquer(INSTANTANE_CENTRAL);

  assert.deepEqual(annoncesPour('rooms', 'salle-A'), ['updated rooms/salle-A']);
  assert.equal(table('rooms').get('salle-A').name, 'Régie A');
});

test('NON-RÉG·5 — `saveLocalOnly` ne confère AUCUNE propriété par elle-même', async () => {
  /*
   * Elle contourne le réseau, ce qui n'est pas une déclaration de propriété : le même appel
   * sert à écrire une fiche centrale sans la republier. Traiter tout `saveLocalOnly` comme
   * une donnée locale permanente figerait des fiches que le serveur doit pouvoir corriger.
   */
  repartirDeZero();
  await db.saveLocalOnly('docs', { id: 'doc-ecrit-localement', title: 'écrit sans réseau' });

  await appliquer(INSTANTANE_CENTRAL);

  assert.equal(table('docs').has('doc-ecrit-localement'), false,
    'un contournement réseau ne rend pas une fiche intouchable par le serveur');
  assert.deepEqual(annoncesPour('docs', 'doc-ecrit-localement'), ['deleted docs/doc-ecrit-localement']);
});
