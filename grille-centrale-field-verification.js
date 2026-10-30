import { db } from './db.js';
import {
  claimPlatformReferenceInitiation, forgetPlatformReferenceAttempt, sameReferenceContent
} from './platform-reference-contract.js';
import { TOPOLOGY_KINDS, saveTopologyRecord } from './broadcast-topology.js';
import { ensureGrilleCentraleDocumentedMap } from './grille-centrale-documented-map.js';
import { loadGrilleCentraleDataset, peekGrilleCentraleDataset, jetonDOuverture } from './grille-centrale-dataset.js';
import { matchesPublicGrilleIdentity } from './grille-centrale-public-identity.js';

/*
 * CE MODULE NE POSSÉDAIT RIEN, ET C'EST BIEN LE PROBLÈME QU'IL POSAIT (#137).
 *
 * Il importait les ports, les repères GR, les chemins monitoring et les nœuds physiques,
 * puis construisait ses 387 cibles À L'IMPORT. Le calcul suffisait donc à matérialiser tout
 * le plan sur un poste sans session. La checklist se construit désormais à la demande, à
 * partir du jeu de données autorisé, et rend une liste vide quand il n'y en a pas.
 */

export const GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION = 1;
export const GRILLE_CENTRALE_FIELD_PLAN_ID = 'gc-field-verification-plan';
export const GRILLE_CENTRALE_FIELD_EVIDENCE_ORIGIN = 'grille-field-verification';

const ALLOWED_RESULTS = new Set(['verified', 'partial', 'contradicted']);
const ALLOWED_MODES = new Set(['field-photo', 'field-trace', 'label-read', 'continuity-test', 'connector-inspection']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const normalize = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const asArray = value => Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
const now = () => new Date().toISOString();

function makePortTarget(port) {
  const prefix = port.direction === 'INPUT' ? 'IN' : 'OUT';
  return Object.freeze({
    id:`gc-field-port-${port.id}`,
    category:'ROUTER_PORT_PHYSICAL_MAPPING',
    label:`${prefix}.${port.portNumber} · ${port.logicalAlias}`,
    sourceRecordId:port.id,
    expectedEvidence:Object.freeze(['rear connector / panel label', 'GR or cable reference', 'field photo or trace']),
    documentaryStatus:'2M-synoptic-confirmed',
    asBuiltStatus:'to-confirm'
  });
}

function makeGrTarget(observation) {
  return Object.freeze({
    id:`gc-field-gr-${observation.id}`,
    category:'GR_PATCH_PAIR',
    label:`${observation.routerPort} · ${observation.nearRef} ↔ ${observation.farRef}`,
    sourceRecordId:observation.id,
    expectedEvidence:Object.freeze(['photo lisible des deux repères', 'panneau/position', 'continuité ou trace physique si disponible']),
    documentaryStatus:observation.pairEvidence,
    asBuiltStatus:'to-confirm'
  });
}

function makeMonitoringTarget(path) {
  return Object.freeze({
    id:`gc-field-monitoring-${path.id}`,
    category:'MONITORING_CURRENT_PATH',
    label:`${path.output} · ${path.grNear} → ${path.grFar} → ${path.destination.equipment}`,
    sourceRecordId:path.id,
    expectedEvidence:Object.freeze(['connecteur source actuel', 'repères câble actuels', 'destination physique actuelle', 'continuité si testée']),
    documentaryStatus:path.designMapping,
    asBuiltStatus:path.currentPhysicalCableVerified ? 'verified' : 'to-confirm'
  });
}

/**
 * La checklist terrain, construite à la demande depuis le jeu de données autorisé.
 *
 * Rend `[]` sans autorisation : une checklist vide ne dit rien du site, alors qu'une
 * checklist complète le décrit port par port.
 */
export async function grilleCentraleFieldTargets({ revalidate = false, ouverture = null } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  return dataset ? buildFieldTargets(dataset) : [];
}

function buildFieldTargets(dataset) {
  return Object.freeze([
    ...dataset.documentedPorts.map(makePortTarget),
    ...dataset.grObservations.map(makeGrTarget),
    ...dataset.monitoringPaths.map(makeMonitoringTarget),
    ...dataset.physicalFactTargets
  ]);
}

/**
 * Les cibles déjà en mémoire — vide tant que le jeu de données n'a pas été obtenu.
 *
 * `peek` rend `null` dès que la portée d'accès a changé : une checklist ne survit donc pas
 * à une révocation, même sans nouvelle requête.
 */
function targetsNow() {
  const dataset = peekGrilleCentraleDataset();
  return dataset ? buildFieldTargets(dataset) : [];
}

function targetById(id) {
  return targetsNow().find(target => target.id === String(id || '')) || null;
}

export const GRILLE_CENTRALE_FIELD_POLICY = Object.freeze({
  documentaryBaselineImmutable:true,
  document2012NeverEqualsCurrentAsBuilt:true,
  fieldPhotoFamilyIdentityNeverEqualsRearPortMapping:true,
  noActiveCrosspointInference:true,
  verifiedRequiresExplicitCurrentFieldEvidence:true,
  contradictedEvidenceNeverDeletesHistoricalDocument:true,
  sourceLayers:Object.freeze(['design-2012', 'field-evidence', 'current-as-built', 'live-routing'])
});

function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true;
}

