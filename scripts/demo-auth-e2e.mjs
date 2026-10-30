/**
 * @file scripts/demo-auth-e2e.mjs — DEMO-AUTH-01, l'autorisation décidée à un seul endroit.
 *
 * CE QUE CETTE ÉPREUVE ÉTABLIT
 * -----------------------------
 * Les contrats métier Diagramme et Continuité portaient une SECONDE politique de rôle, qui
 * ignorait le Chef. La retirer ne doit rien ouvrir : l'autorisation était déjà vérifiée —
 * plus complètement — par l'endpoint, avec les zones et les grants.
 *
 * On l'éprouve donc dans les deux sens, contre un vrai serveur et une vraie base :
 *
 *   · un Chef autorisé dans TOUTES les zones concernées valide ;
 *   · un Chef sans grant, ou hors zone, est refusé ;
 *   · un Chef auteur de la fiche est refusé par les quatre yeux ;
 *   · un Manager ne ferme pas définitivement une demande.
 *
 * Usage :
 *   PORT=4198 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4198 node scripts/demo-auth-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4198';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Kt5-Genepi-Sillon-Rz9!';

const MOT_DE_PASSE = 'Vx8-Ombelle-Tourbe-Wq4!';

let echecs = 0;
let verifications = 0;
function verifier(condition, message) {
  verifications += 1;
  if (condition) console.log(`  ✅ ${message}`);
  else { console.log(`  ❌ ${message}`); echecs += 1; }
}

async function requete(chemin, { method = 'GET', cookie = '', body, expected = null } = {}) {
  const reponse = await fetch(`${base}${chemin}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null) {
    assert.equal(reponse.status, expected, `${method} ${chemin} : attendu ${expected}, reçu ${reponse.status} ${texte}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const ZONE = 'demo-zone-rf1';
const ZONE_VOISINE = 'demo-zone-rf2';
const SALLE = 'demo-salle-rf1';

console.log(`\n╔═══ une seule politique par décision — ${base} ═══╗\n`);

const admin = await requete('/api/auth/login', {
  method: 'POST', body: { username: adminUsername, password: adminPassword }, expected: 200
});
assert.ok(admin.cookie.startsWith('tp_session='), 'cookie administrateur absent');
const cookieAdmin = admin.cookie;

async function creerCompte(id, username, role) {
  await requete(`/api/data/users/${id}`, {
    method: 'PUT', cookie: cookieAdmin,
    body: {
      id, username, fullName: `${role} de démonstration`, role, status: 'active',
      password: Buffer.from(MOT_DE_PASSE).toString('base64'), authVersion: 1
    },
    expected: 200
  });
  const session = await requete('/api/auth/login', {
    method: 'POST', body: { username, password: MOT_DE_PASSE }, expected: 200
  });
  return session.cookie;
}

/* ─────────────────────────── Le décor ─────────────────────────── */

console.log('0 · le décor');
for (const [id, nom] of [[ZONE, 'Régie Finale 1'], [ZONE_VOISINE, 'Régie Finale 2']]) {
  await requete('/api/access/zones', {
    method: 'POST', cookie: cookieAdmin,
    body: { id, name: nom, publicSummary: 'Zone de démonstration.' }, expected: 200
  });
}
await requete(`/api/data/rooms/${SALLE}`, {
  method: 'PUT', cookie: cookieAdmin, body: { id: SALLE, name: 'Régie Finale 1', zoneId: ZONE }, expected: 200
});

const CHEF_AUTORISE = 94101;
const CHEF_SANS_GRANT = 94102;
const CHEF_AUTRE_ZONE = 94103;
const MANAGER = 94104;

const cookieChef = await creerCompte(CHEF_AUTORISE, 'demo-chef-autorise', 'chef');
const cookieChefSansGrant = await creerCompte(CHEF_SANS_GRANT, 'demo-chef-sans-grant', 'chef');
const cookieChefAutreZone = await creerCompte(CHEF_AUTRE_ZONE, 'demo-chef-autre-zone', 'chef');
const cookieManager = await creerCompte(MANAGER, 'demo-manager', 'manager');

