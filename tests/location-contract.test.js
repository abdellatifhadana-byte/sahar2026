import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LOCATION_KINDS, LOCATION_ORDER,
  normalizeLocationKind, normalizeLocation, locationLevel, childKind, parentKind,
  canParent, locationPath, locationBreadcrumb, locationChildren,
  locationDescendants, locationTree, locationDeletionBlockers, eligibleParents
} from '../location-contract.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/*
 * La plateforme s'arrêtait à la salle. Au-dessus, il n'y avait qu'un champ `location`
 * LIBRE : du texte, sans structure, sans parent. Deux salles du même bâtiment n'avaient
 * aucun lien, et rien ne permettait de demander « tout ce qui est à Casablanca ».
 *
 *     Ville → Région → Département → Salle → Baie → Équipement
 */

const JEU = [
  { id: 'c1', kind: 'city', name: 'Casablanca', parentId: null },
  { id: 'c2', kind: 'city', name: 'Rabat', parentId: null },
  { id: 'r1', kind: 'region', name: 'Siège', parentId: 'c1' },
  { id: 'r2', kind: 'region', name: 'Annexe', parentId: 'c1' },
  { id: 'd1', kind: 'department', name: 'Régie', parentId: 'r1' },
  { id: 'd2', kind: 'department', name: 'Montage', parentId: 'r1' },
  { id: 'd3', kind: 'department', name: 'Antenne', parentId: 'r2' }
];

test('les trois niveaux existent, du plus large au plus fin', () => {
  assert.deepEqual(LOCATION_ORDER, ['city', 'region', 'department']);
  assert.equal(locationLevel('city'), 0);
  assert.equal(locationLevel('department'), 2);
});

test('les noms français et anglais désignent le même niveau', () => {
  // Les saisies viennent d'écrans en français ; les données peuvent venir d'un import.
  for (const [entree, attendu] of [
    ['ville', 'city'], ['Ville', 'city'], ['city', 'city'],
    ['région', 'region'], ['region', 'region'],
    ['département', 'department'], ['departement', 'department'], ['service', 'department']
  ]) {
    assert.equal(normalizeLocationKind(entree), attendu, `« ${entree} » mal interprété`);
  }
  // Un niveau inconnu retombe sur le plus large, jamais sur rien.
  assert.equal(normalizeLocationKind('galaxie'), 'city');
});

test('une ville n’a pas de parent, un département en attend un', () => {
  assert.equal(parentKind('city'), null);
  assert.equal(parentKind('region'), 'city');
  assert.equal(parentKind('department'), 'region');
  assert.equal(childKind('department'), null);
  assert.equal(childKind('city'), 'region');
});

test('un parent imposé à une ville est refusé', () => {
  // Sinon on fabrique une racine flottante, invisible dans l'arbre.
  const ville = normalizeLocation({ id: 'x', kind: 'city', name: 'Fès', parentId: 'r1' });
  assert.equal(ville.parentId, null);
  assert.equal(ville.orphan, false);
});

test('un niveau inférieur sans parent est ACCEPTÉ, et signalé', () => {
  // C'est un état réel — un département créé avant sa région. Le refuser obligerait à
  // tout créer dans l'ordre ; le masquer le rendrait introuvable.
  const dept = normalizeLocation({ id: 'y', kind: 'department', name: 'Régie Car' });
  assert.equal(dept.parentId, null);
  assert.equal(dept.orphan, true);
});

test('un enregistrement sans nom n’est pas une localisation', () => {
  assert.equal(normalizeLocation({ id: 'z', kind: 'city' }), null);
  assert.equal(normalizeLocation({ id: 'z', kind: 'city', name: '   ' }), null);
  assert.equal(normalizeLocation(null), null);
});

test('un parent doit être du niveau IMMÉDIATEMENT supérieur', () => {
  assert.equal(canParent({ kind: 'region' }, { kind: 'department' }), true);
  assert.equal(canParent({ kind: 'city' }, { kind: 'region' }), true);
  // Sauter un niveau créerait une hiérarchie à trous, impossible à parcourir.
  assert.equal(canParent({ kind: 'city' }, { kind: 'department' }), false);
  assert.equal(canParent({ kind: 'department' }, { kind: 'region' }), false);
  assert.equal(canParent({ kind: 'region' }, { kind: 'city' }), false);
});

test('le chemin remonte jusqu’à la racine', () => {
  assert.deepEqual(locationPath('d1', JEU).map(x => x.name), ['Casablanca', 'Siège', 'Régie']);
  assert.equal(locationBreadcrumb('d1', JEU), 'Casablanca › Siège › Régie');
  assert.equal(locationBreadcrumb('c1', JEU), 'Casablanca');
  assert.equal(locationBreadcrumb('inconnu', JEU), '');
});

test('une boucle de parents ne fige pas l’interface', () => {
  // Rien n'empêche une boucle à l'écriture ; sans garde, le parcours tournerait
  // indéfiniment et l'écran se figerait sans message.
  const boucle = [
    { id: 'a', kind: 'department', name: 'A', parentId: 'b' },
    { id: 'b', kind: 'region', name: 'B', parentId: 'a' }
  ];
  const chemin = locationPath('a', boucle);
  assert.ok(chemin.length <= 2, `la boucle a produit un chemin de ${chemin.length} éléments`);
});

