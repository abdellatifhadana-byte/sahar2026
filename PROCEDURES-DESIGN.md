# Conception — module Procédures (version fusionnée et corrigée)

> Statut : **proposition à valider**. Rien n'est implémenté.
> Cette version fusionne deux propositions et corrige ce qui devait l'être avant intégration.

## 0. Ce que la seconde proposition apporte, et ce qu'elle casse

La seconde proposition est **nettement plus riche sur le plan opérationnel**. Sept idées sont
adoptées telles quelles parce qu'elles transforment la nature du module :

| Apport | Pourquoi c'est décisif |
|---|---|
| **Mode Exécution pas-à-pas** | Une procédure cesse d'être un document à lire pour devenir un guide qui conduit le technicien. C'est la différence entre documenter et outiller. |
| **Logique conditionnelle SI/ALORS** | Une panne n'est pas linéaire. Le branchement relie les procédures au Diagnostic existant. |
| **Enregistrement des exécutions** | Savoir *qui* a exécuté *quelle version*, *quand*, et *à quelle étape ça a échoué*. C'est la donnée opérationnelle la plus précieuse du module. |
| **Ticket auto-créé depuis l'étape en échec** | Le contexte (procédure, version, étape, équipement, port) est rempli sans ressaisie. |
| **Créer une procédure depuis un incident résolu** | Capture le savoir des techniciens au lieu de le laisser dans un ticket fermé. |
| **Accusé de lecture par version** | « J'ai lu et compris la v2.1 » — traçabilité indispensable en exploitation d'antenne. |
| **Favoris, récentes, criticité, recherche profonde, hors-ligne** | Ce qui rend le module utilisable pendant une vacation, pas seulement en salle de réunion. |

Deux points où les deux propositions **convergent indépendamment**, ce qui les renforce :
les identifiants doivent être séparés du document, et les fichiers ne doivent pas vivre dans
la base. Ces deux corrections sont donc confirmées deux fois.

### Ce qui doit être corrigé avant intégration

**Erreur majeure — les 13 tables SQL.**
La proposition décrit `procedures`, `procedure_versions`, `procedure_sections`,
`procedure_steps`, `procedure_assets`, `procedure_links`, `procedure_tags`,
`procedure_permissions`, `procedure_executions`, `procedure_execution_steps`,
`procedure_comments`, `procedure_approvals`, `procedure_acknowledgements`.

Or **cette plateforme n'a aucune table relationnelle**. Tout vit dans une table générique
unique `platform_records(store_name, record_id, data jsonb)` (`scripts/serve.js:1713`). Il n'y
a ni jointure, ni clé étrangère, ni contrainte. Décrire 13 tables normalisées décrit une
autre application.

Et le coût est mesurable : chaque nom de store doit être enregistré en **9 endroits**
(`db.js:33-59`, `central-sync.js:3-7`, `serve.js:38-42`, les deux cartes de permissions
`access-control.js:29-49`, `singularType`/`pluralStore` `:64-85`, la garde de suppression
`serve.js:546-576`, les listes de sauvegarde `db.js:139`). **13 stores ≈ 117 points
d'édition** — pour un module qui n'en justifie pas trois.

**Correction : 3 stores, le reste embarqué.**

| Store | Contenu | Pourquoi séparé |
|---|---|---|
| `procedures` | Identité, métadonnées, liens, tags, favoris, pointeur de version courante | L'entité stable que tout le reste référence |
| `procedure_versions` | Contenu figé et immuable d'une version : sections, étapes, assets, branchements | Immuable ⇒ ne peut pas être fusionné avec l'entité mutable |
| `procedure_executions` | Une exécution : qui, quand, quelle version, résultat par étape | Croissance illimitée et rythme d'écriture différent |

`sections`, `steps`, `assets`, `links`, `tags`, `permissions`, `approvals` et
`acknowledgements` sont **embarqués** — ils n'ont pas d'identité hors de leur parent, ils sont
lus et écrits de façon atomique avec lui, et `/api/sync` transporte de toute façon
l'enregistrement entier. C'est exactement ce que fait déjà `continuity_procedure` avec son
`steps[]` (`continuity-contract.js:135`).

La requête inverse — « quelles procédures référencent l'équipement X ? » — n'a pas besoin
d'une table : le client miroite déjà tous les stores et filtre en mémoire, et côté serveur
l'index d'expression sur `entityRef` prévu dans `ARCHITECTURE-DESIGN.md` §C.4 la couvre.

