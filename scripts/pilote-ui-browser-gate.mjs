/**
 * @file scripts/pilote-ui-browser-gate.mjs — PILOTE-UI-01 dans un vrai navigateur.
 *
 * CE QUE CETTE ÉPREUVE MESURE, ET POURQUOI ELLE NE PEUT PAS ÊTRE UN TEST DE SOURCE
 * --------------------------------------------------------------------------------
 * Les tests de `tests/pilote-*.test.js` lisent la feuille et le module : ils prouvent que la
 * règle est ÉCRITE et correctement portée. Ils ne peuvent pas prouver qu'elle S'APPLIQUE.
 * Or les trois défauts que ce lot corrige sont précisément des défauts d'application :
 *
 *   · une fenêtre d'édition BLANCHE dans une coque sombre — c'est une couleur calculée,
 *     après cascade, sur un élément réellement ouvert ;
 *   · un formulaire de création qui repousse l'inventaire hors de la vue — c'est une
 *     position, à une résolution donnée ;
 *   · une classe de prévisualisation effacée par `applyRoleTheme()` quelques centaines de
 *     millisecondes après le rendu — c'est une course, et elle ne se lit nulle part.
 *
 * L'épreuve parcourt donc les SIX rôles contre le serveur réel et la base PostgreSQL réelle,
 * en prévisualisation puis en classique, et rapporte une matrice.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-decor.mjs
 *   node scripts/pilote-ui-browser-gate.mjs
 *
 * Variables : E2E_BASE_URL, PLAYWRIGHT_MODULE, PILOTE_CAPTURES (dossier des captures).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { BASE, COMPTES, motDePasseDe } from './ui-polish-decor.mjs';

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CAPTURES = process.env.PILOTE_CAPTURES || '';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch {
  console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ». Renseignez PLAYWRIGHT_MODULE.`);
  process.exit(2);
}
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

/** Bureau d'abord : la cible du produit, puis portable et tablette. */
const RESOLUTIONS = Object.freeze([
  { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }
]);

const ROLES = Object.freeze(['admin', 'manager', 'chef', 'responsable', 'technique', 'visiteur']);

/**
 * La coque réellement posée par chaque rôle — QUATRE formes distinctes, pas une.
 *
 * Mesuré : `AdminUI` (Administrateur/Manager/Chef) pose `#admin-content`, `ResponsibleUI`
 * `#responsible-content`, `TechUI` `.smart-tech-board` et `VisitorUI` `.visitor-page`.
 * Un sélecteur inventé pour le Technicien (`.smart-tech-content`, `.tech-content`) ne
 * correspondait à RIEN et l'épreuve expirait au lieu de mesurer.
 */
