/**
 * @file scripts/screen-diag-decor.mjs — le décor propre au lot SCREEN-DIAG-TECH-01.
 *
 * POURQUOI UN DÉCOR EN PLUS
 * -------------------------
 * Le défaut de #110 ne se mesure qu'avec DEUX zones. Le décor de UI-POLISH n'en pose
 * qu'une : tout y est autorisé au technicien, si bien qu'une écriture hors zone n'a
 * nulle part où fuir et qu'un 403 hors périmètre ne peut pas se produire.
 *
 * Celui-ci ajoute donc l'asymétrie qui manque :
 *
 *   Zone A — le technicien en est membre, avec `diagnostic.run` et `screen.read`.
 *            Une salle, un mur, un écran.
 *   Zone B — le technicien n'en est PAS membre. Une salle, un mur, un écran.
 *
 * Le technicien ne reçoit VOLONTAIREMENT pas `screen.edit`, ni en A ni en B : c'est le
 * contrat réel d'un diagnostiqueur — il constate, il ne réaménage pas le mur. Cette
 * absence n'est pas une facilité d'épreuve, c'est la configuration qui produit le défaut
 * mesuré, y compris DANS sa propre zone.
 *
 * Aucun `screen_groups` n'est posé : leur absence est l'état de départ du RED, et le
 * décor la RÉTABLIT à chaque exécution en retirant ceux qu'une exécution précédente
 * aurait laissés.
 */
import { BASE, MOT_DE_PASSE } from './ui-polish-decor.mjs';

const ADMIN_USERNAME = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Kt5-Genepi-Sillon-Rz9!';

export const ZONE_A = 'diag-zone-a';
export const ZONE_B = 'diag-zone-b';
export const SALLE_A = 'diag-salle-a';
export const SALLE_B = 'diag-salle-b';
export const MUR_A = 'diag-mur-a';
export const MUR_B = 'diag-mur-b';
export const ECRAN_A = 'diag-ecran-a';
export const ECRAN_B = 'diag-ecran-b';
export const GROUPE_A = `room_${SALLE_A}`;
export const GROUPE_B = `room_${SALLE_B}`;
/** Le problème référencé qui rend le VRAI workflow de diagnostic exécutable. */
export const PROBLEME = 'diag-probleme-signal';

/** Le nom de la salle B ne doit JAMAIS atteindre l'écran du technicien : il est distinctif exprès. */
export const NOM_SALLE_B = 'Salle interdite Zulu';
export const NOM_ECRAN_B = 'Écran interdit Zulu';

export const COMPTE_TECHNICIEN = Object.freeze({
  id: 9204, username: 'diag-technicien', role: 'technician', motDePasse: MOT_DE_PASSE
});
/** Un second technicien, membre d'AUCUNE zone : le cas fail-closed pur. */
export const COMPTE_TECHNICIEN_SANS_ZONE = Object.freeze({
  id: 9205, username: 'diag-technicien-hors-zone', role: 'technician', motDePasse: MOT_DE_PASSE
});
export const COMPTE_VISITEUR = Object.freeze({
  id: 9206, username: 'diag-visiteur', role: 'visitor', motDePasse: MOT_DE_PASSE
});

/**
 * Les habilitations du technicien — celles d'un diagnostiqueur, et rien de plus.
 *
 * `screen.edit` est ABSENT : c'est le point du lot. Un technicien qui diagnostique lit le
 * mur et consigne un constat ; il ne modifie pas la définition des écrans. Lui accorder
 * `screen.edit` pour faire passer l'épreuve reviendrait à corriger le défaut en élargissant
 * ses droits — précisément ce que #110 interdit.
 */
const HABILITATIONS_TECHNICIEN = Object.freeze([
  'zone.summary.read', 'equipment.read', 'screen.read', 'ticket.read', 'diagnostic.run'
]);

