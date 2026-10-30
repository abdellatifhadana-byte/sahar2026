import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const acces = lire('scripts/access-control.js');
const serveur = lire('scripts/serve.js');

/*
 * @file SCREEN-GROUP-ZONE-01 — #119.
 *
 * L'épreuve qui PROUVE la fermeture est `scripts/screen-group-zone-e2e.mjs` : il faut le vrai
 * serveur, la vraie base et la vraie sérialisation pour établir qu'un identifiant d'écran ne
 * traverse plus une frontière de zone.
 *
 * Ce fichier-ci défend ce que l'exécution ne montre pas : l'ORDRE. Le défaut de #119 n'était
 * pas une règle absente, c'était une règle placée trop tard — après le repli générique
 * `record.roomId`. Une réécriture qui remonterait ce repli rendrait le code de nouveau
 * vulnérable sans qu'aucune assertion de comportement ne change de place.
 */

test('#119 — le groupe d’écrans est résolu AVANT le repli générique `record.roomId`', () => {
  const groupe = acces.indexOf("if (storeName === 'screen_groups') {");
  const repli = acces.indexOf('if (record.roomId !== undefined && record.roomId !== null) return zonesForRoom(');
  assert.ok(groupe > 0, 'la branche des groupes d’écrans doit exister');
  assert.ok(repli > 0, 'le repli générique doit exister');
  assert.ok(groupe < repli,
    'placée après le repli, la branche ne serait jamais atteinte : le groupe se résoudrait sur sa seule salle');
});

test('#119 — la résolution lit la salle ET chaque écran référencé', () => {
  const bloc = acces.slice(acces.indexOf("if (storeName === 'screen_groups') {"));
  const branche = bloc.slice(0, bloc.indexOf('\n    }\n') + 6);
  assert.match(branche, /zonesForRoom\(record\.roomId, client\)/);
  assert.match(branche, /record\.screenIds/);
  assert.match(branche, /resolveResourceZones\('screens', screen, client, depth \+ 1\)/,
    'chaque écran repasse par le même contrat, pas par un second résolveur');
});

test('#119 — un écran référencé introuvable ferme le groupe au lieu d’être ignoré', () => {
  const bloc = acces.slice(acces.indexOf("if (storeName === 'screen_groups') {"));
  const branche = bloc.slice(0, bloc.indexOf('\n    }\n') + 6);
  assert.match(branche, /if \(!screen\) return \[\];/,
    'ignorer l’écran laisserait le groupe résolu sur la seule salle — exactement le défaut de #119');
});

test('#119 — un groupe à cheval sur plusieurs zones exige TOUTES ses zones', () => {
  assert.match(acces, /const groupeEnConflit = storeName === 'screen_groups' && zoneIds\.length > 1;/);
  const retour = acces.slice(acces.indexOf("return action !== 'read' || criticalCrossZoneDocument"));
  assert.match(retour.slice(0, 220), /groupeEnConflit/,
    'sans cela la lecture ordinaire se contenterait d’UNE zone accordée et servirait le groupe entier');
  assert.match(retour.slice(0, 260), /decisions\.every\(Boolean\)/);
});

test('#119 — l’écriture est validée avant le court-circuit du privilège global', () => {
  // `if (!isPlatformAdmin(...))` apparaît plusieurs fois dans le fichier : seule compte
  // celle du MÊME gestionnaire, donc la première qui SUIT la garde.
  const validation = serveur.indexOf('record = await assertScreenGroupScope(record, existing);');
  assert.ok(validation > 0, 'la garde d’écriture doit exister');
  const courtCircuit = serveur.indexOf('if (!isPlatformAdmin(user.role)) {', validation);
  assert.ok(courtCircuit > validation,
    'placée après le court-circuit, la garde laisserait l’administrateur et le manager persister '
    + 'une structure contradictoire que plus personne de scopé ne pourrait lire');
});

test('#119 — la garde d’écriture refuse par un code de contrat, sans second résolveur', () => {
  const bloc = serveur.slice(serveur.indexOf('async function assertScreenGroupScope'));
  const fonction = bloc.slice(0, bloc.indexOf('\n}\n') + 3);
  assert.match(fonction, /connectivityError\('INVALID_SCREEN_GROUP_SCOPE', errors\)/);
  assert.match(fonction, /access\.resolveResourceZones\('screens', screen\)/);
  assert.match(fonction, /introuvable/, 'un écran inconnu doit être nommé dans le refus');
  // `screenIds` vide reste une forme légitime : `deleteScreenSafely` peut la produire.
  assert.match(fonction, /if \(!screenIds\.length\) \{/);
});

/*
 * PASSE 2 — CE QUE LA PREMIÈRE VERSION LAISSAIT PASSER
 *
 * La branche des groupes était posée APRÈS le court-circuit `direct`/`mapped`. Elle n'était
 * donc atteinte que pour un groupe SANS revendication de zone, et trois contournements
 * restaient vivants. L'ORDRE est ici l'invariant : aucune assertion de comportement ne
 * changerait si on le défaisait.
 */
test('#119 — la branche des groupes précède le court-circuit `direct`/`mapped`', () => {
  const groupe = acces.indexOf("if (storeName === 'screen_groups') {");
  const direct = acces.indexOf('const direct = unique([...(Array.isArray(record.zoneIds)');
  assert.ok(groupe > 0 && direct > 0);
  assert.ok(groupe < direct,
    'placée après, la branche est sautée dès que le groupe porte `zoneId`, `zoneIds` ou un '
    + 'mapping `resource_zones` — les trois contournements mesurés sur `be5f549`');
});

test('#119 — une salle déclarée mais irrésolvable ferme le groupe', () => {
  const bloc = acces.slice(acces.indexOf("if (storeName === 'screen_groups') {"));
  const branche = bloc.slice(0, bloc.indexOf('\n    }\n') + 6);
  assert.match(branche, /if \(!zonesSalle\.length\) return \[\];/,
    'sinon une salle fantôme est traitée comme une salle absente');
  assert.match(branche, /if \(!zonesEcran\.length\) return \[\];/,
    'un écran sans rattachement ne doit pas être couvert par la zone de la salle');
});

test('#119 — l’écriture refuse une revendication de zone introduite ou modifiée', () => {
  const bloc = serveur.slice(serveur.indexOf('async function assertScreenGroupScope'));
  const fonction = bloc.slice(0, bloc.indexOf('\n}\n') + 3);
  assert.match(fonction, /for \(const champ of \['zoneId', 'zoneIds'\]\)/);
  assert.match(fonction, /n'est pas une source d'autorisation pour ce type/);
  // Le report à l'identique reste permis : `deleteScreenSafely` réenregistre `{...g}`.
  assert.match(fonction, /propose === connu/,
    'refuser un report identique empêcherait de retirer un écran d’un groupe hérité');
  assert.match(fonction, /déclarée par ce groupe est introuvable/);
});
