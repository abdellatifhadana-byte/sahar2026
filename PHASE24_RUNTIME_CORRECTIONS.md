# Phase 24 — Corrections runtime ciblées

Cette phase traite les défauts observés dans l’audit navigateur `FULL_RUNTIME_AUDIT.md` et dans les captures de production.

## Invariants

- PostgreSQL reste la source de vérité centrale.
- Un seed livré avec l’application n’est jamais traité comme un CRUD utilisateur.
- Un refus serveur 4xx continue à annuler l’écriture locale correspondante.
- Un rôle non administrateur ne rejoue jamais le catalogue technique vers PostgreSQL.
- La migration du catalogue est versionnée, atomique et protégée contre deux installateurs simultanés.
- Le cache IndexedDB est reconstruit depuis `/api/sync` après une migration centrale.
- Accès zones n’invente jamais une affectation ou une permission : utilisateurs, zones, memberships et grants restent des données serveur.

## Correctifs

### Catalogue au login

`catalog-seed-guard.js` est chargé après `central-sync.js` et `write-coherence.js`, mais avant les modules de seed. Les documents automatiques sont capturés localement pendant le boot afin de constituer le catalogue candidat sans générer de PUT ni de syncQueue utilisateur.

Pour un administrateur global et uniquement si `settings/global.catalogSeedVersion` est obsolète, une requête `POST /api/sync/catalog-install` installe le lot. `scripts/catalog-seed-preload.js` réalise l’opération dans une transaction PostgreSQL avec `pg_advisory_xact_lock`. Une seconde installation de la même version écrit zéro document.

### Splash

Les huit segments convergent maintenant vers un même centre. Le symbole final est compact, puis le titre, l’état et la progression restent dans des zones visuelles séparées et lisibles sur desktop/mobile.

### Équipements

Les 18 colonnes restent accessibles. Le tableau possède un défilement horizontal haut et bas, `Nom` et `Actions` collants, ainsi qu’un sélecteur `Colonnes`. Sur téléphone une sélection compacte est proposée sans supprimer la possibilité `Tout afficher`.

### Accès zones

`zone-access-runtime-fix.js` consolide les utilisateurs depuis la réponse de gestion, le miroir IndexedDB et, pour l’admin, le snapshot central si nécessaire. Il ne crée aucune affectation ni aucun grant. Le formulaire indique explicitement si aucun utilisateur assignable ou aucune zone n’existe réellement.

### Session anonyme

`Auth.checkSession()` ne provoque plus un `GET /api/auth/session` destiné à échouer lorsqu’aucune identité locale n’existe. Une session locale existante continue d’être validée côté serveur.

## Vérification

- `tests/runtime-corrections-phase24.test.js`
- `scripts/catalog-seed-e2e.mjs`
- `scripts/zone-access-e2e.mjs`
- `.github/workflows/runtime-phase24.yml`
- workflow complet historique `Vérification 2M TECH` sur le PR puis sur `main` avant clôture.
