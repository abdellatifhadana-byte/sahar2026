import { db } from './db.js';
import { startupProgress, readCountingBytes } from './startup-progress.js';
import {
  isConflictCode, queueEntryIsClaimable, queueEntryIsOutstanding, queueEntryIsReplayable,
  revisionOf, QUEUE_STATUSES, STALE_WRITE_MESSAGE,
  REVISION_FIELD, storeUsesRevision, withRevision, isPermanentSyncRejection, isBackgroundDelivery
} from './revision-contract.js';
import { buildSnapshotDiff, diffIsEmpty, emitSnapshotDiff, projectStoreAfter } from './snapshot-diff-contract.js';
import {
  isStrictLocalRecord, releaseCatalogBuffered, storeMayHoldLocalRecords, survivesAuthoritativeClear
} from './record-ownership-contract.js';
import { planStoreReplacement } from './snapshot-store-plan.js';
import { resumeQueueSync } from './sync-queue-truth.js';
import {
  estEcritureCredentielle, MESSAGE_CREDENTIEL_EN_LIGNE_SEUL, neutraliserEntreeHeritee,
  porteUnCredentiel, sanitizeLocalUserCredentialFields
} from './local-credential-contract.js';

const SYNC_STORES = [
  'users','locations','rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','docs','faq','notifications','logs','attachments',
  'cables','cable_reports','settings'
];

const AUTO_NUMERIC_ID_STORES = new Set([
  'users','locations','rooms','baies','equipments','screens','screen_issues','tickets','logs',
  'notifications','attachments','diagnosis_history','notes','docs','faq','cable_reports'
]);

const originalSave = db.save.bind(db);
const originalDeleteRaw = db._deleteRaw.bind(db);
const originalOpen = db.open.bind(db);
let syncing = false;
let remoteReady = false;
let enablePromise = null;

const emitStatus = detail => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('central-sync-status', { detail }));
};

/*
 * CE QUE LA PASTILLE A LE DROIT DE DIRE (#98) — voir sync-queue-truth.js.
 *
 * Les comptes rendus d'un passage ne suffisent pas : une entrée `conflict`/`failed` est
 * terminale, aucune reprise ne la réclame plus, et vingt secondes plus tard elle n'est
 * plus comptée nulle part. L'état affiché lit donc la file ENTIÈRE, pas le résultat du
 * dernier tour.
 *
 * `state` n'est pas modifié : d'autres modules s'y accrochent pour relancer leurs
 * reprises (`state === 'synced'`). Ce qui est ajouté, c'est le fait manquant — `queue`
 * et `connecte` — pour que l'écran cesse de rendre deux vérités distinctes par une seule
 * étiquette. `updatedAt` reste porté tel quel : c'est la preuve qu'un instantané a été
 * appliqué, sur laquelle repose `attendreDecisionSync()`.
 */
async function emitStatusAvecFile(detail, { connecte = false } = {}) {
  let queue = null;
  try { queue = resumeQueueSync(await db.getAll('syncQueue')); }
  catch { queue = null; }
  emitStatus(queue ? { ...detail, connecte, queue } : { ...detail, connecte });
}

/** Émettre un événement quelconque du contrat de changements. */
const emitEvent = (type, detail) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type, { detail }));
};

const hasAuthenticatedIdentity = () => typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('auth'));

const makeNumericId = () => {
  const random = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1000 : Math.floor(Math.random() * 1000);
  return Date.now() * 1000 + random;
};

const normalizeRemoteId = value => {
  if (value === null || value === undefined || value === '') return value;
  if (/^-?\d+$/.test(String(value))) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  return value;
};

/*
 * Enregistrements strictement locaux : ils ne partent jamais vers le serveur et ne sont
 * jamais effacés par l'application d'un instantané.
 *
 * La liste vivait ici, et la promesse de ce commentaire était FAUSSE : le vidage
 * autoritaire les effaçait tout de même, trois cents lignes plus bas. Elle appartient
 * désormais à `record-ownership-contract.js`, avec le reste du modèle de propriété — un
 * seul endroit qui décide à qui est une fiche, et le vidage lui obéit.
 */
const isLocalOnlyRecord = isStrictLocalRecord;

// Aucun appel n'avait de délai d'expiration ni d'annulation, alors qu'une
// synchronisation repart TOUTES LES 20 SECONDES. Une requête restée pendue — liaison
// dégradée, serveur bloqué — n'était jamais abandonnée : les suivantes s'empilaient
// derrière elle, chacune tenant une connexion, sans que rien ne le signale.
const REQUEST_TIMEOUT_MS = 25000;
const enVol = new Set();

/** Abandonne toutes les requêtes en cours : déconnexion, ou onglet quitté. */
export function cancelInFlightRequests(raison = 'annulé') {
  for (const controller of enVol) { try { controller.abort(raison); } catch {} }
  enVol.clear();
}

// Taille du dernier instantané réellement reçu, en octets. Sert de repère quand la
// réponse est compressée : `Content-Length` est alors absent, et une barre sans repère ne
// peut rien mesurer. La valeur vient d'un téléchargement réel, pas d'une estimation.
const CLE_TAILLE_INSTANTANE = 'central-sync-last-bytes';

function tailleMemorisee() {
  try {
    const memoire = Number(localStorage.getItem(CLE_TAILLE_INSTANTANE));
    if (Number.isFinite(memoire) && memoire > 0) return memoire;
  } catch {}
  return 0;
}

/** Retient la taille réellement reçue, qui servira de repère au prochain démarrage. */
function memoriserTaille(octets) {
  if (!(octets > 0)) return;
  try { localStorage.setItem(CLE_TAILLE_INSTANTANE, String(octets)); } catch {}
}

async function api(path, options = {}) {
  const controller = new AbortController();
  enVol.add(controller);
  const expiration = setTimeout(() => controller.abort('délai dépassé'), options.timeoutMs || REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    });
  } catch (cause) {
    // Un abandon n'est pas une panne serveur : il doit être reconnaissable pour que la
    // file de synchronisation le retente au lieu de le rejeter définitivement.
    if (controller.signal.aborted) {
      const error = new Error(`Le serveur n'a pas répondu dans le délai imparti (${Math.round((options.timeoutMs || REQUEST_TIMEOUT_MS) / 1000)} s).`);
      error.status = 408;
      error.code = 'REQUEST_TIMEOUT';
      throw error;
    }
    throw cause;
  } finally {
    clearTimeout(expiration);
    enVol.delete(controller);
  }
  const text = options.onProgress
    ? await readCountingBytes(response, charge => {
        if (charge.done) memoriserTaille(charge.received);
        options.onProgress(charge);
      }, { expectedSize: tailleMemorisee() })
    : await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `Erreur serveur (${response.status})`);
    error.status = response.status;
    error.code = payload?.error;
    // La charge utile du refus est conservée : un conflit de version y porte la révision
    // courante, seule information qui permette à l'écran de se resituer.
    error.payload = payload;
    throw error;
  }
  return payload;
}

/**
 * `expectedRevision` est la révision que l'écran avait SOUS LES YEUX au moment du geste.
 *
 * Elle est retenue ici, et non relue au moment du départ : entre le clic hors ligne et la
 * reconnexion, un instantané plus récent peut être arrivé dans la base locale. Y puiser
 * reviendrait à prétendre avoir vu ce qu'on n'a jamais vu — et à supprimer sur la foi d'un
 * état qu'un autre a écrit entre-temps.
 *
 * Une écriture n'en a pas besoin : sa révision voyage dans `data`. Une suppression, si.
 */
/**
 * LE SEUL ÉCRIVAIN DE LA FILE — ET IL ASSAINIT (B-4).
 *
 * `syncQueue` est une FRONTIÈRE DE PERSISTANCE : rien de secret ne la franchit, quelle que
 * soit la voie empruntée pour y arriver. Poser la règle sur CHAQUE appelant la rendrait
 * fausse au premier appelant ajouté — et il y en a sept ici, dont deux dans des chemins de
 * reprise où l'entrée est réécrite depuis une copie EN MÉMOIRE, prise avant tout
 * nettoyage. C'est par là qu'un secret déjà purgé du disque pouvait y revenir.
 */
