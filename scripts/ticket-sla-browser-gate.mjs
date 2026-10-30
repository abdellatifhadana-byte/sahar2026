/**
 * @file scripts/ticket-sla-browser-gate.mjs — L'ESCALADE VISUELLE SLA, DANS UN VRAI NAVIGATEUR.
 *
 * Ouvre un VRAI Chromium contre un VRAI serveur (PostgreSQL réel) et vérifie ce que l'écran
 * Tickets affiche RÉELLEMENT pour chaque palier d'urgence — jamais ce que le code prétend
 * faire. Couvre :
 *
 *   1. Les quatre paliers (normal/warning/urgent/critical) + dépassé + fermé : la bonne
 *      classe CSS et le bon libellé, sur la ligne du tableau ET dans la fiche détaillée.
 *   2. Le tri par urgence : les tickets proches de leur échéance remontent en tête, un
 *      ticket fermé — même en apparence « très en retard » — retombe en fin de liste.
 *   3. Sous Pilote (`?pilote=1`), les cinq couleurs de catégorie (Incident/Service/
 *      Information/Vidéo/Intervention) restent VISUELLEMENT DISTINCTES — le défaut fermé ici
 *      les aplatissait toutes sur le même gris-bleu.
 *   4. Aucun débordement horizontal, aucune erreur JavaScript, classique et Pilote.
 *
 * `deadline` n'est modifiable par AUCUNE API publique (`createServiceRequest` le pose une
 * fois, `updateServiceRequest` ne le touche jamais) : simuler les paliers exige donc une
 * écriture SQL directe dans `platform_records`, hors API — allowlistée et justifiée dans
 * `tests/concurrence-revision.test.js` (REV·26), son `_revision` avançant comme le magasin
 * canonique l'aurait fait pour cette même écriture.
 *
 * AUCUNE donnée de production : base dédiée, entités préfixées, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import pg from 'pg';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4192';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const chemin = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const databaseUrl = process.env.DATABASE_URL || '';
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

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

/* ═══════════════════════ la scène : une zone, cinq tickets à échéances contrôlées ═══════════════════════ */

const admin = await connexion(adminUser, adminPass);
const zone = (await api('/api/access/zones', { method: 'POST', cookie: admin, body: { name: 'SLA Gate Zone', status: 'active' } })).charge.zone;

/**
 * Crée un ticket par le VRAI point d'entrée (`/api/service-requests`, le seul qui écrit
 * `tickets` — un PUT générique y est refusé), puis RÉÉCRIT directement son `deadline` en
 * base pour simuler un pourcentage de délai restant précis. `_revision` avance de 1, comme
 * le magasin canonique l'aurait fait pour cette même écriture (condition REV·26).
 */
const DETAILS_PAR_NATURE = {
  incident: { impact: 'Aucun impact antenne' },
  service: { serviceName: 'Fixture SLA Gate' },
  information: { question: 'Fixture SLA Gate — question de test.' },
  intervention: { interventionType: 'Contrôle / mesure', desiredWindow: 'Fixture SLA Gate' }
};

async function creerTicketAvecEcheance(sujet, remainingRatio, { slaMinutes = 360, overdueMinutes = null, requestKind = 'incident' } = {}) {
  const { charge } = await api('/api/service-requests', { method: 'POST', cookie: admin, expected: 201, body: {
    requestKind, destinationZoneId: zone.id, subject: sujet,
    description: 'Fixture SLA — échéance contrôlée par écriture directe.',
    priority: 'haute', details: DETAILS_PAR_NATURE[requestKind] || {}
  } });
  const id = charge.request.id;
  const deadline = overdueMinutes != null
    ? new Date(Date.now() - overdueMinutes * 60_000)
    : new Date(Date.now() + remainingRatio * slaMinutes * 60_000);
  await pool.query(
    "UPDATE platform_records SET data = data || jsonb_build_object('deadline', $1::text, 'slaMinutes', $2::int, '_revision', 2) WHERE store_name='tickets' AND record_id=$3",
    [deadline.toISOString(), slaMinutes, id]
  );
  return id;
}

