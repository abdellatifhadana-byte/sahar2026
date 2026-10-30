import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REGIE_CAR_PHASE16_POLICY,
  decisionSyncEtablie,
  attendreDecisionSync
} from '../regie-car-inventory-phase16.js';
/*
 * LE RELEVÉ SE LIT DEPUIS LE DOSSIER PRIVÉ (A-5).
 *
 * Il ne vit plus dans le module public : celui-ci ne porte que la logique, et le serveur
 * refuse de servir `scripts/private-operational-data/`. Node, lui, y accède directement —
 * même convention que les épreuves de la Grille Centrale.
 */
const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
const jeu = buildRegieCarDataset();
const REGIE_CAR_FIELD_EVIDENCE = jeu.fieldEvidence;
const REGIE_CAR_CATALOG = jeu.catalog;
const REGIE_CAR_BAIES = jeu.baies;
const REGIE_CAR_EQUIPMENT = jeu.equipment;

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('regie-car-inventory-phase16.js');
const hostBridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

test('Phase 16: l’ajout Régie Car est strictement additif et ne réinitialise aucun store', () => {
  assert.equal(REGIE_CAR_PHASE16_POLICY.additiveOnly, true);
  assert.equal(REGIE_CAR_PHASE16_POLICY.clearsOperationalStores, false);
  assert.equal(REGIE_CAR_PHASE16_POLICY.replaceOperational, false);
  assert.equal(REGIE_CAR_PHASE16_POLICY.preserveExistingUserData, true);
  assert.equal(REGIE_CAR_PHASE16_POLICY.protectAdminLockedRecords, true);
  assert.equal(REGIE_CAR_PHASE16_POLICY.fillMissingFieldsOnlyOnExistingRecords, true);
  assert.doesNotMatch(source, /\.clear\s*\(/);
  assert.doesNotMatch(source, /replaceOperational\s*:\s*true/);
  assert.doesNotMatch(source, /importInventoryBundle\s*\(/);
  assert.doesNotMatch(source, /OPERATIONAL_RESET_STORES/);
});

test('Phase 16: la salle mobile et seulement les baies lisibles sont créées', () => {
  assert.match(source, /REGIE_CAR_ROOM_ID = 'room-regie-car'/);
  assert.match(source, /roomType:'mobile-production-unit'/);
  assert.deepEqual(REGIE_CAR_BAIES.map(item => item.name), ['BAIE 1','BAIE 2','BAIE 9','BAIE 10','BAIE 11','BAIE 12']);
  assert.equal(REGIE_CAR_BAIES.length, 6);
  assert.ok(!REGIE_CAR_BAIES.some(item => ['BAIE 3','BAIE 4','BAIE 5','BAIE 6','BAIE 7','BAIE 8'].includes(item.name)));
});

test('Phase 16: les 18 photos sont cataloguées comme preuves séparées des images officielles', () => {
  assert.equal(REGIE_CAR_FIELD_EVIDENCE.length, 18);
  assert.equal(new Set(REGIE_CAR_FIELD_EVIDENCE.map(item => item.id)).size, 18);
  for (let index=1; index<=18; index+=1) assert.ok(REGIE_CAR_FIELD_EVIDENCE.some(item => item.id === `regiecar-2026-08-16:${String(index).padStart(2,'0')}`));
  assert.ok(REGIE_CAR_FIELD_EVIDENCE.every(item => /binary-pwa-pack-pending/.test(item.mediaStatus)));
  assert.equal(REGIE_CAR_PHASE16_POLICY.fieldEvidenceSeparateFromOfficialImages, true);
  assert.doesNotMatch(source, /equipment\.images\s*=/);
  assert.doesNotMatch(source, /officialImage\s*[:=]/);
});

test('Phase 16: le catalogue ajoute uniquement les modèles lisibles ou une famille explicitement incertaine', () => {
  assert.equal(REGIE_CAR_CATALOG.length, 14);
  const ids = new Set(REGIE_CAR_CATALOG.map(item => item.id));
  for (const id of ['kb-sony-hscu-300','kb-sony-rcp-1500','kb-sony-msu-1000','kb-tektronix-tg8000','kb-tektronix-eco422d','kb-tektronix-wfm7100','kb-wohler-rm2443w-hd','kb-wohler-rm3357-hd','kb-wohler-amp1a-lp10s','kb-evs-nano-lsm-remote','kb-harris-panacea-32x8-cop','kb-telikou-fm804','kb-harris-legacy-control-panel','kb-regiecar-patchfield-family']) assert.ok(ids.has(id), `catalogue manquant: ${id}`);
  assert.equal(REGIE_CAR_CATALOG.find(item => item.id === 'kb-harris-legacy-control-panel').verificationStatus, 'verified-family');
  assert.equal(REGIE_CAR_CATALOG.find(item => item.id === 'kb-regiecar-patchfield-family').verificationStatus, 'to-confirm');
  assert.match(source, /exactModelRequiresReadableFieldMarking:true/);
  assert.match(source, /familyOnlyWhenExactModelUnreadable:true/);
});

test('Phase 16: 49 instances sont ajoutées avec les comptes terrain prudents', () => {
  assert.equal(REGIE_CAR_EQUIPMENT.length, 49);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-sony-hscu-300').length, 4);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-sony-rcp-1500').length, 5);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-tektronix-tg8000').length, 2);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-sony-vtr').length, 12);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.provisionalInstance === true).length, 12);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-riedel-artist').length, 3);
  assert.equal(REGIE_CAR_EQUIPMENT.filter(item => item.catalogId === 'kb-wohler-amp1a-lp10s').length, 2);
});

