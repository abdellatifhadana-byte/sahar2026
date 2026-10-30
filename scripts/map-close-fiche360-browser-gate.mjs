/**
 * @file scripts/map-close-fiche360-browser-gate.mjs — FERMER LA CARTE NE DOIT PAS LEVER.
 *
 * DÉFAUT MESURÉ (MAP-01, relecture directe de la source puis reproduction navigateur).
 *
 * `interactive-map.js` déclare `closeMap` dans la portée de `openInteractiveMap()`
 * (lignes 195-2655), et cette fonction appelle `fermerFormesImbriquees()`. Or
 * `fermerFormesImbriquees` est déclarée dans `renderMapUI()` (611-2652) — une portée
 * ENFANT. Une fonction extérieure ne voit pas une liaison qui n'existe que dans une portée
 * fille : l'appel lève donc `ReferenceError`.
 *
 * La ligne fautive est la DEUXIÈME du nettoyage. Tout ce qui la suit — retrait de l'écran
 * d'accueil, `mapCleanup`, `__mapFitCleanup`, retrait du `#map-modal`, sortie du plein
 * écran, libération de `activeMapClose`, notification — ne s'exécute jamais.
 *
 * Le chemin de l'AUDIENCE passe précisément par là. `map-equipment-360-bridge.js` fait,
 * dans cet ordre : `contexteCarte()` → `closeInteractiveMap({notify:false})` →
 * `open360(equipmentId)`. L'exception tombe donc AVANT l'ouverture de la Fiche 360 : le
 * clic sur un équipement du plan n'ouvre rien, et laisse le plan monté.
 *
 * Cette recette ouvre un VRAI Chromium contre un VRAI serveur et mesure la fermeture
 * elle-même — exception, démontage, et la traversée complète Carte → Fiche 360.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

/*
 * Une VRAIE image : le canevas des formes imbriquées ne se dimensionne que si
 * `img.naturalWidth` est non nul (`dimensionnerCanevas`), et sans dimension il ne dessine
 * rien — donc aucune liste « à placer », donc aucun éditeur à ouvrir. Un chemin inventé
 * laisserait la recette verte sans avoir rien ouvert.
 */
const PHOTO_REELLE = `data:image/png;base64,${readFileSync(new URL('../assets/favicon.png', import.meta.url)).toString('base64')}`;

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
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
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError/i.test(String(erreur?.message))) throw erreur;
      derniere = erreur;
      await page.waitForTimeout(300);
    }
  }
  throw derniere;
}

/* ═══════════════════ la scène ═══════════════════ */

const admin = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const ZONE = 'br-mapclose-zone';
const SALLE = 9501;
const BAIE = 'br-mapclose-baie';
const EQUIP = 'br-mapclose-equip';
// Scène dédiée au nettoyage des formes imbriquées : une salle AVEC photo réelle, et une
// baie SANS coordonnées ni forme — seule une entité « non placée » alimente la liste qui
// ouvre l'éditeur.
const SALLE_PHOTO = 9502;
const BAIE_LIBRE = 'br-mapclose-baie-libre';
// Le compte réellement restreint : visiteur, aucune habilitation de zone.
const VISITEUR = 'br-mapclose-visiteur';
const MDP_VISITEUR = 'Br-MapClose-2026!';

const lireExistant = async (store, id) => {
  const sync = (await api('/api/sync', A)).charge.data || {};
  return (sync[store] || []).find(item => String(item.id) === String(id)) || null;
};

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette fermeture', publicSummary: 'Zone de recette' } });
await api(`/api/data/rooms/${SALLE}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('rooms', SALLE)), id: SALLE, name: 'Salle recette fermeture', x: 500, y: 400 } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE, zoneId: ZONE } });
await api(`/api/data/baies/${BAIE}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('baies', BAIE)), id: BAIE, name: 'Baie recette fermeture', roomId: SALLE, x_inRoom: 700, y_inRoom: 500 } });
await api(`/api/data/equipments/${EQUIP}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('equipments', EQUIP)), id: EQUIP, name: 'Équipement recette', baieId: BAIE, roomId: SALLE, type: 'Autre', status: 'actif' } });

// ── la scène des formes imbriquées
await api(`/api/data/rooms/${SALLE_PHOTO}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('rooms', SALLE_PHOTO)), id: SALLE_PHOTO, name: 'Salle photo recette', x: 900, y: 600, image: PHOTO_REELLE } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE_PHOTO, zoneId: ZONE } });
{
  // Une baie SANS `x_inRoom`/`y_inRoom` ni `shapeInRoom` : c'est ce qui la rend « à placer ».
  const existante = await lireExistant('baies', BAIE_LIBRE) || {};
  const { x_inRoom: _x, y_inRoom: _y, shapeInRoom: _forme, ...propre } = existante;
  await api(`/api/data/baies/${BAIE_LIBRE}`, { method: 'PUT', ...A,
    body: { ...propre, id: BAIE_LIBRE, name: 'Baie à placer', roomId: SALLE_PHOTO } });
}

