/**
 * @file scripts/roles-ui-browser-e2e.mjs — les pages Salles et Baies dans un vrai navigateur.
 *
 * POURQUOI CETTE ÉPREUVE EXISTE
 * -----------------------------
 * `tests/parite-client-serveur-roles.test.js` exécute `render()` en Node et lit le HTML
 * rendu. C'est déjà une exécution — pas une lecture de source — mais il lui manque trois
 * choses que seul un navigateur apporte :
 *
 *   1. `entity-permission-integration.js`, qui ÉLAGUE le DOM après le rendu. Un premier
 *      rendu correct pourrait être défait par cette seconde barrière, ou l'inverse : une
 *      seconde barrière pourrait masquer un premier rendu fautif. On mesure le DOM FINAL.
 *   2. le routeur, la session signée et l'instantané `/api/sync` réels ;
 *   3. l'ordre d'installation des 56 modules qui se posent eux-mêmes sans être importés.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… node scripts/serve.js &
 *   node scripts/roles-ui-browser-e2e.mjs
 *
 * Playwright et Chromium sont fournis par l'environnement, pas par ce dépôt : le script
 * l'annonce et s'arrête proprement s'ils manquent, plutôt que de se déclarer vert.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4191';
const MOT_DE_PASSE = process.env.E2E_PASSWORD || 'Qz7-Vraie-Preuve-Bx9!';
const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch {
  console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ». Renseignez PLAYWRIGHT_MODULE.`);
  process.exit(2);
}

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) { console.log(`  ✅ ${nom}`); return; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
};

/**
 * On se connecte PAR L'ÉCRAN, et non en posant un cookie.
 *
 * Poser le cookie de session ne suffit pas : le client décide qui est connecté d'après
 * `localStorage.auth`, que seul le formulaire renseigne. Une session posée de l'extérieur
 * laisse donc la page de connexion à l'écran — ce que ce script a d'abord mesuré.
 */
async function connecter(page, username, motDePasse = MOT_DE_PASSE) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 30000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', motDePasse);
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 30000 });
  // La connexion réussie peut être suivie d'une navigation : lire `localStorage` pendant
  // celle-ci détruit le contexte d'exécution. On réessaie tant qu'elle est en cours.
  let auth = null;
  for (let essai = 0; essai < 20 && !auth; essai += 1) {
    try { auth = await page.evaluate(() => localStorage.getItem('auth')); }
    catch { await page.waitForTimeout(250); }
  }
  assert.ok(auth, `« ${username} » : aucune session posée après connexion`);
  return JSON.parse(auth);
}

/*
 * CE QUE CHAQUE RÔLE DOIT VOIR — la même table que le test Node, mesurée sur le DOM final.
 *
 * Le chef modifie, assigne et exporte, mais ne supprime ni n'importe. Le responsable
 * consulte, un point c'est tout : la matrice lui refuse les sept actions sur les salles et
 * les baies, et son plafond serveur exclut `room.edit`.
 */
const ATTENDU = Object.freeze({
  chef:        { create: true,  edit: true,  supprimer: false, exporter: true,  importer: false },
  responsable: { create: false, edit: false, supprimer: false, exporter: false, importer: false }
});

const SELECTEURS = Object.freeze({
  salles: { create: '#add-salle-form', edit: 'button[data-action="edit"]', supprimer: 'button[data-action="del"]',
    exporter: '#export-salles', importer: '#import-salles', table: 'table.tableau' },
  baies: { create: '#add-baie-form', edit: 'button[data-action="edit"]', supprimer: 'button[data-action="del"]',
    exporter: '#export-baies', importer: '#import-baies', table: 'table.tableau' }
});

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

console.log(`\n╔═══ Salles et Baies dans un navigateur réel — ${base} ═══╗\n`);

