import { readShape, shapeCentroid } from './map-shape-contract.js';

export const MAP_COORDINATES_CONTRACT_VERSION = 1;

/**
 * Contrat unique des coordonnées posées sur une image de plan.
 *
 * Deux conventions incompatibles coexistaient. Les équipements enregistraient des pixels
 * de l'image NATURELLE, accompagnés de ses dimensions d'origine, et les remettaient à
 * l'échelle à l'affichage — c'est la bonne. Les salles, elles, enregistraient l'écart en
 * pixels par rapport au coin de l'image TELLE QU'AFFICHÉE à cet instant, sans noter à
 * quelle taille : la fenêtre de saisie est plafonnée à 430 px de large, si bien qu'un même
 * repère se retrouvait ailleurs dès que le plan s'affichait à une autre taille — autre
 * écran, autre zoom, mise en page adaptative. La position perdait son sens en silence.
 *
 * Tout passe désormais par les pixels de l'image naturelle : le repère reste au même
 * endroit du plan quelle que soit la taille d'affichage.
 */

const finite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const positive = (value, fallback = 1) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

/**
 * Convertit un clic sur l'image affichée en coordonnées de l'image naturelle.
 * `rect` est le rectangle de l'élément image, `naturalWidth`/`naturalHeight` ses
 * dimensions d'origine.
 */
export function toNaturalCoordinates({ clientX, clientY, rect, naturalWidth, naturalHeight } = {}) {
  const displayWidth = positive(rect?.width);
  const displayHeight = positive(rect?.height);
  const sourceWidth = positive(naturalWidth, displayWidth);
  const sourceHeight = positive(naturalHeight, displayHeight);
  const offsetX = finite(clientX) - finite(rect?.left);
  const offsetY = finite(clientY) - finite(rect?.top);
  return {
    x: Math.round(Math.max(0, Math.min(displayWidth, offsetX)) * sourceWidth / displayWidth),
    y: Math.round(Math.max(0, Math.min(displayHeight, offsetY)) * sourceHeight / displayHeight),
    // Sans ces deux dimensions, la valeur ci-dessus est ininterprétable : c'est
    // précisément ce qui manquait aux salles.
    imgNaturalWidth: Math.round(sourceWidth),
    imgNaturalHeight: Math.round(sourceHeight),
    unit: 'natural-px'
  };
}

/**
 * Position d'affichage, en pixels, d'un repère enregistré.
 *
 * Un enregistrement peut ne pas porter ses dimensions d'origine, et ce silence recouvre
 * DEUX situations opposées qu'aucune heuristique ne sait distinguer :
 *
 * - les repères d'équipement ont toujours été posés en pixels de l'image naturelle ; sans
 *   dimensions enregistrées, celles de l'image courante sont les bonnes et la remise à
 *   l'échelle doit avoir lieu — c'est le comportement historique, correct ;
 * - les repères de salle hérités sont des pixels d'affichage à une échelle jamais notée ;
 *   les traiter comme des pixels naturels les déplacerait franchement. Mieux vaut la
 *   position approximative d'avant qu'un saut arbitraire.
 *
 * L'appelant tranche donc explicitement, via `assumeNaturalWhenUnknown`. Le défaut est le
 * choix prudent : ne pas remettre à l'échelle ce qu'on ne sait pas interpréter.
 */
export function toDisplayCoordinates(source = {}, {
  displayWidth, displayHeight, naturalWidth, naturalHeight, assumeNaturalWhenUnknown = false
} = {}) {
  const shownWidth = positive(displayWidth);
  const shownHeight = positive(displayHeight);
  const declaredWidth = positive(source?.imgNaturalWidth, 0);
  const declaredHeight = positive(source?.imgNaturalHeight, 0);
  const sourceWidth = declaredWidth || (assumeNaturalWhenUnknown ? positive(naturalWidth, 0) : 0);
  const sourceHeight = declaredHeight || (assumeNaturalWhenUnknown ? positive(naturalHeight, 0) : 0);
  const x = finite(source?.x);
  const y = finite(source?.y);
  if (!sourceWidth || !sourceHeight) return { x, y, scaled: false };
  return {
    x: x * shownWidth / sourceWidth,
    y: y * shownHeight / sourceHeight,
    scaled: true
  };
}

/** Forme stockée d'un repère, quelles que soient les clés d'origine. */
export function normalizeMapCoordinates(source = null) {
  if (!source || typeof source !== 'object') return null;
  const x = Number(source.x);
  const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const naturalWidth = Number(source.imgNaturalWidth);
  const naturalHeight = Number(source.imgNaturalHeight);
  return {
    x, y,
    imgNaturalWidth: Number.isFinite(naturalWidth) && naturalWidth > 0 ? Math.round(naturalWidth) : null,
    imgNaturalHeight: Number.isFinite(naturalHeight) && naturalHeight > 0 ? Math.round(naturalHeight) : null,
    unit: 'natural-px'
  };
}

/** Un repère sans dimensions d'origine ne peut pas être remis à l'échelle. */
export function coordinatesAreResolvable(source = null) {
  const value = normalizeMapCoordinates(source);
  return Boolean(value && value.imgNaturalWidth && value.imgNaturalHeight);
}

