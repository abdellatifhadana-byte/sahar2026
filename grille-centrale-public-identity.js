/**
 * @file grille-centrale-public-identity.js
 *       CE QUE L'INTERFACE APPELLE « LA GRILLE CENTRALE » — UNE SEULE DÉFINITION (#166).
 *
 * POURQUOI CE MODULE EXISTE
 * --------------------------
 * Quatre écrans décidaient séparément si une fiche d'équipement EST la Grille Centrale, et
 * ils ne décidaient pas la même chose. `grille-centrale-topology.js` lisait
 * `inventorySource.name` mais pas `reference` ; les trois autres lisaient `reference` mais
 * pas `inventorySource.name`. Le serveur, qui doit s'aligner sur eux pour ne pas autoriser
 * ce qu'ils n'afficheront pas, s'était aligné sur trois d'entre eux.
 *
 * Mesuré sur `ca4fb12`, avec une fiche opérationnelle réelle protégée par un administrateur :
 *
 *     reference = « GRILLE CENTRALE »
 *       serveur autorise · Architecture / Plan / Field rendent · Topologie NON
 *
 *     inventorySource.name = « GRILLE CENTRALE »
 *       serveur refuse · Topologie rend · les trois autres NON
 *
 * L'écart existait donc dans les deux sens. Ce n'est pas un cas particulier de plus : c'est
 * la même cause que les trois revues précédentes ont trouvée ailleurs — plusieurs copies
 * d'une même règle d'identité, qui finissent toujours par diverger. On enlève la cause.
 *
 * CE QUE CE MODULE PEUT CONTENIR, ET CE QU'IL NE CONTIENDRA JAMAIS
 * -----------------------------------------------------------------
 * Il est SERVI : n'importe qui peut le télécharger sans session. Il ne porte donc que de
 * l'identité non sensible — une clé machine et un libellé générique :
 *
 *   · `GRILLE_CENTRALE_CATALOG_ID`, la clé qui relie une fiche à son modèle. C'est un
 *     identifiant, pas un fait d'installation, et il était déjà public ;
 *   · l'alias COURT « grille centrale », déjà public lui aussi.
 *
 * Il ne contient AUCUN libellé portant la capacité de la matrice, aucune
 * implantation, aucun port, aucun câble, aucun constructeur, aucune preuve de site. Ces
 * données vivent sous `scripts/private-operational-data/`, que `serve.js` ne sert pas, et
 * `scripts/public-bundle-residue-guard.mjs` vérifie qu'elles n'en sortent pas.
 *
 * Le contrat PRIVÉ (`scripts/grille-centrale-identity.js`) continue de connaître l'ensemble
 * complet des libellés documentés : il en a besoin pour DÉCOUVRIR une fiche réelle et la
 * rattacher au catalogue. Il n'est jamais importé par du code navigateur ; c'est lui qui
 * importe celui-ci, et non l'inverse.
 */

/** La clé canonique. Un identifiant machine, déjà public, sur lequel tout s'appuie. */
export const GRILLE_CENTRALE_CATALOG_ID = 'kb-grille-centrale-190x184';

/** Le seul libellé d'inventaire que l'interface reconnaît. Générique, sans capacité. */
export const GRILLE_CENTRALE_PUBLIC_ALIAS = 'grille centrale';

/**
 * La normalisation d'un libellé : accents retirés, casse et ponctuation neutralisées.
 *
 * Elle sert à comparer, pas à deviner : la comparaison reste une ÉGALITÉ. « Armoire grille
 * centrale secours » n'est pas la Grille, et ne doit jamais le devenir.
 */
