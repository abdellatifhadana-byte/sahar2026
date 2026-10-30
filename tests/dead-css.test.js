import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lireRegles, detecterMortes, analyser } from '../scripts/check-dead-css.mjs';
import { retirerDeclarations, lignesRetirees } from '../scripts/fix-dead-css.mjs';

/** Le critère appliqué à une feuille construite pour l'occasion. */
const mortesDe = (...feuilles) =>
  detecterMortes(feuilles.flatMap(([nom, source]) => lireRegles(source, nom)));

/*
 * NETTOYAGE DU CSS — ce qui autorise une suppression automatique.
 *
 * La dette mesurée est de 34 feuilles, 10 109 lignes et 1 286 `!important`. La retirer à la
 * main est impraticable ; la retirer à la devinette est destructeur. Un outil n'a donc le
 * droit de supprimer que ce qu'il peut PROUVER mort : même sélecteur, même condition média,
 * même importance, même propriété, et une déclaration plus tardive qui l'emporte toujours.
 *
 * Ces tests enferment les quatre erreurs commises en écrivant cet outil. Chacune aurait
 * cassé la plateforme en silence.
 */

/* ============================================================ 1. les pas de @keyframes */

test('un pas de @keyframes n’est pas un sélecteur', () => {
  // L'ERREUR : `0%`, `50%`, `to` se répètent dans CHAQUE animation. Traités comme des
  // sélecteurs ordinaires, le `0%` d'une animation « éclipse » le `0%` d'une autre, sans
  // aucun rapport. Mesuré sur la vraie cascade : 204 fausses détections, dont 156 auraient
  // été RETIRÉES — les animations auraient cessé de fonctionner sans un seul message.
  const feuille = `
    @keyframes tourner { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
    @keyframes glisser { 0% { transform: translateX(0) } 100% { transform: translateX(9px) } }
  `;
  assert.deepEqual(lireRegles(feuille, 'f.css'), []);
});

test('un @keyframes niché dans un @media reste hors d’atteinte', () => {
  const feuille = `@media (min-width: 900px) { @keyframes battre { from { opacity: 0 } to { opacity: 1 } } }`;
  assert.deepEqual(lireRegles(feuille, 'f.css'), []);
});

test('@font-face ne fournit pas non plus de sélecteur', () => {
  assert.deepEqual(lireRegles(`@font-face { font-family: "X"; src: url(x.woff2) }`, 'f.css'), []);
});

test('la vraie cascade ne contient plus une seule fausse détection de ce genre', () => {
  const pas = /^(from|to|\d+(\.\d+)?%)$/;
  const fautives = analyser().mortes.filter(m => pas.test(m.selecteur));
  assert.equal(fautives.length, 0,
    `${fautives.length} pas d’animation pris pour des sélecteurs, ex. « ${fautives[0]?.selecteur} »`);
});

test('un @media, lui, garde bien son contenu ET sa condition', () => {
  // La garde précédente ne doit pas se transformer en « on ignore tout ce qui commence
  // par @ » : les règles sous condition sont des règles, et leur condition les distingue.
  const regles = lireRegles(`@media (min-width: 900px) { .x { color: red } } .x { color: blue }`, 'f.css');
  assert.equal(regles.length, 2);
  assert.equal(regles[0].media, '@media (min-width: 900px)');
  assert.equal(regles[1].media, '');
  // Et donc PAS de conflit entre les deux : conditions différentes, contextes différents.
  const regle = lireRegles(`.x { color: red } @media print { .x { color: blue } }`, 'f.css');
  assert.notEqual(regle[0].media, regle[1].media);
});

/* ============================================================ 2. les bornes exactes */

test('chaque déclaration porte ses bornes exactes, point-virgule compris', () => {
  // L'ERREUR : sans bornes, un correcteur ne sait que dire « telle propriété, quelque part
  // dans ce bloc ». Sur cette base il annonçait 188 retraits pour 35 déclarations mortes :
  // il emportait des déclarations VIVANTES portant le même nom ailleurs dans la feuille.
  const feuille = `.a { color: red; padding: 4px }`;
  const [regle] = lireRegles(feuille, 'f.css');
  const [couleur, marge] = regle.declarations;
  assert.equal(feuille.slice(couleur.debut, couleur.fin), 'color: red;');
  assert.equal(feuille.slice(marge.debut, marge.fin), 'padding: 4px');
});

