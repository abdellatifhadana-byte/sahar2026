/**
 * @file tests/snapshot-diff-invalidation.test.js — BATCH C, ce que l'instantané ne disait pas.
 *
 * TROIS DÉFAUTS, UN SEUL ENDROIT
 * ------------------------------
 * `applySnapshot` écrit le contenu reçu du serveur dans la base locale — et n'annonce RIEN.
 * Une sauvegarde LOCALE, elle, émet `platform-entity-updated` depuis `write-coherence.js`,
 * et `data-visibility-recovery.js` rafraîchit les vues ouvertes. Un changement DISTANT ne
 * passe pas par là : il entre en base sans un mot.
 *
 *   SYNC-01         B renomme une salle. La base locale de A reçoit le nouveau nom.
 *                   L'écran de A continue d'afficher l'ancien jusqu'à une navigation ou F5.
 *   DELETE-SYNC-02  B supprime une fiche. Elle disparaît de la persistance de A, mais reste
 *                   affichée dans la vue ouverte : un fantôme sur lequel on peut cliquer.
 *   EVENT-DELETE-01 Il existe un événement pour la sauvegarde, aucun pour la suppression.
 *                   Le contrat est asymétrique, donc incomplet.
 *
 * CE QUE CES ÉPREUVES EXIGENT
 * ---------------------------
 * Que l'application d'un instantané produise un CONTRAT DE CHANGEMENTS explicite —
 * `changedStores`, `changedEntities`, `deletedEntities` — et que les événements partent
 * APRÈS l'écriture locale réussie, jamais avant : annoncer un changement que la base n'a pas
 * encore, c'est inviter les vues à lire l'ancien état.
 *
 * Et qu'un instantané n'écrase pas en silence ce qu'un humain est en train de taper.
 *
 * MÉTHODE
 * -------
 * Ces épreuves EXÉCUTENT `central-sync.js`. La base locale est simulée par un magasin en
 * mémoire dont les transactions se comportent comme celles d'IndexedDB, et le serveur par un
 * `fetch` programmé. On observe les événements réellement émis et leur ORDRE par rapport à
 * l'écriture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Navigateur minimal, installé avant l'import ---------------- */

