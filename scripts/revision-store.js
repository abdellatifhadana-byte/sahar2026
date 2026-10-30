/**
 * @file scripts/revision-store.js — comparer et écrire, sans fenêtre entre les deux.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Comparer une révision en JavaScript puis écrire dans une seconde requête laisse une
 * fenêtre : deux sessions peuvent lire la même révision, se croire toutes les deux à jour,
 * et écrire l'une après l'autre. La comparaison serait alors décorative.
 *
 * `SELECT … FOR UPDATE` prend un verrou sur LA LIGNE. Les autres écrivains attendent
 * jusqu'au COMMIT, si bien que la lecture de la révision, la décision et l'écriture
 * forment un seul acte du point de vue des autres sessions.
 *
 * Ce module ne connaît ni les rôles, ni les zones, ni la forme des enregistrements : il ne
 * répond qu'à « cette écriture s'appuie-t-elle sur la version courante ? ». Les gardes
 * d'autorisation restent en amont, et gardent la priorité — un utilisateur non autorisé
 * doit recevoir un refus d'autorisation, jamais un indice sur la version d'une donnée
 * qu'il n'a pas le droit de voir.
 */
import {
  REVISION_ERRORS, REVISION_FIELD, revisionOf, withRevision, storeUsesRevision
} from '../revision-contract.js';

/**
 * VERROU SUR LA CLÉ LOGIQUE — AVANT MÊME DE SAVOIR SI LA LIGNE EXISTE.
 *
 * `SELECT … FOR UPDATE` verrouille UNE LIGNE. Il ne verrouille donc rien quand la ligne
 * n'existe pas encore, et c'est exactement le cas d'une création :
 *
 *     A · SELECT FOR UPDATE (store, X) → aucune ligne, aucun verrou pris
 *     B · SELECT FOR UPDATE (store, X) → aucune ligne, aucun verrou pris
 *     A · calcule _revision = 1                B · calcule _revision = 1
 *     A · INSERT … ON CONFLICT DO UPDATE       B · INSERT … ON CONFLICT DO UPDATE
 *
 * Les deux créations se croient premières. La seconde écrase la première au lieu d'être
 * refusée, et personne n'apprend que deux personnes ont créé la même fiche en même temps.
 *
 * `pg_advisory_xact_lock` verrouille une CLÉ, pas une ligne : elle n'a pas besoin
 * d'exister. Le verrou est lié à la transaction et se relâche seul au COMMIT ou au
 * ROLLBACK — y compris quand la transaction appartient à un appelant extérieur, ce qui est
 * le cas d'une création de salle ou d'un remplacement d'inventaire.
 *
 * `hashtext` réduit chaque partie de la clé à un entier ; deux clés différentes peuvent
 * donc, très rarement, tomber sur le même verrou. La conséquence est qu'elles attendent
 * l'une après l'autre — jamais qu'une écriture passe à travers.
 */
const VERROU_CLE_LOGIQUE = 'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))';

const SELECTION_VERROUILLEE = `SELECT data, deleted FROM platform_records
  WHERE store_name=$1 AND record_id=$2 FOR UPDATE`;

const ECRITURE = `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
  VALUES($1,$2,$3::jsonb,FALSE,NOW())
  ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=FALSE,updated_at=NOW()`;

const PIERRE_TOMBALE = `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
  VALUES($1,$2,$3::jsonb,TRUE,NOW())
  ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=TRUE,updated_at=NOW()`;

const refus = (code, currentRevision) => ({ ok: false, code, currentRevision });

/**
 * Exécuter un acte sous verrou de ligne, dans une transaction.
 *
 * `client` permet à un appelant qui tient DÉJÀ une transaction de s'y greffer — la
 * création d'une salle écrit l'enregistrement et son rattachement de zone ensemble, et
 * les scinder rouvrirait la fenêtre qu'on vient de fermer.
 */
