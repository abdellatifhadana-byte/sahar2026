/**
 * @file service-worker.js - Service Worker de la plateforme 2M TECH
 * @description Prise en charge PWA, cache local et fonctionnement hors connexion.
 * @note LE PLAN TECHNIQUE N'EST PLUS PRÉ-CACHÉ. `/assets/plan-technique.PNG` figurait dans
 *       `ASSETS_TO_CACHE` : il était donc téléchargé et conservé à l'installation, avant
 *       toute connexion, et restait disponible hors ligne après une déconnexion — mesuré,
 *       46 276 octets encore présents dans le cache `2mtech-v5.38` après `logout`. Ses
 *       octets passent désormais par `/api/settings/map-image`, que la stratégie `fetch`
 *       ci-dessous ne met jamais en cache puisque la route est sous `/api/`. Le nom du
 *       cache change à ce lot pour que `activate` supprime l'ancien, plan compris.
 * @note  #137 — LE CACHE CHANGE DE NOM PARCE QUE SON CONTENU ÉTAIT LE PROBLÈME.
 *        `2mtech-v5.39` contenait les anciens `grille-centrale-*.js`, jeux de données
 *        compris : les octets retirés du serveur seraient restés sur le poste, lisibles
 *        hors ligne et après déconnexion. `activate` supprime tout cache dont le nom
 *        diffère : renommer, ici, c'est effacer. La réponse de l'endpoint protégé, elle,
 *        n'est jamais mise en cache — la stratégie `fetch` écarte toute route sous `/api/`.
 * @note  #78 PHASE 0 — LES PREUVES TERRAIN NE SONT PLUS PRÉCACHÉES, NI MISES EN CACHE.
 *        `assets/field-evidence/**` figurait dans `ASSETS_TO_CACHE` : le pack, les
 *        fragments `.b64` et les images `.webp` étaient donc téléchargés d'AVANCE, à
 *        l'installation, avant toute session — puis conservés hors ligne après déconnexion,
 *        comme le plan technique avant #137. Le serveur ferme maintenant le sous-arbre
 *        (`isPrivateStaticPath`, `scripts/serve.js`) ; ce fichier s'assure que le Service
 *        Worker ne contourne pas cette fermeture par un chemin qui lui est propre : ni
 *        précaché, ni mis en cache au fil de l'eau, ni réinjectable par `CACHE_ASSETS`, ni
 *        rendu depuis un ancien cache resté sur le poste. Le nom du cache change ici aussi,
 *        pour que `activate` efface tout exemplaire déjà présent.
 * @history Régressions média validées sur 2mtech-v5.19, Field Evidence sur v5.20-v5.21, migration compacte Phase 11 sur v5.23, architecture physique Grille Centrale sur v5.24, plan documentaire 190x184 sur v5.25, checklist terrain/as-built sur v5.26, intake générique des preuves terrain sur v5.27, inventaire Régie Car additif sur v5.28, préparation pré-photo Régie Car Phase 17 dans le même cache v5.28, jumeau opérationnel cartographique Phase 18 sur v5.29, édition salles/baies + sélecteurs recherchables + récupération visuelle des données sur v5.30, édition directe depuis la carte et durcissement du rafraîchissement sur v5.31, cohérence globale Settings/médias/splash/carte/schémas Phase 19 sur v5.33, contrat mobile + symbole Splash Phase 21 sur v5.34, Mur d'images unifié + host diagnostic multi-rôles Phase 22 sur v5.35, stabilisation des interactions du Mur Phase 22 sur v5.36, contrat central PermissionManager et enforcement entités Phase 23 sur v5.37, corrections runtime catalogue/splash/équipements/accès zones Phase 24 sur v5.38.
 */