/**
 * LE PLAN DE VÉRIFICATION EST UNE RÉFÉRENCE DE PLATEFORME.
 *
 * Il n'appartient à aucune zone. Un rôle à périmètre ne le voit donc jamais dans son
 * instantané — et l'écrivain en concluait qu'il fallait le créer. Le serveur refusait, à
 * juste titre ; le retour arrière effaçait la tentative ; l'événement suivant retrouvait
 * `current = null` et recommençait. Mesuré sur une session immobile de soixante secondes :
 * une quarantaine d'écritures et autant d'échecs en file, sans qu'on ait touché à rien.
 *
 * Son contenu est entièrement calculable ici : cibles, catégories et politique sont des
 * constantes de ce module. Un rôle à périmètre n'a donc RIEN à écrire pour afficher le
 * plan — il lui suffit de le lire, ou de le calculer quand il n'est pas visible.
 */
async function ensurePlanRecord() {
  const current = await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID).catch(() => null);
  if (current && adminLocked(current)) return { record:current, protected:true, updated:false };
  const next = {
    ...(current || {}),
    id:GRILLE_CENTRALE_FIELD_PLAN_ID,
    kind:'grille_field_verification_plan',
    targetType:'router',
    routerId:'router-grille-centrale-190x184',
    title:'Grille Centrale — plan de vérification terrain / as-built',
    targetCount:targetsNow().length,
    categories:[...new Set(targetsNow().map(item => item.category))],
    policy:GRILLE_CENTRALE_FIELD_POLICY,
    baseline:'design-2012-plus-existing-field-photos',
    baselineAsBuiltClaim:false,
    status:'ready-for-field-verification',
    origin:GRILLE_CENTRALE_FIELD_EVIDENCE_ORIGIN,
    version:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION,
    updatedAt:now(),
    createdAt:current?.createdAt || now()
  };
  // Comparaison PAR VALEUR, et non par texte sérialisé : PostgreSQL renormalise l'ordre des
  // clés du `jsonb`, si bien que `JSON.stringify` voyait une différence là où il n'y en avait
  // aucune — et faisait réécrire le document à chaque instantané, sans fin.
  const updated = !current || !sameReferenceContent(
    { ...current, updatedAt:undefined },
    { ...next, updatedAt:undefined }
  );
  if (!updated) return { record:current, protected:false, updated:false, initiated:false };

  // Une session sans autorité centrale LIT le plan et s'en tient là. Elle sert ce qu'elle
  // a reçu du serveur ; à défaut, la version calculée ici — qui affiche exactement la même
  // chose sans rien écrire.
  if (!claimPlatformReferenceInitiation(GRILLE_CENTRALE_FIELD_PLAN_ID)) {
    return { record:current || next, protected:false, updated:false, initiated:false };
  }

  // `claim` a retenu la tentative AVANT l'écriture : si le serveur la refuse, l'événement
  // suivant ne la rejouera pas. C'est un rechargement — donc un geste humain — qui rouvrira
  // la possibilité de réessayer.
  await db.save('docs', next);
  forgetPlatformReferenceAttempt(GRILLE_CENTRALE_FIELD_PLAN_ID);
  return { record:next, protected:false, updated:true, initiated:true };
}