async function sousVerrou(pool, storeName, recordId, acte, client = null) {
  const propre = client || await pool.connect();
  const transactionLocale = !client;
  try {
    if (transactionLocale) await propre.query('BEGIN');
    // D'ABORD la clé logique — elle protège aussi la ligne qui n'existe pas encore —
    // ENSUITE la ligne, dont le verrou reste utile face à tout écrivain hors de ce module.
    await propre.query(VERROU_CLE_LOGIQUE, [String(storeName), String(recordId)]);
    const verrouille = await propre.query(SELECTION_VERROUILLEE, [storeName, String(recordId)]);
    const ligne = verrouille.rows[0] || null;
    const resultat = await acte(propre, ligne);
    if (transactionLocale) await propre.query('COMMIT');
    return resultat;
  } catch (error) {
    if (transactionLocale) await propre.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (transactionLocale) propre.release();
  }
}

/**
 * ÉCRIRE SI, ET SEULEMENT SI, LA VERSION DÉCLARÉE EST TOUJOURS LA VERSION COURANTE.
 *
 * Quatre états possibles de la ligne, et une règle par état :
 *
 *   absente            une création. La révision déclarée doit être 0 ; sinon la fiche a
 *                      été supprimée sous les pieds de celui qui écrit.
 *   pierre tombale     supprimée par quelqu'un d'autre. Une recréation DÉLIBÉRÉE (révision
 *                      déclarée 0) reste possible et repart au-dessus de l'ancienne
 *                      révision ; un enregistrement périmé est refusé.
 *   vivante, à jour    on écrit, et la révision avance de un.
 *   vivante, dépassée  on refuse, en rendant la révision courante.
 *
 * `force` court-circuite la comparaison — restauration d'archive, import, remplacement
 * d'inventaire : des décisions explicites sur un ensemble entier, pas la modification
 * d'une fiche ouverte. La révision avance quand même, sinon les sessions ouvertes ne
 * verraient pas qu'elles ont été dépassées.
 */
export async function compareAndWrite(pool, {
  storeName, recordId, record, expectedRevision = 0, force = false, client = null, intent = 'update'
} = {}) {
  // Un magasin hors contrat s'écrit comme avant, sans estampille ni comparaison : un
  // journal est un fait nouveau, pas la modification d'un fait ancien.
  if (!storeUsesRevision(storeName)) {
    const cible = client || pool;
    await cible.query(ECRITURE, [storeName, String(recordId), JSON.stringify(record)]);
    return { ok: true, revision: 0 };
  }

  return sousVerrou(pool, storeName, recordId, async (propre, ligne) => {
    const courante = ligne ? revisionOf(ligne.data) : 0;
    const declaree = Number(expectedRevision) || 0;

    if (!force) {
      if (!ligne) {
        // Rien en base : c'est une création. Déclarer une révision, c'est prétendre
        // modifier ce qui n'existe plus.
        if (declaree !== 0) return refus(REVISION_ERRORS.DELETED_ELSEWHERE, 0);
      } else if (ligne.deleted) {
        if (declaree !== 0) return refus(REVISION_ERRORS.DELETED_ELSEWHERE, courante);
      } else if (declaree !== courante) {
        // Un enregistrement HÉRITÉ porte la révision 0 : déclarer 0 concorde alors, et la
        // première écriture le fait passer à 1. C'est la migration, et elle n'exige aucun
        // remplissage préalable.
        //
        // Déclarer 0 sur une ligne qui porte déjà une révision, en revanche, veut dire
        // qu'on croyait créer. Si l'appelant sait qu'il créait, on le nomme ainsi ; sinon
        // la vérité visible est la même que pour toute divergence — quelqu'un d'autre a
        // touché cette donnée depuis la lecture.
        const creationConcurrente = declaree === 0 && intent === 'create';
        return refus(creationConcurrente ? REVISION_ERRORS.ALREADY_EXISTS : REVISION_ERRORS.STALE_WRITE, courante);
      }
    }

    const suivante = courante + 1;
    // La révision est posée ICI. La croire depuis la charge utile suffirait à n'être
    // jamais refusé : il suffirait d'envoyer un grand nombre.
    await propre.query(ECRITURE, [storeName, String(recordId), JSON.stringify(withRevision(record, suivante))]);
    return { ok: true, revision: suivante };
  }, client);
}

