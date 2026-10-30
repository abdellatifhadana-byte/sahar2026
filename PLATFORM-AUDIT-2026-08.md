# Audit complet de la plateforme 2M TECH — août 2026

Audit conduit **en exécutant réellement la plateforme** : serveur Node, PostgreSQL 16,
navigateur Chromium, les 4 rôles, les 19 sections. Aucun fichier applicatif n'a été modifié.

Chaque constat porte une marque :

- **[PROUVÉ]** — reproduit en exécutant la plateforme et mesuré directement.
- **[TRACÉ]** — suivi ligne à ligne dans le code, sans exécution.

## Note méthodologique

Les 408 tests du dépôt passent tous. Ce sont des tests de *contrat textuel*
(`grep -q "Mur d'images" admin-ui.js`), pas de comportement — ils n'ont détecté aucun
des défauts ci-dessous. C'est le résultat le plus important de cet audit.

## Ce qui fonctionne bien

Le serveur (`scripts/serve.js`, `scripts/access-control.js`) fait correctement son travail —
c'est une vraie force de la plateforme :

- Câble vers un équipement inexistant → **rejeté** (`La source du câble est introuvable`).
- Nœud de schéma vers une entité inexistante → **rejeté**.
- Écriture directe de ticket hors workflow → **rejetée** (409).
- Suppression d'un équipement référencé par un câble → **bloquée**.
- Suppression d'une salle/baie non vide → **bloquée**.
- Unicité du nom d'utilisateur, invariant sur l'admin global, zones sur lecture ET écriture.
- Les 19 sections se chargent sans aucune erreur JavaScript ni requête en échec.

---

## CRITIQUE

### C-01 — Trois vocabulaires de statut concurrents : le tableau de bord affiche 0 en permanence [PROUVÉ]

Base propre, 51 équipements semés. Le tableau de bord affiche :

```
51  Équipements
 0  Équipements actifs      ← réalité : 21 « Opérationnel »
 0  En maintenance
 0  En panne
```

Valeurs réelles contre valeurs cherchées :

```
status  = "Opérationnel — état actuel à confirmer" (21), "À vérifier" (30)
statut  = "À vérifier" (51)

dashboard.js:24   ⟵ ['actif','active']             → 0
dashboard.js:25   ⟵ 'maintenance'                  → 0
dashboard.js:26   ⟵ ['hors-service','faulty','hs'] → 0
equipements.js:51 ⟵ 'Opérationnel'|'Maintenance'|'Hors service' → 0 ligne
```

**Impact** : toutes les tuiles à zéro, graphique « État des équipements » vide, et le
filtre Statut de la page Équipements ne renvoie **jamais** de résultat, quelle que soit
l'option choisie.

**Correctif** : choisir `status` comme champ unique avec un vocabulaire unique, migrer une
fois, et faire écrire ce champ par l'éditeur.

### C-02 — Le changement de statut par l'admin n'atteint ni le tableau de bord ni les rapports [PROUVÉ]

Édition réelle via l'interface, statut → « Maintenance », enregistrement réussi :

```
Équipement : "CCU 1 — Sony HSCU-300"
statut  → "Maintenance"                            ✓
status  → "Opérationnel — état actuel à confirmer"  ✗ inchangé

Page Équipements, filtre Maintenance → le trouve   ✓
Tableau de bord, « En maintenance »  → 0           ✗
Rapports, « Équipements en anomalie » → 0          ✗
```

`equipment-editor-service.js:47` écrit `statut` et ne touche jamais `status`.

**Impact** : un équipement en maintenance n'apparaît dans aucun indicateur de pilotage.
C'est la démonstration la plus nette que l'action de l'admin ne se propage pas.

### C-03 — Les paramètres de la plateforme n'atteignent aucun utilisateur non-admin [PROUVÉ]

Session technicien réelle, après synchronisation :

```
settings/global = { autoLogout: 30, localFallback: true }   ← valeur fabriquée
mapImageUrl     = undefined                                  ← jamais transmise
authoritativeStores contient "settings" → le store local est vidé toutes les 20 s
```

`access-control.js:343` refuse la lecture de `settings` aux non-admins ;
`central-sync.js:140` vide le store ; `central-sync.js:165` fabrique un repli constant.