try {
  for (const [role, username] of [['chef', 'lota-chef'], ['responsable', 'lota-responsable']]) {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
    const compte = await connecter(page, username);
    verifier(`${role} · connecté à l’écran (rôle enregistré : « ${compte.role} »)`, Boolean(compte.id));

    for (const [nomPage, selecteurs] of Object.entries(SELECTEURS)) {
      console.log(`\n${role} · page ${nomPage}`);
      await page.goto(`${base}/#/${nomPage}`, { waitUntil: 'networkidle' });
      // La liste est le point de rendez-vous : tant qu'elle n'est pas là, la page n'a pas
      // fini de se poser et compter des boutons ne voudrait rien dire.
      await page.waitForSelector(selecteurs.table, { timeout: 20000 });
      // `entity-permission-integration.js` élague après `afterRender` : on laisse le tour
      // de boucle se terminer avant de mesurer, sinon on mesurerait le rendu intermédiaire.
      await page.waitForTimeout(600);

      const attendu = ATTENDU[role];
      for (const action of ['create', 'edit', 'supprimer', 'exporter', 'importer']) {
        const nombre = await page.locator(selecteurs[action]).count();
        verifier(`${role} · ${nomPage} · ${action} ${attendu[action] ? 'présent' : 'absent'} (${nombre})`,
          attendu[action] ? nombre > 0 : nombre === 0);
      }
      const lignes = await page.locator(`${selecteurs.table} tr`).count();
      verifier(`${role} · ${nomPage} · la liste est bien rendue (${lignes} lignes)`, lignes >= 1);
    }

    // Le périmètre de zone se voit à l'écran, et pas seulement dans l'instantané : le chef
    // comme le responsable CONSULTENT les salles de leur zone — c'est la différence
    // d'ACTION qui les sépare, pas la visibilité — et ni l'un ni l'autre ne doit lire la
    // salle laissée hors zone par le décor.
    await page.goto(`${base}/#/salles`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table.tableau', { timeout: 20000 });
    const texte = await page.locator('table.tableau').innerText();
    verifier(`${role} · au moins une salle de sa zone est affichée`,
      await page.locator('table.tableau tr').count() > 1, texte.slice(0, 120));
    verifier(`${role} · la salle HORS de sa zone n’apparaît pas`,
      !/hors zone/i.test(texte), texte.slice(0, 200));

    verifier(`${role} · aucune erreur JavaScript pendant le parcours`, erreurs.length === 0,
      erreurs.slice(0, 3).join(' | '));
    await contexte.close();
  }

  /*
   * LE CHEF PEUT ALLER JUSQU'AU BOUT — le formulaire lui offre une zone, et une seule.
   *
   * Rendre le formulaire ne suffit pas : sans champ de zone, chaque envoi finirait en refus.
   */
  console.log('\nchef · le formulaire d’ajout offre les zones où il peut créer');
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await contexte.newPage();
  await connecter(page, 'lota-chef');
  await page.goto(`${base}/#/salles`, { waitUntil: 'networkidle' });
  await page.waitForSelector('table.tableau', { timeout: 20000 });
  await page.waitForTimeout(600);

  // Absence du formulaire : c'est un ÉCHEC nommé, pas une attente qui expire. Sur la
  // base de référence le chef n'en avait aucun, et le script s'interrompait en pleine
  // course au lieu de dire ce qui manquait.
  const formulairePresent = await page.locator('#add-salle-form').count() === 1;
  verifier('chef · le formulaire d’ajout de salle lui est rendu', formulairePresent);
  if (!formulairePresent) {
    for (const reste of ['sélecteur de zone', 'zone obligatoire', 'zones ouvertes',
      'parité écran/serveur', 'zone étrangère écartée', 'sélecteur de responsable']) {
      verifier(`chef · ${reste} — non mesurable sans formulaire`, false);
    }
    await contexte.close();
    console.log(`\n╚═══ ❌ ${echecs} ÉCHEC(S) ═══╝\n`);
    await navigateur.close();
    process.exit(1);
  }

  const champZone = page.locator('#add-salle-form select[name="zoneId"]');
  verifier('chef · le formulaire porte un sélecteur de zone', await champZone.count() === 1);
  verifier('chef · le sélecteur de zone est obligatoire',
    await champZone.getAttribute('required') !== null);
  // L'ÉCRAN ET LE SERVEUR DOIVENT PROPOSER LA MÊME CHOSE.
  //
  // Compter les zones ne prouverait rien : le décor en accumule à chaque exécution. Ce qui
  // compte est que la liste offerte à l'écran soit EXACTEMENT celle où le serveur
  // accepterait la création — ni une de plus, qui finirait en refus après saisie, ni une de
  // moins, qui priverait le chef d'une zone qui lui revient.
  const proposees = (await champZone.locator('option').evaluateAll(
    options => options.map(option => option.value).filter(Boolean)
  )).sort();
  const attenduesParLeServeur = (await page.evaluate(async () => {
    const reponse = await fetch('/api/access/context', { credentials: 'include', cache: 'no-store' });
    const contexte = await reponse.json();
    return (contexte.zones || []).filter(zone => {
      const membre = (contexte.memberships || []).some(item => String(item.zoneId) === String(zone.id));
      const habilite = (contexte.grants || []).some(item =>
        String(item.zoneId) === String(zone.id) && item.permission === 'room.edit');
      return membre && habilite;
    }).map(zone => String(zone.id));
  })).sort();

  verifier(`chef · au moins une zone lui est ouverte (${proposees.length})`, proposees.length > 0);
  verifier('chef · l’écran propose EXACTEMENT les zones que le serveur accepterait',
    JSON.stringify(proposees) === JSON.stringify(attenduesParLeServeur),
    `écran ${JSON.stringify(proposees).slice(0, 120)} ≠ serveur ${JSON.stringify(attenduesParLeServeur).slice(0, 120)}`);
  const libelles = await champZone.locator('option').allTextContents();
  verifier('chef · la zone étrangère ne lui est PAS proposée',
    !libelles.some(libelle => /étrangère/i.test(libelle)), JSON.stringify(libelles).slice(0, 200));

  const champResponsable = page.locator('#add-salle-form select[name="responsibleId"]');
  verifier('chef · le sélecteur de responsable est là : il porte `rooms.assign`',
    await champResponsable.count() === 1);
  await contexte.close();

  /*
   * LE CONTEXTE D'ACCÈS INDISPONIBLE.
   *
   * Pour un rôle à périmètre, la zone est obligatoire. Sans la liste de ses zones, le
   * formulaire ne peut pas aboutir : l'offrir quand même produit une saisie perdue, et
   * hors ligne une opération en attente que le serveur rejettera bien plus tard.
   *
   * La panne est simulée au niveau du réseau, pas du code : c'est la seule façon de
   * mesurer ce que l'utilisateur verrait vraiment.
   */
  console.log('\nchef · la liste des zones est illisible');
  //
  // `serviceWorkers: 'block'` n'est pas un détail : `service-worker.js` intercepte les
  // appels d'API, si bien qu'une route posée sur la page ne les voit jamais. Sans ce
  // réglage, cette section mesurait un contexte servi par le cache et se déclarait en
  // échec pour une raison qui n'était pas la sienne.
  const contextePanne = await navigateur.newContext({
    viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block'
  });
  const pagePanne = await contextePanne.newPage();
  await connecter(pagePanne, 'lota-chef');
  await pagePanne.route('**/api/access/context', route => route.abort());
  await pagePanne.goto(`${base}/#/salles`, { waitUntil: 'networkidle' });
  await pagePanne.waitForSelector('table.tableau', { timeout: 20000 });
  await pagePanne.waitForTimeout(600);

  verifier('chef · aucun formulaire d’ajout soumettable',
    await pagePanne.locator('#add-salle-form').count() === 0);
  const message = pagePanne.locator('.salle-zone-indisponible');
  verifier('chef · un message explique quoi attendre', await message.count() === 1);
  if (await message.count()) {
    const texte = await message.innerText();
    verifier('chef · le message parle de la connexion centrale', /connexion centrale/i.test(texte), texte.slice(0, 140));
  }
  verifier('chef · la consultation des salles reste ouverte',
    await pagePanne.locator('table.tableau tr').count() > 1);
  await contextePanne.close();

  /*
   * L'administrateur, lui, garde son chemin global : il crée sans zone, et le serveur
   * fabrique le rattachement dans la même réponse.
   */
  console.log('\nadmin · la même panne ne le bloque pas');
  const contexteAdmin = await navigateur.newContext({
    viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block'
  });
  const pageAdmin = await contexteAdmin.newPage();
  await connecter(pageAdmin, process.env.PLATFORM_ADMIN_USERNAME || 'lota-admin',
    process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!');
  await pageAdmin.route('**/api/access/context', route => route.abort());
  await pageAdmin.goto(`${base}/#/salles`, { waitUntil: 'networkidle' });
  await pageAdmin.waitForSelector('table.tableau', { timeout: 20000 });
  await pageAdmin.waitForTimeout(600);
  verifier('admin · garde son formulaire d’ajout', await pageAdmin.locator('#add-salle-form').count() === 1);
  verifier('admin · ne reçoit pas le message des zones illisibles',
    await pageAdmin.locator('.salle-zone-indisponible').count() === 0);
  await contexteAdmin.close();
} finally {
  await navigateur.close();
}

console.log(`\n╚═══ ${echecs === 0 ? '✅ AUCUN ÉCHEC' : '❌ ' + echecs + ' ÉCHEC(S)'} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
