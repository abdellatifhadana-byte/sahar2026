# Conception d'architecture — trois chantiers

> Statut : **propositions à valider**. Rien n'est implémenté.
> Complète `MASTER-AUDIT-STATE.md` (constats) et `PROCEDURES-DESIGN.md` (module Procédures).

---

# A. Arborescence de localisation

`Maroc → Région → Ville → Site/Bâtiment → Département → Étage → Salle → {Baie | Pupitre} → Équipement`

## A.1 Décision : un seul store polymorphe `locations`

Un store par niveau coûterait ~60 points d'édition contre 9, parce que chaque nom de store
doit être enregistré en 9 endroits : `db.js:33-59`, `central-sync.js:3-7`, `serve.js:38-42`,
les deux cartes de permissions `access-control.js:29-49`, `singularType`/`pluralStore`
(`access-control.js:64-85`), la garde de suppression `serve.js:546-576`, la résolution de
références (`serve.js:533,742,874`) et les listes de sauvegarde (`db.js:139`).

Deux arguments propres à ce déploiement :

- **Les niveaux ne sont pas uniformes.** La Régie Car est une unité mobile : ni bâtiment ni
  étage. Des stores fixes par niveau imposeraient des lignes vides de traversée. Un champ
  `type` plus une politique `allowedChildTypes` autorise le saut de niveau.
- **`relationship-contract.js:40-50` modélise déjà la localisation comme un `path` générique**
  de `{type,id,label,entity}`, et `locationBreadcrumb()` le joint déjà par ` › `. Le store
  polymorphe est exactement la forme que ce contrat attend.

La validation par niveau, seul avantage réel des stores séparés, s'obtient par un
`location-contract.js` — le patron que `topology-contract.js` et `connectivity-contract.js`
établissent déjà.

## A.2 Forme

`keyPath:'id'`, **sans `autoIncrement`**. Index : `parentId`, `type`, `pathKey`,
`legacyRoomId`, `legacyBaieId`.

```
{ id:'loc-room-regie-car',           // préfixe 'loc-', JAMAIS entièrement numérique
  type:'salle',                      // pays|region|ville|site|departement|etage|salle|baie|pupitre
  parentId:'loc-etage-2', name, nom, code:'B01', slug,

  // DÉRIVÉ — jamais autoritaire, toujours recalculable depuis parentId seul
  path:[...], pathKey:'/loc-pays-maroc/.../loc-room-regie-car/', depth, rootId, pathVersion,

  sortIndex, sortKey,
  image, imageUrl, rect, x_inMap, y_inMap, coordinates, addressLine, customFields,
  responsibleId,                     // lu par access-control.js:188
  zoneId, zoneIds,

  // conteneurs (type 'baie' | 'pupitre')
  containerKind:'rack'|'desk'|'wall'|'free',
  rackUnits, uNumbering:'bottom-up'|'top-down', widthInches, faces:['front','rear'],

  legacyRoomId, legacyBaieId, migratedFrom, origin, status, createdAt, updatedAt }
```

Store séparé `location_people` (`{id, locationId, userId, role, startsAt, expiresAt, status}`,
id déterministe donc upsert idempotent) — une affectation n'est pas un lieu.
`locations.responsibleId` reste en parallèle parce que `access-control.js:188-206` en dérive
automatiquement adhésions et droits de zone.

**Ce qui est dans une salle sans être un lieu** : équipement hors baie
(`equipments.locationId === <salle>`, `mount.kind:'free'`), mur (`walls.locationId`), écran
(`screens.locationId`), câble (`cables.locationId` + `locationIds[]` des deux extrémités —
ce qui remplace le `cables.roomId` jamais maintenu, M-12).

## A.3 `pathKey` — la seule primitive d'ancêtre

`pathKey` joint des **identifiants**, pas des slugs : renommer est donc O(1) et ne touche
jamais `pathKey`. Le chemin lisible est calculé au rendu, jamais stocké.

« Tout l'équipement à Casablanca », sans jointure :

```js
const prefix = byId.get('loc-ville-casablanca').pathKey;
const inCity = new Set(all.filter(l => l.pathKey.startsWith(prefix)).map(l => l.id));
const equipment = allEquipments.filter(e => inCity.has(e.locationId));
```

**Déplacement** : `parentId` ne change **pour aucun descendant** — seuls les champs dérivés
sont recalculés, en une transaction serveur. `equipments.locationId` ne change pas du tout
quand une baie change de salle, puisqu'il pointe la baie dont l'id est stable — la boucle de
réalignement par équipement de `baies.js:210-214` disparaît.

**Règle** : *ne jamais lire `path`/`pathKey` pour une décision d'autorisation.* Un cache
périmé dans une décision de droits est une faille. `zonesForLocation` parcourt `parentId`.

## A.4 Zones

Une zone correspond à une **racine de sous-arbre** (`resource_zones` avec
`resourceType:'location'`). Résolution **par ancêtre le plus proche, pas par union** — une
union signifierait qu'accorder une zone sur `Maroc` accorde le pays entier.

**Point critique (R4, vérifié)** : `resolveResourceZones` abandonne à `depth > 5`
(`access-control.js:269`) et retourne `[]`, et `[]` vaut refus (`:351`). Une arborescence à
9 niveaux parcourue récursivement produirait donc un **refus massif silencieux**, pas une
erreur. `zonesForLocation` doit itérer avec son propre plafond, sans consommer le budget de
récursion existant.

Les zones transitoires `room-<id>` sont **doublées puis rétrogradées, jamais renommées sur
place** : deux versions, jamais une.