// ── le compte restreint, créé et connecté pour de vrai
await api(`/api/data/users/${VISITEUR}`, { method: 'PUT', ...A, expected: null, body: {
  id: VISITEUR, username: VISITEUR, role: 'visitor', fullName: 'Visiteur recette',
  status: 'active', password: Buffer.from(MDP_VISITEUR, 'utf8').toString('base64')
} });
const sessionVisiteur = await connexion(VISITEUR, MDP_VISITEUR);
/*
 * On PROUVE que ce compte est réellement hors périmètre, côté serveur, avant de s'en
 * servir : `/api/settings/map-image` est le seul chemin vers les octets du plan, et c'est
 * son refus qui produit l'état « Accès restreint ». Sans cette vérification, la recette
 * reposerait sur une hypothèse au lieu d'un fait.
 */
const refusPlan = await api('/api/settings/map-image', { cookie: sessionVisiteur, expected: null });
verifie('le compte restreint se voit refuser le plan par le SERVEUR', true, refusPlan.statut === 403);
const accesPlanAdmin = await api('/api/settings/map-image', { ...A, expected: null });
verifie('l’administrateur, lui, obtient bien le plan', 200, accesPlanAdmin.statut);

/* ═══════════════════ le navigateur ═══════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const [nom, valeur] = admin.split('=');
await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
const page = await contexte.newPage();
const erreursPage = [];
page.on('pageerror', erreur => erreursPage.push(String(erreur.message)));

await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
let urlPrecedente = '';
for (let essai = 0; essai < 20; essai += 1) {
  const urlCourante = page.url();
  if (urlCourante === urlPrecedente) break;
  urlPrecedente = urlCourante;
  await page.waitForTimeout(250);
}
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(300);

/** Monte la carte et attend son conteneur. Rendu partagé par tous les cas ci-dessous. */
const monterLaCarte = () => evaluerStable(page, async () => {
  const { default: openInteractiveMap } = await import('./interactive-map.js');
  const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
  window.__ouvrirCarte = openInteractiveMap;
  window.__jeu = {
    rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
    equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || []
  };
  window.__fermetures = 0;
  openInteractiveMap({
    ...window.__jeu,
    user: { id: 1, role: 'admin', username: 'br-mapclose-admin' },
    notifications: { showNotification() {} },
    onClose: () => { window.__fermetures += 1; }
  });
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 400));
  return Boolean(document.getElementById('map-container'));
});

console.log('\n── A · fermeture d’une carte montée ──');
verifie('la carte est montée', true, await monterLaCarte());

const fermeture = await evaluerStable(page, async () => {
  const { closeInteractiveMap } = await import('./interactive-map.js');
  let erreur = null;
  try { closeInteractiveMap({ notify: false }); }
  catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 200));
  return {
    erreur,
    modalePresente: Boolean(document.getElementById('map-modal')),
    conteneurPresent: Boolean(document.getElementById('map-container')),
    notifications: window.__fermetures
  };
});
verifie('aucune exception levée', null, fermeture.erreur);
verifie('la modale du plan est retirée', false, fermeture.modalePresente);
verifie('le conteneur du plan est retiré', false, fermeture.conteneurPresent);
verifie('`notify:false` n’appelle pas `onClose`', 0, fermeture.notifications);

console.log('\n── B · ouvrir la carte DEUX fois dans le même onglet ──');
const deuxFois = await evaluerStable(page, async () => {
  const sync = window.__jeu;
  const options = {
    ...sync, user: { id: 1, role: 'admin', username: 'br-mapclose-admin' },
    notifications: { showNotification() {} }
  };
  let erreur = null;
  window.__ouvrirCarte(options);
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 300));
  // La SECONDE ouverture referme la première : `previousClose?.({ notify:false })`.
  try { window.__ouvrirCarte(options); }
  catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 300));
  return {
    erreur,
    modales: document.querySelectorAll('#map-modal').length,
    conteneurs: document.querySelectorAll('#map-container').length
  };
});
verifie('la seconde ouverture ne lève pas', null, deuxFois.erreur);
verifie('une seule modale de plan subsiste', 1, deuxFois.modales);
verifie('un seul conteneur de plan subsiste', 1, deuxFois.conteneurs);

