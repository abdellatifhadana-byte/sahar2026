import { db } from './db.js';
import {
  REGIE_CAR_ROOM_ID,
  REGIE_CAR_BATCH_ID,
  ensureRegieCarPhase16
} from './regie-car-inventory-phase16.js';
import { loadRegieCarDataset, jetonDOuverture } from './regie-car-dataset.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';

/*
 * `room-regie-car` EST UNE COMPATIBILITÉ, PAS LE MODÈLE MÉTIER.
 *
 * Une Régie Car n'est pas une salle : c'est une UNITÉ TECHNIQUE MOBILE. Il peut y en avoir
 * plusieurs — RC-01, RC-02… — et une même unité se déplace entre villes, sites, bâtiments et
 * lieux d'événement sans que son identité, ni celle de ses baies et de ses équipements,
 * change. Ce qui change est un RATTACHEMENT DE DÉPLOIEMENT, pas une appartenance.
 *
 * L'identifiant de salle utilisé ici représente l'unité actuellement inventoriée, et rien de
 * plus. Aucune dépendance NOUVELLE n'est ajoutée sur lui par ce lot de confidentialité : la
 * route protégée reçoit son relevé d'un jeu de données paramétrable, et la décision
 * d'autorisation est isolée dans `canReadRegieCarDataset()` — c'est là, et là seulement,
 * qu'un identifiant d'unité mobile viendra remplacer la recherche par salle.
 *
 * Le modèle correct — unité mobile de premier ordre, déploiement courant, historique des
 * déploiements, relations temporaires vers sites/zones/salles — relève d'un lot dédié, pas
 * de celui-ci.
 */
export const REGIE_CAR_PREPHOTO_VERSION = 1;
export const REGIE_CAR_CAPTURE_PLAN_ID = 'field-capture-plan:regie-car';
export const REGIE_CAR_PREPHOTO_ORIGIN = 'regie-car-prephoto-phase17';

export const REGIE_CAR_PREPHOTO_POLICY = Object.freeze({
  additiveOnly:true,
  preserveExistingPlatformData:true,
  protectAdminAndManualOverrides:true,
  capturePlanIsDocumentationOnly:true,
  futureMediaRequiresReview:true,
  noAutomaticOfficialImagePromotion:true,
  noAutomaticPortCreation:true,
  noAutomaticCableCreation:true,
  noAutomaticTopologyCreation:true,
  noAutomaticCrosspointCreation:true,
  noFuzzyExactModelPromotion:true,
  unresolvedPhysicalLocationsRemainExplicit:true
});

const asArray = value => Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
const now = () => new Date().toISOString();
const clean = value => String(value ?? '').trim();
const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const union = (a,b) => [...new Set([...asArray(a),...asArray(b)].filter(Boolean))];

function adminLocked(record) {
  const origin = clean(record?.origin).toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true || record?.manualOverride === true;
}

/*
 * FUSIONNER N'EST PAS DATER (#164) — même défaut, même correctif que
 * `regie-car-inventory-phase16.js` : `updatedAt` n'est plus posé ici, il ne l'est qu'au
 * moment d'écrire, et seulement si `estIdentique` constate une différence réelle.
 */
function fillMissing(existing,incoming) {
  const next = { ...existing };
  for (const [key,value] of Object.entries(incoming)) {
    if (['id','createdAt','updatedAt','origin'].includes(key)) continue;
    if (['fieldEvidenceRefs','manufacturerResearchSources','technicalFacts'].includes(key)) {
      next[key] = union(existing[key], value);
      continue;
    }
    const current = existing[key];
    const missing = current == null || current === '' || (Array.isArray(current) && current.length === 0);
    if (missing) next[key] = value;
  }
  return next;
}

/*
 * COMPARER LE CONTENU, PAS L'ORDRE DES CLÉS (#98).
 *
 * `existing` revient du serveur, où PostgreSQL le range en `jsonb` — un format qui
 * RÉORDONNE les clés. `next` est rebâti ici à partir des littéraux du module :
 * `counts`, `policy`, `gaps` et `targets` repartent donc dans l'ordre du fichier, jamais
 * dans celui de la base. `JSON.stringify` répondait « différent » à chaque chargement pour
 * un plan de capture strictement inchangé, et le plan était réécrit.
 *
 * Le correctif de #164 cité plus haut — « fusionner n'est pas dater » — reste entier : on
 * ne pose toujours `updatedAt` qu'au moment d'écrire. Il manquait simplement que la
 * comparaison qui décide d'écrire regarde le contenu et non sa mise en page.
 */
