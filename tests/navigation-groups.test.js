import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NAVIGATION_GROUPS, FALLBACK_GROUP_ID, groupOfSection, groupSections, revealGroupOf, flattenGroups
} from '../navigation-groups.js';
import { allowedSectionsForRole } from '../navigation-contract.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];

/*
 * VINGT ENTRÉES DE MENU DEVIENNENT SIX FAMILLES.
 *
 * Mesuré avant : 20 sections empilées sans hiérarchie sur le compte administrateur, où
 * « Câbles » et « Intégrité » pèsent visuellement autant qu'« Équipements ». Sur un
 * portable, les six dernières ne s'atteignent qu'en faisant défiler une barre latérale
 * dont rien n'indique qu'elle défile.
 *
 * Le regroupement ne touche NI les permissions NI le contenu : `navigation-contract.js`
 * reste seul maître de qui voit quoi. Ces tests enferment la seule chose qui pourrait
 * causer un dommage — qu'une section disparaisse du menu.
 */

/* =================================================== la garantie : rien ne se perd */

test('pour CHAQUE rôle, toutes les sections autorisées restent affichées', () => {
  // LE TEST QUI COMPTE. Un regroupement qui égare une section la rend inatteignable à la
  // souris tout en la laissant ouverte par URL : un trou qu'on ne découvre que des mois
  // plus tard, quand quelqu'un cherche une page qu'il utilisait.
  for (const role of ROLES) {
    const autorisees = allowedSectionsForRole(role);
    const affichees = flattenGroups(groupSections(autorisees));
    assert.deepEqual([...affichees].sort(), [...autorisees].sort(),
      `rôle « ${role} » : le menu n’affiche pas exactement ses sections autorisées`);
  }
});

test('une section inconnue rejoint « Autres » au lieu de disparaître', () => {
  // Huit modules ajoutent leur section APRÈS coup. Le jour où un neuvième en ajoute une,
  // elle doit apparaître sans que personne n’ait pensé à modifier navigation-groups.js.
  const groupes = groupSections(['devices', 'planning', 'dashboard']);
  const autres = groupes.find(g => g.id === FALLBACK_GROUP_ID);
  assert.ok(autres, 'aucun groupe « Autres » : une section neuve serait perdue');
  assert.deepEqual([...autres.sections], ['planning']);
  assert.equal(groupOfSection('planning'), FALLBACK_GROUP_ID);
  // Et elle reste bien présente à plat.
  assert.ok(flattenGroups(groupes).includes('planning'));
});

test('aucun doublon, même si la source en contient', () => {
  // Les sections CONNUES sont dédoublonnées par construction : chaque groupe énumère les
  // siennes une seule fois. Ce sont les sections INCONNUES qui ont besoin de la garde —
  // elles sont reprises telles quelles dans « Autres ». Un test de mutation l'a montré en
  // survivant au retrait de la garde : la première version de ce test ne vérifiait que le
  // cas déjà protégé autrement, donc elle ne vérifiait rien.
  assert.deepEqual(flattenGroups(groupSections(['devices', 'devices', 'salles', 'devices'])),
    ['salles', 'devices']);
  assert.deepEqual(flattenGroups(groupSections(['planning', 'devices', 'planning'])),
    ['devices', 'planning']);
});

test('les groupes vides ne s’affichent pas', () => {
  // Un intertitre sans rien dessous n'apprend rien et occupe une ligne.
  const groupes = groupSections(['devices']);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].id, 'infrastructure');
});

test('les entrées vides ou absurdes sont ignorées sans casser le menu', () => {
  assert.deepEqual(flattenGroups(groupSections(['', null, undefined, '  ', 'devices'])), ['devices']);
  assert.deepEqual(groupSections([]), []);
  assert.deepEqual(groupSections(), []);
});

/* =================================================== la cohérence de la table */

test('aucune section n’appartient à deux groupes', () => {
  // Sinon elle s'afficherait deux fois, et le clic sur l'une laisserait l'autre inactive.
  const vues = new Map();
  for (const groupe of NAVIGATION_GROUPS) {
    for (const section of groupe.sections) {
      assert.ok(!vues.has(section),
        `« ${section} » est à la fois dans « ${vues.get(section)} » et « ${groupe.id} »`);
      vues.set(section, groupe.id);
    }
  }
});

test('les identifiants de groupe sont uniques et le repli n’en est pas un', () => {
  const ids = NAVIGATION_GROUPS.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(FALLBACK_GROUP_ID), '« Autres » ne doit pas être un groupe déclaré');
});

test('chaque groupe porte un titre et une icône', () => {
  for (const groupe of NAVIGATION_GROUPS) {
    assert.match(groupe.title, /\S/, `groupe « ${groupe.id} » sans titre`);
    assert.match(groupe.icon, /^fas fa-/, `groupe « ${groupe.id} » sans icône`);
  }
});

