/**
 * @file scripts/grille-centrale-operational-bootstrap.js
 *       LA FICHE OPÉRATIONNELLE CANONIQUE DE LA GRILLE CENTRALE, POSÉE UNE FOIS (#166).
 *
 * CE QUE CE MODULE FERME
 * -----------------------
 * `canReadGrilleCentraleDataset` résout l'ÉQUIPEMENT de la Grille dans les fiches centrales,
 * puis pose au moteur d'accès la question ordinaire. Aucun producteur ne créait cet
 * équipement : le jeu de données protégé se refusait donc à TOUT LE MONDE, administrateur
 * compris, et les quatre panneaux de la fiche 360 n'étaient pas exécutables.
 *
 * POURQUOI ICI, ET PAS DANS UN MODULE RACINE
 * -------------------------------------------
 * Le nom de l'appareil, sa baie et son constructeur sont de la donnée d'installation : #137
 * les a retirés du bundle public, et `scripts/public-bundle-residue-guard.mjs` les y refuse.
 * Un ensemencement CLIENT — la forme qu'emploie `regie-car-inventory-phase16.js` — les
 * réintroduirait dans un actif téléchargeable sans session. Ce bootstrap est donc SERVEUR :
 * il lit `scripts/private-operational-data/grille-centrale.js`, qui n'est joignable par
 * aucune requête HTTP, et écrit dans `platform_records`. Le navigateur ne reçoit ces fiches
 * que par `/api/sync`, donc après `canAccessRecord`.
 *
 * Effet de bord voulu : CONSULTER NE PEUT PLUS CRÉER. Aucun code client ne compose cet
 * équipement, donc aucune ouverture de fiche 360 ne peut le faire naître (#166 §9, famille
 * #108/#165).
 *
 * IL CRÉE, IL NE CORRIGE PAS
 * ---------------------------
 * L'écriture est ADDITIVE et conditionnelle : une fiche déjà présente n'est jamais
 * réécrite, jamais datée, jamais fusionnée. Deux raisons, et la seconde est la plus
 * importante :
 *
 *   · un bootstrap qui réécrit à chaque démarrage fait monter les révisions sans geste
 *     utilisateur — c'est exactement le défaut mesuré en #98/#164 ;
 *   · si un jour l'inventaire réel apporte la vraie fiche de l'appareil, c'est ELLE qui
 *     doit rester. Ce module s'efface alors de lui-même.
 *
 * ET IL NE RESSUSCITE RIEN — IL S'EXÉCUTE UNE FOIS, PAS À CHAQUE ABSENCE
 * ----------------------------------------------------------------------
 * « Créer quand c'est absent » et « créer une fois » ne sont pas la même règle, et l'écart
 * se voit dès qu'une autorité efface. `inventory-master.js` remplace les données
 * opérationnelles — `OPERATIONAL_RESET_STORES` contient `rooms`, `baies`, `equipments` :
 * l'opérateur DÉCLARE alors que son inventaire réel est la vérité. Mesuré en intégration :
 *
 *     scripts/inventory-replace-e2e.mjs installe 397 équipements, 1 salle, 1 baie ;
 *     le serveur redémarre, le bootstrap ne trouve plus de Grille et la recrée
 *       → 398 équipements, 2 salles, 2 baies.
 *
 * Réinjecter une fiche que l'opérateur vient de retirer, c'est la recréation spéculative
 * que #164/#165 ont fermée ailleurs — l'autorité efface, le producteur réécrit. Une trace
 * durable (`docs/gc-operational-bootstrap`) dit donc que ce bootstrap a DÉJÀ tranché. Elle
 * ne porte aucune donnée d'installation, et son `kind` ne fait pas partie des documents
 * opérationnels qu'un remplacement retire : elle survit précisément à ce qu'elle doit
 * survivre.
 *
 * Conséquence voulue, au-delà du remplacement : une suppression DÉLIBÉRÉE de la fiche
 * canonique n'est plus défaite au redémarrage suivant. Sans équipement résoluble, le jeu de
 * données protégé se referme — ce qui est le comportement correct, et non une panne.
 *
 * ET SURTOUT, IL NE CRÉE PAS DE DOUBLON
 * --------------------------------------
 * `resolveGrilleCentraleEquipment` refuse quand DEUX fiches peuvent être la Grille : deux
 * candidats, c'est deux zones possibles, donc une décision indécidable. Poser une fiche de
 * plus à côté d'une fiche existante FERMERAIT donc le jeu de données au lieu de l'ouvrir.
 * La garde ci-dessous reproduit la résolution du serveur — lien catalogue d'abord, alias de
 * nom ensuite — et s'abstient dès qu'un candidat existe déjà, quel qu'il soit.
 */
