/**
 * @file tests/map-search-localiser-p0d.test.js — P0-D : chercher, localiser, revenir.
 *
 * La recherche est exécutée POUR DE VRAI (elle est pure) ; la navigation et le retour sont
 * ancrés sur le câblage nommé, faute de pouvoir monter 1700 lignes de DOM dans un test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __searchAllPourEpreuves as searchAll } from '../interactive-map.js';
import { sceneForTarget, localiserPuisOuvrir, cableReturnPath } from '../map-navigation-contract.js';

const source = readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');

const SCENE = {
  rooms: [{ id: 'r1', name: 'Régie A', location: 'Siège' }, { id: 'r2', name: 'Studio 1' }],
  baies: [{ id: 'b1', name: 'B01 POOL', roomId: 'r1' }, { id: 'b2', name: 'RANGEE ٣', roomId: 'r1' }],
  equipments: [
    { id: 'e1', name: 'Éclairage principal', roomId: 'r1', baieId: 'b1', numSerie: 'SN-4471' },
    { id: 'e2', nom: 'Switch cœur', roomId: 'r1', marque: 'Cisco', modele: 'C9300' }
  ]
};
const chercher = q => searchAll({ query: q, ...SCENE });
const noms = q => chercher(q).map(r => r.name || r.nom || r.id).sort();

/* ══════════════════ la recherche ══════════════════ */

test('SL·21 — chercher une salle la trouve, avec ou sans accent', () => {
  assert.deepEqual(noms('Régie'), ['Régie A']);
  assert.deepEqual(noms('Regie'), ['Régie A'], '« Regie » sans accent doit trouver « Régie »');
  assert.deepEqual(noms('REGIE'), ['Régie A'], 'la casse ne doit pas compter');
});

test('SL·22 — chercher une baie la trouve, chiffres arabes compris', () => {
  assert.deepEqual(noms('B01'), ['B01 POOL']);
  assert.deepEqual(noms('RANGEE 3'), ['RANGEE ٣'],
    'une baie saisie en chiffres arabo-indiens doit se trouver en chiffres latins');
});

test('SL·23 — chercher un équipement par nom, numéro de série, marque ou modèle', () => {
  assert.deepEqual(noms('eclairage'), ['Éclairage principal'], 'sans accent');
  assert.deepEqual(noms('SN-4471'), ['Éclairage principal'], 'par numéro de série');
  assert.deepEqual(noms('cisco'), ['Switch cœur'], 'par marque');
  assert.deepEqual(noms('C9300'), ['Switch cœur'], 'par modèle');
});

test('SL·recherche vide — aucun résultat, jamais la liste entière', () => {
  for (const vide of ['', '   ', null, undefined]) {
    assert.deepEqual(chercher(vide), [], `« ${vide} » ne doit rien rendre`);
  }
});

test('SL·portée — la recherche couvre trois types, et ne prétend pas en couvrir plus', () => {
  const types = new Set(chercher('e').map(r => r.type));
  for (const type of types) assert.ok(['room', 'baie', 'equipment'].includes(type));
  // Elle ne fabrique pas de résultats pour ce qu'elle ne sait pas chercher.
  assert.deepEqual(chercher('câble-inexistant'), []);
});

/* ══════════════════ localiser ══════════════════ */

test('SL·23b — un résultat mène à la SCÈNE de la fiche, puis l’y désigne', () => {
  const clic = source.slice(source.indexOf("cont.querySelectorAll('li')"), source.indexOf("// =========== رسم الخريطة"));
  assert.match(clic, /await localiserVue\?\.\(li\.dataset\.type, li\.dataset\.id\)/,
    'le clic doit d’abord naviguer vers la scène');
  const ordreLocaliser = clic.indexOf('localiserVue');
  const ordreOuvrir = clic.indexOf('openPanel');
  assert.ok(ordreLocaliser > 0 && ordreLocaliser < ordreOuvrir,
    'on situe AVANT d’ouvrir : ouvrir seul dit quoi, jamais où');
});

/* ═══ la règle de navigation, EXÉCUTÉE — plus cherchée dans le source ═══ */

test('SL·localiser salle — la scène est le plan général, donc Retour y revient', () => {
  const r = localiserPuisOuvrir('room', 'r1', SCENE, []);
  assert.deepEqual(r.scene, { type: 'map' });
  assert.deepEqual(r.retour, { type: 'map' });
});

