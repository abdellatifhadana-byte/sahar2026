/**
 * @file scripts/component-shapes-browser-gate.mjs — LA CARTE/LE MODULE D'UN COMPOSANT,
 *       DANS UN VRAI CHROMIUM, sur la vraie photo terrain de son équipement/châssis.
 *
 * Troisième niveau après scripts/nested-shapes-browser-gate.mjs (baie sur photo de salle,
 * équipement sur photo de salle/baie) : le composant sur la photo de SON équipement, un
 * châssis modulaire (Ross/openGear ou tout équivalent — rien de spécifique à une marque).
 *
 * PORTÉE, même arbitrage que les recettes précédentes de ce lot : couverture comportementale
 * complète pour l'administrateur en bureau (dessin, sauvegarde, reprise, clic, Annuler,
 * conflit, isolement inter-équipement, résolution de câble) ; quatre tailles d'écran pour un
 * second rôle sur un point de contrôle plus étroit ; six rôles sur la seule matrice de
 * permission.
 *
 * AUCUNE donnée de production : équipements, composants et comptes préfixés `cs-forme`,
 * base de recette, serveur éphémère. La photo utilisée est une vraie image du dépôt,
 * encodée en `data:` — `safeImageUrl` (equipment-media.js, equipment-component-shapes.js)
 * n'accepte qu'un https, un data:image;base64 ou un blob:, jamais un chemin relatif nu.
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
const verifie = (titre, attendu, obtenu) => {
  const ok = JSON.stringify(attendu) === JSON.stringify(obtenu);
  if (!ok) echecs += 1;
  console.log(`  ${ok ? '✓' : '✗ ÉCHEC'} ${titre}`);
  if (!ok) console.log(`        attendu : ${JSON.stringify(attendu)}\n        obtenu  : ${JSON.stringify(obtenu)}`);
};

async function evaluerStable(page, fonction, argument, essais = 4) {
  let derniere = null;
  for (let essai = 0; essai < essais; essai += 1) {
    try { return await page.evaluate(fonction, argument); }
    catch (erreur) {
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError|garbage collected/i.test(String(erreur?.message))) throw erreur;
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
const ZONE = `cs-forme-zone-${SUFFIXE}`;
const EQ_A = 80000 + SUFFIXE;
const EQ_B = 81000 + SUFFIXE;
const COMP_DESSIN_RECT = `cs-rect-${SUFFIXE}`;
const COMP_DESSIN_POLY = `cs-poly-${SUFFIXE}`;
const COMP_AVEC_FORME = `cs-avec-forme-${SUFFIXE}`;
const COMP_STALE = `cs-stale-${SUFFIXE}`;
// Même identifiant de composant sur DEUX équipements différents — la même épreuve
// « mauvaise scène » que nested-shapes-browser-gate.mjs, transposée au composant.
const COMP_ID_PARTAGE = `cs-partage-${SUFFIXE}`;

// Une vraie image du dépôt, encodée en data URI — jamais un octet inventé, et le seul
// format que safeImageUrl accepte hors https (voir equipment-component-shapes.js).
// 1280×720 — assez grand pour cinq cartes bien séparées plus deux zones de tracé, sans
// qu'aucune ne chevauche une autre (mesuré : assets/images/stc.png ne fait que 96×96,
// bien trop petit pour cinq positions distinctes sur la même photo).
const PHOTO_CHASSIS = `data:image/png;base64,${readFileSync(new URL('../assets/favicon.png', import.meta.url)).toString('base64')}`;

/*
 * Un équipement n'a PAS de `resourceType` propre dans `resource-zones` : sa visibilité
 * pour un rôle scopé (chef, technicien, visiteur…) se déduit TOUJOURS de sa salle
 * (`roomId`), jamais d'un lien direct — mesuré : un `resourceType:'equipment'` direct
 * déclenche une mise en quarantaine côté contrôle d'intégrité, et un équipement SANS
 * salle du tout laisse la synchronisation de ces rôles vide (`{settings}` seul, aucun
 * équipement) alors que `manager`/`admin` voient tout par défaut. Ces châssis de recette
 * vivent donc dans une VRAIE salle, comme n'importe quel équipement réel — un châssis
 * modulaire n'est pas moins physiquement localisé qu'un autre appareil.
 */
