# A-1 — sort des habilitations héritées de `room.responsibleId`

**Correctif** : branche `fix/security-responsibleid-p0`, base `a3e2dd0`.
**Ce document ne décrit AUCUNE action automatique.** Le correctif ne supprime rien. Il
ferme la fabrication de nouvelles habilitations ; le sort des anciennes se décide ici, à
part, et sous le regard d'un administrateur.

---

## 1. Ce que l'ancien chemin a écrit

`ensureModel()` écrivait, à **chaque démarrage**, pour toute salle portant un
`responsibleId` :

| magasin | ligne écrite | signature reconnaissable |
|---|---|---|
| `zone_grants` | jusqu'à 24 habilitations | `source = 'room-responsible-migration'` |
| `zone_memberships` | une adhésion `responsible: true` | `authVersion = 1` **et** aucun `updatedAt` |

Les habilitations sont **formellement reconnaissables** : `source =
'room-responsible-migration'` n'est écrit que par ce code, qui n'existe plus. Les adhésions
le sont **par présomption seulement** — `authVersion: 1` sans `updatedAt` est la forme que
laissait `put()` direct, mais rien n'interdit à une adhésion légitime de lui ressembler.

Toutes portent `grantedBy: 1`. **Cette imputation est fausse** : l'administrateur global
n'a rien décidé. C'est précisément pourquoi ces lignes ne peuvent pas être triées
automatiquement — la base ne sait pas qui a réellement provoqué chacune.

---

## 2. Pourquoi rien n'est supprimé automatiquement

Trois raisons, dans cet ordre :

1. **L'origine n'est pas imputable ligne à ligne.** `access_audit` est vide pour ces actes.
   Rien ne distingue, dans la base, l'habilitation née d'une escalade de celle née d'une
   assignation qu'un administrateur aurait approuvée s'il en avait eu l'occasion.
2. **Une suppression en masse est une panne d'exploitation.** Un responsable réellement en
   poste depuis des mois perdrait `equipment.edit`, `continuity.validate` et
   `diagram.validate` sans préavis, au redémarrage suivant.
3. **Un démarrage n'est pas le lieu d'une purge.** C'est l'erreur que ce correctif répare :
   `ensureModel()` ne doit plus décider d'autorisations, ni dans un sens ni dans l'autre.

L'épreuve `A-1·17` verrouille ce choix : un démarrage laisse les lignes héritées intactes,
provenance comprise, pour que la migration puisse encore les reconnaître.

---

## 3. Inventaire — lecture seule, à exécuter d'abord

```sql
-- 3.1 · Combien d'habilitations héritées, et pour qui ?
SELECT data->>'userId'   AS utilisateur,
       data->>'zoneId'   AS zone,
       count(*)          AS habilitations,
       bool_or(data->>'permission' = 'access.review') AS administre_la_zone
  FROM platform_records
 WHERE store_name = 'zone_grants' AND deleted = FALSE
   AND data->>'source' = 'room-responsible-migration'
   AND data->>'status' = 'active'
 GROUP BY 1, 2
 ORDER BY habilitations DESC;

-- 3.2 · Ces habilitations correspondent-elles encore à un responsable DÉCLARÉ ?
--       Une ligne à `encore_responsable = false` est un résidu : le responsable a changé,
--       et l'ancien chemin ne révoquait jamais rien.
WITH heritees AS (
  SELECT data->>'userId' AS utilisateur,
         data->>'zoneId' AS zone,
         count(*)        AS habilitations
    FROM platform_records
   WHERE store_name = 'zone_grants' AND deleted = FALSE
     AND data->>'source' = 'room-responsible-migration'
     AND data->>'status' = 'active'
   GROUP BY 1, 2
)
SELECT h.utilisateur, h.zone, h.habilitations,
       EXISTS (SELECT 1
                 FROM platform_records r
                 JOIN platform_records rz
                   ON rz.store_name = 'resource_zones' AND rz.deleted = FALSE
                  AND lower(rz.data->>'resourceType') LIKE 'room%'
                  AND rz.data->>'resourceId' = r.record_id
                  AND rz.data->>'zoneId' = h.zone
                WHERE r.store_name = 'rooms' AND r.deleted = FALSE
                  AND r.data->>'responsibleId' = h.utilisateur) AS encore_responsable
  FROM heritees h
 ORDER BY encore_responsable, h.habilitations DESC;

-- 3.3 · Habilitations AU-DESSUS du plafond du rôle : le cas le plus urgent.
--       Elles sont inertes aujourd'hui (`roleAllows` les refuse à l'exécution) et
--       s'activeraient le jour d'une promotion du compte.
SELECT g.data->>'userId' AS utilisateur, u.data->>'role' AS role,
       array_agg(g.data->>'permission' ORDER BY g.data->>'permission') AS hors_plafond
  FROM platform_records g
  JOIN platform_records u
    ON u.store_name = 'users' AND u.deleted = FALSE AND u.record_id = g.data->>'userId'
 WHERE g.store_name = 'zone_grants' AND g.deleted = FALSE
   AND g.data->>'source' = 'room-responsible-migration'
   AND g.data->>'status' = 'active'
   AND u.data->>'role' IN ('visitor', 'technician')
 GROUP BY 1, 2;

-- 3.4 · Adhésions responsables présumées héritées (présomption, pas preuve).
SELECT data->>'userId' AS utilisateur, data->>'zoneId' AS zone
  FROM platform_records
 WHERE store_name = 'zone_memberships' AND deleted = FALSE
   AND data->>'responsible' = 'true'
   AND data->>'authVersion' = '1'
   AND NOT (data ? 'updatedAt');
```

