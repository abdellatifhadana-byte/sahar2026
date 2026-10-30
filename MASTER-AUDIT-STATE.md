# Master Audit — état persistant

> **Rôle de ce fichier.** C'est la source de vérité de l'audit. Il est mis à jour et poussé
> après chaque étape, pour qu'une coupure réseau, une session perdue, une limite de contexte
> ou un redémarrage de serveur ne fasse perdre aucun travail. Une nouvelle session reprend
> ici, sans redémarrer l'analyse ni redériver les faits déjà établis.

**Branche** : `claude/tv-platform-audit-ucvwxo`
**Dernière mise à jour** : étape 2 — vérification croisée et cadrage
**Statut global** : audit terminé · conception en cours · **implémentation non commencée (volontairement)**

## Règle de travail convenue

1. Master Audit complet **d'abord**.
2. Liste finale corrigée et ordonnée **ensuite**.
3. Implémentation **seulement après validation** de la liste.

Rien n'est ajouté avant d'avoir été corrigé et confronté à l'existant, pour éviter d'ajouter
une brique qui contredit une autre.

## Protocole de reprise après interruption

| Situation | Reprise |
|---|---|
| Session/contexte perdu | Lire ce fichier + `PLATFORM-AUDIT-2026-08.md`. Les faits marqués VÉRIFIÉ ne se re-vérifient pas. |
| Réseau coupé pendant un push | `git push -u origin claude/tv-platform-audit-ucvwxo` avec retente exponentielle (2/4/8/16 s). |
| Serveur de test mort | Il n'est pas nécessaire à la conception. Pour re-tester : voir « Banc de test » ci-dessous. |
| Agent interrompu | Ses conclusions ne comptent que si elles sont consignées ici. Relancer le lot manquant. |
| Doute sur un constat | Tout constat non marqué VÉRIFIÉ doit être re-prouvé avant d'être utilisé comme base de décision. |

### Banc de test reproductible

```bash
# PostgreSQL local
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /home/postgres/pgdata -U tech --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /home/postgres/pgdata -o '-p 5433 -k /tmp' -l /tmp/pg.log start"
psql -h /tmp -p 5433 -U tech -d postgres -c "CREATE DATABASE tech_platform_audit;"

# Plateforme
PORT=4174 \
DATABASE_URL='postgresql://tech@127.0.0.1:5433/tech_platform_audit' \
PLATFORM_ADMIN_USERNAME=audit-admin PLATFORM_ADMIN_PASSWORD='Audit-Admin-2026!' \
PLATFORM_ADMIN_FULLNAME='Auditeur' PLATFORM_ADMIN_RESET_VERSION=audit-v1 \
SESSION_SECRET='audit-session-secret-2m-tech-platform-2026-long' npm start

# Navigateur : Chromium à /opt/pw-browsers/chromium-1194/chrome-linux/chrome
# Attention : créer un utilisateur via db.save exige password: db.hashPassword('...') (base64),
# sinon le serveur décode du base64 invalide et le compte ne peut pas se connecter.
```

---

## Étape 1 — Audit d'exécution (TERMINÉ)

