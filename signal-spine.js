/**
 * @file signal-spine.js — le fil du signal, colonne vertébrale de la plateforme.
 *
 * L'IDÉE
 * ------
 * Cette plateforme n'existe que pour qu'un signal aille de l'acquisition à l'antenne sans
 * rupture. L'interface n'en disait rien : elle présentait des listes d'objets, comme
 * n'importe quel gestionnaire de parc. Un bandeau permanent porte désormais la chaîne —
 * Acquisition, Régie, Continuité, Diffusion — au même endroit sur toutes les pages, avec
 * l'état réel de chaque segment.
 *
 * OÙ IL S'INSÈRE, ET POURQUOI LÀ
 * ------------------------------
 * Mesuré : `.admin-page` n'est pas une grille mais une barre latérale fixe plus un contenu
 * décalé par `margin-left` — et ce `margin-left` est disputé par cinq feuilles de style. Le
 * dupliquer sur un nouvel élément frère aurait été une sixième voix dans un conflit déjà
 * ouvert. `#admin-tabs`, l'autre bande horizontale, a d'ailleurs `margin-left: 0` sur
 * bureau et se rend derrière la barre latérale : mauvais précédent.
 *
 * Le bandeau est donc posé À L'INTÉRIEUR de `#admin-content`, en premier enfant. Il hérite
 * ainsi de l'alignement exact du contenu sans aucun calcul de marge, sur toutes les
 * largeurs. Comme `loadSection` réécrit `innerHTML` à chaque section, il est réinséré après
 * chaque rendu — d'où l'enveloppe autour de cette méthode, qui est le passage obligé de
 * toutes les sections.
 *
 * CE QU'IL NE FAIT PAS
 * --------------------
 * Il n'invente aucun rattachement. Une salle sans segment déclaré apparaît explicitement
 * comme non rattachée, ce qui donne au responsable la liste exacte de ce qui reste à
 * qualifier — au lieu de la masquer derrière une devinette sur les noms de salles.
 */

import AdminUI from './admin-ui.js';
import { db } from './db.js';
import { summarizeSignalChain, SEGMENT_STATES } from './signal-chain-contract.js';

export const SIGNAL_SPINE_VERSION = 1;

const PATCH_FLAG = Symbol.for('2m-tech.signal-spine.patched');
const HOST_ID = 'signal-spine';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

/** Le libellé d'état porte le sens ; la couleur seule ne suffit pas à un daltonien. */
const ETAT_TEXTE = Object.freeze({
  [SEGMENT_STATES.LOCKED]: 'verrouillé',
  [SEGMENT_STATES.DEGRADED]: 'dégradé',
  [SEGMENT_STATES.LOST]: 'hors service',
  [SEGMENT_STATES.UNVERIFIED]: 'à vérifier',
  [SEGMENT_STATES.EMPTY]: 'aucun équipement'
});

/** Le mot qui accompagne le nombre. Sans lui, le nombre emprunte le sens du voisin. */
const unite = (item, nombre) => item.segment === 'unassigned'
  ? (nombre > 1 ? 'non rattachés' : 'non rattaché')
  : (nombre > 1 ? 'équipements' : 'équipement');

/**
 * CE QUE LE SEGMENT DIT DE SON ÉTAT — et ce qu'il ne dit plus.
 *
 * Mesuré avant ce correctif : le bloc affichait le TOTAL du segment, immédiatement suivi
 * du libellé d'état. Dix-huit équipements dont UN SEUL hors service se lisaient donc
 * « 18 hors service ». Le nombre appartenait à une grandeur, le mot à une autre, et rien
 * ne les séparait à l'œil.
 *
 * Trois grandeurs, désormais énoncées séparément :
 *   · le total, suivi de son unité — « 18 non rattachés » ;
 *   · le nombre RÉELLEMENT hors service, quand il y en a — « 1 hors service » ;
 *   · l'état du segment, qui reste porté par `data-state` (couleur et filet).
 *
 * La définition de la panne n'est pas réinventée : `downCount` et `maintenanceCount`
 * viennent du contrat de chaîne, qui les tient lui-même d'`equipment-status-contract`.
 */
function etatTexte(item) {
  if (item.downCount > 0) return `${item.downCount} hors service`;
  if (item.maintenanceCount > 0) return `${item.maintenanceCount} en maintenance`;
  return ETAT_TEXTE[item.state] || item.state;
}