const COQUES = '#admin-content, #responsible-content, .smart-tech-board, .visitor-page';

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
async function connecter(page, cle, { pilote = true } = {}) {
  const compte = COMPTES[cle];
  // `pilote: 'defaut'` — aucun paramètre du tout : mesure la précédence réelle (préférence
  // mémorisée sinon nouveau défaut Pilote), jamais un choix explicite forcé par l'URL.
  const suffixe = pilote === 'defaut' ? '' : `?pilote=${pilote ? 1 : 0}`;
  await page.goto(`${BASE}/${suffixe}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 40000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 40000 });
  for (let essai = 0; essai < 40; essai += 1) {
    try { if (await page.evaluate(() => localStorage.getItem('auth'))) break; }
    catch { /* navigation en cours */ }
    await page.waitForTimeout(250);
  }
  await page.waitForSelector(COQUES, { timeout: 40000 });
  // `applyRoleTheme()` réécrit `body.className` APRÈS le rendu : la course se joue ici.
  await page.waitForTimeout(1500);
}

const debordementHorizontal = page => page.evaluate(() => ({
  document: document.documentElement.scrollWidth,
  fenetre: window.innerWidth,
  coupable: [...document.querySelectorAll('body *')]
    .filter(node => node.getBoundingClientRect().right > window.innerWidth + 2)
    .slice(0, 3).map(node => `${node.tagName}.${String(node.className || '').split(' ')[0]}`)
}));

/**
 * Luminance perçue (0..255) du fond RÉELLEMENT calculé d'un élément.
 *
 * Un fond transparent ne dit rien de ce que l'œil voit : on remonte alors aux ancêtres
 * jusqu'à la première surface réellement peinte, exactement comme le rendu le fait.
 */
const LUMINANCE_DANS_LA_PAGE = `(node) => {
  for (let el = node; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g);
    if (!c) continue;
    if (c.length > 3 && Number(c[3]) === 0) continue;
    return 0.2126 * Number(c[0]) + 0.7152 * Number(c[1]) + 0.0722 * Number(c[2]);
  }
  return null;
}`;

/* ────────────────── 1 · La prévisualisation tient, et se quitte ────────────────── */

async function epreuveCoque(navigateur, cle, resolution) {
  const contexte = await navigateur.newContext({ viewport: resolution });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message)));
  await connecter(page, cle, { pilote: true });
  const etiquette = `${cle} · ${resolution.width}×${resolution.height}`;

  /*
   * `Auth.applyRoleTheme()` REMPLACE `document.body.className` en entier à chaque
   * vérification de session. Sans le garde d'attribut de `pilot-technique-preview.js`, la
   * classe posée au chargement disparaissait quelques centaines de millisecondes plus tard
   * et TOUT l'habillage retombait en classique — sans la moindre erreur pour le signaler.
   */
  const drapeau = await page.evaluate(() => ({
    corps: document.body.classList.contains('pilot-technique-ui'),
    racine: document.documentElement.classList.contains('pilot-technique-ui'),
    classes: document.body.className
  }));
  verifier(`${etiquette} · la classe Pilote survit à applyRoleTheme()`,
    drapeau.corps && drapeau.racine, `body.className = « ${drapeau.classes} »`);

  // La sortie DOIT être visible : sans elle, le rôle entre en prévisualisation sans
  // aucun moyen d'en sortir autrement qu'en modifiant l'URL à la main.
  const sortie = await page.$('.pilot-preview-exit');
  verifier(`${etiquette} · le bouton « Interface classique » est présent`, Boolean(sortie));

  const badge = await page.$('.pilot-technique-badge');
  verifier(`${etiquette} · le repère « Pilote Technique » est présent`,
    Boolean(badge) || resolution.width <= 760);

  const debordement = await debordementHorizontal(page);
  verifier(`${etiquette} · aucun débordement horizontal`,
    debordement.document <= debordement.fenetre + 2,
    `${debordement.document} > ${debordement.fenetre} — ${debordement.coupable.join(', ')}`);

  verifier(`${etiquette} · aucune erreur JavaScript en prévisualisation`,
    erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  if (CAPTURES) {
    await page.screenshot({ path: `${CAPTURES}/${cle}-${resolution.width}-accueil.png` });
  }
  await contexte.close();
}

/* ────────── 2 · Toutes les sections du rôle : rien ne casse, rien ne déborde ────────── */

/**
 * TOUS LES RÔLES NE NAVIGUENT PAS PAR UN MENU DE SECTIONS.
 *
 * Mesuré : `AdminUI` et `ResponsibleUI` posent `.sidebar-menu a[data-section]`. `TechUI` et
 * `VisitorUI` n'en posent AUCUN — le technicien travaille sur un tableau unique
 * (`.smart-tech-board`) dont les commandes sont des boutons nommés, et le visiteur sur une
 * page de consultation avec deux boutons. Chercher `data-section` chez eux ne renvoyait pas
 * « rien à vérifier » : cela renvoyait « 0 section », c'est-à-dire une épreuve qui passe
 * en n'ayant rien mesuré. Ces deux rôles sont donc parcourus par leurs commandes RÉELLES.
 */
const COMMANDES_SANS_MENU = Object.freeze({
  technique: ['#btn-show-screens', '#btn-wall', '#btn-quick-ticket', '#btn-help', '#btn-chat'],
  visiteur: ['#visitor-wall-btn', '#visitor-requests-btn']
});

async function epreuveNavigation(navigateur, cle) {
  const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message)));
  await connecter(page, cle, { pilote: true });

  const sections = await page.$$eval('.sidebar-menu a[data-section]', liens => liens.map(l => l.dataset.section));
  if (!sections.length && COMMANDES_SANS_MENU[cle]) {
    await epreuveCommandes(page, cle, erreurs);
    await contexte.close();
    return [];
  }
  console.log(`     ↳ ${cle} : ${sections.length} sections au menu — ${sections.join(', ') || '(aucune)'}`);
  verifier(`${cle} · le menu expose au moins une section`, sections.length > 0);

  for (const section of sections) {
    const avant = erreurs.length;
    await page.click(`.sidebar-menu a[data-section="${section}"]`).catch(() => {});
    await page.waitForTimeout(850);

    const mesure = await page.evaluate(sel => {
      window.scrollTo(0, 0);
      const contenu = document.querySelector(sel);
      if (!contenu) return null;
      return {
        top: Math.round(contenu.getBoundingClientRect().top),
        texte: (contenu.innerText || '').trim().length,
        pilote: document.body.classList.contains('pilot-technique-ui')
      };
    }, COQUES);

    verifier(`${cle} · « ${section} » — la page rend du contenu, en prévisualisation`,
      Boolean(mesure) && mesure.texte > 0 && mesure.pilote,
      mesure ? `texte=${mesure.texte} pilote=${mesure.pilote}` : 'coque introuvable');

    const debordement = await debordementHorizontal(page);
    verifier(`${cle} · « ${section} » — aucun débordement horizontal`,
      debordement.document <= debordement.fenetre + 2,
      `${debordement.document} > ${debordement.fenetre} — ${debordement.coupable.join(', ')}`);

    verifier(`${cle} · « ${section} » — aucune erreur JavaScript`,
      erreurs.length === avant, erreurs.slice(avant, avant + 2).join(' | '));

    // Surfaces et contraste, sur la page que l'on vient d'ouvrir.
    await sonderLisibilite(page, cle, section);
  }
  await contexte.close();
  return sections;
}

/**
 * Les rôles à tableau unique : chaque commande s'ouvre, s'habille et se referme.
 *
 * Un bouton qui ouvre une vue restée en clair est exactement l'îlot que ce lot corrige ;
 * un bouton qui ne fait rien est un contrôle mort. Les deux se mesurent ici.
 */
async function epreuveCommandes(page, cle, erreurs) {
  const commandes = COMMANDES_SANS_MENU[cle];
  console.log(`     ↳ ${cle} : pas de menu de sections — ${commandes.length} commandes réelles parcourues`);

  for (const selecteur of commandes) {
    /*
     * ON REVIENT AU TABLEAU AVANT CHAQUE COMMANDE.
     *
     * `showWall()` et `showRequests()` REMPLACENT `#app` en entier. Sans ce retour, les
     * commandes suivantes n'existaient plus dans le document et l'épreuve les déclarait
     * « absentes, donc non autorisées » — une conclusion FAUSSE : `#visitor-requests-btn`
     * est rendu sans condition par `visitor-ui.js`. L'épreuve inventait une projection de
     * permissions à partir de sa propre navigation.
     */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(COQUES, { timeout: 40000 });
    await page.waitForTimeout(1200);

    const bouton = await page.$(selecteur);
    if (!bouton) {
      // Absent SUR LE TABLEAU FRAÎCHEMENT RENDU : cette fois l'absence dit bien quelque
      // chose du rôle, et non de l'ordre des clics de l'épreuve.
      console.log(`     · ${selecteur} — absent du tableau de ce rôle`);
      continue;
    }
    const avant = erreurs.length;
    const avantDOM = await page.evaluate(() => document.body.innerHTML.length);
    await bouton.click().catch(() => {});
    await page.waitForTimeout(900);

    const etat = await page.evaluate(() => ({
      pilote: document.body.classList.contains('pilot-technique-ui'),
      taille: document.body.innerHTML.length
    }));

    // Un contrôle qui n'a RIEN changé au document n'a rien ouvert.
    verifier(`${cle} · « ${selecteur} » — la commande produit un effet visible`,
      etat.taille !== avantDOM);
    verifier(`${cle} · « ${selecteur} » — la prévisualisation tient après ouverture`, etat.pilote);
    verifier(`${cle} · « ${selecteur} » — aucune erreur JavaScript`,
      erreurs.length === avant, erreurs.slice(avant, avant + 2).join(' | '));

    const debordement = await debordementHorizontal(page);
    verifier(`${cle} · « ${selecteur} » — aucun débordement horizontal`,
      debordement.document <= debordement.fenetre + 2,
      `${debordement.document} > ${debordement.fenetre} — ${debordement.coupable.join(', ')}`);

    if (CAPTURES) {
      await page.screenshot({ path: `${CAPTURES}/${cle}-${selecteur.replace(/[#.]/g, '')}.png` });
    }
    // On referme pour que la commande suivante parte d'un écran propre.
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      for (const m of document.querySelectorAll('.modal, .ops-modal')) m.remove();
    });
    await page.waitForTimeout(250);
  }
}

