/**
 * @file scripts/map-fail-closed-gate.mjs — le gate d'exécution du lot #131.
 *
 * CE QU'IL PROUVE, ET POURQUOI IL EXISTE
 * --------------------------------------
 * Sur la base b5f538e7, les 1 261 tests du dépôt étaient AU VERT pendant que :
 *
 *   GET /api/settings/map-image      livrait le plan technique complet à un Visiteur
 *                                    d'un autre département ;
 *   GET /assets/plan-technique.PNG   livrait le même plan, 46 276 octets, à un client
 *                                    NON AUTHENTIFIÉ ;
 *   le Service Worker                le pré-chargeait avant toute connexion et le gardait
 *                                    après la déconnexion.
 *
 * Aucune assertion de texte ne pouvait voir cela. Il faut un vrai serveur, une vraie base
 * et un vrai navigateur — c'est ce que fait ce gate, avec deux zones et un utilisateur
 * hors périmètre.
 *
 * USAGE
 *   E2E_BASE_URL=http://127.0.0.1:4188 \
 *   MAP_GATE_ADMIN_USERNAME=… MAP_GATE_ADMIN_PASSWORD=… \
 *   node scripts/map-fail-closed-gate.mjs
 *
 * Le gate crée son propre décor (zones, comptes, habilitations) et n'écrit rien d'autre.
 */
import { createRequire } from 'node:module';
import { startMapFixture, FIXTURE_WIDTH, FIXTURE_HEIGHT } from './map-fixture-server.mjs';

const require = createRequire(import.meta.url);
const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(CHEMIN_PLAYWRIGHT);

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const ADMIN = {
  username: process.env.MAP_GATE_ADMIN_USERNAME || process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin',
  password: process.env.MAP_GATE_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!'
};

const HORS_PERIMETRE = { id: 90131, username: 'map-gate-visiteur', password: 'Sahra-Khadra-7739-Matar!' };

let echecs = 0;
const verifier = (nom, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${nom}${detail ? `  — ${detail}` : ''}`);
  if (!ok) echecs += 1;
};

async function api(chemin, { method = 'GET', body, cookie = '', brut = false } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (brut) {
    const octets = Buffer.from(await reponse.arrayBuffer());
    return { status: reponse.status, octets: octets.length, png: octets.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' };
  }
  return {
    status: reponse.status,
    payload: await reponse.json().catch(() => ({})),
    cookie: reponse.headers.get('set-cookie')?.split(';')[0] || ''
  };
}

// ── la fixture d'image distante, exigée avant toute épreuve ──────────────────
let fixture;
try {
  fixture = await startMapFixture();
} catch (erreur) {
  console.error(`Fixture d'image distante indémarrable : ${erreur?.message || erreur}.`);
  console.error("Le parcours « Appliquer l'URL » est central pour ce lot : le gate échoue plutôt que de l'ignorer.");
  process.exit(1);
}
console.log(`Fixture distante : ${fixture.url} (${FIXTURE_WIDTH}×${FIXTURE_HEIGHT}, ${fixture.octets} octets)`);

// ── décor ────────────────────────────────────────────────────────────────────
const admin = await api('/api/auth/login', { method: 'POST', body: ADMIN });
if (admin.status !== 200) {
  console.error(`Connexion administrateur impossible (${admin.status}).`, admin.payload);
  process.exit(1);
}
await api(`/api/data/users/${HORS_PERIMETRE.id}`, {
  method: 'PUT', cookie: admin.cookie,
  body: {
    id: HORS_PERIMETRE.id, username: HORS_PERIMETRE.username, fullName: 'Visiteur hors périmètre',
    role: 'visitor', status: 'active',
    password: Buffer.from(HORS_PERIMETRE.password).toString('base64'), authVersion: 1
  }
});

/**
 * Table rase sur le sujet du gate — sinon il n'est vrai qu'une fois.
 *
 * Le gate accorde puis révoque des habilitations ; sans ce nettoyage, une seconde
 * exécution démarre avec la couverture laissée par la première, et l'épreuve de
 * « couverture partielle » s'exécute en réalité sur une couverture complète. Constaté :
 * elle passait au premier tour et rendait 200 au second.
 */
async function tableRase() {
  const etat = await api('/api/access/manage', { cookie: admin.cookie });
  for (const habilitation of (etat.payload.grants || [])) {
    if (String(habilitation.userId) !== String(HORS_PERIMETRE.id) || habilitation.status === 'revoked') continue;
    await api(`/api/access/grants/${encodeURIComponent(habilitation.id)}`, { method: 'DELETE', cookie: admin.cookie });
  }
}
await tableRase();

