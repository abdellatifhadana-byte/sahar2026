import { closeInteractiveMap, contexteCarte, rouvrirCarte } from './interactive-map.js';

export const MAP_EQUIPMENT_360_BRIDGE_VERSION = 1;

function isEquipmentMapTarget(target) {
  if (!(target instanceof Element)) return null;
  const hotspot = target.closest('.map-hotspot.equipment[data-id]');
  if (hotspot) return { id:hotspot.dataset.id, source:'hotspot' };
  const searchItem = target.closest('#map-search-results [data-type="equipment"][data-id]');
  if (searchItem) return { id:searchItem.dataset.id, source:'search' };
  return null;
}

/**
 * UN RELEVÉ DE COORDONNÉES EST-IL OUVERT ?
 *
 * « Enregistrer » et « Annuler » ne sont à l'écran QUE pendant une session d'édition de
 * coordonnées : `interactive-map.js` ne les rend que sous `showSaveBtns`, c'est-à-dire
 * `coordinateSessionMatches(type, id)`. Ils ne sont donc pas un indice de l'état, ils SONT
 * l'état, rendu visible — et c'est à ce titre qu'on les lit ici, sans inventer un drapeau
 * parallèle qu'il faudrait ensuite tenir à jour des deux côtés.
 */
function coordinateEditIsLive() {
  return Boolean(document.querySelector('#map-modal #save-coords-btn, #map-modal #cancel-coords-btn'));
}

/**
 * LE PLAN EST-IL EN TRAIN D'ÊTRE MODIFIÉ ? — ET PAS SEULEMENT « LE BOUTON EST-IL VERT ».
 *
 * Ce prédicat décide si le pont se retire. Il ne regardait que
 * `#map-modal #edit-mode-btn.success`, la classe posée par le bouton « Mode édition » de
 * la barre d'outils. Or `beginCoordinateSession()` met bien `dragMode` à vrai, mais ne
 * touche PAS cette classe : un relevé ouvert par « Modifier les positions » — le geste que
 * l'exploitant fait réellement, depuis le panneau d'une salle ou d'une baie — laissait donc
 * le pont armé.
 *
 * Et ce pont écoute en phase de CAPTURE sur le document : il coupait l'interaction avant
 * tout gestionnaire de la carte, fermait le plan et ouvrait la Fiche 360°. Enregistrer et
 * Annuler disparaissaient avec le plan, et le relevé en cours était perdu — au milieu du
 * parcours Modifier / Annuler / Enregistrer.
 *
 * Les DEUX états comptent donc, parce que les deux sont des modifications en cours. La
 * consultation, elle, ne change pas d'un iota : sans mode édition ET sans relevé ouvert, le
 * pont intercepte comme avant et la Fiche 360° s'ouvre.
 */
function mapIsInEditMode() {
  return Boolean(document.querySelector('#map-modal #edit-mode-btn.success')) || coordinateEditIsLive();
}

export async function openMapEquipment360(id) {
  const equipmentId = String(id || '').trim();
  if (!equipmentId) return false;
  const open360 = window.TechOperations?.openEquipment360;
  if (typeof open360 !== 'function') {
    window.AppDialog?.notice?.('La Fiche 360° est encore en cours de chargement.', 'warning');
    return false;
  }
  /*
   * LA CARTE SE FERME, PUIS SE REMONTE — ELLE NE SE SUPERPOSE PAS.
   *
   * Laisser le plan ouvert DERRIÈRE la fiche a été essayé et mesuré : `.ops-modal` est bien
   * au-dessus par le `z-index`, mais un clic RÉEL sur sa fermeture expire — la fiche n'est
   * pas fiablement atteignable tant que le plan est monté. La fermeture est donc conservée.
   *
   * Ce qui manquait n'était pas la superposition, c'était le RETOUR : refermer la fiche
   * ramenait au tableau de bord, et il fallait rouvrir la carte puis refaire tout le chemin
   * — ville, salle, baie — pour chaque appareil consulté. On note donc où l'on était avant
   * de fermer, et on remonte le plan à cet endroit quand la fiche disparaît.
   */
  const contexte = contexteCarte();
  closeInteractiveMap({ notify:false });
  await open360(equipmentId);
  if (contexte?.vue && contexte.vue.type !== 'map') restaurerCarteALaFermeture(contexte);
  return true;
}

/** La feuille réellement ouverte par la Fiche 360, ou son repli. */
function feuille360() {
  return document.querySelector('.ops-modal') || document.getElementById('equip-quickview-modal');
}

/**
 * Remonte le plan quand la fiche quitte le document.
 *
 * Un observateur plutôt qu'un délai : la fiche se ferme quand l'utilisateur le décide, pas
 * au bout d'un temps devinable. Il se débranche dès qu'il a servi, et se débranche aussi
 * si la fiche n'est jamais apparue — sans quoi il resterait à écouter le document entier.
 */
function restaurerCarteALaFermeture(contexte) {
  const feuille = feuille360();
  if (!feuille) return;
  const observateur = new MutationObserver(() => {
    if (feuille.isConnected) return;
    observateur.disconnect();
    rouvrirCarte(contexte).catch(error => {
      console.error('Retour à la carte impossible', error);
    });
  });
  observateur.observe(document.body, { childList:true, subtree:true });
}

function installBridge() {
  if (typeof document === 'undefined' || document.documentElement.dataset.mapEquipment360Bridge === '1') return;
  document.documentElement.dataset.mapEquipment360Bridge = '1';
  document.addEventListener('click', event => {
    const target = isEquipmentMapTarget(event.target);
    if (!target || mapIsInEditMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openMapEquipment360(target.id).catch(error => {
      console.error('Ouverture Fiche 360 depuis la carte impossible', error);
      window.AppDialog?.notice?.('Impossible d’ouvrir la Fiche 360° de cet équipement.', 'error');
    });
  }, true);
}

if (typeof window !== 'undefined') {
  installBridge();
  window.MapEquipment360Bridge = Object.freeze({
    version:MAP_EQUIPMENT_360_BRIDGE_VERSION,
    open:openMapEquipment360,
    isEditMode:mapIsInEditMode
  });
}
