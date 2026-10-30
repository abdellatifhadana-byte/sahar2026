/**
 * @file scripts/zone-image-scope-e2e.mjs — A02, mesuré sur le VRAI serveur.
 *
 * `tests/zone-discovery-image-scope.test.js` exerce la décision. Ce script-ci exerce la
 * RÉPONSE : PostgreSQL réel, serveur réel, six sessions réelles, et ce que le navigateur
 * recevrait vraiment sur `/api/access/context` et sur `/api/auth/session`.
 *
 * La distinction n'est pas décorative. Le défaut A02 se corrige côté serveur ou pas du
 * tout : masquer l'image dans `zone-access.js` la laisserait dans la réponse HTTP, donc
 * dans l'onglet Réseau, dans le cache, et dans tout client qui n'est pas cet écran-là. On
 * regarde donc les octets rendus, pas ce qu'un module en fait ensuite.
 *
 * Chaque image porte un marqueur unique et l'on cherche ce marqueur dans la réponse
 * ENTIÈRE : une fuite par un autre champ ne passerait pas.
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';

const IMAGE_RF1 = 'assets/a02-plan-rf1-MARQUEUR.png';
const IMAGE_STC = 'assets/a02-plan-stc-MARQUEUR.png';
const ZONE_RF1 = 'a02-zone-rf1';
const ZONE_STC = 'a02-zone-stc';
const IMAGE_DE = { [ZONE_RF1]: IMAGE_RF1, [ZONE_STC]: IMAGE_STC };

const MOT_DE_PASSE = 'A02-Perimetre-Image-2026!';

/*
 * Les six rôles canoniques, écrits comme la plateforme les enregistre. `portee` est la
 * zone où le compte est membre ET habilité en `zone.summary.read` ; « globale » désigne
 * les deux rôles qui court-circuitent les zones.
 */
const COMPTES = [
  { id: 92501, username: 'a02-manager', role: 'manager', libelle: 'Manager', portee: 'globale' },
  { id: 92502, username: 'a02-chef', role: 'chef', libelle: 'Chef', portee: ZONE_RF1 },
  { id: 92503, username: 'a02-responsable', role: 'responsable', libelle: 'Responsable', portee: ZONE_RF1 },
  { id: 92504, username: 'a02-technicien', role: 'technicien', libelle: 'Technique', portee: ZONE_STC },
  { id: 92505, username: 'a02-visiteur', role: 'visiteur', libelle: 'Visiteur', portee: ZONE_RF1 }
];

async function request(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.equal(response.status, expected, `${method} ${path} : attendu ${expected}, reçu ${response.status} ${text}`);
  return { payload, brut: text, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie } = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.ok(cookie.startsWith('tp_session='), `${username} : aucune session ouverte`);
  return cookie;
};

/* ─────────────────────────────── Le décor, posé par l'administrateur ─────────────────────────────── */

const admin = await connexion(adminUsername, adminPassword);

for (const [id, name, imageUrl, resume] of [
  [ZONE_RF1, 'A02 Régie Finale 1', IMAGE_RF1, 'Régie de diffusion principale.'],
  [ZONE_STC, 'A02 Studio Central', IMAGE_STC, 'Plateau et acquisition.']
]) {
  const { payload } = await request('/api/access/zones', {
    method: 'POST', cookie: admin,
    body: { id, name, imageUrl, publicSummary: resume, status: 'active' }
  });
  assert.equal(payload.zone.imageUrl, imageUrl, `${id} : l'image n'a pas été enregistrée par l'administrateur`);
}

for (const compte of COMPTES) {
  await request(`/api/data/users/${compte.id}`, {
    method: 'PUT', cookie: admin,
    body: {
      id: compte.id, username: compte.username, fullName: `A02 ${compte.libelle}`,
      role: compte.role, status: 'active',
      password: Buffer.from(MOT_DE_PASSE).toString('base64'), authVersion: 1
    }
  });
  if (compte.portee === 'globale') continue;
  await request('/api/access/memberships', {
    method: 'POST', cookie: admin,
    body: { userId: compte.id, zoneId: compte.portee, responsible: compte.role === 'responsable', expiresAt: null }
  });
  await request('/api/access/grants', {
    method: 'POST', cookie: admin,
    body: { userId: compte.id, zoneId: compte.portee, permission: 'zone.summary.read', expiresAt: null }
  });
}

/* ─────────────────────────────── Ce que chaque rôle reçoit vraiment ─────────────────────────────── */