async function ecrireDansLaFile(entree) {
  return originalSave('syncQueue', sanitizeLocalUserCredentialFields(entree));
}

/**
 * REPOSER L'ÉTAT D'AVANT, JAMAIS LE SECRET D'AVANT (B4-R2).
 *
 * `previous` est lu BRUT dans IndexedDB avant l'écriture. Sur un poste dont la purge n'a
 * pas encore tourné, a échoué, ou n'a pas fini, cette fiche porte encore le mot de passe.
 * Les trois chemins de retour arrière la reposaient telle quelle — et le garde extérieur
 * ne rattrapait rien, puisque `previousSave` REJETTE et que `scrubUserRecord` n'est donc
 * jamais atteint. Le secret revenait sur le disque à l'instant précis de l'échec.
 *
 * Les champs non sensibles d'avant sont préservés : c'est tout l'objet d'un retour
 * arrière. Seule la matière d'authentification ne revient pas — dans QUELQUE magasin que
 * ce soit (B4-R4) : reposer l'état d'avant reste une écriture locale, et elle obéit à la
 * même règle que toutes les autres.
 */
async function restaurerFicheAnterieure(storeName, previous) {
  const propre = porteUnCredentiel(previous) ? sanitizeLocalUserCredentialFields(previous) : previous;
  return originalSave(storeName, propre);
}

async function queueOperation(action, storeName, id, data = null, expectedRevision = null) {
  if (storeName === 'syncQueue' || isLocalOnlyRecord(storeName, data || id)) return;
  try {
    const existing = (await db.getAll('syncQueue')).find(item =>
      queueEntryIsReplayable(item.status) && item.action === action && item.storeName === storeName && String(item.entityId) === String(id)
    );
    if (existing) {
      // La PREMIÈRE révision retenue est la bonne : c'est celle du geste que l'utilisateur
      // a réellement posé en regardant la fiche.
      await ecrireDansLaFile({
        ...existing, data, timestamp: new Date().toISOString(), attempts: Number(existing.attempts || 0),
        expectedRevision: existing.expectedRevision ?? expectedRevision
      });
      return;
    }
    await ecrireDansLaFile({
      action, storeName, entityId: id, data, expectedRevision,
      timestamp: new Date().toISOString(), status: QUEUE_STATUSES.PENDING, attempts: 0
    });
  } catch (error) {
    console.warn('Impossible de mettre la synchronisation en attente', error);
  }
}

async function recordRejectedOperation(action, storeName, id, data, error, expectedRevision = null) {
  // Un conflit de version se nomme comme tel. La copie locale a déjà été ramenée à la
  // version du serveur par l'appelant : ce qui reste à faire est humain — relire la
  // version courante, puis ressaisir. Le préfixe « refusée par le serveur » ferait passer
  // pour une panne ce qui est une protection.
  // Une entrée terminale dort sans échéance : c'est l'endroit où un secret resterait le
  // plus longtemps. Elle garde la trace du geste, jamais sa matière — `ecrireDansLaFile`.
  const conflit = isConflictCode(error.code);
  await ecrireDansLaFile({
    action, storeName, entityId:id, data, expectedRevision,
    timestamp:new Date().toISOString(),
    status:conflit ? QUEUE_STATUSES.CONFLICT : QUEUE_STATUSES.FAILED, attempts:1,
    lastError:error.message, lastErrorCode:error.code || null,
    currentRevision:error.payload?.currentRevision ?? null,
    lastAttemptAt:new Date().toISOString()
  });
  await emitStatusAvecFile(conflit
    ? { state:'conflict', message:STALE_WRITE_MESSAGE }
    : { state:'warning', message:`Modification refusée par le serveur: ${error.message}` }, { connecte:remoteReady });
}

/**
 * Pousser une fiche, et RENDRE l'accusé de réception.
 *
 * Cette fonction est un transport : elle envoie et rapporte ce que le serveur a répondu.
 * Elle ne touche pas à la base locale — c'est `accorderRevision()` qui décide, plus haut,
 * si la projection a le droit d'apprendre quelque chose de cet accusé.
 */
async function pushRecord(storeName, record) {
  if (!SYNC_STORES.includes(storeName) || record?.id === undefined || record?.id === null || isLocalOnlyRecord(storeName, record)) return null;
  return api(`/api/data/${encodeURIComponent(storeName)}/${encodeURIComponent(record.id)}`, {
    method: 'PUT', body: JSON.stringify(record)
  });
}

/**
 * LE CONTENU D'UNE FICHE, RÉVISION EXCLUE, SOUS UNE FORME COMPARABLE.
 *
 * Les clés sont triées à chaque profondeur : deux fiches identiques écrites dans un ordre
 * différent doivent se ressembler. Les dates sont ramenées à leur forme ISO — elles
 * traversent IndexedDB en objets `Date`, et les parcourir comme des objets ordinaires les
 * rendrait toutes égales entre elles, ce qui ferait conclure « rien n'a changé » à tort.
 */
const formeStable = valeur => {
  if (valeur instanceof Date) return `@date:${valeur.toISOString()}`;
  if (Array.isArray(valeur)) return valeur.map(formeStable);
  if (valeur && typeof valeur === 'object') {
    return Object.keys(valeur).sort().reduce((accumulateur, cle) => {
      accumulateur[cle] = formeStable(valeur[cle]);
      return accumulateur;
    }, {});
  }
  return valeur;
};

/** Deux fiches portent-elles le MÊME contenu, la révision mise à part ? */
function memeContenu(gauche, droite) {
  const sansRevision = fiche => {
    const copie = { ...fiche };
    delete copie[REVISION_FIELD];
    try { return JSON.stringify(formeStable(copie)); } catch { return null; }
  };
  const a = sansRevision(gauche);
  const b = sansRevision(droite);
  // Une fiche insérialisable ne se compare pas : on préfère ne rien conclure.
  return a !== null && b !== null && a === b;
}

/**
 * APPRENDRE LA RÉVISION QUE LE SERVEUR VIENT D'ATTRIBUER — SANS ÉCRASER PERSONNE.
 *
 * Le défaut #120 : l'écriture partait avec la révision N, le serveur l'acceptait et passait
 * à N+1, mais la projection locale restait à N. L'écriture légitime suivante se faisait
 * alors refuser en 409 STALE_WRITE — un conflit sans deuxième auteur.
 *
 * La correction ne peut pas se contenter de réécrire la charge envoyée avec la nouvelle
 * révision. `saveWithCentralSync` écrit EN LOCAL D'ABORD, puis attend le serveur : pendant
 * cette attente, une autre saisie a pu remplacer la fiche. Réécrire aveuglément
 * `{ ...envoye, _revision }` ferait alors reculer le contenu — le correctif de la révision
 * détruirait une modification plus récente.
 *
 * On relit donc la fiche telle qu'elle est MAINTENANT, et on n'avance sa révision que si
 * elle porte encore, au caractère près, ce que le serveur vient d'accuser. Sinon on ne
 * touche à rien : la saisie plus récente garde sa révision observée, et c'est le contrat de
 * concurrence — pas nous — qui décidera de son sort quand elle partira à son tour.
 *
 * La révision posée vient UNIQUEMENT de l'accusé de réception. Jamais d'un `+ 1` local :
 * le serveur seul sait ce qu'il a attribué, et lui seul a vu les écritures des autres.
 */
