/**
 * @file tests/cable-permissions-p0f.test.js — P0-F1 : un câble exige LE PLAFOND DU RÔLE
 *       **et** L'HABILITATION DE ZONE. Ni l'un ni l'autre ne suffit seul.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME.
 *
 * `cables` n'est pas une entité de la matrice canonique — elle couvre baies, continuity,
 * diagrams, equipments, logs, notes, reports, rooms, screens, system, users, walls. Un
 * câble n'était donc gouverné que par l'habilitation de zone `cable.read` / `cable.edit`,
 * SANS plafond de rôle : accorder `cable.edit` à un technicien en faisait, sur les câbles,
 * l'égal d'un chef. Une habilitation délègue dans un périmètre ; elle n'élève pas un rôle.
 *
 * Décision retenue : sans ajouter `cables` à la matrice, le câble emprunte le plafond des
 * ÉQUIPEMENTS — ce sont eux qu'il relie — et reste soumis à l'habilitation de zone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cableActionAllowed, cableDenialReason, cableRoleCeilingAllows,
  cableZonePermissionFor, cableAbilities, CABLE_ACTIONS, CABLE_CEILING_ENTITY,
  cableZoneGrantedSomewhere,
  cableAbilitiesFromContext,
  cableHasProtectedEndpoint,
  cableRecordDenialReason,
  cableRecordMutationAllowed
} from '../cable-permissions-contract.js';
import { readFileSync } from 'node:fs';

const U = role => ({ id: `u-${role}`, role });
const AVEC = { zoneAccorde: true };
const SANS = { zoneAccorde: false };

/*
 * La table de vérité, recopiée de `permissions.js` (entrée `equipments`) — pas déduite du
 * module testé, sinon l'épreuve ne comparerait le code qu'à lui-même.
 *
 *   view ← equipments.view   create ← equipments.create
 *   edit ← equipments.edit   delete ← equipments.delete
 */
const PLAFOND = {
  admin:       { view: 1, create: 1, edit: 1, delete: 1 },
  manager:     { view: 1, create: 1, edit: 1, delete: 1 },
  chef:        { view: 1, create: 1, edit: 1, delete: 0 },
  responsible: { view: 1, create: 1, edit: 1, delete: 0 },
  technician:  { view: 1, create: 0, edit: 0, delete: 0 },
  visitor:     { view: 1, create: 0, edit: 0, delete: 0 }
};

/* ═════════ les deux conditions, chacune prouvée SÉPARÉMENT ═════════ */

for (const [role, attendu] of Object.entries(PLAFOND)) {
  test(`CP·${role} — avec le périmètre accordé, seul le plafond de rôle décide`, () => {
    for (const [action, permis] of Object.entries(attendu)) {
      assert.equal(cableActionAllowed(U(role), action, AVEC), Boolean(permis),
        `${role} · cable.${action} : la matrice équipements dit ${permis ? 'OUI' : 'NON'}`);
    }
  });

  test(`CP·${role} — sans le périmètre, TOUT acte de câble est refusé`, () => {
    for (const action of CABLE_ACTIONS) {
      assert.equal(cableActionAllowed(U(role), action, SANS), false,
        `${role} · cable.${action} doit être refusé faute d’habilitation de zone`);
    }
  });
}

/*
 * LA LIGNE QUI COMPTE LE PLUS : une habilitation ne fabrique pas un droit.
 */
test('CP·une habilitation de zone n’élève JAMAIS un rôle au-dessus de la matrice', () => {
  for (const role of ['technician', 'visitor']) {
    for (const action of ['create', 'edit', 'delete', 'routeEdit']) {
      assert.equal(cableActionAllowed(U(role), action, AVEC), false,
        `un cable.edit accordé à « ${role} » ne doit pas contourner equipments.${action}`);
    }
  }
  // Et le chef, qui édite, ne gagne pas la suppression pour autant.
  assert.equal(cableActionAllowed(U('chef'), 'edit', AVEC), true);
  assert.equal(cableActionAllowed(U('chef'), 'delete', AVEC), false,
    'equipments.delete vaut false pour le chef : son cable.edit ne le lui rend pas');
});

