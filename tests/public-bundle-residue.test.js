import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  buildProtectedFingerprints,
  extractStringLiterals,
  findOperationalResiduesInSource,
  scanPublicBundle
} from '../scripts/public-bundle-residue-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateSource = readFileSync(join(root, 'scripts/private-operational-data/grille-centrale.js'), 'utf8');
const fingerprints = buildProtectedFingerprints(privateSource);

function sample(set, count) {
  const values = [...set].slice(0, count);
  assert.equal(values.length, count, `Le dataset privé doit fournir au moins ${count} empreintes de test.`);
  return values;
}

test('la garde détecte une paire de repères réels même renommée dans un petit tableau', () => {
  const refs = sample(fingerprints.cableRefs, 2);
  const source = `const observations = ${JSON.stringify(refs)}; export default observations;`;
  const issues = findOperationalResiduesInSource('mutation-small-array.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('repère opérationnel protégé')));
});

test('la garde détecte quatre repères réels sous un autre nom', () => {
  const refs = sample(fingerprints.cableRefs, 4);
  const source = `const mesuresTerrain = ${JSON.stringify(refs)};`;
  const issues = findOperationalResiduesInSource('mutation-renamed.js', source, fingerprints);
  assert.ok(issues.length >= 1);
});

test('la garde détecte un dataset long non frozen sans dépendre de Object.freeze', () => {
  const labels = sample(fingerprints.labels, 12);
  const source = `const data = ${JSON.stringify(labels)};`;
  const issues = findOperationalResiduesInSource('mutation-non-frozen.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('libellés opérationnels privés')));
});

test('les exemples génériques et fictifs restent autorisés', () => {
  const source = `
    const refs = ['REF-001', 'REF-002'];
    const zones = ['Zone A', 'Zone B'];
    const placeholders = ['BAIE A / repère', 'MONITORING/OUT.X'];
  `;
  assert.deepEqual(findOperationalResiduesInSource('generic-ui.js', source, fingerprints), []);
});

/* ── LES FORMES NARRATIVES ET OBJET (#142, second tour) ──────────────────────
 *
 * Les tableaux étaient partis ; la même donnée est restée en phrases dans les fiches
 * catalogue pendant tout #137. Ces mutations couvrent la forme, pas le vocabulaire.
 * ──────────────────────────────────────────────────────────────────────────── */

test('la garde détecte la capacité protégée racontée en toutes lettres', () => {
  const source = `const s = 'Grille matricielle documentée avec 190 entrées SDI × 184 sorties SDI.';`;
  const issues = findOperationalResiduesInSource('mutation-prose.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('racontée en clair')));
});

test('la garde détecte l’implantation réelle sous n’importe quel nom de champ', () => {
  for (const champ of ['sourceLabel', 'sourceNote', 'libelle', 'x']) {
    const source = `const o = { ${champ}:'Plan BAIE 3 GRILLE CENTRALE — Dataset Master v5' };`;
    const issues = findOperationalResiduesInSource('mutation-objet.js', source, fingerprints);
    assert.ok(issues.some(issue => issue.includes('implantation réelle')), `champ ${champ} non couvert`);
  }
});

test('la garde détecte une grappe d’interfaces opérationnelles', () => {
  const source = `const s = 'SYNCH 1–4, XY-1/2, ENET-1/2, SERIAL 1/2, MONITORING/OUT.1';`;
  const issues = findOperationalResiduesInSource('mutation-interfaces.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes("grappe d'interfaces")));
});

test('la garde détecte une plage de ports documentée', () => {
  const source = `const s = 'Ports IN.64–181 et OUT.145–182 non visibles dans les documents';`;
  const issues = findOperationalResiduesInSource('mutation-plages.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('plage de ports')));
});

test('la garde laisse passer la documentation constructeur légitime', () => {
  const source = `
    const gamme = ['16×16 à 288×288', '36×36 / 72×72 / 160×160 / 288×288', 'Ex. 72 × 72'];
    const resolutions = ['1920x1080', '1280x720', '3840x2160'];
    const ports = ['IN.1', 'OUT.2', 'SERIAL', 'Synchronisation interne'];
    const ids = ['router-gc190x184', 'kb-grille-centrale-190x184'];
  `;
  assert.deepEqual(findOperationalResiduesInSource('datasheet.js', source, fingerprints), []);
});

test('les empreintes de capacité ne retiennent que la matrice de l’installation', () => {
  // Le dataset privé CITE des gammes constructeur (16×16, 288×288) : les prendre pour
  // empreintes faisait rejeter des fiches produit légitimes.
  assert.ok(fingerprints.capacityPairs.has('190x184'));
  for (const gamme of ['16x16', '72x72', '288x288', '256x256']) {
    assert.ok(!fingerprints.capacityPairs.has(gamme), `${gamme} est une capacité constructeur, pas une empreinte.`);
  }
});

test('l’extraction de littéraux ne déraille pas sur une expression régulière (#142)', () => {
  /*
   * `/[&<>"']/g` contient un guillemet. L'ancienne extraction par expression régulière y
   * ouvrait une chaîne fantôme qui avalait ensuite des milliers d'octets de code — d'où deux
   * faux positifs sur des fichiers propres, mais SURTOUT : toute vraie chaîne située après ce
   * point cessait d'être émise comme littéral, et échappait donc aux règles de la garde.
   */
  const source = `const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;'}[c]));
    const apres = 'Implantation BAIE 3 GRILLE CENTRALE';`;
  const literals = extractStringLiterals(source);
  assert.ok(literals.includes('Implantation BAIE 3 GRILLE CENTRALE'),
    'la chaîne située après une expression régulière doit rester un littéral distinct');
  const issues = findOperationalResiduesInSource('desync.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('implantation réelle')),
    'un résidu placé après une expression régulière doit rester détecté');
});

test('la garde détecte une preuve terrain d’implantation Grille (#142)', () => {
  // La forme exacte qui vivait dans `equipment-field-evidence.js`, jamais inspectée.
  const source = `const p = [{ id:'kb-x', inventoryAliases:['GRILLE CENTRALE 190x184'],
    fieldEvidenceImages:[{ caption:'BAIE GR-1 — patch E.VIDEO-SD.', zone:'BAIE GR-1' }] }];`;
  const issues = findOperationalResiduesInSource('equipment-field-evidence.js', source, fingerprints);
  assert.ok(issues.some(issue => issue.includes('implantation réelle')));
  assert.ok(issues.some(issue => issue.includes("capacité d'installation")));
});

/* ── LA PREUVE DE PROJET ET LES COMMENTAIRES (#142, troisième tour) ──────────
 *
 * Deux classes que la garde ne voyait pas : une preuve de projet — implantation réelle
 * attribuée à un document interne — et TOUT ce qui vit dans un commentaire, puisque la garde
 * commençait par `stripComments()`.
 * ──────────────────────────────────────────────────────────────────────────── */

test('la garde détecte une preuve de projet interne, quel que soit le nom du champ', () => {
  const nominal = `const p = { scope:'project', sourceLabel:'Dataset Master v5',
    value:'4 châssis MAROCMETRIE RF1/RF2 principal et secours' };`;
  const nominalIssues = findOperationalResiduesInSource('packs.js', nominal, fingerprints);
  assert.ok(nominalIssues.some(issue => issue.includes('source de projet interne')));
  assert.ok(nominalIssues.some(issue => issue.includes('implantation de projet')));

  // Les MÊMES valeurs sous d'autres noms de champ : le renommage ne doit rien changer.
  const renomme = `const p = { provenance:'Dataset Master v5',
    note:'4 châssis MAROCMETRIE RF1/RF2 principal et secours' };`;
  const renommeIssues = findOperationalResiduesInSource('packs.js', renomme, fingerprints);
  assert.ok(renommeIssues.some(issue => issue.includes('source de projet interne')));
  assert.ok(renommeIssues.some(issue => issue.includes('implantation de projet')));
});

test('la documentation constructeur légitime n’est pas prise pour une preuve de projet', () => {
  const source = `
    const f = { scope:'manufacturer', sourceLabel:'Documentation officielle constructeur',
      sourceUrl:'https://www.rossvideo.com/products/', value:'Châssis Synapse 2RU à 8 slots' };
    const g = { value:'16×16 à 288×288 selon châssis', sourceUrl:'https://imaginecommunications.com/' };
    const ui = ['Consulter les plans et synoptiques techniques', 'Synoptique signal', 'Le synoptique doit avoir un titre.'];
  `;
  assert.deepEqual(findOperationalResiduesInSource('datasheet.js', source, fingerprints), []);
});

test('la garde lit les commentaires : ils sont servis comme le code', () => {
  const repere = [...fingerprints.cableRefs][0];
  const cas = [
    [`// câble ${repere} vers la baie`, 'repère opérationnel protégé'],
    [`/* implantation BAIE GR-1 */`, 'implantation réelle'],
    ['// la matrice fait 190 entrées et 184 sorties', "capacité d'installation"],
    ['/* SYNCH 1 · XY-1 · ENET-1 */', "grappe d'interfaces"]
  ];
  for (const [source, attendu] of cas) {
    const issues = findOperationalResiduesInSource('commente.js', source, fingerprints);
    assert.ok(issues.some(issue => issue.includes(attendu)),
      `commentaire non couvert : ${source}`);
    assert.ok(issues.some(issue => issue.includes('commentaire servi')),
      `la cause doit nommer le commentaire : ${source}`);
  }
});

test('un commentaire d’ingénierie ordinaire n’est pas un résidu', () => {
  const source = `
    // Ce module normalise les identifiants avant sauvegarde.
    /* Deux passes : lecture puis écriture, pour éviter une transaction longue. */
    const lien = 'https://example.com/docs';
  `;
  assert.deepEqual(findOperationalResiduesInSource('propre.js', source, fingerprints), []);
});

test('le graphe public courant ne contient aucun résidu couvert par la garde #142', async () => {
  const issues = await scanPublicBundle(root);
  assert.deepEqual(issues, [], issues.join('\n'));
});
