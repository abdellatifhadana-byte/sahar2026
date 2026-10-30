import { db } from './db.js';
import Equipements from './equipements.js';
import AdminUI from './admin-ui.js';
import { getCurrentUser } from './security.js';
import { enrichCatalogKnowledge } from './equipment-knowledge-packs.js';
import { KNOWLEDGE_PROFILES, inferKnowledgeProfile } from './equipment-knowledge-contract.js';
import { catalogPortTemplate, defaultSelection, buildPortsFromTemplate, SCOPE_LABELS } from './equipment-port-template.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';
import { attendreDecisionSync } from './central-sync-decision.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char] || char));
const safeExternalUrl = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
};
const documentationLink = item => {
  const url = safeExternalUrl(item?.documentationUrl);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Documentation</a>` : '<span class="kb-muted">Interne / à compléter</span>';
};
const CATALOG_KIND = 'equipment_catalog';
const VERIFIED_AT = '2026-08-13';

// Catalogue initial volontairement conservateur : on ne renseigne un modèle précis
// que lorsqu'il est lisible sur les photos ou vérifiable dans une documentation fabricant.
// Les familles encore incertaines restent explicitement « à confirmer ».
const INITIAL_CATALOG = [
  {
    id:'kb-ross-ultrix', manufacturer:'Ross Video', model:'Ultrix', family:'Ultrix',
    type:'Routeur / matrice et traitement média', category:'Vidéo / Broadcast',
    summary:'Plateforme de routage et de traitement média hyperconvergée. Le format exact du châssis et les cartes installées doivent être confirmés sur site.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://www.rossvideo.com/products/routing-systems/ultrix/',
    sourceNote:'Marque et famille lisibles sur les racks RF. Documentation fabricant Ross Video.',
    portsNote:'Les E/S dépendent du châssis et des cartes installées : relever les ports réels avant de créer les liaisons.'
  },
  {
    id:'kb-ross-opengear-ogx', manufacturer:'Ross Video', model:'oGx Frame', family:'openGear',
    type:'Châssis modulaire de traitement', category:'Vidéo / Broadcast',
    summary:'Châssis openGear 2RU pour cartes de traitement modulaires. La composition interne doit être inventoriée carte par carte.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://www.rossvideo.com/products/signal-processing/opengear/frames-accessories/ogx-frame/',
    sourceNote:'openGear/oGx visible sur plusieurs racks. Documentation fabricant Ross Video.',
    portsNote:'Les connectiques dépendent des rear modules et des cartes installées.'
  },
  {
    id:'kb-imagine-platinum-vx', manufacturer:'Imagine Communications', model:'Platinum VX', family:'Platinum',
    type:'Routeur vidéo', category:'Vidéo / Broadcast',
    summary:'Routeur vidéo destiné aux déploiements de petite à moyenne taille. La taille de matrice installée doit être confirmée sur site.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://imaginecommunications.com/insights-and-resources/platinum-vx/',
    sourceNote:'Platinum VX lisible sur le rack. Documentation fabricant Imagine Communications.'
  },
  {
    id:'kb-leader-lt4448', manufacturer:'Leader Electronics', model:'LT 4448', family:'LT',
    type:'Changeover / redondance de synchronisation', category:'Contrôle / Mesure / Monitoring',
    summary:'Changeover pour basculement automatique entre deux sources de référence. Le câblage et la source primaire/secours doivent être documentés sur site.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
    sourceNote:'Référence LT4448 lisible sur B01.RF2 et confirmée par Leader.'
  },
  {
    id:'kb-leader-lv5350', manufacturer:'Leader Electronics', model:'LV5350', family:'ZEN',
    type:'Waveform monitor / analyse vidéo-audio', category:'Contrôle / Mesure / Monitoring',
    summary:'Moniteur de forme d’onde avec écran 7 pouces pour analyse des signaux SDI. Options et configuration exacte à relever sur l’équipement.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
    sourceNote:'Référence LV5350 lisible sur B01.RF2 et confirmée par Leader.'
  },
  {
    id:'kb-avid-nexis', manufacturer:'Avid', model:'NEXIS', family:'NEXIS',
    type:'Stockage média partagé', category:'Réseau / IT',
    summary:'Plateforme de stockage partagé pour workflows média. Le modèle exact du moteur/châssis et sa capacité restent à confirmer sur site.',
    verificationStatus:'verified-family', confidence:'high', observed:true,
    documentationUrl:'https://www.avid.com/products/avid-nexis',
    sourceNote:'Avid NEXIS lisible dans les racks Conformité. Famille confirmée, variante exacte à relever.'
  },
  {
    id:'kb-avid-airspeed', manufacturer:'Avid', model:'AirSpeed — modèle à confirmer', family:'AirSpeed',
    type:'Serveur vidéo ingest / playout', category:'Diffusion / Playout',
    summary:'Famille de serveurs vidéo Avid. La façade observée est compatible avec la famille AirSpeed, mais le modèle exact doit être relevé sur l’étiquette ou l’interface système.',
    verificationStatus:'to-confirm', confidence:'medium', observed:true,
    documentationUrl:'https://www.avid.com/support/airspeed-5500',
    sourceNote:'Famille probable d’après la façade Avid dans Conformité/Pool. Ne pas attribuer 5000 ou 5500 sans vérification locale.'
  },
  {
    id:'kb-hp-z440', manufacturer:'HP', model:'Z440 Workstation', family:'Z Workstation',
    type:'Station de travail', category:'Poste de travail / Bureautique',
    summary:'Station de travail HP Z440. La configuration CPU/RAM/GPU/stockage est propre à chaque machine et doit rester dans la fiche de l’instance.',
    verificationStatus:'verified', confidence:'high', observed:true,
    documentationUrl:'https://support.hp.com/us-en/product/setup-user-guides/hp-z440-workstation/6978828',
    sourceNote:'Z440 lisible sur plusieurs postes du rack Pool 1-BVU. Documentation HP.'
  },
  {
    id:'kb-dell-poweredge', manufacturer:'Dell', model:'PowerEdge — modèle à confirmer', family:'PowerEdge',
    type:'Serveur rack', category:'Réseau / IT',
    summary:'Serveur Dell PowerEdge. Plusieurs unités sont visibles ; la génération et le modèle précis doivent être relevés sur Service Tag / façade / iDRAC.',
    verificationStatus:'to-confirm', confidence:'high', observed:true,
    sourceNote:'Marque Dell et format PowerEdge visibles sur les racks RF.'
  },
  {
    id:'kb-lenovo-thinkstation', manufacturer:'Lenovo', model:'ThinkStation — modèle à confirmer', family:'ThinkStation',
    type:'Station de travail', category:'Poste de travail / Bureautique',
    summary:'Workstation Lenovo ThinkStation observée dans les racks Conformité. Modèle précis à relever.',
    verificationStatus:'to-confirm', confidence:'high', observed:true,
    sourceNote:'Marquage ThinkStation visible sur les machines Conformité.'
  },
  {
    id:'kb-raritan-kvm', manufacturer:'Raritan', model:'KVM — modèle à confirmer', family:'KVM',
    type:'KVM / console de gestion', category:'Réseau / IT',
    summary:'Équipement KVM Raritan observé dans plusieurs racks. La gamme et le modèle exacts restent à relever sur l’étiquette.',
    verificationStatus:'to-confirm', confidence:'high', observed:true,
    sourceNote:'Marque Raritan lisible sur plusieurs unités rack.'
  },
  {
    id:'kb-blackbox-servview', manufacturer:'Black Box', model:'ServView — modèle à confirmer', family:'ServView',
    type:'Console KVM', category:'Réseau / IT',
    summary:'Console KVM rackable Black Box ServView. Référence exacte à relever sur la plaque produit.',
    verificationStatus:'verified-family', confidence:'high', observed:true,
    sourceNote:'Black Box ServView lisible dans POOL 0.'
  },
  {
    id:'kb-miranda-kaleido-alto', manufacturer:'Miranda / Grass Valley', model:'Kaleido-Alto', family:'Kaleido',
    type:'Multiviewer', category:'Contrôle / Mesure / Monitoring',
    summary:'Équipement multiviewer de la famille Kaleido. Configuration d’entrées/sorties à relever sur site.',
    verificationStatus:'verified-family', confidence:'high', observed:true,
    documentationUrl:'https://www.grassvalley.com/trademarks/',
    sourceNote:'Kaleido ALTO et Miranda lisibles sur POOL 0 ; la famille est référencée par Grass Valley.'
  },
  {
    id:'kb-miranda-kaleido-quad', manufacturer:'Miranda / Grass Valley', model:'Kaleido-QUAD', family:'Kaleido',
    type:'Multiviewer / quad split', category:'Contrôle / Mesure / Monitoring',
    summary:'Unité Kaleido-QUAD observée en plusieurs exemplaires dans POOL 0. Les options exactes doivent être relevées localement.',
    verificationStatus:'verified-family', confidence:'high', observed:true,
    documentationUrl:'https://www.grassvalley.com/trademarks/',
    sourceNote:'Kaleido QUAD et Miranda lisibles sur POOL 0.'
  },
  {
    id:'kb-harmonic-spectrum', manufacturer:'Harmonic', model:'Spectrum — modèle à confirmer', family:'Spectrum',
    type:'Serveur média / ingest / playout', category:'Diffusion / Playout',
    summary:'Famille Harmonic Spectrum de serveurs média. Le modèle exact (MediaCenter, Spectrum X ou autre) doit être confirmé sur l’équipement.',
    verificationStatus:'to-confirm', confidence:'medium', observed:true,
    documentationUrl:'https://www.harmonicinc.com/video-streaming/spectrum/',
    sourceNote:'Marquage Harmonic/Spectrum visible sur rack RF ; variante exacte non lisible.'
  },
  {
    id:'kb-tsl-tallyman', manufacturer:'TSL Products', model:'TallyMan — modèle à confirmer', family:'TallyMan',
    type:'Contrôleur tally / broadcast control', category:'Contrôle / Mesure / Monitoring',
    summary:'Système de contrôle broadcast TSL TallyMan. Les contrôleurs exacts (TM1/TM2/…) doivent être vérifiés unité par unité.',
    verificationStatus:'verified-family', confidence:'medium', observed:true,
    documentationUrl:'https://www.tslproducts.com/products/control-solutions/tallyman-control-system-overview/',
    sourceNote:'Unités TSL visibles sur B01.RF2 ; famille TallyMan à confirmer pour chaque unité.'
  },
  {
    id:'kb-sony-monitor-broadcast', manufacturer:'Sony', model:'Moniteur broadcast — modèle à confirmer', family:'Professional Monitor',
    type:'Moniteur vidéo broadcast', category:'Affichage / Moniteurs',
    summary:'Moniteur Sony professionnel observé dans plusieurs racks. Taille et modèle exacts doivent être relevés sur la plaque arrière.',
    verificationStatus:'to-confirm', confidence:'high', observed:true,
    sourceNote:'Marque Sony clairement visible ; modèle non lisible sur les photos actuelles.'
  },
  {
    id:'kb-sony-vtr', manufacturer:'Sony', model:'VTR / deck — modèle à confirmer', family:'Professional VTR',
    type:'VTR / lecture-enregistrement vidéo', category:'Diffusion / Playout',
    summary:'Deck/VTR Sony professionnel observé dans POOL 0/POOL 1. Le modèle et le format exacts doivent être relevés sur la façade.',
    verificationStatus:'to-confirm', confidence:'high', observed:true,
    sourceNote:'Marque Sony et fonction deck/VTR visibles ; modèle exact non suffisamment lisible.'
  },
  {
    id:'kb-dell-monitor-29', manufacturer:'Dell', model:'Moniteur 29 pouces — modèle à confirmer', family:'UltraWide / Professional Monitor',
    type:'Écran poste opérateur', category:'Affichage / Moniteurs',
    summary:'Référence générique créée pour les écrans Dell 29 pouces utilisés avec des noms d’exploitation tels que NACQ1/NACQ2. Le modèle exact doit être relevé sur la plaque arrière ou l’OSD.',
    verificationStatus:'to-confirm', confidence:'medium', observed:false,
    sourceNote:'Type fourni par l’exploitation ; le modèle Dell exact reste à compléter.'
  }
].map(item => ({
  ...item,
  kind: CATALOG_KIND,
  targetType: CATALOG_KIND,
  targetId: item.id,
  origin: 'seed',
  verifiedAt: VERIFIED_AT,
  updatedAt: VERIFIED_AT,
  visibility: 'all-non-sensitive'
}));

/*
 * NE PAS LIRE `docs` AVANT QUE LA BASCULE CENTRALE SOIT TRANCHÉE (#165, famille #162/#98).
 *
 * Une revue indépendante a demandé la preuve du scénario « central CHAUD, IndexedDB local
 * FROID » : PostgreSQL contient déjà tout le catalogue, mais l'utilisateur arrive d'un
 * profil neuf. Mesuré sur cet exact scénario, AVANT cette barrière :
 *
 *   première écriture d'ensemencement    t+587 ms
 *   première preuve d'instantané appliqué t+1182 ms
 *   → 70 écritures d'ensemencement, toutes AVANT la preuve,
 *     toutes sur des fiches DÉJÀ présentes côté serveur,
 *     4 révisions serveur montées sans le moindre geste utilisateur.
 *
 * Un `docs` local encore vide n'est pas un catalogue manquant : c'est un instantané qui
 * n'est pas encore arrivé. Décider « ce qui manque » avant cette preuve, c'est recréer
 * spéculativement ce que le central possède déjà — la cause exacte de #162/#98.
 *
 * `withCatalogEnrichmentGate` ne répond PAS à cette question : il sérialise les
 * producteurs de catalogue ENTRE EUX, il n'attend pas le central. La barrière utilisée ici
 * est celle que le module frère `equipment-knowledge-extra.js` applique déjà à
 * `seedExtraCatalog()`, importée plutôt que recopiée — le dépôt en compte déjà deux
 * exemplaires, comparés l'un à l'autre par `tests/equipment-knowledge-extra.test.js`.
 *
 * PROPRIÉTÉ : ce module ne pose QUE `INITIAL_CATALOG`.
 * `EXTRA_EQUIPMENT_CATALOG` a son propre propriétaire de démarrage,
 * `equipment-knowledge-extra.js::seedExtraCatalog()`, qui le dédoublonne en plus par clé
 * sémantique (constructeur|modèle) et pas seulement par identifiant. Le poser ici aussi
 * était une double propriété : du travail refait, avec une déduplication plus faible.
 */
async function poserCatalogueInitial() {
  await attendreDecisionSync();
  for (const record of INITIAL_CATALOG) {
    const existing = await db.get('docs', record.id).catch(() => null);
    if (!existing) await db.save('docs', record);
  }
}

/*
 * CONSULTER N'EST PAS ENSEMENCER (#165).
 *
 * CE QUI SE PASSAIT
 * ------------------
 * `getCatalog()` — une fonction de LECTURE — appelait `ensureCatalogSeed()` en première
 * ligne. Or `equipment-media.js::catalogMap()` appelle `getCatalog()` pour rendre une
 * Fiche 360. Ouvrir une fiche en simple consultation créait donc des documents
 * `docs/kb-*` et les poussait vers PostgreSQL.
 *
 * Mesuré sur base neuve, APRÈS convergence complète du démarrage, fenêtre témoin de même
 * durée à 0 écriture : 10 ouvertures = 10 `db.save`, 20 `put` IndexedDB, 10 PUT HTTP.
 * Les dix fiches portaient `origin:'seed'` et n'existaient PAS avant l'ouverture —
 * c'est-à-dire des entrées de `INITIAL_CATALOG` qu'aucun démarrage ne posait.
 *
 * POURQUOI ELLES MANQUAIENT
 * --------------------------
 * `EXTRA_EQUIPMENT_CATALOG` a bien un propriétaire de démarrage : le module frère
 * `equipment-knowledge-extra.js` appelle `seedExtraCatalog()` à son chargement.
 * `INITIAL_CATALOG` n'en avait AUCUN : `ensureCatalogSeed()` n'était appelée que depuis
 * `getCatalog()`. Le catalogue de base ne se matérialisait donc que par effet de bord
 * d'une lecture — la première à survenir, quelle qu'elle soit.
 *
 * CE QUI CHANGE
 * --------------
 * L'ensemencement garde exactement le même contenu et la même règle (ne pose que ce qui
 * MANQUE), mais il est déplacé dans le cycle de vie de DÉMARRAGE de ce module — celui
 * qu'utilise déjà son module frère, chargé par la même balise `<script type="module">`
 * d'`index.html`. Aucun second sous-système de catalogue n'est créé.
 *
 * Il passe par `catalog-enrichment-gate.js` pour ne pas courir contre les autres
 * producteurs `docs/kb-*` (#98), et une seule fois par session (`ensemencement`).
 *
 * `getCatalog()` redevient une lecture : elle ATTEND l'ensemencement déjà lancé au
 * chargement, elle ne le déclenche pas. Après convergence, cette attente est immédiate et
 * la lecture n'écrit rien. Si le catalogue n'est pas encore posé, la lecture rend ce qui
 * existe — l'appelant affiche l'absence, il ne la persiste pas.
 */
let ensemencement = null;
function ensureCatalogSeed() {
  if (ensemencement) return ensemencement;
  ensemencement = withCatalogEnrichmentGate(poserCatalogueInitial);
  return ensemencement;
}

async function getCatalog() {
  // Attendre un ensemencement DÉJÀ EN COURS n'est pas l'ensemencer : aucune écriture
  // n'est déclenchée par cette lecture.
  if (ensemencement) await ensemencement.catch(() => {});
  const docs = await db.getAll('docs');
  return docs.filter(item => item.kind === CATALOG_KIND || item.targetType === CATALOG_KIND)
    .map(enrichCatalogKnowledge)
    .sort((a,b) => `${a.manufacturer || ''} ${a.model || ''}`.localeCompare(`${b.manufacturer || ''} ${b.model || ''}`, 'fr'));
}

function statusLabel(value) {
  return ({verified:'Vérifié', 'verified-family':'Famille vérifiée', 'to-confirm':'À confirmer', custom:'Ajout interne'}[value] || value || 'À confirmer');
}

function statusClass(value) {
  return value === 'verified' ? 'verified' : value === 'verified-family' ? 'family' : 'pending';
}

function createEditor(record = null, onSaved = null) {
  document.getElementById('kb-editor-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'kb-editor-modal';
  modal.className = 'kb-modal';
  modal.innerHTML = `<section class="kb-modal-card" role="dialog" aria-modal="true">
    <header><div><strong>${record ? 'Modifier la référence' : 'Nouvelle référence technique'}</strong><small>Catalogue constructeur/modèle — indépendant du nom d’exploitation.</small></div><button type="button" class="kb-close">×</button></header>
    <form id="kb-editor-form">
      <div class="kb-form-grid">
        <label>Constructeur<input name="manufacturer" required value="${esc(record?.manufacturer)}"></label>
        <label>Modèle / référence<input name="model" required value="${esc(record?.model)}"></label>
        <label>Famille<input name="family" value="${esc(record?.family)}"></label>
        <label>Type<input name="type" required value="${esc(record?.type)}"></label>
        <label>Catégorie<input name="category" required value="${esc(record?.category)}"></label>
        <label>Profil de fiche<select name="knowledgeProfile">${Object.values(KNOWLEDGE_PROFILES).map(profile => `<option value="${esc(profile.key)}" ${profile.key===(record?.knowledgeProfile || inferKnowledgeProfile(record || {}))?'selected':''}>${esc(profile.label)}</option>`).join('')}</select></label>
        <label>Validation<select name="verificationStatus">
          <option value="verified" ${record?.verificationStatus==='verified'?'selected':''}>Vérifié</option>
          <option value="verified-family" ${record?.verificationStatus==='verified-family'?'selected':''}>Famille vérifiée</option>
          <option value="to-confirm" ${!record || record?.verificationStatus==='to-confirm'?'selected':''}>À confirmer</option>
        </select></label>
      </div>
      <label>Résumé<textarea name="summary" rows="3">${esc(record?.summary)}</textarea></label>
      <label>Notes techniques / ports<textarea name="portsNote" rows="3">${esc(record?.portsNote)}</textarea></label>
      <label>Documentation constructeur<input name="documentationUrl" type="url" value="${esc(record?.documentationUrl)}" placeholder="https://..."></label>
      <label>Source / méthode de vérification<textarea name="sourceNote" rows="2">${esc(record?.sourceNote)}</textarea></label>
      <div class="kb-actions"><button type="button" class="btn gray kb-cancel">Annuler</button><button class="btn" type="submit">Enregistrer dans la base</button></div>
    </form>
  </section>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.kb-close').onclick = close;
  modal.querySelector('.kb-cancel').onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.querySelector('#kb-editor-form').onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...(record || {}),
      ...data,
      kind: CATALOG_KIND,
      targetType: CATALOG_KIND,
      targetId: record?.targetId || record?.id || null,
      origin: record?.origin || 'admin',
      confidence: data.verificationStatus === 'verified' ? 'high' : 'medium',
      visibility: record?.visibility || 'all-non-sensitive',
      verifiedAt: data.verificationStatus === 'verified' ? new Date().toISOString() : (record?.verifiedAt || null),
      updatedAt: new Date().toISOString()
    };
    if (!record?.id) delete payload.id;
    const id = await db.save('docs', payload);
    const saved = await db.get('docs', record?.id ?? id);
    close();
    onSaved?.(saved);
  };
  return modal;
}

