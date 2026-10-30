/**
 * @file tests/catalog-buffer-delivery-98.test.js — #98 : un enrichissement RETENU doit être
 *       LIVRÉ, et « le serveur connaît cet identifiant » n'est pas une livraison.
 *
 * CE QUE CETTE PORTE GARDE
 * ------------------------
 * `catalog-seed-guard` DÉTOURNE les écritures de catalogue pendant la fenêtre d'amorçage :
 * au lieu de partir par la voie ordinaire, la fiche est écrite localement et retenue dans
 * un tampon, en attendant l'installation centrale. C'est délibéré — sans cela l'instantané
 * suivant effaçait des fiches que le serveur ne connaissait pas encore.
 *
 * Mais l'installation centrale est une MIGRATION VERSIONNÉE, et elle commençait par :
 *
 *     if (installedVersion >= CENTRAL_CATALOG_VERSION) return { reason:'already-current' };
 *     const records = [...bufferedDocs.values()];          ← jamais atteint
 *
 * Sur un serveur déjà à jour — c'est-à-dire à chaque rechargement ordinaire — le tampon
 * n'était donc jamais lu. Et `central-sync` relâche la retenue dès que l'instantané porte
 * le MÊME IDENTIFIANT, sans regarder si le CONTENU retenu a été acquitté. Une modification
 * légitime détournée là disparaissait : jamais centralisée, puis écrasée en local.
 *
 * Mesuré sur un serveur en version 24, un enrichissement écrit à t = 161 ms :
 *
 *     tampon OUI · install « already-current » · 0 mutation HTTP
 *     serveur jamais reçu · instantané suivant absent · local écrasé
 *
 * DEUX PROMESSES, DONC, ET ELLES SE TIENNENT ENSEMBLE
 * ----------------------------------------------------
 *   1. rien à livrer  → aucune écriture, aucune requête : le repos reste le repos ;
 *   2. quelque chose à livrer → exactement une livraison, par la voie ORDINAIRE, celle
 *      qui porte la révision et laisse le serveur arbitrer.
 *
 * Et le rôle ne bouge pas : seul un administrateur global livre, comme avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ─────────────────────── Un navigateur minimal, et une base à nous ─────────────────────── */

const minuteries = [];
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => { const jeton = vraiSetTimeout(...arguments_); minuteries.push(jeton); return jeton; };
test.after(() => { for (const jeton of minuteries) clearTimeout(jeton); });

const rien = () => {};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = { addEventListener: rien, removeEventListener: rien, dispatchEvent: () => true };
globalThis.document = { addEventListener: rien, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

let identite = { id: 1, role: 'admin' };
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify(identite) : null),
  setItem: rien, removeItem: rien
};

let requetes = [];
/** Ce que le serveur répondra à `catalog-install`. Chaque décor le pose explicitement. */
let reponseInstallation = null;
/*
 * UN VERROU SUR LE RÉSEAU — sans quoi la course ne peut pas être JOUÉE.
 *
 * Les courses de cette famille se produisent PENDANT l'attente réseau. Une épreuve qui
 * attend la fin de l'envoi avant d'agir ne les reproduit pas : elle observe l'après, pas
 * le pendant. On se donne donc de quoi RETENIR la réponse et agir au milieu.
 */
let retenirInstallation = null;
const differerInstallation = () => {
  let liberer;
  retenirInstallation = new Promise(resoudre => { liberer = resoudre; });
  return liberer;
};
globalThis.fetch = async (url, options = {}) => {
  const adresse = String(url);
  requetes.push({ url: adresse, methode: String(options.method || 'GET').toUpperCase(), corps: options.body });
  if (adresse.includes('/api/sync/catalog-install') && reponseInstallation) {
    if (retenirInstallation) await retenirInstallation;
    const charge = JSON.stringify(reponseInstallation);
    return { ok: true, status: 200, async text() { return charge; }, async json() { return reponseInstallation; } };
  }
  return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
};

const { db } = await import('../db.js');

const donnees = new Map();
/** Les écritures qui SORTENT vers le serveur, et celles qui restent locales : on distingue. */
let poussees = [];
let locales = [];