/*
 * CACHE BUMPÉ POUR ÉVICTION (A-5).
 *
 * Les installations existantes portent, dans `2mtech-v5.42`, les ANCIENNES copies de
 * `regie-car-inventory-phase16.js` et `regie-car-prephoto-readiness.js` — celles qui
 * contenaient encore le relevé d'installation : baies réelles, matériel par baie, repères
 * d'exploitation, numéro d'inventaire interne. Ces octets sont déjà sortis, et ils restent
 * lisibles hors ligne tant que le cache qui les porte existe.
 *
 * Le changement de nom fait que `activate` supprime le cache précédent EN ENTIER (voir plus
 * bas) : c'est la seule chose qui reprenne ce qui a déjà été téléchargé. Retirer les chemins
 * du précache, à l'inverse, n'y changerait rien.
 *
 * LES TROIS CHEMINS RESTENT PRÉCACHÉS, ET C'EST VOULU. Après extraction, ces fichiers ne
 * contiennent plus aucune valeur d'installation — vérifié octet par octet par la garde de
 * résidus. Ce sont des coques de logique, et leur présence au précache est une garantie
 * hors ligne que les épreuves documentent déjà. Le relevé, lui, ne vit plus dans aucun
 * fichier statique : il ne sort que par `/api/`, que ce Service Worker ne met jamais en
 * cache.
 */
const CACHE_NAME = '2mtech-v5.44';
const OFFLINE_URL = '/offline.html';
const APP_SHELL_URL = '/index.html';
const ASSETS_TO_CACHE = [
  '/',
  APP_SHELL_URL, '/manifest.json',
  '/main.css', '/startup-splash.css', '/login.css', '/design-system.css', '/tech-loading-brand.css', '/admin.css', '/wall.css', '/screens-diagnostic.css', '/ui-refresh.css', '/ui-polish.css', '/ui-final.css', '/ui-tune.css', '/ui-sections.css', '/ui-actions.css', '/ui-notifications.css', '/broadcast-ports-cables.css', '/broadcast-relations.css', '/operations-suite.css', '/ui-shell-fixes.css', '/service-requests.css', '/equipment-smart-knowledge.css', '/equipment-media.css', '/media-runtime-health.css', '/continuity-center.css', '/diagram-studio.css', '/diagram-studio-advanced.css', '/diagram-workspace.css', '/map-digital-twin.css', '/mobile-runtime.css', '/equipment-table-runtime.css', '/phase24-runtime.css', '/signal-spine.css', '/pilot-technique-preview.css', '/assets/all.min.css',
  '/app-dialog.js', '/app-dialog-safe-confirm.js', '/app-dialog-patches.js', '/room-deletion.js',
  '/dialog-behavior.js', '/signal-spine.js', '/signal-chain-contract.js', '/map-image-store.js', '/core.js', '/startup-splash.js', '/settings-contract.js', '/db.js', '/db-migration-v15.js', '/db-migration-v16.js', '/auth.js', '/users.js', '/equipements.js', '/salles.js',
  '/baies.js', '/pilot-technique-shell.js', '/rapports.js', '/admin-ui.js', '/techui.js', '/tech-loading-brand.js', '/responsible-ui.js',
  '/visitor-ui.js', '/visitor-canonical-integration.js', '/notifications.js', '/system-settings.js', '/events.js', '/navigation-contract.js', '/role-navigation-integration.js',
  '/permissions.js', '/roles.js', '/security.js', '/qr.js', '/qr-encoder.js', '/backup-service.js',
  '/screens-diagnostic.js', '/screens-diagnostic-host-integration.js', '/diagnostic-xss-guard.js', '/interactive-map.js', '/map-digital-twin-contract.js', '/map-digital-twin.js', '/map-admin-entity-edit.js', '/nested-shape-contract.js', '/tickets.js', '/service-request-contract.js', '/dashboard.js',
  '/wall-manager.js', '/wall-model.js', '/wall-interaction-integration.js', '/data-integrity.js', '/integrity-center.js', '/platform-integrity.js', '/logs.js',
  '/logsSection.js', '/notes.js', '/ar-support.js', '/ticket-nav-fix.js',
  '/equipment-knowledge.js', '/equipment-knowledge-extra.js', '/equipment-image-seed.js', '/equipment-image-coverage-batch2.js', '/equipment-image-coverage-batch3.js', '/equipment-image-coverage-batch4.js', '/equipment-image-coverage-batch5.js', '/equipment-image-coverage-batch6.js', '/equipment-image-coverage-batch7.js', '/equipment-image-coverage-batch8.js', '/grille-centrale-dataset.js', '/operational-dataset-scope.js', '/regie-car-dataset.js', '/grille-centrale-public-identity.js', '/grille-centrale-knowledge.js', '/grille-centrale-topology.js', '/grille-centrale-physical-architecture.js', '/grille-centrale-documented-map.js', '/grille-centrale-field-verification.js', '/equipment-field-evidence.js', '/phase11-field-pack-migration.js', '/field-evidence-integration.js', '/equipment-field-evidence-phase12.js', '/field-evidence-intake.js', '/field-evidence-intake-ui.js', '/regie-car-inventory-phase16.js', '/regie-car-prephoto-readiness.js', '/equipment-media-linkage.js', '/equipment-catalog-extra-seed.js', '/equipment-catalog-gap-seed.js', '/equipment-knowledge-contract.js', '/equipment-knowledge-packs.js', '/routing-knowledge-seed.js',
  '/broadcast-ports-cables.js', '/broadcast-relations.js', '/equipment-internals.js', '/equipment-internals-contract.js', '/equipment-smart-knowledge.js', '/equipment-media.js', '/equipment-component-shapes.js', '/media-contract.js', '/media-runtime-health.js', '/persistent-image-guard.js', '/central-sync.js', '/write-coherence.js', '/catalog-seed-guard.js', '/equipment-write-contract.js', '/equipment-write-guard.js', '/equipment-editor-service.js', '/equipment-component-integration.js', '/entity-permission-integration.js', '/map-equipment-editor-bridge.js', '/equipment-360-host-bridge.js', '/equipment-relations-360.js', '/equipment-context-actions.js', '/relationship-contract.js', '/platform-entity-graph.js', '/component-relations.js', '/cable-endpoint-contract.js', '/cable-permissions-contract.js', '/cable-route-access.js', '/cable-route-session.js', '/cable-route-presentation.js', '/cable-route-layer.js', '/cable-route-editor.js', '/inventory-master.js', '/inventory-central-install.js', '/module-hierarchy-contract.js', '/module-assignment.js',
  '/operations-suite.js', '/location-contract.js', '/exploitation-scope-contract.js', '/map-equipment-360-bridge.js', '/equipment-360-complete.js', '/platform-usability-fixes.js', '/equipment-table-runtime.js', '/entity-select-search.js', '/data-visibility-recovery.js', '/credential-cache-guard.js', '/local-credential-contract.js', '/map-fit-fix.js',
  '/topology-contract.js', '/broadcast-topology.js', '/signal-flow.js', '/rf-master-import.js',
  '/connectivity-contract.js', '/equipment-port-template.js', '/continuity-contract.js', '/technical-graph.js', '/diagram-contract.js', '/continuity-center.js', '/diagram-studio.js', '/diagram-studio-advanced.js', '/diagram-canonical-authoring.js', '/diagram-workspace.js', '/engineering-refs.js', '/procedures-center.js', '/equipment-360-engineering-links.js',
  '/zone-access.js', '/zone-access-integration.js', '/zone-access-runtime-fix.js',
  '/Chart.js', '/pilot-technique-preview.js', '/sw-register.js',
  '/assets/images/favicon.png', '/assets/images/2m-logo.webp',
  '/assets/images/tech-icon.webp', '/assets/image-indisponible.svg',
  '/images/2M.jpeg', '/images/2m-logo.webp', '/images/OIP.webp',
  '/assets/webfonts/fa-solid-900.woff2',
  '/assets/webfonts/fa-regular-400.woff2',
  '/assets/webfonts/fa-brands-400.woff2',
  OFFLINE_URL
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting()));
});

