import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diagramNodeDisplayLabel } from '../diagram-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Piège H-04 : le studio annonce « Laisser vide pour reprendre le nom officiel », mais
// matérialisait ce nom dans `node.label` au moment du dessin. Renommer ensuite l'entité
// laissait le schéma afficher l'ancien nom indéfiniment.

const node = (overrides = {}) => ({
  id: 'node-1', type: 'entity', layerId: 'main', label: '',
  entityRef: { type: 'equipment', id: 10, label: 'Équipement · VTR-1', verificationStatus: 'documented' },
  ...overrides
});

test('un nœud sans libellé propre suit le nom vivant de l’entité', () => {
  assert.equal(diagramNodeDisplayLabel(node(), 'Équipement · VTR-1'), 'VTR-1');
  assert.equal(diagramNodeDisplayLabel(node(), 'Équipement · VTR-1 RÉNOVÉ'), 'VTR-1 RÉNOVÉ',
    'le schéma doit refléter le renommage, pas le nom du jour du dessin');
});

test('un nœud hérité au nom matérialisé rattrape le nom vivant', () => {
  // Écrit par l'ancien code : `label` recopiait le nom officiel du jour.
  const legacy = node({ label: 'VTR-1' });
  assert.equal(diagramNodeDisplayLabel(legacy, 'Équipement · VTR-1 RÉNOVÉ'), 'VTR-1 RÉNOVÉ');
});

test('un libellé identique à l’instantané préfixé est aussi reconnu comme recopie', () => {
  const legacy = node({ label: 'Équipement · VTR-1' });
  assert.equal(diagramNodeDisplayLabel(legacy, 'Équipement · VTR-1 RÉNOVÉ'), 'VTR-1 RÉNOVÉ');
});

test('un libellé réellement choisi par l’auteur est préservé', () => {
  const authored = node({ label: 'Sortie programme principale' });
  assert.equal(diagramNodeDisplayLabel(authored, 'Équipement · VTR-1 RÉNOVÉ'), 'Sortie programme principale');
});

test('un nom d’entité contenant un séparateur n’est pas tronqué', () => {
  const withSeparator = node({
    label: 'RÉGIE · FINALE',
    entityRef: { type: 'room', id: 3, label: 'Salle · RÉGIE · FINALE' }
  });
  // La recopie doit être reconnue malgré le séparateur présent dans le nom lui-même.
  assert.equal(diagramNodeDisplayLabel(withSeparator, 'Salle · RÉGIE FINALE 2'), 'RÉGIE FINALE 2');
});

test('entité introuvable : repli sur l’instantané, sans le préfixe de type', () => {
  assert.equal(diagramNodeDisplayLabel(node(), ''), 'VTR-1',
    'une entité supprimée doit garder le dernier nom connu plutôt que disparaître');
});

test('un nœud caviardé par le serveur garde son libellé de protection', () => {
  const redacted = { id: 'protected-node-1', type: 'entity', label: 'Dépendance protégée', entityRef: { type: 'equipment', id: null } };
  assert.equal(diagramNodeDisplayLabel(redacted, ''), 'Dépendance protégée');
});

test('dernier recours : l’identifiant du nœud', () => {
  assert.equal(diagramNodeDisplayLabel({ id: 'node-9' }, ''), 'node-9');
});

test('le studio n’affiche plus le libellé brut et ne recopie plus le nom officiel', () => {
  const studio = read('diagram-studio.js');
  assert.match(studio, /nodeLabel\(node\)/, 'le studio doit exposer un résolveur de libellé vivant');
  assert.doesNotMatch(studio, /label:values\.label \|\| entry\.label/,
    'recopier le nom officiel dans le nœud le gelait sur le nom du jour du dessin');
  assert.doesNotMatch(studio, /\$\{esc\(node\.label \|\| node\.id\)\}/,
    'le rendu doit passer par le résolveur, pas par le champ brut');

  const authoring = read('diagram-canonical-authoring.js');
  assert.match(authoring, /studio\.nodeLabel\(node\)/);
  assert.doesNotMatch(authoring, /label\.value = checked\.value\.name/,
    'pré-remplir le champ contredisait « laisser vide pour reprendre le nom officiel »');
});