**Problème des ancêtres dans l'instantané** : `/api/sync` supprime tout enregistrement
illisible (`serve.js:1552`). Un technicien recevrait la salle sans `Maroc → Casablanca → Site`,
et les fils d'Ariane afficheraient `undefined › undefined`. Solution : émettre une **souche
d'ancêtre expurgée** (`{id,type,parentId,name,path,pathKey,depth,redacted:true}`) dès qu'un
descendant est visible — même idée que `protectedDependencyStub` (`serve.js:122-136`).

## A.5 Migration — côté serveur, jamais côté client

Deux raisons fatales : `applySnapshot` (`central-sync.js:140`) **vide chaque store
autoritaire** avant de réappliquer l'instantané — un store écrit côté client serait effacé en
20 s ; et `/api/sync` est filtré par zone, donc une migration sous un non-admin migrerait un
sous-ensemble et l'instantané suivant supprimerait le reste.

Idempotence par **identifiants déterministes** (`loc-room-<roomId>`), reprise par un
enregistrement marqueur dans `docs`.

| Étape | Action |
|---|---|
| M0 | Préconditions, sauvegarde, détection des collisions d'id `1` vs `'1'` |
| M1 | Épine synthétique : `loc-pays-maroc` + `loc-site-non-classe`. **Aucune géographie n'est inventée** |
| M2 | Chaque `rooms` → `locations/loc-room-<id>`. **`rooms` intact** |
| M3 | Chaque `baies` → `locations/loc-baie-<id>`, `containerKind:'rack'` |
| M4 | Chaque `physicalZone` en `/^pupitre/i` → nœud `pupitre`. **`physicalZone` jamais supprimé** (preuve terrain) |
| M5 | `rebuildPaths()` — contrôle de cycle d'abord |
| M6 | `locationId` écrit sur equipments/walls/screens/cables. **`roomId`/`baieId` intacts** |
| M7 | Vérification : recalculer `roomId` depuis `locationId` et comparer. **Rapporter, ne pas corriger** |

Rien dans M0–M7 ne change un seul chemin de lecture existant.

**`roomId`/`baieId` restent écrits pour toujours**, seulement dérivés, et cessent d'être *lus*
au dernier incrément. Raison : ce sont de vrais index IndexedDB utilisés par
`visitor-ui.js:145-146`, et `access-control.js:275` fonde l'autorisation dessus — les
supprimer changerait la frontière de sécurité dans le même commit.

## A.6 Pupitre et position en U

`type:'pupitre'` est un frère de `baie` sous la salle ; tout le reste est partagé.
Sur `equipments` : `mount { kind:'rack-u'|'desk-slot'|'free', locationId, face, uStart,
uHeight, sectionLabel, verificationStatus }`.

`B01.RF1 · U12 · CCU 1 · OUT 04` devient un `PlaceRef` canonique
`{locationId, uStart, equipmentId, componentId, portId}`, avec `formatPlaceRef` /
`parsePlaceRef`. Validation bloquante : `RACK_SLOT_OUT_OF_RANGE`, `RACK_SLOT_CONFLICT`,
`MOUNT_LOCATION_MISMATCH`, `MOUNT_KIND_MISMATCH`. **Sans contrôle de collision l'adresse
cliquable est ambiguë**, ce qui annule tout l'intérêt.

## A.7 Risques et ordre qui les évite

| # | Défaillance | Évitée par |
|---|---|---|
| R1 | Arbre écrit côté client effacé en 20 s | Migration serveur |
| R2 | Perte partielle silencieuse | Migration serveur |
| R3 | Identifiants remplacés par des horodatages (`central-sync.js:182`, **vérifié**) | `locations` hors `AUTO_NUMERIC_ID_STORES`, ids non numériques |
| R4 | **Refus massif silencieux** (`access-control.js:269` → `[]` → refus `:351`, **vérifié**) | Cycle = anomalie bloquante ; parcours itératif à plafond propre |
| R5 | Équipement dans la mauvaise ville | `path` interdit en autorisation |
| R6 | **Régression de droits présentée comme perte de données** | `roomId` cesse d'être *lu* seulement au dernier incrément |
| R7 | Fils d'Ariane `undefined › undefined` | Souches d'ancêtres expurgées |
| R9 | Restauration reproduisant un monde plat | Listes de sauvegarde mises à jour à l'incrément 0 |
| R11 | Dérive universelle | `Number()` → `normalizeRelationId` corrigé à l'incrément 0 |

**Incréments** : 0 prérequis (correction C-06 + listes de sauvegarde) · 1 arbre écrit non lu ·
2 affichage en lecture seule · 3 édition + zones, deux modèles vivants · 4 pupitre + U ·
5 bascule des vues · 6 rétrogradation de la dénormalisation.

**Ce qu'il ne faut jamais faire** : supprimer `roomId` et introduire l'arbre dans la même
version. C'est R6, et cela se présente à l'utilisateur comme une perte de données.

---

# B. Modèle d'autorisation unifié à 6 rôles

## B.1 Constat aggravant : il y a **cinq** systèmes, pas trois

Aux trois déjà connus s'ajoutent : `navigation-contract.js:12-15`, une **quatrième** table de
normalisation de rôles indépendante de `roles.js` ; et `security.js:41-62`, un **cinquième**
système avec `ROLES = {ADMIN, TECHNICIAN, USER}` et une hiérarchie numérique qui invente un
rôle `user` — d'où le `['visitor','user']` de `operations-suite.js:185`. Son `checkPermission`
n'a **aucun appelant**, mais il est dupliqué à l'identique dans `utils/security.js` et
`utils/helpers.js`.

**Le bon patron existe déjà deux fois** : `continuity-center.js:91-109` et
`diagram-studio.js:80-99` composent correctement rôle ∧ zone. La proposition est largement
« promouvoir ce patron et supprimer le reste ».

Les deux directions cassées, confirmées :

