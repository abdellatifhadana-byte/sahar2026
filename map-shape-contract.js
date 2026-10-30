export const MAP_SHAPE_CONTRACT_VERSION = 1;

/**
 * @file map-shape-contract.js — les formes posées sur un plan.
 *
 * POURQUOI
 * --------
 * La carte ne savait dessiner QU'UN RECTANGLE : `rect: { x, y, w, h }`, tracé par un
 * glisser, sans possibilité de le reprendre autrement qu'en le redessinant entièrement.
 * Or une régie n'est pas un rectangle, un pupitre courbe non plus, et une zone technique
 * épouse rarement quatre angles droits. Chaque chose a sa forme.
 *
 * Trois formes couvrent le besoin réel : le rectangle (le cas fréquent), le cercle (les
 * zones de couverture, les pupitres), et le polygone (tout le reste, avec autant de points
 * que nécessaire).
 *
 * LA CONTRAINTE QUI COMMANDE TOUT : NE RIEN CASSER
 * ------------------------------------------------
 * Des salles et des baies portent DÉJÀ un `rect`. Les remplacer par un nouveau champ
 * effacerait le travail déjà fait sur le plan. Deux règles en découlent :
 *
 * 1. `readShape()` lit `shape` s'il existe, et RETOMBE sur `rect` sinon. Un enregistrement
 *    ancien est donc une forme valide sans aucune migration.
 * 2. `writeShape()` écrit `shape` ET met `rect` à jour avec la boîte englobante. Tout le
 *    code existant qui lit `rect` — le rendu, le placement des marqueurs, les tests —
 *    continue de fonctionner sans être touché. Le jour où plus rien ne lit `rect`, on le
 *    retirera ; d'ici là, deux écritures valent mieux qu'une rupture.
 *
 * Les coordonnées sont celles de l'image NATURELLE, comme tout le reste du plan
 * (voir map-coordinates-contract.js) : un repère garde son sens à toute taille d'affichage.
 */

export const SHAPE_TYPES = Object.freeze({
  RECT: 'rect',
  CIRCLE: 'circle',
  POLYGON: 'polygon'
});

/** Un polygone en dessous de trois points n'enferme aucune surface. */
export const MIN_POLYGON_POINTS = 3;

/** En deçà, une forme devient impossible à saisir à la souris. */
export const MIN_SIZE = 8;

const nombre = (value, defaut = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaut;
};