const estIdentique = (next,existing) => recordsExactlyEqual(next,existing);



const CAPTURE_LABELS = Object.freeze({
  'front-panel-photo':'Façade rapprochée',
  'label-photo':'Étiquette modèle / serial / asset tag',
  'rear-panel-photo':'Face arrière complète et lisible',
  'rack-overview-photo':'Vue complète de baie',
  'patch-panel-photo':'Patchfield avec repères lisibles',
  'cable-trace-photo':'Repère câble et deux extrémités'
});

function capture(id,targetType,targetId,captureType,label,priority='normal',extra={}) {
  return Object.freeze({
    id:`regie-car:capture:${id}`,
    targetType,targetId,captureType,label:label || CAPTURE_LABELS[captureType] || captureType,
    priority,status:'awaiting-photo',evidenceRef:null,reviewState:'pending',
    doesNotProveLiveSignal:true,...extra
  });
}

function equipmentCaptureTargets(equipment) {
  const targets = [];
  const key = clean(equipment.id);
  const uncertain = equipment.exactModelConfirmed !== true;
  const patch = equipment.entityKind === 'patch-panel';
  if (uncertain) targets.push(capture(`${key}:front`,'equipment',key,'front-panel-photo','Façade rapprochée avec tous les marquages', 'high'));
  targets.push(capture(`${key}:label`,'equipment',key,'label-photo','Étiquette constructeur / modèle / serial / asset tag', uncertain ? 'critical' : 'high'));
  targets.push(capture(`${key}:rear`,'equipment',key,'rear-panel-photo','Face arrière complète : connecteurs et repères sans créer automatiquement de ports', 'high'));
  if (patch) {
    targets.push(capture(`${key}:patch`,'equipment',key,'patch-panel-photo','Patchfield complet : rangées, numéros, normalisation et légende', 'critical'));
    targets.push(capture(`${key}:trace`,'equipment',key,'cable-trace-photo','Au moins un câble démontré de bout en bout avant toute liaison physique', 'critical'));
  }
  if (equipment.provisionalInstance === true && !equipment.baieId) {
    targets.push(capture(`${key}:location`,'equipment',key,'rack-overview-photo','Vue de contexte montrant sans ambiguïté la baie/position de cette instance', 'high', {purpose:'resolve-physical-location'}));
  }
  return targets;
}

/*
 * LE PLAN DE COLLECTE SE CONSTRUIT À LA DEMANDE (A-5).
 *
 * Il était calculé À L'IMPORT depuis les baies et le matériel réels : charger le module
 * suffisait donc à matérialiser tout le relevé de la Régie Car sur un poste sans session.
 * C'est exactement ce que #137 avait fermé pour la Grille Centrale. Il se construit
 * désormais à partir du jeu de données autorisé, et rend une liste vide quand il n'y en a
 * pas — jamais un repli local.
 */
function blueprintComplet(dataset) {
  return Object.freeze([...(dataset?.equipment || []), ...(dataset?.additionalEquipment || [])]);
}

export function buildRegieCarCaptureTargets(dataset) {
  const baies = dataset?.baies || [];
  if (!baies.length && !blueprintComplet(dataset).length) return Object.freeze([]);
  return Object.freeze([
  capture('context:interior-wide','room',REGIE_CAR_ROOM_ID,'rack-overview-photo','Vue générale intérieure couvrant toutes les zones techniques', 'high', {purpose:'room-zoning'}),
  capture('context:operator-desk','room',REGIE_CAR_ROOM_ID,'rack-overview-photo','Vue générale des pupitres opérateur et repères de zones', 'normal', {purpose:'operator-zone-context'}),
    ...baies.flatMap(baie => [
    capture(`baie:${baie.id}:front`,'baie',baie.id,'rack-overview-photo',`${baie.name} — face avant complète du haut vers le bas`, 'high', {view:'front'}),
    capture(`baie:${baie.id}:rear`,'baie',baie.id,'rack-overview-photo',`${baie.name} — face arrière complète si accessible en sécurité`, 'critical', {view:'rear'})
  ]),
    ...blueprintComplet(dataset).flatMap(equipmentCaptureTargets)
  ]);
}

