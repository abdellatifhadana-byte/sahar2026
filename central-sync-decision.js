import { db } from './db.js';

/*
 * LA BASCULE CENTRALE, SANS DÉPENDANCE D'INTERFACE (#165, famille #162/#98).
 *
 * POURQUOI CE MODULE EXISTE
 * --------------------------
 * Un producteur qui doit décider « ce qui manque » ne peut pas lire la base locale avant
 * que la tentative de synchronisation centrale soit TRANCHÉE. Un `docs` encore vide n'est
 * pas un catalogue manquant : c'est un instantané qui n'est pas encore arrivé. Décider
 * avant cette preuve, c'est recréer spéculativement ce que le central possède déjà —
 * mesuré sur « central chaud, IndexedDB froid » : 70 écritures d'ensemencement, toutes
 * avant la première preuve d'instantané, toutes sur des fiches déjà présentes côté
 * serveur.
 *
 * `catalog-enrichment-gate.js` ne répond PAS à cette question : il sérialise les
 * producteurs de catalogue entre eux, il n'attend pas le central.
 *
 * Cette barrière existait déjà, en deux exemplaires : `regie-car-inventory-phase16.js`
 * (la copie dont `regie-car-inventory-phase16.test.js` prouve le comportement en
 * EXÉCUTION) et `equipment-knowledge-extra.js`. Ce module en publie une copie qu'un
 * troisième producteur peut importer SANS entraîner de dépendance d'interface :
 * `equipment-knowledge-extra.js` installe un `MutationObserver` au chargement, sans garde
 * `typeof window`, ce qui le rend inimportable hors navigateur — l'importer depuis
 * `equipment-knowledge.js` cassait quatre épreuves qui, elles, exécutent réellement ce
 * module.
 *
 * `tests/equipment-360-consultation-nowrite.test.js` compare ce texte à la copie vérifiée,
 * exactement comme `tests/equipment-knowledge-extra.test.js` le fait déjà pour la sienne :
 * aucune des copies ne peut dériver en silence.
 */

/*
 * CE QUI PROUVE LA BASCULE, ET CE QUI NE LA PROUVE PAS.
 *
 * Un événement porteur d'`updatedAt` prouve qu'un instantané a RÉELLEMENT été appliqué
 * (`enableCentralSync`, après `applySnapshot`, jamais avant) — ou un échec terminal de la
 * tentative centrale ELLE-MÊME (`local`, `unauthenticated` SANS `updatedAt` : la requête
 * d'instantané a échoué, ou une session expirée l'interrompt), qui ferme la tentative sans
 * qu'un instantané ne suive.
 */
export const decisionSyncEtablie = detail => {
  if (detail?.updatedAt) return true;
  const etat = String(detail?.state || '');
  return etat === 'local' || etat === 'unauthenticated';
};

export function attendreDecisionSync() {
  if (typeof window === 'undefined' || db.isCentralSyncReady?.()) return Promise.resolve();
  return new Promise(resolve => {
    let reglee = false;
    const regler = () => {
      if (reglee) return;
      reglee = true;
      window.removeEventListener('central-sync-status', ecouteur);
      resolve();
    };
    const ecouteur = event => { if (decisionSyncEtablie(event?.detail)) regler(); };
    window.addEventListener('central-sync-status', ecouteur);
    // Filet de sécurité : une session qui ne tente jamais la synchronisation centrale
    // n'émettrait jamais un événement recevable ici — l'ensemencement local ne doit pas en
    // dépendre indéfiniment. `central-sync.js` borne chaque requête à 25 s
    // (`REQUEST_TIMEOUT_MS`) ; ce filet reste délibérément AU-DESSUS, pour ne jamais
    // libérer pendant qu'une tentative en cours peut encore aboutir.
    setTimeout(regler, 30000);
  });
}
