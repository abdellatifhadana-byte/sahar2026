/**
 * @file scripts/ui-polish-browser-gate.mjs — UI-POLISH-01 dans un vrai navigateur.
 *
 * CE QUE CETTE ÉPREUVE MESURE, ET POURQUOI ELLE EXISTE
 * ----------------------------------------------------
 * Les six constats du lot sont des constats de GÉOMÉTRIE et de LIBELLÉ. Aucun d'eux ne se
 * démontre en lisant du source : « le contenu commence à la hauteur du viewport », « la
 * barre invisible ajoute 24 px à chaque navigation », « le bloc identité est tronqué à
 * 1366 » sont des mesures. Elles se prennent sur un DOM rendu, à des résolutions données,
 * avec les 130 modules réellement posés — pas sur une capture d'écran ni sur une lecture.
 *
 * L'épreuve parcourt donc six rôles × six résolutions contre le serveur réel et la base
 * PostgreSQL réelle, et rapporte une matrice.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-decor.mjs
 *   node scripts/ui-polish-browser-gate.mjs
 *
 * Variables : E2E_BASE_URL, PLAYWRIGHT_MODULE, CHROMIUM_PATH, UI_GATE_CAPTURES (dossier).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { BASE, COMPTES, motDePasseDe, HORS_CHAINE_TOTAL, HORS_CHAINE_EN_PANNE } from './ui-polish-decor.mjs';

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CAPTURES = process.env.UI_GATE_CAPTURES || '';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch {
  console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ». Renseignez PLAYWRIGHT_MODULE.`);
  process.exit(2);
}
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

/** Les six résolutions du parc, de la plus large à la plus étroite. */
const RESOLUTIONS = Object.freeze([
  { width: 1920, height: 1080 }, { width: 1600, height: 900 }, { width: 1440, height: 900 },
  { width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }
]);

let echecs = 0;
let verifications = 0;
const constats = [];
const verifier = (nom, condition, detail = '') => {
  verifications += 1;
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  constats.push(`${nom}${detail ? ' → ' + detail : ''}`);
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

/** On se connecte PAR L'ÉCRAN : `localStorage.auth` n'est renseigné que par le formulaire. */
async function connecter(page, cle) {
  const compte = COMPTES[cle];
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 40000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 40000 });
  for (let essai = 0; essai < 40; essai += 1) {
    try { if (await page.evaluate(() => localStorage.getItem('auth'))) return true; }
    catch { /* navigation en cours */ }
    await page.waitForTimeout(250);
  }
  return false;
}

/** Aucune barre horizontale : la mesure vaut pour toutes les pages, tous les rôles. */
const debordementHorizontal = page => page.evaluate(() => ({
  document: document.documentElement.scrollWidth,
  fenetre: window.innerWidth,
  coupable: [...document.querySelectorAll('body *')]
    .filter(node => node.getBoundingClientRect().right > window.innerWidth + 2)
    .slice(0, 3).map(node => `${node.tagName}.${String(node.className || '').split(' ')[0]}`)
}));

const attendreCoque = (page, selecteur) => page.waitForSelector(selecteur, { timeout: 40000 });

/* ───────────────────────── P0-1 · la coque Responsable ───────────────────────── */