/*
 * L'ÉTAT DE DOCUMENTATION A QUITTÉ LE MODULE PUBLIC (A-5, suite de revue).
 *
 * `REGIE_CAR_PREPHOTO_GAPS` énonçait ce qui MANQUE aujourd'hui à CETTE installation :
 * l'inventaire de ce qui reste à documenter sur cette unité. Ce n'est pas du savoir
 * constructeur : c'est un état d'avancement, et il dit à qui le lit par où l'unité est mal
 * documentée.
 *
 * NI LES PHRASES, NI LEURS CATÉGORIES NE SONT CITÉES ICI, et c'est délibéré : un commentaire
 * est servi exactement comme du code, et le précache le télécharge avec le reste. Deux
 * passes de ce lot l'ont vérifié à leurs dépens — d'abord une phrase recopiée mot pour mot,
 * puis l'énumération des catégories qui la remplaçait. Les détails d'état propres à
 * l'installation viennent du jeu de données protégé, et de lui seul.
 *
 * Le module était servi à la racine ET précaché : ces phrases arrivaient donc sur un poste
 * avant toute connexion. La première passe de ce lot ne l'a pas vu — ses empreintes ne
 * classaient que des identifiants, des implantations et des capacités, pas des NARRATIFS.
 *
 * Les lacunes arrivent désormais par `dataset.prephotoGaps`, donc par la route autorisée.
 */

function buildCapturePlan(dataset, roomId=REGIE_CAR_ROOM_ID) {
  const blueprint = blueprintComplet(dataset);
  const targets = buildRegieCarCaptureTargets(dataset).map(target => ({
    ...target,
    targetId:target.targetType === 'room' ? roomId : target.targetId
  }));
  return {
    id:REGIE_CAR_CAPTURE_PLAN_ID,
    kind:'field_capture_plan',targetType:'field_capture_plan',targetId:REGIE_CAR_CAPTURE_PLAN_ID,
    title:'Régie Car — plan de collecte terrain avant as-built',sourceContext:'mobile-production-unit',sourceBatchId:REGIE_CAR_BATCH_ID,
    roomId,status:(dataset?.prephotoReadiness?.planStatus || null),version:REGIE_CAR_PREPHOTO_VERSION,
    policy:REGIE_CAR_PREPHOTO_POLICY,gaps:(dataset?.prephotoGaps || []),targets,
    counts:{
      knownBaies:(dataset?.baies || []).length,
      phase16Equipments:(dataset?.equipment || []).length,
      phase17AdditionalObservations:(dataset?.additionalEquipment || []).length,
      equipmentBlueprint:blueprint.length,
      captureTargets:targets.length,
      criticalTargets:targets.filter(target => target.priority === 'critical').length,
      exactModelBlueprint:blueprint.filter(item => item.exactModelConfirmed === true).length,
      unresolvedModelBlueprint:blueprint.filter(item => item.exactModelConfirmed !== true).length
    },
    binaryMediaStatus:(dataset?.prephotoReadiness?.binaryMediaStatus || null),origin:REGIE_CAR_PREPHOTO_ORIGIN
  };
}

export function summarizeRegieCarPrephotoReadiness(dataset = null) {
  /*
   * SANS JEU AUTORISÉ, ON NE RÉPOND PAS (A-5, résiduel R3).
   *
   * MESURÉ sur `e2c1a7d` : appelée sans argument — ce que `window.RegieCarPrephotoReadiness.summarize`
   * permettait à n'importe quel poste — cette fonction rendait encore
   * `readyForNextPhotoBatch: true`, `safeToReceiveNewEvidence: true` et
   * `binaryMediaStillRequired: true`. La liste détaillée des lacunes était bien partie, mais
   * l'ORACLE restait : on pouvait toujours demander si la Régie Car est prête, et par où
   * elle attend. C'est un état d'installation, pas une politique de collecte.
   *
   * Le refus est explicite plutôt que muet : un appelant doit pouvoir distinguer « pas
   * autorisé » d'un état réellement neutre, sans lire un booléen qui n'existe pas.
   */
  if (!dataset?.prephotoReadiness) {
    return Object.freeze({ available:false, reason:'dataset-unavailable' });
  }
  const plan = buildCapturePlan(dataset);
  return Object.freeze({
    available:true,
    readyForNextPhotoBatch:dataset.prephotoReadiness.readyForNextPhotoBatch,
    safeToReceiveNewEvidence:dataset.prephotoReadiness.safeToReceiveNewEvidence,
    binaryMediaStillRequired:dataset.prephotoReadiness.binaryMediaStillRequired,
    ...plan.counts,
    remainingGapIds:(dataset?.prephotoGaps || []).map(item => item.id)
  });
}

