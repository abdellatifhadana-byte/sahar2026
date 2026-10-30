/**
 * @file nested-shape-contract.js — la forme d'une baie ou d'un équipement, DANS LA PHOTO
 *       de sa salle ou de sa baie, plutôt qu'un point sur le plan général.
 *
 * POURQUOI UN CONTRAT SÉPARÉ DE `map-shape-contract.js`.
 * --------------------------------------------------------------------------------------
 * `map-shape-contract.js` sait déjà tout de la GÉOMÉTRIE — rectangle, cercle, polygone,
 * poignées, centroïde garanti dedans — et ce module ne la refait pas : il en réutilise les
 * fonctions pures telles quelles. Ce qui manquait n'était pas une géométrie, mais un
 * ESPACE : `entity.shape` est celui du plan général (pixels naturels de l'image du plan).
 * La photo d'une salle et la photo d'une baie ont chacune leur PROPRE espace de pixels
 * naturels, sans rapport avec celui du plan ni entre elles. Réutiliser `entity.shape` pour
 * l'un ou l'autre ferait cohabiter trois référentiels sous un seul nom — exactement le
 * défaut que #170 a fermé pour les points (`x_inRoom` != `x_inMap`).
 *
 * D'où deux champs, un par photo :
 *
 *     baie.shapeInRoom        — sa zone visible sur la photo de SA salle
 *     equipment.shapeInRoom   — sa zone sur la photo de SA salle (monté directement, sans baie)
 *     equipment.shapeInBaie   — sa zone sur la photo de SA baie (monté en baie)
 *     component.shapeInEquipment — sa carte/module sur la photo de SON équipement/châssis
 *
 * Le composant est un troisième niveau, pas une troisième géométrie : toutes les fonctions
 * ci-dessous étaient déjà génériques sur `(entity, field)`, sans rien connaître de baie ou
 * de salle par leur nom. `component.shapeInEquipment` les réutilise donc TELLES QUELLES —
 * seule une troisième constante de champ s'ajoute. La normalisation propre au composant (le
 * whitelist qui reconstruit l'objet composant, distinct d'ici) vit dans
 * equipment-internals.js#normalizeComponents, seul endroit qui connaît la forme complète
 * d'un composant.
 *
 * PAS DE `rect` IMBRIQUÉ.
 * --------------------------------------------------------------------------------------
 * `writeShape()` (plan général) maintient un `rect` hérité PARCE QUE du code déjà écrit lit
 * `entity.rect` pour le plan général. Aucun code n'a jamais lu un `rectInRoom` ou un
 * `rectInBaie` : en écrire un serait une donnée morte à l'instant de sa création. Ce module
 * écrit uniquement le champ de forme, jamais de boîte englobante miroir.
 *
 * LE POINT HÉRITÉ RESTE LA SOURCE DE REPLI, JAMAIS RÉÉCRIT.
 * --------------------------------------------------------------------------------------
 * `x_inRoom`/`y_inRoom` et `x_inBaie`/`y_inBaie` continuent d'exister, inchangés : ce sont
 * des pixels naturels de la MÊME photo (voir map-coordinates-contract.js — c'est la
 * convention déjà correcte, historique, des repères d'équipement). La forme prend le pas
 * quand elle existe ; le point sert de repli quand elle n'existe pas ; aucun des deux
 * n'écrase jamais l'autre.
 */
import { normalizeShape, shapeBounds, shapeCentroid } from './map-shape-contract.js';

export const NESTED_SHAPE_CONTRACT_VERSION = 1;

export const SHAPE_IN_ROOM_FIELD = 'shapeInRoom';
export const SHAPE_IN_BAIE_FIELD = 'shapeInBaie';
export const SHAPE_IN_EQUIPMENT_FIELD = 'shapeInEquipment';

const finite = value => Number.isFinite(Number(value));

/** La forme documentée de cette entité dans cette scène-photo, ou `null` — jamais devinée. */
export function nestedShapeOf(entity, field) {
  return normalizeShape(entity?.[field]) || null;
}

/**
 * Une NOUVELLE valeur d'entité portant la forme donnée sous `field`. Ne mute jamais
 * l'original, n'ajoute aucun second champ, et rend l'entité INCHANGÉE si la forme ne
 * décrit rien d'exploitable — jamais un champ vidé par accident.
 */
export function withNestedShape(entity, field, shape) {
  const forme = normalizeShape(shape);
  if (!forme || !entity) return entity;
  return { ...entity, [field]: forme };
}

