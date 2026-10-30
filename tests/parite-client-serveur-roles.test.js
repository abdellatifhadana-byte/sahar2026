import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Salles, { zonesDeCreationDeSalle, selecteurDeZoneDeSalle } from '../salles.js';
import Baies from '../baies.js';
import { db } from '../db.js';
import { PermissionManager } from '../permissions.js';
import {
  CANONICAL_ROLES, resolveKnownRole, normalizeRole, isHistoricalRole
} from '../roles.js';

/*
 * LA PARITÉ CLIENT / SERVEUR DES SIX RÔLES.
 *
 * Le serveur sait désormais répondre « quel rôle est-ce ? » d'une seule façon. Deux pages
 * ne le lui demandent pas : elles décident elles-mêmes, en comparant la chaîne brute du
 * rôle à une liste écrite à la main.
 *
 *     salles.js:118  const canEdit = currentUser?.role === 'admin'
 *                                 || currentUser?.role === 'manager'
 *                                 || currentUser?.role === 'responsible'
 *                                 || currentUser?.role === 'responsable';
 *     baies.js:34    (la même ligne, mot pour mot)
 *
 * Deux divergences, dans les deux sens :
 *
 *   • CHEF est absent de la liste. La matrice lui accorde `rooms.create`, `rooms.edit`,
 *     `rooms.assign` et `rooms.export` ; le serveur lui accorde `room.edit` dans ses zones.
 *     À l'écran, il ne voyait NI le formulaire d'ajout, NI les boutons Modifier, NI la
 *     colonne Actions — une page en lecture seule pour le rôle qui encadre les salles.
 *
 *   • RESPONSABLE y figure. La matrice lui refuse les sept actions sauf `view`, et le
 *     serveur lui refuse `room.edit` (plafond `sauf('users.manage','zone.manage','room.edit')`).
 *     Il voyait donc des boutons Modifier, Supprimer, Exporter et Importer qui menaient
 *     tous à un 403 — l'échec le plus coûteux, celui qu'on découvre après avoir saisi.
 *
 * `entity-permission-integration.js` élague bien ces éléments APRÈS le rendu, mais c'est
 * une seconde barrière : elle ne rend pas au chef ce que le premier rendu ne produit
 * jamais. On corrige donc la PREMIÈRE source de vérité, et ces tests interrogent le rendu
 * seul, sans l'intégration, pour le prouver.
 *
 * Ces tests EXÉCUTENT `render()`. Un `assert.match` sur le source resterait vert pendant
 * que le défaut est vivant — c'est arrivé deux fois sur ce dépôt.
 */

/* ══════════════════════════════ montage des deux pages */

const SESSIONS = new Map();
const session = role => {
  if (!SESSIONS.has(role)) {
    SESSIONS.set(role, {
      getItem: cle => (cle === 'auth' ? JSON.stringify({ id: `u-${role}`, role, username: role }) : null),
      setItem() {}, removeItem() {}
    });
  }
  return SESSIONS.get(role);
};

const SALLES = Object.freeze([{ id: 'r1', name: 'STC', responsibleId: 'u-responsible' }]);
const BAIES = Object.freeze([{ id: 'b1', name: 'Baie 1', roomId: 'r1' }]);
const COMPTES = Object.freeze([{ id: 'u-responsible', role: 'responsible', fullName: 'Responsable STC' }]);

/**
 * Le contexte d'accès par défaut du banc : une zone où le sujet peut créer.
 *
 * Il est POSÉ, jamais chargé : `render()` n'appelle `/api/access/context` que lorsqu'il
 * l'ignore, et un banc Node n'a ni `window` ni serveur. Sans lui, tout rôle à périmètre
 * tomberait dans le cas « contexte indisponible » — qui a son propre test — et l'on
 * mesurerait ce cas-là au lieu de la matrice des autorisations.
 */
