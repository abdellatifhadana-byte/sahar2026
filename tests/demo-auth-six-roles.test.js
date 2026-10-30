/**
 * @file tests/demo-auth-six-roles.test.js — DEMO-AUTH-01, la porte des six rôles.
 *
 * CE QUE CETTE PORTE VÉRIFIE
 * ---------------------------
 * Pour chacun des six rôles canoniques, les écrans touchés par ce lot sont RENDUS pour de
 * vrai, et l'on regarde ce qu'ils proposent. Une action visible est une promesse : si le
 * serveur la refusera, l'écran ne doit pas la faire.
 *
 *   Admin · Manager · Chef · Responsable · Technique · Visiteur
 *
 * Chaque cas suit la chaîne jusqu'où elle peut aller sans navigateur :
 *
 *     rendu → présence du bouton → gestionnaire → permission → écriture
 *
 * Ce qu'une épreuve Node ne peut pas atteindre est dit à l'endroit où elle s'arrête, et
 * repris par `scripts/demo-auth-e2e.mjs`, qui parle à un vrai serveur : validation par un
 * Chef, refus hors zone, quatre yeux, et clôture d'une demande.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installerDom } from './helpers/mini-dom.js';

const dom = installerDom();
const { document } = dom;

let identite = null;
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' && identite ? JSON.stringify(identite) : null),
  setItem() {}, removeItem() {}
};

/* ------------------------------ Base locale ------------------------------ */

const magasins = new Map([
  ['logs', [
    { id: 1, timestamp: Date.now(), dateStr: '01/01/2026', username: 'admin', type: 'securite', action: 'connexion' },
    { id: 2, timestamp: Date.now(), dateStr: '01/01/2026', username: 'chef', type: 'inventaire', action: 'modification' }
  ]],
  ['equipments', [{ id: 'eq-1', name: 'Ultrix', status: 'actif' }]],
  ['rooms', [{ id: 'salle-1', name: 'Régie Finale 1' }]],
  ['baies', []], ['screens', []], ['cables', []], ['tickets', []], ['docs', []], ['walls', []]
]);

const { db } = await import('../db.js');
db.open = async () => ({});
db.getAll = async nom => magasins.get(nom) || [];
db.get = async (nom, id) => (magasins.get(nom) || []).find(item => String(item.id) === String(id)) || null;
db._getRaw = db.get;

const LogsSection = (await import('../logsSection.js')).default;
const Rapports = (await import('../rapports.js')).default;
const { PermissionManager } = await import('../permissions.js');
const { isPlatformAdmin } = await import('../roles.js');
const { ticketStatusOptions: ticketStatusOptionsSync } = await import('../tickets.js');

const ROLES = ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor'];
const seConnecter = role => { identite = { id: `${role}-1`, username: role, role }; };

/** Rend un composant dans un hôte neuf et rend son texte et ses boutons. */
async function rendre(composant) {
  for (const noeud of [...document.body.childNodes]) document.body.removeChild(noeud);
  const hote = document.createElement('div');
  hote.innerHTMLBrut = await composant.render();
  document.body.appendChild(hote);
  return hote.innerHTMLBrut;
}

const contient = (html, motif) => html.includes(motif);

/* ═══════════════ Journal — six rôles, une seule matrice ═══════════════ */

test('SIX·1 — le journal ne propose Exporter et Vider qu’à qui les possède', async () => {
  const notifications = { showNotification() {} };
  for (const role of ROLES) {
    seConnecter(role);
    const html = await rendre(new LogsSection(notifications));

    const exportAttendu = PermissionManager.check({ role }, 'logs', 'export');
    const videAttendu = PermissionManager.check({ role }, 'logs', 'clear');

    assert.equal(contient(html, 'id="export-logs-btn"'), exportAttendu,
      `${role} : bouton Exporter ${exportAttendu ? 'attendu' : 'interdit'}`);
    assert.equal(contient(html, 'id="clear-logs-btn"'), videAttendu,
      `${role} : bouton Vider ${videAttendu ? 'attendu' : 'interdit'}`);
  }
});

test('SIX·2 — Importer et la suppression ligne par ligne n’existent pour PERSONNE', async () => {
  /*
   * Décision de périmètre : `logs.import` et `logs.delete` ne sont pas des permissions
   * décidées. On ferme plutôt que d'inventer — et on le vérifie pour les six rôles, y
   * compris l'administrateur, pour qui la tentation d'une exception serait la plus forte.
   */
  const notifications = { showNotification() {} };
  for (const role of ROLES) {
    seConnecter(role);
    const html = await rendre(new LogsSection(notifications));
    assert.equal(contient(html, 'import-logs-btn'), false, `${role} : Importer ne doit pas exister`);
    assert.equal(contient(html, 'import-logs-file'), false, `${role} : ni son sélecteur de fichier`);
    assert.equal(contient(html, 'del-log-btn'), false, `${role} : ni la suppression ligne par ligne`);
  }
});