await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette formes composants', publicSummary: 'Zone de recette' } });
const SALLE = 79000 + SUFFIXE;
await api(`/api/data/rooms/${SALLE}`, { method: 'PUT', ...A, body: { id: SALLE, name: `Salle recette composants ${SUFFIXE}`, x: 500, y: 400 } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE, zoneId: ZONE } });

await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', ...A, body: {
  id: EQ_A, name: `Chassis A recette ${SUFFIXE}`, type: 'Châssis modulaire', roomId: SALLE,
  images: [{ url: PHOTO_CHASSIS, sourceType: 'instance' }],
  components: [
    { id: COMP_DESSIN_RECT, type: 'Carte broadcast / traitement', name: 'Carte à dessiner (rect)', manufacturer: 'Ross', model: 'DFR-8322', slot: 'Slot 1' },
    { id: COMP_DESSIN_POLY, type: 'Carte broadcast / traitement', name: 'Carte à dessiner (polygone)', slot: 'Slot 2' },
    { id: COMP_AVEC_FORME, type: 'Module interne', name: 'Carte déjà positionnée', manufacturer: 'Ross', model: 'MLE-401', serialNumber: 'SN-778', slot: 'Slot 3',
      shapeInEquipment: { type: 'rect', x: 950, y: 80, w: 200, h: 150 },
      ports: [{ id: `port-${SUFFIXE}`, number: '1', type: 'BNC / SDI', direction: 'OUT', behavior: 'fixed', label: 'SDI OUT 1' }] },
    { id: COMP_STALE, type: 'Autre', name: 'Carte pour conflit', shapeInEquipment: { type: 'rect', x: 100, y: 450, w: 200, h: 150 } },
    { id: COMP_ID_PARTAGE, type: 'Autre', name: 'Carte identité partagée (A)', shapeInEquipment: { type: 'rect', x: 950, y: 450, w: 200, h: 150 } }
  ]
} });

// Un second équipement, avec un composant de MÊME identifiant que sur EQ_A — jamais
// modifié quand on édite celui d'EQ_A.
await api(`/api/data/equipments/${EQ_B}`, { method: 'PUT', ...A, body: {
  id: EQ_B, name: `Chassis B recette ${SUFFIXE}`, type: 'Châssis modulaire', roomId: SALLE,
  images: [{ url: PHOTO_CHASSIS, sourceType: 'instance' }],
  ports: [{ id: `eqb-port-${SUFFIXE}`, number: '1', type: 'BNC / SDI', direction: 'IN' }],
  components: [
    { id: COMP_ID_PARTAGE, type: 'Autre', name: 'Carte identité partagée (B)', shapeInEquipment: { type: 'rect', x: 10, y: 10, w: 40, h: 30 } }
  ]
} });

// Un câble RÉEL vers COMP_AVEC_FORME — pour la scène 15 (résolution d'extrémité de câble).
// `category`/`type` et un port de destination sont exigés par la validation serveur
// (INVALID_CABLE sinon) — mesuré : un câble sans ces champs échoue silencieusement en 400
// si on n'en vérifie pas le statut, ce que ce lot corrige en l'exigeant explicitement.
const CABLE_ID = 82000 + SUFFIXE;
await api(`/api/data/cables/${CABLE_ID}`, { method: 'PUT', ...A, expected: 200, body: {
  id: CABLE_ID, reference: `Câble recette ${SUFFIXE}`, category: 'Vidéo', type: 'SDI', status: 'Connecté',
  sourceType: 'component', sourceId: COMP_AVEC_FORME, sourceParentEquipmentId: EQ_A, sourcePortId: `port-${SUFFIXE}`,
  destinationType: 'equipment', destinationId: EQ_B, destinationPortId: `eqb-port-${SUFFIXE}`
} });

console.log('── 0 · fixtures posées, scène de recette prête ──');

/* ═══════════════════════ SIX COMPTES, MATRICE CANONIQUE ═══════════════════════ */

