import http from 'node:http';
import pg from 'pg';
import { compareAndWrite } from './revision-store.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || '';
const catalogPool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized:false } : false,
  max: Math.max(1, Math.min(2, Number(process.env.CATALOG_PGPOOL_MAX || 2)))
}) : null;

const CATALOG_LOCK_KEY = '2mtech-central-catalog';
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Content-Length':Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req, maxBytes = MAX_CATALOG_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Catalogue technique trop volumineux.'), { status:413, code:'CATALOG_PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Payload JSON invalide.'), { status:400, code:'INVALID_JSON' }); }
}

async function authenticateAdmin(req) {
  const port = Number(process.env.PORT || 4173);
  const headers = {};
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/session`, { headers, redirect:'manual' });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload?.user) throw Object.assign(new Error('Session requise.'), { status:401, code:'UNAUTHENTICATED' });
  if (!['admin','manager'].includes(String(payload.user.role || '').trim().toLowerCase())) {
    throw Object.assign(new Error('Seul un administrateur global peut installer le catalogue central.'), { status:403, code:'CATALOG_INSTALL_FORBIDDEN' });
  }
  return payload.user;
}

function normalizePayload(raw) {
  const version = Number(raw?.version || 0);
  if (!Number.isInteger(version) || version < 1) throw Object.assign(new Error('Version de catalogue invalide.'), { status:400, code:'INVALID_CATALOG_VERSION' });
  if (!Array.isArray(raw?.records)) throw Object.assign(new Error('La liste records est requise.'), { status:400, code:'INVALID_CATALOG_RECORDS' });
  const seen = new Set();
  const records = raw.records.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw Object.assign(new Error(`Document ${index + 1} invalide.`), { status:400, code:'INVALID_CATALOG_RECORD' });
    const id = String(source.id ?? '').trim();
    if (!id) throw Object.assign(new Error(`Document ${index + 1}: identifiant stable requis.`), { status:400, code:'INVALID_CATALOG_RECORD' });
    if (seen.has(id)) throw Object.assign(new Error(`Identifiant de catalogue dupliqué: ${id}.`), { status:409, code:'DUPLICATE_CATALOG_ID' });
    seen.add(id);
    return { ...source, id, catalogSeedVersion:version };
  });
  if (records.length > 5000) throw Object.assign(new Error('Catalogue trop volumineux.'), { status:413, code:'CATALOG_TOO_MANY_RECORDS' });
  return { version, records };
}

async function currentCatalogVersion(client) {
  const result = await client.query("SELECT data FROM platform_records WHERE store_name='settings' AND record_id='global' AND deleted=FALSE LIMIT 1");
  return Number(result.rows[0]?.data?.catalogSeedVersion || 0);
}

// L'ensemencement du catalogue est une décision serveur : il ne se compare à rien, mais il
// fait avancer le compteur de version. Un `INSERT` brut le remettait à zéro, et un compteur
// qui recule laisse une session ouverte redevenir « à jour » et tout écraser.
async function upsertDocument(client, record) {
  await compareAndWrite(catalogPool, {
    storeName: 'docs', recordId: String(record.id), record, force: true, client
  });
}

async function writeCatalogVersion(client, version, userId) {
  const existingResult = await client.query("SELECT data FROM platform_records WHERE store_name='settings' AND record_id='global' LIMIT 1");
  const existing = existingResult.rows[0]?.data && typeof existingResult.rows[0].data === 'object' ? existingResult.rows[0].data : {};
  const next = {
    ...existing,
    id:'global',
    language:'fr',
    catalogSeedVersion:version,
    catalogSeedUpdatedAt:new Date().toISOString(),
    catalogSeedUpdatedBy:userId ?? null
  };
  await compareAndWrite(catalogPool, {
    storeName: 'settings', recordId: 'global', record: next, force: true, client
  });
}

async function handleCatalogInstall(req, res) {
  let client;
  try {
    if (!catalogPool) throw Object.assign(new Error('PostgreSQL central indisponible.'), { status:503, code:'DATABASE_UNAVAILABLE' });
    const user = await authenticateAdmin(req);
    const payload = normalizePayload(await readJson(req));
    client = await catalogPool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CATALOG_LOCK_KEY]);
    const installedVersion = await currentCatalogVersion(client);
    if (installedVersion >= payload.version) {
      await client.query('COMMIT');
      sendJson(res, 200, { ok:true, installed:false, version:installedVersion, written:0, reason:'already-current' });
      return;
    }
    for (const record of payload.records) await upsertDocument(client, record);
    await writeCatalogVersion(client, payload.version, user.id);
    await client.query('COMMIT');
    sendJson(res, 200, { ok:true, installed:true, version:payload.version, previousVersion:installedVersion, written:payload.records.length });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    sendJson(res, Number(error.status || 500), { error:error.code || 'CATALOG_INSTALL_FAILED', message:error.message || 'Installation du catalogue impossible.' });
  } finally {
    client?.release();
  }
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function createServerWithCatalogMigration(requestListener, ...args) {
  return previousCreateServer(async (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; } catch {}
    if (req.method === 'POST' && pathname === '/api/sync/catalog-install') {
      await handleCatalogInstall(req, res);
      return;
    }
    return requestListener(req, res);
  }, ...args);
};

export { normalizePayload as validateCatalogInstallPayload };
