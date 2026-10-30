import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinateEditSession, saveCoordinateEditSession } from '../map-coordinate-edit-session.js';

test('Annuler restaure exactement les coordonnées, y compris une propriété initialement absente', () => {
  const a = { id:'a', x_inRoom:10, y_inRoom:20 };
  const b = { id:'b' };
  const session = createCoordinateEditSession([a, b], ['x_inRoom','y_inRoom']);

  a.x_inRoom = 90; a.y_inRoom = 80; session.markDirty(a);
  b.x_inRoom = 33; b.y_inRoom = 44; session.markDirty(b);
  assert.deepEqual(session.dirtyIds().sort(), ['a','b']);

  session.restore();
  assert.deepEqual(a, { id:'a', x_inRoom:10, y_inRoom:20 });
  assert.deepEqual(b, { id:'b' });
  assert.deepEqual(session.dirtyIds(), []);
});

test('une sauvegarde complète acquitte uniquement après succès', async () => {
  const a = { id:'a', x_inBaie:15, y_inBaie:25 };
  const session = createCoordinateEditSession([a], ['x_inBaie','y_inBaie']);
  a.x_inBaie = 45; session.markDirty(a);
  const calls = [];

  const result = await saveCoordinateEditSession(session, async record => { calls.push(record.id); });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.saved, ['a']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(calls, ['a']);
});

test('R1 succès + R2 STALE_WRITE reste explicitement PARTIEL et R2 reste sale', async () => {
  const r1 = { id:'r1', x_inRoom:1, y_inRoom:2 };
  const r2 = { id:'r2', x_inRoom:3, y_inRoom:4 };
  const session = createCoordinateEditSession([r1, r2], ['x_inRoom','y_inRoom']);
  r1.x_inRoom = 11; r2.x_inRoom = 33;
  session.markDirty(r1); session.markDirty(r2);

  const result = await saveCoordinateEditSession(session, async record => {
    if (record.id === 'r2') {
      throw Object.assign(new Error('Écriture obsolète'), { status:409, code:'STALE_WRITE' });
    }
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.saved, ['r1']);
  assert.deepEqual(result.pending, ['r2']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'STALE_WRITE');
  assert.equal(result.failed[0].status, 409);
  assert.equal(session.isDirty('r1'), false);
  assert.equal(session.isDirty('r2'), true);
});

test('un échec total ne produit jamais un faux succès', async () => {
  const record = { id:'r1', x_inRoom:1, y_inRoom:2 };
  const session = createCoordinateEditSession([record], ['x_inRoom','y_inRoom']);
  record.y_inRoom = 22; session.markDirty(record);
  const result = await saveCoordinateEditSession(session, async () => {
    throw Object.assign(new Error('Serveur indisponible'), { status:503, code:'HTTP_503' });
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.pending, ['r1']);
});

test('après succès, un nouveau déplacement devient une nouvelle dette', async () => {
  const record = { id:'r1', x_inRoom:1, y_inRoom:2 };
  const session = createCoordinateEditSession([record], ['x_inRoom','y_inRoom']);
  record.x_inRoom = 10; session.markDirty(record);
  await saveCoordinateEditSession(session, async () => {});
  record.x_inRoom = 20; session.markDirty(record);
  assert.deepEqual(session.dirtyIds(), ['r1']);
});
