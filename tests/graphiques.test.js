import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const tableau = lire('dashboard.js');
const technicien = lire('techui.js');
const html = lire('index.html');
const sw = lire('service-worker.js');

/*
 * LES DEUX GRAPHIQUES DE LA PLATEFORME, ET POURQUOI AUCUN NE MONTRAIT RIEN.
 *
 * Deux causes distinctes, trouvées en regardant les captures de la production :
 *
 *   — L'anneau « État des équipements » ne connaissait que trois catégories : actif, en
 *     maintenance, en panne. Or les 448 équipements de 2M sont TOUS « à vérifier ». Les
 *     trois valaient donc 0, et l'anneau dessinait un cadre vide avec un « 0 » au milieu.
 *
 *   — Le graphique du technicien attendait `Chart`. `index.html` chargeait
 *     `assets/chart.js` — 36 Ko définissant `window.BarChart`, une petite bibliothèque de
 *     barres sans aucun rapport, que personne n'utilise. La vraie bibliothèque dormait à la
 *     racine, jamais chargée.
 */

/* ============================================== l'anneau du tableau de bord */

test('l’anneau connaît les QUATRE états, « à vérifier » compris', () => {
  // C'est la catégorie qui décrit 100 % du parc réel. L'ignorer rendait le graphique
  // structurellement incapable de montrer quoi que ce soit.
  assert.match(tableau, /renderEquipmentsChart\(canvas, active, maintenance, faulty, toVerify\)/);
  assert.match(tableau, /renderEquipmentsChart\(canvas, active, maintenance, faulty, toVerify = 0\)/);
  for (const cle of ['active', 'maintenance', 'faulty', 'toVerify']) {
    assert.ok(new RegExp(`cle: '${cle}'`).test(tableau), `l’état « ${cle} » manque à la table`);
  }
});

test('un parc vide le DIT, au lieu de dessiner un anneau vide', () => {
  // Un cadre vide avec « 0 » se lit comme une panne d'affichage, pas comme une absence
  // de données.
  assert.match(tableau, /if \(!somme\) \{/);
  assert.match(tableau, /Aucun équipement enregistré/);
});

test('les couleurs sont déclarées UNE fois, pour l’anneau et la légende', () => {
  // Deux listes tenues d'accord à la main finissent par se contredire, et une légende qui
  // ment sur une couleur est pire que pas de légende.
  assert.equal((tableau.match(/#27ae60/g) || []).length, 1, 'la couleur « actif » est écrite deux fois');
  assert.equal((tableau.match(/#5b8aa8/g) || []).length, 1, 'la couleur « à vérifier » est écrite deux fois');
  assert.match(tableau, /const colors = ETATS_DU_PARC\.map\(etat => etat\.couleur\)/);
  assert.match(tableau, /for \(const etat of ETATS_DU_PARC\)/);
});

test('la légende existe et nomme chaque couleur', () => {
  // Quatre couleurs sans légende ne veulent rien dire pour celui qui regarde.
  assert.match(tableau, /createChartLegend\(\{ active, maintenance, faulty, toVerify \}\)/);
  for (const libelle of ['Actifs', 'En maintenance', 'En panne', 'À vérifier']) {
    assert.ok(tableau.includes(libelle), `le libellé « ${libelle} » manque à la légende`);
  }
  assert.match(lire('admin.css'), /\.chart-legend \{/);
});

/* ============================================== le graphique du technicien */

test('la mauvaise bibliothèque n’est plus chargée', () => {
  // `assets/chart.js` définit `window.BarChart`, que PERSONNE n'utilise : 36 Ko téléchargés
  // à chaque ouverture pour rien, et qui laissaient croire qu'un graphique était disponible.
  assert.doesNotMatch(html, /assets\/chart\.js/, 'assets/chart.js est de nouveau chargé');
  assert.doesNotMatch(sw, /assets\/chart\.js/, 'assets/chart.js est encore mis en cache');
});

test('la vraie bibliothèque est chargée À LA DEMANDE, pas dans la page', () => {
  // 70 Ko compressés, et SEUL le technicien voit ce graphique : la poser dans `index.html`
  // la ferait télécharger par cinq rôles qui ne l'ouvriront jamais.
  assert.doesNotMatch(html, /<script[^>]+src="Chart\.js"/, 'Chart.js est chargé pour tout le monde');
  assert.match(technicien, /async chargerChartJs\(\)/);
  assert.match(technicien, /script\.src = 'Chart\.js'/);
  // …mais le service worker la garde, sinon le premier passage hors ligne échoue.
  assert.match(sw, /'\/Chart\.js'/);
});

test('un échec de chargement ne laisse pas un cadre vide pour toujours', () => {
  // `onerror` doit résoudre : sans lui, la promesse reste en attente et le graphique
  // n'affiche jamais rien, pas même une explication.
  assert.match(technicien, /script\.onerror = \(\) => resolve\(false\)/);
  assert.match(technicien, /Graphique indisponible pour le moment/);
  // Et les chiffres sont donnés quand même : c'est eux qu'on venait chercher.
  assert.match(technicien, /const chiffres = data\.labels/);
});

test('le message d’erreur en anglais a disparu', () => {
  // « Charting library (Chart.js) not loaded » s'affichait en production — au point que
  // `french-ui-guard.js` avait fini par le traduire à la volée.
  assert.doesNotMatch(technicien, /Charting library/);
});

test('la bibliothèque n’est demandée qu’une seule fois', () => {
  // Deux appels au rendu ne doivent pas injecter deux fois 70 Ko.
  assert.match(technicien, /_chargementChart \?\?=/);
  assert.match(technicien, /if \(typeof Chart !== 'undefined'\) return true;/);
});
