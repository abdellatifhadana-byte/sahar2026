/**
 * @file cable-endpoints-p0f.test.js — TROIS DÉFAUTS CONFIRMÉS, TROIS VÉRITÉS RENDUES.
 *
 * Ce que ces tests défendent, dans l'ordre où l'utilisateur les rencontre :
 *
 *   1 · Une extrémité que le serveur a DÉLIBÉRÉMENT retirée ne doit pas être annoncée
 *       comme « introuvable ». « Introuvable » dit : cette donnée n'existe pas. Or elle
 *       existe, elle est simplement hors du périmètre du lecteur. Faire dire à l'écran le
 *       contraire de la vérité pousse un exploitant à recréer un câble qui existe déjà.
 *
 *   2 · Un `componentId` n'est unique que DANS son équipement parent. Résolu seul, il peut
 *       désigner la carte d'un AUTRE châssis. Montrer le mauvais appareil est pire que
 *       n'en montrer aucun : l'un fait chercher, l'autre fait débrancher.
 *
 *   3 · Un câble branché sur une carte interne est branché sur l'appareil. La Fiche360
 *       l'omettait et affirmait « Aucun câble relié » d'un équipement câblé.
 *
 * Les tests de contrat sont EXÉCUTÉS (le contrat est pur) ; les tests de câblage lisent la
 * source, parce qu'un contrat juste mais non appelé ne corrige rien à l'écran.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ENDPOINT_STATES,
  PROTECTED_ENDPOINT_LABEL,
  MISSING_ENDPOINT_LABEL,
  endpointIdentity,
  findComponent,
  resolveCableEndpoint,
  endpointBelongsToEquipment,
  cableTouchesEquipment,
  cablesForEquipment
} from '../cable-endpoint-contract.js';
import { normalizeCableRecord } from '../connectivity-contract.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = nom => readFileSync(join(racine, nom), 'utf8');

/* Deux châssis qui portent CHACUN un composant nommé « slot-1 ». C'est le cas réel : un
 * identifiant de slot est choisi dans l'équipement, pas dans la plateforme. */
const EQUIPEMENTS = [
  { id: 'EQ-A', name: 'Châssis A', roomId: 'R1', ports: [{ id: 'p-a1', number: 'OUT 1', type: 'BNC / SDI' }] },
  { id: 'EQ-B', name: 'Châssis B', roomId: 'R2', ports: [{ id: 'p-b1', number: 'IN 1', type: 'BNC / SDI' }] },
  { id: 'EQ-C', name: 'Routeur C', roomId: 'R1', ports: [{ id: 'p-c1', number: 'OUT 9', type: 'BNC / SDI' }] }
];
const COMPOSANTS = [
  { id: 'slot-1', name: 'Carte entrée', parentEquipmentId: 'EQ-A', parentEquipmentName: 'Châssis A', ports: [{ id: 'cp-a', number: 'IN A', type: 'BNC / SDI' }] },
  { id: 'slot-1', name: 'Carte sortie', parentEquipmentId: 'EQ-B', parentEquipmentName: 'Châssis B', ports: [{ id: 'cp-b', number: 'OUT B', type: 'BNC / SDI' }] },
  { id: 'slot-unique', name: 'Carte isolée', parentEquipmentId: 'EQ-C', parentEquipmentName: 'Routeur C', ports: [] }
];
const ECRANS = [{ id: 'SCR-1', name: 'Écran régie', ports: [{ id: 'sp-1', number: 'IN 1', type: 'HDMI' }] }];
const CONTEXTE = { equipments: EQUIPEMENTS, screens: ECRANS, components: COMPOSANTS };

/* Ce que le serveur laisse réellement passer pour une extrémité hors périmètre :
 * `{side}Id`, `{side}EquipmentId`, `{side}ScreenId`, `{side}ComponentId`,
 * `{side}ParentEquipmentId` et `{side}PortId` sont SUPPRIMÉS, et un marqueur est posé. */
