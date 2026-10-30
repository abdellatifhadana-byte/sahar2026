import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const css = lire('pilot-technique-preview.css');
const js = lire('pilot-technique-preview.js');
const carte = lire('interactive-map.js');
const fit = lire('map-fit-fix.js');

/*
 * @file PILOTE-UI-01 — la Carte : un inspecteur accosté, sans toucher au moteur.
 *
 * CE QUE CE FICHIER DÉFEND
 * -------------------------
 * `#map-panel` recouvrait le plan EN ENTIER dès qu'on sélectionnait une salle, une baie ou
 * un équipement — le plan restait dans le DOM mais devenait invisible. La correction
 * n'ajoute AUCUNE ligne à `interactive-map.js` ni à `map-fit-fix.js` : elle ne touche QUE la
 * présentation de `#map-panel`, via des sélecteurs structurels et `!important` pour battre
 * les styles en ligne que ces fichiers posent eux-mêmes. Ce test protège cette frontière.
 */

/* ── LE MOTEUR N'EST PAS TOUCHÉ ────────────────────────────────────────────────────── */

test('map-fit-fix.js — la géométrie — ne porte AUCUNE trace de ce lot', () => {
  // Le calcul d'ajustement, le pan, le zoom et la persistance des coordonnées restent
  // hors d'atteinte de la prévisualisation : pas d'import, pas de classe, pas d'appel.
  assert.doesNotMatch(fit, /pilot/i);
});

/*
 * LA SEULE COUTURE ADMISE DANS LE MOTEUR : LE GATING, ET RIEN D'AUTRE
 * -------------------------------------------------------------------
 * Le bandeau de contexte de la salle est construit DANS le gabarit de `openPanel` : il lit
 * `eqs`, `roomWall` et `room.image`, des valeurs locales que seul le moteur possède. Il ne
 * peut donc pas être posé depuis la couche Pilote sans réintroduire un observateur sur
 * `#map-panel`, ou sans passer un rendu par options à une dizaine de sites d'appel.
 *
 * Écrit en dur, il échappait au mode : la classe `pilot-room-context-strip` ne contient pas
 * « pilot-technique », donc l'ancienne assertion la laissait passer, et le bandeau était
 * injecté AUSSI en `?pilote=0` — sans style, puisque toutes ses règles sont scopées
 * `body.pilot-technique-ui`.
 *
 * La frontière défendue est donc resserrée, pas levée : le moteur peut demander au socle
 * S'IL DOIT rendre, il ne peut rien apprendre d'autre du lot. Une seule référence, celle du
 * contrat ; aucune classe Pilote écrite ici ; aucune géométrie, aucun style, aucun
 * `!important` — ceux-là restent l'affaire de la feuille.
 */
test('interactive-map.js ne connaît du lot QUE le contrat de gating', () => {
  const references = [...carte.matchAll(/pilot-technique[\w./-]*/gi)].map(m => m[0]);
  assert.deepEqual(
    [...new Set(references)],
    ['pilot-technique-shell.js', 'pilot-technique-ui'],
    'le moteur ne doit citer que le socle importé et la classe que ce socle interroge'
  );
  assert.match(carte, /import \{[^}]*\bpucesActifs\b[^}]*\} from '\.\/pilot-technique-shell\.js';/);
  // Le nom de la classe n'est cité que dans le commentaire qui explique la couture.
  const sansCommentaires = carte.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(sansCommentaires, /pilot-technique-ui/);
  assert.doesNotMatch(sansCommentaires, /pilot-room-context-strip/);
});

test('le moteur ne pose ni style ni géométrie venus du lot', () => {
  // Bornée à l'appel lui-même : au-delà commence la rangée de boutons du panneau, qui
  // porte ses styles en ligne d'origine et n'a rien à voir avec cette couture.
  const debut = carte.indexOf('pucesActifs([');
  const appel = carte.slice(debut, carte.indexOf('])}', debut) + 3);
  assert.doesNotMatch(appel, /!important|style=|transform|position:|class=/);
  // Ce que l'appel transmet : des faits, pas de la présentation.
  assert.match(appel, /icone: 'fa-server', valeur: eqs\.length/);
});

/* ── LE PANNEAU S'ACCOSTE, IL NE RESSERRE PAS LE PLAN ─────────────────────────────── */

