import test from 'node:test';
import assert from 'node:assert/strict';
import { planStoreReplacement, recordsExactlyEqual } from '../snapshot-store-plan.js';

test('IDENTICAL_SNAPSHOT: un instantané identique ne produit aucune mutation', () => {
  const before = [{ id:'kb-1', title:'A', nested:{ b:2, a:1 }, _revision:3 }];
  const incoming = [{ _revision:3, nested:{ a:1, b:2 }, title:'A', id:'kb-1' }];
  const plan = planStoreReplacement(before, incoming, { authoritative:true });
  assert.deepEqual(plan.puts, []);
  assert.deepEqual(plan.deletes, []);
  assert.equal(recordsExactlyEqual(before[0], incoming[0]), true);
});

test('REMOTE_UPDATE: une vraie modification, révision comprise, produit un put', () => {
  const before = [{ id:'kb-1', title:'A', _revision:3 }];
  const incoming = [{ id:'kb-1', title:'B', _revision:4 }];
  const plan = planStoreReplacement(before, incoming, { authoritative:true });
  assert.deepEqual(plan.puts, incoming);
  assert.deepEqual(plan.deletes, []);
});

test('REMOTE_DELETE: une fiche serveur absente d’un snapshot autoritaire est supprimée', () => {
  const before = [{ id:'kb-1' }, { id:'kb-2' }];
  const incoming = [{ id:'kb-2' }];
  const plan = planStoreReplacement(before, incoming, { authoritative:true });
  assert.deepEqual(plan.deletes, ['kb-1']);
  assert.deepEqual(plan.puts, []);
});

test('TOMBSTONE: la suppression explicite gagne sur un entrant contradictoire', () => {
  const before = [{ id:'kb-1', title:'ancien' }];
  const incoming = [{ id:'kb-1', title:'nouveau' }];
  const plan = planStoreReplacement(before, incoming, {
    authoritative:false,
    tombstones:['kb-1']
  });
  assert.deepEqual(plan.deletes, ['kb-1']);
  assert.deepEqual(plan.puts, []);
});

test('ZONE_REVOKE: un snapshot autoritaire vide retire les fiches serveur', () => {
  const before = [{ id:'zone-a' }, { id:'zone-b' }];
  const plan = planStoreReplacement(before, [], { authoritative:true });
  assert.deepEqual(plan.deletes, ['zone-a', 'zone-b']);
});

test('LOCAL_SURVIVOR: une fiche locale protégée survit à l’absence autoritaire', () => {
  const before = [{ id:'current-room', currentRoomId:'room-1' }, { id:'server-row' }];
  const plan = planStoreReplacement(before, [], {
    authoritative:true,
    survivesAuthoritativeClear:record => record.id === 'current-room'
  });
  assert.deepEqual(plan.conserves, ['current-room']);
  assert.deepEqual(plan.deletes, ['server-row']);
});

test('non autoritaire: une absence seule ne supprime rien', () => {
  const before = [{ id:'kb-1' }];
  const plan = planStoreReplacement(before, [], { authoritative:false });
  assert.deepEqual(plan.deletes, []);
});

test('un entrant sans id reste une écriture pour préserver l’auto-incrément', () => {
  const record = { title:'sans id' };
  const plan = planStoreReplacement([], [record], { authoritative:true });
  assert.deepEqual(plan.puts, [record]);
});