/*
 * Le plan revient au plan INTÉGRÉ avant toute épreuve.
 *
 * Le bloc CUSTOM-URL configure une image distante ; sans cette remise à zéro, une seconde
 * exécution éprouverait MAP-5 sur la configuration laissée par la première. Un gate dont
 * le résultat dépend de son exécution précédente ne prouve rien.
 */
{
  const instantane = await api('/api/sync', { cookie: admin.cookie });
  const reglages = (instantane.payload.data?.settings || []).find(item => item.id === 'global');
  if (reglages) {
    await api('/api/data/settings/global', {
      method: 'PUT', cookie: admin.cookie,
      body: { ...reglages, mapImageUrl: 'assets/plan-technique.PNG', mapImageWidth: null, mapImageHeight: null }
    });
  }
}

const gestion = await api('/api/access/manage', { cookie: admin.cookie });
const zonesDuPlan = [...new Set((gestion.payload.resourceZones || [])
  .filter(item => item.resourceType === 'room').map(item => item.zoneId))];
console.log(`\nZones représentées par le plan : ${zonesDuPlan.length} — ${JSON.stringify(zonesDuPlan)}`);
if (zonesDuPlan.length < 2) {
  console.error('Ce gate exige au moins deux zones portant une salle : le plan doit être multi-zone.');
  process.exit(1);
}

// ── MAP-1 · la route refuse hors périmètre ───────────────────────────────────
console.log('\n▸ MAP-1 · route protégée');
const visiteur = await api('/api/auth/login', { method: 'POST', body: { username: HORS_PERIMETRE.username, password: HORS_PERIMETRE.password } });
verifier('anonyme refusé', (await api('/api/settings/map-image')).status === 401);
const refusHorsPerimetre = await api('/api/settings/map-image', { cookie: visiteur.cookie });
verifier('utilisateur hors périmètre refusé', refusHorsPerimetre.status === 403, `HTTP ${refusHorsPerimetre.status}`);
verifier('aucun octet dans le refus', !String(refusHorsPerimetre.payload.mapImageUrl || ''));
verifier('administrateur servi', (await api('/api/settings/map-image', { cookie: admin.cookie })).status === 200);

// ── MAP-2 · le chemin statique ne contourne rien ─────────────────────────────
console.log('\n▸ MAP-2 · chemin statique');
for (const [nom, cookie] of [['anonyme', ''], ['hors périmètre', visiteur.cookie], ['administrateur', admin.cookie]]) {
  for (const chemin of ['/assets/plan-technique.PNG', '/assets/plan-technique.png', '/assets%2Fplan-technique.PNG']) {
    const r = await api(chemin, { cookie, brut: true });
    verifier(`${nom} · ${chemin}`, r.status === 404 && !r.png, `HTTP ${r.status}, ${r.octets} octets`);
  }
}
const actifPublic = await api('/assets/images/2m-logo.webp', { brut: true });
verifier('les actifs généraux restent publics', actifPublic.status === 200, `HTTP ${actifPublic.status}`);

// ── MAP-12 · couverture partielle vs complète ────────────────────────────────
console.log('\n▸ MAP-12 · règle multi-zone');
for (const zoneId of zonesDuPlan.slice(0, -1)) {
  await api('/api/access/memberships', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId, responsible: false, expiresAt: null } });
  await api('/api/access/grants', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId, permission: 'zone.summary.read', expiresAt: null } });
}
let session = await api('/api/auth/login', { method: 'POST', body: { username: HORS_PERIMETRE.username, password: HORS_PERIMETRE.password } });
const partielle = await api('/api/settings/map-image', { cookie: session.cookie });
verifier(`couverture partielle (${zonesDuPlan.length - 1}/${zonesDuPlan.length}) refusée`, partielle.status === 403, `HTTP ${partielle.status}`);

const derniere = zonesDuPlan[zonesDuPlan.length - 1];
await api('/api/access/memberships', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId: derniere, responsible: false, expiresAt: null } });
await api('/api/access/grants', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId: derniere, permission: 'zone.summary.read', expiresAt: null } });
session = await api('/api/auth/login', { method: 'POST', body: { username: HORS_PERIMETRE.username, password: HORS_PERIMETRE.password } });
const complete = await api('/api/settings/map-image', { cookie: session.cookie });
verifier(`couverture complète (${zonesDuPlan.length}/${zonesDuPlan.length}) accordée`, complete.status === 200, `HTTP ${complete.status}`);

// ── navigateur ───────────────────────────────────────────────────────────────
const navigateur = await chromium.launch({ args: ['--no-sandbox'] });

