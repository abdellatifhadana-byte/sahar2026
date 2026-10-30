/**
 * @file tests/map-admin-inventory-p0d.test.js — P0-D : l'INVENTAIRE des actes
 *       d'administration de la carte, chacun rattaché à SA permission canonique.
 *
 * POURQUOI UN INVENTAIRE, ET PAS SEULEMENT DES ÉPREUVES ÉPARSES.
 *
 * Le défaut d'origine n'était pas qu'une garde manquait quelque part : c'est qu'UNE SEULE
 * garde — `canManageMap`, c'est-à-dire `rooms.edit` — décidait de six actes sur trois
 * types. Un tel défaut ne se voit pas en regardant une fonction : il se voit en dressant
 * la liste. Ce fichier EST cette liste, et il tombe si un acte cesse d'être rattaché à sa
 * permission, ou si un booléen global redevient l'autorité de la carte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapCan } from '../map-permissions-contract.js';

const source = readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');

/*
 * L'inventaire. `garde` est l'expression qui DOIT apparaître dans `interactive-map.js` ;
 * `entite`/`acte` est la permission canonique qui la gouverne réellement.
 */
const INVENTAIRE = [
  { acte: 'créer une salle',            garde: "droitsCarte.room.create",        type: 'room',      action: 'create' },
  { acte: 'modifier / dessiner salle',  garde: "mapCan(user, type, 'edit')",     type: 'room',      action: 'edit' },
  { acte: 'supprimer une salle',        garde: "mapCan(user, type, 'delete')",   type: 'room',      action: 'delete' },
  { acte: 'créer une baie',             garde: "droitsCarte.baie.create",        type: 'baie',      action: 'create' },
  { acte: 'forme de baie',              garde: "droitsCarte.baie.edit",          type: 'baie',      action: 'edit' },
  { acte: 'ajouter un équipement',      garde: "droitsCarte.equipment.create",   type: 'equipment', action: 'create' },
  { acte: 'modifier un équipement',     garde: "droitsCarte.equipment.edit",     type: 'equipment', action: 'edit' },
  { acte: 'positionner un équipement',  garde: "draggable: droitsCarte.equipment.edit", type: 'equipment', action: 'edit' },
  { acte: 'zone de mur',                garde: "droitsCarte.wall.edit",          type: 'wall',      action: 'edit' }
];

for (const entree of INVENTAIRE) {
  test(`INV·${entree.acte} — gardé par ${entree.type}.${entree.action}`, () => {
    assert.ok(source.includes(entree.garde),
      `la garde « ${entree.garde} » a disparu : l’acte « ${entree.acte} » n’est plus rattaché à sa permission`);
  });
}

test('INV·aucun acte ne dépend plus d’une autorité globale', () => {
  assert.doesNotMatch(source, /const canManageMap\s*=/,
    'un booléen global décidant de tous les actes est exactement le défaut fermé par ce lot');
  // `peutEditerCarte` n'autorise QUE l'accès au mode édition : chaque outil reste gardé.
  assert.match(source, /droitsCarte\.anyEdition/,
    'l’entrée en mode édition est « au moins un acte », pas « tous les actes »');
});

/*
 * LA TABLE DE VÉRITÉ QUE L'INVENTAIRE PRODUIT, RÔLE PAR RÔLE.
 *
 * C'est la matrice d'acceptation demandée : elle est ici EXÉCUTÉE, pas seulement écrite
 * dans un document qui pourrait diverger du code sans que rien ne le dise.
 */
const ATTENDU_PAR_ROLE = {
  admin:       { 'room.create':1, 'room.edit':1, 'room.delete':1, 'baie.create':1, 'baie.edit':1, 'baie.delete':1, 'equipment.create':1, 'equipment.edit':1, 'equipment.delete':1, 'wall.edit':1 },
  manager:     { 'room.create':1, 'room.edit':1, 'room.delete':1, 'baie.create':1, 'baie.edit':1, 'baie.delete':1, 'equipment.create':1, 'equipment.edit':1, 'equipment.delete':1, 'wall.edit':1 },
  chef:        { 'room.create':1, 'room.edit':1, 'room.delete':0, 'baie.create':1, 'baie.edit':1, 'baie.delete':0, 'equipment.create':1, 'equipment.edit':1, 'equipment.delete':0, 'wall.edit':1 },
  responsible: { 'room.create':0, 'room.edit':0, 'room.delete':0, 'baie.create':0, 'baie.edit':0, 'baie.delete':0, 'equipment.create':1, 'equipment.edit':1, 'equipment.delete':0, 'wall.edit':1 },
  technician:  { 'room.create':0, 'room.edit':0, 'room.delete':0, 'baie.create':0, 'baie.edit':0, 'baie.delete':0, 'equipment.create':0, 'equipment.edit':0, 'equipment.delete':0, 'wall.edit':0 },
  visitor:     { 'room.create':0, 'room.edit':0, 'room.delete':0, 'baie.create':0, 'baie.edit':0, 'baie.delete':0, 'equipment.create':0, 'equipment.edit':0, 'equipment.delete':0, 'wall.edit':0 }
};

for (const [role, attendu] of Object.entries(ATTENDU_PAR_ROLE)) {
  test(`INV·matrice d’acceptation — ${role}`, () => {
    for (const [cle, permis] of Object.entries(attendu)) {
      const [type, action] = cle.split('.');
      assert.equal(mapCan({ id: `u-${role}`, role }, type, action), Boolean(permis),
        `${role} · ${cle} attendu ${permis ? 'AUTORISÉ' : 'REFUSÉ'}`);
    }
  });
}

test('INV·le Responsable place ses équipements, sans gagner la salle ni la baie', () => {
  // Le cas qui résume le lot : la matrice le lui accordait déjà, la carte le lui refusait.
  const resp = { id: 'u-resp', role: 'responsible' };
  assert.equal(mapCan(resp, 'equipment', 'edit'), true);
  assert.equal(mapCan(resp, 'room', 'edit'), false);
  assert.equal(mapCan(resp, 'baie', 'edit'), false);
});
