import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveWorkspaceGeometry, MIN_PLAN_SIZE } from '../map-coordinates-contract.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const editeur = lire('map-shape-editor.js');
const carte = lire('interactive-map.js');
const fit = lire('map-fit-fix.js');
const css = lire('map-digital-twin.css');

/*
 * TROIS DÉFAUTS TROUVÉS EN CONDUISANT LA CARTE DANS UN NAVIGATEUR, pas en relisant le code.
 * Aucun n'aurait été vu autrement : chacun est une interaction entre des morceaux
 * séparément corrects. Tous rendaient l'édition de zone IMPOSSIBLE — y compris avec
 * l'ancien code, ce qui explique que l'administrateur ne pouvait rien poser sur le plan.
 */

/* ================================================================ 1. l'espace de travail */

test('une image de remplacement de 4 × 4 px ne définit pas l’espace de travail', () => {
  // MESURÉ : sans plan configuré, la plateforme sert un PNG de 4 × 4 px et
  // `settings.mapImageWidth` valait 4. L'ajustement calculait alors
  // baseScale = 792 / 4 = 198, et toute la carte — image, canevas de 2000 × 1200,
  // marqueurs — était rendue dans une scène de QUATRE PIXELS agrandie 198 fois.
  const geo = resolveWorkspaceGeometry({
    naturalWidth: 4, naturalHeight: 4, settingsWidth: 4, settingsHeight: 4
  });
  assert.deepEqual(geo, { width: 2000, height: 1200 });
});

test('un vrai plan garde ses dimensions', () => {
  assert.deepEqual(
    resolveWorkspaceGeometry({ naturalWidth: 3200, naturalHeight: 1800 }),
    { width: 3200, height: 1800 });
  // L'image chargée l'emporte sur les réglages, qui ne servent qu'avant son chargement.
  assert.deepEqual(
    resolveWorkspaceGeometry({ naturalWidth: 1024, naturalHeight: 768, settingsWidth: 2400, settingsHeight: 1000 }),
    { width: 1024, height: 768 });
  // Et les réglages servent tant que l'image n'est pas chargée.
  assert.deepEqual(
    resolveWorkspaceGeometry({ naturalWidth: 0, naturalHeight: 0, settingsWidth: 2400, settingsHeight: 1000 }),
    { width: 2400, height: 1000 });
});

test('le seuil n’écarte que l’absurde, jamais un plan modeste', () => {
  // Un plan tout juste au seuil doit passer : le filtre vise le pixel de remplacement,
  // pas les petits plans.
  const auSeuil = resolveWorkspaceGeometry({ naturalWidth: MIN_PLAN_SIZE, naturalHeight: MIN_PLAN_SIZE });
  assert.deepEqual(auSeuil, { width: MIN_PLAN_SIZE, height: MIN_PLAN_SIZE });
  const sousLeSeuil = resolveWorkspaceGeometry({ naturalWidth: MIN_PLAN_SIZE - 1, naturalHeight: MIN_PLAN_SIZE - 1 });
  assert.deepEqual(sousLeSeuil, { width: 2000, height: 1200 });
});

test('l’ajustement de la carte passe par le contrat, sans recalculer sa propre géométrie', () => {
  assert.match(fit, /import \{ resolveWorkspaceGeometry \} from '\.\/map-coordinates-contract\.js'/);
  // Les dimensions ne doivent plus être prises telles quelles des réglages ni de l'image.
  assert.doesNotMatch(fit, /Number\(settings\.mapImageWidth\) \|\| LEGACY_MAP_WIDTH/);
  assert.doesNotMatch(fit, /const width = image\.naturalWidth \|\| state\.workspace\.width/);
});

/* ================================================================ 2. la barre d'édition */

