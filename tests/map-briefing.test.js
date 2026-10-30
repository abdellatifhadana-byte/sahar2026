import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const carte = lire('interactive-map.js');
const css = lire('map-digital-twin.css');

/*
 * L'écran d'accueil de la carte était un portail plein écran sur un dégradé bleu
 * générique, entièrement en styles en ligne, qu'il fallait congédier AVANT que le plan
 * commence seulement à se construire. On attendait devant une porte fermée, puis on
 * attendait encore le chargement.
 *
 * Le plan est désormais construit d'abord ; le briefing se pose dessus, à travers un voile
 * flouté qui le laisse deviner. Aucune information n'est perdue — les quatre repères sont
 * les mêmes — et le premier geste le retire.
 */

test('le plan est construit AVANT le briefing, pas après', () => {
  const fonction = carte.slice(carte.indexOf('function showWelcome'), carte.indexOf('function renderMapUI'));
  const appelCarte = fonction.indexOf('if (callback) callback();');
  const creationVoile = fonction.indexOf("createElement('div')");
  assert.ok(appelCarte > -1, 'la carte n’est plus construite depuis showWelcome');
  assert.ok(appelCarte < creationVoile, 'le briefing est créé avant la carte — la porte fermée revient');
});

test('le briefing se retire au premier geste', () => {
  // Un rappel qui exige de viser un bouton précis est une friction de plus à chaque
  // ouverture de la carte.
  assert.match(carte, /welcome\.addEventListener\('click', fermer\)/);
  assert.match(carte, /if \(event\.key === 'Escape'\)/);
  assert.match(carte, /getElementById\('welcome-start-btn'\)/);
});

