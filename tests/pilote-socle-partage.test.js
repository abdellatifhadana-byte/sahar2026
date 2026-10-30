import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const css = lire('pilot-technique-preview.css');
const notifications = lire('ui-notifications.css');

/*
 * @file PILOTE-UI-01 — le socle PARTAGÉ : ce qui rend les pages membres d'un même produit.
 *
 * Le lot précédent habillait la coque, la table des équipements, la Fiche 360 et la carte.
 * Restaient à découvert les surfaces que TOUTES les pages emploient — tables, fenêtres
 * d'édition, champs, pastilles de statut, notifications — si bien qu'une page non traitée
 * s'ouvrait en clair au milieu d'une coque sombre. Ce fichier éprouve la SOURCE, comme
 * `pilot-technique-v2.test.js` : on lit le texte, on n'exécute pas la feuille.
 */

/* ── LA GARANTIE QUI PORTE TOUT LE RESTE : L'INTERFACE CLASSIQUE EST INTOUCHÉE ────── */

/**
 * La prévisualisation doit rester RÉVERSIBLE. `?pilote=0` retire la classe
 * `pilot-technique-ui` et l'utilisateur doit retrouver l'interface d'origine — pas une
 * interface d'origine « presque » d'origine. Une seule règle non scopée dans cette feuille
 * suffirait à teindre la version classique de tous les rôles, y compris pour les comptes qui
 * n'ont jamais demandé la prévisualisation, et sans que rien ne le signale.
 *
 * La vérification est MÉCANIQUE plutôt que déclarative : elle lit chaque sélecteur écrit et
 * refuse celui qui ne se rattache pas au drapeau. Une règle ajoutée demain sans scope échoue
 * ici, même si personne n'a pensé à mettre ce fichier à jour.
 */
test('aucune règle de la feuille Pilote ne s’applique hors de body.pilot-technique-ui', () => {
  // Une virgule DANS `:is(…)` n'ouvre pas un nouveau sélecteur : découper naïvement sur la
  // virgule couperait `:is(.admin-header,.tech-header)` en deux fragments dont le second
  // paraîtrait non scopé. Le découpage suit donc la profondeur de parenthèses.
  const decouper = liste => {
    const parts = [];
    let courant = '', profondeur = 0;
    for (const ch of liste) {
      if (ch === '(') profondeur++;
      else if (ch === ')') profondeur--;
      if (ch === ',' && profondeur === 0) { parts.push(courant); courant = ''; continue; }
      courant += ch;
    }
    parts.push(courant);
    return parts;
  };

  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const nonScopes = [];
  for (const [, selecteur] of sansCommentaires.matchAll(/(?:^|[};])\s*([^{}@;]+?)\s*\{/g)) {
    const brut = selecteur.trim();
    if (!brut || brut.startsWith('@') || brut.startsWith('%')) continue;
    for (const part of decouper(brut)) {
      const s = part.trim();
      if (!s) continue;
      if (/(^|[\s>+~])(html|body)\.pilot-technique-ui\b/.test(s)) continue;
      if (/^:root$/.test(s)) continue;
      nonScopes.push(s);
    }
  }
  assert.deepEqual(nonScopes, [],
    `ces sélecteurs teindraient aussi l’interface classique : ${nonScopes.join(' | ')}`);
});

/* ── PLUS D'ÎLOT BLANC : LES FENÊTRES D'ÉDITION SONT DES SURFACES DU PRODUIT ──────── */

/**
 * Salles, Baies, Équipements, Utilisateurs, Tickets, Zones et Journal éditent tous par
 * `.modal` > `.modal-content` > `.form-group`. Habiller ces trois-là habille toutes les
 * fenêtres d'un coup ; en oublier une seule laisse un formulaire blanc au milieu du sombre.
 */
