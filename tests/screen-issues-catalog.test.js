/**
 * @file Diagnostic Definition / Knowledge Catalog vs incident opérationnel (#118).
 *
 * `screen_issues` mélangeait deux natures : une définition de diagnostic générique
 * (« Écran noir », ses étapes) et un incident attaché à un écran réel. La première n'a
 * pas de zone par construction ; `resolveResourceZones` en rendait `[]`, et la règle
 * fail-closed de `canAccessRecord` la refusait à TOUT rôle à périmètre — y compris ceux
 * qu'habilite `diagnostic.run`. Admin/Manager ne le voyaient pas : ils court-circuitent
 * les zones.
 *
 * `appliesToAll` ne peut pas trancher cette question : c'est un indice de rapprochement,
 * pas une classification de confiance — un enregistrement peut porter `appliesToAll:true`
 * ET `screenIds:['écran réel']` en même temps (`scripts/screen-diag-decor.mjs` le fait).
 *
 * Ce fichier éprouve la CLASSIFICATION, pure et rapide. La preuve de COMPORTEMENT — la
 * projection réelle par `/api/sync`, l'écriture rejetée, les deux zones — vit dans
 * `scripts/screen-issues-catalog-e2e.mjs` : PostgreSQL réel, sessions réelles, RED mesuré
 * sur `main@aa8f0b2`, GREEN sur cette branche.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createAccessControl,
  isCatalogDefinition,
  isContradictoryCatalogWrite,
  hasOperationalAttachment
} from '../scripts/access-control.js';
import { hasScreenIssueAttachment } from '../screens-diagnostic.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const accessControl = read('scripts/access-control.js');
const serve = read('scripts/serve.js');
const diagnostic = read('screens-diagnostic.js');

/* ── LA TABLE DE VÉRITÉ EXACTE DE #118 ────────────────────────────────────── */

test('scope:catalog sans attachement est une définition de catalogue', () => {
  assert.equal(isCatalogDefinition({ scope: 'catalog', name: 'Écran noir' }), true);
});

test('scope:catalog AVEC attachement n’est PAS catalogue, quel que soit le champ', () => {
  for (const attachment of [
    { screenId: 'ecran-b' },
    { screenIds: ['ecran-b'] },
    { groupIds: ['groupe-b'] },
    { roomId: 'salle-b' }
  ]) {
    const record = { scope: 'catalog', ...attachment };
    assert.equal(isCatalogDefinition(record), false, `attachement ${JSON.stringify(attachment)} doit disqualifier`);
    assert.equal(isContradictoryCatalogWrite(record), true, `${JSON.stringify(attachment)} doit être une contradiction d'écriture`);
  }
});

test('scope:operational avec attachement suit le chemin opérationnel normal', () => {
  const record = { scope: 'operational', screenIds: ['ecran-b'] };
  assert.equal(isCatalogDefinition(record), false);
  assert.equal(isContradictoryCatalogWrite(record), false);
});

test('scope:operational SANS attachement n’est jamais promu catalogue : l’intention explicite prime', () => {
  // Un auteur qui a dit « operational » ne doit pas voir son enregistrement devenir
  // globalement lisible simplement parce qu'il n'est pas encore attaché.
  assert.equal(isCatalogDefinition({ scope: 'operational', appliesToAll: true }), false);
});

test('scope manquant + attachement = comportement hérité opérationnel', () => {
  assert.equal(isCatalogDefinition({ screenIds: ['ecran-a'] }), false);
});

test('appliesToAll historique SANS attachement ET sans scope = repli lecture catalogue', () => {
  assert.equal(isCatalogDefinition({ appliesToAll: true }), true);
});

test('un enregistrement hérité ATTACHÉ reste scopé, appliesToAll ou non', () => {
  assert.equal(isCatalogDefinition({ appliesToAll: true, screenIds: ['ecran-b'] }), false);
});

test('scope manquant ET aucun appliesToAll = fail-closed, jamais global', () => {
  assert.equal(isCatalogDefinition({ name: 'Sans classification' }), false);
});

test('un scope inconnu ferme, il ne devient jamais global', () => {
  assert.equal(isCatalogDefinition({ scope: 'quelque-chose-d-inattendu', appliesToAll: true }), false);
});

test('un enregistrement vide ou absent ferme', () => {
  assert.equal(isCatalogDefinition(null), false);
  assert.equal(isCatalogDefinition(undefined), false);
  assert.equal(isCatalogDefinition({}), false);
});

/* ── TABLEAUX VIDES : ABSENCE D'ATTACHEMENT, PAS ATTACHEMENT VIDE ─────────── */