/* ──────── 2 bis · AUCUNE SURFACE CLAIRE, AUCUN TEXTE SOUS LE SEUIL ──────── */

/**
 * L'ÉPREUVE QUI A TROUVÉ CE QUE LA LECTURE DE FEUILLE NE POUVAIT PAS TROUVER.
 *
 * Relevé initial, `?pilote=1`, compte administrateur : la coque était sombre et les VINGT
 * pages restaient blanches. La feuille Pilote était pourtant juste — elle perdait la
 * cascade, `ui-sections.css` écrivant ses fonds avec des sélecteurs à identifiants
 * (`:is(#admin-content,…) > .card:has(#salle-search)`) en `!important`. Aucune relecture de
 * source ne pouvait le dire : il fallait mesurer la couleur CALCULÉE.
 *
 * Deux mesures, donc, sur chaque section réellement au menu :
 *   · la luminance des surfaces — une surface claire dans une coque sombre est un îlot ;
 *   · le rapport de contraste WCAG de chaque texte contre le fond réellement peint — car
 *     assombrir un fond sans reprendre la couleur du texte rend le texte illisible, et
 *     éclaircir un texte sans reprendre son fond le rend PIRE (mesuré : « Actif » est
 *     tombé de 4.12 à 1.03 avant correction).
 */