const cableAvecBoutProtege = () => ({
  id: 'CAB-P', reference: 'CAB-2026-P',
  sourceType: 'equipment', sourceId: 'EQ-A', sourcePortId: 'p-a1',
  destinationType: 'equipment',
  destinationProtected: { relation: 'external-protected', zone: { id: 'Z9', name: 'Zone Sécurisée' }, publicStatus: 'dependency-present', direction: 'in' }
});

/* ------------------------------------------------------------------ *
 * DÉFAUT 1 — « protégé » n'est pas « introuvable »
 * ------------------------------------------------------------------ */

test('défaut 1 : une extrémité protégée est PROTÉGÉE, pas introuvable', () => {
  const bout = resolveCableEndpoint(cableAvecBoutProtege(), 'destination', CONTEXTE);
  assert.equal(bout.state, 'protected');
  assert.notEqual(bout.state, 'missing');
  assert.ok(bout.label.startsWith(PROTECTED_ENDPOINT_LABEL),
    `libellé attendu commençant par « ${PROTECTED_ENDPOINT_LABEL} », reçu « ${bout.label} »`);
  assert.ok(!bout.label.includes(MISSING_ENDPOINT_LABEL),
    'le message « introuvable » affirme que la donnée n\'existe pas : c\'est faux ici');
});

test('défaut 1 : les deux états restent DISTINCTS — un bout vraiment absent dit « introuvable »', () => {
  const disparu = { sourceType: 'equipment', sourceId: 'EQ-SUPPRIME' };
  const bout = resolveCableEndpoint(disparu, 'source', CONTEXTE);
  assert.equal(bout.state, 'missing');
  assert.equal(bout.label, MISSING_ENDPOINT_LABEL);
  // Corriger le défaut 1 en renommant TOUT en « protégé » aurait fabriqué le mensonge
  // inverse : les trois états existent et doivent rester séparés.
  assert.deepEqual([...ENDPOINT_STATES], ['resolved', 'protected', 'missing']);
});

test('défaut 1 : la protection se lit AVANT la résolution — même si l\'identifiant a fuité', () => {
  // Un cache client ancien peut encore porter l'identifiant à côté du marqueur. Résoudre
  // d'abord le nommerait quand même : la protection doit gagner.
  const cable = { ...cableAvecBoutProtege(), destinationId: 'EQ-B' };
  const bout = resolveCableEndpoint(cable, 'destination', CONTEXTE);
  assert.equal(bout.state, 'protected');
  assert.equal(bout.entity, null);
  assert.ok(!bout.label.includes('Châssis B'), 'le nom privé de l\'entité protégée ne doit jamais sortir');
});

test('défaut 1 : rien ne sort d\'un bout protégé, sauf le nom de zone déjà public', () => {
  const bout = resolveCableEndpoint(cableAvecBoutProtege(), 'destination', CONTEXTE);
  assert.equal(bout.entity, null);
  assert.equal(bout.port, null);
  const rendu = JSON.stringify(bout);
  for (const secret of ['EQ-B', 'Châssis B', 'p-b1', 'cp-b', 'slot-1']) {
    assert.ok(!rendu.includes(secret), `fuite : « ${secret} » apparaît dans l'extrémité protégée`);
  }
  assert.ok(bout.label.includes('Zone Sécurisée'), 'le nom de zone est public et aide à demander l\'accès');
});

test('défaut 1 : sans nom de zone public, le libellé reste neutre', () => {
  const cable = { destinationType: 'equipment', destinationProtected: { relation: 'external-protected', publicStatus: 'dependency-present' } };
  assert.equal(resolveCableEndpoint(cable, 'destination', CONTEXTE).label, PROTECTED_ENDPOINT_LABEL);
});

test('défaut 1 : l\'identité déclarée ne RECONSTRUIT jamais ce que le serveur a retiré', () => {
  const identite = endpointIdentity(cableAvecBoutProtege(), 'destination');
  assert.equal(identite.id, null);
  assert.equal(identite.portId, null);
  assert.equal(identite.parentEquipmentId, null);
  assert.ok(identite.protege, 'le marqueur de protection doit être porté tel quel');
});

/* ------------------------------------------------------------------ *
 * DÉFAUT 2 — le composant se résout sur son identité COMPOSÉE
 * ------------------------------------------------------------------ */

