/**
 * @file scripts/grille-centrale-identity.js
 *       QU'EST-CE QUI PEUT ÊTRE LA GRILLE CENTRALE ? UNE SEULE RÉPONSE (#166).
 *
 * CE QUE CE MODULE FERME
 * -----------------------
 * Deux endroits décidaient de la même chose, avec deux règles différentes :
 *
 *   `scripts/access-control.js`                       new Set(['grille centrale'])
 *   `scripts/grille-centrale-operational-bootstrap.js` les 5 alias documentés
 *
 * Le bootstrap reconnaissait donc des fiches que le serveur, lui, ne reconnaissait pas.
 * Mesuré sur `2e8d32c`, avec une fiche opérationnelle réelle nommée « GRILLE CENTRALE
 * 190x184 » — un libellé que le jeu de données déclare LUI-MÊME légitime — sans lien de
 * catalogue et sans fiche canonique :
 *
 *     bootstrap        skipped=name-alias · 0 créé · marqueur écrit
 *     serveur          reason=not-found   · endpoint 403
 *     2e démarrage     skipped=already-bootstrapped · 0 créé
 *     → 403 PERMANENT, sans récupération automatique.
 *
 * Trois des cinq alias documentés produisaient cette impasse : « GRILLE CENTRALE 190x184 »,
 * « Grille Centrale 190 x 184 », « GRILLE CENTRALE 190×184 ». Le refus était « fail-closed »
 * en apparence, mais il était surtout DÉFINITIF : le marqueur du bootstrap gelait une
 * situation que le serveur jugeait insoluble.
 *
 * LA RÈGLE EST ÉCRITE UNE FOIS, ET LES DEUX CÔTÉS LA LISENT
 * ----------------------------------------------------------
 * Rien n'est élargi ici. La règle reste exactement celle que `resolveGrilleCentraleEquipment`
 * appliquait déjà — lien de catalogue d'abord, alias de nom ensuite, refus dès qu'il y a deux
 * candidats — mais elle n'existe plus qu'à un seul endroit, avec le jeu d'alias que le
 * dossier documente.
 *
 * POURQUOI CE MODULE EST PRIVÉ, ET POURQUOI LES ÉCRANS N'EN DÉPENDENT PAS
 * -----------------------------------------------------------------------
 * Trois des cinq alias portent la CAPACITÉ de la matrice (190×184), que #137 a précisément
 * retirée du bundle public et que `scripts/public-bundle-residue-guard.mjs` y refuse. Ce
 * module vit donc sous `scripts/`, que `serve.js` ne sert pas, et n'est consommé que par du
 * code serveur : la décision d'autorisation et le bootstrap.
 *
 * Les écrans (`grille-centrale-*.js`) gardent délibérément leur forme publique et étroite —
 * lien de catalogue, plus le seul alias court. Ce n'est pas un oubli : leur donner les alias
 * longs réintroduirait la capacité dans un actif téléchargeable sans session. Ils décident
 * de ce qu'ils AFFICHENT ; ils ne décident pas de ce qui est autorisé.
 */
import {
  GRILLE_CENTRALE_ALIASES,
  GRILLE_CENTRALE_CATALOG_ID
} from './private-operational-data/grille-centrale.js';
import {
  matchesPublicGrilleIdentity,
  declaresForeignCatalogIdentity
} from '../grille-centrale-public-identity.js';

export { GRILLE_CENTRALE_CATALOG_ID };

/**
 * La normalisation d'un libellé d'inventaire : accents retirés, casse et ponctuation
 * neutralisées. C'est elle qui rapproche « GRILLE CENTRALE 190×184 » et
 * « Grille Centrale 190 x 184 » — pas une correspondance approximative.
 */
export const normalizeGrilleIdentity = value => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Les libellés documentés, normalisés une fois. */
export const GRILLE_CENTRALE_IDENTITY_ALIASES = Object.freeze(
  [...new Set(GRILLE_CENTRALE_ALIASES.map(normalizeGrilleIdentity).filter(Boolean))]
);

const ALIAS_SET = new Set(GRILLE_CENTRALE_IDENTITY_ALIASES);

/** Le lien canonique : une fiche reliée au modèle de la Grille. */
export const matchesGrilleCatalogId = equipment =>
  String(equipment?.catalogId || '').trim() === GRILLE_CENTRALE_CATALOG_ID;

/**
 * Un libellé documenté, et RIEN d'autre.
 *
 * Comparaison sur l'égalité du nom normalisé, jamais sur une inclusion : « armoire grille
 * centrale secours » ne doit pas être prise pour la Grille.
 */
export const matchesGrilleAlias = equipment =>
  ALIAS_SET.has(normalizeGrilleIdentity(equipment?.name ?? equipment?.nom ?? ''));

/**
 * Quelle fiche opérationnelle EST la Grille Centrale ?
 *
 * L'IDENTIFICATION DOIT ÊTRE CERTAINE, SINON ON FERME. Deux candidats, c'est deux zones
 * possibles, donc une décision indécidable : on refuse. Zéro candidat, c'est un périmètre
 * inconnu : on refuse aussi. Cette règle n'est pas assouplie ici — elle est simplement
 * énoncée à un seul endroit.
 *
 * @param {object[]} equipments toutes les fiches d'équipement.
 * @returns {{equipment: object|null, reason: string, candidates?: number}}
 */
