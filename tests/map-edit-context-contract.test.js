import test from 'node:test';
import assert from 'node:assert/strict';
import { editableMapEntityFromView } from '../map-edit-context-contract.js';

test('la vue salle remplace immédiatement une baie précédente', () => {
  assert.deepEqual(editableMapEntityFromView({ type:'baie', id:'b01-pool' }), { type:'baie', id:'b01-pool' });
  assert.deepEqual(editableMapEntityFromView({ type:'room', id:'stc' }), { type:'room', id:'stc' });
});

test('une vue équipement ou carte générale n’autorise pas l’éditeur salle/baie', () => {
  assert.equal(editableMapEntityFromView({ type:'equipment', id:'eq-1' }), null);
  assert.equal(editableMapEntityFromView({ type:'map' }), null);
  assert.equal(editableMapEntityFromView(null), null);
});

test('un identifiant absent ou vide ne produit aucune cible éditable', () => {
  assert.equal(editableMapEntityFromView({ type:'room' }), null);
  assert.equal(editableMapEntityFromView({ type:'baie', id:'   ' }), null);
});
