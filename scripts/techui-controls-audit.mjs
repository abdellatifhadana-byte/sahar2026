/**
 * @file scripts/techui-controls-audit.mjs — chaque contrôle du technicien, cliqué pour de vrai.
 *
 * CE QUE CETTE ÉPREUVE FAIT
 * -------------------------
 * Elle ouvre l'espace technicien avec une VRAIE session, dresse l'inventaire de tout ce qui
 * a l'air cliquable — bouton, lien, `role="button"`, `data-action`, `data-id`, ou
 * simplement un curseur en forme de main — puis CLIQUE chacun d'eux, un par un, en
 * revenant au tableau de bord entre chaque.
 *
 * Pour chaque contrôle elle note : le libellé, le sélecteur, la route avant, la route
 * après, la vue réellement rendue, la fenêtre ou l'entité ouverte, les erreurs de console.
 * Puis elle classe le résultat :
 *
 *   ROUTE               une section autorisée s'est réellement rendue ;
 *   FENÊTRE             une fenêtre modale s'est ouverte, avec son identité ;
 *   ENTITÉ              une fiche a été ouverte SUR L'IDENTIFIANT ATTENDU ;
 *   DIALOGUE            un message natif s'est affiché ;
 *   ÉCRAN               la vue a changé sans changer de route (mur, diagnostic…) ;
 *   DOM                 un effet visible et volontaire, sans navigation ;
 *   ⛔ MORT             rien ne s'est produit : le contrôle ment sur sa nature ;
 *   ⛔ REPLI SILENCIEUX la route demandée n'est pas celle qui s'est rendue.
 *
 * Les deux dernières classes sont le défaut que le lot TECHUI-01 doit fermer.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-decor.mjs && node scripts/techui-decor.mjs
 *   node scripts/techui-controls-audit.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { BASE, COMPTES, motDePasseDe } from './ui-polish-decor.mjs';
import { EQUIPEMENT_CRITIQUE } from './techui-decor.mjs';

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CAPTURES = process.env.TECHUI_CAPTURES || '';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch { console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ».`); process.exit(2); }
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

/** Les sections que le contrat de navigation accorde au technicien, et elles seules. */
const SECTIONS_AUTORISEES = new Set(['dashboard', 'devices', 'salles', 'baies', 'tickets', 'maintenance', 'notifications', 'screens']);

/*
 * `#btn-logout` n'est pas cliqué : il ferme la session et emporterait l'épreuve entière.
 * Son effet est vérifié autrement — il émet `logout` par le système d'événements, ce que
 * `tests/` couvre déjà. Aucun autre contrôle n'est écarté.
 */
const NON_CLIQUES = new Set(['#btn-logout']);

const SONDE = `
  window.__routes = [];
  window.addEventListener('hashchange', () => window.__routes.push(location.hash));
`;

async function connecter(page, cle) {
  const compte = COMPTES[cle];
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 60000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 60000 });
  await page.waitForSelector('.smart-tech-board', { timeout: 60000 });
  await page.waitForTimeout(2500);
}

/** L'inventaire de ce qui a l'air cliquable, dans l'ordre du document. */
const INVENTAIRE = `() => {
  /* Le dépliant d'identité est ouvert DANS LE MÊME TOUR que l'inventaire. L'ouvrir par un
     clic séparé laissait un rendu s'intercaler et le refermer : « Profil » et
     « Paramètres » retombaient à zéro pixel, et l'épreuve concluait qu'ils allaient bien
     alors qu'elle ne les avait jamais vus. */
  const depliant = document.getElementById('user-dropdown');
  const displayInitial = depliant ? depliant.style.display : '';
  if (depliant) depliant.style.display = 'block';
  const vu = new Set();
  const retenus = new Set();
  const sortie = [];
  const interactif = node => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (['BUTTON', 'A'].includes(node.tagName)) return true;
    if (node.getAttribute('role') === 'button') return true;
    if (node.hasAttribute('data-action') || node.hasAttribute('data-id')) return true;
    if (typeof node.onclick === 'function') return true;
    return style.cursor === 'pointer';
  };
  const chemin = node => {
    if (node.id) return '#' + CSS.escape(node.id);
    const morceaux = [];
    let courant = node;
    while (courant && courant.nodeType === 1 && morceaux.length < 5) {
      let morceau = courant.tagName.toLowerCase();
      if (courant.id) { morceaux.unshift('#' + CSS.escape(courant.id)); break; }
      const classes = [...courant.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      if (classes) morceau += classes;
      const parent = courant.parentElement;
      if (parent) {
        const memes = [...parent.children].filter(enfant => enfant.tagName === courant.tagName);
        if (memes.length > 1) morceau += ':nth-of-type(' + (memes.indexOf(courant) + 1) + ')';
      }
      morceaux.unshift(morceau);
      courant = courant.parentElement;
    }
    return morceaux.join(' > ');
  };
  for (const node of document.querySelectorAll('.smart-tech-board *, .tech-route-view *')) {
    if (!interactif(node)) continue;
    /* DÉCOR ou CONTRÔLE ?
       Une carte de ticket est cliquable ; le titre, la puce de priorité et le chevron
       qu'elle contient héritent de son curseur sans être des contrôles — les éprouver
       produirait dix « contrôles morts » là où il n'y a qu'une carte. À l'inverse,
       « Profil » et « Paramètres » sont de VRAIS boutons logés dans un conteneur
       cliquable : les prendre pour du décor reviendrait à ne jamais les éprouver.
       La règle : un descendant n'est retenu que s'il est lui-même un contrôle déclaré. */
    let ancetreRetenu = node.parentElement;
    while (ancetreRetenu && !retenus.has(ancetreRetenu)) ancetreRetenu = ancetreRetenu.parentElement;
    const controleDeclare = ['BUTTON', 'A'].includes(node.tagName)
      || node.getAttribute('role') === 'button'
      || node.hasAttribute('data-action')
      || ['checkbox', 'radio', 'submit'].includes(node.getAttribute('type') || '');
    if (ancetreRetenu && !controleDeclare) { vu.add(node); continue; }
    vu.add(node);
    retenus.add(node);
    sortie.push({
      selecteur: chemin(node),
      libelle: (node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || node.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60),
      action: node.getAttribute('data-action') || '',
      identifiant: node.getAttribute('data-id') || '',
      type: node.getAttribute('data-type') || ''
    });
  }
  if (depliant) depliant.style.display = displayInitial;
  return sortie;
}`;