**Erreur secondaire — construire un second éditeur de schéma.**
La proposition §4 décrit un éditeur de dessin complet dans les procédures. Or
`diagram-studio.js`, `diagram-studio-advanced.js` et `diagram-canonical-authoring.js` existent
déjà, avec validation canonique des références. **C'est précisément le piège de duplication à
éviter.**
*Correction* : une procédure **référence** un schéma canonique
(`entityRef {type:'diagram', id}`) et l'affiche en lecture ; le bouton « Ajouter un schéma »
ouvre le studio existant. Un schéma, un seul éditeur, une seule validation.

**Erreur secondaire — la table de droits ne compte que 4 rôles.**
Elle omet **Chef** et **Visiteur**, ce qui contredit le modèle à 6 rôles arrêté dans
`ARCHITECTURE-DESIGN.md` §B. Corrigée au §7 ci-dessous.

**À reporter — l'import Word.**
Analyser un `.docx` dans le navigateur exige une bibliothèque lourde, alors que le dépôt n'a
ni bundler ni dépendance front (`package.json` : `pg` seul) et que la CSP est stricte.
*Correction* : un `.docx` est stocké comme fichier et proposé au téléchargement ; il n'est pas
converti. La conversion, si elle est voulue, se fera côté serveur dans un incrément ultérieur.

