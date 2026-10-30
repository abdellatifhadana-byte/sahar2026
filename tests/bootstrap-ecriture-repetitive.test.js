/**
 * @file tests/bootstrap-ecriture-repetitive.test.js — WRITE-01, la tempête d'écritures.
 *
 * CE QUI SE PASSAIT, MESURÉ SUR UNE SESSION IMMOBILE DE SOIXANTE SECONDES
 * ----------------------------------------------------------------------
 *   Admin        ~3 écritures · file vide      · document présent
 *   Manager      ~3 écritures · file vide      · document présent
 *   Chef         ~48          · ~53 en échec   · document ABSENT
 *   Responsable  ~48          · ~54 en échec   · document ABSENT
 *   Technicien   ~44          · ~50 en échec   · document ABSENT
 *   Visiteur     ~48          · ~53 en échec   · document ABSENT
 *
 * Personne n'avait rien touché. Un seul écrivain explique la totalité :
 * `ensurePlanRecord`, dans la chaîne
 *
 *   documented-map-updated → ensureGrilleCentraleFieldVerification
 *                          → ensurePlanRecord → PUT docs/gc-field-verification-plan
 *
 * POURQUOI LA BOUCLE NE POUVAIT PAS S'ARRÊTER
 * -------------------------------------------
 * `ensurePlanRecord` a bien une garde de contenu : il n'écrit que si la version locale
 * diffère de la version voulue. Pour un administrateur, la première écriture réussit, le
 * document reste en base locale, `avant === après`, et la boucle s'éteint d'elle-même.
 *
 * Pour un rôle à périmètre, le document de plateforme n'appartient à aucune zone : il
 * n'est donc pas dans son instantané. La tentative part, le serveur la refuse — à juste
 * titre — le retour arrière efface la copie locale, et à l'événement suivant la garde
 * retrouve `current = null` et conclut de nouveau qu'il faut écrire. Chaque refus prépare
 * la tentative suivante.
 *
 * L'INVARIANT QUI MANQUAIT : un instantané filtré n'est pas une absence centrale.
 *
 * Ne pas voir une référence de plateforme ne veut pas dire qu'elle n'existe pas ; cela veut
 * dire qu'elle ne nous regarde pas. Seul un rôle qui voit TOUTES les zones peut conclure
 * d'une absence qu'il faut initialiser.
 *
 * MÉTHODE
 * -------
 * Ces tests EXÉCUTENT le vrai module. Le serveur qui refuse est simulé au bon endroit —
 * `db.save` rejette et n'enregistre rien, exactement comme le fait un retour arrière après
 * un 403 — et l'on compte les écritures RÉELLEMENT tentées, rôle par rôle. On éprouve aussi
 * la chaîne d'événements elle-même, pas seulement l'appel direct.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Un navigateur minimal, installé avant l'import ---------------- */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
    for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement);
    return true;
  }
};
const element = () => ({
  id: '', className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, enfants: [],
  classList: { add() {}, remove() {}, contains: () => false },
  appendChild(noeud) { this.enfants.push(noeud); return noeud; },
  remove() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
});
globalThis.document = {
  createElement: () => element(), body: element(), head: element(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};

let identite = null;
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' && identite ? JSON.stringify(identite) : null),
  setItem() {}, removeItem() {}
};

/* ---------------- La base locale, et le serveur qui refuse ---------------- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

/** Toutes les écritures TENTÉES — y compris celles que le serveur refusera. */
const tentatives = [];
/** Quand il est vrai, le serveur refuse et le retour arrière efface la copie locale. */
let serveurRefuse = false;

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
/*
 * LA BASCULE CENTRALE EST DÉJÀ TRANCHÉE POUR CE DOUBLE (#166).
 *
 * `grille-centrale-documented-map.js` attend désormais `attendreDecisionSync()` avant
 * d'ensemencer : un `docs` vide n'est pas une donnée manquante, c'est un instantané qui
 * n'est pas encore arrivé. Ce double installe un `window` minimal, donc la barrière ne se
 * court-circuite pas toute seule et attendrait un événement que ce fichier n'émet jamais.
 *
 * Ce que ce fichier mesure commence APRÈS le démarrage — la chaîne d'événements d'une
 * session immobile, et ce qu'elle réécrit. L'état de la bascule fait donc partie du double,
 * au même titre que `db.open` ou `db.getAll`.
 */
