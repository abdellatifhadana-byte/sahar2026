/**
 * @file tests/map-clean-entry-p0d2.test.js — P0-D2 et #170 : la vue d'entrée est propre, et
 *       chaque scène ne montre QUE sa propre géométrie.
 *
 * Deux natures d'épreuves :
 *   · `resolveEntityPlacement` est PUR — exécuté pour de vrai, c'est là que #170 se joue ;
 *   · le rendu DOM d'`interactive-map.js` n'est pas isolable : on l'ancre sur des
 *     expressions nommées, et chaque assertion tombe si la garde correspondante saute.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveEntityPlacement, fallbackPlacement, MAP_SCENES } from '../map-coordinates-contract.js';

const source = readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');
const scene = source.slice(source.indexOf('function drawAreasAndHotspots'), source.indexOf('function drawRect'));

/* ══════════ #170 · la géométrie d'un espace ne fuit pas dans un autre ══════════ */

test('CE·8 — une forme du PLAN ne prime pas sur le repère propre à la scène Salle', () => {
  /*
   * LE DÉFAUT #170. Une baie ne porte QU'UNE forme, tracée sur le plan général. Elle
   * gagnait inconditionnellement, avant même qu'on regarde `x_inRoom/y_inRoom` : dans la
   * scène Salle, la baie s'affichait donc à sa position du PLAN, en ignorant la seule
   * position que quelqu'un ait posée pour cette scène.
   */
  const baie = {
    id: 'b1', name: 'B01',
    shape: { type: 'rect', x: 900, y: 900, w: 40, h: 40 }, // géométrie du PLAN
    x_inRoom: 120, y_inRoom: 64                             // géométrie de la SALLE
  };
  const dansLaSalle = resolveEntityPlacement(baie, { pointKeys: ['x_inRoom', 'y_inRoom'], scene: 'room' });
  assert.deepEqual({ x: dansLaSalle.x, y: dansLaSalle.y, placed: dansLaSalle.placed },
    { x: 120, y: 64, placed: true },
    'la scène Salle doit rendre le repère de la salle, jamais le centroïde de la forme du plan');
});

test('CE·9 — une forme du plan ne prime pas non plus sur le repère de la scène Baie', () => {
  const eq = {
    id: 'e1', shape: { type: 'rect', x: 700, y: 700, w: 30, h: 30 },
    x_inBaie: 18, y_inBaie: 210
  };
  const dansLaBaie = resolveEntityPlacement(eq, { pointKeys: ['x_inBaie', 'y_inBaie'], scene: 'baie' });
  assert.equal(dansLaBaie.x, 18);
  assert.equal(dansLaBaie.y, 210);
});

test('CE·8b — dans une scène contextuelle, une forme SEULE ne place pas l’entité', () => {
  // Transposer un point du plan dans l'espace d'une pièce, ce sont deux référentiels sans
  // rapport : mieux vaut « non positionné » qu'un point faux qui a l'air vrai.
  const baie = { id: 'b2', shape: { type: 'rect', x: 900, y: 900, w: 40, h: 40 } };
  const placement = resolveEntityPlacement(baie, { pointKeys: ['x_inRoom', 'y_inRoom'], scene: 'room' });
  assert.equal(placement.placed, false,
    'sans repère propre à la scène, l’entité est non positionnée — la forme du plan ne compte pas');
});

test('CE·8c — sur le PLAN, la forme reste la géométrie de référence', () => {
  // La règle ne retire rien au plan général : c'est bien là que la forme a un sens.
  const salle = { id: 'r1', shape: { type: 'rect', x: 100, y: 200, w: 60, h: 40 } };
  const surLePlan = resolveEntityPlacement(salle, { pointKeys: ['x', 'y'], scene: 'map' });
  assert.equal(surLePlan.placed, true);
  assert.equal(surLePlan.x, 130, 'centroïde du rectangle en x');
  assert.equal(surLePlan.y, 220, 'centroïde du rectangle en y');
});

test('CE·10 — le repli sur grille ne compte JAMAIS comme une position documentée', () => {
  for (const s of MAP_SCENES) {
    const placement = resolveEntityPlacement({ id: 'x' }, { rank: 3, pointKeys: ['x_inRoom', 'y_inRoom'], scene: s });
    assert.equal(placement.placed, false, `scène ${s} : le repli doit porter placed:false`);
  }
  assert.equal(fallbackPlacement(0).placed, false);
});

test('CE·11 — une scène inconnue retombe sur le plan, jamais sur un comportement indéfini', () => {
  const salle = { id: 'r1', shape: { type: 'rect', x: 100, y: 200, w: 60, h: 40 } };
  assert.deepEqual(resolveEntityPlacement(salle, { pointKeys: ['x', 'y'], scene: 'inconnue' }),
                   resolveEntityPlacement(salle, { pointKeys: ['x', 'y'], scene: 'map' }));
});