test('CP·les deux refus portent DEUX NOMS distincts', () => {
  // Confondre les deux envoie un administrateur chercher dans les habilitations un refus
  // qui vient de la matrice — c'est précisément la confusion fermée en P0-D.
  assert.equal(cableDenialReason(U('technician'), 'edit', AVEC), 'ROLE_ACTION_FORBIDDEN');
  assert.equal(cableDenialReason(U('chef'), 'edit', SANS), 'ZONE_FORBIDDEN');
  assert.equal(cableDenialReason(U('chef'), 'edit', AVEC), null, 'autorisé : aucune raison de refus');
  assert.equal(cableDenialReason(U('admin'), 'teleport', AVEC), 'UNKNOWN_ACTION');
});

test('CP·le plafond se lit indépendamment du périmètre', () => {
  // `cableRoleCeilingAllows` ne consulte aucune zone : c'est ce qui permet de NOMMER le refus.
  assert.equal(cableRoleCeilingAllows(U('chef'), 'edit'), true);
  assert.equal(cableRoleCeilingAllows(U('chef'), 'delete'), false);
  assert.equal(cableRoleCeilingAllows(U('technician'), 'edit'), false);
  assert.equal(cableRoleCeilingAllows(U('technician'), 'view'), true, 'lire reste ouvert au technicien');
});

test('CP·le tracé n’a pas de droits à lui : il suit le câble', () => {
  assert.equal(cableZonePermissionFor('routeView'), 'cable.read');
  assert.equal(cableZonePermissionFor('routeEdit'), 'cable.edit');
  for (const role of Object.keys(PLAFOND)) {
    assert.equal(cableActionAllowed(U(role), 'routeView', AVEC), cableActionAllowed(U(role), 'view', AVEC),
      `${role} : voir un tracé, c’est voir le câble`);
    assert.equal(cableActionAllowed(U(role), 'routeEdit', AVEC), cableActionAllowed(U(role), 'edit', AVEC),
      `${role} : modifier un tracé, c’est modifier le câble`);
  }
});

test('CP·supprimer le TRACÉ n’est pas supprimer le CÂBLE', () => {
  /*
   * Le chef documente un parcours et peut le corriger — mais il ne détruit pas le câble.
   * Confondre les deux actes lui donnerait, par la porte du tracé, une suppression que la
   * matrice lui refuse.
   */
  const chef = U('chef');
  assert.equal(cableActionAllowed(chef, 'routeEdit', AVEC), true, 'le chef corrige un tracé');
  assert.equal(cableActionAllowed(chef, 'delete', AVEC), false, 'le chef ne supprime pas le câble');
});

test('CP·sans utilisateur ni rôle, aucun acte — pas même la lecture', () => {
  for (const sujet of [null, undefined, {}, { id: 'x' }]) {
    for (const action of CABLE_ACTIONS) {
      assert.equal(cableActionAllowed(sujet, action, AVEC), false,
        `un sujet sans rôle ne doit obtenir aucun acte (${action})`);
    }
  }
});

test('CP·un rôle INCONNU retombe sur visiteur : il lit, il n’écrit rien', () => {
  /*
   * `resolveRoleKey` de `permissions.js` rabat un rôle inconnu sur « visiteur » — c'est un
   * repli d'AFFICHAGE, délibéré et documenté là-bas. Cette épreuve fixe ce qu'il implique
   * ici : la lecture reste ouverte comme pour un visiteur, et AUCUNE écriture ne l'est.
   *
   * Le serveur, lui, est plus strict encore : `canAccessRecord` refuse d'emblée un rôle
   * que `roleOf()` ne reconnaît pas, lecture comprise. L'écran est donc, au pire, plus
   * permissif en LECTURE que l'API — jamais en écriture, et c'est l'API qui tranche.
   */
  const inconnu = { id: 'u-x', role: 'archiviste-fantôme' };
  assert.equal(cableActionAllowed(inconnu, 'view', AVEC), true, 'repli visiteur : lecture');
  assert.equal(cableActionAllowed(inconnu, 'routeView', AVEC), true);
  for (const action of ['create', 'edit', 'delete', 'routeEdit']) {
    assert.equal(cableActionAllowed(inconnu, action, AVEC), false,
      `un rôle inconnu ne doit obtenir aucune écriture (${action})`);
  }
});

