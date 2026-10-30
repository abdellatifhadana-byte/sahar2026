/**
 * @file record-ownership-contract.js — à qui appartient un enregistrement.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME (BLOCK-C-LOCAL-CHURN-01)
 * -------------------------------------------------------
 * `applySnapshot` vide chaque magasin autoritaire avant de le remplir. Le serveur déclare
 * autoritaires les VINGT magasins, `settings` et `docs` compris. Or ces deux-là contiennent
 * des fiches que le serveur n'a jamais eues et ne peut donc pas renvoyer. Elles étaient
 * détruites à chaque cycle, c'est-à-dire toutes les vingt secondes.
 *
 * Mesuré sur un serveur réel (`scripts/churn-instrumentation.mjs`) :
 *
 *   settings/current-room     détruite par le vidage, RECRÉÉE par `applySnapshot` lui-même
 *                             à la fin du même passage → un faux « supprimé » par cycle,
 *                             indéfiniment. C'est la boucle qui ne s'arrêtait jamais.
 *   settings/map-image-cache  détruite, JAMAIS recréée. Les octets du plan étaient
 *                             réellement perdus, puis retéléchargés. Perte de donnée, pas
 *                             seulement du bruit.
 *   docs/gc-*, docs/kb-*      détruites. Onze modules de réconciliation écoutent
 *                             `central-sync-status: synced` et les ré-ensemencent aussitôt
 *                             — d'où les ~450 entités qui revenaient à chaque cycle.
 *   une fiche centrale réelle intacte, aucun événement. La machinerie de différence n'a
 *                             jamais été en cause : c'est le modèle de propriété qui manquait.
 *
 * On ne corrige donc PAS en filtrant les événements. Masquer l'annonce laisserait la
 * destruction en place, et la perte deviendrait silencieuse — un remède pire que le mal.
 *
 * TROIS PROPRIÉTAIRES, ET RIEN D'AUTRE
 * ------------------------------------
 *   SERVER            La fiche centrale ordinaire. L'instantané peut la modifier et la
 *                     supprimer, et une disparition autorisée — suppression réelle ou
 *                     révocation de zone — doit continuer de produire son annonce.
 *
 *   STRICT_LOCAL      Elle n'existe que sur ce poste et n'a jamais eu de contrepartie
 *                     centrale. Le vidage autoritaire ne la touche pas, et son absence de
 *                     l'instantané n'est pas une suppression : c'est sa nature.
 *
 *   CATALOG_BUFFERED  Un ensemencement automatique retenu par `catalog-seed-guard` en
 *                     attendant son installation centrale. Sa propriété est TRANSITOIRE :
 *                     elle dure tant que le centre ne connaît pas la fiche, et cesse à
 *                     l'instant précis où l'instantané la porte. Le serveur reprend alors
 *                     l'autorité, et il n'existe jamais deux sources durables pour la même
 *                     donnée.
 *
 * `db.saveLocalOnly` NE DÉCIDE DE RIEN
 * ------------------------------------
 * Elle contourne le réseau, ce qui n'est pas une déclaration de propriété : le même appel
 * sert à écrire une fiche centrale sans la republier. Traiter tout `saveLocalOnly` comme
 * une donnée locale permanente figerait des fiches que le serveur doit pouvoir corriger.
 * La propriété se DÉCLARE ici, explicitement, fiche par fiche.
 */

export const OWNERSHIP = Object.freeze({
  SERVER: 'server',
  STRICT_LOCAL: 'strict-local',
  CATALOG_BUFFERED: 'catalog-buffered'
});

/**
 * Les préférences de poste. Elles ne partent jamais vers le serveur et ne reviennent jamais
 * de lui.
 *   · `current-room`     la salle que ce poste regarde ;
 *   · `map-image-cache`  les octets du plan, téléchargés une fois. Les remettre dans le flux
 *     les ferait retransmettre toutes les vingt secondes à chaque poste.
 */
export const STRICT_LOCAL_SETTINGS = Object.freeze(['current-room', 'map-image-cache']);
const STRICT_LOCAL = new Set(STRICT_LOCAL_SETTINGS);

/** Les magasins susceptibles de contenir autre chose que des fiches du serveur. */
const MAGASINS_MIXTES = new Set(['settings', 'docs']);

/*
 * LE REGISTRE TRANSITOIRE DES ENSEMENCEMENTS.
 *
 * `catalog-seed-guard` y inscrit chaque fiche qu'il retient. `central-sync` en retire
 * chaque fiche que l'instantané porte désormais : c'est la CESSION D'AUTORITÉ, et elle est
 * automatique. Une fiche ne peut donc pas rester protégée pour toujours par oubli.
 */
const ensemencementsRetenus = new Set();

const identifiant = valeur => {
  const brut = typeof valeur === 'object' && valeur !== null ? valeur.id : valeur;
  return brut === undefined || brut === null ? '' : String(brut);
};

/** Le garde du catalogue déclare qu'il retient cette fiche en attendant l'installation. */
export function declareCatalogBuffered(id) {
  const cle = identifiant(id);
  if (cle) ensemencementsRetenus.add(cle);
}

/**
 * Le centre connaît désormais cette fiche : la phase transitoire est terminée, et
 * l'autorité passe au serveur. Rendre `true` quand une protection a effectivement cessé.
 */
export function releaseCatalogBuffered(id) {
  return ensemencementsRetenus.delete(identifiant(id));
}

/** Les fiches encore retenues. Lecture seule : personne d'autre ne modifie ce registre. */
export function catalogBufferedIds() {
  return [...ensemencementsRetenus];
}

/** Vider le registre. Réservé aux épreuves : chacune doit partir d'un état connu. */
export function resetCatalogBuffer() {
  ensemencementsRetenus.clear();
}

/** À qui appartient cette fiche ? */
export function recordOwnership(storeName, recordOrId) {
  const id = identifiant(recordOrId);
  if (!id) return OWNERSHIP.SERVER;
  if (storeName === 'settings' && STRICT_LOCAL.has(id)) return OWNERSHIP.STRICT_LOCAL;
  if (storeName === 'docs' && ensemencementsRetenus.has(id)) return OWNERSHIP.CATALOG_BUFFERED;
  return OWNERSHIP.SERVER;
}

/**
 * Cette fiche survit-elle au vidage autoritaire ?
 *
 * C'est la SEULE question que pose `applySnapshot`, et elle a une seule réponse : une fiche
 * que le serveur ne possède pas ne peut pas être effacée en son nom.
 */
export function survivesAuthoritativeClear(storeName, recordOrId) {
  return recordOwnership(storeName, recordOrId) !== OWNERSHIP.SERVER;
}

/**
 * Ce magasin peut-il contenir autre chose que des fiches du serveur ?
 *
 * Là où la réponse est non — dix-huit magasins sur vingt — le vidage reste un `clear()`
 * unique, qui est à la fois plus rapide et plus simple qu'une suite de suppressions.
 */
export function storeMayHoldLocalRecords(storeName) {
  return MAGASINS_MIXTES.has(storeName);
}

/**
 * Une fiche strictement locale ne doit jamais entrer dans un instantané, ni en sortir.
 *
 * Ce prédicat remplace l'ancien `isLocalOnlyRecord` de `central-sync.js`, qui portait la
 * même liste en double. Deux copies de la même règle finissent toujours par diverger, et
 * c'est déjà ce qui commençait : le commentaire promettait une protection que le vidage
 * autoritaire annulait trois lignes plus bas.
 */
export function isStrictLocalRecord(storeName, recordOrId) {
  return recordOwnership(storeName, recordOrId) === OWNERSHIP.STRICT_LOCAL;
}
