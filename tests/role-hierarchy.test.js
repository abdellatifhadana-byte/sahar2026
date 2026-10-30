import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CANONICAL_ROLES, ROLE_ORDER, ROLE_LABELS, ADMIN_IS_GRANTABLE,
  normalizeRole, roleRank, roleLabel, isPlatformAdmin, canManageRole, assignableRoles,
  assertRoleAssignment, ROLE_ERRORS, canWriteStoreByRole
} from '../roles.js';
import { PermissionManager } from '../permissions.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const serveur = lire('scripts/serve.js');
const permissions = lire('permissions.js');
const navigation = lire('navigation-contract.js');
const core = lire('core.js');

/*
 * LES SIX RÔLES : admin → manager → chef → responsable → technicien → visiteur.
 *
 * Deux défauts corrigés, tous deux silencieux :
 *
 * 1. `manager` ÉTAIT UN ALIAS D'`admin`, côté navigateur ET côté serveur
 *    (`isAdminRole = role === 'admin' || role === 'manager'`, interrogé à 26 endroits).
 *    Un manager recevait donc `system.restore`, `users.changeRole`, `logs.clear`, la
 *    fermeture définitive des demandes et le contournement des permissions de zone.
 *    Personne n'avait accordé cela : c'était la conséquence d'une ligne d'alias.
 *
 * 2. `chef` N'EXISTAIT PAS. Un rôle inconnu retombe sur `visitor` : un chef nommé en base
 *    n'aurait rien vu du tout, sans le moindre message.
 */

/* ------------------------------------------------------------------ la hiérarchie */

