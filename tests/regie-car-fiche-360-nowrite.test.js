/**
 * @file tests/regie-car-fiche-360-nowrite.test.js — #165 EQUIP-360-NOWRITE, volet Régie Car.
 *
 * CE QUI MANQUAIT
 * ----------------
 * #165 a établi une règle : CONSULTER N'EST PAS ENSEMENCER. Le volet Grille Centrale est
 * tenu durablement par `tests/grille-fiche-360-nowrite.test.js`, qui ouvre les quatre vrais
 * panneaux et mesure. Le volet Régie Car, lui, ne l'était pas :
 * `tests/regie-car-prephoto-readiness.test.js` éprouve les contrats, la forme des sources,
 * l'idempotence et le vol unique — tout au niveau du texte et des structures. Il n'ouvre
 * jamais la fiche 360, et ne mesure ni écriture, ni mutation HTTP, ni file de synchronisation.
 *
 * Or le défaut d'origine vivait précisément là : le panneau se réveille sur un
 * `MutationObserver` de `#app`, donc à CHAQUE fiche 360 insérée, et l'ensemencement qu'il
 * appelait alors produisait 974 PUT pour dix consultations de la même fiche.
 *
 * CE QUE CE FICHIER MESURE, ET COMMENT
 * -------------------------------------
 * Le VRAI point d'entrée exporté — `enhanceRegieCarPrephoto360(modal)` — sur de VRAIES
 * fiches d'équipement Régie Car. Aucune n'est fabriquée : le démarrage légitime de la
 * plateforme (`ensureRegieCarPrephotoReadiness`, qui appelle Phase 16) les pose lui-même,
 * et ce fichier consulte celles-là.
 *
 * Les deux chemins sont éprouvés :
 *   · l'appel direct au point d'entrée exporté ;
 *   · le chemin AUTOMATIQUE, en insérant une vraie `#ops-equipment-360` sous `#app` et en
 *     laissant le `MutationObserver` du module programmer l'enrichissement lui-même.
 *
 * L'ordonnanceur est CONTRÔLÉ : `queueMicrotask` et `setTimeout` sont capturés et vidés
 * explicitement. Aucune attente de 260 ms ni de 500 ms ne sert de preuve — la preuve est
 * que les rappels ont réellement été exécutés.
 *
 * DEUX ÉCUEILS QUE CE FICHIER ÉVITE
 * ----------------------------------
 *   1. Un rendu qui n'a pas lieu ne prouve rien. Le panneau se garde de se poser deux fois
 *      sur la MÊME modale (`dataset.regieCarPrephoto`). Dix ouvertures sur un même nœud
 *      seraient donc neuf non-opérations. Chaque ouverture construit une modale NEUVE, comme
 *      l'application, et l'on vérifie que la carte est réellement insérée et garnie.
 *   2. Une porte qui ne sait pas voir une écriture ne prouve rien non plus. Le démarrage
 *      légitime est mesuré avec LE MÊME instrument, et il doit écrire — sinon la mesure de
 *      la consultation ne veut rien dire.
 *
 * Aucune dépendance de développement : les deux chaînes installent `--omit=dev`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ═══════════════════ UN DOM MINIMAL, MAIS RÉEL ═══════════════════
 *
 * Le panneau cherche de vraies ancres — `.ops-modal-body`, un enfant direct en
 * `display:grid`, la carte de preuves terrain qui le précède. Un objet qui répondrait
 * `null` à tout ferait passer l'épreuve sans que rien ne soit rendu. Ces nœuds portent donc
 * une vraie arborescence et un `querySelector` qui sait résoudre EXACTEMENT les formes de
 * sélecteur que le module utilise — pas davantage.
 */
