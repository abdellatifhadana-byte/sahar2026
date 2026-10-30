/**
 * @file scripts/nested-shapes-browser-gate.mjs — LES FORMES IMBRIQUÉES, DANS UN VRAI CHROMIUM.
 *
 * CE QUE CETTE RECETTE REGARDE.
 *
 * `#map-panel` (la photo d'une salle ou d'une baie) recouvre `#areas-canvas` (le plan
 * général) dès qu'on l'ouvre — mesuré par `document.elementFromPoint` : z-index 90 contre
 * 30/20/rien. Les repères `x_inRoom`/`x_inBaie` que le plan général dessine sur SON
 * canevas n'ont donc jamais été visibles ni cliquables une fois cette photo ouverte. Cette
 * recette ouvre un VRAI Chromium, monte la carte comme l'application le fait, ouvre une
 * VRAIE photo de salle et de baie, et vérifie que la baie ou l'équipement qui y est
 * documenté — par un POINT hérité ou par une FORME dessinée — s'y voit et s'y clique
 * réellement, à l'échelle de CETTE photo (ses pixels naturels), jamais ceux du plan
 * général.
 *
 * PORTÉE — pourquoi la profondeur et la largeur ne sont pas réparties également.
 *
 * Suivant le même arbitrage que scripts/cable-route-browser-gate.mjs (six rôles en
 * desktop, tablette/mobile pour un seul rôle) : la couverture comportementale complète
 * (affichage, clic, glisser, Enregistrer, Annuler, conflit, mauvaise scène, plan général
 * inchangé) tourne pour l'administrateur en desktop ; les quatre tailles d'écran sont
 * revérifiées pour un second rôle (chef) sur un point de contrôle plus étroit (rendu sans
 * erreur, forme cliquable à l'endroit exact) ; les six rôles sont revérifiés sur la seule
 * matrice de permission. Un produit cartésien complet ne mesurerait pas mieux le défaut
 * que ce lot ferme, et coûterait un temps d'exécution sans rapport avec ce qu'il prouverait
 * de plus.
 *
 * AUCUNE donnée de production : zones, salles, baies, équipements et comptes préfixés
 * `br-forme`, base de recette, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const chemin = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function api(path, { method = 'GET', cookie = '', body, expected = null } = {}) {
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
  const { cookie, charge } = await api('/api/auth/login', { method: 'POST', body: { username, password }, expected: 200 });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return { cookie, user: charge.user };
};

let echecs = 0;
const verifie = (titre, attendu, obtenu) => {
  const ok = JSON.stringify(attendu) === JSON.stringify(obtenu);
  if (!ok) echecs += 1;
  console.log(`  ${ok ? '✓' : '✗ ÉCHEC'} ${titre}`);
  if (!ok) console.log(`        attendu : ${JSON.stringify(attendu)}\n        obtenu  : ${JSON.stringify(obtenu)}`);
};

/* Réessaie sur « Execution context was destroyed » — la même course que les autres recettes. */
async function evaluerStable(page, fonction, argument, essais = 4) {
  let derniere = null;
  for (let essai = 0; essai < essais; essai += 1) {
    try { return await page.evaluate(fonction, argument); }
    catch (erreur) {
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError/i.test(String(erreur?.message))) throw erreur;
      derniere = erreur;
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  throw derniere;
}

/* ═══════════════════════ LA SCÈNE DE RECETTE, POSÉE PAR L'ADMINISTRATEUR ═══════════════════════ */

const { cookie: admin, user: adminUser360 } = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const SUFFIXE = Date.now() % 1000000;
const ZONE = `br-forme-zone-${SUFFIXE}`;
const SALLE = 50000 + SUFFIXE;
const BAIE_HOTE = 51000 + SUFFIXE;
const BAIE_POINT = 51001 + SUFFIXE;
const BAIE_RECT = 51002 + SUFFIXE;
const BAIE_POLY = 51003 + SUFFIXE;
const BAIE_VIDE = 51004 + SUFFIXE;
const BAIE_AUTRE = 51005 + SUFFIXE;
const EQ_POINT = 52000 + SUFFIXE;
const EQ_RECT = 52001 + SUFFIXE;
const EQ_POLY = 52002 + SUFFIXE;
const EQ_VIDE = 52003 + SUFFIXE;
const EQ_AUTRE = 52004 + SUFFIXE;
// Équipement DIRECT de la salle (aucune baie) — prouve que « Dessiner un équipement » sur
// la photo de la salle liste bien l'équipement direct, jamais celui logé dans une baie.
const EQ_DIRECT_SALLE = 52005 + SUFFIXE;
// Une baie dont le `roomId` pointe une AUTRE salle, jamais créée comme salle réelle : le
// filtre de scène (`descripteursScenePhoto`) ne compare que la valeur de `roomId`, jamais
// l'existence de la salle référencée — inventer une salle entière ici n'ajouterait qu'un
// risque de zone sans rien prouver de plus que ne le fait déjà BAIE_AUTRE pour les baies.
const BAIE_DECOY = 54001 + SUFFIXE;
const SALLE_HORS_SCENE = 54000 + SUFFIXE;

// Deux images RÉELLES et déjà présentes dans le dépôt — jamais un octet inventé.
// `assets/plan-technique.png` est le nom RÉSERVÉ du plan général : le serveur refuse de le
// servir comme fichier statique nu (404, mesuré) pour forcer son passage par la résolution
// autorisée (`resolveMapImageUrl`). Deux AUTRES images réelles et déjà présentes, sans rapport
// avec le plan général, servent donc de photos de recette.
const PHOTO_SALLE = '/assets/images/logo.PNG';
const PHOTO_BAIE = '/assets/screens-map.jpg.PNG';

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette formes imbriquées', publicSummary: 'Zone de recette' } });

// La FORME du plan général — jamais touchée par cette recette — pour prouver plus bas
// qu'éditer une forme IMBRIQUÉE ne l'a pas fait bouger.
const FORME_PLAN_GENERAL = Object.freeze({ type: 'rect', x: 40, y: 40, w: 90, h: 70 });
await api(`/api/data/rooms/${SALLE}`, { method: 'PUT', ...A, body: {
  id: SALLE, name: 'Salle recette formes', image: PHOTO_SALLE, x: 500, y: 400, shape: FORME_PLAN_GENERAL
} });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE, zoneId: ZONE } });