console.log('\n── C · Carte → Fiche 360, par le vrai pont ──');
const versFiche = await evaluerStable(page, async (equipId) => {
  const pont = await import('./map-equipment-360-bridge.js');
  // Un substitut d'ouverture de fiche : on mesure qu'il est ATTEINT, pas ce qu'il dessine.
  window.__ouverte360 = null;
  /*
   * `window.TechOperations` est posé GELÉ par `operations-suite.js` : écrire dans une de
   * ses propriétés ne fait rien du tout, en silence. On remplace donc l'objet entier —
   * la propriété de `window`, elle, reste inscriptible.
   */
  const precedent = window.TechOperations;
  window.TechOperations = Object.freeze({
    ...(precedent || {}),
    openEquipment360: async id => {
      window.__ouverte360 = String(id);
      const feuille = document.createElement('div');
      feuille.className = 'ops-modal';
      feuille.id = 'recette-fiche-360';
      document.body.appendChild(feuille);
    }
  });
  let erreur = null, rendu = null;
  try { rendu = await pont.openMapEquipment360(equipId); }
  catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 300));
  const etat = {
    erreur, rendu,
    ouverte360: window.__ouverte360,
    planEncoreMonte: Boolean(document.getElementById('map-modal')),
    ficheMontee: Boolean(document.getElementById('recette-fiche-360'))
  };
  window.TechOperations = precedent;
  return etat;
}, EQUIP);
verifie('le pont ne lève pas', null, versFiche.erreur);
verifie('le pont rend `true` (il a agi)', true, versFiche.rendu);
verifie('la Fiche 360 est réellement atteinte', String(EQUIP), versFiche.ouverte360);
verifie('la fiche est montée', true, versFiche.ficheMontee);
verifie('le plan a bien été retiré avant la fiche', false, versFiche.planEncoreMonte);

console.log('\n── D · retour au contexte après fermeture de la Fiche 360 ──');
const retour = await evaluerStable(page, async ([salleId, equipId]) => {
  const { default: openInteractiveMap, contexteCarte } = await import('./interactive-map.js');
  const pont = await import('./map-equipment-360-bridge.js');
  document.getElementById('recette-fiche-360')?.remove();
  openInteractiveMap({
    ...window.__jeu, user: { id: 1, role: 'admin', username: 'br-mapclose-admin' },
    notifications: { showNotification() {} }
  });
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 400));
  // On entre dans la salle : c'est ce contexte qui doit être retrouvé.
  document.querySelector(`.map-hotspot.room[data-id="${salleId}"]`)?.click();
  await new Promise(r => setTimeout(r, 500));
  const vueAvant = contexteCarte()?.vue?.type || null;

  window.TechOperations = Object.freeze({
    ...(window.TechOperations || {}),
    openEquipment360: async () => {
      const feuille = document.createElement('div');
      feuille.className = 'ops-modal';
      feuille.id = 'recette-fiche-360';
      document.body.appendChild(feuille);
    }
  });
  let erreurPont = null;
  try { await pont.openMapEquipment360(equipId); }
  catch (e) { erreurPont = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 300));
  // Fermer la fiche : l'observateur du pont doit remonter le plan au même endroit.
  document.getElementById('recette-fiche-360')?.remove();
  for (let essai = 0; essai < 120; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  await new Promise(r => setTimeout(r, 600));
  return { vueAvant, erreurPont, vueApres: contexteCarte()?.vue?.type || null, planRemonte: Boolean(document.getElementById('map-modal')) };
}, [SALLE, EQUIP]);
verifie('le contexte avant la fiche est bien la salle', 'room', retour.vueAvant);
verifie('le pont ne lève pas depuis une vue Salle', null, retour.erreurPont);
verifie('le plan est remonté après fermeture de la fiche', true, retour.planRemonte);
verifie('et il revient au MÊME contexte', 'room', retour.vueApres);

console.log('\n── E · fermeture répétée et notification ──');
const repetee = await evaluerStable(page, async () => {
  const { default: openInteractiveMap, closeInteractiveMap } = await import('./interactive-map.js');
  window.__fermetures = 0;
  openInteractiveMap({
    ...window.__jeu, user: { id: 1, role: 'admin', username: 'br-mapclose-admin' },
    notifications: { showNotification() {} },
    onClose: () => { window.__fermetures += 1; }
  });
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 400));
  let erreur = null;
  try {
    closeInteractiveMap();          // fermeture normale : notifie
    closeInteractiveMap();          // rejouée : ne doit ni notifier ni lever
    closeInteractiveMap({ notify: false });
  } catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 200));
  return { erreur, notifications: window.__fermetures, modalePresente: Boolean(document.getElementById('map-modal')) };
});
verifie('la fermeture répétée ne lève pas', null, repetee.erreur);
verifie('`onClose` n’est appelé qu’une fois', 1, repetee.notifications);
verifie('le plan reste démonté', false, repetee.modalePresente);