export function validateGrilleCentraleFieldEvidence(input = {}) {
  const errors = [];
  const target = targetById(input.targetId);
  const result = String(input.result || '').trim().toLowerCase();
  const verificationMode = String(input.verificationMode || '').trim().toLowerCase();
  const observedAt = String(input.observedAt || '').trim();
  const sourceRef = String(input.sourceRef || '').trim();
  const assetRefs = asArray(input.assetRefs).map(String).map(item => item.trim()).filter(Boolean);
  const claims = asArray(input.claims).map(String).map(item => item.trim()).filter(Boolean);

  if (!target) errors.push('Cible de vérification Grille Centrale inconnue.');
  if (!ALLOWED_RESULTS.has(result)) errors.push('Résultat terrain invalide.');
  if (!ALLOWED_MODES.has(verificationMode)) errors.push('Mode de preuve terrain invalide.');
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push('La date/heure d’observation terrain est obligatoire.');
  if (!sourceRef && !assetRefs.length) errors.push('Une référence de preuve ou un média terrain est obligatoire.');
  if (!claims.length) errors.push('Au moins un fait observé explicitement doit être renseigné.');
  if (/2012|dt\/eh\/11\/2011|synoptique/i.test(sourceRef) && !assetRefs.length) errors.push('Le synoptique 2012 seul ne peut pas vérifier l’as-built actuel.');

  return { valid:errors.length === 0, errors, target, normalized:{ result, verificationMode, observedAt, sourceRef, assetRefs, claims } };
}

export async function registerGrilleCentraleFieldEvidence(input = {}) {
  await ensureGrilleCentraleDocumentedMap();
  await db.open();
  const checked = validateGrilleCentraleFieldEvidence(input);
  if (!checked.valid) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_GRILLE_FIELD_EVIDENCE';
    error.details = checked.errors;
    throw error;
  }
  const { target, normalized } = checked;
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const id = input.id || `gc-field-evidence-${suffix}`;
  return saveTopologyRecord(TOPOLOGY_KINDS.EVIDENCE, {
    id,
    sourceType:normalized.verificationMode,
    sourceRef:normalized.sourceRef || normalized.assetRefs.join(', '),
    title:`Vérification terrain · ${target.label}`,
    fieldVerificationTargetId:target.id,
    fieldVerificationCategory:target.category,
    fieldVerificationResult:normalized.result,
    currentAsBuiltEvidence:true,
    observedAt:normalized.observedAt,
    assetRefs:normalized.assetRefs,
    claims:normalized.claims,
    notes:String(input.notes || '').trim(),
    observer:String(input.observer || '').trim(),
    verificationStatus:normalized.result === 'verified' ? 'verified' : 'documented',
    confidence:normalized.result === 'verified' ? 'high' : 'medium',
    origin:GRILLE_CENTRALE_FIELD_EVIDENCE_ORIGIN,
    grilleCentraleFieldVerificationVersion:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION
  });
}

function evidenceRank(result) {
  if (result === 'contradicted') return 3;
  if (result === 'verified') return 2;
  if (result === 'partial') return 1;
  return 0;
}

