/**
 * @file tests/zone-discovery-image-scope.test.js — A02 : la zone se découvre, son image non.
 *
 * CE QUE CETTE PORTE GARDE
 * ------------------------
 * `contextFor()` est la projection que le serveur renvoie sur `/api/access/context`, sur
 * `/api/auth/session` et dans chaque `/api/sync`. Elle listait TOUTES les zones actives
 * — avec leur `imageUrl` — à QUICONQUE ouvrait une session, quel que soit son périmètre.
 *
 * La liste elle-même n'est pas le défaut : elle est VOULUE. Sans le nom d'une zone,
 * personne ne peut demander l'accès qu'il n'a pas encore, et `zone-access.js` construit sa
 * liste déroulante « Demander un accès » exactement à partir de ce catalogue. Le retirer
 * fermerait le parcours de demande d'accès, ce qui serait un défaut plus grave que celui
 * qu'on corrige.
 *
 * `imageUrl`, en revanche, n'est pas une étiquette de découverte : un administrateur y met
 * la photo d'une salle, d'une baie, un plan. C'est de l'information VISUELLE sur
 * l'installation, et « un bitmap est INDIVISIBLE » — le raisonnement que
 * `access-control.js` tient déjà pour le plan du site vaut identiquement ici.
 *
 * Cette porte tient donc, pour les SIX rôles canoniques, cinq promesses à la fois :
 *
 *   1. la zone hors périmètre reste DÉCOUVRABLE — nom, résumé, statut, et demandable ;
 *   2. son image ne part PAS, et son URL n'apparaît nulle part dans la réponse ;
 *   3. l'image part dans le périmètre AUTORISÉ, et seulement là ;
 *   4. le périmètre de l'image est EXACTEMENT celui de la lecture (`zone.summary.read`) —
 *      ni plus large, ni plus étroit : aucun rôle n'est élargi ;
 *   5. révoquer l'habilitation OU l'adhésion retire l'image au prochain appel.
 *
 * Elle exerce le VRAI `createAccessControl(pool)` sur un double de base fidèle aux requêtes
 * que le module émet réellement — y compris le verrou consultatif et le `SELECT … FOR
 * UPDATE` de `revision-store.js`, sans quoi la création d'une demande d'accès ne serait pas
 * jouée mais simulée. Toute requête inattendue lève : une couverture ne peut pas devenir
 * silencieusement creuse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAccessControl } from '../scripts/access-control.js';

const lire = fichier => readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');

/* ------------------------------ Le double de base ------------------------------
 *
 * Il ne « comprend » pas le SQL : il reconnaît les requêtes que le code émet, et REFUSE
 * tout le reste. Une requête non reconnue signalerait que le module a changé de chemin
 * d'accès et que ce test ne mesure plus ce qu'il croit mesurer.
 */