Rapport complet : `PLATFORM-AUDIT-2026-08.md` (44 défauts, dont 11 prouvés à l'exécution).
Rapport visuel : https://claude.ai/code/artifact/940e50d1-f6b4-4ff5-a211-1ec2d28f0fb5

---

## Étape 2 — Vérification croisée (TERMINÉ)

Les messages originaux de l'autre analyse ne sont pas disponibles (conversation interrompue) ;
seul son **résumé final** l'est. Chaque affirmation vérifiable de ce résumé a été confrontée au
code réel.

| Affirmation du résumé | Verdict | Preuve mesurée |
|---|---|---|
| La plateforme a 6 rôles, pas 5 | **CONFIRMÉ, et pire que décrit** | Le code n'a que **4** rôles canoniques (`roles.js:1-6`). Voir R-01/R-02. |
| `manager` est un rôle à part entière | **INFIRMÉ** — c'est un alias | `roles.js:10` `manager → admin`. Côté serveur `access-control.js:21` `manager: new Set(PERMISSIONS)` = **identique à admin**. |
| `chef` fait partie du modèle | **INFIRMÉ** — totalement absent | 0 occurrence dans tout le dépôt. |
| Rôle « Technique » | **INFIRMÉ comme valeur** | `technique` : 0 occurrence. Le code utilise `technician`/`tech`. |
| Incohérences `responsible`/`responsable` | **CONFIRMÉ** | `equipements.js:26` omet `'responsible'` → voir H-10 du rapport. |
| Incohérences `status`/`statut`, `name`/`nom` | **CONFIRMÉ et mesuré** | 51 équipements portent les deux champs ; 3 vocabulaires de statut. C-01/C-02. |
| La carte doit être une arborescence géographique | **CONFIRMÉ — la structure est absente** | Voir G-01. |
| Chemin `B01.RF1 → U12 → équipement → OUT 04` | **CONFIRMÉ comme impossible aujourd'hui** | Aucune position en U : 0 occurrence de `uPosition`/`rackUnit`/`unitU`. |
| Ticket créable depuis Wall et Cable | **CONFIRMÉ comme impossible** | `serve.js:1114` n'accepte que `equipment, room, baie, screen, continuity-test`. |
| Procédure « Lier à un équipement » | **CONFIRMÉ comme absent** | `continuity-center.js:82` : lien uniquement par `protectionGroupId`. |
| L'entité doit être unique et partagée, non recopiée | **CONFIRMÉ comme violé** | Nœuds de schéma figeant `label` (H-04), `relatedName` figé sur les tickets. |
| Master Audit avant toute addition | **Adopté comme règle de travail** | Voir « Règle de travail » ci-dessus. |

### Nouveaux constats issus de cette vérification

**R-01 — `Manager` est un fantôme à moitié implémenté. [VÉRIFIÉ]**
Vérifié par lecture directe : `manager` est contrôlé comme chaîne brute dans ~12 emplacements
(`tickets.js:41`, `inventory-master.js:19,121,151`, `inventory-central-install.js:9,94`,
`catalog-seed-guard.js:22`, `docs.js:74`, `diagram-contract.js:166`,
`map-admin-entity-edit.js:98`, `core.js:68`, `navigation-contract.js:14`), il reçoit **tous**
les droits côté serveur (`access-control.js:21`) — mais **la liste déroulante des rôles
(`users.js:95-98`) ne le propose pas**. Conséquence : un Manager ne peut pas être créé par
l'interface ; et s'il est créé autrement, il est Admin en tout sauf le nom.

**R-02 — `Chef` n'existe pas, et le créer aujourd'hui produirait un compte vide. [VÉRIFIÉ]**
`normalizeRole('chef')` → `'visitor'` (`roles.js:20`) donc l'utilisateur reçoit `VisitorUI` ;
et `ROLE_CEILINGS['chef']` est `undefined` (`access-control.js:19-27`) donc le serveur refuse
toute permission. Le compte se connecte et voit une plateforme vide — sans message d'erreur.

**G-01 — Le modèle de localisation est plat sur 2 niveaux. [VÉRIFIÉ]**
Mesuré par recherche exhaustive : `etage`, `ville`, `city`, `region`, `departement`,
`department`, `batiment` → **0 occurrence réelle**. `floor` → 0 (uniquement `Math.floor`).
`site` → 29 occurrences, **toutes** en prose française « sur site » (= relevé terrain), aucune
n'est un modèle de données. `pupitre` → 14 occurrences, **toutes** en texte libre
(`physicalZone:'Pupitre caméras'`, libellé `'Position sur mur / pupitre'`), jamais une entité.
Stores réellement déclarés (`db.js:41-58`) : aucun store de lieu au-dessus de `rooms`.

Donc la hiérarchie demandée
`Maroc → Région → Ville → Site/Bâtiment → Département → Étage → Salle → Baie/Pupitre → Équipement`
est **absente à 7 niveaux sur 9**. Seuls `Salle` et `Baie` existent.

**G-02 — Il n'existe aucune page de détail de salle. [VÉRIFIÉ]**
`salles.js` n'expose que `render`, `afterRender`, `refreshList`, `readFile`, `showEditModal`,
`showCoordModal` — c'est un tableau CRUD, rien de plus. Une salle ne « s'ouvre » que dans la
modale de la carte (`interactive-map.js:283` `openPanel('room', …)`). La vue demandée
« Salle → Vue générale | Baies | Pupitres | Équipements | Câbles | Mur | Tickets | Notes |
Procédures | Documents | Historique » n'existe donc à aucun endroit, et la carte est
aujourd'hui le seul chemin de navigation contextuelle vers un lieu.

**P-01 — Le modèle « personnes » se réduit à un seul champ. [VÉRIFIÉ]**
La seule liaison personne ↔ lieu est `rooms.responsibleId` (`db.js:47`). Aucun modèle
d'affectation de personnes à une baie, un équipement, un étage, un département ou un site :
`assignedTo`, `occupants`, `personnes`, `staff` → 0 occurrence. Les occurrences d'`operator`
sont des libellés de type de document, pas des personnes.

Point important à conserver : `access-control.js:188-201` dérive **automatiquement** une
adhésion de zone et des droits à partir de `room.responsibleId`. C'est donc déjà le pivot
entre « personne » et « permissions » — toute refonte du modèle de personnes doit passer par
là, sous peine de casser silencieusement l'attribution des droits.

### Page de démarrage et page de connexion

Ces deux pages étaient explicitement dans le périmètre demandé et n'avaient pas été
approfondies dans le premier rapport.

**S-01 — L'écran de connexion détruit le splash, donc la connexion se fait sans aucun retour visuel. [TRACÉ]**
`Auth.showLogin` (`compat-integrations.js:24`) écrase `#app.innerHTML`, ce qui supprime
`#startup-splash`. Ensuite `finishStartupSplash()` (`startup-splash.js:87`) cherche
`#startup-splash`, ne le trouve plus et retourne immédiatement ; tous les
`updateStartupSplash('sync'|'interface', …)` de `core.js:44-49` deviennent des no-op.

Or la connexion déclenche l'opération la plus lourde du démarrage :
`login()` → `syncCentralSafely({bootstrapLocal:true})` (`auth.js:87`), c'est-à-dire un
instantané complet du serveur. Pendant tout ce temps l'utilisateur voit **le formulaire de
connexion figé**, sans barre de progression ni message. Le splash « relié aux étapes réelles
de démarrage » annoncé dans `PHASE19_PLATFORM_AUDIT.md:19` n'est donc vrai que pour un
utilisateur **déjà** connecté.

**S-02 — Délai artificiel de 2,6 s imposé à chaque démarrage. [TRACÉ]**
`MIN_SPLASH_DURATION_MS = 2200` (`startup-splash.js:1`) force une attente minimale même quand
tout est prêt, puis `finishStartupSplash` ajoute 420 ms (`:95`). Soit **2,62 s incompressibles**
à chaque ouverture pour un utilisateur déjà authentifié.

**S-03 — Aucune protection contre la force brute sur `/api/auth/login`. [VÉRIFIÉ]**
Recherche exhaustive dans `scripts/serve.js` : `rateLimit`, `attempts`, `lockout`, `throttle`,
`429` → **0 occurrence**. Le point d'entrée (`serve.js:1279-1297`) accepte un nombre illimité
de tentatives, sans compteur, sans temporisation, sans verrouillage de compte.

Double conséquence : (a) attaque par force brute à pleine vitesse sur tous les comptes ;
(b) **déni de service non authentifié** — chaque tentative déclenche une dérivation scrypt
(`verifyPassword`), donc des requêtes concurrentes suffisent à saturer le CPU du serveur.

Ce qui est en revanche correct sur ce point, et à conserver : message d'erreur générique
(pas d'énumération des comptes, `serve.js:1285`), cookie `HttpOnly; SameSite=Lax` avec
`Secure` conditionnel (`serve.js:458`), hachage scrypt avec migration automatique des
anciens mots de passe.

**S-04 — Le bouton de connexion n'est pas désarmé pendant la soumission. [TRACÉ]**
`compat-integrations.js:39` installe `form.onsubmit` sans désactiver le bouton : un double
clic lance deux authentifications concurrentes, donc deux `bootstrapLocal` complets.

---

## Étape 3 — Conception (EN COURS)

Quatre lots confiés à des agents parallèles :

| Lot | Objet | Statut | Livrable |
|---|---|---|---|
| A | Arborescence de localisation + migration + zones | **terminé** | `ARCHITECTURE-DESIGN.md` §A |
| B | Modèle unifié à 6 rôles + vocabulaire de permissions | **terminé** | `ARCHITECTURE-DESIGN.md` §B |
| C | Liste de suppression **prouvée** | **interrompu** (limite de session) | à reprendre |
| D | Couche de liaison universelle | **terminé** | `ARCHITECTURE-DESIGN.md` §C |
| E | Module Procédures | **terminé** | `PROCEDURES-DESIGN.md` |

### Vérifications que j'ai refaites moi-même sur les conclusions des lots

| Affirmation | Verdict |
|---|---|
| `resolveResourceZones` abandonne à `depth > 5` et `[]` vaut refus | **VÉRIFIÉ** — `access-control.js:269` + `:351`. Une arborescence à 9 niveaux parcourue récursivement produirait un refus massif **silencieux**, pas une erreur. |
| `AUTO_NUMERIC_ID_STORES` remplace les id vides par des horodatages | **VÉRIFIÉ** — `central-sync.js:9-12` + `:182` ; `normalizeRemoteId` (`:32-39`) coerce `'12'` → `12`. Le store `locations` doit en être exclu et ses id ne doivent jamais être entièrement numériques. |
| `applySnapshot` vide les stores autoritaires avant réapplication | **VÉRIFIÉ** — `central-sync.js:140`, déjà prouvé à l'exécution à l'étape 1 (les paramètres du technicien sont écrasés par un repli fabriqué). |

### Constats nouveaux remontés par les lots

**A-01 — Il y a cinq systèmes d'autorisation, pas trois. [à confirmer]**
Aux trois connus s'ajoutent `navigation-contract.js:12-15` (quatrième table de normalisation
de rôles) et `security.js:41-62` (cinquième système, avec un rôle fantôme `user` qui explique
le `['visitor','user']` de `operations-suite.js:185`).

**A-02 — `WRITE_PERMISSION_BY_STORE.rooms = 'zone.manage'`. [à confirmer]**
`access-control.js:41` route l'écriture des salles par `zone.manage`, permission exclue du
plafond Responsable (`:22`) — donc **toute sauvegarde de salle par un Responsable échoue en
403**, alors que `salles.js:35` lui affiche le bouton.

**A-03 — `equipment.status` n'existe pas comme permission distincte. [à confirmer]**
`permissions.js:42` donne au technicien `changeStatus:true`, mais le serveur route toute
écriture équipement par `equipment.edit` (`access-control.js:42`) : signaler une panne et
réécrire la fiche entière sont le même droit.

**A-04 — `logsSection.js` ne contient aucun contrôle de rôle. [à confirmer]**
Cohérent avec H-01 déjà prouvé à l'exécution ; s'y ajoute que les gestionnaires sont branchés
sans garde, donc un utilisateur refusé qui atteint le DOM déclenche quand même `clearLogs()`.

**A-05 — `continuity-contract.js:44` est l'origine unique des noms figés. [à confirmer]**
C'est cette ligne qui écrit `label` dans `normalizeEntityReference`, d'où H-04.

Ces cinq constats proviennent des lots et **n'ont pas encore été reproduits par moi**. Ils
sont exploitables comme pistes, non comme faits établis, tant qu'ils ne sont pas marqués
VÉRIFIÉ.

---

## Étape 4 — Décisions arrêtées par le client

| Sujet | Décision | Conséquence |
|---|---|---|
| **Méthode de travail** | Corrections isolées, vérifiées, qui ne touchent rien d'autre. Prudence avant toute addition. | On ne commence que par des correctifs autonomes et des fondations sans effet de bord. |
| **Validation des procédures** | **Responsable uniquement** | `procedure.validate` : Responsable, Manager, Admin. Le Chef ne valide pas. |
| **« Technique »** | **C'est un LIEU, pas un rôle** — ex. « département technique ». Le rôle est **Technicien** (une personne). | Corrige l'hypothèse A6. `département technique` devient un nœud `departement` de l'arborescence. Les 6 rôles sont : Admin · Manager · Chef · Responsable · **Technicien** · Visiteur. **Chef reste le seul rôle réellement nouveau.** |
| **Visiteur** | Voit la carte et circule **uniquement dans la zone ou la salle dont il relève**, et l'information visible dépend des droits qui lui sont accordés. | **Corrige ma proposition** : `zone.summary.read` devient **`Z` (limitée à la zone)** et non `G`. Le `catalogue.read` global est abandonné. En contrepartie, un Visiteur sans zone doit voir « aucune zone attribuée — demander un accès », jamais une plateforme blanche et muette. |

---

## Étape 5 — Corrections livrées

Toutes vérifiées sur la plateforme en exécution, 408/408 tests au vert.

| Réf | Correction | Preuve |
|---|---|---|
| **C-04** | Échappement de la recherche globale | Charge utile non exécutée, résultat rendu comme texte |
| **C-06** | `Number()` → `normalizeRelationId` sur les deux chemins d'enregistrement | `roomId` = `room-regie-car` au lieu de `NaN` ; l'équipement apparaît dans « Régie Car / BAIE 1 » |
| **C-01/C-02** | Vocabulaire d'état unique (`equipment-status-contract.js`) | Tableau de bord : 2 actifs / 0 / 0 / **43 à vérifier** au lieu de 0/0/0 ; le filtre renvoie ses 43 lignes au lieu de zéro |
| **C-08** | Restauration tolérante + compte rendu honnête | `tickets` est en position 9/19 : les 9 stores suivants n'étaient jamais restaurés |
| **C-04b** | Échappement des panneaux de la carte + garde d'URL d'image | Charge utile non exécutée, `javascript:` neutralisé, aucune balise brute dans le DOM |
| **S-03** | Limitation des tentatives de connexion | 8 essais puis 429 ; le bon mot de passe est aussi refusé pendant le verrouillage ; un autre identifiant reste joignable |
| **H-12** | Écriture de notification diffusée réservée | Session technicien : diffusion refusée en 403, notification personnelle acceptée |
| **C-03** | Paramètres lisibles par tout utilisateur authentifié | Le technicien reçoit `autoLogout 7` et l'image de plan de l'admin, sans repli fabriqué |
| **C-02b / M-08** | Délai d'inactivité depuis les paramètres canoniques ; minuteur non réarmé supprimé | Le délai suit la politique et se recale sans rechargement |
| **H-01** | `logs` retiré des routes technicien | `#/logs` n'affiche plus ni le Journal ni le bouton Vider |
| **H-10** | `PermissionManager` au lieu d'une liste de chaînes de rôles | Le responsable retrouve Ajouter et Modifier, sans Supprimer conformément à la matrice |
| **H-11** | Invariant « au moins un admin actif » + refus d'auto-rétrogradation | Changement de son propre rôle refusé en 409 |
| **C-05** | Le gestionnaire canonique lit `panel.currentPorts()` | Port « SDI OUT 1 » ajouté puis retrouvé après enregistrement |
| **H-02** | Existence et cohérence salle/baie vérifiées à l'écriture | Salle et baie inexistantes refusées ; baie d'une autre salle refusée par appel direct |
| **H-05** | Les demandes ouvertes bloquent la suppression | Suppression d'un équipement porteur d'une demande ouverte refusée en 409 |
| **M-02** | Thème normalisé + règle `body.theme-admin` ajoutée | `--primary #2874a6` appliqué |
| **M-04** | Exploitation lit `prio` | La priorité s'affiche au lieu de « — » |
| **M-05** | `show-notification` relayé au système réel | Notification effectivement reçue |
| **M-06** | `setupCoreEvents` idempotent | Compteurs inchangés après trois appels supplémentaires |
| **S-01 / S-04** | Bouton de connexion désarmé + progression affichée | Désarmé pendant l'envoi, réarmé après échec |

### Points laissés délibérément inchangés

**S-02 — durée minimale du splash.** C'est un choix produit verrouillé par
`tests/splash-phase20.test.js` (≥ 1650 ms), pas un défaut technique. L'arbitrage image de
marque contre rapidité appartient au client.

**Suppressions de fichiers.** Le lot « liste de suppression prouvée » reste inachevé ; aucun
fichier n'a été supprimé. Un faux positif provoquerait une panne en production, et
`.github/workflows/verify.yml` teste l'existence de fichiers précis.

---

## Étape 6 — Liste finale corrigée (À VENIR)

Quatre colonnes : **supprimer · corriger · améliorer · ajouter**, ordonnées par impact ÷ coût,
avec les dépendances entre lots, pour validation avant toute implémentation.


---

## Étape 7 — État de connexion réellement mesuré

Mesure faite sur une base **propre** avec la semence réelle, après les 17 corrections.

### Ce que contient la plateforme

| Entité | Nombre |
|---|---|
| Salles | 1 |
| Baies | 6 |
| Équipements | 51 |
| **Ports** | **0** |
| **Câbles** | **0** |
| **Écrans** | **0** |
| **Murs d'images** | **0** |
| **Schémas techniques** | **0** |
| **Chemins de flux de signal** | **0** |
| **Procédures de continuité** | **0** |
| Tickets | 0 |
| Catalogue | 111 modèles, 43 équipements rattachés |
| Grille centrale | 1 routeur, 15 interfaces, **0 port routeur**, **0 port mappé sur un port physique** |

### Conclusion honnête

**Les liaisons ne sont pas cassées : elles n'existent pas encore.** Les mécanismes sont
désormais corrects, mais le contenu est presque entièrement absent.

La chaîne canonique `Équipement → Port → Câble → Équipement` compte **zéro maillon**, et la
cause est précisément le défaut C-05 corrigé dans le lot D : **documenter un port par
l'interface était impossible**, le gestionnaire canonique écrasant la charge utile du panneau
de ports. Tout le reste en découlait :

- pas de ports → aucun câble possible, le serveur exigeant deux ports réels
- pas de câbles → le flux de signal n'a aucune liaison physique à référencer
- pas de câbles ni de ports → un schéma ne peut représenter aucune liaison réelle
- pas d'écrans ni de murs → Diagnostic et Mur d'images restent vides
- la grille centrale a ses interfaces mais aucun port rattaché à un port physique

Les contrôles d'intégrité sont presque tous « OK » **parce qu'un magasin vide ne peut pas
avoir de lien rompu**. Ce n'est pas une preuve de santé.

### Le seul défaut de données réel restant

**12 équipements pointent vers `kb-sony-vtr`, qui n'existe pas dans le catalogue** — les
« Sony VTR 01 à 12 — modèle à confirmer ». Soit la référence catalogue est créée, soit le
`catalogId` est retiré en attendant l'identification du modèle.

### Les pièges qui se déclencheront à la première saisie

Ces défauts sont sans effet tant que la plateforme est vide, et deviennent destructeurs dès
que la saisie commence. Ils doivent donc être corrigés **avant** l'entrée des données, pas
après.

| Réf | Piège | Se déclenche quand |
|---|---|---|
| **C-10** | La carte convertit les coordonnées avec la mauvaise échelle : un glissement de 100 px déplace le marqueur d'environ 156 px | dès le premier positionnement sur la carte |
| **M-11** | Vider le numéro d'un port le supprime en silence, sans le contrôle de câble appliqué au bouton Supprimer | dès la première correction d'un numéro de port |
| **H-07** | Un troisième schéma de câble (`connectedFrom`/`connectedTo`) est écrit par Diagnostic Écrans et **reste invisible à toutes les gardes de suppression** | dès le premier câble créé depuis cet écran |
| **H-04** | Les nœuds de schéma figent le nom : renommer un équipement laisse les schémas afficher l'ancien | dès le premier schéma |
| **H-08** | La position d'un écran est stockée deux fois ; Diagnostic lit la copie périmée | dès le premier déplacement d'écran sur un mur |
| **C-07** | La suppression d'une salle avec son contenu n'est pas atomique : destruction partielle sans retour arrière | dès la première suppression de salle non vide |
| **H-15** | Un journal ou une note sans zone résoluble est refusé en 403, et l'échec est **silencieux** : le diagnostic paraît figé, la passation disparaît | dès le premier diagnostic ou la première passation |
| **M-12** | `cables.roomId` n'est jamais maintenu : déplacer une baie laisse ses câbles pointer l'ancienne salle, qui les supprimera | dès le premier déplacement de baie |

---

## Étape 8 — Les huit pièges : traités et vérifiés en exécution

Les huit sont clos. Méthode appliquée à chacun, sans exception : cartographier tout le
graphe d'appel avant de toucher quoi que ce soit ; corriger à l'endroit juste ; **prouver
le défaut sur le code d'avant** ; prouver la correction en exécution réelle (navigateur
Chromium, Postgres réel) ; puis vérifier que rien d'autre n'a bougé — suite complète et
rendu des 19 sections.