db.isCentralSyncReady = () => true;
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  tentatives.push({ store: nom, id: String(enregistrement?.id ?? ''), record: enregistrement });
  if (serveurRefuse) {
    // Ce que fait réellement `central-sync` sur un refus définitif : la copie locale est
    // ramenée à ce qu'elle était — ici, à rien — puis l'erreur remonte.
    table(nom).delete(String(enregistrement?.id ?? ''));
    const erreur = new Error('Accès refusé à cette zone.');
    erreur.status = 403;
    erreur.code = 'ZONE_FORBIDDEN';
    throw erreur;
  }
  const id = enregistrement?.id ?? `auto-${table(nom).size + 1}`;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = async (nom, enregistrement) => {
  const id = enregistrement?.id ?? `auto-${table(nom).size + 1}`;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

const vraiSetTimeout = globalThis.setTimeout;

// Les modules chargés ci-dessous arment des minuteries de fond — réconciliation, fenêtre
// calme du catalogue. Elles ne sont pas l'objet de ces épreuves et retiendraient Node
// indéfiniment : on les détache de la boucle d'événements sans changer leur comportement.
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

/*
 * LE GARDE-CATALOGUE EST CHARGÉ ICI PARCE QU'IL L'EST EN PRODUCTION.
 *
 * `ensureGrilleCentraleFieldVerification` n'est pas seul : il commence par
 *
 *   ensureGrilleCentraleDocumentedMap → …Topology → …Knowledge
 *     → …ImageCoverageBatch8/7/6 → ensureGapCatalogSeed
 *
 * Toute cette cascade écrit des fiches d'ensemencement. `catalog-seed-guard.js` les
 * intercepte et les garde en local au lieu de les envoyer — c'est pour cela qu'elles ne
 * produisent aucune tempête. Sans lui, la première d'entre elles serait refusée et la
 * chaîne s'arrêterait AVANT l'écrivain qu'on veut éprouver : on mesurerait alors un calme
 * qui n'existe pas.
 *
 * Le document du plan, lui, échappe aux trois motifs du garde — ni son identifiant, ni son
 * origine, ni son genre ne correspondent. C'est précisément pour cela que c'est LUI, et lui
 * seul, qui atteint le serveur et boucle.
 */
await import('../catalog-seed-guard.js');

/*
 * #137 — LE PLAN N'EST PLUS UNE CONSTANTE DU MODULE, C'EST UNE DONNÉE AUTORISÉE.
 *
 * Le jeu de données Grille Centrale a quitté le bundle public : il s'obtient par
 * `/api/operational/grille-centrale/documented-map`, et le serveur ne le rend qu'à qui est
 * habilité sur l'équipement canonique. Le navigateur minimal reçoit donc un réseau qui
 * DISTINGUE les deux cas, au lieu de supposer que tout le monde a la donnée sous la main.
 *
 * `grilleAutorisee` est indépendant du rôle, exprès : c'est le point du lot. Un technicien
 * habilité l'obtient, un administrateur sans équipement canonique résoluble ne l'obtient pas.
 */
const { buildGrilleCentraleDataset } = await import('../scripts/private-operational-data/grille-centrale.js');
const jeuDeDonnees = buildGrilleCentraleDataset();
let grilleAutorisee = true;
globalThis.fetch = async chemin => {
  if (!String(chemin).includes('/api/operational/grille-centrale/documented-map')) {
    return { ok:false, status:404, json: async () => ({}) };
  }
  return grilleAutorisee
    ? { ok:true, status:200, json: async () => ({ dataset: jeuDeDonnees }) }
    : { ok:false, status:403, json: async () => ({ error:'GRILLE_SCOPE_FORBIDDEN' }) };
};

const module = await import('../grille-centrale-field-verification.js');
const { ensureGrilleCentraleFieldVerification, GRILLE_CENTRALE_FIELD_PLAN_ID } = module;

/* ------------------------------- Utilitaires ------------------------------- */

const ROLES_A_PERIMETRE = ['chef', 'responsible', 'technician', 'visitor'];
const ROLES_CENTRAUX = ['admin', 'manager'];

const passerelle = await import('../grille-centrale-dataset.js');

function session(role, { grille = true } = {}) {
  identite = { id: `u-${role}`, username: role, role };
  grilleAutorisee = grille;
  // La passerelle retient le jeu de données ET le refus par identité : chaque scénario doit
  // repartir d'une mémoire vide, sinon il hériterait de la décision du précédent.
  passerelle.forgetGrilleCentraleDataset();
  magasins.clear();
  tentatives.length = 0;
}

/** Les écritures visant LE document de plateforme, seules comptées ici. */
const ecrituresDuPlan = () => tentatives.filter(essai => essai.store === 'docs' && essai.id === GRILLE_CENTRALE_FIELD_PLAN_ID);

/** Rejoue la chaîne d'événements telle qu'elle se produit sur une session immobile. */
async function cyclesImmobiles(nombre) {
  for (let tour = 0; tour < nombre; tour += 1) {
    await ensureGrilleCentraleFieldVerification().catch(() => {});
  }
}

const attendre = ms => new Promise(resoudre => vraiSetTimeout(resoudre, ms));

/* ═══════════════ 1 · LE DÉFAUT : un rôle à périmètre écrit sans fin ═══════════════ */

for (const role of ROLES_A_PERIMETRE) {
  test(`WRITE·1 — « ${role} » n’écrit JAMAIS la référence de plateforme`, async () => {
    session(role);
    serveurRefuse = true;

    // Dix passages de la chaîne, sans la moindre action humaine.
    await cyclesImmobiles(10);

    assert.deepEqual(ecrituresDuPlan().map(essai => essai.id), [],
      `« ${role} » a tenté ${ecrituresDuPlan().length} écriture(s) du document de plateforme : `
      + 'ne pas le voir dans son instantané ne veut pas dire qu’il n’existe pas');
  });
}

test('WRITE·2 — chaque refus préparait le suivant : la boucle est bien fermée', async () => {
  /*
   * C'est la forme exacte de la boucle : le refus efface la copie locale, et l'absence
   * relance la garde. On vérifie donc qu'un rôle à périmètre ne tente RIEN même après que
   * la copie locale a disparu — c'est-à-dire dans l'état qui déclenchait la récidive.
   */
  session('chef');
  serveurRefuse = true;
  await cyclesImmobiles(3);
  assert.equal(await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID), null,
    'le document ne doit pas être en base locale pour un rôle à périmètre');
  assert.equal(ecrituresDuPlan().length, 0, 'l’absence locale a relancé l’écriture');
});