test('les six rôles existent, dans l’ordre d’autorité', () => {
  assert.deepEqual(ROLE_ORDER, ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor']);
  for (const role of ROLE_ORDER) assert.ok(ROLE_LABELS[role], `libellé manquant pour ${role}`);
});

test('manager et chef ne sont plus confondus avec l’administrateur', () => {
  assert.equal(normalizeRole('manager'), 'manager');
  assert.equal(normalizeRole('chef'), 'chef');
  assert.equal(isPlatformAdmin('manager'), false);
  assert.equal(isPlatformAdmin('chef'), false);
  assert.equal(isPlatformAdmin('admin'), true);
});

test('chaque rôle a autorité sur les suivants, et sur eux seuls', () => {
  for (let i = 0; i < ROLE_ORDER.length; i += 1) {
    for (let j = 0; j < ROLE_ORDER.length; j += 1) {
      const attendu = i < j && ROLE_ORDER[j] !== CANONICAL_ROLES.ADMIN;
      assert.equal(canManageRole(ROLE_ORDER[i], ROLE_ORDER[j]), attendu,
        `${ROLE_ORDER[i]} → ${ROLE_ORDER[j]} devrait être ${attendu}`);
    }
  }
});

test('personne n’a autorité sur l’administrateur — pas même un administrateur', () => {
  // Interdit à un compte usurpé de déclasser le compte défini par Railway.
  for (const role of ROLE_ORDER) {
    assert.equal(canManageRole(role, 'admin'), false, `${role} a pris autorité sur l’administrateur`);
  }
});

test('un rôle n’a jamais autorité sur son propre niveau', () => {
  // Un manager n'administre pas un autre manager : sinon deux pairs se rétrogradent
  // mutuellement, et l'autorité devient une course.
  for (const role of ROLE_ORDER) {
    assert.equal(canManageRole(role, role), false, `${role} a autorité sur lui-même`);
  }
});

/* ------------------------------------------------------------------ aucun second admin */

test('AUCUN rôle ne peut attribuer « administrateur »', () => {
  // La règle du client : « aucun autre administrateur ne peut être ajouté ; l'administrateur
  // est celui des variables Railway. »
  assert.equal(ADMIN_IS_GRANTABLE, false);
  for (const role of ROLE_ORDER) {
    assert.ok(!assignableRoles(role).includes('admin'),
      `${role} peut attribuer le rôle administrateur`);
  }
});

test('les rôles attribuables sont exactement ceux du dessous', () => {
  assert.deepEqual([...assignableRoles('admin')], ['manager', 'chef', 'responsible', 'technician', 'visitor']);
  assert.deepEqual([...assignableRoles('manager')], ['chef', 'responsible', 'technician', 'visitor']);
  assert.deepEqual([...assignableRoles('chef')], ['responsible', 'technician', 'visitor']);
  assert.deepEqual([...assignableRoles('responsible')], ['technician', 'visitor']);
  assert.deepEqual([...assignableRoles('technician')], ['visitor']);
  assert.deepEqual([...assignableRoles('visitor')], []);
});

test('la règle d’écriture REFUSE un second administrateur — vérifiée en l’exécutant', () => {
  // Ce test cherchait auparavant des chaînes dans scripts/serve.js. Un test de mutation
  // l'a pris en défaut : remplacer `throw` par `void` laissait toute la suite au vert
  // pendant que la plateforme acceptait un second administrateur. La règle a donc été
  // déplacée dans roles.js, où elle peut être EXÉCUTÉE.
  for (const acteur of ROLE_ORDER) {
    assert.throws(
      () => assertRoleAssignment({ role: acteur }, null, 'admin'),
      erreur => erreur.code === ROLE_ERRORS.ADMIN_NOT_GRANTABLE && erreur.status === 403,
      `« ${acteur} » a pu créer un administrateur`);
  }
  // Y compris en visant un compte existant qui n'est pas déjà administrateur.
  assert.throws(
    () => assertRoleAssignment({ role: 'admin' }, { id: 7, role: 'technician' }, 'admin'),
    erreur => erreur.code === ROLE_ERRORS.ADMIN_NOT_GRANTABLE);
  // L'administrateur en place peut être réenregistré sans être recréé.
  assert.equal(assertRoleAssignment({ role: 'admin' }, { id: 1, role: 'admin' }, 'admin'), true);
});

test('la règle refuse d’agir au-dessus de son rang — vérifiée en l’exécutant', () => {
  assert.throws(
    () => assertRoleAssignment({ role: 'chef' }, { id: 2, role: 'manager' }),
    erreur => erreur.code === ROLE_ERRORS.ROLE_HIERARCHY_FORBIDDEN,
    'un chef a pris autorité sur un manager');
  assert.throws(
    () => assertRoleAssignment({ role: 'manager' }, { id: 1, role: 'admin' }),
    erreur => erreur.code === ROLE_ERRORS.ROLE_HIERARCHY_FORBIDDEN,
    'un manager a pris autorité sur l’administrateur');
  assert.throws(
    () => assertRoleAssignment({ role: 'chef' }, { id: 9, role: 'technician' }, 'manager'),
    erreur => erreur.code === ROLE_ERRORS.ROLE_ASSIGNMENT_FORBIDDEN,
    'un chef a promu quelqu’un manager');
  // Ce qui est permis passe.
  assert.equal(assertRoleAssignment({ role: 'manager' }, { id: 9, role: 'technician' }, 'chef'), true);
  assert.equal(assertRoleAssignment({ role: 'chef' }, { id: 9, role: 'visitor' }, 'technician'), true);
});

test('le serveur délègue à la règle partagée, sans la réécrire', () => {
  assert.match(serveur, /import \{[^}]*assertRoleAssignment[^}]*\} from '\.\.\/roles\.js'/);
  assert.match(serveur, /return assertRoleAssignment\(acteur, cible, roleDemande\);/);
  // Et elle est appelée sur les DEUX chemins qui touchent aux comptes : écriture et
  // suppression.
  assert.ok((serveur.match(/assertUserHierarchy\(user,/g) || []).length >= 2,
    'la hiérarchie n’est vérifiée que sur un seul chemin');
});

