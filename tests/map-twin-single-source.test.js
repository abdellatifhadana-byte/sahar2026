import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as contrat from '../map-digital-twin-contract.js';
import * as twin from '../map-digital-twin.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/*
 * UNE SEULE SOURCE POUR LES RÈGLES DE LA CARTE.
 *
 * `index.html` charge `map-digital-twin.js` : c'est CE fichier qui tourne. La suite de tests,
 * elle, importait `map-digital-twin-contract.js`. Les deux portaient quatre fonctions au texte
 * identique — mais pas la même aide `finite` :
 *
 *     contrat    : value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
 *     production : Number.isFinite(Number(value))
 *
 * Or `Number(null)` et `Number('')` valent 0, donc « fini ». Mesuré sur huit états d'entité :
 * CINQ recevaient deux réponses différentes. Une salle dont les coordonnées sont nulles ou
 * vides — l'état exact d'un champ qu'on vient d'effacer dans un formulaire — était comptée
 * PLACÉE par le code qui tourne et NON PLACÉE par le code que les tests vérifient.
 *
 * Conséquence directe : le nombre de « positions à compléter » affiché par le jumeau
 * numérique sous-estimait le travail restant, et aucun test ne pouvait s'en apercevoir.
 */

const REGLES = ['mapEntityPositionState', 'normalizedOperationalState', 'mapQualitySummary', 'smartMapSearch'];

test('le module exécuté et le contrat sont LE MÊME code, pas deux copies', () => {
  // L'égalité d'IDENTITÉ est la seule vérification qu'une copie ne peut pas satisfaire :
  // deux fonctions au texte identique restent deux objets différents. Comparer le texte
  // laisserait repasser exactement le défaut qu'on vient de retirer.
  for (const nom of REGLES) {
    assert.equal(typeof twin[nom], 'function', `« ${nom} » n’est plus exportée par le module`);
    assert.equal(twin[nom], contrat[nom],
      `« ${nom} » est redéfinie dans map-digital-twin.js au lieu d’être réimportée du contrat`);
  }
});

test('les deux fichiers répondent la même chose sur les états qui divergeaient', () => {
  // Les huit cas mesurés, dont les cinq qui divergeaient. Exécutés, pas décrits.
  const CAS = [
    ['room', { x_inMap: null, y_inMap: null }, false, 'coordonnées nulles : jamais placée'],
    ['room', { x_inMap: '', y_inMap: '' }, false, 'champs vidés dans un formulaire'],
    ['room', { x_inMap: 120, y_inMap: 80 }, true, 'réellement placée'],
    ['room', {}, false, 'aucune coordonnée'],
    ['baie', { x_inRoom: null, y_inRoom: null }, false, 'baie aux coordonnées nulles'],
    ['equipment', { x_inBaie: '', y_inBaie: '' }, false, 'équipement aux coordonnées vides'],
    ['equipment', { x_inBaie: 10, y_inBaie: null }, false, 'à demi placé : ce n’est pas placé'],
    ['room', { rect: { x: null, y: null, w: null, h: null } }, false, 'rectangle nul']
  ];
  for (const [type, record, attendu, pourquoi] of CAS) {
    assert.equal(contrat.mapEntityPositionState(type, record), attendu, `contrat — ${pourquoi}`);
    assert.equal(twin.mapEntityPositionState(type, record), attendu, `module exécuté — ${pourquoi}`);
  }
});

test('un zéro reste une position valable', () => {
  // La correction resserre `finite`, et il serait facile d'aller trop loin : `0` est une
  // coordonnée parfaitement légitime — le coin supérieur gauche.
  assert.equal(contrat.mapEntityPositionState('room', { x_inMap: 0, y_inMap: 0 }), true);
  assert.equal(twin.mapEntityPositionState('room', { x_inMap: 0, y_inMap: 0 }), true);
  assert.equal(twin.mapEntityPositionState('equipment', { x_inBaie: 0, y_inBaie: 0 }), true);
});

test('le module n’a plus d’aide `finite` ou `pair` à lui', () => {
  // Ce sont elles qui portaient la divergence. Les laisser en place inviterait à réécrire
  // une règle locale « juste pour ce cas-là ».
  const source = lire('map-digital-twin.js');
  assert.doesNotMatch(source, /^const finite\s*=/m, 'une aide `finite` locale est réapparue');
  assert.doesNotMatch(source, /^const pair\s*=/m, 'une aide `pair` locale est réapparue');
  assert.match(source, /from '\.\/map-digital-twin-contract\.js'/);
});

test('c’est bien le module réimportant le contrat qui est chargé par la page', () => {
  // Si `index.html` chargeait le contrat et non le module, l'identité vérifiée plus haut
  // porterait sur du code que personne n'exécute.
  const html = lire('index.html');
  assert.match(html, /src="map-digital-twin\.js"/);
  // Et le contrat doit être servi hors ligne, sinon la carte casse sans réseau : le module
  // l'importe désormais, donc il n'est plus optionnel.
  const sw = lire('service-worker.js');
  assert.match(sw, /\/map-digital-twin-contract\.js/);
  assert.match(sw, /\/map-digital-twin\.js/);
});