/** Ce que l'écran montre à cet instant : route, vue, fenêtres ouvertes. */
const ETAT = `() => ({
  hash: location.hash,
  tableau: Boolean(document.querySelector('.smart-tech-board')),
  vueRoute: Boolean(document.querySelector('.tech-route-view')),
  titreRoute: document.querySelector('.tech-route-view h2')?.innerText.trim() || '',
  /* app-dialog.js remplace window.alert : un message natif n'existe plus, il devient une
     fenêtre .app-dialog-backdrop. La chercher ailleurs revenait à ne rien voir. */
  fenetres: [...document.querySelectorAll('.modal, .ops-modal, #ops-equipment-360, #ticket-detail-modal, #chat-modal-smart, #map-modal, .app-dialog-backdrop')]
    .filter(node => getComputedStyle(node).display !== 'none')
    .map(node => node.id || node.className).slice(0, 3),
  entite: document.querySelector('#ops-equipment-360 .ops-modal-head div div')?.innerText.trim()
       || document.querySelector('#ticket-detail-modal .request-number')?.innerText.trim() || '',
  texteFenetre: (document.querySelector('#ops-equipment-360, #ticket-detail-modal, #chat-modal-smart, .app-dialog-card, .modal')?.innerText || '')
    .replace(/\\s+/g, ' ').trim().slice(0, 220),
  // Une empreinte de CONTENU, et non une longueur : un dépliant qui s'ouvre, une astuce
  // qui change, un graphique redessiné ne modifient parfois que quelques octets — les
  // compter donnait « contrôle mort » à des contrôles bien vivants.
  empreinte: (() => {
    /* Le fond de motivation repositionne trente phrases AU HASARD à chaque rendu : le
       compter ferait passer n'importe quel rendu pour un effet du clic. */
    const app = document.querySelector('#app')?.cloneNode(true);
    app?.querySelector('#motivation-bg')?.replaceChildren();
    /* Le dépliant d'identité se referme au moindre clic ailleurs : compter cette
       fermeture comme un effet ferait passer « Profil » et « Paramètres » — qui ne font
       rien du tout — pour des contrôles vivants. On neutralise donc son état. */
    app?.querySelector('#user-dropdown')?.removeAttribute('style');
    const source = (app?.innerHTML || '') + '|' + document.body.children.length;
    let h = 0;
    for (let i = 0; i < source.length; i += 1) { h = (h * 31 + source.charCodeAt(i)) | 0; }
    return h;
  })(),
  /* Le dépliant d'identité est neutralisé dans l'empreinte — sa fermeture ne doit pas
     créditer les autres contrôles. Mais SON PROPRE bouton, lui, se juge là-dessus : on
     expose donc son état à part. */
  depliantOuvert: getComputedStyle(document.getElementById('user-dropdown') || document.createElement('div')).display === 'block',
  taches: document.querySelectorAll('#daily-tasks-list li').length,
  horsApp: document.body.innerText.replace(document.getElementById('app')?.innerText || '', '').replace(/\s+/g, ' ').trim().slice(0, 120)
})`;

