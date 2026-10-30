# Audit READ ONLY — Carte · Schémas · Procédures · Tickets

Baseline Runtime audité : `main@33827f436d1e20ec79cb1d08789c5e3f06aece26` (les commits documentaires SEC-01 postérieurs ne changent pas le Runtime).

Cet audit ne modifie aucun Runtime et n'entre pas dans Batch B Concurrency.

## Verdict global

La plateforme possède déjà une base d'intégration réelle : Carte → Salle/Baie/Équipement/Mur, Diagrammes → entités/ports/câbles/topologie, Tickets → zone + ressource liée + audit, Continuité → procédures de bascule/test. Mais la chaîne n'est pas complète et plusieurs contrats se contredisent.

## Findings confirmés

### MAP-01 — Hiérarchie géographique non intégrée au Digital Twin principal
`interactive-map.js` et `map-digital-twin.js` travaillent principalement avec rooms/baies/equipments/walls/screens/cables/docs/tickets. Le store `locations` et la hiérarchie ville→site→département→étage ne sont pas des nœuds de navigation du graphe/cartographie principal. `room.locationId` existe, mais la carte opérationnelle reste centrée sur Salle→Baie→Équipement.

### MAP-02 — Deux résolutions différentes de la salle d'un équipement
`map-digital-twin.js::roomOf()` préfère `equipment.roomId` avant `baie.roomId`. `platform-entity-graph.js` utilise `resolveEquipmentLocation()` de `relationship-contract.js`, qui détecte le mismatch. Un équipement dont `roomId` est périmé mais dont la baie a été déplacée peut donc être présenté différemment selon la projection.

### MAP-03 — Changement d'image par menu carte non persistant
`interactive-map.js::changeImage()` fait `URL.createObjectURL(file)` puis sauvegarde ce `blob:` dans room/baie. Un blob URL est propre au processus navigateur et ne constitue pas un asset durable. Un autre chemin (`map-admin-entity-edit.js`) utilise au contraire FileReader/data URL : deux writers, deux contrats.

### MAP-04 — IDs du menu contextuel comparés strictement à une chaîne DOM
Le menu lit `data-id` via `getAttribute()` puis cherche `r.id === id`, `b.id === id`, `e.id === id`. Les IDs numériques peuvent donc ne pas résoudre dans ce chemin, alors que le reste de la plateforme emploie `String(...)`/`normalizeId`.

### MAP-05 — Création Salle/Baie annonce le succès avant persistance garantie
`addNewItem()` pousse d'abord l'objet dans le tableau en mémoire et affiche « Ajout effectué », puis ouvre l'éditeur de forme. La persistance dépend ensuite de l'édition/enregistrement. Annuler peut laisser un état UI non durable.

### MAP-06 — Save-all réécrit des enregistrements complets
Le bouton Enregistrer parcourt rooms/baies/equipments et appelle `db.save` sur chaque copie en mémoire. C'est directement concerné par Batch B lost-update/revision ; ne pas le corriger séparément ici.

### DIAG-01 — Validation Chef contradictoire entre UI/permission et serveur métier
`permissions.js` donne `diagrams.validate=true` au Chef et le studio peut afficher « Valider » selon `diagram.validate`. Mais `diagram-contract.js::applyDiagramApproval()` autorise admin/manager/responsible/responsable et omet Chef. L'endpoint serveur appelle ensuite cette fonction : un Chef peut donc être autorisé par la zone/UI puis rejeté par le contrat final.

### DIAG-02 — Contrat Responsable incohérent
Le commentaire de `permissions.js` dit que le Chef valide et que Responsable/Technicien modifient avant validation, mais le bloc `responsible.diagrams.validate` vaut `true`. `navigation-contract.js` omet aussi `diagrams` pour Responsable alors que `diagram-studio.js` injecte une section Diagrammes dans `ResponsibleUI`. Il faut une décision produit unique puis aligner navigation/permission/UI/server.

### DIAG-03 — Création canonique depuis le schéma force des IDs numériques
`diagram-canonical-authoring.js` construit un nouvel équipement avec `roomId:Number(values.roomId)` et `baieId:Number(values.baieId)`. Des IDs texte valides deviennent `NaN`. Ce bug est distinct du finding câble/NaN précédemment fermé.

