/**
 * @file scripts/screen-diag-browser-gate.mjs — l'épreuve de navigateur du lot SCREEN-DIAG-TECH-01.
 *
 * CE QU'ELLE MESURE
 * -----------------
 * Un technicien SCOPÉ ouvre le Mur d'images de SA salle, clique SON écran, puis
 * « Diagnostiquer ». L'épreuve n'observe pas un rendu : elle observe des ÉCRITURES.
 *
 * Chaque `put` d'IndexedDB est intercepté avec son magasin, son identifiant, sa salle et
 * la PILE D'APPEL qui l'a demandé ; chaque requête réseau est notée avec son statut. On
 * peut donc dire non seulement « le diagnostic ne s'ouvre pas », mais QUI a écrit QUOI,
 * POUR QUELLE SALLE, et depuis QUELLE FONCTION.
 *
 * Les assertions tiennent en six points :
 *
 *   1. le diagnostic s'ouvre RÉELLEMENT et reste à l'écran ;
 *   2. AUCUNE écriture `screen_groups` n'est tentée par la simple ouverture ;
 *   3. AUCUN 403 automatique ne part vers le serveur ;
 *   4. AUCUNE donnée de la zone B n'atteint la page — ni salle, ni écran, ni identifiant ;
 *   5. la file de synchronisation ne retient AUCUN échec ;
 *   6. l'écran autorisé est réellement sélectionné, donc le diagnostic est UTILISABLE.
 *
 * Le point 2 est le cœur du lot : une CONSULTATION NE MUTE PAS. Il est vérifié pour ce
 * qu'il est — une absence d'écriture — et non par l'absence de son symptôme, un 403.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-decor.mjs && node scripts/screen-diag-decor.mjs
 *   node scripts/screen-diag-browser-gate.mjs
 */