db.open = async () => ({});
db.normalizeKey = valeur => String(valeur);
db.isCentralSyncReady = () => true;
db.get = async (store, id) => {
  const trouve = donnees.get(`${store}|${id}`);
  return trouve ? JSON.parse(JSON.stringify(trouve)) : undefined;
};
db._getRaw = db.get;
db.getAll = async store => [...donnees.entries()].filter(([cle]) => cle.startsWith(`${store}|`)).map(([, v]) => JSON.parse(JSON.stringify(v)));
// `db.save` TIENT LIEU de la voie ordinaire : c'est elle qui pousserait vers le serveur.
let retenirPoussee = null;
const differerPoussee = () => {
  let liberer;
  retenirPoussee = new Promise(resoudre => { liberer = resoudre; });
  return liberer;
};
db.save = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${donnees.size}`);
  poussees.push({ store, id, enregistrement: JSON.parse(JSON.stringify(enregistrement)) });
  if (retenirPoussee) await retenirPoussee;
  donnees.set(`${store}|${id}`, JSON.parse(JSON.stringify({ ...enregistrement, id })));
  return id;
};
// `saveLocalOnly` ne sort JAMAIS : c'est par elle que le tampon écrit.
db.saveLocalOnly = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${donnees.size}`);
  locales.push({ store, id });
  donnees.set(`${store}|${id}`, JSON.parse(JSON.stringify({ ...enregistrement, id })));
  return id;
};
db.delete = async (store, id) => donnees.delete(`${store}|${id}`);
db._deleteRaw = db.delete;

/*
 * Le garde s'importe APRÈS la base : il capture `db.save` au chargement, et c'est
 * précisément cette capture — `previousSave` — qui est la voie ordinaire.
 */
const garde = await import('../catalog-seed-guard.js');
const contrat = await import('../record-ownership-contract.js');

const FICHE = Object.freeze({
  id: 'kb-sonde-livraison', kind: 'equipment_catalog', targetType: 'equipment_catalog',
  manufacturer: 'Sonde', model: 'Livraison', origin: 'seed-extra'
});

function decor({ versionServeur, role = 'admin', installation = null } = {}) {
  donnees.clear();
  poussees = [];
  locales = [];
  requetes = [];
  reponseInstallation = installation;
  retenirInstallation = null;
  retenirPoussee = null;
  identite = { id: 1, role };
  contrat.resetCatalogBuffer();
  donnees.set('settings|global', { id: 'global', language: 'fr', catalogSeedVersion: versionServeur });
  donnees.set(`docs|${FICHE.id}`, { ...FICHE });
}

/** Écrire par le chemin public : c'est le garde qui décide de retenir ou non. */
const ecrireParLeCheminPublic = enregistrement => db.save('docs', enregistrement);

/* ══════════════════ 1 · RIEN À LIVRER — LE REPOS RESTE LE REPOS ══════════════════ */

test('serveur à jour et tampon vide : aucune requête, aucune écriture', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION });
  const resultat = await garde.installCentralCatalogOnce();
  assert.equal(resultat.reason, 'already-current');
  assert.equal(resultat.delivered, undefined, 'rien ne doit être livré quand rien n’est retenu');
  assert.deepEqual(poussees, [], 'aucune écriture ne doit sortir');
  assert.deepEqual(requetes.filter(r => r.methode !== 'GET'), [], 'aucune requête d’installation');
});

/* ══════════════ 2 · QUELQUE CHOSE À LIVRER — EXACTEMENT UNE LIVRAISON ══════════════ */

test('serveur à jour et enrichissement RETENU : il est livré par la voie ordinaire, une seule fois', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION });

  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'valeur-tardive' });
  assert.equal(locales.length, 1, 'le garde doit avoir RETENU l’écriture (locale, hors réseau)');
  assert.deepEqual(poussees, [], 'et elle ne doit pas encore être sortie');
  assert.equal(contrat.recordOwnership('docs', FICHE.id), 'catalog-buffered',
    'la fiche doit être déclarée retenue');

  const resultat = await garde.installCentralCatalogOnce();
  assert.equal(resultat.reason, 'already-current');
  assert.deepEqual(resultat.delivered, [FICHE.id], 'la fiche retenue doit être livrée');
  assert.equal(poussees.length, 1, 'exactement une écriture doit sortir par la voie ordinaire');
  assert.equal(poussees[0].enregistrement.sondeEnrichissement, 'valeur-tardive',
    'et c’est bien le CONTENU enrichi qui part, pas une coquille');

  // Deuxième tentative : le tampon est vidé de ce qui a été livré, donc plus rien ne sort.
  const seconde = await garde.installCentralCatalogOnce();
  assert.equal(seconde.delivered, undefined, 'aucune seconde livraison');
  assert.equal(poussees.length, 1, 'la livraison ne doit pas se répéter');
});