/**
 * SUPPRIMER SI LA VERSION DÉCLARÉE EST TOUJOURS LA VERSION COURANTE.
 *
 * La pierre tombale CONSERVE la révision, augmentée de un. Sans cela, une fiche supprimée
 * puis recréée repartirait de 1, et une session restée ouverte sur l'ancienne révision 1
 * pourrait l'écraser — la suppression n'aurait servi qu'à effacer la mémoire du conflit.
 *
 * Sans `expectedRevision`, la suppression est délibérée et ne se compare à rien : c'est le
 * cas d'un administrateur qui supprime depuis une liste, sans avoir ouvert la fiche.
 */
export async function tombstoneWithRevision(pool, { storeName, recordId, expectedRevision = null, client = null } = {}) {
  return sousVerrou(pool, storeName, recordId, async (propre, ligne) => {
    const courante = ligne ? revisionOf(ligne.data) : 0;
    if (expectedRevision !== null && storeUsesRevision(storeName)) {
      const declaree = Number(expectedRevision) || 0;
      if (declaree !== courante) return refus(REVISION_ERRORS.STALE_WRITE, courante);
    }
    const suivante = courante + 1;
    await propre.query(PIERRE_TOMBALE, [storeName, String(recordId),
      JSON.stringify(storeUsesRevision(storeName) ? withRevision({}, suivante) : {})]);
    return { ok: true, revision: suivante };
  }, client);
}

/*
 * L'expression qui fait avancer le compteur DANS le SQL.
 *
 * `_revision` n'est écrit que par ce module, donc toujours entier ; la garde par expression
 * régulière est là pour qu'une donnée héritée ou abîmée reparte de 0 au lieu de faire
 * échouer toute l'instruction sur une conversion.
 */
const SUIVANTE_SQL = `(CASE WHEN data->>'${REVISION_FIELD}' ~ '^[0-9]+$'
  THEN (data->>'${REVISION_FIELD}')::bigint ELSE 0 END) + 1`;

const PIERRES_TOMBALES_EN_MASSE = `UPDATE platform_records
  SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{${REVISION_FIELD}}', to_jsonb(${SUIVANTE_SQL})),
      deleted = TRUE, updated_at = NOW()
  WHERE store_name = $1 AND deleted = FALSE
    AND ($2::text[] IS NULL OR record_id = ANY($2::text[]))`;

const PIERRES_TOMBALES_BRUTES = `UPDATE platform_records
  SET deleted = TRUE, updated_at = NOW()
  WHERE store_name = $1 AND deleted = FALSE
    AND ($2::text[] IS NULL OR record_id = ANY($2::text[]))`;

/**
 * POSER UNE PIERRE TOMBALE SUR TOUT UN ENSEMBLE, EN UNE SEULE INSTRUCTION.
 *
 * Le remplacement d'inventaire retire des centaines de fiches d'un coup, et le ménage des
 * comptes en double en retire plusieurs. Les traiter une par une multiplierait par trois le
 * nombre d'allers-retours sans rien gagner : ici il n'y a pas de lecture préalable à
 * protéger, puisque la nouvelle révision se calcule DANS la même instruction que
 * l'écriture. Il n'existe donc aucune fenêtre entre lire et écrire.
 *
 * Le reste de `data` est CONSERVÉ. Cette fonction remplace des `UPDATE … SET deleted=TRUE`
 * qui le conservaient déjà ; ne changer qu'une chose à la fois est la seule façon de savoir
 * ce qui casse si quelque chose casse.
 *
 * `recordIds` à `null` vaut « toutes les fiches vivantes de ce magasin ».
 */
