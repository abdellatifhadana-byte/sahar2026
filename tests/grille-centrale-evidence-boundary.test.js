/**
 * @file La preuve d'installation de la Grille Centrale, à sa frontière de confiance (#142).
 *
 * `equipment-catalog-extra-seed.js` et `equipment-knowledge-packs.js` affirmaient la capacité
 * de la matrice, son implantation en baie, ses interfaces et ses plages de ports non
 * documentées — depuis deux modules servis à la racine, donc lisibles sans compte.
 *
 * L'ancienne couverture exigeait ces valeurs DANS LA SOURCE PUBLIQUE. Elle n'est pas
 * supprimée : elle est répartie sur les trois frontières où elle veut dire quelque chose.
 *
 *   · source publique      → la valeur est ABSENTE ;
 *   · runtime autorisé     → l'utilisateur habilité la reçoit, entière ;
 *   · runtime non autorisé → l'anonyme n'en reçoit rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXTRA_EQUIPMENT_CATALOG } from '../equipment-catalog-extra-seed.js';
import { DEVICE_KNOWLEDGE_PACKS, resolveKnowledgePack, enrichCatalogKnowledge } from '../equipment-knowledge-packs.js';
import { buildGrilleCentraleKnowledgeSeed } from '../scripts/private-operational-data/grille-centrale.js';
import {
  buildProtectedFingerprints,
  findOperationalResiduesInSource
} from '../scripts/public-bundle-residue-guard.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const CATALOG_ID = 'kb-grille-centrale-190x184';
const RELATED_ID = 'kb-imagine-platinum-vx';
const fingerprints = buildProtectedFingerprints(read('scripts/private-operational-data/grille-centrale.js'));
const seed = buildGrilleCentraleKnowledgeSeed();

/* ── FRONTIÈRE 1 — LA SOURCE PUBLIQUE EST MUETTE ─────────────────────────── */

test('source publique: les deux modules ne portent plus aucune valeur d’installation', () => {
  for (const file of ['equipment-catalog-extra-seed.js', 'equipment-knowledge-packs.js']) {
    assert.deepEqual(findOperationalResiduesInSource(file, read(file), fingerprints), [],
      `${file} porte encore une donnée opérationnelle protégée.`);
  }
});

test('source publique: la fiche catalogue ne décrit ni capacité, ni baie, ni plage, ni zone', () => {
  const central = EXTRA_EQUIPMENT_CATALOG.find(item => item.id === CATALOG_ID);
  assert.ok(central, 'La fiche générique doit rester présente.');
  // L'identifiant canonique reste : des entityRefs persistés en dépendent (#137).
  assert.equal(central.id, CATALOG_ID);
  assert.equal(central.manufacturer, 'À identifier');
  for (const field of ['portsNote', 'inventoryEvidence']) {
    assert.equal(central[field], undefined, `« ${field} » portait une donnée d'installation.`);
  }
  /*
   * Les identifiants canoniques sont retirés avant de sonder — même décision que
   * `scripts/bundle-leak-e2e.mjs` (#137) : `kb-grille-centrale-190x184` porte la capacité,
   * et il RESTE, parce que des entityRefs déjà écrits en base s'y réfèrent. Ce qui doit
   * disparaître, c'est la phrase qui explique l'installation, pas la clé qui la désigne.
   */
  const texte = JSON.stringify(central).replace(/[a-z]+-[a-z-]*190x18[40]/g, '');
  for (const motif of [/190/, /184/, /BAIE\s*3/i, /IN\.\d+[–—-]/, /\bSTC\b/]) {
    assert.doesNotMatch(texte, motif, `La fiche publique contient encore ${motif}.`);
  }
});

test('source publique: le pack de connaissance ne porte aucune preuve projet', () => {
  for (const id of [CATALOG_ID, RELATED_ID]) {
    const pack = DEVICE_KNOWLEDGE_PACKS[id];
    assert.ok(pack, `${id} doit garder son pack générique.`);
    assert.equal(pack.projectEvidence, undefined, `${id} publie encore une preuve projet.`);
  }
  // Le profil et les faits CONSTRUCTEUR restent publics : ils viennent des datasheets.
  assert.equal(DEVICE_KNOWLEDGE_PACKS[CATALOG_ID].profile, 'router-matrix');
  assert.ok(DEVICE_KNOWLEDGE_PACKS[RELATED_ID].facts.length >= 1);
});

test('source publique: aucune preuve de projet 2M ne subsiste dans les packs', () => {
  const packs = read('equipment-knowledge-packs.js');
  /*
   * `kb-axon-sfr08` affirmait le nombre de châssis, le site et les zones, en citant un
   * document interne. La preuve n'est pas déplacée derrière la porte de la Grille : cette
   * porte décide sur l'ÉQUIPEMENT Grille Centrale, et ces châssis relèvent d'autres zones.
   * Elle est retirée ; la connaissance constructeur reste entière.
   */
  assert.doesNotMatch(packs, /MAROCMETRIE/);
  assert.doesNotMatch(packs, /RF1\/RF2/);
  assert.doesNotMatch(packs, /Dataset Master v\d/);
  const axon = DEVICE_KNOWLEDGE_PACKS['kb-axon-sfr08'];
  assert.ok(axon, 'La fiche Axon doit rester présente.');
  assert.equal(axon.projectEvidence, undefined);
  // La connaissance CONSTRUCTEUR et la liste d'identification restent publiques.
  assert.ok(axon.facts.length >= 3);
  assert.match(axon.identificationChecklist.join(' '), /Synapse/);
});

