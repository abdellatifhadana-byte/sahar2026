import { db } from './db.js';

const TARGET_VERSION = 15;
if (Number(db.version) < TARGET_VERSION) db.version = TARGET_VERSION;

const originalCreateStores = db.createStores.bind(db);
db.createStores = function(database, transaction) {
  originalCreateStores(database, transaction);
  if (!transaction || !database.objectStoreNames.contains('users')) return;
  const users = transaction.objectStore('users');
  if (users.indexNames.contains('username') && users.index('username').unique) {
    users.deleteIndex('username');
  }
  if (!users.indexNames.contains('username')) {
    users.createIndex('username', 'username', { unique: false });
  }
};

export { TARGET_VERSION };