async function accorderRevision(storeName, id, envoye, accuse) {
  if (!storeUsesRevision(storeName)) return;
  const revision = Number(accuse?.revision);
  if (!Number.isSafeInteger(revision) || revision <= 0) return;
  await originalOpen();
  if (!db.db?.objectStoreNames?.contains(storeName)) return;
  /*
   * RELIRE ET ESTAMPILLER DANS UNE SEULE TRANSACTION, et c'est essentiel.
   *
   * Relire par `_getRaw` puis réécrire par `originalSave` rouvrirait exactement la fenêtre
   * que cette fonction existe pour fermer : entre les deux transactions, une saisie peut
   * s'intercaler et serait écrasée par la fiche qu'on vient de relire. IndexedDB sérialise
   * les transactions d'un même magasin ; lire et écrire dans la MÊME transaction rend donc
   * la comparaison et l'estampille indivisibles.
   *
   * On n'écrit jamais la charge envoyée : on repose la fiche LUE, augmentée de la seule
   * révision. Ce qui est en base reste ce qui est en base ; seule la métadonnée avance.
   */
  await new Promise((resolve, reject) => {
    const transaction = db.db.transaction(storeName, 'readwrite');
    const magasin = transaction.objectStore(storeName);
    const lecture = magasin.get(id);
    lecture.onerror = () => reject(lecture.error);
    lecture.onsuccess = () => {
      const courant = lecture.result;
      // Fiche disparue localement : la faire renaître serait pire que se taire.
      if (!courant) return resolve();
      if (revisionOf(courant) === revision) return resolve();
      // Une saisie plus récente occupe la place : ce n'est pas ce que le serveur a acquitté.
      if (!memeContenu(courant, envoye)) return resolve();
      const ecriture = magasin.put(withRevision(courant, revision));
      ecriture.onsuccess = () => resolve();
      ecriture.onerror = () => reject(ecriture.error);
    };
  }).catch(erreur => {
    /*
     * Un incident de base LOCALE ne doit pas se déguiser en échec d'écriture serveur : le
     * serveur, lui, a bien accepté. Le taire ici laisse simplement la révision en retard —
     * le défaut d'origine — au lieu de faire remonter un faux refus jusqu'à l'écran et de
     * déclencher un retour arrière sur une écriture pourtant acquittée.
     */
    console.warn(`Révision ${revision} non rangée pour ${storeName}/${id}`, erreur);
  });
}

/**
 * SUPPRIMER EN DÉCLARANT LA VERSION QU'ON AVAIT SOUS LES YEUX.
 *
 * La suppression partait à l'aveugle : aucune révision, donc le serveur la traitait comme
 * DÉLIBÉRÉE et l'appliquait sans comparer. Le scénario est banal et la perte totale —
 * A ouvre la fiche, B la modifie, A clique Supprimer : le travail de B disparaît, alors
 * qu'une écriture périmée de A aurait été refusée. Une suppression périmée efface pourtant
 * davantage qu'une écriture périmée.
 *
 * `expectedRevision` est donc TOUJOURS déclarée dès qu'on a lu la fiche — y compris quand
 * elle vaut 0, ce qui est le cas d'un enregistrement hérité. Zéro est une valeur, pas une
 * absence : la taire ferait retomber la requête dans la suppression inconditionnelle, et
 * « paramètre oublié = suppression forcée » est exactement le piège à ne pas laisser
 * ouvert. Seule une fiche JAMAIS lue ne donne lieu à aucune déclaration : on ne peut pas
 * déclarer un état qu'on n'a pas observé.
 */
async function pushDelete(storeName, id, expectedRevision = null) {
  if (!SYNC_STORES.includes(storeName) || isLocalOnlyRecord(storeName, id)) return;
  const chemin = `/api/data/${encodeURIComponent(storeName)}/${encodeURIComponent(id)}`;
  // ABSENT et ZÉRO ne sont pas la même chose, et `Number(null)` vaut 0 : les confondre
  // ferait déclarer « révision 0 » sur une fiche qu'on n'a jamais lue — une affirmation
  // sur un état qu'on ignore.
  const observee = expectedRevision !== null && expectedRevision !== undefined
    && Number.isSafeInteger(Number(expectedRevision)) && Number(expectedRevision) >= 0;
  const declaration = observee ? `?expectedRevision=${encodeURIComponent(Number(expectedRevision))}` : '';
  await api(`${chemin}${declaration}`, { method: 'DELETE' });
}

/**
 * CE QUE LE POSTE PROPOSE AU CENTRE — ET CE QU'IL NE PROPOSE PAS (B4-R5).
 *
 * L'amorçage exportait les fiches BRUTES. Un résidu hérité pouvait donc quitter le
 * navigateur avant même que la purge de démarrage ait fini son tour, et aller se ranger
 * dans PostgreSQL — d'où l'instantané suivant le ramenait.
 *
 * Ce qui sort d'ici est assaini, sans exception : l'amorçage ne transporte jamais de
 * rotation d'identifiant, il propose un contenu existant.
 */
async function localSnapshot() {
  const data = {};
  for (const storeName of SYNC_STORES) {
    if (!db.db?.objectStoreNames.contains(storeName)) continue;
    const records = (await db.getAll(storeName)).map(record =>
      porteUnCredentiel(record) ? sanitizeLocalUserCredentialFields(record) : record);
    data[storeName] = storeName === 'settings' ? records.filter(record => !isLocalOnlyRecord(storeName, record)) : records;
  }
  return data;
}

/**
 * Remplace le contenu d'un magasin en UNE SEULE transaction.
 *
 * Ce qui existait avant : `clearStoreRaw()` vidait chaque magasin dans sa propre
 * transaction, puis les enregistrements étaient réinsérés un par un, chacun dans encore une
 * autre transaction. Sur un inventaire réel — 448 équipements, 124 documents, plus les
 * salles, baies, écrans et câbles — cela faisait près de HUIT CENTS transactions
 * successives, répétées toutes les vingt secondes et à chaque retour sur l'onglet.
 *
 * IndexedDB n'isole que l'intérieur d'une transaction. Entre le vidage et la dernière
 * insertion, tout lecteur voyait donc un magasin vide ou à moitié rempli. Symptômes
 * observés en production, sur mobile : la page Équipements s'affichait vide alors que le
 * tableau de bord comptait 448 appareils, et l'ouverture d'un équipement répondait
 * « Équipement introuvable ». Recharger la page « réparait » — parce que le rechargement
 * tombait hors de la fenêtre.
 *
 * Une transaction unique par magasin supprime la fenêtre : un lecteur voit soit l'ancien
 * contenu, soit le nouveau, jamais un entre-deux. C'est la garantie d'atomicité
 * d'IndexedDB, et elle ne tient que si toutes les requêtes sont émises SANS `await`
 * intercalé — sinon la transaction se referme d'elle-même avant la fin.
 *
 * L'effacement préalable reste indispensable et n'est pas affaibli : il retire
 * immédiatement les données d'une zone dont l'accès vient d'être révoqué.
 */
function replaceStoreAtomically(storeName, records, { clearFirst, supprimes = [] }) {
  if (!db.db?.objectStoreNames.contains(storeName)) return Promise.resolve({ avant: [], conserves: [] });
  return new Promise((resolve, reject) => {
    const transaction = db.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    let avant = [];
    const conserves = [];
    const lecture = store.getAll();

    lecture.onsuccess = () => {
      avant = lecture.result || [];
      const plan = planStoreReplacement(avant, records, {
        authoritative: clearFirst,
        tombstones: supprimes,
        survivesAuthoritativeClear: enregistrement =>
          storeMayHoldLocalRecords(storeName) && survivesAuthoritativeClear(storeName, enregistrement)
      });
      conserves.push(...plan.conserves);
      for (const id of plan.deletes) store.delete(id);
      for (const record of plan.puts) {
        /*
         * L'INGRESSION EST UNE FRONTIÈRE, ELLE AUSSI (B4-R5).
         *
         * Ces fiches viennent du centre et sont posées par `store.put()` direct : elles
         * ne passent ni par `db.save` ni par le garde. Une fiche servie porteuse
         * reposait donc le champ interdit sur le disque, juste après la purge — et le
         * centre pouvait la tenir de ce même poste, par l'égression d'avant.
         *
         * Le sanitiseur est PUR et synchrone : il s'applique ici sans ouvrir la moindre
         * attente, ce qui laisserait expirer la transaction. Les fiches sans matière
         * gardent la copie superficielle d'avant.
         */
        const payload = porteUnCredentiel(record)
          ? sanitizeLocalUserCredentialFields(record)
          : { ...record };
        if (payload.id === '' || payload.id === undefined || payload.id === null) delete payload.id;
        store.put(payload);
      }
    };

    transaction.oncomplete = () => resolve({ avant, conserves });
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error(`Transaction interrompue sur « ${storeName} ».`));
  });
}

