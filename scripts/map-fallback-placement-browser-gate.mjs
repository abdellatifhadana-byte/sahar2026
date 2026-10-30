/**
 * @file scripts/map-fallback-placement-browser-gate.mjs — LE REPLI SUR GRILLE EST-IL
 *       RÉELLEMENT ACTIONNABLE, DANS UN VRAI CHROMIUM ?
 *
 * CE QUE CE LOT FERME.
 *
 * En mode édition, une salle ou une baie SANS position documentée reçoit un repère de
 * repli (grille régulière, voir `fallbackPlacement` — map-coordinates-contract.js) : rond,
 * contour discontinu, curseur « pointer ». Mesuré au navigateur AVANT ce lot : ce repère ne
 * fait RIEN au clic ni au glisser — `makeHotspot()` ne câble `onmousedown` que pour les
 * repères `draggable` (jamais les salles/baies du plan général), et son `onclick` était
 * inconditionnellement tu tant que `dragMode` est actif, précisément la seule fenêtre où ce
 * repère de repli existe. Le SEUL chemin qui fonctionnait déjà était le clic DROIT →
 * « Modifier / dessiner la zone » → l'éditeur de forme existant (`editArea`/
 * `openShapeEditor`) — jamais découvert par un geste naturel sur un rond qui invite au clic
 * gauche ou au glisser.
 *
 * La même enquête, menée au navigateur composant par composant, a montré que le repère
 * PONCTUEL des scènes Salle/Baie (`#map-hotspots`, `resolveEntityPlacement` + session de
 * coordonnées `beginCoordinateSession`) est INVISIBLE dès qu'un panneau salle/baie est
 * ouvert — z-index 30 contre 90, `document.elementFromPoint` le confirme — et que le
 * chemin RÉELLEMENT vu par l'administrateur (la liste « À placer sur cette photo » de
 * `installerFormesPhoto`) fonctionne déjà correctement pour une baie ou un équipement
 * imbriqué. Ce lot le RECONFIRME (sections 3-4) plutôt que de le retoucher.
 *
 * Restait un troisième repli, structurellement identique mais divergent : la liste « À
 * placer » des CARTES/MODULES d'un châssis (`equipment-component-shapes.js`) rendait un
 * `<span>` sans `data-id` ni gestionnaire — visuellement calqué sur le style
 * « rien ici » (`is-empty`, curseur par défaut) au lieu du bouton cliquable que la même
 * liste offre déjà pour baie/équipement. Ce lot l'aligne sur le même contrat.
 *
 * LE PRINCIPE DU REMÈDE, IDENTIQUE PARTOUT : RÉUTILISER LA SESSION QUI EXISTE DÉJÀ.
 *
 * Aucun champ n'est ajouté. Le repère de repli d'une salle/baie sur le plan général ouvre
 * désormais `editArea()` — le MÊME éditeur que le menu contextuel « Modifier » — dès qu'on
 * clique dessus ; la liste « À placer » d'un châssis ouvre désormais `ouvrirEditeur()` — le
 * MÊME éditeur que son propre bouton « Dessiner une carte / module ».
 *
 * PORTÉE — l'administrateur, ET LES RÔLES QUI N'ONT PAS LE DROIT (section 7).
 *
 * Ce lot corrige un branchement d'interaction, jamais une permission : `editArea` et
 * `ouvrirEditeur` appliquent déjà, inchangée, la même garde de rôle (`mapCan`/`peutDessiner`)
 * qu'avant ce lot — rien n'est jamais écrit en base par un rôle qui n'y a pas droit.
 *
 * Mais rediriger un clic vers l'éditeur ne pose pas seulement la question « est-ce que ça
 * passe ? ». Elle pose d'abord : « est-ce que ça DEVAIT être proposé ? ». Le Responsable
 * détient `equipments.edit` — le mode édition s'ouvre donc pour lui, délibérément
 * (`mapAbilities().anyEdition`) — mais PAS `rooms.edit`, ni `baies.edit`. Brancher le repli
 * d'une salle sur `editArea` lui offrait un geste dont la SEULE issue possible était
 * « Votre rôle ne permet pas de modifier cette zone. ». Identiquement, la liste « À placer »
 * d'un châssis devenait un bouton pour un rôle sans `equipments.edit`. Aucun droit n'était
 * franchi ; une PROMESSE l'était — et la plateforme ne propose pas un acte qu'elle sait
 * voué au refus (map-permissions-contract.js, même raisonnement que `deleteItem`).
 *
 * La section 7 mesure exactement cela, au navigateur, avec un Responsable et un Technicien
 * réels. Elle ne rejoue pas la matrice des six rôles (C6/C7, map-roles-browser-e2e.mjs) :
 * elle regarde les deux branchements que ce lot a touchés, et rien d'autre.
 *
 * AUCUNE donnée de production : zone, salles, baies, équipement et compte préfixés
 * `mfp-`, base de recette, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const verifie = (titre, condition) => {
  if (!condition) echecs += 1;
  console.log(`  ${condition ? '✓' : '✗ ÉCHEC'} ${titre}`);
};

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

/* ═══════════════════════ LA SCÈNE DE RECETTE ═══════════════════════ */

const { cookie: admin, user: adminUser360 } = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const SUFFIXE = Date.now() % 1000000;
const ZONE = `mfp-zone-${SUFFIXE}`;
// Une salle POSITIONNÉE : héberge les scènes imbriquées, et sert de témoin « comportement
// inchangé » — son repère sur le plan général reste soumis à la même règle qu'avant ce lot.
const SALLE_HOTE = 60000 + SUFFIXE;
// Une salle SANS AUCUNE position : le cas nu du repli sur le plan général.
const SALLE_VIDE = 61000 + SUFFIXE;
// Une baie SANS position, ni sur le plan (x_inMap/shape) ni dans la photo de sa salle
// (x_inRoom/shapeInRoom) : sert successivement à la scène Salle (confirmation) PUIS au
// repli du plan général (correctif), pour prouver l'absence de fuite entre les deux.
const BAIE_DOUBLE_REPLI = 62000 + SUFFIXE;
// Une baie positionnée avec sa propre photo, pour héberger un équipement de scène Baie.
const BAIE_HOTE = 63000 + SUFFIXE;
const EQ_DANS_SALLE = 64000 + SUFFIXE;
const EQ_DANS_BAIE = 65000 + SUFFIXE;
const EQ_CHASSIS = 66000 + SUFFIXE;
const COMPOSANT_VIDE = `mfp-composant-${SUFFIXE}`;

/*
 * LA SECTION 7 A SES PROPRES ENTITÉS — et c'est nécessaire, pas décoratif : les sections 1,
 * 3 et 6 PLACENT `SALLE_VIDE`, `BAIE_DOUBLE_REPLI` et `COMPOSANT_VIDE`. Les réutiliser pour
 * mesurer un repli ferait mesurer l'inverse de ce qu'on croit mesurer.
 */
const SALLE_VIDE_ROLE = 67000 + SUFFIXE;
const BAIE_VIDE_ROLE = 68000 + SUFFIXE;
const EQ_CHASSIS_ROLE = 69000 + SUFFIXE;
const COMPOSANT_ROLE = `mfp-composant-role-${SUFFIXE}`;
/*
 * DEUX ÉQUIPEMENTS DÉJÀ POSITIONNÉS — un par scène imbriquée. Ce sont EUX qu'on glisse pour
 * fabriquer un mouvement non enregistré, et eux dont la restauration (ou non) prouve si la
 * session de coordonnées a survécu au clic de la section 8.
 */
const EQ_PLACE_SALLE = 73000 + SUFFIXE;
const EQ_PLACE_BAIE = 74000 + SUFFIXE;
const RESPONSABLE_ID = 70000 + SUFFIXE;
const TECHNICIEN_ID = 71000 + SUFFIXE;
// Mots de passe FIXES, jamais dérivés du suffixe : la politique du serveur refuse toute
// répétition ou suite (« 111111 », « 1234 »), et un horodatage en produit tôt ou tard une.
// Seuls les IDENTIFIANTS portent le suffixe — c'est eux qui doivent être uniques.
const MDP_RESPONSABLE = 'Mfp-Rsp-Cascade-Orage-7743';
const MDP_TECHNICIEN = 'Mfp-Tch-Brume-Silex-8261';

const PHOTO = `data:image/png;base64,${readFileSync(new URL('../assets/favicon.png', import.meta.url)).toString('base64')}`;

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette repli plan', publicSummary: 'Zone de recette' } });

await api(`/api/data/rooms/${SALLE_HOTE}`, { method: 'PUT', ...A, body: {
  id: SALLE_HOTE, name: `Salle hôte ${SUFFIXE}`, image: PHOTO, x: 500, y: 400, shape: { type: 'rect', x: 400, y: 350, w: 120, h: 100 }
} });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_HOTE, zoneId: ZONE } });

