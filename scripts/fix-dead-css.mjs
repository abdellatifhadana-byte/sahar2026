#!/usr/bin/env node
/**
 * @file scripts/fix-dead-css.mjs — retire les déclarations provablement mortes.
 *
 * Ne retire QUE ce que `check-dead-css.mjs` peut prouver : même sélecteur, même condition
 * média, même importance, même propriété, et une déclaration plus tardive qui l'emporte
 * toujours. Aucune heuristique, aucune devinette.
 *
 * PORTÉE
 * ------
 * Par défaut, les `!important` sur sélecteur NON groupé : ce sont eux qui alimentent la
 * course à la surenchère. `--toutes` étend aux déclarations ordinaires, toujours non
 * groupées — un sélecteur groupé ne peut pas être amputé sur la foi d'un seul de ses membres.
 *
 * CE QUI EMPÊCHE CE SCRIPT DE CASSER UNE FEUILLE
 * ----------------------------------------------
 * Chaque déclaration est retirée à ses bornes EXACTES, point-virgule compris. Une première
 * version raisonnait « telle propriété, quelque part dans ce bloc » : sur cette base elle
 * annonçait 188 retraits pour 35 déclarations mortes identifiées — elle emportait des
 * déclarations vivantes portant le même nom ailleurs dans la feuille.
 *
 * Et rien n'est écrit avant que le résultat n'ait été RELU : on reconstruit l'empreinte de
 * toutes les feuilles, et on exige que la nouvelle soit exactement l'ancienne PRIVÉE des
 * déclarations visées — même ordre, mêmes valeurs, rien d'autre en moins, rien en plus. Un
 * seul écart annule tout le lot, sans toucher au disque.
 *
 * Tout cela est EXPORTÉ, donc exécutable par un test. Une garantie qu'on ne peut pas
 * exécuter dans un test n'est pas une garantie vérifiée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyser, lireRegles, feuillesLiees } from './check-dead-css.mjs';

const RACINE = path.resolve(new URL('..', import.meta.url).pathname);

/** Une ligne par déclaration effectivement présente, dans l'ordre de la cascade. */
export function empreinte(remplacements = new Map()) {
  const lignes = [];
  for (const feuille of feuillesLiees()) {
    const source = remplacements.get(feuille)
      ?? fs.readFileSync(path.join(RACINE, feuille), 'utf8');
    for (const regle of lireRegles(source, feuille)) {
      for (const selecteur of regle.selecteurs) {
        for (const decl of regle.declarations) {
          lignes.push(`${feuille}|${regle.media}|${selecteur}|${decl.propriete}|${decl.valeur}`);
        }
      }
    }
  }
  return lignes;
}

/**
 * `apres` doit être `avant` privé de quelques lignes, sans réordonnancement ni altération.
 * Rend les lignes disparues, ou lève à la première divergence.
 */
export function lignesRetirees(avant, apres) {
  const disparues = [];
  let j = 0;
  for (let i = 0; i < avant.length; i += 1) {
    if (j < apres.length && apres[j] === avant[i]) { j += 1; continue; }
    disparues.push(avant[i]);
  }
  if (j !== apres.length) {
    throw new Error(`déclaration inattendue après réécriture : « ${apres[j]} »`);
  }
  return disparues;
}

/**
 * Retire de `source` les déclarations désignées par leurs bornes, de la fin vers le début —
 * réécrire par la fin conserve les offsets de tout ce qui précède.
 *
 * L'indentation qui précède part avec la déclaration, et la fin de ligne aussi quand la
 * ligne ne contenait rien d'autre : sans cela la feuille se remplit de lignes blanches.
 */
export function retirerDeclarations(source, cibles) {
  let sortie = source;
  for (const cible of [...cibles].sort((a, b) => b.debut - a.debut)) {
    let a = cible.debut;
    let b = cible.fin;
    while (a > 0 && (sortie[a - 1] === ' ' || sortie[a - 1] === '\t')) a -= 1;
    let c = b;
    while (c < sortie.length && (sortie[c] === ' ' || sortie[c] === '\t')) c += 1;
    if (a > 0 && sortie[a - 1] === '\n' && sortie[c] === '\n') b = c + 1;
    else if (sortie[c] === '\n') b = c;
    else { a = cible.debut; b = c; }
    sortie = sortie.slice(0, a) + sortie.slice(b);
  }
  return sortie;
}

