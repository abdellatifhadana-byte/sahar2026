import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PermissionManager } from '../permissions.js';
import { allowedSectionsForRole } from '../navigation-contract.js';
import { createAccessControl } from '../scripts/access-control.js';

/** Une base vide suffit : la garde des réglages tranche avant toute résolution de zone. */
const poolVide = () => {
  const client = { async query() { return { rows: [] }; }, release() {} };
  return { ...client, connect: async () => client };
};

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const peut = (role, entite, action) => PermissionManager.check({ role, id: 1 }, entite, action);

/*
 * LA CARTE, ET QUI A LE DROIT D'Y TOUCHER.
 *
 * Deux règles posées par le propriétaire de la plateforme :
 *   1. le visiteur ne doit pas voir tous les détails ;
 *   2. c'est l'ADMINISTRATEUR qui ajoute l'image du plan et les photos.
 *
 * Ces tests les rendent exécutables, parce qu'elles étaient tenues par trois gardes séparées
 * — la matrice client, le contrat de navigation, le contrôle d'accès serveur — et que la
 * troisième ne disait pas la même chose que les deux autres.
 */

/* =========================================== 1. le visiteur ne modifie pas la carte */

test('seuls admin, manager et chef peuvent modifier la carte', () => {
  // La barre d'édition — mode édition, ajouter une salle, ajouter une baie, verrouiller,
  // enregistrer — n'est rendue par `interactive-map.js` que si `rooms.edit` est vrai.
  const editeurs = ROLES.filter(role => peut(role, 'rooms', 'edit'));
  assert.deepEqual(editeurs, ['admin', 'manager', 'chef']);
  for (const role of ['responsible', 'technician', 'visitor']) {
    assert.equal(peut(role, 'rooms', 'edit'), false, `« ${role} » peut modifier la carte`);
  }
});