export async function buildGrilleCentraleFieldVerificationSnapshot(dataset = null, { persister = true } = {}) {
  await ensureGrilleCentraleDocumentedMap({ persister });
  await db.open();
  // En consultation, le plan est LU. S'il n'existe pas encore, la checklist s'appuiera sur
  // les cibles connues : c'est l'ensemencement du démarrage qui le pose, pas une lecture.
  if (persister) await ensurePlanRecord();
  const docs = await db.getAll('docs');
  const evidence = docs.filter(item => item?.kind === TOPOLOGY_KINDS.EVIDENCE && item.currentAsBuiltEvidence === true && Boolean(targetById(item.fieldVerificationTargetId)));
  const evidenceByTarget = new Map();
  for (const item of evidence) {
    const key = String(item.fieldVerificationTargetId);
    const list = evidenceByTarget.get(key) || [];
    list.push(item);
    evidenceByTarget.set(key, list);
  }

  const targets = (dataset ? buildFieldTargets(dataset) : targetsNow()).map(target => {
    const proofs = (evidenceByTarget.get(target.id) || []).sort((a,b) => String(b.observedAt || '').localeCompare(String(a.observedAt || '')));
    let latest = null;
    for (const proof of proofs) {
      if (!latest || evidenceRank(proof.fieldVerificationResult) > evidenceRank(latest.fieldVerificationResult)) latest = proof;
    }
    const result = latest?.fieldVerificationResult || (target.asBuiltStatus === 'verified' ? 'verified' : 'pending');
    return { ...target, result, evidenceCount:proofs.length, latestEvidence:latest || null };
  });

  const counts = targets.reduce((acc,item) => {
    acc.total += 1;
    acc[item.result] = (acc[item.result] || 0) + 1;
    return acc;
  }, { total:0, pending:0, verified:0, partial:0, contradicted:0 });
  const categories = [...new Set(targets.map(item => item.category))].map(category => {
    const rows = targets.filter(item => item.category === category);
    return { category, total:rows.length, verified:rows.filter(item => item.result === 'verified').length, pending:rows.filter(item => item.result === 'pending').length, partial:rows.filter(item => item.result === 'partial').length, contradicted:rows.filter(item => item.result === 'contradicted').length };
  });
  return { version:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION, counts, categories, targets, evidence, policy:GRILLE_CENTRALE_FIELD_POLICY };
}


/*
 * CONSULTER N'EST PAS ENSEMENCER (#108).
 *
 * Ce module est monté par un MutationObserver sur `#app` : il se réveille dès qu'une fiche
 * 360 y est insérée. Tant qu'il appelait l'ensemencement complet à ce réveil, OUVRIR une
 * fiche en lecture seule écrivait — dix ouvertures de la MÊME fiche produisaient 974 PUT,
 * sans la moindre intention de l'utilisateur.
 *
 * `persister:false` sépare les deux moitiés que cette fonction confondait : la
 * revalidation d'autorisation auprès du serveur (#137), qui DOIT rester — une habilitation
 * peut avoir été retirée depuis le chargement — et l'ensemencement, qui n'appartient qu'au
 * démarrage et aux workflows explicites. La consultation lit et rend ce qui existe ; elle
 * ne crée rien. Rien n'est masqué : l'ensemencement garde exactement le même code.
 */
export async function ensureGrilleCentraleFieldVerification({ revalidate = false, ouverture = null, persister = true } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  if (!dataset) return { authorized:false, counts:{}, targets:[], plan:null };
  if (!persister) {
    await db.open();
    const planLu = await db.get('docs', GRILLE_CENTRALE_FIELD_PLAN_ID).catch(() => null);
    const vue = await buildGrilleCentraleFieldVerificationSnapshot(dataset, { persister:false });
    return { authorized:true, ...vue, plan:planLu };
  }
  await ensureGrilleCentraleDocumentedMap({ revalidate, ouverture });
  await db.open();
  const plan = await ensurePlanRecord();
  const snapshot = await buildGrilleCentraleFieldVerificationSnapshot(dataset);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('grille-centrale-field-verification-updated', { detail:{ version:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION, ...snapshot.counts } }));
  return { authorized:true, ...snapshot, plan:plan.record };
}

/*
 * L'IDENTITÉ EST DÉCIDÉE AILLEURS, UNE SEULE FOIS (#166).
 *
 * Ce filtre existait ici en quatre exemplaires légèrement différents — l'un lisait
 * `inventorySource.name` sans `reference`, les autres l'inverse — et le serveur, qui doit
 * s'aligner sur eux pour ne pas autoriser ce qu'ils n'afficheront pas, ne pouvait s'aligner
 * que sur une partie. `grille-centrale-public-identity.js` porte désormais la réponse, et
 * les quatre panneaux comme la vérification serveur l'appellent.
 */
const grilleEquipmentMatches = matchesPublicGrilleIdentity;