export async function tombstoneManyWithRevision(pool, { storeName, recordIds = null, client = null } = {}) {
  const cible = client || pool;
  const identifiants = recordIds === null ? null : [...new Set(recordIds.map(String))];
  if (identifiants && identifiants.length === 0) return { ok: true, count: 0 };
  const requete = storeUsesRevision(storeName) ? PIERRES_TOMBALES_EN_MASSE : PIERRES_TOMBALES_BRUTES;
  const resultat = await cible.query(requete, [storeName, identifiants]);
  return { ok: true, count: resultat.rowCount ?? 0 };
}

/*
 * LA SALLE DES ÉQUIPEMENTS D'UNE BAIE QUI VIENT DE DÉMÉNAGER.
 *
 * La chaîne physique canonique est `Équipement → Baie → Salle`. Déplacer une baie changeait
 * donc la salle de tous ses équipements — sans qu'aucune écriture d'équipement ait lieu.
 * Aucune règle serveur ne couvrait ce cas : `assertEquipmentLocationExists` ne voit que les
 * écritures d'équipement, et le client réalignait après coup, fiche par fiche, hors
 * transaction. Une panne au milieu laissait la baie déménagée et une partie de ses
 * équipements dans l'ancienne salle.
 *
 * Le réalignement se fait ici, DANS la transaction qui écrit la baie, et en une seule
 * requête : soit la baie bouge avec tous ses équipements, soit rien ne bouge.
 *
 * DEUX PRÉCAUTIONS QUI NE SONT PAS DES DÉTAILS
 * --------------------------------------------
 *   · la révision AVANCE, comme pour n'importe quelle écriture. Sans cela, une session
 *     restée ouverte sur l'ancienne version réécrirait la salle périmée sans être refusée,
 *     et Batch C ne verrait pas passer le changement — l'écran garderait l'ancienne salle.
 *   · une baie SANS salle ne réaligne rien. Une relation incomplète ne se devine pas :
 *     inventer un rattachement serait fabriquer une vérité que personne n'a écrite.
 */
const REALIGNEMENT_SALLE = `UPDATE platform_records
     SET data = jsonb_set(
           jsonb_set(data, '{roomId}', $2::jsonb, TRUE),
           '{${REVISION_FIELD}}',
           to_jsonb(COALESCE((data->>'${REVISION_FIELD}')::int, 0) + 1),
           TRUE),
         updated_at = NOW()
   WHERE store_name = 'equipments'
     AND deleted = FALSE
     AND data->>'baieId' = $1
     AND COALESCE(data->>'roomId', '') IS DISTINCT FROM COALESCE($3, '')
  RETURNING record_id`;

export async function realignEquipmentRoomsForBaie(client, { baieId, roomId } = {}) {
  if (!client || baieId === null || baieId === undefined || baieId === '') return { ok: true, count: 0, ids: [] };
  // Une baie sans salle laisse ses équipements tels quels : rien à dériver, donc rien à écrire.
  if (roomId === null || roomId === undefined || roomId === '') return { ok: true, count: 0, ids: [] };

  const resultat = await client.query(REALIGNEMENT_SALLE, [
    String(baieId), JSON.stringify(roomId), String(roomId)
  ]);
  return { ok: true, count: resultat.rowCount ?? 0, ids: resultat.rows.map(ligne => String(ligne.record_id)) };
}

/** La révision courante d'un enregistrement, sans verrou — pour informer, jamais pour décider. */
export async function currentRevision(pool, storeName, recordId) {
  const resultat = await pool.query(
    'SELECT data FROM platform_records WHERE store_name=$1 AND record_id=$2 LIMIT 1',
    [storeName, String(recordId)]
  );
  return revisionOf(resultat.rows[0]?.data);
}
