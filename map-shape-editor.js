/**
 * @file map-shape-editor.js — dessiner et reprendre une forme sur le plan.
 *
 * CE QU'IL REMPLACE
 * -----------------
 * Deux fonctions séparées et incomplètes vivaient dans interactive-map.js :
 *
 * - `editArea()` ne savait que tracer un RECTANGLE par un glisser, et n'offrait aucun
 *   moyen de le reprendre : il fallait le redessiner entièrement à chaque retouche.
 * - `resizeArea()` posait UNE SEULE poignée, au coin bas-droit. On ne pouvait donc ni
 *   déplacer la zone, ni la reprendre par un autre côté.
 *
 * Aucune des deux ne connaissait autre chose que le rectangle. Or une régie n'est pas un
 * rectangle, un pupitre courbe non plus : chaque chose a sa forme.
 *
 * CE QU'IL FAIT
 * -------------
 * Une seule surface d'édition pour les trois formes — rectangle, cercle, polygone — avec
 * les gestes attendus : tracer, déplacer d'ensemble, tirer une poignée, ajouter un point
 * en tirant le milieu d'une arête, retirer un point, agrandir, convertir en polygone pour
 * raffiner une zone existante.
 *
 * La géométrie n'est PAS ici : elle est dans map-shape-contract.js, qui se teste hors
 * navigateur. Ce module ne fait que traduire des gestes en appels de contrat, et dessiner
 * le résultat. C'est ce partage qui rend l'ensemble vérifiable.
 */

import {
  SHAPE_TYPES, readShape, writeShape, normalizeShape,
  shapeHandles, dragHandle, moveShape, scaleShape,
  shapeContains, shapePath, shapeCentroid, toPolygon, removeVertex, shapeLabel
} from './map-shape-contract.js';

export const MAP_SHAPE_EDITOR_VERSION = 1;

/** Rayon de saisie d'une poignée, en pixels d'affichage. */
const RAYON_POIGNEE = 9;

const COULEURS = Object.freeze({
  room: { trait: '#4acfff', fond: 'rgba(74,207,255,.20)' },
  baie: { trait: '#b86fff', fond: 'rgba(184,111,255,.20)' },
  equipment: { trait: '#16a085', fond: 'rgba(22,160,133,.20)' }
});

/** Trace une forme dans un contexte 2D, à partir du chemin abstrait du contrat. */
export function paintShape(ctx, shape, { trait, fond, epaisseur = 2 }) {
  const ordres = shapePath(shape);
  if (!ordres.length) return;
  ctx.beginPath();
  for (const ordre of ordres) {
    if (ordre.op === 'moveTo') ctx.moveTo(ordre.x, ordre.y);
    else if (ordre.op === 'lineTo') ctx.lineTo(ordre.x, ordre.y);
    else if (ordre.op === 'arc') ctx.arc(ordre.x, ordre.y, ordre.r, 0, Math.PI * 2);
    else if (ordre.op === 'closePath') ctx.closePath();
  }
  if (fond) { ctx.fillStyle = fond; ctx.fill(); }
  if (trait) { ctx.lineWidth = epaisseur; ctx.strokeStyle = trait; ctx.stroke(); }
}

/** Dessine les poignées. Les points de sommet et les points d'ajout se distinguent. */
export function paintHandles(ctx, shape, { echelle = 1 } = {}) {
  const rayon = RAYON_POIGNEE / Math.max(0.2, echelle);
  for (const poignee of shapeHandles(shape)) {
    ctx.beginPath();
    ctx.arc(poignee.x, poignee.y, poignee.kind === 'edge' ? rayon * 0.62 : rayon * 0.8, 0, Math.PI * 2);
    // Une poignée d'ajout est creuse : elle ne fait pas partie de la forme, elle l'étend.
    ctx.fillStyle = poignee.kind === 'edge' ? 'rgba(12,22,32,.72)' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2 / Math.max(0.2, echelle);
    ctx.strokeStyle = poignee.kind === 'edge' ? '#8fe3ff' : '#0d6ea8';
    ctx.stroke();
  }
}

