import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTINUITY_KINDS, normalizeProtectionGroup, normalizeContinuityProcedure,
  validateContinuityRecord, applyContinuityApproval
} from '../continuity-contract.js';

const equipmentRef = (id, role) => ({ type:'equipment', id, role, verificationStatus:'verified' });

test('continuité: un service sans secours vérifié est explicite et non inventé', () => {
  const group = normalizeProtectionGroup({
    id:'pg-rf1', name:'RF1', serviceName:'Diffusion RF1', protectionType:'no-verified-backup', zoneIds:['rf'],
    primaryPath:{ label:'RF1 principal', entityRefs:[equipmentRef('mc1-p', 'PRIMARY')] },
    sourceRefs:['plan-rf1'], verificationStatus:'documented'
  });
  assert.equal(validateContinuityRecord(group).length, 0);
  assert.equal(group.backupPaths.length, 0);
});

test('continuité: un brassage manuel exige un point de bascule', () => {
  const group = normalizeProtectionGroup({
    id:'pg-rf1', name:'RF1', serviceName:'Diffusion RF1', protectionType:'manual-patch', zoneIds:['rf'],
    primaryPath:{ label:'Principal', entityRefs:[equipmentRef('p', 'PRIMARY')] },
    backupPaths:[{ label:'Secours', entityRefs:[equipmentRef('s', 'BACKUP')] }]
  });
  assert.ok(validateContinuityRecord(group).some(message => /point de bascule/i.test(message)));
});

test('continuité: une procédure validée sécurise, bascule et vérifie le direct', () => {
  const draft = normalizeContinuityProcedure({
    id:'proc-rf1', protectionGroupId:'pg-rf1', title:'Passage RF1 secours', authorId:'admin-1', zoneIds:['rf'],
    status:'draft', evidenceRefs:['plan-rf1'],
    steps:[
      { type:'secure', title:'Préparer', instruction:'Confirmer la disponibilité du secours.' },
      { type:'switch', title:'Basculer', instruction:'Exécuter la bascule validée.' },
      { type:'verify', title:'Vérifier', instruction:'Contrôler image, audio et monitoring.', expectedResult:'Programme stable.' }
    ]
  });
  const approved = applyContinuityApproval(draft, { id:'resp-2', role:'responsible' });
  assert.equal(approved.status, 'validated');
  assert.equal(validateContinuityRecord(approved).length, 0);
});

test('continuité: applique réellement le principe des quatre yeux', () => {
  const draft = normalizeContinuityProcedure({
    protectionGroupId:'pg', title:'Procédure', authorId:'same', zoneIds:['rf'],
    steps:[{ type:'switch', title:'Basculer', instruction:'Action.' }, { type:'verify', title:'Vérifier', instruction:'Contrôle.' }]
  });
  assert.throws(() => applyContinuityApproval(draft, { id:'same', role:'responsible' }), /quatre yeux/i);
});

test('continuité: la validation vérifie explicitement les chemins Principal et Secours', () => {
  const draft = normalizeProtectionGroup({
    id:'pg-verified', name:'RF1', serviceName:'Diffusion RF1', authorId:'admin-1', zoneIds:['rf1'],
    protectionType:'dedicated-device', sourceRefs:['plan-rf1'],
    primaryPath:{ label:'Principal', entityRefs:[equipmentRef('p', 'PRIMARY')] },
    backupPaths:[{ label:'Secours', availability:'available', entityRefs:[equipmentRef('s', 'BACKUP')] }]
  });
  const approved = applyContinuityApproval(draft, { id:'resp-2', role:'responsible' });
  assert.equal(approved.primaryPath.verificationStatus, 'verified');
  assert.equal(approved.backupPaths[0].verificationStatus, 'verified');
  assert.equal(validateContinuityRecord(approved).length, 0);
});

test('continuité: une révision reste liée à sa version validée sans auto-remplacement', () => {
  const record = normalizeProtectionGroup({
    id:'rf1-r2', supersedesId:'rf1-r1', revision:'2', name:'RF1 P/S', serviceName:'RF1',
    zoneIds:['rf1'], protectionType:'no-verified-backup',
    primaryPath:{ label:'Principal', entityRefs:[{ type:'equipment', id:'rf1-p' }] }
  });
  assert.equal(record.supersedesId, 'rf1-r1');
  assert.equal(record.revision, '2');
  assert.ok(!validateContinuityRecord(record).some(message => /remplacer lui-même/i.test(message)));
  assert.ok(validateContinuityRecord({ ...record, supersedesId:record.id }).some(message => /remplacer lui-même/i.test(message)));
});

test('continuité: un test conserve groupe, procédure, auteur et date', () => {
  const record = {
    kind:CONTINUITY_KINDS.TEST, protectionGroupId:'pg', procedureId:'proc',
    performedAt:'2026-08-14T10:00:00Z', performedBy:'tech-1', result:'passed', observations:'Image et audio conformes.', zoneIds:['rf']
  };
  assert.equal(validateContinuityRecord(record).length, 0);
  assert.ok(validateContinuityRecord({ ...record, result:'inventé' }).some(message => /résultat.*invalide/i.test(message)));
});
