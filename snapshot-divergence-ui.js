/**
 * @file snapshot-divergence-ui.js — quand la fiche qu'on est en train de saisir bouge ailleurs.
 *
 * LE DÉFAUT QUE CE MODULE FERME (C-DIRTY-UI-01)
 * ---------------------------------------------
 * Le contrat d'instantané savait déjà reconnaître le cas : si une fiche change côté serveur
 * alors qu'un écran la modifie sans avoir enregistré, elle est annoncée comme une
 * DIVERGENCE et non comme un rafraîchissement. Sauf que personne n'écoutait cette annonce,
 * et que personne ne déclarait jamais éditer quoi que ce soit. La protection existait sur
 * le papier, dans un événement qui n'était ni produit ni reçu — donc nulle part.
 *
 * La chaîne complète, désormais fermée de bout en bout :
 *
 *     instantané distant
 *       → une saisie en cours est RECONNUE comme telle
 *       → `platform-entity-diverged`
 *       → la saisie locale est CONSERVÉE
 *       → et l'écran le DIT, en français, avec des suites possibles
 *
 * CE QUE CE MODULE NE FAIT JAMAIS
 * -------------------------------
 *   · il n'enregistre rien — ni vers la base, ni vers le serveur. Sauver à la place de
 *     quelqu'un qui n'a pas fini d'écrire est pire que de ne rien faire ;
 *   · il ne touche à aucun champ du formulaire. La version reçue se CONSULTE, à côté ;
 *   · il ne recharge pas la fiche de lui-même. Reprendre la version distante fait perdre
 *     la saisie : cela ne peut être qu'un geste humain, et il est demandé deux fois.
 *
 * CE QU'IL FAIT TRAVERSER
 * -----------------------
 * Une SUPPRESSION distante passe outre la protection. On ne garde pas sa saisie sur une
 * fiche qui n'existe plus, et surtout on ne doit pas pouvoir l'enregistrer : le formulaire
 * est neutralisé, et l'écran dit pourquoi.
 */
import {
  SNAPSHOT_EVENTS,
  declareOpenEditor,
  releaseOpenEditor
} from './snapshot-diff-contract.js';

/** La phrase que l'utilisateur doit lire. Elle nomme le fait, pas le mécanisme. */
export const DIVERGENCE_MESSAGE = 'Cette fiche a été modifiée ailleurs pendant votre saisie.';
export const SUPPRESSION_MESSAGE = 'Cette fiche a été supprimée ailleurs pendant votre saisie.';

const DETAIL_DIVERGENCE = 'Votre saisie est intacte : rien n’a été enregistré à votre place.';
const DETAIL_SUPPRESSION = 'L’enregistrement est désactivé : cette fiche n’existe plus côté serveur.';

const VOIR = 'Voir la version reçue';
const MASQUER = 'Masquer la version reçue';
const CONSERVER = 'Conserver ma saisie';
const RECHARGER = 'Recharger';
const CONFIRMER_RECHARGEMENT = 'Confirmer : abandonner ma saisie';
const FERMER = 'Fermer';

/**
 * UN ÉDITEUR SE DÉCLARE PAR SES ATTRIBUTS, PAS PAR SON IDENTIFIANT.
 *
 * Reconnaître les fenêtres par une liste d'identifiants — `#eq-modal`, `#edit-room-modal`,
 * … — obligerait ce module à connaître chaque écran, et la liste serait périmée au premier
 * écran ajouté. Deux attributs suffisent, et c'est l'écran qui sait ce qu'il édite.
 */
const EDITEUR_SELECTEUR = '[data-entity-store][data-entity-id]';
const PANNEAU_ID = 'platform-divergence-panel';

const cle = (store, id) => `${store}\u0000${id}`;
const memeFiche = (element, store, id) =>
  element.dataset.entityStore === String(store) && String(element.dataset.entityId) === String(id);

/** Les avis affichés, un par fiche. Un second instantané met le sien à jour, il n'en empile pas. */
const avis = new Map();

