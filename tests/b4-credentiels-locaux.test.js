/**
 * @file tests/b4-credentiels-locaux.test.js — B-4 : aucun magasin local ne garde un secret.
 *
 * CE QUI A ÉTÉ MESURÉ
 * -------------------
 * `index.html` charge `central-sync.js` (ligne 58) AVANT `credential-cache-guard.js`
 * (ligne 66). Le garde enveloppe donc la sauvegarde de la synchronisation : il appelle
 * `previousSave()` — qui a DÉJÀ recopié la fiche complète dans `syncQueue` — puis nettoie
 * le seul magasin `users`.
 *
 * Mesuré sur `d9739797`, Chromium réel contre PostgreSQL réel, par
 * `scripts/syncqueue-credential-browser-gate.mjs` : 13 contrôles sur 24 satisfaits, avec
 * `syncQueue#2.data.password = "VmVycm91LUxvY2FsLUF0ZWxpZXItMjAyNiE="`, que `atob` rend en
 * `Verrou-Local-Atelier-2026!`. Après le correctif : 24 sur 24.
 *
 * CE QUE CE FICHIER AJOUTE
 * -------------------------
 * L'épreuve navigateur ne tourne PAS en intégration continue. Ce fichier ramène le
 * contrat dans `npm test` : le sanitiseur canonique d'un côté, et de l'autre le VRAI
 * `central-sync.js` chargé sur une couche de stockage en mémoire, dans le MÊME ordre
 * d'enveloppes que `index.html` — `central-sync.js` puis `credential-cache-guard.js`.
 *
 * Sans cet ordre, l'épreuve vérifierait un montage qui n'existe nulle part et laisserait
 * passer exactement le défaut mesuré.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHAMPS_CREDENTIELS, estEcritureCredentielle, MESSAGE_CREDENTIEL_EN_LIGNE_SEUL,
  neutraliserEntreeHeritee, porteUnCredentiel, sanitizeLocalUserCredentialFields
} from '../local-credential-contract.js';

const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

/* ═════════════════════ le sanitiseur canonique, fonction pure ═════════════════════ */

test('B4·01 — les trois champs du contrat sont couverts', () => {
  assert.deepEqual([...CHAMPS_CREDENTIELS].sort(), ['password', 'passwordHash', 'passwordScheme']);
});

test('B4·02 — le sanitiseur retire les champs secrets et conserve tout le reste', () => {
  const propre = sanitizeLocalUserCredentialFields({
    id: 7, username: 'resp.rf1', fullName: 'Responsable', role: 'chef', status: 'active',
    password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
  });
  assert.deepEqual(propre, { id: 7, username: 'resp.rf1', fullName: 'Responsable', role: 'chef', status: 'active' });
});

test('B4·03 — le sanitiseur descend dans `data`, là où vit la charge d’une entrée de file', () => {
  const entree = { id: 3, action: 'save', storeName: 'users', status: 'pending',
    data: { id: 7, username: 'resp.rf1', password: 'UGFz' } };
  const propre = sanitizeLocalUserCredentialFields(entree);
  assert.equal(propre.data.password, undefined);
  assert.equal(propre.data.username, 'resp.rf1');
  assert.equal(porteUnCredentiel(propre), false);
});

test('B4·04 — le sanitiseur est PUR : la fiche d’origine n’est pas modifiée', () => {
  const origine = { id: 7, password: 'UGFz', data: { passwordHash: 'UGFz' } };
  sanitizeLocalUserCredentialFields(origine);
  assert.equal(origine.password, 'UGFz');
  assert.equal(origine.data.passwordHash, 'UGFz');
});

test('B4·05 — la détection descend elle aussi : `syncQueue.data.password` est vu', () => {
  assert.equal(porteUnCredentiel({ data: { password: 'UGFz' } }), true);
  assert.equal(porteUnCredentiel({ data: { username: 'resp.rf1' } }), false);
  assert.equal(porteUnCredentiel([{ data: { passwordScheme: 'base64' } }]), true);
});

test('B4·06 — un champ absent ou `undefined` n’est pas un changement d’identifiant', () => {
  assert.equal(estEcritureCredentielle('users', { id: 7, username: 'resp.rf1' }), false);
  assert.equal(estEcritureCredentielle('users', { id: 7, password: undefined }), false);
  assert.equal(estEcritureCredentielle('users', { id: 7, password: 'UGFz' }), true);
});

test('B4·07 — seuls les magasins porteurs sont concernés : une salle n’est pas un identifiant', () => {
  assert.equal(estEcritureCredentielle('rooms', { id: 'salle-1', password: 'UGFz' }), false);
});

test('B4·08 — une entrée héritée est rendue TERMINALE, pas seulement allégée', () => {
  const propre = neutraliserEntreeHeritee({
    id: 42, action: 'save', storeName: 'users', entityId: 7, status: 'pending',
    data: { id: 7, username: 'resp.rf1', fullName: 'Responsable', password: 'UGFz', passwordScheme: 'base64' }
  });
  assert.equal(propre.status, 'failed', 'rejouée sans son mot de passe, elle ferait croire le changement réussi');
  assert.equal(porteUnCredentiel(propre), false);
  assert.equal(propre.data.fullName, 'Responsable', 'l’information non sensible reste vraie');
  assert.equal(propre.lastErrorCode, 'LOCAL_CREDENTIAL_PURGED');
  assert.match(propre.lastError, /ressaisir/i);
});

test('B4·09 — une entrée SANS secret n’est pas touchée : la file appartient à l’utilisateur', () => {
  assert.equal(neutraliserEntreeHeritee({ id: 42, status: 'pending', data: { id: 7, fullName: 'Responsable' } }), null);
});

/* ═════════════ la chaîne réelle : central-sync puis credential-cache-guard ═════════════ */

const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  removeEventListener() {},
  dispatchEvent(evenement) {
    for (const fonction of [...(auditeurs.get(evenement.type) || [])]) fonction(evenement);
    return true;
  }
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
};
globalThis.localStorage = {
  store: new Map(),
  getItem(cle) { return this.store.has(cle) ? this.store.get(cle) : null; },
  setItem(cle, valeur) { this.store.set(cle, String(valeur)); },
  removeItem(cle) { this.store.delete(cle); }
};
globalThis.localStorage.setItem('auth', JSON.stringify({ id: 1, role: 'admin' }));
globalThis.setInterval = () => 0;
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};

const snapshotVide = {
  initialized: true, authoritativeStores: [], data: {}, deleted: [], access: {},
  serverTime: new Date().toISOString()
};
// Ce que le « centre » sert à `/api/sync`. Chaque épreuve le règle : l'INGRESSION est une
// frontière au même titre que l'écriture locale, et elle ne se teste pas avec un
// instantané vide.
let instantaneServi = () => snapshotVide;
// Les charges réellement parties vers le centre, corps compris — c'est le seul endroit où
// se constate ce qui QUITTE le navigateur.
const amorcagesVus = [];
const reponse = (status, corps) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null }, text: async () => JSON.stringify(corps)
});

// Ce que le « serveur » répond à une poussée de fiche. Chaque épreuve le règle.
let reponsePoussee = () => reponse(200, { record: { id: 7401 } });
const pousseesVues = [];

