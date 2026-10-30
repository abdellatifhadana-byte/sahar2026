/**
 * @file tests/snapshot-divergence-ui.test.js — C-DIRTY-UI-01, la chaîne jusqu'à l'écran.
 *
 * CE QUI MANQUAIT
 * ---------------
 * Le contrat d'instantané distinguait déjà une DIVERGENCE — la fiche change côté serveur
 * pendant qu'un humain la saisit — d'un simple rafraîchissement. Mais :
 *
 *   · aucun écran ne déclarait jamais éditer quoi que ce soit, donc la condition qui
 *     produit l'événement n'était jamais vraie ;
 *   · et aucun module n'écoutait l'événement, donc même produit il n'aurait rien affiché.
 *
 * Une protection qui n'est ni déclenchée ni reçue n'est pas une protection. Ces épreuves
 * exigent la chaîne ENTIÈRE, et elles la font tourner :
 *
 *     instantané distant → saisie en cours reconnue → `platform-entity-diverged`
 *       → saisie locale conservée → indication explicite, visible, en français
 *
 * MÉTHODE
 * -------
 * Aucune de ces épreuves ne lit du code source pour y chercher un motif. Elles installent
 * un document manipulable, chargent `central-sync.js` et LES MODULES QUE `index.html`
 * CHARGE RÉELLEMENT pour consommer la divergence, appliquent un vrai instantané, puis
 * regardent ce que l'écran affiche et ce que le formulaire contient.
 *
 * Conséquence voulue : retirer le module du document, retirer son écouteur, ou changer la
 * phrase affichée fait tomber ces épreuves. C'est le seul moyen qu'elles mesurent la
 * plateforme telle qu'elle est assemblée, et non telle qu'on l'espère.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { installerDom } from './helpers/mini-dom.js';

const dom = installerDom();
const { document } = dom;

globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, username: 'admin', role: 'admin' }) : null),
  setItem() {}, removeItem() {}
};

/* ---------------- Base locale en mémoire, transactions comprises ---------------- */

const magasins = new Map();
const table = nom => {
  if (!magasins.has(nom)) magasins.set(nom, new Map());
  return magasins.get(nom);
};

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = {
  objectStoreNames: { contains: nom => ['rooms', 'equipments', 'docs', 'settings', 'syncQueue', 'notes'].includes(nom) },
  transaction(nom) {
    const magasin = table(nom);
    const operations = [];
    const transaction = {
      objectStore: () => ({
        clear() { operations.push(() => magasin.clear()); },
        put(enregistrement) { operations.push(() => magasin.set(String(enregistrement.id), enregistrement)); },
        delete(id) { operations.push(() => magasin.delete(String(id))); },
        getAll() {
          const requete = { result: [...magasin.values()], onsuccess: null, onerror: null };
          queueMicrotask(() => requete.onsuccess?.());
          return requete;
        }
      }),
      oncomplete: null, onerror: null, onabort: null
    };
    queueMicrotask(() => queueMicrotask(() => {
      for (const operation of operations) operation();
      transaction.oncomplete?.();
    }));
    return transaction;
  }
};
db._getRaw = async (nom, id) => table(nom).get(String(id)) ?? null;
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()];

/** Toute écriture est comptée : ce module ne doit JAMAIS enregistrer à la place de l'humain. */
const ecrituresLocales = [];
db.save = async (nom, enregistrement) => {
  ecrituresLocales.push({ nom, id: enregistrement?.id });
  const id = String(enregistrement?.id ?? `auto-${table(nom).size + 1}`);
  table(nom).set(id, { ...enregistrement, id });
  return id;
};
db.saveLocalOnly = db.save;
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };
db.delete = db._deleteRaw;

/* ------------------------------ Serveur simulé ------------------------------ */

const MAGASINS_AUTORITAIRES = ['rooms', 'equipments', 'docs', 'notes'];
let instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z' };
const ecrituresServeur = [];
globalThis.fetch = async (chemin, options = {}) => {
  if (['PUT', 'POST', 'DELETE'].includes(options.method || 'GET')) ecrituresServeur.push(`${options.method} ${chemin}`);
  const corps = String(chemin).startsWith('/api/sync')
    ? { authoritativeStores: MAGASINS_AUTORITAIRES, ...instantaneServeur }
    : { ok: true };
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(corps) };
};

