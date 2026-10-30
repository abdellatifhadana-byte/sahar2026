/**
 * @file scripts/procedures-mvp-browser-gate.mjs — l'épreuve navigateur du lot Procédures.
 *
 * CE QU'ELLE PROUVE, ET QU'AUCUN TEST DE SOURCE NE PEUT PROUVER
 * ------------------------------------------------------------
 * Qu'une section rendue par un vrai navigateur, sur une vraie base, montre les procédures
 * RÉELLEMENT persistées ; que la recherche filtre ce qui est écrit ; que les entités citées
 * s'affichent sous leur nom d'inventaire ; que la matrice de rôles décide seule de qui voit
 * la section ; et — le point qui compte le plus ici — qu'OUVRIR une page n'écrit rien.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-decor.mjs && node scripts/seed-procedures…  (décor du lot)
 *   node scripts/procedures-mvp-browser-gate.mjs
 */
import { createRequire } from 'node:module';
import { BASE, COMPTES, motDePasseDe } from './ui-polish-decor.mjs';

const base = process.env.E2E_BASE_URL || BASE;
const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch { console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ».`); process.exit(2); }
const RESOLUTIONS = [
  { width:1920, height:1080 }, { width:1440, height:900 },
  { width:1366, height:768 }, { width:1024, height:768 }
];

let controles = 0, echecs = 0;
const constats = [];
const ok = (nom, condition, detail = '') => {
  controles += 1;
  if (condition) { console.log(`  ✅ ${nom}${detail ? ' → ' + detail : ''}`); return true; }
  echecs += 1; constats.push(`${nom}${detail ? ' → ' + detail : ''}`);
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

async function connecter(page, cle) {
  const compte = COMPTES[cle];
  await page.goto(`${base}/`, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout:40000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state:'detached', timeout:40000 });
  for (let essai = 0; essai < 40; essai += 1) {
    try { if (await page.evaluate(() => localStorage.getItem('auth'))) return true; }
    catch { /* navigation en cours */ }
    await page.waitForTimeout(250);
  }
  return false;
}

const debordement = page => page.evaluate(() => ({
  document:document.documentElement.scrollWidth, fenetre:window.innerWidth,
  coupable:[...document.querySelectorAll('body *')]
    .filter(node => node.getBoundingClientRect().right > window.innerWidth + 2)
    .slice(0, 3).map(node => `${node.tagName}.${String(node.className || '').split(' ')[0]}`)
}));

/* ─────────────── 1 · la matrice de rôles décide, et elle seule ─────────────── */
async function epreuveRoles(navigateur) {
  console.log('\n━━━ 1 · Qui reçoit la section « Procédures » ━━━');
  // `permissions.js` accorde `continuity {view}` à admin, manager, chef et responsable ;
  // le technicien la voit aussi mais par un BOUTON (create:false) ; le visiteur, jamais.
  const attendu = { admin:true, manager:true, chef:true, responsable:true, technique:false, visiteur:false };
  for (const [cle, doitVoir] of Object.entries(attendu)) {
    const contexte = await navigateur.newContext({ viewport:RESOLUTIONS[0] });
    const page = await contexte.newPage();
    try {
      if (!await connecter(page, cle)) { ok(`${cle} · connexion`, false); continue; }
      // On ATTEND que la barre porte ses sections avant de la lire : un instantané pris
      // trop tôt disait « absente » d'une section pourtant rendue une fraction de seconde
      // plus tard — un faux rouge qui aurait fait corriger un défaut inexistant.
      // Le visiteur n'a pas de barre latérale : son absence est une réponse, pas un échec.
      await page.waitForSelector('.sidebar-menu a[data-section]', { timeout:15000 }).catch(() => {});
      const sections = await page.$$eval('.sidebar-menu a[data-section]', liens => liens.map(l => l.dataset.section))
        .catch(() => []);
      const presente = sections.includes('procedures');
      ok(`${cle} · section « procedures » ${doitVoir ? 'présente' : 'absente'}`, presente === doitVoir,
        presente ? 'présente' : 'absente');
    } finally { await contexte.close(); }
  }
}

/* ─────────────── 2 · la section montre les données réelles ─────────────── */
async function epreuveContenu(navigateur) {
  console.log('\n━━━ 2 · Liste, recherche, ouverture — sur les données de la base ━━━');
  const contexte = await navigateur.newContext({ viewport:RESOLUTIONS[0] });
  const page = await contexte.newPage();
  const erreurs = [];
  const ecritures = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message || erreur)));
  page.on('console', message => { if (message.type() === 'error') erreurs.push(message.text()); });
  page.on('request', requete => {
    const methode = requete.method();
    if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(methode) && !/\/api\/auth\//.test(requete.url())) {
      ecritures.push(`${methode} ${requete.url().replace(base, '')}`);
    }
  });

  try {
    if (!await connecter(page, 'admin')) { ok('admin · connexion', false); return; }
    /*
     * L'AMORÇAGE N'EST PAS UNE ÉCRITURE DE LECTURE.
     *
     * À la première connexion sur une base neuve, les modules de catalogue écrivent leur
     * inventaire (`PUT /api/data/equipments/regie-car-…`). Compter ces écritures-là
     * imputerait à cette section un comportement qui n'est pas le sien. On laisse donc
     * l'amorçage retomber, PUIS on remet le compteur à zéro : ce qui est mesuré ensuite
     * est bien ce que produit la consultation des procédures, et rien d'autre.
     */
    await page.waitForTimeout(6000);
    ecritures.length = 0;
    /*
     * Les erreurs de console suivent la même règle, et pour la même raison. Mesuré sur ce
     * dépôt, sans jamais ouvrir cette section : `409 PUT /api/data/docs/regiecar-2026-08-16:*`
     * (les modules de décor Régie Car se disputent la révision d'un même document) et
     * `403 GET /api/operational/grille-centrale/documented-map`. Ces bruits d'amorçage sont
     * antérieurs et étrangers au lot ; les compter ici les lui imputerait à tort. Ce qui est
     * mesuré ensuite est bien ce que produit la consultation des procédures.
     */
    erreurs.length = 0;

    await page.click('.sidebar-menu a[data-section="procedures"]');
    await page.waitForSelector('.procedures-center', { timeout:20000 });
    ok('la section s’ouvre', true);

    const cartes = await page.$$eval('[data-procedure-card]', n => n.map(c => c.dataset.procedureCard));
    ok('les deux procédures persistées sont listées', cartes.length === 2, cartes.join(', ') || 'aucune');

    const titres = await page.$$eval('.procedure-card h3', n => n.map(e => e.textContent.trim()));
    ok('le titre réel est affiché', titres.some(t => t.includes('Bascule encodeur RF1')), titres.join(' | '));

    // Les puces portent le NOM D'INVENTAIRE, pas le libellé figé dans la référence.
    const puces = await page.$$eval('.procedure-ref', n => n.map(e => e.textContent.trim()));
    ok('une entité citée s’affiche sous son nom d’inventaire',
      puces.some(p => p.includes('Baie UI 01')), puces.slice(0, 4).join(' | '));
    ok('le type de l’entité est dit', puces.some(p => p.startsWith('Baie ·') || p.includes('Baie ·')),
      puces.slice(0, 4).join(' | '));

    // Recherche par le TITRE.
    await page.fill('[data-procedure-search]', 'hebdomadaire');
    await page.waitForTimeout(350);
    let visibles = await page.$$eval('[data-procedure-card]', n => n.length);
    ok('la recherche par titre filtre', visibles === 1, `${visibles} carte(s)`);

    // Recherche par le NOM D'UNE ENTITÉ CITÉE — le titre ne contient pas « Baie UI 01 ».
    await page.fill('[data-procedure-search]', 'Baie UI 01');
    await page.waitForTimeout(350);
    visibles = await page.$$eval('[data-procedure-card]', n => n.length);
    ok('la recherche par entité citée trouve la procédure', visibles === 1, `${visibles} carte(s)`);

    await page.fill('[data-procedure-search]', 'zzz-introuvable');
    await page.waitForTimeout(350);
    const vide = await page.$('.procedures-empty');
    ok('une recherche sans résultat le DIT au lieu de rester vide', Boolean(vide));

    await page.fill('[data-procedure-search]', '');
    await page.waitForTimeout(350);

    // Ouverture du détail.
    await page.click('[data-procedure-open="mvp-proc-bascule"]');
    await page.waitForSelector('#procedure-detail-modal', { timeout:15000 });
    const etapes = await page.$$eval('#procedure-detail-modal .procedure-step', n => n.length);
    ok('le détail rend les trois étapes persistées', etapes === 3, `${etapes} étape(s)`);
    const instruction = await page.textContent('#procedure-detail-modal .procedure-step-instruction');
    ok('l’instruction réelle est rendue', /Ouvrir la baie/.test(instruction || ''), (instruction || '').slice(0, 60));
    const renvoi = await page.textContent('#procedure-detail-modal .procedures-note');
    ok('la validation renvoie explicitement vers Continuité', /Continuité/.test(renvoi || ''));

    // Aucun bouton mort : tout `button` du détail porte un gestionnaire réel.
    const boutonsSansAction = await page.$$eval('#procedure-detail-modal button', boutons =>
      boutons.filter(b => !b.onclick && !b.dataset.openEquipment && !b.classList.contains('modal-x')).length);
    ok('aucun bouton sans action dans le détail', boutonsSansAction === 0, `${boutonsSansAction} bouton(s)`);

    await page.click('#procedure-detail-modal .modal-x');
    await page.waitForTimeout(300);

    ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    // LE POINT DUR : consulter n'écrit pas.
    ok('aucune écriture pendant la consultation', ecritures.length === 0, ecritures.slice(0, 3).join(' | '));
  } finally { await contexte.close(); }
}

/* ─────────────── 3 · la fiche 360 dit ce qui la documente ─────────────── */
async function epreuve360(navigateur) {
  console.log('\n━━━ 3 · Fiche 360 — schémas & procédures liés ━━━');
  const contexte = await navigateur.newContext({ viewport:RESOLUTIONS[0] });
  const page = await contexte.newPage();
  try {
    if (!await connecter(page, 'admin')) { ok('admin · connexion', false); return; }
    /*
     * ON ATTEND UNE CONDITION, PAS UNE DURÉE.
     *
     * Une attente fixe de 1,5 s suffisait sur une machine au repos et glissait dès que
     * plusieurs bouches tournaient ensemble : `window.TechOperations` n'était pas encore
     * posé, l'ouvreur partait à vide, et l'épreuve accusait la carte d'être absente alors
     * qu'un appel direct la posait en moins d'une seconde. Un faux rouge coûte plus cher
     * qu'une seconde d'attente — on attend donc que l'ouvreur EXISTE.
     */
    await page.waitForFunction(() => Boolean(window.TechOperations?.openEquipment360), { timeout:30000 });
    const ouvert = await page.evaluate(async () => {
      await window.TechOperations.openEquipment360('ui-polish-regie-1');
      return 'ouvert';
    });
    if (ouvert !== 'ouvert') { ok('l’ouvreur de fiche 360 est disponible', false, ouvert); return; }
    await page.waitForSelector('#ops-equipment-360', { timeout:15000 });
    // La carte est posée par un observateur, en trois tentatives échelonnées : on lui laisse
    // le temps d'aboutir plutôt que de photographier un instant arbitraire.
    const carte = await page.waitForSelector('.ops-engineering-links', { timeout:15000 }).catch(() => null);
    if (!ok('la carte « Schémas & procédures » est posée', Boolean(carte))) return;
    const texte = await page.textContent('.ops-engineering-links');
    ok('la procédure qui cite cet équipement est listée',
      /Bascule encodeur RF1/.test(texte || ''), (texte || '').replace(/\s+/g, ' ').slice(0, 90));
  } finally { await contexte.close(); }
}

/* ─────────────── 4 · quatre résolutions, aucune barre horizontale ─────────────── */
async function epreuveResolutions(navigateur) {
  console.log('\n━━━ 4 · 1920 / 1440 / 1366 / 1024 ━━━');
  for (const resolution of RESOLUTIONS) {
    const contexte = await navigateur.newContext({ viewport:resolution });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', erreur => erreurs.push(String(erreur.message || erreur)));
    try {
      if (!await connecter(page, 'admin')) { ok(`${resolution.width} · connexion`, false); continue; }
      await page.waitForTimeout(1500);
      await page.click('.sidebar-menu a[data-section="procedures"]');
      await page.waitForSelector('.procedures-center', { timeout:20000 });
      await page.waitForTimeout(500);
      const mesure = await debordement(page);
      ok(`${resolution.width}×${resolution.height} · aucun débordement horizontal`,
        mesure.document <= mesure.fenetre + 2, mesure.coupable.join(', '));
      ok(`${resolution.width}×${resolution.height} · aucune erreur JavaScript`, erreurs.length === 0,
        erreurs.slice(0, 1).join(' | '));
    } finally { await contexte.close(); }
  }
}

const navigateur = await chromium.launch({
  executablePath:process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox', '--disable-dev-shm-usage']
});

console.log(`\n╔═══ PROCEDURES-MVP · épreuve de navigateur — ${base} ═══╗`);
try {
  await epreuveRoles(navigateur);
  await epreuveContenu(navigateur);
  await epreuve360(navigateur);
  await epreuveResolutions(navigateur);
} finally { await navigateur.close(); }

console.log(`\n╚═══ ${echecs ? `❌ ${echecs} ÉCHEC(S)` : '✅ VERT'} sur ${controles} vérifications ═══╝\n`);
if (constats.length) { console.log('Constats :'); for (const constat of constats) console.log(`  · ${constat}`); }
process.exit(echecs ? 1 : 0);