test('CP·le plafond emprunté est bien celui des équipements, et c’est dit', () => {
  assert.equal(CABLE_CEILING_ENTITY, 'equipments',
    'si cette valeur change, la décision métier a changé : l’épreuve doit le signaler');
});

test('CP·cableAbilities compose un écran sans disperser la règle', () => {
  const chef = cableAbilities(U('chef'), AVEC);
  assert.deepEqual(chef, { view: true, create: true, edit: true, delete: false, routeView: true, routeEdit: true });
  const technicien = cableAbilities(U('technician'), AVEC);
  assert.deepEqual(technicien, { view: true, create: false, edit: false, delete: false, routeView: true, routeEdit: false });
});

/* ------------------------------------------------------------------ *
 * LE CÔTÉ « ZONE », ET LE CÂBLAGE RÉEL DES ÉCRANS
 *
 * Le contrat peut être juste et l'écran rester ouvert : ces épreuves lisent le point
 * d'appel, pas seulement la règle.
 * ------------------------------------------------------------------ */

const contexte = (grants = [], memberships = [], extra = {}) => ({ grants, memberships, ...extra });
const ACTIF = { status: 'active' };

test('zone : une habilitation sans ADHÉSION à la même zone ne vaut rien', () => {
  const sansAdhesion = contexte([{ zoneId: 'Z1', permission: 'cable.edit', ...ACTIF }], []);
  assert.equal(cableZoneGrantedSomewhere(sansAdhesion, 'cable.edit'), false);
  const avecAdhesion = contexte(
    [{ zoneId: 'Z1', permission: 'cable.edit', ...ACTIF }],
    [{ zoneId: 'Z1', ...ACTIF }]);
  assert.equal(cableZoneGrantedSomewhere(avecAdhesion, 'cable.edit'), true);
});

test('zone : adhésion et habilitation dans DEUX zones différentes ne se composent pas', () => {
  const croise = contexte(
    [{ zoneId: 'Z2', permission: 'cable.edit', ...ACTIF }],
    [{ zoneId: 'Z1', ...ACTIF }]);
  assert.equal(cableZoneGrantedSomewhere(croise, 'cable.edit'), false);
});

test('zone : une habilitation révoquée, inactive ou expirée ne compte pas', () => {
  const adhesion = [{ zoneId: 'Z1', ...ACTIF }];
  for (const mort of [{ status: 'revoked' }, { status: 'inactive' }, { ...ACTIF, expiresAt: '2000-01-01T00:00:00.000Z' }]) {
    const ctx = contexte([{ zoneId: 'Z1', permission: 'cable.edit', ...mort }], adhesion);
    assert.equal(cableZoneGrantedSomewhere(ctx, 'cable.edit'), false, JSON.stringify(mort));
  }
});

test('zone : sans contexte chargé, on REFUSE — on ne suppose pas un droit qu\'on n\'a pas lu', () => {
  assert.equal(cableZoneGrantedSomewhere(null, 'cable.edit'), false);
  assert.equal(cableZoneGrantedSomewhere(undefined, 'cable.read'), false);
  assert.equal(cableAbilitiesFromContext({ role: 'admin' }, null).edit, false);
});