function basePlatforme(depart = {}) {
  const lignes = new Map();
  const cle = (store, id) => `${store} ${id}`;
  let horloge = 0;

  const ecrire = (store, id, data, deleted) => {
    lignes.set(cle(store, id), {
      store_name: store, record_id: String(id), data, deleted, updated_at: ++horloge
    });
  };
  for (const [store, enregistrements] of Object.entries(depart)) {
    for (const enregistrement of enregistrements) ecrire(store, enregistrement.id, enregistrement, false);
  }

  async function query(sql, params = []) {
    const texte = String(sql).replace(/\s+/g, ' ').trim();

    if (texte === 'BEGIN' || texte === 'COMMIT' || texte === 'ROLLBACK') return { rows: [] };
    if (texte.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };

    if (texte.startsWith('SELECT data FROM platform_records WHERE store_name=$1 AND record_id=$2 AND deleted=FALSE')) {
      const ligne = lignes.get(cle(params[0], String(params[1])));
      return { rows: ligne && !ligne.deleted ? [{ data: ligne.data }] : [] };
    }
    if (texte.startsWith('SELECT record_id,data,updated_at FROM platform_records WHERE store_name=$1 AND deleted=FALSE')) {
      const trouvees = [...lignes.values()]
        .filter(ligne => ligne.store_name === params[0] && !ligne.deleted)
        .sort((a, b) => a.updated_at - b.updated_at || a.record_id.localeCompare(b.record_id));
      return { rows: trouvees.map(ligne => ({ record_id: ligne.record_id, data: ligne.data, updated_at: ligne.updated_at })) };
    }
    if (texte.startsWith('SELECT data, deleted FROM platform_records WHERE store_name=$1 AND record_id=$2 FOR UPDATE')) {
      const ligne = lignes.get(cle(params[0], String(params[1])));
      return { rows: ligne ? [{ data: ligne.data, deleted: ligne.deleted }] : [] };
    }
    if (texte.startsWith('INSERT INTO platform_records')) {
      ecrire(params[0], params[1], JSON.parse(params[2]), /,\$3::jsonb,TRUE,/.test(texte));
      return { rows: [] };
    }
    throw new Error(`Requête inattendue dans le double de base : ${texte}`);
  }

  const pool = { query, async connect() { return { query, release() {} }; } };
  return { pool, ecrire, contenu: (store, id) => lignes.get(cle(store, id))?.data ?? null };
}

/* --------------------------------- Le décor ---------------------------------
 *
 * Deux zones actives et une inactive. Chaque image porte un marqueur unique : c'est lui
 * qu'on cherche dans la réponse SÉRIALISÉE, ce qui attrape une fuite par n'importe quel
 * champ, pas seulement par celui qu'on pense surveiller.
 */
const IMAGE_RF1 = 'data:image/png;base64,MARQUEUR-PLAN-RF1-CONFIDENTIEL';
const IMAGE_STC = 'data:image/png;base64,MARQUEUR-PLAN-STC-CONFIDENTIEL';
const IMAGE_ARCHIVE = 'data:image/png;base64,MARQUEUR-PLAN-ARCHIVE-CONFIDENTIEL';

const ZONES = [
  { id: 'Z-RF1', name: 'Régie Finale 1', slug: 'regie-finale-1', status: 'active',
    publicSummary: 'Régie de diffusion principale.', imageUrl: IMAGE_RF1 },
  { id: 'Z-STC', name: 'Studio Central', slug: 'studio-central', status: 'active',
    publicSummary: 'Plateau et acquisition.', imageUrl: IMAGE_STC },
  { id: 'Z-ARC', name: 'Archives', slug: 'archives', status: 'inactive',
    publicSummary: 'Fonds archivés.', imageUrl: IMAGE_ARCHIVE }
];

/* Du contenu opérationnel, dans les magasins que la projection ne doit JAMAIS toucher. */
const MARQUEURS_OPERATIONNELS = [
  'MARQUEUR-SALLE', 'MARQUEUR-BAIE', 'MARQUEUR-EQUIPEMENT',
  'MARQUEUR-ECRAN', 'MARQUEUR-CABLE', 'MARQUEUR-PROCEDURE'
];
const OPERATIONNEL = {
  rooms: [{ id: 'R1', name: 'MARQUEUR-SALLE Régie Finale 1', zoneIds: ['Z-RF1'] }],
  baies: [{ id: 'B1', name: 'MARQUEUR-BAIE 12', roomId: 'R1' }],
  equipments: [{ id: 'E1', name: 'MARQUEUR-EQUIPEMENT Ultrix', baieId: 'B1' }],
  screens: [{ id: 'S1', name: 'MARQUEUR-ECRAN Mur A1', roomId: 'R1' }],
  cables: [{ id: 'C1', label: 'MARQUEUR-CABLE SDI-042', fromEquipmentId: 'E1' }],
  docs: [{ id: 'D1', title: 'MARQUEUR-PROCEDURE bascule secours', zoneIds: ['Z-RF1'] }],
  resource_zones: [
    { id: 'RZ1', resourceType: 'room', resourceId: 'R1', zoneId: 'Z-RF1' },
    { id: 'RZ2', resourceType: 'room', resourceId: 'R2', zoneId: 'Z-STC' }
  ]
};

