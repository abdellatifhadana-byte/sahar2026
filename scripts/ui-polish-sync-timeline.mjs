/**
 * @file scripts/ui-polish-sync-timeline.mjs — P0-4 mesuré sur la vraie chronologie.
 *
 * POURQUOI CETTE ÉPREUVE EXISTE
 * -----------------------------
 * L'épreuve précédente prouvait que la fonction de rendu SAIT produire un état d'attente :
 * elle l'appelait elle-même avec le drapeau `{ enCours: true }`. C'est une preuve de
 * rendu, pas une preuve de comportement — et le Gate indépendant l'a montré en mesurant,
 * lui, la chronologie réelle depuis la connexion :
 *
 *   t = 1 005 ms  `central-sync-status` { state: "offline" }   ← une écriture locale
 *   t = 5 634 ms  bandeau : data-chargement="non", « 0 non rattaché »   ← DÉFINITIF
 *   t = 22 179 ms `central-sync-status` { state: "synced", updatedAt }  ← 1er snapshot
 *   t = 22 490 ms bandeau : « 1 non rattaché »                          ← DÉFINITIF
 *
 * Deux valeurs définitives, 0 puis 1, pendant l'initialisation : exactement le défaut que
 * P0-4 devait fermer. La garde d'alors sortait de l'attente au PREMIER événement de statut,
 * quel qu'il soit — or un `offline` émis par une écriture locale ne prouve rien.
 *
 * CE QUE CETTE ÉPREUVE MESURE
 * ---------------------------
 * Sur une base FRAÎCHE, avec serveur et navigateur réels et une connexion réelle, elle
 * échantillonne toutes les 250 ms pendant au moins trente-cinq secondes — soit plus d'un
 * cycle du sondage de vingt secondes :
 *
 *   · chaque `central-sync-status`, avec son détail COMPLET (dont `updatedAt`) ;
 *   · chaque `central-catalog-installed` ;
 *   · le texte du bandeau, `data-chargement`, `aria-busy`, le compte hors chaîne ;
 *   · la vérité `/api/sync`, relue à la fin.
 *
 * Elle échoue si DEUX valeurs définitives différentes ont été présentées.
 *
 * Une seconde phase éprouve le COMPORTEMENT de la garde face à cinq statuts synthétiques,
 * dans le navigateur, sur le module réellement servi — pas sur son texte source.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   node scripts/ui-polish-sync-timeline.mjs
 */
import { createRequire } from 'node:module';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4191';
const ADMIN = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const MOT_DE_PASSE = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || '';
const DUREE_MS = Number(process.env.UI_TIMELINE_MS || 36000);
const PAS_MS = Number(process.env.UI_TIMELINE_STEP_MS || 250);
const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(CHEMIN_PLAYWRIGHT)); }
catch {
  console.error(`Playwright introuvable en « ${CHEMIN_PLAYWRIGHT} ». Renseignez PLAYWRIGHT_MODULE.`);
  process.exit(2);
}

let echecs = 0;
let verifications = 0;
const verifier = (nom, condition, detail = '') => {
  verifications += 1;
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

/**
 * Le journal des événements est posé AVANT tout module de l'application.
 *
 * Un écouteur installé après coup manquerait précisément les événements précoces — ceux
 * qui sont en cause. `addInitScript` s'exécute à chaque document, avant les scripts de la
 * page, ce qui est le seul endroit d'où l'on voit la chronologie complète.
 */
const SONDE = `
  window.__t0 = Date.now();
  window.__journalSync = [];
  const noter = (type, detail) => window.__journalSync.push({
    t: Date.now() - window.__t0, type,
    detail: detail ? JSON.parse(JSON.stringify(detail)) : null
  });
  window.addEventListener('central-sync-status', event => noter('central-sync-status', event.detail));
  window.addEventListener('central-catalog-installed', event => noter('central-catalog-installed', event.detail));
`;

/** Ce que le bandeau montre à cet instant précis. */
const LECTURE = `() => {
  const bandeau = document.getElementById('signal-spine');
  if (!bandeau) return { t: Date.now() - window.__t0, present: false };
  const hors = bandeau.querySelector('[data-segment="unassigned"]');
  const compte = hors?.querySelector('.spine-segment-count')?.textContent?.trim() ?? null;
  return {
    t: Date.now() - window.__t0,
    present: true,
    chargement: bandeau.dataset.chargement || '',
    busy: bandeau.getAttribute('aria-busy') || '',
    attente: /Synchronisation/.test(bandeau.textContent || ''),
    compte: compte === null || compte === '' ? null : Number(compte),
    texte: (hors?.innerText || bandeau.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90)
  };
}`;

async function connecter(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 60000 });
  await page.fill('#login-username', ADMIN);
  await page.fill('#login-password', MOT_DE_PASSE);
  await page.click('#login-submit');
}

