#!/usr/bin/env node
/**
 * @file scripts/carte-liaisons.mjs — la carte des liaisons INVISIBLES.
 *
 * POURQUOI CET OUTIL EXISTE
 * -------------------------
 * Le propriétaire l'a formulé après m'avoir pris en défaut plusieurs fois de suite :
 * « المنصة بالكامل كل الصفحات لها علاقات بينها… لكن لاحظت أنك تقرأ فقط شيئ وتنسى عدة
 * أشياء، عدة اتصالات وروابط لم تراها ». Il avait raison, et la cause est mécanique, pas
 * une question d'attention.
 *
 * Cette plateforme ne se relie PAS principalement par `import`. Elle se relie par :
 *
 *   — enveloppe de prototype : une dizaine de modules réécrivent `AdminUI.prototype.*`
 *     sans qu'aucun ne soit importé par admin-ui.js ;
 *   — auto-installation : `equipment-media.js` ne fournit rien à personne, il OBSERVE le
 *     DOM et décore ce qui apparaît. J'ai conclu « appelé par personne » en cherchant ses
 *     importateurs : la question était fausse, donc la réponse aussi ;
 *   — objets globaux : `window.EquipmentMedia`, `window.AppDialog`, `window.db`… ;
 *   — événements sur mesure : émis ici, écoutés trois fichiers plus loin ;
 *   — magasins partagés : deux modules qui n'ont aucun lien de code écrivent le même
 *     magasin, et divergent en silence — c'est exactement ce qui a fait tomber huit
 *     enregistrements en `to-confirm`.
 *
 * Un graphe d'`import` ne voit AUCUNE de ces cinq liaisons. Lire fichier par fichier non
 * plus. D'où cet outil : il les MESURE, pour qu'on cesse de compter sur la mémoire.
 *
 * Tout est exporté, donc exécutable par un test.
 */
import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(new URL('..', import.meta.url).pathname);
const IGNORES = new Set(['node_modules', '.git', 'LEGACY-ROOT', 'SOURCE-WALLS', 'utils', 'assets', 'tests', 'scripts']);

/** Les fichiers réellement chargés par la page, plus ce qu'ils importent. */
export function modulesActifs() {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const file = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => path.resolve(RACINE, m[1]));
  const vus = new Set();
  while (file.length) {
    const f = file.pop();
    if (vus.has(f) || !fs.existsSync(f)) continue;
    vus.add(f);
    const source = fs.readFileSync(f, 'utf8');
    for (const m of source.matchAll(/(?:import[\s\S]*?from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) file.push(path.resolve(path.dirname(f), m[1]));
    }
  }
  return [...vus].map(f => path.relative(RACINE, f)).filter(f => !f.split('/').some(p => IGNORES.has(p))).sort();
}

/**
 * Masque commentaires et chaînes à longueur constante.
 * Sans cela, un nom de magasin cité dans un commentaire compte comme une écriture, et une
 * accolade dans une chaîne décale tout le reste.
 */
export function masquer(source) {
  let out = '', i = 0;
  while (i < source.length) {
    const c = source[i], d = source[i + 1];
    if (c === '/' && d === '/') { while (i < source.length && source[i] !== '\n') { out += ' '; i += 1; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out += source[i] === '\n' ? '\n' : ' '; i += 1; } out += '  '; i += 2; continue; }
    out += c; i += 1;
  }
  return out;
}

const CHAMPS = Object.freeze(['patchePrototype', 'ecritGlobal', 'litGlobal', 'emet', 'ecoute', 'observeDOM', 'ecritMagasin', 'litMagasin', 'autoInstalle']);

