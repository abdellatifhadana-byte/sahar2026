/**
 * @file cable-route-presentation-p0f.test.js — LE PARCOURS DIT DANS LA LANGUE DE L'EXPLOITANT,
 *       SANS QUE LA PHRASE MENTE.
 *
 * L'utilisateur lit « STC (1) → Plan général → RF1 → STC (2) » et choisit « entre Plan
 * général et RF1 ». Rien de tout cela ne doit réordonner, renommer ou inventer quoi que ce
 * soit : l'ordre affiché EST l'ordre relevé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_SCENE_LABEL, UNDOCUMENTED_TRANSITION_LABEL, sceneLabel, routeSequenceLabels,
  routeSequenceSentence, insertionChoices, routeBadge,
  PORT_POSITION_DOCUMENTED_LABEL, PORT_POSITION_TO_CONFIRM_LABEL, endpointVisualPositionLabel
} from '../cable-route-presentation.js';
import { MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL } from '../connectivity-contract.js';
import { SHAPE_IN_ROOM_FIELD, SHAPE_IN_BAIE_FIELD, SHAPE_IN_EQUIPMENT_FIELD } from '../nested-shape-contract.js';

const CONTEXTE = {
  rooms: [{ id: 901, name: 'STC' }, { id: 902, name: 'RF1' }],
  baies: [{ id: 'B-12', name: 'Baie 12' }, { id: 'B-13', name: 'Baie 13' }]
};
/*
 * STC → plan → RF1 → STC. La salle est traversée DEUX fois — ET le dernier passage
 * (RF1 → STC) saute directement d'une salle à l'autre SANS repasser par le plan : c'est
 * la rupture non cartographiée (cas manquant), pas le cas 3 (salle→plan→salle) qui, lui,
 * est le premier tronçon de ce même parcours (STC → plan → RF1).
 */
const SEQUENCE = [
  { insertAt: 0, sceneType: 'room', sceneId: 901, waypoints: 2 },
  { insertAt: 1, sceneType: 'map', sceneId: null, waypoints: 2 },
  { insertAt: 2, sceneType: 'room', sceneId: 902, waypoints: 2 },
  { insertAt: 3, sceneType: 'room', sceneId: 901, waypoints: 3 }
];

/* ─────────────── LES NOMS ─────────────── */

test('une scène porte le nom que l\'exploitant lui donne', () => {
  assert.equal(sceneLabel({ sceneType: 'room', sceneId: 901 }, CONTEXTE), 'STC');
  assert.equal(sceneLabel({ sceneType: 'baie', sceneId: 'B-12' }, CONTEXTE), 'Baie 12');
  assert.equal(sceneLabel({ sceneType: 'map', sceneId: null }, CONTEXTE), MAP_SCENE_LABEL);
});

test('un nom inconnu donne une désignation HONNÊTE, jamais un nom inventé', () => {
  assert.equal(sceneLabel({ sceneType: 'room', sceneId: 777 }, CONTEXTE), 'Salle 777');
  assert.equal(sceneLabel({ sceneType: 'baie', sceneId: 'X' }, CONTEXTE), 'Baie X');
  assert.equal(sceneLabel({ sceneType: 'satellite' }, CONTEXTE), 'Scène inconnue');
});

/* ─────────────── LE PARCOURS ─────────────── */

test('une scène traversée DEUX fois est numérotée ; une seule fois ne l\'est pas', () => {
  const etapes = routeSequenceLabels(SEQUENCE, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.label), ['STC (1)', 'Plan général', 'RF1', 'STC (2)']);
  // Un « (1) » unique suggérerait qu'il existe un second passage.
  assert.equal(etapes[1].repeated, false);
  assert.equal(etapes[2].repeated, false);
  assert.equal(etapes[0].repeated, true);
  assert.equal(etapes[3].occurrence, 2);
});

