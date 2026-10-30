/**
 * @file tests/demo-auth-contract.test.js — DEMO-AUTH-01, une seule politique par décision.
 *
 * LE DÉFAUT COMMUN AUX SIX POINTS
 * --------------------------------
 * La plateforme possède UNE matrice de rôles canonique — `permissions.js` — et un serveur
 * qui décide de l'autorisation par zone et par grant. Six endroits décidaient pourtant
 * eux-mêmes, avec leur propre liste de rôles écrite à la main :
 *
 *   1-2 · les contrats métier Diagramme et Continuité portaient une SECONDE politique de
 *         rôle. Le Chef, à qui `permissions.js` accorde `diagrams.validate` et
 *         `continuity.validate`, et que le serveur autorise dans toutes ses zones, était
 *         refusé par cette liste locale — qui ne le connaissait pas.
 *   3   · le journal offrait Exporter, Importer, Vider et une suppression ligne par ligne à
 *         quiconque atteignait la section, sans regarder la matrice une seule fois.
 *   4   · la sauvegarde rapide s'affichait pour Manager et Chef, à qui `system.backup` est
 *         refusé, et annonçait son succès AVANT que l'écriture ait abouti.
 *   5   · l'écran des demandes laissait un Manager choisir « fermé », que le serveur refuse.
 *   6   · l'export de rapport s'affichait pour le Responsable, à qui `reports.export` est
 *         refusé.
 *
 * LA RÈGLE
 * --------
 * Une décision d'autorisation se prend à UN seul endroit. Le contrat métier garde ce qui
 * est vraiment métier — acteur identifié, quatre yeux, transition valide, structure — et
 * rien de plus. Le rendu et les gestes de l'écran interrogent `PermissionManager`. Le
 * serveur reste l'autorité, et ces épreuves ne le remplacent pas : elles vérifient que
 * l'écran cesse de proposer ce que le serveur refusera.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDiagramApproval } from '../diagram-contract.js';
import { applyContinuityApproval, CONTINUITY_KINDS } from '../continuity-contract.js';
import { PermissionManager } from '../permissions.js';

const lire = fichier => readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');

const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const acteur = (role, id) => ({ id, role, username: `${role}-1` });

/* ═══════════ 1 · Diagrammes — le contrat métier ne fait plus de politique ═══════════ */

/*
 * Un diagramme structurellement VALIDE : la validation structurelle reste en place, et
 * c'est elle qu'on ne veut surtout pas confondre avec l'autorisation. Une épreuve qui
 * passerait un brouillon incomplet mesurerait le mauvais refus.
 */
const diagrammeBrouillon = {
  id: 'dia-1',
  kind: 'diagram',
  diagramType: 'rack-elevation',
  title: 'Élévation de baie',
  status: 'draft',
  authorId: 'auteur-1',
  zoneIds: ['zone-rf1'],
  nodes: [],
  edges: []
};

test('DIA·1 — un Chef autorisé et non-auteur peut valider un diagramme', () => {
  /*
   * `permissions.js` accorde `diagrams.validate` au Chef, et le serveur vérifie déjà
   * session, visibilité, zones et grants. La liste locale du contrat métier le refusait
   * quand même : une seconde politique, invisible depuis la matrice, et périmée dès qu'un
   * rôle est ajouté.
   */
  const valide = applyDiagramApproval(diagrammeBrouillon, acteur('chef', 'chef-1'));
  assert.equal(valide.status, 'validated');
  assert.equal(String(valide.validation.validatedBy), 'chef-1');
  assert.ok(valide.validation.validatedAt, 'la validation doit être datée');
});

test('DIA·2 — les quatre yeux restent : l’auteur ne valide pas son propre diagramme', () => {
  assert.throws(
    () => applyDiagramApproval(diagrammeBrouillon, acteur('chef', 'auteur-1')),
    error => error.code === 'FOUR_EYES_REQUIRED' && error.status === 409
  );
});

test('DIA·3 — un acteur sans identité ne valide rien', () => {
  // Ce qui reste du refus : non pas « quel rôle ? », mais « qui ? ». Sans identité, il n'y
  // a personne à inscrire dans `validatedBy`, et les quatre yeux n'ont plus de sens.
  for (const sansIdentite of [null, undefined, {}, { role: 'admin' }]) {
    assert.throws(
      () => applyDiagramApproval(diagrammeBrouillon, sansIdentite),
      error => error.status === 403,
      `l’acteur ${JSON.stringify(sansIdentite)} devrait être refusé`
    );
  }
});

