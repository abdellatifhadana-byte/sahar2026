/**
 * @file map-navigation-contract.js — OÙ FAUT-IL SE PLACER POUR MONTRER CETTE FICHE ?
 *
 * LE DÉFAUT QUE CE CONTRAT FERME.
 *
 * « Localiser » plaçait la vue SUR la cible elle-même. Localiser une baie ouvrait donc la
 * scène de cette baie, puis l'ouverture du panneau empilait la MÊME baie dans
 * l'historique : « Retour » ramenait à la baie qu'on venait de quitter, au lieu de sa
 * salle. L'utilisateur tournait en rond d'un niveau sur lui-même.
 *
 * La règle : on se place dans la scène du PARENT, là où la cible est visible et peut être
 * désignée. « Retour » retrouve alors naturellement le niveau au-dessus.
 *
 *     salle       → plan général      ⟶ Retour : plan général
 *     baie        → scène de sa salle ⟶ Retour : sa salle
 *     équipement  → scène de sa baie si elle existe, sinon celle de sa salle
 *
 * Pur : ni DOM, ni IndexedDB, ni réseau. C'est ce qui permet d'EXÉCUTER la règle dans une
 * épreuve, plutôt que de chercher une expression dans le source.
 */

export const MAP_NAVIGATION_CONTRACT_VERSION = 1;

const meme = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * La scène depuis laquelle CETTE fiche se désigne.
 *
 * Rend `null` quand la fiche est introuvable ou que sa chaîne de rattachement ne mène nulle
 * part : on ne fabrique pas une scène pour une fiche qu'on ne sait pas situer.
 */
export function sceneForTarget(type, id, { rooms = [], baies = [], equipments = [] } = {}) {
  if (type === 'room') {
    const salle = rooms.find(item => meme(item?.id, id));
    return salle ? Object.freeze({ type: 'map' }) : null;
  }

  if (type === 'baie') {
    const baie = baies.find(item => meme(item?.id, id));
    if (!baie) return null;
    const salle = rooms.find(item => meme(item?.id, baie.roomId));
    // Une baie dont la salle est introuvable n'a pas de scène parente : la montrer
    // « quelque part » reviendrait à mentir sur l'endroit où elle se trouve.
    return salle ? Object.freeze({ type: 'room', id: salle.id }) : null;
  }

  if (type === 'equipment') {
    const equipement = equipments.find(item => meme(item?.id, id));
    if (!equipement) return null;
    if (equipement.baieId !== null && equipement.baieId !== undefined) {
      const baie = baies.find(item => meme(item?.id, equipement.baieId));
      if (baie) return Object.freeze({ type: 'baie', id: baie.id });
    }
    const salle = rooms.find(item => meme(item?.id, equipement.roomId));
    return salle ? Object.freeze({ type: 'room', id: salle.id }) : null;
  }

  return null;
}

/**
 * L'historique tel qu'il DOIT être après avoir situé puis ouvert une fiche.
 *
 * Le panneau empile la vue courante avant de changer de niveau. En se plaçant d'abord dans
 * la scène du parent, c'est donc CELLE-LÀ qui est empilée — et c'est elle que « Retour »
 * restitue. Cette fonction rend la séquence attendue pour qu'une épreuve la vérifie sans
 * monter le DOM.
 */
export function localiserPuisOuvrir(type, id, modele, historique = []) {
  const scene = sceneForTarget(type, id, modele);
  if (!scene) return null;
  return Object.freeze({
    scene,
    historique: Object.freeze([...historique, scene]),
    retour: scene
  });
}

/**
 * LE CHEMIN DE RETOUR DEPUIS LE TRACÉ D'UN CÂBLE — Câble → Équipement → Baie → Salle.
 *
 * POURQUOI IL FAUT LE POSER, ET NE PAS LE LAISSER SE FAIRE TOUT SEUL.
 *
 * On entre dans le tracé d'un câble depuis la Fiche 360 d'un ÉQUIPEMENT, et l'on atterrit
 * dans une scène qui n'a aucun rapport de parenté avec lui : le cheminement traverse ce
 * qu'il traverse. L'historique de la carte est alors vide, et « Retour » renvoyait au plan
 * général — c'est-à-dire à côté de l'endroit d'où l'on venait.
 *
 * Le chemin attendu remonte la chaîne de rattachement de l'équipement d'origine. Il est
 * rendu du plus LOINTAIN au plus PROCHE, dans l'ordre d'une pile que « Retour » dépile :
 *
 *     [ salle, baie ]   →  Retour : la baie, puis la salle, puis le plan général
 *     [ salle ]         →  un équipement hors baie n'en invente pas une
 *     [ ]               →  équipement introuvable : on ne fabrique aucun retour
 *
 * La remontée réutilise `sceneForTarget` maillon par maillon plutôt que de relire les
 * champs : deux lectures de la même chaîne finiraient par diverger, et c'est la plus
 * bavarde qui enverrait l'exploitant dans une salle où la fiche n'est pas.
 */
export function cableReturnPath(equipmentId, modele = {}) {
  const chemin = [];
  const vues = new Set();
  let scene = sceneForTarget('equipment', equipmentId, modele);
  while (scene && scene.type !== 'map') {
    const cle = `${scene.type}#${scene.id}`;
    // Un rattachement circulaire est une donnée fausse, pas une boucle à parcourir.
    if (vues.has(cle)) break;
    vues.add(cle);
    chemin.unshift(Object.freeze({ type: scene.type, id: scene.id }));
    scene = sceneForTarget(scene.type, scene.id, modele);
  }
  return Object.freeze(chemin);
}

export default Object.freeze({
  version: MAP_NAVIGATION_CONTRACT_VERSION, sceneForTarget, localiserPuisOuvrir, cableReturnPath
});
