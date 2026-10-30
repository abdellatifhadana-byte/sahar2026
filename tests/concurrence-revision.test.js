import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  REVISION_STORES, REVISION_ERRORS, REVISION_FIELD, STALE_WRITE_MESSAGE,
  storeUsesRevision, revisionOf, expectedRevisionFrom, withRevision,
  staleWriteResponse, isConflictCode
} from '../revision-contract.js';
import { compareAndWrite, tombstoneWithRevision, tombstoneManyWithRevision } from '../scripts/revision-store.js';

/*
 * DEUX SESSIONS, UN ENREGISTREMENT, UNE PERTE.
 *
 * Mesuré sur `main@33827f43` par `scripts/concurrence-e2e.mjs` : sur six magasins,
 * l'enregistrement périmé d'une session écrasait la modification récente d'une autre —
 * `rooms.coordinates` revenait de {99,99} à {10,20}, `walls.columns` de 8 à 3 — et une
 * fiche supprimée par un utilisateur était ressuscitée par un autre. Aucun refus, aucun
 * avertissement, dans les deux sens.
 *
 * La cause : `PUT /api/data/:store/:id` remplaçait l'enregistrement ENTIER par la charge
 * reçue, sans jamais comparer de version.
 *
 * Ces tests EXÉCUTENT la comparaison et l'écriture. Le double de connexion simule le
 * VERROU DE LIGNE de PostgreSQL — sans lui, on prouverait la règle sans prouver son
 * atomicité, et c'est précisément l'atomicité qui manque quand deux requêtes arrivent
 * ensemble.
 */

/* ══════════════════════════════ le contrat, seul */

test('REV·1 — un enregistrement sans révision vaut la révision 0', () => {
  assert.equal(revisionOf(undefined), 0);
  assert.equal(revisionOf({}), 0);
  assert.equal(revisionOf({ _revision: 0 }), 0);
  assert.equal(revisionOf({ _revision: '7' }), 7);
  assert.equal(revisionOf({ _revision: -3 }), 0, 'une révision négative n’a aucun sens');
  assert.equal(revisionOf({ _revision: 1.5 }), 0);
});

test('REV·2 — la révision déclarée vient de `expectedRevision`, sinon de l’enregistrement', () => {
  assert.equal(expectedRevisionFrom({ expectedRevision: 4, _revision: 9 }), 4,
    'le champ explicite doit primer');
  assert.equal(expectedRevisionFrom({ _revision: 9 }), 9,
    'à défaut, la fiche telle qu’elle a été lue');
  assert.equal(expectedRevisionFrom({}), 0);
  assert.equal(expectedRevisionFrom({ expectedRevision: 0, _revision: 9 }), 0,
    'déclarer explicitement 0 est une création, pas une absence');
});

test('REV·3 — les magasins soumis au contrat sont ceux qu’un humain édite', () => {
  for (const store of ['rooms', 'baies', 'equipments', 'walls', 'screens', 'cables', 'docs', 'notes']) {
    assert.equal(storeUsesRevision(store), true, `${store} devrait être protégé`);
  }
  // Un journal est un fait nouveau, jamais la modification d'un fait ancien : deux
  // entrées concurrentes s'ajoutent, elles ne s'écrasent pas.
  assert.equal(storeUsesRevision('logs'), false);
  assert.equal(storeUsesRevision('syncQueue'), false);
  assert.equal(storeUsesRevision('backups'), false);
  assert.equal(storeUsesRevision('zones'), false, 'les magasins d’accès sont écrits par le serveur seul');
  assert.equal(storeUsesRevision('resource_zones'), false);
});

test('REV·4 — le refus parle français et dit quoi faire, jamais « 409 »', () => {
  const reponse = staleWriteResponse(REVISION_ERRORS.STALE_WRITE, 7);
  assert.equal(reponse.error, 'STALE_WRITE');
  assert.equal(reponse.message, STALE_WRITE_MESSAGE);
  assert.match(reponse.message, /modifiée par un autre utilisateur/);
  assert.match(reponse.message, /Rechargez/);
  assert.doesNotMatch(reponse.message, /409|STALE|revision/i, 'le message montre notre plomberie');
  assert.equal(reponse.currentRevision, 7, 'l’écran ne peut pas se resituer sans la version courante');
  assert.equal(isConflictCode('STALE_WRITE'), true);
  assert.equal(isConflictCode('ZONE_FORBIDDEN'), false);
});

test('REV·5 — `withRevision` n’altère rien d’autre', () => {
  const estampille = withRevision({ id: 'r1', name: 'STC', coordinates: { x: 1, y: 2 } }, 3);
  assert.deepEqual(estampille, { id: 'r1', name: 'STC', coordinates: { x: 1, y: 2 }, _revision: 3 });
});

