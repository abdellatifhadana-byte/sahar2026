/**
 * @file tests/map-coordinate-edit-wiring-p0b.test.js — P0-B : le contrat pur
 *       `map-coordinate-edit-session.js` est réellement câblé dans `interactive-map.js`.
 *
 * POURQUOI DES ÉPREUVES DE SOURCE ICI
 * ------------------------------------
 * `interactive-map.js` construit un modal complet (canvas, glisser-déposer à la souris,
 * innerHTML, fil d'Ariane) : le monter dans Node exigerait un DOM complet, et un DOM
 * reconstruit à la main pour l'occasion serait lui-même une source d'erreurs — le contrat
 * risquerait de se prouver contre son propre décor plutôt que contre le code réel.
 *
 * Les deux décisions les plus sensibles — QUAND abandonner une session, QUOI dire après une
 * sauvegarde partielle — ont donc été extraites dans `map-coordinate-edit-outcome.js`, pur
 * et sans DOM, et sont exécutées pour de vrai dans
 * `tests/map-coordinate-edit-outcome.test.js`. ICI, on ne pin que le CÂBLAGE : que
 * `interactive-map.js` appelle bien ces fonctions, aux bons endroits, avec les bons champs
 * — et que l'ancien défaut (Annuler qui ne restaure rien, Enregistrer qui pousse TOUT)
 * n'est plus dans le source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');

/* ═══════════ 1 · Le contrat existant n'est pas réécrit, seulement importé ═══════════ */

