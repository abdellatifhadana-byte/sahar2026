/**
 * @file scripts/concurrence-client-http-e2e.mjs — la chaîne entière, sans serveur simulé.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Les tests de `tests/concurrence-client-conflit.test.js` exécutent le vrai `central-sync.js`,
 * mais contre un serveur simulé. Ils prouvent que le client CONSTRUIT la bonne requête ; ils
 * ne prouvent pas que le serveur la COMPREND. Entre les deux il reste une convention — le
 * nom du paramètre, sa place dans l'URL, la façon dont il est analysé — et une convention
 * que personne ne traverse de bout en bout finit toujours par diverger.
 *
 * Ici, le module du navigateur parle à un VRAI serveur, sur une VRAIE base PostgreSQL.
 * Rien n'est mis en scène : la seule chose ajoutée autour de `fetch` est le transport —
 * le cookie de session, que le navigateur joindrait tout seul, et la résolution des URL
 * relatives. La méthode, le chemin et le paramètre viennent du code client tel quel.
 *
 * LE SCÉNARIO OBLIGATOIRE
 * -----------------------
 *   A lit la salle            → révision N
 *   A perd le réseau
 *   A clique Supprimer        → mise en attente, révision N retenue
 *   B modifie la salle        → révision N+1 côté serveur
 *   A retrouve le réseau      → la file rejoue la suppression avec N
 *   le serveur refuse         → 409, la version N+1 de B survit
 *   l'entrée devient terminale → plus aucun appel automatique ensuite
 *
 * Usage :
 *   PORT=4197 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4197 node scripts/concurrence-client-http-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4197';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'conc-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!';
const RUN = Date.now().toString(36);

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

const vraiFetch = globalThis.fetch;

/** Appel direct, hors client : c'est « l'autre session », celle qui modifie pendant la coupure. */
async function appel(chemin, { method = 'GET', cookie = '', body, attendu } = {}) {
  const reponse = await vraiFetch(`${base}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (attendu !== undefined) {
    assert.equal(reponse.status, attendu, `${method} ${chemin} : attendu ${attendu}, reçu ${reponse.status} — ${texte.slice(0, 240)}`);
  }
  return { statut: reponse.status, charge };
}

console.log(`\n╔═══ client réel → HTTP réel → PostgreSQL réel — ${base} ═══╗\n`);

/* ─────────────────── 1 · une session administrateur, hors client ─────────────────── */

const connexion = await vraiFetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: adminUsername, password: adminPassword })
});
assert.equal(connexion.status, 200, `connexion refusée (${connexion.status})`);
const cookie = connexion.headers.get('set-cookie')?.split(';')[0] || '';
assert.ok(cookie, 'aucune session rendue');

const zone = await appel('/api/access/zones', { method: 'POST', cookie, body: { name: `Zone client ${RUN}` }, attendu: 200 });
const ZONE = zone.charge?.zone?.id ?? zone.charge?.id;
const SALLE = `cli-salle-${RUN}`;
await appel(`/api/data/rooms/${SALLE}`, {
  method: 'PUT', cookie, body: { id: SALLE, name: 'Salle du client', zoneId: ZONE }, attendu: 200
});

const lire = async () => {
  const { charge } = await appel('/api/sync', { cookie, attendu: 200 });
  return (charge?.data?.rooms || []).find(salle => String(salle.id) === SALLE) || null;
};
const vueParA = await lire();
assert.ok(vueParA, 'la salle doit être visible dans l’instantané');
const REVISION_VUE_PAR_A = vueParA._revision;
verifier(`A lit la salle à la révision ${REVISION_VUE_PAR_A}`, Number(REVISION_VUE_PAR_A) > 0,
  JSON.stringify(REVISION_VUE_PAR_A));

/* ─────────────────── 2 · le navigateur, avec son transport ─────────────────── */

const statuts = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener() {},
  dispatchEvent(evenement) {
    if (evenement.type === 'central-sync-status') statuts.push(evenement.detail);
    return true;
  }
};
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
const memoire = new Map([['auth', JSON.stringify({ id: 1, username: adminUsername })]]);
globalThis.localStorage = {
  getItem: cle => (memoire.has(cle) ? memoire.get(cle) : null),
  setItem: (cle, valeur) => { memoire.set(cle, String(valeur)); },
  removeItem: cle => { memoire.delete(cle); }
};

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};
let compteur = 0;

const { db } = await import('../db.js');
db.open = async () => ({});
/*
 * UNE TRANSACTION SUR LA FILE, PARCE QUE LE REJEU EN DÉPEND.
 *
 * Le rejeu ne lit plus la file pour écrire ensuite : il RÉCLAME chaque entrée — lecture et
 * marquage dans une seule transaction `readwrite` — et c'est cette indivisibilité qui empêche
 * deux reprises d'envoyer la même opération. La base simulée doit donc offrir la garantie sur
 * laquelle le chemin réel s'appuie, sans quoi ce n'est plus le chemin réel qu'on éprouve.
 *
 * `objectStoreNames.contains` ne répond vrai que pour `syncQueue` : l'application d'un
 * instantané n'est pas l'objet de cette épreuve, et la laisser s'exécuter écraserait la base.
 */
const transactionSimulee = nom => {
  const donnees = table(nom);
  const transaction = { oncomplete: null, onerror: null, onabort: null };
  let enCours = 0;
  let achevee = false;
  const acheve = () => {
    if (achevee || enCours > 0) return;
    achevee = true;
    queueMicrotask(() => transaction.oncomplete?.());
  };
  const requete = executer => {
    const objet = { result: undefined, error: null, onsuccess: null, onerror: null };
    enCours += 1;
    queueMicrotask(() => {
      try { objet.result = executer(); objet.onsuccess?.(); }
      catch (erreur) { objet.error = erreur; objet.onerror?.(); }
      finally { enCours -= 1; acheve(); }
    });
    return objet;
  };
  transaction.objectStore = () => ({
    get: cle => requete(() => donnees.get(String(cle)) ?? undefined),
    put: valeur => requete(() => {
      const id = valeur?.id === '' || valeur?.id == null ? ++compteur : valeur.id;
      donnees.set(String(id), { ...valeur, id });
      return id;
    }),
    delete: cle => requete(() => { donnees.delete(String(cle)); return undefined; })
  });
  return transaction;
};
db.db = {
  objectStoreNames: { contains: nom => nom === 'syncQueue' },
  transaction: nom => transactionSimulee(nom)
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  const id = enregistrement?.id === '' || enregistrement?.id == null ? ++compteur : enregistrement.id;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };

// TRANSPORT SEULEMENT : le cookie que le navigateur joindrait de lui-même, et la
// résolution des URL relatives. La méthode, le chemin et les paramètres restent ceux que
// le code client compose — c'est précisément ce qu'on veut mettre à l'épreuve.
const requetes = [];
let horsLigne = false;
globalThis.fetch = async (chemin, options = {}) => {
  const absolu = String(chemin).startsWith('http') ? String(chemin) : `${base}${chemin}`;
  requetes.push({ chemin: String(chemin), methode: options.method || 'GET' });
  if (horsLigne) throw new TypeError('fetch failed');
  return vraiFetch(absolu, { ...options, headers: { ...(options.headers || {}), cookie } });
};

const vraiSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
await import('../central-sync.js');
globalThis.setInterval = vraiSetInterval;

const amorcage = await db.enableCentralSync();
assert.equal(amorcage.enabled, true, 'la synchronisation centrale doit être active');

/* ─────────────────── 3 · le scénario obligatoire ─────────────────── */
console.log('\n1 · suppression hors ligne contre modification concurrente');

// La copie locale de A, telle qu'elle serait après un instantané.
await db.saveLocalOnly('rooms', { ...vueParA });

horsLigne = true;
await db._deleteRaw('rooms', SALLE);
horsLigne = false;

const [enAttente] = await db.getAll('syncQueue');
verifier('la suppression hors ligne retient la révision du clic',
  enAttente?.action === 'delete' && Number(enAttente?.expectedRevision) === Number(REVISION_VUE_PAR_A),
  JSON.stringify({ action: enAttente?.action, expectedRevision: enAttente?.expectedRevision }));

// B modifie pendant la coupure.
await appel(`/api/data/rooms/${SALLE}`, {
  method: 'PUT', cookie, body: { ...vueParA, name: 'Modifiée par B' }, attendu: 200
});
const apresB = await lire();
verifier(`B fait avancer la révision (${REVISION_VUE_PAR_A} → ${apresB?._revision})`,
  Number(apresB?._revision) > Number(REVISION_VUE_PAR_A));

// A retrouve le réseau : la file rejoue.
requetes.length = 0;
statuts.length = 0;
await db.processSyncQueue();

const suppressionEmise = requetes.find(requete => requete.methode === 'DELETE');
verifier('la file a bien émis la suppression', Boolean(suppressionEmise),
  JSON.stringify(requetes));
const declaree = suppressionEmise
  ? new URL(suppressionEmise.chemin, base).searchParams.get('expectedRevision')
  : null;
verifier(`la suppression déclare la révision DU CLIC (${declaree})`,
  Number(declaree) === Number(REVISION_VUE_PAR_A),
  `attendu ${REVISION_VUE_PAR_A}, envoyé ${declaree}`);

const survivante = await lire();
verifier('la modification de B a SURVÉCU à la suppression périmée',
  survivante?.name === 'Modifiée par B',
  JSON.stringify(survivante));

const [apresRejeu] = await db.getAll('syncQueue');
verifier('l’entrée devient un conflit, pas une réussite ni une panne',
  apresRejeu?.status === 'conflict', JSON.stringify({ status: apresRejeu?.status, code: apresRejeu?.lastErrorCode }));
verifier('le message montré à l’utilisateur est en français et dit quoi faire',
  /modifi/i.test(String(statuts.at(-1)?.message || '')) && /recharg/i.test(String(statuts.at(-1)?.message || '')),
  String(statuts.at(-1)?.message || ''));

/* ─────────────────── 4 · et plus rien ne repart ─────────────────── */
console.log('\n2 · le conflit est terminal');

const tentatives = apresRejeu?.attempts;
requetes.length = 0;
statuts.length = 0;
await db.processSyncQueue();
await db.processSyncQueue();

const ecrivains = requetes.filter(requete => ['PUT', 'DELETE'].includes(requete.methode));
verifier('deux cycles de plus n’émettent AUCUN nouvel appel d’écriture',
  ecrivains.length === 0, JSON.stringify(ecrivains));
const [final] = await db.getAll('syncQueue');
verifier('le compteur de tentatives ne gonfle plus', final?.attempts === tentatives,
  `avant ${tentatives}, après ${final?.attempts}`);
verifier('aucune alerte répétée', statuts.length === 0, JSON.stringify(statuts));
verifier('la saisie et de quoi se resituer restent disponibles',
  final?.lastErrorCode === 'STALE_WRITE' && Number(final?.currentRevision) > 0,
  JSON.stringify({ code: final?.lastErrorCode, currentRevision: final?.currentRevision }));

console.log(`\n╚═══ ${echecs === 0 ? '✅ AUCUN ÉCHEC' : '❌ ' + echecs + ' ÉCHEC(S)'} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