**Impact** : le délai de déconnexion automatique réglé par l'admin (contrôle de sécurité)
reste à 30 min pour tout le monde. Le nouveau plan technique n'est visible que par l'admin.
Un message « modification(s) rejetée(s) » apparaît à chaque connexion non-admin.

**Correctif** : rendre `settings/global` lisible par tout utilisateur authentifié et
supprimer le repli fabriqué.

### C-04 — XSS stocké exécuté dans l'interface admin via la recherche globale [PROUVÉ]

```
Nom d'équipement : XSSPROBE<img src=x onerror="window.__XSS_FIRED=true">
Après recherche  : window.__XSS_FIRED === true    ← code exécuté
```

`admin-ui.js:355` et `admin-ui.js:362` injectent la requête et le nom de l'entité dans
`innerHTML` sans échappement. Les autres surfaces échappent correctement
(`tickets.js:250`, `operations-suite.js:277`) — celle-ci est l'exception.

Faille jumelle : `interactive-map.js:762-765, 840-841` injecte noms et images de salles et
baies sans échappement, visible jusqu'au rôle Visiteur.

### C-05 — Les ports ajoutés dans l'éditeur d'équipement sont perdus silencieusement [PROUVÉ]

```
Ports dans le panneau avant enregistrement : 1
Ports réellement persistés                 : 0
```

Collision de deux gestionnaires : `broadcast-ports-cables.js:118` installe un `onsubmit`
qui écrit `data.ports` ; `equipment-editor-service.js:116` le **remplace** par un
gestionnaire dont la charge utile ne contient aucune clé `ports`.

**Impact** : documenter les ports est impossible par le chemin principal — ce qui explique
le « Équipements avec ports documentés : 0 % (0/51) » affiché par la page Rapports. Sans
ports, pas de câbles, donc Câbles / Flux de signal / Schémas restent vides.

### C-06 — Clés étrangères à NaN : l'équipement disparaît de sa salle et de sa baie [PROUVÉ]

```
Identifiants réels : "room-regie-car", "regie-car-baie-1"   (100 % textuels)

Après enregistrement par l'éditeur principal :
  roomId → NaN
  baieId → NaN
```

`broadcast-ports-cables.js:123-124` applique `Number(data.roomId)` ;
`normalizeRelationId` ne rattrape pas `NaN`.

**Impact** : l'équipement est « enregistré » puis disparaît de la salle, de la baie, de la
carte et du parcours visiteur, sans aucun message. Ce n'est pas un cas limite : toutes les
salles et baies de ce déploiement ont un identifiant textuel.

### C-07 — La suppression d'une salle avec son contenu n'est pas atomique [TRACÉ]

`room-deletion.js:21-85` ne pré-valide que les dépendances des écrans, puis exécute une
séquence sans transaction ni annulation : câbles → écrans → murs → équipements → baies →
salle. La suppression d'équipement peut échouer pour trois raisons non pré-validées
(châssis contenant des cartes, câble vers un composant interne, gardes de câbles).

**Impact** : écrans, murs et plusieurs équipements sont déjà supprimés définitivement quand
l'exception est levée. La salle subsiste, à moitié vidée, sans annulation possible — les
suppressions ont déjà été poussées au serveur.

### C-08 — La restauration de sauvegarde s'interrompt et perd la moitié des stores [TRACÉ]

`backup-service.js:29-32` : boucle sans `try/catch`, `tickets` en 10ᵉ position, et le
serveur refuse toujours l'écriture de tickets (409, `serve.js:1668`).

**Impact** : tout ce qui suit — `notes, docs, faq, notifications, logs, attachments,
cables, cable_reports, settings` — n'est jamais restauré. Schémas, procédures de
continuité, base de connaissances et câbles sont perdus, avec un seul message d'erreur.

Plus grave : les sauvegardes n'incluent pas `zones`, `zone_memberships`, `zone_grants`,
qui vivent en PostgreSQL hors des stores de synchronisation. Une restauration après
sinistre rend les données et **perd toute la carte des droits**.

### C-09 — Les droits de zone accordés par l'admin sont sans effet dans l'interface [TRACÉ]

L'interface « Accès zones » propose d'accorder `equipment.edit` à un technicien ; le
serveur l'accepte et l'honore (`access-control.js:24, 210`). Le client refuse
inconditionnellement : `permissions.js:42` fixe `technician.equipments.edit = false`, puis
`entity-permission-integration.js:45` retire les boutons du DOM.

