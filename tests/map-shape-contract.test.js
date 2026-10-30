import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAPE_TYPES, MIN_POLYGON_POINTS, MIN_SIZE,
  readShape, normalizeShape, writeShape,
  shapeBounds, shapeCentroid, shapeContains,
  moveShape, scaleShape, shapeHandles, dragHandle,
  insertVertex, removeVertex, toPolygon, shapePath, shapeLabel, pointInteriorPolygon
} from '../map-shape-contract.js';

/*
 * La carte ne savait dessiner qu'un rectangle, tracé par un glisser, impossible à reprendre
 * autrement qu'en le redessinant. Or chaque chose a sa forme : une régie n'est pas un
 * rectangle, un pupitre courbe non plus.
 *
 * La contrainte qui commande tout : des salles et des baies portent DÉJÀ un `rect`. Rien
 * de ce qui a été dessiné ne doit disparaître.
 */

/* ---------------------------------------------------------------- compatibilité */

test('un enregistrement qui n’a qu’un rect hérité reste une forme valide', () => {
  // Sans cela, tout le travail déjà fait sur le plan disparaîtrait au premier chargement.
  const forme = readShape({ rect: { x: 10, y: 20, w: 100, h: 50 } });
  assert.ok(forme, 'un rect hérité n’est plus lu comme une forme');
  assert.equal(forme.type, SHAPE_TYPES.RECT);
  assert.deepEqual(shapeBounds(forme), { x: 10, y: 20, w: 100, h: 50 });
});

test('écrire une forme MET À JOUR rect, pour tout le code qui le lit encore', () => {
  // Le rendu du plan, le placement des marqueurs et plusieurs gardes lisent `rect`.
  // Écrire `shape` sans lui ferait disparaître la zone de l'affichage.
  const entite = writeShape({ id: 'salle-1', name: 'Régie' }, {
    type: SHAPE_TYPES.CIRCLE, center: { x: 100, y: 100 }, r: 40
  });
  assert.equal(entite.shape.type, SHAPE_TYPES.CIRCLE);
  assert.deepEqual(entite.rect, { x: 60, y: 60, w: 80, h: 80 });
  assert.equal(entite.name, 'Régie', 'les autres champs ont été perdus');
});

test('shape l’emporte sur rect quand les deux existent', () => {
  const forme = readShape({
    rect: { x: 0, y: 0, w: 10, h: 10 },
    shape: { type: SHAPE_TYPES.CIRCLE, center: { x: 50, y: 50 }, r: 25 }
  });
  assert.equal(forme.type, SHAPE_TYPES.CIRCLE);
});

test('une entité sans forme rend null, ce qui est un état légitime', () => {
  // Une salle peut exister sans avoir encore été dessinée sur le plan.
  assert.equal(readShape({ id: 'x' }), null);
  assert.equal(readShape(null), null);
  assert.equal(readShape({ rect: { w: 10, h: 10 } }), null);
});

/* ---------------------------------------------------------------- les trois formes */

test('un rectangle sans type déclaré reste un rectangle', () => {
  // Les enregistrements anciens ne déclarent pas leur type.
  const forme = normalizeShape({ x: 5, y: 5, w: 20, h: 30 });
  assert.equal(forme.type, SHAPE_TYPES.RECT);
});

test('un cercle sans rayon, un polygone à deux points : refusés', () => {
  // Une forme dégénérée disparaîtrait silencieusement du plan.
  assert.equal(normalizeShape({ type: 'circle', center: { x: 1, y: 1 }, r: 0 }), null);
  assert.equal(normalizeShape({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), null);
  assert.ok(normalizeShape({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] }));
});

test('une forme trop petite est ramenée à une taille saisissable', () => {
  const forme = normalizeShape({ x: 0, y: 0, w: 1, h: 1 });
  assert.ok(forme.w >= MIN_SIZE && forme.h >= MIN_SIZE,
    'une zone d’un pixel serait impossible à attraper à la souris');
});

/* ---------------------------------------------------------------- géométrie */

