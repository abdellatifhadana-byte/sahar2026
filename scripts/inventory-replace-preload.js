import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validateEquipmentKnowledge } from '../equipment-knowledge-contract.js';
import { TOPOLOGY_KIND_SET } from '../topology-contract.js';
import { CONTINUITY_KIND_SET } from '../continuity-contract.js';
import { DIAGRAM_RECORD_KIND } from '../diagram-contract.js';
import { compareAndWrite, tombstoneManyWithRevision } from './revision-store.js';
import {
  normalizePorts,
  normalizeCableRecord,
  validateCableShape,
  validateEquipmentConnectivity,
  validateScreenConnectivity,
  evaluateConnection,
  isCableActive,
  validateSignalModeForPorts
} from '../connectivity-contract.js';

const { Pool } = pg;

export const OPERATIONAL_STORES = Object.freeze([
  'rooms','baies','equipments','walls','screens','screen_groups','screen_issues',
  'diagnosis_history','tickets','notes','attachments','cables','cable_reports'
]);

// An inventory package may describe the physical inventory/topology only.
// Operational history is deliberately reset but never imported from an inventory file.
export const INVENTORY_IMPORT_STORES = Object.freeze([
  'rooms','baies','equipments','walls','screens','screen_groups','cables'
]);

const OPERATIONAL_SET = new Set(OPERATIONAL_STORES);
const IMPORT_SET = new Set(INVENTORY_IMPORT_STORES);
const RESOURCE_TYPE_TO_STORE = Object.freeze({
  room:'rooms', salle:'rooms',
  baie:'baies',
  equipment:'equipments', equipement:'equipments',
  wall:'walls', mur:'walls',
  screen:'screens', ecran:'screens',
  screen_group:'screen_groups',
  cable:'cables'
});

const databaseUrl = process.env.DATABASE_URL || '';
const inventoryPool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max: Math.max(1, Math.min(3, Number(process.env.INVENTORY_PGPOOL_MAX || 2)))
}) : null;

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const idText = value => String(value ?? '');
const asArray = value => Array.isArray(value) ? value : [];
const isOperationalDocumentKind = kind => kind === DIAGRAM_RECORD_KIND || TOPOLOGY_KIND_SET.has(kind) || CONTINUITY_KIND_SET.has(kind);

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req, maxBytes = 32 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Fichier inventaire trop volumineux.'), { status:413, code:'INVENTORY_PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Payload JSON invalide.'), { status:400, code:'INVALID_JSON' }); }
}

