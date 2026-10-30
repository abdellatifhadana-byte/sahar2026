import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// Les commentaires expliquent ce qui a été remplacé et citent donc les anciennes formes.
// Les interdits portent sur les RÈGLES, pas sur la mémoire de ce qu'elles corrigent.
const rulesOnly = source => source.replace(/\/\*[\s\S]*?\*\//g, '');
const auth = read('auth.js');
const authCode = rulesOnly(auth);
const compat = read('compat-integrations.js');
const loginCss = read('login.css');
const loginRules = rulesOnly(loginCss);
const index = read('index.html');

// La connexion était éclatée sur CINQ fichiers : deux implémentations concurrentes
// (`auth.js` écrasée par `compat-integrations.js`) et trois couches de style empilées
// (`ui-refresh.css`, `ui-final.css`, `ui-tune.css`) totalisant plus de quarante `!important`.
// Corriger « la page de connexion » revenait à deviner laquelle gagnait au chargement.

test('une seule implémentation, dans auth.js', () => {
  assert.match(auth, /showLogin\(\) \{/);
  assert.match(auth, /id="login-box" class="login-screen"/);
  assert.doesNotMatch(compat, /Auth\.prototype\.showLogin/,
    'une seconde implémentation écrasait la première au chargement');
  // Le commentaire qui explique pourquoi doit rester : sans lui, la redéfinition revient.
  assert.match(compat, /n'est volontairement plus redéfinie ici/);
});

test('une seule feuille de style, sans guerre de spécificité', () => {
  assert.doesNotMatch(loginRules, /!important/,
    'aucune surcharge nécessaire quand il n’y a plus qu’un seul auteur');
  for (const stylesheet of ['ui-final.css', 'ui-refresh.css', 'ui-tune.css']) {
    assert.doesNotMatch(rulesOnly(read(stylesheet)), /#login-box/, `${stylesheet} restyle encore la connexion`);
  }
  assert.match(index, /<link rel="stylesheet" href="login\.css">/);
  assert.match(read('service-worker.js'), /'\/login\.css'/, 'la page doit rester disponible hors ligne');
});

test('le sous-titre est un texte réel, pas le contenu d’un pseudo-élément', () => {
  // En `content:` d'un `::after`, il n'était ni sélectionnable, ni traduisible, et
  // restait absent du DOM — donc des outils d'accessibilité.
  assert.match(auth, /<p class="login-subtitle">Plateforme de gestion technique et opérationnelle<\/p>/);
  assert.doesNotMatch(loginRules, /content:\s*"Plateforme/);
});

test('le symbole est celui de la plateforme, en vectoriel', () => {
  assert.match(auth, /import \{ startupLogoMarkup \} from '\.\/startup-splash\.js'/);
  assert.match(auth, /startupLogoMarkup\(\{ compact:true, revealed:true \}\)/);
  // L'image bitmap `2m-logo.webp` donnait une seconde représentation de la même marque.
  assert.doesNotMatch(authCode, /2m-logo\.webp/);
  assert.doesNotMatch(loginRules, /2m-logo\.webp/);
});

test('les icônes des champs suivent leur rôle, pas leur position', () => {
  // Liées à `:nth-of-type(1)` et `(2)`, elles se déplaçaient en silence sur le mauvais
  // champ dès qu'on en ajoutait ou réordonnait un.
  assert.match(loginRules, /\.login-field\[data-field="username"\] input/);
  assert.match(loginRules, /\.login-field\[data-field="password"\] input/);
  assert.doesNotMatch(loginRules, /nth-of-type/);
  assert.match(auth, /data-field="username"/);
  assert.match(auth, /data-field="password"/);
});

test('le fond de page appartient à l’écran, pas à une condition sur le document', () => {
  // `body:has(#login-box)` faisait dépendre le style du body de la présence d'un
  // identifiant ailleurs dans l'arbre.
  assert.doesNotMatch(loginRules, /body:has/);
  assert.match(loginRules, /\.login-screen\{/);
});

test('les protections de connexion sont conservées', () => {
  assert.match(auth, /if \(inFlight\) return;/, 'un double clic lançait deux authentifications');
  assert.match(auth, /submitButton\.disabled = true;/);
  assert.match(auth, /Synchronisation de vos données…/, 'la synchronisation initiale doit rester visible');
  // Après un échec, le mot de passe ne doit pas rester en clair dans le champ.
  assert.match(auth, /this\.passwordInput\.value = '';/);
  assert.match(auth, /this\.passwordInput\.focus\(\);/);
});

test('le formulaire est accessible et relié à ses libellés', () => {
  assert.match(auth, /<label for="login-username">/);
  assert.match(auth, /<label for="login-password">/);
  assert.match(auth, /id="login-error"[^>]*role="alert"/);
  assert.match(auth, /aria-live="assertive"/);
  assert.match(auth, /id="login-progress"[^>]*aria-live="polite"/);
  assert.match(auth, /type="submit"/);
  assert.match(auth, /this\.usernameInput\.focus\(\)/, 'le premier champ doit recevoir le focus');
});