test('l’administrateur est le premier de l’ordre — c’est CE fait qui protège le reste', () => {
  // `canManageRole` et `assignableRoles` portent chacun une exclusion explicite d'`admin`,
  // mais elles sont aujourd'hui INATTEIGNABLES : rien n'est de rang inférieur à 0. Deux
  // mutations l'ont montré en survivant. La garde réelle est donc l'ordre lui-même, et
  // c'est lui qu'il faut verrouiller — les exclusions restent en filet si l'ordre change.
  assert.equal(ROLE_ORDER[0], CANONICAL_ROLES.ADMIN);
  assert.equal(roleRank(CANONICAL_ROLES.ADMIN), 0);
});

/* ------------------------------------------------------------------ les permissions */

test('le manager voit tout, mais ne reconfigure pas la plateforme', () => {
  const manager = { role: 'manager' };
  // Voir toute la chaîne — c'est la définition du rôle.
  for (const entite of ['equipments', 'rooms', 'baies', 'walls', 'screens', 'users', 'logs', 'reports', 'diagrams', 'continuity', 'system']) {
    assert.equal(PermissionManager.check(manager, entite, 'view'), true, `manager ne voit pas ${entite}`);
  }
  // Mais les leviers qui engagent la plateforme restent à l'administrateur.
  assert.equal(PermissionManager.check(manager, 'system', 'configure'), false);
  assert.equal(PermissionManager.check(manager, 'system', 'restore'), false);
  assert.equal(PermissionManager.check(manager, 'system', 'backup'), false);
  // La trace ne s'efface pas sous une autre responsabilité que celle de l'administrateur.
  assert.equal(PermissionManager.check(manager, 'logs', 'clear'), false);
  assert.equal(PermissionManager.check({ role: 'admin' }, 'logs', 'clear'), true);
});

test('le chef valide, et n’est pas un visiteur déguisé', () => {
  const chef = { role: 'chef' };
  // Avant, `chef` était inconnu et retombait sur `visitor` : rien du tout.
  assert.notDeepEqual(PermissionManager.getRolePermissions('chef'), PermissionManager.getRolePermissions('visitor'));
  assert.equal(PermissionManager.check(chef, 'continuity', 'validate'), true);
  assert.equal(PermissionManager.check(chef, 'diagrams', 'validate'), true);
  assert.equal(PermissionManager.check(chef, 'system', 'configure'), false);
});

test('le technicien et le responsable modifient, le chef valide', () => {
  // Décision du client : « le chef valide, mais le technicien et le responsable peuvent
  // modifier quelque chose avant sa validation. »
  assert.equal(PermissionManager.check({ role: 'technician' }, 'continuity', 'validate'), false);
  assert.equal(PermissionManager.check({ role: 'responsible' }, 'diagrams', 'validate'), true);
  assert.equal(PermissionManager.check({ role: 'chef' }, 'continuity', 'validate'), true);
});

test('les six rôles ont une matrice complète, sans entité oubliée', () => {
  // Une entité manquante rend `check()` faux en silence : la fonctionnalité disparaît de
  // l'écran sans qu'aucun message ne l'explique.
  const entites = Object.keys(PermissionManager.getRolePermissions('admin'));
  for (const role of ROLE_ORDER) {
    const matrice = PermissionManager.getRolePermissions(role);
    for (const entite of entites) {
      assert.ok(matrice[entite], `le rôle « ${role} » n’a aucune règle pour « ${entite} »`);
      const actions = Object.keys(PermissionManager.getRolePermissions('admin')[entite]);
      for (const action of actions) {
        assert.equal(typeof matrice[entite][action], 'boolean',
          `${role}.${entite}.${action} n’est pas un booléen`);
      }
    }
  }
});