test('Phase 16: les modèles exacts visibles sont promus sans inventer l’arrière ou les options', () => {
  for (const model of ['HSCU-300','RCP-1500','MSU-1000','TG8000','ECO422D','WFM 7100','RM-2443W-HD','RM-3357-HD','AMP1A-LP10S','FM-804']) {
    assert.ok(REGIE_CAR_EQUIPMENT.some(item => item.modele === model && item.exactModelConfirmed === true), `modèle terrain exact manquant: ${model}`);
  }
  assert.equal(REGIE_CAR_PHASE16_POLICY.noAutomaticRearPortMapping, true);
  assert.equal(REGIE_CAR_PHASE16_POLICY.noAutomaticCableInference, true);
  assert.equal(REGIE_CAR_PHASE16_POLICY.noAutomaticCrosspointInference, true);
  assert.doesNotMatch(source, /kind\s*:\s*['"]topology_crosspoint['"]/i);
  assert.doesNotMatch(source, /db\.save\(['"]cables['"]/);
});

test('Phase 16: les éléments ambigus restent explicitement à confirmer', () => {
  const unknowns = REGIE_CAR_EQUIPMENT.filter(item => item.requiresFieldConfirmation === true);
  assert.ok(unknowns.length >= 6);
  assert.ok(unknowns.every(item => item.exactModelConfirmed === false));
  assert.ok(REGIE_CAR_EQUIPMENT.some(item => item.id === 'regie-car-b12-sony-control' && item.exactModelConfirmed === false));
  assert.ok(REGIE_CAR_EQUIPMENT.some(item => item.id === 'regie-car-patchfield-main' && item.entityKind === 'patch-panel'));
});

test('Phase 16: les données Admin/manual existantes restent prioritaires', () => {
  assert.match(source, /origin\.startsWith\('admin'\)/);
  assert.match(source, /record\?\.manualOverride === true/);
  assert.match(source, /function fillMissing\(existing,incoming\)/);
  assert.match(source, /if \(missing\) next\[key\] = value/);
  assert.doesNotMatch(source, /Object\.assign\(existing,incoming\)/);
});

test('Phase 16: le module est chargé après l’Intake et disponible hors ligne', () => {
  const intake = hostBridge.indexOf("import './field-evidence-intake-ui.js'");
  const regie = hostBridge.indexOf("import './regie-car-inventory-phase16.js'");
  assert.ok(intake >= 0 && regie > intake);
  const cacheVersion = worker.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cacheVersion, 'version du cache PWA introuvable');
  assert.ok(Number(cacheVersion[1]) >= 28, `la Phase 16 exige un cache PWA v5.28 minimum, reçu v5.${cacheVersion[1]}`);
  assert.match(worker, /\/regie-car-inventory-phase16\.js/);
});

test('#164 GREEN — fillMissing ne date plus avant comparaison, et chaque appelant compare avant d’écrire', () => {
  // Le défaut mesuré : `next.updatedAt = now()` posé DANS fillMissing, avant que
  // l’appelant compare `next` à `existing` — la comparaison était donc toujours fausse
  // (différente), et chaque appel réécrivait sans qu’aucune donnée métier n’ait changé.
  const fillMissingBody = source.slice(source.indexOf('function fillMissing(existing,incoming)'), source.indexOf('const estIdentique'));
  assert.doesNotMatch(fillMissingBody, /next\.updatedAt\s*=\s*now\(\)/, 'fillMissing ne doit plus dater le résultat lui-même');
  assert.match(source, /const estIdentique = \(next,existing\) => JSON\.stringify\(next\) === JSON\.stringify\(existing\)/);
  // Les cinq écritures de l’ensemencement (catalogue, lot de preuves + preuves, salle,
  // baies, équipements) comparent avant de dater et persister — jamais l’inverse.
  const comparisons = source.match(/estIdentique\(next,\s*(existing|current)\)/g) || [];
  assert.ok(comparisons.length >= 5, `attendu au moins 5 comparaisons estIdentique, trouvé ${comparisons.length}`);
  assert.doesNotMatch(source, /if \(JSON\.stringify\(next\) !== JSON\.stringify\(existing\)\)/);
  assert.doesNotMatch(source, /if \(JSON\.stringify\(next\) !== JSON\.stringify\(current\)\)/);
});

test('#98 GREEN — ensureRegieCarPhase16 ne peut pas tourner deux fois en même temps', () => {
  // Deux points d’entrée appellent ce module au chargement : sa propre IIFE, et
  // `regie-car-prephoto-readiness.js` qui rappelle `ensureRegieCarPhase16()`. Sans garde,
  // les deux traversaient Room→Baies→Équipements en parallèle, chacune fondée sur une
  // lecture que l’autre était en train de périmer — la source du 400/409 automatiques.
  assert.match(source, /let vol = null;/);
  assert.match(source, /export function ensureRegieCarPhase16\(\)\s*\{\s*\n\s*if \(vol\) return vol;/);
  assert.match(source, /vol = runEnsureRegieCarPhase16\(\)\.finally\(\(\) => \{ vol = null; \}\);/);
  assert.match(source, /async function runEnsureRegieCarPhase16\(\)/);
});

test('#162 GREEN — l’ensemencement écrit la salle, puis les baies, puis les équipements, dans cet ordre', () => {
  const body = source.slice(source.indexOf('async function runEnsureRegieCarPhase16'), source.indexOf('let vol = null;'));
  const posRoom = body.indexOf('await ensureRoom()');
  const posBaies = body.indexOf('await ensureBaies(');
  const posEquip = body.indexOf('await ensureEquipments(');
  assert.ok(posRoom >= 0 && posBaies > posRoom && posEquip > posBaies,
    `ordre attendu Room < Baies < Équipements, obtenu ${posRoom}/${posBaies}/${posEquip}`);
  // Chaque étape attend explicitement la précédente : `ensureBaies(room.id)` consomme le
  // résultat RÉSOLU de `ensureRoom()`, pas une promesse encore en vol.
  assert.match(body, /const room = await ensureRoom\(\);\s*\n\s*const baies = await ensureBaies\(room\.id\);\s*\n\s*const equipments = await ensureEquipments\(room\.id,baies\);/);
});

test('#162 GREEN — decisionSyncEtablie ne confond plus un signal de file avec la bascule elle-même', () => {
  // Signaux de FILE — posés par db.save()/db.delete() ou un rejeu, sans rapport avec la
  // bascule — ne prouvent RIEN tant qu'aucun instantané n'a été appliqué.
  assert.equal(decisionSyncEtablie({ state:'offline' }), false);
  assert.equal(decisionSyncEtablie({ state:'warning' }), false);
  assert.equal(decisionSyncEtablie({ state:'conflict' }), false);
  assert.equal(decisionSyncEtablie({ state:'syncing' }), false);
  assert.equal(decisionSyncEtablie({}), false);
  // Un instantané RÉELLEMENT appliqué porte `updatedAt`, quel que soit l'état qui
  // l'accompagne (synced, warning avec rejets isolés, offline avec file résiduelle).
  assert.equal(decisionSyncEtablie({ state:'synced', updatedAt:'2026-01-01T00:00:00Z' }), true);
  assert.equal(decisionSyncEtablie({ state:'warning', updatedAt:'2026-01-01T00:00:00Z' }), true);
  assert.equal(decisionSyncEtablie({ state:'offline', updatedAt:'2026-01-01T00:00:00Z' }), true);
  // Un échec TERMINAL de la tentative centrale elle-même, avant tout instantané.
  assert.equal(decisionSyncEtablie({ state:'local' }), true);
  assert.equal(decisionSyncEtablie({ state:'unauthenticated' }), true);
});

test('#162 GREEN — attendreDecisionSync reste bloqué sur un signal de file, se libère sur un instantané réel', async () => {
  const { db } = await import('../db.js');
  const original = db.isCentralSyncReady;
  db.isCentralSyncReady = () => false;
  globalThis.window = new EventTarget();
  try {
    let reglee = false;
    const attente = attendreDecisionSync().then(() => { reglee = true; });

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'offline' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reglee, false, 'un `offline` sans updatedAt ne doit PAS libérer le seed');

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'warning' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reglee, false, 'un `warning` sans updatedAt ne doit PAS libérer le seed');

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'conflict' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reglee, false, 'un `conflict` sans updatedAt ne doit PAS libérer le seed');

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'synced', updatedAt:'2026-01-01T00:00:00Z' } }));
    await attente;
    assert.equal(reglee, true, 'un `synced` avec updatedAt DOIT libérer le seed');
  } finally {
    db.isCentralSyncReady = original;
    delete globalThis.window;
  }
});