const CONTEXTE_UNE_ZONE = Object.freeze({
  zones: [{ id: 'Z-STC', name: 'Régie STC', status: 'active' }],
  memberships: [{ zoneId: 'Z-STC', status: 'active' }],
  grants: [{ zoneId: 'Z-STC', permission: 'room.edit', status: 'active' }],
  isGlobalAdmin: false
});

async function rendreSalles(role, contexte = CONTEXTE_UNE_ZONE) {
  globalThis.localStorage = session(role);
  db.getAll = async store => ({ rooms: [...SALLES], users: [...COMPTES], locations: [] }[store] || []);
  const salles = new Salles(null);
  salles.accessContext = contexte;
  return salles.render();
}

async function rendreBaies(role) {
  globalThis.localStorage = session(role);
  db.getAll = async store => ({ baies: [...BAIES], rooms: [...SALLES] }[store] || []);
  return new Baies(null).render();
}

/**
 * Le TABLEAU seul.
 *
 * Chercher `data-action="edit"` dans la page entière ne prouverait rien : le formulaire
 * d'ajout et les filtres contiennent leurs propres balises. Le tableau est découpé
 * d'abord, avec une garde contre le débordement.
 */
function tableau(html) {
  const debut = html.indexOf('<table class="tableau">');
  const fin = html.indexOf('</table>', debut);
  assert.ok(debut >= 0 && fin > debut, 'le tableau est introuvable dans la page');
  const bloc = html.slice(debut, fin);
  assert.doesNotMatch(bloc, /<form/, 'le découpage a débordé sur le formulaire');
  return bloc;
}

/** Le formulaire d'ajout seul, ou une chaîne vide s'il n'est pas rendu. */
function formulaire(html, id) {
  const debut = html.indexOf(`id="${id}"`);
  if (debut < 0) return '';
  const fin = html.indexOf('</form>', debut);
  assert.ok(fin > debut, `le formulaire « ${id} » n’est pas refermé`);
  return html.slice(debut, fin);
}

/* ══════════════════════════════ ce que dit le contrat, rôle par rôle
 *
 * Cette table n'est pas une opinion : elle est LUE dans `PERMISSIONS_MATRIX` par
 * `PermissionManager.check`. Le test ci-dessous vérifie qu'elle correspond bien à ce que
 * la matrice répond, de sorte qu'un changement de contrat fasse échouer la table et non
 * l'inverse.
 */
const ATTENDU = Object.freeze({
  admin:       { create:true,  edit:true,  delete:true,  assign:true,  export:true,  import:true  },
  manager:     { create:true,  edit:true,  delete:true,  assign:true,  export:true,  import:true  },
  chef:        { create:true,  edit:true,  delete:false, assign:true,  export:true,  import:false },
  responsible: { create:false, edit:false, delete:false, assign:false, export:false, import:false },
  technician:  { create:false, edit:false, delete:false, assign:false, export:false, import:false },
  visitor:     { create:false, edit:false, delete:false, assign:false, export:false, import:false }
});

/*
 * LÀ OÙ LES SALLES S'ÉCARTENT DES BAIES — `rooms.assign` pour le chef (A-1).
 *
 * Assigner une BAIE range du matériel. Assigner une SALLE désigne son responsable, et le
 * serveur en tire l'autorité de zone qui va avec : c'est le même acte que nommer un
 * responsable de zone, réservé à l'administration globale
 * (`RESPONSIBLE_ASSIGN_ADMIN_ONLY`). Le chef garde `rooms.edit` — modifier une fiche — mais
 * ne décide plus qui en répond. La table ci-dessus vaut donc pour les baies, et pour les
 * salles à cette exception près.
 *
 * MESURÉ au commit a3e2dd0 : `assign:true` faisait afficher au chef un sélecteur de
 * responsable dont l'enregistrement escaladait ses propres droits au redémarrage suivant.
 */
const ATTENDU_SALLES = Object.freeze({
  ...Object.fromEntries(Object.entries(ATTENDU).map(([role, actions]) => [role, Object.freeze({ ...actions })])),
  chef: Object.freeze({ ...ATTENDU.chef, assign: false })
});

