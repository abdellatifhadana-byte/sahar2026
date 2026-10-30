/**
 * @file tests/grille-fiche-360-nowrite.test.js — #166 §8, la porte #165 sur la VRAIE Grille.
 *
 * CE QUE CETTE ÉPREUVE AJOUTE
 * ----------------------------
 * #165 a établi que consulter n'est pas ensemencer, et l'a prouvé sur la Régie Car. La
 * Grille Centrale, elle, ne pouvait pas être mesurée : sans équipement canonique, le jeu de
 * données protégé se refusait à tout le monde et les quatre panneaux ne s'exécutaient jamais.
 * #166 lève ce blocage — et rend donc mesurable ce qui ne l'était pas.
 *
 * Les mesures navigateur du lot restent la preuve de bout en bout. Elles ne tournent pas en
 * intégration : ni `Vérification 2M TECH` ni `Phase 24` n'exécutent la fiche 360. Ce fichier
 * porte donc le contrat DURABLEMENT, en appelant les VRAIS points d'entrée des quatre
 * panneaux sur un DOM, un `fetch` et un `db` contrôlés — pas des assertions de texte.
 *
 * Aucune dépendance de développement : les deux chaînes installent `--omit=dev`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Un navigateur minimal, installé AVANT les imports ---------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  removeEventListener() {},
  dispatchEvent(evenement) {
    for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement);
    return true;
  }
};
const element = () => ({
  id: '', className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, hidden: false, enfants: [],
  classList: { add() {}, remove() {}, contains: () => false },
  appendChild(noeud) { this.enfants.push(noeud); return noeud; },
  insertBefore(noeud) { this.enfants.push(noeud); return noeud; },
  remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null
});
globalThis.document = {
  createElement: () => element(), body: element(), head: element(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, documentElement: element()
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };

/*
 * UNE SESSION, SINON LA PASSERELLE NE DEMANDE MÊME PAS.
 *
 * `grille-centrale-dataset.js` calcule une PORTÉE à partir de `localStorage.auth` et de
 * l'empreinte d'accès. Sans identité elle rend `null` — c'est la garantie qu'un profil
 * jamais authentifié n'interroge pas l'endpoint protégé. Il faut donc une session pour
 * atteindre le chemin que ce fichier mesure.
 */
let identite = { id: 'u-technicien', username: 'technicien', role: 'technicien', authVersion: 1 };
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' && identite ? JSON.stringify(identite) : null),
  setItem() {}, removeItem() {}, clear() {}
};
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

/*
 * LES MINUTERIES DE RÉCONCILIATION SONT DÉSARMÉES PENDANT LA MESURE.
 *
 * Ces modules s'ensemencent aussi sur une minuterie posée au chargement
 * (`scheduleReconcile`), chemin `persister:true`. Ce n'est PAS une consultation, et c'est
 * même le contraire de ce que ce fichier mesure. Pire, elle est invisible à une simple
 * attente de silence : quand elle se déclenche sur une base déjà convergée, elle n'écrit
 * rien — puis elle se réarme et écrit dès que la base change.
 *
 * On garde donc la trace des minuteries en vol pour pouvoir les annuler juste avant la
 * fenêtre de mesure. Ce qui reste est alors imputable à la consultation, et à elle seule.
 * L'épreuve discriminante d'à côté vérifie que le chemin d'ensemencement, lui, écrit bien.
 */
const vraiSetTimeout = globalThis.setTimeout;
const minuteries = new Set();
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  minuteries.add(minuterie);
  return minuterie;
};
const desarmerMinuteries = () => {
  for (const minuterie of minuteries) clearTimeout(minuterie);
  minuteries.clear();
};

/* ---------------- Le magasin, et TOUTES les écritures tentées ---------------- */

const tables = new Map();
const table = nom => { if (!tables.has(nom)) tables.set(nom, new Map()); return tables.get(nom); };
/** Chaque écriture métier tentée, quelle qu'en soit l'issue. */
const ecritures = [];

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
// La bascule centrale est tranchée : ce fichier mesure la CONSULTATION, pas le démarrage.
db.isCentralSyncReady = () => true;
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  ecritures.push({ store: nom, id: String(enregistrement?.id ?? '') });
  const id = enregistrement?.id ?? `auto-${table(nom).size + 1}`;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;
db.normalizeKey = value => String(value);

/* ---------------- L'endpoint protégé, et lui seul ---------------- */

const { buildGrilleCentraleDataset, buildGrilleCentraleOperationalSeed, GRILLE_CENTRALE_ROUTER_ID, GRILLE_CENTRALE_CATALOG_ID } =
  await import('../scripts/private-operational-data/grille-centrale.js');

const jeuDeDonnees = buildGrilleCentraleDataset();
let autorise = true;
/** Combien de fois l'endpoint protégé a réellement répondu. */
let appelsEndpoint = 0;
/**
 * CHAQUE REQUÊTE, AVEC SA MÉTHODE.
 *
 * Compter les écritures `db.save` ne dit rien d'un panneau qui appellerait `fetch` en POST
 * directement. La méthode est donc retenue : une mutation HTTP future ferait échouer
 * l'épreuve, là où un simple compteur d'appels ne l'aurait pas vue.
 */