---

## 4. Chemin de migration proposé — par décision, jamais par lot

> **Correction du 2026-09-17 (revue indépendante, A1-D1).** Une version antérieure de ce
> document affirmait qu'un administrateur pouvait « réaffirmer » une autorité héritée en
> réenregistrant la salle avec le **même** `responsibleId`. **C'est faux, deux fois :**
>
> 1. `responsibleChangeRequested()` renvoie délibérément `false` quand la valeur entrante
>    égale la valeur stockée — un enregistrement ordinaire ne déclenche donc AUCUNE
>    assignation. C'est voulu : une sauvegarde de formulaire ne doit jamais muter
>    silencieusement une autorisation.
> 2. Même un **retrait puis un ré-ajout** ne convertit pas la ligne héritée. Elle est
>    encore effective, donc le chemin canonique la **saute** au lieu de se l'approprier —
>    exactement la protection qui empêche de capturer un octroi explicite (épreuve A-1·16).
>
> La conversion exige donc de **révoquer la ligne héritée d'abord**. C'est l'ordre ci-dessous.
> Aucune opération nouvelle n'est introduite : `DELETE /api/access/grants/:id` et
> l'enregistrement de la salle existent déjà.

L'ordre compte : on **révoque puis on repose**, et l'on traite le hors-plafond avant tout.

1. **Publier l'inventaire** (§3) à l'administrateur global. Aucune écriture.
2. **Traiter d'abord §3.3** — les habilitations hors plafond. Elles ne servent à personne
   aujourd'hui et ne peuvent que nuire demain : les révoquer par
   `DELETE /api/access/grants/:id`, qui passe par `revokeGrant`, donc par `audit()`.
3. **Révoquer les résidus** — les couples de §3.2 marqués `encore_responsable = false`.
   Ce sont d'anciens responsables que l'ancien chemin n'a jamais révoqués. Un
   `DELETE /api/access/grants/:id` par ligne, après validation humaine.
4. **Convertir les responsables légitimes**, un couple (utilisateur, zone) à la fois parmi
   ceux de §3.2 marqués `encore_responsable = true`. Pour chacun, **dans cet ordre** :

   a. retirer le responsable de la salle (`responsibleId` vidé) — l'autorité héritée n'est
      pas révoquée à cette étape, puisqu'elle ne porte pas la provenance de ce chemin ;
   b. révoquer ses lignes `room-responsible-migration` de cette zone par
      `DELETE /api/access/grants/:id` ;
   c. reposer le `responsibleId` sur la salle.

   L'étape (c) recrée alors chaque habilitation par le chemin canonique : `grantedBy` =
   l'administrateur réel, `source = 'room-responsible'`, une entrée `access_audit`, et le
   plafond de rôle appliqué. La ligne cesse d'être héritée : elle devient une décision datée.

   > Entre (a) et (c), le responsable est **sans ses droits de zone**. Conduire cette
   > conversion salle par salle, en dehors des heures d'antenne.