test('zone : `isGlobalAdmin` ouvre le PÉRIMÈTRE, jamais le plafond de rôle', () => {
  const partout = contexte([], [], { isGlobalAdmin: true });
  assert.equal(cableZoneGrantedSomewhere(partout, 'cable.edit'), true);
  // Le même drapeau sur un technicien ne lui donne toujours pas l'édition : le plafond
  // vient de la matrice, que ce drapeau ne touche pas.
  assert.equal(cableAbilitiesFromContext({ role: 'technician' }, partout).edit, false);
  assert.equal(cableAbilitiesFromContext({ role: 'admin' }, partout).edit, true);
});

test('les six rôles, périmètre ACCORDÉ : la matrice reste le plafond', () => {
  const partout = contexte(
    [{ zoneId: 'Z1', permission: 'cable.read', ...ACTIF }, { zoneId: 'Z1', permission: 'cable.edit', ...ACTIF }],
    [{ zoneId: 'Z1', ...ACTIF }]);
  /*
   * COPIÉ DE `permissions.js`, LIGNE `equipments` — pas de mémoire, pas de déduction.
   * `responsible` CRÉE des équipements (c'est sur `rooms` qu'il ne crée pas) : le câble
   * emprunte le plafond des ÉQUIPEMENTS, donc il crée des câbles.
   */
  const attendu = {
    admin:       { view: true, create: true,  edit: true,  delete: true },
    manager:     { view: true, create: true,  edit: true,  delete: true },
    chef:        { view: true, create: true,  edit: true,  delete: false },
    responsible: { view: true, create: true,  edit: true,  delete: false },
    technician:  { view: true, create: false, edit: false, delete: false },
    visitor:     { view: true, create: false, edit: false, delete: false }
  };
  for (const [role, droits] of Object.entries(attendu)) {
    const obtenu = cableAbilitiesFromContext({ role }, partout);
    for (const [action, valeur] of Object.entries(droits)) {
      assert.equal(obtenu[action], valeur, `${role} · ${action}`);
    }
  }
});

test('les six rôles, périmètre REFUSÉ : personne ne passe, pas même l\'administrateur', () => {
  const rien = contexte([], []);
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor']) {
    const droits = cableAbilitiesFromContext({ role }, rien);
    for (const action of ['view', 'create', 'edit', 'delete', 'routeView', 'routeEdit']) {
      assert.equal(droits[action], false, `${role} · ${action} sans habilitation de câblage`);
    }
  }
});

test('les DEUX refus gardent des noms distincts jusque dans l\'écran', () => {
  const broadcast = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
  assert.match(broadcast, /ROLE_ACTION_FORBIDDEN:/);
  assert.match(broadcast, /ZONE_FORBIDDEN:/);
  const roles = broadcast.slice(broadcast.indexOf('ROLE_ACTION_FORBIDDEN:'), broadcast.indexOf('ZONE_FORBIDDEN:'));
  assert.ok(!/habilitation/i.test(roles), 'le refus de RÔLE ne doit pas parler d\'habilitation de zone');
});

test('câblage : les deux écrans de câbles demandent la décision au contrat', () => {
  // `component-relations.js` ne surcharge que `render` et `openAddForm` : les gestes des
  // boutons restent ceux de `afterRender`, dans la classe de base. Chaque fichier est donc
  // vérifié sur CE QU'IL PORTE — exiger l'autre reviendrait à réclamer une seconde copie
  // de la même garde, et deux copies dérivent.
  const broadcast = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
  // La CRÉATION n'a pas d'enregistrement : elle se garde sur la capacité d'écran.
  assert.match(broadcast, /this\.autorise\('create'\)/, 'broadcast-relations.js : « create » n\'est pas gardé');
  // L'ÉDITION et la SUPPRESSION portent sur un câble précis : elles se gardent sur lui.
  for (const action of ['edit', 'delete']) {
    assert.match(broadcast, new RegExp(`this\\.autoriseSur\\('${action}', cable\\)`),
      `broadcast-relations.js : « ${action} » doit être gardé SUR L'ENREGISTREMENT`);
  }
  for (const fichier of ['broadcast-relations.js', 'component-relations.js']) {
    const code = readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');
    assert.match(code, /\(\s*(?:raw)?[cC]able \? this\.autoriseSur\('edit', (?:raw)?[cC]able\) : this\.autorise\('create'\)\s*\)/,
      `${fichier} : le formulaire n'est pas gardé sur l'enregistrement`);
    assert.match(code, /await this\.chargerDroits\(\)/,
      `${fichier} : le rendu ne lit pas les droits`);
  }
});

