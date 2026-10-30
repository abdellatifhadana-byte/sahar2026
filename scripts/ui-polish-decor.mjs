/**
 * @file scripts/ui-polish-decor.mjs — le décor commun du lot UI-POLISH-01.
 *
 * POURQUOI UN DÉCOR SÉPARÉ
 * ------------------------
 * L'épreuve de navigateur (`ui-polish-browser-gate.mjs`) mesure des POSITIONS et des
 * LIBELLÉS. Elle ne prouve rien si les données sous elle changent d'une exécution à
 * l'autre : « le contenu commence à 76 px » ne veut dire quelque chose que si l'on sait
 * exactement combien de salles et d'équipements sont à l'écran.
 *
 * Ce module pose donc, par le serveur réel et la base réelle, un décor déterministe :
 *
 *   · six comptes, un par rôle canonique ;
 *   · deux comptes SUPPLÉMENTAIRES à périmètre SANS aucune habilitation — c'est le cas
 *     P0-5, qui ne se mesure pas autrement ;
 *   · une salle non rattachée à la chaîne portant DIX-HUIT équipements dont UN SEUL est
 *     hors service — c'est exactement la configuration qui affichait « 18 hors service ».
 *
 * Le décor est idempotent : chaque enregistrement porte un identifiant fixe et est
 * réécrit. Deux exécutions de suite donnent la même base.
 */
import assert from 'node:assert/strict';

export const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4191';
export const MOT_DE_PASSE = process.env.E2E_PASSWORD || 'Vx8-Ombelle-Tourbe-Wq4!';

const ADMIN_USERNAME = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Kt5-Genepi-Sillon-Rz9!';

export const ZONE = 'ui-polish-zone';
export const SALLE_REGIE = 'ui-polish-salle-regie';
export const SALLE_DIFFUSION = 'ui-polish-salle-diffusion';
export const SALLE_LIBRE = 'ui-polish-salle-libre';

/** Le cas mesuré par P0-3 : dix-huit éléments, une seule panne. */
export const HORS_CHAINE_TOTAL = 18;
export const HORS_CHAINE_EN_PANNE = 1;

/**
 * Le compte administrateur n'a PAS le mot de passe des autres : il est défini par
 * l'environnement (`PLATFORM_ADMIN_PASSWORD`) et le décor ne le choisit pas. Chaque
 * compte porte donc le sien, plutôt qu'un mot de passe unique dont l'administrateur
 * serait la fausse exception.
 */
export const COMPTES = Object.freeze({
  admin:        { id: null, username: ADMIN_USERNAME, role: 'admin', habilite: true, motDePasse: ADMIN_PASSWORD },
  manager:      { id: 9101, username: 'ui-manager',      role: 'manager',     habilite: true  },
  chef:         { id: 9102, username: 'ui-chef',         role: 'chef',        habilite: true  },
  responsable:  { id: 9103, username: 'ui-responsable',  role: 'responsible', habilite: true  },
  technique:    { id: 9104, username: 'ui-technique',    role: 'technician',  habilite: true  },
  visiteur:     { id: 9105, username: 'ui-visiteur',     role: 'visitor',     habilite: true  },
  chefSansGrant:      { id: 9106, username: 'ui-chef-sans-grant',      role: 'chef',       habilite: false },
  techniqueSansGrant: { id: 9107, username: 'ui-technique-sans-grant', role: 'technician', habilite: false }
});

