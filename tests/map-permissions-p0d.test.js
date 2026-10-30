/**
 * @file tests/map-permissions-p0d.test.js — P0-D1b : la carte interroge la matrice
 *       canonique acte par acte, type par type — et non plus un booléen unique.
 *
 * Deux natures d'épreuves, et c'est délibéré :
 *
 *   · le CONTRAT (`map-permissions-contract.js`) est pur — on l'exécute pour de vrai ;
 *   · le CÂBLAGE DOM d'`interactive-map.js` n'est pas isolable (1700 lignes, `document`,
 *     `db`, `fetch`) : on l'ancre sur des expressions nommées, comme le fait déjà
 *     `map-coordinate-edit-wiring-p0b.test.js`. Un test de source ne vaut que par ce qu'il
 *     rendrait ROUGE : chaque assertion ci-dessous tombe si la garde correspondante saute.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapAbilities, mapCan, MAP_TYPE_TO_ENTITY } from '../map-permissions-contract.js';

const source = readFileSync(new URL('../interactive-map.js', import.meta.url), 'utf8');

const U = role => ({ id: `u-${role}`, role });

/* ═══════════ le contrat pur : la table d'actes, rôle par rôle ═══════════ */

/*
 * Recopiée de `permissions.js`, pas déduite du module testé — sinon l'épreuve ne
 * comparerait le code qu'à lui-même.
 */
const ATTENDU = {
  admin:       { room: [1,1,1], baie: [1,1,1], equipment: [1,1,1] },
  manager:     { room: [1,1,1], baie: [1,1,1], equipment: [1,1,1] },
  chef:        { room: [1,1,0], baie: [1,1,0], equipment: [1,1,0] },
  responsible: { room: [0,0,0], baie: [0,0,0], equipment: [1,1,0] },
  technician:  { room: [0,0,0], baie: [0,0,0], equipment: [0,0,0] },
  visitor:     { room: [0,0,0], baie: [0,0,0], equipment: [0,0,0] }
};

for (const [role, parType] of Object.entries(ATTENDU)) {
  test(`MP·${role} — create / edit / delete suivent exactement la matrice`, () => {
    const droits = mapAbilities(U(role));
    for (const [type, [creer, editer, supprimer]] of Object.entries(parType)) {
      assert.equal(droits[type].create, Boolean(creer), `${role} · ${type}.create`);
      assert.equal(droits[type].edit, Boolean(editer), `${role} · ${type}.edit`);
      assert.equal(droits[type].delete, Boolean(supprimer), `${role} · ${type}.delete`);
    }
  });
}

test('MP·chef — édite les trois types, n’en supprime aucun', () => {
  const chef = U('chef');
  for (const type of ['room', 'baie', 'equipment']) {
    assert.equal(mapCan(chef, type, 'edit'), true, `le chef doit éditer ${type}`);
    assert.equal(mapCan(chef, type, 'delete'), false, `le chef ne doit pas supprimer ${type}`);
  }
});

test('MP·responsable — l’équipement lui revient, la salle et la baie non', () => {
  const resp = U('responsible');
  assert.equal(mapCan(resp, 'equipment', 'edit'), true,
    'la matrice lui donne equipments.edit : la carte doit le lui rendre — c’est ce que le booléen global lui retirait');
  assert.equal(mapCan(resp, 'room', 'edit'), false);
  assert.equal(mapCan(resp, 'baie', 'edit'), false);
  assert.equal(mapCan(resp, 'equipment', 'delete'), false);
});

test('MP·anyEdition — vrai pour qui détient au moins un acte, faux pour le visiteur', () => {
  for (const role of ['admin', 'manager', 'chef', 'responsible']) {
    assert.equal(mapAbilities(U(role)).anyEdition, true, `${role} doit atteindre le mode édition`);
  }
  for (const role of ['technician', 'visitor']) {
    assert.equal(mapAbilities(U(role)).anyEdition, false, `${role} ne doit pas l’atteindre`);
  }
});

test('MP·type inconnu ou acte inconnu — refus, jamais un oui par défaut', () => {
  const admin = U('admin');
  assert.equal(mapCan(admin, 'cable', 'edit'), false, 'un type que la matrice ne gouverne pas se refuse');
  assert.equal(mapCan(admin, 'room', 'teleport'), false);
  assert.equal(mapCan(null, 'room', 'edit'), false, 'sans utilisateur, aucun acte');
  assert.equal(mapCan({ role: 'inconnu' }, 'room', 'edit'), false, 'un rôle inconnu retombe sur visiteur');
});

test('MP·la table des types couvre salle, baie, équipement et mur', () => {
  assert.deepEqual(MAP_TYPE_TO_ENTITY,
    { room: 'rooms', baie: 'baies', equipment: 'equipments', wall: 'walls' });
});

/* ═══════════ le câblage : ce que la carte fait réellement de ces droits ═══════════ */

test('MP·câblage — aucun booléen global ne fait plus autorité', () => {
  assert.doesNotMatch(source, /const canManageMap\s*=/,
    'le booléen unique ne doit pas revenir : il autorisait six actes sur trois types');
  assert.match(source, /const droitsCarte = mapAbilities\(user\)/);
});