const auditeurs = new Map();
const evenements = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener(type, fonction) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push(fonction);
  },
  dispatchEvent(evenement) {
    evenements.push({ type: evenement.type, detail: evenement.detail, etatBase: instantanerBase() });
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

/* ---------------- Base locale, avec de vraies transactions ---------------- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

/** Photographie de la base au moment où un événement part — sert à vérifier l'ORDRE. */
function instantanerBase() {
  const sortie = {};
  for (const [nom, contenu] of magasins) {
    sortie[nom] = [...contenu.values()].map(enregistrement => ({ id: enregistrement.id, name: enregistrement.name }));
  }
  return sortie;
}

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = {
  objectStoreNames: { contains: nom => ['rooms', 'equipments', 'docs', 'settings', 'syncQueue', 'notes'].includes(nom) },
  transaction(nom) {
    const magasin = table(nom);
    const operations = [];
    const transaction = {
      objectStore: () => ({
        clear() { operations.push(() => magasin.clear()); },
        put(enregistrement) { operations.push(() => magasin.set(String(enregistrement.id), enregistrement)); },
        delete(id) { operations.push(() => magasin.delete(String(id))); },
        // `getAll` dans la MÊME transaction : c'est ainsi qu'on connaît l'état d'avant sans
        // ouvrir une seconde transaction, donc sans fenêtre entre la lecture et l'écriture.
        getAll() {
          const requete = { result: [...magasin.values()], onsuccess: null, onerror: null };
          queueMicrotask(() => requete.onsuccess?.());
          return requete;
        }
      }),
      oncomplete: null, onerror: null, onabort: null
    };
    queueMicrotask(() => {
      queueMicrotask(() => {
        for (const operation of operations) operation();
        transaction.oncomplete?.();
      });
    });
    return transaction;
  }
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

/* ------------------------------ Serveur simulé ------------------------------ */

/*
 * Les magasins autoritaires par défaut. Une épreuve peut les redéfinir, et il le FAUT :
 * un magasin peut très bien n'être ni autoritaire ni présent dans `data`, sa seule
 * nouvelle de l'instantané étant une pierre tombale. C'est ce cas-là que ce lot avait
 * laissé passer, et un gabarit figé le rendait inatteignable depuis une épreuve.
 */
const MAGASINS_AUTORITAIRES = ['rooms', 'equipments', 'docs', 'notes'];
let instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z' };
globalThis.fetch = async (chemin) => {
  const corps = String(chemin).startsWith('/api/sync')
    ? { authoritativeStores: MAGASINS_AUTORITAIRES, ...instantaneServeur }
    : { ok: true };
  return {
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify(corps)
  };
};

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

await import('../central-sync.js');

/* ------------------------------- Utilitaires ------------------------------- */

const SALLE = 'salle-A';

/** Prépare une base locale connue, puis applique l'instantané donné. */
async function appliquer(serveur) {
  evenements.length = 0;
  instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z', ...serveur };
  await db.enableCentralSync({ bootstrapLocal: false });
}

function poserLocal(nom, enregistrements) {
  // Toute la base est remise à zéro : les magasins autoritaires absents de l'instantané
  // sont vidés par `applySnapshot`, si bien qu'un reste d'épreuve précédente serait annoncé
  // comme une suppression — et l'on mesurerait sa propre négligence.
  magasins.clear();
  for (const enregistrement of enregistrements) table(nom).set(String(enregistrement.id), enregistrement);
}

const evenementsDe = type => evenements.filter(entree => entree.type === type);

/** Les seuls événements que ce lot introduit — `central-sync-status` préexiste et n'en est pas. */
const EVENEMENTS_DU_CONTRAT = ['platform-entity-updated', 'platform-entity-deleted', 'platform-entity-diverged', 'platform-snapshot-applied'];
const annonces = () => evenements.filter(entree => EVENEMENTS_DU_CONTRAT.includes(entree.type)).map(entree => entree.type);
const dernierDiff = () => evenementsDe('platform-snapshot-applied').at(-1)?.detail;

/* ═══════════════ C1 · un changement distant doit être ANNONCÉ ═══════════════ */

test('DIFF·1 — un renommage distant produit une entité changée, nommée', async () => {
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Régie A renommée par B', _revision: 2 }] } });

  const diff = dernierDiff();
  assert.ok(diff, 'l’application d’un instantané doit annoncer ce qu’elle a changé');
  assert.deepEqual(diff.changedStores, ['rooms']);
  assert.deepEqual(diff.changedEntities, [{ store: 'rooms', id: SALLE }]);
  assert.deepEqual(diff.deletedEntities, []);
});

test('DIFF·2 — la vue ouverte reçoit le même événement qu’une sauvegarde locale', async () => {
  /*
   * `data-visibility-recovery.js` écoute déjà `platform-entity-updated` et rafraîchit les
   * vues ouvertes. Un changement distant doit emprunter le MÊME canal : c'est ce qui fait
   * qu'il se reflète sans navigation ni F5, sans qu'aucune vue ait à être réécrite.
   */
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée', _revision: 2 }] } });

  const misAJour = evenementsDe('platform-entity-updated');
  assert.equal(misAJour.length, 1, 'un changement distant doit émettre l’événement de mise à jour');
  assert.equal(misAJour[0].detail.storeName, 'rooms');
  assert.equal(String(misAJour[0].detail.id), SALLE);
  assert.equal(misAJour[0].detail.record.name, 'Renommée',
    'l’événement doit porter la version NOUVELLE, pas celle qu’on remplace');
});

test('DIFF·3 — les événements partent APRÈS l’écriture locale, jamais avant', async () => {
  /*
   * Annoncer un changement que la base n'a pas encore, c'est inviter chaque vue à relire
   * l'ancien état et à se croire à jour. L'ordre n'est pas un détail de confort.
   */
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée', _revision: 2 }] } });

  const misAJour = evenementsDe('platform-entity-updated')[0];
  assert.ok(misAJour, 'aucun événement de mise à jour n’a été émis');
  const vueDansLaBase = misAJour.etatBase.rooms.find(entree => String(entree.id) === SALLE);
  assert.ok(vueDansLaBase, 'la fiche doit déjà être en base quand l’événement part');
  assert.equal(vueDansLaBase.name, 'Renommée',
    'la base doit porter la NOUVELLE valeur au moment de l’annonce : une vue qui réagit '
    + 'en relisant doit trouver ce que l’événement annonce, pas ce qu’il remplace');
  assert.equal(table('rooms').get(SALLE).name, 'Renommée');
});

/* ═══════════════ C2 · une suppression distante doit être ANNONCÉE ═══════════════ */

test('DIFF·4 — une suppression distante produit un événement SYMÉTRIQUE', async () => {
  // Le contrat avait `platform-entity-updated` pour la sauvegarde et rien pour la
  // suppression. Une vue ne pouvait donc pas savoir qu'elle affichait un fantôme.
  poserLocal('rooms', [
    { id: SALLE, name: 'Régie A', _revision: 1 },
    { id: 'salle-B', name: 'Régie B', _revision: 1 }
  ]);
  await appliquer({ data: { rooms: [{ id: 'salle-B', name: 'Régie B', _revision: 1 }] } });

  const diff = dernierDiff();
  assert.deepEqual(diff.deletedEntities, [{ store: 'rooms', id: SALLE }]);

  const supprimes = evenementsDe('platform-entity-deleted');
  assert.equal(supprimes.length, 1, 'la suppression distante doit avoir son propre événement');
  assert.equal(supprimes[0].detail.storeName, 'rooms');
  assert.equal(String(supprimes[0].detail.id), SALLE);
  assert.equal(table('rooms').has(SALLE), false, 'et la fiche ne doit plus être en base locale');
});

test('DIFF·5 — l’événement de suppression part lui aussi APRÈS le retrait local', async () => {
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [] } });

  const supprime = evenementsDe('platform-entity-deleted')[0];
  assert.ok(supprime, 'aucun événement de suppression');
  assert.equal(supprime.etatBase.rooms.some(entree => String(entree.id) === SALLE), false,
    'la fiche devait déjà avoir disparu de la base quand l’événement est parti');
});