const ROLES = Object.keys(ATTENDU);

test('P0 — la table de ce fichier est bien celle du contrat, pour les salles et les baies', () => {
  for (const role of ROLES) {
    for (const [action, attendu] of Object.entries(ATTENDU[role])) {
      const utilisateur = { id: 'x', role };
      assert.equal(PermissionManager.check(utilisateur, 'rooms', action), ATTENDU_SALLES[role][action],
        `rooms.${action} pour « ${role} » : la table du test et la matrice divergent`);
      assert.equal(PermissionManager.check(utilisateur, 'baies', action), attendu,
        `baies.${action} pour « ${role} » : la table du test et la matrice divergent`);
    }
    assert.equal(PermissionManager.check({ id: 'x', role }, 'rooms', 'view'), true,
      `« ${role} » devrait pouvoir consulter les salles`);
  }
});

/* ══════════════════════════════ AUTH-UI-01 · les salles */

for (const role of ROLES) {
  const attendu = ATTENDU_SALLES[role];

  test(`UI-SALLES · ${role} — le rendu suit le contrat, action par action`, async () => {
    const html = await rendreSalles(role);
    const liste = tableau(html);
    const ajout = formulaire(html, 'add-salle-form');

    assert.equal(html.includes('id="add-salle-form"'), attendu.create,
      `formulaire d’ajout : attendu ${attendu.create}`);
    assert.equal(liste.includes('data-action="edit"'), attendu.edit,
      `bouton Modifier : attendu ${attendu.edit}`);
    assert.equal(liste.includes('data-action="coord"'), attendu.edit,
      `bouton Coord. (une modification de la salle) : attendu ${attendu.edit}`);
    assert.equal(liste.includes('data-action="del"'), attendu.delete,
      `bouton Supprimer : attendu ${attendu.delete}`);
    assert.equal(html.includes('id="export-salles"'), attendu.export,
      `bouton Exporter : attendu ${attendu.export}`);
    assert.equal(html.includes('id="import-salles"'), attendu.import,
      `bouton Importer : attendu ${attendu.import}`);
    assert.equal(html.includes('id="import-salles-file"'), attendu.import,
      `champ de fichier d’import : attendu ${attendu.import}`);
    assert.equal(ajout.includes('name="responsibleId"'), attendu.create && attendu.assign,
      `sélecteur de responsable dans le formulaire : attendu ${attendu.create && attendu.assign}`);
    assert.equal(liste.includes('<th>Actions</th>'), attendu.edit || attendu.delete,
      `colonne Actions : attendu ${attendu.edit || attendu.delete}`);
  });

  test(`UI-BAIES · ${role} — le rendu suit le contrat, action par action`, async () => {
    const html = await rendreBaies(role);
    const liste = tableau(html);

    assert.equal(html.includes('id="add-baie-form"'), attendu.create,
      `formulaire d’ajout : attendu ${attendu.create}`);
    assert.equal(liste.includes('data-action="edit"'), attendu.edit,
      `bouton Modifier : attendu ${attendu.edit}`);
    assert.equal(liste.includes('data-action="del"'), attendu.delete,
      `bouton Supprimer : attendu ${attendu.delete}`);
    assert.equal(html.includes('id="export-baies"'), attendu.export,
      `bouton Exporter : attendu ${attendu.export}`);
    assert.equal(html.includes('id="import-baies"'), attendu.import,
      `bouton Importer : attendu ${attendu.import}`);
    assert.equal(html.includes('id="import-baies-file"'), attendu.import,
      `champ de fichier d’import : attendu ${attendu.import}`);
    assert.equal(liste.includes('<th>Actions</th>'), attendu.edit || attendu.delete,
      `colonne Actions : attendu ${attendu.edit || attendu.delete}`);
  });
}

/* ══════════════════════════════ AUTH-UI-01 · les deux défauts, nommés */