import { createRequire } from 'node:module';
import { BASE } from './ui-polish-decor.mjs';
import {
  COMPTE_TECHNICIEN, COMPTE_TECHNICIEN_SANS_ZONE, COMPTE_VISITEUR, connexion, poserLeDecorScreenDiag,
  retirerGroupes, poserGroupe,
  SALLE_A, SALLE_B, ECRAN_A, ECRAN_B, GROUPE_A, GROUPE_B, NOM_SALLE_B, NOM_ECRAN_B
} from './screen-diag-decor.mjs';
import { COMPTES, motDePasseDe } from './ui-polish-decor.mjs';

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch { console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ».`); process.exit(2); }

/** Durée d'observation après l'ouverture — le lot exige au moins 45 s de calme. */
const OBSERVATION_MS = Number(process.env.SCREEN_DIAG_OBSERVATION_MS || 45000);

/**
 * LA SONDE, posée AVANT tout script de la page.
 *
 * `IDBObjectStore.prototype.put` est le passage OBLIGÉ de toute écriture locale : la
 * surcharger ici capte aussi bien `db.save()` que le remplacement de magasin par
 * l'instantané. On distingue les deux par la pile d'appel, qu'on retient telle quelle.
 */
const SONDE = `
  window.__ecritures = [];
  window.__reseau = [];
  window.__erreurs = [];
  const putOriginal = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(valeur, cle) {
    try {
      window.__ecritures.push({
        magasin: this.name,
        id: valeur && valeur.id !== undefined ? String(valeur.id) : (cle === undefined ? null : String(cle)),
        salle: valeur && valeur.roomId !== undefined && valeur.roomId !== null ? String(valeur.roomId) : null,
        charge: (() => { try { return JSON.stringify(valeur).slice(0, 400); } catch { return '(non sérialisable)'; } })(),
        pile: (new Error().stack || '').split('\\n').slice(1, 24).join(' | '),
        instant: Date.now()
      });
    } catch { /* la sonde ne doit jamais casser l'écriture qu'elle observe */ }
    return putOriginal.call(this, valeur, cle);
  };
  const fetchOriginal = window.fetch;
  window.fetch = async function(...args) {
    const requete = args[0];
    const url = typeof requete === 'string' ? requete : (requete && requete.url) || '';
    const method = (args[1] && args[1].method) || (requete && requete.method) || 'GET';
    const depart = Date.now();
    try {
      const reponse = await fetchOriginal.apply(this, args);
      window.__reseau.push({ method, url, statut: reponse.status, instant: depart });
      return reponse;
    } catch (erreur) {
      window.__reseau.push({ method, url, statut: 0, erreur: String(erreur && erreur.message), instant: depart });
      throw erreur;
    }
  };
  window.addEventListener('error', evenement => window.__erreurs.push(String(evenement.message)));
  window.addEventListener('unhandledrejection', evenement => window.__erreurs.push('rejet non traité: ' + String(evenement.reason && evenement.reason.message || evenement.reason)));
`;

const echecs = [];
const constats = [];
const note = (ok, titre, detail = '') => {
  constats.push({ ok, titre, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${titre}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(`${titre}${detail ? ` — ${detail}` : ''}`);
};

async function connecter(page, compte) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 60000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', compte.motDePasse);
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 60000 });
}

/** La file de synchronisation, lue dans la base locale de la page. */
const lireFile = page => page.evaluate(async () => {
  const base = await new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open('tech_platform_db');
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
  if (!base.objectStoreNames.contains('syncQueue')) return [];
  return new Promise((resoudre, rejeter) => {
    const requete = base.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll();
    requete.onsuccess = () => resoudre(requete.result || []);
    requete.onerror = () => rejeter(requete.error);
  });
});

/** Le parcours mesuré : Mur → Écran A → Diagnostiquer. */
async function parcoursDiagnostic(page) {
  await page.waitForSelector('.smart-tech-board', { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('#btn-wall');
  await page.waitForSelector('#wall-canvas', { timeout: 30000 });
  // La salle est choisie explicitement : le mur retient la dernière salle vue, et une
  // épreuve qui dépend de cette mémoire ne mesure pas toujours la même chose.
  await page.selectOption('#wall-room-select', SALLE_A);
  await page.waitForTimeout(1500);
  await page.click(`.wall-screen[data-screen-id="${ECRAN_A}"]`);
  await page.waitForTimeout(800);
  const boutons = await page.$$('#wall-editor button');
  let diagnostiquer = null;
  for (const bouton of boutons) {
    if (((await bouton.innerText()) || '').trim() === 'Diagnostiquer') { diagnostiquer = bouton; break; }
  }
  if (!diagnostiquer) return { boutonPresent: false };
  await diagnostiquer.click();
  await page.waitForTimeout(4000);
  return { boutonPresent: true };
}

const releve = page => page.evaluate(() => ({
  ecritures: window.__ecritures || [],
  reseau: window.__reseau || [],
  erreurs: window.__erreurs || []
}));

/** Le diagnostic est-il réellement à l'écran ? */
const diagnosticVisible = page => page.evaluate(() => {
  const marque = document.querySelector('#app > [data-tech-surface]')?.getAttribute('data-tech-surface');
  const titre = [...document.querySelectorAll('h2')].some(h => (h.textContent || '').includes('diagnostic des écrans'));
  const interface_ = Boolean(document.querySelector('.diagnostic-interface, .diagnosis-flow'));
  return { marque, titre, interface: interface_, visible: titre && interface_ };
});

/** Tout ce qui pourrait trahir la zone B, cherché dans la page ENTIÈRE. */
const fuiteZoneB = (page, jetons) => page.evaluate(cles => {
  const texte = document.body ? document.body.innerText || '' : '';
  const balisage = document.body ? document.body.innerHTML || '' : '';
  const trouves = [];
  for (const cle of cles) {
    if (texte.includes(cle) || balisage.includes(cle)) trouves.push(cle);
  }
  return trouves;
}, jetons);

async function main() {
  console.log(`\n╔═══ épreuve SCREEN-DIAG-TECH-01 — ${BASE} ═══╗\n`);

  const admin = await poserLeDecorScreenDiag({ trace: false });
  console.log('  · décor posé (zone A autorisée, zone B interdite, aucun screen_groups)\n');

  const navigateur = await chromium.launch({ args: ['--no-sandbox'] });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1 · LE PARCOURS PRINCIPAL — base fraîche, aucun screen_group
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('── 1 · Technicien zone A · Mur A → Écran A → Diagnostiquer (aucun screen_group)');
  const contexte = await navigateur.newContext();
  await contexte.addInitScript(SONDE);
  const page = await contexte.newPage();
  await connecter(page, COMPTE_TECHNICIEN);
  const parcours = await parcoursDiagnostic(page);
  note(parcours.boutonPresent, 'le bouton « Diagnostiquer » est proposé au technicien');

  const etat = await diagnosticVisible(page);
  note(etat.visible, 'le diagnostic s’ouvre réellement',
    `surface=${etat.marque} titre=${etat.titre} interface=${etat.interface}`);

  const mesure = await releve(page);
  const ecrituresGroupes = mesure.ecritures.filter(e => e.magasin === 'screen_groups');
  /*
   * MUTATION ou RECOPIE ? — ET POURQUOI LA PILE NE SUFFIT PAS.
   *
   * L'instantané central réécrit lui aussi les magasins locaux : compter tout `put` comme
   * une mutation ferait échouer l'épreuve sur une simple synchronisation. Il faut donc
   * séparer les deux.
   *
   * La pile d'appel semble l'outil naturel. Elle ne l'est pas, et c'est mesuré : sur
   * `main@bd121dbc`, l'écriture fautive n'y laisse AUCUNE trace de
   * `screens-diagnostic.js`. `db.save()` pose son `put` à l'intérieur d'un exécuteur de
   * promesse (`db.js:83`), et la frontière asynchrone efface les cadres appelants — la
   * pile s'arrête à `Database.save`. Une épreuve fondée sur elle seule aurait déclaré
   * « 0 mutation » devant le défaut, et serait passée au vert sur du rouge.
   *
   * LE TÉMOIN QUI DÉCIDE EST DONC LE RÉSEAU : une écriture poussée laisse un `PUT` sur
   * `/api/data/screen_groups/`, qu'aucune recopie d'instantané ne produit. La file de
   * synchronisation, vérifiée plus bas, en est le second témoin indépendant. Le filtre de
   * pile est conservé parce qu'il nomme le coupable quand il parle — mais il ne fonde
   * rien à lui seul, et l'assertion ne doit jamais être réduite à lui.
   */
  const mutationsGroupes = ecrituresGroupes.filter(e => /screens-diagnostic\.js/.test(e.pile));
  const poussees = mesure.reseau.filter(r => r.url.includes('/api/data/screen_groups/') && r.method === 'PUT');
  note(mutationsGroupes.length === 0 && poussees.length === 0,
    'aucune écriture screen_groups à la simple ouverture',
    `${mutationsGroupes.length} mutation(s) locale(s), ${poussees.length} PUT réseau, ` +
    `${ecrituresGroupes.length - mutationsGroupes.length} recopie(s) d’instantané`);

  const horsZone = [...ecrituresGroupes.filter(e => /screens-diagnostic\.js/.test(e.pile)), ...poussees]
    .filter(item => item.salle !== undefined
      ? (item.salle !== null && String(item.salle) !== String(SALLE_A))
      : !item.url.includes(encodeURIComponent(GROUPE_A)));
  note(horsZone.length === 0, 'aucune écriture screen_groups hors zone A',
    horsZone.map(item => item.id || item.url).join(', '));

  /*
   * LE 403 EST CHERCHÉ SUR LA CHAÎNE DU DIAGNOSTIC, PAS SUR TOUTE LA PAGE.
   *
   * L'espace technicien porte, INDÉPENDAMMENT de ce lot, deux écritures refusées au
   * chargement — l'ensemencement `docs/regiecar-*` (territoire de #108) et
   * `settings/global`. Elles sont réelles et signalées séparément dans le handoff ; les
   * inclure ici rendrait cette épreuve incapable de passer au vert sans corriger un lot
   * qui n'est pas le sien, et ferait dépendre #110 de #108.
   *
   * Ce que le lot promet est précis : la chaîne Mur → Écran → Diagnostiquer ne provoque
   * aucun refus. C'est cela qui est mesuré.
   */
  const refusDiagnostic = mesure.reseau.filter(r => r.statut === 403 && /screen_groups|screens|walls|rooms|screen_issues|diagnosis_history/.test(r.url));
  note(refusDiagnostic.length === 0, 'aucun 403 automatique sur la chaîne du diagnostic',
    refusDiagnostic.map(r => `${r.method} ${r.url.replace(BASE, '')}`).join(', '));
  const refusAutres = mesure.reseau.filter(r => r.statut === 403 && !/screen_groups|screens|walls|rooms|screen_issues|diagnosis_history/.test(r.url));
  if (refusAutres.length) {
    console.log(`  ⓘ ${refusAutres.length} refus PRÉEXISTANT(S) hors périmètre de ce lot : ` +
      `${[...new Set(refusAutres.map(r => r.url.replace(BASE, '').split('/').slice(0, 4).join('/')))].join(', ')}`);
  }

  const fuites = await fuiteZoneB(page, [SALLE_B, ECRAN_B, NOM_SALLE_B, NOM_ECRAN_B, GROUPE_B]);
  note(fuites.length === 0, 'aucune donnée de la zone B dans la page', fuites.join(', '));

  /*
   * Les rejets non traités venus de l'ensemencement `docs/regiecar-*` et de
   * `settings/global` PRÉEXISTENT à ce lot (voir plus haut). On mesure ce que le lot
   * promet : l'ouverture du diagnostic ne lève plus d'erreur — et en particulier plus le
   * refus `screen_groups` qui rejetait `this.ready` et tuait le bouton pour la session.
   */
  const erreursJs = mesure.erreurs.filter(m => !/favicon|ResizeObserver/i.test(m));
  const erreursDiagnostic = erreursJs.filter(m => !/regiecar|settings/i.test(m));
  note(erreursDiagnostic.length === 0, 'aucune erreur JavaScript imputable au diagnostic',
    erreursDiagnostic.slice(0, 3).join(' | '));
  if (erreursJs.length !== erreursDiagnostic.length) {
    console.log(`  ⓘ ${erreursJs.length - erreursDiagnostic.length} rejet(s) PRÉEXISTANT(S) (ensemencement regiecar / settings), hors périmètre`);
  }

  const file = await lireFile(page);
  const fileDiagnostic = file.filter(entree =>
    ['screen_groups', 'screens', 'walls', 'screen_issues', 'diagnosis_history'].includes(entree.storeName));
  note(fileDiagnostic.length === 0, 'la file de synchronisation ne retient aucune écriture du diagnostic',
    fileDiagnostic.map(e => `${e.storeName}/${e.entityId}:${e.status}`).join(', '));
  const fileAutre = file.filter(entree => !fileDiagnostic.includes(entree)
    && ['failed', 'conflict'].includes(String(entree.status)));
  if (fileAutre.length) {
    console.log(`  ⓘ ${fileAutre.length} entrée(s) en échec PRÉEXISTANTE(S), hors périmètre : ` +
      `${[...new Set(fileAutre.map(e => e.storeName))].join(', ')}`);
  }

  // L'écran demandé est-il réellement celui que le diagnostic a pris ? Un diagnostic qui
  // s'ouvre sur « aucun écran » serait ouvert sans être utilisable.
  const selection = await page.evaluate(() => {
    const champ = document.getElementById('screen-select');
    const resume = document.querySelector('.selected-screens, .diagnosis-target, .screen-item.selected');
    return { valeur: champ ? champ.value : null, resume: resume ? (resume.innerText || '').slice(0, 200) : null };
  });
  note(String(selection.valeur || '') === String(ECRAN_A) || String(selection.resume || '').includes('Écran A'),
    'l’écran autorisé est réellement sélectionné', `select=${selection.valeur} résumé=${selection.resume}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2 · STABILITÉ — le diagnostic reste ouvert et rien ne s'écrit en boucle
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n── 2 · Stabilité sur ${Math.round(OBSERVATION_MS / 1000)} s`);
  const avant = (await releve(page)).ecritures.length;
  await page.waitForTimeout(OBSERVATION_MS);
  const apres = await releve(page);
  const etatFinal = await diagnosticVisible(page);
  note(etatFinal.visible, 'le diagnostic est TOUJOURS visible après l’observation');
  const groupesPendant = apres.ecritures.slice(avant).filter(e => e.magasin === 'screen_groups'
    && /screens-diagnostic\.js/.test(e.pile));
  const pousseesPendant = apres.reseau.filter(r => r.url.includes('/api/data/screen_groups/') && r.method === 'PUT');
  note(groupesPendant.length === 0 && pousseesPendant.length === 0,
    'aucune mutation screen_groups pendant l’observation',
    `${apres.ecritures.length - avant} écritures locales au total, dont ${groupesPendant.length} mutation(s) de groupe et ${pousseesPendant.length} PUT`);
  const refusPendant = apres.reseau.filter(r => r.statut === 403 && /screen_groups|screens|walls|rooms|screen_issues|diagnosis_history/.test(r.url));
  note(refusPendant.length === 0, 'aucun 403 pendant l’observation sur la chaîne du diagnostic',
    refusPendant.map(r => `${r.method} ${r.url.replace(BASE, '')}`).join(', '));
  const fileFinale = await lireFile(page);
  const fileFinaleDiagnostic = fileFinale.filter(entree =>
    ['screen_groups', 'screens', 'walls', 'screen_issues', 'diagnosis_history'].includes(entree.storeName));
  note(fileFinaleDiagnostic.length === 0, 'file de synchronisation stable à la fin (chaîne du diagnostic)',
    `${fileFinale.length} entrée(s) au total, ${fileFinaleDiagnostic.length} du diagnostic`);
  const erreursFinales = apres.erreurs
    .filter(m => !/favicon|ResizeObserver/i.test(m))
    .filter(m => !/regiecar|settings/i.test(m));
  note(erreursFinales.length === 0, 'aucune erreur JavaScript imputable au diagnostic après observation',
    erreursFinales.slice(0, 3).join(' | '));
  await contexte.close();

  // ─────────────────────────────────────────────────────────────────────────────
  // 2 bis · LE VRAI WORKFLOW, jusqu'au premier pas réel
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── 2 bis · Le diagnostic autorisé est réellement exécuté');
  {
    const contexteFlux = await navigateur.newContext();
    await contexteFlux.addInitScript(SONDE);
    const pageFlux = await contexteFlux.newPage();
    await connecter(pageFlux, COMPTE_TECHNICIEN);
    await parcoursDiagnostic(pageFlux);
    // L'écran est déjà sélectionné par `selectScreenById` ; le bouton doit donc être actif.
    const actif = await pageFlux.evaluate(() => {
      const bouton = document.getElementById('start-diagnosis-btn');
      return bouton ? !bouton.disabled : null;
    });
    note(actif === true, 'le bouton « Commencer le diagnostic » est actif sur l’écran autorisé', `actif=${actif}`);
    if (actif) {
      await pageFlux.click('#start-diagnosis-btn');
      await pageFlux.waitForTimeout(1500);
      const flux = await pageFlux.evaluate(() => {
        const entete = document.querySelector('.diagnosis-flow .diagnosis-header h3');
        const etape = document.querySelector('.diagnosis-flow .step-content h4');
        const etiquettes = [...document.querySelectorAll('.diagnosis-flow .screen-tag')].map(n => n.textContent.trim());
        return {
          ouvert: Boolean(entete && etape),
          titre: entete ? entete.textContent.trim() : null,
          question: etape ? etape.textContent.trim() : null,
          ecrans: etiquettes
        };
      });
      note(flux.ouvert, 'le premier pas du workflow réel s’affiche', `${flux.titre} · « ${flux.question} »`);
      note(flux.ecrans.length === 1 && flux.ecrans[0] === 'Écran A',
        'le workflow porte sur le SEUL écran autorisé', flux.ecrans.join(', '));
      const mesureFlux = await releve(pageFlux);
      const refusFlux = mesureFlux.reseau.filter(r => r.statut === 403
        && /screen_groups|screens|walls|rooms|screen_issues|diagnosis_history/.test(r.url));
      note(refusFlux.length === 0, 'aucun refus pendant le workflow réel',
        refusFlux.map(r => `${r.method} ${r.url.replace(BASE, '')}`).join(', '));
    }
    await contexteFlux.close();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3 · LES QUATRE ÉTATS DE screen_groups
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── 3 · Absence / présence de screen_groups — quatre états');
  const etats = [
    { nom: 'aucun groupe', poser: async () => { await retirerGroupes(admin.cookieAdmin); } },
    { nom: 'groupe zone A seul', poser: async () => {
        await retirerGroupes(admin.cookieAdmin);
        await poserGroupe(admin.cookieAdmin, { id: GROUPE_A, nom: 'Écrans Salle A', salleId: SALLE_A, ecranIds: [ECRAN_A] });
      } },
    { nom: 'groupe zone B seul', poser: async () => {
        await retirerGroupes(admin.cookieAdmin);
        await poserGroupe(admin.cookieAdmin, { id: GROUPE_B, nom: `Écrans ${NOM_SALLE_B}`, salleId: SALLE_B, ecranIds: [ECRAN_B] });
      } },
    { nom: 'groupes zone A + zone B', poser: async () => {
        await retirerGroupes(admin.cookieAdmin);
        await poserGroupe(admin.cookieAdmin, { id: GROUPE_A, nom: 'Écrans Salle A', salleId: SALLE_A, ecranIds: [ECRAN_A] });
        await poserGroupe(admin.cookieAdmin, { id: GROUPE_B, nom: `Écrans ${NOM_SALLE_B}`, salleId: SALLE_B, ecranIds: [ECRAN_B] });
      } }
  ];
  for (const etatGroupe of etats) {
    await etatGroupe.poser();
    const contexteEtat = await navigateur.newContext();
    await contexteEtat.addInitScript(SONDE);
    const pageEtat = await contexteEtat.newPage();
    await connecter(pageEtat, COMPTE_TECHNICIEN);
    await parcoursDiagnostic(pageEtat);
    const vu = await diagnosticVisible(pageEtat);
    const mesureEtat = await releve(pageEtat);
    const fuitesEtat = await fuiteZoneB(pageEtat, [SALLE_B, ECRAN_B, NOM_SALLE_B, NOM_ECRAN_B, GROUPE_B]);
    const refusEtat = mesureEtat.reseau.filter(r => r.statut === 403
      && /screen_groups|screens|walls|rooms|screen_issues|diagnosis_history/.test(r.url));
    note(vu.visible && fuitesEtat.length === 0 && refusEtat.length === 0,
      `état « ${etatGroupe.nom} » : diagnostic ouvert, zone B invisible, aucun 403`,
      `ouvert=${vu.visible} fuites=[${fuitesEtat.join(', ')}] 403=${refusEtat.length}`);
    await contexteEtat.close();
  }
  await retirerGroupes(admin.cookieAdmin);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3 bis · LA MATRICE DES RÔLES — aucun droit inventé, aucun droit perdu
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── 3 bis · Matrice des rôles (permissions existantes, inchangées)');
  {
    /*
     * `screens.diagnose` est lu dans `permissions.js` et n'est PAS touché par ce lot :
     * la matrice est vérifiée telle qu'elle est, pour constater qu'elle le reste. Le
     * visiteur en est le témoin décisif — il ne doit gagner AUCUNE écriture.
     */
    const attendus = [
      { compte: COMPTES.admin, role: 'admin', diagnostique: true },
      { compte: COMPTES.manager, role: 'manager', diagnostique: true },
      { compte: COMPTES.chef, role: 'chef', diagnostique: true },
      { compte: COMPTES.responsable, role: 'responsible', diagnostique: true },
      { compte: COMPTES.technique, role: 'technician', diagnostique: true },
      { compte: COMPTES.visiteur, role: 'visitor', diagnostique: false }
    ];
    // La matrice `screens.diagnose` elle-même est éprouvée hors navigateur, dans
    // `tests/screen-diagnostic-projection.test.js` : elle se lit dans `permissions.js` et
    // n'a pas besoin d'un navigateur pour être vérifiée. Ici on mesure ce que seule une
    // vraie session peut dire — qu'AUCUN rôle n'écrit de groupe en ouvrant sa session.
    for (const cas of attendus) {
      const contexteRole = await navigateur.newContext();
      await contexteRole.addInitScript(SONDE);
      const pageRole = await contexteRole.newPage();
      await connecter(pageRole, { username: cas.compte.username, motDePasse: motDePasseDe(cas.compte) });
      await pageRole.waitForTimeout(4000);
      const mesureRole = await releve(pageRole);
      const pousseesRole = mesureRole.reseau.filter(r => r.url.includes('/api/data/screen_groups/') && r.method === 'PUT');
      note(pousseesRole.length === 0, `${cas.role} : aucune écriture screen_groups au chargement`,
        pousseesRole.map(r => r.url.replace(BASE, '')).join(', '));
      await contexteRole.close();
    }
    // Le visiteur, éprouvé sur ce qui compte vraiment : le serveur lui refuse l'écriture.
    const visiteur = await connexion(COMPTE_VISITEUR);
    const reponseVisiteur = await fetch(`${BASE}/api/data/screen_groups/${encodeURIComponent(GROUPE_A)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: visiteur.cookie },
      body: JSON.stringify({ id: GROUPE_A, name: 'tentative visiteur', screenIds: [], roomId: SALLE_A })
    });
    note(reponseVisiteur.status === 403, 'visiteur : écriture screen_groups refusée', `statut ${reponseVisiteur.status}`);
    const reponseDiagVisiteur = await fetch(`${BASE}/api/data/diagnosis_history/diag-tentative-visiteur`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: visiteur.cookie },
      body: JSON.stringify({ id: 'diag-tentative-visiteur', screenId: ECRAN_A, roomId: SALLE_A })
    });
    note(reponseDiagVisiteur.status === 403, 'visiteur : écriture diagnosis_history refusée',
      `statut ${reponseDiagVisiteur.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4 · LE SERVEUR RESTE FAIL-CLOSED
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── 4 · Le serveur reste fail-closed');
  const technicien = await connexion(COMPTE_TECHNICIEN);
  const sansZone = await connexion(COMPTE_TECHNICIEN_SANS_ZONE);
  const tenter = async (cookie, id, salleId) => {
    const reponse = await fetch(`${BASE}/api/data/screen_groups/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id, name: 'tentative directe', screenIds: [], roomId: salleId })
    });
    return reponse.status;
  };
  const statutB = await tenter(technicien.cookie, GROUPE_B, SALLE_B);
  note(statutB === 403, 'écriture screen_groups zone B par le technicien : refusée', `statut ${statutB}`);
  const statutA = await tenter(technicien.cookie, GROUPE_A, SALLE_A);
  note(statutA === 403, 'écriture screen_groups zone A sans screen.edit : refusée', `statut ${statutA}`);
  const statutSansZone = await tenter(sansZone.cookie, GROUPE_A, SALLE_A);
  note(statutSansZone === 403, 'écriture screen_groups par un technicien sans zone : refusée', `statut ${statutSansZone}`);
  const instantane = await (await fetch(`${BASE}/api/sync`, { headers: { cookie: technicien.cookie } })).json();
  const sallesVues = (instantane.data?.rooms || []).map(salle => String(salle.id));
  note(!sallesVues.includes(String(SALLE_B)), 'l’instantané du technicien ne contient pas la salle B',
    sallesVues.join(', '));
  await retirerGroupes(admin.cookieAdmin);

  await navigateur.close();

  console.log(`\n╚═══ ${constats.filter(c => c.ok).length}/${constats.length} constats tenus ═══╝\n`);
  if (echecs.length) {
    console.error('ÉCHECS :');
    for (const echec of echecs) console.error(`  · ${echec}`);
    process.exit(1);
  }
}

await main();