await api(`/api/data/baies/${BAIE_POINT}`, { method: 'PUT', ...A, body: { id: BAIE_POINT, name: 'Baie point', roomId: SALLE, x_inRoom: 60, y_inRoom: 50 } });
await api(`/api/data/baies/${BAIE_RECT}`, { method: 'PUT', ...A, body: { id: BAIE_RECT, name: 'Baie rectangle', roomId: SALLE, shapeInRoom: { type: 'rect', x: 150, y: 40, w: 60, h: 50 } } });
await api(`/api/data/baies/${BAIE_POLY}`, { method: 'PUT', ...A, body: { id: BAIE_POLY, name: 'Baie polygone', roomId: SALLE,
  shapeInRoom: { type: 'polygon', points: [{ x: 250, y: 30 }, { x: 300, y: 30 }, { x: 300, y: 70 }, { x: 270, y: 90 }, { x: 250, y: 70 }] } } });
await api(`/api/data/baies/${BAIE_VIDE}`, { method: 'PUT', ...A, body: { id: BAIE_VIDE, name: 'Baie à placer', roomId: SALLE } });
await api(`/api/data/baies/${BAIE_AUTRE}`, { method: 'PUT', ...A, body: { id: BAIE_AUTRE, name: 'Baie témoin (autre salle)', roomId: SALLE,
  shapeInRoom: { type: 'rect', x: 10, y: 150, w: 30, h: 20 } } });

// La baie qui HÉBERGE les équipements de recette, avec sa PROPRE photo.
await api(`/api/data/baies/${BAIE_HOTE}`, { method: 'PUT', ...A, body: { id: BAIE_HOTE, name: 'Baie hôte équipements', roomId: SALLE, image: PHOTO_BAIE, x_inRoom: 380, y_inRoom: 180 } });
await api(`/api/data/equipments/${EQ_POINT}`, { method: 'PUT', ...A, body: { id: EQ_POINT, name: 'Eq point', roomId: SALLE, baieId: BAIE_HOTE, x_inBaie: 60, y_inBaie: 50 } });
await api(`/api/data/equipments/${EQ_RECT}`, { method: 'PUT', ...A, body: { id: EQ_RECT, name: 'Eq rectangle', roomId: SALLE, baieId: BAIE_HOTE, shapeInBaie: { type: 'rect', x: 140, y: 30, w: 50, h: 40 } } });
await api(`/api/data/equipments/${EQ_POLY}`, { method: 'PUT', ...A, body: { id: EQ_POLY, name: 'Eq polygone', roomId: SALLE, baieId: BAIE_HOTE,
  shapeInBaie: { type: 'polygon', points: [{ x: 220, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 55 }, { x: 240, y: 70 }, { x: 220, y: 55 }] } } });
await api(`/api/data/equipments/${EQ_VIDE}`, { method: 'PUT', ...A, body: { id: EQ_VIDE, name: 'Eq à placer', roomId: SALLE, baieId: BAIE_HOTE } });
// Témoin de « mauvaise scène » : un équipement de MÊME géométrie apparente, mais dans une AUTRE baie.
await api(`/api/data/equipments/${EQ_AUTRE}`, { method: 'PUT', ...A, body: { id: EQ_AUTRE, name: 'Eq témoin (autre baie)', roomId: SALLE, baieId: BAIE_AUTRE,
  shapeInBaie: { type: 'rect', x: 140, y: 30, w: 50, h: 40 } } });
await api(`/api/data/equipments/${EQ_DIRECT_SALLE}`, { method: 'PUT', ...A, body: { id: EQ_DIRECT_SALLE, name: 'Eq direct salle (à placer)', roomId: SALLE } });

// Décor hors scène : une baie dont `roomId` pointe une salle jamais créée — si un
// sélecteur la listait pour SALLE, la filtration par scène serait rompue. Pas de salle ni
// de zone à créer pour ça : `descripteursScenePhoto` ne compare que la valeur de `roomId`.
await api(`/api/data/baies/${BAIE_DECOY}`, { method: 'PUT', ...A, body: { id: BAIE_DECOY, name: 'Baie témoin (salle différente)', roomId: SALLE_HORS_SCENE } });

console.log('── 0 · fixtures posées, scène de recette prête ──');

/* ═══════════════════════ SIX COMPTES, MATRICE CANONIQUE ═══════════════════════ */

const MDP = 'Recette-Formes-Imbriquees-2026!';
const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const comptes = {};
let numero = 60000 + SUFFIXE;
for (const role of ROLES) {
  if (role === 'admin') { comptes[role] = { cookie: admin, role, id: adminUser360?.id ?? 1 }; continue; }
  numero += 1;
  const identifiant = `br-forme-${role}-${SUFFIXE}`;
  await api(`/api/data/users/${numero}`, { method: 'PUT', ...A, body: {
    id: numero, username: identifiant, fullName: `Recette ${role}`, role, status: 'active',
    password: Buffer.from(MDP, 'utf8').toString('base64')
  } });
  await api('/api/access/memberships', { method: 'POST', ...A, body: { userId: numero, zoneId: ZONE, responsible: false } });
  for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit', 'room.edit']) {
    await api('/api/access/grants', { method: 'POST', ...A, body: { userId: numero, zoneId: ZONE, permission } });
  }
  const session = await connexion(identifiant, MDP);
  comptes[role] = { cookie: session.cookie, user: session.user, role, id: numero };
}

