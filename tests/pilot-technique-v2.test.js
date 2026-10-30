import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const equipements = lire('equipements.js');
const carte = lire('interactive-map.js');
const css = lire('pilot-technique-preview.css');
const socle = lire('pilot-technique-shell.js');

/*
 * @file PILOTE-UI-01 V2 — l'inspecteur d'équipement en blocs et le bandeau de contexte
 * de la salle sur la carte.
 *
 * Ce fichier éprouve la SOURCE, comme `equipment-panel-mode.test.js` et
 * `context-bar.test.js` le font déjà pour du code qui dépend de `document`/`window` : on lit
 * le texte, on n'exécute pas le module.
 */

/* ── L'INSPECTEUR D'ÉQUIPEMENT NE REMPLACE LA VUE CLASSIQUE QUE SOUS PILOTE-UI ────── */

test('showQuickView bascule sur l’inspecteur SEULEMENT si le corps porte pilot-technique-ui', () => {
  const bloc = equipements.slice(equipements.indexOf('async showQuickView('), equipements.indexOf('renderQuickViewClassique(eq, salles, baies) {'));
  assert.match(bloc, /document\.body\?\.classList\.contains\('pilot-technique-ui'\)/);
  assert.match(bloc, /this\.renderQuickViewInspector\(eq, salles, baies\)/);
  assert.match(bloc, /this\.renderQuickViewClassique\(eq, salles, baies\)/);
});

test('la vue classique porte EXACTEMENT les mêmes champs qu’avant, aucun retiré', () => {
  const classique = equipements.slice(
    equipements.indexOf('renderQuickViewClassique(eq, salles, baies) {'),
    equipements.indexOf('renderQuickViewInspector(eq, salles, baies) {')
  );
  for (const champ of [
    'Nom', 'Nom d’exploitation', 'Type', 'Catégorie', 'Marque', 'Modèle', 'Numéro série',
    'N° d’Immobilisation', 'Statut', 'Salle', 'Rack', 'Adresse IP', 'N° Grille IN/OUT',
    'Date installation', 'Fin garantie', 'Notes', 'QR'
  ]) {
    assert.match(classique, new RegExp(`<b>${champ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</b>`),
      `champ manquant dans la vue classique : ${champ}`);
  }
});