**Impact** : l'admin accorde un droit qu'il croit actif ; le technicien ne voit aucun
bouton. Aucun message. **Deux systèmes d'autorisation parallèles qui se contredisent.**

### C-10 — Carte : le glisser-déposer et le redimensionnement utilisent la mauvaise échelle [TRACÉ]

Les positions sont stockées dans un repère hérité `2000×1200`, mais
`interactive-map.js:168` lit l'échelle de la scène (image → écran), pas celle du repère
hérité. Facteur manquant : `W/2000` en x, `H/1200` en y. Avec l'image par défaut
`1280×720` : 0,64 et 0,60.

**Impact** : glisser un équipement de 100 px le déplace d'environ 156 px en x et 167 px en
y — le marqueur fuit le curseur, en biais puisque les deux échelles diffèrent. Les
coordonnées fausses sont ensuite enregistrées. Preuve qu'il s'agit d'un bug et non d'un
choix : `eventToCanvasPoint`, dans le même fichier, convertit correctement.

---

## ÉLEVÉ

### H-01 — Le technicien accède au Journal et peut le vider [PROUVÉ]

```
#/logs → "Journal des événements | Exporter | Importer | Vider"
```

Alors que `permissions.js:46` pose `technician.logs = {view:false, export:false, clear:false}`.
`navigation-contract.js:5` inclut `logs` dans les routes technicien et `logsSection.js`
ne contient aucun contrôle de permission. « Importer » permet d'injecter des entrées
falsifiées, « Vider » efface le journal. Responsable et Visiteur sont correctement redirigés.

### H-02 — Équipements orphelins acceptés : aucune validation des clés étrangères [PROUVÉ]

```
équipement avec baieId/roomId inexistants → ACCEPTÉ   ✗
câble vers un équipement inexistant       → REJETÉ    ✓
nœud de schéma vers une entité inexistante → REJETÉ   ✓
```

Asymétrie nette : câbles et schémas sont protégés à l'écriture, les équipements non. La
page Intégrité *détecte* ensuite (« Équipements orphelins · 1 ») mais ne prévient pas et
n'offre aucun bouton de correction — son seul bouton est « Relancer le contrôle ».

### H-03 — Deux champs par concept, et les lecteurs ne s'accordent pas [PROUVÉ]

Mesuré sur 59 équipements réels : `name` **et** `nom` coexistent (51 enregistrements),
comme `status` et `statut`.

| Concept | Noms concurrents | Conflit |
|---|---|---|
| Nom | `name` · `nom` | écrivains incohérents, lecteurs tolérants via `\|\|` |
| Statut | `status` · `statut` · `state` | **vocabulaires différents — cause de C-01** |
| N° de série | `numSerie` · `serialNumber` | index `db.js:42` sur le second, écriture sur le premier |
| Référence polymorphe | `relatedId` · `targetId` · `entityId` · `idElement` | trois index sur trois noms |
| Type de cible | `'equipment'` · `'equipments'` · `'device'` | singulier/pluriel selon le fichier |
| Extrémités de câble | `sourceId` · `sourceEquipmentId` · `connectedFrom` | **trois schémas (H-07)** |
| Image | `image` · `imageUrl` | double lecture partout |

**Impact** : les index déclarés ne sont que partiellement peuplés. `visitor-ui.js:145` est
le seul à lire par index — le visiteur peut donc voir une salle vide que l'admin voit pleine.

### H-04 — Les nœuds de schéma figent une copie du nom [TRACÉ]

`diagram-studio-advanced.js:202` stocke `label` à l'insertion et ne le re-résout jamais à
l'affichage (`:78`). Les ports sont résolus en direct, le nom non.

**Impact** : renommer un équipement laisse tous les schémas afficher l'ancien nom, tandis
que le panneau de détail affiche le nouveau — **deux noms pour le même équipement sur le
même écran**. Contraire à la règle du dépôt (`PHASE19_PLATFORM_AUDIT.md:55`).

### H-05 — Les tickets survivent à la suppression de l'entité référencée [TRACÉ]

`db.js:124-126` : ni `deleteRoomSafely`, ni `deleteBaieSafely`, ni `deleteEquipmentSafely`
ne consultent `tickets` (seul `deleteScreenSafely` le fait). Côté serveur,
`ensureResourceDeletable` (`serve.js:546-576`) ne vérifie jamais `tickets` non plus.

