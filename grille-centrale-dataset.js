/**
 * @file grille-centrale-dataset.js — la seule façon d'obtenir le plan documenté.
 *
 * CE QUI A CHANGÉ, ET POURQUOI (#137)
 * -----------------------------------
 * Les libellés de ports, les repères GR, les chemins monitoring et la référence du
 * synoptique interne vivaient dans quatre modules servis à la racine. N'importe quel
 * navigateur — sans compte, sans session, sans cookie — pouvait les télécharger :
 *
 *     curl -s http://…/grille-centrale-documented-map.js | grep -o '"STC [0-9]*"'
 *
 * Le jeu de données a donc quitté le bundle. Il vit sous `scripts/`, que le serveur refuse
 * de servir, et n'arrive ici que par `/api/operational/grille-centrale/documented-map`,
 * après session ET après autorisation sur l'équipement canonique.
 *
 * CE MODULE EST PUBLIC, ET IL LE RESTE
 * ------------------------------------
 * Il ne contient aucune valeur d'installation : que du transport et de la mémoire. C'est
 * précisément le partage que ce lot pose — le code d'affichage est public, la donnée
 * opérationnelle ne l'est pas.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS
 * ------------------------------------
 *   · AUCUN REPLI. Un refus rend `null`, jamais une ancienne constante locale. Un repli
 *     rétablirait exactement la fuite qu'on vient de fermer, en plus discret.
 *   · AUCUNE PERSISTANCE. Le jeu de données reste en mémoire de l'onglet. L'écrire dans
 *     IndexedDB le ferait survivre à la déconnexion et à la révocation — c'est le défaut
 *     que #132 a mesuré ailleurs, et il ne sera pas réintroduit ici.
 *   · LA MÉMOIRE N'EST JAMAIS UNE AUTORITÉ. Ni un succès ni un refus retenus ne décident à
 *     la place du serveur : voir la note ci-dessous, c'est le cœur de ce module.
 */

/*
 * UNE DATASET EN MÉMOIRE N'EST PAS UNE PREUVE D'ACCÈS.
 * ----------------------------------------------------
 * La première version gardait le jeu de données tant que `${id}:${authVersion}` ne changeait
 * pas, et affirmait en commentaire qu'« une habilitation révoquée puis rendue change la
 * version ». C'ÉTAIT FAUX : `revokeGrant()` écrit `status:'revoked'` sur l'habilitation et
 * n'a jamais touché à `authVersion`. Mesuré sur c24d724, dans le même onglet, sans
 * déconnexion ni rechargement :
 *
 *     A ouvre la fiche 360        → 200, 374 ports en mémoire
 *     B révoque les habilitations → le serveur refuse la session de A (403 vérifié)
 *     A rouvre la fiche 360       → AUCUNE requête, 374 ports TOUJOURS en mémoire
 *
 * Un jeu de données obtenu légitimement devenait donc une autorisation locale permanente.
 *
 * DEUX RÈGLES LE FERMENT, ET AUCUNE N'INVENTE DE MÉCANISME.
 *
 * 1. LA MÉMOIRE SUIT LE CONTEXTE D'ACCÈS, PAS LE NUMÉRO DE SESSION.
 *    `central-sync` écrit `zone-access-context` à CHAQUE instantané : c'est l'adhésion et
 *    les habilitations vivantes, telles que le serveur vient de les rendre. On garde
 *    l'empreinte de ce contexte avec le jeu de données. Une révocation la change au cycle
 *    suivant, et la mémoire tombe — sans toucher au contrat d'authentification, sans
 *    endpoint supplémentaire, sans rien interroger de plus.
 *
 * 2. OUVRIR UNE SURFACE OPÉRATIONNELLE REDEMANDE AU SERVEUR.
 *    La règle 1 laisse une fenêtre : entre la révocation et l'instantané suivant, l'empreinte
 *    n'a pas encore bougé. Une réouverture explicite passe donc par `{ revalidate:true }` et
 *    reconsulte le serveur, quoi qu'il y ait en mémoire. C'est ce que veut l'invariant : au
 *    prochain chargement d'une surface opérationnelle, le serveur doit pouvoir décider de
 *    nouveau.
 *
 *    Cela ne crée pas de trafic périodique : les réconciliations de fond, elles, se
 *    contentent de la mémoire. Seule une ouverture d'écran revalide.
 *
 *    UNE OUVERTURE, UNE REQUÊTE — ET LE TEMPS N'EST PAS UNE IDENTITÉ D'ÉCRAN.
 *
 *    Ouvrir une fiche 360 réveille quatre modules Grille, chacun programmé trois fois par son
 *    observateur : mesuré, DIX revalidations pour un seul geste. Une première version les
 *    regroupait par une fenêtre de deux secondes. C'était faux, et mesuré comme tel :
 *
 *        ouverture              → 200, 374 ports
 *        révocation à t+63 ms
 *        réouverture à t+146 ms → AUCUNE requête, 374 ports toujours exploitables
 *
 *    Deux secondes ne distinguent pas « le même écran qui finit de se composer » de « un
 *    nouvel écran ouvert tout de suite après ». Le regroupement se fait donc par JETON
 *    D'OUVERTURE : chaque instance de surface — l'élément DOM lui-même — en reçoit un, et
 *    une revalidation ne vaut que pour le jeton qui l'a demandée. Les quatre modules d'une
 *    même modale partagent son jeton et ne provoquent qu'une requête ; une modale suivante
 *    est un autre élément, donc un autre jeton, donc une nouvelle décision du serveur —
 *    fût-elle ouverte cent millisecondes plus tard.
 *
 * 3. UN ÉCHEC DE REVALIDATION NE REND JAMAIS L'ANCIEN JEU DE DONNÉES.
 *    Serveur arrêté, réseau coupé : on ferme. Se replier sur la mémoire ferait exactement ce
 *    que les deux règles précédentes viennent d'interdire.
 */