async function applySnapshot(snapshot) {
  syncing = true;
  let diffAAnnoncer = null;
  try {
    const currentRoom = db.db?.objectStoreNames.contains('settings') ? await db._getRaw('settings', 'current-room') : null;
    const authoritativeStores = (snapshot?.authoritativeStores || [])
      .filter(storeName => SYNC_STORES.includes(storeName) && db.db?.objectStoreNames.contains(storeName));

    // Le snapshot central filtré est la source de vérité pour l'identité courante.
    // Effacer avant de réappliquer retire immédiatement les données d'une zone dont l'accès a été retiré.
    const autoritaires = new Set(authoritativeStores);

    // Regrouper par magasin AVANT d'écrire : chaque magasin est ensuite remplacé en une
    // seule transaction, ce qui supprime la fenêtre pendant laquelle il paraissait vide.
    const parMagasin = new Map();
    for (const [storeName, records] of Object.entries(snapshot?.data || {})) {
      if (!SYNC_STORES.includes(storeName) || !db.db?.objectStoreNames.contains(storeName)) continue;
      parMagasin.set(storeName, (records || []).filter(record => !isLocalOnlyRecord(storeName, record)));
    }

    /*
     * LA CESSION D'AUTORITÉ, ET C'EST ELLE QUI EMPÊCHE UNE DOUBLE SOURCE DURABLE.
     *
     * Un ensemencement retenu par `catalog-seed-guard` est protégé TANT QUE le centre ne le
     * connaît pas. Dès que l'instantané le porte, la phase transitoire est finie : le
     * registre le relâche, et le serveur redevient seul maître de la fiche — modification
     * comme suppression. Sans cette ligne, la protection deviendrait perpétuelle par
     * simple oubli, et une fiche installée au centre resterait ingouvernable.
     */
    for (const record of parMagasin.get('docs') || []) releaseCatalogBuffered(record?.id);
    // Un magasin autoritaire absent du snapshot doit tout de même être vidé : c'est le cas
    // d'une zone entièrement révoquée, dont il ne reste aucun enregistrement à envoyer.
    for (const storeName of authoritativeStores) {
      if (!parMagasin.has(storeName)) parMagasin.set(storeName, []);
    }

    /*
     * LES PIERRES TOMBALES — LA SECONDE FAÇON D'ANNONCER UNE SUPPRESSION.
     *
     * Un instantané supprime de deux manières, et une seule était vue :
     *
     *   par ABSENCE          la fiche ne figure plus dans `data` d'un magasin autoritaire.
     *                        Le remplacement la retire, et la comparaison avant/après la
     *                        voit partir. Ce chemin fonctionnait.
     *   par PIERRE TOMBALE   la fiche est nommée dans `snapshot.deleted`. Son magasin peut
     *                        n'être NI autoritaire NI présent dans `data` — c'est le cas
     *                        dès que rien d'autre n'a bougé chez lui. Il n'entrait alors
     *                        dans aucune des deux cartes de la différence, et la fiche
     *                        quittait la base locale sans que l'écran en soit averti :
     *                        exactement le fantôme que ce contrat prétend supprimer.
     *
     * Le magasin visé rejoint donc les cartes, avec un contenu envoyé vide s'il n'en a pas.
     * Vide ne veut pas dire effacé : il n'est vidé que s'il est autoritaire, et son état
     * « après » reste ce qu'il contenait, moins les fiches enterrées.
     */
    const tombesParMagasin = new Map();
    for (const tombstone of snapshot?.deleted || []) {
      const storeName = tombstone?.store;
      if (!SYNC_STORES.includes(storeName) || !db.db?.objectStoreNames.contains(storeName)) continue;
      if (isLocalOnlyRecord(storeName, tombstone.id)) continue;
      const id = normalizeRemoteId(tombstone.id);
      if (id === '' || id === null || id === undefined) continue;
      if (!tombesParMagasin.has(storeName)) tombesParMagasin.set(storeName, []);
      tombesParMagasin.get(storeName).push(id);
    }
    for (const storeName of tombesParMagasin.keys()) {
      if (!parMagasin.has(storeName)) parMagasin.set(storeName, []);
    }

    // L'écriture locale pèse 141 ms mesurés pour 200 enregistrements — assez pour être vue,
    // et jusqu'ici muette. Chaque magasin écrit fait avancer la barre de démarrage d'un cran.
    let ecrits = 0;
    const avantParMagasin = new Map();
    const apresParMagasin = new Map();
    for (const [storeName, records] of parMagasin) {
      const supprimes = tombesParMagasin.get(storeName) || [];
      const clearFirst = autoritaires.has(storeName);
      const { avant, conserves } = await replaceStoreAtomically(storeName, records, { clearFirst, supprimes });
      avantParMagasin.set(storeName, avant);
      // L'état d'arrivée est DÉDUIT de ce qui est entré dans la transaction, jamais relu :
      // une seconde lecture rouvrirait la fenêtre que le remplacement atomique a fermée.
      // `conserves` vient du remplacement lui-même — une seule décision, donc aucune
      // divergence possible entre ce qui a survécu et ce que la différence croit survivant.
      apresParMagasin.set(storeName, projectStoreAfter(avant, records, { clearFirst, deleted: supprimes, conserves }));
      ecrits += 1;
      startupProgress.report('apply', ecrits / parMagasin.size);
    }

    // La différence se calcule ici, l'annonce se fera plus bas — une fois TOUTE l'écriture
    // locale terminée. Annoncer un changement que la base n'a pas encore inviterait chaque
    // vue à relire l'ancien état et à se croire à jour.
    diffAAnnoncer = buildSnapshotDiff(avantParMagasin, apresParMagasin);

    // Préférences strictement locales : ne restaurer une salle courante que si elle reste visible.
    if (db.db?.objectStoreNames.contains('settings')) {
      const roomId = currentRoom?.currentRoomId ?? null;
      const visibleRoom = roomId == null ? null : await db._getRaw('rooms', normalizeRemoteId(roomId));
      const roomRetenue = visibleRoom ? roomId : null;
      /*
       * On ne réécrit QUE si la valeur change réellement.
       *
       * Cette ligne réécrivait la préférence à chaque passage — toutes les vingt secondes,
       * avec un `updatedAt` neuf à chaque fois. Comme le vidage autoritaire venait de la
       * détruire, l'ensemble formait une boucle parfaite : détruire, annoncer supprimé,
       * recréer, recommencer. La destruction est corrigée plus haut ; la réécriture
       * inutile l'est ici, sans quoi la fiche paraîtrait modifiée sans l'être.
       */
      if ((currentRoom?.currentRoomId ?? null) !== roomRetenue || !currentRoom) {
        await originalSave('settings', {
          id: 'current-room',
          currentRoomId: roomRetenue,
          updatedAt: new Date().toISOString()
        });
      }
      // Aucun repli fabriqué ici. Il masquait le vrai problème — les paramètres n'étaient
      // pas transmis aux non-admins — en écrivant des valeurs par défaut inventées
      // (autoLogout 30, aucune image de plan) qui ressemblaient à une configuration
      // valide. Le serveur envoie désormais `settings/global` à tout utilisateur
      // authentifié ; s'il est absent, c'est une anomalie qui doit rester visible.
      if (!await db._getRaw('settings', 'global')) {
        console.warn('Paramètres de plateforme absents après synchronisation : la configuration centrale n’a pas été reçue.');
      }
    }
  } finally {
    syncing = false;
  }

  /*
   * LES ÉVÉNEMENTS PARTENT ICI, ET PAS PLUS TÔT.
   *
   * `syncing` est déjà retombé : une vue qui réagit et écrit en réponse ne sera pas prise
   * pour une écriture de synchronisation. Et toute la base locale est à jour, donc une vue
   * qui relit trouve ce que l'événement annonce.
   *
   * C'est ce chaînon qui manquait. Une sauvegarde LOCALE émettait déjà
   * `platform-entity-updated`, que `data-visibility-recovery.js` consomme pour rafraîchir
   * les vues ouvertes ; un changement DISTANT n'empruntait pas ce canal et restait invisible
   * à l'écran jusqu'à une navigation ou un F5.
   */
  if (diffAAnnoncer && !diffIsEmpty(diffAAnnoncer)) {
    await emitSnapshotDiff(
      diffAAnnoncer,
      (storeName, id) => db._getRaw(storeName, normalizeRemoteId(id)),
      (type, detail) => emitEvent(type, detail)
    );
  }
  return diffAAnnoncer;
}