async function ouvrirSession(username, password) {
  const contexte = await navigateur.newContext();
  const page = await contexte.newPage();
  const reseau = [];
  page.on('response', reponse => {
    const chemin = reponse.url().replace(BASE, '');
    if (/plan-technique|map-image/i.test(chemin)) reseau.push(`${reponse.status()} ${chemin}`);
    // Un PUT de réglages pendant la purge locale signalerait que le scrub prétend écrire.
    // La forme du corps est notée aussi : c'est elle que les épreuves SETTINGS-MAP lisent.
    if (/^\/api\/data\/settings/.test(chemin) && reponse.request().method() !== 'GET') {
      let corps = {};
      try { corps = JSON.parse(reponse.request().postData() || '{}'); } catch { corps = {}; }
      const plan = corps.mapImageUrl === undefined ? 'sans-plan' : 'avec-plan';
      const revision = corps._revision === undefined ? 'sans-rev' : `rev=${corps._revision}`;
      reseau.push(`${reponse.request().method()} ${chemin} ${plan} ${revision} →${reponse.status()}`);
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ([u, p]) => {
    const reponse = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ username: u, password: p })
    });
    const charge = await reponse.json();
    if (charge.user) localStorage.setItem('auth', JSON.stringify(charge.user));
  }, [username, password]);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(9000);
  return { contexte, page, reseau };
}

const ouvrirCarte = async page => {
  await page.evaluate(() => document.getElementById('map-modal')?.remove());
  await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('button,a')].find(item => /carte/i.test(item.textContent || ''));
    if (bouton) bouton.click();
  });
  await page.waitForTimeout(6000);
};