test('l’autorité décroît le long de la hiérarchie', () => {
  // Un rôle inférieur ne doit jamais pouvoir davantage que son supérieur : ce serait un
  // trou de permission que les matrices, écrites à la main, peuvent facilement créer.
  const compte = role => {
    const matrice = PermissionManager.getRolePermissions(role);
    return Object.values(matrice).reduce((somme, actions) =>
      somme + Object.values(actions).filter(Boolean).length, 0);
  };
  for (let i = 1; i < ROLE_ORDER.length; i += 1) {
    assert.ok(compte(ROLE_ORDER[i]) <= compte(ROLE_ORDER[i - 1]),
      `« ${ROLE_ORDER[i]} » a plus de droits que « ${ROLE_ORDER[i - 1]} »`);
  }
});

/* ------------------------------------------------------------------ agir sur un compte */

test('savoir modifier des comptes ne dit pas LESQUELS', () => {
  const chef = { id: 5, role: 'chef' };
  assert.equal(PermissionManager.check(chef, 'users', 'edit'), true);
  // …mais pas sur un manager, ni sur l'administrateur.
  assert.equal(PermissionManager.canActOnUser(chef, { id: 2, role: 'manager' }), false);
  assert.equal(PermissionManager.canActOnUser(chef, { id: 1, role: 'admin' }), false);
  assert.equal(PermissionManager.canActOnUser(chef, { id: 9, role: 'technician' }), true);
  // Chacun reste maître de son propre compte.
  assert.equal(PermissionManager.canActOnUser(chef, { id: 5, role: 'chef' }), true);
});

test('l’attribution d’un rôle est bornée par celui de l’acteur', () => {
  const manager = { id: 2, role: 'manager' };
  assert.equal(PermissionManager.canAssignRole(manager, 'chef'), true);
  assert.equal(PermissionManager.canAssignRole(manager, 'manager'), false);
  assert.equal(PermissionManager.canAssignRole(manager, 'admin'), false);
});

/* ------------------------------------------------------------------ le serveur */

test('le serveur distingue « voir » de « administrer »', () => {
  // `isAdminRole` répondait « oui » au manager pour les deux, à 26 endroits.
  assert.doesNotMatch(serveur, /const isAdminRole =/);
  assert.match(serveur, /const isPlatformAdmin = role => normalizeRole\(role\) === CANONICAL_ROLES\.ADMIN/);
  assert.match(serveur, /const seesEverything = role =>/);
  // Les actes qui engagent la plateforme sont réservés à l'administrateur.
  assert.match(serveur, /if \(body\.status === 'fermé' && !isPlatformAdmin\(user\.role\)\)/);
  assert.match(serveur, /url\.pathname === '\/api\/sync\/bootstrap'\) \{\s*if \(!isPlatformAdmin\(user\.role\)\)/);
  // Les réglages n'appartiennent qu'à l'administrateur — EXÉCUTÉ, plus cherché dans le
  // texte. La règle a quitté `serve.js` pour `roles.js` afin qu'un test puisse enfin
  // l'appeler : `serve.js` ouvre un port et une base, donc rien ne l'importe. Chercher la
  // phrase prouvait où elle était écrite, jamais ce qu'elle décidait.
  assert.equal(canWriteStoreByRole('admin', 'settings'), true);
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(canWriteStoreByRole(role, 'settings'), false, `« ${role} » écrit dans les réglages`);
  }
  assert.match(serveur, /return canWriteStoreByRole\(user\.role, storeName\)/);
});

