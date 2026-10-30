#!/usr/bin/env node
/**
 * @file scripts/check-dead-css.mjs — déclarations CSS provablement mortes.
 *
 * POURQUOI
 * --------
 * Mesuré sur cette plateforme : 34 feuilles, 10 109 lignes, 1 286 `!important` et 332
 * sélecteurs définis dans plus d'une feuille. Personne ne peut plus dire, en lisant, quelle
 * règle s'applique — et c'est ainsi qu'on ajoute un `!important` de plus « pour être sûr ».
 *
 * CE QUI EST DÉTECTÉ, ET SEULEMENT CELA
 * -------------------------------------
 * Une déclaration est déclarée MORTE quand une autre, plus loin dans l'ordre de chargement,
 * porte EXACTEMENT :
 *   - le même sélecteur (texte normalisé),
 *   - la même condition média (ou aucune des deux),
 *   - la même importance (`!important` des deux côtés, ou d'aucun),
 *   - et la même propriété.
 *
 * Dans ce cas la seconde l'emporte toujours, quelle que soit la page : même spécificité,
 * même contexte, ordre décisif. La première ne peut donc RIEN produire.
 *
 * Ce critère est délibérément étroit. Il ne dit rien des règles qui se recouvrent
 * partiellement, des raccourcis contre les propriétés détaillées (`padding` contre
 * `padding-right`), ni des sélecteurs différents visant les mêmes éléments. Un outil qui
 * devinerait ces cas-là proposerait des suppressions dangereuses ; celui-ci ne propose que
 * ce qu'il peut prouver.
 *
 * TROIS PIÈGES, MESURÉS SUR CETTE BASE, QUE CE FICHIER ÉVITE EXPLICITEMENT
 * -----------------------------------------------------------------------
 * 1. UN PAS DE @keyframes N'EST PAS UN SÉLECTEUR. `0%`, `50%`, `to` se répètent dans chaque
 *    animation. Les confondre revient à dire que le `0%` de `all.min.css` est « éclipsé »
 *    par le `0%` de `startup-splash.css` — deux animations sans aucun rapport. Mesuré :
 *    204 fausses détections, dont 156 auraient été RETIRÉES, cassant les animations en
 *    silence. Tout bloc descendant d'une at-règle opaque (`@keyframes`, `@font-face`,
 *    `@counter-style`…) est donc ignoré ; seules les at-règles CONDITIONNELLES
 *    (`@media`, `@supports`, `@container`) conservent leur contenu, avec leur condition.
 *
 * 2. LES OFFSETS SONT PORTÉS PAR LA DÉCLARATION, PAS PAR LE BLOC. Sans eux, un correcteur
 *    ne peut retirer qu'« une propriété quelque part dans ce bloc » : il emporterait les
 *    deux moitiés d'un repli délibéré (`display:-webkit-box; display:flex`).
 *
 * 3. LES CHAÎNES NE SONT PAS DU CODE. `content:"}"` ou `url(data:…;base64,…)` casseraient un
 *    découpage naïf. La structure est donc analysée sur une copie où le CONTENU des chaînes
 *    et des commentaires est blanchi — à longueur et à lignes constantes, pour que chaque
 *    offset relevé indexe la source D'ORIGINE, caractère pour caractère.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(new URL('..', import.meta.url).pathname);
const INDEX = path.join(RACINE, 'index.html');

/** At-règles dont le contenu reste des règles ordinaires, sous condition. */
const CONDITIONNELLE = /^@(media|supports|container)\b/i;

/** Les feuilles, dans l'ordre où le navigateur les charge — c'est cet ordre qui tranche. */
export function feuillesLiees() {
  const html = fs.readFileSync(INDEX, 'utf8');
  return [...html.matchAll(/href="([^"]+\.css)"/g)]
    .map(m => m[1])
    .filter(href => !href.startsWith('http'))
    .filter(href => fs.existsSync(path.join(RACINE, href)));
}

const normaliser = valeur => String(valeur || '').replace(/\s+/g, ' ').trim();

/**
 * Blanchit une plage sans toucher aux fins de ligne : la longueur et la numérotation des
 * lignes sont conservées, donc tout offset relevé sur la copie vaut sur l'original.
 */