async function requete(chemin, { method = 'GET', cookie = '', body, expected = null } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null && reponse.status !== expected) {
    throw new Error(`${method} ${chemin} : attendu ${expected}, reçu ${reponse.status} — ${texte.slice(0, 300)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

export async function connexion({ username, motDePasse }) {
  const reponse = await requete('/api/auth/login', {
    method: 'POST', body: { username, password: motDePasse }, expected: 200
  });
  return { cookie: reponse.cookie, utilisateur: reponse.charge?.user };
}

/** Les révisions en place, lues une fois : le décor est idempotent. */
async function chargerRevisions(cookie) {
  const instantane = await requete('/api/sync', { cookie, expected: 200 });
  const table = new Map();
  for (const [magasin, enregistrements] of Object.entries(instantane.charge?.data || {})) {
    for (const enregistrement of enregistrements || []) {
      if (enregistrement?.id === undefined || enregistrement?._revision === undefined) continue;
      table.set(`${magasin}:${enregistrement.id}`, enregistrement._revision);
    }
  }
  return table;
}

async function ecrire(table, cookie, magasin, id, corps) {
  const revision = table.get(`${magasin}:${id}`);
  const reponse = await requete(`/api/data/${magasin}/${encodeURIComponent(id)}`, {
    method: 'PUT', cookie,
    body: revision === undefined ? corps : { ...corps, expectedRevision: revision },
    expected: 200
  });
  const posee = reponse.charge?.record?._revision;
  if (posee !== undefined) table.set(`${magasin}:${id}`, posee);
  return reponse;
}

/** Retire un `screen_groups` s'il existe : l'absence est l'état de départ du RED. */
export async function retirerGroupes(cookie, identifiants = [GROUPE_A, GROUPE_B]) {
  const table = await chargerRevisions(cookie);
  for (const id of identifiants) {
    const revision = table.get(`screen_groups:${id}`);
    if (revision === undefined) continue;
    await requete(`/api/data/screen_groups/${encodeURIComponent(id)}?expectedRevision=${revision}`, {
      method: 'DELETE', cookie, expected: 200
    });
  }
}

/** Pose un `screen_groups` côté administrateur — le cas « groupe précréé ». */
export async function poserGroupe(cookie, { id, nom, salleId, ecranIds }) {
  const table = await chargerRevisions(cookie);
  await ecrire(table, cookie, 'screen_groups', id, {
    id, name: nom, screenIds: ecranIds, roomId: salleId, createdAt: new Date().toISOString()
  });
}

export async function poserLeDecorScreenDiag({ trace = true } = {}) {
  const journal = message => { if (trace) console.log(message); };
  const admin = await connexion({ username: ADMIN_USERNAME, motDePasse: ADMIN_PASSWORD });
  if (!admin.cookie.startsWith('tp_session=')) throw new Error('cookie administrateur absent');
  const table = await chargerRevisions(admin.cookie);

  for (const [id, nom] of [[ZONE_A, 'Zone A — diagnostic'], [ZONE_B, 'Zone B — interdite au technicien']]) {
    await requete('/api/access/zones', {
      method: 'POST', cookie: admin.cookie,
      body: { id, name: nom, publicSummary: 'Zone d’épreuve du lot SCREEN-DIAG-TECH-01.' }, expected: 200
    });
  }
  journal(`  · zones posées : ${ZONE_A} (autorisée) et ${ZONE_B} (interdite)`);

  for (const compte of [COMPTE_TECHNICIEN, COMPTE_TECHNICIEN_SANS_ZONE, COMPTE_VISITEUR]) {
    await ecrire(table, admin.cookie, 'users', compte.id, {
      id: compte.id, username: compte.username, fullName: `Compte ${compte.username}`,
      role: compte.role, status: 'active',
      password: Buffer.from(compte.motDePasse).toString('base64'), authVersion: 1
    });
  }
  // SEUL le technicien de la zone A est membre — et d'AUCUNE autre zone.
  await requete('/api/access/memberships', {
    method: 'POST', cookie: admin.cookie,
    body: { userId: COMPTE_TECHNICIEN.id, zoneId: ZONE_A, responsible: false, expiresAt: null }, expected: 200
  });
  for (const permission of HABILITATIONS_TECHNICIEN) {
    await requete('/api/access/grants', {
      method: 'POST', cookie: admin.cookie,
      body: { userId: COMPTE_TECHNICIEN.id, zoneId: ZONE_A, permission, expiresAt: null }, expected: 200
    });
  }
  await requete('/api/access/memberships', {
    method: 'POST', cookie: admin.cookie,
    body: { userId: COMPTE_VISITEUR.id, zoneId: ZONE_A, responsible: false, expiresAt: null }, expected: 200
  });
  await requete('/api/access/grants', {
    method: 'POST', cookie: admin.cookie,
    body: { userId: COMPTE_VISITEUR.id, zoneId: ZONE_A, permission: 'zone.summary.read', expiresAt: null }, expected: 200
  });
  journal(`  · technicien ${COMPTE_TECHNICIEN.username} : membre de ${ZONE_A}, habilitations ${HABILITATIONS_TECHNICIEN.join(', ')} (PAS screen.edit)`);

  const salles = [
    { id: SALLE_A, name: 'Salle A — régie diagnostic', zoneId: ZONE_A },
    { id: SALLE_B, name: NOM_SALLE_B, zoneId: ZONE_B }
  ];
  for (const salle of salles) {
    await ecrire(table, admin.cookie, 'rooms', salle.id, { ...salle, location: 'Casablanca' });
    await requete('/api/access/resource-zones', {
      method: 'POST', cookie: admin.cookie,
      body: { resourceType: 'room', resourceId: salle.id, zoneId: salle.zoneId }, expected: 200
    });
  }
  journal('  · 2 salles posées, une par zone');

  const murs = [
    { id: MUR_A, name: 'Mur A', roomId: SALLE_A },
    { id: MUR_B, name: 'Mur B', roomId: SALLE_B }
  ];
  for (const mur of murs) {
    await ecrire(table, admin.cookie, 'walls', mur.id, { ...mur, layout: {}, updatedAt: new Date().toISOString() });
  }

  const ecrans = [
    { id: ECRAN_A, name: 'Écran A', roomId: SALLE_A, wallId: MUR_A },
    { id: ECRAN_B, name: NOM_ECRAN_B, roomId: SALLE_B, wallId: MUR_B }
  ];
  for (const ecran of ecrans) {
    await ecrire(table, admin.cookie, 'screens', ecran.id, {
      ...ecran, status: 'ok', serialNumber: `SN-${ecran.id}`,
      position: { x: 20, y: 20, width: 30, height: 30, unit: '%' },
      positionX: 20, positionY: 20, width: 30, height: 30,
      updatedAt: new Date().toISOString()
    });
  }
  journal('  · 2 murs et 2 écrans posés, un par zone');

  /*
   * Un problème référencé, sans quoi « Commencer le diagnostic » n'a rien à ouvrir :
   * le workflow réel ne se mesure pas sur une base qui ne décrit aucune panne.
   *
   * Il DÉSIGNE l'écran A, et ce n'est pas un détail de décor. `resolveResourceZones`
   * dérive la zone d'un `screen_issues` de ses écrans ; un problème qui n'en désigne
   * aucun n'a aucune zone, et la règle fail-closed du serveur le rend alors invisible à
   * TOUT rôle à périmètre — un catalogue « appliesToAll » n'atteint personne. Le constat
   * est réel et signalé à part : il PRÉEXISTE à ce lot et n'en relève pas.
   */
  await ecrire(table, admin.cookie, 'screen_issues', PROBLEME, {
    id: PROBLEME, name: 'Écran noir', description: 'Aucun signal affiché.',
    appliesToAll: true, scope: 'operational', screenIds: [ECRAN_A],
    steps: [
      { question: 'Le câble est-il correctement branché ?', type: 'boolean' },
      { question: 'Décrivez le résultat de vos vérifications', type: 'text' }
    ],
    updatedAt: new Date().toISOString()
  });
  journal(`  · problème « Écran noir » posé (${PROBLEME}) : le workflow réel est exécutable`);

  await retirerGroupes(admin.cookie);
  journal('  · aucun screen_groups : l’absence est l’état de départ du RED');

  return { cookieAdmin: admin.cookie, zoneA: ZONE_A, zoneB: ZONE_B, technicien: COMPTE_TECHNICIEN };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\n╔═══ décor SCREEN-DIAG-TECH-01 — ${BASE} ═══╗\n`);
  await poserLeDecorScreenDiag();
  console.log('\n╚═══ décor posé ═══╝\n');
}