globalThis.fetch = async (chemin, options) => {
  const url = String(chemin);
  if (url.includes('/api/sync/bootstrap')) {
    amorcagesVus.push(options?.body ? JSON.parse(options.body) : null);
    return reponse(200, {});
  }
  if (url.includes('/api/sync')) return reponse(200, instantaneServi());
  if (url.includes('/api/data/')) {
    pousseesVues.push({ url, corps: options?.body ? JSON.parse(options.body) : null });
    return reponsePoussee();
  }
  return reponse(404, { error: 'not-found' });
};

/*
 * La couche de STOCKAGE est remplacée en mémoire AVANT le chargement des deux modules.
 * On remplace les primitives (`_getRaw`, `_deleteRaw`, le `save` de `db.js`), et non les
 * enveloppes : chacune des deux s'installe ensuite par-dessus, dans l'ordre de
 * `index.html`. C'est cet ORDRE qui fait le défaut, et c'est donc lui qu'il faut
 * reproduire.
 */
const magasins = new Map();
const magasin = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

/*
 * Les magasins d'une base RÉELLE existent tous dès l'ouverture — `createStores()` les crée
 * tous, vides. Un banc où un magasin n'existe qu'une fois écrit ferait diverger le
 * produit : `applySnapshot()` saute la lecture de `settings` si le magasin est déclaré
 * absent, et `accorderRevision()` renonce de même. On repose donc la même table.
 */
const MAGASINS_CANONIQUES = Object.freeze([
  'equipments', 'screens', 'screen_issues', 'screen_groups', 'tickets', 'users', 'rooms',
  'baies', 'logs', 'notifications', 'attachments', 'settings', 'syncQueue',
  'diagnosis_history', 'walls', 'notes', 'docs', 'faq', 'cables', 'cable_reports'
]);
const reinitialiserMagasins = () => {
  magasins.clear();
  for (const nom of MAGASINS_CANONIQUES) magasins.set(nom, new Map());
};
reinitialiserMagasins();

/*
 * UNE IndexedDB EN MÉMOIRE, PARCE QUE DEUX CHEMINS CRITIQUES N'EXISTENT QUE LÀ.
 *
 * `accorderRevision()` et `reclamerEntree()` lisent et écrivent dans UNE SEULE transaction
 * — c'est précisément ce qui ferme la fenêtre entre l'accusé du serveur et l'estampille,
 * et la course du double envoi. Ils passent donc par `db.db.transaction(...)` et non par
 * les primitives, et un banc qui ne fournit pas `db.db` les voit simplement RENONCER en
 * silence : `accorderRevision` sort sur `objectStoreNames.contains`.
 *
 * Mesuré : c'est exactement ce qui a laissé B4-R1 passer inaperçu ici. Ce coquillage
 * rend les deux chemins exerçables dans `npm test`, sans rien changer au produit — les
 * requêtes rendent la main de façon asynchrone et la transaction s'achève quand elles
 * sont toutes retombées, comme la vraie.
 */
function coquilleIndexedDB() {
  return {
    /*
     * Énumérable, comme la vraie : c'est par là que la purge découvre les magasins, et un
     * coquillage qui n'exposerait que `contains` laisserait cette découverte intestable —
     * exactement le genre d'angle mort qui a laissé passer B4-R4.
     */
    get objectStoreNames() {
      const noms = [...magasins.keys()];
      return Object.assign(noms.slice(), {
        length: noms.length,
        contains: nom => magasins.has(nom),
        item: index => noms[index]
      });
    },
    transaction(nom) {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      let enCours = 0;
      let acheve = false;
      const acheverSiPret = () => {
        if (acheve || enCours > 0) return;
        acheve = true;
        queueMicrotask(() => transaction.oncomplete?.());
      };
      const differer = (requete, calcul) => {
        enCours += 1;
        queueMicrotask(() => {
          try { requete.result = calcul(); requete.onsuccess?.(); }
          catch (erreur) { requete.error = erreur; requete.onerror?.(); }
          finally { enCours -= 1; acheverSiPret(); }
        });
        return requete;
      };
      const requeteNeuve = () => ({ onsuccess: null, onerror: null, result: undefined, error: null });
      transaction.objectStore = () => ({
        get: id => differer(requeteNeuve(),
          () => { const f = magasin(nom).get(String(id)); return f ? structuredClone(f) : undefined; }),
        // `replaceStoreAtomically()` lit puis remplace le magasin ENTIER dans une seule
        // transaction : sans `getAll` ni `delete`, l'ingression d'un instantané resterait
        // hors de portée du banc, et son assainissement intestable.
        getAll: () => differer(requeteNeuve(),
          () => [...magasin(nom).values()].map(f => structuredClone(f))),
        delete: id => differer(requeteNeuve(), () => { magasin(nom).delete(String(id)); return undefined; }),
        clear: () => differer(requeteNeuve(), () => { magasin(nom).clear(); return undefined; }),
        put: fiche => differer(requeteNeuve(),
          () => {
            journalDesEcritures.push({ magasin: nom, fiche: structuredClone(fiche) });
            magasin(nom).set(String(fiche.id), structuredClone(fiche));
            return fiche.id;
          })
      });
      queueMicrotask(acheverSiPret);
      return transaction;
    }
  };
}

const { db } = await import('../db.js');
db.db = coquilleIndexedDB();
db.open = async () => db;
db.getAll = async nom => [...magasin(nom).values()].map(fiche => structuredClone(fiche));
db.get = async (nom, id) => {
  const fiche = magasin(nom).get(String(id));
  return fiche ? structuredClone(fiche) : undefined;
};
/*
 * LE JOURNAL DES ÉCRITURES.
 *
 * L'état FINAL des magasins ne suffit pas à juger ce contrat : un secret écrit puis
 * effacé une milliseconde plus tard a bel et bien touché le disque du poste, et c'est
 * précisément la forme du défaut d'origine — `credential-cache-guard.js` nettoyait APRÈS
 * coup. On retient donc tout ce qui a été écrit, pour pouvoir dire que rien ne l'a été.
 */
const journalDesEcritures = [];
db.save = async (nom, donnees) => {
  const charge = { ...donnees };
  if (charge.id === '' || charge.id === undefined || charge.id === null) charge.id = `auto-${magasin(nom).size + 1}`;
  journalDesEcritures.push({ magasin: nom, fiche: structuredClone(charge) });
  magasin(nom).set(String(charge.id), structuredClone(charge));
  return charge.id;
};
db._getRaw = async (nom, id) => {
  const fiche = magasin(nom).get(String(id));
  return fiche ? structuredClone(fiche) : undefined;
};
db._deleteRaw = async (nom, id) => { magasin(nom).delete(String(id)); return true; };
db._saveRaw = async (nom, fiche) => {
  journalDesEcritures.push({ magasin: nom, fiche: structuredClone(fiche) });
  magasin(nom).set(String(fiche.id), structuredClone(fiche));
  return fiche.id;
};

// L'ORDRE DE `index.html`, et pas un autre.
await import('../central-sync.js');
await import('../credential-cache-guard.js');

const ordreDansIndex = lire('index.html');
test('B4·10 — l’ordre reproduit ici est bien celui de `index.html`', () => {
  const central = ordreDansIndex.indexOf('src="central-sync.js"');
  const garde = ordreDansIndex.indexOf('src="credential-cache-guard.js"');
  assert.ok(central > -1 && garde > -1, 'les deux modules doivent être déclarés dans index.html');
  assert.ok(central < garde,
    'si cet ordre change, le défaut mesuré change de forme : l’épreuve doit être relue, pas seulement relancée');
});

