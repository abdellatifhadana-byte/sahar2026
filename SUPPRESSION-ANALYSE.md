# Fichiers hors plateforme — analyse avant suppression

Rien n'est supprimé sur une impression. Chaque fichier candidat a été soumis à deux
questions, dans cet ordre :

1. **Est-il atteignable depuis `index.html` ?** — mesuré par un parcours du graphe
   d'imports, pas par lecture à l'œil.
2. **Contient-il une idée que la plateforme n'a PAS ?** — comparaison des symboles
   exportés et des API navigateur employées contre l'intégralité du code actif.

Un fichier n'est proposé à la suppression que lorsque la réponse est « non » aux deux.
Quand la réponse à la seconde est « oui », l'idée est extraite et documentée ici avant
que le fichier ne disparaisse.

**Mesure de référence : 141 modules actifs et transitifs atteignables depuis
`index.html`.** Tout le reste est inerte au chargement.

---

## A. Ce qui EST utilisé, malgré les apparences

Trois fichiers paraissent orphelins à une recherche naïve. Ils ne le sont pas, et ne
doivent pas être supprimés.

| Fichier | Pourquoi il ne sort pas du graphe d'imports | Verdict |
|---|---|---|
| `service-worker.js` | Enregistré à l'exécution par `sw-register.js` via `navigator.serviceWorker.register('/service-worker.js')`, jamais importé | **CONSERVER** |
| `assets/chart.js` | Chargé par une balise `<script>` classique, hors module ES | **CONSERVER** |
| `login.css`, `startup-splash.css` | Feuilles de style, hors graphe JS | **CONSERVER** |

En revanche, `Chart.js` **à la racine** (208 Ko) est un doublon : c'est `assets/chart.js`
qui est chargé. Il est proposé à la suppression.

---

## B. Idées réelles trouvées dans les fichiers à supprimer

Voici la réponse à « pourquoi n'a-t-elle pas été ajoutée, et comment la relier ».

### B-1. Expiration et annulation des requêtes — `api.js`

**L'idée.** Une couche HTTP qui associe à chaque requête un `AbortController` et un délai
d'expiration, et qui sait toutes les annuler d'un coup :

```js
const controller = new AbortController();
const timeout = setTimeout(() => { controller.abort(); … }, options.timeout || 15000);
cancelAllRequests() { this.pendingRequests.forEach(c => c.abort()); }
```

**Pourquoi elle n'a pas été ajoutée.** `api.js` vise un serveur qui n'existe pas
(`https://api.2mtech.example.com/v1`) et importe `{ auth }` alors qu'`auth.js` exporte une
classe par défaut : le fichier lèverait une erreur à l'import. C'est un prototype d'une
architecture antérieure, abandonné avant d'être relié.

**Ce que la plateforme a aujourd'hui.** `central-sync.js` appelle `fetch` **sans aucun
délai d'expiration et sans annulation**, et relance une synchronisation **toutes les
20 secondes**. Une requête qui reste pendue — réseau dégradé, serveur bloqué — n'est
jamais abandonnée, et les suivantes s'empilent derrière elle.

**Comment la relier.** Dans la fonction `api()` de `central-sync.js` : un `AbortController`
par requête, un délai d'expiration configurable, et l'annulation des requêtes en vol à la
déconnexion et lorsque l'onglet passe en arrière-plan. C'est un ajout local à une seule
fonction, sans effet sur les appelants.

**Valeur : élevée.** Corrige un empilement silencieux que rien ne signale aujourd'hui.

### B-2. Sauvegardes listées et purgées — `backup-manager.js`

**L'idée.** `listBackups()`, `cleanupOldBackups()`, `downloadBackup(id)` : des sauvegardes
**conservées et consultables**, avec purge des plus anciennes.

**Ce que la plateforme a aujourd'hui.** `backup-service.js` déclenche
`startAutoBackup('weekly')`, qui appelle `exportToFile()` — c'est-à-dire un
**téléchargement de fichier**, toutes les semaines, sans action de l'utilisateur. Aucune
sauvegarde n'est conservée dans la plateforme, aucune n'est listable, et un téléchargement
déclenché sans geste utilisateur est de toute façon bloqué par les navigateurs modernes.

**Comment la relier.** Un magasin `backups` en base locale, alimenté par
`createBackup()` — qui existe déjà — avec une liste consultable depuis Paramètres, un
bouton de téléchargement à la demande, et une purge conservant les N dernières. La
restauration tolérante aux pannes est déjà en place et s'y branche telle quelle.

**Valeur : élevée.** La sauvegarde automatique actuelle ne produit probablement aucune
sauvegarde exploitable.

### B-3. Force du mot de passe — `utils.js`

**L'idée.** `checkPasswordStrength()` : contrôle de robustesse à la saisie.

**Ce que la plateforme a aujourd'hui.** Aucune vérification. La création d'utilisateur
accepte n'importe quel mot de passe.

