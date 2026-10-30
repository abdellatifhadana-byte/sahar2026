import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCentralSyncTransitionGate,
  installCentralSyncTransitionGuard
} from '../central-sync-transition-guard.js';

test('le premier synced passe, les heartbeats synced successifs sont filtrés', () => {
  const gate = createCentralSyncTransitionGate();
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);
  assert.equal(gate.state(), 'synced');
  assert.equal(gate.suppressed(), 2);
});

test('un état transitoire syncing ne transforme pas un heartbeat en recovery', () => {
  const gate = createCentralSyncTransitionGate();
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'syncing' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);
  assert.equal(gate.suppressed(), 1);
});

test('offline puis synced est une vraie récupération et doit passer', () => {
  const gate = createCentralSyncTransitionGate();
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'offline' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);
});

test('warning, conflict, unauthenticated et local réarment chacun un recovery synced', () => {
  for (const state of ['warning','conflict','unauthenticated','local']) {
    const gate = createCentralSyncTransitionGate();
    assert.equal(gate.shouldPropagate({ state:'synced' }), true, state);
    assert.equal(gate.shouldPropagate({ state }), true, state);
    assert.equal(gate.shouldPropagate({ state:'synced' }), true, state);
  }
});

test('un snapshot réellement modifié autorise le synced suivant même si la connexion était déjà stable', () => {
  const gate = createCentralSyncTransitionGate();
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);

  assert.equal(gate.noteSnapshotDiff({ changedEntities:[{ store:'equipments', id:'42' }], deletedEntities:[] }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), true);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);

  // Un récapitulatif vide ne doit pas transformer un heartbeat en événement métier.
  assert.equal(gate.noteSnapshotDiff({ changedEntities:[], deletedEntities:[] }), false);
  assert.equal(gate.shouldPropagate({ state:'synced' }), false);
});

test('les événements sans état ne sont jamais bloqués', () => {
  const gate = createCentralSyncTransitionGate();
  assert.equal(gate.shouldPropagate({}), true);
  assert.equal(gate.shouldPropagate(null), true);
  assert.equal(gate.state(), 'initial');
});

test('la garde installée laisse passer first/recovery/diff synced mais pas le heartbeat idle', () => {
  const listeners = [];
  const target = {
    addEventListener(type, listener, options = {}) {
      listeners.push({ type, listener, options });
    }
  };
  const dispatch = (type, detail) => {
    const event = {
      detail,
      stopped:false,
      stopImmediatePropagation() { this.stopped = true; }
    };
    for (const entry of listeners.filter(item => item.type === type)) {
      entry.listener(event);
      if (event.stopped) break;
    }
  };

  const guard = installCentralSyncTransitionGuard(target);
  const seen = [];
  target.addEventListener('central-sync-status', event => seen.push(event.detail.state));

  dispatch('central-sync-status', { state:'synced' });
  dispatch('central-sync-status', { state:'synced' });
  dispatch('central-sync-status', { state:'syncing' });
  dispatch('central-sync-status', { state:'synced' });
  dispatch('platform-snapshot-applied', { changedEntities:[{ store:'rooms', id:'room-1' }], deletedEntities:[] });
  dispatch('central-sync-status', { state:'synced' });
  dispatch('central-sync-status', { state:'synced' });
  dispatch('central-sync-status', { state:'offline' });
  dispatch('central-sync-status', { state:'synced' });

  assert.deepEqual(seen, ['synced','syncing','synced','offline','synced']);
  assert.equal(guard.suppressed(), 3);
});
