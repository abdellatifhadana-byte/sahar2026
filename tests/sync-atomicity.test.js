import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync(new URL('../central-sync.js', import.meta.url), 'utf8');
// Les commentaires de ce fichier décrivent le défaut corrigé et en citent donc le code.
// On n'analyse que les règles réelles.
const code = sync.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(ligne => /^\s*(\/\/|\*)/.test(ligne) ? '' : ligne).join('\n');

/*
 * LE DÉFAUT QUE CE FICHIER EMPÊCHE DE REVENIR
 *
 * `applySnapshot` vidait chaque magasin dans sa propre transaction, puis réinsérait les
 * enregistrements un par un, chacun dans encore une autre transaction. IndexedDB n'isole
 * que l'intérieur d'une transaction : entre le vidage et la dernière insertion, tout
 * lecteur voyait un magasin vide.
 *
 * Mesuré dans un navigateur, avant correction, sur un jeu pourtant modeste de 52
 * équipements et une machine locale rapide : la synchronisation durait 705 ms et
 * 116 sondes sur 132 — 88 % — lisaient un magasin VIDE. En production, sur mobile en 4G
 * avec 448 équipements, la fenêtre est bien plus longue.
 *
 * Symptômes rapportés et reproduits : la page Équipements s'affichait vide alors que le
 * tableau de bord comptait 448 appareils ; l'ouverture d'un équipement répondait
 * « Équipement introuvable ». Recharger « réparait » — le rechargement tombait hors de la
 * fenêtre. Et cela recommençait toutes les vingt secondes, ainsi qu'à chaque retour sur
 * l'onglet.
 *
 * Après correction, même mesure : durée 141 ms, minimum observé 52, aucune lecture à zéro.
 */

test('un magasin est remplacé en UNE seule transaction', () => {
  // C'est toute la garantie : un lecteur voit l'ancien contenu ou le nouveau, jamais un
  // entre-deux. Deux transactions — une pour vider, une pour remplir — la reperdraient.
  assert.match(code, /function replaceStoreAtomically\(storeName, records, \{ clearFirst, supprimes = \[\] \}\)/);
  const corps = code.slice(code.indexOf('function replaceStoreAtomically'));
  const fin = corps.indexOf('\n}');
  const fonction = corps.slice(0, fin);
  assert.equal((fonction.match(/db\.db\.transaction\(/g) || []).length, 1,
    'le remplacement doit ouvrir exactement une transaction');
  assert.match(fonction, /transaction\.oncomplete/, 'la promesse doit se résoudre sur oncomplete, pas sur la dernière requête');
  assert.match(fonction, /transaction\.onabort/, 'une transaction interrompue doit être signalée, pas silencieuse');
  // Les pierres tombales entrent dans le plan avant émission des mutations et gagnent donc
  // sur un entrant contradictoire.
  assert.match(fonction, /tombstones:\s*supprimes/,
    'les tombstones doivent participer à la décision atomique du magasin');
  assert.match(fonction, /for \(const id of plan\.deletes\) store\.delete\(id\)/,
    'les suppressions doivent se faire dans la transaction qui remplit le magasin');
  /*
   * Le vidage autoritaire est désormais un delta sélectif : il retire ce que le serveur ne
   * renvoie plus, préserve les survivants locaux explicitement autorisés, et ne réécrit pas
   * les fiches identiques.
   */
  assert.match(fonction, /survivesAuthoritativeClear\(storeName, enregistrement\)/,
    'le remplacement doit demander à qui appartient chaque fiche avant de l’effacer');
  assert.ok(fonction.indexOf('survivesAuthoritativeClear') < fonction.indexOf('store.put(payload)'),
    'la décision de conservation/suppression doit précéder les écritures');
  assert.match(fonction, /lecture\.onsuccess = \(\) => \{/,
    'décider quoi effacer suppose de connaître l’état d’avant : tout part du succès de la lecture');
});

test('aucun `await` ne coupe la transaction en cours de remplissage', () => {
  // Une transaction IndexedDB se referme d'elle-même dès que la file de microtâches se vide
  // sans requête en attente. Un seul `await` entre deux `put` suffirait à la faire expirer,
  // et l'atomicité serait perdue sans qu'aucun test fonctionnel ne s'en aperçoive.
  const debut = code.indexOf('function replaceStoreAtomically');
  const fonction = code.slice(debut, code.indexOf('\n}', debut));
  assert.doesNotMatch(fonction, /\bawait\b/, 'la boucle de remplissage ne doit contenir aucun await');
  assert.match(fonction, /for \(const record of plan\.puts\)/);
  assert.match(fonction, /store\.put\(payload\)/);
});

test('les enregistrements sont groupés par magasin avant d’écrire', () => {
  // Écrire au fil de l'eau rouvrirait une transaction par enregistrement — le défaut d'origine.
  assert.match(code, /const parMagasin = new Map\(\)/);
  assert.match(code, /parMagasin\.set\(storeName, \(records \|\| \[\]\)\.filter/);
  assert.match(code, /for \(const \[storeName, records\] of parMagasin\)/);
  assert.match(code, /await replaceStoreAtomically\(storeName, records/);
});

test('la règle de clé vide de `db.save` est reproduite', () => {
  // `db.save` supprime une clé vide pour laisser l'auto-incrément décider. Le chemin de
  // synchronisation n'appelle plus `db.save` : il doit appliquer la même règle lui-même,
  // sinon un enregistrement sans identifiant serait rejeté par IndexedDB.
  assert.match(code, /if \(payload\.id === '' \|\| payload\.id === undefined \|\| payload\.id === null\) delete payload\.id/);
});

test('les enregistrements strictement locaux restent exclus', () => {
  // `settings/current-room` est une préférence de poste. La faire passer par le snapshot
  // l'imposerait à tous les appareils de l'utilisateur.
  assert.match(code, /\.filter\(record => !isLocalOnlyRecord\(storeName, record\)\)/);
});

test('un magasin autoritaire sans aucun enregistrement est tout de même vidé', () => {
  // Cas d'une zone entièrement révoquée : le serveur n'envoie plus rien pour ce magasin.
  // Sans cette ligne, l'absence de données signifierait « ne touche à rien » et les
  // enregistrements de la zone retirée resteraient visibles hors ligne.
  assert.match(code, /for \(const storeName of authoritativeStores\) \{[\s\S]{0,160}parMagasin\.set\(storeName, \[\]\)/);
});