De plus `relatedName` (`serve.js:1181`) est un instantané figé à l'écriture : renommer
l'équipement laisse tous les tickets existants afficher l'ancien nom.

### H-06 — Flux de signal : topologie textuelle parallèle contredisant le graphe canonique [TRACÉ]

`signal-flow.js` ne lit jamais le store `cables`. Un chemin ne requiert que deux chaînes
libres (`sourceLabel`/`destinationLabel`) ; `cableRefs` n'est jamais résolu contre un câble réel.

```
Page Flux de signal → buildSignalGraph    → trace toujours une arête ✓ « Documenté »
Mode Impact carte   → buildTechnicalGraph → aucune arête             ✗

technical-graph.js:180 est la seule boucle sans graph.unresolved.push(...)
  → l'écart n'est même pas compté dans l'indicateur « références non résolues »
```

**Impact** : la plateforme donne deux réponses assurées et contradictoires sur le même
chemin de signal, sans aucun avertissement.

### H-07 — Trois schémas de câble différents dans un seul store [TRACÉ]

1. **Canonique** — `broadcast-relations.js:209` : `sourceType`/`sourceId` + ports.
2. **Mort** — `broadcast-ports-cables.js:157` (`CableInventory`) instancié puis remplacé
   à la ligne suivante par un autre fichier. Inatteignable, mais laisse croire à deux
   schémas supportés.
3. **Dangereux** — `screens-diagnostic.js:949` écrit `connectedFrom`/`connectedTo`, sans
   type ni ports. **Aucune garde de suppression ne le voit** : l'équipement est supprimé en
   silence et le câble reste pendant. Son id est du texte libre, donc réutiliser un id
   existant écrase un vrai câble.

### H-08 — Position d'écran stockée deux fois ; le Diagnostic lit la copie périmée [TRACÉ]

La création écrit `position` **et** `positionX/Y/width/height` (`wall-manager.js:291`),
mais tout déplacement ultérieur ne met à jour que `position`. Or
`screens-diagnostic.js:213` dessine à partir de `positionX`.

**Impact** : déplacer un écran sur le Mur d'images ne se reflète pas dans Diagnostic
Écrans — le technicien est envoyé au mauvais emplacement physique.

### H-09 — Les liens profonds sont tronqués [PROUVÉ]

```
#/devices/1  →  réécrit immédiatement en  #/devices
                l'équipement 1 n'est jamais ouvert
```

`admin-ui.js:215` reconstruit le hash à partir du seul nom de section. Impossible de
partager un lien vers un équipement, un ticket ou un schéma précis. Le parcours technicien
gère correctement l'identifiant (`role-navigation-integration.js:167`) — le défaut est
propre à l'interface admin.

### H-10 — Un contrôle textuel prive « responsible » de ses droits [TRACÉ]

`equipements.js:26` teste `['admin','manager','responsable']` — la valeur canonique
`'responsible'` est absente. Or `users.js:334` enregistre tout nouveau responsable avec
l'orthographe canonique.

**Impact** : tout responsable créé après la normalisation des rôles perd les boutons
Ajouter / Modifier / Supprimer de la page Équipements — un droit que la matrice, le
serveur et l'interface d'octroi lui accordent tous. Seuls les comptes hérités orthographiés
`'responsable'` fonctionnent.

### H-11 — Un admin peut se verrouiller hors de la plateforme [TRACÉ]

`users.js:328` n'empêche pas un admin de changer son propre rôle ni de désactiver son
compte, et il n'existe aucun contrôle « dernier admin ». Le serveur ne protège que
l'enregistrement `id=1` (`serve.js:1104`). Le changement de rôle incrémente `authVersion`,
ce qui invalide la session immédiatement.

### H-12 — Tout technicien peut diffuser une notification à toute la plateforme [TRACÉ]

`access-control.js:344` ignore l'argument `action` — son verdict vaut donc aussi pour
l'écriture — et accepte tout enregistrement avec `userId == null`. Un
`PUT /api/data/notifications/999` avec `{userId:null, title:"…"}` depuis une session
technicien est accepté et distribué à tous via `/api/sync`. Aucune interface ne le propose,
mais le point est ouvert.

### H-13 — Le Journal n'est pas une piste d'audit [TRACÉ]

**4 emplacements seulement** écrivent dans le journal. Ne sont jamais consignés : création,
modification et suppression d'utilisateurs, changements de mot de passe, tout le CRUD des
équipements / salles / baies / câbles, les changements de paramètres, les
sauvegardes/restaurations, et la purge du journal elle-même.

