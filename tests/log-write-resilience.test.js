import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAccessControl } from '../scripts/access-control.js';
import { canWriteStoreByRole } from '../roles.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Retire commentaires de bloc et de ligne : une assertion « ce motif ne doit PAS exister »
// doit porter sur le code, pas sur le commentaire qui explique pourquoi il est refusé.
const sansCommentaires = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// Piège H-15. Une entrée de journal n'a aucun champ dont une zone puisse se déduire, si
// bien que `resolveResourceZones('logs', …)` rendait une liste vide et que l'écriture était
// refusée en 403 — pour TOUT non-administrateur, quelles que soient ses permissions, sans
// qu'aucun octroi puisse jamais y remédier. Mesuré : technicien pourvu des 19 permissions
// de son plafond de rôle, membre de la zone → journal refusé, note acceptée.
//
// Comme `addLog()` est appelé après presque chaque action et que ses appelants enchaînent
// la notification de succès puis le rafraîchissement de la vue, le refus faisait sauter
// ces deux étapes : l'opération avait abouti, mais l'écran restait figé et muet.

/*
 * CES TROIS ÉPREUVES LISAIENT LE CODE ; ELLES L'EXÉCUTENT MAINTENANT.
 *
 * Elles gardaient le piège H-15 en cherchant un motif précis dans `access-control.js` —
 * l'exception qui laissait chacun écrire le log lui appartenant. Le motif a disparu avec
 * la correction DEMO-AUTH-01, et l'une d'elles affirmait même une règle devenue fausse :
 * « la LECTURE du journal reste filtrée par zone ». C'était vrai du mécanisme, faux du
 * contrat — et c'est exactement ce qui rendait le Chef et le Responsable AVEUGLES au
 * journal alors que la matrice leur accorde `logs.view`.
 *
 * Elles interrogent donc désormais le contrat réel, avec une base simulée. Le piège H-15
 * reste gardé : ce qui compte n'est pas la forme de la garde, c'est qu'un technicien
 * pourvu de son plafond puisse consigner son action sans qu'aucune zone ne s'y oppose.
 */
function accesSimule() {
  // Une entrée de journal n'a aucun champ dont une zone puisse se déduire : c'est la
  // donnée même du piège H-15, et la base simulée doit le refléter.
  const records = { zones: [], resource_zones: [], zone_memberships: [], zone_grants: [] };
  return createAccessControl({ async query(sql, params = []) {
    if (sql.startsWith('SELECT data FROM')) {
      return { rows:(records[params[0]] || []).filter(item => String(item.id) === String(params[1])).map(data => ({ data })) };
    }
    if (sql.startsWith('SELECT record_id,data')) return { rows:(records[params[0]] || []).map(data => ({ data })) };
    throw new Error(`Requête inattendue: ${sql}`);
  } });
}

const journal = { id: 42, type: 'inventaire', action: 'modification', userId: 'technicien-1' };

test('écrire son propre journal ne dépend plus d’une zone', async () => {
  const access = accesSimule();
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(
      await access.canAccessRecord({ id: `${role}-1`, role }, 'logs', journal, 'create'), true,
      `${role} doit pouvoir consigner son action : \`addLog()\` suit presque chaque opération métier`
    );
  }
});

test('la LECTURE du journal suit `logs.view`, et non le contrat d’un autre objet', async () => {
  /*
   * Elle était adossée à `ticket.read`, donc à une zone qu'une entrée de journal n'a pas.
   * Conséquence mesurée : Chef et Responsable ne voyaient AUCUNE entrée, alors que la
   * matrice canonique leur accorde `logs.view`.
   */
  const access = accesSimule();
  const attendu = {
    admin: true, manager: true, chef: true, responsible: true, technician: false, visitor: false
  };
  for (const [role, visible] of Object.entries(attendu)) {
    assert.equal(
      await access.canAccessRecord({ id: `${role}-1`, role }, 'logs', journal, 'read'), visible,
      `${role} : lecture du journal`
    );
  }
});

test('le journal est IMMUABLE, et nul ne peut effacer la trace d’autrui', async () => {
  const access = accesSimule();
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor']) {
    assert.equal(
      await access.canAccessRecord({ id: `${role}-1`, role }, 'logs', journal, 'update'), false,
      `${role} ne doit pas pouvoir réécrire une entrée existante — pas même l’administrateur`
    );
    assert.equal(
      await access.canAccessRecord({ id: `${role}-1`, role }, 'logs', journal, 'delete'), role === 'admin',
      `${role} : suppression d’une entrée`
    );
  }
});

