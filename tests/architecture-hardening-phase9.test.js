import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLATFORM_INTEGRITY_VERSION, auditPlatformSnapshot } from '../platform-integrity.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const center = read('integrity-center.js');
const sw = read('service-worker.js');

test('l’audit graphe détecte un écran placé dans une salle différente de son mur', () => {
  assert.equal(PLATFORM_INTEGRITY_VERSION, 1);
  const audit = auditPlatformSnapshot({
    rooms:[{ id:'r1', name:'RF1' }, { id:'r2', name:'RF2' }],
    walls:[{ id:'w1', roomId:'r1', name:'Mur RF1' }],
    screens:[{ id:'s1', roomId:'r2', wallId:'w1', name:'Écran 1' }]
  });
  assert.equal(audit.valid, false);
  assert.equal(audit.issues.screenWallRoomMismatch.length, 1);
  assert.match(audit.issues.screenWallRoomMismatch[0].message, /RF|r2|r1/i);
});

test('l’audit graphe bloque un câble réellement incompatible et sépare les compatibilités à confirmer', () => {
  const equipments = [
    { id:'a', name:'Source', ports:[{ id:'usb', number:'1', type:'USB', direction:'OUT', signalDomains:['DATA'], protocols:['USB'] }] },
    { id:'b', name:'Destination', ports:[{ id:'sdi', number:'1', type:'3G-SDI', direction:'IN', signalDomains:['VIDEO'], protocols:['SDI'] }] },
    { id:'c', name:'SFP source', ports:[{ id:'sfp', number:'1', type:'SFP / SFP+', direction:'OUT', signalDomains:['NETWORK'], protocols:['ETHERNET'] }] },
    { id:'d', name:'Fibre dest', ports:[{ id:'lc', number:'1', type:'Fibre LC', direction:'IN', signalDomains:['NETWORK'], protocols:['ETHERNET'] }] }
  ];
  const cables = [
    { id:'bad', reference:'BAD', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:'a', sourcePortId:'usb', destinationType:'equipment', destinationId:'b', destinationPortId:'sdi' },
    { id:'confirm', reference:'SFP-LC', category:'Fibre optique', type:'Monomode LC-LC', sourceType:'equipment', sourceId:'c', sourcePortId:'sfp', destinationType:'equipment', destinationId:'d', destinationPortId:'lc' }
  ];
  const audit = auditPlatformSnapshot({ equipments, cables });
  assert.equal(audit.issues.graphIncompatibleConnections.length, 1);
  assert.equal(audit.issues.graphIncompatibleConnections[0].cableId, 'bad');
  assert.equal(audit.issues.graphConnectionsToConfirm.length, 1);
  assert.equal(audit.issues.graphConnectionsToConfirm[0].cableId, 'confirm');
  assert.ok(audit.blocking >= 1);
  assert.ok(audit.warnings >= 1);
});

test('les références nouvelles non résolues restent bloquantes sans recompter les anomalies déjà auditées ailleurs', () => {
  const audit = auditPlatformSnapshot({
    rooms:[{ id:'r1' }],
    equipments:[{ id:'eq1', roomId:'missing-room', ports:[] }],
    screens:[{ id:'s1', roomId:'r1', equipmentId:'missing-equipment', ports:[] }]
  });
  assert.ok(audit.rawUnresolved.some(issue => issue.type === 'equipment-location'));
  assert.ok(audit.rawUnresolved.some(issue => issue.type === 'screen-equipment'));
  assert.equal(audit.issues.graphUnresolved.some(issue => issue.type === 'equipment-location'), false);
  assert.equal(audit.issues.graphUnresolved.some(issue => issue.type === 'screen-equipment'), true);
});

test('le centre d’intégrité fusionne réellement audit stores et audit graphe', () => {
  assert.match(center, /inspectPlatformIntegrity/);
  assert.match(center, /mergeIntegrityReports/);
  assert.match(center, /valid:Boolean\(base\.valid\) && Boolean\(platform\.valid\)/);
  assert.match(center, /Santé du graphe canonique/);
  assert.match(center, /Câbles physiquement\/logiquement incompatibles/);
  assert.match(center, /Compatibilités de câbles à confirmer/);
  assert.match(center, /Cohérence écran \/ mur \/ salle/);
});

test('l’audit graphe est disponible hors connexion', () => {
  assert.match(sw, /\/platform-integrity\.js/);
});
