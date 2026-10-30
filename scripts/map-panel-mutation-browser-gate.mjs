/**
 * @file scripts/map-panel-mutation-browser-gate.mjs — LE PANNEAU SALLE/BAIE NE SE FIGE PAS.
 *
 * DÉFAUT MESURÉ (audit indépendant, confirmé par relecture directe de la source).
 *
 * `map-admin-entity-edit.js` pose un `MutationObserver` sur `document.documentElement`
 * (`subtree:true`) qui rappelle `ensurePanelEditAction()` à CHAQUE mutation du document
 * entier. Cette fonction, quand le bouton « Modifier la salle/la baie » existe déjà,
 * réécrivait INCONDITIONNELLEMENT son `innerHTML` — y compris quand le texte à poser était
 * déjà celui affiché. Réécrire `innerHTML` DÉTRUIT et RECRÉE les nœuds enfants : c'est
 * elle-même une mutation `childList`, que l'observateur ne pouvait pas ignorer. Boucle
 * auto-entretenue : ouvrir un simple panneau Salle ou Baie suffisait à la démarrer, sans
 * qu'aucune autre partie de la page n'ait à bouger, et l'onglet se figeait.
 *
 * Cette recette ouvre un VRAI Chromium contre un VRAI serveur, compte RÉELLEMENT les
 * mutations que le document subit après l'ouverture d'un panneau, et borne sa propre
 * lecture du compteur : si l'onglet est réellement figé, cette lecture elle-même n'aboutit
 * pas dans un délai raisonnable — c'est ce qui distingue « la page réagit lentement » de
 * « la page ne réagit plus du tout ».
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

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

/*
 * Réessaie sur « Execution context was destroyed » — la même course que dans les autres
 * recettes navigateur de ce dépôt : la page peut renavigeur pendant qu'une évaluation part.
 */
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

/* ═══════════════════ la scène de test, posée par l'administrateur ═══════════════════ */

const admin = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const ZONE = 'br-panelmut-zone';
const SALLE = 9401;
const BAIE = 'br-panelmut-baie';

/*
 * REJOUABLE : on lit avant d'écrire, comme les autres recettes de ce dépôt. Une salle ou
 * une baie déjà posée par une exécution précédente porte une révision ; un PUT à l'aveugle
 * s'y heurterait en 409 `ALREADY_EXISTS`.
 */