test('SL·localiser baie — la scène est SA SALLE, donc Retour revient à la salle', () => {
  /*
   * LE DÉFAUT QUE CETTE ÉPREUVE VERROUILLE. La vue se plaçait SUR la baie, puis l'ouverture
   * du panneau empilait la MÊME baie : « Retour » ramenait à la baie qu'on venait de
   * quitter, au lieu de sa salle. L'utilisateur tournait en rond d'un niveau sur lui-même.
   */
  const r = localiserPuisOuvrir('baie', 'b1', SCENE, []);
  assert.deepEqual(r.scene, { type: 'room', id: 'r1' }, 'on se place chez le parent');
  assert.deepEqual(r.retour, { type: 'room', id: 'r1' }, 'Retour doit rendre la SALLE, jamais la baie elle-même');
  assert.notDeepEqual(r.retour, { type: 'baie', id: 'b1' });
});

test('SL·localiser équipement EN BAIE — la scène est sa baie, Retour y revient', () => {
  const r = localiserPuisOuvrir('equipment', 'e1', SCENE, []);
  assert.deepEqual(r.scene, { type: 'baie', id: 'b1' });
  assert.deepEqual(r.retour, { type: 'baie', id: 'b1' });
});

test('SL·localiser équipement DIRECTEMENT EN SALLE — la scène est sa salle', () => {
  const r = localiserPuisOuvrir('equipment', 'e2', SCENE, []);
  assert.deepEqual(r.scene, { type: 'room', id: 'r1' }, 'sans baie, c’est la salle qui contient');
  assert.deepEqual(r.retour, { type: 'room', id: 'r1' });
});

test('SL·l’historique s’empile à la scène PARENTE, pas à la cible', () => {
  // Deux localisations successives : la pile doit décrire le chemin, sans répéter la cible.
  const premier = localiserPuisOuvrir('baie', 'b1', SCENE, []);
  const second = localiserPuisOuvrir('equipment', 'e1', SCENE, premier.historique);
  assert.deepEqual(second.historique, [{ type: 'room', id: 'r1' }, { type: 'baie', id: 'b1' }],
    'le chemin doit être salle puis baie — l’un au-dessus de l’autre, jamais le même deux fois');
});

test('SL·une fiche qu’on ne sait pas situer ne fabrique AUCUNE scène', () => {
  assert.equal(sceneForTarget('baie', 'inconnue', SCENE), null);
  assert.equal(sceneForTarget('equipment', 'inconnu', SCENE), null);
  assert.equal(sceneForTarget('room', 'inconnue', SCENE), null);
  assert.equal(sceneForTarget('cable', 'c1', SCENE), null, 'un type que la carte ne sait pas ouvrir');
  // Une baie dont la salle a disparu : on refuse plutôt que de la montrer « quelque part ».
  assert.equal(sceneForTarget('baie', 'orpheline', {
    ...SCENE, baies: [...SCENE.baies, { id: 'orpheline', name: 'B99', roomId: 'salle-absente' }]
  }), null);
  assert.equal(localiserPuisOuvrir('baie', 'inconnue', SCENE, []), null);
});