const requetes = [];
globalThis.fetch = async (chemin, options = {}) => {
  const methode = String(options?.method || 'GET').toUpperCase();
  requetes.push({ methode, chemin: String(chemin) });
  if (!String(chemin).includes('/api/operational/grille-centrale/documented-map')) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  appelsEndpoint += 1;
  return autorise
    ? { ok: true, status: 200, json: async () => ({ dataset: jeuDeDonnees }) }
    : { ok: false, status: 403, json: async () => ({ error: 'GRILLE_SCOPE_FORBIDDEN' }) };
};
const mutationsHttp = () => requetes.filter(r => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.methode));
/** L'état RÉEL du magasin de file, lu comme n'importe quel autre magasin. */
const tailleFile = async () => (await db.getAll('syncQueue')).length;

/* ---------------- Les VRAIS points d'entrée des quatre panneaux ---------------- */

const passerelle = await import('../grille-centrale-dataset.js');
const { ensureGrilleCentraleTopology, enhanceGrilleCentrale360 } = await import('../grille-centrale-topology.js');
const { ensureGrilleCentralePhysicalArchitecture, enhanceGrilleCentralePhysical360 } = await import('../grille-centrale-physical-architecture.js');
const { ensureGrilleCentraleDocumentedMap, enhanceGrilleCentraleDocumentedMap360 } = await import('../grille-centrale-documented-map.js');
const { ensureGrilleCentraleFieldVerification, enhanceGrilleCentraleFieldVerification360 } = await import('../grille-centrale-field-verification.js');
const { ensureGrilleCentraleOperationalRecords } = await import('../scripts/grille-centrale-operational-bootstrap.js');

const PANNEAUX = [
  ['Topologie', ensureGrilleCentraleTopology],
  ['Architecture physique', ensureGrilleCentralePhysicalArchitecture],
  ['Plan documenté', ensureGrilleCentraleDocumentedMap],
  ['Field Verification', ensureGrilleCentraleFieldVerification]
];

/**
 * Retire TOUT ce que l'ensemencement Grille a posé, et rien d'autre.
 *
 * Vider le magasin entier réveillerait des ensemenceurs de catalogue étrangers à la Grille,
 * dont les écritures ne sont pas imputables à une consultation. On ne retire donc que les
 * fiches de la Grille : synoptique, preuve, carte documentée, ports, chemins monitoring,
 * routeur et architecture physique.
 */
function retirerLesFichesGrille() {
  for (const [, contenu] of tables) {
    for (const [cle, valeur] of [...contenu]) {
      const id = String(valeur?.id ?? cle);
      const estGrille = id.startsWith('gc-')
        || id.includes('gc190x184')
        || String(valeur?.routerId || '') === GRILLE_CENTRALE_ROUTER_ID;
      if (estGrille) contenu.delete(cle);
    }
  }
}

/** L'installation réelle : la fiche canonique, sa baie, sa salle. */
function poserLaGrille() {
  retirerLesFichesGrille();
  const { room, baie, equipment } = buildGrilleCentraleOperationalSeed();
  table('rooms').set(String(room.id), room);
  table('baies').set(String(baie.id), baie);
  table('equipments').set(String(equipment.id), equipment);
  ecritures.length = 0;
  passerelle.forgetGrilleCentraleDataset();
  return equipment;
}

/**
 * Laisser retomber le démarrage AVANT de mesurer.
 *
 * Importer ces modules réveille aussi des producteurs qui n'ont rien à voir avec la Grille —
 * `equipment-catalog-gap-seed.js` par exemple, programmé au chargement. Leurs écritures ne
 * sont pas imputables à une consultation ; les compter reviendrait à mesurer le démarrage.
 * On attend donc que le bruit cesse, exactement comme la sonde navigateur attend la
 * convergence, puis on remet les compteurs à zéro.
 *
 * Mesuré : l'ensemencement de démarrage produit 705 écritures et s'arrête à t+2863 ms —
 * dont 374 pour la minuterie d'ensemencement de `grille-centrale-documented-map.js`
 * (`scheduleReconcile(2800)`, chemin `persister:true`), qui est LÉGITIME et n'est pas une
 * consultation. Plus une seule écriture ensuite, jusqu'à t+12 s. La fenêtre de silence est
 * donc prise au-dessus de cette minuterie : en dessous, on mesurerait le démarrage.
 */
async function laisserRetomber(silenceMs = 1500, plafondMs = 20000) {
  const debut = Date.now();
  let dernier = -1;
  let stable = 0;
  while (Date.now() - debut < plafondMs) {
    await new Promise(resoudre => setTimeout(resoudre, 50));
    if (ecritures.length === dernier) { stable += 50; if (stable >= silenceMs) break; }
    else { stable = 0; dernier = ecritures.length; }
  }
  ecritures.length = 0;
}

