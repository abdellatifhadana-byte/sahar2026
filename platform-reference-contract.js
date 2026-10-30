/**
 * @file platform-reference-contract.js — un instantané filtré n'est pas une absence centrale.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME
 * ------------------------------
 * Certaines fiches sont des RÉFÉRENCES DE PLATEFORME : un plan de vérification, un
 * catalogue, une politique. Elles n'appartiennent à aucune zone, et ne figurent donc pas
 * dans l'instantané d'un rôle à périmètre — non pas parce qu'elles n'existent pas, mais
 * parce qu'elles ne le regardent pas.
 *
 * Un module d'initialisation qui lit « je ne la vois pas » et en conclut « elle n'existe
 * pas, je la crée » entre alors dans une boucle qui ne peut pas converger :
 *
 *     absente de l'instantané → tentative d'écriture
 *     → le serveur refuse, à juste titre
 *     → le retour arrière efface la copie locale
 *     → absente de nouveau → tentative suivante
 *
 * Chaque refus prépare la tentative suivante. Mesuré sur une session IMMOBILE de soixante
 * secondes : ~48 écritures et ~53 opérations en échec pour un chef, un responsable ou un
 * visiteur ; ~44 pour un technicien. Aucune action humaine, aucun résultat, et une file de
 * synchronisation qui gonfle toute seule.
 *
 * LA RÈGLE
 * --------
 * Seul un rôle qui voit TOUTES les zones peut conclure d'une absence qu'il faut initialiser.
 * C'est exactement `roleSeesEveryZone` : pour lui, et pour lui seul, « je ne la vois pas »
 * et « elle n'existe pas » veulent dire la même chose.
 *
 * Tous les autres rôles LISENT la référence — et s'en passent quand elle n'est pas visible,
 * puisque son contenu est une constante du module qui la décrit. Ils ne l'écrivent jamais.
 *
 * CE QUE CE CONTRAT N'EST PAS
 * ---------------------------
 * Ce n'est pas un ralentissement. Espacer les tentatives ne ferait que diluer la tempête :
 * elle repartirait au premier retour sur l'onglet, au premier retour du réseau, au premier
 * rechargement. Ce n'est pas non plus un élargissement de permission : ouvrir l'écriture des
 * documents aux rôles à périmètre leur donnerait le droit de modifier une référence qui ne
 * les regarde pas — on remplacerait une boucle par une fuite.
 */
import { roleSeesEveryZone } from './roles.js';

/**
 * Ce rôle peut-il initialiser une référence de plateforme absente ?
 *
 * `roleSeesEveryZone` est la bonne question, et pas « a-t-il le droit d'écrire » : ce qui
 * fonde l'autorité ici n'est pas le droit d'écrire, c'est le fait de VOIR TOUT — seul un
 * regard complet permet de conclure d'une absence à une inexistence.
 */
export function hasCentralInitiationAuthority(role) {
  return roleSeesEveryZone(role);
}

/** L'identité en session, telle que le navigateur la conserve. */
export function currentIdentity() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return JSON.parse(localStorage.getItem('auth') || 'null');
  } catch { return null; }
}

/** La session courante peut-elle initialiser une référence de plateforme ? */
export function sessionMayInitiatePlatformReference() {
  return hasCentralInitiationAuthority(currentIdentity()?.role);
}

/*
 * MÉMOIRE DES TENTATIVES — pour que même un rôle autorisé ne boucle pas.
 *
 * Une initialisation automatique qui échoue et qui oublie l'avoir tentée recommence au
 * prochain événement, et reproduit la tempête sous une autre identité. On retient donc ce
 * qu'on a essayé, le temps de la session.
 *
 * La mémoire ne survit pas au rechargement, et c'est voulu : un rechargement est un geste
 * humain, et l'occasion légitime de retenter une initialisation qui avait échoué pour une
 * raison passagère.
 */
const tentees = new Set();

/** Cette référence a-t-elle déjà fait l'objet d'une tentative dans cette session ? */
export function platformReferenceAlreadyAttempted(referenceId) {
  return tentees.has(String(referenceId));
}

