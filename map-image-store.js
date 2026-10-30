/**
 * @file map-image-store.js — les octets du plan, obtenus à la demande et jamais conservés.
 *
 * CE QUE CE MODULE FAISAIT, ET POURQUOI IL A CHANGÉ
 * ------------------------------------------------
 * Il résolvait un problème de POIDS : l'image du plan dormait en base64 dans
 * `settings/global`, donc dans l'instantané que chaque poste reçoit toutes les vingt
 * secondes — 2,9 Mo par minute et par poste, mesurés sur une charge d'un mégaoctet.
 * L'instantané ne porte plus qu'une empreinte, et les octets sont téléchargés une fois.
 * Cette économie est conservée.
 *
 * Mais trois de ses comportements étaient écrits pour la disponibilité, à une époque où
 * le plan n'était pas considéré comme une donnée confidentielle. L'audit #130 a montré
 * qu'ils forment ensemble une fuite :
 *
 *   0. IL RENDAIT LA CHARGE LOCALE. Une valeur `data:` trouvée dans `settings/global`
 *      était rendue telle quelle, sans appeler le serveur. Sur un poste partagé, hors
 *      ligne, la charge laissée par un administrateur atteignait donc l'utilisateur
 *      suivant. Corrigé après le Gate indépendant : aucune valeur locale — `data:`,
 *      `http:`, `https:` ou chemin — ne constitue une preuve d'autorisation.
 *
 *   1. SANS EMPREINTE, IL RENDAIT LE CHEMIN. `settings.mapImageUrl` valant
 *      `assets/plan-technique.PNG`, la fonction rendait cette chaîne, et le navigateur
 *      allait chercher le fichier comme un actif public — hors de toute autorisation.
 *      Protéger la route API n'aurait donc rien fermé.
 *
 *   2. IL CONSERVAIT LES OCTETS DANS INDEXEDDB. L'enregistrement `map-image-cache` est
 *      STRICTEMENT LOCAL, donc `survivesAuthoritativeClear()` le protège du vidage de
 *      l'instantané — c'est correct pour une préférence, mais cela signifie qu'un plan
 *      confidentiel survivait à la révocation, à la déconnexion et au changement de
 *      compte sur le même poste. Mesuré : le plan était encore là après `logout`.
 *
 *   3. SUR REFUS, IL RENDAIT LE CACHE PÉRIMÉ. « Mieux vaut un plan d'hier qu'un écran
 *      vide » est un bon réflexe pour un technicien hors ligne devant une baie. Appliqué
 *      à un 403, il transforme un refus d'autorisation en réaffichage du document refusé.
 *
 * CE QU'IL FAIT MAINTENANT
 * ------------------------
 * Rien de local ne fait autorité, et le serveur est interrogé à CHAQUE demande.
 *
 * Un cache de session avait d'abord été retenu — un téléchargement par onglet plutôt qu'un
 * par ouverture. Le gate l'a réfuté : après révocation, le serveur refusait bien (403),
 * mais rouvrir la carte dans le MÊME onglet réaffichait le plan, parce que les octets
 * étaient déjà en mémoire et qu'on ne redemandait rien. C'était le repli périmé de
 * l'ancienne version, déplacé de la base locale vers la mémoire vive.
 *
 * L'habilitation peut être retirée à tout instant ; seule une réponse du serveur prouve
 * qu'elle tient encore. Les deux seuls appelants — l'ouverture de la carte et la fenêtre
 * de positionnement d'une salle — sont des gestes délibérés, pas une boucle : le coût est
 * une requête par ouverture, ce qui est exactement ce que la confidentialité vaut ici.
 *
 * Un refus ne rend rien. `null` veut dire « pas de plan », et l'appelant doit afficher un
 * état restreint plutôt qu'une image.
 */

import { db } from './db.js';
import { isServableMapReference } from './map-image-contract.js';

export const MAP_IMAGE_STORE_VERSION = 3;

