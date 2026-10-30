/**
 * @file scripts/concurrence-e2e.mjs — deux sessions, un enregistrement, une perte.
 *
 * LE DÉFAUT MESURÉ
 * ----------------
 * `PUT /api/data/:store/:id` remplace l'enregistrement ENTIER par la charge utile reçue.
 * Aucune version n'est comparée. Le scénario suivant perd donc du travail, en silence :
 *
 *   1. la session A ouvre une fiche et la garde à l'écran ;
 *   2. la session B modifie un champ — une géométrie, un statut, un nom — et enregistre ;
 *   3. la session A enregistre SA copie, vieille de quelques minutes ;
 *   4. la modification de B disparaît. Personne n'est prévenu, ni A ni B.
 *
 * Ce n'est pas une course rare entre deux requêtes simultanées : la fenêtre est aussi
 * longue que le temps pendant lequel une fiche reste ouverte.
 *
 * Ce script ÉTABLIT la perte avant tout correctif, magasin par magasin, sur un vrai
 * serveur et une vraie base. Après correctif, chaque écriture périmée doit devenir un
 * refus explicite — jamais un écrasement.
 *
 * Usage :
 *   PORT=4194 DATABASE_URL=… node scripts/serve.js &
 *   E2E_BASE_URL=http://127.0.0.1:4194 node scripts/concurrence-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4194';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'conc-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!';
const RUN = Date.now().toString(36);

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

async function appel(chemin, { method = 'GET', cookie = '', body, attendu } = {}) {
  const reponse = await fetch(`${base}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (attendu !== undefined) {
    assert.equal(reponse.status, attendu, `${method} ${chemin} : attendu ${attendu}, reçu ${reponse.status} — ${texte.slice(0, 240)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie } = await appel('/api/auth/login', { method: 'POST', body: { username, password }, attendu: 200 });
  assert.ok(cookie, `aucune session rendue pour « ${username} »`);
  return cookie;
};

/** L'enregistrement tel que le serveur le rend — c'est ce qu'une session lit à l'écran. */
async function lire(cookie, store, id) {
  const { charge } = await appel('/api/sync', { cookie, attendu: 200 });
  return (charge?.data?.[store] || []).find(record => String(record.id) === String(id)) || null;
}

console.log(`\n╔═══ écritures concurrentes — ${base} ═══╗\n`);

const admin = await connexion(adminUsername, adminPassword);

/*
 * LE DÉCOR MINIMAL : une zone, une salle, une baie. Les magasins qui portent des
 * contraintes de connectivité sont éprouvés avec la charge la plus simple qu'ils acceptent.
 */
const zone = await appel('/api/access/zones', { method: 'POST', cookie: admin, body: { name: `Zone concurrence ${RUN}` }, attendu: 200 });
const ZONE = zone.charge?.zone?.id ?? zone.charge?.id;
assert.ok(ZONE, 'zone non créée');