await api(`/api/data/rooms/${SALLE_VIDE}`, { method: 'PUT', ...A, body: { id: SALLE_VIDE, name: `Salle sans position ${SUFFIXE}` } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_VIDE, zoneId: ZONE } });

await api(`/api/data/baies/${BAIE_DOUBLE_REPLI}`, { method: 'PUT', ...A, body: { id: BAIE_DOUBLE_REPLI, name: `Baie double repli ${SUFFIXE}`, roomId: SALLE_HOTE } });
await api(`/api/data/baies/${BAIE_HOTE}`, { method: 'PUT', ...A, body: { id: BAIE_HOTE, name: `Baie hôte ${SUFFIXE}`, roomId: SALLE_HOTE, image: PHOTO, x_inRoom: 380, y_inRoom: 180 } });
await api(`/api/data/equipments/${EQ_DANS_SALLE}`, { method: 'PUT', ...A, body: { id: EQ_DANS_SALLE, name: `Eq salle ${SUFFIXE}`, roomId: SALLE_HOTE } });
await api(`/api/data/equipments/${EQ_DANS_BAIE}`, { method: 'PUT', ...A, body: { id: EQ_DANS_BAIE, name: `Eq baie ${SUFFIXE}`, roomId: SALLE_HOTE, baieId: BAIE_HOTE } });
await api(`/api/data/equipments/${EQ_CHASSIS}`, { method: 'PUT', ...A, body: {
  id: EQ_CHASSIS, name: `Châssis ${SUFFIXE}`, type: 'Châssis modulaire', roomId: SALLE_HOTE,
  images: [{ url: PHOTO, sourceType: 'instance' }],
  components: [{ id: COMPOSANT_VIDE, type: 'Carte broadcast / traitement', name: 'Carte sans position', slot: 'Slot 1' }]
} });

await api(`/api/data/equipments/${EQ_PLACE_SALLE}`, { method: 'PUT', ...A, body: { id: EQ_PLACE_SALLE, name: `Eq place salle ${SUFFIXE}`, roomId: SALLE_HOTE, x_inRoom: 140, y_inRoom: 110 } });
await api(`/api/data/equipments/${EQ_PLACE_BAIE}`, { method: 'PUT', ...A, body: { id: EQ_PLACE_BAIE, name: `Eq place baie ${SUFFIXE}`, roomId: SALLE_HOTE, baieId: BAIE_HOTE, x_inBaie: 90, y_inBaie: 70 } });

await api(`/api/data/rooms/${SALLE_VIDE_ROLE}`, { method: 'PUT', ...A, body: { id: SALLE_VIDE_ROLE, name: `Salle sans position, rôles ${SUFFIXE}` } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_VIDE_ROLE, zoneId: ZONE } });
await api(`/api/data/baies/${BAIE_VIDE_ROLE}`, { method: 'PUT', ...A, body: { id: BAIE_VIDE_ROLE, name: `Baie sans position, rôles ${SUFFIXE}`, roomId: SALLE_VIDE_ROLE } });
await api(`/api/data/equipments/${EQ_CHASSIS_ROLE}`, { method: 'PUT', ...A, body: {
  id: EQ_CHASSIS_ROLE, name: `Châssis rôles ${SUFFIXE}`, type: 'Châssis modulaire', roomId: SALLE_VIDE_ROLE,
  images: [{ url: PHOTO, sourceType: 'instance' }],
  components: [{ id: COMPOSANT_ROLE, type: 'Carte broadcast / traitement', name: 'Carte rôles sans position', slot: 'Slot 1' }]
} });

/*
 * DEUX COMPTES NON ADMINISTRATEURS — et leurs PERMISSIONS DE ZONE sont délibérément
 * COMPLÈTES.
 *
 * C'est le cœur de la mesure. En donnant à ces deux comptes `room.edit` et `equipment.edit`
 * SUR LA ZONE, on retire au refus toute autre explication possible : ce qui les arrête est
 * le PLAFOND DE RÔLE de la matrice canonique (permissions.js — `responsible.rooms.edit`
 * false, `technician.equipments.edit` false), jamais une permission de zone oubliée dans la
 * recette. Un refus qu'on ne sait pas attribuer ne prouve rien.
 *
 * `zone.summary.read` sur CHAQUE zone que le plan représente est, lui, la condition sine qua
 * non pour que la carte s'affiche du tout (`canReadOperationalMap`) : sans elle le compte
 * reçoit « Accès restreint » et la section entière mesurerait le vide. Les zones sont lues
 * au serveur plutôt que devinées — la base de recette en sème une avant ce fichier.
 */
/**
 * LES ZONES DU PLAN — UNE FOIS QUE LE SERVEUR A FINI DE SEMER LES SIENNES.
 *
 * `inventory-replace-preload` et `catalog-seed-preload` créent leurs propres salles au
 * démarrage (STC, Régie car), chacune avec sa zone `room-<id>`, et PAS instantanément :
 * mesuré au serveur, `room-regie-car` est apparue 2,6 s APRÈS la pose de nos fixtures.
 * Énumérer les zones une seule fois, tout de suite, en manquait donc une — et
 * `canReadOperationalMap` exige `zone.summary.read` sur CHACUNE d'elles. Le Responsable
 * recevait alors « Accès restreint », et la section 7 ne mesurait plus rien du tout : elle
 * échouait sur une course de démarrage, pas sur ce qu'elle surveille.
 *
 * On attend donc que l'ensemble des rattachements salle→zone soit STABLE — trois lectures
 * consécutives identiques — plutôt que de parier sur la vitesse d'un semis.
 */
async function zonesDuPlanStables() {
  let empreinte = '';
  let identiques = 0;
  let zones = [ZONE];
  for (let essai = 0; essai < 40; essai += 1) {
    const liens = ((await api('/api/access/manage', { ...A })).charge?.resourceZones) || [];
    zones = [...new Set([ZONE, ...liens
      .filter(lien => String(lien.resourceType || '').toLowerCase().startsWith('room'))
      .map(lien => String(lien.zoneId))])].sort();
    const courante = zones.join('|');
    identiques = courante === empreinte ? identiques + 1 : 0;
    empreinte = courante;
    if (identiques >= 2) return zones;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  return zones;
}

let zonesDuPlan = await zonesDuPlanStables();

/**
 * Couvre TOUTES les zones que le plan représente, pour un compte donné.
 *
 * Réentrante à dessein : on la rappelle juste avant la section 7. Une zone semée en retard
 * — ou créée par une section antérieure — ne doit jamais transformer une mesure de rôle en
 * écran « Accès restreint ».
 */
async function assurerCouverture(id) {
  zonesDuPlan = [...new Set([...zonesDuPlan, ...(await zonesDuPlanStables())])];
  for (const zoneId of zonesDuPlan) {
    await api('/api/access/memberships', { method: 'POST', ...A, expected: null, body: { userId: id, zoneId, responsible: false } });
    for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit', 'room.edit', 'screen.read']) {
      await api('/api/access/grants', { method: 'POST', ...A, expected: null, body: { userId: id, zoneId, permission } });
    }
  }
}

async function compteDeRecette(id, username, role, motDePasse) {
  // `expected: 200` et non `null` : un mot de passe refusé par la politique produirait
  // sinon un compte inexistant, et la section 7 échouerait très loin de sa cause.
  await api(`/api/data/users/${id}`, { method: 'PUT', ...A, expected: 200, body: {
    id, username, fullName: `Recette ${role} ${SUFFIXE}`, role, status: 'active',
    password: Buffer.from(motDePasse, 'utf8').toString('base64')
  } });
  await assurerCouverture(id);
  return connexion(username, motDePasse);
}

const responsable = await compteDeRecette(RESPONSABLE_ID, `mfp-rsp-${SUFFIXE}`, 'responsible', MDP_RESPONSABLE);
const technicien = await compteDeRecette(TECHNICIEN_ID, `mfp-tch-${SUFFIXE}`, 'technician', MDP_TECHNICIEN);

console.log('── 0 · fixtures posées ──');

/* ═══════════════════════ LE NAVIGATEUR ═══════════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });

const COMPTE_ADMIN = { cookie: admin, user: adminUser360 || { id: 1, role: 'admin', username: adminUser } };

/**
 * LES NOTIFICATIONS SONT UNE MESURE, PAS UN DÉCOR.
 *
 * « Votre rôle ne permet pas de modifier cette zone. » est la TRACE d'une promesse rompue :
 * elle ne survient que si l'écran a d'abord proposé le geste. On la collecte donc au lieu de
 * l'avaler — l'adaptateur muet d'origine (`showNotification() {}`) rendait précisément ce
 * défaut invisible à cette recette.
 */
const notificationsVues = page => evaluerStable(page, () => (window.__mfpNotifications || []).map(n => String(n.message || '')));
const viderNotifications = page => evaluerStable(page, () => { window.__mfpNotifications = []; });