/* ══════════════════════════════ le double, avec verrou de ligne
 *
 * `SELECT … FOR UPDATE` sérialise les écrivains sur une même ligne. Le double le
 * reproduit : une écriture qui détient le verrou bloque les autres jusqu'à son COMMIT.
 * Sans cela, deux écritures « concurrentes » du test s'exécuteraient l'une après l'autre
 * par la grâce de la boucle d'événements, et l'atomicité ne serait jamais éprouvée.
 */
function poolDouble(seed = {}) {
  const lignes = new Map();
  const verrous = new Map(); // record → Promise en cours
  let requetes = 0;
  // Séparateur NUL écrit en ÉCHAPPEMENT et non en octet brut : un octet nul dans le
  // fichier le fait passer pour binaire aux yeux de git, qui cesse alors d’en montrer les
  // différences et de le fouiller. Même clé, fichier lisible.
  const cle = (store, id) => `${store}\u0000${id}`;
  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) lignes.set(cle(store, record.id), { data: record, deleted: false });
  }

  const creerClient = () => {
    const tenus = [];
    let libererCourant = null;
    return {
      async query(sql, params = []) {
        requetes += 1;
        const texte = String(sql).replace(/\s+/g, ' ').trim();

        if (texte === 'BEGIN') return { rows: [] };
        if (texte === 'COMMIT' || texte === 'ROLLBACK') {
          for (const liberer of tenus.splice(0)) liberer();
          return { rows: [] };
        }

        /*
         * LE VERROU DE CLÉ LOGIQUE — celui qui existe même sans ligne.
         *
         * C'est ici que se joue la création concurrente. Le double prenait autrefois un
         * verrou dans la branche `FOR UPDATE` même quand AUCUNE ligne n'existait, ce que
         * PostgreSQL ne fait pas : il sur-verrouillait, et masquait donc précisément le
         * défaut qu'il prétendait éprouver.
         */
        if (texte.startsWith('SELECT pg_advisory_xact_lock')) {
          const identifiant = cle(params[0], params[1]);
          while (verrous.has(identifiant)) await verrous.get(identifiant);
          let liberer;
          const attente = new Promise(resolve => { liberer = () => { verrous.delete(identifiant); resolve(); }; });
          verrous.set(identifiant, attente);
          tenus.push(liberer);
          libererCourant = liberer;
          return { rows: [{ pg_advisory_xact_lock: '' }] };
        }

        if (texte.includes('FOR UPDATE')) {
          const identifiant = cle(params[0], params[1]);
          const ligne = lignes.get(identifiant);
          // FIDÈLE À PostgreSQL : `FOR UPDATE` ne verrouille QUE des lignes existantes.
          // Une ligne absente ne verrouille rien — c'est tout le défaut de la création
          // concurrente, et le double doit le reproduire pour qu'il reste éprouvable.
          if (ligne) {
            while (verrous.has(identifiant) && !tenus.length) await verrous.get(identifiant);
          }
          return { rows: ligne ? [{ data: ligne.data, deleted: ligne.deleted }] : [] };
        }

        if (texte.startsWith('INSERT INTO platform_records')) {
          const identifiant = cle(params[0], params[1]);
          const tombe = texte.includes(',TRUE,NOW()');
          lignes.set(identifiant, { data: JSON.parse(params[2]), deleted: tombe });
          return { rows: [], rowCount: 1 };
        }

        // Pierres tombales en masse : une seule instruction, le compteur avance dedans.
        if (texte.startsWith('UPDATE platform_records')) {
          const [store, identifiants] = params;
          let touchees = 0;
          for (const [clef, ligne] of lignes) {
            if (!clef.startsWith(`${store}\u0000`) || ligne.deleted) continue;
            const id = clef.slice(store.length + 1);
            if (identifiants && !identifiants.includes(id)) continue;
            const avance = texte.includes('jsonb_set');
            const courante = Number(ligne.data?.[REVISION_FIELD]);
            ligne.data = avance
              ? { ...ligne.data, [REVISION_FIELD]: (Number.isSafeInteger(courante) && courante > 0 ? courante : 0) + 1 }
              : ligne.data;
            ligne.deleted = true;
            touchees += 1;
          }
          return { rows: [], rowCount: touchees };
        }

        if (texte.startsWith('SELECT data FROM platform_records')) {
          const ligne = lignes.get(cle(params[0], params[1]));
          return { rows: ligne && !ligne.deleted ? [{ data: ligne.data }] : [] };
        }

        throw new Error(`requête non simulée : ${texte.slice(0, 80)}`);
      },
      release() { for (const liberer of tenus.splice(0)) liberer(); void libererCourant; }
    };
  };

  return {
    query: (...args) => creerClient().query(...args),
    connect: async () => creerClient(),
    lire: (store, id) => { const l = lignes.get(cle(store, id)); return l && !l.deleted ? l.data : null; },
    brut: (store, id) => lignes.get(cle(store, id)) || null,
    requetes: () => requetes
  };
}