test('AJOUTER une trace est ouvert aux SIX rôles, et à eux seuls', () => {
  /*
   * CE TEST S'EXÉCUTE : il appelle la règle, il ne la lit pas.
   *
   * Mesuré sur `6c3e766` : le Visiteur recevait `403 FORBIDDEN` de `canWriteStoreByRole`,
   * AVANT que le contrat Journal du serveur ne soit consulté. Ses actions n'étaient donc
   * jamais journalisées — et un journal qui omet un rôle ne prouve rien sur ce rôle.
   *
   * Les alias historiques comptent autant que les noms canoniques : c'est sous « technicien »
   * ou « responsable » que les comptes dorment réellement en base.
   */
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor',
                      'administrateur', 'responsable', 'technicien', 'visiteur']) {
    assert.equal(canWriteStoreByRole(role, 'logs'), true, `${role} doit pouvoir AJOUTER une trace`);
  }
});

test('un rôle inconnu, lui, n’écrit toujours rien — pas même dans le journal', () => {
  // La porte ouverte au journal reste SOUS le refus des rôles inconnus. Sans cela, une
  // valeur héritée illisible obtiendrait un droit d'écriture que personne ne lui a donné.
  for (const role of ['', null, undefined, 'foobar', 'root', 'superviseur']) {
    assert.equal(canWriteStoreByRole(role, 'logs'), false, `« ${String(role)} » ne doit rien écrire`);
  }
});

test('ouvrir le journal au Visiteur n’ouvre AUCUN autre magasin', () => {
  /*
   * La contrepartie exacte du test précédent. Le risque d'une exception par magasin est
   * qu'elle déborde : on vérifie donc, magasin par magasin, que le Visiteur reste refusé
   * partout ailleurs, et que les autres rôles gardent leurs règles d'avant.
   */
  for (const store of ['equipments', 'rooms', 'baies', 'cables', 'docs', 'notes',
                       'tickets', 'settings', 'users', 'walls', 'screens']) {
    assert.equal(canWriteStoreByRole('visitor', store), false,
      `le Visiteur ne doit pas écrire dans ${store}`);
  }
  // Les règles inchangées des autres rôles.
  assert.equal(canWriteStoreByRole('manager', 'settings'), false, 'les réglages restent à l’administrateur');
  assert.equal(canWriteStoreByRole('admin', 'settings'), true);
  assert.equal(canWriteStoreByRole('technician', 'users'), false, 'un technicien n’encadre personne');
  assert.equal(canWriteStoreByRole('chef', 'users'), true, 'un chef encadre au moins un responsable');
  assert.equal(canWriteStoreByRole('technician', 'equipments'), true);
});

test('le serveur estampille l’auteur et l’horodatage : une entrée ne s’attribue pas', () => {
  const server = read('scripts/serve.js');
  // On isole le bloc du journal plutôt que de compter les caractères : un commentaire
  // ajouté ne doit pas casser une garde qui porte sur le code.
  const debut = server.indexOf("if (storeName === 'logs') {");
  assert.notEqual(debut, -1, 'le bloc du journal est introuvable');
  // Les commentaires citent les formes REFUSÉES pour expliquer pourquoi elles le sont : une
  // garde qui les lirait s'auto-déclencherait. On n'assertionne donc que sur le code.
  const bloc = sansCommentaires(server.slice(debut, server.indexOf("if (storeName === 'cables')", debut)));
  assert.match(bloc, /userId: user\.id,\s*username: user\.username/,
    'l’auteur vient de la session, jamais de la charge utile');

  /*
   * LE REPLI SUR LA VALEUR CLIENT EST INTERDIT, ET C'EST `fullName` QUI LE MONTRAIT.
   *
   * `user.fullName || record.fullName || ''` laissait un compte au nom vide se déclarer
   * « Direction Générale ». Le champ le plus lu d'un journal était le seul que son auteur
   * pouvait choisir. Mesuré, puis refusé : la valeur vient de la session, ou elle est vide.
   */
  assert.match(bloc, /fullName: user\.fullName \|\| ''/, 'le nom complet vient de la session');
  assert.doesNotMatch(bloc, /record\.fullName/, 'aucun repli sur la valeur envoyée par le client');

  /*
   * UN SEUL INSTANT, ET UN TIMESTAMP QUI SE SOUSTRAIT.
   *
   * `logs.js` trie par `b.timestamp - a.timestamp`. Deux chaînes ISO se soustraient en
   * `NaN` : le tri ne trie plus et le journal s'affiche dans un ordre arbitraire. Le
   * timestamp canonique est donc un NOMBRE de millisecondes. `dateStr` doit être réécrit
   * lui aussi — sans quoi la valeur client survivait, et l'écran affichait une date que la
   * base contredisait.
   */
  assert.match(bloc, /const maintenant = new Date\(\);/, 'un seul instant serveur pour les trois valeurs');
  assert.match(bloc, /timestamp: maintenant\.getTime\(\)/,
    'l’horodatage canonique est un nombre de millisecondes, pas une chaîne');
  assert.doesNotMatch(bloc, /timestamp: new Date\(\)\.toISOString\(\)/,
    'une chaîne ISO casserait le tri de logs.js');
  assert.match(bloc, /dateStr: maintenant\.toLocaleString\('fr-FR'\)/,
    'la date affichée vient du serveur, jamais du client');
  assert.match(bloc, /serverReceivedAt: maintenant\.toISOString\(\)/);
});