const lireExistant = async (store, id) => {
  const sync = (await api('/api/sync', A)).charge.data || {};
  return (sync[store] || []).find(item => String(item.id) === String(id)) || null;
};

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette panneau', publicSummary: 'Zone de recette' } });
await api(`/api/data/rooms/${SALLE}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('rooms', SALLE)), id: SALLE, name: 'Salle recette panneau', x: 500, y: 400 } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE, zoneId: ZONE } });
await api(`/api/data/baies/${BAIE}`, { method: 'PUT', ...A,
  body: { ...(await lireExistant('baies', BAIE)), id: BAIE, name: 'Baie recette panneau', roomId: SALLE, x_inRoom: 700, y_inRoom: 500 } });

/* ═══════════════════ le navigateur ═══════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
let contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const [nom, valeur] = admin.split('=');
await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
let page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', erreur => erreurs.push(String(erreur.message)));

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

console.log('── 1 · montage de la carte, en administrateur ──');
const monte = await evaluerStable(page, async ([salleId, baieId]) => {
  const { default: openInteractiveMap } = await import('./interactive-map.js');
  const { db } = await import('./db.js');
  const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
  const rooms = sync?.data?.rooms || [];
  const baies = sync?.data?.baies || [];
  /*
   * `openMapEntityEditor` (map-admin-entity-edit.js) lit `db.get('rooms'|'baies', id)` —
   * IndexedDB, jamais le tableau passé à `openInteractiveMap`. Sans ce peuplement, cliquer
   * « Modifier » trouverait `record` absent et se contenterait d'une notification d'échec,
   * sans jamais ouvrir la fenêtre — ce que ce test doit précisément observer.
   */
  const salle = rooms.find(item => String(item.id) === String(salleId));
  const baie = baies.find(item => String(item.id) === String(baieId));
  if (salle) await db.save('rooms', salle);
  if (baie) await db.save('baies', baie);
  openInteractiveMap({
    rooms, baies,
    equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
    user: { id: 1, role: 'admin', username: 'br-panelmut-admin' },
    notifications: { showNotification() {} }
  });
  for (let essai = 0; essai < 80; essai += 1) {
    if (document.getElementById('map-container') || document.querySelector('.map-restricted')) break;
    await new Promise(r => setTimeout(r, 50));
  }
  document.getElementById('welcome-start-btn')?.click();
  await new Promise(r => setTimeout(r, 400));
  return {
    monte: Boolean(document.getElementById('map-container')),
    peutEditer: Boolean(document.getElementById('map-modal') && document.getElementById('edit-mode-btn'))
  };
}, [SALLE, BAIE]);
verifie('la carte est montée', true, monte.monte);
verifie('l\'administrateur peut administrer la carte (condition de `map-admin-entity-edit.js`)', true, monte.peutEditer);

/*
 * LE COMPTEUR DE MUTATIONS, INSTALLÉ AVANT CHAQUE GESTE — jamais après.
 *
 * On observe `document.body` en entier, comme le fait le module en défaut
 * (`document.documentElement`, `subtree:true`) : c'est la même portée, pas une portée plus
 * étroite qui masquerait la boucle.
 */
const armerCompteur = () => evaluerStable(page, () => {
  window.__mutationsPanneau = 0;
  window.__observateurPanneau?.disconnect();
  window.__observateurPanneau = new MutationObserver(enregistrements => {
    window.__mutationsPanneau += enregistrements.length;
  });
  window.__observateurPanneau.observe(document.body, { childList: true, subtree: true });
});

/*
 * TOUTE LECTURE OU TOUT GESTE EST BORNÉ, EXPRÈS — JAMAIS SEULEMENT LA LECTURE DU COMPTEUR.
 *
 * MESURÉ : une boucle de microtâches auto-entretenue peut affamer le fil principal du
 * moteur de rendu au point que Chromium le juge insensible et TERMINE la cible — le clic
 * qui OUVRE le panneau fautif échoue alors lui-même avec « Target page, context or browser
 * has been closed », avant même d'avoir pu relire le compteur. Un onglet réellement figé se
 * manifeste donc aussi bien par un compteur illisible que par la cible entière qui disparaît
 * en cours de geste. Les deux sont la MÊME preuve : cette enveloppe les traite comme telle,
 * pour que la recette RAPPORTE le gel au lieu de s'effondrer dessus.
 */
async function surCiblePeutEtreFigee(promesse, delaiMs = 4000) {
  try {
    return { fige: false, valeur: await Promise.race([
      promesse,
      new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), delaiMs))
    ]) };
  } catch (erreur) {
    if (/délai dépassé|Target.*closed|crashed|Target page|context or browser/i.test(String(erreur?.message))) {
      return { fige: true, valeur: null, motif: String(erreur?.message) };
    }
    throw erreur;
  }
}

const lireCompteur = () => surCiblePeutEtreFigee(
  page.evaluate(() => { window.__observateurPanneau?.disconnect(); return window.__mutationsPanneau; })
).then(({ fige, valeur }) => ({ fige, mutations: valeur }));

const cliquerHotspot = (type, id) => surCiblePeutEtreFigee(
  evaluerStable(page, ([t, i]) => {
    const cible = document.querySelector(`#map-hotspots .map-hotspot[data-type="${t}"][data-id="${i}"]`);
    if (!cible) return false;
    cible.click();
    return true;
  }, [type, id])
).then(({ fige, valeur }) => (fige ? false : valeur));