test('câblage : le bouton caché n\'est PAS l\'autorisation — l\'écriture est gardée elle aussi', () => {
  for (const fichier of ['broadcast-relations.js', 'component-relations.js']) {
    const code = readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');
    const soumission = code.slice(code.indexOf('onsubmit = async'));
    const avantEcriture = soumission.slice(0, soumission.indexOf("db.save('cables'"));
    assert.match(avantEcriture, /this\.autoriseSur\('edit', cable\)/,
      `${fichier} : le formulaire écrit sans redemander la décision sur l'enregistrement`);
  }
});

test('câblage : la surcharge composants retombe sur le refus de la classe de base', () => {
  const code = readFileSync(new URL('../component-relations.js', import.meta.url), 'utf8');
  assert.match(code, /if \(!droits\.view\) return previousRender\.call\(this\);/,
    'sans droit de lecture, la surcharge doit rendre la main au refus de base, pas la table');
});

test('câblage : un rôle sans lecture ne reçoit AUCUNE ligne de câble', () => {
  const code = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
  const rendu = code.slice(code.indexOf('async render() {'));
  const garde = rendu.slice(0, rendu.indexOf('const data = await this.loadData();'));
  assert.match(garde, /if \(!droits\.view\)/, 'le rendu doit refuser avant de charger les câbles');
  assert.ok(garde.indexOf('droits.view') < rendu.indexOf('this.loadData()'),
    'la décision doit précéder la lecture des données');
});

/* ------------------------------------------------------------------ *
 * F1-GAP-2 — « HABILITÉ QUELQUE PART » N'EST PAS « AUTORITÉ SUR CE CÂBLE »
 *
 * MESURÉ sur serveur réel (PostgreSQL), chef habilité `cable.edit` sur STC seulement :
 *
 *   CAB-INTRA  STC → STC   client edit=true   serveur PUT 200
 *   CAB-CROSS  STC → RF1   client edit=true   serveur PUT 403 ZONE_FORBIDDEN
 *                          et le serveur avait posé `destinationProtected` dessus.
 *
 * `db.save` écrivant EN LOCAL D'ABORD, la modification refusée devenait visible avant
 * de disparaître au rollback. Le marqueur de protection est la preuve, portée par la
 * donnée elle-même, qu'une extrémité échappe au lecteur : on ferme dessus.
 * ------------------------------------------------------------------ */

const CHEF_STC = { id: 7, role: 'chef' };
const CTX_STC = contexte(
  [{ zoneId: 'stc', permission: 'cable.read', ...ACTIF }, { zoneId: 'stc', permission: 'cable.edit', ...ACTIF }],
  [{ zoneId: 'stc', ...ACTIF }]);

/* La forme EXACTE que le serveur a servie pendant la reproduction. */
const CAB_CROSS = Object.freeze({
  id: 'CAB-CROSS', reference: 'CAB-CROSS',
  sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT2',
  destinationType: 'equipment',
  destinationProtected: Object.freeze({
    relation: 'external-protected', zone: { id: 'rf1', name: 'Régie Finale RF1' },
    publicStatus: 'dependency-present', direction: 'downstream'
  })
});
const CAB_INTRA = Object.freeze({
  id: 'CAB-INTRA', reference: 'CAB-INTRA',
  sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT1',
  destinationType: 'equipment', destinationId: 12, destinationPortId: 'IN9'
});