**À étalonner — l'éditeur type Notion avec dessin libre.**
C'est plusieurs mois de travail. Il est découpé au §10 : blocs structurés d'abord (ils
suffisent à reproduire l'exemple fourni), dessin libre jamais — c'est le rôle du studio.

---

## 1. Le modèle existant qu'il faut généraliser, pas dupliquer

**Constat vérifié.** Un modèle de procédure complet existe déjà dans `continuity-contract.js` :
`steps[]` typées (`PROCEDURE_STEP_TYPES` = `prepare, secure, switch, verify, fallback,
rollback, escalate, note`, `:17`), `entityRefs` **validées contre des entités réelles**
(`:228`), versions validées immuables, workflow de validation serveur.

Mais il est verrouillé sur la continuité d'antenne : `protectionGroupId` est obligatoire
(`:221`) et une procédure validée doit contenir une étape `secure` ou `switch` (`:230`).
L'exemple fourni — transfert de fichier vers l'extérieur — n'a ni l'un ni l'autre : **il est
aujourd'hui impossible à enregistrer.**

**Décision : généraliser.** `continuity_procedure` devient un cas particulier de `procedure` ;
les deux contraintes deviennent conditionnelles à `category === 'continuity'`. La page
Continuité continue de fonctionner sans changement.

---

## 2. Modes de création

`+ Nouvelle procédure` →

1. **Créer dans la plateforme** (éditeur structuré)
2. **Importer une image**
3. **Importer un PDF**
4. **Importer plusieurs fichiers**
5. **Référencer un schéma** (ouvre le studio existant)
6. **Dupliquer une procédure existante**
7. **Créer depuis un incident résolu** (voir §8)

*Word retiré de la liste initiale* (voir §0). Une procédure importée reste **pleinement
reliée** : équipements, salles, baies, tags, criticité, workflow de validation — seul son
contenu n'est pas structuré. Elle peut être structurée plus tard **sans changer
d'enregistrement ni perdre son historique**.

---

## 3. Modèle de données

### `procedures`

```
{ id, code:'PROC-STC-018',
  title, subtitle, category, criticality:'standard|important|critique|urgence',
  service:'STC', status:'brouillon|revision|validee|publiee|archivee',
  currentVersionId, ownerId, createdBy,
  zoneIds[],                       // OBLIGATOIRE — voir §6
  entityRefs[],                    // liens canoniques : équipements, salles, baies, câbles…
  tags[], offlineAvailable:boolean,
  reviewDueAt, createdAt, updatedAt, publishedAt }
```

### `procedure_versions` — immuable une fois validée

```
{ id, procedureId, version:'1.2', changeSummary, createdBy, createdAt,
  validatedBy, validatedAt,
  format:'document'|'structured'|'hybrid',
  documentMediaIds[],              // référence média, JAMAIS de base64
  diagramRefs[],                   // entityRef {type:'diagram'} — pas un dessin embarqué

  blocks[] {                       // l'éditeur structuré
    id, kind:'titre'|'texte'|'etape'|'image'|'tableau'
        |'avertissement'|'info'|'conseil'|'erreur'|'validation'|'lien',
    ...contenu selon kind
  },

  steps[] {                        // dérivé des blocs kind='etape'
    id, order, code:'01', title:'NACQ', role:'Source', accent,
    type,                          // réutilise PROCEDURE_STEP_TYPES
    equipmentRefs[],               // « POSTE / ÉQUIPEMENT » → référence, pas du texte
    software[], actions[], result,
    mediaIds[],
    notes[] { title, body, status:'active'|'pending' },
    outcomes[] {                   // le branchement conditionnel
      label:'OK'|'NOK'|libre, nextStepId, action:'continue'|'goto'|'create-ticket'|'end'
    }
  },

  infoBlocks[] { kind, title, items[] { label, value, secret:boolean } },
  safetyRule { text, severity },
  support { text, contactRef },
  acknowledgements[] { userId, acknowledgedAt }
}
```

### `procedure_executions`

```
{ id, procedureId, versionId, startedBy, startedAt, finishedAt,
  outcome:'reussie'|'echouee'|'abandonnee',
  contextRefs[],                   // salle/équipement réels de l'intervention
  stepResults[] { stepId, result:'ok'|'nok'|'skipped', comment, mediaIds[], at },
  failedStepId, createdTicketId }
```

C'est ce dernier store qui fait la valeur opérationnelle : il répond à « cette procédure
échoue-t-elle toujours à l'étape 5 ? », question qu'aucun PDF ne peut poser.

---

## 4. Correction obligatoire — les identifiants

L'exemple fourni contient `Utilisateur NACQ : nacq`, `Mot de passe NACQ : nacq`,
`Utilisateur NORM : norm`, et l'adresse `172.31.22.200`. Stockés tels quels dans un document,
ils partent dans l'instantané `/api/sync` vers **tous** les clients, dans chaque export et
dans chaque sauvegarde JSON.

1. `infoBlocks[].items[].secret = true` marque la donnée.
2. Les valeurs secrètes **ne sont jamais dans le corps du document** : enregistrement séparé,
   servi à la demande par `GET /api/procedures/:id/secrets` sous permission
   `procedure.secrets.read`.
3. **Exclues** de la synchronisation, des exports et des impressions pour qui n'a pas la
   permission ; l'emplacement affiche « valeur protégée » avec un bouton 🔐.
4. Chaque consultation est journalisée — précisément le type d'action que le journal actuel ne
   trace pas (H-13).
5. À l'import d'un document existant, un détecteur signale `mot de passe|password|utilisateur|
   login|identifiant` pour que l'auteur classe, au lieu d'importer en clair silencieusement.

Recommandation de fond : une procédure ne devrait pas porter de mot de passe de service. Le
champ reflète la réalité du terrain ; il la rend traçable et cloisonnée, il ne l'encourage pas.

---

## 5. Correction obligatoire — le stockage des fichiers

**Constat vérifié.** Toutes les images sont aujourd'hui converties en base64 et **insérées
dans l'enregistrement** (`tickets.js:208`, `system-settings.js:23`, `equipments.images[]`). Le
store `attachments` existe (`db.js:51`) mais ses deux fonctions (`db.js:142-143`) **n'ont
aucun appelant** — il est mort.

Or `/api/sync` renvoie un instantané **complet, toutes les 20 secondes, à chaque client**. Une
infographie comme l'exemple pèse plusieurs centaines de kilo-octets et grossit d'un tiers en
base64. Vingt procédures importées, et chaque poste retélécharge plusieurs méga-octets toutes
les 20 secondes.

**Le module ne peut pas être livré sans stockage média réel.**

```
media { id, mimeType, size, sha256, filename, width, height, pageCount,
        createdBy, createdAt, zoneIds }
```

- binaire hors `platform_records`, servi par `GET /api/media/:id` avec contrôle d'accès
- `ETag` immuable via `sha256` (contenu adressable ⇒ cache indéfini) et déduplication
- **exclu de `/api/sync`** : seules les métadonnées circulent
- type MIME sur liste blanche, taille maximale, vignette générée
- **Viewer intégré** : PDF et images s'ouvrent en plein écran avec zoom, sans téléchargement
  obligatoire

Ce chantier corrige aussi les pièces jointes de tickets et les images d'équipements : c'est un
prérequis partagé, pas un coût propre aux procédures.

---

## 6. Correction obligatoire — le piège des zones

**Constat vérifié (H-15).** Un `docs` dont la zone n'est pas résoluble est refusé en 403
(`access-control.js:351`), `central-sync.js:195` relance l'exception, et les appels d'écriture
ne sont pas entourés de `try/catch`. L'échec est **silencieux** : l'enregistrement est écrit
localement puis supprimé.

Sans traitement, **un technicien qui rédige une procédure la verrait disparaître sans
explication**. Donc `zoneIds` est obligatoire à la création, pré-rempli depuis la salle ou le
service, et le formulaire refuse l'enregistrement côté client — avant l'appel réseau — tant
qu'aucune zone n'est résolue.

---

## 7. Droits — corrigés pour 6 rôles

| Action | Visiteur | Technique | Responsable | Chef | Manager | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Lire une procédure publiée | selon zone | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Exécuter** (mode pas-à-pas) | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Créer un brouillon | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Modifier son brouillon | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Modifier une procédure publiée | — | — | ✓ | ✓ | ✓ | ✓ |
| Valider | — | — | ✓ | ✓ | ✓ | ✓ |
| Publier | — | — | ✓ | ✓ | ✓ | ✓ |
| Lire les secrets | — | selon octroi | ✓ | ✓ | ✓ | ✓ |
| Exiger un accusé de lecture | — | — | ✓ | ✓ | ✓ | ✓ |
| Archiver | — | — | — | ✓ | ✓ | ✓ |
| Supprimer | — | — | — | — | — | ✓ |

Permissions correspondantes : `procedure.read`, `procedure.execute`, `procedure.create`,
`procedure.edit`, `procedure.publish`, `procedure.validate`, `procedure.secrets.read`,
`procedure.archive`, `procedure.delete`.

**Créer et publier restent séparés** : sinon une procédure non relue prend l'apparence d'un
document officiel.

**Question ouverte** : le tableau donne la validation au Responsable **et** au Chef. Or le
modèle à 6 rôles distingue le Chef (autorité temporelle, sur une vacation) du Responsable
(autorité durable, sur un périmètre). Pour une procédure — qui est un actif durable — la
validation devrait logiquement revenir au **Responsable**, le Chef ne validant que les
procédures d'exploitation de vacation. À trancher.

---

## 8. Liaison avec la plateforme

C'est le point décisif : une procédure isolée dans sa page n'apporte presque rien.

| Depuis | On voit / on peut |
|---|---|
| **Fiche équipement (360)** | Onglet Procédures : celles dont une étape référence cet équipement |
| **Salle / Baie / Pupitre** | Onglet Procédures du lieu (via `entityRefs` et `scopeRefs`) |
| **Port / Câble** | Les procédures qui manipulent ce port ou ce câble |
| **Ticket** | Procédures recommandées selon l'entité et le symptôme ; bouton « Démarrer la procédure » |
| **Diagnostic écrans** | La procédure appliquée est rattachée au diagnostic |
| **Continuité** | Les procédures `category:'continuity'` — page inchangée |
| **Recherche** | Indexation profonde : titre, description, **étapes**, équipements, salles, baies, câbles, ports, tags |
| **Journal** | Publication, validation, archivage, consultation de secret, **et chaque exécution** |
| **QR** | Un QR sur une baie ouvre ses procédures ; sur un équipement, sa fiche complète |
| **Intégrité** | Procédure référençant une entité supprimée ; procédure publiée dont la revue est échue |
| **Hors-ligne** | Les procédures marquées critiques sont mises en cache par le service worker |

**Créer une procédure depuis un incident résolu** : à la clôture d'un ticket, un bouton
reprend problème, équipement, salle, actions réalisées, solution, images et commentaires pour
produire un **brouillon**. Le responsable révise puis publie. C'est le mécanisme qui empêche
le savoir des techniciens de rester enfermé dans des tickets fermés.

**Point d'intégrité indispensable** : le résolveur `referencesTo()` prévu dans
`ARCHITECTURE-DESIGN.md` §C.4 **doit inclure les procédures**. Sans cela, supprimer un
équipement laisserait des procédures pointant dans le vide — exactement le défaut H-05 relevé
pour les tickets.

---

## 9. Fichiers impactés

| Fichier | Changement |
|---|---|
| `continuity-contract.js` | Généraliser : `protectionGroupId` et l'étape `secure`/`switch` conditionnels à `category==='continuity'` |
| `continuity-center.js` | Filtre sur `category:'continuity'` — aucune régression |
| `db.js` | Stores `procedures`, `procedure_versions`, `procedure_executions`, `media` ; `attachments` mort remplacé |
| `scripts/serve.js` | `GET/POST /api/media`, `GET /api/procedures/:id/secrets`, exclusion des médias de `/api/sync`, validation des références d'étapes, immuabilité des versions validées |
| `scripts/access-control.js` | Permissions `procedure.*`, résolution de zone |
| `permissions.js` / `authz-model.js` | Entité `procedures` dans la matrice (elle manque, comme 7 autres sections) |
| `navigation-contract.js` | Route `procedures` |
| chaîne `initSections` | Nouvelle section, insérée comme les autres |
| `qr.js` | QR depuis une référence d'entité, pas seulement `numSerie` |
| `data-integrity.js` | Deux contrôles nouveaux (§8) |
| `service-worker.js` | Cache des procédures critiques et de leurs médias |
| `tickets.js` | « Procédures recommandées » + « Démarrer » + création depuis résolution |

---

## 10. Livraison par incréments

Chaque incrément est utilisable seul.

| # | Contenu | Valeur livrée |
|---|---|---|
| **1** | **Stockage média + viewer** | Prérequis partagé ; corrige aussi tickets et équipements |
| **2** | Procédure en mode document : import image/PDF, code, service, zones, criticité, statut, liens | **L'exemple fourni est publiable dès ici** |
| **3** | Généralisation du contrat + éditeur structuré en blocs | Étapes, logiciels, actions, résultat — natif dans la plateforme |
| **4** | Secrets cloisonnés + journalisation des consultations | Ferme la fuite d'identifiants |
| **5** | Liaisons : équipement, salle, baie, port, câble, ticket, diagnostic, QR, recherche, intégrité | Le module cesse d'être une île |
| **6** | Workflow : brouillon → révision → validée → publiée → archivée, versions immuables, revue échue | Gouvernance documentaire |
| **7** | **Mode Exécution pas-à-pas** + enregistrement des exécutions | La procédure guide au lieu d'être lue |
| **8** | **Branchements SI/ALORS** + ticket auto depuis l'étape en échec | SOP interactive reliée au Diagnostic |
| **9** | Accusés de lecture, favoris, récentes, hors-ligne, tableau de bord | Confort de vacation et conformité |
| **10** | Créer une procédure depuis un incident résolu | Capture du savoir |

L'ordre n'est pas négociable sur deux points : **1 avant tout** (sans stockage média, tout
import dégrade la synchronisation pour tous les postes), et **5 avant 7** (exécuter une
procédure qui ne sait pas quel équipement elle manipule ne produit aucune donnée exploitable).

---

## 11. Questions à trancher

1. **Qui valide** : Responsable, Chef, ou les deux selon la catégorie ? (voir §7)
2. Un **Visiteur** voit-il les procédures publiées de sa zone, ou aucune ?
3. **Date de revue obligatoire** — une procédure non revue depuis N mois passe en « à
   revérifier » ? Recommandé en exploitation d'antenne, mais c'est une contrainte pour les
   rédacteurs.
4. Les **identifiants** restent-ils dans la plateforme, cloisonnés, ou renvoient-ils vers un
   coffre externe ? Le modèle supporte les deux.
5. L'**accusé de lecture** est-il exigé sur toutes les procédures critiques, ou au cas par cas ?

---

## Annexe — écran de démarrage

La proposition de splash (assemblage du logo pièce par pièce, rotation pendant le chargement,
arrêt et stabilisation à 100 %) décrit **ce qui est déjà livré** :

- `startup-splash.css` — `@keyframes startup-piece-in` avec
  `animation-delay: calc(var(--piece-index)*.11s)` : les 8 pièces entrent en séquence
- rotation continue (`startup-ring-spin`) et ligne de balayage pendant le chargement
- barre de progression liée aux **étapes réelles** d'initialisation (`core.js:28-49`)
- état `.startup-ready` : le balayage s'efface, le logo se stabilise
- `prefers-reduced-motion` respecté
- et le logo est **déjà vectoriel** (`STAR_SEGMENT_PATH`, `startup-splash.js:16`), pas une
  image matricielle

Le seul point légitime de cette proposition est la **fidélité géométrique** : le chemin SVG
est écrit à la main et répété 8 fois à 45°. Vérifier qu'il correspond à la charte demande le
fichier vectoriel officiel — la remarque est juste, et c'est la seule chose à demander au
service communication.

Les deux vrais défauts du démarrage, non mentionnés par la proposition, sont dans
`MASTER-AUDIT-STATE.md` :

- **S-01** — l'écran de connexion écrase `#app` et détruit le splash, si bien que la
  synchronisation initiale (l'étape la plus longue) se déroule devant un formulaire figé, sans
  aucun retour visuel.
- **S-02** — 2,62 s d'attente artificielle imposées à chaque démarrage
  (`MIN_SPLASH_DURATION_MS = 2200` + 420 ms de sortie).

Corriger ces deux points apporte davantage que redessiner une animation qui fonctionne.
