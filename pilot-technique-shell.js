/*
 * 2M TECH Platform — Pilote Technique : grammaire de page partagée
 * ----------------------------------------------------------------
 * Couche VISUELLE opt-in. Ce module ne lit aucune donnée, n'appelle aucune API et ne prend
 * AUCUNE décision d'autorisation : il reçoit un fragment déjà produit par la page — donc
 * déjà filtré par ses permissions — et se borne à décider de sa MISE EN PAGE.
 */

/**
 * La prévisualisation est-elle active ?
 *
 * Même repère que `equipements.js` (`showQuickView`) : la classe posée sur `<body>` par
 * `pilot-technique-preview.js`. Interrogée à CHAQUE rendu et jamais mémorisée, car la
 * classe peut être retirée en cours de session (`?pilote=0`) et une valeur figée au
 * chargement du module survivrait à la sortie de prévisualisation.
 */
export function enPilote() {
  return Boolean(globalThis.document?.body?.classList?.contains('pilot-technique-ui'));
}

/**
 * Le formulaire de création cesse de dominer la page, sans cesser d'exister.
 *
 * CE QUI N'ALLAIT PAS
 * -------------------
 * Mesuré sur un compte administrateur : « Gestion des Salles » place SEPT champs de
 * création — nom, emplacement, rattachement, zone, responsable, image, champs
 * personnalisés — en pleine hauteur ENTRE les filtres et l'inventaire. Sur un portable,
 * l'inventaire commence sous la ligne de flottaison : la page dont le titre annonce la
 * consultation des salles s'ouvre sur un formulaire de saisie. « Gestion des Baies » fait
 * de même avec quatre champs. « Équipements », lui, ouvre déjà une fenêtre depuis un bouton
 * « Ajouter » : c'est cette grammaire-là que les deux autres pages rejoignent.
 *
 * CE QUI NE CHANGE PAS
 * --------------------
 * Le fragment reçu est rendu TEL QUEL, à l'intérieur du repli. Mêmes champs, mêmes
 * attributs `name`, mêmes `required`, même `id` de formulaire — les gestionnaires des pages
 * se lient par `getElementById` et ne voient aucune différence. Et surtout : ce module est
 * appelé DEPUIS la branche qui teste déjà la permission de création. Un rôle sans ce droit
 * ne produit pas le fragment, donc n'atteint jamais cette fonction. Le repli n'est pas un
 * masquage de sécurité, et il ne doit jamais en devenir un.
 *
 * `<details>` plutôt qu'un bouton et un gestionnaire : le repli, le clavier, `aria-expanded`
 * et l'état ouvert/fermé sont fournis par l'élément lui-même. Aucun contrôle à câbler, donc
 * aucun contrôle susceptible de rester mort.
 *
 * @param fragment  le formulaire déjà rendu par la page, ou '' si elle n'en produit pas.
 * @param titre     l'intitulé du dépliant, en français, à l'infinitif de l'action.
 */
export function replierLaCreation(fragment, titre) {
  const contenu = String(fragment ?? '');
  // Rien à replier : une page sans droit de création ne gagne pas un dépliant vide.
  if (!contenu.trim()) return '';
  if (!enPilote()) return contenu;
  return `<details class="pilot-create-panel">
      <summary><i class="fas fa-plus" aria-hidden="true"></i><span>${titre}</span></summary>
      <div class="pilot-create-panel-body">${contenu}</div>
    </details>`;
}

/**
 * Un compteur devient un compteur QU'ON PEUT OUVRIR — sans aller chercher une seule
 * donnée de plus que celles déjà calculées par l'appelant.
 *
 * CE QUI N'ALLAIT PAS
 * -------------------
 * La Fiche 360 calcule déjà, pour chaque équipement, ses écrans liés, ses murs, ses
 * tickets et ses notes — `operations-suite.js` filtre ces quatre listes dès l'ouverture de
 * la fiche. Mais la carte « Relations » ne montrait que leur LONGUEUR : « 3 Écrans » sans
 * dire LESQUELS. Le technicien qui voit « 3 » n'a aucun moyen, depuis cette fiche, de
 * savoir de quels écrans il s'agit — la relation existe, tourne, est déjà à l'écran sous
 * forme de nombre, et reste pourtant invisible dans le sens où ça compte : on ne peut rien
 * en faire.
 *
 * CE QUI CHANGE, ET CE QUI NE CHANGE PAS
 * ----------------------------------------
 * Rien n'est recalculé ni re-demandé : `groupes[].items` sont construits par l'appelant à
 * partir des tableaux qu'il a DÉJÀ en mémoire. Cette fonction ne fait que décider de
 * l'affichage — un compteur statique en interface classique, un compteur cliquable qui
 * déplie la liste en Pilote — exactement comme `replierLaCreation` ne décide que du repli.
 *
 * @param groupes  [{ cle, titre, items:[{ labelHTML }] }] — labels DÉJÀ échappés par
 *                 l'appelant, ce module ne connaît pas la forme d'une entité de la
 *                 plateforme et ne doit donc pas décider comment l'échapper.
 */