function figuresMarkup(item, enCours) {
  if (enCours) return '<span class="spine-segment-sync">Synchronisation…</span>';
  return `<span class="spine-segment-count">${item.equipmentCount}</span>
        <span class="spine-segment-unit">${esc(unite(item, item.equipmentCount))}</span>
        <span class="spine-sep" aria-hidden="true">·</span>
        <span class="spine-segment-state">${esc(etatTexte(item))}</span>`;
}

function segmentMarkup(item, enCours) {
  return `
    <button type="button" class="spine-segment" data-segment="${esc(item.segment)}"
            data-state="${esc(enCours ? 'pending' : item.state)}" aria-pressed="false"
            title="${esc(item.description)}">
      <span class="spine-segment-name">${esc(item.label)}</span>
      <span class="spine-segment-figures">
        ${figuresMarkup(item, enCours)}
      </span>
    </button>`;
}

export function spineMarkup(resume, { enCours = false } = {}) {
  const segments = resume.segments
    .map(item => segmentMarkup(item, enCours))
    .join('<span class="spine-link" aria-hidden="true"></span>');
  // Le hors-chaîne compte comme les autres : des équipements. Afficher son nombre de SALLES
  // donnait « 0 salle(s) » sur un bloc pourtant présent — le cas d'équipements rattachés à
  // aucune salle, qui est un problème réel mais différent. Le détail dit les deux chiffres.
  const reste = resume.unassigned
    ? `<button type="button" class="spine-segment is-pending" data-segment="unassigned"
               data-state="${esc(enCours ? 'pending' : resume.unassigned.state)}" aria-pressed="false"
               title="${esc(resume.unassigned.description)}">
         <span class="spine-segment-name">${esc(resume.unassigned.label)}</span>
         <span class="spine-segment-figures">
           ${figuresMarkup(resume.unassigned, enCours)}
         </span>
       </button>`
    : '';
  return `
    <nav id="${HOST_ID}" class="signal-spine" data-intact="${enCours ? 'inconnu' : (resume.intact ? 'oui' : 'non')}"
         data-chargement="${enCours ? 'oui' : 'non'}" aria-label="Chaîne du signal"
         aria-busy="${enCours ? 'true' : 'false'}">
      <span class="spine-eyebrow">Chaîne du signal</span>
      <div class="spine-track">${segments}${reste ? `<span class="spine-break" aria-hidden="true"></span>${reste}` : ''}</div>
    </nav>`;
}

async function lireChaine() {
  const [rooms, equipments] = await Promise.all([db.getAll('rooms'), db.getAll('equipments')]);
  return summarizeSignalChain({ rooms: rooms || [], equipments: equipments || [] });
}

/* ═══════════════════════ LA CONVERGENCE INITIALE SE DIT ═══════════════════════
 *
 * CE QUI ÉTAIT MESURÉ
 * -------------------
 * Le bandeau lit la base LOCALE au moment où il se pose, et présente ce qu'il y
 * trouve comme un fait acquis. Relevé au navigateur sur la base 60c1bc2 : à
 * t = 4 496 ms le bandeau affichait un nombre définitif alors que la convergence
 * du catalogue était encore en cours — 124 fiches en attente à cet instant, 508
 * six secondes plus tard. Le nombre pouvait donc changer APRÈS avoir été annoncé
 * (18 relevé, puis 8), sans que rien n'ait prévenu qu'il n'était pas définitif.
 *
 * CE QUI EST FAIT — ET CE QUI NE L'EST PAS
 * ----------------------------------------
 * Rien n'est changé à la synchronisation, au snapshot ni à la propriété du
 * catalogue : ce lot ne touche que l'affichage. Le bandeau se contente
 * d'OBSERVER le signal que `central-sync.js` émet déjà, `central-sync-status`.
 * Le témoin est posé au CHARGEMENT du module, et non au montage du bandeau : les
 * premiers statuts partent avant que la première section ne soit rendue, si bien
 * qu'un écouteur posé plus tard n'entendrait pas le début de l'histoire.
 *
 * UN STATUT N'EST PAS UNE CONCLUSION — ce que ce module a d'abord cru
 * ------------------------------------------------------------------
 * La première version de cette garde sortait de l'attente au PREMIER
 * `central-sync-status` venu, « quelle que soit sa conclusion ». C'était faux, et
 * un Gate indépendant l'a mesuré sur base fraîche, serveur et navigateur réels :
 *
 *   t =    998 ms  central-sync-status { state:"offline" }     ← une écriture locale
 *   t =  4 630 ms  bandeau : chargement="non", « 51 non rattachés »   ← DÉFINITIF
 *   t = 22 185 ms  central-sync-status { state:"warning", updatedAt } ← 1er snapshot
 *   t = 22 587 ms  bandeau : « 56 non rattachés »                     ← DÉFINITIF
 *
 * Deux, parfois trois valeurs définitives pendant la seule initialisation
 * (51 → 5 → 56 sur un autre parcours), et l'état « Synchronisation… » jamais
 * atteint. La raison tient en une phrase : un `offline` émis parce qu'une
 * ÉCRITURE LOCALE n'a pas pu partir ne dit rien de l'état des DONNÉES LUES. Les
 * semeurs en produisent des dizaines dans la première seconde — 217 relevés sur un
 * parcours — et aucun ne prouve qu'un instantané central a été appliqué.
 *
 * LA PREUVE QUE LE CONTRAT DONNE DÉJÀ
 * -----------------------------------
 * `central-sync.js` n'émet `updatedAt: snapshot.serverTime` que sur les trois
 * statuts postérieurs à `applySnapshot()` — `synced`, mais aussi `warning` et
 * `offline` lorsqu'il reste des opérations en file. Les statuts précoces, issus de
 * `save`, `delete` ou du rejeu de la file, ne le portent pas. La question posée
 * ici est donc « un instantané a-t-il été appliqué ? », et non « le mot synced
 * est-il affiché ? » — sans quoi un parc dont la file traîne resterait en attente
 * pour toujours.
 *
 * Cette preuve n'est pas une seconde source de vérité : elle est celle du contrat
 * central, lue telle qu'il l'écrit. Aucune ligne de `central-sync.js` n'est
 * touchée.
 * ═══════════════════════════════════════════════════════════════════════════ */

