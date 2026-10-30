const TEXT_LIMIT = 2000;
const MAX_STEPS = 80;
const MAX_PATHS = 12;

export const CONTINUITY_KINDS = Object.freeze({
  PROTECTION_GROUP: 'continuity_protection_group',
  PROCEDURE: 'continuity_procedure',
  TEST: 'continuity_test'
});
export const CONTINUITY_KIND_SET = new Set(Object.values(CONTINUITY_KINDS));
export const CONTINUITY_STATUSES = Object.freeze(['draft', 'documented', 'validated', 'suspended', 'retired']);
export const PROTECTION_TYPES = Object.freeze([
  'dedicated-device', 'alternate-path', 'secondary-source', 'manual-patch',
  'automatic-failover', 'cold-spare', 'shared-backup', 'no-verified-backup'
]);
export const AVAILABILITY_STATES = Object.freeze(['available', 'degraded', 'unavailable', 'unknown', 'not-tested']);
export const PROCEDURE_STEP_TYPES = Object.freeze(['prepare', 'secure', 'switch', 'verify', 'fallback', 'rollback', 'escalate', 'note']);
export const ENTITY_REFERENCE_TYPES = Object.freeze([
  'equipment', 'component', 'port', 'screen', 'wall', 'room', 'baie',
  'cable', 'signal-path', 'router', 'router-port', 'router-interface', 'patch-point', 'service'
]);
export const CONTINUITY_CRITICALITIES = Object.freeze(['low', 'normal', 'high', 'on-air-critical']);
export const CONTINUITY_VERIFICATION_STATUSES = Object.freeze(['verified', 'documented', 'observed', 'to-confirm', 'draft']);

const clean = (value, max = TEXT_LIMIT) => String(value ?? '').trim().slice(0, max);
const unique = values => [...new Set((Array.isArray(values) ? values : []).filter(value => value !== null && value !== undefined && value !== '').map(String))];
const now = () => new Date().toISOString();

function normalizeVerification(value) {
  return value == null || value === '' ? 'to-confirm' : String(value);
}

function normalizeStatus(value) {
  return value == null || value === '' ? 'draft' : String(value);
}

export function normalizeEntityReference(source = {}) {
  const type = source.type == null || source.type === '' ? 'equipment' : String(source.type);
  return {
    type,
    id:source.id ?? source.entityId ?? null,
    parentEquipmentId:source.parentEquipmentId ?? null,
    portId:source.portId ?? null,
    label:clean(source.label, 240),
    role:clean(source.role, 80).toUpperCase(),
    verificationStatus:normalizeVerification(source.verificationStatus),
    sourceRef:clean(source.sourceRef, 500)
  };
}

export function normalizeRouteDefinition(source = {}, index = 0) {
  return {
    id:source.id || `route-${index + 1}`,
    label:clean(source.label || `Chemin ${index + 1}`, 240),
    signalPathId:source.signalPathId ?? null,
    entityRefs:(Array.isArray(source.entityRefs) ? source.entityRefs : []).map(normalizeEntityReference),
    dependencyRefs:(Array.isArray(source.dependencyRefs) ? source.dependencyRefs : []).map(normalizeEntityReference),
    availability:source.availability == null || source.availability === '' ? 'unknown' : String(source.availability),
    pathRole:clean(source.pathRole || (index ? 'BACKUP' : 'PROGRAM'), 30).toUpperCase(),
    verificationStatus:normalizeVerification(source.verificationStatus),
    lastTestAt:clean(source.lastTestAt, 40),
    notes:clean(source.notes)
  };
}

export function normalizeProcedureStep(source = {}, index = 0) {
  return {
    id:source.id || `step-${index + 1}`,
    order:index + 1,
    type:source.type == null || source.type === '' ? 'note' : String(source.type),
    title:clean(source.title, 240),
    instruction:clean(source.instruction),
    expectedResult:clean(source.expectedResult),
    warning:clean(source.warning, 1000),
    entityRefs:(Array.isArray(source.entityRefs) ? source.entityRefs : []).map(normalizeEntityReference),
    requiresConfirmation:source.requiresConfirmation !== false,
    estimatedSeconds:Number.isFinite(Number(source.estimatedSeconds)) ? Math.max(0, Math.min(3600, Number(source.estimatedSeconds))) : null,
    verificationStatus:normalizeVerification(source.verificationStatus)
  };
}

