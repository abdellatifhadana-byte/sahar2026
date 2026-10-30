/**
 * @file component-shape-contract.test.js — `component.shapeInEquipment` doit survivre à
 *       CHAQUE endroit qui reconstruit un composant, pas seulement à sa première écriture.
 *
 * LE DÉFAUT QUE CE FICHIER FERME.
 * --------------------------------------------------------------------------------------
 * `normalizeComponents` (equipment-internals.js) reconstruit CHAQUE composant depuis une
 * liste de champs fixe — c'est ce qui permet d'ignorer un composant mal formé sans jamais
 * planter, mais un champ absent de cette liste ne survit à AUCUN appel. Cette fonction
 * tourne à la moindre ouverture de l'éditeur (`installInternalsEditor`) et à CHAQUE
 * enregistrement de l'équipement (le `onsubmit` du formulaire y passe `components` avant
 * `db.save`) : sans correction, dessiner une carte sur la photo d'un châssis puis modifier
 * n'importe quel AUTRE champ de ce même composant — ou d'un autre — effacerait la forme en
 * silence, à l'insu de qui l'a dessinée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComponents } from '../equipment-internals-contract.js';
import { SHAPE_IN_ROOM_FIELD, SHAPE_IN_EQUIPMENT_FIELD, nestedShapeOf, nestedPlacement, shapeWithinBounds, cableAnchorFromNestedShape } from '../nested-shape-contract.js';

const FORME = Object.freeze({ type: 'rect', x: 12, y: 8, w: 140, h: 90 });

test('normalizeComponents PRÉSERVE une shapeInEquipment valide', () => {
  const [composant] = normalizeComponents([{ id: 'C1', type: 'Carte broadcast / traitement', name: 'Carte entrée', shapeInEquipment: FORME }]);
  assert.deepEqual(nestedShapeOf(composant, SHAPE_IN_EQUIPMENT_FIELD), FORME);
});

test('un composant SANS shapeInEquipment reste "à placer" — jamais une forme devinée', () => {
  const [composant] = normalizeComponents([{ id: 'C2', type: 'Autre', name: 'Carte sans forme' }]);
  assert.equal(composant.shapeInEquipment, null);
  assert.equal(nestedPlacement(composant, { shapeField: SHAPE_IN_EQUIPMENT_FIELD }).kind, 'unplaced');
});

test('une géométrie malformée est REJETÉE, jamais réparée en silence', () => {
  const [composant] = normalizeComponents([{ id: 'C3', type: 'Autre', name: 'Carte', shapeInEquipment: { type: 'rect', x: 'oups', w: -5 } }]);
  assert.equal(composant.shapeInEquipment, null, 'une forme illisible doit devenir null, pas une forme inventée pour la sauver');
});

test('un composant ANCIEN (sans le champ) traverse la normalisation sans être perturbé ailleurs', () => {
  const brut = { id: 'C4', type: 'Disque SSD', name: 'SSD 1', manufacturer: 'Acme', model: 'X1', slot: 'Baie 2', notes: 'RAS' };
  const [composant] = normalizeComponents([brut]);
  assert.equal(composant.shapeInEquipment, null);
  assert.equal(composant.manufacturer, 'Acme');
  assert.equal(composant.model, 'X1');
  assert.equal(composant.slot, 'Baie 2');
  assert.equal(composant.notes, 'RAS');
});

/*
 * ─────────────────────────────────────────────────────────────────────────────────────
 * LA RÉGRESSION DEMANDÉE : normaliser → modifier un champ SANS RAPPORT → enregistrer →
 * recharger → la forme doit être IDENTIQUE, au pixel près.
 *
 * « Enregistrer » et « recharger » n'existent pas comme deux fonctions séparées ici : c'est
 * la MÊME `normalizeComponents` qui tourne à l'ouverture de l'éditeur (chargement) et au
 * `onsubmit` (enregistrement) — ce test rejoue donc exactement cette séquence réelle, deux
 * appels distincts, jamais une seule normalisation qu'on se contenterait de relire.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
test('RÉGRESSION : shapeInEquipment survit à normalize → édition non liée → save → reload', () => {
  const chargeInitiale = normalizeComponents([{
    id: 'C5', type: 'Carte broadcast / traitement', name: 'Carte sortie', manufacturer: 'Ross',
    model: 'DFR-8322', slot: 'Slot 5-6', verificationStatus: 'verified', shapeInEquipment: FORME,
    ports: [{ id: 'P1', number: '1', type: 'BNC / SDI', direction: 'OUT', behavior: 'fixed', label: 'SDI OUT 1' }]
  }]);
  const composant = chargeInitiale[0];

  // Édition SANS RAPPORT — exactement ce qu'un opérateur ferait dans l'éditeur : changer le
  // statut, ajouter une note. Ni le champ de forme ni les ports n'entrent en jeu ici.
  composant.status = 'Maintenance';
  composant.notes = 'Contrôle programmé';

  // « save » — le même normalizeComponents que `installInternalsEditor` appelle avant db.save.
  const enregistre = normalizeComponents([composant])[0];
  assert.deepEqual(nestedShapeOf(enregistre, SHAPE_IN_EQUIPMENT_FIELD), FORME, 'la forme doit survivre à l’enregistrement après une édition non liée');
  assert.equal(enregistre.status, 'Maintenance');
  assert.equal(enregistre.notes, 'Contrôle programmé');

  // « reload » — une page fraîche qui relit l'équipement renormalise ses composants de la
  // même façon (voir showQuickView, flattenComponents) : un second appel indépendant.
  const recharge = normalizeComponents([enregistre])[0];
  assert.deepEqual(nestedShapeOf(recharge, SHAPE_IN_EQUIPMENT_FIELD), FORME, 'la forme doit survivre au rechargement');
  assert.equal(recharge.ports.length, 1, 'les ports du composant survivent aussi, inchangés');
  assert.equal(recharge.ports[0].label, 'SDI OUT 1');
});

test('éditer les PORTS du composant ne touche pas sa shapeInEquipment', () => {
  const [composant] = normalizeComponents([{ id: 'C6', type: 'Châssis / frame interne', name: 'Châssis', shapeInEquipment: FORME, ports: [] }]);
  // Édition de ports telle que `renderComponentPorts` la fait : ajout en place, puis re-save.
  composant.ports.push({ id: 'P-new', number: '2', type: 'BNC / SDI', direction: 'IN', behavior: 'fixed', label: 'Entrée' });
  const enregistre = normalizeComponents([composant])[0];
  assert.deepEqual(nestedShapeOf(enregistre, SHAPE_IN_EQUIPMENT_FIELD), FORME);
  assert.equal(enregistre.ports.length, 1);
});

/*
 * ─────────────────────────────────────────────────────────────────────────────────────
 * LA RÉUTILISATION DU CONTRAT GÉNÉRIQUE — `nested-shape-contract.js` ne connaissait que
 * `shapeInRoom`/`shapeInBaie` par LEURS CONSTANTES, jamais par une géométrie propre à l'une
 * d'elles : ajouter `SHAPE_IN_EQUIPMENT_FIELD` suffit à leur faire servir un troisième
 * niveau. Ces tests le prouvent avec les MÊMES fonctions que baie/équipement, sans qu'une
 * seule ligne de nested-shape-contract.js n'ait dû changer pour le composant.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
test('SHAPE_IN_EQUIPMENT_FIELD est un troisième espace, indépendant de shapeInRoom', () => {
  const composant = { id: 'C10', shapeInEquipment: FORME, shapeInRoom: { type: 'rect', x: 0, y: 0, w: 5, h: 5 } };
  assert.deepEqual(nestedShapeOf(composant, SHAPE_IN_EQUIPMENT_FIELD), FORME);
  assert.notDeepEqual(nestedShapeOf(composant, SHAPE_IN_ROOM_FIELD), FORME);
});

test('shapeWithinBounds rejette une carte entièrement hors de la photo du châssis', () => {
  const [composant] = normalizeComponents([{ id: 'C11', type: 'Autre', name: 'Carte', shapeInEquipment: { type: 'rect', x: 5000, y: 5000, w: 50, h: 50 } }]);
  assert.equal(shapeWithinBounds(composant.shapeInEquipment, 1920, 1080), false);
});

test('shapeWithinBounds accepte une carte qui déborde partiellement (photo mal cadrée)', () => {
  const [composant] = normalizeComponents([{ id: 'C12', type: 'Autre', name: 'Carte', shapeInEquipment: { type: 'rect', x: 1900, y: 10, w: 100, h: 50 } }]);
  assert.equal(shapeWithinBounds(composant.shapeInEquipment, 1920, 1080), true);
});

test('cableAnchorFromNestedShape rend le centroïde de la carte — jamais une position de port devinée', () => {
  const [composant] = normalizeComponents([{ id: 'C13', type: 'Autre', name: 'Carte', shapeInEquipment: FORME }]);
  const ancre = cableAnchorFromNestedShape(composant, SHAPE_IN_EQUIPMENT_FIELD);
  assert.deepEqual(ancre, { x: FORME.x + FORME.w / 2, y: FORME.y + FORME.h / 2 });
});

test('cableAnchorFromNestedShape rend null pour un composant non placé — rien à ancrer', () => {
  const [composant] = normalizeComponents([{ id: 'C14', type: 'Autre', name: 'Carte sans forme' }]);
  assert.equal(cableAnchorFromNestedShape(composant, SHAPE_IN_EQUIPMENT_FIELD), null);
});

test('plusieurs composants du même équipement gardent CHACUN sa propre forme, sans se mélanger', () => {
  const AUTRE_FORME = Object.freeze({ type: 'polygon', points: [{ x: 5, y: 5 }, { x: 60, y: 5 }, { x: 60, y: 40 }, { x: 5, y: 40 }] });
  const composants = normalizeComponents([
    { id: 'C7', type: 'Autre', name: 'Carte A', shapeInEquipment: FORME },
    { id: 'C8', type: 'Autre', name: 'Carte B', shapeInEquipment: AUTRE_FORME },
    { id: 'C9', type: 'Autre', name: 'Carte C sans forme' }
  ]);
  assert.deepEqual(nestedShapeOf(composants[0], SHAPE_IN_EQUIPMENT_FIELD), FORME);
  assert.deepEqual(nestedShapeOf(composants[1], SHAPE_IN_EQUIPMENT_FIELD), AUTRE_FORME);
  assert.equal(composants[2].shapeInEquipment, null);
});
