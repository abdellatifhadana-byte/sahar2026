# Field Evidence Intake — contrat de réception terrain

Version : 1 — 16/08/2026

## Objectif

Recevoir de nouveaux lots de photos terrain sans transformer une ressemblance, un contexte de baie ou une documentation historique en fait physique actuel.

Cette couche est volontairement générique : elle peut recevoir un futur lot d'une salle fixe, d'une installation temporaire ou d'une unité de production mobile / Régie car, sans pré-créer l'installation avant les preuves.

## États

### Revue

- `pending` : reçu, non validé ;
- `accepted` : observations explicites revues ;
- `needs-more-evidence` : photo utile mais insuffisante ;
- `rejected` : preuve non exploitable ou hors périmètre.

### Classification

- `exact-device` : constructeur/référence exacte lisibles ;
- `family-only` : famille visible, modèle exact non prouvé ;
- `function-only` : fonction visible, matériel exact non identifié ;
- `physical-context` : contexte/baie/zone uniquement ;
- `connection-observed` : liaison physique explicitement démontrée ;
- `label-only` : repère/étiquette lisible sans déduction supplémentaire ;
- `ambiguous` : plusieurs interprétations restent possibles.

## Frontière de preuve

Une photo de façade ne prouve pas les cartes internes. Une vue de baie ne prouve pas le modèle de chaque équipement. Un synoptique historique ne prouve pas l'as-built actuel. Un câble visible à une extrémité ne prouve pas sa destination. Une photo statique ne prouve jamais un crosspoint ou un routage live.

Aucune donnée reçue par l'Inbox ne crée automatiquement :

- un équipement ;
- une salle ou une baie ;
- un catalogue/model exact ;
- un port physique ;
- un câble ;
- une relation de topologie ;
- un crosspoint actif.

Une liaison `confirmed` est d'abord enregistrée comme overlay de preuve (`field_evidence_link`) avec `doesNotMutateTarget=true`. L'intégration dans le domaine métier reste une étape distincte et testable.

## Données sensibles

Les IPv4 et valeurs ressemblant à des secrets (`password`, `token`, `api key`, `secret`) sont masquées par défaut dans le texte persisté par l'Intake. La référence originale du média est conservée pour la chaîne de preuve.

## Checklist photo — unité de production mobile

Pour maximiser l'identification sans inventer :

1. contexte extérieur ;
2. vues générales intérieures ;
3. chaque rack de face, du haut vers le bas ;
4. chaque rack arrière si l'accès est sûr ;
5. étiquette/référence lisible de chaque équipement ;
6. patch panels, matrices, routeurs et zones de raccordement ;
7. repères de câbles aux deux extrémités quand ils sont visibles ;
8. vues séparées des zones vidéo, audio, synchronisation, intercom et réseau quand elles existent visiblement.

La checklist décrit **quoi photographier** ; elle n'affirme pas à l'avance que ces sous-systèmes existent dans une Régie car donnée.

## Flux d'intégration

`média brut → staging Intake → revue humaine/technique → classification → lien de preuve confirmé → intégration métier spécialisée → tests → main`

Ce flux conserve la distinction entre preuve, interprétation et état opérationnel.