test('UI-01·A — le CHEF reçoit le formulaire d’ajout et les boutons Modifier', async () => {
  // Le défaut mesuré : `chef` était absent de la liste de chaînes, donc la page entière
  // lui arrivait en lecture seule alors que la matrice ET le serveur l'autorisent.
  const html = await rendreSalles('chef');
  assert.ok(html.includes('id="add-salle-form"'), 'le chef n’a pas le formulaire d’ajout de salle');
  assert.ok(tableau(html).includes('data-action="edit"'), 'le chef n’a pas le bouton Modifier');
  const baies = await rendreBaies('chef');
  assert.ok(baies.includes('id="add-baie-form"'), 'le chef n’a pas le formulaire d’ajout de baie');
});

test('UI-01·B — le RESPONSABLE ne reçoit plus de boutons qui finissent en 403', async () => {
  // L'inverse du même défaut : `responsible` figurait dans la liste alors que la matrice
  // lui refuse les sept actions et que son plafond serveur exclut `room.edit`.
  const html = await rendreSalles('responsible');
  assert.ok(!html.includes('id="add-salle-form"'), 'le responsable garde un formulaire d’ajout inutilisable');
  assert.ok(!html.includes('data-action="del"'), 'le responsable garde un bouton Supprimer inutilisable');
  assert.ok(!html.includes('id="export-salles"'), 'le responsable garde un bouton Exporter inutilisable');
  const baies = await rendreBaies('responsible');
  assert.ok(!baies.includes('data-action="edit"'), 'le responsable garde un bouton Modifier de baie inutilisable');
});

test('UI-01·C — le CHEF n’obtient ni Supprimer ni Importer : sa granularité est réelle', async () => {
  // Une correction paresseuse — remplacer la liste de chaînes par un unique
  // `PermissionManager.check(user,'rooms','edit')` — rendrait ce test rouge : le chef
  // recevrait Supprimer et Importer, que la matrice lui refuse.
  const html = await rendreSalles('chef');
  assert.ok(!tableau(html).includes('data-action="del"'), 'le chef reçoit Supprimer, que la matrice lui refuse');
  assert.ok(!html.includes('id="import-salles"'), 'le chef reçoit Importer, que la matrice lui refuse');
  const baies = await rendreBaies('chef');
  assert.ok(!tableau(baies).includes('data-action="del"'), 'le chef reçoit Supprimer une baie');
  assert.ok(!baies.includes('id="import-baies"'), 'le chef reçoit Importer des baies');
});

test('UI-01·D — les alias français décident comme leur rôle canonique', async () => {
  // `users.js` enregistre la valeur canonique, mais des comptes historiques portent le
  // libellé affiché. Décider sur la chaîne brute les traitait comme des inconnus.
  for (const [alias, canonique] of [['responsable', 'responsible'], ['technicien', 'technician'], ['visiteur', 'visitor'], ['administrateur', 'admin']]) {
    const parAlias = await rendreSalles(alias);
    const parCanonique = await rendreSalles(canonique);
    assert.equal(parAlias.includes('id="add-salle-form"'), parCanonique.includes('id="add-salle-form"'),
      `« ${alias} » et « ${canonique} » ne reçoivent pas le même formulaire`);
    assert.equal(parAlias.includes('id="export-salles"'), parCanonique.includes('id="export-salles"'),
      `« ${alias} » et « ${canonique} » ne reçoivent pas les mêmes exports`);
  }
});

test('UI-01·E — un rôle inconnu tombe au niveau du visiteur, jamais au niveau éditeur', async () => {
  for (const inconnu of ['superuser', 'root', '', '  ']) {
    const html = await rendreSalles(inconnu);
    assert.ok(!html.includes('id="add-salle-form"'), `« ${inconnu} » obtient le formulaire d’ajout`);
    assert.ok(!html.includes('data-action="del"'), `« ${inconnu} » obtient le bouton Supprimer`);
    assert.ok(html.includes('<table class="tableau">'), `« ${inconnu} » ne voit même plus la liste`);
  }
});

