import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch8 } from './equipment-image-coverage-batch8.js';
import { ensureGrilleCentraleKnowledge, GRILLE_CENTRALE_ALIASES, GRILLE_CENTRALE_CATALOG_ID } from './grille-centrale-knowledge.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

export const EQUIPMENT_MEDIA_LINKAGE_VERSION = 4;

export const EQUIPMENT_MEDIA_ALIASES = Object.freeze({
  'kb-tc-dbmax': Object.freeze(['TC Electronic DBMAX','DBMAX','TC ELECTRONIC DBMAX']),
  'kb-kramer-vs81av': Object.freeze(['VS-81AV','Kramer VS-81AV','KRAMER VS-81AV']),
  'kb-wohler-amp2am': Object.freeze(['AMP2-AM','WOHLER AMP2-AM','Wohler Technologies AMP2-AM']),
  'kb-riedel-artist': Object.freeze(['ARTIST','Riedel Artist','Riedel Communications Artist']),
  'kb-tsl-tallyman': Object.freeze(['TallyMan','TSL TallyMan','TSL Products TallyMan']),
  'kb-harmonic-spectrum-vsx': Object.freeze(['Serveur HARMONIC Spectrum VSX (PUB)','HARMONIC Spectrum VSX','Spectrum VSX']),
  'kb-harmonic-spectrum-mediacenter': Object.freeze(['Spectrum MediaCenter','Harmonic Spectrum MediaCenter']),
  'kb-kub-usb-scan-station': Object.freeze(['KUB.01','KUB.02','KUB 01','KUB 02']),
  'kb-blackmagic-hyperdeck-legacy': Object.freeze(['HyperDeck Studio','Blackmagic HyperDeck Studio']),
  'kb-evertz-x0401h': Object.freeze(['X0401H','Evertz X0401H','Evertz X0401H 4x1 HD Router']),
  'kb-avid-dnxiq': Object.freeze(['DNxIQ','Avid DNxIQ','Artist DNxIQ','Avid Artist DNxIQ','Avid Artist | DNxIQ']),
  'kb-imagine-platinum-vx': Object.freeze(['Platinum VX','Imagine Platinum VX','Imagine Communications Platinum VX']),
  'kb-axon-sfr08': Object.freeze(['SFR08','Axon SFR08','Axon Synapse SFR08']),
  'kb-ross-ultrix': Object.freeze(['Ross Ultrix','Ultrix']),
  'kb-ross-opengear-ogx': Object.freeze(['Ross openGear OGx','openGear OGx','OGx']),
  'kb-avid-nexis': Object.freeze(['Avid NEXIS','AVID NEXIS']),
  'kb-hp-lp2475w': Object.freeze(['HP LP2475w','LP2475w']),
  'kb-dell-precision3930r': Object.freeze(['DELL 3930','DELL R3930','Precision 3930 Rack']),
  'kb-dell-r450': Object.freeze(['DELL R450','PowerEdge R450']),
  'kb-dell-r750': Object.freeze(['DELL R750','PowerEdge R750']),
  'kb-orban2200': Object.freeze(['Orban 2200','OPTIMOD 2200','Orban Optimod 2200','Orban 2200 OPTIMOD-FM']),
  'kb-leader-lv5300a': Object.freeze(['LV5300A','Leader LV5300A','LEADER LV5300A']),
  'kb-leader-lv5350': Object.freeze(['LV5350','Leader LV5350','LEADER LV5350']),
  'kb-leader-lt4448': Object.freeze(['LT4448','LT 4448','Leader LT4448','LEADER LT4448']),
  'kb-cisco-c9300x12y': Object.freeze(['C9300X-12Y','Cisco C9300X-12Y','Cisco Catalyst C9300X-12Y']),
  // L'identifiant canonique de catalogue reste public — c'est lui qui relie une fiche
  // d'équipement à son modèle (#137). Ce qui ne revient pas, ce sont les variantes qui
  // écrivaient la capacité d'installation en clair. La liste d'alias n'est pas recopiée
  // ici : elle est réutilisée depuis l'unique source déjà publique.
  [GRILLE_CENTRALE_CATALOG_ID]: GRILLE_CENTRALE_ALIASES
});

const asArray = value => Array.isArray(value) ? value : [];
const isCatalog = record => record?.kind === 'equipment_catalog' || record?.targetType === 'equipment_catalog';
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim()
  .replace(/\s+/g,' ');

function mergeAliases(current, incoming) {
  const values = new Map();
  for (const value of [...asArray(current), ...asArray(incoming)]) {
    const key = normalize(value);
    if (!key || values.has(key)) continue;
    values.set(key, String(value).trim());
  }
  return [...values.values()];
}

function evidenceValues(equipment = {}) {
  return [
    equipment.catalogId,
    equipment.inventorySource?.reference,
    equipment.inventorySource?.label,
    equipment.inventorySource?.name,
    equipment.modele,
    equipment.model,
    equipment.name,
    equipment.nom,
    equipment.marque && equipment.modele ? `${equipment.marque} ${equipment.modele}` : '',
    equipment.manufacturer && equipment.model ? `${equipment.manufacturer} ${equipment.model}` : ''
  ].map(normalize).filter(Boolean);
}