test('SIX·3 — le journal reste CONSULTABLE par ceux qui y ont droit', async () => {
  // On ferme des actions, pas la lecture. Un Responsable doit continuer de voir la trace.
  const notifications = { showNotification() {} };
  for (const role of ['admin', 'manager', 'chef', 'responsible']) {
    seConnecter(role);
    const html = await rendre(new LogsSection(notifications));
    assert.ok(contient(html, 'Journal des événements'), `${role} : l’écran du journal doit s’afficher`);
    assert.ok(contient(html, 'connexion'), `${role} : les entrées doivent rester lisibles`);
  }
});

/* ═══════════════ Rapports — l'action retirée, pas les données ═══════════════ */

test('SIX·4 — l’export de rapport suit `reports.export`, pour les six rôles', async () => {
  for (const role of ROLES) {
    seConnecter(role);
    const rapports = new Rapports({ showNotification() {} });
    const html = await rendre(rapports);
    const attendu = PermissionManager.check({ role }, 'reports', 'export');
    assert.equal(contient(html, 'id="reports-export"'), attendu,
      `${role} : bouton d’export ${attendu ? 'attendu' : 'interdit'}`);
  }
});

test('SIX·5 — le Responsable garde ses chiffres, il perd seulement l’export', async () => {
  seConnecter('responsible');
  const html = await rendre(new Rapports({ showNotification() {} }));
  assert.equal(contient(html, 'id="reports-export"'), false);
  assert.ok(contient(html, 'Rapports &amp; santé de la plateforme') || contient(html, 'Rapports'),
    'l’écran doit rester affiché');
  assert.ok(contient(html, 'Équipements'), 'et ses indicateurs rester lisibles');
});

/* ═══════════════ Sauvegarde rapide — permission, attente, unicité ═══════════════ */

/** Un `AdminUI` réduit à ce que le geste de sauvegarde utilise réellement. */
function bureauAdmin(role, backupService) {
  const messages = [];
  return {
    user: { id: `${role}-1`, role },
    notifications: { showNotification: (texte, type) => messages.push({ texte, type }) },
    backupService,
    messages
  };
}

test('SIX·6 — seul l’Admin déclenche la sauvegarde ; les autres reçoivent un refus lisible', async () => {
  const { default: AdminUI } = await import('../admin-ui.js');
  for (const role of ROLES) {
    let appels = 0;
    const bureau = bureauAdmin(role, { exportToFile: async () => { appels += 1; } });
    await AdminUI.prototype.handleQuickAction.call(bureau, 'backup');

    if (role === 'admin') {
      assert.equal(appels, 1, 'l’administrateur sauvegarde');
      assert.equal(bureau.messages.at(-1)?.type, 'success');
    } else {
      assert.equal(appels, 0, `${role} ne doit déclencher aucune sauvegarde`);
      assert.equal(bureau.messages.at(-1)?.type, 'error', `${role} doit recevoir un refus explicite`);
      assert.match(bureau.messages.at(-1)?.texte || '', /autorisé/,
        `${role} : le refus doit être dit en français, pas seulement subi`);
    }
  }
});

test('SIX·7 — le succès n’est annoncé qu’APRÈS la résolution', async () => {
  /*
   * Le défaut mesuré : `exportToFile()` était appelée sans `await`, et le message de succès
   * partait dans la foulée. Un échec passait inaperçu, et l'utilisateur repartait convaincu
   * d'avoir une sauvegarde qu'il n'avait pas.
   */
  const { default: AdminUI } = await import('../admin-ui.js');
  const ordre = [];
  const bureau = bureauAdmin('admin', {
    exportToFile: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      ordre.push('écriture terminée');
    }
  });
  bureau.notifications.showNotification = (texte, type) => { ordre.push(`message:${type}`); bureau.messages.push({ texte, type }); };

  await AdminUI.prototype.handleQuickAction.call(bureau, 'backup');
  assert.deepEqual(ordre, ['écriture terminée', 'message:success'],
    'l’annonce doit suivre l’écriture, jamais la précéder');
});

test('SIX·8 — un échec de sauvegarde se dit, en français, et ne se déguise pas en succès', async () => {
  const { default: AdminUI } = await import('../admin-ui.js');
  const bureau = bureauAdmin('admin', {
    exportToFile: async () => { throw new Error('disque plein'); }
  });
  await AdminUI.prototype.handleQuickAction.call(bureau, 'backup');
  const dernier = bureau.messages.at(-1);
  assert.equal(dernier?.type, 'error');
  assert.match(dernier?.texte || '', /Sauvegarde impossible/);
  assert.equal(bureau.messages.some(message => message.type === 'success'), false,
    'aucun succès ne doit être annoncé quand l’écriture a échoué');
});

