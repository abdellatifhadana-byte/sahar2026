/**
 * @file equipment-component-shapes.js — la carte/le module d'un composant, DESSINÉ sur la
 *       vraie photo terrain de SON équipement/châssis (Ross, openGear, tout châssis
 *       modulaire) — un troisième niveau après la baie sur la photo de sa salle et
 *       l'équipement sur la photo de sa salle/baie (voir nested-shape-contract.js).
 *
 * S'ACCROCHE À LA FICHE 360°, COMME LES AUTRES.
 * --------------------------------------------------------------------------------------
 * `operations-suite.js#openEquipment360` crée `#ops-equipment-360` et son
 * `.ops-modal-body` ; une quinzaine d'autres fichiers y accrochent chacun leur propre
 * panneau en observant cet identifiant (voir equipment-media.js, qui fait déjà exactement
 * cela pour la galerie photo). Ce fichier suit le MÊME contrat DOM, sans toucher à aucun
 * des autres.
 *
 * POURQUOI UNE PHOTO RÉELLE, JAMAIS UNE PHOTO CONSTRUCTEUR.
 * --------------------------------------------------------------------------------------
 * `equipment.images[]` (photos terrain de CETTE instance) et le visuel constructeur du
 * catalogue ne décrivent pas la même chose : deux châssis du même modèle n'ont pas
 * forcément les mêmes cartes dans les mêmes slots. Positionner une carte sur un visuel
 * générique attribuerait à CET appareil un agencement qu'il n'a peut-être pas. Seule la
 * première photo RÉELLE (`equipment.images[0]`, sourceType `instance`) sert donc de
 * surface de dessin ; sans elle, la section le dit et ne dessine rien.
 *
 * RÉUTILISE LE MÊME ÉDITEUR, LE MÊME CONTRAT DE FORME — RIEN DE NOUVEAU N'EST INVENTÉ.
 * --------------------------------------------------------------------------------------
 * `openShapeEditor` (map-shape-editor.js) lit/écrit toujours `entity.shape` : l'adaptateur
 * `{...composant, shape: composant.shapeInEquipment}` déjà utilisé pour baie/équipement
 * (interactive-map.js#installerFormesPhoto) est repris à l'identique. Le composant n'est
 * pas un magasin séparé : il vit dans `equipment.components[]`, donc « enregistrer »
 * relit l'équipement FRAIS, remplace CE composant dans la liste, et sauvegarde
 * l'équipement ENTIER — jamais un sous-champ isolé, jamais deux écritures partielles.
 * `db.save` porte déjà la protection par révision (STALE_WRITE) pour CE magasin ; une
 * erreur qu'il lève laisse, comme pour toute autre forme, l'éditeur ouvert et le
 * brouillon intact (map-shape-editor.js#enregistrer).
 *
 * QUE MONTRE UN CLIC — jamais une édition surprise.
 * --------------------------------------------------------------------------------------
 * Cliquer une carte DESSINÉE ouvre toujours sa fiche en LECTURE — quel que soit le rôle.
 * Dessiner ou reprendre une forme ne passe que par le bouton explicite « Dessiner une
 * carte / module », lui-même absent si `equipment.edit` n'est pas accordé : pas de mode
 * ambigu où un clic ferait tantôt l'un, tantôt l'autre.
 */
import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { mapCan } from './map-permissions-contract.js';
import { normalizeComponents } from './equipment-internals-contract.js';
import { normalizeShape, shapeContains } from './map-shape-contract.js';
import { toNaturalCoordinates } from './map-coordinates-contract.js';
import { SHAPE_IN_EQUIPMENT_FIELD, nestedPlacement, withNestedShape, shapeWithinBounds } from './nested-shape-contract.js';
import { openShapeEditor } from './map-shape-editor.js';
import { endpointIdentity, findComponent, resolveCableEndpoint, endpointBelongsToEquipment } from './cable-endpoint-contract.js';

export const EQUIPMENT_COMPONENT_SHAPES_VERSION = 1;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