| Réf | Statut | Preuve d'exécution | Commit |
|---|---|---|---|
| **M-11** | corrigé | ligne neuve vide écartée (0 erreur, 2 ports retenus) ; port existant vidé bloqué ; 2 ports intacts après tentative | `638b43d` |
| **M-12** | corrigé | AVANT : zone périmée `[Zone A]`, Zone B masquée. APRÈS : `[Zone B]`. Câble déplacé survit à la suppression de l'ancienne salle | `ae3e53d` |
| **H-08** | corrigé | miroir plat suit déplacement (70,65) et redimensionnement (45×40) ; contre-épreuve : figé à (10,20) avant | `5d08252` |
| **H-04** | corrigé | le schéma suit le renommage ; nœud hérité rattrape le nom vivant ; libellé d'auteur préservé | `89b013f` |
| **H-07** | **constat inversé** | aucun défaut : le serveur normalise tout câble à l'écriture, les deux gardes voient le schéma plat et refusent en 409 | `6e47e61` |
| **H-15** | corrigé | journal 200 (était 403) ; 3 entrées persistées (étaient 0) ; auteur falsifié remplacé par la session réelle | `7bbe801` |
| **C-10** | corrigé | repère stable au pixel près à 430/860/1720 px ; contre-épreuve : dérive de 645 px | `a264f9a` |
| **C-07** | corrigé | dépendance protégée bloque avant tout ; interruption rapportée « 1 retiré, 1 restant » | `1d09116` |

