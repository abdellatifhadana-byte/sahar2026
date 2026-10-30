import { db } from './db.js';
import './db-migration-v16.js';

const TARGET_VERSION = 17;
if (Number(db.version) < TARGET_VERSION) db.version = TARGET_VERSION;

/**
 * Magasin `locations` : ville → région → département.
 *
 * La plateforme s'arrêtait à la salle. Au-dessus, il n'y avait qu'un champ `location`
 * LIBRE sur chaque salle : du texte, sans structure, sans parent, impossible à parcourir
 * ni à totaliser. Deux salles du même bâtiment n'avaient aucun lien entre elles, et rien
 * ne permettait de demander « tout ce qui est à Casablanca ».
 *
 * UN SEUL MAGASIN POUR LES TROIS NIVEAUX. Ils se comportent exactement pareil — un nom,
 * un parent, des enfants, une zone dessinable sur le plan. Le niveau est donc une
 * PROPRIÉTÉ (`kind`), pas un magasin : ajouter « bâtiment » ou « étage » plus tard sera
 * une valeur de plus, pas une migration. Voir location-contract.js.
 *
 * POURQUOI UNE MIGRATION ET NON UNE MODIFICATION DE db.js
 * ------------------------------------------------------
 * La plateforme a déjà sa convention : le schéma de base reste figé, et chaque ajout
 * arrive par un module qui monte la version et enveloppe `createStores` (v15, v16).
 * Modifier directement db.js aurait rendu `db-migration-v15.js` silencieusement inerte —
 * sa condition `db.version < 15` n'aurait plus jamais été vraie — sans que rien ne le
 * signale. On suit donc la convention plutôt que de la contourner.
 *
 * Ce magasin EST synchronisé : contrairement aux sauvegardes, une échelle de lieux est
 * commune à toute la chaîne et doit être la même sur chaque poste.
 */
const originalCreateStores = db.createStores.bind(db);
db.createStores = function createStoresWithLocations(database, transaction) {
  originalCreateStores(database, transaction);

  if (!database.objectStoreNames.contains('locations')) {
    const store = database.createObjectStore('locations', { keyPath: 'id', autoIncrement: true });
    store.createIndex('kind', 'kind');
    store.createIndex('parentId', 'parentId');
    store.createIndex('name', 'name');
  }

  // Les salles gagnent un index sur leur lieu de rattachement — ville, région ou
  // département : une unité mobile garée dans une cour ne pend d'aucun département, et
  // l'index n'a jamais fait cette distinction. L'index se pose sur
  // le magasin EXISTANT, à travers la transaction de mise à niveau : sans elle, la
  // création échouerait sur une base déjà en place.
  if (database.objectStoreNames.contains('rooms') && transaction) {
    const rooms = transaction.objectStore('rooms');
    if (!rooms.indexNames.contains('locationId')) rooms.createIndex('locationId', 'locationId');
  }
};

export { TARGET_VERSION };