const secretsPersistes = () => {
  const trouves = [];
  for (const [nom, contenu] of magasins) {
    for (const fiche of contenu.values()) {
      if (porteUnCredentiel(fiche)) trouves.push({ magasin: nom, id: fiche.id, fiche });
    }
  }
  return trouves;
};

async function repartirDeZero({ enLigne }) {
  reinitialiserMagasins();
  pousseesVues.length = 0;
  journalDesEcritures.length = 0;
  amorcagesVus.length = 0;
  instantaneServi = () => snapshotVide;
  reponsePoussee = () => reponse(200, { record: {} });
  if (enLigne) await db.enableCentralSync({ bootstrapLocal: false });
  else await db.couperLeCentralPourEpreuve();
}

// `remoteReady` est privé à `central-sync.js` : une réponse 401 sur une poussée est la
// seule voie publique qui le rabaisse, et c'est exactement ce que vit un poste déconnecté.
db.couperLeCentralPourEpreuve = async function couperLeCentral() {
  await db.enableCentralSync({ bootstrapLocal: false });
  reponsePoussee = () => reponse(401, { error: 'UNAUTHENTICATED' });
  await db.save('rooms', { id: 'salle-bascule', name: 'Bascule' }).catch(() => {});
  magasins.get('syncQueue')?.clear();
  magasins.get('rooms')?.delete('salle-bascule');
};

test('B4·11 — hors ligne, une modification NON sensible est mise en file, sans secret', async () => {
  await repartirDeZero({ enLigne: false });
  await db.save('users', { id: 7401, username: 'resp.rf1', fullName: 'Responsable Renommé', role: 'chef', status: 'active' });
  const file = await db.getAll('syncQueue');
  const entree = file.find(item => item.storeName === 'users' && String(item.entityId) === '7401');
  assert.ok(entree, 'la modification de profil hors ligne doit rester rattrapable');
  assert.equal(entree.data.fullName, 'Responsable Renommé');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·12 — hors ligne, un changement de mot de passe est REFUSÉ et rien n’est écrit', async () => {
  await repartirDeZero({ enLigne: false });
  await assert.rejects(
    () => db.save('users', { id: 7402, username: 'resp.rf2', fullName: 'Responsable', role: 'chef', status: 'active', password: 'UGFz' }),
    erreur => {
      assert.equal(erreur.code, 'CREDENTIAL_REQUIRES_CENTRAL');
      assert.equal(erreur.message, MESSAGE_CREDENTIEL_EN_LIGNE_SEUL);
      return true;
    });
  assert.deepEqual(secretsPersistes(), [], 'aucun secret ne doit avoir touché le disque');
  assert.equal((await db.getAll('syncQueue')).length, 0, 'un secret n’entre jamais dans la file');
  assert.equal(await db.get('users', 7402), undefined, 'la fiche ne doit pas rester à moitié créée');
});

test('B4·13 — hors ligne, un changement refusé ne défigure pas la fiche existante', async () => {
  await repartirDeZero({ enLigne: false });
  await db.save('users', { id: 7403, username: 'resp.rf3', fullName: 'Nom D’Origine', role: 'chef', status: 'active' });
  await assert.rejects(() => db.save('users', {
    id: 7403, username: 'resp.rf3', fullName: 'Nom Réécrit', role: 'chef', status: 'active', password: 'UGFz'
  }));
  const fiche = await db.get('users', 7403);
  assert.equal(fiche.fullName, 'Nom D’Origine', 'l’écriture refusée doit être entièrement défaite');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·14 — en ligne, le serveur reçoit le mot de passe et le poste n’en garde rien', async () => {
  await repartirDeZero({ enLigne: true });
  reponsePoussee = () => reponse(200, { record: { id: 7404, username: 'resp.rf4', fullName: 'Responsable', role: 'chef', status: 'active' } });
  await db.save('users', { id: 7404, username: 'resp.rf4', fullName: 'Responsable', role: 'chef', status: 'active', password: 'UGFz' });
  const pousseeUtilisateur = pousseesVues.find(p => p.url.includes('/api/data/users/'));
  assert.ok(pousseeUtilisateur, 'le changement doit bel et bien partir au centre');
  assert.equal(pousseeUtilisateur.corps?.record?.password ?? pousseeUtilisateur.corps?.password, 'UGFz',
    'le serveur est le seul à devoir recevoir la matière : sans cela le mot de passe ne changerait nulle part');
  assert.deepEqual(secretsPersistes(), [], 'rien ne reste sur le poste après un changement réussi');
});

test('B4·15 — un refus DÉFINITIF laisse une entrée terminale sans la moindre matière', async () => {
  await repartirDeZero({ enLigne: true });
  reponsePoussee = () => reponse(409, { error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 9 });
  await db.save('users', {
    id: 7405, username: 'resp.rf5', fullName: 'Responsable', role: 'chef', status: 'active', password: 'UGFz'
  }).catch(() => {});
  const terminales = (await db.getAll('syncQueue')).filter(e => ['conflict', 'failed'].includes(e.status));
  assert.deepEqual(secretsPersistes(), []);
  for (const entree of terminales) assert.equal(porteUnCredentiel(entree), false);
});