/** La vérité du serveur, recalculée sans passer par le contrat de la plateforme. */
async function veriteServeur(page) {
  return page.evaluate(async () => {
    const reponse = await fetch('/api/sync', { credentials: 'include', cache: 'no-store' });
    const instantane = await reponse.json();
    const salles = new Map((instantane.data?.rooms || []).map(salle => [String(salle.id), salle]));
    const segments = new Set(['acquisition', 'regie', 'continuite', 'diffusion']);
    const horsChaine = (instantane.data?.equipments || []).filter(equipement => {
      const salle = equipement.roomId === null || equipement.roomId === undefined || equipement.roomId === ''
        ? null : salles.get(String(equipement.roomId));
      return !salle || !segments.has(String(salle.chainSegment || '').trim().toLowerCase());
    });
    return { total: horsChaine.length };
  });
}

/* ═════════════════ PHASE A — la chronologie réelle depuis la connexion ═════════════════ */

/**
 * LA FENÊTRE OÙ LE DÉFAUT VIT — et comment on la rend reproductible.
 *
 * Sur une base fraîche, la chronologie mesurée montre TOUJOURS la même forme : une
 * quarantaine de statuts SANS preuve de snapshot vers t = 1 s — `offline` émis par les
 * écritures des semeurs, `conflict`, `warning` — puis, plus tard, un statut porteur de
 * `updatedAt`. Le bandeau se pose entre les deux ou après, selon la durée qu'a prise la
 * synchronisation de connexion.
 *
 * Chez le Gate indépendant, cette synchronisation-là n'a produit AUCUN snapshot : la
 * première preuve n'est venue qu'avec le sondage de vingt secondes (t = 22 179 ms), et le
 * bandeau s'était posé à t = 5 634 ms — au milieu de la fenêtre. C'est cette configuration
 * que `UI_TIMELINE_COUPER_PREMIER_SYNC` reproduit, et rien d'autre : la PREMIÈRE lecture
 * de `/api/sync` échoue, comme lors d'un serveur momentanément indisponible. Le code de
 * la plateforme a déjà un chemin pour ce cas — `central-sync.js` l'attrape et émet un
 * statut `local` sans preuve — et les lectures suivantes passent normalement.
 *
 * Aucune modification du produit : seule la condition réseau est posée.
 */
async function couperLePremierSync(page) {
  let coupees = 0;
  const aCouper = Number(process.env.UI_TIMELINE_COUPER_PREMIER_SYNC || 0);
  if (!aCouper) return;
  await page.route('**/api/sync', route => {
    if (route.request().method() === 'GET' && coupees < aCouper) { coupees += 1; return route.abort(); }
    return route.continue();
  });
}