/** Identifiant de l'ancien cache persistant. Conservé pour pouvoir le PURGER. */
export const MAP_IMAGE_CACHE_ID = 'map-image-cache';

/**
 * Les deux identifiants sous lesquels les réglages ont pu être écrits.
 *
 * `db.get('settings', 'global')` retombe déjà sur `1` — un héritage. Le nettoyage doit
 * viser les deux : purger l'un en laissant l'autre ne purgerait rien sur le poste où la
 * fiche dort sous l'ancien identifiant.
 */
const IDENTIFIANTS_REGLAGES = Object.freeze(['global', 1]);

/** Codes rendus par la route protégée quand les octets ne sont pas dus. */
const REFUS = new Set([401, 403]);

/**
 * La demande en vol, et rien d'autre.
 *
 * Ce n'est PAS un cache : elle ne survit pas à sa propre résolution. Elle existe pour que
 * deux vues qui réclament le plan au même instant ne fassent qu'un aller-retour, jamais
 * pour éviter d'interroger le serveur à l'ouverture suivante.
 */
let enCours = null;

/**
 * Efface l'ancien cache persistant s'il traîne encore.
 *
 * Les postes qui ont déjà tourné sur une version précédente portent le plan dans
 * IndexedDB. Le corriger pour les seules installations neuves laisserait la fuite en
 * place exactement là où elle a été constatée.
 */
async function purgerCacheHerite() {
  try { await db.delete('settings', MAP_IMAGE_CACHE_ID); }
  catch { /* magasin absent ou fiche déjà retirée : rien à purger. */ }
}

/**
 * L'écriture STRICTEMENT LOCALE — jamais une intention de synchroniser.
 *
 * `db.save` est enveloppé par `central-sync.js` : il pousse au serveur et, en cas d'échec,
 * met en file. Ce serait exactement le contraire de ce qu'on veut ici — retirer un champ
 * d'une projection LOCALE ne dit rien au serveur, ne fait pas avancer de révision, et ne
 * doit produire ni `PUT`, ni entrée de file, ni 403.
 *
 * `saveLocalOnly` est la primitive que `central-sync.js` expose déjà pour cela. Hors
 * navigateur — dans les épreuves — l'enveloppe n'existe pas et `db.save` EST l'écriture
 * brute : le repli est donc sûr, et non un contournement.
 */
const ecrireEnLocal = (storeName, record) =>
  (typeof db.saveLocalOnly === 'function' ? db.saveLocalOnly : db.save).call(db, storeName, record);

/**
 * RETIRER LA SOURCE DU PLAN DE LA PROJECTION LOCALE.
 *
 * Un poste qui a tourné sur un build précédent — ou qui a servi à un administrateur —
 * porte encore, dans son `settings/global` local, la source complète du plan :
 *
 *     { mapImageUrl: "data:image/png;base64,…", theme: "light", autoLogout: 30, … }
 *
 * Ne plus l'AFFICHER ne suffit pas. Sur un poste partagé, hors ligne, l'utilisateur
 * suivant porte encore le document dans sa base locale, et rien côté serveur ne peut
 * l'atteindre. La source est donc retirée de la projection locale, à la première
 * résolution comme à la déconnexion.
 *
 * TOUT LE RESTE EST PRÉSERVÉ — thème, délai de déconnexion, notifications, fréquence de
 * sauvegarde, et surtout `_revision` : ce nettoyage ne doit pas ressembler à une
 * modification, sans quoi il rouvrirait les courses de révision fermées par #117, #120
 * et #127. On réécrit la MÊME fiche, moins un champ.
 */