### H-07 : une conclusion de l'audit démentie par l'exécution

L'audit soupçonnait les gardes serveur d'ignorer les câbles écrits à l'ancien schéma plat,
puisqu'elles lisent `cable.sourceType` / `sourceId` bruts. C'était un raisonnement de
lecture de code, et il était faux : `normalizeIncomingCable` — et jusqu'à
`quarantineLegacyCable` — normalise **avant** de persister, si bien que ces champs sont
toujours présents. Mesuré de bout en bout : câble plat écrit par l'API, stocké avec
`sourceType: "equipment"`, suppression de l'équipement refusée en 409, retrait du port
encore câblé refusé en 409.

Rien à corriger, donc — mais la propriété qui rend les gardes correctes est implicite et
vit loin de leur code. Cinq tests la verrouillent désormais : si une voie d'écriture
contournait un jour la normalisation, les gardes redeviendraient aveugles en silence.

### H-15 : plus grave que « refus silencieux »

Le libellé de l'audit sous-estimait le défaut. Ce n'était pas un message perdu, c'était un
blocage fonctionnel total : une entrée de journal ne porte aucun champ dont une zone puisse
se déduire, donc l'écriture était refusée pour **tout** non-administrateur, quelles que
soient ses permissions — mesuré sur un technicien pourvu des 19 permissions de son plafond
de rôle et membre de sa zone. Aucun octroi ne pouvait y remédier.

