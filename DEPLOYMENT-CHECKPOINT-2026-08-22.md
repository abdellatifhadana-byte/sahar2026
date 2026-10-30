# 2M TECH Platform — Verified Deployment Checkpoint — 2026-08-22

Ce fichier marque la version que nous acceptons de publier pendant la clôture de Batch B.

## Runtime accepté

Runtime fonctionnel validé et déjà fusionné :

`33827f436d1e20ec79cb1d08789c5e3f06aece26`

Il contient LOT A : rôles canoniques, autorisation fail-closed et source unique Room → `resource_zones`, avec transfert versionné Rooms + Zones, Backup/Restore, Inventory et import/export Salles protégés par l'autorité centrale.

Les commits postérieurs sur `main` jusqu'au checkpoint courant sont documentaires uniquement (SEC-01 et audit Map/Diagrammes/Procédures/Tickets) et ne modifient pas le Runtime.

## Exclus explicitement de ce déploiement

PR #79 / Batch B Concurrency n'est PAS inclus tant que les deux blockers d'architecture suivants ne sont pas fermés et revalidés :

1. création concurrente du même `(store_name, record_id)` — le verrou doit couvrir aussi la clé logique quand la ligne n'existe pas encore ;
2. raw `UPDATE/DELETE platform_records` sur des stores revisionnés qui contournent encore `revision-store.js`.

Aucun code incomplet de Batch B ne doit entrer dans `main` avant fermeture de ces deux points.

## Rollback

Branche de rollback figée avant ce marqueur :

`release/verified-2026-08-22-0601`

Cette branche pointe sur le `main` vérifié avant le commit de checkpoint.

## Règle de publication

`main` reste la seule branche de publication. Un changement Runtime n'entre dans `main` qu'après : tests, PostgreSQL E2E, gate Runtime indépendant, revue d'architecture et CI GitHub verte.

Ce commit est volontairement documentaire : il sert de marqueur de release et génère un nouveau push sur `main` afin que toute intégration de déploiement attachée à `main` republie exactement le Runtime déjà accepté, sans introduire le Batch B encore en cours.
