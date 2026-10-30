/**
 * @file regie-car-dataset.js — la seule façon d'obtenir le relevé de la Régie Car.
 *
 * CE QUI A CHANGÉ, ET POURQUOI (A-5)
 * ----------------------------------
 * Le relevé — baies réellement présentes, matériel monté dans chacune, repères
 * d'exploitation, numéros d'inventaire, résumés des photos de terrain — vivait dans deux
 * modules servis à la racine. Mesuré sur `096cb47`, sans cookie ni en-tête :
 *
 *     GET /regie-car-inventory-phase16.js    200   38 361 octets
 *     GET /regie-car-prephoto-readiness.js   200   25 732 octets
 *
 * Les données ont quitté le bundle. Elles vivent sous `scripts/private-operational-data/`,
 * que le serveur refuse de servir, et n'arrivent ici que par
 * `/api/operational/regie-car/inventory`, après session ET après autorisation sur la salle.
 *
 * CE MODULE EST PUBLIC, ET IL LE RESTE
 * ------------------------------------
 * Il ne contient aucune valeur d'installation : que du transport et de la mémoire. C'est le
 * partage que ce lot pose — la logique d'amorçage est publique, le relevé ne l'est pas.
 *
 * TROIS RÈGLES, LES MÊMES QUE POUR LA GRILLE CENTRALE
 * ---------------------------------------------------
 *   · AUCUN REPLI. Un refus rend `null`, jamais une ancienne constante locale. Un repli
 *     rétablirait exactement la fuite qu'on vient de fermer, en plus discret.
 *   · AUCUNE PERSISTANCE. Le relevé reste en mémoire de l'onglet. L'écrire dans IndexedDB le
 *     ferait survivre à la déconnexion et à la révocation.
 *   · LA MÉMOIRE N'EST JAMAIS UNE AUTORITÉ. La portée vient de
 *     `operational-dataset-scope.js` : elle joint au compte l'empreinte des habilitations
 *     vivantes, si bien qu'une révocation fait tomber la mémoire au cycle suivant.
 */
import { porteeOperationnelleCourante } from './operational-dataset-scope.js';

export const REGIE_CAR_DATASET_ENDPOINT = '/api/operational/regie-car/inventory';
const PANNE_REPOS_MS = 30_000;

let cache = null;          // { portee, dataset }
let refus = null;          // { portee, status }
let prochainEssai = 0;
let enCours = null;

/*
 * LE JETON D'OUVERTURE — même mécanique que la Grille Centrale.
 *
 * Une `WeakMap` sur l'élément de la surface : le jeton naît avec la modale et disparaît avec
 * elle, sans rien retenir ni rien révéler — c'est un compteur, pas une donnée. Une modale
 * recréée est un autre élément, donc un autre jeton, donc une nouvelle décision du serveur.
 *
 * Ce n'est PAS une fenêtre de temps. Un anti-rebond de deux secondes avait déjà été mesuré
 * insuffisant pour la Grille Centrale : une révocation à t+63 ms suivie d'une réouverture à
 * t+146 ms réutilisait le jeu de données sans rien demander. Le regroupement se fait par
 * identité d'ouverture, jamais par horloge.
 */
const jetons = new WeakMap();
let compteurOuvertures = 0;
/** Le jeton de la dernière ouverture que le serveur a réellement tranchée. */
let ouvertureValidee = null;

export function jetonDOuverture(surface) {
  if (!surface || typeof surface !== 'object') return null;
  if (!jetons.has(surface)) jetons.set(surface, `ouverture-${++compteurOuvertures}`);
  return jetons.get(surface);
}

/**
 * Le relevé, ou `null`.
 *
 * `null` signifie « vous ne l'aurez pas » et rien d'autre : pas de session, pas
 * d'habilitation, ou serveur injoignable. L'appelant ne doit RIEN amorcer dans ce cas, et
 * surtout rien reconstruire de mémoire.
 */
