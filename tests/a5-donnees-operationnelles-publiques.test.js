import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/*
 * A-5 — LES DONNÉES D'INSTALLATION NE SONT PAS DES OCTETS PUBLICS.
 *
 * MESURÉ sur `096cb47`, serveur local, AUCUN cookie, AUCUN en-tête d'autorisation :
 *
 *     GET /regie-car-inventory-phase16.js     200   38 361 octets
 *     GET /regie-car-prephoto-readiness.js    200   25 732 octets
 *     GET /grille-centrale-field-verification.js  200  26 342 octets
 *
 * Ce que ces octets disaient : quelles baies existent — donc aussi lesquelles n'existent
 * pas —, quel matériel est monté dans chacune, les repères d'exploitation réels (`CAM 1`,
 * `GR SEC 1`, `TG 1`, `REMOTE LSM 2`), un numéro d'inventaire interne (`2M 003067`), un
 * repère de commutateur (`SW3.R100`) et dix-huit résumés de photos de terrain.
 *
 * Ces épreuves tiennent la frontière SANS serveur : elles lisent la source, le prédicat de
 * service statique et le Service Worker. Les preuves HTTP vivantes — 401 sans session,
 * 403 pour un visiteur hors périmètre, 200 pour un rôle autorisé — sont conduites contre un
 * vrai serveur et un vrai PostgreSQL ; elles sont rejouables et consignées dans le rapport
 * du lot.
 */

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const REPERTOIRE_PRIVE = 'scripts/private-operational-data';

const jeuxPrives = readdirSync(new URL(`../${REPERTOIRE_PRIVE}`, import.meta.url))
  .filter(nom => nom.endsWith('.js'));

/* ══════════════════════ A · le relevé a quitté le bundle ══════════════════════ */

test('A-5 · le relevé Régie Car vit dans le dossier privé, et lui seul', () => {
  assert.ok(jeuxPrives.includes('regie-car.js'), 'le jeu de données privé doit exister');
  const prive = lire(`${REPERTOIRE_PRIVE}/regie-car.js`);
  // Les valeurs les plus identifiantes : elles sont là, et nulle part ailleurs.
  for (const valeur of ['2M 003067', 'SW3.R100', 'GR SEC 1', 'HSCU-300']) {
    assert.ok(prive.includes(valeur), `${valeur} doit vivre dans le jeu privé`);
  }
});

test('A-5 · les modules PUBLICS ne portent plus aucune valeur d’installation', () => {
  /*
   * On vérifie les valeurs, pas le nombre d'octets : un module peut légitimement grossir.
   * Ce qui ne doit plus s'y trouver, c'est ce qui décrit CETTE installation.
   */
  const interdits = ['2M 003067', 'SW3.R100', 'GR SEC 1', 'REMOTE LSM 2', 'HSCU-300',
                     'RCP-1500', 'TG8000', 'regie-car-baie-1', 'regiecar-2026-08-16:'];
  for (const module of ['regie-car-inventory-phase16.js', 'regie-car-prephoto-readiness.js',
                        'grille-centrale-field-verification.js']) {
    const source = lire(module);
    for (const valeur of interdits) {
      assert.ok(!source.includes(valeur),
        `${module} porte encore « ${valeur} » : le relevé n’a pas quitté le bundle`);
    }
  }
});