// Même garde qu'equipment-media.js : ni l'un ni l'autre n'exporte cette prédicat (fichiers
// à effet de bord, sans export ES), et c'est une frontière de sécurité (XSS par `src`) —
// mieux vaut la relire ici, textuellement identique, qu'y dépendre d'un `window.*` global.
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (SAFE_DATA_IMAGE_RE.test(raw) || /^blob:/i.test(raw)) return raw;
  if (/^data:/i.test(raw)) return '';
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}

/** La première photo RÉELLE (terrain) de cet équipement — jamais un visuel constructeur. */
function chassisPhotoUrl(equipment) {
  for (const image of Array.isArray(equipment?.images) ? equipment.images : []) {
    const url = safeImageUrl(typeof image === 'string' ? image : (image?.url || image?.src));
    if (url) return url;
  }
  return '';
}

const VERIFICATION_LABELS = Object.freeze({ verified: 'Vérifié', documented: 'Documenté', 'to-confirm': 'À confirmer' });
const nomComposant = c => c.name || c.type || `Composant #${c.id}`;

/*
 * `map-shape-editor.js` appelle `notifications.showNotification(message, type)` — la
 * convention d'`interactive-map.js`, où `notifications` est injecté au montage. Cette
 * fiche n'a pas cet injecteur : elle vit dans l'écosystème `operations-suite.js`, dont le
 * seul canal global est `window.AppDialog.notice(message, type)` (app-dialog.js). Un
 * adaptateur d'une ligne suffit à réutiliser l'éditeur SANS lui apprendre une seconde
 * convention.
 */
const notificationsAdapter = Object.freeze({
  showNotification: (message, type) => window.AppDialog?.notice?.(message, type)
});

/**
 * Résout l'équipement derrière CETTE fiche ouverte — même stratégie que les autres
 * panneaux (equipment-media.js, grille-centrale-topology.js) : `dataset.equipmentId`
 * quand il est déjà posé, sinon le nom affiché dans l'en-tête, à la seule condition qu'il
 * ne désigne qu'un seul appareil.
 */
async function equipmentFor360(modal) {
  const explicitId = String(modal?.dataset?.equipmentId || '').trim();
  if (explicitId) {
    const equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(explicitId) : explicitId).catch(() => null);
    if (equipment) return equipment;
  }
  const name = modal?.querySelector('.ops-modal-head > div > div')?.textContent?.trim();
  if (!name) return null;
  const equipments = await db.getAll('equipments');
  const matches = equipments.filter(item => String(item.name || item.nom || '').trim() === name);
  return matches.length === 1 ? matches[0] : null;
}

/** Les composants de TOUS les équipements, identité de parent attachée — pour findComponent. */
async function composantsGlobaux() {
  const equipments = await db.getAll('equipments');
  return equipments.flatMap(item => normalizeComponents(item.components).map(component => ({
    ...component, parentEquipmentId: item.id, parentEquipmentName: item.name || item.nom || `#${item.id}`
  })));
}

/** Les câbles qui touchent CE composant précis — jamais un autre composant homonyme. */
function cablesForComponent(cables, component, equipment, globaux) {
  return (Array.isArray(cables) ? cables : []).filter(cable => ['source', 'destination'].some(side => {
    if (!endpointBelongsToEquipment(cable, side, equipment.id, { components: globaux })) return false;
    const identite = endpointIdentity(cable, side);
    if (identite.type !== 'component') return false;
    const resolu = findComponent(globaux, { componentId: identite.id, parentEquipmentId: identite.parentEquipmentId });
    return Boolean(resolu) && String(resolu.id) === String(component.id);
  }));
}

/**
 * La fiche en LECTURE d'un composant — Nom, Type, Constructeur, Modèle, N° série, Part
 * number, Slot, Statut, Validation, Notes, Ports, Câbles reliés, Équipement parent.
 * Aucune valeur inconnue n'est devinée : « À confirmer » le dit, jamais un blanc silencieux.
 */