/* ═══════════════ C3 · une révocation d'accès se voit comme une suppression ═══════════════ */

test('DIFF·6 — une ressource retirée du périmètre est annoncée comme retirée', async () => {
  /*
   * Le serveur filtre l'instantané par zone. Quand un accès est révoqué, la ressource
   * disparaît simplement du contenu autorisé — sans pierre tombale, puisqu'elle n'est pas
   * supprimée pour tout le monde. Du point de vue de CETTE session, c'est pourtant une
   * disparition, et la vue ouverte ne doit pas continuer de montrer ce qui est devenu
   * interdit.
   */
  poserLocal('equipments', [
    { id: 'eq-zone-perdue', name: 'Ultrix', _revision: 3 },
    { id: 'eq-visible', name: 'Kahuna', _revision: 1 }
  ]);
  await appliquer({ data: { equipments: [{ id: 'eq-visible', name: 'Kahuna', _revision: 1 }] } });

  assert.deepEqual(dernierDiff().deletedEntities, [{ store: 'equipments', id: 'eq-zone-perdue' }]);
  assert.equal(evenementsDe('platform-entity-deleted').length, 1);
  assert.equal(table('equipments').has('eq-zone-perdue'), false,
    'une donnée devenue interdite ne reste pas dans la projection locale');
});

/* ═══════════════ C5 · une entité nouvellement visible apparaît ═══════════════ */

test('DIFF·7 — une ressource nouvellement visible est annoncée comme changée', async () => {
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [
    { id: SALLE, name: 'Régie A', _revision: 1 },
    { id: 'salle-neuve', name: 'Régie nouvellement accessible', _revision: 1 }
  ] } });

  const diff = dernierDiff();
  assert.deepEqual(diff.changedEntities, [{ store: 'rooms', id: 'salle-neuve' }],
    'seule la nouvelle doit être annoncée : l’autre n’a pas bougé');
  assert.deepEqual(diff.deletedEntities, []);
  assert.equal(evenementsDe('platform-entity-updated').length, 1);
});