/*
 * Les six rôles, écrits comme la plateforme les enregistre : en français. Ce sont
 * précisément les libellés qui, avant la normalisation en amont, ne tombaient dans aucune
 * matrice — les réutiliser ici garde la porte contre une régression de ce côté aussi.
 */
const COMPTES = [
  { id: 'u-admin', role: 'admin', libelle: 'Admin', portee: 'globale' },
  { id: 'u-manager', role: 'manager', libelle: 'Manager', portee: 'globale' },
  { id: 'u-chef', role: 'chef', libelle: 'Chef', portee: 'Z-RF1' },
  { id: 'u-resp', role: 'responsable', libelle: 'Responsable', portee: 'Z-RF1' },
  { id: 'u-tech', role: 'technicien', libelle: 'Technique', portee: 'Z-STC' },
  { id: 'u-visit', role: 'visiteur', libelle: 'Visiteur', portee: 'Z-RF1' }
];

const IMAGE_ATTENDUE = { 'Z-RF1': IMAGE_RF1, 'Z-STC': IMAGE_STC };
const zonesAPortee = compte => (compte.portee === 'globale' ? ['Z-RF1', 'Z-STC'] : [compte.portee]);

function decor() {
  const adhesions = [];
  const habilitations = [];
  for (const compte of COMPTES) {
    if (compte.portee === 'globale') continue;
    adhesions.push({
      id: `M-${compte.id}`, userId: compte.id, zoneId: compte.portee, status: 'active',
      responsible: compte.role === 'responsable'
    });
    habilitations.push({
      id: `G-${compte.id}`, userId: compte.id, zoneId: compte.portee,
      permission: 'zone.summary.read', status: 'active'
    });
  }
  // Le responsable revoit les demandes de sa zone : c'est son habilitation propre.
  habilitations.push({
    id: 'G-resp-review', userId: 'u-resp', zoneId: 'Z-RF1', permission: 'access.review', status: 'active'
  });

  const base = basePlatforme({
    zones: ZONES,
    zone_memberships: adhesions,
    zone_grants: habilitations,
    users: COMPTES.map(compte => ({ id: compte.id, username: compte.id, role: compte.role })),
    access_requests: [],
    ...OPERATIONNEL
  });
  return { ...base, access: createAccessControl(base.pool) };
}

const utilisateur = compte => ({ id: compte.id, role: compte.role });
const compteDe = role => COMPTES.find(item => item.role === role);
const zoneDe = (contexte, id) => contexte.zones.find(zone => String(zone.id) === id);

/* ========================= 1 . LA DÉCOUVERTE RESTE ENTIÈRE ========================= */

test('les six rôles découvrent TOUTES les zones actives — nom, résumé et statut compris', async () => {
  const { access } = decor();
  for (const compte of COMPTES) {
    const contexte = await access.contextFor(utilisateur(compte));
    assert.deepEqual(contexte.zones.map(zone => zone.id), ['Z-RF1', 'Z-STC'],
      `${compte.libelle} : le catalogue des zones a été amputé — le parcours de demande d'accès en dépend`);
    for (const zone of contexte.zones) {
      const source = ZONES.find(item => item.id === zone.id);
      assert.equal(zone.name, source.name, `${compte.libelle} : le nom de ${zone.id} a disparu`);
      assert.equal(zone.slug, source.slug, `${compte.libelle} : le slug de ${zone.id} a disparu`);
      assert.equal(zone.publicSummary, source.publicSummary, `${compte.libelle} : le résumé public de ${zone.id} a disparu`);
      assert.equal(zone.status, 'active');
    }
  }
});