Le journal est **effaçable en un clic** et **falsifiable** via « Importer ». Ses
identifiants `Date.now()` (`logs.js:25`) entrent en collision entre deux utilisateurs dans
la même milliseconde, chacun écrasant l'autre globalement. L'audit serveur est écrit dans
`access_audit`, un store sans aucun point de lecture — donc jamais visible.

### H-14 — Synchronisation « dernier écrivain gagne » avec purge complète toutes les 20 s [TRACÉ]

`central-sync.js:346` resynchronise toutes les 20 s ; `:140` vide les 19 stores puis les
réécrit. L'écriture serveur est un `INSERT … ON CONFLICT DO UPDATE` sans comparaison de
version ni d'`updatedAt`.

**Impact** : deux utilisateurs sur le même équipement — le second écrase l'IP saisie par le
premier depuis un formulaire périmé, sans avertissement. Pour les éditions hors ligne, le
store est vidé *avant* le drainage de la file : si la poussée est rejetée, l'enregistrement
reste perdu localement avec un simple avertissement, et aucun écran ne liste les
modifications rejetées.

### H-15 — Les écritures de logs/notes en 403 avortent l'opération d'origine [TRACÉ]

Logs et notes sans zone résoluble sont rejetés (`access-control.js:351`),
`central-sync.js:195` relance l'exception, et les appels ne sont pas entourés de `try/catch`.

**Impact** : le technicien termine un diagnostic d'écran ; le diagnostic est enregistré
puis l'exception est levée à la journalisation — ni message de succès ni rafraîchissement,
l'interface paraît figée. Idem pour le « Cahier de passation » d'Exploitation : la
transmission de vacation est écrite puis supprimée, sans notification, alors que le texte
affiché promet qu'elle « reste disponible pour le shift suivant ».

### H-16 — `/api/sync` en O(lignes × scans complets) pour chaque non-admin, toutes les 20 s [TRACÉ]

`serve.js:1545` sélectionne toute la table, puis `canAccessRecord` déclenche un SELECT
complet de `resource_zones` **par enregistrement**, plus les listes d'adhésions et d'octrois
par zone. Les admins court-circuitent ; tous les autres paient le coût plein.

---

## MOYEN (extraits)

- **M-01** — `navigation-contract.js:4` ne liste que 16 routes admin ; `exploitation`,
  `knowledge` et `zoneAccess` manquent. La navigation fonctionne (elle passe la liste
  vivante), mais tout appelant direct de `allowedSectionsForRole('admin')` — par exemple
  `equipment-context-actions.js:23` — travaille sur une liste incomplète.
- **M-02** — Trois implémentations concurrentes de `applyRoleTheme` (`core.js:65`,
  `auth.js:131`, `compat-integrations.js:13`). Celle de `core.js` gagne et traite
  `'responsable'` comme `theme-admin` alors que `'responsible'` reçoit `theme-responsible`
  — même rôle canonique, deux thèmes. Et `.theme-admin` n'est défini nulle part dans `main.css`.
- **M-03** — Même indicateur calculé différemment dans quatre fichiers : « équipement en
  panne » (`rapports.js:8` vs `dashboard.js:26` vs `operations-suite.js:64`) et « tickets
  ouverts » (liste noire de 6 statuts vs aucun filtre vs liste blanche de 3).
- **M-04** — `serve.js:1168` stocke la priorité sous `prio` ; `operations-suite.js:73` lit
  `priority` — la priorité affiche toujours « — » dans Exploitation.
- **M-05** — `notifyAllUsers` (`tickets.js:339`) n'atteint personne : le seul gestionnaire
  enregistré est un stub vide (`events.js:105`).
- **M-06** — `events.js:140` et `core.js:46` appellent tous deux `setupCoreEvents()` :
  `reload-application` a 3 gestionnaires, donc 3 rechargements après une restauration.
- **M-07** — `backupFrequency` n'est lu par aucun ordonnanceur ; `core.js:50` code
  `'weekly'` en dur.
- **M-08** — `setupAutoLogout` (`system-settings.js:67`) arme un minuteur que l'activité de
  l'utilisateur ne réinitialise jamais : l'admin est déconnecté en pleine saisie.