/* ═══════════════ Invariant 8 · pas d'invalidation aveugle ═══════════════ */

test('DIFF·8 — un instantané IDENTIQUE n’annonce aucun changement', async () => {
  /*
   * C'est la garde qui empêche le contrat de devenir du bruit. La synchronisation repart
   * toutes les vingt secondes : si chaque passage annonçait « tout a changé », chaque vue se
   * reconstruirait sans raison, et l'invalidation ne voudrait plus rien dire.
   */
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 2 }]);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Régie A', _revision: 2 }] } });

  // Rien n'a changé : le contrat se TAIT. Émettre un récapitulatif vide toutes les vingt
  // secondes serait précisément le bruit que l'invariant « pas d'invalidation aveugle »
  // interdit — et un consommateur distrait finirait par s'en servir comme d'un battement.
  assert.deepEqual(annonces(), [],
    `un instantané identique a pourtant annoncé : ${annonces().join(', ')}`);
});

test('DIFF·9 — l’ordre des clés venu de PostgreSQL n’est PAS un changement', async () => {
  /*
   * PostgreSQL renormalise l'ordre des clés du `jsonb`. Sans comparaison par valeur, chaque
   * entité paraîtrait modifiée à chaque instantané — et l'invalidation deviendrait globale
   * et permanente. C'est la leçon de WRITE-02, appliquée ici.
   */
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', coordinates: { x: 10, y: 20 }, _revision: 2 }]);
  await appliquer({ data: { rooms: [{ _revision: 2, id: SALLE, coordinates: { y: 20, x: 10 }, name: 'Régie A' }] } });

  assert.deepEqual(annonces(), [],
    'seul l’ordre des clés diffère : ce n’est pas un changement de contenu');
});

/* ═══════════════ C4 · un éditeur en cours de saisie n'est pas écrasé ═══════════════ */

test('DIFF·10 — une saisie en cours reçoit une DIVERGENCE, pas un rafraîchissement muet', async () => {
  /*
   * A a modifié un champ sans enregistrer. B modifie la même fiche. L'instantané arrive.
   *
   * Le serveur reste autoritaire : la base locale prend la version de B, c'est normal. Ce
   * qui ne doit pas arriver, c'est que la vue de A remplace en silence ce qu'il est en train
   * de taper. Il doit apprendre que la donnée a bougé sous lui, et décider lui-même.
   */
  const contrat = await import('../snapshot-diff-contract.js');
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  contrat.declareOpenEditor('rooms', SALLE, { dirty: true });
  try {
    await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée par B', _revision: 2 }] } });

    const divergences = evenementsDe('platform-entity-diverged');
    assert.equal(divergences.length, 1, 'une saisie en cours doit être prévenue de la divergence');
    assert.equal(String(divergences[0].detail.id), SALLE);
    assert.equal(divergences[0].detail.record.name, 'Renommée par B',
      'la divergence doit porter la version distante, pour que l’écran puisse la montrer');

    assert.equal(evenementsDe('platform-entity-updated').length, 0,
      'un rafraîchissement muet écraserait la saisie : il ne doit pas être émis');
  } finally {
    contrat.releaseOpenEditor('rooms', SALLE);
  }
});

test('DIFF·11 — un éditeur ouvert mais PROPRE se rafraîchit normalement', async () => {
  // La protection ne vaut que pour une saisie non enregistrée. Un formulaire ouvert et
  // intact doit suivre la version distante, sinon il affiche un état périmé sans raison.
  const contrat = await import('../snapshot-diff-contract.js');
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  contrat.declareOpenEditor('rooms', SALLE, { dirty: false });
  try {
    await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée par B', _revision: 2 }] } });
    assert.equal(evenementsDe('platform-entity-updated').length, 1);
    assert.equal(evenementsDe('platform-entity-diverged').length, 0);
  } finally {
    contrat.releaseOpenEditor('rooms', SALLE);
  }
});