test('une zone inactive ne se découvre pas, et son image encore moins', async () => {
  const { access } = decor();
  for (const compte of COMPTES) {
    const contexte = await access.contextFor(utilisateur(compte));
    assert.equal(zoneDe(contexte, 'Z-ARC'), undefined,
      `${compte.libelle} : une zone inactive est apparue au catalogue`);
    assert.ok(!JSON.stringify(contexte).includes(IMAGE_ARCHIVE),
      `${compte.libelle} : l'image d'une zone inactive a fui`);
  }
});

/* =================== 2 . L'IMAGE SUIT LE PÉRIMÈTRE, ET RIEN D'AUTRE =================== */

test('rôles à portée globale : Admin et Manager reçoivent les images comme avant', async () => {
  const { access } = decor();
  for (const compte of COMPTES.filter(item => item.portee === 'globale')) {
    const contexte = await access.contextFor(utilisateur(compte));
    assert.equal(contexte.isGlobalAdmin, true, `${compte.libelle} devrait être reconnu à portée globale`);
    assert.equal(zoneDe(contexte, 'Z-RF1').imageUrl, IMAGE_RF1, `${compte.libelle} a perdu l'image de Z-RF1`);
    assert.equal(zoneDe(contexte, 'Z-STC').imageUrl, IMAGE_STC, `${compte.libelle} a perdu l'image de Z-STC`);
  }
});

test("dans le périmètre autorisé, l'image est bien servie", async () => {
  const { access } = decor();
  for (const compte of COMPTES.filter(item => item.portee !== 'globale')) {
    const contexte = await access.contextFor(utilisateur(compte));
    assert.equal(zoneDe(contexte, compte.portee).imageUrl, IMAGE_ATTENDUE[compte.portee],
      `${compte.libelle} : l'image de sa propre zone ${compte.portee} devrait être servie`);
  }
});

test("hors périmètre, l'image ne part pas — et son URL n'apparaît NULLE PART dans la réponse", async () => {
  const { access } = decor();
  for (const compte of COMPTES.filter(item => item.portee !== 'globale')) {
    const contexte = await access.contextFor(utilisateur(compte));
    const serialise = JSON.stringify(contexte);
    for (const zone of contexte.zones) {
      if (zonesAPortee(compte).includes(String(zone.id))) continue;
      assert.equal(zone.imageUrl, '',
        `${compte.libelle} : l'image de ${zone.id}, hors de son périmètre, a été servie`);
      assert.ok(!serialise.includes(IMAGE_ATTENDUE[zone.id]),
        `${compte.libelle} : l'URL de l'image de ${zone.id} a fui par un autre champ que imageUrl`);
    }
  }
});

test("hors périmètre, la zone garde EXACTEMENT la forme d'une zone sans image publiée", async () => {
  // Une clé retirée donnerait deux formes pour une même zone selon le lecteur — de la
  // réécriture au repos pour les consommateurs qui comparent des instantanés (#164).
  const { access } = decor();
  const attendues = ['id', 'name', 'slug', 'publicSummary', 'imageUrl', 'status'].sort();
  for (const compte of COMPTES) {
    const contexte = await access.contextFor(utilisateur(compte));
    for (const zone of contexte.zones) {
      assert.deepEqual(Object.keys(zone).sort(), attendues,
        `${compte.libelle} : la forme de ${zone.id} a changé — ${Object.keys(zone).join(', ')}`);
    }
  }
});

/* ============ 3 . AUCUN CONTENU OPÉRATIONNEL, AUCUNE ADHÉSION D'AUTRUI ============ */

test('la projection ne transporte aucun contenu opérationnel', async () => {
  const { access } = decor();
  for (const compte of COMPTES) {
    const serialise = JSON.stringify(await access.contextFor(utilisateur(compte)));
    for (const marqueur of MARQUEURS_OPERATIONNELS) {
      assert.ok(!serialise.includes(marqueur),
        `${compte.libelle} : « ${marqueur} » a fui par le contexte d'accès`);
    }
  }
});

