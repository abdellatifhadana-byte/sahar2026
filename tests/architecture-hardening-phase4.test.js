import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RELATIONSHIP_CONTRACT_VERSION,
  buildRelationshipIndex,
  resolveEquipmentLocation,
  physicalPathLabel,
  normalizePhysicalPortRef,
  resolvePhysicalPortReference,
  validateRouterPortPhysicalLink
} from '../relationship-contract.js';
import { validateTopologyRecord } from '../topology-contract.js';
import { buildEquipmentRelationSummary } from '../equipment-relations-360.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const integrity = read('data-integrity.js');
const integrityCenter = read('integrity-center.js');
const index = read('index.html');
const serviceWorker = read('service-worker.js');

test('la localisation canonique suit salle → baie → équipement et détecte les incohérences', () => {
  assert.equal(RELATIONSHIP_CONTRACT_VERSION, 1);
  const rooms = [{ id:'r1', name:'RF1' }, { id:'r2', name:'RF2' }];
  const baies = [{ id:'b1', name:'B01.RF1', roomId:'r1' }];
  const equipment = { id:'eq1', name:'Routeur', roomId:'r1', baieId:'b1' };
  const index = buildRelationshipIndex({ rooms, baies, equipments:[equipment] });
  const good = resolveEquipmentLocation(equipment, index);
  assert.equal(good.valid, true);
  assert.deepEqual(good.path.map(item => item.type), ['room','baie','equipment']);
  assert.equal(physicalPathLabel(good), 'RF1 › B01.RF1 › Routeur');

  const mismatch = resolveEquipmentLocation({ ...equipment, roomId:'r2' }, index);
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.issues.some(issue => issue.code === 'baie-room-mismatch'));

  const missingRoom = resolveEquipmentLocation({ ...equipment, roomId:null }, index);
  assert.ok(missingRoom.issues.some(issue => issue.code === 'equipment-room-missing-for-baie'));
  assert.equal(missingRoom.room?.id, 'r1');
});

test('une relation port grille ↔ port physique n’est acceptée que si elle est explicite et résolue', () => {
  const equipment = {
    id:'eq-router', name:'Grille physique',
    ports:[{ id:'in-1', number:'IN-1', direction:'IN', type:'SDI' }, { id:'out-1', number:'OUT-1', direction:'OUT', type:'SDI' }],
    components:[{ id:'card-1', name:'Carte I/O', ports:[{ id:'card-out', number:'1', direction:'OUT', type:'SDI' }] }]
  };
  const index = buildRelationshipIndex({ equipments:[equipment] });
  const ref = normalizePhysicalPortRef({ ownerType:'equipment', ownerId:'eq-router', portId:'in-1', verificationStatus:'observed', evidenceRef:'photo-2m-01' });
  assert.deepEqual(ref, {
    ownerType:'equipment', ownerId:'eq-router', portId:'in-1', parentEquipmentId:null,
    verificationStatus:'observed', evidenceRef:'photo-2m-01'
  });
  assert.equal(resolvePhysicalPortReference(ref, index).valid, true);
  assert.equal(validateRouterPortPhysicalLink({ id:'rp1', direction:'INPUT', physicalPortRef:ref }, index).status, 'mapped');

  const directionMismatch = validateRouterPortPhysicalLink({
    id:'rp2', direction:'INPUT', physicalPortRef:{ ownerType:'equipment', ownerId:'eq-router', portId:'out-1' }
  }, index);
  assert.equal(directionMismatch.valid, false);
  assert.match(directionMismatch.errors.join(' '), /Direction incompatible/);

  const component = resolvePhysicalPortReference({ ownerType:'component', ownerId:'card-1', parentEquipmentId:'eq-router', portId:'card-out' }, index);
  assert.equal(component.valid, true);
  assert.equal(component.owner.id, 'card-1');

  const unmapped = validateRouterPortPhysicalLink({ id:'rp3', direction:'INPUT' }, index);
  assert.deepEqual({ status:unmapped.status, valid:unmapped.valid, errors:unmapped.errors }, { status:'unmapped', valid:true, errors:[] });
});