async function chronologie(navigateur, numero) {
  console.log(`\n━━━ Chronologie réelle · parcours ${numero} (${Math.round(DUREE_MS / 1000)} s, pas ${PAS_MS} ms) ━━━`);
  /* `serviceWorkers: 'block'` n'est pas un détail : `service-worker.js` intercepte les
     requêtes de la page, et une condition réseau posée sur le contexte ne l'atteindrait
     pas — la coupure serait silencieusement contournée, et l'on croirait mesurer un cas
     qui n'a pas eu lieu. */
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  await contexte.addInitScript(SONDE);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
  await couperLePremierSync(page);

  await connecter(page);

  const echantillons = [];
  const debut = Date.now();
  while (Date.now() - debut < DUREE_MS) {
    try { echantillons.push(await page.evaluate(eval(LECTURE))); }
    catch { /* navigation en cours : l'échantillon suivant reprendra */ }
    await page.waitForTimeout(PAS_MS);
  }

  const journal = await page.evaluate(() => window.__journalSync || []);
  const verite = await veriteServeur(page);

  /* ── Le récit, dans l'ordre ── */
  const lignes = [
    ...journal.map(entree => ({
      t: entree.t,
      texte: entree.type === 'central-sync-status'
        ? `ÉVÉNEMENT central-sync-status state="${entree.detail?.state}" updatedAt=${entree.detail?.updatedAt ? `"${entree.detail.updatedAt}"` : 'ABSENT'}`
        : 'ÉVÉNEMENT central-catalog-installed'
    }))
  ];
  let precedent = null;
  for (const echantillon of echantillons) {
    if (!echantillon.present) continue;
    const empreinte = `${echantillon.chargement}|${echantillon.busy}|${echantillon.compte}`;
    if (empreinte === precedent) continue;
    precedent = empreinte;
    lignes.push({
      t: echantillon.t,
      texte: `BANDEAU chargement="${echantillon.chargement}" aria-busy="${echantillon.busy}" compte=${echantillon.compte ?? '—'} « ${echantillon.texte} »`
    });
  }
  lignes.sort((a, b) => a.t - b.t);
  for (const ligne of lignes) console.log(`   t=${String(ligne.t).padStart(6)} ms  ${ligne.texte}`);
  console.log(`   vérité serveur : ${verite.total} hors chaîne`);

  /* ── Le verdict ── */
  const definitifs = echantillons.filter(item => item.present && item.chargement === 'non' && item.compte !== null);
  const valeurs = [];
  for (const item of definitifs) if (valeurs[valeurs.length - 1] !== item.compte) valeurs.push(item.compte);
  const distinctes = [...new Set(valeurs)];

  verifier(`parcours ${numero} · aucune SECONDE valeur définitive pendant l’initialisation`,
    distinctes.length <= 1, `valeurs présentées comme définitives : ${valeurs.join(' → ')}`);
  verifier(`parcours ${numero} · la première valeur définitive est celle du serveur (${verite.total})`,
    distinctes.length === 0 || distinctes[0] === verite.total,
    `affiché ${distinctes[0]}, serveur ${verite.total}`);

  const premierStatutProuvant = journal.find(entree =>
    entree.type === 'central-sync-status' && entree.detail?.updatedAt);
  const premierDefinitif = definitifs[0];
  verifier(`parcours ${numero} · aucun chiffre définitif AVANT la preuve d’un snapshot appliqué`,
    !premierDefinitif || (premierStatutProuvant && premierDefinitif.t >= premierStatutProuvant.t - PAS_MS),
    premierStatutProuvant
      ? `chiffre à t=${premierDefinitif?.t} ms, preuve à t=${premierStatutProuvant.t} ms`
      : `chiffre à t=${premierDefinitif?.t} ms, AUCUNE preuve de snapshot dans tout le parcours`);

  const statutsPrecoces = journal.filter(entree =>
    entree.type === 'central-sync-status' && !entree.detail?.updatedAt);
  console.log(`   ↳ statuts SANS preuve de snapshot : ${statutsPrecoces.length}` +
    (statutsPrecoces.length ? ` (${[...new Set(statutsPrecoces.map(e => e.detail?.state))].join(', ')})` : ''));
  console.log(`   ↳ statuts AVEC preuve de snapshot : ${journal.filter(e => e.detail?.updatedAt).length}`);
  console.log(`   ↳ l’état « Synchronisation… » a-t-il été atteint : ${echantillons.some(e => e.attente) ? 'OUI' : 'NON'}`);

  verifier(`parcours ${numero} · aucune erreur JavaScript pendant la chronologie`,
    erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await contexte.close();
  return { valeurs, verite, journal, atteintAttente: echantillons.some(item => item.attente) };
}

/* ═══════════ PHASE B — le comportement de la garde, statut par statut ═══════════ */

/**
 * Les cinq cas sont joués dans un navigateur réel, sur le module réellement servi.
 *
 * `/api/sync` est coupé pour toute la phase : la synchronisation réelle ne peut donc
 * jamais conclure d'elle-même, et le seul événement porteur d'une preuve est celui que
 * l'épreuve émet. Sans cette coupure, on ne saurait pas ce qui a fait bouger le bandeau.
 */
async function comportementDesStatuts(navigateur) {
  console.log('\n━━━ Comportement de la garde — cinq statuts, cinq attentes ━━━');
  const CAS = [
    { nom: 'offline SANS updatedAt', detail: { state: 'offline', message: 'Modification conservée localement.' }, libere: false },
    { nom: 'warning SANS updatedAt', detail: { state: 'warning', message: 'Synchronisation en attente.' }, libere: false },
    { nom: 'conflict SANS updatedAt', detail: { state: 'conflict', message: 'Écriture périmée.' }, libere: false },
    { nom: 'unauthenticated SANS updatedAt', detail: { state: 'unauthenticated', message: 'Session expirée.' }, libere: false },
    { nom: 'synced AVEC updatedAt', detail: { state: 'synced', updatedAt: '2026-08-25T08:00:00.000Z' }, libere: true },
    { nom: 'warning AVEC updatedAt (queue rejetée)', detail: { state: 'warning', updatedAt: '2026-08-25T08:00:00.000Z' }, libere: true },
    { nom: 'offline AVEC updatedAt (queue restante)', detail: { state: 'offline', updatedAt: '2026-08-25T08:00:00.000Z' }, libere: true }
  ];

  for (const cas of CAS) {
    const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
    await contexte.addInitScript(SONDE);
    const page = await contexte.newPage();
    // La synchronisation réelle ne doit jamais conclure : le seul événement qui compte est le nôtre.
    await page.route('**/api/sync', route => route.abort());
    await page.route('**/api/sync/**', route => route.abort());
    await connecter(page);
    await page.waitForSelector('#signal-spine', { timeout: 60000 });
    await page.waitForTimeout(1500);

    const avant = await page.evaluate(eval(LECTURE));
    await page.evaluate(detail => {
      window.dispatchEvent(new CustomEvent('central-sync-status', { detail }));
    }, cas.detail);
    await page.waitForTimeout(2000);
    const apres = await page.evaluate(eval(LECTURE));

    verifier(`départ · ${cas.nom} — le bandeau attend AVANT l’événement`,
      avant.chargement === 'oui' && avant.busy === 'true' && avant.compte === null,
      JSON.stringify(avant));
    if (cas.libere) {
      verifier(`${cas.nom} → le compteur devient définitif`,
        apres.chargement === 'non' && apres.busy === 'false', JSON.stringify(apres));
    } else {
      verifier(`${cas.nom} → le bandeau RESTE en attente, aucun chiffre définitif`,
        apres.chargement === 'oui' && apres.busy === 'true' && apres.compte === null,
        JSON.stringify(apres));
    }
    await contexte.close();
  }
}

/* ────────────────────────────────── Exécution ────────────────────────────────── */

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

console.log(`\n╔═══ P0-4 · chronologie réelle de la synchronisation — ${BASE} ═══╗`);

try {
  const parcours = Number(process.env.UI_TIMELINE_RUNS || 1);
  for (let numero = 1; numero <= parcours; numero += 1) await chronologie(navigateur, numero);
  if (process.env.UI_TIMELINE_EVENTS !== '0') await comportementDesStatuts(navigateur);
} finally {
  await navigateur.close();
}

console.log(`\n╚═══ ${echecs === 0 ? '✅ VERT' : `❌ ${echecs} ÉCHEC(S)`} sur ${verifications} vérifications ═══╝\n`);
process.exit(echecs ? 1 : 0);