test('DIA·4 — le contrat métier ne contient plus AUCUNE liste de rôles', () => {
  /*
   * C'est la règle, pas seulement son effet. Ajouter `chef` à la liste aurait fait passer
   * DIA·1 en laissant la seconde politique en place — et le prochain rôle serait retombé
   * dans le même trou. L'autorisation appartient à l'endpoint et à `access-control`.
   */
  const source = lire('diagram-contract.js');
  const debut = source.indexOf('export function applyDiagramApproval');
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  assert.doesNotMatch(corps, /\[[^\]]*'(admin|manager|responsible|chef)'[^\]]*\]\.includes/,
    'le contrat métier ne doit plus arbitrer les rôles');
});

/* ═══════════ 2 · Continuité — même architecture ═══════════ */

const continuiteBrouillon = {
  id: 'cont-1',
  kind: CONTINUITY_KINDS.PROCEDURE,
  title: 'Procédure de bascule',
  status: 'draft',
  authorId: 'auteur-1',
  zoneIds: ['zone-rf1'],
  protectionGroupId: 'grp-1',
  steps: [
    { id: 'step-1', order: 1, type: 'switch', title: 'Basculer la grille', instruction: 'Passer sur la chaîne de secours.', entityRefs: [] },
    { id: 'step-2', order: 2, type: 'verify', title: 'Vérifier l’antenne', instruction: 'Contrôler le retour antenne et le monitoring.', entityRefs: [] }
  ]
};

test('CONT·1 — un Chef autorisé et non-auteur peut valider une donnée de continuité', () => {
  const valide = applyContinuityApproval(continuiteBrouillon, acteur('chef', 'chef-1'));
  assert.equal(valide.status, 'validated');
  assert.equal(String(valide.validation.validatedBy), 'chef-1');
  assert.equal(valide.verificationStatus, 'verified');
});

test('CONT·2 — les quatre yeux restent', () => {
  assert.throws(
    () => applyContinuityApproval(continuiteBrouillon, acteur('chef', 'auteur-1')),
    error => error.code === 'FOUR_EYES_REQUIRED' && error.status === 409
  );
});

test('CONT·3 — un acteur sans identité ne valide rien', () => {
  for (const sansIdentite of [null, {}, { role: 'admin' }]) {
    assert.throws(() => applyContinuityApproval(continuiteBrouillon, sansIdentite), error => error.status === 403);
  }
});

test('CONT·4 — le contrat métier ne contient plus AUCUNE liste de rôles', () => {
  const source = lire('continuity-contract.js');
  const debut = source.indexOf('export function applyContinuityApproval');
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  assert.doesNotMatch(corps, /\[[^\]]*'(admin|manager|responsible|chef)'[^\]]*\]\.includes/,
    'le contrat métier ne doit plus arbitrer les rôles');
});

test('CONT·5 — l’autorisation reste vérifiée par le serveur, dans TOUTES les zones', () => {
  // Retirer la politique du contrat métier n'ouvre rien : elle faisait doublon avec une
  // vérification plus complète, qui doit rester intacte.
  const serveur = lire('scripts/serve.js');
  for (const [garde, permission] of [['diagramApprovalMatch', 'diagram.validate'], ['continuityApprovalMatch', 'continuity.validate']]) {
    const debut = serveur.indexOf(`const ${garde}`);
    assert.notEqual(debut, -1, `${garde} introuvable`);
    const bloc = serveur.slice(debut, debut + 2600);
    assert.ok(bloc.includes(`'${permission}'`), `${garde} doit exiger ${permission}`);
    assert.match(bloc, /resolveResourceZones/, `${garde} doit résoudre les zones concernées`);
    assert.match(bloc, /\.every\(Boolean\)/, `${garde} doit exiger la permission dans TOUTES les zones`);
  }
});

/* ═══════════ 3 · Journal — fail closed pour la version réunion ═══════════ */

test('LOG·1 — la matrice canonique dit exactement qui fait quoi du journal', () => {
  const attendu = {
    admin:       { view: true,  export: true,  clear: true },
    manager:     { view: true,  export: true,  clear: false },
    chef:        { view: true,  export: true,  clear: false },
    responsible: { view: true,  export: false, clear: false },
    technician:  { view: false, export: false, clear: false },
    visitor:     { view: false, export: false, clear: false }
  };
  for (const role of ROLES) {
    for (const action of ['view', 'export', 'clear']) {
      assert.equal(
        PermissionManager.check({ role }, 'logs', action), attendu[role][action],
        `${role} / logs.${action}`
      );
    }
  }
});