/*
 * Ce que la matrice canonique (permissions.js) promet, PAR TYPE — jamais une seule case
 * pour les deux. `responsible` a `equipments.edit:true` mais `baies.edit:false` : le
 * bouton du panneau salle s'offre donc à lui (OR des deux droits, une baie OU un
 * équipement direct peuvent y vivre), mais le serveur refuse une écriture sur UNE BAIE
 * précisément. Confondre les deux aurait fait de ce test un faux négatif sur le produit,
 * qui applique déjà la nuance correctement.
 */
const BAIE_EDIT = { admin: true, manager: true, chef: true, responsible: false, technician: false, visitor: false };
const EQUIPMENT_EDIT = { admin: true, manager: true, chef: true, responsible: true, technician: false, visitor: false };
const PEUT_EDITER = Object.fromEntries(Object.keys(BAIE_EDIT).map(role => [role, BAIE_EDIT[role] || EQUIPMENT_EDIT[role]]));

/*
 * `canReadOperationalMap` exige `zone.summary.read` sur CHAQUE zone que le plan représente
 * — l'image est une seule photo du site entier. Cette base accumule des salles d'autres
 * recettes exécutées cette même session (chacune dans sa propre zone) : sans cette
 * couverture recalculée à chaque page, un rôle à périmètre reçoit « Accès restreint »,
 * ce qui n'est pas le défaut mesuré — c'est le banc d'essai qui n'a pas suivi la base qui
 * a grandi sous lui. Même défaut, même remède que cable-route-browser-gate.mjs.
 */
async function couvrirLePlan(userId) {
  const liens = (await api('/api/access/manage', A)).charge?.resourceZones || [];
  const zones = [...new Set(liens
    .filter(lien => String(lien.resourceType || '').toLowerCase().startsWith('room'))
    .map(lien => String(lien.zoneId)))];
  for (const zone of zones) {
    await api('/api/access/memberships', { method: 'POST', ...A, body: { userId, zoneId: zone, responsible: false } });
    await api('/api/access/grants', { method: 'POST', ...A, body: { userId, zoneId: zone, permission: 'zone.summary.read' } });
  }
}

/* ═══════════════════════ LE NAVIGATEUR ═══════════════════════ */

async function pageDe(compte, viewport) {
  if (compte.id) await couvrirLePlan(compte.id);
  const contexte = await navigateur.newContext({ viewport });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  // Le cookie seul ne suffit pas : `db.save` (central-sync.js) n'envoie rien au centre sans
  // `localStorage.auth` — mesuré, et déjà documenté par cable-route-browser-gate.mjs.
  const identite = JSON.stringify(compte.user || { id: compte.id, role: compte.role, username: `br-forme-${compte.role}` });
  await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch {} }, identite);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  let precedente = '';
  for (let essai = 0; essai < 20; essai += 1) {
    if (page.url() === precedente) break;
    precedente = page.url();
    await page.waitForTimeout(250);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  /*
   * L'ÉCRAN DE DÉMARRAGE RESTE AU-DESSUS DE TOUT PENDANT SA PROPRE ANIMATION — jusqu'à
   * 2200 ms d'affichage puis 760 ms d'« éveil » avant `pointer-events:none` (mesuré et
   * déjà documenté par cable-route-browser-gate.mjs). Un clic envoyé pendant cette
   * fenêtre atteint le splash, jamais le canevas dessous : ce n'est pas un défaut du
   * produit, c'est ce banc d'essai qui doit laisser le démarrage se terminer.
   */
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    if (!splash) return true;
    return getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  const monte = await evaluerStable(page, async ([role, id]) => {
    const { default: openInteractiveMap } = await import('./interactive-map.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    openInteractiveMap({
      rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
      equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
      user: { id, role, username: `br-forme-${role}` },
      notifications: { showNotification() {} }
    });
    for (let essai = 0; essai < 80; essai += 1) {
      if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    document.getElementById('welcome-start-btn')?.click();
    await new Promise(r => setTimeout(r, 400));
    return { monte: Boolean(document.getElementById('map-container')), restreinte: Boolean(document.querySelector('.map-restricted')) };
  }, [compte.role, compte.id]);
  return { contexte, page, erreurs, monte };
}

async function ouvrirPanneau(page, type, id) {
  await evaluerStable(page, ({ type, id }) => {
    document.querySelector(`.map-hotspot[data-type="${type}"][data-id="${id}"]`)?.click();
  }, { type, id: String(id) });
  await page.waitForTimeout(300);
}

/**
 * Comme `ouvrirPanneau`, mais attend d'abord que le repère existe — le rendu initial du
 * plan peut suivre le montage de quelques cycles. Diagnostique honnêtement s'il n'arrive
 * jamais, plutôt qu'un délai fixe deviné.
 *
 * DEUX cibles possibles, et une seule des deux existe pour une entité donnée : une entité
 * qui porte une FORME documentée est cliquée par sa ZONE (`.map-zone-cliquable`, posée par
 * `poserZoneCliquable` — la surface EST la cible depuis #C3) ; sinon, par sa PASTILLE de
 * point (`.map-hotspot`). Chercher les deux couvre la salle de recette, qui porte une
 * forme sur le plan général, exactement comme une baie ou une salle réelle le ferait.
 */
