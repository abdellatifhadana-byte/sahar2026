/**
 * @file tests/concurrence-client-conflit.test.js
 *
 * CE QUE CE FICHIER PROTÈGE
 * -------------------------
 * Le serveur refuse désormais une écriture fondée sur une version périmée (409, code
 * `STALE_WRITE`). Ce refus ne vaut que s'il arrive intact jusqu'à l'écran :
 *
 *   1. la copie locale doit REVENIR à ce qu'elle était — sinon le navigateur continue
 *      d'afficher une modification que le serveur n'a jamais acceptée ;
 *   2. le refus doit se NOMMER comme un conflit de version, pas comme une panne ni comme
 *      un rejet d'autorisation — trois causes, trois gestes différents pour l'utilisateur ;
 *   3. une opération mise en attente hors ligne, rejouée contre une version plus récente,
 *      doit être refusée SANS bloquer les autres, et sans jamais être comptée comme réussie.
 *
 * MÉTHODE
 * -------
 * Ces tests EXÉCUTENT `central-sync.js`. Aucune assertion ne porte sur le texte du source :
 * l'environnement de navigateur est simulé (fenêtre, stockage, base locale, `fetch`), puis
 * le vrai chemin d'écriture est parcouru — `db.save`, `db._deleteRaw`, `db.processSyncQueue`.
 * Une règle qu'un test ne peut pas exécuter n'est pas une règle vérifiée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVISION_ERRORS, STALE_WRITE_MESSAGE, DELETED_ELSEWHERE_MESSAGE,
  ALREADY_EXISTS_MESSAGE, staleWriteResponse
} from '../revision-contract.js';

/* ------------------------------------------------------------------ */
/* Environnement de navigateur minimal, installé AVANT l'import testé. */
/* ------------------------------------------------------------------ */

const statuts = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener() {},
  dispatchEvent(evenement) {
    if (evenement.type === 'central-sync-status') statuts.push(evenement.detail);
    return true;
  }
};
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };

const stockage = new Map([['auth', '{"id":1,"username":"chef"}']]);
globalThis.localStorage = {
  getItem: cle => (stockage.has(cle) ? stockage.get(cle) : null),
  setItem: (cle, valeur) => { stockage.set(cle, String(valeur)); },
  removeItem: cle => { stockage.delete(cle); }
};

// Base locale en mémoire. Elle remplace IndexedDB et doit être installée avant l'import de
// `central-sync.js`, qui capture `db.save` / `db._deleteRaw` / `db.open` au chargement.
const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};
let compteur = 0;

const { db } = await import('../db.js');
db.open = async () => ({});

/*
 * UNE TRANSACTION, PARCE QUE LA FILE EN DÉPEND MAINTENANT.
 *
 * Le rejeu ne se contente plus de lire la file puis d'écrire : il RÉCLAME chaque entrée —
 * lecture et marquage dans une seule transaction `readwrite` — et c'est cette indivisibilité
 * qui empêche deux reprises d'envoyer la même opération. Une base simulée qui ne l'offrirait
 * pas ne pourrait pas exécuter le chemin réel, et les épreuves ci-dessous cesseraient de
 * prouver quoi que ce soit.
 *
 * Les requêtes se règlent en micro-tâches, comme IndexedDB : une requête émise depuis le
 * succès d'une autre prolonge la transaction, qui ne s'achève que lorsqu'il n'en reste aucune.
 */