async function epreuveResponsable(navigateur) {
  console.log('\n━━━ P0-1 · Responsable — le contenu doit être atteignable ━━━');
  for (const resolution of RESOLUTIONS) {
    const contexte = await navigateur.newContext({ viewport: resolution });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
    await connecter(page, 'responsable');
    await attendreCoque(page, '#responsible-content');
    await page.waitForTimeout(1200);

    const sections = await page.$$eval('.sidebar-menu a[data-section]', liens => liens.map(lien => lien.dataset.section));
    let pire = { section: '', top: -1 };
    for (const section of sections) {
      await page.click(`.sidebar-menu a[data-section="${section}"]`);
      await page.waitForTimeout(900);
      const mesure = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const contenu = document.getElementById('responsible-content');
        const rect = contenu.getBoundingClientRect();
        const premier = [...contenu.querySelectorAll('*')]
          .find(node => node.getBoundingClientRect().height > 0);
        return {
          top: Math.round(rect.top),
          hauteurVue: window.innerHeight,
          premierVisible: premier ? Math.round(premier.getBoundingClientRect().top) < window.innerHeight : false,
          texte: (contenu.innerText || '').trim().slice(0, 40)
        };
      });
      if (mesure.top > pire.top) pire = { section, ...mesure };
      verifier(`responsable · ${resolution.width}×${resolution.height} · « ${section} » — le contenu commence dans la vue (top=${mesure.top}px)`,
        mesure.top < mesure.hauteurVue - 80, `top=${mesure.top} ≥ ${mesure.hauteurVue - 80}`);
      verifier(`responsable · ${resolution.width}×${resolution.height} · « ${section} » — quelque chose est visible sans défiler`,
        mesure.premierVisible && mesure.texte.length > 0, `texte=« ${mesure.texte} »`);
    }
    const debordement = await debordementHorizontal(page);
    verifier(`responsable · ${resolution.width}×${resolution.height} · aucun débordement horizontal`,
      debordement.document <= debordement.fenetre + 2,
      `${debordement.document} > ${debordement.fenetre} — ${debordement.coupable.join(', ')}`);
    verifier(`responsable · ${resolution.width}×${resolution.height} · aucune erreur JavaScript`,
      erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/responsable-${resolution.width}.png` });
    console.log(`     ↳ pire position mesurée : « ${pire.section} » top=${pire.top}px / vue ${resolution.height}px`);
    await contexte.close();
  }
}

/* ──────────────── P0-2 · #admin-tabs et la dérive verticale ──────────────── */

async function epreuveDerive(navigateur, cle) {
  const compte = COMPTES[cle];
  console.log(`\n━━━ P0-2 · ${cle} — 20 navigations, aucune dérive ━━━`);
  const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  await connecter(page, cle);
  await attendreCoque(page, '#admin-content');
  await page.waitForTimeout(1500);

  const sections = await page.$$eval('.sidebar-menu a[data-section]', liens => liens.map(lien => lien.dataset.section));
  const mesure = () => page.evaluate(() => {
    window.scrollTo(0, 0);
    const contenu = document.getElementById('admin-content');
    const tabs = document.getElementById('admin-tabs');
    return {
      top: Math.round(contenu.getBoundingClientRect().top),
      hauteurTabs: tabs ? Math.round(tabs.getBoundingClientRect().height) : 0,
      nombreTabs: tabs ? tabs.querySelectorAll('.tab').length : 0
    };
  });

  const suite = [];
  for (let tour = 0; tour < 20; tour += 1) {
    const section = sections[tour % sections.length];
    await page.click(`.sidebar-menu a[data-section="${section}"]`).catch(() => {});
    await page.waitForTimeout(650);
    suite.push({ tour: tour + 1, section, ...(await mesure()) });
  }
  const positions = [...new Set(suite.map(item => item.top))];
  const nombres = [...new Set(suite.map(item => item.nombreTabs))];
  console.log(`     ↳ positions relevées : ${positions.join(', ')} px · tabs : ${nombres.join(', ')}`);
  verifier(`${cle} · la position du contenu ne dérive pas sur 20 navigations`,
    Math.max(...suite.map(item => item.top)) - Math.min(...suite.map(item => item.top)) <= 2,
    `de ${Math.min(...suite.map(item => item.top))}px à ${Math.max(...suite.map(item => item.top))}px`);
  verifier(`${cle} · le nombre d’onglets se stabilise (fuite DOM)`,
    Math.max(...suite.map(item => item.nombreTabs)) <= 8,
    `jusqu’à ${Math.max(...suite.map(item => item.nombreTabs))} onglets`);
  verifier(`${cle} · la bande d’onglets garde une hauteur stable`,
    Math.max(...suite.map(item => item.hauteurTabs)) - Math.min(...suite.map(item => item.hauteurTabs)) <= 2,
    `de ${Math.min(...suite.map(item => item.hauteurTabs))}px à ${Math.max(...suite.map(item => item.hauteurTabs))}px`);
  verifier(`${cle} · aucune erreur JavaScript sur les 20 navigations`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/derive-${cle}.png` });
  await contexte.close();
  return suite;
}

