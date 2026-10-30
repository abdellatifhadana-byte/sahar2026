import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/*
 * @file PILOTE-UI-01 — la feuille Pilote doit GAGNER la cascade, pas seulement être juste.
 *
 * CE QUE CE FICHIER DÉFEND, ET POURQUOI IL EXISTE
 * ------------------------------------------------
 * Relevé au navigateur : la prévisualisation posait une coque sombre et les VINGT pages
 * restaient blanches. La feuille Pilote n'était pas fausse — chaque règle disait bien ce
 * qu'il fallait. Elle PERDAIT, simplement, contre `ui-sections.css` et `ui-final.css`, qui
 * écrivent leurs fonds clairs avec des sélecteurs à identifiants, en `!important` :
 *
 *     :is(#admin-content,#responsible-content) > .card:has(#salle-search)   (2,1,0)
 *     :is(#admin-content,#responsible-content) > .card                      (1,1,0)
 *     #app .admin-page .card                                                (1,2,0)
 *
 * — quand la règle Pilote s'écrivait `body.pilot-technique-ui .card`, soit (0,2,0). Aucun
 * identifiant. Charger la feuille en dernier n'y changeait rien : l'ordre ne départage que
 * des spécificités ÉGALES.
 *
 * Une relecture de la feuille ne pouvait pas le voir, et un test qui vérifie qu'une règle
 * est ÉCRITE ne le voit pas davantage — c'est exactement ce que faisaient les tests
 * précédents, qui passaient tous pendant que l'interface restait blanche. Ce fichier
 * compare donc les spécificités RÉELLES des deux camps.
 */

const FEUILLE_PILOTE = 'pilot-technique-preview.css';
const FEUILLES_ADVERSES = Object.freeze([
  'ui-sections.css', 'ui-final.css', 'ui-polish.css', 'ui-refresh.css',
  'ui-tune.css', 'ui-shell-fixes.css', 'design-system.css', 'main.css', 'admin.css'
]);

/**
 * Spécificité CSS d'un sélecteur, en (identifiants, classes, éléments).
 *
 * `:is()` et `:has()` prennent la spécificité de leur argument LE PLUS SPÉCIFIQUE — c'est
 * précisément ce qui rendait les règles adverses imbattables sans identifiant, et ce que
 * l'œil ne calcule pas en lisant. `:not()` suit la même règle.
 */
export function specificite(selecteur) {
  let s = String(selecteur);
  let ids = 0, classes = 0, elements = 0;

  // Les pseudo-classes fonctionnelles d'abord : on remplace chaque groupe par son argument
  // le plus spécifique, en repartant du plus imbriqué.
  for (let garde = 0; garde < 12; garde += 1) {
    const avant = s;
    s = s.replace(/:(?:is|has|not|where)\(([^()]*)\)/g, (tout, args) => {
      const cle = tout.startsWith(':where') ? null : args;
      if (cle === null) return ' ';
      let meilleur = { ids: 0, classes: 0, elements: 0 }, texte = '';
      for (const part of args.split(',')) {
        const p = mesureSimple(part.trim());
        if (p.ids > meilleur.ids
          || (p.ids === meilleur.ids && p.classes > meilleur.classes)
          || (p.ids === meilleur.ids && p.classes === meilleur.classes && p.elements > meilleur.elements)) {
          meilleur = p; texte = part.trim();
        }
      }
      return ` ${texte} `;
    });
    if (s === avant) break;
  }

  const m = mesureSimple(s);
  ids += m.ids; classes += m.classes; elements += m.elements;
  return { ids, classes, elements };
}