const transactionSimulee = nom => {
  const magasin = table(nom);
  const transaction = { oncomplete: null, onerror: null, onabort: null };
  let enCours = 0;
  let achevee = false;
  const acheve = () => {
    if (achevee || enCours > 0) return;
    achevee = true;
    queueMicrotask(() => transaction.oncomplete?.());
  };
  const emettre = executer => {
    const requete = { result: undefined, error: null, onsuccess: null, onerror: null };
    enCours += 1;
    queueMicrotask(() => {
      try { requete.result = executer(); requete.onsuccess?.(); }
      catch (erreur) { requete.error = erreur; requete.onerror?.(); }
      finally { enCours -= 1; acheve(); }
    });
    return requete;
  };
  transaction.objectStore = () => ({
    get: id => emettre(() => magasin.get(String(id)) ?? undefined),
    put: enregistrement => emettre(() => {
      const id = enregistrement?.id === '' || enregistrement?.id == null ? ++compteur : enregistrement.id;
      magasin.set(String(id), { ...enregistrement, id });
      return id;
    }),
    delete: id => emettre(() => { magasin.delete(String(id)); return undefined; })
  });
  return transaction;
};

/*
 * `objectStoreNames.contains` ne répond vrai que pour `syncQueue` : l'application d'un
 * instantané n'est pas l'objet de ce fichier, et la laisser s'exécuter écraserait la base de
 * test à chaque cycle. La file, elle, doit exister — c'est elle qu'on éprouve.
 */
db.db = {
  objectStoreNames: { contains: nom => nom === 'syncQueue' },
  transaction: nom => transactionSimulee(nom)
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  const id = enregistrement?.id === '' || enregistrement?.id == null ? ++compteur : enregistrement.id;
  table(nom).set(String(id), { ...enregistrement, id });
  return id;
};
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };

/* --------------------------- Serveur simulé --------------------------- */

let repondeur = () => { throw new Error('aucune réponse programmée'); };
const appels = [];
globalThis.fetch = async (chemin, options = {}) => {
  appels.push({ chemin, methode: options.method || 'GET', corps: options.body ? JSON.parse(options.body) : null });
  return repondeur(chemin, options);
};

const reponse = (status, corps) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (corps === undefined ? '' : JSON.stringify(corps))
});

// L'intervalle de vingt secondes n'est pas l'objet du test et retiendrait Node indéfiniment.
const vraiSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
await import('../central-sync.js');
globalThis.setInterval = vraiSetInterval;

/* --------- Amorçage : c'est lui qui met la synchronisation « en ligne ». --------- */

repondeur = chemin => {
  if (chemin === '/api/sync') {
    return reponse(200, { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z' });
  }
  throw new Error(`chemin inattendu à l'amorçage : ${chemin}`);
};
const amorcage = await db.enableCentralSync();
assert.equal(amorcage.enabled, true, 'l’amorçage doit réussir, sinon aucun test en ligne n’a de sens');
assert.equal(db.isCentralSyncReady(), true);

/* ------------------------------ Utilitaires ------------------------------ */

function reinitialiser() {
  magasins.clear();
  statuts.length = 0;
  appels.length = 0;
}

/** Le refus que renvoie réellement le serveur, construit par le contrat lui-même. */
const refus = (code, revisionCourante) => reponse(409, staleWriteResponse(code, revisionCourante, { store: 'rooms', id: 'r-1' }));

const dernierStatut = () => statuts[statuts.length - 1];
const fileAttente = async () => db.getAll('syncQueue');

/** La révision déclarée dans l'URL d'une suppression, ou `null` si elle n'en déclare aucune. */
function revisionDemandee(chemin) {
  const brute = new URL(chemin, 'http://local').searchParams.get('expectedRevision');
  return brute === null || brute === '' ? null : Number(brute);
}

/** Les seuls appels qui écrivent : ce sont eux qu'une entrée terminale ne doit plus produire. */
const appelsEcrivains = () => appels.filter(appel => ['PUT', 'DELETE'].includes(appel.methode));

/* =========================== 1. ÉCRITURE EN LIGNE =========================== */

test('CONF·1 — un refus de version ramène la copie locale à la version du serveur', async () => {
  reinitialiser();
  // La salle telle qu'elle est réellement enregistrée avant la saisie concurrente.
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4, x: 10, y: 20 });

  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 7);
  await assert.rejects(
    () => db.save('rooms', { id: 'r-1', name: 'Régie A renommée', _revision: 4, x: 10, y: 20 }),
    error => error.status === 409
  );

  const local = await db._getRaw('rooms', 'r-1');
  assert.equal(local.name, 'Régie A',
    'le nom refusé par le serveur ne doit pas rester affiché comme s’il avait été accepté');
  assert.equal(local._revision, 4, 'la révision locale ne doit pas avancer sur un refus');
});