test('P0-B : le contrat pur de session est importé tel quel, jamais réécrit', () => {
  assert.match(source,
    /import\s*\{\s*createCoordinateEditSession,\s*saveCoordinateEditSession\s*\}\s*from\s*['"]\.\/map-coordinate-edit-session\.js['"]/,
    'createCoordinateEditSession/saveCoordinateEditSession doivent venir du contrat existant');
  assert.match(source,
    /import\s*\{\s*coordinateEditViewMatches,\s*describeCoordinateSaveOutcome\s*\}\s*from\s*['"]\.\/map-coordinate-edit-outcome\.js['"]/,
    'les deux décisions pures doivent venir de map-coordinate-edit-outcome.js');
  // Le fichier n'est pas dupliqué sous un autre nom dans interactive-map.js : une seule
  // fonction `createCoordinateEditSession` existe dans tout le dépôt, celle importée.
  assert.doesNotMatch(source, /function\s+createCoordinateEditSession/,
    'la session ne doit pas être redéfinie localement');
});

/* ═══════════ 2 · Salle : une session scoped à la scène, sur les seuls champs suivis ═══════════ */

test('P0-B Salle : « Modifier les positions » ouvre une session sur x_inRoom/y_inRoom, scène courante', () => {
  assert.match(source,
    /document\.getElementById\('edit-coords-btn'\)\.onclick = \(\) => \{\s*beginCoordinateSession\('room',\s*room\.id,\s*eqs,\s*\['x_inRoom',\s*'y_inRoom'\]\)/,
    'la session Salle doit être ouverte sur les équipements de la scène (eqs) et les deux champs suivis');
});

test('P0-B Salle : le glisser-déposer marque la fiche sale après l’avoir mutée', () => {
  const bloc = source.slice(source.indexOf("pointKeys: ['x_inRoom', 'y_inRoom']"), source.indexOf("// عرض باي"));
  assert.match(bloc, /eq\.x_inRoom\s*=[\s\S]{0,80}eq\.y_inRoom\s*=[\s\S]{0,80}coordinateSession\?\.markDirty\(eq\)/,
    'markDirty doit être appelé APRÈS la mutation des deux coordonnées, pas avant');
});

test('P0-B Salle : le glisser-déposer exige une session active pour CETTE salle', () => {
  const bloc = source.slice(source.indexOf("pointKeys: ['x_inRoom', 'y_inRoom']"), source.indexOf("// عرض باي"));
  assert.match(bloc, /draggable:\s*droitsCarte\.equipment\.edit\s*&&\s*dragMode\s*&&\s*!locked\s*&&\s*coordinateSessionMatches\('room',\s*room\.id\)/,
    'sans session active pour cette salle, aucun glisser-déposer ne doit être possible');
});

/* ═══════════ 3 · Baie : même garantie, sur x_inBaie/y_inBaie ═══════════ */

test('P0-B Baie : « Modifier les positions » ouvre une session sur x_inBaie/y_inBaie, scène courante', () => {
  assert.match(source,
    /document\.getElementById\('edit-coords-btn'\)\.onclick = \(\) => \{\s*beginCoordinateSession\('baie',\s*baie\.id,\s*eqs,\s*\['x_inBaie',\s*'y_inBaie'\]\)/,
    'la session Baie doit être ouverte sur les équipements de la scène (eqs) et les deux champs suivis');
});

test('P0-B Baie : le glisser-déposer marque la fiche sale après l’avoir mutée', () => {
  const bloc = source.slice(source.indexOf("pointKeys: ['x_inBaie', 'y_inBaie']"));
  assert.match(bloc, /eq\.x_inBaie\s*=[\s\S]{0,80}eq\.y_inBaie\s*=[\s\S]{0,80}coordinateSession\?\.markDirty\(eq\)/,
    'markDirty doit être appelé APRÈS la mutation des deux coordonnées, pas avant');
});

test('P0-B Baie : le glisser-déposer exige une session active pour CETTE baie', () => {
  const bloc = source.slice(source.indexOf("pointKeys: ['x_inBaie', 'y_inBaie']"));
  assert.match(bloc, /draggable:\s*droitsCarte\.equipment\.edit\s*&&\s*dragMode\s*&&\s*!locked\s*&&\s*coordinateSessionMatches\('baie',\s*baie\.id\)/,
    'sans session active pour cette baie, aucun glisser-déposer ne doit être possible');
});

/* ═══════════ 4 · Annuler est un VRAI rollback : restore(), jamais db.save ═══════════ */

test('P0-B : cancelCoordinateSession restaure et ne pousse jamais un db.save', () => {
  const debut = source.indexOf('function cancelCoordinateSession()');
  assert.ok(debut > -1, 'cancelCoordinateSession doit exister');
  const fin = source.indexOf('\n  }', debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /coordinateSession\.restore\(\)/, 'un abandon doit restaurer via le contrat, pas une réécriture ad hoc');
  assert.doesNotMatch(corps, /db\.save/, 'annuler ne doit JAMAIS écrire — c’est un rollback, pas un enregistrement');
});

test('P0-B : le bouton Annuler des deux panneaux appelle cancelCoordinateSession, sans autre chemin de restauration', () => {
  // Un seul câblage partagé (`wireCoordinateSaveCancel`) sert Salle ET Baie : une seule
  // écriture de la restauration, jamais deux copies qui pourraient diverger.
  const occurrencesDefinition = (source.match(/function wireCoordinateSaveCancel/g) || []).length;
  assert.equal(occurrencesDefinition, 1, 'la logique Enregistrer/Annuler ne doit être écrite qu’une seule fois');
  assert.match(source, /if\s*\(cancelButton\)\s*cancelButton\.onclick\s*=\s*\(\)\s*=>\s*\{\s*cancelCoordinateSession\(\)/,
    'le clic sur Annuler doit appeler cancelCoordinateSession');
  assert.match(source, /wireCoordinateSaveCancel\('room', id\)/, 'le panneau Salle doit réutiliser le câblage partagé');
  assert.match(source, /wireCoordinateSaveCancel\('baie', id\)/, 'le panneau Baie doit réutiliser le câblage partagé');
});

/* ═══════════ 5 · Enregistrer ne pousse QUE les fiches sales ═══════════ */

test('P0-B : Enregistrer appelle saveCoordinateEditSession — l’ancienne boucle inconditionnelle a disparu', () => {
  assert.match(source,
    /saveCoordinateEditSession\(session,\s*record\s*=>\s*db\.save\('equipments',\s*record\)\)/,
    'la sauvegarde doit passer par le contrat, qui ne pousse que les fiches sales');
  /*
   * L'ANCIEN DÉFAUT, NOMMÉMENT INTERDIT : `for (let eq of eqs) await db.save('equipments', eq)`
   * poussait TOUTE la scène, y compris les fiches jamais déplacées — donc aussi un brouillon
   * en cours dans une AUTRE scène si `eqs` le contenait encore. Sa disparition du source est
   * la preuve que Save All comme le panneau ne l'utilisent plus pour les coordonnées.
   */
  assert.doesNotMatch(source, /for\s*\(let\s+eq\s+of\s+eqs\)\s*await\s+db\.save\('equipments',\s*eq\)/,
    'la boucle inconditionnelle sur TOUTE la scène ne doit plus exister');
});

test('P0-B : un succès complet clôt la session ; un résultat partiel ou en échec la laisse active', () => {
  const debut = source.indexOf('if (saveButton) saveButton.onclick');
  const fin = source.indexOf('if (cancelButton)', debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /if\s*\(result\.status === 'success'\)\s*endCoordinateSession\(\)/,
    'seul un succès complet doit clore la session (endCoordinateSession, sans restauration)');
  // Le message vient du contrat pur, jamais recomposé ici en double.
  assert.match(corps, /describeCoordinateSaveOutcome\(result\)/);
  assert.doesNotMatch(corps, /'Toutes les modifications ont été enregistrées\.'/,
    'ce libellé est celui de Save All ; il ne doit jamais s’appliquer à un résultat partiel de coordonnées');
});

/* ═══════════ 6 · Save All ne peut pas dépasser une session active ═══════════ */

test('P0-B : Save All refuse de s’exécuter tant qu’une session de coordonnées est active', () => {
  const debut = source.indexOf("document.getElementById('save-all-btn').onclick");
  assert.ok(debut > -1);
  const fin = source.indexOf("document.getElementById('export-btn')", debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /if\s*\(coordinateSession\)\s*\{[\s\S]{0,220}return;\s*\}/,
    'un garde explicite doit précéder toute boucle de sauvegarde globale');
  // Le garde doit précéder les boucles, pas les suivre — sans quoi il arriverait trop tard.
  const indexGarde = corps.indexOf('if (coordinateSession)');
  const indexBoucleRooms = corps.indexOf("for (let room of rooms)");
  assert.ok(indexGarde > -1 && indexBoucleRooms > indexGarde,
    'le garde doit précéder la boucle de sauvegarde globale, jamais la suivre');
});

test('P0-B : refreshSaveAllAvailability désactive réellement le bouton, sans ouvrir un second chemin de sauvegarde', () => {
  const debut = source.indexOf('function refreshSaveAllAvailability()');
  const fin = source.indexOf('\n  }', debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /bouton\.disabled\s*=\s*!!coordinateSession/);
  // Recensement : cette fonction est le SEUL endroit qui écrit `.disabled` sur ce bouton.
  const ecritures = (source.match(/save-all-btn['"]\)\.disabled\s*=|save-all-btn['"]\)[\s\S]{0,40}\.disabled\s*=/g) || []);
  assert.ok(ecritures.length <= 1, 'un seul endroit doit décider si Save All est disponible');
});

/* ═══════════ 7 · Chaque sortie de la vue éditée abandonne un brouillon non sauvegardé ═══════════ */

test('P0-B : goBack() abandonne toute session active avant de changer de vue', () => {
  const debut = source.indexOf('function goBack() {');
  const finLigne = source.indexOf('\n', debut);
  const premieresLignes = source.slice(debut, finLigne + 200);
  assert.match(premieresLignes, /function goBack\(\) \{\s*(?:\/\/[^\n]*\n\s*)*cancelCoordinateSession\(\);/,
    '« Retour » doit abandonner la session AVANT de dépiler l’historique');
});

test('P0-B : fermer la carte abandonne toute session active', () => {
  const debut = source.indexOf('const closeMap = ({ notify = true } = {}) => {');
  const fin = source.indexOf('welcome?.remove()', debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /cancelCoordinateSession\(\)/, 'fermer la carte ne doit jamais laisser un brouillon muté survivre');
});

test('P0-B : ouvrir un autre panneau abandonne la session, sauf en ré-ouvrant la MÊME vue', () => {
  const debut = source.indexOf('async function openPanel(type, id');
  const fin = source.indexOf('history.push', debut);
  const corps = source.slice(debut, fin);
  assert.match(corps, /if\s*\(coordinateSession\s*&&\s*!coordinateSessionMatches\(type,\s*id\)\)\s*cancelCoordinateSession\(\);/,
    'seule une navigation vers une AUTRE vue doit abandonner la session ; rouvrir la même vue doit la préserver');
});

/* ═══════════ 8 · Anti-régression : les deux anciennes fabrications inline ont disparu ═══════════ */

test('P0-B : l’ancien Annuler qui ne restaurait rien (juste dragMode=false) a disparu', () => {
  // L'ancien code : `dragMode = false;` suivi immédiatement d'un redraw, SANS restauration,
  // dans le gestionnaire de clic d'Annuler. Le seul `dragMode = false` qui subsiste est
  // celui, interne, d'`endCoordinateSession` — jamais un gestionnaire de clic isolé.
  assert.doesNotMatch(source,
    /cancel-coords-btn['"]\)\.onclick = \(\) => \{\s*dragMode = false;/,
    'le clic Annuler ne doit plus se contenter de couper dragMode sans restaurer');
});

test('P0-B : l’ancienne injection manuelle de boutons (panel.innerHTML +=) a disparu du câblage de session', () => {
  assert.doesNotMatch(source, /panel\.innerHTML \+=/,
    'les boutons Enregistrer/Annuler doivent venir du rendu normal du panneau (showSaveBtns), pas d’un ajout manuel après coup');
});