/**
 * LA FILE ET LA PASTILLE APPARTIENNENT À L'UTILISATEUR (#98).
 *
 * Une écriture ordinaire qui échoue laisse une trace : mise en file si l'incident est
 * passager, entrée `conflict`/`failed` si le refus est définitif. C'est le contrat, et il
 * suppose un propriétaire humain — quelqu'un qui a posé le geste et peut le reprendre.
 *
 * Une LIVRAISON DE FOND n'a pas ce propriétaire : `BACKGROUND_DELIVERY` déclare que
 * l'appelant répond lui-même de la reprise. Elle n'écrit donc RIEN dans la file partagée et
 * n'annonce rien dans la pastille partagée — elle relance le refus tel quel, et c'est tout.
 * Voir `revision-contract.js` pour ce que cela ferme, mesure à l'appui.
 *
 * Le reste ne bouge pas d'un iota, canal de fond compris : la copie locale est restaurée
 * sur un refus définitif, la révision reste arbitrée par le serveur seul, et l'erreur
 * remonte à l'appelant. Rien n'est avalé.
 */
db.save = async function saveWithCentralSync(storeName, data, option) {
  await originalOpen();
  const deFond = isBackgroundDelivery(option);
  const payload = { ...data };
  if (AUTO_NUMERIC_ID_STORES.has(storeName) && (payload.id === '' || payload.id === null || payload.id === undefined)) payload.id = makeNumericId();

  /*
   * UN CHANGEMENT DE MOT DE PASSE EST EN LIGNE SEULEMENT (B-4).
   *
   * La question est posée ICI, avant la moindre écriture locale : une fois la fiche posée
   * dans IndexedDB, le secret est sur le disque du poste, et tout ce qui suit n'est plus
   * que du rattrapage. Le centre injoignable, on ne conserve RIEN et on rend la main à
   * l'appelant avec de quoi le dire à l'opérateur.
   *
   * Le reste de l'écriture d'utilisateur ne bouge pas : un changement de profil est
   * toujours hors ligne capable, et sa mise en file reste due.
   *
   * DEUX QUESTIONS, ET ELLES NE SE RECOUVRENT PAS (B4-R4).
   *
   *   · `contientMatiereCredentielle` — cette fiche porte-t-elle un champ du contrat ?
   *     Vrai pour N'IMPORTE quel magasin. C'est ce qui décide de ce qu'on POSE sur le
   *     disque, et rien d'autre.
   *   · `changementCredentiel` — est-ce une rotation d'identifiant d'utilisateur ? Vrai
   *     pour `users` seul. C'est ce qui décide si l'écriture exige le centre.
   *
   * Les deux étaient confondues : la copie locale n'était assainie que sur la seconde, si
   * bien qu'une fiche `settings` portant `password` était recopiée TELLE QUELLE dans
   * IndexedDB. La file, elle, était bien nettoyée — et c'est tout ce que l'épreuve
   * d'alors vérifiait.
   *
   * La séparation compte dans les deux sens : un champ `password` égaré dans une fiche de
   * réglages ne doit pas non plus se muer en rotation de mot de passe et se faire refuser
   * hors ligne. Cette fiche reste une fiche de réglages ; elle perd seulement le champ
   * interdit.
   */
  const contientMatiereCredentielle = porteUnCredentiel(payload);
  const changementCredentiel = estEcritureCredentielle(storeName, payload);
  /*
   * « EN LIGNE » VEUT DIRE : LE SERVEUR VA RECEVOIR CETTE ÉCRITURE.
   *
   * Pas « la liaison semble vivante ». `remoteReady` vit en mémoire dans ce module, tandis
   * que `localStorage.auth` disparaît à la déconnexion : entre les deux, il existe une
   * fenêtre où la liaison est CRUE vivante alors que l'identité n'est plus là. La poussée
   * n'a alors pas lieu — `shouldSync` exige `hasAuthenticatedIdentity()` — et le
   * changement de mot de passe rendait la main SANS erreur.
   *
   * Aucun secret ne fuitait, la fiche locale étant assainie ; mais l'opérateur repartait
   * avec la certitude d'un mot de passe changé que le serveur n'avait jamais reçu.
   *
   * `applySnapshot()` ouvrait la MÊME porte par un autre chemin (B4-R3) : elle lève
   * `syncing` pendant tout son travail, sur plusieurs tours de boucle, et rien ne prouve
   * que l'interface soit inerte pendant cet intervalle. La garde se lisant `!syncing && …`,
   * elle était purement et simplement SAUTÉE pendant l'application — même silence, même
   * faux succès.
   *
   * D'où deux questions distinctes, et c'est tout le correctif :
   *
   *   · `cibleDuCentre`   — cette fiche RELÈVE-T-ELLE du centre ? Propriété du magasin.
   *   · `partiraAuCentre` — cette écriture-ci PARTIRA-T-ELLE MAINTENANT ? Circonstance.
   *
   * Une rotation d'identifiant qui relève du centre sans pouvoir partir à l'instant même
   * échoue, pour QUELQUE raison que ce soit — hors ligne, sans identité, ou pendant une
   * application d'instantané. `shouldSync` n'est pas touché : une modification de profil
   * garde exactement la sémantique qu'elle avait, application comprise.
   */
  const cibleDuCentre = SYNC_STORES.includes(storeName) && !isLocalOnlyRecord(storeName, payload);
  const partiraAuCentre = cibleDuCentre && !syncing && remoteReady && hasAuthenticatedIdentity();
  if (changementCredentiel && cibleDuCentre && !partiraAuCentre) {
    const refus = new Error(MESSAGE_CREDENTIEL_EN_LIGNE_SEUL);
    refus.code = 'CREDENTIAL_REQUIRES_CENTRAL';
    throw refus;
  }

  // La copie LOCALE est toujours démunie de matière d'authentification, quel que soit le
  // magasin. Le secret ne vit que dans `saved`, en mémoire, le temps d'un aller-retour.
  const payloadLocal = contientMatiereCredentielle ? sanitizeLocalUserCredentialFields(payload) : payload;
  const previous = payload.id === '' || payload.id == null ? null : await db._getRaw(storeName, payload.id);
  const id = await originalSave(storeName, payloadLocal);
  const saved = { ...payload, id };

  /*
   * LA CHARGE DU CENTRE N'EST PAS LA PROJECTION LOCALE (B4-R5).
   *
   * Trois destinations, trois charges, et elles ne se confondent plus :
   *
   *   · le DISQUE      reçoit `payloadLocal` — jamais de matière d'authentification ;
   *   · le CENTRE      reçoit `chargeCentrale` — la matière UNIQUEMENT s'il s'agit d'une
   *                    vraie rotation d'identifiant, seul cas où le serveur a quelque
   *                    chose à changer ; l'assainir là reviendrait à rendre tout
   *                    changement de mot de passe impossible ;
   *   · la FILE        reçoit ce que `ecrireDansLaFile` assainit, sans exception.
   *
   * Mesuré : `saved` partait brute au `PUT` générique. Or le serveur ne normalise les
   * mots de passe QUE pour `users` — un `settings.password` se rangeait donc tel quel
   * dans PostgreSQL, d'où l'instantané suivant le ramenait sur le poste.
   */
  const chargeCentrale = changementCredentiel || !porteUnCredentiel(saved)
    ? saved
    : sanitizeLocalUserCredentialFields(saved);
  const shouldSync = !syncing && SYNC_STORES.includes(storeName) && !isLocalOnlyRecord(storeName, saved) && hasAuthenticatedIdentity();
  if (shouldSync) {
    if (!remoteReady) {
      // Le centre n'est pas joignable : rien n'est dit du contenu. La charge reste DUE,
      // mais c'est à son émetteur de la redonner, pas à la file de l'utilisateur.
      if (deFond) throw new Error(`Livraison de fond différée pour ${storeName}/${id} : le centre n'est pas joignable.`);
      await queueOperation('save', storeName, id, saved);
      await emitStatusAvecFile({ state: 'offline', message: 'Modification conservée localement, synchronisation en attente.' }, { connecte:false });
    } else {
      /*
       * LA RÉVISION SE COMPARE À CE QUI A ÉTÉ POSÉ (B4-R1).
       *
       * `accorderRevision()` relit la fiche locale et ne l'estampille que si son contenu
       * est encore celui de l'écriture acquittée — c'est ce qui empêche d'écraser une
       * saisie intercalée entre la poussée et l'accusé. La référence de cette comparaison
       * doit donc être la PROJECTION LOCALE, celle qui a réellement été écrite.
       *
       * Depuis B-4, `saved` et la projection locale diffèrent volontairement pour un
       * changement de mot de passe : la première porte le secret, la seconde non. Comparer
       * la fiche relue à `saved` échouait donc TOUJOURS, et la révision acquittée n'était
       * jamais rangée. Mesuré : serveur en 5, fiche locale restée en 4, puis STALE_WRITE
       * sur le renommage suivant alors que personne d'autre n'avait touché la fiche.
       *
       * Pour toute autre écriture, la projection locale EST `saved` : rien ne change, et
       * la protection contre la saisie intercalée reste entière.
       */
      const projectionLocale = { ...payloadLocal, id };
      try { await accorderRevision(storeName, id, projectionLocale, await pushRecord(storeName, chargeCentrale)); }
      catch (error) {
        console.warn(`Synchronisation différée de ${storeName}/${id}`, error);
        if (isPermanentSyncRejection(error)) {
          if (previous) await restaurerFicheAnterieure(storeName, previous);
          else await originalDeleteRaw(storeName, id);
          if (!deFond) await recordRejectedOperation('save', storeName, id, saved, error);
          throw error;
        }
        /*
         * Le centre s'est dérobé EN COURS de route. Pour une écriture ordinaire, la file
         * est le bon filet. Pour un changement de mot de passe, elle serait le défaut
         * lui-même : on défait l'écriture locale et on rend la main, exactement comme si
         * le centre avait été injoignable dès le départ.
         */
        if (changementCredentiel) {
          if (previous) await restaurerFicheAnterieure(storeName, previous);
          else await originalDeleteRaw(storeName, id);
          const refus = new Error(MESSAGE_CREDENTIEL_EN_LIGNE_SEUL);
          refus.code = 'CREDENTIAL_REQUIRES_CENTRAL';
          throw refus;
        }
        if (deFond) throw error;
        await queueOperation('save', storeName, id, saved);
        if (error.status === 401) remoteReady = false;
        emitStatus({ state: error.status === 401 ? 'unauthenticated' : 'offline', message:error.status === 401 ? 'Session expirée. Modification conservée jusqu’à la reconnexion.' : 'Modification conservée localement, synchronisation en attente.' });
      }
    }
  }
  return id;
};