import { porteeOperationnelleCourante } from './operational-dataset-scope.js';

const ENDPOINT = '/api/operational/grille-centrale/documented-map';

/** Ni le jeu de données ni le refus ne sortent de cette mémoire d'onglet. */
let cache = null;          // { portee, dataset }  — succès
let refus = null;          // { portee, status }   — refus retenu
let enCours = null;        // requête en vol, partagée par tous les appelants
let prochainEssai = 0;     // repos après une panne réseau, pour ne pas marteler

const PANNE_REPOS_MS = 30000;

/*
 * LE JETON D'OUVERTURE.
 *
 * Une `WeakMap` sur l'élément de la surface : le jeton naît avec la modale et disparaît avec
 * elle, sans rien retenir ni rien révéler — c'est un compteur, pas une donnée. Une modale
 * recréée est un autre élément, donc un autre jeton.
 */
const jetons = new WeakMap();
let compteurOuvertures = 0;
/** Le jeton de la dernière ouverture que le serveur a réellement tranchée. */
let ouvertureValidee = null;

/**
 * Le jeton d'une surface, créé au premier appel.
 *
 * Sans élément — un appel programmatique, une épreuve — on rend `null` : la revalidation est
 * alors inconditionnelle, ce qui est le côté sûr.
 */
export function jetonDOuverture(surface) {
  if (!surface || typeof surface !== 'object') return null;
  if (!jetons.has(surface)) jetons.set(surface, `ouverture-${++compteurOuvertures}`);
  return jetons.get(surface);
}

/*
 * LA PORTÉE vit maintenant dans `operational-dataset-scope.js` : le relevé de la Régie Car
 * suit la même règle de mémoire, et deux copies d'une règle de sécurité, c'est une règle qui
 * finit par n'être vraie qu'à moitié. Le comportement est inchangé.
 */
const porteeCourante = porteeOperationnelleCourante;