let premiereSyncConclue = false;
let signatureAffichee = '';
/** Le dernier résumé effectivement affiché : le détail s'y réfère, jamais à un plus ancien. */
let resumeCourant = null;

/** Ce que le bandeau affiche aujourd'hui, réduit à une empreinte comparable. */
const signatureDe = (resume, enCours) => enCours ? 'synchronisation' : JSON.stringify(
  [...resume.segments, resume.unassigned].filter(Boolean)
    .map(item => [item.segment, item.equipmentCount, item.downCount, item.maintenanceCount, item.state])
);

/**
 * Le bandeau déjà posé se remet à jour SUR PLACE.
 *
 * Sans cela, un chiffre corrigé n'apparaissait qu'à la navigation suivante : la
 * personne devant l'écran voyait une valeur, puis une autre, sans transition.
 */
async function rafraichirBandeau() {
  const bandeau = document.getElementById(HOST_ID);
  if (!bandeau) return;
  let resume;
  try { resume = await lireChaine(); }
  catch { return; }
  const enCours = !premiereSyncConclue;
  const signature = signatureDe(resume, enCours);
  // Rien n'a bougé : on ne réécrit pas, sinon on refermerait le détail ouvert.
  if (signature === signatureAffichee) return;
  const modele = document.createElement('div');
  modele.innerHTML = spineMarkup(resume, { enCours });
  const remplacant = modele.firstElementChild;
  if (!remplacant) return;
  bandeau.dataset.chargement = remplacant.dataset.chargement;
  bandeau.dataset.intact = remplacant.dataset.intact;
  bandeau.setAttribute('aria-busy', remplacant.getAttribute('aria-busy'));
  bandeau.innerHTML = remplacant.innerHTML;
  signatureAffichee = signature;
  resumeCourant = resume;
}

/**
 * Ce statut prouve-t-il qu'un instantané central a été reçu ET appliqué ?
 *
 * `updatedAt` porte l'heure serveur de l'instantané. `central-sync.js` ne l'appose
 * que sur les statuts émis APRÈS `applySnapshot()` : c'est exactement la preuve
 * cherchée, et le seul endroit du contrat où elle existe. Un statut sans elle —
 * `offline` d'une écriture retenue, `conflict` d'une écriture périmée, `local`
 * d'une lecture qui n'a pas abouti — ne dit rien des données affichées.
 */
const prouveUnInstantaneApplique = detail => Boolean(detail && detail.updatedAt);

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    // Sans preuve, on ne conclut RIEN : le bandeau garde son état d'attente et
    // n'avance aucun chiffre. C'est le cœur du correctif — un `offline` précoce
    // libérait les compteurs sur des données que le centre n'avait pas encore
    // envoyées.
    if (!prouveUnInstantaneApplique(event?.detail)) return;
    premiereSyncConclue = true;
    rafraichirBandeau().catch(() => {});
  });
  // Le catalogue central vient d'être posé : les compteurs peuvent avoir bougé.
  // L'installation passe elle-même par une relecture centrale, donc par un statut
  // porteur de preuve : ce recalcul ne peut pas devancer le premier instantané.
  window.addEventListener('central-catalog-installed', () => { rafraichirBandeau().catch(() => {}); });
}