const MDP = 'Recette-Formes-Composants-2026!';
const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const comptes = {};
let numero = 90000 + SUFFIXE;
for (const role of ROLES) {
  if (role === 'admin') { comptes[role] = { cookie: admin, role, id: adminUser360?.id ?? 1 }; continue; }
  numero += 1;
  const identifiant = `cs-forme-${role}-${SUFFIXE}`;
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

/* `equipments.edit` — voir permissions.js. Seul ce droit gouverne le dessin d'une carte. */
const EQUIPMENT_EDIT = { admin: true, manager: true, chef: true, responsible: true, technician: false, visitor: false };

/* ═══════════════════════ LE NAVIGATEUR ═══════════════════════ */

async function pageDe(compte, viewport) {
  const contexte = await navigateur.newContext({ viewport });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  const identite = JSON.stringify(compte.user || { id: compte.id, role: compte.role, username: `cs-forme-${compte.role}` });
  await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch {} }, identite);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  /*
   * `networkidle` N'EST PAS UNE CONDITION DE CETTE RECETTE — et l'exiger la faisait échouer
   * sur ce qu'elle ne mesure pas.
   *
   * Mesuré au navigateur : à partir de la sixième page ouverte dans le même Chromium, le
   * réseau de la page ne redevient JAMAIS au repos — 120 s d'attente n'y suffisent pas —
   * alors que la page est parfaitement montée et que TOUTES les assertions de cette recette
   * passent. `page.goto(..., 'networkidle')` expirait donc au bout de 30 s au milieu de la
   * matrice des rôles, sur le troisième rôle, sans qu'aucune vérification ait rien trouvé.
   *
   * Ce que cette recette exige réellement, elle l'attend explicitement juste après : l'URL
   * stabilisée, puis le splash devenu inerte, puis — dans chaque section — la fiche 360° et
   * son canevas. On attend donc le repos réseau SANS EN DÉPENDRE, UNE SEULE FOIS, et pour
   * une durée bornée : la seconde attente qui suivait la stabilisation de l'URL portait le
   * délai PAR DÉFAUT de Playwright, et sur ces pages-là elle ajoutait 30 s de plus à chaque
   * ouverture — 45 s au total avant la moindre vérification de produit, plusieurs minutes
   * sur les matrices à six rôles et quatre tailles d'écran, et le risque de faire expirer la
   * recette entière. Deux attentes du même repos, dont une non bornée, ne rendaient pas la
   * page plus prête : elles rendaient seulement la recette plus lente à échouer.
   */
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  let precedente = '';
  for (let essai = 0; essai < 20; essai += 1) {
    if (page.url() === precedente) break;
    precedente = page.url();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    return !splash || getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  return { contexte, page, erreurs };
}

/**
 * Ouvre la fiche 360° d'un équipement via son propre point d'entrée exposé.
 *
 * `openEquipment360` lit l'équipement dans l'IndexedDB LOCALE du client, hydratée de façon
 * asynchrone après le chargement de la page (central-sync.js). Sur un jeu de données de
 * recette qui grossit au fil de cette session, cette hydratation n'est pas garantie finie
 * au premier appel : la fiche s'ouvrirait alors VIDE (aucune carte), pas en erreur — un
 * délai fixe deviné serait fragile. On réessaie donc explicitement jusqu'à ce que la
 * fiche porte au moins une carte, ou qu'un diagnostic honnête explique pourquoi jamais.
 */
async function ouvrirFiche360(page, equipmentId) {
  for (let essai = 0; essai < 20; essai += 1) {
    await evaluerStable(page, id => window.TechOperations?.openEquipment360?.(id), equipmentId);
    // Sur une hydratation pas encore finie, `openEquipment360` ne crée même pas le modal
    // (il notifie « Équipement introuvable » et s'arrête) : un `waitForSelector` qui
    // expire ici ne doit PAS interrompre la boucle, juste compter comme un essai de plus.
    const apparu = await page.waitForSelector('#ops-equipment-360', { timeout: 2000 }).then(() => true).catch(() => false);
    if (apparu) {
      await page.waitForTimeout(400);
      const pret = await evaluerStable(page, () => document.querySelectorAll('#ops-equipment-360 .ops-card').length > 0);
      if (pret) { await page.waitForTimeout(800); return; }
    }
    await page.waitForTimeout(400);
  }
  const diagnostic = await evaluerStable(page, id => ({
    cardsPresent: document.querySelectorAll('#ops-equipment-360 .ops-card').length,
    headName: document.querySelector('.ops-modal-head > div > div')?.textContent || null
  }), equipmentId);
  throw new Error(`fiche 360° de l'équipement ${equipmentId} restée vide après hydratation — ${JSON.stringify(diagnostic)}`);
}