export function resolveGrilleCentraleCandidate(equipments = []) {
  const parCatalogue = equipments.filter(matchesGrilleCatalogId);
  if (parCatalogue.length === 1) return { equipment: parCatalogue[0], reason: 'catalog-id' };
  if (parCatalogue.length > 1) return { equipment: null, reason: 'ambiguous-catalog-id', candidates: parCatalogue.length };

  /*
   * LE LIBELLÉ DOCUMENTÉ NE RENVERSE PAS UN LIEN DE CATALOGUE DÉJÀ DÉCLARÉ (#166).
   *
   * Mesuré sur `af4e14a`, fiche réelle `catalogId = kb-imagine-platinum-vx` — un modèle qui
   * EXISTE — nommée « GRILLE CENTRALE » : ce resolver répondait `name-alias`, l'autorisation
   * atteignait l'ACL, et les quatre panneaux affichaient le jeu de données protégé de la
   * Grille sur une fiche qui déclare appartenir à un autre appareil.
   *
   * Le repli d'alias sert aux fiches SANS identité de catalogue — celles saisies avant que la
   * clé existe. Une fiche qui en affirme une n'est pas candidate : sa propre déclaration
   * l'exclut. On ne l'efface pas pour autant ; on ferme, et on nomme la cause.
   */
  const parAlias = equipments.filter(matchesGrilleAlias);
  const enConflit = parAlias.filter(declaresForeignCatalogIdentity);
  const eligibles = parAlias.filter(fiche => !declaresForeignCatalogIdentity(fiche));

  if (eligibles.length === 1) return { equipment: eligibles[0], reason: 'name-alias' };
  if (eligibles.length > 1) {
    return { equipment: null, reason: 'ambiguous-name-alias', candidates: eligibles.length };
  }
  if (enConflit.length) {
    /*
     * Un état EXPLICABLE, pas une absence : l'opérateur doit savoir que la fiche qui porte le
     * libellé de la Grille en revendique un autre. `not-found` le lui cacherait — et
     * laisserait le bootstrap créer un doublon à côté d'elle.
     */
    return {
      equipment: null,
      reason: 'catalog-conflict',
      candidates: enConflit.length,
      conflictingCatalogIds: [...new Set(enConflit.map(fiche => String(fiche?.catalogId || '').trim()))],
      equipmentIds: enConflit.map(fiche => fiche?.id)
    };
  }
  return { equipment: null, reason: 'not-found', candidates: 0 };
}

/*
 * CE QUE LES ÉCRANS PUBLICS RECONNAISSENT — LA MÊME RÈGLE, LUE PAR LE SERVEUR (#166).
 *
 * L'AUTORISATION NE DOIT JAMAIS DÉPASSER LA RECONNAISSANCE.
 * ---------------------------------------------------------
 * Les écrans `grille-centrale-*.js` reconnaissent une fiche par le lien de catalogue, ou par
 * le seul alias COURT — volontairement, car les libellés longs portent la capacité de la
 * matrice et #137 les a retirés des actifs servis. Le serveur, lui, connaît tous les libellés
 * documentés. D'où un état que rien n'interdisait, mesuré sur 6d585ff avec une fiche réelle
 * « GRILLE CENTRALE 190x184 » protégée par un administrateur :
 *
 *     serveur    allowed=true, reason=equipment-scope
 *     écrans     Topologie / Architecture / Plan / Field Verification → false, 0 carte
 *
 * Le serveur disait « c'est la Grille », l'interface disait « ce n'est pas la Grille ». Ce
 * n'est pas seulement inutilisable : c'est une autorisation accordée pour une ressource que
 * le porteur de la session ne peut pas voir, donc une décision qui ne veut plus rien dire.
 *
 * LA RÈGLE, PLUTÔT QU'UN CAS PARTICULIER
 * ---------------------------------------
 * On aurait pu traiter le seul cas « verrouillé par un administrateur ». Ce serait rater la
 * forme du défaut : deux règles de reconnaissance qui divergent finissent toujours par se
 * contredire quelque part — c'est déjà ce que la revue précédente avait trouvé entre le
 * bootstrap et le resolver.
 *
 * Le prédicat ci-dessous EST celui des écrans, écrit une fois, et l'autorisation s'y adosse.
 * Une fiche que les écrans ne reconnaîtraient pas n'est pas une identité opérationnelle
 * ACHEVÉE : le jeu de données protégé se referme, avec une raison explicite, jusqu'à ce
 * qu'elle porte le lien canonique. Aucun alias sensible n'est publié pour autant — c'est le
 * serveur qui se restreint, pas l'écran qui s'élargit.
 */

/*
 * LA RÉPONSE VIENT DU CONTRAT PUBLIC, ELLE N'EST PAS RECOPIÉE ICI.
 *
 * Ce module avait sa propre liste de champs, alignée sur trois écrans sur quatre :
 * `grille-centrale-topology.js` lisait `inventorySource.name` sans `reference`, les trois
 * autres l'inverse. Mesuré sur `ca4fb12`, fiche réelle protégée par un administrateur :
 *
 *     reference = « GRILLE CENTRALE »            serveur autorise · Topologie ne rend pas
 *     inventorySource.name = « GRILLE CENTRALE » serveur refuse   · Topologie rend
 *
 * L'écart existait dans les deux sens. `grille-centrale-public-identity.js` porte désormais
 * la réponse, les quatre panneaux l'appellent, et le serveur l'appelle aussi : l'invariant
 * « si l'autorisation atteint l'ACL, les quatre panneaux reconnaissent » devient mécanique.
 */
export { GRILLE_CENTRALE_PUBLIC_ALIAS } from '../grille-centrale-public-identity.js';

/**
 * Cette fiche serait-elle reconnue par la fiche 360 ?
 *
 * C'est LA fonction des écrans, pas une copie : `matchesPublicGrilleIdentity`.
 */
export const estReconnuParLesEcransPublics = matchesPublicGrilleIdentity;