test('les bornes tiennent compte des commentaires, sans décaler d’un caractère', () => {
  // Les commentaires sont blanchis pour l'analyse — à longueur ET à lignes constantes,
  // sinon chaque offset relevé désignerait autre chose dans le fichier réel.
  const feuille = `/* un commentaire\n   sur trois\n   lignes */\n.a {\n  color: red;\n}`;
  const [regle] = lireRegles(feuille, 'f.css');
  assert.equal(feuille.slice(regle.declarations[0].debut, regle.declarations[0].fin), 'color: red;');
  // Une première version remplaçait chaque commentaire par des ESPACES, fins de ligne
  // comprises : toute règle située après un commentaire multiligne était annoncée trop haut
  // dans le fichier — ici ligne 1 au lieu de 4, soit un rapport qui désigne le mauvais code.
  assert.equal(regle.ligne, 4, 'la ligne annoncée ne survit pas au commentaire multiligne');
});

test('retirer une déclaration n’emporte pas son homonyme vivant', () => {
  // La preuve directe de l'erreur des 188 : deux `padding` dans la même feuille, un seul mort.
  const feuille = `.mort { padding: 1px !important; color: red }\n.vivant { padding: 2px !important }\n`;
  const [regle] = lireRegles(feuille, 'f.css');
  const sortie = retirerDeclarations(feuille, [regle.declarations[0]]);
  assert.ok(!sortie.includes('padding: 1px'), 'la déclaration morte est restée');
  assert.ok(sortie.includes('padding: 2px !important'), 'une déclaration vivante a été emportée');
  assert.ok(sortie.includes('color: red'), 'une déclaration voisine a été emportée');
});

test('une ligne entièrement vidée disparaît, une ligne partagée reste', () => {
  const seule = `.a {\n  color: red;\n  padding: 4px;\n}`;
  const [r1] = lireRegles(seule, 'f.css');
  assert.equal(retirerDeclarations(seule, [r1.declarations[0]]), `.a {\n  padding: 4px;\n}`);
  const partagee = `.a { color: red; padding: 4px }`;
  const [r2] = lireRegles(partagee, 'f.css');
  assert.equal(retirerDeclarations(partagee, [r2.declarations[0]]), `.a { padding: 4px }`);
});

test('retirer plusieurs déclarations d’un coup ne décale pas les suivantes', () => {
  // Le retrait se fait de la FIN vers le début : sinon la première suppression invalide
  // toutes les bornes relevées après elle.
  const feuille = `.a {\n  a: 1;\n  b: 2;\n  c: 3;\n  d: 4;\n}`;
  const [regle] = lireRegles(feuille, 'f.css');
  const sortie = retirerDeclarations(feuille, [regle.declarations[0], regle.declarations[2]]);
  assert.equal(sortie, `.a {\n  b: 2;\n  d: 4;\n}`);
});

/* ============================================================ 3. les chaînes et les url() */

test('une accolade dans une chaîne ne coupe pas la feuille en deux', () => {
  const feuille = `.a::after { content: "}"; color: red }`;
  const regles = lireRegles(feuille, 'f.css');
  assert.equal(regles.length, 1);
  assert.deepEqual(regles[0].declarations.map(d => d.propriete), ['content', 'color']);
});

test('un point-virgule dans une url() ne coupe pas la déclaration en deux', () => {
  // `url(data:image/svg+xml;base64,…)` : le `;` appartient à la valeur. Un découpage naïf
  // produirait une demi-déclaration et une valeur tronquée.
  const feuille = `.a { background: url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=); color: red }`;
  const [regle] = lireRegles(feuille, 'f.css');
  assert.deepEqual(regle.declarations.map(d => d.propriete), ['background', 'color']);
  assert.ok(regle.declarations[0].valeur.includes('base64,PHN2Zz48L3N2Zz4='));
});

test('deux sélecteurs qui ne diffèrent que par une chaîne restent distincts', () => {
  // Blanchir le contenu des chaînes sert à trouver les délimiteurs, PAS à lire les textes :
  // `[data-x="a"]` et `[data-x="b"]` deviendraient le même sélecteur, et l'un tuerait l'autre.
  const regles = lireRegles(`[data-x="a"] { color: red } [data-x="b"] { color: blue }`, 'f.css');
  assert.notEqual(regles[0].selecteurs[0], regles[1].selecteurs[0]);
});

/* ============================================================ 4. les replis délibérés */

test('un repli dans la MÊME règle n’est jamais déclaré mort', () => {
  // `display:-webkit-box` puis `display:flex` est un repli volontaire : le premier sert aux
  // navigateurs qui ignorent le second. Les croire concurrents, c'est casser ces navigateurs.
  assert.deepEqual(mortesDe(['f.css', `.a { display: -webkit-box; display: flex }`]), []);
  // Mais si une AUTRE règle, plus loin, redéclare la même propriété, les deux sont bien
  // éclipsées — le repli ne protège que contre son propre voisin.
  const mortes = mortesDe(['f.css', `.a { display: -webkit-box; display: flex }`],
    ['g.css', `.a { display: grid }`]);
  assert.equal(mortes.length, 2);
  assert.deepEqual([...new Set(mortes.map(m => m.eclipseePar))], ['g.css:1']);
});

