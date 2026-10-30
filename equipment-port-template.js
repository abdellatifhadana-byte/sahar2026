/**
 * @file equipment-port-template.js
 * @description Transforme les capacités de ports décrites par une fiche modèle
 * en ports proposés à une instance d'équipement, sans confondre capacité
 * constructeur et configuration observée sur site.
 */

import {
  PORT_TYPE_DEFINITIONS, CABLE_TYPE_DEFINITIONS, PATH_ROLES,
  normalizePort, normalizePorts, evaluateConnection, portCanSource, portCanDestination
} from './connectivity-contract.js';

const MAX_TEMPLATE_ENTRIES = 40;
const MAX_PORTS_PER_ENTRY = 64;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const list = value => (Array.isArray(value) ? value : []).map(item => text(item, 60).toUpperCase()).filter(Boolean);

/**
 * Production templates keyed by the SAME catalog ids already used by the app.
 * This is intentionally not a second catalog/store. A catalog record may still
 * provide its own `portTemplate`; that explicit record data has priority.
 *
 * Counts are only supplied where the project already documents them. Unknown
 * or option-dependent counts remain null and therefore are never auto-created.
 */
export const MODEL_PORT_TEMPLATES = Object.freeze({
  'kb-ross-mc1uhd': Object.freeze([
    Object.freeze({
      key:'sdi-in', label:'SDI IN', direction:'IN', portType:'12G-SDI',
      connector:'HD_BNC', signalDomains:['VIDEO'], protocols:['SDI'],
      formats:['HD-SDI','3G-SDI','6G-SDI','12G-SDI'], count:6,
      scope:'rear-module-dependent', requiresRearModule:'MC1-UHD-R4',
      note:'Capacité documentée du modèle/projet. Présence et format actif à confirmer sur l’unité 2M.'
    }),
    Object.freeze({
      key:'sdi-out', label:'SDI OUT', direction:'OUT', portType:'12G-SDI',
      connector:'HD_BNC', signalDomains:['VIDEO'], protocols:['SDI'],
      formats:['HD-SDI','3G-SDI','6G-SDI','12G-SDI'], count:6,
      scope:'rear-module-dependent', requiresRearModule:'MC1-UHD-R4',
      note:'Capacité documentée du modèle/projet. Présence et format actif à confirmer sur l’unité 2M.'
    }),
    Object.freeze({
      key:'ref', label:'REF', direction:'IN', portType:'Genlock / REF',
      connector:'BNC', signalDomains:['SYNC'], protocols:['GENLOCK','BLACK_BURST','TRI_LEVEL_SYNC'],
      formats:[], count:1, scope:'model-capability',
      note:'Entrée de référence. Source primaire/secours et câblage réel à relever sur site.'
    })
  ])
});

/** Scopes possibles d'une entrée de gabarit, du plus certain au plus conditionnel. */
export const TEMPLATE_SCOPES = Object.freeze(['model-capability', 'rear-module-dependent', 'option-dependent']);
export const SCOPE_LABELS = Object.freeze({
  'model-capability': 'Toujours présent sur ce modèle',
  'rear-module-dependent': 'Dépend du module arrière installé',
  'option-dependent': 'Dépend d’une option ou d’une licence'
});

const KNOWN_CONNECTORS = new Set([
  ...Object.values(PORT_TYPE_DEFINITIONS).flatMap(definition => definition.connectors || []),
  ...Object.values(CABLE_TYPE_DEFINITIONS).flatMap(group => Object.values(group).flatMap(definition => definition.connectors || []))
]);

// Only lexical aliases that represent the same connector family are collapsed.
// Physically different miniature connectors (for example HD-BNC) intentionally
// stay UNKNOWN until the cable registry explicitly models that termination.
const CONNECTOR_ALIASES = Object.freeze({
  'RJ-45':'RJ45', 'RJ_45':'RJ45',
  'USB-A':'USB_A', 'USB A':'USB_A',
  'USB-C':'USB_C', 'USB C':'USB_C',
  'DISPLAY PORT':'DISPLAYPORT',
  'BNC75':'BNC', 'BNC_75':'BNC', 'BNC 75':'BNC', 'BNC 75Ω':'BNC',
  'LC DUPLEX':'LC', 'LC_DUPLEX':'LC',
  'XLR':'XLR3', 'XLR-3':'XLR3'
});