const etatBoutonModifier = () => surCiblePeutEtreFigee(evaluerStable(page, () => {
  const bouton = document.getElementById('map-edit-entity-details');
  return bouton ? { present: true, texte: bouton.textContent.trim(), type: bouton.dataset.entityType || null } : { present: false };
})).then(({ fige, valeur }) => (fige ? { present: false, fige: true } : valeur));

const filArianeRoom = () => surCiblePeutEtreFigee(evaluerStable(page, ([id]) => {
  const cible = document.querySelector(`[data-fil-type="room"][data-fil-id="${id}"]`);
  if (!cible) return false;
  cible.click();
  return true;
}, [SALLE])).then(({ fige, valeur }) => (fige ? false : valeur));

const clicModifier = () => surCiblePeutEtreFigee(evaluerStable(page, () => {
  document.getElementById('map-edit-entity-details')?.click();
  return true;
})).then(({ fige, valeur }) => (fige ? false : valeur));

const etatModale = () => surCiblePeutEtreFigee(evaluerStable(page, () => {
  const modal = document.getElementById('map-entity-edit-modal');
  return { ouverte: Boolean(modal), titre: modal?.querySelector('h3')?.textContent?.trim() || null };
})).then(({ fige, valeur }) => (fige ? { ouverte: false, titre: null, fige: true } : valeur));

/*
 * UNE FOIS L'ONGLET DÉCLARÉ FIGÉ, LA SUITE NE PEUT PLUS RIEN PROUVER — jamais réessayer sur
 * une cible déjà terminée. On le dit UNE fois, on marque les gestes restants comme non
 * exécutés (jamais comme silencieusement réussis), et on referme proprement.
 */
let ongletFige = false;
const siVivant = async (titre, geste) => {
  if (ongletFige) { verifie(titre, 'exécuté', 'ignoré : onglet déjà figé par une section précédente'); return; }
  await geste();
};

console.log('\n── 2 · ouvrir le panneau SALLE ne fige pas l\'onglet ──');
await armerCompteur();
const clicSalle = await cliquerHotspot('room', SALLE);
verifie('le repère de la salle est cliqué', true, clicSalle);
if (clicSalle === false) ongletFige = true;
await page.waitForTimeout(600);
const lectureSalle = ongletFige ? { fige: true, mutations: null } : await lireCompteur();
verifie('l\'onglet répond toujours (le compteur de mutations a pu être relu)', false, lectureSalle.fige);
if (lectureSalle.fige) ongletFige = true;
if (!lectureSalle.fige) {
  /*
   * Un seuil large, PAS un seuil exact : ouvrir un panneau remplace tout son `innerHTML`,
   * ce qui produit légitimement plusieurs dizaines d'enregistrements de mutation. Une boucle
   * auto-entretenue, elle, en produit des MILLIERS en quelques centaines de millisecondes —
   * la différence d'ordre de grandeur est ce que ce seuil mesure, pas un compte au nœud près.
   */
  verifie('le nombre de mutations reste borné (pas de boucle auto-entretenue)', true, lectureSalle.mutations < 200);
}
await siVivant('« Modifier » est proposé pour la salle', async () => {
  const boutonSalle = await etatBoutonModifier();
  verifie('« Modifier » est proposé pour la salle', { present: true, texte: 'Modifier la salle', type: 'room' },
    { present: boutonSalle.present, texte: boutonSalle.texte?.replace(/^\s*/, ''), type: boutonSalle.type });
});