const ecrire = (pool, store, id, record, expectedRevision) =>
  compareAndWrite(pool, { storeName: store, recordId: id, record, expectedRevision });

/* ══════════════════════════════ la perte, refusée */

test('REV·6 — une écriture périmée est REFUSÉE, la modification récente survit', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Régie A', location: 'Bât. 1', coordinates: { x: 10, y: 20 }, _revision: 1 }] });

  // La session A a lu la révision 1. La session B modifie la géométrie.
  const vuParA = pool.lire('rooms', 'r1');
  const parB = await ecrire(pool, 'rooms', 'r1', { ...vuParA, coordinates: { x: 99, y: 99 } }, 1);
  assert.equal(parB.ok, true);
  assert.equal(parB.revision, 2);

  // La session A enregistre SA copie, vieille d'une révision.
  const parA = await ecrire(pool, 'rooms', 'r1', { ...vuParA, location: 'Bât. 2' }, 1);
  assert.equal(parA.ok, false, 'l’écriture périmée a été acceptée');
  assert.equal(parA.code, REVISION_ERRORS.STALE_WRITE);
  assert.equal(parA.currentRevision, 2);

  const final = pool.lire('rooms', 'r1');
  assert.deepEqual(final.coordinates, { x: 99, y: 99 }, 'la géométrie de B a été écrasée');
  assert.equal(final.location, 'Bât. 1', 'la modification refusée a quand même été écrite');
});

test('REV·7 — une écriture À JOUR passe et fait avancer la révision', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Régie A', _revision: 4 }] });
  const resultat = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Régie B' }, 4);
  assert.equal(resultat.ok, true);
  assert.equal(resultat.revision, 5);
  assert.equal(pool.lire('rooms', 'r1')._revision, 5, 'la révision n’est pas stockée');
  assert.equal(pool.lire('rooms', 'r1').name, 'Régie B');
});

test('REV·8 — la révision est posée par le SERVEUR, pas par la charge utile', async () => {
  // Sinon il suffirait d'envoyer `_revision: 999` pour n'être jamais refusé.
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'A', _revision: 2 }] });
  const resultat = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'B', _revision: 999 }, 2);
  assert.equal(resultat.ok, true);
  assert.equal(pool.lire('rooms', 'r1')._revision, 3, 'la révision envoyée par le client a été crue');
});

test('REV·9 — deux champs DIFFÉRENTS ne se fusionnent pas d’office', async () => {
  // Le serveur ne sait pas si `statut` et `ports` peuvent coexister. Deviner produirait
  // un état que personne n'a voulu : on refuse, et on rend la main.
  const pool = poolDouble({ equipments: [{ id: 'e1', statut: 'En service', ports: [], _revision: 1 }] });
  const vu = pool.lire('equipments', 'e1');
  await ecrire(pool, 'equipments', 'e1', { ...vu, statut: 'En panne' }, 1);
  const parA = await ecrire(pool, 'equipments', 'e1', { ...vu, ports: [{ id: 'p1' }] }, 1);
  assert.equal(parA.ok, false);
  assert.equal(pool.lire('equipments', 'e1').statut, 'En panne');
  assert.deepEqual(pool.lire('equipments', 'e1').ports, []);
});

test('REV·10 — le MÊME champ modifié deux fois : le second est refusé, pas silencieux', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Origine', _revision: 1 }] });
  await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par B' }, 1);
  const parA = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par A' }, 1);
  assert.equal(parA.ok, false);
  assert.equal(pool.lire('rooms', 'r1').name, 'Par B');
});

/* ══════════════════════════════ création, suppression, recréation */

test('REV·11 — une création déclare la révision 0', async () => {
  const pool = poolDouble({});
  const resultat = await ecrire(pool, 'rooms', 'r-neuve', { id: 'r-neuve', name: 'Neuve' }, 0);
  assert.equal(resultat.ok, true);
  assert.equal(resultat.revision, 1);
});

test('REV·12 — deux créations concurrentes : la seconde est refusée', async () => {
  const pool = poolDouble({});
  const creer = nom => compareAndWrite(pool, {
    storeName: 'rooms', recordId: 'r-neuve', record: { id: 'r-neuve', name: nom },
    expectedRevision: 0, intent: 'create'
  });
  const [premier, second] = await Promise.all([creer('Par A'), creer('Par B')]);
  const acceptes = [premier, second].filter(resultat => resultat.ok);
  assert.equal(acceptes.length, 1, 'les deux créations concurrentes ont été acceptées');
  const refuse = [premier, second].find(resultat => !resultat.ok);
  assert.equal(refuse.code, REVISION_ERRORS.ALREADY_EXISTS);
});