test('CONF·2 — le refus est rangé dans la file avec l’état « conflict », pas « failed »', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 7);
  await assert.rejects(() => db.save('rooms', { id: 'r-1', name: 'Autre', _revision: 4 }));

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'conflict');
  assert.equal(entree.lastErrorCode, REVISION_ERRORS.STALE_WRITE);
  assert.equal(entree.currentRevision, 7,
    'la révision courante du serveur doit être conservée : c’est elle qui permet de se resituer');
  assert.equal(entree.data.name, 'Autre',
    'la saisie de l’utilisateur doit survivre au refus, sinon son travail est perdu sans trace');
});

test('CONF·3 — l’écran reçoit la phrase française, jamais un « 409 » nu', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 7);
  await assert.rejects(() => db.save('rooms', { id: 'r-1', name: 'Autre', _revision: 4 }));

  const statut = dernierStatut();
  assert.equal(statut.state, 'conflict');
  assert.equal(statut.message, STALE_WRITE_MESSAGE);
  assert.doesNotMatch(statut.message, /409/, 'un code HTTP n’est pas un message d’utilisateur');
  assert.doesNotMatch(statut.message, /refus[ée]e? par le serveur/i,
    'un conflit de version est une protection, pas une panne : le vocabulaire doit les distinguer');
});

test('CONF·4 — un refus d’AUTORISATION ne se déguise pas en conflit de version', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  // 403 sans code de conflit : l'utilisateur n'a pas le droit, ce n'est pas une question de version.
  repondeur = () => reponse(403, { error: 'FORBIDDEN', message: 'Accès refusé à cette zone.' });
  await assert.rejects(() => db.save('rooms', { id: 'r-1', name: 'Autre', _revision: 4 }));

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'failed', 'un refus d’autorisation ne se rejoue pas : il est isolé');
  assert.notEqual(dernierStatut().state, 'conflict');
  assert.notEqual(dernierStatut().message, STALE_WRITE_MESSAGE,
    'proposer « rechargez puis réenregistrez » à qui n’a pas le droit d’écrire serait un mensonge');
  // La priorité d'autorisation tient aussi côté client : rien ne doit fuir de l'état serveur.
  // `?? null` parce que l'absence du champ et sa valeur nulle disent la même chose ici —
  // la garde porte sur ce qui est retenu, pas sur la forme sous laquelle ce vide est écrit.
  assert.equal(entree.currentRevision ?? null, null,
    'un 403 ne doit divulguer aucune révision : l’autorisation passe avant l’état');
});

test('CONF·5 — une suppression refusée pour version périmée rend la fiche à l’écran', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 9);
  await assert.rejects(() => db._deleteRaw('rooms', 'r-1'), error => error.status === 409);

  const local = await db._getRaw('rooms', 'r-1');
  assert.ok(local, 'une suppression que le serveur refuse ne doit pas laisser un vide dans le navigateur');
  assert.equal(local.name, 'Régie A');
  assert.equal(dernierStatut().message, STALE_WRITE_MESSAGE);
});

/*
 * CE QUE CONF·5 NE PROUVAIT PAS.
 *
 * Il programmait le serveur simulé pour répondre 409 — et vérifiait ensuite que le client
 * réagissait bien. Mais un serveur qui répond 409 « parce qu'on le lui a dit » ne prouve
 * rien du client : le vrai serveur ne refuse une suppression QUE si on lui déclare une
 * révision. Tant que le navigateur n'en envoie aucune, le serveur traite la suppression
 * comme délibérée et l'applique — et CONF·5 resterait vert pendant que la donnée récente
 * d'un autre disparaît.
 *
 * Ce qui suit inspecte donc la REQUÊTE ÉMISE, pas la réponse mise en scène.
 */