function baseRecord(kind, source = {}, current = null) {
  const timestamp = now();
  const id = source.id || current?.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...current,
    ...source,
    id,
    kind,
    targetType:'broadcast_continuity',
    targetId:id,
    status:normalizeStatus(source.status ?? current?.status),
    zoneIds:unique(source.zoneIds ?? current?.zoneIds),
    authorId:source.authorId ?? current?.authorId ?? null,
    createdAt:current?.createdAt || source.createdAt || timestamp,
    updatedAt:timestamp,
    validation:source.validation ?? current?.validation ?? null
  };
}

export function normalizeProtectionGroup(source = {}, current = null) {
  const base = baseRecord(CONTINUITY_KINDS.PROTECTION_GROUP, source, current);
  const protectionType = source.protectionType == null || source.protectionType === '' ? 'no-verified-backup' : String(source.protectionType);
  return {
    ...base,
    name:clean(source.name ?? current?.name, 240),
    revision:clean(source.revision ?? current?.revision ?? '1', 40),
    supersedesId:source.supersedesId ?? current?.supersedesId ?? null,
    serviceName:clean(source.serviceName ?? current?.serviceName, 240),
    description:clean(source.description ?? current?.description),
    criticality:source.criticality == null || source.criticality === '' ? 'normal' : String(source.criticality),
    protectionType,
    primaryPath:normalizeRouteDefinition(source.primaryPath ?? current?.primaryPath ?? {}, 0),
    backupPaths:(Array.isArray(source.backupPaths ?? current?.backupPaths) ? (source.backupPaths ?? current?.backupPaths) : []).slice(0, MAX_PATHS).map((path, index) => normalizeRouteDefinition(path, index + 1)),
    switchoverPoint:source.switchoverPoint ? normalizeEntityReference(source.switchoverPoint) : (current?.switchoverPoint ? normalizeEntityReference(current.switchoverPoint) : null),
    commonDependencyRefs:(Array.isArray(source.commonDependencyRefs ?? current?.commonDependencyRefs) ? (source.commonDependencyRefs ?? current?.commonDependencyRefs) : []).map(normalizeEntityReference),
    procedureIds:unique(source.procedureIds ?? current?.procedureIds),
    responsibleUserIds:unique(source.responsibleUserIds ?? current?.responsibleUserIds),
    verificationStatus:normalizeVerification(source.verificationStatus ?? current?.verificationStatus),
    sourceRefs:unique(source.sourceRefs ?? current?.sourceRefs),
    notes:clean(source.notes ?? current?.notes)
  };
}

export function normalizeContinuityProcedure(source = {}, current = null) {
  const base = baseRecord(CONTINUITY_KINDS.PROCEDURE, source, current);
  return {
    ...base,
    protectionGroupId:source.protectionGroupId ?? current?.protectionGroupId ?? null,
    supersedesId:source.supersedesId ?? current?.supersedesId ?? null,
    title:clean(source.title ?? current?.title, 240),
    purpose:clean(source.purpose ?? current?.purpose),
    revision:clean(source.revision ?? current?.revision ?? '1', 40),
    prerequisites:(Array.isArray(source.prerequisites ?? current?.prerequisites) ? (source.prerequisites ?? current?.prerequisites) : []).slice(0, 40).map(value => clean(value, 500)).filter(Boolean),
    steps:(Array.isArray(source.steps ?? current?.steps) ? (source.steps ?? current?.steps) : []).slice(0, MAX_STEPS).map(normalizeProcedureStep),
    verificationChecks:(Array.isArray(source.verificationChecks ?? current?.verificationChecks) ? (source.verificationChecks ?? current?.verificationChecks) : []).slice(0, 40).map(value => clean(value, 500)).filter(Boolean),
    fallbackSummary:clean(source.fallbackSummary ?? current?.fallbackSummary),
    rollbackSummary:clean(source.rollbackSummary ?? current?.rollbackSummary),
    escalation:clean(source.escalation ?? current?.escalation),
    estimatedSeconds:Number.isFinite(Number(source.estimatedSeconds ?? current?.estimatedSeconds)) ? Math.max(0, Math.min(14400, Number(source.estimatedSeconds ?? current?.estimatedSeconds))) : null,
    evidenceRefs:unique(source.evidenceRefs ?? current?.evidenceRefs),
    verificationStatus:normalizeVerification(source.verificationStatus ?? current?.verificationStatus),
    notes:clean(source.notes ?? current?.notes)
  };
}