const SONDE_SURFACES = () => {
  const lum = s => {
    const c = s.match(/[\d.]+/g);
    if (!c) return null;
    if (c.length > 3 && Number(c[3]) < 0.5) return null;
    return 0.2126 * Number(c[0]) + 0.7152 * Number(c[1]) + 0.0722 * Number(c[2]);
  };
  const vus = new Map();
  for (const el of document.querySelectorAll('#admin-content *, #responsible-content *, body > .ops-modal *, body > #ops-center-modal *, body > #ops-search-modal *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 16) continue;
    const L = lum(getComputedStyle(el).backgroundColor);
    if (L === null || L < 140) continue;
    // Une <img> porte un fond de remplacement sous une image réelle : ce n'est pas une
    // surface d'interface, et la repeindre altérerait un contenu.
    if (el.tagName === 'IMG') continue;
    const cle = `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')}`;
    if (!vus.has(cle)) vus.set(cle, { cle, L: Math.round(L) });
  }
  return [...vus.values()].slice(0, 5);
};

const SONDE_CONTRASTE = () => {
  const rgb = s => { const m = s.match(/[\d.]+/g); return m ? { r:+m[0], g:+m[1], b:+m[2], a:m.length>3?+m[3]:1 } : null; };
  const relL = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const fondDe = el => {
    for (let n = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.5) return c;
    }
    return { r: 6, g: 19, b: 33, a: 1 };
  };
  const rapport = (a, b) => {
    const l1 = relL(a), l2 = relL(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const vus = new Map();
  for (const el of document.querySelectorAll('#admin-content *, #responsible-content *, body > .ops-modal *, body > #ops-center-modal *, body > #ops-search-modal *')) {
    const texte = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!texte) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.opacity === '0') continue;
    const fg = rgb(s.color);
    if (!fg) continue;
    const px = parseFloat(s.fontSize);
    const gras = (parseInt(s.fontWeight) || 400) >= 700;
    // Seuils WCAG AA : 3:1 pour le grand texte, 4.5:1 pour le reste.
    const seuil = (px >= 24 || (px >= 18.66 && gras)) ? 3 : 4.5;
    const cr = rapport(fg, fondDe(el));
    if (cr >= seuil) continue;
    const cle = `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`;
    if (!vus.has(cle)) vus.set(cle, { cle, cr: Math.round(cr * 100) / 100, seuil, txt: texte.slice(0, 24) });
  }
  return [...vus.values()].sort((a, b) => a.cr - b.cr).slice(0, 5);
};