test('DIFF·12 — une suppression distante prévient même un éditeur en cours de saisie', async () => {
  // On ne peut pas « garder sa saisie » sur une fiche qui n'existe plus. La suppression doit
  // donc traverser la protection : c'est un fait, pas une divergence à arbitrer.
  const contrat = await import('../snapshot-diff-contract.js');
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  contrat.declareOpenEditor('rooms', SALLE, { dirty: true });
  try {
    await appliquer({ data: { rooms: [] } });
    assert.equal(evenementsDe('platform-entity-deleted').length, 1,
      'la disparition d’une fiche doit être annoncée, même à une saisie en cours');
  } finally {
    contrat.releaseOpenEditor('rooms', SALLE);
  }
});

/* ═══════════════ Invariants 5 et 6 · aucune écriture provoquée ═══════════════ */

test('DIFF·13 — appliquer un instantané ne provoque AUCUNE écriture vers le serveur', async () => {
  // Invariants 5 et 6 : le contrat de changements ne doit pas rouvrir WRITE-01/02, ni
  // « rafraîchir » l'écran en écrivant des données utilisateur.
  const appels = [];
  const precedent = globalThis.fetch;
  globalThis.fetch = async (chemin, options = {}) => {
    if (['PUT', 'POST', 'DELETE'].includes(options.method || 'GET')) appels.push(String(chemin));
    return precedent(chemin, options);
  };
  try {
    poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
    await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée', _revision: 2 }] } });
    assert.deepEqual(appels, [], 'l’application d’un instantané ne doit rien écrire vers le serveur');
    assert.equal((await db.getAll('syncQueue')).length, 0, 'ni rien mettre en file');
  } finally {
    globalThis.fetch = precedent;
  }
});

/* ═══════════ Le contrat doit ATTEINDRE l'écran, pas seulement être émis ═══════════ */

test('DIFF·14 — le relais générique des vues réagit à la suppression comme à la modification', async () => {
  /*
   * Émettre un événement que personne n'écoute ne retire aucun fantôme. `data-visibility-
   * recovery.js` relayait déjà `platform-entity-updated` vers les vues ouvertes ; il ne
   * connaissait pas la suppression, puisqu'elle n'existait pas.
   *
   * On vérifie ici que les DEUX événements aboutissent au même relais — c'est ce qui fait
   * qu'une fiche disparue quitte l'écran sans qu'aucune vue ait été réécrite.
   */
  const source = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../data-visibility-recovery.js', import.meta.url), 'utf8'));

  for (const evenement of ['platform-entity-updated', 'platform-entity-deleted']) {
    const bloc = source.slice(source.indexOf(`addEventListener('${evenement}'`));
    const corps = bloc.slice(0, bloc.indexOf('});') + 3);
    assert.match(corps, /refreshOpenDerivedViews\(storeName\)/,
      `${evenement} doit rafraîchir les vues dérivées ouvertes`);
    assert.match(corps, /sectionNeedsStore\(ui, storeName\)/,
      `${evenement} doit rafraîchir la section courante quand elle dépend du magasin`);
  }
});

test('DIFF·15 — une révocation et une suppression produisent le MÊME signal pour l’écran', async () => {
  /*
   * Du point de vue d'une session, « supprimée pour tout le monde » et « sortie de mon
   * périmètre » ont la même conséquence : la donnée ne doit plus être affichée. Les traiter
   * différemment obligerait chaque vue à connaître la différence — qu'elle ne peut pas
   * connaître, puisque le serveur ne la lui dit pas.
   */
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  await appliquer({ data: { rooms: [] } });
  const parSuppression = evenementsDe('platform-entity-deleted').map(entree => entree.detail.storeName);

  poserLocal('equipments', [{ id: 'eq-revoque', name: 'Ultrix', _revision: 1 }]);
  await appliquer({ data: { equipments: [] } });
  const parRevocation = evenementsDe('platform-entity-deleted').map(entree => entree.detail.storeName);

  assert.equal(parSuppression.length, 1);
  assert.equal(parRevocation.length, 1);
  assert.equal(evenementsDe('platform-entity-deleted')[0].detail.id, 'eq-revoque');
});