test('l’inspecteur regroupe les MÊMES champs en blocs, sans en inventer de nouveaux', () => {
  const inspecteur = equipements.slice(
    equipements.indexOf('renderQuickViewInspector(eq, salles, baies) {'), equipements.indexOf('async readFile(')
  );
  for (const champ of [
    'Nom', 'Nom d’exploitation', 'Type', 'Catégorie', 'Statut', 'Marque', 'Modèle',
    'Numéro série', 'N° d’Immobilisation', 'Salle', 'Rack', 'Adresse IP', 'N° Grille IN/OUT',
    'Date installation', 'Fin garantie', 'Notes'
  ]) {
    assert.match(inspecteur, new RegExp(`champ\\('${champ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `champ absent de l’inspecteur : ${champ}`);
  }
  // Aucun champ hors de ceux déjà connus de la vue classique ni de eq.* existant.
  assert.doesNotMatch(inspecteur, /champ\('(Ports|Câbles|Relations|Écrans liés|Mur lié|Tickets|Schémas|Procédures|VLAN|Garantie étendue)'/);
});

test('un bloc optionnel entièrement vide ne s’affiche pas ; Aperçu s’affiche toujours', () => {
  const inspecteur = equipements.slice(equipements.indexOf('renderQuickViewInspector(eq, salles, baies) {'), equipements.indexOf('async readFile('));
  assert.match(inspecteur, /toujoursAffiche: true/);
  assert.match(inspecteur, /if \(!bloc\.toujoursAffiche && !rempli\) return '';/);
});

test('une valeur manquante se lit « Non renseigné », jamais un blanc silencieux', () => {
  const inspecteur = equipements.slice(equipements.indexOf('renderQuickViewInspector(eq, salles, baies) {'), equipements.indexOf('async readFile('));
  assert.match(inspecteur, /c\.value === null \? 'Non renseigné' : c\.value/);
});

test('aucun champ n’est inventé : `valeur()` ne retient que ce que l’enregistrement porte déjà', () => {
  const inspecteur = equipements.slice(equipements.indexOf('renderQuickViewInspector(eq, salles, baies) {'), equipements.indexOf('async readFile('));
  assert.match(inspecteur, /const valeur = value => \(value === undefined \|\| value === null \|\| value === ''\) \? null : value;/);
});

/* ── PARITÉ CSS : LES CLASSES QUE L’INSPECTEUR POSE SONT STYLÉES SOUS PILOTE-UI, RIEN AILLEURS ─ */

test('les classes de l’inspecteur ne sont stylées que sous body.pilot-technique-ui', () => {
  for (const classe of ['.pilot-inspector-sections', '.pilot-inspector-block', '.pilot-empty-value']) {
    const motif = new RegExp(`\\.pilot-technique-ui[^{]*${classe.replace('.', '\\.')}`);
    assert.match(css, motif, `${classe} doit être scopée à body.pilot-technique-ui`);
    // Et ne doit jamais apparaître SANS ce scope ailleurs dans la feuille.
    const brut = new RegExp(`(?<!pilot-technique-ui[^{]{0,300})${classe.replace('.', '\\.')}\\s*\\{`);
    assert.doesNotMatch(css, brut, `${classe} apparaît hors du scope pilot-technique-ui`);
  }
});

/* ── LE BANDEAU DE CONTEXTE DE LA SALLE RÉUTILISE DES DONNÉES DÉJÀ CALCULÉES ──────── */

test('le bandeau de la salle ne fait aucun nouvel appel de données : eqs, roomWall et room.image existent déjà avant lui', () => {
  const openPanel = carte.slice(carte.indexOf('function openPanel(type, id'));
  const panelRoom = openPanel.slice(openPanel.indexOf("if (type === 'room') {"), openPanel.indexOf('panel.innerHTML = html;'));
  const posePuces = panelRoom.indexOf('pucesActifs([');
  assert.ok(posePuces > 0, 'le bandeau doit exister dans le panneau salle');
  const avant = panelRoom.slice(0, posePuces);
  assert.match(avant, /eqs = equipments\.filter/);
  assert.match(avant, /const roomWall = walls\.find/);
  // room.image / room.imageUrl sont déjà lus pour <img id="room-detail-image">, avant le bandeau.
  assert.match(avant, /room\.image \|\| room\.imageUrl/);
});

test('le bandeau est informatif, pas un bouton mort : aucun gestionnaire n’est câblé sur ses <span>', () => {
  const bloc = carte.slice(carte.indexOf('pucesActifs(['), carte.indexOf('pucesActifs([') + 700);
  assert.doesNotMatch(bloc, /onclick=/);
  // Le socle qui fabrique réellement les <span> n'en câble aucun non plus.
  const fabrique = socle.slice(socle.indexOf('export function pucesActifs'));
  assert.doesNotMatch(fabrique.slice(0, 700), /onclick=|addEventListener/);
});

/*
 * LE BANDEAU EST UNE SURFACE DE PRÉVISUALISATION, PAS UN AJOUT À L'INTERFACE CLASSIQUE
 * ------------------------------------------------------------------------------------
 * Écrit en dur, il était injecté quel que soit le mode : en `?pilote=0` ses trois spans
 * arrivaient sans aucune règle — les seules qui les stylent sont scopées
 * `body.pilot-technique-ui` — donc en couleur héritée du corps (#22303c) sur le fond
 * sombre de `#map-panel`. Le passage par `pucesActifs()` fait porter la décision au même
 * contrat que Salles et Baies, au lieu d'une seconde détection recopiée ici.
 */
test('la carte n’écrit plus le bandeau en dur : elle passe par le contrat pilote', () => {
  assert.match(carte, /import \{[^}]*\bpucesActifs\b[^}]*\} from '\.\/pilot-technique-shell\.js';/);
  assert.doesNotMatch(
    carte.replace(/<!--[\s\S]*?-->/g, ''),
    /pilot-room-context-strip/,
    'la classe ne doit plus apparaître en dur dans interactive-map.js'
  );
});

test('le contrat rend une chaîne vide hors prévisualisation : rien n’est injecté en classique', () => {
  const fabrique = socle.slice(socle.indexOf('export function pucesActifs'));
  assert.match(fabrique.slice(0, 200), /if \(!enPilote\(\)\) return '';/);
  // `enPilote()` relit la classe du corps à chaque appel : une sortie en cours de session
  // par `?pilote=0` est suivie, elle n'est pas figée au chargement du module.
  const repere = socle.slice(socle.indexOf('export function enPilote'));
  assert.match(repere.slice(0, 200), /document\?\.body\?\.classList\?\.contains\('pilot-technique-ui'\)/);
});

/* ── LA FICHE 360 RÉELLE (operations-suite.js), PAS LE REPLI #equip-quickview-modal ─── */

/**
 * `equipment-component-integration.js` remplace `Equipements.prototype.showQuickView` au
 * chargement du module et ouvre `window.TechOperations.openEquipment360` dès qu'il existe
 * — mesuré au navigateur, c'est TOUJOURS le cas en pratique, puisqu'`operations-suite.js`
 * l'expose au chargement. `#equip-quickview-modal` (SIC-1..) reste un repli sain quand ce
 * global est absent, mais la fiche RÉELLEMENT vue est `#ops-equipment-360` /
 * `.ops-modal`, déjà organisée en blocs avec des données réelles. Ce fichier vérifie
 * qu'elle est habillée par le thème Pilote — la preuve de comportement vit dans
 * `pilote-equipements-carte.mjs` (navigateur réel, hors dépôt).
 */
test('la Fiche 360 réelle (#ops-equipment-360, .ops-modal) est habillée sous body.pilot-technique-ui', () => {
  for (const classe of ['.ops-modal-card', '.ops-modal-head', '.ops-card', '.ops-fact', '.ops-flow-row', '.ops-stat', '.ops-badge']) {
    const motif = new RegExp(`body\\.pilot-technique-ui[^{,]*${classe.replace('.', '\\.')}`);
    assert.match(css, motif, `${classe} doit être stylée sous body.pilot-technique-ui`);
  }
});

test('le fond de la carte de la Fiche 360 utilise le dégradé sombre du Pilote, pas une couleur pleine imprévisible', () => {
  const bloc = css.slice(css.indexOf('.ops-modal-card {'), css.indexOf('.ops-modal-card {') + 300);
  assert.match(bloc, /background: linear-gradient\(180deg,#0c2439,#081a2b\);/);
});
