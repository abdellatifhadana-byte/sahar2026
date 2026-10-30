/**
 * @file scripts/syncqueue-credential-browser-gate.mjs — B-4 : AUCUN MAGASIN LOCAL NE GARDE UN SECRET.
 *
 * CE QUI A ÉTÉ MESURÉ
 * -------------------
 * `index.html` charge `central-sync.js` (ligne 58) AVANT `credential-cache-guard.js`
 * (ligne 66). Le garde enveloppe donc la sauvegarde de la synchronisation, et non
 * l'inverse : il appelle `previousSave()` — qui a DÉJÀ recopié la fiche complète dans
 * `syncQueue` — puis nettoie le seul magasin `users`.
 *
 * Résultat mesuré sur `d9739797` : le magasin `users` est propre, et `syncQueue.data`
 * porte `password`. Or `db.hashPassword()` est `btoa(...)` : la valeur se relit en clair
 * avec `atob`. Une entrée `conflict`/`failed` est TERMINALE — plus aucune reprise ne la
 * réclame — donc le secret dort dans le navigateur sans échéance.
 *
 * CE QUE CETTE ÉPREUVE VÉRIFIE — SUR UN VRAI NAVIGATEUR, UNE VRAIE IndexedDB
 * --------------------------------------------------------------------------
 *   1. Création d'utilisateur hors ligne par le VRAI formulaire : rien de secret nulle part.
 *   2. Réinitialisation de mot de passe hors ligne : refus explicite, aucune fausse réussite.
 *   3. Modification NON sensible hors ligne : la file reste ouverte, et sans secret.
 *   4. Refus définitif du serveur : l'entrée terminale ne porte aucun secret.
 *   5. Lignes HÉRITÉES déjà présentes : neutralisées au démarrage, AVANT toute reprise.
 *   6. Rechargement complet : aucun champ secret ne réapparaît.
 *   7. Changement de mot de passe EN LIGNE : le serveur hache, le local ne garde rien.
 *
 * AUCUNE donnée de production : base dédiée, comptes préfixés, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4192';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const chemin = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Les champs que le contrat interdit de conserver dans un magasin persistant du navigateur.
const CHAMPS_SECRETS = ['password', 'passwordHash', 'passwordScheme'];
const MOT_DE_PASSE = 'Verrou-Local-Atelier-2026!';

async function api(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const reponse = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null) assert.equal(reponse.status, expected, `${method} ${path} : attendu ${expected}, reçu ${reponse.status} ${texte}`);
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return cookie;
};

const admin = await connexion(adminUser, adminPass);

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const rapport = [];
function verifier(titre, condition, detail = '') { rapport.push({ titre, ok: Boolean(condition), detail }); }

const context = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const [nomCookie, valeurCookie] = admin.split('=');
await context.addCookies([{ name: nomCookie, value: valeurCookie, url: base }]);
const page = await context.newPage();
const messages = [];
page.on('console', m => messages.push(m.text()));

/*
 * UNE VRAIE OUVERTURE DE SESSION.
 *
 * `central-sync.js` ne synchronise que si `localStorage.auth` existe
 * (`hasAuthenticatedIdentity`). Poser le seul cookie ne suffit donc pas : sans session
 * locale, AUCUNE mise en file n'a lieu et l'épreuve passerait au vert sans rien prouver.
 * On ouvre la session par `auth.js`, comme l'opérateur.
 */
async function ouvrirSession(page) {
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const ouverte = await page.evaluate(async ({ username, password }) => {
    const { default: Auth } = await import('./auth.js');
    try { await new Auth().login(username, password); }
    catch (erreur) { return { ok: false, message: String(erreur?.message || erreur) }; }
    return { ok: Boolean(localStorage.getItem('auth')) };
  }, { username: adminUser, password: adminPass });
  assert.ok(ouverte.ok, `session non ouverte dans le navigateur : ${ouverte.message || ''}`);
  await page.waitForTimeout(800);
}

await ouvrirSession(page);

/*
 * Le VRAI formulaire, la VRAIE soumission.
 *
 * `users.js` lit ses valeurs dans le DOM (`handleFormSubmit`). Rendre le module puis
 * remplir ses champs exerce donc la chaîne complète — politique de mot de passe,
 * `db.hashPassword`, `db.save` enveloppé deux fois — et non une charge fabriquée ici.
 */
async function soumettreFormulaireUtilisateur(page, champs) {
  return page.evaluate(async (champs) => {
    const { default: Users } = await import('./users.js');
    const recus = [];
    const module = new Users({ showNotification: (message, type) => recus.push({ message, type }) });
    let hote = document.getElementById('admin-content');
    if (!hote) { hote = document.createElement('div'); hote.id = 'admin-content'; document.body.appendChild(hote); }
    hote.innerHTML = await module.render();
    await module.afterRender();
    const poser = (id, valeur) => { const champ = document.getElementById(id); if (champ) champ.value = valeur; };
    poser('user-id', champs.userId ?? '');
    poser('username', champs.username ?? '');
    poser('full-name', champs.fullName ?? '');
    poser('role', champs.role ?? 'technicien');
    poser('status', champs.status ?? 'active');
    poser('password', champs.password ?? '');
    try { await module.handleFormSubmit(); } catch (erreur) { recus.push({ message: String(erreur?.message || erreur), type: 'error' }); }
    return recus;
  }, champs);
}