export function resolveCatalogIdForMedia(equipment = {}, catalogs = []) {
  const directId = String(equipment.catalogId || '').trim();
  if (directId && catalogs.some(record => String(record.id) === directId)) return directId;

  const evidence = new Set(evidenceValues(equipment));
  if (!evidence.size) return '';

  const matches = [];
  for (const catalog of catalogs) {
    const id = String(catalog?.id || '');
    if (!id) continue;
    // Les alias d'une installation protégée ne doivent jamais être recopiés dans cette
    // configuration publique. Ils restent disponibles dans `catalog.inventoryAliases`
    // uniquement après chargement autorisé de la connaissance correspondante.
    const configured = EQUIPMENT_MEDIA_ALIASES[id] || [];
    const candidates = [
      ...asArray(catalog.inventoryAliases),
      ...configured,
      catalog.model,
      catalog.family,
      catalog.manufacturer && catalog.model ? `${catalog.manufacturer} ${catalog.model}` : ''
    ].map(normalize).filter(Boolean);
    if (candidates.some(candidate => evidence.has(candidate))) matches.push(id);
  }
  return matches.length === 1 ? matches[0] : '';
}

function adminCatalog(record) {
  return record?.origin === 'admin' || record?.imageResearch?.origin === 'admin';
}

async function runEquipmentMediaLinkageCore() {
  await db.open();

  const docs = (await db.getAll('docs')).filter(isCatalog);
  let aliasesUpdated = 0;
  for (const record of docs) {
    const aliases = EQUIPMENT_MEDIA_ALIASES[String(record.id)];
    if (!aliases || adminCatalog(record)) continue;
    const merged = mergeAliases(record.inventoryAliases, aliases);
    if (JSON.stringify(merged) === JSON.stringify(asArray(record.inventoryAliases))
      && Number(record.mediaLinkageVersion || 0) >= EQUIPMENT_MEDIA_LINKAGE_VERSION) continue;
    await db.save('docs', {
      ...record,
      inventoryAliases:merged,
      mediaLinkageVersion:EQUIPMENT_MEDIA_LINKAGE_VERSION,
      mediaLinkageUpdatedAt:'2026-08-31'
    });
    aliasesUpdated += 1;
  }

  const refreshedCatalogs = (await db.getAll('docs')).filter(isCatalog);
  const equipments = await db.getAll('equipments');
  let equipmentLinked = 0;
  const catalogueExiste = id => refreshedCatalogs.some(record => String(record.id) === String(id));
  for (const equipment of equipments) {
    // Un rattachement PENDANT n'était jamais réparé.
    //
    // La boucle sautait toute fiche portant déjà un `catalogId`, sans vérifier qu'il
    // désigne quelque chose. Mesuré en base : douze équipements pointaient vers
    // `kb-sony-vtr`, une entrée de catalogue qui n'existe pas. Ils étaient donc écartés de
    // la réparation À CAUSE du lien cassé lui-même, et n'affichaient jamais d'image — sans
    // qu'aucun message ne l'explique.
    const actuel = String(equipment.catalogId || '').trim();
    if (actuel && catalogueExiste(actuel)) continue;
    const catalogId = resolveCatalogIdForMedia(equipment, refreshedCatalogs);
    if (!catalogId || catalogId === actuel) continue;
    await db.save('equipments', {
      ...equipment,
      catalogId,
      mediaLinkageVersion:EQUIPMENT_MEDIA_LINKAGE_VERSION,
      mediaLinkageUpdatedAt:'2026-08-31'
    });
    equipmentLinked += 1;
  }

  return { version:EQUIPMENT_MEDIA_LINKAGE_VERSION, aliasesUpdated, equipmentLinked, catalogs:refreshedCatalogs.length, equipments:equipments.length };
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * Les dépendances (lot 8, puis la connaissance Grille Centrale) sont résolues
 * AVANT d'entrer dans la file partagée : `ensureGrilleCentraleKnowledge()` rappelle
 * elle-même le lot 8, donc l'appeler depuis l'intérieur d'un tour créerait une
 * attente circulaire sur cette même file. La reprise Grille Centrale conditionnelle
 * et l'évènement restent, comme avant, hors de la section lecture-écriture propre à
 * ce module.
 */
let vol = null;
export function ensureEquipmentMediaLinkage() {
  if (vol) return vol;
  vol = (async () => {
    await ensureEquipmentImageCoverageBatch8();
    await ensureGrilleCentraleKnowledge();
    const result = await withCatalogEnrichmentGate(runEquipmentMediaLinkageCore);
    if (result.equipmentLinked) await ensureGrilleCentraleKnowledge().catch(() => null);
    if (result.equipmentLinked && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('equipment-media-linkage-updated', { detail:{ equipmentLinked:result.equipmentLinked } }));
    }
    return result;
  })().finally(() => { vol = null; });
  return vol;
}

let reconcileTimer = null;
function scheduleReconcile(delay = 250) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => ensureEquipmentMediaLinkage().catch(error => console.warn('Liaison média différée', error)), delay);
}

if (typeof window !== 'undefined') {
  window.EquipmentMediaLinkage = Object.freeze({
    version:EQUIPMENT_MEDIA_LINKAGE_VERSION,
    ensure:ensureEquipmentMediaLinkage,
    resolve:resolveCatalogIdForMedia,
    aliases:EQUIPMENT_MEDIA_ALIASES
  });
  window.addEventListener('central-sync-status', event => {
    if (event.detail?.state === 'synced') scheduleReconcile();
  });
  window.addEventListener('inventory-master-imported', () => scheduleReconcile());
  window.addEventListener('equipment-field-evidence-updated', () => scheduleReconcile(350));
  window.addEventListener('load', () => scheduleReconcile(500));
  await ensureEquipmentMediaLinkage().catch(error => console.warn('Liaison média indisponible', error));
  scheduleReconcile(1500);
  setTimeout(() => scheduleReconcile(250), 4000);
}