/**
 * PLACEMENT DE REPLI — pour ce qui n'a PAS encore de position sur le plan.
 *
 * Le défaut corrigé : chaque entité dépourvue de repère retombait sur une constante — les
 * salles sur (90, 120), les baies sur (180, 180). Mesuré dans le navigateur : quatre salles
 * en base, quatre marqueurs dessinés, et UNE SEULE position distincte. Les marqueurs étaient
 * donc empilés au pixel près, et l'administrateur qui ajoutait une salle ne la voyait jamais
 * apparaître : elle se cachait sous la précédente. La recherche, elle, continuait de la
 * trouver — ce qui rendait le défaut incompréhensible.
 *
 * Le remède n'est pas d'inventer une position : c'est d'en donner une PROVISOIRE et
 * DISTINCTE, en rangeant les non-placés sur une grille régulière, dans un coin réservé du
 * plan. Ils deviennent visibles, dénombrables et déplaçables, et le drapeau `placed:false`
 * permet à l'interface de dire clairement qu'ils restent à positionner.
 *
 * Le placement est DÉTERMINISTE : le même rang donne toujours le même point. Un placement
 * aléatoire ferait sauter les marqueurs à chaque rendu, et l'administrateur ne saurait plus
 * lequel il vient de déplacer.
 */
export function fallbackPlacement(rank = 0, {
  originX = 60, originY = 90, columns = 6, stepX = 52, stepY = 46
} = {}) {
  const index = Number.isFinite(Number(rank)) && Number(rank) >= 0 ? Math.floor(Number(rank)) : 0;
  const colonnes = Math.max(1, Math.floor(columns));
  return Object.freeze({
    x: originX + (index % colonnes) * stepX,
    y: originY + Math.floor(index / colonnes) * stepY,
    placed: false
  });
}

/**
 * Position effective d'une entité sur le plan.
 *
 * `rect` fait foi quand il existe : c'est une zone dessinée par l'administrateur. Viennent
 * ensuite les repères ponctuels propres au contexte (`x`/`y`, `x_inRoom`, `x_inBaie`…).
 * À défaut de tout cela, on range l'entité parmi les non-placés.
 *
 * `rank` doit être STABLE d'un rendu à l'autre — le rang dans une liste triée, jamais
 * l'ordre d'arrivée du serveur, qui varie.
 */
export const MAP_SCENES = Object.freeze(['map', 'room', 'baie']);

/**
 * CHAQUE SCÈNE A SA GÉOMÉTRIE, ET UNE FORME GÉNÉRIQUE N'EN EST PAS UNE (#170).
 *
 * Une entité ne porte QU'UNE forme (`entity.shape`, ou l'héritage `entity.rect`). Elle est
 * tracée sur le plan général : ses coordonnées sont celles de l'image du PLAN. Or cette
 * fonction la faisait gagner INCONDITIONNELLEMENT, avant même de regarder le repère propre
 * à la scène affichée. Conséquence mesurable : une baie dotée d'une forme sur le plan
 * apparaissait, DANS la scène Salle, à sa position du plan — en ignorant son
 * `x_inRoom/y_inRoom`, c'est-à-dire la seule position que quelqu'un ait réellement posée
 * pour cette scène. La géométrie d'un espace fuyait dans un autre.
 *
 * La règle, désormais :
 *
 *   scène `map`          la forme fait foi — c'est SA géométrie —, puis le repère ponctuel ;
 *   scènes `room`/`baie` le repère propre à la scène fait foi, et la forme générique n'est
 *                        PAS consultée du tout : la transposer reviendrait à poser un
 *                        point du plan dans l'espace d'une pièce, deux référentiels sans
 *                        rapport.
 *
 * À défaut, l'entité n'est pas placée : `placed:false`. Ce n'est pas une position, c'est
 * l'absence documentée d'une position — voir `fallbackPlacement`.
 */
export function resolveEntityPlacement(entity, {
  rank = 0, pointKeys = ['x', 'y'], options = {}, scene = 'map'
} = {}) {
  const scenePropre = MAP_SCENES.includes(scene) ? scene : 'map';
  const [cleX, cleY] = pointKeys;
  const x = Number(entity?.[cleX]);
  const y = Number(entity?.[cleY]);
  const pointExiste = Number.isFinite(x) && Number.isFinite(y);

  if (scenePropre === 'map') {
    // La forme fait foi quand elle existe, et son point d'ancrage est le CENTROÏDE, pas le
    // centre de la boîte englobante : sur une salle en L ou un couloir en équerre, le centre
    // de la boîte tombe hors de la pièce, et le marqueur se poserait à côté de ce qu'il
    // désigne. Le contrat des formes tranche ce cas (voir map-shape-contract.js).
    const forme = readShape(entity);
    if (forme) {
      const centre = shapeCentroid(forme);
      return Object.freeze({ x: centre.x, y: centre.y, placed: true });
    }
    if (pointExiste) return Object.freeze({ x, y, placed: true });
    return fallbackPlacement(rank, options);
  }

  // Scène contextuelle : SON repère, ou rien. Aucune forme du plan n'y entre.
  if (pointExiste) return Object.freeze({ x, y, placed: true });
  return fallbackPlacement(rank, options);
}


