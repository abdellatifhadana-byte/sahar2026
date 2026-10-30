/**
 * @file scripts/grille-revocation-gate.mjs — le GATEWAY CLIENT est-il une autorité ? (#137)
 *
 * CE QUE CETTE ÉPREUVE AJOUTE À `bundle-leak-e2e.mjs`
 * ---------------------------------------------------
 * L'autre épreuve interroge l'endpoint directement : elle prouve que le serveur décide bien.
 * Elle ne dit RIEN de ce que le navigateur fait de la réponse — et c'est exactement là que
 * le défaut se trouvait.
 *
 * Mesuré sur c24d724, dans le même onglet, sans déconnexion ni rechargement :
 *
 *     A ouvre la fiche 360        → 200, 374 ports en mémoire
 *     B révoque les habilitations → le serveur refuse la session de A (403 vérifié)
 *     A rouvre la fiche 360       → AUCUNE requête, 374 ports TOUJOURS en mémoire
 *
 * `grille-centrale-dataset.js` gardait le jeu de données tant que `${id}:${authVersion}` ne
 * bougeait pas, en affirmant qu'une révocation changeait cette version. `revokeGrant()` ne
 * l'a jamais touchée : il écrit `status:'revoked'` sur l'habilitation, rien de plus.
 *
 * PUIS, sur ed82fcd, une seconde course a été trouvée avant PR. La déduplication des dix
 * revalidations d'une même ouverture se faisait par une FENÊTRE DE DEUX SECONDES. Or deux
 * secondes ne distinguent pas « le même écran qui finit de se composer » de « un nouvel
 * écran ouvert tout de suite après ». Mesuré :
 *
 *     ouverture              → 200, 374 ports
 *     révocation à t+63 ms
 *     réouverture à t+146 ms → AUCUNE requête, 374 ports toujours exploitables
 *
 * Le regroupement se fait désormais par JETON D'OUVERTURE, attaché à l'instance de surface.
 *
 * Cette épreuve doit donc ÉCHOUER sur c24d724 et sur ed82fcd, et PASSER sur la correction.
 *
 * Prérequis :
 *   PORT=4188 DATABASE_URL=… npm start &
 *   node scripts/grille-revocation-gate.mjs
 *
 * Comptes (par variables d'environnement) : un administrateur, et un technicien habilité sur
 * la zone qui porte la Grille Centrale.
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const ENDPOINT = '/api/operational/grille-centrale/documented-map';
const EQUIPEMENT = process.env.E2E_GRILLE_EQUIPMENT_ID || '9202';
const ZONE = process.env.E2E_GRILLE_ZONE || 'zone-acquisition-stc';
const SUJET = Number(process.env.E2E_GRILLE_USER_ID || 9301);

const compte = (u, p) => ({ username: process.env[u] || '', password: process.env[p] || '' });
const ADMIN = compte('E2E_ADMIN_USERNAME', 'E2E_ADMIN_PASSWORD');
const HABILITE = compte('E2E_GRILLE_USERNAME', 'E2E_GRILLE_PASSWORD');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function req(chemin, { method = 'GET', cookie = '', body } = {}) {
  const reponse = await fetch(BASE + chemin, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge; try { charge = JSON.parse(texte); } catch { charge = { texte }; }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}
const connexion = async ({ username, password }) => (await req('/api/auth/login', { method: 'POST', body: { username, password } })).cookie;

const PERMISSIONS = ['zone.summary.read', 'equipment.read', 'screen.read', 'cable.read', 'topology.read',
  'ticket.read', 'note.read', 'procedure.read', 'diagnostic.run', 'continuity.read', 'diagram.read'];

async function revoquer(admin) {
  const gestion = await req('/api/access/manage', { cookie: admin });
  const habilitations = (gestion.charge.grants || [])
    .filter(item => String(item.userId) === String(SUJET) && String(item.zoneId) === ZONE && item.status !== 'revoked');
  for (const item of habilitations) await req(`/api/access/grants/${encodeURIComponent(item.id)}`, { method: 'DELETE', cookie: admin });
  await req('/api/access/memberships', { method: 'POST', cookie: admin, body: { userId: SUJET, zoneId: ZONE, status: 'revoked' } });
  return habilitations.length;
}
async function accorder(admin) {
  for (const permission of PERMISSIONS) await req('/api/access/grants', { method: 'POST', cookie: admin, body: { userId: SUJET, zoneId: ZONE, permission } });
  await req('/api/access/memberships', { method: 'POST', cookie: admin, body: { userId: SUJET, zoneId: ZONE, status: 'active' } });
}

const resultats = [];
const controle = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: Boolean(ok) });
  console.log(`  ${ok ? 'OK  ' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const info = (nom, detail) => console.log(`  ·    ${nom}${detail ? ` — ${detail}` : ''}`);

const admin = await connexion(ADMIN);
await accorder(admin);

const navigateur = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await navigateur.newContext()).newPage();
const appels = [];
page.on('response', reponse => { if (reponse.url().includes('/operational/')) appels.push(reponse.status()); });
const marque = () => appels.length;
const depuis = n => appels.slice(n);

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ([u, p]) => {
  const reponse = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const charge = await reponse.json();
  if (charge.user) localStorage.setItem('auth', JSON.stringify(charge.user));
}, [HABILITE.username, HABILITE.password]);
await page.reload({ waitUntil: 'load' });
await sleep(20000);

/*
 * Ouvre la vraie fiche 360, puis appelle la vraie fonction de rendu.
 *
 * Deux précautions, dues à une course PRÉ-EXISTANTE que ce lot ne touche pas — la suite
 * Opérations recrée la modale pendant que les modules Grille la garnissent, et les autres
 * modules 360 y posent `equipmentId` de façon différée : une courte pause, puis jusqu'à
 * trois tentatives. `enhanceGrilleCentraleDocumentedMap360` est exactement la fonction que
 * l'observateur appelle, et celle qui porte le `revalidate:true` de ce correctif.
 */