| Direction | Preuve |
|---|---|
| Le serveur accorde, le client cache | Plafond technicien = `equipment.edit` (`access-control.js:24`) ; matrice client `equipments.edit:false` (`permissions.js:42`) |
| Le client montre, le serveur refuse | `salles.js:35` montre l'édition au responsable ; `WRITE_PERMISSION_BY_STORE.rooms = 'zone.manage'` (`access-control.js:41`), exclu du plafond responsable (`:22`) → **toute sauvegarde de salle par un Responsable échoue en 403** |

## B.2 Deux axes, pas une échelle

Lire les six rôles comme une échelle unique est précisément ce qui a produit
`manager: new Set(PERMISSIONS)`.

| Rôle | Portée (*où*) | Autorité (*quoi*) |
|---|---|---|
| **Admin** | Globale | Administration de la plateforme |
| **Manager** | Globale | Gouvernance opérationnelle |
| **Chef** | Multi-zones, par adhésion | Commandement de vacation |
| **Responsable** | Sa/ses zone(s) | Propriété technique |
| **Technique** | Zones assignées | Exécution |
| **Visiteur** | Projection publique | Consultation |

**Admin vs Manager** : ils partagent l'axe de portée (tous deux aveugles aux zones — c'est le
vrai pouvoir du Manager) et diffèrent sur l'autorité. **L'Admin décide qui existe et où sont
les périmètres ; le Manager décide ce qui s'y passe.** `zone.manage` et `users.manage` sont
la frontière.

**Chef vs Responsable** : l'autorité du Chef est **temporelle et sur des personnes** — une
vacation, à cheval sur plusieurs zones, qui expire. Celle du Responsable est **durable et sur
des actifs** — un périmètre, indéfiniment. Un Responsable RF1 n'écrit pas la passation de la
nuit ; le Chef de cette vacation ne recâble pas RF1. **Aucun ne contient l'autre.**

## B.3 Vocabulaire

**Recommandation contraire à la demande initiale** : garder l'ordre `objet.verbe`
(`equipment.read`), pas `verbe.objet`. Raison : les 26 chaînes actuelles sont **persistées
comme données** — les lignes `zone_grants` sont clées `ZG-{userId}-{zoneId}-{permission}`
(`access-control.js:391`). Renommer imposerait de réécrire chaque octroi en base et chaque
entrée d'audit, pour aucun gain sémantique. Le vocabulaire **étend** les 26 existantes
(+27 nouvelles) au lieu de les remplacer.

Marquage : `G` accordé globalement · `Z` dans le plafond mais **exige** adhésion + octroi de
zone · `O` ses propres enregistrements · `—` jamais.

Extraits significatifs :

| Permission | Admin | Manager | Chef | Resp. | Tech. | Visit. |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `users.manage` | G | — | — | — | — | — |
| `zone.manage` | G | — | — | — | — | — |
| `settings.write` / `backup.restore` | G | — | — | — | — | — |
| `equipment.edit` | G | G | — | Z | — | — |
| **`equipment.status`** (nouveau) | G | G | Z | Z | Z | — |
| **`room.edit`** (nouveau) | G | G | — | Z | — | — |
| **`exploitation.command`** (nouveau) | G | G | G | — | — | — |
| `continuity.validate` | G | G | — | Z | — | — |
| **`log.purge`** (nouveau) | G | — | — | — | — | — |
| **`catalogue.read`** (nouveau) | G | G | G | G | G | G |

Deux choix à souligner :

- **`equipment.status` est nouveau et porteur.** `permissions.js:42` donne au technicien
  `changeStatus:true`, mais le serveur route **toute** écriture équipement par
  `equipment.edit` (`access-control.js:42`). Autoriser un technicien à signaler une panne lui
  accorde donc aussi la réécriture complète de la fiche. Séparer corrige une violation du
  moindre privilège.
- **`catalogue.read` existe pour corriger le symptôme « plateforme vide »** : un Visiteur sans
  adhésion doit voir quelque chose — une projection anonymisée, sans numéros de série ni
  positions.

## B.4 Où il vit

**Un module feuille `authz-model.js`, à zéro import.** Zéro import est l'exigence dure : c'est
ce qui permet au même fichier d'être importé par Node (`serve.js`, `access-control.js`) et par
le navigateur comme module ES. Le dépôt est déjà en modules ES sans bundler.

En cas de désaccord de version : le client **ne retombe pas sur un défaut permissif** — il
passe en lecture seule et demande un rechargement. La source de désaccord réaliste est un
cache de service worker périmé, et un client périmé *permissif* est exactement la défaillance
à éviter. **La décision est toujours l'intersection** ; le serveur reste l'autorité via
`effective.permissions`.

## B.5 Composition et rendu synchrone

```
allow = ceiling(role).has(p)
        AND ( GLOBAL_ROLES.has(role) OR zoneDecision(user, p, zonesOf(record)) )

zoneDecision : zones vides → false (fail closed)
               lecture     → SOME zone
               écriture    → EVERY zone   (règle existante access-control.js:355)
```

**Réinterprétation qui corrige la direction (a)** : le plafond client doit énoncer *ce qu'un
rôle peut se voir accorder*, non ce qu'il fait par défaut. `Z` signifie exactement cela, et le
refus vient alors de l'absence d'octroi, jamais de la table des rôles.

`check(user, entity, action, record?)` retourne `{allowed, reason, missing, zones}` —
`reason` et `missing` ne sont pas décoratifs : ils permettent d'afficher « Vous n'avez pas
`equipment.edit` sur RF1 — demander l'accès » branché sur le workflow existant, au lieu d'un
bouton qui disparaît sans explication. C'est la différence entre corriger la direction (a) et
la rendre invisible.

