/**
 * @file cable-route-editor.js — LA BARRE DU TRACÉ, ET LES GESTES QUI LE DESSINENT.
 *
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS.
 *
 * Il traduit des gestes en appels de contrat, et il affiche ce que les contrats disent. Il
 * ne décide RIEN : ni la géométrie — `cable-route-session.js` la tient —, ni les mots —
 * `cable-route-presentation.js` les écrit —, ni surtout le droit d'écrire, qui vient du
 * serveur par `cable-route-access.js` et se redemande avant chaque geste.
 *
 * Même partage que `map-shape-editor.js`, et pour la même raison : ce qui est ici n'est pas
 * vérifiable hors navigateur, donc il doit y en avoir le moins possible.
 *
 * DEUX ÉTATS, ET LE SECOND NE S'OUVRE QUE SUR PREUVE.
 *
 *   consultation  le parcours se lit — pastille, phrase, message d'absence ou de
 *                 hors-périmètre. Aucune poignée : un tracé se lit, il ne se manipule pas,
 *                 et des poignées suggéreraient le contraire.
 *   édition       une copie de travail est ouverte, sur une scène nommée, après une
 *                 réponse FRAÎCHE du serveur. « Enregistrer » est la seule sortie qui écrit.
 *
 * CE QUE L'ÉCRAN NE PROMET JAMAIS.
 *
 * Un bouton n'apparaît que si la capacité SERVIE le porte. `canEdit`, `canCreate`,
 * `canInsert` et `canAddSegment` sont lus tels quels : les recalculer ici ferait deux
 * règles, et c'est toujours la plus permissive qui ferait la faille.
 *
 * LA BARRE EST CONSTRUITE NŒUD PAR NŒUD, JAMAIS PAR `innerHTML`.
 *
 * Elle affiche la référence d'un câble et des noms de salles — de la donnée saisie. Passer
 * par une chaîne de balisage obligerait à échapper juste, à chaque interpolation, pour
 * toujours. `textContent` ne peut pas produire de balise : il n'y a plus rien à échapper,
 * donc plus rien à oublier. C'est aussi ce qui rend cette barre exécutable hors navigateur.
 */

import {
  routePanelState, routeSession, selectedCable, routePresent,
  beginRouteEdit, beginRouteCreate, cancelRouteEdit, refreshRouteView, clearCableRoute,
  pointNaturelDepuisCanevas, poigneeSousLeClic, ESPACE_CARTE
} from './cable-route-layer.js';
import { sceneLabel } from './cable-route-presentation.js';

export const CABLE_ROUTE_EDITOR_VERSION = 1;

/**
 * CE QUE L'ÉCRAN DIT D'UN REFUS — une phrase par motif, jamais un code brut.
 *
 * Un refus muet, ou réduit à « ROUTE_SCOPE_INSUFFICIENT », laisse l'exploitant devant un
 * dessin qui a disparu sans savoir s'il a mal fait, s'il n'a pas le droit, ou si la
 * plateforme est en panne. Chaque motif dit ce qui s'est passé ET ce qu'il reste à faire.
 *
 * Aucune de ces phrases ne nomme une zone, une habilitation ou une scène protégée : dire
 * « il vous manque cable.edit sur RF1 » révélerait à la fois l'existence de RF1 et le
 * découpage des périmètres.
 */