test('REV·13 — enregistrer une fiche SUPPRIMÉE par un autre est refusé, pas ressuscité', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Vivante', _revision: 3 }] });
  const vuParA = pool.lire('rooms', 'r1');
  await tombstoneWithRevision(pool, { storeName: 'rooms', recordId: 'r1' });

  const parA = await ecrire(pool, 'rooms', 'r1', { ...vuParA, name: 'Ressuscitée' }, 3);
  assert.equal(parA.ok, false, 'la fiche supprimée a été ressuscitée en silence');
  assert.equal(parA.code, REVISION_ERRORS.DELETED_ELSEWHERE);
  assert.equal(pool.lire('rooms', 'r1'), null);
});

test('REV·14 — la pierre tombale GARDE la révision : une recréation repart au-dessus', async () => {
  // Sans cela, une fiche supprimée puis recréée reviendrait à la révision 1, et une
  // session restée ouverte sur l'ancienne révision 1 pourrait l'écraser.
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Vivante', _revision: 5 }] });
  await tombstoneWithRevision(pool, { storeName: 'rooms', recordId: 'r1' });
  assert.equal(pool.brut('rooms', 'r1').deleted, true);
  assert.equal(revisionOf(pool.brut('rooms', 'r1').data), 6, 'la pierre tombale n’a pas gardé la révision');

  const recreation = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Recréée' }, 0);
  assert.equal(recreation.ok, true, 'une recréation délibérée doit rester possible');
  assert.equal(recreation.revision, 7, 'la recréation est repartie sous l’ancienne révision');
});

test('REV·15 — supprimer avec une révision périmée est refusé', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Vivante', _revision: 2 }] });
  await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Modifiée par B' }, 2);
  const suppression = await tombstoneWithRevision(pool, { storeName: 'rooms', recordId: 'r1', expectedRevision: 2 });
  assert.equal(suppression.ok, false, 'une suppression périmée a effacé une modification récente');
  assert.equal(suppression.code, REVISION_ERRORS.STALE_WRITE);
  assert.equal(pool.lire('rooms', 'r1')?.name, 'Modifiée par B');
});

/* ══════════════════════════════ les enregistrements hérités */

test('REV·16 — un enregistrement SANS révision se migre à la première écriture', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Héritée' }] });
  const resultat = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Modifiée' }, 0);
  assert.equal(resultat.ok, true, 'un enregistrement hérité est devenu inécrivable');
  assert.equal(resultat.revision, 1);
});

test('REV·17 — deux sessions sur un enregistrement HÉRITÉ : la seconde est refusée', async () => {
  // Elles déclarent 0 toutes les deux ; la première fait passer à 1, la seconde diverge.
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Héritée' }] });
  await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par B' }, 0);
  const parA = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par A' }, 0);
  assert.equal(parA.ok, false);
  assert.equal(pool.lire('rooms', 'r1').name, 'Par B');
});

/* ══════════════════════════════ l'atomicité, éprouvée */

test('REV·18 — deux écritures SIMULTANÉES sur la même révision : une seule passe', async () => {
  // Sans verrou de ligne, les deux liraient la révision 1 avant que l'une n'écrive, et les
  // deux passeraient — la comparaison serait décorative.
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Origine', _revision: 1 }] });
  const resultats = await Promise.all([
    ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par A' }, 1),
    ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par B' }, 1),
    ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par C' }, 1)
  ]);
  assert.equal(resultats.filter(resultat => resultat.ok).length, 1,
    'plusieurs écritures concurrentes ont été acceptées sur la même révision');
  assert.equal(pool.lire('rooms', 'r1')._revision, 2);
  for (const refus of resultats.filter(resultat => !resultat.ok)) {
    assert.equal(refus.code, REVISION_ERRORS.STALE_WRITE);
    assert.equal(refus.currentRevision, 2);
  }
});

test('REV·19 — une rafale d’écritures enchaînées avance d’une révision à chaque fois', async () => {
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Origine', _revision: 1 }] });
  let revision = 1;
  for (let tour = 0; tour < 5; tour += 1) {
    const resultat = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: `Tour ${tour}` }, revision);
    assert.equal(resultat.ok, true, `tour ${tour} refusé`);
    assert.equal(resultat.revision, revision + 1);
    revision = resultat.revision;
  }
  assert.equal(pool.lire('rooms', 'r1')._revision, 6);
});

/* ══════════════════════════════ les écritures délibérées de masse */

