/**
 * @file scripts/screen-group-zone-e2e.mjs — SCREEN-GROUP-ZONE-01, l'épreuve réelle de #119.
 *
 * CE QUE CE FICHIER PROUVE, ET POURQUOI IL NE PEUT PAS ÊTRE UN TEST DE SOURCE
 * ---------------------------------------------------------------------------
 * Un `screen_groups` porte un `roomId` ET une liste `screenIds`. Avant ce lot,
 * `resolveResourceZones` atteignait le repli générique `record.roomId` AVANT d'avoir
 * regardé la liste : la portée du groupe se décidait sur sa seule salle. Un enregistrement
 * hérité `roomId: salle A` + `screenIds: [écran A, écran B]` était donc résolu « zone A »,
 * et la lecture ordinaire — qui se contente d'UNE zone accordée (`decisions.some`) — le
 * servait entier à un utilisateur scopé zone A.
 *
 * Mesuré sur `15f70e9` : le technicien de la zone A recevait le groupe, et avec lui
 * l'identifiant opaque de l'écran de la zone B, dans le corps de `/api/sync`.
 *
 * Aucune lecture de source ne peut établir cela : il faut le vrai serveur, la vraie base et
 * la vraie sérialisation. C'est ce que fait ce fichier.
 *
 * Les enregistrements incohérents sont semés DIRECTEMENT en base, comme le fait
 * `screen-issues-catalog-e2e.mjs` pour ses enregistrements hérités : ils simulent des
 * données antérieures au contrat de ce lot, et les poser par l'API reviendrait à les faire
 * passer par la règle d'écriture qui, précisément, les refuse désormais (§ SGZ-4).
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… npm start &
 *   DATABASE_URL=… node scripts/screen-group-zone-e2e.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  poserLeDecorScreenDiag, connexion,
  ZONE_A, ZONE_B, SALLE_A, SALLE_B, ECRAN_A, ECRAN_B, NOM_ECRAN_B, NOM_SALLE_B,
  COMPTE_TECHNICIEN, COMPTE_TECHNICIEN_SANS_ZONE, COMPTE_VISITEUR
} from './screen-diag-decor.mjs';
import { BASE, MOT_DE_PASSE } from './ui-polish-decor.mjs';

const base = process.env.E2E_BASE_URL || BASE;
const ADMIN_USERNAME = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Kt5-Genepi-Sillon-Rz9!';

const databaseUrl = process.env.DATABASE_URL || '';
assert.ok(databaseUrl, 'DATABASE_URL est requis : ce script sème directement en base les enregistrements hérités.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

const CROISE = 'sgz-groupe-croise';        // salle A + [écran A, écran B] — l'incohérent de #119
const FANTOME = 'sgz-groupe-ecran-absent'; // salle A + [écran inexistant] — portée indécidable
const COHERENT = 'sgz-groupe-coherent';    // salle A + [écran A] — doit survivre
const SANS_ECRAN = 'sgz-groupe-sans-ecran';// salle A + [] — forme légitime, doit survivre

let controles = 0;
let echecs = 0;
const ok = (nom, condition, detail = '') => {
  controles += 1;
  if (condition) { console.log(`  OK   ${nom}${detail ? ` — ${detail}` : ''}`); return true; }
  echecs += 1;
  console.log(`  KO   ${nom}${detail ? ` — ${detail}` : ''}`);
  return false;
};

async function semer(recordId, data) {
  await pool.query(
    `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
     VALUES('screen_groups',$1,$2::jsonb,FALSE,NOW())
     ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=FALSE,updated_at=NOW()`,
    [recordId, JSON.stringify(data)]
  );
}

/** L'état réel en base, seule preuve recevable de ce qui a été persisté ou non. */
async function enBase(recordId) {
  const { rows } = await pool.query(
    `SELECT data FROM platform_records WHERE store_name='screen_groups' AND record_id=$1 AND deleted=FALSE`,
    [recordId]
  );
  return rows[0]?.data ?? null;
}

async function sync(cookie) {
  const reponse = await fetch(`${base}/api/sync`, { headers: { cookie } });
  const brut = await reponse.text();
  let charge = null;
  try { charge = JSON.parse(brut); } catch { /* le corps brut suffit aux recherches en clair */ }
  return { status: reponse.status, brut, groupes: charge?.data?.screen_groups || [] };
}

