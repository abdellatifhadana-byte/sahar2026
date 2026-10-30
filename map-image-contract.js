/**
 * @file map-image-contract.js — ce qu'est le plan opérationnel, et où il n'a pas le droit
 *       d'être servi.
 *
 * POURQUOI CETTE RÈGLE NE VIT PAS DANS `scripts/serve.js`
 * ------------------------------------------------------
 * `roles.js` a déjà tiré la leçon, et elle vaut ici mot pour mot : une règle de sécurité
 * écrite dans le serveur ne peut pas être EXÉCUTÉE par un test, parce que l'importer
 * ouvrirait un port et une base. Les tests ne peuvent alors qu'y chercher des chaînes de
 * caractères — et un test qui lit du texte reste vert quand on inverse une condition.
 *
 * La fermeture du plan technique est exactement ce genre de règle : une ligne, un fichier,
 * et toute la confidentialité du lot #131 qui en dépend. Elle vit donc ici, où
 * `scripts/serve.js` la lit comme les tests l'exécutent.
 *
 * CE QUE LE PLAN EST
 * ------------------
 * `assets/plan-technique.PNG` n'est pas un actif d'application. Il dessine, sur les mêmes
 * pixels, RF1, RF2, l'acquisition, les salles serveurs et STC, avec leurs portes et leurs
 * circulations. Mesuré sur la base b5f538e7 : servi en 46 276 octets à un client NON
 * AUTHENTIFIÉ, et pré-chargé par le Service Worker avant toute connexion.
 *
 * Un bitmap est INDIVISIBLE : on ne peut pas en livrer une moitié. Ses octets ne sortent
 * donc que par `/api/settings/map-image`, qui demande au moteur d'accès si elles sont dues.
 */

/**
 * Les deux casses du plan intégré. Le dépôt porte les deux fichiers, et un serveur de
 * fichiers ne les distingue pas toujours : fermer l'une et laisser l'autre ne fermerait
 * rien du tout.
 */
export const OPERATIONAL_MAP_FILES = Object.freeze([
  'assets/plan-technique.PNG',
  'assets/plan-technique.png'
]);

/** La forme comparable d'un chemin : sans requête, sans casse, sans segments vides. */
function segments(urlPath) {
  const sansRequete = String(urlPath ?? '').split('?')[0].split('#')[0];
  let decode = sansRequete;
  try { decode = decodeURIComponent(sansRequete); } catch { /* chemin illisible : tel quel. */ }
  return decode.replaceAll('\\', '/').split('/').filter(Boolean);
}

/**
 * Ce chemin demandé désigne-t-il le plan opérationnel ?
 *
 * Comparé en minuscules et segment par segment : `/assets/plan-technique.PNG`,
 * `/assets/plan-technique.png` et leurs formes encodées désignent le même fichier.
 * Rien d'autre du dossier `assets` n'est concerné — la fermeture est CIBLÉE, les actifs
 * généraux de l'application restent publics.
 */
export function isOperationalMapAsset(urlPath) {
  const chemin = segments(urlPath).join('/').toLowerCase();
  return OPERATIONAL_MAP_FILES.some(fichier => fichier.toLowerCase() === chemin);
}

/**
 * LES QUATRE FORMES QU'UN PLAN CONFIGURÉ PEUT PRENDRE.
 *
 * La première version de ce contrat ne posait qu'une question — « est-ce du `data:` ? » —
 * et traitait TOUT le reste comme le plan intégré. Le Gate indépendant a montré ce que
 * cela coûtait : l'écran des réglages porte un vrai parcours « Appliquer l'URL », et une
 * image distante configurée par l'administrateur était silencieusement remplacée par le
 * plan livré avec la plateforme. L'interface annonçait « URL du plan enregistrée » pendant
 * que la carte affichait autre chose.
 *
 * Le repli par défaut est donc supprimé : une valeur qu'on ne sait pas classer n'est pas
 * le plan intégré, elle est INCONNUE — et une source inconnue ne se sert pas.
 */
export const MAP_SOURCE = Object.freeze({
  /** Le plan livré avec la plateforme : valeur vide, ou le chemin qui le désigne. */
  BUILTIN: 'builtin',
  /** Une image téléversée par l'administrateur, portée par la valeur elle-même. */
  UPLOAD: 'upload',
  /** Une image distante configurée par « Appliquer l'URL ». */
  REMOTE: 'remote',
  /** Tout le reste. Ni servi, ni deviné. */
  UNKNOWN: 'unknown'
});

/**
 * Classe une valeur de `settings.mapImageUrl`.
 *
 * L'ordre compte : une charge `data:` et une URL distante se reconnaissent à leur schéma,
 * le plan intégré à son chemin exact. Ce qui ne correspond à aucun des trois — un schéma
 * actif comme `javascript:`, un chemin arbitraire, une valeur abîmée — rend `UNKNOWN`.
 * C'est un refus, pas un repli : deviner ici reviendrait à servir un document à la place
 * d'un autre.
 */
export function classifyOperationalMapSource(value) {
  const brut = String(value ?? '').trim();
  if (!brut) return MAP_SOURCE.BUILTIN;
  if (/^data:image\//i.test(brut)) return MAP_SOURCE.UPLOAD;
  if (/^https?:\/\//i.test(brut)) return MAP_SOURCE.REMOTE;
  if (isOperationalMapAsset(brut)) return MAP_SOURCE.BUILTIN;
  return MAP_SOURCE.UNKNOWN;
}

/**
 * Cette valeur DÉSIGNE-t-elle le plan intégré, plutôt que de le porter ?
 *
 * `settings.mapImageUrl` vaut historiquement `assets/plan-technique.PNG`. Ce n'est plus
 * une URL à charger — le fichier n'est plus servi — mais un DÉSIGNATEUR : « le plan livré
 * avec la plateforme ». Le serveur en lit alors les octets lui-même, pour qui y a droit.
 */
export function designatesBuiltinOperationalMap(value) {
  return classifyOperationalMapSource(value) === MAP_SOURCE.BUILTIN;
}

/**
 * Cette référence, RENDUE PAR LE SERVEUR, est-elle chargeable par le navigateur ?
 *
 * Trois schémas, et trois seulement. `javascript:`, `file:`, `ftp:` ou un schéma inconnu
 * ne doivent jamais atteindre un attribut `src` — pas même venus du serveur, parce que la
 * valeur y est arrivée par un formulaire d'administration.
 */
export function isServableMapReference(value) {
  const brut = String(value ?? '').trim();
  return /^data:image\//i.test(brut) || /^https?:\/\//i.test(brut);
}

export default Object.freeze({
  OPERATIONAL_MAP_FILES, MAP_SOURCE, isOperationalMapAsset,
  classifyOperationalMapSource, designatesBuiltinOperationalMap, isServableMapReference
});