async function authenticateAgainstPrimaryServer(req) {
  const port = Number(process.env.PORT || 4173);
  const headers = {};
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/session`, { headers, redirect:'manual' });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload?.user) {
    throw Object.assign(new Error('Session requise.'), { status:401, code:'UNAUTHENTICATED' });
  }
  if (!['admin','manager'].includes(String(payload.user.role || '').toLowerCase())) {
    throw Object.assign(new Error('Seul un administrateur ou manager peut remplacer l’inventaire opérationnel.'), { status:403, code:'INVENTORY_REPLACE_FORBIDDEN' });
  }
  return payload.user;
}

function uniqueIds(records, storeName, errors) {
  const seen = new Set();
  for (const record of records) {
    if (record?.id === undefined || record?.id === null || record.id === '') {
      errors.push(`${storeName}: chaque enregistrement doit posséder un identifiant stable.`);
      continue;
    }
    const key = idText(record.id);
    if (seen.has(key)) errors.push(`${storeName}: identifiant dupliqué ${key}.`);
    seen.add(key);
  }
}

function normalizeIncomingEquipment(record) {
  const knowledge = validateEquipmentKnowledge(record);
  if (knowledge.errors.length) throw Object.assign(new Error(knowledge.errors.join(' ')), { status:400, code:'INVALID_EQUIPMENT_KNOWLEDGE', details:knowledge.errors });
  const connectivity = validateEquipmentConnectivity(knowledge.value);
  if (connectivity.errors.length) throw Object.assign(new Error(connectivity.errors.join(' ')), { status:400, code:'INVALID_EQUIPMENT_CONNECTIVITY', details:connectivity.errors });
  return connectivity.value;
}

function normalizeIncomingScreen(record) {
  const connectivity = validateScreenConnectivity(record);
  if (connectivity.errors.length) throw Object.assign(new Error(connectivity.errors.join(' ')), { status:400, code:'INVALID_SCREEN_CONNECTIVITY', details:connectivity.errors });
  return connectivity.value;
}

function resolveCableEndpoint(record, side, equipmentMap, screenMap) {
  const type = record[`${side}Type`] || 'equipment';
  const endpointId = record[`${side}Id`];
  const portId = record[`${side}PortId`];
  if (type === 'screen') {
    const entity = screenMap.get(idText(endpointId));
    const port = normalizePorts(entity?.ports).find(item => idText(item.id) === idText(portId));
    return { entity, port, identity:`screen:${endpointId}:${portId}` };
  }
  if (type === 'component') {
    const parentId = record[`${side}ParentEquipmentId`];
    const parent = equipmentMap.get(idText(parentId));
    const entity = asArray(parent?.components).find(item => idText(item.id) === idText(endpointId));
    const port = normalizePorts(entity?.ports).find(item => idText(item.id) === idText(portId));
    return { entity, parent, port, identity:`component:${parentId}:${endpointId}:${portId}` };
  }
  const entity = equipmentMap.get(idText(endpointId));
  const port = normalizePorts(entity?.ports).find(item => idText(item.id) === idText(portId));
  return { entity, port, identity:`equipment:${endpointId}:${portId}` };
}

function normalizeIncomingCables(records, equipments, screens) {
  const equipmentMap = new Map(equipments.map(record => [idText(record.id), record]));
  const screenMap = new Map(screens.map(record => [idText(record.id), record]));
  const occupied = new Map();
  const output = [];
  for (const source of records) {
    const shape = validateCableShape(source);
    if (shape.errors.length) throw Object.assign(new Error(shape.errors.join(' ')), { status:400, code:'INVALID_CABLE', details:shape.errors });
    const record = normalizeCableRecord(shape.value);
    const from = resolveCableEndpoint(record, 'source', equipmentMap, screenMap);
    const to = resolveCableEndpoint(record, 'destination', equipmentMap, screenMap);
    const errors = [];
    if (!from.entity) errors.push('La source du câble est absente du nouvel inventaire.');
    if (!from.port) errors.push('Le port source du câble est absent du nouvel inventaire.');
    if (!to.entity) errors.push('La destination du câble est absente du nouvel inventaire.');
    if (!to.port) errors.push('Le port destination du câble est absent du nouvel inventaire.');
    if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status:400, code:'INVALID_CABLE_REFERENCE', details:errors });
    const modeErrors = validateSignalModeForPorts(record, from.port, to.port);
    if (modeErrors.length) throw Object.assign(new Error(modeErrors.join(' ')), { status:400, code:'INVALID_SIGNAL_MODE_FOR_PORTS', details:modeErrors });
    const compatibility = evaluateConnection({ sourcePort:from.port, destinationPort:to.port, cable:record });
    if (['incompatible','requires-converter','requires-adapter'].includes(compatibility.status)) {
      const details = [...compatibility.reasons, ...compatibility.suggestions];
      throw Object.assign(new Error(details.join(' ')), { status:400, code:'INCOMPATIBLE_CABLE', details });
    }
    if (isCableActive(record)) {
      for (const endpoint of [from, to]) {
        if (occupied.has(endpoint.identity)) {
          const details = [`Le port ${endpoint.identity} est déjà utilisé par ${occupied.get(endpoint.identity)}.`];
          throw Object.assign(new Error(details[0]), { status:409, code:'PORT_ALREADY_CONNECTED', details });
        }
      }
      occupied.set(from.identity, record.reference || record.id);
      occupied.set(to.identity, record.reference || record.id);
    }
    output.push({ ...record, compatibility, connectivityVersion:1 });
  }
  return output;
}

export function validateInventoryReplacementPayload(raw) {
  const data = raw?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Le payload doit contenir un objet data.'), { status:400, code:'INVALID_INVENTORY_REPLACEMENT' });
  }
  const errors = [];
  for (const [storeName, records] of Object.entries(data)) {
    if (!IMPORT_SET.has(storeName)) errors.push(`Store interdit dans un inventaire: ${storeName}.`);
    else if (!Array.isArray(records)) errors.push(`${storeName}: une liste est requise.`);
  }
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status:400, code:'INVALID_INVENTORY_REPLACEMENT', details:errors });

  const normalized = Object.fromEntries(INVENTORY_IMPORT_STORES.map(name => [name, asArray(data[name]).map(record => ({ ...record }))]));
  for (const [storeName, records] of Object.entries(normalized)) uniqueIds(records, storeName, errors);

  normalized.equipments = normalized.equipments.map(normalizeIncomingEquipment);
  normalized.screens = normalized.screens.map(normalizeIncomingScreen);
  normalized.cables = normalizeIncomingCables(normalized.cables, normalized.equipments, normalized.screens);

  const roomIds = new Set(normalized.rooms.map(record => idText(record.id)));
  const baieIds = new Set(normalized.baies.map(record => idText(record.id)));
  const wallIds = new Set(normalized.walls.map(record => idText(record.id)));
  const screenIds = new Set(normalized.screens.map(record => idText(record.id)));

  for (const baie of normalized.baies) {
    if (baie.roomId != null && !roomIds.has(idText(baie.roomId))) errors.push(`Baie ${baie.name || baie.id}: salle ${baie.roomId} introuvable.`);
  }
  const baieById = new Map(normalized.baies.map(record => [idText(record.id), record]));
  for (const equipment of normalized.equipments) {
    if (equipment.roomId != null && !roomIds.has(idText(equipment.roomId))) errors.push(`${equipment.name || equipment.id}: salle ${equipment.roomId} introuvable.`);
    if (equipment.baieId != null && !baieIds.has(idText(equipment.baieId))) errors.push(`${equipment.name || equipment.id}: baie ${equipment.baieId} introuvable.`);
    const baie = equipment.baieId != null ? baieById.get(idText(equipment.baieId)) : null;
    if (baie?.roomId != null && equipment.roomId != null && idText(baie.roomId) !== idText(equipment.roomId)) errors.push(`${equipment.name || equipment.id}: salle différente de celle de la baie ${baie.name || baie.id}.`);
  }
  for (const wall of normalized.walls) {
    if (wall.roomId != null && !roomIds.has(idText(wall.roomId))) errors.push(`Mur ${wall.name || wall.id}: salle ${wall.roomId} introuvable.`);
  }
  const wallById = new Map(normalized.walls.map(record => [idText(record.id), record]));
  for (const screen of normalized.screens) {
    if (screen.roomId != null && !roomIds.has(idText(screen.roomId))) errors.push(`Écran ${screen.name || screen.id}: salle ${screen.roomId} introuvable.`);
    if (screen.wallId != null && !wallIds.has(idText(screen.wallId))) errors.push(`Écran ${screen.name || screen.id}: mur ${screen.wallId} introuvable.`);
    const wall = screen.wallId != null ? wallById.get(idText(screen.wallId)) : null;
    if (wall?.roomId != null && screen.roomId != null && idText(wall.roomId) !== idText(screen.roomId)) errors.push(`Écran ${screen.name || screen.id}: salle différente de celle du mur ${wall.name || wall.id}.`);
  }
  for (const group of normalized.screen_groups) {
    for (const screenId of asArray(group.screenIds)) if (!screenIds.has(idText(screenId))) errors.push(`Groupe ${group.name || group.id}: écran ${screenId} introuvable.`);
  }
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status:400, code:'INVENTORY_VALIDATION_FAILED', details:[...new Set(errors)] });

  return normalized;
}

/**
 * Le remplacement central écrit SANS se comparer — c'est une décision délibérée sur un
 * inventaire entier, pas la modification d'une fiche ouverte — mais il fait AVANCER le
 * compteur de version.
 *
 * L'`INSERT` brut qui était ici ne portait aucun compteur : l'enregistrement retombait donc
 * à la révision 0, et le compteur RECULAIT. La garde se retournait alors contre elle-même —
 * une session ouverte sur la révision 4 avant le remplacement redevenait « à jour » dès que
 * quatre modifications ordinaires avaient ramené le compteur à 4, et écrasait tout ce qui
 * avait été écrit depuis. Un compteur qui recule ne garde rien.
 */
async function upsertRecord(client, storeName, record) {
  await compareAndWrite(inventoryPool, {
    storeName, recordId: idText(record.id), record, force: true, client
  });
}

/*
 * Retirer une fiche du remplacement : par le magasin, donc en faisant avancer le compteur.
 *
 * L'`UPDATE … SET deleted=TRUE` d'origine faisait disparaître la fiche sans toucher à sa
 * révision. `docs` est pourtant un magasin à révision : une session restée ouverte sur un
 * document retiré se croyait à jour et pouvait le faire revivre au premier enregistrement.
 */
async function tombstoneById(client, storeName, id) {
  await tombstoneManyWithRevision(inventoryPool, {
    storeName, recordIds: [idText(id)], client
  });
}

async function retireOperationalDocuments(client) {
  const result = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='docs' AND deleted=FALSE");
  const retiredIds = [];
  for (const row of result.rows) {
    if (!isOperationalDocumentKind(row.data?.kind)) continue;
    retiredIds.push(idText(row.record_id));
    await tombstoneById(client, 'docs', row.record_id);
  }
  if (!retiredIds.length) return retiredIds;

  const mappings = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='resource_zones' AND deleted=FALSE");
  for (const row of mappings.rows) {
    const resourceType = String(row.data?.resourceType || '').toLowerCase();
    if (!['doc','docs','document'].includes(resourceType)) continue;
    if (retiredIds.includes(idText(row.data?.resourceId))) await tombstoneById(client, 'resource_zones', row.record_id);
  }
  return retiredIds;
}

async function cleanupStaleAccessModel(client, normalized) {
  const incomingByStore = new Map(INVENTORY_IMPORT_STORES.map(storeName => [storeName, new Set(normalized[storeName].map(record => idText(record.id)))]));
  const mappingsResult = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='resource_zones' AND deleted=FALSE");
  for (const row of mappingsResult.rows) {
    const resourceStore = RESOURCE_TYPE_TO_STORE[String(row.data?.resourceType || '').toLowerCase()];
    if (!resourceStore || !OPERATIONAL_SET.has(resourceStore)) continue;
    if (!incomingByStore.get(resourceStore)?.has(idText(row.data?.resourceId))) await tombstoneById(client, 'resource_zones', row.record_id);
  }

  const roomIds = incomingByStore.get('rooms');
  const zonesResult = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='zones' AND deleted=FALSE");
  const removedAutoZoneIds = [];
  for (const row of zonesResult.rows) {
    const roomId = row.data?.autoCreatedFromRoomId;
    if (roomId == null || roomIds.has(idText(roomId))) continue;
    removedAutoZoneIds.push(idText(row.record_id));
    await tombstoneById(client, 'zones', row.record_id);
  }
  if (removedAutoZoneIds.length) {
    for (const storeName of ['resource_zones','zone_memberships','zone_grants','access_requests']) {
      const rows = await client.query(`SELECT record_id,data FROM platform_records WHERE store_name=$1 AND deleted=FALSE`, [storeName]);
      for (const row of rows.rows) if (removedAutoZoneIds.includes(idText(row.data?.zoneId))) await tombstoneById(client, storeName, row.record_id);
    }
  }
}

async function ensureRoomAccessModel(client, rooms) {
  const zonesResult = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='zones' AND deleted=FALSE");
  const mappingsResult = await client.query("SELECT record_id,data FROM platform_records WHERE store_name='resource_zones' AND deleted=FALSE");
  const zones = new Map(zonesResult.rows.map(row => [idText(row.record_id), row.data]));
  const mappings = mappingsResult.rows.map(row => ({ id:row.record_id, ...row.data }));

  for (const room of rooms) {
    /*
     * LA MÊME RÈGLE QU'`ensureModel`, ET DANS LE MÊME ORDRE.
     *
     * Cette boucle est une seconde copie de la migration, chargée par `npm start`. Elle
     * portait la ligne d'origine — `room.zoneId || explicit?.zoneId || 'room-'+id` — qui
     * fait passer le champ HÉRITÉ avant le rattachement explicite. Corriger `ensureModel`
     * sans la corriger ici aurait suffi à ramener une salle déplacée dans son ancienne
     * zone au démarrage suivant : le défaut serait revenu par la porte de service.
     *
     * `resource_zones` d'abord ; l'héritage ensuite, et seulement s'il désigne une zone
     * qui existe ; la zone transitoire en dernier recours. Un désaccord entre les deux
     * n'est PAS arbitré ici : la salle est laissée telle quelle, et `ensureModel` la
     * signalera comme conflit.
     */
    const roomMappings = mappings.filter(mapping => String(mapping.resourceType || '').toLowerCase() === 'room' && idText(mapping.resourceId) === idText(room.id));
    const explicites = [...new Set(roomMappings
      .filter(mapping => !zones.get(idText(mapping.zoneId))?.autoCreatedFromRoomId)
      .map(mapping => idText(mapping.zoneId)))];
    const heritees = [...new Set([...(Array.isArray(room.zoneIds) ? room.zoneIds : []), room.zoneId]
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(idText))].filter(candidate => zones.has(candidate));
    const divergentes = heritees.filter(candidate => !explicites.includes(candidate));
    if (explicites.length > 1 || (explicites.length && divergentes.length)) continue;
    const zoneId = idText(explicites[0] ?? heritees[0] ?? `room-${room.id}`);
    const existingZone = zones.get(zoneId);
    if (!existingZone) {
      const zone = {
        id:zoneId,
        name:text(room.name || room.nom || `Salle ${room.id}`, 180),
        slug:text(room.name || room.nom || `salle-${room.id}`, 180).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone',
        publicSummary:'Zone technique 2M. Accès détaillé soumis à autorisation.',
        imageUrl:room.imageUrl || room.image || '',
        status:'active', autoCreatedFromRoomId:room.id,
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
      };
      await upsertRecord(client, 'zones', zone);
      zones.set(zoneId, zone);
    } else if (existingZone.autoCreatedFromRoomId && idText(existingZone.autoCreatedFromRoomId) === idText(room.id)) {
      const updated = { ...existingZone, name:text(room.name || room.nom || existingZone.name, 180), imageUrl:room.imageUrl || room.image || existingZone.imageUrl || '', updatedAt:new Date().toISOString() };
      await upsertRecord(client, 'zones', updated);
      zones.set(zoneId, updated);
    }

    const hasMapping = roomMappings.some(mapping => idText(mapping.zoneId) === zoneId);
    if (!hasMapping) {
      await upsertRecord(client, 'resource_zones', {
        id:`RZ-room-${room.id}-${zoneId}`, resourceType:'room', resourceId:room.id, zoneId, createdAt:new Date().toISOString()
      });
    }
    // Une salle = UN rattachement. Ceux qui restent — typiquement une zone transitoire
    // devenue inutile — s'effacent, sinon la salle repartirait avec deux zones et
    // deviendrait un conflit fabriqué par la migration elle-même.
    for (const mapping of roomMappings) {
      if (idText(mapping.zoneId) !== zoneId) await tombstoneById(client, 'resource_zones', mapping.id);
    }
    // Le champ hérité a fini son office : le garder, c'est garder une seconde vérité.
    if (room.zoneId !== undefined || room.zoneIds !== undefined) {
      const { zoneId:_herite, zoneIds:_herites, ...propre } = room;
      await upsertRecord(client, 'rooms', propre);
    }
  }
}

export async function replaceOperationalInventory(user, normalized) {
  if (!inventoryPool) throw Object.assign(new Error('DATABASE_URL n’est pas configurée.'), { status:503, code:'CENTRAL_DATABASE_UNAVAILABLE' });
  const client = await inventoryPool.connect();
  try {
    await client.query('BEGIN');
    const beforeResult = await client.query(`SELECT store_name,COUNT(*)::int AS count FROM platform_records
      WHERE deleted=FALSE AND store_name = ANY($1::text[]) GROUP BY store_name`, [OPERATIONAL_STORES]);
    const beforeByStore = Object.fromEntries(beforeResult.rows.map(row => [row.store_name, Number(row.count)]));
    const replacedExisting = Object.values(beforeByStore).reduce((sum, count) => sum + count, 0);
    const retiredOperationalDocumentIds = await retireOperationalDocuments(client);

    // Le remplacement retire TOUT l'inventaire opérationnel avant de le réécrire. Chaque
    // magasin part en une seule instruction, mais par le magasin de révisions : sans quoi
    // les fiches retirées garderaient leur ancien compteur et les sessions ouvertes
    // dessus se croiraient à jour.
    for (const storeName of OPERATIONAL_STORES) {
      await tombstoneManyWithRevision(inventoryPool, { storeName, client });
    }

    for (const storeName of INVENTORY_IMPORT_STORES) {
      for (const record of normalized[storeName]) await upsertRecord(client, storeName, record);
    }

    await cleanupStaleAccessModel(client, normalized);
    await ensureRoomAccessModel(client, normalized.rooms);

    const afterCounts = Object.fromEntries(INVENTORY_IMPORT_STORES.map(storeName => [storeName, normalized[storeName].length]));
    await upsertRecord(client, 'access_audit', {
      id:`AUD-inventory-replace-${randomUUID()}`,
      actorId:user.id,
      subjectId:user.id,
      zoneId:null,
      action:'inventory.replace-operational',
      before:{ counts:beforeByStore, total:replacedExisting, operationalDocuments:retiredOperationalDocumentIds.length },
      after:{ counts:afterCounts, total:Object.values(afterCounts).reduce((sum, count) => sum + count, 0) },
      preserved:['users','knowledge-and-catalog-docs','faq','settings','logs','notifications','explicit-access-zones'],
      at:new Date().toISOString()
    });

    await client.query('COMMIT');
    return {
      replacedExisting,
      beforeByStore,
      counts:afterCounts,
      removedOperationalDocuments:retiredOperationalDocumentIds.length
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function handleInventoryReplacement(req, res) {
  try {
    if (!inventoryPool) throw Object.assign(new Error('Base PostgreSQL non configurée.'), { status:503, code:'CENTRAL_DATABASE_UNAVAILABLE' });
    const user = await authenticateAgainstPrimaryServer(req);
    const body = await readJson(req);
    const normalized = validateInventoryReplacementPayload(body);
    const replaced = await replaceOperationalInventory(user, normalized);
    sendJson(res, 200, {
      ok:true,
      message:'Inventaire opérationnel remplacé dans PostgreSQL.',
      replacedExisting:replaced.replacedExisting,
      beforeByStore:replaced.beforeByStore,
      counts:replaced.counts,
      removedOperationalDocuments:replaced.removedOperationalDocuments,
      preserved:['users','knowledge-and-catalog-docs','faq','settings','logs','notifications','explicit-access-zones'],
      serverTime:new Date().toISOString()
    });
  } catch (error) {
    console.error('Remplacement inventaire central refusé:', error?.message || error);
    sendJson(res, error.status || 500, {
      error:error.code || 'CENTRAL_INVENTORY_REPLACE_FAILED',
      message:error.message || 'Échec du remplacement de l’inventaire central.',
      details:error.details || []
    });
  }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function createServerWithInventoryReplacement(requestListener, ...args) {
  return originalCreateServer(async (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; } catch {}
    if (req.method === 'POST' && pathname === '/api/sync/inventory-replace') {
      await handleInventoryReplacement(req, res);
      return;
    }
    return requestListener(req, res);
  }, ...args);
};
