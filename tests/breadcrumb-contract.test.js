import test from 'node:test';
import assert from 'node:assert/strict';
import { fullBreadcrumbPath, breadcrumbText, BREADCRUMB_SECTIONS } from '../breadcrumb-contract.js';
import { buildRelationshipIndex, resolveEquipmentLocation } from '../relationship-contract.js';

/*
 * LA CHAÎNE COMPLÈTE : DE LA VILLE JUSQU'À L'APPAREIL.
 *
 * La plateforme savait construire DEUX fils d'Ariane et ne les avait jamais joints :
 * « Salle › Baie › Équipement » d'un côté, « Ville › Région › Département » de l'autre.
 * Résultat mesuré dans la Fiche 360 : « Emplacement : STC › B01 › CAM 1 » — ce qui ne dit
 * pas dans quelle VILLE se trouve l'appareil, l'information la plus utile quand il faut
 * envoyer quelqu'un.
 */

const LOCALISATIONS = [
  { id: 'v1', kind: 'city', name: 'Casablanca', parentId: null },
  { id: 'r1', kind: 'region', name: 'Site 2M', parentId: 'v1' },
  { id: 'd1', kind: 'department', name: 'Technique', parentId: 'r1' }
];
const SALLES = [
  { id: 's1', name: 'STC', locationId: 'd1' },
  { id: 's2', name: 'Régie 1' }                       // aucune localisation déclarée
];
const BAIES = [{ id: 'b1', name: 'B02', roomId: 's1' }];
const EQUIPEMENTS = [{ id: 'e1', name: 'Ross Ultrix', roomId: 's1', baieId: 'b1' }];

const chemin = (equipement, salles = SALLES) =>
  resolveEquipmentLocation(equipement, buildRelationshipIndex({
    rooms: salles, baies: BAIES, equipments: EQUIPEMENTS
  })).path;

test('la chaîne va de la ville à l’appareil, en un seul fil', () => {
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0]), LOCALISATIONS);
  assert.equal(breadcrumbText(complet), 'Casablanca › Site 2M › Technique › STC › B02 › Ross Ultrix');
  assert.deepEqual(complet.map(m => m.type), ['location', 'location', 'location', 'room', 'baie', 'equipment']);
});

test('aucun niveau n’est INVENTÉ quand la salle n’est rattachée à rien', () => {
  // C'est le point qui compte. Fabriquer « Casablanca » par défaut donnerait une plateforme
  // qui affirme, avec l'aplomb d'une donnée saisie, quelque chose que personne n'a déclaré.
  const orpheline = { id: 'e2', name: 'CAM 1', roomId: 's2' };
  const complet = fullBreadcrumbPath(chemin(orpheline, SALLES), LOCALISATIONS);
  assert.equal(breadcrumbText(complet), 'Régie 1 › CAM 1');
  assert.ok(!complet.some(m => m.type === 'location'));
});

test('une chaîne géographique incomplète s’affiche telle qu’elle est', () => {
  // Un département créé avant sa région existe vraiment en base : le fil commence alors au
  // département. Le masquer rendrait l'appareil introuvable dans l'arbre.
  const partielles = [{ id: 'd9', kind: 'department', name: 'Technique', parentId: null }];
  const salles = [{ id: 's1', name: 'STC', locationId: 'd9' }];
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0], salles), partielles);
  assert.equal(breadcrumbText(complet), 'Technique › STC › B02 › Ross Ultrix');
});

test('chaque maillon sait où il mène', () => {
  // Sans cela le fil n'est qu'une étiquette : c'est ce qui le rend cliquable.
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0]), LOCALISATIONS);
  assert.deepEqual(complet.map(m => m.section),
    ['locations', 'locations', 'locations', 'salles', 'baies', 'devices']);
  assert.deepEqual(complet.map(m => m.id), ['v1', 'r1', 'd1', 's1', 'b1', 'e1']);
  assert.equal(BREADCRUMB_SECTIONS.equipment, 'devices');
});

test('chaque maillon dit de quel NIVEAU il est', () => {
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0]), LOCALISATIONS);
  assert.deepEqual(complet.map(m => m.typeLabel),
    ['Ville', 'Région', 'Département', 'Salle', 'Baie', 'Équipement']);
});

test('un maillon sans nom n’affiche pas un vide cliquable', () => {
  const anonymes = [{ id: 'v1', kind: 'city', name: 'Casablanca', parentId: null },
    { id: 'r1', kind: 'region', name: '   ', parentId: 'v1' }];
  const salles = [{ id: 's1', name: 'STC', locationId: 'r1' }];
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0], salles), anonymes);
  assert.equal(breadcrumbText(complet), 'Casablanca › STC › B02 › Ross Ultrix');
  // Vérifier le CHEMIN, pas seulement le texte : `breadcrumbText` écarte déjà les libellés
  // vides de son côté, si bien qu'un test portant sur le texte reste vert alors même que le
  // chemin contient un maillon fantôme — que l'affichage rendrait en case cliquable vide.
  // Un test de mutation l'a montré en survivant au retrait du filtre.
  assert.equal(complet.length, 4);
  assert.ok(complet.every(maillon => maillon.label.trim()), 'un maillon sans nom a survécu');
});

test('une boucle dans les parents ne fige pas l’interface', () => {
  // `locationPath` s'arrête sur un identifiant déjà vu. Une boucle devient un chemin
  // tronqué plutôt qu'un écran gelé — et rien n'empêche une boucle à l'écriture.
  const bouclees = [{ id: 'a', kind: 'region', name: 'A', parentId: 'b' },
    { id: 'b', kind: 'region', name: 'B', parentId: 'a' }];
  const salles = [{ id: 's1', name: 'STC', locationId: 'a' }];
  assert.equal(breadcrumbText(fullBreadcrumbPath(chemin(EQUIPEMENTS[0], salles), bouclees)),
    'B › A › STC › B02 › Ross Ultrix');
});

test('des entrées absentes ou malformées ne cassent rien', () => {
  assert.deepEqual(fullBreadcrumbPath(), []);
  assert.deepEqual(fullBreadcrumbPath(null, null), []);
  assert.deepEqual(fullBreadcrumbPath([null, undefined], []), []);
  assert.equal(breadcrumbText(), '');
  assert.equal(breadcrumbText(null), '');
});

test('le séparateur reste celui du reste de la plateforme', () => {
  const complet = fullBreadcrumbPath(chemin(EQUIPEMENTS[0]), LOCALISATIONS);
  assert.ok(breadcrumbText(complet).includes(' › '));
  assert.equal(breadcrumbText(complet, { separator: ' / ' }).includes(' › '), false);
});
