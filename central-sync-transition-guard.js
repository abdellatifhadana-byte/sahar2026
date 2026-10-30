/*
 * 2M TECH Platform — Central sync transition guard (#164)
 * --------------------------------------------------------
 * `central-sync-status` est un événement d'ÉTAT, pas un ordre de réensemencement.
 *
 * Le runtime central vérifie le serveur périodiquement et peut réémettre `synced` alors
 * qu'aucune panne, aucun conflit et aucune reconnexion n'ont eu lieu entre-temps. Plusieurs
 * anciens modules de connaissance/terrain utilisaient pourtant chaque `synced` comme un
 * déclencheur de `ensure*()` persistant. Le résultat était une boucle : heartbeat synced →
 * reconcile → écritures kb-* → sync → nouveau heartbeat.
 *
 * Cette garde laisse passer le PREMIER `synced`, tout vrai retour à `synced` après un état
 * terminal différent, ET le `synced` qui suit un `platform-snapshot-applied` non vide : une
 * modification réellement arrivée du serveur peut légitimement nécessiter une projection
 * dérivée. Elle filtre uniquement les heartbeats `synced` d'un état stable SANS diff.
 */

export const CENTRAL_SYNC_TRANSITION_GUARD_VERSION = 2;
const TRANSIENT_STATES = new Set(['syncing']);

export function createCentralSyncTransitionGate(initialTerminalState = 'initial') {
  let terminalState = String(initialTerminalState || 'initial');
  let meaningfulSnapshotPending = false;
  let suppressedSyncedPulses = 0;

  const noteSnapshotDiff = diff => {
    const changed = Number(diff?.changedEntities?.length || 0);
    const deleted = Number(diff?.deletedEntities?.length || 0);
    if (changed > 0 || deleted > 0) meaningfulSnapshotPending = true;
    return meaningfulSnapshotPending;
  };

  const shouldPropagate = detail => {
    const state = String(detail?.state || '').trim().toLowerCase();
    if (!state) return true;

    if (TRANSIENT_STATES.has(state)) return true;

    if (state === 'synced') {
      const repeatedIdleHeartbeat = terminalState === 'synced' && !meaningfulSnapshotPending;
      terminalState = 'synced';
      meaningfulSnapshotPending = false;
      if (repeatedIdleHeartbeat) suppressedSyncedPulses += 1;
      return !repeatedIdleHeartbeat;
    }

    // Tout état terminal différent réarme naturellement la prochaine récupération `synced`.
    terminalState = state;
    meaningfulSnapshotPending = false;
    return true;
  };

  return Object.freeze({
    shouldPropagate,
    noteSnapshotDiff,
    state: () => terminalState,
    suppressed: () => suppressedSyncedPulses
  });
}

export function installCentralSyncTransitionGuard(target = globalThis.window) {
  if (!target?.addEventListener) return null;
  if (target.__centralSyncTransitionGuard) return target.__centralSyncTransitionGuard;

  const gate = createCentralSyncTransitionGate();
  const statusListener = event => {
    if (gate.shouldPropagate(event?.detail)) return;
    // Installé très tôt, avant les anciens enrichisseurs : leurs handlers ne voient pas un
    // heartbeat `synced` redondant. First/recovery/snapshot-change `synced` restent intacts.
    event.stopImmediatePropagation?.();
  };
  const snapshotListener = event => gate.noteSnapshotDiff(event?.detail);

  target.addEventListener('central-sync-status', statusListener, { capture: true });
  target.addEventListener('platform-snapshot-applied', snapshotListener, { capture: true });

  const api = Object.freeze({
    version: CENTRAL_SYNC_TRANSITION_GUARD_VERSION,
    state: gate.state,
    suppressed: gate.suppressed
  });
  Object.defineProperty(target, '__centralSyncTransitionGuard', {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return api;
}
