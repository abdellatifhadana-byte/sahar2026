import { db } from './db.js';
import './db-migration-v15.js';

const TARGET_VERSION = 16;
if (Number(db.version) < TARGET_VERSION) db.version = TARGET_VERSION;

/**
 * Magasin `backups` : les sauvegardes sont CONSERVÉES au lieu d'être téléchargées.
 *
 * La sauvegarde automatique appelait un téléchargement de fichier toutes les semaines,
 * sans geste de l'utilisateur — ce que les navigateurs bloquent. Aucune sauvegarde
 * n'était donc conservée, aucune n'était consultable, et rien ne le signalait.
 *
 * Ce magasin reste STRICTEMENT LOCAL : il n'est pas dans `SYNC_STORES`, et il ne doit
 * jamais y entrer. Une sauvegarde est une copie complète de la base du poste ; la
 * téléverser reviendrait à renvoyer au serveur, à chaque client et chaque semaine, un
 * double de ce qu'il détient déjà.
 */
const originalCreateStores = db.createStores.bind(db);
db.createStores = function createStoresWithBackups(database, transaction) {
  originalCreateStores(database, transaction);
  if (!database.objectStoreNames.contains('backups')) {
    const store = database.createObjectStore('backups', { keyPath: 'id' });
    store.createIndex('createdAt', 'createdAt');
    store.createIndex('reason', 'reason');
  }
};

export { TARGET_VERSION };