test('CONF·5b — la suppression EMPORTE la révision que l’écran avait sous les yeux', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  repondeur = () => reponse(200, { ok: true });
  await db._deleteRaw('rooms', 'r-1');

  const envoi = appels.find(appel => appel.methode === 'DELETE');
  assert.ok(envoi, 'aucune suppression n’a été émise');
  assert.equal(revisionDemandee(envoi.chemin), 4,
    'la suppression est partie à l’aveugle : le serveur la prendra pour délibérée et effacera '
    + 'ce qu’un autre vient d’écrire');
});

test('CONF·5c — une fiche HÉRITÉE déclare bien la révision 0, elle ne se tait pas', async () => {
  /*
   * Un enregistrement hérité vaut la révision 0 : c'est une valeur, pas une absence. La
   * taire reviendrait à demander une suppression inconditionnelle, et le serveur
   * l'appliquerait — y compris si quelqu'un vient de modifier la fiche, ce qui l'aurait fait
   * passer à 1 et rend justement le refus nécessaire.
   *
   * « Paramètre oublié = suppression forcée » est un piège : la seule convention sûre est
   * que l'écran déclare TOUJOURS ce qu'il a vu.
   */
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-legacy', name: 'Héritée' });
  repondeur = () => reponse(200, { ok: true });
  await db._deleteRaw('rooms', 'r-legacy');

  const envoi = appels.find(appel => appel.methode === 'DELETE');
  assert.ok(envoi);
  assert.equal(revisionDemandee(envoi.chemin), 0,
    'une fiche héritée a bien été VUE : sa révision 0 doit être déclarée');
});

test('CONF·5d — ce qu’on n’a jamais lu ne donne lieu à aucune déclaration', async () => {
  // On ne peut déclarer que ce qu'on a observé. Une fiche absente du navigateur n'a jamais
  // été lue : inventer « révision 0 » serait affirmer un état qu'on ignore.
  reinitialiser();
  repondeur = () => reponse(200, { ok: true });
  await db._deleteRaw('rooms', 'r-jamais-lue');

  const envoi = appels.find(appel => appel.methode === 'DELETE');
  assert.ok(envoi);
  assert.equal(revisionDemandee(envoi.chemin), null,
    'aucune révision ne peut être déclarée sur une fiche qu’on n’a pas lue');
});

test('CONF·6 — les trois codes du contrat sont tous traités comme des conflits', async () => {
  for (const [code, phrase] of [
    [REVISION_ERRORS.STALE_WRITE, STALE_WRITE_MESSAGE],
    [REVISION_ERRORS.DELETED_ELSEWHERE, DELETED_ELSEWHERE_MESSAGE],
    [REVISION_ERRORS.ALREADY_EXISTS, ALREADY_EXISTS_MESSAGE]
  ]) {
    reinitialiser();
    await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
    repondeur = () => reponse(409, staleWriteResponse(code, 7));
    await assert.rejects(() => db.save('rooms', { id: 'r-1', name: 'Autre', _revision: 4 }));

    const [entree] = await fileAttente();
    assert.equal(entree.status, 'conflict', `${code} doit être reconnu comme un conflit`);
    assert.equal(dernierStatut().state, 'conflict');
    assert.ok(phrase.length > 0);
    assert.equal((await db._getRaw('rooms', 'r-1')).name, 'Régie A', `${code} doit aussi ramener la copie locale`);
  }
});

/* ================= 2. ÉCRITURE MISE EN ATTENTE HORS LIGNE ================= */

/** Met une opération en attente comme le ferait une coupure réseau réelle. */
async function mettreEnAttente(storeName, enregistrement) {
  const panne = () => { throw new Error('réseau indisponible'); };
  const precedent = repondeur;
  repondeur = panne;
  try { await db.save(storeName, enregistrement); } finally { repondeur = precedent; }
}