test('SL·localiser — la désignation est TEMPORAIRE, jamais une icône permanente', () => {
  const designer = source.slice(source.indexOf('function designerCible'), source.indexOf('function editWallArea'));
  assert.match(designer, /setTimeout\(/, 'le halo doit s’effacer de lui-même');
  assert.match(designer, /repere\.style\.boxShadow = ''/, 'le halo est retiré ensuite');
  assert.match(designer, /if \(repere\.classList\.contains\('is-discret'\)\) repere\.style\.opacity = '0'/,
    'un repère discret redevient discret : sinon la désignation deviendrait un marqueur permanent');
});

test('SL·localiser — l’API extérieure attend le plan plutôt que de parier sur un délai', () => {
  const api = source.slice(source.indexOf('export async function localiserSurCarte'), source.indexOf('export function closeInteractiveMap'));
  assert.match(api, /document\.getElementById\('map-panel'\)/);
  assert.match(api, /return false/, 'sans plan monté, elle le dit');
});

/* ══════════════════ retour ══════════════════ */

test('SL·24 — « Retour » restitue la vue précédente et abandonne l’édition en cours', () => {
  const back = source.slice(source.indexOf('function goBack'), source.indexOf('// بدأ العرض الأولي'));
  assert.match(back, /cancelCoordinateSession\(\)/,
    'quitter une vue éditée sans annuler laisserait une coordonnée mutée sans bouton pour la reprendre');
  assert.match(back, /let prev = history\.pop\(\)/);
  assert.match(back, /currentView = prev/, 'le retour restitue la vue exacte, pas le plan général');
  assert.match(back, /currentView = \{ type: "map" \}/, 'pile vide : on retombe sur le plan');
});

test('SL·25 — la réouverture depuis la Fiche 360 restitue la scène exacte', () => {
  const rouvrir = source.slice(source.indexOf('export async function rouvrirCarte'), source.indexOf('export async function localiserSurCarte'));
  assert.match(rouvrir, /vue\.type !== 'room' && vue\.type !== 'baie'/);
  assert.match(rouvrir, /await instance\.ouvrir\(vue\.type, vue\.id\)/,
    'on rouvre la vue mémorisée, pas le plan général');
});

/* ══════════════════ P0-F · LE RETOUR DEPUIS LE TRACÉ D'UN CÂBLE ══════════════════
 *
 * On entre dans un tracé depuis la Fiche 360 d'un ÉQUIPEMENT, et l'on atterrit dans une
 * scène qui n'a aucun lien de parenté avec lui : le cheminement traverse ce qu'il traverse.
 * L'historique de la carte est alors vide — on n'est arrivé là par aucune navigation — et
 * « Retour » ramenait au plan général, à côté de l'endroit d'où l'on venait.
 */

test('RT·retour depuis un tracé — Câble → Équipement → Baie → Salle', () => {
  const chemin = cableReturnPath('e1', SCENE);
  // Une pile : « Retour » dépile par la FIN, donc la baie d'abord, puis sa salle.
  assert.deepEqual(chemin.map(etape => `${etape.type}#${etape.id}`), ['room#r1', 'baie#b1']);
});

test('RT·un équipement HORS baie n\'en invente pas une', () => {
  assert.deepEqual(cableReturnPath('e2', SCENE).map(etape => `${etape.type}#${etape.id}`), ['room#r1']);
});

test('RT·un équipement qu\'on ne sait pas situer ne fabrique AUCUN retour', () => {
  assert.deepEqual(cableReturnPath('inconnu', SCENE), []);
  assert.deepEqual(cableReturnPath(null, SCENE), []);
  // Une baie dont la salle est absente ne mène nulle part : on ne remonte pas au hasard.
  assert.deepEqual(cableReturnPath('e3', {
    ...SCENE,
    baies: [...SCENE.baies, { id: 'b9', name: 'Baie orpheline', roomId: 'r-absente' }],
    equipments: [...SCENE.equipments, { id: 'e3', name: 'Orphelin', roomId: 'r-absente', baieId: 'b9' }]
  }).map(etape => etape.id), ['b9'], 'la baie reste, sa salle inexistante n\'est pas inventée');
});

test('RT·un rattachement circulaire ne devient pas une boucle infinie', () => {
  // Donnée fausse, mais elle existe : deux baies qui se réclament l'une de l'autre.
  const chemin = cableReturnPath('e4', {
    rooms: [], baies: [{ id: 'x', roomId: 'y' }, { id: 'y', roomId: 'x' }],
    equipments: [{ id: 'e4', baieId: 'x' }]
  });
  assert.ok(Array.isArray(chemin));
  assert.ok(chemin.length <= 2, 'la remontée s\'arrête, elle ne tourne pas');
});

test('RT·on ENTRE dans la scène du tracé, on ne se place pas chez son parent', () => {
  /*
   * `localiserSurCarte` place la vue chez le PARENT : pour une salle, c'est le plan
   * général. Pas un segment du tracé n'était alors dessiné — la couche ne dessine que ceux
   * de la scène OUVERTE. C'est une entrée distincte, et la Fiche 360 doit l'emprunter.
   */
  assert.match(source, /export async function ouvrirTraceSurCarte/);
  // Une fenêtre de longueur fixe : chercher la fin par `};` s'arrêtait au premier littéral
  // d'objet du corps, et l'épreuve mesurait alors une moitié de fonction.
  const debut = source.indexOf('entrerDansTraceVue = (');
  assert.ok(debut > 0, 'la carte doit exposer une entrée de scène pour les tracés');
  const executable = source.slice(debut, debut + 1800)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(executable, /history = \[\.\.\.cableReturnPath\(equipmentId/,
    'le retour vient du CONTRAT, il n\'est pas assemblé dans la carte');
  assert.match(executable, /currentView = type === 'map' \? \{ type: 'map' \} : \{ type, id: identifiant \}/,
    'on entre dans la scène demandée, telle quelle');
  // Une scène absente du plan ne se remplace pas par le plan général.
  assert.match(executable, /if \(type === 'room' && !rooms\.some/);
  assert.match(executable, /if \(type === 'baie' && !baies\.some/);
});

test('RT·la Fiche 360 emprunte cette entrée, et passe l\'équipement d\'origine', () => {
  const fiche = readFileSync(new URL('../operations-suite.js', import.meta.url), 'utf8');
  const executable = fiche.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(executable, /ouvrirTraceSurCarte\(entree, \{ equipmentId: equipment\.id \}\)/);
  assert.equal(/localiserSurCarte\(/.test(executable), false,
    'localiser laissait l\'exploitant sur le plan général, sans un segment dessiné');
  // Et jamais par `cable.roomId`, cache hérité qui ne dit rien du cheminement.
  assert.equal(/cable\.roomId/.test(executable), false);
});