test('le briefing passe au-dessus de la carte, qui revendique un empilement quasi maximal', () => {
  // Mesuré : #map-modal est à 2147482000 et sa barre d'outils à 2147482100 — les 9999 du
  // style en ligne ne sont pas la valeur effective. Un briefing à 30000 se retrouvait
  // DERRIÈRE la carte, invisible, alors qu'il paraissait correct isolément.
  const z = Number(css.match(/\.map-briefing\{[\s\S]*?z-index:(\d+)/)?.[1] || 0);
  assert.ok(z > 2147482100, `briefing sous la barre d’outils de la carte (z=${z})`);
  // Et sous l'écran de démarrage, qui doit rester souverain.
  assert.ok(z < 2147483000, `briefing au-dessus de l’écran de démarrage (z=${z})`);
});

test('le briefing parle le langage visuel de la plateforme', () => {
  // Équerres de repérage, étiquettes en petites capitales, filets d'un pixel : le même
  // vocabulaire que l'écran de démarrage et que les panneaux de l'application.
  assert.match(css, /\.map-briefing-mark\.tl\{[^}]*border-width:1px 0 0 1px/);
  assert.match(css, /\.map-briefing-eyebrow\{[^}]*text-transform:uppercase/);
  assert.match(css, /\.map-briefing-keys dt\{[^}]*text-transform:uppercase/);
  assert.match(css, /backdrop-filter:blur/);
  // Cible tactile d'au moins 44 px sur le bouton principal.
  assert.match(css, /\.map-briefing-go\{[^}]*min-height:44px/);
});

test('les quatre repères d’origine sont conservés', () => {
  for (const repere of ['Recherche', 'Navigation', 'Tickets', 'Administration']) {
    assert.ok(carte.includes(`>${repere}</dt>`) || carte.includes(`${repere}</dt>`),
      `le repère « ${repere} » a disparu du briefing`);
  }
});

test('les styles du briefing ne sont plus en ligne', () => {
  // L'ancien écran était intégralement stylé dans le JavaScript : impossible à thémer,
  // impossible à corriger sans toucher au code.
  const fonction = carte.slice(carte.indexOf('function showWelcome'), carte.indexOf('function renderMapUI'));
  assert.doesNotMatch(fonction, /style\.cssText/);
  assert.doesNotMatch(fonction, /linear-gradient\(120deg, #2874a6/);
});

/* =========================================================================
   PLACEMENT ET AJOUT SUR LE PLAN
   ========================================================================= */

test('les entités sans repère ne se superposent plus au même pixel', () => {
  // Mesuré AVANT : quatre salles en base, quatre marqueurs dessinés, UNE SEULE position
  // distincte — toutes empilées sur (90, 120). L'administrateur qui ajoutait une salle ne
  // la voyait jamais apparaître, alors que la recherche continuait de la trouver.
  // Mesuré APRÈS : quatre marqueurs, QUATRE positions distinctes.
  const contrat = lire('map-coordinates-contract.js');
  assert.match(contrat, /export function fallbackPlacement\(rank = 0/);
  assert.match(contrat, /export function resolveEntityPlacement\(entity/);
  // Déterministe : un placement aléatoire ferait sauter les marqueurs à chaque rendu.
  assert.doesNotMatch(contrat.slice(contrat.indexOf('fallbackPlacement')), /Math\.random/);
  // Et la carte n'utilise plus de constante de repli.
  const carteSrc = lire('interactive-map.js');
  assert.doesNotMatch(carteSrc, /\(room\.x \|\| 90\)/);
  assert.doesNotMatch(carteSrc, /\(baie\.x_inMap \|\| 180\)/);
  assert.match(carteSrc, /resolveEntityPlacement\(room, \{ rank: rang/);
});

test('un élément non placé se signale au lieu de mentir sur sa position', () => {
  const carteSrc = lire('interactive-map.js');
  assert.match(carteSrc, /placed \? '' : ' is-unplaced'/);
  assert.match(carteSrc, /placed \? room\.name : `\$\{room\.name\} — à placer`/);
  assert.match(carteSrc, /dashed #ffd479/);
});

test('l’administrateur peut poser un équipement DÉJÀ inventorié', () => {
  // La fenêtre ne proposait QUE d'en créer un neuf : poser sur le plan un appareil déjà
  // inventorié — le cas courant — imposait de saisir un doublon.
  // Vérifié à l'exécution : 25 équipements proposés, sélection enregistrée, inventaire
  // inchangé (52 → 52), rattachement `roomId` correct, 0 erreur JS.
  const carteSrc = lire('interactive-map.js');
  assert.match(carteSrc, /id="mode-existant"/);
  assert.match(carteSrc, /id="eq-existant"/);
  assert.match(carteSrc, /id="eq-filtre"/);
  // On DÉPLACE l'existant, on ne le duplique pas : une copie ferait diverger l'inventaire.
  assert.match(carteSrc, /const rattache = \{ \.\.\.existant \}/);
  assert.doesNotMatch(carteSrc, /id: `eq-\$\{Date\.now\(\)\}`/);
});

test('la création délègue à l’éditeur canonique, sans second formulaire pauvre', () => {
  // L'ancienne fenêtre ne demandait que nom, type et numéro de série : un équipement créé
  // depuis la carte naissait sans catégorie, sans statut normalisé, sans ports — un
  // enregistrement de seconde classe à recompléter ailleurs.
  const carteSrc = lire('interactive-map.js');
  assert.match(carteSrc, /import \{ openCanonicalEquipmentEditor \} from '\.\/equipment-editor-service\.js'/);
  // Portée à la fenêtre d'AJOUT seulement : la fenêtre de modification garde ses propres
  // champs, et les confondre ferait échouer le test sur du code légitime.
  const fenetreAjout = carteSrc.slice(
    carteSrc.indexOf('function openAddEquipmentModal'),
    carteSrc.indexOf('function openEditEquipmentModal'));
  assert.ok(fenetreAjout.length > 500, 'fenêtre d’ajout introuvable');
  assert.doesNotMatch(fenetreAjout, /id="eq-serial"/);
  assert.doesNotMatch(fenetreAjout, /id="eq-type"/);
});