test('B4·16 — les lignes HÉRITÉES sont neutralisées avant la moindre reprise', async () => {
  await repartirDeZero({ enLigne: true });
  // Écrites par la primitive de `db.js`, comme une version antérieure les a laissées.
  for (const [index, statut] of ['pending', 'processing', 'conflict', 'failed'].entries()) {
    magasin('syncQueue').set(String(90100 + index), {
      id: 90100 + index, action: 'save', storeName: 'users', entityId: 7500 + index,
      status: statut, attempts: 1, timestamp: new Date().toISOString(),
      data: { id: 7500 + index, username: `heritee-${statut}`, fullName: 'Héritée',
        password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64' }
    });
  }
  pousseesVues.length = 0;
  await db.processSyncQueue();

  assert.deepEqual(secretsPersistes(), [], 'plus aucun secret dans aucun magasin');
  const heritees = (await db.getAll('syncQueue')).filter(e => Number(e.id) >= 90100 && Number(e.id) <= 90199);
  assert.equal(heritees.length, 4, 'les entrées restent visibles : l’opérateur doit savoir quoi ressaisir');
  for (const entree of heritees) {
    assert.ok(['conflict', 'failed'].includes(entree.status),
      `l’entrée ${entree.id} est repartie (${entree.status}) : le profil serait accepté, le mot de passe non`);
  }
  assert.equal(pousseesVues.length, 0, 'aucune ligne héritée ne doit avoir été rejouée');
});

test('B4·17 — le garde nettoie le disque SANS attendre le réseau', async () => {
  reinitialiserMagasins();
  magasin('users').set('7600', { id: 7600, username: 'resp.rf6', fullName: 'Responsable',
    password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64' });
  magasin('syncQueue').set('90200', { id: 90200, action: 'save', storeName: 'users', entityId: 7600,
    status: 'pending', data: { id: 7600, username: 'resp.rf6', password: 'UGFz' } });

  const { purgeLocalCredentialResidue } = await import('../credential-cache-guard.js');
  await purgeLocalCredentialResidue();

  assert.deepEqual(secretsPersistes(), []);
  assert.equal((await db.get('users', 7600)).fullName, 'Responsable', 'le reste de la fiche est conservé');
  assert.equal((await db.getAll('syncQueue'))[0].status, 'failed');
});

test('B4·18 — la file reste propre même pour un magasin que le prédicat ne couvre pas', async () => {
  /*
   * `estEcritureCredentielle` ne regarde que les magasins porteurs — `users`. La file,
   * elle, reçoit les écritures de TOUS les magasins. Une fiche d'un autre magasin
   * portant un champ `password` n'est donc arrêtée par rien d'autre que l'assainissement
   * posé sur la file elle-même : c'est sa raison d'être, et c'est ce qui est vérifié ici.
   *
   * L'invariant ne dit pas « le magasin `users` » mais « aucun magasin persistant » :
   * `syncQueue` ne garde pas de matière d'authentification, quelle qu'en soit l'origine.
   */
  await repartirDeZero({ enLigne: false });
  await db.save('settings', { id: 'poste-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordScheme: 'base64' });
  const file = await db.getAll('syncQueue');
  const entree = file.find(item => item.storeName === 'settings');
  assert.ok(entree, 'l’écriture hors ligne doit rester rattrapable');
  assert.equal(entree.data.libelle, 'Poste atelier');
  assert.equal(porteUnCredentiel(entree), false,
    'la file est une frontière : rien de secret ne la franchit, quel que soit le magasin');
});

test('B4·19 — le secret ne touche JAMAIS le disque, pas même le temps d’un nettoyage', async () => {
  /*
   * C'est ici que se joue la différence entre le correctif et le défaut. L'ancien montage
   * écrivait la fiche complète puis la nettoyait : l'état final était propre, et le secret
   * avait pourtant été posé sur le poste — avec, entre les deux, la recopie vers la file.
   *
   * Le journal retient chaque écriture faite aux primitives. Un changement de mot de passe
   * EN LIGNE, entièrement réussi, ne doit en avoir produit AUCUNE qui porte la matière.
   */
  await repartirDeZero({ enLigne: true });
  reponsePoussee = () => reponse(200, { record: { id: 7406, username: 'resp.rf7', fullName: 'Responsable', role: 'chef', status: 'active' } });
  journalDesEcritures.length = 0;
  await db.save('users', { id: 7406, username: 'resp.rf7', fullName: 'Responsable', role: 'chef', status: 'active', password: 'UGFz' });

  assert.ok(journalDesEcritures.length > 0, 'sans écriture observée, l’épreuve ne prouverait rien');
  const fautives = journalDesEcritures.filter(ecriture => porteUnCredentiel(ecriture.fiche));
  assert.deepEqual(fautives, [],
    'une écriture porteuse a été posée puis rattrapée : le secret a bel et bien touché le disque');
  assert.ok(pousseesVues.some(p => p.url.includes('/api/data/users/')),
    'et le changement doit tout de même être parti au centre');
});

test('B4·20 — la file n’a qu’UN écrivain, et il assainit', () => {
  /*
   * La règle ne tient que si elle est posée à l'entrée du magasin, et non sur chaque
   * appelant : `central-sync.js` écrit dans `syncQueue` depuis neuf endroits, dont deux
   * chemins de reprise qui réécrivent l'entrée depuis une copie EN MÉMOIRE, prise avant
   * tout nettoyage. Un onglet concurrent pouvait ainsi reposer sur le disque un secret
   * qu'un autre venait d'en retirer.
   *
   * Ce contrôle est STRUCTUREL : il garde la propriété « un seul écrivain », que la
   * course qu'elle ferme ne se reproduit pas dans un contexte unique.
   */
  const central = lire('central-sync.js');
  const ecrituresNues = [...central.matchAll(/originalSave\('syncQueue'/g)];
  assert.equal(ecrituresNues.length, 1,
    'toute écriture de file doit passer par `ecrireDansLaFile`, seul autorisé à appeler `originalSave`');
  assert.match(central, /async function ecrireDansLaFile\(entree\) \{\s*return originalSave\('syncQueue', sanitizeLocalUserCredentialFields\(entree\)\);/);

  // La réclamation réécrit elle aussi l'entrée, dans sa propre transaction.
  const reclamation = central.slice(central.indexOf('function reclamerEntree'), central.indexOf('LA REPRISE EN COURS'));
  assert.match(reclamation, /reclamee = sanitizeLocalUserCredentialFields\(/,
    'réclamer une ligne héritée ne doit pas reposer son mot de passe sur le disque');
});

test('B4·21 — une fiche héritée encore porteuse ne transforme pas un renommage en refus', async () => {
  /*
   * Sur un poste dont le magasin `users` n'a pas encore été purgé, la fiche locale porte
   * toujours `password`. Reconduire ce champ dans une modification de PROFIL rendrait
   * celle-ci indiscernable d'un changement d'identifiant : hors ligne, elle serait
   * refusée, et un simple renommage deviendrait impossible sans connexion.
   *
   * La modification ne mentionne donc plus le mot de passe du tout. Elle reste hors ligne
   * capable, et ne fait rien remonter du champ hérité.
   */
  await repartirDeZero({ enLigne: false });
  magasin('users').set('7407', {
    id: 7407, username: 'resp.rf8', fullName: 'Nom D’Origine', role: 'chef', status: 'active',
    password: 'UGFz', passwordScheme: 'base64'
  });
  const existante = await db.get('users', 7407);
  const { password: _mdp, passwordScheme: _schema, ...profilSeul } = existante;

  await db.save('users', { ...profilSeul, fullName: 'Nom Renommé' });

  const file = await db.getAll('syncQueue');
  const entree = file.find(item => item.storeName === 'users' && String(item.entityId) === '7407');
  assert.ok(entree, 'un renommage hors ligne doit rester possible même sur une fiche héritée');
  assert.equal(entree.data.fullName, 'Nom Renommé');
  assert.equal(porteUnCredentiel(entree), false, 'et il ne doit rien emporter du champ hérité');
});

/* ═══════════ R1 — LA RÉVISION APRÈS UN CHANGEMENT DE MOT DE PASSE RÉUSSI ═══════════ */

/**
 * CE QUE LA REVUE INDÉPENDANTE A TROUVÉ (B4-R1).
 *
 * `users` est un magasin À RÉVISION (`revision-contract.js`). Après une poussée acceptée,
 * `accorderRevision()` relit la fiche locale et ne l'estampille QUE si son contenu est
 * encore celui qui est parti — c'est ainsi qu'une saisie intercalée n'est pas écrasée.
 *
 * Or le correctif B-4 persiste désormais une fiche ASSAINIE et envoie une charge qui porte
 * le mot de passe. La comparaison portait donc sur deux fiches délibérément différentes :
 * elle échouait TOUJOURS, et la révision acquittée n'était jamais rangée.
 *
 * Conséquence, sans aucun concurrent : un changement de mot de passe réussi laissait la
 * fiche locale en révision N pendant que le serveur passait à N+1. La modification de
 * profil suivante repartait avec N et se faisait refuser en STALE_WRITE.
 */
test('B4·22 — un changement de mot de passe réussi estampille la révision, fiche assainie', async () => {
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7410', {
    id: 7410, username: 'resp.rev', fullName: 'Responsable', role: 'chef', status: 'active', _revision: 4
  });

  reponsePoussee = () => reponse(200, { revision: 5, record: { id: 7410 } });
  await db.save('users', {
    id: 7410, username: 'resp.rev', fullName: 'Responsable', role: 'chef', status: 'active',
    _revision: 4, password: 'UGFz'
  });

  const fiche = await db.get('users', 7410);
  assert.equal(porteUnCredentiel(fiche), false, 'la fiche locale reste sans matière d’authentification');
  assert.equal(fiche._revision, 5,
    'la révision acquittée par le serveur doit être rangée : sinon la prochaine écriture repart périmée');
});

test('B4·23 — et la modification de profil qui suit n’est pas refusée en STALE_WRITE', async () => {
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7411', {
    id: 7411, username: 'resp.suite', fullName: 'Responsable', role: 'chef', status: 'active', _revision: 4
  });

  // Le « serveur » n'accepte que la révision qu'il détient, comme le vrai.
  let revisionServeur = 4;
  reponsePoussee = () => reponse(200, { revision: revisionServeur, record: { id: 7411 } });
  const pousseeAvecArbitrage = (corps) => {
    const vue = Number(corps?.[ '_revision' ] ?? 0);
    if (vue !== revisionServeur) {
      return reponse(409, { error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: revisionServeur });
    }
    revisionServeur += 1;
    return reponse(200, { revision: revisionServeur, record: { id: 7411 } });
  };

  const vraiFetch = globalThis.fetch;
  globalThis.fetch = async (chemin, options) => {
    if (String(chemin).includes('/api/data/users/')) {
      const corps = options?.body ? JSON.parse(options.body) : null;
      pousseesVues.push({ url: String(chemin), corps });
      return pousseeAvecArbitrage(corps);
    }
    return vraiFetch(chemin, options);
  };

  try {
    // 1) changement de mot de passe : accepté, le serveur passe de 4 à 5.
    await db.save('users', {
      id: 7411, username: 'resp.suite', fullName: 'Responsable', role: 'chef', status: 'active',
      _revision: 4, password: 'UGFz'
    });
    assert.equal(revisionServeur, 5, 'le changement de mot de passe doit avoir été accepté');

    // 2) renommage IMMÉDIAT, sans nouvel instantané central.
    const courante = await db.get('users', 7411);
    await db.save('users', { ...courante, fullName: 'Responsable Renommé' });
  } finally {
    globalThis.fetch = vraiFetch;
  }

  const derniere = pousseesVues.at(-1);
  assert.notEqual(derniere?.corps?._revision, 4,
    'le renommage repart avec la révision périmée : le serveur le refuse alors que personne d’autre n’a touché la fiche');
  const fiche = await db.get('users', 7411);
  assert.equal(fiche.fullName, 'Responsable Renommé', 'le renommage doit avoir abouti');
  assert.equal(porteUnCredentiel(fiche), false);
});

/* ═══════════ R2 — LE RETOUR ARRIÈRE NE REPOSE PAS UN SECRET HÉRITÉ ═══════════ */

/**
 * CE QUE LA REVUE INDÉPENDANTE A TROUVÉ (B4-R2).
 *
 * `previous` est lu BRUT dans IndexedDB avant l'écriture. Sur un poste dont la purge n'a
 * pas encore tourné, échoué, ou n'a pas fini, cette fiche porte encore le mot de passe.
 * Les trois chemins de retour arrière la reposaient telle quelle.
 *
 * Et le garde extérieur ne rattrape rien : `previousSave` REJETTE, donc `scrubUserRecord`
 * n'est jamais atteint. Le secret revenait sur le disque au moment précis où l'opération
 * échouait.
 */
async function semerFicheHeritee(id) {
  magasin('users').set(String(id), {
    id, username: `resp.heritee-${id}`, fullName: 'Nom D’Origine', role: 'chef', status: 'active',
    _revision: 3, password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
  });
}

test('B4·24 — refus DÉFINITIF : le retour arrière ne repose aucun champ secret', async () => {
  await repartirDeZero({ enLigne: true });
  await semerFicheHeritee(7420);
  journalDesEcritures.length = 0;

  reponsePoussee = () => reponse(409, { error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 9 });
  await db.save('users', {
    id: 7420, username: 'resp.heritee-7420', fullName: 'Nom Réécrit', role: 'chef', status: 'active',
    _revision: 3, password: 'Tm91dmVhdQ=='
  }).catch(() => {});

  const fiche = await db.get('users', 7420);
  assert.ok(fiche, 'la fiche doit être restaurée, pas supprimée');
  assert.equal(fiche.fullName, 'Nom D’Origine', 'les champs non sensibles d’avant sont préservés');
  assert.equal(porteUnCredentiel(fiche), false,
    'le retour arrière a reposé la fiche héritée telle quelle, secret compris');
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), [],
    'aucune écriture porteuse ne doit avoir touché le disque, pas même le temps du retour arrière');
});

test('B4·25 — panne réseau en cours de route : le retour arrière ne repose aucun secret', async () => {
  await repartirDeZero({ enLigne: true });
  await semerFicheHeritee(7421);
  journalDesEcritures.length = 0;

  const vraiFetch = globalThis.fetch;
  globalThis.fetch = async (chemin, options) => {
    if (String(chemin).includes('/api/data/users/')) throw new TypeError('Failed to fetch');
    return vraiFetch(chemin, options);
  };
  try {
    await db.save('users', {
      id: 7421, username: 'resp.heritee-7421', fullName: 'Nom Réécrit', role: 'chef', status: 'active',
      _revision: 3, password: 'Tm91dmVhdQ=='
    }).catch(() => {});
  } finally {
    globalThis.fetch = vraiFetch;
  }

  const fiche = await db.get('users', 7421);
  assert.ok(fiche, 'la fiche doit être restaurée, pas supprimée');
  assert.equal(fiche.fullName, 'Nom D’Origine');
  assert.equal(porteUnCredentiel(fiche), false);
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), []);
  assert.equal((await db.getAll('syncQueue')).length, 0, 'et le secret n’entre pas davantage dans la file');
});