// Lecture BRUTE des magasins : on ouvre la base par IndexedDB, sans passer par `db`,
// pour que rien du code applicatif ne puisse filtrer ce qui est réellement sur le disque.
async function lireMagasinsBruts(page) {
  return page.evaluate(async () => {
    const base = await new Promise((resolve, reject) => {
      const requete = indexedDB.open('tech_platform_db');
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
    });
    const lire = nom => new Promise((resolve) => {
      if (!base.objectStoreNames.contains(nom)) return resolve([]);
      const requete = base.transaction(nom, 'readonly').objectStore(nom).getAll();
      requete.onsuccess = () => resolve(requete.result || []);
      requete.onerror = () => resolve([]);
    });
    const resultat = { users: await lire('users'), syncQueue: await lire('syncQueue') };
    base.close();
    return resultat;
  });
}

/*
 * TOUS les magasins de la vraie base, énumérés depuis la base elle-même.
 *
 * L'invariant ne dit pas « `users` et `syncQueue` » mais « aucun magasin persistant ».
 * Une lecture limitée à deux magasins prouvait la moitié de ce qu'elle annonçait — c'est
 * exactement ce qui a laissé passer B4-R4.
 */
async function lireTousLesMagasins(page) {
  return page.evaluate(async () => {
    const base = await new Promise((resolve, reject) => {
      const requete = indexedDB.open('tech_platform_db');
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
    });
    const noms = Array.from(base.objectStoreNames);
    const resultat = {};
    for (const nom of noms) {
      resultat[nom] = await new Promise(resolve => {
        const requete = base.transaction(nom, 'readonly').objectStore(nom).getAll();
        requete.onsuccess = () => resolve(requete.result || []);
        requete.onerror = () => resolve([]);
      });
    }
    base.close();
    return resultat;
  });
}

// Toute occurrence d'un champ secret, à N'IMPORTE QUELLE profondeur de la fiche.
function champsSecretsTrouves(valeur, chemin = '') {
  const trouves = [];
  if (Array.isArray(valeur)) {
    valeur.forEach((element, index) => trouves.push(...champsSecretsTrouves(element, `${chemin}[${index}]`)));
    return trouves;
  }
  if (valeur && typeof valeur === 'object') {
    for (const [cle, sousValeur] of Object.entries(valeur)) {
      const sousChemin = chemin ? `${chemin}.${cle}` : cle;
      if (CHAMPS_SECRETS.includes(cle) && sousValeur !== undefined) trouves.push({ chemin: sousChemin, valeur: sousValeur });
      trouves.push(...champsSecretsTrouves(sousValeur, sousChemin));
    }
  }
  return trouves;
}

const secretsDansMagasins = etat => ({
  users: etat.users.flatMap(fiche => champsSecretsTrouves(fiche, `users#${fiche.id}`)),
  syncQueue: etat.syncQueue.flatMap(entree => champsSecretsTrouves(entree, `syncQueue#${entree.id}`))
});

/* ═════════ 1 — CRÉATION HORS LIGNE PAR LE VRAI FORMULAIRE ═════════ */
await context.setOffline(true);

/*
 * TÉMOIN D'ARMEMENT.
 *
 * Une écriture ordinaire, non sensible, posée dans la MÊME fenêtre hors ligne. Si elle
 * n'atterrit pas dans la file, c'est que la mise en file n'est pas armée du tout — et
 * l'absence de secret qui suit ne prouverait alors rien. Mesuré : sans ce témoin, la
 * section passait au vert par accident quand `remoteReady` n'était pas encore établi.
 */
const temoin = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  await db.save('rooms', { id: 'b4-temoin-hors-ligne', name: 'Témoin hors ligne B4' });
  await new Promise(resolve => setTimeout(resolve, 400));
  return (await db.getAll('syncQueue')).some(entree => String(entree.entityId) === 'b4-temoin-hors-ligne');
});
verifier('1.pre — la mise en file hors ligne est bien armée (sinon la section 1 ne prouve rien)',
  temoin === true, 'aucune entrée de file pour l’écriture témoin');

const creation = await soumettreFormulaireUtilisateur(page, {
  username: 'b4-technicien', fullName: 'Technicien Atelier', role: 'technicien', status: 'active', password: MOT_DE_PASSE
});
await page.waitForTimeout(600);
let etat = await lireMagasinsBruts(page);
let secrets = secretsDansMagasins(etat);

verifier('1.a — magasin `users` sans champ secret après création hors ligne',
  secrets.users.length === 0, JSON.stringify(secrets.users));
verifier('1.b — `syncQueue` sans champ secret après création hors ligne',
  secrets.syncQueue.length === 0, JSON.stringify(secrets.syncQueue));

// La preuve de réversibilité : si une valeur subsiste, elle se relit en clair.
const reversible = [...secrets.users, ...secrets.syncQueue].filter(item => {
  try { return Buffer.from(String(item.valeur), 'base64').toString('utf8') === MOT_DE_PASSE; }
  catch { return false; }
});
verifier('1.c — aucune valeur persistée ne se redéchiffre en clair par base64',
  reversible.length === 0, JSON.stringify(reversible.map(x => x.chemin)));

verifier('1.d — la création hors ligne d’un compte AVEC mot de passe ne s’annonce pas réussie',
  !creation.some(n => n.type === 'success'), JSON.stringify(creation));
verifier('1.e — l’opérateur reçoit un message explicite de reprise en ligne',
  creation.some(n => n.type === 'error' && /ligne|connect/i.test(n.message)), JSON.stringify(creation));

/* ═════════ 2 — RÉINITIALISATION HORS LIGNE ═════════ */
// Un compte préexistant, posé EN LIGNE par le serveur, que l'on tentera de réinitialiser hors ligne.
await context.setOffline(false);
await api('/api/data/users/7401', { method: 'PUT', cookie: admin, expected: 200, body: {
  id: 7401, username: 'b4-rotation', fullName: 'Poste Rotation', role: 'technicien', status: 'active',
  password: Buffer.from('Poste-Initial-Verrou-2026!', 'utf8').toString('base64')
} });
await ouvrirSession(page);
await page.waitForTimeout(400);
await context.setOffline(true);