async function ouvrirPanneauQuandPret(page, type, id) {
  const trouve = await evaluerStable(page, async ({ type, id }) => {
    for (let essai = 0; essai < 60; essai += 1) {
      const cible = document.querySelector(`.map-zone-cliquable[data-type="${type}"][data-id="${id}"]`)
        || document.querySelector(`.map-hotspot[data-type="${type}"][data-id="${id}"]`);
      if (cible) { cible.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }, { type, id: String(id) });
  if (!trouve) {
    const diagnostic = await evaluerStable(page, () => ({
      hotspots: [...document.querySelectorAll('.map-hotspot')].map(n => `${n.dataset.type}:${n.dataset.id}`),
      zones: [...document.querySelectorAll('.map-zone-cliquable')].map(n => `${n.dataset.type}:${n.dataset.id}`),
      restreinte: Boolean(document.querySelector('.map-restricted')),
      panelPresent: Boolean(document.getElementById('map-panel'))
    }));
    throw new Error(`repère ${type}:${id} introuvable — ${JSON.stringify(diagnostic)}`);
  }
  await page.waitForTimeout(300);
}

/** Fait défiler l'attente jusqu'à ce que l'image de la photo ouverte ait ses dimensions réelles. */
async function attendreImage(page, idImage) {
  await page.waitForFunction(id => {
    const img = document.getElementById(id);
    return img && img.complete && img.naturalWidth > 0;
  }, idImage);
  await page.waitForTimeout(150);
}

async function geometrieCanevas(page, idCanevas) {
  return evaluerStable(page, id => {
    const canvas = document.getElementById(id);
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, natW: canvas.width, natH: canvas.height };
  }, idCanevas);
}

const versClient = (nx, ny, geo) => ({ x: geo.left + (nx * geo.width / geo.natW), y: geo.top + (ny * geo.height / geo.natH) });
const centreRect = f => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
const centrePolygone = pts => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

async function cliquerAuPoint(page, geo, nx, ny) {
  const c = versClient(nx, ny, geo);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
}

async function tracerRectangle(page, geo, a, b) {
  const ca = versClient(a.x, a.y, geo);
  const cb = versClient(b.x, b.y, geo);
  await page.mouse.move(ca.x, ca.y);
  await page.mouse.down();
  await page.mouse.move((ca.x + cb.x) / 2, (ca.y + cb.y) / 2, { steps: 5 });
  await page.mouse.move(cb.x, cb.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const DESKTOP = { width: 1920, height: 1080 };

/* ═══════════════════ 1 · ADMINISTRATEUR — COUVERTURE COMPLÈTE, BUREAU ═══════════════════ */

console.log('\n── 1 · administrateur, bureau : affichage, clic, glisser, Enregistrer, Annuler ──');
{
  let { contexte, page, erreurs, monte } = await pageDe(comptes.admin, DESKTOP);
  let relance;
  verifie('la carte se monte', true, monte.monte);
  await ouvrirPanneauQuandPret(page, 'room', SALLE);
  await attendreImage(page, 'room-detail-image');
  let geo = await geometrieCanevas(page, 'room-shapes-canvas');
  verifie('le canevas de la salle a une taille réelle', true, geo.natW > 0 && geo.natH > 0);

  // ── Affichage : un pixel non transparent existe pour chaque forme documentée ──
  const rectC = centreRect({ x: 150, y: 40, w: 60, h: 50 });
  const polyC = centrePolygone([{ x: 250, y: 30 }, { x: 300, y: 30 }, { x: 300, y: 70 }, { x: 270, y: 90 }, { x: 250, y: 70 }]);
  const pixelAu = async (nx, ny) => evaluerStable(page, ({ nx, ny }) => {
    const canvas = document.getElementById('room-shapes-canvas');
    return [...canvas.getContext('2d').getImageData(Math.round(nx), Math.round(ny), 1, 1).data];
  }, { nx, ny });
  verifie('la baie RECTANGLE est peinte à son centre', true, (await pixelAu(rectC.x, rectC.y))[3] > 0);
  verifie('la baie POLYGONE est peinte à son centre', true, (await pixelAu(polyC.x, polyC.y))[3] > 0);
  verifie('la baie POINT est peinte à sa position', true, (await pixelAu(60, 50))[3] > 0);

  // ── Clic (hors édition) : chaque type ouvre la bonne baie ──
  // `currentView` n'est pas exposé : on lit le nom affiché dans l'en-tête du panneau ouvert.
  const nomDuPanneau = () => evaluerStable(page, () => document.querySelector('div[style*="font-size:1.2em"], div[style*="font-size:1.35em"]')?.textContent || '');
  // Mesurée À NOUVEAU, juste avant de cliquer : la géométrie du tout premier rendu peut
  // encore bouger d'un pixel pendant que la mise en page achève de se poser.
  geo = await geometrieCanevas(page, 'room-shapes-canvas');
  await cliquerAuPoint(page, geo, rectC.x, rectC.y);
  verifie('cliquer la baie RECTANGLE (hors édition) ouvre son panneau', 'Baie rectangle', await nomDuPanneau());

  /*
   * `goBack()` referme le tiroir (panneau ET `#panel-back-btn` avec lui) dès le PREMIER
   * « Retour » — il ne reconstruit jamais le panneau complet d'une vue parente, voir
   * `goBack()` dans interactive-map.js. Un second clic sur CE MÊME bouton n'a donc plus rien
   * à cliquer (vérifié pendant le Final Meeting Candidate Gate : Playwright refuse ce clic,
   * l'élément n'est plus visible — ce test cliquait deux fois sur le même bouton avant ce
   * correctif, en s'appuyant sans le savoir sur le double-appel de `goBack()` que ce même
   * Gate a corrigé). Pour rouvrir le panneau Salle complet ici — nécessaire pour mesurer les
   * PIXELS du canevas d'une baie suivante — on ouvre une scène fraîche, exactement comme un
   * exploitant revenant au plan puis recliquant la salle.
   */
  await contexte.close().catch(() => {});
  relance = await pageDe(comptes.admin, DESKTOP);
  contexte = relance.contexte; page = relance.page; monte = relance.monte;
  erreurs.push(...relance.erreurs);
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  geo = await geometrieCanevas(page, 'room-shapes-canvas');
  await cliquerAuPoint(page, geo, polyC.x, polyC.y);
  verifie('cliquer la baie POLYGONE (hors édition) ouvre son panneau', 'Baie polygone', await nomDuPanneau());

  /*
   * `goBack()` referme le tiroir (panneau ET `#panel-back-btn` avec lui) dès le PREMIER
   * « Retour » — il ne reconstruit jamais le panneau complet d'une vue parente, voir
   * `goBack()` dans interactive-map.js. Un second clic sur CE MÊME bouton n'a donc plus rien
   * à cliquer (vérifié pendant le Final Meeting Candidate Gate : Playwright refuse ce clic,
   * l'élément n'est plus visible — ce test cliquait deux fois sur le même bouton avant ce
   * correctif, en s'appuyant sans le savoir sur le double-appel de `goBack()` que ce même
   * Gate a corrigé). Pour rouvrir le panneau Salle complet ici — nécessaire pour mesurer les
   * PIXELS du canevas d'une baie suivante — on ouvre une scène fraîche, exactement comme un
   * exploitant revenant au plan puis recliquant la salle.
   */
  await contexte.close().catch(() => {});
  relance = await pageDe(comptes.admin, DESKTOP);
  contexte = relance.contexte; page = relance.page; monte = relance.monte;
  erreurs.push(...relance.erreurs);
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  geo = await geometrieCanevas(page, 'room-shapes-canvas');
  await cliquerAuPoint(page, geo, 60, 50);
  verifie('cliquer la baie POINT (hors édition) ouvre son panneau', 'Baie point', await nomDuPanneau());

  /*
   * `goBack()` referme le tiroir (panneau ET `#panel-back-btn` avec lui) dès le PREMIER
   * « Retour » — il ne reconstruit jamais le panneau complet d'une vue parente, voir
   * `goBack()` dans interactive-map.js. Un second clic sur CE MÊME bouton n'a donc plus rien
   * à cliquer (vérifié pendant le Final Meeting Candidate Gate : Playwright refuse ce clic,
   * l'élément n'est plus visible — ce test cliquait deux fois sur le même bouton avant ce
   * correctif, en s'appuyant sans le savoir sur le double-appel de `goBack()` que ce même
   * Gate a corrigé). Pour rouvrir le panneau Salle complet ici — nécessaire pour mesurer les
   * PIXELS du canevas d'une baie suivante — on ouvre une scène fraîche, exactement comme un
   * exploitant revenant au plan puis recliquant la salle.
   */
  await contexte.close().catch(() => {});
  relance = await pageDe(comptes.admin, DESKTOP);
  contexte = relance.contexte; page = relance.page; monte = relance.monte;
  erreurs.push(...relance.erreurs);
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  geo = await geometrieCanevas(page, 'room-shapes-canvas');

  // ── « Non placé » : visible dans la liste SEULEMENT en mode formes ──
  let listeAvant = await evaluerStable(page, () => document.getElementById('room-shapes-unplaced')?.style.display);
  verifie('« à placer » est masquée hors mode formes', 'none', listeAvant);
  await page.click('#edit-shapes-btn'); await page.waitForTimeout(200);
  let listeTexte = await evaluerStable(page, () => document.getElementById('room-shapes-unplaced')?.textContent || '');
  verifie('la baie non placée apparaît dans « à placer »', true, listeTexte.includes('Baie à placer'));

  /*
   * ── B1 : SÉLECTEURS EXPLICITES PAR TYPE ──
   *
   * Le seul point d'entrée était jusqu'ici « Modifier les formes », générique : il fallait
   * l'activer puis deviner quoi cliquer sur la photo. « Dessiner une baie » et « Dessiner un
   * équipement » listent — filtrées par TYPE et par SCÈNE — les entités canoniques
   * existantes, jamais un inventaire inventé, et ouvrent le MÊME éditeur. Vérifié ICI, avant
   * que la section ne dessine une forme pour BAIE_VIDE : elle doit encore être « à placer ».
   */
  verifie('le bouton « Dessiner une baie » existe (salle)', true, await evaluerStable(page, () => Boolean(document.getElementById('draw-baie-btn'))));
  verifie('le bouton « Dessiner un équipement » existe (salle)', true, await evaluerStable(page, () => Boolean(document.getElementById('draw-equipment-btn'))));

  const lireSelecteur = hote => evaluerStable(page, id => {
    const noeud = document.getElementById(id);
    return {
      visible: noeud?.style.display !== 'none',
      texte: noeud?.textContent || '',
      placees: [...noeud?.querySelectorAll('.nested-shapes-unplaced-item.is-placed') || []].map(n => n.textContent),
      nonPlacees: [...noeud?.querySelectorAll('.nested-shapes-unplaced-item:not(.is-placed):not(.is-empty)') || []].map(n => n.textContent)
    };
  }, hote);

  await page.click('#draw-baie-btn'); await page.waitForTimeout(200);
  let selecteurBaie = await lireSelecteur('room-shapes-picker');
  verifie('« Dessiner une baie » liste les baies RÉELLES de cette salle, aucune de moins', true,
    ['Baie point', 'Baie rectangle', 'Baie polygone', 'Baie à placer', 'Baie témoin (autre salle)'].every(nom => selecteurBaie.texte.includes(nom)));
  verifie('« Dessiner une baie » n\'inclut PAS une baie d\'une autre salle', false, selecteurBaie.texte.includes('Baie témoin (salle différente)'));
  verifie('dans ce sélecteur, « Baie à placer » est proposée comme NON placée', true, selecteurBaie.nonPlacees.some(t => t.includes('Baie à placer')));
  verifie('dans ce sélecteur, une baie déjà positionnée reste sélectionnable (pour modification)', true, selecteurBaie.placees.some(t => t.includes('Baie rectangle')));

  // Choisir une entité DÉJÀ positionnée dans le sélecteur rouvre le MÊME éditeur de forme.
  await evaluerStable(page, () => {
    const bouton = [...document.querySelectorAll('#room-shapes-picker .nested-shapes-unplaced-item')].find(n => n.textContent.includes('Baie témoin (autre salle)'));
    bouton?.click();
  });
  await page.waitForTimeout(200);
  verifie('choisir une baie déjà positionnée dans le sélecteur ouvre le même éditeur de forme', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await page.click('.shape-editor-bar [data-action="annuler"]');
  await page.waitForTimeout(200);

  await page.click('#draw-equipment-btn'); await page.waitForTimeout(200);
  const selecteurEqSalle = await lireSelecteur('room-shapes-picker');
  verifie('« Dessiner un équipement » (salle) liste l\'équipement DIRECT de cette salle', true, selecteurEqSalle.texte.includes('Eq direct salle'));
  verifie('« Dessiner un équipement » (salle) n\'inclut PAS un équipement logé dans une baie', false,
    selecteurEqSalle.texte.includes('Eq rectangle') || selecteurEqSalle.texte.includes('Eq témoin (autre baie)'));
  verifie('l\'équipement direct non placé est proposé comme NON placé', true, selecteurEqSalle.nonPlacees.some(t => t.includes('Eq direct salle')));
  await page.click('#draw-equipment-btn'); await page.waitForTimeout(150); // referme le sélecteur (bascule)

  // ── Dessiner une NOUVELLE forme pour la baie non placée ──
  await page.click('.nested-shapes-unplaced-item[data-type="baie"]');
  await page.waitForTimeout(200);
  verifie('l\'éditeur de forme s\'ouvre pour la baie non placée', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await tracerRectangle(page, geo, { x: 20, y: 100 }, { x: 80, y: 140 });
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(400);
  const videEnregistree = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_VIDE));
  verifie('la baie non placée porte désormais une shapeInRoom', true, Boolean(videEnregistree?.shapeInRoom));
  verifie('le point hérité reste ABSENT — aucune écriture croisée', true, videEnregistree.x_inRoom === undefined && videEnregistree.y_inRoom === undefined);

  // ── Annuler = ZÉRO écriture ──
  /*
   * `goBack()` referme le tiroir (panneau ET `#panel-back-btn` avec lui) dès le PREMIER
   * « Retour » — il ne reconstruit jamais le panneau complet d'une vue parente, voir
   * `goBack()` dans interactive-map.js. Un second clic sur CE MÊME bouton n'a donc plus rien
   * à cliquer (vérifié pendant le Final Meeting Candidate Gate : Playwright refuse ce clic,
   * l'élément n'est plus visible — ce test cliquait deux fois sur le même bouton avant ce
   * correctif, en s'appuyant sans le savoir sur le double-appel de `goBack()` que ce même
   * Gate a corrigé). Pour rouvrir le panneau Salle complet ici — nécessaire pour mesurer les
   * PIXELS du canevas d'une baie suivante — on ouvre une scène fraîche, exactement comme un
   * exploitant revenant au plan puis recliquant la salle.
   */
  await contexte.close().catch(() => {});
  relance = await pageDe(comptes.admin, DESKTOP);
  contexte = relance.contexte; page = relance.page; monte = relance.monte;
  erreurs.push(...relance.erreurs);
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  await page.click('#edit-shapes-btn'); await page.waitForTimeout(200);
  const geo2 = await geometrieCanevas(page, 'room-shapes-canvas');
  await cliquerAuPoint(page, geo2, rectC.x, rectC.y);
  verifie('cliquer la forme existante en mode formes rouvre son éditeur', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  const revisionAvantAnnuler = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT))?._revision;
  {
    const c = versClient(rectC.x, rectC.y, geo2);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 12, c.y + 8, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="annuler"]');
  await page.waitForTimeout(300);
  const revisionApresAnnuler = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT))?._revision;
  verifie('Annuler ne modifie PAS la révision (zéro écriture)', revisionAvantAnnuler, revisionApresAnnuler);
  const formeApresAnnuler = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT))?.shapeInRoom;
  verifie('Annuler restitue la géométrie EXACTE', { type: 'rect', x: 150, y: 40, w: 60, h: 50 },
    { type: formeApresAnnuler.type, x: formeApresAnnuler.x, y: formeApresAnnuler.y, w: formeApresAnnuler.w, h: formeApresAnnuler.h });
  verifie('aucune erreur JavaScript pendant cette section', [], erreurs);
  await contexte.close();
}