test('UI-01·F — aucune décision d’affichage ne compare encore une chaîne de rôle', async () => {
  // Garde de non-régression : la ligne exacte qui a produit les deux défauts ne doit
  // revenir dans aucune des deux pages. Elle est cherchée sur la forme, pas sur le texte
  // littéral, pour rester valable si l'ordre des rôles change.
  for (const fichier of ['../salles.js', '../baies.js']) {
    const source = readFileSync(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\?\.role\s*===\s*['"]/,
      `${fichier} compare encore la chaîne brute du rôle pour décider d’un affichage`);
  }
});

/* ══════════════════════════════ AUTH-ROOM-CREATE-01 · le choix de la zone à l'écran */

const CONTEXTE_CHEF = Object.freeze({
  zones: [
    { id: 'Z-STC', name: 'Régie STC', status: 'active' },
    { id: 'Z-RF1', name: 'RF1', status: 'active' },
    { id: 'Z-VIEILLE', name: 'Ancienne régie', status: 'inactive' }
  ],
  memberships: [
    { zoneId: 'Z-STC', status: 'active' },
    { zoneId: 'Z-RF1', status: 'active' },
    { zoneId: 'Z-VIEILLE', status: 'active' }
  ],
  grants: [
    { zoneId: 'Z-STC', permission: 'room.edit', status: 'active' },
    { zoneId: 'Z-RF1', permission: 'equipment.edit', status: 'active' },
    { zoneId: 'Z-VIEILLE', permission: 'room.edit', status: 'active' }
  ],
  isGlobalAdmin: false
});

test('ZONE-UI·1 — seules les zones où l’on est membre ET habilité sont ouvertes', () => {
  // Membre partout, mais `room.edit` sur Z-STC seulement — et Z-VIEILLE est inactive.
  assert.deepEqual(zonesDeCreationDeSalle(CONTEXTE_CHEF).map(zone => zone.id), ['Z-STC']);
});

test('ZONE-UI·2 — une adhésion ou une habilitation révoquée n’ouvre rien', () => {
  const revoque = {
    ...CONTEXTE_CHEF,
    grants: [{ zoneId: 'Z-STC', permission: 'room.edit', status: 'revoked' }]
  };
  assert.deepEqual(zonesDeCreationDeSalle(revoque), []);
  const sansAdhesion = { ...CONTEXTE_CHEF, memberships: [{ zoneId: 'Z-STC', status: 'revoked' }] };
  assert.deepEqual(zonesDeCreationDeSalle(sansAdhesion), []);
});

test('ZONE-UI·3 — l’administrateur global voit toutes les zones actives, sans habilitation', () => {
  const global = { ...CONTEXTE_CHEF, memberships: [], grants: [], isGlobalAdmin: true };
  assert.deepEqual(zonesDeCreationDeSalle(global).map(zone => zone.id), ['Z-STC', 'Z-RF1']);
});

test('ZONE-UI·4 — le chef reçoit un champ de zone OBLIGATOIRE, limité à sa zone', async () => {
  const html = selecteurDeZoneDeSalle(CONTEXTE_CHEF);
  assert.match(html, /name="zoneId"[^>]*required/);
  assert.ok(html.includes('value="Z-STC"'), 'sa zone n’est pas proposée');
  assert.ok(!html.includes('value="Z-RF1"'), 'une zone sans `room.edit` est proposée');
  assert.ok(!html.includes('value="Z-VIEILLE"'), 'une zone inactive est proposée');
});

test('ZONE-UI·5 — l’administrateur global peut n’en choisir aucune : son champ est facultatif', () => {
  // Sa salle reçoit sa zone transitoire au démarrage suivant : c'est le comportement
  // actuel, et l'exiger de lui le changerait sans qu'on le lui ait demandé.
  const html = selecteurDeZoneDeSalle({ ...CONTEXTE_CHEF, isGlobalAdmin: true });
  assert.doesNotMatch(html, /required/);
  assert.ok(html.includes('Zone : créée automatiquement'));
});

test('ZONE-UI·6 — contexte INDISPONIBLE : le chef n’obtient PAS un formulaire qui finira en refus', async () => {
  // Le champ de zone est obligatoire pour un rôle à périmètre. Sans la liste de ses zones,
  // le formulaire ne peut être ni rempli ni accepté : l'offrir quand même produit une
  // saisie perdue, et hors ligne une opération en attente qui sera rejetée plus tard.
  const salles = new Salles(null);
  salles.accessContext = null;
  globalThis.localStorage = session('chef');
  db.getAll = async store => ({ rooms: [...SALLES], users: [...COMPTES], locations: [] }[store] || []);
  const html = await salles.render();
  assert.ok(!html.includes('id="add-salle-form"'), 'le chef reçoit un formulaire qu’il ne peut pas soumettre');
  assert.match(html, /salle-zone-indisponible/);
  assert.ok(html.includes('connexion centrale'), 'le message ne dit pas quoi attendre');
  assert.ok(html.includes('<table class="tableau">'), 'la consultation a été retirée en même temps');
});

test('ZONE-UI·6bis — l’administrateur et le manager gardent leur chemin global', async () => {
  // Ils court-circuitent les zones côté serveur : leur création n'a jamais eu besoin de la
  // liste, et une panne de `/api/access/context` ne doit pas les bloquer.
  for (const role of ['admin', 'manager']) {
    const salles = new Salles(null);
    salles.accessContext = null;
    globalThis.localStorage = session(role);
    db.getAll = async store => ({ rooms: [...SALLES], users: [...COMPTES], locations: [] }[store] || []);
    const html = await salles.render();
    assert.ok(html.includes('id="add-salle-form"'), `« ${role} » perd son formulaire sur contexte indisponible`);
    assert.ok(!html.includes('salle-zone-indisponible'), `« ${role} » reçoit un message qui ne le concerne pas`);
  }
});

test('ZONE-UI·6ter — le sélecteur seul ne fabrique rien sans contexte', () => {
  assert.equal(selecteurDeZoneDeSalle(null), '');
});

test('ZONE-UI·7 — aucune zone ouverte : une phrase, pas un formulaire qui finira en refus', async () => {
  const salles = new Salles(null);
  salles.accessContext = { zones: [{ id: 'Z-RF1', name: 'RF1', status: 'active' }], memberships: [], grants: [], isGlobalAdmin: false };
  globalThis.localStorage = session('chef');
  db.getAll = async store => ({ rooms: [...SALLES], users: [...COMPTES], locations: [] }[store] || []);
  const html = await salles.render();
  assert.ok(!html.includes('id="add-salle-form"'), 'le formulaire est offert sans zone où créer');
  assert.match(html, /salle-zone-absente/);
  assert.ok(html.includes('Modifier une salle'), 'la phrase ne dit pas quelle habilitation demander');
  assert.ok(html.includes('<table class="tableau">'), 'la consultation a été retirée en même temps');
});

test('ZONE-UI·8 — le champ de zone n’est proposé qu’à qui peut créer', async () => {
  const salles = new Salles(null);
  salles.accessContext = CONTEXTE_CHEF;
  globalThis.localStorage = session('responsible');
  db.getAll = async store => ({ rooms: [...SALLES], users: [...COMPTES], locations: [] }[store] || []);
  const html = await salles.render();
  assert.ok(!html.includes('name="zoneId"'), 'un rôle sans `rooms.create` reçoit un champ de zone');
  assert.ok(!html.includes('salle-zone-absente'), 'un rôle sans `rooms.create` reçoit le message de zone');
});

test('ZONE-UI·9 — un nom de zone ne peut pas injecter de balise', () => {
  const html = selecteurDeZoneDeSalle({
    zones: [{ id: 'Z"1', name: '<img src=x onerror=alert(1)>', status: 'active' }],
    memberships: [{ zoneId: 'Z"1', status: 'active' }],
    grants: [{ zoneId: 'Z"1', permission: 'room.edit', status: 'active' }],
    isGlobalAdmin: false
  });
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.includes('&lt;img'), 'le nom n’est pas échappé');
  assert.ok(html.includes('&quot;'), 'l’identifiant n’est pas échappé');
});

