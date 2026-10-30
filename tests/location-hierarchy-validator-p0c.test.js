/**
 * @file tests/location-hierarchy-validator-p0c.test.js — P0-C : le graphe de localisations
 *       (Ville → Région → Département, `location-contract.js`) est-il cohérent AVANT toute
 *       écriture ? Exécution réelle, aucune inspection de texte : `validateLocationHierarchy`
 *       et `isRecognizedLocationKind` sont de purs contrats, testables sans DOM ni IndexedDB.
 *
 * CE QUE CE FICHIER NE FAIT PAS : il n'invente aucune règle. Chaque refus ci-dessous est
 * une règle déjà écrite dans `location-contract.js` (`canParent`, `normalizeLocation`,
 * l'alphabet des `kind` reconnus) ; chaque acceptation est un usage déjà autorisé par
 * l'écran (`locations-section.js` affiche explicitement les orphelins à part, plutôt que
 * de les refuser).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocationHierarchy, isRecognizedLocationKind, normalizeLocation } from '../location-contract.js';

/* ═══════════════════ isRecognizedLocationKind ═══════════════════ */

test('un kind reconnu (canonique ou alias) est accepté', () => {
  for (const valeur of ['city', 'ville', 'region', 'région', 'zone', 'department', 'département', 'departement', 'service']) {
    assert.equal(isRecognizedLocationKind(valeur), true, `« ${valeur} » doit être reconnu`);
  }
});

test('un kind ABSENT est accepté — c’est le repli légitime pour une fiche ancienne', () => {
  assert.equal(isRecognizedLocationKind(''), true);
  assert.equal(isRecognizedLocationKind(undefined), true);
  assert.equal(isRecognizedLocationKind(null), true);
});

test('un kind PRÉSENT mais inconnu est refusé — jamais rabattu en silence sur « city »', () => {
  for (const valeur of ['floor', 'etage', 'batiment', 'xyz']) {
    assert.equal(isRecognizedLocationKind(valeur), false, `« ${valeur} » ne doit PAS être reconnu`);
  }
});

/* ═══════════════════ validateLocationHierarchy — les refus ═══════════════════ */

test('un identifiant dupliqué dans le lot est refusé', () => {
  const resultat = validateLocationHierarchy([
    { id: 1, kind: 'city', name: 'Casablanca' },
    { id: 1, kind: 'city', name: 'Rabat' }
  ]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'DUPLICATE_ID'));
});

test('une localisation qui se déclare son propre parent est refusée', () => {
  const resultat = validateLocationHierarchy([{ id: 1, kind: 'region', name: 'Siège', parentId: 1 }]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'SELF_PARENT'));
});

test('un cycle A → B → A est détecté, indépendamment du refus de niveau', () => {
  const resultat = validateLocationHierarchy([
    { id: 1, kind: 'department', name: 'A', parentId: 2 },
    { id: 2, kind: 'department', name: 'B', parentId: 1 }
  ]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'CYCLE'), 'le cycle doit être nommé, pas seulement le mauvais niveau');
});

test('un cycle à trois nœuds est détecté', () => {
  const resultat = validateLocationHierarchy([
    { id: 1, kind: 'department', name: 'A', parentId: 2 },
    { id: 2, kind: 'department', name: 'B', parentId: 3 },
    { id: 3, kind: 'department', name: 'C', parentId: 1 }
  ]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'CYCLE'));
});

test('un parent d’un niveau qui n’est pas immédiatement supérieur est refusé (canParent)', () => {
  // Un département ne peut avoir pour parent qu'une région — jamais directement une ville.
  const resultat = validateLocationHierarchy([
    { id: 1, kind: 'city', name: 'Casablanca' },
    { id: 2, kind: 'department', name: 'Régie', parentId: 1 }
  ]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'INVALID_PARENT_KIND'));
});

test('un kind présent mais non reconnu fait refuser le lot entier', () => {
  const resultat = validateLocationHierarchy([{ id: 1, kind: 'floor', name: 'Rez-de-chaussée' }]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'INVALID_KIND'));
});

test('une fiche sans nom est refusée (normalizeLocation la rejette déjà)', () => {
  const resultat = validateLocationHierarchy([{ id: 1, kind: 'city', name: '' }]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'INVALID_RECORD'));
});

test('une fiche sans identifiant est refusée', () => {
  const resultat = validateLocationHierarchy([{ kind: 'city', name: 'Casablanca' }]);
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'MISSING_ID'));
});

/* ═══════════════════ validateLocationHierarchy — les acceptations ═══════════════════ */

test('un arbre à trois niveaux, valide, est accepté sans erreur', () => {
  const resultat = validateLocationHierarchy([
    { id: 1, kind: 'city', name: 'Casablanca' },
    { id: 2, kind: 'region', name: 'Siège', parentId: 1 },
    { id: 3, kind: 'department', name: 'Régie', parentId: 2 }
  ]);
  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.errors, []);
});

test('un kind ABSENT dans le lot est accepté (repli sur « city »), pas refusé', () => {
  const resultat = validateLocationHierarchy([{ id: 1, name: 'Casablanca' }]);
  assert.equal(resultat.ok, true);
});

