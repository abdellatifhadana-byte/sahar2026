import { db } from './db.js';
import SignalFlow from './signal-flow.js';
import { TOPOLOGY_KINDS, saveTopologyRecord } from './broadcast-topology.js';
import { deriveRouterId } from './topology-contract.js';

const MASTER_FORMAT = '2m-tech-master-image-extraction';
const IMPORT_ORIGIN = 'master-rf-import';
const IMPORT_ORIGIN_V5 = 'master-rf-import-v5';
const NEUTRAL_SOURCE_REF = 'Dataset Master importé';

const safeId = value => String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
const now = () => new Date().toISOString();
const asArray = value => Array.isArray(value) ? value : [];
const asObject = value => (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
const firstText = (...values) => values.map(value => String(value ?? '').trim()).find(Boolean) || '';
const pad = (value, size) => String(value).padStart(size,'0');

const baseTopology = (id, kind, extra = {}) => ({
  id,
  kind,
  targetType:'broadcast_topology',
  targetId:id,
  origin:IMPORT_ORIGIN_V5,
  visibility:'technical',
  createdAt:extra.createdAt || now(),
  updatedAt:now(),
  verificationStatus:extra.verificationStatus || 'documented',
  confidence:extra.confidence || 'high',
  ...extra
});

const cableRefsFrom = value => [...new Set(String(value || '').match(/\b[A-Z]{1,4}\d{2,5}\b/gi)?.map(ref => ref.toUpperCase()) || [])];

const matchZoneIds = (hints, zones = []) => {
  const needles = asArray(hints).map(value => String(value || '').toLowerCase()).filter(Boolean);
  return zones
    .filter(zone => needles.some(needle => `${zone.name || ''} ${zone.slug || ''}`.toLowerCase().includes(needle)))
    .map(zone => String(zone.id));
};

// Découverte STRUCTURELLE des propriétés héritées.
//
// Les anciens payloads nomment leurs blocs d'après l'installation réelle. Reconnaître ces
// blocs par un motif de forme — suffixe, dimensions — plutôt qu'en recopiant le nom protégé
// garde l'import rétro-compatible sans réintroduire de libellé d'installation dans le bundle
// public. Le nom neutre courant et le nom hérité passent tous les deux par le même motif.
const payloadKey = (payload, pattern) => Object.keys(asObject(payload)).find(name => pattern.test(name)) || '';
const payloadBlock = (payload, pattern) => {
  const key = payloadKey(payload, pattern);
  return key ? payload[key] : null;
};

// Les grilles canoniques : uniquement des identifiants machine, aucun libellé opérationnel.
// `legacyPrefix` conserve les identifiants générés historiquement (`gc190-*`), dont dépendent
// les entityRefs déjà persistés ; `legacyBlockPattern` porte les dimensions, qui viennent donc
// du payload importé et ne sont jamais écrites en dur ici.
const CANONICAL_ROUTERS = Object.freeze([
  Object.freeze({
    id:'router-gc190x184',
    legacyPrefix:'gc190',
    blockKey:'centralGrid',
    legacyBlockPattern:/^centralGrid(\d+)[x×](\d+)$/i,
    summaryId:'rf-master-grille-centrale-190x184-summary',
    summaryOrigin:IMPORT_ORIGIN_V5
  }),
  Object.freeze({
    id:'router-grille72',
    legacyPrefix:'grille72',
    blockKey:'secondaryRouter',
    legacyBlockPattern:/^grille(\d+)OperationalModel$/i,
    summaryId:'rf-master-grille72-operational-model',
    summaryTargetId:'GRILLE72',
    summaryOrigin:IMPORT_ORIGIN
  })
]);

const routerBlock = (payload, descriptor) =>
  asObject(payload)[descriptor.blockKey] || payloadBlock(payload, descriptor.legacyBlockPattern);

// Les capacités proviennent du payload : champ explicite, sinon dimensions portées par la clé
// héritée elle-même. Aucune capacité d'installation n'est codée en dur dans ce module public.
function capacitiesFor(payload, descriptor, source) {
  const identity = asObject(source.identity);
  const explicitIn = Number(identity.inputCapacity ?? source.inputCapacity) || 0;
  const explicitOut = Number(identity.outputCapacity ?? source.outputCapacity) || 0;
  if (explicitIn || explicitOut) return { inputCapacity:explicitIn || undefined, outputCapacity:explicitOut || undefined };
  const match = payloadKey(payload, descriptor.legacyBlockPattern).match(descriptor.legacyBlockPattern);
  if (!match) return {};
  const inputCapacity = Number(match[1]) || undefined;
  const outputCapacity = Number(match[2] ?? match[1]) || undefined;
  return { inputCapacity, outputCapacity };
}

function importedIdentity(payload, descriptor, source = {}) {
  const identity = asObject(source.identity);
  const { inputCapacity, outputCapacity } = capacitiesFor(payload, descriptor, source);
  return {
    name:firstText(identity.name, source.name, source.routerLabel, 'Grille importée'),
    routerKey:firstText(identity.routerKey, source.routerKey, descriptor.id),
    matrixLabel:firstText(identity.matrixLabel, source.matrixLabel, inputCapacity && outputCapacity ? `${inputCapacity} × ${outputCapacity}` : ''),
    inputCapacity,
    outputCapacity,
    location:firstText(identity.location, source.location, 'À confirmer'),
    manufacturer:firstText(identity.manufacturer, source.manufacturer, 'À confirmer'),
    model:firstText(identity.model, source.model, 'À confirmer'),
    sourceRef:firstText(identity.sourceRef, source.sourceRef, NEUTRAL_SOURCE_REF),
    zoneHints:asArray(identity.zoneHints || source.zoneHints)
  };
}

// `rvBaie1ToBaie2` -> `baie1-to-baie2` : le groupe de liaisons garde un identifiant stable,
// dérivé de la clé du payload et non d'un index global qui se décalerait à chaque ajout.
const linkGroupSlug = (key, index) =>
  safeId(String(key).replace(/^rv/i,'').replace(/([a-z0-9])([A-Z])/g,'$1-$2')).toLowerCase() || `groupe-${index + 1}`;

function addCanonicalRouter(enriched, routerMap, payload, descriptor, zones) {
  const source = routerBlock(payload, descriptor);
  if (!source) return;
  if (routerMap.has(descriptor.id)) return;

  const routerId = descriptor.id;
  const prefix = descriptor.legacyPrefix;
  const identity = importedIdentity(payload, descriptor, source);
  const sibling = CANONICAL_ROUTERS.find(item => item.id !== routerId)?.id;

  const router = baseTopology(routerId, TOPOLOGY_KINDS.ROUTER, {
    name:identity.name,
    routerKey:identity.routerKey,
    ...(identity.matrixLabel ? { matrixLabel:identity.matrixLabel } : {}),
    ...(identity.inputCapacity ? { inputCapacity:identity.inputCapacity } : {}),
    ...(identity.outputCapacity ? { outputCapacity:identity.outputCapacity } : {}),
    signalDomains:asArray(source.signalDomains).length ? source.signalDomains : ['SDI'],
    location:identity.location,
    manufacturer:identity.manufacturer,
    model:identity.model,
    sourceRef:identity.sourceRef,
    zoneHints:identity.zoneHints,
    zoneIds:matchZoneIds(identity.zoneHints, zones),
    distinctFrom:asArray(source.distinctFrom).length ? asArray(source.distinctFrom) : [sibling].filter(Boolean),
    relationshipNote:firstText(asObject(source.identity).relationshipNote, source.relationshipNote),
    ...(source.safetyNote ? { safetyNote:source.safetyNote } : {})
  });
  routerMap.set(routerId, router);
  enriched[TOPOLOGY_KINDS.ROUTER].push(router);

  const add = (kind, record) => {
    const records = enriched[kind];
    if (!records.some(item => String(item.id) === String(record.id))) records.push(record);
  };

  for (const [direction, items] of [['INPUT', source.inputsVisible], ['OUTPUT', source.outputsVisible]]) {
    const short = direction === 'INPUT' ? 'in' : 'out';
    for (const item of asArray(items)) {
      add(TOPOLOGY_KINDS.ROUTER_PORT, baseTopology(`${prefix}-${short}-${pad(item.number, 3)}`, TOPOLOGY_KINDS.ROUTER_PORT, {
        routerId,
        routerLabel:identity.name,
        direction,
        portNumber:String(item.number),
        logicalAlias:item.label,
        logicalRole:direction === 'INPUT' ? 'SOURCE' : 'DESTINATION',
        signalType:item.signalType || 'SDI',
        confidence:item.confidence,
        verificationStatus:item.status,
        sourceRef:item.sourceRef || NEUTRAL_SOURCE_REF
      }));
    }
  }

  const interfaces = asObject(source.interfaces);

  for (const item of asArray(interfaces.sync)) add(TOPOLOGY_KINDS.ROUTER_INTERFACE, baseTopology(`${prefix}-if-${safeId(item.port).toLowerCase()}`, TOPOLOGY_KINDS.ROUTER_INTERFACE, {
    routerId,
    interfaceType:'SYNC_REFERENCE',
    name:item.port,
    function:item.function,
    cableRefs:item.cableRef ? [item.cableRef] : [],
    impedance:item.impedance || '',
    confidence:item.confidence
  }));

  for (const name of asArray(interfaces.control)) add(TOPOLOGY_KINDS.ROUTER_INTERFACE, baseTopology(`${prefix}-if-${safeId(name).toLowerCase()}`, TOPOLOGY_KINDS.ROUTER_INTERFACE, {
    routerId,
    interfaceType:'CONTROL',
    name,
    function:'Contrôle de la grille',
    signalType:/ENET/i.test(name) ? 'ETHERNET' : /SERIAL/i.test(name) ? 'SERIAL' : 'AUTRE'
  }));

  for (const item of asArray(interfaces.monitoringOutputs)) add(TOPOLOGY_KINDS.ROUTER_INTERFACE, baseTopology(`${prefix}-if-${safeId(item.name).toLowerCase()}`, TOPOLOGY_KINDS.ROUTER_INTERFACE, {
    routerId,
    interfaceType:'MONITORING_OUTPUT',
    name:item.name,
    function:'Sortie de monitoring',
    cableRefs:asArray(item.segmentRefs),
    confidence:item.confidence
  }));

  for (const station of asArray(source.controlMonitoringStations)) add(TOPOLOGY_KINDS.ROUTER_INTERFACE, baseTopology(`${prefix}-station-${safeId(station.name).toLowerCase()}`, TOPOLOGY_KINDS.ROUTER_INTERFACE, {
    routerId,
    interfaceType:'CONTROL_STATION',
    name:station.name,
    function:'Contrôle / monitoring',
    location:station.location,
    features:asArray(station.features),
    confidence:station.confidence
  }));

  const interBayLinks = asObject(source.interBayLinks);
  Object.entries(interBayLinks).filter(([, links]) => Array.isArray(links)).forEach(([groupKey, links], groupIndex) => {
    const slug = linkGroupSlug(groupKey, groupIndex);
    links.forEach((link, index) => {
      const sourceLabel = firstText(link.source, link.left);
      const destinationLabel = firstText(link.destination, link.right, 'Destination à confirmer');
      const refs = [...cableRefsFrom(link.via), ...[link.segmentA, link.segmentB].filter(Boolean)];
      add(TOPOLOGY_KINDS.RV_LINK, baseTopology(`${prefix}-rv-${slug}-${pad(index + 1, 2)}`, TOPOLOGY_KINDS.RV_LINK, {
        routerId,
        sourceLabel,
        destinationLabel,
        cableRefs:[...new Set(refs)],
        segmentRefs:[...new Set(refs)],
        signalType:link.signalType || 'SDI',
        confidence:link.confidence,
        verificationStatus:link.verificationStatus || (firstText(link.destination, link.right) ? 'documented' : 'to-confirm'),
        name:firstText(link.name, sourceLabel && destinationLabel ? `${sourceLabel} ↔ ${destinationLabel}` : ''),
        notes:firstText(link.notes, interBayLinks.note)
      }));
    });
  });

  asArray(source.handwrittenOperationalAnnotations).forEach((note, index) => add(TOPOLOGY_KINDS.EVIDENCE, baseTopology(`${prefix}-handwritten-${pad(index + 1, 2)}`, TOPOLOGY_KINDS.EVIDENCE, {
    sourceType:'observed-handwritten',
    sourceRef:note.sourceRef || 'Annotation manuscrite importée',
    target:note.target,
    annotation:note.annotation,
    confidence:note.confidence,
    verificationStatus:note.status || 'to-confirm'
  })));
}

export function buildMasterTopology(payload, { zones = [] } = {}) {
  const source = payload?.topology || payload?.data?.topology || {};
  const enriched = Object.fromEntries(Object.values(TOPOLOGY_KINDS).map(kind => [kind, asArray(source[kind]).map(record => ({ ...record }))]));
  const routerMap = new Map(enriched[TOPOLOGY_KINDS.ROUTER].map(router => [String(router.id), router]));

  for (const descriptor of CANONICAL_ROUTERS) addCanonicalRouter(enriched, routerMap, payload, descriptor, zones);

  for (const port of enriched[TOPOLOGY_KINDS.ROUTER_PORT]) {
    port.routerId = deriveRouterId(port);
    if (!port.routerId || routerMap.has(String(port.routerId))) continue;
    const router = baseTopology(port.routerId, TOPOLOGY_KINDS.ROUTER, {
      name:port.routerLabel || port.routerEquipmentKey || port.routerId,
      routerKey:port.routerEquipmentKey || port.routerId,
      verificationStatus:port.verificationStatus || 'documented',
      confidence:port.confidence || 'medium',
      zoneHints:[port.system].filter(Boolean)
    });
    routerMap.set(String(port.routerId), router);
    enriched[TOPOLOGY_KINDS.ROUTER].push(router);
  }
  return enriched;
}

async function saveIfMissing(record) {
  const existing = await db.get('docs',record.id).catch(() => null);
  if (existing) return { status:'skipped', record:existing };
  await db.save('docs',record);
  return { status:'created', record };
}

async function importTopologyConservatively(topology = {}) {
  const imported = [];
  const skipped = [];
  const rejected = [];
  for (const kind of Object.values(TOPOLOGY_KINDS)) {
    for (const candidate of asArray(topology[kind])) {
      try {
        const existing = candidate?.id ? await db.get('docs',candidate.id).catch(() => null) : null;
        if (existing) {
          skipped.push({ kind,id:candidate.id,reason:'Déjà présent — correction admin conservée' });
          continue;
        }
        imported.push(await saveTopologyRecord(kind,{ ...candidate, origin:candidate.origin || IMPORT_ORIGIN }));
      } catch (error) {
        rejected.push({ kind,id:candidate?.id || null,reason:error.message });
      }
    }
  }
  return { imported,skipped,rejected };
}

async function importAuxiliaryMasterRecords(payload) {
  let created = 0;
  let skipped = 0;
  const add = async record => {
    const result = await saveIfMissing(record);
    if (result.status === 'created') created += 1;
    else skipped += 1;
  };
  const auxiliaryRecord = (record) => ({
    origin:IMPORT_ORIGIN,
    visibility:'technical',
    createdAt:now(),
    updatedAt:now(),
    ...record
  });

  for (const bay of asArray(payload.physicalBays)) {
    await add(auxiliaryRecord({
      id:`rf-master-bay-${safeId(bay.bay)}`, kind:'rf_physical_bay', targetType:'rf_physical_bay', targetId:bay.bay,
      bay:bay.bay, system:bay.system, confidence:bay.confidence || 'high', observed:asArray(bay.observed),
      planLinks:asArray(bay.plan_links || bay.planLinks),
      verificationStatus:bay.verificationStatus || 'documented', sourceRef:bay.sourceRef || NEUTRAL_SOURCE_REF
    }));
  }

  for (const frame of asArray(payload.chassisFrames)) {
    await add(auxiliaryRecord({
      ...frame,
      id:`rf-master-chassis-${safeId(frame.bay)}-${safeId(frame.frame)}`, kind:'rf_chassis', targetType:'rf_chassis', targetId:`${frame.bay}/${frame.frame}`,
      verificationStatus:frame.verificationStatus || 'documented', confidence:frame.confidence || 'high'
    }));
  }

  for (const item of asArray(payload.auxiliaryEquipment)) {
    const id = item.id || item.repere || item.name || `${item.bay}-${item.model}`;
    await add(auxiliaryRecord({ ...item, id:`rf-master-aux-${safeId(id)}`, kind:'rf_auxiliary_equipment', targetType:'rf_auxiliary_equipment', targetId:id }));
  }

  for (const placement of asArray(payload.devicePlacements)) {
    const id = placement.id || placement.repere || `${placement.bay}-${placement.frame}-${placement.slotStart || placement.slot || ''}-${placement.name || placement.model || ''}`;
    await add(auxiliaryRecord({ ...placement, id:`rf-master-placement-${safeId(id)}`, kind:'rf_device_placement', targetType:'rf_device_placement', targetId:id }));
  }

  // Bloc mur de monitoring : le nom neutre courant et le nom hérité sont reconnus par le même
  // motif de suffixe, l'identifiant persisté historique est conservé tel quel.
  for (const wall of asArray(payloadBlock(payload, /MonitoringWall$/i))) {
    const id = wall.label || wall.source || wall.sourceObservedLabel;
    await add(auxiliaryRecord({ ...wall, id:`rf-master-stc-window-${safeId(id)}`, kind:'stc_monitoring_window', targetType:'stc_monitoring_window', targetId:id }));
  }

  for (const [planKey, plan] of Object.entries(asObject(payload.documentedPlans))) {
    await add(auxiliaryRecord({ ...plan, id:`rf-master-plan-${safeId(planKey)}`, kind:'rf_documented_plan', targetType:'rf_documented_plan', targetId:planKey }));
  }

  for (const [group, labels] of Object.entries(asObject(payloadBlock(payload, /OtherMultiviewLabels$/i)))) {
    await add(auxiliaryRecord({ id:`rf-master-multiview-${safeId(group)}`, kind:'stc_multiview_labels', targetType:'stc_multiview_labels', targetId:group, group, labels:asArray(labels), verificationStatus:'documented', confidence:'high' }));
  }

  for (const [signalType, visualConvention] of Object.entries(asObject(payload.layerKey))) {
    await add(auxiliaryRecord({ id:`rf-master-layer-${safeId(signalType)}`, kind:'rf_plan_layer_key', targetType:'rf_plan_layer_key', targetId:signalType, signalType, visualConvention, verificationStatus:'documented', confidence:'high' }));
  }

  for (const [index, label] of asArray(payload.sourceFrameLabels).entries()) {
    await add(auxiliaryRecord({ ...label, id:`rf-master-source-label-${pad(index + 1, 2)}-${safeId(label.system)}-${safeId(label.frame)}-${safeId(label.slot)}`, kind:'rf_source_frame_label', targetType:'rf_source_frame_label', targetId:`${label.system}/${label.frame}/${label.slot}`, verificationStatus:label.verificationStatus || 'documented' }));
  }

  for (const zone of asArray(payload.otherObservedZones)) {
    await add(auxiliaryRecord({ ...zone, id:`rf-master-zone-${safeId(zone.zone)}`, kind:'rf_zone_observation', targetType:'rf_zone_observation', targetId:zone.zone }));
  }

  for (const descriptor of CANONICAL_ROUTERS) {
    const source = routerBlock(payload, descriptor);
    if (!source) continue;
    const identity = importedIdentity(payload, descriptor, source);
    await add(auxiliaryRecord({
      ...(descriptor.summaryTargetId ? source : {}),
      id:descriptor.summaryId,
      kind:'routing_operational_model',
      targetType:'routing_operational_model',
      targetId:descriptor.summaryTargetId || descriptor.id,
      name:identity.name,
      ...(source.identity ? { identity:source.identity } : {}),
      ...(source.cableNumbering ? { cableNumbering:source.cableNumbering } : {}),
      visibleInputCount:asArray(source.inputsVisible).length,
      visibleOutputCount:asArray(source.outputsVisible).length,
      ...(source.unknownRanges ? { unknownRanges:asArray(source.unknownRanges) } : {}),
      crosspointsImported:0,
      notes:firstText(source.notes, 'Les éléments absents du fichier importé restent non documentés. Aucun crosspoint actif n’est déduit automatiquement.'),
      verificationStatus:'documented',
      confidence:'high',
      origin:descriptor.summaryOrigin || IMPORT_ORIGIN_V5
    }));
  }

  if (asArray(payload.reviewRequired).length) {
    await add(auxiliaryRecord({
      id:'rf-master-review-required',
      kind:'rf_review_required',
      targetType:'rf_review_required',
      targetId:'MASTER-REVIEW',
      items:payload.reviewRequired,
      verificationStatus:'to-confirm',
      confidence:'medium'
    }));
  }

  return { created,skipped };
}

export async function importRFMasterPayload(payload) {
  if (!payload || payload.format !== MASTER_FORMAT) throw new Error(`Format attendu : ${MASTER_FORMAT}`);
  let zones = [];
  try { zones = JSON.parse(localStorage.getItem('zone-access-context') || '{}')?.zones || []; } catch {}
  const topology = await importTopologyConservatively(buildMasterTopology(payload, { zones }));
  const auxiliary = await importAuxiliaryMasterRecords(payload);
  await db.logAction?.('IMPORT_MASTER_DATASET',{
    importedTopology:topology.imported.length,
    skippedTopology:topology.skipped.length,
    rejectedTopology:topology.rejected.length,
    auxiliaryCreated:auxiliary.created,
    auxiliarySkipped:auxiliary.skipped
  }).catch?.(() => {});
  return { topology,auxiliary };
}

const previousImportData = SignalFlow.prototype.importData;
SignalFlow.prototype.importData = async function importSignalFlowOrMaster(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== MASTER_FORMAT) return previousImportData.call(this,file);
    const result = await importRFMasterPayload(payload);
    const imported = result.topology.imported.length + result.auxiliary.created;
    const skipped = result.topology.skipped.length + result.auxiliary.skipped;
    const rejected = result.topology.rejected.length;
    this.notifications?.showNotification(`Dataset Master technique intégré : ${imported} nouvel(aux) élément(s), ${skipped} déjà présent(s) conservé(s)${rejected ? `, ${rejected} rejeté(s)` : ''}.`, rejected ? 'warning' : 'success');
    await this.refresh();
  } catch (error) {
    this.notifications?.showNotification(`Import Master technique impossible : ${error.message}`, 'error');
  }
};

const previousAfterRender = SignalFlow.prototype.afterRender;
SignalFlow.prototype.afterRender = async function afterRenderWithMasterImportHint() {
  await previousAfterRender.call(this);
  const button = document.getElementById('sf-import');
  if (button && !button.dataset.masterReady) {
    button.dataset.masterReady = '1';
    button.title = 'Accepte la topologie standard et un Dataset Master technique extrait de photos ou synoptiques.';
  }
};

if (typeof window !== 'undefined') window.RFMasterImport = Object.freeze({ format:MASTER_FORMAT, importPayload:importRFMasterPayload });

export default importRFMasterPayload;