test('CONF·7 — une écriture hors ligne rejouée contre une version plus récente est refusée, pas appliquée', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });

  const [avant] = await fileAttente();
  assert.equal(avant.status, 'pending', 'la coupure réseau doit produire une opération en attente, pas un échec');

  // Le serveur a avancé pendant la coupure : la file rejoue une version périmée.
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 11);
  const bilan = await db.processSyncQueue();

  const [apres] = await fileAttente();
  assert.equal(apres.status, 'conflict');
  assert.equal(apres.currentRevision, 11);
  assert.equal(bilan.processed, 0, 'un conflit ne doit jamais être compté comme une réussite');
  assert.equal(bilan.failed, 1);
  assert.equal(dernierStatut().message, STALE_WRITE_MESSAGE);
});

test('CONF·8 — un conflit n’arrête pas la file : les autres opérations partent quand même', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await db.saveLocalOnly('notes', { id: 'n-1', text: 'ancienne', _revision: 2 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });
  await mettreEnAttente('notes', { id: 'n-1', text: 'note hors ligne', _revision: 2 });
  assert.equal((await fileAttente()).length, 2);

  // La salle est en conflit ; la note, elle, n'a rien à voir et doit passer.
  repondeur = chemin => (chemin.includes('/rooms/')
    ? refus(REVISION_ERRORS.STALE_WRITE, 11)
    : reponse(200, { ok: true, _revision: 3 }));
  const bilan = await db.processSyncQueue();

  assert.equal(bilan.processed, 1, 'la note devait être envoyée malgré le conflit sur la salle');
  assert.equal(bilan.failed, 1);
  const restantes = await fileAttente();
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].storeName, 'rooms');
  assert.equal(restantes[0].status, 'conflict');
});

test('CONF·9 — une panne serveur reste « pending » et arrête la file : ce n’est pas un conflit', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });

  repondeur = () => reponse(500, { message: 'Erreur interne' });
  const bilan = await db.processSyncQueue();

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'pending', 'une panne se retente ; un conflit non');
  assert.notEqual(entree.status, 'conflict');
  assert.equal(bilan.failed, 0);
  assert.equal(dernierStatut().state, 'offline');
});

test('CONF·10 — la file rejouée ne renvoie jamais une opération sans sa révision', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });

  repondeur = () => reponse(200, { ok: true, _revision: 5 });
  await db.processSyncQueue();

  const envoi = appels.find(appel => appel.methode === 'PUT' && appel.chemin.includes('/rooms/'));
  assert.ok(envoi, 'la file doit bien avoir émis un PUT');
  assert.equal(envoi.corps._revision, 4,
    'le paquet rejoué doit porter la révision de la saisie — c’est elle que le serveur compare');
});

/* ============= 3. UN CONFLIT EST TERMINAL : PLUS AUCUN APPEL AUTOMATIQUE ============= */

/*
 * CE QUE LA FILE FAISAIT ENCORE.
 *
 * `processSyncQueue()` sélectionnait tout ce qui n'était ni `done` ni `failed` :
 *
 *     .filter(entry => !['done', 'failed'].includes(entry.status))
 *
 * `conflict` passait donc le filtre. Or `enableCentralSync()` repart au retour sur
 * l'onglet, au retour du réseau, et TOUTES LES VINGT SECONDES. Une opération en conflit
 * repartait donc indéfiniment vers un serveur qui la refusera toujours — sa révision est
 * périmée et ne le sera pas moins avec le temps.
 *
 * Un conflit ne se résout pas tout seul : il attend un geste humain. Le rejouer à l'aveugle
 * ne peut rien réparer ; cela ne fait qu'une requête inutile toutes les vingt secondes, un
 * compteur de tentatives qui gonfle, et une bulle de notification qui revient sans cesse
 * dire la même chose — jusqu'à ce que l'utilisateur cesse de la lire.
 */