// Le Chef autorisé : membre de la zone, et validateur dans cette zone.
await requete('/api/access/memberships', {
  method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_AUTORISE, zoneId: ZONE, responsible: true, expiresAt: null }, expected: 200
});
for (const permission of ['diagram.read', 'diagram.edit', 'diagram.validate', 'continuity.read', 'continuity.validate', 'ticket.read', 'ticket.create', 'ticket.edit']) {
  await requete('/api/access/grants', {
    method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_AUTORISE, zoneId: ZONE, permission, expiresAt: null }, expected: 200
  });
}
// Le Chef sans grant : membre de la zone, mais aucun droit de validation.
await requete('/api/access/memberships', {
  method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_SANS_GRANT, zoneId: ZONE, responsible: false, expiresAt: null }, expected: 200
});
await requete('/api/access/grants', {
  method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_SANS_GRANT, zoneId: ZONE, permission: 'diagram.read', expiresAt: null }, expected: 200
});
// Le Chef d'à côté : tout dans une AUTRE zone.
await requete('/api/access/memberships', {
  method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_AUTRE_ZONE, zoneId: ZONE_VOISINE, responsible: true, expiresAt: null }, expected: 200
});
for (const permission of ['diagram.read', 'diagram.validate', 'continuity.read', 'continuity.validate', 'ticket.read', 'ticket.create', 'ticket.edit']) {
  await requete('/api/access/grants', {
    method: 'POST', cookie: cookieAdmin, body: { userId: CHEF_AUTRE_ZONE, zoneId: ZONE_VOISINE, permission, expiresAt: null }, expected: 200
  });
}
verifier(true, 'zones, comptes, appartenances et droits en place');

/* ═══════════ 1 · Diagramme — le Chef autorisé valide ═══════════ */

/*
 * L'AUTEUR EST CELUI QUI ÉCRIT, PAS CELUI QUE LA CHARGE UTILE DÉSIGNE.
 *
 * `serve.js` pose `authorId` depuis la SESSION — un client ne peut pas s'attribuer, ni
 * attribuer à autrui, la paternité d'une fiche. Pour éprouver les quatre yeux il faut donc
 * que le Chef crée lui-même le diagramme : le lui faire « signer » par l'administrateur ne
 * produirait qu'un faux négatif, et l'épreuve conclurait à tort que la garde est ouverte.
 */
async function poserDiagramme(id, cookieAuteur = cookieAdmin) {
  await requete(`/api/data/docs/${id}`, {
    method: 'PUT', cookie: cookieAuteur,
    body: {
      id, kind: 'technical_diagram', diagramType: 'rack-elevation', title: 'Élévation de baie',
      status: 'draft', zoneIds: [ZONE], nodes: [], edges: []
    },
    expected: 200
  });
}

console.log('\n1 · diagramme — le Chef autorisé');
await poserDiagramme('demo-dia-1');
const validationChef = await requete('/api/diagrams/demo-dia-1/validate', { method: 'POST', cookie: cookieChef });
verifier(validationChef.statut === 200,
  `un Chef autorisé dans toutes ses zones valide le diagramme (reçu ${validationChef.statut} ${validationChef.charge?.error || ''})`);
verifier(String(validationChef.charge?.record?.validation?.validatedBy) === String(CHEF_AUTORISE),
  'et la validation porte SON identité');

console.log('\n2 · diagramme — les refus doivent tenir');
await poserDiagramme('demo-dia-2');
const sansGrant = await requete('/api/diagrams/demo-dia-2/validate', { method: 'POST', cookie: cookieChefSansGrant });
verifier(sansGrant.statut === 403,
  `un Chef sans droit de validation est refusé (reçu ${sansGrant.statut})`);

const autreZone = await requete('/api/diagrams/demo-dia-2/validate', { method: 'POST', cookie: cookieChefAutreZone });
verifier([403, 404].includes(autreZone.statut),
  `un Chef autorisé ailleurs ne valide pas ici (reçu ${autreZone.statut})`);

await poserDiagramme('demo-dia-3', cookieChef);
const quatreYeux = await requete('/api/diagrams/demo-dia-3/validate', { method: 'POST', cookie: cookieChef });
verifier(quatreYeux.statut === 409 && quatreYeux.charge?.error === 'FOUR_EYES_REQUIRED',
  `l’auteur ne valide pas sa propre fiche (reçu ${quatreYeux.statut} ${quatreYeux.charge?.error})`);

const encoreValide = await requete('/api/diagrams/demo-dia-2/validate', { method: 'POST', cookie: cookieChef });
verifier(encoreValide.statut === 200, 'et le diagramme reste validable par un Chef autorisé non-auteur');

/* ═══════════ 3 · Demandes — le Manager ne ferme pas définitivement ═══════════ */