### DIAG-04 — Les schémas sont bien reliés au graphe canonique
Point positif : `platform-entity-graph.js` crée un nœud `diagram:*` et des relations `visualizes` vers les entités canoniques. Les labels suivent l'entité vivante, et la validation d'un diagramme validé exige câble+ports pour une liaison physique et `relationId` pour les liaisons techniques.

### PROC-01 — Module Procédures général non implémenté
`PROCEDURES-DESIGN.md` dit explicitement « proposition à valider — rien n'est implémenté ». Il n'existe pas de `procedures.js` et aucune section `procedures` dans `navigation-contract.js`.

### PROC-02 — Une fondation existe uniquement pour la Continuité
`continuity-contract.js` contient `continuity_procedure`, étapes typées, entityRefs, validation, versions/tests. Mais une procédure exige `protectionGroupId` et, validée, une étape `secure` ou `switch`. Elle ne peut donc pas représenter les procédures métier générales voulues (transfert fichier, intervention, procédure documentaire, etc.).

### PROC-03 — Intégrations Procédure↔Ticket↔Diagramme encore au stade conception
Le design prévoit exécution pas-à-pas, création de ticket depuis étape NOK, création de procédure depuis incident résolu, références à un schéma canonique, versions, accusés de lecture et média privé. Ces flux ne sont pas présents dans le Runtime courant.

### TICKET-01 — Liens de ressource incomplets
`RELATED_TYPES` ne contient que `equipment`, `room`, `baie`, `screen`, `continuity-test`. Il manque au minimum wall, cable, diagram, procedure et port pour atteindre le contrat plateforme demandé.

### TICKET-02 — Fermeture Manager : UI et serveur se contredisent
`tickets.js` permet à admin et manager de sélectionner `fermé`. `scripts/serve.js::updateServiceRequest()` n'autorise la fermeture définitive qu'à `isPlatformAdmin`, donc Admin uniquement depuis LOT A. Un Manager voit une action qui finit en 403.

### TICKET-03 — Pièces jointes base64 dans le record synchronisé
Ticket et commentaires acceptent image/PDF en data URL jusqu'à 5 Mo environ. Le store `tickets` est synchronisé : cela gonfle PostgreSQL, IndexedDB et snapshots. Le futur contrat média privé de SEC-01 doit être partagé avec Tickets et Procédures.

### TICKET-04 — `notifyAllUsers` n'est pas une notification centrale
La fonction ne fait qu'un `eventSystem.dispatch('show-notification', ...)` dans le navigateur courant. La création serveur écrit le ticket et l'audit mais pas un record `notifications` destiné aux autres utilisateurs. Les autres postes voient le ticket au prochain sync, sans notification centrale dédiée.

### TICKET-05 — Carte→Ticket partielle
Le panneau Équipement de la carte a un bouton « Ouvrir un ticket ». Le modal Ticket sait aussi lier room/baie/screen, mais les panneaux Salle/Baie audités n'offrent pas le même raccourci. Mur/Câble/Diagramme ne sont pas des related types.

## Contrat cible transversal

La cible ne doit pas dupliquer les données :

`locationId (où)` → `room/baie/equipment` → `platform entity graph` → `diagram visualizes canonical refs` → `procedure entityRefs/diagramRefs` → `execution` → `ticket relatedRef/contextRefs` → `audit` → `notifications`.

Chaque relation doit conserver un ID canonique ; aucun nom copié ne doit servir de jointure.

## Ordre recommandé après Batch B

1. Corriger les incohérences de projection Carte (MAP-02/03/04/05) sans toucher au contrat revision en cours.
2. Fermer la matrice Diagram validation/navigation (DIAG-01/02) + ID textuel DIAG-03.
3. Étendre le contrat Ticket relatedRef avant d'ajouter Procédures.
4. Implémenter le contrat média privé partagé SEC-01/Tickets/Procédures.
5. Livrer Procédures en réutilisant DiagramStudio et les entityRefs, pas un second éditeur.
6. Ajouter ensuite location hierarchy comme vraie couche Digital Twin ville→site→département→étage→salle.