/*
 * UNE MODALE COMPLÈTE.
 *
 * Les panneaux dessinent dans `.ops-modal-body` et rendent `false` s'ils ne le trouvent pas.
 * Sans corps, on mesurerait l'absence de DOM au lieu de la reconnaissance de l'équipement.
 */
function noeudDouble(className = '') {
  const enfants = [];
  return {
    enfants, className, innerHTML: '', textContent: '', style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(x) { enfants.push(x); return x; },
    insertBefore(x) { enfants.push(x); return x; },
    remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector: sel => enfants.find(e => String(e.className || '').includes(String(sel).replace(/^\./, ''))) || null,
    querySelectorAll: () => [], closest: () => null
  };
}
function modaleDouble(equipmentId) {
  const corps = noeudDouble('ops-modal-body');
  return {
    corps,
    dataset: { equipmentId: String(equipmentId) },
    querySelector: sel => (String(sel).includes('ops-modal-body') ? corps : null),
    querySelectorAll: () => []
  };
}

/** Les VRAIS points d'entrée de rendu, ceux que la fiche 360 appelle. */
const RENDUS = [
  ['Topologie', 'grille-centrale-topology-card'],
  ['Architecture physique', 'grille-centrale-physical-architecture-card'],
  ['Plan documenté', 'grille-centrale-documented-map-card'],
  ['Field Verification', 'grille-centrale-field-verification-card']
];

/** Ouvre la fiche 360 d'un équipement et rend ce que chaque panneau a décidé. */
async function ouvrirFiche360(equipmentId) {
  const surface = modaleDouble(equipmentId);
  const decisions = {};
  for (const [nom, enhance] of [
    ['Topologie', enhanceGrilleCentrale360],
    ['Architecture physique', enhanceGrilleCentralePhysical360],
    ['Plan documenté', enhanceGrilleCentraleDocumentedMap360],
    ['Field Verification', enhanceGrilleCentraleFieldVerification360]
  ]) {
    decisions[nom] = await enhance(surface).catch(erreur => `erreur:${erreur.message}`);
  }
  return { surface, decisions, cartes: surface.corps.enfants.map(e => String(e.className || '')) };
}

