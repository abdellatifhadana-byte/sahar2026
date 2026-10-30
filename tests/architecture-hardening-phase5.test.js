import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { traceGraph } from '../technical-graph.js';
import {
  PLATFORM_ENTITY_GRAPH_VERSION,
  buildPlatformEntityGraph,
  directPlatformRelations
} from '../platform-entity-graph.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const relation360 = read('equipment-relations-360.js');
const serviceWorker = read('service-worker.js');

function snapshot() {
  return {
    rooms:[{ id:'r1', name:'STC' }],
    baies:[{ id:'b1', name:'B01.STC', roomId:'r1' }],
    equipments:[{
      id:'eq1', name:'Grille physique', roomId:'r1', baieId:'b1',
      ports:[{ id:'p-in', number:'IN-1', direction:'IN', type:'SDI' }],
      components:[{
        id:'card1', name:'Carte I/O',
        ports:[{ id:'cp-out', number:'1', direction:'OUT', type:'SDI' }]
      }]
    }],
    walls:[{ id:'w1', name:'Mur STC', roomId:'r1' }],
    screens:[{ id:'s1', name:'Écran 1', roomId:'r1', wallId:'w1', ports:[] }],
    cables:[],
    docs:[
      { kind:'topology_router', id:'router1', name:'Grille logique', routerEquipmentId:'eq1', verificationStatus:'documented' },
      {
        kind:'topology_router_port', id:'rp1', routerId:'router1', direction:'INPUT', portNumber:1, logicalAlias:'IN 1',
        physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'p-in', verificationStatus:'observed', evidenceRef:'photo-front' }
      },
      {
        kind:'technical_diagram', id:'d1', title:'Synoptique STC',
        nodes:[
          { id:'dn1', entityRef:{ type:'equipment', id:'eq1' } },
          { id:'dn2', entityRef:{ type:'component', id:'card1', parentEquipmentId:'eq1' } }
        ],
        edges:[]
      }
    ]
  };
}

test('le graphe canonique réunit localisation, matériel, topologie et schémas', () => {
  assert.equal(PLATFORM_ENTITY_GRAPH_VERSION, 1);
  const graph = buildPlatformEntityGraph(snapshot());
  for (const id of [
    'room:r1',
    'baie:b1',
    'equipment:eq1',
    'component:eq1:card1',
    'port:equipment:eq1:p-in',
    'port:component:eq1:card1:cp-out',
    'wall:w1',
    'screen:s1',
    'router:router1',
    'router-port:rp1',
    'diagram:d1'
  ]) assert.ok(graph.nodes.has(id), `nœud canonique manquant: ${id}`);

  const relations = new Set(graph.edges.map(edge => edge.relation));
  for (const relation of [
    'contains-baie',
    'contains-equipment',
    'contains-wall',
    'contains-screen',
    'implements-topology',
    'implements-router-port',
    'visualizes'
  ]) assert.ok(relations.has(relation), `relation canonique manquante: ${relation}`);

  assert.equal(graph.platformSummary.physicalRouterPortLinks, 1);
  assert.equal(graph.platformSummary.diagramLinks, 2);
  assert.ok(graph.platformSummary.locationLinks >= 4);
});

test('les relations structurelles n’inventent aucun flux de signal', () => {
  const graph = buildPlatformEntityGraph(snapshot());
  const defaultTrace = traceGraph(graph, 'equipment:eq1');
  assert.ok(defaultTrace.nodes.every(node => !['room','baie','wall','diagram','router'].includes(node.type)));
  assert.ok(!defaultTrace.nodes.some(node => node.id === 'room:r1'));
  assert.ok(!defaultTrace.nodes.some(node => node.id === 'router:router1'));

  const direct = directPlatformRelations(graph, { type:'equipment', id:'eq1' });
  assert.ok(direct.some(item => item.relation === 'contains-equipment' && item.node.id === 'baie:b1'));
  assert.ok(direct.some(item => item.relation === 'implements-topology' && item.node.id === 'router:router1'));
  assert.ok(direct.some(item => item.relation === 'visualizes' && item.node.id === 'diagram:d1'));
});

test('un mapping de port physique explicite et valide relie le port matériel au port logique', () => {
  const graph = buildPlatformEntityGraph(snapshot());
  const link = graph.edges.find(edge => edge.relation === 'implements-router-port');
  assert.ok(link);
  assert.equal(link.from, 'port:equipment:eq1:p-in');
  assert.equal(link.to, 'router-port:rp1');
  assert.equal(link.verificationStatus, 'observed');
  assert.equal(link.evidenceRef, 'photo-front');
});

test('les relations non résolues restent visibles au lieu d’être devinées', () => {
  const input = snapshot();
  input.equipments[0] = { ...input.equipments[0], roomId:'r-missing', baieId:'b-missing' };
  input.docs = [
    ...input.docs.filter(item => item.id !== 'rp1' && item.id !== 'd1'),
    {
      kind:'topology_router_port', id:'rp-bad', routerId:'router1', direction:'INPUT', portNumber:1,
      physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'port-absent' }
    },
    {
      kind:'technical_diagram', id:'d-bad', title:'Schéma incomplet',
      nodes:[{ id:'missing-node', entityRef:{ type:'equipment', id:'eq-absent' } }], edges:[]
    }
  ];
  const graph = buildPlatformEntityGraph(input);
  assert.ok(graph.unresolved.some(issue => issue.type === 'equipment-location'));
  assert.ok(graph.unresolved.some(issue => issue.type === 'router-port-physical-port' && issue.routerPortId === 'rp-bad'));
  assert.ok(graph.unresolved.some(issue => issue.type === 'diagram-entity' && issue.diagramId === 'd-bad'));
});

test('la Fiche 360 dépend maintenant du graphe canonique et le graphe est prévu dans le cache PWA', () => {
  assert.match(relation360, /buildPlatformEntityGraph/);
  assert.match(relation360, /directPlatformRelations/);
  assert.match(relation360, /Liens graphe directs/);
  assert.match(serviceWorker, /\/platform-entity-graph\.js/);
});