console.log('\n── F · carte RÉELLEMENT restreinte, dans une session NON autorisée ──');
/*
 * CE CAS NE VAUT QUE S'IL EST VRAIMENT RESTREINT.
 *
 * Une première version se contentait de changer l'objet `user` côté client et d'accepter
 * « `#map-container` OU `.map-restricted` ». Elle ne prouvait rien : la page portait
 * toujours la session ADMIN, `planAutorise` restait vrai, et la boucle se satisfaisait de
 * la carte normale — donc d'un `renderMapUI()` qui a DÉJÀ branché le vrai crochet. Le
 * repli sans effet, lui, n'était jamais exercé.
 *
 * `planAutorise` ne dépend pas de l'objet `user` : il vient de `resolveMapImageUrl()`,
 * donc du serveur (`GET /api/settings/map-image`, refusé en 403 hors périmètre). Il faut
 * donc une VRAIE session non autorisée — d'où un second contexte de navigation, porteur
 * du seul cookie du visiteur.
 */
const contexteRestreint = await navigateur.newContext({ viewport: { width: 1280, height: 800 } });
const [nomV, valeurV] = sessionVisiteur.split('=');
await contexteRestreint.addCookies([{ name: nomV, value: valeurV, url: base }]);
const pageRestreinte = await contexteRestreint.newPage();
const erreursRestreint = [];
pageRestreinte.on('pageerror', erreur => erreursRestreint.push(String(erreur.message)));
await pageRestreinte.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
await pageRestreinte.waitForTimeout(600);

const restreinte = await evaluerStable(pageRestreinte, async () => {
  const { default: openInteractiveMap, closeInteractiveMap } = await import('./interactive-map.js');
  const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
  openInteractiveMap({
    rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
    equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
    user: { id: 'br-mapclose-visiteur', role: 'visitor', username: 'br-mapclose-visiteur' },
    notifications: { showNotification() {} }
  });
  // On attend `.map-restricted` et RIEN D'AUTRE : accepter aussi `#map-container` ferait
  // passer le cas sans avoir emprunté le chemin restreint.
  for (let essai = 0; essai < 120; essai += 1) {
    if (document.querySelector('.map-restricted')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const avant = {
    restreinte: Boolean(document.querySelector('.map-restricted')),
    conteneurNormal: Boolean(document.getElementById('map-container')),
    ecranAccueil: Boolean(document.getElementById('welcome-start-btn'))
  };
  let erreur = null;
  try { closeInteractiveMap({ notify: false }); }
  catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 250));
  return {
    ...avant, erreur,
    modalePresente: Boolean(document.getElementById('map-modal')),
    restreinteApres: Boolean(document.querySelector('.map-restricted'))
  };
});
verifie('l’état « Accès restreint » est RÉELLEMENT rendu', true, restreinte.restreinte);
verifie('aucune carte normale n’a été montée', false, restreinte.conteneurNormal);
verifie('aucun écran d’accueil : `renderMapUI` n’a jamais été appelé', false, restreinte.ecranAccueil);
verifie('la fermeture ne lève pas (crochet par défaut sans effet)', null, restreinte.erreur);
verifie('la modale restreinte est retirée', false, restreinte.modalePresente);
verifie('plus aucun `.map-restricted` dans le document', false, restreinte.restreinteApres);
verifie('aucune erreur JavaScript dans la session restreinte', [], erreursRestreint);
await contexteRestreint.close();

console.log('\n── G · l’éditeur de forme imbriquée est RÉELLEMENT ouvert, puis fermé ──');
/*
 * CE CAS EST LE SEUL QUI PROUVE QUE LE NETTOYAGE A LIEU.
 *
 * L'autre façon de faire disparaître le `ReferenceError` serait de SUPPRIMER l'appel au
 * nettoyage : la fermeture cesserait de lever, et l'éditeur de forme survivrait au plan.
 * Il faut donc l'ouvrir pour de bon et constater sa disparition.
 *
 * Une première version cliquait `#room-shapes-btn`, `[data-action="formes"]` et
 * `[data-forme-entite]` — aucun de ces sélecteurs n'existe. Les clics ne faisaient rien, la
 * barre restait à zéro, et une condition sautait l'assertion : vert sans rien avoir ouvert.
 * Les vrais sélecteurs sont `#edit-shapes-btn` et `.nested-shapes-unplaced-item[data-id]`,
 * et chaque étape est désormais ASSERTÉE — plus aucun saut conditionnel.
 */
