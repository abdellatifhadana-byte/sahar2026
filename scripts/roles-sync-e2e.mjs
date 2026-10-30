/**
 * @file scripts/roles-sync-e2e.mjs — le contrat des six rôles, éprouvé de bout en bout.
 *
 * POURQUOI CETTE ÉPREUVE EXISTE
 * ----------------------------
 * `tests/roles-autorisation-serveur.test.js` exécute les décisions d'autorisation, mais
 * remplace la couche SQL par un double. Il prouve donc le RAISONNEMENT, pas la CHAÎNE.
 *
 * Ici, rien n'est doublé : un vrai serveur, une vraie base PostgreSQL, une vraie session
 * signée, de vraies requêtes HTTP. C'est la seule manière de démontrer qu'un chef reçoit
 * un instantané `/api/sync` non vide — le symptôme qui avait été observé en production et
 * qu'aucun test du dépôt ne pouvait reproduire.
 *
 * Usage :
 *   PORT=4191 DATABASE_URL=… PLATFORM_ADMIN_USERNAME=… PLATFORM_ADMIN_PASSWORD=… \
 *     node --import ./scripts/inventory-replace-preload.js \
 *          --import ./scripts/catalog-seed-preload.js scripts/serve.js &
 *   E2E_BASE_URL=http://127.0.0.1:4191 node scripts/roles-sync-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4191';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'lota-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!';
const MOT_DE_PASSE = 'Qz7-Vraie-Preuve-Bx9!';
/**
 * `PUT /api/data/users/:id` attend le mot de passe ENCODÉ EN BASE64 : `serve.js:1269` le
 * décode avant d'évaluer la politique et de le hacher. Envoyer le texte clair « marche » —
 * il est décodé en octets arbitraires, puis haché — et la connexion échoue ensuite sans
 * que rien n'indique pourquoi. C'est le piège qui a coûté deux tours à cette épreuve.
 */
const encode = valeur => Buffer.from(String(valeur), 'utf8').toString('base64');

let ZONE = null; // l'identifiant est attribué par le serveur, jamais supposé
const SALLE_DEDANS = 'lota-salle-dedans';
const SALLE_DEHORS = 'lota-salle-dehors';

/** Les six rôles, écrits comme un humain les saisit — libellés français compris. */
const SUJETS = [
  { id: 970001, username: 'lota-manager', role: 'manager' },
  { id: 970002, username: 'lota-chef', role: 'chef' },
  { id: 970003, username: 'lota-responsable', role: 'responsable' },
  { id: 970004, username: 'lota-technicien', role: 'technicien' },
  { id: 970005, username: 'lota-visiteur', role: 'visiteur' }
];

// `equipment.edit` est dans le plafond des cinq rôles SAUF le visiteur : son habilitation
// doit donc être acceptée pour les quatre autres et refusée (409 ROLE_CEILING) pour lui.
const PERMISSIONS_ZONE = ['zone.summary.read', 'equipment.read', 'equipment.edit',
  'ticket.read', 'note.read', 'procedure.read'];
/** `room.edit` : au plafond du chef seulement (avec admin/manager, qui court-circuitent). */
const SALLE_EDITABLE_PAR = new Set(['manager', 'chef']);
/** Un compte au rôle abîmé, pleinement équipé — il ne doit RIEN obtenir. */
const INTRUS = { id: 970006, username: 'lota-intrus', role: 'supervisor-x' };

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) { console.log(`  ✅ ${nom}`); return; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
};