const reinit = await page.evaluate(async () => {
  const { default: Users } = await import('./users.js');
  const recus = [];
  const module = new Users({ showNotification: (message, type) => recus.push({ message, type }) });
  let hote = document.getElementById('admin-content');
  if (!hote) { hote = document.createElement('div'); hote.id = 'admin-content'; document.body.appendChild(hote); }
  hote.innerHTML = await module.render();
  await module.afterRender();
  const bouton = document.querySelector('tr[data-user-id="7401"] .reset-password');
  if (!bouton) return { absent: true, recus };
  bouton.click();
  await new Promise(resolve => setTimeout(resolve, 700));
  return { absent: false, recus };
});
await page.waitForTimeout(600);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);

verifier('2.a — le bouton de réinitialisation est bien présent (sinon l’épreuve ne prouve rien)',
  reinit.absent === false, JSON.stringify(reinit));
verifier('2.b — réinitialisation hors ligne : aucun champ secret dans `users` ni `syncQueue`',
  secrets.users.length === 0 && secrets.syncQueue.length === 0,
  JSON.stringify([...secrets.users, ...secrets.syncQueue]));
verifier('2.c — réinitialisation hors ligne : aucune annonce de réussite',
  !reinit.recus.some(n => n.type === 'success'), JSON.stringify(reinit.recus));
verifier('2.d — réinitialisation hors ligne : le mot de passe généré n’est pas affiché comme actif',
  !reinit.recus.some(n => /réinitialisé\s*:/i.test(n.message)), JSON.stringify(reinit.recus));

/* ═════════ 3 — MODIFICATION NON SENSIBLE HORS LIGNE : LA FILE RESTE OUVERTE ═════════ */
const profil = await soumettreFormulaireUtilisateur(page, {
  userId: '7401', username: 'b4-rotation', fullName: 'Poste Rotation Renomme', role: 'technicien', status: 'active', password: ''
});
await page.waitForTimeout(600);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);
const entreeProfil = etat.syncQueue.find(entree => entree.storeName === 'users' && String(entree.entityId) === '7401');

verifier('3.a — une modification non sensible hors ligne est bien mise en file',
  Boolean(entreeProfil), JSON.stringify(etat.syncQueue.map(e => ({ id: e.id, store: e.storeName, entityId: e.entityId, status: e.status }))));
verifier('3.b — cette entrée porte bien la modification demandée',
  entreeProfil?.data?.fullName === 'Poste Rotation Renomme', JSON.stringify(entreeProfil?.data || null));
verifier('3.c — cette entrée ne porte aucun champ secret',
  secrets.syncQueue.length === 0, JSON.stringify(secrets.syncQueue));
verifier('3.d — la modification non sensible hors ligne est annoncée réussie',
  profil.some(n => n.type === 'success'), JSON.stringify(profil));

/* ═════════ 4 — REFUS DÉFINITIF : L’ENTRÉE TERMINALE NE PORTE AUCUN SECRET ═════════ */
// Le serveur refuse définitivement (409 STALE_WRITE) : `recordRejectedOperation` écrit
// une entrée `conflict`, terminale, que plus aucune reprise ne réclamera.
await context.setOffline(false);
// La session est rouverte : `remoteReady` repasse à vrai, sans quoi l'écriture partirait
// en file ORDINAIRE et l'épreuve ne dirait rien des entrées terminales.
await ouvrirSession(page);
const terminal = await page.evaluate(async (secret) => {
  const { db } = await import('./db.js');
  const vraiFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (String(url).includes('/api/data/users/')) {
      return { ok: false, status: 409, headers: { get: () => null },
        text: async () => JSON.stringify({ error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 9 }) };
    }
    return vraiFetch(url, options);
  };
  const recus = [];
  try {
    await db.save('users', { id: 7401, username: 'b4-rotation', fullName: 'Poste Rotation', role: 'technicien',
      status: 'active', password: db.hashPassword(secret) });
  } catch (erreur) { recus.push(String(erreur?.message || erreur)); }
  await new Promise(resolve => setTimeout(resolve, 500));
  window.fetch = vraiFetch;
  return recus;
}, MOT_DE_PASSE);
await page.waitForTimeout(400);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);
const terminales = etat.syncQueue.filter(e => ['conflict', 'failed'].includes(e.status));

verifier('4.pre — un refus définitif produit bien une entrée terminale (sinon l’épreuve ne prouve rien)',
  terminales.length > 0, JSON.stringify(etat.syncQueue.map(e => ({ id: e.id, store: e.storeName, status: e.status }))));
verifier('4.a — aucune entrée terminale ne porte de champ secret',
  terminales.flatMap(e => champsSecretsTrouves(e, `syncQueue#${e.id}`)).length === 0,
  JSON.stringify(terminales));
verifier('4.b — aucun champ secret nulle part après un refus définitif',
  secrets.users.length === 0 && secrets.syncQueue.length === 0,
  JSON.stringify([...secrets.users, ...secrets.syncQueue]));

