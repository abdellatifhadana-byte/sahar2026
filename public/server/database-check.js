// Pre-startup check: verify better-sqlite3 works
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE test (id INTEGER)');
  db.close();
  console.log('[DB] ✅ better-sqlite3 working correctly');
  process.exit(0);
} catch (e) {
  console.error('[DB] ❌ better-sqlite3 failed:', e.message);
  process.exit(1);
}
