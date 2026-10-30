/**
 * @file cable-route-persistance-p0f.test.js — LE TRACÉ SURVIT-IL VRAIMENT AU TRANSPORT ?
 *
 * L'arbitrage qui a placé le tracé DANS l'enregistrement du câble a été pris avec une
 * condition explicite : ne pas se fier au fait qu'un `...source` conserve les champs
 * inconnus. « Ça devrait passer » n'est pas une garantie — c'est l'absence d'épreuve.
 *
 * On exécute donc le VRAI `backup-service.js` contre un magasin en mémoire, comme le fait
 * déjà `backup-restore-locations-p0c.test.js` : ni base, ni serveur réels, mais le vrai
 * code de sauvegarde et de restauration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = undefined;
const { db } = await import('../db.js');
const { normalizeCableRecord, normalizeCableRoute, sameCableRoute } = await import('../connectivity-contract.js');

let magasin = new Map();
const cloner = valeur => JSON.parse(JSON.stringify(valeur));
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
db.getAll = async store => [...magasin.entries()].filter(([cle]) => cle.startsWith(`${store}|`)).map(([, v]) => cloner(v));
db.get = async (store, id) => { const v = magasin.get(`${store}|${id}`); return v ? cloner(v) : undefined; };
db._getRaw = db.get;
db.save = async (store, record) => { magasin.set(`${store}|${record.id}`, cloner(record)); return record.id; };
db.saveLocalOnly = db.save;
db._deleteRaw = async (store, id) => magasin.delete(`${store}|${id}`);
db.isCentralSyncReady = () => true;
db.version = 1;

globalThis.fetch = async url => {
  if (String(url).includes('/api/rooms/transfer')) {
    return { ok: true, status: 200, json: async () => ({ formatVersion: 2, rooms: [], roomZones: [] }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const { BackupService } = await import('../backup-service.js');

const TRACE = Object.freeze({
  version: 1, status: 'verified', segments: [
    { sceneType: 'room', sceneId: 'STC', naturalWidth: 2000, naturalHeight: 1000,
      waypoints: [{ x: 10, y: 10 }, { x: 400, y: 300 }], anchors: [{ role: 'source', x: 10, y: 10 }] },
    { sceneType: 'map', sceneId: null, naturalWidth: 4000, naturalHeight: 3000,
      waypoints: [{ x: 400, y: 300 }, { x: 2200, y: 1500 }], anchors: [] },
    { sceneType: 'baie', sceneId: 'B-12', naturalWidth: 900, naturalHeight: 1800,
      waypoints: [{ x: 50, y: 60 }, { x: 700, y: 1600 }], anchors: [{ role: 'destination', x: 700, y: 1600 }] }
  ]
});

const CABLE = Object.freeze({
  id: 'CAB-ROUTE', reference: 'CAB-2026-ROUTE', category: 'Vidéo', type: 'SDI',
  sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT1',
  destinationType: 'equipment', destinationId: 20, destinationPortId: 'IN1',
  status: 'Connecté', route: TRACE
});

const rechargerMagasin = () => {
  magasin = new Map();
  magasin.set('cables|CAB-ROUTE', cloner(normalizeCableRecord(CABLE)));
};

test('normalisation sans changement : le tracé revient IDENTIQUE', () => {
  const une = normalizeCableRecord(CABLE);
  const deux = normalizeCableRecord(une);
  assert.equal(sameCableRoute(une.route, deux.route), true);
  assert.equal(deux.route.segments.length, 3);
  assert.deepEqual(deux.route.segments[2].anchors, [{ role: 'destination', x: 700, y: 1600 }]);
});

test('aller-retour JSON — le transport réseau ne perd rien', () => {
  const transporte = JSON.parse(JSON.stringify(normalizeCableRecord(CABLE)));
  assert.equal(sameCableRoute(normalizeCableRecord(transporte).route, normalizeCableRoute(TRACE)), true);
});

test('SAUVEGARDE : le tracé est dans l\'export', async () => {
  rechargerMagasin();
  const service = new BackupService();
  const sauvegarde = await service.createBackup();
  const cable = sauvegarde.data.cables.find(item => item.id === 'CAB-ROUTE');
  assert.ok(cable, 'le câble doit être dans la sauvegarde');
  assert.equal(cable.route.segments.length, 3, 'les trois segments doivent être exportés');
  assert.equal(sameCableRoute(cable.route, normalizeCableRoute(TRACE)), true);
});

test('RESTAURATION : le tracé revient intact dans le magasin', async () => {
  rechargerMagasin();
  const service = new BackupService();
  const sauvegarde = await service.createBackup();
  magasin = new Map();                       // le magasin est vidé : rien ne peut « rester »
  await service.restoreBackup(sauvegarde);
  const restaure = magasin.get('cables|CAB-ROUTE');
  assert.ok(restaure, 'le câble doit être restauré');
  assert.equal(sameCableRoute(restaure.route, normalizeCableRoute(TRACE)), true,
    'un tracé perdu à la restauration est un relevé de terrain perdu');
  assert.equal(restaure.route.segments[1].sceneType, 'map');
  assert.equal(restaure.route.segments[2].sceneId, 'B-12');
});

test('la normalisation de sauvegarde copie l\'enregistrement ENTIER, pas une sélection de champs', () => {
  const service = new BackupService();
  const normalise = service.normalizeBackup({ data: { cables: [normalizeCableRecord(CABLE)] } });
  assert.equal(sameCableRoute(normalise.cables[0].route, normalizeCableRoute(TRACE)), true);
  // Une liste blanche de champs, ajoutée un jour « pour alléger », effacerait le tracé sans
  // qu'aucune autre épreuve ne tombe : c'est exactement le risque que cet arbitrage
  // acceptait, et voici l'épreuve qui le couvre.
  const source = readFileSync(new URL('../backup-service.js', import.meta.url), 'utf8');
  assert.match(source, /records\.map\(r=>\(\{\.\.\.r\}\)\)/,
    'la sauvegarde doit copier tout l\'enregistrement');
});

test('un câble SANS tracé traverse la sauvegarde sans en gagner un', async () => {
  magasin = new Map();
  magasin.set('cables|CAB-NU', cloner(normalizeCableRecord({ ...CABLE, id: 'CAB-NU', route: undefined })));
  const service = new BackupService();
  const sauvegarde = await service.createBackup();
  assert.equal(sauvegarde.data.cables.find(item => item.id === 'CAB-NU').route, null);
});
