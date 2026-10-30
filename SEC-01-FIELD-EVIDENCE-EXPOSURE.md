# SEC-01 — Field Evidence non protégée par le runtime statique/PWA

Baseline Runtime vérifiée : `main@33827f436d1e20ec79cb1d08789c5e3f06aece26`.

## Statut corrigé

Le repository `hdnkabour-gif/Tech-Platform-` est actuellement **PRIVATE**.

Donc :

- **GitHub tree/history n'est pas une exposition publique Internet.** Les blobs et l'historique restent accessibles uniquement aux comptes autorisés et aux clones déjà réalisés.
- **Le défaut Runtime reste PROVEN** : le serveur statique courant ne protège pas `assets/**`, sert les fichiers statiques non HTML avec `Cache-Control: public, max-age=3600`, et le Service Worker précache/runtime-cache les Field Evidence.
- **L'exposition anonyme réelle sur Railway reste à confirmer par un probe externe.** Le code implique qu'un client capable d'atteindre le host peut demander ces chemins sans session, mais ce point réseau doit être mesuré avant d'être déclaré REPRODUCED.

Sévérité : **HIGH PROVEN au niveau Runtime/PWA ; P0 si le deployment Railway est publiquement accessible sur ces chemins.**

## Preuves sur le code courant

- `service-worker.js` (`CACHE_NAME = 2mtech-v5.38`) inclut explicitement dans `ASSETS_TO_CACHE` :
  - `assets/field-evidence/2026-08-16/2m-field-pack.bin` ;
  - les fragments `phase11-migration-*.b64` ;
  - les 9 images `phase12-*.webp`.
- son handler `fetch` runtime-cache tout GET same-origin réussi hors `/api/`.
- `scripts/serve.js` protège seulement `.git`, `.github`, `scripts`, `tests`, `node_modules`, `LEGACY-ROOT`, `SOURCE-WALLS`; `assets/**` n'est pas privé.
- les fichiers statiques non HTML/service-worker reçoivent `Cache-Control: public, max-age=3600`.
- `equipment-field-evidence.js` charge directement `/assets/field-evidence/2026-08-16/2m-field-pack.bin` avec `cache:'force-cache'`, le découpe puis conserve des `blob:` URLs en mémoire.

## Risques qui restent vrais avec un repo privé

1. Si Railway est accessible depuis Internet ou un réseau plus large que les utilisateurs autorisés, les chemins statiques sont servis sans session.
2. Le Service Worker conserve les médias dans Cache Storage et peut les restituer offline après logout tant que le cache n'est pas évincé.
3. Les `blob:` URLs Field Evidence restent en mémoire jusqu'au reload/process cleanup.
4. Les metadata/`assetRef` peuvent circuler dans `docs`, IndexedDB, PostgreSQL et backups.
5. Les clones autorisés et anciennes copies Git conservent l'historique : c'est un sujet de rétention/need-to-know, pas une exposition publique GitHub.

## Invariant de sécurité cible

`authenticated upload → private storage → opaque assetRef → authorization role/zone/resource → authenticated media endpoint → Cache-Control private/no-store → aucun SW cache → audit log`

Les enregistrements métier ne doivent stocker qu'un `assetRef` opaque, jamais un chemin statique exposé, une data URL, un binaire ou une recette de reconstruction.

## Séparation stricte

- `room.locationId` / Digital Twin : hors périmètre sauf référence média.
- Batch B Concurrency : ne pas modifier `central-sync.js`/revision contract dans SEC-01 tant que Batch B n'est pas terminé.
- Manufacturer media / branding : classification et provenance/licence séparées.
- `docs.zoneIds` : conserver leur contrat multi-zone ; le média privé applique l'autorisation de sa ressource liée.

## Phase 0 — Containment

- bloquer l'accès statique non authentifié aux Field Evidence ;
- retirer les médias privés de `ASSETS_TO_CACHE` ;
- empêcher leur runtime cache par le Service Worker ;
- bump cache version + éviction explicite des caches historiques ;
- geler toute nouvelle Field Evidence dans les chemins statiques ;
- ajouter des tests anonymes de non-exposition.

Cette phase est du confinement, pas la remediation finale.

## Phase 1 — Media privée

- upload authentifié et autorisé ;
- validation bytes/MIME/taille ;
- stockage privé ;
- `assetRef` opaque et durable ;
- endpoint `/api/media/:assetRef` ou équivalent ;
- auth + role/zone/resource sur chaque GET ;
- `Cache-Control: private, no-store` ;
- audit lecture/upload/retrait ;
- aucune résolution par chemin statique public.

## Phase 2 — Migration

- reconstruire Phase 11 offline une seule fois ;
- importer les 20 + 9 assets dans le stockage privé ;
- convertir consumers et records vers `assetRef` ;
- migrer metadata `docs`/equipments/etc. sans URL statique exposée ;
- backup/export ne transportent que références opaques et metadata autorisées.

## Phase 3 — Rétention / purge

- supprimer pack, fragments `.b64`, images et reconstruction recipes des chemins Runtime statiques ;
- évaluer la nécessité d'un rewrite Git history selon sensibilité, nombre de collaborateurs/clones et politique 2M ;
- **ne pas considérer `git filter-repo` obligatoire uniquement parce que les blobs existent dans un repository privé** ;
- purger Railway/CDN/browser caches ;
- effectuer un probe externe sur les anciennes URLs.

## Acceptance tests obligatoires

1. anonymous GET private media → 401/403/404 ;
2. authenticated authorized → 200 ;
3. hors zone → 403/404 ;
4. role downgrade / zone revoke → accès perdu immédiatement ;
5. logout/session expiry → aucun reuse depuis Cache Storage ;
6. aucun precache/runtime cache SW du média privé ;
7. offline → fail closed ;
8. guessing d'`assetRef` → aucun accès ;
9. backup/export → `assetRef` opaque uniquement ;
10. mutation réintroduisant static path/session bypass/public caching → tests rouges ;
11. probe externe Railway avant fermeture du ticket.

## Gate de fermeture

SEC-01 ne peut être fermé qu'après :

- correctif sur le baseline courant ;
- tests locaux + CI ;
- Runtime browser test logout/revoke/offline ;
- probe anonyme externe sur Railway des anciennes et nouvelles URLs ;
- décision documentée sur la rétention Git ;
- preuve qu'aucun consumer actif ne dépend encore de `assets/field-evidence/**`.