test('#162 GREEN — attendreDecisionSync se libère aussi sur offline/warning porteurs d’updatedAt, et sur un échec terminal', async () => {
  const { db } = await import('../db.js');
  const original = db.isCentralSyncReady;
  db.isCentralSyncReady = () => false;

  globalThis.window = new EventTarget();
  try {
    const p1 = attendreDecisionSync();
    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'offline', updatedAt:'2026-01-01T00:00:00Z' } }));
    await p1; // ne doit pas rester en attente
  } finally { delete globalThis.window; }

  globalThis.window = new EventTarget();
  try {
    const p2 = attendreDecisionSync();
    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'warning', updatedAt:'2026-01-01T00:00:00Z' } }));
    await p2;
  } finally { delete globalThis.window; }

  globalThis.window = new EventTarget();
  try {
    const p3 = attendreDecisionSync();
    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'unauthenticated' } }));
    await p3; // échec terminal AVANT tout instantané : ne doit pas bloquer indéfiniment
  } finally {
    db.isCentralSyncReady = original;
    delete globalThis.window;
  }
});

test('#162 GREEN — attendreDecisionSync ne pose aucune attente si la bascule est déjà tranchée', async () => {
  const { db } = await import('../db.js');
  const original = db.isCentralSyncReady;
  db.isCentralSyncReady = () => true;
  globalThis.window = new EventTarget();
  try {
    let reglee = false;
    attendreDecisionSync().then(() => { reglee = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(reglee, true, 'db.isCentralSyncReady() déjà vrai doit libérer immédiatement, sans attendre un événement');
  } finally {
    db.isCentralSyncReady = original;
    delete globalThis.window;
  }
});

test('#162 GREEN — le filet de sécurité reste au-dessus du délai réseau de central-sync.js (25 s)', () => {
  const centralSync = read('central-sync.js');
  const timeoutMatch = centralSync.match(/const REQUEST_TIMEOUT_MS = (\d+);/);
  assert.ok(timeoutMatch, 'REQUEST_TIMEOUT_MS introuvable dans central-sync.js');
  const requestTimeoutMs = Number(timeoutMatch[1]);
  const filetMatch = source.match(/setTimeout\(regler, (\d+)\);/);
  assert.ok(filetMatch, 'filet de sécurité introuvable dans attendreDecisionSync');
  const filetMs = Number(filetMatch[1]);
  assert.ok(filetMs > requestTimeoutMs,
    `le filet (${filetMs} ms) doit rester AU-DESSUS du délai réseau (${requestTimeoutMs} ms), sinon il peut libérer le seed pendant qu'une requête est encore en vol`);
});