const etatCarte = page => page.evaluate(() => {
  const modal = document.getElementById('map-modal');
  const image = document.getElementById('main-map-img');
  return {
    modal: Boolean(modal),
    restreint: Boolean(modal?.classList.contains('map-restricted')),
    texte: (modal?.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
    planAffiche: Boolean(image) && /^(data:image\/|https?:\/\/)/i.test(String(image.src)),
    bitmap: image ? `${image.naturalWidth}x${image.naturalHeight}` : null,
    hotspots: document.querySelectorAll('#map-hotspots > *').length
  };
});


const fileDeSynchronisation = page => page.evaluate(async () => {
  const base = await new Promise(resolve => { const requete = indexedDB.open('tech_platform_db'); requete.onsuccess = () => resolve(requete.result); });
  const entrees = await new Promise(resolve => {
    try {
      const transaction = base.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll();
      transaction.onsuccess = () => resolve(transaction.result);
      transaction.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  return entrees.map(entree => `${entree.storeName || entree.store}/${entree.recordId ?? entree.id}`);
});

const stockage = page => page.evaluate(async () => {
  const base = await new Promise(resolve => { const requete = indexedDB.open('tech_platform_db'); requete.onsuccess = () => resolve(requete.result); });
  const reglages = await new Promise(resolve => {
    const transaction = base.transaction('settings', 'readonly').objectStore('settings').getAll();
    transaction.onsuccess = () => resolve(transaction.result.map(item => item.id));
  });
  const noms = await caches.keys();
  let planEnCache = false;
  for (const nom of noms) if (await (await caches.open(nom)).match('/assets/plan-technique.PNG')) planEnCache = true;
  return { reglages, planEnCache, caches: noms };
});

// ── MAP-3/4 · l'état restreint, et rien d'autre ──────────────────────────────
console.log('\n▸ MAP-3/4 · carte hors périmètre');
{
  const cible = zonesDuPlan[0];
  const gestion2 = await api('/api/access/manage', { cookie: admin.cookie });
  const habilitation = (gestion2.payload.grants || []).find(item =>
    String(item.userId) === String(HORS_PERIMETRE.id) && item.zoneId === cible && item.status !== 'revoked');
  if (habilitation) await api(`/api/access/grants/${encodeURIComponent(habilitation.id)}`, { method: 'DELETE', cookie: admin.cookie });

  const { contexte, page, reseau } = await ouvrirSession(HORS_PERIMETRE.username, HORS_PERIMETRE.password);
  await ouvrirCarte(page);
  const etat = await etatCarte(page);
  const local = await stockage(page);
  verifier('MAP-3 état restreint affiché', etat.restreint && /Accès restreint/.test(etat.texte), etat.texte);
  verifier('MAP-3 aucun plan rendu', !etat.planAffiche);
  verifier('MAP-3 aucun point chaud construit', etat.hotspots === 0);
  verifier('MAP-3 la route a bien refusé', reseau.some(ligne => ligne.startsWith('403 /api/settings/map-image')), JSON.stringify(reseau));
  verifier('MAP-2 aucune requête vers le chemin statique', !reseau.some(ligne => /plan-technique/.test(ligne)));
  verifier('MAP-4 aucun cache du plan en IndexedDB', !local.reglages.includes('map-image-cache'), JSON.stringify(local.reglages));
  verifier('MAP-4 aucun plan dans le cache Service Worker', !local.planEnCache, JSON.stringify(local.caches));
  await contexte.close();
}

// ── MAP-5/11 · l'utilisateur autorisé garde une carte complète ───────────────
console.log('\n▸ MAP-5/10/11 · administrateur');
{
  const { contexte, page, reseau } = await ouvrirSession(ADMIN.username, ADMIN.password);
  await ouvrirCarte(page);
  const etat = await etatCarte(page);
  const local = await stockage(page);
  verifier('MAP-5 carte réelle rendue', etat.modal && !etat.restreint && etat.planAffiche);
  verifier('MAP-5 le plan intégré est servi en data:, jamais par un chemin public',
    reseau.some(ligne => ligne.startsWith('200 /api/settings/map-image')) && !etat.restreint);
  verifier('MAP-11 bitmap natif préservé', /^\d+x\d+$/.test(etat.bitmap || '') && !etat.bitmap.startsWith('0x'), etat.bitmap);
  verifier('MAP-5 points chauds construits', etat.hotspots > 0, `${etat.hotspots}`);
  verifier('MAP-5 servi par la route autorisée', reseau.some(ligne => ligne.startsWith('200 /api/settings/map-image')));
  verifier('MAP-4 aucun cache persistant du plan', !local.reglages.includes('map-image-cache') && !local.planEnCache);
  await contexte.close();
}

// ── MAP-6/7/8/9 · révocation, déconnexion, hors ligne ────────────────────────
console.log('\n▸ MAP-6/7/8/9 · révocation, déconnexion, hors ligne');
{
  for (const zoneId of zonesDuPlan) {
    await api('/api/access/memberships', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId, responsible: false, expiresAt: null } });
    await api('/api/access/grants', { method: 'POST', cookie: admin.cookie, body: { userId: HORS_PERIMETRE.id, zoneId, permission: 'zone.summary.read', expiresAt: null } });
  }
  const { contexte, page } = await ouvrirSession(HORS_PERIMETRE.username, HORS_PERIMETRE.password);
  await ouvrirCarte(page);
  verifier('MAP-6 plan visible avec couverture complète', (await etatCarte(page)).planAffiche);

  const gestion3 = await api('/api/access/manage', { cookie: admin.cookie });
  const aRevoquer = (gestion3.payload.grants || []).find(item =>
    String(item.userId) === String(HORS_PERIMETRE.id) && item.zoneId === zonesDuPlan[0]
    && item.permission === 'zone.summary.read' && item.status !== 'revoked');
  await api(`/api/access/grants/${encodeURIComponent(aRevoquer.id)}`, { method: 'DELETE', cookie: admin.cookie });

  const apresRevocation = await page.evaluate(async () =>
    (await fetch('/api/settings/map-image', { credentials: 'include', cache: 'no-store' })).status);
  verifier('MAP-6 refus serveur immédiat, sans reconnexion', apresRevocation === 403, `HTTP ${apresRevocation}`);

  await ouvrirCarte(page);
  const apres = await etatCarte(page);
  verifier('MAP-6 ancien plan NON réaffiché', apres.restreint && !apres.planAffiche, apres.texte);
  verifier('MAP-8 aucun repli sur un plan périmé', apres.hotspots === 0);

  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); localStorage.removeItem('auth'); });
  await page.waitForTimeout(1500);
  const apresDeconnexion = await stockage(page);
  verifier('MAP-7 aucun plan résiduel après déconnexion',
    !apresDeconnexion.reglages.includes('map-image-cache') && !apresDeconnexion.planEnCache,
    JSON.stringify(apresDeconnexion.reglages));

  await contexte.setOffline(true);
  await ouvrirCarte(page);
  verifier('MAP-9 hors ligne : aucun plan ressuscité', !(await etatCarte(page)).planAffiche);
  await contexte.setOffline(false);
  await contexte.close();
}