test('B4·26 — suppression refusée : le retour arrière ne repose aucun secret non plus', async () => {
  await repartirDeZero({ enLigne: true });
  await semerFicheHeritee(7422);
  journalDesEcritures.length = 0;

  reponsePoussee = () => reponse(409, { error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 9 });
  await db._deleteRaw('users', 7422).catch(() => {});

  const fiche = await db.get('users', 7422);
  assert.ok(fiche, 'la suppression refusée doit restaurer la fiche');
  assert.equal(fiche.fullName, 'Nom D’Origine');
  assert.equal(porteUnCredentiel(fiche), false);
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), []);
});

/* ═══════════ LA TROISIÈME MESURE DEMANDÉE — SESSION PERDUE, LIAISON CRUE VIVANTE ═══════════ */

/**
 * `remoteReady` vit en mémoire dans `central-sync.js` ; `localStorage.auth` est retirée à
 * la déconnexion. Entre les deux il existe une fenêtre où la liaison est CRUE vivante
 * alors que l'identité a disparu — `hasAuthenticatedIdentity()` est faux, donc
 * `shouldSync` est faux, donc RIEN n'est envoyé au serveur.
 *
 * Mesuré : le changement de mot de passe rendait alors la main SANS erreur. La fiche
 * locale était bien assainie — aucun secret ne fuyait — mais l'opérateur repartait avec
 * la certitude d'un mot de passe changé que le serveur n'avait jamais reçu. C'est le
 * faux succès que le contrat B-4 interdit, et il est atteignable.
 */
