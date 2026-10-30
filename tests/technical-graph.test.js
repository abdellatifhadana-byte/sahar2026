import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTechnicalGraph, traceGraph, graphKeyForReference, analyzeProtectionGroup, analyzeTechnicalSnapshot } from '../technical-graph.js';

test('graphe technique: les références de ports utilisent la même clé que les nœuds réels', () => {
  assert.equal(graphKeyForReference({ type:'port', id:'eq-1', portId:'out-1' }), 'port:equipment:eq-1:out-1');
  assert.equal(graphKeyForReference({ type:'port', parentEquipmentId:'eq-1', id:'card-1', portId:'sdi-1' }), 'port:component:eq-1:card-1:sdi-1');
});

test('graphe technique: trace un câble équipement vers écran', () => {
  const input = {
    equipments:[{ id:'mv', name:'Multiviewer', ports:[{ id:'out', number:'OUT 1', type:'3G-SDI', direction:'OUT', formats:['3G-SDI'] }] }],
    screens:[{ id:'scr', name:'Écran 6', ports:[{ id:'in', number:'IN 1', type:'3G-SDI', direction:'IN', formats:['3G-SDI'] }] }],
    cables:[{ id:'cab', reference:'GR100', category:'Vidéo', type:'3G-SDI', pathRole:'PROGRAM', sourceType:'equipment', sourceId:'mv', sourcePortId:'out', destinationType:'screen', destinationId:'scr', destinationPortId:'in' }]
  };
  const graph = buildTechnicalGraph(input);
  const traced = traceGraph(graph, 'equipment:mv');
  assert.ok(traced.nodes.some(node => node.id === 'screen:scr'));
  assert.equal(graph.compatibilityIssues.length, 0);
});

test('graphe technique: remonte les liaisons incompatibles sans les masquer', () => {
  const report = analyzeTechnicalSnapshot({
    equipments:[
      { id:'pc', ports:[{ id:'usb', number:'USB', type:'USB', direction:'OUT' }] },
      { id:'xdcam', ports:[{ id:'sdi', number:'SDI', type:'BNC / SDI', direction:'IN' }] }
    ],
    cables:[{ id:'bad', reference:'BAD', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:'pc', sourcePortId:'usb', destinationType:'equipment', destinationId:'xdcam', destinationPortId:'sdi' }]
  });
  assert.equal(report.summary.compatibilityIssues, 1);
});

test('graphe technique: une liaison en quarantaine ne crée pas d’arête fantôme', () => {
  const graph = buildTechnicalGraph({
    equipments:[
      { id:'a', ports:[{ id:'out', number:'OUT', type:'3G-SDI', direction:'OUT' }] },
      { id:'b', ports:[{ id:'in', number:'IN', type:'3G-SDI', direction:'IN' }] }
    ],
    cables:[{
      id:'ghost', reference:'GHOST', status:'Connecté', integrityState:'quarantined',
      category:'Vidéo', type:'3G-SDI', sourceType:'equipment', sourceId:'a', sourcePortId:'out',
      destinationType:'equipment', destinationId:'b', destinationPortId:'in'
    }]
  });
  assert.ok(!graph.edges.some(edge => edge.relation === 'physical-cable'));
  assert.ok(graph.unresolved.some(item => item.type === 'quarantined-cable' && item.cableId === 'ghost'));
  assert.ok(!traceGraph(graph, 'equipment:a').nodes.some(node => node.id === 'equipment:b'));
});

test('graphe technique: détecte une dépendance commune Principal/Secours', () => {
  const group = {
    id:'pg', name:'RF1', serviceName:'Diffusion RF1', protectionType:'alternate-path', status:'validated', verificationStatus:'verified',
    primaryPath:{ label:'P', verificationStatus:'verified', entityRefs:[{ type:'equipment', id:'p' }], dependencyRefs:[{ type:'router', id:'gc' }] },
    backupPaths:[{ label:'S', availability:'available', verificationStatus:'verified', entityRefs:[{ type:'equipment', id:'s' }], dependencyRefs:[{ type:'router', id:'gc' }] }]
  };
  const report = analyzeProtectionGroup(group, { tests:[{ protectionGroupId:'pg', result:'passed', performedAt:'2026-08-14T10:00:00Z' }] });
  assert.equal(report.hasVerifiedBackup, true);
  assert.ok(report.singlePointsOfFailure.some(value => value.includes('router::gc')));
});

test('graphe technique: dérive une dépendance commune depuis les câbles réels', () => {
  const ports = formats => ({ type:'3G-SDI', formats:['3G-SDI'], ...formats });
  const snapshot = {
    equipments:[
      { id:'p', ports:[ports({ id:'p-out', number:'OUT', direction:'OUT' })] },
      { id:'s', ports:[ports({ id:'s-out', number:'OUT', direction:'OUT' })] },
      { id:'shared', ports:[
        ports({ id:'in-p', number:'IN P', direction:'IN' }),
        ports({ id:'in-s', number:'IN S', direction:'IN' }),
        ports({ id:'out', number:'OUT', direction:'OUT' })
      ] }
    ],
    cables:[
      { id:'cp', category:'Vidéo', type:'3G-SDI', sourceType:'equipment', sourceId:'p', sourcePortId:'p-out', destinationType:'equipment', destinationId:'shared', destinationPortId:'in-p' },
      { id:'cs', category:'Vidéo', type:'3G-SDI', sourceType:'equipment', sourceId:'s', sourcePortId:'s-out', destinationType:'equipment', destinationId:'shared', destinationPortId:'in-s' }
    ]
  };
  const graph = buildTechnicalGraph(snapshot);
  const report = analyzeProtectionGroup({
    id:'pg-graph', serviceName:'RF1', protectionType:'alternate-path', status:'validated', verificationStatus:'verified',
    primaryPath:{ entityRefs:[{ type:'equipment', id:'p' }], verificationStatus:'verified' },
    backupPaths:[{ entityRefs:[{ type:'equipment', id:'s' }], availability:'available', verificationStatus:'verified' }]
  }, { graph, tests:[{ protectionGroupId:'pg-graph', result:'passed', performedAt:'2026-08-14T10:00:00Z' }] });
  assert.ok(report.singlePointsOfFailure.includes('equipment:shared'));
});

test('graphe technique: une configuration validée reste non disponible sans test réussi', () => {
  const group = {
    id:'pg-test', serviceName:'RF2', protectionType:'alternate-path', status:'validated', verificationStatus:'verified',
    primaryPath:{ entityRefs:[{ type:'equipment', id:'p' }], verificationStatus:'verified' },
    backupPaths:[{ entityRefs:[{ type:'equipment', id:'s' }], availability:'available', verificationStatus:'verified' }]
  };
  assert.equal(analyzeProtectionGroup(group).hasVerifiedBackup, false);
  assert.equal(analyzeProtectionGroup(group, { tests:[{ protectionGroupId:'pg-test', result:'failed', performedAt:'2026-08-14T10:00:00Z' }] }).hasVerifiedBackup, false);
});