async function ensureManufacturerSources(dataset) {
  let enriched=0, protectedCount=0, missing=0;
  for (const patch of (dataset?.manufacturerSourcePatches || [])) {
    const current = await db.get('docs',patch.id).catch(() => null);
    if (!current) { missing += 1; continue; }
    if (adminLocked(current)) { protectedCount += 1; continue; }
    const incoming = { ...patch,manufacturerResearchReviewedAt:'2026-08-16',manufacturerResearchOrigin:REGIE_CAR_PREPHOTO_ORIGIN };
    const next = fillMissing(current,incoming);
    next.manufacturerResearchSources = union(current.manufacturerResearchSources,patch.manufacturerResearchSources);
    if (!estIdentique(next,current)) { await db.save('docs',{...next,updatedAt:now()}); enriched += 1; }
  }
  return {enriched,protected:protectedCount,missing};
}

async function ensureAdditionalEquipment(dataset, roomId) {
  const supplementaires = dataset?.additionalEquipment || [];
  const existing = await db.getAll('equipments');
  let created=0,enriched=0,protectedCount=0;
  for (const base of supplementaires) {
    let current = existing.find(item => item.fieldInventoryKey === base.fieldInventoryKey || String(item.id) === String(base.id));
    const incoming = { ...base,roomId,inventorySource:{source:'Régie Car field-photo gap completion',batchId:REGIE_CAR_BATCH_ID,evidenceRefs:base.fieldEvidenceRefs},createdAt:now(),updatedAt:now() };
    if (!current) { await db.save('equipments',incoming); existing.push(incoming); created += 1; continue; }
    if (adminLocked(current)) { protectedCount += 1; continue; }
    const next = fillMissing(current,incoming);
    next.fieldEvidenceRefs = union(current.fieldEvidenceRefs,incoming.fieldEvidenceRefs);
    if (!estIdentique(next,current)) { await db.save('equipments',{...next,updatedAt:now()}); enriched += 1; }
  }
  return {created,enriched,protected:protectedCount,total:supplementaires.length};
}

function mergeCaptureTargets(currentTargets,incomingTargets) {
  const currentById = new Map(asArray(currentTargets).map(item => [clean(item?.id),item]).filter(([id]) => id));
  return incomingTargets.map(incoming => {
    const current = currentById.get(incoming.id);
    if (!current) return incoming;
    const merged = {...incoming,...current,id:incoming.id};
    // Keep contract fields canonical while preserving review/progress fields captured later.
    merged.targetType = incoming.targetType;
    merged.targetId = incoming.targetId;
    merged.captureType = incoming.captureType;
    merged.doesNotProveLiveSignal = true;
    merged.status = clean(current.status) || incoming.status;
    merged.reviewState = clean(current.reviewState) || incoming.reviewState;
    merged.evidenceRef = clean(current.evidenceRef) || null;
    return merged;
  });
}

async function ensureCapturePlan(dataset, roomId) {
  const current = await db.get('docs',REGIE_CAR_CAPTURE_PLAN_ID).catch(() => null);
  if (current && adminLocked(current)) return {record:current,protected:true};
  const base = {...buildCapturePlan(dataset, roomId),createdAt:current?.createdAt || now()};
  const mergedTargets = mergeCaptureTargets(current?.targets,base.targets);
  // Sans écriture inconditionnelle (#164) : le plan de capture était réécrit à CHAQUE
  // appel, `updatedAt` posé avant toute comparaison — la même boucle que `fillMissing`.
  const next = current ? {
    ...current,
    kind:base.kind,targetType:base.targetType,targetId:base.targetId,title:current.title || base.title,
    sourceContext:base.sourceContext,sourceBatchId:base.sourceBatchId,roomId,version:base.version,
    policy:base.policy,gaps:base.gaps,targets:mergedTargets,
    counts:{...base.counts,captureTargets:mergedTargets.length,criticalTargets:mergedTargets.filter(target => target.priority === 'critical').length},
    binaryMediaStatus:current.binaryMediaStatus || base.binaryMediaStatus,
    createdAt:current.createdAt || base.createdAt,origin:current.origin || base.origin
  } : {...base,targets:mergedTargets};
  if (current && estIdentique(next,current)) return {record:current,protected:false};
  const record = {...next,updatedAt:now()};
  await db.save('docs',record);
  return {record,protected:false};
}