/* ═════════ 5 — LIGNES HÉRITÉES : NEUTRALISÉES AU DÉMARRAGE, AVANT TOUTE REPRISE ═════════ */
// Ces lignes sont écrites DIRECTEMENT dans IndexedDB, sans passer par `db` : elles
// représentent ce qu'une version antérieure a déjà laissé sur le disque des postes.
await page.evaluate(async (secret) => {
  const encoder = valeur => btoa(unescape(encodeURIComponent(String(valeur))));
  const base = await new Promise((resolve, reject) => {
    const requete = indexedDB.open('tech_platform_db');
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  const ecrire = (nom, fiche) => new Promise((resolve, reject) => {
    const requete = base.transaction(nom, 'readwrite').objectStore(nom).put(fiche);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  for (const [index, statut] of ['pending', 'processing', 'conflict', 'failed'].entries()) {
    await ecrire('syncQueue', {
      id: 90100 + index, action: 'save', storeName: 'users', entityId: 7500 + index,
      status: statut, attempts: 1, timestamp: new Date().toISOString(),
      data: { id: 7500 + index, username: `b4-heritee-${statut}`, fullName: 'Héritée', role: 'technicien',
        status: 'active', password: encoder(secret), passwordHash: encoder(secret), passwordScheme: 'base64' }
    });
  }
  await ecrire('users', { id: 7599, username: 'b4-heritee-users', fullName: 'Héritée Users', role: 'technicien',
    status: 'active', password: encoder(secret), passwordHash: encoder(secret), passwordScheme: 'base64' });
  base.close();
}, MOT_DE_PASSE);

const avantRechargement = await lireMagasinsBruts(page);
const secretsAvant = secretsDansMagasins(avantRechargement);
verifier('5.a — les lignes héritées ont bien été posées (sinon l’épreuve ne prouve rien)',
  secretsAvant.syncQueue.length > 0 && secretsAvant.users.length > 0,
  `syncQueue=${secretsAvant.syncQueue.length} users=${secretsAvant.users.length}`);

/* ═════════ 6 — RECHARGEMENT COMPLET : RIEN NE RÉAPPARAÎT, RIEN NE SURVIT ═════════ */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);

verifier('6.a — après rechargement, `users` ne porte aucun champ secret',
  secrets.users.length === 0, JSON.stringify(secrets.users));
verifier('6.b — après rechargement, `syncQueue` ne porte aucun champ secret (lignes héritées comprises)',
  secrets.syncQueue.length === 0, JSON.stringify(secrets.syncQueue));

const heritees = etat.syncQueue.filter(e => Number(e.id) >= 90100 && Number(e.id) <= 90199);
verifier('6.c — une ligne héritée porteuse d’un secret n’est jamais rejouée comme si le changement avait réussi',
  heritees.every(e => e.status !== 'pending' && e.status !== 'processing'),
  JSON.stringify(heritees.map(e => ({ id: e.id, status: e.status }))));

/* ═════════ 7 — CHANGEMENT EN LIGNE : LE SERVEUR HACHE, LE LOCAL NE GARDE RIEN ═════════ */
const NOUVEAU = 'Cle-Tournante-Atelier-2026!';
const enLigne = await soumettreFormulaireUtilisateur(page, {
  userId: '7401', username: 'b4-rotation', fullName: 'Poste Rotation', role: 'technicien', status: 'active', password: NOUVEAU
});
await page.waitForTimeout(1200);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);

verifier('7.a — le changement de mot de passe EN LIGNE est annoncé réussi',
  enLigne.some(n => n.type === 'success'), JSON.stringify(enLigne));
verifier('7.b — le serveur a bien accepté le nouveau mot de passe',
  (await api('/api/auth/login', { method: 'POST', expected: null, body: { username: 'b4-rotation', password: NOUVEAU } })).statut === 200);
verifier('7.c — après un changement EN LIGNE, aucun champ secret ne subsiste localement',
  secrets.users.length === 0 && secrets.syncQueue.length === 0,
  JSON.stringify([...secrets.users, ...secrets.syncQueue]));

/* ═════════ 8 — R1 : LA RÉVISION APRÈS UN CHANGEMENT DE MOT DE PASSE RÉUSSI ═════════ */
/*
 * `users` est un magasin à révision. La fiche locale est assainie, la charge envoyée
 * porte le secret : si l'accusé se compare à la charge envoyée, la révision n'est jamais
 * rangée. Le poste reste alors en N pendant que le serveur passe à N+1, et la
 * modification de profil suivante se fait refuser sans qu'aucun concurrent n'existe.
 */
await context.setOffline(false);
await api('/api/data/users/7450', { method: 'PUT', cookie: admin, expected: 200, body: {
  id: 7450, username: 'b4-revision', fullName: 'Poste Revision', role: 'technicien', status: 'active',
  password: Buffer.from('Poste-Revision-Verrou-2026!', 'utf8').toString('base64')
} });
await ouvrirSession(page);

const revisionAvant = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  return (await db.get('users', 7450))?._revision ?? null;
});
verifier('8.pre — la fiche est bien présente localement avec une révision (sinon l’épreuve ne prouve rien)',
  Number.isInteger(revisionAvant), `revision=${revisionAvant}`);

const ROTATION = 'Bascule-Revision-Atelier-2026!';
const changement = await soumettreFormulaireUtilisateur(page, {
  userId: '7450', username: 'b4-revision', fullName: 'Poste Revision', role: 'technicien', status: 'active', password: ROTATION
});
await page.waitForTimeout(1200);

const apres = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  const fiche = await db.get('users', 7450);
  return { revision: fiche?._revision ?? null, champs: Object.keys(fiche || {}) };
});
const revisionServeur = (await api('/api/sync', { cookie: admin })).charge?.data?.users
  ?.find(u => String(u.id) === '7450')?._revision ?? null;

verifier('8.a — le changement de mot de passe EN LIGNE est bien accepté',
  changement.some(n => n.type === 'success'), JSON.stringify(changement));
verifier('8.b — la fiche locale ne porte aucun champ secret',
  !apres.champs.some(champ => CHAMPS_SECRETS.includes(champ)), JSON.stringify(apres.champs));