export function normalizeContinuityTest(source = {}, current = null) {
  const base = baseRecord(CONTINUITY_KINDS.TEST, source, current);
  return {
    ...base,
    protectionGroupId:source.protectionGroupId ?? current?.protectionGroupId ?? null,
    procedureId:source.procedureId ?? current?.procedureId ?? null,
    performedAt:clean(source.performedAt ?? current?.performedAt, 40),
    performedBy:source.performedBy ?? current?.performedBy ?? null,
    result:source.result == null || source.result === '' ? 'partial' : String(source.result),
    observations:clean(source.observations),
    measuredSwitchSeconds:Number.isFinite(Number(source.measuredSwitchSeconds)) ? Math.max(0, Number(source.measuredSwitchSeconds)) : null,
    restoredPrimary:source.restoredPrimary === true,
    evidenceRefs:unique(source.evidenceRefs),
    immutable:source.immutable !== false
  };
}

export function normalizeContinuityRecord(kind, source = {}, current = null) {
  if (kind === CONTINUITY_KINDS.PROTECTION_GROUP) return normalizeProtectionGroup(source, current);
  if (kind === CONTINUITY_KINDS.PROCEDURE) return normalizeContinuityProcedure(source, current);
  if (kind === CONTINUITY_KINDS.TEST) return normalizeContinuityTest(source, current);
  return source;
}

function validateEntityReferences(references, label) {
  const errors = [];
  for (const reference of references || []) {
    if (!ENTITY_REFERENCE_TYPES.includes(reference.type) || reference.id == null || reference.id === '') errors.push(`${label}: une référence d'entité est incomplète.`);
    if (reference.type === 'component' && !reference.parentEquipmentId) errors.push(`${label}: le composant ${reference.label || reference.id} doit indiquer son équipement parent.`);
    if (!CONTINUITY_VERIFICATION_STATUSES.includes(reference.verificationStatus)) errors.push(`${label}: état de vérification inconnu pour ${reference.label || reference.id}.`);
  }
  return errors;
}

function validateRoute(route, label) {
  const errors = [];
  if (!route?.label) errors.push(`${label}: le chemin doit avoir un libellé.`);
  if (!route?.signalPathId && !route?.entityRefs?.length) errors.push(`${label}: documentez un Signal Path ou au moins une entité du chemin.`);
  if (!CONTINUITY_VERIFICATION_STATUSES.includes(route?.verificationStatus)) errors.push(`${label}: état de vérification invalide.`);
  errors.push(...validateEntityReferences(route?.entityRefs, label));
  errors.push(...validateEntityReferences(route?.dependencyRefs, `${label} / dépendances`));
  return errors;
}