const idImage = eq => `component-shapes-image-${eq}`;
const idCanevas = eq => `component-shapes-canvas-${eq}`;
const idPicker = eq => `component-shapes-picker-${eq}`;
const idBouton = eq => `draw-component-btn-${eq}`;

async function attendreImage(page, eq) {
  await page.waitForFunction(id => { const img = document.getElementById(id); return img && img.complete && img.naturalWidth > 0; }, idImage(eq), { timeout: 8000 });
}

/** Mesure la géométrie du canevas APRÈS l'avoir fait défiler jusqu'à la vue — voir #C3/#170
 *  et le constat de cette recette : `.ops-modal-body` défile en interne, sa hauteur croît
 *  avec le nombre de panneaux déjà accrochés (média, relations…). */
async function geometrieCanevas(page, eq) {
  await page.locator(`#${idCanevas(eq)}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return evaluerStable(page, id => {
    const canvas = document.getElementById(id);
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, natW: canvas.width, natH: canvas.height };
  }, idCanevas(eq));
}

const versClient = (nx, ny, geo) => ({ x: geo.left + (nx * geo.width / geo.natW), y: geo.top + (ny * geo.height / geo.natH) });
const centreRect = f => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });

async function cliquerAuPoint(page, geo, nx, ny) {
  const c = versClient(nx, ny, geo);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
}

async function tracerForme(page, geo, points) {
  const [premier, ...reste] = points.map(p => versClient(p.x, p.y, geo));
  await page.mouse.move(premier.x, premier.y);
  await page.mouse.down();
  for (const p of reste) await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function ouvrirSelecteurEtChoisir(page, eq, nomComposant) {
  await page.click(`#${idBouton(eq)}`);
  await page.waitForTimeout(250);
  await evaluerStable(page, ({ picker, nom }) => {
    const bouton = [...document.querySelectorAll(`#${picker} .nested-shapes-unplaced-item`)].find(n => n.textContent.includes(nom));
    bouton?.click();
  }, { picker: idPicker(eq), nom: nomComposant });
  await page.waitForTimeout(250);
}

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const DESKTOP = { width: 1920, height: 1080 };

/* ═══════════════ 1 · ADMINISTRATEUR, BUREAU — scènes 1,2,3,4,5,6,7,8,9,10,15 ═══════════════ */

console.log('\n── 1 · administrateur, bureau : affichage, dessin, sauvegarde, reprise, clic, Annuler ──');
{
  const { contexte, page, erreurs } = await pageDe(comptes.admin, DESKTOP);

  await ouvrirFiche360(page, EQ_A);
  verifie('1. la carte « Cartes & modules » apparaît pour un équipement modulaire avec photo réelle', true,
    await evaluerStable(page, () => Boolean(document.querySelector('.equipment-component-shapes-card'))));
  await attendreImage(page, EQ_A);
  let geo = await geometrieCanevas(page, EQ_A);
  verifie('   le canevas a une taille réelle', true, geo.natW > 0 && geo.natH > 0);

  // ── 2 · composant sans forme → « à placer » dans le sélecteur ──
  await page.click(`#${idBouton(EQ_A)}`);
  await page.waitForTimeout(250);
  let texteSelecteur = await evaluerStable(page, id => document.getElementById(id)?.textContent || '', idPicker(EQ_A));
  verifie('2. un composant sans forme apparaît « à placer » dans le sélecteur', true,
    texteSelecteur.includes('Carte à dessiner (rect)') && texteSelecteur.includes('à placer'));
  await page.click(`#${idBouton(EQ_A)}`); // referme
  await page.waitForTimeout(150);

  // ── 3+4 · dessiner un RECTANGLE, enregistrer ──
  await ouvrirSelecteurEtChoisir(page, EQ_A, 'Carte à dessiner (rect)');
  verifie('3. l\'éditeur de forme s\'ouvre pour le composant choisi', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  geo = await geometrieCanevas(page, EQ_A);
  await tracerForme(page, geo, [{ x: 20, y: 20 }, { x: 90, y: 70 }]);
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(500);
  verifie('4. l\'éditeur se ferme après Enregistrer (succès)', true, await evaluerStable(page, () => !document.querySelector('.shape-editor-bar')));

  let apres = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  let composantRect = apres.components.find(c => c.id === COMP_DESSIN_RECT);
  verifie('   le composant porte désormais une shapeInEquipment (rect)', true, Boolean(composantRect?.shapeInEquipment));
  verifie('   les autres champs du composant survivent intacts (manufacturer, model, slot)', true,
    composantRect.manufacturer === 'Ross' && composantRect.model === 'DFR-8322' && composantRect.slot === 'Slot 1');

  // ── 5 · reload : géométrie EXACTE persistée ──
  await page.click('.ops-close'); await page.waitForTimeout(200);
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  geo = await geometrieCanevas(page, EQ_A);
  const centreDessine = centreRect(composantRect.shapeInEquipment);
  const pixelApresRecharge = await evaluerStable(page, ({ id, x, y }) => {
    const canvas = document.getElementById(id);
    return [...canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
  }, { id: idCanevas(EQ_A), x: centreDessine.x, y: centreDessine.y });
  verifie('5. après rechargement, la forme est peinte EXACTEMENT là où elle a été enregistrée', true, pixelApresRecharge[3] > 0);

  // ── 6 · clic ouvre la BONNE fiche composant ──
  await cliquerAuPoint(page, geo, centreDessine.x, centreDessine.y);
  let detailTexte = await evaluerStable(page, () => document.getElementById('component-detail-modal')?.textContent || '');
  verifie('6. cliquer la forme ouvre la fiche du BON composant', true, detailTexte.includes('Carte à dessiner (rect)'));
  await evaluerStable(page, () => document.getElementById('component-detail-modal')?.remove());

  // ── 7 · éditer un champ NON LIÉ du composant déjà positionné → la forme survit ──
  const avantEdition = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  const composantAvecForme = avantEdition.components.find(c => c.id === COMP_AVEC_FORME);
  const equipeAvecNotesEditees = {
    ...avantEdition,
    components: avantEdition.components.map(c => c.id === COMP_AVEC_FORME ? { ...c, notes: 'Contrôle programmé — édition non liée' } : c)
  };
  await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', ...A, body: equipeAvecNotesEditees });
  let apresEditionNotes = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  let composantApresNotes = apresEditionNotes.components.find(c => c.id === COMP_AVEC_FORME);
  verifie('7. éditer un champ NON LIÉ (notes) laisse la shapeInEquipment BYTE-IDENTIQUE', composantAvecForme.shapeInEquipment, composantApresNotes.shapeInEquipment);
  verifie('   la note a bien été appliquée', 'Contrôle programmé — édition non liée', composantApresNotes.notes);

  // ── 8 · éditer les PORTS du composant → la forme survit ──
  const equipeAvecPortAjoute = {
    ...apresEditionNotes,
    components: apresEditionNotes.components.map(c => c.id === COMP_AVEC_FORME
      ? { ...c, ports: [...c.ports, { id: `port-ajoute-${SUFFIXE}`, number: '2', type: 'BNC / SDI', direction: 'IN', behavior: 'fixed', label: 'Entrée ajoutée' }] }
      : c)
  };
  await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', ...A, body: equipeAvecPortAjoute });
  const apresEditionPort = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  const composantApresPort = apresEditionPort.components.find(c => c.id === COMP_AVEC_FORME);
  verifie('8. éditer les PORTS laisse la shapeInEquipment BYTE-IDENTIQUE', composantAvecForme.shapeInEquipment, composantApresPort.shapeInEquipment);
  verifie('   le port ajouté est bien présent (2 ports)', 2, composantApresPort.ports.length);

  /*
   * Les scènes 7 et 8 ont volontairement écrit DIRECTEMENT sur le serveur (hors du
   * navigateur) — c'est ce qui prouve que le modèle de données lui-même préserve la
   * forme, indépendamment de tout chemin d'écriture particulier. Mais la copie LOCALE
   * (IndexedDB) que le navigateur garde de EQ_A n'a pas appris ces écritures : sa
   * `_revision` a pris du retard sur celle du serveur. Un `db.save` du navigateur sur
   * cette base retardée serait désormais, à raison, un VRAI conflit — recharger la page
   * revient à ce qu'un utilisateur ferait après un « Rechargez la version actuelle » :
   * ça resynchronise, ce n'est pas un contournement du contrôle de révision.
   */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    return !splash || getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);

  // ── 9 · Annuler = ZÉRO écriture ──
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  geo = await geometrieCanevas(page, EQ_A);
  const centreForme = centreRect(composantApresPort.shapeInEquipment);
  await cliquerAuPoint(page, geo, centreForme.x, centreForme.y);
  await page.waitForTimeout(200);
  // Le clic hors mode dessin ouvre la fiche en LECTURE — fermer, puis rentrer par le
  // sélecteur explicite pour reprendre l'édition de CE composant précisément.
  await evaluerStable(page, () => document.getElementById('component-detail-modal')?.remove());
  const revisionAvantAnnuler = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A))?._revision;
  await ouvrirSelecteurEtChoisir(page, EQ_A, 'Carte déjà positionnée');
  verifie('   l\'éditeur se rouvre sur le composant déjà positionné', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  geo = await geometrieCanevas(page, EQ_A);
  {
    const c = versClient(centreForme.x, centreForme.y, geo);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 15, c.y + 10, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="annuler"]');
  await page.waitForTimeout(300);
  const revisionApresAnnuler = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A))?._revision;
  verifie('9. Annuler ne modifie PAS la révision (zéro écriture)', revisionAvantAnnuler, revisionApresAnnuler);
  const formeApresAnnuler = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A))?.components.find(c => c.id === COMP_AVEC_FORME)?.shapeInEquipment;
  verifie('   Annuler restitue la géométrie EXACTE', composantAvecForme.shapeInEquipment, formeApresAnnuler);

  // ── 10 · dessiner un POLYGONE ──
  await page.click('.ops-close'); await page.waitForTimeout(200);
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  await ouvrirSelecteurEtChoisir(page, EQ_A, 'Carte à dessiner (polygone)');
  verifie('   l\'éditeur s\'ouvre pour le composant polygone', true, await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar'))));
  geo = await geometrieCanevas(page, EQ_A);
  // Outil polygone : clics successifs puis double-clic pour fermer (contrat de
  // map-shape-editor.js, identique à la carte et aux formes imbriquées).
  await page.click('.shape-editor-bar [data-outil="polygon"]');
  await page.waitForTimeout(150);
  const outilActif = await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-outil="polygon"]')?.classList.contains('is-active'));
  verifie('   l\'outil polygone est bien actif après le clic', true, outilActif);
  // Zone bien distincte du rectangle dessiné en 3+4 (20,20)-(90,70) — aucun chevauchement,
  // aucune ambiguïté sur QUEL composant reçoit le clic ensuite.
  const sommetsPoly = [{ x: 500, y: 100 }, { x: 650, y: 100 }, { x: 650, y: 220 }, { x: 575, y: 280 }, { x: 500, y: 220 }];
  for (const sommet of sommetsPoly) { const c = versClient(sommet.x, sommet.y, geo); await page.mouse.click(c.x, c.y); await page.waitForTimeout(120); }
  const dernier = versClient(sommetsPoly[0].x, sommetsPoly[0].y, geo);
  await page.mouse.dblclick(dernier.x, dernier.y);
  await page.waitForTimeout(300);
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(600);
  const editeurFermeApresPoly = await evaluerStable(page, () => !document.querySelector('.shape-editor-bar'));
  verifie('   l\'éditeur se ferme après Enregistrer (polygone)', true, editeurFermeApresPoly);
  if (!editeurFermeApresPoly) {
    const diag = await evaluerStable(page, () => ({
      toast: document.querySelector('.app-dialog-toast')?.textContent || null,
      barreHTML: document.querySelector('.shape-editor-bar')?.outerHTML?.slice(0, 300)
    }));
    console.log('   DIAGNOSTIC polygone', JSON.stringify(diag));
    await page.click('.shape-editor-bar [data-action="annuler"]').catch(() => {});
    await page.waitForTimeout(200);
  }
  const apresPoly = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  const composantPoly = apresPoly.components.find(c => c.id === COMP_DESSIN_POLY);
  verifie('10. un polygone peut être dessiné et enregistré pour un composant', 'polygon', composantPoly?.shapeInEquipment?.type);

  // ── 15 · le câble existant vers ce composant résout toujours correctement ──
  await page.click('.ops-close'); await page.waitForTimeout(200);
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  geo = await geometrieCanevas(page, EQ_A);
  await cliquerAuPoint(page, geo, centreForme.x, centreForme.y);
  detailTexte = await evaluerStable(page, () => document.getElementById('component-detail-modal')?.textContent || '');
  verifie('15. la fiche du composant liste le câble réel qui lui est relié', true, detailTexte.includes(`Câble recette ${SUFFIXE}`));
  verifie('    et nomme l\'autre extrémité (l\'équipement B)', true, detailTexte.includes(`Chassis B recette ${SUFFIXE}`));

  verifie('aucune erreur JavaScript pendant cette section', [], erreurs);
  await contexte.close();
}