test('SIX·9 — un double clic ne lance qu’une seule sauvegarde', async () => {
  const { default: AdminUI } = await import('../admin-ui.js');
  // Le bouton réellement présent dans le document : c'est lui que le geste désactive.
  for (const noeud of [...document.body.childNodes]) document.body.removeChild(noeud);
  const bouton = document.createElement('button');
  bouton.setAttribute('data-action', 'backup');
  document.body.appendChild(bouton);

  let appels = 0;
  const bureau = bureauAdmin('admin', {
    exportToFile: async () => { appels += 1; await new Promise(resolve => setTimeout(resolve, 20)); }
  });

  const premier = AdminUI.prototype.handleQuickAction.call(bureau, 'backup');
  const second = AdminUI.prototype.handleQuickAction.call(bureau, 'backup');
  await Promise.all([premier, second]);

  assert.equal(appels, 1, 'le second clic doit être ignoré tant que le premier n’a pas rendu la main');
  assert.equal(bouton.disabled, false, 'et le bouton doit redevenir utilisable ensuite');
});

/* ═══════════════ Demandes — traiter n'est pas fermer ═══════════════ */

test('SIX·10 — seul l’Admin peut fermer définitivement, selon le contrat canonique', () => {
  /*
   * L'écran interroge `isPlatformAdmin`, et non une liste de rôles écrite à la main. On
   * vérifie ici la réponse pour les six rôles ; le refus HTTP réel — `ADMIN_CLOSE_REQUIRED`
   * pour un Manager — est éprouvé par `scripts/demo-auth-e2e.mjs` contre un vrai serveur.
   */
  const attendu = { admin: true, manager: false, chef: false, responsible: false, technician: false, visitor: false };
  for (const role of ROLES) {
    assert.equal(isPlatformAdmin(role), attendu[role], `${role} : fermeture définitive`);
  }
});

test('SIX·11 — le statut « fermé » est ABSENT du rendu pour qui ne peut pas fermer', async () => {
  /*
   * CETTE ÉPREUVE A DÉJÀ FIGÉ LA MAUVAISE ACCEPTANCE, ET C'EST LA LEÇON DU LOT.
   *
   * Sa première version affirmait que « les quatre statuts restent proposés », et se
   * contentait de vérifier que « fermé » portait `disabled` pour un Manager. Elle était
   * verte, la suite entière était verte — et pourtant elle consacrait dans le code un
   * comportement que le contrat #94 refuse. Un `disabled` reste dans le DOM : il s'enlève
   * depuis la console, il se soumet par script, et surtout il MONTRE une issue que le
   * serveur refusera.
   *
   * L'acceptance est donc l'ABSENCE, pas la désactivation.
   */
  const { ticketStatusOptions } = await import('../tickets.js');

  const attendus = {
    admin:       ['en cours', 'attente', 'prêt-fermeture', 'fermé'],
    manager:     ['en cours', 'attente', 'prêt-fermeture'],
    chef:        ['en cours', 'attente', 'prêt-fermeture'],
    responsible: ['en cours', 'attente', 'prêt-fermeture'],
    technician:  ['en cours', 'attente', 'prêt-fermeture'],
    visitor:     ['en cours', 'attente', 'prêt-fermeture']
  };

  for (const role of ROLES) {
    const html = ticketStatusOptions({ id: `${role}-1`, role }, 'en cours');
    const rendus = [...html.matchAll(/value="([^"]+)"/g)].map(trouve => trouve[1]);
    assert.deepEqual(rendus, attendus[role], `${role} : statuts rendus`);
    assert.equal(html.includes('value="fermé"'), role === 'admin',
      `${role} : l’option « fermé » doit être ${role === 'admin' ? 'présente' : 'ABSENTE du DOM'}`);
    assert.equal(html.includes('disabled'), false,
      `${role} : plus aucune option désactivée — ce qui est interdit ne se montre pas`);
  }
});

test('SIX·12 — le statut courant d’une demande déjà fermée reste lisible', () => {
  /*
   * Retirer l'option ne doit pas rendre illisible une demande DÉJÀ fermée : sans elle, le
   * `<select>` d'un Manager afficherait « en cours » sur un ticket clos, ce qui serait un
   * mensonge pire que l'option de trop.
   */
  const html = ticketStatusOptionsSync({ id: 'manager-1', role: 'manager' }, 'fermé');
  assert.ok(html.includes('value="fermé"'),
    'le statut réellement en cours doit rester affiché, même s’il n’est pas proposable');
  assert.ok(html.includes('selected'), 'et sélectionné');
});