async function appel(chemin, { method = 'GET', cookie = '', body, attendu } = {}) {
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
  if (attendu !== undefined) {
    assert.equal(reponse.status, attendu,
      `${method} ${chemin} : attendu ${attendu}, reçu ${reponse.status} — ${texte.slice(0, 200)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie } = await appel('/api/auth/login', { method: 'POST', body: { username, password }, attendu: 200 });
  assert.ok(cookie, `aucune session rendue pour « ${username} »`);
  return cookie;
};

/** Ce que le porteur du cookie voit RÉELLEMENT d'un enregistrement, ou `null`. */
async function lire(cookie, store, id) {
  const { charge } = await appel('/api/sync', { cookie, attendu: 200 });
  return (charge?.data?.[store] || []).find(record => String(record.id) === String(id)) || null;
}

/**
 * ÉCRIRE COMME LE FAIT UN CLIENT RÉEL : à partir de ce qu'on vient de lire.
 *
 * Ce script construisait ses charges utiles de toutes pièces — `{ id, name, … }` — et les
 * posait par-dessus l'enregistrement existant. C'est un écrasement à l'aveugle : il efface
 * tout ce que la charge ne renomme pas, et il ne s'appuie sur aucune version. Depuis le
 * contrat de version, le serveur le refuse, et il a raison de le refuser.
 *
 * Un navigateur, lui, n'écrit jamais ainsi : il enregistre l'objet qu'il a en mémoire, issu
 * du dernier instantané, donc porteur de sa révision. On fait la même chose ici — ce qui
 * rend l'épreuve PLUS fidèle, pas plus indulgente : l'autorisation est tranchée avant toute
 * comparaison de version, et une lecture impossible reste un échec visible.
 */
async function ecrireDepuisLecture(store, id, { cookie, modifications, attendu }) {
  const actuel = await lire(cookie, store, id);
  return appel(`/api/data/${store}/${id}`, {
    method: 'PUT', cookie, attendu,
    body: { ...(actuel || {}), ...modifications, id }
  });
}

console.log(`\n╔═══ contrat des six rôles — bout en bout sur ${base} ═══╗\n`);

/* ── 1 · l'administrateur pose le décor ───────────────────────────────── */
const admin = await connexion(adminUsername, adminPassword);
console.log('1 · décor');

for (const [id, name] of [[SALLE_DEDANS, 'STC — dans la zone'], [SALLE_DEHORS, 'Autre — hors zone']]) {
  // Le décor s'écrit lui aussi depuis la lecture : sans cela le script ne pourrait servir
  // qu'une fois par base, la deuxième pose étant — à juste titre — un écrasement à l'aveugle.
  await ecrireDepuisLecture('rooms', id, { cookie: admin, modifications: { name }, attendu: 200 });
}
const zoneCreee = await appel('/api/access/zones', {
  method: 'POST', cookie: admin, body: { name: 'Régie LOT A' }, attendu: 200
});
ZONE = zoneCreee.charge?.zone?.id ?? zoneCreee.charge?.id;
assert.ok(ZONE, `identifiant de zone absent de la réponse : ${JSON.stringify(zoneCreee.charge).slice(0, 200)}`);
await appel('/api/access/resource-zones', {
  method: 'POST', cookie: admin,
  body: { resourceType: 'rooms', resourceId: SALLE_DEDANS, zoneId: ZONE }, attendu: 200
});
verifier('une zone, une salle dedans, une salle dehors', true);

for (const sujet of SUJETS) {
  await appel(`/api/data/users/${sujet.id}`, {
    method: 'PUT', cookie: admin,
    body: { id: sujet.id, username: sujet.username, fullName: sujet.username, role: sujet.role, status: 'active', password: encode(MOT_DE_PASSE) },
    attendu: 200
  });
}
verifier('les cinq comptes créés avec leur rôle tel qu’il est saisi', true);

// L'intrus : rôle inconnu, écrit directement en base pour contourner la validation
// d'attribution — c'est exactement le cas d'un enregistrement hérité ou abîmé.
const intrusEcrit = await appel(`/api/data/users/${INTRUS.id}`, {
  method: 'PUT', cookie: admin,
  body: { id: INTRUS.id, username: INTRUS.username, fullName: INTRUS.username,
    role: INTRUS.role, status: 'active', password: encode(MOT_DE_PASSE) }
});
verifier(`attribuer un rôle inconnu est REFUSÉ (${intrusEcrit.statut})`,
  intrusEcrit.statut === 400 && intrusEcrit.charge?.error === 'INVALID_ROLE',
  JSON.stringify(intrusEcrit.charge).slice(0, 120));

/* ── 2 · adhésions et habilitations ───────────────────────────────────── */
console.log('\n2 · adhésions et habilitations');
for (const sujet of SUJETS) {
  await appel('/api/access/memberships', {
    method: 'POST', cookie: admin, body: { userId: sujet.id, zoneId: ZONE }, attendu: 200
  });
  for (const permission of PERMISSIONS_ZONE) {
    const { statut } = await appel('/api/access/grants', {
      method: 'POST', cookie: admin, body: { userId: sujet.id, zoneId: ZONE, permission }
    });
    if (statut !== 200 && !(sujet.role === 'visiteur' && statut === 409)) {
      verifier(`habiliter « ${sujet.role} » sur ${permission}`, false, `statut ${statut}`);
    }
  }
}
verifier('le chef est habilitable — le refus « dépasse le rôle global » ne le vise plus', true);

/* ── 3 · l'instantané de chaque rôle ──────────────────────────────────── */
console.log('\n3 · instantané /api/sync, session réelle');

/** `data` est un objet indexé par magasin, pas un tableau de lignes. */
const instantane = async cookie => {
  const { charge } = await appel('/api/sync', { cookie, attendu: 200 });
  const magasins = charge.data && typeof charge.data === 'object' ? charge.data : {};
  const total = Object.values(magasins).reduce((n, liste) => n + (Array.isArray(liste) ? liste.length : 0), 0);
  return { total, salles: (magasins.rooms || []).map(salle => salle.id).filter(Boolean) };
};

const vuAdmin = await instantane(admin);
verifier(`l’administrateur voit les deux salles (${vuAdmin.salles.length})`, vuAdmin.salles.length >= 2,
  JSON.stringify(vuAdmin.salles));

for (const sujet of SUJETS) {
  const cookie = await connexion(sujet.username, MOT_DE_PASSE);
  const vu = await instantane(cookie);
  const voitDedans = vu.salles.includes(SALLE_DEDANS);
  const voitDehors = vu.salles.includes(SALLE_DEHORS);
  const portee = ['manager'].includes(sujet.role);

  verifier(`« ${sujet.role} » · instantané NON vide (${vu.total} enregistrements)`, vu.total > 0);
  verifier(`« ${sujet.role} » · voit la salle de sa zone`, voitDedans, JSON.stringify(vu.salles));
  if (!portee) {
    verifier(`« ${sujet.role} » · ne voit PAS la salle hors zone`, !voitDehors, JSON.stringify(vu.salles));
  } else {
    verifier(`« ${sujet.role} » · court-circuite les zones (attendu)`, voitDehors);
  }
}

/* ── 4 · l'écriture, par rôle ─────────────────────────────────────────── */
console.log('\n4 · écriture');

for (const sujet of SUJETS) {
  const cookie = await connexion(sujet.username, MOT_DE_PASSE);
  // Les réglages n'appartiennent qu'à l'administrateur — pour tous, manager compris.
  const reglages = await appel('/api/data/settings/global', {
    method: 'PUT', cookie, body: { id: 'global', mapImageUrl: 'usurpe.png' }
  });
  verifier(`« ${sujet.role} » · refusé sur les réglages (${reglages.statut})`,
    reglages.statut === 403 || reglages.statut === 409);

  // Un équipement DANS la zone. Écrire exige `equipment.edit` — habilitation accordée
  // plus haut à tous sauf au visiteur, que son plafond en écarte. Sans cette habilitation,
  // un 403 serait la BONNE réponse : c'est ce qu'a montré le premier passage de cette
  // épreuve, où l'attente était fausse et le serveur avait raison.
  const equipement = await ecrireDepuisLecture('equipments', 'lota-eq-1', {
    cookie,
    modifications: { name: `posé par ${sujet.role}`, roomId: SALLE_DEDANS, numSerie: 'LOTA-1' }
  });
  const attenduEcriture = sujet.role !== 'visiteur';
  verifier(`« ${sujet.role} » · écriture équipement en zone ${attenduEcriture ? 'acceptée' : 'refusée'} (${equipement.statut})`,
    attenduEcriture ? equipement.statut === 200 : equipement.statut !== 200);
}

/* ── 5 · room.edit ≠ zone.manage ──────────────────────────────────────── */
console.log('\n5 · écriture d’une salle');

for (const sujet of SUJETS) {
  const cookie = await connexion(sujet.username, MOT_DE_PASSE);
  // On tente d'abord d'habiliter `room.edit` : le plafond doit accepter ou refuser.
  const habilitation = await appel('/api/access/grants', {
    method: 'POST', cookie: admin, body: { userId: sujet.id, zoneId: ZONE, permission: 'room.edit' }
  });
  const attendueHabilitation = SALLE_EDITABLE_PAR.has(sujet.role);
  verifier(`« ${sujet.role} » · habilitation room.edit ${attendueHabilitation ? 'acceptée' : 'refusée'} (${habilitation.statut})`,
    attendueHabilitation ? habilitation.statut === 200 : habilitation.statut === 409);

  const ecriture = await ecrireDepuisLecture('rooms', SALLE_DEDANS, {
    cookie, modifications: { name: `renommée par ${sujet.role}` }
  });
  verifier(`« ${sujet.role} » · écriture de salle ${attendueHabilitation ? 'acceptée' : 'refusée'} (${ecriture.statut})`,
    attendueHabilitation ? ecriture.statut === 200 : ecriture.statut !== 200);
}

/* ── 6 · CRÉER une salle, pas seulement la renommer ───────────────────── */
console.log('\n6 · création d’une salle');

/*
 * La section 5 ci-dessus n'a jamais éprouvé que la MODIFICATION d'une salle qui existait
 * déjà — donc qui était déjà rattachée à une zone. La création, elle, n'avait aucun
 * chemin : la salle n'étant pas encore en base, aucune zone ne pouvait s'en déduire et le
 * serveur refusait tout, y compris au chef. Les cas ci-dessous passent par le vrai
 * PostgreSQL et la vraie session HTTP.
 */

/*
 * Les identifiants de cette section portent un suffixe propre à l'exécution.
 *
 * Les sections 1 à 5 réécrivent des enregistrements à identifiant fixe : les rejouer sur
 * la même base est sans effet. CRÉER, non : au second passage la salle existerait déjà, le
 * serveur traiterait une modification, et l'épreuve se déclarerait en échec pour une raison
 * qui n'est pas celle qu'elle mesure. C'est exactement ce qui s'est produit ici.
 */
const RUN = Date.now().toString(36);

// Une seconde zone, où le chef n'est NI membre NI habilité.
const zoneEtrangere = await appel('/api/access/zones', {
  method: 'POST', cookie: admin, body: { name: 'Régie étrangère LOT A' }, attendu: 200
});
const ZONE_ETRANGERE = zoneEtrangere.charge?.zone?.id ?? zoneEtrangere.charge?.id;
assert.ok(ZONE_ETRANGERE, 'la seconde zone n’a pas d’identifiant');

const chef = SUJETS.find(sujet => sujet.role === 'chef');
const cookieChef = await connexion(chef.username, MOT_DE_PASSE);

// 6.a — sans zone : refus NOMMÉ, et non le 403 générique de portée.
const sansZone = await appel(`/api/data/rooms/lota-sans-zone-${RUN}`, {
  method: 'PUT', cookie: cookieChef, body: { id: `lota-sans-zone-${RUN}`, name: 'Sans zone' }
});
verifier(`chef · création sans zone refusée explicitement (${sansZone.statut} ${sansZone.charge?.error})`,
  sansZone.statut === 400 && sansZone.charge?.error === 'ROOM_ZONE_REQUIRED',
  JSON.stringify(sansZone.charge).slice(0, 160));
verifier('chef · le refus dit quoi faire, en français',
  /zone/i.test(String(sansZone.charge?.message || '')) && /salle/i.test(String(sansZone.charge?.message || '')),
  String(sansZone.charge?.message || '').slice(0, 160));

// 6.b — dans une zone qui n'est pas la sienne : refusé.
const horsZone = await appel(`/api/data/rooms/lota-hors-zone-${RUN}`, {
  method: 'PUT', cookie: cookieChef,
  body: { id: `lota-hors-zone-${RUN}`, name: 'Hors zone', zoneId: ZONE_ETRANGERE }
});
verifier(`chef · création hors de sa zone refusée (${horsZone.statut})`, horsZone.statut === 403,
  JSON.stringify(horsZone.charge).slice(0, 160));

// 6.c — dans SA zone : acceptée.
const SALLE_NEUVE = `lota-salle-neuve-${RUN}`;
const dansZone = await appel(`/api/data/rooms/${SALLE_NEUVE}`, {
  method: 'PUT', cookie: cookieChef,
  body: { id: SALLE_NEUVE, name: 'Créée par le chef', location: 'Cour technique', zoneId: ZONE }
});
verifier(`chef · création DANS sa zone acceptée (${dansZone.statut})`, dansZone.statut === 200,
  JSON.stringify(dansZone.charge).slice(0, 160));

// 6.d — UNE seule vérité, vérifiée TOUT DE SUITE.
//
// L'ordre compte : mesurée après la modification suivante, cette vérification passerait
// même sans correctif, puisqu'un PUT remplace l'enregistrement entier et emporterait le
// champ en doublon avec lui. C'est ici, juste après la création, qu'elle discrimine.
const salleJusteCreee = ((await appel('/api/sync', { cookie: admin, attendu: 200 }))
  .charge?.data?.rooms || []).find(salle => salle.id === SALLE_NEUVE);
verifier('la salle créée est bien en base', Boolean(salleJusteCreee));
verifier('la salle stockée ne garde AUCUNE zone en propre — `resource_zones` la porte seul',
  salleJusteCreee !== undefined && salleJusteCreee.zoneId === undefined && salleJusteCreee.zoneIds === undefined,
  JSON.stringify(salleJusteCreee || {}).slice(0, 200));

// 6.e — la salle créée est immédiatement à lui.
const vuChef = await instantane(cookieChef);
verifier('chef · sa salle apparaît dans son instantané', vuChef.salles.includes(SALLE_NEUVE),
  JSON.stringify(vuChef.salles));

// 6.f — il peut la modifier SANS renvoyer de zone, et elle ne se détache pas.
//
// C'est la perte silencieuse que le rattachement canonique ferme : une zone gardée dans
// l'enregistrement lui-même disparaît au premier PUT qui ne la renvoie pas, et la salle
// devient alors invisible à celui qui vient de la créer.
const remodifiee = await ecrireDepuisLecture('rooms', SALLE_NEUVE, {
  cookie: cookieChef, modifications: { name: 'Renommée sans zone' }
});
verifier(`chef · modifie sa salle sans renvoyer de zone (${remodifiee.statut})`, remodifiee.statut === 200,
  JSON.stringify(remodifiee.charge).slice(0, 160));

const vuChefApres = await instantane(cookieChef);
verifier('chef · sa salle est TOUJOURS la sienne après modification',
  vuChefApres.salles.includes(SALLE_NEUVE), JSON.stringify(vuChefApres.salles));

// 6.g — une baie posée dans cette salle hérite de la zone : la chaîne tient.
const baie = await appel(`/api/data/baies/lota-baie-neuve-${RUN}`, {
  method: 'PUT', cookie: cookieChef,
  body: { id: `lota-baie-neuve-${RUN}`, name: 'Baie créée par le chef', roomId: SALLE_NEUVE }
});
verifier(`chef · baie créée dans sa salle neuve (${baie.statut})`, baie.statut === 200,
  JSON.stringify(baie.charge).slice(0, 160));

// 6.h — les autres rôles ne créent pas de salle, même en désignant une zone valide.
for (const sujet of SUJETS.filter(item => !['manager', 'chef'].includes(item.role))) {
  const cookie = await connexion(sujet.username, MOT_DE_PASSE);
  const tentative = await appel(`/api/data/rooms/lota-neuve-${sujet.role}-${RUN}`, {
    method: 'PUT', cookie, body: { id: `lota-neuve-${sujet.role}-${RUN}`, name: 'Tentative', zoneId: ZONE }
  });
  verifier(`« ${sujet.role} » · création de salle refusée (${tentative.statut})`, tentative.statut !== 200,
    JSON.stringify(tentative.charge).slice(0, 160));
}

// 6.i — le manager, lui, crée sans zone : son comportement ne change pas.
const cookieManager = await connexion('lota-manager', MOT_DE_PASSE);
const parManager = await appel(`/api/data/rooms/lota-neuve-manager-${RUN}`, {
  method: 'PUT', cookie: cookieManager, body: { id: `lota-neuve-manager-${RUN}`, name: 'Créée par le manager' }
});
verifier(`manager · création sans zone toujours acceptée (${parManager.statut})`, parManager.statut === 200,
  JSON.stringify(parManager.charge).slice(0, 160));

// 6.j — la zone ne se devine pas d'un nom : une salle nommée comme la zone reste refusée.
const parLeNom = await appel(`/api/data/rooms/lota-neuve-par-le-nom-${RUN}`, {
  method: 'PUT', cookie: cookieChef,
  body: { id: `lota-neuve-par-le-nom-${RUN}`, name: 'Régie LOT A', location: 'Régie LOT A' }
});
verifier(`chef · la zone ne se déduit pas du nom ni du texte libre (${parLeNom.statut})`,
  parLeNom.statut === 400 && parLeNom.charge?.error === 'ROOM_ZONE_REQUIRED',
  JSON.stringify(parLeNom.charge).slice(0, 160));

// 6.k — le contexte d'accès offre au chef exactement la zone où il peut créer.
const contexteChef = await appel('/api/access/context', { cookie: cookieChef, attendu: 200 });
const zonesOuvertes = (contexteChef.charge?.zones || []).filter(zone => {
  const membre = (contexteChef.charge?.memberships || []).some(item => String(item.zoneId) === String(zone.id));
  const habilite = (contexteChef.charge?.grants || []).some(item =>
    String(item.zoneId) === String(zone.id) && item.permission === 'room.edit');
  return membre && habilite;
}).map(zone => String(zone.id));
// L'appartenance et l'exclusion, plutôt qu'un compte exact : les adhésions d'une exécution
// précédente survivent sur la même base, et compter les zones ferait échouer un second
// passage pour une raison qui n'est pas celle qu'on mesure.
verifier('chef · le contexte d’accès ouvre sa zone à la création',
  zonesOuvertes.includes(String(ZONE)), JSON.stringify(zonesOuvertes));
verifier('chef · le contexte d’accès n’ouvre PAS la zone étrangère',
  !zonesOuvertes.includes(String(ZONE_ETRANGERE)), JSON.stringify(zonesOuvertes));

/* ── 7 · une salle, une zone, une source de vérité ────────────────────── */
console.log('\n7 · zone canonique d’une salle');

/*
 * `resource_zones` est la SEULE vérité de la zone d'une salle. `room.zoneId` et
 * `room.zoneIds` sont des données héritées, à migrer puis à oublier. Les cas ci-dessous
 * passent par le vrai PostgreSQL et la vraie session HTTP.
 */

// 7.a — DÉPLACEMENT A → B : l'ancien rattachement part, il ne s'additionne pas.
const SALLE_MOBILE = `lota-salle-mobile-${RUN}`;
await appel(`/api/data/rooms/${SALLE_MOBILE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_MOBILE, name: 'Salle déplaçable', zoneId: ZONE }, attendu: 200
});
const vuChefAvant = await instantane(cookieChef);
verifier('chef · voit la salle avant déplacement', vuChefAvant.salles.includes(SALLE_MOBILE),
  JSON.stringify(vuChefAvant.salles));

await appel('/api/access/resource-zones', {
  method: 'POST', cookie: admin,
  body: { resourceType: 'rooms', resourceId: SALLE_MOBILE, zoneId: ZONE_ETRANGERE }, attendu: 200
});
const vuChefApresDeplacement = await instantane(await connexion(chef.username, MOT_DE_PASSE));
verifier('chef · PERD la salle déplacée vers la zone étrangère',
  !vuChefApresDeplacement.salles.includes(SALLE_MOBILE), JSON.stringify(vuChefApresDeplacement.salles));

// L'administrateur, lui, la voit toujours — il court-circuite les zones.
const vuAdminDeplacee = await instantane(admin);
verifier('admin · voit toujours la salle déplacée', vuAdminDeplacee.salles.includes(SALLE_MOBILE));

// Et le déplacement doit être un REMPLACEMENT : on le ramène, et il ne doit rester
// qu'un seul rattachement — sinon la salle serait dans les deux zones à la fois.
await appel('/api/access/resource-zones', {
  method: 'POST', cookie: admin,
  body: { resourceType: 'rooms', resourceId: SALLE_MOBILE, zoneId: ZONE }, attendu: 200
});
const gestion = await appel('/api/access/manage', { cookie: admin, attendu: 200 });
const rattachementsMobile = (gestion.charge?.resourceZones || [])
  .filter(item => String(item.resourceId) === SALLE_MOBILE).map(item => String(item.zoneId));
verifier(`la salle déplacée n’a QU’UN rattachement (${rattachementsMobile.length})`,
  rattachementsMobile.length === 1 && rattachementsMobile[0] === String(ZONE),
  JSON.stringify(rattachementsMobile));

const vuChefRetour = await instantane(await connexion(chef.username, MOT_DE_PASSE));
verifier('chef · retrouve la salle ramenée dans sa zone', vuChefRetour.salles.includes(SALLE_MOBILE));

// 7.b — modifier une salle en y glissant une AUTRE zone n'est pas un déplacement déguisé.
const deplacementDeguise = await appel(`/api/data/rooms/${SALLE_MOBILE}`, {
  method: 'PUT', cookie: admin,
  body: { id: SALLE_MOBILE, name: 'Salle déplaçable', zoneId: ZONE_ETRANGERE }
});
verifier(`la zone ne se change pas en modifiant la salle (${deplacementDeguise.statut} ${deplacementDeguise.charge?.error})`,
  deplacementDeguise.statut === 409 && deplacementDeguise.charge?.error === 'ROOM_ZONE_REMAP_ENDPOINT',
  JSON.stringify(deplacementDeguise.charge).slice(0, 160));

// 7.c — SUPPRESSION puis RECRÉATION du même identifiant dans une autre zone.
const SALLE_RECREEE = `lota-salle-recreee-${RUN}`;
await appel(`/api/data/rooms/${SALLE_RECREEE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_RECREEE, name: 'À supprimer', zoneId: ZONE }, attendu: 200
});
await appel(`/api/data/rooms/${SALLE_RECREEE}`, { method: 'DELETE', cookie: admin, attendu: 200 });
const apresSuppression = await appel('/api/access/manage', { cookie: admin, attendu: 200 });
verifier('supprimer une salle efface son rattachement',
  !(apresSuppression.charge?.resourceZones || []).some(item => String(item.resourceId) === SALLE_RECREEE),
  JSON.stringify((apresSuppression.charge?.resourceZones || []).filter(item => String(item.resourceId) === SALLE_RECREEE)));

await appel(`/api/data/rooms/${SALLE_RECREEE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_RECREEE, name: 'Recréée ailleurs', zoneId: ZONE_ETRANGERE }, attendu: 200
});
const vuChefRecreee = await instantane(await connexion(chef.username, MOT_DE_PASSE));
verifier('chef · n’hérite PAS d’une salle recréée sous le même identifiant dans une autre zone',
  !vuChefRecreee.salles.includes(SALLE_RECREEE), JSON.stringify(vuChefRecreee.salles));

