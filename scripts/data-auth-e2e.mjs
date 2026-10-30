/**
 * @file scripts/data-auth-e2e.mjs — DATA-AUTH-01, la salle d'un équipement suit sa baie.
 *
 * L'INVARIANT ÉPROUVÉ ICI
 * ----------------------
 *     Équipement → Baie → Salle → Localisation
 *
 * Quand un équipement appartient à une baie, sa salle canonique est celle de cette baie.
 * `equipment.baieId = B` avec `equipment.roomId ≠ B.roomId` ne doit jamais durer.
 *
 * POURQUOI CE N'EST PAS UN DÉTAIL D'AFFICHAGE
 * --------------------------------------------
 * `access-control.js::resolveResourceZones` résout la zone d'un équipement par son `roomId`
 * AVANT de consulter sa baie. Une salle périmée ne fait donc pas qu'afficher un mauvais
 * libellé : elle décide de l'AUTORISATION.
 *
 * TROIS CHEMINS, ÉPROUVÉS CONTRE UN VRAI SERVEUR
 * -----------------------------------------------
 *   A · déplacement de baie      le seul écrivain qui rompt l'invariant SANS toucher à
 *                                l'équipement. Aucune règle serveur ne le couvrait.
 *   B · paire contradictoire     `baieId` et `roomId` envoyés ensemble et incohérents.
 *   C · import / restauration    `/api/sync/bootstrap` ne vérifiait pas la localisation.
 *
 * Usage :
 *   PORT=4197 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4197 node scripts/data-auth-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4197';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'da-admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Qv7-Bruyere-Cardan-Lx3!';

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
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '', texte };
}

const SALLE_A = 'da-salle-a';
const SALLE_B = 'da-salle-b';
const BAIE = 'da-baie-x';
const EQUIPEMENT = 'da-equipement-e';
const EQUIPEMENT_DIRECT = 'da-equipement-direct';
const EQUIPEMENT_IMPORT = 'da-equipement-import';

console.log(`\n╔═══ la salle suit la baie — ${base} ═══╗\n`);

const admin = await requete('/api/auth/login', {
  method: 'POST', body: { username: adminUsername, password: adminPassword }, expected: 200
});
assert.ok(admin.cookie.startsWith('tp_session='), 'cookie administrateur absent');
const cookie = admin.cookie;

/*
 * LA LECTURE PASSE PAR L'INSTANTANÉ, comme le fait le navigateur.
 *
 * `/api/data/:magasin/:id` n'accepte que PUT et DELETE : il n'y a pas de lecture unitaire.
 * Lire par `/api/sync` est donc le chemin RÉEL — et c'est aussi celui qui porte `_revision`,
 * sans laquelle Batch B refuse toute écriture suivante avec un 409.
 */
async function lire(magasin, id) {
  const instantane = await requete('/api/sync', { cookie, expected: 200 });
  return (instantane.charge?.data?.[magasin] || [])
    .find(enregistrement => String(enregistrement.id) === String(id)) || null;
}

/* ─────────────────────── Le décor : deux salles, une baie ─────────────────────── */

console.log('0 · le décor');
for (const [id, nom] of [[SALLE_A, 'Salle A'], [SALLE_B, 'Salle B']]) {
  await requete(`/api/data/rooms/${id}`, { method: 'PUT', cookie, body: { id, name: nom }, expected: 200 });
}
await requete(`/api/data/baies/${BAIE}`, {
  method: 'PUT', cookie, body: { id: BAIE, name: 'Baie X', roomId: SALLE_A }, expected: 200
});
await requete(`/api/data/equipments/${EQUIPEMENT}`, {
  method: 'PUT', cookie,
  body: { id: EQUIPEMENT, name: 'Équipement E', type: 'Routeur', baieId: BAIE, roomId: SALLE_A },
  expected: 200
});
const initial = await lire('equipments', EQUIPEMENT);
verifier(String(initial.roomId) === SALLE_A, 'au départ, l’équipement est dans la salle de sa baie');

/* ═══════════ A · déplacer la baie : l'équipement doit suivre ═══════════ */

console.log('\n1 · la baie change de salle');
const baieAvant = await lire('baies', BAIE);
const deplacement = await requete(`/api/data/baies/${BAIE}`, {
  method: 'PUT', cookie,
  body: { ...baieAvant, roomId: SALLE_B }
});
verifier(deplacement.statut === 200, `le déplacement de la baie est accepté (${deplacement.statut})`);