test('la barre d’édition est posée sur le BODY, jamais dans le plan', () => {
  // MESURÉ : attachée au parent du canevas, ses boutons étaient « visibles, activés et
  // stables » mais HORS DE L'ÉCRAN. Le plan se déplace par `transform`, et un ancêtre
  // transformé devient le bloc conteneur de tout `position: fixed` qu'il abrite : la
  // barre suivait donc le zoom et la translation du plan.
  assert.match(editeur, /document\.body\.appendChild\(hote\)/);
  assert.doesNotMatch(editeur, /canvas\.parentElement \|\| document\.body/);
  assert.match(css, /\.shape-editor-bar\{position:fixed/);
});

test('la barre passe au-dessus de la carte et sous l’écran de démarrage', () => {
  const z = Number(css.match(/\.shape-editor-bar\{[^}]*z-index:(\d+)/)?.[1] || 0);
  assert.ok(z > 2147482100, `barre sous la barre d’outils de la carte (z=${z})`);
  assert.ok(z < 2147483000, `barre au-dessus de l’écran de démarrage (z=${z})`);
});

test('les cibles tactiles de la barre restent atteignables', () => {
  assert.match(css, /\.shape-editor-bar button\{min-height:36px/);
  // Et sur téléphone la barre s'étale au lieu de déborder.
  assert.match(css, /@media\(max-width:640px\)\{\s*\.shape-editor-bar/);
});

/* ================================================================ 3. le geste atteint le plan */

test('LES DEUX couches qui recouvrent le canevas cessent d’intercepter les clics', () => {
  /*
   * MESURÉ, deux fois, à un an d'intervalle.
   *
   * D'abord : `elementsFromPoint` au centre du plan rendait [div#map-hotspots, canvas, …].
   * Le canevas était DEUXIÈME et recevait zéro événement de souris. D'où cette liste.
   *
   * Puis C3 a fait de la ZONE documentée elle-même la cible du clic, en posant
   * `svg#map-shape-hits` par-dessus le plan. `elementsFromPoint` rend désormais
   * [svg#map-shape-hits, canvas#areas-canvas, …] : la nouvelle couche passe DEVANT, et
   * cette épreuve, qui exigeait la liste d'UNE seule couche, a scellé le défaut au lieu de
   * l'attraper. Mesuré dans Chromium : un glisser complet ne traçait plus aucune forme —
   * `shape()` rendait `null` — et le mode édition ne permettait plus de dessiner du tout.
   *
   * On exige donc les DEUX, sans figer l'ordre ni la ponctuation de la liste.
   */
  assert.match(editeur, /couche\.style\.pointerEvents = 'none'/);
  // Un tableau VIDE (l'éditeur de forme imbriquée, sur le canevas d'une photo de salle/baie
  // — jamais `#areas-canvas`) déclare honnêtement qu'il n'a rien à neutraliser : il ne
  // relève pas du défaut que cette épreuve garde, propre au canevas PARTAGÉ du plan général.
  const listes = [...carte.matchAll(/overlays:\s*\[([^\]]*)\]/g)]
    .map(trouve => trouve[1])
    .filter(liste => liste.trim().length > 0);
  assert.ok(listes.length >= 1, 'la carte doit déclarer les couches à neutraliser');
  for (const liste of listes) {
    assert.match(liste, /#map-hotspots/);
    assert.match(liste, /#map-shape-hits/);
  }
  // Et l'état d'origine est RESTITUÉ, y compris la chaîne vide : écrire 'auto' à la place
  // imposerait un style en ligne que la feuille ne pourrait plus contredire.
  assert.match(editeur, /couche\.style\.pointerEvents = couche\.dataset\.shapeEditorPe/);
  assert.match(editeur, /delete couche\.dataset\.shapeEditorPe/);
});

test('le déplacement du plan cède le geste à l’édition', () => {
  // MESURÉ : `container.setPointerCapture()` détournait tous les événements suivants.
  // Le canevas recevait un `mousedown` puis plus rien, et le `mouseup` était rapporté aux
  // MÊMES coordonnées que l'appui — donc une forme de largeur nulle, rejetée en silence.
  // Après correction : 13 points reçus, appui (700, 420), relâche (1200, 744), 11 mouvements.
  assert.match(fit, /if \(document\.body\.dataset\.shapeEditing === '1'\) return;/);
  assert.match(editeur, /document\.body\.dataset\.shapeEditing = '1'/);
  assert.match(editeur, /delete document\.body\.dataset\.shapeEditing/);
  // Le drapeau est posé DANS `attacher` et retiré DANS `detacher` : posé ailleurs, il
  // survivrait à la fermeture et le plan resterait indéplaçable.
  const attacher = editeur.slice(editeur.indexOf('function attacher()'), editeur.indexOf('function detacher()'));
  assert.match(attacher, /dataset\.shapeEditing = '1'/);
});

test('la relâche est écoutée sur le document, pas sur le canevas', () => {
  // Relâcher hors du plan laissait sinon un geste en cours, et la forme suivait le
  // curseur indéfiniment.
  assert.match(editeur, /document\.addEventListener\('mouseup', surRelache\)/);
  assert.match(editeur, /document\.removeEventListener\('mouseup', surRelache\)/);
});

/* ================================================================ l'éditeur lui-même */

test('les deux anciens éditeurs partiels ont disparu', () => {
  // `editArea` ne savait que TRACER un rectangle sans jamais pouvoir le reprendre ;
  // `resizeArea` posait UNE SEULE poignée, au coin bas-droit.
  assert.doesNotMatch(carte, /function drawResizeHandles/);
  assert.doesNotMatch(carte, /resizeHandle === 'se'/);
  assert.match(carte, /function resizeArea\(type, id\) \{ editArea\(type, id\); \}/);
  assert.match(carte, /openShapeEditor\(obj, \{/);
});

test('un second éditeur ne peut pas se superposer au premier', () => {
  // Deux jeux d'écouteurs sur le canevas, et la forme suivrait deux gestes à la fois.
  assert.match(carte, /editeurForme\?\.close\(\)/);
});

test('l’enregistrement rafraîchit la liste en mémoire', () => {
  // Sans cela, le plan continue d'afficher l'ancienne forme jusqu'au rechargement complet
  // — exactement le symptôme « mes ajouts n'apparaissent pas » signalé par le client.
  assert.match(carte, /const index = liste\.findIndex\(item => String\(item\.id\) === String\(entite\.id\)\)/);
  assert.match(carte, /if \(index > -1\) liste\[index\] = /);
});

test('le plan dessine les formes, pas seulement des rectangles', () => {
  // Le rendu lisait `entity.rect` : un cercle se serait affiché comme le carré de sa
  // boîte englobante, et un polygone comme le rectangle qui l'entoure — la forme perdue
  // à l'affichage tout en restant correcte en base, le pire des deux mondes.
  assert.match(carte, /function drawEntityShape\(entity/);
  assert.doesNotMatch(carte, /if \(room\.rect\) drawRect\(room\.rect/);
  assert.doesNotMatch(carte, /if \(baie\.rect\) drawRect\(baie\.rect/);
  assert.match(carte, /rooms\.forEach\(room => drawEntityShape\(room/);
});

test('les trois outils et les gestes annoncés existent', () => {
  for (const outil of ['rect', 'circle', 'polygon']) {
    assert.match(editeur, new RegExp(`data-outil="${outil}"`), `outil ${outil} absent`);
  }
  for (const action of ['polygoniser', 'agrandir', 'reduire', 'effacer', 'valider', 'annuler']) {
    assert.match(editeur, new RegExp(`data-action="${action}"`), `action ${action} absente`);
  }
  // Ajouter un point en tirant une arête, en retirer un par Alt+clic.
  assert.match(editeur, /geste\.poignee\.kind === 'edge'/);
  assert.match(editeur, /event\.altKey && poignee\.kind === 'vertex'/);
});

test('changer d’outil n’efface pas la zone déjà tracée', () => {
  // Perdre une zone sur un clic d'outil serait une perte silencieuse de travail.
  const gestionnaire = editeur.slice(editeur.indexOf('if (bouton.dataset.outil)'), editeur.indexOf("case 'polygoniser'"));
  assert.doesNotMatch(gestionnaire, /forme = null/);
});