test('le menu de l’administrateur tient en six familles, pas vingt lignes plates', () => {
  // La mesure qui justifie le changement : 20 sections, 6 intertitres, 0 « Autres ».
  const groupes = groupSections(allowedSectionsForRole('admin'));
  // 21 depuis `procedures` (procedures-center.js) : la section que `navigation-groups.js`
  // avait DÉJÀ placée dans « Ingénierie » en attendant que son module existe. Le nombre
  // bouge, la promesse ne bouge pas — six familles, et rien dans « Autres ».
  assert.equal(flattenGroups(groupes).length, 21);
  assert.equal(groupes.length, 6);
  assert.ok(!groupes.some(g => g.id === FALLBACK_GROUP_ID),
    'des sections de l’administrateur sont tombées dans « Autres » : la table est incomplète');
});

test('la composition des six familles est celle arrêtée par le propriétaire', () => {
  // Elle a été donnée section par section : ce test la relit, pour qu'un déplacement
  // involontaire — « Journal » qui repasserait sous Contrôle, « Localisations » qui
  // retournerait dans Infrastructure — se voie immédiatement.
  const attendu = {
    apercu: ['dashboard', 'exploitation'],
    infrastructure: ['salles', 'baies', 'devices', 'cables'],
    signal: ['continuity', 'signalFlow', 'walls', 'screensDiagnostic'],
    ingenierie: ['diagrams', 'knowledge', 'procedures'],
    operations: ['tickets', 'reports', 'logs'],
    administration: ['users', 'zoneAccess', 'locations', 'integrity', 'settings']
  };
  const obtenu = Object.fromEntries(
    groupSections(allowedSectionsForRole('admin')).map(g => [g.id, [...g.sections]]));
  assert.deepEqual(obtenu, attendu);
});

/* =================================================== le rendu */

test('le menu rendu garde le contrat DOM dont dépendent les autres modules', () => {
  // `ticket-nav-fix.js` et `french-ui-guard.js` cherchent `.sidebar-menu a[data-section]`.
  // Les intertitres sont des <button>, jamais des <a> : ils ne peuvent donc pas être pris
  // pour des sections par ces sélecteurs.
  const ui = lire('admin-ui.js');
  assert.match(ui, /data-section="\$\{key\}"/);
  assert.match(ui, /href="#\/\$\{key\}"/);
  assert.match(ui, /<button class="nav-group-header"/);
  assert.doesNotMatch(ui, /<a[^>]*class="nav-group-header"/);
});

/* =================================================== le repli ne cache pas la page ouverte */

test('ouvrir une section déplie son groupe, et oublie le repli', () => {
  // MESURÉ DANS LE NAVIGATEUR, et c'est ainsi que ce défaut a été trouvé : en arrivant sur
  // `#/devices` avec « Infrastructure » replié, la page s'ouvrait mais son entrée de menu
  // restait cachée — plus rien n'indiquait où l'on se trouvait.
  //
  // La première version de ce test se contentait de chercher `groupOfSection(...)` dans le
  // source. Elle passait au vert PENDANT que le défaut était bien présent : une règle qu'un
  // test ne peut pas EXÉCUTER n'est pas une règle vérifiée.
  const replies = new Set(['infrastructure', 'operations']);
  const apres = revealGroupOf(replies, 'devices');
  assert.equal(apres.has('infrastructure'), false, '« devices » reste caché dans un groupe replié');
  assert.equal(apres.has('operations'), true, 'les autres groupes ne doivent pas s’ouvrir seuls');
  // La source n'est pas modifiée : l'appelant décide quand mémoriser.
  assert.equal(replies.has('infrastructure'), true);
});

test('le repli mémorisé et le repli affiché ne peuvent pas diverger', () => {
  // Contredire temporairement un repli sans l'oublier ferait se replier le menu tout seul
  // plus tard, sans que l'utilisateur ait rien demandé.
  const ui = lire('admin-ui.js');
  const rendu = ui.slice(ui.indexOf('renderMenuGroups()'), ui.indexOf('revealSectionInMenu'));
  assert.match(rendu, /revealGroupOf\(this\.readCollapsedGroups\(\), this\.currentSection\)/);
  assert.match(rendu, /this\.writeCollapsedGroups\(replies\)/);
  // Et la navigation, elle aussi, révèle la section : le menu est construit AVANT que la
  // route ne soit lue, donc le rendu seul ne peut pas suffire.
  assert.match(ui, /this\.revealSectionInMenu\(section\);/);
});

test('révéler une section d’un groupe déjà ouvert ne change rien', () => {
  const replies = new Set(['operations']);
  assert.deepEqual([...revealGroupOf(replies, 'devices')], ['operations']);
  // Une section inconnue vise « Autres », qui n'est jamais replié par la table.
  assert.deepEqual([...revealGroupOf(new Set(['infrastructure']), 'planning')], ['infrastructure']);
});