db._deleteRaw = async function deleteWithCentralSync(storeName, id) {
  await originalOpen();
  const previous = await db._getRaw(storeName, id);
  // La révision que l'écran avait sous les yeux au moment du clic. `previous` absent = on
  // n'a jamais lu cette fiche : rien à déclarer. `previous` présent sans révision = fiche
  // héritée, donc bel et bien vue à la révision 0.
  const revisionVue = previous ? revisionOf(previous) : null;
  const result = await originalDeleteRaw(storeName, id);
  const shouldSync = !syncing && SYNC_STORES.includes(storeName) && !isLocalOnlyRecord(storeName, id) && hasAuthenticatedIdentity();
  if (shouldSync) {
    if (!remoteReady) {
      await queueOperation('delete', storeName, id, null, revisionVue);
      emitStatus({ state: 'offline', message: 'Suppression conservée localement, synchronisation en attente.' });
    } else {
      try { await pushDelete(storeName, id, revisionVue); }
      catch (error) {
        console.warn(`Suppression différée de ${storeName}/${id}`, error);
        if (isPermanentSyncRejection(error)) {
          if (previous) await restaurerFicheAnterieure(storeName, previous);
          await recordRejectedOperation('delete', storeName, id, null, error, revisionVue);
          throw error;
        }
        await queueOperation('delete', storeName, id, null, revisionVue);
        if (error.status === 401) remoteReady = false;
        emitStatus({ state: error.status === 401 ? 'unauthenticated' : 'offline', message:error.status === 401 ? 'Session expirée. Suppression conservée jusqu’à la reconnexion.' : 'Suppression conservée localement, synchronisation en attente.' });
      }
    }
  }
  return result;
};

/*
 * Modules that already completed a dedicated server transaction use this
 * local-only writer to mirror the normalized response without issuing a second PUT.
 *
 * C'est une QUATRIÈME voie d'écriture locale, hors `db.save` comme les trois autres
 * (B4-R5) : ce qu'elle recopie vient d'une réponse serveur, et une réponse qui porterait
 * un champ du contrat le poserait tel quel sur le disque. Elle passe donc par la même
 * règle. Rien d'autre ne change : c'est toujours une écriture strictement locale.
 */
db.saveLocalOnly = async function saveLocalOnly(storeName, data) {
  return originalSave(storeName, porteUnCredentiel(data) ? sanitizeLocalUserCredentialFields(data) : data);
};

/**
 * RÉCLAMER UNE ENTRÉE — LA LIRE ET Y POSER LA MAIN DANS LA MÊME TRANSACTION.
 *
 * C'est ici que se ferme la course de #127. La file était SÉLECTIONNÉE d'un côté et
 * SUPPRIMÉE de l'autre, et entre les deux il y avait un aller-retour réseau complet :
 * pendant tout ce temps l'entrée restait `pending`, donc offerte à qui passait. Deux
 * reprises lancées par le même événement `online` — celle de `db.js` et celle
 * d'`enableCentralSync` — la prenaient l'une après l'autre et l'envoyaient deux fois.
 *
 * Un drapeau en mémoire n'aurait pas suffi, et c'est mesuré : deux ONGLETS de la même
 * session partagent la file mais pas leurs variables, et rejouaient eux aussi la même
 * entrée. La main doit donc être posée là où la file vit — dans IndexedDB — et la lecture
 * qui décide doit être indivisible de l'écriture qui réclame. Une transaction `readwrite`
 * unique le garantit, entre onglets compris : c'est la même garantie sur laquelle
 * `accorderRevision` et `replaceStoreAtomically` s'appuient déjà.
 *
 * Rend l'entrée réclamée, ou `null` si quelqu'un d'autre l'a prise — ou l'a déjà réglée et
 * retirée, ce qui est le cas de loin le plus fréquent quand deux reprises se suivent.
 */