class EquipmentKnowledgeBase {
  constructor(notifications) {
    this.notifications = notifications;
    this.search = '';
  }

  async render() {
    const catalog = await getCatalog();
    const q = this.search.trim().toLowerCase();
    const filtered = q ? catalog.filter(item => [item.manufacturer,item.model,item.family,item.type,item.category,item.summary].join(' ').toLowerCase().includes(q)) : catalog;
    return `<div class="card kb-page">
      <div class="card-header kb-page-head"><div><h2>Base de connaissances technique</h2><p class="section-subtitle">Catalogue des constructeurs et modèles. Une même référence peut être liée à plusieurs équipements portant des noms d’exploitation différents.</p></div><button class="btn" id="kb-add-reference"><i class="fas fa-plus"></i> Ajouter une référence</button></div>
      <div class="kb-principle"><i class="fas fa-link"></i><div><strong>Catalogue ≠ inventaire physique</strong><span>Exemple : <b>NACQ1</b> est le nom d’exploitation de l’écran ; son constructeur et son modèle proviennent de cette base.</span></div></div>
      <div class="kb-toolbar"><input id="kb-search" class="form-control" placeholder="Constructeur, modèle, famille, type…" value="${esc(this.search)}"><span>${filtered.length} référence(s) · ${filtered.reduce((sum,item) => sum + (item.officialFacts?.length || 0) + (item.projectEvidence?.length || 0),0)} faits sourcés</span></div>
      <div class="kb-table-wrap"><table class="tableau kb-table"><thead><tr><th>Constructeur</th><th>Modèle / famille</th><th>Type</th><th>Catégorie</th><th>Validation</th><th>Source</th><th>Actions</th></tr></thead><tbody>
        ${filtered.map(item => `<tr>
          <td><strong>${esc(item.manufacturer)}</strong></td>
          <td>${esc(item.model)}${item.family && item.family !== item.model ? `<small>${esc(item.family)}</small>` : ''}<small>${esc(KNOWLEDGE_PROFILES[item.knowledgeProfile]?.label || '')} · ${(item.officialFacts?.length || 0) + (item.projectEvidence?.length || 0)} fait(s)</small></td>
          <td>${esc(item.type)}</td><td>${esc(item.category)}</td>
          <td><span class="kb-status ${statusClass(item.verificationStatus)}">${statusLabel(item.verificationStatus)}</span></td>
          <td>${documentationLink(item)}</td>
          <td><button class="btn-icon kb-details" data-id="${esc(item.id)}" title="Voir la fiche"><i class="fas fa-book-open"></i></button><button class="btn-icon kb-edit" data-id="${esc(item.id)}" title="Modifier"><i class="fas fa-edit"></i></button>${item.origin === 'admin' ? `<button class="btn-icon kb-delete" data-id="${esc(item.id)}" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7">Aucune référence.</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  async afterRender() {
    document.getElementById('kb-search')?.addEventListener('input', event => {
      this.search = event.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.refresh(), 120);
    });
    document.getElementById('kb-add-reference')?.addEventListener('click', () => createEditor(null, () => this.refresh()));
    document.querySelectorAll('.kb-details').forEach(button => button.onclick = async () => {
      const record = (await getCatalog()).find(item => String(item.id) === String(button.dataset.id));
      if (record) window.EquipmentSmartKnowledge?.openCatalogDetails(record);
    });
    document.querySelectorAll('.kb-edit').forEach(button => button.onclick = async () => {
      const record = await db.get('docs', db.normalizeKey(button.dataset.id));
      if (record) createEditor(record, () => this.refresh());
    });
    document.querySelectorAll('.kb-delete').forEach(button => button.onclick = async () => {
      const record = await db.get('docs', db.normalizeKey(button.dataset.id));
      if (!record || record.origin !== 'admin') return;
      const accepted = window.AppDialog ? await window.AppDialog.confirm(`Supprimer la référence « ${record.manufacturer} ${record.model} » ?`) : confirm('Supprimer cette référence ?');
      if (!accepted) return;
      await db._deleteRaw('docs', db.normalizeKey(record.id));
      this.notifications?.showNotification('Référence supprimée.', 'success');
      await this.refresh();
    });
  }

  async refresh() {
    const container = document.getElementById('admin-content');
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  }

  openAddForm() { createEditor(null, () => this.refresh()); }
}

function patchAdminKnowledgeSection() {
  if (AdminUI.prototype.__equipmentKnowledgePatched) return;
  AdminUI.prototype.__equipmentKnowledgePatched = true;
  const previous = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithKnowledge() {
    const sections = previous.call(this);
    const rebuilt = {};
    for (const [key, value] of Object.entries(sections)) {
      rebuilt[key] = value;
      if (key === 'devices') rebuilt.knowledge = { title:'Base de connaissances', icon:'fas fa-book-medical', component:new EquipmentKnowledgeBase(this.notifications) };
    }
    if (!rebuilt.knowledge) rebuilt.knowledge = { title:'Base de connaissances', icon:'fas fa-book-medical', component:new EquipmentKnowledgeBase(this.notifications) };
    return rebuilt;
  };
}

function ensureCategoryOption(select, value) {
  if (!select || !value) return;
  if (![...select.options].some(option => option.value === value)) select.add(new Option(value, value));
}

async function installCatalogSelector(instance, equipment = null) {
  const form = document.getElementById('eq-form');
  if (!form || form.dataset.knowledgeReady === '1') return;
  form.dataset.knowledgeReady = '1';
  const catalog = await getCatalog();

  const nameInput = form.elements.name;
  if (nameInput) {
    nameInput.placeholder = "Nom d’exploitation / repère interne (ex. NACQ1, NACQ2, Normalisation)";
    nameInput.title = 'Nom utilisé sur le site. Il est indépendant du constructeur et du modèle.';
  }
  const serial = form.elements.numSerie;
  if (serial) {
    serial.required = false;
    serial.placeholder = 'Numéro de série (facultatif si encore inconnu)';
  }

  const panel = document.createElement('section');
  panel.className = 'kb-equipment-link';
  panel.innerHTML = `<div class="kb-equipment-link-head"><div><strong><i class="fas fa-book"></i> Référence dans la base de connaissances</strong><small>Choisissez le constructeur/modèle, puis gardez le nom local de cet équipement séparément.</small></div></div>
    <div class="kb-equipment-link-grid">
      <label>Référence catalogue<select name="catalogId" id="eq-catalog-id"><option value="">Modèle non référencé / saisie manuelle</option>${catalog.map(item => `<option value="${esc(item.id)}">${esc(item.manufacturer)} — ${esc(item.model)}</option>`).join('')}</select></label>
      <label>Fonction / usage local<input name="operationalRole" value="${esc(equipment?.operationalRole)}" placeholder="Ex. écran acquisition Avid, contrôle RF1…"></label>
    </div>
    <div class="kb-catalog-preview" id="eq-catalog-preview">Sélectionnez une référence pour afficher son résumé.</div>
    <div class="kb-port-template" id="eq-port-template" hidden></div>
    ${['admin','manager'].includes(String(getCurrentUser()?.role || '').toLowerCase()) ? '<button type="button" class="btn gray" id="eq-add-catalog-reference"><i class="fas fa-plus"></i> Nouveau modèle absent de la base</button>' : ''}`;

  const anchor = form.elements.name;
  form.insertBefore(panel, anchor || form.firstChild);
  const select = panel.querySelector('#eq-catalog-id');
  const preview = panel.querySelector('#eq-catalog-preview');
  const templateHost = panel.querySelector('#eq-port-template');

  const portsPanel = () => form.querySelector('.equipment-ports-editor');

  // Le gabarit propose ; il ne décide pas. L'utilisateur choisit combien de ports
  // existent réellement sur cette unité avant qu'ils ne soient créés.
  const renderPortTemplate = record => {
    const template = catalogPortTemplate(record);
    const image = safeExternalUrl(record?.officialImage?.url);
    if (!template.length && !image) { templateHost.hidden = true; templateHost.innerHTML = ''; return; }
    templateHost.hidden = false;
    const defaults = defaultSelection(template);
    templateHost.innerHTML = `
      ${image ? `<figure class="kb-model-photo"><img src="${esc(image)}" alt="${esc(record.manufacturer)} ${esc(record.model)}" loading="lazy"><figcaption>Photo constructeur — la photo réelle de l’unité 2M reste à ajouter dans « Images ».</figcaption></figure>` : ''}
      ${template.length ? `<div class="kb-port-template-head"><div><strong><i class="fas fa-plug"></i> Ports documentés par le constructeur</strong><small>Décochez ce qui n’est pas installé sur cette unité. Rien n’est créé sans votre validation.</small></div><button type="button" class="btn" id="eq-apply-port-template"><i class="fas fa-wand-magic-sparkles"></i> Ajouter les ports cochés</button></div>
      <div class="kb-port-template-list">${template.map(entry => `
        <label class="kb-port-template-row" data-entry-key="${esc(entry.key)}">
          <input type="checkbox" ${defaults[entry.key] ? 'checked' : ''}>
          <span class="kb-port-template-label">${esc(entry.label)}<small>${esc(entry.direction)} · ${esc(entry.portType)}${entry.connector ? ` · ${esc(entry.connector)}` : ''}</small></span>
          <input type="number" min="0" max="64" value="${entry.count ?? ''}" placeholder="?" aria-label="Nombre de ports ${esc(entry.label)}">
          <small class="kb-port-scope ${entry.scope === 'model-capability' ? 'sure' : 'conditional'}">${esc(SCOPE_LABELS[entry.scope] || entry.scope)}</small>
        </label>`).join('')}</div>
      <p class="kb-port-template-note">Les ports ajoutés restent « à confirmer » jusqu’à leur relevé sur site.</p>` : ''}`;

    templateHost.querySelector('#eq-apply-port-template')?.addEventListener('click', () => {
      const target = portsPanel();
      if (!target?.appendPorts) return;
      const selections = {};
      templateHost.querySelectorAll('.kb-port-template-row').forEach(row => {
        if (!row.querySelector('input[type="checkbox"]').checked) return;
        const count = Number(row.querySelector('input[type="number"]').value);
        if (Number.isFinite(count) && count > 0) selections[row.dataset.entryKey] = count;
      });
      const result = buildPortsFromTemplate(template, selections, {
        existingPorts: target.currentPorts ? target.currentPorts() : [],
        catalogId: record.id
      });
      if (!result.added.length) {
        window.dispatchEvent(new CustomEvent('kb-port-template-empty'));
        templateHost.querySelector('.kb-port-template-note').textContent =
          'Aucun port à ajouter : cochez au moins une ligne et indiquez un nombre.';
        return;
      }
      target.appendPorts(result.added);
      const skipped = result.skipped.length ? ` ${result.skipped.length} numéro(s) déjà utilisé(s) ont été ignorés.` : '';
      templateHost.querySelector('.kb-port-template-note').textContent =
        `${result.added.length} port(s) ajouté(s), à confirmer sur site.${skipped}`;
    });
  };

  const apply = id => {
    const record = catalog.find(item => String(item.id) === String(id));
    if (!record) {
      preview.textContent = 'Saisie manuelle : vous pouvez enregistrer l’équipement puis ajouter sa référence à la base plus tard.';
      templateHost.hidden = true; templateHost.innerHTML = '';
      return;
    }
    renderPortTemplate(record);
    if (form.elements.marque) form.elements.marque.value = record.manufacturer || '';
    if (form.elements.modele) form.elements.modele.value = record.model || '';
    if (form.elements.type) form.elements.type.value = record.type || '';
    if (form.elements.categorie) {
      ensureCategoryOption(form.elements.categorie, record.category);
      form.elements.categorie.value = record.category || '';
    }
    const factCount = (record.officialFacts?.length || 0) + (record.projectEvidence?.length || 0);
    preview.innerHTML = `<strong>${esc(record.manufacturer)} ${esc(record.model)}</strong><span>${esc(record.summary || '')}</span><em>${statusLabel(record.verificationStatus)} · ${esc(KNOWLEDGE_PROFILES[record.knowledgeProfile]?.label || '')} · ${factCount} fait(s) sourcé(s)</em><button type="button" class="btn gray kb-open-selected" style="margin-top:8px"><i class="fas fa-book-open"></i> Voir la fiche complète</button>`;
    preview.querySelector('.kb-open-selected')?.addEventListener('click', () => window.EquipmentSmartKnowledge?.openCatalogDetails(record));
  };

  let selected = equipment?.catalogId || '';
  if (!selected && equipment) {
    const match = catalog.find(item => String(item.manufacturer || '').toLowerCase() === String(equipment.marque || '').toLowerCase() && String(item.model || '').toLowerCase() === String(equipment.modele || '').toLowerCase());
    selected = match?.id || '';
  }
  select.value = selected;
  if (selected) apply(selected);
  select.onchange = () => apply(select.value);

  panel.querySelector('#eq-add-catalog-reference')?.addEventListener('click', () => {
    createEditor(null, saved => {
      if (!saved) return;
      catalog.push(saved);
      const option = new Option(`${saved.manufacturer} — ${saved.model}`, saved.id);
      select.add(option);
      select.value = String(saved.id);
      apply(saved.id);
    });
  });
}

function patchEquipmentForm() {
  if (Equipements.prototype.__equipmentKnowledgeFormPatched) return;
  Equipements.prototype.__equipmentKnowledgeFormPatched = true;
  const previous = Equipements.prototype.showEquipementModal;
  Equipements.prototype.showEquipementModal = async function showEquipmentWithKnowledge(equipment = null) {
    await previous.call(this, equipment);
    await installCatalogSelector(this, equipment);
  };
}

patchAdminKnowledgeSection();
patchEquipmentForm();

if (typeof window !== 'undefined') {
  // Le catalogue de base se pose au DÉMARRAGE, comme celui du module frère
  // `equipment-knowledge-extra.js`, et non au premier écran qui vient le lire.
  ensureCatalogSeed().catch(error => console.warn('Catalogue technique de base non initialisé', error));

  window.EquipmentKnowledge = Object.freeze({
    ensureSeed: ensureCatalogSeed,
    getCatalog,
    openEditor: createEditor,
    kind: CATALOG_KIND
  });
}

export { INITIAL_CATALOG, EquipmentKnowledgeBase, ensureCatalogSeed, getCatalog };
