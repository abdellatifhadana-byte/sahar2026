# Phase 18 — Carte 2M TECH / Jumeau opérationnel

## Audit de la page existante

La carte historique reste la source de navigation et d'édition géométrique. L'audit a identifié plusieurs faiblesses réelles à corriger sans dupliquer les stores ni casser les workflows existants :

- menu contextuel Admin référencé par `interactive-map.js` mais non créé dans la page active ;
- variable historique `contextMenuVisible` attendue par le runtime ;
- comparaison stricte de certains IDs transitant par `data-id`, problématique pour les IDs IndexedDB numériques ;
- recherche simple, sensible aux accents, sans classement, localisation, état ni ticket ;
- résultats de recherche construits historiquement par HTML concaténé ;
- hotspots non accessibles au clavier ;
- drag historique uniquement souris ;
- affichage historique de l'état d'un équipement réduit à `faulty` ou `Opérationnel`, donc trompeur pour `À vérifier`, maintenance, état inconnu, etc. ;
- image de secours baie historique `assets/baie-default.jpg` absente du dépôt ;
- absence de légende, de couches, de couverture des positions et de visibilité des éléments à confirmer ;
- absence de vue unifiée entre carte, tickets, câbles, topologie et preuves ;
- modifications de positions pouvant être quittées sans avertissement explicite ;
- écran de bienvenue affiché à chaque ouverture ;
- aucun mode d'analyse d'impact cartographique.

Phase 18 corrige ces points par une couche additive dédiée. `interactive-map.js` n'est pas remplacé et continue d'assurer la navigation et les workflows métier existants.

## Nouveau Centre opérationnel cartographique

La carte reçoit un panneau `Jumeau opérationnel` qui réunit sans dupliquer les données :

- taux de couverture des positions Salle / Baie / Équipement ;
- tickets actifs liés explicitement à une entité ;
- équipements en panne / état critique ;
- relations non résolues du graphe canonique ;
- éléments à positionner ;
- équipements dont l'identification terrain reste à confirmer ;
- légende de confiance ;
- couches d'affichage ;
- raccourcis de navigation et d'actualisation.

## Mode Impact — la rupture qualitative

Le Mode Impact transforme la carte d'un simple plan de localisation en **jumeau opérationnel explicable**.

Quand un équipement est sélectionné en Mode Impact :

1. le graphe canonique `PlatformEntityGraph` est construit depuis les salles, baies, équipements, écrans, câbles, documents et topologie existants ;
2. `technical-graph.traceGraph()` suit les relations documentées vers l'amont et l'aval ;
3. les équipements visibles sont colorés selon leur rôle dans l'impact ;
4. la liste indique les dépendances non visibles dans le viewport courant ;
5. les relations non résolues et incompatibilités restent comptées ;
6. aucun câble, port, signal path ou crosspoint n'est fabriqué pour compléter artificiellement le trajet.

Le Mode Impact n'est donc **pas** un moteur de routage live. Il montre ce que la base prouve actuellement et rend les trous visibles.

## Recherche intelligente locale

La recherche cartographique devient :

- insensible aux accents ;
- classée par pertinence ;
- compatible nom, modèle, marque, référence et identifiant ;
- enrichie par salle et baie ;
- enrichie par indicateurs ticket / panne / information terrain à compléter ;
- construite avec des nœuds DOM et `textContent`, sans réinjecter les valeurs métier comme HTML arbitraire ;
- pilotable au clavier avec Flèche haut / bas, Entrée et Échap.

## Accessibilité et mobilité

- hotspots `role=button`, focusables au clavier ;
- Entrée / Espace ouvre l'élément ;
- adaptation pointer tactile/stylet vers le mécanisme de drag historique afin de conserver la même logique de coordonnées ;
- panneau responsive sur mobile ;
- prise en compte de `prefers-reduced-motion` ;
- fallback d'image technique visible lorsqu'une image de salle/baie est absente ou invalide.

## Administration

Le menu contextuel Admin est rétabli avant l'ouverture de la carte avec :

- modifier / dessiner la zone ;
- déplacer ;
- redimensionner ;
- changer l'image ;
- supprimer.

Un pont de type conserve les IDs numériques lors du passage par `data-id`, afin que le code historique utilisant encore `===` ne perde pas la référence IndexedDB.

La garde d'image persistante existante reste responsable de convertir les `blob:` temporaires avant écriture des salles/baies. Phase 18 ne crée pas un second mécanisme de média.

## Confiance / sécurité des faits

La carte ne devient jamais une nouvelle source de vérité concurrente :

- les coordonnées viennent des entités existantes ;
- les tickets viennent du store `tickets` ;
- les relations viennent du graphe canonique ;
- les preuves restent dans leurs couches Field Evidence ;
- `À vérifier` n'est plus affiché comme `Opérationnel` ;
- les inconnues restent inconnues ;
- le Mode Impact n'infère pas le routage live.

## Hors-ligne

`map-digital-twin.js` et `map-digital-twin.css` sont inclus dans le cache PWA `2mtech-v5.29`.