/**
 * Les deux sondes s'exécutent sur la page DÉJÀ ouverte par le parcours des sections.
 *
 * Elles avaient d'abord leur propre contexte et leur propre connexion : cela portait le
 * parcours à cinq connexions par rôle, trente en tout, et l'une d'elles a fini par expirer
 * — un échec de l'épreuve, pas du produit. Mesurer là où l'on vient déjà de naviguer coûte
 * une connexion au lieu de deux et supprime la cause.
 */
async function sonderLisibilite(page, cle, section) {
  const clairs = await page.evaluate(SONDE_SURFACES);
  verifier(`${cle} · « ${section} » — aucune surface claire dans la coque sombre`,
    clairs.length === 0, clairs.map(c => `${c.cle}(L=${c.L})`).join(', '));

  const illisibles = await page.evaluate(SONDE_CONTRASTE);
  verifier(`${cle} · « ${section} » — tout texte au-dessus du seuil de contraste`,
    illisibles.length === 0,
    illisibles.map(t => `${t.cle} ${t.cr}<${t.seuil} « ${t.txt} »`).join(' | '));
}

/* ──────── 3 · Plus d'îlot blanc : la fenêtre d'édition est une surface du produit ──────── */

/**
 * LE DÉFAUT LE PLUS VISIBLE DU LOT PRÉCÉDENT.
 *
 * Sept pages éditent par `.modal` > `.modal-content`. Ces fenêtres n'étaient pas habillées :
 * elles s'ouvraient BLANCHES au milieu de la coque sombre. Une lecture de feuille ne le
 * démontre pas — il faut ouvrir la fenêtre et LIRE la couleur calculée après cascade.
 */
