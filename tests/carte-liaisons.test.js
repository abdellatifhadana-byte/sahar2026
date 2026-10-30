import test from 'node:test';
import assert from 'node:assert/strict';

import {
  masquer, liaisonsDe, carte, modulesActifs,
  modulesNonImportes, magasinsPartages, liaisonsInvisibles
} from '../scripts/carte-liaisons.mjs';

/*
 * LA CARTE DES LIAISONS INVISIBLES.
 *
 * Le propriétaire a fini par nommer le défaut de méthode : « كل الصفحات لها علاقات بينها…
 * لكن لاحظت أنك تقرأ فقط شيئ وتنسى عدة أشياء، عدة اتصالات وروابط لم تراها ». Il avait
 * raison, et la cause est mécanique.
 *
 * Cette plateforme ne se relie pas par `import`. Mesuré : 56 modules actifs — plus d'un
 * tiers — ne sont importés par PERSONNE. Ils enveloppent des prototypes, posent des objets
 * sur `window`, observent le DOM et décorent ce qui apparaît. Un graphe d'import n'en voit
 * aucun, et lire fichier par fichier encore moins.
 *
 * J'ai payé ce défaut au moins deux fois :
 *   — j'ai déclaré `equipment-media.js` « appelé par personne » après avoir cherché ses
 *     importateurs. Il décore le tableau et la fiche 360 par MutationObserver, et les
 *     photos constructeur qu'il affiche étaient sous mes yeux dans le navigateur ;
 *   — j'ai raté un cinquième dossier d'archive (`utils/`) faute de l'avoir cherché.
 *
 * Ces tests EXÉCUTENT l'outil. Une carte qu'on ne recalcule pas redevient une mémoire.
 */

/* ============================================== l'analyse ne se laisse pas tromper */

test('un nom cité dans un commentaire ne compte pas comme une liaison', () => {
  // Sans masquage, « on écrit dans db.save('rooms') » dans un commentaire ferait de ce
  // fichier un écrivain du magasin `rooms`. La carte deviendrait un roman.
  const source = `
    // db.save('rooms', x)
    /* window.Piege = 1 */
    const vrai = () => db.save('baies', y);
  `;
  const l = liaisonsDe('exemple.js', source);
  assert.deepEqual(l.ecritMagasin, ['baies']);
  assert.deepEqual(l.ecritGlobal, []);
});

test('le masquage garde longueur et lignes', () => {
  // Les décalages fausseraient toute position calculée sur la source masquée.
  const source = "const a = 1; // commentaire\n/* bloc\nsur deux lignes */\nconst b = 2;";
  const m = masquer(source);
  assert.equal(m.length, source.length);
  assert.equal((m.match(/\n/g) || []).length, (source.match(/\n/g) || []).length);
  assert.match(m, /const a = 1;/);
  assert.match(m, /const b = 2;/);
});

test('les cinq formes de liaison sont détectées', () => {
  const source = `
    AdminUI.prototype.initSections = function () {};
    window.MonModule = Object.freeze({});
    new MutationObserver(() => {}).observe(document.body, {});
    window.dispatchEvent(new CustomEvent('equipment-media-linkage-updated'));
    window.addEventListener('equipment-media-linkage-updated', () => {});
    await db.save('equipments', x); await db.getAll('rooms');
  `;
  const l = liaisonsDe('exemple.js', source);
  assert.ok(l.patchePrototype.some(p => p.includes('AdminUI.prototype.initSections')));
  assert.deepEqual(l.ecritGlobal, ['MonModule']);
  assert.equal(l.observeDOM, true);
  assert.deepEqual(l.emet, ['equipment-media-linkage-updated']);
  assert.deepEqual(l.ecoute, ['equipment-media-linkage-updated']);
  assert.deepEqual(l.ecritMagasin, ['equipments']);
  assert.deepEqual(l.litMagasin, ['rooms']);
});

/* ============================================== la carte réelle */

test('la carte couvre tout le graphe actif', () => {
  const c = carte();
  assert.equal(c.length, modulesActifs().length);
  assert.ok(c.length > 140, `seulement ${c.length} modules analysés`);
});

test('le module que j’avais déclaré « appelé par personne » est bien relié', () => {
  // `equipment-media.js` : aucun importateur, et pourtant il décore le tableau des
  // équipements et la fiche 360. Chercher ses importateurs était la mauvaise question.
  const media = carte().find(l => l.fichier === 'equipment-media.js');
  assert.ok(media, 'equipment-media.js n’est pas dans le graphe actif');
  assert.ok(media.observeDOM, 'il n’observe plus le DOM');
  assert.ok(media.ecritGlobal.includes('EquipmentMedia'), 'il ne pose plus window.EquipmentMedia');
  assert.ok(liaisonsInvisibles().some(l => l.fichier === 'equipment-media.js'),
    'il n’est plus classé comme liaison invisible');
});

test('les modules qui enveloppent AdminUI sont retrouvés', () => {
  // Une dizaine de sections s'ajoutent ainsi, sans qu'admin-ui.js les connaisse.
  const enveloppes = carte().filter(l => l.patchePrototype.some(p => p.startsWith('AdminUI.prototype')));
  assert.ok(enveloppes.length >= 3, `${enveloppes.length} enveloppes d’AdminUI trouvées`);
  assert.ok(enveloppes.some(l => l.fichier === 'locations-section.js'),
    'locations-section.js n’apparaît pas alors qu’il s’installe ainsi');
});

test('les écrivains multiples d’un même magasin sont listés', () => {
  // C'est la forme de divergence qui a fait tomber huit enregistrements en `to-confirm` :
  // deux écrivains sans lien de code, deux vocabulaires.
  const partages = magasinsPartages();
  const parNom = new Map(partages);
  assert.ok(parNom.has('docs'), '`docs` n’est plus détecté comme magasin partagé');
  assert.ok(parNom.get('docs').length > 10, `${parNom.get('docs').length} écrivains de docs`);
  assert.ok(parNom.has('equipments'));
});

test('une part importante du graphe n’est reliée par AUCUN import', () => {
  // C'est le fait central que cet outil existe pour rendre visible. S'il tombait à zéro,
  // ce serait que l'analyse ne fonctionne plus — pas que la plateforme a changé de nature.
  const invisibles = liaisonsInvisibles();
  assert.ok(invisibles.length > 30,
    `seulement ${invisibles.length} liaisons invisibles : l’analyse a cessé de voir`);
  assert.ok(invisibles.length < modulesActifs().length,
    'tous les modules sont classés invisibles : l’analyse est devenue aveugle dans l’autre sens');
});

test('les modules non importés sont un sur-ensemble des liaisons invisibles', () => {
  const nonImportes = new Set(modulesNonImportes().map(l => l.fichier));
  for (const l of liaisonsInvisibles()) {
    assert.ok(nonImportes.has(l.fichier), `${l.fichier} classé invisible mais pourtant importé`);
  }
});