test('CE·12 — la position enregistrée est en pixels naturels, jamais en pixels d’affichage', () => {
  // Le repère ne dépend pas de la taille d'affichage : c'est tout l'objet du contrat.
  const eq = { id: 'e1', x_inRoom: 742, y_inRoom: 318 };
  const a = resolveEntityPlacement(eq, { pointKeys: ['x_inRoom', 'y_inRoom'], scene: 'room' });
  const b = resolveEntityPlacement(eq, { pointKeys: ['x_inRoom', 'y_inRoom'], scene: 'room' });
  assert.deepEqual(a, b, 'le résolveur est déterministe et ne consulte aucune dimension d’écran');
  assert.equal(a.x, 742);
});

/* ══════════ P0-D2 · ce que la vue d'entrée montre, et ne montre plus ══════════ */

test('CE·1 — le plan général ne pose AUCUN repère de baie en consultation', () => {
  const vueMap = scene.slice(scene.indexOf('if (view.type === "map")'), scene.indexOf('if (view.type === "room")'));
  const posesBaie = vueMap.indexOf('baies.forEach');
  assert.ok(posesBaie > 0, 'le bloc des baies existe encore — pour le mode édition');
  const gardeEdition = vueMap.indexOf('if (modeEdition) {');
  assert.ok(gardeEdition > 0 && gardeEdition < posesBaie,
    'toute pose de baie sur le plan général doit être SOUS la garde du mode édition');
});

test('CE·2 — le plan général ne pose aucun repère d’équipement', () => {
  const vueMap = scene.slice(scene.indexOf('if (view.type === "map")'), scene.indexOf('if (view.type === "room")'));
  assert.doesNotMatch(vueMap, /equipments\s*\.\s*(filter|forEach)/,
    'aucun équipement ne doit être dessiné au niveau du plan');
});