/*
 * LE MÊME SOUS-ARBRE QUE LE SERVEUR, VÉRIFIÉ PAR LE MÊME RAISONNEMENT (#78 Phase 0).
 *
 * Ce script est classique, pas un module : il ne peut pas importer la fonction du serveur.
 * La logique est donc réécrite ici, à l'identique — décoder, séparer en segments non vides,
 * comparer en minuscules — et un test comportemental compare les DEUX implémentations sur
 * la même batterie de chemins pour qu'un écart entre elles reste visible, pas silencieux.
 *
 * `event.request.url` a déjà été normalisée par l'analyseur d'URL du navigateur avant
 * d'atteindre ce point : `../` s'y résout déjà, il n'y a rien à refaire ici. Un `%2f`
 * encodé, lui, reste littéral dans `.pathname` — c'est pourquoi le décodage a lieu avant
 * la séparation en segments, comme côté serveur.
 */
function isPrivateFieldEvidenceRequest(requestUrl) {
  let url;
  // Un chemin relatif — la forme des entrées `CACHE_ASSETS`, à l'image d'`ASSETS_TO_CACHE`
  // — se résout contre l'origine du Service Worker, exactement comme `cache.addAll()` le
  // ferait. Sans cette base, `new URL()` rejette tout chemin relatif, et le repli
  // fail-closed bloquerait alors des actifs publics ordinaires, pas seulement les protégés.
  try { url = new URL(requestUrl, self.location.origin); } catch { return true; }
  /*
   * `//assets//field-evidence/…` n'est PAS un chemin : `//` ouvre une URL relative au
   * PROTOCOLE, et `assets` en devient l'HÔTE — un hôte différent du nôtre, dont le
   * `pathname` ne contient alors plus `assets/field-evidence` du tout. Le gestionnaire
   * `fetch` filtre déjà les requêtes hors origine avant d'appeler cette fonction ; ce n'est
   * donc utile qu'à `CACHE_ASSETS`, qui n'a aucune raison de mettre en cache une origine
   * étrangère. Refuser directement referme les deux cas d'un coup.
   */
  if (url.origin !== self.location.origin) return true;
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { return true; }
  const segments = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[0]?.toLowerCase() === 'assets' && segments[1]?.toLowerCase() === 'field-evidence';
}

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(cacheNames => Promise.all(
    cacheNames.map(cacheName => cacheName !== CACHE_NAME ? caches.delete(cacheName) : Promise.resolve())
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'OFFLINE', message: 'Vous êtes hors ligne' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type':'application/json', 'Cache-Control': 'no-store' }
    })));
    return;
  }
  /*
   * LES PREUVES TERRAIN NE PASSENT JAMAIS PAR LE CACHE, DANS AUCUN SENS (#78 Phase 0).
   *
   * Trois garanties, et les trois sont nécessaires ensemble :
   *   · la réponse réseau n'est JAMAIS écrite dans `Cache Storage`, même si elle est `ok` —
   *     le serveur la refuse désormais, mais une régression serveur ne doit pas se
   *     retrouver conservée localement pour autant ;
   *   · un échec réseau ne consulte JAMAIS `caches.match()` — un exemplaire resté d'une
   *     version antérieure du Service Worker ne doit jamais resurgir ;
   *   · donc hors ligne, la ressource est indisponible. C'est le comportement voulu :
   *     Phase 0 accepte que la fonctionnalité manque hors ligne plutôt que de laisser
   *     survivre une copie locale d'une donnée que le serveur vient de fermer.
   */
  if (isPrivateFieldEvidenceRequest(event.request.url)) {
    event.respondWith(fetch(event.request, { cache:'no-store' })
      .catch(() => new Response('', { status:404, statusText:'Not Found', headers:{ 'Cache-Control':'no-store' } })));
    return;
  }
  event.respondWith(fetch(event.request, { cache:'no-store' })
    .then(response => {
      if (response.ok) {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
      }
      return response;
    })
    .catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      if (event.request.mode === 'navigate') return (await caches.match(APP_SHELL_URL)) || (await caches.match('/')) || (await caches.match(OFFLINE_URL));
      return new Response('', { status:404, statusText:'Not Found' });
    }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CACHE_ASSETS') {
    /*
     * `CACHE_ASSETS` ACCEPTAIT N'IMPORTE QUELLE LISTE DE CHEMINS SANS LA VÉRIFIER (#78 Phase 0).
     *
     * Retirer les preuves terrain de `ASSETS_TO_CACHE` ne suffit pas si ce second chemin
     * peut les y remettre : un message `postMessage` portant une URL de preuve terrain —
     * ou une route `/api/` — aurait rouvert exactement la porte que ce lot ferme. Le
     * filtre est le MÊME prédicat que celui du gestionnaire `fetch`, plus l'exclusion des
     * routes `/api/`, déjà exclues de tout cache ailleurs dans ce fichier.
     */
    const payload = Array.isArray(event.data.payload) ? event.data.payload : [];
    const safe = payload.filter(url => !isPrivateFieldEvidenceRequest(url) && !String(url).includes('/api/'));
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(safe)));
  }
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});