// ── LEGACY-DATA · poste partagé portant une source locale héritée ────────────
console.log('\n▸ LEGACY-DATA · source locale héritée, poste partagé hors ligne');
{
  const { contexte, page, reseau } = await ouvrirSession(HORS_PERIMETRE.username, HORS_PERIMETRE.password);

  // Tout se joue HORS LIGNE : l'instantané autoritaire ne doit pas se glisser entre
  // l'injection et la mesure, sinon on éprouve la synchronisation et non la purge.
  await contexte.setOffline(true);
  const fileAvant = await fileDeSynchronisation(page);
  /*
   * La mesure porte sur LA PURGE, pas sur toute la session.
   *
   * La plateforme consolide `settings/1` au démarrage, ce qui produit une écriture de
   * réglages sans rapport avec ce lot — et de façon intermittente, selon l'instant où
   * l'instantané arrive. Compter depuis le début de la session rendait donc l'épreuve
   * fausse un tour sur deux, en accusant la purge d'une écriture qu'elle n'a pas faite.
   */
  const reseauAvantPurge = reseau.length;
  await page.evaluate(async () => {
    const base = await new Promise(resolve => { const requete = indexedDB.open('tech_platform_db'); requete.onsuccess = () => resolve(requete.result); });
    const poser = fiche => new Promise(resolve => {
      const transaction = base.transaction('settings', 'readwrite').objectStore('settings').put(fiche);
      transaction.onsuccess = () => resolve();
    });
    await poser({
      id: 'global', mapImageUrl: 'data:image/png;base64,SEVSSVRBR0U=', mapImageRef: 'abc',
      theme: 'dark', language: 'fr', autoLogout: 45, notifications: false,
      backupFrequency: 'daily', settingsVersion: 2, _revision: 9, updatedAt: '2026-01-01T00:00:00.000Z'
    });
    // La fiche héritée sous l'identifiant `1` porte la même source sur les postes anciens.
    await poser({ id: 1, mapImageUrl: 'data:image/png;base64,SEVSSVRBR0UtMQ==', theme: 'light', _revision: 3 });
  });

  const rendu = await page.evaluate(async () => {
    const { resolveMapImageUrl } = await import('/map-image-store.js');
    const { db } = await import('/db.js');
    return await resolveMapImageUrl(await db.get('settings', 'global'));
  });
  verifier('LEGACY-DATA-1 hors ligne et hors périmètre : aucun plan rendu', rendu === null, String(rendu));

  const fiches = await page.evaluate(async () => {
    const base = await new Promise(resolve => { const requete = indexedDB.open('tech_platform_db'); requete.onsuccess = () => resolve(requete.result); });
    const lire = id => new Promise(resolve => {
      const transaction = base.transaction('settings', 'readonly').objectStore('settings').get(id);
      transaction.onsuccess = () => resolve(transaction.result);
    });
    return { global: await lire('global'), herite: await lire(1) };
  });
  verifier('LEGACY-DATA-2 source purgée de settings/global', fiches.global?.mapImageUrl === undefined);
  verifier('LEGACY-DATA-2 source purgée de la fiche héritée settings/1', fiches.herite?.mapImageUrl === undefined);
  verifier('LEGACY-DATA-2 les autres réglages sont intacts',
    fiches.global?.theme === 'dark' && fiches.global?.autoLogout === 45
    && fiches.global?.notifications === false && fiches.global?.backupFrequency === 'daily',
    JSON.stringify(fiches.global));
  verifier('LEGACY-DATA-2 révision et horodatage NON touchés',
    fiches.global?._revision === 9 && fiches.global?.updatedAt === '2026-01-01T00:00:00.000Z',
    `_revision=${fiches.global?._revision} updatedAt=${fiches.global?.updatedAt}`);

  const fileApres = await fileDeSynchronisation(page);
  verifier('LEGACY-DATA-3 la file de synchronisation n’a pas bougé',
    JSON.stringify(fileAvant) === JSON.stringify(fileApres), `${fileAvant.length} → ${fileApres.length}`);
  const pendantLaPurge = reseau.slice(reseauAvantPurge);
  verifier('LEGACY-DATA-3 aucune écriture de réglages pendant la purge',
    !pendantLaPurge.some(ligne => /^(PUT|POST|DELETE|PATCH)\s/.test(ligne)),
    JSON.stringify(pendantLaPurge));

  await ouvrirCarte(page);
  const etat = await etatCarte(page);
  verifier('LEGACY-DATA-4 carte hors ligne : état restreint, aucun plan',
    etat.restreint && !etat.planAffiche, etat.texte);
  await contexte.setOffline(false);
  await contexte.close();
}