async function runEnsureRegieCarPrephotoReadiness() {
  const phase16 = await ensureRegieCarPhase16();
  /*
   * MÊME RÈGLE QUE LA PHASE 16 : sans relevé autorisé, on ne fait RIEN. La phase 16 s'est
   * déjà tue pour la même raison ; poursuivre ici écrirait un plan de collecte vide sur une
   * salle qui n'a pas été amorcée.
   */
  const dataset = await loadRegieCarDataset();
  if (!dataset) {
    return { version:REGIE_CAR_PREPHOTO_VERSION, skipped:true, reason:'dataset-unavailable',
             roomId:null, sources:null, additionalEquipment:null,
             capturePlanId:REGIE_CAR_CAPTURE_PLAN_ID, captureTargets:0,
             readiness:null, policy:REGIE_CAR_PREPHOTO_POLICY };
  }
  await db.open();
  const roomId = phase16.roomId || REGIE_CAR_ROOM_ID;
  const sources = await ensureManufacturerSources(dataset);
  const additionalEquipment = await ensureAdditionalEquipment(dataset, roomId);
  const capturePlan = await ensureCapturePlan(dataset, roomId);
  const result = {
    version:REGIE_CAR_PREPHOTO_VERSION,roomId,sources,additionalEquipment,
    capturePlanId:REGIE_CAR_CAPTURE_PLAN_ID,captureTargets:capturePlan.record.targets?.length || 0,
    readiness:summarizeRegieCarPrephotoReadiness(dataset),policy:REGIE_CAR_PREPHOTO_POLICY
  };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('regie-car-prephoto-ready',{detail:result}));
  return result;
}

// Un seul vol en cours — même raison, même correctif qu'`ensureRegieCarPhase16` (#98).
let vol = null;
export function ensureRegieCarPrephotoReadiness() {
  if (vol) return vol;
  vol = runEnsureRegieCarPrephotoReadiness().finally(() => { vol = null; });
  return vol;
}

async function equipmentFrom360(modal) {
  const id = clean(modal?.dataset?.equipmentId);
  if (id) {
    const equipment = await db.get('equipments',db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
    if (equipment) return equipment;
  }
  const name = clean(modal?.querySelector('.ops-modal-head > div > div')?.textContent);
  if (!name) return null;
  const target = normalize(name);
  const matches = (await db.getAll('equipments')).filter(item => normalize(item.name || item.nom || item.reference) === target);
  return matches.length === 1 ? matches[0] : null;
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('regie-car-prephoto-style')) return;
  const style = document.createElement('style');
  style.id = 'regie-car-prephoto-style';
  style.textContent = `
    .regie-car-prephoto-card{display:grid;gap:10px}.regie-car-prephoto-note{margin:0;color:var(--text-muted,#60717d);font-size:12px;line-height:1.55}
    .regie-car-prephoto-tags{display:flex;flex-wrap:wrap;gap:6px}.regie-car-prephoto-tag{font-size:10px;font-weight:800;border-radius:999px;padding:4px 8px;background:rgba(40,116,166,.12)}
    .regie-car-prephoto-tag.warn{background:rgba(230,126,34,.14)}.regie-car-prephoto-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}
    .regie-car-prephoto-list li{border:1px solid var(--border,#dce4e8);border-radius:10px;padding:8px 10px;display:flex;gap:9px;align-items:flex-start;font-size:12px}
    .regie-car-prephoto-priority{font-size:9px;font-weight:900;text-transform:uppercase;border-radius:999px;padding:3px 6px;background:rgba(192,57,43,.12)}
  `;
  document.head.appendChild(style);
}

