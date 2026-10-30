export const PASSWORD_POLICY_VERSION = 1;

/**
 * Politique de mot de passe, partagée par le navigateur et le serveur.
 *
 * La création d'utilisateur acceptait n'importe quoi : un caractère suffisait. Un
 * contrôle posé uniquement dans le formulaire ne protégerait de rien — n'importe quel
 * appel direct à l'API le contournerait — donc la même règle est appliquée des deux
 * côtés, depuis ce module sans dépendance.
 */

export const MIN_PASSWORD_LENGTH = 10;

// Motifs les plus utilisés dans les compromissions par liste : les refuser coûte peu et
// écarte la faiblesse la plus fréquente.
const SUITES_INTERDITES = Object.freeze([
  'azerty', 'qwerty', 'motdepasse', 'password', 'admin', 'bienvenue', 'welcome',
  '123456', '000000', '111111', 'abcdef', '2mtech', 'technique'
]);

const CLASSES = Object.freeze([
  { nom:'une minuscule', test:/[a-z]/ },
  { nom:'une majuscule', test:/[A-Z]/ },
  { nom:'un chiffre', test:/[0-9]/ },
  { nom:'un caractère spécial', test:/[^A-Za-z0-9]/ }
]);

/** Répétition d'un même caractère, ou suite ordonnée : « aaaa », « 1234 », « abcd ». */
function contientSuiteTriviale(valeur) {
  if (/(.)\1{3,}/.test(valeur)) return true;
  const bas = valeur.toLowerCase();
  for (let index = 0; index + 3 < bas.length; index += 1) {
    const codes = [0, 1, 2, 3].map(offset => bas.charCodeAt(index + offset));
    const croissant = codes.every((code, rang) => rang === 0 || code === codes[rang - 1] + 1);
    const decroissant = codes.every((code, rang) => rang === 0 || code === codes[rang - 1] - 1);
    if (croissant || decroissant) return true;
  }
  return false;
}

/**
 * Évalue un mot de passe. Retourne toujours la même forme, côté navigateur comme côté
 * serveur : `{ valide, score, niveau, problemes }`.
 *
 * `contexte` permet de refuser un mot de passe qui reprend le nom d'utilisateur ou le
 * nom complet — le cas le plus courant, et le plus facile à deviner.
 */
export function evaluatePassword(valeur, contexte = {}) {
  const mot = String(valeur ?? '');
  const problemes = [];

  if (mot.length < MIN_PASSWORD_LENGTH) {
    problemes.push(`au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }
  const manquantes = CLASSES.filter(classe => !classe.test.test(mot));
  // Trois classes sur quatre suffisent : exiger les quatre pousse aux « P@ssw0rd! »,
  // qui satisfont la règle sans rien gagner en robustesse.
  if (manquantes.length > 1) {
    problemes.push(`au moins trois types parmi : ${CLASSES.map(classe => classe.nom).join(', ')}`);
  }
  if (contientSuiteTriviale(mot)) {
    problemes.push('ni répétition ni suite de caractères (« aaaa », « 1234 »)');
  }
  const bas = mot.toLowerCase();
  if (SUITES_INTERDITES.some(suite => bas.includes(suite))) {
    problemes.push('aucun mot courant ou nom de la plateforme');
  }
  for (const [cle, libelle] of [['username', "le nom d'utilisateur"], ['fullName', 'le nom complet']]) {
    const reference = String(contexte[cle] ?? '').toLowerCase().trim();
    if (reference.length >= 4 && bas.includes(reference)) problemes.push(`ne pas contenir ${libelle}`);
  }

  const classesPresentes = CLASSES.length - manquantes.length;
  const score = Math.max(0, Math.min(100, Math.round(
    Math.min(mot.length, 20) * 3 + classesPresentes * 8 - problemes.length * 18
  )));
  const niveau = problemes.length ? (score < 35 ? 'faible' : 'insuffisant')
    : score >= 78 ? 'excellent' : score >= 58 ? 'solide' : 'acceptable';

  return { valide:problemes.length === 0, score, niveau, problemes:[...new Set(problemes)] };
}

/**
 * Message d'erreur unique, formulé de la même façon partout.
 *
 * Les exigences ne sont pas toutes de la même forme : « au moins 10 caractères » est une
 * quantité, « aucun mot courant » et « ni répétition ni suite » sont des interdictions.
 * Les enchaîner après « Il doit comporter » produisait « Il doit comporter aucun mot
 * courant » — vu tel quel dans la sortie d'intégration continue. Un intitulé neutre suivi
 * de deux-points fonctionne avec toutes les formes ; le point-virgule sépare, parce que
 * plusieurs exigences contiennent déjà des virgules.
 */
export function passwordRejectionMessage(evaluation) {
  if (!evaluation || evaluation.valide) return '';
  return `Mot de passe trop faible. Exigences non satisfaites : ${evaluation.problemes.join(' ; ')}.`;
}

export default Object.freeze({
  version:PASSWORD_POLICY_VERSION, MIN_PASSWORD_LENGTH, evaluatePassword, passwordRejectionMessage
});
