import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SIDE_PANEL_MIN_WIDTH, PANEL_MODES, PANEL_MODE_CLASSES, BODY_PANEL_CLASS,
  panelMode, applyPanelMode, releasePanelMode
} from '../equipment-panel-mode.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const operations = lire('operations-suite.js');
const css = lire('operations-suite.css');
const arbitrage = lire('design-system.css');

/*
 * LA FICHE 360 CESSE D'ÊTRE UNE FENÊTRE QUI RECOUVRE TOUT.
 *
 * Mesuré avant, sur un écran de 1600 px : une carte de 1180 px posée au milieu, et le
 * tableau des équipements INACCESSIBLE — `elementFromPoint` sur la première ligne rendait
 * la fenêtre, pas la ligne. Pour comparer deux appareils il fallait fermer, retrouver sa
 * ligne, rouvrir. Sur un parc de 448 équipements, c'est le geste le plus répété.
 *
 * Mesuré après : carte de 520 px accostée à droite, tableau « accessible », et le clic sur
 * une autre ligne CHANGE l'équipement sans fermer le panneau.
 */

/* ------------------------------------------------------------------ le mode */

test('le mode dépend de la largeur, avec un seuil net', () => {
  assert.equal(panelMode(1600), PANEL_MODES.SIDE);
  assert.equal(panelMode(SIDE_PANEL_MIN_WIDTH), PANEL_MODES.SIDE);
  assert.equal(panelMode(SIDE_PANEL_MIN_WIDTH - 1), PANEL_MODES.SHEET);
  assert.equal(panelMode(390), PANEL_MODES.SHEET);
});

test('une largeur absente ou absurde retombe sur la feuille, jamais sur rien', () => {
  // Le panneau accosté suppose de la place ; en cas de doute, la feuille montante est le
  // choix qui fonctionne partout.
  for (const valeur of [undefined, null, NaN, 'large', {}, Infinity, -Infinity]) {
    assert.equal(panelMode(valeur), PANEL_MODES.SHEET, `« ${String(valeur)} » mal interprété`);
  }
  // `Infinity` est le seul cas où la garde `Number.isFinite` sert vraiment : pour tous les
  // autres, la comparaison rend déjà « feuille ». Un test de mutation l'a montré en
  // survivant à la suppression de la garde — la couvrir, c'est la rendre réelle.
});

/* ------------------------------------------------------------------ l'application */

function fauxElement() {
  const classes = new Set();
  return {
    dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      valeurs: () => [...classes]
    }
  };
}

test('les deux modes s’excluent : jamais accosté ET montant à la fois', () => {
  // Deux classes posées, et la géométrie dépendrait de l'ordre des règles CSS.
  const modal = fauxElement();
  const body = fauxElement();
  applyPanelMode(modal, PANEL_MODES.SIDE, { body });
  applyPanelMode(modal, PANEL_MODES.SHEET, { body });
  assert.deepEqual(modal.classList.valeurs(), [PANEL_MODE_CLASSES[PANEL_MODES.SHEET]]);
  assert.equal(modal.dataset.panelMode, PANEL_MODES.SHEET);
});

test('la place n’est réservée QUE pour le panneau accosté', () => {
  // Une feuille montante recouvre le bas de l'écran : lui réserver une marge à droite
  // décalerait le contenu pour rien.
  const modal = fauxElement();
  const body = fauxElement();
  applyPanelMode(modal, PANEL_MODES.SIDE, { body });
  assert.equal(body.classList.contains(BODY_PANEL_CLASS), true);
  applyPanelMode(modal, PANEL_MODES.SHEET, { body });
  assert.equal(body.classList.contains(BODY_PANEL_CLASS), false);
});

test('la fermeture libère la place réservée', () => {
  // Sans cela, la classe survit à la dernière fermeture et le contenu reste décalé devant
  // un panneau qui n'existe plus. Vérifié dans le navigateur : 536 px pendant, 36 px après.
  const modal = fauxElement();
  const body = fauxElement();
  applyPanelMode(modal, PANEL_MODES.SIDE, { body });
  releasePanelMode({ body });
  assert.equal(body.classList.contains(BODY_PANEL_CLASS), false);
});

test('un mode inconnu retombe sur la feuille au lieu de ne rien poser', () => {
  const modal = fauxElement();
  const body = fauxElement();
  assert.equal(applyPanelMode(modal, 'plein-écran', { body }), PANEL_MODES.SHEET);
  assert.equal(applyPanelMode(null, PANEL_MODES.SIDE, { body }), null);
});

/* ------------------------------------------------------------------ le contrat DOM */

