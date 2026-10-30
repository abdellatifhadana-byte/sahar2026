import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { enPilote, replierLaCreation } from '../pilot-technique-shell.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const salles = lire('salles.js');
const baies = lire('baies.js');
const css = lire('pilot-technique-preview.css');

/*
 * @file PILOTE-UI-01 — le formulaire de création se replie sans cesser d'exister.
 *
 * Contrairement au reste de la prévisualisation, ce module est PUR : il ne touche au
 * document que pour lire une classe. On l'exécute donc réellement, en posant le `document`
 * minimal dont il a besoin, au lieu de relire son texte.
 */

const avecCorps = (classes, fn) => {
  const precedent = globalThis.document;
  globalThis.document = { body: { classList: { contains: c => classes.includes(c) } } };
  try { return fn(); } finally { globalThis.document = precedent; }
};

/* ── L'INTERFACE CLASSIQUE REÇOIT EXACTEMENT CE QU'ELLE RECEVAIT ──────────────────── */

/**
 * La prévisualisation doit rester réversible : hors `?pilote=1`, la page doit produire le
 * MÊME octet qu'avant ce lot. Pas « un formulaire équivalent » — le même.
 */
test('hors prévisualisation, le fragment ressort inchangé, à l’octet près', () => {
  const fragment = '<form id="add-salle-form"><input name="name" required></form>';
  avecCorps([], () => {
    assert.equal(replierLaCreation(fragment, 'Ajouter une salle'), fragment);
  });
  // Et même lorsque le corps porte d'autres classes de thème.
  avecCorps(['theme-admin', 'dark-theme'], () => {
    assert.equal(replierLaCreation(fragment, 'Ajouter une salle'), fragment);
  });
});

test('sous prévisualisation, le fragment est REPLIÉ, pas réécrit', () => {
  const fragment = '<form id="add-salle-form"><input name="name" required></form>';
  const rendu = avecCorps(['pilot-technique-ui'], () => replierLaCreation(fragment, 'Ajouter une salle'));
  assert.match(rendu, /<details class="pilot-create-panel">/);
  assert.match(rendu, /<summary>/);
  assert.match(rendu, /Ajouter une salle/);
  // Le formulaire lui-même traverse le repli sans une modification.
  assert.ok(rendu.includes(fragment), 'le formulaire d’origine doit être inclus tel quel');
});

/* ── LE REPLI N'EST PAS, ET NE DOIT PAS DEVENIR, UN MASQUAGE DE SÉCURITÉ ──────────── */

/**
 * Un rôle sans droit de création ne produit pas de formulaire : la page passe alors `''`.
 * Le dépliant ne doit pas naître quand même — un « Ajouter une salle » qui s'ouvre sur du
 * vide est un contrôle mort, et il laisserait croire à un droit qui n'existe pas.
 */
test('un fragment vide ne fabrique aucun dépliant', () => {
  avecCorps(['pilot-technique-ui'], () => {
    assert.equal(replierLaCreation('', 'Ajouter une salle'), '');
    assert.equal(replierLaCreation('   ', 'Ajouter une salle'), '');
    assert.equal(replierLaCreation(null, 'Ajouter une salle'), '');
    assert.equal(replierLaCreation(undefined, 'Ajouter une salle'), '');
  });
});

/**
 * LA VÉRIFICATION QUI COMPTE VRAIMENT.
 *
 * Le repli ne doit pas avoir déplacé la décision d'autorisation. Les deux pages doivent
 * continuer à décider `canCreate` AVANT d'appeler ce module, et lui passer `''` sinon —
 * et non lui passer le formulaire en le chargeant de le cacher. Le test lit donc la
 * condition réellement écrite au point d'appel.
 */
test('la permission de création reste évaluée par la page, en amont du repli', () => {
  const appelSalles = salles.slice(salles.indexOf('${replierLaCreation('), salles.indexOf('<form id="add-salle-form"'));
  assert.match(appelSalles, /canCreate && zoneOuverte \?/,
    'Salles doit garder sa condition de création intacte devant le repli');

  const appelBaies = baies.slice(baies.indexOf('${replierLaCreation('), baies.indexOf('<form id="add-baie-form"'));
  assert.match(appelBaies, /canCreate \?/,
    'Baies doit garder sa condition de création intacte devant le repli');

  // La branche refusée passe une chaîne vide : rien à replier, donc rien à masquer.
  // Le formulaire contient lui-même des `${…}`, donc la fin de l'appel se repère à son
  // libellé — le dernier argument — et non au premier `)}` rencontré.
  assert.match(salles, /: '', 'Ajouter une salle'\)\}/,
    "salles.js : la branche sans droit doit passer '' au repli");
  assert.match(baies, /: '', 'Ajouter une baie'\)\}/,
    "baies.js : la branche sans droit doit passer '' au repli");
});

/* ── LES CHAMPS, LES `name` ET LES `id` SONT CEUX D'AVANT ─────────────────────────── */

test('aucun champ de création n’a été retiré ni renommé', () => {
  for (const champ of ['name', 'location', 'locationId', 'responsibleId', 'image']) {
    assert.match(salles, new RegExp(`<(input|select)[^>]*name="${champ}"`),
      `champ de création de salle disparu : ${champ}`);
  }
  for (const champ of ['name', 'roomId', 'image']) {
    assert.match(baies, new RegExp(`<(input|select)[^>]*name="${champ}"`),
      `champ de création de baie disparu : ${champ}`);
  }
  // Les gestionnaires se lient par identifiant : il ne doit pas bouger.
  assert.match(salles, /getElementById\('add-salle-form'\)\.onsubmit/);
  assert.match(baies, /getElementById\('add-baie-form'\)\.onsubmit/);
});

/* ── LE DÉPLIANT EST HABILLÉ, ET SEULEMENT SOUS PRÉVISUALISATION ──────────────────── */

test('le dépliant n’est stylé que sous body.pilot-technique-ui', () => {
  assert.match(css, /body\.pilot-technique-ui \.pilot-create-panel \{/);
  assert.match(css, /body\.pilot-technique-ui \.pilot-create-panel > summary \{/);
  assert.doesNotMatch(css, /(?<!pilot-technique-ui[^{]{0,200})^\.pilot-create-panel\s*\{/m);
});

/* ── LE DRAPEAU EST RELU À CHAQUE RENDU ───────────────────────────────────────────── */

/**
 * `?pilote=0` retire la classe EN COURS DE SESSION. Une valeur lue une fois au chargement du
 * module et mémorisée survivrait à la sortie de prévisualisation : la page continuerait de
 * replier son formulaire dans une interface redevenue classique.
 */
test('l’état de prévisualisation est relu à chaque appel, jamais mémorisé', () => {
  assert.equal(avecCorps(['pilot-technique-ui'], enPilote), true);
  assert.equal(avecCorps([], enPilote), false);
  assert.equal(avecCorps(['pilot-technique-ui'], enPilote), true);
});

test('sans document — donc hors navigateur — le module ne jette pas', () => {
  const precedent = globalThis.document;
  globalThis.document = undefined;
  try {
    assert.equal(enPilote(), false);
    assert.equal(replierLaCreation('<form></form>', 'Ajouter'), '<form></form>');
  } finally { globalThis.document = precedent; }
});