export function normalizeTemplateConnector(value) {
  const raw = text(value, 60).toUpperCase();
  if (!raw) return { value:'', known:false, original:'' };
  const canonical = CONNECTOR_ALIASES[raw] || raw;
  return { value:KNOWN_CONNECTORS.has(canonical) ? canonical : 'UNKNOWN', known:KNOWN_CONNECTORS.has(canonical), original:raw };
}

/**
 * Normalise une entrée de gabarit venue de la fiche modèle.
 * Une entrée sans type de port connu reste exploitable : le type « Autre » est
 * conservé et l'entrée est signalée comme à confirmer.
 */
export function normalizeTemplateEntry(source = {}, index = 0) {
  const portType = PORT_TYPE_DEFINITIONS[source.portType] ? source.portType : 'Autre';
  const known = Boolean(PORT_TYPE_DEFINITIONS[source.portType]);
  const rawCount = Number(source.count);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(Math.floor(rawCount), MAX_PORTS_PER_ENTRY) : null;
  const scope = TEMPLATE_SCOPES.includes(source.scope) ? source.scope : 'rear-module-dependent';
  const connector = normalizeTemplateConnector(source.connector);
  return {
    key: text(source.key, 80) || `tpl-${index + 1}`,
    label: text(source.label) || portType,
    direction: source.direction === 'IN' || source.direction === 'OUT' ? source.direction : 'IN/OUT',
    portType,
    portTypeKnown: known,
    connector: connector.value,
    connectorKnown: connector.known,
    connectorOriginal: connector.original,
    signalDomains: list(source.signalDomains),
    protocols: list(source.protocols),
    formats: list(source.formats),
    count,
    countKnown: count !== null,
    scope,
    requiresRearModule: text(source.requiresRearModule, 160),
    note: text(source.note, 500)
  };
}

/** Extrait et normalise le gabarit d'une fiche catalogue. */
export function catalogPortTemplate(catalogRecord = {}) {
  const explicit = Array.isArray(catalogRecord.portTemplate) ? catalogRecord.portTemplate : null;
  const fallback = MODEL_PORT_TEMPLATES[String(catalogRecord.id || '')] || [];
  const entries = explicit?.length ? explicit : fallback;
  return entries.slice(0, MAX_TEMPLATE_ENTRIES).map(normalizeTemplateEntry);
}

/** Vrai si la fiche modèle apporte quelque chose d'exploitable pour les ports. */
export function hasPortTemplate(catalogRecord) {
  return catalogPortTemplate(catalogRecord).length > 0;
}

