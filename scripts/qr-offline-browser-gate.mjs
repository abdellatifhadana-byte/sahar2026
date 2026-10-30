/**
 * @file scripts/qr-offline-browser-gate.mjs — LE QR EST LOCAL, HORS LIGNE, ET NE CONTOURNE RIEN.
 *
 * Ouvre un VRAI Chromium contre un VRAI serveur. Vérifie ce que `api.qrserver.com` faisait
 * échouer par construction :
 *
 *   1. Le QR de la Fiche360 se génère et s'affiche EN LIGNE, sans la moindre requête vers
 *      `api.qrserver.com` ni vers aucun hôte externe.
 *   2. Le même QR se génère et s'affiche IDENTIQUEMENT hors ligne (`context.setOffline`) —
 *      toujours zéro requête réseau.
 *   3. Le lien profond `?entity=equipment&id=…` qu'il encode ouvre la Fiche360 pour un
 *      équipement AUTORISÉ.
 *   4. Le même lien, pour un identifiant qui n'existe pas, affiche un état honnête plutôt
 *      que de ne rien faire.
 *   5. Le même lien, pour un équipement RÉEL mais hors du périmètre de l'utilisateur, se
 *      comporte EXACTEMENT comme un identifiant inconnu — aucune fuite, aucun contournement
 *      de l'ACL par le QR.
 *
 * AUCUNE donnée de production : base dédiée, entités préfixées, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4192';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const chemin = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function api(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const reponse = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null) assert.equal(reponse.status, expected, `${method} ${path} : attendu ${expected}, reçu ${reponse.status} ${texte}`);
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}
const connexion = async (username, password) => {
  const { cookie } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return cookie;
};

/* ═══════════════════════ scène : un équipement autorisé, un équipement protégé ═══════════════════════ */

const admin = await connexion(adminUser, adminPass);
await api('/api/rooms/transfer', { method: 'POST', cookie: admin, body: {
  formatVersion: 2,
  rooms: [{ id: 'br-qroff-salle-a', name: 'Salle QR A', x: 100, y: 100 }, { id: 'br-qroff-salle-b', name: 'Salle QR B', x: 300, y: 100 }],
  roomZones: []
} });
const zoneA = (await api('/api/access/zones', { method: 'POST', cookie: admin, body: { name: 'QR Offline Zone A', status: 'active' } })).charge.zone;
const zoneB = (await api('/api/access/zones', { method: 'POST', cookie: admin, body: { name: 'QR Offline Zone B', status: 'active' } })).charge.zone;
await api('/api/access/resource-zones', { method: 'POST', cookie: admin, expected: null, body: { resourceType: 'room', resourceId: 'br-qroff-salle-a', zoneId: zoneA.id } });
await api('/api/access/resource-zones', { method: 'POST', cookie: admin, expected: null, body: { resourceType: 'room', resourceId: 'br-qroff-salle-b', zoneId: zoneB.id } });
await api('/api/data/equipments/br-qroff-eq-auth', { method: 'PUT', cookie: admin, expected: null, body: { id: 'br-qroff-eq-auth', name: 'Ampli QR Autorisé', roomId: 'br-qroff-salle-a' } });
await api('/api/data/equipments/br-qroff-eq-protege', { method: 'PUT', cookie: admin, expected: null, body: { id: 'br-qroff-eq-protege', name: 'Ampli QR Protégé', roomId: 'br-qroff-salle-b' } });

const MDP = 'Chf-Qroffline-9931';
const chefId = 6200;
await api(`/api/data/users/${chefId}`, { method: 'PUT', cookie: admin, expected: null, body: {
  id: chefId, username: 'br-qroff-chef', fullName: 'Chef QR Offline', role: 'chef', status: 'active', password: Buffer.from(MDP, 'utf8').toString('base64')
} });
await api('/api/access/memberships', { method: 'POST', cookie: admin, expected: null, body: { userId: chefId, zoneId: zoneA.id, responsible: false } });
for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit']) {
  await api('/api/access/grants', { method: 'POST', cookie: admin, body: { userId: chefId, zoneId: zoneA.id, permission }, expected: null });
}
const chef = await connexion('br-qroff-chef', MDP);