test('CONF·11 — une entrée en conflit ne produit AUCUN nouvel appel au cycle suivant', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });

  // Premier rejeu : le serveur a avancé, l'opération devient un conflit.
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 11);
  await db.processSyncQueue();
  const [apresPremier] = await fileAttente();
  assert.equal(apresPremier.status, 'conflict');
  const tentatives = apresPremier.attempts;
  const statutsAvant = statuts.length;

  // Deuxième cycle — celui que déclenchent le retour sur l'onglet ou le battement de 20 s.
  appels.length = 0;
  const bilan = await db.processSyncQueue();

  assert.deepEqual(appelsEcrivains(), [],
    'l’entrée en conflit a été rejouée : elle sera refusée indéfiniment, vingt secondes après vingt secondes');
  const [apresSecond] = await fileAttente();
  assert.equal(apresSecond.status, 'conflict', 'l’entrée doit rester en conflit');
  assert.equal(apresSecond.attempts, tentatives, 'le compteur de tentatives ne doit plus bouger');
  assert.equal(bilan.failed, 0, 'un conflit déjà constaté n’est pas un nouvel échec de ce cycle');
  assert.equal(statuts.length, statutsAvant,
    'la même alerte ne doit pas revenir à chaque cycle : répétée, elle cesse d’être lue');
});

test('CONF·12 — la saisie de l’utilisateur et de quoi se resituer SURVIVENT dans l’entrée terminale', async () => {
  // Terminal ne veut pas dire jeté : sans ces champs, la résolution humaine est impossible
  // et le travail de l'utilisateur est perdu pour de bon.
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Ce que j’avais écrit', _revision: 4 });
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 11);
  await db.processSyncQueue();
  await db.processSyncQueue();

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'conflict');
  assert.equal(entree.data.name, 'Ce que j’avais écrit', 'la saisie doit rester récupérable');
  assert.equal(entree.lastErrorCode, REVISION_ERRORS.STALE_WRITE);
  assert.equal(entree.currentRevision, 11, 'la révision du serveur permet de se resituer');
  assert.ok(entree.lastAttemptAt, 'la date de la dernière tentative doit rester lisible');
});

test('CONF·13 — une entrée en conflit ne bloque pas les opérations en attente qui la suivent', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 11);
  await db.processSyncQueue();

  // Une nouvelle saisie, sur une autre donnée, arrive après le conflit.
  await db.saveLocalOnly('notes', { id: 'n-1', text: 'ancienne', _revision: 2 });
  await mettreEnAttente('notes', { id: 'n-1', text: 'note hors ligne', _revision: 2 });

  appels.length = 0;
  repondeur = () => reponse(200, { ok: true });
  const bilan = await db.processSyncQueue();

  assert.equal(bilan.processed, 1, 'la note en attente devait partir');
  assert.equal(appelsEcrivains().length, 1, 'un seul appel : la note, jamais le conflit figé');
  assert.ok(appelsEcrivains()[0].chemin.includes('/notes/'));
  const restantes = await fileAttente();
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].storeName, 'rooms');
  assert.equal(restantes[0].status, 'conflict');
});

test('CONF·14 — `pending` reste rejouable : le gel ne touche QUE les conflits', async () => {
  // Non-régression : geler trop large transformerait chaque coupure réseau en perte.
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });

  repondeur = () => reponse(500, { message: 'Erreur interne' });
  await db.processSyncQueue();
  assert.equal((await fileAttente())[0].status, 'pending');

  appels.length = 0;
  repondeur = () => reponse(200, { ok: true });
  const bilan = await db.processSyncQueue();
  assert.equal(bilan.processed, 1, 'une opération en attente doit repartir au cycle suivant');
  assert.equal((await fileAttente()).length, 0);
});

/* ============= 4. LA SUPPRESSION HORS LIGNE GARDE LA RÉVISION DU CLIC ============= */