test("un rôle à périmètre ne reçoit ni les adhésions ni les habilitations d'autrui", async () => {
  const { access } = decor();
  for (const compte of COMPTES.filter(item => item.portee !== 'globale')) {
    const contexte = await access.contextFor(utilisateur(compte));
    for (const adhesion of contexte.memberships) {
      assert.equal(String(adhesion.userId), compte.id, `${compte.libelle} : adhésion d'un autre compte servie`);
    }
    for (const habilitation of contexte.grants) {
      assert.equal(String(habilitation.userId), compte.id, `${compte.libelle} : habilitation d'un autre compte servie`);
    }
    assert.equal(contexte.isGlobalAdmin, false);
  }
});

/* ================ 4 . LE PARCOURS DE DEMANDE D'ACCÈS RESTE PRATICABLE ================ */

test("une zone hors périmètre reste DEMANDABLE : la demande d'accès aboutit", async () => {
  const { access, contenu } = decor();
  for (const compte of COMPTES.filter(item => item.portee !== 'globale')) {
    const contexte = await access.contextFor(utilisateur(compte));
    const horsPerimetre = contexte.zones.find(zone => !zonesAPortee(compte).includes(String(zone.id)));
    assert.ok(horsPerimetre, `${compte.libelle} : aucune zone hors périmètre à demander`);

    const demande = await access.createRequest(utilisateur(compte), {
      zoneId: horsPerimetre.id,
      requestedPermissions: ['zone.summary.read'],
      reason: `Intervention planifiée en ${horsPerimetre.name}.`,
      durationHours: 8
    });
    assert.equal(demande.status, 'pending', `${compte.libelle} : la demande n'a pas été enregistrée`);
    assert.equal(String(demande.zoneId), String(horsPerimetre.id));
    assert.deepEqual(demande.requestedPermissions, ['zone.summary.read']);
    assert.ok(contenu('access_requests', demande.id), `${compte.libelle} : la demande n'a pas atteint la base`);
  }
});

test("le nom et le résumé suffisent à remplir la liste déroulante de la demande d'accès", async () => {
  // `zone-access.js` construit `<option value=zone.id>zone.name</option>` depuis ce
  // catalogue : sans identifiant ni nom, le formulaire n'aurait rien à proposer.
  const { access } = decor();
  const contexte = await access.contextFor(utilisateur(compteDe('visiteur')));
  const horsPerimetre = contexte.zones.filter(zone => String(zone.id) !== 'Z-RF1');
  assert.equal(horsPerimetre.length, 1);
  assert.ok(horsPerimetre[0].id && horsPerimetre[0].name && horsPerimetre[0].publicSummary,
    'la zone hors périmètre doit rester identifiable, nommée et résumée');
});

/* ====== 5 . AUCUN ÉLARGISSEMENT : LE PÉRIMÈTRE DE L'IMAGE EST CELUI DE LA LECTURE ====== */

test("le périmètre de l'image est EXACTEMENT celui de zone.summary.read", async () => {
  const { access } = decor();
  for (const compte of COMPTES) {
    const contexte = await access.contextFor(utilisateur(compte));
    for (const zone of contexte.zones) {
      const peutLire = await access.hasPermission(utilisateur(compte), zone.id, 'zone.summary.read');
      assert.equal(Boolean(zone.imageUrl), peutLire,
        `${compte.libelle} / ${zone.id} : l'image et la lecture divergent — image=${Boolean(zone.imageUrl)}, lecture=${peutLire}`);
    }
  }
});

