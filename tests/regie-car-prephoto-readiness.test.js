import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REGIE_CAR_PREPHOTO_POLICY,
  summarizeRegieCarPrephotoReadiness,
  buildRegieCarCaptureTargets
} from '../regie-car-prephoto-readiness.js';
/*
 * LE RELEVÉ SE LIT DEPUIS LE DOSSIER PRIVÉ (A-5) — voir l'épreuve de la phase 16.
 * Les cibles de collecte ne sont plus une constante de module : elles se construisent à
 * partir du jeu de données autorisé, précisément pour qu'un poste sans session ne puisse
 * plus les matérialiser en important le fichier.
 */
const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
const jeu = buildRegieCarDataset();
const REGIE_CAR_EQUIPMENT = jeu.equipment;
const REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT = jeu.additionalEquipment;
const REGIE_CAR_MANUFACTURER_SOURCE_PATCHES = jeu.manufacturerSourcePatches;
const REGIE_CAR_CAPTURE_TARGETS = buildRegieCarCaptureTargets(jeu);
// Les lacunes ont rejoint le jeu protégé : elles décrivent l'état de CETTE installation,
// pas une politique générique de collecte.
const REGIE_CAR_PREPHOTO_GAPS = jeu.prephotoGaps;

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('regie-car-prephoto-readiness.js');
const bridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