const SALLE = `conc-salle-${RUN}`;
await appel(`/api/data/rooms/${SALLE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE, name: 'Salle concurrence', zoneId: ZONE }, attendu: 200
});
const BAIE = `conc-baie-${RUN}`;
await appel(`/api/data/baies/${BAIE}`, {
  method: 'PUT', cookie: admin, body: { id: BAIE, name: 'Baie concurrence', roomId: SALLE }, attendu: 200
});

/*
 * LES MAGASINS ÉPROUVÉS.
 *
 * `champB` est ce que la session B modifie ; `champA` ce que la session A modifie. Les
 * deux sont INDÉPENDANTS : aucune politique de fusion n'est nécessaire pour que les deux
 * changements coexistent — il suffit de ne pas écraser.
 *
 * `geometrie` marque les champs dont la perte est la plus coûteuse : une position sur le
 * plan ou un tracé se reconstruit à la main, parfois sur place.
 */
const MAGASINS = [
  {
    store: 'rooms', id: `conc-r-${RUN}`, geometrie: true,
    base: id => ({ id, name: 'Régie A', location: 'Bâtiment 1', coordinates: { x: 10, y: 20 }, zoneId: ZONE }),
    champB: record => ({ ...record, coordinates: { x: 99, y: 99 } }),
    champA: record => ({ ...record, location: 'Bâtiment 2' }),
    verifieB: record => record?.coordinates?.x === 99,
    verifieA: record => record?.location === 'Bâtiment 2'
  },
  {
    store: 'baies', id: `conc-b-${RUN}`,
    base: id => ({ id, name: 'Baie A', roomId: SALLE, reference: 'REF-1' }),
    champB: record => ({ ...record, reference: 'REF-MODIFIEE-PAR-B' }),
    champA: record => ({ ...record, name: 'Baie renommée par A' }),
    verifieB: record => record?.reference === 'REF-MODIFIEE-PAR-B',
    verifieA: record => record?.name === 'Baie renommée par A'
  },
  {
    store: 'equipments', id: `conc-e-${RUN}`,
    base: id => ({ id, name: `Équipement ${RUN}`, roomId: SALLE, baieId: BAIE, numSerie: `SN-${RUN}`, statut: 'En service' }),
    champB: record => ({ ...record, statut: 'En panne' }),
    champA: record => ({ ...record, numSerie: `SN-A-${RUN}` }),
    verifieB: record => record?.statut === 'En panne',
    verifieA: record => String(record?.numSerie) === `SN-A-${RUN}`
  },
  {
    store: 'walls', id: `conc-w-${RUN}`, geometrie: true,
    base: id => ({ id, name: 'Mur A', roomId: SALLE, columns: 3, rows: 2 }),
    champB: record => ({ ...record, columns: 8 }),
    champA: record => ({ ...record, name: 'Mur renommé par A' }),
    verifieB: record => Number(record?.columns) === 8,
    verifieA: record => record?.name === 'Mur renommé par A'
  },
  {
    store: 'notes', id: `conc-n-${RUN}`,
    base: id => ({ id, title: 'Note A', content: 'Contenu initial', roomId: SALLE }),
    champB: record => ({ ...record, content: 'Contenu écrit par B' }),
    champA: record => ({ ...record, title: 'Note renommée par A' }),
    verifieB: record => record?.content === 'Contenu écrit par B',
    verifieA: record => record?.title === 'Note renommée par A'
  },
  {
    store: 'docs', id: `conc-d-${RUN}`,
    base: id => ({ id, kind: 'knowledge_article', title: 'Article A', body: 'Corps initial', zoneIds: [ZONE], status: 'draft' }),
    champB: record => ({ ...record, body: 'Corps écrit par B' }),
    champA: record => ({ ...record, title: 'Article renommé par A' }),
    verifieB: record => record?.body === 'Corps écrit par B',
    verifieA: record => record?.title === 'Article renommé par A'
  }
];

/* ══════════════════════════════ 1 · la perte, magasin par magasin */
console.log('1 · écriture périmée contre modification récente');

const nonEprouves = [];
for (const cas of MAGASINS) {
  const creation = await appel(`/api/data/${cas.store}/${cas.id}`, {
    method: 'PUT', cookie: admin, body: cas.base(cas.id)
  });
  if (creation.statut !== 200) {
    nonEprouves.push(`${cas.store} (création ${creation.statut} ${creation.charge?.error || ''})`);
    continue;
  }

  // La session A lit — c'est la copie qu'elle garde à l'écran.
  const vuParA = await lire(admin, cas.store, cas.id);
  if (!vuParA) { nonEprouves.push(`${cas.store} (absent de l’instantané)`); continue; }

  // La session B modifie et enregistre.
  const ecritureB = await appel(`/api/data/${cas.store}/${cas.id}`, {
    method: 'PUT', cookie: admin, body: cas.champB(await lire(admin, cas.store, cas.id))
  });
  if (ecritureB.statut !== 200) { nonEprouves.push(`${cas.store} (écriture B ${ecritureB.statut})`); continue; }
  const apresB = await lire(admin, cas.store, cas.id);
  if (!cas.verifieB(apresB)) { nonEprouves.push(`${cas.store} (la modification de B n’a pas pris)`); continue; }

  // La session A enregistre SA copie périmée, avec sa propre modification.
  const ecritureA = await appel(`/api/data/${cas.store}/${cas.id}`, {
    method: 'PUT', cookie: admin, body: cas.champA(vuParA)
  });

  const apresA = await lire(admin, cas.store, cas.id);
  const marque = cas.geometrie ? ' [géométrie]' : '';
  verifier(
    `${cas.store}${marque} · la modification de B SURVIT à l’enregistrement périmé de A`,
    cas.verifieB(apresA),
    `statut A=${ecritureA.statut} ${ecritureA.charge?.error || ''} · état=${JSON.stringify(apresA).slice(0, 140)}`
  );
}

if (nonEprouves.length) console.log(`  ⚠️  non éprouvés : ${nonEprouves.join(' · ')}`);

/* ══════════════════════════════ 2 · supprimer pendant qu'un autre édite */
console.log('\n2 · suppression pendant qu’une fiche est ouverte');

const SALLE_SUPPRIMEE = `conc-suppr-${RUN}`;
await appel(`/api/data/rooms/${SALLE_SUPPRIMEE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_SUPPRIMEE, name: 'À supprimer', zoneId: ZONE }, attendu: 200
});
const vuAvantSuppression = await lire(admin, 'rooms', SALLE_SUPPRIMEE);
await appel(`/api/data/rooms/${SALLE_SUPPRIMEE}`, { method: 'DELETE', cookie: admin, attendu: 200 });