/* ═══════════ 3 · « LE SERVEUR CONNAÎT CET ID » N'EST PAS UNE LIVRAISON ═══════════ */

/**
 * LA RETENUE SE RELÂCHE SUR L'IDENTIFIANT ; LA LIVRAISON SE JUGE SUR LE CONTENU.
 *
 * `central-sync` appelle `releaseCatalogBuffered(record.id)` dès que l'instantané porte la
 * fiche — ce qui est juste pour la PROTECTION : le centre connaît l'identifiant, il peut
 * donc en reprendre l'autorité. Mais cela ne dit RIEN du contenu retenu, et c'est ce
 * malentendu qui faisait disparaître les enrichissements : protection levée, contenu jamais
 * parti.
 *
 * Cette épreuve fixe la distinction : relâcher la retenue ne doit jamais valoir livraison.
 */
test('relâcher la retenue sur simple présence de l’identifiant ne vaut PAS livraison', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION });

  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'valeur-tardive' });
  assert.equal(contrat.recordOwnership('docs', FICHE.id), 'catalog-buffered');

  // Le centre annonce la MÊME fiche, mais dans son ancienne version — sans l'enrichissement.
  const relachee = contrat.releaseCatalogBuffered(FICHE.id);
  assert.equal(relachee, true, 'la protection se lève bien sur présence de l’identifiant');
  assert.equal(contrat.recordOwnership('docs', FICHE.id), 'server');

  // Or rien n'a été livré : c'est exactement l'état dans lequel l'enrichissement se perdait.
  assert.deepEqual(poussees, [], 'la levée de protection n’a rien envoyé — elle ne le doit pas');

  // La livraison, elle, reste due : le tampon la porte encore et l'installation la sort.
  const resultat = await garde.installCentralCatalogOnce();
  assert.deepEqual(resultat.delivered, [FICHE.id],
    'un contenu retenu doit rester dû même après la levée de la protection');
  assert.equal(poussees.length, 1);
  assert.equal(poussees[0].enregistrement.sondeEnrichissement, 'valeur-tardive');
});

/* ════════════════ 4 · LE RÔLE NE BOUGE PAS — SEUL L'ADMIN LIVRE ════════════════ */

/**
 * Une épreuve de Phase 24 interdisait, PAR SON TEXTE, toute boucle poussant des seeds par
 * `previousSave`. La règle qu'elle protège est réelle : « responsable / technicien /
 * visiteur ne poussent jamais les seeds comme du CRUD utilisateur ». Elle est ici ÉPROUVÉE
 * plutôt qu'épinglée — un texte interdit se contourne en renommant une variable, une
 * décision exécutée ne se contourne pas.
 */
for (const role of ['responsible', 'responsable', 'technician', 'technicien', 'visitor', 'visiteur', 'chef']) {
  test(`« ${role} » ne livre JAMAIS un seed retenu`, async () => {
    decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION, role });

    await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'valeur-tardive' });
    const resultat = await garde.installCentralCatalogOnce();

    assert.equal(resultat.reason, 'not-global-admin', `${role} ne doit pas atteindre l’installation`);
    assert.equal(resultat.delivered, undefined, `${role} ne doit livrer aucune fiche`);
    assert.deepEqual(poussees, [], `${role} ne doit pousser aucun seed par la voie ordinaire`);
    assert.deepEqual(requetes.filter(r => r.methode !== 'GET'), [], `${role} ne doit émettre aucune requête d’écriture`);
  });
}

test('l’administrateur global, lui, livre bien — sinon le refus ci-dessus ne prouverait rien', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION, role: 'admin' });
  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'valeur-tardive' });
  const resultat = await garde.installCentralCatalogOnce();
  assert.deepEqual(resultat.delivered, [FICHE.id]);
  assert.equal(poussees.length, 1);
});