async function ouvrir() {
  let etat = { plan: false, rangees: 0, rendu: 'modale-absente', modale: false };
  for (let essai = 0; essai < 3; essai += 1) {
    await page.evaluate(async id => {
      document.getElementById('ops-equipment-360')?.remove();
      await window.TechOperations.openEquipment360(Number(id) || id).catch(() => {});
    }, EQUIPEMENT);
    await sleep(1500);
    etat = await page.evaluate(async () => {
      const modal = document.getElementById('ops-equipment-360');
      if (!modal) return { plan: false, rangees: 0, rendu: 'modale-absente', modale: false };
      delete modal.dataset.gcDocumentedMap;
      delete modal.dataset.gcDocumentedMapBusy;
      const module = await import('/grille-centrale-documented-map.js');
      const rendu = await module.enhanceGrilleCentraleDocumentedMap360(modal).catch(erreur => `ERREUR:${erreur.message}`);
      return {
        plan: Boolean(modal.querySelector('.grille-centrale-documented-map-card')),
        rangees: modal.querySelectorAll('.gc-map-port').length,
        rendu, modale: true
      };
    });
    if (etat.modale && etat.rendu !== 'modale-absente') return etat;
  }
  return etat;
}
const enMemoire = () => page.evaluate(async () => {
  const module = await import('/grille-centrale-dataset.js');
  const jeu = module.peekGrilleCentraleDataset();
  return jeu ? jeu.documentedPorts.length : 0;
});

console.log('\nTEST 1 · succès → révocation distante → réouverture dans le même onglet');
let n = marque();
let etat = await ouvrir();
controle('1a · l’habilité obtient le jeu de données', depuis(n).includes(200) && await enMemoire() === 374,
  `${depuis(n).join(',') || 'aucun appel'} · ${await enMemoire()} ports en mémoire`);
info('1b · rendu du panneau', JSON.stringify(etat));

const revoques = await revoquer(admin);
info('révocation par l’administrateur, depuis un autre poste', `${revoques} habilitation(s)`);
const sessionHabilite = await connexion(HABILITE);
controle('1c · le serveur refuse désormais cette session', (await req(ENDPOINT, { cookie: sessionHabilite })).statut === 403);

n = marque();
etat = await ouvrir();                       // ni logout, ni reload, ni forget()
const apres = depuis(n);
controle('1d · la réouverture reconsulte le serveur', apres.length >= 1, `${apres.length} appel(s) : ${apres.join(',') || 'AUCUN'}`);
controle('1e · le serveur a répondu 403', apres.includes(403), apres.join(',') || 'aucune réponse');
controle('1f · aucun panneau opérationnel', !etat.plan && etat.rangees === 0, JSON.stringify(etat));
controle('1g · la mémoire ne conserve plus l’ancien jeu de données', await enMemoire() === 0, `${await enMemoire()} ports`);
controle('1h · une ouverture = une requête, pas une rafale', apres.length <= 2, `${apres.length} appel(s)`);