const ecritureApresSuppression = await appel(`/api/data/rooms/${SALLE_SUPPRIMEE}`, {
  method: 'PUT', cookie: admin, body: { ...vuAvantSuppression, name: 'Ressuscitée par A' }
});
verifier(
  `enregistrer une fiche SUPPRIMÉE par un autre est refusé (${ecritureApresSuppression.statut} ${ecritureApresSuppression.charge?.error || ''})`,
  ecritureApresSuppression.statut === 409,
  JSON.stringify(ecritureApresSuppression.charge).slice(0, 160)
);

/*
 * SUPPRIMER DEPUIS UNE FICHE OUVERTE, ELLE AUSSI PÉRIMÉE.
 *
 * Deux suppressions ne se valent pas, et l'API les distingue par un paramètre :
 *
 *   · sans `expectedRevision` — un administrateur supprime depuis une liste, sans avoir
 *     ouvert la fiche. La décision est délibérée et ne se compare à rien.
 *   · avec `expectedRevision` — la suppression part d'une fiche qu'on avait sous les yeux.
 *     Si un autre l'a modifiée entre-temps, supprimer effacerait son travail aussi sûrement
 *     qu'une écriture périmée : c'est refusé.
 *
 * Cette garde vit dans la couche HTTP. Aucun écran ne l'emprunte encore — `pushDelete`
 * n'envoie pas le paramètre — mais elle est publiée dans l'API, donc elle est vérifiée ici.
 */