/* ══════════════════════════════ AUTH-ALIAS-01 · « technique » */

test('ALIAS-01 — « technique » est un technicien', () => {
  // Le formulaire de création de compte et les imports JSON laissent passer ce libellé.
  // Sans entrée, il retombait sur `visitor` : un technicien créé ainsi perdait
  // `equipment.edit`, `screen.edit` et `diagnostic.run` sans qu'aucun écran ne le dise.
  assert.equal(resolveKnownRole('technique'), CANONICAL_ROLES.TECHNICIAN);
  assert.equal(isHistoricalRole('technique'), true,
    '« technique » n’est pas reconnu comme une écriture historique du rôle');
});

test('ALIAS-01 — l’ajout est fait dans la SEULE table d’alias, pas dans une seconde', () => {
  // `isHistoricalRole` et `resolveKnownRole` lisent tous deux `ROLE_ALIASES` : la seule
  // façon de les satisfaire sans y toucher serait d'ajouter une table parallèle. Le
  // littéral est donc découpé et l'entrée cherchée DEDANS, et l'unicité de la table est
  // vérifiée — deux vérités pour la même question est exactement le défaut qu'on répare.
  const source = readFileSync(new URL('../roles.js', import.meta.url), 'utf8');
  const declarations = source.match(/const ROLE_ALIASES\s*=/g) || [];
  assert.equal(declarations.length, 1, 'ROLE_ALIASES est déclaré plus d’une fois');
  const debut = source.indexOf('const ROLE_ALIASES');
  const fin = source.indexOf('});', debut);
  assert.ok(debut >= 0 && fin > debut, 'le littéral ROLE_ALIASES est introuvable');
  assert.match(source.slice(debut, fin), /^\s*technique:\s*CANONICAL_ROLES\.TECHNICIAN,?\s*$/m,
    '« technique » n’est pas dans le littéral ROLE_ALIASES');
});

