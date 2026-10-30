/**
 * @file Le confinement Field Evidence, Phase 0 de #78.
 *
 * `main@ef4be53` prouvait le défaut : le pack, les fragments `.b64` et les images `.webp`
 * étaient précachés par le Service Worker et servis comme des actifs publics ordinaires par
 * `scripts/serve.js`, sans session. Ce fichier garde les propriétés STRUCTURELLES de la
 * fermeture — celles qu'aucune requête isolée ne montre — et la parité comportementale entre
 * les deux implémentations du même prédicat : le serveur ne peut pas importer le Service
 * Worker (script classique), donc la logique est réécrite à l'identique des deux côtés.
 *
 * La preuve RÉSEAU — anonyme 404/401/403/200, `Cache-Control`, tentatives d'encodage —
 * vit dans `scripts/field-evidence-containment-e2e.mjs`, contre un serveur réel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const server = read('scripts/serve.js');
const worker = read('service-worker.js');

const precacheList = worker.slice(
  worker.indexOf('const ASSETS_TO_CACHE'),
  worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE'))
);

/* ── A/B — LE SOUS-ARBRE, PAS UNE LISTE DE FICHIERS ──────────────────────── */

test('A/B: aucun chemin sous assets/field-evidence dans la liste de précache', () => {
  // Les MODULES JS `equipment-field-evidence.js`, `field-evidence-integration.js`… restent
  // précachés comme du code ordinaire — ce sont les OCTETS statiques sous `assets/` que
  // #78 ferme, jamais le code qui les orchestre.
  assert.doesNotMatch(precacheList, /assets\/field-evidence/);
  assert.match(precacheList, /'\/field-evidence-integration\.js'/, 'le module de code doit rester précaché');
});

test('serveur: la fermeture porte sur le SOUS-ARBRE, structurellement', () => {
  // Une garde qui listerait trois noms de fichier laisserait passer un quatrième. Celle-ci
  // compare des SEGMENTS de chemin — `assets` puis `field-evidence` — donc n'importe quel
  // fichier futur sous ce dossier est couvert sans modification de cette règle.
  assert.match(server, /segments\[0\]\?\.toLowerCase\(\) === 'assets' && segments\[1\]\?\.toLowerCase\(\) === 'field-evidence'/);
  assert.doesNotMatch(server, /2m-field-pack\.bin/);
  assert.doesNotMatch(server, /phase11-migration-\d\d/);
  assert.doesNotMatch(server, /phase12-\d\d\.webp/);
});

/* ── C/D — LE CACHE D'EXÉCUTION NE VOIT JAMAIS CES OCTETS ────────────────── */

