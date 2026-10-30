import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { optionsDeLocalisation, emplacementMarkup } from '../salles.js';
import Salles from '../salles.js';
import { db } from '../db.js';

/*
 * UNE UNITÉ QUI N'EST DANS AUCUN DÉPARTEMENT.
 *
 * La Régie Car est une unité mobile garée dans une COUR : elle est à l'intérieur du site
 * 2M, mais dans aucune salle et sous aucun département. Elle porte pourtant 51 équipements
 * et 6 baies — c'est la deuxième unité la plus équipée de la plateforme.
 *
 * Le modèle de données ne l'a jamais interdite : `rooms.locationId` est une référence
 * libre, et `locationPath`, `locationBreadcrumb`, `locationDeletionBlockers` comme l'arbre
 * des lieux traitent déjà les trois niveaux sans distinction.
 *
 * C'est le FORMULAIRE qui restreignait, et il le faisait deux fois :
 *
 *   1. il n'offrait que des départements — impossible de rattacher à une ville ou à une
 *      région, donc impossible de situer la Régie Car ;
 *   2. une unité DÉJÀ rattachée à une ville ou à une région n'avait aucune option
 *      correspondante : le sélecteur retombait sur « non rattachée », et modifier
 *      n'importe quel autre champ effaçait le rattachement SANS RIEN DIRE.
 *
 * Ces tests EXÉCUTENT les fonctions. Une garde qui se contente de lire le fichier reste
 * verte pendant que le défaut est vivant — cela s'est produit deux fois sur ce dépôt.
 */

const LIEUX = Object.freeze([
  { id: 'ville-1', name: 'Casablanca', kind: 'city', parentId: null },
  { id: 'reg-1', name: 'Siège 2M', kind: 'region', parentId: 'ville-1' },
  { id: 'dep-1', name: 'Régie', kind: 'department', parentId: 'reg-1' },
  { id: 'dep-2', name: 'Actualités', kind: 'department', parentId: 'reg-1' }
]);

/* ================================================== le sélecteur de rattachement */

test('les trois niveaux sont offerts, pas seulement le département', () => {
  const html = optionsDeLocalisation(LIEUX, '');
  for (const id of ['ville-1', 'reg-1', 'dep-1', 'dep-2']) {
    assert.ok(html.includes(`value="${id}"`), `« ${id} » n’est pas proposé au rattachement`);
  }
});

test('une unité rattachée à une RÉGION garde son rattachement à l’ouverture', () => {
  // C'est LE défaut qui effaçait des données : sans option correspondante, le sélecteur
  // affichait « non rattachée » et le prochain enregistrement écrivait `null`.
  const html = optionsDeLocalisation(LIEUX, 'reg-1');
  assert.match(html, /value="reg-1" selected/);
  assert.equal((html.match(/ selected/g) || []).length, 1, 'plus d’une option est présélectionnée');
});

test('une unité rattachée à une VILLE garde aussi son rattachement', () => {
  assert.match(optionsDeLocalisation(LIEUX, 'ville-1'), /value="ville-1" selected/);
});

test('les options sont groupées par niveau, du plus large au plus fin', () => {
  // « Casablanca » la ville et un département homonyme ne doivent pas se confondre dans
  // une liste à plat.
  const html = optionsDeLocalisation(LIEUX, '');
  const groupes = [...html.matchAll(/<optgroup label="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(groupes, ['Villes', 'Régions', 'Départements']);
});

test('chaque option porte le chemin complet, pas seulement le nom', () => {
  const html = optionsDeLocalisation(LIEUX, '');
  assert.ok(html.includes('Casablanca › Siège 2M › Régie'), 'le chemin du département est tronqué');
  assert.ok(html.includes('>Casablanca<'), 'la ville racine devrait s’afficher seule');
});

test('un nom de lieu ne peut pas injecter de balise', () => {
  const html = optionsDeLocalisation([{ id: 'x"1', name: '<img src=x onerror=alert(1)>', kind: 'city' }], '');
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.includes('&lt;img'), 'le nom n’est pas échappé');
  assert.ok(html.includes('&quot;'), 'l’identifiant n’est pas échappé');
});

test('aucun lieu enregistré ne produit aucune option', () => {
  // Le formulaire garde alors sa seule option vide : « Rattachement… ».
  assert.equal(optionsDeLocalisation([], ''), '');
  assert.equal(optionsDeLocalisation(null, ''), '');
});

test('un lieu de type inconnu reste proposé au lieu de disparaître', () => {
  // `normalizeLocationKind` retombe sur « ville » : mieux vaut un lieu mal classé qu'un
  // lieu introuvable. L'ancien filtre, lui, le supprimait purement et simplement.
  assert.match(optionsDeLocalisation([{ id: 'z-9', name: 'Zone technique', kind: 'bâtiment' }], ''), /value="z-9"/);
});

/* ================================================== la colonne « Emplacement » */

test('le rattachement structuré est enfin affiché', () => {
  // On le saisissait dans le formulaire, puis rien à l'écran ne le montrait.
  const html = emplacementMarkup({ locationId: 'reg-1' }, LIEUX);
  assert.match(html, /salle-lieu-chemin/);
  assert.ok(html.includes('Casablanca › Siège 2M'));
});

test('le texte libre est conservé à côté du chemin', () => {
  const html = emplacementMarkup({ locationId: 'reg-1', location: 'Cour technique' }, LIEUX);
  assert.ok(html.includes('Casablanca › Siège 2M'));
  assert.ok(html.includes('Cour technique'));
  assert.ok(html.indexOf('salle-lieu-chemin') < html.indexOf('salle-lieu-libre'), 'le texte libre passe devant le chemin');
});

test('un rattachement qui ne mène nulle part est NOMMÉ, pas tu', () => {
  // Un chemin vide s'afficherait comme une case blanche, indiscernable d'une salle jamais
  // rattachée — et personne ne saurait qu'il y a quelque chose à réparer.
  assert.match(emplacementMarkup({ locationId: 'disparu-42' }, LIEUX), /Rattachement introuvable/);
});

test('une salle sans rien n’affiche rien', () => {
  assert.equal(emplacementMarkup({}, LIEUX), '');
  assert.equal(emplacementMarkup({ locationId: '' }, LIEUX), '');
});

test('le texte libre ne peut pas injecter de balise', () => {
  assert.doesNotMatch(emplacementMarkup({ location: '<b>x</b>' }, LIEUX), /<b>/);
});

/* ================================================== la page entière */

const LOCAL_STORAGE_ADMIN = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, role: 'admin', username: 'admin' }) : null),
  setItem() {}, removeItem() {}
};

