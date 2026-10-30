import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 24: le garde catalogue intercepte les seeds avant tous les modules de catalogue', () => {
  const html = read('index.html');
  const central = html.indexOf('central-sync.js');
  const coherence = html.indexOf('write-coherence.js');
  const guard = html.indexOf('catalog-seed-guard.js');
  const firstSeed = html.indexOf('equipment-knowledge.js');
  assert.ok(central >= 0 && coherence > central && guard > coherence && firstSeed > guard,
    'ordre requis: central-sync → write-coherence → catalog-seed-guard → seeds');
});

test('Phase 24: responsible/technician/visitor ne poussent jamais les seeds comme CRUD utilisateur', () => {
  const guard = read('catalog-seed-guard.js');
  assert.match(guard, /db\.saveLocalOnly/);
  assert.match(guard, /roleIsGlobalAdmin/);
  assert.match(guard, /NON_ADMIN_CAPTURE_WINDOW_MS/);
  assert.match(guard, /if \(roleIsGlobalAdmin\(currentUser\(\)\?\.role\)\)[\s\S]*?else \{[\s\S]*?releaseCaptureSoon\(NON_ADMIN_CAPTURE_WINDOW_MS\)/);
  assert.match(guard, /\/api\/sync\/catalog-install/);

  /*
   * CETTE LIGNE INTERDISAIT UN TEXTE ; ELLE GARDE MAINTENANT UNE DÉCISION.
   *
   * Elle refusait toute boucle poussant des seeds par `previousSave('docs', …)` — la forme
   * du défaut historique, où chaque rôle republiait le catalogue fiche par fiche. La RÈGLE
   * est juste et n'a pas bougé : responsable, technicien et visiteur ne poussent jamais un
   * seed comme du CRUD utilisateur.
   *
   * Mais un texte interdit se contourne en renommant une variable, et il interdit aussi ce
   * qui est légitime : #98 a montré qu'un enrichissement RETENU pendant l'amorçage n'était
   * jamais livré quand la version centrale était déjà à jour, et disparaissait. Le remède
   * remet ce contenu sur la voie ordinaire — depuis `installCentralCatalogOnce`, dont la
   * PREMIÈRE ligne est le contrôle de rôle.
   *
   * On garde donc l'ordre, qui est ce qui compte : le contrôle admin précède toute
   * livraison, et la livraison ne s'écrit qu'à un seul endroit. La preuve par l'EXÉCUTION —
   * chacun des rôles à périmètre ne pousse rien — vit dans
   * `tests/catalog-buffer-delivery-98.test.js`.
   */
  const definition = guard.match(/async function livrerParLaVoieOrdinaire/g) || [];
  const appels = guard.match(/\blivrerParLaVoieOrdinaire\(/g) || [];
  if (definition.length) {
    assert.equal(definition.length, 1, 'la livraison ordinaire ne doit être écrite qu’une fois');
    // `appels` compte aussi la définition elle-même : un seul appelant en plus.
    assert.equal(appels.length - definition.length, 1, 'et n’avoir qu’UN seul appelant');
    const installation = guard.slice(guard.indexOf('async function installCentralCatalogOnce'));
    const controle = installation.indexOf('roleIsGlobalAdmin');
    const appel = installation.indexOf('livrerParLaVoieOrdinaire(');
    assert.ok(controle > -1, 'l’installation doit contrôler le rôle');
    assert.ok(appel > controle, 'toute livraison doit être précédée du contrôle d’administrateur global');
  }
});

test('Phase 24: le catalogue attend une fenêtre calme avant migration centrale', () => {
  const guard = read('catalog-seed-guard.js');
  assert.match(guard, /CATALOG_QUIET_WINDOW_MS = 1200/);
  assert.match(guard, /scheduleCatalogInstall/);
  assert.match(guard, /Chaque nouvelle fiche repousse donc l'installation/);
  assert.match(guard, /if \(centralSynced\)/);
  assert.match(guard, /installCentralCatalogOnce\(\)\.finally\(\(\) => releaseCaptureSoon\(2200\)\)/);
});

test('Phase 24: la migration centrale du catalogue est atomique, versionnée et protégée contre la concurrence', () => {
  const server = read('scripts/catalog-seed-preload.js');
  const pkg = read('package.json');
  assert.match(server, /POST'[\s\S]*\/api\/sync\/catalog-install/);
  assert.match(server, /pg_advisory_xact_lock/);
  assert.match(server, /BEGIN/);
  assert.match(server, /COMMIT/);
  assert.match(server, /ROLLBACK/);
  assert.match(server, /catalogSeedVersion/);
  assert.match(server, /installedVersion >= payload\.version/);
  assert.match(server, /\['admin','manager'\]/);
  assert.match(pkg, /--import \.\/scripts\/catalog-seed-preload\.js/);
});

test('Phase 24: les refus métier 4xx conservent le rollback central historique', () => {
  const central = read('central-sync.js');
  assert.match(central, /isPermanentSyncRejection/);
  /*
   * Le retour arrière reste le même GESTE — reposer la fiche d'avant — mais il passe
   * désormais par `restaurerFicheAnterieure` (B4-R2) : sur un poste dont la purge n'a pas
   * encore tourné, `previous` porte encore le mot de passe, et le reposer brut le
   * remettait sur le disque à l'instant précis de l'échec. Les champs non sensibles
   * d'avant sont préservés à l'identique ; c'est bien le rollback historique.
   */
  assert.match(central, /if \(previous\) await restaurerFicheAnterieure\(storeName, previous\)/);
  assert.match(central, /async function restaurerFicheAnterieure\(storeName, previous\)/);
  assert.doesNotMatch(central, /if \(previous\) await originalSave\(storeName, previous\)/,
    'aucun retour arrière ne doit reposer la fiche brute');
  assert.match(central, /else await originalDeleteRaw\(storeName, id\)/);
  assert.match(central, /recordRejectedOperation\('save'/);
  assert.match(central, /throw error/);
});

test('Phase 24: aucune sonde session 401 n’est émise avant une authentification locale', () => {
  const auth = read('auth.js');
  const checkSession = auth.slice(auth.indexOf('async checkSession()'), auth.indexOf('applyRoleTheme(role)'));
  const anonymousReturn = checkSession.indexOf('if (!localUser)');
  const fetchSession = checkSession.indexOf("fetch('/api/auth/session'");
  assert.ok(anonymousReturn >= 0 && fetchSession > anonymousReturn, 'le retour anonyme doit précéder la sonde serveur');
  assert.match(checkSession, /localStorage\.removeItem\('session'\)/);
});

test('Phase 24: toutes les colonnes équipements restent accessibles', () => {
  const equipment = read('equipements.js');
  const runtime = read('equipment-table-runtime.js');
  const css = read('equipment-table-runtime.css');
  const expected = ['Nom','Type','Catégorie','Marque','Modèle','Numéro de série','N° d’Immobilisation','Statut','Salle','Rack','Adresse IP','N° Grille IN/OUT','Date installation','Fin garantie','Notes','QR','Images','Actions'];
  for (const label of expected) assert.ok(equipment.includes(label), `colonne manquante: ${label}`);
  assert.match(runtime, /equipment-columns-toggle/);
  assert.match(runtime, /Tout afficher/);
  assert.match(runtime, /equipment-table-top-scroll/);
  assert.match(runtime, /ResizeObserver/);
  assert.match(css, /min-width:2200px!important/);
  assert.match(css, /overflow-x:auto!important/);
  assert.match(css, /position:sticky/);
});

test('Phase 24: Accès zones récupère les utilisateurs canoniques sans inventer de droits', () => {
  const zone = read('zone-access-runtime-fix.js');
  assert.match(zone, /db\.getAll\('users'\)/);
  assert.match(zone, /\/api\/sync/);
  assert.match(zone, /normalizeRole\(user\.role\) !== 'admin'/);
  assert.match(zone, /data\.memberships = \(data\.memberships \|\| \[\]\)/);
  assert.match(zone, /data\.grants = \(data\.grants \|\| \[\]\)/);
  assert.doesNotMatch(zone, /memberships\.push|grants\.push/);
  assert.match(zone, /Aucun utilisateur non administrateur n’est disponible/);
});

test('Phase 24: le splash converge vers un symbole compact lisible desktop/mobile', () => {
  const splash = read('startup-splash.js');
  const css = read('startup-splash.css');
  const version = Number(splash.match(/STARTUP_SPLASH_VERSION = (\d+)/)?.[1] || 0);
  // Les huit pièces sont désormais les polygones officiels du logo 2M, et non plus une
  // pale répétée par rotation. Le symbole converge toujours en un bloc compact, centré,
  // dimensionné par une seule variable — c'est cela que ce test doit garantir, pas les
  // coordonnées d'un dessin qui a changé.
  const pieces = (splash.match(/fill:'#/g) || []).length;
  assert.ok(version >= 4);
  assert.equal(pieces, 8);
  assert.match(splash, /viewBox="0 0 519 505"/);
  assert.match(splash, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(css, /--sp-logo:min\(55vw,320px\)/);
  assert.match(css, /--sp-logo:min\(31vw,360px\)/);
  assert.match(css, /\.startup-logo-wrap\{[^}]*width:var\(--sp-logo\)/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('Phase 24: les nouveaux correctifs sont chargés et disponibles hors ligne', () => {
  const html = read('index.html');
  const sw = read('service-worker.js');
  for (const asset of ['catalog-seed-guard.js','equipment-table-runtime.js','equipment-table-runtime.css','zone-access-runtime-fix.js','phase24-runtime.css']) {
    assert.ok(html.includes(asset), `${asset} absent de index.html`);
    assert.ok(sw.includes(`/${asset}`), `${asset} absent du cache PWA`);
  }
  const cache = Number(sw.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/)?.[1] || 0);
  assert.ok(cache >= 38, `cache Phase 24 insuffisant: ${cache}`);
});