/* ─────────────────── P0-6 · l'en-tête à toutes les largeurs ─────────────────── */

async function epreuveEntete(navigateur, cle) {
  const compte = COMPTES[cle];
  console.log(`\n━━━ P0-6 · ${cle} — en-tête lisible de 1920 à 1024 ━━━`);
  for (const resolution of RESOLUTIONS) {
    const contexte = await navigateur.newContext({ viewport: resolution });
    const page = await contexte.newPage();
    await connecter(page, cle);
    await attendreCoque(page, '#admin-content');
    await page.waitForTimeout(1200);
    const entete = await page.evaluate(() => {
      const lire = selecteur => {
        const node = document.querySelector(selecteur);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          texte: (node.innerText || '').trim(),
          tronque: node.scrollWidth > node.clientWidth + 1,
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          droite: Math.round(rect.right), gauche: Math.round(rect.left)
        };
      };
      const header = document.querySelector('.admin-header');
      const rect = header.getBoundingClientRect();
      return {
        nom: lire('.admin-header .user-name'),
        role: lire('.admin-header .user-role'),
        deconnexion: lire('#logout-btn'),
        headerDroite: Math.round(rect.right),
        headerDeborde: header.scrollWidth > header.clientWidth + 1,
        fenetre: window.innerWidth
      };
    });
    verifier(`${cle} · ${resolution.width} · l’identité est lisible et non tronquée`,
      Boolean(entete.nom?.visible) && !entete.nom?.tronque,
      JSON.stringify(entete.nom));
    verifier(`${cle} · ${resolution.width} · le rôle est lisible et non tronqué`,
      Boolean(entete.role?.visible) && !entete.role?.tronque,
      JSON.stringify(entete.role));
    verifier(`${cle} · ${resolution.width} · l’action de déconnexion reste dans l’en-tête`,
      Boolean(entete.deconnexion?.visible) && entete.deconnexion.droite <= entete.headerDroite + 2,
      JSON.stringify(entete.deconnexion));
    verifier(`${cle} · ${resolution.width} · l’en-tête ne déborde pas`, !entete.headerDeborde);
    const debordement = await debordementHorizontal(page);
    verifier(`${cle} · ${resolution.width} · aucun débordement horizontal de page`,
      debordement.document <= debordement.fenetre + 2,
      `${debordement.document} > ${debordement.fenetre} — ${debordement.coupable.join(', ')}`);
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/entete-${cle}-${resolution.width}.png`, clip: { x: 0, y: 0, width: resolution.width, height: 120 } });
    await contexte.close();
  }
}

/* ──────────── P0-3 / P0-4 · la chaîne du signal dit ce qu'elle sait ──────────── */

async function epreuveChaine(navigateur) {
  console.log('\n━━━ P0-3 / P0-4 · Chaîne du signal — un nombre honnête ━━━');
  const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
  const page = await contexte.newPage();
  const transitoires = [];
  await connecter(page, 'admin');
  // On observe la bande PENDANT la convergence, puis après : P0-4 est un constat sur le temps.
  for (let essai = 0; essai < 24; essai += 1) {
    const vu = await page.evaluate(() => {
      const bande = document.getElementById('signal-spine');
      if (!bande) return null;
      return {
        horsChaine: bande.querySelector('[data-segment="unassigned"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
        chargement: bande.dataset.chargement || '',
        texte: bande.innerText.replace(/\s+/g, ' ').trim().slice(0, 220)
      };
    }).catch(() => null);
    if (vu) transitoires.push(vu);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  const finale = await page.evaluate(() => {
    const bande = document.getElementById('signal-spine');
    return bande ? {
      horsChaine: bande.querySelector('[data-segment="unassigned"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
      texte: bande.innerText.replace(/\s+/g, ' ').trim().slice(0, 260)
    } : null;
  });
  console.log(`     ↳ hors-chaîne, état final : « ${finale?.horsChaine || '(absent)'} »`);
  const etatsVus = [...new Set(transitoires.map(item => item.horsChaine).filter(Boolean))];
  console.log(`     ↳ états traversés : ${etatsVus.map(item => `« ${item} »`).join(' → ') || '(aucun)'}`);

  /*
   * LA VÉRITÉ EST DEMANDÉE AU SERVEUR, PAS AU DÉCOR.
   *
   * Le décor pose dix-huit équipements hors chaîne dont un en panne, mais il n'est pas
   * seul dans la base : le catalogue et les semences en ajoutent d'autres. Comparer
   * l'écran aux dix-huit du décor mesurerait le décor, pas l'écran. On recalcule donc le
   * hors-chaîne depuis l'instantané central, avec une logique INDÉPENDANTE de celle du
   * contrat — sans quoi l'épreuve confirmerait le code par lui-même.
   */
  const verite = await page.evaluate(async () => {
    const reponse = await fetch('/api/sync', { credentials: 'include', cache: 'no-store' });
    const instantane = await reponse.json();
    const salles = new Map((instantane.data?.rooms || []).map(salle => [String(salle.id), salle]));
    const segments = new Set(['acquisition', 'regie', 'continuite', 'diffusion']);
    const horsChaine = (instantane.data?.equipments || []).filter(equipement => {
      const salle = equipement.roomId === null || equipement.roomId === undefined || equipement.roomId === ''
        ? null : salles.get(String(equipement.roomId));
      return !salle || !segments.has(String(salle.chainSegment || '').trim().toLowerCase());
    });
    const enPanne = horsChaine.filter(equipement => equipement.panne === true
      || /hors[- ]?service|panne|\bhs\b|\bko\b/i.test(`${equipement.statut || ''} ${equipement.status || ''}`));
    return { total: horsChaine.length, panne: enPanne.length };
  });
  console.log(`     ↳ vérité serveur : ${verite.total} hors chaîne, dont ${verite.panne} en panne`);

  verifier('chaîne · le bandeau est rendu', Boolean(finale), '');
  verifier(`chaîne · le hors-chaîne ne prétend PAS ${verite.total} pannes pour ${verite.panne}`,
    Boolean(finale) && !new RegExp(`${verite.total}\\s*(·\\s*)?hors service`, 'i').test(finale.horsChaine.replace(/\n/g, ' ')),
    `« ${finale?.horsChaine} »`);
  verifier(`chaîne · le nombre réellement hors service (${verite.panne}) est dit`,
    Boolean(finale) && new RegExp(`\\b${verite.panne}\\s+hors service`, 'i').test(finale.horsChaine),
    `« ${finale?.horsChaine} »`);
  verifier(`chaîne · le total (${verite.total}) reste dit, avec son unité`,
    Boolean(finale) && new RegExp(`\\b${verite.total}\\s+non rattachés?`, 'i').test(finale.horsChaine),
    `« ${finale?.horsChaine} »`);
  verifier(`chaîne · le décor est bien dans le compte (au moins ${HORS_CHAINE_TOTAL} hors chaîne, ${HORS_CHAINE_EN_PANNE} en panne)`,
    verite.total >= HORS_CHAINE_TOTAL && verite.panne >= HORS_CHAINE_EN_PANNE,
    `serveur ${verite.total}/${verite.panne}`);
  // P0-4 : aucune valeur DÉFINITIVE ne doit avoir été présentée puis démentie.
  const valeursDefinitives = etatsVus.filter(texte => !/synchronisation/i.test(texte));
  verifier('chaîne · aucun nombre définitif n’a changé pendant la synchronisation initiale',
    new Set(valeursDefinitives).size <= 1,
    valeursDefinitives.map(item => `« ${item} »`).join(' → '));
  /*
   * L'ÉTAT D'ATTENTE EST RENDU — vérifié en EXÉCUTANT le module servi au navigateur.
   *
   * Dans le parcours de connexion, la synchronisation initiale conclut AVANT que la
   * première section ne se rende : l'état d'attente ne s'y voit donc pas, et une
   * épreuve qui se contenterait de l'observer conclurait à tort qu'il n'existe pas. On
   * appelle donc directement la fonction de rendu du module réel, avec le drapeau que
   * pose l'absence de conclusion, et l'on regarde ce qu'elle produit.
   */
  const attente = await page.evaluate(async () => {
    const module = await import('/signal-spine.js');
    const segment = {
      segment: 'regie', label: 'Régie', description: 'Fabrication.', state: 'locked',
      stateLabel: 'Verrouillé', roomCount: 1, equipmentCount: 4, downCount: 0, maintenanceCount: 0
    };
    const hote = document.createElement('div');
    hote.innerHTML = module.spineMarkup({ segments: [segment], unassigned: null, intact: true }, { enCours: true });
    const bandeau = hote.firstElementChild;
    return { chargement: bandeau.dataset.chargement, busy: bandeau.getAttribute('aria-busy'), texte: bandeau.innerText || bandeau.textContent };
  });
  verifier('chaîne · pendant la synchronisation, le segment dit « Synchronisation… »',
    /Synchronisation…/.test(attente.texte), JSON.stringify(attente));
  verifier('chaîne · pendant la synchronisation, AUCUN nombre n’est présenté',
    !/\d/.test(attente.texte.replace(/Synchronisation…/g, '')), JSON.stringify(attente));
  verifier('chaîne · l’attente est annoncée aux technologies d’assistance',
    attente.chargement === 'oui' && attente.busy === 'true', JSON.stringify(attente));

  /* Et le bandeau déjà posé se corrige SUR PLACE, sans se dupliquer. */
  const apresEvenement = await page.evaluate(async () => {
    const avant = document.getElementById('signal-spine');
    window.dispatchEvent(new CustomEvent('central-sync-status', { detail: { state: 'synced' } }));
    await new Promise(resolve => setTimeout(resolve, 1500));
    const apres = document.getElementById('signal-spine');
    return {
      memeNoeud: avant === apres,
      nombre: document.querySelectorAll('#signal-spine, .signal-spine').length,
      segments: document.querySelectorAll('#signal-spine .spine-segment').length,
      texte: apres ? apres.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
    };
  });
  /*
   * Ce qui est exigé : UN bandeau, et un seul. Le nœud lui-même peut légitimement être
   * remplacé — une conclusion de synchronisation déclenche ailleurs des rendus de section,
   * et `monterBandeau` repose alors un bandeau neuf. Ce qui serait un défaut, c'est d'en
   * avoir deux, ou de voir les segments s'empiler : c'est exactement ce qui était arrivé
   * avant la seconde garde de `monterBandeau`, avec dix segments au lieu de cinq.
   */
  verifier('chaîne · une conclusion de synchronisation ne duplique pas le bandeau',
    apresEvenement.nombre === 1, JSON.stringify(apresEvenement));
  verifier('chaîne · les segments ne s’empilent pas après rafraîchissement',
    apresEvenement.segments === 5, `${apresEvenement.segments} segments`);

  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/chaine-signal.png` });
  await contexte.close();
}