/**
 * Le plan documenté, ou `null`.
 *
 * `null` signifie « vous ne l'aurez pas » et rien d'autre : pas de session, pas
 * d'habilitation, ou serveur injoignable. L'appelant ne doit RIEN afficher d'opérationnel
 * dans ce cas, et surtout rien reconstruire.
 *
 * `revalidate` — à poser dès qu'on OUVRE une surface opérationnelle. La mémoire est alors
 * ignorée et le serveur redécide. Les réconciliations de fond l'omettent : elles n'ont pas
 * à interroger le serveur pour se taire.
 */
export async function loadGrilleCentraleDataset({ revalidate = false, ouverture = null } = {}) {
  const portee = porteeCourante();
  // Aucune session : on ne demande même pas. C'est ce qui garantit qu'un profil jamais
  // authentifié n'émet aucune requête vers la donnée opérationnelle.
  if (!portee) { cache = null; refus = null; return null; }

  // La portée a bougé — révocation, octroi, changement de compte : ce qu'on gardait ne vaut
  // plus rien. On l'oublie AVANT de décider quoi que ce soit.
  if (cache && cache.portee !== portee) cache = null;
  if (refus && refus.portee !== portee) refus = null;

  /*
   * Une revalidation vaut pour LA MÊME ouverture, et pour elle seule. Sans jeton, on ne
   * regroupe rien : mieux vaut une requête de trop qu'une autorisation périmée.
   */
  const dejaTranchee = Boolean(ouverture) && ouverture === ouvertureValidee;
  if (!revalidate || dejaTranchee) {
    if (cache) return cache.dataset;
    if (refus) return null;
  }
  // Un appel déjà en vol sert tout le monde, y compris les revalidations : c'est ce qui
  // empêche les cinq producteurs Grille de partir ensemble sur cinq requêtes identiques.
  if (enCours) return enCours;
  if (!revalidate && Date.now() < prochainEssai) return null;

  enCours = (async () => {
    try {
      const response = await fetch(ENDPOINT, { credentials:'include', cache:'no-store' });
      // Cette ouverture-ci a été tranchée par le serveur ; les autres modules de la même
      // surface s'en contenteront, une surface suivante non.
      ouvertureValidee = ouverture;
      if (response.status === 401 || response.status === 403) {
        // Un refus est une réponse, pas une panne : on le retient et on se tait. Et surtout,
        // on jette ce qu'on avait — c'est précisément le cas « révoqué pendant la session ».
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
       * Rendre l'ancien jeu de données ici en ferait une autorisation de secours, ce que les
       * règles de tête interdisent. On l'oublie aussi : une revalidation impossible ne doit
       * pas laisser derrière elle de quoi rendre l'écran quand même.
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

/**
 * Le jeu de données déjà en mémoire, sans requête.
 *
 * Rend `null` dès que la portée a changé : un appelant qui n'a pas revalidé ne doit pas
 * pouvoir dessiner avec ce qu'une habilitation désormais retirée avait rapporté.
 */
export function peekGrilleCentraleDataset() {
  const portee = porteeCourante();
  if (!portee || cache?.portee !== portee) return null;
  return cache.dataset;
}

/**
 * Oublier tout — déconnexion, changement de compte, épreuves.
 *
 * Appelé au `logout` : sans cela, le jeu de données resterait lisible en mémoire de l'onglet
 * jusqu'au rechargement, y compris après la fermeture de session.
 */
export function forgetGrilleCentraleDataset() {
  cache = null;
  refus = null;
  prochainEssai = 0;
  ouvertureValidee = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    // Une session expirée invalide autant le jeu de données que le refus retenu.
    if (event.detail?.state === 'unauthenticated') forgetGrilleCentraleDataset();
  });
  window.GrilleCentraleDataset = Object.freeze({
    load:loadGrilleCentraleDataset,
    peek:peekGrilleCentraleDataset,
    jeton:jetonDOuverture,
    forget:forgetGrilleCentraleDataset,
    endpoint:ENDPOINT
  });
}