test('le panneau de détail est accosté à droite, à largeur fixe — pas en plein écran', () => {
  const bloc = css.slice(css.indexOf('@media (min-width: 1280px) {'), css.indexOf('LA LÉGENDE'));
  assert.match(bloc, /#map-panel\s*\{[^}]*width:\s*min\(440px,\s*34vw\)\s*!important/);
  assert.match(bloc, /#map-panel\s*\{[^}]*inset:\s*auto 0 0 auto\s*!important/);
});

test('aucune règle Pilote ne cible #main-map-img, #areas-canvas ou #map-hotspots pour leur taille ou leur transform', () => {
  // `#areas-canvas` et `#map-hotspots` ne doivent être RATTACHÉS À AUCUNE règle : ils
  // n'apparaissent que dans les commentaires expliquant pourquoi. La recherche directe du
  // sélecteur, ouvrant un bloc, est sans ambiguïté — contrairement à un motif `[^{]*` qui
  // peut sauter par-dessus un commentaire jusqu'à un bloc sans rapport, plus loin.
  for (const cible of ['#areas-canvas', '#map-hotspots']) {
    for (const forme of [`${cible} {`, `${cible}{`, `${cible},`]) {
      assert.ok(!css.includes(forme), `${cible} apparaît comme sélecteur (« ${forme} ») — il ne devrait jamais être ciblé`);
    }
  }
  // `#main-map-img` porte UNE règle légitime : un filtre de teinte. Elle seule doit exister.
  const regleImg = css.match(/#main-map-img\s*\{([^}]*)\}/);
  assert.ok(regleImg, 'la règle de #main-map-img a disparu');
  assert.doesNotMatch(regleImg[1], /\b(width|height|transform)\s*:/,
    '#main-map-img ne doit recevoir qu\'un filtre de teinte, jamais une mesure');
});

/* ── LA BARRE D'OUTILS SUIT LE PANNEAU, ELLE NE LE RECOUVRE PAS ───────────────────── */

test('la barre d’outils se décale quand le panneau est ouvert, via :has() sur l’attribut que le moteur bascule déjà', () => {
  assert.match(css, /#map-container:has\(#map-panel\[style\*="display:\s?flex"\]\)\s*#map-toolbar/);
  // Le moteur bascule bien `panel.style.display` entre 'flex' et 'none' — c'est CE
  // comportement, déjà présent, que la règle CSS lit ; elle n'en ajoute aucun.
  assert.match(carte, /panel\.style\.display\s*=\s*["']flex["']/);
  assert.match(carte, /panel\.style\.display\s*=\s*["']none["']/);
});

/* ── LA LÉGENDE DIT LA VÉRITÉ : LES MÊMES COULEURS QUE LE MOTEUR DESSINE ──────────── */

test('chaque couleur de la légende est celle que interactive-map.js peint réellement pour ce type de repère', () => {
  const bloc = js.slice(js.indexOf('const LEGENDE_CARTE'), js.indexOf('const LEGENDE_CARTE') + 500);
  const paires = [...bloc.matchAll(/couleur:\s*'(#[0-9a-f]{6})',\s*texte:\s*'([^']+)'/g)]
    .map(([, couleur, texte]) => ({ couleur, texte }));
  assert.ok(paires.length >= 4, 'la légende doit couvrir salle, baie, équipement OK et équipement en panne');

  for (const { couleur } of paires) {
    assert.match(carte, new RegExp(couleur.replace('#', '#')),
      `la couleur ${couleur} de la légende n'apparaît nulle part dans le moteur de la carte`);
  }
});

test('la légende ne fabrique aucun état — seuls les quatre repères réellement dessinés par le moteur', () => {
  const bloc = js.slice(js.indexOf('const LEGENDE_CARTE'), js.indexOf('const LEGENDE_CARTE') + 500);
  const textes = [...bloc.matchAll(/texte:\s*'([^']+)'/g)].map(([, t]) => t);
  assert.deepEqual(textes, ['Salle', 'Baie', 'Équipement opérationnel', 'Équipement en panne']);
});

/* ── AUCUN MODE DE CARTE FABRIQUÉ ──────────────────────────────────────────────────── */

test('aucun mode de vue inventé (3D, satellite, thermique) n’est ajouté à la carte', () => {
  for (const motif of [/\b3D\b/i, /satellite/i, /thermal|thermique/i, /live.?telemetry/i]) {
    assert.doesNotMatch(css, motif, `mode de carte non implémenté détecté : ${motif}`);
    assert.doesNotMatch(js, motif, `mode de carte non implémenté détecté : ${motif}`);
  }
});

/* ── LA CASCADE : LE PANNEAU ACCOSTÉ GAGNE RÉELLEMENT CONTRE LE GABARIT EN LIGNE ──── */

test('la reprise de #map-panel porte bien !important — sans lui elle perdrait contre le style en ligne posé par interactive-map.js', () => {
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui #map-panel {'), css.indexOf('body.pilot-technique-ui #map-panel {') + 400);
  for (const prop of ['width', 'height', 'inset']) {
    assert.match(bloc, new RegExp(`${prop}:[^;]*!important`),
      `${prop} doit être !important : un style en ligne (via .style.cssText / .innerHTML) ne cède qu'à cela`);
  }
});
