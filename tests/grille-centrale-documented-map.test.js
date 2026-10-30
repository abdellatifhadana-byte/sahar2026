import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * #137 — LE JEU DE DONNÉES A CHANGÉ D'ADRESSE, PAS DE CONTENU.
 *
 * Ces vérifications portent sur les libellés, les repères et les invariants de la Grille
 * Centrale. Ils vivaient dans un module servi au navigateur ; ils vivent désormais sous
 * `scripts/private-operational-data/`, que le serveur refuse de servir. Le test les lit à
 * leur nouvelle adresse : Node y a accès, HTTP non — et c'est précisément ce que ce lot
 * établit. Aucune assertion n'est relâchée.
 */

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const map = read('scripts/private-operational-data/grille-centrale.js');
const ecran = read('grille-centrale-documented-map.js');
const { buildGrilleCentraleSeedRecords } = await import('../scripts/private-operational-data/grille-centrale.js');
const seedRecords = buildGrilleCentraleSeedRecords();
const hostBridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

function arrayStrings(name) {
  const start = map.indexOf(`export const ${name} = Object.freeze([`);
  assert.notEqual(start, -1, `tableau manquant: ${name}`);
  const end = map.indexOf('\n]);', start);
  assert.notEqual(end, -1, `fin de tableau manquante: ${name}`);
  return [...map.slice(start, end).matchAll(/"([^"]*)"/g)].map(match => match[1]);
}

const inputs = arrayStrings('GRILLE_CENTRALE_INPUT_LABELS');
const outputs = arrayStrings('GRILLE_CENTRALE_OUTPUT_LABELS');