function reclamerEntree(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.db.transaction('syncQueue', 'readwrite');
    const magasin = transaction.objectStore('syncQueue');
    const lecture = magasin.get(id);
    let reclamee = null;
    lecture.onerror = () => reject(lecture.error);
    lecture.onsuccess = () => {
      const entree = lecture.result;
      // Disparue : une autre reprise l'a menée à bien et retirée. Il n'y a rien à envoyer.
      if (!entree) return;
      // Réclamée ailleurs et toujours vivante : c'est exactement ce qu'on refuse de doubler.
      if (!queueEntryIsClaimable(entree)) return;
      /*
       * La main posée réécrit l'entrée : c'est donc aussi une écriture de file, et elle
       * assainit comme les autres. Sans cela, réclamer une ligne héritée suffisait à
       * reposer son mot de passe sur le disque, dans la transaction même qui la prend.
       */
      reclamee = sanitizeLocalUserCredentialFields({ ...entree, status: QUEUE_STATUSES.PROCESSING, claimedAt: new Date().toISOString() });
      magasin.put(reclamee);
    };
    transaction.oncomplete = () => resolve(reclamee);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Réclamation interrompue sur la file de synchronisation.'));
  });
}

/**
 * LA REPRISE EN COURS, S'IL Y EN A UNE.
 *
 * Même promesse pour tout le monde : `enableCentralSync` s'en sert depuis toujours, et
 * la file en avait autant besoin. Un deuxième déclencheur — `focus`, `online`, la relance
 * des vingt secondes — ne lance plus un second cycle : il REJOINT celui qui court et en
 * reçoit le vrai bilan, ce dont `enableCentralSync` a besoin pour décider s'il relit
 * l'instantané.
 *
 * Elle ne remplace pas la réclamation ci-dessus, elle la complète : celle-ci protège d'un
 * autre CONTEXTE, celle-là évite d'ouvrir deux cycles dans le nôtre — et donc autant de
 * réclamations concurrentes qui finiraient toutes par se marcher dessus poliment.
 */
let fileEnVol = null;

db.processSyncQueue = function processCentralSyncQueue() {
  if (fileEnVol) return fileEnVol;
  fileEnVol = rejouerLaFile().finally(() => { fileEnVol = null; });
  return fileEnVol;
};

/**
 * LES LIGNES HÉRITÉES — NETTOYÉES AVANT TOUTE REPRISE, PAS APRÈS.
 *
 * Des versions antérieures ont laissé sur le disque des postes des entrées de file
 * porteuses de `password`. Les nettoyer au chargement d'un module ne suffirait pas : la
 * reprise part aussi sur l'évènement `online` et au retour sur l'onglet, et l'ordre des
 * balises de `index.html` ne peut pas en répondre. Le nettoyage vit donc à l'ENTRÉE de la
 * reprise, où il précède par construction le moindre départ.
 *
 * Une entrée porteuse est rendue TERMINALE, et non simplement allégée : rejouée sans son
 * mot de passe, elle ferait accepter au serveur une mise à jour de profil pendant que
 * l'opérateur croirait son mot de passe changé. Le motif inscrit dit ce qu'il en est.
 */
async function neutraliserLesCredentielsHerites() {
  let neutralisees = 0;
  try {
    for (const entree of await db.getAll('syncQueue')) {
      if (!porteUnCredentiel(entree)) continue;
      const propre = neutraliserEntreeHeritee(entree, { statutTerminal: QUEUE_STATUSES.FAILED });
      if (!propre) continue;
      await ecrireDansLaFile(propre);
      neutralisees += 1;
    }
  } catch (error) {
    console.warn('Nettoyage des identifiants hérités de la file impossible.', error);
  }
  return neutralisees;
}

async function rejouerLaFile() {
  if (!remoteReady || syncing) return { processed: 0, failed: 0, pending: 0 };
  await originalOpen();
  await neutraliserLesCredentielsHerites();
  /*
   * CE QUI PEUT REPARTIR, ET CE QUI NE LE PEUT PAS.
   *
   * `conflict` et `failed` restent DEHORS. Le filtre était « ni `done` ni `failed` », ce qui
   * laissait passer `conflict`. Or ce cycle repart au retour sur l'onglet, au retour du
   * réseau, et toutes les vingt secondes : une opération en conflit repartait donc sans fin
   * vers un serveur qui la refusera toujours — sa révision est périmée et ne le sera pas
   * moins avec le temps. Un conflit attend un geste humain. L'entrée reste en file avec la
   * saisie, le code du refus et la révision courante ; c'est une résolution manuelle qui la
   * lèvera, pas le temps qui passe.
   *
   * `processing` entre dans les candidates SEULEMENT si son échéance est passée : son
   * réclamant a disparu — onglet fermé au milieu d'un rejeu — et la modification hors ligne
   * doit repartir. Sans cette reprise, la main posée deviendrait un verrou mort, et une file
   * qui protège du double envoi au prix d'une perte serait un plus mauvais marché que le
   * défaut qu'elle corrige.
   *
   * Cette liste n'est de toute façon qu'une INTENTION : entre sa lecture et le départ de
   * chaque requête, une autre reprise a pu régler l'entrée ou la prendre. Rien ne part donc
   * sur la foi de ce qui est lu ici ; c'est `reclamerEntree` qui tranche, entrée par entrée,
   * au dernier moment.
   */
  const candidates = (await db.getAll('syncQueue')).filter(entry => queueEntryIsClaimable(entry));
  let processed = 0;
  let failed = 0;

  for (const candidate of candidates) {
    // Une seule reprise emporte l'entrée. Les autres passent leur chemin, sans bruit et
    // sans requête : c'est tout le contrat de #127 tenu en une ligne.
    const item = await reclamerEntree(candidate.id);
    if (!item) continue;
    if (isLocalOnlyRecord(item.storeName, item.data || item.entityId)) {
      await originalDeleteRaw('syncQueue', item.id);
      processed += 1;
      continue;
    }
    try {
      // La révision rejouée est celle du CLIC, retenue à la mise en attente — jamais celle
      // d'un instantané arrivé depuis, qui ferait prétendre avoir vu ce qu'on n'a pas vu.
      if (item.action === 'delete') await pushDelete(item.storeName, item.entityId, item.expectedRevision ?? null);
      // Le rejeu apprend la révision comme une écriture directe — et refuse pareillement
      // d'écraser une saisie survenue depuis la mise en attente.
      else if (item.data) await accorderRevision(item.storeName, item.entityId, item.data, await pushRecord(item.storeName, item.data));
      await originalDeleteRaw('syncQueue', item.id);
      processed += 1;
    } catch (error) {
      const status = Number(error.status || 0);
      if (status === 401) {
        remoteReady = false;
        await ecrireDansLaFile({ ...item, status: QUEUE_STATUSES.PENDING, claimedAt: null, attempts: Number(item.attempts || 0) + 1, lastError: error.message, lastAttemptAt: new Date().toISOString() });
        emitStatus({ state: 'unauthenticated', message: 'Session centrale expirée. Reconnexion requise.' });
        break;
      }
      /*
       * UN CONFLIT DE VERSION N'EST PAS UN REJET COMME LES AUTRES.
       *
       * Une opération mise en attente hors ligne s'appuie sur la version qu'avait
       * l'enregistrement au moment de la saisie. Si le serveur a avancé depuis, la
       * rejouer écraserait le travail d'un autre : il la refuse, et c'est ce qu'on veut.
       *
       * Mais l'annoncer comme une panne serait faux, et l'annoncer comme un simple échec
       * laisserait l'utilisateur sans rien à faire. On le nomme, avec la phrase qui dit
       * quoi faire. La copie locale, elle, revient d'elle-même à la version du serveur au
       * prochain instantané : les magasins concernés sont autoritaires.
       */
      if (isConflictCode(error.code)) {
        failed += 1;
        await ecrireDansLaFile({
          ...item, status: QUEUE_STATUSES.CONFLICT, claimedAt: null, attempts: Number(item.attempts || 0) + 1,
          lastError: error.message, lastErrorCode: error.code,
          currentRevision: error.payload?.currentRevision ?? null,
          lastAttemptAt:new Date().toISOString()
        });
        emitStatus({ state: 'conflict', message: STALE_WRITE_MESSAGE });
        console.warn(`Modification en attente refusée — la donnée a changé entre-temps: ${item.storeName}/${item.entityId}`, error);
        continue;
      }
      if (status >= 400 && status < 500) {
        failed += 1;
        await ecrireDansLaFile({
          ...item, status: QUEUE_STATUSES.FAILED, claimedAt: null, attempts: Number(item.attempts || 0) + 1,
          lastError: error.message, lastErrorCode: error.code || null, lastAttemptAt: new Date().toISOString()
        });
        console.warn(`Opération de synchronisation rejetée et isolée: ${item.storeName}/${item.entityId}`, error);
        continue;
      }

      /*
       * LA MAIN EST RELÂCHÉE, ET C'EST INDISPENSABLE.
       *
       * Le serveur n'a pas répondu — panne, délai dépassé. L'entrée doit redevenir
       * `pending`, sans quoi elle attendrait l'échéance d'une réclamation que plus
       * personne ne tient, et la reprise du cycle suivant la sauterait pour rien.
       */
      await ecrireDansLaFile({
        ...item, status: QUEUE_STATUSES.PENDING, claimedAt: null, attempts: Number(item.attempts || 0) + 1,
        lastError: error.message, lastAttemptAt: new Date().toISOString()
      });
      await emitStatusAvecFile({ state: 'offline', message: 'Serveur indisponible. Les modifications restent en attente.' }, { connecte:false });
      break;
    }
  }

  const remaining = (await db.getAll('syncQueue')).filter(entry => queueEntryIsOutstanding(entry.status)).length;
  return { processed, failed, pending: remaining };
}