test("une adhésion SANS habilitation de lecture n'ouvre pas l'image", async () => {
  // C'est le cas qu'un périmètre calculé en UNION — « membre OU habilité » — laisserait
  // passer : la porte de l'image s'ouvrirait là où celle de la lecture reste fermée.
  const { pool, ecrire } = basePlatforme({
    zones: ZONES,
    zone_memberships: [{ id: 'M1', userId: 'u-tech', zoneId: 'Z-RF1', status: 'active' }],
    zone_grants: [{ id: 'G1', userId: 'u-tech', zoneId: 'Z-RF1', permission: 'ticket.read', status: 'active' }],
    users: [], access_requests: []
  });
  const access = createAccessControl(pool);
  const technicien = { id: 'u-tech', role: 'technicien' };

  let contexte = await access.contextFor(technicien);
  assert.equal(zoneDe(contexte, 'Z-RF1').imageUrl, '',
    "membre sans habilitation de lecture : l'image ne doit pas être servie");
  assert.equal(zoneDe(contexte, 'Z-RF1').name, 'Régie Finale 1', 'la zone doit rester découvrable');

  // Contre-épreuve : la même adhésion, plus l'habilitation de lecture, ouvre l'image.
  ecrire('zone_grants', 'G2',
    { id: 'G2', userId: 'u-tech', zoneId: 'Z-RF1', permission: 'zone.summary.read', status: 'active' }, false);
  contexte = await access.contextFor(technicien);
  assert.equal(zoneDe(contexte, 'Z-RF1').imageUrl, IMAGE_RF1,
    "membre habilité en lecture : l'image devrait être servie — sans quoi le cas précédent ne prouve rien");
});

test("une habilitation SANS adhésion n'ouvre pas l'image", async () => {
  const { pool } = basePlatforme({
    zones: ZONES,
    zone_memberships: [],
    zone_grants: [{ id: 'G1', userId: 'u-tech', zoneId: 'Z-RF1', permission: 'zone.summary.read', status: 'active' }],
    users: [], access_requests: []
  });
  const access = createAccessControl(pool);
  const contexte = await access.contextFor({ id: 'u-tech', role: 'technicien' });
  assert.equal(zoneDe(contexte, 'Z-RF1').imageUrl, '',
    "habilitation sans adhésion : l'image ne doit pas être servie");
});

test('une adhésion en zone A et une habilitation en zone B ne se combinent pas', async () => {
  const { pool } = basePlatforme({
    zones: ZONES,
    zone_memberships: [{ id: 'M1', userId: 'u-tech', zoneId: 'Z-RF1', status: 'active' }],
    zone_grants: [{ id: 'G1', userId: 'u-tech', zoneId: 'Z-STC', permission: 'zone.summary.read', status: 'active' }],
    users: [], access_requests: []
  });
  const access = createAccessControl(pool);
  const contexte = await access.contextFor({ id: 'u-tech', role: 'technicien' });
  assert.equal(zoneDe(contexte, 'Z-RF1').imageUrl, '', 'adhésion seule en Z-RF1 : aucune image');
  assert.equal(zoneDe(contexte, 'Z-STC').imageUrl, '', 'habilitation seule en Z-STC : aucune image');
});

/* ================= 6 . UNE RÉVOCATION RETIRE L'IMAGE IMMÉDIATEMENT ================= */

test("révoquer l'habilitation de lecture retire l'image au prochain appel", async () => {
  const { access } = decor();
  const chef = utilisateur(compteDe('chef'));
  const administrateur = utilisateur(compteDe('admin'));

  assert.equal(zoneDe(await access.contextFor(chef), 'Z-RF1').imageUrl, IMAGE_RF1,
    "précondition : le chef doit d'abord recevoir l'image de sa zone");

  const revoquee = await access.revokeGrant(administrateur, 'G-u-chef');
  assert.equal(revoquee.status, 'revoked');

  const apres = await access.contextFor(chef);
  assert.equal(zoneDe(apres, 'Z-RF1').imageUrl, '', "l'image survit à la révocation de l'habilitation");
  assert.ok(!JSON.stringify(apres).includes(IMAGE_RF1), "l'URL de l'image survit à la révocation");
  assert.equal(zoneDe(apres, 'Z-RF1').name, 'Régie Finale 1',
    "la zone doit rester découvrable après révocation, pour pouvoir redemander l'accès");
});