export function validateContinuityRecord(record = {}) {
  const errors = [];
  if (!CONTINUITY_KIND_SET.has(record.kind)) return ['Type de continuité inconnu.'];
  const normalized = normalizeContinuityRecord(record.kind, record);
  if (!normalized.zoneIds.length) errors.push('La donnée de continuité doit être rattachée à au moins une zone.');
  if (!CONTINUITY_STATUSES.includes(normalized.status)) errors.push('Statut de continuité invalide.');

  if (record.kind === CONTINUITY_KINDS.PROTECTION_GROUP) {
    if (!normalized.name) errors.push('Le groupe de protection doit avoir un nom.');
    if (!normalized.serviceName) errors.push('Le service protégé est obligatoire.');
    if (normalized.supersedesId != null && String(normalized.supersedesId) === String(normalized.id)) errors.push('Un groupe ne peut pas se remplacer lui-même.');
    if (!PROTECTION_TYPES.includes(normalized.protectionType)) errors.push('Type de protection inconnu.');
    if (!CONTINUITY_CRITICALITIES.includes(normalized.criticality)) errors.push('Criticité de continuité invalide.');
    if (!CONTINUITY_VERIFICATION_STATUSES.includes(normalized.verificationStatus)) errors.push('État de vérification du groupe invalide.');
    errors.push(...validateRoute(normalized.primaryPath, 'Chemin principal'));
    if (normalized.protectionType !== 'no-verified-backup' && !normalized.backupPaths.length) errors.push('Au moins un chemin de secours est obligatoire pour ce type de protection.');
    normalized.backupPaths.forEach((path, index) => errors.push(...validateRoute(path, `Chemin secours ${index + 1}`)));
    for (const path of [normalized.primaryPath, ...normalized.backupPaths]) if (!AVAILABILITY_STATES.includes(path.availability)) errors.push(`État de disponibilité invalide pour ${path.label || path.id}.`);
    if (normalized.protectionType === 'manual-patch' && !normalized.switchoverPoint) errors.push('Le point de bascule/brassage est obligatoire pour un secours manuel.');
    if (normalized.status === 'validated') {
      if (normalized.verificationStatus !== 'verified') errors.push('Un groupe validé doit être marqué vérifié.');
      if (normalized.primaryPath.verificationStatus !== 'verified' || normalized.backupPaths.some(path => path.verificationStatus !== 'verified')) errors.push('Tous les chemins d’un groupe validé doivent avoir été vérifiés par le validateur.');
      const routeReferences = [normalized.primaryPath, ...normalized.backupPaths].flatMap(path => [...(path.entityRefs || []), ...(path.dependencyRefs || [])]);
      if (routeReferences.some(reference => reference.verificationStatus !== 'verified')) errors.push('Toutes les entités des chemins validés doivent avoir été vérifiées par le validateur.');
      if (!normalized.sourceRefs.length) errors.push('Un groupe validé doit conserver au moins une preuve ou référence source.');
      if (!normalized.validation?.validatedBy || !normalized.validation?.validatedAt) errors.push('La validation du groupe doit être attribuée et datée.');
    }
  }

  if (record.kind === CONTINUITY_KINDS.PROCEDURE) {
    if (!normalized.protectionGroupId) errors.push('La procédure doit référencer un groupe de protection.');
    if (!normalized.title) errors.push('Le titre de la procédure est obligatoire.');
    if (normalized.supersedesId != null && String(normalized.supersedesId) === String(normalized.id)) errors.push('Une procédure ne peut pas se remplacer elle-même.');
    if (!normalized.steps.length) errors.push('La procédure doit contenir au moins une étape.');
    if (normalized.steps.some(step => !step.title || !step.instruction)) errors.push('Chaque étape doit avoir un titre et une instruction.');
    if (normalized.steps.some(step => !PROCEDURE_STEP_TYPES.includes(step.type))) errors.push('Une étape de procédure possède un type inconnu.');
    if (normalized.steps.some(step => !CONTINUITY_VERIFICATION_STATUSES.includes(step.verificationStatus))) errors.push('Une étape possède un état de vérification inconnu.');
    for (const step of normalized.steps) errors.push(...validateEntityReferences(step.entityRefs, `Étape ${step.order}`));
    if (normalized.status === 'validated') {
      if (!normalized.steps.some(step => ['secure', 'switch'].includes(step.type))) errors.push('Une procédure validée doit contenir une étape de sécurisation ou de bascule.');
      if (!normalized.steps.some(step => step.type === 'verify') && !normalized.verificationChecks.length) errors.push('Une procédure validée doit vérifier le résultat antenne/monitoring.');
      if (normalized.steps.some(step => step.verificationStatus !== 'verified')) errors.push('Toutes les étapes d’une procédure validée doivent avoir été vérifiées par le validateur.');
      if (normalized.steps.some(step => step.entityRefs.some(reference => reference.verificationStatus !== 'verified'))) errors.push('Toutes les entités citées par une procédure validée doivent avoir été vérifiées.');
      if (!normalized.validation?.validatedBy || !normalized.validation?.validatedAt) errors.push('La validation de la procédure doit être attribuée et datée.');
    }
  }

  if (record.kind === CONTINUITY_KINDS.TEST) {
    if (!normalized.protectionGroupId) errors.push('Le test doit référencer un groupe de protection.');
    if (!normalized.procedureId) errors.push('Le test doit référencer la procédure exécutée.');
    if (!normalized.performedAt || !normalized.performedBy) errors.push("La date et l'auteur du test sont obligatoires.");
    if (!['passed', 'failed', 'partial', 'aborted'].includes(normalized.result)) errors.push('Le résultat du test de continuité est invalide.');
    if (!normalized.observations) errors.push('Les observations du test de continuité sont obligatoires.');
  }
  return [...new Set(errors)];
}