test('WRITE·3 — la chaîne d’ÉVÉNEMENTS ne relance pas l’écrivain non plus', async () => {
  // `grille-centrale-documented-map-updated` et un retour de synchronisation déclenchent
  // tous deux `scheduleReconcile`. C'est par là que la boucle repartait après un `focus`,
  // un retour du réseau ou un rechargement.
  session('visitor');
  serveurRefuse = true;
  await cyclesImmobiles(1);
  const avant = ecrituresDuPlan().length;

  window.dispatchEvent(new CustomEvent('grille-centrale-documented-map-updated', { detail: {} }));
  window.dispatchEvent(new CustomEvent('central-sync-status', { detail: { state: 'synced' } }));
  await attendre(1200);

  assert.equal(ecrituresDuPlan().length, avant,
    'un événement de carte ou un retour de synchronisation a relancé l’écriture');
});

/* ═══════════════ 2 · CE QUI DOIT CONTINUER DE MARCHER ═══════════════ */

for (const role of ROLES_CENTRAUX) {
  test(`WRITE·4 — « ${role} » initialise la référence UNE fois, puis se tait`, async () => {
    session(role);
    serveurRefuse = false;

    await cyclesImmobiles(6);

    assert.equal(ecrituresDuPlan().length, 1,
      `l’initialisation centrale doit être idempotente : ${ecrituresDuPlan().length} écritures`);
    const stocke = await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID);
    assert.ok(stocke, 'la référence doit exister après initialisation');
    assert.equal(stocke.kind, 'grille_field_verification_plan');
  });
}