/** Détail d'un segment : les salles qui le composent, nommées. */
/** Accord au singulier ou au pluriel : le nombre est connu, « (s) » n'a plus lieu d'être. */
const accord = (nombre, singulier, pluriel) => `${nombre} ${nombre > 1 ? pluriel : singulier}`;

function detailMarkup(resume, segment) {
  const item = segment === 'unassigned'
    ? resume.unassigned
    : resume.segments.find(entry => entry.segment === segment);
  if (!item) return '';
  const titre = segment === 'unassigned'
    ? 'Ces salles n’ont pas encore de place déclarée dans la chaîne.'
    : item.description;
  // Le détail redit les trois grandeurs, nommées : c'est là que le total et le nombre de
  // pannes doivent être le plus difficiles à confondre.
  const pannes = item.downCount > 0 ? `<strong>${item.downCount}</strong> hors service` : 'aucun hors service';
  const maintenance = item.maintenanceCount > 0
    ? ` · <strong>${item.maintenanceCount}</strong> en maintenance` : '';
  return `
    <div class="spine-detail" role="region" aria-live="polite">
      <p class="spine-detail-lead">${esc(titre)}</p>
      <p class="spine-detail-figures">
        <strong>${item.roomCount}</strong> ${item.roomCount > 1 ? 'salles' : 'salle'}
        · <strong>${item.equipmentCount}</strong> ${item.equipmentCount > 1 ? 'équipements' : 'équipement'}
        · ${pannes}${maintenance}
        · état du segment : <strong>${esc(item.stateLabel)}</strong>
      </p>
    </div>`;
}

async function monterBandeau() {
  const hote = document.getElementById('admin-content');
  if (!hote || document.getElementById(HOST_ID)) return;
  let resume;
  try { resume = await lireChaine(); }
  catch (error) {
    // Un bandeau qui n'a pas pu lire ses données ne doit pas empêcher la page de s'afficher.
    console.warn('Chaîne du signal indisponible.', error);
    return;
  }
  const enCours = !premiereSyncConclue;
  // SECONDE VÉRIFICATION, après l'attente. La première ne suffit pas : la lecture des
  // données est asynchrone, si bien que deux navigations rapprochées franchissaient toutes
  // deux la garde avant que l'une ait inséré quoi que ce soit. Mesuré : dix segments au
  // lieu de cinq, deux bandeaux empilés. Une garde posée avant un `await` ne garde rien.
  if (document.getElementById(HOST_ID)) return;
  hote.insertAdjacentHTML('afterbegin', spineMarkup(resume, { enCours }));
  const bandeau = document.getElementById(HOST_ID);
  if (!bandeau) return;
  resumeCourant = resume;
  signatureAffichee = signatureDe(resume, enCours);

  bandeau.addEventListener('click', event => {
    const bouton = event.target.closest('.spine-segment');
    if (!bouton) return;
    const deja = bouton.getAttribute('aria-pressed') === 'true';
    for (const autre of bandeau.querySelectorAll('.spine-segment')) autre.setAttribute('aria-pressed', 'false');
    bandeau.querySelector('.spine-detail')?.remove();
    if (deja) return;
    bouton.setAttribute('aria-pressed', 'true');
    // `resumeCourant`, et non la valeur capturée au montage : le bandeau se corrige sur
    // place quand la synchronisation conclut, et le détail doit dire la même chose que lui.
    bandeau.insertAdjacentHTML('beforeend', detailMarkup(resumeCourant || resume, bouton.dataset.segment));
  });
}

export function installSignalSpine() {
  if (AdminUI.prototype[PATCH_FLAG]) return;
  const original = AdminUI.prototype.loadSection;
  AdminUI.prototype.loadSection = async function loadSectionWithSpine(section) {
    const resultat = await original.call(this, section);
    // Après le rendu, jamais avant : `loadSection` remplace `innerHTML` et emporterait
    // le bandeau avec lui.
    await monterBandeau().catch(error => console.warn('Bandeau de chaîne non posé.', error));
    return resultat;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value: true });
}

installSignalSpine();

export default Object.freeze({ version: SIGNAL_SPINE_VERSION, installSignalSpine, spineMarkup });