test('le contrat topologique refuse un physicalPortRef incomplet sans exiger de mapping quand il est absent', () => {
  const base = { kind:'topology_router_port', routerId:'router-a', direction:'INPUT', portNumber:1, logicalAlias:'IN 1' };
  assert.deepEqual(validateTopologyRecord(base), []);
  assert.match(validateTopologyRecord({ ...base, physicalPortRef:{ ownerType:'equipment', ownerId:'eq1' } }).join(' '), /mapping vers le port physique est invalide/i);
  assert.deepEqual(validateTopologyRecord({ ...base, physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'p1' } }), []);
});

test('la Fiche 360 résume uniquement les relations réellement documentées et résolues', () => {
  const equipment = { id:'eq1', name:'Device A', roomId:'r1', baieId:'b1', ports:[{ id:'p1', number:'1', direction:'IN', type:'SDI' }] };
  const snapshot = {
    rooms:[{ id:'r1', name:'STC' }],
    baies:[{ id:'b1', name:'B01', roomId:'r1' }],
    equipments:[equipment],
    cables:[
      { id:'c1', sourceType:'equipment', sourceId:'eq1', destinationType:'equipment', destinationId:'eq2' },
      { id:'c2', sourceType:'equipment', sourceId:'other', destinationType:'equipment', destinationId:'eq2' }
    ],
    docs:[
      { kind:'technical_diagram', id:'d1', nodes:[{ entityRef:{ type:'equipment', id:'eq1' } }] },
      { kind:'technical_diagram', id:'d2', nodes:[{ entityRef:{ type:'equipment', id:'other' } }] },
      { kind:'topology_router', id:'router1', name:'Router 1', routerEquipmentId:'eq1' },
      { kind:'topology_router_port', id:'rp1', routerId:'router1', direction:'INPUT', portNumber:1, physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'p1' } },
      { kind:'topology_router_port', id:'rp-invalid', routerId:'router1', direction:'INPUT', portNumber:2, physicalPortRef:{ ownerType:'equipment', ownerId:'eq1', portId:'missing' } }
    ]
  };
  const summary = buildEquipmentRelationSummary(equipment, snapshot);
  assert.equal(summary.breadcrumb, 'STC › B01 › Device A');
  assert.equal(summary.counts.cables, 1);
  assert.equal(summary.counts.diagrams, 1);
  assert.equal(summary.counts.routers, 1);
  assert.equal(summary.counts.mappedRouterPorts, 1);
  assert.equal(summary.counts.invalidRouterPortLinks, 1);
  assert.equal(summary.counts.locationIssues, 0);
  assert.ok(summary.counts.canonicalLinks >= 3);
  assert.equal(summary.declaredRouterPortLinks.length, 2);
  assert.equal(summary.mappedRouterPorts[0].id, 'rp1');
});

test('le centre d’intégrité contrôle les incohérences de localisation et les mappings physiques déclarés', () => {
  assert.match(integrity, /issues\.equipmentLocations/);
  assert.match(integrity, /resolveEquipmentLocation/);
  assert.match(integrity, /issues\.topologyPhysicalPortLinks/);
  assert.match(integrity, /validateRouterPortPhysicalLink/);
  assert.match(integrityCenter, /Cohérence salle \/ baie \/ équipement/);
  assert.match(integrityCenter, /Liens port grille \/ port physique/);
  assert.match(integrityCenter, /Ports grille mappés/);
});

test('le résumé relationnel est branché dans la Fiche 360 et disponible hors ligne', () => {
  assert.match(index, /src="equipment-relations-360\.js"/);
  assert.match(serviceWorker, /\/relationship-contract\.js/);
  assert.match(serviceWorker, /\/equipment-relations-360\.js/);
});