test('la validation en zone n’est plus contournée par le manager', () => {
  // Le contournement des permissions de zone est un pouvoir d'administration, pas de
  // lecture : `continuity.validate`, `continuity.test`, `diagram.validate` et le retrait
  // passent tous par `isPlatformAdmin`.
  for (const permission of ['continuity.validate', 'continuity.test', 'diagram.validate']) {
    const index = serveur.indexOf(`'${permission}'`);
    assert.ok(index > -1, `permission ${permission} introuvable`);
  }
  assert.doesNotMatch(serveur, /!seesEverything\(user\.role\)\) \{\s*if \(!zoneIds\.length/);
});

/* ------------------------------------------------------------------ l'interface */

test('manager et chef reçoivent une interface, pas celle du visiteur', () => {
  // Sans cette ligne, les deux nouveaux rôles retombaient sur VisitorUI : ils n'auraient
  // presque rien vu, ce qui est exactement le symptôme signalé.
  assert.match(core, /if \(role === 'admin' \|\| role === 'manager' \|\| role === 'chef'\)/);
});

test('chaque rôle a ses sections déclarées, et le manager n’a pas les réglages', () => {
  assert.match(navigation, /manager:Object\.freeze\(\[/);
  assert.match(navigation, /chef:Object\.freeze\(\[/);
  const bloc = navigation.slice(navigation.indexOf('manager:Object.freeze(['), navigation.indexOf('chef:Object.freeze(['));
  assert.doesNotMatch(bloc, /'settings'/, 'le manager reçoit encore les réglages');
  // `manager` n'est plus un alias de navigation vers `admin`.
  assert.doesNotMatch(navigation, /manager:'admin'/);
});

test('les rangs et libellés sont cohérents avec l’ordre', () => {
  assert.equal(roleRank('admin'), 0);
  assert.equal(roleRank('visitor'), ROLE_ORDER.length - 1);
  assert.equal(roleRank('inconnu'), ROLE_ORDER.length - 1);
  assert.equal(roleLabel('manager'), 'Manager');
  assert.equal(roleLabel('chef'), 'Chef');
  assert.equal(roleLabel('n-importe-quoi'), 'Visiteur');
});

/* ------------------------------------------------------------------ le menu du rôle */

test('le menu ne propose que les sections du rôle', () => {
  // MESURÉ AVANT : le menu était bâti sur TOUTES les sections enregistrées, quel que soit
  // le rôle. Manager et Chef partagent l'interface de l'administrateur : ils y voyaient
  // donc « Paramètres » et « Accès zones », que le contrat de navigation ne leur accorde
  // pas. Un menu qui propose ce qui sera refusé est une promesse non tenue.
  // MESURÉ APRÈS : admin 19 sections, manager 18 (sans « settings »), chef 16.
  const admin = lire('admin-ui.js');
  assert.match(admin, /function filterSectionsForRole\(sections, role\)/);
  assert.match(admin, /this\.sections = filterSectionsForRole\(this\.initSections\(\), this\.user\?\.role\)/);
  // Le filtrage a lieu APRÈS initSections(), donc après les couches qui l'enrichissent.
  const constructeur = admin.slice(admin.indexOf('constructor(user, notifications'), admin.indexOf('initSections() {'));
  assert.ok(constructeur.indexOf('filterSectionsForRole') < constructeur.indexOf('this.renderLayout()'),
    'le filtrage arrive après le rendu du menu');
});

test('l’administrateur garde toutes ses sections, même les toutes nouvelles', () => {
  // Sinon une section fraîchement enregistrée disparaîtrait de son menu tant que le
  // contrat de navigation n'aurait pas été mis à jour.
  const admin = lire('admin-ui.js');
  assert.match(admin, /if \(canonique === 'admin'\) return sections;/);
});

test('un rôle sans aucune section autorisée garde un menu, pas un écran sans issue', () => {
  const admin = lire('admin-ui.js');
  assert.match(admin, /return Object\.keys\(retenues\)\.length \? retenues : sections;/);
});

test('la section courante existe toujours dans le menu du rôle', () => {
  // `dashboard` est le défaut ; un rôle qui ne l'aurait pas ouvrirait une section absente
  // de son propre menu.
  const admin = lire('admin-ui.js');
  assert.match(admin, /this\.currentSection = this\.sections\[this\.currentSection\] \? this\.currentSection/);
});

test('l’en-tête affiche le libellé du rôle, pas sa clé technique', () => {
  const admin = lire('admin-ui.js');
  assert.match(admin, /class="user-role">\$\{escapeHTML\(roleLabel\(this\.user\.role\)\)\}/);
});
