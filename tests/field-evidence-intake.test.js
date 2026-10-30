import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FIELD_EVIDENCE_INTAKE_POLICY,
  MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST,
  redactFieldEvidenceText,
  validateFieldEvidenceBatch,
  validateFieldEvidenceItem
} from '../field-evidence-intake.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const intake = read('field-evidence-intake.js');
const intakeUi = read('field-evidence-intake-ui.js');
const hostBridge = read('equipment-360-host-bridge.js');
const worker = read('service-worker.js');

test('Phase 15: un lot unité de production mobile est accepté sans créer une Régie car fictive', () => {
  const result = validateFieldEvidenceBatch({
    sourceContext:'mobile-production-unit',
    sourceLabel:'Lot terrain futur',
    observedAt:'2026-08-16T12:00:00+01:00'
  });
  assert.equal(result.valid, true);
  assert.match(intake, /mobile-production-unit/);
  assert.doesNotMatch(intake, /id\s*:\s*['"]regie-car/i);
  assert.doesNotMatch(intake, /db\.save\(['"]equipments['"]/);
  assert.doesNotMatch(intake, /db\.save\(['"]rooms['"]/);
  assert.doesNotMatch(intake, /db\.save\(['"]baies['"]/);
});

test('Phase 15: la politique interdit toute promotion automatique vers inventaire/topologie/câbles/crosspoints', () => {
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.noAutomaticInventoryCreation, true);
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.noAutomaticCatalogPromotion, true);
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.noAutomaticTopologyCreation, true);
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.noAutomaticCableInference, true);
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.noAutomaticCrosspointInference, true);
  assert.equal(FIELD_EVIDENCE_INTAKE_POLICY.reviewRequiredBeforeConfirmedLink, true);
  assert.match(intake, /doesNotMutateTarget:true/);
  assert.match(intake, /domainIntegrationRequired:true/);
});

test('Phase 15: les données visibles sensibles sont masquées avant persistance', () => {
  const result = redactFieldEvidenceText('IP 10.20.30.40 password=secret token:abcd');
  assert.doesNotMatch(result.text, /10\.20\.30\.40|secret|abcd/);
  assert.match(result.text, /IP MASQUÉE/);
  assert.ok(result.redactions.includes('ipv4'));
  assert.ok(result.redactions.includes('credential'));
});

test('Phase 15: une preuve acceptée ne peut rester non revue ou ambiguë avec lien confirmé', () => {
  const common = {
    batchId:'field-batch-x', assetRef:'future-photo-001.webp', captureType:'field-photo',
    sourceContext:'mobile-production-unit', sourceLabel:'Source terrain', observedAt:'2026-08-16T12:00:00+01:00'
  };
  const unreviewed = validateFieldEvidenceItem({ ...common, reviewState:'accepted', classification:'unreviewed', linkState:'unlinked' });
  assert.equal(unreviewed.valid, false);
  const ambiguous = validateFieldEvidenceItem({ ...common, reviewState:'accepted', classification:'ambiguous', linkState:'confirmed' });
  assert.equal(ambiguous.valid, false);
  const reviewed = validateFieldEvidenceItem({ ...common, reviewState:'accepted', classification:'exact-device', linkState:'candidate' });
  assert.equal(reviewed.valid, true);
});

test('Phase 15: la checklist mobile couvre contexte, racks, labels, rear panels et câbles sans prétendre à un flux live', () => {
  assert.ok(MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST.length >= 8);
  const ids = new Set(MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST.map(item => item.id));
  for (const id of ['context-exterior','context-interior','rack-front','rack-rear','device-label','patching','cable-labels','signal-control']) assert.ok(ids.has(id));
  assert.ok(MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST.some(item => /aucune liaison n’est déduite/i.test(item.proves)));
  assert.ok(MOBILE_PRODUCTION_UNIT_CAPTURE_CHECKLIST.some(item => /pas de protocole ou flux live déduit/i.test(item.proves)));
});

test('Phase 15: Admin reçoit une Inbox terrain avec recherche, filtre et export manifeste', () => {
  for (const token of ['Preuves terrain — Inbox','field-evidence-search','field-evidence-filter','Export manifeste','2m-tech-field-evidence-manifest']) assert.ok(intake.includes(token), `élément intake manquant: ${token}`);
  assert.match(intakeUi, /Preuves terrain/);
  assert.match(intakeUi, /field-evidence-intake-modal/);
});

test('Phase 15: les modules intake sont chargés après la checklist as-built et disponibles offline', () => {
  const fieldVerification = hostBridge.indexOf("import './grille-centrale-field-verification.js'");
  const intakeImport = hostBridge.indexOf("import './field-evidence-intake.js'");
  const intakeUiImport = hostBridge.indexOf("import './field-evidence-intake-ui.js'");
  assert.ok(fieldVerification >= 0 && intakeImport > fieldVerification && intakeUiImport > intakeImport);
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.\d+'/);
  assert.match(worker, /\/field-evidence-intake\.js/);
  assert.match(worker, /\/field-evidence-intake-ui\.js/);
});