export const normalizeGrilleLabel = value => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * LES CHAMPS RETENUS, ET POURQUOI CHACUN.
 *
 * Ce n'est pas l'union mécanique des quatre anciens filtres : chaque champ est retenu parce
 * que la plateforme s'en sert DÉJÀ pour nommer ou identifier un équipement.
 *
 *   name, nom            l'identité d'affichage, écrite par tous les producteurs ;
 *   reference            un repli d'identité que la plateforme lit déjà pour nommer une
 *                        fiche (`map-digital-twin.js`, `operations-suite.js`) ;
 *   modele, model        une fiche d'inventaire incomplète porte souvent le libellé là ;
 *   inventorySource.*    la cellule brute de l'import 2M — précisément le cas « saisi avant
 *                        que la clé de catalogue existe » auquel l'alias sert de rattrapage.
 *
 * Aucun de ces champs ne décrit une installation : ce sont des libellés d'identité.
 */
export const GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS = Object.freeze([
  'name', 'nom', 'reference', 'modele', 'model'
]);
export const GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS = Object.freeze([
  'reference', 'label', 'name'
]);

/** Le lien de catalogue tel qu'il est DÉCLARÉ sur la fiche, ou la chaîne vide. */
const lienDeCatalogue = equipment => String(equipment?.catalogId || '').trim();

/** Le lien canonique : la fiche est reliée au modèle de la Grille. */
export const matchesGrilleCatalogId = equipment =>
  lienDeCatalogue(equipment) === GRILLE_CENTRALE_CATALOG_ID;

/**
 * Cette fiche déclare-t-elle appartenir à un AUTRE modèle de catalogue ?
 *
 * Ce n'est pas une absence d'information : c'est une affirmation, écrite dans la fiche par
 * qui l'a saisie ou importée. Elle a donc priorité sur tout libellé d'affichage.
 */
export const declaresForeignCatalogIdentity = equipment => {
  const lien = lienDeCatalogue(equipment);
  return Boolean(lien) && lien !== GRILLE_CENTRALE_CATALOG_ID;
};

/**
 * Cette fiche d'équipement EST-ELLE la Grille Centrale, du point de vue de l'interface ?
 *
 * L'ORDRE DE PRÉSÉANCE — LE LIEN DÉCLARÉ PASSE AVANT LE LIBELLÉ.
 * ---------------------------------------------------------------
 * Mesuré sur `af4e14a`, avec une fiche réelle portant `catalogId = kb-imagine-platinum-vx`
 * — un modèle qui EXISTE dans ce catalogue — et le libellé court « GRILLE CENTRALE » :
 *
 *     resolver privé   name-alias · fiche retenue
 *     ce prédicat      true
 *     autorisation     allowed=true · equipment-scope
 *     les 4 panneaux   true
 *
 * Le serveur et les écrans s'accordaient — sur une identité FAUSSE. La fiche disait
 * elle-même appartenir à un autre modèle ; un alias d'affichage renversait cette
 * déclaration. Corriger l'écart entre écrans (revue 4) ne suffit donc pas : encore faut-il
 * qu'ils s'accordent sur la BONNE fiche.
 *
 *   A. lien canonique               → c'est la Grille ;
 *   B. lien présent et DIFFÉRENT    → ce n'est pas la Grille, et l'alias ne s'exécute PAS ;
 *   C. aucun lien déclaré           → l'alias court peut servir de repli.
 *
 * Le repli d'alias n'existe que pour les fiches qui n'ont PAS encore d'identité de
 * catalogue. Il n'a jamais eu vocation à en contredire une.
 *
 * Rien n'est réécrit ici : un `catalogId` étranger n'est pas effacé, il est RESPECTÉ. La
 * réparation reste un geste explicite de l'opérateur.
 */
export function matchesPublicGrilleIdentity(equipment = {}) {
  if (matchesGrilleCatalogId(equipment)) return true;
  if (declaresForeignCatalogIdentity(equipment)) return false;
  const source = equipment?.inventorySource;
  const valeurs = [
    ...GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS.map(champ => equipment?.[champ]),
    ...GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS.map(champ => source?.[champ])
  ];
  return valeurs.some(valeur => normalizeGrilleLabel(valeur) === GRILLE_CENTRALE_PUBLIC_ALIAS);
}