test('le parcours se lit en UNE phrase — la rupture non documentée y est DITE, pas cachée', () => {
  /*
   * RF1 → STC (2) saute directement d'une salle à l'autre sans repasser par le plan :
   * rien ne documente ce passage. Le taire derrière une flèche ordinaire affirmerait un
   * cheminement relevé qui ne l'a jamais été.
   */
  assert.equal(
    routeSequenceSentence(SEQUENCE, CONTEXTE),
    `STC (1) → Plan général → RF1 → ${UNDOCUMENTED_TRANSITION_LABEL} → STC (2)`
  );
  assert.equal(routeSequenceSentence([], CONTEXTE), '');
});

/* ─────────────── LA RUPTURE NON CARTOGRAPHIÉE ─────────────── */

test('salle → plan → salle (cas 3) : aucune rupture, la scène commune est le plan', () => {
  const sequence = [
    { insertAt: 0, sceneType: 'room', sceneId: 901, waypoints: 2 },
    { insertAt: 1, sceneType: 'map', sceneId: null, waypoints: 2 },
    { insertAt: 2, sceneType: 'room', sceneId: 902, waypoints: 2 }
  ];
  const etapes = routeSequenceLabels(sequence, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.gapBefore), [false, false, false]);
  assert.equal(routeSequenceSentence(sequence, CONTEXTE), 'STC → Plan général → RF1');
  assert.ok(!routeSequenceSentence(sequence, CONTEXTE).includes(UNDOCUMENTED_TRANSITION_LABEL));
});

test('baie → salle → baie (cas 2) : aucune rupture, la scène commune est la salle', () => {
  const sequence = [
    { insertAt: 0, sceneType: 'baie', sceneId: 'B-12', waypoints: 2 },
    { insertAt: 1, sceneType: 'room', sceneId: 901, waypoints: 2 },
    { insertAt: 2, sceneType: 'baie', sceneId: 'B-13', waypoints: 2 }
  ];
  const etapes = routeSequenceLabels(sequence, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.gapBefore), [false, false, false]);
  assert.equal(routeSequenceSentence(sequence, CONTEXTE), 'Baie 12 → STC → Baie 13');
});

test('équipement → équipement dans la MÊME baie : un seul segment, aucune transition à juger', () => {
  /* Le cas 1 (même baie) ne traverse jamais deux scènes : il n'y a rien à rompre. */
  const sequence = [{ insertAt: 0, sceneType: 'baie', sceneId: 'B-12', waypoints: 2 }];
  const etapes = routeSequenceLabels(sequence, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.gapBefore), [false]);
  assert.equal(routeSequenceSentence(sequence, CONTEXTE), 'Baie 12');
});

test('salle → salle DIRECTEMENT (sans plan entre les deux) : rupture honnête', () => {
  const sequence = [
    { insertAt: 0, sceneType: 'room', sceneId: 901, waypoints: 2 },
    { insertAt: 1, sceneType: 'room', sceneId: 902, waypoints: 2 }
  ];
  const etapes = routeSequenceLabels(sequence, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.gapBefore), [false, true]);
  assert.equal(routeSequenceSentence(sequence, CONTEXTE), `STC → ${UNDOCUMENTED_TRANSITION_LABEL} → RF1`);
});

test('baie → baie DIRECTEMENT (sans salle entre les deux) : rupture honnête', () => {
  const sequence = [
    { insertAt: 0, sceneType: 'baie', sceneId: 'B-12', waypoints: 2 },
    { insertAt: 1, sceneType: 'baie', sceneId: 'B-13', waypoints: 2 }
  ];
  const etapes = routeSequenceLabels(sequence, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.gapBefore), [false, true]);
  assert.equal(routeSequenceSentence(sequence, CONTEXTE), `Baie 12 → ${UNDOCUMENTED_TRANSITION_LABEL} → Baie 13`);
});

test('deux passages CONSÉCUTIFS de la même scène ne sont jamais une rupture', () => {
  /* Une même scène répétée à la suite n'est pas une rupture — c'est la même scène. */
  const sequence = [
    { insertAt: 0, sceneType: 'room', sceneId: 901, waypoints: 2 },
    { insertAt: 1, sceneType: 'room', sceneId: 901, waypoints: 1 }
  ];
  assert.deepEqual(routeSequenceLabels(sequence, CONTEXTE).map(e => e.gapBefore), [false, false]);
});