test('MP·câblage — deleteItem VÉRIFIE la permission avant de supprimer', () => {
  /*
   * LA LIGNE QUI COMPTE LE PLUS. `deleteItem` ne vérifiait que `locked` : sa seule autre
   * barrière était l'affichage d'un bouton. Cacher un bouton n'est pas une autorisation.
   */
  const debut = source.indexOf('async function deleteItem');
  assert.ok(debut > 0, 'deleteItem introuvable');
  const corps = source.slice(debut, debut + 1400);
  const gardeDelete = corps.indexOf("mapCan(user, type, 'delete')");
  const premiereSuppression = corps.indexOf('deleteRoomSafely');
  assert.ok(gardeDelete > 0, 'deleteItem doit interroger mapCan(user, type, "delete")');
  assert.ok(premiereSuppression > 0 && gardeDelete < premiereSuppression,
    'la garde doit précéder toute suppression, jamais la suivre');
});

test('MP·câblage — création et dessin passent par leur propre acte', () => {
  const addNew = source.slice(source.indexOf('function addNewItem'), source.indexOf('function changeImage'));
  assert.match(addNew, /mapCan\(user, type, 'create'\)/, 'addNewItem doit exiger create');
  const editArea = source.slice(source.indexOf('function editArea'), source.indexOf('function resizeArea'));
  assert.match(editArea, /mapCan\(user, type, 'edit'\)/, 'editArea doit exiger edit');
  const changeImage = source.slice(source.indexOf('function changeImage'), source.indexOf('async function deleteItem'));
  assert.match(changeImage, /mapCan\(user, type, 'edit'\)/, 'changeImage doit exiger edit');
});

test('MP·câblage — le menu contextuel n’offre que les actes permis', () => {
  const menu = source.slice(source.indexOf('const ACTE_DU_MENU'), source.indexOf('function hideContextMenu'));
  assert.match(menu, /delete:\s*'delete'/, '« Supprimer » doit relever de delete, pas d’edit');
  for (const acte of ['edit', 'move', 'resize', "'change-image'"]) {
    assert.ok(menu.includes(acte), `l’entrée ${acte} doit être classée`);
  }
  assert.match(menu, /item\.hidden = !permis/, 'une entrée non permise doit être retirée du menu');
  assert.match(menu, /if \(!offertes\) return;/, 'aucun acte permis : pas de menu du tout');
});

test('MP·câblage — le glisser-déposer d’un équipement suit equipments.edit', () => {
  // C'était `rooms.edit` : le Responsable, qui détient equipments.edit, ne pouvait pas
  // déplacer un équipement, et le Chef le pouvait par la porte des salles.
  const occurrences = source.match(/draggable:\s*droitsCarte\.equipment\.edit/g) || [];
  assert.equal(occurrences.length, 2, 'les deux scènes — salle et baie — doivent suivre equipments.edit');
});

test('MP·câblage — les formes suivent leur type ET n’existent qu’en mode édition', () => {
  // Une forme est du CHROME D'ÉDITION : en consultation elle n'a rien à faire sur le plan.
  // La garde porte donc deux conditions, et l'épreuve exige les deux.
  assert.match(source, /if \(modeEdition && droitsCarte\.room\.edit\) rooms\.forEach\(room => drawEntityShape/);
  assert.match(source, /if \(droitsCarte\.baie\.edit\) baies\.forEach\(baie => drawEntityShape/,
    'les formes de baie restent gardées par baies.edit');
  assert.match(source, /if \(modeEdition && droitsCarte\.room\.edit\) drawEntityShape\(room/,
    'la forme de la salle, dans sa propre scène, suit la même règle');
  assert.match(source, /if \(modeEdition && droitsCarte\.baie\.edit\) drawEntityShape\(baie/,
    'idem pour la forme de la baie dans sa scène');
});

test('MP·câblage — un bouton CONDITIONNEL est câblé sous la MÊME condition', () => {
  /*
   * LE DÉFAUT QUE LA RECETTE NAVIGATEUR A TROUVÉ, ET QU'AUCUNE ÉPREUVE DE SOURCE N'AVAIT VU.
   *
   * « Ajouter une salle » et « Ajouter une baie » sont rendus sous `room.create` /
   * `baie.create`, mais leur câblage était inconditionnel :
   *
   *     document.getElementById('add-room-btn').onclick = …
   *
   * Le Responsable est le SEUL rôle qui atteint le mode édition sans pouvoir créer : il
   * tombait donc sur `null.onclick`. L'exception remontait au `.catch()` du chargement,
   * qui affiche « Accès restreint » — un rôle parfaitement autorisé se voyait refuser la
   * carte à cause d'un bouton absent, et sans la moindre erreur en console.
   *
   * La règle : ce qui est rendu sous condition se câble sous condition.
   */
  const wiring = source.slice(source.indexOf('if (peutEditerCarte) {'), source.indexOf("document.getElementById('lock-btn')"));
  for (const bouton of ['add-room-btn', 'add-baie-btn']) {
    assert.doesNotMatch(wiring, new RegExp(`getElementById\\('${bouton}'\\)\\.onclick`),
      `« ${bouton} » est conditionnel : son câblage ne doit pas supposer sa présence`);
    assert.match(wiring, new RegExp(`getElementById\\('${bouton}'\\)\\?\\.`),
      `« ${bouton} » doit être câblé par accès optionnel`);
  }
});