function editeurOuvert(store, id) {
  if (typeof document === 'undefined') return null;
  // `Array.from` et non `.find` directement : un vrai navigateur rend une `NodeList`, qui
  // n'a pas de `find`. Se fier au tableau d'un document simulé ferait passer une épreuve
  // sur du code qui casserait à l'écran.
  return Array.from(document.querySelectorAll(EDITEUR_SELECTEUR)).find(element => memeFiche(element, store, id)) || null;
}

function panneau() {
  let hote = document.getElementById(PANNEAU_ID);
  if (hote) return hote;
  hote = document.createElement('div');
  hote.id = PANNEAU_ID;
  hote.className = 'platform-divergence-panel';
  hote.setAttribute('role', 'status');
  hote.setAttribute('aria-live', 'polite');
  document.body.appendChild(hote);
  return hote;
}

function retirerAvis(store, id) {
  const entree = avis.get(cle(store, id));
  if (!entree) return;
  entree.element.remove();
  avis.delete(cle(store, id));
  const hote = document.getElementById(PANNEAU_ID);
  if (hote && !hote.children.length) hote.remove();
}

/** Un bouton porte son intention dans son libellé : c'est ce que l'utilisateur lit. */
function bouton(libelle, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'platform-divergence-action';
  element.textContent = libelle;
  element.addEventListener('click', action);
  return element;
}

function ligne(classe, texte) {
  const element = document.createElement('p');
  element.className = classe;
  element.textContent = texte;
  return element;
}

/** La version reçue se LIT ; elle ne se recopie pas dans le formulaire. */
function rendreVersionRecue(hote, record) {
  hote.textContent = '';
  const entrees = Object.entries(record || {}).filter(([, valeur]) => valeur !== undefined && valeur !== null);
  if (!entrees.length) {
    hote.appendChild(ligne('platform-divergence-vide', 'La version reçue ne contient aucun champ lisible.'));
    return;
  }
  for (const [champ, valeur] of entrees) {
    const rangee = document.createElement('div');
    rangee.className = 'platform-divergence-champ';
    const nom = document.createElement('span');
    nom.className = 'platform-divergence-champ-nom';
    nom.textContent = champ;
    const contenu = document.createElement('span');
    contenu.className = 'platform-divergence-champ-valeur';
    contenu.textContent = typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur);
    rangee.append(nom, contenu);
    hote.appendChild(rangee);
  }
}

function afficherDivergence(store, id, record) {
  const existant = avis.get(cle(store, id));
  if (existant) {
    // Un second instantané sur la même fiche remplace la version consultable ; il ne
    // rouvre pas un avis par-dessus l'autre, et il n'annule pas le choix déjà fait.
    existant.record = record;
    if (!existant.version.hidden) rendreVersionRecue(existant.version, record);
    return existant.element;
  }

  const element = document.createElement('article');
  element.className = 'platform-divergence-notice';
  element.dataset.divergenceStore = String(store);
  element.dataset.divergenceId = String(id);

  const version = document.createElement('div');
  version.className = 'platform-divergence-version';
  version.hidden = true;

  const entree = { element, version, record, store, id };

  const boutonVoir = bouton(VOIR, () => {
    version.hidden = !version.hidden;
    boutonVoir.textContent = version.hidden ? VOIR : MASQUER;
    if (!version.hidden) rendreVersionRecue(version, entree.record);
  });

  const boutonConserver = bouton(CONSERVER, () => {
    // La saisie reste ce qu'elle est, et l'éditeur reste SALE : un prochain instantané
    // reviendra le dire plutôt que d'écraser en silence.
    declareOpenEditor(store, id, { dirty: true });
    retirerAvis(store, id);
    annoncer('platform-divergence-resolved', { storeName: store, id, choice: 'local' });
  });

  let rechargementDemande = false;
  const boutonRecharger = bouton(RECHARGER, () => {
    if (!rechargementDemande) {
      // Reprendre la version distante fait perdre la saisie. Le premier clic le dit ; le
      // second seulement l'exécute. Aucune boîte de dialogue : la demande est dans le bouton.
      rechargementDemande = true;
      boutonRecharger.textContent = CONFIRMER_RECHARGEMENT;
      boutonRecharger.classList.add('platform-divergence-action-danger');
      return;
    }
    releaseOpenEditor(store, id);
    retirerAvis(store, id);
    editeurOuvert(store, id)?.remove();
    // La base locale porte déjà la version distante : le relais habituel des vues suffit
    // à la faire apparaître, maintenant que plus aucun éditeur ne bloque le rafraîchissement.
    annoncer(SNAPSHOT_EVENTS.UPDATED, {
      storeName: store, id, record: entree.record, updatedAt: new Date().toISOString()
    });
    annoncer('platform-divergence-resolved', { storeName: store, id, choice: 'remote' });
  });

  const actions = document.createElement('div');
  actions.className = 'platform-divergence-actions';
  actions.append(boutonVoir, boutonConserver, boutonRecharger);

  element.append(
    ligne('platform-divergence-message', DIVERGENCE_MESSAGE),
    ligne('platform-divergence-detail', DETAIL_DIVERGENCE),
    actions,
    version
  );

  panneau().appendChild(element);
  avis.set(cle(store, id), entree);
  return element;
}

