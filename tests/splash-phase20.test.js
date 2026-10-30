import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const splash = read('startup-splash.js');
const css = read('startup-splash.css');
const admin = read('admin-ui.js');

test('Phase 20 regression: le splash reste assemblé dans un workspace unique', () => {
  assert.match(splash, /startup-logo-assembly/);
  assert.match(splash, /startup-logo-segment/);
  assert.match(css, /startup-logo-wrap\{[^}]*aspect-ratio:1/);
  assert.match(css, /startup-piece-in/);
  assert.match(css, /startup-copy-in/);
  assert.doesNotMatch(css, /translate\([^)]*100vw/);
  assert.doesNotMatch(css, /translate\([^)]*100vh/);
});

test('Phase 20 regression: le titre et la progression restent hors de la zone animée du logo', () => {
  assert.match(splash, /<div class="startup-logo-wrap">[\s\S]*?<div class="startup-copy">/);
  assert.match(splash, /<div class="startup-progress-zone">/);
  assert.match(css, /startup-logo-wrap\{[^}]*margin:0 auto/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /startup-progress\{[^}]*width:min\(680px,84vw\)/);
});

test('Phase 20 regression: le splash conserve une durée visible et une version monotone', () => {
  const duration = Number(splash.match(/MIN_SPLASH_DURATION_MS = (\d+)/)?.[1] || 0);
  const version = Number(splash.match(/STARTUP_SPLASH_VERSION = (\d+)/)?.[1] || 0);
  assert.ok(duration >= 1650, `durée trop courte: ${duration} ms`);
  // Le plancher tient toujours ; l'éveil lumineux en occupe une part au lieu de s'y ajouter,
  // de sorte que la lueur ne rallonge pas le démarrage.
  assert.match(splash, /Math\.max\(0, MIN_SPLASH_DURATION_MS - elapsed - AWAKEN_MS\)/);
  assert.ok(version >= 2, `version splash régressive: ${version}`);
});

test('the header button next to the interactive map is the theme switcher', () => {
  assert.match(admin, /id="quick-theme"/);
  assert.match(admin, /title="Basculer le thème"/);
  assert.match(admin, /this\.toggleTheme\(\)/);
  assert.match(admin, /localStorage\.setItem\('theme', newTheme\)/);
});