test('défaut 2 : deux « slot-1 » homonymes — le parent déclaré tranche', () => {
  const versB = { destinationType: 'component', destinationId: 'slot-1', destinationParentEquipmentId: 'EQ-B', destinationPortId: 'cp-b' };
  const bout = resolveCableEndpoint(versB, 'destination', CONTEXTE);
  assert.equal(bout.state, 'resolved');
  assert.equal(bout.entity.parentEquipmentId, 'EQ-B');
  assert.equal(bout.entity.name, 'Carte sortie');
  assert.ok(bout.label.includes('Châssis B'), `l'appareil nommé doit être le bon, reçu « ${bout.label} »`);
  assert.ok(!bout.label.includes('Châssis A'), 'montrer le mauvais appareil est pire que n\'en montrer aucun');
});

test('défaut 2 : l\'autre côté du même homonyme désigne l\'AUTRE châssis', () => {
  const versA = { sourceType: 'component', sourceId: 'slot-1', sourceParentEquipmentId: 'EQ-A', sourcePortId: 'cp-a' };
  const bout = resolveCableEndpoint(versA, 'source', CONTEXTE);
  assert.equal(bout.entity.parentEquipmentId, 'EQ-A');
  assert.equal(bout.port.number, 'IN A', 'le port lu doit être celui du composant retenu');
});

test('défaut 2 : sans parent déclaré, un identifiant AMBIGU ne désigne personne', () => {
  assert.equal(findComponent(COMPOSANTS, { componentId: 'slot-1' }), null);
  const ancien = { sourceType: 'component', sourceId: 'slot-1' };
  assert.equal(resolveCableEndpoint(ancien, 'source', CONTEXTE).state, 'missing');
});

test('défaut 2 : sans parent déclaré, un identifiant UNIQUE reste lisible (donnée héritée)', () => {
  const ancien = { sourceType: 'component', sourceId: 'slot-unique' };
  const bout = resolveCableEndpoint(ancien, 'source', CONTEXTE);
  assert.equal(bout.state, 'resolved');
  assert.equal(bout.entity.parentEquipmentId, 'EQ-C');
});

test('défaut 2 : un parent déclaré qui ne porte pas ce composant ne retombe pas sur un homonyme', () => {
  const faux = { sourceType: 'component', sourceId: 'slot-1', sourceParentEquipmentId: 'EQ-C' };
  assert.equal(resolveCableEndpoint(faux, 'source', CONTEXTE).state, 'missing');
});

test('défaut 2 : un équipement et un écran gardent leur résolution simple', () => {
  assert.equal(resolveCableEndpoint({ sourceType: 'equipment', sourceId: 'EQ-A' }, 'source', CONTEXTE).entity.name, 'Châssis A');
  assert.equal(resolveCableEndpoint({ sourceType: 'screen', sourceId: 'SCR-1' }, 'source', CONTEXTE).label, 'Écran · Écran régie');
});

/* ------------------------------------------------------------------ *
 * DÉFAUT 3 — la fiche d'un appareil compte AUSSI les câbles de ses cartes
 * ------------------------------------------------------------------ */

const CABLES = [
  { id: 'C1', sourceType: 'equipment', sourceId: 'EQ-A', destinationType: 'equipment', destinationId: 'EQ-C' },
  { id: 'C2', sourceType: 'equipment', sourceId: 'EQ-C', destinationType: 'equipment', destinationId: 'EQ-A' },
  { id: 'C3', sourceType: 'component', sourceId: 'slot-1', sourceParentEquipmentId: 'EQ-A', destinationType: 'screen', destinationId: 'SCR-1' },
  { id: 'C4', sourceType: 'screen', sourceId: 'SCR-1', destinationType: 'component', destinationId: 'slot-1', destinationParentEquipmentId: 'EQ-A' },
  { id: 'C5', sourceType: 'component', sourceId: 'slot-1', sourceParentEquipmentId: 'EQ-B', destinationType: 'equipment', destinationId: 'EQ-C' },
  { id: 'C6', sourceType: 'equipment', sourceId: 'EQ-A', destinationType: 'component', destinationId: 'slot-1', destinationParentEquipmentId: 'EQ-A' }
];