console.log('\nTEST 2 · refus → octroi → rafraîchissement normal → réouverture même onglet');
await accorder(admin);
info('habilitations rendues par l’administrateur', 'sans déconnexion du bénéficiaire');
await sleep(24000);                          // un cycle de synchronisation ordinaire
n = marque();
etat = await ouvrir();
controle('2a · la réouverture obtient 200 sans reconnexion', depuis(n).includes(200), depuis(n).join(',') || 'aucun appel');
controle('2b · le jeu de données est de nouveau exploitable', await enMemoire() === 374, `${await enMemoire()} ports`);
if (etat.plan) controle('2c · le panneau est de nouveau affiché', etat.rangees === 374, JSON.stringify(etat));
else info('2c · panneau non rendu', `${etat.rendu} — écriture d’équipement refusée par le serveur ; défaut PRÉ-EXISTANT identique sur main@8f51238d, relève de #140`);

/*
 * Une « ouverture » au sens du jeton : une NOUVELLE instance de surface, puis le rendu réel.
 * Les observateurs des quatre modules se déclenchent à l'insertion et posent leur drapeau
 * `busy` ; on les efface juste avant d'appeler, sinon on mesurerait la course pré-existante
 * de la modale plutôt que l'autorisation.
 */
async function ouvertureNeuve() {
  return page.evaluate(async id => {
    document.getElementById('ops-equipment-360')?.remove();
    const modal = document.createElement('div');
    modal.id = 'ops-equipment-360';
    modal.className = 'ops-modal';
    modal.dataset.equipmentId = String(id);
    modal.innerHTML = '<div class="ops-modal-card"><div class="ops-modal-head"><div><strong>Fiche technique 360°</strong><div>GRILLE CENTRALE</div></div></div><div class="ops-modal-body ops-360-grid"><div style="display:grid"></div></div></div>';
    document.body.appendChild(modal);
    await new Promise(resolve => setTimeout(resolve, 250));
    delete modal.dataset.gcDocumentedMap;
    delete modal.dataset.gcDocumentedMapBusy;
    const module = await import('/grille-centrale-documented-map.js');
    const rendu = await module.enhanceGrilleCentraleDocumentedMap360(modal).catch(erreur => `ERREUR:${erreur.message}`);
    return { rendu, rangees: modal.querySelectorAll('.gc-map-port').length };
  }, EQUIPEMENT);
}

console.log('\nTOKEN-1 · une seule ouverture, quatre modules, plusieurs observateurs');
{
  const jetons = await page.evaluate(async () => {
    const module = await import('/grille-centrale-dataset.js');
    const a = document.createElement('div');
    const b = document.createElement('div');
    return { memeElement: module.jetonDOuverture(a) === module.jetonDOuverture(a), elementsDifferents: module.jetonDOuverture(a) !== module.jetonDOuverture(b) };
  });
  controle('1i · un jeton par instance de surface, stable', jetons.memeElement && jetons.elementsDifferents, JSON.stringify(jetons));
  n = marque();
  await page.evaluate(async id => {
    const modal = document.getElementById('ops-equipment-360') || document.body;
    const modules = await Promise.all([
      import('/grille-centrale-documented-map.js'), import('/grille-centrale-topology.js'),
      import('/grille-centrale-physical-architecture.js'), import('/grille-centrale-field-verification.js'),
      import('/grille-centrale-dataset.js')
    ]);
    const ouverture = modules[4].jetonDOuverture(modal);
    await Promise.all([
      modules[0].ensureGrilleCentraleDocumentedMap({ revalidate: true, ouverture }),
      modules[1].ensureGrilleCentraleTopology({ revalidate: true, ouverture }),
      modules[2].ensureGrilleCentralePhysicalArchitecture({ revalidate: true, ouverture }),
      modules[3].ensureGrilleCentraleFieldVerification({ revalidate: true, ouverture })
    ].map(promesse => promesse.catch(() => null)));
    // puis, en différé, comme le font les observateurs
    for (const attente of [120, 400]) {
      await new Promise(resolve => setTimeout(resolve, attente));
      await modules[0].ensureGrilleCentraleDocumentedMap({ revalidate: true, ouverture }).catch(() => null);
    }
  }, EQUIPEMENT);
  controle('1j · une ouverture = une décision serveur', depuis(n).length <= 1, `${depuis(n).length} appel(s)`);
}