test('Phase 13: le synoptique 2M devient une source documentaire versionnée', () => {
  for (const token of ['LTS MAROC','GC 2M','DT/EH/11/2011','2012-08-31','SYNOPTIQUE VIDEO GRILLE CENTRALE','Son Tran','A0']) {
    assert.ok(map.includes(token), `provenance manquante: ${token}`);
  }
  assert.match(map, /evidenceStatus:'field-photo-of-site-document'/);
  assert.match(map, /currentAsBuiltStatus:'not-yet-field-traced'/);
  assert.match(map, /doesNotProve:Object\.freeze\(\[/);
  for (const forbiddenClaim of ['Platinum frame SKU','card/slot population','rear BNC connector mapping','active crosspoints']) assert.ok(map.includes(forbiddenClaim));
});

test('Phase 13: la transcription contient exactement 190 entrées et 184 sorties', () => {
  assert.equal(inputs.length, 190);
  assert.equal(outputs.length, 184);
  assert.equal(inputs[0], 'VTR 1');
  assert.equal(inputs[12], 'VTR 13');
  assert.equal(inputs[127], 'RESERVE 6');
  assert.equal(inputs[128], 'HD VTR 1');
  assert.equal(inputs[144], 'AVID 1');
  assert.equal(inputs[168], 'RESERVE 7');
  assert.equal(inputs[189], 'RESERVE 28');
  assert.equal(outputs[0], 'VTR 1');
  assert.equal(outputs[143], 'AUDIOMON');
  assert.equal(outputs[144], 'HD VTR 1');
  assert.equal(outputs[166], 'RESERVE 9');
  assert.equal(outputs[183], 'RESERVE 26');
});

test('Phase 13: les anomalies historiques du document ne sont pas normalisées artificiellement', () => {
  assert.deepEqual(inputs.slice(84, 88), ['NEDIT 1','NEDIT 2','NEDIT 5','NEDIT 4']);
  assert.deepEqual(outputs.slice(100, 104), ['NEDIT 1','NEDIT 2','NEDIT 5','NEDIT 4']);
  assert.deepEqual(inputs.slice(128, 138), ['HD VTR 1','HD VTR 2','HD VTR 3','HD VTR 5','HD VTR 6','HD VTR 7','HD VTR 8','HD VTR 9','HD VTR 10','HD VTR 12']);
  assert.deepEqual(outputs.slice(144, 154), ['HD VTR 1','HD VTR 2','HD VTR 3','HD VTR 5','HD VTR 6','HD VTR 7','HD VTR 8','HD VTR 9','HD VTR 10','HD VTR 12']);
  assert.equal(outputs[143], 'AUDIOMON');
  assert.ok(!outputs.includes('RESERVE 8'), 'OUT.144 ne doit jamais être réécrit en RESERVE 8');
});

test('Phase 13: les quatre domaines documentaires gardent leurs frontières exactes', () => {
  assert.match(map, /id:'IN\/SDI', direction:'INPUT', from:1, to:128, count:128/);
  assert.match(map, /id:'IN\/HD', direction:'INPUT', from:129, to:190, count:62/);
  assert.match(map, /id:'OUT\/SDI', direction:'OUTPUT', from:1, to:144, count:144/);
  assert.match(map, /id:'OUT\/HD', direction:'OUTPUT', from:145, to:184, count:40/);
  // Ces trois nombres se DÉRIVENT désormais des tableaux de libellés au lieu d'être écrits
  // à la main : on les vérifie sur la fiche réellement produite (#137).
  const fiche = seedRecords.mapRecord;
  assert.equal(fiche.logicalPortCount, 374);
  assert.equal(fiche.inputCount, 190);
  assert.equal(fiche.outputCount, 184);
});

test('Phase 13: SYNCH, XY, ENET et SERIAL restent des interfaces séparées des 190 entrées', () => {
  for (const token of ['SYNCH 1','BLACK','SYNCH 2','Tri-Level','SYNCH 3','REF-AES','SYNCH 4','TDM SYNC (INTERNE)','XY-1','XY-2','ENET-1','ENET-2','SERIAL 1','SERIAL 2']) {
    assert.ok(map.includes(token), `interface manquante: ${token}`);
  }
  assert.match(map, /syncReferencesAreNotInputs:true/);
  assert.equal(inputs.length, 190);
  assert.ok(!map.includes("gc-in-191"), 'aucun port logique IN.191 ne doit être généré');
});

test('Phase 13: Monitoring est hors matrice et les deux chaînes vers BAIE 3 CHASSIS 5 sont documentées', () => {
  assert.match(map, /dedicatedMonitoringOutputs:2/);
  assert.match(map, /monitoringOutputsAreNotMatrixOutputs:true/);
  assert.equal(outputs.length, 184);
  assert.ok(!map.includes("gc-out-185"), 'aucun port logique OUT.185 ne doit être généré');
  assert.match(map, /MONITORING\/OUT\.1/);
  assert.match(map, /grNear:'GR691'/);
  assert.match(map, /grFar:'GR717'/);
  assert.match(map, /equipment:'DMUX\/1'/);
  assert.match(map, /model:'HDX6801\+B4D'/);
  assert.match(map, /MONITORING\/OUT\.2/);
  assert.match(map, /grNear:'GR692'/);
  assert.match(map, /grFar:'GR718'/);
  assert.match(map, /equipment:'DMUX\/2'/);
  assert.match(map, /familyCandidate:'HDX6801\+'/);
  assert.match(map, /exactVariantStatus:'to-confirm'/);
  assert.match(map, /currentPhysicalCableVerified:false/);
});

test('Phase 13: les références GR restent des repères installation et non des BNC Harris inventés', () => {
  for (const token of ["routerPort:'IN.1'","nearRef:'GR1'","farRef:'GR27'","routerPort:'OUT.1'","nearRef:'GR417'","farRef:'GR443'"]) assert.ok(map.includes(token));
  assert.match(map, /patchInterpretation:'probable'/);
  assert.match(map, /grReferencesAreNotHarrisPhysicalPortNumbers:true/);
  assert.match(map, /rearConnectorMappingStatus:'to-confirm'/);
  assert.match(map, /physicalPortRef:null/);
});

test('Phase 13: 374 ports logiques sont créés sans crosspoint et sans convertir HD en standard non prouvé', () => {
  // Le module privé n'importe pas le contrat de topologie : il écrit le `kind` canonique
  // directement. La garantie vérifiée reste la même — c'est bien un port de grille.
  assert.match(map, /kind:'topology_router_port'/);
  assert.match(map, /signalType:domain\?\.documentSignalLabel === 'SDI' \? 'SDI' : 'AUTRE'/);
  assert.match(map, /signalStandardExact:domain\?\.documentSignalLabel === 'SDI' \? 'document-labeled-SDI' : 'to-confirm-beyond-HD-label'/);
  assert.match(map, /activeCrosspointsCreated:false/);
  assert.match(map, /activeCrosspointsInferred:false/);

  assert.doesNotMatch(map, /kind\s*:\s*['"]topology_crosspoint['"]/);
});

test('Phase 13: la Fiche 360 fournit une recherche sur le plan documenté et conserve la chaîne de preuves', () => {
  // L'ÉCRAN garde ses garanties d'affichage ; il ne porte plus les valeurs. Le titre a
  // perdu son millésime et le champ de recherche son exemple, parce que tous deux citaient
  // le document réel — la fonction de recherche, elle, est intacte (#137).
  assert.match(ecran, /Plan documenté des ports & câbles/);
  assert.match(ecran, /data-gc-map-search/);
  assert.match(ecran, /maximum 50/);
  assert.match(ecran, /design 2M confirmé/);
  assert.match(ecran, /connecteur arrière actuel à confirmer/);
  assert.match(ecran, /Aucun crosspoint actif n’est créé ou inféré/);
  // Et il ne dessine RIEN sans autorisation : c'est l'invariant que ce lot ajoute.
  assert.match(ecran, /if \(!ensured\.authorized\) return false;/);
});

test('Phase 13: le module est chargé après les preuves/architecture et reste disponible hors ligne', () => {
  const p11 = hostBridge.indexOf("import './phase11-field-pack-migration.js'");
  const field = hostBridge.indexOf("import './field-evidence-integration.js'");
  const p12 = hostBridge.indexOf("import './equipment-field-evidence-phase12.js'");
  const physical = hostBridge.indexOf("import './grille-centrale-physical-architecture.js'");
  const documented = hostBridge.indexOf("import './grille-centrale-documented-map.js'");
  assert.ok(p11 >= 0 && field > p11 && p12 > field && physical > p12 && documented > physical);
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/grille-centrale-documented-map\.js/);
  assert.match(worker, /\/grille-centrale-physical-architecture\.js/);
  assert.match(worker, /\/equipment-field-evidence-phase12\.js/);
});