test('le L qui a piégé le centroïde : le point d’ancrage reste dedans', () => {
  // CONTRE-EXEMPLE TROUVÉ EN MESURANT DANS LE NAVIGATEUR, pas en relisant le code.
  // Pour ce L précis, le centroïde de l'aire tombe en (61,8 ; 111,8) — soit 1,8 px HORS
  // de la branche verticale, qui s'arrête à x = 60. Le centre de la boîte englobante,
  // qui servait de repli, est encore plus loin dehors. Le marqueur se posait donc à côté
  // de la salle qu'il désigne, et le premier test de forme en L ne l'avait pas vu parce
  // que SON L avait un centroïde intérieur.
  const L = {
    type: SHAPE_TYPES.POLYGON,
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 },
             { x: 60, y: 60 }, { x: 60, y: 300 }, { x: 0, y: 300 }]
  };
  const boite = shapeBounds(L);
  assert.equal(shapeContains(L, { x: boite.x + boite.w / 2, y: boite.y + boite.h / 2 }), false,
    'le test ne prouve rien : le centre de la boîte est déjà dedans');
  assert.ok(shapeContains(L, shapeCentroid(L)),
    `point d’ancrage hors de la forme : ${JSON.stringify(shapeCentroid(L))}`);
});

test('le point d’ancrage tient sur des formes concaves variées', () => {
  // Un U, un T, un couloir en serpentin : aucune n'a son centre géométrique à l'intérieur.
  const formes = {
    U: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 160 }, { x: 120, y: 160 },
        { x: 120, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 200 }, { x: 0, y: 200 }],
    T: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 40 }, { x: 120, y: 40 },
        { x: 120, y: 200 }, { x: 80, y: 200 }, { x: 80, y: 40 }, { x: 0, y: 40 }],
    S: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 90 }, { x: 40, y: 90 },
        { x: 40, y: 110 }, { x: 200, y: 110 }, { x: 200, y: 200 }, { x: 0, y: 200 },
        { x: 0, y: 110 }, { x: 20, y: 110 }, { x: 20, y: 90 }, { x: 0, y: 90 }]
  };
  for (const [nom, points] of Object.entries(formes)) {
    const forme = { type: SHAPE_TYPES.POLYGON, points };
    assert.ok(shapeContains(forme, shapeCentroid(forme)),
      `forme « ${nom} » : le point d’ancrage est tombé dehors`);
  }
});

test('le repli par balayage donne toujours un point intérieur', () => {
  const L = {
    type: SHAPE_TYPES.POLYGON,
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 },
             { x: 60, y: 60 }, { x: 60, y: 300 }, { x: 0, y: 300 }]
  };
  const p = pointInteriorPolygon(L);
  assert.ok(shapeContains(L, p), 'le balayage a rendu un point extérieur');
  // Et il vise la partie la plus LARGE : une étiquette doit pouvoir y tenir.
  assert.ok(p.y < 60, `le point s’est posé dans la branche étroite (y=${p.y})`);
});

test('le point d’ancrage d’un L reste À L’INTÉRIEUR de la forme', () => {
  // Le centre de la boîte englobante d'un couloir en équerre tombe DEHORS : le marqueur
  // se serait posé sur le vide, à côté de la salle qu'il désigne.
  const L = {
    type: SHAPE_TYPES.POLYGON,
    points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 }]
  };
  const boite = shapeBounds(L);
  const centreBoite = { x: boite.x + boite.w / 2, y: boite.y + boite.h / 2 };
  assert.equal(shapeContains(L, centreBoite), false, 'le test ne prouve rien : le centre est déjà dedans');
  assert.ok(shapeContains(L, shapeCentroid(L)), 'le point d’ancrage est tombé hors de la forme');
});

test('le clic sait ce qu’il touche, pour les trois formes', () => {
  const rect = { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 100, h: 50 };
  assert.ok(shapeContains(rect, { x: 50, y: 25 }));
  assert.equal(shapeContains(rect, { x: 150, y: 25 }), false);

  const cercle = { type: SHAPE_TYPES.CIRCLE, center: { x: 100, y: 100 }, r: 30 };
  assert.ok(shapeContains(cercle, { x: 120, y: 100 }));
  // Le coin de la boîte englobante est hors du cercle : un test par boîte le manquerait.
  assert.equal(shapeContains(cercle, { x: 128, y: 128 }), false);

  const triangle = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] };
  assert.ok(shapeContains(triangle, { x: 10, y: 10 }));
  assert.equal(shapeContains(triangle, { x: 90, y: 90 }), false, 'le coin vide du triangle est compté dedans');
});