test('gap 2 : la capacité d\'écran et l\'autorité sur un enregistrement sont DEUX questions', () => {
  // Capacité : oui, il édite des câbles — c'est ce qui justifie d'afficher des outils.
  assert.equal(cableAbilitiesFromContext(CHEF_STC, CTX_STC).edit, true);
  // Autorité : non, pas sur CELUI-CI.
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'edit', CAB_CROSS, CTX_STC), false);
  // Et oui sur celui qui reste dans son périmètre — le refus ne doit pas tout fermer.
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'edit', CAB_INTRA, CTX_STC), true);
});

test('gap 2 : le refus d\'enregistrement porte son PROPRE nom', () => {
  assert.equal(cableRecordDenialReason(CHEF_STC, 'edit', CAB_CROSS, CTX_STC), 'ENDPOINT_OUT_OF_SCOPE');
  // Ni « votre rôle », ni « votre périmètre » : ces deux-là sont d'autres faits.
  assert.notEqual(cableRecordDenialReason(CHEF_STC, 'edit', CAB_CROSS, CTX_STC), 'ZONE_FORBIDDEN');
  assert.notEqual(cableRecordDenialReason(CHEF_STC, 'edit', CAB_CROSS, CTX_STC), 'ROLE_ACTION_FORBIDDEN');
  assert.equal(cableRecordDenialReason(CHEF_STC, 'edit', CAB_INTRA, CTX_STC), null);
});

test('gap 2 : le plafond de rôle passe AVANT l\'enregistrement — le bon refus reste nommé', () => {
  // Le chef n'a pas `equipments.delete` : c'est la matrice qui ferme, pas l'extrémité.
  assert.equal(cableRecordDenialReason(CHEF_STC, 'delete', CAB_INTRA, CTX_STC), 'ROLE_ACTION_FORBIDDEN');
  assert.equal(cableRecordDenialReason(CHEF_STC, 'delete', CAB_CROSS, CTX_STC), 'ROLE_ACTION_FORBIDDEN');
  // Et sans habilitation du tout, c'est le périmètre qu'on nomme.
  assert.equal(cableRecordDenialReason(CHEF_STC, 'edit', CAB_INTRA, contexte([], [])), 'ZONE_FORBIDDEN');
});

test('gap 2 : les DEUX côtés comptent — la protection peut porter sur la source', () => {
  const inverse = { id: 'CAB-REV', destinationType: 'equipment', destinationId: 12,
    sourceType: 'equipment', sourceProtected: { relation: 'external-protected', zone: { id: 'rf1', name: 'RF1' } } };
  assert.equal(cableHasProtectedEndpoint(inverse), true);
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'edit', inverse, CTX_STC), false);
});

test('gap 2 : VOIR un câble protégé reste permis — c\'est l\'affichage prévu', () => {
  // Fermer la lecture ferait disparaître le câble, donc l\'information qu\'il existe :
  // c\'est exactement ce que le contrat d\'extrémité existe pour éviter.
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'view', CAB_CROSS, CTX_STC), true);
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'routeView', CAB_CROSS, CTX_STC), true);
  // Mais modifier son TRACÉ est une écriture : elle se ferme comme les autres.
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'routeEdit', CAB_CROSS, CTX_STC), false);
});

test('gap 2 : un administrateur global n\'est pas dispensé de la preuve sur l\'enregistrement', () => {
  // `isGlobalAdmin` ouvre le périmètre, mais un câble qui lui arrive AMPUTÉ signale que
  // quelque chose lui échappe : écrire dessus renverrait la version amputée.
  const partout = contexte([], [], { isGlobalAdmin: true });
  assert.equal(cableAbilitiesFromContext({ role: 'admin' }, partout).edit, true);
  assert.equal(cableRecordMutationAllowed({ role: 'admin' }, 'edit', CAB_CROSS, partout), false);
  assert.equal(cableRecordMutationAllowed({ role: 'admin' }, 'edit', CAB_INTRA, partout), true);
});

