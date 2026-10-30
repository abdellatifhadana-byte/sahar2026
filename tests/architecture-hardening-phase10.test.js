import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEquipmentContextActionPlan, EQUIPMENT_CONTEXT_ACTIONS_VERSION } from '../equipment-context-actions.js';
import { buildEquipmentRelationSummary } from '../equipment-relations-360.js';
import { allowedSectionsForRole, parseHashRoute } from '../navigation-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const actionsSource = read('equipment-context-actions.js');
const index = read('index.html');
const worker = read('service-worker.js');

const actionIds = plan => plan.actions.map(action => action.id);

function fullSnapshot() {
  const equipment = {
    id:'eq1', name:'Grille principale', roomId:'r1', baieId:'b1',
    ports:[{ id:'p-in', number:'IN-1', direction:'IN', type:'SDI' }],
    components:[{ id:'comp1', name:'Carte interne', ports:[] }]
  };
  return {
    equipment,
    rooms:[{ id:'r1', name:'STC' }],
    baies:[{ id:'b1', name:'B01.STC', roomId:'r1' }],
    equipments:[equipment, { id:'card1', name:'Carte openGear', entityKind:'module-card', hostEquipmentId:'eq1', roomId:'r1', baieId:'b1' }, { id:'eq2', name:'Moniteur', roomId:'r1' }],
    walls:[], screens:[],
    cables:[{ id:'c1', sourceType:'equipment', sourceId:'eq1', sourcePortId:'p-in', destinationType:'equipment', destinationId:'eq2', destinationPortId:'p2' }],
    docs:[
      { kind:'technical_diagram', id:'d1', title:'Synoptique STC', nodes:[{ id:'n1', entityRef:{ type:'equipment', id:'eq1' } }], edges:[] },
      { kind:'topology_router', id:'router1', name:'Grille logique', routerEquipmentId:'eq1' },
      { kind:'topology_router_port', id:'rp1', routerId:'router1', direction:'INPUT', portNumber:1, physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'p-in' } }
    ]
  };
}

test('Phase 10: une fiche sans relation réelle ne fabrique aucune action technique', () => {
  assert.equal(EQUIPMENT_CONTEXT_ACTIONS_VERSION, 1);
  const equipment = { id:'eq-empty', name:'Équipement isolé', ports:[], components:[] };
  const summary = {
    location:{ valid:false, room:null }, breadcrumb:'Emplacement non documenté',
    connectedCables:[], diagrams:[], routers:[], mappedRouterPorts:[]
  };
  const plan = buildEquipmentContextActionPlan(equipment, summary, { user:{ role:'admin' }, equipments:[equipment], tickets:[] });
  assert.deepEqual(actionIds(plan), ['new-ticket']);
  assert.equal(plan.linkedTickets, 0);
});

test('Phase 10: les actions sont dérivées du même graphe et des relations de la Fiche 360', () => {
  const data = fullSnapshot();
  const summary = buildEquipmentRelationSummary(data.equipment, { ...data, continuityRecords:data.docs });
  const plan = buildEquipmentContextActionPlan(data.equipment, summary, {
    user:{ role:'admin' }, equipments:data.equipments,
    tickets:[{ id:'t1', relatedType:'equipment', relatedId:'eq1' }]
  });
  const ids = actionIds(plan);
  for (const id of ['map','ports','cables','components','diagrams','signal-flow','new-ticket']) assert.ok(ids.includes(id), `action réelle manquante: ${id}`);
  assert.equal(plan.linkedTickets, 1);
  assert.equal(plan.counts.ports, 1);
  assert.equal(plan.counts.cables, 1);
  assert.equal(plan.counts.components, 2);
  assert.equal(plan.counts.diagrams, 1);
  assert.ok(plan.counts.topology >= 1);
});

test('Phase 10: les actions admin ne fuient pas vers les autres rôles', () => {
  const data = fullSnapshot();
  const summary = buildEquipmentRelationSummary(data.equipment, { ...data, continuityRecords:data.docs });
  const tech = buildEquipmentContextActionPlan(data.equipment, summary, { user:{ role:'technician' }, equipments:data.equipments, tickets:[] });
  const visitor = buildEquipmentContextActionPlan(data.equipment, summary, { user:{ role:'visitor' }, equipments:data.equipments, tickets:[] });
  assert.ok(actionIds(tech).includes('diagrams'));
  assert.ok(!actionIds(tech).includes('signal-flow'));
  assert.ok(!actionIds(visitor).includes('diagrams'));
  assert.ok(!actionIds(visitor).includes('signal-flow'));
});

test('Phase 10: des relations étrangères ne rendent jamais une action disponible', () => {
  const equipment = { id:'eq1', name:'A', roomId:null, ports:[], components:[] };
  const summary = buildEquipmentRelationSummary(equipment, {
    rooms:[], baies:[], equipments:[equipment, { id:'eq2', name:'B' }, { id:'eq3', name:'C' }], walls:[], screens:[],
    cables:[{ id:'c-other', sourceType:'equipment', sourceId:'eq2', destinationType:'equipment', destinationId:'eq3' }],
    docs:[{ kind:'technical_diagram', id:'d-other', nodes:[{ entityRef:{ type:'equipment', id:'eq2' } }] }], continuityRecords:[]
  });
  const plan = buildEquipmentContextActionPlan(equipment, summary, { user:{ role:'admin' }, equipments:[equipment], tickets:[] });
  assert.deepEqual(actionIds(plan), ['new-ticket']);
});

test('Phase 10: le contrat de navigation correspond aux vraies clés runtime et garde les anciens deep-links', () => {
  const admin = allowedSectionsForRole('admin');
  assert.ok(admin.includes('cables'));
  assert.ok(admin.includes('signalFlow'));
  assert.ok(!admin.includes('signal-flow'));
  const legacy = parseHashRoute('#/signal-flow', { role:'admin' });
  assert.equal(legacy.section, 'signalFlow');
  assert.equal(legacy.canonicalHash, '#/signalFlow');
  assert.equal(parseHashRoute('#/screens', { role:'admin' }).section, 'screensDiagnostic');
});

test('Phase 10: chaque bouton appelle un workflow existant au lieu de simuler une fonction', () => {
  assert.match(actionsSource, /openInteractiveMap/);
  assert.match(actionsSource, /openTicketModal/);
  assert.match(actionsSource, /openDiagramLibrary/);
  assert.match(actionsSource, /buildEquipmentRelationSummary/);
  assert.match(actionsSource, /buildHashRoute\(\{ section:'signalFlow' \}\)/);
  assert.match(actionsSource, /\.ops-port-integrations/);
  assert.match(actionsSource, /\.ops-flow/);
  assert.match(actionsSource, /\.ops-component-integrations/);
  assert.doesNotMatch(actionsSource, /Math\.random\(|dummy|fake|mock/i);
});

test('Phase 10: le shell et le PWA chargent l’action hub après ses dépendances et avant Core', () => {
  const context = index.indexOf('src="equipment-context-actions.js"');
  const relations = index.indexOf('src="equipment-relations-360.js"');
  const diagrams = index.indexOf('src="diagram-studio.js"');
  const navigation = index.indexOf('src="role-navigation-integration.js"');
  const core = index.indexOf('src="core.js"');
  assert.ok(relations >= 0 && diagrams >= 0 && context > relations && context > diagrams, 'les dépendances 360/diagrammes doivent précéder les actions');
  assert.ok(navigation > context && core > context, 'les actions doivent être installées avant navigation finale/Core');
  assert.match(worker, /\/equipment-context-actions\.js/);
});