/* ═══════════ C-TOMBSTONE-01 · la pierre tombale seule doit entrer dans le diff ═══════════ */

/*
 * LE DÉFAUT, TEL QU'IL A ÉTÉ REPRODUIT.
 *
 * Un instantané annonce une suppression de DEUX façons, et une seule était vue :
 *
 *   par ABSENCE     la fiche ne figure plus dans `data` d'un magasin autoritaire. Le
 *                   remplacement la retire, et la comparaison avant/après la voit partir.
 *   par PIERRE      la fiche est nommée dans `snapshot.deleted`. Son magasin peut n'être
 *   TOMBALE         ni autoritaire, ni présent dans `data` — c'est le cas quand rien
 *                   d'autre n'a bougé chez lui. Il n'entrait alors dans AUCUNE des deux
 *                   cartes du diff, et `buildSnapshotDiff` ne pouvait rien en dire.
 *
 * Conséquence mesurée : la fiche quittait bel et bien la base locale, et l'écran n'en
 * était jamais averti. Un fantôme, exactement celui que ce lot prétendait supprimer.
 *
 * La correction n'ajoute pas un second système de suppressions : elle fait entrer la
 * pierre tombale dans les MÊMES structures — « avant » contient la fiche, « après » ne la
 * contient plus — et laisse `buildSnapshotDiff` en tirer la conclusion.
 */

const NOTE_SUPPRIMEE = 'N-TOMB';
const NOTE_CONSERVEE = 'N-RESTE';

/** Les suppressions annoncées pour une fiche PRÉCISE — magasin ET identifiant exacts. */
const suppressionsDe = (store, id) => evenementsDe('platform-entity-deleted')
  .filter(entree => entree.detail?.storeName === store && String(entree.detail?.id) === String(id));

test('DIFF·16 — une pierre tombale SEULE produit la suppression, jusqu’à l’écran', async () => {
  poserLocal('notes', [
    { id: NOTE_SUPPRIMEE, name: 'Note supprimée ailleurs', _revision: 1 },
    { id: NOTE_CONSERVEE, name: 'Note conservée', _revision: 1 }
  ]);

  await appliquer({
    data: { rooms: [] },              // `notes` n'est PAS dans les données de l'instantané
    authoritativeStores: ['rooms'],   // ni dans les magasins autoritaires
    deleted: [{ store: 'notes', id: NOTE_SUPPRIMEE }]  // la suppression n'est portée que par là
  });

  assert.equal(table('notes').has(NOTE_SUPPRIMEE), false,
    'la fiche visée par la pierre tombale doit avoir quitté la base locale');
  assert.equal(table('notes').has(NOTE_CONSERVEE), true,
    'une pierre tombale ne vise qu’une fiche : les autres restent');

  const diff = dernierDiff();
  assert.ok(diff, 'l’instantané doit annoncer ce qu’il a changé');
  assert.deepEqual(diff.deletedEntities, [{ store: 'notes', id: NOTE_SUPPRIMEE }],
    'la pierre tombale doit produire la suppression dans le diff canonique');
  assert.ok(diff.changedStores.includes('notes'),
    'le magasin touché par la pierre tombale doit figurer parmi les magasins changés');
  assert.deepEqual(diff.changedEntities, [],
    'aucune autre fiche n’a bougé : rien d’autre ne doit être annoncé');

  assert.equal(suppressionsDe('notes', NOTE_SUPPRIMEE).length, 1,
    'exactement un événement de suppression, pour CETTE fiche');
  assert.equal(suppressionsDe('notes', NOTE_CONSERVEE).length, 0,
    'et aucun pour celle qui reste');
});

test('DIFF·17 — la suppression par pierre tombale part APRÈS le retrait local', async () => {
  // Même règle que partout ailleurs : annoncer une disparition que la base porte encore,
  // c'est inviter la vue qui réagit à relire la fiche et à la réafficher.
  poserLocal('notes', [{ id: NOTE_SUPPRIMEE, name: 'Note supprimée ailleurs', _revision: 1 }]);

  await appliquer({
    data: { rooms: [] },
    authoritativeStores: ['rooms'],
    deleted: [{ store: 'notes', id: NOTE_SUPPRIMEE }]
  });

  const supprime = suppressionsDe('notes', NOTE_SUPPRIMEE)[0];
  assert.ok(supprime, 'aucun événement de suppression pour la fiche visée');
  assert.equal((supprime.etatBase.notes || []).some(entree => String(entree.id) === NOTE_SUPPRIMEE), false,
    'la fiche devait déjà avoir disparu de la base au moment de l’annonce');
});