/*
 * LE STOCKAGE LOCAL EST UN CACHE, PAS UNE ÉTAPE DE LA SYNCHRONISATION (#98 / A01).
 *
 * Le démarrage posait l'instantané, passait `remoteReady = true`, PUIS écrivait deux clés
 * dans `localStorage`, PUIS seulement vidait la file. Seul le téléchargement de `/api/sync`
 * était protégé : un `QuotaExceededError` — quota atteint, navigation privée, stockage
 * bloqué par la politique du navigateur — interrompait donc le démarrage APRÈS s'être
 * déclaré prêt et AVANT `processSyncQueue()`. La plateforme répondait « prête », les
 * modifications locales en attente n'étaient jamais poussées, et aucun `central-sync-status`
 * n'était émis : la pastille restait muette et les réconciliateurs n'avaient jamais leur
 * premier `synced`.
 *
 * Aucune de ces deux clés n'est une autorité. `zone-access-context` est l'EMPREINTE de
 * portée que `grille-centrale-dataset.js` utilise pour invalider son cache — « une
 * empreinte, pas une copie » — et tous ses lecteurs la lisent défensivement. Ne pas pouvoir
 * l'écrire n'a donc aucune conséquence de sécurité : le serveur reste seul juge.
 *
 * En revanche, la LAISSER PÉRIMÉE en aurait une forme : la session continuerait avec
 * l'empreinte de l'autorité précédente et son cache ne se revaliderait pas. On la retire
 * donc quand on ne peut pas la réécrire — l'empreinte change, le cache se revalide.
 */
function memoriserContexteLocal(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
    return true;
  } catch (error) {
    try { localStorage.removeItem(cle); } catch { /* stockage indisponible : rien à retirer */ }
    console.warn(`Contexte local « ${cle} » non conservé (stockage saturé ou indisponible).`, error);
    return false;
  }
}

db.enableCentralSync = async function enableCentralSync({ bootstrapLocal = true } = {}) {
  if (enablePromise) return enablePromise;
  enablePromise = (async () => {
    await originalOpen();
    let snapshot;
    try {
      // Le téléchargement rend compte de lui-même, octet par octet. C'est le palier où la
      // barre restait immobile à 52 % pendant des secondes sur une liaison réelle.
      snapshot = await api('/api/sync', {
        onProgress: ({ received, total, done }) => {
          if (done) { startupProgress.complete('download'); return; }
          // Sans dénominateur connu, on ne peut pas exprimer de fraction honnête : on
          // laisse la barre où elle est et le libellé dit ce qui se passe.
          if (total > 0) startupProgress.report('download', Math.min(received / total, 0.99));
          else startupProgress.enter('download');
        }
      });
    } catch (error) {
      remoteReady = false;
      emitStatus({ state: error.status === 401 ? 'unauthenticated' : 'local', message: error.message });
      return { enabled: false, reason: error.message, status: error.status };
    }

    if (!snapshot.initialized && bootstrapLocal) {
      const data = await localSnapshot();
      await api('/api/sync/bootstrap', { method: 'POST', body: JSON.stringify({ data }) });
      snapshot = await api('/api/sync');
    }

    startupProgress.enter('apply');
    await applySnapshot(snapshot);
    startupProgress.complete('apply');
    remoteReady = true;
    memoriserContexteLocal('central-sync-initialized', '1');
    memoriserContexteLocal('zone-access-context', JSON.stringify(snapshot.access || {}));
    const queue = await db.processSyncQueue();

    if (remoteReady && queue.processed > 0) {
      try {
        snapshot = await api('/api/sync');
        await applySnapshot(snapshot);
        memoriserContexteLocal('zone-access-context', JSON.stringify(snapshot.access || {}));
      } catch (error) {
        console.warn('Relecture centrale après reprise différée impossible.', error);
      }
    }

    /*
     * LA CONCLUSION SE LIT DANS LA FILE, PAS DANS LE PASSAGE (#98).
     *
     * `queue.failed` ne compte que les échecs de CE tour, et `queue.pending` que les
     * entrées encore réclamables. Une entrée `conflict`/`failed` est terminale : au tour
     * suivant elle n'apparaissait dans aucun des deux, et cette conclusion annonçait
     * « Synchronisé » par-dessus une modification refusée toujours présente en base.
     *
     * `state` conserve son vocabulaire — d'autres modules relancent leurs reprises sur
     * `synced` — mais il est maintenant tiré de la file entière, et le détail porte le
     * compte exact pour que l'écran n'ait plus à le deviner.
     */
    const file = resumeQueueSync(await db.getAll('syncQueue').catch(() => []));
    const etat = file.conflict > 0 ? 'conflict'
      : file.failed > 0 ? 'warning'
      : file.enAttente > 0 ? 'offline'
      : 'synced';
    const message = file.conflict > 0
      ? `${file.conflict} conflit(s) à résoudre : relire la version courante avant de ressaisir.`
      : file.failed > 0
        ? `${file.failed} modification(s) rejetée(s) ont été isolées. Les autres données ont été synchronisées.`
        : file.enAttente > 0
          ? `${file.enAttente} modification(s) restent en attente de synchronisation.`
          : 'Données synchronisées avec la base centrale.';
    emitStatus({ state: etat, message, updatedAt: snapshot.serverTime, connecte: true, queue: file });
    return { enabled: true, initialized: snapshot.initialized, stores: Object.keys(snapshot.data || {}).length, queue, access: snapshot.access || {} };
  })().finally(() => { enablePromise = null; });
  return enablePromise;
};

db.isCentralSyncReady = () => remoteReady;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => db.enableCentralSync({ bootstrapLocal: false }).catch(() => {}));
  window.addEventListener('focus', () => {
    if (localStorage.getItem('auth')) db.enableCentralSync({ bootstrapLocal: false }).catch(() => {});
  });
  // Onglet quitté : les requêtes en vol n'ont plus de destinataire. Les laisser courir
  // maintenait des connexions ouvertes pour un écran que personne ne regarde.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelInFlightRequests('onglet masqué');
  });
  // Session fermée : plus rien ne doit partir sous l'identité qui vient de se retirer.
  window.addEventListener('platform-session-closing', () => cancelInFlightRequests('session fermée'));
  setInterval(() => {
    if (document.visibilityState === 'visible' && localStorage.getItem('auth')) db.enableCentralSync({ bootstrapLocal: false }).catch(() => {});
  }, 20000);
}

export { SYNC_STORES };
