/**
 * @file tests/sync-reconcile-idle-nowrite.test.js — #164 SYNC-RECONCILE-LOOP-01.
 *
 * LA BOUCLE
 * ----------
 *      synced → scheduleReconcile → ensure*() → db.save → sync → synced → …
 *
 * Mesurée à l'origine : 617–796 écritures locales et 129–218 PUT HTTP en 26 s, sans action
 * utilisateur. PR #169 a supprimé la tempête réseau ; il restait 576 écritures locales par
 * minute, dont 336 sur `kb-*`.
 *
 * CE QUI FERME LA BOUCLE, ET QU'IL FAUT DONC ÉPROUVER
 * ----------------------------------------------------
 * `central-sync-transition-guard.js` — installé par `write-coherence.js`, chargé juste après
 * `central-sync.js` (`index.html`), donc AVANT les enrichisseurs. Il laisse passer le PREMIER
 * `synced`, tout retour à `synced` depuis un autre état terminal, et le `synced` qui suit un
 * `platform-snapshot-applied` NON VIDE. Il filtre uniquement les battements `synced` répétés
 * d'un état stable sans diff, par `stopImmediatePropagation()` en phase de CAPTURE.
 *
 * C'est la pièce que les épreuves précédentes ne chargeaient pas — et sans elle, la mesure
 * ment dans les deux sens.
 *
 * POURQUOI CE FICHIER EXISTE, ALORS QUE LA SONDE POSTGRESQL EXISTE DÉJÀ
 * ----------------------------------------------------------------------
 * `scripts/churn-instrumentation.mjs` mesure contre un vrai serveur, mais n'exerce qu'UN
 * consommateur réel. Or vingt modules écoutent `central-sync-status` et douze peuvent
 * écrire. Ce fichier couvre la famille active, de façon déterministe et sans serveur.
 *
 * UN ÉCUEIL MESURÉ, ET ÉVITÉ ICI
 * -------------------------------
 * Une version antérieure diffusait `synced` directement sur `window`, sans phase de capture
 * ni `stopImmediatePropagation` : la garde ne pouvait pas agir, et deux modules se
 * réécrivaient l'un l'autre indéfiniment. Le répartiteur d'événements de ce fichier respecte
 * donc la capture et `stopImmediatePropagation`, comme un vrai navigateur — sinon l'épreuve
 * mesurerait un défaut qui n'existe que dans l'épreuve.
 *
 * UN JUGEMENT DE #164 QUE #98 A CORRIGÉ
 * --------------------------------------
 * Ce fichier a d'abord constaté que `equipment-field-evidence.js` et `-phase12.js`
 * produisaient DEUX ordres de clés stables pour les deux seules fiches qu'ils partagent —
 * `kb-evertz-x0401h` et `kb-avid-dnxiq` — à contenu IDENTIQUE, et que leur comparaison par
 * `JSON.stringify` faisait donc voir à chacun l'écriture de l'autre comme un changement. Il
 * en concluait : « ce n'est PAS un défaut à corriger dans ces modules », puisque la garde
 * empêchait la boucle au repos.
 *
 * Cette conclusion était trop courte, et la mesure de #98 l'a montrée fausse. La garde filtre
 * les battements RÉPÉTÉS ; elle laisse évidemment passer la transition `synced` LÉGITIME de
 * chaque chargement de page. À chacune de ces transitions, les deux modules réécrivaient
 * bel et bien leurs fiches — jusqu'au serveur, dont la révision montait 1 → 2 → 3 → … sans
 * qu'un champ métier ne bouge. Mesuré sur main@f2bc8a6, trois bases neuves : cinq PUT
 * automatiques par fenêtre de repos.
 *
 * La cause n'était pas la garde mais la comparaison elle-même : `current` revient du serveur
 * rangé en `jsonb`, un format qui RÉORDONNE les clés. `recordsExactlyEqual` (#171) a remplacé
 * `JSON.stringify` dans ces modules, et les fiches partagées ne sont plus une exception :
 * elles sont désormais couvertes par les mêmes assertions que les autres.
 *
 * Aucune dépendance de développement : les deux chaînes installent `--omit=dev`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = fichier => fs.readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');

/* ═══════════════════ PHASE 1 — LE CONTRAT D'INVENTAIRE ═══════════════════
 *
 * Recensé depuis la SOURCE, pas de mémoire. Toute nouvelle plume qui se réveille sur
 * `synced` sans être classée fait échouer l'épreuve : c'est ainsi que la couverture ne se
 * périme pas en silence.
 */

const MODULES_SERVIS = fs.readdirSync(new URL('../', import.meta.url))
  .filter(nom => nom.endsWith('.js'))
  .sort();

/**
 * « UN-COUP » SE JUGE ÉCOUTEUR PAR ÉCOUTEUR, JAMAIS FICHIER PAR FICHIER.
 *
 * Ce classement cherchait un `removeEventListener('central-sync-status', …)` N'IMPORTE OÙ
 * dans le fichier. Une revue extérieure a montré ce que cela laissait passer :
 * `equipment-knowledge-extra.js` en contient bien un — celui de l'écouteur TEMPORAIRE
 * d'`attendreDecisionSync`, qui se retire tout seul — mais il porte AUSSI un écouteur
 * PERMANENT qui rappelle `reconcileCentralCatalog()` à chaque `synced` et ne se retire
 * jamais. Le fichier était donc déclaré « un-coup » alors qu'il écoute pour toujours, et
 * l'inventaire mentait sur la seule chose qu'il existe pour dire.
 *
 * La règle exacte est simple, et elle tient à la façon dont le DOM fonctionne : on ne peut
 * retirer un écouteur qu'en le DÉSIGNANT. Un écouteur passé en fonction anonyme n'est donc
 * retirable par personne — il est permanent, par construction. Un écouteur passé par son
 * nom est « un-coup » si, et seulement si, CE nom-là reparaît dans un retrait.
 *
 * Un module n'est « un-coup » que si TOUS ses écouteurs le sont.
 */