let echecs = 0;
let verifications = 0;
const verifier = (nom, condition, detail = '') => {
  verifications += 1;
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

async function revenirAuTableau(page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('#ops-equipment-360, #ticket-detail-modal, #chat-modal-smart, #map-modal, .modal, .app-dialog-backdrop')) node.remove();
    /* `#welcome-screen` — le rappel de la carte — se pose sur `body`, hors du modal, et se
       ferme au premier clic de l'utilisateur. L'épreuve, elle, retire le modal par le code :
       le rappel resterait alors devant les boutons flottants et les rendrait inatteignables.
       C'est un artefact de l'ÉPREUVE, pas un défaut du produit. */
    document.getElementById('welcome-screen')?.remove();
    /* Les bandeaux de notification survivent quelques secondes et fausseraient la
       comparaison « hors application » du contrôle suivant. */
    for (const node of document.querySelectorAll('.notification, .toast, [class*="notification"]')) {
      if (!node.closest('#app')) node.remove();
    }
    document.getElementById('user-dropdown')?.style.setProperty('display', 'none');
    /* Une sous-vue — le mur d'images, le diagnostic d'un écran — occupe légitimement
       l'écran et NE cède plus la place toute seule : c'était justement le défaut corrigé.
       L'épreuve doit donc en sortir comme un utilisateur le ferait, par le bouton Retour
       du produit. Sans cela, tous les contrôles suivants seraient déclarés « incliquables »
       alors que c'est l'épreuve, et non le produit, qui serait restée bloquée. */
    const sousVue = document.querySelector('#app > [data-tech-surface]:not([data-tech-surface="dashboard"])');
    if (sousVue) {
      const retour = document.getElementById('wall-back') || sousVue.querySelector('.btn-back, [data-action="back"]');
      if (retour) retour.click();
    }
    if (location.hash !== '#/dashboard') location.hash = '#/dashboard';
  });
  await page.waitForTimeout(400);
  /* Filet, si le bouton Retour n'existait pas : un aller-retour d'adresse. Le contrat de la
     coque est qu'une navigation explicite rend la surface au tableau de bord. */
  if (await page.locator('#app > [data-tech-surface]:not([data-tech-surface="dashboard"])').count()) {
    await page.evaluate(() => { location.hash = '#/devices'; });
    await page.waitForTimeout(700);
    await page.evaluate(() => { location.hash = '#/dashboard'; });
  }
  await page.waitForTimeout(1400);
  await page.waitForSelector('.smart-tech-board', { timeout: 20000 }).catch(() => {});
  // On laisse le tableau se stabiliser : un rendu encore en cours au moment de la mesure
  // ferait passer sa propre agitation pour l'effet du clic.
  await page.waitForTimeout(900);
}

