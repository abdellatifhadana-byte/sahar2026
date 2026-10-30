import { db } from './db.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const label = entity => entity?.name || entity?.nom || entity?.modele || `#${entity?.id ?? '?'}`;
const list = value => Array.isArray(value) ? value : [];

function portSummary(port = {}) {
  const format = list(port.formats).length ? list(port.formats).join(', ') : list(port.formatCapabilities).length ? `cap. ${list(port.formatCapabilities).join(', ')}` : '';
  const connectors = list(port.connectorTypes).filter(Boolean).join(', ');
  return [port.type, port.direction, connectors, format, port.verificationStatus].filter(Boolean).join(' · ');
}

function technicalFactSummary(fact = {}) {
  if (typeof fact === 'string') return fact;
  return [fact.label || fact.name || fact.key, fact.value, fact.unit, fact.verificationStatus].filter(Boolean).join(' · ');
}

async function equipmentFromModal(modal) {
  const explicitId = modal.dataset.equipmentId;
  if (explicitId) return db.get('equipments', db.normalizeKey ? db.normalizeKey(explicitId) : explicitId).catch(() => null);
  const name = modal.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
  if (!name) return null;
  const equipments = await db.getAll('equipments');
  const matches = equipments.filter(item => label(item) === name);
  if (matches.length === 1) return matches[0];
  return null;
}

export async function enhanceEquipment360(modal = document.getElementById('ops-equipment-360')) {
  if (!modal || modal.dataset.complete360 === '1') return false;
  const equipment = await equipmentFromModal(modal);
  if (!equipment) return false;
  modal.dataset.complete360 = '1';
  modal.dataset.equipmentId = String(equipment.id);

  const equipments = await db.getAll('equipments');
  const host = equipment.hostEquipmentId != null ? equipments.find(item => String(item.id) === String(equipment.hostEquipmentId)) : null;
  const children = equipments
    .filter(item => String(item.hostEquipmentId ?? '') === String(equipment.id) && item.entityKind === 'module-card')
    .sort((a,b) => String(a.slot || '').localeCompare(String(b.slot || ''), 'fr', { numeric:true }));
  const ports = list(equipment.ports);
  const components = list(equipment.components);
  const facts = list(equipment.technicalFacts);
  const source = equipment.inventorySource || {};
  const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
  if (!target) return false;

  const provenance = document.createElement('section');
  provenance.className = 'ops-card ops-technical-integrations';
  provenance.innerHTML = `<h3><i class="fas fa-database"></i> Catalogue & provenance</h3>
    <div class="ops-facts">
      ${[
        ['Catalog ID',equipment.catalogId || '—'],
        ['Clé inventaire',equipment.inventoryKey || '—'],
        ['Type d’entité',equipment.entityKind || 'equipment'],
        ['État d’affectation',equipment.assignmentStatus || '—'],
        ['Vérification hôte',equipment.hostVerificationStatus || '—'],
        ['Source feuille',source.sheet || '—'],
        ['Ligne source',source.row ?? '—'],
        ['Référence source',source.reference || '—'],
        ['Quantité à confirmer',equipment.quantityToConfirm === true ? 'Oui' : 'Non'],
        ['Preuve plan',equipment.planEvidence || '—']
      ].map(([key,value]) => `<div class="ops-fact"><small>${esc(key)}</small><strong>${esc(value)}</strong></div>`).join('')}
    </div>`;
  target.appendChild(provenance);

  if (host || children.length || equipment.entityKind === 'module-card' || equipment.entityKind === 'modular-chassis') {
    const modular = document.createElement('section');
    modular.className = 'ops-card ops-module-integrations';
    modular.innerHTML = `<h3><i class="fas fa-layer-group"></i> Implantation modulaire</h3>
      ${host ? `<div class="ops-row"><div class="ops-row-main"><strong>Châssis hôte · ${esc(label(host))}</strong><small>Slot: ${esc(equipment.slot || 'à confirmer')} · ${esc(equipment.assignmentStatus || '')}</small></div></div>` : equipment.entityKind === 'module-card' ? '<div class="ops-empty">Carte non affectée à un châssis — relevé terrain requis.</div>' : ''}
      ${children.length ? `<div class="ops-list" style="max-height:280px;overflow:auto">${children.map(card => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(card.slot || 'Slot ?')} · ${esc(label(card))}</strong><small>${esc(card.modele || card.catalogId || '')} · ${esc(card.hostVerificationStatus || card.assignmentStatus || 'à confirmer')}</small></div></div>`).join('')}</div>` : equipment.entityKind === 'modular-chassis' ? '<div class="ops-empty">Aucune carte affectée à ce châssis.</div>' : ''}`;
    target.appendChild(modular);
  }

  const connectivity = document.createElement('section');
  connectivity.className = 'ops-card ops-port-integrations';
  connectivity.innerHTML = `<h3><i class="fas fa-plug"></i> Ports physiques</h3><p class="ops-card-sub">Les capacités constructeur restent distinctes des formats réellement observés.</p>
    ${ports.length ? `<div class="ops-list" style="max-height:360px;overflow:auto">${ports.map(port => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(port.number || port.id || 'Port')}</strong><small>${esc(port.label || '')}${port.label ? '<br>' : ''}${esc(portSummary(port))}</small></div><span class="ops-badge ${port.verificationStatus === 'observed' || port.verificationStatus === 'verified' ? 'normal' : 'watch'}">${esc(port.verificationStatus || 'à confirmer')}</span></div>`).join('')}</div>` : '<div class="ops-empty">Aucun port configuré.</div>'}`;
  target.appendChild(connectivity);

  if (components.length) {
    const internals = document.createElement('section');
    internals.className = 'ops-card ops-component-integrations';
    internals.innerHTML = `<h3><i class="fas fa-microchip"></i> Composants internes</h3><div class="ops-list" style="max-height:280px;overflow:auto">${components.map(component => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(component.name || component.nom || component.type || component.id || 'Composant')}</strong><small>${esc([component.manufacturer || component.marque, component.model || component.modele, component.serialNumber || component.numSerie, component.verificationStatus].filter(Boolean).join(' · '))}</small></div></div>`).join('')}</div>`;
    target.appendChild(internals);
  }

  if (facts.length) {
    const technical = document.createElement('section');
    technical.className = 'ops-card ops-facts-integrations';
    technical.innerHTML = `<h3><i class="fas fa-clipboard-check"></i> Faits techniques</h3><div class="ops-list" style="max-height:280px;overflow:auto">${facts.map(fact => `<div class="ops-row"><div class="ops-row-main"><small>${esc(technicalFactSummary(fact))}</small></div></div>`).join('')}</div>`;
    target.appendChild(technical);
  }
  return true;
}

function installObserver() {
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.complete360Observer === '1') return;
  host.dataset.complete360Observer = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
        if (modal) queueMicrotask(() => enhanceEquipment360(modal).catch(error => console.error('Extension fiche 360 indisponible', error)));
      }
    }
  });
  observer.observe(host, { childList:true, subtree:true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) enhanceEquipment360(existing).catch(() => {});
}

installObserver();

if (typeof window !== 'undefined') {
  window.Equipment360Complete = Object.freeze({ enhance:enhanceEquipment360 });
}
