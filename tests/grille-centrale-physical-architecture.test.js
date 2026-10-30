import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGrilleCentralePhysicalSeed } from '../scripts/private-operational-data/grille-centrale.js';

/*
 * #137 — LES DONNÉES ONT CHANGÉ D'ADRESSE, PAS DE CONTENU.
 *
 * Le jeu de données Grille Centrale vit désormais sous `scripts/private-operational-data/`,
 * que le serveur refuse de servir. Node y accède, HTTP non : ces vérifications gardent
 * exactement les mêmes valeurs, à leur nouvelle adresse.
 */

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const physical = read('scripts/private-operational-data/grille-centrale.js');
const ecran = read('grille-centrale-physical-architecture.js');
// Les négations portent sur LA SECTION architecture physique, pas sur tout le module privé
// qui réunit désormais l'ensemble du jeu de données Grille Centrale (#137).
const architecture = JSON.stringify(buildGrilleCentralePhysicalSeed(), null, 1);
const hostBridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

function section(id, nextId = null) {
  const start = physical.indexOf(`id:'${id}'`);
  assert.notEqual(start, -1, `section manquante: ${id}`);
  if (!nextId) return physical.slice(start);
  const end = physical.indexOf(`id:'${nextId}'`, start + id.length);
  return physical.slice(start, end === -1 ? undefined : end);
}

test('architecture physique: le flux primaire reste GR-1 -> Harris Platinum -> GR-2 avec matrice 190x184', () => {
  assert.match(physical, /primaryFlow:\['gc-physical-gr1-inputs','gc-physical-platinum-core','gc-physical-gr2-outputs'\]/);
  assert.match(physical, /canonicalMatrix:'190 × 184'/);
  assert.match(physical, /matrixAuthority:'Synoptique interne 2M'/);
  assert.match(section('gc-physical-gr1-inputs','gc-physical-platinum-core'), /BAIE GR-1 — Inputs/);
  assert.match(section('gc-physical-platinum-core','gc-physical-gr2-outputs'), /CHASSIS 4 — Harris Platinum/);
  assert.match(section('gc-physical-gr2-outputs','gc-physical-gr3-control-sync'), /BAIE GR-2 — Outputs/);
});

test('architecture physique: chaque zone terrain reste liée à la preuve correcte', () => {
  assert.match(section('gc-physical-gr1-inputs','gc-physical-platinum-core'), /evidenceAssetId:'2m-field-01'/);
  assert.match(section('gc-physical-platinum-core','gc-physical-gr2-outputs'), /evidenceAssetId:'2m-field-06'/);
  assert.match(section('gc-physical-gr2-outputs','gc-physical-gr3-control-sync'), /evidenceAssetId:'2m-field-02'/);
  assert.match(section('gc-physical-gr3-control-sync','gc-physical-monitoring'), /evidenceAssetId:'2m-field-07'/);
  assert.match(section('gc-physical-platinum-core','gc-physical-gr2-outputs'), /verificationStatus:'field-photo-confirmed'/);
});

test('architecture physique: les libellés GR-1/GR-2 ne deviennent jamais des ports ou câbles inventés', () => {
  const gr1 = section('gc-physical-gr1-inputs','gc-physical-platinum-core');
  const gr2 = section('gc-physical-gr2-outputs','gc-physical-gr3-control-sync');
  for (const label of ['E.VIDEO-SD','E.VIDEO-HD','E.AUDIO','RS422']) assert.ok(gr1.includes(label), `libellé GR-1 manquant: ${label}`);
  for (const label of ['S.VIDEO-SD','S.VIDEO-HD','S.AUDIO']) assert.ok(gr2.includes(label), `libellé GR-2 manquant: ${label}`);
  assert.match(gr1, /exactPortMapping:'to-confirm'/);
  assert.match(gr1, /exactCableMapping:'to-confirm'/);
  assert.match(gr2, /exactPortMapping:'to-confirm'/);
  assert.match(gr2, /exactCableMapping:'to-confirm'/);
  assert.doesNotMatch(architecture, /physicalPortRef/);
  assert.doesNotMatch(architecture, /portNumber/);
});

