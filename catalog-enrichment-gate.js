/*
 * FILE D'ATTENTE PARTAGÉE — ENSEMENCEMENT CATALOGUE `docs/kb-*` (#98).
 *
 * `equipment-field-evidence.js`, `field-evidence-integration.js`,
 * `equipment-field-evidence-phase12.js`, `equipment-catalog-gap-seed.js`,
 * `equipment-image-seed.js`, ses lots `equipment-image-coverage-batch2.js` à
 * `…batch8.js`, et `equipment-media-linkage.js` s'ensemencent chacun depuis leur
 * propre <script type="module"> de `index.html`, et certains se rappellent aussi
 * les uns les autres au fil de leur propre chaîne. Chacun relit un enregistrement
 * `docs/kb-*`, compare au contenu déjà connu, et n'écrit que si ça diffère — mais
 * cette garde ne protège que contre SA PROPRE lecture précédente. Rien n'empêchait
 * deux de ces passages de lire le MÊME enregistrement au même instant puis d'écrire
 * chacun sur la base de cette lecture commune : le second `db.save` arrivait alors
 * avec une révision déjà dépassée par le premier, et le serveur répondait honnêtement
 * 409 STALE_WRITE — mesuré sur kb-harris-neo-dvr (×2), kb-evertz-x0401h et
 * kb-miranda-kaleido-alto dès le premier rechargement.
 *
 * Cette file ne touche ni à la comparaison de contenu de chaque module, ni à la
 * sémantique de révision serveur : elle garantit seulement qu'un seul passage
 * d'ensemencement est EN TRAIN DE LIRE-PUIS-ÉCRIRE `docs` à la fois, pour que le
 * suivant reparte toujours d'une lecture qui inclut déjà les écritures du précédent.
 *
 * Un module qui dépend d'un autre (Phase 12 dépend des preuves terrain de base, un
 * lot d'images dépend du lot précédent…) attend ce dépendant AVANT d'entrer dans la
 * file — jamais depuis l'intérieur de son propre tour, ce qui créerait une attente
 * circulaire sur cette même file.
 */
let cle = Promise.resolve();

export function withCatalogEnrichmentGate(tache) {
  const tour = cle.then(tache, tache);
  cle = tour.then(() => {}, () => {});
  return tour;
}