class Element {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.id = ''; this.className = ''; this.children = []; this.parentNode = null;
    this.dataset = {}; this.style = {}; this.attributes = {}; this._text = ''; this._html = '';
    this.classList = {
      add: (...noms) => { this.className = [...new Set([...String(this.className).split(/\s+/).filter(Boolean), ...noms])].join(' '); },
      remove: (...noms) => { this.className = String(this.className).split(/\s+/).filter(n => n && !noms.includes(n)).join(' '); },
      contains: nom => String(this.className).split(/\s+/).includes(nom)
    };
  }
  set innerHTML(valeur) { this._html = String(valeur); }
  get innerHTML() { return this._html; }
  set textContent(valeur) { this._text = String(valeur); }
  get textContent() { return this._text || this._html.replace(/<[^>]*>/g, ''); }
  setAttribute(nom, valeur) {
    this.attributes[nom] = String(valeur);
    if (nom === 'id') this.id = String(valeur);
    if (nom === 'style') this.style.cssText = String(valeur);
  }
  getAttribute(nom) { return this.attributes[nom] ?? (nom === 'style' ? (this.style.cssText ?? '') : null); }
  removeAttribute(nom) { delete this.attributes[nom]; }
  addEventListener() {} removeEventListener() {}
  appendChild(noeud) { noeud.parentNode = this; this.children.push(noeud); signaler(this, [noeud]); return noeud; }
  prepend(noeud) { noeud.parentNode = this; this.children.unshift(noeud); signaler(this, [noeud]); return noeud; }
  insertBefore(noeud, reference) {
    const index = this.children.indexOf(reference);
    noeud.parentNode = this;
    if (index < 0) this.children.push(noeud); else this.children.splice(index, 0, noeud);
    signaler(this, [noeud]); return noeud;
  }
  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.children = parent.children.filter(enfant => enfant !== this);
    this.parentNode = null;
  }
  get nextSibling() {
    const parent = this.parentNode;
    if (!parent) return null;
    return parent.children[parent.children.indexOf(this) + 1] ?? null;
  }
  get descendants() {
    const trouves = []; const pile = [...this.children];
    while (pile.length) { const noeud = pile.shift(); trouves.push(noeud); pile.unshift(...noeud.children); }
    return trouves;
  }
  matches(selecteur) { return correspond(this, selecteur); }
  querySelector(selecteur) { return this.querySelectorAll(selecteur)[0] ?? null; }
  querySelectorAll(selecteur) {
    const chaine = String(selecteur).split('>').map(part => part.trim()).filter(Boolean);
    let courant = this.descendants.filter(noeud => correspond(noeud, chaine[0]));
    for (const suivant of chaine.slice(1)) {
      courant = courant.flatMap(noeud => noeud.children.filter(enfant => correspond(enfant, suivant)));
    }
    return courant;
  }
}
globalThis.Element = Element;

/** `#id`, `.classe`, `balise`, `[attr*="valeur"]` — les seules formes que le module écrit. */
function correspond(noeud, selecteur) {
  for (const morceau of String(selecteur).trim().match(/(?:[#.]?[\w-]+|\[[^\]]+\])/g) || []) {
    if (morceau.startsWith('#')) { if (noeud.id !== morceau.slice(1)) return false; }
    else if (morceau.startsWith('.')) { if (!noeud.classList.contains(morceau.slice(1))) return false; }
    else if (morceau.startsWith('[')) {
      const parts = morceau.match(/\[([\w-]+)(\*?=)"([^"]*)"\]/);
      if (!parts) return false;
      const valeur = String(noeud.getAttribute(parts[1]) ?? '');
      if (parts[2] === '*=' ? !valeur.includes(parts[3]) : valeur !== parts[3]) return false;
    } else if (noeud.tagName !== morceau.toUpperCase()) return false;
  }
  return true;
}

/* Un MutationObserver qui observe VRAIMENT : sans lui, le chemin automatique du module —
 * celui par lequel le défaut d'origine se déclenchait — resterait hors mesure. */
const observateurs = [];
function signaler(cible, ajoutes) {
  for (const { hote, rappel, options } of observateurs) {
    if (hote === cible || (options?.subtree && hote.descendants.includes(cible))) {
      rappel([{ type: 'childList', target: cible, addedNodes: ajoutes }]);
    }
  }
}
globalThis.MutationObserver = class {
  constructor(rappel) { this.rappel = rappel; }
  observe(hote, options) { observateurs.push({ hote, rappel: this.rappel, options }); }
  disconnect() {}
};

/* L'ordonnanceur, sous contrôle. Le module programme son enrichissement par
 * `queueMicrotask` PUIS par `setTimeout(…, 260)` ; on exécute les deux explicitement au lieu
 * d'attendre une durée choisie au jugé. */
const microtaches = []; const minuteries = [];
globalThis.queueMicrotask = fonction => microtaches.push(fonction);
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fonction, delai = 0, ...reste) => {
  const jeton = { fonction, delai, reste, annule: false };
  minuteries.push(jeton);
  return jeton;
};
globalThis.clearTimeout = jeton => { if (jeton && typeof jeton === 'object') jeton.annule = true; };

/** Vide microtâches et minuteries jusqu'au silence, en laissant respirer les promesses. */
async function drainer() {
  for (let tour = 0; tour < 60; tour += 1) {
    for (const fonction of microtaches.splice(0)) { try { await fonction(); } catch { /* le module avale déjà */ } }
    for (const jeton of minuteries.splice(0)) {
      if (!jeton.annule) { try { await jeton.fonction(...jeton.reste); } catch { /* idem */ } }
    }
    await new Promise(resoudre => vraiSetTimeout(resoudre, 0));
    if (!microtaches.length && !minuteries.length) return;
  }
}

const app = new Element('div'); app.id = 'app';
const head = new Element('head'); const body = new Element('body');
body.appendChild(app);
globalThis.document = {
  createElement: balise => new Element(balise), head, body, documentElement: new Element('html'),
  getElementById: id => [head, body, ...body.descendants, ...head.descendants].find(noeud => noeud.id === id) ?? null,
  querySelector: selecteur => body.querySelector(selecteur),
  querySelectorAll: selecteur => body.querySelectorAll(selecteur),
  addEventListener() {}
};
const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) { if (!auditeurs.has(type)) auditeurs.set(type, []); auditeurs.get(type).push(fonction); },
  removeEventListener() {},
  dispatchEvent(evenement) { for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement); return true; }
};
/** `runEnsureRegieCarPrephotoReadiness` annonce sa fin sur `window` : on la compte. */
let cyclesDeVie = 0;
let identite = { id: 'u-technicien', username: 'technicien', role: 'technicien', authVersion: 1 };
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' && identite ? JSON.stringify(identite) : null),
  setItem() {}, removeItem() {}, clear() {}
};
globalThis.requestAnimationFrame = fonction => globalThis.setTimeout(fonction, 0);