/** Retenir qu'on a tenté d'initialiser cette référence. */
export function rememberPlatformReferenceAttempt(referenceId) {
  tentees.add(String(referenceId));
}

/** Oublier la tentative — après un succès, ou pour repartir d'un état propre. */
export function forgetPlatformReferenceAttempt(referenceId) {
  tentees.delete(String(referenceId));
}

/** Vider toute la mémoire. Réservé aux épreuves : chacune doit partir d'un état connu. */
export function resetPlatformReferenceMemory() {
  tentees.clear();
}

/**
 * DEUX ENREGISTREMENTS QUI PORTENT LES MÊMES VALEURS SONT LE MÊME ENREGISTREMENT.
 *
 * La garde de convergence comparait deux textes : `JSON.stringify(avant)` contre
 * `JSON.stringify(après)`. Or `JSON.stringify` est sensible à l'ORDRE DES CLÉS, et
 * PostgreSQL ne le conserve pas : il range le `jsonb` sous forme canonique, par longueur de
 * clé puis par octet. Un enregistrement qui revient de l'instantané a donc ses objets
 * imbriqués réordonnés.
 *
 * Mesuré sur `main@02cfedc9`, pour Admin comme pour Manager : seize clés de premier niveau
 * contre seize, même ordre, aucune valeur différente — et pourtant une écriture par cycle
 * d'instantané, sans fin. La divergence était UN NIVEAU PLUS BAS :
 *
 *   venu du serveur : "policy":{"sourceLayers":[…],"noActiveCrosspointInference":true,…}
 *   calculé ici     : "policy":{"documentaryBaselineImmutable":true,…}
 *
 * écriture → PostgreSQL renormalise → instantané → ordre différent → écriture…
 *
 * L'ordre de sérialisation d'un objet n'est pas une donnée : c'est un détail de stockage.
 * Le faire entrer dans une décision d'écriture, c'est écrire pour rien.
 *
 * CE QUI RESTE SIGNIFICATIF
 * -------------------------
 * L'ordre des ÉLÉMENTS d'un tableau, lui, porte du sens — `sourceLayers` décrit une
 * succession de couches, et les inverser ne dit pas la même chose. Les tableaux sont donc
 * comparés dans l'ordre. Un champ absent et un champ à `undefined` disent la même chose et
 * sont traités comme tels : c'est ainsi que l'appelant neutralise `updatedAt`.
 */
export function sameReferenceContent(gauche, droite) {
  if (Object.is(gauche, droite)) return true;
  if (gauche === null || droite === null) return false;
  if (typeof gauche !== 'object' || typeof droite !== 'object') return false;

  if (Array.isArray(gauche) || Array.isArray(droite)) {
    if (!Array.isArray(gauche) || !Array.isArray(droite)) return false;
    if (gauche.length !== droite.length) return false;
    return gauche.every((element, index) => sameReferenceContent(element, droite[index]));
  }

  const clesUtiles = objet => Object.keys(objet).filter(cle => objet[cle] !== undefined).sort();
  const clesGauche = clesUtiles(gauche);
  const clesDroite = clesUtiles(droite);
  if (clesGauche.length !== clesDroite.length) return false;
  if (clesGauche.some((cle, index) => cle !== clesDroite[index])) return false;
  return clesGauche.every(cle => sameReferenceContent(gauche[cle], droite[cle]));
}

/**
 * La décision complète, en un seul endroit.
 *
 * Rend `true` seulement si cette session peut ET doit tenter l'initialisation. Marque la
 * tentative au passage : l'appelant qui reçoit `true` va écrire, et ne doit pas pouvoir
 * l'oublier si son écriture est refusée.
 */
export function claimPlatformReferenceInitiation(referenceId) {
  if (!sessionMayInitiatePlatformReference()) return false;
  if (platformReferenceAlreadyAttempted(referenceId)) return false;
  rememberPlatformReferenceAttempt(referenceId);
  return true;
}