test('architecture physique: GR-3 Control/Sync sépare interfaces logiques et affectation physique', () => {
  const gr3 = section('gc-physical-gr3-control-sync','gc-physical-monitoring');
  assert.match(gr3, /documentedLogicalInterfaces:logicalControlSyncNames/);
  assert.match(gr3, /physicalInterfaceAssignment:'to-confirm'/);
  assert.match(gr3, /exactControlProtocol:'to-confirm'/);
  assert.match(gr3, /exactControlWiring:'to-confirm'/);
  assert.match(gr3, /exactSyncWiring:'to-confirm'/);
  const link = section('gc-physical-link-gr3-core','gc-physical-link-core-monitoring');
  assert.match(link, /verificationStatus:'to-confirm'/);
  assert.match(link, /exactEndpointMapping:'to-confirm'/);
  assert.match(link, /exactCableRefs:Object\.freeze\(\[\]\)/);
});

test('architecture physique: Monitoring reprend uniquement les interfaces et câbles du synoptique interne', () => {
  assert.match(physical, /interfaceType === 'MONITORING_OUTPUT'/);  // la vue dérivée suit la donnée
  assert.match(physical, /documentedInterfaces:monitoringNames/);
  assert.match(physical, /documentedCableRefs:monitoringCableRefs/);
  assert.match(physical, /physicalEndpointMapping:'to-confirm'/);
  assert.match(physical, /exactCableRefs:monitoringCableRefs/);
});

test('architecture physique: aucun châssis précis, carte/slot ou crosspoint actif n’est inventé', () => {
  assert.match(physical, /exactChassisSku:null/);
  assert.match(physical, /exactSlotPopulation:null/);
  assert.match(physical, /activeCrosspointsCreated:false/);
  assert.match(physical, /activeCrosspointsInferred:false/);
  assert.doesNotMatch(architecture, /PT-FR-15|PT-FR-28/);
  assert.doesNotMatch(architecture, /"kind"\s*:\s*"crosspoint"/i);
  assert.doesNotMatch(architecture, /"activeCrosspoint"/i);
});

test('architecture physique: le Harris Platinum legacy reste distinct du Platinum VX', () => {
  assert.match(physical, /family:'Platinum \(legacy\)'/);
  assert.match(physical, /legacyPlatinumIsNotPlatinumVX:true/);
  assert.match(physical, /capacityNeverDerivedFromVendorExample:true/);
  assert.match(physical, /Platinum VX est un produit distinct/);
  assert.doesNotMatch(section('gc-physical-platinum-core','gc-physical-gr2-outputs'), /family:'Platinum VX'/);
});

test('architecture physique: la recherche constructeur est limitée au contexte famille/contrôle', () => {
  assert.match(physical, /imaginecommunications\.com\/make-tv\/products\/production-infrastructure\/platinum-routers/);
  assert.match(physical, /imaginecommunications\.com\/insights-and-resources\/imagine-communications-introduces-platinum-vx-small-to-midsize-digital-video-router/);
  assert.match(physical, /scope:'vendor-family-only'/);
  assert.match(physical, /scope:'product-separation-only'/);
  assert.match(physical, /La plage constructeur 16×16 à 288×288 du Platinum VX n’est jamais appliquée à la matrice interne 2M 190×184/);
  assert.match(physical, /doesNotProve:Object\.freeze/);
});

test('architecture physique: Fiche 360 et PWA chargent le module sans perdre les preuves existantes', () => {
  // L'écran garde son titre et son contrat d'intégrité ; il ne porte plus la capacité.
  assert.match(ecran, /Architecture physique — Grille Centrale/);
  assert.match(ecran, /Contrat d’intégrité/);
  assert.match(ecran, /if \(!ensured\.authorized\) return false;/);
  const p11 = hostBridge.indexOf("import './phase11-field-pack-migration.js'");
  const field = hostBridge.indexOf("import './field-evidence-integration.js'");
  const p12 = hostBridge.indexOf("import './equipment-field-evidence-phase12.js'");
  const architecture = hostBridge.indexOf("import './grille-centrale-physical-architecture.js'");
  assert.ok(p11 >= 0 && field > p11 && p12 > field && architecture > p12);
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/grille-centrale-physical-architecture\.js/);
  assert.match(worker, /\/phase11-field-pack-migration\.js/);
  assert.match(worker, /\/equipment-field-evidence-phase12\.js/);
  // #78 Phase 0 : cette image n'est plus précachée — c'était exactement la fuite mesurée.
  const precacheList = worker.slice(worker.indexOf('const ASSETS_TO_CACHE'), worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE')));
  assert.doesNotMatch(precacheList, /\/assets\/field-evidence\/2026-08-16\/phase12-09\.webp/);
});