/**
 * LA SUPPRESSION TRAVERSE LA PROTECTION.
 *
 * Elle remplace l'avis de divergence s'il y en a un, neutralise l'enregistrement, et ne
 * laisse qu'une seule suite possible : fermer. Laisser le bouton « Enregistrer » actif
 * proposerait d'écrire une fiche qui n'existe plus — le serveur la refuserait, et
 * l'utilisateur croirait avoir perdu son travail sans comprendre pourquoi.
 */
function afficherSuppression(store, id) {
  retirerAvis(store, id);

  const element = document.createElement('article');
  element.className = 'platform-divergence-notice platform-divergence-notice-deleted';
  element.dataset.divergenceStore = String(store);
  element.dataset.divergenceId = String(id);

  const actions = document.createElement('div');
  actions.className = 'platform-divergence-actions';
  actions.appendChild(bouton(FERMER, () => {
    retirerAvis(store, id);
    editeurOuvert(store, id)?.remove();
  }));

  element.append(
    ligne('platform-divergence-message', SUPPRESSION_MESSAGE),
    ligne('platform-divergence-detail', DETAIL_SUPPRESSION),
    actions
  );

  panneau().appendChild(element);
  avis.set(cle(store, id), { element, version: element, record: null, store, id });
  return element;
}

function neutraliserEditeur(editeur) {
  if (!editeur) return;
  editeur.dataset.entityDeleted = 'true';
  editeur.classList.add('platform-editor-deleted');
  // Un `<button>` sans attribut `type` DANS un formulaire est un bouton d'envoi : c'est la
  // règle HTML, et l'oublier laisserait le bouton actif sur une fiche qui n'existe plus.
  const commandes = [
    ...editeur.querySelectorAll('[type="submit"]'),
    ...Array.from(editeur.querySelectorAll('button')).filter(element => !element.hasAttribute('type'))
  ];
  for (const commande of commandes) commande.disabled = true;
}

const annoncer = (type, detail) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type, { detail }));
};

/* ------------------------------ Le raccordement ------------------------------ */

const parcourirEditeurs = (noeud, action) => {
  if (!noeud || noeud.nodeType !== 1) return;
  if (noeud.matches?.(EDITEUR_SELECTEUR)) action(noeud);
  for (const descendant of noeud.querySelectorAll?.(EDITEUR_SELECTEUR) || []) action(descendant);
};