async function epreuveFenetreEdition(navigateur, cle) {
  const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
  const page = await contexte.newPage();
  await connecter(page, cle, { pilote: true });

  // On ouvre la première fenêtre d'édition réellement atteignable pour ce rôle.
  for (const section of ['salles', 'baies', 'devices']) {
    const lien = await page.$(`.sidebar-menu a[data-section="${section}"]`);
    if (!lien) continue;
    await lien.click();
    await page.waitForTimeout(900);

    const bouton = await page.$('button[data-action="edit"], #open-add-eq');
    if (!bouton) continue;
    await bouton.click();
    await page.waitForTimeout(700);

    const mesure = await page.evaluate(source => {
      const luminance = new Function(`return ${source}`)();
      const fenetre = document.querySelector('.modal .modal-content, .modal-content');
      if (!fenetre) return null;
      const champ = fenetre.querySelector('input:not([type=file]):not([type=checkbox]), select, textarea');
      const etiquette = fenetre.querySelector('label');
      return {
        fond: luminance(fenetre),
        champ: champ ? luminance(champ) : null,
        etiquette: etiquette ? getComputedStyle(etiquette).color : null
      };
    }, LUMINANCE_DANS_LA_PAGE);

    if (!mesure) continue;
    // Une surface « claire » (luminance > 140) dans une coque sombre EST l'îlot blanc.
    verifier(`${cle} · « ${section} » — la fenêtre d'édition n'est pas un îlot clair`,
      mesure.fond !== null && mesure.fond < 140, `luminance du fond = ${Math.round(mesure.fond ?? -1)}`);
    if (mesure.champ !== null) {
      verifier(`${cle} · « ${section} » — les champs de saisie sont sombres eux aussi`,
        mesure.champ < 140, `luminance du champ = ${Math.round(mesure.champ)}`);
    }
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${cle}-fenetre-${section}.png` });
    await contexte.close();
    return;
  }
  console.log(`     ↳ ${cle} : aucune fenêtre d'édition atteignable (rôle sans droit d'écriture) — rien à mesurer`);
  await contexte.close();
}

/*
 * LA FICHE 360 RÉELLE : UN PANNEAU AJOUTÉ À `document.body`, DONC HORS DE `#admin-content`.
 *
 * MESURÉ EN COURS DE LOT : le panneau accosté (`#ops-equipment-360`) ouvrait bien à droite,
 * table toujours cliquable derrière — mais SES CHAMPS ÉTAIENT INVISIBLES. `.ops-fact` porte
 * un fond quasi blanc (`#f8fbfd`, `operations-suite.css`) sur lequel la feuille Pilote ne
 * posait que la couleur du texte, jamais le fond : texte `rgb(236,246,255)` sur fond
 * `rgb(248,251,253)`, l'un et l'autre quasi blancs. La cause : `operations-suite.js` fait
 * `document.body.appendChild(modal)` — ce panneau n'est PAS un descendant de
 * `#admin-content`, et aucune des reprises scopées à ce conteneur ne pouvait donc jamais
 * l'atteindre. Les sondes de surface/contraste ci-dessus ne le voyaient pas non plus,
 * puisqu'elles ne interrogeaient QUE `#admin-content`/`#responsible-content`.
 *
 * Cette épreuve ouvre donc la fiche RÉELLEMENT, pour de vrai, et relit les deux sondes sur
 * le document entier — la correction ci-dessus élargit déjà leur sélecteur à
 * `body > .ops-modal *`, cette épreuve est ce qui les fait effectivement s'exécuter pendant
 * que le panneau existe.
 */
async function epreuveFiche360(navigateur, cle) {
  const contexte = await navigateur.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message)));
  await connecter(page, cle, { pilote: true });

  const lienSection = await page.$('.sidebar-menu a[data-section="devices"]');
  if (!lienSection) {
    console.log(`     ↳ ${cle} : pas d'accès à Équipements — Fiche 360 non atteignable pour ce rôle`);
    await contexte.close();
    return;
  }
  await lienSection.click();
  await page.waitForTimeout(1200);

  const lienEquipement = await page.$('#admin-content tbody tr a, #admin-content table tr td a');
  if (!lienEquipement) {
    console.log(`     ↳ ${cle} : aucun équipement dans le tableau — rien à ouvrir`);
    await contexte.close();
    return;
  }
  await lienEquipement.click();
  await page.waitForTimeout(1600);

  const ouverte = await page.$('#ops-equipment-360');
  verifier(`${cle} · Fiche 360 — s'ouvre depuis le tableau des équipements`, Boolean(ouverte));
  if (!ouverte) { await contexte.close(); return; }

  const mode = await page.evaluate(() => document.getElementById('ops-equipment-360')?.dataset?.panelMode);
  verifier(`${cle} · Fiche 360 — s'accoste en panneau latéral sur grand écran (1920 px)`,
    mode === 'side', `mode observé = ${mode}`);

  const clairs = await page.evaluate(SONDE_SURFACES);
  verifier(`${cle} · Fiche 360 — aucune surface claire dans le panneau`,
    clairs.length === 0, clairs.map(c => `${c.cle}(L=${c.L})`).join(', '));

  const illisibles = await page.evaluate(SONDE_CONTRASTE);
  verifier(`${cle} · Fiche 360 — tout texte du panneau au-dessus du seuil de contraste`,
    illisibles.length === 0,
    illisibles.map(t => `${t.cle} ${t.cr}<${t.seuil} « ${t.txt} »`).join(' | '));

  verifier(`${cle} · Fiche 360 — aucune erreur JavaScript à l'ouverture`,
    erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${cle}-fiche-360.png` });
  await contexte.close();
}

/* ──────── 4 · Le formulaire de création ne repousse plus l'inventaire hors de la vue ──────── */

async function epreuveCreationRepliee(navigateur, cle) {
  const contexte = await navigateur.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await contexte.newPage();
  await connecter(page, cle, { pilote: true });

  for (const section of ['salles', 'baies']) {
    const lien = await page.$(`.sidebar-menu a[data-section="${section}"]`);
    if (!lien) continue;
    await lien.click();
    await page.waitForTimeout(900);

    const mesure = await page.evaluate(() => {
      const formulaire = document.querySelector('#add-salle-form, #add-baie-form');
      const table = document.querySelector('.tableau');
      const repli = document.querySelector('details.pilot-create-panel');
      return {
        formulaire: Boolean(formulaire),
        replie: Boolean(repli) && !repli.open,
        formulaireDansRepli: Boolean(repli && formulaire && repli.contains(formulaire)),
        hautDeTable: table ? Math.round(table.getBoundingClientRect().top) : null,
        vue: window.innerHeight
      };
    });

    if (!mesure.formulaire) {
      // Rôle sans droit de création : la page ne produit pas de formulaire, donc pas de
      // dépliant non plus. C'est le résultat attendu, pas une absence de mesure — un
      // dépliant vide serait un contrôle mort laissant croire à un droit inexistant.
      verifier(`${cle} · « ${section} » — sans droit de création, aucun dépliant n'est fabriqué`,
        !mesure.formulaireDansRepli && !mesure.replie);
      continue;
    }

    verifier(`${cle} · « ${section} » — le formulaire de création est bien dans le repli`,
      mesure.formulaireDansRepli);
    verifier(`${cle} · « ${section} » — le repli est fermé à l'ouverture de la page`, mesure.replie);
    verifier(`${cle} · « ${section} » — l'inventaire commence dans la vue (haut=${mesure.hautDeTable}px)`,
      mesure.hautDeTable !== null && mesure.hautDeTable < mesure.vue,
      `haut=${mesure.hautDeTable} ≥ ${mesure.vue}`);

    // Le dépliant s'ouvre VRAIMENT : un contrôle qui ne fait rien serait un contrôle mort.
    await page.click('details.pilot-create-panel > summary').catch(() => {});
    await page.waitForTimeout(350);
    const ouvert = await page.evaluate(() => {
      const repli = document.querySelector('details.pilot-create-panel');
      const formulaire = document.querySelector('#add-salle-form, #add-baie-form');
      return Boolean(repli?.open) && Boolean(formulaire?.getBoundingClientRect().height);
    });
    verifier(`${cle} · « ${section} » — le dépliant s'ouvre et découvre le formulaire`, ouvert);
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${cle}-${section}-creation.png` });
  }
  await contexte.close();
}

/* ──────────── 5 · L'interface classique reste EXACTEMENT l'interface classique ──────────── */

async function epreuveRetourClassique(navigateur, cle) {
  const contexte = await navigateur.newContext({ viewport: RESOLUTIONS[0] });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message)));
  await connecter(page, cle, { pilote: false });

  const etat = await page.evaluate(() => ({
    pilote: document.body.classList.contains('pilot-technique-ui')
      || document.documentElement.classList.contains('pilot-technique-ui'),
    badge: Boolean(document.querySelector('.pilot-technique-badge')),
    sortie: Boolean(document.querySelector('.pilot-preview-exit')),
    repli: Boolean(document.querySelector('details.pilot-create-panel')),
    texte: (document.body.innerText || '').trim().length
  }));

  verifier(`${cle} · classique — aucune classe de prévisualisation`, !etat.pilote);
  verifier(`${cle} · classique — aucun repère ni bouton de prévisualisation`,
    !etat.badge && !etat.sortie);
  verifier(`${cle} · classique — aucun dépliant de création`, !etat.repli);
  verifier(`${cle} · classique — la page rend toujours du contenu`, etat.texte > 0);
  verifier(`${cle} · classique — aucune erreur JavaScript`, erreurs.length === 0,
    erreurs.slice(0, 2).join(' | '));

  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${cle}-classique.png` });
  await contexte.close();
}

