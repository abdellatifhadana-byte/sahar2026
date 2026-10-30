import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refKey, procedureEntityRefs, diagramEntityRefs, uniqueRefs, indexEngineeringLinks,
  linksForEntity, describeRef, buildCatalogs, filterProcedures, procedureSearchText,
  NAVIGABLE_ENTITY_STORES
} from '../engineering-refs.js';
import { normalizeContinuityProcedure } from '../continuity-contract.js';

/*
 * Le décor est volontairement construit par le NORMALISEUR RÉEL du serveur, pas à la main :
 * une procédure écrite à la main pourrait avoir une forme que la plateforme ne produit
 * jamais, et l'épreuve validerait alors un cas qui n'arrive pas.
 */
const procedureCroisee = normalizeContinuityProcedure({
  id:'proc-1', title:'Bascule RF1 vers secours', purpose:'Rétablir la diffusion',
  revision:'2', status:'validated',
  prerequisites:['Vérifier la présence du signal secours'],
  steps:[
    { type:'prepare', title:'Préparer', instruction:'Ouvrir la baie',
      entityRefs:[{ type:'baie', id:'baie-a', label:'Baie A' }, { type:'room', id:'salle-1' }] },
    { type:'switch', title:'Basculer', instruction:'Commuter la source',
      entityRefs:[{ type:'equipment', id:'eq-9' }, { type:'baie', id:'baie-a' }] },
    { type:'verify', title:'Vérifier', instruction:'Contrôler le mur',
      entityRefs:[{ type:'wall', id:'mur-3' }, { type:'port', id:'p-12', label:'SDI 3' }] }
  ]
}, null);

const schema = {
  id:'diag-1', kind:'technical_diagram', title:'Synoptique régie', status:'validated',
  nodes:[
    { id:'n1', type:'entity', entityRef:{ type:'equipment', id:'eq-9' } },
    { id:'n2', type:'label', label:'Sans référence' },
    { id:'n3', type:'entity', entityRef:{ type:'screen', id:'ecran-4' } },
    { id:'n4', type:'entity', entityRef:{ type:'equipment', id:'' } }
  ]
};

const catalogs = buildCatalogs({
  rooms:[{ id:'salle-1', name:'Régie 2' }],
  baies:[{ id:'baie-a', name:'Baie A1' }],
  equipments:[{ id:'eq-9', name:'Encodeur RF1' }],
  walls:[{ id:'mur-3', name:'Mur principal' }],
  screens:[{ id:'ecran-4', name:'Écran 4' }],
  cables:[]
});

test('les références d’une procédure sont lues à plat, dans l’ordre des étapes', () => {
  const refs = procedureEntityRefs(procedureCroisee);
  assert.deepEqual(refs.map(ref => `${ref.type}:${ref.id}`),
    ['baie:baie-a', 'room:salle-1', 'equipment:eq-9', 'baie:baie-a', 'wall:mur-3', 'port:p-12']);
});

test('une référence sans identifiant n’entre jamais dans l’index', () => {
  // `n4` porte un `entityRef` dont l'id est vide : le compter produirait une puce qui
  // n'ouvre rien — exactement le bouton mort que ce lot s'interdit.
  assert.deepEqual(diagramEntityRefs(schema).map(ref => `${ref.type}:${ref.id}`),
    ['equipment:eq-9', 'screen:ecran-4']);
});

test('la déduplication garde le premier passage et l’ordre', () => {
  const refs = uniqueRefs(procedureEntityRefs(procedureCroisee));
  assert.deepEqual(refs.map(ref => `${ref.type}:${ref.id}`),
    ['baie:baie-a', 'room:salle-1', 'equipment:eq-9', 'wall:mur-3', 'port:p-12']);
});

test('un identifiant numérique et son écriture texte désignent le même objet', () => {
  assert.equal(refKey('equipment', 42), refKey('equipment', '42'));
  const index = indexEngineeringLinks([
    { kind:'continuity_procedure', id:'p', steps:[{ entityRefs:[{ type:'equipment', id:42 }] }] }
  ]);
  assert.equal(linksForEntity(index, 'equipment', '42').procedures.length, 1);
});