console.log('\n3 · demandes — traiter n’est pas fermer');
const demande = await requete('/api/service-requests', {
  method: 'POST', cookie: cookieChef,
  // Les noms viennent de `service-request-contract.js` : `requestKind`, `subject`, `details`.
  body: {
    requestKind: 'incident',
    subject: 'Panne de démonstration',
    description: 'Vérification du workflow de clôture des demandes.',
    destinationZoneId: ZONE,
    priority: 'haute',
    details: { impact: 'Service dégradé' }
  }
});
const idDemande = demande.charge?.request?.id ?? demande.charge?.id;
verifier(Boolean(idDemande),
  `la demande de démonstration est créée (${demande.statut} ${demande.charge?.message || ''})`);

if (idDemande) {
  const pret = await requete(`/api/service-requests/${encodeURIComponent(idDemande)}`, {
    method: 'PATCH', cookie: cookieManager, body: { status: 'prêt-fermeture', solution: 'Traité par le Manager.' }
  });
  verifier(pret.statut === 200, `le Manager peut marquer « prêt-fermeture » (reçu ${pret.statut})`);

  const fermeParManager = await requete(`/api/service-requests/${encodeURIComponent(idDemande)}`, {
    method: 'PATCH', cookie: cookieManager, body: { status: 'fermé' }
  });
  verifier(fermeParManager.statut === 403 && fermeParManager.charge?.error === 'ADMIN_CLOSE_REQUIRED',
    `le Manager ne ferme pas définitivement (reçu ${fermeParManager.statut} ${fermeParManager.charge?.error})`);

  const fermeParAdmin = await requete(`/api/service-requests/${encodeURIComponent(idDemande)}`, {
    method: 'PATCH', cookie: cookieAdmin, body: { status: 'fermé' }
  });
  verifier(fermeParAdmin.statut === 200, `l’administrateur ferme (reçu ${fermeParAdmin.statut})`);
}

/* ═══════════ 4 · Journal — le contrat serveur, pour les six rôles ═══════════ */

/*
 * CACHER UN BOUTON N'EST PAS UNE PROTECTION.
 *
 * L'écran ne propose plus ni Importer ni suppression ligne par ligne, et Exporter/Vider
 * suivent la matrice. Mais `access-control.js` gouvernait encore le journal par
 * `ticket.read` / `ticket.edit`, et laissait tout utilisateur ÉCRIRE le log qui lui
 * appartient. Comme le DELETE générique s'appuie sur cette même autorisation, un appel
 * direct à l'API suffisait à effacer sa propre trace — c'est-à-dire la preuve de ce qu'on
 * vient de faire.
 *
 * Le contrat éprouvé ici :
 *   lire      `logs.view`   — Admin, Manager, Chef, Responsable
 *   ajouter   tout utilisateur authentifié, identité et horodatage POSÉS PAR LE SERVEUR
 *   modifier  interdit à tous : le journal est immuable
 *   effacer   `logs.clear`  — Admin seul
 */

console.log('\n4 · journal — lire, ajouter, jamais modifier');

const TECHNICIEN = 94105;
const RESPONSABLE = 94106;
const VISITEUR = 94107;
const cookieTechnicien = await creerCompte(TECHNICIEN, 'demo-technicien', 'technician');
const cookieResponsable = await creerCompte(RESPONSABLE, 'demo-responsable', 'responsible');
const cookieVisiteur = await creerCompte(VISITEUR, 'demo-visiteur', 'visitor');

const sessions = {
  admin: cookieAdmin, manager: cookieManager, chef: cookieChef,
  responsible: cookieResponsable, technician: cookieTechnicien, visitor: cookieVisiteur
};

/** Une entrée de journal légitime, ajoutée par un utilisateur authentifié. */
async function ajouterLog(id, cookie, revendication = {}) {
  return requete(`/api/data/logs/${id}`, {
    method: 'PUT', cookie,
    body: { id, type: 'inventaire', action: 'modification', details: 'Entrée de démonstration.', ...revendication }
  });
}

const creation = await ajouterLog('demo-log-1', cookieChef);
verifier(creation.statut === 200, `un utilisateur authentifié peut consigner son action (${creation.statut})`);

async function lireLog(cookie, id) {
  const instantane = await requete('/api/sync', { cookie });
  return (instantane.charge?.data?.logs || []).find(entree => String(entree.id) === String(id)) || null;
}

const consigne = await lireLog(cookieAdmin, 'demo-log-1');
verifier(String(consigne?.userId) === String(CHEF_AUTORISE),
  `l’auteur est posé par le serveur, pas déclaré par le client (lu ${consigne?.userId})`);