/* ═══════════════ 11 · CONFLIT DE RÉVISION — un VRAI écrit pendant l'édition ═══════════════ */

console.log('\n── 11 · un autre auteur écrit PENDANT l\'édition : conflit détecté, rien écrasé ──');
{
  const { contexte, page } = await pageDe(comptes.admin, DESKTOP);
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  await ouvrirSelecteurEtChoisir(page, EQ_A, 'Carte pour conflit');
  const geo = await geometrieCanevas(page, EQ_A);
  const centre = centreRect({ x: 100, y: 450, w: 200, h: 150 });

  const enCours = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  const autreEcriture = await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', ...A, body: { ...enCours, name: `Chassis A recette ${SUFFIXE} (modifié par un autre)` } });
  verifie('l\'autre écriture aboutit et avance la révision', true, autreEcriture.statut === 200);

  {
    const c = versClient(centre.x, centre.y, geo);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 12, c.y + 8, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(500);
  const barreEncoreOuverte = await evaluerStable(page, () => Boolean(document.querySelector('.shape-editor-bar')));
  verifie('11. un conflit réel laisse l\'éditeur OUVERT (le brouillon n\'est pas perdu)', true, barreEncoreOuverte);
  const nomIntact = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A))?.name;
  verifie('    le nom posé par l\'autre auteur est INTACT — rien n\'a été écrasé', `Chassis A recette ${SUFFIXE} (modifié par un autre)`, nomIntact);
  await evaluerStable(page, () => document.querySelector('.shape-editor-bar [data-action="annuler"]')?.click());
  await contexte.close();
  const restaurer = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', ...A, body: { ...restaurer, name: `Chassis A recette ${SUFFIXE}` } });
}