import { buildGrilleCentraleOperationalSeed } from './private-operational-data/grille-centrale.js';
import { resolveGrilleCentraleCandidate, GRILLE_CENTRALE_CATALOG_ID } from './grille-centrale-identity.js';

/** La trace durable : ce bootstrap a déjà tranché, une fois pour toutes. */
export const BOOTSTRAP_MARKER_ID = 'gc-operational-bootstrap';

/** Une fiche verrouillée par un administrateur n'est jamais retouchée, même pour l'identité. */
function adminVerrouille(record) {
  const origine = String(record?.origin || '').toLowerCase();
  return origine.startsWith('admin') || record?.locked === true || record?.adminLocked === true;
}

/**
 * Pose la salle, la baie puis l'équipement — dans cet ordre, et seulement s'ils manquent.
 *
 * L'ORDRE N'EST PAS COSMÉTIQUE : `assertEquipmentLocationExists` refuse un équipement dont
 * la baie ou la salle n'existe pas encore (`400 INVALID_EQUIPMENT_LOCATION`). C'est la même
 * leçon que #162.
 *
 * @param {object} access l'objet rendu par `createAccessControl(pool)`.
 * @returns {Promise<object>} un compte rendu, sans effet de bord si tout est déjà en place.
 */
export async function ensureGrilleCentraleOperationalRecords(access) {
  if (!access) return { skipped: 'no-access-control', created: 0 };

  const seed = buildGrilleCentraleOperationalSeed();
  const equipments = await access.list('equipments');
  const resolution = resolveGrilleCentraleCandidate(equipments);
  const now = new Date().toISOString();

  const marquer = async decision => access.put('docs', BOOTSTRAP_MARKER_ID, {
    id: BOOTSTRAP_MARKER_ID,
    kind: 'platform_bootstrap_marker',
    targetType: 'platform_bootstrap',
    targetId: BOOTSTRAP_MARKER_ID,
    // Aucune donnée d'installation ici : ce document dit QUE le bootstrap a eu lieu,
    // jamais ce qu'il a posé.
    bootstrap: 'grille-centrale-operational',
    decision,
    version: seed.version,
    appliedAt: now,
    createdAt: now,
    updatedAt: now
  });

  /*
   * DEUX CANDIDATS, OU AUCUNE IDENTITÉ DÉCIDABLE : ON NE TOUCHE À RIEN.
   *
   * Et on ne marque PAS. Marquer ici figerait une situation que l'opérateur peut encore
   * corriger — retirer le doublon, par exemple — alors que le marqueur n'existe que pour
   * empêcher une RÉSURRECTION, pas pour clore une ambiguïté.
   */
  if (resolution.reason === 'ambiguous-catalog-id' || resolution.reason === 'ambiguous-name-alias') {
    return { skipped: resolution.reason, candidates: resolution.candidates, created: 0, linked: false, version: seed.version };
  }

  /*
   * UNE FICHE PORTE LE LIBELLÉ DE LA GRILLE MAIS REVENDIQUE UN AUTRE CATALOGUE.
   *
   * Le resolver l'écarte désormais avant d'en faire un candidat (#166 — la préséance est
   * dans `grille-centrale-identity.js`). Il reste à ne pas CRÉER une fiche canonique à côté
   * d'elle : l'opérateur se retrouverait avec deux appareils là où il n'en a qu'un, et le
   * doublon rendrait ensuite la résolution ambiguë. On ferme, sans marqueur — rien n'est
   * figé, la réparation explicite reste possible à tout moment.
   */
  if (resolution.reason === 'catalog-conflict') {
    console.warn(`Grille Centrale — conflit d'identité : ${(resolution.equipmentIds || []).join(', ')} revendique(nt) ${(resolution.conflictingCatalogIds || []).join(', ')}. Aucun lien posé, aucune fiche créée.`);
    return {
      skipped: 'catalog-conflict',
      conflictingCatalogId: (resolution.conflictingCatalogIds || [])[0],
      equipmentId: (resolution.equipmentIds || [])[0],
      candidates: resolution.candidates,
      created: 0, linked: false, version: seed.version
    };
  }

  /*
   * LE LIEN CANONIQUE — CE QUE #166 APPELLE « rattacher une fiche réelle au catalogue ».
   *
   * Une fiche opérationnelle RÉELLE, reconnue par un libellé documenté mais sans lien de
   * catalogue, était résolue par le serveur et ignorée par la fiche 360 : les écrans publics
   * ne reconnaissent qu'`catalogId` ou l'alias court, et c'est VOLONTAIRE — leur donner les
   * libellés longs remettrait la capacité de la matrice dans un actif servi (#137). Mesuré
   * sur 3d777df, fiche « GRILLE CENTRALE 190x184 » sans `catalogId` :
   *
   *     serveur   name-alias, autorisation possible
   *     Fiche 360 Topologie / Architecture / Plan / Field Verification → false
   *
   * On complète donc l'IDENTITÉ de cette fiche, et rien d'autre : `catalogId` reçoit la clé
   * canonique — un identifiant machine déjà public, sur lequel les écrans savent déjà
   * s'appuyer. Son id, sa salle, sa baie, sa zone, son numéro de série, son modèle, son
   * constructeur et tous ses champs restent tels quels.
   *
   * CE N'EST PAS UNE OPÉRATION NOUVELLE. `inventory-master.js` la pratique déjà à l'import
   * (`catalogId: record.catalogId || catalog?.id`), et `grille-centrale-knowledge.js` fait
   * exactement ce lien (`equipment.catalogId || CATALOG_ID`) sur les fiches qu'il reconnaît.
   * La règle du `||` y est la même qu'ici : on complète ce qui manque, on n'écrase jamais.
   *
   * Le lien s'éteint de lui-même : une fois posé, la résolution passe par `catalog-id` et ce
   * bloc n'est plus atteint. Il ne dépend donc pas du marqueur — le compléter n'est pas
   * ressusciter, c'est finir d'identifier ce que l'opérateur a lui-même fourni.
   */
  if (resolution.reason === 'name-alias') {
    const fiche = resolution.equipment;
    const catalogueActuel = String(fiche?.catalogId || '').trim();

    if (catalogueActuel && catalogueActuel !== GRILLE_CENTRALE_CATALOG_ID) {
      // Une AUTRE identité de catalogue est déjà affirmée sur cette fiche. La remplacer
      // serait décider à la place de l'opérateur : on ferme et on le dit.
      //
      // Le resolver écarte maintenant ces fiches en amont : `name-alias` ne peut plus en
      // porter une. Ce verrou reste posé quand même — c'est la même porte, fermée deux
      // fois, sur un chemin qui décide d'une autorisation.
      console.warn(`Grille Centrale — conflit d'identité sur « ${fiche.id} » : catalogId=${catalogueActuel}. Aucun lien posé.`);
      return { skipped: 'catalog-conflict', conflictingCatalogId: catalogueActuel, equipmentId: fiche.id, created: 0, linked: false, version: seed.version };
    }

    if (adminVerrouille(fiche)) {
      return { skipped: 'admin-locked', equipmentId: fiche.id, created: 0, linked: false, version: seed.version };
    }

    if (!catalogueActuel) {
      await access.put('equipments', fiche.id, { ...fiche, catalogId: GRILLE_CENTRALE_CATALOG_ID, updatedAt: now });
      await marquer('linked');
      return { skipped: 'name-alias', linked: true, equipmentId: fiche.id, created: 0, version: seed.version };
    }
  }

  // Déjà canonique : rien à faire, et c'est un état d'arrivée stable.
  if (resolution.reason === 'catalog-id') {
    const trace = await access.get('docs', BOOTSTRAP_MARKER_ID).catch(() => null);
    if (!trace) await marquer('catalog-id');
    return { skipped: 'catalog-id', linked: false, created: 0, equipmentId: resolution.equipment.id, version: seed.version };
  }

  /*
   * AUCUN CANDIDAT — c'est ICI, et seulement ici, que le marqueur décide.
   *
   * Créer quand il n'y a rien est légitime au premier démarrage ; le refaire après qu'une
   * autorité a effacé serait une résurrection. Le marqueur sépare les deux.
   */
  const trace = await access.get('docs', BOOTSTRAP_MARKER_ID).catch(() => null);
  if (trace) return { skipped: 'already-bootstrapped', created: 0, linked: false, version: seed.version };

  const cree = [];

  const rooms = await access.list('rooms');
  if (!rooms.some(room => String(room?.id) === seed.room.id)) {
    await access.put('rooms', seed.room.id, { ...seed.room, createdAt: now, updatedAt: now });
    cree.push('rooms');
  }

  const baies = await access.list('baies');
  if (!baies.some(baie => String(baie?.id) === seed.baie.id)) {
    await access.put('baies', seed.baie.id, { ...seed.baie, createdAt: now, updatedAt: now });
    cree.push('baies');
  }

  await access.put('equipments', seed.equipment.id, { ...seed.equipment, createdAt: now, updatedAt: now });
  cree.push('equipments');

  await marquer('created');
  return { created: cree.length, stores: cree, linked: false, equipmentId: seed.equipment.id, version: seed.version };
}
