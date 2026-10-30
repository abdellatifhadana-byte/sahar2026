import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHAIN_ORDER, CHAIN_SEGMENTS, CHAIN_UNASSIGNED, SEGMENT_STATES,
  roomChainSegment, equipmentChainSegment, segmentState, summarizeSignalChain, chainSegmentOptions
} from '../signal-chain-contract.js';

const salle = (id, chainSegment) => ({ id, name: `Salle ${id}`, ...(chainSegment ? { chainSegment } : {}) });
const equip = (id, roomId, statut) => ({ id, roomId, statut });

test('la chaîne suit l’ordre du signal, de la prise à l’antenne', () => {
  assert.deepEqual([...CHAIN_ORDER], ['acquisition', 'regie', 'continuite', 'diffusion']);
  assert.equal(chainSegmentOptions().length, CHAIN_ORDER.length);
  assert.deepEqual(chainSegmentOptions().map(o => o.value), [...CHAIN_ORDER]);
});

test('le segment d’une salle est déclaré, jamais deviné', () => {
  // Faire correspondre « STC » à la diffusion ou « ACQ » à l'acquisition serait rapide et
  // se tromperait en silence dès qu'une salle est renommée. Le nom ne décide de rien.
  assert.equal(roomChainSegment({ name: 'STC', chainSegment: 'diffusion' }), CHAIN_SEGMENTS.DIFFUSION);
  assert.equal(roomChainSegment({ name: 'STC' }), CHAIN_UNASSIGNED);
  assert.equal(roomChainSegment({ name: 'Acquisition (ACQ)' }), CHAIN_UNASSIGNED);
  assert.equal(roomChainSegment({ name: 'Régie Finale 1 (RF1)' }), CHAIN_UNASSIGNED);
  // Une valeur inconnue vaut absence : mieux que d'inventer un segment sur une faute de frappe.
  assert.equal(roomChainSegment({ chainSegment: 'régie' }), CHAIN_UNASSIGNED);
  assert.equal(roomChainSegment({ chainSegment: '' }), CHAIN_UNASSIGNED);
  assert.equal(roomChainSegment(null), CHAIN_UNASSIGNED);
  // La casse et les espaces ne doivent pas faire échouer une valeur pourtant juste.
  assert.equal(roomChainSegment({ chainSegment: ' Regie ' }), CHAIN_SEGMENTS.REGIE);
});

test('l’équipement tient sa position de sa salle', () => {
  const salles = new Map([['7', salle(7, 'continuite')]]);
  assert.equal(equipmentChainSegment({ roomId: 7 }, salles), CHAIN_SEGMENTS.CONTINUITE);
  assert.equal(equipmentChainSegment({ roomId: '7' }, salles), CHAIN_SEGMENTS.CONTINUITE);
  // Un équipement sans salle, ou dans une salle disparue, reste hors chaîne — il ne doit
  // pas être rattaché arbitrairement à un segment.
  assert.equal(equipmentChainSegment({ roomId: null }, salles), CHAIN_UNASSIGNED);
  assert.equal(equipmentChainSegment({ roomId: 99 }, salles), CHAIN_UNASSIGNED);
});

test('« à vérifier » n’est PAS « dégradé »', () => {
  // C'est la distinction la plus importante du module. En production, 448 équipements sont
  // « état à vérifier » et aucun n'est confirmé actif : les confondre ferait passer un
  // inventaire neuf pour une panne généralisée, et l'alarme perdrait tout sens.
  assert.equal(segmentState([equip('a', 1, 'À vérifier')]), SEGMENT_STATES.UNVERIFIED);
  assert.equal(segmentState([equip('a', 1, 'Maintenance')]), SEGMENT_STATES.DEGRADED);
  assert.notEqual(SEGMENT_STATES.UNVERIFIED, SEGMENT_STATES.DEGRADED);
});

test('l’état le plus grave l’emporte, dans l’ordre qui coupe le signal', () => {
  // Hors service prime : c'est lui qui coupe. Puis la maintenance, qui affaiblit. Puis
  // l'absence de vérification, qui ne casse rien.
  assert.equal(segmentState([
    equip('a', 1, 'Opérationnel'), equip('b', 1, 'Maintenance'), equip('c', 1, 'Hors service')
  ]), SEGMENT_STATES.LOST);
  assert.equal(segmentState([
    equip('a', 1, 'Opérationnel'), equip('b', 1, 'À vérifier'), equip('c', 1, 'Maintenance')
  ]), SEGMENT_STATES.DEGRADED);
  assert.equal(segmentState([equip('a', 1, 'Opérationnel')]), SEGMENT_STATES.LOCKED);
  assert.equal(segmentState([]), SEGMENT_STATES.EMPTY);
});

test('un segment vide ne rompt pas la chaîne', () => {
  // Un segment sans salle n'est pas coupé : il n'est pas encore renseigné. Le déclarer
  // rompu ferait crier la plateforme sur une configuration simplement incomplète.
  const resume = summarizeSignalChain({
    rooms: [salle(1, 'acquisition')],
    equipments: [equip('a', 1, 'Opérationnel')]
  });
  assert.equal(resume.segments.find(s => s.segment === 'continuite').state, SEGMENT_STATES.EMPTY);
  assert.equal(resume.intact, true);
});

test('le hors-chaîne est montré quand il existe, caché quand il est vide', () => {
  const avec = summarizeSignalChain({ rooms: [salle(1)], equipments: [] });
  assert.ok(avec.unassigned, 'une salle non rattachée doit être visible');
  assert.equal(avec.pendingRooms, 1);

  const sans = summarizeSignalChain({
    rooms: [salle(1, 'acquisition')], equipments: [equip('a', 1, 'Opérationnel')]
  });
  assert.equal(sans.unassigned, null, 'un cinquième bloc vide serait du bruit');
  assert.equal(sans.pendingRooms, 0);
});

test('le résumé compte salles et équipements par segment', () => {
  const resume = summarizeSignalChain({
    rooms: [salle(1, 'acquisition'), salle(2, 'regie'), salle(3, 'regie'), salle(4)],
    equipments: [
      equip('a', 1, 'Opérationnel'), equip('b', 2, 'Hors service'),
      equip('c', 3, 'Maintenance'), equip('d', 4, 'Opérationnel')
    ]
  });
  const regie = resume.segments.find(s => s.segment === 'regie');
  assert.equal(regie.roomCount, 2);
  assert.equal(regie.equipmentCount, 2);
  assert.equal(regie.state, SEGMENT_STATES.LOST);
  assert.deepEqual([...regie.roomIds], ['2', '3']);
  assert.equal(resume.intact, false);
  assert.equal(resume.unassigned.equipmentCount, 1);
});

test('le module ne lit ni la base ni le DOM', () => {
  // Une feuille de contrat doit rester chargeable par Node comme par le navigateur, et
  // testable sans monter une page.
  const source = fs.readFileSync(new URL('../signal-chain-contract.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => /^\s*(\/\/|\*)/.test(l) ? '' : l).join('\n');
  assert.doesNotMatch(code, /\bdocument\b|\bwindow\b|from '\.\/db\.js'/);
  // Seul import autorisé : le vocabulaire d'état, pour ne pas le dupliquer.
  const imports = [...code.matchAll(/from '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(imports, ['./equipment-status-contract.js']);
});