test('ALIAS-01 — les quatre écritures du technicien donnent le MÊME rôle', () => {
  const canoniques = ['tech', 'technique', 'technicien', 'technician', 'TECHNIQUE', '  Technique  ']
    .map(entree => resolveKnownRole(entree));
  assert.deepEqual([...new Set(canoniques)], [CANONICAL_ROLES.TECHNICIAN],
    'les écritures du rôle technicien ne convergent pas');
});

test('ALIAS-01 — l’ajout n’ouvre rien d’autre : l’inconnu reste fermé', () => {
  for (const inconnu of ['techniques', 'technicienne', 'technicien-chef', 'tech-lead', 'superuser']) {
    assert.equal(resolveKnownRole(inconnu), null, `« ${inconnu} » est devenu résoluble`);
    assert.equal(normalizeRole(inconnu), CANONICAL_ROLES.VISITOR, `« ${inconnu} » ne retombe plus sur visiteur`);
  }
});

test('ALIAS-01 — un compte « technique » reçoit les droits du technicien, pas ceux du visiteur', () => {
  // Comparer deux rendus de la page Salles ne prouverait rien : technicien et visiteur y
  // voient exactement la même chose. C'est ailleurs que le repli coûtait des droits —
  // `equipments.changeStatus`, `screens.diagnose`, `notes.create`, `screens.createTicket`.
  const technique = PermissionManager.getRolePermissions('technique');
  assert.deepEqual(technique, PermissionManager.getRolePermissions('technician'),
    '« technique » n’obtient pas les droits du technicien');
  assert.notDeepEqual(technique, PermissionManager.getRolePermissions('visitor'),
    '« technique » retombe encore sur le visiteur');
  for (const [entite, action] of [['equipments','changeStatus'], ['screens','diagnose'], ['notes','create'], ['screens','createTicket']]) {
    assert.equal(PermissionManager.check({ id:'x', role:'technique' }, entite, action), true,
      `un compte « technique » perd ${entite}.${action}`);
  }
});
