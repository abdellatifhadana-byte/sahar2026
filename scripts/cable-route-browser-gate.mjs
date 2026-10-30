/**
 * @file scripts/cable-route-browser-gate.mjs — LE TRACÉ, DANS UN VRAI CHROMIUM.
 *
 * CE QUE CETTE RECETTE REGARDE.
 *
 * Elle ouvre un Chromium réel, monte la carte comme l'application la monte, désigne un
 * câble et INSPECTE LA BARRE que l'exploitant a sous les yeux : quels boutons existent,
 * ce que dit la pastille, ce que devient la géométrie quand on clique. Les épreuves de
 * contrat disent ce que le code devrait faire ; celle-ci regarde ce qu'il fait.
 *
 * SIX RÔLES, DEUX FORMATS D'ÉCRAN, ET CINQ GESTES MESURÉS :
 *
 *   · lecture > édition — voir un tracé n'est pas pouvoir le remplacer ;
 *   · plusieurs passages dans UNE MÊME scène, désambiguïsés ;
 *   · insertion AU MILIEU du parcours, sans réordonner ce qui existe ;
 *   · « Annuler » restitue l'instantané au caractère près ;
 *   · une retouche de géométrie retire le « vérifié ».
 *
 * AUCUNE donnée de production : zones, salles, équipements et câbles préfixés `br-trace`,
 * comptes dédiés, base de recette. La recette est REJOUABLE : chaque exécution repose ses
 * fixtures sur la révision courante plutôt que d'échouer sur ce qu'elle a laissé.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { ROUTE_SAVE_MESSAGES } from '../cable-route-editor.js';

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
  if (expected !== null) {
    assert.equal(reponse.status, expected, `${method} ${path} : attendu ${expected}, reçu ${reponse.status} ${texte}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie, charge } = await api('/api/auth/login', { method: 'POST', body: { username, password }, expected: 200 });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return { cookie, user: charge.user };
};
const lireCables = async cookie => (await api('/api/sync', { cookie })).charge.data?.cables || [];
const lireCable = async (cookie, id) => (await lireCables(cookie)).find(item => item.id === id) || null;

/* ═══════════════════ LA SCÈNE DE RECETTE, POSÉE PAR L'ADMINISTRATEUR ═══════════════════ */

const { cookie: admin, user: adminUser360 } = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const ZONE_STC = 'br-trace-stc';
const ZONE_RF1 = 'br-trace-rf1';
const SALLE_STC = 9101;
const SALLE_RF1 = 9102;

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE_STC, name: 'Recette Tracé STC', publicSummary: 'Salle technique' } });
await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE_RF1, name: 'Recette Tracé RF1', publicSummary: 'Régie finale' } });
/*
 * DES SALLES SANS POSITION SUR LE PLAN GÉNÉRAL — et c'est délibéré.
 *
 * Un tracé de salle se dessine dans la SCÈNE de cette salle, où l'on entre directement :
 * le point de la salle sur le plan général n'y sert à rien. Lui en donner un ajoutait deux
 * repères au plan partagé par toutes les recettes, et faisait échouer
 * `map-roles-browser-e2e.mjs`, qui compte les repères du plan — une collision de fixtures,
 * pas un défaut. Une recette ne pose que ce dont elle a besoin.
 */
for (const [id, nom] of [[SALLE_STC, 'STC — recette tracé'], [SALLE_RF1, 'RF1 — recette tracé']]) {
  const existante = (await api(`/api/sync`, A)).charge.data?.rooms?.find(salle => String(salle.id) === String(id));
  const { x: sansX, y: sansY, ...reste } = existante || {};
  await api(`/api/data/rooms/${id}`, { method: 'PUT', ...A, body: { ...reste, id, name: nom } });
}
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_STC, zoneId: ZONE_STC } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_RF1, zoneId: ZONE_RF1 } });

/*
 * LES DEUX BOUTS DANS STC, LE CHEMINEMENT PAR RF1.
 *
 * C'est le seul montage où la garde de TRACÉ est la dernière défense : avec un câble
 * inter-zones, la garde des extrémités refuse déjà tout et masquerait ce qu'on mesure.
 */
const equipement = async (id, nom, port, direction) => {
  const liste = (await api('/api/sync', A)).charge.data?.equipments || [];
  const existant = liste.find(item => String(item.id) === String(id));
  await api(`/api/data/equipments/${id}`, { method: 'PUT', ...A, body: {
    ...(existant || {}), id, name: nom, roomId: SALLE_STC, x_inRoom: 300 + (id % 7) * 40, y_inRoom: 260,
    ports: [{ id: port, number: port, direction, type: 'BNC / SDI' }]
  } });
};
await equipement(9110, 'Ultrix — recette tracé', 'OUT1', 'OUT');
await equipement(9112, 'Moniteur — recette tracé', 'IN9', 'IN');
await equipement(9114, 'Source sans tracé', 'OUT5', 'OUT');
await equipement(9116, 'Cible sans tracé', 'IN5', 'IN');

const seg = (sceneId, waypoints) => ({
  sceneType: 'room', sceneId, naturalWidth: 2000, naturalHeight: 1200, waypoints, anchors: []
});
/*
 * STC (1) → RF1 → STC (2) : une salle traversée DEUX fois, et un milieu de parcours.
 *
 * Les trois segments sont des SALLES CONSÉCUTIVES sans plan général entre elles : ce
 * cheminement ne documente aucune scène commune pour STC→RF1 ni pour RF1→STC. La phrase
 * lue doit donc porter la rupture honnête, comme n'importe quel autre parcours dans ce cas
 * (voir cable-route-presentation.js#estUneRupture).
 */
const TRACE = { version: 1, status: 'verified', segments: [
  seg(SALLE_STC, [{ x: 200, y: 200 }, { x: 600, y: 400 }]),
  seg(SALLE_RF1, [{ x: 100, y: 100 }, { x: 900, y: 500 }]),
  seg(SALLE_STC, [{ x: 900, y: 700 }, { x: 1400, y: 900 }])
] };
const PHRASE_TRACE_ATTENDUE = 'STC — recette tracé (1) → Liaison non cartographiée → '
  + 'RF1 — recette tracé → Liaison non cartographiée → STC — recette tracé (2)';

