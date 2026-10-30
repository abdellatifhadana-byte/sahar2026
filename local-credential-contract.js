/**
 * @file local-credential-contract.js — AUCUN MAGASIN LOCAL NE GARDE UN SECRET (B-4).
 *
 * CE QUI A ÉTÉ MESURÉ
 * -------------------
 * `index.html` charge `central-sync.js` AVANT `credential-cache-guard.js`. Le garde
 * enveloppe donc la sauvegarde de la synchronisation : il appelle `previousSave()` — qui a
 * DÉJÀ recopié la fiche complète dans `syncQueue` — puis nettoie le seul magasin `users`.
 *
 * Mesuré sur `d9739797`, Chromium réel contre PostgreSQL réel : après une création
 * d'utilisateur hors ligne, `users` est propre et `syncQueue.data.password` porte
 * `VmVycm91...`, que `atob` rend en clair. Une entrée `conflict`/`failed` étant TERMINALE,
 * le secret y dormait sans échéance.
 *
 * POURQUOI CE MODULE, ET PAS UN ÉCHANGE D'ORDRE DE CHARGEMENT
 * -----------------------------------------------------------
 * Inverser les deux balises ferait passer l'épreuve et ne prouverait rien : la sécurité
 * dépendrait alors de l'ordre de deux lignes de `index.html`, qu'un ajout de module
 * déplace sans le savoir. La règle vit donc ICI, en un seul endroit, et s'applique aux
 * FRONTIÈRES DE PERSISTANCE — pas à l'interface.
 *
 * Une seule liste de champs. Deux listes finiraient par diverger, et la seconde
 * laisserait passer exactement ce que la première retient.
 */

/**
 * Les champs qu'aucun magasin persistant du navigateur n'a le droit de conserver.
 *
 * `password` est la matière envoyée au serveur ; `passwordHash` et `passwordScheme`
 * n'ont jamais été écrits par le code courant, mais des versions antérieures en ont
 * laissé sur le disque des postes — ils sont donc nettoyés au même titre.
 */
export const CHAMPS_CREDENTIELS = Object.freeze(['password', 'passwordHash', 'passwordScheme']);

/**
 * Les magasins dont une écriture constitue une ROTATION D'IDENTIFIANT.
 *
 * Cette liste sert à une seule question : cette écriture exige-t-elle le serveur central ?
 * Elle ne dit RIEN de l'endroit où un secret a pu atterrir — l'assainissement avant
 * persistance et la purge des résidus ne s'y réfèrent pas, et ne doivent pas s'y référer :
 * une fiche de réglages portant un champ `password` égaré doit être assainie sans pour
 * autant devenir une rotation de mot de passe (B4-R4).
 */
export const MAGASINS_PORTEURS_DE_CREDENTIELS = Object.freeze(['users']);

/**
 * Message rendu à l'opérateur quand un changement d'identifiant ne peut pas partir.
 *
 * Il dit ce qui s'est passé ET ce qu'il reste à faire. « Erreur de synchronisation »
 * laisserait croire à une panne passagère qu'une file rattraperait — or rien ne sera
 * rattrapé : la saisie est à refaire, en ligne.
 */
export const MESSAGE_CREDENTIEL_EN_LIGNE_SEUL =
  "Un changement de mot de passe exige une connexion au serveur central : il n'est jamais conservé sur ce poste. "
  + 'Aucune modification n’a été enregistrée. Reconnectez-vous au central, puis ressaisissez le mot de passe.';

/** Motif inscrit sur une entrée héritée neutralisée, pour que l'écran dise vrai. */
export const MOTIF_CREDENTIEL_HERITE =
  'Mot de passe non transmis au central et retiré de ce poste : à ressaisir en ligne.';

/** Cette valeur est-elle une fiche que l'on peut inspecter champ par champ ? */
const estFiche = valeur => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);

/**
 * Cette fiche porte-t-elle un champ d'authentification, à n'importe quelle profondeur ?
 *
 * La profondeur compte : la charge d'une entrée de file vit sous `data`, et une entrée
 * héritée pourrait en porter ailleurs. Une recherche au seul premier niveau retiendrait
 * `users.password` et laisserait filer `syncQueue.data.password` — c'est-à-dire
 * exactement le défaut mesuré.
 */
export function porteUnCredentiel(valeur) {
  if (Array.isArray(valeur)) return valeur.some(element => porteUnCredentiel(element));
  if (!estFiche(valeur)) return false;
  for (const [cle, sousValeur] of Object.entries(valeur)) {
    if (CHAMPS_CREDENTIELS.includes(cle) && sousValeur !== undefined) return true;
    if (porteUnCredentiel(sousValeur)) return true;
  }
  return false;
}

/**
 * LE SANITISEUR CANONIQUE — pur, récursif, sans effet de bord.
 *
 * Rend une COPIE sans aucun champ d'authentification. Une fonction pure : l'appelant
 * décide quoi persister, et rien ici ne touche à un magasin.
 */
export function sanitizeLocalUserCredentialFields(valeur) {
  if (Array.isArray(valeur)) return valeur.map(element => sanitizeLocalUserCredentialFields(element));
  if (!estFiche(valeur)) return valeur;
  const propre = {};
  for (const [cle, sousValeur] of Object.entries(valeur)) {
    if (CHAMPS_CREDENTIELS.includes(cle)) continue;
    propre[cle] = sanitizeLocalUserCredentialFields(sousValeur);
  }
  return propre;
}

/**
 * Cette écriture est-elle un CHANGEMENT D'IDENTIFIANT ?
 *
 * C'est la question posée AVANT toute persistance locale : un changement de mot de passe
 * est en ligne seulement, une modification de profil reste hors ligne capable. Les deux
 * arrivent par le même `db.save('users', …)` et ne se distinguent que par là.
 */
export function estEcritureCredentielle(storeName, fiche) {
  if (!MAGASINS_PORTEURS_DE_CREDENTIELS.includes(storeName)) return false;
  return porteUnCredentiel(fiche);
}

/**
 * NEUTRALISER UNE ENTRÉE DE FILE HÉRITÉE — retirer le secret SANS mentir sur l'effet.
 *
 * Retirer le seul champ et laisser l'entrée `pending` serait le pire des deux mondes :
 * elle repartirait, le serveur accepterait une mise à jour de profil, et l'opérateur
 * croirait son mot de passe changé alors qu'il ne l'a jamais été. L'entrée est donc
 * rendue TERMINALE et porte le motif : la reprise est humaine, et elle est en ligne.
 *
 * Une entrée qui ne porte aucun secret n'est pas touchée — elle vaut ce qu'elle a
 * toujours valu, et la file de l'utilisateur lui appartient (#98).
 *
 * Rend `null` quand il n'y a rien à faire, la fiche à réécrire sinon.
 */
export function neutraliserEntreeHeritee(entree, { statutTerminal = 'failed' } = {}) {
  if (!estFiche(entree) || !porteUnCredentiel(entree)) return null;
  return {
    ...sanitizeLocalUserCredentialFields(entree),
    status: statutTerminal,
    lastError: MOTIF_CREDENTIEL_HERITE,
    lastErrorCode: 'LOCAL_CREDENTIAL_PURGED',
    credentialPurgedAt: new Date().toISOString()
  };
}