function installStyles() {
  if (document.getElementById('gc-field-verification-styles')) return;
  const style = document.createElement('style');
  style.id = 'gc-field-verification-styles';
  style.textContent = `.gc-field-facts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:10px 0}.gc-field-fact{border:1px solid var(--border,#dce4e8);border-radius:10px;padding:8px;background:var(--surface,#fff)}.gc-field-fact small{display:block;color:var(--text-muted,#667783);font-size:10px}.gc-field-fact strong{font-size:16px}.gc-field-controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.gc-field-controls input,.gc-field-controls select{padding:8px;border:1px solid var(--border,#dce4e8);border-radius:8px;background:var(--surface,#fff);color:inherit}.gc-field-controls input{flex:1;min-width:210px}.gc-field-list{display:grid;gap:5px;max-height:380px;overflow:auto}.gc-field-row{padding:7px 9px;border-radius:8px;background:rgba(127,140,141,.08);display:grid;gap:2px}.gc-field-row strong{font-size:11px}.gc-field-row small{font-size:10px;color:var(--text-muted,#667783)}.gc-field-row[data-result="verified"]{border-left:3px solid #27ae60}.gc-field-row[data-result="partial"]{border-left:3px solid #f39c12}.gc-field-row[data-result="contradicted"]{border-left:3px solid #c0392b}.gc-field-policy{font-size:10px;line-height:1.5;padding:8px;border-radius:8px;background:rgba(142,68,173,.08);margin-top:8px}@media(max-width:780px){.gc-field-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  document.head.appendChild(style);
}

function exportChecklist(snapshot) {
  const payload = {
    format:'2m-tech-grille-centrale-field-checklist',
    version:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION,
    exportedAt:now(),
    policy:snapshot.policy,
    counts:snapshot.counts,
    targets:snapshot.targets.map(({ latestEvidence: _latestEvidence, ...target }) => target)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `grille-centrale-field-checklist-${new Date().toISOString().slice(0,10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindControls(section, snapshot) {
  const search = section.querySelector('[data-gc-field-search]');
  const status = section.querySelector('[data-gc-field-status]');
  const rows = [...section.querySelectorAll('.gc-field-row')];
  const apply = () => {
    const query = normalize(search?.value || '');
    const statusValue = String(status?.value || 'all');
    let shown = 0;
    for (const row of rows) {
      const matchesQuery = !query || row.dataset.search.includes(query);
      const matchesStatus = statusValue === 'all' || row.dataset.result === statusValue;
      const visible = matchesQuery && matchesStatus && shown < 100;
      row.hidden = !visible;
      if (visible) shown += 1;
    }
    const counter = section.querySelector('[data-gc-field-result-count]');
    if (counter) counter.textContent = `${shown} cible(s) affichée(s) · maximum 100`;
  };
  search?.addEventListener('input', apply);
  status?.addEventListener('change', apply);
  section.querySelector('[data-gc-field-export]')?.addEventListener('click', () => exportChecklist(snapshot));
  apply();
}

export async function enhanceGrilleCentraleFieldVerification360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.gcFieldVerification === '1' || modal.dataset.gcFieldVerificationBusy === '1') return false;
  modal.dataset.gcFieldVerificationBusy = '1';
  try {
    let equipment = null;
    const id = String(modal.dataset.equipmentId || '').trim();
    if (id) equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id).catch(() => null);
    if (!equipment) {
      const name = modal.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
      if (name) {
        const matches = (await db.getAll('equipments')).filter(item => normalize(item.name || item.nom || '') === normalize(name));
        if (matches.length === 1) equipment = matches[0];
      }
    }
    if (!equipment || !grilleEquipmentMatches(equipment)) return false;
  /*
   * OUVRIR UN ÉCRAN REDEMANDE AU SERVEUR (#137).
   *
   * Une habilitation peut avoir été retirée depuis le chargement du jeu de données, sans
   * déconnexion ni rechargement. La mémoire de l'onglet ne décide donc pas ici.
   */
    const snapshot = await ensureGrilleCentraleFieldVerification({ revalidate:true, ouverture:jetonDOuverture(modal), persister:false });
    // Hors périmètre : pas de checklist. Un compteur « 0 / 387 » enseignerait déjà la taille
    // du plan, et des cibles grisées la composition du site.
    if (!snapshot.authorized) return false;
    installStyles();
    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;

    const rows = snapshot.targets.map(item => `<div class="gc-field-row" data-result="${esc(item.result)}" data-search="${esc(normalize(`${item.label} ${item.category} ${item.documentaryStatus} ${item.result}`))}"><strong>${esc(item.label)}</strong><small>${esc(item.category)} · document: ${esc(item.documentaryStatus)} · as-built: ${esc(item.result)} · preuves actuelles: ${esc(item.evidenceCount)}</small></div>`).join('');
    const section = document.createElement('section');
    section.className = 'ops-card grille-centrale-field-verification-card';
    section.innerHTML = `<h3><i class="fas fa-clipboard-check"></i> Vérification terrain / As-Built</h3><p class="ops-card-sub">Checklist dérivée du plan 2012 et des photos terrain existantes. Une cible reste « pending » tant qu’une preuve actuelle explicite n’a pas été enregistrée.</p><div class="gc-field-facts"><div class="gc-field-fact"><small>Total à tracer</small><strong>${esc(snapshot.counts.total)}</strong></div><div class="gc-field-fact"><small>Vérifié terrain</small><strong>${esc(snapshot.counts.verified)}</strong></div><div class="gc-field-fact"><small>Partiel</small><strong>${esc(snapshot.counts.partial)}</strong></div><div class="gc-field-fact"><small>Contradiction</small><strong>${esc(snapshot.counts.contradicted)}</strong></div><div class="gc-field-fact"><small>À confirmer</small><strong>${esc(snapshot.counts.pending)}</strong></div></div><div class="gc-field-controls"><input data-gc-field-search placeholder="Rechercher une cible, un repère ou une catégorie…" autocomplete="off"><select data-gc-field-status><option value="all">Tous les statuts</option><option value="pending">À confirmer</option><option value="verified">Vérifié</option><option value="partial">Partiel</option><option value="contradicted">Contradiction</option></select><button type="button" class="btn btn-sm" data-gc-field-export><i class="fas fa-download"></i> Export checklist</button></div><small data-gc-field-result-count></small><div class="gc-field-list">${rows}</div><div class="gc-field-policy"><strong>Frontière de preuve :</strong> le design 2012 reste historique, les photos de façade confirment uniquement ce qu’elles montrent, l’as-built exige une preuve terrain actuelle, et aucun crosspoint live n’est déduit. Une contradiction terrain est conservée à côté du document historique : elle ne l’efface pas.</div>`;
    const documented = target.querySelector('.grille-centrale-documented-map-card');
    if (documented?.nextSibling) target.insertBefore(section, documented.nextSibling);
    else target.appendChild(section);
    bindControls(section, snapshot);
    modal.dataset.gcFieldVerification = '1';
    return true;
  } finally {
    delete modal.dataset.gcFieldVerificationBusy;
  }
}