test('la barre d’édition de la carte est bien conditionnée à cette permission', () => {
  // Si le gabarit cessait d'être conditionnel, le visiteur verrait les boutons — et
  // `map-admin-entity-edit.js`, qui se contente de vérifier la PRÉSENCE du bouton,
  // déverrouillerait le menu contextuel « modifier / déplacer / supprimer » avec.
  const carte = lire('interactive-map.js');
  /*
   * CE QUI A CHANGÉ ICI, ET POURQUOI C'EST PLUS STRICT.
   *
   * La carte s'appuyait sur UN booléen — `canManageMap = rooms.edit` — pour autoriser six
   * actes sur trois types. L'épreuve exigeait donc littéralement ce booléen. Elle exige
   * désormais la table d'actes qui le remplace : chaque outil sous SON acte, sur SON type.
   * Un retour au booléen global ferait tomber cette ligne.
   */
  assert.match(carte, /const droitsCarte = mapAbilities\(user\)/,
    'la carte doit dériver ses droits de la matrice canonique, acte par acte');
  assert.doesNotMatch(carte, /const canManageMap\s*=/,
    'aucun booléen global ne doit redevenir l’autorité de la carte');

  // Borner la tranche sur la BARRE D'OUTILS elle-même, entre le dernier bouton public
  // (plein écran) et le premier qui la suit (fermer). Une première version bornait sur un
  // `id="map-legend"` qui n'existe pas : `indexOf` rendait -1, la tranche courait jusqu'à la
  // fin du fichier, et les TROIS autres blocs conditionnels de la carte la satisfaisaient.
  // Un test de mutation y a survécu — la barre pouvait devenir inconditionnelle sans que
  // rien ne le dise.
  const debut = carte.indexOf('id="fullscreen-btn"');
  const fin = carte.indexOf('id="close-map"');
  assert.ok(debut > 0 && fin > debut, 'les bornes de la barre d’outils sont fausses');
  const barre = carte.slice(debut, fin);
  assert.ok(barre.length < 2000, `tranche trop large (${barre.length}) : elle déborde de la barre`);

  assert.match(barre, /\$\{peutEditerCarte \? `/, 'la barre d’édition n’est plus conditionnelle');
  for (const bouton of ['edit-mode-btn', 'add-room-btn', 'add-baie-btn', 'lock-btn', 'save-all-btn']) {
    assert.ok(barre.includes(bouton), `« ${bouton} » est sorti de la zone conditionnelle`);
  }
  // Et, À L'INTÉRIEUR de la barre, créer une salle et créer une baie ont chacun leur acte :
  // `create`, pas l'édition d'un autre type. Le Chef les garde, le Responsable ne les a pas.
  assert.match(barre, /\$\{droitsCarte\.room\.create \?[^}]*add-room-btn/,
    '« Ajouter une salle » doit dépendre de rooms.create');
  assert.match(barre, /\$\{droitsCarte\.baie\.create \?[^}]*add-baie-btn/,
    '« Ajouter une baie » doit dépendre de baies.create');
  // Et les boutons publics restent HORS de la condition : zoom et plein écran servent à tous.
  const publique = carte.slice(carte.indexOf('id="map-search"'), debut);
  assert.doesNotMatch(publique, /peutEditerCarte|droitsCarte/, 'un contrôle public est passé sous condition');
});

/* =========================================== 2. l'image du plan appartient à l'admin */

test('configurer la plateforme est réservé à l’administrateur, côté client', () => {
  assert.equal(peut('admin', 'system', 'configure'), true);
  for (const role of ROLES.filter(r => r !== 'admin')) {
    assert.equal(peut(role, 'system', 'configure'), false, `« ${role} » peut configurer`);
  }
});

test('la section « Paramètres » n’est ouverte qu’à l’administrateur', () => {
  assert.ok(allowedSectionsForRole('admin').includes('settings'));
  for (const role of ROLES.filter(r => r !== 'admin')) {
    assert.ok(!allowedSectionsForRole(role).includes('settings'),
      `« ${role} » a la section Paramètres`);
  }
});

test('le SERVEUR, EXÉCUTÉ, refuse l’écriture des réglages à tout autre que l’admin', async () => {
  // Vérifier le source ne suffit pas : c'est la règle appliquée qui compte. Un faux pool
  // suffit — la décision sur `settings` tombe avant toute requête.
  const { createAccessControl } = await import('../scripts/access-control.js');
  const access = createAccessControl({ query: async () => ({ rows: [] }) });
  const reglages = { id: 'global', mapImageUrl: 'data:image/png;base64,AAAA' };

  assert.equal(await access.canAccessRecord({ role: 'admin', id: 1 }, 'settings', reglages, 'write'), true,
    'l’administrateur doit pouvoir changer l’image du plan');
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(await access.canAccessRecord({ role, id: 1 }, 'settings', reglages, 'write'), false,
      `« ${role} » peut encore écrire les réglages, donc remplacer le plan technique`);
    // …mais tout le monde les LIT, sinon le plan n'atteint personne.
    assert.equal(await access.canAccessRecord({ role, id: 1 }, 'settings', reglages, 'read'), true,
      `« ${role} » ne reçoit plus les réglages, donc plus le plan technique`);
  }
});

test('la garde serveur refuse vraiment le manager', async () => {
  // LE DÉFAUT CORRIGÉ. Le manager n'a ni `system.configure` ni la section « Paramètres » :
  // aucun écran ne lui propose de changer l'image du plan. Le serveur, lui, l'acceptait,
  // parce qu'il court-circuitait sur « admin OU manager » avant d'examiner le magasin.
  // Un manager pouvait donc remplacer le plan technique et les réglages globaux par appel
  // direct à l'API. Trois gardes, dont une qui ne disait pas la même chose que les deux
  // autres — c'est exactement ainsi qu'un droit se glisse sans que personne ne l'ait voulu.
  // CETTE GARDE EST DÉSORMAIS EXÉCUTÉE, PAS LUE.
  //
  // Elle cherchait le texte exact `user.role !== 'admin'` et comparait deux positions dans
  // le fichier. Elle prouvait donc qu'une PHRASE existait avant une autre — jamais que le
  // manager était refusé. Un test qui exécute la décision est strictement plus fort : il
  // survit à toute réécriture qui préserve le comportement, et tombe sur toute réécriture
  // qui ne le préserve pas.
  const access = createAccessControl(poolVide());
  const reglages = { id: 'global', mapImageUrl: 'plan.png' };
  assert.equal(await access.canAccessRecord({ id: 1, role: 'admin' }, 'settings', reglages, 'write'), true);
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(await access.canAccessRecord({ id: 2, role }, 'settings', reglages, 'write'), false,
      `« ${role} » peut remplacer le plan technique par appel direct à l'API`);
  }
});

test('mais la LECTURE des réglages reste ouverte à tous', () => {
  // Le plan technique et le délai de déconnexion sont une politique, pas une donnée privée.
  // Les fermer en lecture reviendrait à ce que l'administrateur soit seul à les recevoir.
  const source = lire('scripts/access-control.js');
  assert.match(source, /if \(storeName === 'settings'\) return action === 'read'/);
  // La garde ne ferme QUE l'écriture : elle nomme explicitement `action !== 'read'`.
  assert.match(source, /storeName === 'settings' && action !== 'read'/);
});

/* =========================================== 3. ce que le visiteur voit quand même */

test('le visiteur garde la lecture de ce dont il a besoin', () => {
  // « Ne pas voir tous les détails » ne veut pas dire « ne rien voir » : le visiteur navigue
  // visuellement, ouvre une salle, une baie, un équipement. C'est le serveur qui filtre les
  // enregistrements un par un dans `/api/sync`, pas l'interface.
  assert.equal(peut('visitor', 'equipments', 'view'), true);
  assert.equal(peut('visitor', 'walls', 'view'), true);
  // Mais il ne modifie rien.
  for (const entite of ['rooms', 'baies', 'equipments', 'walls']) {
    assert.equal(peut('visitor', entite, 'edit'), false, `le visiteur peut modifier « ${entite} »`);
  }
});