test('DIFF·18 — une pierre tombale sur une fiche DÉJÀ absente n’annonce rien', async () => {
  /*
   * Le serveur renvoie ses pierres tombales à chaque instantané, toutes les vingt secondes.
   * Si chacune produisait un événement, l'écran recevrait indéfiniment la nouvelle d'une
   * suppression déjà connue — et une vue qui s'en sert pour fermer un détail se fermerait
   * en boucle. Une suppression ne s'annonce qu'une fois : celle où elle a lieu.
   */
  poserLocal('notes', [{ id: NOTE_CONSERVEE, name: 'Note conservée', _revision: 1 }]);

  await appliquer({
    data: { rooms: [] },
    authoritativeStores: ['rooms'],
    deleted: [{ store: 'notes', id: 'N-JAMAIS-VUE' }]
  });

  assert.deepEqual(annonces(), [],
    `une pierre tombale sans effet a pourtant annoncé : ${annonces().join(', ')}`);
  assert.equal(table('notes').has(NOTE_CONSERVEE), true,
    'et la fiche qui n’était pas visée doit être intacte');
});

test('DIFF·19 — une fiche à la fois envoyée et enterrée est traitée comme supprimée', async () => {
  // Contradiction possible d'un instantané : la fiche figure dans `data` ET dans `deleted`.
  // La pierre tombale est le fait le plus récent ; la garder en base laisserait une fiche
  // que le serveur dit supprimée. L'ordre d'application doit donc être stable, pas fortuit.
  poserLocal('notes', [{ id: NOTE_SUPPRIMEE, name: 'Note', _revision: 1 }]);

  await appliquer({
    data: { notes: [{ id: NOTE_SUPPRIMEE, name: 'Note', _revision: 1 }] },
    authoritativeStores: ['notes'],
    deleted: [{ store: 'notes', id: NOTE_SUPPRIMEE }]
  });

  assert.equal(table('notes').has(NOTE_SUPPRIMEE), false,
    'la pierre tombale doit l’emporter sur le contenu envoyé');
  assert.deepEqual(dernierDiff().deletedEntities, [{ store: 'notes', id: NOTE_SUPPRIMEE }]);
  assert.equal(suppressionsDe('notes', NOTE_SUPPRIMEE).length, 1);
  assert.equal(evenementsDe('platform-entity-updated').length, 0,
    'et surtout pas une mise à jour : la fiche n’existe plus');
});

test('DIFF·20 — une pierre tombale ne fait pas disparaître le reste de son magasin', async () => {
  /*
   * La correction fait entrer le magasin visé dans les cartes du diff. Si son état « après »
   * était pris pour le contenu de `data` — vide, ici — TOUTES ses fiches seraient annoncées
   * supprimées, et l'écran se viderait. C'est la faute exacte que cette épreuve interdit.
   */
  poserLocal('notes', [
    { id: NOTE_SUPPRIMEE, name: 'Note supprimée', _revision: 1 },
    { id: 'N-A', name: 'Note A', _revision: 1 },
    { id: 'N-B', name: 'Note B', _revision: 1 }
  ]);

  await appliquer({
    data: { rooms: [] },
    authoritativeStores: ['rooms'],
    deleted: [{ store: 'notes', id: NOTE_SUPPRIMEE }]
  });

  assert.deepEqual([...table('notes').keys()].sort(), ['N-A', 'N-B'],
    'seule la fiche visée doit avoir quitté la base');
  assert.deepEqual(dernierDiff().deletedEntities, [{ store: 'notes', id: NOTE_SUPPRIMEE }],
    'et le diff ne doit annoncer qu’elle');
  assert.equal(evenementsDe('platform-entity-deleted').length, 1);
});