/* ═══════════════════ 2 · CONFLIT DE RÉVISION — un VRAI écrit pendant l'édition ═══════════════════ */

console.log('\n── 2 · un autre auteur écrit PENDANT l\'édition : conflit détecté, rien écrasé ──');
{
  const { contexte, page } = await pageDe(comptes.admin, DESKTOP);
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  await page.click('#edit-shapes-btn'); await page.waitForTimeout(200);
  const geo = await geometrieCanevas(page, 'room-shapes-canvas');
  const rectC = centreRect({ x: 150, y: 40, w: 60, h: 50 });
  await cliquerAuPoint(page, geo, rectC.x, rectC.y);
  await page.waitForTimeout(200);

  // Un AUTRE auteur modifie la MÊME baie pendant que l'éditeur est ouvert.
  const enCours = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT));
  const autreEcriture = await api(`/api/data/baies/${BAIE_RECT}`, { method: 'PUT', ...A,
    body: { ...enCours, name: 'Baie rectangle (modifiée par un autre)' } });
  verifie('l\'autre écriture aboutit et avance la révision', true, autreEcriture.statut === 200);

  {
    const c = versClient(rectC.x, rectC.y, geo);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 10, c.y + 6, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(400);
  // Un CONFLIT réel : l'éditeur reste ouvert (le brouillon n'est pas perdu), pas de succès muet.
  const barreEncoreOuverte = await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')));
  verifie('un conflit réel laisse l\'éditeur OUVERT (le brouillon n\'est pas perdu)', true, barreEncoreOuverte);
  const nomIntact = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT))?.name;
  verifie('le nom posé par l\'autre auteur est INTACT — rien n\'a été écrasé', 'Baie rectangle (modifiée par un autre)', nomIntact);
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await contexte.close();
  // Remet le nom canonique pour ne pas fausser les sections suivantes.
  const restaurer = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_RECT));
  await api(`/api/data/baies/${BAIE_RECT}`, { method: 'PUT', ...A, body: { ...restaurer, name: 'Baie rectangle' } });
}