test('l’immuabilité du journal est décidée avant toute question de rôle ou de zone', () => {
  const server = read('scripts/serve.js');
  /*
   * Placée après la garde de zone, la même règle rendait TROIS codes selon l'acteur —
   * `LOG_IMMUTABLE` à l'administrateur, `ZONE_FORBIDDEN` aux quatre rôles intermédiaires,
   * `FORBIDDEN` au visiteur. Deux d'entre eux nomment une cause qui n'est pas la bonne.
   * Elle doit donc précéder la garde de zone, et ne dépendre que de l'existence de la ligne.
   */
  const garde = server.indexOf("if (storeName === 'logs' && existing) {");
  assert.notEqual(garde, -1, 'la garde d’immuabilité est introuvable');
  assert.match(server.slice(garde, garde + 300), /LOG_IMMUTABLE/);

  const zone = server.indexOf('!await access.canAccessRecord(user, storeName, existing, \'update\')');
  assert.notEqual(zone, -1, 'la garde de zone est introuvable');
  assert.ok(garde < zone,
    'l’immuabilité doit être tranchée AVANT la garde de zone, sinon le code de refus dépend du rôle');
});

test('addLog n’interrompt jamais l’action qu’il consigne', () => {
  const logs = read('logs.js');
  assert.match(logs, /try \{\s*await db\.save\('logs', logEntry\);\s*return true;\s*\} catch \(error\) \{/);
  assert.match(logs, /log-write-failed/, "l'échec doit rester visible, pas être avalé");
  // Une seule écriture de journal dans le module, et elle est celle qui est protégée :
  // une seconde, nue, laisserait l'erreur remonter et couperait l'appelant.
  assert.equal((logs.match(/db\.save\('logs',\s*logEntry\)/g) || []).length, 1);
  assert.match(logs, /return false;\s*\}\s*\}/, 'le rejet se termine par un retour, pas par une propagation');
});

test('l’audit du mur d’images survit à un refus de trace', () => {
  const manager = read('wall-manager.js');
  // `saveScreen` enchaîne audit() → notify('succès') → renderCurrentWall(). Si audit()
  // levait, l'écran était bien enregistré mais l'utilisateur ne voyait ni message ni
  // rafraîchissement, ce qui se lisait comme un échec.
  assert.match(manager, /try \{\s*await db\.save\('notifications', \{[\s\S]{0,300}\} catch \(error\) \{[\s\S]{0,200}console\.warn/);
  assert.match(manager, /eventSystem\.dispatch\('wall-data-changed'/);
});

test('un refus d’arrière-plan atteint l’utilisateur, pas seulement la console', async () => {
  /*
   * CE TEST EXÉCUTE LE RELAIS, IL NE LE LIT PLUS.
   *
   * Il vérifiait auparavant le TEXTE de la garde — `state !== 'warning'`. Un tel test ne
   * dit pas si le message arrive : il dit seulement qu'une ligne n'a pas bougé. Il est
   * donc passé rouge le jour où le relais a été ÉLARGI aux conflits de version, c'est-à-dire
   * le jour où il faisait mieux ce que ce test prétendait protéger.
   *
   * On installe donc un DOM minimal, on construit le vrai système de notification, on émet
   * les vrais événements, et on regarde ce qui atteint le canal visible.
   */
  const auditeurs = new Map();
  globalThis.window = {
    addEventListener(type, fonction) {
      if (!auditeurs.has(type)) auditeurs.set(type, []);
      auditeurs.get(type).push(fonction);
    },
    dispatchEvent(evenement) {
      for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement);
      return true;
    }
  };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  const element = () => ({
    className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, enfants: [],
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(noeud) { this.enfants.push(noeud); return noeud; },
    remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => []
  });
  globalThis.document = {
    createElement: () => element(), body: element(), head: element(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
  };

  const { NotificationSystem } = await import('../notifications.js');
  const systeme = new NotificationSystem();
  const affiches = [];
  systeme.showNotification = (message, type) => { affiches.push({ message, type }); };

  // Une trace de journal refusée : l'opération a abouti, mais sa trace non — et l'utilisateur
  // doit l'apprendre autrement que dans la console.
  window.dispatchEvent(new CustomEvent('log-write-failed', { detail: {} }));
  assert.equal(affiches.length, 1, 'un échec de journal n’a atteint aucun canal visible');
  assert.match(affiches[0].message, /journal/i);

  // La pastille [data-ops-sync] n'existe que sur la page Exploitation : sans ce relais, un
  // refus d'écriture n'aurait aucune audience ailleurs.
  affiches.length = 0;
  window.dispatchEvent(new CustomEvent('central-sync-status', {
    detail: { state: 'warning', message: 'Modification refusée par le serveur: quota dépassé.' }
  }));
  assert.equal(affiches.length, 1, 'un refus d’écriture n’a atteint aucun canal visible');
  assert.equal(affiches[0].type, 'warning');
});