const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => {
  const minuterie = vraiSetTimeout(...arguments_);
  if (typeof minuterie?.unref === 'function') minuterie.unref();
  return minuterie;
};
globalThis.setInterval = () => 0;

await import('../central-sync.js');

/*
 * LES CONSOMMATEURS SONT PRIS DANS `index.html`, PAS CHOISIS ICI.
 *
 * Charger nommément le module que l'on veut éprouver reviendrait à éprouver un module que
 * l'application ne charge peut-être pas. On prend donc les scripts que `index.html` charge
 * vraiment, et parmi eux ceux qui installent un écouteur pour la divergence. Si plus aucun
 * ne le fait — module retiré du document, écouteur supprimé — l'assemblage n'a plus de
 * consommateur, et les épreuves ci-dessous tombent en disant exactement cela.
 */
const racine = new URL('../', import.meta.url);
const indexHtml = readFileSync(new URL('index.html', racine), 'utf8');
const scriptsCharges = [...indexHtml.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(trouve => trouve[1]);
for (const nom of scriptsCharges) {
  const chemin = new URL(nom, racine);
  if (!existsSync(chemin)) continue;
  if (!readFileSync(chemin, 'utf8').includes("addEventListener(SNAPSHOT_EVENTS.DIVERGED")
    && !readFileSync(chemin, 'utf8').includes("addEventListener('platform-entity-diverged'")) continue;
  await import(chemin.href);
}

const contrat = await import('../snapshot-diff-contract.js');

/* ------------------------------- Utilitaires ------------------------------- */

const SALLE = 'salle-A';
const SAISIE = 'Régie A — nom que je suis en train de taper';

/** Une fenêtre d'édition telle que les écrans de la plateforme en construisent. */
function ouvrirEditeur(store = 'rooms', id = SALLE) {
  const modale = document.createElement('div');
  modale.id = 'edit-room-modal';
  modale.className = 'modal';
  modale.dataset.entityStore = store;
  modale.dataset.entityId = String(id);

  const formulaire = document.createElement('form');
  const champ = document.createElement('input');
  champ.setAttribute('name', 'name');
  champ.value = '';
  const enregistrer = document.createElement('button');
  enregistrer.type = 'submit';
  enregistrer.textContent = 'Enregistrer';
  formulaire.append(champ, enregistrer);
  modale.appendChild(formulaire);
  document.body.appendChild(modale);
  return { modale, formulaire, champ, enregistrer };
}

/** Taper dans un champ : la valeur change ET l'événement part, comme sous les doigts. */
function taper(champ, texte) {
  champ.value = texte;
  champ.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
}

async function appliquer(serveur) {
  instantaneServeur = { initialized: true, data: {}, deleted: [], access: {}, serverTime: '2026-01-01T00:00:00.000Z', ...serveur };
  await db.enableCentralSync({ bootstrapLocal: false });
  await dom.respirer();
}

function poserLocal(nom, enregistrements) {
  magasins.clear();
  for (const enregistrement of enregistrements) table(nom).set(String(enregistrement.id), enregistrement);
}

/**
 * Les écritures qui touchent une FICHE.
 *
 * `applySnapshot` réécrit à chaque passage la préférence strictement locale
 * `settings/current-room` — quelle salle ce poste regarde. Elle ne quitte jamais le poste,
 * ne concerne aucune fiche et n'a rien à voir avec l'éditeur ouvert. La compter ferait
 * échouer l'invariant « rien n'est enregistré à la place de l'utilisateur » pour une raison
 * qui n'est pas celle qu'il surveille.
 */
const ecrituresDeFiche = () => ecrituresLocales
  .filter(entree => !(entree.nom === 'settings' && entree.id === 'current-room'));

const texteAffiche = () => document.body.textContent;
const boutons = () => Array.from(document.querySelectorAll('button'));
const boutonNomme = libelle => boutons().find(element => element.textContent.trim() === libelle);

/** Remet le document et le registre à zéro : une épreuve ne doit pas hériter de la précédente. */
async function repartirDeZero() {
  for (const noeud of [...document.body.childNodes]) document.body.removeChild(noeud);
  contrat.resetOpenEditors();
  ecrituresLocales.length = 0;
  ecrituresServeur.length = 0;
  await dom.respirer();
}

const MESSAGE_DIVERGENCE = 'Cette fiche a été modifiée ailleurs pendant votre saisie.';
const MESSAGE_SUPPRESSION = 'Cette fiche a été supprimée ailleurs pendant votre saisie.';

/* ═══════════════ La chaîne complète, de l'instantané à l'écran ═══════════════ */

test('DIV·1 — un instantané distant sur une saisie en cours devient une indication VISIBLE', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);

  const { champ } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);

  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), true,
    'une saisie non enregistrée doit être RECONNUE : sans cela, aucune divergence ne peut être émise');

  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Renommée par quelqu’un d’autre', _revision: 2 }] } });

  assert.ok(texteAffiche().includes(MESSAGE_DIVERGENCE),
    `l’écran n’affiche aucune indication de divergence. Affiché : « ${texteAffiche().slice(0, 200)} »`);
  assert.equal(champ.value, SAISIE, 'la saisie en cours doit être intacte : rien ne l’écrase');
  assert.deepEqual(ecrituresServeur, [], 'aucune écriture vers le serveur');
  assert.deepEqual(ecrituresDeFiche(), [], 'et rien d’enregistré à la place de l’utilisateur');

  assert.ok(boutonNomme('Voir la version reçue'), 'la version reçue doit pouvoir être consultée');
  assert.ok(boutonNomme('Conserver ma saisie'), 'garder sa saisie doit être une suite explicite');
});