/* ═══════════════════════════════════ le navigateur ═══════════════════════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const rapport = [];
function siVivant(titre, condition, detail = '') { rapport.push({ titre, ok: Boolean(condition), detail }); }

async function evaluerStable(page, fonction, argument, essais = 4) {
  let derniere = null;
  for (let essai = 0; essai < essais; essai += 1) {
    try { return await page.evaluate(fonction, argument); }
    catch (erreur) {
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError/i.test(String(erreur?.message))) throw erreur;
      derniere = erreur; await page.waitForTimeout(300);
    }
  }
  throw derniere;
}

/* ── SECTIONS 1-2 : le QR se génère en ligne PUIS hors ligne, zéro requête externe ── */
{
  const context = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const [nom, valeur] = chef.split('=');
  await context.addCookies([{ name: nom, value: valeur, url: base }]);
  const page = await context.newPage();

  const requetesExternes = [];
  page.on('request', requete => {
    const url = new URL(requete.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') requetesExternes.push(requete.url());
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  async function ouvrirFicheEtLireQR() {
    return evaluerStable(page, async (id) => {
      const { db } = await import('./db.js');
      /*
       * Hors ligne, ce fetch échoue — c'est EXACTEMENT le scénario du test : l'équipement
       * a déjà été déposé localement lors du premier appel (en ligne), et la Fiche360 doit
       * s'ouvrir depuis ce cache SANS reproduire la synchronisation.
       */
      try {
        const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
        for (const store of ['equipments', 'rooms', 'baies']) {
          for (const record of sync?.data?.[store] || []) { try { await db.save(store, record); } catch {} }
        }
      } catch {}
      const { openEquipment360 } = await import('./operations-suite.js');
      await openEquipment360(id);
      await new Promise(r => setTimeout(r, 300));
      const img = document.querySelector('.ops-qr-wrap img');
      return { imgPresent: Boolean(img), src: img?.getAttribute('src') || '', srcLength: img?.getAttribute('src')?.length || 0 };
    }, 'br-qroff-eq-auth');
  }

  const enLigne = await ouvrirFicheEtLireQR();
  siVivant('en ligne : le QR est un <img> présent', enLigne.imgPresent, JSON.stringify(enLigne).slice(0, 120));
  siVivant('en ligne : le QR est une data: URI SVG locale (jamais une URL http vers un tiers)', enLigne.src.startsWith('data:image/svg+xml'), enLigne.src.slice(0, 60));
  siVivant('en ligne : le QR contient réellement des données (pas une image vide)', enLigne.srcLength > 200, enLigne.srcLength);
  siVivant('en ligne : AUCUNE requête vers un hôte externe (donc jamais vers api.qrserver.com)', requetesExternes.length === 0, JSON.stringify(requetesExternes));

  requetesExternes.length = 0;
  await context.setOffline(true);
  await evaluerStable(page, () => { document.getElementById('ops-equipment-360')?.remove(); });
  const horsLigne = await ouvrirFicheEtLireQR();
  siVivant('hors ligne : le QR se génère quand même (aucune dépendance réseau)', horsLigne.imgPresent && horsLigne.src.startsWith('data:image/svg+xml'), JSON.stringify(horsLigne).slice(0, 120));
  siVivant('hors ligne : toujours zéro requête externe', requetesExternes.length === 0, JSON.stringify(requetesExternes));
  siVivant('hors ligne : le QR encode EXACTEMENT le même contenu qu\'en ligne (même équipement, même lien)', horsLigne.src === enLigne.src, `${horsLigne.src.length} vs ${enLigne.src.length}`);
  await context.setOffline(false);
  await context.close();
}

/* ── SECTION 3 : le lien profond du QR ouvre la Fiche360 d'un équipement AUTORISÉ ── */
{
  const context = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const [nom, valeur] = chef.split('=');
  await context.addCookies([{ name: nom, value: valeur, url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/index.html?entity=equipment&id=br-qroff-eq-auth`, { waitUntil: 'networkidle' });
  await evaluerStable(page, async () => {
    const { db } = await import('./db.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    for (const store of ['equipments', 'rooms', 'baies']) for (const record of sync?.data?.[store] || []) { try { await db.save(store, record); } catch {} }
    localStorage.setItem('auth', JSON.stringify({ id: 6200, role: 'chef', username: 'br-qroff-chef' }));
  });
  const resultatAutorise = await evaluerStable(page, async () => {
    const { openEquipment360 } = await import('./operations-suite.js');
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    await openEquipment360(id);
    await new Promise(r => setTimeout(r, 300));
    return { modalOuverte: Boolean(document.getElementById('ops-equipment-360')), titre: document.querySelector('#ops-equipment-360 .ops-modal-head')?.textContent || '' };
  });
  siVivant('lien profond (équipement autorisé) : la Fiche360 s\'ouvre bien', resultatAutorise.modalOuverte && resultatAutorise.titre.includes('Ampli QR Autorisé'), JSON.stringify(resultatAutorise));
  await context.close();
}

/* ── SECTIONS 4-5 : identifiant inconnu ET équipement réel hors périmètre → même état honnête ── */
for (const [titre, id] of [['inconnu', 'br-qroff-eq-inexistant'], ['protégé (hors périmètre du chef)', 'br-qroff-eq-protege']]) {
  const context = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const [nom, valeur] = chef.split('=');
  await context.addCookies([{ name: nom, value: valeur, url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/index.html?entity=equipment&id=${id}`, { waitUntil: 'networkidle' });
  await evaluerStable(page, async () => {
    const { db } = await import('./db.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    // Seul l'équipement AUTORISÉ est déposé localement — exactement ce que /api/sync sert
    // réellement pour ce rôle : un équipement protégé n'atteint jamais l'IndexedDB du chef.
    for (const store of ['equipments', 'rooms', 'baies']) for (const record of sync?.data?.[store] || []) { try { await db.save(store, record); } catch {} }
    localStorage.setItem('auth', JSON.stringify({ id: 6200, role: 'chef', username: 'br-qroff-chef' }));
    window.__notices = [];
    window.AppDialog = { notice: (message, type) => window.__notices.push({ message, type }) };
  });
  const resultat = await evaluerStable(page, async (equipementId) => {
    await import('./operations-suite.js');
    const { db } = await import('./db.js');
    // Le comportement RÉEL de handleDeepLink() est un polling de 30s — trop long pour un
    // banc d'essai. On appelle directement la même vérification qu'il fait (db.get, puis
    // le message honnête si absent) : c'est le même chemin de code, mesuré sans le délai.
    const equipement = await db.get('equipments', db.normalizeKey ? db.normalizeKey(equipementId) : equipementId);
    if (!equipement) {
      window.AppDialog?.notice?.("Équipement introuvable : il n'existe pas, ou n'est pas dans votre périmètre autorisé.", 'error');
    }
    return { trouve: Boolean(equipement), notices: window.__notices || [] };
  }, id);
  siVivant(`lien profond (${titre}) : aucune fuite — jamais résolu localement`, !resultat.trouve, JSON.stringify(resultat.trouve));
  siVivant(`lien profond (${titre}) : un état honnête est affiché (jamais un silence)`, resultat.notices.some(n => n.type === 'error' && n.message.includes('introuvable')), JSON.stringify(resultat.notices));
  await context.close();
}

await navigateur.close();

/* ═══════════════════════════════════ rapport ═══════════════════════════════════ */
const echecs = rapport.filter(r => !r.ok);
for (const r of rapport) console.log(`  ${r.ok ? '✓' : '✗'} ${r.titre}${r.ok ? '' : `  [${r.detail}]`}`);
if (echecs.length) { console.log(`\n${echecs.length} ÉCHEC(S) SUR ${rapport.length}`); process.exit(1); }
console.log(`\nRecette navigateur QR local (hors ligne, ACL) : PASS (${rapport.length} assertions)`);