console.log('\nTOKEN-2 · deux ouvertures rapprochées, permissions inchangées');
{
  n = marque(); await ouvertureNeuve(); const premiere = depuis(n);
  await sleep(300);                              // bien en deçà de l'ancienne fenêtre de 2 s
  n = marque(); await ouvertureNeuve(); const seconde = depuis(n);
  controle('2d · la 1re ouverture consulte le serveur', premiere.length >= 1, premiere.join(',') || 'AUCUN');
  controle('2e · la 2nde ouverture consulte AUSSI le serveur', seconde.length >= 1,
    seconde.join(',') || 'AUCUN — une ouverture réutilise la décision de la précédente');
}

console.log('\nTOKEN-3 · révocation en moins de 500 ms, puis réouverture immédiate');
{
  await accorder(admin); await sleep(24000);
  n = marque();
  const premiere = await ouvertureNeuve();
  const debut = Date.now();
  /*
   * Ce que #137 possède : le serveur a tranché et le jeu de données est là. Le RENDU, lui,
   * dépend d'une écriture d'équipement que le serveur refuse à un rôle en lecture seule —
   * défaut pré-existant, identique sur main@8f51238d, relève de #140. On mesure les deux,
   * on n'en fait échouer qu'un.
   */
  controle('3g · la 1re ouverture obtient le jeu de données', depuis(n).includes(200) && await enMemoire() === 374,
    `${depuis(n).join(',') || 'aucun appel'} · ${await enMemoire()} ports`);
  if (premiere.rangees >= 374) controle('3g bis · le panneau est rendu', true, `${premiere.rangees} rangées`);
  else info('3g bis · panneau non rendu', `${premiere.rangees} rangées — défaut pré-existant, #140`);
  await revoquer(admin);
  info('révocation distante', `à t+${Date.now() - debut} ms`);
  controle('3h · le serveur refuse déjà cette session', (await req(ENDPOINT, { cookie: await connexion(HABILITE) })).statut === 403);
  n = marque();
  const seconde = await ouvertureNeuve();
  info('réouverture', `à t+${Date.now() - debut} ms`);
  controle('3i · la réouverture consulte le serveur', depuis(n).length >= 1, depuis(n).join(',') || 'AUCUN');
  controle('3j · le serveur a répondu 403', depuis(n).includes(403), depuis(n).join(',') || 'aucune réponse');
  controle('3k · aucun panneau opérationnel', seconde.rangees === 0, `${seconde.rangees} rangées`);
  controle('3l · la mémoire ne sert plus', await enMemoire() === 0, `${await enMemoire()} ports`);
}

console.log('\nTOKEN-4 · refus → octroi → nouvelle ouverture, sans déconnexion');
{
  await accorder(admin); await sleep(24000);
  n = marque();
  await ouvertureNeuve();
  controle('4a · la nouvelle ouverture obtient 200', depuis(n).includes(200), depuis(n).join(',') || 'aucun appel');
  controle('4b · le jeu de données est de nouveau exploitable', await enMemoire() === 374, `${await enMemoire()} ports`);
}

console.log('\nTEST 5 · session autorisée au repos (70 s)');
n = marque();
await sleep(70000);
controle('5a · aucune boucle de requêtes au repos', depuis(n).length <= 4, `${depuis(n).length} appel(s) en 70 s`);

console.log('\nTEST 7 · revalidation impossible → fermeture, pas de repli');
await page.evaluate(() => {
  // Le serveur devient injoignable pour cette route : la revalidation échoue.
  window.__fetchOriginal = window.fetch.bind(window);
  window.fetch = async (chemin, ...reste) => (String(chemin).includes('/api/operational/')
    ? Promise.reject(new TypeError('réseau coupé'))
    : window.__fetchOriginal(chemin, ...reste));
});
const horsLigne = await page.evaluate(async () => {
  const module = await import('/grille-centrale-dataset.js');
  const jeu = await module.loadGrilleCentraleDataset({ revalidate: true });
  return { jeu: jeu ? jeu.documentedPorts.length : 0, memoire: module.peekGrilleCentraleDataset() ? 'présente' : 'vide' };
});
controle('7a · aucun jeu de données rendu quand la revalidation échoue', horsLigne.jeu === 0, `${horsLigne.jeu} ports`);
controle('7b · la mémoire ne sert pas d’autorisation de secours', horsLigne.memoire === 'vide', horsLigne.memoire);

console.log('\nTEST 6 · déconnexion');
await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); localStorage.removeItem('auth'); });
controle('6a · la mémoire est oubliée à la déconnexion', await enMemoire() === 0, `${await enMemoire()} ports`);

await navigateur.close();
const echecs = resultats.filter(resultat => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error('ÉCHECS : ' + echecs.map(resultat => resultat.nom).join(' | '));
  process.exit(1);
}
