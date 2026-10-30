/**
 * @file tests/locations-restore-atomic-p0c.test.js — P0-C, blocage 1 : la restauration d'un
 *       graphe de localisations est TOUT-OU-RIEN, prouvé par une panne AU MILIEU du lot.
 *
 * LE DÉFAUT QUE CE FICHIER VERROUILLE.
 *
 * La version précédente validait le graphe puis écrivait fiche par fiche depuis le
 * navigateur :
 *
 *     for (const record of ordonnees) {
 *       try { await db.save('locations', record) } catch { continue }
 *     }
 *
 * Chaque `db.save` part en PUT indépendant. Une Ville acceptée, puis une Région refusée —
 * 409, permission, refus définitif — laissait la Ville écrite et l'arbre coupé en deux.
 * Les épreuves d'alors ne prouvaient QUE « graphe invalide AVANT la première écriture =>
 * zéro écriture ». Elles ne disaient rien du cas qui compte : lot VALIDE, panne à la
 * N-ième écriture. C'est ce trou que ce fichier ferme.
 *
 * POURQUOI UN DOUBLE DE POOL QUI SAIT VRAIMENT ANNULER.
 *
 * Le double de `transfert-salles-zone.test.js` traite `ROLLBACK` comme un no-op : il
 * suffit à compter les transactions, pas à prouver qu'on n'a rien laissé derrière. Ici
 * `BEGIN` prend un instantané et `ROLLBACK` le restaure — sans quoi cette épreuve serait
 * verte ou rouge pour la mauvaise raison, sans jamais observer l'atomicité réelle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessControl } from '../scripts/access-control.js';
import { REVISION_FIELD, revisionOf } from '../revision-contract.js';

/* ══════════════════ un double de pool QUI ANNULE POUR DE VRAI ══════════════════ */

function poolTransactionnel(seed = {}) {
  let magasins = new Map(); // store -> Map(id -> { data, deleted, updatedAt })
  let horloge = 0;
  let instantane = null;    // pris à BEGIN, restauré à ROLLBACK
  let echouerSur = null;    // record_id dont l'INSERT doit échouer
  const journal = [];       // BEGIN / COMMIT / ROLLBACK, dans l'ordre

  const table = store => {
    if (!magasins.has(store)) magasins.set(store, new Map());
    return magasins.get(store);
  };
  const copier = source => new Map([...source.entries()]
    .map(([store, lignes]) => [store, new Map([...lignes.entries()]
      .map(([id, ligne]) => [id, { ...ligne, data: JSON.parse(JSON.stringify(ligne.data)) }]))]));

  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) {
      table(store).set(String(record.id), { data: record, deleted: false, updatedAt: ++horloge });
    }
  }

  const client = {
    async query(sql, params = []) {
      const texte = String(sql).replace(/\s+/g, ' ').trim();

      if (texte === 'BEGIN') { journal.push('BEGIN'); instantane = copier(magasins); return { rows: [] }; }
      if (texte === 'COMMIT') { journal.push('COMMIT'); instantane = null; return { rows: [] }; }
      if (texte === 'ROLLBACK') {
        journal.push('ROLLBACK');
        // CE QUE POSTGRESQL FAIT RÉELLEMENT : la base retrouve l'état d'avant BEGIN.
        if (instantane) { magasins = instantane; instantane = null; }
        return { rows: [] };
      }

      if (texte.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };

      if (echouerSur !== null && texte.startsWith('INSERT') && String(params[1]) === String(echouerSur)) {
        throw Object.assign(new Error('refus définitif du serveur pendant la transaction'), { code: 'REFUS_SIMULE' });
      }

      if (texte.startsWith('SELECT data, deleted FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne ? [{ data: ligne.data, deleted: ligne.deleted }] : [] };
      }
      if (texte.startsWith('SELECT data FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne && !ligne.deleted ? [{ data: ligne.data }] : [] };
      }
      if (texte.startsWith('SELECT record_id,data,updated_at FROM platform_records')) {
        return {
          rows: [...table(params[0]).entries()].filter(([, v]) => !v.deleted)
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
            .map(([id, v]) => ({ record_id: id, data: v.data, updated_at: v.updatedAt }))
        };
      }
      if (texte.startsWith('INSERT INTO platform_records')) {
        const tombe = texte.includes('::jsonb,TRUE');
        table(params[0]).set(String(params[1]), {
          data: tombe ? {} : JSON.parse(params[2]), deleted: tombe, updatedAt: ++horloge
        });
        return { rows: [] };
      }
      throw new Error(`requête non simulée : ${texte.slice(0, 90)}`);
    },
    release() {}
  };

  return {
    ...client,
    connect: async () => client,
    lister: store => [...table(store).values()].filter(v => !v.deleted).map(v => v.data),
    lire: (store, id) => { const l = table(store).get(String(id)); return l && !l.deleted ? l.data : null; },
    journal: () => [...journal],
    echouerSur: id => { echouerSur = id; }
  };
}

const admin = { id: 1, role: 'admin' };

/** L'état canonique, réduit à ce qui doit être identique avant/après : id → parent/kind. */
const empreinte = pool => pool.lister('locations')
  .map(l => `${l.id}:${l.kind}:${l.parentId === null || l.parentId === undefined ? '∅' : l.parentId}`)
  .sort();

const VILLE = { id: 1, kind: 'city', name: 'Casablanca', parentId: null, code: null, description: null };
const REGION = { id: 2, kind: 'region', name: 'Siège', parentId: 1, code: null, description: null };
const DEPARTEMENT = { id: 3, kind: 'department', name: 'Régie', parentId: 2, code: null, description: null };

/* ═════════════ 6 · le cas nominal : le graphe exact, en une transaction ═════════════ */

test('AT·1 — un lot valide est écrit EN ENTIER, dans UNE transaction, parent avant enfant', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);

  // Délibérément dans le désordre : le tri par niveau doit être observé, pas l'ordre d'arrivée.
  const rapport = await access.applyLocationsRestore(admin, { locations: [DEPARTEMENT, VILLE, REGION] });

  assert.equal(rapport.locations, 3);
  assert.deepEqual(empreinte(pool), ['1:city:∅', '2:region:1', '3:department:2'],
    'la hiérarchie exacte doit être en base');
  assert.deepEqual(pool.journal(), ['BEGIN', 'COMMIT'],
    'une seule transaction, validée — jamais N transactions indépendantes');
});