async function auditer(navigateur) {
  /* Conditions RÉELLES de l'utilisateur : le service worker vit, comme en production.
     La mesure du module dormant, elle, a besoin de le couper — elle a donc son propre
     contexte, plus bas, plutôt que d'imposer ses conditions à tout l'audit. */
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 1000 } });
  await contexte.addInitScript(SONDE);
  const page = await contexte.newPage();
  const erreurs = [];
  const dialogues = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  page.on('console', message => { if (message.type() === 'error') erreurs.push(`console: ${message.text().slice(0, 160)}`); });
  page.on('dialog', async dialogue => { dialogues.push(dialogue.message()); await dialogue.dismiss().catch(() => {}); });

  await connecter(page, 'technique');
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/tableau-technicien.png` });

  const controles = await page.evaluate(eval(INVENTAIRE));
  console.log(`\n━━━ Inventaire : ${controles.length} éléments d’apparence interactive ━━━\n`);

  const resultats = [];
  for (const controle of controles) {
    if (NON_CLIQUES.has(controle.selecteur)) {
      resultats.push({ ...controle, classe: 'ÉCARTÉ', detail: 'ferme la session — non cliqué à dessein' });
      continue;
    }
    await revenirAuTableau(page);
    // Un bouton « Ajouter » sur un champ vide a RAISON de ne rien faire : on lui donne de
    // quoi travailler avant de le juger, sinon on mesurerait sa garde, pas son action.
    if (/add-task-form/.test(controle.selecteur)) {
      /* Le tableau se réécrit en entier après chaque retour : une saisie posée pendant ce
         rendu est emportée avec le champ, et le bouton se retrouve jugé sur un formulaire
         vide — où il a RAISON de ne rien faire. On vérifie donc que la valeur a tenu. */
      const valeur = `Tâche d’épreuve ${Date.now() % 100000}`;
      for (let essai = 0; essai < 4; essai += 1) {
        await page.fill('#new-task', valeur).catch(() => {});
        if (await page.inputValue('#new-task').catch(() => '') === valeur) break;
        await page.waitForTimeout(600);
      }
    }
    // Les contrôles du dépliant ne sont atteignables que dépliant ouvert.
    if (/btn-profile|btn-settings|user-dropdown/.test(controle.selecteur)) {
      await page.evaluate(() => document.querySelector('.user-block')?.click());
      await page.waitForTimeout(400);
    }
    const avant = await page.evaluate(eval(ETAT));
    const nombreDialogues = dialogues.length;
    const erreursAvant = erreurs.length;

    const cible = page.locator(controle.selecteur).first();
    let cliqueOk = true;
    let obstacle = '';
    try { await cible.click({ timeout: 4000 }); }
    catch {
      // Un clic refusé est une mesure, pas un accident : on nomme ce qui recouvre la
      // cible avant de conclure. Les bandeaux de notification, par exemple, se posent
      // par-dessus les boutons flottants et les rendent inatteignables quelques secondes.
      obstacle = await page.evaluate(selecteur => {
        const node = document.querySelector(selecteur);
        if (!node) return 'cible absente';
        const rect = node.getBoundingClientRect();
        const dessus = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
        if (!dessus) return 'hors de la vue';
        if (node.contains(dessus)) return '';
        return `${dessus.tagName}.${String(dessus.className || '').split(' ')[0]}${dessus.id ? '#' + dessus.id : ''}`;
      }, controle.selecteur).catch(() => 'indéterminé');
      // Recouvrement passager : on laisse retomber les bandeaux et on retente UNE fois.
      await page.waitForTimeout(4500);
      try { await cible.click({ timeout: 4000 }); }
      catch { cliqueOk = false; }
    }
    /* ON ATTEND L'EFFET, ON NE LE SUPPOSE PAS ARRIVÉ.
       Certaines actions remplacent la vue de façon asynchrone — le mur d'images recharge
       ses ressources, le diagnostic interroge la base. Un délai fixe déclarait « mort »
       un contrôle simplement plus lent que les autres, et le verdict changeait selon que
       le cache était chaud ou froid. On échantillonne donc jusqu'à six secondes et l'on
       s'arrête à la première différence. */
    let apres = await page.evaluate(eval(ETAT));
    for (let attente = 0; attente < 20; attente += 1) {
      await page.waitForTimeout(300);
      apres = await page.evaluate(eval(ETAT));
      const change = apres.hash !== avant.hash
        || apres.fenetres.length !== avant.fenetres.length
        || apres.tableau !== avant.tableau
        || apres.empreinte !== avant.empreinte
        || apres.horsApp !== avant.horsApp
        || apres.depliantOuvert !== avant.depliantOuvert;
      if (change && attente >= 3) break;
    }

    let classe = '⛔ MORT';
    let detail = '';
    /* Le formulaire de tâche ne se juge pas à l'agitation du DOM mais à SON effet : une
       ligne de plus dans la liste. C'est la seule façon de distinguer « il a ajouté la
       tâche » de « il n'a rien fait ». */
    if (/add-task-form/.test(controle.selecteur)) {
      const lignes = await page.evaluate(() => document.querySelectorAll('#daily-tasks-list li').length);
      if (lignes > (avant.taches ?? 0)) { classe = 'DOM'; detail = `tâche ajoutée (${avant.taches} → ${lignes})`; }
    }
    /* Le rendu du tableau peut emporter la saisie entre le remplissage et le clic. Plutôt
       que de déclarer mort un bouton qui n'avait rien à soumettre, on refait le geste une
       fois, saisie comprise — et on ne conclut qu'ensuite. */
    if (/add-task-form/.test(controle.selecteur) && classe === '⛔ MORT') {
      const avantSecond = await page.evaluate(() => document.querySelectorAll('#daily-tasks-list li').length);
      await page.fill('#new-task', `Tâche d’épreuve ${Date.now() % 100000}`).catch(() => {});
      await cible.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const apresSecond = await page.evaluate(() => document.querySelectorAll('#daily-tasks-list li').length);
      if (apresSecond > avantSecond) { classe = 'DOM'; detail = `tâche ajoutée (${avantSecond} → ${apresSecond})`; }
    }
    // Le bouton du dépliant a pour seule fonction d'ouvrir ou de fermer le dépliant.
    if (/user-block/.test(controle.selecteur) && apres.depliantOuvert !== avant.depliantOuvert) {
      classe = 'DOM';
      detail = apres.depliantOuvert ? 'dépliant d’identité ouvert' : 'dépliant d’identité fermé';
    }
    if (classe !== '⛔ MORT') { /* verdict spécifique déjà rendu */ }
    else if (!cliqueOk) { classe = 'INCLIQUABLE'; detail = `la cible n’a pas pu être cliquée${obstacle ? ` — recouverte par ${obstacle}` : ''}`; }
    else if (dialogues.length > nombreDialogues) { classe = 'DIALOGUE'; detail = dialogues[dialogues.length - 1].replace(/\s+/g, ' ').slice(0, 120); }
    else if (apres.fenetres.length > avant.fenetres.length) {
      classe = apres.entite ? 'ENTITÉ' : 'FENÊTRE';
      detail = `${apres.fenetres.join(',')}${apres.entite ? ` · ${apres.entite}` : ''}`;
    } else if (apres.hash !== avant.hash) {
      const section = apres.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'dashboard';
      const autorisee = SECTIONS_AUTORISEES.has(section);
      const rendue = apres.vueRoute ? 'vue de section' : (apres.tableau ? 'tableau de bord' : 'autre');
      if (!autorisee || (section !== 'dashboard' && !apres.vueRoute)) {
        classe = '⛔ REPLI SILENCIEUX';
        detail = `demandé « ${apres.hash} » → rendu ${rendue}${autorisee ? '' : ' (route NON autorisée)'}`;
      } else {
        classe = 'ROUTE';
        detail = `${apres.hash} → ${apres.titreRoute || rendue}`;
      }
    } else if (!apres.tableau && avant.tableau) { classe = 'ÉCRAN'; detail = 'la vue a été remplacée'; }
    else if (apres.empreinte !== avant.empreinte || apres.horsApp !== avant.horsApp) {
      classe = 'DOM';
      detail = apres.horsApp !== avant.horsApp ? `message : ${apres.horsApp.slice(0, 70)}` : 'effet visible sans navigation';
    }

    resultats.push({
      ...controle, classe, detail,
      erreurs: erreurs.length - erreursAvant
    });
    console.log(`  ${classe.padEnd(20)} « ${controle.libelle.padEnd(28)} » ${controle.selecteur}${detail ? `\n      ${detail}` : ''}`);
  }

  await revenirAuTableau(page);
  return { page, contexte, resultats, erreurs, dialogues };
}

/* ─── Les huit exigences nommées par le lot, éprouvées une à une ─── */

async function exigences(page, resultats, dialogues) {
  console.log('\n━━━ Les huit exigences du lot ━━━');

  const trouver = motif => resultats.filter(item => motif.test(item.libelle) || motif.test(item.selecteur));

  const profil = trouver(/Profil|btn-profile/i);
  verifier('P0-1 · Profil : soit un workflow réel, soit aucun contrôle',
    profil.length === 0 || profil.every(item => !item.classe.startsWith('⛔')),
    profil.map(item => `${item.libelle}=${item.classe}`).join(' | '));

  const parametres = trouver(/Paramètres|btn-settings/i);
  verifier('P0-2 · Paramètres : soit un workflow réel autorisé, soit aucun contrôle',
    parametres.length === 0 || parametres.every(item => !item.classe.startsWith('⛔')),
    parametres.map(item => `${item.libelle}=${item.classe}`).join(' | '));

  const voirTout = resultats.filter(item => item.action === 'show-all-activities' || /card-activity/.test(item.selecteur));
  verifier('P0-3 · Activités : aucun contrôle ne mène à une route interdite',
    voirTout.every(item => !item.classe.startsWith('⛔')),
    voirTout.map(item => `${item.libelle}=${item.classe} ${item.detail}`).join(' | '));
  const routesVues = await page.evaluate(() => window.__routes || []);
  verifier('P0-3 · `#/logs` n’a JAMAIS été demandé pour le technicien',
    !routesVues.some(route => /^#\/logs/.test(route)), routesVues.filter(r => /logs/.test(r)).join(', '));

  const cartesTicket = resultats.filter(item => item.type === 'ticket' || /ticket-item/.test(item.selecteur));
  verifier('P0-4 · carte ticket : ouvre le ticket EXACT ou n’a plus l’air interactive',
    cartesTicket.every(item => item.classe === 'ENTITÉ' || item.classe === 'ROUTE' || !item.classe.startsWith('⛔')),
    cartesTicket.map(item => `${item.identifiant}=${item.classe}`).join(' | '));
  for (const carte of cartesTicket) {
    if (carte.classe !== 'ENTITÉ') continue;
    verifier(`P0-4 · le ticket ouvert porte bien l’identifiant ${carte.identifiant}`,
      carte.detail.includes(carte.identifiant), carte.detail);
  }

  const cartesEquip = resultats.filter(item => item.type === 'equipment' || /critical-item/.test(item.selecteur));
  verifier('P0-5 · carte équipement : ouvre la fiche EXACTE ou n’a plus l’air interactive',
    cartesEquip.every(item => item.classe === 'ENTITÉ' || item.classe === 'ROUTE' || !item.classe.startsWith('⛔')),
    cartesEquip.map(item => `${item.identifiant}=${item.classe}`).join(' | '));

  /*
   * L'IDENTITÉ DE LA FICHE ÉQUIPEMENT SE VÉRIFIE SUR UNE DONNÉE, PAS SUR UN TITRE.
   *
   * Le titre de la fiche 360° porte le nom de l'appareil ; deux appareils peuvent le
   * partager. Le numéro de série du décor, lui, ne désigne qu'un enregistrement — c'est
   * donc lui qui prouve que la carte a ouvert LE bon, et non un homonyme.
   */
  const carteCritique = resultats.find(item => item.identifiant === EQUIPEMENT_CRITIQUE);
  if (carteCritique && carteCritique.classe === 'ENTITÉ') {
    await revenirAuTableau(page);
    await page.evaluate(identifiant => {
      document.querySelector(`.critical-item[data-id="${identifiant}"]`)?.click();
    }, EQUIPEMENT_CRITIQUE);
    await page.waitForTimeout(2200);
    const fiche = await page.evaluate(() => (document.getElementById('ops-equipment-360')?.innerText || '').replace(/\s+/g, ' '));
    verifier(`P0-5 · la fiche ouverte est bien celle de ${EQUIPEMENT_CRITIQUE} (n° de série du décor)`,
      /TECHUI-SN-0001/.test(fiche), fiche.slice(0, 140));
    verifier('P0-5 · la fiche conserve la chaîne Équipement → Baie → Salle',
      /Baie UI 01/.test(fiche) && /Salle non rattachée UI/.test(fiche), fiche.slice(0, 200));
    await revenirAuTableau(page);
  }

  const morts = resultats.filter(item => item.classe.startsWith('⛔'));
  verifier(`Aucun contrôle mort ni repli silencieux (${morts.length})`, morts.length === 0,
    morts.map(item => `« ${item.libelle} » ${item.classe}`).join(' | '));

  return { morts };
}