async function pageDe(compte = COMPTE_ADMIN) {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch {} }, JSON.stringify(compte.user));
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  /*
   * `networkidle` EST UNE COMMODITÉ, PAS UNE CONDITION DE CETTE RECETTE.
   *
   * Ce qu'elle exige réellement, elle l'attend explicitement juste après : le splash devenu
   * inerte, puis `#map-container` (ou `.map-restricted`). Exiger en plus un réseau au repos
   * ajoutait un troisième prérequis que rien ne mesure — et qui a expiré au bout de 30 s
   * sur un compte non administrateur, alors que la page était parfaitement montée.
   * On l'attend donc sans en dépendre : si la carte n'arrive pas, c'est l'attente suivante
   * qui le dira, et elle le dira sur ce qui compte.
   */
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    return !splash || getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  await evaluerStable(page, async ([role, id, username]) => {
    const { default: openInteractiveMap } = await import('./interactive-map.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    window.__mfpNotifications = [];
    openInteractiveMap({
      rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
      equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
      user: { id, role, username },
      notifications: { showNotification(message, ton) { window.__mfpNotifications.push({ message, ton }); } }
    });
    for (let essai = 0; essai < 80; essai += 1) {
      if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    document.getElementById('welcome-start-btn')?.click();
    await new Promise(r => setTimeout(r, 400));
  }, [compte.user?.role || 'admin', compte.user?.id ?? 1, compte.user?.username || adminUser]);
  await page.waitForTimeout(200);
  return { contexte, page, erreurs };
}

/**
 * Une page SANS la carte interactive montée — pour la Fiche 360°, une surface autonome
 * (operations-suite.js) sans rapport avec elle. Monter la carte quand même laisserait
 * `svg#map-shape-hits` (plein écran, voir interactive-map.js) recouvrir le canevas de la
 * fiche : un chevauchement qui n'existe dans AUCUN usage réel du produit, où la fiche 360°
 * s'ouvre toujours depuis un contexte où la carte n'est pas ouverte.
 */
async function pageSansCarte(compte = COMPTE_ADMIN) {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch {} }, JSON.stringify(compte.user));
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    return !splash || getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  /*
   * La fiche 360° ne reçoit AUCUN adaptateur de notification de l'extérieur : elle appelle
   * `window.AppDialog.notice` (equipment-component-shapes.js#notificationsAdapter). On
   * enveloppe donc ce point d'entrée réel — `AppDialog` est figé, mais la propriété de
   * `window` ne l'est pas, et app-dialog-safe-confirm.js utilise déjà exactement ce motif
   * (`{ ...previous }`). Le message d'origine continue de s'afficher : on observe, on ne
   * détourne pas.
   */
  await page.waitForFunction(() => Boolean(window.AppDialog?.notice), { timeout: 8000 }).catch(() => {});
  await evaluerStable(page, () => {
    window.__mfpNotifications = [];
    const precedent = window.AppDialog;
    window.AppDialog = Object.freeze({
      ...precedent,
      notice: (message, ton) => { window.__mfpNotifications.push({ message, ton }); return precedent?.notice?.(message, ton); }
    });
  });
  return { contexte, page, erreurs };
}

async function activerModeEdition(page) {
  const deja = await evaluerStable(page, () => document.getElementById('edit-mode-btn')?.classList.contains('success'));
  if (!deja) await page.click('#edit-mode-btn');
  await page.waitForTimeout(200);
}

async function geometrieCanevas(page, idCanevas) {
  return evaluerStable(page, id => {
    const canvas = document.getElementById(id);
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, natW: canvas.width, natH: canvas.height };
  }, idCanevas);
}
const versClient = (nx, ny, geo) => ({ x: geo.left + (nx * geo.width / geo.natW), y: geo.top + (ny * geo.height / geo.natH) });

async function tracerRectangleSurPlan(page, a, b) {
  const geo = await geometrieCanevas(page, 'areas-canvas');
  const ca = versClient(a.x, a.y, geo);
  const cb = versClient(b.x, b.y, geo);
  await page.mouse.move(ca.x, ca.y);
  await page.mouse.down();
  await page.mouse.move((ca.x + cb.x) / 2, (ca.y + cb.y) / 2, { steps: 5 });
  await page.mouse.move(cb.x, cb.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function cliquerHotspot(page, type, id) {
  return evaluerStable(page, ({ type, id }) => {
    const spot = document.querySelector(`.map-hotspot[data-type="${type}"][data-id="${id}"]`);
    if (!spot) return false;
    spot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, { type, id: String(id) });
}

/**
 * LE GLISSER D'UN REPÈRE, TEL QUE `makeHotspot` L'ÉCOUTE RÉELLEMENT.
 *
 * `spot.onmousedown` amorce, puis `document.onmousemove` / `document.onmouseup` poursuivent
 * — ce sont des gestionnaires de PROPRIÉTÉ, que des événements envoyés déclenchent aussi
 * bien qu'une vraie souris. On envoie donc la séquence exacte, sur les mêmes cibles.
 */
const glisserHotspot = (page, type, id, dx, dy) => evaluerStable(page, ({ type, id, dx, dy }) => {
  const spot = document.querySelector(`.map-hotspot[data-type="${type}"][data-id="${id}"]`);
  if (!spot) return false;
  const rect = spot.getBoundingClientRect();
  const x0 = rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  spot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y0 }));
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
  return true;
}, { type, id: String(id), dx, dy });

/**
 * L'état d'un repère, y compris `onmousedown` — c'est-à-dire `draggable`, la propriété même
 * sur laquelle porte le correctif. La lire rend le contrat visible au lieu de le supposer.
 */
const etatHotspot = (page, type, id) => evaluerStable(page, ({ type, id }) => {
  const spot = document.querySelector(`.map-hotspot[data-type="${type}"][data-id="${id}"]`);
  if (!spot) return null;
  return { place: spot.getAttribute('data-placed'), draggable: Boolean(spot.onmousedown), left: spot.style.left, top: spot.style.top };
}, { type, id: String(id) });

const etatSession = page => evaluerStable(page, () => ({
  enregistrer: Boolean(document.getElementById('save-coords-btn')),
  annuler: Boolean(document.getElementById('cancel-coords-btn')),
  modifierPositions: Boolean(document.getElementById('edit-coords-btn'))
}));

const memePosition = (a, b) => Boolean(a) && Boolean(b) && a.left === b.left && a.top === b.top;

/* ═══════════════════════ 1 · SALLE SANS POSITION, PLAN GÉNÉRAL ═══════════════════════ */