test('le plan général n\'est jamais des deux côtés d\'une rupture', () => {
  /* Un seul plan existe : deux passages « map » consécutifs sont la même scène, jamais
     une rupture — même si un futur multi-scènes leur donnait un jour des identifiants
     distincts, le plan reste par nature la scène commune, jamais l'objet d'une rupture. */
  const sequence = [
    { insertAt: 0, sceneType: 'map', sceneId: null, waypoints: 2 },
    { insertAt: 1, sceneType: 'map', sceneId: 'autre-plan', waypoints: 1 }
  ];
  assert.deepEqual(routeSequenceLabels(sequence, CONTEXTE).map(e => e.gapBefore), [false, false]);
});

test('l\'ordre affiché est l\'ordre RELEVÉ — aucun tri, aucun regroupement', () => {
  /*
   * Regrouper les deux passages par STC produirait une phrase lisible et FAUSSE : elle
   * affirmerait un cheminement que personne n'a relevé.
   */
  const etapes = routeSequenceLabels(SEQUENCE, CONTEXTE);
  assert.deepEqual(etapes.map(e => e.insertAt), [0, 1, 2, 3]);
  assert.deepEqual(etapes.map(e => `${e.sceneType}:${e.sceneId}`),
    ['room:901', 'map:null', 'room:902', 'room:901']);
});

test('les rangs rendus sont ceux que `startSegment` exige', () => {
  assert.deepEqual(routeSequenceLabels(SEQUENCE, CONTEXTE).map(e => e.insertAt),
    SEQUENCE.map(e => e.insertAt));
});

/* ─────────────── OÙ INSÉRER ─────────────── */

test('les positions d\'insertion sont posées DANS la phrase, pas dans un tableau', () => {
  assert.deepEqual(insertionChoices(SEQUENCE, CONTEXTE), [
    { insertAt: 0, label: 'Avant STC (1)' },
    { insertAt: 1, label: 'Entre STC (1) et Plan général' },
    { insertAt: 2, label: 'Entre Plan général et RF1' },
    { insertAt: 3, label: 'Entre RF1 et STC (2)' },
    { insertAt: 4, label: 'Après STC (2)' }
  ]);
});

test('« après le dernier passage » vaut bien la longueur du parcours', () => {
  const choix = insertionChoices(SEQUENCE, CONTEXTE);
  assert.equal(choix[choix.length - 1].insertAt, SEQUENCE.length);
});

test('sans parcours, il n\'y a qu\'une place — et on le dit', () => {
  assert.deepEqual(insertionChoices([], CONTEXTE), [{ insertAt: 0, label: 'Premier passage du parcours' }]);
});

/* ─────────────── LA PASTILLE ─────────────── */

const trace = status => ({ version: 1, status, segments: [{ sceneType: 'room', sceneId: 901 }] });

test('la pastille dit la vérité, et « proposé » ne se déguise pas en « vérifié »', () => {
  assert.deepEqual({ ...routeBadge(trace('verified')) }, { text: 'Tracé vérifié', tone: 'verifie', verified: true });
  const propose = routeBadge(trace('proposed'));
  assert.equal(propose.verified, false);
  assert.match(propose.text, /Proposé/i);
  assert.ok(!/vérifié/i.test(propose.text));
  assert.equal(routeBadge(trace('unknown')).verified, false);
});

test('absence et hors-périmètre sont DEUX faits distincts', () => {
  assert.equal(routeBadge(null).text, MISSING_ROUTE_LABEL);
  assert.equal(routeBadge(null).tone, 'absent');
  const partiel = { version: 1, status: 'verified', segments: [{ sceneType: 'room', sceneId: 901 }], partial: true };
  assert.equal(routeBadge(partiel).text, PARTIAL_ROUTE_LABEL);
  assert.equal(routeBadge(partiel).tone, 'protege');
  // Un tracé amputé ne se présente jamais comme vérifié, quel que soit son statut stocké.
  assert.equal(routeBadge(partiel).verified, false);
  assert.notEqual(routeBadge(null).text, routeBadge(partiel).text);
});