const zoneDe = (contexte, id) => (contexte.zones || []).find(zone => String(zone.id) === id);
const nosZones = [ZONE_RF1, ZONE_STC];

// L'administrateur, d'abord : rien ne doit lui être retiré.
{
  const { payload, brut } = await request('/api/access/context', { cookie: admin });
  for (const id of nosZones) {
    assert.equal(zoneDe(payload, id).imageUrl, IMAGE_DE[id], `Admin : image de ${id} perdue`);
  }
  assert.ok(brut.includes(IMAGE_RF1) && brut.includes(IMAGE_STC), 'Admin : les images doivent rester servies');
  console.log('Admin — les deux images servies : OK');
}

for (const compte of COMPTES) {
  const cookie = await connexion(compte.username, MOT_DE_PASSE);

  // Les deux routes qui portent la projection vers le navigateur, pas une seule.
  for (const route of ['/api/access/context', '/api/auth/session']) {
    const { payload, brut } = await request(route, { cookie });
    const contexte = route === '/api/auth/session' ? payload.access : payload;
    assert.ok(contexte, `${compte.libelle} : ${route} ne porte pas le contexte d'accès`);

    for (const id of nosZones) {
      const zone = zoneDe(contexte, id);
      assert.ok(zone, `${compte.libelle} : la zone ${id} a disparu du catalogue — la demande d'accès en dépend`);
      assert.ok(zone.name && zone.publicSummary,
        `${compte.libelle} : ${id} doit rester nommée et résumée pour être demandable`);

      const dansLePerimetre = compte.portee === 'globale' || compte.portee === id;
      if (dansLePerimetre) {
        assert.equal(zone.imageUrl, IMAGE_DE[id],
          `${compte.libelle} : l'image de sa propre zone ${id} devrait être servie sur ${route}`);
      } else {
        assert.equal(zone.imageUrl, '',
          `${compte.libelle} : l'image de ${id}, hors périmètre, a été servie sur ${route}`);
        assert.ok(!brut.includes(IMAGE_DE[id]),
          `${compte.libelle} : le marqueur de ${id} a fui par un autre champ de ${route}`);
      }
    }
  }

  // Le parcours de demande d'accès reste praticable sur la zone hors périmètre.
  if (compte.portee !== 'globale') {
    const cible = nosZones.find(id => id !== compte.portee);
    const { payload } = await request('/api/access/requests', {
      method: 'POST', cookie, expected: 201,
      body: { zoneId: cible, requestedPermissions: ['zone.summary.read'], durationHours: 8, reason: 'Vérification A02.' }
    });
    const demande = payload.request || payload;
    assert.equal(String(demande.zoneId), cible, `${compte.libelle} : la demande ne vise pas ${cible}`);
    assert.equal(demande.status, 'pending', `${compte.libelle} : la demande d'accès sur ${cible} n'aboutit pas`);
  }

  console.log(`${compte.libelle} — périmètre respecté, zone hors périmètre demandable : OK`);
}

/* ─────────────────────────── La révocation retire l'image immédiatement ─────────────────────────── */

{
  const chef = COMPTES.find(compte => compte.role === 'chef');
  const cookie = await connexion(chef.username, MOT_DE_PASSE);

  const avant = await request('/api/access/context', { cookie });
  assert.equal(zoneDe(avant.payload, ZONE_RF1).imageUrl, IMAGE_RF1,
    "précondition : le chef doit d'abord recevoir l'image de sa zone");

  const habilitation = (avant.payload.grants || [])
    .find(item => String(item.zoneId) === ZONE_RF1 && item.permission === 'zone.summary.read');
  assert.ok(habilitation, "l'habilitation de lecture du chef devrait être visible dans son contexte");

  await request(`/api/access/grants/${encodeURIComponent(habilitation.id)}`, { method: 'DELETE', cookie: admin });

  const apres = await request('/api/access/context', { cookie });
  assert.equal(zoneDe(apres.payload, ZONE_RF1).imageUrl, '', "l'image survit à la révocation");
  assert.ok(!apres.brut.includes(IMAGE_RF1), "le marqueur de l'image survit à la révocation");
  assert.ok(zoneDe(apres.payload, ZONE_RF1).name,
    'la zone doit rester découvrable après révocation, pour pouvoir redemander l’accès');
  console.log('Révocation — image retirée sans nouvelle session, zone toujours découvrable : OK');
}

console.log('A02 : le périmètre de l’image est tenu par le SERVEUR, sur les six rôles.');