console.log('\n── 3 · depuis la salle, ouvrir le panneau BAIE ne fige pas l\'onglet non plus ──');
await siVivant('le repère de la baie (dans la salle) est cliqué', async () => {
  await armerCompteur();
  const clicBaie = await cliquerHotspot('baie', BAIE);
  verifie('le repère de la baie (dans la salle) est cliqué', true, clicBaie);
  if (clicBaie === false) ongletFige = true;
  await page.waitForTimeout(600);
  const lectureBaie = ongletFige ? { fige: true, mutations: null } : await lireCompteur();
  verifie('l\'onglet répond toujours', false, lectureBaie.fige);
  if (lectureBaie.fige) ongletFige = true;
  if (!lectureBaie.fige) {
    verifie('le nombre de mutations reste borné', true, lectureBaie.mutations < 200);
  }
});
await siVivant('« Modifier » est proposé pour la baie', async () => {
  const boutonBaie = await etatBoutonModifier();
  verifie('« Modifier » est proposé pour la baie', { present: true, texte: 'Modifier la baie', type: 'baie' },
    { present: boutonBaie.present, texte: boutonBaie.texte?.replace(/^\s*/, ''), type: boutonBaie.type });
});

console.log('\n── 4 · label mis à jour EXACTEMENT une fois — pas de réécriture répétée ──');
await siVivant('au repos, l\'onglet répond toujours', async () => {
  /*
   * On relit le compteur une SECONDE fois, sans rien cliquer entre-temps : sous le défaut, la
   * boucle continue de tourner même sans aucun geste supplémentaire, et ce second relevé
   * serait, lui aussi, énorme ou introuvable.
   */
  await page.waitForTimeout(500);
  const lectureRepos = await lireCompteur();
  verifie('au repos, l\'onglet répond toujours', false, lectureRepos.fige);
  if (lectureRepos.fige) ongletFige = true;
  if (!lectureRepos.fige) {
    verifie('au repos (aucun geste), le compteur n\'a PAS continué de grimper', true, lectureRepos.mutations < 50);
  }
});

console.log('\n── 5 · fil d\'Ariane Baie → Salle → « Modifier » ouvre l\'éditeur de la SALLE ──');
await siVivant('le maillon « salle » du fil d\'Ariane (depuis la baie) est cliqué', async () => {
  const clicFil = await filArianeRoom();
  verifie('le maillon « salle » du fil d\'Ariane (depuis la baie) est cliqué', true, clicFil);
  if (clicFil === false) ongletFige = true;
});
await siVivant('« Modifier » redevient celui de la SALLE après le fil d\'Ariane', async () => {
  await page.waitForTimeout(500);
  const boutonApresRetour = await etatBoutonModifier();
  verifie('« Modifier » redevient celui de la SALLE après le fil d\'Ariane', { present: true, texte: 'Modifier la salle', type: 'room' },
    { present: boutonApresRetour.present, texte: boutonApresRetour.texte?.replace(/^\s*/, ''), type: boutonApresRetour.type });
});
await siVivant('« Modifier » (depuis la baie, après le fil d\'Ariane) ouvre bien l\'éditeur de la SALLE', async () => {
  await clicModifier();
  await page.waitForTimeout(400);
  const modaleOuverte = await etatModale();
  verifie('« Modifier » (depuis la baie, après le fil d\'Ariane) ouvre bien l\'éditeur de la SALLE, jamais celui de la baie',
    { ouverte: true, titre: 'Modifier la salle' }, { ouverte: modaleOuverte.ouverte, titre: modaleOuverte.titre });
});

/*
 * ═══ 6/7 · RETOUR EXACT — un clic ne doit jamais sauter de niveau ═══
 *
 * DÉFAUT MESURÉ (Final Meeting Candidate Gate) : `panel-back-btn` était rappelé par DEUX
 * écouteurs pour le même clic — l'`onclick` direct posé par chaque vue (room/baie/equipment)
 * ET la délégation `panel.onclick` qui rematche le même clic pendant sa remontée (bubbling).
 * Un seul clic appelait donc `goBack()` deux fois, dépilait deux niveaux d'historique, et
 * « Retour » depuis la baie sautait la salle pour atterrir directement sur la carte.
 *
 * Un VRAI rechargement de page précède chaque test ici (jamais un second
 * `openInteractiveMap(...)` dans le même onglet : ce dernier ferme l'instance précédente via
 * `activeMapClose`, et cette fermeture s'est avérée fragile hors du parcours normal — hors
 * sujet pour cette régression précise). Le rechargement garantit un historique de navigation
 * interne réellement VIDE, une preuve indépendante de tout ce que les sections précédentes
 * ont laissé.
 */
