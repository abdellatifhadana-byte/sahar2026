import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTechnicalGraph, traceGraph, findGraphPath, TECHNICAL_GRAPH_VERSION } from '../technical-graph.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bridge = read('map-equipment-360-bridge.js');
const index = read('index.html');
const serviceWorker = read('service-worker.js');
const mapFit = read('map-fit-fix.js');
const mediaRuntime = read('media-runtime-health.js');

test('le graphe relie équipement physique, routeur, ports et interfaces sans inventer un flux signal', () => {
  assert.equal(TECHNICAL_GRAPH_VERSION, 2);
  const graph = buildTechnicalGraph({
    equipments:[{ id:'eq-router', name:'Grille physique', ports:[] }],
    topology:{
      routers:[{ id:'router-a', name:'Routeur A', routerEquipmentId:'eq-router', verificationStatus:'documented' }],
      routerPorts:[{ id:'rp-in', routerId:'router-a', logicalAlias:'IN 001', direction:'IN', portNumber:1 }],
      routerInterfaces:[{ id:'ri-sync', routerId:'router-a', name:'SYNC 1', interfaceType:'SYNC_REFERENCE' }],
      crosspoints:[],
      signalPaths:[]
    }
  });

  for (const id of ['equipment:eq-router','router:router-a','router-port:rp-in','router-interface:ri-sync']) {
    assert.ok(graph.nodes.has(id), `nœud manquant: ${id}`);
  }
  assert.ok(graph.edges.some(edge => edge.relation === 'implements-topology' && edge.from === 'equipment:eq-router' && edge.to === 'router:router-a'));
  assert.ok(graph.edges.some(edge => edge.relation === 'contains-router-port' && edge.from === 'router:router-a' && edge.to === 'router-port:rp-in'));
  assert.ok(graph.edges.some(edge => edge.relation === 'contains-router-interface' && edge.from === 'router:router-a' && edge.to === 'router-interface:ri-sync'));

  const structuralPath = findGraphPath(graph, 'equipment:eq-router', 'router-port:rp-in', {
    relations:['implements-topology','contains-router-port']
  });
  assert.deepEqual(structuralPath?.nodes.map(node => node.id), ['equipment:eq-router','router:router-a','router-port:rp-in']);

  const defaultSignalTrace = traceGraph(graph, 'equipment:eq-router');
  assert.deepEqual(defaultSignalTrace.nodes.map(node => node.id), ['equipment:eq-router']);
});

test('le graphe signale un routeur dont l’équipement physique n’existe pas', () => {
  const graph = buildTechnicalGraph({
    equipments:[],
    topology:{ routers:[{ id:'router-missing', routerEquipmentId:'eq-absent' }], routerPorts:[], routerInterfaces:[] }
  });
  assert.ok(graph.nodes.has('router:router-missing'));
  assert.ok(graph.unresolved.some(issue => issue.type === 'router-equipment' && issue.routerId === 'router-missing' && issue.equipmentId === 'eq-absent'));
});

test('le pont carte intercepte la consultation équipement mais respecte le mode édition', () => {
  assert.match(bridge, /\.map-hotspot\.equipment\[data-id\]/);
  assert.match(bridge, /#map-search-results \[data-type="equipment"\]\[data-id\]/);
  assert.match(bridge, /#map-modal #edit-mode-btn\.success/);
  assert.match(bridge, /if \(!target \|\| mapIsInEditMode\(\)\) return/);
  assert.match(bridge, /window\.TechOperations\?\.openEquipment360/);
  assert.match(bridge, /closeInteractiveMap\(\{ notify:false \}\)/);
  assert.match(bridge, /stopImmediatePropagation\(\)/);
});

test('le pont Fiche 360 est chargé après operations-suite et mis en cache PWA', () => {
  const operationsIndex = index.indexOf('src="operations-suite.js"');
  const bridgeIndex = index.indexOf('src="map-equipment-360-bridge.js"');
  assert.ok(operationsIndex >= 0 && bridgeIndex > operationsIndex, 'le pont doit être chargé après operations-suite');
  assert.match(serviceWorker, /\/map-equipment-360-bridge\.js/);
});

test('la migration DB est amorcée explicitement et ne dépend plus du correctif de carte', () => {
  assert.match(index, /src="db-migration-v15\.js"/);
  assert.doesNotMatch(mapFit, /db-migration-v15\.js/);
});

test('l’échappement HTML du runtime média encode complètement les guillemets', () => {
  assert.match(mediaRuntime, /'"':'&quot;'/);
});