/** Réécriture complète, en mémoire. Ne touche jamais au disque. */
export function preparerRetrait({ toutes = false } = {}) {
  const { mortes } = analyser();
  const cibles = mortes.filter(m => !m.groupee && (toutes || m.force));
  const parFichier = new Map();
  for (const m of cibles) {
    if (!parFichier.has(m.fichier)) parFichier.set(m.fichier, []);
    parFichier.get(m.fichier).push(m);
  }

  const reecrites = new Map();
  let blocsVides = 0;
  for (const [fichier, liste] of parFichier) {
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    const sortie = retirerDeclarations(source, liste);
    reecrites.set(fichier, sortie);
    blocsVides += (sortie.match(/\{\s*\}/g) || []).length - (source.match(/\{\s*\}/g) || []).length;
  }
  return { cibles, parFichier, reecrites, blocsVides };
}

/**
 * Relit le résultat et exige qu'il soit l'original PRIVÉ des déclarations visées.
 * Lève dès le premier écart : c'est ce qui autorise — ou non — l'écriture.
 */
export function verifierRetrait({ cibles, reecrites }) {
  const avant = empreinte();
  const apres = empreinte(reecrites);
  const disparues = lignesRetirees(avant, apres).sort();
  const attendues = cibles
    .map(m => `${m.fichier}|${m.media}|${m.selecteur}|${m.propriete}|${m.valeur}`)
    .sort();

  if (attendues.length !== disparues.length
    || attendues.some((ligne, i) => ligne !== disparues[i])) {
    const enTrop = disparues.filter(l => !attendues.includes(l));
    throw new Error(`relecture refusée : attendu ${attendues.length} retrait(s), observé `
      + `${disparues.length}.${enTrop.length ? ` Retiré à tort : ${enTrop.slice(0, 5).join(' · ')}` : ''}`);
  }
  for (const [fichier, contenu] of reecrites) {
    const ouvrantes = (contenu.match(/\{/g) || []).length;
    const fermantes = (contenu.match(/\}/g) || []).length;
    if (ouvrantes !== fermantes) {
      throw new Error(`${fichier} : accolades déséquilibrées (${ouvrantes}/${fermantes})`);
    }
  }
  return { avant: avant.length, apres: apres.length, retirees: disparues.length };
}

/* ------------------------------------------------------------------ ligne de commande */

if (import.meta.url === `file://${process.argv[1]}`) {
  const ecrire = process.argv.includes('--ecrire');
  const toutes = process.argv.includes('--toutes');
  const plan = preparerRetrait({ toutes });

  if (!plan.cibles.length) {
    console.log('aucune déclaration morte dans la portée retenue.');
    process.exit(0);
  }
  for (const [fichier, liste] of plan.parFichier) {
    console.log(`  ${fichier} : ${liste.length} déclaration(s) morte(s)`);
  }

  let bilan;
  try {
    bilan = verifierRetrait(plan);
  } catch (erreur) {
    console.error(`\n✗ ${erreur.message}\n   rien n’a été écrit.`);
    process.exit(1);
  }

  console.log(`\nrelecture : ${bilan.avant} déclarations avant, ${bilan.apres} après, `
    + `${bilan.retirees} retirée(s) — toutes attendues.`);
  if (plan.blocsVides > 0) {
    console.log(`${plan.blocsVides} bloc(s) devenu(s) vide(s) — conservés, à traiter à part.`);
  }

  if (!ecrire) {
    console.log(`\n${bilan.retirees} déclaration(s) retirée(s) — essai à blanc, relancez avec --ecrire`);
    process.exit(0);
  }
  for (const [fichier, contenu] of plan.reecrites) fs.writeFileSync(path.join(RACINE, fichier), contenu);
  console.log(`\n${bilan.retirees} déclaration(s) retirée(s) dans ${plan.reecrites.size} feuille(s).`);
}