test('déplacer une forme la déplace entièrement, sans la déformer', () => {
  for (const forme of [
    { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 40, h: 20 },
    { type: SHAPE_TYPES.CIRCLE, center: { x: 10, y: 10 }, r: 15 },
    { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }] }
  ]) {
    const avant = shapeBounds(forme);
    const apres = shapeBounds(moveShape(forme, 25, -10));
    assert.equal(apres.x, avant.x + 25);
    assert.equal(apres.y, avant.y - 10);
    assert.equal(apres.w, avant.w, `${forme.type} a changé de largeur en se déplaçant`);
    assert.equal(apres.h, avant.h, `${forme.type} a changé de hauteur en se déplaçant`);
  }
});

test('agrandir conserve le centre', () => {
  const forme = { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 40, h: 20 };
  const centreAvant = shapeCentroid(forme);
  const agrandi = scaleShape(forme, 2);
  const centreApres = shapeCentroid(agrandi);
  assert.ok(Math.abs(centreApres.x - centreAvant.x) < 1e-6, 'le centre a bougé en agrandissant');
  assert.ok(Math.abs(centreApres.y - centreAvant.y) < 1e-6);
  assert.equal(shapeBounds(agrandi).w, 80);
});

/* ---------------------------------------------------------------- manipulation */

test('un rectangle offre quatre coins ; tirer un coin redimensionne depuis l’opposé', () => {
  const forme = { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 100, h: 100 };
  const poignees = shapeHandles(forme);
  assert.equal(poignees.filter(p => p.kind === 'corner').length, 4);
  // On tire le coin bas-droit : le coin haut-gauche ne doit PAS bouger.
  const coinBD = poignees.find(p => p.x === 100 && p.y === 100);
  const apres = shapeBounds(dragHandle(forme, coinBD, { x: 150, y: 60 }));
  assert.equal(apres.x, 0, 'le coin opposé a bougé');
  assert.equal(apres.y, 0);
  assert.equal(apres.w, 150);
  assert.equal(apres.h, 60);
});

test('tirer un coin AU-DELÀ de l’opposé ne retourne pas la forme', () => {
  // Une largeur négative rendait la zone invisible et son test de clic toujours faux.
  const forme = { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 100, h: 100 };
  const coinBD = shapeHandles(forme).find(p => p.x === 100 && p.y === 100);
  const apres = shapeBounds(dragHandle(forme, coinBD, { x: -50, y: -50 }));
  assert.ok(apres.w > 0 && apres.h > 0, 'la forme s’est retournée');
  assert.ok(shapeContains(dragHandle(forme, coinBD, { x: -50, y: -50 }), { x: -25, y: -25 }));
});

test('un cercle se redimensionne par son rayon, sans se déplacer', () => {
  const forme = { type: SHAPE_TYPES.CIRCLE, center: { x: 100, y: 100 }, r: 20 };
  const poignee = shapeHandles(forme).find(p => p.kind === 'radius');
  const apres = dragHandle(forme, poignee, { x: 160, y: 100 });
  assert.equal(apres.r, 60);
  assert.deepEqual({ x: apres.center.x, y: apres.center.y }, { x: 100, y: 100 }, 'le cercle s’est déplacé');
});

test('un polygone expose un point par sommet, et un ajout par arête', () => {
  const forme = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  const poignees = shapeHandles(forme);
  assert.equal(poignees.filter(p => p.kind === 'vertex').length, 3);
  assert.equal(poignees.filter(p => p.kind === 'edge').length, 3,
    'sans poignée d’arête, ajouter un point exigerait un menu');
});

test('tirer une poignée d’arête AJOUTE un point : la forme se raffine à la souris', () => {
  // « ajouter des points pour changer la forme » — le geste demandé, en un seul glisser.
  const forme = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  const arete = shapeHandles(forme).find(p => p.kind === 'edge' && p.index === 0);
  const apres = dragHandle(forme, arete, { x: 50, y: -40 });
  assert.equal(apres.points.length, 4, 'aucun point n’a été ajouté');
  assert.ok(apres.points.some(p => p.x === 50 && p.y === -40), 'le point ajouté n’a pas suivi la souris');
});

