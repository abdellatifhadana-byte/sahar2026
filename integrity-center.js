import AdminUI from './admin-ui.js';
import { db } from './db.js';
import { getCatalog } from './equipment-knowledge.js';
import { inspectDataIntegrity } from './data-integrity.js';
import { inspectPlatformIntegrity } from './platform-integrity.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const asArray = value => Array.isArray(value) ? value : [];
const PLATFORM_WARNING_KEYS = Object.freeze(['graphConnectionsToConfirm','graphQuarantinedCables']);

const LABELS = Object.freeze({
  rooms:'Salles orphelines',
  baies:'Baies orphelines',
  equipments:'Équipements orphelins',
  walls:'Murs orphelins',
  screens:'Écrans orphelins',
  screenGroups:'Groupes d’écrans',
  catalogLinks:'Liens catalogue invalides',
  inventoryKeys:'Clés inventaire dupliquées',
  equipmentNames:'Noms d’équipements dupliqués',
  moduleHierarchy:'Hiérarchie châssis / cartes',
  equipmentLocations:'Cohérence salle / baie / équipement',
  equipmentConnectivity:'Ports / connectivité équipements',
  cableShape:'Structure des câbles',
  mapTransientImages:'Images temporaires salles / baies',
  mediaInvalidUrls:'Liens média invalides',
  mediaFragileUrls:'Liens média à surveiller',
  topologyEquipmentLinks:'Liens topologie / équipement',
  topologyPhysicalPortLinks:'Liens port grille / port physique',
  diagramReferences:'Références des schémas techniques',
  graphUnresolved:'Références non résolues du graphe',
  screenWallRoomMismatch:'Cohérence écran / mur / salle',
  graphIncompatibleConnections:'Câbles physiquement/logiquement incompatibles',
  graphConnectionsToConfirm:'Compatibilités de câbles à confirmer',
  graphQuarantinedCables:'Câbles en quarantaine'
});

function issueSummary(issue) {
  if (!issue) return 'Anomalie non détaillée';
  if (typeof issue === 'string') return issue;
  if (issue.message) return issue.message;
  if (Array.isArray(issue.errors) && issue.errors.length) return issue.errors.join(' · ');
  if (Array.isArray(issue.reasons) && issue.reasons.length) return `${issue.reference || issue.cableId || 'Connexion'} · ${issue.status || ''} · ${issue.reasons.join(' · ')}`;
  if (issue.reason && (issue.model || issue.catalogId)) return `${issue.model || issue.catalogId} · ${issue.mediaType || 'média'} · ${issue.reason}`;
  if (issue.name || issue.reference) return `${issue.name || issue.reference}${issue.catalogId ? ` · ${issue.catalogId}` : ''}`;
  if (issue.key) return `${issue.key}${Array.isArray(issue.ids) ? ` · IDs: ${issue.ids.join(', ')}` : ''}`;
  try { return JSON.stringify(issue); } catch { return 'Anomalie non détaillée'; }
}

async function inspectMediaCoverage() {
  const [catalog, equipments] = await Promise.all([getCatalog(), db.getAll('equipments')]);
  const coverage = {
    catalogModels:catalog.length,
    officialImages:0,
    candidates:0,
    sourceKnown:0,
    modelRequired:0,
    needsSource:0,
    realPhotoInstances:0,
    realPhotoFiles:0
  };

  for (const record of catalog) {
    const hasOfficial = Boolean(record.officialImage?.url);
    const hasCandidate = asArray(record.candidateImages).some(image => image?.url || image?.src);
    const modelRequired = record.imageResearch?.status === 'model-required' || record.imageResearch?.modelRequired === true;
    const sourceKnown = Boolean(record.imageResearch?.sourcePage);
    if (hasOfficial) coverage.officialImages += 1;
    else if (hasCandidate) coverage.candidates += 1;
    else if (modelRequired) coverage.modelRequired += 1;
    else if (sourceKnown) coverage.sourceKnown += 1;
    else coverage.needsSource += 1;
  }

  for (const equipment of equipments) {
    const images = asArray(equipment.images).filter(Boolean);
    if (images.length) coverage.realPhotoInstances += 1;
    coverage.realPhotoFiles += images.length;
  }
  return coverage;
}

function mergeIntegrityReports(base, platform) {
  const warningKeys = [...new Set([...(base.severity?.warningKeys || []), ...PLATFORM_WARNING_KEYS])];
  const issues = { ...(base.issues || {}), ...(platform.issues || {}) };
  const counts = Object.fromEntries(Object.entries(issues).map(([key, items]) => [key, Array.isArray(items) ? items.length : 0]));
  return {
    ...base,
    valid:Boolean(base.valid) && Boolean(platform.valid),
    issues,
    counts,
    graphHealth:platform.graph,
    severity:{
      blocking:Number(base.severity?.blocking || 0) + Number(platform.blocking || 0),
      warnings:Number(base.severity?.warnings || 0) + Number(platform.warnings || 0),
      warningKeys
    }
  };
}