Le rendu reste **synchrone** : la partie asynchrone tourne une fois côté serveur (les
`zoneIds` sont estampillés sur chaque enregistrement), un `ZoneIndex` est construit une fois
par section depuis `/api/access/context`, puis chaque décision par enregistrement est une
intersection d'ensembles.

## B.6 Migration sans jour J

| Étape | Contenu |
|---|---|
| M0 | Poser le modèle, **Manager reste égal à Admin**. Cesser l'alias `manager → admin` de `roles.js:10` (c'est lui qui fait rendre `AdminUI` à un Manager) |
| M1 | Reformer la matrice client en « ce qui est octroyable ». Exécuter la liste d'exécution |
| M2 | **Seule étape de données** : matérialiser en octrois explicites les capacités exercées aujourd'hui par le seul rôle. **La capacité sort du rôle avant qu'aucun plafond ne soit resserré** — personne ne perd d'accès au moment du resserrage |
| M3 | Introduire `chef` (liste déroulante + plafond). Le plafond existe **avant** que la valeur puisse être stockée, ce qui ferme le chemin fatal |
| M4 | Resserrer Manager. **Seule étape retirant une capacité.** Compte attendu : **zéro**, la liste déroulante n'a jamais proposé Manager (`users.js:95-98`) — à vérifier en production avant livraison |
| M5 | Retirer les autorités doublons (`security.js:41-62`, `navigation-contract.js:12-15`, `permissions.js:90-106`) |

**Ce qu'il advient des comptes `'manager'`** : la chaîne reste. Manager demeure un rôle
canonique de premier rang — aucune réécriture, aucune migration de données. Seul change ce
que la chaîne *accorde*, et seulement à M4.

## B.7 Liste d'exécution — 44 sites

34 côté client, 10 côté serveur. Les plus lourds :

- `serve.js:54` `isAdminRole` utilisé en **23 endroits** — à scinder en `isPlatformAdmin` vs
  `isGlobalScope`, **chaque site devant être reclassé individuellement**. C'est le plus gros
  poste de travail ; il n'existe pas de réécriture mécanique.
- `serve.js:465-466` `canWriteByRole` — **à supprimer** : autorisation par rôle seul, plus
  permissive que `canAccessRecord`, et qui s'exécute **avant** elle.
- `access-control.js:41` `rooms: 'zone.manage'` → `'room.edit'` — **cette seule ligne est la
  direction (b)**.
- `logsSection.js` — **aucun contrôle de rôle n'existe dans tout le fichier** ; `:82/:92/:114`
  branchent les gestionnaires sans garde, donc un utilisateur refusé qui atteint le DOM
  déclenche quand même `clearLogs()`.
- `screens-diagnostic.js:66-67` — **Chef et Responsable ne correspondent à aucune des deux
  branches et voient une page de diagnostic vide aujourd'hui.**
- `diagram-contract.js:166` et `continuity-contract.js:249` — validation par rôle **sans
  contrôle de zone** : un Responsable peut valider un schéma d'une zone qu'il ne possède pas.

## B.8 Garde-fous

**Dernier administrateur.** La protection actuelle est **une ligne codée en dur, pas un
invariant** : `serve.js:1104` protège l'enregistrement `id=1`. Formuler l'invariant — *au
moins un compte actif détenant `users.manage` à tout instant* — et l'appliquer
transactionnellement avec `SELECT … FOR UPDATE`. **`FOR UPDATE` n'est pas optionnel** : deux
rétrogradations concurrentes des deux derniers admins passeraient chacune un comptage non
verrouillé. Garder la règle `id=1` comme seconde ceinture indépendante.

**Auto-rétrogradation.** Interdite dans les deux sens, côté serveur. La raison est mécanique,
pas seulement de courtoisie : `serve.js:1099-1102` incrémente `authVersion` et `:453` rejette
alors la session de l'acteur en pleine requête — l'admin est déconnecté par sa propre
modification, ce qui se présente comme un plantage.

**Faille de révocation** : `authVersion` n'est pas incrémenté sur révocation d'octroi ou
d'adhésion — un droit retiré reste vivant dans le contexte mis en cache côté client jusqu'au
prochain chargement.

**Rôle inconnu** : `roleAllows` refuse correctement, mais `normalizeRole` (`roles.js:20`)
retourne silencieusement `'visitor'` — **fabriquant une identité valide à partir d'une
identité corrompue**. Le serveur doit rejeter en 403 `UNKNOWN_ROLE` et journaliser.

## B.9 Plan de tests — 15 tests, un par frontière

Les plus structurants :

- **#2 Aucune autorité orpheline** : scan de source interdisant toute comparaison de chaîne de
  rôle hors `authz-model.js`. Verrouille **toute la liste d'exécution, définitivement**.
- **#7 Un bouton implique que le serveur accepte** : test de propriété sur (rôle × entité ×
  action × enregistrement) vérifiant `clientGate.can(...) === access.canAccessRecord(...)`.
  **C'est le test qui maintient l'accord client/serveur comme invariant.**
- **#5 Équivalence des alias** : `'responsable'` ≡ `'responsible'` pour toutes les paires.
- **#13 Parité de gating des sections** : toute clé de tous les `initSections()` doit avoir une
  entrée de permission — y compris **la prochaine section ajoutée par monkey-patch**.

---

# C. Couche de liaison universelle

## C.1 Le contrat existe déjà — il n'est simplement pas utilisé hors `docs`

`normalizeEntityReference` (`continuity-contract.js:37-49`), `ENTITY_REFERENCE_TYPES` (`:18-20`),
`technicalReferenceTarget` (`serve.js:872-886`), `resolveTechnicalEntityReference` (`:739-762`),
`graphKeyForReference` (`technical-graph.js:7-15`), `pluralStore` (`access-control.js:71-83`).

Toute la conception tient en : **promouvoir ce contrat de `docs`-uniquement à toute la
plateforme**, et faire cesser à tout le reste d'inventer le sien.