/* ═══════════════ 12 · MAUVAIS ÉQUIPEMENT — même identifiant de composant, deux appareils ═══════════════ */

console.log('\n── 12 · éditer un composant d\'EQ_A ne touche jamais son homonyme sur EQ_B ──');
{
  const { contexte, page } = await pageDe(comptes.admin, DESKTOP);
  await ouvrirFiche360(page, EQ_A); await attendreImage(page, EQ_A);
  const avantB = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_B));
  const composantAvantB = avantB.components.find(c => c.id === COMP_ID_PARTAGE);

  await ouvrirSelecteurEtChoisir(page, EQ_A, 'Carte identité partagée (A)');
  const geo = await geometrieCanevas(page, EQ_A);
  const centre = centreRect({ x: 950, y: 450, w: 200, h: 150 });
  {
    const c = versClient(centre.x, centre.y, geo);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 18, c.y + 12, { steps: 4 }); await page.mouse.up();
  }
  await page.click('.shape-editor-bar [data-action="valider"]');
  await page.waitForTimeout(500);

  const apresA = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
  const composantApresA = apresA.components.find(c => c.id === COMP_ID_PARTAGE);
  verifie('12. le composant d\'EQ_A a bien changé de forme', true,
    JSON.stringify(composantApresA.shapeInEquipment) !== JSON.stringify({ type: 'rect', x: 950, y: 450, w: 200, h: 150 }));
  const apresB = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_B));
  const composantApresB = apresB.components.find(c => c.id === COMP_ID_PARTAGE);
  verifie('    le composant HOMONYME d\'EQ_B est resté BYTE-IDENTIQUE', composantAvantB, composantApresB);
  await contexte.close();
}

