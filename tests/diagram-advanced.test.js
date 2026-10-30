import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIAGRAM_NODE_TYPES, normalizeDiagram, validateDiagram } from '../diagram-contract.js';

test('diagram contract supports frames, free text and off-page references', () => {
  for (const type of ['boundary','label','off-page-reference']) assert.ok(DIAGRAM_NODE_TYPES.includes(type));
  const diagram = normalizeDiagram({
    title:'RF1 avancé', zoneIds:['rf1'], nodes:[
      { id:'frame', type:'boundary', label:'Chaîne principale', x:1,y:1,width:60,height:30 },
      { id:'text', type:'label', label:'Vers diffusion', x:5,y:35,width:20,height:5 },
      { id:'off', type:'off-page-reference', label:'Suite', referenceText:'Plan RF2 / page 2', x:80,y:40,width:15,height:8 }
    ]
  });
  assert.equal(diagram.diagramVersion,2);
  assert.deepEqual(validateDiagram(diagram).errors,[]);
});

test('off-page reference cannot become an unlabeled dangling marker', () => {
  const checked = validateDiagram({
    title:'Renvoi invalide', zoneIds:['rf1'],
    nodes:[{ id:'off', type:'off-page-reference', label:'Renvoi' }]
  });
  assert.ok(checked.errors.some(message => /renvoi/i.test(message)));
});

test('advanced studio uses canonical entity ports and labels physical edges', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = fs.readFileSync(`${root}/diagram-studio-advanced.js`,'utf8');
  assert.match(source,/normalizePorts/);
  assert.match(source,/sourcePortId/);
  assert.match(source,/destinationPortId/);
  assert.match(source,/cable\?\.reference/);
  assert.match(source,/diagram-edge-label/);
  assert.match(source,/diagram-port-chip/);
});

test('advanced diagram assets are loaded by shell and offline cache', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const index = fs.readFileSync(`${root}/index.html`,'utf8');
  const worker = fs.readFileSync(`${root}/service-worker.js`,'utf8');
  assert.match(index,/diagram-studio-advanced\.css/);
  assert.match(index,/src="diagram-studio-advanced\.js"/);
  assert.match(worker,/'\/diagram-studio-advanced\.css'/);
  assert.match(worker,/'\/diagram-studio-advanced\.js'/);
});