const poserCable = async (id, source, portSource, cible, portCible, route) => {
  const existant = await lireCable(admin, id);
  await api(`/api/data/cables/${id}`, { method: 'PUT', ...A, expected: 200, body: {
    ...(existant || {}), id, reference: id, category: 'Vidéo', type: 'SDI', status: 'Connecté',
    sourceType: 'equipment', sourceId: source, sourcePortId: portSource,
    destinationType: 'equipment', destinationId: cible, destinationPortId: portCible, route
  } });
};
await poserCable('BR-CAB-TRACE', 9110, 'OUT1', 9112, 'IN9', TRACE);
await poserCable('BR-CAB-NEUF', 9114, 'OUT5', 9116, 'IN5', null);

/*
 * LES ZONES QUE LE PLAN REPRÉSENTE.
 *
 * `canReadOperationalMap` exige `zone.summary.read` sur CHACUNE : l'image est une photo du
 * site entier. Un rôle qui n'en couvre qu'une reçoit « Accès restreint » et n'affiche
 * jamais la carte — ses assertions d'interface seraient toutes sautées, et la recette
 * passerait sans rien avoir vérifié. On donne donc la couverture complète, ce qui est la
 * situation d'un responsable de site réel.
 */
const rattachements = (await api('/api/access/manage', A)).charge?.resourceZones || [];
const zonesDuPlan = [...new Set([ZONE_STC, ZONE_RF1, ...rattachements
  .filter(lien => String(lien.resourceType || '').toLowerCase().startsWith('room'))
  .map(lien => String(lien.zoneId))])];
assert.ok(zonesDuPlan.includes(ZONE_STC) && zonesDuPlan.includes(ZONE_RF1), 'les deux zones de recette doivent être rattachées');

const MDP = 'Recette-Trace-Navigateur-2026!';
const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const comptes = {};
let numero = 9200;

for (const role of ROLES) {
  numero += 1;
  const identifiant = `br-trace-${role}`;
  if (role === 'admin') { comptes[role] = { cookie: admin, role, id: adminUser360?.id ?? 1, user: adminUser360 }; continue; }
  await api(`/api/data/users/${numero}`, { method: 'PUT', ...A, body: {
    id: numero, username: identifiant, fullName: `Recette ${role}`, role, status: 'active',
    password: Buffer.from(MDP, 'utf8').toString('base64')
  } });
  for (const zone of zonesDuPlan) {
    await api('/api/access/memberships', { method: 'POST', ...A, body: { userId: numero, zoneId: zone, responsible: false } });
    for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit', 'cable.read', 'cable.edit']) {
      await api('/api/access/grants', { method: 'POST', ...A, body: { userId: numero, zoneId: zone, permission } });
    }
  }
  const session = await connexion(identifiant, MDP);
  comptes[role] = { cookie: session.cookie, user: session.user, role, id: numero };
}

/*
 * LE COMPTE « LECTURE > ÉDITION ».
 *
 * Même rôle que le chef — le plafond canonique lui permet de modifier un équipement — mais
 * sans `cable.edit` sur RF1. Le tracé traverse RF1 : il le VOIT en entier et ne peut pas
 * le remplacer. C'est le cas que l'écran doit refléter sans jamais proposer « Modifier ».
 */
numero += 1;
const idLecteur = numero;
await api(`/api/data/users/${idLecteur}`, { method: 'PUT', ...A, body: {
  id: idLecteur, username: 'br-trace-lecteur', fullName: 'Recette lecture seule', role: 'chef', status: 'active',
  password: Buffer.from(MDP, 'utf8').toString('base64')
} });
for (const zone of zonesDuPlan) {
  await api('/api/access/memberships', { method: 'POST', ...A, body: { userId: idLecteur, zoneId: zone, responsible: false } });
  for (const permission of ['zone.summary.read', 'equipment.read', 'cable.read']) {
    await api('/api/access/grants', { method: 'POST', ...A, body: { userId: idLecteur, zoneId: zone, permission } });
  }
}
// L'édition, UNIQUEMENT dans STC : il manquera toujours RF1, que le tracé traverse.
for (const permission of ['equipment.edit', 'cable.edit']) {
  await api('/api/access/grants', { method: 'POST', ...A, body: { userId: idLecteur, zoneId: ZONE_STC, permission } });
}
// Rejouable : une exécution précédente a pu accorder RF1. On le retire explicitement.
for (const permission of ['equipment.edit', 'cable.edit']) {
  await api(`/api/access/grants/${encodeURIComponent(`ZG-${idLecteur}-${ZONE_RF1}-${permission}`)}`, { method: 'DELETE', ...A });
}
const sessionLecteur = await connexion('br-trace-lecteur', MDP);
const lecteur = { cookie: sessionLecteur.cookie, user: sessionLecteur.user, role: 'chef (lecture > édition)', id: idLecteur };

/* ═══════════════════ LE NAVIGATEUR ═══════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });

/**
 * COUVRIR LE PLAN, JUSTE AVANT D'OUVRIR LA PAGE DE CE RÔLE.
 *
 * `canReadOperationalMap` exige `zone.summary.read` sur CHAQUE zone que le plan
 * représente : l'image est une photo du site entier. Or le jeu de zones BOUGE pendant la
 * recette — MESURÉ : au tout premier chargement du navigateur contre une base neuve,
 * l'application démarre sa synchronisation et pousse ses données locales, ce qui crée une
 * salle de plus et, avec elle, une zone de plus (`room-…`). Les habilitations posées avant
 * ce chargement ne couvraient donc plus le plan, et les rôles à périmètre recevaient
 * « Accès restreint » — au premier passage seulement, ce qui est la pire sorte d'échec.
 *
 * On recalcule donc la couverture juste avant chaque page, et l'on n'ajoute QUE la lecture
 * de résumé : le cas « lecture > édition » repose sur l'absence de `cable.edit` dans RF1,
 * et rien ici ne doit y toucher.
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
  return zones;
}

/*
 * L'APPLICATION POSE SA PROPRE ROUTE DE SECTION APRÈS LE CHARGEMENT.
 *
 * Une évaluation lancée pendant cette navigation voit son contexte détruit — de façon
 * INTERMITTENTE, ce qui est la pire sorte d'échec : il passe une fois sur deux et fait
 * douter du produit alors que seul le banc d'essai est en cause. On réessaie donc
 * explicitement, comme la recette des six rôles de la carte, au lieu d'espérer.
 */