test('la couleur ACCOMPAGNE le texte, elle ne le remplace pas', () => {
  // Une pastille qui ne se distinguerait que par sa teinte ne dirait rien à qui ne la
  // distingue pas — et « vérifié » est précisément ce qu'il ne faut pas deviner.
  for (const status of ['verified', 'proposed', 'unknown']) {
    const pastille = routeBadge(trace(status));
    assert.ok(pastille.text && pastille.text.length > 3, `« ${status} » doit porter un texte`);
  }
  const tons = ['verified', 'proposed', 'unknown'].map(s => routeBadge(trace(s)).tone);
  assert.equal(new Set(tons).size, 3, 'chaque état garde son propre ton');
});

/*
 * UN `portId` LOGIQUE N'EST PAS UNE PREUVE DE PIXEL — endpointVisualPositionLabel
 * ----------------------------------------------------------------------------------
 * Le seul fait vérifiable est celui que documente nested-shape-contract.js : une forme ou
 * un point pour l'entité PORTEUSE (baie, équipement, composant), jamais pour le
 * connecteur. Ces cas couvrent chaque type d'extrémité et chaque état de résolution.
 */

test('un composant avec shapeInEquipment est un repère visuel DOCUMENTÉ', () => {
  const bout = { state: 'resolved', type: 'component', entity: { id: 'c1', [SHAPE_IN_EQUIPMENT_FIELD]: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } } };
  assert.equal(endpointVisualPositionLabel(bout), PORT_POSITION_DOCUMENTED_LABEL);
});

