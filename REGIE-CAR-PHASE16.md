# Phase 16 — Régie Car · inventaire terrain additif

Date : 16/08/2026

## But

Ajouter les équipements visibles dans le premier lot photo de la Régie Car **sans remplacer ni réinitialiser aucune donnée déjà présente dans 2M TECH**.

La stratégie est volontairement différente d’un import complet : il s’agit d’un seed terrain additif, idempotent et protégé contre l’écrasement des données Admin/manuelles.

## Ce qui est ajouté

- 1 salle mobile : `Régie Car` ;
- uniquement les baies dont le numéro est lisible dans les photos : `BAIE 1`, `BAIE 2`, `BAIE 9`, `BAIE 10`, `BAIE 11`, `BAIE 12` ;
- 18 références de preuve terrain correspondant au lot photo ;
- 14 fiches catalogue nouvelles/complémentaires ;
- 49 instances d’équipement ou observations d’instance, dont 12 VTR Sony provisoires comptés visuellement et laissés sans modèle exact ;
- aucun câble, port arrière ou crosspoint créé automatiquement.

## Modèles exacts lisibles dans le lot

- Sony HSCU-300 — quatre CCU visibles ;
- Sony RCP-1500 — cinq panneaux CAM1 à CAM5 ;
- Sony MSU-1000 ;
- Tektronix TG8000 — TG1 et TG2 ;
- Tektronix ECO422D ;
- Tektronix WFM 7100 ;
- Wohler RM-2443W-HD ;
- Wohler RM-3357-HD ;
- Wohler AMP1A-LP10S ;
- EVS nano / Remote LSM — une instance REMOTE LSM 2 ;
- Harris Panacea avec repère local `32x8 COP` ;
- Telikou FM-804 Matrix Control Unit.

Les panneaux Riedel Artist, les panneaux Harris CTRL/VTR/LSM/GR SEC, les VTR Sony, le grand patchfield et plusieurs unités Sony restent au niveau famille/contexte lorsque le modèle exact n’est pas lisible.

## Conservation des données existantes

`ensureRegieCarPhase16()` :

1. n’appelle jamais un remplacement global d’inventaire ;
2. ne vide aucun store IndexedDB ;
3. recherche d’abord les entités existantes via clé terrain stable, ID ou identité locale ;
4. protège tout record `admin`, `locked`, `adminLocked` ou `manualOverride` ;
5. sur un record déjà présent, complète uniquement les champs vides et fusionne les références de preuve ;
6. ne remplace jamais une valeur utilisateur non vide par une valeur du seed Phase 16.

Ainsi, les salles, baies, équipements, tickets, câbles, murs, écrans, diagnostics et autres données déjà présentes restent intacts.

## Frontière de preuve

- une façade lisible peut confirmer un constructeur/modèle ;
- elle ne confirme pas les cartes/options internes ;
- elle ne confirme pas les ports arrière réellement câblés ;
- un patchfield visible ne produit pas de relation de câble sans repères aux deux extrémités ;
- aucune photo statique ne produit un crosspoint live ;
- les 12 VTR Sony sont des instances provisoires basées sur le comptage visuel de façades distinctes et devront être réconciliées avec leurs labels/modèles individuels quand des gros plans seront disponibles.

## Médias

Les 18 photos sont référencées dans la chaîne de preuve avec des IDs `regiecar-2026-08-16:01..18`. Leur compression/pack binaire PWA est volontairement séparé du seed d’inventaire ; tant que ce pack n’est pas intégré, les métadonnées restent utilisables et les photos ne sont jamais confondues avec `equipment.images[]` ou une photo constructeur.

## Références constructeur utilisées pour les fiches techniques

- Sony HSCU-300 : Sony Professional ;
- Sony RCP-1500 : Sony Professional ;
- Sony MSU-1000 : Sony Professional ;
- EVS LSM : documentation/tutoriels EVS ;
- Wohler AMP1A-LP10S : liste End-of-Life officielle Wohler ;
- Harris Panacea : archives officielles Imagine Communications / Harris Broadcast.

Les informations constructeur servent à expliquer la fonction et les interfaces possibles du modèle ; elles ne sont jamais utilisées pour prétendre qu’un port donné est câblé dans cette Régie Car sans preuve arrière/terrain.