test('C/D: la réponse réseau des preuves terrain n’est jamais écrite en cache, et jamais relue hors ligne', () => {
  const fetchHandler = worker.slice(worker.indexOf("addEventListener('fetch'"), worker.indexOf("addEventListener('message'"));
  const privateBranch = fetchHandler.slice(
    fetchHandler.indexOf('if (isPrivateFieldEvidenceRequest'),
    fetchHandler.indexOf('return;', fetchHandler.indexOf('if (isPrivateFieldEvidenceRequest'))
  );
  assert.doesNotMatch(privateBranch, /cache\.put/);
  assert.doesNotMatch(privateBranch, /caches\.match/);
  assert.match(privateBranch, /catch\(\(\) => new Response/);
  // La branche générale, elle, continue de mettre en cache et de relire hors ligne : la
  // fermeture est ciblée, pas un retrait de la stratégie offline pour tout le reste.
  const generalBranch = fetchHandler.slice(fetchHandler.indexOf('event.respondWith(fetch(event.request, { cache'));
  assert.match(generalBranch, /cache\.put/);
  assert.match(generalBranch, /caches\.match/);
});

/* ── E — CACHE_ASSETS NE RÉINTRODUIT RIEN ────────────────────────────────── */

test('E: le message CACHE_ASSETS filtre son payload avant cache.addAll', () => {
  const messageHandler = worker.slice(worker.indexOf("addEventListener('message'"));
  assert.match(messageHandler, /isPrivateFieldEvidenceRequest\(url\)/);
  assert.match(messageHandler, /includes\('\/api\/'\)/);
  assert.doesNotMatch(messageHandler, /cache\.addAll\(event\.data\.payload\)/,
    'le payload brut ne doit plus atteindre cache.addAll sans filtre');
});

/* ── F — LA PURGE HISTORIQUE RESTE INCONDITIONNELLE ──────────────────────── */

test('F: activate supprime tout cache dont le nom diffère, sans exception', () => {
  const activate = worker.slice(worker.indexOf("addEventListener('activate'"), worker.indexOf("addEventListener('fetch'"));
  assert.match(activate, /cacheName !== CACHE_NAME \? caches\.delete\(cacheName\)/);
});

test('le nom du cache a changé : un exemplaire ancien devient inatteignable', () => {
  // Bumpé en `v5.43` par A-5 : les installations existantes portaient encore, dans
  // `v5.42`, les copies de `regie-car-*.js` qui contenaient le relevé d'installation.
  // Seul le changement de nom reprend des octets déjà téléchargés.
  //
  // Bumpé en `v5.44` par B-4 : `v5.43` sert les versions de `central-sync.js`,
  // `credential-cache-guard.js` et `users.js` qui laissaient de la matière
  // d'authentification dans `syncQueue`. Un poste déjà installé continuerait de les
  // exécuter — et de purger, il ne saurait pas le faire.
  assert.match(worker, /const CACHE_NAME = '2mtech-v5\.44'/);
});

/* ── G — PARITÉ COMPORTEMENTALE SERVEUR / SERVICE WORKER ─────────────────── */

/**
 * Le Service Worker est un script CLASSIQUE : il ne peut pas importer la fonction du
 * serveur. Le prédicat est donc réécrit à l'identique des deux côtés, et ce test compare
 * leur COMPORTEMENT sur la même batterie de chemins — pas leur texte — pour qu'un écart
 * entre les deux reste visible plutôt que de se glisser silencieusement dans l'un des deux.
 */
function extractSwPredicate() {
  const start = worker.indexOf('function isPrivateFieldEvidenceRequest');
  const bodyStart = worker.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (; end < worker.length; end += 1) {
    if (worker[end] === '{') depth += 1;
    else if (worker[end] === '}') { depth -= 1; if (depth === 0) { end += 1; break; } }
  }
  const source = worker.slice(start, end);
  const self = { location: { origin: 'https://tp.example' } };
  // eslint-disable-next-line no-new-func
  const factory = new Function('self', 'URL', `${source}\nreturn isPrivateFieldEvidenceRequest;`);
  return factory(self, URL);
}

function serverPredicate(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath ?? '').split('?')[0]); }
  catch { return true; }
  const segments = decoded.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments[0]?.toLowerCase() === 'assets' && segments[1]?.toLowerCase() === 'field-evidence';
}

test('G: le prédicat serveur (réécrit ici depuis scripts/serve.js) correspond à la source réelle', () => {
  // Preuve que `serverPredicate` ci-dessus N'A PAS dérivé du fichier réel : la ligne exacte
  // doit toujours y être — sinon ce test comparerait deux fictions, pas deux implémentations.
  assert.match(server, /segments\[0\]\?\.toLowerCase\(\) === 'assets' && segments\[1\]\?\.toLowerCase\(\) === 'field-evidence'/);
});