test('DIV·2 — « Voir la version reçue » montre le distant SANS toucher au formulaire', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Nom venu du serveur', _revision: 2 }] } });

  assert.equal(texteAffiche().includes('Nom venu du serveur'), false,
    'la version reçue ne doit pas s’afficher tant qu’on ne l’a pas demandée');

  boutonNomme('Voir la version reçue').click();

  assert.ok(texteAffiche().includes('Nom venu du serveur'),
    'la version reçue doit être lisible une fois demandée');
  assert.equal(champ.value, SAISIE,
    'la consulter ne doit RIEN recopier dans le formulaire — sinon c’est un écrasement déguisé');
  assert.ok(boutonNomme('Masquer la version reçue'), 'et elle doit pouvoir se refermer');
  assert.deepEqual(ecrituresDeFiche(), []);
});

test('DIV·3 — « Conserver ma saisie » retire l’indication et MAINTIENT la protection', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Distant 1', _revision: 2 }] } });

  boutonNomme('Conserver ma saisie').click();

  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false, 'l’indication doit être refermée');
  assert.equal(champ.value, SAISIE, 'et la saisie toujours là');
  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), true,
    'la fiche reste protégée : un prochain instantané doit revenir le dire, pas écraser');

  // Et il revient effectivement le dire.
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Distant 2', _revision: 3 }] } });
  assert.ok(texteAffiche().includes(MESSAGE_DIVERGENCE),
    'un second changement distant doit à nouveau être signalé');
  assert.equal(champ.value, SAISIE);
});

test('DIV·4 — « Recharger » abandonne la saisie, mais seulement après confirmation', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ, modale } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Version du serveur', _revision: 2 }] } });

  boutonNomme('Recharger').click();
  assert.equal(champ.value, SAISIE,
    'un premier clic ne doit RIEN perdre : reprendre le distant efface une saisie humaine');
  assert.ok(boutonNomme('Confirmer : abandonner ma saisie'),
    'le bouton doit dire ce que le second clic va coûter');
  assert.equal(modale.parentNode !== null, true, 'et l’éditeur doit rester ouvert');

  const misAJour = [];
  window.addEventListener('platform-entity-updated', evenement => misAJour.push(evenement.detail));
  boutonNomme('Confirmer : abandonner ma saisie').click();
  await dom.respirer();

  assert.equal(modale.parentNode, null, 'le second clic ferme l’éditeur devenu périmé');
  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), false, 'et libère la protection');
  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false);
  assert.equal(misAJour.at(-1)?.record?.name, 'Version du serveur',
    'la version reçue est alors relayée aux vues, par le canal habituel');
  assert.deepEqual(ecrituresServeur, [], 'et toujours aucune écriture');
});