/*
 * LA LIGNE QUI COMPTE LE PLUS — et qu'une revue indépendante a corrigée.
 *
 * Il y a DEUX états distincts, que la version précédente de ce fichier confondait :
 *
 *   `parentId = null`  → `normalizeLocation` calcule `orphan: true`. C'est ce qu'écrit
 *                        l'option « — non rattaché — » de `locations-section.js`, le seul
 *                        chemin par lequel l'écran crée une localisation sans parent.
 *                        `locationTree()` part de `construire(null)` : la fiche est une
 *                        RACINE, donc visible. → ACCEPTÉ.
 *
 *   `parentId = 999`   → `orphan: kind !== city && !parentId` vaut FALSE (`!999` est faux).
 *   (inconnu)            Ce n'est donc PAS l'état orphelin : la fiche prétend avoir un
 *                        parent qui n'existe pas. `locationTree()` ne la met ni en racine
 *                        ni sous un parent : elle disparaît de l'arbre, et l'écran la
 *                        rattrape dans « Rattachement manquant » (`detachees` = ce qui
 *                        n'est PAS dans l'arbre, « n'ont plus de parent ») — un écran de
 *                        RÉCUPÉRATION pour un parent supprimé après coup, pas une saisie
 *                        que l'interface autorise. → REFUSÉ.
 */
test('un parentId NUL sur une région est accepté — c’est l’état orphelin « non rattaché »', () => {
  const resultat = validateLocationHierarchy([{ id: 2, kind: 'region', name: 'Siège', parentId: null }]);
  assert.equal(resultat.ok, true, '« — non rattaché — » est un état légitime de la plateforme');
  assert.deepEqual(resultat.errors, []);
});

test('un parentId NUL sur un département est accepté — même état orphelin', () => {
  const resultat = validateLocationHierarchy([{ id: 3, kind: 'department', name: 'Régie', parentId: null }]);
  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.errors, []);
});

test('un parentId NON NUL qui ne correspond à RIEN (ni lot, ni base) est REFUSÉ', () => {
  const resultat = validateLocationHierarchy([{ id: 3, kind: 'department', name: 'Régie', parentId: 999 }]);
  assert.equal(resultat.ok, false, 'une référence pendante est une corruption, pas un orphelin');
  assert.ok(resultat.errors.some(e => e.code === 'UNKNOWN_PARENT'),
    'le refus doit être nommé UNKNOWN_PARENT');
  const erreur = resultat.errors.find(e => e.code === 'UNKNOWN_PARENT');
  assert.equal(String(erreur.id), '3');
  assert.equal(String(erreur.parentId), '999', 'le parent introuvable est nommé, pas deviné');
});

/*
 * On refuse la fiche : on ne la répare pas. Inventer un parent ou rabattre `parentId` sur
 * `null` transformerait une corruption en donnée d'apparence saine — exactement ce qu'un
 * jumeau numérique ne doit jamais faire.
 */
test('un parent inconnu n’est NI inventé NI rabattu sur null — le lot entier est refusé', () => {
  const lot = [
    { id: 1, kind: 'city', name: 'Casablanca', parentId: null },
    { id: 2, kind: 'region', name: 'Siège', parentId: 1 },
    { id: 3, kind: 'department', name: 'Régie', parentId: 999 }
  ];
  const resultat = validateLocationHierarchy(lot);
  assert.equal(resultat.ok, false, 'le lot ENTIER est refusé, pas seulement la fiche fautive');
  assert.equal(lot[2].parentId, 999, 'le lot d’entrée n’est pas muté');
});

/*
 * `orphan` est bien ce que le contrat calcule — la justification ci-dessus est vérifiée
 * contre la source, pas seulement affirmée.
 */
test('normalizeLocation : parentId nul => orphan true ; parentId inconnu => orphan false', () => {
  assert.equal(normalizeLocation({ id: 2, kind: 'region', name: 'Siège', parentId: null }).orphan, true);
  assert.equal(normalizeLocation({ id: 3, kind: 'department', name: 'Régie', parentId: 999 }).orphan, false,
    'parentId = 999 n’est PAS l’état orphelin — c’est une référence pendante');
});

test('un parent absent du LOT mais présent en base (restauration additive) est résolu, pas signalé orphelin', () => {
  const resultat = validateLocationHierarchy(
    [{ id: 2, kind: 'department', name: 'Régie', parentId: 1 }],
    { existingLocations: [{ id: 1, kind: 'region', name: 'Siège' }] }
  );
  assert.equal(resultat.ok, true);
});

test('un parent résolu en base mais du MAUVAIS niveau est tout de même refusé', () => {
  const resultat = validateLocationHierarchy(
    [{ id: 2, kind: 'department', name: 'Régie', parentId: 1 }],
    { existingLocations: [{ id: 1, kind: 'city', name: 'Casablanca' }] }
  );
  assert.equal(resultat.ok, false);
  assert.ok(resultat.errors.some(e => e.code === 'INVALID_PARENT_KIND'));
});

/* ═══════════════════ discriminance ═══════════════════ */

test('un lot vide est trivialement valide', () => {
  assert.deepEqual(validateLocationHierarchy([]), { ok: true, errors: [] });
  assert.deepEqual(validateLocationHierarchy(), { ok: true, errors: [] });
});
