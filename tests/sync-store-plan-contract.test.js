import test from 'node:test';
import assert from 'node:assert/strict';
import { planStoreReplacement } from '../snapshot-store-plan.js';

test('tombstone explicite gagne même contre un entrant contradictoire', () => {
  const before = [{ id:'x', value:'old' }];
  const incoming = [{ id:'x', value:'new' }];
  const plan = planStoreReplacement(before, incoming, { tombstones:['x'] });
  assert.deepEqual(plan.puts, []);
  assert.deepEqual(plan.deletes, ['x']);
});

test('absence non autoritaire ne supprime aucune fiche', () => {
  const plan = planStoreReplacement([{ id:'x' }], [], { authoritative:false });
  assert.deepEqual(plan.deletes, []);
});

test('révision distante différente reste une vraie mise à jour', () => {
  const plan = planStoreReplacement(
    [{ id:'x', value:'same', _revision:3 }],
    [{ id:'x', value:'same', _revision:4 }],
    { authoritative:true }
  );
  assert.equal(plan.puts.length, 1);
  assert.equal(plan.puts[0]._revision, 4);
});