export const ROUTE_SAVE_MESSAGES = Object.freeze({
  STALE_WRITE: "Quelqu'un d'autre a modifié ce câble entre-temps. Votre dessin n'a pas été enregistré : rouvrez le tracé pour repartir de la version à jour.",
  ROUTE_SCOPE_INSUFFICIENT: "Ce tracé comporte une partie hors de votre périmètre. Il ne peut pas être remplacé depuis ici : l'enregistrer effacerait ce que vous ne voyez pas.",
  ROUTE_SCENE_EDIT_FORBIDDEN: "Vous n'êtes pas autorisé à documenter un cheminement dans cette scène.",
  ROUTE_SCENE_INVALID: "Ce tracé désigne un lieu qui n'existe pas ou plus. Rouvrez la scène et reprenez le passage concerné.",
  ZONE_FORBIDDEN: "Ce câble sort de votre périmètre : la modification n'a pas été enregistrée.",
  ROLE_ACTION_FORBIDDEN: "Votre rôle ne permet pas de modifier un câble.",
  ENDPOINT_OUT_OF_SCOPE: "Une extrémité de ce câble est hors de votre périmètre : la modification n'a pas été enregistrée.",
  INVALID_DOCUMENT: "Le tracé a été refusé par le serveur : il n'est pas conforme au contrat de relevé."
});

export const REFUS_PAR_DEFAUT = "Le tracé n'a pas pu être enregistré. Rien n'a été modifié.";
export const SESSION_EXPIREE = 'Votre session a expiré. Reconnectez-vous, puis reprenez le tracé.';

/** La phrase d'un refus, à partir de ce que le serveur a réellement répondu. */
export function routeSaveMessage(error) {
  const code = error?.code || error?.payload?.error;
  if (code && ROUTE_SAVE_MESSAGES[code]) return ROUTE_SAVE_MESSAGES[code];
  // Une session expirée n'est pas un refus de droit : le dire évite de faire croire à une
  // révocation, et surtout d'envoyer l'exploitant demander une habilitation qu'il a déjà.
  if (error?.status === 401) return SESSION_EXPIREE;
  return error?.message || REFUS_PAR_DEFAUT;
}

/** Rayon de saisie d'une poignée, en pixels de l'espace de dessin. */
const RAYON_POIGNEE = 15;

/**
 * Monte la barre du tracé et rend une poignée pour la refermer.
 *
 * `contexte` fournit ce que ce module ne peut pas connaître : le canevas et son repère, le
 * redessin de fond, la scène ouverte, le vocabulaire des salles et des baies, la
 * persistance et le canal de notification.
 */
