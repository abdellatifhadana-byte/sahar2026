/**
 * @file scripts/churn-instrumentation.mjs — d'où viennent 45 événements par seconde au repos.
 *
 * CE QU'ON CHERCHE, ET POURQUOI ON NE LE DEVINE PAS
 * -------------------------------------------------
 * Le Runtime Gate mesure, sur un Admin au repos pendant 40 s, environ 1812 événements — soit
 * ~45,3 par seconde — portant sur ~450 entités distinctes, chacune revenant à chaque cycle
 * d'instantané. Aucune écriture réseau, `syncQueue` stable. Le défaut est donc dans la
 * PROJECTION LOCALE, pas dans la file.
 *
 * Il serait facile — et faux — de « corriger » cela en filtrant les événements. Si la cause
 * est une DESTRUCTION suivie d'un RÉ-ENSEMENCEMENT réels dans IndexedDB, masquer les
 * événements laisserait la destruction en place : les données continueraient de disparaître,
 * en silence cette fois. C'est pourquoi cette sonde mesure d'abord, et ne corrige rien.
 *
 * CE QU'ELLE ENREGISTRE, POUR CHAQUE FICHE SUIVIE
 * -----------------------------------------------
 *   1. présente en base AVANT l'instantané ?
 *   2. présente dans `snapshot.data` ?
 *   3. son magasin est-il dans `authoritativeStores` ?
 *   4. présente APRÈS la transaction de remplacement de son magasin ?
 *   5. présente APRÈS `applySnapshot` complet ?
 *   6. recréée ensuite par un ré-ensemencement ?
 *   7. quel événement a été émis à son sujet ?
 *   8. d'où vient la fiche ?
 *
 * Contre un VRAI serveur et une VRAIE base PostgreSQL : c'est la projection locale qu'on
 * soupçonne, et elle n'existe que quand un instantané réel a été appliqué.
 *
 * Usage :
 *   PORT=4196 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4196 node scripts/churn-instrumentation.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4196';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'churn-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Churn-Admin-Password-2026!';

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
const evenements = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
    evenements.push({ cycle: cycleCourant, type: evenement.type, detail: evenement.detail });
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

/* ---- Base locale, avec les opérations et le journal d'IndexedDB ---- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

let cycleCourant = 'préparation';
/** Chaque geste porté sur la base, avec l'endroit du code qui l'a demandé. */
const gestes = [];
/** L'état des magasins juste après CHAQUE transaction de remplacement. */
const apresTransaction = new Map();

