/**
 * @file scripts/write02-instrumentation.mjs — pourquoi `current` devient nul.
 *
 * CE QU'ON CHERCHE
 * ----------------
 * Après WRITE-01, les rôles à périmètre n'écrivent plus rien. Il reste chez Admin et
 * Manager une poignée d'écritures par minute et demie, alors que la charge envoyée est
 * IDENTIQUE au document stocké — seize champs contre seize, aucune valeur différente hors
 * `updatedAt`. La garde de convergence ne peut donc pas être battue par un contenu qui
 * change : elle est contournée parce que `current` est parfois NUL.
 *
 * Ce script ne compte pas des requêtes. Il enregistre, à CHAQUE passage de l'écrivain :
 * l'instant, le rôle, l'événement déclencheur, la présence de `current`, l'état de la base
 * locale juste avant et juste après, la présence du document dans l'instantané reçu, et
 * l'écriture HTTP éventuelle.
 *
 * Le tout contre un VRAI serveur et une VRAIE base : c'est la projection locale qu'on
 * soupçonne, et elle n'existe que quand un instantané réel a été appliqué.
 *
 * Usage :
 *   PORT=4195 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4195 node scripts/write02-instrumentation.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4195';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'w02-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!';

const vraiFetch = globalThis.fetch;

async function connexion(username, password) {
  const reponse = await vraiFetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(reponse.status, 200, `connexion refusée pour « ${username} » (${reponse.status})`);
  return reponse.headers.get('set-cookie')?.split(';')[0] || '';
}

/* ------------------------- Navigateur minimal ------------------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
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

let identite = null;
const memoire = new Map();
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? (identite ? JSON.stringify(identite) : null) : (memoire.get(cle) ?? null)),
  setItem: (cle, valeur) => { memoire.set(cle, String(valeur)); },
  removeItem: cle => { memoire.delete(cle); }
};

/* ---- Base locale en mémoire, avec les mêmes opérations qu'IndexedDB ---- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

const PLAN = 'gc-field-verification-plan';
const journal = [];
let cookie = '';
let deroulement = 'démarrage';

const { db } = await import('../db.js');
db.open = async () => ({});

/*
 * `objectStoreNames.contains` répond VRAI et la transaction est réelle : c'est
 * `applySnapshot` qu'on veut voir travailler, y compris son effacement autoritaire. Le
 * remplacement d'un magasin est reproduit dans sa forme — vider, puis remplir — parce que
 * c'est précisément là qu'on soupçonne la disparition.
 */