test('WRITE·5 — même refusée, une initialisation centrale ne se rejoue pas en boucle', async () => {
  /*
   * Une initialisation automatique ne doit pas perdre la mémoire de sa tentative. Si le
   * serveur refuse — panne, droit retiré, contrainte — la relancer à chaque événement
   * reproduirait la tempête sous un autre rôle.
   */
  session('admin');
  serveurRefuse = true;

  await cyclesImmobiles(8);

  assert.equal(ecrituresDuPlan().length, 1,
    `une tentative refusée a été rejouée ${ecrituresDuPlan().length} fois`);
});

test('WRITE·6 — un rôle à périmètre HABILITÉ voit le plan, sans l’écrire', async () => {
  /*
   * WRITE-01 garantissait qu'un rôle à périmètre voie le plan sans l'écrire, en s'appuyant
   * sur le fait que son contenu était une constante du module. #137 retire cette constante
   * du bundle : la lecture dépend désormais de l'habilitation, plus du rôle.
   *
   * Les deux garanties se cumulent, elles ne se remplacent pas — un technicien habilité voit
   * toujours le plan, et n'écrit toujours rien.
   */
  session('technician', { grille: true });
  serveurRefuse = true;
  const resultat = await ensureGrilleCentraleFieldVerification();

  assert.equal(resultat.authorized, true, 'un technicien habilité doit obtenir le plan');
  assert.ok(resultat?.plan, 'le plan doit rester lisible');
  assert.equal(resultat.plan.kind, 'grille_field_verification_plan');
  assert.ok(Array.isArray(resultat.targets) && resultat.targets.length > 0,
    'la liste des cibles de vérification doit rester affichable');
  assert.equal(ecrituresDuPlan().length, 0);
});

test('WRITE·6bis — un rôle à périmètre NON habilité ne voit rien et n’écrit rien', async () => {
  /*
   * La garantie que ce lot AJOUTE. Avant #137, ce même technicien recevait la totalité du
   * plan : les 374 ports, les repères de câbles et les chemins monitoring étaient dans le
   * fichier .js qu'il venait de télécharger. Il n'y avait rien à refuser.
   */
  session('technician', { grille: false });
  serveurRefuse = true;
  const resultat = await ensureGrilleCentraleFieldVerification();

  assert.equal(resultat.authorized, false, 'sans habilitation, aucun plan');
  assert.equal(resultat.plan, null, 'le plan ne doit pas être calculable hors périmètre');
  assert.deepEqual(resultat.targets, [], 'aucune cible ne doit être exposée hors périmètre');
  assert.equal(ecrituresDuPlan().length, 0, 'et surtout : aucune écriture');
});

test('WRITE·7 — le document déjà présent localement est SERVI, pas réécrit', async () => {
  // Cas d'un rôle à périmètre à qui le document a été rendu visible : il le lit, il ne le
  // reconstruit pas. La règle est « ne jamais initialiser », pas « ne jamais lire ».
  session('chef');
  serveurRefuse = true;
  await db.saveLocalOnly('docs', {
    id: GRILLE_CENTRALE_FIELD_PLAN_ID, kind: 'grille_field_verification_plan',
    title: 'Version venue du serveur', origin: 'grille-field-verification'
  });

  await cyclesImmobiles(4);

  assert.equal(ecrituresDuPlan().length, 0);
  assert.equal((await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID)).title, 'Version venue du serveur',
    'la version centrale a été écrasée par une reconstruction locale');
});

/* ═══════════════ 3 · LA MESURE D'ACCEPTATION, SUR TOUTE LA SURFACE ═══════════════ */