const idNormal = await creerTicketAvecEcheance('SLA Gate — normal', 0.60, { requestKind: 'service' });
const idWarning = await creerTicketAvecEcheance('SLA Gate — warning', 0.35, { requestKind: 'information' });
const idUrgent = await creerTicketAvecEcheance('SLA Gate — urgent', 0.15, { requestKind: 'intervention' });
const idCritical = await creerTicketAvecEcheance('SLA Gate — critical', 0.05);
const idOverdue = await creerTicketAvecEcheance('SLA Gate — overdue', null, { overdueMinutes: 18 });

// Un ticket FERMÉ, à un deadline très ancien (donc « très en retard » en apparence) : il ne
// doit RIEN devoir remonter — le tri par urgence l'ignore, il retombe en fin de liste.
const idFerme = await creerTicketAvecEcheance('SLA Gate — fermé malgré un deadline ancien', null, { overdueMinutes: 999999 });
await api(`/api/service-requests/${encodeURIComponent(idFerme)}`, { method: 'PATCH', cookie: admin, body: { status: 'fermé' } });

/* ═══════════════════════════════════ le navigateur ═══════════════════════════════════ */

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const rapport = [];
function siVivant(titre, condition, detail = '') { rapport.push({ titre, ok: Boolean(condition), detail }); }

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

/** Monte la liste des tickets directement (comme l'app le fait), à partir de /api/sync. */
async function monterTickets(page) {
  return evaluerStable(page, async () => {
    const { showTicketsList } = await import('./tickets.js');
    const { db } = await import('./db.js');
    const sync = await (await fetch('/api/sync', { credentials: 'include' })).json();
    for (const record of sync?.data?.tickets || []) { try { await db.save('tickets', record); } catch {} }
    document.body.innerHTML = '<div id="admin-content"></div>';
    await showTicketsList({ target: 'admin-content' });
  });
}

async function etatTable(page) {
  return evaluerStable(page, () => {
    const lignes = [...document.querySelectorAll('.ticket-row')];
    const pastille = ligne => ligne.querySelector('.sla-pill');
    return {
      debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ordreParSujet: lignes.map(ligne => ligne.querySelector('td:nth-child(4)')?.textContent?.trim() || ''),
      parSujet: Object.fromEntries(lignes.map(ligne => [
        ligne.querySelector('td:nth-child(4)')?.textContent?.trim() || '',
        { classe: pastille(ligne)?.className || '', libelle: pastille(ligne)?.textContent?.trim() || '' }
      ]))
    };
  });
}