async function showComponentDetail(component, equipment) {
  const [cables, globaux, screens] = await Promise.all([db.getAll('cables'), composantsGlobaux(), db.getAll('screens')]);
  const contexte = { equipments: await db.getAll('equipments'), screens, components: globaux };
  const cablesDuComposant = cablesForComponent(cables, component, equipment, globaux);

  document.getElementById('component-detail-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'component-detail-modal';
  modal.className = 'ops-modal';
  const ligne = (label, value) => `<div class="ops-fact"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;
  modal.innerHTML = `<div class="ops-modal-card" style="width:min(640px,calc(100vw - 30px))">
    <div class="ops-modal-head"><strong>Composant · ${esc(nomComposant(component))}</strong><button class="ops-close" aria-label="Fermer">×</button></div>
    <div class="ops-modal-body">
      <div class="ops-facts">
        ${ligne('Nom / repère', component.name || 'À confirmer')}
        ${ligne('Type', component.type)}
        ${ligne('Constructeur', component.manufacturer || 'À confirmer')}
        ${ligne('Modèle', component.model || 'À confirmer')}
        ${ligne('N° série', component.serialNumber || 'À confirmer')}
        ${ligne('Part number', component.partNumber || 'À confirmer')}
        ${ligne('Slot', component.slot || 'À confirmer')}
        ${ligne('Statut', component.status)}
        ${ligne('Validation', VERIFICATION_LABELS[component.verificationStatus] || component.verificationStatus)}
        ${ligne('Équipement parent', equipment.name || equipment.nom || `#${equipment.id}`)}
      </div>
      <h4 style="margin:14px 0 8px">Notes</h4>
      <div class="ops-empty">${esc(component.notes || 'Aucune note.')}</div>
      <h4 style="margin:14px 0 8px">Ports (${component.ports.length})</h4>
      <div class="ops-list">${component.ports.length ? component.ports.map(port => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(port.number)} · ${esc(port.type)}</strong><small>${esc(port.direction)}${port.label ? ` · ${esc(port.label)}` : ''}</small></div></div>`).join('') : '<div class="ops-empty">Aucun port documenté.</div>'}</div>
      <h4 style="margin:14px 0 8px">Câbles reliés (${cablesDuComposant.length})</h4>
      <div class="ops-list">${cablesDuComposant.length ? cablesDuComposant.map(cable => {
        const source = resolveCableEndpoint(cable, 'source', contexte);
        const destination = resolveCableEndpoint(cable, 'destination', contexte);
        return `<div class="ops-row"><div class="ops-row-main"><strong>${esc(cable.reference || cable.type || `Câble #${cable.id}`)}</strong><small>${esc(source.label)} → ${esc(destination.label)}</small></div></div>`;
      }).join('') : '<div class="ops-empty">Aucun câble relié à ce composant.</div>'}</div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.ops-close').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
}

/**
 * Monte le canevas de cartes/modules d'UN équipement — dessin, clic pour consulter, et
 * pour qui a `equipment.edit`, le bouton « Dessiner une carte / module » qui ouvre un
 * sélecteur des composants CANONIQUES de cet équipement, exactement comme
 * interactive-map.js#installerFormesPhoto le fait pour baie/équipement.
 */
function installerFormesComposants({ equipment, img, canvas, listeAPlacer, boutonDessiner, peutDessiner, notifications }) {
  const ctx = canvas.getContext('2d');
  let detruit = false;

  const composantsActuels = () => normalizeComponents(equipment.components);

  function dimensionnerCanevas() {
    if (!img.naturalWidth || !img.naturalHeight) return false;
    if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth;
    if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
    return true;
  }

  function dessiner() {
    if (detruit || !dimensionnerCanevas()) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const composant of composantsActuels()) {
      const place = nestedPlacement(composant, { shapeField: SHAPE_IN_EQUIPMENT_FIELD });
      if (place.kind !== 'shape') continue;
      ctx.beginPath();
      const chemin = place.shape;
      paintForme(chemin);
    }
    function paintForme(forme) {
      // Rendu minimal, cohérent avec map-shape-editor.js#COULEURS (ambre — libre ici,
      // aucune autre forme imbriquée n'utilise cette teinte).
      const TRAIT = '#e8a33d'; const FOND = 'rgba(232,163,61,.22)';
      ctx.save();
      if (forme.type === 'circle') { ctx.beginPath(); ctx.arc(forme.center.x, forme.center.y, forme.r, 0, Math.PI * 2); }
      else if (forme.type === 'polygon') { ctx.beginPath(); forme.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
      else { ctx.beginPath(); ctx.rect(forme.x, forme.y, forme.w, forme.h); }
      ctx.fillStyle = FOND; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = TRAIT; ctx.stroke();
      ctx.restore();
    }
    peindreListeAPlacer();
  }

  function peindreListeAPlacer() {
    if (!listeAPlacer) return;
    const nonPlaces = composantsActuels().filter(c => nestedPlacement(c, { shapeField: SHAPE_IN_EQUIPMENT_FIELD }).kind !== 'shape');
    if (!nonPlaces.length) { listeAPlacer.style.display = 'none'; listeAPlacer.innerHTML = ''; return; }
    listeAPlacer.style.display = 'block';
    /*
     * UNE CARTE À PLACER EST UN BOUTON — POUR QUI PEUT LA PLACER.
     *
     * Avec `equipments.edit` : un bouton actionnable, exactement comme
     * interactive-map.js#installerFormesPhoto le fait déjà pour baie/équipement — sans quoi
     * cette même liste, ici, ne menait nulle part au clic.
     *
     * Sans lui : une présentation INERTE, et c'est `is-empty` qui la porte — la même classe
     * que le repère « rien à choisir » du sélecteur explicite, pour la même raison (curseur
     * par défaut, aucune invitation au clic). Le fait « à placer » reste ÉCRIT : c'est une
     * information d'inventaire, elle n'appartient pas à l'éditeur et ne se cache pas avec
     * lui. Seule disparaît la promesse d'un geste que `ouvrirEditeur` refuserait — un refus
     * qu'on pouvait ne pas provoquer est un défaut d'écran, jamais une protection.
     */
    listeAPlacer.innerHTML = `<div class="nested-shapes-unplaced-title">À placer sur cette photo</div>`
      + nonPlaces.map(c => peutDessiner
        ? `<button type="button" class="nested-shapes-unplaced-item" data-id="${esc(String(c.id))}">${esc(nomComposant(c))} · à placer</button>`
        : `<span class="nested-shapes-unplaced-item is-empty">${esc(nomComposant(c))} · à placer</span>`).join('');
    listeAPlacer.querySelectorAll('.nested-shapes-unplaced-item[data-id]').forEach(bouton => {
      bouton.onclick = () => {
        const composant = composantsActuels().find(c => String(c.id) === bouton.dataset.id);
        if (composant) ouvrirEditeur(composant);
      };
    });
  }

  function pointNaturelDepuisEvenement(event) {
    return toNaturalCoordinates({ clientX: event.clientX, clientY: event.clientY, rect: canvas.getBoundingClientRect(), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
  }

  function composantAuPoint(point) {
    const liste = composantsActuels();
    for (let i = liste.length - 1; i >= 0; i -= 1) {
      const place = nestedPlacement(liste[i], { shapeField: SHAPE_IN_EQUIPMENT_FIELD });
      if (place.kind === 'shape' && shapeContains(place.shape, point)) return liste[i];
    }
    return null;
  }

  let editeur = null;

  function ouvrirEditeur(composant) {
    if (!peutDessiner) { notifications?.showNotification("Votre rôle ne permet pas de modifier cette carte.", 'error'); return; }
    editeur?.close();
    const vue = { ...composant, shape: composant.shapeInEquipment };
    editeur = openShapeEditor(vue, {
      canvas, ctx, type: 'component',
      overlays: [],
      eventToPoint: pointNaturelDepuisEvenement,
      displayScale: () => canvas.getBoundingClientRect().width / Math.max(1, canvas.width),
      redraw: dessiner,
      notifications,
      save: async patch => {
        const forme = normalizeShape(patch.shape);
        if (!shapeWithinBounds(forme, img.naturalWidth, img.naturalHeight)) {
          throw new Error('Cette forme est entièrement hors de la photo : elle n’a pas été enregistrée.');
        }
        /*
         * Le composant n'est pas un magasin propre : il vit dans `equipment.components[]`.
         * On relit l'équipement FRAIS (protection par révision, comme tout autre save),
         * on remplace CE composant dans sa liste, et on enregistre l'équipement ENTIER —
         * jamais un sous-champ isolé. Une erreur ici (conflit de révision compris) remonte
         * telle quelle : l'éditeur reste ouvert, le brouillon intact (contrat déjà établi
         * par map-shape-editor.js#enregistrer, inchangé).
         */
        const fraiche = await db.get('equipments', db.normalizeKey ? db.normalizeKey(equipment.id) : equipment.id);
        if (!fraiche) throw new Error('Cet équipement a été supprimé.');
        const composants = normalizeComponents(fraiche.components);
        const index = composants.findIndex(item => String(item.id) === String(composant.id));
        if (index < 0) throw new Error('Ce composant a été supprimé entre-temps.');
        composants[index] = withNestedShape(composants[index], SHAPE_IN_EQUIPMENT_FIELD, forme);
        const aEnregistrer = { ...fraiche, components: composants };
        await db.save('equipments', aEnregistrer);
        // `db.save` ne rend que l'identifiant (central-sync.js, write-coherence.js) : on
        // tient à jour l'objet local avec la valeur qu'on vient réellement d'écrire.
        equipment.components = composants;
        equipment._revision = aEnregistrer._revision;
        return aEnregistrer;
      },
      onClose: () => { editeur = null; dessiner(); }
    });
  }

  function surClicCanevas(event) {
    if (editeur) return;
    if (!img.naturalWidth) return;
    const composant = composantAuPoint(pointNaturelDepuisEvenement(event));
    if (composant) showComponentDetail(composant, equipment).catch(() => {});
  }

  canvas.addEventListener('click', surClicCanevas);

  if (boutonDessiner) {
    boutonDessiner.onclick = () => {
      const liste = composantsActuels();
      const hote = listeAPlacer;
      if (!hote) return;
      if (hote.dataset.picker === '1') { hote.dataset.picker = '0'; dessiner(); return; }
      hote.dataset.picker = '1';
      hote.style.display = 'block';
      hote.innerHTML = `<div class="nested-shapes-unplaced-title">Choisir un composant à dessiner sur cette photo</div>`
        + (liste.length
          ? liste.map(c => {
              const place = nestedPlacement(c, { shapeField: SHAPE_IN_EQUIPMENT_FIELD });
              return `<button type="button" class="nested-shapes-unplaced-item${place.kind === 'shape' ? ' is-placed' : ''}" data-id="${esc(String(c.id))}">${esc(nomComposant(c))} <small>${place.kind === 'shape' ? '· déjà positionné' : '· à placer'}</small></button>`;
            }).join('')
          : '<div class="nested-shapes-unplaced-item is-empty">Aucun composant enregistré sur cet équipement.</div>');
      hote.querySelectorAll('.nested-shapes-unplaced-item[data-id]').forEach(bouton => {
        bouton.onclick = () => {
          const composant = liste.find(c => String(c.id) === bouton.dataset.id);
          hote.dataset.picker = '0'; hote.style.display = 'none'; hote.innerHTML = '';
          if (composant) ouvrirEditeur(composant);
        };
      });
    };
  }

  if (img.complete && img.naturalWidth) dessiner();
  else img.addEventListener('load', dessiner);

  return { redraw: dessiner, destroy: () => { detruit = true; editeur?.close(); } };
}

let installationsActuelles = new WeakMap();

async function enhanceComponentShapes(modal) {
  if (!modal || modal.dataset.componentShapesEnhanced === '1' || modal.dataset.componentShapesEnhancing === '1') return false;
  modal.dataset.componentShapesEnhancing = '1';
  try {
    const equipment = await equipmentFor360(modal);
    if (!equipment) return false;
    const composants = normalizeComponents(equipment.components);
    if (!composants.length) return false; // rien à positionner : la section n'a pas lieu d'être.

    const target = modal.querySelector('.ops-modal-body > div[style*="display:grid"]') || modal.querySelector('.ops-modal-body');
    if (!target) return false;

    const photo = chassisPhotoUrl(equipment);
    const peutDessiner = mapCan(getCurrentUser(), 'equipment', 'edit');
    const section = document.createElement('section');
    section.className = 'ops-card equipment-component-shapes-card';
    const idCanevas = `component-shapes-canvas-${equipment.id}`;
    const idImage = `component-shapes-image-${equipment.id}`;
    const idListe = `component-shapes-picker-${equipment.id}`;
    const idBouton = `draw-component-btn-${equipment.id}`;

    section.innerHTML = photo
      ? `<h3><i class="fas fa-microchip"></i> Cartes & modules sur la photo</h3>
         <p class="ops-card-sub">Positions dessinées sur la photo réelle de cet appareil — indépendantes du plan général et des formes de salle/baie.</p>
         <div style="position:relative;display:inline-block;max-width:100%;">
           <img id="${idImage}" src="${esc(photo)}" style="display:block;max-width:100%;border-radius:10px;" alt="Photo réelle de l'équipement">
           <canvas id="${idCanevas}" style="position:absolute;inset:0;width:100%;height:100%;" aria-label="Cartes et modules sur cette photo"></canvas>
         </div>
         <div id="${idListe}" class="nested-shapes-unplaced" style="display:none;"></div>
         ${peutDessiner ? `<button type="button" class="btn" id="${idBouton}" style="margin-top:10px;"><i class="fas fa-vector-square"></i> Dessiner une carte / module</button>` : ''}`
      : `<h3><i class="fas fa-microchip"></i> Cartes & modules</h3>
         <div class="ops-empty">Aucune photo réelle enregistrée pour cet équipement — impossible de positionner les cartes tant qu'une photo réelle n'est pas ajoutée. Composants documentés : ${esc(composants.map(nomComposant).join(', '))}.</div>`;
    target.appendChild(section);
    modal.dataset.componentShapesEnhanced = '1';

    if (photo) {
      const installation = installerFormesComposants({
        equipment,
        img: document.getElementById(idImage),
        canvas: document.getElementById(idCanevas),
        listeAPlacer: document.getElementById(idListe),
        boutonDessiner: document.getElementById(idBouton),
        peutDessiner,
        notifications: notificationsAdapter
      });
      installationsActuelles.set(modal, installation);
    }
    return true;
  } finally {
    delete modal.dataset.componentShapesEnhancing;
  }
}

function schedule360Enhancement(modal) {
  if (!modal) return;
  queueMicrotask(() => enhanceComponentShapes(modal).catch(() => {}));
  setTimeout(() => enhanceComponentShapes(modal).catch(() => {}), 100);
  setTimeout(() => enhanceComponentShapes(modal).catch(() => {}), 500);
}

function installObserver() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const host = document.getElementById('app') || document.body;
  if (!host || host.dataset.componentShapesObserver === '1') return;
  host.dataset.componentShapesObserver = '1';
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
        if (modal) schedule360Enhancement(modal);
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof Element && (node.id === 'ops-equipment-360' || node.querySelector?.('#ops-equipment-360'))) {
          installationsActuelles.get(node)?.destroy?.();
        }
      }
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  const existing = document.getElementById('ops-equipment-360');
  if (existing) schedule360Enhancement(existing);
}

if (typeof window !== 'undefined') {
  installObserver();
  window.EquipmentComponentShapes = Object.freeze({
    version: EQUIPMENT_COMPONENT_SHAPES_VERSION,
    enhance: enhanceComponentShapes,
    showDetail: showComponentDetail
  });
}

export default typeof window !== 'undefined' ? window.EquipmentComponentShapes : Object.freeze({ version: EQUIPMENT_COMPONENT_SHAPES_VERSION });