test('un tableau vide ne compte jamais comme attachement', () => {
  assert.equal(hasOperationalAttachment({ screenIds: [], groupIds: [] }), false);
  assert.equal(isCatalogDefinition({ scope: 'catalog', screenIds: [], groupIds: [] }), true);
});

test('un identifiant réel dans un tableau compte, même seul parmi des tableaux vides', () => {
  assert.equal(hasOperationalAttachment({ screenIds: [], groupIds: ['groupe-reel'] }), true);
});

/* ── PARITÉ SERVEUR / CLIENT ──────────────────────────────────────────────── */

/**
 * `screens-diagnostic.js` est un module PUBLIC, servi sans authentification ; il ne peut
 * pas importer `scripts/access-control.js`, qui vit hors du bundle. La classification y
 * est donc réécrite à l'identique. Ce test compare leur COMPORTEMENT sur la même batterie,
 * pas leur texte, pour qu'un écart entre les deux copies reste visible.
 */
test('la détection d’attachement du client correspond exactement à celle du serveur', () => {
  const cas = [
    {},
    { screenId: 'ecran-a' },
    { screenIds: ['ecran-a'] },
    { screenIds: [] },
    { groupIds: ['groupe-a'] },
    { groupIds: [] },
    { roomId: 'salle-a' },
    { roomId: '' },
    { screenId: 'ecran-a', groupIds: [], roomId: null },
    { screenIds: ['ecran-a', 'ecran-b'], roomId: 'salle-c' }
  ];
  for (const record of cas) {
    assert.equal(hasScreenIssueAttachment(record), hasOperationalAttachment(record), JSON.stringify(record));
  }
});

/* ── LA CLASSIFICATION EST BIEN CÂBLÉE DANS canAccessRecord ET LE PUT ────── */

test('canAccessRecord lit la classification AVANT la résolution de zones qui fermerait fail-closed', () => {
  const canAccessRecord = accessControl.slice(accessControl.indexOf('async function canAccessRecord'));
  const before = canAccessRecord.indexOf("storeName === 'screen_issues' && action === 'read' && isCatalogDefinition(record)");
  const zoneResolution = canAccessRecord.indexOf('const zoneIds = await resolveResourceZones');
  assert.ok(before > 0, 'le branchement catalogue doit exister dans canAccessRecord');
  assert.ok(before < zoneResolution, 'il doit intervenir avant la résolution de zones');
  /*
   * #150 blocker 1 : `roleAllows` seul ne dit que le PLAFOND du rôle, jamais l'adhésion ET
   * l'habilitation RÉELLES — un Technicien sans la moindre zone passait quand même. La
   * branche catalogue doit désormais appeler `hasEffectivePermissionSomewhere`, jamais
   * `roleAllows` seul.
   */
  const branche = canAccessRecord.slice(before, before + 700);
  assert.match(branche, /hasEffectivePermissionSomewhere\(user, 'diagnostic\.run', client\)/);
  assert.doesNotMatch(branche, /return roleAllows\(user, 'diagnostic\.run'\);/);
});

test('hasEffectivePermissionSomewhere exige adhésion ET habilitation dans LA MÊME zone, jamais deux zones distinctes', () => {
  const fn = accessControl.slice(
    accessControl.indexOf('async function hasEffectivePermissionSomewhere'),
    accessControl.indexOf('async function isZoneResponsible')
  );
  assert.ok(fn.length > 0, 'hasEffectivePermissionSomewhere doit exister');
  // Court-circuits attendus, dans le même ordre que hasPermission : néant, admin/manager, plafond.
  assert.match(fn, /if \(!user\) return false;/);
  assert.match(fn, /if \(seesEveryZone\(user\)\) return true;/);
  assert.match(fn, /if \(!roleAllows\(user, permission\)\) return false;/);
  // Réutilise activeMemberships/activeGrants — jamais de requête SQL propre, jamais de
  // zone de catalogue inventée.
  assert.match(fn, /activeMemberships\(user\.id, client\)/);
  assert.match(fn, /activeGrants\(user\.id, client\)/);
  assert.doesNotMatch(fn, /client\.query/);
  // L'intersection par ZONE n'est plus PINCÉE PAR SON TEXTE mais EXÉCUTÉE, juste en
  // dessous. Cette ligne exigeait littéralement `memberZones.has(String(item.zoneId))` :
  // elle virait au rouge dès que la règle était reformulée — quand bien même la règle
  // n'aurait pas bougé — et serait restée verte si l'on avait inversé la condition. Une
  // garde ne peut pas être aveugle à ce qu'elle prétend garder ; c'est le même remède que
  // celui déjà appliqué dans `zone-access-control.test.js`.
});

