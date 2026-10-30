import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PermissionManager } from '../permissions.js';

/*
 * SCREEN-DIAG-TECH-01 (#110) — OUVRIR UN DIAGNOSTIC N'ÉCRIT RIEN.
 *
 * La preuve de COMPORTEMENT vit dans `scripts/screen-diag-browser-gate.mjs` : PostgreSQL
 * réel, session technicien scopée, Chromium, chaque `put` d'IndexedDB et chaque requête
 * réseau relevés. Elle échoue sur `main@bd121dbc` et passe sur cette HEAD.
 *
 * Ce fichier garde les DÉCISIONS du lot pour qu'elles ne soient pas défaites par
 * inadvertance, et il éprouve la projection elle-même — la fonction pure qui remplace
 * l'écriture.
 */
const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const diagnostic = lire('screens-diagnostic.js');

/** Le code hors commentaires : le lot CITE le défaut qu'il ferme pour l'expliquer. */
const rendu = diagnostic
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(ligne => !/^\s*\/\//.test(ligne)).join('\n');

test('#110 : aucune écriture screen_groups ne subsiste dans le module de diagnostic', () => {
  // Le défaut mesuré : `db.save('screen_groups', …)` appelé depuis l'initialisation, donc
  // depuis la simple ouverture. C'est cette écriture-là qui partait au serveur et revenait
  // en 403 — pour la salle du technicien LUI-MÊME, `screen_groups` étant gardé par
  // `screen.edit` que celui qui diagnostique ne détient pas.
  assert.doesNotMatch(rendu, /db\.save\(\s*['"]screen_groups['"]/,
    'le diagnostic ne doit plus écrire de screen_groups');
  assert.doesNotMatch(rendu, /initializeScreenGroups/,
    'l’initialisation mutante ne doit plus exister');
});

test('#110 : l’initialisation du module ne fait plus que lire', () => {
  const init = rendu.slice(rendu.indexOf('async init()'), rendu.indexOf('async loadDiagnosisData()'));
  assert.match(init, /loadDiagnosisData/);
  // `this.ready` est construit UNE FOIS dans le constructeur. Toute écriture placée là
  // latchait son refus : la promesse rejetée était ré-attendue par chaque `render()`
  // ultérieur, et le bouton « Diagnostiquer » restait mort pour toute la session.
  assert.doesNotMatch(init, /db\.save|db\.delete/,
    'l’initialisation ne doit contenir aucune mutation');
});

test('#110 : le lot n’élargit aucun droit — la matrice screens.diagnose est inchangée', () => {
  // Corriger en donnant `screen.edit` au technicien aurait fait passer l'épreuve en
  // ouvrant une écriture que son métier ne justifie pas. La matrice est donc éprouvée
  // telle qu'elle est, pour constater qu'elle le reste.
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician']) {
    assert.equal(PermissionManager.check({ role }, 'screens', 'diagnose'), true,
      `${role} doit conserver screens.diagnose`);
  }
  assert.equal(PermissionManager.check({ role: 'visitor' }, 'screens', 'diagnose'), false,
    'le visiteur ne doit pas recevoir screens.diagnose');
  // Le technicien ne gagne AUCUN droit d'écriture sur les écrans par ce lot.
  assert.equal(PermissionManager.check({ role: 'technician' }, 'screens', 'delete'), false);
  assert.equal(PermissionManager.check({ role: 'visitor' }, 'screens', 'edit'), false);
  assert.equal(PermissionManager.check({ role: 'visitor' }, 'screens', 'createTicket'), false);
});

test('#110 : le serveur garde screen_groups derrière screen.edit', () => {
  // Le correctif est côté écran ; le serveur ne doit pas avoir été assoupli pour
  // l'accompagner. La garde est lue là où elle est écrite.
  const acces = lire('scripts/access-control.js');
  assert.match(acces, /screen_groups:\s*'screen\.read'/, 'la lecture reste gardée par screen.read');
  assert.match(acces, /screen_groups:\s*'screen\.edit'/, 'l’écriture reste gardée par screen.edit');
});

/*
 * LA PROJECTION, ÉPROUVÉE POUR CE QU'ELLE EST : une fonction pure.
 *
 * `projectScreenGroups` est appelée sur l'instance, mais ne touche que `this.rooms` et
 * `this.screens`. On l'éprouve donc sur un objet nu, sans base ni navigateur — ce qui est
 * précisément la preuve qu'elle n'écrit nulle part.
 */
const { default: ScreensDiagnostic } = await import('../screens-diagnostic.js');
const projeter = (rooms, screens, persistes = []) =>
  ScreensDiagnostic.prototype.projectScreenGroups.call({ rooms, screens }, persistes);

test('#110 : la projection dérive un groupe par salle pourvue d’écrans', () => {
  const groupes = projeter(
    [{ id: 'salle-a', name: 'Salle A' }, { id: 'salle-vide', name: 'Salle vide' }],
    [{ id: 'e1', roomId: 'salle-a' }, { id: 'e2', roomId: 'salle-a' }]
  );
  assert.deepEqual(Object.keys(groupes), ['room_salle-a']);
  assert.equal(groupes['room_salle-a'].name, 'Écrans Salle A');
  assert.deepEqual(groupes['room_salle-a'].screenIds, ['e1', 'e2']);
  assert.equal(groupes['room_salle-a'].roomId, 'salle-a');
  // Une salle sans écran ne produit aucun groupe — même condition qu'avant le correctif.
  assert.equal(groupes['room_salle-vide'], undefined);
});

test('#110 : la projection ne voit que les salles et écrans reçus', () => {
  // L'instantané central a déjà filtré par zone : la projection ne peut pas inventer une
  // salle qu'on ne lui a pas donnée. C'est ce qui rend la fuite hors zone IMPOSSIBLE par
  // construction, plutôt que rattrapée par un test de permission après coup.
  const groupes = projeter(
    [{ id: 'salle-a', name: 'Salle A' }],
    [{ id: 'e1', roomId: 'salle-a' }, { id: 'eB', roomId: 'salle-b' }]
  );
  assert.deepEqual(Object.keys(groupes), ['room_salle-a']);
  assert.deepEqual(groupes['room_salle-a'].screenIds, ['e1'],
    'un écran d’une salle absente ne rejoint aucun groupe');
});

test('#110 : un groupe réellement persisté prime sur la projection', () => {
  // La base reste la source de vérité là où elle a quelque chose à dire — un inventaire
  // central peut installer de vrais groupes. La projection ne comble que son silence,
  // et l'on ne crée pas une seconde source de vérité.
  const groupes = projeter(
    [{ id: 'salle-a', name: 'Salle A' }],
    [{ id: 'e1', roomId: 'salle-a' }, { id: 'e2', roomId: 'salle-a' }],
    [{ id: 'room_salle-a', name: 'Groupe installé', screenIds: ['e2'], roomId: 'salle-a' }]
  );
  assert.equal(groupes['room_salle-a'].name, 'Groupe installé');
  assert.deepEqual(groupes['room_salle-a'].screenIds, ['e2']);
  assert.equal(groupes['room_salle-a'].derived, false);
});

test('#110 : un groupe persisté hors du schéma room_* est conservé', () => {
  const groupes = projeter(
    [{ id: 'salle-a', name: 'Salle A' }],
    [{ id: 'e1', roomId: 'salle-a' }],
    [{ id: 'groupe-metier', name: 'Régie principale', screenIds: ['e1'] }]
  );
  assert.equal(groupes['groupe-metier'].name, 'Régie principale');
  assert.equal(groupes['room_salle-a'].derived, true);
});

test('#110 : l’absence totale de groupe est un état valide', () => {
  // Le défaut traitait « aucun groupe » comme une anomalie à réparer par une écriture.
  // C'est un état ordinaire : une plateforme neuve n'en a aucun.
  assert.deepEqual(projeter([], []), {});
  assert.deepEqual(projeter([{ id: 'salle-a', name: 'Salle A' }], []), {});
});

test('#110 : un groupe persisté sans screenIds ne casse pas la sélection', () => {
  // `renderMainInterface` lit `g.screenIds.length` sans garde : un enregistrement hérité
  // dépourvu du champ ferait échouer le rendu entier du diagnostic.
  const groupes = projeter([], [], [{ id: 'groupe-nu', name: 'Groupe hérité' }]);
  assert.deepEqual(groupes['groupe-nu'].screenIds, []);
});

test('#110 : la projection suit les écrans qui changent de salle', () => {
  // Un groupe écrit une fois restait figé : déplacer un écran ne le mettait pas à jour.
  // La projection, recalculée à chaque chargement, ne peut pas se périmer.
  const avant = projeter(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    [{ id: 'e1', roomId: 'a' }, { id: 'e2', roomId: 'b' }]
  );
  assert.deepEqual(avant['room_a'].screenIds, ['e1']);
  const apres = projeter(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    [{ id: 'e1', roomId: 'b' }, { id: 'e2', roomId: 'b' }]
  );
  assert.deepEqual(apres['room_a'], undefined);
  assert.deepEqual(apres['room_b'].screenIds, ['e1', 'e2']);
});

test('#110 : la projection compare les identifiants sans se fier à leur type', () => {
  // `roomId` voyage tantôt en nombre, tantôt en chaîne, selon qu'il vient d'IndexedDB ou
  // du serveur. L'ancienne boucle utilisait `===` et manquait alors tous les écrans.
  const groupes = projeter([{ id: 7, name: 'Salle 7' }], [{ id: 'e1', roomId: '7' }]);
  assert.deepEqual(groupes['room_7'].screenIds, ['e1']);
});

test('#110 : l’épreuve de navigateur et son décor sont présents', () => {
  // Le lot ne tient pas sans sa preuve de comportement : elle doit rester dans l'arbre.
  for (const chemin of ['scripts/screen-diag-decor.mjs', 'scripts/screen-diag-browser-gate.mjs']) {
    assert.ok(fs.existsSync(new URL(`../${chemin}`, import.meta.url)), `${chemin} absent`);
  }
});
