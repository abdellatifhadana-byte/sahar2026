export const EQUIPMENT_PANEL_MODE_VERSION = 1;

/**
 * @file equipment-panel-mode.js — la Fiche 360 cesse d'être une fenêtre qui recouvre tout.
 *
 * CE QUI N'ALLAIT PAS
 * -------------------
 * Mesuré dans le navigateur, sur un écran de 1600 px : la fenêtre de la Fiche 360 occupait
 * une carte de 1180 px posée au milieu, et le tableau des équipements se retrouvait
 * INACCESSIBLE — `elementFromPoint` sur la première ligne rendait la fenêtre, pas la ligne.
 *
 * Conséquence concrète : pour comparer deux appareils, il fallait fermer, retrouver sa
 * ligne, rouvrir. Sur un parc de 448 équipements, c'est le geste qu'on répète le plus.
 *
 * CE QUI CHANGE — ET SURTOUT CE QUI NE CHANGE PAS
 * -----------------------------------------------
 * Le CONTENU de la fiche n'est pas touché. Ni son identifiant `#ops-equipment-360`, ni ses
 * classes, ni sa structure interne. C'est délibéré : QUINZE fichiers référencent cet
 * identifiant — mesuré, `operations-suite.js` la crée, ce fichier la positionne, et les
 * treize autres viennent y accrocher
 * leurs panneaux (relations, média, ports de grille, preuves terrain, topologie…) en
 * observant cet identifiant précis et en insérant dans `.ops-modal-body`. Changer le
 * contenant sans changer le contrat, c'est ne rien casser.
 *
 * Seule la POSITION change, par une classe supplémentaire :
 *
 *   - large  (≥ 1280 px) : panneau accosté à droite, hauteur pleine, le tableau reste
 *                          visible et CLIQUABLE — on passe d'un appareil à l'autre sans
 *                          perdre sa place ;
 *   - étroit (< 1280 px) : feuille qui monte du bas, geste habituel sur téléphone. Y
 *                          coller un panneau latéral ne laisserait pas de place au tableau.
 *
 * POURQUOI LE SEUIL EST À 1280
 * ----------------------------
 * En dessous, un panneau de 480 px et un tableau de 15 colonnes ne tiennent pas côte à
 * côte sans que l'un des deux devienne illisible. 1280 est aussi le seuil « Desktop »
 * annoncé par la maquette : autant que l'interface et la maquette parlent du même chiffre.
 */

export const SIDE_PANEL_MIN_WIDTH = 1280;

export const PANEL_MODES = Object.freeze({
  SIDE: 'side',
  SHEET: 'sheet'
});

/** Classe posée sur la fiche elle-même. */
export const PANEL_MODE_CLASSES = Object.freeze({
  [PANEL_MODES.SIDE]: 'is-side-panel',
  [PANEL_MODES.SHEET]: 'is-bottom-sheet'
});

/** Classe posée sur `body` : elle sert à réserver la place du panneau dans le contenu. */
export const BODY_PANEL_CLASS = 'has-equipment-panel';

/** Mode d'affichage pour une largeur donnée. */
export function panelMode(viewportWidth) {
  const largeur = Number(viewportWidth);
  if (!Number.isFinite(largeur)) return PANEL_MODES.SHEET;
  return largeur >= SIDE_PANEL_MIN_WIDTH ? PANEL_MODES.SIDE : PANEL_MODES.SHEET;
}

/**
 * Applique le mode à la fiche ouverte.
 *
 * Les deux classes sont mutuellement exclusives : en laisser deux poserait un panneau à la
 * fois accosté et montant, dont la géométrie dépendrait de l'ordre des règles.
 */
export function applyPanelMode(modal, mode = PANEL_MODES.SIDE, { body = null } = {}) {
  if (!modal) return null;
  const retenu = PANEL_MODE_CLASSES[mode] ? mode : PANEL_MODES.SHEET;
  for (const classe of Object.values(PANEL_MODE_CLASSES)) modal.classList.remove(classe);
  modal.classList.add(PANEL_MODE_CLASSES[retenu]);
  modal.dataset.panelMode = retenu;
  // La place n'est réservée que pour le panneau accosté. Une feuille montante recouvre le
  // bas de l'écran : lui réserver une marge décalerait le contenu pour rien.
  const hote = body || (typeof document !== 'undefined' ? document.body : null);
  if (hote) hote.classList.toggle(BODY_PANEL_CLASS, retenu === PANEL_MODES.SIDE);
  return retenu;
}

/**
 * Retire la réservation de place. À appeler à CHAQUE fermeture, y compris quand la fiche
 * est remplacée par une autre — sinon la classe survit à la dernière fermeture et le
 * contenu reste décalé devant un panneau qui n'existe plus.
 */
export function releasePanelMode({ body = null } = {}) {
  const hote = body || (typeof document !== 'undefined' ? document.body : null);
  if (hote) hote.classList.remove(BODY_PANEL_CLASS);
}

export default Object.freeze({
  version: EQUIPMENT_PANEL_MODE_VERSION,
  SIDE_PANEL_MIN_WIDTH, PANEL_MODES, PANEL_MODE_CLASSES, BODY_PANEL_CLASS,
  panelMode, applyPanelMode, releasePanelMode
});
