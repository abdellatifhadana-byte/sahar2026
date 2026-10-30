import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../map-admin-entity-edit.js', import.meta.url), 'utf8');

/*
 * Régression P0 observée en navigateur :
 * B01 POOL → fil d'Ariane Salle STC → le panneau montre STC, mais le bouton
 * « Modifier » garde la dernière baie cliquée et rouvre B01 POOL.
 *
 * La cible d'édition ne doit donc JAMAIS être un état mémorisé par le dernier hotspot.
 * La vue affichée par `interactive-map.js` est l'autorité canonique, et la cible est relue
 * au moment du clic afin qu'une navigation intervenue après le rendu du bouton ne puisse
 * pas éditer l'ancienne entité.
 */

test('P0-A — le panneau ne conserve pas une sélection issue du dernier hotspot', () => {
  assert.doesNotMatch(source, /\blet\s+selected\s*=/,
    'un état `selected` persistant peut survivre à une navigation par fil d’Ariane');
  assert.match(source, /contexteCarte/,
    'la cible du bouton doit provenir de la vue canonique de la carte');
});

test('P0-A — la cible du bouton est relue depuis la vue courante au moment du clic', () => {
  assert.match(source,
    /button\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*\{[\s\S]*?currentEditableMapEntity\(\)[\s\S]*?openMapEntityEditor/s,
    'le clic doit relire la vue courante, pas fermer sur une ancienne cible');
});

test('P0-A — une vue non éditable ne peut pas conserver un bouton salle/baie', () => {
  assert.match(source,
    /if\s*\([^)]*!current[^)]*\)\s*\{[\s\S]*?existing\?\.remove\(\)/s,
    'le bouton stale doit être retiré quand la vue courante n’est ni une salle ni une baie');
});

test('P0-A — le panneau équipement ne réutilise pas la vue parent conservée pour le retour carte', () => {
  assert.match(source,
    /currentEditableMapEntity\(\)[\s\S]*?querySelector\(['"]#edit-equipment-btn['"]\)[\s\S]*?return null/s,
    'un panneau équipement ne doit jamais hériter du bouton Modifier salle/baie de sa vue de reprise');
});
