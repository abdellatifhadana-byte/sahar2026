import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cableEndpointRefs,
  cableRoomIds,
  cableTouchesRoom,
  primaryCableRoomId
} from '../connectivity-contract.js';
import { auditPlatformSnapshot } from '../platform-integrity.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Piège M-12 : `cable.roomId` est un cache écrit une seule fois à la création du câble,
// depuis la salle de la source, et jamais rafraîchi. Ces tests sont comportementaux —
// ils exercent la dérivation, pas la présence d'un motif dans le source.

const equipments = [
  { id: 10, name: 'VTR', roomId: 2 },        // déménagé : le câble le croit encore en salle 1
  { id: 11, name: 'MÉLANGEUR', roomId: 1 },
  { id: 12, name: 'ROUTEUR', roomId: 2 }
];
const screens = [{ id: 90, name: 'MUR', roomId: 3 }];

const cable = (overrides = {}) => ({
  id: 'CAB-1', reference: 'CAB-1',
  sourceType: 'equipment', sourceId: 10, sourcePortId: 'P1',
  destinationType: 'equipment', destinationId: 11, destinationPortId: 'P2',
  roomId: 1,
  ...overrides
});

test('la salle d’un câble se déduit de ses extrémités, jamais de son cache', () => {
  assert.deepEqual(cableRoomIds(cable(), { equipments, screens }), [2, 1]);
  assert.equal(cableTouchesRoom(cable(), 2, { equipments, screens }), true);
  assert.equal(cableTouchesRoom(cable(), 1, { equipments, screens }), true);
  // La salle 3 n'héberge aucune des deux extrémités.
  assert.equal(cableTouchesRoom(cable(), 3, { equipments, screens }), false);
});

test('un câble dont les deux bouts ont quitté la salle n’y est plus rattaché', () => {
  const moved = equipments.map(item => ({ ...item, roomId: 2 }));
  assert.equal(cableTouchesRoom(cable(), 1, { equipments: moved, screens }), false,
    'le cache périmé ne doit plus rattacher le câble à son ancienne salle');
  assert.deepEqual(cableRoomIds(cable(), { equipments: moved, screens }), [2]);
});

test('un câble inter-salles appartient aux deux, ce qu’un champ scalaire ne peut pas dire', () => {
  const interRoom = cable({ destinationType: 'screen', destinationId: 90 });
  assert.deepEqual(cableRoomIds(interRoom, { equipments, screens }), [2, 3]);
  assert.equal(cableTouchesRoom(interRoom, 2, { equipments, screens }), true);
  assert.equal(cableTouchesRoom(interRoom, 3, { equipments, screens }), true);
});

test('câble hérité sans extrémité résolvable : le cache reste le dernier repli', () => {
  const orphan = cable({ sourceId: 999, destinationId: 998, roomId: 7 });
  assert.deepEqual(cableRoomIds(orphan, { equipments, screens }), [7],
    'sans repli, un câble orphelin n’appartiendrait à aucune salle et deviendrait invisible');
  assert.equal(cableTouchesRoom(orphan, 7, { equipments, screens }), true);
});

test('un connecteur est localisé par son équipement parent, côté par côté', () => {
  const refs = cableEndpointRefs(cable({
    sourceType: 'component', sourceId: 'CMP-A', sourceParentEquipmentId: 10,
    destinationType: 'component', destinationId: 'CMP-B', destinationParentEquipmentId: 12
  }));
  assert.equal(refs.length, 2);
  // Le calcul historique choisissait le côté avec `type === record.sourceType` : quand les
  // deux extrémités étaient des composants, la destination reprenait le parent de la source.
  assert.deepEqual(refs.map(ref => String(ref.id)), ['10', '12']);
  assert.deepEqual(refs.map(ref => ref.type), ['equipment', 'equipment']);
});

test('primaryCableRoomId prend la source, puis la destination en repli', () => {
  assert.equal(primaryCableRoomId(cable(), { equipments, screens }), 2);
  const unlocatedSource = [{ id: 10, name: 'VTR', roomId: null }, ...equipments.slice(1)];
  assert.equal(primaryCableRoomId(cable(), { equipments: unlocatedSource, screens }), 1,
    'une source sans salle ne doit pas laisser le câble sans salle du tout');
});

test('l’audit d’intégrité signale un cache de salle périmé sans bloquer', () => {
  // Les DEUX extrémités ont quitté la salle 1 : plus rien n'y rattache le câble,
  // sauf son cache. C'est exactement l'état produit par un déménagement d'équipements.
  const moved = equipments.map(item => ({ ...item, roomId: 2 }));
  const snapshot = { rooms: [{ id: 1 }, { id: 2 }], baies: [], walls: [], docs: [], screens };

  const report = auditPlatformSnapshot({ ...snapshot, equipments: moved, cables: [cable()] });
  const stale = report.issues.cableRoomCacheStale;
  assert.equal(stale.length, 1);
  assert.equal(String(stale[0].cableId), 'CAB-1');
  assert.equal(String(stale[0].storedRoomId), '1');
  assert.deepEqual(stale[0].derivedRoomIds, [2]);
  assert.ok(report.warnings >= 1, 'la dérive doit compter comme avertissement');

  const aligned = auditPlatformSnapshot({ ...snapshot, equipments: moved, cables: [cable({ roomId: 2 })] });
  assert.equal(aligned.issues.cableRoomCacheStale.length, 0,
    'un cache concordant ne doit produire aucun avertissement');

  // Un câble inter-salles ne doit pas être signalé tant que son cache nomme l'une des deux.
  const spanning = auditPlatformSnapshot({ ...snapshot, equipments, cables: [cable()] });
  assert.equal(spanning.issues.cableRoomCacheStale.length, 0,
    'la salle 1 héberge encore la destination : le cache n’est pas périmé');
});

test('la suppression de salle et l’autorisation par zone ne lisent plus le champ brut', () => {
  const deletion = read('room-deletion.js');
  assert.ok(deletion.includes('cableTouchesRoom'), 'room-deletion doit dériver la salle du câble');
  assert.doesNotMatch(deletion, /sameId\(cable\.roomId/,
    'la suppression ne doit plus se décider sur le cache périmé');

  const accessControl = read('scripts/access-control.js');
  const cableBlock = accessControl.indexOf("if (storeName === 'cables') {");
  const roomFallback = accessControl.indexOf('if (record.roomId !== undefined && record.roomId !== null) return zonesForRoom');
  assert.ok(cableBlock > 0 && roomFallback > 0);
  assert.ok(cableBlock < roomFallback,
    'les extrémités du câble doivent décider de la zone avant le repli sur record.roomId');
});