test('la fenêtre d’édition partagée est habillée : fond, champs et libellés', () => {
  for (const attendu of [
    /body\.pilot-technique-ui \.modal \{/,
    /body\.pilot-technique-ui \.modal-content \{/,
    /body\.pilot-technique-ui \.close-modal \{/,
    /body\.pilot-technique-ui \.form-group \.form-group label/.source ? /\.form-group label/ : /\.form-group label/
  ]) {
    assert.match(css, attendu, `surface d’édition non habillée : ${attendu}`);
  }
  // Les champs eux-mêmes, pas seulement leur conteneur.
  assert.match(css, /:is\(input,select,textarea,\.form-control\) \{/);
});

test('les champs respectent la hauteur de saisie bureau annoncée (38–42 px)', () => {
  const bloc = css.slice(css.indexOf(':is(input,select,textarea,.form-control) {'));
  const hauteur = bloc.match(/min-height:\s*(\d+)px/);
  assert.ok(hauteur, 'aucune hauteur de champ définie');
  const px = Number(hauteur[1]);
  assert.ok(px >= 38 && px <= 42, `hauteur de champ hors plage bureau : ${px}px`);
});

test('cases à cocher et boutons radio échappent à la pleine largeur des champs', () => {
  assert.match(css, /input\[type="checkbox"\],input\[type="radio"\]\)\s*\{[^}]*width:\s*auto/,
    'une case à cocher étirée sur toute la largeur du formulaire est un défaut visible');
});

/* ── LA MÊME TABLE PARTOUT ────────────────────────────────────────────────────────── */

/**
 * `.tableau` est la table de toute la plateforme. La densité doit être posée une fois pour
 * toutes les pages, et non recopiée page par page — c'est précisément la recopie qui avait
 * laissé Salles, Baies, Utilisateurs et Journal en clair.
 */
test('la densité de table est posée sur `.tableau`, pas seulement sur celle des équipements', () => {
  assert.match(css, /body\.pilot-technique-ui \.tableau \{/);
  assert.match(css, /body\.pilot-technique-ui \.tableau th \{/);
  assert.match(css, /body\.pilot-technique-ui \.tableau td \{/);
});

test('la hauteur de ligne reste dans la densité de supervision annoncée (44–48 px)', () => {
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui .tableau td {'));
  const hauteur = Number(bloc.match(/height:\s*(\d+)px/)[1]);
  assert.ok(hauteur >= 44 && hauteur <= 48, `hauteur de ligne hors plage : ${hauteur}px`);
});

/**
 * Le masquage des colonnes secondaires ne vaut QUE pour la table des équipements, qui porte
 * dix-huit colonnes. L'appliquer à `.tableau` en général effacerait des colonnes utiles de
 * Salles, Baies ou Utilisateurs — des données réelles disparues sans que rien ne le dise.
 */
test('le masquage de colonnes reste borné à la table des équipements', () => {
  for (const [, selecteur] of css.matchAll(/([^{}]*nth-child\(\d+\)[^{}]*)\{\s*display:\s*none/g)) {
    assert.match(selecteur, /pilot-equipments-shell/,
      `masquage de colonne hors du parc équipements : ${selecteur.trim()}`);
  }
});

/* ── NOTIFICATIONS : INFORMER SANS MASQUER ────────────────────────────────────────── */

/**
 * `ui-notifications.css` pose largeur, position et fond en `!important`. Une reprise sans
 * `!important` serait écrite, chargée… et sans effet : le bandeau garderait sa taille. Le
 * test compare les deux feuilles au lieu de faire confiance à la lecture.
 */
test('la reprise des notifications l’emporte réellement sur la feuille de base', () => {
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui .notification-center {'));
  for (const propriete of ['top', 'right', 'width']) {
    assert.match(notifications, new RegExp(`${propriete}:[^;]*!important`),
      `pré-requis du test caduc : ui-notifications.css ne force plus ${propriete}`);
    assert.match(bloc.slice(0, 260), new RegExp(`${propriete}:[^;]*!important`),
      `${propriete} repris sans !important : la règle serait sans effet`);
  }
});

test('le bandeau rétrécit au lieu de couvrir la colonne d’actions', () => {
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui .notification-center {'));
  const largeur = Number(bloc.match(/width:\s*min\((\d+)px/)[1]);
  const base = Number(notifications.match(/width:\s*min\((\d+)px/)[1]);
  assert.ok(largeur < base, `le bandeau doit rétrécir (${largeur}px vs ${base}px)`);
});

/* ── ACCESSIBILITÉ ────────────────────────────────────────────────────────────────── */

test('le focus clavier reste visible et l’animation se retire à la demande', () => {
  assert.match(css, /:focus-visible \{[^}]*outline:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