const point = (source, defaut = null) => {
  if (!source || typeof source !== 'object') return defaut;
  const x = Number(source.x);
  const y = Number(source.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : defaut;
};

/**
 * Forme normalisée d'une entité, quelle que soit la façon dont elle a été enregistrée.
 *
 * Retourne `null` quand l'entité n'a aucune forme — ce qui est un état légitime : une salle
 * peut exister sans avoir encore été dessinée sur le plan.
 */
export function readShape(entity) {
  const brut = entity?.shape;
  if (brut && typeof brut === 'object') {
    const forme = normalizeShape(brut);
    if (forme) return forme;
  }
  // Repli hérité : les enregistrements antérieurs n'ont qu'un rectangle.
  const rect = entity?.rect;
  if (rect && Number.isFinite(Number(rect.x)) && Number.isFinite(Number(rect.y))) {
    return normalizeShape({
      type: SHAPE_TYPES.RECT,
      x: nombre(rect.x), y: nombre(rect.y),
      w: nombre(rect.w), h: nombre(rect.h)
    });
  }
  return null;
}

/** Met une forme en règle, ou rend `null` si elle ne décrit rien d'exploitable. */
export function normalizeShape(source) {
  if (!source || typeof source !== 'object') return null;
  const type = String(source.type || '').toLowerCase();

  if (type === SHAPE_TYPES.CIRCLE) {
    const centre = point(source.center ?? { x: source.cx, y: source.cy });
    const rayon = nombre(source.r, 0);
    if (!centre || rayon <= 0) return null;
    return Object.freeze({
      type: SHAPE_TYPES.CIRCLE,
      center: Object.freeze({ ...centre }),
      r: Math.max(MIN_SIZE / 2, rayon)
    });
  }

  if (type === SHAPE_TYPES.POLYGON) {
    const points = Array.isArray(source.points)
      ? source.points.map(p => point(p)).filter(Boolean)
      : [];
    if (points.length < MIN_POLYGON_POINTS) return null;
    return Object.freeze({
      type: SHAPE_TYPES.POLYGON,
      points: Object.freeze(points.map(p => Object.freeze({ ...p })))
    });
  }

  // Le rectangle est le défaut, y compris quand `type` est absent : c'est la forme
  // historique, et un enregistrement ancien ne déclare pas son type.
  const x = nombre(source.x, NaN);
  const y = nombre(source.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Object.freeze({
    type: SHAPE_TYPES.RECT,
    x, y,
    w: Math.max(MIN_SIZE, nombre(source.w, MIN_SIZE)),
    h: Math.max(MIN_SIZE, nombre(source.h, MIN_SIZE))
  });
}

/**
 * Applique une forme à une entité, EN CONSERVANT `rect`.
 *
 * C'est la règle de compatibilité : tout le code déjà écrit qui lit `rect` — le rendu du
 * plan, le placement des marqueurs, les gardes — continue de fonctionner sans modification.
 */
export function writeShape(entity, shape) {
  const forme = normalizeShape(shape);
  if (!forme) return entity;
  const boite = shapeBounds(forme);
  return {
    ...entity,
    shape: forme,
    rect: { x: boite.x, y: boite.y, w: boite.w, h: boite.h }
  };
}

/** Boîte englobante — c'est elle qui alimente `rect` et le cadrage de l'affichage. */
export function shapeBounds(shape) {
  const forme = normalizeShape(shape) || shape;
  if (!forme) return { x: 0, y: 0, w: 0, h: 0 };
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return { x: forme.center.x - forme.r, y: forme.center.y - forme.r, w: forme.r * 2, h: forme.r * 2 };
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    const xs = forme.points.map(p => p.x);
    const ys = forme.points.map(p => p.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: forme.x, y: forme.y, w: forme.w, h: forme.h };
}

/**
 * Point d'ancrage du marqueur — GARANTI À L'INTÉRIEUR de la forme.
 *
 * Le piège, trouvé en mesurant sur un plan réel : pour une salle en L de sommets
 * (0,0) (200,0) (200,60) (60,60) (60,300) (0,300), le centroïde de l'aire tombe en
 * (61,8 ; 111,8) — soit 1,8 px HORS de la branche verticale, qui s'arrête à x = 60. Le
 * centre de la boîte englobante, lui, est encore plus loin dehors. Aucun des deux ne
 * convient, et le marqueur se posait donc à côté de la salle qu'il désigne.
 *
 * La règle : on essaie d'abord le centroïde de l'aire, qui donne le meilleur résultat
 * visuel quand il convient. Sinon on balaie la forme par lignes horizontales, on retient
 * l'intervalle intérieur le plus LARGE, et on prend son milieu. Pour tout polygone simple,
 * ce point est nécessairement dedans — et le choisir le plus large le place au cœur de la
 * partie la plus épaisse, là où une étiquette tient.
 */
export function shapeCentroid(shape) {
  const forme = normalizeShape(shape) || shape;
  if (!forme) return { x: 0, y: 0 };
  if (forme.type === SHAPE_TYPES.CIRCLE) return { x: forme.center.x, y: forme.center.y };
  if (forme.type === SHAPE_TYPES.POLYGON) {
    const pts = forme.points;
    let aireDouble = 0; let cx = 0; let cy = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const croix = a.x * b.y - b.x * a.y;
      aireDouble += croix;
      cx += (a.x + b.x) * croix;
      cy += (a.y + b.y) * croix;
    }
    if (Math.abs(aireDouble) > 1e-9) {
      const centre = { x: cx / (3 * aireDouble), y: cy / (3 * aireDouble) };
      if (shapeContains(forme, centre)) return centre;
    }
    return pointInteriorPolygon(forme);
  }
  return { x: forme.x + forme.w / 2, y: forme.y + forme.h / 2 };
}

/**
 * Milieu de l'intervalle intérieur le plus large, sur un balayage horizontal.
 *
 * Exporté parce qu'il se teste seul : c'est la garantie « le marqueur est dans la salle ».
 */
export function pointInteriorPolygon(shape, { scanlines = 33 } = {}) {
  const forme = normalizeShape(shape);
  const boite = shapeBounds(forme);
  if (!forme || forme.type !== SHAPE_TYPES.POLYGON || !(boite.h > 0)) {
    return { x: boite.x + boite.w / 2, y: boite.y + boite.h / 2 };
  }
  const pts = forme.points;
  let meilleur = null;
  const lignes = Math.max(3, Math.floor(scanlines));
  for (let i = 1; i < lignes; i += 1) {
    const y = boite.y + boite.h * i / lignes;
    // Abscisses où la ligne coupe le contour, triées : les segments [0-1], [2-3]… sont
    // intérieurs pour un polygone simple.
    const croisements = [];
    for (let k = 0, j = pts.length - 1; k < pts.length; j = k, k += 1) {
      const a = pts[k]; const b = pts[j];
      if ((a.y > y) !== (b.y > y)) {
        croisements.push((b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
      }
    }
    croisements.sort((u, v) => u - v);
    for (let k = 0; k + 1 < croisements.length; k += 2) {
      const largeur = croisements[k + 1] - croisements[k];
      if (!meilleur || largeur > meilleur.largeur) {
        meilleur = { largeur, x: (croisements[k] + croisements[k + 1]) / 2, y };
      }
    }
  }
  if (meilleur) return { x: meilleur.x, y: meilleur.y };
  return { x: boite.x + boite.w / 2, y: boite.y + boite.h / 2 };
}

/** La forme contient-elle ce point ? Sert au clic, au survol et à la sélection. */
export function shapeContains(shape, p) {
  const forme = normalizeShape(shape) || shape;
  const cible = point(p);
  if (!forme || !cible) return false;
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    const dx = cible.x - forme.center.x;
    const dy = cible.y - forme.center.y;
    return dx * dx + dy * dy <= forme.r * forme.r;
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    // Lancer de rayon : on compte les arêtes traversées à droite du point.
    let dedans = false;
    const pts = forme.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const a = pts[i]; const b = pts[j];
      const traverse = (a.y > cible.y) !== (b.y > cible.y);
      if (traverse && cible.x < (b.x - a.x) * (cible.y - a.y) / (b.y - a.y) + a.x) dedans = !dedans;
    }
    return dedans;
  }
  return cible.x >= forme.x && cible.x <= forme.x + forme.w
      && cible.y >= forme.y && cible.y <= forme.y + forme.h;
}

/** Déplacement d'ensemble : le glisser de la forme entière. */
/**
 * LA MÊME FORME, DÉCRITE POUR SVG — afin que la ZONE soit la cible du clic.
 *
 * Sur le plan général, la salle n'a plus de pastille : c'est sa zone documentée qui doit
 * être interactive. Une pastille transparente posée au point d'ancrage ne suffirait pas —
 * elle demanderait à l'utilisateur de deviner un disque invisible au milieu de la pièce,
 * alors que la surface réelle est connue et déjà dessinée ailleurs.
 *
 * Cette fonction ne crée AUCUN second format de géométrie : elle transpose la forme
 * canonique — rect, cercle, polygone — dans le vocabulaire SVG, et rien d'autre. Elle rend
 * des DONNÉES pures (`{ tag, attrs }`), sans toucher au DOM : le contrat reste exécutable
 * dans un test, et c'est l'appelant qui fabrique l'élément.
 *
 * `null` quand la forme ne décrit rien d'exploitable : pas de cible inventée.
 */
export function shapeToSvgGeometry(shape) {
  const forme = normalizeShape(shape);
  if (!forme) return null;
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return Object.freeze({
      tag: 'circle',
      attrs: Object.freeze({ cx: forme.center.x, cy: forme.center.y, r: forme.r })
    });
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    return Object.freeze({
      tag: 'polygon',
      attrs: Object.freeze({ points: forme.points.map(point => `${point.x},${point.y}`).join(' ') })
    });
  }
  return Object.freeze({
    tag: 'rect',
    attrs: Object.freeze({ x: forme.x, y: forme.y, width: forme.w, height: forme.h })
  });
}

