import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 21: le splash dessine le symbole 2M en vectoriel, jamais une image bitmap', () => {
  const js = read('startup-splash.js');
  const css = read('startup-splash.css');
  const version = Number(js.match(/STARTUP_SPLASH_VERSION = (\d+)/)?.[1] || 0);
  // L'étoile générée (`STAR_SEGMENTS`) a été remplacée par les huit polygones officiels
  // du logo. L'invariant qui compte n'a pas changé : le symbole reste vectoriel, à huit
  // pièces, sans dépendre d'un fichier image.
  assert.match(js, /LOGO_PIECES/);
  assert.equal((js.match(/points:'/g) || []).length, 8);
  assert.doesNotMatch(js, /2m-logo\.webp/);
  assert.doesNotMatch(js, /<img/);
  assert.ok(version >= 3, `version splash régressive: ${version}`);
  assert.match(css, /aspect-ratio:1/);
  assert.match(css, /startup-piece-in/);
});

test('Phase 21: le contrat mobile reste après les couches cartographiques historiques', () => {
  const html = read('index.html');
  const mapCssIndex = html.indexOf('map-digital-twin.css');
  const mobileCssIndex = html.indexOf('mobile-runtime.css');
  assert.ok(mapCssIndex >= 0 && mobileCssIndex > mapCssIndex);
  assert.match(html, /viewport-fit=cover/);
});

test('Phase 21: Dashboard, carte et schémas ont des règles téléphone explicites', () => {
  const css = read('mobile-runtime.css');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /dashboard-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css, /#map-modal,#map-modal #map-container/);
  assert.match(css, /width:100dvw!important/);
  assert.match(css, /#diagram-editor-modal \.diagram-modal-card\{width:100dvw!important/);
  assert.match(css, /height:100dvh!important/);
});

test('Phase 21: le bouton menu Admin replie réellement le rail et rend la largeur au contenu', () => {
  const css = read('mobile-runtime.css');
  const admin = read('admin-ui.js');
  assert.match(admin, /querySelector\('\.admin-sidebar'\)\.classList\.toggle\('collapsed'\)/);
  assert.match(css, /\.admin-sidebar\.collapsed,\.admin-page\.sidebar-closed \.admin-sidebar\{transform:translateX\(-100%\)!important;opacity:0!important;pointer-events:none!important\}/);
  assert.match(css, /\.admin-sidebar\.collapsed~\.admin-tabs,\.admin-sidebar\.collapsed~\.admin-content/);
  assert.match(css, /margin-left:0!important;width:100%!important;max-width:100%!important/);
});

test('Phase 21: le cache PWA inclut le contrat mobile sans bloquer les versions ultérieures', () => {
  const sw = read('service-worker.js');
  const cache = sw.match(/const CACHE_NAME = '2mtech-v5\.(\d+)'/);
  assert.ok(cache && Number(cache[1]) >= 34, `version PWA régressive: ${cache?.[1] || 'absente'}`);
  assert.match(sw, /'\/mobile-runtime\.css'/);
});
