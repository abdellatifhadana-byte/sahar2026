import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowedSectionsForRole } from '../navigation-contract.js';
import { NAVIGATION_GROUPS } from '../navigation-groups.js';
import { PermissionManager } from '../permissions.js';

const racine = new URL('../', import.meta.url);
const lire = fichier => fs.readFileSync(new URL(fichier, racine), 'utf8');
const source = lire('procedures-center.js');
const pont = lire('equipment-360-engineering-links.js');

/* ─────────────────────────── la place dans le menu */

test('la section occupe la place que « Ingénierie » lui réservait déjà', () => {
  // `navigation-groups.js` déclarait `procedures` AVANT que le module existe, précisément
  // pour qu'il atterrisse ici plutôt que dans « Autres » le jour de son arrivée.
  const ingenierie = NAVIGATION_GROUPS.find(groupe => groupe.id === 'ingenierie');
  assert.ok(ingenierie, 'le groupe « Ingénierie » a disparu');
  assert.ok(ingenierie.sections.includes('procedures'));
});

test('le contrat ouvre la section aux rôles qui possèdent `continuity {view}`, et à eux seuls', () => {
  // La section lit des documents `continuity_procedure` : elle ne peut pas être accordée
  // plus largement que la permission qui gouverne ces documents. Ce test lie les deux, pour
  // qu'un élargissement de route sans permission — ou l'inverse — se voie immédiatement.
  for (const role of ['admin', 'manager', 'chef', 'responsible']) {
    assert.ok(PermissionManager.check({ role }, 'continuity', 'view'),
      `${role} devrait posséder continuity{view}`);
    assert.ok(allowedSectionsForRole(role).includes('procedures'),
      `${role} devrait recevoir la route « procedures »`);
  }
  // Le visiteur n'a pas la permission : il ne doit pas avoir la route non plus.
  assert.ok(!PermissionManager.check({ role:'visitor' }, 'continuity', 'view'));
  assert.ok(!allowedSectionsForRole('visitor').includes('procedures'));
  // Le technicien LIT la continuité mais n'écrit pas : sa coque n'a pas de section — il
  // reçoit un bouton, ce que vérifie le test suivant.
  assert.ok(PermissionManager.check({ role:'technician' }, 'continuity', 'view'));
  assert.ok(!PermissionManager.check({ role:'technician' }, 'continuity', 'create'));
  assert.ok(!allowedSectionsForRole('technician').includes('procedures'));
});

test('la section s’enregistre sur les deux coques qui la déclarent', () => {
  assert.match(source, /AdminUI\.prototype\.initSections/);
  assert.match(source, /ResponsibleUI\.prototype\.renderBaseLayout/);
  // Le drapeau de patch évite la double pose quand le module est importé deux fois.
  assert.match(source, /Symbol\.for\('2m-tech\.procedures-center\.patched'\)/);
});

test('le bouton du technicien est conditionné à sa permission, pas à son rôle', () => {
  // Un bouton posé sans vérification aurait ouvert la bibliothèque à un technicien à qui la
  // matrice retire `continuity{view}` — la matrice doit rester seule juge.
  const bloc = source.slice(source.indexOf('TechUISmart.prototype.bindGlobalActions'));
  assert.match(bloc, /PermissionManager\.check\(this\.user, 'continuity', 'view'\)/);
});

/* ─────────────────────────── ce que le lot s'interdit */

test('aucune ACL n’est créée ni élargie par ce lot', () => {
  // Les seules permissions consultées sont celles qui existaient : `continuity` view/create.
  const appels = [...source.matchAll(/PermissionManager\.check\([^)]*'([a-zA-Z]+)'\s*,\s*'([a-zA-Z]+)'\)/g)]
    .map(trouve => `${trouve[1]}.${trouve[2]}`);
  assert.deepEqual([...new Set(appels)].sort(), ['continuity.create', 'continuity.view']);
});