test('Phase 17: la préparation avant nouvelles photos reste strictement additive', () => {
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.additiveOnly,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.preserveExistingPlatformData,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.protectAdminAndManualOverrides,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticPortCreation,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticCableCreation,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticTopologyCreation,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticCrosspointCreation,true);
  assert.doesNotMatch(source,/\.clear\s*\(/);
  assert.doesNotMatch(source,/replaceOperational\s*:\s*true/);
  assert.doesNotMatch(source,/db\.save\(['"]cables['"]/);
  assert.doesNotMatch(source,/kind\s*:\s*['"]topology_crosspoint['"]/i);
});

test('Phase 17: les deux observations visibles oubliées de la vue 09 sont ajoutées sans modèle inventé', () => {
  assert.equal(REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT.length,2);
  const ids = new Set(REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT.map(item => item.id));
  assert.ok(ids.has('regie-car-observed-hd4x1-router'));
  assert.ok(ids.has('regie-car-observed-sw3-r100'));
  for (const item of REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT) {
    assert.equal(item.exactModelConfirmed,false);
    assert.equal(item.requiresFieldConfirmation,true);
    assert.deepEqual(item.fieldEvidenceRefs,['regiecar-2026-08-16:09']);
    assert.equal(item.baieId,null);
  }
  assert.equal(REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT.find(item => item.id === 'regie-car-observed-sw3-r100').operationalLabel,'SW3.R100');
});

test('Phase 17: les sources constructeur ajoutées restent des domaines officiels et ne prouvent jamais le câblage local', () => {
  const allowedHosts = new Set(['www.tek.com','www.wohler.com','www.telikou.com','www.riedel.net']);
  assert.ok(REGIE_CAR_MANUFACTURER_SOURCE_PATCHES.length >= 7);
  for (const patch of REGIE_CAR_MANUFACTURER_SOURCE_PATCHES) {
    for (const url of [patch.documentationUrl,...(patch.manufacturerResearchSources || [])].filter(Boolean)) {
      const parsed = new URL(url);
      assert.equal(parsed.protocol,'https:');
      assert.ok(allowedHosts.has(parsed.hostname),`domaine constructeur inattendu: ${parsed.hostname}`);
    }
    assert.ok(String(patch.researchNote || '').trim().length > 20,`note documentaire insuffisante: ${patch.id}`);
  }
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticPortCreation,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticCableCreation,true);
  assert.equal(REGIE_CAR_PREPHOTO_POLICY.noAutomaticTopologyCreation,true);
});

test('Phase 17: le plan de capture couvre les 51 instances connues sans transformer une attente en preuve', () => {
  // Le résumé prend le jeu de données autorisé : sans lui il rend des zéros, et c'est
  // précisément le comportement voulu pour une session sans habilitation.
  const readiness = summarizeRegieCarPrephotoReadiness(jeu);
  assert.equal(REGIE_CAR_EQUIPMENT.length,49);
  assert.equal(readiness.phase17AdditionalObservations,2);
  assert.equal(readiness.equipmentBlueprint,51);
  assert.equal(readiness.captureTargets,REGIE_CAR_CAPTURE_TARGETS.length);
  assert.ok(readiness.captureTargets >= 160);
  assert.ok(readiness.criticalTargets >= 35);
  assert.equal(readiness.safeToReceiveNewEvidence,true);
  assert.equal(readiness.binaryMediaStillRequired,true);
  assert.equal(new Set(REGIE_CAR_CAPTURE_TARGETS.map(item => item.id)).size,REGIE_CAR_CAPTURE_TARGETS.length);
  assert.ok(REGIE_CAR_CAPTURE_TARGETS.every(item => item.status === 'awaiting-photo' && item.evidenceRef === null && item.doesNotProveLiveSignal === true));
});

test('Phase 17: chaque équipement demande une étiquette et un arrière; les modèles incertains demandent aussi une façade', () => {
  const all = [...REGIE_CAR_EQUIPMENT,...REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT];
  for (const equipment of all) {
    const targets = REGIE_CAR_CAPTURE_TARGETS.filter(item => item.targetType === 'equipment' && item.targetId === equipment.id);
    assert.ok(targets.some(item => item.captureType === 'label-photo'),`label manquant: ${equipment.id}`);
    assert.ok(targets.some(item => item.captureType === 'rear-panel-photo'),`arrière manquant: ${equipment.id}`);
    if (equipment.exactModelConfirmed !== true) assert.ok(targets.some(item => item.captureType === 'front-panel-photo'),`façade manquante: ${equipment.id}`);
  }
  const patchTargets = REGIE_CAR_CAPTURE_TARGETS.filter(item => item.targetId === 'regie-car-patchfield-main');
  assert.ok(patchTargets.some(item => item.captureType === 'patch-panel-photo'));
  assert.ok(patchTargets.some(item => item.captureType === 'cable-trace-photo'));
});

test('Phase 17: les inconnues as-built restent explicites avant réception des prochains fichiers', () => {
  const ids = new Set(REGIE_CAR_PREPHOTO_GAPS.map(item => item.id));
  for (const id of ['exact-models','rack-position','rear-ports','cables','patch-normalization','live-routing','binary-media']) assert.ok(ids.has(id));
  /*
   * L'état des médias binaires a rejoint le jeu protégé (A-5, résiduel R3) : il dit que
   * CETTE unité attend encore ses fichiers source, ce qu'un poste sans habilitation n'a pas
   * à savoir. On vérifie donc qu'il vit là-bas, et plus dans les octets publics.
   */
  assert.equal(jeu.prephotoReadiness.binaryMediaStatus, 'awaiting-source-files');
  assert.ok(!source.includes("awaiting-source-files"),
    'le module public ne doit plus affirmer l’état des médias binaires');
  assert.match(source,/mergeCaptureTargets\(currentTargets,incomingTargets\)/);
  assert.match(source,/evidenceRef = clean\(current\.evidenceRef\) \|\| null/);
});

test('Phase 17: Fiche 360 et PWA chargent la préparation après Phase 16', () => {
  const phase16 = bridge.indexOf("import './regie-car-inventory-phase16.js'");
  const phase17 = bridge.indexOf("import './regie-car-prephoto-readiness.js'");
  assert.ok(phase16 >= 0 && phase17 > phase16);
  assert.match(source,/Régie Car — collecte terrain suivante/);
  assert.match(worker,/\/regie-car-inventory-phase16\.js/);
  assert.match(worker,/\/regie-car-prephoto-readiness\.js/);
});

test('#164 GREEN — fillMissing ne date plus avant comparaison, et ensureCapturePlan compare avant d’écrire', () => {
  const fillMissingBody = source.slice(source.indexOf('function fillMissing(existing,incoming)'), source.indexOf('const estIdentique'));
  assert.doesNotMatch(fillMissingBody, /next\.updatedAt\s*=\s*now\(\)/, 'fillMissing ne doit plus dater le résultat lui-même');
  /*
   * #98 — Cette ligne épinglait le TEXTE de la comparaison : `JSON.stringify(next) ===
   * JSON.stringify(existing)`. Or cette comparaison était elle-même le défaut. `existing`
   * revient du serveur rangé en `jsonb`, un format qui RÉORDONNE les clés ; `next` est
   * rebâti dans l'ordre des littéraux du module. Le plan de capture était donc réécrit à
   * chaque chargement, à contenu strictement inchangé.
   *
   * Ce qui doit être gardé n'a jamais été la mise en œuvre, mais les deux promesses : une
   * comparaison a lieu AVANT d'écrire, et elle regarde le contenu, pas sa mise en page.
   */
  assert.match(source, /const estIdentique = /, 'une comparaison doit exister avant toute écriture');
  assert.doesNotMatch(source, /const estIdentique = \(next,existing\) => JSON\.stringify\(/,
    'la comparaison ne doit plus dépendre de l’ordre des clés (#98)');
  assert.match(source, /recordsExactlyEqual/,
    'la comparaison doit passer par le contrat de contenu du dépôt (#171)');
  // ensureCapturePlan écrivait le plan à CHAQUE appel, sans comparaison : c'est la même
  // boucle que #164 mesure ailleurs sur ce module.
  const capturePlanBody = source.slice(source.indexOf('async function ensureCapturePlan'), source.indexOf('export async function ensureRegieCarPrephotoReadiness') === -1 ? source.length : source.indexOf('async function runEnsureRegieCarPrephotoReadiness'));
  assert.match(capturePlanBody, /if \(current && estIdentique\(next,current\)\) return \{record:current,protected:false\};/);
  assert.doesNotMatch(source, /if \(JSON\.stringify\(next\) !== JSON\.stringify\(current\)\)/);
});

test('#98 GREEN — ensureRegieCarPrephotoReadiness ne peut pas tourner deux fois en même temps', () => {
  assert.match(source, /let vol = null;/);
  assert.match(source, /export function ensureRegieCarPrephotoReadiness\(\)\s*\{\s*\n\s*if \(vol\) return vol;/);
  assert.match(source, /vol = runEnsureRegieCarPrephotoReadiness\(\)\.finally\(\(\) => \{ vol = null; \}\);/);
});
