import { db } from './db.js';
import Equipements from './equipements.js';
import { getCatalog } from './equipment-knowledge.js';
import {
  KNOWLEDGE_PROFILES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_SOURCE_TYPES,
  fieldsForKnowledgeProfile,
  inferKnowledgeProfile,
  normalizeEquipmentKnowledge,
  validateEquipmentKnowledge
} from './equipment-knowledge-contract.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
};
const statusLabels = Object.freeze({ verified:'Vérifié', documented:'Documenté', observed:'Observé', 'to-confirm':'À confirmer' });
const sourceLabels = Object.freeze({
  nameplate:'Plaque signalétique', interface:'Interface de gestion', plan:'Plan / schéma', inventory:'Inventaire',
  'manufacturer-doc':'Documentation constructeur', operator:'Exploitant', 'maintenance-report':'Rapport de maintenance', other:'Autre'
});

function factValue(facts, key) {
  return facts.find(item => item.key === key) || { key, value:'', verificationStatus:'to-confirm', sourceType:'nameplate', sourceLabel:'', observedAt:'', notes:'' };
}

function catalogFacts(record) {
  return [...(record?.officialFacts || []), ...(record?.projectEvidence || [])];
}

function renderCatalogFact(fact) {
  const source = safeUrl(fact.sourceUrl);
  return `<div class="smart-kb-fact"><div><strong>${esc(fact.label)}</strong><span>${esc(fact.value)}</span></div><small><span class="smart-status ${esc(fact.verificationStatus || 'verified')}">${esc(statusLabels[fact.verificationStatus] || fact.verificationStatus || 'Vérifié')}</span>${esc(fact.sourceLabel || (source ? 'Documentation constructeur' : 'Source projet'))}${source ? ` · <a href="${esc(source)}" target="_blank" rel="noopener">source</a>` : ''}</small></div>`;
}

function openCatalogDetails(record = {}) {
  document.getElementById('smart-kb-modal')?.remove();
  const facts = catalogFacts(record);
  const url = safeUrl(record.documentationUrl);
  const modal = document.createElement('div');
  modal.id = 'smart-kb-modal';
  modal.className = 'smart-kb-modal';
  modal.innerHTML = `<section class="smart-kb-card" role="dialog" aria-modal="true" aria-labelledby="smart-kb-title">
    <header><div><small>${esc(record.manufacturer || 'Constructeur à identifier')}</small><h2 id="smart-kb-title">${esc(record.model || 'Modèle à identifier')}</h2><p>${esc(record.summary || '')}</p></div><button type="button" class="smart-kb-close" aria-label="Fermer">×</button></header>
    <div class="smart-kb-tags"><span>${esc(KNOWLEDGE_PROFILES[record.knowledgeProfile]?.label || 'Équipement générique')}</span><span>${esc(record.verificationStatus || 'to-confirm')}</span><span>${facts.length} fait(s) sourcé(s)</span></div>
    ${facts.length ? `<section><h3>Informations du modèle et preuves projet</h3><div class="smart-kb-facts">${facts.map(renderCatalogFact).join('')}</div></section>` : '<p class="smart-kb-empty">Aucune spécification exacte n’est affirmée tant que le modèle n’est pas identifié.</p>'}
    <section><h3>À relever sur cet appareil</h3><ul class="smart-kb-checklist">${(record.identificationChecklist || []).map(item => `<li>${esc(item)}</li>`).join('') || '<li>Photo de la plaque signalétique, connectique et fonction réelle.</li>'}</ul></section>
    ${record.portsNote ? `<section><h3>Ports / précautions</h3><p>${esc(record.portsNote)}</p></section>` : ''}
    <footer>${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> Documentation constructeur</a>` : '<span>Documentation constructeur à compléter.</span>'}</footer>
  </section>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.smart-kb-close').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  return modal;
}