- **M-09** — Deux liaisons Ctrl+K concurrentes ; celle d'Exploitation (capture +
  `preventDefault`) gagne toujours, la recherche d'en-tête est inatteignable au clavier.
- **M-10** — `data-integrity.js:47` ne sait pas résoudre `entityRef.type === 'cable'` :
  ajouter un câble à un synoptique rend le rapport d'intégrité invalide en permanence.
- **M-11** — Un port est supprimé sans contrôle si l'on vide son numéro
  (`broadcast-ports-cables.js:125`), contournant la vérification des câbles liés.
- **M-12** — `cables.roomId` est dénormalisé et jamais maintenu : déplacer une baie vers
  une autre salle laisse ses câbles pointer l'ancienne, qui les supprimera.

---

## Code mort et trompeur

Ces points ne cassent rien aujourd'hui, mais rendent tout correctif futur risqué — un
développeur peut corriger un fichier qui ne s'exécute pas.

- **11 modules inatteignables** : `api.js`, `backup-manager.js`, `core2.js`, `docs.js`,
  `faq.js`, `map-digital-twin-contract.js`, `search.js`, `sync-manager.js`,
  `tech-dashnoard.js` (faute de frappe dans le nom), `tech-motivation.js`, `utils.js`.
  Plusieurs **échoueraient à l'import** (symboles inexistants) et certains figurent pourtant
  dans le pré-cache de `service-worker.js`.
- `diagram-studio.js:200-213` est entièrement masqué par `diagram-studio-advanced.js:163`,
  qui remplace la méthode sans appeler la précédente — **tout correctif appliqué là n'aura
  aucun effet**.
- ~200 lignes de CRUD d'équipement dans `interactive-map.js` sont neutralisées par des
  écouteurs en phase de capture. Si un pont ne se charge pas, le chemin mort se met à écrire
  des identifiants textuels `eq-<timestamp>` et corrompt l'espace de clés.
- `map-digital-twin-contract.js` est un doublon mort **qui a déjà divergé** sur `finite` —
  et c'est la copie morte qui est correcte : la vivante compte `null` comme position valide
  et annonce 100 % de couverture alors que les marqueurs manquent.
- `security.js:23` — la condition `db.db.logs.add` n'est jamais vraie : la fonction de
  journalisation est inopérante depuis son écriture.
- `db.js:5` déclare la version 14, `db-migration-v15.js` la porte à 15 au chargement. Cela
  ne tient que par l'ordre de chargement ; tout point d'entrée important `db.js` seul
  échouera en `VersionError`.

---

## Ordre de correction recommandé

Classé par impact ÷ coût, non par sévérité seule.

1. **Unifier le champ de statut** — un seul champ, un seul vocabulaire, une migration.
   Corrige C-01 et C-02 : les deux défauts les plus visibles, pour un correctif réduit.
2. **Rendre `settings/global` lisible par tous les authentifiés** et supprimer le repli
   fabriqué (`central-sync.js:165`). Corrige C-03.
3. **Échapper les sorties** dans `admin-ui.js:355,362` et les panneaux de
   `interactive-map.js`. Deux lignes ferment C-04.
4. **Réparer les deux chemins d'enregistrement d'équipement** : lire `panel.currentPorts()`
   dans le gestionnaire canonique, remplacer `Number()` par `normalizeRelationId`. Corrige
   C-05 et C-06 et débloque câbles et schémas.
5. **Unifier l'autorisation** : dériver la matrice client des plafonds serveur, faire
   croiser rôle et octroi de zone par `PermissionManager.check`, supprimer tous les
   contrôles textuels. Corrige C-09 et H-10.
6. **Rendre la suppression de salle atomique** (C-07) ; corriger la restauration partielle
   et étendre la sauvegarde aux zones et octrois (C-08).
7. **Une vraie piste d'audit** : journal non supprimable côté client, journalisation sur le
   chemin d'écriture générique du serveur, exposition d'`access_audit` (H-13).
8. **Nettoyage** : supprimer les 11 modules morts, `CableInventory`, le formulaire de câble
   de `screens-diagnostic.js`, et purger la liste de `service-worker.js`.

## Recommandation sur les tests

Ajouter un test *comportemental* par défaut critique ci-dessus — par exemple : « après
avoir mis un équipement en Maintenance, le tableau de bord doit afficher 1 ». Un seul test
de ce type aurait empêché C-01 et C-02, pour un coût bien inférieur à 408 tests textuels.