const nettoyage = await evaluerStable(page, async (salleId) => {
  const { default: openInteractiveMap, closeInteractiveMap } = await import('./interactive-map.js');
  const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
  const etapes = {};
  openInteractiveMap({
    rooms: sync?.data?.rooms || [], baies: sync?.data?.baies || [],
    equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
    user: { id: 1, role: 'admin', username: 'br-mapclose-admin' },
    notifications: { showNotification() {} }
  });
  for (let essai = 0; essai < 120; essai += 1) {
    if (document.getElementById('map-container')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 400));

  // 1 · entrer dans la salle qui porte une VRAIE photo
  document.querySelector(`.map-hotspot.room[data-id="${salleId}"]`)?.click();
  for (let essai = 0; essai < 120; essai += 1) {
    if (document.getElementById('room-detail-image')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const image = document.getElementById('room-detail-image');
  etapes.panneauSalle = Boolean(image);

  // 2 · attendre que la photo soit CHARGÉE : sans `naturalWidth`, le canevas ne se
  //     dimensionne pas, `dessiner()` sort, et aucune liste « à placer » n'est peinte.
  for (let essai = 0; essai < 120 && image; essai += 1) {
    if (image.complete && image.naturalWidth > 0) break;
    await new Promise(r => setTimeout(r, 50));
  }
  etapes.photoChargee = Boolean(image && image.naturalWidth > 0);
  etapes.canevas = Boolean(document.getElementById('room-shapes-canvas'));

  // 3 · le bouton réel
  const bouton = document.getElementById('edit-shapes-btn');
  etapes.boutonFormes = Boolean(bouton);
  bouton?.click();
  await new Promise(r => setTimeout(r, 400));

  // 4 · l'entité réellement « à placer »
  const aPlacer = document.querySelector('.nested-shapes-unplaced-item[data-id]');
  etapes.entiteAPlacer = Boolean(aPlacer);
  etapes.libelleAPlacer = aPlacer ? aPlacer.textContent.trim() : null;
  aPlacer?.click();
  for (let essai = 0; essai < 120; essai += 1) {
    if (document.querySelector('.shape-editor-bar')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  etapes.barreAvant = document.querySelectorAll('.shape-editor-bar').length;

  // 5 · fermer le plan : c'est l'acte mesuré
  let erreur = null;
  try { closeInteractiveMap({ notify: false }); }
  catch (e) { erreur = String(e?.name || '') + ': ' + String(e?.message || e); }
  await new Promise(r => setTimeout(r, 300));
  etapes.erreur = erreur;
  etapes.barreApres = document.querySelectorAll('.shape-editor-bar').length;
  etapes.modalePresente = Boolean(document.getElementById('map-modal'));
  return etapes;
}, SALLE_PHOTO);

verifie('le panneau de la salle est ouvert', true, nettoyage.panneauSalle);
verifie('la photo réelle est chargée (`naturalWidth` > 0)', true, nettoyage.photoChargee);
verifie('le canevas des formes imbriquées est monté', true, nettoyage.canevas);
verifie('`#edit-shapes-btn` existe', true, nettoyage.boutonFormes);
verifie('une entité « à placer » est proposée', true, nettoyage.entiteAPlacer);
verifie('c’est bien la baie non placée', 'Baie à placer', nettoyage.libelleAPlacer);
verifie('l’éditeur de forme est OUVERT avant la fermeture', 1, nettoyage.barreAvant);
verifie('la fermeture du plan ne lève pas', null, nettoyage.erreur);
verifie('l’éditeur de forme a été FERMÉ par la fermeture du plan', 0, nettoyage.barreApres);
verifie('et la modale du plan est retirée', false, nettoyage.modalePresente);

/* ═══════════════════ verdict ═══════════════════ */

const referenceErrors = erreursPage.filter(message => /fermerFormesImbriquees|ReferenceError/i.test(message));
verifie('aucune `ReferenceError` n’a traversé la page', [], referenceErrors);

await navigateur.close();

console.log(`\n╚═══ ${echecs === 0 ? '✅ recette MAP-01 : aucun échec' : `❌ ${echecs} ÉCHEC(S)`} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
