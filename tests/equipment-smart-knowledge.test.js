import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INITIAL_CATALOG } from '../equipment-knowledge.js';
import { EXTRA_EQUIPMENT_CATALOG } from '../equipment-catalog-extra-seed.js';
import { DEVICE_KNOWLEDGE_PACKS, resolveKnowledgePack } from '../equipment-knowledge-packs.js';
import {
  KNOWLEDGE_PROFILES,
  fieldsForKnowledgeProfile,
  inferKnowledgeProfile,
  normalizeEquipmentKnowledge,
  validateEquipmentKnowledge
} from '../equipment-knowledge-contract.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url),'utf8');
const catalog = [...INITIAL_CATALOG,...EXTRA_EQUIPMENT_CATALOG];

test('catalogue intelligent: 70 références uniques et une fiche adaptée pour chacune', () => {
  assert.equal(catalog.length,70);
  assert.equal(new Set(catalog.map(item => item.id)).size,catalog.length);
  for (const item of catalog) {
    const pack = resolveKnowledgePack(item);
    assert.ok(KNOWLEDGE_PROFILES[pack.profile],`profil absent pour ${item.id}`);
    assert.ok(pack.identificationChecklist.length,`checklist absente pour ${item.id}`);
  }
  assert.ok(Object.keys(DEVICE_KNOWLEDGE_PACKS).length >= 45);
  assert.ok(catalog.map(item => resolveKnowledgePack(item)).filter(pack => pack.facts.length).length >= 40);
});

test('faits constructeur: toute affirmation modèle est liée à une source HTTPS', () => {
  for (const item of catalog) {
    for (const fact of resolveKnowledgePack(item).facts) {
      assert.equal(fact.scope,'manufacturer');
      assert.match(fact.sourceUrl,/^https:\/\//,`source constructeur absente: ${item.id} / ${fact.label}`);
      assert.equal(fact.verificationStatus,'verified');
    }
  }
});

test('Grille Centrale et Grille72 / Platinum VX restent deux fiches distinctes', () => {
  const central = catalog.find(item => item.id === 'kb-grille-centrale-190x184');
  const platinum = catalog.find(item => item.id === 'kb-imagine-platinum-vx');
  assert.ok(central && platinum);
  assert.notEqual(central.id,platinum.id);
  assert.equal(central.manufacturer,'À identifier');
  // La CAPACITÉ des deux grilles était affirmée ici, depuis un module public. L'assertion
  // n'est pas supprimée : elle est déplacée à la frontière de confiance qui lui revient,
  // dans `tests/grille-centrale-evidence-boundary.test.js` — source publique muette,
  // runtime autorisé complet, runtime non autorisé vide.
});

test('profils dynamiques exposent les champs propres aux routeurs, serveurs et écrans sans doublons', () => {
  assert.equal(inferKnowledgeProfile({ model:'Synapse SFR08',type:'Châssis modulaire' }),'modular-frame');
  assert.equal(inferKnowledgeProfile({ model:'PowerEdge R750',type:'Serveur rack' }),'server');
  assert.equal(inferKnowledgeProfile({ model:'FortiGate 40F' }),'firewall');
  assert.ok(fieldsForKnowledgeProfile('router-matrix').some(field => field.key === 'installedMatrix'));
  assert.ok(fieldsForKnowledgeProfile('server').some(field => field.key === 'raidConfiguration'));
  assert.ok(fieldsForKnowledgeProfile('display').some(field => field.key === 'calibrationDate'));
  for (const profile of Object.keys(KNOWLEDGE_PROFILES)) {
    const keys = fieldsForKnowledgeProfile(profile).map(field => field.key);
    assert.equal(new Set(keys).size,keys.length,`champ dupliqué dans ${profile}`);
  }
});

test('normalisation conserve provenance et fiabilité, et refuse secrets/champs inconnus', () => {
  const valid = {
    id:42,type:'Serveur rack',knowledgeProfile:'server',technicalFacts:[{
      key:'serviceTag',value:'ABC123',verificationStatus:'observed',sourceType:'nameplate',
      sourceLabel:'Plaque arrière',observedAt:'2026-08-14',notes:'Photo à joindre'
    }]
  };
  const normalized = normalizeEquipmentKnowledge(valid);
  assert.deepEqual(normalized.technicalFacts[0],valid.technicalFacts[0]);
  assert.equal(validateEquipmentKnowledge(valid).errors.length,0);

  const secret = validateEquipmentKnowledge({ ...valid,technicalFacts:[{ key:'password',value:'admin123' }] });
  assert.ok(secret.errors.length);
  assert.equal(secret.value.technicalFacts.length,0);
  const disguised = validateEquipmentKnowledge({ ...valid,technicalFacts:[{ key:'supportReference',label:'API token',value:'abc' }] });
  assert.ok(disguised.errors.length);
  const secretInSource = validateEquipmentKnowledge({ ...valid,technicalFacts:[{ key:'supportReference',value:'Contrat standard',sourceLabel:'password admin123' }] });
  assert.ok(secretInSource.errors.length);
});

test('interface, PWA et serveur activent la connaissance d’instance et sa validation', () => {
  const html = read('index.html');
  const worker = read('service-worker.js');
  const ui = read('equipment-smart-knowledge.js');
  const server = read('scripts/serve.js');
  assert.match(html,/equipment-smart-knowledge\.js/);
  assert.match(html,/equipment-smart-knowledge\.css/);
  assert.match(worker,/2mtech-v\d+\.\d+/);
  for (const asset of ['equipment-knowledge-contract.js','equipment-knowledge-packs.js','equipment-smart-knowledge.js','equipment-smart-knowledge.css']) {
    assert.match(worker,new RegExp(asset.replaceAll('.','\\.')));
  }
  assert.match(ui,/Aucun champ vide n’est enregistré/);
  assert.match(ui,/Les caractéristiques constructeur restent liées au catalogue/);
  // L'ensemencement de `EXTRA_EQUIPMENT_CATALOG` appartient à `equipment-knowledge-extra.js`
  // (#165). `equipment-knowledge.js` le posait AUSSI, en double, avec une déduplication
  // plus faible — par identifiant seulement, là où le propriétaire dédoublonne également
  // par clé sémantique constructeur|modèle. Ce qui est vérifié ici reste le même contrat :
  // ce catalogue est bien ensemencé, chez celui qui en a la charge.
  assert.match(read('equipment-knowledge-extra.js'),/for \(const item of EXTRA_EQUIPMENT_CATALOG\)/);
  assert.match(server,/INVALID_EQUIPMENT_KNOWLEDGE/);
  assert.match(server,/validateEquipmentKnowledge/);
});