/* ═══════════════════ 3 · MAUVAISE SCÈNE — deux entités, une géométrie apparente identique ═══════════════════ */

console.log('\n── 3 · éditer un équipement d\'une baie ne touche jamais l\'équipement témoin d\'une autre ──');
{
  const { contexte, page } = await pageDe(comptes.admin, DESKTOP);
  // Une baie n'a JAMAIS de repère sur le plan général en consultation (elle n'y est posée
  // qu'en mode édition) : on y entre par SA salle, en cliquant son repère sur la photo —
  // exactement le chemin qu'un exploitant suit réellement.
  await ouvrirPanneauQuandPret(page, 'room', SALLE); await attendreImage(page, 'room-detail-image');
  const geoSalle = await geometrieCanevas(page, 'room-shapes-canvas');
  await cliquerAuPoint(page, geoSalle, 380, 180);
  verifie('cliquer le repère de la baie hôte (point hérité) ouvre son panneau', 'Baie hôte équipements', await evaluerStable(page, () => document.querySelector('div[style*="font-size:1.2em"], div[style*="font-size:1.35em"]')?.textContent || ''));
  await attendreImage(page, 'baie-detail-image');

  // ── B1 : le sélecteur explicite de la baie ne liste QUE les équipements de CETTE baie ──
  verifie('le bouton « Dessiner un équipement » existe (baie)', true, await evaluerStable(page, () => Boolean(document.getElementById('draw-equipment-btn'))));
  await page.click('#draw-equipment-btn'); await page.waitForTimeout(200);
  const selecteurEqBaie = await evaluerStable(page, () => document.getElementById('baie-shapes-picker')?.textContent || '');
  verifie('« Dessiner un équipement » (baie) liste les équipements RÉELS de cette baie', true,
    ['Eq point', 'Eq rectangle', 'Eq polygone', 'Eq à placer'].every(nom => selecteurEqBaie.includes(nom)));
  verifie('« Dessiner un équipement » (baie) n\'inclut PAS l\'équipement témoin d\'une autre baie', false, selecteurEqBaie.includes('Eq témoin (autre baie)'));
  await page.click('#draw-equipment-btn'); await page.waitForTimeout(150); // referme le sélecteur (bascule)

  await page.click('#edit-shapes-btn'); await page.waitForTimeout(200);
  const geo = await geometrieCanevas(page, 'baie-shapes-canvas');
  const rectC = centreRect({ x: 140, y: 30, w: 50, h: 40 });
  const avantAutre = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_AUTRE));
  await cliquerAuPoint(page, geo, rectC.x, rectC.y);
  verifie('l\'éditeur s\'ouvre pour EQ_RECT (baie hôte)', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  {
    const c = versClient(rectC.x, rectC.y, geo);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 15, c.y + 10, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(400);
  const apresAutre = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_AUTRE));
  verifie('l\'équipement témoin (AUTRE baie) est resté BYTE-IDENTIQUE', avantAutre.shapeInBaie, apresAutre.shapeInBaie);
  await contexte.close();
}