verifier(Boolean(consigne?.timestamp), 'et l’horodatage aussi');

// Falsification : le client tente de s'attribuer une autre identité.
const falsification = await ajouterLog('demo-log-2', cookieChef, {
  userId: MANAGER, username: 'demo-manager', fullName: 'Quelqu’un d’autre', timestamp: '1999-01-01T00:00:00.000Z'
});
const falsifie = await lireLog(cookieAdmin, 'demo-log-2');
verifier(falsification.statut !== 200 || String(falsifie?.userId) === String(CHEF_AUTORISE),
  `nul ne peut attribuer sa trace à autrui (userId lu : ${falsifie?.userId})`);
verifier(falsification.statut !== 200 || falsifie?.timestamp !== '1999-01-01T00:00:00.000Z',
  'ni antidater son entrée');

/* — modifier une entrée existante : interdit à tous — */

for (const [role, cookie] of Object.entries(sessions)) {
  const modification = await ajouterLog('demo-log-1', cookie, { details: `Réécrit par ${role}.` });
  verifier(modification.statut >= 400,
    `${role} ne peut pas MODIFIER une entrée existante (reçu ${modification.statut})`);
}
const apresTentatives = await lireLog(cookieAdmin, 'demo-log-1');
verifier(apresTentatives?.details === 'Entrée de démonstration.',
  `le journal est immuable : le texte d’origine est intact (lu « ${apresTentatives?.details} »)`);

/* — lire : selon `logs.view` — */

const LECTURE_ATTENDUE = {
  admin: true, manager: true, chef: true, responsible: true, technician: false, visitor: false
};
for (const [role, cookie] of Object.entries(sessions)) {
  const vu = await lireLog(cookie, 'demo-log-1');
  verifier(Boolean(vu) === LECTURE_ATTENDUE[role],
    `${role} ${LECTURE_ATTENDUE[role] ? 'voit' : 'ne voit pas'} le journal dans l’instantané`);
}

/* — effacer : `logs.clear`, c'est-à-dire l'administrateur seul — */

for (const [role, cookie] of Object.entries(sessions)) {
  if (role === 'admin') continue;
  const suppression = await requete('/api/data/logs/demo-log-1', { method: 'DELETE', cookie });
  verifier(suppression.statut === 403,
    `${role} ne peut pas effacer une entrée du journal (reçu ${suppression.statut})`);
}
const survivant = await lireLog(cookieAdmin, 'demo-log-1');
verifier(Boolean(survivant), 'et l’entrée est toujours là après toutes ces tentatives');

const suppressionAdmin = await requete('/api/data/logs/demo-log-1', { method: 'DELETE', cookie: cookieAdmin });
verifier(suppressionAdmin.statut === 200, `l’administrateur efface (reçu ${suppressionAdmin.statut})`);
verifier(!await lireLog(cookieAdmin, 'demo-log-1'), 'et l’entrée a bien disparu');

/* ═════════ Intégration finale · le journal, contre un vrai serveur ═════════ */

console.log('\n5 · le journal : les six rôles, l’ordre et l’identité');

/* — AJOUTER : les six rôles, réellement testés, chacun avec sa propre entrée — */

for (const [role, cookie] of Object.entries(sessions)) {
  const ajout = await ajouterLog(`demo-append-${role}`, cookie);
  verifier(ajout.statut === 200,
    `${role} peut AJOUTER une trace (reçu ${ajout.statut}${ajout.charge?.error ? ' ' + ajout.charge.error : ''})`);
}

// Un non-authentifié, lui, n'entre pas : l'ouverture porte sur les rôles connus, pas sur tout le monde.
const anonyme = await requete('/api/data/logs/demo-append-anonyme', {
  method: 'PUT', body: { id: 'demo-append-anonyme', type: 'inventaire', action: 'modification', details: 'x' }
});
verifier(anonyme.statut === 401, `un anonyme ne consigne rien (reçu ${anonyme.statut})`);

/* — MODIFIER : une seule règle, un seul code, pour tout le monde — */

await ajouterLog('demo-immuable', cookieAdmin);
for (const [role, cookie] of Object.entries(sessions)) {
  const reecriture = await ajouterLog('demo-immuable', cookie, { action: 'RÉÉCRITURE' });
  verifier(reecriture.statut === 403 && reecriture.charge?.error === 'LOG_IMMUTABLE',
    `${role} reçoit 403 LOG_IMMUTABLE en modification (reçu ${reecriture.statut} ${reecriture.charge?.error || ''})`);
}
const intacte = await lireLog(cookieAdmin, 'demo-immuable');
verifier(intacte?.action === 'modification', 'et l’entrée d’origine n’a pas bougé');