/** Les liaisons d'UN module, mesurées sur sa source. */
export function liaisonsDe(fichier, source) {
  const s = masquer(source);
  const uniq = (re, g = 1) => [...new Set([...s.matchAll(re)].map(m => m[g]))].sort();
  return {
    fichier,
    patchePrototype: uniq(/([A-Za-z_$][\w$]*)\.prototype\.([\w$]+)\s*=/g, 0).map(x => x.replace(/\s*=$/, '')),
    ecritGlobal: uniq(/window\.([A-Z][\w$]*)\s*=/g),
    litGlobal: uniq(/window\.([A-Z][\w$]*)(?!\s*=)/g),
    emet: uniq(/(?:dispatchEvent\s*\(\s*new\s+CustomEvent\s*\(\s*|emit\s*\(\s*)['"]([^'"]+)['"]/g),
    ecoute: uniq(/addEventListener\s*\(\s*['"]([a-z][\w-]*(?:-[\w-]+)+)['"]/g),
    observeDOM: /new\s+MutationObserver/.test(s),
    ecritMagasin: uniq(/db\.(?:save|delete|_deleteRaw|put)\s*\(\s*['"]([^'"]+)['"]/g),
    litMagasin: uniq(/db\.(?:get|getAll)\s*\(\s*['"]([^'"]+)['"]/g),
    // Un module qui APPELLE quelque chose au niveau racine agit sans être importé.
    autoInstalle: /^\s*(?:install|patch|ensure|enhance|setup|register)[A-Z][\w$]*\s*\(/m.test(s)
      || /^\s*if\s*\(typeof window/m.test(s)
  };
}

/** La carte complète. */
export function carte() {
  return modulesActifs().map(f => liaisonsDe(f, fs.readFileSync(path.join(RACINE, f), 'utf8')));
}

/** Modules qui ne sont importés par PERSONNE : ils agissent uniquement par effet de bord. */
export function modulesNonImportes(c = carte()) {
  const importes = new Set();
  for (const { fichier } of c) {
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    for (const m of source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
      importes.add(path.relative(RACINE, path.resolve(path.dirname(path.join(RACINE, fichier)), m[1])));
    }
  }
  return c.filter(l => !importes.has(l.fichier));
}

/** Magasins écrits par plusieurs modules qui ne se connaissent pas : source de divergence. */
export function magasinsPartages(c = carte()) {
  const par = new Map();
  for (const l of c) for (const magasin of l.ecritMagasin) {
    if (!par.has(magasin)) par.set(magasin, []);
    par.get(magasin).push(l.fichier);
  }
  return [...par.entries()].filter(([, f]) => f.length > 1).sort((a, b) => b[1].length - a[1].length);
}

/** Un module est « invisible au graphe d'import » s'il n'est importé par personne ET agit. */
export function liaisonsInvisibles(c = carte()) {
  return modulesNonImportes(c).filter(l =>
    l.patchePrototype.length || l.ecritGlobal.length || l.observeDOM || l.autoInstalle);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = carte();
  const invisibles = liaisonsInvisibles(c);
  const partages = magasinsPartages(c);
  console.log(`${c.length} modules actifs analysés.\n`);

  console.log(`LIAISONS INVISIBLES AU GRAPHE D'IMPORT — ${invisibles.length} modules`);
  console.log('Aucun `import` ne les relie : ils agissent en se chargeant.\n');
  for (const l of invisibles.slice(0, 40)) {
    const quoi = [
      l.patchePrototype.length ? `enveloppe ${l.patchePrototype.slice(0, 2).join(', ')}` : '',
      l.ecritGlobal.length ? `pose window.${l.ecritGlobal.join(', window.')}` : '',
      l.observeDOM ? 'observe le DOM' : '',
      l.autoInstalle ? 'auto-installé' : ''
    ].filter(Boolean).join(' · ');
    console.log(`  ${l.fichier.padEnd(38)} ${quoi}`);
  }
  if (invisibles.length > 40) console.log(`  … et ${invisibles.length - 40} autres`);

  console.log(`\nMAGASINS ÉCRITS PAR PLUSIEURS MODULES — ${partages.length}`);
  console.log("Deux écrivains sans lien de code peuvent diverger en silence.\n");
  for (const [magasin, fichiers] of partages.slice(0, 12)) {
    console.log(`  ${magasin.padEnd(20)} ${fichiers.length} écrivains : ${fichiers.slice(0, 4).join(', ')}${fichiers.length > 4 ? '…' : ''}`);
  }
  // LES ÉVÉNEMENTS NE SONT PAS RAPPORTÉS ICI, ET C'EST DÉLIBÉRÉ.
  //
  // Une première version les comptait et annonçait « 10 émis sans auditeur ». Or
  // `check-structure.mjs` en dit 0 — parce qu'il porte une LISTE DE JUSTIFICATIONS : ces
  // dix-là transportent une information déjà portée autrement, chacun avec sa raison
  // écrite, et une justification devenue périmée y est signalée à son tour.
  //
  // Deux outils qui se contredisent sur le même sujet valent moins qu'un seul : celui qui
  // a tort décrédibilise celui qui a raison, et on ne sait plus lequel croire. Les
  // événements appartiennent à `check-structure`. Cet outil-ci mesure ce que RIEN d'autre
  // ne mesure : les liaisons qu'aucun `import` ne montre.
  console.log('\nÉvénements : voir `npm run check:structure`, qui les arbitre avec leurs justifications.');
}