test('les enfants directs et les descendants complets', () => {
  assert.deepEqual(locationChildren('c1', JEU).map(x => x.id), ['r1', 'r2']);
  assert.deepEqual(locationChildren(null, JEU).map(x => x.id), ['c1', 'c2']);
  // « Qu'y a-t-il à Casablanca ? » — la question que le champ texte ne savait pas traiter.
  assert.deepEqual(locationDescendants('c1', JEU).map(x => x.id).sort(), ['d1', 'd2', 'd3', 'r1', 'r2']);
  assert.deepEqual(locationDescendants('d1', JEU), []);
});

test('l’arbre est trié et complet', () => {
  const arbre = locationTree(JEU);
  assert.deepEqual(arbre.map(x => x.name), ['Casablanca', 'Rabat']);
  const casa = arbre[0];
  assert.deepEqual(casa.children.map(x => x.name), ['Annexe', 'Siège']);
  assert.deepEqual(casa.children.find(x => x.name === 'Siège').children.map(x => x.name), ['Montage', 'Régie']);
});

test('supprimer une localisation qui porte des enfants ou des salles est refusé', () => {
  // Sinon des enregistrements restent rattachés à un identifiant qui n'existe plus — une
  // rupture qui ne se voit qu'une fois les données perdues.
  const rooms = [{ id: 1, name: 'Régie Car', locationId: 'd1' }];
  assert.deepEqual(locationDeletionBlockers('d2', { locations: JEU, rooms }), []);
  assert.ok(locationDeletionBlockers('c1', { locations: JEU, rooms }).length,
    'une ville portant deux régions a pu être supprimée');
  const empechements = locationDeletionBlockers('d1', { locations: JEU, rooms });
  assert.ok(empechements.some(m => m.includes('salle')), `attendu un empêchement « salle », reçu ${empechements}`);
});

test('les parents proposés sont du bon niveau, et eux seuls', () => {
  assert.deepEqual(eligibleParents('region', JEU).map(x => x.id), ['c1', 'c2']);
  assert.deepEqual(eligibleParents('department', JEU).map(x => x.id), ['r1', 'r2']);
  assert.deepEqual(eligibleParents('city', JEU), []);
});

/* ---------------------------------------------------------------- l'intégration */

test('le magasin `locations` traverse toutes les couches', () => {
  // Un magasin oublié dans une seule liste se traduit par des données qui existent
  // localement et disparaissent au rechargement — sans le moindre message.
  // Le magasin arrive par une MIGRATION, pas par le schéma de base : la plateforme a sa
  // convention (v15, v16), et modifier db.js aurait rendu db-migration-v15.js
  // silencieusement inerte — sa condition `db.version < 15` n'aurait plus jamais été vraie.
  const migration = lire('db-migration-v17.js');
  assert.match(migration, /const TARGET_VERSION = 17;/);
  assert.match(migration, /createObjectStore\('locations'/);
  assert.match(migration, /rooms\.createIndex\('locationId', 'locationId'\)/);
  assert.match(lire('index.html'), /db-migration-v17\.js/);
  assert.match(lire('db.js'), /const stores=\['users','locations','rooms'/);
  assert.match(lire('central-sync.js'), /'users','locations','rooms'/);
  assert.match(lire('scripts/serve.js'), /'users','locations','rooms'/);
});

test('la section Localisations est enregistrée et chargée', () => {
  const section = lire('locations-section.js');
  assert.match(section, /AdminUI\.prototype\.initSections/);
  assert.match(section, /sections\.locations = \{/);
  assert.match(lire('index.html'), /locations-section\.js/);
  assert.match(lire('index.html'), /locations-section\.css/);
  // La feuille d'arbitrage doit rester la DERNIÈRE.
  const html = lire('index.html');
  assert.ok(html.indexOf('locations-section.css') < html.indexOf('design-system.css'),
    'la feuille des localisations passe après la feuille d’arbitrage');
});

test('les salles peuvent être situées, sans perdre leur texte libre', () => {
  // Supprimer le champ texte effacerait une information saisie à la main sans rien offrir
  // à la place : les deux coexistent, le temps que la hiérarchie soit remplie.
  const salles = lire('salles.js');
  assert.match(salles, /name="locationId"/);
  assert.match(salles, /locationId: form\.locationId\?\.value \|\| null/);
  assert.match(salles, /name="location" type="text"/);
  assert.match(salles, /function optionsDeLocalisation\(locations, selectionne\)/);
  // Le sélecteur montre le CHEMIN complet : deux départements homonymes restent
  // distinguables.
  assert.match(salles, /locationBreadcrumb\(item\.id, locations\)/);
});

test('la suppression est refusée AVANT la demande de confirmation', () => {
  // Proposer une action impossible puis la refuser après un « oui » est plus déroutant
  // que de l'expliquer tout de suite.
  const section = lire('locations-section.js');
  const suppression = section.slice(section.indexOf('async supprimer(id)'), section.indexOf('async rafraichir()'));
  assert.ok(suppression.indexOf('locationDeletionBlockers') < suppression.indexOf('confirm('),
    'la confirmation est demandée avant de vérifier les empêchements');
});

test('les localisations sans parent restent visibles', () => {
  // Une localisation détachée n'apparaît dans aucun arbre : sans traitement particulier,
  // elle deviendrait introuvable tout en restant en base.
  const section = lire('locations-section.js');
  assert.match(section, /locations-detached/);
  assert.match(section, /Rattachement manquant/);
});