/* ─────────────────────────────────────────────────────────────────────────────
 * D'UNE GÉOMÉTRIE EN PIXELS NATURELS VERS L'ESPACE DE DESSIN
 *
 * Un tracé de câble est relevé en pixels de l'IMAGE — la seule mesure qui désigne le même
 * endroit physique après un redimensionnement, un zoom ou un changement d'écran. Le
 * dessiner demande donc une mise à l'échelle, et une seule règle :
 *
 *     afficheX = naturelX × largeurAffichée / largeurNaturelle
 *
 * Rien d'autre. Pas de décalage, pas de marge, pas de correction d'aspect : la couche de
 * dessin de la carte recouvre exactement l'image, comme le font déjà les formes de salles.
 * Une conversion qui rendrait des pourcentages ou des pixels de fenêtre romprait
 * l'invariant de #170 — le même point relu doit désigner le même endroit.
 *
 * Rend `[]` plutôt qu'une approximation quand la géométrie source est inutilisable : une
 * polyligne à demi convertie se lirait comme un relevé.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * @param source  { naturalWidth, naturalHeight, waypoints:[{x,y}] } — pixels naturels
 * @param cible   { width, height } — l'espace de dessin
 */
export function naturalPolylineToDisplay(source = {}, cible = {}) {
  const largeurSource = positive(source.naturalWidth, 0);
  const hauteurSource = positive(source.naturalHeight, 0);
  const largeurCible = positive(cible.width, 0);
  const hauteurCible = positive(cible.height, 0);
  if (!largeurSource || !hauteurSource || !largeurCible || !hauteurCible) return [];
  const points = Array.isArray(source.waypoints) ? source.waypoints : [];
  const sortie = [];
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    // Un point illisible n'est pas rapproché du plus proche voisin : la polyligne entière
    // est écartée, faute de quoi le tracé affiché ne serait plus celui qui a été relevé.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    sortie.push({ x: x * largeurCible / largeurSource, y: y * hauteurCible / hauteurSource });
  }
  return sortie;
}

/**
 * Taille minimale crédible pour un plan, en pixels.
 *
 * En dessous, il ne s'agit pas d'un plan mais d'un substitut : image de remplacement,
 * pixel transparent, vignette de chargement. Le seuil est très bas à dessein — il ne doit
 * écarter que l'absurde, jamais un plan réel, même modeste.
 */
export const MIN_PLAN_SIZE = 64;

/**
 * Dimensions de l'espace de travail du plan.
 *
 * LE DÉFAUT CORRIGÉ, mesuré dans le navigateur : quand aucun plan n'est configuré, la
 * plateforme sert une image de remplacement de 4 × 4 pixels, et `settings.mapImageWidth`
 * valait 4. L'ajustement calculait alors
 *
 *     baseScale = hauteur utile / hauteur de l'espace = 792 / 4 = 198
 *
 * et toute la carte — image, canevas de 2000 × 1200, marqueurs — était rendue dans une
 * scène de QUATRE PIXELS de côté, agrandie 198 fois. Conséquences mesurées :
 *
 * - le plan paraissait énorme et illisible ;
 * - le moindre décalage de mise en page était multiplié par 198 : à l'ouverture du menu
 *   contextuel, le canevas sautait de 196 838 px hors de l'écran, ce qui rendait
 *   « Modifier », « Déplacer » et « Redimensionner » tous inutilisables ;
 * - l'administrateur ne pouvait donc rien poser ni reprendre sur la carte.
 *
 * La règle : une image de substitution ne définit pas l'espace de travail. En deçà du
 * seuil, on retombe sur les dimensions de référence du canevas, qui restent cohérentes
 * avec les coordonnées déjà enregistrées.
 */
export function resolveWorkspaceGeometry({
  naturalWidth, naturalHeight, settingsWidth, settingsHeight,
  fallbackWidth = 2000, fallbackHeight = 1200
} = {}) {
  const credible = (w, h) => {
    const largeur = Number(w);
    const hauteur = Number(h);
    return Number.isFinite(largeur) && Number.isFinite(hauteur)
      && largeur >= MIN_PLAN_SIZE && hauteur >= MIN_PLAN_SIZE
      ? { width: Math.round(largeur), height: Math.round(hauteur) }
      : null;
  };
  // L'image réellement chargée fait foi ; les réglages ne servent qu'avant son chargement.
  return credible(naturalWidth, naturalHeight)
      || credible(settingsWidth, settingsHeight)
      || { width: Math.round(fallbackWidth), height: Math.round(fallbackHeight) };
}

export default Object.freeze({
  naturalPolylineToDisplay,
  version: MAP_COORDINATES_CONTRACT_VERSION,
  MIN_PLAN_SIZE,
  resolveWorkspaceGeometry,
  toNaturalCoordinates,
  toDisplayCoordinates,
  normalizeMapCoordinates,
  coordinatesAreResolvable,
  fallbackPlacement,
  resolveEntityPlacement
});
