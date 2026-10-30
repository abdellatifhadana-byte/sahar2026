/**
 * @file tests/reference-convergence-ordre.test.js — WRITE-02, l'ordre des clés.
 *
 * CE QUI RESTAIT APRÈS WRITE-01
 * -----------------------------
 * Les rôles à périmètre n'écrivaient plus rien. Admin et Manager, eux, continuaient de
 * produire environ cinq écritures par quatre-vingt-dix secondes sur une session immobile —
 * toutes sur `docs/gc-field-verification-plan`, une par cycle d'instantané.
 *
 * La comparaison des champs de premier niveau ne montrait RIEN : seize clés contre seize,
 * même ordre, aucune absente, aucune en trop, aucune valeur différente hors `updatedAt`.
 * D'où l'hypothèse initiale — `current` deviendrait nul. Mesuré, `current` était PRÉSENT à
 * chaque passage sauf le tout premier.
 *
 * LA CAUSE, MESURÉE
 * -----------------
 * La divergence est UN NIVEAU PLUS BAS, dans l'objet `policy` :
 *
 *   venu du serveur : {"sourceLayers":[…],"noActiveCrosspointInference":true,…}
 *   calculé ici     : {"documentaryBaselineImmutable":true,"document2012Never…":true,…}
 *
 * PostgreSQL stocke le `jsonb` sous forme canonique : les clés y sont rangées par LONGUEUR
 * puis par octet, pas dans l'ordre où on les a écrites. L'enregistrement qui revient de
 * l'instantané porte donc un `policy` réordonné.
 *
 * `next` recopie `current` au premier niveau — l'ordre du dessus est donc conservé — mais
 * réaffecte `policy` EN ENTIER avec la constante gelée du module, qui a l'ordre de
 * déclaration. `JSON.stringify` étant sensible à l'ordre, `avant !== après` à chaque fois :
 *
 *   écriture → PostgreSQL renormalise → instantané → ordre différent → écriture…
 *
 * Une boucle qui ne peut pas converger, au rythme du cycle d'instantané.
 *
 * LA RÈGLE
 * --------
 * Deux enregistrements qui portent les mêmes valeurs sont le même enregistrement. L'ordre
 * de sérialisation d'un objet imbriqué n'est pas une donnée : c'est un détail de stockage,
 * et le faire entrer dans une décision d'écriture revient à écrire pour rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Navigateur minimal, installé avant l'import ---------------- */

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
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, visibilityState: 'visible'
};
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, username: 'admin', role: 'admin' }) : null),
  setItem() {}, removeItem() {}
};


/*
 * #137 — LE JEU DE DONNÉES ARRIVE PAR LE RÉSEAU, IL FAUT DONC UN RÉSEAU.
 *
 * `ensureGrilleCentraleFieldVerification()` ne s'exécute plus qu'après une réponse autorisée
 * de `/api/operational/grille-centrale/documented-map`. Le navigateur minimal reçoit donc un
 * `fetch` qui rend le jeu de données réel — celui du module privé, exactement celui que le
 * serveur enverrait. La convergence d'écriture que WRITE-02 garde est justement ce qui se
 * joue APRÈS l'autorisation ; sans ce `fetch`, le test vérifierait le silence d'un module
 * qui ne fait rien, ce qui ne prouverait rien.
 */