/* ──────────────── P0-5 · un rôle à périmètre sans habilitation ──────────────── */

async function epreuveSansHabilitation(navigateur) {
  console.log('\n━━━ P0-5 · Périmètre sans habilitation — le dire, pas laisser vide ━━━');
  const cas = [
    { cle: 'chefSansGrant', coque: '#admin-content', attenduMessage: true },
    { cle: 'chef', coque: '#admin-content', attenduMessage: false },
    { cle: 'techniqueSansGrant', coque: 'body', attenduMessage: true }
  ];
  for (const { cle, coque, attenduMessage } of cas) {
    const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
    const page = await contexte.newPage();
    await connecter(page, cle);
    await attendreCoque(page, coque);
    await page.waitForTimeout(1500);
    // Par le HASH, et non par `goto` : un rechargement complet renvoie certaines coques de
    // rôle à leur page d'accueil, et l'on mesurerait alors une page qui n'est pas la liste.
    await page.evaluate(() => { window.location.hash = '#/salles'; });
    await page.waitForTimeout(3000);
    const vu = await page.evaluate(() => {
      const message = document.querySelector('.zone-scope-notice');
      const lignes = document.querySelectorAll('table.tableau tr').length;
      return {
        message: message ? message.innerText.replace(/\s+/g, ' ').trim() : '',
        lignes,
        corps: (document.body.innerText || '').replace(/\s+/g, ' ')
      };
    });
    console.log(`     ↳ ${cle} : ${vu.lignes} ligne(s) de tableau · message « ${vu.message || '(aucun)'} »`);
    if (attenduMessage) {
      verifier(`${cle} · la plateforme dit qu’il manque une habilitation`,
        /pas encore d’autorisation dans cette zone/i.test(vu.message), `« ${vu.message} »`);
      verifier(`${cle} · aucune donnée hors zone n’est nommée`,
        !/Régie finale UI|Diffusion UI|Salle non rattachée UI/.test(vu.corps), 'un nom de salle hors zone apparaît');
    } else {
      verifier(`${cle} · avec habilitation, aucun message d’absence d’autorisation`,
        !/pas encore d’autorisation/i.test(vu.message), `« ${vu.message} »`);
      verifier(`${cle} · avec habilitation, les salles de sa zone sont listées`, vu.lignes > 1, `${vu.lignes} ligne(s)`);
    }
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/perimetre-${cle}.png` });
    await contexte.close();
  }
}

/* ─────────────── Traversée générale : six rôles, six résolutions ─────────────── */

async function traverseeGenerale(navigateur) {
  console.log('\n━━━ Traversée · 6 rôles × 6 résolutions ━━━');
  const matrice = [];
  for (const cle of ['admin', 'manager', 'chef', 'responsable', 'technique', 'visiteur']) {
    for (const resolution of RESOLUTIONS) {
      const contexte = await navigateur.newContext({ viewport: resolution });
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
      page.on('console', message => { if (message.type() === 'error') erreurs.push(`console: ${message.text().slice(0, 160)}`); });
      const connecte = await connecter(page, cle);
      await page.waitForTimeout(3000);
      const debordement = await debordementHorizontal(page);
      const vide = await page.evaluate(() => (document.body.innerText || '').trim().length < 20);
      const ok = verifier(`${cle} · ${resolution.width}×${resolution.height} · l’écran est rendu, sans débordement`,
        connecte && !vide && debordement.document <= debordement.fenetre + 2,
        `connecté=${connecte} vide=${vide} largeur=${debordement.document}/${debordement.fenetre} ${debordement.coupable.join(',')}`);
      // Les erreurs réseau du service worker hors ligne ne sont pas des erreurs d'écran.
      const critiques = erreurs.filter(texte => !/Failed to load resource|favicon|manifest/i.test(texte));
      verifier(`${cle} · ${resolution.width}×${resolution.height} · console sans erreur critique`,
        critiques.length === 0, critiques.slice(0, 2).join(' | '));
      matrice.push({ role: cle, resolution: `${resolution.width}×${resolution.height}`, ok, erreurs: critiques.length });
      if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/traversee-${cle}-${resolution.width}.png` });
      await contexte.close();
    }
  }
  return matrice;
}