5. **Adhésions (§3.4) : ne rien faire.** Une adhésion `responsible: true` sans
   `responsibleSource` est traitée par le code comme une **décision explicite** et n'est
   jamais rétrogradée automatiquement (épreuve A-1·22). C'est délibérément conservateur :
   ce qu'on ne sait pas attribuer n'est pas retiré. Si l'inventaire révèle une adhésion
   qu'aucune salle ni aucune décision ne justifie, la retirer **à la main** depuis Accès
   Zone, où l'acte est tracé et imputé.

**Fin de migration** : quand `source = 'room-responsible-migration'` ne renvoie plus aucune
ligne active (§3.1 vide). C'est la seule définition qui se vérifie par une requête.

## 5. Ce que le correctif garantit pendant tout ce temps

Rien ne se dégrade en attendant que la migration soit conduite :

- aucune habilitation **nouvelle** n'est créée par un démarrage ni par une modification de
  salle (épreuves `A-1·1` à `A-1·3`, et preuve PostgreSQL : 23 habilitations avant, 0 après) ;
- les lignes héritées restent **inertes au-dessus du plafond de rôle** — `roleAllows` les
  refuse à l'exécution, comme avant le correctif ;
- toute assignation à partir de maintenant est imputée, plafonnée, tracée et révocable.

Le risque résiduel est donc **borné à l'existant**, et il ne grandit plus.

---

## 6. Tous les écrivains de `responsibleId` — et ce que chacun fait (ronde 3)

Cinq chemins touchent au responsable d'une salle. Avant la ronde 3, **un seul** posait
l'autorité correspondante ; les quatre autres écrivaient le champ et laissaient
`zone_memberships` / `zone_grants` dire autre chose.

| Chemin | Garde d'autorité | Réconciliation |
|---|---|---|
| `PUT /api/data/rooms/:id` | `RESPONSIBLE_ASSIGN_ADMIN_ONLY` | oui, transactionnelle |
| `POST /api/rooms/transfer` | idem — **et** sur le DÉPLACEMENT d'une salle qui porte un responsable | oui, après le lot entier |
| `DELETE /api/data/rooms/:id` | la suppression est déjà gardée | oui, après la pierre tombale |
| `POST /api/access/resource-zones` | `ADMIN_REQUIRED` (déjà) | oui, zones d'avant capturées |
| `POST /api/sync/bootstrap` | `isPlatformAdmin` (déjà) | oui, après `ensureModel()` |

La règle est écrite **une seule fois**, dans `reconcileRoomResponsible()` : pour chaque
couple (utilisateur, zone) concerné, l'autorité dérivée vaut exactement ce que disent les
salles. Elle s'applique aux zones d'**avant** et d'**après** l'écriture — sans quoi un
déplacement A→B ne verrait jamais la zone A qu'il quitte.

### R8 — ce que fait l'amorçage, et pourquoi

**Décision : l'amorçage canonise (option A).** Un `POST /api/sync/bootstrap` portant
`room.responsibleId` crée désormais l'autorité correspondante par le chemin canonique.

Ce n'est **pas** un retour au comportement supprimé par A-1. L'ancien `ensureModel()`
octroyait **au démarrage**, sans acteur, sans plafond de rôle et sans trace. Ici :

- la route est déjà réservée à l'administrateur global (`isPlatformAdmin`) ;
- l'acte est **imputé à cet administrateur**, pas à `grantedBy: 1` en dur ;
- il passe par `grantPermission` / `ensureMembership` : plafonds, provenance, audit ;
- il s'exécute **une fois, à l'import**, jamais à chaque redémarrage.

Les deux autres options ont été écartées : *rejeter le champ* (B) casserait la
restauration d'une sauvegarde légitime, et *prouver qu'il ne peut pas arriver* (C) est
faux — la reproduction montre le champ traversant l'amorçage et persistant en base.

### Coexistence — comportement constaté, contrat à trancher

Mesuré sur PostgreSQL réel, **pendant qu'une salle nomme encore U** :