const SALLE_SUPPR_PERIMEE = `conc-suppr-per-${RUN}`;
await appel(`/api/data/rooms/${SALLE_SUPPR_PERIMEE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_SUPPR_PERIMEE, name: 'Ouverte par A', zoneId: ZONE }, attendu: 200
});
const vueParLeSupprimeur = await lire(admin, 'rooms', SALLE_SUPPR_PERIMEE);
await appel(`/api/data/rooms/${SALLE_SUPPR_PERIMEE}`, {
  method: 'PUT', cookie: admin, body: { ...vueParLeSupprimeur, name: 'Modifiée par B' }, attendu: 200
});

const suppressionPerimee = await appel(
  `/api/data/rooms/${SALLE_SUPPR_PERIMEE}?expectedRevision=${vueParLeSupprimeur._revision}`,
  { method: 'DELETE', cookie: admin }
);
verifier(
  `supprimer depuis une fiche PÉRIMÉE est refusé (${suppressionPerimee.statut} ${suppressionPerimee.charge?.error || ''})`,
  suppressionPerimee.statut === 409 && suppressionPerimee.charge?.error === 'STALE_WRITE',
  JSON.stringify(suppressionPerimee.charge).slice(0, 160)
);
verifier('la fiche modifiée par B a survécu à la suppression périmée',
  (await lire(admin, 'rooms', SALLE_SUPPR_PERIMEE))?.name === 'Modifiée par B');

const suppressionDeliberee = await appel(`/api/data/rooms/${SALLE_SUPPR_PERIMEE}`, { method: 'DELETE', cookie: admin });
verifier(`une suppression délibérée, sans version déclarée, reste possible (${suppressionDeliberee.statut})`,
  suppressionDeliberee.statut === 200, JSON.stringify(suppressionDeliberee.charge).slice(0, 160));

/* ══════════════════════════════ 3 · le refus doit être exploitable */
console.log('\n3 · ce que le refus doit contenir');

const CIBLE = `conc-refus-${RUN}`;
await appel(`/api/data/rooms/${CIBLE}`, {
  method: 'PUT', cookie: admin, body: { id: CIBLE, name: 'Cible', zoneId: ZONE }, attendu: 200
});
const copiePerimee = await lire(admin, 'rooms', CIBLE);
await appel(`/api/data/rooms/${CIBLE}`, {
  method: 'PUT', cookie: admin, body: { ...(await lire(admin, 'rooms', CIBLE)), name: 'Modifiée par B' }, attendu: 200
});
const refus = await appel(`/api/data/rooms/${CIBLE}`, {
  method: 'PUT', cookie: admin, body: { ...copiePerimee, name: 'Modifiée par A' }
});

verifier(`une écriture périmée rend 409 (${refus.statut} ${refus.charge?.error || ''})`,
  refus.statut === 409 && refus.charge?.error === 'STALE_WRITE',
  JSON.stringify(refus.charge).slice(0, 200));
verifier('le refus est en français et dit quoi faire',
  /modifi/i.test(String(refus.charge?.message || '')) && /recharg/i.test(String(refus.charge?.message || '')),
  String(refus.charge?.message || '').slice(0, 200));
verifier('le refus donne la révision courante, pour que l’écran puisse se resituer',
  Number(refus.charge?.currentRevision) > 0, JSON.stringify(refus.charge?.currentRevision));

/* ══════════════════════════════ 4 · l'autorisation reste prioritaire */
console.log('\n4 · autorisation d’abord, version ensuite');

/*
 * Un utilisateur qui n'a pas le droit de voir une donnée ne doit RIEN apprendre d'elle —
 * pas même qu'elle a changé. Si la comparaison de version passait avant l'autorisation,
 * un 409 porteur de `currentRevision` dirait à un intrus qu'il a visé juste, et à quelle
 * fréquence la donnée bouge.
 */
const CHEF = { id: 980001, username: `conc-chef-${RUN}` };
const MOT_DE_PASSE_CHEF = 'Qz7-Vraie-Preuve-Bx9!';
const encode = valeur => Buffer.from(String(valeur), 'utf8').toString('base64');
await appel(`/api/data/users/${CHEF.id}`, {
  method: 'PUT', cookie: admin,
  body: { id: CHEF.id, username: CHEF.username, fullName: CHEF.username, role: 'chef', status: 'active', password: encode(MOT_DE_PASSE_CHEF) },
  attendu: 200
});

// Une zone étrangère, et une salle dedans : le chef n'y est ni membre ni habilité.
const zoneEtrangere = await appel('/api/access/zones', {
  method: 'POST', cookie: admin, body: { name: `Zone étrangère ${RUN}` }, attendu: 200
});
const ZONE_ETRANGERE = zoneEtrangere.charge?.zone?.id ?? zoneEtrangere.charge?.id;
const SALLE_ETRANGERE = `conc-etrangere-${RUN}`;
await appel(`/api/data/rooms/${SALLE_ETRANGERE}`, {
  method: 'PUT', cookie: admin, body: { id: SALLE_ETRANGERE, name: 'Hors périmètre', zoneId: ZONE_ETRANGERE }, attendu: 200
});
const salleEtrangere = await lire(admin, 'rooms', SALLE_ETRANGERE);
// L'administrateur la fait avancer d'une révision : la copie ci-dessus est maintenant périmée.
await appel(`/api/data/rooms/${SALLE_ETRANGERE}`, {
  method: 'PUT', cookie: admin, body: { ...(await lire(admin, 'rooms', SALLE_ETRANGERE)), name: 'Avancée' }, attendu: 200
});

const cookieChef = await connexion(CHEF.username, MOT_DE_PASSE_CHEF);
const intrusion = await appel(`/api/data/rooms/${SALLE_ETRANGERE}`, {
  method: 'PUT', cookie: cookieChef, body: { ...salleEtrangere, name: 'Tentative' }
});
verifier(`chef hors périmètre + version périmée : refus d’AUTORISATION (${intrusion.statut} ${intrusion.charge?.error || ''})`,
  intrusion.statut === 403, JSON.stringify(intrusion.charge).slice(0, 160));
verifier('le refus d’autorisation ne divulgue AUCUNE révision',
  intrusion.charge?.currentRevision === undefined, JSON.stringify(intrusion.charge).slice(0, 160));

/* ══════════════════════════════ 5 · deux rôles dans le MÊME périmètre */
console.log('\n5 · admin et chef sur la même salle');

await appel('/api/access/memberships', { method: 'POST', cookie: admin, body: { userId: CHEF.id, zoneId: ZONE }, attendu: 200 });
for (const permission of ['zone.summary.read', 'room.edit']) {
  await appel('/api/access/grants', { method: 'POST', cookie: admin, body: { userId: CHEF.id, zoneId: ZONE, permission }, attendu: 200 });
}
const cookieChefHabilite = await connexion(CHEF.username, MOT_DE_PASSE_CHEF);

const PARTAGEE = `conc-partagee-${RUN}`;
await appel(`/api/data/rooms/${PARTAGEE}`, {
  method: 'PUT', cookie: admin, body: { id: PARTAGEE, name: 'Partagée', location: 'Bât. 1', zoneId: ZONE }, attendu: 200
});
const vuParChef = await lire(cookieChefHabilite, 'rooms', PARTAGEE);
verifier('chef · la salle partagée porte bien une révision', Number(vuParChef?._revision) > 0,
  JSON.stringify(vuParChef?._revision));

// L'administrateur écrit le premier ; le chef enregistre ensuite SA copie.
await appel(`/api/data/rooms/${PARTAGEE}`, {
  method: 'PUT', cookie: admin, body: { ...(await lire(admin, 'rooms', PARTAGEE)), name: 'Renommée par l’admin' }, attendu: 200
});
const chefPerime = await appel(`/api/data/rooms/${PARTAGEE}`, {
  method: 'PUT', cookie: cookieChefHabilite, body: { ...vuParChef, location: 'Bât. 2' }
});
verifier(`chef · sa copie périmée est refusée, pas appliquée (${chefPerime.statut} ${chefPerime.charge?.error || ''})`,
  chefPerime.statut === 409 && chefPerime.charge?.error === 'STALE_WRITE',
  JSON.stringify(chefPerime.charge).slice(0, 160));
verifier('la modification de l’administrateur a survécu',
  (await lire(admin, 'rooms', PARTAGEE))?.name === 'Renommée par l’admin');

// Rechargé, le chef réenregistre — et cela doit passer.
const rechargee = await lire(cookieChefHabilite, 'rooms', PARTAGEE);
const apresRechargement = await appel(`/api/data/rooms/${PARTAGEE}`, {
  method: 'PUT', cookie: cookieChefHabilite, body: { ...rechargee, location: 'Bât. 2' }
});
verifier(`chef · après rechargement, son enregistrement passe (${apresRechargement.statut})`,
  apresRechargement.statut === 200, JSON.stringify(apresRechargement.charge).slice(0, 160));
const final = await lire(admin, 'rooms', PARTAGEE);
verifier('les deux modifications coexistent après rechargement',
  final?.name === 'Renommée par l’admin' && final?.location === 'Bât. 2',
  JSON.stringify(final).slice(0, 160));

/* ══════════════════════════════ 6 · les écritures de masse restent possibles */
console.log('\n6 · import délibéré et sauvegarde');

const transfert = await appel('/api/rooms/transfer', { cookie: admin, attendu: 200 });
const salleTransfert = (transfert.charge?.rooms || []).find(salle => String(salle.id) === PARTAGEE);
const paireTransfert = (transfert.charge?.roomZones || []).find(paire => String(paire.roomId) === PARTAGEE);
const reimport = await appel('/api/rooms/transfer', {
  method: 'POST', cookie: admin,
  body: { formatVersion: transfert.charge.formatVersion, rooms: [{ ...salleTransfert, name: 'Restaurée' }], roomZones: [paireTransfert] }
});
verifier(`un import délibéré n’est pas bloqué par les révisions (${reimport.statut})`,
  reimport.statut === 200, JSON.stringify(reimport.charge).slice(0, 160));
const apresImport = await lire(admin, 'rooms', PARTAGEE);
verifier('l’import fait AVANCER la révision, pour dépasser les sessions ouvertes',
  Number(apresImport?._revision) > Number(final?._revision),
  `avant=${final?._revision} après=${apresImport?._revision}`);
const sessionOuverteAvantImport = await appel(`/api/data/rooms/${PARTAGEE}`, {
  method: 'PUT', cookie: admin, body: { ...final, name: 'Depuis une session ouverte avant l’import' }
});
verifier(`une session ouverte avant l’import est refusée (${sessionOuverteAvantImport.statut})`,
  sessionOuverteAvantImport.statut === 409, JSON.stringify(sessionOuverteAvantImport.charge).slice(0, 160));

/* ══════════════════════════════ 7 · deux créations au même instant */
console.log('\n7 · créations concurrentes du MÊME identifiant');

/*
 * CE QUE `SELECT … FOR UPDATE` NE PROTÈGE PAS.
 *
 * Il verrouille UNE LIGNE. Une ligne qui n'existe pas encore ne verrouille donc rien, et
 * c'est précisément l'état d'une création :
 *
 *     A · SELECT FOR UPDATE → aucune ligne, aucun verrou
 *     B · SELECT FOR UPDATE → aucune ligne, aucun verrou
 *     A · révision = 1                        B · révision = 1
 *     A · INSERT … ON CONFLICT DO UPDATE      B · INSERT … ON CONFLICT DO UPDATE
 *
 * Les deux se croient premières et la seconde écrase la première — en silence, alors que
 * deux personnes viennent de créer la même fiche au même instant.
 *
 * Aucun double de connexion ne peut établir cela : celui de ce dépôt verrouillait les
 * lignes inexistantes, ce que PostgreSQL ne fait pas, et masquait donc le défaut qu'il
 * prétendait éprouver. Seule une vraie base peut trancher.
 */

/** Lance N créations RIGOUREUSEMENT simultanées du même identifiant. */
async function creationsSimultanees(store, id, nombre, corps) {
  return Promise.all(Array.from({ length: nombre }, (_, index) => appel(`/api/data/${store}/${id}`, {
    method: 'PUT', cookie: admin, body: corps(index)
  })));
}

for (const [store, nombre, corps] of [
  ['rooms', 2, index => ({ id: `conc-course-r-${RUN}`, name: `Écrivain ${index}`, zoneId: ZONE })],
  ['equipments', 3, index => ({
    id: `conc-course-e-${RUN}`, name: `Écrivain ${index}`, roomId: SALLE, baieId: BAIE,
    numSerie: `SN-COURSE-${index}`, statut: 'En service'
  })]
]) {
  const id = corps(0).id;
  const resultats = await creationsSimultanees(store, id, nombre, corps);
  const acceptes = resultats.filter(resultat => resultat.statut === 200);
  const refuses = resultats.filter(resultat => resultat.statut === 409);

  verifier(`${store} · ${nombre} créations simultanées : UNE SEULE passe`,
    acceptes.length === 1,
    `acceptées ${acceptes.length}, refusées ${refuses.length}, statuts ${resultats.map(r => r.statut).join('/')}`);
  verifier(`${store} · les autres reçoivent ALREADY_EXISTS, pas un écrasement silencieux`,
    refuses.length === nombre - 1 && refuses.every(resultat => resultat.charge?.error === 'ALREADY_EXISTS'),
    JSON.stringify(refuses.map(resultat => resultat.charge?.error)));

  const stocke = await lire(admin, store, id);
  verifier(`${store} · la fiche existe une seule fois, à la révision 1`,
    Number(stocke?._revision) === 1, JSON.stringify(stocke?._revision));

  // La fiche stockée doit appartenir à l'écrivain accepté, jamais à un mélange des deux.
  const nomsProposes = Array.from({ length: nombre }, (_, index) => corps(index).name);
  verifier(`${store} · le contenu appartient à UN seul écrivain, sans fusion`,
    nomsProposes.includes(stocke?.name), JSON.stringify(stocke?.name));
}

/*
 * L'INTENTION SE LIT DANS LA DÉCLARATION — épreuve DÉTERMINISTE.
 *
 * Une course n'arrive pas à tous les coups ; elle ne peut donc pas, à elle seule, garder
 * une règle. Ici on reproduit son EFFET sans course : une fiche existe déjà, et quelqu'un
 * envoie une charge qui ne déclare aucune révision — c'est-à-dire qui affirme créer.
 *
 * Le serveur déduisait l'intention d'une lecture faite AVANT le verrou. Sous une vraie
 * course, le troisième écrivain lisait la fiche que le premier venait de créer et recevait
 * `STALE_WRITE` alors qu'il créait. La déclaration, elle, ne dépend d'aucun ordre d'arrivée.
 */
const DEJA = `conc-deja-${RUN}`;
await appel(`/api/data/equipments/${DEJA}`, {
  method: 'PUT', cookie: admin,
  body: { id: DEJA, name: 'Premier', roomId: SALLE, baieId: BAIE, numSerie: `SN-DEJA-${RUN}`, statut: 'En service' },
  attendu: 200
});
const creerParDessus = await appel(`/api/data/equipments/${DEJA}`, {
  method: 'PUT', cookie: admin,
  body: { id: DEJA, name: 'Second', roomId: SALLE, baieId: BAIE, numSerie: `SN-DEJA2-${RUN}`, statut: 'En service' }
});
verifier(`créer par-dessus une fiche existante rend ALREADY_EXISTS (${creerParDessus.statut} ${creerParDessus.charge?.error || ''})`,
  creerParDessus.statut === 409 && creerParDessus.charge?.error === 'ALREADY_EXISTS',
  JSON.stringify(creerParDessus.charge).slice(0, 200));
verifier('et la fiche du premier écrivain est intacte',
  (await lire(admin, 'equipments', DEJA))?.name === 'Premier');

console.log(`\n╚═══ ${echecs === 0 ? '✅ AUCUN ÉCHEC' : '❌ ' + echecs + ' ÉCHEC(S)'} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
