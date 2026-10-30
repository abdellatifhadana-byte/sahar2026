import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluatePassword, passwordRejectionMessage, MIN_PASSWORD_LENGTH } from '../password-policy.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// La création d'utilisateur acceptait n'importe quoi : un seul caractère suffisait.

test('les mots de passe manifestement faibles sont refusés', () => {
  for (const faible of ['a', 'abc', '123456', 'azerty', 'password', 'Ab1!', '2mtech']) {
    const evaluation = evaluatePassword(faible);
    assert.equal(evaluation.valide, false, `« ${faible} » ne doit pas être accepté`);
    assert.ok(evaluation.problemes.length > 0);
    assert.match(passwordRejectionMessage(evaluation), /Mot de passe trop faible/);
  }
});

test('un mot de passe robuste est accepté', () => {
  for (const solide of ['Kx7$mQr2Wz9', 'Régie-Final-2026!', 'tR4nsm1ss10n#Rabat']) {
    const evaluation = evaluatePassword(solide);
    assert.equal(evaluation.valide, true, `« ${solide} » doit être accepté : ${evaluation.problemes.join(', ')}`);
    assert.equal(passwordRejectionMessage(evaluation), '');
  }
});

test('répétitions et suites ordonnées sont refusées', () => {
  // « Aaaa1111!!!! » satisfait longueur et classes, mais ne vaut rien.
  assert.equal(evaluatePassword('Aaaa1111!!!!').valide, false);
  assert.equal(evaluatePassword('Abcd1234!xyz').valide, false);
});

test('le mot de passe ne peut pas reprendre l’identité de son porteur', () => {
  const evaluation = evaluatePassword('audit-admin-2026X!', { username:'audit-admin' });
  assert.equal(evaluation.valide, false);
  assert.ok(evaluation.problemes.some(probleme => /nom d'utilisateur/.test(probleme)));
  // Sous quatre caractères, la référence est trop courte pour être discriminante.
  assert.equal(evaluatePassword('Kx7$mQr2Wz9', { username:'ab' }).valide, true);
});

test('trois classes sur quatre suffisent', () => {
  // Exiger les quatre pousse aux « P@ssw0rd! », qui satisfont la règle sans rien gagner.
  const troisClasses = evaluatePassword('Marrakech2026');
  assert.equal(troisClasses.valide, true, troisClasses.problemes.join(', '));
});

test('la longueur minimale est appliquée', () => {
  assert.ok(MIN_PASSWORD_LENGTH >= 8);
  const court = 'Kx7$mQ2';
  assert.ok(court.length < MIN_PASSWORD_LENGTH);
  assert.equal(evaluatePassword(court).valide, false);
});

test('la même politique vaut pour le navigateur ET pour le serveur', () => {
  // Un contrôle qui ne vivrait que dans le formulaire serait contourné par n'importe
  // quel appel direct à l'API.
  const users = read('users.js');
  assert.match(users, /import \{ evaluatePassword, passwordRejectionMessage \} from '\.\/password-policy\.js'/);
  assert.match(users, /const evaluation = evaluatePassword\(pwdField, \{ username, fullName \}\)/);

  const server = read('scripts/serve.js');
  assert.match(server, /import \{ evaluatePassword, passwordRejectionMessage \} from '\.\.\/password-policy\.js'/);
  // Dans `normalizeIncomingUser` : le passage obligé de toute écriture d'utilisateur.
  assert.match(server, /async function normalizeIncomingUser[\s\S]{0,1600}code: 'WEAK_PASSWORD'/);
});

test('la règle se voit pendant la saisie', () => {
  // Un refus qui n'apparaît qu'à l'enregistrement fait recommencer sans expliquer.
  const users = read('users.js');
  assert.match(users, /champMotDePasse\?\.addEventListener\('input', evaluerAffichage\)/);
  assert.match(users, /indice\.dataset\.force = evaluation\.valide \? evaluation\.niveau : 'faible'/);
  assert.match(read('ui-final.css'), /#password-hint\[data-force="faible"\]/);
});

test('le générateur produit un mot de passe que la politique accepte', () => {
  // Sinon il proposerait ce que l'enregistrement refuse ensuite.
  assert.match(read('users.js'), /for \(let essai = 0; essai < \d+ && !evaluatePassword\(password\)\.valide/);
});
