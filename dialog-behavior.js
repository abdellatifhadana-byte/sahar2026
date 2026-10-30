export const DIALOG_BEHAVIOR_VERSION = 1;

/**
 * Comportement de fermeture commun à TOUTES les fenêtres de la plateforme.
 *
 * Vingt-cinq modules ouvrent des fenêtres, huit seulement géraient la touche Échap.
 * Mesuré sur quatre fenêtres représentatives : Échap fermait dans un cas sur quatre, le
 * clic sur le fond dans deux, la croix dans deux. Aucune fenêtre n'emprisonnait
 * l'utilisateur — le bouton « Annuler » existait partout — mais la règle apprise sur une
 * page ne valait pas sur la suivante, et un utilisateur au clavier restait sans issue
 * rapide là où Échap ne répondait pas.
 *
 * Plutôt que de modifier vingt-cinq modules, le comportement est installé une fois, au
 * niveau du document. Chaque fenêtre garde son propre bouton de fermeture : quand il
 * existe, c'est LUI qui est actionné, de sorte que le nettoyage propre à la fenêtre
 * (retrait du voile, restitution du défilement) s'exécute comme prévu.
 */

const DIALOG_SELECTOR = '.modal, [role="dialog"], #eq-modal, .sf-modal';
const CLOSE_SELECTOR = '.modal-x, .close, [data-close], [aria-label*="ermer"], [aria-label*="lose"]';

const isVisible = element => {
  if (!element?.isConnected) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return element.getBoundingClientRect().height > 0;
};

const openDialogs = () => [...document.querySelectorAll(DIALOG_SELECTOR)].filter(isVisible);

/** La fenêtre la plus récemment ouverte est celle que l'utilisateur regarde. */
export function topmostDialog() {
  const dialogs = openDialogs();
  if (!dialogs.length) return null;
  return dialogs.reduce((highest, candidate) => {
    const rank = element => Number(getComputedStyle(element).zIndex) || 0;
    return rank(candidate) >= rank(highest) ? candidate : highest;
  });
}

/**
 * Ferme une fenêtre en empruntant SON chemin de fermeture quand il existe, pour que son
 * nettoyage s'exécute. Le retrait direct n'est qu'un dernier recours.
 */
export function closeDialog(dialog) {
  if (!dialog) return false;
  if (dialog.dataset.dialogPersistent === 'true') return false;
  const own = dialog.querySelector(CLOSE_SELECTOR)
    || [...dialog.querySelectorAll('button')].find(button => /^(annuler|fermer|cancel|close)$/i.test((button.textContent || '').trim()));
  if (own) { own.click(); }
  if (isVisible(dialog)) dialog.remove();
  // Un voile laissé derrière intercepterait tous les clics de l'interface.
  if (!openDialogs().length) {
    for (const veil of document.querySelectorAll('.app-dialog-backdrop, .modal-backdrop')) veil.remove();
    document.body.style.overflow = '';
  }
  return true;
}

let installed = false;

export function installDialogBehavior(target = typeof document !== 'undefined' ? document : null) {
  if (!target || installed) return false;
  installed = true;

  target.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const dialog = topmostDialog();
    if (!dialog) return;
    // La fenêtre qui gère déjà Échap se ferme d'elle-même ; on ne double pas l'action.
    queueMicrotask(() => { if (isVisible(dialog)) closeDialog(dialog); });
  }, true);

  target.addEventListener('mousedown', event => {
    // Seul un clic sur le FOND ferme : à l'intérieur du contenu, on ne ferme jamais —
    // sinon un glissement de sélection de texte qui déborde fermerait la fenêtre.
    const dialog = event.target instanceof Element && event.target.matches(DIALOG_SELECTOR) ? event.target : null;
    if (!dialog || !isVisible(dialog)) return;
    if (dialog.dataset.dialogPersistent === 'true') return;
    queueMicrotask(() => { if (isVisible(dialog)) closeDialog(dialog); });
  }, true);

  return true;
}

if (typeof window !== 'undefined') {
  installDialogBehavior();
  window.DialogBehavior = Object.freeze({
    version: DIALOG_BEHAVIOR_VERSION, closeDialog, topmostDialog, installDialogBehavior
  });
}
