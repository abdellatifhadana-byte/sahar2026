import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluatePassword, passwordRejectionMessage } from '../password-policy.js';

const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

/*
 * POURQUOI CE FICHIER EXISTE
 *
 * La politique de mot de passe s'applique dans `normalizeIncomingUser`, c'est-à-dire sur
 * toute écriture d'utilisateur passant par l'API. Les scénarios de bout en bout créent
 * précisément des utilisateurs par cette voie — mais ils ne tournent PAS dans `npm test` :
 * ils exigent un serveur vivant et une base PostgreSQL, et n'existent que dans les flux
 * d'intégration continue.
 *
 * Conséquence observée : le durcissement de la politique a rendu l'intégration continue
 * rouge alors que les 515 tests locaux passaient. Trois jeux d'essai employaient un mot de
 * passe que la politique refuse désormais — dont « Phase24-Responsable-2026! » pour
 * l'utilisateur « phase24-responsable », soit le nom du compte suivi de l'année.
 *
 * Ce fichier ramène ce contrôle dans `npm test` : il évalue les identifiants d'essai avec
 * la politique réelle et le contexte réel de chaque compte. Une prochaine modification de
 * la politique échouera donc ici, en local et en quelques millisecondes, au lieu d'échouer
 * en intégration continue après un démarrage de serveur et de base.
 */

// Comptes créés par l'API dans les scénarios de bout en bout, avec le contexte que le
// serveur transmet réellement à `evaluatePassword` : nom d'utilisateur et nom complet.
const COMPTES = [
  { fichier:'scripts/security-e2e.mjs', motDePasse:'Tech-STC-Verrou-2026!', username:'tech.stc' },
  { fichier:'scripts/security-e2e.mjs', motDePasse:'Resp-RF1-Verrou-2026!', username:'resp.rf1' },
  { fichier:'scripts/security-restart-e2e.mjs', motDePasse:'Resp-RF1-Verrou-2026!', username:'resp.rf1' },
  { fichier:'scripts/zone-access-e2e.mjs', motDePasse:'Zone-Verrou-Antenne-2026!',
    username:'phase24-responsable', fullName:'Responsable Phase 24' }
];

test('chaque mot de passe d’essai satisfait la politique appliquée par le serveur', () => {
  for (const compte of COMPTES) {
    const evaluation = evaluatePassword(compte.motDePasse, compte);
    assert.equal(evaluation.valide, true,
      `${compte.fichier} : « ${compte.motDePasse} » serait refusé par le serveur — ${passwordRejectionMessage(evaluation)}`);
  }
});

test('les mots de passe testés ici sont bien ceux qu’emploient les scénarios', () => {
  // Sans cela, renommer un identifiant dans un scénario laisserait ce fichier vérifier
  // une valeur qui n'existe plus : le contrôle passerait en gardant l'ancien angle mort.
  for (const compte of COMPTES) {
    assert.ok(lire(compte.fichier).includes(compte.motDePasse),
      `${compte.fichier} n'emploie plus « ${compte.motDePasse} » — mettre à jour cette liste`);
  }
});

test('aucun scénario ne réintroduit un mot de passe que la politique refuse', () => {
  // Balayage large : toute chaîne ressemblant à un mot de passe dans les scénarios est
  // évaluée. Le contexte n'est pas connu ici, donc on ne teste que les règles générales —
  // longueur, classes, répétitions, mots courants. C'est ce qui aurait attrapé
  // « Tech-STC-Password-2026! » avant qu'il ne parte en intégration continue.
  const scenarios = fs.readdirSync(new URL('../scripts/', import.meta.url))
    .filter(nom => nom.endsWith('-e2e.mjs'));
  const fautifs = [];
  for (const nom of scenarios) {
    const source = lire(`scripts/${nom}`);
    for (const trouve of source.matchAll(/'([A-Za-z0-9][A-Za-z0-9._@#!$%^&*+-]{9,})'/g)) {
      const valeur = trouve[1];
      // Un mot de passe se reconnaît à sa forme : majuscule, chiffre, séparateur.
      const ressembleAUnMotDePasse = /[A-Z]/.test(valeur) && /[0-9]/.test(valeur) && /[-_!@#$%^&*+.]/.test(valeur);
      if (!ressembleAUnMotDePasse) continue;
      // Les valeurs par défaut du compte d'amorçage ne passent pas par la politique :
      // l'administrateur initial est créé au démarrage du serveur, pas par l'API.
      if (valeur.startsWith('E2e-Admin-') || valeur.startsWith('Phase24-Admin-')) continue;
      const evaluation = evaluatePassword(valeur);
      if (!evaluation.valide) fautifs.push(`${nom} : « ${valeur} » — ${evaluation.problemes.join(' ; ')}`);
    }
  }
  assert.deepEqual(fautifs, [], `mots de passe refusés par la politique :\n  ${fautifs.join('\n  ')}`);
});

test('le message de refus reste grammatical quelle que soit l’exigence', () => {
  // Les exigences n'ont pas toutes la même forme : « au moins 10 caractères » est une
  // quantité, « aucun mot courant » une interdiction. L'ancien libellé « Il doit comporter »
  // produisait « Il doit comporter aucun mot courant », vu tel quel dans la sortie
  // d'intégration continue.
  const message = passwordRejectionMessage(evaluatePassword('admin123'));
  assert.match(message, /Exigences non satisfaites :/);
  assert.doesNotMatch(message, /comporter aucun|comporter ni|comporter ne pas/);

  // Chaque forme d'exigence doit se lire correctement après l'intitulé.
  const interdiction = passwordRejectionMessage(
    evaluatePassword('phase24-responsable-2026X!', { username:'phase24-responsable' }));
  assert.match(interdiction, /Exigences non satisfaites : .*ne pas contenir le nom d'utilisateur/);
});
