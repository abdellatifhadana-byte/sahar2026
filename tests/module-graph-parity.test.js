/**
 * @file La garde de sécurité voit-elle TOUT le graphe actif ? (#142, second tour)
 *
 * CE QUE CE FICHIER FERME
 * -----------------------
 * `check-active-modules.js` résolvait 163 modules ; `public-bundle-residue-guard.mjs`, qui
 * est la garde de SÉCURITÉ, n'en résolvait que 151. Deux analyseurs d'imports coexistaient,
 * et celui de la garde n'acceptait un import que s'il portait `from` :
 *
 *     import './module.js';      ← aucune arête produite
 *
 * Douze modules actifs sortaient donc du périmètre de la garde publique ET du balayage HTTP
 * qui réutilise le même graphe. Un résidu opérationnel réel y vivait, et le CI était vert.
 *
 * La leçon n'est pas « corriger la regex » : c'est qu'une divergence entre deux marcheurs de
 * graphe est SILENCIEUSE. On compare donc les ENSEMBLES de fichiers, jamais leurs tailles —
 * un nombre écrit dans un test devient faux dès que la plateforme grandit, et le fige.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeSpecifiers, htmlEntryModules } from '../scripts/module-graph.mjs';
import { buildPublicModuleGraph } from '../scripts/public-bundle-residue-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = ['LEGACY-ROOT/', 'SOURCE-WALLS/', 'app/', 'assets/js/app/'];

/** Le graphe actif canonique, marché indépendamment de la garde. */
async function canonicalActiveGraph() {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const queue = htmlEntryModules(html).map(entry => resolve(root, entry));
  const visited = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const activePath = relative(root, file).replaceAll('\\', '/');
    if (FORBIDDEN.some(prefix => activePath.startsWith(prefix))) continue;
    const source = await readFile(file, 'utf8');
    for (const specifier of relativeSpecifiers(source)) {
      const dependency = resolve(dirname(file), specifier);
      try { await access(dependency); queue.push(dependency); } catch {}
    }
  }
  return new Set([...visited].map(file => relative(root, file).replaceAll('\\', '/')));
}

test('#142 : la garde publique scanne EXACTEMENT le graphe actif, fichier par fichier', async () => {
  const canonical = await canonicalActiveGraph();
  const security = new Set(buildPublicModuleGraph(root));

  const invisibles = [...canonical].filter(file => !security.has(file)).sort();
  const fantomes = [...security].filter(file => !canonical.has(file)).sort();

  assert.deepEqual(invisibles, [],
    `Modules actifs invisibles pour la garde de sécurité :\n  ${invisibles.join('\n  ')}`);
  assert.deepEqual(fantomes, [],
    `Modules scannés qui ne sont plus actifs :\n  ${fantomes.join('\n  ')}`);
  // Aucune assertion de COMPTE : la plateforme grandit, l'égalité des ensembles doit tenir.
  assert.ok(canonical.size > 0, 'Le graphe actif ne peut pas être vide.');
});

test('#142 : le module réellement fuiteux est bien dans le périmètre de la garde', async () => {
  const security = new Set(buildPublicModuleGraph(root));
  /*
   * Cette chaîne n'est atteinte QUE par des imports à effet de bord :
   *   index.html → equipment-360-host-bridge.js → field-evidence-integration.js
   *              → equipment-field-evidence.js
   * C'est précisément par là que le résidu avait échappé à toutes les gardes.
   */
  for (const file of [
    'equipment-360-host-bridge.js',
    'field-evidence-integration.js',
    'equipment-field-evidence.js',
    'grille-centrale-documented-map.js',
    'grille-centrale-field-verification.js',
    'grille-centrale-physical-architecture.js'
  ]) {
    assert.ok(security.has(file), `${file} doit être inspecté par la garde publique.`);
  }
});

test('#142 : l’analyseur suit toutes les formes d’import, pas seulement `from`', () => {
  const formes = {
    'effet de bord simple': ["import './a.js';", './a.js'],
    'effet de bord guillemets doubles': ['import "./b.js";', './b.js'],
    'import nommé': ["import { x } from './c.js';", './c.js'],
    'import par défaut': ["import x from './d.js';", './d.js'],
    'espace de noms': ["import * as n from './e.js';", './e.js'],
    'import multiligne': ["import {\n  a,\n  b\n} from './f.js';", './f.js'],
    'import dynamique': ["const m = await import('./g.js');", './g.js'],
    'ré-export nommé': ["export { x } from './h.js';", './h.js'],
    'ré-export total': ["export * from './i.js';", './i.js']
  };
  for (const [nom, [source, attendu]] of Object.entries(formes)) {
    assert.deepEqual(relativeSpecifiers(source), [attendu], `forme non suivie : ${nom}`);
  }
});

test('#142 : l’analyseur ne confond pas un chemin de données avec un import', () => {
  // Un élargissement naïf du motif ferait de ces lignes des arêtes de graphe.
  assert.deepEqual(relativeSpecifiers("export const chemin = './pas-un-module.js';"), []);
  assert.deepEqual(relativeSpecifiers("const url = './assets/photo.js';"), []);
  // Les paquets non relatifs ne font pas partie du graphe du dépôt.
  assert.deepEqual(relativeSpecifiers("import pg from 'pg';"), []);
  // Un import cité dans un commentaire n'est pas une dépendance.
  assert.deepEqual(relativeSpecifiers("// import './commente.js';"), []);
});

test('#142 : un résidu placé derrière un import à effet de bord est bien atteint', async () => {
  /*
   * La preuve de la RÉGRESSION elle-même : sur l'ancien analyseur, la cible d'un
   * `import './x.js'` ne produisait aucune arête, donc le fichier n'était jamais lu.
   */
  const ancienAnalyseur = source => [
    ...[...String(source).matchAll(/(?:^|\n)\s*import(?:[\s\S]*?from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => m[1]),
    ...[...String(source).matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map(m => m[1])
  ];
  const source = "import './porteur-de-residu.js';";
  assert.deepEqual(ancienAnalyseur(source), [], 'RED : l’ancien analyseur ne voyait pas cette arête.');
  assert.deepEqual(relativeSpecifiers(source), ['./porteur-de-residu.js'], 'GREEN : le nouvel analyseur la suit.');
});