const { buildGrilleCentraleDataset } = await import('../scripts/private-operational-data/grille-centrale.js');
const jeuDeDonnees = buildGrilleCentraleDataset();
globalThis.fetch = async chemin => (String(chemin).includes('/api/operational/grille-centrale/documented-map')
  ? { ok:true, status:200, json: async () => ({ dataset: jeuDeDonnees }) }
  : { ok:false, status:404, json: async () => ({}) });

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};
const ecritures = [];

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
/*
 * LA BASCULE CENTRALE EST DÉJÀ TRANCHÉE POUR CE DOUBLE (#166).
 *
 * `grille-centrale-documented-map.js` attend maintenant `attendreDecisionSync()` avant
 * d'ensemencer. Ce fichier installe un `window` minimal : la barrière ne se court-circuite
 * donc pas d'elle-même et attendrait un événement qu'il n'émet jamais.
 *
 * Ce que WRITE-02 mesure est la convergence APRÈS que l'instantané est revenu — c'est même
 * son sujet. Déclarer la bascule tranchée fait partie du double, comme `db.open`.
 *
 * La règle énoncée en tête de ce fichier — « deux enregistrements qui portent les mêmes
 * valeurs sont le même enregistrement » — s'applique désormais aussi à
 * `grille-centrale-documented-map.js`, `-topology.js`, `-physical-architecture.js`,
 * `-knowledge.js` et `field-evidence-integration.js`, qui comparaient encore par
 * `JSON.stringify` (#166).
 */