/* — L'ORDRE : le timestamp canonique est un NOMBRE, et le tri réel de logs.js le prouve — */

await ajouterLog('demo-ordre-A', cookieAdmin);
await new Promise(resoudre => setTimeout(resoudre, 40));
await ajouterLog('demo-ordre-B', cookieAdmin);

const ordreA = await lireLog(cookieAdmin, 'demo-ordre-A');
const ordreB = await lireLog(cookieAdmin, 'demo-ordre-B');
verifier(typeof ordreA?.timestamp === 'number' && typeof ordreB?.timestamp === 'number',
  `l’horodatage est un nombre de millisecondes (reçu ${typeof ordreA?.timestamp})`);
// LE tri de la plateforme, pas une reformulation : `logsSection.js` classe par soustraction.
const classes = [ordreA, ordreB].sort((x, y) => y.timestamp - x.timestamp).map(entree => entree.id);
verifier(classes[0] === 'demo-ordre-B',
  `le tri « b.timestamp - a.timestamp » place le plus récent en tête (reçu ${JSON.stringify(classes)})`);
verifier(Number.isFinite(ordreB.timestamp - ordreA.timestamp),
  'la soustraction de deux horodatages donne un nombre, jamais NaN');
// Les trois valeurs temporelles viennent du MÊME instant : une preuve dont les dates se
// contredisent entre elles se conteste.
verifier(new Date(ordreB.serverReceivedAt).getTime() === ordreB.timestamp,
  '`serverReceivedAt` et `timestamp` désignent le même instant');

/* — L'IDENTITÉ : rien de ce que le client déclare ne survit — */

const USURPATEUR = 94199;
await requete(`/api/data/users/${USURPATEUR}`, {
  method: 'PUT', cookie: cookieAdmin,
  body: {
    id: USURPATEUR, username: 'demo-log-sans-nom', fullName: '', role: 'technician', status: 'active',
    password: Buffer.from(MOT_DE_PASSE).toString('base64'), authVersion: 1
  }, expected: 200
});
const sessionUsurpateur = await requete('/api/auth/login', {
  method: 'POST', body: { username: 'demo-log-sans-nom', password: MOT_DE_PASSE }, expected: 200
});

const REVENDICATION = {
  userId: 1,
  username: 'Faux utilisateur',
  fullName: 'Direction Générale',
  timestamp: 946684800000,
  dateStr: '01/01/2000',
  serverReceivedAt: '2000-01-01T00:00:00.000Z'
};
const usurpation = await ajouterLog('demo-usurpation', sessionUsurpateur.cookie, REVENDICATION);
verifier(usurpation.statut === 200, `l’écriture aboutit (${usurpation.statut}) — c’est le CONTENU qui doit être corrigé`);

const trace = await lireLog(cookieAdmin, 'demo-usurpation');
verifier(trace?.userId === USURPATEUR, `userId vient de la session (reçu ${trace?.userId})`);
verifier(trace?.username === 'demo-log-sans-nom', `username vient de la session (reçu ${JSON.stringify(trace?.username)})`);
// Le compte n'a pas de nom complet : le champ doit rester VIDE, et surtout pas reprendre
// la valeur envoyée. C'est le repli `|| record.fullName` qui laissait passer ce mensonge.
verifier(trace?.fullName === '', `fullName reste vide et n’est pas « Direction Générale » (reçu ${JSON.stringify(trace?.fullName)})`);
verifier(trace?.timestamp !== REVENDICATION.timestamp, 'l’horodatage revendiqué est écarté');
verifier(typeof trace?.timestamp === 'number', 'et celui qui le remplace est bien un nombre');
verifier(trace?.dateStr !== REVENDICATION.dateStr, `la date affichée revendiquée est écartée (reçu ${JSON.stringify(trace?.dateStr)})`);
verifier(trace?.serverReceivedAt !== REVENDICATION.serverReceivedAt, 'la date de réception revendiquée est écartée');
// Ce que le client A le droit de fournir doit, lui, survivre intact.
verifier(trace?.type === 'inventaire' && trace?.action === 'modification',
  'les données métier fournies par le client sont conservées');

console.log('');
if (echecs === 0) console.log(`╚═══ ✅ ${verifications} vérifications, aucun échec ═══╝\n`);
else console.log(`╚═══ ❌ ${echecs} échec(s) sur ${verifications} vérifications ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
