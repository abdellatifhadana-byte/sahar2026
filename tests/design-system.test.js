import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const feuille = read('design-system.css');

// Les commentaires de cette feuille décrivent les batailles qu'elle tranche, et citent donc
// les motifs qu'on interdit par ailleurs. On n'analyse que les règles.
const reglesSeules = feuille.replace(/\/\*[\s\S]*?\*\//g, '');

const blocs = [...reglesSeules.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(bloc => ({
  selecteurs: bloc[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
  corps: bloc[2]
}));

test('la feuille d’arbitrage est chargée en dernier, sauf le survol Pilote Technique qui la suit sciemment', () => {
  // Une feuille d'arbitrage qui ne serait pas la dernière ne trancherait rien : elle
  // deviendrait un plaideur de plus — sauf `pilot-technique-preview.css`, seule
  // dérogation NOMMÉE. Ce n'est pas un plaideur de plus : c'est un survol opt-in
  // (`?pilote=1`), sans effet tant qu'il n'est pas activé, dont le rôle EST de
  // l'emporter sur l'arbitrage une fois actif — il doit donc charger après lui, jamais
  // avant. `signal-spine.test.js` porte la même règle pour la même raison.
  const html = read('index.html');
  const chargees = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m => m[1]);
  const derniere = chargees.at(-1);
  const DEROGATION = 'pilot-technique-preview.css';
  if (derniere === DEROGATION) {
    assert.equal(chargees.at(-2), 'design-system.css',
      `dernière feuille avant le survol : ${chargees.at(-2)}`);
  } else {
    assert.equal(derniere, 'design-system.css', `dernière feuille chargée : ${derniere}`);
  }
});

test('la feuille est mise en cache hors ligne comme les autres', () => {
  // Absente du service worker, elle disparaîtrait hors ligne et la page changerait d'aspect.
  assert.match(read('service-worker.js'), /'\/design-system\.css'/);
});

test('les sélecteurs visent la structure réelle du DOM', () => {
  // Mesuré : `.admin-page` est un div DANS `#app`, et `document.body.className` vaut
  // « theme-admin light-theme ». Un sélecteur `body.admin-page` ne correspondrait à rien —
  // la feuille serait inerte tout en paraissant correcte.
  assert.doesNotMatch(reglesSeules, /body\.admin-page/);
  assert.match(reglesSeules, /#app \.admin-page/);
});

test('aucune règle ne touche à la géométrie de mise en page', () => {
  // C'est la garantie de non-déformation, rendue vérifiable : la feuille ne traite que la
  // surface. Les équerres de repérage sont exemptées — elles sont hors flux, donc sans effet
  // sur la position de quoi que ce soit.
  const interdites = /(?:^|;)\s*(width|height|min-width|max-width|min-height|max-height|grid-template-columns|grid-template-rows|grid-template-areas|flex-direction|flex-wrap|float|display|margin|margin-top|margin-right|margin-bottom|margin-left|inset|top|right|bottom|left)\s*:/;
  const fautes = [];
  for (const bloc of blocs) {
    const horsFlux = bloc.selecteurs.every(s => /::(before|after)/.test(s));
    if (horsFlux) continue;
    const faute = bloc.corps.match(interdites);
    if (faute) fautes.push(`${bloc.selecteurs.join(', ')} → ${faute[1]}`);
  }
  assert.deepEqual(fautes, [], `propriétés de mise en page déclarées :\n  ${fautes.join('\n  ')}`);
});

test('le seul `position` posé sur un élément réel est `relative`', () => {
  // `relative` ne déplace rien : il ne sert qu'à ancrer les équerres absolues.
  // `absolute`, `fixed` ou `sticky` sortiraient un élément du flux et déformeraient la page.
  for (const bloc of blocs) {
    if (bloc.selecteurs.every(s => /::(before|after)/.test(s))) continue;
    const position = bloc.corps.match(/(?:^|;)\s*position\s*:\s*([a-z-]+)/);
    if (position) assert.equal(position[1], 'relative', `${bloc.selecteurs.join(', ')} → position: ${position[1]}`);
  }
});

test('le seul `padding` déclaré est celui du conflit arbitré', () => {
  // `.admin-content { padding }` est disputé par cinq feuilles. On le fige à la valeur qui
  // gagnait déjà à l'exécution — mesuré identique avant/après sur les 19 sections.
  const avecPadding = blocs.filter(bloc => /(?:^|;)\s*padding\s*:/.test(bloc.corps));
  for (const bloc of avecPadding) {
    assert.ok(bloc.selecteurs.every(s => /\.admin-content$/.test(s)),
      `padding déclaré hors de l'arbitrage : ${bloc.selecteurs.join(', ')}`);
  }
});

test('chaque `!important` est justifié en commentaire, et ils restent peu nombreux', () => {
  // La feuille est le seul endroit autorisé à forcer, parce que les feuilles précédentes
  // totalisent plus de mille déclarations forcées. Ce privilège doit rester borné, sinon
  // l'arbitre devient un plaideur de plus.
  const forces = (reglesSeules.match(/!important/g) || []).length;
  assert.ok(forces <= 20, `${forces} !important dans la feuille d'arbitrage`);

  // Chaque bloc qui force doit porter, dans le source d'origine, un commentaire explicatif.
  const source = feuille;
  for (const bloc of blocs) {
    if (!/!important/.test(bloc.corps)) continue;
    const debut = source.indexOf(bloc.selecteurs[0]);
    const amont = source.slice(Math.max(0, debut - 700), debut);
    assert.match(amont, /\/\*/, `aucun commentaire au-dessus de « ${bloc.selecteurs[0]} »`);
  }
});

test('les jetons ne sont jamais posés sur `:root`', () => {
  // Posés globalement, ils écraseraient les variables des trente et une feuilles existantes.
  // Portés par les hôtes de contenu, ils n'atteignent que ce que cette feuille traite.
  assert.doesNotMatch(reglesSeules, /:root\s*[,{]/);
  assert.match(reglesSeules, /\.admin-page,/);
});

test('l’état se lit en vocabulaire de diffusion, pas en succès/erreur', () => {
  for (const jeton of ['--tk-locked', '--tk-degraded', '--tk-lost', '--tk-idle']) {
    assert.match(reglesSeules, new RegExp(`${jeton}\\s*:`), `jeton manquant : ${jeton}`);
  }
  // Le rail latéral porte l'état ; le filet coloré inférieur d'ui-refresh.css reste intact.
  assert.match(reglesSeules, /#app \.admin-page \.stat-card \{[\s\S]{0,200}border-left: 3px solid var\(--tk-idle\)/);
  assert.doesNotMatch(reglesSeules, /\.stat-card::after/);
});

test('l’étiquette de tuile vise le `span` réellement présent', () => {
  // Mesuré : `<button class="stat-card"><i/><strong>52</strong><span>Équipements</span></button>`.
  // Ni `small` ni `.stat-label` n'existent dans ce balisage ; les viser seuls rendait la
  // règle inerte tout en paraissant juste.
  assert.match(reglesSeules, /#app \.admin-page \.stat-card > span/);
  // `font-size` non forcé : mobile-runtime.css le réduit délibérément en petit écran.
  const bloc = blocs.find(b => b.selecteurs.includes('#app .admin-page .stat-card > span'));
  assert.ok(bloc, 'bloc de l’étiquette introuvable');
  assert.doesNotMatch(bloc.corps.match(/font-size:[^;]*/)?.[0] || '', /!important/);
});

test('le mouvement réduit est respecté', () => {
  assert.match(reglesSeules, /@media \(prefers-reduced-motion: reduce\)/);
});
