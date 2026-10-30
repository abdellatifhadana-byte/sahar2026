/**
 * @file scripts/write01-mutations.mjs — la batterie de mutations de WRITE-01 et WRITE-02.
 *
 * POURQUOI
 * --------
 * Une garde qu'aucun test ne tue quand on la retire ne garde rien. Chaque mutation
 * ci-dessous rouvre une des portes par lesquelles la tempête d'écritures revenait ; chacune
 * doit être TUÉE.
 *
 * Les contournements INTERDITS par le lot y figurent aussi — ralentir la boucle, ouvrir le
 * droit d'écriture aux rôles à périmètre — parce qu'il ne suffit pas qu'ils soient interdits
 * sur le papier : il faut qu'un test s'en aperçoive si quelqu'un les applique.
 *
 * Usage :  node scripts/write01-mutations.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chemin = relatif => path.join(racine, relatif);
const CIBLES = [
  'tests/bootstrap-ecriture-repetitive.test.js',
  'tests/reference-convergence-ordre.test.js'
];

const MUTATIONS = [
  {
    nom: 'W1 · la garde d’autorité disparaît',
    pourquoi: 'Chaque rôle à périmètre reprend l’initialisation d’une référence qu’il ne voit pas — la tempête d’origine.',
    fichier: 'grille-centrale-field-verification.js',
    de: '  if (!claimPlatformReferenceInitiation(GRILLE_CENTRALE_FIELD_PLAN_ID)) {',
    vers: '  if (false) {'
  },
  {
    nom: 'W2 · l’autorité s’ouvre à tout le monde',
    pourquoi: 'Le contournement le plus tentant : « qu’ils aient le droit d’écrire ». On remplacerait une boucle par une fuite.',
    fichier: 'platform-reference-contract.js',
    de: '  return roleSeesEveryZone(role);',
    vers: '  return Boolean(String(role || "").trim());'
  },
  {
    nom: 'W3 · la mémoire des tentatives est perdue',
    pourquoi: 'Une initialisation centrale refusée repartirait à chaque événement : la même tempête, sous une autre identité.',
    fichier: 'platform-reference-contract.js',
    de: '  if (platformReferenceAlreadyAttempted(referenceId)) return false;',
    vers: '  void platformReferenceAlreadyAttempted(referenceId);'
  },
  {
    nom: 'W4 · la mémoire n’est posée qu’APRÈS l’écriture',
    pourquoi: 'Une écriture refusée lève une exception : la tentative ne serait jamais retenue, et la boucle reviendrait.',
    fichier: 'platform-reference-contract.js',
    de: `  rememberPlatformReferenceAttempt(referenceId);
  return true;`,
    vers: '  return true;'
  },
  {
    nom: 'W5 · le rôle est lu ailleurs que dans la session',
    pourquoi: 'Sans identité, la garde doit se fermer. S’ouvrir par défaut rendrait la protection nulle pour toute session anonyme.',
    fichier: 'platform-reference-contract.js',
    de: '  return hasCentralInitiationAuthority(currentIdentity()?.role);',
    vers: '  return currentIdentity() === null ? true : hasCentralInitiationAuthority(currentIdentity()?.role);'
  },
  {
    nom: 'W6 · la version calculée n’est plus servie aux rôles à périmètre',
    pourquoi: 'Supprimer la boucle en privant ces rôles du plan serait une régression fonctionnelle déguisée en correction.',
    fichier: 'grille-centrale-field-verification.js',
    de: '    return { record:current || next, protected:false, updated:false, initiated:false };',
    vers: '    return { record:current || null, protected:false, updated:false, initiated:false };'
  },
  {
    nom: 'W7 · la comparaison redevient une comparaison de TEXTE',
    pourquoi: 'PostgreSQL renormalise l’ordre des clés du jsonb : le texte diffère alors que les valeurs sont identiques, et la référence est réécrite à chaque instantané.',
    fichier: 'grille-centrale-field-verification.js',
    de: `  const updated = !current || !sameReferenceContent(
    { ...current, updatedAt:undefined },
    { ...next, updatedAt:undefined }
  );`,
    vers: `  const updated = (current ? JSON.stringify({ ...current, updatedAt:undefined }) : '')
    !== JSON.stringify({ ...next, updatedAt:undefined });`
  },
  {
    nom: 'W8 · l’ordre des ÉLÉMENTS d’un tableau cesse de compter',
    pourquoi: '`sourceLayers` décrit une succession de couches : les inverser ne dit pas la même chose, et la correction ne partirait jamais.',
    fichier: 'platform-reference-contract.js',
    de: '    return gauche.every((element, index) => sameReferenceContent(element, droite[index]));',
    vers: '    return gauche.every(element => droite.some(autre => sameReferenceContent(element, autre)));'
  },
  {
    nom: 'W9 · la comparaison ne compare plus rien',
    pourquoi: 'Une garde toujours vraie ne fait pas converger : elle rend AVEUGLE à un vrai changement de contenu.',
    fichier: 'platform-reference-contract.js',
    de: '  if (Object.is(gauche, droite)) return true;',
    vers: '  if (true) return true;'
  }
];

const lire = fichier => fs.readFileSync(chemin(fichier), 'utf8');
const ecrire = (fichier, contenu) => fs.writeFileSync(chemin(fichier), contenu);

function lancerTests() {
  try {
    execFileSync('node', ['--test', ...CIBLES], { cwd: racine, stdio: 'pipe', timeout: 180000 });
    return { vert: true, sortie: '' };
  } catch (erreur) {
    return { vert: false, sortie: String(erreur.stdout || '') };
  }
}

const tuePar = sortie => (sortie.match(/^not ok \d+ - (.+)$/gm) || [])
  .map(ligne => ligne.replace(/^not ok \d+ - /, ''));

console.log('\n╔═══ mutations WRITE-01 et WRITE-02 ═══╗\n');

const reference = lancerTests();
if (!reference.vert) {
  console.log('❌ la suite n’est pas verte AVANT mutation : rien de ce qui suit n’aurait de sens.');
  console.log(tuePar(reference.sortie).join('\n'));
  process.exit(1);
}
console.log('✅ référence verte avant toute mutation\n');

const survivantes = [];
for (const mutation of MUTATIONS) {
  const original = lire(mutation.fichier);
  const occurrences = original.split(mutation.de).length - 1;
  if (occurrences !== 1) {
    console.log(`⚠️  ${mutation.nom} — motif trouvé ${occurrences} fois dans ${mutation.fichier}`);
    survivantes.push({ ...mutation, raison: 'motif ambigu ou absent' });
    continue;
  }
  ecrire(mutation.fichier, original.replace(mutation.de, mutation.vers));
  let resultat;
  try { resultat = lancerTests(); }
  finally { ecrire(mutation.fichier, original); }

  if (resultat.vert) {
    console.log(`❌ SURVIVANTE — ${mutation.nom}`);
    console.log(`   ${mutation.pourquoi}`);
    survivantes.push({ ...mutation, raison: 'aucun test ne la tue' });
  } else {
    const morts = tuePar(resultat.sortie);
    console.log(`✅ tuée — ${mutation.nom}`);
    console.log(`   par ${morts.length} test(s), dont : ${morts.slice(0, 2).join(' · ') || '(échec au chargement)'}`);
  }
}

console.log(`\n╚═══ ${survivantes.length === 0 ? '✅ AUCUNE SURVIVANTE' : `❌ ${survivantes.length} SURVIVANTE(S)`} ═══╝\n`);
process.exit(survivantes.length === 0 ? 0 : 1);
