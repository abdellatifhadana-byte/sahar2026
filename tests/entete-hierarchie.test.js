import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const final = lire('ui-final.css');
const refresh = lire('ui-refresh.css');
const ops = lire('operations-suite.css');
const ui = lire('admin-ui.js');

/*
 * L'EN-TÊTE : DONNER UN POIDS À CHAQUE CHOSE.
 *
 * Le constat du propriétaire — « presque tous les éléments ont le même poids » — était en
 * réalité pire, et mesurable : l'ordre visuel était INVERSÉ.
 *
 *   « Synchronisé »        117 px, fond BLANC OPAQUE sur un en-tête bleu foncé
 *   « Carte interactive »  180 px, fond sombre translucide (.26)
 *   « Preuves terrain »    166 px, fond BLEU PLEIN
 *   nom de la personne     habillé en pastille, bloc à 52 px
 *   se déconnecter         rouge vif en permanence
 *   hauteurs : 26, 42, 38, 38, 38, 41, 42 — aucune ligne de base commune
 *
 * Un ÉTAT criait donc plus fort que les ACTIONS ; des deux actions jumelles, la secondaire
 * était la plus voyante ; le nom d'une personne se lisait comme un bouton ; et la seule
 * couleur saturée désignait l'action qu'on souhaite le MOINS déclencher par mégarde.
 *
 * Rien n'a été déplacé : trois modules dépendent de cette structure. Seul le POIDS change,
 * et il change LÀ OÙ CHAQUE ÉLÉMENT EST DÉJÀ DÉFINI — pas dans une couche de plus.
 */

/* ================================================ le contrat DOM est intact */

test('aucun élément de l’en-tête n’a bougé', () => {
  // `operations-suite` injecte le témoin dans `.header-right` ; `field-evidence-intake-ui`
  // se place juste après `#open-map-btn` ; `map-admin-entity-edit` cherche ce même bouton.
  // Déplacer l'un des trois casserait les autres en silence.
  assert.match(ui, /<div class="header-right"/);
  assert.match(ui, /id="open-map-btn"/);
  assert.match(ui, /id="quick-theme"/);
  assert.match(ui, /id="logout-btn"/);
  assert.match(ui, /class="user-avatar"/);
  assert.match(lire('field-evidence-intake-ui.js'), /headerRight\.querySelector\('#open-map-btn'\)/);
});

/* ================================================ les deux jumelles */

test('les deux actions partagent UNE déclaration, donc ne peuvent plus diverger', () => {
  // Deux règles séparées finiraient par se contredire — c'est exactement ce qui s'était
  // produit : fond sombre d'un côté, bleu plein de l'autre.
  assert.match(final, /\.admin-header \.btn-map,\s*\n\.admin-header #field-evidence-intake-open \{/);
  const bloc = final.slice(final.indexOf('.admin-header .btn-map,'), final.indexOf('.admin-header .btn.danger'));
  assert.match(bloc, /background: rgba\(255, 255, 255, \.13\)/);
  // Et le survol aussi, sinon elles se ressemblent au repos et divergent au survol.
  assert.match(bloc, /\.admin-header \.btn-map:hover,\s*\n\.admin-header #field-evidence-intake-open:hover/);
});

/* ================================================ l'état ne crie plus */

test('le témoin de synchronisation est habillé pour l’en-tête où il est injecté', () => {
  // Le composant est dessiné pour une surface CLAIRE (#edf3f7 sur #47687d) ; il est injecté
  // sur un en-tête bleu foncé, où il devenait le seul aplat blanc de la barre.
  assert.match(ops, /\.admin-header \.ops-header-sync \{/);
  const bloc = ops.slice(ops.indexOf('.admin-header .ops-header-sync {'));
  assert.match(bloc, /background: rgba\(255, 255, 255, \.10\)/);
});

/* ================================================ le nom n'est pas un bouton */

test('le nom de la personne est du texte, pas une pastille', () => {
  // La pastille portait le bloc d'identité à 52 px contre 38 pour tout le reste.
  assert.doesNotMatch(refresh, /\.admin-header \.user-name \{[^}]*border-radius: 999px/);
  const bloc = final.slice(final.indexOf('.admin-header .user-name {'));
  assert.match(bloc.slice(0, 260), /background: transparent !important/);
  assert.match(bloc.slice(0, 260), /padding: 0 !important/);
});

test('le bloc d’identité s’aligne sur la hauteur des contrôles', () => {
  // Sans `min-height`, il retombait à 15 px et cassait la ligne de l'en-tête.
  assert.match(refresh, /\.admin-header \.user-info \{[^}]*min-height: 38px/s);
});

/* ================================================ la sortie n'est pas une alarme */

test('se déconnecter est discret au repos, rouge quand on le vise', () => {
  const bloc = final.slice(final.indexOf('.admin-header .btn.danger {'), final.indexOf('.admin-sidebar {'));
  assert.match(bloc, /background: transparent !important/);
  assert.doesNotMatch(bloc.split(':hover')[0], /linear-gradient\(135deg, #f2525c/);
  // Mais il redevient rouge au survol ET au focus clavier — sinon il disparaît pour qui
  // navigue au clavier.
  assert.match(bloc, /\.admin-header \.btn\.danger:hover,\s*\n\.admin-header \.btn\.danger:focus-visible/);
  assert.match(bloc, /rgba\(231, 76, 60, \.95\) !important/);
});

/* ================================================ la feuille d'arbitrage reste arbitre */

test('rien de tout cela n’a été écrit dans la feuille d’arbitrage', () => {
  // `design-system.css` porte les jetons et les conflits arbitrés. Y écrire le style d'un
  // composant en fait un plaideur de plus — et ses propres gardes le refusent : géométrie
  // de mise en page interdite, `padding` limité au conflit arbitré, `!important` plafonnés.
  // Une première version de ce travail y avait été posée : trois gardes l'ont rejetée.
  const arbitrage = lire('design-system.css');
  assert.doesNotMatch(arbitrage, /header-right/);
  assert.doesNotMatch(arbitrage, /ops-header-sync/);
  assert.doesNotMatch(arbitrage, /#logout-btn/);
});

test('chaque correction est écrite là où l’élément est déjà défini', () => {
  // C'est ce qui empêche l'empilement : on modifie la déclaration qui GAGNAIT, au lieu
  // d'en ajouter une quatrième par-dessus.
  assert.ok(final.includes('#field-evidence-intake-open'), 'les jumelles ne sont pas traitées dans ui-final.css');
  assert.ok(ops.includes('.admin-header .ops-header-sync'), 'le témoin n’est pas traité dans sa propre feuille');
  assert.ok(refresh.includes('min-height: 38px'), 'l’identité n’est pas traitée dans ui-refresh.css');
});