/* ═══════════════════ 4 · LE PLAN GÉNÉRAL RESTE INCHANGÉ ═══════════════════ */

console.log('\n── 4 · toute cette édition de formes imbriquées n\'a pas touché la forme du plan général ──');
{
  const salleApres = (await api('/api/sync', A)).charge.data.rooms.find(r => String(r.id) === String(SALLE));
  verifie('room.shape (plan général) est BYTE-IDENTIQUE à la pose initiale', FORME_PLAN_GENERAL,
    { type: salleApres.shape.type, x: salleApres.shape.x, y: salleApres.shape.y, w: salleApres.shape.w, h: salleApres.shape.h });
}

/* ═══════════════════ 5 · QUATRE TAILLES D'ÉCRAN — chef ═══════════════════ */

console.log('\n── 5 · quatre tailles d\'écran : rendu sans erreur, la forme reste cliquable au bon endroit ──');
{
  const FORMATS = [
    { nom: 'desktop', viewport: { width: 1920, height: 1080 } },
    { nom: 'petit-bureau', viewport: { width: 1024, height: 768 } },
    { nom: 'tablette', viewport: { width: 834, height: 1194 } },
    { nom: 'mobile', viewport: { width: 390, height: 844 } }
  ];
  const rectC = centreRect({ x: 150, y: 40, w: 60, h: 50 });
  for (const format of FORMATS) {
    const { contexte, page, erreurs } = await pageDe(comptes.chef, format.viewport);
    await ouvrirPanneauQuandPret(page, 'room', SALLE);
    await attendreImage(page, 'room-detail-image');
    const geo = await geometrieCanevas(page, 'room-shapes-canvas');
    verifie(`${format.nom} : le canevas a une taille réelle`, true, geo.width > 0 && geo.height > 0);
    await cliquerAuPoint(page, geo, rectC.x, rectC.y);
    const nomAffiche = await evaluerStable(page, () => document.querySelector('div[style*="font-size:1.2em"], div[style*="font-size:1.35em"]')?.textContent || '');
    verifie(`${format.nom} : cliquer la forme au point NATUREL attendu ouvre la bonne baie (la mise à l'échelle ne l'a pas déplacée)`, 'Baie rectangle', nomAffiche);
    verifie(`${format.nom} : aucune erreur JavaScript`, [], erreurs);
    await contexte.close();
  }
}