const uniqueId = (base, taken) => {
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${base}-${suffix++}`;
  taken.add(candidate);
  return candidate;
};

const templateNotes = entry => {
  const notes = [];
  if (entry.requiresRearModule) notes.push(`Dépend du module arrière : ${entry.requiresRearModule}`);
  if (entry.connectorOriginal && !entry.connectorKnown) notes.push(`Connecteur constructeur « ${entry.connectorOriginal} » non encore normalisé dans le registre câble : compatibilité physique à confirmer.`);
  if (entry.note) notes.push(entry.note);
  return notes.join(' ');
};

/**
 * Matérialise les entrées choisies en ports d'équipement.
 * `formats` from a model template are CAPABILITIES, never an observed active
 * format. Active instance `formats` therefore stay empty until field evidence.
 */
export function buildPortsFromTemplate(template = [], selections = {}, { existingPorts = [], catalogId = '', startNumber = null } = {}) {
  const current = normalizePorts(existingPorts);
  const takenIds = new Set(current.map(port => String(port.id)));
  const takenNumbers = new Set(current.map(port => String(port.number).toLocaleLowerCase('fr-FR')));
  const added = [];
  const skipped = [];

  for (const rawEntry of template) {
    const entry = rawEntry?.portTypeKnown === undefined ? normalizeTemplateEntry(rawEntry) : rawEntry;
    const requested = Number(selections[entry.key]);
    if (!Number.isFinite(requested) || requested <= 0) continue;
    const total = Math.min(Math.floor(requested), MAX_PORTS_PER_ENTRY);
    for (let index = 0; index < total; index += 1) {
      const suffix = total > 1 ? ` ${index + 1}` : '';
      const label = `${entry.label}${suffix}`;
      const baseNumber = startNumber != null
        ? String(Number(startNumber) + added.length)
        : `${entry.key.toUpperCase()}${total > 1 ? `-${index + 1}` : ''}`;
      const numberKey = baseNumber.toLocaleLowerCase('fr-FR');
      if (takenNumbers.has(numberKey)) {
        skipped.push({ key:entry.key, number:baseNumber, reason:'numéro déjà utilisé' });
        continue;
      }
      takenNumbers.add(numberKey);
      const connectorTypes = entry.connectorOriginal ? [entry.connectorKnown ? entry.connector : 'UNKNOWN'] : undefined;
      const port = normalizePort({
        id: uniqueId(`PORT-${entry.key}-${index + 1}`, takenIds),
        number: baseNumber,
        label,
        type: entry.portType,
        direction: entry.direction,
        behavior: 'fixed',
        connectorTypes,
        signalDomains: entry.signalDomains.length ? entry.signalDomains : undefined,
        protocols: entry.protocols.length ? entry.protocols : undefined,
        formats: [],
        formatCapabilities: entry.formats.length ? entry.formats : undefined,
        verificationStatus: 'to-confirm',
        sourceRef: catalogId ? `Gabarit modèle ${catalogId}` : 'Gabarit modèle',
        notes: templateNotes(entry)
      }, added.length);
      added.push(port);
    }
  }

  return { ports:[...current, ...added], added, skipped };
}

/** Sélection par défaut : uniquement les quantités réellement documentées. */
export function defaultSelection(template = []) {
  const selection = {};
  for (const entry of template) if (entry.countKnown) selection[entry.key] = entry.count;
  return selection;
}

/**
 * Types de câbles réellement utilisables entre deux ports, jugés par le même
 * moteur que le serveur. `to-confirm` reste proposé mais explicitement marqué.
 */
export function compatibleCableTypes(sourcePort, destinationPort, { includeToConfirm = true } = {}) {
  if (!sourcePort || !destinationPort) return [];
  const results = [];
  for (const [category, definitions] of Object.entries(CABLE_TYPE_DEFINITIONS)) {
    for (const type of Object.keys(definitions)) {
      const verdict = evaluateConnection({ sourcePort, destinationPort, cable:{ category, type } });
      const usable = verdict.status === 'compatible' || (includeToConfirm && verdict.status === 'to-confirm');
      results.push({ category, type, status:verdict.status, usable, reasons:verdict.reasons, suggestions:verdict.suggestions });
    }
  }
  return results;
}

/** Raccourci pour une interface : uniquement ce qui passe, groupé par catégorie. */
export function usableCableTypesByCategory(sourcePort, destinationPort, options = {}) {
  const grouped = {};
  for (const item of compatibleCableTypes(sourcePort, destinationPort, options)) {
    if (!item.usable) continue;
    (grouped[item.category] ||= []).push(item);
  }
  return grouped;
}

/** Sens exploitables d'un port, pour guider l'utilisateur avant qu'il ne se trompe. */
export function portUsage(portValue) {
  const port = portValue ? normalizePort(portValue, 0) : null;
  return {
    canSource: portCanSource(port),
    canDestination: portCanDestination(port),
    pathRoles: PATH_ROLES
  };
}

export const PORT_TEMPLATE_VERSION = 2;