/*
 * LA MÊME EXIGENCE, JOUÉE.
 *
 * Un décor minimal : adhésion en Z1, habilitation `diagnostic.run` en Z2. Les deux listes
 * co-existent, aucune zone ne les recoupe. La permission ne doit donc être détenue NULLE
 * PART — sans quoi un Technicien lirait le catalogue de diagnostic sur la foi de deux
 * droits qui ne se rencontrent jamais.
 */
function decorDeuxZones({ memberships, grants }) {
  const enregistrements = { zone_memberships: memberships, zone_grants: grants };
  const pool = { async query(sql, params = []) {
    if (String(sql).startsWith('SELECT record_id,data')) {
      return { rows: (enregistrements[params[0]] || []).map(data => ({ data })) };
    }
    throw new Error(`Requête inattendue: ${sql}`);
  } };
  return createAccessControl(pool);
}

test('hasEffectivePermissionSomewhere : adhésion en Z1 + habilitation en Z2 ne se combinent pas', async () => {
  const technicien = { id: 'u1', role: 'technicien' };
  const habilitation = zoneId => ({ id: `G-${zoneId}`, userId: 'u1', zoneId, permission: 'diagnostic.run', status: 'active' });
  const adhesion = zoneId => ({ id: `M-${zoneId}`, userId: 'u1', zoneId, status: 'active' });

  const disjointes = decorDeuxZones({ memberships: [adhesion('Z1')], grants: [habilitation('Z2')] });
  assert.equal(await disjointes.hasEffectivePermissionSomewhere(technicien, 'diagnostic.run'), false,
    'deux droits dans deux zones différentes se sont combinés');

  // Contre-épreuve : la MÊME zone des deux côtés ouvre bien, sinon le refus ci-dessus ne
  // prouverait rien — il pourrait venir d'un décor cassé.
  const recoupees = decorDeuxZones({ memberships: [adhesion('Z1')], grants: [habilitation('Z1')] });
  assert.equal(await recoupees.hasEffectivePermissionSomewhere(technicien, 'diagnostic.run'), true,
    'adhésion ET habilitation dans la même zone devraient suffire');

  // Une adhésion sans habilitation ne suffit pas, et une habilitation sans adhésion non plus.
  const sansHabilitation = decorDeuxZones({ memberships: [adhesion('Z1')], grants: [] });
  assert.equal(await sansHabilitation.hasEffectivePermissionSomewhere(technicien, 'diagnostic.run'), false);
  const sansAdhesion = decorDeuxZones({ memberships: [], grants: [habilitation('Z1')] });
  assert.equal(await sansAdhesion.hasEffectivePermissionSomewhere(technicien, 'diagnostic.run'), false);

  // Le plafond de rôle reste en amont : le visiteur ne porte pas `diagnostic.run`, même
  // adhérent et habilité.
  const visiteur = { id: 'u1', role: 'visiteur' };
  assert.equal(await recoupees.hasEffectivePermissionSomewhere(visiteur, 'diagnostic.run'), false,
    'le plafond de rôle doit fermer avant même de regarder les zones');
});

test('hasEffectivePermissionSomewhere est exportée par la fabrique, comme hasPermission', () => {
  const retour = accessControl.slice(accessControl.lastIndexOf('return {'));
  assert.match(retour, /\bhasEffectivePermissionSomewhere\b/);
});

test('aucune nouvelle permission, aucune deuxième ACL : diagnostic.run existant gouverne la lecture', () => {
  assert.doesNotMatch(accessControl, /diagnostic\.catalog|catalog\.read|screens\.diagnose/);
  const readPermissions = accessControl.match(/const PERMISSIONS = Object\.freeze\(\[[\s\S]*?\]\);/)[0];
  assert.match(readPermissions, /'diagnostic\.run'/);
});