/* ────────────────────────────────── Exécution ────────────────────────────────── */

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

console.log(`\n╔═══ UI-POLISH-01 · épreuve de navigateur — ${BASE} ═══╗`);

try {
  await epreuveResponsable(navigateur);
  for (const cle of ['admin', 'manager', 'chef']) await epreuveDerive(navigateur, cle);
  await epreuveChaine(navigateur);
  await epreuveSansHabilitation(navigateur);
  for (const cle of ['admin', 'manager', 'chef']) await epreuveEntete(navigateur, cle);
  const matrice = await traverseeGenerale(navigateur);

  console.log('\n┌─── matrice rôles × résolutions ───┐');
  for (const ligne of matrice) {
    console.log(`  ${ligne.ok ? '✅' : '❌'} ${ligne.role.padEnd(12)} ${ligne.resolution.padEnd(10)} erreurs=${ligne.erreurs}`);
  }
} finally {
  await navigateur.close();
}

console.log(`\n╚═══ ${echecs === 0 ? '✅ VERT' : `❌ ${echecs} ÉCHEC(S)`} sur ${verifications} vérifications ═══╝\n`);
if (echecs) {
  console.log('Constats :');
  for (const constat of constats.slice(0, 40)) console.log(`  · ${constat}`);
}
process.exit(echecs ? 1 : 0);