test('CONF·15 — une suppression hors ligne retient la révision qu’elle avait AU MOMENT DU CLIC', async () => {
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });

  // Coupure : la suppression part en attente.
  const panne = () => { throw new Error('réseau indisponible'); };
  repondeur = panne;
  await db._deleteRaw('rooms', 'r-1');

  const [entree] = await fileAttente();
  assert.equal(entree.action, 'delete');
  assert.equal(entree.status, 'pending');
  assert.equal(entree.expectedRevision, 4,
    'sans la révision du clic, la suppression repartira à l’aveugle à la reconnexion');
});

test('CONF·16 — à la reconnexion, la suppression rejoue la révision DU CLIC, pas une plus récente', async () => {
  /*
   * LE SCÉNARIO EXACT QUE CE BLOCAGE FERME.
   *
   *   A lit la salle       → révision 4
   *   A perd le réseau
   *   A clique Supprimer   → mise en attente
   *   B modifie la salle   → révision 5 côté serveur
   *   A retrouve le réseau → la file rejoue la suppression
   *
   * Si elle repart sans révision, le serveur la prend pour délibérée et le travail de B
   * disparaît. Si elle repart avec la révision d'un instantané plus récent, c'est pire
   * encore : on prétendrait avoir vu ce qu'on n'a jamais vu.
   */
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });

  repondeur = () => { throw new Error('réseau indisponible'); };
  await db._deleteRaw('rooms', 'r-1');

  // Pendant la coupure, un instantané plus récent arrive dans la base locale : la file ne
  // doit surtout pas y puiser sa révision.
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Modifiée par B', _revision: 5 });

  appels.length = 0;
  repondeur = () => refus(REVISION_ERRORS.STALE_WRITE, 5);
  await db.processSyncQueue();

  const envoi = appels.find(appel => appel.methode === 'DELETE');
  assert.ok(envoi, 'la file doit avoir émis la suppression');
  assert.equal(revisionDemandee(envoi.chemin), 4,
    'la suppression doit déclarer la révision du clic, jamais celle d’un instantané postérieur');

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'conflict', 'le refus doit figer l’opération, pas la remettre en attente');
  assert.equal(dernierStatut().message, STALE_WRITE_MESSAGE);

  // Et plus rien ne repart ensuite.
  appels.length = 0;
  await db.processSyncQueue();
  assert.deepEqual(appelsEcrivains(), [], 'la suppression en conflit a été rejouée');
});

test('CONF·17 — un rejet 4xx définitif est ISOLÉ et n’empêche pas les suivants de partir', async () => {
  /*
   * Cette règle n'était tenue que par une lecture du source — `assert.match(sync, /status:
   * 'failed'/)`. Un tel test ne dit pas si la file continue : il dit qu'une chaîne de
   * caractères n'a pas bougé, et il devient rouge dès qu'on nomme proprement les états.
   * Il est ici EXÉCUTÉ.
   */
  reinitialiser();
  await db.saveLocalOnly('rooms', { id: 'r-1', name: 'Régie A', _revision: 4 });
  await db.saveLocalOnly('notes', { id: 'n-1', text: 'ancienne', _revision: 2 });
  await mettreEnAttente('rooms', { id: 'r-1', name: 'Saisie hors ligne', _revision: 4 });
  await mettreEnAttente('notes', { id: 'n-1', text: 'note hors ligne', _revision: 2 });

  // La salle est refusée définitivement (validation), la note n'a rien à voir.
  repondeur = chemin => (chemin.includes('/rooms/')
    ? reponse(400, { error: 'INVALID_PAYLOAD', message: 'Champ obligatoire manquant.' })
    : reponse(200, { ok: true }));
  const bilan = await db.processSyncQueue();

  assert.equal(bilan.processed, 1, 'la note devait partir malgré le rejet de la salle');
  assert.equal(bilan.failed, 1);
  const restantes = await fileAttente();
  assert.equal(restantes.length, 1, 'seule l’opération rejetée reste en file');
  assert.equal(restantes[0].storeName, 'rooms');
  assert.equal(restantes[0].status, 'failed', 'un rejet définitif est isolé, pas rejoué');

  // Et il est terminal : le cycle suivant ne le renvoie pas.
  appels.length = 0;
  await db.processSyncQueue();
  assert.deepEqual(appelsEcrivains(), [], 'une opération isolée a été rejouée');
});