const apresDeplacement = await lire('equipments', EQUIPEMENT);
verifier(String(apresDeplacement.baieId) === BAIE, 'l’équipement reste dans sa baie');
verifier(String(apresDeplacement.roomId) === SALLE_B,
  `la salle de l’équipement suit celle de sa baie (attendu ${SALLE_B}, lu ${apresDeplacement.roomId})`);

// Batch B : le réalignement est une écriture comme une autre, il fait avancer le compteur.
verifier(Number(apresDeplacement._revision || 0) > Number(initial._revision || 0),
  `le réalignement fait avancer la révision (${initial._revision} → ${apresDeplacement._revision})`);

/* ═══════════ B · la paire contradictoire envoyée directement ═══════════ */

console.log('\n2 · une paire salle/baie contradictoire, envoyée telle quelle');
const contradictoire = await requete(`/api/data/equipments/${EQUIPEMENT_DIRECT}`, {
  method: 'PUT', cookie,
  body: { id: EQUIPEMENT_DIRECT, name: 'Équipement direct', type: 'Routeur', baieId: BAIE, roomId: SALLE_A }
});
verifier(contradictoire.statut === 400,
  `une paire incohérente est refusée explicitement (reçu ${contradictoire.statut})`);
verifier(String(contradictoire.charge?.error || '').includes('LOCATION'),
  `le refus nomme la localisation (${contradictoire.charge?.error})`);
const absent = await lire('equipments', EQUIPEMENT_DIRECT);
verifier(!absent, 'et rien n’est écrit : pas d’état partiel');

/* ═══════════ C · l'import ne doit pas introduire la contradiction ═══════════ */

console.log('\n3 · import / restauration');
const importation = await requete('/api/sync/bootstrap', {
  method: 'POST', cookie,
  body: {
    data: {
      equipments: [
        { id: EQUIPEMENT_IMPORT, name: 'Équipement importé', type: 'Routeur', baieId: BAIE, roomId: SALLE_A }
      ]
    }
  }
});
const importe = await lire('equipments', EQUIPEMENT_IMPORT);
const importRefuse = importation.statut >= 400;
const importRealigne = importation.statut === 200 && String(importe?.roomId) === SALLE_B;
verifier(importRefuse || importRealigne,
  `l’import refuse la contradiction ou la réaligne — jamais ne l’accepte telle quelle `
  + `(statut ${importation.statut}, salle lue ${importe?.roomId})`);

/* ═══════════ D · l'autorisation suit la salle canonique ═══════════ */

console.log('\n4 · zone et permission');
const instantane = await requete('/api/sync', { cookie });
const vuParLeServeur = (instantane.charge?.data?.equipments || [])
  .find(enregistrement => String(enregistrement.id) === EQUIPEMENT);
verifier(vuParLeServeur && String(vuParLeServeur.roomId) === SALLE_B,
  `l’instantané central porte la salle canonique (lu ${vuParLeServeur?.roomId})`);

/* ═══════════ E · retirer la baie laisse la salle en place ═══════════ */

console.log('\n5 · l’équipement quitte sa baie');
const avantRetrait = await lire('equipments', EQUIPEMENT);
const retrait = await requete(`/api/data/equipments/${EQUIPEMENT}`, {
  method: 'PUT', cookie, body: { ...avantRetrait, baieId: null }
});
verifier(retrait.statut === 200, `le retrait de la baie est accepté (${retrait.statut})`);
const sansBaie = await lire('equipments', EQUIPEMENT);
verifier(sansBaie.baieId === null || sansBaie.baieId === undefined, 'l’équipement n’a plus de baie');
verifier(String(sansBaie.roomId) === SALLE_B,
  `sans baie, la salle directe reste légitime et n’est pas effacée (lu ${sansBaie.roomId})`);

/* ═══════════ F · un équipement sans baie n'est pas touché par un déplacement ═══════════ */

console.log('\n6 · un équipement sans baie ne suit personne');
const libre = 'da-equipement-libre';
await requete(`/api/data/equipments/${libre}`, {
  method: 'PUT', cookie, body: { id: libre, name: 'Équipement libre', type: 'Routeur', roomId: SALLE_A }, expected: 200
});
const baieCourante = await lire('baies', BAIE);
await requete(`/api/data/baies/${BAIE}`, { method: 'PUT', cookie, body: { ...baieCourante, roomId: SALLE_A } });
const apres = await lire('equipments', libre);
verifier(String(apres.roomId) === SALLE_A, 'sa salle directe est intacte');

console.log('');
if (echecs === 0) console.log(`╚═══ ✅ ${verifications} vérifications, aucun échec ═══╝\n`);
else console.log(`╚═══ ❌ ${echecs} échec(s) sur ${verifications} vérifications ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