test('DIV·5 — fermer l’éditeur libère l’état et retire l’indication', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ, modale } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Distant', _revision: 2 }] } });
  assert.ok(texteAffiche().includes(MESSAGE_DIVERGENCE));

  modale.remove();
  await dom.respirer();

  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), false,
    'une fenêtre fermée ne protège plus rien : la laisser déclarée figerait la fiche pour toujours');
  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false,
    'et son indication doit partir avec elle');
});

test('DIV·6 — enregistrer libère l’état, et un éditeur PROPRE se rafraîchit normalement', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ, formulaire } = ouvrirEditeur();
  await dom.respirer();

  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), false,
    'ouvrir une fiche sans y toucher ne crée aucune saisie à protéger');

  taper(champ, SAISIE);
  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), true);

  formulaire.dispatchEvent(new globalThis.Event('submit', { bubbles: true }));
  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), false,
    'enregistrer, c’est cesser d’avoir une saisie à protéger');

  const misAJour = [];
  window.addEventListener('platform-entity-updated', evenement => misAJour.push(evenement.detail));
  await appliquer({ data: { rooms: [{ id: SALLE, name: 'Distant', _revision: 2 }] } });

  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false,
    'un éditeur propre ne doit pas être averti d’une divergence qui n’en est pas une');
  assert.equal(misAJour.at(-1)?.record?.name, 'Distant',
    'il suit la version distante, comme n’importe quelle vue ouverte');
});

test('DIV·7 — une suppression distante TRAVERSE la protection et neutralise l’enregistrement', async () => {
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);
  const { champ, formulaire, enregistrer, modale } = ouvrirEditeur();
  await dom.respirer();
  taper(champ, SAISIE);

  await appliquer({ data: { rooms: [] } });

  assert.ok(texteAffiche().includes(MESSAGE_SUPPRESSION),
    `la disparition doit être dite, pas devinée. Affiché : « ${texteAffiche().slice(0, 200)} »`);
  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false,
    'et elle remplace la divergence : il n’y a plus rien à arbitrer');
  assert.equal(enregistrer.disabled, true,
    'enregistrer une fiche qui n’existe plus ne doit même pas être proposé');
  assert.equal(contrat.hasDirtyEditor('rooms', SALLE), false,
    'la protection n’a plus d’objet : elle est libérée');

  const soumission = formulaire.dispatchEvent(new globalThis.Event('submit', { bubbles: true }));
  assert.equal(soumission, false, 'et une soumission forcée doit être refusée');
  assert.deepEqual(ecrituresServeur, []);
  assert.deepEqual(ecrituresDeFiche(), []);

  boutonNomme('Fermer').click();
  await dom.respirer();
  assert.equal(modale.parentNode, null, 'fermer retire l’éditeur devenu sans objet');
  assert.equal(texteAffiche().includes(MESSAGE_SUPPRESSION), false);
});

test('DIV·8 — une suppression distante SANS éditeur ouvert n’affiche rien', async () => {
  // Le relais ordinaire des vues fait déjà disparaître la fiche. Afficher un avertissement
  // pour une fiche que personne n'éditait transformerait ce canal en bruit permanent — la
  // synchronisation repart toutes les vingt secondes.
  await repartirDeZero();
  poserLocal('rooms', [{ id: SALLE, name: 'Régie A', _revision: 1 }]);

  await appliquer({ data: { rooms: [] } });

  assert.equal(texteAffiche().includes(MESSAGE_SUPPRESSION), false,
    'aucune saisie n’était en cours : il n’y a rien à protéger, donc rien à dire');
  assert.equal(texteAffiche().includes(MESSAGE_DIVERGENCE), false);
});