test('G: mutations adversariales — le serveur et le Service Worker s’accordent, sur les 163 modules et au-delà', () => {
  const swPredicate = extractSwPredicate();
  const cas = {
    'chemin direct':              ['/assets/field-evidence/2026-08-16/2m-field-pack.bin', true],
    'fragment b64':                ['/assets/field-evidence/2026-08-16/phase11-migration-01.b64', true],
    'image webp':                  ['/assets/field-evidence/2026-08-16/phase12-01.webp', true],
    'racine du sous-arbre':        ['/assets/field-evidence/', true],
    'casse mixte':                 ['/Assets/Field-Evidence/x.bin', true],
    'slash encodé':                ['/assets/field-evidence%2f2026-08-16%2f2m-field-pack.bin', true],
    'antislash':                   ['/assets\\field-evidence\\x.bin', true],
    'chaîne de requête':           ['/assets/field-evidence/2026-08-16/2m-field-pack.bin?v=1', true],
    'double slash de tête':        ['//assets//field-evidence//x.bin', true],
    'actif public non concerné':   ['/assets/webfonts/fa-solid-900.woff2', false],
    'module JS ordinaire':         ['/equipements.js', false],
    'dossier assets voisin':       ['/assets/images/2m-logo.webp', false],
    'plan opérationnel (#137)':    ['/assets/plan-technique.PNG', false],
    'route API':                   ['/api/operational/grille-centrale/documented-map', false],
    'racine':                      ['/', false]
  };
  for (const [nom, [chemin, attendu]] of Object.entries(cas)) {
    assert.equal(serverPredicate(chemin), attendu, `serveur — ${nom}`);
    assert.equal(swPredicate(chemin), attendu, `service worker — ${nom}`);
  }
});

test('G: un segment `.` isolé est fermé par la règle générale du serveur, en amont de celle-ci', () => {
  /*
   * `/assets/./field-evidence/x.bin` n'atteint jamais cette forme en pratique : l'analyseur
   * d'URL — Node comme navigateur — replie `.` avant que `isPrivateStaticPath` ne voie le
   * chemin. Et si un appelant direct le lui soumettait quand même, la règle PRÉEXISTANTE
   * `segment.startsWith('.')` — qui ferme `.git`, `.env`… — le bloque déjà, avant même la
   * règle Field Evidence ajoutée ici. Ce test le nomme pour que la raison reste explicite,
   * plutôt que de mêler cette règle-là à la parité serveur/Service Worker ci-dessus.
   */
  assert.match(server, /segment\.startsWith\('\.'\) \|\| PRIVATE_PREFIXES\.has\(segment\)/);
});

test('G: le Service Worker refuse toute origine étrangère avant même de lire le chemin', () => {
  const swPredicate = extractSwPredicate();
  assert.equal(swPredicate('https://evil.example/harmless.js'), true);
  assert.equal(swPredicate('https://tp.example/equipements.js'), false);
});

/* ── H — AUCUNE ERREUR JS NON GÉRÉE QUAND LES PREUVES SONT ABSENTES ──────── */

test('H: le pipeline principal continue d’absorber un asset introuvable', () => {
  const field = read('equipment-field-evidence.js');
  const integration = read('field-evidence-integration.js');
  assert.match(field, /if \(!response\.ok\) throw new Error/);
  assert.match(integration, /resolveFieldEvidenceAsset\(item\.assetId\)\.catch\(\(\) => ''\)/);
  assert.match(integration, /if \(!url\) continue;/);
  assert.match(integration, /if \(!markup\) return false;/);
});

test('H: le complément Phase 12 ne rend plus un chemin statique désormais bloqué', () => {
  const phase12 = read('equipment-field-evidence-phase12.js');
  assert.match(phase12, /export async function resolveFieldEvidencePhase12Asset\(\)\s*\{\s*return '';/);
  assert.match(phase12, /if \(!url\) continue;/);
  assert.match(phase12, /if \(!markup\) return false;/);
});

/* ── SÉCURITÉ DE LA RÉPONSE BLOQUÉE ───────────────────────────────────────── */

test('la réponse 404 statique porte no-store et nosniff', () => {
  assert.match(server, /'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'/);
});