Et comme `addLog()` est appelé après presque chaque action, l'erreur propagée faisait
sauter la notification de succès et le rafraîchissement de la vue : l'opération avait
abouti, mais l'écran restait figé et muet.

Le volet note du même constat, lui, était un **défaut de provisionnement, pas un défaut de
la plateforme** : le même technicien pourvu de `note.create` écrit sa note sans erreur. Il
n'y avait rien à corriger de ce côté et rien ne l'a été.

### Défaut de données toujours ouvert

12 équipements pointent vers `kb-sony-vtr`, absent du catalogue. Ce n'est pas un piège de
code : c'est une donnée à corriger lors de la reprise d'inventaire.

### Écart de conception relevé, non corrigé ici

Le plan de salle du Diagnostic écrans place ses marqueurs avec la géométrie du **mur**
(pourcentages de la surface du mur), alors qu'il les dessine sur le **plan de la salle** —
deux espaces de coordonnées différents. H-08 rend ces marqueurs cohérents et les empêche de
dériver, mais ne crée pas la coordonnée « position du mur dans la salle » qui manque. Elle
relève du chantier carte et hiérarchie de lieux, et sera traitée là, pas bricolée ici.

### Suite de tests

455 assertions, dont 47 nouvelles et **comportementales** — elles exercent la logique, au
lieu de chercher un motif dans le source comme le faisaient les 408 d'origine.