/* ─── Chat, tâches, aide : ce qui est local doit se dire local ─── */

async function honneteteLocale(page, dialogues) {
  console.log('\n━━━ Ce qui est local doit se dire local ━━━');
  await revenirAuTableau(page);

  const chat = await page.evaluate(async () => {
    document.getElementById('btn-chat')?.click();
    await new Promise(resolve => setTimeout(resolve, 900));
    const fenetre = document.querySelector('#chat-modal-smart, #tech-notes-modal');
    const texte = fenetre ? (fenetre.innerText || '').replace(/\s+/g, ' ').trim() : '';
    fenetre?.remove();
    return { presente: Boolean(fenetre), texte: texte.slice(0, 300) };
  });
  if (chat.presente) {
    verifier('P0-6 · la surface locale ne se présente pas comme un canal d’équipe',
      !/Équipe Technique|Support Chat/i.test(chat.texte), chat.texte.slice(0, 140));
    verifier('P0-6 · elle dit explicitement qu’elle reste sur cet appareil',
      /cet appareil/i.test(chat.texte), chat.texte.slice(0, 140));
  } else {
    verifier('P0-6 · surface locale masquée : rien ne promet un canal d’équipe', true);
  }

  const taches = await page.evaluate(() => {
    const carte = document.querySelector('.card-tasks');
    return (carte?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260);
  });
  verifier('P0-7 · les tâches annoncent leur caractère local', /cet appareil/i.test(taches), taches.slice(0, 140));
  verifier('P0-7 · elles ne se présentent pas comme un planning partagé',
    !/planning|partagé|équipe/i.test(taches), taches.slice(0, 140));

  const avant = dialogues.length;
  await page.evaluate(() => document.getElementById('btn-help')?.click());
  await page.waitForTimeout(2500);
  const aide = dialogues.slice(avant).join(' ') || await page.evaluate(() => {
    /* Le message d'aide n'est plus un message natif : app-dialog.js remplace window.alert
       et le rend dans une fenêtre de la plateforme. On lit donc ce que la page montre EN
       PLUS de l'application — la même mesure que pour tous les autres contrôles. */
    const app = document.getElementById('app')?.innerText || '';
    const texte = document.body.innerText.replace(app, '').replace(/\s+/g, ' ').trim();
    for (const node of document.querySelectorAll('.app-dialog-backdrop, #tech-help-modal')) node.remove();
    return texte;
  });
  console.log(`     ↳ aide : « ${aide.replace(/\s+/g, ' ').slice(0, 200)} »`);
  verifier('P0-8 · le centre d’aide ne promet ni scanner QR ni réalité augmentée',
    !/QR|Réalité Augmentée|realite augmentee/i.test(aide), aide.replace(/\s+/g, ' ').slice(0, 160));
  verifier('P0-8 · le centre d’aide dit quelque chose', aide.trim().length > 20);
}