{
  const { page, contexte } = await pageDe();
  console.log('── 1 · salle sans position, plan général ──');
  await activerModeEdition(page);

  const avant = await api('/api/sync', { cookie: admin });
  const salleAvant = avant.charge?.data?.rooms?.find(r => String(r.id) === String(SALLE_VIDE));
  verifie('la salle ne porte encore ni x/y ni forme', !salleAvant?.shape && salleAvant?.x === undefined);

  const infos = await evaluerStable(page, id => {
    const spot = document.querySelector(`.map-hotspot[data-type="room"][data-id="${id}"]`);
    return spot ? { trouve: true, classe: spot.className, curseur: getComputedStyle(spot).cursor } : { trouve: false };
  }, String(SALLE_VIDE));
  verifie('le repère de repli est visible en mode édition', infos.trouve);
  verifie('il est visuellement signalé « non placé »', infos.classe?.includes('is-unplaced'));

  // GESTE NATUREL : un simple clic gauche — jamais un clic droit — doit désormais ouvrir
  // l'éditeur de forme existant.
  const clique = await cliquerHotspot(page, 'room', SALLE_VIDE);
  verifie('le repère a bien reçu le clic', clique);
  await page.waitForTimeout(250);
  const barreOuverte = await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')));
  verifie('un clic gauche sur le repère de repli ouvre l’éditeur de forme existant', barreOuverte);

  // Annuler laisse la base inchangée.
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await page.waitForTimeout(200);
  const apresAnnuler = await api('/api/sync', { cookie: admin });
  const salleApresAnnuler = apresAnnuler.charge?.data?.rooms?.find(r => String(r.id) === String(SALLE_VIDE));
  verifie('Annuler ne modifie rien en base', !salleApresAnnuler?.shape && salleApresAnnuler?.x === undefined);
  verifie('la barre d’édition est refermée après Annuler', !(await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')))));

  // Reprendre, tracer, Enregistrer.
  await cliquerHotspot(page, 'room', SALLE_VIDE);
  await page.waitForTimeout(250);
  await tracerRectangleSurPlan(page, { x: 700, y: 500 }, { x: 820, y: 590 });
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="valider"]')?.click());
  await page.waitForTimeout(300);

  const apresSave = await api('/api/sync', { cookie: admin });
  const salleApresSave = apresSave.charge?.data?.rooms?.find(r => String(r.id) === String(SALLE_VIDE));
  verifie('Enregistrer persiste une forme via le champ canonique `shape`', Boolean(salleApresSave?.shape));
  verifie('aucun nouveau champ de position n’a été inventé', !('gridPosition' in (salleApresSave || {})) && !('fallbackX' in (salleApresSave || {})));

  // Rechargement : la salle n'est plus un repli, et l'ancien clic droit reste disponible.
  const { page: page2, contexte: contexte2 } = await pageDe();
  await activerModeEdition(page2);
  const infosApresRecharge = await evaluerStable(page2, id => {
    const spot = document.querySelector(`.map-hotspot[data-type="room"][data-id="${id}"]`);
    return spot ? { placed: spot.getAttribute('data-placed'), classe: spot.className } : null;
  }, String(SALLE_VIDE));
  verifie('après rechargement, la salle placée ne porte plus le style de repli', infosApresRecharge?.placed === 'oui' && !infosApresRecharge?.classe?.includes('is-unplaced'));
  await contexte2.close();
  await contexte.close();
}

/* ═══════════════════════ 2 · TÉMOIN : une salle DÉJÀ POSITIONNÉE n’est pas affectée ═══════════════════════ */

{
  const { page, contexte } = await pageDe();
  console.log('── 2 · témoin : salle déjà positionnée, comportement inchangé ──');
  await activerModeEdition(page);
  await cliquerHotspot(page, 'room', SALLE_HOTE);
  await page.waitForTimeout(300);
  const panelOuvert = await evaluerStable(page, () => document.getElementById('map-panel')?.style.display);
  const editeurOuvert = await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')));
  verifie('un clic gauche sur une salle DÉJÀ placée, en mode édition, n’ouvre ni panneau ni éditeur (règle antérieure inchangée)', panelOuvert !== 'flex' && !editeurOuvert);
  await contexte.close();
}

/* ═══════════════════════ 3 · BAIE SANS POSITION : plan général (correctif) ═══════════════════════ */

{
  const { page, contexte } = await pageDe();
  console.log('── 3 · baie sans position, plan général ──');
  await activerModeEdition(page);

  const infos = await evaluerStable(page, id => {
    const spot = document.querySelector(`.map-hotspot[data-type="baie"][data-id="${id}"]`);
    return spot ? { trouve: true, classe: spot.className } : { trouve: false };
  }, String(BAIE_DOUBLE_REPLI));
  verifie('le repère de repli de la baie est visible en mode édition (plan général)', infos.trouve);
  verifie('il est signalé « non placé »', infos.classe?.includes('is-unplaced'));

  await cliquerHotspot(page, 'baie', BAIE_DOUBLE_REPLI);
  await page.waitForTimeout(250);
  verifie('le clic ouvre l’éditeur de forme existant', await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await tracerRectangleSurPlan(page, { x: 900, y: 200 }, { x: 980, y: 260 });
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="valider"]')?.click());
  await page.waitForTimeout(300);

  const apres = await api('/api/sync', { cookie: admin });
  const baieApres = apres.charge?.data?.baies?.find(b => String(b.id) === String(BAIE_DOUBLE_REPLI));
  verifie('la forme de la baie sur le plan général est enregistrée (`shape`)', Boolean(baieApres?.shape));
  verifie('`shapeInRoom` (scène imbriquée) reste ABSENT — aucune fuite entre les deux référentiels', !baieApres?.shapeInRoom);
  await contexte.close();
}

/* ═══════════ 4 · CONFIRMATION (pas un correctif) : scène Salle, baie/équipement imbriqués ═══════════ */

{
  const { page, contexte } = await pageDe();
  console.log('── 4 · confirmation : scène Salle, « À placer sur cette photo » ──');
  // Consultation d'abord : le panneau s'ouvre par sa ZONE documentée (forme sur le plan).
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(400);
  verifie('le panneau salle s’ouvre', (await evaluerStable(page, () => document.getElementById('map-panel')?.style.display)) === 'flex');

  const zStacking = await evaluerStable(page, () => {
    const el = document.getElementById('map-hotspots');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
    return top ? `${top.tagName}#${top.id}` : null;
  });
  verifie('CONFIRMÉ : #map-hotspots (ancien repère ponctuel) reste recouvert par le panneau — non régressé, non retouché', !zStacking?.includes('map-hotspots'));

  await evaluerStable(page, () => { document.getElementById('edit-shapes-btn')?.click(); });
  await page.waitForTimeout(250);
  const liste = await evaluerStable(page, () => document.getElementById('room-shapes-unplaced')?.innerHTML || '');
  verifie('la baie et l’équipement non placés apparaissent dans « À placer sur cette photo »', liste.includes(`data-id="${BAIE_DOUBLE_REPLI}"`) && liste.includes(`data-id="${EQ_DANS_SALLE}"`));

  // Capturé ICI, pas avant la section 3 : cette baie y a déjà reçu `shape` (plan général,
  // scène 3) — la preuve d'étanchéité qui suit porte sur ce que CETTE édition imbriquée y
  // ajoute ou non, jamais sur un état antérieur à elle.
  const avantNested = await api('/api/sync', { cookie: admin });
  const shapePlanAvant = JSON.stringify(avantNested.charge?.data?.baies?.find(b => String(b.id) === String(BAIE_DOUBLE_REPLI))?.shape);

  await evaluerStable(page, id => {
    [...document.querySelectorAll('.nested-shapes-unplaced-item')].find(b => b.dataset.id === String(id))?.click();
  }, String(BAIE_DOUBLE_REPLI));
  await page.waitForTimeout(250);
  const editeurOuvertNested = await evaluerStable(page, () => Boolean(document.body.innerHTML.match(/Enregistrer/)) && Boolean(document.getElementById('room-shapes-canvas')));
  verifie('cliquer l’élément « à placer » ouvre déjà un éditeur fonctionnel (aucun correctif nécessaire ici)', editeurOuvertNested);

  const geoNested = await geometrieCanevas(page, 'room-shapes-canvas');
  const caN = { x: geoNested.left + geoNested.width * 0.1, y: geoNested.top + geoNested.height * 0.1 };
  const cbN = { x: geoNested.left + geoNested.width * 0.3, y: geoNested.top + geoNested.height * 0.3 };
  await page.mouse.move(caN.x, caN.y); await page.mouse.down();
  await page.mouse.move(cbN.x, cbN.y, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(150);
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="valider"]')?.click());
  await page.waitForTimeout(300);

  const apresNested = await api('/api/sync', { cookie: admin });
  const baieApresNested = apresNested.charge?.data?.baies?.find(b => String(b.id) === String(BAIE_DOUBLE_REPLI));
  verifie('Enregistrer persiste via le champ canonique `shapeInRoom`', Boolean(baieApresNested?.shapeInRoom));
  verifie('`shape` (plan général) est INCHANGÉ — l’édition imbriquée n’a pas écrit sur l’autre référentiel', JSON.stringify(baieApresNested?.shape) === shapePlanAvant);
  await contexte.close();
}

/* ═══════════ 5 · CONFIRMATION : scène Baie, équipement imbriqué ═══════════ */

{
  const { page, contexte } = await pageDe();
  console.log('── 5 · confirmation : scène Baie, « À placer sur cette photo » ──');
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(400);
  await evaluerStable(page, id => document.querySelector(`.map-hotspot[data-type="baie"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(BAIE_HOTE));
  await page.waitForTimeout(400);
  verifie('le panneau baie s’ouvre', (await evaluerStable(page, () => document.getElementById('map-panel')?.style.display)) === 'flex');
  await evaluerStable(page, () => { document.getElementById('edit-shapes-btn')?.click(); });
  await page.waitForTimeout(250);
  const liste = await evaluerStable(page, () => document.getElementById('baie-shapes-unplaced')?.innerHTML || '');
  verifie('l’équipement non placé apparaît dans « À placer sur cette photo » (scène Baie)', liste.includes(`data-id="${EQ_DANS_BAIE}"`));
  await contexte.close();
}

/* ═══════════ 6 · CORRECTIF : scène Équipement/châssis, carte/module non placée ═══════════ */

{
  const { page, contexte } = await pageSansCarte();
  console.log('── 6 · correctif : châssis, « À placer sur cette photo » pour un composant ──');
  const idListe = `component-shapes-picker-${EQ_CHASSIS}`;
  const idCanevas = `component-shapes-canvas-${EQ_CHASSIS}`;

  /*
   * `operations-suite.js` reconstruit périodiquement `#ops-equipment-360` sous ce même
   * identifiant, comme le documente déjà `scripts/component-shapes-browser-gate.mjs`
   * (`ouvrirFiche360`, rouvert avant CHAQUE action, jamais une seule fois pour toute une
   * série de vérifications). Ce lot suit la même discipline : rouvrir juste avant chaque
   * étape, jamais faire confiance à une fiche ouverte depuis plus d'un instant.
   */
  async function ficheChassisPrete() {
    for (let essai = 0; essai < 30; essai += 1) {
      await evaluerStable(page, id => window.TechOperations?.openEquipment360?.(id), EQ_CHASSIS);
      const pret = await page.waitForSelector(`#${idListe}`, { timeout: 1200 }).then(() => true).catch(() => false);
      if (pret) return true;
    }
    return false;
  }

  const pret1 = await ficheChassisPrete();
  verifie('la fiche 360° du châssis présente la liste « à placer » du composant', pret1);

  const avant = await evaluerStable(page, idListe => {
    const el = document.getElementById(idListe);
    const item = el?.querySelector('.nested-shapes-unplaced-item');
    return item ? { tag: item.tagName, aDataId: item.hasAttribute('data-id'), curseur: getComputedStyle(item).cursor } : null;
  }, idListe);
  verifie('la carte non placée apparaît dans la liste', Boolean(avant));
  verifie('CORRECTIF : l’élément est désormais un bouton actionnable (data-id présent)', avant?.tag === 'BUTTON' && avant?.aDataId === true);
  verifie('CORRECTIF : le curseur invite au clic (plus « default » hérité de .is-empty)', avant?.curseur === 'pointer');

  /*
   * OUVRIR, DESSINER, ENREGISTRER — EN UN SEUL ESSAI ATOMIQUE, REPRIS DEPUIS LE DÉBUT S'IL
   * ÉCHOUE. Mesuré : la fiche 360° peut se reconstruire à tout instant (elle appartient à
   * une architecture à ~20 greffons indépendants, voir equipment-component-shapes.js), y
   * compris pendant un geste de tracé — un aléa de la fiche elle-même, jamais propre à
   * cette liste. `scripts/component-shapes-browser-gate.mjs` le contourne en rouvrant AVANT
   * chaque action ; il n'a simplement jamais eu besoin d'un essai encore en cours quand cet
   * aléa survient. Ce lot reprend l'ENSEMBLE clic+tracé+Enregistrer depuis `ficheChassisPrete()`
   * plutôt que de suspecter le correctif lui-même pour un aléa qui lui préexiste.
   */
  let enregistre = false;
  for (let essai = 0; essai < 5 && !enregistre; essai += 1) {
    await ficheChassisPrete();
    await evaluerStable(page, () => document.querySelector('.nested-shapes-unplaced-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const editeurOuvert = await page.waitForSelector('.shape-editor-bar', { timeout: 1500 }).then(() => true).catch(() => false);
    if (essai === 0) verifie('CORRECTIF : cliquer l’élément ouvre désormais l’éditeur de forme existant', editeurOuvert);
    if (!editeurOuvert) continue;

    const canevasPresent = await evaluerStable(page, id => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      return true;
    }, idCanevas);
    if (!canevasPresent) continue;

    const geo = await geometrieCanevas(page, idCanevas);
    const ca = { x: geo.left + geo.width * 0.1, y: geo.top + geo.height * 0.1 };
    const cb = { x: geo.left + geo.width * 0.4, y: geo.top + geo.height * 0.4 };
    await page.mouse.move(ca.x, ca.y); await page.mouse.down();
    await page.mouse.move(cb.x, cb.y, { steps: 5 }); await page.mouse.up();

    const validerPresent = await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar [data-action="valider"]')));
    if (!validerPresent) continue;
    await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="valider"]')?.click());
    await page.waitForTimeout(500);

    const apres = await api('/api/sync', { cookie: admin });
    const composantApres = apres.charge?.data?.equipments
      ?.find(e => String(e.id) === String(EQ_CHASSIS))?.components
      ?.find(c => String(c.id) === String(COMPOSANT_VIDE));
    enregistre = Boolean(composantApres?.shapeInEquipment);
  }
  verifie('Enregistrer persiste via le champ canonique `shapeInEquipment`', enregistre);

  const { page: page2, contexte: contexte2 } = await pageSansCarte();
  let listeApres = null;
  for (let essai = 0; essai < 30 && listeApres === null; essai += 1) {
    await evaluerStable(page2, id => window.TechOperations?.openEquipment360?.(id), EQ_CHASSIS);
    const apparu = await page2.waitForSelector(`#${idCanevas}`, { timeout: 1200 }).then(() => true).catch(() => false);
    if (apparu) listeApres = await evaluerStable(page2, idListe => getComputedStyle(document.getElementById(idListe)).display, idListe);
  }
  verifie('après rechargement, la carte placée disparaît de « À placer sur cette photo »', listeApres === 'none');
  await contexte2.close();
  await contexte.close();
}

/* ═══════ 7 · A-R1 : UN RÔLE SANS LE DROIT NE SE VOIT JAMAIS OFFRIR L'ÉDITION ═══════ */

/*
 * CE QUE CETTE SECTION MESURE, ET CE QU'ELLE NE MESURE PAS.
 *
 * Elle ne mesure PAS une faille : `editArea` et `ouvrirEditeur` refusaient déjà, et le
 * serveur refusait déjà. Elle mesure une PROMESSE — l'écran proposait un geste dont la
 * seule issue possible était un refus. Les trois assertions qui comptent sont donc, à
 * chaque fois, les mêmes : l'éditeur ne s'ouvre pas, AUCUN refus n'est prononcé (parce que
 * rien n'a été tenté), et le fait « non placé » reste visible à l'écran.
 *
 * Le dernier bloc (7d) est le garde-fou de cette section : il redemande à un ADMINISTRATEUR
 * exactement les mêmes entités, et exige que lui, il obtienne l'éditeur. Sans lui, « plus
 * personne ne peut éditer » passerait cette section les yeux fermés.
 */

await assurerCouverture(RESPONSABLE_ID);
await assurerCouverture(TECHNICIEN_ID);

{
  const { page, contexte } = await pageDe(responsable);
  console.log('── 7a · Responsable (rooms.edit = false) : repli d’une salle, plan général ──');

  verifie('le Responsable reçoit la carte, et non « Accès restreint »', await evaluerStable(page, () => Boolean(document.getElementById('map-container'))));
  verifie('le mode édition lui est ouvert — `equipments.edit` le lui accorde (anyEdition, délibéré)', await evaluerStable(page, () => Boolean(document.getElementById('edit-mode-btn'))));
  await activerModeEdition(page);
  await viderNotifications(page);

  const repere = await evaluerStable(page, id => {
    const spot = document.querySelector(`.map-hotspot[data-type="room"][data-id="${id}"]`);
    return spot ? { trouve: true, classe: spot.className } : { trouve: false };
  }, String(SALLE_VIDE_ROLE));
  verifie('le repli de la salle lui reste VISIBLE — le fait « non placée » n’est jamais caché', repere.trouve);
  verifie('et il est toujours signalé « non placé »', repere.classe?.includes('is-unplaced'));

  await cliquerHotspot(page, 'room', SALLE_VIDE_ROLE);
  await page.waitForTimeout(500);
  const apres = await evaluerStable(page, () => ({
    panneau: document.getElementById('map-panel')?.style.display,
    editeur: Boolean(document.querySelector('.shape-editor-bar'))
  }));
  const refus = (await notificationsVues(page)).filter(message => message.includes('ne permet pas'));
  verifie('A-R1 : le clic n’ouvre PAS l’éditeur de forme (aucun `rooms.edit`)', !apres.editeur);
  verifie('A-R1 : AUCUN refus « votre rôle ne permet pas… » — le geste n’a pas été proposé', refus.length === 0);
  verifie('A-R1 : le clic ouvre le panneau de CONSULTATION, ce que son rôle permet bel et bien', apres.panneau === 'flex');

  const enBase = (await api('/api/sync', { cookie: admin })).charge?.data?.rooms?.find(r => String(r.id) === String(SALLE_VIDE_ROLE));
  verifie('ce parcours n’a rien écrit en base', !enBase?.shape && enBase?.x === undefined);
  await contexte.close();
}

{
  const { page, contexte } = await pageDe(responsable);
  console.log('── 7b · Responsable (baies.edit = false) : repli d’une baie, plan général ──');
  await activerModeEdition(page);
  await viderNotifications(page);

  const repere = await evaluerStable(page, id => {
    const spot = document.querySelector(`.map-hotspot[data-type="baie"][data-id="${id}"]`);
    return spot ? { trouve: true, classe: spot.className } : { trouve: false };
  }, String(BAIE_VIDE_ROLE));
  verifie('le repli de la baie lui reste VISIBLE', repere.trouve);
  verifie('et il est toujours signalé « non placé »', repere.classe?.includes('is-unplaced'));

  await cliquerHotspot(page, 'baie', BAIE_VIDE_ROLE);
  await page.waitForTimeout(500);
  const apres = await evaluerStable(page, () => ({
    panneau: document.getElementById('map-panel')?.style.display,
    editeur: Boolean(document.querySelector('.shape-editor-bar'))
  }));
  const refus = (await notificationsVues(page)).filter(message => message.includes('ne permet pas'));
  verifie('A-R1 : le clic n’ouvre PAS l’éditeur de forme (aucun `baies.edit`)', !apres.editeur);
  verifie('A-R1 : AUCUN refus prononcé', refus.length === 0);
  verifie('A-R1 : le clic ouvre le panneau de CONSULTATION', apres.panneau === 'flex');

  const enBase = (await api('/api/sync', { cookie: admin })).charge?.data?.baies?.find(b => String(b.id) === String(BAIE_VIDE_ROLE));
  verifie('ce parcours n’a rien écrit en base', !enBase?.shape && !enBase?.shapeInRoom);
  await contexte.close();
}

{
  const { page, contexte } = await pageSansCarte(technicien);
  console.log('── 7c · Technicien (equipments.edit = false) : « À placer » d’un châssis ──');
  const idListe = `component-shapes-picker-${EQ_CHASSIS_ROLE}`;

  let liste = null;
  for (let essai = 0; essai < 30 && !liste; essai += 1) {
    await evaluerStable(page, id => window.TechOperations?.openEquipment360?.(id), EQ_CHASSIS_ROLE);
    const pret = await page.waitForSelector(`#${idListe}`, { timeout: 1200 }).then(() => true).catch(() => false);
    if (!pret) continue;
    liste = await evaluerStable(page, id => {
      const item = document.getElementById(id)?.querySelector('.nested-shapes-unplaced-item');
      return item ? { tag: item.tagName, aDataId: item.hasAttribute('data-id'), texte: item.textContent || '', curseur: getComputedStyle(item).cursor } : null;
    }, idListe);
  }
  verifie('la fiche 360° du châssis s’ouvre pour le Technicien', Boolean(liste));
  verifie('le bouton « Dessiner une carte / module » lui reste absent (inchangé)', !(await evaluerStable(page, id => Boolean(document.getElementById(id)), `draw-component-btn-${EQ_CHASSIS_ROLE}`)));
  verifie('A-R1 : la carte non placée n’est PAS un bouton actionnable', liste?.tag !== 'BUTTON' && liste?.aDataId !== true);
  verifie('A-R1 : le curseur n’invite plus au clic', liste?.curseur !== 'pointer');
  verifie('le fait « à placer » reste néanmoins ÉCRIT à l’écran — on n’efface pas l’information', liste?.texte?.includes('à placer'));

  await viderNotifications(page);
  await evaluerStable(page, id => document.getElementById(id)?.querySelector('.nested-shapes-unplaced-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true })), idListe);
  await page.waitForTimeout(400);
  verifie('A-R1 : cliquer dessus n’ouvre aucun éditeur', !(await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')))));
  verifie('A-R1 : et ne prononce AUCUN refus — rien n’a été proposé, donc rien n’est refusé', (await notificationsVues(page)).filter(message => message.includes('ne permet pas')).length === 0);

  const composantEnBase = (await api('/api/sync', { cookie: admin })).charge?.data?.equipments
    ?.find(e => String(e.id) === String(EQ_CHASSIS_ROLE))?.components
    ?.find(c => String(c.id) === String(COMPOSANT_ROLE));
  verifie('ce parcours n’a rien écrit en base', !composantEnBase?.shapeInEquipment);
  await contexte.close();
}

{
  console.log('── 7d · GARDE-FOU : l’administrateur, lui, obtient toujours l’éditeur ──');
  const { page, contexte } = await pageDe();
  await activerModeEdition(page);
  await cliquerHotspot(page, 'room', SALLE_VIDE_ROLE);
  await page.waitForTimeout(400);
  verifie('mêmes entités, rôle administrateur : le repli de la salle ouvre bien l’éditeur (correctif Part A intact)', await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await page.waitForTimeout(200);
  await cliquerHotspot(page, 'baie', BAIE_VIDE_ROLE);
  await page.waitForTimeout(400);
  verifie('idem pour le repli de la baie', await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await contexte.close();

  const { page: fiche, contexte: contexteFiche } = await pageSansCarte();
  const idListe = `component-shapes-picker-${EQ_CHASSIS_ROLE}`;
  let item = null;
  for (let essai = 0; essai < 30 && !item; essai += 1) {
    await evaluerStable(fiche, id => window.TechOperations?.openEquipment360?.(id), EQ_CHASSIS_ROLE);
    const pret = await fiche.waitForSelector(`#${idListe}`, { timeout: 1200 }).then(() => true).catch(() => false);
    if (!pret) continue;
    item = await evaluerStable(fiche, id => {
      const el = document.getElementById(id)?.querySelector('.nested-shapes-unplaced-item');
      return el ? { tag: el.tagName, aDataId: el.hasAttribute('data-id') } : null;
    }, idListe);
  }
  verifie('même châssis, rôle administrateur : la carte non placée reste un bouton actionnable (correctif Part A intact)', item?.tag === 'BUTTON' && item?.aDataId === true);
  await contexteFiche.close();
}

/* ═══ 8 · UN ÉQUIPEMENT NON PLACÉ NE DOIT PAS ANNULER UNE SESSION DE COORDONNÉES ═══ */

/*
 * CE QUE LA SECTION 7 A LAISSÉ OUVERT, ET QUE CELLE-CI FERME.
 *
 * Le correctif Part A a rouvert le clic gauche des repères NON PLACÉS pendant le mode
 * édition. Son raisonnement, écrit dans `makeHotspot`, était : « une salle/baie de repli
 * n'est JAMAIS draggable — rien à protéger d'elle ». Vrai pour une salle ou une baie du
 * plan général. FAUX pour un équipement : dans une scène Salle ou Baie, un équipement NON
 * PLACÉ est quand même `draggable` dès qu'une session de coordonnées est ouverte
 * (`droitsCarte.equipment.edit && dragMode && coordinateSessionMatches(...)` — la condition
 * ne regarde pas `placed`). `!placed` seul rouvrait donc AUSSI son clic, et ce clic mène à
 * `openPanel('equipment', ...)`, qui quitte la vue propriétaire de la session et exécute
 * `cancelCoordinateSession()` : tous les déplacements non enregistrés sont restaurés et les
 * boutons Enregistrer / Annuler disparaissent, au milieu d'un relevé en cours.
 *
 * Qu'une vraie souris soit aujourd'hui interceptée par `svg#map-shape-hits` ne protège
 * rien : un ordre de superposition est un accident de rendu, jamais un contrat de
 * correction. On envoie donc le clic directement sur le repère, là où le gestionnaire vit.
 *
 * DEUX INTERRUPTEURS, ET IL FAUT LES DEUX — mesuré, pas supposé.
 *
 * `map-equipment-360-bridge.js` écoute le clic d'un repère d'équipement en phase de
 * CAPTURE sur le document et appelle `stopImmediatePropagation()` : `spot.onclick` ne
 * s'exécute alors jamais. Ce pont se retire à une seule condition — `mapIsInEditMode()`,
 * c'est-à-dire `#map-modal #edit-mode-btn.success`. Or `beginCoordinateSession()` met bien
 * `dragMode` à vrai, mais ne touche PAS cette classe : seul le bouton « Mode édition » de
 * la barre d'outils la pose. Une session ouverte depuis le seul « Modifier les positions »
 * laisse donc le pont actif, et le clic ferme la carte au lieu d'atteindre le défaut —
 * c'est un tout autre chemin, antérieur à ce lot, qu'aucune ligne d'ici ne change.
 *
 * La recette arme donc les deux interrupteurs dans l'ordre où le produit les offre :
 * panneau de la salle ouvert, PUIS « Mode édition » de la barre d'outils, PUIS « Modifier
 * les positions ». C'est dans cet état — et seulement là — que le clic parvient jusqu'à
 * `spot.onclick`, c'est-à-dire jusqu'à ce que ce correctif décide.
 *
 * La mesure est rendue NON VIDE par quatre témoins : le pont est bien retiré
 * (`#edit-mode-btn.success`), le repère non placé est réellement `draggable`, le glisser a
 * réellement déplacé le repère, et « Annuler » restaure réellement — c'est bien cette
 * restauration-là qu'un simple clic ne doit pas déclencher.
 */

{
  const { page, contexte } = await pageDe();
  console.log('── 8a · scène Salle : clic sur un équipement NON PLACÉ pendant l’édition des positions ──');

  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(500);
  verifie('le panneau salle est ouvert', (await evaluerStable(page, () => document.getElementById('map-panel')?.style.display)) === 'flex');
  verifie('« Modifier les positions » est offert à l’administrateur', (await etatSession(page)).modifierPositions);

  await activerModeEdition(page);
  verifie('TÉMOIN : le mode édition de la barre d’outils est actif — le pont Fiche 360° se retire donc', await evaluerStable(page, () => Boolean(document.querySelector('#map-modal #edit-mode-btn.success'))));

  await evaluerStable(page, () => document.getElementById('edit-coords-btn')?.click());
  await page.waitForTimeout(700);
  const ouverte = await etatSession(page);
  verifie('TÉMOIN : la session de coordonnées est RÉELLEMENT ouverte (Enregistrer / Annuler présents)', ouverte.enregistrer && ouverte.annuler);

  const nonPlace = await etatHotspot(page, 'equipment', EQ_DANS_SALLE);
  verifie('TÉMOIN : l’équipement NON PLACÉ a bien un repère pendant l’édition', nonPlace?.place === 'non');
  verifie('TÉMOIN : et ce repère non placé est bel et bien DRAGGABLE — c’est toute la différence avec une salle/baie de repli', nonPlace?.draggable === true);

  const avant = await etatHotspot(page, 'equipment', EQ_PLACE_SALLE);
  verifie('TÉMOIN : l’équipement DÉJÀ PLACÉ a un repère', Boolean(avant));
  verifie('le glisser a été reçu', await glisserHotspot(page, 'equipment', EQ_PLACE_SALLE, 70, 50));
  await page.waitForTimeout(400);
  const apresGlisser = await etatHotspot(page, 'equipment', EQ_PLACE_SALLE);
  verifie('TÉMOIN : le glisser-déposer d’un équipement fonctionne toujours — le repère a bougé', Boolean(apresGlisser) && !memePosition(avant, apresGlisser));

  // LE GESTE EN CAUSE.
  await cliquerHotspot(page, 'equipment', EQ_DANS_SALLE);
  await page.waitForTimeout(700);
  const apresClic = await etatSession(page);
  verifie('P1 : le clic n’annule PAS la session — Enregistrer / Annuler sont toujours là', apresClic.enregistrer && apresClic.annuler);
  verifie('P1 : le panneau de l’équipement ne s’est pas substitué à celui de la salle', apresClic.modifierPositions === false && apresClic.enregistrer === true);

  /*
   * LA PREUVE QUE LE MOUVEMENT EST TOUJOURS LÀ, ET QU'ELLE DISCRIMINE.
   *
   * Relire la position du repère JUSTE APRÈS le clic ne prouverait rien : `openPanel` ne
   * redessine pas `#map-hotspots`, si bien que le DOM garde la position d'avant même quand
   * la session vient d'être annulée et le modèle restauré. On interroge donc la seule chose
   * qui distingue vraiment les deux mondes — « Annuler » : il n'existe QUE si la session a
   * survécu, et il ramène le repère à sa position d'origine, ce qui prouve du même coup que
   * le mouvement non enregistré était encore là à annuler.
   */
  await evaluerStable(page, () => document.getElementById('cancel-coords-btn')?.click());
  await page.waitForTimeout(600);
  const apresAnnuler = await etatHotspot(page, 'equipment', EQ_PLACE_SALLE);
  verifie('P1 : le mouvement non enregistré était encore là — « Annuler » le restaure', memePosition(avant, apresAnnuler));
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 8b · scène Baie : le même geste, le même contrat ──');

  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(500);
  await cliquerHotspot(page, 'baie', BAIE_HOTE);
  await page.waitForTimeout(600);
  verifie('le panneau baie est ouvert', (await evaluerStable(page, () => document.getElementById('map-panel')?.style.display)) === 'flex');
  await activerModeEdition(page);
  verifie('TÉMOIN : le mode édition de la barre d’outils est actif ici aussi', await evaluerStable(page, () => Boolean(document.querySelector('#map-modal #edit-mode-btn.success'))));
  await evaluerStable(page, () => document.getElementById('edit-coords-btn')?.click());
  await page.waitForTimeout(700);
  const ouverte = await etatSession(page);
  verifie('TÉMOIN : la session de coordonnées de la BAIE est ouverte', ouverte.enregistrer && ouverte.annuler);

  const nonPlace = await etatHotspot(page, 'equipment', EQ_DANS_BAIE);
  verifie('TÉMOIN : l’équipement NON PLACÉ de la baie est présent et DRAGGABLE', nonPlace?.place === 'non' && nonPlace?.draggable === true);

  const avant = await etatHotspot(page, 'equipment', EQ_PLACE_BAIE);
  verifie('le glisser a été reçu', await glisserHotspot(page, 'equipment', EQ_PLACE_BAIE, 60, 40));
  await page.waitForTimeout(400);
  const apresGlisser = await etatHotspot(page, 'equipment', EQ_PLACE_BAIE);
  verifie('TÉMOIN : le repère de la baie a bougé', Boolean(apresGlisser) && !memePosition(avant, apresGlisser));

  await cliquerHotspot(page, 'equipment', EQ_DANS_BAIE);
  await page.waitForTimeout(700);
  const apresClic = await etatSession(page);
  verifie('P1 (baie) : le clic n’annule PAS la session', apresClic.enregistrer && apresClic.annuler);
  await evaluerStable(page, () => document.getElementById('cancel-coords-btn')?.click());
  await page.waitForTimeout(600);
  verifie('P1 (baie) : le mouvement non enregistré était encore là — « Annuler » le restaure', memePosition(avant, await etatHotspot(page, 'equipment', EQ_PLACE_BAIE)));
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 8c · hors édition : le clic normal sur un équipement ouvre toujours sa fiche ──');
  /*
   * HORS MODE ÉDITION, CE CLIC N'APPARTIENT MÊME PAS À `makeHotspot`.
   *
   * `map-equipment-360-bridge.js` l'intercepte en phase de CAPTURE sur le document, et
   * n'intercepte QUE hors édition (`mapIsInEditMode()`) : il ferme le plan et ouvre la
   * Fiche 360°, en notant la vue pour y revenir. C'est donc la fiche qu'il faut attendre,
   * pas `#map-panel` — et ce chemin-là, le correctif ne le touche pas du tout, puisqu'il ne
   * modifie que la condition de `spot.onclick`, que le pont court-circuite ici. Cette
   * vérification est une garde de non-régression, pas une mesure du correctif.
   */
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(500);
  verifie('aucune session de coordonnées n’est ouverte à ce stade', (await etatSession(page)).enregistrer === false);
  await cliquerHotspot(page, 'equipment', EQ_PLACE_SALLE);
  const fiche = await page.waitForSelector('#ops-equipment-360', { timeout: 6000 }).then(() => true).catch(() => false);
  verifie('sans session de coordonnées, le clic ouvre toujours la Fiche 360° (comportement inchangé)', fiche);
  const identite = await evaluerStable(page, () => {
    const modale = document.getElementById('ops-equipment-360');
    return modale ? { id: modale.dataset.equipmentId || '', texte: modale.textContent || '' } : null;
  });
  verifie('et c’est bien la fiche de CET équipement', identite?.id === String(EQ_PLACE_SALLE) && identite?.texte?.includes(`Eq place salle ${SUFFIXE}`));
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 8d · GARDE INVERSE : le repli Salle/Baie du plan, lui, reste cliquable ──');
  await activerModeEdition(page);

  const repliSalle = await etatHotspot(page, 'room', SALLE_VIDE_ROLE);
  verifie('le repli d’une salle n’est PAS draggable — c’est pourquoi son clic reste ouvert', repliSalle?.place === 'non' && repliSalle?.draggable === false);
  await cliquerHotspot(page, 'room', SALLE_VIDE_ROLE);
  await page.waitForTimeout(500);
  verifie('Part A intact : le repli d’une SALLE non placée ouvre toujours l’éditeur de forme', await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await page.waitForTimeout(300);

  const repliBaie = await etatHotspot(page, 'baie', BAIE_VIDE_ROLE);
  verifie('le repli d’une baie n’est PAS draggable non plus', repliBaie?.place === 'non' && repliBaie?.draggable === false);
  await cliquerHotspot(page, 'baie', BAIE_VIDE_ROLE);
  await page.waitForTimeout(500);
  verifie('Part A intact : le repli d’une BAIE non placée ouvre toujours l’éditeur de forme', await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await contexte.close();
}

/* ══ 9 · MAP-BRIDGE-01 : LE PONT FICHE 360° NE DOIT PAS COUPER UN RELEVÉ EN COURS ══ */

/*
 * LE DÉFAUT, ET POURQUOI IL TOUCHE LE PARCOURS DE DÉMONSTRATION.
 *
 * `beginCoordinateSession()` met `dragMode` à vrai, mais ne marque PAS le bouton « Mode
 * édition » de la barre d'outils. `map-equipment-360-bridge.js#mapIsInEditMode()` ne
 * regarde, lui, QUE cette classe CSS : `#map-modal #edit-mode-btn.success`. Un relevé
 * ouvert par le seul « Modifier les positions » — c'est-à-dire le geste que l'exploitant
 * fait réellement — laisse donc le pont armé. Et le pont écoute en phase de CAPTURE sur le
 * document : il coupe l'interaction avant tout gestionnaire de la carte, ferme le plan et
 * ouvre la Fiche 360°. Enregistrer / Annuler disparaissent avec le plan, et le relevé en
 * cours est perdu.
 *
 * LE GESTE MESURÉ EST UN VRAI CLIC DE SOURIS, ET SUR LE VRAI CHEMIN.
 *
 * Mesuré au navigateur : pendant un relevé, un repère d'équipement n'est PAS atteignable à
 * la souris — `svg#map-shape-hits` se retrouve au-dessus de `#map-hotspots` dans le test de
 * survol. Le RÉSULTAT DE RECHERCHE de la carte, lui, l'est : le pont le reconnaît
 * explicitement (`#map-search-results [data-type="equipment"][data-id]`), et
 * pilot-technique-preview.css décale délibérément cette liste pour qu'elle reste visible et
 * cliquable à côté du panneau accosté. C'est donc par là que la recette clique, à la
 * souris, sans rien simuler.
 *
 * LE TÉMOIN DU PONT EST L'ÉTAT VISIBLE DU RELEVÉ.
 *
 * Le correctif n'invente aucun drapeau : « Enregistrer » et « Annuler » ne sont à l'écran
 * que pendant un relevé ouvert — ils SONT l'état, et le pont les lit comme tel.
 */

/** Le résultat de recherche d'un équipement, cliqué à la SOURIS, sur le vrai chemin produit. */
async function cliquerResultatRechercheSouris(page, requete, idEquipement) {
  await evaluerStable(page, q => {
    const champ = document.getElementById('map-search');
    if (!champ) return false;
    champ.value = q;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, requete);
  await page.waitForTimeout(700);
  const cible = await evaluerStable(page, id => {
    const bouton = [...document.querySelectorAll('#map-search-results [data-type][data-id]')]
      .find(noeud => noeud.dataset.type === 'equipment' && noeud.dataset.id === String(id));
    if (!bouton) return { trouve: false };
    const rect = bouton.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dessus = document.elementFromPoint(cx, cy);
    // `atteignable` : ce que la souris toucherait vraiment appartient bien au bouton.
    return { trouve: true, cx, cy, atteignable: Boolean(dessus && bouton.contains(dessus)) };
  }, String(idEquipement));
  if (!cible.trouve || !cible.atteignable) return cible;
  await page.mouse.click(cible.cx, cible.cy);
  await page.waitForTimeout(1200);
  return cible;
}

const etatPont = page => evaluerStable(page, () => ({
  planOuvert: Boolean(document.getElementById('map-modal')),
  panneau: document.getElementById('map-panel')?.style.display || '(absent)',
  enregistrer: Boolean(document.querySelector('#map-modal #save-coords-btn')),
  annuler: Boolean(document.querySelector('#map-modal #cancel-coords-btn')),
  modeBarreOutils: Boolean(document.querySelector('#map-modal #edit-mode-btn.success')),
  fiche360: Boolean(document.getElementById('ops-equipment-360'))
}));

{
  const { page, contexte } = await pageDe();
  console.log('── 9a · scène Salle : relevé ouvert par « Modifier les positions » SEUL ──');

  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(600);
  // Vrai clic de souris : ce bouton vit DANS le panneau accosté, donc il est atteignable.
  await page.click('#edit-coords-btn');
  await page.waitForTimeout(800);

  const ouvert = await etatPont(page);
  verifie('TÉMOIN : le relevé est ouvert — Enregistrer et Annuler sont à l’écran', ouvert.enregistrer && ouvert.annuler);
  verifie('TÉMOIN : et le bouton « Mode édition » de la barre d’outils n’a PAS été touché', ouvert.modeBarreOutils === false);

  const avant = await etatHotspot(page, 'equipment', EQ_PLACE_SALLE);
  await glisserHotspot(page, 'equipment', EQ_PLACE_SALLE, 70, 50);
  await page.waitForTimeout(400);
  const apresGlisser = await etatHotspot(page, 'equipment', EQ_PLACE_SALLE);
  verifie('TÉMOIN : un déplacement non enregistré existe bel et bien', Boolean(apresGlisser) && !memePosition(avant, apresGlisser));

  const cible = await cliquerResultatRechercheSouris(page, `Eq place salle ${SUFFIXE}`, EQ_PLACE_SALLE);
  verifie('TÉMOIN : le résultat de recherche de l’équipement est réellement atteignable à la souris', cible.trouve === true && cible.atteignable === true);

  const apres = await etatPont(page);
  verifie('MAP-BRIDGE-01 : le plan reste ouvert — le pont ne l’a pas fermé', apres.planOuvert);
  verifie('MAP-BRIDGE-01 : Enregistrer / Annuler sont toujours là — le relevé a survécu', apres.enregistrer && apres.annuler);
  verifie('MAP-BRIDGE-01 : la Fiche 360° ne s’est pas substituée au relevé', apres.fiche360 === false);

  await evaluerStable(page, () => document.getElementById('cancel-coords-btn')?.click());
  await page.waitForTimeout(600);
  verifie('et « Annuler » fonctionne toujours : le mouvement non enregistré est restauré', memePosition(avant, await etatHotspot(page, 'equipment', EQ_PLACE_SALLE)));
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 9b · scène Baie : le même relevé, le même contrat ──');
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(600);
  await cliquerHotspot(page, 'baie', BAIE_HOTE);
  await page.waitForTimeout(700);
  await page.click('#edit-coords-btn');
  await page.waitForTimeout(800);

  const ouvert = await etatPont(page);
  verifie('TÉMOIN : le relevé de la baie est ouvert', ouvert.enregistrer && ouvert.annuler);
  verifie('TÉMOIN : sans le mode édition de la barre d’outils', ouvert.modeBarreOutils === false);

  const cible = await cliquerResultatRechercheSouris(page, `Eq place baie ${SUFFIXE}`, EQ_PLACE_BAIE);
  verifie('TÉMOIN : le résultat de recherche est atteignable à la souris', cible.trouve === true && cible.atteignable === true);

  const apres = await etatPont(page);
  verifie('MAP-BRIDGE-01 (baie) : le plan reste ouvert et le relevé survit', apres.planOuvert && apres.enregistrer && apres.annuler);
  verifie('MAP-BRIDGE-01 (baie) : aucune Fiche 360° ne s’est ouverte', apres.fiche360 === false);
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 9c · CONSULTATION : sans relevé, la Fiche 360° s’ouvre toujours ──');
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(600);
  const avant = await etatPont(page);
  verifie('TÉMOIN : aucun relevé n’est ouvert', avant.enregistrer === false && avant.annuler === false);

  const cible = await cliquerResultatRechercheSouris(page, `Eq place salle ${SUFFIXE}`, EQ_PLACE_SALLE);
  verifie('TÉMOIN : le résultat de recherche est atteignable à la souris', cible.trouve === true && cible.atteignable === true);
  const apres = await evaluerStable(page, () => ({
    fiche360: Boolean(document.getElementById('ops-equipment-360')),
    identifiant: document.getElementById('ops-equipment-360')?.dataset.equipmentId || ''
  }));
  verifie('le pont fait toujours son travail en consultation : la Fiche 360° s’ouvre', apres.fiche360);
  verifie('et c’est bien la fiche de CET équipement (comportement inchangé)', apres.identifiant === String(EQ_PLACE_SALLE));
  await contexte.close();
}

{
  const { page, contexte } = await pageDe();
  console.log('── 9d · pendant le relevé, le repère d’équipement lui-même n’ouvre aucune Fiche 360° ──');
  await evaluerStable(page, id => document.querySelector(`.map-zone-cliquable[data-type="room"][data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), String(SALLE_HOTE));
  await page.waitForTimeout(600);
  await page.click('#edit-coords-btn');
  await page.waitForTimeout(800);
  verifie('TÉMOIN : le relevé est ouvert', (await etatPont(page)).enregistrer);

  // Le repère n'est pas atteignable à la souris (svg#map-shape-hits le recouvre) : on envoie
  // donc le clic là où le gestionnaire vit, exactement comme la section 8.
  await cliquerHotspot(page, 'equipment', EQ_PLACE_SALLE);
  await page.waitForTimeout(800);
  const apres = await etatPont(page);
  verifie('MAP-BRIDGE-01 : le clic sur le repère n’ouvre aucune Fiche 360° pendant le relevé', apres.fiche360 === false);
  verifie('MAP-BRIDGE-01 : le plan reste ouvert et le relevé survit', apres.planOuvert && apres.enregistrer && apres.annuler);
  await contexte.close();
}

/* ═══════════════════════ BILAN ═══════════════════════ */

console.log(`\n${echecs === 0 ? '✓ TOUT PASSE' : `✗ ${echecs} ÉCHEC(S)`}`);
await navigateur.close();
process.exit(echecs === 0 ? 0 : 1);