/* ═══════════════════ LE MAGASIN, ET TOUTE ÉCRITURE TENTÉE ═══════════════════ */

const tables = new Map();
const table = nom => { if (!tables.has(nom)) tables.set(nom, new Map()); return tables.get(nom); };
/** Lire une taille SANS créer le magasin : sinon l'instrument déplace ce qu'il mesure. */
const taille = nom => tables.get(nom)?.size ?? 0;
/** Chaque écriture métier tentée, avec SON APPELANT : un producteur de fond ne se confond
 *  pas avec une consultation, et l'on refuse de masquer l'un derrière l'autre. */
const ecritures = [];
/*
 * LES MAGASINS TOUCHÉS, LECTURES COMPRISES — ET POURQUOI.
 *
 * Compter les écritures ne suffit pas. Éprouvé sur ce fichier même : en injectant
 * `await ensureRegieCarPrephotoReadiness()` dans le chemin de consultation — LE défaut
 * d'origine, mot pour mot — la porte restait VERTE. L'ensemencement est idempotent
 * aujourd'hui : sur une base déjà convergée il ne réécrit rien, donc il ne se voit pas.
 *
 * Il se verrait le jour où un seul champ varierait — un horodatage, une version, une entrée
 * de plus dans le plan — et l'on retrouverait les 974 PUT de #108. Une porte qui ne
 * l'attrape qu'à ce moment-là arrive trop tard.
 *
 * On mesure donc aussi CE QUE LA CONSULTATION TOUCHE. Le panneau lit une fiche
 * d'équipement et rend depuis une constante du module : il n'a aucune raison d'ouvrir
 * `docs`. L'ensemencement, lui, y lit et y écrit nécessairement. Le périmètre des magistres
 * touchés est donc le signal qui distingue les deux, idempotence ou pas.
 */