verifier('8.c — la révision locale suit celle que le serveur a acquittée',
  apres.revision !== null && apres.revision === revisionServeur,
  `locale=${apres.revision} serveur=${revisionServeur} (avant=${revisionAvant})`);

// Et la conséquence : un renommage immédiat, sans nouvel instantané, doit passer.
const renommage = await soumettreFormulaireUtilisateur(page, {
  userId: '7450', username: 'b4-revision', fullName: 'Poste Revision Renomme', role: 'technicien', status: 'active', password: ''
});
await page.waitForTimeout(1000);
const nomServeur = (await api('/api/sync', { cookie: admin })).charge?.data?.users
  ?.find(u => String(u.id) === '7450')?.fullName ?? null;
verifier('8.d — le renommage qui suit n’est pas refusé en STALE_WRITE',
  renommage.some(n => n.type === 'success') && nomServeur === 'Poste Revision Renomme',
  `${JSON.stringify(renommage)} serveur=${nomServeur}`);

/* ═════════ 9 — R2 : LE RETOUR ARRIÈRE NE REPOSE PAS UN SECRET HÉRITÉ ═════════ */
/*
 * `previous` est lu brut avant l'écriture. Sur un poste dont la purge n'a pas tourné, il
 * porte encore le mot de passe — et le garde extérieur ne rattrape rien, puisque la
 * sauvegarde REJETTE avant de l'atteindre.
 */
const retourArriere = await page.evaluate(async (secret) => {
  const encoder = valeur => btoa(unescape(encodeURIComponent(String(valeur))));
  const base = await new Promise((resolve, reject) => {
    const requete = indexedDB.open('tech_platform_db');
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  const existante = await new Promise(resolve => {
    const requete = base.transaction('users', 'readonly').objectStore('users').get(7450);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => resolve(null);
  });
  // La fiche telle qu'un poste NON PURGÉ la porte encore.
  await new Promise((resolve, reject) => {
    const requete = base.transaction('users', 'readwrite').objectStore('users').put({
      ...existante, fullName: 'Nom D Origine',
      password: encoder(secret), passwordHash: encoder(secret), passwordScheme: 'base64'
    });
    requete.onsuccess = () => resolve();
    requete.onerror = () => reject(requete.error);
  });
  base.close();

  const { db } = await import('./db.js');
  const vraiFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (String(url).includes('/api/data/users/')) {
      return { ok: false, status: 409, headers: { get: () => null },
        text: async () => JSON.stringify({ error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 99 }) };
    }
    return vraiFetch(url, options);
  };
  try {
    await db.save('users', { ...existante, fullName: 'Nom Reecrit', password: db.hashPassword(secret) });
  } catch { /* le refus est attendu */ }
  window.fetch = vraiFetch;
  await new Promise(resolve => setTimeout(resolve, 400));
  return true;
}, MOT_DE_PASSE);

await page.waitForTimeout(400);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);
const restauree = etat.users.find(fiche => String(fiche.id) === '7450');

verifier('9.pre — la fiche héritée a bien été posée puis l’opération refusée (sinon l’épreuve ne prouve rien)',
  retourArriere === true && Boolean(restauree), JSON.stringify(restauree || null));
verifier('9.a — le retour arrière préserve les champs non sensibles d’avant',
  restauree?.fullName === 'Nom D Origine', JSON.stringify(restauree || null));
verifier('9.b — le retour arrière ne repose AUCUN champ secret',
  champsSecretsTrouves(restauree || {}, 'users#7450').length === 0,
  JSON.stringify(champsSecretsTrouves(restauree || {}, 'users#7450')));
verifier('9.c — et rien de secret ne subsiste ailleurs après ce refus',
  secrets.users.length === 0 && secrets.syncQueue.length === 0,
  JSON.stringify([...secrets.users, ...secrets.syncQueue]));

/* ═════════ 10 — R3 : UNE ROTATION PENDANT L'APPLICATION D'UN INSTANTANÉ ═════════ */
/*
 * `applySnapshot()` lève `syncing` pendant tout son travail, sur plusieurs tours de
 * boucle, et rien ne prouve que l'interface soit inerte pendant cet intervalle. La garde
 * « en ligne seulement » se lisant `!syncing && …`, elle était SAUTÉE pendant
 * l'application : aucune requête ne partait, et `db.save` rendait la main sans erreur.
 *
 * Le banc n'invente pas l'état. Il tient la VRAIE application ouverte, en suspendant la
 * première lecture que `applySnapshot()` attend — `syncing` est donc vrai parce que le
 * produit l'a levé.
 */
await context.setOffline(false);
await api('/api/data/users/7460', { method: 'PUT', cookie: admin, expected: 200, body: {
  id: 7460, username: 'b4-instantane', fullName: 'Poste Instantane', role: 'technicien', status: 'active',
  password: Buffer.from('Poste-Instantane-Verrou-2026!', 'utf8').toString('base64')
} });
await ouvrirSession(page);

const requetesUtilisateur = [];
const compterRequete = requete => {
  if (/\/api\/data\/users\//.test(requete.url()) && requete.method() === 'PUT') requetesUtilisateur.push(requete.url());
};
page.on('request', compterRequete);

const pendantInstantane = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  const vraiGetRaw = db._getRaw.bind(db);
  let relacher;
  const suspendue = new Promise(resolve => { relacher = resolve; });
  let atteinte;
  const entree = new Promise(resolve => { atteinte = resolve; });

  // `applySnapshot()` attend cette lecture dès son entrée, `syncing` déjà levé.
  db._getRaw = async (nom, id) => {
    if (nom === 'settings' && id === 'current-room') { atteinte(); await suspendue; }
    return vraiGetRaw(nom, id);
  };

  const application = db.enableCentralSync({ bootstrapLocal: false });
  await entree;

  let refus = null;
  let rendueSansErreur = false;
  try {
    const existante = await vraiGetRaw('users', 7460);
    await db.save('users', { ...existante, password: db.hashPassword('Bascule-Pendant-Instantane-2026!') });
    rendueSansErreur = true;
  } catch (erreur) { refus = { message: String(erreur?.message || erreur), code: erreur?.code || null }; }

  relacher();
  db._getRaw = vraiGetRaw;
  await application.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 300));
  return { refus, rendueSansErreur };
});