function monterSalles({ rooms = [], locations = LIEUX, users = [] } = {}) {
  globalThis.localStorage = LOCAL_STORAGE_ADMIN;
  db.getAll = async store => ({ rooms, users, locations }[store] || []);
  return new Salles(null);
}

const REGIE_CAR = Object.freeze({
  id: 'room-regie-car', name: 'Régie Car', locationId: 'reg-1', location: 'Cour technique'
});

/**
 * Le TABLEAU seul.
 *
 * Chercher dans la page entière ne prouve rien ici : le formulaire liste toutes les
 * localisations avec leur chemin, donc « Casablanca › Siège 2M » y figure de toute façon.
 * Une première version de ce test survivait à la mutation qui vidait la colonne — la
 * chaîne était trouvée dans les `<option>`. Le tableau est donc découpé d'abord.
 */
function tableau(html) {
  const debut = html.indexOf('<table class="tableau">');
  const fin = html.indexOf('</table>', debut);
  assert.ok(debut >= 0 && fin > debut, 'le tableau des salles est introuvable dans la page');
  const bloc = html.slice(debut, fin);
  assert.doesNotMatch(bloc, /<option/, 'le découpage a débordé sur le formulaire');
  return bloc;
}

test('la page rend le sélecteur élargi et le chemin de la Régie Car', async () => {
  const html = await monterSalles({ rooms: [REGIE_CAR] }).render();
  assert.match(html, /<optgroup label="Régions">/, 'le formulaire n’offre pas les régions');
  const liste = tableau(html);
  assert.match(liste, /<td class="salle-lieu">/);
  assert.ok(liste.includes('Casablanca › Siège 2M'), 'le chemin n’apparaît pas dans la colonne Emplacement');
});

test('la recherche trouve une unité par son chemin affiché', async () => {
  // Le chemin est écrit à l'écran : ne pas le chercher rendrait « Casablanca »
  // introuvable alors qu'on le lit dans la colonne.
  const salles = monterSalles({ rooms: [REGIE_CAR, { id: 'r2', name: 'Studio 1' }] });
  salles.filters.search = 'casablanca';
  const liste = tableau(await salles.render());
  assert.ok(liste.includes('Régie Car'), 'la Régie Car n’est pas trouvée par sa ville');
  assert.ok(!liste.includes('Studio 1'), 'une salle non rattachée remonte quand même');
});

test('le formulaire ne parle plus de « département » tout court', async () => {
  const html = await monterSalles({ rooms: [] }).render();
  assert.doesNotMatch(html, /Département de rattachement/);
  assert.match(html, /Rattachement : ville, région ou département/);
});

/* ================================================== ce qui n'a PAS changé */

test('aucune contrainte de niveau n’a été ajoutée au contrat des lieux', () => {
  // Le contrat n'a jamais dit qu'une salle devait pendre d'un département ; l'y écrire
  // maintenant contredirait la correction. `canParent` régit les lieux ENTRE EUX, pas le
  // rattachement d'une salle.
  const contrat = fs.readFileSync(new URL('../location-contract.js', import.meta.url), 'utf8');
  assert.doesNotMatch(contrat, /locationId[^\n]*DEPARTMENT/);
});

test('le champ texte libre existe toujours dans les deux formulaires', async () => {
  // Les salles existantes le portent : le supprimer effacerait une saisie manuelle sans
  // rien offrir à la place.
  const html = await monterSalles({ rooms: [REGIE_CAR] }).render();
  assert.match(html, /name="location"[^>]*placeholder="Emplacement \(texte libre\)"/);
  const source = fs.readFileSync(new URL('../salles.js', import.meta.url), 'utf8');
  assert.match(source, /<label>Emplacement \(texte libre\)<\/label>/);
});

test('la position sur le plan reste posée par le bouton « Coord. »', async () => {
  // Rattacher à une région dit DANS QUEL lieu ; la coordonnée dit OÙ dans ce lieu. Les
  // deux sont nécessaires pour une unité garée dans une cour, et aucune ne remplace
  // l'autre.
  const html = await monterSalles({ rooms: [REGIE_CAR] }).render();
  assert.match(html, /data-action="coord"/);
});