test('B4·27 — sans session locale, un changement de mot de passe échoue au lieu de mentir', async () => {
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7430', {
    id: 7430, username: 'resp.sansession', fullName: 'Responsable', role: 'chef', status: 'active', _revision: 2
  });
  pousseesVues.length = 0;

  const auth = globalThis.localStorage.getItem('auth');
  globalThis.localStorage.removeItem('auth');
  let refus = null;
  try {
    await db.save('users', {
      id: 7430, username: 'resp.sansession', fullName: 'Responsable', role: 'chef', status: 'active',
      _revision: 2, password: 'UGFz'
    });
  } catch (erreur) { refus = erreur; }
  finally { globalThis.localStorage.setItem('auth', auth); }

  assert.ok(refus, 'rien n’est parti au serveur : rendre la main sans erreur annoncerait un changement qui n’a pas eu lieu');
  assert.equal(refus.code, 'CREDENTIAL_REQUIRES_CENTRAL');
  assert.equal(pousseesVues.filter(p => p.url.includes('/api/data/users/')).length, 0,
    'et il faut bien qu’aucune poussée n’ait eu lieu, sans quoi l’épreuve ne mesure pas ce cas');
  assert.deepEqual(secretsPersistes(), []);
});

/* ═══════════ R3 — UNE ROTATION PENDANT L'APPLICATION D'UN INSTANTANÉ ═══════════ */

/**
 * CE QUE LA REVUE INDÉPENDANTE A TROUVÉ (B4-R3).
 *
 * `applySnapshot()` lève `syncing` pendant tout son travail — lectures et écritures
 * IndexedDB comprises, donc sur plusieurs tours de boucle. Rien ne prouve que l'interface
 * soit inerte pendant cet intervalle : un geste d'opérateur peut s'y intercaler.
 *
 * Or la garde « en ligne seulement » se lisait `!syncing && …` : pendant l'application,
 * elle était simplement SAUTÉE. `shouldSync` l'étant aussi, aucune requête ne partait —
 * et `db.save` rendait la main sans erreur. L'écran pouvait annoncer un mot de passe
 * changé que le serveur n'a jamais reçu.
 *
 * C'est le même faux succès que la fenêtre sans session, par une autre porte.
 *
 * Le banc n'invente pas l'état : il tient la VRAIE application d'instantané ouverte, en
 * suspendant la première lecture que `applySnapshot()` attend. `syncing` est donc vrai
 * parce que le produit l'a levé, pas parce qu'un test l'a écrit.
 */
async function pendantApplicationInstantane(travail) {
  const vraiGetRaw = db._getRaw;
  let relacher;
  const suspendue = new Promise(resolve => { relacher = resolve; });
  let atteinte;
  const entree = new Promise(resolve => { atteinte = resolve; });

  db._getRaw = async (nom, id) => {
    if (nom === 'settings' && id === 'current-room') {
      atteinte();
      await suspendue;
      db._getRaw = vraiGetRaw;
    }
    return vraiGetRaw(nom, id);
  };

  const application = db.enableCentralSync({ bootstrapLocal: false });
  await entree;                       // `applySnapshot` est entrée : `syncing` est vrai.
  try { return await travail(); }
  finally {
    relacher();
    db._getRaw = vraiGetRaw;
    await application.catch(() => {});
  }
}

test('B4·28 — pendant l’application d’un instantané, une rotation échoue au lieu de mentir', async () => {
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7440', {
    id: 7440, username: 'resp.instantane', fullName: 'Responsable', role: 'chef', status: 'active', _revision: 2
  });
  pousseesVues.length = 0;
  journalDesEcritures.length = 0;

  const refus = await pendantApplicationInstantane(async () => {
    try {
      await db.save('users', {
        id: 7440, username: 'resp.instantane', fullName: 'Responsable', role: 'chef', status: 'active',
        _revision: 2, password: 'UGFz'
      });
      return null;
    } catch (erreur) { return erreur; }
  });

  assert.ok(refus, 'aucune requête ne part pendant l’application : rendre la main sans erreur annonce un changement qui n’a pas eu lieu');
  assert.equal(refus.code, 'CREDENTIAL_REQUIRES_CENTRAL');
  assert.equal(pousseesVues.filter(p => p.url.includes('/api/data/users/')).length, 0,
    'et il faut bien qu’aucune poussée n’ait eu lieu, sans quoi l’épreuve ne mesure pas ce cas');
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), [],
    'aucune écriture porteuse ne doit avoir touché le disque');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·29 — une modification NON sensible garde son comportement pendant l’application', async () => {
  /*
   * La garde ne doit fermer QUE la rotation d'identifiant. Un renommage pendant
   * l'application d'un instantané conserve exactement la sémantique qu'il avait :
   * `shouldSync` reste faux, l'écriture reste locale, et rien n'est refusé.
   */
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7441', {
    id: 7441, username: 'resp.profil', fullName: 'Nom D’Origine', role: 'chef', status: 'active', _revision: 2
  });

  const erreur = await pendantApplicationInstantane(async () => {
    try {
      await db.save('users', {
        id: 7441, username: 'resp.profil', fullName: 'Nom Renommé', role: 'chef', status: 'active', _revision: 2
      });
      return null;
    } catch (e) { return e; }
  });

  assert.equal(erreur, null, 'un renommage ne doit pas être refusé pendant l’application d’un instantané');
  assert.equal((await db.get('users', 7441)).fullName, 'Nom Renommé');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·30 — l’application terminée, une rotation en ligne réussit de nouveau', async () => {
  // Sans cela, « tout refuser » passerait pour un correctif.
  await repartirDeZero({ enLigne: true });
  magasin('users').set('7442', {
    id: 7442, username: 'resp.apres', fullName: 'Responsable', role: 'chef', status: 'active', _revision: 2
  });
  pousseesVues.length = 0;
  reponsePoussee = () => reponse(200, { revision: 3, record: { id: 7442 } });

  await db.save('users', {
    id: 7442, username: 'resp.apres', fullName: 'Responsable', role: 'chef', status: 'active',
    _revision: 2, password: 'UGFz'
  });

  assert.equal(pousseesVues.filter(p => p.url.includes('/api/data/users/')).length, 1,
    'la rotation doit bel et bien être partie au centre');
  const fiche = await db.get('users', 7442);
  assert.equal(fiche._revision, 3, 'et la continuité de révision (R1) reste acquise');
  assert.equal(porteUnCredentiel(fiche), false);
});

/* ═══════════ R4 — LA SANITATION DE PERSISTANCE NE CONNAÎT PAS DE MAGASIN PRIVILÉGIÉ ═══════════ */