test('le plafond de rôle NE SUFFIT PAS : l’autorité de zone est exigée en plus', () => {
  /*
   * Le défaut que ce contrat ferme, mesuré côte à côte sur le compte `ui-chef` : plafond
   * `continuity {view, create}` mais AUCUN grant `continuity.read` sur une zone. Le serveur
   * ne lui servait rien, et la section lui montrait une liste vide plus un bouton de
   * création dont la seule issue était un conseil inapplicable. `diagram-studio.js`, lui,
   * refusait proprement. Les deux verrous sont donc désormais exigés, comme chez le voisin.
   */
  assert.match(source, /canView\(\)\s*\{\s*return this\.roleAllowsView\(\)\s*&&\s*\(this\.isGlobalAdmin\(\)\s*\|\|\s*this\.zoneIdsWith\('continuity\.read'\)\.size > 0\)/);
  assert.match(source, /zoneIdsWith\('continuity\.edit'\)\.size > 0/);
  // L'autorité vient du serveur, jamais d'une déduction locale.
  assert.match(source, /api\('\/api\/access\/context'\)/);
  // Injoignable → on se ferme. Un `catch` qui rendrait des zones ouvrirait tout.
  assert.match(source, /catch\(\(\) => \(\{ zones:\[\] \}\)\)/);
});

test('les deux refus disent des causes DIFFÉRENTES, parce qu’elles le sont', () => {
  // « Votre rôle » se répare en changeant de rôle ; « aucune de vos zones » se répare en
  // demandant une habilitation. Un message unique enverrait la moitié des gens au mauvais
  // endroit — et une liste vide n'aurait dit ni l'un ni l'autre.
  assert.match(source, /Votre rôle ne donne pas accès aux procédures/);
  assert.match(source, /Aucune de vos zones ne vous accorde la lecture de la continuité/);
  assert.match(source, /<code>continuity\.read<\/code>/);
});

test('l’autorité de zone est chargée AVANT d’être interrogée', () => {
  // `canView()` dépend de `this.access`. L'interroger avant `loadAccess()` refuserait tout
  // le monde sauf l'administrateur global — un faux refus, aussi trompeur que la fausse
  // liste vide qu'on vient de supprimer.
  // On compare des INSTRUCTIONS, pas du texte : les commentaires de ces deux fonctions
  // citent `canView()` en prose, et une comparaison naïve d'index les prendrait pour du code.
  const sansCommentaires = texte => texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const rendu = sansCommentaires(source.slice(source.indexOf('async render()'), source.indexOf('async afterRender')));
  assert.ok(rendu.indexOf('await this.loadAccess()') < rendu.indexOf('this.canView()'),
    'le contexte d’accès doit être chargé avant la décision, dans render()');

  const parId = sansCommentaires(source.slice(source.indexOf('export async function openProcedureById'),
    source.indexOf('export async function openProceduresLibrary')));
  assert.ok(parId.indexOf('loadAccess') < parId.indexOf('canView()'),
    'openProcedureById doit charger l’autorité avant de décider');
});

test('la création respecte le contrat serveur au lieu de le contourner', () => {
  // `validateContinuityRecord` exige un `protectionGroupId` ET des zones. Le formulaire ne
  // doit ni inventer les zones ni laisser l'auteur les déclarer : elles viennent du groupe.
  assert.match(source, /validateContinuityRecord/);
  assert.match(source, /zoneIds\s*=\s*Array\.isArray\(groupe\?\.zoneIds\)/);
  assert.doesNotMatch(source, /zoneIds:\s*\[[^\]]*formulaire/);
  // Sans groupe existant, on renvoie vers Continuité plutôt que d'ouvrir un formulaire qui
  // ne pourrait qu'échouer côté serveur.
  assert.match(source, /if \(!this\.groups\.length\)/);
});

test('aucune donnée n’est fabriquée pour combler un vide', () => {
  for (const fichier of [source, pont]) {
    // On vise le CONTENU fabriqué. `placeholder=` est un attribut de formulaire, pas un
    // faux contenu : l'interdire confondrait une aide de saisie avec une donnée inventée.
    assert.doesNotMatch(fichier, /Math\.random\(|lorem ipsum|\bdummy\b|\bfake\b|\bmock\b/i,
      'un contenu de remplissage a été introduit');
  }
  // Les états vides sont DITS, en français, plutôt que masqués.
  assert.match(source, /Aucune procédure n’est enregistrée/);
  assert.match(pont, /Aucun schéma ni aucune procédure ne cite cet équipement/);
});

test('une capacité non redéveloppée renvoie vers la section qui la porte', () => {
  // Validation, révision et tests restent dans « Continuité » : le lot le dit à l'écran au
  // lieu de dessiner un bouton qui n'agirait pas.
  assert.match(source, /section\s*\n?\s*<strong>Continuité<\/strong>|<strong>Continuité<\/strong>/);
  assert.doesNotMatch(source, /data-procedure-validate|data-procedure-revise|data-procedure-test/);
});

/* ─────────────────────────── le lot ne touche pas à la Carte */

test('ni la section ni le pont n’importent un module de la Carte', () => {
  // Le lot Carte est développé en parallèle : toute dépendance croisée créerait un conflit
  // de fusion là où les deux lots doivent rester séparables.
  for (const fichier of [source, pont]) {
    assert.doesNotMatch(fichier, /from '\.\/(interactive-map|map-[a-z0-9-]+|pilot-technique-shell|grille-centrale-documented-map)\.js'/);
  }
});

test('le pont enrichit la fiche 360 sans modifier son module', () => {
  // La fiche s'enrichit en couches : ce pont observe et ajoute sa propre carte. Il ne
  // réécrit pas `equipment-360-complete.js`, que d'autres lots peuvent toucher.
  assert.match(pont, /MutationObserver/);
  assert.match(pont, /ops-engineering-links/);
  assert.doesNotMatch(pont, /enhanceEquipment360\b(?!EngineeringLinks)/);
});

test('le pont réessaie, parce que l’identifiant arrive après la fiche', () => {
  // Mesuré : à la microtâche qui suit l'insertion, `dataset.equipmentId` n'est pas encore
  // posé par `equipment-360-complete.js`. Une tentative unique laissait la carte muette.
  const bloc = pont.slice(pont.indexOf('function schedule360'), pont.indexOf('function installObserver'));
  assert.equal((bloc.match(/enhanceEquipment360EngineeringLinks\(modal\)/g) || []).length, 3,
    'les trois tentatives échelonnées ont disparu');
});

test('aucune feuille de style n’a été ajoutée pour ce lot', () => {
  // Le dépôt plafonne délibérément à 35 feuilles (context-bar.test.js,
  // equipment-panel-mode.test.js). Les styles des procédures vivent donc dans la feuille de
  // la continuité, dont elles rendent les documents.
  const html = lire('index.html');
  assert.equal((html.match(/href="[^"]+\.css"/g) || []).length, 35);
  assert.doesNotMatch(html, /procedures-center[^"]*\.css/);
  assert.match(lire('continuity-center.css'), /\.procedures-center\{/);
});

test('les modules du lot sont servis hors ligne comme les autres', () => {
  const worker = lire('service-worker.js');
  for (const module of ['/engineering-refs.js', '/procedures-center.js', '/equipment-360-engineering-links.js']) {
    assert.ok(worker.includes(`'${module}'`), `${module} manque au précache`);
  }
});