/* ═════════ 3 et 4 · LE CŒUR : une panne EN COURS DE LOT = zéro changement net ═════════ */

test('AT·2 — panne sur le DEUXIÈME membre du lot : ZÉRO changement net, la Ville ne survit pas', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);
  const avant = empreinte(pool);
  assert.deepEqual(avant, [], 'S0 : base vierge de localisations');

  pool.echouerSur(2); // la Région est refusée, APRÈS que la Ville a été écrite

  await assert.rejects(
    () => access.applyLocationsRestore(admin, { locations: [VILLE, REGION, DEPARTEMENT] }),
    /refus définitif du serveur/,
    'l’échec doit remonter — jamais être avalé pour continuer au membre suivant'
  );

  assert.deepEqual(empreinte(pool), avant,
    'ZÉRO changement net : la Ville écrite avant la panne doit avoir disparu avec le ROLLBACK');
  assert.equal(pool.lire('locations', 1), null, 'aucune moitié d’arbre ne survit');
  assert.equal(pool.lire('locations', 2), null);
  assert.equal(pool.lire('locations', 3), null);
  assert.deepEqual(pool.journal(), ['BEGIN', 'ROLLBACK'], 'la transaction doit être ANNULÉE, pas validée');
});

test('AT·3 — panne sur le TROISIÈME membre : ni la Ville ni la Région ne survivent', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);
  const avant = empreinte(pool);

  pool.echouerSur(3); // le Département est refusé, après Ville ET Région

  await assert.rejects(() => access.applyLocationsRestore(admin, { locations: [VILLE, REGION, DEPARTEMENT] }));

  assert.deepEqual(empreinte(pool), avant, 'ZÉRO changement net');
  assert.equal(pool.lire('locations', 1), null, 'la Ville, écrite en premier, ne reste pas');
  assert.equal(pool.lire('locations', 2), null, 'la Région, écrite en deuxième, ne reste pas');
  assert.deepEqual(pool.journal(), ['BEGIN', 'ROLLBACK']);
});

test('AT·4 — une panne ne touche pas non plus l’état PRÉEXISTANT : S0 est rendu intact', async () => {
  // Une restauration est ADDITIVE : elle s'applique sur une base qui contient déjà un arbre.
  const pool = poolTransactionnel({
    users: [{ id: 1, role: 'admin' }],
    locations: [{ id: 9, kind: 'city', name: 'Rabat', parentId: null }]
  });
  const access = createAccessControl(pool);
  const S0 = empreinte(pool);
  assert.deepEqual(S0, ['9:city:∅']);

  pool.echouerSur(2);
  await assert.rejects(() => access.applyLocationsRestore(admin, { locations: [VILLE, REGION, DEPARTEMENT] }));

  assert.deepEqual(empreinte(pool), S0, 'la base doit être EXACTEMENT S0, ni plus ni moins');
  assert.equal(pool.lire('locations', 9).name, 'Rabat', 'l’existant n’est pas emporté par l’annulation');
});

/* ═══════════ 2 et 1 · la sémantique du parent, vérifiée là où l'écriture a lieu ═══════════ */

test('AT·5 — un parentId inconnu est refusé par le serveur, AVANT toute écriture', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);

  await assert.rejects(
    () => access.applyLocationsRestore(admin, { locations: [{ id: 3, kind: 'department', name: 'Régie', parentId: 999 }] }),
    error => {
      assert.equal(error.code, 'LOCATIONS_GRAPH_INVALID');
      assert.equal(error.status, 400);
      assert.ok(error.errors.some(e => e.code === 'UNKNOWN_PARENT'));
      return true;
    }
  );
  assert.deepEqual(empreinte(pool), [], 'zéro écriture');
  assert.deepEqual(pool.journal(), [], 'aucune transaction n’est même ouverte : le refus précède l’écriture');
});

