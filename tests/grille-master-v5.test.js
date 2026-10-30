import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterTopology } from '../rf-master-import.js';
import { TOPOLOGY_KINDS } from '../topology-contract.js';

const payload = {
  format:'2m-tech-master-image-extraction', version:5,
  topology:{
    topology_router_port:[{ id:'rp-grille72-in-22', kind:'topology_router_port', routerLabel:'GRILLE72 / Grille centrale', direction:'INPUT', portNumber:'22', logicalAlias:'GRILLE72 IN.22' }],
    topology_crosspoint:[]
  },
  grille72OperationalModel:{ manufacturer:'IMAGINE COMMUNICATIONS', model:'PLATINUM VX', safetyNote:'Documentation seulement.' },
  centralGrid190x184:{
    identity:{ location:'BAIE 3 GRILLE CENTRALE', relationshipNote:'Distincte de GRILLE72.' },
    inputsVisible:[{ number:1, label:'VTR 1', confidence:'high', status:'documented' }, { number:190, label:'RESERVE 28', confidence:'high', status:'documented' }],
    outputsVisible:[{ number:1, label:'VTR 1', confidence:'high', status:'documented' }, { number:184, label:'RESERVE 26', confidence:'high', status:'documented' }],
    interfaces:{ sync:[{ port:'SYNCH 1', function:'BLACK', cableRef:'GR1021', confidence:'high' }], control:['ENET-1'], monitoringOutputs:[{ name:'MONITORING/OUT.1', segmentRefs:['GR691','GR717'], confidence:'high' }] },
    controlMonitoringStations:[{ name:'CTRL-STC 1', location:'PUPITRE / CONTROL ROOM', confidence:'high' }],
    interBayLinks:{ rvBaie1ToBaie2:[{ left:'RV1-GR375', right:'RV6-GR401', via:'GR375 ↔ GR401', confidence:'high' }], rvBaie2GcToStcVisible:[], note:'' },
    handwrittenOperationalAnnotations:[{ target:'NEWS 9', annotation:'MUR STC SAT9', confidence:'high', status:'observed-handwritten' }]
  }
};

test('Dataset v5: Grille Centrale 190×184 et Grille72 restent deux routeurs distincts', () => {
  const topology = buildMasterTopology(payload);
  const routers = topology[TOPOLOGY_KINDS.ROUTER];
  const central = routers.find(router => router.id === 'router-gc190x184');
  const grille72 = routers.find(router => router.id === 'router-grille72');
  assert.equal(central.inputCapacity, 190);
  assert.equal(central.outputCapacity, 184);
  assert.equal(grille72.inputCapacity, 72);
  assert.equal(grille72.outputCapacity, 72);
  assert.deepEqual(central.distinctFrom, ['router-grille72']);
  assert.deepEqual(grille72.distinctFrom, ['router-gc190x184']);
});

test('Dataset v5: importe uniquement les ports centraux visibles et aucun crosspoint inventé', () => {
  const topology = buildMasterTopology(payload);
  const centralPorts = topology[TOPOLOGY_KINDS.ROUTER_PORT].filter(port => port.routerId === 'router-gc190x184');
  assert.deepEqual(centralPorts.map(port => port.id), ['gc190-in-001','gc190-in-190','gc190-out-001','gc190-out-184']);
  assert.equal(topology[TOPOLOGY_KINDS.CROSSPOINT].length, 0);
  assert.equal(topology[TOPOLOGY_KINDS.ROUTER_PORT].find(port => port.id === 'rp-grille72-in-22').routerId, 'router-grille72');
});

test('Dataset v5: conserve interfaces, liaisons RV et annotations manuscrites avec leur statut', () => {
  const topology = buildMasterTopology(payload);
  assert.equal(topology[TOPOLOGY_KINDS.ROUTER_INTERFACE].length, 4);
  assert.equal(topology[TOPOLOGY_KINDS.RV_LINK][0].cableRefs.join(','), 'GR375,GR401');
  assert.equal(topology[TOPOLOGY_KINDS.EVIDENCE].find(item => item.id === 'gc190-handwritten-01').verificationStatus, 'observed-handwritten');
});