export class IntegrityCenter {
  constructor(notifications = null) {
    this.notifications = notifications;
    this.report = null;
    this.mediaCoverage = null;
    this.platformAudit = null;
  }

  async load() {
    const [baseReport, mediaCoverage, platformAudit] = await Promise.all([
      inspectDataIntegrity(), inspectMediaCoverage(), inspectPlatformIntegrity()
    ]);
    this.platformAudit = platformAudit;
    this.mediaCoverage = mediaCoverage;
    this.report = mergeIntegrityReports(baseReport, platformAudit);
    return this.report;
  }

  async render() {
    const report = await this.load();
    const inventory = report.inventory || {};
    const media = this.mediaCoverage || {};
    const graph = report.graphHealth || {};
    const warningKeys = new Set(report.severity?.warningKeys || []);
    const issueGroups = Object.entries(report.issues || {}).filter(([, items]) => Array.isArray(items) && items.length);
    const blocking = report.severity?.blocking ?? issueGroups.filter(([key]) => !warningKeys.has(key)).reduce((sum,[,items]) => sum + items.length,0);
    const warnings = report.severity?.warnings ?? issueGroups.filter(([key]) => warningKeys.has(key)).reduce((sum,[,items]) => sum + items.length,0);
    return `<section class="integrity-center" style="display:grid;gap:16px">
      <header class="card" style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div><h2 style="margin:0 0 6px"><i class="fas fa-shield-check"></i> Intégrité des données</h2><p style="margin:0;color:var(--text-muted,#667783)">Contrôle transversal des stores et du graphe canonique: salles, baies, équipements, murs, écrans, catalogue, médias, topologie, schémas, ports et câbles. Aucun correctif automatique n’est appliqué ici.</p></div>
        <button class="btn" id="integrity-refresh"><i class="fas fa-sync-alt"></i> Relancer le contrôle</button>
      </header>

      <section class="card" style="border-left:5px solid ${report.valid ? '#299b59' : '#d99517'}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><strong style="font-size:20px">${report.valid ? 'Base et graphe cohérents' : 'Contrôles requis'}</strong><div style="color:var(--text-muted,#667783);font-size:12px">Dernier contrôle: ${esc(new Date(report.checkedAt).toLocaleString('fr-FR'))}</div></div><div style="display:flex;gap:12px;flex-wrap:wrap"><span style="font-weight:700">${blocking} à corriger</span><span style="font-weight:700;color:#9a6614">${warnings} avertissement(s)</span></div></div>
      </section>

      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${[
          ['Équipements',inventory.equipments ?? 0],
          ['Liés au catalogue',inventory.catalogLinked ?? 0],
          ['Cartes / modules',inventory.moduleCards ?? 0],
          ['Cartes non affectées',inventory.unassignedModuleCards ?? 0],
          ['Quantités à confirmer',inventory.quantityToConfirm ?? 0],
          ['Preuves plan',inventory.planEvidence ?? 0],
          ['Schémas techniques',inventory.technicalDiagrams ?? 0],
          ['Médias à surveiller',inventory.fragileMedia ?? 0],
          ['Images carte temporaires',inventory.transientMapImages ?? 0],
          ['Anomalies localisation',inventory.locationIssues ?? 0],
          ['Ports grille mappés',inventory.mappedTopologyPorts ?? 0]
        ].map(([label,value]) => `<div class="card" style="padding:14px"><strong style="display:block;font-size:24px">${esc(value)}</strong><small>${esc(label)}</small></div>`).join('')}
      </section>

      <section class="card" id="platform-graph-health">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h3 style="margin:0 0 4px"><i class="fas fa-project-diagram"></i> Santé du graphe canonique</h3><p style="margin:0;color:var(--text-muted,#667783);font-size:12px">Mesure le graphe réellement construit à partir des mêmes salles, baies, équipements, ports, câbles, topologie, murs, écrans et schémas.</p></div><strong>${esc(graph.unresolved ?? 0)} référence(s) brute(s) non résolue(s)</strong></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-top:12px">
          ${[
            ['Nœuds',graph.nodes ?? 0],['Arêtes',graph.edges ?? 0],['Liens structurels',graph.structuralEdges ?? 0],
            ['Liens localisation',graph.locationLinks ?? 0],['Ports physiques ↔ grille',graph.physicalRouterPortLinks ?? 0],['Liens schémas',graph.diagramLinks ?? 0]
          ].map(([label,value]) => `<div style="padding:11px;border:1px solid var(--border-color,#e6eaee);border-radius:10px;background:var(--surface-soft,#fafcfd)"><strong style="display:block;font-size:21px">${esc(value)}</strong><small>${esc(label)}</small></div>`).join('')}
        </div>
      </section>

      <section class="card" id="media-coverage-summary">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div><h3 style="margin:0 0 4px"><i class="fas fa-images"></i> Couverture photos & média</h3><p style="margin:0;color:var(--text-muted,#667783);font-size:12px">Les cinq états catalogue ci-dessous sont exclusifs; leur somme correspond au nombre de modèles. Les photos terrain sont comptées séparément par instance.</p></div>
          <strong>${esc(media.catalogModels ?? 0)} modèles catalogue</strong>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-top:12px">
          ${[
            ['Images constructeur',media.officialImages ?? 0],['Visuels candidats',media.candidates ?? 0],
            ['Source officielle connue',media.sourceKnown ?? 0],['Modèle/SKU requis',media.modelRequired ?? 0],
            ['Source à rechercher',media.needsSource ?? 0],['Instances avec photo 2M',media.realPhotoInstances ?? 0],['Photos terrain',media.realPhotoFiles ?? 0]
          ].map(([label,value]) => `<div style="padding:11px;border:1px solid var(--border-color,#e6eaee);border-radius:10px;background:var(--surface-soft,#fafcfd)"><strong style="display:block;font-size:21px">${esc(value)}</strong><small>${esc(label)}</small></div>`).join('')}
        </div>
      </section>

      <section class="card"><h3>Résultats par contrôle</h3><div style="display:grid;gap:8px">${Object.entries(report.counts || {}).map(([key,count]) => {
        const warning = warningKeys.has(key);
        const state = count ? (warning ? `${count} à surveiller` : `${count} à corriger`) : 'OK';
        return `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-color,#e6eaee)"><span>${esc(LABELS[key] || key)}</span><strong style="${warning && count ? 'color:#9a6614' : ''}">${state}</strong></div>`;
      }).join('')}</div></section>

      <section class="card"><h3>Détails des anomalies et avertissements</h3>
        ${issueGroups.length ? issueGroups.map(([key,items]) => {
          const warning = warningKeys.has(key);
          return `<details style="margin:8px 0"><summary style="cursor:pointer;font-weight:700;${warning ? 'color:#9a6614' : ''}">${esc(LABELS[key] || key)} · ${items.length}${warning ? ' · avertissement' : ''}</summary><div style="display:grid;gap:6px;padding:10px 0">${items.slice(0,100).map(item => `<div style="padding:8px;border:1px solid var(--border-color,#e6eaee);border-radius:8px">${esc(issueSummary(item))}</div>`).join('')}${items.length > 100 ? `<small>Affichage limité aux 100 premières anomalies sur ${items.length}.</small>` : ''}</div></details>`;
        }).join('') : '<div style="padding:16px;border:1px dashed var(--border-color,#dbe3ea);border-radius:10px">Aucune anomalie détectée par les contrôles actifs.</div>'}
      </section>
    </section>`;
  }

  async afterRender() {
    document.getElementById('integrity-refresh')?.addEventListener('click', () => this.refresh());
  }

  async refresh() {
    const container = document.getElementById('admin-content');
    if (!container) return;
    try {
      container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Contrôle de cohérence…</p></div>';
      container.innerHTML = await this.render();
      await this.afterRender();
      this.notifications?.showNotification?.('Contrôle d’intégrité terminé.', this.report?.valid ? 'success' : 'warning');
    } catch (error) {
      console.error(error);
      container.innerHTML = `<div class="error-message"><h3>Contrôle impossible</h3><p>${esc(error.message)}</p></div>`;
      this.notifications?.showNotification?.(`Contrôle d’intégrité impossible: ${error.message}`, 'error');
    }
  }
}

const PATCH_FLAG = Symbol.for('2m-tech.integrity-center.admin-patched');
if (!AdminUI.prototype[PATCH_FLAG]) {
  const previous = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithIntegrity() {
    const sections = previous.call(this);
    const ordered = {};
    for (const [key,value] of Object.entries(sections)) {
      if (key === 'settings' && !ordered.integrity) ordered.integrity = { title:'Intégrité', icon:'fas fa-check-double', component:new IntegrityCenter(this.notifications) };
      ordered[key] = value;
    }
    if (!ordered.integrity) ordered.integrity = { title:'Intégrité', icon:'fas fa-check-double', component:new IntegrityCenter(this.notifications) };
    return ordered;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

export default IntegrityCenter;
