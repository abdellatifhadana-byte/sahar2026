# État d'intégration 2M TECH — 16/08/2026

Branche de production : `main`.

## Architecture canonique active

`Room → Wall ← Screen.wallId`

avec `Screen.equipmentId` optionnel et `ScreenGroup.screenIds[]` indépendant.

Le dossier `LEGACY-ROOT/` et `SOURCE-WALLS/` conserve les sources historiques non chargées par l'application.

## Grille Centrale — état atteint

- architecture physique prudente : `BAIE GR-1 Inputs → Harris Platinum legacy → BAIE GR-2 Outputs`, avec GR-3 Control/Sync et Monitoring séparés ;
- plan documentaire du synoptique LTS MAROC / GC 2M du 31/08/2012 intégré sans le confondre avec l'as-built actuel ;
- matrice documentaire : `190 entrées × 184 sorties` ;
- 374 ports logiques déterministes ;
- Monitoring conservé hors matrice ;
- aucun crosspoint actif créé ou inféré ;
- checklist as-built : 387 cibles de vérification terrain, qui restent à confirmer tant qu'une preuve actuelle explicite n'existe pas.

## Preuves terrain — chaîne de confiance

La plateforme distingue désormais quatre niveaux :

1. document/design historique ;
2. photo/preuve terrain observée ;
3. as-built actuel explicitement vérifié ;
4. état live/routing, jamais déduit d'une photo statique.

Les photos existantes de baies/familles restent séparées des photos constructeur et des photos d'instance. Une identification ambiguë reste ambiguë.

## Intake générique des futurs lots photo

Une Inbox générique de preuves terrain est disponible pour les futurs lots, y compris les unités de production mobiles :

- staging par lot, source, date, type de capture et référence média ;
- revue `pending / accepted / needs-more-evidence / rejected` ;
- classification exacte/famille/fonction/contexte/connexion/ambiguë ;
- masquage par défaut des IP et secrets visibles dans le texte persisté ;
- aucune promotion automatique vers équipement, salle, baie, câble, topologie ou crosspoint ;
- aucune promotion automatique d'un modèle exact à partir d'une ressemblance.

## Régie Car — inventaire terrain actuel

La Régie Car n'est plus une hypothèse générique : les preuves déjà reçues ont produit une couche d'inventaire dédiée, strictement additive.

Phase 16 apporte :

- salle mobile `Régie Car` ;
- uniquement les baies dont le numéro est lisible : BAIE 1, 2, 9, 10, 11 et 12 ;
- 18 références de preuve terrain ;
- 14 fiches catalogue nouvelles/complétées ;
- 49 instances/observations d'équipement ;
- modèles exacts seulement lorsque la référence est lisible ;
- familles/observations provisoires lorsque le SKU ou la localisation reste incertain ;
- aucune création automatique de port arrière, câble ou crosspoint.

## Régie Car — préparation avant les prochains fichiers

Phase 17 prépare tout ce qui peut l'être sans disposer encore des nouveaux fichiers image :

- deux observations visibles de la preuve 09 qui n'avaient pas encore d'instance dédiée sont ajoutées prudemment : `Routeur 4×1 HD — modèle à confirmer` et `SW3.R100 — switch réseau, modèle à confirmer` ;
- le blueprint Régie Car atteint 51 instances connues/provisoires ;
- un plan documentaire stable `field-capture-plan:regie-car` prépare les futures captures pour chaque baie et chaque équipement ;
- chaque équipement demande au minimum une photo d'étiquette et une photo arrière ;
- tout modèle incertain demande aussi une façade rapprochée ;
- les instances provisoires sans baie sûre demandent une vue de contexte ;
- le patchfield demande une vue complète et une première trace câble démontrée de bout en bout ;
- les lacunes `modèle / position / ports / câbles / patch / live-routing / binaires média` restent explicites ;
- la Fiche 360 affiche les captures attendues sans modifier les faits existants ;
- les sources constructeur Tektronix, Wohler, Telikou et Riedel sont préparées comme références documentaires, jamais comme preuve de câblage local.

Les fichiers binaires Régie Car restent volontairement `awaiting-source-files` jusqu'à réception/matérialisation des images source. Les références de preuve existantes ne sont pas transformées en photos constructeur.

## Conservation

Les phases Régie Car respectent la priorité des données existantes :

- aucun `clear()` de store ;
- aucun remplacement global de l'inventaire ;
- aucune suppression de tickets, câbles, murs, écrans, diagnostics, notes, utilisateurs ou paramètres ;
- les enregistrements `admin`, `locked`, `adminLocked` et `manualOverride` restent prioritaires ;
- une ré-exécution enrichit les champs vides et conserve les références/progrès déjà validés.

## Vérification

Toute promotion vers `main` reste conditionnée au workflow complet `Vérification 2M TECH` : contrats, graphe des modules actifs, syntaxe JavaScript, fichiers critiques, serveur/API locale et PostgreSQL (isolation, sécurité, remplacement inventaire).