export function openCableRoutePanel(contexte) {
  const {
    canvas, eventToPoint, redraw, displayScale = () => 1,
    scene = () => null, context = () => ({}), save, notifications, onClose
  } = contexte || {};
  if (!canvas || typeof eventToPoint !== 'function') {
    throw new Error('Éditeur de tracé : contexte incomplet.');
  }

  const doc = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('Éditeur de tracé : aucun document.');

  let geste = null;          // { rang } — la poignée tirée
  let ferme = false;
  let gestesAttaches = false;
  /*
   * LA POSITION D'INSERTION SE RETIENT ICI, pas dans le `<select>`.
   *
   * La barre est reconstruite à chaque rendu ; lire le choix dans le DOM le perdait donc à
   * chaque point posé, et « entre 2 et 3 » redevenait « après 4 » sans que personne l'ait
   * demandé. L'ordre des segments étant une affirmation physique, ce glissement-là
   * écrirait un cheminement que personne n'a relevé.
   */
  let insertionChoisie = null;

  /*
   * Les couches qui recouvrent le canevas et lui volent les clics.
   *
   * Déclaré ICI, avant le premier rendu : `rendre()` peut attacher les gestes dès la
   * construction — une session de la couche peut survivre à la fermeture de la carte — et
   * une déclaration plus bas laissait alors `attacher()` toucher une liaison non encore
   * initialisée. Le panneau ne s'ouvrait pas, sans un mot, sur un chemin rare mais réel.
   */
  const couchesAuDessus = () => (contexte.overlays || [])
    .map(cible => (typeof cible === 'string' ? doc.querySelector(cible) : cible))
    .filter(Boolean);

  /** Un nœud, ses attributs, ses enfants. `text` passe par `textContent`, jamais par du balisage. */
  const el = (balise, proprietes = {}, enfants = []) => {
    const noeud = doc.createElement(balise);
    for (const [cle, valeur] of Object.entries(proprietes)) {
      if (valeur === null || valeur === undefined || valeur === false) continue;
      if (cle === 'text') noeud.textContent = String(valeur);
      else if (cle === 'class') noeud.className = valeur;
      else noeud.setAttribute(cle, valeur === true ? '' : String(valeur));
    }
    for (const enfant of enfants) if (enfant) noeud.appendChild(enfant);
    return noeud;
  };
  const bouton = (action, texte, { classe, desactive } = {}) => el('button', {
    type: 'button', 'data-action': action, text: texte,
    ...(classe ? { class: classe } : {}), ...(desactive ? { disabled: 'disabled' } : {})
  });

  const barre = doc.createElement('div');
  barre.className = 'route-editor-bar';
  barre.setAttribute('role', 'group');
  barre.setAttribute('aria-label', 'Tracé du câble');
  doc.body.appendChild(barre);
  barre.addEventListener('click', surClicBarre);
  barre.addEventListener('change', surChangement);
  doc.addEventListener('keydown', surTouche);

  rendre();

  /* ═══════════════════════════════════════════════════════════════════════════
   * L'AFFICHAGE — il ne dit que ce que les contrats disent
   * ═══════════════════════════════════════════════════════════════════════════ */

  function rendre() {
    if (ferme) return;
    for (const enfant of [...barre.childNodes]) barre.removeChild(enfant);
    const etat = routePanelState(context());
    if (!etat) { barre.hidden = true; synchroniserGestes(); return; }
    barre.hidden = false;

    const session = routeSession();
    const scenePropre = scene();
    const nomScene = scenePropre ? sceneLabel(scenePropre, context()) : '';

    barre.appendChild(el('span', { class: 'route-editor-title', text: `Tracé — ${etat.reference}` }));
    barre.appendChild(el('span', { class: `route-editor-badge is-${etat.badge.tone}`, text: etat.badge.text }));
    if (etat.message) barre.appendChild(el('p', { class: 'route-editor-message', text: etat.message }));
    if (etat.sentence) barre.appendChild(el('p', { class: 'route-editor-sentence', text: etat.sentence }));

    if (session) peindreBarreEdition(etat, nomScene, session);
    else peindreBarreConsultation(etat, nomScene);
    synchroniserGestes();
  }

  /*
   * EN CONSULTATION : ce qu'on peut faire, et rien de plus.
   *
   * « Modifier » n'existe que s'il y a un tracé ET que le serveur l'a déclaré remplaçable
   * en entier. « Ajouter » n'existe que sur une absence PROUVÉE et une scène inscriptible.
   * Les deux viennent de la capacité servie, jamais d'une déduction locale.
   */
  function peindreBarreConsultation(etat, nomScene) {
    const actions = el('div', { class: 'route-editor-actions' });
    if (etat.canEdit) actions.appendChild(bouton('modifier', 'Modifier le tracé', { classe: 'is-primary' }));
    if (etat.canCreate) {
      actions.appendChild(bouton('creer',
        nomScene ? `Ajouter un tracé dans ${nomScene}` : 'Ajouter un tracé', { classe: 'is-primary' }));
    }
    actions.appendChild(bouton('fermer', 'Fermer'));
    barre.appendChild(actions);
    barre.appendChild(el('p', {
      class: 'route-editor-hint',
      text: (!etat.canEdit && !etat.canCreate)
        ? "Consultation seule : ce tracé n'est pas modifiable depuis votre périmètre."
        : "Le dessin se fait sur une copie : rien n'est enregistré avant « Enregistrer »."
    }));
  }

  /*
   * EN ÉDITION : le passage travaillé, où insérer le suivant, et les deux sorties.
   *
   * Le sélecteur de PASSAGES existe parce qu'une scène peut être traversée plusieurs fois :
   * sans lui, « le segment de cette salle » serait ambigu et l'éditeur en choisirait un au
   * hasard. Le sélecteur d'INSERTION existe parce que l'ordre des segments est une
   * affirmation physique : c'est à celui qui documente de dire où le passage s'insère.
   */
  function peindreBarreEdition(etat, nomScene, session) {
    const passages = session.segmentsInCurrentScene();
    const dessinable = session.selectedIndex() >= 0;
    const outils = el('div', { class: 'route-editor-tools' });

    if (passages.length > 1) {
      outils.appendChild(el('label', { class: 'route-editor-field', text: 'Passage travaillé' }, [
        el('select', { 'data-role': 'passage' }, passages.map((_, rang) =>
          el('option', { value: String(rang), text: `${nomScene ? `${nomScene} ` : ''}(${rang + 1})` })))
      ]));
    }
    if (etat.canAddSegment) {
      outils.appendChild(el('label', { class: 'route-editor-field', text: 'Nouveau passage' }, [
        el('select', { 'data-role': 'insertion' }, etat.insertions.map(choix =>
          el('option', { value: String(choix.insertAt), text: choix.label })))
      ]));
      outils.appendChild(bouton('passage', 'Ouvrir un passage ici'));
    }
    if (outils.childNodes.length) barre.appendChild(outils);

    const actions = el('div', { class: 'route-editor-actions' });
    if (dessinable) actions.appendChild(bouton('retirer-point', 'Retirer le dernier point'));
    if (dessinable) actions.appendChild(bouton('retirer-passage', 'Supprimer ce passage'));
    actions.appendChild(bouton('verifier', 'Marquer vérifié', { desactive: etat.badge.verified }));
    actions.appendChild(bouton('supprimer', 'Supprimer le tracé', { classe: 'is-danger' }));
    actions.appendChild(bouton('enregistrer', 'Enregistrer', { classe: 'is-primary', desactive: !etat.dirty }));
    actions.appendChild(bouton('annuler', 'Annuler'));
    barre.appendChild(actions);

    barre.appendChild(el('p', {
      class: 'route-editor-hint',
      text: 'Cliquez sur le plan pour poser un point · tirez un point pour le déplacer · '
        + 'Alt+clic sur un point pour le retirer · Échap pour annuler'
        + (etat.dirty ? ' — modifications non enregistrées' : '')
    }));

    const choix = barre.querySelector('[data-role="insertion"]');
    if (choix) choix.value = String(insertionRetenue(etat));
    const rangs = barre.querySelector('[data-role="passage"]');
    if (rangs) rangs.value = String(session.selectedIndex());
  }

  /*
   * LE PLAN NE SE LAISSE DESSINER QU'EN ÉDITION.
   *
   * Rendre le canevas cliquable dès l'ouverture du panneau confisquerait la carte à qui
   * vient seulement LIRE un tracé : plus de déplacement du plan, plus de clic sur une
   * salle. Les écouteurs suivent donc la session, et rien d'autre.
   */
  function synchroniserGestes() {
    const enEdition = Boolean(routeSession());
    if (enEdition && !gestesAttaches) attacher();
    else if (!enEdition && gestesAttaches) detacher();
  }

  /**
   * La position d'insertion retenue, bornée à la séquence DU MOMENT.
   *
   * Elle est conservée d'un rendu à l'autre, mais jamais au-delà de ce que la séquence
   * permet : un passage supprimé rétrécit le cheminement, et « entre 3 et 4 » n'existe
   * plus. Sans choix exprimé, le nouveau passage va À LA FIN — la seule position qui
   * n'affirme rien sur ce qui existe déjà.
   */
  function insertionRetenue(etat) {
    const permises = etat.insertions.map(choix => choix.insertAt);
    if (!permises.length) return 0;
    if (permises.includes(insertionChoisie)) return insertionChoisie;
    return permises[permises.length - 1];
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * LES GESTES DE LA BARRE
   * ═══════════════════════════════════════════════════════════════════════════ */

  function surChangement(event) {
    const insertion = event.target?.closest?.('[data-role="insertion"]');
    if (insertion) { insertionChoisie = Number(insertion.value); return; }
    const passage = event.target?.closest?.('[data-role="passage"]');
    if (!passage) return;
    routeSession()?.selectSegment(Number(passage.value));
    rendre(); peindre();
  }

  async function surClicBarre(event) {
    const cible = event.target?.closest?.('button');
    if (!cible || cible.disabled) return;
    event.preventDefault?.();
    switch (cible.getAttribute('data-action')) {
      case 'modifier': await ouvrirEdition(); break;
      case 'creer': await ouvrirCreation(); break;
      case 'passage': ouvrirPassage(); break;
      case 'retirer-point': retirerDernierPoint(); break;
      case 'retirer-passage': retirerPassage(); break;
      case 'verifier': marquerVerifie(); break;
      case 'supprimer': await supprimerLeTrace(); break;
      case 'enregistrer': await enregistrer(); break;
      case 'annuler': annuler(); break;
      case 'fermer': fermer(); break;
    }
  }

  /*
   * OUVRIR L'ÉDITION — la capacité est REDEMANDÉE, jamais reprise du panneau affiché.
   *
   * Entre l'affichage et le clic, une habilitation a pu être révoquée. `beginRouteEdit`
   * repose donc la question au serveur et rapporte la géométrie du moment ; `null` veut
   * dire « pas maintenant », et l'écran le dit sans prétendre savoir pourquoi.
   */
  async function ouvrirEdition() {
    const scenePropre = scene();
    if (!scenePropre) return;
    const session = await beginRouteEdit(scenePropre);
    if (!session) {
      notifications?.showNotification(
        "Ce tracé n'est pas modifiable depuis cette scène en ce moment.", 'warning');
    }
    rendre(); peindre();
  }

  /*
   * OUVRIR LE PREMIER RELEVÉ — sur une absence PROUVÉE, et pour CETTE scène.
   *
   * Ce geste n'exige pas `readable` : sur un câble sans tracé il n'y a rien à lire, et en
   * faire une condition rendait la toute première documentation inatteignable. Ce qu'il
   * exige, c'est que le serveur confirme À L'INSTANT qu'aucun cheminement n'est enregistré
   * — invisible n'étant pas inexistant — et que la scène ouverte soit inscriptible.
   */
  async function ouvrirCreation() {
    const scenePropre = scene();
    const cable = selectedCable();
    if (!scenePropre || !cable) return;
    const session = await beginRouteCreate(cable, scenePropre);
    if (!session) {
      /*
       * DEUX REFUS TRÈS DIFFÉRENTS, et l'exploitant doit savoir lequel.
       *
       * `routePresent()` porte le fait que le serveur vient de rapporter : un cheminement
       * est enregistré. Dire « vous n'avez pas le droit » dans ce cas-là serait faux — le
       * droit était là, c'est l'absence qui a cessé d'être vraie.
       */
      notifications?.showNotification(
        routePresent()
          ? "Un tracé vient d'être relevé pour ce câble : il s'affiche, il n'est pas remplacé."
          : "Vous ne pouvez pas ouvrir de tracé dans cette scène en ce moment.", 'warning');
    }
    rendre(); peindre();
  }

  /** Ouvre un passage à la position CHOISIE — l'ordre du relevé n'est jamais supposé. */
  function ouvrirPassage() {
    const session = routeSession();
    if (!session || !scene()) return;
    const etat = routePanelState(context());
    const dimensions = dimensionsNaturelles();
    const ouvert = session.startSegment({
      naturalWidth: dimensions.width, naturalHeight: dimensions.height,
      ...(session.sequence().length ? { insertAt: insertionRetenue(etat) } : {})
    });
    if (!ouvert) {
      notifications?.showNotification("Ce passage n'a pas pu être ouvert à cette position.", 'warning');
      return;
    }
    rendre(); peindre();
  }

  function retirerDernierPoint() {
    const session = routeSession();
    const segment = session?.selectedSegment();
    if (!segment?.waypoints?.length) return;
    session.removeWaypoint(segment.waypoints.length - 1);
    rendre(); peindre();
  }

  function retirerPassage() {
    if (!routeSession()?.removeSelectedSegment()) return;
    rendre(); peindre();
  }

  /*
   * « Vérifié » atteste d'un cheminement OBSERVÉ sur le terrain. On peut le poser, et la
   * moindre retouche de géométrie le retire ensuite — c'est la session qui s'en charge, pas
   * cette barre : la règle est une, et elle est écrite là où vit la géométrie.
   */
  function marquerVerifie() {
    if (!routeSession()?.setStatus('verified')) return;
    rendre(); peindre();
  }

  /*
   * SUPPRIMER LE TRACÉ N'EST PAS SUPPRIMER LE CÂBLE.
   *
   * Le relevé disparaît, la fiche reste : ses extrémités, ses ports, son type et son état
   * technique ne sont pas touchés. C'est `payload()` qui le garantit — il repart du câble
   * complet — et non une reconstruction faite ici.
   */
  async function supprimerLeTrace() {
    const session = routeSession();
    if (!session) return;
    const confirme = await demanderConfirmation(
      'Supprimer le tracé de ce câble ? Le câble, ses extrémités et ses ports sont conservés.');
    if (!confirme) return;
    session.removeRoute();
    rendre(); peindre();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * LES GESTES SUR LE PLAN
   * ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Les dimensions NATURELLES du passage travaillé.
   *
   * Elles viennent du segment quand il en a — c'est son image de référence — et de l'espace
   * de dessin sinon. Les prendre à l'écran donnerait des relevés qui bougent au
   * redimensionnement de la fenêtre, ce que le contrat de coordonnées interdit.
   */
  function dimensionsNaturelles() {
    const segment = routeSession()?.selectedSegment();
    if (segment?.naturalWidth && segment?.naturalHeight) {
      return { width: segment.naturalWidth, height: segment.naturalHeight };
    }
    return { width: ESPACE_CARTE.width, height: ESPACE_CARTE.height };
  }

  /** Le segment travaillé, ramené aux dimensions que le dessin utilise. */
  function segmentCourant() {
    const segment = routeSession()?.selectedSegment();
    if (!segment) return null;
    return segment.naturalWidth && segment.naturalHeight
      ? segment
      : { ...segment, naturalWidth: ESPACE_CARTE.width, naturalHeight: ESPACE_CARTE.height };
  }

  function surAppui(event) {
    const session = routeSession();
    const segment = segmentCourant();
    if (!session || !segment) return;
    const clic = eventToPoint(event);
    const rayon = RAYON_POIGNEE / Math.max(0.2, displayScale());
    const rang = poigneeSousLeClic(clic, segment, ESPACE_CARTE, rayon);

    if (rang >= 0) {
      // Alt+clic retire le point : le geste inverse de la pose, et le même que celui de
      // l'éditeur de formes — un seul vocabulaire de gestes sur toute la carte.
      if (event.altKey) {
        session.removeWaypoint(rang);
        rendre(); peindre();
        return;
      }
      geste = { rang };
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    /*
     * Rien sous le curseur : on POSE un point à la fin du passage travaillé.
     *
     * Il s'ajoute au bout du chemin, il ne s'insère pas au milieu : l'ordre des points est,
     * lui aussi, une affirmation physique — le câble passe par là, PUIS par là.
     */
    const naturel = pointNaturelDepuisCanevas(clic, segment, ESPACE_CARTE);
    if (!naturel) return;
    session.addWaypoint(naturel);
    rendre(); peindre();
  }

  function surMouvement(event) {
    if (!geste) return;
    const segment = segmentCourant();
    if (!segment) return;
    const naturel = pointNaturelDepuisCanevas(eventToPoint(event), segment, ESPACE_CARTE);
    if (!naturel) return;
    routeSession()?.moveWaypoint(geste.rang, naturel);
    peindre();
  }

  function surRelache(event) {
    if (!geste) return;
    canvas.releasePointerCapture?.(event?.pointerId);
    geste = null;
    // Le déplacement a pu retirer le « vérifié » : la barre doit le refléter tout de suite.
    rendre(); peindre();
  }

  function surTouche(event) {
    if (!routeSession()) return;
    if (event.key === 'Escape') { event.preventDefault?.(); annuler(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // Une saisie en cours garde ses touches : effacer un caractère n'est pas effacer un
      // point du relevé.
      if (event.target?.closest?.('input, select, textarea')) return;
      event.preventDefault?.();
      retirerDernierPoint();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * LES SORTIES
   * ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * UNE SEULE ÉCRITURE, ET AUCUN SUCCÈS ANNONCÉ À TORT.
   *
   * `payload()` rend le câble ENTIER : rien n'est reconstruit ici, donc rien du câble ne
   * peut être perdu au passage. Le refus du serveur — 409, 403, 400 — remonte par
   * `db.save`, qui a déjà restauré la copie locale : l'éditeur reste alors ouvert, avec le
   * dessin intact, et dit ce qui s'est passé.
   */
  async function enregistrer() {
    const session = routeSession();
    const cable = selectedCable();
    if (!session || !cable) return;
    const { ok, errors, cable: aEcrire } = session.payload(cable);
    if (!ok) {
      notifications?.showNotification(
        `Ce tracé n'est pas enregistrable : ${errors.join(' ')}`, 'warning');
      return;
    }
    let enregistre;
    try {
      enregistre = await save(aEcrire);
    } catch (error) {
      notifications?.showNotification(routeSaveMessage(error), 'error');
      // On NE ferme pas : le dessin reste sous les yeux de son auteur, qui peut le
      // reprendre ou l'abandonner en connaissance de cause.
      rendre(); peindre();
      return;
    }
    notifications?.showNotification(
      aEcrire.route ? 'Tracé enregistré.' : 'Tracé supprimé. Le câble est conservé.', 'success');
    cancelRouteEdit();
    /*
     * LA VUE REPART DU SERVEUR — `acknowledging: enregistre` FERME LE FAUX STALE_WRITE,
     * SANS EN OUVRIR UN NOUVEAU.
     *
     * `save()` rend désormais la fiche LOCALE COMPLÈTE, telle qu'`accorderRevision()`
     * (`central-sync.js`) vient de l'estampiller dans une transaction UNIQUE — jamais
     * `aEcrire` (l'objet d'AVANT l'écriture) recombiné avec la révision d'un appel réseau
     * séparé. Une première version de ce correctif faisait exactement cela : elle collait
     * ici la révision rapportée par `refreshRouteView` — une vue redemandée APRÈS coup, par
     * un second appel HTTP indépendant. Entre les deux appels, un AUTRE auteur pouvait
     * écrire un AUTRE champ du câble ; la vue rapportait alors sa révision plus récente,
     * posée sur les champs métier d'AVANT cette écriture-là. Un second enregistrement
     * repartant de cette fiche déclarait la révision de l'autre auteur comme la sienne
     * propre, et l'écrasait en silence — sans jamais produire le STALE_WRITE qui aurait dû
     * le protéger.
     *
     * `enregistre` n'a pas ce défaut : sa révision et ses champs métier viennent de LA MÊME
     * lecture atomique, faite par l'écriture qui vient de réussir. Une écriture réellement
     * concurrente, survenue entre cette écriture et ce rafraîchissement, reste détectée au
     * prochain « Enregistrer » — voir le commentaire de `refreshRouteView`.
     */
    await refreshRouteView(scene(), { acknowledging: enregistre });
    rendre(); peindre();
  }

  /** ANNULER : l'instantané, au caractère près. Aucune écriture, aucune trace. */
  function annuler() {
    if (!routeSession()) return;
    cancelRouteEdit();
    rendre(); peindre();
  }

  function fermer() {
    if (ferme) return;
    ferme = true;
    cancelRouteEdit();
    clearCableRoute();
    if (gestesAttaches) detacher();
    doc.removeEventListener('keydown', surTouche);
    barre.removeEventListener('click', surClicBarre);
    barre.removeEventListener('change', surChangement);
    barre.remove?.();
    barre.parentNode?.removeChild(barre);
    redraw?.();
    onClose?.();
  }

  function peindre() { redraw?.(); }

  async function demanderConfirmation(question) {
    const global = typeof window !== 'undefined' ? window : globalThis;
    if (typeof global?.AppDialog?.confirm === 'function') return global.AppDialog.confirm(question);
    if (typeof global?.confirm === 'function') return global.confirm(question);
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * LE CANEVAS EST RECOUVERT : IL FAUT LUI RENDRE LES CLICS, PUIS LES REPRENDRE
   * ═══════════════════════════════════════════════════════════════════════════ */

  function attacher() {
    gestesAttaches = true;
    canvas.style.pointerEvents = 'auto';
    for (const couche of couchesAuDessus()) {
      couche.dataset.routeEditorPe = couche.style.pointerEvents || '';
      couche.style.pointerEvents = 'none';
    }
    /*
     * LE MÊME DRAPEAU QUE L'ÉDITEUR DE FORMES, ET C'EST VOULU.
     *
     * `map-fit-fix.js` capture le pointeur dès l'appui pour déplacer le plan, et ne
     * s'abstient que sur `document.body.dataset.shapeEditing`. En poser un second, qu'il
     * ne lit pas, aurait laissé le plan voler tous les gestes de dessin.
     */
    doc.body.dataset.shapeEditing = '1';
    canvas.addEventListener('pointerdown', surAppui);
    canvas.addEventListener('pointermove', surMouvement);
    // La relâche est écoutée sur le DOCUMENT : relâcher hors du canevas laisserait sinon un
    // point collé au curseur.
    doc.addEventListener('pointerup', surRelache);
    doc.addEventListener('pointercancel', surRelache);
  }

  function detacher() {
    gestesAttaches = false;
    canvas.style.pointerEvents = 'none';
    delete doc.body.dataset.shapeEditing;
    for (const couche of couchesAuDessus()) {
      // On restitue la valeur EXACTE d'origine, chaîne vide comprise : écrire « auto » à la
      // place imposerait un style en ligne que la feuille ne pourrait plus contredire.
      if ('routeEditorPe' in couche.dataset) {
        couche.style.pointerEvents = couche.dataset.routeEditorPe;
        delete couche.dataset.routeEditorPe;
      }
    }
    canvas.removeEventListener('pointerdown', surAppui);
    canvas.removeEventListener('pointermove', surMouvement);
    doc.removeEventListener('pointerup', surRelache);
    doc.removeEventListener('pointercancel', surRelache);
  }

  return Object.freeze({
    element: barre,
    close: fermer,
    /** Rejoue l'affichage — la vue vient d'être rafraîchie, ou la barre doit se relire. */
    refresh: () => { rendre(); },
    /**
     * REDEMANDE LA CAPACITÉ POUR LA SCÈNE OUVERTE, puis réaffiche.
     *
     * `creatableHere` ne vaut que pour la scène nommée dans la requête : la garder en
     * passant de STC à RF1 proposerait « Ajouter un tracé » là où le serveur refusera le
     * trait. Une édition en cours, elle, ne change pas de scène sous les pieds de son
     * auteur — le dessin en cours porterait alors des coordonnées d'une autre image.
     */
    async rescene() {
      if (routeSession()) { rendre(); return; }
      await refreshRouteView(scene());
      rendre(); peindre();
    },
    isEditing: () => Boolean(routeSession())
  });
}

export default Object.freeze({
  version: CABLE_ROUTE_EDITOR_VERSION,
  openCableRoutePanel, routeSaveMessage, ROUTE_SAVE_MESSAGES
});