/* ── FRONTIÈRE 2 — LE RUNTIME AUTORISÉ REÇOIT TOUT ───────────────────────── */

test('runtime autorisé: la fiche hydratée rend la capacité, la baie, les interfaces et les plages', () => {
  // Ce que l'endpoint protégé renvoie, tel que `grille-centrale-knowledge.js` l'applique.
  const hydratee = {
    id:CATALOG_ID,
    ...seed.catalogSeed,
    projectEvidence:seed.projectEvidence,
    identificationChecklist:seed.identificationChecklist
  };
  const pack = resolveKnowledgePack(hydratee);
  const evidence = pack.projectEvidence.map(item => item.value).join(' ');

  assert.match(evidence, /190 entrées SDI × 184 sorties SDI/);
  assert.match(evidence, /BAIE 3 GRILLE CENTRALE/);
  assert.match(evidence, /SYNCH 1/);
  assert.match(evidence, /XY-1/);
  assert.match(evidence, /MONITORING\/OUT\.1/);
  assert.match(pack.identificationChecklist.join(' '), /IN\.64–181/);
  assert.match(hydratee.summary, /190 entrées SDI × 184 sorties SDI/);
  assert.match(hydratee.portsNote, /OUT\.145–182/);
  assert.equal(hydratee.inventoryEvidence.zones, 'STC');
  // La source de la preuve reste nommée : sans elle, l'affirmation ne vaut rien.
  assert.match(pack.projectEvidence[0].sourceLabel, /Dataset Master v5/);
});

test('runtime autorisé: la fiche liée retrouve sa preuve d’implantation', () => {
  const evidence = seed.relatedCatalogEvidence?.[RELATED_ID];
  assert.ok(Array.isArray(evidence) && evidence.length, 'La preuve liée doit voyager avec le jeu de données.');
  const pack = resolveKnowledgePack({ id:RELATED_ID, projectEvidence:evidence });
  assert.match(pack.projectEvidence.map(item => item.value).join(' '), /72×72/);
  assert.match(pack.projectEvidence.map(item => item.value).join(' '), /190×184/);
});

test('runtime autorisé: les preuves terrain propres à la Grille reviennent sur leurs fiches', () => {
  const patches = seed.fieldEvidencePatches;
  assert.ok(patches, 'Les preuves terrain doivent voyager avec le jeu de données autorisé.');
  const grille = patches[CATALOG_ID];
  assert.match(grille.inventoryAliases.join(' '), /190x184/);
  assert.equal(grille.fieldEvidenceImages.length, 5);
  assert.match(grille.fieldEvidenceImages.map(item => item.zone).join(' '), /BAIE GR-1/);
  assert.match(grille.fieldEvidenceImages.map(item => item.zone).join(' '), /BAIE 3 GRILLE CENTRALE/);
  // Les fiches voisines gardent leur preuve d'implantation Grille, elle aussi autorisée.
  assert.match(patches['kb-sonifex-rb-ds2'].fieldEvidenceImages[0].zone, /BAIE GR-1/);
  assert.match(patches['kb-tektronix-eco422d'].fieldEvidenceImages[0].zone, /BAIE GR-3/);
});

test('source publique: le module de preuves terrain ne décrit plus la Grille', () => {
  const field = read('equipment-field-evidence.js');
  assert.deepEqual(findOperationalResiduesInSource('equipment-field-evidence.js', field, fingerprints), []);
  assert.doesNotMatch(field, /GRILLE CENTRALE 190x184/);
  assert.doesNotMatch(field, /BAIE GR-[123]/);
  assert.doesNotMatch(field, /BAIE 3 GRILLE CENTRALE/);
  // Le sous-système de preuves terrain, lui, reste en place : c'est #78, pas #142.
  assert.match(field, /FIELD_EVIDENCE_PACK_URL/);
  assert.match(field, /resolveFieldEvidenceAsset/);
  // Et la connaissance CONSTRUCTEUR des appareils voisins reste publique.
  assert.match(field, /Sonifex/);
  assert.match(field, /RB-DS2/);
});

/* ── FRONTIÈRE 3 — LE RUNTIME NON AUTORISÉ N’A RIEN ──────────────────────── */

test('runtime non autorisé: une fiche non hydratée ne rend aucune preuve opérationnelle', () => {
  const publique = EXTRA_EQUIPMENT_CATALOG.find(item => item.id === CATALOG_ID);
  const pack = resolveKnowledgePack(publique);
  assert.deepEqual(pack.projectEvidence, [], 'Un client sans autorisation ne doit recevoir aucune preuve.');
  // La liste d'identification retombe sur le gabarit générique du profil, sans les plages.
  assert.doesNotMatch(pack.identificationChecklist.join(' '), /IN\.64|OUT\.145/);
  const enrichie = enrichCatalogKnowledge(publique);
  assert.deepEqual(enrichie.projectEvidence, []);
  assert.doesNotMatch(JSON.stringify(enrichie), /190 entrées|BAIE 3 GRILLE CENTRALE/);
});

test('runtime non autorisé: la fiche liée reste muette elle aussi', () => {
  assert.deepEqual(resolveKnowledgePack({ id:RELATED_ID }).projectEvidence, []);
});

test('le refus ne se contourne pas par une preuve vide ou mal formée', () => {
  for (const bancal of [{ projectEvidence:[] }, { projectEvidence:null }, { projectEvidence:'190 entrées' }]) {
    const pack = resolveKnowledgePack({ id:CATALOG_ID, ...bancal });
    assert.deepEqual(pack.projectEvidence, [], 'Seule une liste non vide hydrate la fiche.');
  }
});
