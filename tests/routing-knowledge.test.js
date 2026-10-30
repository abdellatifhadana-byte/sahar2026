import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTING_KNOWLEDGE } from '../routing-knowledge-seed.js';

test('connaissance routage: contient la référence panneau et la procédure générique', () => {
  const ids = new Set(ROUTING_KNOWLEDGE.map(item => item.id));
  assert.ok(ids.has('kb-imagine-magellan-rcp64pb-oled'));
  assert.ok(ids.has('kb-article-routing-destination-source-take'));
});

test('connaissance routage: ne code pas les alias internes du site', () => {
  const text = JSON.stringify(ROUTING_KNOWLEDGE).toUpperCase();
  for (const sensitiveAlias of ['NACQ1', 'NACQ2', 'ST21']) {
    assert.equal(text.includes(sensitiveAlias), false, `${sensitiveAlias} ne doit pas être codé en dur dans le dépôt public`);
  }
});

test('connaissance routage: le modèle exact reste à confirmer', () => {
  const panel = ROUTING_KNOWLEDGE.find(item => item.id === 'kb-imagine-magellan-rcp64pb-oled');
  assert.equal(panel.verificationStatus, 'to-confirm');
  assert.match(panel.sourceNote, /Ne pas confondre le panneau de commande avec la matrice\/router/);
});