**Vocabulaire singulier**, parce que six sous-systèmes le parlent déjà (`serve.js:533,742,874`,
`technical-graph.js:7-15`, `service-request-contract.js:84`, `connectivity-contract.js:5`,
`continuity-contract.js:18`) contre deux fichiers feuilles au pluriel. Invariant :
**pluriel = nom de store, singulier = type d'entité**, et `pluralStore()` est le pont unique.

## C.2 Ne jamais figer un nom

> Une référence stockée porte **l'identité seule**. Tout nom lisible est produit au rendu en
> résolvant la référence contre son store vivant.

Test à appliquer à chaque écriture : *si l'enregistrement référencé est renommé, cette chaîne
doit-elle changer ?* Si oui, elle ne doit pas être stockée.

**`continuity-contract.js:44` écrit `label` dans `normalizeEntityReference` — c'est l'origine
unique de tous les noms figés de la plateforme.** Supprimer cette ligne, plus 21 autres sites
(`serve.js:1181` `relatedName`, `diagram-studio.js:208`, `diagram-studio-advanced.js:203`,
`continuity-center.js:283`…).

Une seule exception : une **pierre tombale** écrite à l'instant de la suppression, quand par
définition plus aucun enregistrement vivant ne peut être résolu.

Subtilité à ne pas manquer : `serve.js:172` **écrase** `node.label` par « Dépendance protégée »
pour la censure. Faire de `'protected'` un type de première classe, sinon le résolveur
referait fuiter le vrai nom.

## C.3 Attachabilité

**Tout ce qui est adressable par `entityRef` peut porter ticket, note, document et historique.**
L'allowlist actuelle de 5 types (`serve.js:1114`) est une carte écrite à la main qui précède
`ENTITY_REFERENCE_TYPES` — et c'est la seule des quatre copies qui soit fausse (il lui manque
`wall`, `cable`, `component`, `port`). **À supprimer.**

