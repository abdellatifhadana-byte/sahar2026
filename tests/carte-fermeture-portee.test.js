import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * MAP-01 — LA FERMETURE DE LA CARTE NE PEUT PAS APPELER CE QU'ELLE NE VOIT PAS.
 *
 * DÉFAUT MESURÉ dans un vrai Chromium, sur le chemin de l'audience :
 *
 *     ReferenceError: fermerFormesImbriquees is not defined
 *         at closeMap (interactive-map.js:220)
 *         at closeInteractiveMap (interactive-map.js:143)
 *         at openMapEquipment360 (map-equipment-360-bridge.js:39)
 *
 * `closeMap` vit dans la portée de `openInteractiveMap()`. `fermerFormesImbriquees` est
 * déclarée dans `renderMapUI()`, une portée ENFANT. Une portée parente ne voit pas une
 * liaison déclarée dans une portée fille : l'appel levait, et la ligne étant la DEUXIÈME du
 * nettoyage, tout ce qui suivait ne s'exécutait jamais — le plan restait monté et la
 * Fiche 360 n'était jamais atteinte.
 *
 * CETTE ÉPREUVE LIT LA SOURCE, et c'est voulu : le défaut est une erreur de PORTÉE, pas de
 * comportement. Aucune épreuve en mémoire ne pouvait le voir — il faut exécuter la vraie
 * fermeture dans un vrai navigateur (voir `scripts/map-close-fiche360-browser-gate.mjs`,
 * hors CI) ou lire la structure, ici. Les deux existent, et elles ne disent pas la même
 * chose : la recette navigateur prouve que la fermeture MARCHE, celle-ci prouve qu'on ne
 * peut pas la recasser de la même façon — ni la « réparer » en SUPPRIMANT le nettoyage.
 */

const source = readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');
const lignes = source.split('\n');

/** Fin d'un bloc ouvert à `depart` (index 0), par comptage d'accolades. */
function finDuBloc(depart) {
  let profondeur = 0;
  let commence = false;
  for (let i = depart; i < lignes.length; i += 1) {
    for (const caractere of lignes[i]) {
      if (caractere === '{') { profondeur += 1; commence = true; }
      else if (caractere === '}') profondeur -= 1;
    }
    if (commence && profondeur === 0) return i;
  }
  return lignes.length - 1;
}

const indexDe = motif => {
  const trouve = lignes.findIndex(ligne => motif.test(ligne));
  assert.notEqual(trouve, -1, `introuvable dans interactive-map.js : ${motif}`);
  return trouve;
};

const debutOuverture = indexDe(/^export default function openInteractiveMap\(/);
const debutRendu = indexDe(/^  function renderMapUI\(\)/);
const finRendu = finDuBloc(debutRendu);
const debutFermeture = indexDe(/^  const closeMap = \(/);
const finFermeture = finDuBloc(debutFermeture);

test('MAP·01 — `closeMap` est bien dans la portée PARENTE de `renderMapUI`', () => {
  assert.ok(debutFermeture > debutOuverture, '`closeMap` doit vivre dans `openInteractiveMap`');
  assert.ok(debutFermeture < debutRendu || finFermeture < debutRendu,
    '`closeMap` ne doit pas être imbriquée dans `renderMapUI` — c’est ce qui rend le crochet nécessaire');
});

test('MAP·01 — `closeMap` n’appelle AUCUN symbole déclaré seulement dans `renderMapUI`', () => {
  /*
   * La règle générale, plutôt que le seul nom fautif : n'importe quelle fonction déclarée
   * dans `renderMapUI` produirait exactement la même panne si la fermeture l'appelait.
   */
  const declareesDansLeRendu = new Set();
  for (let i = debutRendu + 1; i <= finRendu; i += 1) {
    const nom = lignes[i].match(/^\s{4,}function\s+([A-Za-zÀ-ÿ_$][\w$]*)\s*\(/);
    if (nom) declareesDansLeRendu.add(nom[1]);
  }
  assert.ok(declareesDansLeRendu.size > 0, 'aucune fonction lue dans `renderMapUI` : la lecture a échoué');
  assert.ok(declareesDansLeRendu.has('fermerFormesImbriquees'),
    '`fermerFormesImbriquees` devrait être déclarée dans `renderMapUI` — sinon cette épreuve ne garde plus rien');

  const corpsFermeture = lignes.slice(debutFermeture, finFermeture + 1).join('\n');
  const appels = new Set([...corpsFermeture.matchAll(/([A-Za-zÀ-ÿ_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const fautifs = [...appels].filter(nom => declareesDansLeRendu.has(nom));

  assert.deepEqual(fautifs, [],
    `\`closeMap\` appelle des symboles déclarés uniquement dans \`renderMapUI\` : ${fautifs.join(', ')}. ` +
    'Une portée parente ne les voit pas — passez par un crochet posé dans la portée de `openInteractiveMap`.');
});

test('MAP·01 — le nettoyage des formes imbriquées est TOUJOURS demandé à la fermeture', () => {
  /*
   * L'autre façon de faire disparaître le `ReferenceError` serait de retirer l'appel. Elle
   * rendrait la recette navigateur verte en laissant l'éditeur de forme et le canevas
   * vivre après la fermeture du plan. Cette épreuve l'interdit.
   */
  const corpsFermeture = lignes.slice(debutFermeture, finFermeture + 1).join('\n');
  assert.match(corpsFermeture, /fermerFormesImbriqueesDuPanneau\(\)/,
    'la fermeture doit demander le nettoyage des formes imbriquées');
  assert.match(corpsFermeture, /cancelCoordinateSession\(\)/,
    'et continuer d’annuler la session de coordonnées');
});

test('MAP·01 — le crochet est déclaré dans la portée parente et branché par `renderMapUI`', () => {
  const declaration = indexDe(/^\s{2}let fermerFormesImbriqueesDuPanneau = \(\) => \{\};/);
  assert.ok(declaration > debutOuverture && declaration < debutRendu,
    'le crochet doit être déclaré dans `openInteractiveMap`, avant `renderMapUI`');

  const branchement = lignes.findIndex(ligne =>
    /fermerFormesImbriqueesDuPanneau\s*=\s*fermerFormesImbriquees\s*;/.test(ligne));
  assert.notEqual(branchement, -1, 'le crochet n’est jamais branché : la fermeture ne nettoierait rien');
  assert.ok(branchement > debutRendu && branchement <= finRendu,
    'le branchement doit se faire DANS `renderMapUI`, là où la fonction réelle existe');
});

test('MAP·01 — le crochet par défaut ne fait rien, pour la carte restreinte', () => {
  /*
   * Une carte « Accès restreint » n'appelle jamais `renderMapUI` : le crochet garde sa
   * valeur initiale. Elle doit pouvoir se fermer sans lever — d'où le repli explicite.
   */
  const declaration = lignes[indexDe(/^\s{2}let fermerFormesImbriqueesDuPanneau =/)];
  assert.match(declaration, /=\s*\(\)\s*=>\s*\{\s*\}\s*;/,
    'la valeur initiale du crochet doit être une fonction sans effet, jamais `null`');
});
