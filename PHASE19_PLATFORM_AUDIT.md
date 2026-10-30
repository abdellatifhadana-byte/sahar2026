# Phase 19 — Audit de cohérence 2M TECH Platform

Ce document décrit le rôle de chaque surface active, ses données canoniques et la règle de propagation. Il sert de garde-fou contre les doublons fonctionnels et les correctifs qui se neutralisent.

## Principe d'architecture

Une salle, une baie, un équipement, un port, un câble, un écran ou un mur ne doit exister qu'une fois dans son store canonique. La carte et les schémas sont des représentations/éditeurs de ces entités, jamais des inventaires parallèles.

Le chemin d'écriture attendu est :

`UI → validation métier → db.save → normalisation média/cohérence → synchronisation centrale → miroir IndexedDB → relecture → événement d'invalidation → rafraîchissement de la vue dépendante`.

Les éditeurs ouverts bloquent volontairement les rafraîchissements automatiques afin de ne pas perdre les modifications utilisateur. Le rafraîchissement reprend après fermeture de l'éditeur.

## Surfaces et responsabilités

| Surface | Données principales | Peut écrire | Relation avec le reste de la plateforme | État Phase 19 |
|---|---|---|---|---|
| Démarrage / Splash | session, intégrité, état de boot | non | précède toute UI de rôle | Splash technique animé relié aux étapes réelles de démarrage |
| Connexion | utilisateurs/session serveur | authentification | ouvre l'espace du rôle canonique | Français, flux de connexion unique |
| Tableau de bord Admin | équipements, salles, baies, tickets, écrans | actions via sections | synthèse et navigation | Données canoniques, rafraîchissement après invalidation |
| Carte interactive | rooms, baies, equipments, walls | Admin selon permissions | localisation et navigation vers les mêmes fiches | Image `settings/global`, proportions naturelles, Fit/Zoom/Pan, grandes images |
| Salles | rooms | selon permissions | parent des baies, équipements, écrans et murs | Images durables + relecture après sauvegarde |
| Baies | baies | selon permissions | enfant d'une salle, parent d'équipements | Réaffectation cohérente avec roomId des équipements associés |
| Équipements | equipments + ports/components | selon permissions | source centrale de l'identité technique | Ports canoniques, relations 360°, câbles et schémas |
| Câbles | cables | selon permissions | relie deux ports canoniques | Validation connecteur/signal/protocole + création possible depuis Schéma |
| Mur d'images | walls + screens | selon permissions | écran lié à salle/mur/équipement/diagnostic/ticket | Module canonique `wall-manager.js`, dessin écran et navigation Map |
| Diagnostic écrans | screens, screen_issues, screen_groups, diagnosis_history | Admin/Technicien selon permission | incidents et historique d'écrans | Rôles normalisés, écran canonique partagé avec mur |
| Tickets / demandes | tickets + entité liée | selon rôle | référence équipement/salle/baie/écran/mur selon contrat | Même entité liée, rafraîchissement cohérent |
| Schémas techniques | docs(kind=technical_diagram) | selon permission | projection graphique d'entités/ports/câbles | Grand workspace + création canonique Équipement/Port/Câble depuis le studio |
| Signal Flow | docs/topologie + câbles/ports | selon permission | relations logiques/physiques | Références canoniques validées côté serveur |
| Continuité | docs/continuité | selon permission | principal/secours, procédures et tests | Références protégées et versions validées immuables |
| Intégrité | tous stores techniques | lecture/audit | détecte références et données incohérentes | Centre d'audit existant conservé |
| Rapports | tous stores principaux | export | vue consolidée de santé/couverture | Étendu en Phase 19 aux ports, câbles, écrans, tickets et schémas |
| Utilisateurs | users | Admin | rôles et droits | Rôles canoniques; cache local sans credentials persistants |
| Journal | logs | selon permission | audit des actions | Source commune aux écrans/équipements/opérations |
| Paramètres | settings/global | Admin | thème, sécurité locale, fréquence backup, plan carte | Propriétaire unique `settings-contract.js`; legacy id=1 migré |
| Espace Technicien | mêmes stores opérationnels | selon permissions | routes vers équipements, salles, baies, tickets, écrans, mur, carte | Loader de marque + navigation canonique |
| Espace Responsable | mêmes stores autorisés | selon permissions | Carte, Mur, Diagnostic, inventaire | Pas de copie de données; composants partagés |
| Espace Visiteur | lecture autorisée | non | Carte → Salle/Baie/Équipement/Mur | Parcours lecture seule partagé |

## Problèmes structurants corrigés dans cette phase

1. **Deux propriétaires des paramètres** : `settings/1` et `settings/global` pouvaient diverger. `settings/global` devient l'unique identifiant canonique et le legacy est migré.
2. **Override concurrent** : `compat-integrations.js` redéfinissait les méthodes de `SystemSettings` et pouvait annuler une correction ultérieure. Cet override est supprimé; le contrat Settings est propriétaire unique.
3. **Média différent local/central** : une URL `blob:` pouvait être convertie localement après que la synchronisation avait déjà reçu le payload original. La normalisation durable se fait maintenant avant le writer central, puis une relecture valide le résultat.
4. **Carte forcée en 2000×1200 visuels** : l'image est désormais affichée à ses dimensions naturelles; le repère logique historique reste 2000×1200 uniquement comme espace de coordonnées compatible.
5. **Schéma comme simple dessin** : le studio peut créer un équipement, un port ou un câble dans les stores canoniques, puis réutiliser le flux de liaison existant au lieu de créer une seconde fiche graphique.
6. **Grand schéma** : le workspace respecte `background.width/height` jusqu'à la limite du contrat et ajoute Fit/Zoom/100 % sans boucle MutationObserver.
7. **Rafraîchissements dangereux** : les événements canoniques n'écrasent pas les formulaires ouverts; les vues dépendantes sont invalidées et rafraîchies au bon moment.
8. **Rapports trop limités** : la page inclut maintenant écrans, câbles, tickets, schémas et couverture des données.

## Règles à conserver pour les phases suivantes

- Ne jamais introduire `mapEquipment`, `diagramEquipment` ou une autre copie métier d'une entité canonique.
- Une liaison physique affichée dans un schéma référence obligatoirement un câble réel et ses deux ports.
- Un changement de salle/baie/équipement doit passer par `db.save` et les gardes de dépendances; pas de mutation durable seulement dans le DOM.
- Toute image persistante doit être une référence durable; `blob:` n'est jamais une donnée métier sauvegardée.
- Les textes visibles sont en français. Les commentaires internes historiques peuvent être dans une autre langue sans affecter l'interface.
- Les correctifs de compatibilité ne doivent pas redéfinir un service qui possède déjà un contrat canonique.
- Toute nouvelle extension du shell doit être ajoutée au Service Worker et au test de graphe actif.
- Toute suppression d'une ressource technique doit respecter les contrôles de dépendances serveur.

## Contrôles Phase 19

Le test `tests/platform-coherence-phase19.test.js` verrouille notamment : Settings canonique, persistance média, ordre des wrappers de sauvegarde, splash, grande carte, authoring canonique des schémas, workspace large, invalidation sûre et cache PWA.