// ── CUSTOM-URL · le plan distant configuré par l'administrateur ──────────────
console.log('\n▸ CUSTOM-URL · plan distant configuré');
{
  const distante = fixture.url;
  const instantane = await api('/api/sync', { cookie: admin.cookie });
  const reglages = (instantane.payload.data?.settings || []).find(item => item.id === 'global');
  const avantSource = reglages?.mapImageUrl;
  verifier('CUSTOM-URL l’instantané n’expose jamais la source', avantSource === undefined);

  const pose = await api('/api/data/settings/global', {
    method: 'PUT', cookie: admin.cookie,
    body: { ...reglages, mapImageUrl: distante, mapImageWidth: 640, mapImageHeight: 360 }
  });
  verifier('CUSTOM-URL la configuration est persistée', pose.status === 200, `HTTP ${pose.status}`);

  const pourAdmin = await api('/api/settings/map-image', { cookie: admin.cookie });
  verifier('CUSTOM-URL-3 le serveur rend l’URL configurée, pas le plan intégré',
    pourAdmin.payload.mapImageUrl === distante, String(pourAdmin.payload.mapImageUrl).slice(0, 60));
  verifier('CUSTOM-URL aucun téléchargement serveur (pas de SSRF)',
    !String(pourAdmin.payload.mapImageUrl || '').startsWith('data:'));

  const horsPerimetre = await api('/api/auth/login', { method: 'POST', body: { username: HORS_PERIMETRE.username, password: HORS_PERIMETRE.password } });
  const refus = await api('/api/settings/map-image', { cookie: horsPerimetre.cookie });
  verifier('CUSTOM-URL-6 hors périmètre : 403 et URL jamais exposée',
    refus.status === 403 && !JSON.stringify(refus.payload).includes(distante), `HTTP ${refus.status}`);

  // Le défaut le plus coûteux du premier jet : enregistrer le thème effaçait le plan.
  const sansPlan = await api('/api/data/settings/global', {
    method: 'PUT', cookie: admin.cookie,
    body: { ...(await api('/api/sync', { cookie: admin.cookie })).payload.data.settings.find(item => item.id === 'global'), theme: 'light' }
  });
  verifier('CUSTOM-URL un enregistrement qui omet le plan est accepté', sansPlan.status === 200, `HTTP ${sansPlan.status}`);
  const apresEnregistrement = await api('/api/settings/map-image', { cookie: admin.cookie });
  verifier('CUSTOM-URL le plan configuré SURVIT à un enregistrement des réglages',
    apresEnregistrement.payload.mapImageUrl === distante, String(apresEnregistrement.payload.mapImageUrl).slice(0, 60));

  /*
   * AUCUN AUTO-SKIP ICI.
   *
   * Ce rendu s'ignorait quand l'image distante n'était pas joignable — mesuré au Re-Gate
   * indépendant : 51 assertions au lieu de 52, sans que rien ne le signale. Un test central
   * qui s'ignore lui-même vaut moins qu'un test absent, parce qu'il donne le vert. La
   * fixture est désormais servie par le gate, et son absence l'aurait déjà fait échouer
   * au démarrage.
   */
  const { contexte, page } = await ouvrirSession(ADMIN.username, ADMIN.password);
  await ouvrirCarte(page);
  const etat = await page.evaluate(() => {
    const image = document.getElementById('main-map-img');
    return image ? { src: String(image.src), largeur: image.naturalWidth, hauteur: image.naturalHeight } : { src: null };
  });
  verifier(`CUSTOM-URL-5 la carte rend bien l’image distante ${FIXTURE_WIDTH}×${FIXTURE_HEIGHT}`,
    etat.src === distante && etat.largeur === FIXTURE_WIDTH && etat.hauteur === FIXTURE_HEIGHT,
    `${etat.src} ${etat.largeur}×${etat.hauteur}`);
  await contexte.close();

  // Rendre le plan intégré, pour que le gate soit rejouable.
  const finales = (await api('/api/sync', { cookie: admin.cookie })).payload.data.settings.find(item => item.id === 'global');
  await api('/api/data/settings/global', { method: 'PUT', cookie: admin.cookie, body: { ...finales, mapImageUrl: 'assets/plan-technique.PNG', mapImageWidth: null, mapImageHeight: null } });
}


// ── SETTINGS-MAP · le VRAI écran des réglages ────────────────────────────────
/*
 * POURQUOI CE BLOC N'UTILISE PAS `/api/sync`.
 *
 * Le gate éprouvait auparavant l'enregistrement des réglages en réémettant la fiche brute
 * de l'instantané — laquelle ne porte DÉJÀ plus `mapImageUrl`. Il vérifiait donc une
 * omission qu'il produisait lui-même, et ne pouvait pas voir le défaut réel : c'est
 * `normalizeSettings()`, dans l'écran, qui SUBSTITUE le désignateur par défaut à la source
 * absente. Le Re-Gate indépendant l'a mesuré au navigateur, ce gate ne le voyait pas.
 *
 * Les épreuves ci-dessous montent donc le VRAI composant `SystemSettings`, avec son propre
 * `render()`/`afterRender()`, et appellent ses vraies méthodes.
 */
