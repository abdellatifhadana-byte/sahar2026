import { db } from './db.js';
import {
  CHAMPS_CREDENTIELS, MAGASINS_PORTEURS_DE_CREDENTIELS, neutraliserEntreeHeritee,
  porteUnCredentiel, sanitizeLocalUserCredentialFields
} from './local-credential-contract.js';

/*
 * CE GARDE NE PEUT PAS ÊTRE LE SEUL (B-4).
 *
 * Il est chargé APRÈS `central-sync.js` : `previousSave` est donc la sauvegarde de la
 * synchronisation, qui a déjà recopié la fiche complète dans `syncQueue` au moment où ce
 * nettoyage s'exécute. Mesuré sur `d9739797` : `users` propre, `syncQueue.data.password`
 * lisible par `atob`.
 *
 * La règle a donc été portée aux FRONTIÈRES DE PERSISTANCE (`local-credential-contract.js`,
 * appliqué dans `central-sync.js`), où l'ordre des enveloppes ne peut rien contre elle.
 * Ce qui reste ici garde sa raison d'être : nettoyer ce qui est DÉJÀ sur le disque des
 * postes, au chargement, sans rien attendre du réseau.
 */

const previousSave = db.save.bind(db);

/*
 * L'écriture passe par la primitive NUE de `db.js`, et non par `db.save` : celui-ci est
 * déjà enveloppé par la synchronisation au moment où ce module se charge, et nettoyer une
 * fiche renverrait donc cette fiche au centre.
 */
const ouvrirEtEcrire = (magasin, fiche) => db._saveRaw(magasin, fiche);

async function scrubUserRecord(id) {
  if (id === null || id === undefined) return;
  try {
    await db.open();
    const record = await db._getRaw('users', id);
    if (!record || !CHAMPS_CREDENTIELS.some(champ => champ in record)) return;
    await ouvrirEtEcrire('users', sanitizeLocalUserCredentialFields(record));
  } catch (error) {
    console.warn('Nettoyage du cache utilisateur impossible.', error);
  }
}

/**
 * LE DISQUE D'ABORD, LE RÉSEAU ENSUITE.
 *
 * `central-sync.js` neutralise les lignes héritées à l'entrée de la reprise — donc
 * seulement quand le centre répond. Un poste qui ne se reconnecte jamais garderait son
 * secret indéfiniment. Ce passage-ci ne demande rien à personne : il s'exécute au
 * chargement, hors ligne compris.
 *
 * Les entrées porteuses de `syncQueue` sont rendues TERMINALES : allégées et laissées
 * `pending`, elles feraient accepter au serveur une mise à jour de profil pendant que
 * l'opérateur croirait son mot de passe changé.
 */

/**
 * TOUS LES MAGASINS, PAS SEULEMENT CEUX QU'ON SOUPÇONNE (B4-R4).
 *
 * La purge ne parcourait que les magasins « porteurs » — `users` — puis `syncQueue`. Or
 * cette liste sert à décider ce qu'est une ROTATION D'IDENTIFIANT ; elle n'a jamais eu
 * vocation à dire où un secret a pu ATTERRIR. Un résidu laissé par une version antérieure
 * dans un autre magasin y restait indéfiniment, sans que rien ne le regarde jamais.
 *
 * Les magasins sont donc ÉNUMÉRÉS depuis la base elle-même, et non rappelés de mémoire :
 * une liste écrite ici serait fausse au premier magasin ajouté, et c'est exactement le
 * défaut qu'on referme. Faute d'énumération disponible, on retombe sur les magasins
 * connus plutôt que de ne rien nettoyer du tout.
 *
 * Un magasin est lu puis relâché avant le suivant : la pointe de mémoire vaut celle du
 * plus gros magasin, soit le profil que `createBackup()` et l'application d'un instantané
 * ont déjà.
 */
function magasinsPersistants() {
  const enumeres = db.db?.objectStoreNames;
  if (enumeres && typeof enumeres.length === 'number' && enumeres.length > 0) {
    return Array.from({ length: enumeres.length }, (_, index) => enumeres[index] ?? enumeres.item?.(index))
      .filter(Boolean);
  }
  return [...MAGASINS_PORTEURS_DE_CREDENTIELS, 'syncQueue'];
}

async function purgeLocalCredentialResidue() {
  let nettoyees = 0;
  // Un magasin absent fait échouer sa propre lecture, et elle seule : les autres doivent
  // être nettoyés quand même. D'où un `try` par magasin plutôt qu'un seul pour tous.
  const contenu = async magasin => {
    try { await db.open(); return await db.getAll(magasin); }
    catch { return []; }
  };
  try {
    await db.open();
    for (const magasin of magasinsPersistants()) {
      for (const record of await contenu(magasin)) {
        if (!porteUnCredentiel(record)) continue;
        /*
         * `syncQueue` est le seul magasin où alléger ne suffit pas : rejouée sans son mot
         * de passe, l'entrée ferait accepter au serveur une mise à jour de profil pendant
         * que l'opérateur croirait son mot de passe changé. Ailleurs, la fiche est
         * assainie SUR PLACE — jamais supprimée : elle porte du travail qui n'est pas en
         * cause.
         */
        const propre = magasin === 'syncQueue'
          ? neutraliserEntreeHeritee(record)
          : sanitizeLocalUserCredentialFields(record);
        if (!propre) continue;
        await ouvrirEtEcrire(magasin, propre);
        nettoyees += 1;
      }
    }
  } catch (error) {
    console.warn('Purge des identifiants résiduels impossible.', error);
  }
  return nettoyees;
}

db.save = async function saveWithoutLocalCredentials(storeName, data, option) {
  const id = await previousSave(storeName, data, option);
  if (storeName === 'users') await scrubUserRecord(id);
  return id;
};

// Au chargement, sans attendre ni session ni réseau.
const purgeInitiale = purgeLocalCredentialResidue();
db.purgeLocalCredentialResidue = purgeLocalCredentialResidue;

export { scrubUserRecord, purgeLocalCredentialResidue, purgeInitiale };