/* ─── L'astuce du jour, et le module qui dort ─── */

/**
 * TOUTES les astuces, pas une au hasard.
 *
 * La carte « Astuce du Jour » tire son texte au sort à chaque rendu. Regarder l'écran une
 * fois ne prouve donc rien : le Centre d'aide avait été corrigé, mais deux astuces
 * continuaient de promettre « Scannez le QR code d'un équipement… » et « Utilisez la
 * fonctionnalité de réalité augmentée… » — deux gestes qui n'existent nulle part dans ce
 * parcours. Il suffisait d'un rafraîchissement pendant la démonstration pour que la
 * promesse revienne.
 *
 * On force donc le tirage à parcourir tout l'intervalle et on relève CHAQUE valeur
 * atteignable, plutôt que d'espérer tomber sur la mauvaise.
 */
async function toutesLesAstuces(page) {
  console.log('\n━━━ L’astuce du jour — toutes les valeurs atteignables ━━━');
  await revenirAuTableau(page);
  const astuces = await page.evaluate(async () => {
    const hasardOriginal = Math.random;
    const vues = new Set();
    try {
      for (let pas = 0; pas < 60; pas += 1) {
        // Un tirage FORCÉ, balayant tout l'intervalle : la liste peut compter jusqu'à
        // soixante entrées sans qu'aucune n'échappe à la mesure.
        Math.random = () => pas / 60;
        document.getElementById('btn-refresh-tip')?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        const texte = document.querySelector('.tech-tip-card .tip-content p')?.innerText.trim();
        if (texte) vues.add(texte);
      }
    } finally { Math.random = hasardOriginal; }
    return [...vues];
  });

  console.log(`   ${astuces.length} astuces atteignables :`);
  for (const astuce of astuces) console.log(`     · ${astuce}`);

  verifier('l’astuce du jour a bien été énumérée', astuces.length > 0);
  const promesseQR = astuces.filter(texte => /QR/i.test(texte));
  verifier('aucune astuce ne promet un scanner QR inaccessible', promesseQR.length === 0, promesseQR.join(' | '));
  const promesseAR = astuces.filter(texte => /réalité augmentée|realite augmentee|\bAR\b/i.test(texte));
  verifier('aucune astuce ne promet la réalité augmentée', promesseAR.length === 0, promesseAR.join(' | '));
  await revenirAuTableau(page);
  return astuces;
}

/**
 * LE MUR D'IMAGES DOIT RESTER À L'ÉCRAN.
 *
 * Mesuré : le clic sur « Mur d'images » peint bien la vue, puis elle disparaît au bout
 * d'environ deux cents millisecondes et le tableau de bord revient. La chaîne est
 * établie — `showWall()` appelle `WallManager.afterRender()`, qui appelle
 * `db.setCurrentRoomId()`, qui émet `dataUpdated`, que la coque technicien écoute pour
 * recharger ses données et REPEINDRE le tableau de bord par-dessus le mur.
 *
 * Une apparition de deux cents millisecondes n'est pas une fonctionnalité : c'est un
 * clignotement. L'épreuve échantillonne donc pendant trois secondes — bien après la
 * fenêtre de course — et ne conclut qu'à la fin.
 */