async function requete(chemin, { method = 'GET', cookie = '', body, expected = null } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
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
  if (expected !== null && reponse.status !== expected) {
    throw new Error(`${method} ${chemin} : attendu ${expected}, reçu ${reponse.status} — ${texte.slice(0, 300)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

/**
 * Écriture IDEMPOTENTE d'un enregistrement versionné.
 *
 * Le serveur refuse une création sur un identifiant déjà pris (`ALREADY_EXISTS`) et une
 * modification qui ignore la révision courante (`STALE_WRITE`) : c'est le contrat de
 * concurrence, et il a raison. Le décor lit donc la révision en place et la déclare —
 * deux exécutions de suite laissent la même base, sans rien contourner.
 */
let revisionsConnues = null;

/** Les révisions en place, lues UNE FOIS dans l'instantané central. */
async function chargerRevisions(cookie) {
  const instantane = await requete('/api/sync', { cookie, expected: 200 });
  revisionsConnues = new Map();
  for (const [store, enregistrements] of Object.entries(instantane.charge?.data || {})) {
    for (const enregistrement of enregistrements || []) {
      if (enregistrement?.id === undefined || enregistrement?._revision === undefined) continue;
      revisionsConnues.set(`${store}:${enregistrement.id}`, enregistrement._revision);
    }
  }
}

async function ecrire(store, id, corps, cookie) {
  const revision = revisionsConnues?.get(`${store}:${id}`);
  const reponse = await requete(`/api/data/${store}/${encodeURIComponent(id)}`, {
    method: 'PUT', cookie,
    body: revision === undefined ? corps : { ...corps, expectedRevision: revision },
    expected: 200
  });
  // La révision vient d'avancer : la retenir évite une relecture complète par écriture.
  const posee = reponse.charge?.record?._revision;
  if (posee !== undefined) revisionsConnues?.set(`${store}:${id}`, posee);
  return reponse;
}

/**
 * Les habilitations posées sur la zone, par rôle.
 *
 * Elles ne sont pas choisies au hasard : chacune existe déjà dans `access-control.js` et
 * reste SOUS le plafond du rôle. Le décor n'élargit aucune permission — il en pose de
 * réelles pour que « avec habilitation » et « sans habilitation » se distinguent.
 */
const HABILITATIONS = Object.freeze({
  // `zone.summary.read` conditionne la LECTURE DES SALLES côté serveur
  // (`access-control.js`, READ_PERMISSION_BY_STORE). Sans elle, un rôle par ailleurs
  // habilité voit ses baies et ses équipements mais une liste de salles vide — c'est
  // exactement le cas « autorisé mais rien à voir » que le lot doit distinguer, et il
  // faut donc pouvoir le poser volontairement.
  chef: ['zone.summary.read', 'room.edit', 'equipment.read', 'equipment.edit', 'screen.read', 'ticket.read'],
  responsible: ['zone.summary.read', 'equipment.read', 'screen.read', 'ticket.read', 'procedure.read'],
  technician: ['zone.summary.read', 'equipment.read', 'equipment.edit', 'screen.read', 'ticket.read', 'diagnostic.run'],
  visitor: ['zone.summary.read']
});

/** Le mot de passe d'un compte du décor. */
export const motDePasseDe = compte => compte?.motDePasse || MOT_DE_PASSE;

export async function poserLeDecor({ trace = true } = {}) {
  const journal = message => { if (trace) console.log(message); };

  const admin = await requete('/api/auth/login', {
    method: 'POST', body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }, expected: 200
  });
  assert.ok(admin.cookie.startsWith('tp_session='), 'cookie administrateur absent');
  const cookieAdmin = admin.cookie;
  COMPTES.admin.id = admin.charge?.user?.id ?? null;

  await chargerRevisions(cookieAdmin);

  await requete('/api/access/zones', {
    method: 'POST', cookie: cookieAdmin,
    body: { id: ZONE, name: 'Régie UI', publicSummary: 'Zone d’épreuve du lot UI-POLISH-01.' }, expected: 200
  });
  journal('  · zone posée');

  for (const compte of Object.values(COMPTES)) {
    if (compte.role === 'admin') continue;
    await ecrire('users', compte.id, {
      id: compte.id, username: compte.username, fullName: nomComplet(compte),
      role: compte.role, status: 'active',
      password: Buffer.from(MOT_DE_PASSE).toString('base64'), authVersion: 1
    }, cookieAdmin);
    if (!compte.habilite) continue;
    await requete('/api/access/memberships', {
      method: 'POST', cookie: cookieAdmin,
      body: { userId: compte.id, zoneId: ZONE, responsible: compte.role === 'responsible', expiresAt: null },
      expected: 200
    });
    for (const permission of HABILITATIONS[compte.role] || []) {
      await requete('/api/access/grants', {
        method: 'POST', cookie: cookieAdmin,
        body: { userId: compte.id, zoneId: ZONE, permission, expiresAt: null }, expected: 200
      });
    }
  }
  journal(`  · ${Object.keys(COMPTES).length} comptes posés (dont 2 à périmètre SANS habilitation)`);

  const salles = [
    { id: SALLE_REGIE, name: 'Régie finale UI', chainSegment: 'regie' },
    { id: SALLE_DIFFUSION, name: 'Diffusion UI', chainSegment: 'diffusion' },
    // Pas de `chainSegment` : c'est le hors-chaîne, celui qui portait « 18 hors service ».
    { id: SALLE_LIBRE, name: 'Salle non rattachée UI' }
  ];
  for (const salle of salles) {
    await ecrire('rooms', salle.id,
      { ...salle, location: 'Casablanca', zoneId: ZONE, responsibleId: COMPTES.responsable.id }, cookieAdmin);
    await requete('/api/access/resource-zones', {
      method: 'POST', cookie: cookieAdmin,
      body: { resourceType: 'room', resourceId: salle.id, zoneId: ZONE }, expected: 200
    });
  }
  journal('  · 3 salles posées (régie, diffusion, hors-chaîne)');

  await ecrire('baies', 'ui-polish-baie',
    { id: 'ui-polish-baie', name: 'Baie UI 01', roomId: SALLE_LIBRE, salleId: SALLE_LIBRE }, cookieAdmin);

  for (let index = 0; index < HORS_CHAINE_TOTAL; index += 1) {
    const enPanne = index < HORS_CHAINE_EN_PANNE;
    const identifiant = `ui-polish-eq-${String(index + 1).padStart(2, '0')}`;
    await ecrire('equipments', identifiant, {
      id: identifiant, name: `Équipement hors-chaîne ${index + 1}`,
      type: 'Convertisseur', roomId: SALLE_LIBRE, salleId: SALLE_LIBRE, baieId: 'ui-polish-baie',
      statut: enPanne ? 'Hors service' : 'Opérationnel'
    }, cookieAdmin);
  }
  for (let index = 0; index < 4; index += 1) {
    await ecrire('equipments', `ui-polish-regie-${index + 1}`, {
      id: `ui-polish-regie-${index + 1}`, name: `Mélangeur régie ${index + 1}`,
      type: 'Mélangeur', roomId: SALLE_REGIE, salleId: SALLE_REGIE, statut: 'Opérationnel'
    }, cookieAdmin);
  }
  journal(`  · ${HORS_CHAINE_TOTAL} équipements hors-chaîne dont ${HORS_CHAINE_EN_PANNE} hors service, 4 en régie`);

  return { cookieAdmin };
}

/**
 * Des noms de la longueur de ceux du parc — ni initiales, ni phrases.
 *
 * L'en-tête se mesure sur ce qu'il affiche : un libellé de test à quarante signes
 * prouverait seulement qu'un nom de quarante signes ne tient pas à 1024, ce que
 * personne ne conteste. Les noms ci-dessous font douze à seize signes, comme ceux
 * des comptes réels.
 */
const NOMS = Object.freeze({
  manager: 'Amina Bensalem', chef: 'Karim El Fassi', responsible: 'Nadia Ouazzani',
  technician: 'Youssef Brahmi', visitor: 'Salma Cherkaoui', admin: 'Administrateur'
});

function nomComplet(compte) {
  return compte.habilite ? NOMS[compte.role] : `${NOMS[compte.role]} (sans zone)`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\n╔═══ décor UI-POLISH-01 — ${BASE} ═══╗\n`);
  await poserLeDecor();
  console.log('\n╚═══ décor posé ═══╝\n');
}