const origine = () => {
  const pile = String(new Error().stack || '').split('\n').slice(2, 9);
  const cadre = pile.find(ligne => /replaceStoreAtomically|applySnapshot|saveSeedLocally|mirrorCentralVersion|coherentSave|saveWith/.test(ligne));
  return (cadre || pile[0] || '').trim().replace(/^at\s+/, '').split(' ')[0] || 'inconnu';
};

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = {
  objectStoreNames: { contains: () => true },
  transaction(nom) {
    const magasin = table(nom);
    const operations = [];
    const transaction = {
      objectStore: () => ({
        clear() {
          const appelant = origine();
          operations.push(() => {
            gestes.push({ cycle: cycleCourant, geste: 'clear', magasin: nom, taille: magasin.size, appelant });
            magasin.clear();
          });
        },
        put(enregistrement) {
          const appelant = origine();
          operations.push(() => {
            gestes.push({ cycle: cycleCourant, geste: 'put', magasin: nom, id: String(enregistrement.id), appelant });
            magasin.set(String(enregistrement.id), enregistrement);
          });
        },
        delete(id) {
          const appelant = origine();
          operations.push(() => {
            gestes.push({ cycle: cycleCourant, geste: 'delete', magasin: nom, id: String(id), appelant });
            magasin.delete(String(id));
          });
        },
        getAll() {
          const requete = { result: [...magasin.values()], onsuccess: null, onerror: null };
          queueMicrotask(() => requete.onsuccess?.());
          return requete;
        }
      }),
      oncomplete: null, onerror: null, onabort: null
    };
    queueMicrotask(() => queueMicrotask(() => {
      for (const operation of operations) operation();
      // L'état IMMÉDIATEMENT après le remplacement de ce magasin : c'est la colonne 4.
      apresTransaction.set(`${cycleCourant}|${nom}`, new Set(magasin.keys()));
      transaction.oncomplete?.();
    }));
    return transaction;
  }
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  gestes.push({ cycle: cycleCourant, geste: 'save', magasin: nom, id, appelant: origine() });
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = async (nom, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  gestes.push({ cycle: cycleCourant, geste: 'saveLocalOnly', magasin: nom, id, appelant: origine() });
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db._deleteRaw = async (nom, id) => {
  gestes.push({ cycle: cycleCourant, geste: 'deleteRaw', magasin: nom, id: String(id), appelant: origine() });
  table(nom).delete(String(id));
  return true;
};
db.delete = db._deleteRaw;

/* --------- Transport : le cookie que le navigateur joindrait seul --------- */

let cookie = '';
const ecrituresHttp = [];
globalThis.fetch = async (chemin, options = {}) => {
  const absolu = String(chemin).startsWith('http') ? String(chemin) : `${base}${chemin}`;
  const methode = options.method || 'GET';
  if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(methode)) ecrituresHttp.push({ cycle: cycleCourant, methode, cible: String(chemin).split('?')[0] });
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
 * L'ORDRE DE CES DEUX IMPORTS EST UNE DONNÉE DU PROBLÈME.
 *
 * `index.html` charge `central-sync.js` PUIS `catalog-seed-guard.js` : le garde est
 * l'enveloppe EXTÉRIEURE de `db.save`. Inversés, la sonde mesurerait une tempête qui
 * n'existe que dans la sonde — c'est déjà arrivé, quatre-vingt-onze écritures attribuées
 * au produit qui n'appartenaient qu'à l'instrument.
 */
await import('../central-sync.js');
await import('../catalog-seed-guard.js');

/*
 * UN MODULE DE RÉCONCILIATION RÉEL, PARCE QUE C'EST LUI QUI FAISAIT LES ~450 ENTITÉS.
 *
 * Onze modules écoutent `central-sync-status: synced` et réinstallent leur documentation.
 * Tant que le vidage autoritaire détruisait leurs fiches, chacun les ré-écrivait à chaque
 * cycle. En charger un vrai — celui de la Grille Centrale — permet de MESURER si la boucle
 * est fermée, au lieu d'en déduire qu'elle devrait l'être.
 */
const connaissance = await import('../grille-centrale-knowledge.js');

/* ------------------------------ La sonde ------------------------------ */

const CONTRAT = ['platform-entity-updated', 'platform-entity-deleted', 'platform-entity-diverged', 'platform-snapshot-applied'];

async function instantaneServeur() {
  const reponse = await vraiFetch(`${base}/api/sync`, { headers: { cookie } });
  return reponse.json();
}

/** Les fiches suivies : deux strictement locales, deux ensemencées, une centrale réelle. */
const SUIVIS = [];

function noter(magasin, id, origineFiche) {
  SUIVIS.push({ magasin, id: String(id), origine: origineFiche });
}

const presence = (magasin, id) => table(magasin).has(String(id));

async function cycle(nom) {
  cycleCourant = nom;
  const avant = SUIVIS.map(fiche => presence(fiche.magasin, fiche.id));
  const debutEvenements = evenements.length;
  const debutGestes = gestes.length;

  const charge = await instantaneServeur();
  await db.enableCentralSync({ bootstrapLocal: false });
  // La réconciliation que le signal `synced` déclenche dans un vrai navigateur. Ses
  // écritures — s'il en fait — sont comptées dans les gestes de ce cycle.
  await connaissance.ensureGrilleCentraleKnowledge().catch(() => {});

  const apres = SUIVIS.map(fiche => presence(fiche.magasin, fiche.id));
  const nouveaux = evenements.slice(debutEvenements);
  return {
    nom, avant, apres, charge,
    evenements: nouveaux,
    gestes: gestes.slice(debutGestes),
    duContrat: nouveaux.filter(entree => CONTRAT.includes(entree.type)),
    canoniques: nouveaux.filter(entree => entree.type === 'platform-canonical-data-changed')
  };
}

const oui = valeur => (valeur ? 'oui' : 'NON');

console.log('\n╔═══ d’où viennent les événements au repos ═══╗\n');

identite = null;
cookie = await connexion(adminUsername, adminPassword);
// `/api/auth/session` et non `/api/auth/me` : cette dernière n'existe pas, et l'interroger
// rendait une identité vide. Le garde du catalogue prenait alors le chemin « non-admin »,
// c'est-à-dire pas celui que le Runtime Gate a mesuré.
const moi = await (await vraiFetch(`${base}/api/auth/session`, { headers: { cookie } })).json();
const compte = moi?.user || moi;
identite = { id: compte?.id, username: compte?.username, role: compte?.role };
assert.ok(identite.role, `identité illisible depuis /api/auth/session : ${JSON.stringify(moi).slice(0, 200)}`);
console.log(`connecté : ${identite.username} (${identite.role})\n`);

/* ── Étape 1 : la base locale reçoit l'instantané, comme au premier démarrage ── */

cycleCourant = 'amorçage';
await db.enableCentralSync({ bootstrapLocal: false });
const chargeInitiale = await instantaneServeur();
const autoritaires = new Set(chargeInitiale?.authoritativeStores || []);
console.log(`magasins autoritaires : ${[...autoritaires].join(', ')}\n`);

/* ── Étape 2 : on pose les fiches suivies, chacune par son VRAI chemin ── */

// A · strictement locales — elles n'existent que sur ce poste, par construction.
await db.saveLocalOnly('settings', { id: 'current-room', currentRoomId: null, updatedAt: new Date().toISOString() });
await db.saveLocalOnly('settings', { id: 'map-image-cache', dataUrl: 'data:image/png;base64,AAAA', updatedAt: new Date().toISOString() });
noter('settings', 'current-room', 'préférence de poste (strictement locale)');
noter('settings', 'map-image-cache', 'octets du plan téléchargés une fois (strictement locale)');

// B · ensemencées — on passe par `db.save`, donc par le garde du catalogue, comme un
//     module d'ensemencement le ferait au démarrage.
await db.save('docs', { id: 'gc-in-001', kind: 'equipment_catalog', title: 'Entrée grille 001', origin: 'grille-centrale-seed' });
await db.save('docs', { id: 'kb-ultrix-fr', kind: 'equipment_catalog', title: 'Fiche Ultrix', origin: 'knowledge-seed' });
noter('docs', 'gc-in-001', 'ensemencement automatique retenu par catalog-seed-guard');
noter('docs', 'kb-ultrix-fr', 'ensemencement automatique retenu par catalog-seed-guard');

// C · une fiche centrale normale — prise dans l'instantané lui-même.
const magasinTemoin = ['rooms', 'equipments', 'users'].find(nom => (chargeInitiale?.data?.[nom] || []).length);
const temoin = chargeInitiale?.data?.[magasinTemoin]?.[0];
assert.ok(temoin, 'aucune fiche centrale disponible comme témoin');
noter(magasinTemoin, temoin.id, `fiche centrale réelle (${magasinTemoin})`);

console.log('fiches suivies :');
for (const fiche of SUIVIS) console.log(`  · ${fiche.magasin}/${fiche.id} — ${fiche.origine}`);
console.log('');

/* ── Étape 3 : trois cycles d'instantané, sans rien toucher entre-temps ── */

const cycles = [];
for (const nom of ['cycle-1', 'cycle-2', 'cycle-3']) cycles.push(await cycle(nom));

/* ------------------------------- Le tableau ------------------------------- */

console.log('┌─ TABLEAU DU CYCLE, par fiche suivie ─────────────────────────────────────┐\n');
const premier = cycles[0];
const donnees = premier.charge?.data || {};

console.log(
  'fiche'.padEnd(30)
  + '1.avant'.padEnd(9) + '2.snap'.padEnd(8) + '3.autor'.padEnd(9)
  + '4.aprTx'.padEnd(9) + '5.aprApp'.padEnd(10) + '6.reseed'.padEnd(10) + '7.événement'
);
console.log('─'.repeat(110));

for (const [index, fiche] of SUIVIS.entries()) {
  const cle = `${fiche.magasin}/${fiche.id}`;
  const dansSnapshot = (donnees[fiche.magasin] || []).some(enregistrement => String(enregistrement.id) === fiche.id);
  const apresTx = apresTransaction.get(`cycle-1|${fiche.magasin}`)?.has(fiche.id) ?? null;
  const evenement = premier.duContrat
    .filter(entree => entree.detail?.storeName === fiche.magasin && String(entree.detail?.id) === fiche.id)
    .map(entree => entree.type.replace('platform-entity-', ''))
    .join(', ') || '—';
  const reseed = premier.gestes.some(geste =>
    geste.magasin === fiche.magasin && String(geste.id) === fiche.id
    && ['save', 'saveLocalOnly'].includes(geste.geste));

  console.log(
    cle.padEnd(30)
    + oui(premier.avant[index]).padEnd(9)
    + oui(dansSnapshot).padEnd(8)
    + oui(autoritaires.has(fiche.magasin)).padEnd(9)
    + (apresTx === null ? 'n/a' : oui(apresTx)).padEnd(9)
    + oui(premier.apres[index]).padEnd(10)
    + oui(reseed).padEnd(10)
    + evenement
  );
}

console.log('\n└──────────────────────────────────────────────────────────────────────────┘\n');
console.log('8. origine : voir la liste des fiches suivies ci-dessus.\n');

/* ------------------------- Le bruit, cycle par cycle ------------------------- */

console.log('┌─ VOLUME PAR CYCLE ───────────────────────────────────────────────────────┐\n');
for (const passage of cycles) {
  const parType = new Map();
  for (const entree of passage.duContrat) parType.set(entree.type, (parType.get(entree.type) || 0) + 1);
  const detail = [...parType].map(([type, nombre]) => `${type.replace('platform-entity-', '')}=${nombre}`).join(' · ') || 'aucun';
  console.log(`${passage.nom} : ${passage.duContrat.length} événements du contrat (${detail})`
    + ` · ${passage.canoniques.length} canonical-data-changed`);

  const effacements = passage.gestes.filter(geste => geste.geste === 'clear');
  const ecrits = passage.gestes.filter(geste => geste.geste === 'put').length;
  const reecritures = passage.gestes.filter(geste => ['save', 'saveLocalOnly'].includes(geste.geste));
  console.log(`          ${effacements.length} effacement(s) de magasin, ${ecrits} écriture(s) locale(s), `
    + `${reecritures.length} ré-enregistrement(s)`);
  if (reecritures.length) {
    const parCible = new Map();
    for (const geste of reecritures) {
      const cle = `${geste.magasin}/${geste.id}`;
      parCible.set(cle, (parCible.get(cle) || 0) + 1);
    }
    console.log(`          ré-enregistrés : ${[...parCible].map(([cle, n]) => (n > 1 ? `${cle}×${n}` : cle)).slice(0, 12).join(', ')}`);
    const parAppelant = new Map();
    for (const geste of reecritures) parAppelant.set(geste.appelant, (parAppelant.get(geste.appelant) || 0) + 1);
    console.log(`          demandés par : ${[...parAppelant].map(([qui, n]) => `${qui}×${n}`).join(', ')}`);
  }
}
console.log('\n└──────────────────────────────────────────────────────────────────────────┘\n');

/* --------------------- Les fiches annoncées, par magasin --------------------- */

const dernier = cycles.at(-1);
const parMagasin = new Map();
for (const entree of dernier.duContrat) {
  if (!entree.detail?.storeName) continue;
  const cle = `${entree.detail.storeName} · ${entree.type.replace('platform-entity-', '')}`;
  if (!parMagasin.has(cle)) parMagasin.set(cle, []);
  parMagasin.get(cle).push(String(entree.detail.id));
}
if (parMagasin.size) {
  console.log('┌─ QUI EST ANNONCÉ AU DERNIER CYCLE (instantané pourtant identique) ───────┐\n');
  for (const [cle, identifiants] of [...parMagasin].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cle} : ${identifiants.length} — ex. ${identifiants.slice(0, 4).join(', ')}`);
  }
  console.log('\n└──────────────────────────────────────────────────────────────────────────┘\n');
}

console.log(`écritures HTTP pendant les trois cycles : ${ecrituresHttp.length}`);
console.log(`file d’attente : ${(await db.getAll('syncQueue')).length} entrée(s)\n`);

/*
 * LE VERDICT DOIT POUVOIR FAIRE ÉCHOUER L'INTÉGRATION (#164).
 *
 * Cette sonde se terminait par `process.exit(0)` quoi qu'elle ait trouvé : elle imprimait
 * « ❌ » et rendait 0. Une chaîne qui l'exécuterait resterait donc VERTE avec la boucle
 * revenue — c'est un diagnostic, pas une porte.
 *
 * Le dernier cycle applique un instantané IDENTIQUE, sans la moindre action utilisateur.
 * Après convergence, il ne doit donc produire ni événement du contrat, ni écriture locale,
 * ni ré-enregistrement, ni mutation réseau. Les cycles précédents restent libres : la
 * PREMIÈRE convergence a le droit d'écrire, et c'est même ce qui rend la mesure crédible.
 */
/*
 * UNE MESURE VIDE N'EST PAS UNE MESURE VERTE (#164).
 *
 * Premier passage en intégration : la sonde a rendu 0 avec cycle-1, cycle-2 et cycle-3
 * TOUS à zéro écriture, « Plan Grille Centrale refusé (not-found) » et zéro écriture
 * réseau. Elle ne mesurait rien — la session ne recevait presque aucun instantané — et
 * l'absence de churn n'y prouvait rien. C'est exactement le faux vert que cette porte est
 * censée empêcher.
 *
 * La porte exige donc d'abord d'avoir eu quelque chose À mesurer : un instantané non
 * trivial, et un consommateur qui a réellement pu travailler.
 */
const fichesInstantane = Object.values(dernier.charge?.data || {})
  .reduce((total, liste) => total + (Array.isArray(liste) ? liste.length : 0), 0);
const magasinsInstantane = Object.keys(dernier.charge?.data || {}).length;
console.log(`instantané mesuré : ${fichesInstantane} fiche(s) dans ${magasinsInstantane} magasin(s)`);

/*
 * Le signal qui distingue « converge et se tait » de « n'a rien fait du tout » n'est pas la
 * taille de l'instantané — une base neuve en a peu, légitimement — mais le TRAVAIL accompli
 * sur l'ensemble des cycles. Mesuré : un passage sain fait 16 gestes (15 ré-enregistrements
 * de première convergence, puis 1 écriture), le passage vide de l'intégration en faisait 0.
 */
const activiteTotale = cycles.reduce((total, passage) => total + passage.gestes.length, 0);
console.log(`travail observé sur les trois cycles : ${activiteTotale} geste(s) de base locale`);

if (activiteTotale === 0) {
  console.log('╚═══ ❌ MESURE VIDE — aucun geste de base sur les trois cycles ═══╝');
  console.log('   Rien n’a convergé : « aucune écriture au repos » ne prouve alors rien.');
  console.log('   Vérifier que la base contient des données et que le compte utilisé les voit.');
  process.exit(1);
}

const bruitDernierCycle = dernier.duContrat.length;
const ecrituresDernierCycle = dernier.gestes.filter(geste => ['put', 'save', 'saveLocalOnly', 'delete', 'clear'].includes(geste.geste));
const httpDernierCycle = ecrituresHttp.filter(entree => entree.cycle === dernier.nom);
const griefs = [];
if (bruitDernierCycle) griefs.push(`${bruitDernierCycle} événement(s) du contrat`);
if (ecrituresDernierCycle.length) griefs.push(`${ecrituresDernierCycle.length} écriture(s) locale(s)`);
if (httpDernierCycle.length) griefs.push(`${httpDernierCycle.length} mutation(s) réseau`);

if (!griefs.length) {
  console.log('╚═══ ✅ instantané identique → aucun événement, aucune écriture ═══╝\n');
  process.exit(0);
}

console.log(`╚═══ ❌ instantané identique → ${griefs.join(' · ')} ═══╝\n`);
if (ecrituresDernierCycle.length) {
  const parCible = new Map();
  for (const geste of ecrituresDernierCycle) {
    const cle = `${geste.magasin}/${geste.id}`;
    parCible.set(cle, (parCible.get(cle) || 0) + 1);
  }
  console.log('fiches réécrites alors que rien n’a changé :');
  for (const [cle, nombre] of [...parCible].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${nombre}× ${cle}`);
}
process.exit(1);