page.off('request', compterRequete);
await page.waitForTimeout(300);
etat = await lireMagasinsBruts(page);
secrets = secretsDansMagasins(etat);

verifier('10.pre — l’application d’instantané a bien été tenue ouverte (sinon l’épreuve ne prouve rien)',
  pendantInstantane.refus !== null || pendantInstantane.rendueSansErreur === true,
  JSON.stringify(pendantInstantane));
verifier('10.a — la rotation pendant l’application échoue au lieu de rendre la main',
  pendantInstantane.rendueSansErreur === false && pendantInstantane.refus?.code === 'CREDENTIAL_REQUIRES_CENTRAL',
  JSON.stringify(pendantInstantane));
verifier('10.b — aucune requête de mot de passe n’est partie pendant ce refus',
  requetesUtilisateur.length === 0, JSON.stringify(requetesUtilisateur));
verifier('10.c — et rien de secret n’a touché un magasin persistant',
  secrets.users.length === 0 && secrets.syncQueue.length === 0,
  JSON.stringify([...secrets.users, ...secrets.syncQueue]));

// L'application terminée, la même rotation doit passer : « tout refuser » n'est pas un correctif.
const APRES = 'Bascule-Apres-Instantane-2026!';
const rotationApres = await soumettreFormulaireUtilisateur(page, {
  userId: '7460', username: 'b4-instantane', fullName: 'Poste Instantane', role: 'technicien', status: 'active', password: APRES
});
await page.waitForTimeout(1200);
verifier('10.d — l’application terminée, la rotation en ligne réussit de nouveau',
  rotationApres.some(n => n.type === 'success')
    && (await api('/api/auth/login', { method: 'POST', expected: null, body: { username: 'b4-instantane', password: APRES } })).statut === 200,
  JSON.stringify(rotationApres));

/* ═════════ 11 — R4 : AUCUN MAGASIN PERSISTANT, ET NON PAS « `users` ET LA FILE » ═════════ */
/*
 * `estEcritureCredentielle()` ne connaît que `users` : c'est ce qui décide d'une ROTATION
 * D'IDENTIFIANT. La copie locale n'était assainie que sur ce prédicat, si bien qu'une
 * fiche `settings` portant `password` partait TELLE QUELLE dans IndexedDB — la file, elle,
 * était bien nettoyée, et c'est tout ce que la section 3 vérifiait.
 */
await context.setOffline(true);
const ecritureAutreMagasin = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  const recus = [];
  try {
    await db.save('settings', {
      id: 'b4-poste-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordScheme: 'base64'
    });
  } catch (erreur) { recus.push(String(erreur?.message || erreur)); }
  await new Promise(resolve => setTimeout(resolve, 400));
  return recus;
});
await page.waitForTimeout(400);

let tous = await lireTousLesMagasins(page);
const ficheReglages = (tous.settings || []).find(f => String(f.id) === 'b4-poste-atelier');

verifier('11.pre — la fiche a bien été écrite dans `settings` (sinon l’épreuve ne prouve rien)',
  Boolean(ficheReglages), JSON.stringify(ficheReglages || null));
verifier('11.a — une fiche NON `users` n’est pas refusée : ce n’est pas une rotation d’identifiant',
  ecritureAutreMagasin.length === 0, JSON.stringify(ecritureAutreMagasin));
verifier('11.b — ses champs non sensibles sont conservés',
  ficheReglages?.libelle === 'Poste atelier', JSON.stringify(ficheReglages || null));
verifier('11.c — mais elle ne porte AUCUN champ secret sur le disque',
  champsSecretsTrouves(ficheReglages || {}, 'settings#b4-poste-atelier').length === 0,
  JSON.stringify(champsSecretsTrouves(ficheReglages || {}, 'settings#b4-poste-atelier')));

// Un résidu HÉRITÉ dans un magasin non `users`, posé hors de toute enveloppe applicative.
await page.evaluate(async (secret) => {
  const encoder = valeur => btoa(unescape(encodeURIComponent(String(valeur))));
  const base = await new Promise((resolve, reject) => {
    const requete = indexedDB.open('tech_platform_db');
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  const ecrire = (nom, fiche) => new Promise((resolve, reject) => {
    const requete = base.transaction(nom, 'readwrite').objectStore(nom).put(fiche);
    requete.onsuccess = () => resolve();
    requete.onerror = () => reject(requete.error);
  });
  await ecrire('settings', { id: 'b4-heritee-reglages', libelle: 'Réglage hérité',
    password: encoder(secret), passwordHash: encoder(secret), passwordScheme: 'base64' });
  await ecrire('notes', { id: 990101, targetType: 'room', targetId: 'salle-1',
    texte: 'Relevé de terrain', password: encoder(secret) });
  base.close();
}, MOT_DE_PASSE);

const avant = await lireTousLesMagasins(page);
verifier('11.d — les résidus hérités hors `users` ont bien été posés (sinon l’épreuve ne prouve rien)',
  Object.entries(avant).some(([nom, fiches]) =>
    nom !== 'users' && nom !== 'syncQueue' && fiches.some(f => champsSecretsTrouves(f, nom).length > 0)),
  'aucun résidu hors `users` n’a été posé');

/*
 * La purge ne demande rien au réseau — c'est tout son objet, et les épreuves de
 * `npm test` le tiennent. On la déclenche donc d'abord HORS LIGNE, puis on recharge la
 * page une fois la liaison revenue, ce que `page.reload` exige.
 */
const { nettoyees: purgeHorsLigne, ms: dureePurge, magasins: magasinsBalayes } = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  if (typeof db.purgeLocalCredentialResidue !== 'function') return { nettoyees: null, ms: 0, magasins: 0 };
  const depart = performance.now();
  const nettoyees = await db.purgeLocalCredentialResidue();
  return { nettoyees, ms: Math.round(performance.now() - depart), magasins: db.db?.objectStoreNames?.length ?? 0 };
});
verifier('11.e-pre — la purge s’exécute sans réseau et trouve bien des résidus à nettoyer',
  Number.isInteger(purgeHorsLigne) && purgeHorsLigne > 0, `fiches nettoyées=${purgeHorsLigne}`);

