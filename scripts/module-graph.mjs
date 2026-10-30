/**
 * @file scripts/module-graph.mjs — UN SEUL GRAPHE DE MODULES ACTIFS.
 *
 * CE QUE CE FICHIER FERME (#142, second tour)
 * -------------------------------------------
 * Deux marcheurs de graphe coexistaient, chacun avec sa propre expression régulière :
 * `check-active-modules.js` en résolvait 163, `public-bundle-residue-guard.mjs` seulement
 * 151. L'écart n'était pas cosmétique — c'est la GARDE DE SÉCURITÉ qui voyait le moins.
 *
 * La cause : la garde n'acceptait un import que s'il portait `from`, ou si le guillemet
 * suivait `import` sans espace. L'import à effet de bord, lui, s'écrit
 *
 *     import './module.js';
 *
 * et n'a pas de `from`. Douze modules actifs — dont toute la chaîne
 * `equipment-360-host-bridge.js → field-evidence-integration.js → equipment-field-evidence.js`
 * — n'étaient donc JAMAIS inspectés par la garde publique, ni par le balayage HTTP qui
 * réutilise le même graphe. Un résidu opérationnel réel y vivait.
 *
 * La leçon n'est pas « corriger cette regex ». C'est qu'un second analyseur finit toujours
 * par diverger du premier, et que la divergence est silencieuse. Il n'y a donc plus qu'un
 * analyseur, et un test compare les DEUX ENSEMBLES de fichiers — jamais leurs tailles.
 */

const STRIP_BLOCK_COMMENTS = /\/\*[\s\S]*?\*\//g;
const STRIP_LINE_COMMENTS = /(?:^|\n)\s*\/\/[^\n]*/g;

/*
 * Trois formes, trois motifs. Chacun borne ce qu'il traverse.
 *
 * `[^'"();]*?` interdit de franchir une chaîne, une parenthèse ou une fin d'instruction :
 * sans cette borne, `[\s\S]*?from` sautait par-dessus des instructions entières pour aller
 * chercher un `from` lointain. Les sauts de ligne restent permis — un import multiligne est
 * une seule instruction.
 */
const FROM_CLAUSE = /\b(?:import|export)\b[^'"();]*?\bfrom\s*(['"])([^'"]+)\1/g;
const BARE_IMPORT = /\bimport\s*(['"])([^'"]+)\1/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/**
 * Tous les spécificateurs RELATIFS importés par une source.
 *
 * Couvre `import x from`, `import {x} from`, `import * as x from`, l'import multiligne,
 * l'import à effet de bord `import './x.js'`, l'import dynamique `import('./x.js')`,
 * et les ré-exports `export {x} from` / `export * from`.
 *
 * Les paquets non relatifs sont ignorés : ils ne font pas partie du graphe du dépôt.
 */
export function relativeSpecifiers(source = '') {
  const code = String(source).replace(STRIP_BLOCK_COMMENTS, '').replace(STRIP_LINE_COMMENTS, '\n');
  const found = [];
  for (const pattern of [FROM_CLAUSE, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier && specifier.startsWith('.')) found.push(specifier);
    }
  }
  return [...new Set(found)];
}

/** Les modules déclarés par `index.html`, dans l'ordre du document. */
export function htmlEntryModules(html = '') {
  return [...String(html).matchAll(/src="([^"]+\.js)"/g)].map(match => match[1]);
}