/*
 * Un `page.goto` sur le MÊME contexte ne suffit pas : le service worker enregistré par le
 * premier chargement (section 1) sert ensuite `interactive-map.js` depuis SON cache, jamais
 * une réédition faite après coup — mesuré directement ici pendant cette régression (le RED
 * restait RED après le correctif tant que ce nouveau contexte n'existait pas). Un contexte
 * Playwright FRAÎCHEMENT créé n'a jamais enregistré ce service worker : son premier
 * chargement va au réseau, donc au fichier réellement sur disque.
 */
async function monterCarteFraiche() {
  await contexte.close().catch(() => {});
  contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
  page = await contexte.newPage();
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  return evaluerStable(page, async ([salleId, baieId]) => {
    const { default: openInteractiveMap } = await import('./interactive-map.js');
    const { db } = await import('./db.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    const rooms = sync?.data?.rooms || [];
    const baies = sync?.data?.baies || [];
    const salle = rooms.find(item => String(item.id) === String(salleId));
    const baie = baies.find(item => String(item.id) === String(baieId));
    if (salle) await db.save('rooms', salle);
    if (baie) await db.save('baies', baie);
    openInteractiveMap({
      rooms, baies, equipments: sync?.data?.equipments || [], walls: sync?.data?.walls || [],
      user: { id: 1, role: 'admin', username: 'br-panelmut-admin' },
      notifications: { showNotification() {} }
    });
    for (let essai = 0; essai < 80; essai += 1) {
      if (document.getElementById('map-container')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    document.getElementById('welcome-start-btn')?.click();
    await new Promise(r => setTimeout(r, 400));
  }, [SALLE, BAIE]);
}

/*
 * `goBack()` ne reconstruit JAMAIS le panneau latéral complet (son canevas, son fil
 * d'Ariane) — seul `openPanel(type, id)` le fait. Il referme le tiroir
 * (`panel.style.display = 'none'`, TOUJOURS, même en revenant à une vue valide) et redessine
 * seulement les repères de fond pour le nouveau `currentView` — vérifié directement pendant
 * l'écriture de cette recette. Le signal correct pour « sommes-nous EXACTEMENT revenus sur
 * Room » n'est donc pas le panneau, mais QUELS repères de fond sont dessinés : le repère
 * `room` n'apparaît qu'au niveau racine de la carte ; le repère de la baie de CETTE salle
 * n'apparaît que lorsqu'on est DANS cette salle (jamais au niveau racine, hors mode édition).
 *
 * CONSÉQUENCE IMPORTANTE, vérifiée directement pendant l'écriture de cette recette : le
 * tiroir (et donc `#panel-back-btn` lui-même) DISPARAÎT après CE premier clic — il n'existe
 * physiquement plus rien à cliquer une seconde fois pour continuer vers la carte depuis LA
 * MÊME baie. Un `element.click()` programmatique réussirait à tort sur ce bouton devenu
 * invisible (il ne vérifie aucune visibilité) ; ce n'est PAS ce qu'un vrai geste utilisateur
 * peut faire, donc cette recette utilise `page.click()` de Playwright partout ici — qui
 * respecte la visibilité — et vérifie « Room → Retour → Map » comme un second parcours
 * INDÉPENDANT (une salle rouverte depuis la carte, jamais le même bouton déjà refermé).
 */
const etatPanneauRetour = () => surCiblePeutEtreFigee(evaluerStable(page, ([baieId, salleId]) => ({
  surSalle: Boolean(document.querySelector(`.map-hotspot[data-type="baie"][data-id="${baieId}"]`))
    && !document.querySelector(`.map-hotspot[data-type="room"][data-id="${salleId}"]`),
  surCarte: Boolean(document.querySelector(`.map-hotspot[data-type="room"][data-id="${salleId}"]`))
    && !document.querySelector(`.map-hotspot[data-type="baie"][data-id="${baieId}"]`)
}), [BAIE, SALLE])).then(({ fige, valeur }) => (fige ? { surSalle: false, surCarte: false, fige: true } : valeur));

const cliquerRetourSourisReel = () => surCiblePeutEtreFigee(
  page.click('#panel-back-btn', { timeout: 3000 }).then(() => true).catch(() => false)
).then(({ fige, valeur }) => (fige ? false : valeur));

const activerRetourClavier = () => surCiblePeutEtreFigee((async () => {
  await page.focus('#panel-back-btn');
  await page.keyboard.press('Enter');
  return true;
})()).then(({ fige, valeur }) => (fige ? false : valeur));

console.log('\n── 6 · Retour exact (souris) : Map → Room → Baie → Retour ne saute jamais de niveau ──');
await siVivant('carte fraîche remontée (souris, Baie → Retour)', async () => { await monterCarteFraiche(); });
await siVivant('Map → Room → Baie (préparation, souris)', async () => {
  const c1 = await cliquerHotspot('room', SALLE);
  await page.waitForTimeout(300);
  const c2 = await cliquerHotspot('baie', BAIE);
  verifie('salle puis baie atteintes (préparation Retour souris)', true, c1 && c2);
  if (!c1 || !c2) ongletFige = true;
});
await siVivant('un SEUL clic souris (réel, respectant la visibilité) sur Retour depuis Baie ramène exactement à Room (jamais la carte)', async () => {
  await page.waitForTimeout(300);
  const clic = await cliquerRetourSourisReel();
  verifie('le clic souris sur Retour aboutit (bouton visible et cliquable)', true, clic);
  if (clic === false) { ongletFige = true; return; }
  await page.waitForTimeout(400);
  const etat = await etatPanneauRetour();
  verifie('un SEUL clic souris sur Retour depuis Baie ramène exactement à Room (jamais la carte)',
    { surSalle: true, surCarte: false }, { surSalle: etat.surSalle, surCarte: etat.surCarte });
});

console.log('\n── 6b · Retour exact (souris) : Room → Retour ramène à la carte (parcours indépendant) ──');
await siVivant('carte fraîche remontée (souris, Room → Retour)', async () => { await monterCarteFraiche(); });
await siVivant('Map → Room (préparation, souris)', async () => {
  const c1 = await cliquerHotspot('room', SALLE);
  verifie('salle atteinte (préparation Retour souris depuis Room)', true, c1);
  if (!c1) ongletFige = true;
});
await siVivant('un SEUL clic souris (réel) sur Retour depuis Room ramène exactement à la carte', async () => {
  await page.waitForTimeout(300);
  const clic = await cliquerRetourSourisReel();
  verifie('le clic souris sur Retour aboutit (bouton visible et cliquable)', true, clic);
  if (clic === false) { ongletFige = true; return; }
  await page.waitForTimeout(400);
  const etat = await etatPanneauRetour();
  verifie('un SEUL clic souris sur Retour depuis Room ramène exactement à la carte',
    { surSalle: false, surCarte: true }, { surSalle: etat.surSalle, surCarte: etat.surCarte });
});

console.log('\n── 7 · Retour exact (clavier) : activation native (Entrée) du bouton ──');
await siVivant('carte fraîche remontée (clavier)', async () => { await monterCarteFraiche(); });
await siVivant('Map → Room → Baie (préparation, clavier)', async () => {
  const c1 = await cliquerHotspot('room', SALLE);
  await page.waitForTimeout(300);
  const c2 = await cliquerHotspot('baie', BAIE);
  verifie('salle puis baie atteintes (préparation Retour clavier)', true, c1 && c2);
  if (!c1 || !c2) ongletFige = true;
});
await siVivant('une SEULE activation clavier (Entrée) sur Retour depuis Baie ramène exactement à Room', async () => {
  await page.waitForTimeout(300);
  const clic = await activerRetourClavier();
  if (clic === false) { ongletFige = true; return; }
  await page.waitForTimeout(400);
  const etat = await etatPanneauRetour();
  verifie('une SEULE activation clavier (Entrée) sur Retour depuis Baie ramène exactement à Room',
    { surSalle: true, surCarte: false }, { surSalle: etat.surSalle, surCarte: etat.surCarte });
});

/*
 * ═══ 8 · RETOUR EXACT — le panneau Room/Baie doit se ROUVRIR, pas seulement le SCOPE ═══
 *
 * TROUVAILLE DE REVUE INDÉPENDANTE (post-checkpoint) : les sections 6/6b/7 ci-dessus prouvent
 * qu'un seul clic change le bon SCOPE de fond (`drawAreasAndHotspots`) — vrai, mais
 * insuffisant. `goBack()` ne rappelait jamais `openPanel()` : après « Retour » depuis Baie,
 * le panneau restait fermé (`panel.style.display = 'none'`), donc #room-detail-image (la
 * PHOTO réelle de la salle) et #room-shapes-canvas (ses formes) ne réapparaissaient PAS —
 * l'exploitant retombait sur la carte de fond, jamais sur la photo de sa salle. Le parcours
 * réel du métier est Room photo → Baie photo → Retour : c'est CE retour visuel exact qui
 * compte, pas seulement le scope.
 */
console.log('\n── 8 · Retour exact (retour VISUEL) : Baie → Retour rouvre la PHOTO de la salle ──');
await siVivant('carte fraîche remontée (retour visuel, souris)', async () => { await monterCarteFraiche(); });
let srcAvant = null;
await siVivant('Map → Room, photo capturée avant Baie', async () => {
  const c1 = await cliquerHotspot('room', SALLE);
  verifie('salle atteinte (préparation retour visuel)', true, c1);
  if (!c1) { ongletFige = true; return; }
  await page.waitForTimeout(300);
  const etatRoom = await surCiblePeutEtreFigee(evaluerStable(page, () => {
    const img = document.getElementById('room-detail-image');
    return {
      present: Boolean(img),
      // `getBoundingClientRect()` mesure {w:0,h:0} pour cette image même à la toute
      // première ouverture directe (constaté ici, hors de toute question de Retour) —
      // un détail de mise en page de ce panneau précis, sans rapport avec ce que cette
      // section prouve. `offsetParent` est le signal robuste : nul seulement si l'image ou
      // un de ses ancêtres est `display:none`.
      visible: Boolean(img && img.offsetParent !== null && getComputedStyle(img).display !== 'none'),
      src: img?.src || null,
      canevas: Boolean(document.getElementById('room-shapes-canvas'))
    };
  }));
  if (etatRoom.fige) { ongletFige = true; return; }
  verifie('#room-detail-image visible avant Baie (état de référence)', { present: true, visible: true, canevas: true },
    { present: etatRoom.valeur.present, visible: etatRoom.valeur.visible, canevas: etatRoom.valeur.canevas });
  srcAvant = etatRoom.valeur.src;
});
await siVivant('Room → Baie (préparation)', async () => {
  const c2 = await cliquerHotspot('baie', BAIE);
  verifie('baie atteinte depuis la salle (préparation retour visuel)', true, c2);
  if (!c2) ongletFige = true;
});
await siVivant('UN SEUL clic Retour depuis Baie ROUVRE la photo de Room (même salle, mêmes formes)', async () => {
  await page.waitForTimeout(300);
  const clic = await cliquerRetourSourisReel();
  verifie('le clic souris sur Retour aboutit (bouton visible et cliquable)', true, clic);
  if (clic === false) { ongletFige = true; return; }
  await page.waitForFunction(() => {
    const img = document.getElementById('room-detail-image');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const etatApres = await surCiblePeutEtreFigee(evaluerStable(page, () => {
    const img = document.getElementById('room-detail-image');
    return {
      present: Boolean(img),
      visible: Boolean(img && img.offsetParent !== null && getComputedStyle(img).display !== 'none'),
      src: img?.src || null,
      canevas: Boolean(document.getElementById('room-shapes-canvas'))
    };
  }));
  if (etatApres.fige) { ongletFige = true; return; }
  verifie('un SEUL clic Retour depuis Baie rouvre #room-detail-image (même src) et #room-shapes-canvas — sans second clic',
    { present: true, visible: true, src: srcAvant, canevas: true },
    { present: etatApres.valeur.present, visible: etatApres.valeur.visible, src: etatApres.valeur.src, canevas: etatApres.valeur.canevas });
});
await siVivant('depuis la photo de Room ROUVERTE, un second Retour ramène à la carte générale', async () => {
  const clic = await cliquerRetourSourisReel();
  verifie('le second clic souris sur Retour aboutit (bouton visible et cliquable)', true, clic);
  if (clic === false) { ongletFige = true; return; }
  await page.waitForTimeout(400);
  const etatCarte = await surCiblePeutEtreFigee(evaluerStable(page, (salleId) => {
    // `goBack()` masque le panneau via `display:none` — il ne vide JAMAIS `panel.innerHTML`
    // (voir la section 6/6b plus haut) : #room-detail-image reste dans le DOM, juste caché.
    // Le signal correct est donc la VISIBILITÉ, pas l'absence de l'élément.
    const img = document.getElementById('room-detail-image');
    return {
      roomImageMasquee: !(img && img.offsetParent !== null && getComputedStyle(img).display !== 'none'),
      surCarte: Boolean(document.querySelector(`.map-hotspot[data-type="room"][data-id="${salleId}"]`))
    };
  }, SALLE));
  if (etatCarte.fige) { ongletFige = true; return; }
  verifie('depuis la photo de Room rouverte, Retour ramène exactement à la carte générale',
    { roomImageMasquee: true, surCarte: true }, etatCarte.valeur);
});

console.log('\n── 8b · Retour exact (retour VISUEL, clavier) : Baie → Retour (Entrée) rouvre la photo de Room ──');
await siVivant('carte fraîche remontée (retour visuel, clavier)', async () => { await monterCarteFraiche(); });
await siVivant('Map → Room → Baie (préparation, clavier)', async () => {
  const c1 = await cliquerHotspot('room', SALLE);
  await page.waitForTimeout(300);
  const c2 = await cliquerHotspot('baie', BAIE);
  verifie('salle puis baie atteintes (préparation retour visuel clavier)', true, c1 && c2);
  if (!c1 || !c2) ongletFige = true;
});
await siVivant('une SEULE activation clavier (Entrée) sur Retour depuis Baie rouvre #room-detail-image', async () => {
  await page.waitForTimeout(300);
  const clic = await activerRetourClavier();
  if (clic === false) { ongletFige = true; return; }
  await page.waitForFunction(() => {
    const img = document.getElementById('room-detail-image');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const etat = await surCiblePeutEtreFigee(evaluerStable(page, () => {
    const img = document.getElementById('room-detail-image');
    return { present: Boolean(img), visible: Boolean(img && img.offsetParent !== null && getComputedStyle(img).display !== 'none') };
  }));
  if (etat.fige) { ongletFige = true; return; }
  verifie('une activation clavier sur Retour depuis Baie rouvre #room-detail-image',
    { present: true, visible: true }, etat.valeur);
});

if (!ongletFige) verifie('aucune erreur JavaScript sur toute la recette', [], erreurs);

await navigateur.close().catch(() => {});

console.log(`\nRecette panneau Salle/Baie (MutationObserver) : ${echecs === 0 ? 'PASS' : `${echecs} ÉCHEC(S)`}`);
process.exit(echecs === 0 ? 0 : 1);