test('WRITE·8 — session immobile, six rôles : AUCUNE écriture répétitive, quel que soit le magasin', async () => {
  /*
   * Les épreuves ci-dessus ne comptent que le document du plan. Celle-ci compte TOUT ce qui
   * part vers le serveur, sur n'importe quel magasin : c'est la seule façon de savoir qu'on
   * a fermé la boucle et non déplacé le bruit ailleurs.
   *
   * Un amorçage légitime a le droit d'avoir lieu — une fois. Ce qui est interdit, c'est que
   * quoi que ce soit reparte ensuite alors que personne n'a rien touché.
   *
   * Mesuré sur `main@783a5e94`, vingt cycles immobiles :
   *   admin 0 · manager 0 · chef 20 · responsable 20 · technicien 20 · visiteur 20
   * toutes sur `docs/gc-field-verification-plan`, ce qui confirme l'écrivain unique.
   */
  const CYCLES = 20;
  const constat = [];

  for (const role of ['admin', 'manager', ...ROLES_A_PERIMETRE]) {
    session(role);
    serveurRefuse = !ROLES_CENTRAUX.includes(role);

    // Le premier passage : l'amorçage central a le droit de s'y produire.
    await ensureGrilleCentraleFieldVerification().catch(() => {});
    const apresAmorcage = tentatives.length;

    await cyclesImmobiles(CYCLES);
    const repetitives = tentatives.slice(apresAmorcage);
    constat.push({ role, repetitives: repetitives.length, cibles: [...new Set(repetitives.map(essai => `${essai.store}/${essai.id}`))] });
  }

  const coupables = constat.filter(ligne => ligne.repetitives > 0);
  assert.deepEqual(coupables, [],
    `des écritures repartent sur une session immobile : ${JSON.stringify(coupables)}`);
});

test('WRITE·9 — l’autorité vient du fait de TOUT VOIR, pas d’un droit d’écriture', async () => {
  /*
   * La tentation naturelle est d'ouvrir `docs.write` aux rôles à périmètre pour que leur
   * écriture cesse d'être refusée. Ce serait remplacer une boucle par une fuite : ils
   * pourraient modifier une référence de plateforme qui ne les regarde pas.
   *
   * Ce qui fonde l'autorité d'initialisation n'est pas le droit d'écrire, c'est le REGARD
   * COMPLET : seul un rôle qui voit toutes les zones peut conclure d'une absence à une
   * inexistence. La garde s'appuie donc sur `roleSeesEveryZone`, et sur rien d'autre.
   */
  const { hasCentralInitiationAuthority } = await import('../platform-reference-contract.js');

  for (const role of ROLES_CENTRAUX) {
    assert.equal(hasCentralInitiationAuthority(role), true, `${role} doit pouvoir initialiser`);
  }
  for (const role of ROLES_A_PERIMETRE) {
    assert.equal(hasCentralInitiationAuthority(role), false,
      `${role} ne voit pas toutes les zones : il ne peut pas conclure d’une absence`);
  }
  // Un rôle inconnu ou absent ne se voit accorder aucune autorité.
  assert.equal(hasCentralInitiationAuthority(''), false);
  assert.equal(hasCentralInitiationAuthority(undefined), false);
  assert.equal(hasCentralInitiationAuthority('super-admin-inventé'), false);
});

test('WRITE·10 — sans identité en session, la garde se FERME', async () => {
  /*
   * Une garde qui s'ouvre par défaut ne garde rien. Entre le chargement de la page et la
   * fin de l'authentification, `localStorage.auth` est vide : si l'absence d'identité valait
   * autorisation, chaque démarrage — y compris celui d'un visiteur non connecté — reprendrait
   * l'initialisation des références de plateforme.
   *
   * Cette lacune a été trouvée par la batterie de mutations, pas par une relecture : aucun
   * test ne couvrait la session anonyme, et la mutation qui ouvrait la garde survivait.
   */
  const contrat = await import('../platform-reference-contract.js');

  identite = null;
  magasins.clear();
  tentatives.length = 0;
  serveurRefuse = true;

  assert.equal(contrat.sessionMayInitiatePlatformReference(), false,
    'une session sans identité ne peut pas conclure qu’une référence de plateforme est absente');

  await cyclesImmobiles(5);
  assert.equal(ecrituresDuPlan().length, 0, 'une session anonyme a tenté d’initialiser la référence');

  // Et une identité sans rôle ne vaut pas davantage.
  identite = { id: 'u-sans-role', username: 'inconnu' };
  assert.equal(contrat.sessionMayInitiatePlatformReference(), false);
});