/**
 * CE QUE LA REVUE INDÉPENDANTE A TROUVÉ (B4-R4 / Codex P1).
 *
 * Deux questions avaient été confondues sous un seul prédicat :
 *
 *   · « cette fiche porte-t-elle de la matière d'authentification ? » — vrai pour
 *     N'IMPORTE quel magasin, et c'est ce qui décide de ce qu'on POSE sur le disque ;
 *   · « est-ce une rotation d'identifiant d'utilisateur ? » — vrai pour `users` seul, et
 *     c'est ce qui décide si l'écriture exige le centre.
 *
 * `payloadLocal` n'était assaini que sur la seconde. Une fiche `settings` portant
 * `password` était donc recopiée TELLE QUELLE dans IndexedDB — la file, elle, était bien
 * nettoyée, et c'est tout ce que B4·18 vérifiait. L'épreuve passait au vert en ne prouvant
 * que la moitié de l'invariant qu'elle prétendait garder.
 *
 * Ces épreuves-ci tiennent l'invariant entier : AUCUN magasin persistant ne retient de
 * matière d'authentification — et une fiche `settings` reste une fiche `settings`, pas
 * une rotation de mot de passe.
 */
test('B4·31 — une fiche NON `users` portant un champ secret est assainie AVANT le disque', async () => {
  await repartirDeZero({ enLigne: false });
  journalDesEcritures.length = 0;

  await db.save('settings', {
    id: 'poste-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordScheme: 'base64'
  });

  const fiche = await db.get('settings', 'poste-atelier');
  assert.equal(fiche.libelle, 'Poste atelier', 'le reste de la fiche est conservé intact');
  assert.equal(porteUnCredentiel(fiche), false,
    'la fiche `settings` a été recopiée telle quelle sur le disque : la file seule était nettoyée');
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), [],
    'aucune écriture porteuse ne doit avoir touché le disque, pas même un instant');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·32 — et elle garde la sémantique de synchronisation d’une fiche `settings`', async () => {
  /*
   * Le point de vigilance de la revue : ne PAS transformer toute fiche portant un champ
   * nommé `password` en rotation d'identifiant. Hors ligne, cette écriture doit se mettre
   * en file comme n'importe quelle écriture `settings` — pas être refusée.
   */
  await repartirDeZero({ enLigne: false });

  let refus = null;
  try {
    await db.save('settings', { id: 'poste-atelier', libelle: 'Poste atelier', password: 'UGFz' });
  } catch (erreur) { refus = erreur; }

  assert.equal(refus, null, 'une fiche `settings` n’est pas une rotation d’identifiant : elle ne doit pas être refusée');
  const entree = (await db.getAll('syncQueue')).find(item => item.storeName === 'settings');
  assert.ok(entree, 'elle reste mise en file, comme toute écriture `settings` hors ligne');
  assert.equal(entree.data.libelle, 'Poste atelier');
  assert.equal(porteUnCredentiel(entree), false);
});

test('B4·33 — un résidu HÉRITÉ dans un magasin non `users` est nettoyé au démarrage', async () => {
  /*
   * La purge ne parcourait que `MAGASINS_PORTEURS_DE_CREDENTIELS` — `users` — puis
   * `syncQueue`. Un secret laissé par une version antérieure dans un autre magasin y
   * restait indéfiniment, sans que rien ne le regarde jamais.
   */
  reinitialiserMagasins();
  magasin('settings').set('poste-atelier', {
    id: 'poste-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
  });
  magasin('notes').set('42', { id: 42, targetType: 'room', texte: 'Relevé', password: 'UGFz' });
  magasin('users').set('7700', { id: 7700, username: 'resp.rf9', fullName: 'Responsable', password: 'UGFz' });

  const { purgeLocalCredentialResidue } = await import('../credential-cache-guard.js');
  await purgeLocalCredentialResidue();

  assert.deepEqual(secretsPersistes(), [], 'aucun magasin persistant ne doit garder de matière d’authentification');
  assert.equal((await db.get('settings', 'poste-atelier')).libelle, 'Poste atelier',
    'les champs non sensibles sont préservés, pas la fiche supprimée');
  assert.equal((await db.get('notes', 42)).texte, 'Relevé');
  assert.equal((await db.get('users', 7700)).fullName, 'Responsable');
});

test('B4·34 — la purge ne touche QUE les noms exacts du contrat', async () => {
  // « passwordPolicyLabel » ou « motDePasseOublieUrl » sont des champs métier légitimes.
  reinitialiserMagasins();
  magasin('settings').set('global', {
    id: 'global', theme: 'light', passwordPolicyLabel: 'Politique renforcée',
    motDePasseOublieUrl: 'https://exemple/mdp', password: 'UGFz'
  });

  const { purgeLocalCredentialResidue } = await import('../credential-cache-guard.js');
  await purgeLocalCredentialResidue();

  const fiche = await db.get('settings', 'global');
  assert.equal(fiche.password, undefined);
  assert.equal(fiche.passwordPolicyLabel, 'Politique renforcée', 'un champ métier ne doit pas disparaître');
  assert.equal(fiche.motDePasseOublieUrl, 'https://exemple/mdp');
  assert.equal(fiche.theme, 'light');
});

test('B4·35 — le retour arrière d’un magasin NON `users` ne repose pas de secret hérité', async () => {
  /*
   * Le retour arrière est une écriture locale comme une autre : il obéit à la sanitation
   * de persistance, pas au prédicat de rotation d'identifiant. Une fiche de réglages
   * laissée porteuse par une version antérieure ne doit pas revenir intacte sur le disque
   * au moment précis où l'écriture échoue.
   */
  await repartirDeZero({ enLigne: true });
  magasin('settings').set('poste-atelier', {
    id: 'poste-atelier', libelle: 'Réglage D’Origine', _revision: 3,
    password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
  });
  journalDesEcritures.length = 0;

  reponsePoussee = () => reponse(409, { error: 'STALE_WRITE', code: 'STALE_WRITE', currentRevision: 9 });
  await db.save('settings', { id: 'poste-atelier', libelle: 'Réglage Réécrit', _revision: 3 }).catch(() => {});

  const fiche = await db.get('settings', 'poste-atelier');
  assert.ok(fiche, 'la fiche doit être restaurée, pas supprimée');
  assert.equal(fiche.libelle, 'Réglage D’Origine', 'les champs non sensibles d’avant sont préservés');
  assert.equal(porteUnCredentiel(fiche), false,
    'le retour arrière a reposé la fiche héritée telle quelle, secret compris');
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), []);
});

/* ═══════════ R5 — LES FRONTIÈRES QUI NE PASSENT PAS PAR `db.save` ═══════════ */

/**
 * CE QUE LA REVUE INDÉPENDANTE A TROUVÉ (B4-R5).
 *
 * Tout ce qui précède garde `db.save`, la file et le retour arrière. Mais `central-sync`
 * a trois chemins qui ne passent PAS par là, et qui franchissent la frontière du poste
 * dans un sens comme dans l'autre :
 *
 *   · l'INGRESSION — `replaceStoreAtomically()` écrit les fiches de l'instantané par
 *     `store.put()` direct. Une fiche servie par le centre pouvait donc reposer un champ
 *     interdit sur le disque, juste après la purge, sans que rien ne la regarde ;
 *   · l'ÉGRESSION en ligne — la copie locale était bien assainie, mais `saved` restait
 *     brute et partait telle quelle au `PUT` générique. Le serveur ne normalise les mots
 *     de passe QUE pour `users` : un `settings.password` pouvait donc être stocké
 *     centralement, puis revenir par l'instantané suivant — et l'ingression le réécrivait ;
 *   · l'AMORÇAGE — `localSnapshot()` exportait les fiches brutes. Un résidu hérité pouvait
 *     quitter le navigateur avant même que la purge ait fini.
 *
 * Une rotation d'identifiant VRAIE continue d'envoyer le mot de passe au serveur : c'est
 * le seul chemin qui doit le porter, et l'assainir serait rendre le changement impossible.
 */