export function applyContinuityApproval(record, actor, { force = false } = {}) {
  /*
   * Même règle que `diagram-contract.js`, et pour la même raison : ce contrat dit ce qu'EST
   * une validation — quatre yeux, chemins Principal/Secours vérifiés, étapes, structure,
   * `validatedBy`/`validatedAt` — jamais QUI a le droit de la prononcer. Cette question se
   * décide une seule fois, à l'endpoint, avec les zones et les grants.
   *
   * Seule subsiste l'exigence d'un acteur IDENTIFIÉ : une validation anonyme ne pourrait
   * ni être signée, ni être opposée à son auteur.
   */
  if (actor?.id === undefined || actor?.id === null || actor.id === '') throw Object.assign(new Error('La validation doit être signée par un utilisateur identifié.'), { status:403, code:'CONTINUITY_APPROVER_UNKNOWN' });
  if (!force && record.authorId != null && String(record.authorId) === String(actor.id)) throw Object.assign(new Error('Principe des quatre yeux: le validateur doit être différent de l’auteur.'), { status:409, code:'FOUR_EYES_REQUIRED' });
  const verifyReference = reference => ({ ...reference, verificationStatus:'verified' });
  const verifyRoute = path => ({
    ...path,
    verificationStatus:'verified',
    entityRefs:(path.entityRefs || []).map(verifyReference),
    dependencyRefs:(path.dependencyRefs || []).map(verifyReference)
  });
  const verifiedRoutes = record.kind === CONTINUITY_KINDS.PROTECTION_GROUP ? {
    primaryPath:verifyRoute(record.primaryPath || {}),
    backupPaths:(record.backupPaths || []).map(verifyRoute),
    switchoverPoint:record.switchoverPoint ? verifyReference(record.switchoverPoint) : null,
    commonDependencyRefs:(record.commonDependencyRefs || []).map(verifyReference)
  } : {};
  const verifiedSteps = record.kind === CONTINUITY_KINDS.PROCEDURE ? {
    steps:(record.steps || []).map(step => ({ ...step, verificationStatus:'verified', entityRefs:(step.entityRefs || []).map(verifyReference) }))
  } : {};
  const approved = normalizeContinuityRecord(record.kind, {
    ...record,
    ...verifiedRoutes,
    ...verifiedSteps,
    status:'validated',
    verificationStatus:'verified',
    validation:{ validatedBy:actor.id, validatedAt:now(), previousStatus:record.status || 'draft' }
  }, record);
  const errors = validateContinuityRecord(approved);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status:400, code:'INVALID_CONTINUITY_APPROVAL', details:errors });
  return approved;
}

export const CONTINUITY_LIMITS = Object.freeze({ steps:MAX_STEPS, paths:MAX_PATHS, text:TEXT_LIMIT });