test('défaut 3 : la fiche d\'un appareil contient les câbles de ses CARTES INTERNES', () => {
  const trouves = cablesForEquipment(CABLES, 'EQ-A', { components: COMPOSANTS }).map(cable => cable.id);
  assert.deepEqual(trouves, ['C1', 'C2', 'C3', 'C4', 'C6']);
});

test('défaut 3 : les DEUX sens comptent — source comme destination', () => {
  assert.ok(cableTouchesEquipment(CABLES[2], 'EQ-A'), 'câble partant d\'une carte de EQ-A');
  assert.ok(cableTouchesEquipment(CABLES[3], 'EQ-A'), 'câble arrivant sur une carte de EQ-A');
});

test('défaut 3 : un câble dont les DEUX bouts sont à nous n\'apparaît qu\'une fois', () => {
  const trouves = cablesForEquipment(CABLES, 'EQ-A', { components: COMPOSANTS });
  assert.equal(trouves.filter(cable => cable.id === 'C6').length, 1);
  assert.equal(new Set(trouves.map(cable => cable.id)).size, trouves.length);
});

test('défaut 3 : la carte HOMONYME d\'un autre châssis n\'entre pas dans notre fiche', () => {
  const trouves = cablesForEquipment(CABLES, 'EQ-A', { components: COMPOSANTS }).map(cable => cable.id);
  assert.ok(!trouves.includes('C5'), 'C5 est branché sur slot-1 de EQ-B, pas de EQ-A');
});

test('défaut 3 : une extrémité PROTÉGÉE n\'est jamais comptée comme nôtre', () => {
  // Si elle l'était, le serveur ne l'aurait pas retirée : il ne protège que le hors-périmètre.
  assert.equal(endpointBelongsToEquipment(cableAvecBoutProtege(), 'destination', 'EQ-B'), false);
  assert.equal(cablesForEquipment([cableAvecBoutProtege()], 'EQ-B').length, 0);
});

test('défaut 3 : sans identifiant d\'équipement, on ne rattache rien « par défaut »', () => {
  assert.equal(cableTouchesEquipment(CABLES[0], null), false);
  assert.equal(cableTouchesEquipment(CABLES[0], undefined), false);
  assert.equal(cablesForEquipment(CABLES, '').length, 0);
});

test('défaut 3 : un composant hérité sans parent se rattache à son propriétaire UNIQUE', () => {
  const herite = { id: 'C7', sourceType: 'component', sourceId: 'slot-unique', destinationType: 'equipment', destinationId: 'EQ-A' };
  assert.ok(cableTouchesEquipment(herite, 'EQ-C', { components: COMPOSANTS }), 'slot-unique n\'existe que sous EQ-C');
  assert.equal(cableTouchesEquipment(herite, 'EQ-B', { components: COMPOSANTS }), false);
});

/* ------------------------------------------------------------------ *
 * LE CÂBLAGE — un contrat juste mais non appelé ne corrige rien à l'écran
 * ------------------------------------------------------------------ */

test('câblage : les trois écrans de câbles passent par le contrat d\'extrémité', () => {
  for (const fichier of ['broadcast-relations.js', 'component-relations.js', 'operations-suite.js']) {
    assert.match(source(fichier), /from '\.\/cable-endpoint-contract\.js'/,
      `${fichier} doit résoudre ses extrémités par le contrat`);
  }
});

test('câblage : plus aucun écran ne fabrique « Élément introuvable » à la main', () => {
  for (const fichier of ['broadcast-relations.js', 'component-relations.js', 'operations-suite.js']) {
    const code = source(fichier).split('\n')
      .filter(ligne => !/^\s*(\*|\/\*|\/\/)/.test(ligne))   // les commentaires citent le défaut
      .join('\n');
    assert.ok(!code.includes('Élément introuvable'),
      `${fichier} reconstruit encore le message « introuvable » hors du contrat`);
  }
});