/**
 * PRÉCÉDENCE RÉELLE DE `?pilote` — Final Meeting Candidate Gate, promotion Pilote en défaut.
 *
 * `?pilote=1` et `?pilote=0` sont déjà couverts intégralement ailleurs dans cette épreuve
 * (`pilote:true` est le défaut de `connecter`, exercé par toutes les autres sections ;
 * `epreuveRetourClassique` couvre `?pilote=0` pour les six rôles). La seule zone
 * RÉELLEMENT nouvelle est l'URL SANS paramètre du tout : elle doit désormais ouvrir Pilote
 * (nouveau défaut), jamais retomber sur Classique — sauf préférence explicitement mémorisée,
 * ce que cette épreuve ne pose jamais elle-même (chaque contexte Playwright est isolé, sans
 * stockage préexistant), donc « défaut » et « aucune préférence » sont ici la même mesure.
 */
async function epreuveUrlParDefaut(navigateur, cle) {
  const VIEWPORTS = [
    { nom: 'bureau', viewport: RESOLUTIONS[0] },
    { nom: 'mobile', viewport: { width: 390, height: 844 } }
  ];
  for (const { nom, viewport } of VIEWPORTS) {
    const contexte = await navigateur.newContext({ viewport });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await connecter(page, cle, { pilote: 'defaut' });

    const etat = await page.evaluate(() => ({
      pilote: document.body.classList.contains('pilot-technique-ui')
        || document.documentElement.classList.contains('pilot-technique-ui'),
      badge: Boolean(document.querySelector('.pilot-technique-badge')),
      debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));

    verifier(`${cle} · URL SANS paramètre (${nom}) — ouvre Pilote (nouveau défaut)`, etat.pilote);
    verifier(`${cle} · URL SANS paramètre (${nom}) — le repère Pilote est visible`, etat.badge);
    verifier(`${cle} · URL SANS paramètre (${nom}) — aucun débordement horizontal`, etat.debordement <= 1,
      `débordement=${etat.debordement}px`);
    verifier(`${cle} · URL SANS paramètre (${nom}) — aucune erreur JavaScript`, erreurs.length === 0,
      erreurs.slice(0, 2).join(' | '));

    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${cle}-defaut-${nom}.png` });
    await contexte.close();
  }
}

/* ─────────────────────────────── Exécution ─────────────────────────────── */

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox']
});

console.log(`╔═══ PILOTE-UI-01 — épreuve navigateur · ${BASE} ═══╗`);

for (const cle of ROLES) {
  console.log(`\n━━━ ${cle.toUpperCase()} — la coque tient à trois résolutions ━━━`);
  for (const resolution of RESOLUTIONS) await epreuveCoque(navigateur, cle, resolution);

  console.log(`\n━━━ ${cle.toUpperCase()} — sections : rendu, surfaces, contraste ━━━`);
  await epreuveNavigation(navigateur, cle);

  console.log(`\n━━━ ${cle.toUpperCase()} — la fenêtre d'édition ━━━`);
  await epreuveFenetreEdition(navigateur, cle);

  console.log(`\n━━━ ${cle.toUpperCase()} — la Fiche 360 réelle, ouverte pour de vrai ━━━`);
  await epreuveFiche360(navigateur, cle);

  console.log(`\n━━━ ${cle.toUpperCase()} — le formulaire de création replié ━━━`);
  await epreuveCreationRepliee(navigateur, cle);

  console.log(`\n━━━ ${cle.toUpperCase()} — retour à l'interface classique ━━━`);
  await epreuveRetourClassique(navigateur, cle);

  console.log(`\n━━━ ${cle.toUpperCase()} — URL sans paramètre : Pilote est désormais le défaut ━━━`);
  await epreuveUrlParDefaut(navigateur, cle);
}

await navigateur.close();

console.log(`\n╚═══ ${verifications - echecs}/${verifications} vérifications tenues ═══╝`);
if (echecs) {
  console.log('\nConstats :');
  for (const constat of constats) console.log(`  · ${constat}`);
  process.exit(1);
}