/*
 * L'ASSAINISSEMENT SUR PLACE SE CONSTATE ICI, ET PAS APRÈS UN RECHARGEMENT.
 *
 * Un rechargement applique l'instantané autoritaire du serveur, qui remplace légitimement
 * le contenu des magasins : des fiches posées uniquement en local en disparaissent, et
 * c'est le comportement attendu — pas un effet de la purge. La propriété « assainie, pas
 * supprimée » s'observe donc juste après la purge.
 */
const apresPurge = await lireTousLesMagasins(page);
const residusApresPurge = Object.entries(apresPurge).flatMap(([nom, fiches]) =>
  fiches.flatMap(fiche => champsSecretsTrouves(fiche, `${nom}#${fiche.id}`)));
const reglagePurge = (apresPurge.settings || []).find(f => String(f.id) === 'b4-heritee-reglages');
const notePurge = (apresPurge.notes || []).find(f => String(f.id) === '990101');

verifier('11.e — la purge retire le secret de TOUT magasin persistant',
  residusApresPurge.length === 0, JSON.stringify(residusApresPurge.slice(0, 8)));
verifier('11.f — et elle assainit SUR PLACE : les fiches ne sont pas supprimées',
  reglagePurge?.libelle === 'Réglage hérité' && notePurge?.texte === 'Relevé de terrain',
  JSON.stringify({ reglagePurge, notePurge }));

await context.setOffline(false);
const debutPurge = Date.now();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const dureeRechargement = Date.now() - debutPurge;

tous = await lireTousLesMagasins(page);
const residus = Object.entries(tous).flatMap(([nom, fiches]) =>
  fiches.flatMap(fiche => champsSecretsTrouves(fiche, `${nom}#${fiche.id}`)));
verifier('11.g — et après un rechargement complet, aucun secret ne réapparaît nulle part',
  residus.length === 0, JSON.stringify(residus.slice(0, 8)));
console.log(`         (purge seule : ${dureePurge} ms sur ${magasinsBalayes} magasins ; rechargement complet : ${dureeRechargement} ms)`);

/* ═════════ 12 — R5 : LES FRONTIÈRES QUI NE PASSENT PAS PAR `db.save` ═════════ */
/*
 * Trois chemins franchissent la frontière du poste sans passer par `db.save` :
 * l'INGRESSION d'un instantané (`store.put()` direct), l'ÉGRESSION en ligne
 * (`pushRecord`) et l'AMORÇAGE (`localSnapshot`). Chacun pouvait porter un champ du
 * contrat — et ensemble ils formaient une boucle : un `settings.password` poussé au
 * `PUT` générique se rangeait dans PostgreSQL, d'où l'instantané suivant le ramenait sur
 * le disque, juste après la purge.
 */
await context.setOffline(false);
await ouvrirSession(page);

// ── R5-B : ce qui QUITTE le poste pour une fiche non `users` ──
const corpsSortants = [];
const capterCorps = requete => {
  if (requete.method() !== 'PUT' || !/\/api\/data\//.test(requete.url())) return;
  let corps = null;
  try { corps = JSON.parse(requete.postData() || 'null'); } catch { corps = null; }
  corpsSortants.push({ url: requete.url(), corps });
};
page.on('request', capterCorps);

await page.evaluate(async () => {
  const { db } = await import('./db.js');
  await db.save('settings', {
    id: 'b4-egress-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordScheme: 'base64'
  });
  await new Promise(resolve => setTimeout(resolve, 600));
});
await page.waitForTimeout(600);
page.off('request', capterCorps);

const sortieReglages = corpsSortants.find(c => c.url.includes('/api/data/settings/'));
verifier('12.pre — l’écriture `settings` est bien partie au centre (sinon l’épreuve ne prouve rien)',
  Boolean(sortieReglages), JSON.stringify(corpsSortants.map(c => c.url)));
verifier('12.a — R5-B : le corps envoyé au `PUT` générique ne porte aucun champ interdit',
  champsSecretsTrouves(sortieReglages?.corps || {}, 'PUT').length === 0,
  JSON.stringify(champsSecretsTrouves(sortieReglages?.corps || {}, 'PUT')));
verifier('12.b — et ses champs non sensibles partent normalement',
  sortieReglages?.corps?.record?.libelle === 'Poste atelier' || sortieReglages?.corps?.libelle === 'Poste atelier',
  JSON.stringify(sortieReglages?.corps || null));

// Le serveur ne doit donc rien avoir rangé d'interdit, et l'instantané suivant rien à ramener.
const instantaneServeur = (await api('/api/sync', { cookie: admin })).charge;
verifier('12.c — le centre n’a rien rangé d’interdit : l’instantané suivant est propre',
  champsSecretsTrouves(instantaneServeur?.data?.settings || [], 'snapshot.settings').length === 0,
  JSON.stringify(champsSecretsTrouves(instantaneServeur?.data?.settings || [], 'snapshot.settings')));

// ── R5-A : ce qui ENTRE, servi par un centre qui porterait malgré tout un champ interdit ──
/*
 * Le centre est ici forcé à servir une fiche porteuse : c'est l'état qu'un serveur plus
 * ancien, ou une base déjà polluée, présenterait. L'ingression doit l'assainir AVANT le
 * disque — c'est elle qu'on mesure, pas la propreté du serveur.
 */
const ingression = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  const vraiFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (String(url).includes('/api/sync') && !String(url).includes('bootstrap')) {
      const reponse = await vraiFetch(url, options);
      const charge = JSON.parse(await reponse.text());
      charge.data = charge.data || {};
      charge.data.settings = [...(charge.data.settings || []), {
        id: 'b4-ingress-atelier', libelle: 'Poste ingression', _revision: 7,
        password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
      }];
      charge.authoritativeStores = Array.from(new Set([...(charge.authoritativeStores || []), 'settings']));
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(charge) };
    }
    return vraiFetch(url, options);
  };
  try { await db.enableCentralSync({ bootstrapLocal: false }); }
  catch (erreur) { return { erreur: String(erreur?.message || erreur) }; }
  finally { window.fetch = vraiFetch; }
  await new Promise(resolve => setTimeout(resolve, 400));
  return { applique: true };
});
await page.waitForTimeout(400);