db.db = {
  objectStoreNames: { contains: () => true },
  transaction(nom) {
    const magasin = table(nom);
    const operations = [];
    const transaction = {
      objectStore: () => ({
        clear() { operations.push(() => magasin.clear()); },
        put(enregistrement) { operations.push(() => magasin.set(String(enregistrement.id), enregistrement)); },
        delete(id) { operations.push(() => magasin.delete(String(id))); }
      }),
      oncomplete: null, onerror: null, onabort: null
    };
    queueMicrotask(() => {
      for (const operation of operations) operation();
      transaction.oncomplete?.();
    });
    return transaction;
  }
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()];
const ecrituresHttp = [];
db.save = async (nom, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

/* --------- Transport : le cookie que le navigateur joindrait seul --------- */

globalThis.fetch = async (chemin, options = {}) => {
  const absolu = String(chemin).startsWith('http') ? String(chemin) : `${base}${chemin}`;
  const methode = options.method || 'GET';
  if (['PUT', 'POST', 'DELETE'].includes(methode) && String(chemin).includes('/api/data/')) {
    const identifiant = decodeURIComponent(String(chemin).split('/api/data/')[1] || '');
    ecrituresHttp.push({ deroulement, methode, cible: identifiant.split('?')[0] });
  }
  return vraiFetch(absolu, { ...options, headers: { ...(options.headers || {}), cookie } });
};

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

/*
 * L'ORDRE DE CES DEUX IMPORTS EST UNE DONNÉE DU PROBLÈME, PAS UN DÉTAIL.
 *
 * Les deux modules enveloppent `db.save`. `index.html` charge `central-sync.js` (ligne 57)
 * PUIS `catalog-seed-guard.js` (ligne 59) : le garde est donc l'enveloppe EXTÉRIEURE, et
 * c'est ce qui lui permet de retenir une fiche d'ensemencement AVANT qu'elle ne parte vers
 * le serveur.
 *
 * Inversés, le garde devient intérieur : chaque écriture d'ensemencement part d'abord en
 * HTTP, et la sonde mesure alors une tempête qui n'existe que dans la sonde. C'est arrivé —
 * quatre-vingt-onze écritures attribuées au produit qui n'appartenaient qu'à l'instrument.
 */
await import('../central-sync.js');
await import('../catalog-seed-guard.js');
const champ = await import('../grille-centrale-field-verification.js');

/* ------------------------------ La sonde ------------------------------ */

/** L'état de la projection locale, tel que l'écrivain le verra. */
const etatLocal = () => {
  const present = table('docs').has(PLAN);
  return { present, docsLocaux: table('docs').size };
};

/** Le document est-il dans l'instantané que le serveur vient d'envoyer ? */
async function dansInstantane() {
  const reponse = await vraiFetch(`${base}/api/sync`, { headers: { cookie } });
  const charge = await reponse.json();
  const docs = charge?.data?.docs || [];
  return {
    present: docs.some(document_ => String(document_.id) === PLAN),
    docs: docs.length,
    autoritaire: (charge?.authoritativeStores || []).includes('docs')
  };
}

async function passage(declencheur) {
  deroulement = declencheur;
  const avant = etatLocal();
  const courantAvant = await db.get('docs', PLAN);
  const ecrituresAvant = ecrituresHttp.length;

  await champ.ensureGrilleCentraleFieldVerification().catch(erreur => { journal.push({ declencheur, erreur: erreur.message }); });

  const apres = etatLocal();
  journal.push({
    declencheur,
    role: identite?.role,
    currentAvant: courantAvant ? 'présent' : 'ABSENT',
    localAvant: avant.present ? 'présent' : 'ABSENT',
    localApres: apres.present ? 'présent' : 'ABSENT',
    docsLocaux: `${avant.docsLocaux}→${apres.docsLocaux}`,
    ecritureHttp: ecrituresHttp.length - ecrituresAvant
  });
}

/* ------------------------------ Le parcours ------------------------------ */

console.log(`\n╔═══ WRITE-02 · d'où vient le « current = null » — ${base} ═══╗\n`);

for (const role of ['admin', 'manager']) {
  cookie = await connexion(adminUsername, adminPassword);
  identite = { id: 1, username: adminUsername, role };
  magasins.clear();
  journal.length = 0;
  ecrituresHttp.length = 0;
  memoire.clear();

  console.log(`\n── rôle simulé : ${role}`);

  // 1 · démarrage : premier instantané, puis premier passage de l'écrivain.
  await db.enableCentralSync();
  const vu1 = await dansInstantane();
  console.log(`   instantané initial : ${vu1.docs} docs · plan ${vu1.present ? 'PRÉSENT' : 'ABSENT'} · docs autoritaire=${vu1.autoritaire}`);
  await passage('démarrage');

  // 2 · deuxième instantané — celui du cycle de vingt secondes.
  await db.enableCentralSync({ bootstrapLocal: false });
  await passage('deuxième instantané');

  // 3 · les déclencheurs réels.
  await db.enableCentralSync({ bootstrapLocal: false });
  await passage('retour sur l’onglet (focus)');

  await db.enableCentralSync({ bootstrapLocal: false });
  await passage('retour du réseau (online)');

  window.dispatchEvent(new CustomEvent('grille-centrale-documented-map-updated', { detail: {} }));
  await passage('documented-map-updated');

  await db.enableCentralSync({ bootstrapLocal: false });
  await passage('instantané suivant');

  const vuFinal = await dansInstantane();
  console.log(`   instantané final   : ${vuFinal.docs} docs · plan ${vuFinal.present ? 'PRÉSENT' : 'ABSENT'}`);

  console.log('');
  console.log('   déclencheur                    current   local avant→après   docs      HTTP');
  console.log('   ─────────────────────────────  ────────  ─────────────────  ────────  ────');
  for (const ligne of journal.filter(entree => !entree.erreur)) {
    console.log(`   ${String(ligne.declencheur).padEnd(29)}  ${String(ligne.currentAvant).padEnd(8)}  `
      + `${String(ligne.localAvant).padEnd(8)}→${String(ligne.localApres).padEnd(8)}  `
      + `${String(ligne.docsLocaux).padEnd(8)}  ${ligne.ecritureHttp}`);
  }
  for (const ligne of journal.filter(entree => entree.erreur)) {
    console.log(`   ⚠️  ${ligne.declencheur} → ${ligne.erreur}`);
  }
  const parCible = {};
  for (const ecriture of ecrituresHttp) parCible[ecriture.cible] = (parCible[ecriture.cible] || 0) + 1;
  console.log(`   → écritures HTTP totales : ${ecrituresHttp.length}`);
  for (const [cible, nombre] of Object.entries(parCible).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(nombre).padStart(3)} × ${cible}`);
  }
}

console.log('\n╚═══ fin de la sonde ═══╝\n');