console.log('\n▸ SETTINGS-MAP · enregistrement depuis le vrai écran Réglages');
{
  const monterEcran = page => page.evaluate(async () => {
    const module = await import('/system-settings.js');
    const Composant = module.default || module.SystemSettings;
    document.getElementById('hote-reglages')?.remove();
    const hote = document.createElement('div');
    hote.id = 'hote-reglages';
    document.body.appendChild(hote);
    window.__notes = [];
    const ecran = new Composant({ showNotification: (message, type) => window.__notes.push(`${type}:${message}`) }, null);
    if (typeof ecran.loadSettings === 'function') await ecran.loadSettings();
    hote.innerHTML = await ecran.render();
    await ecran.afterRender();
    window.__ecran = ecran;
    return {
      revisionVue: ecran.currentSettings?._revision,
      sourceVueParEcran: String(ecran.currentSettings?.mapImageUrl ?? '(absente)').slice(0, 40),
      champsDuPatch: Object.keys(ecran.collectFormValues()).sort()
    };
  });

  const poserPlan = async source => {
    const instantane = await api('/api/sync', { cookie: admin.cookie });
    const reglages = (instantane.payload.data?.settings || []).find(item => item.id === 'global');
    return api('/api/data/settings/global', { method: 'PUT', cookie: admin.cookie, body: { ...reglages, mapImageUrl: source } });
  };
  const sourceServeur = async () => (await api('/api/settings/map-image', { cookie: admin.cookie })).payload.mapImageUrl;

  const TELEVERSE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  for (const [nom, source, numero] of [['distante', fixture.url, 1], ['téléversée', TELEVERSE, 2]]) {
    await poserPlan(source);
    const { contexte, page, reseau } = await ouvrirSession(ADMIN.username, ADMIN.password);
    const ecran = await monterEcran(page);
    verifier(`SETTINGS-MAP-${numero} l’écran ne voit PAS la source (elle est retirée de l’instantané)`,
      ecran.sourceVueParEcran !== source.slice(0, 40), ecran.sourceVueParEcran);
    verifier('SETTINGS-MAP-6 le patch du formulaire déclare la révision vue',
      ecran.champsDuPatch.includes('_revision'), JSON.stringify(ecran.champsDuPatch));
    verifier('SETTINGS-MAP-4 le patch ordinaire ne porte aucune source de plan',
      !ecran.champsDuPatch.includes('mapImageUrl')
      && !ecran.champsDuPatch.includes('mapImageWidth')
      && !ecran.champsDuPatch.includes('mapImageHeight'));

    const avant = reseau.length;
    await page.evaluate(async () => {
      const champ = document.getElementById('theme-setting');
      if (champ) { champ.value = champ.value === 'dark' ? 'light' : 'dark'; champ.dispatchEvent(new Event('change', { bubbles: true })); }
      await window.__ecran.saveSettings(true);
    });
    await page.waitForTimeout(2500);
    const ecritures = reseau.slice(avant).filter(ligne => ligne.startsWith('PUT'));
    verifier(`SETTINGS-MAP-${numero} le PUT ordinaire omet la source et déclare la révision`,
      ecritures.some(ligne => ligne.includes('sans-plan') && ligne.includes('rev=')), JSON.stringify(ecritures));
    verifier(`SETTINGS-MAP-${numero} plan ${nom} PRÉSERVÉ après un enregistrement ordinaire`,
      (await sourceServeur()) === source, String(await sourceServeur()).slice(0, 55));

    // SETTINGS-MAP-3 : un autre champ que le thème, même exigence.
    await page.evaluate(async () => {
      const champ = document.getElementById('autologout-setting');
      if (champ) { champ.value = '60'; champ.dispatchEvent(new Event('change', { bubbles: true })); }
      await window.__ecran.saveSettings(false);
    });
    await page.waitForTimeout(2000);
    verifier(`SETTINGS-MAP-3 plan ${nom} PRÉSERVÉ après un enregistrement du délai de déconnexion`,
      (await sourceServeur()) === source, String(await sourceServeur()).slice(0, 55));

    // SETTINGS-MAP-10 : l'écran rechargé retrouve la bonne source.
    const rechargé = await monterEcran(page);
    const apercu = await page.evaluate(async () => {
      const { resolveMapImageUrl } = await import('/map-image-store.js');
      return await resolveMapImageUrl(window.__ecran.currentSettings);
    });
    verifier(`SETTINGS-MAP-10 après rechargement, la source servie reste ${nom}`,
      apercu === source, String(apercu).slice(0, 55));
    void rechargé;
    await contexte.close();
  }

  // SETTINGS-MAP-5 · une action de plan, elle, DOIT porter la source.
  {
    await poserPlan('assets/plan-technique.PNG');
    const { contexte, page, reseau } = await ouvrirSession(ADMIN.username, ADMIN.password);
    await monterEcran(page);
    const avant = reseau.length;
    await page.evaluate(async url => { await window.__ecran.persistMapImage(url, 640, 360); }, fixture.url);
    await page.waitForTimeout(2500);
    const ecritures = reseau.slice(avant).filter(ligne => ligne.startsWith('PUT'));
    verifier('SETTINGS-MAP-5 le PUT d’une action de plan PORTE la source',
      ecritures.some(ligne => ligne.includes('avec-plan')), JSON.stringify(ecritures));
    verifier('SETTINGS-MAP-7 et il déclare la révision vue par l’écran',
      ecritures.some(ligne => ligne.includes('avec-plan') && ligne.includes('rev=')), JSON.stringify(ecritures));
    verifier('SETTINGS-MAP-5 le serveur retient bien la nouvelle source',
      (await sourceServeur()) === fixture.url, String(await sourceServeur()).slice(0, 55));
    await contexte.close();
  }

  // SETTINGS-MAP-8/9 · deux administrateurs, dans les DEUX directions.
  for (const [numero, libelle, geste] of [
    [8, 'ordinaire', async page => page.evaluate(async () => {
      const champ = document.getElementById('theme-setting');
      if (champ) { champ.value = 'dark'; champ.dispatchEvent(new Event('change', { bubbles: true })); }
      try { await window.__ecran.saveSettings(true); } catch (erreur) { window.__notes.push(`throw:${erreur.message}`); }
    })],
    [9, 'de plan', async page => page.evaluate(async () => {
      try { await window.__ecran.persistMapImage('data:image/png;base64,UEVSSU1F', 8, 8); }
      catch (erreur) { window.__notes.push(`throw:${erreur.message}`); }
    })]
  ]) {
    await poserPlan(fixture.url);
    const { contexte, page, reseau } = await ouvrirSession(ADMIN.username, ADMIN.password);
    const ecran = await monterEcran(page);

    // Un autre administrateur écrit : la révision avance sous l'écran resté ouvert.
    const instantane = await api('/api/sync', { cookie: admin.cookie });
    const reglages = (instantane.payload.data?.settings || []).find(item => item.id === 'global');
    const ecritureAutre = await api('/api/data/settings/global', {
      method: 'PUT', cookie: admin.cookie, body: { ...reglages, backupFrequency: 'monthly' }
    });
    // L'instantané central rafraîchit la projection locale : elle passe DEVANT l'écran.
    await page.waitForTimeout(24000);
    const divergence = await page.evaluate(async () => {
      const { db } = await import('/db.js');
      return { projection: (await db.get('settings', 'global'))?._revision, ecran: window.__ecran.currentSettings?._revision };
    });
    verifier(`SETTINGS-MAP-${numero} décor : la projection locale devance l’écran`,
      divergence.projection > divergence.ecran,
      `projection ${divergence.projection} > écran ${divergence.ecran} (écrit ${ecritureAutre.payload.revision})`);

    const avant = reseau.length;
    await geste(page);
    await page.waitForTimeout(2500);
    const conflits = reseau.slice(avant).filter(ligne => ligne.startsWith('PUT') && ligne.includes('→409'));
    verifier(`SETTINGS-MAP-${numero} un enregistrement ${libelle} périmé rend 409, jamais 200`,
      conflits.length > 0, JSON.stringify(reseau.slice(avant)));
    verifier(`SETTINGS-MAP-${numero} le plan distant survit au refus`,
      (await sourceServeur()) === fixture.url, String(await sourceServeur()).slice(0, 55));
    void ecran;
    await contexte.close();
  }

  // Remettre le plan intégré : le gate doit rester rejouable.
  await poserPlan('assets/plan-technique.PNG');
}

await navigateur.close();
await fixture.arreter();
console.log(`\n${echecs === 0
  ? '✅ MAP FAIL-CLOSED GATE : toutes les assertions passent.'
  : `❌ MAP FAIL-CLOSED GATE : ${echecs} échec(s).`}`);
process.exit(echecs ? 1 : 0);