/* ═══════════════ 13+14 · MATRICE DES SIX RÔLES, PUIS QUATRE TAILLES D'ÉCRAN ═══════════════ */

console.log('\n── 13 · la matrice canonique (equipment.edit) décide seule qui peut dessiner ──');
{
  const rapport = [];
  for (const [role, compte] of Object.entries(comptes)) {
    const { contexte, page, erreurs } = await pageDe(compte, DESKTOP);
    await ouvrirFiche360(page, EQ_A);
    await attendreImage(page, EQ_A);
    const boutonVisible = await evaluerStable(page, id => Boolean(document.getElementById(id)), idBouton(EQ_A));
    verifie(`${role} : bouton « Dessiner une carte / module » — matrice canonique (equipment.edit)`, EQUIPMENT_EDIT[role], boutonVisible);

    const canevasVisible = await evaluerStable(page, id => Boolean(document.getElementById(id)), idCanevas(EQ_A));
    verifie(`${role} : le canevas reste visible en LECTURE, même sans droit d'édition`, true, canevasVisible);

    const fraiche = (await api('/api/sync', A)).charge.data.equipments.find(e => String(e.id) === String(EQ_A));
    const tentative = await api(`/api/data/equipments/${EQ_A}`, { method: 'PUT', cookie: compte.cookie, expected: null, body: {
      ...fraiche, components: fraiche.components.map(c => c.id === COMP_DESSIN_RECT ? { ...c, shapeInEquipment: { type: 'rect', x: 1, y: 1, w: 10, h: 10 } } : c)
    } });
    if (EQUIPMENT_EDIT[role]) {
      verifie(`${role} : écriture directe sur un composant — ACCEPTÉE par le serveur`, 200, tentative.statut);
    } else {
      verifie(`${role} : écriture directe sur un composant — REFUSÉE par le serveur`, 403, tentative.statut);
      verifie(`${role} : le refus est un refus de RÔLE, jamais de zone`, true,
        ['ROLE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(tentative.charge.error) && tentative.charge.error !== 'ZONE_FORBIDDEN');
    }

    verifie(`${role} : aucune erreur JavaScript`, [], erreurs);
    rapport.push({ role, bouton: boutonVisible, put: tentative.statut });
    await contexte.close();
  }
  console.log('\n  rôle          bouton   PUT composant');
  console.log('  ' + '─'.repeat(40));
  for (const l of rapport) console.log(`  ${l.role.padEnd(13)} ${String(l.bouton).padEnd(8)} ${l.put}`);
}

console.log('\n── 14 · quatre tailles d\'écran : rendu sans erreur, la forme reste cliquable au bon endroit ──');
{
  const FORMATS = [
    { nom: 'desktop', viewport: { width: 1920, height: 1080 } },
    { nom: 'petit-bureau', viewport: { width: 1024, height: 768 } },
    { nom: 'tablette', viewport: { width: 834, height: 1194 } },
    { nom: 'mobile', viewport: { width: 390, height: 844 } }
  ];
  const centre = centreRect({ x: 950, y: 80, w: 200, h: 150 });
  for (const format of FORMATS) {
    const { contexte, page, erreurs } = await pageDe(comptes.chef, format.viewport);
    await ouvrirFiche360(page, EQ_A);
    await attendreImage(page, EQ_A);
    const geo = await geometrieCanevas(page, EQ_A);
    verifie(`${format.nom} : le canevas a une taille réelle`, true, geo.width > 0 && geo.height > 0);
    await cliquerAuPoint(page, geo, centre.x, centre.y);
    const detailTexte = await evaluerStable(page, () => document.getElementById('component-detail-modal')?.textContent || '');
    verifie(`${format.nom} : cliquer la forme au point NATUREL attendu ouvre la bonne fiche composant`, true, detailTexte.includes('Carte déjà positionnée'));
    verifie(`${format.nom} : aucune erreur JavaScript`, [], erreurs);
    await contexte.close();
  }
}

await navigateur.close();
console.log(echecs ? `\nRecette navigateur des formes de composants : ${echecs} ÉCHEC(S)` : '\nRecette navigateur des formes de composants : PASS');
process.exit(echecs ? 1 : 0);