export function moveShape(shape, dx, dy) {
  const forme = normalizeShape(shape);
  if (!forme) return null;
  const ex = nombre(dx); const ey = nombre(dy);
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return normalizeShape({ ...forme, center: { x: forme.center.x + ex, y: forme.center.y + ey } });
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    return normalizeShape({ ...forme, points: forme.points.map(p => ({ x: p.x + ex, y: p.y + ey })) });
  }
  return normalizeShape({ ...forme, x: forme.x + ex, y: forme.y + ey });
}

/**
 * Poignées manipulables, dans l'ordre où l'interface doit les dessiner.
 *
 * `kind` dit ce que la poignée fait : `vertex` déplace un point, `corner` redimensionne,
 * `radius` étire un cercle, `edge` propose d'INSÉRER un point au milieu d'une arête —
 * c'est ainsi qu'on ajoute des points à une forme sans menu.
 */
export function shapeHandles(shape) {
  const forme = normalizeShape(shape);
  if (!forme) return [];
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return [
      { kind: 'radius', index: 0, x: forme.center.x + forme.r, y: forme.center.y, cursor: 'ew-resize' },
      { kind: 'radius', index: 1, x: forme.center.x, y: forme.center.y + forme.r, cursor: 'ns-resize' }
    ];
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    const poignees = forme.points.map((p, index) =>
      ({ kind: 'vertex', index, x: p.x, y: p.y, cursor: 'move' }));
    // Les milieux d'arêtes : cliquer là insère un point. Un polygone se raffine donc
    // à la souris, sans jamais avoir à le redessiner.
    for (let i = 0; i < forme.points.length; i += 1) {
      const a = forme.points[i];
      const b = forme.points[(i + 1) % forme.points.length];
      poignees.push({ kind: 'edge', index: i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, cursor: 'copy' });
    }
    return poignees;
  }
  const { x, y, w, h } = forme;
  return [
    { kind: 'corner', index: 0, x, y, cursor: 'nwse-resize' },
    { kind: 'corner', index: 1, x: x + w, y, cursor: 'nesw-resize' },
    { kind: 'corner', index: 2, x: x + w, y: y + h, cursor: 'nwse-resize' },
    { kind: 'corner', index: 3, x, y: y + h, cursor: 'nesw-resize' }
  ];
}