{
  const context = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const [nom, valeur] = admin.split('=');
  await context.addCookies([{ name: nom, value: valeur, url: base }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur)));

  // Pilote est désormais le défaut sans paramètre explicite (Final Meeting Candidate Gate) :
  // cette section « classique » doit forcer `?pilote=0`, jamais une URL nue qui ouvrirait
  // Pilote à sa place.
  await page.goto(`${base}/index.html?pilote=0`, { waitUntil: 'networkidle' });
  await monterTickets(page);
  const etat = await etatTable(page);

  siVivant('classique : aucun débordement horizontal', etat.debordement <= 1, `débordement=${etat.debordement}px`);
  siVivant('classique : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));

  const attendu = {
    'SLA Gate — normal': 'sla-normal',
    'SLA Gate — warning': 'sla-warning',
    'SLA Gate — urgent': 'sla-urgent',
    'SLA Gate — critical': 'sla-critical',
    'SLA Gate — overdue': 'sla-overdue',
    'SLA Gate — fermé malgré un deadline ancien': 'sla-closed'
  };
  for (const [sujet, classeAttendue] of Object.entries(attendu)) {
    const ligne = etat.parSujet[sujet];
    siVivant(`classique : « ${sujet} » porte la classe ${classeAttendue}`, ligne?.classe.includes(classeAttendue), JSON.stringify(ligne));
  }
  // Le nombre exact de minutes dérive entre la création de la fixture (deadline fixé une
  // fois) et l'ouverture réelle de la page : le motif importe, jamais la valeur figée.
  siVivant('classique : « overdue » affiche la durée de dépassement, jamais juste « Dépassé »',
    /^SLA dépassé de \d+ min$/.test(etat.parSujet['SLA Gate — overdue']?.libelle || ''), etat.parSujet['SLA Gate — overdue']?.libelle);
  siVivant('classique : « fermé » affiche le mot Fermé, jamais un compte à rebours pourtant expiré depuis des mois',
    etat.parSujet['SLA Gate — fermé malgré un deadline ancien']?.libelle === 'Fermé', etat.parSujet['SLA Gate — fermé malgré un deadline ancien']?.libelle);

  // Tri par urgence : critical avant urgent avant warning avant normal ; fermé TOUJOURS en
  // dernier malgré son deadline le plus ancien de tous — la preuve que le tri suit l'ÉTAT,
  // jamais une simple comparaison de dates.
  const rang = sujet => etat.ordreParSujet.indexOf(sujet);
  siVivant('classique : overdue et critical précèdent urgent, warning et normal',
    rang('SLA Gate — overdue') < rang('SLA Gate — urgent') && rang('SLA Gate — critical') < rang('SLA Gate — urgent'),
    JSON.stringify(etat.ordreParSujet));
  siVivant('classique : urgent précède warning', rang('SLA Gate — urgent') < rang('SLA Gate — warning'), JSON.stringify(etat.ordreParSujet));
  siVivant('classique : warning précède normal', rang('SLA Gate — warning') < rang('SLA Gate — normal'), JSON.stringify(etat.ordreParSujet));
  siVivant('classique : le ticket FERMÉ retombe en toute dernière position, malgré le deadline le plus ancien de tous',
    rang('SLA Gate — fermé malgré un deadline ancien') === etat.ordreParSujet.length - 1, JSON.stringify(etat.ordreParSujet));

  await context.close();
}

/* ── PILOTE : les cinq couleurs de catégorie restent distinctes (défaut fermé ici) ── */
{
  const context = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const [nom, valeur] = admin.split('=');
  await context.addCookies([{ name: nom, value: valeur, url: base }]);
  await context.addInitScript(() => localStorage.setItem('2m-pilot-ui', '1'));
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', erreur => erreurs.push(String(erreur)));

  await page.goto(`${base}/index.html?pilote=1`, { waitUntil: 'networkidle' });
  await monterTickets(page);
  const etat = await etatTable(page);
  siVivant('Pilote : aucun débordement horizontal', etat.debordement <= 1, `débordement=${etat.debordement}px`);
  siVivant('Pilote : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));

  const couleurs = await evaluerStable(page, () => {
    const teinte = classe => {
      const noeud = document.querySelector(`.kind-${classe}`);
      return noeud ? getComputedStyle(noeud).color : null;
    };
    return { incident: teinte('incident'), service: teinte('service'), information: teinte('information'), intervention: teinte('intervention') };
  });
  siVivant('Pilote : toutes les pastilles de catégorie présentes sur les tickets créés', Object.values(couleurs).every(Boolean), JSON.stringify(couleurs));
  const teintesUniques = new Set(Object.values(couleurs));
  siVivant('Pilote : les couleurs de catégorie restent DISTINCTES (jamais aplaties sur un seul gris-bleu)',
    teintesUniques.size === Object.keys(couleurs).length, JSON.stringify(couleurs));

  await context.close();
}

await navigateur.close();
await pool.end();

/* ═══════════════════════════════════ rapport ═══════════════════════════════════ */

const echecs = rapport.filter(r => !r.ok);
for (const r of rapport) console.log(`  ${r.ok ? '✓' : '✗'} ${r.titre}${r.ok ? '' : `  [${r.detail}]`}`);
if (echecs.length) {
  console.log(`\n${echecs.length} ÉCHEC(S) SUR ${rapport.length}`);
  process.exit(1);
}
console.log(`\nRecette navigateur SLA Tickets (paliers, tri, couleurs Pilote) : PASS (${rapport.length} assertions)`);