test('REV·20 — une écriture FORCÉE ignore la comparaison mais fait avancer la révision', async () => {
  // Restauration d'archive, import, remplacement d'inventaire : ce sont des décisions
  // explicites sur un ensemble entier, pas la modification d'une fiche ouverte. Elles ne
  // se comparent à rien — mais elles doivent laisser derrière elles une révision plus
  // haute, sinon les sessions ouvertes ne verraient pas qu'elles ont été dépassées.
  const pool = poolDouble({ rooms: [{ id: 'r1', name: 'Origine', _revision: 4 }] });
  const resultat = await compareAndWrite(pool, {
    storeName: 'rooms', recordId: 'r1', record: { id: 'r1', name: 'Restaurée' }, force: true
  });
  assert.equal(resultat.ok, true);
  assert.equal(resultat.revision, 5);

  const perimee = await ecrire(pool, 'rooms', 'r1', { id: 'r1', name: 'Par A' }, 4);
  assert.equal(perimee.ok, false, 'une session ouverte avant la restauration a pu écraser');
});

test('REV·21 — un magasin HORS contrat n’est jamais refusé pour cause de révision', async () => {
  // Un journal est un fait nouveau : deux entrées concurrentes s'ajoutent.
  const pool = poolDouble({ logs: [{ id: 'l1', message: 'Origine' }] });
  const resultat = await compareAndWrite(pool, {
    storeName: 'logs', recordId: 'l1', record: { id: 'l1', message: 'Suivante' }, expectedRevision: 0
  });
  assert.equal(resultat.ok, true);
  assert.equal(REVISION_FIELD in pool.lire('logs', 'l1'), false,
    'un magasin hors contrat a été estampillé');
});

/* ══════════════════════════════ le champ métier « revision » lui appartient */

/*
 * LA COLLISION DE NOM, MESURÉE.
 *
 * `revision` est déjà un CHAMP MÉTIER de la plateforme, et depuis longtemps :
 *
 *   · `diagram-contract.js:130`   revision:clean(source.revision ?? '1', 40)
 *   · `continuity-contract.js`    idem, sur les groupes de continuité
 *   · `diagram-studio.js:142`     affiché à l'écran : « Rév. {revision} »
 *   · `diagram-studio.js:340`     incrémenté comme une CHAÎNE, et c'est lui qui interdit
 *                                 de modifier un schéma validé sans créer une révision
 *
 * C'est une étiquette écrite par un humain — « 1 », « 2 », « v2.3 » — sur quarante
 * caractères. Le compteur de concurrence n'a rien à voir avec elle.
 *
 * Les avoir confondus produisait deux dégâts, tous deux constatés en exécutant la
 * séquence CI complète :
 *
 *   1. la CRÉATION d'un schéma était refusée — son étiquette « 1 » était lue comme une
 *      révision de concurrence, donc comme la prétention de modifier une fiche disparue ;
 *   2. à chaque écriture acceptée, l'étiquette de l'auteur était REMPLACÉE par le
 *      compteur. Une perte silencieuse de donnée métier — précisément ce que ce lot
 *      existe pour empêcher, introduite par ce lot.
 *
 * Le compteur porte donc un nom qui lui est propre et que rien d'autre n'utilise.
 */

test('REV·22 — l’étiquette métier « revision » survit à une écriture concurrente', async () => {
  const pool = poolDouble({ docs: [{ id: 'd1', title: 'Synoptique RF1', revision: 'v2.3' }] });
  const resultat = await compareAndWrite(pool, {
    storeName: 'docs', recordId: 'd1',
    record: { id: 'd1', title: 'Synoptique RF1 corrigé', revision: 'v2.3' },
    expectedRevision: 0
  });
  assert.equal(resultat.ok, true);
  assert.equal(pool.lire('docs', 'd1').revision, 'v2.3',
    'le compteur de concurrence a écrasé l’étiquette de révision du document');
});

test('REV·23 — une étiquette « 1 » n’est pas lue comme une révision de concurrence', async () => {
  // Un schéma neuf sort de `normalizeDiagram` avec `revision:'1'`. Rien n'existe encore en
  // base : c'est une création, et elle doit passer.
  const pool = poolDouble({});
  const neuf = { id: 'd-neuf', kind: 'technical_diagram', title: 'Schéma neuf', revision: '1' };
  const resultat = await compareAndWrite(pool, {
    storeName: 'docs', recordId: 'd-neuf', record: neuf,
    expectedRevision: expectedRevisionFrom(neuf), intent: 'create'
  });
  assert.equal(resultat.ok, true,
    `création refusée : ${resultat.code} — l’étiquette métier a été prise pour un compteur`);
  assert.equal(pool.lire('docs', 'd-neuf').revision, '1');
});

test('REV·24 — le compteur de concurrence porte un nom qui n’appartient qu’à lui', () => {
  // La garde de fond : si le champ redevenait `revision`, tout ce qui précède retomberait.
  assert.notEqual(REVISION_FIELD, 'revision',
    '`revision` est un champ métier (schémas, continuité, synoptiques) : le compteur ne peut pas le porter');
  assert.match(REVISION_FIELD, /^_/, 'un champ d’infrastructure se distingue d’un champ métier');
  assert.equal(revisionOf({ [REVISION_FIELD]: 5, revision: 'v9' }), 5,
    'le compteur se lit sur son propre champ');
  assert.equal(revisionOf({ revision: 7 }), 0,
    'un champ métier nommé « revision » ne doit jamais être lu comme un compteur');
});