test('l’index inverse répond dans les deux familles', () => {
  const index = indexEngineeringLinks([procedureCroisee, schema]);

  const equipement = linksForEntity(index, 'equipment', 'eq-9');
  assert.deepEqual(equipement.procedures.map(item => item.id), ['proc-1']);
  assert.deepEqual(equipement.diagrams.map(item => item.id), ['diag-1']);

  // Une entité citée par un seul côté ne doit pas hériter de l'autre.
  assert.deepEqual(linksForEntity(index, 'screen', 'ecran-4').procedures, []);
  assert.deepEqual(linksForEntity(index, 'room', 'salle-1').diagrams, []);
});

test('une entité que rien ne cite reçoit deux listes vides, jamais undefined', () => {
  const index = indexEngineeringLinks([procedureCroisee, schema]);
  const liens = linksForEntity(index, 'equipment', 'inconnu');
  assert.deepEqual(liens, { procedures:[], diagrams:[] });
});

test('une référence résolue porte le nom de la BASE, pas celui écrit dans la référence', () => {
  // La baie s'appelle « Baie A1 » en base et « Baie A » dans la procédure : une baie
  // renommée doit s'afficher sous son nom actuel, sinon chaque procédure fige un ancien nom.
  const decrit = describeRef({ type:'baie', id:'baie-a', label:'Baie A' }, catalogs);
  assert.equal(decrit.resolved, true);
  assert.equal(decrit.navigable, true);
  assert.equal(decrit.label, 'Baie A1');
  assert.equal(decrit.store, 'baies');
});

test('une référence navigable dont la cible a disparu est dite NON RÉSOLUE', () => {
  const decrit = describeRef({ type:'room', id:'salle-effacee', label:'Ancienne régie' }, catalogs);
  assert.equal(decrit.navigable, true);
  assert.equal(decrit.resolved, false);
  assert.equal(decrit.record, null);
  // Le libellé écrit sert alors de dernier recours : mieux vaut « Ancienne régie » que « #id ».
  assert.equal(decrit.label, 'Ancienne régie');
});

test('un type sans fiche propre est affiché, jamais présenté comme navigable', () => {
  const decrit = describeRef({ type:'port', id:'p-12', label:'SDI 3' }, catalogs);
  assert.equal(decrit.navigable, false);
  assert.equal(decrit.typeLabel, 'Port');
  assert.equal(decrit.label, 'SDI 3');
});

test('les cinq entités du lot plus le câble sont navigables, et elles seules', () => {
  assert.deepEqual(Object.keys(NAVIGABLE_ENTITY_STORES).sort(),
    ['baie', 'cable', 'equipment', 'room', 'screen', 'wall']);
});

test('la recherche trouve une procédure par le NOM d’une entité qu’elle cite', () => {
  // Le titre ne contient pas « Régie 2 » : seule la salle citée le porte.
  assert.ok(!procedureCroisee.title.includes('Régie'));
  const trouve = filterProcedures([procedureCroisee], 'régie 2', catalogs);
  assert.equal(trouve.length, 1);
});

test('la recherche exige TOUS les termes, et une requête vide ne filtre rien', () => {
  assert.equal(filterProcedures([procedureCroisee], 'bascule secours', catalogs).length, 1);
  assert.equal(filterProcedures([procedureCroisee], 'bascule introuvable', catalogs).length, 0);
  assert.equal(filterProcedures([procedureCroisee], '   ', catalogs).length, 1);
});

test('la recherche couvre le corps des étapes, pas seulement le titre', () => {
  const foin = procedureSearchText(procedureCroisee, catalogs);
  assert.ok(foin.includes('commuter la source'), 'l’instruction d’une étape doit être cherchable');
  assert.ok(foin.includes('mur principal'), 'le nom d’une entité citée doit être cherchable');
});

test('un document qui n’est ni procédure ni schéma est ignoré par l’index', () => {
  const index = indexEngineeringLinks([
    { kind:'continuity_protection_group', id:'g1', steps:[{ entityRefs:[{ type:'equipment', id:'eq-9' }] }] }
  ]);
  assert.deepEqual(linksForEntity(index, 'equipment', 'eq-9').procedures, []);
});