/* ════════════════ 5 · LA MIGRATION VERSIONNÉE RESTE CE QU'ELLE EST ════════════════ */

/**
 * LA DETTE DU TAMPON — CE QUI EST CENTRALISÉ DOIT LE QUITTER.
 *
 * Le tampon n'était vidé nulle part. Tant que la migration était son SEUL chemin de sortie
 * cela ne se voyait pas : une seconde tentative se faisait refuser poliment
 * (`already-current`) et personne n'y pensait. Dès que le tampon a gagné un second chemin —
 * la voie ordinaire, pour les enrichissements tardifs — la dette est devenue coûteuse : au
 * battement suivant, TOUTES les fiches déjà installées repartaient une à une, chacune avec
 * la révision d'avant l'installation.
 *
 * Mesuré : 511 conflits 409 automatiques au premier login. Cette épreuve tient la règle qui
 * l'empêche.
 */
test('après une installation ACCEPTÉE, le tampon ne renvoie plus rien', async () => {
  decor({
    versionServeur: garde.CENTRAL_CATALOG_VERSION - 1,
    installation: { ok: true, installed: true, version: garde.CENTRAL_CATALOG_VERSION, written: 1 }
  });

  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'installée-par-migration' });
  assert.equal(locales.length, 1, 'la fiche doit d’abord être retenue');

  const migration = await garde.installCentralCatalogOnce();
  assert.equal(migration.installed, true, 'la migration doit avoir été acceptée');
  assert.deepEqual(poussees.filter(p => p.store === 'docs'), [],
    'la migration ne pousse pas fiche par fiche');

  // Le serveur est désormais à jour : c'est la voie ordinaire qui serait empruntée.
  donnees.set('settings|global', { id: 'global', language: 'fr', catalogSeedVersion: garde.CENTRAL_CATALOG_VERSION });
  const suivante = await garde.installCentralCatalogOnce();

  assert.equal(suivante.reason, 'already-current');
  assert.equal(suivante.delivered, undefined,
    'une fiche déjà centralisée par la migration ne doit PAS être renvoyée par la voie ordinaire');
  assert.deepEqual(poussees.filter(p => p.store === 'docs'), [],
    'aucune réémission : c’est ainsi que naissaient 511 conflits 409 automatiques');
});

/**
 * LA COURSE QUE L'ÉPREUVE PRÉCÉDENTE NE JOUAIT PAS.
 *
 * Le nettoyage après installation retire du tampon par IDENTIFIANT :
 *
 *     const records = [...bufferedDocs.values()];
 *     await fetch(…);
 *     if (payload?.installed) for (const record of records) bufferedDocs.delete(record.id);
 *
 * Or pendant cette attente réseau, un producteur légitime peut écrire une version PLUS
 * RÉCENTE de la MÊME fiche. `saveSeedLocally` remplace alors l'entrée du tampon par un
 * objet neuf — mais le nettoyage, lui, ne connaît que l'identifiant : il efface la version
 * neuve, qui n'a jamais été envoyée ni acquittée. Une modification légitime disparaît en
 * silence, ce qui est plus grave qu'une requête de trop.
 *
 * L'épreuve voisine attendait la FIN de l'installation avant d'écrire, et sur un AUTRE
 * identifiant : elle prouvait « une fiche créée après l'installation », jamais « la même
 * fiche modifiée pendant l'envoi ». Elle était verte sans couvrir ce qu'elle annonçait.
 */