/* ══════════════════════════════ le compteur ne recule jamais */

/*
 * UNE ÉCRITURE EN MASSE QUI REMET LE COMPTEUR À ZÉRO ROUVRE LA PERTE.
 *
 * `scripts/inventory-replace-preload.js` remplace l'inventaire central par un `INSERT …
 * ON CONFLICT DO UPDATE` brut : la charge écrite ne porte aucun compteur, donc
 * l'enregistrement retombe à la révision 0.
 *
 * Le compteur recule alors, et la garde se retourne contre elle-même :
 *
 *   révision 4  · la session X ouvre la fiche et la garde à l'écran
 *   révision 0  · le remplacement central passe — le compteur est reparti de zéro
 *   révision 1,2,3,4 · quatre modifications ordinaires le ramènent à 4
 *   révision 4  · la session X enregistre SA copie : les compteurs concordent, elle passe
 *
 * Tout ce qui a été écrit depuis le remplacement disparaît alors sans un mot. La règle
 * n'est donc pas « comparer », c'est « comparer un compteur QUI NE RECULE JAMAIS ».
 */

test('REV·25 — un remplacement en masse fait AVANCER le compteur, il ne le remet pas à zéro', async () => {
  const pool = poolDouble({ equipments: [{ id: 'e1', name: 'Ultrix', _revision: 4 }] });

  // Le remplacement central : une décision délibérée sur un ensemble, donc `force`.
  const remplacement = await compareAndWrite(pool, {
    storeName: 'equipments', recordId: 'e1',
    record: { id: 'e1', name: 'Ultrix (inventaire central)' }, force: true
  });
  assert.equal(remplacement.ok, true);
  assert.equal(remplacement.revision, 5, 'le remplacement a fait reculer le compteur');

  // La session X, ouverte AVANT le remplacement, ne doit jamais retrouver son compteur.
  for (let tour = 0; tour < 5; tour += 1) {
    const perimee = await ecrire(pool, 'equipments', 'e1', { id: 'e1', name: 'Par X' }, 4);
    assert.equal(perimee.ok, false, `la session ouverte avant le remplacement est repassée au tour ${tour}`);
    const courante = revisionOf(pool.lire('equipments', 'e1'));
    await ecrire(pool, 'equipments', 'e1', { id: 'e1', name: `Tour ${tour}` }, courante);
  }
  assert.equal(pool.lire('equipments', 'e1').name, 'Tour 4',
    'les modifications postérieures au remplacement ont été écrasées');
});

/* ══════════════════════════════ une seule porte vers la table */

