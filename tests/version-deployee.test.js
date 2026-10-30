import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serve = fs.readFileSync(new URL('../scripts/serve.js', import.meta.url), 'utf8');

/*
 * SAVOIR QUELLE VERSION TOURNE VRAIMENT.
 *
 * Un correctif qui ne touche QUE du code serveur — une règle de permission, par exemple —
 * ne change aucun fichier servi au navigateur. Comparer les octets des fichiers statiques
 * ne dit alors RIEN : on vérifie des fichiers que le correctif n'a jamais touchés, et on
 * conclut « déployé » sans la moindre preuve.
 *
 * C'est exactement ce qui s'est produit : le correctif de permission sur `settings` a été
 * annoncé déployé alors que la console Railway montrait le déploiement précédent encore
 * actif, un incident Google Cloud ayant mis la file d'attente à l'arrêt. Il a fallu une
 * capture d'écran pour s'en apercevoir.
 *
 * `/api/health` annonce donc désormais le commit servi et l'heure de démarrage.
 */

test('la santé annonce le commit servi et l’heure de démarrage', () => {
  assert.match(serve, /const VERSION_DEPLOYEE = Object\.freeze\(\{/);
  assert.match(serve, /commit: String\(process\.env\.RAILWAY_GIT_COMMIT_SHA/);
  assert.match(serve, /demarreLe: new Date\(\)\.toISOString\(\)/);
});

test('la version est annoncée sur LES TROIS réponses de santé', () => {
  // Y compris la réponse 503 : un serveur dégradé est justement le moment où l'on a le plus
  // besoin de savoir quelle version tourne. L'annoncer seulement en cas de succès laisserait
  // aveugle exactement quand ça compte.
  const bloc = serve.slice(serve.indexOf("url.pathname === '/api/health'"),
    serve.indexOf("url.pathname === '/api/health'") + 700);
  const occurrences = (bloc.match(/\.\.\.VERSION_DEPLOYEE/g) || []).length;
  assert.equal(occurrences, 3,
    `la version n’est annoncée que sur ${occurrences} réponse(s) de santé sur 3`);
  assert.match(bloc, /local-only[^}]*\.\.\.VERSION_DEPLOYEE/, 'absente de la réponse hors base');
  assert.match(bloc, /ok: false[^}]*\.\.\.VERSION_DEPLOYEE/, 'absente de la réponse 503');
});

test('le commit est tronqué, et une absence se dit', () => {
  // Douze caractères : un numéro de version, pas une clé. Et quand la variable manque —
  // en local, hors Railway — la réponse doit le DIRE plutôt que rendre une chaîne vide
  // qu'on lirait comme « pas encore déployé ».
  assert.match(serve, /\.slice\(0, 12\) \|\| 'inconnu'/);
});

test('la version est calculée UNE fois, au démarrage', () => {
  // `demarreLe` doit dater le démarrage du processus, pas l'instant de la requête : c'est
  // ce qui permet de voir qu'un serveur n'a pas redémarré depuis un déploiement annoncé.
  const declaration = serve.indexOf('const VERSION_DEPLOYEE');
  const premiereRoute = serve.indexOf("req.method === 'GET'");
  assert.ok(declaration > 0 && declaration < premiereRoute,
    'la version est recalculée à chaque requête : elle ne date plus le démarrage');
});

test('aucun secret ne transite par la santé', () => {
  // `/api/health` n'est pas authentifiée. Elle ne doit porter qu'un numéro de version.
  const bloc = serve.slice(serve.indexOf('const VERSION_DEPLOYEE'),
    serve.indexOf('const VERSION_DEPLOYEE') + 900);
  for (const interdit of ['DATABASE_URL', 'PASSWORD', 'SECRET', 'TOKEN', 'API_KEY', 'CLOUDINARY']) {
    assert.doesNotMatch(bloc, new RegExp(interdit),
      `« ${interdit} » apparaît dans la version publiée`);
  }
});