async function evaluerStable(page, fonction, argument, essais = 4) {
  let derniere = null;
  for (let essai = 0; essai < essais; essai += 1) {
    try { return await page.evaluate(fonction, argument); }
    catch (erreur) {
      // « Failed to fetch » relève de la même cause : la page a navigué pendant que la
      // requête partait. C'est le banc d'essai qui court après l'application, pas un
      // défaut du produit — et le confondre avec un vrai échec ferait douter du bon code.
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError/i.test(String(erreur?.message))) throw erreur;
      derniere = erreur;
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  throw derniere;
}

/**
 * Monte la carte, désigne un câble, entre dans la scène de son tracé, et rend ce que la
 * barre affiche RÉELLEMENT. Tout se passe dans la page : c'est le vrai module, la vraie
 * session, le vrai serveur.
 */
async function ouvrirLeTrace(page, compte, cableId, { scenePourCreation = null } = {}) {
  return evaluerStable(page, async ([role, identifiant, id, sceneCreation, salleStc]) => {
    const { default: openInteractiveMap, ouvrirTraceSurCarte } = await import('./interactive-map.js');
    const couche = await import('./cable-route-layer.js');
    window.__notifs = [];
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    const cables = sync?.data?.cables || [];
    const cable = cables.find(item => String(item.id) === String(id));
    if (!cable) return { absent: true };
    openInteractiveMap({
      rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
      equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
      user: { id: identifiant, role, username: `br-trace-${role}` },
      notifications: { showNotification(message, type) { window.__notifs.push({ message, type }); } }
    });
    for (let essai = 0; essai < 80; essai += 1) {
      if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (document.querySelector('.map-restricted')) return { restreinte: true };
    document.getElementById('welcome-start-btn')?.click();
    await new Promise(r => setTimeout(r, 300));

    const acces = await couche.showCableRoute(cable);
    const vue = couche.routeAffichee();
    const entree = couche.entryScene(vue, { roomId: cable.sourceRoomId ?? null })
      || sceneCreation || { sceneType: 'room', sceneId: salleStc };
    await ouvrirTraceSurCarte(entree, { equipmentId: cable.sourceId });
    /*
     * ON ATTEND QUE LA BARRE SE SOIT STABILISÉE, PAS QU'ELLE EXISTE.
     *
     * Le panneau se peint d'abord avec la capacité SANS scène — le serveur ne calcule pas
     * `creatableHere` sans scène nommée, donc « Ajouter un tracé » n'y figure pas encore —
     * puis il redemande la capacité POUR la scène ouverte et se repeint. Rompre l'attente
     * au premier rendu faisait lire à la recette un écran intermédiaire, et lui faisait
     * conclure à un bouton manquant qui allait apparaître 200 ms plus tard.
     */
    const boutons = () => [...document.querySelectorAll('.route-editor-bar button')]
      .map(item => item.textContent.trim()).join('|');
    let precedent = null;
    let stable = 0;
    for (let essai = 0; essai < 80; essai += 1) {
      const barre = document.querySelector('.route-editor-bar');
      const courant = barre && !barre.hidden ? boutons() : null;
      stable = courant !== null && courant === precedent ? stable + 1 : 0;
      precedent = courant;
      if (stable >= 4 && courant) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return { acces, entree };
  }, [compte.role.split(' ')[0], compte.id, cableId, scenePourCreation, SALLE_STC]);
}

const lireBarre = page => evaluerStable(page, () => {
  const barre = document.querySelector('.route-editor-bar');
  // Des valeurs sûres plutôt qu'un `undefined` : une recette doit RAPPORTER ce qu'elle
  // voit, pas s'effondrer sur la première surprise.
  if (!barre || barre.hidden) {
    return { presente: false, titre: '', pastille: '', message: '', phrase: '',
      boutons: [], passages: [], insertions: [], largeur: 0, dansLEcran: true };
  }
  return {
    presente: true,
    titre: barre.querySelector('.route-editor-title')?.textContent || '',
    pastille: barre.querySelector('.route-editor-badge')?.textContent || '',
    message: barre.querySelector('.route-editor-message')?.textContent || '',
    phrase: barre.querySelector('.route-editor-sentence')?.textContent || '',
    boutons: [...barre.querySelectorAll('button')].map(item => item.textContent.trim()),
    passages: [...barre.querySelectorAll('[data-role="passage"] option')].map(item => item.textContent),
    insertions: [...barre.querySelectorAll('[data-role="insertion"] option')].map(item => item.textContent),
    // Un panneau qui déborde n'est pas utilisable sur une tablette : on mesure, on ne suppose pas.
    largeur: Math.round(barre.getBoundingClientRect().width),
    dansLEcran: barre.getBoundingClientRect().right <= window.innerWidth + 1
      && barre.getBoundingClientRect().left >= -1
  };
});

const cliquerLibelle = (page, libelle) => evaluerStable(page, texte => {
  const cible = [...document.querySelectorAll('.route-editor-bar button')]
    .find(item => item.textContent.trim().startsWith(texte));
  if (!cible) return false;
  cible.click();
  return true;
}, libelle);

const attendre = (page, ms = 400) => page.waitForTimeout(ms);

/*
 * LE PANNEAU FLOTTE AU-DESSUS DU CANEVAS : UN CLIC SOUS SON EMPRISE NE PEINT RIEN.
 *
 * MESURÉ (diagnostic ciblé, `elementsFromPoint`) : un point choisi comme fraction fixe du
 * canevas peut tomber sur `.route-editor-bar` elle-même — le clic n'atteint jamais
 * `surAppui`, la session reste propre, « Enregistrer » reste désactivé, et un `.click()`
 * JavaScript sur un bouton natif désactivé ne déclenche silencieusement rien. On mesure donc
 * aussi le rectangle de la barre, et on choisit un point qui l'évite au lieu de parier sur
 * une fraction fixe qui a pu ne fonctionner qu'à une taille d'écran donnée. Partagée par
 * toutes les sections qui dessinent sur le canevas — jamais redéfinie localement.
 */
function pointLibre(canevas, barre, fx, fy) {
  const essaye = (px, py) => {
    const x = canevas.x + canevas.w * px;
    const y = canevas.y + canevas.h * py;
    const dansLaBarre = barre && x >= barre.x && x <= barre.x + barre.w
      && y >= barre.y && y <= barre.y + barre.h;
    return dansLaBarre ? null : { x, y };
  };
  // On reflète d'abord par rapport au centre du canevas ; si la barre couvrait aussi ce
  // point (panneau très large), on retombe sur le centre pur, loin de tous les bords.
  return essaye(fx, fy) || essaye(1 - fx, 1 - fy) || essaye(0.5, 0.5);
}

const FORMATS = [
  { nom: 'bureau', viewport: { width: 1440, height: 900 } },
  { nom: 'tablette', viewport: { width: 834, height: 1112 } },
  { nom: 'mobile', viewport: { width: 390, height: 844 } }
];

async function pageDe(compte, viewport, { serviceWorkers } = {}) {
  // La couverture du plan est refaite ICI : le jeu de zones a pu changer depuis la mise en place.
  if (compte.id) await couvrirLePlan(compte.id);
  /*
   * `serviceWorkers: 'block'` N'EST PAS UN DÉTAIL — mesuré dans `ui-polish-sync-timeline.mjs`.
   *
   * `service-worker.js` intercepte les requêtes de la PAGE ; une route posée par
   * `page.route()` sur le CONTEXTE ne les atteint jamais quand un Service Worker actif les
   * sert ou les relaie lui-même — la requête part bien vers le réseau, mais depuis
   * l'exécution du worker, pas depuis la page, et `page.route()` ne la voit jamais passer.
   * Une section qui a besoin de retenir une requête précise (pour reproduire une fenêtre de
   * concurrence, par exemple) doit donc bloquer le Service Worker, sous peine de croire
   * mesurer une interception qui ne s'est jamais produite.
   */
  const contexte = await navigateur.newContext({ viewport, ...(serviceWorkers ? { serviceWorkers } : {}) });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  /*
   * LA PAGE DÉMARRE DÉJÀ CONNECTÉE — le cookie seul ne suffit PAS.
   *
   * MESURÉ : avec le seul cookie de session, `db.save` n'envoie RIEN au centre. Il ne
   * pousse que si `localStorage.auth` existe (`hasAuthenticatedIdentity`) et si la
   * synchronisation a démarré ; sinon l'écriture reste locale, sans erreur ni message. La
   * recette aurait conclu à un défaut d'enregistrement là où c'est le banc d'essai qui
   * n'était pas connecté.
   *
   * On pose donc l'identité AVANT le chargement, exactement comme le fait `auth.js` après
   * une connexion réussie, et l'application démarre sa synchronisation elle-même.
   */
  const identite = JSON.stringify(compte.user || { id: compte.id, role: compte.role, username: `br-trace-${compte.role}` });
  await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch { /* stockage indisponible */ } }, identite);
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
  // L'URL stable ne suffit pas : l'application charge encore ses données. On attend le
  // réseau au repos avant de monter quoi que ce soit.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  /*
   * L'ÉCRAN DE DÉMARRAGE DE LA PLATEFORME RESTE AU-DESSUS DE TOUT, PENDANT SA PROPRE
   * ANIMATION — et il faut attendre qu'il s'efface, pas seulement qu'il ait commencé.
   *
   * MESURÉ : `#startup-splash` est posé à `z-index: 2147483000`, position `fixed`,
   * `inset: 0` — un plein écran, PLUS haut que la carte elle-même (`2147482000`) et que
   * sa barre de tracé (`2147482500`). Sa propre séquence (`startup-splash.js`) dure
   * jusqu'à 2200 ms d'affichage, puis 760 ms d'« éveil » (classe `is-awake`), avant de
   * recevoir `startup-ready` — la SEULE classe qui lui donne `pointer-events: none`. Un
   * clic envoyé pendant cette fenêtre atteint le splash, jamais le canevas dessous :
   * `document.elementsFromPoint` le confirme, avec le splash en tête de pile. Ce n'est
   * pas un défaut du produit — la carte n'est même pas encore montée à cet instant —
   * c'est ce banc d'essai qui doit laisser le démarrage se terminer avant de cliquer.
   */
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    if (!splash) return true;
    return getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  return { contexte, page, erreurs };
}

/* ═══════════════════ 1 · LES SIX RÔLES, SUR TROIS FORMATS ═══════════════════ */

const rapport = [];
let echecs = 0;
const verifie = (titre, attendu, obtenu) => {
  const ok = JSON.stringify(attendu) === JSON.stringify(obtenu);
  if (!ok) echecs += 1;
  console.log(`  ${ok ? '✓' : '✗ ÉCHEC'} ${titre}`);
  if (!ok) console.log(`        attendu : ${JSON.stringify(attendu)}\n        obtenu  : ${JSON.stringify(obtenu)}`);
};

/*
 * CE QUE LA MATRICE CANONIQUE PROMET.
 *
 * Le plafond de rôle d'un câble est celui d'`equipments` : admin, manager, chef et
 * responsable peuvent modifier ; technicien et visiteur, non. Les habilitations de zone
 * sont identiques pour tous ici — c'est donc bien le RÔLE qui fait la différence.
 */
const MODIFIE = { admin: true, manager: true, chef: true, responsible: true, technician: false, visitor: false };

/*
 * LE VISITEUR NE REÇOIT AUCUN CÂBLE — ET C'EST UNE DÉCISION, PAS UN DÉFAUT.
 *
 * MESURÉ sur ce serveur : accorder `cable.read` à un visiteur est refusé en 409
 * ROLE_CEILING — « cette permission dépasse le rôle global du bénéficiaire ». Son plafond
 * (`scripts/access-control.js`) est une liste blanche qui ne contient que
 * `zone.summary.read`, `equipment.read`, `screen.read`, `ticket.read`, `note.read` et
 * `procedure.read`. Une habilitation de zone ne peut JAMAIS élever un rôle au-dessus de la
 * matrice canonique : c'est l'arbitrage de ce projet, et il tient ici aussi.
 *
 * Conséquence : `/api/sync` ne lui sert aucun câble, la barre du tracé n'a rien à montrer,
 * et elle ne s'affiche pas. La recette l'exige explicitement plutôt que de constater un
 * écran vide sans savoir pourquoi.
 */
const SANS_CABLE = new Set(['visitor']);

console.log('\n── 1 · les six rôles voient-ils ce que la matrice promet ? ──');
for (const role of ROLES) {
  const compte = comptes[role];
  const { contexte, page, erreurs } = await pageDe(compte, FORMATS[0].viewport);
  const ouvert = await ouvrirLeTrace(page, compte, 'BR-CAB-TRACE');
  if (ouvert.restreinte) {
    verifie(`${role} : la carte s'ouvre`, false, true);
    await contexte.close();
    continue;
  }
  const barre = await lireBarre(page);
  const capacite = await api(`/api/cables/BR-CAB-TRACE/route-access?sceneType=room&sceneId=${SALLE_STC}`, { cookie: compte.cookie });

  if (SANS_CABLE.has(role)) {
    verifie(`${role} : le serveur ne lui sert AUCUN câble`, 404, capacite.statut);
    verifie(`${role} : et la barre du tracé ne s'affiche pas`, false, barre.presente);
    verifie(`${role} : aucune erreur JavaScript`, [], erreurs);
    rapport.push({ role, format: 'bureau', pastille: '— aucun câble servi —', boutons: '—' });
    await contexte.close();
    continue;
  }

  verifie(`${role} : la barre du tracé s'affiche`, true, barre.presente);
  verifie(`${role} : le parcours est énoncé`, PHRASE_TRACE_ATTENDUE, barre.phrase);
  verifie(`${role} : « Modifier le tracé » — matrice canonique`, MODIFIE[role],
    barre.boutons.some(texte => texte.startsWith('Modifier')));
  /*
   * L'ÉCRAN ET LE SERVEUR DISENT LA MÊME CHOSE.
   *
   * Un bouton affiché là où le serveur refuse est une promesse non tenue ; un bouton caché
   * là où il accepte est un droit confisqué. On compare donc les deux, rôle par rôle.
   */
  verifie(`${role} : l'écran dit exactement ce que le serveur répond`, MODIFIE[role], capacite.charge.editable === true);
  verifie(`${role} : aucune erreur JavaScript`, [], erreurs);
  rapport.push({ role, format: 'bureau', pastille: barre.pastille, boutons: barre.boutons.join(' · ') });
  await contexte.close();
}

console.log('\n── 2 · tablette et mobile : la barre reste lisible et dans l\'écran ──');
for (const format of FORMATS.slice(1)) {
  const { contexte, page, erreurs } = await pageDe(comptes.chef, format.viewport);
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-TRACE');
  const barre = await lireBarre(page);
  verifie(`${format.nom} : la barre s'affiche`, true, barre.presente);
  verifie(`${format.nom} : elle tient dans l'écran`, true, barre.dansLEcran);
  verifie(`${format.nom} : « Modifier le tracé » reste atteignable`, true,
    barre.boutons.some(texte => texte.startsWith('Modifier')));
  verifie(`${format.nom} : aucune erreur JavaScript`, [], erreurs);
  rapport.push({ role: 'chef', format: format.nom, pastille: barre.pastille, boutons: `${barre.largeur}px` });
  await contexte.close();
}

/* ═══════════════════ 3 · LECTURE > ÉDITION ═══════════════════ */

console.log('\n── 3 · voir un tracé n\'est PAS pouvoir le remplacer ──');
{
  const { contexte, page } = await pageDe(lecteur, FORMATS[0].viewport);
  await ouvrirLeTrace(page, lecteur, 'BR-CAB-TRACE');
  const barre = await lireBarre(page);
  verifie('le tracé est bien LISIBLE en entier', PHRASE_TRACE_ATTENDUE, barre.phrase);
  verifie('et « Modifier le tracé » n\'est PAS proposé', false, barre.boutons.some(texte => texte.startsWith('Modifier')));
  verifie('l\'écran dit pourquoi, sans nommer la zone qui manque', true,
    /Consultation seule/.test(await evaluerStable(page, () => document.querySelector('.route-editor-hint')?.textContent || '')));
  const fuite = JSON.stringify(barre);
  for (const secret of ['cable.edit', ZONE_RF1, 'habilitation']) {
    verifie(`rien ne fuit du périmètre (« ${secret} »)`, false, fuite.includes(secret));
  }
  await contexte.close();
}

/* ═══════════════════ 4 · LES GESTES, MESURÉS SUR LE PLAN ═══════════════════ */

console.log('\n── 4 · plusieurs passages dans une même scène, insertion, annulation ──');
{
  const { contexte, page, erreurs } = await pageDe(comptes.chef, FORMATS[0].viewport);
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-TRACE');
  verifie('« Modifier » est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);

  const enEdition = await lireBarre(page);
  verifie('la salle traversée deux fois est DÉSAMBIGUÏSÉE',
    ['STC — recette tracé (1)', 'STC — recette tracé (2)'], enEdition.passages);
  verifie('les positions d\'insertion nomment le parcours, dans l\'ordre du relevé',
    ['Avant STC — recette tracé (1)', 'Entre STC — recette tracé (1) et RF1 — recette tracé',
     'Entre RF1 — recette tracé et STC — recette tracé (2)', 'Après STC — recette tracé (2)'],
    enEdition.insertions);
  verifie('la pastille dit encore « vérifié » : rien n\'a bougé', 'Tracé vérifié', enEdition.pastille);

  /* Insertion AU MILIEU — rang absolu 1, entre STC (1) et RF1. */
  verifie('la position d\'insertion est choisie', true, await evaluerStable(page, () => {
    const choix = document.querySelector('.route-editor-bar [data-role="insertion"]');
    if (!choix) return false;
    choix.value = '1';
    choix.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }));
  verifie('« Ouvrir un passage ici » est cliqué', true, await cliquerLibelle(page, 'Ouvrir un passage ici'));
  await attendre(page, 250);

  const sequence = await evaluerStable(page, async () => {
    const couche = await import('./cable-route-layer.js');
    return couche.routeSession().sequence().map(etape => `${etape.sceneType}#${etape.sceneId}`);
  });
  verifie('le passage s\'intercale, et RIEN n\'est réordonné',
    [`room#${SALLE_STC}`, `room#${SALLE_STC}`, `room#${SALLE_RF1}`, `room#${SALLE_STC}`], sequence);

  /* Un point posé sur le plan retire le « vérifié ». */
  const canevas = await evaluerStable(page, () => {
    const boite = document.getElementById('areas-canvas').getBoundingClientRect();
    return { x: boite.left + boite.width * 0.4, y: boite.top + boite.height * 0.5 };
  });
  await page.mouse.click(canevas.x, canevas.y);
  await attendre(page, 250);
  const apresClic = await lireBarre(page);
  verifie('une retouche de géométrie retire le « vérifié »', 'Tracé proposé', apresClic.pastille);
  verifie('et « Enregistrer » devient actif', false,
    await evaluerStable(page, () => [...document.querySelectorAll('.route-editor-bar button')]
      .find(item => item.textContent.trim() === 'Enregistrer')?.disabled ?? true));

  /* ANNULER — l'instantané, au caractère près. */
  verifie('« Annuler » est cliqué', true, await cliquerLibelle(page, 'Annuler'));
  await attendre(page, 250);
  const apresAnnulation = await evaluerStable(page, async () => {
    const couche = await import('./cable-route-layer.js');
    const route = couche.routeAffichee();
    return {
      statut: route?.status,
      segments: route?.segments?.length,
      premier: route?.segments?.[0]?.waypoints,
      edite: couche.isEditing()
    };
  });
  verifie('« Annuler » restitue le relevé EXACT', { statut: 'verified', segments: 3, premier: [{ x: 200, y: 200 }, { x: 600, y: 400 }], edite: false }, apresAnnulation);
  verifie('rien n\'a été écrit au serveur', 'verified',
    (await lireCable(admin, 'BR-CAB-TRACE'))?.route?.status);
  verifie('et le relevé du serveur a toujours ses trois passages', 3,
    (await lireCable(admin, 'BR-CAB-TRACE'))?.route?.segments?.length);
  verifie('aucune erreur JavaScript pendant tous ces gestes', [], erreurs);
  await contexte.close();
}

/* ═══════════════════ 5 · LE PREMIER RELEVÉ, DANS LE NAVIGATEUR ═══════════════════ */

console.log('\n── 5 · un câble SANS tracé : « Ajouter », dessiner, enregistrer ──');
{
  // Rejouable : on repart d'un câble sans relevé, quelle que soit l'exécution précédente.
  const avant = await lireCable(admin, 'BR-CAB-NEUF');
  await api('/api/data/cables/BR-CAB-NEUF', { method: 'PUT', ...A, expected: 200, body: { ...avant, route: null } });

  const { contexte, page, erreurs } = await pageDe(comptes.chef, FORMATS[0].viewport);
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-NEUF', { scenePourCreation: { sceneType: 'room', sceneId: SALLE_STC } });
  const barre = await lireBarre(page);
  verifie('l\'écran dit « Tracé physique non renseigné »', 'Tracé physique non renseigné', barre.message);
  verifie('et propose d\'en ajouter un DANS la scène ouverte', true,
    barre.boutons.some(texte => texte.startsWith('Ajouter un tracé dans STC')));
  verifie('sans proposer de « Modifier » ce qui n\'existe pas', false,
    barre.boutons.some(texte => texte.startsWith('Modifier')));

  verifie('« Ajouter un tracé » est cliqué', true, await cliquerLibelle(page, 'Ajouter un tracé'));
  await attendre(page);
  verifie('« Ouvrir un passage ici » est cliqué', true, await cliquerLibelle(page, 'Ouvrir un passage ici'));
  await attendre(page, 250);

  const boite = await evaluerStable(page, () => {
    const rect = document.getElementById('areas-canvas').getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  });
  await page.mouse.click(boite.x + boite.w * 0.3, boite.y + boite.h * 0.35);
  await attendre(page, 200);
  await page.mouse.click(boite.x + boite.w * 0.6, boite.y + boite.h * 0.6);
  await attendre(page, 200);

  const dessine = await evaluerStable(page, async () => {
    const couche = await import('./cable-route-layer.js');
    return couche.routeSession()?.working()?.segments?.[0]?.waypoints?.length ?? 0;
  });
  verifie('deux points sont posés sur le plan', 2, dessine);

  verifie('« Enregistrer » est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);
  const enregistre = await lireCable(admin, 'BR-CAB-NEUF');
  verifie('le serveur a bien reçu un premier relevé', 1, enregistre?.route?.segments?.length);
  verifie('dans la scène ouverte, et pas ailleurs', String(SALLE_STC), String(enregistre?.route?.segments?.[0]?.sceneId));
  verifie('déclaré « proposé » : personne ne l\'a encore vérifié sur le terrain', 'proposed', enregistre?.route?.status);
  verifie('et le câble a conservé ses extrémités', '9114/OUT5', `${enregistre?.sourceId}/${enregistre?.sourcePortId}`);
  verifie('aucune erreur JavaScript', [], erreurs);
  await contexte.close();
}

/* ═══════════════════ 6 · SUPPRIMER LE TRACÉ N'EST PAS SUPPRIMER LE CÂBLE ═══════════════════ */

console.log('\n── 6 · supprimer le tracé conserve le câble ──');
{
  const { contexte, page, erreurs } = await pageDe(comptes.chef, FORMATS[0].viewport);
  await evaluerStable(page, () => { window.AppDialog = { ...(window.AppDialog || {}), confirm: async () => true }; });
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-NEUF', { scenePourCreation: { sceneType: 'room', sceneId: SALLE_STC } });
  verifie('« Modifier le tracé » est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  verifie('« Supprimer le tracé » est cliqué', true, await cliquerLibelle(page, 'Supprimer le tracé'));
  await attendre(page, 300);
  verifie('« Enregistrer » est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);
  const apres = await lireCable(admin, 'BR-CAB-NEUF');
  verifie('le tracé a disparu', null, apres?.route ?? null);
  verifie('le câble, lui, est toujours là', 'BR-CAB-NEUF', apres?.id);
  verifie('avec ses deux extrémités et leurs ports', '9114/OUT5→9116/IN5',
    `${apres?.sourceId}/${apres?.sourcePortId}→${apres?.destinationId}/${apres?.destinationPortId}`);
  verifie('aucune erreur JavaScript', [], erreurs);
  await contexte.close();
}

/* ═══════════════════ 7 · DEUX ENREGISTREMENTS DE SUITE, MÊME PANNEAU (FIX 1) ═══════════════════ */

console.log('\n── 7 · faux STALE_WRITE sur un second « Enregistrer » dans le même panneau ──');
{
  /*
   * LE DÉFAUT MESURÉ : `refreshRouteView`, appelée après un premier « Enregistrer » réussi,
   * ne rafraîchissait QUE la géométrie et un compteur informatif — jamais la révision
   * PORTÉE par `selection.cable`. Un second « Modifier » + « Enregistrer », dans le MÊME
   * panneau sans rien refermer, repartait donc de la révision D'AVANT le premier
   * enregistrement, et le serveur — déjà plus loin d'un cran — refusait en 409 STALE_WRITE
   * un câble que personne d'autre n'avait touché.
   *
   * Cette section prouve d'abord que DEUX écritures de suite, dans le MÊME panneau,
   * réussissent TOUTES LES DEUX ; puis qu'une VRAIE écriture concurrente d'un AUTRE auteur,
   * entre les deux gestes du panneau, produit encore un VRAI STALE_WRITE — le correctif ne
   * doit affaiblir le contrat de concurrence pour personne d'autre.
   */
  const socle7 = await lireCable(admin, 'BR-CAB-TRACE');
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200, body: { ...socle7, route: TRACE } });

  const { contexte, page, erreurs } = await pageDe(comptes.chef, FORMATS[0].viewport);
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-TRACE');

  const derniereNotif = () => evaluerStable(page, () => window.__notifs.at(-1) || null);
  /*
   * LA BOÎTE DU CANEVAS SE MESURE APRÈS ÊTRE ENTRÉ EN ÉDITION, JAMAIS AVANT.
   *
   * MESURÉ : la capturer en CONSULTATION, avant le premier « Modifier », donnait des
   * coordonnées qui ne pointaient plus sur le bon endroit une fois la barre d'édition
   * affichée — le clic n'ajoutait alors AUCUN point (`dirty` restait `false`, le bouton
   * « Enregistrer » restait désactivé, et le clic dessus ne faisait donc rien). On la
   * redemande à chaque tour, immédiatement après avoir cliqué « Modifier ».
   */
  const boiteCanevas = () => evaluerStable(page, () => {
    const rect = document.getElementById('areas-canvas').getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  });
  /*
   * LE PANNEAU FLOTTE AU-DESSUS DU CANEVAS : UN CLIC SOUS SON EMPRISE NE PEINT RIEN.
   *
   * MESURÉ (diagnostic ciblé, `elementsFromPoint`) : le point (0.6 × largeur, 0.7 × hauteur)
   * du canevas tombe en réalité sur `.route-editor-bar` elle-même — le clic n'atteint jamais
   * `surAppui`, la session reste propre, « Enregistrer » reste désactivé, et un `.click()`
   * JavaScript sur un bouton natif désactivé ne déclenche silencieusement rien. On mesure
   * donc aussi le rectangle de la barre, et on choisit un point qui l'évite au lieu de
   * parier sur une fraction fixe qui a pu ne fonctionner qu'à une taille d'écran donnée.
   */
  const boiteBarre = () => evaluerStable(page, () => {
    const rect = document.querySelector('.route-editor-bar')?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null;
  });
  const revisionActuelle = async () => Number((await lireCable(admin, 'BR-CAB-TRACE'))?._revision);

  console.log('  · 7.1 — premier tour : Modifier, dessiner, Enregistrer');
  const revisionAvant1 = await revisionActuelle();
  verifie('« Modifier » (1er tour) est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  const boite1 = await boiteCanevas();
  const clic1 = pointLibre(boite1, await boiteBarre(), 0.32, 0.44);
  await page.mouse.click(clic1.x, clic1.y);
  await attendre(page, 250);
  verifie('« Enregistrer » (1er tour) est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);
  const notif1 = await derniereNotif();
  verifie('premier enregistrement : succès', 'success', notif1?.type);
  verifie('premier enregistrement : message exact', 'Tracé enregistré.', notif1?.message);
  const revisionApres1 = await revisionActuelle();
  verifie('la révision a progressé après le premier enregistrement', true, revisionApres1 > revisionAvant1);

  console.log('  · 7.2 — SANS fermer le panneau : Modifier de nouveau, dessiner, Enregistrer');
  verifie('« Modifier » (2e tour, MÊME panneau) est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  const boite2 = await boiteCanevas();
  const clic2 = pointLibre(boite2, await boiteBarre(), 0.6, 0.7);
  await page.mouse.click(clic2.x, clic2.y);
  await attendre(page, 250);
  verifie('« Enregistrer » (2e tour) est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);
  const notif2 = await derniereNotif();
  verifie('second enregistrement, MÊME panneau : succès (pas de faux STALE_WRITE)', 'success', notif2?.type);
  verifie('second enregistrement : message exact', 'Tracé enregistré.', notif2?.message);
  const revisionApres2 = await revisionActuelle();
  verifie('la révision a progressé une seconde fois', true, revisionApres2 > revisionApres1);
  verifie('aucune erreur JavaScript pendant les deux premiers tours', [], erreurs);

  console.log('  · 7.3 — témoin : une VRAIE écriture concurrente reste détectée');
  verifie('« Modifier » (3e tour, MÊME panneau) est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  const boite3 = await boiteCanevas();
  const clic3 = pointLibre(boite3, await boiteBarre(), 0.2, 0.2);
  await page.mouse.click(clic3.x, clic3.y);
  await attendre(page, 250);

  // Un AUTRE auteur, par un AUTRE canal HTTP, modifie le MÊME câble pendant que le panneau
  // du premier reste ouvert — un second auteur réel, cette fois.
  const parAutrui = await lireCable(admin, 'BR-CAB-TRACE');
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200,
    body: { ...parAutrui, reference: 'BR-CAB-TRACE-modifie-par-un-autre' } });

  verifie('« Enregistrer » (3e tour, après écriture concurrente) est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);
  const notif3 = await derniereNotif();
  verifie('un VRAI second auteur produit un VRAI STALE_WRITE', 'error', notif3?.type);
  verifie('avec le message de conflit exact', ROUTE_SAVE_MESSAGES.STALE_WRITE, notif3?.message);
  const apresRefus = await lireCable(admin, 'BR-CAB-TRACE');
  verifie('la référence de l\'autre auteur est INTACTE : le refus n\'a rien écrasé',
    'BR-CAB-TRACE-modifie-par-un-autre', apresRefus?.reference);
  verifie('la révision n\'a PAS avancé sous ce refus', revisionApres2 + 1, Number(apresRefus?._revision));

  verifie('aucune erreur JavaScript sur toute la section', [], erreurs);
  await contexte.close();

  // Rejouable : on remet le câble à son état de référence.
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200,
    body: { ...apresRefus, reference: 'BR-CAB-TRACE', route: TRACE } });
}

/* ═══════ 8 · TOCTOU : UN AUTRE AUTEUR ÉCRIT ENTRE L'ÉCRITURE ET SON PROPRE RAFRAÎCHISSEMENT (FIX 1b) ═══════ */

console.log('\n── 8 · TOCTOU — un autre auteur écrit ENTRE le succès du 1er Enregistrer et son rafraîchissement ──');
{
  /*
   * LE DÉFAUT MESURÉ DANS LA PREMIÈRE VERSION DU CORRECTIF FIX 1.
   *
   * Cette première version fermait le faux STALE_WRITE en collant sur `selection.cable` la
   * révision qu'une vue-tracé REDEMANDÉE — un second appel HTTP, séparé de l'écriture
   * elle-même — rapportait à l'instant où elle répondait. Entre le PUT qui vient de réussir
   * et cette vue-là, un AUTRE auteur peut écrire un AUTRE champ du MÊME câble : le serveur
   * en est alors déjà plus loin, et la vue le rapporte fidèlement — mais posée sur les
   * champs métier d'AVANT cette écriture-là, elle fabrique une fiche locale incohérente.
   * Un second « Enregistrer », dans le MÊME panneau, déclare alors cette révision comme la
   * sienne propre : le serveur, qui n'a vu que CETTE valeur-là bouger, l'accepte — et
   * écrase l'écriture de l'autre auteur en silence, sans jamais produire le STALE_WRITE qui
   * aurait dû le protéger.
   *
   * Cette section REPRODUIT la fenêtre exacte avec un VRAI navigateur et un VRAI serveur :
   * on intercepte la PROCHAINE requête `GET .../route-access` — celle que
   * `refreshRouteView()` émet juste après le premier « Enregistrer » — et on la retient
   * QUELQUES INSTANTS. Pendant qu'elle est retenue, un autre auteur écrit RÉELLEMENT, par un
   * second canal HTTP, un champ SANS RAPPORT avec le tracé. On ne relâche la requête
   * qu'ENSUITE.
   */
  const socle8 = await lireCable(admin, 'BR-CAB-TRACE');
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200, body: { ...socle8, route: TRACE } });

  // Service Worker bloqué : cette section retient une requête précise par `page.route()`,
  // ce que le Service Worker actif contournerait silencieusement sinon.
  const { contexte, page, erreurs } = await pageDe(comptes.chef, FORMATS[0].viewport, { serviceWorkers: 'block' });
  await ouvrirLeTrace(page, comptes.chef, 'BR-CAB-TRACE');

  const derniereNotif8 = () => evaluerStable(page, () => window.__notifs.at(-1) || null);
  const boiteCanevas8 = () => evaluerStable(page, () => {
    const rect = document.getElementById('areas-canvas').getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  });
  const boiteBarre8 = () => evaluerStable(page, () => {
    const rect = document.querySelector('.route-editor-bar')?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null;
  });
  const revisionActuelle8 = async () => Number((await lireCable(admin, 'BR-CAB-TRACE'))?._revision);

  console.log('  · 8.1 — premier tour : Modifier, dessiner, PUIS retenir la PROCHAINE vue-tracé');
  const revisionAvant = await revisionActuelle8();
  verifie('« Modifier » (1er tour) est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  const boite1 = await boiteCanevas8();
  const clic1 = pointLibre(boite1, await boiteBarre8(), 0.32, 0.44);
  await page.mouse.click(clic1.x, clic1.y);
  await attendre(page, 250);

  /*
   * LA ROUTE NE SE POSE QU'ICI — APRÈS « Modifier », JAMAIS AVANT.
   *
   * MESURÉ : `beginRouteEdit()` (déclenché par « Modifier ») émet lui aussi une requête
   * `GET .../route-access`. La poser plus tôt aurait retenu CETTE requête-là — bloquant
   * l'entrée en édition elle-même — au lieu de la vue que `refreshRouteView()` redemande
   * APRÈS le succès du premier « Enregistrer », qui est la seule fenêtre que cette section
   * mesure. On n'intercepte que la PROCHAINE requête à partir d'ici : celle-là, et nulle
   * autre.
   */
  let libererLaVue;
  const vueRetenue = new Promise(resolve => { libererLaVue = resolve; });
  let intercepte = false;
  await page.route('**/api/cables/*/route-access**', async route => {
    if (intercepte) { await route.continue(); return; }
    intercepte = true;
    await vueRetenue;
    await route.continue();
  });

  verifie('« Enregistrer » (1er tour) est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  // Le PUT du premier enregistrement a le temps de répondre ; c'est le GET qui le SUIT,
  // celui de `refreshRouteView()`, que la route ci-dessus retient.
  await attendre(page, 700);
  const revisionApresEcriture1 = await revisionActuelle8();
  verifie('le premier PUT a bien avancé la révision AVANT que sa propre vue ne reparte',
    true, revisionApresEcriture1 > revisionAvant);

  console.log('  · 8.2 — PENDANT que la vue-tracé du 1er tour est retenue, un AUTRE auteur écrit un AUTRE champ');
  const parAutrui8 = await lireCable(admin, 'BR-CAB-TRACE');
  verifie('l\'autre auteur part de la révision QUE LE PREMIER ENREGISTREMENT VIENT DE PRODUIRE',
    revisionApresEcriture1, Number(parAutrui8?._revision));
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200,
    body: { ...parAutrui8, reference: 'BR-CAB-TRACE-toctou-autre-auteur' } });
  const revisionApresAutrui = await revisionActuelle8();
  verifie('l\'écriture de l\'autre auteur a bien avancé la révision', true, revisionApresAutrui > revisionApresEcriture1);

  console.log('  · 8.3 — on relâche la vue-tracé RETENUE du 1er tour, puis on enregistre un 2e tracé');
  libererLaVue();
  await attendre(page, 500);
  verifie('« Modifier » (2e tour, MÊME panneau) est cliqué', true, await cliquerLibelle(page, 'Modifier le tracé'));
  await attendre(page);
  const boite2 = await boiteCanevas8();
  const clic2 = pointLibre(boite2, await boiteBarre8(), 0.6, 0.7);
  await page.mouse.click(clic2.x, clic2.y);
  await attendre(page, 250);
  verifie('« Enregistrer » (2e tour) est cliqué', true, await cliquerLibelle(page, 'Enregistrer'));
  await attendre(page, 900);

  const notif8 = await derniereNotif8();
  verifie('le 2e tour reçoit un VRAI STALE_WRITE — la vue retenue du 1er tour ne doit avoir rien laissé croire d\'autre',
    'error', notif8?.type);
  verifie('avec le message de conflit exact', ROUTE_SAVE_MESSAGES.STALE_WRITE, notif8?.message);
  const apresRefus8 = await lireCable(admin, 'BR-CAB-TRACE');
  verifie('la référence de l\'AUTRE AUTEUR reste INTACTE : le 2e tour ne l\'a PAS écrasée en silence',
    'BR-CAB-TRACE-toctou-autre-auteur', apresRefus8?.reference);
  verifie('la révision n\'a PAS avancé sous ce refus', revisionApresAutrui, Number(apresRefus8?._revision));
  verifie('aucune erreur JavaScript sur toute la section', [], erreurs);

  await contexte.close();

  // Rejouable : on remet le câble à son état de référence.
  await api('/api/data/cables/BR-CAB-TRACE', { method: 'PUT', ...A, expected: 200,
    body: { ...apresRefus8, reference: 'BR-CAB-TRACE', route: TRACE } });
}

await navigateur.close();

console.log('\n  rôle                       format     pastille              boutons');
console.log('  ' + '─'.repeat(96));
for (const ligne of rapport) {
  console.log(`  ${ligne.role.padEnd(26)} ${ligne.format.padEnd(10)} ${ligne.pastille.padEnd(21)} ${ligne.boutons}`);
}
console.log(`\nRecette navigateur du tracé : ${echecs === 0 ? 'PASS' : `${echecs} ÉCHEC(S)`}`);
process.exit(echecs === 0 ? 0 : 1);