function renderFactEditor(field, fact) {
  const control = field.type === 'textarea'
    ? `<textarea data-smart-value rows="2" placeholder="${esc(field.placeholder || '')}">${esc(fact.value)}</textarea>`
    : field.type === 'select'
      ? `<select data-smart-value><option value="">— Non renseigné —</option>${(field.options || []).map(value => `<option value="${esc(value)}" ${value===fact.value?'selected':''}>${esc(value)}</option>`).join('')}</select>`
      : `<input data-smart-value type="${field.type === 'date' ? 'date' : 'text'}" value="${esc(fact.value)}" placeholder="${esc(field.placeholder || '')}">`;
  return `<article class="smart-fact-editor" data-fact-key="${esc(field.key)}">
    <label><span>${esc(field.label)}</span>${control}</label>
    <details ${fact.value ? 'open' : ''}><summary>Source et fiabilité</summary><div class="smart-fact-meta">
      <label>État<select data-smart-status>${KNOWLEDGE_STATUSES.map(value => `<option value="${value}" ${value===fact.verificationStatus?'selected':''}>${esc(statusLabels[value])}</option>`).join('')}</select></label>
      <label>Source<select data-smart-source>${KNOWLEDGE_SOURCE_TYPES.map(value => `<option value="${value}" ${value===fact.sourceType?'selected':''}>${esc(sourceLabels[value])}</option>`).join('')}</select></label>
      <label>Référence de la source<input data-smart-source-label value="${esc(fact.sourceLabel)}" placeholder="Ex. étiquette arrière, plan technique page 3"></label>
      <label>Date d’observation<input data-smart-observed type="date" value="${esc(fact.observedAt)}"></label>
      <label class="smart-span-2">Note / doute<input data-smart-notes value="${esc(fact.notes)}" placeholder="Préciser ce qui reste à confirmer"></label>
    </div></details>
  </article>`;
}