test('gap 2 : le refus arrive AVANT db.save / db.delete, jamais après', () => {
  const code = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');

  const suppression = code.slice(code.indexOf(".querySelectorAll('.delete-cable')"));
  const avantSuppression = suppression.slice(0, suppression.indexOf("db.delete('cables'"));
  assert.match(avantSuppression, /this\.autoriseSur\('delete', cable\)/,
    'db.delete supprime EN LOCAL D\'ABORD : la décision doit le précéder');

  const soumission = code.slice(code.indexOf('form.onsubmit = async event'));
  const avantEcriture = soumission.slice(0, soumission.indexOf("db.save('cables'"));
  assert.match(avantEcriture, /this\.autoriseSur\('edit', cable\)/,
    'db.save écrit EN LOCAL D\'ABORD : la décision doit le précéder');
});

test('gap 2 : chaque LIGNE du tableau porte sa propre décision', () => {
  for (const fichier of ['broadcast-relations.js', 'component-relations.js']) {
    const code = readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');
    assert.match(code, /droitsSur\(cable\)\.edit/, `${fichier} : la ligne n'a pas sa propre décision d'édition`);
    assert.match(code, /droitsSur\(cable\)\.delete/, `${fichier} : la ligne n'a pas sa propre décision de suppression`);
  }
  // La capacité d'écran ne doit plus décider seule d'une ligne.
  const table = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
  assert.ok(!/\$\{droits\.edit \? `<button class="btn-icon edit-cable"/.test(table),
    'une ligne décidée par la capacité globale rouvrirait exactement l\'écart mesuré');
});

test('gap 2 : le message de refus ne décrit PAS l\'autre périmètre', () => {
  const code = readFileSync(new URL('../broadcast-relations.js', import.meta.url), 'utf8');
  const message = code.slice(code.indexOf('ENDPOINT_OUT_OF_SCOPE:'), code.indexOf('UNKNOWN_ACTION:'));
  assert.ok(!/\bRF1\b|\bSTC\b|zoneId|destinationId|componentId|portId/.test(message),
    'le refus ne doit rien révéler de l\'extrémité protégée');
});

test('gap 2 : LA LIMITE CONNUE — un périmètre de lecture plus large que celui d\'édition', () => {
  /*
   * MESURÉ sur serveur réel. Avec `cable.read` sur STC *et* RF1 mais `cable.edit` sur STC
   * seulement, le serveur sert CAB-CROSS SANS marqueur de protection — le lecteur a bien
   * le droit de voir les deux bouts — puis refuse l'écriture en 403 ZONE_FORBIDDEN.
   *
   * Aucune donnée servie au client ne distingue alors ce câble d'un câble autorisé : le
   * contexte d'accès porte les zones, les adhésions et les habilitations, mais AUCUNE
   * cartographie enregistrement → zone (`contextFor`, access-control.js). Ce test fige donc
   * la limite au lieu de la laisser se perdre : le client ne prétend pas trancher, et le
   * serveur reste l'autorité finale.
   *
   * Le jour où le serveur joindra les zones exigées au câble qu'il sert, cette attente
   * devra devenir `false` — et c'est l'échec de ce test qui le rappellera.
   */
  const lectureLarge = contexte(
    [{ zoneId: 'stc', permission: 'cable.read', ...ACTIF }, { zoneId: 'stc', permission: 'cable.edit', ...ACTIF },
     { zoneId: 'rf1', permission: 'cable.read', ...ACTIF }],
    [{ zoneId: 'stc', ...ACTIF }, { zoneId: 'rf1', ...ACTIF }]);
  const croiseSansMarqueur = { id: 'CAB-CROSS', sourceType: 'equipment', sourceId: 10,
    destinationType: 'equipment', destinationId: 20 };

  assert.equal(cableHasProtectedEndpoint(croiseSansMarqueur), false,
    'le serveur ne marque pas ce câble : le lecteur voit légitimement les deux bouts');
  assert.equal(cableRecordMutationAllowed(CHEF_STC, 'edit', croiseSansMarqueur, lectureLarge), true,
    'LIMITE CONNUE : le client ne peut pas prouver ce refus — le serveur le prononcera');
});