/** Déplace une poignée et rend la forme qui en résulte. */
export function dragHandle(shape, handle, to) {
  const forme = normalizeShape(shape);
  const cible = point(to);
  if (!forme || !cible || !handle) return forme;

  if (handle.kind === 'radius') {
    const dx = cible.x - forme.center.x;
    const dy = cible.y - forme.center.y;
    return normalizeShape({ ...forme, r: Math.max(MIN_SIZE / 2, Math.hypot(dx, dy)) });
  }

  if (handle.kind === 'vertex') {
    const points = forme.points.map((p, i) => (i === handle.index ? cible : p));
    return normalizeShape({ ...forme, points });
  }

  if (handle.kind === 'edge') {
    // Insérer un point au milieu d'une arête, puis le suivre : le geste « ajouter un
    // point pour changer la forme » demandé, en un seul glisser.
    return insertVertex(forme, handle.index, cible);
  }

  if (handle.kind === 'corner') {
    const { x, y, w, h } = forme;
    const coins = [
      { x: x + w, y: y + h }, { x, y: y + h }, { x, y }, { x: x + w, y }
    ];
    const oppose = coins[handle.index];
    return normalizeShape({
      type: SHAPE_TYPES.RECT,
      x: Math.min(oppose.x, cible.x),
      y: Math.min(oppose.y, cible.y),
      w: Math.max(MIN_SIZE, Math.abs(cible.x - oppose.x)),
      h: Math.max(MIN_SIZE, Math.abs(cible.y - oppose.y))
    });
  }
  return forme;
}

/** Ajoute un point APRÈS `afterIndex`. Un rectangle devient alors un polygone. */
export function insertVertex(shape, afterIndex, p) {
  const forme = normalizeShape(shape);
  const cible = point(p);
  if (!forme || !cible) return forme;
  const polygone = toPolygon(forme);
  if (!polygone) return forme;
  const points = [...polygone.points];
  const index = Math.max(0, Math.min(points.length - 1, Math.floor(nombre(afterIndex, 0))));
  points.splice(index + 1, 0, cible);
  return normalizeShape({ type: SHAPE_TYPES.POLYGON, points });
}

/**
 * Retire un point. Sous trois points, la forme n'enferme plus rien : on refuse, plutôt que
 * de rendre une forme dégénérée qui disparaîtrait silencieusement du plan.
 */
export function removeVertex(shape, index) {
  const forme = normalizeShape(shape);
  if (!forme || forme.type !== SHAPE_TYPES.POLYGON) return forme;
  if (forme.points.length <= MIN_POLYGON_POINTS) return forme;
  const points = forme.points.filter((_, i) => i !== Math.floor(nombre(index, -1)));
  return normalizeShape({ type: SHAPE_TYPES.POLYGON, points });
}