// 7.d — l'administrateur crée SANS zone : le rattachement existe AVANT la réponse.
const SALLE_AUTO = `lota-salle-auto-${RUN}`;
await appel(`/api/data/rooms/${SALLE_AUTO}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_AUTO, name: 'Créée sans zone' }, attendu: 200
});
const gestionAuto = await appel('/api/access/manage', { cookie: admin, attendu: 200 });
const rattachementsAuto = (gestionAuto.charge?.resourceZones || [])
  .filter(item => String(item.resourceId) === SALLE_AUTO);
verifier(`admin · la salle créée sans zone a DÉJÀ son rattachement (${rattachementsAuto.length})`,
  rattachementsAuto.length === 1, JSON.stringify(rattachementsAuto).slice(0, 200));
verifier('admin · ce rattachement pointe vers une zone neuve, pas vers une zone existante',
  rattachementsAuto.length === 1 && ![String(ZONE), String(ZONE_ETRANGERE)].includes(String(rattachementsAuto[0].zoneId)),
  JSON.stringify(rattachementsAuto).slice(0, 200));

// 7.e — aucune salle ne garde de zone en propre, sur toute la base.
const toutesLesSalles = (await appel('/api/sync', { cookie: admin, attendu: 200 })).charge?.data?.rooms || [];
const avecZoneEnPropre = toutesLesSalles.filter(salle => salle.zoneId !== undefined || salle.zoneIds !== undefined);
verifier(`aucune des ${toutesLesSalles.length} salles ne garde de zone en propre`,
  avecZoneEnPropre.length === 0, JSON.stringify(avecZoneEnPropre.map(salle => salle.id)).slice(0, 200));

/* ── 8 · un rôle invalide n'obtient pas de session ─────────────────────── */
console.log('\n8 · rôle invalide à la connexion');

/*
 * Mesuré : un compte au rôle hérité illisible recevait `200`, puis un instantané VIDE,
 * puis une navigation de visiteur. Fermé de partout — donc sûr — mais silencieux : l'écran
 * ressemblait à une panne de la plateforme.
 */
const ABIME = { id: 970007, username: `lota-abime-${RUN}`, role: 'supervisor-x' };
await appel(`/api/data/users/${ABIME.id}`, {
  method: 'PUT', cookie: admin,
  body: { id: ABIME.id, username: ABIME.username, fullName: ABIME.username, role: 'technicien', status: 'active', password: encode(MOT_DE_PASSE) },
  attendu: 200
});

/*
 * LE RÔLE EST ABÎMÉ DIRECTEMENT EN BASE, et c'est indispensable.
 *
 * L'API refuse d'attribuer un rôle inconnu — la section 1 le vérifie. Passer par elle ne
 * produirait donc PAS le cas qu'on veut mesurer : un enregistrement hérité, ou importé
 * avant cette garde, dont le rôle ne se résout plus. Une première version de cette
 * épreuve s'y est trompée et a mesuré un compte resté « technicien ».
 */
async function abimerLeRole(userId, role) {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(
      `UPDATE platform_records SET data = jsonb_set(data, '{role}', to_jsonb($2::text)), updated_at = NOW()
       WHERE store_name='users' AND record_id=$1`, [String(userId), role]);
    return true;
  } finally { await pool.end(); }
}

if (!(await abimerLeRole(ABIME.id, ABIME.role))) {
  verifier('rôle invalide · DATABASE_URL requis pour abîmer le compte en base', false,
    'renseignez DATABASE_URL pour exécuter cette section');
} else {
  const connexionAbimee = await appel('/api/auth/login', {
    method: 'POST', body: { username: ABIME.username, password: MOT_DE_PASSE }
  });
  verifier(`rôle invalide · la connexion est REFUSÉE (${connexionAbimee.statut} ${connexionAbimee.charge?.error})`,
    connexionAbimee.statut === 403 && connexionAbimee.charge?.error === 'INVALID_ROLE',
    JSON.stringify(connexionAbimee.charge).slice(0, 160));
  verifier('rôle invalide · le message est en français et dit quoi faire',
    /rôle/i.test(String(connexionAbimee.charge?.message || '')) && /administrateur/i.test(String(connexionAbimee.charge?.message || '')),
    String(connexionAbimee.charge?.message || '').slice(0, 160));
  verifier('rôle invalide · aucune session n’est posée', !connexionAbimee.cookie,
    String(connexionAbimee.cookie || '').slice(0, 80));
  // Le mot de passe reste vérifié AVANT : un mot de passe faux sur un compte abîmé doit
  // rendre le refus ordinaire, sinon on apprendrait l'état d'un compte sans le connaître.
  const mauvaisMotDePasse = await appel('/api/auth/login', {
    method: 'POST', body: { username: ABIME.username, password: 'Mauvais-Mot-De-Passe-1!' }
  });
  verifier(`rôle invalide · un mot de passe faux rend le refus ORDINAIRE (${mauvaisMotDePasse.statut})`,
    mauvaisMotDePasse.statut === 401 && mauvaisMotDePasse.charge?.error === 'INVALID_CREDENTIALS',
    JSON.stringify(mauvaisMotDePasse.charge).slice(0, 160));
}

// L'alias « technique » reste un technicien à part entière : la fermeture ne l'attrape pas.
const TECHNIQUE = { id: 970008, username: `lota-technique-${RUN}` };
await appel(`/api/data/users/${TECHNIQUE.id}`, {
  method: 'PUT', cookie: admin,
  body: { id: TECHNIQUE.id, username: TECHNIQUE.username, fullName: TECHNIQUE.username, role: 'technicien', status: 'active', password: encode(MOT_DE_PASSE) },
  attendu: 200
});
await abimerLeRole(TECHNIQUE.id, 'technique');
const connexionTechnique = await appel('/api/auth/login', {
  method: 'POST', body: { username: TECHNIQUE.username, password: MOT_DE_PASSE }
});
verifier(`« technique » · la connexion est ACCEPTÉE (${connexionTechnique.statut})`, connexionTechnique.statut === 200,
  JSON.stringify(connexionTechnique.charge).slice(0, 160));

/* ── 9 · sauvegarde, export, inventaire : la zone voyage avec la salle ── */
console.log('\n9 · aller-retour d’une salle et de sa zone');

/*
 * Trois portes faisaient sortir des salles sans leur rattachement : la sauvegarde,
 * l'export JSON, et le remplacement d'inventaire. Une salle réimportée sans zone
 * n'appartient à personne — elle disparaît de tout écran à périmètre.
 */
const SALLE_TRANSFERT = `lota-salle-transfert-${RUN}`;
await appel(`/api/data/rooms/${SALLE_TRANSFERT}`, {
  method: 'PUT', cookie: admin,
  body: { id: SALLE_TRANSFERT, name: 'Salle transférable', locationId: 'dep-x', zoneId: ZONE }, attendu: 200
});

// 9.a — l'export sort les salles ET les rattachements, dans un format versionné.
const exporte = await appel('/api/rooms/transfer', { cookie: admin, attendu: 200 });
verifier(`l’export est versionné (formatVersion ${exporte.charge?.formatVersion})`,
  Number(exporte.charge?.formatVersion) >= 3, JSON.stringify(exporte.charge?.formatVersion));
const paireExportee = (exporte.charge?.roomZones || []).find(paire => String(paire.roomId) === SALLE_TRANSFERT);
verifier('l’export porte le rattachement de la salle', paireExportee?.zoneId === String(ZONE),
  JSON.stringify(paireExportee));
const salleExportee = (exporte.charge?.rooms || []).find(salle => String(salle.id) === SALLE_TRANSFERT);
verifier('la salle exportée ne porte AUCUNE zone en propre',
  salleExportee && salleExportee.zoneId === undefined && salleExportee.zoneIds === undefined,
  JSON.stringify(salleExportee).slice(0, 200));
verifier('la salle exportée garde son `locationId`', salleExportee?.locationId === 'dep-x',
  JSON.stringify(salleExportee?.locationId));

// 9.b — suppression, puis réimport du fichier exporté : la MÊME zone.
await appel(`/api/data/rooms/${SALLE_TRANSFERT}`, { method: 'DELETE', cookie: admin, attendu: 200 });
const apresSuppressionTransfert = await appel('/api/rooms/transfer', { cookie: admin, attendu: 200 });
verifier('la suppression a bien emporté le rattachement',
  !(apresSuppressionTransfert.charge?.roomZones || []).some(paire => String(paire.roomId) === SALLE_TRANSFERT));

const reimport = await appel('/api/rooms/transfer', {
  method: 'POST', cookie: admin,
  body: { formatVersion: exporte.charge.formatVersion, rooms: [salleExportee], roomZones: [paireExportee] }
});
verifier(`réimport accepté (${reimport.statut})`, reimport.statut === 200, JSON.stringify(reimport.charge).slice(0, 160));
const apresReimport = await appel('/api/rooms/transfer', { cookie: admin, attendu: 200 });
const pairRevenue = (apresReimport.charge?.roomZones || []).find(paire => String(paire.roomId) === SALLE_TRANSFERT);
verifier('la salle réimportée retrouve EXACTEMENT sa zone', pairRevenue?.zoneId === String(ZONE),
  JSON.stringify(pairRevenue));

const vuChefTransfert = await instantane(await connexion(chef.username, MOT_DE_PASSE));
verifier('chef · la salle réimportée est de nouveau dans son périmètre',
  vuChefTransfert.salles.includes(SALLE_TRANSFERT), JSON.stringify(vuChefTransfert.salles));

// 9.c — un fichier HÉRITÉ (rooms[] avec `zoneId`) se lit comme entrée de migration.
const SALLE_HERITEE = `lota-salle-heritee-${RUN}`;
const importHerite = await appel('/api/rooms/transfer', {
  method: 'POST', cookie: admin,
  body: { formatVersion: 2, rooms: [{ id: SALLE_HERITEE, name: 'Depuis un vieux fichier', zoneId: ZONE }] }
});
verifier(`fichier hérité accepté (${importHerite.statut})`, importHerite.statut === 200,
  JSON.stringify(importHerite.charge).slice(0, 160));
verifier('le serveur signale la reprise du champ hérité',
  (importHerite.charge?.migratedFromLegacy || []).includes(SALLE_HERITEE),
  JSON.stringify(importHerite.charge?.migratedFromLegacy));
const salleHeriteeStockee = ((await appel('/api/sync', { cookie: admin, attendu: 200 }))
  .charge?.data?.rooms || []).find(salle => String(salle.id) === SALLE_HERITEE);
verifier('la salle issue d’un fichier hérité ne garde pas son `zoneId`',
  salleHeriteeStockee && salleHeriteeStockee.zoneId === undefined,
  JSON.stringify(salleHeriteeStockee).slice(0, 200));

// 9.d — un chef ne dépose pas une salle dans une zone qui n'est pas la sienne.
const depotInterdit = await appel('/api/rooms/transfer', {
  method: 'POST', cookie: cookieChef,
  body: { formatVersion: 3, rooms: [{ id: `lota-depot-interdit-${RUN}`, name: 'Tentative' }],
    roomZones: [{ roomId: `lota-depot-interdit-${RUN}`, zoneId: ZONE_ETRANGERE }] }
});
verifier(`chef · dépôt hors de sa zone refusé (${depotInterdit.statut} ${depotInterdit.charge?.error})`,
  depotInterdit.statut === 403 && depotInterdit.charge?.error === 'ZONE_FORBIDDEN',
  JSON.stringify(depotInterdit.charge).slice(0, 160));
const apresDepotInterdit = await appel('/api/rooms/transfer', { cookie: admin, attendu: 200 });
verifier('rien n’a été écrit par le dépôt refusé',
  !(apresDepotInterdit.charge?.rooms || []).some(salle => String(salle.id) === `lota-depot-interdit-${RUN}`));

// 9.e — un chef ne dépose pas non plus une salle SANS zone.
const depotSansZone = await appel('/api/rooms/transfer', {
  method: 'POST', cookie: cookieChef,
  body: { formatVersion: 3, rooms: [{ id: `lota-depot-sans-zone-${RUN}`, name: 'Sans zone' }], roomZones: [] }
});
verifier(`chef · dépôt sans zone refusé (${depotSansZone.statut} ${depotSansZone.charge?.error})`,
  depotSansZone.statut === 400 && depotSansZone.charge?.error === 'ROOM_ZONE_REQUIRED',
  JSON.stringify(depotSansZone.charge).slice(0, 160));

// 9.f — le chef ne voit dans l'export que les salles de son périmètre.
const exportChef = await appel('/api/rooms/transfer', { cookie: cookieChef, attendu: 200 });
verifier('chef · son export ne contient pas la salle hors zone',
  !(exportChef.charge?.rooms || []).some(salle => String(salle.id) === SALLE_DEHORS),
  JSON.stringify((exportChef.charge?.rooms || []).map(salle => salle.id)).slice(0, 200));
verifier('chef · chaque salle de son export a son rattachement',
  (exportChef.charge?.rooms || []).every(salle =>
    (exportChef.charge?.roomZones || []).some(paire => String(paire.roomId) === String(salle.id))),
  JSON.stringify(exportChef.charge?.roomZones).slice(0, 200));

/* ── 10 · verdict ─────────────────────────────────────────────────────── */
console.log(`\n╚═══ ${echecs === 0 ? '✅ AUCUN ÉCHEC' : '❌ ' + echecs + ' ÉCHEC(S)'} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
