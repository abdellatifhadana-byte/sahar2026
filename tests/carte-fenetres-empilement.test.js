import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/*
 * LA CARTE AVAIT DÉPASSÉ SES PROPRES FENÊTRES.
 *
 * Mesuré dans le navigateur, carte ouverte : `#map-modal` occupe tout l'écran
 * (1600 × 950) à `z-index: 2147482000`, et la couche « jumeau numérique » empile
 * par-dessus l'écran d'accueil (2147482500), le bouton du centre de commande
 * (2147482200), la barre d'outils (2147482100), le fil d'Ariane et les aides
 * (2147482050).
 *
 * Les fenêtres ouvertes DEPUIS la carte, elles, étaient restées aux valeurs d'avant
 * cette couche : 99999 pour « Ajouter un équipement » et pour la fenêtre de
 * coordonnées, 100500 pour l'édition d'entité.
 *
 * Conséquence exacte, rapportée par le propriétaire puis reproduite : « نافذة إضافة
 * جهاز لا تظهر على الخريطة، تظهر وراء صفحة الخريطة ». Le bouton semblait ne rien
 * faire. Rien n'était cassé — la fenêtre s'ouvrait bel et bien, sous un élément
 * plein écran.
 *
 * Ce test CALCULE la comparaison au lieu de chercher des chaînes : il extrait le
 * plafond réel du décor de la carte, extrait la valeur du jeton, et compare. Si
 * quelqu'un relève un z-index dans `map-digital-twin.css` sans relever le jeton, ce
 * test tombe — ce qu'aucune garde textuelle n'aurait fait.
 */

const zIndexDe = source => [...source.matchAll(/z-index\s*:\s*(\d+)/g)].map(m => Number(m[1]));

/** La valeur du jeton, telle qu'elle est réellement déclarée. */
function jeton() {
  const trouve = lire('main.css').match(/--z-carte-fenetre\s*:\s*(\d+)/);
  assert.ok(trouve, 'le jeton --z-carte-fenetre n’est pas déclaré dans main.css');
  return Number(trouve[1]);
}

/** Le décor de la carte : tout sauf le menu contextuel, qui doit rester au sommet. */
function plafondDuDecor() {
  const feuille = lire('map-digital-twin.css');
  const menu = feuille.match(/#admin-context-menu[^{]*\{[^}]*z-index\s*:\s*(\d+)/);
  assert.ok(menu, 'le menu contextuel de la carte est introuvable');
  const contextuel = Number(menu[1]);
  const decor = zIndexDe(feuille).filter(z => z !== contextuel);
  const carte = zIndexDe(lire('interactive-map.js')).filter(z => z < 1e9);
  return { plafond: Math.max(...decor), contextuel, plafondCarte: Math.max(...carte) };
}

/* ============================================ le calcul, pas la chaîne */

test('le jeton passe AU-DESSUS de tout le décor de la carte', () => {
  const { plafond } = plafondDuDecor();
  assert.ok(jeton() > plafond,
    `jeton ${jeton()} ≤ plafond du décor ${plafond} : une fenêtre s’ouvrirait derrière la carte`);
});

test('…et sous le menu contextuel, qui doit rester au sommet', () => {
  // Un menu au clic droit qui passerait SOUS une fenêtre serait le défaut inverse.
  const { contextuel } = plafondDuDecor();
  assert.ok(jeton() < contextuel, `jeton ${jeton()} ≥ menu contextuel ${contextuel}`);
});

test('le plein écran de la carte est bien ce qui masquait les fenêtres', () => {
  // `#map-modal` à 2147482000 couvre tout l'écran : c'est lui, et non un empilement
  // subtil, qui rendait la fenêtre invisible. La preuve chiffrée reste dans le test.
  const feuille = lire('map-digital-twin.css');
  const plein = feuille.match(/#map-modal[^{]*\{[^}]*z-index\s*:\s*(\d+)/);
  const valeur = plein ? Number(plein[1]) : Math.max(...zIndexDe(feuille));
  assert.ok(valeur > 100500, `l’ancienne valeur 100500 aurait suffi (décor à ${valeur})`);
  assert.ok(jeton() > valeur);
});

/* ============================================ plus aucun nombre magique */

test('aucune fenêtre de la carte ne porte encore une valeur écrite à la main', () => {
  // C'étaient TROIS nombres différents pour un même besoin : 99999, 99999, 100500.
  // Un quatrième aurait reproduit le défaut qu'on corrige.
  for (const fichier of ['interactive-map.js', 'map-admin-entity-edit.js']) {
    const source = lire(fichier);
    for (const ancien of ['99999', '100500']) {
      assert.doesNotMatch(source, new RegExp(`z-index\\s*:\\s*${ancien}`),
        `${fichier} porte encore z-index: ${ancien}`);
    }
  }
});

test('les trois fenêtres lisent LE MÊME jeton', () => {
  const carte = lire('interactive-map.js');
  const edition = lire('map-admin-entity-edit.js');
  assert.equal((carte.match(/--z-carte-fenetre/g) || []).length, 2,
    'les deux fenêtres de interactive-map.js ne lisent pas toutes le jeton');
  assert.match(edition, /--z-carte-fenetre/);
});

test('chaque usage garde une valeur de repli identique au jeton', () => {
  // `var()` sans repli rend `auto` si la feuille n'a pas chargé : la fenêtre
  // repasserait derrière la carte, exactement comme avant.
  const attendu = jeton();
  for (const fichier of ['interactive-map.js', 'map-admin-entity-edit.js']) {
    for (const m of lire(fichier).matchAll(/--z-carte-fenetre\s*,\s*(\d+)\s*\)/g)) {
      assert.equal(Number(m[1]), attendu, `repli ${m[1]} ≠ jeton ${attendu} dans ${fichier}`);
    }
    const usages = (lire(fichier).match(/--z-carte-fenetre/g) || []).length;
    const replis = [...lire(fichier).matchAll(/--z-carte-fenetre\s*,\s*\d+\s*\)/g)].length;
    assert.equal(replis, usages, `${fichier} : un usage du jeton est sans repli`);
  }
});