test('AT·6 — un parentId NUL (orphelin « non rattaché ») est accepté et écrit', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);

  const rapport = await access.applyLocationsRestore(admin, {
    locations: [{ id: 2, kind: 'region', name: 'Siège', parentId: null, code: null, description: null }]
  });

  assert.equal(rapport.locations, 1);
  assert.deepEqual(empreinte(pool), ['2:region:∅'], 'l’état orphelin est un état légitime, il se restaure');
});

/* ═══════════ 7 · un parent DÉJÀ en base, hors du lot : la restauration est additive ═══════════ */

test('AT·7 — un parent valide déjà en base, absent du lot, est résolu — pas refusé', async () => {
  const pool = poolTransactionnel({
    users: [{ id: 1, role: 'admin' }],
    locations: [{ id: 1, kind: 'city', name: 'Casablanca', parentId: null }]
  });
  const access = createAccessControl(pool);

  const rapport = await access.applyLocationsRestore(admin, { locations: [REGION] });
  assert.equal(rapport.locations, 1);
  assert.deepEqual(empreinte(pool), ['1:city:∅', '2:region:1']);
});

/* ═══════════════════ 9 · l'ACL n'est pas élargie ═══════════════════ */

test('AT·8 — seul un rôle portant `system.restore` peut restaurer : ACL inchangée', async () => {
  for (const role of ['manager', 'chef', 'technicien', 'visiteur']) {
    const pool = poolTransactionnel({ users: [{ id: 7, role }] });
    const access = createAccessControl(pool);
    await assert.rejects(
      () => access.applyLocationsRestore({ id: 7, role }, { locations: [VILLE] }),
      error => {
        assert.equal(error.status, 403, `${role} doit être refusé`);
        assert.equal(error.code, 'LOCATIONS_RESTORE_FORBIDDEN');
        return true;
      },
      `le rôle « ${role} » ne possède pas system.restore`
    );
    assert.deepEqual(empreinte(pool), [], `${role} ne doit rien avoir écrit`);
    assert.deepEqual(pool.journal(), [], 'le refus précède toute transaction');
  }
});

test('AT·9 — un lot vide n’ouvre aucune transaction et n’écrit rien', async () => {
  const pool = poolTransactionnel({ users: [{ id: 1, role: 'admin' }] });
  const access = createAccessControl(pool);
  assert.deepEqual(await access.applyLocationsRestore(admin, { locations: [] }), { locations: 0 });
  assert.deepEqual(pool.journal(), []);
});

/* ═══════════════════ 8 · la révision avance — un STALE_WRITE reste un vrai refus ═══════════════════ */

test('AT·10 — la restauration fait AVANCER la révision : une session ouverte est bien dépassée', async () => {
  /*
   * `put()` écrit avec `force: true` — une restauration est une décision sur un ENSEMBLE,
   * pas la modification d'une fiche ouverte, donc elle ne se compare à rien. Mais la
   * révision doit tout de même avancer : sans cela, une session restée ouverte sur
   * l'ancienne version réécraserait ce qui vient d'être restauré, et son écriture ne
   * serait PAS refusée. C'est cette avance — donc le refus ultérieur — qui est vérifiée ici.
   */
  const pool = poolTransactionnel({
    users: [{ id: 1, role: 'admin' }],
    locations: [{ id: 1, kind: 'city', name: 'Ancien nom', parentId: null, [REVISION_FIELD]: 4 }]
  });
  const access = createAccessControl(pool);

  await access.applyLocationsRestore(admin, { locations: [VILLE] });

  const relue = pool.lire('locations', 1);
  assert.equal(relue.name, 'Casablanca', 'la restauration écrase bien la fiche');
  assert.equal(revisionOf(relue), 5,
    'la révision doit avancer de EXACTEMENT un : une session restée en 4 sera désormais refusée');
});

test('AT·11 — la révision restaurée est celle du serveur, jamais celle du fichier', async () => {
  /*
   * Un fichier de sauvegarde porte la `_revision` qu'avait la fiche au moment de l'archive.
   * La croire remettrait le compteur EN ARRIÈRE et rouvrirait à une session périmée le
   * droit d'écraser. `compareAndWrite` pose la révision suivante lui-même ; cette épreuve
   * le vérifie sur le chemin de restauration précisément.
   */
  const pool = poolTransactionnel({
    users: [{ id: 1, role: 'admin' }],
    locations: [{ id: 1, kind: 'city', name: 'Ancien nom', parentId: null, [REVISION_FIELD]: 9 }]
  });
  const access = createAccessControl(pool);

  await access.applyLocationsRestore(admin, {
    locations: [{ ...VILLE, [REVISION_FIELD]: 2 }] // le fichier prétend « révision 2 »
  });

  assert.equal(revisionOf(pool.lire('locations', 1)), 10,
    'la révision suit la base (9 → 10), jamais le nombre écrit dans le fichier');
});