/**
 * La forme touche-t-elle au moins un peu l'image ? Une forme ENTIÈREMENT hors cadre trahit
 * un clic égaré ou une scène confondue (voir « mauvais contexte Salle/Baie » dans la
 * consigne), pas un placement réel : mieux vaut la refuser à l'enregistrement que la
 * stocker sans que personne ne puisse plus jamais la revoir ni la corriger.
 *
 * Une forme qui DÉBORDE partiellement du cadre reste acceptée : une baie peut légitimement
 * toucher le bord d'une photo mal cadrée, et ce n'est pas à ce contrat d'en décider
 * autrement — voir #170 et map-shape-contract.js, qui n'imposent déjà aucune borne au plan
 * général.
 */
export function shapeWithinBounds(shape, naturalWidth, naturalHeight) {
  const forme = normalizeShape(shape);
  const largeur = Number(naturalWidth);
  const hauteur = Number(naturalHeight);
  if (!forme || !Number.isFinite(largeur) || !Number.isFinite(hauteur) || largeur <= 0 || hauteur <= 0) return false;
  const boite = shapeBounds(forme);
  return boite.x < largeur && boite.x + boite.w > 0 && boite.y < hauteur && boite.y + boite.h > 0;
}

/**
 * Position effective d'une entité DANS une scène-photo — jamais les deux conventions à la
 * fois : la forme documentée fait foi dès qu'elle existe ; à défaut, le point hérité sert
 * de repli ; à défaut des deux, l'entité reste « à placer ». C'est la même hiérarchie que
 * `resolveEntityPlacement` (plan général), transposée à une scène-photo qui distingue en
 * plus CE QUI a été trouvé — une forme ne se dessine pas comme un point.
 */
export function nestedPlacement(entity, { shapeField, pointKeys = [] } = {}) {
  const forme = nestedShapeOf(entity, shapeField);
  if (forme) return Object.freeze({ kind: 'shape', shape: forme });
  const [cleX, cleY] = pointKeys;
  const x = Number(entity?.[cleX]);
  const y = Number(entity?.[cleY]);
  if (finite(x) && finite(y)) return Object.freeze({ kind: 'point', x, y });
  return Object.freeze({ kind: 'unplaced' });
}

/**
 * ANCRE RÉELLE POUR UN TRACÉ DE CÂBLE — le centroïde de la forme documentée, jamais une
 * position de port inventée. `null` sans forme : c'est à l'appelant de ne rien dessiner
 * plutôt que de deviner un point.
 *
 * Ce contrat s'arrête ICI, à dessein. Les tracés de câbles se dessinent aujourd'hui sur le
 * canevas schématique du plan (2000×1200, voir cable-route-layer.js), un espace de pixels
 * SANS RAPPORT avec celui d'une photo de salle ou de baie — les deux surfaces ne se
 * recouvrent jamais dans l'interface actuelle (`entrerDansTraceVue` masque explicitement
 * le panneau-photo avant de dessiner un tracé). Relier visuellement les deux exigerait de
 * faire cohabiter deux référentiels sans passerelle documentée entre eux, ce qui reviendrait
 * à inventer une correspondance — exactement ce que ce lot interdit. Cette fonction reste
 * donc une capacité PURE, prête pour le jour où les deux surfaces seront réconciliées, sans
 * prétendre aujourd'hui à un rendu qu'aucune géométrie réelle ne documente.
 *
 * Vaut aussi pour `SHAPE_IN_EQUIPMENT_FIELD` : un câble qui termine sur un composant dont
 * la position de port exacte n'est pas documentée s'arrête honnêtement à la carte/au
 * boîtier — cette fonction en donne le centroïde — plutôt que d'inventer une coordonnée de
 * connecteur BNC/RJ45 précise que personne n'a relevée.
 */
export function cableAnchorFromNestedShape(entity, shapeField) {
  const forme = nestedShapeOf(entity, shapeField);
  return forme ? shapeCentroid(forme) : null;
}

export default Object.freeze({
  version: NESTED_SHAPE_CONTRACT_VERSION,
  SHAPE_IN_ROOM_FIELD, SHAPE_IN_BAIE_FIELD, SHAPE_IN_EQUIPMENT_FIELD,
  nestedShapeOf, withNestedShape, shapeWithinBounds, nestedPlacement, cableAnchorFromNestedShape
});
