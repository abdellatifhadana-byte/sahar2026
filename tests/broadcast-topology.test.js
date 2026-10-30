import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPOLOGY_KINDS,
  normalizeDirection,
  normalizeTopologyRecord,
  validateTopologyRecord,
  validateTopologyReferences,
  buildSignalGraph
} from '../broadcast-topology.js';

test('topologie broadcast: normalise les directions de grille', () => {
  assert.equal(normalizeDirection('entrée'), 'INPUT');
  assert.equal(normalizeDirection('OUT'), 'OUTPUT');
});

test('topologie broadcast: refuse un flux sans destination', () => {
  const record = normalizeTopologyRecord(TOPOLOGY_KINDS.SIGNAL_PATH, {
    sourceLabel: 'Source documentée',
    destinationLabel: '',
    signalType: 'SDI'
  });
  assert.ok(validateTopologyRecord(record).some(message => /destination/i.test(message)));
});

test('topologie broadcast: sépare crosspoint et câblage physique', () => {
  const input = normalizeTopologyRecord(TOPOLOGY_KINDS.ROUTER_PORT, { id:'in-1', routerId:'router-a', direction:'INPUT', portNumber:'1', logicalAlias:'SRC-A' });
  const output = normalizeTopologyRecord(TOPOLOGY_KINDS.ROUTER_PORT, { id:'out-1', routerId:'router-a', direction:'OUTPUT', portNumber:'1', logicalAlias:'DST-A' });
  const crosspoint = normalizeTopologyRecord(TOPOLOGY_KINDS.CROSSPOINT, { id:'cp-1', routerId:'router-a', inputPortId:'in-1', outputPortId:'out-1' });
  const graph = buildSignalGraph({ routerPorts:[input, output], crosspoints:[crosspoint], signalPaths:[] });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].role, 'CROSSPOINT');
  assert.equal(graph.edges[0].from, 'in-1');
  assert.equal(graph.edges[0].to, 'out-1');
});

test('topologie broadcast: interdit un crosspoint entre deux grilles distinctes', async () => {
  const records = new Map([
    ['router-a', { id:'router-a', kind:TOPOLOGY_KINDS.ROUTER, name:'A', inputCapacity:2, outputCapacity:2 }],
    ['in-a', { id:'in-a', kind:TOPOLOGY_KINDS.ROUTER_PORT, routerId:'router-a', direction:'INPUT', portNumber:'1' }],
    ['out-b', { id:'out-b', kind:TOPOLOGY_KINDS.ROUTER_PORT, routerId:'router-b', direction:'OUTPUT', portNumber:'1' }]
  ]);
  const record = normalizeTopologyRecord(TOPOLOGY_KINDS.CROSSPOINT, { routerId:'router-a', inputPortId:'in-a', outputPortId:'out-b' });
  const errors = await validateTopologyReferences(record, id => records.get(String(id)) || null);
  assert.ok(errors.some(message => /autre grille/i.test(message)));
});

test('topologie broadcast: contrôle la capacité N×M', async () => {
  const router = { id:'router-gc', kind:TOPOLOGY_KINDS.ROUTER, name:'GC', inputCapacity:190, outputCapacity:184 };
  const port = normalizeTopologyRecord(TOPOLOGY_KINDS.ROUTER_PORT, { routerId:'router-gc', direction:'OUTPUT', portNumber:'185' });
  const errors = await validateTopologyReferences(port, id => String(id) === router.id ? router : null);
  assert.ok(errors.some(message => /dépasse la capacité 184/i.test(message)));
});

test('topologie broadcast: aucun alias interne du site n’est codé en dur', async () => {
  const fs = await import('node:fs/promises');
  const source = `${await fs.readFile(new URL('../broadcast-topology.js', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../signal-flow.js', import.meta.url), 'utf8')}`.toUpperCase();
  for (const alias of ['NACQ1', 'NACQ2', 'ST21']) assert.equal(source.includes(alias), false, `${alias} ne doit pas être codé en dur dans le dépôt public`);
});