function installer() {
  /*
   * UNE FENÊTRE D'ÉDITION QUI S'OUVRE SE DÉCLARE ; QUI SE FERME LIBÈRE.
   *
   * Les écrans de cette plateforme construisent leurs fenêtres puis les retirent du
   * document. Observer ces deux gestes suffit à tenir le registre à jour, sans qu'aucun
   * écran ait à penser à se désinscrire — ce qu'aucun ne ferait de façon fiable.
   */
  const observateur = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const noeud of mutation.addedNodes || []) {
        parcourirEditeurs(noeud, element => declareOpenEditor(element.dataset.entityStore, element.dataset.entityId, { dirty: false }));
      }
      for (const noeud of mutation.removedNodes || []) {
        parcourirEditeurs(noeud, element => {
          releaseOpenEditor(element.dataset.entityStore, element.dataset.entityId);
          retirerAvis(element.dataset.entityStore, element.dataset.entityId);
        });
      }
    }
  });
  observateur.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.__platformDivergenceObserver = observateur;

  // Une frappe, un choix dans une liste : à partir de là, la fiche porte une saisie non
  // enregistrée, et un changement distant ne doit plus l'écraser sans un mot.
  const marquerSale = evenement => {
    const editeur = evenement.target?.closest?.(EDITEUR_SELECTEUR);
    if (!editeur) return;
    declareOpenEditor(editeur.dataset.entityStore, editeur.dataset.entityId, { dirty: true });
  };
  document.addEventListener('input', marquerSale, true);
  document.addEventListener('change', marquerSale, true);

  document.addEventListener('submit', evenement => {
    const editeur = evenement.target?.closest?.(EDITEUR_SELECTEUR);
    if (!editeur) return;
    if (editeur.dataset.entityDeleted === 'true') {
      // Dernière barrière : la fiche a disparu pendant la saisie, on n'écrit pas dessus.
      evenement.preventDefault();
      evenement.stopImmediatePropagation?.();
      return;
    }
    // Enregistrer, c'est cesser d'avoir une saisie à protéger.
    declareOpenEditor(editeur.dataset.entityStore, editeur.dataset.entityId, { dirty: false });
    retirerAvis(editeur.dataset.entityStore, editeur.dataset.entityId);
  }, true);

  window.addEventListener(SNAPSHOT_EVENTS.DIVERGED, evenement => {
    const { storeName, id, record } = evenement.detail || {};
    if (!storeName || id === undefined || id === null) return;
    afficherDivergence(storeName, id, record);
  });

  window.addEventListener(SNAPSHOT_EVENTS.DELETED, evenement => {
    const { storeName, id } = evenement.detail || {};
    if (!storeName || id === undefined || id === null) return;
    const editeur = editeurOuvert(storeName, id);
    // Sans éditeur ouvert ni avis affiché, la suppression n'a rien à traverser : le relais
    // ordinaire des vues fait déjà disparaître la fiche de l'écran.
    if (!editeur && !avis.has(cle(storeName, id))) return;
    neutraliserEditeur(editeur);
    releaseOpenEditor(storeName, id);
    afficherSuppression(storeName, id);
  });

  poserStyles();
}

function poserStyles() {
  if (document.getElementById('platform-divergence-styles')) return;
  const style = document.createElement('style');
  style.id = 'platform-divergence-styles';
  style.textContent = `
    .platform-divergence-panel {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      width: min(560px, 94vw);
      z-index: 2147483600;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .platform-divergence-notice {
      background: #fff;
      border: 1px solid #f0b429;
      border-left: 6px solid #f0b429;
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: 0 10px 30px rgba(8, 18, 28, .22);
      color: #1f2933;
    }
    .platform-divergence-notice-deleted { border-color: #c0392b; border-left-color: #c0392b; }
    .platform-divergence-message { margin: 0 0 4px; font-weight: 600; }
    .platform-divergence-detail { margin: 0 0 10px; color: #52606d; font-size: .92em; }
    .platform-divergence-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .platform-divergence-action {
      border: 1px solid #cbd2d9;
      background: #f5f7fa;
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
      color: inherit;
    }
    .platform-divergence-action:hover { background: #e4e7eb; }
    .platform-divergence-action-danger { border-color: #c0392b; color: #c0392b; }
    .platform-divergence-version {
      margin-top: 10px;
      max-height: 220px;
      overflow: auto;
      border-top: 1px dashed #cbd2d9;
      padding-top: 8px;
      font-size: .9em;
    }
    .platform-divergence-champ { display: flex; gap: 8px; padding: 2px 0; }
    .platform-divergence-champ-nom { color: #52606d; min-width: 130px; }
    .platform-divergence-champ-valeur { word-break: break-word; }
    .platform-editor-deleted { opacity: .96; }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') installer();

export { editeurOuvert, retirerAvis };