function ecouteursUnSeulCoup(source) {
  const inscriptions = [...source.matchAll(/addEventListener\(\s*['"]central-sync-status['"]\s*,\s*([^,)]+)/g)]
    .map(trouve => trouve[1].trim());
  if (!inscriptions.length) return false;
  const retires = new Set([...source.matchAll(/removeEventListener\(\s*['"]central-sync-status['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)]
    .map(trouve => trouve[1]));
  return inscriptions.every(argument => /^[A-Za-z_$][\w$]*$/.test(argument) && retires.has(argument));
}

/** Ce que la source dit d'un module, sans interprétation. */
function classerDepuisLaSource(nom) {
  const source = lire(nom);
  if (!/addEventListener\(\s*['"]central-sync-status['"]/.test(source)) return null;
  return {
    module: nom,
    reagitAuSynced: /central-sync-status[\s\S]{0,240}?['"]synced['"]/.test(source),
    unSeulCoup: ecouteursUnSeulCoup(source),
    peutEcrire: /db\.(?:save|saveLocalOnly|delete|clear)\s*\(/.test(source),
    magasins: [...new Set([...source.matchAll(/db\.(?:save|saveLocalOnly)\(\s*['"`]([a-zA-Z_]+)/g)].map(m => m[1]))].sort(),
    comparaison: /recordsExactlyEqual/.test(source) ? 'sémantique'
      : (/JSON\.stringify\([^)]*\)\s*===\s*JSON\.stringify\(/.test(source) ? 'JSON.stringify' : 'aucune')
  };
}

/**
 * L'INVENTAIRE DÉCLARÉ.
 *
 * `couverture` dit comment le module est tenu :
 *   · `exercé`    — ce fichier le charge et éprouve sa convergence ;
 *   · `un-coup`   — barrière à un seul déclenchement, il se retire lui-même de l'écoute ;
 *   · `sans-écriture` — son écoute de `synced` ne mène à aucune persistance.
 *
 * `ecritSurSynced` dit COMMENT, et c'est là qu'une revue précédente s'est trompée :
 *   · `directe`   — le handler appelle `db.save` / `ensure*` / `scheduleReconcile` ;
 *   · `indirecte` — le handler appelle un ORDONNANCEUR qui, lui, finit par persister ;
 *   · `aucune`    — rien ne persiste par ce chemin.
 *
 * `declencheur` nomme la fonction par laquelle ça passe. L'épreuve vérifie qu'elle existe
 * TOUJOURS dans la source et qu'elle est TOUJOURS appelée depuis le handler : une plume
 * indirecte ne peut donc plus être classée « lecture seule » par accident.
 *
 * `inerte` justifie qu'une famille exercée n'écrive pas dans ce harnais, et dit qui la tient.
 */
const INVENTAIRE = Object.freeze({
  'grille-centrale-knowledge.js':             { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'schedule',
                                                inerte: 'sans jeu de données AUTORISÉ, `loadGrilleCentraleDataset()` rend null et le module s’abstient — c’est le contrat #166 ; tenu par tests/grille-canonical-equipment.test.js et tests/grille-fiche-360-nowrite.test.js' },
  'equipment-field-evidence.js':              { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'schedule',
                                                inerte: 'depuis #98 la comparaison est insensible à l’ordre des clés : sur un décor déjà convergé ces preuves n’ont plus rien à réécrire ; tenu par tests/startup-sync-no-rewrite-98.test.js et tests/field-evidence-phase11.test.js' },
  'equipment-field-evidence-phase12.js':      { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'schedule',
                                                inerte: 'même remède qu’en phase 11 (#98) : plus de réécriture sur un décor déjà convergé ; tenu par tests/startup-sync-no-rewrite-98.test.js et tests/field-evidence-phase12.test.js' },
  'equipment-media-linkage.js':               { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'aucun catalogue à rapprocher dans ce harnais ; tenu par tests/equipment-media-linkage.test.js' },
  'field-evidence-integration.js':            { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'aucune preuve terrain à intégrer ici ; tenu par tests/field-evidence-phase11.test.js et tests/field-evidence-phase12.test.js' },
  'grille-centrale-documented-map.js':        { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'jeu de données protégé non autorisé ici ; tenu par tests/grille-centrale-documented-map.test.js' },
  'grille-centrale-field-verification.js':    { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'jeu de données protégé non autorisé ici ; tenu par tests/grille-centrale-field-verification.test.js' },
  'grille-centrale-physical-architecture.js': { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'jeu de données protégé non autorisé ici ; tenu par tests/grille-centrale-physical-architecture.test.js' },
  'grille-centrale-topology.js':              { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'scheduleReconcile',
                                                inerte: 'jeu de données protégé non autorisé ici ; tenu par tests/grille-fiche-360-nowrite.test.js (les quatre panneaux)' },
  'routing-knowledge-seed.js':                { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'seedRoutingKnowledge',
                                                inerte: 'ensemencé à l’import, il reconverge sans réécrire ; tenu par tests/routing-knowledge.test.js et tests/equipment-internals-routing.test.js' },
  /*
   * LA PLUME INDIRECTE QU'UNE CLASSIFICATION PRÉCÉDENTE AVAIT MANQUÉE.
   *
   *   synced → centralSynced = true → scheduleCatalogInstall()
   *          → installCentralCatalogOnce()
   *          → POST /api/sync/catalog-install
   *          → mirrorCentralVersion() → saveLocalOnly('settings', 'global')
   *
   * Elle était classée « sans-écriture » parce que son handler ne contient ni `db.save` ni
   * `ensure*` : le validateur ne suivait pas les ordonnanceurs. Elle persiste bel et bien —
   * légitimement, et une seule fois : au-delà de `CENTRAL_CATALOG_VERSION`, l'installation
   * répond `already-current` sans rien poster ni écrire.
   */
  'catalog-seed-guard.js':                    { couverture: 'exercé', ecritSurSynced: 'indirecte', declencheur: 'scheduleCatalogInstall' },
  /*
   * Classé « un-coup » à tort jusqu'ici : le `removeEventListener` que ce fichier contient
   * appartient à l'écouteur TEMPORAIRE d'`attendreDecisionSync`, pas à l'écouteur PERMANENT
   * qui rappelle `reconcileCentralCatalog()` à chaque `synced`. Il est donc bel et bien un
   * consommateur PERSISTANT, et il est désormais exercé comme tel : le harnais le charge,
   * ce qui déclenche aussi son amorçage `seedExtraCatalog()` — le chemin par lequel la
   * correction du LT4448 repartait à chaque chargement de page.
   */
  'equipment-knowledge-extra.js':             { couverture: 'exercé', ecritSurSynced: 'directe', declencheur: 'reconcileCentralCatalog',
                                                inerte: 'après la correction unique du LT4448, ni l’amorçage ni la réconciliation n’ont plus rien à écrire ; tenu par tests/startup-sync-no-rewrite-98.test.js et tests/equipment-knowledge-extra.test.js' },
  'regie-car-inventory-phase16.js':           { couverture: 'un-coup', ecritSurSynced: 'aucune' },
  'central-sync-decision.js':                 { couverture: 'un-coup', ecritSurSynced: 'aucune' },
  'central-sync-transition-guard.js':         { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  'data-visibility-recovery.js':              { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  'grille-centrale-dataset.js':               { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  // Même rôle que ci-dessus pour le relevé de la Régie Car (A-5) : un transport, qui oublie
  // sa mémoire quand la session tombe. Il ne touche jamais au magasin.
  'regie-car-dataset.js':                     { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  'notifications.js':                         { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  'operations-suite.js':                      { couverture: 'sans-écriture', ecritSurSynced: 'aucune' },
  'signal-spine.js':                          { couverture: 'sans-écriture', ecritSurSynced: 'aucune' }
});

/**
 * Le corps du/des handler(s) `central-sync-status`, découpé par ÉQUILIBRE DES PARENTHÈSES.
 *
 * Une découpe au saut de ligne ratait les handlers multi-lignes indentés — précisément celui
 * de `catalog-seed-guard.js`, la plume indirecte que cette épreuve doit voir.
 */
function corpsDesHandlers(nom) {
  const source = lire(nom);
  const corps = [];
  const marqueur = /addEventListener\(\s*['"]central-sync-status['"]/g;
  let trouve;
  while ((trouve = marqueur.exec(source))) {
    let profondeur = 0;
    let fin = trouve.index;
    for (; fin < source.length; fin += 1) {
      if (source[fin] === '(') profondeur += 1;
      else if (source[fin] === ')') { profondeur -= 1; if (profondeur === 0) break; }
    }
    corps.push(source.slice(trouve.index, fin + 1));
  }
  return corps;
}

const CONSOMMATEURS = MODULES_SERVIS.map(classerDepuisLaSource).filter(Boolean);

test('#164 · contrat d’inventaire — aucune plume « synced » non classée', () => {
  const vus = new Set(CONSOMMATEURS.map(entree => entree.module));
  const declares = new Set(Object.keys(INVENTAIRE));

  const nouveaux = [...vus].filter(nom => !declares.has(nom));
  assert.deepEqual(nouveaux, [],
    `nouveau consommateur de « central-sync-status » non classé : ${nouveaux.join(', ')} — ` +
    'le classer dans INVENTAIRE et, s’il écrit, l’ajouter aux familles exercées');

  const disparus = [...declares].filter(nom => !vus.has(nom));
  assert.deepEqual(disparus, [],
    `module déclaré mais qui n’écoute plus : ${disparus.join(', ')} — retirer l’entrée`);

  /*
   * « aucune écriture » SE JUGE SUR LE HANDLER, ET SUIT LES ORDONNANCEURS.
   *
   * `operations-suite.js` écrit des notes ailleurs, mais son écoute de `synced` n'actualise
   * qu'une pastille : le fichier ne dit rien, le handler dit tout.
   *
   * Et surtout : un handler qui appelle `scheduleQuelqueChose()` est une plume INDIRECTE,
   * même sans `db.save` visible. C'est ainsi que `catalog-seed-guard.js` avait été mal
   * classé. Le motif est générique — tout `schedule*`/`ensure*`/`install*` compte — pour
   * qu'une plume indirecte future ne passe pas non plus.
   */
  const PERSISTANCE_DIRECTE = /db\.(?:save|saveLocalOnly|delete|clear)\s*\(/;
  const ORDONNANCEUR = /\b(?:schedule|ensure|install|reconcile|seed)[A-Z]\w*\s*\(/;

  for (const entree of CONSOMMATEURS) {
    const declare = INVENTAIRE[entree.module];
    const handlers = corpsDesHandlers(entree.module);
    assert.ok(handlers.length > 0, `« ${entree.module} » : handler « central-sync-status » introuvable`);
    const corps = handlers.join('\n');

    if (declare.ecritSurSynced === 'aucune') {
      /*
       * UN ORDONNANCEUR NE SUFFIT PAS À CONDAMNER : ENCORE FAUT-IL QUE LE MODULE SACHE
       * PERSISTER.
       *
       * `data-visibility-recovery.js` appelle `scheduleRefresh()` depuis son handler, mais
       * le fichier entier ne contient AUCUNE primitive d'écriture : il rafraîchit des vues
       * et publie des événements. Le condamner serait un faux positif — et un faux positif
       * dans un contrat d'inventaire pousse à mal classer pour faire passer l'épreuve.
       *
       * La question posée est donc : ce module PEUT-IL persister ? S'il ne le peut pas,
       * « aucune » est prouvé. S'il le peut, alors un ordonnanceur dans son handler en fait
       * une plume INDIRECTE — c'est exactement le cas de `catalog-seed-guard.js`.
       */
      if (!entree.peutEcrire) continue;
      assert.ok(!PERSISTANCE_DIRECTE.test(corps),
        `« ${entree.module} » est déclaré sans persistance mais son handler écrit`);
      assert.ok(!ORDONNANCEUR.test(corps),
        `« ${entree.module} » sait persister ET son handler appelle un ordonnanceur — ` +
        'c’est une plume INDIRECTE, la reclasser et l’exercer');
      continue;
    }

    // Une plume qui persiste, directement ou non, doit NOMMER son déclencheur — et il doit
    // être appelé depuis le handler ET exister dans la source.
    assert.ok(declare.declencheur, `« ${entree.module} » persiste sur synced : déclarer son déclencheur`);
    assert.match(corps, new RegExp(`\\b${declare.declencheur}\\s*\\(`),
      `« ${entree.module} » : « ${declare.declencheur} » n’est plus appelé depuis le handler`);
    assert.match(lire(entree.module), new RegExp(`(?:function|const|let)\\s+${declare.declencheur}\\b`),
      `« ${entree.module} » : « ${declare.declencheur} » n’existe plus dans la source`);
  }

  // Et une plume « un-coup » doit réellement se retirer de l'écoute.
  for (const entree of CONSOMMATEURS) {
    if (INVENTAIRE[entree.module].couverture !== 'un-coup') continue;
    assert.equal(entree.unSeulCoup, true,
      `« ${entree.module} » est classé un-coup mais ne se retire pas de l’écoute`);
  }
});

test('#164 · les comparaisons sensibles à l’ordre des clés sont RECENSÉES, pas ignorées', () => {
  /*
   * CE RECENSEMENT A DÉJÀ SERVI UNE FOIS, ET C'EST TOUT SON INTÉRÊT.
   *
   * Il listait quatre modules comparant par `JSON.stringify`. Deux d'entre eux —
   * `equipment-field-evidence.js` et `-phase12.js` — ont été mesurés en #98 : ils
   * réécrivaient bel et bien leurs fiches à CHAQUE chargement de page, jusqu'au serveur,
   * parce que `current` revient rangé en `jsonb` (clés réordonnées). Ils comparent
   * désormais par `recordsExactlyEqual` et ont quitté cette liste.
   *
   * Les deux qui restent n'ont PAS été mesurés comme producteurs au repos sur main@f2bc8a6 —
   * c'est pourquoi ils ne sont pas modifiés ici, la règle étant de ne corriger que ce qu'une
   * mesure accuse. Ils portent la même fragilité latente : si l'un d'eux se met un jour à
   * écrire au repos, c'est ici qu'il faudra revenir.
   */
  const sensibles = CONSOMMATEURS.filter(entree => entree.comparaison === 'JSON.stringify').map(entree => entree.module).sort();
  assert.deepEqual(sensibles, [
    'equipment-media-linkage.js',
    'regie-car-inventory-phase16.js'
  ], 'la liste des comparaisons sensibles à l’ordre a changé — la reclasser explicitement');

  /*
   * Les deux fiches autrefois exemptées restent le témoin de ce défaut : elles doivent
   * continuer d'exister dans les deux modules, sans quoi les épreuves qui les nomment plus
   * bas deviendraient vertes faute de sujet.
   */
  const partages = ['kb-evertz-x0401h', 'kb-avid-dnxiq'];
  const a = lire('equipment-field-evidence.js');
  const b = lire('equipment-field-evidence-phase12.js');
  for (const identifiant of partages) {
    assert.ok(a.includes(identifiant) && b.includes(identifiant),
      `« ${identifiant} » doit rester la fiche partagée que cette épreuve documente`);
  }
  // Et ces deux-là ne doivent plus jamais revenir à une comparaison ordonnée.
  for (const [module, source] of [['equipment-field-evidence.js', a], ['equipment-field-evidence-phase12.js', b]]) {
    assert.ok(source.includes('recordsExactlyEqual'),
      `« ${module} » doit comparer par contenu, pas par ordre de clés (#98)`);
  }
});

/* ═══════════════════ UN NAVIGATEUR MINIMAL, MAIS FIDÈLE ═══════════════════ */

class Element {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase(); this.id = ''; this.className = '';
    this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this._html = ''; this._text = '';
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); } get textContent() { return this._text; }
  setAttribute(nom, valeur) { this.attributes[nom] = String(valeur); }
  getAttribute(nom) { return this.attributes[nom] ?? null; }
  removeAttribute() {} addEventListener() {} removeEventListener() {}
  appendChild(n) { this.children.push(n); return n; }
  prepend(n) { this.children.unshift(n); return n; }
  insertBefore(n) { this.children.push(n); return n; }
  remove() {}
  get nextSibling() { return null; }
  querySelector() { return null; } querySelectorAll() { return []; }
  closest() { return null; } matches() { return false; }
}
globalThis.Element = Element;

/*
 * LE RÉPARTITEUR D'ÉVÉNEMENTS EST LA PIÈCE CRITIQUE.
 *
 * La garde de transition écoute en phase de CAPTURE et appelle `stopImmediatePropagation()`.
 * Un répartiteur naïf qui parcourt les auditeurs dans l'ordre d'inscription la rendrait
 * inopérante — et l'épreuve mesurerait alors une boucle que le produit n'a pas.
 */
const auditeurs = new Map();
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type; this.detail = init?.detail;
    this._stop = false;
    this.stopImmediatePropagation = () => { this._stop = true; };
    this.stopPropagation = () => {};
  }
};
globalThis.window = {
  addEventListener(type, fonction, options) {
    if (!auditeurs.has(type)) auditeurs.set(type, []);
    auditeurs.get(type).push({ fonction, capture: Boolean(options === true || options?.capture) });
  },
  removeEventListener(type, fonction) {
    const liste = auditeurs.get(type); if (!liste) return;
    const index = liste.findIndex(entree => entree.fonction === fonction);
    if (index >= 0) liste.splice(index, 1);
  },
  dispatchEvent(evenement) {
    const liste = auditeurs.get(evenement.type) || [];
    // Capture d'abord, comme un navigateur — c'est là que la garde agit.
    for (const entree of [...liste.filter(e => e.capture), ...liste.filter(e => !e.capture)]) {
      if (evenement._stop) break;
      entree.fonction(evenement);
    }
    return !evenement._stop;
  }
};
globalThis.document = {
  createElement: balise => new Element(balise), head: new Element('head'), body: new Element('body'),
  documentElement: new Element('html'), getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible'
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.localStorage = {
  getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 'u-admin', role: 'admin', authVersion: 1 }) : null),
  setItem() {}, removeItem() {}, clear() {}
};

/* L'ordonnanceur, sous contrôle : la preuve est que les rappels ont tourné, pas qu'un délai
 * s'est écoulé. Un module qui se reprogrammerait sans fin épuise les tours — et c'est ROUGE. */
const microtaches = []; const minuteries = [];
globalThis.queueMicrotask = fonction => microtaches.push(fonction);
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fonction, delai = 0, ...reste) => {
  const jeton = { fonction, delai, reste, annule: false };
  minuteries.push(jeton); return jeton;
};
globalThis.clearTimeout = jeton => { if (jeton && typeof jeton === 'object') jeton.annule = true; };
globalThis.setInterval = globalThis.setTimeout;
globalThis.clearInterval = globalThis.clearTimeout;
globalThis.requestAnimationFrame = fonction => globalThis.setTimeout(fonction, 0);

const TOURS_MAXIMUM = 90;
const ordonnancement = { programmees: 0, executees: 0 };
async function drainer() {
  for (let tour = 1; tour <= TOURS_MAXIMUM; tour += 1) {
    for (const fonction of microtaches.splice(0)) { try { await fonction(); } catch { /* les modules avalent déjà */ } }
    const jetons = minuteries.splice(0);
    ordonnancement.programmees += jetons.length;
    for (const jeton of jetons) {
      if (jeton.annule) continue;
      ordonnancement.executees += 1;
      try { await jeton.fonction(...jeton.reste); } catch { /* idem */ }
    }
    await new Promise(resoudre => vraiSetTimeout(resoudre, 0));
    if (!microtaches.length && !minuteries.length) return tour;
  }
  return Infinity;
}

/* ═══════════════════ LE MAGASIN ═══════════════════ */

const tables = new Map();
const table = nom => { if (!tables.has(nom)) tables.set(nom, new Map()); return tables.get(nom); };
const taille = nom => tables.get(nom)?.size ?? 0;

const ecritures = [];
const CE_FICHIER = 'sync-reconcile-idle-nowrite.test.js';
const CADRES_TECHNIQUES = new RegExp(`${CE_FICHIER}|/db\\.js|central-sync\\.js|catalog-seed-guard\\.js|write-coherence\\.js|persistent-image-guard\\.js|node:internal`);
const appelant = () => (new Error().stack || '').split('\n').slice(1).map(ligne => ligne.trim())
  .find(ligne => /\.js:\d+/.test(ligne) && !CADRES_TECHNIQUES.test(ligne)) || '?';

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
db.isCentralSyncReady = () => true;
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;
db.getAll = async nom => [...table(nom).values()];
/* L'ordre des clés est CONSERVÉ : plusieurs producteurs comparent par `JSON.stringify`, et
 * une base double qui reconstruirait l'objet inventerait des différences. */
const enregistrer = (nom, enregistrement, api) => {
  ecritures.push({ api, store: nom, id: String(enregistrement?.id ?? ''), par: appelant() });
  const id = enregistrement?.id ?? `auto-${table(nom).size + 1}`;
  table(nom).set(String(id), enregistrement);
  return id;
};
db.save = async (nom, enregistrement) => enregistrer(nom, enregistrement, 'save');
db.saveLocalOnly = async (nom, enregistrement) => enregistrer(nom, enregistrement, 'saveLocalOnly');
db._deleteRaw = async (nom, id) => {
  ecritures.push({ api: 'delete', store: nom, id: String(id), par: appelant() });
  table(nom).delete(String(id)); return true;
};
db.delete = db._deleteRaw;
db.clear = async nom => { ecritures.push({ api: 'clear', store: nom, id: '', par: appelant() }); table(nom).clear(); };
db.normalizeKey = valeur => String(valeur);

const http = [];
/*
 * UN 404 GLOBAL RENDRAIT LA COUVERTURE VIDE.
 *
 * `installCentralCatalogOnce()` lit `response.text()` et lève sur un statut non ok : avec un
 * 404 pour tout, le chemin légitime du catalogue ne s'exécuterait jamais et l'épreuve ne
 * mesurerait rien de lui. On répond donc pour CETTE route seulement — le reste garde son
 * 404, pour ne pas faire croire à des chemins réseau qui n'existent pas ici.
 */
const CATALOG_INSTALL = '/api/sync/catalog-install';
globalThis.fetch = async (url, init = {}) => {
  const methode = String(init.method || 'GET').toUpperCase();
  http.push({ methode, url: String(url) });
  if (methode === 'POST' && String(url).includes(CATALOG_INSTALL)) {
    const charge = JSON.stringify({ installed: true, version: CENTRAL_CATALOG_VERSION });
    return { ok: true, status: 200, text: async () => charge, json: async () => JSON.parse(charge) };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};
const postsCatalogue = () => http.filter(appel => appel.methode === 'POST' && appel.url.includes(CATALOG_INSTALL));
const mutationsHttp = () => http.filter(appel => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(appel.methode));

/* ═══════════════════ L'ORDRE DE CHARGEMENT DE LA PRODUCTION ═══════════════════
 *
 * `index.html` : `central-sync.js` puis `write-coherence.js` — qui installe la garde — PUIS
 * les enrichisseurs. Inverser reviendrait à mesurer une plateforme qui n'existe pas.
 */
await import('../write-coherence.js');
const { CENTRAL_CATALOG_VERSION } = await import('../catalog-seed-guard.js');
const garde = globalThis.window.__centralSyncTransitionGuard;
// `refreshCentralMirror()` relit le central après une installation réussie.
db.enableCentralSync = async () => ({});

const FAMILLES = Object.entries(INVENTAIRE)
  .filter(([, declare]) => declare.couverture === 'exercé')
  .map(([nom]) => nom);
// `catalog-seed-guard.js` est déjà chargé ci-dessus, à sa place de production.
for (const module of FAMILLES.filter(nom => nom !== 'catalog-seed-guard.js')) await import(`../${module}`);

const battre = etat => window.dispatchEvent(new CustomEvent('central-sync-status', { detail: { state: etat } }));
const annoncerInstantane = detail => window.dispatchEvent(new CustomEvent('platform-snapshot-applied', { detail }));

async function fenetre(etat = 'synced') {
  ecritures.length = 0; http.length = 0;
  const fileAvant = taille('syncQueue');
  const avant = ordonnancement.executees;
  battre(etat);
  const tours = await drainer();
  return {
    tours,
    ecritures: ecritures.map(entree => ({ ...entree })),
    mutations: mutationsHttp(),
    posts: postsCatalogue().length,
    reglages: ecritures.filter(entree => entree.store === 'settings').length,
    deltaFile: taille('syncQueue') - fileAvant,
    executees: ordonnancement.executees - avant
  };
}

await drainer();                        // ce que les imports ont programmé
const PREMIERE = await fenetre('synced');
/** Qui a réellement écrit pendant la première convergence — la preuve de vivacité. */
const FAMILLES_VIVANTES = new Set(PREMIERE.ecritures
  .map(entree => (String(entree.par).match(/\/([a-z0-9-]+\.js):\d+/) || [])[1])
  .filter(Boolean));
if (process.env.DIAG_164) {
  console.error('DIAG posts=', PREMIERE.posts, 'settings=', PREMIERE.reglages,
    'familles=', JSON.stringify([...FAMILLES_VIVANTES]));
}

/* ═══════════════════ PHASE 2 / 4 — LA PORTE ═══════════════════ */

test('#164 · la garde de transition est bien installée, AVANT les enrichisseurs', () => {
  assert.ok(garde, 'write-coherence.js doit installer la garde de transition');
  assert.equal(typeof garde.suppressed, 'function');
  const attendues = Object.values(INVENTAIRE).filter(declare => declare.couverture === 'exercé').length;
  assert.equal(FAMILLES.length, attendues,
    `toutes les familles déclarées « exercé » doivent être chargées — ${FAMILLES.length}/${attendues}`);
  assert.ok(FAMILLES.includes('catalog-seed-guard.js'),
    'la plume INDIRECTE du catalogue doit être exercée, pas seulement déclarée');
});

test('#164 · la PREMIÈRE convergence écrit — sinon la mesure serait vide', () => {
  /*
   * Sans cette épreuve, un zéro plus bas ne prouverait rien : une porte où les producteurs
   * ne tourneraient pas, ou seraient neutralisés, passerait tout aussi bien.
   */
  assert.ok(PREMIERE.ecritures.length > 0,
    `la première convergence DOIT écrire — reçu ${PREMIERE.ecritures.length}`);
  assert.ok(PREMIERE.executees > 0, 'des minuteries de réconciliation DOIVENT s’exécuter');
  /*
   * On exigeait ici DEUX producteurs distincts. C'était un artefact du défaut de #98 : sur
   * un décor déjà convergé, les preuves terrain réécrivaient leurs fiches pour rien, et
   * gonflaient ce compte. Elles se taisent désormais, à juste titre.
   *
   * La non-vacuité reste prouvée, et par un chemin NOMMABLE plutôt que par un simple
   * décompte : l'installation du catalogue passe bien par le serveur et repose sa version.
   * La vivacité de CHAQUE famille, elle, est éprouvée plus bas — « VIVACITÉ PAR FAMILLE »
   * vide les magasins et exige que chacune se manifeste ou se justifie, ce qui est plus
   * strict que n'importe quel seuil compté ici.
   */
  assert.ok(PREMIERE.posts > 0 && PREMIERE.reglages > 0,
    `la première convergence doit installer le catalogue — posts=${PREMIERE.posts}, réglages=${PREMIERE.reglages}`);
});

test('#164 · battements « synced » répétés au repos : zéro écriture, zéro mutation, file stable', async () => {
  const fenetres = [];
  for (let numero = 1; numero <= 3; numero += 1) fenetres.push(await fenetre('synced'));

  for (const [index, mesure] of fenetres.entries()) {
    const numero = index + 1;
    assert.notEqual(mesure.tours, Infinity,
      `battement ${numero} : les réconciliateurs doivent atteindre le silence, pas se reprogrammer sans fin`);
    assert.deepEqual(mesure.ecritures, [],
      `battement ${numero} : aucune écriture répétée — reçu ${JSON.stringify(mesure.ecritures.slice(0, 6))}`);
    assert.deepEqual(mesure.mutations, [], `battement ${numero} : aucune mutation HTTP`);
    assert.equal(mesure.deltaFile, 0, `battement ${numero} : la file ne bouge pas`);
  }

  assert.ok(garde.suppressed() >= 3,
    `la garde doit avoir filtré les battements redondants — reçu ${garde.suppressed()}`);
});

test('#164 · aucune réécriture de `kb-*` au repos — la famille qui bouclait le plus', async () => {
  const mesure = await fenetre('synced');
  const catalogue = mesure.ecritures.filter(entree => /^kb-/.test(entree.id));
  assert.deepEqual(catalogue, [],
    `336 écritures « kb-* » par minute à l’origine — reçu ${JSON.stringify(catalogue.slice(0, 6))}`);
});

test('#164 · les deux fiches PARTAGÉES ne se réécrivent pas l’une l’autre au repos', async () => {
  /*
   * `kb-evertz-x0401h` et `kb-avid-dnxiq` sont les deux seules fiches que
   * `equipment-field-evidence.js` et `-phase12.js` ont en commun, et ils en produisent deux
   * ordres de clés différents. C'est le va-et-vient qu'une épreuve sans garde ferait
   * apparaître. Ici, au repos, il ne doit rien se passer.
   */
  const mesure = await fenetre('synced');
  const partagees = mesure.ecritures.filter(entree => ['kb-evertz-x0401h', 'kb-avid-dnxiq'].includes(entree.id));
  assert.deepEqual(partagees, [],
    `va-et-vient entre producteurs — reçu ${JSON.stringify(partagees)}`);
});

/* ═══════════════════ LES DISCRIMINANTS POSITIFS ═══════════════════ */

test('#164 · un instantané qui apporte un VRAI changement ré-arme la réconciliation', async () => {
  /*
   * Le cœur du contrat : la porte ne doit pas être verte parce que plus rien ne passe. Un
   * `platform-snapshot-applied` non vide doit rouvrir le chemin — sinon une modification
   * venue du serveur ne serait jamais projetée.
   */
  const avant = garde.state();
  annoncerInstantane({ changedEntities: ['docs/kb-evertz-x0401h'], deletedEntities: [], changedStores: ['docs'] });
  const rouvert = await fenetre('synced');
  assert.notEqual(rouvert.tours, Infinity, 'le chemin rouvert doit converger');
  assert.equal(typeof avant, 'string');

  // Et une fois reprojeté, le repos redevient silencieux.
  const apres = await fenetre('synced');
  assert.deepEqual(apres.ecritures, [],
    `après reprojection, le repos est silencieux — reçu ${JSON.stringify(apres.ecritures.slice(0, 6))}`);
});

test('#164 · un retour à « synced » après une panne réelle passe, et converge', async () => {
  const panne = await fenetre('error');
  assert.notEqual(panne.tours, Infinity);
  const reprise = await fenetre('synced');
  assert.notEqual(reprise.tours, Infinity, 'la reprise doit converger');
  const stabilisation = await fenetre('synced');
  assert.deepEqual(stabilisation.ecritures, [],
    `après reprise, le repos redevient silencieux — reçu ${JSON.stringify(stabilisation.ecritures.slice(0, 6))}`);
});

test('#164 · deux instantanés porteurs de suite : les producteurs eux-mêmes ne réécrivent pas', async () => {
  /*
   * LA GARDE N'EST PAS LA SEULE LIGNE — ET CETTE ÉPREUVE LE VÉRIFIE.
   *
   * Au repos, la garde filtre : un producteur qui réécrirait ne serait jamais appelé, donc
   * jamais vu. On ouvre donc DÉLIBÉRÉMENT le chemin deux fois de suite, par deux instantanés
   * annoncés porteurs de changement, alors que rien n'a bougé localement. Les producteurs
   * tournent les deux fois : la seconde ne doit rien écrire.
   *
   * PLUS AUCUNE FICHE N'EST EXCLUE. `kb-evertz-x0401h` et `kb-avid-dnxiq` — les seules que
   * `equipment-field-evidence.js` et `-phase12.js` partagent — bénéficiaient ici d'une
   * exemption : sur un chemin ouvert, leurs deux ordres de clés les faisaient se réécrire
   * l'une l'autre, et l'épreuve se contentait de le documenter. #98 a supprimé la cause
   * plutôt que l'exemption : la comparaison de ces modules ignore désormais l'ordre, et ces
   * deux fiches sont tenues par la même exigence que toutes les autres.
   */
  annoncerInstantane({ changedEntities: ['docs/passe-1'], deletedEntities: [], changedStores: ['docs'] });
  const premiere = await fenetre('synced');
  assert.notEqual(premiere.tours, Infinity);

  annoncerInstantane({ changedEntities: ['docs/passe-2'], deletedEntities: [], changedStores: ['docs'] });
  const seconde = await fenetre('synced');
  assert.notEqual(seconde.tours, Infinity, 'le second passage doit converger');
  assert.ok(seconde.executees > 0,
    'les producteurs DOIVENT tourner au second passage — sinon rien n’est éprouvé');

  assert.deepEqual(seconde.ecritures, [],
    `un producteur réécrit à l’identique sur un chemin ouvert — reçu ${JSON.stringify(seconde.ecritures.slice(0, 6))}`);
  assert.deepEqual(seconde.mutations, [], 'et rien n’est poussé par HTTP');
});

test('#164 · VIVACITÉ PAR FAMILLE — chaque plume exercée se manifeste, ou dit pourquoi non', async () => {
  /*
   * « la première convergence écrit » ne prouve pas que les DIX familles ont travaillé :
   * chacune s'ensemence déjà à l'import, si bien qu'un premier battement les trouve toutes
   * converties. Mesuré : deux familles seulement écrivent à ce moment-là.
   *
   * On provoque donc un vrai besoin — les magasins qu'elles alimentent sont vidés — puis on
   * ouvre le chemin. Chaque famille déclarée « exercé » doit alors se manifester, ou porter
   * une justification `inerte` qui dit qui la tient.
   */
  for (const magasin of ['docs', 'equipments']) table(magasin).clear();
  annoncerInstantane({ changedEntities: ['docs/vivacite'], deletedEntities: [], changedStores: ['docs'] });
  const reveil = await fenetre('synced');
  await drainer();

  const vues = new Set([...FAMILLES_VIVANTES, ...reveil.ecritures
    .map(entree => (String(entree.par).match(/\/([a-z0-9-]+\.js):\d+/) || [])[1])
    .filter(Boolean)]);
  /*
   * `catalog-seed-guard.js` ENVELOPPE `db.save` : il est écarté de l'attribution, sinon
   * toute écriture lui serait imputée. Sa vivacité se lit donc à son propre chemin — le POST
   * d'installation et l'écriture de version mesurés à la première convergence.
   */
  if (PREMIERE.posts > 0 && PREMIERE.reglages > 0) vues.add('catalog-seed-guard.js');

  const manquantes = [];
  for (const famille of FAMILLES) {
    if (vues.has(famille)) continue;
    const justification = INVENTAIRE[famille].inerte;
    if (!justification) manquantes.push(famille);
  }
  assert.deepEqual(manquantes, [],
    `familles exercées jamais vues à l’œuvre et sans justification « inerte » : ${manquantes.join(', ')} — ` +
    `vues : ${JSON.stringify([...vues])}`);

  // Une justification « inerte » n'est pas un blanc-seing : elle doit nommer un fichier
  // d'épreuves qui existe réellement.
  for (const famille of FAMILLES) {
    const justification = INVENTAIRE[famille].inerte;
    if (!justification || vues.has(famille)) continue;
    const fichiers = [...justification.matchAll(/tests\/([a-z0-9.-]+\.test\.js)/g)].map(trouve => trouve[1]);
    assert.ok(fichiers.length > 0, `« ${famille} » : la justification « inerte » doit nommer une épreuve durable`);
    for (const fichier of fichiers) {
      assert.ok(fs.existsSync(new URL(`./${fichier}`, import.meta.url)),
        `« ${famille} » : l’épreuve citée « ${fichier} » n’existe pas`);
    }
  }

  // Et la reconstruction terminée, le repos redevient silencieux.
  const stabilisation = await fenetre('synced');
  assert.deepEqual(stabilisation.ecritures, [],
    `après reconstruction, le repos est silencieux — reçu ${JSON.stringify(stabilisation.ecritures.slice(0, 6))}`);
});

test('#164 · le catalogue central s’installe UNE fois : 2ᵉ et 3ᵉ passage sans POST ni écriture', async () => {
  /*
   * LA PLUME INDIRECTE, ÉPROUVÉE SUR SON PROPRE CHEMIN.
   *
   *   synced → scheduleCatalogInstall() → installCentralCatalogOnce()
   *          → POST /api/sync/catalog-install → mirrorCentralVersion()
   *          → saveLocalOnly('settings', 'global')
   *
   * La première convergence a le droit de poster et d'écrire la version. Ensuite,
   * `centralCatalogVersion()` lit `settings.global.catalogSeedVersion` et l'installation
   * répond `already-current` : plus aucun POST, plus aucune écriture de réglages.
   */
  assert.equal(PREMIERE.posts, 1,
    `la première convergence doit installer le catalogue UNE fois — reçu ${PREMIERE.posts} POST`);
  assert.equal(PREMIERE.reglages, 1,
    `et écrire la version installée UNE fois — reçu ${PREMIERE.reglages}`);
  assert.equal(Number(table('settings').get('global')?.catalogSeedVersion), CENTRAL_CATALOG_VERSION,
    'la version installée doit être miroitée localement');

  for (const passage of [2, 3]) {
    annoncerInstantane({ changedEntities: [`docs/catalogue-${passage}`], deletedEntities: [], changedStores: ['docs'] });
    const mesure = await fenetre('synced');
    assert.equal(mesure.posts, 0, `passage ${passage} : aucun nouveau POST d’installation — reçu ${mesure.posts}`);
    assert.equal(mesure.reglages, 0, `passage ${passage} : aucune nouvelle écriture de réglages`);
    assert.equal(mesure.deltaFile, 0, `passage ${passage} : la file ne grossit pas`);
  }
});

test('#164 · au repos, la garde empêche même la PLANIFICATION de l’installation', async () => {
  // Un battement redondant ne doit pas atteindre `scheduleCatalogInstall()`.
  const mesure = await fenetre('synced');
  assert.equal(mesure.posts, 0, 'un battement filtré ne poste rien');
  assert.deepEqual(mesure.ecritures.filter(entree => entree.store === 'settings'), [],
    'ni n’écrit de réglages');
});

test('#164 · les producteurs sont VIVANTS : un magasin vidé est reconstruit, puis silence', async () => {
  /*
   * La preuve finale que rien n'est neutralisé. On vide `docs`, et un vrai changement
   * d'instantané rouvre le chemin : les producteurs doivent tout reposer.
   */
  const avant = taille('docs');
  assert.ok(avant > 0, 'des fiches doivent exister avant l’effacement');
  table('docs').clear();

  annoncerInstantane({ changedEntities: ['docs/reconstruction'], deletedEntities: [], changedStores: ['docs'] });
  const reconstruction = await fenetre('synced');
  assert.ok(reconstruction.ecritures.length > 0,
    'les producteurs doivent réagir à un magasin vidé — sinon ils sont neutralisés');
  assert.ok(taille('docs') > 0, 'et le magasin doit se reconstruire');

  const stabilisation = await fenetre('synced');
  assert.deepEqual(stabilisation.ecritures, [],
    `la reconstruction terminée, le repos redevient silencieux — reçu ${JSON.stringify(stabilisation.ecritures.slice(0, 6))}`);
});