export async function loadRegieCarDataset({ revalidate = false, ouverture = null } = {}) {
  const portee = porteeOperationnelleCourante();
  // Aucune session : on ne demande même pas.
  if (!portee) { cache = null; refus = null; return null; }

  // La portée a bougé — révocation, octroi, changement de compte : ce qu'on gardait ne vaut
  // plus rien. On l'oublie AVANT de décider quoi que ce soit.
  if (cache && cache.portee !== portee) cache = null;
  if (refus && refus.portee !== portee) refus = null;

  /*
   * Une revalidation vaut pour LA MÊME ouverture, et pour elle seule.
   *
   * C'est ce qui empêche le `MutationObserver` de marteler la route : il réveille ce panneau
   * à chaque mutation de `#app`, et sans ce regroupement une seule fiche 360 produirait
   * autant de requêtes que de tentatives d'enrichissement. Une modale SUIVANTE, elle, porte
   * un autre jeton : le serveur redécide.
   */
  const dejaTranchee = Boolean(ouverture) && ouverture === ouvertureValidee;
  if (!revalidate || dejaTranchee) {
    if (cache) return cache.dataset;
    if (refus) return null;
  }
  // Un appel déjà en vol sert tout le monde, y compris les revalidations.
  if (enCours) return enCours;
  if (!revalidate && Date.now() < prochainEssai) return null;

  enCours = (async () => {
    try {
      const response = await fetch(REGIE_CAR_DATASET_ENDPOINT, { credentials:'include', cache:'no-store' });
      // Cette ouverture-ci a été tranchée par le serveur ; les autres tentatives de la même
      // surface s'en contenteront, une surface suivante non.
      ouvertureValidee = ouverture;
      if (response.status === 401 || response.status === 403) {
        // Un refus est une réponse, pas une panne : on le retient et on jette ce qu'on avait.
        cache = null;
        refus = { portee, status:response.status };
        return null;
      }
      if (!response.ok) {
        cache = null;
        prochainEssai = Date.now() + PANNE_REPOS_MS;
        return null;
      }
      const payload = await response.json();
      const dataset = payload?.dataset || null;
      if (!dataset) {
        cache = null;
        prochainEssai = Date.now() + PANNE_REPOS_MS;
        return null;
      }
      cache = { portee, dataset };
      refus = null;
      return dataset;
    } catch {
      /*
       * Réseau coupé, serveur arrêté. ON FERME.
       *
       * Rendre l'ancien relevé ici en ferait une autorisation de secours, ce que les règles
       * de tête interdisent.
       */
      cache = null;
      prochainEssai = Date.now() + PANNE_REPOS_MS;
      return null;
    } finally {
      enCours = null;
    }
  })();

  return enCours;
}

/** Le relevé déjà en mémoire, sans requête. `null` dès que la portée a changé. */
export function peekRegieCarDataset() {
  const portee = porteeOperationnelleCourante();
  if (!portee || cache?.portee !== portee) return null;
  return cache.dataset;
}

/** Oublier tout — déconnexion, changement de compte, épreuves. */
export function forgetRegieCarDataset() {
  cache = null;
  refus = null;
  prochainEssai = 0;
  ouvertureValidee = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    // Une session expirée invalide autant le relevé que le refus retenu.
    if (event.detail?.state === 'unauthenticated') forgetRegieCarDataset();
  });
  window.RegieCarDataset = Object.freeze({
    load:loadRegieCarDataset,
    peek:peekRegieCarDataset,
    jeton:jetonDOuverture,
    forget:forgetRegieCarDataset,
    endpoint:REGIE_CAR_DATASET_ENDPOINT
  });
}

export default Object.freeze({
  REGIE_CAR_DATASET_ENDPOINT, loadRegieCarDataset, peekRegieCarDataset,
  jetonDOuverture, forgetRegieCarDataset
});
