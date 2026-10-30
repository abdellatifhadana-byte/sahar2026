/**
 * @file scripts/map-roles-browser-e2e.mjs — RECETTE NAVIGATEUR DES SIX RÔLES.
 *
 * Ce que cette recette vérifie, et ce qu'elle ne vérifie pas.
 *
 * Elle ouvre un VRAI Chromium, charge la plateforme, et rend la carte pour chacun des six
 * rôles canoniques avec des données de test isolées. Elle inspecte ensuite le DOM réel :
 * ce qui est dessiné, ce qui ne l'est pas, et ce que le serveur répond à une requête
 * directe. Les épreuves de contrat disent ce que le code DEVRAIT faire ; celle-ci regarde
 * ce qu'il fait.
 *
 * Elle ne rejoue pas le parcours applicatif complet (connexion, tableau de bord, routage
 * par section) : elle monte le module de carte tel que l'application l'appelle, avec un
 * utilisateur réel et une session réelle. La distinction est dite ici pour qu'on ne lise
 * pas ce rapport comme plus large qu'il n'est.
 *
 * AUCUNE donnée de production : base dédiée, entités préfixées, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4192';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';

const MDP = {
  manager: 'Mgr-Cascade-Orage-7741', chef: 'Chf-Cascade-Orage-7742',
  responsible: 'Rsp-Cascade-Orage-7743', technician: 'Tch-Cascade-Orage-7744',
  visitor: 'Vst-Cascade-Orage-7745'
};

async function api(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
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
  const { cookie } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return cookie;
};

/* ═══════════════ la scène de test, posée par l'administrateur ═══════════════ */

const admin = await connexion(adminUser, adminPass);
const zone = (await api('/api/access/zones', { method: 'POST', cookie: admin, body: { name: 'Recette Rôles', status: 'active' } })).charge.zone;

await api('/api/rooms/transfer', { method: 'POST', cookie: admin, body: {
  formatVersion: 2,
  rooms: [
    { id: 'br-salle-forme', name: 'Salle à forme', shape: { type: 'rect', x: 300, y: 200, w: 420, h: 260 } },
    { id: 'br-salle-point', name: 'Salle à point', x: 1200, y: 700 },
    { id: 'br-salle-sans', name: 'Salle sans position' }
  ],
  roomZones: []
} });
for (const salle of ['br-salle-forme', 'br-salle-point', 'br-salle-sans']) {
  await api('/api/access/resource-zones', { method: 'POST', cookie: admin, expected: null, body: { resourceType: 'room', resourceId: salle, zoneId: zone.id } });
}
await api('/api/data/baies/br-baie', { method: 'PUT', cookie: admin, expected: null, body: { id: 'br-baie', name: 'Baie recette', roomId: 'br-salle-forme', x_inRoom: 240, y_inRoom: 180 } });
await api('/api/data/equipments/br-eq-baie', { method: 'PUT', cookie: admin, expected: null, body: { id: 'br-eq-baie', name: 'Équipement en baie', roomId: 'br-salle-forme', baieId: 'br-baie', x_inBaie: 90, y_inBaie: 140 } });
await api('/api/data/equipments/br-eq-salle', { method: 'PUT', cookie: admin, expected: null, body: { id: 'br-eq-salle', name: 'Équipement en salle', roomId: 'br-salle-forme', x_inRoom: 520, y_inRoom: 320 } });

/*
 * Les zones que le plan représente : toutes celles auxquelles une salle est rattachée. Le
 * serveur applique exactement ce critère (`operationalMapZones`) pour décider qui peut
 * recevoir les octets du plan.
 */
const rattachements = (await api('/api/access/manage', { cookie: admin, expected: null })).charge?.resourceZones || [];
const zonesDuPlan = [...new Set([zone.id, ...rattachements
  .filter(item => String(item.resourceType || '').toLowerCase().startsWith('room'))
  .map(item => String(item.zoneId))])];