test('DIV·10 — les fenêtres d’édition réelles déclarent la fiche qu’elles éditent', () => {
  /*
   * PORTÉE DE CETTE ÉPREUVE — à lire avant de s'y fier.
   *
   * Tout le comportement est EXÉCUTÉ par DIV·1 à DIV·9, sur un document manipulable. Ce
   * qu'elles ne peuvent pas exécuter, c'est la construction des fenêtres réelles : chacune
   * dépend d'un écran entier, d'une session et d'un `innerHTML` que seul un navigateur
   * analyse. Cette épreuve-ci ne vérifie donc qu'une chose, et le dit : le RACCORDEMENT.
   *
   * Sans lui, la chaîne fonctionne dans les épreuves et nulle part ailleurs — une fenêtre
   * qui ne déclare pas ce qu'elle édite ne sera jamais reconnue comme une saisie en cours.
   * La déclaration doit de plus précéder l'insertion dans le document : l'observateur qui
   * la lit se déclenche à l'insertion, et non après.
   */
  const fenetres = [
    { fichier: 'salles.js', ancre: "modal.id = 'edit-room-modal'", magasin: "'rooms'" },
    { fichier: 'baies.js', ancre: "modal.id = 'edit-baie-modal'", magasin: "'baies'" },
    // La carte édite salles et baies avec la même fenêtre : le magasin dépend du type.
    { fichier: 'map-admin-entity-edit.js', ancre: "modal.id = 'map-entity-edit-modal'", magasin: "type === 'room' ? 'rooms' : 'baies'" },
    { fichier: 'equipements.js', ancre: "document.getElementById('eq-id').value", magasin: "'equipments'" }
  ];

  for (const { fichier, ancre, magasin } of fenetres) {
    const source = readFileSync(new URL(fichier, racine), 'utf8');
    const debut = source.indexOf(ancre);
    assert.notEqual(debut, -1, `${fichier} : fenêtre d’édition introuvable (${ancre})`);
    const bloc = source.slice(debut, debut + 900);
    assert.ok(bloc.includes(`dataset.entityStore = ${magasin}`),
      `${fichier} doit déclarer le magasin de la fiche éditée`);
    assert.ok(/dataset\.entityId = /.test(bloc),
      `${fichier} doit déclarer l’identifiant de la fiche éditée`);
    const insertion = bloc.indexOf('body.appendChild');
    if (insertion !== -1) {
      assert.ok(bloc.indexOf('dataset.entityId') < insertion,
        `${fichier} doit déclarer la fiche AVANT d’insérer la fenêtre dans le document`);
    }
  }
});

test('DIV·9 — une pierre tombale traverse elle aussi jusqu’à l’éditeur ouvert', async () => {
  /*
   * Jonction des deux blocages de ce lot. Une suppression portée UNIQUEMENT par
   * `snapshot.deleted`, sur un magasin ni autoritaire ni présent dans les données, doit
   * atteindre l'écran comme n'importe quelle autre — y compris pour interrompre une saisie.
   * C'est le chemin qui, jusqu'ici, retirait la fiche de la base sans un mot.
   */
  await repartirDeZero();
  poserLocal('notes', [{ id: 'N-TOMB', name: 'Note en cours de saisie', _revision: 1 }]);
  const { champ, enregistrer } = ouvrirEditeur('notes', 'N-TOMB');
  await dom.respirer();
  taper(champ, 'ce que je suis en train d’écrire');

  await appliquer({
    data: { rooms: [] },
    authoritativeStores: ['rooms'],
    deleted: [{ store: 'notes', id: 'N-TOMB' }]
  });

  assert.equal(table('notes').has('N-TOMB'), false, 'la fiche a bien quitté la base locale');
  assert.ok(texteAffiche().includes(MESSAGE_SUPPRESSION),
    'et l’écran doit le dire, au lieu de laisser saisir une fiche qui n’existe plus');
  assert.equal(enregistrer.disabled, true);
});