test('le serveur rejette l’écriture contradictoire avant toute persistance, 400 nommé', () => {
  assert.match(serve, /isContradictoryCatalogWrite\(record\)/);
  const block = serve.slice(serve.indexOf("storeName === 'screen_issues' && isContradictoryCatalogWrite"));
  assert.match(block.slice(0, 300), /INVALID_CATALOG_DEFINITION/);
  assert.match(block.slice(0, 300), /json\(res, 400,/);
  // Ce contrôle précède tout appel d'écriture réelle : aucun `compareAndWrite` ni
  // `db.save` équivalent ne doit apparaître entre le refus et son `return true`.
  const jusquauRetour = block.slice(0, block.indexOf('return true;'));
  assert.doesNotMatch(jusquauRetour, /compareAndWrite/);
});

/* ── #150 BLOCKER 2 : UNE CRÉATION EXIGE UN SCOPE EXPLICITE ET CONNU ─────── */

test('la contradiction (#118) est toujours contrôlée AVANT la validation de scope (#150)', () => {
  const contradiction = serve.indexOf("storeName === 'screen_issues' && isContradictoryCatalogWrite");
  const validationScope = serve.indexOf("INVALID_SCREEN_ISSUE_SCOPE");
  assert.ok(contradiction > 0 && validationScope > 0);
  assert.ok(contradiction < validationScope, 'la contradiction doit rester le premier refus, inchangée par #150');
});

test('un scope inconnu (ni catalog ni operational) est toujours refusé, création ou mise à jour', () => {
  const block = serve.slice(serve.indexOf("if (storeName === 'screen_issues') {\n        const SCREEN_ISSUE_SCOPES"));
  assert.match(block.slice(0, 2000), /new Set\(\['catalog', 'operational'\]\)/);
  const refusInconnu = block.slice(0, block.indexOf('if (record.scope === undefined)'));
  assert.match(refusInconnu, /!SCREEN_ISSUE_SCOPES\.has\(record\.scope\)/);
  assert.match(refusInconnu, /INVALID_SCREEN_ISSUE_SCOPE/);
  assert.match(refusInconnu, /json\(res, 400,/);
});

test('une CRÉATION (aucun `existing`) sans scope est refusée 400, jamais silencieusement acceptée', () => {
  const debut = serve.indexOf("if (record.scope === undefined) {");
  const block = serve.slice(debut, serve.indexOf("if (storeName === 'users') {", debut));
  const refusCreation = block.slice(0, block.indexOf('record.scope = ('));
  assert.match(refusCreation, /if \(!existing\)/);
  assert.match(refusCreation, /INVALID_SCREEN_ISSUE_SCOPE/);
  assert.match(refusCreation, /json\(res, 400,/);
});

test('une MISE À JOUR (`existing` présent) sans scope se normalise SANS jamais être plus permissive que isCatalogDefinition', () => {
  const debut = serve.indexOf("if (record.scope === undefined) {");
  const block = serve.slice(debut, serve.indexOf("if (storeName === 'users') {", debut));
  const normalisation = block.slice(block.indexOf('record.scope = ('));
  // Le repli lecture (isCatalogDefinition) exige : aucun attachement ET appliesToAll===true.
  // La normalisation d'écriture doit reprendre EXACTEMENT cette même condition, jamais
  // `catalog` par défaut.
  assert.match(normalisation, /!hasOperationalAttachment\(record\) && record\.appliesToAll === true/);
  assert.match(normalisation, /\? 'catalog' : 'operational'/);
  assert.doesNotMatch(normalisation, /json\(res, 400,/, 'une mise à jour existante ne doit jamais être rejetée pour scope manquant');
});

test('hasOperationalAttachment est importée dans serve.js pour la normalisation, jamais réimplémentée', () => {
  assert.match(serve, /import \{ createAccessControl, isContradictoryCatalogWrite, hasOperationalAttachment \} from '\.\/access-control\.js';/);
});

/* ── AUCUN ÉLARGISSEMENT DE diagnosis_history NI DES INCIDENTS ────────────── */

test('diagnosis_history n’entre jamais dans la classification catalogue', () => {
  const branchement = accessControl.slice(
    accessControl.indexOf("storeName === 'screen_issues' && action === 'read' && isCatalogDefinition"),
    accessControl.indexOf("const permission = permissionForRecord(storeName, record, action);")
  );
  assert.doesNotMatch(branchement, /diagnosis_history/);
});

test('la résolution de zones des screen_issues et diagnosis_history opérationnels n’a pas changé', () => {
  assert.match(accessControl, /if \(\['screen_issues','diagnosis_history'\]\.includes\(storeName\)\) \{/);
});

/* ── LE PRODUCTEUR CLIENT ─────────────────────────────────────────────────── */

test('showIssueForm classe scope depuis l’état réel de l’enregistrement, pas une hypothèse sur le formulaire', () => {
  assert.match(diagnostic, /record\.scope = hasScreenIssueAttachment\(record\) \? 'operational' : 'catalog';/);
  // L'écriture reste APRÈS le calcul, jamais avant : un enregistrement édité qui porte déjà
  // des écrans (repris par `...issue`) doit rester `operational`.
  const showIssueForm = diagnostic.slice(diagnostic.indexOf('async showIssueForm'), diagnostic.indexOf('async showGroupsManagement'));
  assert.ok(showIssueForm.indexOf('record.scope =') < showIssueForm.indexOf("db.save('screen_issues'"));
});

test('le filtre de correspondance reconnaît scope:catalog en plus d’appliesToAll', () => {
  assert.match(diagnostic, /if \(issue\.appliesToAll \|\| issue\.scope === 'catalog'\) return true;/);
});