let compteur = 10;
const comptes = { admin: { cookie: admin, role: 'admin' } };
for (const [role, motDePasse] of Object.entries(MDP)) {
  const identifiant = `br-${role}`;
  compteur += 1;
  await api(`/api/data/users/${compteur}`, { method: 'PUT', cookie: admin, expected: null, body: {
    id: compteur, username: identifiant, fullName: `Recette ${role}`, role, status: 'active',
    password: Buffer.from(motDePasse, 'utf8').toString('base64')
  } });
  /*
   * COUVERTURE COMPLÈTE DES ZONES — ET C'EST NÉCESSAIRE POUR QUE CETTE RECETTE MESURE
   * QUELQUE CHOSE.
   *
   * `canReadOperationalMap` exige `zone.summary.read` sur CHAQUE zone que le plan
   * représente : l'image est une seule photo du site entier, et la servir à quelqu'un qui
   * n'a qu'une zone lui montrerait les autres. C'est un contrat délibéré, et il est juste.
   *
   * Conséquence pour la recette : un rôle adhérent d'UNE SEULE zone reçoit l'écran « Accès
   * restreint » et n'affiche jamais la carte — ses assertions d'interface seraient alors
   * toutes sautées, et la recette passerait sans rien avoir vérifié. On donne donc à chaque
   * rôle la couverture complète, ce qui est la situation d'un responsable de site réel.
   */
  await api('/api/access/memberships', { method: 'POST', cookie: admin, expected: null, body: { userId: compteur, zoneId: zone.id, responsible: false } });
  for (const zoneCouverte of zonesDuPlan) {
    await api('/api/access/memberships', { method: 'POST', cookie: admin, expected: null, body: { userId: compteur, zoneId: zoneCouverte, responsible: false } });
    for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit', 'room.edit', 'screen.read']) {
      await api('/api/access/grants', { method: 'POST', cookie: admin, body: { userId: compteur, zoneId: zoneCouverte, permission }, expected: null });
    }
  }
  comptes[role] = { cookie: await connexion(identifiant, motDePasse), role, id: compteur };
}

/* ═══════════════ ce que la matrice canonique promet, rôle par rôle ═══════════════ */

const ATTENDU = {
  admin:       { edition: true,  creerSalle: true,  creerBaie: true,  supprimer: true  },
  manager:     { edition: true,  creerSalle: true,  creerBaie: true,  supprimer: true  },
  chef:        { edition: true,  creerSalle: true,  creerBaie: true,  supprimer: false },
  responsible: { edition: true,  creerSalle: false, creerBaie: false, supprimer: false },
  technician:  { edition: false, creerSalle: false, creerBaie: false, supprimer: false },
  visitor:     { edition: false, creerSalle: false, creerBaie: false, supprimer: false }
};