test('le contrat DOM de la fiche est INTACT — treize modules y accrochent leur contenu', () => {
  // Relations, média, ports de grille, preuves terrain, topologie… observent
  // `#ops-equipment-360` et insèrent dans `.ops-modal-body`. Changer le contenant sans
  // changer le contrat, c'est ne rien casser. Mesuré : 9 cartes internes avant ET après.
  assert.match(operations, /modal\.id = 'ops-equipment-360';/);
  assert.match(operations, /modal\.className = 'ops-modal';/);
  assert.match(operations, /<div class="ops-modal-body ops-360-grid">/);
  // Le mode est AJOUTÉ, il ne remplace pas la classe de base.
  assert.match(operations, /applyPanelMode\(modal, panelMode\(window\.innerWidth\)\)/);
});

test('le clic sur une autre ligne remplace la fiche au lieu d’en empiler une seconde', () => {
  // C'est ce qui permet de passer d'un appareil au suivant sans fermer : mesuré,
  // « CAM 1 » → « CAM 4 », une seule fiche, 9 cartes conservées.
  assert.match(operations, /document\.getElementById\('ops-equipment-360'\)\?\.remove\(\);/);
});

test('les trois chemins de fermeture libèrent la place', () => {
  assert.match(operations, /const fermerFiche = \(\) => \{ modal\.remove\(\); releasePanelMode\(\); \};/);
  assert.match(operations, /\.ops-close'\)\.onclick = fermerFiche;/);
  assert.match(operations, /if \(event\.target === modal\) fermerFiche\(\);/);
  // Échap ferme, quel que soit le mode : le geste attendu, et il manquait.
  assert.match(operations, /if \(event\.key !== 'Escape'/);
  // L'écouteur se retire lui-même : sinon il s'accumule à chaque ouverture de fiche.
  assert.match(operations, /document\.removeEventListener\('keydown', surEchap, true\)/);
});

/* ------------------------------------------------------------------ la mise en page */

test('le fond du panneau accosté laisse passer les clics', () => {
  // LE POINT CENTRAL. Sans cela, le panneau reste une fenêtre modale déguisée : le tableau
  // serait visible mais mort. Mesuré avant : « bloquée par la fiche ». Après : « accessible ».
  const bloc = css.slice(css.indexOf('.ops-modal.is-side-panel{'), css.indexOf('@keyframes ops-panel-in'));
  assert.match(bloc, /pointer-events:none/);
  assert.match(bloc, /\.ops-modal-card\{[\s\S]*?pointer-events:auto/);
  assert.match(bloc, /background:transparent/);
});

test('la grille interne passe à une colonne dans le panneau', () => {
  // `.ops-360-grid` vaut `.85fr 1.15fr`. La requête média existante est fondée sur la VUE :
  // sur un écran large elle ne se déclenche pas, et deux colonnes dans 520 px seraient
  // illisibles. Le passage à une colonne doit donc dépendre du MODE, pas de la fenêtre.
  assert.match(css, /\.ops-modal\.is-side-panel \.ops-360-grid\{grid-template-columns:1fr\}/);
});

test('l’arbitrage de la marge est dans la feuille d’arbitrage, pas dans le composant', () => {
  // Mesuré : `ui-final.css` impose `padding: 30px 36px 44px !important` sur
  // `.admin-content`, ce qui bat la spécificité et neutralise même la règle d'arbitrage.
  // La réserve a donc sa place dans design-system.css, chargée en dernier.
  assert.doesNotMatch(css, /has-equipment-panel[^}]*padding-right/);
  assert.match(arbitrage, /body\.has-equipment-panel \.admin-page \.admin-content/);
  assert.match(arbitrage, /padding-right: min\(536px, calc\(42vw \+ 16px\)\) !important/);
  // Et le `!important` est JUSTIFIÉ sur place, avec l'étape de nettoyage qui le retirera.
  const justification = arbitrage.slice(arbitrage.indexOf('PLACE RÉSERVÉE'), arbitrage.indexOf('body.has-equipment-panel'));
  assert.match(justification, /ui-final\.css/);
  assert.match(justification, /NETTOYAGE SUIVANTE/);
});

test('le mouvement s’arrête quand le mouvement dérange', () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?animation:none/);
});

test('aucune feuille de style n’a été ajoutée pour le panneau lui-même', () => {
  // La dette mesurée était de 35 feuilles et 1 286 `!important` : ajouter une 36e feuille
  // PAR COMPOSANT aggraverait le mal en prétendant le soigner. Le panneau vit dans la
  // feuille de son propre composant, toujours. Le compte est passé à 35 avec
  // `pilot-technique-preview.css` (#PILOTE-UI-01) — un survol opt-in UNIQUE et nommé,
  // pas un nouveau précédent par composant ; voir `design-system.test.js`.
  const html = lire('index.html');
  const feuilles = (html.match(/href="[^"]+\.css"/g) || []).length;
  assert.equal(feuilles, 35, `le nombre de feuilles liées est passé à ${feuilles}`);
  // Et aucune feuille dédiée au panneau : il vit dans celle de son propre composant.
  assert.doesNotMatch(html, /equipment-panel[^"]*\.css/);
  assert.ok(html.lastIndexOf('design-system.css') > html.lastIndexOf('operations-suite.css'),
    'design-system.css n’est plus la dernière feuille arbitrée');
});