/* ============================================ le décor de la carte reste cohérent */

test('la carte elle-même n’a pas été relevée par mégarde', () => {
  // `interactive-map.js` porte le conteneur à 9999 et ses couches internes sous 100.
  // Les relever casserait l'ordre interne de la carte sans rien résoudre.
  const { plafondCarte } = plafondDuDecor();
  assert.equal(plafondCarte, 9999, `le conteneur de la carte est passé à ${plafondCarte}`);
});

/* ══════════ LES COUCHES QUI RECOUVRENT LE CANEVAS PENDANT UNE ÉDITION ══════════
 *
 * MESURÉ dans Chromium, plan ouvert : `document.elementsFromPoint` au milieu du plan rend
 *
 *     [ svg#map-shape-hits, canvas#areas-canvas, img#main-map-img, … ]
 *
 * La couche des ZONES CLIQUABLES est PREMIÈRE — depuis C3, qui a fait de la zone
 * documentée elle-même la cible du clic. Les deux éditeurs qui dessinent sur le canevas ne
 * neutralisaient qu'`#map-hotspots`, écrit avant cette couche : `svg#map-shape-hits`
 * avalait donc chaque appui.
 *
 * Conséquences mesurées, les deux muettes : un glisser complet ne traçait AUCUNE forme
 * (`shape()` rendait `null`), et pas un seul point de tracé ne pouvait être posé (la liste
 * de points restait vide). Rien n'était cassé à l'écran — simplement, plus rien ne
 * répondait, et aucun message ne disait pourquoi.
 */
test('les deux éditeurs du canevas neutralisent LES DEUX couches qui le recouvrent', () => {
  const carte = lire('interactive-map.js');
  /*
   * Un troisième `overlays:` est apparu avec l'éditeur de forme IMBRIQUÉE (baie/équipement
   * sur la photo de sa salle ou de sa baie) : son canevas n'est PAS `#areas-canvas`, donc ni
   * `#map-hotspots` ni `#map-shape-hits` ne le recouvrent — il n'a RIEN à neutraliser, et le
   * déclare par un tableau VIDE plutôt que d'en omettre un que personne ne lirait. Seuls les
   * tableaux non vides relèvent du défaut que ce test garde : un éditeur du canevas PARTAGÉ
   * qui en oublierait une.
   */
  const listes = [...carte.matchAll(/overlays:\s*\[([^\]]*)\]/g)]
    .map(trouve => trouve[1])
    .filter(liste => liste.trim().length > 0);
  assert.equal(listes.length, 2, 'deux éditeurs dessinent sur le canevas PARTAGÉ : la forme du plan général et le tracé');
  for (const liste of listes) {
    assert.match(liste, /#map-hotspots/, 'la couche des marqueurs doit être neutralisée');
    assert.match(liste, /#map-shape-hits/,
      'la couche des zones cliquables recouvre le canevas et lui vole tous les appuis');
  }
});

test('chaque éditeur RESTITUE la valeur d\'origine de chaque couche', () => {
  // Écrire « auto » à la place imposerait un style en ligne que la feuille ne pourrait
  // plus contredire : c'est la valeur EXACTE d'avant, chaîne vide comprise, qui revient.
  for (const [module, marqueur] of [['map-shape-editor.js', 'shapeEditorPe'], ['cable-route-editor.js', 'routeEditorPe']]) {
    const source = lire(module);
    assert.match(source, new RegExp(`dataset\\.${marqueur} = couche\\.style\\.pointerEvents \\|\\| ''`),
      `${module} doit mémoriser la valeur d'origine`);
    assert.match(source, new RegExp(`couche\\.style\\.pointerEvents = couche\\.dataset\\.${marqueur}`),
      `${module} doit la restituer telle quelle`);
  }
});