async function installKnowledgeEditor(instance, equipment, form) {
  if (!form || form.dataset.smartKnowledgeReady === '1') return;
  form.dataset.smartKnowledgeReady = '1';
  const catalog = await getCatalog();
  let profile = equipment?.knowledgeProfile || inferKnowledgeProfile(equipment || {});
  let facts = normalizeEquipmentKnowledge(equipment || {}).technicalFacts;
  const section = document.createElement('section');
  section.className = 'smart-equipment-knowledge';
  const anchor = form.querySelector('.eq-internals');
  if (anchor) form.insertBefore(section, anchor); else form.appendChild(section);

  const readEditor = () => {
    const next = [];
    section.querySelectorAll('[data-fact-key]').forEach(row => {
      const value = row.querySelector('[data-smart-value]')?.value.trim();
      if (!value) return;
      next.push({
        key:row.dataset.factKey,
        value,
        verificationStatus:row.querySelector('[data-smart-status]')?.value || 'to-confirm',
        sourceType:row.querySelector('[data-smart-source]')?.value || 'other',
        sourceLabel:row.querySelector('[data-smart-source-label]')?.value || '',
        observedAt:row.querySelector('[data-smart-observed]')?.value || '',
        notes:row.querySelector('[data-smart-notes]')?.value || ''
      });
    });
    facts = next;
  };

  const render = () => {
    const fields = fieldsForKnowledgeProfile(profile, facts);
    const groups = new Map();
    fields.forEach(field => { if (!groups.has(field.group)) groups.set(field.group, []); groups.get(field.group).push(field); });
    const filled = facts.filter(item => item.value).length;
    section.innerHTML = `<div class="smart-equipment-head"><div><h4><i class="fas fa-clipboard-check"></i> Fiche technique de cet appareil</h4><p>Renseignez uniquement les valeurs propres à cette unité. Les caractéristiques constructeur restent liées au catalogue.</p></div><span>${filled}/${fields.length} renseigné(s)</span></div>
      <div class="smart-profile-row"><label>Profil de collecte<select id="smart-knowledge-profile">${Object.values(KNOWLEDGE_PROFILES).map(item => `<option value="${esc(item.key)}" ${item.key===profile?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label><small>Les champs changent selon le type d’appareil. Aucun champ vide n’est enregistré.</small></div>
      <div class="smart-safety"><i class="fas fa-shield-alt"></i><span>Ne saisissez jamais de mot de passe, token, clé API ou clé privée. Le serveur les refusera.</span></div>
      <div class="smart-fact-groups">${[...groups].map(([group,items],index) => `<details ${index < 2 || items.some(field => factValue(facts,field.key).value) ? 'open' : ''}><summary>${esc(group)} <small>${items.filter(field => factValue(facts,field.key).value).length}/${items.length}</small></summary><div class="smart-fact-grid">${items.map(field => renderFactEditor(field,factValue(facts,field.key))).join('')}</div></details>`).join('')}</div>`;
    section.querySelector('#smart-knowledge-profile').onchange = event => { readEditor(); profile = event.target.value; render(); };
  };

  render();
  form.querySelector('#eq-catalog-id')?.addEventListener('change', event => {
    readEditor();
    const selected = catalog.find(item => String(item.id) === String(event.target.value));
    profile = selected?.knowledgeProfile || inferKnowledgeProfile({ type:form.elements.type?.value, categorie:form.elements.categorie?.value, modele:form.elements.modele?.value });
    render();
  });

  const previousSubmit = form.onsubmit;
  form.onsubmit = async event => {
    readEditor();
    const originalSave = db.save;
    let intercepted = false;
    db.save = async function saveEquipmentWithKnowledge(store, record) {
      if (store === 'equipments' && !intercepted) {
        intercepted = true;
        const checked = validateEquipmentKnowledge({ ...record, knowledgeProfile:profile, technicalFacts:facts });
        if (checked.errors.length) throw new Error(checked.errors.join(' '));
        record = { ...checked.value, knowledgeUpdatedAt:new Date().toISOString() };
      }
      return originalSave.call(db,store,record);
    };
    try { if (typeof previousSubmit === 'function') return await previousSubmit.call(form,event); }
    catch (error) {
      event.preventDefault();
      instance.notifications?.showNotification(error.message || 'Fiche technique invalide.', 'error');
    } finally { db.save = originalSave; }
  };
}

function renderInstanceKnowledge(equipment, catalogRecord) {
  const normalized = normalizeEquipmentKnowledge(equipment || {});
  const profile = KNOWLEDGE_PROFILES[normalized.knowledgeProfile] || KNOWLEDGE_PROFILES.generic;
  const fields = new Map(fieldsForKnowledgeProfile(profile.key, normalized.technicalFacts).map(field => [field.key,field]));
  const modelFacts = catalogFacts(catalogRecord);
  return `<section class="smart-knowledge-quick"><div class="smart-quick-title"><div><h4><i class="fas fa-book-open"></i> Connaissance technique</h4><small>${esc(profile.label)} · les faits du modèle et ceux de cette unité restent séparés</small></div>${catalogRecord ? '<button type="button" class="btn gray smart-open-catalog">Fiche modèle</button>' : ''}</div>
    ${normalized.technicalFacts.length ? `<h5>Cette unité</h5><div class="smart-instance-facts">${normalized.technicalFacts.map(fact => `<div><strong>${esc(fields.get(fact.key)?.label || fact.key)}</strong><span>${esc(fact.value)}</span><small>${esc(statusLabels[fact.verificationStatus])} · ${esc(sourceLabels[fact.sourceType])}${fact.sourceLabel ? ` · ${esc(fact.sourceLabel)}` : ''}</small></div>`).join('')}</div>` : '<p class="smart-kb-empty">Aucune valeur propre à cette unité n’est encore relevée.</p>'}
    ${modelFacts.length ? `<h5>Modèle / famille (${modelFacts.length})</h5><div class="smart-kb-facts compact">${modelFacts.slice(0,8).map(renderCatalogFact).join('')}</div>` : ''}
    ${(catalogRecord?.identificationChecklist || []).length ? `<details><summary>Informations encore à relever</summary><ul class="smart-kb-checklist">${catalogRecord.identificationChecklist.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

const previousShowEquipmentModal = Equipements.prototype.showEquipementModal;
Equipements.prototype.showEquipementModal = async function showEquipmentWithSmartKnowledge(equipment = null) {
  await previousShowEquipmentModal.call(this,equipment);
  await installKnowledgeEditor(this,equipment,document.getElementById('eq-form'));
};

const previousQuickView = Equipements.prototype.showQuickView;
Equipements.prototype.showQuickView = async function showQuickViewWithSmartKnowledge(equipment) {
  await previousQuickView.call(this,equipment);
  const content = document.getElementById('equip-quickview-modal')?.querySelector('.modal-content');
  if (!content) return;
  const catalog = await getCatalog();
  const record = catalog.find(item => String(item.id) === String(equipment?.catalogId));
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderInstanceKnowledge(equipment,record);
  const block = wrapper.firstElementChild;
  content.appendChild(block);
  block.querySelector('.smart-open-catalog')?.addEventListener('click', () => openCatalogDetails(record));
};

if (typeof window !== 'undefined') {
  window.EquipmentSmartKnowledge = Object.freeze({ openCatalogDetails, normalizeEquipmentKnowledge, validateEquipmentKnowledge });
}

export { openCatalogDetails, renderInstanceKnowledge };