test('MÊME identifiant modifié pendant l’envoi : la version récente n’est pas effacée', async () => {
  decor({
    versionServeur: garde.CENTRAL_CATALOG_VERSION - 1,
    installation: { ok: true, installed: true, version: garde.CENTRAL_CATALOG_VERSION, written: 1 }
  });

  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'A' });

  const liberer = differerInstallation();
  const vol = garde.installCentralCatalogOnce();

  // On attend que le POST soit réellement parti, porteur de A.
  for (let essai = 0; essai < 100 && !requetes.some(r => r.url.includes('catalog-install')); essai += 1) {
    await new Promise(resoudre => setTimeout(resoudre, 5));
  }
  const envoi = requetes.find(r => r.url.includes('catalog-install'));
  assert.ok(envoi, 'le POST d’installation doit être parti');
  assert.match(String(envoi.corps), /"sondeEnrichissement":"A"/, 'et porter la version A');

  // PENDANT le vol, un producteur écrit B pour le MÊME identifiant.
  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'B' });

  liberer();
  const resultat = await vol;
  assert.equal(resultat.installed, true, 'A doit bien avoir été installée');

  // B n'a jamais été envoyée : elle reste due. Le serveur est maintenant à jour, donc
  // c'est la voie ordinaire qui doit la livrer au tour suivant.
  donnees.set('settings|global', { id: 'global', language: 'fr', catalogSeedVersion: garde.CENTRAL_CATALOG_VERSION });
  const suivante = await garde.installCentralCatalogOnce();

  assert.deepEqual(suivante.delivered, [FICHE.id],
    'la version écrite pendant l’envoi a été effacée du tampon : elle est PERDUE');
  const livree = poussees.find(p => p.id === FICHE.id);
  assert.ok(livree, 'B doit sortir par la voie ordinaire');
  assert.equal(livree.enregistrement.sondeEnrichissement, 'B',
    'et c’est bien B — la version récente — qui part, pas A');
});

test('MÊME identifiant modifié pendant une livraison ORDINAIRE : la version récente survit aussi', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION });

  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'A' });

  const liberer = differerPoussee();
  const vol = garde.installCentralCatalogOnce();

  for (let essai = 0; essai < 100 && !poussees.some(p => p.id === FICHE.id); essai += 1) {
    await new Promise(resoudre => setTimeout(resoudre, 5));
  }
  assert.equal(poussees[0]?.enregistrement.sondeEnrichissement, 'A', 'la livraison part avec A');

  // PENDANT l'attente réseau de la livraison, B est écrite pour le MÊME identifiant.
  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'B' });

  liberer();
  retenirPoussee = null;
  await vol;

  const suivante = await garde.installCentralCatalogOnce();
  assert.deepEqual(suivante.delivered, [FICHE.id],
    'B a été effacée du tampon par la livraison de A : elle est PERDUE');
  const derniere = poussees.filter(p => p.id === FICHE.id).pop();
  assert.equal(derniere.enregistrement.sondeEnrichissement, 'B', 'c’est B qui doit finir par partir');
});

test('une fiche retenue PENDANT l’envoi appartient au tour suivant, pas à celui-ci', async () => {
  decor({
    versionServeur: garde.CENTRAL_CATALOG_VERSION - 1,
    installation: { ok: true, installed: true, version: garde.CENTRAL_CATALOG_VERSION, written: 1 }
  });
  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'premier-tour' });
  await garde.installCentralCatalogOnce();

  // Le serveur est à jour ; une NOUVELLE fiche est retenue après coup.
  donnees.set('settings|global', { id: 'global', language: 'fr', catalogSeedVersion: garde.CENTRAL_CATALOG_VERSION });
  const AUTRE = { ...FICHE, id: 'kb-sonde-second-tour' };
  donnees.set(`docs|${AUTRE.id}`, { ...AUTRE });
  await ecrireParLeCheminPublic({ ...AUTRE, sondeEnrichissement: 'second-tour' });

  const suivante = await garde.installCentralCatalogOnce();
  assert.deepEqual(suivante.delivered, [AUTRE.id],
    'la fiche retenue après l’installation doit, elle, être livrée');
  assert.equal(poussees.filter(p => p.id === FICHE.id).length, 0,
    'et la fiche déjà centralisée ne doit pas repartir avec elle');
});

test('serveur EN RETARD : c’est la migration versionnée qui part, pas la voie ordinaire', async () => {
  decor({ versionServeur: garde.CENTRAL_CATALOG_VERSION - 1 });
  await ecrireParLeCheminPublic({ ...FICHE, sondeEnrichissement: 'valeur-tardive' });

  await garde.installCentralCatalogOnce();
  const installations = requetes.filter(r => r.url.includes('/api/sync/catalog-install'));
  assert.equal(installations.length, 1, 'la migration centrale doit être tentée quand la version est en retard');
  assert.deepEqual(poussees, [],
    'et elle ne doit PAS se transformer en écritures ordinaires fiche par fiche');
});