/* ══════════════════════════════════════════════════════════════════════════
 * P0-F — LE RÉSIDU CONNU DE L'ACL DES CÂBLES : UN 403 NE LAISSE AUCUN ÉTAT FAUX
 *
 * Cas mesuré et documenté : quand le périmètre de LECTURE dépasse celui d'ÉDITION, le
 * client ne peut pas prouver son refus avant d'écrire — c'est le serveur qui prononce le
 * 403. Ce résidu est accepté POUR AUTANT QUE le refus ne laisse rien de faux derrière lui.
 *
 * C'est ce que ces trois épreuves fixent : la vérité locale revient, le refus se nomme, et
 * aucun chemin ne peut annoncer un succès.
 * ══════════════════════════════════════════════════════════════════════════ */

const refusAutorisation = () => reponse(403, {
  error: 'ZONE_FORBIDDEN',
  message: 'Vous devez être autorisé dans toutes les zones avant la modification.'
});

test('P0F·403·1 — un refus d’autorisation RAMÈNE la copie locale à sa vérité', async () => {
  reinitialiser();
  await db.saveLocalOnly('cables', { id: 'CAB-1', reference: 'CAB-2026-001', status: 'Connecté', _revision: 3 });

  repondeur = refusAutorisation;
  await assert.rejects(
    () => db.save('cables', { id: 'CAB-1', reference: 'CAB-2026-001', status: 'À vérifier', _revision: 3 }),
    error => error.status === 403);

  const local = await db._getRaw('cables', 'CAB-1');
  assert.equal(local.status, 'Connecté',
    'une modification que le serveur a refusée ne doit pas rester affichée comme acquise');
  assert.equal(local._revision, 3, 'la révision locale ne doit pas avancer sur un refus');
});

test('P0F·403·2 — le refus est rangé « failed », pas « conflict » : ce n’est pas un conflit de version', async () => {
  reinitialiser();
  await db.saveLocalOnly('cables', { id: 'CAB-1', reference: 'CAB-2026-001', _revision: 3 });
  repondeur = refusAutorisation;
  await assert.rejects(() => db.save('cables', { id: 'CAB-1', reference: 'Renommé', _revision: 3 }));

  const [entree] = await fileAttente();
  assert.equal(entree.status, 'failed');
  assert.equal(entree.lastErrorCode, 'ZONE_FORBIDDEN');
  // Trois causes, trois gestes : relire et ressaisir pour un conflit, demander l'accès pour
  // un refus de périmètre. Les confondre envoie l'utilisateur au mauvais endroit.
  assert.notEqual(entree.status, 'conflict');
});

test('P0F·403·3 — un câble CRÉÉ puis refusé ne laisse AUCUNE trace locale', async () => {
  reinitialiser();
  repondeur = refusAutorisation;
  await assert.rejects(() => db.save('cables', { id: 'CAB-NEUF', reference: 'CAB-2026-999' }));
  assert.equal(await db._getRaw('cables', 'CAB-NEUF'), null,
    'un enregistrement que le serveur n’a jamais accepté ne doit pas survivre localement');
});

test('P0F·403·4 — `db.save` LÈVE : aucun appelant ne peut annoncer un succès', async () => {
  reinitialiser();
  await db.saveLocalOnly('cables', { id: 'CAB-1', reference: 'CAB-2026-001', _revision: 3 });
  repondeur = refusAutorisation;
  let annonce = 'aucune';
  try {
    await db.save('cables', { id: 'CAB-1', reference: 'Renommé', _revision: 3 });
    annonce = 'succès';                     // ce chemin ne doit jamais être atteint
  } catch { annonce = 'refus'; }
  assert.equal(annonce, 'refus',
    'les écrans affichent « Liaison enregistrée » après `await db.save` : il DOIT lever');
});