/* ═══════════════════ 6 · MATRICE DES SIX RÔLES ═══════════════════ */

console.log('\n── 6 · la matrice canonique décide qui peut modifier une forme — jamais un rôle élevé ──');
{
  const rapport = [];
  for (const [role, compte] of Object.entries(comptes)) {
    const { contexte, page, erreurs, monte } = await pageDe(compte, DESKTOP);
    if (monte.restreinte) { rapport.push({ role, etat: 'restreinte' }); await contexte.close(); continue; }
    await ouvrirPanneauQuandPret(page, 'room', SALLE);
    await attendreImage(page, 'room-detail-image');
    const boutonVisible = await evaluerStable(page, () => Boolean(document.getElementById('edit-shapes-btn')));
    verifie(`${role} : bouton « Modifier les formes » — matrice canonique (baie.edit OU equipment.edit)`, PEUT_EDITER[role], boutonVisible);
    // Les boutons EXPLICITES, eux, suivent chacun SA propre case de la matrice — jamais le OR.
    const boutonDessinerBaieVisible = await evaluerStable(page, () => Boolean(document.getElementById('draw-baie-btn')));
    verifie(`${role} : bouton « Dessiner une baie » — matrice canonique (baie.edit)`, BAIE_EDIT[role], boutonDessinerBaieVisible);
    const boutonDessinerEquipementVisible = await evaluerStable(page, () => Boolean(document.getElementById('draw-equipment-btn')));
    verifie(`${role} : bouton « Dessiner un équipement » — matrice canonique (equipment.edit)`, EQUIPMENT_EDIT[role], boutonDessinerEquipementVisible);

    // L'ÉCRAN ET LE SERVEUR DISENT LA MÊME CHOSE : un bouton caché ne suffit pas comme preuve.
    // DEUX écritures directes, PAR TYPE — jamais une seule case pour les deux : `responsible`
    // a `equipments.edit` mais pas `baies.edit`, et le serveur doit le dire pour chacun.
    async function tenterEcriture(store, id, entiteExistante, champForme) {
      const tentative = await api(`/api/data/${store}/${id}`, { method: 'PUT', cookie: compte.cookie, expected: null,
        body: { ...entiteExistante, [champForme]: { type: 'rect', x: 5, y: 5, w: 20, h: 20 } } });
      return tentative;
    }
    function verifierRefusOuAcceptation(libelle, permis, tentative) {
      if (permis) {
        verifie(`${role} : ${libelle} — écriture ACCEPTÉE par le serveur`, 200, tentative.statut);
      } else {
        verifie(`${role} : ${libelle} — écriture REFUSÉE par le serveur`, 403, tentative.statut);
        verifie(`${role} : ${libelle} — le refus est un refus de RÔLE, jamais de zone`, true,
          ['ROLE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(tentative.charge.error) && tentative.charge.error !== 'ZONE_FORBIDDEN');
      }
    }

    const baieExistante = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_POINT));
    const tentativeBaie = await tenterEcriture('baies', BAIE_POINT, baieExistante, 'shapeInRoom');
    verifierRefusOuAcceptation('baie.edit', BAIE_EDIT[role], tentativeBaie);
    if (BAIE_EDIT[role]) {
      const relu = (await api('/api/sync', A)).charge.data.baies.find(b => String(b.id) === String(BAIE_POINT));
      await api(`/api/data/baies/${BAIE_POINT}`, { method: 'PUT', ...A, body: { ...relu, shapeInRoom: undefined, x_inRoom: 60, y_inRoom: 50 } });
    }

    const eqExistant = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_POINT));
    const tentativeEq = await tenterEcriture('equipments', EQ_POINT, eqExistant, 'shapeInBaie');
    verifierRefusOuAcceptation('equipment.edit', EQUIPMENT_EDIT[role], tentativeEq);
    if (EQUIPMENT_EDIT[role]) {
      const relu = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_POINT));
      await api(`/api/data/equipments/${EQ_POINT}`, { method: 'PUT', ...A, body: { ...relu, shapeInBaie: undefined, x_inBaie: 60, y_inBaie: 50 } });
    }

    verifie(`${role} : aucune erreur JavaScript`, [], erreurs);
    rapport.push({ role, etat: monte.restreinte ? 'restreinte' : 'ouverte', bouton: boutonVisible, putBaie: tentativeBaie.statut, putEq: tentativeEq.statut });
    await contexte.close();
  }
  console.log('\n  rôle          état       bouton   PUT baie   PUT équipement');
  console.log('  ' + '─'.repeat(58));
  for (const l of rapport) console.log(`  ${l.role.padEnd(13)} ${(l.etat || '').padEnd(10)} ${String(l.bouton ?? '—').padEnd(8)} ${String(l.putBaie ?? '—').padEnd(10)} ${l.putEq ?? '—'}`);
}

await navigateur.close();
console.log(echecs ? `\nRecette navigateur des formes imbriquées : ${echecs} ÉCHEC(S)` : '\nRecette navigateur des formes imbriquées : PASS');
process.exit(echecs ? 1 : 0);
