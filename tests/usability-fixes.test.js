import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('equipment location fix keeps rack optional and normalizes out-of-rack equipment', async () => {
  const source = await readFile(new URL('../platform-usability-fixes.js', import.meta.url), 'utf8');
  assert.match(source, /Aucun rack — équipement hors baie/);
  assert.match(source, /placementMode = payload\.baieId == null \? 'hors-rack' : 'rack'/);
  assert.match(source, /rack\.required = false/);
});

test('admin shell can fully close and quick add has usable destinations', async () => {
  const js = await readFile(new URL('../platform-usability-fixes.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../ui-shell-fixes.css', import.meta.url), 'utf8');
  assert.match(js, /data-create="equipment"/);
  assert.match(js, /data-create="room"/);
  assert.match(js, /data-create="rack"/);
  assert.match(js, /data-create="ticket"/);
  assert.match(js, /data-create="handover"/);
  assert.match(css, /\.admin-page\.sidebar-closed \.admin-sidebar/);
  assert.match(css, /transform: translateX\(-105%\) !important/);
});