test('câblage : la Fiche360 ne filtre plus les câbles sur le seul `sourceType`', () => {
  const code = source('operations-suite.js');
  assert.match(code, /cablesForEquipment\(\s*normalizedCables,\s*equipment\.id/,
    'la Fiche360 doit demander SES câbles au contrat');
  assert.ok(!/relatedCables\s*=\s*normalizedCables\.filter/.test(code),
    'l\'ancien filtre incomplet ne doit plus décider du contenu de la fiche');
});

test('câblage : la Fiche360 n\'affiche plus un identifiant de port brut', () => {
  const code = source('operations-suite.js');
  assert.ok(!code.includes("cable.sourcePortId || 'Port source'"),
    'un identifiant interne de port n\'est pas un libellé');
});

test('câblage : la table des câbles nomme ses extrémités par le câble, pas par un couple type/id', () => {
  const code = source('broadcast-relations.js');
  assert.match(code, /endpointLabel\(cable, 'source', equipments, screens, components\)/);
  assert.match(code, /endpointLabel\(cable, 'destination', equipments, screens, components\)/);
  assert.ok(!/endpointLabel\(cable\.sourceType/.test(code), 'signature ancienne encore appelée');
});

/* ------------------------------------------------------------------ *
 * F1-GAP-1 — UNE SEULE RÈGLE D'IDENTITÉ POUR L'AFFICHAGE ET POUR L'APPARTENANCE
 *
 * `findComponent` refusait déjà d'attribuer un `componentId` ambigu ; l'appartenance, elle,
 * se contentait des identifiants de composants de l'appareil COURANT. Le même câble hérité
 * appartenait donc à EQ-A ET à EQ-B, tout en s'affichant « Extrémité introuvable » : deux
 * réponses contradictoires à une seule question d'identité.
 * ------------------------------------------------------------------ */

const CABLE_HERITE_AMBIGU = Object.freeze({
  id: 'C-LEG', reference: 'CAB-LEGACY',
  sourceType: 'component', sourceId: 'slot-1',   // aucun parent déclaré
  destinationType: 'equipment', destinationId: 'EQ-C'
});

test('gap 1 : un composant hérité AMBIGU n\'appartient à AUCUN des deux châssis', () => {
  for (const proprietaire of ['EQ-A', 'EQ-B']) {
    assert.equal(
      cablesForEquipment([CABLE_HERITE_AMBIGU], proprietaire, { components: COMPOSANTS }).length, 0,
      `${proprietaire} revendique un câble dont l'identité est ambiguë`);
  }
});

test('gap 1 : l\'appartenance rend EXACTEMENT la réponse de la résolution', () => {
  assert.equal(resolveCableEndpoint(CABLE_HERITE_AMBIGU, 'source', CONTEXTE).state, 'missing');
  assert.equal(findComponent(COMPOSANTS, { componentId: 'slot-1' }), null);
  for (const proprietaire of ['EQ-A', 'EQ-B']) {
    assert.equal(endpointBelongsToEquipment(CABLE_HERITE_AMBIGU, 'source', proprietaire, { components: COMPOSANTS }), false);
  }
});

test('gap 1 : on ne prend JAMAIS la première correspondance', () => {
  // EQ-A vient en premier dans COMPOSANTS : un `find` naïf le désignerait.
  assert.equal(COMPOSANTS[0].parentEquipmentId, 'EQ-A');
  assert.equal(cableTouchesEquipment(CABLE_HERITE_AMBIGU, 'EQ-A', { components: COMPOSANTS }), false);
});

test('gap 1 : sans ensemble canonique, un composant hérité n\'est attribué à personne', () => {
  // Fermer par défaut : un appelant qui ne fournit pas de quoi prouver l'unicité ne doit
  // pas obtenir une attribution par défaut.
  assert.equal(cableTouchesEquipment(CABLE_HERITE_AMBIGU, 'EQ-A'), false);
  // L'autre bout est un équipement DIRECT : lui reste attribuable sans composants.
  assert.equal(cablesForEquipment([CABLE_HERITE_AMBIGU], 'EQ-C').length, 1);
});

test('gap 1 : un parent DÉCLARÉ tranche toujours, dans les deux sens', () => {
  const versB = { id: 'C-B', sourceType: 'component', sourceId: 'slot-1', sourceParentEquipmentId: 'EQ-B',
    destinationType: 'equipment', destinationId: 'EQ-C' };
  assert.equal(cableTouchesEquipment(versB, 'EQ-B', { components: COMPOSANTS }), true);
  assert.equal(cableTouchesEquipment(versB, 'EQ-A', { components: COMPOSANTS }), false);
});

test('gap 1 : les appelants passent l\'ensemble CANONIQUE, pas leurs seuls composants', () => {
  assert.match(source('operations-suite.js'),
    /cablesForEquipment\(normalizedCables, equipment\.id, \{ components: composantsGlobaux \}\)/,
    'la Fiche360 doit passer les composants de TOUS les équipements');
  assert.match(source('broadcast-relations.js'),
    /cablesForEquipment\(cables\.map\(normalizeCable\), equipment\.id, \{ components \}\)/);
  for (const fichier of ['operations-suite.js', 'broadcast-relations.js', 'cable-endpoint-contract.js']) {
    assert.ok(!/componentIds/.test(source(fichier)),
      `${fichier} : « componentIds » rouvrirait une seconde règle d'identité`);
  }
});

/* ------------------------------------------------------------------ *
 * F1-GAP-3 — CONSULTER N'ÉCRIT PAS
 * ------------------------------------------------------------------ */

test('gap 3 : le rendu de la page des câbles ne persiste RIEN', () => {
  const code = source('broadcast-relations.js');
  const rendu = code.slice(code.indexOf('async render() {'), code.indexOf('async afterRender() {'));
  const executable = rendu.split('\n').filter(ligne => !/^\s*(\*|\/\*|\/\/)/.test(ligne)).join('\n');
  for (const ecriture of ['db.save(', 'db.delete(', 'db._deleteRaw(']) {
    assert.ok(!executable.includes(ecriture), `render() appelle encore ${ecriture}`);
  }
  assert.ok(!code.includes('normalizeLegacyRecords'),
    'la migration implicite doit avoir disparu, pas seulement son appel');
});

test('gap 3 : la compatibilité de LECTURE des câbles hérités est conservée', () => {
  // `loadData()` normalise EN MÉMOIRE : un câble hérité reste lisible sans être réécrit.
  const herite = normalizeCableRecord({ id: 'CAB-OLD', sourceEquipmentId: 'EQ-A', destinationScreenId: 'SCR-1' });
  assert.equal(herite.sourceType, 'equipment');
  assert.equal(String(herite.sourceId), 'EQ-A');
  assert.equal(herite.destinationType, 'screen');
  assert.equal(String(herite.destinationId), 'SCR-1');
  assert.equal(resolveCableEndpoint(herite, 'source', CONTEXTE).label, 'Équipement · Châssis A');
  assert.equal(resolveCableEndpoint(herite, 'destination', CONTEXTE).label, 'Écran · Écran régie');
});

test('gap 3 : le câble PROTÉGÉ était le SEUL que la migration implicite réécrivait encore', () => {
  /*
   * Mesuré : privé de `destinationId` par le serveur, il échouait à la condition
   * « déjà migré » et repartait — amputé de sa destination et de son port — vers un
   * magasin SYNCHRONISÉ. Un vrai câble hérité, lui, ressortait complet de `loadData()`
   * et n'était plus jamais écrit : la migration n'avait donc plus que ce seul effet.
   */
  const protege = normalizeCableRecord(cableAvecBoutProtege());
  assert.equal(protege.destinationId, undefined, 'le serveur a bien retiré l\'identifiant');
  const dejaMigre = cable => Boolean(cable.sourceType && cable.destinationType
    && cable.sourceId != null && cable.destinationId != null);
  assert.equal(dejaMigre(protege), false, 'c\'est cette condition qui le classait « à migrer »');
  assert.equal(dejaMigre(normalizeCableRecord({ id: 'CAB-OLD', sourceEquipmentId: 'EQ-A', destinationScreenId: 'SCR-1' })), true,
    'un vrai câble hérité ressort complet : il n\'avait plus rien à migrer');
  assert.ok(!source('broadcast-relations.js').includes('normalizeLegacyRecords'),
    'plus aucun chemin de rendu ne peut le réécrire');
});