/** Poignée sous le curseur, la plus proche d'abord. */
export function findHandleAt(shape, p, { tolerance = RAYON_POIGNEE } = {}) {
  let trouvee = null;
  let meilleure = tolerance * tolerance;
  for (const poignee of shapeHandles(shape)) {
    const dx = poignee.x - p.x;
    const dy = poignee.y - p.y;
    const distance = dx * dx + dy * dy;
    // À égalité, un sommet l'emporte sur un point d'ajout : sinon le milieu d'une arête
    // très courte volerait le clic destiné au sommet voisin, et la forme gagnerait un
    // point à chaque tentative de déplacement.
    if (distance <= meilleure && !(trouvee?.kind === 'vertex' && poignee.kind === 'edge' && distance === meilleure)) {
      meilleure = distance;
      trouvee = poignee;
    }
  }
  return trouvee;
}

/**
 * Ouvre l'édition de forme pour une salle ou une baie.
 *
 * `contexte` fournit ce que le module ne peut pas connaître : le canevas, la conversion
 * d'un événement en point du plan, le redessin de fond, l'échelle d'affichage, la
 * persistance et les notifications.
 */
export function openShapeEditor(entity, contexte) {
  const {
    canvas, ctx, type = 'room', eventToPoint, redraw, displayScale = () => 1,
    save, notifications, onClose
  } = contexte || {};
  if (!canvas || !ctx || typeof eventToPoint !== 'function') {
    throw new Error('Éditeur de forme : contexte incomplet.');
  }

  const couleurs = COULEURS[type] || COULEURS.room;
  let forme = readShape(entity);
  let outil = forme ? forme.type : SHAPE_TYPES.RECT;
  let geste = null;          // { mode, poignee, depart, formeDepart }
  let apercu = null;         // forme en cours de tracé
  let brouillon = [];        // points d'un polygone en cours de tracé
  let modifie = false;

  /** Les couches qui recouvrent le canevas et lui volent les clics. */
  const couchesAuDessus = () => (contexte.overlays || [])
    .map(cible => (typeof cible === 'string' ? document.querySelector(cible) : cible))
    .filter(Boolean);

  const barre = monterBarre();
  peindre();
  attacher();

  /* ------------------------------------------------------------------ rendu */

  function peindre() {
    redraw?.();
    const echelle = displayScale();
    if (apercu) paintShape(ctx, apercu, { trait: couleurs.trait, fond: couleurs.fond });
    else if (forme) {
      paintShape(ctx, forme, { trait: couleurs.trait, fond: couleurs.fond });
      paintHandles(ctx, forme, { echelle });
    }
    if (brouillon.length) {
      ctx.beginPath();
      ctx.moveTo(brouillon[0].x, brouillon[0].y);
      for (const p of brouillon.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.lineWidth = 2; ctx.strokeStyle = couleurs.trait; ctx.stroke();
      for (const p of brouillon) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = couleurs.trait; ctx.stroke();
      }
    }
  }

  /* ------------------------------------------------------------------ gestes */

  function surAppui(event) {
    const p = eventToPoint(event);

    // Tracé d'un polygone : chaque clic pose un point, un double-clic ferme.
    if (outil === SHAPE_TYPES.POLYGON && !forme) {
      brouillon.push(p);
      peindre();
      return;
    }

    if (forme) {
      const poignee = findHandleAt(forme, p, { tolerance: RAYON_POIGNEE / Math.max(0.2, displayScale()) });
      if (poignee) {
        // Alt + clic sur un sommet le retire : le geste inverse de l'ajout.
        if (event.altKey && poignee.kind === 'vertex') {
          const reduite = removeVertex(forme, poignee.index);
          if (reduite === forme) {
            notifications?.showNotification('Une forme ne peut pas descendre sous trois points.', 'warning');
          } else { forme = reduite; modifie = true; }
          peindre();
          return;
        }
        geste = { mode: 'poignee', poignee, formeDepart: forme };
        return;
      }
      if (shapeContains(forme, p)) {
        geste = { mode: 'deplacer', depart: p, formeDepart: forme };
        return;
      }
    }

    // Rien sous le curseur : on trace une nouvelle forme.
    geste = { mode: 'tracer', depart: p };
  }

  function surMouvement(event) {
    if (!geste) return;
    const p = eventToPoint(event);

    if (geste.mode === 'poignee') {
      const suivante = dragHandle(geste.formeDepart, geste.poignee, p);
      if (suivante) {
        // Une poignée d'arête devient un sommet dès qu'elle a créé son point, sinon
        // chaque pixel de déplacement en ajouterait un nouveau.
        if (geste.poignee.kind === 'edge') {
          geste.poignee = { kind: 'vertex', index: geste.poignee.index + 1 };
          geste.formeDepart = suivante;
        }
        forme = suivante;
        modifie = true;
      }
      peindre();
      return;
    }

    if (geste.mode === 'deplacer') {
      forme = moveShape(geste.formeDepart, p.x - geste.depart.x, p.y - geste.depart.y);
      modifie = true;
      peindre();
      return;
    }

    if (geste.mode === 'tracer') {
      apercu = formeDepuisGlisser(geste.depart, p);
      peindre();
    }
  }

  function surRelache() {
    if (!geste) return;
    if (geste.mode === 'tracer' && apercu) {
      forme = apercu;
      modifie = true;
    }
    apercu = null;
    geste = null;
    peindre();
  }

  function surDoubleClic() {
    // Ferme un polygone en cours de tracé.
    if (outil === SHAPE_TYPES.POLYGON && brouillon.length >= 3) {
      forme = normalizeShape({ type: SHAPE_TYPES.POLYGON, points: brouillon });
      brouillon = [];
      modifie = true;
      peindre();
    }
  }

  function formeDepuisGlisser(a, b) {
    if (outil === SHAPE_TYPES.CIRCLE) {
      return normalizeShape({
        type: SHAPE_TYPES.CIRCLE,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        r: Math.hypot(b.x - a.x, b.y - a.y) / 2
      });
    }
    return normalizeShape({
      type: SHAPE_TYPES.RECT,
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)
    });
  }

  /* ------------------------------------------------------------------ barre */

  function monterBarre() {
    const hote = document.createElement('div');
    hote.className = 'shape-editor-bar';
    hote.innerHTML = `
      <span class="shape-editor-title">Forme — ${echapper(entity?.name || '')}</span>
      <div class="shape-editor-tools" role="group" aria-label="Type de forme">
        <button type="button" data-outil="rect" title="Rectangle">▭</button>
        <button type="button" data-outil="circle" title="Cercle">◯</button>
        <button type="button" data-outil="polygon" title="Forme libre — cliquez les points, double-cliquez pour fermer">⬠</button>
      </div>
      <div class="shape-editor-actions">
        <button type="button" data-action="polygoniser" title="Convertir en forme libre pour ajouter des points">Points</button>
        <button type="button" data-action="agrandir" title="Agrandir de 10 %">+</button>
        <button type="button" data-action="reduire" title="Réduire de 10 %">−</button>
        <button type="button" data-action="effacer" title="Recommencer le tracé">Effacer</button>
        <button type="button" data-action="valider" class="is-primary">Enregistrer</button>
        <button type="button" data-action="annuler">Annuler</button>
      </div>
      <p class="shape-editor-hint">Glissez pour tracer · tirez un point blanc pour le déplacer · tirez un point creux pour en ajouter un · Alt+clic sur un point pour le retirer · Échap pour annuler</p>`;
    // La barre est posée sur le BODY, jamais sur le parent du canevas.
    //
    // Le plan se déplace et se zoome par `transform`, et un ancêtre transformé devient le
    // bloc conteneur de tout `position: fixed` qu'il abrite. Attachée au parent du canevas,
    // la barre suivait donc le zoom et le déplacement du plan : mesuré dans le navigateur,
    // ses boutons étaient « visibles » mais HORS DE L'ÉCRAN, donc impossibles à cliquer.
    document.body.appendChild(hote);

    hote.addEventListener('click', event => {
      const bouton = event.target.closest('button');
      if (!bouton) return;
      event.preventDefault();
      if (bouton.dataset.outil) {
        outil = bouton.dataset.outil;
        brouillon = [];
        for (const autre of hote.querySelectorAll('[data-outil]')) {
          autre.classList.toggle('is-active', autre.dataset.outil === outil);
        }
        // Changer d'outil alors qu'une forme existe ne l'efface PAS : il faut « Effacer »
        // pour cela. Perdre une zone sur un clic d'outil serait une perte silencieuse.
        peindre();
        return;
      }
      switch (bouton.dataset.action) {
        case 'polygoniser':
          if (forme) { forme = toPolygon(forme); modifie = true; peindre(); }
          break;
        case 'agrandir':
          if (forme) { forme = scaleShape(forme, 1.1, shapeCentroid(forme)); modifie = true; peindre(); }
          break;
        case 'reduire':
          if (forme) { forme = scaleShape(forme, 0.9, shapeCentroid(forme)); modifie = true; peindre(); }
          break;
        case 'effacer':
          forme = null; brouillon = []; apercu = null; modifie = true; peindre();
          break;
        case 'valider': enregistrer(); break;
        case 'annuler': fermer(); break;
      }
    });
    for (const autre of hote.querySelectorAll('[data-outil]')) {
      autre.classList.toggle('is-active', autre.dataset.outil === outil);
    }
    return hote;
  }

  /* ------------------------------------------------------------------ sortie */

  async function enregistrer() {
    if (!forme) {
      notifications?.showNotification('Tracez d’abord une forme.', 'warning');
      return;
    }
    try {
      // `writeShape` met AUSSI `rect` à jour : tout le code existant qui lit `rect`
      // continue de fonctionner sans être touché.
      await save(writeShape(entity, forme));
      notifications?.showNotification(`Zone enregistrée (${shapeLabel(forme)}).`, 'success');
      fermer();
    } catch (error) {
      notifications?.showNotification(error?.message || 'Enregistrement impossible.', 'error');
    }
  }

  function fermer() {
    detacher();
    barre.remove();
    redraw?.();
    onClose?.({ modifie });
  }

  function attacher() {
    canvas.style.pointerEvents = 'auto';
    // La couche des marqueurs RECOUVRE le canevas sur toute sa surface.
    //
    // Mesuré : `document.elementsFromPoint` au centre du plan rend
    // [div#map-hotspots, canvas#areas-canvas, …] — le canevas est DEUXIÈME. Pendant une
    // édition, il recevait donc zéro événement de souris, et aucun tracé n'était possible.
    // Rendre le canevas cliquable ne suffit pas : il faut rendre la couche du dessus
    // transparente aux clics, puis lui rendre son état exact à la fermeture.
    for (const couche of couchesAuDessus()) {
      couche.dataset.shapeEditorPe = couche.style.pointerEvents || '';
      couche.style.pointerEvents = 'none';
    }
    // Drapeau lu par le déplacement du plan (map-fit-fix.js), qui capture sinon le
    // pointeur dès l'appui et prive le canevas de tout le glisser.
    document.body.dataset.shapeEditing = '1';
    canvas.addEventListener('mousedown', surAppui);
    canvas.addEventListener('mousemove', surMouvement);
    canvas.addEventListener('dblclick', surDoubleClic);
    // La relâche est écoutée sur le DOCUMENT : relâcher hors du canevas laissait
    // autrement un geste en cours, et la forme suivait le curseur indéfiniment.
    document.addEventListener('mouseup', surRelache);
    document.addEventListener('keydown', surTouche);
  }

  function detacher() {
    canvas.style.pointerEvents = 'none';
    delete document.body.dataset.shapeEditing;
    for (const couche of couchesAuDessus()) {
      // On restitue la valeur EXACTE d'origine, y compris quand c'était la chaîne vide :
      // écrire 'auto' à la place imposerait un style en ligne que la feuille ne pourrait
      // plus contredire.
      if ('shapeEditorPe' in couche.dataset) {
        couche.style.pointerEvents = couche.dataset.shapeEditorPe;
        delete couche.dataset.shapeEditorPe;
      }
    }
    canvas.removeEventListener('mousedown', surAppui);
    canvas.removeEventListener('mousemove', surMouvement);
    canvas.removeEventListener('dblclick', surDoubleClic);
    document.removeEventListener('mouseup', surRelache);
    document.removeEventListener('keydown', surTouche);
  }

  function surTouche(event) {
    if (event.key === 'Escape') { event.preventDefault(); fermer(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); enregistrer(); }
  }

  return { close: fermer, shape: () => forme };
}

function echapper(value) {
  return String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

export default Object.freeze({
  version: MAP_SHAPE_EDITOR_VERSION,
  openShapeEditor, paintShape, paintHandles, findHandleAt
});