const champsSecretsDe = valeur => {
  const trouves = [];
  const descendre = (v, chemin) => {
    if (Array.isArray(v)) return v.forEach((e, i) => descendre(e, `${chemin}[${i}]`));
    if (!v || typeof v !== 'object') return;
    for (const [cle, sousValeur] of Object.entries(v)) {
      const sousChemin = chemin ? `${chemin}.${cle}` : cle;
      if (CHAMPS_CREDENTIELS.includes(cle) && sousValeur !== undefined) trouves.push(sousChemin);
      descendre(sousValeur, sousChemin);
    }
  };
  descendre(valeur, '');
  return trouves;
};

test('B4·36 — R5-A : une fiche d’instantané porteuse n’est pas reposée sur le disque', async () => {
  await repartirDeZero({ enLigne: false });
  instantaneServi = () => ({
    initialized: true,
    authoritativeStores: ['settings', 'notes'],
    data: {
      settings: [{ id: 'poste-atelier', libelle: 'Poste atelier', _revision: 4,
        password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64' }],
      notes: [{ id: 4242, targetType: 'room', texte: 'Relevé', _revision: 2, password: 'UGFz' }]
    },
    deleted: [], access: {}, serverTime: new Date().toISOString()
  });

  await db.enableCentralSync({ bootstrapLocal: false });

  const reglage = await db.get('settings', 'poste-atelier');
  const note = await db.get('notes', 4242);
  assert.ok(reglage && note, 'l’instantané doit bien avoir été appliqué (sinon l’épreuve ne prouve rien)');
  assert.equal(reglage.libelle, 'Poste atelier', 'les champs non sensibles du centre sont conservés');
  assert.equal(reglage._revision, 4, 'la révision servie par le centre est conservée');
  assert.equal(note.texte, 'Relevé');
  assert.deepEqual(secretsPersistes(), [],
    'l’ingression a reposé un champ interdit sur le disque, juste après la purge');
});

test('B4·37 — R5-B : une écriture NON `users` ne porte aucun champ interdit jusqu’au centre', async () => {
  await repartirDeZero({ enLigne: true });
  pousseesVues.length = 0;
  reponsePoussee = () => reponse(200, { revision: 2, record: { id: 'poste-atelier' } });

  await db.save('settings', {
    id: 'poste-atelier', libelle: 'Poste atelier', password: 'UGFz', passwordScheme: 'base64'
  });

  const poussee = pousseesVues.find(p => p.url.includes('/api/data/settings/'));
  assert.ok(poussee, 'l’écriture doit bel et bien partir au centre : c’est une fiche `settings` ordinaire');
  assert.equal(poussee.corps?.libelle, 'Poste atelier', 'ses champs non sensibles partent normalement');
  assert.deepEqual(champsSecretsDe(poussee.corps), [],
    'le corps envoyé au `PUT` générique porte encore le champ interdit : le serveur ne le normalise que pour `users`');
  assert.deepEqual(secretsPersistes(), []);
});

test('B4·38 — R5-B : une VRAIE rotation d’identifiant continue d’envoyer le mot de passe', async () => {
  /*
   * L'assainissement du transport ne doit surtout pas s'appliquer ici : sans mot de passe
   * dans le corps, le serveur n'aurait rien à changer et la rotation deviendrait
   * impossible. C'est le seul chemin qui a le droit de le porter.
   */
  await repartirDeZero({ enLigne: true });
  pousseesVues.length = 0;
  reponsePoussee = () => reponse(200, { revision: 3, record: { id: 7460 } });

  await db.save('users', {
    id: 7460, username: 'resp.rotation', fullName: 'Responsable', role: 'chef', status: 'active',
    _revision: 2, password: 'UGFz'
  });

  const poussee = pousseesVues.find(p => p.url.includes('/api/data/users/'));
  assert.ok(poussee, 'la rotation doit partir au centre');
  assert.equal(poussee.corps?.password, 'UGFz',
    'sans mot de passe dans le corps, le serveur n’a rien à changer : la rotation serait impossible');
  assert.deepEqual(secretsPersistes(), [], 'et le poste, lui, n’en garde toujours rien');
});

test('B4·39 — R5-C : l’amorçage n’exporte aucun résidu hérité hors du navigateur', async () => {
  await repartirDeZero({ enLigne: false });
  // Un résidu déjà sur le disque, tel qu'une version antérieure l'a laissé.
  magasin('settings').set('poste-atelier', {
    id: 'poste-atelier', libelle: 'Poste atelier',
    password: 'UGFz', passwordHash: 'UGFz', passwordScheme: 'base64'
  });
  magasin('users').set('7470', { id: 7470, username: 'resp.amorcage', fullName: 'Responsable', password: 'UGFz' });
  amorcagesVus.length = 0;

  // `initialized: false` déclenche l'amorçage : le poste propose son contenu au centre.
  let servi = 0;
  instantaneServi = () => (servi++ === 0
    ? { initialized: false, authoritativeStores: [], data: {}, deleted: [], access: {}, serverTime: new Date().toISOString() }
    : snapshotVide);

  await db.enableCentralSync({ bootstrapLocal: true });

  assert.equal(amorcagesVus.length, 1, 'l’amorçage doit avoir eu lieu (sinon l’épreuve ne prouve rien)');
  const corps = amorcagesVus[0];
  assert.ok(corps?.data?.settings?.some(f => String(f.id) === 'poste-atelier'),
    'et il doit bien avoir emporté la fiche, sans quoi il ne prouve rien non plus');
  assert.deepEqual(champsSecretsDe(corps), [],
    'le corps d’amorçage emporte le résidu hors du navigateur avant même la fin de la purge');
});

test('B4·40 — R5-D : l’écriture locale-seule d’une réponse serveur est assainie aussi', async () => {
  /*
   * Trouvé en auditant les voies d'écriture pendant R5, et non signalé par la revue :
   * `db.saveLocalOnly()` est une QUATRIÈME voie hors `db.save`. Les modules qui ont déjà
   * mené leur propre transaction serveur s'en servent pour recopier la réponse
   * normalisée. Une réponse portant un champ du contrat le posait tel quel sur le disque.
   */
  await repartirDeZero({ enLigne: true });
  journalDesEcritures.length = 0;

  await db.saveLocalOnly('users', {
    id: 7480, username: 'resp.miroir', fullName: 'Responsable', role: 'chef', status: 'active',
    password: 'UGFz', passwordScheme: 'base64'
  });

  const fiche = await db.get('users', 7480);
  assert.equal(fiche.fullName, 'Responsable', 'la réponse serveur est bien recopiée');
  assert.equal(porteUnCredentiel(fiche), false);
  assert.deepEqual(journalDesEcritures.filter(e => porteUnCredentiel(e.fiche)), []);
  assert.deepEqual(secretsPersistes(), []);
});