```
POST /api/access/memberships {responsible:false}  -> 200, U n'est plus responsable
DELETE /api/access/grants/:id                     -> 200, 24 habilitations -> 23
la salle, elle, nomme toujours U
```

Autrement dit : **la décision explicite l'emporte, et rien ne la contredit** — jusqu'à la
prochaine écriture qui touche cette salle, laquelle repose l'autorité par le décompte.

Ce comportement n'a pas été modifié : le choix relève du produit, pas de ce correctif.
Deux contrats sont défendables, et ils ne demandent pas le même travail :

1. **La salle fait foi.** Une révocation explicite serait alors refusée tant qu'une salle
   nomme l'utilisateur — il faut d'abord retirer le responsable de la salle. Cohérent,
   mais ajoute un refus là où l'écran n'en attend aucun aujourd'hui.
2. **La décision explicite fait foi.** Elle devrait alors survivre à la réconciliation
   suivante, ce qui suppose de marquer la révocation comme délibérée — l'exacte symétrie
   de `responsibleSource`.

À trancher avec le métier. Rien dans A-1 ne dépend de cette décision.

---

## 7. Deux contrats précisés avant la mise en production (revue finale)

### `responsibleId` absent ≠ `responsibleId` retiré

L'écriture d'une salle REMPLACE la fiche entière ; elle n'applique aucun correctif partiel.
Un champ absent de la charge utile disparaissait donc de la fiche, alors que la garde
d'autorité lisait la même absence comme « rien ne change ». Un rôle à périmètre défaisait
ainsi une désignation sans jamais croiser `RESPONSIBLE_ASSIGN_ADMIN_ONLY`.

La règle vaut maintenant pour **tous** les écrivains de fiche entière :

| | salle existante | salle neuve |
|---|---|---|
| `responsibleId` absent | valeur en base **préservée** | aucun responsable |
| `responsibleId: ''` ou `null` | **retrait**, soumis à la garde | aucun responsable |
| `responsibleId: 'U'` | **désignation**, soumise à la garde | désignation, soumise à la garde |

Un retrait reste donc possible : il se **dit**, au lieu de s'obtenir par omission.

### Une salle n'élargit jamais la durée d'une adhésion

`ensureMembership()` écrit `expiresAt: expiresAt || null`, et le chemin salle ne transmet
aucune échéance. Une adhésion responsable explicite portant une échéance finie ressortait
donc d'une désignation de salle **sans échéance** — une autorité temporaire devenue
permanente.

Trois règles, toutes fail-closed :

- une adhésion responsable **explicite** et déjà posée n'est **pas réécrite du tout** : rien
  à ajouter, donc aucune écriture, aucun `authVersion` incrémenté, aucune trace d'un acte
  qui n'a pas eu lieu ;
- une adhésion **simple** promue par une salle **reporte** son échéance, et la conserve
  après la rétrogradation ;
- une adhésion explicite **périmée** n'est pas ressuscitée par une salle. L'utilisateur n'a
  alors aucune autorité effective, et la réparation passe par Accès Zone — la salle ne
  réécrit pas l'échéance qu'un administrateur a posée.

### Résiduel R8 — fermé

L'amorçage validait ses références de responsable **après** que les données soient durables.
Une référence morte pouvait donc faire échouer la canonisation sur un import déjà validé.
Chaque `responsibleId` importé est désormais vérifié **avant le premier `COMMIT`** — compte
présent dans le fichier ou en base, et rôle reconnu par `roles.js` — et l'import est refusé
en bloc (`400 RESPONSIBLE_USER_NOT_FOUND`, `409 INVALID_ROLE`) sans qu'une seule ligne soit
écrite. Ce résiduel n'est donc pas reporté.

### Précision de vocabulaire

Le réconciliateur est **idempotent en état**, pas en écritures : rejoué sur le même état
logique, il ne produit ni permission en double ni autorité nouvelle, mais il peut réécrire
des lignes dérivées et les auditer. L'épreuve A-1·41 vérifie l'absence de doublon effectif,
pas l'absence d'écriture. La seule écriture explicitement supprimée est celle qui toucherait
une adhésion explicite (ci-dessus), et elle l'est pour une raison de sûreté, non de
performance.