test('A-5 · aucun module public n’importe statiquement un jeu de données privé', () => {
  /*
   * Un import statique remettrait le relevé dans le graphe servi : le serveur refuserait le
   * fichier, et le module casserait au chargement. La seule porte est la route autorisée.
   */
  const racine = new URL('../', import.meta.url);
  const publics = readdirSync(racine).filter(nom => nom.endsWith('.js'));
  for (const module of publics) {
    const source = lire(module);
    assert.ok(!/from\s+['"]\.\/scripts\/private-operational-data\//.test(source),
      `${module} importe un jeu de données privé`);
    assert.ok(!/import\s*\(\s*['"][^'"]*private-operational-data\//.test(source),
      `${module} importe dynamiquement un jeu de données privé`);
  }
});

/* ══════════════════════ B · le serveur refuse le dossier ══════════════════════ */

test('A-5 · le prédicat statique refuse le RÉPERTOIRE, pas un nom de fichier', () => {
  const serve = lire('scripts/serve.js');
  assert.match(serve, /const PRIVATE_OPERATIONAL_DIR = 'private-operational-data';/,
    'le nom du dossier protégé doit être déclaré');
  assert.match(serve, /segments\.includes\(PRIVATE_OPERATIONAL_DIR\)/,
    'la garde doit suivre le dossier à n’importe quelle profondeur');
});

test('A-5 · la route protégée décide par le moteur d’accès, pas par « authentifié »', () => {
  const serve = lire('scripts/serve.js');
  const route = serve.slice(serve.indexOf("'/api/operational/regie-car/inventory'"));
  assert.match(route.slice(0, 900), /canReadRegieCarDataset\(user\)/,
    'la route doit demander au moteur d’accès');
  assert.match(route.slice(0, 900), /REGIE_CAR_SCOPE_FORBIDDEN/,
    'un refus doit être explicite et unique');
  const acces = lire('scripts/access-control.js');
  const decision = acces.slice(acces.indexOf('async function canReadRegieCarDataset'));
  assert.match(decision.slice(0, 1400), /canAccessRecord\(user, 'rooms', salle, 'read', client\)/,
    'la décision doit suivre la salle, par le contrôle d’accès ordinaire');
});

/* ══════════════════════ C · le transport ne retombe sur rien ══════════════════════ */

test('A-5 · le transport n’a aucun repli local', () => {
  const transport = lire('regie-car-dataset.js');
  assert.match(transport, /REGIE_CAR_DATASET_ENDPOINT = '\/api\/operational\/regie-car\/inventory'/);
  // Un refus rend `null` et JETTE la mémoire : c'est le cas « révoqué pendant la session ».
  const bloc = transport.slice(transport.indexOf('response.status === 401'));
  assert.match(bloc.slice(0, 260), /cache = null;/,
    'un refus doit jeter ce qui était en mémoire');
  assert.ok(!/localStorage\.setItem/.test(transport) && !/db\.save/.test(transport),
    'le relevé ne doit jamais être persisté sur le poste');
});

test('A-5 · sans relevé, l’amorçage n’écrit rien du tout', () => {
  for (const [module, marqueur] of [
    ['regie-car-inventory-phase16.js', 'dataset-unavailable'],
    ['regie-car-prephoto-readiness.js', 'dataset-unavailable']
  ]) {
    const source = lire(module);
    assert.ok(source.includes(marqueur),
      `${module} doit se taire quand le relevé est refusé`);
  }
});

/* ══════════════════════ D · le Service Worker ══════════════════════ */

test('A-5 · le cache est bumpé pour évincer les copies déjà téléchargées', () => {
  const worker = lire('service-worker.js');
  const nom = worker.match(/const CACHE_NAME = '([^']+)'/)?.[1];
  assert.ok(nom && nom !== '2mtech-v5.42',
    'le cache doit changer de nom : les installations existantes portent les anciens octets');
  const activate = worker.slice(worker.indexOf("addEventListener('activate'"));
  assert.match(activate.slice(0, 700), /cacheName !== CACHE_NAME \? caches\.delete\(cacheName\)/,
    'et `activate` doit supprimer le cache précédent');
});

test('A-5 · aucun chemin précaché ne porte de valeur d’installation', () => {
  /*
   * Ce que le précache télécharge AVANT toute connexion ne doit rien contenir du relevé.
   * On le vérifie sur les octets réels de chaque fichier listé, pas sur son nom.
   */
  const worker = lire('service-worker.js');
  const liste = worker.slice(worker.indexOf('ASSETS_TO_CACHE'), worker.indexOf("addEventListener('install'"));
  const chemins = [...liste.matchAll(/'\/([^']+\.js)'/g)].map(m => m[1]);
  assert.ok(chemins.length > 20, 'la liste de précache doit être lue');
  const interdits = ['2M 003067', 'SW3.R100', 'GR SEC 1', 'regiecar-2026-08-16:'];
  for (const chemin of chemins) {
    let source = '';
    try { source = lire(chemin); } catch { continue; }
    for (const valeur of interdits) {
      assert.ok(!source.includes(valeur),
        `le précache télécharge ${chemin}, qui porte « ${valeur} » avant toute connexion`);
    }
  }
});

test('A-5 · le dossier privé n’est jamais précaché', () => {
  const worker = lire('service-worker.js');
  const liste = worker.slice(worker.indexOf('ASSETS_TO_CACHE'), worker.indexOf("addEventListener('install'"));
  assert.ok(!liste.includes('private-operational-data'),
    'aucun chemin du dossier privé ne doit figurer au précache');
});

/* ══════════════════════ E · la garde de résidus suit le dossier ══════════════════════ */

test('A-5 · la garde de résidus couvre TOUS les jeux de données protégés', async () => {
  const { listPrivateDatasets } = await import('../scripts/public-bundle-residue-guard.mjs');
  const trouves = listPrivateDatasets(new URL('../', import.meta.url).pathname);
  assert.equal(trouves.length, jeuxPrives.length,
    'la garde doit voir autant de jeux que le dossier en contient');
  assert.ok(trouves.some(chemin => chemin.endsWith('regie-car.js')),
    'le relevé Régie Car doit contribuer ses empreintes');
});

test('A-5 · un identifiant d’installation recopié en public fait sonner la garde', async () => {
  const { buildProtectedFingerprints } = await import('../scripts/public-bundle-residue-guard.mjs');
  const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
  const { collectStringValues } = await import('../scripts/public-bundle-residue-guard.mjs');
  const empreintes = buildProtectedFingerprints('', collectStringValues(buildRegieCarDataset()));
  /*
   * Les valeurs CALCULÉES doivent compter : les baies de la Régie Car sont nommées par un
   * gabarit (`` `BAIE ${number}` ``), et une garde qui ne lirait que le texte du source ne
   * les verrait jamais.
   */
  assert.ok(empreintes.identifiers.has('2M 003067'), 'le numéro d’inventaire est une empreinte');
  assert.ok(empreintes.identifiers.has('regie-car-baie-1'), 'un identifiant de fiche est une empreinte');
  // Et ce qui est du savoir public ne l'est pas.
  assert.ok(!empreintes.identifiers.has('Sony'), 'un fabricant n’est pas une empreinte');
  assert.ok(!empreintes.identifiers.has('regie-car-phase16'), 'un marqueur de provenance non plus');
});

/* ══════════════ F · l'état de documentation est privé lui aussi ══════════════ */

/**
 * Les phrases qui décrivent ce qui MANQUE à cette installation. Elles ne sont ni un
 * identifiant, ni une implantation, ni une capacité : aucune des empreintes d'origine ne les
 * classait, et elles sont restées publiques ET précachées après la première passe du lot.
 */
const LACUNES_PRIVEES = Object.freeze([
  'Modèles exacts encore inconnus',
  'Positions physiques incomplètes',
  'Ports arrière non relevés',
  'Câbles non tracés de bout en bout',
  'Patchfield non documenté',
  'Crosspoints/flux live inconnus',
  'Fichiers image Régie Car à intégrer',
  'références 01–18'
]);

test('A-5 · l’état de documentation vit dans le jeu protégé', async () => {
  const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
  const lacunes = buildRegieCarDataset().prephotoGaps;
  assert.ok(Array.isArray(lacunes) && lacunes.length >= 7,
    'les lacunes doivent arriver par le jeu de données autorisé');
  const texte = JSON.stringify(lacunes);
  for (const phrase of LACUNES_PRIVEES) {
    assert.ok(texte.includes(phrase), `« ${phrase} » doit vivre dans le jeu protégé`);
  }
});

test('A-5 · aucune lacune d’installation dans les octets du module public', () => {
  /*
   * ON LIT LES OCTETS BRUTS, COMMENTAIRES COMPRIS.
   *
   * Un commentaire est servi exactement comme du code : il voyage dans la même réponse, et
   * le précache le télécharge avec le reste. Une première version de cette épreuve les
   * retirait avant de comparer — elle passait au vert pendant que la note d'architecture
   * citait encore une des sept phrases, mesurée dans la réponse HTTP. La règle du dépôt est
   * déjà celle-ci pour la garde de résidus ; elle vaut ici aussi.
   */
  const source = lire('regie-car-prephoto-readiness.js');
  for (const phrase of LACUNES_PRIVEES) {
    assert.ok(!source.includes(phrase),
      `le module public porte encore « ${phrase} » : l’état d’installation n’a pas quitté le bundle`);
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/REGIE_CAR_PREPHOTO_GAPS/.test(code),
    'la constante de lacunes ne doit plus exister dans le module public');
});

test('A-5 · aucune lacune d’installation dans le précache, avant toute connexion', () => {
  const worker = lire('service-worker.js');
  const liste = worker.slice(worker.indexOf('ASSETS_TO_CACHE'), worker.indexOf("addEventListener('install'"));
  const chemins = [...liste.matchAll(/'\/([^']+\.js)'/g)].map(m => m[1]);
  assert.ok(chemins.includes('regie-car-prephoto-readiness.js'),
    'le module reste précaché : c’est bien son contenu qui doit être propre');
  for (const chemin of chemins) {
    let source = '';
    try { source = lire(chemin); } catch { continue; }
    // Octets bruts : le précache télécharge le fichier entier, commentaires compris.
    for (const phrase of LACUNES_PRIVEES) {
      assert.ok(!source.includes(phrase),
        `le précache télécharge ${chemin}, qui porte « ${phrase} » avant toute connexion`);
    }
  }
});

test('A-5 · les lacunes ne sont pas republiées sur `window`', () => {
  const code = lire('regie-car-prephoto-readiness.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bloc = code.slice(code.indexOf('window.RegieCarPrephotoReadiness'));
  assert.ok(!/\bgaps\s*:/.test(bloc),
    'l’API `window` ne doit exposer aucune lacune avant autorisation');
});

test('A-5 · la garde classe les RÉCITS protégés, pas seulement les identifiants', async () => {
  const { buildProtectedFingerprints, collectProtectedNarratives } =
    await import('../scripts/public-bundle-residue-guard.mjs');
  const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
  const jeu = buildRegieCarDataset();
  const empreintes = buildProtectedFingerprints('', [], collectProtectedNarratives(jeu));
  assert.ok(empreintes.narratives.size > 0, 'le jeu protégé doit fournir des récits');
  // La règle d'une lacune EST un fait d'installation.
  const regles = jeu.prephotoGaps.map(item => item.rule);
  assert.ok(regles.some(regle => empreintes.narratives.has(regle)),
    'les règles de lacune doivent être des empreintes');
  // Et un libellé d'affichage n'en est pas un : `label` est volontairement hors catégorie.
  assert.ok(!empreintes.narratives.has('Interfaces documentées'),
    'un libellé d’affichage ne doit pas devenir une empreinte');
});

/* ══════════════ G · l'autorité se redemande à chaque ouverture ══════════════ */

test('A-5 · la Fiche 360 Régie Car revalide au lieu de lire la mémoire', () => {
  const code = lire('regie-car-prephoto-readiness.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const surface = code.slice(code.indexOf('export async function enhanceRegieCarPrephoto360'));
  assert.match(surface, /loadRegieCarDataset\(\s*\{\s*revalidate\s*:\s*true/,
    'chaque ouverture doit reconsulter la route protégée');
  assert.match(surface, /ouverture\s*:\s*jetonDOuverture\(modal\)/,
    'le regroupement doit se faire par identité d’ouverture');
  assert.ok(!/peekRegieCarDataset\(/.test(surface),
    'la surface 360 ne doit plus se contenter de la mémoire');
});

test('A-5 · le regroupement se fait par ouverture, jamais par horloge', () => {
  const transport = lire('regie-car-dataset.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(transport, /const jetons = new WeakMap\(\)/,
    'le jeton doit vivre et mourir avec l’élément de la surface');
  assert.match(transport, /ouverture === ouvertureValidee/,
    'une revalidation vaut pour la même ouverture, et pour elle seule');
  assert.ok(!/Date\.now\(\)\s*-\s*\w+\s*<\s*\w*(?:RAFALE|FENETRE|WINDOW|DEBOUNCE)\w*/i.test(transport),
    'aucune fenêtre de temps ne doit servir d’autorité');
});

/* ══════════════ H · l'état d'avancement ne se lit pas sans habilitation ══════════════ */

/** Les constantes qui affirment l'état COURANT de l'unité inventoriée. */
const ETAT_COURANT = Object.freeze([
  'ready-awaiting-photos', 'awaiting-source-files'
]);

test('A-5 · `summarize()` sans jeu protégé ne répond aucun état', async () => {
  /*
   * MESURÉ sur `e2c1a7d` : appelée sans argument — ce que `window.…summarize` permettait à
   * n'importe quel poste — elle rendait encore `readyForNextPhotoBatch: true`,
   * `safeToReceiveNewEvidence: true` et `binaryMediaStillRequired: true`. La liste des
   * lacunes était partie, l'ORACLE restait.
   */
  const { summarizeRegieCarPrephotoReadiness } = await import('../regie-car-prephoto-readiness.js');
  const refus = summarizeRegieCarPrephotoReadiness();
  assert.equal(refus.available, false, 'sans jeu autorisé, la réponse est un refus explicite');
  for (const champ of ['readyForNextPhotoBatch', 'safeToReceiveNewEvidence', 'binaryMediaStillRequired']) {
    assert.equal(refus[champ], undefined, `${champ} ne doit pas être rendu sans habilitation`);
  }
});

test('A-5 · l’état d’avancement vit dans le jeu protégé', async () => {
  const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
  const etat = buildRegieCarDataset().prephotoReadiness;
  assert.equal(etat.planStatus, 'ready-awaiting-photos');
  assert.equal(etat.binaryMediaStatus, 'awaiting-source-files');
  assert.equal(etat.readyForNextPhotoBatch, true);
  assert.equal(etat.safeToReceiveNewEvidence, true);
  assert.equal(etat.binaryMediaStillRequired, true);
});

test('A-5 · les octets publics BRUTS ne portent aucun état courant', () => {
  const source = lire('regie-car-prephoto-readiness.js');
  for (const valeur of ETAT_COURANT) {
    assert.ok(!source.includes(valeur),
      `le module public affirme encore « ${valeur} » — état d’installation servi sans session`);
  }
});

test('A-5 · le commentaire servi n’énumère plus les catégories de lacunes', () => {
  /*
   * Un commentaire est servi exactement comme du code. Deux passes de ce lot l'ont vérifié à
   * leurs dépens : d'abord une phrase recopiée mot pour mot, puis l'énumération des
   * catégories qui la remplaçait.
   */
  const source = lire('regie-car-prephoto-readiness.js');
  for (const categorie of ['positions physiques', 'ports arrière', 'patchfield', 'routage live', 'médias binaires']) {
    assert.ok(!source.includes(categorie),
      `le commentaire servi énumère encore « ${categorie} »`);
  }
});

test('A-5 · avec habilitation, l’état rendu est EXACTEMENT celui d’avant', async () => {
  // Le lot ferme une fuite ; il ne change pas ce qu'un utilisateur légitime obtient.
  const { summarizeRegieCarPrephotoReadiness } = await import('../regie-car-prephoto-readiness.js');
  const { buildRegieCarDataset } = await import('../scripts/private-operational-data/regie-car.js');
  const jeu = buildRegieCarDataset();
  const resume = summarizeRegieCarPrephotoReadiness(jeu);
  assert.equal(resume.available, true);
  assert.equal(resume.readyForNextPhotoBatch, true);
  assert.equal(resume.safeToReceiveNewEvidence, true);
  assert.equal(resume.binaryMediaStillRequired, true);
  assert.equal(resume.knownBaies, 6);
  assert.equal(resume.phase16Equipments, 49);
  assert.equal(resume.remainingGapIds.length, 7);
});

test('A-5 · `room-regie-car` est documenté comme compatibilité, pas comme modèle', () => {
  /*
   * Une Régie Car est une unité MOBILE : plusieurs peuvent coexister, et une même unité se
   * déplace sans que son identité ni celle de ses baies change. Ce lot ne redessine pas le
   * domaine — il s'interdit seulement de figer l'hypothèse « Régie Car == salle », et dit où
   * l'unité mobile viendra la remplacer.
   */
  const acces = lire('scripts/access-control.js');
  // La note vit dans le bloc de documentation qui PRÉCÈDE la fonction : on prend la fenêtre
  // autour du point de déclaration, pas seulement ce qui le suit.
  const point = acces.indexOf('async function canReadRegieCarDataset');
  const decision = acces.slice(Math.max(0, point - 2500), point + 1600);
  assert.match(decision, /UNITÉ TECHNIQUE MOBILE/,
    'la décision d’autorisation doit dire que la recherche par salle est une compatibilité');
  const module = lire('regie-car-prephoto-readiness.js');
  assert.match(module, /COMPATIBILITÉ, PAS LE MODÈLE MÉTIER/,
    'le module doit documenter la même réserve');
});