async function purgerSourceLocaleDuPlan() {
  // `_getRaw` lit la transaction sans ouvrir la base : appelé avant l'ouverture, il
  // échouerait, et la purge serait silencieusement sautée — exactement au premier
  // démarrage, quand elle compte le plus. `open()` est idempotent.
  try { await db.open(); } catch { return; }
  for (const identifiant of IDENTIFIANTS_REGLAGES) {
    let fiche = null;
    // La lecture est BRUTE, sans le repli `global → 1` de `db.get` : réécrire une fiche
    // lue sous un identifiant pour la déposer sous l'autre en fabriquerait une seconde.
    try { fiche = await db._getRaw('settings', identifiant); }
    catch { continue; }
    if (!fiche || fiche.mapImageUrl === undefined) continue;
    const { mapImageUrl: _source, ...sansSource } = fiche;
    try { await ecrireEnLocal('settings', sansSource); }
    catch { /* base indisponible : la prochaine résolution réessaiera. */ }
  }
}

/** Oublie tout ce qui reste du plan sur ce poste. Appelé à la déconnexion. */
export async function forgetMapImage() {
  enCours = null;
  await purgerCacheHerite();
  await purgerSourceLocaleDuPlan();
}

async function telechargerImage() {
  const reponse = await fetch('/api/settings/map-image', { credentials: 'include', cache: 'no-store' });
  if (!reponse.ok) {
    throw Object.assign(new Error('Plan indisponible dans votre périmètre.'), {
      status: reponse.status, refus: REFUS.has(reponse.status)
    });
  }
  const charge = await reponse.json();
  /*
   * Le serveur peut rendre une charge `data:` ou une URL distante — les deux formes que
   * l'écran des réglages sait configurer. Il ne peut rendre RIEN D'AUTRE : cette valeur
   * finit dans un attribut `src`, et elle vient d'un champ de formulaire.
   */
  if (!isServableMapReference(charge?.mapImageUrl)) {
    throw new Error('Réponse inattendue pour l’image du plan.');
  }
  return charge;
}

/**
 * La référence du plan, ou `null` si la session n'y a pas droit MAINTENANT.
 *
 * UN SEUL CHEMIN : on demande au serveur, et il décide. Les trois raccourcis qui
 * existaient ont tous disparu, et chacun portait la même erreur — croire qu'une valeur
 * trouvée sur le poste prouve quelque chose :
 *
 *   « rendre le chemin »        un chemin ne prouve aucune autorisation, et c'est par là
 *                               que le plan sortait ;
 *   « rendre ce qu'on a déjà »  des octets déjà reçus ne prouvent pas qu'ils sont encore
 *                               dus — la révocation les rendait de nouveau ;
 *   « rendre la charge locale » retiré par ce correctif. Une charge `data:` présente dans
 *                               les réglages locaux était rendue telle quelle, sans le
 *                               moindre appel au serveur. Sur un poste partagé, hors
 *                               ligne, l'utilisateur suivant recevait donc le plan que
 *                               l'administrateur y avait laissé.
 *
 * `settings` n'est plus lu pour DÉCIDER, seulement pour savoir s'il reste une source
 * locale à purger. Aucune condition préalable non plus sur `mapImageRef` : l'exiger
 * laisserait une fenêtre à toute fiche locale héritée qui n'en porte pas. Le serveur
 * connaît sa propre configuration ; c'est lui qu'on interroge.
 */
export async function resolveMapImageUrl(settings) {
  await purgerCacheHerite();
  await purgerSourceLocaleDuPlan();
  void settings;

  // Une seule requête en vol : plusieurs vues peuvent demander le plan au même instant.
  if (!enCours) enCours = telechargerImage().finally(() => { enCours = null; });

  try { return (await enCours).mapImageUrl; }
  catch (error) {
    /*
     * AUCUN REPLI, NI SUR LE DISQUE NI EN MÉMOIRE.
     *
     * Un refus purge ce qu'un poste ancien pourrait encore porter. Une panne réseau ne
     * rend pas davantage l'image d'hier : pour un document restreint, « pas de plan » est
     * la seule réponse sûre, et l'appelant sait l'afficher.
     */
    if (error?.refus) await purgerCacheHerite();
    else console.warn('Plan technique non disponible pour le moment.', error);
    return null;
  }
}

export default Object.freeze({
  version: MAP_IMAGE_STORE_VERSION, MAP_IMAGE_CACHE_ID, resolveMapImageUrl, forgetMapImage
});