const apresIngression = await lireTousLesMagasins(page);
const ficheIngression = (apresIngression.settings || []).find(f => String(f.id) === 'b4-ingress-atelier');
const residusIngression = Object.entries(apresIngression).flatMap(([nom, fiches]) =>
  fiches.flatMap(fiche => champsSecretsTrouves(fiche, `${nom}#${fiche.id}`)));

verifier('12.d — la fiche servie par le centre a bien été appliquée (sinon l’épreuve ne prouve rien)',
  Boolean(ficheIngression), JSON.stringify({ ingression, ficheIngression }));
verifier('12.e — R5-A : l’ingression conserve les champs non sensibles ET la révision du centre',
  ficheIngression?.libelle === 'Poste ingression' && ficheIngression?._revision === 7,
  JSON.stringify(ficheIngression || null));
verifier('12.f — R5-A : mais elle ne repose AUCUN champ interdit sur le disque',
  residusIngression.length === 0, JSON.stringify(residusIngression.slice(0, 8)));

// ── R5-C : ce que le poste PROPOSE au centre à l'amorçage ──
const corpsAmorcage = [];
const capterAmorcage = requete => {
  if (!/\/api\/sync\/bootstrap/.test(requete.url())) return;
  try { corpsAmorcage.push(JSON.parse(requete.postData() || 'null')); } catch { corpsAmorcage.push(null); }
};
page.on('request', capterAmorcage);

const amorcage = await page.evaluate(async () => {
  const { db } = await import('./db.js');
  // Un résidu hérité, posé hors de toute enveloppe applicative, purge non encore passée.
  await db._saveRaw('settings', { id: 'b4-amorcage-atelier', libelle: 'Poste amorçage',
    password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64' });

  const vraiFetch = window.fetch;
  window.fetch = async (url, options) => {
    // Le centre se déclare VIERGE : c'est ce qui déclenche l'amorçage.
    if (String(url).includes('/api/sync') && !String(url).includes('bootstrap')) {
      return { ok: true, status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ initialized: false, authoritativeStores: [], data: {}, deleted: [], access: {}, serverTime: new Date().toISOString() }) };
    }
    /*
     * L'amorçage part POUR DE VRAI sur le réseau, et n'est pas court-circuité ici : un
     * stub le ferait disparaître du fil, et le contrôle sur son corps passerait au vert
     * en n'observant rien. Ce que le serveur en fait est indifférent — c'est le corps
     * QUITTANT le navigateur qui est mesuré.
     */
    return vraiFetch(url, options);
  };
  try { await db.enableCentralSync({ bootstrapLocal: true }); }
  catch (erreur) { return { erreur: String(erreur?.message || erreur) }; }
  finally { window.fetch = vraiFetch; }
  return { fait: true };
});
await page.waitForTimeout(600);
page.off('request', capterAmorcage);

verifier('12.g — un amorçage a bien eu lieu et il a emporté la fiche (sinon l’épreuve ne prouve rien)',
  corpsAmorcage.length > 0
    && (corpsAmorcage[0]?.data?.settings || []).some(f => String(f.id) === 'b4-amorcage-atelier'),
  JSON.stringify({ amorcage, nb: corpsAmorcage.length }));
verifier('12.h — R5-C : le corps d’amorçage ne porte aucun champ interdit hors du navigateur',
  champsSecretsTrouves(corpsAmorcage[0] || {}, 'bootstrap').length === 0,
  JSON.stringify(champsSecretsTrouves(corpsAmorcage[0] || {}, 'bootstrap').slice(0, 8)));

/* ═══════════════════════════════ verdict ═══════════════════════════════ */
await context.close();
await navigateur.close();

for (const ligne of rapport) {
  console.log(`${ligne.ok ? '  OK  ' : ' ÉCHEC'} · ${ligne.titre}${ligne.ok || !ligne.detail ? '' : `\n         ${ligne.detail}`}`);
}
const echecs = rapport.filter(l => !l.ok);
console.log(`\n${rapport.length - echecs.length}/${rapport.length} contrôles satisfaits`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec — le contrat B-4 n'est pas tenu.`);
  process.exit(1);
}