test('CE·3 — une entité non positionnée n’est pas dessinée en consultation', () => {
  assert.match(scene, /if \(!placement\.placed && !modeEdition\) \{/,
    'la garde qui écarte les non-placés du rendu doit exister');
  assert.match(scene, /nonPositionnes\.push\(/,
    'un non-placé doit rejoindre la liste plutôt que le plan');
});

test('CE·4 et CE·5 — une salle documentée reste cliquable, et se déclare au survol ou au focus', () => {
  assert.match(scene, /discret: !modeEdition/,
    'en consultation, les repères sont discrets');
  const spot = source.slice(source.indexOf('function makeHotspot'), source.indexOf('const ACTE_DU_MENU'));
  assert.match(spot, /spot\.tabIndex = 0/, 'le repère discret doit être atteignable au clavier');
  assert.match(spot, /addEventListener\('focus', montrer\)/, 'le focus clavier doit le révéler');
  assert.match(spot, /addEventListener\('mouseenter', montrer\)/, 'le survol doit le révéler');
  assert.match(spot, /event\.key !== 'Enter' && event\.key !== ' '/, 'Entrée et Espace doivent l’ouvrir');
  assert.match(spot, /setAttribute\('role', 'button'\)/);
  assert.match(spot, /setAttribute\('aria-label'/);
});

test('CE·6 — la scène Salle ne montre que ses baies et ses équipements HORS baie', () => {
  const vueRoom = scene.slice(scene.indexOf('if (view.type === "room")'), scene.indexOf('if (view.type === "baie")'));
  assert.match(vueRoom, /baies\.filter\(b => b\.roomId == room\.id\)/);
  assert.match(vueRoom, /equipments\.filter\(eq => eq\.roomId == room\.id && !eq\.baieId\)/,
    'un équipement monté en baie appartient à la scène de sa baie, pas à celle de la salle');
});

test('CE·7 — la scène Baie ne montre que les équipements de CETTE baie', () => {
  const vueBaie = scene.slice(scene.indexOf('if (view.type === "baie")'));
  assert.match(vueBaie, /equipments\.filter\(eq => eq\.baieId == baie\.id\)/);
  assert.doesNotMatch(vueBaie, /baies\.filter|rooms\.filter/,
    'aucune géométrie de salle ou de plan ne doit entrer dans la scène Baie');
});

test('CE·chrome — formes et repli n’existent qu’en mode édition', () => {
  assert.match(scene, /const modeEdition = dragMode && peutEditerCarte/,
    'le mode édition exige un droit : il ne s’allume pas pour un rôle de consultation');
  const formes = scene.match(/if \(modeEdition && droitsCarte\.\w+\.edit\) (rooms|baies)?\.?forEach|if \(modeEdition && droitsCarte\.\w+\.edit\) drawEntityShape/g) || [];
  assert.ok(formes.length >= 3, `les formes doivent être gardées par le mode édition (${formes.length} trouvées)`);
});

test('CE·tray — les non positionnés sont listés, comptés et ouvrables', () => {
  const tray = source.slice(source.indexOf('function renderNonPositionnes'), source.indexOf('function drawRect'));
  assert.match(tray, /Non positionnés · \$\{liste\.length\}/, 'la liste doit être comptée');
  assert.match(tray, /openPanel\(bouton\.getAttribute\('data-type'\), bouton\.getAttribute\('data-id'\)\)/,
    'chaque entrée doit rester ouvrable');
  assert.match(source, /id="map-non-positionnes"/, 'l’hôte doit exister dans le gabarit');
});

/* ══════════ C3 · la ZONE documentée est la cible, pas un disque caché ══════════ */

test('CE·zone — la forme canonique se transpose en géométrie SVG, sans second format', async () => {
  const { shapeToSvgGeometry } = await import('../map-shape-contract.js');
  assert.deepEqual(shapeToSvgGeometry({ type: 'rect', x: 10, y: 20, w: 100, h: 60 }),
    { tag: 'rect', attrs: { x: 10, y: 20, width: 100, height: 60 } });
  assert.deepEqual(shapeToSvgGeometry({ type: 'circle', center: { x: 50, y: 50 }, r: 30 }),
    { tag: 'circle', attrs: { cx: 50, cy: 50, r: 30 } });
  assert.deepEqual(shapeToSvgGeometry({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 }] }),
    { tag: 'polygon', attrs: { points: '0,0 200,0 200,60' } });
  assert.equal(shapeToSvgGeometry(null), null, 'aucune cible inventée pour une forme vide');
  assert.equal(shapeToSvgGeometry({ type: 'polygon', points: [{ x: 0, y: 0 }] }), null,
    'un polygone sans surface n’est pas une cible');
});

test('CE·zone — une salle À FORME ne reçoit AUCUN repère : c’est la surface qui est cliquable', () => {
  const vueMap = scene.slice(scene.indexOf('if (view.type === "map")'), scene.indexOf('if (view.type === "room")'));
  assert.match(vueMap, /if \(!modeEdition && poserZoneCliquable\(room, \{[\s\S]*?\}\)\) return;/,
    'la zone cliquable doit court-circuiter la pose d’un repère');
});

test('CE·zone — la surface porte le survol, le focus clavier ET le clic', () => {
  const zone = source.slice(source.indexOf('function poserZoneCliquable'), source.indexOf('function drawRect'));
  assert.match(zone, /setAttribute\('fill', 'transparent'\)/, 'au repos, la zone est invisible');
  assert.match(zone, /setAttribute\('tabindex', '0'\)/);
  assert.match(zone, /setAttribute\('role', 'button'\)/);
  assert.match(zone, /setAttribute\('aria-label'/);
  for (const evenement of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click', 'keydown']) {
    assert.ok(zone.includes(`'${evenement}'`), `la zone doit répondre à ${evenement}`);
  }
  assert.match(zone, /event\.key !== 'Enter' && event\.key !== ' '/, 'Entrée et Espace ouvrent la salle');
});

test('CE·zone — l’étiquette se pose au point d’ancrage GARANTI intérieur, pas au centre d’une boîte', () => {
  const zone = source.slice(source.indexOf('function poserZoneCliquable'), source.indexOf('function drawRect'));
  assert.match(zone, /resolveEntityPlacement\(entite, \{ pointKeys: \['x', 'y'\], scene: 'map' \}\)/,
    'sur une salle en L, le centre de la boîte englobante tombe hors de la pièce');
});

test('CE·zone — la couche de zones partage le repère du canevas', () => {
  assert.match(source, /id="map-shape-hits" viewBox="0 0 2000 1200"/,
    'même espace de coordonnées que le canevas : aucune conversion, donc aucune dérive');
  assert.match(source, /if \(zonesCliquables\) zonesCliquables\.innerHTML = '';/,
    'la couche doit être vidée à chaque rendu, sinon les zones s’accumulent');
});

/* ══════════ C4 · le tiroir des non positionnés est un outil d'auteur ══════════ */

test('CE·tray — « Non positionnés » ne s’affiche qu’en mode édition', () => {
  assert.match(scene, /renderNonPositionnes\(modeEdition \? nonPositionnes : \[\]\)/,
    'en consultation, aucun tiroir de qualité de données au-dessus du plan');
});
