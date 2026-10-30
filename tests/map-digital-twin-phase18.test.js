import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAP_DIGITAL_TWIN_PHASE,
  mapEntityPositionState,
  normalizedOperationalState,
  mapQualitySummary,
  smartMapSearch
} from '../map-digital-twin-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('map-digital-twin.js');
const contract = read('map-digital-twin-contract.js');
const css = read('map-digital-twin.css');
const index = read('index.html');
const worker = read('service-worker.js');
const legacyMap = read('interactive-map.js');

const snapshot = {
  rooms:[{id:1,name:'Régie Finale',rect:{x:10,y:20,w:300,h:200}},{id:'stc',name:'Salle STC'}],
  baies:[{id:10,name:'BAIE GR-1 Inputs',roomId:1,x_inRoom:240,y_inRoom:180}],
  equipments:[
    {id:100,name:'Harris Platinum',marque:'Harris',modele:'Platinum',roomId:1,baieId:10,x_inBaie:100,y_inBaie:80,status:'Opérationnel'},
    {id:'leader',name:'LEADER LV5300A',marque:'Leader',modele:'LV5300A',roomId:1,status:'À vérifier',requiresFieldConfirmation:true}
  ],
  tickets:[{id:7,status:'en cours',relatedType:'equipment',relatedId:100}],walls:[],screens:[],cables:[],docs:[]
};

test('Phase 18: la carte devient un jumeau opérationnel additif sans réécrire interactive-map', () => {
  assert.equal(MAP_DIGITAL_TWIN_PHASE,18);
  assert.match(source,/buildPlatformEntityGraph/);
  assert.match(source,/traceGraph/);
  assert.match(source,/Mode Impact/);
  assert.match(source,/Aucun routage live n’est deviné/);
  assert.doesNotMatch(source,/db\.save\(['"]cables['"]/);
  assert.doesNotMatch(source,/crosspoint.*db\.save/i);
  // Le runtime legacy expose historiquement openInteractiveMap comme export par défaut synchrone.
  // Phase 18 doit rester additive et ne pas imposer une signature fictive au module existant.
  assert.match(legacyMap,/export default function openInteractiveMap\s*\(/);
});

test('Phase 18: la couverture position respecte salle, baie et équipement selon leur contexte', () => {
  assert.equal(mapEntityPositionState('room',snapshot.rooms[0]),true);
  assert.equal(mapEntityPositionState('room',snapshot.rooms[1]),false);
  assert.equal(mapEntityPositionState('baie',snapshot.baies[0]),true);
  assert.equal(mapEntityPositionState('equipment',snapshot.equipments[0]),true);
  assert.equal(mapEntityPositionState('equipment',snapshot.equipments[1]),false);
  const quality=mapQualitySummary(snapshot);
  assert.equal(quality.total,5);
  assert.equal(quality.positioned,3);
  assert.equal(quality.coverage,60);
  assert.equal(quality.tickets,1);
  assert.equal(quality.needsEvidence,1);
  assert.equal(quality.missing.length,2);
});

test('Phase 18: une forme imbriquée compte comme un placement, sans remplacer le point hérité', () => {
  // Ni point ni forme : non placée, comme avant.
  const baieNonPlacee = { id: 20, name: 'Baie sans repère' };
  assert.equal(mapEntityPositionState('baie', baieNonPlacee), false);
  // Une forme documentée SEULE (aucun x_inRoom/y_inRoom) suffit.
  const baieAvecForme = { id: 21, name: 'Baie dessinée', shapeInRoom: { type: 'rect', x: 5, y: 5, w: 40, h: 40 } };
  assert.equal(mapEntityPositionState('baie', baieAvecForme), true);
  const eqAvecFormeBaie = { id: 200, name: 'Eq en baie', shapeInBaie: { type: 'circle', center: { x: 10, y: 10 }, r: 4 } };
  assert.equal(mapEntityPositionState('equipment', eqAvecFormeBaie), true);
  const eqAvecFormeSalle = { id: 201, name: 'Eq en salle', shapeInRoom: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } };
  assert.equal(mapEntityPositionState('equipment', eqAvecFormeSalle), true);
  // Le point hérité continue de compter seul, la forme n'étant pas obligatoire.
  assert.equal(mapEntityPositionState('baie', snapshot.baies[0]), true);
});

test('Phase 18: les statuts ne traitent plus « À vérifier » comme opérationnel', () => {
  assert.equal(normalizedOperationalState({status:'faulty'}),'fault');
  assert.equal(normalizedOperationalState({status:'En panne'}),'fault');
  assert.equal(normalizedOperationalState({status:'À vérifier'}),'warning');
  assert.equal(normalizedOperationalState({status:'Opérationnel'}),'ok');
  assert.equal(normalizedOperationalState({status:''}),'neutral');
});

test('Phase 18: la recherche est accent-insensitive, classée et enrichie par localisation', () => {
  const byModel=smartMapSearch(snapshot,'lv5300a');
  assert.equal(byModel[0].id,'leader');
  const byAccent=smartMapSearch(snapshot,'regie finale');
  assert.ok(byAccent.some(item => item.type === 'room' && item.id === 1));
  assert.ok(byAccent.some(item => item.type === 'equipment' && item.id === 100));
  const byBaie=smartMapSearch(snapshot,'gr 1');
  assert.equal(byBaie[0].type,'baie');
});

test('Phase 18: le contrat cartographique pur reste Node-safe et ne transforme pas null en coordonnées 0,0', () => {
  assert.equal(mapEntityPositionState('room',{id:'null-room',x_inMap:null,y_inMap:null}),false);
  assert.equal(mapEntityPositionState('equipment',{id:'empty-equipment',x_inRoom:'',y_inRoom:''}),false);
  assert.doesNotMatch(contract,/from ['"].*db\.js/);
  // Un identifiant local peut légitimement s'appeler « document » ; on interdit ici les vraies API navigateur.
  assert.doesNotMatch(contract,/\bwindow\.|\bindexedDB\b|\bdocument\.(?:getElementById|querySelector|querySelectorAll|createElement|addEventListener|body|head)\b/);
});

test('Phase 18: le runtime répare les trous UX concrets de la carte legacy', () => {
  assert.match(source,/admin-context-menu/);
  assert.match(source,/__mapTypedAttributeBridge/);
  assert.match(source,/pointerdown/);
  assert.match(source,/tabIndex=0/);
  assert.match(source,/map-digital-dirty/);
  assert.match(source,/welcome-seen/);
  assert.match(source,/map-smart-result/);
  assert.match(source,/tech-icon\.webp/);
  assert.match(css,/map-digital-alerts-only/);
  assert.match(css,/map-impact-downstream/);
  assert.match(css,/map-command-center/);
});

test('Phase 18: le shell et le PWA chargent CSS, runtime et contrat du jumeau cartographique', () => {
  const fit=index.indexOf('src="map-fit-fix.js"');
  const twin=index.indexOf('src="map-digital-twin.js"');
  const bridge=index.indexOf('src="map-equipment-360-bridge.js"');
  assert.ok(fit >= 0 && twin > fit && bridge > twin);
  assert.match(index,/href="map-digital-twin\.css"/);
  const cacheVersion = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cacheVersion && Number(cacheVersion[1]) >= 29, 'Phase 18 exige le cache PWA v5.29 ou supérieur');
  assert.match(worker,/\/map-digital-twin\.js/);
  assert.match(worker,/\/map-digital-twin-contract\.js/);
  assert.match(worker,/\/map-digital-twin\.css/);
});