test('LOG·2 — Importer et la suppression ligne par ligne n’existent plus dans ce lot', () => {
  /*
   * Décision de périmètre : `logs.import` et `logs.delete` ne sont pas des permissions
   * décidées. Plutôt que de les inventer avant la réunion, on ferme : ni bouton, ni
   * gestionnaire, ni chemin caché. Un contrat séparé pourra les définir ensuite.
   */
  const source = lire('logsSection.js');
  assert.doesNotMatch(source, /id="import-logs-btn"/, 'le bouton Importer ne doit plus être rendu');
  assert.doesNotMatch(source, /id="import-logs-file"/, 'ni le sélecteur de fichier qui l’accompagne');
  assert.doesNotMatch(source, /importLogsFromFile/, 'ni l’appel qui l’exécute');
  assert.doesNotMatch(source, /del-log-btn/, 'la suppression ligne par ligne ne doit plus être rendue');
  assert.doesNotMatch(source, /deleteLog/, 'ni son gestionnaire');
});

test('LOG·3 — Exporter et Vider sont rendus SELON la matrice, pas selon la présence', () => {
  const source = lire('logsSection.js');
  assert.match(source, /PermissionManager\.check\(.*'logs', 'export'\)/,
    'l’export doit être conditionné par la matrice');
  assert.match(source, /PermissionManager\.check\(.*'logs', 'clear'\)/,
    'le vidage doit être conditionné par la matrice');
});

test('LOG·4 — chaque geste garde une vérification défensive au clic', () => {
  // Un bouton non rendu n'est pas une garde : un gestionnaire atteignable autrement
  // exécuterait quand même l'action. La vérification se refait au moment du geste.
  const source = lire('logsSection.js');
  const apres = source.slice(source.indexOf('async afterRender'));
  const gestes = apres.match(/PermissionManager\.check\(.*'logs',\s*'(export|clear)'\)/g) || [];
  assert.ok(gestes.length >= 2,
    `les gestes doivent revérifier la permission ; trouvé : ${gestes.length}`);
});

/* ═══════════ 4 · Sauvegarde rapide — rendu, attente, et vrai succès ═══════════ */

