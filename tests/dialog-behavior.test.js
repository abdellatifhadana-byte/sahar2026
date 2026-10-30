import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DIALOG_BEHAVIOR_VERSION, closeDialog, topmostDialog } from '../dialog-behavior.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('dialog-behavior.js');

// Vingt-cinq modules ouvrent des fenêtres, huit seulement géraient la touche Échap.
// Mesuré sur quatre fenêtres représentatives : Échap fermait dans un cas sur quatre, le
// clic sur le fond dans deux. Personne n'était piégé — « Annuler » existe partout — mais
// la règle apprise sur une page ne valait pas sur la suivante.

test('le comportement est installé une seule fois, au niveau du document', () => {
  assert.equal(DIALOG_BEHAVIOR_VERSION, 1);
  assert.match(source, /let installed = false;/);
  assert.match(source, /if \(!target \|\| installed\) return false;/);
  // En phase de capture : une fenêtre qui gère déjà Échap n'est pas court-circuitée.
  assert.match(source, /addEventListener\('keydown'[\s\S]{0,400}\}, true\);/);
  assert.match(source, /if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return;/);
});

test('la fermeture emprunte le chemin propre à la fenêtre', () => {
  // Retirer le nœud directement sauterait le nettoyage de la fenêtre : voile laissé en
  // place, défilement du corps jamais rendu.
  assert.match(source, /const own = dialog\.querySelector\(CLOSE_SELECTOR\)/);
  assert.match(source, /if \(own\) \{ own\.click\(\); \}/);
  assert.match(source, /if \(isVisible\(dialog\)\) dialog\.remove\(\);/);
});

test('aucun voile ne survit à la dernière fenêtre fermée', () => {
  // Un voile orphelin intercepte tous les clics : l'interface paraît gelée.
  assert.match(source, /if \(!openDialogs\(\)\.length\) \{[\s\S]{0,240}app-dialog-backdrop/);
  assert.match(source, /document\.body\.style\.overflow = '';/);
});

test('seul un clic sur le FOND ferme, jamais à l’intérieur du contenu', () => {
  // Sinon une sélection de texte qui déborde du contenu fermerait la fenêtre.
  assert.match(source, /event\.target\.matches\(DIALOG_SELECTOR\) \? event\.target : null/);
  assert.match(source, /addEventListener\('mousedown'/);
});

test('une fenêtre peut refuser la fermeture automatique', () => {
  // Un assistant à plusieurs étapes ne doit pas disparaître sur un Échap malheureux.
  assert.equal((source.match(/dialogPersistent === 'true'/g) || []).length, 2,
    'la garde doit valoir pour Échap comme pour le clic sur le fond');
});

test('closeDialog refuse ce qui n’est pas une fenêtre', () => {
  assert.equal(closeDialog(null), false);
  assert.equal(closeDialog(undefined), false);
});

test('les fonctions sont utilisables hors navigateur', () => {
  // Le module est chargé par la suite de tests : il ne doit pas exiger un DOM au import.
  assert.equal(typeof topmostDialog, 'function');
  assert.equal(typeof closeDialog, 'function');
});

test('le module est chargé par la plateforme et disponible hors ligne', () => {
  assert.match(read('index.html'), /<script type="module" src="dialog-behavior\.js"><\/script>/);
  assert.match(read('service-worker.js'), /'\/dialog-behavior\.js'/);
  // Il doit précéder core.js pour couvrir les fenêtres ouvertes dès le démarrage.
  const html = read('index.html');
  assert.ok(html.indexOf('dialog-behavior.js') < html.indexOf('src="core.js"'));
});