/** Une consultation : les quatre panneaux, comme la fiche 360 les appelle. */
async function consulter(jeton) {
  const rendus = [];
  for (const [nom, ensure] of PANNEAUX) {
    const resultat = await ensure({ revalidate: true, ouverture: jeton, persister: false }).catch(erreur => ({ erreur }));
    rendus.push({ nom, resultat });
  }
  return rendus;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7 — LES QUATRE PANNEAUX S'EXÉCUTENT VRAIMENT
 * ═══════════════════════════════════════════════════════════════════════════ */

test('#166 §7 · les quatre panneaux rendent sur la fiche canonique', async () => {
  poserLaGrille();
  autorise = true;
  appelsEndpoint = 0;

  const rendus = await consulter('ouverture-1');
  for (const { nom, resultat } of rendus) {
    assert.ok(!resultat.erreur, `« ${nom} » ne doit pas échouer : ${resultat.erreur?.message}`);
    assert.equal(resultat.authorized, true, `« ${nom} » doit être autorisé et rendre`);
  }
  assert.ok(appelsEndpoint > 0, 'le jeu de données protégé doit avoir été réellement demandé');

  // Le panneau du plan documenté rend les compteurs de l'état RÉEL, pas ceux du seed.
  const plan = rendus.find(r => r.nom === 'Plan documenté').resultat;
  assert.equal(plan.expectedPorts, jeuDeDonnees.documentedPorts.length);
  assert.ok(plan.expectedPorts > 0, 'le plan documenté doit porter des ports');
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §8 — DIX CONSULTATIONS N'ÉCRIVENT RIEN (la couverture #165 qui manquait)
 * ═══════════════════════════════════════════════════════════════════════════ */

test('#166 §8 · dix consultations de la Grille : 0 écriture métier', async () => {
  /*
   * LE DISCRIMINANT EST LE MAGASIN VIDE, PAS LA RÉPÉTITION.
   *
   * Mesurer dix ouvertures sur une base DÉJÀ ensemencée ne prouverait que la convergence :
   * l'ensemencement, devenu idempotent, ne réécrit rien de toute façon. Une consultation qui
   * se remettrait à ensemencer passerait donc inaperçue.
   *
   * On laisse donc d'abord le démarrage finir — ses minuteries ne se rearment pas — puis on
   * VIDE le magasin et on n'y remet que l'installation réelle : la fiche canonique, sa baie,
   * sa salle. À partir de là, tout ce que le chemin d'ensemencement écrirait est visible :
   * synoptique, preuve, carte documentée, 374 ports, chemins monitoring. La consultation, elle,
   * ne doit rien écrire du tout.
   */
  await laisserRetomber();
  desarmerMinuteries();
  poserLaGrille();
  autorise = true;
  appelsEndpoint = 0;
  ecritures.length = 0;
  const avant = [...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort();

  for (let ouverture = 0; ouverture < 10; ouverture += 1) {
    await consulter(`ouverture-${ouverture}`);
  }
  await new Promise(resoudre => setTimeout(resoudre, 300));

  assert.deepEqual(ecritures, [], `10 ouvertures ne doivent produire AUCUNE écriture, reçu : ${JSON.stringify(ecritures.slice(0, 8))}`);
  assert.deepEqual([...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort(), avant,
    'aucun magasin ne doit grossir pendant la consultation');

  // La preuve que ces dix tours ont bien traversé le chemin réel : l'autorisation a été
  // revalidée à chaque ouverture (#137), elle n'a pas été servie depuis une mémoire.
  assert.ok(appelsEndpoint >= 10, `chaque ouverture doit revalider (reçu ${appelsEndpoint})`);
});

test('#166 §8 · le discriminant : sur le MÊME magasin vide, le chemin d’ensemencement écrit', async () => {
  /*
   * Sans cette épreuve, la précédente ne prouverait rien : elle pourrait passer parce que
   * rien n'écrit jamais. Le même point d'entrée, sur le même magasin, avec `persister:true`,
   * DOIT écrire — c'est ce qui donne son sens au zéro d'à côté.
   */
  await laisserRetomber();
  desarmerMinuteries();
  poserLaGrille();
  autorise = true;
  ecritures.length = 0;

  const resultat = await ensureGrilleCentraleDocumentedMap({ revalidate: true, ouverture: 'ensemencement', persister: true });
  assert.equal(resultat.authorized, true);
  assert.ok(ecritures.length > 100,
    `le chemin d’ensemencement doit écrire le plan documenté (reçu ${ecritures.length})`);
  assert.ok(ecritures.some(e => e.id === 'gc-documented-port-cable-map'),
    'la carte documentée doit être posée par l’ensemencement');
});

test('#166 §8 · la consultation ne crée pas non plus l’équipement canonique', async () => {
  // §9 sous sa forme durable : sans fiche canonique, dix consultations n'en fabriquent pas.
  await laisserRetomber();
  desarmerMinuteries();
  retirerLesFichesGrille();
  table('equipments').clear();
  passerelle.forgetGrilleCentraleDataset();
  autorise = true;
  ecritures.length = 0;

  for (let ouverture = 0; ouverture < 10; ouverture += 1) {
    await consulter(`sans-fiche-${ouverture}`);
  }
  assert.equal(table('equipments').size, 0, 'aucun équipement ne doit naître d’une consultation');
  assert.deepEqual(ecritures.filter(e => e.store === 'equipments'), []);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FAIL-CLOSED : UN POSTE NON HABILITÉ NE REÇOIT RIEN, ET N'ÉCRIT RIEN
 * ═══════════════════════════════════════════════════════════════════════════ */

test('#166 · refusé par le serveur : aucun panneau ne rend, aucune écriture', async () => {
  poserLaGrille();
  autorise = false;
  passerelle.forgetGrilleCentraleDataset();
  await laisserRetomber();
  desarmerMinuteries();
  ecritures.length = 0;

  for (let ouverture = 0; ouverture < 10; ouverture += 1) {
    const rendus = await consulter(`refus-${ouverture}`);
    for (const { nom, resultat } of rendus) {
      assert.ok(!resultat.erreur, `« ${nom} » doit se taire proprement`);
      assert.equal(resultat.authorized, false, `« ${nom} » ne doit rien rendre sans habilitation`);
    }
  }
  assert.deepEqual(ecritures, [], 'un poste hors périmètre ne doit rien écrire');
  autorise = true;
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LA FICHE RÉELLE À LIBELLÉ LONG — CE QUE #166 APPELLE « rattacher l'existant »
 *
 * ROUGE sur 3d777dfa3f4225ab605e45212f4b76a819315987 : le serveur reconnaissait une fiche
 * opérationnelle réelle nommée « GRILLE CENTRALE 190x184 » (le contrat d'identité privé
 * connaît les libellés documentés), le bootstrap s'abstenait de créer un doublon, mais la
 * fiche 360 ne rendait AUCUN des quatre panneaux — les écrans publics ne reconnaissent
 * qu'`catalogId` ou l'alias court, et c'est volontaire (#137).
 *
 *     panneaux Topologie / Architecture / Plan / Field Verification → false
 *     cartes insérées dans la modale → 0
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Une fiche opérationnelle réelle : ses données sont celles de l'opérateur, pas les nôtres. */
const ficheReelle = (alias, extra = {}) => ({
  id: 'existing-real-gc',
  name: alias,
  nom: alias,
  roomId: 'salle-stc-reelle',
  baieId: 'baie-3-reelle',
  marque: 'Harris Broadcast',
  modele: 'Platinum PT-FR-15',
  numSerie: 'SN-REEL-0001',
  statut: 'Opérationnel',
  ...extra
});

/** Le magasin serveur et le navigateur partagent le stockage : /api/sync les relie. */
const accesPartage = {
  list: async nom => [...table(nom).values()],
  get: async (nom, id) => table(nom).get(String(id)) ?? null,
  put: async (nom, id, enregistrement) => { await db.save(nom, { ...enregistrement, id }); return enregistrement; }
};

function poserFicheReelle(alias, extra = {}) {
  retirerLesFichesGrille();
  for (const nom of ['equipments', 'rooms', 'baies']) table(nom).clear();
  table('docs').delete(String('gc-operational-bootstrap'));
  const fiche = ficheReelle(alias, extra);
  table('equipments').set(String(fiche.id), fiche);
  table('rooms').set('salle-stc-reelle', { id: 'salle-stc-reelle', name: 'STC' });
  table('baies').set('baie-3-reelle', { id: 'baie-3-reelle', name: 'BAIE 3', roomId: 'salle-stc-reelle' });
  passerelle.forgetGrilleCentraleDataset();
  return fiche;
}

for (const alias of ['GRILLE CENTRALE 190x184', 'GRILLE CENTRALE 190×184']) {
  test(`#166 · « ${alias} » : la fiche réelle est rattachée, et ses quatre panneaux rendent`, async () => {
    await laisserRetomber();
    desarmerMinuteries();
    const fiche = poserFicheReelle(alias);
    autorise = true;
    ecritures.length = 0;

    const rapport = await ensureGrilleCentraleOperationalRecords(accesPartage);
    assert.equal(rapport.created, 0, 'aucun doublon ne doit être créé à côté de la fiche réelle');
    assert.equal(rapport.linked, true, 'la fiche réelle doit recevoir le lien canonique');
    assert.equal(rapport.equipmentId, fiche.id);

    // Le rattachement complète l'IDENTITÉ, il ne remplace rien.
    const apres = await db.get('equipments', fiche.id);
    assert.equal(apres.catalogId, GRILLE_CENTRALE_CATALOG_ID);
    for (const champ of ['id', 'name', 'nom', 'roomId', 'baieId', 'marque', 'modele', 'numSerie', 'statut']) {
      assert.equal(apres[champ], fiche[champ], `« ${champ} » de la fiche réelle doit être préservé`);
    }

    desarmerMinuteries();
    const { decisions, cartes } = await ouvrirFiche360(fiche.id);
    for (const [nom, classe] of RENDUS) {
      assert.equal(decisions[nom], true, `« ${nom} » doit rendre sur la fiche réelle`);
      assert.ok(cartes.some(c => c.includes(classe)), `la carte « ${nom} » doit être insérée dans la modale`);
    }
  });
}

test('#166 §8 · la fiche réelle rattachée : 10 consultations, 0 écriture, 0 mutation HTTP, file inchangée', async () => {
  await laisserRetomber();
  desarmerMinuteries();
  const fiche = poserFicheReelle('GRILLE CENTRALE 190x184');
  autorise = true;
  await ensureGrilleCentraleOperationalRecords(accesPartage);

  await laisserRetomber();
  desarmerMinuteries();
  const fileAvant = await tailleFile();
  const magasinsAvant = [...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort();
  ecritures.length = 0;
  requetes.length = 0;
  appelsEndpoint = 0;

  for (let ouverture = 0; ouverture < 10; ouverture += 1) {
    const { decisions } = await ouvrirFiche360(fiche.id);
    for (const [nom] of RENDUS) assert.equal(decisions[nom], true, `ouverture ${ouverture} : « ${nom} » doit rendre`);
  }
  await new Promise(resoudre => setTimeout(resoudre, 300));

  assert.deepEqual(ecritures.map(e => `${e.store}/${e.id}`), [], '10 ouvertures : aucune écriture métier');
  assert.deepEqual(mutationsHttp(), [], '10 ouvertures : aucune mutation HTTP (POST/PUT/PATCH/DELETE)');
  assert.equal(await tailleFile() - fileAvant, 0, '10 ouvertures : la file de synchronisation ne grossit pas');
  assert.deepEqual([...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort(), magasinsAvant,
    'aucun magasin ne doit grossir');
  assert.ok(appelsEndpoint >= 10, `chaque ouverture doit revalider (reçu ${appelsEndpoint})`);
});

test('#166 · une identité de catalogue CONTRADICTOIRE ferme, elle ne se réassigne pas', async () => {
  await laisserRetomber();
  desarmerMinuteries();
  const fiche = poserFicheReelle('GRILLE CENTRALE 190x184', { catalogId: 'kb-imagine-platinum-vx' });
  autorise = true;
  ecritures.length = 0;

  const rapport = await ensureGrilleCentraleOperationalRecords(accesPartage);
  assert.equal(rapport.linked, false, 'aucun lien ne doit être posé sur une identité contradictoire');
  assert.equal(rapport.skipped, 'catalog-conflict');
  assert.equal(rapport.conflictingCatalogId, 'kb-imagine-platinum-vx');
  assert.deepEqual(ecritures, [], 'un conflit n’écrit rien du tout, marqueur compris');

  const apres = await db.get('equipments', fiche.id);
  assert.equal(apres.catalogId, 'kb-imagine-platinum-vx', 'l’identité affirmée par l’opérateur est intacte');
});

test('#166 · une fiche verrouillée par un administrateur n’est pas retouchée', async () => {
  await laisserRetomber();
  desarmerMinuteries();
  const fiche = poserFicheReelle('GRILLE CENTRALE 190x184', { origin: 'admin' });
  autorise = true;
  ecritures.length = 0;

  const rapport = await ensureGrilleCentraleOperationalRecords(accesPartage);
  assert.equal(rapport.skipped, 'admin-locked');
  assert.equal(rapport.linked, false);
  assert.deepEqual(ecritures, []);
  assert.equal((await db.get('equipments', fiche.id)).catalogId, undefined);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LA FICHE PROTÉGÉE PAR UN ADMINISTRATEUR — DEUX ÉTATS, JAMAIS D'ENTRE-DEUX
 *
 * ROUGE sur 6d585ffc9608b5d713099e0ceffb491e270f8e3e : le serveur autorisait
 * (`equipment-scope`) une fiche que la fiche 360 ne reconnaissait pas — quatre panneaux à
 * `false`, zéro carte. Le bootstrap avait raison de ne pas la retoucher ; c'est
 * l'autorisation qui allait trop loin.
 * ═══════════════════════════════════════════════════════════════════════════ */

for (const alias of ['GRILLE CENTRALE 190x184', 'GRILLE CENTRALE 190×184']) {
  test(`#166 · « ${alias} » verrouillée : rien n’est retouché, et aucun panneau ne rend`, async () => {
    await laisserRetomber();
    desarmerMinuteries();
    const fiche = poserFicheReelle(alias, { origin: 'admin' });
    autorise = true;
    ecritures.length = 0;

    const rapport = await ensureGrilleCentraleOperationalRecords(accesPartage);
    assert.equal(rapport.skipped, 'admin-locked');
    assert.equal(rapport.linked, false);
    assert.deepEqual(ecritures, [], 'une fiche protégée n’est pas retouchée');
    assert.equal((await db.get('equipments', fiche.id)).catalogId, undefined);

    desarmerMinuteries();
    const { decisions, cartes } = await ouvrirFiche360(fiche.id);
    for (const [nom] of RENDUS) {
      assert.equal(decisions[nom], false, `« ${nom} » ne doit rien rendre tant que le lien manque`);
    }
    assert.deepEqual(cartes, [], 'aucun contenu Grille protégé ne doit apparaître dans la modale');
  });

  test(`#166 · « ${alias} » après rattachement explicite : les quatre panneaux rendent`, async () => {
    await laisserRetomber();
    desarmerMinuteries();
    // L'administrateur relie lui-même la fiche au catalogue : c'est un geste explicite.
    const fiche = poserFicheReelle(alias, { origin: 'admin', catalogId: GRILLE_CENTRALE_CATALOG_ID });
    autorise = true;
    ecritures.length = 0;

    const rapport = await ensureGrilleCentraleOperationalRecords(accesPartage);
    assert.equal(rapport.linked, false, 'rien à rattacher : la fiche est déjà canonique');
    assert.equal(rapport.skipped, 'catalog-id');

    desarmerMinuteries();
    const { decisions, cartes } = await ouvrirFiche360(fiche.id);
    for (const [nom, classe] of RENDUS) {
      assert.equal(decisions[nom], true, `« ${nom} » doit rendre après le rattachement explicite`);
      assert.ok(cartes.some(c => c.includes(classe)), `la carte « ${nom} » doit être insérée`);
    }
    // La fiche protégée reste intacte : le rendu ne l'a pas modifiée.
    const apres = await db.get('equipments', fiche.id);
    assert.equal(apres.origin, 'admin');
    assert.equal(apres.numSerie, 'SN-REEL-0001');
  });
}

test('#166 §8 · fiche protégée puis rattachée : 10 consultations, 0 écriture, 0 mutation HTTP, file inchangée', async () => {
  await laisserRetomber();
  desarmerMinuteries();
  const fiche = poserFicheReelle('GRILLE CENTRALE 190x184', { origin: 'admin', catalogId: GRILLE_CENTRALE_CATALOG_ID });
  autorise = true;
  await ensureGrilleCentraleOperationalRecords(accesPartage);

  await laisserRetomber();
  desarmerMinuteries();
  const fileAvant = await tailleFile();
  const magasinsAvant = [...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort();
  ecritures.length = 0;
  requetes.length = 0;
  appelsEndpoint = 0;

  for (let ouverture = 0; ouverture < 10; ouverture += 1) {
    const { decisions } = await ouvrirFiche360(fiche.id);
    for (const [nom] of RENDUS) assert.equal(decisions[nom], true, `ouverture ${ouverture} : « ${nom} »`);
  }
  await new Promise(resoudre => setTimeout(resoudre, 300));

  assert.deepEqual(ecritures.map(e => `${e.store}/${e.id}`), [], '10 ouvertures : aucune écriture métier');
  assert.deepEqual(mutationsHttp(), [], '10 ouvertures : aucune mutation HTTP');
  assert.equal(await tailleFile() - fileAvant, 0, '10 ouvertures : la file ne grossit pas');
  assert.deepEqual([...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort(), magasinsAvant);
  assert.ok(appelsEndpoint >= 10, `chaque ouverture doit revalider (reçu ${appelsEndpoint})`);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LA TABLE DE VÉRITÉ DES QUATRE PANNEAUX — ET DU SERVEUR AVEC EUX
 *
 * ROUGE sur ca4fb12ecfd34180ea3b709a7bbf8cdc337e52c4 : les quatre filtres d'identité
 * n'étaient pas le même. `grille-centrale-topology.js` lisait `inventorySource.name` sans
 * `reference` ; les trois autres l'inverse. Mesuré, fiche réelle protégée :
 *
 *     reference = « GRILLE CENTRALE »
 *       serveur autorise · Architecture / Plan / Field rendent · Topologie NON
 *     inventorySource.name = « GRILLE CENTRALE »
 *       serveur refuse · Topologie rend · les trois autres NON
 *
 * L'écart existait dans les deux sens. Ce fichier ne compare plus des textes : il OUVRE la
 * fiche 360 sur chaque forme d'équipement et exige que les quatre panneaux disent la même
 * chose — et que le serveur ne les dépasse jamais.
 * ═══════════════════════════════════════════════════════════════════════════ */

const { createAccessControl } = await import('../scripts/access-control.js');

/** Le serveur, avec la fiche posée dans sa baie, sa salle et sa zone. */
async function verdictServeur(fiche, role = 'admin') {
  const magasins = {
    equipments: [fiche],
    baies: [{ id: 'baie-3-reelle', name: 'BAIE 3', roomId: 'salle-stc-reelle' }],
    rooms: [{ id: 'salle-stc-reelle', name: 'STC' }],
    zones: [{ id: 'zone-stc', name: 'STC' }],
    resource_zones: [{ id: 'rz', resourceType: 'room', resourceId: 'salle-stc-reelle', zoneId: 'zone-stc' }],
    zone_memberships: [], zone_grants: []
  };
  const pool = { query: async (sql, p = []) => {
    const lignes = (magasins[String(p[0])] || []).map(data => ({ record_id: String(data.id), data, updated_at: new Date() }));
    return { rows: p.length > 1 ? lignes.filter(l => l.record_id === String(p[1])) : lignes };
  } };
  return createAccessControl(pool).canReadGrilleCentraleDataset({ id: `u-${role}`, role });
}

/** Un autre appareil RÉEL de ce catalogue — pas une clé inventée pour l'occasion. */
const CATALOGUE_ETRANGER = 'kb-imagine-platinum-vx';

const CAS_IDENTITE = [
  ['A · lien de catalogue canonique', { catalogId: GRILLE_CENTRALE_CATALOG_ID, name: 'Grille du site' }, true],
  ['B1 · alias court sur name', { name: 'GRILLE CENTRALE' }, true],
  ['B2 · alias court sur nom', { name: 'Autre chose', nom: 'Grille Centrale' }, true],
  ['B3 · alias court sur reference', { name: 'Autre chose', reference: 'GRILLE CENTRALE' }, true],
  ['B4 · alias court sur modele', { name: 'Autre chose', modele: 'grille centrale' }, true],
  ['B5 · alias court sur model', { name: 'Autre chose', model: 'GRILLE CENTRALE' }, true],
  ['B6 · alias court sur inventorySource.reference', { name: 'Autre chose', inventorySource: { reference: 'GRILLE CENTRALE' } }, true],
  ['B7 · alias court sur inventorySource.label', { name: 'Autre chose', inventorySource: { label: 'Grille Centrale' } }, true],
  ['B8 · alias court sur inventorySource.name', { name: 'Autre chose', inventorySource: { name: 'GRILLE CENTRALE' } }, true],
  ['C · alias privé long, sans lien', { name: 'GRILLE CENTRALE 190x184' }, false],
  ['D · alias privé long AVEC lien canonique', { name: 'GRILLE CENTRALE 190x184', catalogId: GRILLE_CENTRALE_CATALOG_ID }, true],
  ['E · alias long verrouillé, sans lien', { name: 'GRILLE CENTRALE 190×184', origin: 'admin' }, false],
  ['F · champ délibérément NON retenu', { name: 'Autre chose', description: 'GRILLE CENTRALE', marque: 'GRILLE CENTRALE' }, false],

  /*
   * G — LA FICHE DÉCLARE UN AUTRE MODÈLE DE CATALOGUE.
   *
   * `kb-imagine-platinum-vx` EXISTE dans ce catalogue : ce n'est pas une clé inventée, c'est
   * un autre appareil réel. Sur `af4e14a`, chacune de ces formes rendait les quatre panneaux
   * ET ouvrait le serveur — l'accord parfait, sur la mauvaise fiche. Le libellé d'affichage
   * ne renverse pas ce que la fiche affirme d'elle-même.
   */
  ['G1 · alias court + catalogue étranger', { name: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER }, false],
  ['G2 · nom + catalogue étranger', { nom: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER }, false],
  ['G3 · reference + catalogue étranger', { name: 'Autre chose', reference: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER }, false],
  ['G4 · inventorySource.reference + catalogue étranger', { name: 'Autre chose', inventorySource: { reference: 'GRILLE CENTRALE' }, catalogId: CATALOGUE_ETRANGER }, false],
  ['G5 · alias documenté long + catalogue étranger', { name: 'GRILLE CENTRALE 190x184', catalogId: CATALOGUE_ETRANGER }, false]
];

for (const [titre, forme, attendu] of CAS_IDENTITE) {
  test(`#166 · table de vérité — ${titre}`, async () => {
    await laisserRetomber();
    desarmerMinuteries();
    retirerLesFichesGrille();
    for (const nom of ['equipments', 'rooms', 'baies']) table(nom).clear();
    table('docs').delete('gc-operational-bootstrap');

    const fiche = {
      id: 'identite-gc', roomId: 'salle-stc-reelle', baieId: 'baie-3-reelle',
      marque: 'Harris Broadcast', modele: 'Platinum PT-FR-15', numSerie: 'SN-1', ...forme
    };
    table('equipments').set(fiche.id, fiche);
    table('rooms').set('salle-stc-reelle', { id: 'salle-stc-reelle', name: 'STC' });
    table('baies').set('baie-3-reelle', { id: 'baie-3-reelle', name: 'BAIE 3', roomId: 'salle-stc-reelle' });
    passerelle.forgetGrilleCentraleDataset();
    autorise = true;
    ecritures.length = 0;

    const { decisions } = await ouvrirFiche360(fiche.id);

    // 1. Les QUATRE panneaux disent la même chose.
    const valeurs = RENDUS.map(([nom]) => decisions[nom]);
    assert.equal(new Set(valeurs).size, 1,
      `les quatre panneaux doivent s’accorder — reçu ${JSON.stringify(decisions)}`);
    for (const [nom] of RENDUS) {
      assert.equal(decisions[nom], attendu, `« ${nom} » : ${attendu ? 'doit rendre' : 'ne doit pas rendre'}`);
    }

    // 2. Le serveur ne les dépasse jamais.
    const verdict = await verdictServeur(fiche);
    if (verdict.allowed) {
      assert.equal(attendu, true,
        `le serveur autorise « ${titre} » : les quatre panneaux DOIVENT reconnaître`);
    }
    if (!attendu) {
      assert.equal(verdict.allowed, false,
        `« ${titre} » n’est pas reconnu des écrans : le serveur doit fermer`);
    }
  });
}

test('#166 · réparation EXPLICITE : le catalogue étranger cède la place, les quatre panneaux reprennent', async () => {
  /*
   * La fermeture d'un conflit ne doit pas être une impasse. Quand l'opérateur tranche
   * lui-même — il remplace le lien étranger par le lien canonique — la fiche redevient
   * ordinaire : l'ACL décide comme pour n'importe quel équipement, et la fiche 360 rend.
   *
   * Aucune réparation automatique n'est éprouvée ici, et il n'en existe pas : c'est un geste
   * explicite, mesuré comme tel.
   */
  await laisserRetomber();
  desarmerMinuteries();
  retirerLesFichesGrille();
  for (const nom of ['equipments', 'rooms', 'baies']) table(nom).clear();
  table('docs').delete('gc-operational-bootstrap');

  const enConflit = {
    id: 'reparation-gc', name: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER,
    roomId: 'salle-stc-reelle', baieId: 'baie-3-reelle', numSerie: 'SN-42', marque: 'Imagine Communications'
  };
  table('equipments').set(enConflit.id, enConflit);
  table('rooms').set('salle-stc-reelle', { id: 'salle-stc-reelle', name: 'STC' });
  table('baies').set('baie-3-reelle', { id: 'baie-3-reelle', name: 'BAIE 3', roomId: 'salle-stc-reelle' });
  passerelle.forgetGrilleCentraleDataset();
  autorise = true;
  ecritures.length = 0;

  // 1. En conflit : le serveur ferme, aucun panneau ne rend.
  const avant = await ouvrirFiche360(enConflit.id);
  for (const [nom] of RENDUS) {
    assert.equal(avant.decisions[nom], false, `« ${nom} » ne doit pas rendre sur une identité en conflit`);
  }
  assert.equal((await verdictServeur(enConflit)).allowed, false);
  assert.deepEqual(ecritures, [], 'la fermeture n’écrit rien');

  // 2. L'opérateur répare EXPLICITEMENT.
  const reparee = { ...enConflit, catalogId: GRILLE_CENTRALE_CATALOG_ID };
  table('equipments').set(reparee.id, reparee);
  passerelle.forgetGrilleCentraleDataset();

  const apres = await ouvrirFiche360(reparee.id);
  for (const [nom] of RENDUS) {
    assert.equal(apres.decisions[nom], true, `« ${nom} » doit rendre après la réparation`);
  }
  const verdict = await verdictServeur(reparee);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.reason, 'equipment-scope');

  // 3. Et la fiche de l'opérateur n'a pas été retouchée au passage.
  assert.equal(table('equipments').get('reparation-gc').numSerie, 'SN-42');
  assert.equal(table('equipments').get('reparation-gc').marque, 'Imagine Communications');
});
