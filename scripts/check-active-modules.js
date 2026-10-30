import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { htmlEntryModules, relativeSpecifiers } from './module-graph.mjs';

const root = resolve(import.meta.dirname, '..');
const FORBIDDEN_ACTIVE_PREFIXES = Object.freeze([
  'LEGACY-ROOT/',
  'SOURCE-WALLS/',
  'app/',
  'assets/js/app/'
]);
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const queue = htmlEntryModules(html).map(entry => resolve(root, entry));
const visited = new Set();
const broken = [];
while (queue.length) {
  const file = queue.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  const activePath = relative(root, file).replaceAll('\\', '/');
  const forbiddenPrefix = FORBIDDEN_ACTIVE_PREFIXES.find(prefix => activePath.startsWith(prefix));
  if (forbiddenPrefix) {
    broken.push(`${activePath} -> copie historique interdite dans le graphe actif (${forbiddenPrefix})`);
    continue;
  }
  const source = await readFile(file, 'utf8');
  /*
   * AUCUN OCTET NUL DANS UN MODULE ACTIF.
   *
   * Un NUL écrit littéralement — pour servir de séparateur de clé dans un littéral de
   * gabarit, par exemple — fonctionne parfaitement à l'exécution, et rend le fichier
   * BINAIRE aux yeux de git. Conséquences constatées sur ce dépôt : la revue d'une pull
   * request n'affiche plus aucune différence pour ce fichier, `git diff` reste muet, et
   * `grep` ne le lit plus. Un module central peut alors changer sans que personne ne
   * puisse en voir une seule ligne.
   *
   * L'échappement `\u0000` produit exactement le même caractère et laisse le fichier
   * lisible. La règle est donc : le séparateur peut être un NUL, jamais sa graphie.
   */
  if (source.includes('\u0000')) {
    broken.push(`${activePath} -> octet NUL littéral : le fichier devient binaire pour git (écrire l’échappement \\u0000)`);
    continue;
  }
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { broken.push(`${activePath} -> syntaxe invalide\n${error.stderr}`); continue; }
  /*
   * L'ANALYSE DES IMPORTS EST PARTAGÉE AVEC LA GARDE PUBLIQUE (`module-graph.mjs`).
   *
   * Elle vivait ici, et une seconde copie divergente vivait dans la garde de sécurité —
   * qui en résolvait douze de moins sans que rien ne le signale. Deux analyseurs finissent
   * toujours par diverger ; il n'y en a donc plus qu'un.
   */
  for (const specifier of relativeSpecifiers(source)) {
    const dependency = resolve(dirname(file), specifier);
    try { await access(dependency); queue.push(dependency); }
    catch { broken.push(`${activePath} -> ${specifier}`); }
  }
}
if (broken.length) {
  console.error(`Graphe de modules actif invalide:\n${broken.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`${visited.size} modules actifs et transitifs résolus; aucune copie historique n’est importée.`);
}