export function relationsAvecDetail(groupes = []) {
  const liste = Array.isArray(groupes) ? groupes : [];
  const grille = `<div class="ops-grid" style="grid-template-columns:repeat(${Math.max(1, liste.length)},minmax(0,1fr))">${
    liste.map(g => enPilote()
      ? `<button type="button" class="ops-stat ops-stat-toggle" data-relation-toggle="${g.cle}" aria-expanded="false"><strong>${g.items.length}</strong><span>${g.titre}</span></button>`
      : `<div class="ops-stat"><strong>${g.items.length}</strong><span>${g.titre}</span></div>`
    ).join('')
  }</div>`;
  if (!enPilote()) return grille;
  const listes = liste.map(g => `<div class="ops-relation-list" data-relation-list="${g.cle}" hidden>${
    g.items.length ? `<ul>${g.items.map(item => `<li>${item.labelHTML}</li>`).join('')}</ul>`
      : `<p class="ops-empty">Aucun élément.</p>`
  }</div>`).join('');
  return `${grille}${listes}`;
}

/**
 * Câble le dépli/repli des compteurs posés par `relationsAvecDetail`, par délégation sur
 * un ancêtre commun — un seul écouteur, quel que soit le nombre de groupes.
 */
export function cablerRelationsDetaillees(racine) {
  if (!racine || racine.dataset.relationsWired === '1') return;
  racine.dataset.relationsWired = '1';
  racine.addEventListener('click', event => {
    const bouton = event.target.closest('[data-relation-toggle]');
    if (!bouton || !racine.contains(bouton)) return;
    const cle = bouton.dataset.relationToggle;
    const panneau = racine.querySelector(`[data-relation-list="${cle}"]`);
    if (!panneau) return;
    const ouvert = !panneau.hidden;
    panneau.hidden = ouvert;
    bouton.setAttribute('aria-expanded', String(!ouvert));
  });
}

/**
 * Les compteurs d'actifs d'une salle ou d'une baie — mêmes puces que le panneau de la
 * carte (`.pilot-room-context-strip`), pour que le même fait se lise de la même façon
 * partout dans le produit.
 *
 * CE QUE CETTE FONCTION NE FAIT PAS
 * ----------------------------------
 * Elle ne compte rien : `compte` est un objet DÉJÀ calculé par l'appelant
 * (`{ icone, valeur, libelleUn, libelleN }[]`), à partir de tableaux que la page a chargés
 * pour la liste entière — pas un `db.getAll` par ligne. Voir `salles.js`/`baies.js` pour le
 * calcul, qui reste le seul endroit à savoir ce qu'est « le nombre d'équipements d'une
 * salle » sur cette plateforme.
 *
 * @param compte  [{ icone, valeur, libelleUn, libelleN }] — `libelleN` optionnel, réutilise
 *                `libelleUn` si absent (au singulier, comme « Aucun mur relié »/« Mur relié »).
 */
export function pucesActifs(compte = []) {
  if (!enPilote()) return '';
  const items = Array.isArray(compte) ? compte : [];
  if (!items.length) return '';
  return `<div class="pilot-room-context-strip">${items.map(item => {
    const libelle = typeof item.valeur === 'number'
      ? `${item.valeur} ${item.valeur > 1 && item.libelleN ? item.libelleN : item.libelleUn}`
      : item.libelleUn;
    return `<span><i class="fas ${item.icone}" aria-hidden="true"></i> ${libelle}</span>`;
  }).join('')}</div>`;
}

/** Les valeurs viennent des magasins : elles peuvent contenir n'importe quel caractère. */
const echapper = valeur => String(valeur ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Le corps de la fiche d'une salle dans l'inspecteur de la carte.
 *
 * CE QUE CETTE FONCTION NE FAIT PAS
 * ----------------------------------
 * Elle ne lit aucun magasin et ne déclenche aucune requête : l'appelant lui passe des
 * valeurs qu'il possède DÉJÀ dans l'instantané de la carte. Un champ absent n'est pas
 * rendu — pas de ligne « — » pour faire nombre.
 *
 * @param description  texte libre de la salle, ou rien
 * @param faits        [{ libelle, valeur }] — les entrées sans valeur sont écartées
 */
export function detailSalle({ description = '', faits = [] } = {}) {
  if (!enPilote()) return '';
  const lignes = (Array.isArray(faits) ? faits : []).filter(fait => fait && fait.valeur);
  const texte = String(description || '').trim();
  if (!texte && !lignes.length) return '';
  return `<div class="pilot-room-detail">
    ${texte ? `<p class="pilot-room-description">${echapper(texte)}</p>` : ''}
    ${lignes.length ? `<dl class="pilot-room-faits">${lignes.map(fait =>
      `<dt>${echapper(fait.libelle)}</dt><dd>${echapper(fait.valeur)}</dd>`).join('')}</dl>` : ''}
  </div>`;
}

export default Object.freeze({ enPilote, replierLaCreation, relationsAvecDetail, cablerRelationsDetaillees, pucesActifs, detailSalle });
