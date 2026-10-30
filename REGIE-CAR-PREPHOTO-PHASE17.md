# Régie Car — Phase 17 / préparation avant nouveaux lots photo

Cette phase complète ce qui peut être fait **avant** la réception de nouveaux fichiers image, sans remplacer ni réinitialiser les données de la plateforme.

## État de départ conservé

Phase 16 reste la base terrain actuelle :

- salle `Régie Car` ;
- BAIE 1, 2, 9, 10, 11 et 12 uniquement, parce que leurs numéros sont lisibles ;
- 18 références de preuve terrain ;
- 49 instances/observations ;
- séparation stricte entre preuve terrain, photo constructeur, ports physiques, câbles et routage live.

Phase 17 ne modifie pas ces principes.

## Deux observations visibles complétées

La vue terrain `regiecar-2026-08-16:09` mentionnait deux éléments visibles qui n'avaient pas encore d'instance dédiée :

1. `Routeur 4×1 HD — modèle à confirmer` ;
2. `SW3.R100 — switch réseau, modèle à confirmer`.

Ils sont ajoutés comme observations prudentes :

- constructeur non inventé ;
- modèle non inventé ;
- baie exacte non inventée ;
- aucune connectique ni liaison créée ;
- la même preuve terrain 09 reste la source.

Le blueprint Régie Car passe donc de 49 à **51 instances connues/provisoires**.

## Plan de collecte déterministe

Le module `regie-car-prephoto-readiness.js` crée le document de préparation :

`field-capture-plan:regie-car`

Ce plan est documentaire et non opérationnel. Il prépare des identifiants stables pour les futures captures :

- vue générale intérieure ;
- vue des pupitres opérateur ;
- face avant et face arrière de chaque baie connue ;
- étiquette constructeur/modèle/serial/asset tag de chaque équipement ;
- face arrière de chaque équipement ;
- façade rapprochée supplémentaire pour toute instance dont le modèle exact est encore inconnu ;
- contexte de baie pour les instances provisoires sans localisation sûre ;
- patchfield complet + premier câble démontré de bout en bout avant toute création de relation physique.

Une cible reste `awaiting-photo` tant qu'un fichier source n'a pas été reçu puis revu.

## Règles de promotion

Une photo future ne peut pas, à elle seule :

- devenir une photo constructeur ;
- créer des ports physiques ;
- créer un câble ;
- créer une topologie ;
- créer un crosspoint actif ;
- transformer une ressemblance en modèle exact.

La promotion suit toujours :

`fichier source → preuve terrain → revue → identification → intégration métier`

puis, seulement avec preuves suffisantes :

`port physique → câble démontré → relation/topologie documentée`

L'état live reste séparé.

## Sources constructeur préparées

Des références officielles sont ajoutées aux fiches quand elles existent sans écraser les choix Admin :

- Tektronix : support constructeur + références WFM7100 ;
- Wohler : liste officielle End of Life pour RM-2443W-HD et RM-3357-HD ;
- Telikou : page officielle FM-804 ;
- Riedel : famille ARTIST Intercom.

Ces sources documentent la famille ou les capacités possibles. Elles ne prouvent pas le câblage local.

## Lacunes explicitement ouvertes

Avant les prochains fichiers, les lacunes suivantes restent volontairement ouvertes :

- modèles exacts inconnus ;
- positions de baie incomplètes ;
- ports arrière non relevés ;
- câbles non tracés de bout en bout ;
- type/normalisation/mapping du patchfield ;
- crosspoints et flux live ;
- fichiers binaires des preuves Régie Car.

## Fiche 360

Pour chaque équipement Régie Car, la Fiche 360 reçoit une section `Régie Car — collecte terrain suivante` qui affiche les captures encore requises. Cette section ne modifie pas les faits techniques existants.

## Conservation des données

Phase 17 est additive :

- aucun `clear()` ;
- aucun remplacement global d'inventaire ;
- aucune écriture dans `cables` ;
- aucune création de crosspoint ;
- protection des enregistrements `admin`, `locked`, `adminLocked` ou `manualOverride` ;
- conservation de l'avancement futur du plan de capture lors des ré-exécutions.

La fusion vers `main` reste conditionnée au workflow complet `Vérification 2M TECH`.