async function murDurable(page) {
  console.log('\n━━━ Le mur d’images doit rester affiché ━━━');
  await revenirAuTableau(page);
  await page.click('#btn-wall', { timeout: 8000 }).catch(() => {});

  const chronologie = [];
  for (let pas = 0; pas < 15; pas += 1) {
    await page.waitForTimeout(200);
    chronologie.push(await page.evaluate(() => ({
      t: pas => pas,
      mur: Boolean(document.querySelector('#app .wall-page')),
      tableau: Boolean(document.querySelector('#app .smart-tech-board'))
    })).then(etat => ({ ...etat, ms: (pas + 1) * 200 })));
  }
  const recit = [];
  let precedent = '';
  for (const point of chronologie) {
    const empreinte = `${point.mur ? 'MUR' : ''}${point.tableau ? 'TABLEAU' : ''}` || 'AUTRE';
    if (empreinte !== precedent) { recit.push(`t+${point.ms}ms ${empreinte}`); precedent = empreinte; }
  }
  console.log(`   ${recit.join('  →  ')}`);

  const apparu = chronologie.some(point => point.mur);
  const dernier = chronologie[chronologie.length - 1];
  verifier('le mur d’images s’affiche au clic', apparu);
  verifier('le mur d’images est TOUJOURS là après trois secondes',
    Boolean(dernier?.mur), `dernier état : ${dernier?.mur ? 'mur' : (dernier?.tableau ? 'tableau de bord' : 'autre')}`);
  verifier('le tableau de bord n’a pas repris la main pendant ce temps',
    !chronologie.some(point => point.tableau && point.ms > 400),
    recit.join(' → '));

  // Le retour, lui, doit ramener le tableau de bord — exactement une fois.
  const retourPresent = await page.locator('#wall-back').count() > 0;
  if (retourPresent) {
    await page.click('#wall-back', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const apresRetour = await page.evaluate(() => ({
      mur: Boolean(document.querySelector('#app .wall-page')),
      tableau: Boolean(document.querySelector('#app .smart-tech-board'))
    }));
    verifier('le retour depuis le mur ramène le tableau de bord', apresRetour.tableau && !apresRetour.mur, JSON.stringify(apresRetour));
    // Et le tableau de bord doit continuer de se rafraîchir normalement.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('platform-data-updated')));
    await page.waitForTimeout(1200);
    verifier('le tableau de bord continue de vivre après le retour',
      await page.evaluate(() => Boolean(document.querySelector('#app .smart-tech-board'))));
  }
  await revenirAuTableau(page);
}

/**
 * LES TÂCHES LOCALES DOIVENT SE VOIR TOUT DE SUITE.
 *
 * Mesuré : la saisie est bien écrite dans le stockage local, mais la liste continue
 * d'afficher « Aucune tâche aujourd'hui » jusqu'au rechargement de la page. La cause est
 * dans l'ordre des opérations — l'écriture touche le stockage, puis `render()` redessine
 * à partir de `this.state.todayTasks`, qui date du dernier `loadData()`.
 *
 * L'épreuve écrit, coche, décoche et recharge : à chaque étape, ce que la personne VOIT
 * doit correspondre à ce qui est enregistré.
 */
async function tachesImmediates(page) {
  console.log('\n━━━ Les tâches locales se voient sans recharger ━━━');
  await revenirAuTableau(page);
  await page.evaluate(() => localStorage.removeItem('maintenance-tasks'));
  await page.evaluate(() => { window.location.hash = '#/devices'; });
  await page.waitForTimeout(1200);
  await revenirAuTableau(page);

  const libelle = `Tâche épreuve ${Date.now() % 100000}`;
  await page.fill('#new-task', libelle);
  await page.click('#add-task-form button[type="submit"], #add-task-form button', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const apresAjout = await page.evaluate(intitule => ({
    dansLeDom: (document.getElementById('daily-tasks-list')?.innerText || '').includes(intitule),
    videAffiche: /Aucune tâche/i.test(document.getElementById('daily-tasks-list')?.innerText || ''),
    dansLeStockage: (localStorage.getItem('maintenance-tasks') || '').includes(intitule),
    compteur: document.querySelector('.tech-stat-card[data-action="show-tasks"] .stat-value')?.innerText.trim()
  }), libelle);
  console.log(`   après ajout : ${JSON.stringify(apresAjout)}`);
  verifier('la tâche est enregistrée localement', apresAjout.dansLeStockage);
  verifier('la tâche apparaît à l’écran SANS recharger', apresAjout.dansLeDom && !apresAjout.videAffiche, JSON.stringify(apresAjout));
  verifier('le compteur « Tâches » suit immédiatement', apresAjout.compteur === '1', `compteur = ${apresAjout.compteur}`);

  await page.click('#daily-tasks-list input[type="checkbox"]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const apresCoche = await page.evaluate(() => ({
    coche: Boolean(document.querySelector('#daily-tasks-list input[type="checkbox"]')?.checked),
    barre: /line-through/.test(document.getElementById('daily-tasks-list')?.innerHTML || ''),
    stockage: /"done":true/.test(localStorage.getItem('maintenance-tasks') || ''),
    compteur: document.querySelector('.tech-stat-card[data-action="show-tasks"] .stat-value')?.innerText.trim()
  }));
  console.log(`   après coche : ${JSON.stringify(apresCoche)}`);
  verifier('cocher la tâche se voit immédiatement', apresCoche.coche && apresCoche.barre, JSON.stringify(apresCoche));
  verifier('cocher la tâche est enregistré', apresCoche.stockage);
  verifier('le compteur des tâches non terminées retombe à zéro', apresCoche.compteur === '0', `compteur = ${apresCoche.compteur}`);

  await page.click('#daily-tasks-list input[type="checkbox"]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const apresDecoche = await page.evaluate(() => ({
    coche: Boolean(document.querySelector('#daily-tasks-list input[type="checkbox"]')?.checked),
    stockage: /"done":false/.test(localStorage.getItem('maintenance-tasks') || ''),
    compteur: document.querySelector('.tech-stat-card[data-action="show-tasks"] .stat-value')?.innerText.trim()
  }));
  verifier('décocher revient immédiatement en arrière', !apresDecoche.coche && apresDecoche.stockage, JSON.stringify(apresDecoche));
  verifier('le compteur remonte à un', apresDecoche.compteur === '1', `compteur = ${apresDecoche.compteur}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.smart-tech-board', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const apresRechargement = await page.evaluate(intitule =>
    (document.getElementById('daily-tasks-list')?.innerText || '').includes(intitule), libelle);
  verifier('la tâche survit au rechargement', apresRechargement);
  await revenirAuTableau(page);
}

/**
 * LE MODULE DORMANT NE DOIT PAS SE RÉVEILLER.
 *
 * `techui.js` importait `ar-support.js` sans jamais s'en servir : la seule ligne qui s'en
 * servait était commentée. Or un import n'est pas inerte — le module s'exécute, et il se
 * termine par `new ARSupport()`, dont le constructeur interroge WebXR au chargement de la
 * coque technicien, pour une capacité qu'aucun geste de ce parcours n'expose.
 *
 * Cette phase a SON PROPRE contexte, avec le service worker coupé : celui-ci pré-charge
 * `ar-support.js` de son côté, et sans la coupure on ne saurait pas si le fichier est
 * demandé parce que la coque l'importe ou parce que le cache le collecte. La coupure vaut
 * pour cette mesure seule — le reste de l'audit se déroule dans les conditions réelles.
 *
 * Le module n'est pas supprimé : il reste en place pour un lot qui lui sera consacré.
 */
async function moduleDormant(navigateur) {
  console.log('\n━━━ Le module de réalité augmentée doit rester dormant ━━━');
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const page = await contexte.newPage();
  const modules = [];
  const console_ = [];
  page.on('request', requete => { if (/\.js(\?|$)/.test(requete.url())) modules.push(requete.url()); });
  page.on('console', message => console_.push(message.text()));
  await connecter(page, 'technique');
  await page.waitForTimeout(2500);

  const charges = modules.filter(url => /ar-support\.js/.test(url));
  verifier('la coque technicien ne charge plus le module de réalité augmentée',
    charges.length === 0, charges.join(' | '));
  const arabes = console_.filter(texte => /[؀-ۿ]/.test(texte));
  verifier('aucun message de console en arabe pendant le chargement technicien',
    arabes.length === 0, arabes.slice(0, 2).join(' | '));
  console.log(`   ↳ ${modules.length} modules chargés, dont ar-support.js : ${charges.length}`);
  await contexte.close();
}

/* ─── Les routes interdites restent interdites ─── */

async function routesInterdites(page) {
  console.log('\n━━━ Les routes interdites restent interdites ━━━');
  for (const route of ['logs', 'settings', 'users', 'reports', 'zoneAccess', 'integrity']) {
    await page.evaluate(cible => { window.location.hash = `#/${cible}`; }, route);
    await page.waitForTimeout(1500);
    const etat = await page.evaluate(eval(ETAT));
    verifier(`« #/${route} » ne rend aucune section interdite`,
      !etat.vueRoute || !new RegExp(route, 'i').test(etat.titreRoute),
      `rendu « ${etat.titreRoute || (etat.tableau ? 'tableau de bord' : 'autre')} »`);
  }
  await revenirAuTableau(page);
}