- **QR** seulement pour ce qu'un technicien peut trouver physiquement : salle, baie,
  équipement, écran, mur, câble. Standardiser sur des liens profonds `buildHashRoute`, pas sur
  `numSerie` (un numéro de série n'est pas une identité).
- **`port` n'est pas une cible de ticket** : une panne sur un port est une panne sur son
  porteur ; l'offrir fragmenterait un incident sur 48 lignes.

Cinq validations doivent accompagner l'élargissement, dont : résolution via
`technicalReferenceTarget` (c'est **ce qui rend `component` et `port` possibles**, le code
actuel en étant structurellement incapable), et cohérence `kind` pour les types portés par
`docs` (sinon un ticket peut pointer n'importe quel document).

**Deux changements doivent atterrir dans le même commit, sinon les tickets `wall`/`cable`
fuient entre zones** : `redactCrossZoneRelations` (`serve.js:263-270`) et
`access-control.js:310-311`.

## C.4 `referencesTo(entityType, id)` — un résolveur unique

`{references[], blocking[], detachable[], tombstoning[], deletable, message}`.

- **Bloquent** : contenance, extrémité de câble (**y compris le schéma hérité
  `connectedFrom`/`connectedTo` de `screens-diagnostic.js:949`, invisible à toute garde
  aujourd'hui**, H-07), nœud de schéma, référence depuis un document validé, test de
  continuité, **ticket ouvert**.
- **Détachés** : `screen.equipmentId → null`, `screen_groups.screenIds`, **`attachments`**
  (aujourd'hui vues par aucune garde, elles fuient indéfiniment), notes et faq
  (`entityRef → null` + `orphanedFrom` — détacher, pas supprimer : une note est l'observation
  écrite de quelqu'un).
- **Pierres tombales** : tickets fermés, logs, historiques. Un ticket est un enregistrement
  d'historique — `serve.js:1720` refuse déjà de le supprimer, donc une suppression d'entité ne
  doit **jamais** l'orpheliner en silence ni le supprimer.

Couverture inexistante aujourd'hui : tickets (sauf écrans), notes, faq, attachments, câbles
hérités, `docs` de forme fichier.

Le DELETE passe de *garde → suppression* à *garde → détachements → pierres tombales →
suppression*, **le tout dans `inTransaction`** (`serve.js:1125-1137`, qui existe déjà).
Aujourd'hui la suppression `serve.js:1741` est un `pool.query` nu hors transaction — l'envelopper
est ce qui rend la cascade correcte plutôt que « au mieux ».

Un index Postgres sur `(data->'entityRef'->>'type', data->'entityRef'->>'id')` remplace les six
balayages complets de `serve.js:549-551`.

## C.5 Vue de détail de salle — 11 onglets

`salles.js` n'a **aucune vue de détail** (G-02). Ajouter `showRoomDetail(roomId)` sur la route
`#/salles/<id>` — `parseHashRoute` expose déjà `route.entityId`, et
`role-navigation-integration.js:167-168` est le précédent qui fonctionne.

Un seul chargement en tête, un `buildEntityRefIndex`, partagé par tous les onglets : Vue
générale · Baies · Pupitres · Équipements · Câbles · Mur d'images · Tickets · Notes ·
Procédures · Documents · Historique.

Points notables : l'appartenance d'un **câble** à une salle est **dérivée des extrémités**,
parce que `cable.roomId` n'est écrit que parfois ; l'onglet **Historique** est le seul qui
exige un changement côté écriture (`addLog` doit écrire `entityRef`) ; les **Pupitres**
exigent un discriminant réel (`entityKind:'desk'`, le champ existant déjà pour `'module-card'`).

**Réutiliser, ne pas réimplémenter** : `openEquipment360` (`operations-suite.js:399`),
`WallManager.selectRoom` (`wall-manager.js:72-76`), le graphe
(`platform-entity-graph.js:200-215`).

Et le gain gratuit : `summary.breadcrumb` de la fiche 360 est du texte inerte aujourd'hui, alors
que `resolveEquipmentLocation(...).path` produit déjà `{type,id,label,entity}` par segment —
littéralement une liste de références. Le rendre cliquable ne demande **aucune donnée
nouvelle**.

## C.6 Élévation de baie

Sur `baies` : `heightU` (défaut 42), `uNumbering` (`bottom-up` — convention broadcast),
`reference`. Ce dernier n'est pas spéculatif : `baies.js:27-30` **filtre déjà** sur
`b.reference` alors qu'aucun écrivain ne le renseigne.

Sur `equipments` : `uPosition` (U le plus bas occupé), `uHeight`, `uFace`.

`validateRackPlacement` — fonction pure exécutée des deux côtés, patron déjà établi par
`validateCableShape` + `normalizeIncomingCable`. Ne **jamais inventer** une position :
`uPosition == null` signifie « non positionné » et l'élévation le range dans un bac dédié.
Rétrécir `heightU` sous un U occupé doit répondre 409.

Chaque maillon de `B01.RF1 → U12 → équipement X → OUT 04` est un `entityRef`, donc chaque
segment se rend via `resolveEntityRef(...).deepLink`.

**Vue vivante vs vue documentée** : `'rack-elevation'` existe déjà dans `DIAGRAM_TYPES`
(`diagram-contract.js:5`). Un schéma dont les `entityRef` contredisent `uPosition` est une
anomalie d'intégrité — signalée, jamais silencieuse.

## C.7 Ordre de livraison

1. `entity-reference-contract.js` + `readEntityRef` — **zéro octet stocké ne change**, donc
   rien ne peut régresser.
2. Supprimer `label` des références — le renommage devient instantanément correct partout.
3. `referencesTo` + gardes + DELETE transactionnel — plus d'orphelins.
4. Attachabilité (tickets sur murs et câbles).
5. Migration + index.
6. Vue de détail de salle.
7. Contrat de baie + élévation.

**Justification de l'ordre** : 3 avant 4 — élargir *ce qui peut être référencé* avant de savoir
*suivre les références* fabriquerait des orphelins plus vite qu'on ne peut les garder.

---

# D. Chantier restant

La **liste de suppression prouvée** (lot C) s'est interrompue avant terme. Elle est reprise
séparément ; en attendant, **aucune suppression ne doit être exécutée** — la charge de la
preuve reste sur la suppression, parce qu'un faux positif provoque une panne en production.
Les candidats connus sont listés dans `PLATFORM-AUDIT-2026-08.md`, section « Code mort et
trompeur », et doivent chacun être vérifiés contre : le graphe de modules, le pré-cache du
service worker, `scripts/check-active-modules.js`, les tests, et
`.github/workflows/verify.yml` (qui teste l'existence de fichiers précis et **casserait le CI**
s'ils disparaissaient).

---

# E. Organisation réelle et carte récursive

> Section ajoutée après clarification du client. Elle **corrige** le modèle du Chef décrit
> en §B et **précise** la carte de §A.

## E.1 L'organisation réelle de 2M

```
Manager        — sur TOUTES les zones
   └── Chef    — un par MÉTIER : technique · équipements · maintenance · transmissions …
          └── chaque métier couvre PLUSIEURS lieux
                 ex. technique → STC · RÉGIE FINALE · ACQUISITION …
                     └── chaque lieu a ses Responsables
                     └── chaque lieu a ses Techniciens
```

**Correction du modèle du Chef.** En §B j'avais décrit le Chef comme une autorité
*temporelle sur une vacation*. C'est faux : le Chef est une autorité **par métier**, durable.
Chef technique, chef maintenance, chef transmissions — chacun couvre l'ensemble des lieux de
son métier, et seulement ceux-là.

**Règle de cardinalité, énoncée explicitement par le client :**

> Aucun rôle n'est unique à aucun niveau. Il peut y avoir 2 Managers ou plus, 3 Chefs ou
> plus, 3 Responsables ou plus, 3 Techniciens ou plus — **dans la même ville, la même
> région, le même bâtiment, le même étage et la même salle**.

C'est un invariant, pas un détail de confort. Il condamne définitivement
`rooms.responsibleId` (`db.js:47`), qui ne peut porter qu'**une** personne, et qui est
aujourd'hui la **seule** liaison personne ↔ lieu de toute la plateforme (constat P-01).

## E.2 Le métier est un nœud de l'arbre, pas une dimension séparée

Le client a précisé que « technique » désigne un **lieu** (« département technique »), pas un
rôle. Le métier tombe donc naturellement dans l'arborescence :

```
Site → Département (technique | maintenance | transmissions | équipements …)
     → Étage → Salle (STC | RÉGIE FINALE | ACQUISITION …)
     → Baie | Pupitre → Équipement
```

Conséquence : **l'arbre des lieux est aussi l'arbre des responsabilités.** Une affectation
est un triplet `(personne, nœud, rôle)`, et la portée d'une personne est le **sous-arbre** du
nœud auquel elle est affectée.

| Rôle | Nœud d'affectation | Portée effective |
|---|---|---|
| Manager | racine (`pays`) | tout |
| Chef | `departement` | tous les lieux de son métier |
| Responsable | `salle` (une ou plusieurs) | ses lieux |
| Technicien | `salle` (une ou plusieurs) | ses lieux |
| Visiteur | `salle` ou `zone` | son seul périmètre |

Aucun mécanisme nouveau n'est nécessaire : `location_people`
(`{id, locationId, userId, role, startsAt, expiresAt, status}`) porte déjà **plusieurs
personnes par rôle et par nœud**, et `pathKey` donne la portée par simple préfixe.

**Point de vigilance.** `access-control.js:188-206` dérive automatiquement adhésions et droits
de zone à partir de `room.responsibleId`. Cette dérivation doit être généralisée pour lire
`location_people` — sinon seul un « responsable » par salle continuera de recevoir des
droits, et tous les autres seront silencieusement sans accès.

## E.3 La carte récursive — l'idée du client

> L'admin dépose l'image de la carte du Maroc, y **dessine les villes**, et donne une image à
> chaque ville. En cliquant sur une ville il ajoute l'image de la région ; en cliquant sur la
> région il ajoute les images des bâtiments ; et l'on descend ainsi jusqu'au lieu, à l'étage
> et à la salle.

**Cette idée ne demande aucun mécanisme nouveau : c'est la généralisation de ce que la carte
fait déjà.** `interactive-map.js` dessine aujourd'hui des zones (`rect`) sur une image de plan
et descend d'un niveau au clic — mais sur **deux** niveaux seulement (plan → salle → baie), et
avec l'image de plan unique venant de `settings.mapImageUrl`.

Il suffit de deux champs, déjà prévus au §A.2, pour passer à N niveaux :

| Champ | Rôle |
|---|---|
| `location.image` | l'image affichée **quand on est à l'intérieur** de ce nœud |
| `location.rect` | l'endroit où ce nœud est **dessiné sur l'image de son parent** |

Et la règle de rendu tient en une phrase :

> Afficher `image` du nœud courant, et dessiner en surcouche un point cliquable pour chaque
> enfant à sa position `rect`. Un clic descend d'un niveau ; le fil d'Ariane remonte.

C'est **exactement** la boucle des lignes `interactive-map.js:275-328`, mais paramétrée par
`parentId` au lieu d'être écrite en dur pour `room` puis `baie`.

### Ce que cela apporte gratuitement

- **Aucun niveau n'est obligatoire.** Une unité mobile comme la Régie Car n'a ni bâtiment ni
  étage : elle est simplement rattachée plus haut. Le rendu ne change pas.
- **Aucune image n'est obligatoire.** Un nœud sans image affiche la liste de ses enfants au
  lieu d'un plan. La saisie peut donc commencer par la structure et l'illustration venir
  après — ou l'inverse.
- **Les droits suivent la descente.** Un Visiteur rattaché à STC ne voit que STC : les
  souches d'ancêtres expurgées (§A.4) lui donnent le fil d'Ariane
  `Maroc › Casablanca › Site › Technique` sans révéler le contenu des nœuds voisins.
- **La carte devient le point d'entrée naturel** vers les tickets, procédures, câbles et
  schémas du lieu, via la vue de détail de §C.5.

### Ce qu'il faut décider avant de coder

1. **Le géoréférencement.** Dessiner des villes sur une image du Maroc est un choix simple et
   robuste — pas de dépendance cartographique, pas de réseau, fonctionne hors ligne, et
   l'admin garde la main sur le visuel. Une vraie carte géographique (tuiles, latitude /
   longitude) apporterait le zoom continu et la localisation réelle, au prix d'une dépendance
   externe et d'un rendu hors ligne dégradé. **Recommandation : image dessinée**, cohérente
   avec l'existant et avec l'usage en salle technique. Le modèle laisse la porte ouverte :
   des champs `lat`/`lng` optionnels pourront être ajoutés plus tard sans rien casser.
2. **Le format des zones dessinées.** Aujourd'hui `rect` est un rectangle. Une ville sur une
   carte se dessine plus justement en **polygone**. Prévoir `shape: 'rect' | 'polygon' | 'point'`
   dès le départ évite une migration ultérieure.
3. **Le poids des images.** Une carte du Maroc plus une image par ville, par bâtiment et par
   étage, c'est vite plusieurs dizaines d'images. **Elles ne peuvent pas être stockées en
   base64 dans les enregistrements** : l'instantané `/api/sync` complet toutes les 20 s
   deviendrait inexploitable. Le stockage média de `PROCEDURES-DESIGN.md` §5 est donc un
   **prérequis de la carte aussi**, pas seulement des procédures.

## E.4 Impact sur ce qui précède

| Section | Correction |
|---|---|
| §B.2 | Le Chef est une autorité **par métier**, durable — non temporelle. Sa portée est le sous-arbre de son `departement`. |
| §B.3 | Ajouter la cardinalité multiple comme invariant testable : plusieurs titulaires du même rôle sur le même nœud. |
| §A.2 | `location_people` devient central, et non un complément : c'est le seul porteur de la responsabilité. `responsibleId` reste en miroir pour compatibilité, mais cesse d'être la source. |
| §A.4 | `access-control.js:188-206` doit dériver les zones depuis `location_people`, sinon un seul responsable par salle reçoit des droits. |
| §A.2 | Ajouter `shape` à côté de `rect`, et prévoir `lat`/`lng` optionnels. |

## E.5 Coordonnées des zones dessinées — décision technique

Le client veut pouvoir **tracer point par point, déplacer les sommets et fermer une forme**,
pour tout objet et non seulement pour les villes, et veut que le tracé **reste exactement au
même endroit même si la taille de l'image change**.

### Décision : coordonnées normalisées `[0..1]`, pas des pixels absolus

```
shape: {
  kind: 'polygon' | 'rect' | 'circle' | 'point',
  points: [[0.4213, 0.1875], [0.4488, 0.2011], …],   // fractions de largeur / hauteur
  radius: 0.031                                        // cercles uniquement
}
```

Stocker des pixels absolus obligerait à mémoriser en plus les dimensions de référence de
l'image ; le jour où ce couple se désynchronise — image ré-exportée, capture recadrée,
champ oublié à l'écriture — **tous les tracés se décalent en silence, sans erreur**. La forme
normalisée porte sa propre référence : elle est juste par construction.

Conversion à l'affichage, dans les deux sens :

```
écran = origine + normalisé × tailleAffichée
normalisé = (écran − origine) / tailleAffichée
```

`tailleAffichée` est la taille réellement rendue de l'image, lue au moment du calcul. Le zoom
et le déplacement deviennent de pures transformations de vue qui **ne touchent jamais la
donnée stockée**.

### Ce que cela corrige au passage

C'est le moment de régler **C-10**. Aujourd'hui les positions vivent dans un repère hérité
`2000×1200` alors que `interactive-map.js:168` lit l'échelle de la scène : le facteur manquant
(`W/2000` en x, `H/1200` en y) fait qu'un glissement de 100 px déplace le marqueur d'environ
156 px en x et 167 px en y — le marqueur **fuit le curseur**, et de travers puisque les deux
échelles diffèrent.

Construire l'éditeur de polygones par-dessus ce repère hériterait du défaut. Une seule
convention, normalisée, remplace les trois interprétations actuelles.

### L'éditeur

Tracé point par point ; sommet déplaçable ; fermeture par clic sur le premier point ou double
clic ; insertion d'un sommet sur une arête ; suppression d'un sommet ; déplacement de la forme
entière ; annuler / rétablir ; aimantation optionnelle. Validation : minimum 3 sommets pour un
polygone, pas d'auto-intersection, tout point dans `[0,1]`.

**Applicable à tout nœud de l'arbre** — ville, bâtiment, étage, salle, baie, pupitre — parce
que la forme vit sur `locations`, pas sur un type particulier.

## E.6 Stockage des images — Cloudinary

Le client demande s'il peut utiliser Cloudinary. **Oui, et cela résout le vrai obstacle** :
Railway ne conserve pas le disque local entre deux déploiements, donc aucun fichier écrit sur
le disque ne survit.

Deux vérifications faites dans le code, qui changent la recommandation :

| Vérification | Résultat |
|---|---|
| En-tête `Content-Security-Policy` | **Aucun** n'est émis par `scripts/serve.js` — rien ne bloquera `res.cloudinary.com`. (Poser une CSP reste un durcissement souhaitable par ailleurs.) |
| Cache hors ligne | `service-worker.js:70` : `if (!event.request.url.startsWith(self.location.origin)) return;` — **le service worker ignore tout ce qui n'est pas sur la même origine.** Une image Cloudinary ne sera donc **jamais** disponible hors ligne en l'état. |

### Trois précautions non négociables

1. **Les URL Cloudinary sont publiques par défaut.** Une procédure contenant des identifiants,
   ou la photo d'une salle en zone restreinte, deviendrait lisible par quiconque possède le
   lien — **court-circuitant tout le contrôle par zones**. Utiliser le type de diffusion
   `authenticated` avec des URL signées à durée limitée, générées par le serveur **après** la
   vérification de zone.
2. **Le secret d'API ne doit jamais atteindre le navigateur.** L'envoi est signé côté serveur.
3. **Hors ligne**, l'usage en salle technique exige d'étendre `service-worker.js:70` aux
   origines média déclarées, sinon la carte et les procédures critiques seront blanches dès la
   moindre coupure.

### Décision : abstraction média avec fournisseur enfichable

```
media { id, provider:'cloudinary'|'postgres', publicId, url, mimeType, size,
        sha256, width, height, zoneIds, sensitivity:'public'|'restricted',
        createdBy, createdAt }
```

- `sensitivity:'public'` → Cloudinary : carte, villes, bâtiments, salles. CDN, vignettes et
  conversions automatiques, aucun coût de stockage côté plateforme.
- `sensitivity:'restricted'` → colonne `bytea` PostgreSQL : procédures à secrets, preuves
  terrain. **La donnée sensible ne quitte jamais votre infrastructure.**

Le reste de la plateforme ne connaît qu'un `mediaId` et ignore le fournisseur. Aucun
verrouillage : changer de fournisseur revient à écrire un second adaptateur.

## E.7 Le logo — solution sans fichier vectoriel

Le client propose, à défaut de redessiner, de partir d'une image haute définition ou d'une
vidéo, et de faire apparaître les formes une par une.

**La vidéo est à écarter** : la transparence (alpha) n'est pas fiable sur Safari, le fichier
est lourd, et surtout une vidéo **ne peut pas être synchronisée avec la progression réelle du
chargement** — or c'est précisément ce que fait l'écran actuel.

**Une image unique ne peut pas être animée pale par pale** sans connaître la géométrie des
pales, qui est justement ce qui manque.

### La bonne réponse : huit PNG transparents, un par pale

Demander au graphiste **huit fichiers PNG exportés sur le même canevas**, chacun ne contenant
qu'une pale à sa position finale, fond transparent, haute définition.

L'animation existante fonctionne alors **telle quelle** : il suffit de remplacer les huit
`<path>` par huit `<image>` superposées. Sont conservés sans une ligne de changement :

- l'apparition décalée (`animation-delay: calc(var(--piece-index)*.11s)`)
- la rotation et la ligne de balayage pendant le chargement
- la barre de progression liée aux étapes réelles d'initialisation
- l'état `.startup-ready` qui fige le logo à 100 %
- le respect de `prefers-reduced-motion`

Deux avantages décisifs : **fidélité au pixel près sans fichier vectoriel**, et **aucune
géométrie à deviner** — chaque pale étant déjà à sa place sur son canevas, il n'y a strictement
aucun calcul de position à faire, juste une superposition.

Si le graphiste peut en plus fournir un SVG, on y gagnera la netteté à toute taille et un
poids moindre ; mais **huit PNG suffisent** et sont bien plus faciles à produire pour un
graphiste que des tracés vectoriels propres.