test('déplacer un sommet ne déplace que lui', () => {
  const forme = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  const sommet = shapeHandles(forme).find(p => p.kind === 'vertex' && p.index === 1);
  const apres = dragHandle(forme, sommet, { x: 200, y: 50 });
  assert.deepEqual(apres.points[0], { x: 0, y: 0 });
  assert.deepEqual(apres.points[1], { x: 200, y: 50 });
  assert.deepEqual(apres.points[2], { x: 100, y: 100 });
});

test('on ne descend pas sous trois points', () => {
  // Sous trois points la forme n'enferme plus rien : elle disparaîtrait du plan.
  const triangle = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] };
  assert.equal(removeVertex(triangle, 0).points.length, MIN_POLYGON_POINTS, 'le triangle a été amputé');
  const carre = { type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
  assert.equal(removeVertex(carre, 0).points.length, 3);
});

test('un rectangle existant se reprend en polygone sans rien perdre', () => {
  // C'est ce qui permet de raffiner une zone déjà dessinée, au lieu de la refaire.
  const rect = { type: SHAPE_TYPES.RECT, x: 10, y: 20, w: 100, h: 50 };
  const polygone = toPolygon(rect);
  assert.equal(polygone.points.length, 4);
  assert.deepEqual(shapeBounds(polygone), shapeBounds(rect), 'la conversion a déformé la zone');
});

test('un cercle converti en polygone garde son emprise', () => {
  const cercle = { type: SHAPE_TYPES.CIRCLE, center: { x: 50, y: 50 }, r: 30 };
  const polygone = toPolygon(cercle, { segments: 24 });
  assert.equal(polygone.points.length, 24);
  const boite = shapeBounds(polygone);
  assert.ok(Math.abs(boite.w - 60) < 2, `emprise perdue : ${boite.w} au lieu de ~60`);
});

test('ajouter un point à un rectangle en fait un polygone', () => {
  const rect = { type: SHAPE_TYPES.RECT, x: 0, y: 0, w: 100, h: 100 };
  const apres = insertVertex(rect, 0, { x: 50, y: -30 });
  assert.equal(apres.type, SHAPE_TYPES.POLYGON);
  assert.equal(apres.points.length, 5);
});

/* ---------------------------------------------------------------- dessin */

test('le chemin de dessin ne dépend d’aucune API graphique', () => {
  // Un contrat qui ne peut pas être vérifié hors navigateur ne protège rien.
  const chemin = shapePath({ type: SHAPE_TYPES.POLYGON, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] });
  assert.equal(chemin[0].op, 'moveTo');
  assert.equal(chemin.filter(o => o.op === 'lineTo').length, 2);
  assert.equal(chemin[chemin.length - 1].op, 'closePath');
  const cercle = shapePath({ type: SHAPE_TYPES.CIRCLE, center: { x: 5, y: 5 }, r: 20 });
  assert.deepEqual(cercle, [{ op: 'arc', x: 5, y: 5, r: 20 }]);
});

test('un cercle minuscule est ramené au rayon saisissable, pas refusé', () => {
  // Un rayon de 3 donne un diamètre de 6 px : impossible à attraper. On le remonte au
  // minimum au lieu de rejeter la forme, ce qui ferait disparaître la zone.
  const forme = normalizeShape({ type: SHAPE_TYPES.CIRCLE, center: { x: 5, y: 5 }, r: 3 });
  assert.equal(forme.r, MIN_SIZE / 2);
});

test('les libellés nomment la forme, avec son nombre de points', () => {
  assert.equal(shapeLabel({ x: 0, y: 0, w: 10, h: 10 }), 'rectangle');
  assert.equal(shapeLabel({ type: 'circle', center: { x: 0, y: 0 }, r: 5 }), 'cercle');
  assert.equal(shapeLabel({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }), 'polygone (3 points)');
  assert.equal(shapeLabel(null), 'aucune forme');
});

test('les formes rendues sont gelées : personne ne les modifie par accident', () => {
  const forme = normalizeShape({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] });
  assert.throws(() => { forme.points.push({ x: 9, y: 9 }); });
});