test('le critère exige les QUATRE égalités, pas trois', () => {
  // Sélecteur, condition média, propriété, importance. Relâcher n'importe laquelle rend des
  // déclarations bien vivantes pour mortes.
  assert.deepEqual(mortesDe(['f.css', `.a { color: red }`], ['g.css', `.b { color: blue }`]), [],
    'sélecteurs différents');
  assert.deepEqual(mortesDe(['f.css', `.a { color: red }`], ['g.css', `.a { background: blue }`]), [],
    'propriétés différentes');
  assert.deepEqual(mortesDe(['f.css', `.a { color: red }`],
    ['g.css', `@media print { .a { color: blue } }`]), [], 'conditions différentes');
  assert.deepEqual(mortesDe(['f.css', `.a { color: red !important }`], ['g.css', `.a { color: blue }`]), [],
    'un `!important` n’est pas éclipsé par une déclaration ordinaire');
  // Les quatre réunies : là, et seulement là, la première ne peut rien produire.
  assert.equal(mortesDe(['f.css', `.a { color: red }`], ['g.css', `.a { color: blue }`]).length, 1);
});

test('la règle GROUPÉE est signalée, pour ne jamais être amputée à l’aveugle', () => {
  // `.a, .b { color: red }` avec `.a { color: blue }` plus loin : `.a` est morte, `.b` non.
  // Retirer la déclaration emporterait `.b` avec elle.
  const [morte] = mortesDe(['f.css', `.a, .b { color: red }`], ['g.css', `.a { color: blue }`]);
  assert.equal(morte.selecteur, '.a');
  assert.equal(morte.groupee, true);
});

test('les variables ne sont pas jugées : leur valeur peut être relue ailleurs', () => {
  const [regle] = lireRegles(`:root { --x: 1px; color: red }`, 'f.css');
  assert.deepEqual(regle.declarations.map(d => d.propriete), ['color']);
});

/* ============================================================ la relecture qui autorise */

test('la relecture refuse un résultat qui n’est pas l’original privé des cibles', () => {
  // C'EST LA GARDE QUI AUTORISE L'ÉCRITURE. Sans elle, l'outil écrit d'abord et on
  // découvre les dégâts ensuite.
  assert.deepEqual(lignesRetirees(['a', 'b', 'c'], ['a', 'c']), ['b']);
  assert.deepEqual(lignesRetirees(['a', 'b'], ['a', 'b']), []);
  // Une valeur ALTÉRÉE n'est pas un retrait : elle doit lever, pas passer.
  assert.throws(() => lignesRetirees(['a', 'b'], ['a', 'z']), /inattendue/);
  // Une déclaration AJOUTÉE non plus.
  assert.throws(() => lignesRetirees(['a'], ['a', 'b']), /inattendue/);
  // Un RÉORDONNANCEMENT non plus : la cascade dépend de l'ordre.
  assert.throws(() => lignesRetirees(['a', 'b'], ['b', 'a']), /inattendue/);
});

/* ============================================================ la cascade réelle */

test('chaque déclaration morte de la vraie cascade désigne bien du texte réel', () => {
  // Une borne fausse ne se voit pas dans un rapport : elle se voit quand le correcteur
  // découpe au mauvais endroit. On vérifie donc que chaque borne relue rend bien la
  // propriété annoncée, sur les 1 600 déclarations mortes de la base.
  const { mortes } = analyser();
  assert.ok(mortes.length > 0, 'plus aucune déclaration morte détectée — la mesure est morte');
  const racine = new URL('..', import.meta.url).pathname;
  const cache = new Map();
  for (const m of mortes) {
    if (!cache.has(m.fichier)) cache.set(m.fichier, fs.readFileSync(path.join(racine, m.fichier), 'utf8'));
    const texte = cache.get(m.fichier).slice(m.debut, m.fin);
    assert.ok(Number.isInteger(m.debut) && Number.isInteger(m.fin) && m.fin > m.debut,
      `bornes absentes pour ${m.fichier} { ${m.propriete} }`);
    assert.ok(texte.toLowerCase().startsWith(m.propriete),
      `${m.fichier}:${m.ligne} — les bornes rendent « ${texte.slice(0, 40)} » et non « ${m.propriete} »`);
  }
});