function mesureSimple(s) {
  const sansAttrValeurs = String(s).replace(/\[[^\]]*\]/g, '');
  const ids = (sansAttrValeurs.match(/#[\w-]+/g) || []).length;
  const attributs = (sansAttrValeurs.match(//g) || []).length;
  const classes = (sansAttrValeurs.match(/\.[\w-]+/g) || []).length
    + (sansAttrValeurs.match(/:(?!:)[\w-]+/g) || []).length
    + attributs;
  const elements = (sansAttrValeurs.match(/(?:^|[\s>+~(])([a-zA-Z][\w-]*)/g) || []).length
    + (sansAttrValeurs.match(/::[\w-]+/g) || []).length;
  return { ids, classes, elements };
}

const compare = (a, b) => (a.ids - b.ids) || (a.classes - b.classes) || (a.elements - b.elements);

/**
 * Toutes les règles d'une feuille : sélecteur individuel + corps de déclaration.
 *
 * Les préludes d'`@media` sont RETIRÉS plutôt qu'ignorés : sans cela, la première règle de
 * chaque bloc `@media` — précédée d'une accolade ouvrante et non d'une fermante — n'était
 * jamais vue, et le test cherchait ses adversaires dans une feuille amputée.
 */
function regles(css) {
  const out = [];
  const sansCommentaires = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:media|supports|layer|container)[^{]*\{/g, ';');
  /*
   * Le motif ne peut PAS exiger un délimiteur devant le sélecteur.
   *
   * Une version précédente s'écrivait `(?:^|[};])\s*([^{}@;]+?)\s*\{…\}` : elle consommait
   * l'accolade fermante de chaque règle, si bien que la règle SUIVANTE n'avait plus de
   * délimiteur devant elle. Le moteur repartait alors au premier `;` rencontré — au milieu
   * du corps d'une règle plus loin — et la lecture se désynchronisait. Mesuré : 141 règles
   * vues sur une feuille qui en compte le triple, et la reprise des cartes, pourtant bien
   * présente ligne 1058, restait invisible. Le test cherchait donc ses adversaires et ses
   * reprises dans une feuille amputée, et se taisait.
   *
   * `[^{}]+` avant `{` repart naturellement après l'accolade fermante précédente.
   */
  for (const [, brutBrut, corps] of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Le fragment capturé peut porter les `;` laissés par le retrait des préludes d'at-rule.
    const brut = brutBrut.split(';').pop();
    if (!brut || brut.trim().startsWith('@')) continue;
    let courant = '', profondeur = 0;
    const parts = [];
    for (const ch of brut) {
      if (ch === '(') profondeur++;
      else if (ch === ')') profondeur--;
      if (ch === ',' && profondeur === 0) { parts.push(courant); courant = ''; continue; }
      courant += ch;
    }
    parts.push(courant);
    for (const p of parts) {
      const sel = p.trim();
      if (sel) out.push({ sel, corps });
    }
  }
  return out;
}

/**
 * La valeur de `background` / `background-color` d'un corps de déclaration, et RIEN d'autre.
 *
 * Première version fautive : le test cherchait une teinte claire dans le corps ENTIER. Un
 * `color: #f2f2f2` — du texte clair, parfaitement légitime sur fond sombre — était alors
 * compté comme un fond clair, et `body.dark-theme .card { background:#223042; color:#f2f2f2 }`
 * devenait un « adversaire ». Le test se donnait ainsi de faux adversaires et de fausses
 * victoires : il passait quoi qu'on écrive.
 */
function fondDeclare(corps) {
  const valeurs = [];
  // UN SEUL groupe de capture : une version précédente en comptait trois et lisait le
  // deuxième, si bien que `valeur` valait le mot « background » au lieu de la couleur.
  // Aucun adversaire n'était alors jamais reconnu, et le test passait quoi qu'on écrive.
  for (const [, valeur] of String(corps).matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)) {
    valeurs.push(valeur);
  }
  return valeurs.join(' ');
}

const importantFond = corps => /background(?:-color)?\s*:[^;]*!important/i.test(corps);

/** Une teinte claire au sens du rendu : blanc, quasi-blanc, ou gris très pâle. */
function estClair(valeur) {
  const texte = String(valeur);
  if (/\bwhite\b/i.test(texte)) return true;
  for (const [, hex] of texte.matchAll(/#([0-9a-f]{3,6})\b/gi)) {
    const h = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    if (h.length !== 6) continue;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    if (0.2126 * r + 0.7152 * g + 0.0722 * b >= 200) return true;
  }
  for (const [, r, g, b] of texte.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    if (0.2126 * +r + 0.7152 * +g + 0.0722 * +b >= 200) return true;
  }
  return false;
}

/**
 * Une règle réservée au thème sombre ne peint jamais sous prévisualisation : `applyRoleTheme()`
 * laisse `light-theme` sur le corps, et `body.dark-theme …` ne s'applique donc pas. La
 * compter comme adversaire reviendrait à exiger de battre une règle qui ne s'exécute pas.
 */
const pourThemeSombre = sel => /\bdark-theme\b/.test(sel);

/**
 * Le SUJET d'un sélecteur : sa dernière séquence composée, celle qui est réellement peinte.
 *
 * Sans cela, `… > .card:has(#salle-search) #salle-search` — qui vise un CHAMP — serait
 * compté comme une règle de CARTE, au seul motif que `.card` figure dans son ascendance.
 * On comparait alors la reprise des cartes à la spécificité d'une règle de champ : deux
 * choses différentes, et un échec qui ne voulait rien dire.
 */
function sujet(selecteur) {
  let profondeur = 0, debut = 0;
  const s = String(selecteur);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(') profondeur++;
    else if (ch === ')') profondeur--;
    else if (profondeur === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) debut = i + 1;
  }
  return s.slice(debut).trim();
}

/* ── LE CALCUL LUI-MÊME EST ÉPROUVÉ AVANT DE SERVIR ────────────────────────────────── */

test('la mesure de spécificité rend bien la règle de :is() et :has()', () => {
  assert.deepEqual(specificite('body.pilot-technique-ui .card'), { ids: 0, classes: 2, elements: 1 });
  // Les deux sélecteurs qui battaient la feuille Pilote, calculés ici :
  assert.equal(specificite(':is(#admin-content,#responsible-content) > .card').ids, 1);
  assert.equal(specificite(':is(#admin-content,#responsible-content) > .card:has(#salle-search)').ids, 2);
  assert.equal(specificite('#app .admin-page .card').ids, 1);
  // Et le préfixe de la reprise, qui doit les dépasser :
  assert.equal(specificite('body.pilot-technique-ui #app:is(#app) :is(#admin-content,#responsible-content) input').ids, 3);
  // `:where()` n'ajoute rien, par définition.
  assert.equal(specificite(':where(#a,#b) .card').ids, 0);
});

/* ── LA VÉRIFICATION QUI COMPTE ───────────────────────────────────────────────────── */

/**
 * Pour chaque surface que la prévisualisation doit assombrir, on cherche la règle ADVERSE
 * la plus spécifique qui la peint en CLAIR en `!important`, puis on exige que la feuille
 * Pilote porte au moins une règle au moins aussi spécifique, elle aussi en `!important`.
 *
 * Si quelqu'un ajoute demain une règle claire plus spécifique dans `ui-sections.css`, ce
 * test échoue — au lieu que l'interface redevienne blanche en silence.
 */
/*
 * `\b` ne suffit PAS pour un nom de classe : en CSS, `-` est un caractère de nom, mais un
 * non-mot pour l'expression régulière. `/\.card\b/` reconnaissait donc `.card-header`, et
 * la reprise des EN-TÊTES de carte était comptée comme une reprise des CARTES — masquant
 * une régression réelle sur les cartes. D'où `(?![\w-])`.
 */
const SURFACES = Object.freeze([
  { nom: 'les cartes de contenu', motif: /\.card(?![\w-])/ },
  { nom: 'les champs de saisie', motif: /(^|[\s>(,])(input|select|textarea)(?![\w-])/ },
  { nom: 'les en-têtes de table', motif: /(^|[\s>(,])th(?![\w-])/ }
]);

test('sur chaque surface, la feuille Pilote est au moins aussi spécifique que la règle claire qu’elle doit battre', () => {
  const pilote = regles(lire(FEUILLE_PILOTE)).filter(r => importantFond(r.corps));

  for (const surface of SURFACES) {
    let pire = null;
    for (const feuille of FEUILLES_ADVERSES) {
      let css;
      try { css = lire(feuille); } catch { continue; }
      for (const r of regles(css)) {
        if (!surface.motif.test(sujet(r.sel))) continue;
        if (pourThemeSombre(r.sel)) continue;
        if (!importantFond(r.corps)) continue;
        if (!estClair(fondDeclare(r.corps))) continue;
        const sp = specificite(r.sel);
        if (!pire || compare(sp, pire.sp) > 0) pire = { sp, sel: r.sel, feuille };
      }
    }
    if (!pire) continue; // aucune règle claire en face : rien à battre.

    /*
     * La reprise retenue doit couvrir le CAS GÉNÉRAL de la surface.
     *
     * Sans ce filtre, une règle étroite comme
     * `:is(input[type="checkbox"],input[type="radio"])` — très spécifique, mais qui ne peint
     * que deux types de champs — suffisait à faire passer le test pour TOUS les champs.
     * Mesuré : priver la règle générale des champs de ses identifiants ne déclenchait alors
     * aucun échec. Un sujet restreint par un sélecteur d'attribut ne compte donc pas.
     */
    const meilleure = pilote
      .filter(r => surface.motif.test(sujet(r.sel)) && !sujet(r.sel).includes('['))
      .map(r => ({ sp: specificite(r.sel), sel: r.sel }))
      .sort((a, b) => compare(b.sp, a.sp))[0];

    assert.ok(meilleure, `aucune reprise Pilote pour ${surface.nom}`);
    const fmt = s => `(${s.ids},${s.classes},${s.elements})`;
    assert.ok(compare(meilleure.sp, pire.sp) >= 0,
      `${surface.nom} : la reprise Pilote ${fmt(meilleure.sp)}\n    « ${meilleure.sel} »\n`
      + `  perd contre ${pire.feuille} ${fmt(pire.sp)}\n    « ${pire.sel} »\n`
      + '  → la règle serait écrite, chargée, et sans le moindre effet.');
  }
});

/* ── LES JETONS, QUI RÈGLENT CE QU'AUCUN SÉLECTEUR N'ATTEINT ──────────────────────── */

/**
 * Plusieurs modules peignent EN LIGNE, avec un repli clair : `integrity-center.js` écrit
 * `background: var(--surface-soft,#fafcfd)`. Un style en ligne l'emporte sur toute règle de
 * feuille non `!important` : aucune spécificité ne pouvait l'atteindre. Seule la
 * redéfinition du JETON y parvient — et elle doit donc rester en place.
 */
test('les jetons de surface employés dans les styles en ligne sont redéfinis par le Pilote', () => {
  const css = lire(FEUILLE_PILOTE);
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui {'), css.indexOf('/* ---------- Shell'));
  for (const jeton of ['--card-bg', '--surface', '--surface-soft', '--border-color', '--text-color', '--tk-surface']) {
    assert.match(bloc, new RegExp(`${jeton}\\s*:`), `jeton de surface non redéfini : ${jeton}`);
  }
});

test('aucun jeton de surface du Pilote ne pointe vers une valeur claire', () => {
  const css = lire(FEUILLE_PILOTE);
  const bloc = css.slice(css.indexOf('body.pilot-technique-ui {'), css.indexOf('/* ---------- Shell'));
  for (const [, jeton, valeur] of bloc.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (!/^(--card-bg|--surface|--surface-soft|--body-bg|--light-bg|--input-bg|--tk-surface|--ui-canvas)$/.test(jeton)) continue;
    assert.ok(!estClair(valeur),
      `le jeton ${jeton} rendrait une surface claire : ${valeur.trim()}`);
  }
});
