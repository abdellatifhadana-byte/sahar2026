import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_RELATION_KINDS, normalizeDiagram, validateDiagram, applyDiagramApproval } from '../diagram-contract.js';

test('diagrammes: le dessin référence les entités sans dupliquer leur fiche', () => {
  const diagram = normalizeDiagram({
    id:'diag-rf1', title:'Synoptique RF1', diagramType:'signal-synoptic', authorId:'admin-1', zoneIds:['rf'],
    nodes:[
      { id:'n1', type:'entity', label:'MC1 P', entityRef:{ type:'equipment', id:'mc1-p' }, x:10, y:10 },
      { id:'n2', type:'entity', label:'MC1 S', entityRef:{ type:'equipment', id:'mc1-s' }, x:50, y:10 }
    ],
    edges:[{ id:'e1', type:'backup-relation', sourceNodeId:'n1', destinationNodeId:'n2', pathRole:'BACKUP' }]
  });
  assert.equal(validateDiagram(diagram).errors.length, 0);
  assert.equal(diagram.nodes[0].entityRef.id, 'mc1-p');
  assert.equal('manufacturer' in diagram.nodes[0], false);
});

test('diagrammes: refuse une relation vers un nœud absent', () => {
  const checked = validateDiagram({
    title:'Erreur', diagramType:'network-topology', zoneIds:['it'],
    nodes:[{ id:'n1', type:'entity', entityRef:{ type:'equipment', id:'switch-1' } }],
    edges:[{ id:'e1', sourceNodeId:'n1', destinationNodeId:'missing' }]
  });
  assert.ok(checked.errors.some(message => /destination.*introuvable/i.test(message)));
});

test('diagrammes: une liaison physique validée référence un vrai câble', () => {
  const draft = normalizeDiagram({
    title:'Plan câblage', diagramType:'signal-synoptic', authorId:'admin-1', zoneIds:['stc'],
    nodes:[
      { id:'n1', type:'entity', entityRef:{ type:'equipment', id:'a' } },
      { id:'n2', type:'entity', entityRef:{ type:'equipment', id:'b' } }
    ],
    edges:[{ id:'e1', type:'physical-cable', sourceNodeId:'n1', sourcePortId:'out-1', destinationNodeId:'n2', destinationPortId:'in-1', cableId:'cab-1' }]
  });
  const approved = applyDiagramApproval(draft, { id:'resp-2', role:'responsible' });
  assert.equal(approved.status, 'validated');
  assert.equal(validateDiagram(approved).errors.length, 0);
});

test('diagrammes: une relation logique validée référence le graphe métier', () => {
  const withoutRelation = normalizeDiagram({
    title:'Principal / Secours', diagramType:'signal-synoptic', authorId:'admin-1', zoneIds:['rf'],
    nodes:[
      { id:'n1', type:'entity', entityRef:{ type:'equipment', id:'rf1-p' } },
      { id:'n2', type:'entity', entityRef:{ type:'equipment', id:'rf1-s' } }
    ],
    edges:[{ id:'e1', type:'backup-relation', sourceNodeId:'n1', destinationNodeId:'n2' }]
  });
  assert.throws(() => applyDiagramApproval(withoutRelation, { id:'resp-2', role:'responsible' }), /relation métier/i);
  const approved = applyDiagramApproval({ ...withoutRelation, edges:[{ ...withoutRelation.edges[0], relationId:'continuity-rf1' }] }, { id:'resp-2', role:'responsible' });
  assert.equal(approved.status, 'validated');
});

test('diagrammes: limite les traits logiques aux relations métier canoniques', () => {
  assert.deepEqual(DIAGRAM_RELATION_KINDS, [
    'topology_crosspoint', 'topology_rv_link', 'topology_signal_path',
    'continuity_protection_group'
  ]);
});

test('diagrammes: une révision conserve le lien sans modifier la version validée', () => {
  const revision = normalizeDiagram({ title:'RF1 révision 2', zoneIds:['rf1'], revision:'2', supersedesId:'diagram-rf1-r1' });
  assert.equal(revision.supersedesId, 'diagram-rf1-r1');
  assert.equal(validateDiagram(revision).errors.length, 0);
  assert.ok(validateDiagram({ ...revision, supersedesId:revision.id }).errors.some(message => /remplacer lui-même/i.test(message)));
});

test("diagrammes: refuse une image de fond externe ou une traversée de répertoire", () => {
  const base = { title:'Plan RF1', zoneIds:['rf1'] };
  assert.ok(validateDiagram({ ...base, background:{ imageUrl:'https://example.com/plan.png' } }).errors.some(message => /chemin interne sûr/i.test(message)));
  assert.ok(validateDiagram({ ...base, background:{ imageUrl:'../scripts/serve.js' } }).errors.some(message => /chemin interne sûr/i.test(message)));
  assert.equal(validateDiagram({ ...base, background:{ imageUrl:'assets/plan-rf1.png' } }).errors.length, 0);
});