let reconcileTimer = null;
function scheduleReconcile(delay = 1500) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureGrilleCentraleFieldVerification().catch(error => console.warn('Vérification terrain Grille Centrale indisponible', error)), delay);
}

function schedule360(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceGrilleCentraleFieldVerification360(modal).catch(() => {}));
  setTimeout(() => enhanceGrilleCentraleFieldVerification360(modal).catch(() => {}), 500);
  setTimeout(() => enhanceGrilleCentraleFieldVerification360(modal).catch(() => {}), 1500);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.gcFieldVerificationObserver === '1') return;
  host.dataset.gcFieldVerificationObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
      if (modal) schedule360(modal);
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360(existing);
}

if (typeof window !== 'undefined') {
  window.GrilleCentraleFieldVerification = Object.freeze({
    version:GRILLE_CENTRALE_FIELD_VERIFICATION_VERSION,
    targets:grilleCentraleFieldTargets,
    policy:GRILLE_CENTRALE_FIELD_POLICY,
    validate:validateGrilleCentraleFieldEvidence,
    register:registerGrilleCentraleFieldEvidence,
    snapshot:buildGrilleCentraleFieldVerificationSnapshot,
    ensure:ensureGrilleCentraleFieldVerification,
    enhance360:enhanceGrilleCentraleFieldVerification360
  });
  installObserver();
  window.addEventListener('grille-centrale-documented-map-updated', () => scheduleReconcile(600));
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') scheduleReconcile(800); });
  scheduleReconcile(3200);
}
