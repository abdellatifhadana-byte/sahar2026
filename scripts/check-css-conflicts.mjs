// Cartographie des conflits de style : quelles propriétés sont déclarées plusieurs fois,
// pour le même sélecteur, à travers les feuilles empilées — et lesquelles se battent
// à coups de `!important`. On mesure avant de toucher.
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const feuilles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
  .map(m => m[1]).filter(f => !/^https?:/.test(f) && fs.existsSync(f));

const declarations = new Map();   // "sélecteur|propriété" -> [{feuille, important, valeur}]
const parFeuille = new Map();

for (const feuille of feuilles) {
  const source = fs.readFileSync(feuille, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let importants = 0; let regles = 0;
  for (const bloc of source.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selecteurs = bloc[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const corps = bloc[2];
    if (!selecteurs.length) continue;
    regles += selecteurs.length;
    for (const declaration of corps.split(';')) {
      const [propBrut, ...reste] = declaration.split(':');
      const propriete = propBrut.trim();
      if (!propriete || !reste.length) continue;
      const valeur = reste.join(':').trim();
      const important = /!important/.test(valeur);
      if (important) importants += 1;
      for (const selecteur of selecteurs) {
        const cle = `${selecteur}|${propriete}`;
        if (!declarations.has(cle)) declarations.set(cle, []);
        declarations.get(cle).push({ feuille, important, valeur: valeur.replace(/\s*!important/, '') });
      }
    }
  }
  parFeuille.set(feuille, { regles, importants });
}

const conflits = [];
for (const [cle, liste] of declarations) {
  const feuillesDistinctes = new Set(liste.map(d => d.feuille));
  if (feuillesDistinctes.size < 2) continue;
  const valeurs = new Set(liste.map(d => d.valeur));
  if (valeurs.size < 2) continue;   // même valeur répétée : redondance, pas conflit
  conflits.push({ cle, liste, feuilles: [...feuillesDistinctes] });
}
conflits.sort((a, b) => b.liste.length - a.liste.length);

console.log(`\n=== ${feuilles.length} feuilles chargées ===\n`);
console.log('  feuille                              règles  !important');
for (const [feuille, stats] of parFeuille) {
  console.log(`  ${feuille.padEnd(34)} ${String(stats.regles).padStart(6)} ${String(stats.importants).padStart(10)}`);
}
const totalImportants = [...parFeuille.values()].reduce((s, x) => s + x.importants, 0);
console.log(`  ${'TOTAL'.padEnd(34)} ${String([...parFeuille.values()].reduce((s, x) => s + x.regles, 0)).padStart(6)} ${String(totalImportants).padStart(10)}`);

console.log(`\n=== ${conflits.length} propriétés en conflit entre feuilles ===\n`);
for (const conflit of conflits.slice(0, 25)) {
  const [selecteur, propriete] = conflit.cle.split('|');
  const gagnante = conflit.liste.filter(d => d.important).pop() || conflit.liste[conflit.liste.length - 1];
  console.log(`  ${selecteur} { ${propriete} }`);
  for (const d of conflit.liste) {
    const marque = d === gagnante ? '→' : ' ';
    console.log(`    ${marque} ${d.feuille.padEnd(24)} ${d.important ? '!' : ' '} ${d.valeur.slice(0, 46)}`);
  }
}
if (conflits.length > 25) console.log(`  … +${conflits.length - 25} autres`);

// Une bataille de `!important` sur la même propriété est le signe le plus net de dérive.
const batailles = conflits.filter(c => c.liste.filter(d => d.important).length > 1);
console.log(`\n=== ${batailles.length} batailles de !important (plusieurs feuilles forcent la même propriété) ===`);
for (const bataille of batailles.slice(0, 14)) {
  const [selecteur, propriete] = bataille.cle.split('|');
  console.log(`  ${selecteur} { ${propriete} } ← ${bataille.feuilles.join(', ')}`);
}
if (batailles.length > 14) console.log(`  … +${batailles.length - 14} autres`);