export async function enhanceRegieCarPrephoto360(modal=document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.regieCarPrephoto === '1' || modal.dataset.regieCarPrephotoBusy === '1') return false;
  modal.dataset.regieCarPrephotoBusy = '1';
  try {
    /*
     * CONSULTER N'EST PAS ENSEMENCER (#108).
     *
     * Ce panneau se réveille sur un MutationObserver de `#app`, donc à CHAQUE fiche 360
     * insérée. L'ensemencement appelé ici s'exécutait alors à chaque ouverture : dix
     * consultations de la même fiche produisaient 974 PUT, sans intention utilisateur.
     * Le démarrage pose ces données une fois ; une lecture n'a pas à les reposer. Le
     * panneau rend donc ce qui existe, et se tait quand il n'existe pas encore.
     */
    const equipment = await equipmentFrom360(modal);
    if (!equipment) return false;
    const isRegieCar = String(equipment.roomId) === String(REGIE_CAR_ROOM_ID) || clean(equipment.fieldInventoryKey).startsWith('regie-car:') || clean(equipment.origin).startsWith('regie-car-');
    if (!isRegieCar) return false;
    /*
     * CHAQUE OUVERTURE REDEMANDE AU SERVEUR (A-5, suite de revue).
     *
     * Ce panneau lisait `peekRegieCarDataset()` : il se contentait de ce qu'une ouverture
     * PRÉCÉDENTE avait obtenu. La mémoire du transport suit pourtant la portée d'accès, et
     * cette portée ne bouge qu'au prochain instantané de `central-sync` — il existe donc une
     * fenêtre, entre la révocation côté serveur et la réécriture locale du contexte, pendant
     * laquelle l'onglet rendait encore les cibles protégées. C'est exactement l'autorité
     * périmée que #137 avait fermée pour la Grille Centrale, et qui restait ouverte ici.
     *
     * `revalidate:true` reconsulte la route protégée avant de peindre quoi que ce soit ; le
     * jeton d'ouverture fait que les tentatives répétées du `MutationObserver` sur LA MÊME
     * modale ne comptent que pour une décision. Un refus rend `null`, jette la mémoire, et
     * rien n'est rendu.
     */
    const jeu = await loadRegieCarDataset({ revalidate:true, ouverture:jetonDOuverture(modal) });
    const targets = buildRegieCarCaptureTargets(jeu)
      .filter(target => target.targetType === 'equipment' && String(target.targetId) === String(equipment.id));
    if (!targets.length) return false;
    injectStyles();
    const targetHost = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!targetHost) return false;
    const section = document.createElement('section');
    section.className = 'ops-card regie-car-prephoto-card';
    const modelState = equipment.exactModelConfirmed === true ? 'Modèle façade confirmé' : 'Modèle exact à confirmer';
    section.innerHTML = `<h3><i class="fas fa-clipboard-check"></i> Régie Car — collecte terrain suivante</h3>
      <div class="regie-car-prephoto-tags"><span class="regie-car-prephoto-tag">${esc(modelState)}</span><span class="regie-car-prephoto-tag warn">Aucun port/câble automatique</span></div>
      <p class="regie-car-prephoto-note">Ces captures servent à compléter l’as-built. Une photo reçue reste une preuve terrain en attente de revue ; elle ne devient ni photo constructeur, ni câble, ni crosspoint automatiquement.</p>
      <ul class="regie-car-prephoto-list">${targets.map(item => `<li><span class="regie-car-prephoto-priority">${esc(item.priority)}</span><span><strong>${esc(item.label)}</strong><br><small>${esc(item.captureType)} · ${esc(item.status)}</small></span></li>`).join('')}</ul>`;
    const previous = targetHost.querySelector('.equipment-field-evidence-phase12-card') || targetHost.querySelector('.equipment-field-evidence-card');
    if (previous?.nextSibling) targetHost.insertBefore(section,previous.nextSibling);
    else if (previous) targetHost.appendChild(section);
    else targetHost.prepend(section);
    modal.dataset.regieCarPrephoto = '1';
    return true;
  } finally { delete modal.dataset.regieCarPrephotoBusy; }
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.regieCarPrephotoObserver === '1') return;
  host.dataset.regieCarPrephotoObserver = '1';
  const schedule = modal => {
    queueMicrotask(() => enhanceRegieCarPrephoto360(modal).catch(() => {}));
    setTimeout(() => enhanceRegieCarPrephoto360(modal).catch(() => {}),260);
  };
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule(modal);
    }
  });
  observer.observe(host,{childList:true,subtree:true});
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule(existing);
}

if (typeof window !== 'undefined') {
  window.RegieCarPrephotoReadiness = Object.freeze({
    version:REGIE_CAR_PREPHOTO_VERSION,policy:REGIE_CAR_PREPHOTO_POLICY,
    // Ni les cibles, ni le matériel supplémentaire, ni les sources ne sont republiés sur
    // `window` : ce qui n'est pas servi statiquement ne doit pas redevenir lisible depuis la
    // console d'un poste non autorisé.
    capturePlanId:REGIE_CAR_CAPTURE_PLAN_ID,
    // `gaps` n'est PAS republié : l'état de documentation de l'installation ne doit pas
    // redevenir lisible depuis la console d'un poste non autorisé.
    summarize:summarizeRegieCarPrephotoReadiness,
    ensure:ensureRegieCarPrephotoReadiness,enhance360:enhanceRegieCarPrephoto360
  });
  installObserver();
  await ensureRegieCarPrephotoReadiness().catch(error => console.warn('Préparation Régie Car Phase 17 non initialisée',error));
}