test('BAK·1 — seul l’Admin possède `system.backup`', () => {
  assert.equal(PermissionManager.check({ role: 'admin' }, 'system', 'backup'), true);
  for (const role of ['manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(PermissionManager.check({ role }, 'system', 'backup'), false, `${role} ne sauvegarde pas`);
  }
});

test('BAK·2 — le bouton n’est rendu que si la permission l’autorise', () => {
  // `AdminUI` sert Admin, Manager et Chef. Rendre le bouton pour tous en faisait une
  // promesse que deux rôles sur trois ne peuvent pas tenir.
  const source = lire('admin-ui.js');
  const debut = source.indexOf('data-action="backup"');
  assert.notEqual(debut, -1, 'le bouton de sauvegarde rapide est introuvable');
  const autour = source.slice(Math.max(0, debut - 400), debut + 120);
  assert.match(autour, /PermissionManager\.check\(.*'system', 'backup'\)/,
    'le rendu du bouton doit dépendre de `system.backup`');
});

test('BAK·3 — le geste attend l’écriture, et n’annonce le succès qu’après', () => {
  /*
   * Le succès s'affichait avant même que l'export ait commencé à résoudre : un échec
   * passait inaperçu, et l'utilisateur repartait convaincu d'avoir une sauvegarde.
   */
  const source = lire('admin-ui.js');
  const debut = source.indexOf("if (action === 'backup')");
  assert.notEqual(debut, -1);
  const bloc = source.slice(debut, debut + 2200);

  assert.match(bloc, /PermissionManager\.check\(.*'system', 'backup'\)/,
    'garde défensive au clic, en plus du rendu');
  assert.match(bloc, /await this\.backupService\.exportToFile\(\)/, 'l’écriture doit être attendue');
  assert.match(bloc, /catch/, 'un échec doit être rattrapé');
  assert.match(bloc, /finally/, 'et le bouton réactivé quoi qu’il arrive');
  assert.match(bloc, /disabled = true/, 'le bouton doit se désactiver pendant l’opération');
  assert.ok(bloc.indexOf('await this.backupService.exportToFile()') < bloc.indexOf("'success'"),
    'le succès ne s’annonce qu’APRÈS la résolution');
});

test('BAK·4 — `handleQuickAction` est asynchrone', () => {
  const source = lire('admin-ui.js');
  assert.match(source, /async handleQuickAction\(action\)/,
    'sans `async`, aucun `await` n’est possible et le faux succès revient');
});

/* ═══════════ 5 · Demandes — le Manager traite, l’Admin ferme ═══════════ */

test('TIC·1 — deux questions distinctes : gérer, et fermer définitivement', () => {
  const source = lire('tickets.js');
  assert.match(source, /function canManageTicket/);
  assert.match(source, /function canCloseTicketPermanently/,
    'fermer définitivement est une décision à part, pas une nuance de « gérer »');
  const debut = source.indexOf('function canCloseTicketPermanently');
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  assert.match(corps, /isPlatformAdmin/,
    'la fermeture définitive doit s’appuyer sur le contrat Admin canonique');
  assert.doesNotMatch(corps, /\['admin'\s*,\s*'manager'\]/,
    'et surtout pas sur une nouvelle liste écrite à la main');
});

test('TIC·2 — le statut « fermé » n’est proposé qu’à qui peut réellement fermer', () => {
  // Le serveur refuse déjà un Manager avec `ADMIN_CLOSE_REQUIRED`. Le lui proposer quand
  // même, c'est promettre une action qui échouera — et faire passer un refus légitime
  // pour une panne.
  const source = lire('tickets.js');
  assert.doesNotMatch(source, /status === 'fermé' && !\['admin','manager'\]\.includes/,
    'la liste locale qui autorisait le Manager à choisir « fermé » doit disparaître');
  assert.match(source, /canCloseTicketPermanently\(/, 'le rendu doit interroger la question canonique');
});

test('TIC·3 — le serveur reste seul juge, et il est inchangé', () => {
  const serveur = lire('scripts/serve.js');
  assert.match(serveur, /ADMIN_CLOSE_REQUIRED/,
    'la garde serveur doit rester : l’écran ne la remplace pas, il cesse de la contredire');
});

/* ═══════════ 6 · Rapports — le Responsable consulte sans exporter ═══════════ */

test('RAP·1 — la matrice refuse l’export au Responsable et le lui accorde ailleurs', () => {
  assert.equal(PermissionManager.check({ role: 'responsible' }, 'reports', 'view'), true);
  assert.equal(PermissionManager.check({ role: 'responsible' }, 'reports', 'generate'), true);
  assert.equal(PermissionManager.check({ role: 'responsible' }, 'reports', 'export'), false);
  for (const role of ['admin', 'manager', 'chef']) {
    assert.equal(PermissionManager.check({ role }, 'reports', 'export'), true, `${role} exporte`);
  }
});

test('RAP·2 — le bouton d’export n’est rendu que si `reports.export` l’autorise', () => {
  const source = lire('rapports.js');
  const debut = source.indexOf('id="reports-export"');
  assert.notEqual(debut, -1, 'le bouton d’export est introuvable');
  const autour = source.slice(Math.max(0, debut - 400), debut + 120);
  assert.match(autour, /PermissionManager\.check\(.*'reports', 'export'\)/);
  assert.doesNotMatch(source, /role !== 'responsible'/,
    'la question est la permission, pas le nom du rôle');
});

test('RAP·3 — le geste d’export revérifie la permission', () => {
  const source = lire('rapports.js');
  const debut = source.indexOf("getElementById('reports-export')");
  assert.notEqual(debut, -1);
  const bloc = source.slice(debut, debut + 700);
  assert.match(bloc, /PermissionManager\.check\(.*'reports', 'export'\)/,
    'garde défensive au clic : un gestionnaire atteignable autrement ne doit pas exporter');
});

test('RAP·4 — la consultation du Responsable n’est pas réduite', () => {
  // On retire une ACTION, pas des données. Le Responsable doit continuer de voir et de
  // générer ses rapports comme avant.
  const source = lire('rapports.js');
  assert.doesNotMatch(source, /PermissionManager\.check\(.*'reports', 'view'\)\s*\?[^:]*:\s*''/,
    'aucune donnée consultable ne doit être retirée au Responsable dans ce lot');
});