function blanchir(chars, debut, fin) {
  for (let k = debut; k < fin && k < chars.length; k += 1) {
    if (chars[k] !== '\n') chars[k] = ' ';
  }
}

/** Copie sans commentaires. Sert à lire les textes : sélecteurs, propriétés, valeurs. */
export function masquerCommentaires(source) {
  const chars = [...source];
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2);
      const stop = fin === -1 ? source.length : fin + 2;
      blanchir(chars, i, stop);
      i = stop;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

/**
 * Copie sans le CONTENU des chaînes. Sert à repérer les délimiteurs `{ } ; :` sans se
 * laisser piéger par un `content:"}"`. Les guillemets eux-mêmes sont conservés, pour que
 * les bornes d'une déclaration restent au bon endroit.
 */
export function masquerChaines(source) {
  const chars = [...source];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      blanchir(chars, i + 1, Math.min(j, source.length));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

/**
 * Déclarations d'un corps de règle, avec leurs bornes ABSOLUES dans la source.
 *
 * `fin` inclut le point-virgule quand il existe : c'est ce que le correcteur doit retirer.
 */
export function lireDeclarations(texte, structure, debutCorps, finCorps) {
  const declarations = [];
  const pousser = (depart, finTexte, finRetrait) => {
    let a = depart;
    while (a < finTexte && /\s/.test(structure[a])) a += 1;
    let b = finTexte;
    while (b > a && /\s/.test(structure[b - 1])) b -= 1;
    if (b <= a) return;
    // Le séparateur est cherché sur la STRUCTURE : un `:` dans une chaîne ne compte pas.
    const sep = structure.slice(a, b).indexOf(':');
    if (sep < 1) return;
    const propriete = normaliser(texte.slice(a, a + sep)).toLowerCase();
    // Les variables gardent leur valeur brute et peuvent être relues ailleurs : on ne
    // prétend pas savoir si une redéfinition antérieure est morte.
    if (!propriete || propriete.startsWith('--') || /[{}()]/.test(propriete)) return;
    const valeur = normaliser(texte.slice(a + sep + 1, b));
    declarations.push({
      propriete,
      valeur,
      force: /!important$/i.test(valeur),
      debut: a,
      // La DERNIÈRE déclaration d'un bloc n'a pas de point-virgule à emporter : sa borne
      // s'arrête au texte, pas à l'espace qui la sépare de l'accolade fermante.
      fin: finRetrait ?? b
    });
  };

  let profondeur = 0;
  let depart = debutCorps;
  for (let i = debutCorps; i < finCorps; i += 1) {
    const c = structure[i];
    if (c === '(') profondeur += 1;
    else if (c === ')') profondeur = Math.max(0, profondeur - 1);
    else if (c === ';' && profondeur === 0) {
      pousser(depart, i, i + 1);
      depart = i + 1;
    }
  }
  pousser(depart, finCorps, null);
  return declarations;
}

/** Découpe une feuille en règles, en gardant la condition média de chacune. */
export function lireRegles(source, fichier = '') {
  const texte = masquerCommentaires(source);
  const structure = masquerChaines(texte);
  const regles = [];
  const pile = [];
  let debutBloc = 0;

  for (let i = 0; i < structure.length; i += 1) {
    const c = structure[i];
    if (c === '{') {
      const entete = normaliser(texte.slice(debutBloc, i));
      if (CONDITIONNELLE.test(entete)) pile.push({ type: 'condition', texte: entete });
      else if (entete.startsWith('@')) pile.push({ type: 'opaque', texte: entete });
      else pile.push({ type: 'regle', texte: entete, corpsDebut: i + 1 });
      debutBloc = i + 1;
    } else if (c === '}') {
      const bloc = pile.pop();
      // `0%`, `to`, `from` se répètent dans chaque @keyframes : à l'intérieur d'une at-règle
      // opaque, ce ne sont pas des sélecteurs et rien ne peut être comparé d'une animation
      // à l'autre. On ne collecte donc RIEN sous un bloc opaque.
      if (bloc?.type === 'regle' && !pile.some(p => p.type === 'opaque')) {
        const media = pile.filter(p => p.type === 'condition').map(p => p.texte).join(' && ');
        regles.push({
          fichier,
          media,
          selecteurs: bloc.texte.split(',').map(normaliser).filter(Boolean),
          declarations: lireDeclarations(texte, structure, bloc.corpsDebut, i),
          debut: bloc.corpsDebut,
          fin: i,
          ligne: texte.slice(0, bloc.corpsDebut).split('\n').length
        });
      }
      debutBloc = i + 1;
    }
  }
  return regles;
}

/**
 * Le critère lui-même, sur une liste de règles DÉJÀ dans l'ordre de la cascade.
 *
 * Séparé de la lecture des fichiers pour une raison : un critère qu'un test ne peut pas
 * exécuter sur un cas construit n'est pas un critère vérifié — il est seulement écrit.
 */
export function detecterMortes(toutes) {
  // Dernière déclaration gagnante, par (sélecteur + média + propriété + importance).
  const derniere = new Map();
  toutes.forEach((regle, index) => {
    for (const selecteur of regle.selecteurs) {
      for (const decl of regle.declarations) {
        derniere.set(`${selecteur}|${regle.media}|${decl.propriete}|${decl.force}`,
          { index, regle, decl, selecteur });
      }
    }
  });

  const mortes = [];
  toutes.forEach((regle, index) => {
    for (const selecteur of regle.selecteurs) {
      for (const decl of regle.declarations) {
        const gagnante = derniere.get(`${selecteur}|${regle.media}|${decl.propriete}|${decl.force}`);
        // Gagnante DANS LA MÊME RÈGLE : c'est un repli délibéré
        // (`display:-webkit-box; display:flex`). On n'y touche pas.
        if (!gagnante || gagnante.index === index) continue;
        mortes.push({
          fichier: regle.fichier, ligne: regle.ligne, selecteur,
          // Une règle GROUPÉE (« a, b { … } ») ne peut pas être amputée sur la foi d'un
          // seul de ses sélecteurs : les autres pourraient rester vivants.
          groupee: regle.selecteurs.length > 1,
          media: regle.media, propriete: decl.propriete, valeur: decl.valeur,
          force: decl.force,
          // Bornes de LA DÉCLARATION, point-virgule compris : de quoi réécrire au caractère
          // près, sans jamais raisonner « une propriété quelque part dans ce bloc ».
          debut: decl.debut, fin: decl.fin,
          blocDebut: regle.debut, blocFin: regle.fin,
          eclipseePar: `${gagnante.regle.fichier}:${gagnante.regle.ligne}`,
          valeurGagnante: gagnante.decl.valeur
        });
      }
    }
  });
  return mortes;
}

export function analyser() {
  const feuilles = feuillesLiees();
  const toutes = [];
  for (const feuille of feuilles) {
    const source = fs.readFileSync(path.join(RACINE, feuille), 'utf8');
    toutes.push(...lireRegles(source, feuille));
  }
  return { feuilles, regles: toutes.length, mortes: detecterMortes(toutes) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { feuilles, regles, mortes } = analyser();
  const forcees = mortes.filter(m => m.force);
  const simples = mortes.filter(m => !m.force && !m.groupee);
  console.log(`\n=== DÉCLARATIONS PROVABLEMENT MORTES ===`);
  console.log(`feuilles analysées : ${feuilles.length} · règles : ${regles}`);
  console.log(`déclarations mortes : ${mortes.length}`);
  console.log(`  dont « !important » : ${forcees.length}`);
  console.log(`  dont sur sélecteur groupé (à ne pas retirer à l'aveugle) : ${mortes.filter(m => m.groupee).length}`);

  const parFichier = new Map();
  for (const m of mortes) parFichier.set(m.fichier, (parFichier.get(m.fichier) || 0) + 1);
  console.log('\npar feuille :');
  for (const [f, n] of [...parFichier].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }

  console.log('\n« !important » morts, non groupés — les plus sûrs à retirer :');
  for (const m of forcees.filter(x => !x.groupee).slice(0, 14)) {
    console.log(`  ${m.fichier}:${m.ligne} ${m.media ? `@${m.media.slice(0, 20)} ` : ''}${m.selecteur} { ${m.propriete} } → éclipsée par ${m.eclipseePar}`);
  }
  console.log(`\n  (${simples.length} déclarations mortes sans !important, non groupées)`);
}