db.isCentralSyncReady = () => true;
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  ecritures.push({ store: nom, id: String(enregistrement?.id ?? '') });
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = async (nom, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

await import('../catalog-seed-guard.js');
const module = await import('../grille-centrale-field-verification.js');
const {
  ensureGrilleCentraleFieldVerification, GRILLE_CENTRALE_FIELD_PLAN_ID,
  GRILLE_CENTRALE_FIELD_POLICY, GRILLE_CENTRALE_FIELD_VERSION
} = { ...module, GRILLE_CENTRALE_FIELD_VERSION: module.GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION };
// La checklist se construit à la demande depuis le jeu de données autorisé (#137) : le
// document « venu du serveur » se compose donc à partir du même jeu.
const GRILLE_CENTRALE_FIELD_TARGETS = await module.grilleCentraleFieldTargets();

/* ------------------------------- Utilitaires ------------------------------- */

/**
 * Range les clés d'un objet comme le fait PostgreSQL pour le `jsonb` : par LONGUEUR, puis
 * par octet. C'est la forme sous laquelle l'enregistrement revient de l'instantané.
 */
function commeJsonb(valeur) {
  if (Array.isArray(valeur)) return valeur.map(commeJsonb);
  if (!valeur || typeof valeur !== 'object') return valeur;
  const clesTriees = Object.keys(valeur).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
  const sortie = {};
  for (const cle of clesTriees) sortie[cle] = commeJsonb(valeur[cle]);
  return sortie;
}

/** Le document du plan tel que le serveur le renvoie : valeurs identiques, ordre canonique. */
function planVenuDuServeur(revision = 3) {
  return commeJsonb({
    id: GRILLE_CENTRALE_FIELD_PLAN_ID,
    kind: 'grille_field_verification_plan',
    targetType: 'router',
    routerId: 'router-grille-centrale-190x184',
    title: 'Grille Centrale — plan de vérification terrain / as-built',
    targetCount: GRILLE_CENTRALE_FIELD_TARGETS.length,
    categories: [...new Set(GRILLE_CENTRALE_FIELD_TARGETS.map(cible => cible.category))],
    policy: GRILLE_CENTRALE_FIELD_POLICY,
    baseline: 'design-2012-plus-existing-field-photos',
    baselineAsBuiltClaim: false,
    status: 'ready-for-field-verification',
    origin: 'grille-field-verification',
    version: GRILLE_CENTRALE_FIELD_VERSION,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    _revision: revision
  });
}

const ecrituresDuPlan = () => ecritures.filter(essai => essai.store === 'docs' && essai.id === GRILLE_CENTRALE_FIELD_PLAN_ID);

async function poserLeDocumentPuisTourner(document_, tours = 5) {
  magasins.clear();
  ecritures.length = 0;
  await db.saveLocalOnly('docs', document_);
  ecritures.length = 0;
  for (let tour = 0; tour < tours; tour += 1) {
    await ensureGrilleCentraleFieldVerification().catch(() => {});
  }
}

/* ══════════════════════════════ le défaut ══════════════════════════════ */

test('ORD·1 — la sonde reproduit bien l’ordre canonique de PostgreSQL', () => {
  // Sans cette garantie, l'épreuve ne prouverait rien : elle doit ranger les clés comme
  // PostgreSQL le fait, sinon elle mesure autre chose.
  const range = commeJsonb({ documentaryBaselineImmutable: true, sourceLayers: [1], noActiveCrosspointInference: true });
  assert.deepEqual(Object.keys(range), ['sourceLayers', 'noActiveCrosspointInference', 'documentaryBaselineImmutable'],
    'les clés doivent être rangées par longueur puis par octet');
});

test('ORD·2 — un document revenu du serveur ne provoque AUCUNE réécriture', async () => {
  /*
   * Le cœur de WRITE-02. Le document a exactement les mêmes valeurs que celui que le module
   * calcule ; seul l'ordre des clés de `policy` diffère, parce que PostgreSQL l'a renormalisé.
   *
   * Mesuré sur `main@02cfedc9` : une écriture par cycle, sans fin.
   */
  await poserLeDocumentPuisTourner(planVenuDuServeur(), 5);
  assert.equal(ecrituresDuPlan().length, 0,
    `le plan a été réécrit ${ecrituresDuPlan().length} fois alors que seul l’ordre des clés diffère`);
});

test('ORD·3 — l’ordre différent ne se limite pas au premier niveau', async () => {
  // La comparaison des champs de premier niveau ne montrait rien : c'est un niveau plus bas
  // que la divergence se cache. Une garde qui ne regarderait que la surface ne verrait rien.
  const venuDuServeur = planVenuDuServeur();
  const clesDuHaut = Object.keys(venuDuServeur);
  assert.equal(clesDuHaut.length, 16, 'seize clés de premier niveau, comme mesuré');
  assert.notDeepEqual(Object.keys(venuDuServeur.policy), Object.keys(GRILLE_CENTRALE_FIELD_POLICY),
    'l’épreuve doit bien porter sur un `policy` réordonné');
  assert.deepEqual(
    [...Object.keys(venuDuServeur.policy)].sort(),
    [...Object.keys(GRILLE_CENTRALE_FIELD_POLICY)].sort(),
    'mêmes clés, seul l’ordre change'
  );
});

test('ORD·4 — une VRAIE différence de valeur reste écrite', async () => {
  /*
   * La garde ne doit pas devenir aveugle. Si le contenu change réellement — une cible
   * ajoutée, une politique modifiée — l'écriture doit partir. Comparer par valeur au lieu de
   * comparer par texte ne veut pas dire cesser de comparer.
   */
  const perime = planVenuDuServeur();
  perime.status = 'brouillon-perime';
  await poserLeDocumentPuisTourner(perime, 3);
  assert.equal(ecrituresDuPlan().length, 1,
    'un changement réel doit produire UNE écriture, puis converger');
  assert.equal((await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID)).status, 'ready-for-field-verification');
});

test('ORD·5 — un document absent est toujours créé UNE fois', async () => {
  // Non-régression sur WRITE-01 : l'initialisation centrale reste possible et bornée.
  magasins.clear();
  ecritures.length = 0;
  for (let tour = 0; tour < 5; tour += 1) await ensureGrilleCentraleFieldVerification().catch(() => {});
  assert.equal(ecrituresDuPlan().length, 1, 'la référence absente doit être créée exactement une fois');
});

test('ORD·6 — l’ordre des ÉLÉMENTS d’un tableau reste significatif', async () => {
  /*
   * Une comparaison insensible à l'ordre des CLÉS ne doit pas devenir insensible à l'ordre
   * des ÉLÉMENTS : `sourceLayers` décrit une succession de couches, et « design-2012 » avant
   * « live-routing » ne dit pas la même chose que l'inverse.
   */
  const inverse = planVenuDuServeur();
  inverse.categories = [...inverse.categories].reverse();
  await poserLeDocumentPuisTourner(inverse, 3);
  assert.equal(ecrituresDuPlan().length, 1,
    'un tableau réordonné est un contenu différent : il doit être corrigé, une fois');
});