/*
 * L'application pose sa propre route de section après le chargement. Une évaluation lancée
 * pendant cette navigation voit son contexte détruit — de façon INTERMITTENTE, ce qui est
 * la pire sorte d'échec : il passe une fois sur deux et fait douter du produit alors que
 * seul le banc d'essai est en cause. On réessaie donc explicitement, au lieu d'espérer.
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

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const rapport = [];

for (const [role, compte] of Object.entries(comptes)) {
  const attendu = ATTENDU[role];
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  const [nom, valeur] = compte.cookie.split('=');
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  /*
   * L'application redirige elle-même vers sa route de section au démarrage. Évaluer avant
   * qu'elle se soit posée détruisait le contexte d'exécution en pleine inspection : on
   * attend donc le réseau au repos, puis la stabilité de l'URL, plutôt qu'un délai deviné.
   */
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  let urlPrecedente = '';
  for (let essai = 0; essai < 20; essai += 1) {
    const urlCourante = page.url();
    if (urlCourante === urlPrecedente) break;
    urlPrecedente = urlCourante;
    await page.waitForTimeout(250);
  }
  // L'URL stable ne suffit pas : l'application charge encore ses données.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);

  // On monte la carte comme l'application le fait : le VRAI module, un utilisateur réel.
  const monte = await evaluerStable(page, async ([roleCourant, identifiant]) => {
    const { default: openInteractiveMap } = await import('./interactive-map.js');
    /*
     * Les données viennent de `/api/sync`, et non d'IndexedDB : au moment où cette recette
     * s'exécute, la synchronisation locale peut n'avoir encore rien déposé, et la carte
     * s'afficherait alors vide — ce qui ne prouverait rien. `/api/sync` a l'avantage
     * supplémentaire d'être DÉJÀ filtré par le périmètre du rôle : ce qu'on passe à la
     * carte est exactement ce que ce rôle a le droit de voir.
     */
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    const rooms = sync?.data?.rooms || [];
    const baies = sync?.data?.baies || [];
    const equipments = sync?.data?.equipments || [];
    const walls = sync?.data?.walls || [];
    openInteractiveMap({
      rooms, baies, equipments, walls,
      user: { id: identifiant, role: roleCourant, username: `br-${roleCourant}` },
      notifications: { showNotification() {} }
    });
    for (let essai = 0; essai < 80; essai += 1) {
      if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    document.getElementById('welcome-start-btn')?.click();
    await new Promise(r => setTimeout(r, 400));
    return { monte: Boolean(document.getElementById('map-container') || document.querySelector('.map-restricted')), salles: rooms.length };
  }, [compte.role, compte.id ?? 1]);
  assert.ok(monte.monte, `${role} : la carte ne s'est pas montée`);
  assert.ok(monte.salles >= 1, `${role} : aucune salle servie par /api/sync — le périmètre du rôle est vide`);

  const vu = await evaluerStable(page, () => ({
    restreinte: Boolean(document.querySelector('.map-restricted')),
    barreEdition: Boolean(document.getElementById('edit-mode-btn')),
    ajouterSalle: Boolean(document.getElementById('add-room-btn')),
    ajouterBaie: Boolean(document.getElementById('add-baie-btn')),
    reperesBaie: document.querySelectorAll('#map-hotspots .map-hotspot.baie').length,
    reperesEquipement: document.querySelectorAll('#map-hotspots .map-hotspot.equipment').length,
    reperesSalle: document.querySelectorAll('#map-hotspots .map-hotspot.room').length,
    zonesCliquables: document.querySelectorAll('#map-shape-hits [data-type="room"]').length,
    tiroirVisible: (document.getElementById('map-non-positionnes')?.style.display || 'none') !== 'none',
    zoneFocusable: document.querySelector('#map-shape-hits [data-type="room"]')?.getAttribute('tabindex') === '0',
    zoneTransparente: document.querySelector('#map-shape-hits [data-type="room"]')?.getAttribute('fill') === 'transparent'
  }));

  if (!vu.restreinte) {
    assert.equal(vu.barreEdition, attendu.edition, `${role} : bouton « mode édition » — attendu ${attendu.edition}`);
    assert.equal(vu.ajouterSalle, attendu.creerSalle, `${role} : bouton « ajouter une salle » — attendu ${attendu.creerSalle}`);
    assert.equal(vu.ajouterBaie, attendu.creerBaie, `${role} : bouton « ajouter une baie » — attendu ${attendu.creerBaie}`);
    assert.equal(vu.reperesBaie, 0, `${role} : aucune baie ne doit être posée sur le plan général`);
    assert.equal(vu.reperesEquipement, 0, `${role} : aucun équipement ne doit être posé sur le plan général`);
    assert.equal(vu.tiroirVisible, false, `${role} : « Non positionnés » ne s'affiche pas en consultation`);
    assert.ok(vu.zonesCliquables >= 1, `${role} : la salle à forme doit offrir une ZONE cliquable`);
    assert.equal(vu.zoneFocusable, true, `${role} : la zone doit être atteignable au clavier`);
    assert.equal(vu.zoneTransparente, true, `${role} : au repos, la zone doit être invisible`);
    assert.equal(vu.reperesSalle, 1, `${role} : seule la salle à POINT reçoit un repère (celle sans position reste hors du plan)`);
  }
  assert.deepEqual(erreurs, [], `${role} : erreurs JavaScript dans la page`);

  /* le serveur, interrogé DIRECTEMENT — l'écran ne fait pas l'autorisation */
  const misAJour = await api('/api/data/equipments/br-eq-salle', { method: 'PUT', cookie: compte.cookie, expected: null,
    body: { id: 'br-eq-salle', name: 'Équipement en salle', roomId: 'br-salle-forme' } });
  const supprime = await api('/api/data/baies/br-baie', { method: 'DELETE', cookie: compte.cookie, expected: null });

  /*
   * DEUX GRANULARITÉS DE REFUS DE RÔLE, ET C'EST COHÉRENT.
   *
   *   FORBIDDEN              le rôle n'écrit dans AUCUN magasin — garde de magasin, qui
   *                          précède tout le reste. C'est le cas du visiteur.
   *   ROLE_ACTION_FORBIDDEN  le rôle écrit ailleurs, mais pas CET acte sur CE type.
   *
   * Ce que la recette exige, c'est qu'aucun des deux ne se présente comme un refus de
   * ZONE : un administrateur qui lit `ZONE_FORBIDDEN` ira chercher dans les habilitations
   * un refus qui vient de la matrice des rôles.
   */
  const REFUS_DE_ROLE = ['ROLE_ACTION_FORBIDDEN', 'FORBIDDEN'];
  const editionPermise = ['admin', 'manager', 'chef', 'responsible'].includes(role);
  if (!editionPermise) {
    assert.equal(misAJour.statut, 403, `${role} : l'édition directe d'un équipement doit être refusée`);
    assert.ok(REFUS_DE_ROLE.includes(misAJour.charge.error),
      `${role} : refus attendu de rôle, reçu « ${misAJour.charge.error} »`);
    assert.notEqual(misAJour.charge.error, 'ZONE_FORBIDDEN', `${role} : ce n'est pas un refus de périmètre`);
  }
  if (!attendu.supprimer) {
    assert.equal(supprime.statut, 403, `${role} : la suppression directe doit être refusée`);
    assert.ok(REFUS_DE_ROLE.includes(supprime.charge.error),
      `${role} : refus attendu de rôle, reçu « ${supprime.charge.error} »`);
    assert.notEqual(supprime.charge.error, 'ZONE_FORBIDDEN', `${role} : ce n'est pas un refus de périmètre`);
  }

  rapport.push({ role, restreinte: vu.restreinte, edition: vu.barreEdition, zones: vu.zonesCliquables,
    baies: vu.reperesBaie, equipements: vu.reperesEquipement, tiroir: vu.tiroirVisible,
    put: misAJour.statut, del: supprime.statut, refus: supprime.charge.error || '—' });
  await contexte.close();
}

await navigateur.close();

console.log('\n  rôle          carte    édition  zones  baies  équip  tiroir   PUT  DEL  refus');
console.log('  ' + '─'.repeat(70));
for (const l of rapport) {
  console.log(`  ${l.role.padEnd(13)} ${(l.restreinte ? 'restreinte' : 'ouverte').padEnd(8)} ${String(l.edition).padEnd(8)} ${String(l.zones).padEnd(6)} ${String(l.baies).padEnd(6)} ${String(l.equipements).padEnd(6)} ${String(l.tiroir).padEnd(8)} ${String(l.put).padEnd(4)} ${String(l.del).padEnd(4)} ${l.refus}`);
}
console.log('\nRecette navigateur six rôles : PASS');