test('REV·26 — `platform_records` n’est écrit que par le magasin de révisions', () => {
  /*
   * INVARIANT D'ARCHITECTURE, ET NON RÈGLE DE COMPORTEMENT.
   *
   * Le contrat ne tient que si TOUTE mutation passe par le même endroit. Chaque écriture
   * faite ailleurs est une porte dérobée : elle change la donnée sans faire avancer le
   * compteur, et personne ne s'en aperçoit avant qu'un travail ait disparu.
   *
   * CE QUE CE TEST NE VOYAIT PAS
   * ---------------------------
   * Il ne cherchait que `INSERT INTO platform_records`. Or une porte dérobée n'a pas besoin
   * d'insérer : `UPDATE ... SET data=…` change le contenu, `UPDATE ... SET deleted=TRUE`
   * fait disparaître la fiche. Sept d'entre elles vivaient dans le Runtime sous ce test
   * vert — dont une sur CHAQUE connexion (`lastLogin`, `authVersion`) et deux dans le
   * remplacement d'inventaire.
   *
   * Le dégât est précis. `users` est un magasin à révision. Le navigateur détient la
   * révision 4 ; le serveur modifie `passwordHash` par un `UPDATE` direct, sans toucher au
   * compteur ; le navigateur renvoie sa fiche en déclarant 4 ; le serveur compare 4 à 4,
   * conclut qu'elle est à jour, et laisse réécrire des données plus anciennes. Le compteur
   * cesse alors de signifier « tout ce qui est arrivé à cet enregistrement ».
   *
   * Un examen du source est ici le bon outil : la règle porte sur la FORME du dépôt, pas
   * sur le comportement d'une exécution. Les règles de comportement, elles, sont éprouvées
   * en exécutant le code — plus haut dans ce fichier, et dans les scripts de bout en bout.
   */
  const racine = new URL('..', import.meta.url);

  /*
   * DÉROGATIONS — chacune nommée, chacune justifiée.
   *
   * `scripts/revision-store.js`   le magasin lui-même : c'est la seule porte.
   * `scripts/roles-sync-e2e.mjs`  fixture d'épreuve qui ABÎME délibérément un rôle en base
   *   pour vérifier que le serveur se ferme dessus. Passer par le magasin normaliserait la
   *   donnée et l'épreuve n'aurait plus d'objet. Aucune ligne de Runtime n'en dépend.
   */
  const AUTORISE = new Map([
    ['scripts/revision-store.js', 'le magasin canonique'],
    ['scripts/roles-sync-e2e.mjs', 'fixture qui corrompt volontairement la base pour éprouver le fail-closed'],
    ['scripts/revision-integrite-e2e.mjs',
      'son `INSERT` EST l’assertion : il doit être REFUSÉ par l’index unique des identifiants'],
    ['scripts/screen-issues-catalog-e2e.mjs',
      'fixture qui sème des `screen_issues` ANTÉRIEURS au contrat de scope explicite (#150) : '
      + 'les poser via le magasin de révisions les ferait passer par une règle d’écriture qui, '
      + 'historiquement, n’existait pas encore pour eux — ce qui invaliderait précisément le cas '
      + 'hérité que l’épreuve doit reproduire. Sans `expectedRevision` à comparer : rien ne les '
      + 'précède, et une session qui les lirait ensuite déclare 0, comme tout enregistrement sans '
      + '`_revision` (revision-contract.js).'],
    ['scripts/screen-group-zone-e2e.mjs',
      'fixture qui sème des `screen_groups` ANTÉRIEURS au contrat de portée de #119 — '
      + '`roomId` d’une zone, `screenIds` d’une autre. Les poser via le magasin de révisions '
      + 'les ferait passer par la règle d’écriture que ce lot vient précisément d’ajouter '
      + '(`INVALID_SCREEN_GROUP_SCOPE`), qui les REFUSE : le cas hérité que l’épreuve doit '
      + 'reproduire n’existerait alors plus. Même raison, et même forme, que la fixture de '
      + '#150 juste au-dessus. Aucune ligne de Runtime n’en dépend.'],
    ['scripts/concurrence-mutations.mjs',
      'son SQL n’est pas exécuté : c’est la CHARGE d’une mutation, qui réintroduit exprès '
      + 'une porte dérobée pour vérifier qu’un test la tue'],
    /*
     * `equipment-location-audit.mjs` — outil de MIGRATION, lancé à la main, jamais par le
     * Runtime. Il réaligne la salle d'équipements dont la baie dit autre chose, sur une base
     * déjà constituée. Il n'a donc pas d'`expectedRevision` à comparer : il n'y a personne
     * dont il faudrait refuser l'écriture, seulement une contradiction à effacer.
     *
     * La dérogation ne le dispense PAS du compteur, et c'est la condition de son admission
     * ici : son `UPDATE` fait avancer `_revision` exactement comme le magasin le ferait.
     * Sans cela, une session restée ouverte sur l'ancienne salle pourrait la réécrire sans
     * être refusée — la migration aurait défait son propre travail. `REAL·1` et l'épreuve
     * de bout en bout `data-auth-e2e.mjs` vérifient cette avancée.
     */
    ['scripts/equipment-location-audit.mjs',
      'migration manuelle hors Runtime ; son UPDATE fait avancer `_revision` comme le magasin'],
    /*
     * `exploitation-scope-browser-gate.mjs` — fixture qui sème un équipement au `roomId`
     * délibérément périmé (sa baie a depuis changé de salle). Un déplacement de baie par
     * l'API vivante réaligne déjà tous ses équipements dans LA MÊME transaction
     * (`realignEquipmentRoomsForBaie`) : la seule façon honnête de reproduire une fiche qui
     * n'est JAMAIS passée par ce chemin — legacy, migrée, ou réparée à la main en base — est
     * cette écriture directe, hors API. Même condition que `equipment-location-audit.mjs`
     * juste au-dessus : son UPDATE fait avancer `_revision` comme le magasin l'aurait fait.
     */
    ['scripts/exploitation-scope-browser-gate.mjs',
      'fixture qui sème un roomId d’équipement délibérément périmé face à sa baie, hors de tout '
      + 'chemin que `realignEquipmentRoomsForBaie` couvre déjà ; son UPDATE fait avancer '
      + '`_revision` comme le magasin le ferait'],
    /*
     * `ticket-sla-browser-gate.mjs` — `deadline` n'est modifiable par AUCUNE API publique
     * (`createServiceRequest` le pose une fois ; `updateServiceRequest` ne le touche jamais ;
     * le PUT générique refuse même `tickets`, `DEDICATED_REQUEST_ENDPOINT`). Simuler les
     * paliers d'escalade SLA (normal/warning/urgent/critical/dépassé) exige donc cette
     * écriture directe, hors API. Même condition que les deux dérogations juste au-dessus :
     * son UPDATE fait avancer `_revision` comme le magasin canonique l'aurait fait.
     */
    ['scripts/ticket-sla-browser-gate.mjs',
      'fixture qui sème un `deadline` de ticket délibérément contrôlé — champ qu’aucune API '
      + 'publique ne peut modifier après création ; son UPDATE fait avancer `_revision` comme '
      + 'le magasin le ferait']
  ]);

  // Trois formes de mutation, pas une seule. Une porte dérobée qui n'insère pas reste une
  // porte dérobée.
  const MUTATIONS = [
    /INSERT\s+INTO\s+platform_records/i,
    /UPDATE\s+platform_records/i,
    /DELETE\s+FROM\s+platform_records/i
  ];

  const coupables = [];
  const parcourir = (dossier, prefixe = '') => {
    for (const entree of readdirSync(new URL(dossier, racine), { withFileTypes: true })) {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
      const chemin = `${prefixe}${entree.name}`;
      if (entree.isDirectory()) { parcourir(`${dossier}${entree.name}/`, `${chemin}/`); continue; }
      if (!entree.name.endsWith('.js') && !entree.name.endsWith('.mjs')) continue;
      if (AUTORISE.has(chemin) || chemin.startsWith('tests/')) continue;
      const source = readFileSync(new URL(`${dossier}${entree.name}`, racine), 'utf8');
      const formes = MUTATIONS.filter(motif => motif.test(source));
      if (formes.length) coupables.push(chemin);
    }
  };
  parcourir('./');

  assert.deepEqual(coupables, [],
    `ces fichiers mutent platform_records sans passer par le magasin de révisions : ${coupables.join(', ')}`);
});