test('un composant SANS shapeInEquipment reste à confirmer — jamais un pixel inventé', () => {
  const bout = { state: 'resolved', type: 'component', entity: { id: 'c1' } };
  assert.equal(endpointVisualPositionLabel(bout), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('un équipement monté en baie regarde shapeInBaie, jamais shapeInRoom', () => {
  const dansBaie = { state: 'resolved', type: 'equipment', entity: { id: 'e1', baieId: 'B1', [SHAPE_IN_ROOM_FIELD]: { type: 'rect', x: 9, y: 9, w: 9, h: 9 } } };
  // shapeInRoom existe, mais cet équipement est monté EN BAIE : ce champ-là ne le regarde
  // pas, et l'ignorer prouve que la fonction ne confond pas les deux référentiels.
  assert.equal(endpointVisualPositionLabel(dansBaie), PORT_POSITION_TO_CONFIRM_LABEL);
  const avecShapeInBaie = { state: 'resolved', type: 'equipment', entity: { id: 'e1', baieId: 'B1', [SHAPE_IN_BAIE_FIELD]: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } } };
  assert.equal(endpointVisualPositionLabel(avecShapeInBaie), PORT_POSITION_DOCUMENTED_LABEL);
});

test('un équipement direct de salle regarde shapeInRoom OU le point hérité x_inRoom/y_inRoom', () => {
  const avecForme = { state: 'resolved', type: 'equipment', entity: { id: 'e2', [SHAPE_IN_ROOM_FIELD]: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } } };
  assert.equal(endpointVisualPositionLabel(avecForme), PORT_POSITION_DOCUMENTED_LABEL);
  const avecPointHerite = { state: 'resolved', type: 'equipment', entity: { id: 'e2', x_inRoom: 40, y_inRoom: 60 } };
  assert.equal(endpointVisualPositionLabel(avecPointHerite), PORT_POSITION_DOCUMENTED_LABEL);
  const rien = { state: 'resolved', type: 'equipment', entity: { id: 'e2' } };
  assert.equal(endpointVisualPositionLabel(rien), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('un écran n’a aucun champ de position documenté : toujours « à confirmer », jamais deviné', () => {
  const bout = { state: 'resolved', type: 'screen', entity: { id: 's1', x: 100, y: 100 } };
  assert.equal(endpointVisualPositionLabel(bout), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('une extrémité protégée ou introuvable n’a pas d’entité à interroger : « à confirmer »', () => {
  assert.equal(endpointVisualPositionLabel({ state: 'protected', entity: null }), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel({ state: 'missing', entity: null }), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel({}), PORT_POSITION_TO_CONFIRM_LABEL);
});

/*
 * ─────────── `Number(null)` VAUT ZÉRO, ET ZÉRO EST UNE POSITION ───────────
 *
 * `nestedPlacement()` convertit chaque coordonnée héritée par `Number()`. Or `Number(null)`
 * et `Number('')` valent 0 — un nombre parfaitement fini. Un équipement ancien dont le
 * relevé n'a jamais été fait, et qui porte `x_inRoom: null` ou `x_inRoom: ''`, ressortait
 * donc « point documenté en (0,0) », et le Flux de signal affirmait « Repère visuel
 * documenté sur sa photo » pour une position que personne n'a jamais posée. C'est
 * exactement l'inverse de ce que ce lot promet.
 *
 * La règle vérifiée ici : le repli sur point hérité n'est accepté que si LES DEUX valeurs
 * d'origine sont réellement présentes, non vides, et numériquement finies. Le zéro réel
 * reste une position valide — c'est le coin haut-gauche de la photo, pas une absence — et
 * la chaîne « 0 » aussi, parce que le stock hérité écrit des nombres en texte.
 */

const boutSalle = (x, y) => ({ state: 'resolved', type: 'equipment', entity: { id: 'e-legacy', x_inRoom: x, y_inRoom: y } });
const boutBaie = (x, y) => ({ state: 'resolved', type: 'equipment', entity: { id: 'e-legacy', baieId: 'B9', x_inBaie: x, y_inBaie: y } });

test('scène Salle — `null` n’est pas un relevé : ni `Number(null)`, ni (0,0), ni « documenté »', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle(null, null)), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('scène Salle — une chaîne vide n’est pas un relevé non plus', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle('', '')), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle('   ', '   ')), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('scène Salle — une paire à moitié remplie reste à confirmer, dans les deux sens', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle(40, null)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(null, 60)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(40, '')), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle('', 60)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(40, undefined)), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('scène Baie — exactement les mêmes règles sur x_inBaie / y_inBaie', () => {
  assert.equal(endpointVisualPositionLabel(boutBaie(null, null)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutBaie('', '')), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutBaie(120, null)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutBaie(null, 80)), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('le zéro RÉEL reste une position — c’est le coin de la photo, pas une absence', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle(0, 0)), PORT_POSITION_DOCUMENTED_LABEL);
  assert.equal(endpointVisualPositionLabel(boutBaie(0, 0)), PORT_POSITION_DOCUMENTED_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(0, 140)), PORT_POSITION_DOCUMENTED_LABEL);
});

test('le stock hérité écrit des nombres en texte : « 0 » et « 140 » restent des relevés', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle('0', '0')), PORT_POSITION_DOCUMENTED_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle('140', '92')), PORT_POSITION_DOCUMENTED_LABEL);
  assert.equal(endpointVisualPositionLabel(boutBaie('12.5', '7')), PORT_POSITION_DOCUMENTED_LABEL);
});

test('ce qui n’est pas un nombre ne devient pas un nombre — booléens, objets, tableaux', () => {
  assert.equal(endpointVisualPositionLabel(boutSalle(true, true)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle([], [])), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle({}, {})), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(Infinity, 3)), PORT_POSITION_TO_CONFIRM_LABEL);
  assert.equal(endpointVisualPositionLabel(boutSalle(NaN, 3)), PORT_POSITION_TO_CONFIRM_LABEL);
});

test('une forme valide reste DOCUMENTÉE — ce durcissement ne touche que le repli sur point', () => {
  const formeMalgreNull = { state: 'resolved', type: 'equipment', entity: { id: 'e3', x_inRoom: null, y_inRoom: null, [SHAPE_IN_ROOM_FIELD]: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } } };
  assert.equal(endpointVisualPositionLabel(formeMalgreNull), PORT_POSITION_DOCUMENTED_LABEL);
  const formeBaieMalgreVide = { state: 'resolved', type: 'equipment', entity: { id: 'e4', baieId: 'B9', x_inBaie: '', y_inBaie: '', [SHAPE_IN_BAIE_FIELD]: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } } };
  assert.equal(endpointVisualPositionLabel(formeBaieMalgreVide), PORT_POSITION_DOCUMENTED_LABEL);
});