async function ecrireGroupe(cookie, id, corps) {
  const reponse = await fetch(`${base}/api/data/screen_groups/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(corps)
  });
  const brut = await reponse.text();
  let charge = null;
  try { charge = JSON.parse(brut); } catch { /* une erreur peut n'être pas du JSON */ }
  return { status: reponse.status, code: charge?.error, details: charge?.details || [], record: charge?.record };
}

console.log('\n╔═══ SCREEN-GROUP-ZONE-01 — #119 · ' + base + ' ═══╗\n');

await poserLeDecorScreenDiag({ trace: false });
console.log('SGZ-0 · décor et enregistrements hérités');
await semer(CROISE, { id: CROISE, name: 'Groupe hérité inter-zones', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B], _revision: 0 });
await semer(FANTOME, { id: FANTOME, name: 'Groupe à écran absent', roomId: SALLE_A, screenIds: ['sgz-ecran-inexistant'], _revision: 0 });
await semer(COHERENT, { id: COHERENT, name: 'Groupe cohérent zone A', roomId: SALLE_A, screenIds: [ECRAN_A], _revision: 0 });
await semer(SANS_ECRAN, { id: SANS_ECRAN, name: 'Groupe sans écran', roomId: SALLE_A, screenIds: [], _revision: 0 });
ok('quatre groupes semés', (await enBase(CROISE)) && (await enBase(FANTOME)) && (await enBase(COHERENT)) && (await enBase(SANS_ECRAN)));

const admin = await connexion({ username: ADMIN_USERNAME, motDePasse: ADMIN_PASSWORD });
const technicien = await connexion({ username: COMPTE_TECHNICIEN.username, motDePasse: MOT_DE_PASSE });
const technicienHorsZone = await connexion({ username: COMPTE_TECHNICIEN_SANS_ZONE.username, motDePasse: MOT_DE_PASSE });
const visiteur = await connexion({ username: COMPTE_VISITEUR.username, motDePasse: MOT_DE_PASSE });

console.log('\nSGZ-1 · lecture fail-closed — le groupe incohérent n’atteint aucun rôle scopé');
for (const [nom, session] of [['Technicien zone A', technicien], ['Technicien sans zone', technicienHorsZone], ['Visiteur', visiteur]]) {
  const vue = await sync(session.cookie);
  const recu = vue.groupes.some(groupe => groupe.id === CROISE);
  ok(`${nom} ne reçoit pas le groupe inter-zones`, !recu);
  ok(`${nom} ne reçoit pas le groupe à écran absent`, !vue.groupes.some(groupe => groupe.id === FANTOME));
}

console.log('\nSGZ-2 · le corps sérialisé complet ne porte aucun identifiant de la zone B');
{
  const vue = await sync(technicien.cookie);
  ok('aucun identifiant d’écran zone B dans /api/sync', !vue.brut.includes(ECRAN_B), 'recherché en clair dans le corps entier');
  ok('aucun nom d’écran zone B', !vue.brut.includes(NOM_ECRAN_B));
  ok('aucun nom de salle zone B', !vue.brut.includes(NOM_SALLE_B));
}

console.log('\nSGZ-3 · les groupes légitimes survivent');
{
  const vue = await sync(technicien.cookie);
  ok('groupe cohérent salle A + [écran A] reçu', vue.groupes.some(groupe => groupe.id === COHERENT));
  ok('groupe sans écran reçu — forme légitime, non refusée', vue.groupes.some(groupe => groupe.id === SANS_ECRAN));
}

console.log('\nSGZ-4 · l’administrateur garde la visibilité globale pour réparer');
{
  const vue = await sync(admin.cookie);
  ok('administrateur voit le groupe inter-zones', vue.groupes.some(groupe => groupe.id === CROISE));
  ok('administrateur voit le groupe à écran absent', vue.groupes.some(groupe => groupe.id === FANTOME));
}

console.log('\nSGZ-5 · CRÉATION — la forme contradictoire ne se persiste pas, même pour l’administrateur');
for (const [libelle, id, corps, statutAttendu] of [
  ['salle A + [écran A] accepté', 'sgz-w-valide', { id: 'sgz-w-valide', name: 'valide', roomId: SALLE_A, screenIds: [ECRAN_A] }, 200],
  ['salle A + [] accepté', 'sgz-w-vide', { id: 'sgz-w-vide', name: 'vide', roomId: SALLE_A, screenIds: [] }, 200],
  ['sans salle + [écran A] accepté', 'sgz-w-sans-salle', { id: 'sgz-w-sans-salle', name: 'sans salle', screenIds: [ECRAN_A] }, 200],
  ['salle A + [écran A, écran B] refusé', 'sgz-w-mixte', { id: 'sgz-w-mixte', name: 'mixte', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B] }, 400],
  ['salle A + [écran B] refusé', 'sgz-w-zone-b', { id: 'sgz-w-zone-b', name: 'zone b', roomId: SALLE_A, screenIds: [ECRAN_B] }, 400],
  ['salle A + [écran inconnu] refusé', 'sgz-w-inconnu', { id: 'sgz-w-inconnu', name: 'inconnu', roomId: SALLE_A, screenIds: ['sgz-ecran-inexistant'] }, 400],
  ['sans salle + [écran A, écran B] refusé', 'sgz-w-ab', { id: 'sgz-w-ab', name: 'ab', screenIds: [ECRAN_A, ECRAN_B] }, 400]
]) {
  const reponse = await ecrireGroupe(admin.cookie, id, corps);
  const persiste = Boolean(await enBase(id));
  const attenduPersiste = statutAttendu === 200;
  ok(libelle, reponse.status === statutAttendu && persiste === attenduPersiste,
    `HTTP ${reponse.status}${reponse.code ? ` ${reponse.code}` : ''}, persisté=${persiste}`);
  if (statutAttendu === 400) ok(`${libelle} — code de contrat`, reponse.code === 'INVALID_SCREEN_GROUP_SCOPE', reponse.code);
}

console.log('\nSGZ-6 · MISE À JOUR — le refus laisse l’enregistrement existant intact');
{
  const avant = await enBase('sgz-w-valide');
  const reponse = await ecrireGroupe(admin.cookie, 'sgz-w-valide', {
    id: 'sgz-w-valide', name: 'devenu mixte', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B],
    expectedRevision: avant?._revision
  });
  const apres = await enBase('sgz-w-valide');
  ok('mise à jour vers une forme mixte refusée', reponse.status === 400 && reponse.code === 'INVALID_SCREEN_GROUP_SCOPE', `HTTP ${reponse.status} ${reponse.code}`);
  ok('enregistrement existant inchangé', JSON.stringify(apres?.screenIds) === JSON.stringify(avant?.screenIds) && apres?.name === avant?.name,
    `screenIds=${JSON.stringify(apres?.screenIds)} name=${apres?.name}`);
}

console.log('\nSGZ-7 · un groupe redevenu cohérent est de nouveau lisible');
{
  const avant = await enBase(CROISE);
  const reponse = await ecrireGroupe(admin.cookie, CROISE, {
    ...avant, screenIds: [ECRAN_A], expectedRevision: avant?._revision
  });
  ok('réparation acceptée', reponse.status === 200, `HTTP ${reponse.status}`);
  const vue = await sync(technicien.cookie);
  ok('le technicien zone A le reçoit après réparation', vue.groupes.some(groupe => groupe.id === CROISE));
  ok('toujours aucun identifiant zone B dans le corps', !vue.brut.includes(ECRAN_B));
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * PASSE 2 — LES CONTOURNEMENTS QUE LA PREMIÈRE VERSION LAISSAIT VIVANTS
 *
 * La branche des groupes était posée APRÈS le court-circuit `direct`/`mapped` de
 * `resolveResourceZones` : elle n'était donc atteinte que pour un groupe SANS revendication
 * de zone. Un gate indépendant a montré trois contournements de lecture et, surtout, une
 * fabrication par l'API ordinaire. Ce qui suit les éprouve un par un.
 * ══════════════════════════════════════════════════════════════════════════════════════ */

const ATTAQUES = [
  ['zoneId direct', 'sgz-b-zoneid', { roomId: SALLE_A, zoneId: ZONE_A, screenIds: [ECRAN_B] }],
  ['zoneIds direct', 'sgz-b-zoneids', { zoneIds: [ZONE_A], screenIds: [ECRAN_B] }],
  ['zoneId + salle concordante', 'sgz-b-zoneid-salle', { roomId: SALLE_A, zoneId: ZONE_A, screenIds: [ECRAN_B] }],
  ['mapping resource_zones', 'sgz-b-mapping', { screenIds: [ECRAN_B] }],
  ['salle déclarée inexistante', 'sgz-b-salle-absente', { roomId: 'sgz-salle-inexistante', screenIds: [ECRAN_A] }]
];

console.log('\nSGZ-8 · une revendication de zone portée par le groupe n’ouvre plus rien');
for (const [libelle, id, forme] of ATTAQUES) {
  await semer(id, { id, name: libelle, ...forme, _revision: 0 });
}
await pool.query(
  `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
   VALUES('resource_zones','sgz-rz-mapping',$1::jsonb,FALSE,NOW())
   ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=FALSE,updated_at=NOW()`,
  [JSON.stringify({ id: 'sgz-rz-mapping', resourceType: 'screen_group', resourceId: 'sgz-b-mapping', zoneId: ZONE_A, createdAt: new Date().toISOString() })]
);
{
  const vue = await sync(technicien.cookie);
  for (const [libelle, id] of ATTAQUES.map(([libelle, id]) => [libelle, id])) {
    ok(`technicien zone A — ${libelle} : groupe fermé`, !vue.groupes.some(groupe => groupe.id === id));
  }
  ok('aucun identifiant d’écran zone B dans le corps complet', !vue.brut.includes(ECRAN_B));
}

console.log('\nSGZ-9 · l’administrateur garde ces enregistrements pour les réparer');
{
  const vue = await sync(admin.cookie);
  ok('administrateur voit les groupes à revendication de zone',
    ATTAQUES.every(([, id]) => vue.groupes.some(groupe => groupe.id === id)));
}

console.log('\nSGZ-10 · ÉCRITURE ORDINAIRE — un technicien habilité ne fabrique plus la fuite');
{
  // Le droit est LÉGITIME : `screen.edit` sur la zone A, accordé par l'administrateur.
  await fetch(`${base}/api/access/grants`, {
    method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ userId: COMPTE_TECHNICIEN.id, zoneId: ZONE_A, permission: 'screen.edit' })
  });
  const habilite = await connexion({ username: COMPTE_TECHNICIEN.username, motDePasse: MOT_DE_PASSE });
  for (const [libelle, id, corps] of [
    ['zoneId revendiqué', 'sgz-w-att-zoneid', { id: 'sgz-w-att-zoneid', name: 'attaque', zoneId: ZONE_A, screenIds: [ECRAN_B] }],
    ['zoneIds revendiqués', 'sgz-w-att-zoneids', { id: 'sgz-w-att-zoneids', name: 'attaque', zoneIds: [ZONE_A], screenIds: [ECRAN_B] }],
    ['zoneId + salle A + écran B', 'sgz-w-att-mixte', { id: 'sgz-w-att-mixte', name: 'attaque', roomId: SALLE_A, zoneId: ZONE_A, screenIds: [ECRAN_B] }]
  ]) {
    const reponse = await ecrireGroupe(habilite.cookie, id, corps);
    const persiste = Boolean(await enBase(id));
    ok(`technicien — ${libelle} refusé`, reponse.status >= 400 && !persiste,
      `HTTP ${reponse.status}${reponse.code ? ` ${reponse.code}` : ''}, persisté=${persiste}`);
  }
  const vue = await sync(habilite.cookie);
  ok('après les tentatives, toujours aucun identifiant zone B', !vue.brut.includes(ECRAN_B));
}

console.log('\nSGZ-11 · SALLE DÉCLARÉE MAIS IRRÉSOLVABLE — refusée en écriture');
for (const [libelle, id, corps] of [
  ['salle inexistante', 'sgz-w-salle-absente', { id: 'sgz-w-salle-absente', name: 'x', roomId: 'sgz-salle-inexistante', screenIds: [ECRAN_A] }],
  ['salle inexistante sans écran', 'sgz-w-salle-absente-vide', { id: 'sgz-w-salle-absente-vide', name: 'x', roomId: 'sgz-salle-inexistante', screenIds: [] }]
]) {
  const reponse = await ecrireGroupe(admin.cookie, id, corps);
  const persiste = Boolean(await enBase(id));
  ok(libelle + ' refusée', reponse.status === 400 && reponse.code === 'INVALID_SCREEN_GROUP_SCOPE' && !persiste,
    `HTTP ${reponse.status} ${reponse.code}, persisté=${persiste}`);
}

console.log('\nSGZ-12 · le report À L’IDENTIQUE d’une revendication héritée reste permis');
{
  // `deleteScreenSafely` réenregistre `{...g, screenIds: filtrés}` : refuser le report
  // empêcherait de retirer un écran d'un groupe ancien. La valeur est inerte — la lecture
  // ne s'y fie plus — et ce contrôle défend cette porte étroite, sans l'élargir.
  await semer('sgz-legacy-report', { id: 'sgz-legacy-report', name: 'hérité', roomId: SALLE_A, zoneId: ZONE_A, screenIds: [ECRAN_A], _revision: 0 });
  const avant = await enBase('sgz-legacy-report');
  const report = await ecrireGroupe(admin.cookie, 'sgz-legacy-report', { ...avant, screenIds: [ECRAN_A], expectedRevision: avant._revision });
  ok('report identique accepté', report.status === 200, `HTTP ${report.status} ${report.code || ''}`);
  const change = await ecrireGroupe(admin.cookie, 'sgz-legacy-report', { ...avant, zoneId: ZONE_B, expectedRevision: (await enBase('sgz-legacy-report'))._revision });
  ok('changement de la revendication refusé', change.status === 400 && change.code === 'INVALID_SCREEN_GROUP_SCOPE',
    `HTTP ${change.status} ${change.code}`);
}

console.log('\nSGZ-13 · RÈGLE « TOUTES LES ZONES » — Manager réel et technicien bi-zone');
{
  const MANAGER = { id: 9301, username: 'sgz-manager', role: 'manager' };
  const BIZONE = { id: 9302, username: 'sgz-technicien-ab', role: 'technician' };
  for (const compte of [MANAGER, BIZONE]) {
    await fetch(`${base}/api/data/users/${compte.id}`, {
      method: 'PUT', headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: compte.id, username: compte.username, fullName: `Compte ${compte.username}`,
        role: compte.role, status: 'active',
        password: Buffer.from(MOT_DE_PASSE).toString('base64'), authVersion: 1
      })
    });
  }
  for (const zoneId of [ZONE_A, ZONE_B]) {
    await fetch(`${base}/api/access/memberships`, {
      method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: BIZONE.id, zoneId, role: 'technician' })
    });
    await fetch(`${base}/api/access/grants`, {
      method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: BIZONE.id, zoneId, permission: 'screen.read' })
    });
  }
  // Le groupe VRAIMENT mixte, par sa salle et ses écrans : aucune revendication de zone.
  await semer('sgz-mixte-canonique', { id: 'sgz-mixte-canonique', name: 'mixte canonique', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B], _revision: 0 });

  const manager = await connexion({ username: MANAGER.username, motDePasse: MOT_DE_PASSE });
  const bizone = await connexion({ username: BIZONE.username, motDePasse: MOT_DE_PASSE });
  const vueManager = await sync(manager.cookie);
  const vueBizone = await sync(bizone.cookie);
  const vueA = await sync(technicien.cookie);
  ok('technicien zone A seule — refusé', !vueA.groupes.some(groupe => groupe.id === 'sgz-mixte-canonique'));
  ok('technicien zones A ET B — accordé', vueBizone.groupes.some(groupe => groupe.id === 'sgz-mixte-canonique'));
  ok('manager — visible (visibilité globale)', vueManager.groupes.some(groupe => groupe.id === 'sgz-mixte-canonique'));

  // Écriture : le privilège global ne dispense pas de la structure.
  const ecritureManager = await ecrireGroupe(manager.cookie, 'sgz-w-manager', {
    id: 'sgz-w-manager', name: 'manager', zoneId: ZONE_A, screenIds: [ECRAN_B]
  });
  ok('manager — écriture à revendication de zone refusée',
    ecritureManager.status >= 400 && !(await enBase('sgz-w-manager')),
    `HTTP ${ecritureManager.status} ${ecritureManager.code || ''}`);
}

console.log('\nSGZ-14 · IMPORTS EN MASSE — la fuite reste fermée en lecture');
for (const [libelle, route, charge] of [
  ['bootstrap', '/api/sync/bootstrap', { data: { screen_groups: [
    { id: 'sgz-boot-zoneid', name: 'boot zoneId', zoneId: ZONE_A, screenIds: [ECRAN_B] },
    { id: 'sgz-boot-mixte', name: 'boot mixte', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B] }
  ] } }],
  ['inventory-replace', '/api/sync/inventory-replace', { data: { screen_groups: [
    { id: 'sgz-inv-zoneid', name: 'inv zoneId', zoneId: ZONE_A, screenIds: [ECRAN_B] }
  ] } }]
]) {
  const reponse = await fetch(`${base}${route}`, {
    method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(charge)
  });
  const vue = await sync(technicien.cookie);
  const aucunGroupeFautif = !vue.groupes.some(groupe => String(groupe.id).startsWith('sgz-boot-') || String(groupe.id).startsWith('sgz-inv-'));
  ok(`${libelle} — rien de fautif n’atteint le technicien zone A`, aucunGroupeFautif, `HTTP ${reponse.status}`);
  ok(`${libelle} — aucun identifiant zone B dans le corps`, !vue.brut.includes(ECRAN_B));
}

console.log('\nSGZ-16 · UN ÉCRAN SANS ZONE NE SE LAISSE PAS COUVRIR PAR LA SALLE');
{
  /*
   * Un écran peut EXISTER sans être rattaché : ni mur, ni salle. Sa zone est alors vide.
   * Si le groupe se contentait de la zone de sa salle, cet écran hors périmètre voyagerait
   * avec lui — la portée du groupe couvrirait un objet dont personne ne sait rien. C'est la
   * même faute que #119, à une étape près.
   */
  await pool.query(
    `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
     VALUES('screens','sgz-ecran-orphelin',$1::jsonb,FALSE,NOW())
     ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=FALSE,updated_at=NOW()`,
    [JSON.stringify({ id: 'sgz-ecran-orphelin', name: 'Écran sans rattachement', _revision: 0 })]
  );
  await semer('sgz-groupe-orphelin', { id: 'sgz-groupe-orphelin', name: 'salle A + écran orphelin', roomId: SALLE_A, screenIds: [ECRAN_A, 'sgz-ecran-orphelin'], _revision: 0 });
  const vue = await sync(technicien.cookie);
  ok('groupe portant un écran sans zone : fermé', !vue.groupes.some(groupe => groupe.id === 'sgz-groupe-orphelin'));
  ok('l’identifiant de l’écran sans zone n’atteint pas le technicien', !vue.brut.includes('sgz-ecran-orphelin'));
  const ecriture = await ecrireGroupe(admin.cookie, 'sgz-w-orphelin', {
    id: 'sgz-w-orphelin', name: 'orphelin', roomId: SALLE_A, screenIds: ['sgz-ecran-orphelin']
  });
  ok('écriture d’un groupe portant un écran sans zone refusée',
    ecriture.status === 400 && ecriture.code === 'INVALID_SCREEN_GROUP_SCOPE' && !(await enBase('sgz-w-orphelin')),
    `HTTP ${ecriture.status} ${ecriture.code || ''}`);
}

console.log('\nSGZ-15 · GROUPES DÉRIVÉS #116 — la collision d’identifiant ne réintroduit rien');
{
  // Les groupes dérivés portent l'identifiant `room_<salleId>`. Un enregistrement PERSISTÉ
  // qui usurperait cet identifiant ne doit pas rentrer par la projection.
  const usurpateur = `room_${SALLE_A}`;
  await semer(usurpateur, { id: usurpateur, name: 'usurpation dérivée', roomId: SALLE_A, screenIds: [ECRAN_A, ECRAN_B], _revision: 0 });
  const vue = await sync(technicien.cookie);
  ok('l’enregistrement usurpant l’identifiant dérivé est fermé', !vue.groupes.some(groupe => groupe.id === usurpateur));
  ok('aucun identifiant zone B par la projection', !vue.brut.includes(ECRAN_B));
  // Un groupe dérivé légitime — salle A, écrans de la salle A — reste servi.
  await semer('sgz-derive-legitime', { id: 'sgz-derive-legitime', name: 'dérivé légitime', roomId: SALLE_A, screenIds: [ECRAN_A], _revision: 0 });
  const vue2 = await sync(technicien.cookie);
  ok('un groupe dérivé cohérent reste servi', vue2.groupes.some(groupe => groupe.id === 'sgz-derive-legitime'));
}

await pool.end();
console.log(`\n${controles - echecs}/${controles} contrôles passés.\n`);
if (echecs) process.exit(1);