/* ────────────────────────────── Exécution ────────────────────────────── */

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

console.log(`\n╔═══ TECHUI-01 · tous les contrôles du technicien, cliqués — ${BASE} ═══╗`);

let resultatsGlobaux = [];
try {
  const { page, contexte, resultats, erreurs, dialogues } = await auditer(navigateur);
  resultatsGlobaux = resultats;
  await exigences(page, resultats, dialogues);
  await honneteteLocale(page, dialogues);
  await toutesLesAstuces(page);
  await murDurable(page);
  await tachesImmediates(page);
  await routesInterdites(page);
  await moduleDormant(navigateur);



  const critiques = erreurs.filter(texte => !/Failed to load resource|favicon|manifest|Chart/i.test(texte));
  verifier(`Console sans erreur critique (${critiques.length})`, critiques.length === 0, critiques.slice(0, 3).join(' | '));
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/tableau-final.png` });
  await contexte.close();

  console.log('\n┌─── matrice contrôle / résultat ───┐');
  for (const item of resultatsGlobaux) {
    console.log(`  ${item.classe.startsWith('⛔') ? '❌' : '✅'} ${item.classe.padEnd(20)} « ${item.libelle} »`);
  }
} finally {
  await navigateur.close();
}

console.log(`\n╚═══ ${echecs === 0 ? '✅ VERT' : `❌ ${echecs} ÉCHEC(S)`} sur ${verifications} vérifications ═══╝\n`);
process.exit(echecs ? 1 : 0);