/** Conversion en polygone — c'est ce qui permet de reprendre un rectangle existant. */
export function toPolygon(shape, { segments = 16 } = {}) {
  const forme = normalizeShape(shape);
  if (!forme) return null;
  if (forme.type === SHAPE_TYPES.POLYGON) return forme;
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    const n = Math.max(MIN_POLYGON_POINTS, Math.floor(segments));
    const points = Array.from({ length: n }, (_, i) => {
      const angle = i * 2 * Math.PI / n;
      return { x: forme.center.x + forme.r * Math.cos(angle), y: forme.center.y + forme.r * Math.sin(angle) };
    });
    return normalizeShape({ type: SHAPE_TYPES.POLYGON, points });
  }
  return normalizeShape({
    type: SHAPE_TYPES.POLYGON,
    points: [
      { x: forme.x, y: forme.y },
      { x: forme.x + forme.w, y: forme.y },
      { x: forme.x + forme.w, y: forme.y + forme.h },
      { x: forme.x, y: forme.y + forme.h }
    ]
  });
}

/** Mise à l'échelle autour d'un point fixe — l'agrandissement demandé. */
export function scaleShape(shape, factor, origin = null) {
  const forme = normalizeShape(shape);
  if (!forme) return null;
  const k = nombre(factor, 1);
  if (!(k > 0)) return forme;
  const pivot = point(origin) || shapeCentroid(forme);
  const mettre = p => ({ x: pivot.x + (p.x - pivot.x) * k, y: pivot.y + (p.y - pivot.y) * k });
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return normalizeShape({ ...forme, center: mettre(forme.center), r: Math.max(MIN_SIZE / 2, forme.r * k) });
  }
  if (forme.type === SHAPE_TYPES.POLYGON) {
    return normalizeShape({ ...forme, points: forme.points.map(mettre) });
  }
  const coin = mettre({ x: forme.x, y: forme.y });
  return normalizeShape({
    type: SHAPE_TYPES.RECT, x: coin.x, y: coin.y,
    w: Math.max(MIN_SIZE, forme.w * k), h: Math.max(MIN_SIZE, forme.h * k)
  });
}

/**
 * Chemin de dessin, indépendant de toute API graphique : une liste d'ordres que
 * l'appelant traduit pour son contexte. C'est ce qui rend ce module testable hors
 * navigateur — un contrat qui ne peut pas être vérifié ne protège rien.
 */
export function shapePath(shape) {
  const forme = normalizeShape(shape);
  if (!forme) return [];
  if (forme.type === SHAPE_TYPES.CIRCLE) {
    return [{ op: 'arc', x: forme.center.x, y: forme.center.y, r: forme.r }];
  }
  const points = forme.type === SHAPE_TYPES.POLYGON
    ? forme.points
    : toPolygon(forme).points;
  return [
    { op: 'moveTo', x: points[0].x, y: points[0].y },
    ...points.slice(1).map(p => ({ op: 'lineTo', x: p.x, y: p.y })),
    { op: 'closePath' }
  ];
}

/** Rectangle hérité correspondant à une forme, pour tout ce qui lit encore `rect`. */
export function shapeToLegacyRect(shape) {
  const boite = shapeBounds(shape);
  return { x: boite.x, y: boite.y, w: boite.w, h: boite.h };
}

/** Libellé humain, pour les menus et les messages. */
export function shapeLabel(shape) {
  const forme = normalizeShape(shape);
  if (!forme) return 'aucune forme';
  if (forme.type === SHAPE_TYPES.CIRCLE) return 'cercle';
  if (forme.type === SHAPE_TYPES.POLYGON) return `polygone (${forme.points.length} points)`;
  return 'rectangle';
}

export default Object.freeze({
  version: MAP_SHAPE_CONTRACT_VERSION,
  SHAPE_TYPES, MIN_POLYGON_POINTS, MIN_SIZE,
  readShape, normalizeShape, writeShape,
  shapeBounds, shapeCentroid, shapeContains,
  moveShape, scaleShape, shapeHandles, dragHandle,
  insertVertex, removeVertex, toPolygon,
  shapePath, shapeToLegacyRect, shapeLabel, pointInteriorPolygon
});