test('REV·27 — une pierre tombale EN MASSE fait avancer chaque compteur', async () => {
  /*
   * Le remplacement d'inventaire et le ménage des comptes en double retirent plusieurs
   * fiches d'un coup. Ils le faisaient par un `UPDATE … SET deleted=TRUE` qui laissait
   * chaque compteur où il était : une session ouverte sur une fiche retirée se croyait
   * encore à jour, et pouvait la faire revivre au premier enregistrement.
   *
   * L'écriture groupée reste UNE seule instruction — la nouvelle révision se calcule dans
   * la même instruction que l'écriture, il n'y a donc aucune fenêtre entre lire et écrire.
   */
  const pool = poolDouble({
    docs: [
      { id: 'd1', title: 'Un', _revision: 4 },
      { id: 'd2', title: 'Deux', _revision: 1 },
      { id: 'd3', title: 'Trois', _revision: 2 }
    ]
  });

  const bilan = await tombstoneManyWithRevision(pool, { storeName: 'docs', recordIds: ['d1', 'd2'] });
  assert.equal(bilan.count, 2, 'seules les fiches nommées doivent partir');

  assert.equal(pool.lire('docs', 'd1'), null, 'la fiche doit être retirée');
  assert.equal(pool.brut('docs', 'd1').data._revision, 5, 'le compteur n’a pas avancé');
  assert.equal(pool.brut('docs', 'd2').data._revision, 2);
  assert.equal(pool.lire('docs', 'd3').title, 'Trois', 'une fiche non nommée a été emportée');

  // Une session ouverte AVANT le retrait ne doit pas pouvoir ressusciter la fiche.
  const ressusciter = await ecrire(pool, 'docs', 'd1', { id: 'd1', title: 'Revenu' }, 4);
  assert.equal(ressusciter.ok, false, 'une fiche retirée en masse a été ressuscitée');
  assert.equal(ressusciter.code, REVISION_ERRORS.DELETED_ELSEWHERE);
});

test('REV·28 — sans identifiants, c’est tout le magasin vivant qui part', async () => {
  // C'est ce que fait le remplacement d'inventaire : il vide un magasin avant de le
  // réécrire. Les fiches déjà retirées ne doivent pas voir leur compteur avancer deux fois.
  const pool = poolDouble({
    equipments: [{ id: 'e1', name: 'Un', _revision: 2 }, { id: 'e2', name: 'Deux', _revision: 7 }]
  });
  await tombstoneManyWithRevision(pool, { storeName: 'equipments', recordIds: ['e1'] });
  const fige = pool.brut('equipments', 'e1').data._revision;

  const bilan = await tombstoneManyWithRevision(pool, { storeName: 'equipments' });
  assert.equal(bilan.count, 1, 'une fiche déjà retirée ne doit pas repartir');
  assert.equal(pool.brut('equipments', 'e1').data._revision, fige, 'son compteur a avancé une seconde fois');
  assert.equal(pool.brut('equipments', 'e2').data._revision, 8);
});