test("révoquer l'adhésion retire l'image au prochain appel", async () => {
  const { access, ecrire, contenu } = decor();
  const visiteur = utilisateur(compteDe('visiteur'));

  assert.equal(zoneDe(await access.contextFor(visiteur), 'Z-RF1').imageUrl, IMAGE_RF1,
    "précondition : le visiteur doit d'abord recevoir l'image de sa zone");

  ecrire('zone_memberships', 'M-u-visit', { ...contenu('zone_memberships', 'M-u-visit'), status: 'revoked' }, false);

  assert.equal(zoneDe(await access.contextFor(visiteur), 'Z-RF1').imageUrl, '',
    "l'image survit à la révocation de l'adhésion");
});

test("une habilitation EXPIRÉE ne sert plus l'image", async () => {
  const { access, ecrire, contenu } = decor();
  const technicien = utilisateur(compteDe('technicien'));

  assert.equal(zoneDe(await access.contextFor(technicien), 'Z-STC').imageUrl, IMAGE_STC,
    "précondition : le technicien doit d'abord recevoir l'image de sa zone");

  ecrire('zone_grants', 'G-u-tech', {
    ...contenu('zone_grants', 'G-u-tech'),
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  }, false);

  assert.equal(zoneDe(await access.contextFor(technicien), 'Z-STC').imageUrl, '',
    "une habilitation expirée sert encore l'image");
});

/* ====================== 7 . LA DÉCISION EST CELLE DU SERVEUR ====================== */

test("la décision est prise par le serveur, pas par l'écran", () => {
  const serveur = lire('scripts/serve.js');
  // Les trois routes qui portent la projection vers le navigateur passent toutes par
  // `contextFor` : c'est là, et nulle part ailleurs, que le périmètre est appliqué.
  for (const route of ['/api/access/context', '/api/auth/session', '/api/sync']) {
    assert.ok(serveur.includes(route), `la route ${route} a disparu du serveur`);
  }
  assert.ok(/access\.contextFor\(user\)/.test(serveur), 'le serveur ne sert plus la projection par contextFor');

  const controle = lire('scripts/access-control.js');
  assert.ok(/ZONE_IMAGE_PERMISSION = 'zone\.summary\.read'/.test(controle),
    "le périmètre de l'image doit rester ancré sur une permission EXISTANTE, zone.summary.read");

  // Les autres lecteurs de `publicZoneSummaries()` n'en projettent que l'identité.
  for (const extrait of serveur.split('publicZoneSummaries()').slice(1)) {
    assert.ok(!extrait.slice(0, 400).includes('imageUrl'),
      'un autre lecteur de publicZoneSummaries() projette imageUrl sans contrôle de périmètre');
  }
});

test("l'écran ne promet plus « Résumé uniquement » là où il montre un hors-périmètre", () => {
  const ecran = lire('zone-access.js');
  assert.ok(!ecran.includes('Résumé uniquement'), 'le libellé ambigu « Résumé uniquement » subsiste');
  assert.ok(ecran.includes('Hors périmètre — résumé public'),
    'le libellé explicite « Hors périmètre — résumé public » est absent');
});

test('la règle « adhésion ET habilitation, même zone » n\'est écrite qu\'une fois', () => {
  // Une quatrième copie de la règle, c'est une quatrième occasion de diverger : c'est ce
  // genre de duplication qui a produit ce défaut. `hasPermission`,
  // `hasEffectivePermissionSomewhere` et le périmètre d'image consultent la MÊME fonction.
  const controle = lire('scripts/access-control.js');
  const definitions = controle.match(/const zonesOuLaPermissionEstDetenue = /g) || [];
  assert.equal(definitions.length, 1, "la règle est définie plus d'une fois");
  const appels = controle.match(/zonesOuLaPermissionEstDetenue\(/g) || [];
  assert.equal(appels.length, 3,
    `trois appelants sont attendus — hasPermission, hasEffectivePermissionSomewhere et le périmètre d'image — trouvé ${appels.length}`);
});