**Comment la relier.** Dans le formulaire de création et de modification d'utilisateur,
avec un indicateur visuel et un refus sous un seuil. Le serveur doit appliquer la même
règle — un contrôle uniquement côté navigateur ne protège de rien.

**Valeur : élevée, et de sécurité.**

### B-4. Historique des notifications — `utils/notifications.js`

**L'idée.** `getHistory()` : les notifications passées restent consultables.

**Ce que la plateforme a aujourd'hui.** `NotificationSystem` affiche puis oublie au bout de
cinq secondes. Un technicien qui quitte son écran manque définitivement le message — y
compris, désormais, les avertissements d'écriture refusée relayés en arrière-plan.

**Comment la relier.** Un tampon circulaire dans `NotificationSystem`, plus un panneau
consultable depuis l'en-tête. Aucune écriture en base nécessaire.

**Valeur : moyenne à élevée**, d'autant plus que la plateforme relaie maintenant des
échecs d'arrière-plan par ce canal.

### B-5. Score de pertinence de recherche — `search.js`

**L'idée.** `calculateMatchScore()` et `autoComplete()` : classement des résultats par
pertinence plutôt que par ordre d'apparition.

**Ce que la plateforme a aujourd'hui.** La recherche globale filtre par sous-chaîne et
affiche dans l'ordre du magasin.

**Comment la relier.** Une fonction de score pure dans un module contrat — correspondance
exacte, préfixe, sous-chaîne, champ concerné — appliquée au tri des résultats existants.
Aucun changement de données.

**Valeur : moyenne.** Confort réel dès que l'inventaire grossit.

### B-6. Taille de fichier lisible — `utils.js`

**L'idée.** `formatFileSize()` : « 2,4 Mo » au lieu de « 2516582 ».

**Ce que la plateforme a aujourd'hui.** Des limites en octets (3 Mo pour une image de mur)
mais aucun affichage lisible.

**Valeur : faible, mais l'effort l'est aussi.**

### B-7. Purge des données anciennes — `utils/db.js`

**L'idée.** `cleanupOldData()` : bornage de la croissance des magasins volumineux.

**Ce que la plateforme a aujourd'hui.** Les journaux et notifications croissent sans borne.

**Comment la relier.** Une purge par ancienneté sur `logs` et `notifications`, déclenchée
au démarrage, avec un seuil réglable dans Paramètres. **Attention :** le journal est une
preuve de ce qui a été fait ; toute purge doit être décidée par le client et jamais
appliquée par défaut sans son accord.

**Valeur : moyenne, avec précaution.**

---

## C. Ce qui ne contient AUCUNE idée absente

Vérifié symbole par symbole contre le code actif : ces fichiers sont des doublons ou des
prototypes dont chaque capacité existe déjà.

| Fichier | Nature | Ce qui le remplace aujourd'hui |
|---|---|---|
| `map-digital-twin-contract.js` | Doublon exact | `map-digital-twin.js` réimplémente les **douze** fonctions, huit en privé (`requiresFieldAttention`, `activeTickets`, `ticketIndex`, `roomOf`, `baieOf`, `displayName`…) |
| `core2.js` | Second point d'entrée | `core.js`, jamais importé par personne |
| `sync-manager.js`, `utils/offline-manager.js` | Prototypes de file hors ligne | `central-sync.js` : file d'attente, rejets permanents, statut |
| `utils/db.js` | Ancienne couche de données | `db.js` + `db-migration-v15.js` |
| `utils/security.js`, `assets/js/utils/security.js` | Doublons | `security.js` actif |
| `utils/helpers.js`, `assets/js/utils/helpers.js` | Doublons | dispersés dans les modules actifs |
| `docs.js`, `faq.js` | Fenêtres autonomes | `equipment-smart-knowledge.js`, `continuity-center.js` |
| `tech-motivation.js`, `tech-dashnoard.js` | Prototypes (le second au nom fautif) | `techui.js`, `dashboard.js` |
| `assets/js/scripts.js`, `assets/js/data.js`, `assets/js/modal.js` | Application pré-modules | l'ensemble des modules ES actuels |
| `Chart.js` (racine) | Doublon de `assets/chart.js` | `assets/chart.js`, seul chargé |
| `style.css`, `tech-dashboard.css`, `assets/css/*` | Feuilles jamais liées | les feuilles listées dans `index.html` |

**Une observation qui compte plus que la suppression elle-même :**
`map-digital-twin-contract.js` n'est pas un fichier oublié, c'est un contrat **recopié**
dans son module d'implémentation au lieu d'y être importé. Deux copies des mêmes règles
peuvent diverger — c'est exactement la classe de défaut corrigée dans M-12, H-04 et H-08.
La suppression du doublon est donc la bonne issue, mais l'implémentation gagnerait à
exposer ses règles plutôt qu'à les garder privées.

---

## D. Répertoires hérités