const magasinsTouches = [];
const CE_FICHIER = 'regie-car-fiche-360-nowrite.test.js';
const appelant = () => (new Error().stack || '').split('\n').slice(1).map(ligne => ligne.trim())
  .find(ligne => /\.js:\d+/.test(ligne) && !new RegExp(`${CE_FICHIER}|/db\\.js|node:internal`).test(ligne)) || '?';

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
db.isCentralSyncReady = () => true;
db.get = async (nom, id) => { magasinsTouches.push(nom); return table(nom).get(String(id)) ?? null; };
db._getRaw = db.get;
db.getAll = async nom => { magasinsTouches.push(nom); return [...table(nom).values()]; };
db.save = async (nom, enregistrement) => {
  magasinsTouches.push(nom);
  ecritures.push({ operation: 'save', store: nom, id: String(enregistrement?.id ?? ''), par: appelant() });
  const id = enregistrement?.id ?? `auto-${table(nom).size + 1}`;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => {
  ecritures.push({ operation: 'delete', store: nom, id: String(id), par: appelant() });
  table(nom).delete(String(id)); return true;
};
db.delete = db._deleteRaw;
db.clear = async nom => { ecritures.push({ operation: 'clear', store: nom, id: '', par: appelant() }); table(nom).clear(); };
db.normalizeKey = valeur => String(valeur);

/*
 * LE RELEVÉ ARRIVE PAR LA ROUTE AUTORISÉE, ET PAR ELLE SEULE (A-5).
 *
 * Il ne vit plus dans le module : celui-ci le demande à
 * `/api/operational/regie-car/inventory`, que le serveur n'accorde qu'après autorisation.
 * Cette épreuve simule donc une session QUI Y A DROIT — c'est la seule façon de vérifier
 * que la Fiche 360 reste enrichie pour un utilisateur légitime, et que cet enrichissement
 * n'écrit toujours rien.
 *
 * Toute autre URL reste en 404 : le module ne doit se procurer son relevé par aucun autre
 * chemin, et surtout pas par un repli local.
 */
const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
const JEU_AUTORISE = buildRegieCarDataset();

/** Chaque appel réseau, avec SA MÉTHODE : un compteur d'appels ne verrait pas un PUT. */
const http = [];
/** Qui a demandé le relevé protégé, et combien de fois : c'est ce qui prouve le regroupement. */
const appelsReleve = [];
/** Le serveur a-t-il révoqué ? Indépendant de l'identité et du contexte LOCAL. */
let revoqueParLeServeur = false;
globalThis.fetch = async (url, init = {}) => {
  const methode = String(init.method || 'GET').toUpperCase();
  http.push({ methode, url: String(url) });
  if (methode === 'GET' && String(url).includes('/api/operational/regie-car/inventory')) {
    /*
     * LE SERVEUR EST L'AUTORITÉ, Y COMPRIS DANS CETTE ÉPREUVE.
     *
     * Le double rendait 200 à qui demandait. Tant que le panneau se contentait de
     * `peek`, cela ne se voyait pas ; depuis qu'il REVALIDE à chaque ouverture, un double
     * qui accepte tout le monde ne prouve plus rien. Il refuse donc exactement ce que
     * `canReadRegieCarDataset` refuserait : une session hors périmètre.
     */
    appelsReleve.push(String(identite?.id || ''));
    if (revoqueParLeServeur || String(identite?.id || '') !== 'u-technicien') {
      return { ok: false, status: 403, json: async () => ({ error: 'REGIE_CAR_SCOPE_FORBIDDEN' }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({ dataset: JEU_AUTORISE }), text: async () => '' };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};
const mutationsHttp = () => http.filter(appel => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(appel.methode));

/* ═══════════════════ LE DÉMARRAGE LÉGITIME ═══════════════════
 *
 * L'import du module déclenche `installObserver()` puis `await ensureRegieCarPrephotoReadiness()`.
 * C'est le chemin EXPLICITE, et il a le droit d'écrire : c'est lui qui pose l'inventaire.
 * Le `await` de l'import ne rend la main qu'une fois ce démarrage terminé — la convergence
 * est donc structurelle, pas une attente choisie au jugé.
 */
globalThis.window.addEventListener('regie-car-prephoto-ready', () => { cyclesDeVie += 1; });
const module360 = await import('../regie-car-prephoto-readiness.js');
const { ensureRegieCarPrephotoReadiness, enhanceRegieCarPrephoto360, buildRegieCarCaptureTargets } = module360;
// Les cibles se construisent depuis le jeu autorisé : elles ne sont plus une constante que
// l'import matérialiserait sur un poste sans session.
const REGIE_CAR_CAPTURE_TARGETS = buildRegieCarCaptureTargets(JEU_AUTORISE);
await drainer();

const ECRITURES_DEMARRAGE = ecritures.map(entree => ({ ...entree }));

/** Les fiches que la plateforme a elle-même posées, et que le panneau sait enrichir. */
const AVEC_CAPTURES = new Set(REGIE_CAR_CAPTURE_TARGETS
  .filter(cible => cible.targetType === 'equipment').map(cible => String(cible.targetId)));
const FICHES_REELLES = [...table('equipments').values()].filter(fiche => AVEC_CAPTURES.has(String(fiche.id)));
/** Une fiche à trois captures (façade + étiquette + arrière) : le rendu y est le plus riche. */
const FICHE = FICHES_REELLES.find(fiche => fiche.id === 'regie-car-b1-sony-control') ?? FICHES_REELLES[0];

/** La modale telle que la plateforme la produit — c'est là que le panneau cherche ses ancres. */
function construireModale(equipment) {
  const modale = new Element('div');
  modale.id = 'ops-equipment-360';
  modale.dataset.equipmentId = String(equipment.id);
  const tete = new Element('div'); tete.className = 'ops-modal-head';
  const enveloppe = new Element('div'); const titre = new Element('div');
  titre.textContent = equipment.name || '';
  enveloppe.appendChild(titre); tete.appendChild(enveloppe); modale.appendChild(tete);
  const corps = new Element('div'); corps.className = 'ops-modal-body';
  const grille = new Element('div'); grille.setAttribute('style', 'display:grid;gap:12px');
  corps.appendChild(grille); modale.appendChild(corps);
  return modale;
}
const carteDe = modale => modale.querySelector('.regie-car-prephoto-card');

/** Une fenêtre de mesure : ce qui s'y écrit est imputable à ce qui s'y passe. */
/** Les seuls magasins qu'une consultation a une raison d'ouvrir. */
const MAGASINS_DE_CONSULTATION = new Set(['equipments']);

function ouvrirFenetre() {
  ecritures.length = 0; http.length = 0; magasinsTouches.length = 0; cyclesDeVie = 0;
  return {
    fileAvant: taille('syncQueue'),
    magasinsAvant: [...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort()
  };
}
function fermerFenetre(fenetre, etiquette) {
  assert.deepEqual(ecritures, [], `${etiquette} : aucune écriture métier — reçu ${JSON.stringify(ecritures.slice(0, 4))}`);
  assert.deepEqual(mutationsHttp(), [], `${etiquette} : aucune mutation HTTP`);
  assert.equal(taille('syncQueue') - fenetre.fileAvant, 0, `${etiquette} : la file de synchronisation ne bouge pas`);
  assert.deepEqual([...tables.keys()].map(nom => `${nom}:${table(nom).size}`).sort(), fenetre.magasinsAvant,
    `${etiquette} : les magasins métier sont inchangés`);
  assert.equal(cyclesDeVie, 0,
    `${etiquette} : la consultation ne relance PAS le cycle de vie d’ensemencement (reçu ${cyclesDeVie})`);
  const horsPerimetre = [...new Set(magasinsTouches)].filter(nom => !MAGASINS_DE_CONSULTATION.has(nom));
  assert.deepEqual(horsPerimetre, [],
    `${etiquette} : la consultation ne doit ouvrir que ${[...MAGASINS_DE_CONSULTATION].join(', ')} — reçu ${JSON.stringify(horsPerimetre)}`);
}

/* ═══════════════════ LE DISCRIMINANT POSITIF ═══════════════════ */

test('#165 Régie Car · l’instrument SAIT voir une écriture — le démarrage explicite en produit', () => {
  /*
   * Sans cette épreuve, un zéro plus bas ne voudrait rien dire : une porte incapable de
   * détecter une persistance passerait même si la consultation ensemençait.
   */
  assert.ok(ECRITURES_DEMARRAGE.length > 50,
    `le démarrage légitime doit écrire, et être VU — reçu ${ECRITURES_DEMARRAGE.length}`);
  const parAppelant = new Set(ECRITURES_DEMARRAGE.map(entree => entree.par));
  assert.ok([...parAppelant].some(ligne => /ensureAdditionalEquipment|ensureManufacturerSources|ensureCapturePlan/.test(ligne)),
    'les écritures du cycle de vie Régie Car doivent être attribuées nommément');
  assert.ok(ECRITURES_DEMARRAGE.some(entree => entree.store === 'equipments'),
    'le démarrage pose bien des équipements');
});

test('#165 Régie Car · le démarrage RÉÉCRIT quand la donnée manque — mesuré au moment de la mesure', async () => {
  /*
   * Le discriminant ci-dessus porte sur le tout premier démarrage. Celui-ci le refait
   * MAINTENANT, avec l'instrument dans l'état exact où la consultation sera mesurée :
   * on retire une fiche posée par le cycle de vie, et le cycle de vie doit la reposer.
   */
  const planRetire = table('docs').get('field-capture-plan:regie-car');
  assert.ok(planRetire, 'le plan de collecte doit exister après le démarrage');
  table('docs').delete('field-capture-plan:regie-car');

  ecritures.length = 0;
  await ensureRegieCarPrephotoReadiness();
  await drainer();

  assert.ok(ecritures.length > 0, 'le chemin d’ensemencement DOIT écrire — sinon la mesure ne discrimine rien');
  assert.ok(table('docs').has('field-capture-plan:regie-car'), 'et il repose bien ce qui manquait');
});

/* ═══════════════════ LA CONSULTATION ═══════════════════ */

test('#165 Régie Car · la PREMIÈRE consultation rend, et n’écrit rien', async () => {
  /*
   * Le contrat porte sur la première ouverture, pas seulement sur les suivantes : une porte
   * que neuf ouvertures préalables auraient « réchauffée » ne prouverait pas grand-chose.
   */
  await drainer();
  const fenetre = ouvrirFenetre();

  const modale = construireModale(FICHE);
  const rendu = await enhanceRegieCarPrephoto360(modale);
  await drainer();

  assert.equal(rendu, true, 'le VRAI point d’entrée doit rendre sur une fiche Régie Car réelle');
  const carte = carteDe(modale);
  assert.ok(carte, 'la carte Régie Car doit être réellement insérée dans la modale');
  assert.ok(carte.innerHTML.length > 400, `la carte doit être GARNIE — reçu ${carte.innerHTML.length} caractères`);
  assert.match(carte.innerHTML, /Régie Car — collecte terrain suivante/);
  fermerFenetre(fenetre, 'première consultation');
});

test('#165 Régie Car · dix ouvertures par le CHEMIN AUTOMATIQUE : 0 écriture, 10 rendus', async () => {
  /*
   * C'est le chemin du défaut d'origine : le `MutationObserver` du module réagit à
   * l'insertion de `#ops-equipment-360` sous `#app` et programme lui-même l'enrichissement.
   * Une épreuve qui n'appellerait que la fonction exportée laisserait ce chemin hors mesure.
   *
   * Chaque ouverture construit une modale NEUVE : le panneau refuse de se poser deux fois
   * sur le même nœud, dix ouvertures sur un seul nœud seraient donc neuf non-opérations.
   */
  await drainer();
  const fenetre = ouvrirFenetre();

  const rendus = [];
  for (let ouverture = 1; ouverture <= 10; ouverture += 1) {
    const modale = construireModale(FICHE);
    app.appendChild(modale);          // ← l'observateur du module fait le reste
    await drainer();
    const carte = carteDe(modale);
    rendus.push({ ouverture, marque: modale.dataset.regieCarPrephoto === '1', garnie: Boolean(carte) && carte.innerHTML.length > 400 });
    modale.remove();                  // ← fermeture
    await drainer();
  }

  assert.equal(rendus.filter(essai => essai.marque).length, 10, `les dix ouvertures doivent rendre — reçu ${JSON.stringify(rendus)}`);
  assert.equal(rendus.filter(essai => essai.garnie).length, 10, 'et rendre une carte GARNIE, pas une coquille');
  fermerFenetre(fenetre, 'dix ouvertures automatiques');
});

test('#165 Régie Car · fermer puis rouvrir : les ouvertures suivantes restent non mutantes', async () => {
  await drainer();
  const fenetre = ouvrirFenetre();

  const premiere = construireModale(FICHE);
  app.appendChild(premiere);
  await drainer();
  assert.ok(carteDe(premiere), 'la première ouverture rend');
  premiere.remove();
  await drainer();

  for (let reouverture = 0; reouverture < 3; reouverture += 1) {
    const modale = construireModale(FICHE);
    app.appendChild(modale);
    await drainer();
    assert.ok(carteDe(modale), `la réouverture ${reouverture + 1} rend encore`);
    modale.remove();
    await drainer();
  }
  fermerFenetre(fenetre, 'fermer/rouvrir');
});

test('#165 Régie Car · une seconde passe sur la MÊME modale ne pose pas de doublon', async () => {
  await drainer();
  const fenetre = ouvrirFenetre();

  const modale = construireModale(FICHE);
  assert.equal(await enhanceRegieCarPrephoto360(modale), true);
  assert.equal(await enhanceRegieCarPrephoto360(modale), false, 'la garde du module doit tenir');
  await drainer();

  assert.equal(modale.querySelectorAll('.regie-car-prephoto-card').length, 1, 'une seule carte, jamais deux');
  fermerFenetre(fenetre, 'seconde passe');
});

test('#165 Régie Car · plusieurs fiches réelles consultées à la suite : rien n’est écrit', async () => {
  await drainer();
  const fenetre = ouvrirFenetre();

  const echantillon = FICHES_REELLES.slice(0, 8);
  assert.ok(echantillon.length >= 5, 'le démarrage doit fournir assez de fiches réelles');
  for (const fiche of echantillon) {
    const modale = construireModale(fiche);
    app.appendChild(modale);
    await drainer();
    assert.ok(carteDe(modale), `« ${fiche.id} » doit rendre`);
    modale.remove();
    await drainer();
  }
  fermerFenetre(fenetre, 'plusieurs fiches');
});

/* ═══════════════════ CE QUI FERME, ET NE MUTE PAS DAVANTAGE ═══════════════════ */

test('#165 Régie Car · les refus du panneau ne rendent rien ET n’écrivent rien', async () => {
  await drainer();
  const fenetre = ouvrirFenetre();

  const horsRegie = { id: 'equipement-hors-regie', name: 'Écran mur STC', roomId: 'room-stc' };
  table('equipments').set(horsRegie.id, horsRegie);

  const cas = [
    ['équipement inconnu du magasin', construireModale({ id: 'fiche-inexistante', name: 'Rien' })],
    ['équipement hors Régie Car', construireModale(horsRegie)],
    ['modale sans corps', (() => { const m = new Element('div'); m.id = 'ops-equipment-360'; m.dataset.equipmentId = String(FICHE.id); return m; })()]
  ];
  for (const [nom, modale] of cas) {
    assert.equal(await enhanceRegieCarPrephoto360(modale), false, `« ${nom} » doit fermer`);
    assert.equal(carteDe(modale), null, `« ${nom} » ne doit rien rendre`);
  }
  await drainer();

  // La fiche témoin ajoutée ci-dessus est le seul changement attendu de cette fenêtre.
  assert.deepEqual(ecritures, [], 'un refus n’écrit rien');
  assert.deepEqual(mutationsHttp(), [], 'un refus ne mute rien par HTTP');
  assert.equal(taille('syncQueue') - fenetre.fileAvant, 0, 'un refus ne fait pas grossir la file');
  table('equipments').delete(horsRegie.id);
});

test('#165 Régie Car · portée restreinte : ce que la session ne voit pas ne se rend pas, et n’écrit rien', async () => {
  /*
   * LA PORTÉE EST CELLE DU SERVEUR, PAS UN MODÈLE INVENTÉ POUR L'ÉPREUVE.
   *
   * `/api/sync` filtre CHAQUE enregistrement par `access.canAccessRecord(user, store, …)`
   * (`scripts/serve.js`). Le magasin local d'un rôle à périmètre ne contient donc pas les
   * équipements hors de sa zone — et c'est exactement cette situation qui est reproduite
   * ici, en interrogeant le VRAI contrôle d'accès du dépôt pour savoir ce qui serait livré.
   *
   * Le panneau Régie Car ne porte aucun jeu de données protégé — il rend le plan de collecte
   * que la plateforme déclare elle-même. Ce qui est éprouvé est donc la propriété qui le
   * concerne : il n'élargit rien. Ce que la session n'a pas reçu, il ne l'invente pas.
   */
  const { createAccessControl } = await import('../scripts/access-control.js');

  const salle = { id: 'room-regie-car', name: 'Régie Car' };
  const baie = { id: 'regie-car-b1', name: 'Baie 1', roomId: salle.id };
  const magasins = {
    equipments: [FICHE], rooms: [salle], baies: [baie],
    zones: [{ id: 'zone-regie', name: 'Régie' }, { id: 'zone-autre', name: 'Autre' }],
    resource_zones: [{ id: 'rz', resourceType: 'room', resourceId: salle.id, zoneId: 'zone-regie' }],
    zone_memberships: [], zone_grants: []
  };
  const pool = { query: async (sql, parametres = []) => {
    const lignes = (magasins[String(parametres[0])] || []).map(data => ({ record_id: String(data.id), data, updated_at: new Date() }));
    return { rows: parametres.length > 1 ? lignes.filter(ligne => ligne.record_id === String(parametres[1])) : lignes };
  } };
  const acces = createAccessControl(pool);

  const restreint = { id: 'u-restreint', role: 'technicien' };
  const autorise = await acces.canAccessRecord(restreint, 'equipments', FICHE, 'read');
  assert.equal(autorise, false,
    'sans habilitation sur la zone, le serveur ne livrerait PAS cette fiche — c’est la prémisse de l’épreuve');

  await drainer();
  const fenetre = ouvrirFenetre();

  // Le magasin d'une telle session : la fiche n'y est pas.
  const sauvegarde = table('equipments').get(String(FICHE.id));
  table('equipments').delete(String(FICHE.id));
  identite = { id: 'u-restreint', username: 'restreint', role: 'technicien', authVersion: 1 };

  const modale = construireModale(FICHE);
  app.appendChild(modale);
  await drainer();

  assert.equal(carteDe(modale), null, 'sans la fiche, le panneau ne rend rien');
  assert.notEqual(modale.dataset.regieCarPrephoto, '1', 'et il ne se marque pas comme rendu');
  assert.deepEqual(ecritures, [], 'une consultation refusée n’écrit rien');
  assert.deepEqual(mutationsHttp(), [], 'ni ne mute par HTTP');
  assert.equal(taille('syncQueue') - fenetre.fileAvant, 0, 'ni ne fait grossir la file');
  modale.remove();

  /*
   * MÊME AVEC LA FICHE, LA SESSION RESTREINTE NE REND TOUJOURS RIEN (A-5).
   *
   * Avant ce lot, le plan de collecte était une constante publique : détenir la fiche
   * suffisait à le faire rendre, quelle que soit la portée. Il est désormais protégé lui
   * aussi, et la mémoire du relevé suit le contexte d'autorisation — une portée qui ne l'a
   * jamais obtenu n'a rien à peindre. C'est plus fermé qu'avant, et c'est voulu.
   */
  table('equipments').set(String(FICHE.id), sauvegarde);
  const encoreRestreinte = construireModale(FICHE);
  app.appendChild(encoreRestreinte);
  await drainer();
  assert.equal(carteDe(encoreRestreinte), null,
    'la fiche ne suffit pas : le plan de collecte est protégé lui aussi');
  assert.deepEqual(ecritures, [], 'et cette consultation n’écrit toujours rien');
  encoreRestreinte.remove();
  await drainer();

  // La session LÉGITIME, elle, consulte normalement : c'est sa portée qui porte le relevé.
  identite = { id: 'u-technicien', username: 'technicien', role: 'technicien', authVersion: 1 };
  const permise = construireModale(FICHE);
  app.appendChild(permise);
  await drainer();
  assert.ok(carteDe(permise), 'la consultation autorisée rend');
  permise.remove();
  await drainer();
  fermerFenetre(fenetre, 'portée restreinte');
});

/* ═══════════════════ CE QUE LE PANNEAU N'A PAS LE DROIT DE CRÉER ═══════════════════ */

test('#165 Régie Car · la consultation ne crée ni port, ni câble, ni topologie, ni crosspoint', async () => {
  await drainer();
  const fenetre = ouvrirFenetre();
  const interdits = ['ports', 'cables', 'relations', 'topology', 'crosspoints'];
  const avant = Object.fromEntries(interdits.map(nom => [nom, taille(nom)]));

  for (const fiche of FICHES_REELLES.slice(0, 5)) {
    const modale = construireModale(fiche);
    app.appendChild(modale);
    await drainer();
    modale.remove();
    await drainer();
  }

  for (const nom of interdits) {
    assert.equal(taille(nom), avant[nom], `« ${nom} » ne doit rien recevoir d’une consultation`);
  }
  fermerFenetre(fenetre, 'aucune création spéculative');
});

/* ═══════════════ A-5 · L'AUTORITÉ N'EST JAMAIS CELLE D'HIER ═══════════════ */

test('A-5 · une révocation SERVEUR ferme la fiche AVANT que le contexte local ne bouge', async () => {
  /*
   * MESURÉ sur `d56dcf3` : le panneau lisait `peekRegieCarDataset()`. La mémoire du
   * transport suit la portée d'accès, mais cette portée ne change qu'au prochain instantané
   * de `central-sync` — il existait donc une fenêtre, entre la révocation côté serveur et la
   * réécriture locale de `zone-access-context`, pendant laquelle une NOUVELLE fiche 360
   * rendait encore les cibles protégées.
   *
   * L'épreuve reproduit exactement cela : le serveur refuse, l'identité et le contexte local
   * ne bougent PAS, et une fiche neuve s'ouvre.
   */
  const fenetre = ouvrirFenetre();

  // 1 · une ouverture légitime : le relevé est en mémoire, la fiche rend.
  const avant = construireModale(FICHE);
  app.appendChild(avant);
  await drainer();
  assert.ok(carteDe(avant), 'prémisse : la session autorisée rend bien');
  avant.remove();
  await drainer();

  // 2 · le serveur RÉVOQUE. Ni `identite`, ni `zone-access-context` ne changent.
  const identiteAvant = identite;
  revoqueParLeServeur = true;
  assert.equal(identite, identiteAvant, 'l’identité locale est inchangée — c’est la prémisse');

  // 3 · une fiche NEUVE : elle doit redemander, et se taire.
  const apres = construireModale(FICHE);
  app.appendChild(apres);
  await drainer();
  assert.equal(carteDe(apres), null,
    'une autorité révoquée ne doit plus rien rendre, même avec le relevé encore en mémoire');
  assert.deepEqual(ecritures, [], 'et un refus n’écrit rien');
  assert.deepEqual(mutationsHttp(), [], 'ni ne mute par HTTP');
  apres.remove();
  await drainer();

  revoqueParLeServeur = false;
  fermerFenetre(fenetre, 'révocation serveur');
});

test('A-5 · une MÊME fiche ne martèle pas la route protégée', async () => {
  /*
   * Le panneau se réveille sur un `MutationObserver` de `#app` : sans regroupement, une
   * seule fiche produirait autant de requêtes que de tentatives d'enrichissement. Le jeton
   * d'ouverture est posé sur l'ÉLÉMENT, pas sur une horloge — une fenêtre de temps avait
   * déjà été mesurée insuffisante pour la Grille Centrale.
   */
  const fenetre = ouvrirFenetre();
  appelsReleve.length = 0;

  const modale = construireModale(FICHE);
  app.appendChild(modale);
  await drainer();
  // Plusieurs tentatives sur LA MÊME modale, comme l'observateur en provoque.
  await enhanceRegieCarPrephoto360(modale);
  await enhanceRegieCarPrephoto360(modale);
  await drainer();
  const memeFiche = appelsReleve.length;
  assert.equal(memeFiche, 1, `une même fiche = une décision (obtenu ${memeFiche})`);
  modale.remove();
  await drainer();

  // Une fiche SUIVANTE est une autre ouverture : le serveur redécide.
  const suivante = construireModale(FICHE);
  app.appendChild(suivante);
  await drainer();
  assert.equal(appelsReleve.length, 2, 'une nouvelle fiche redemande au serveur');
  suivante.remove();
  await drainer();

  fermerFenetre(fenetre, 'regroupement par ouverture');
});
