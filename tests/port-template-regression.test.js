import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  catalogPortTemplate,
  defaultSelection,
  buildPortsFromTemplate,
  compatibleCableTypes,
  normalizeTemplateConnector,
  PORT_TEMPLATE_VERSION
} from '../equipment-port-template.js';
import { evaluateConnection } from '../connectivity-contract.js';

test('production catalog id exposes MC1-UHD template without a second catalog store', () => {
  const template = catalogPortTemplate({ id:'kb-ross-mc1uhd' });
  assert.equal(PORT_TEMPLATE_VERSION, 2);
  assert.equal(template.length, 3);
  assert.deepEqual(defaultSelection(template), { 'sdi-in':6, 'sdi-out':6, ref:1 });
});

test('model formats become capabilities, never observed instance formats', () => {
  const template = catalogPortTemplate({ id:'kb-ross-mc1uhd' });
  const result = buildPortsFromTemplate(template, defaultSelection(template), { catalogId:'kb-ross-mc1uhd' });
  assert.equal(result.added.length, 13);
  const sdi = result.added.find(port => port.number === 'SDI-IN-1');
  assert.ok(sdi);
  assert.deepEqual(sdi.formats, []);
  assert.ok(sdi.formatCapabilities.includes('12G-SDI'));
  assert.equal(sdi.verificationStatus, 'to-confirm');
});

test('unknown exact connector stays to-confirm instead of being falsely treated as BNC', () => {
  assert.deepEqual(normalizeTemplateConnector('HD_BNC'), { value:'UNKNOWN', known:false, original:'HD_BNC' });
  const template = catalogPortTemplate({ id:'kb-ross-mc1uhd' });
  const { added } = buildPortsFromTemplate(template, { 'sdi-out':1 }, { catalogId:'kb-ross-mc1uhd' });
  const sourcePort = added[0];
  const destinationPort = {
    id:'DEST-1', number:'1', type:'12G-SDI', direction:'IN',
    verificationStatus:'observed', formats:[], formatCapabilities:['12G-SDI']
  };
  const verdict = evaluateConnection({ sourcePort, destinationPort, cable:{ category:'Vidéo', type:'12G-SDI' } });
  assert.equal(verdict.status, 'to-confirm');
  const choices = compatibleCableTypes(sourcePort, destinationPort);
  const twelveG = choices.find(item => item.category === 'Vidéo' && item.type === '12G-SDI');
  assert.equal(twelveG?.usable, true);
  assert.equal(twelveG?.status, 'to-confirm');
});

test('cable UI keeps zero-compatible results empty and disabled', () => {
  const here = fileURLToPath(new URL('../component-relations.js', import.meta.url));
  const source = fs.readFileSync(here, 'utf8');
  assert.match(source, /form\.type\.disabled = true/);
  assert.match(source, /Aucun type compatible dans cette catégorie/);
  assert.doesNotMatch(source, /usable\.length\s*\?\s*usable\s*:\s*all/);
  assert.match(source, /if \(!values\.type\)/);
});