| Répertoire | Fichiers | Nature |
|---|---|---|
| `LEGACY-ROOT/` | 26 | Copie historique de la racine, explicitement exclue de la vérification de syntaxe en CI |
| `app/` | 31 | Application antérieure aux modules ES |
| `assets/js/app/` | 30 | Copie de `app/` |
| `SOURCE-WALLS/` | 4 | Sources du mur d'images, antérieures à `wall-manager.js` |

**91 fichiers.** Le graphe des modules confirme qu'aucun n'est importé : *« 141 modules
actifs et transitifs résolus ; aucune copie historique n'est importée. »*

**Réserve à lever avant suppression :** le pipeline `verify.yml` vérifie l'existence de
fichiers précis et exclut ces répertoires du contrôle de syntaxe. Leur suppression doit
s'accompagner du retrait de ces exclusions, sans quoi la CI référencerait des chemins
absents.

---

## E. Proposition, par ordre de risque croissant

| Lot | Contenu | Fichiers | Risque |
|---|---|---|---|
| **1** | Doublons prouvés : `Chart.js`, `core2.js`, `map-digital-twin-contract.js`, `style.css`, `tech-dashboard.css`, `assets/css/*` | 13 | Très faible |
| **2** | Prototypes sans idée absente : `sync-manager.js`, `utils/*`, `docs.js`, `faq.js`, `tech-motivation.js`, `tech-dashnoard.js`, `assets/js/*` | 15 | Faible |
| **3** | `SOURCE-WALLS/` | 4 | Faible |
| **4** | `app/`, `assets/js/app/` | 61 | Moyen — vérifier d'abord les références en CI |
| **5** | `LEGACY-ROOT/` | 26 | Moyen — même réserve |
| **—** | ~~`api.js`, `backup-manager.js`~~ | 2 | **Retirés le 20/08/2026** — B-1 et B-2 étaient déjà portées (voir section F) |

Les sept idées de la section B sont indépendantes de la suppression : elles peuvent être
portées avant, et les fichiers disparaître ensuite. Aucune ne dépend du fichier d'origine,
qui ne fonctionnerait de toute façon pas en l'état.

---

## F. Ce qui a été fait — 20/08/2026

Ce document annonçait `api.js` et `backup-manager.js` « à conserver jusqu'à extraction » des
idées B-1 et B-2. **L'extraction avait déjà eu lieu**, et la note n'avait pas suivi. Vérifié
fichier par fichier avant toute suppression :

| Idée | État réel | Où elle vit maintenant |
|---|---|---|
| B-1 · expiration et annulation des requêtes | **portée** | `central-sync.js` : un `AbortController` par requête, délai `REQUEST_TIMEOUT_MS`, ensemble `enVol` pour tout annuler, et une erreur `408 REQUEST_TIMEOUT` distincte d'une panne serveur pour que la file retente au lieu de rejeter |
| B-2 · sauvegardes listées et purgées | **portée** | `backup-service.js` : magasin `backups`, `listBackups()`, purge bornée ; liste affichée par `system-settings.js` |
| B-3 · force du mot de passe | **portée** | `password-policy.js`, appliquée côté navigateur (`users.js`) ET côté serveur (`scripts/serve.js`) |
| B-6 · taille de fichier lisible | **portée** | `system-settings.js` |

### Huit fichiers retirés

`api.js` · `backup-manager.js` · `core2.js` · `docs.js` · `faq.js` · `sync-manager.js` ·
`tech-dashnoard.js` · `tech-motivation.js` — 1 297 lignes.

Vérifié avant : aucune référence depuis un `.js`, un `.html` ou un `.json` ; aucun n'est
préchargé par le service worker — ce qui aurait fait échouer son installation entière, car
`cache.addAll` rejette si UNE seule ressource manque.

Vérifié après : 783 tests, 156 modules résolus (inchangé — ils n'y étaient jamais), 6/6
contrôles de structure, et dans le navigateur 20 sections sur 20, **0 requête 404, 0 erreur JS**.

### `Chart.js` est CONSERVÉ, et voici pourquoi

Ce n'est pas un doublon : c'est la bibliothèque de graphiques, et `techui.js` — bien vivant,
importé par huit modules — s'en sert sous condition :

```js
if (typeof Chart !== 'undefined') { this.chartInstance = new Chart(ctx, …); }
else { ctx.parentNode.innerHTML = '<p>Charting library (Chart.js) not loaded…</p>'; }
```

Or **rien ne charge le fichier** : zéro mention dans `index.html`, aucun import, absent du
service worker. Le graphique d'inventaire du technicien affiche donc TOUJOURS le message de
repli — en anglais, que `french-ui-guard.js` traduit ensuite en « Bibliothèque de graphiques
indisponible ».

Supprimer la bibliothèque fermerait la seule porte de sortie. Le défaut est réel et reste
ouvert : soit charger `Chart.js` et le graphique fonctionne, soit retirer le code mort de
`techui.js` — mais c'est une décision de produit, pas de ménage.
