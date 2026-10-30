/*
 * 2M TECH Platform — Pilote Technique UI Preview
 * ------------------------------------------------
 * Couche opt-in. Elle ne prend aucune décision d'autorisation et ne modifie aucune donnée.
 * Les actions visibles restent celles projetées par les composants/permissions existants.
 */

const STORAGE_KEY = '2m-pilot-ui';
const params = new URLSearchParams(window.location.search);
const explicit = params.get('pilote');

/*
 * PRÉCÉDENCE — choix explicite de l'URL, sinon préférence mémorisée, sinon Pilote par défaut.
 *
 * Pilote est passé en défaut une fois le Gate final de recette entièrement vert (556/556,
 * six rôles). `?pilote=0`/`?pilote=1` mémorisent désormais TOUS LES DEUX leur choix — y
 * compris `0` — pour que « Interface classique » (le seul chemin qui pose `?pilote=0` en
 * pratique, voir `deactivatePreview`) reste un choix qui TIENT au prochain chargement SANS
 * paramètre, au lieu de retomber sur le nouveau défaut Pilote une fois la préférence
 * effacée : c'est exactement le piège qu'une simple case à cocher aurait posé.
 */
if (explicit === '0') {
  try { localStorage.setItem(STORAGE_KEY, '0'); } catch {}
} else if (explicit === '1') {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
}

let active = explicit === '1';
if (explicit == null) {
  let memorisee = null;
  try { memorisee = localStorage.getItem(STORAGE_KEY); } catch { memorisee = null; }
  active = memorisee === null ? true : memorisee === '1';
}

function cleanPilotParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('pilote');
  return `${url.pathname}${url.search}${url.hash}`;
}

function deactivatePreview() {
  // Mémorise EXPLICITEMENT « 0 », jamais un simple retrait : Pilote étant désormais le
  // défaut sans préférence mémorisée, un retrait renverrait ce choix droit vers Pilote au
  // prochain chargement sans paramètre — exactement le piège qu'« Interface classique » doit
  // éviter.
  try { localStorage.setItem(STORAGE_KEY, '0'); } catch {}
  const url = new URL(window.location.href);
  url.searchParams.set('pilote', '0');
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

/*
 * UN EN-TÊTE PAR RÔLE, QUATRE FORMES DIFFÉRENTES.
 *
 * Mesuré dans le navigateur, sur les six rôles : seul `admin-ui.js` (partagé par
 * Administrateur, Manager et Chef) porte `#platform-title` et `.header-right`. Le
 * Responsable porte `.responsible-header-actions`, le Technicien `.smart-tech-header
 * .header-actions`, le Visiteur `.visitor-header-actions` — trois marqueurs que les
 * sélecteurs précédents (`.resp-header .header-right`, `.tech-header .header-right`)
 * n'atteignaient JAMAIS. Résultat : ni le badge « Pilote Technique » ni le bouton
 * « Interface classique » n'apparaissaient pour ces trois rôles, qui entraient donc en
 * prévisualisation SANS AUCUN MOYEN VISIBLE d'en sortir autrement qu'en modifiant l'URL à
 * la main. Cette table nomme chaque forme réelle au lieu d'en deviner une commune.
 */
const HEADER_SHAPES = Object.freeze([
  { header: '.admin-header', title: '#platform-title', actions: '.header-right' },
  { header: '.responsible-header', title: 'h1', actions: '.responsible-header-actions' },
  { header: '.smart-tech-header', title: 'h1', actions: '.header-actions' },
  { header: '.visitor-header', title: 'h1', actions: '.visitor-header-actions' }
]);

function ensureHeaderDecorations() {
  for (const forme of HEADER_SHAPES) {
    const header = document.querySelector(forme.header);
    if (!header) continue;

    const title = header.querySelector(forme.title);
    if (title && !title.parentElement?.querySelector('.pilot-technique-badge')) {
      const badge = document.createElement('span');
      badge.className = 'pilot-technique-badge';
      badge.textContent = 'Pilote Technique';
      badge.title = 'Prévisualisation de la nouvelle interface — aucune donnée ni permission modifiée';
      title.insertAdjacentElement('afterend', badge);
    }

    const actions = header.querySelector(forme.actions);
    if (actions && !actions.querySelector('.pilot-preview-exit')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pilot-preview-exit';
      button.textContent = 'Interface classique';
      button.title = 'Quitter la prévisualisation Pilote Technique';
      button.addEventListener('click', deactivatePreview);
      actions.prepend(button);
    }
  }

  // `#global-search` (Administrateur/Manager/Chef) et `#global-tech-search` (Technicien) :
  // même décoration, deux identifiants réels.
  for (const id of ['global-search', 'global-tech-search']) {
    const search = document.getElementById(id);
    if (search && !search.dataset.pilotPlaceholder) {
      search.dataset.pilotPlaceholder = search.placeholder || '';
      search.placeholder = 'Rechercher un lieu, un équipement, une baie…';
      search.setAttribute('aria-label', 'Rechercher dans la plateforme');
    }
  }
}

function decorateEquipmentPage() {
  const contents = document.querySelectorAll('#admin-content, #responsible-content, #app');
  for (const container of contents) {
    for (const card of container.querySelectorAll(':scope .card')) {
      const heading = card.querySelector(':scope > .card-header h2, :scope > h2');
      if (heading?.textContent?.trim() !== 'Équipements') continue;
      card.classList.add('pilot-equipments-shell');
    }
  }

  const quickView = document.getElementById('equip-quickview-modal');
  if (quickView) {
    quickView.classList.add('pilot-equipment-inspector');
    quickView.setAttribute('aria-label', "Détails de l'équipement");
  }
}

/*
 * PROCÉDURES : LE MVP #160 DOIT PARLER LA MÊME LANGUE VISUELLE QUE LE PILOTE (#161).
 *
 * `continuity-center.css` reste volontairement la feuille canonique du composant et
 * l'interface classique n'est pas touchée. Cette reprise est injectée uniquement quand la
 * prévisualisation Pilote est active ; elle réutilise les jetons déjà présents dans
 * `pilot-technique-preview.css`. Aucun contrat métier, permission, route ou donnée n'est
 * modifié et aucun `!important` n'est nécessaire.
 */
function ensureProceduresPilotStyles() {
  if (document.getElementById('pilot-procedures-theme')) return;
  const style = document.createElement('style');
  style.id = 'pilot-procedures-theme';
  style.textContent = `
body.pilot-technique-ui .procedures-center{color:var(--pilot-text)}
body.pilot-technique-ui .procedures-header h2{color:#f3f8fd}
body.pilot-technique-ui .procedures-subtitle,
body.pilot-technique-ui .procedure-purpose,
body.pilot-technique-ui .procedure-meta,
body.pilot-technique-ui .procedure-detail-meta,
body.pilot-technique-ui .procedure-step-time,
body.pilot-technique-ui .procedures-hint{color:var(--pilot-muted)}
body.pilot-technique-ui .procedures-search{border-color:var(--pilot-line-strong);background:#0a1e30;color:var(--pilot-text)}
body.pilot-technique-ui .procedures-search>i{color:#6fb1ff}
body.pilot-technique-ui .procedures-search input{color:var(--pilot-text)}
body.pilot-technique-ui .procedures-search input::placeholder{color:#7894aa}
body.pilot-technique-ui .procedures-search:focus-within{border-color:rgba(45,131,247,.72);box-shadow:0 0 0 3px rgba(45,131,247,.12)}
body.pilot-technique-ui .procedure-card,
body.pilot-technique-ui .procedures-empty,
body.pilot-technique-ui .procedure-step{background:linear-gradient(180deg,rgba(14,41,65,.92),rgba(10,31,50,.94));border-color:var(--pilot-line);color:var(--pilot-text);box-shadow:none}
body.pilot-technique-ui .procedure-card h3,
body.pilot-technique-ui .procedure-step-head strong{color:#f1f8ff}
body.pilot-technique-ui .procedure-status{background:rgba(143,169,189,.11);color:#c9d9e6}
body.pilot-technique-ui .procedure-status-validated{background:rgba(49,199,119,.12);color:#79e4aa}
body.pilot-technique-ui .procedure-status-draft{background:rgba(245,184,61,.12);color:#f5ce78}
body.pilot-technique-ui .procedure-status-documented{background:rgba(45,131,247,.13);color:#8bc0ff}
body.pilot-technique-ui .procedure-status-suspended{background:rgba(240,91,97,.13);color:#ff9fa4}
body.pilot-technique-ui .procedure-status-retired{background:rgba(143,169,189,.10);color:#aebfcb}
body.pilot-technique-ui .procedure-meta i,
body.pilot-technique-ui .procedure-ref i,
body.pilot-technique-ui .procedure-detail-meta i,
body.pilot-technique-ui .procedures-note i{color:#6fb1ff}
body.pilot-technique-ui .procedure-meta-missing{color:#f5ce78}
body.pilot-technique-ui .procedure-meta-missing i{color:var(--pilot-amber)}
body.pilot-technique-ui .procedure-ref{border-color:var(--pilot-line);background:rgba(255,255,255,.035);color:#cfe1ef}
body.pilot-technique-ui button.procedure-ref-open{border-color:rgba(45,131,247,.42);background:rgba(45,131,247,.11);color:#a8ceff}
body.pilot-technique-ui button.procedure-ref-open:hover,
body.pilot-technique-ui button.procedure-ref-open:focus-visible{border-color:rgba(45,131,247,.75);background:rgba(45,131,247,.2);color:#e8f3ff;outline:2px solid rgba(45,131,247,.35);outline-offset:2px}
body.pilot-technique-ui .procedure-ref-missing{border-color:rgba(245,184,61,.42);background:rgba(245,184,61,.10);color:#f5ce78}
body.pilot-technique-ui .procedure-ref-missing i{color:var(--pilot-amber)}
body.pilot-technique-ui .procedure-ref-more{background:rgba(143,169,189,.09);color:#b7c8d5}
body.pilot-technique-ui .procedures-empty{border-style:dashed;color:#b8c9d6;text-align:center}
body.pilot-technique-ui .procedures-note{border:1px solid var(--pilot-line);background:rgba(45,131,247,.08);color:#c8dceb}
body.pilot-technique-ui .procedures-error p{color:#ff9fa4}
body.pilot-technique-ui .procedures-modal{background:rgba(3,13,23,.82)}
body.pilot-technique-ui .procedures-modal-card{border:1px solid var(--pilot-line-strong);background:linear-gradient(180deg,#0c2439,#081a2b);color:var(--pilot-text);box-shadow:var(--pilot-shadow)}
body.pilot-technique-ui .procedures-modal-card>.modal-x{color:#a9c2d5}
body.pilot-technique-ui .procedures-modal-card>.modal-x:hover,
body.pilot-technique-ui .procedures-modal-card>.modal-x:focus-visible{color:#fff;outline:2px solid rgba(45,131,247,.42);outline-offset:2px;border-radius:6px}
body.pilot-technique-ui .procedure-block{border:1px solid var(--pilot-line);background:rgba(255,255,255,.025)}
body.pilot-technique-ui .procedure-block h4{color:#dfeefa}
body.pilot-technique-ui .procedure-block p,
body.pilot-technique-ui .procedure-plain-list,
body.pilot-technique-ui .procedure-step-instruction{color:#c8d9e6}
body.pilot-technique-ui .procedure-step-type{background:rgba(45,131,247,.12);color:#91c2ff}
body.pilot-technique-ui .procedure-step-expected{color:#79e4aa}
body.pilot-technique-ui .procedure-step-warning{border-color:rgba(245,184,61,.42);background:rgba(245,184,61,.10);color:#f5ce78}
body.pilot-technique-ui .procedures-form label,
body.pilot-technique-ui .procedures-steps-field legend{color:#cfe1ef}
body.pilot-technique-ui .procedures-form input,
body.pilot-technique-ui .procedures-form select,
body.pilot-technique-ui .procedures-form textarea{border-color:var(--pilot-line);background:#0a1e30;color:var(--pilot-text)}
body.pilot-technique-ui .procedures-form :is(input,select,textarea):focus{outline:none;border-color:rgba(45,131,247,.72);box-shadow:0 0 0 3px rgba(45,131,247,.12)}
body.pilot-technique-ui .procedures-form :is(input,textarea)::placeholder{color:#7894aa}
body.pilot-technique-ui .procedures-form :is(input,select,textarea):disabled{background:#10263a;color:#70879a;cursor:not-allowed}
body.pilot-technique-ui .procedures-steps-field{border-color:var(--pilot-line)}
body.pilot-technique-ui .ops-engineering-links h4{color:#a8c5dc}
body.pilot-technique-ui .engineering-links-list li{border-color:var(--pilot-line);background:rgba(255,255,255,.025);color:var(--pilot-text)}
body.pilot-technique-ui .engineering-link-open{color:#84baff}
body.pilot-technique-ui .engineering-link-open:hover,
body.pilot-technique-ui .engineering-link-open:focus-visible{color:#eaf4ff;outline:2px solid rgba(45,131,247,.35);outline-offset:2px}
`;
  document.head.appendChild(style);
}

/*
 * LA LÉGENDE REPREND LES COULEURS QUE `interactive-map.js` DESSINE DÉJÀ.
 *
 * `drawAreasAndHotspots()` colore ses hotspots par type — bleu pour une salle, violet pour
 * une baie, vert ou rouge pour un équipement selon son état — sans qu'aucune légende ne le
 * dise à l'écran. Ces quatre teintes sont recopiées ici TELLES QUELLES (mêmes valeurs
 * hexadécimales) plutôt que choisies séparément : la légende cesse d'être vraie le jour où
 * ces deux jeux de couleurs divergent, donc les deux doivent rester le même jeu.
 */
const LEGENDE_CARTE = Object.freeze([
  { couleur: '#2d7dfc', texte: 'Salle' },
  { couleur: '#914bce', texte: 'Baie' },
  { couleur: '#16a085', texte: 'Équipement opérationnel' },
  { couleur: '#e74c3c', texte: 'Équipement en panne' }
]);

function decorateMap() {
  const modal = document.getElementById('map-modal');
  if (!modal || modal.classList.contains('map-restricted')) return;
  modal.classList.add('pilot-map-modal');
  if (!modal.querySelector('.pilot-map-label')) {
    const label = document.createElement('div');
    label.className = 'pilot-map-label';
    label.innerHTML = '<i class="fas fa-map-marked-alt" aria-hidden="true"></i><span>Carte interactive</span><small>· Pilote Technique</small>';
    modal.appendChild(label);
  }
  if (!modal.querySelector('.pilot-map-legend')) {
    const legende = document.createElement('div');
    legende.className = 'pilot-map-legend';
    legende.setAttribute('aria-label', 'Légende de la carte');
    legende.innerHTML = LEGENDE_CARTE.map(entree =>
      `<div class="pilot-map-legend-item"><span class="pilot-map-legend-dot" style="background:${entree.couleur}"></span><span>${entree.texte}</span></div>`
    ).join('');
    modal.appendChild(legende);
  }
}

function decorateShell() {
  ensureProceduresPilotStyles();
  ensureHeaderDecorations();
  decorateEquipmentPage();
  decorateMap();
}

if (active) {
  document.documentElement.classList.add('pilot-technique-ui');
  if (document.body) document.body.classList.add('pilot-technique-ui');

  const activateBody = () => {
    document.body?.classList.add('pilot-technique-ui');
    decorateShell();
    /*
     * `Auth.applyRoleTheme()` (auth.js) REMPLACE `document.body.className` en entier —
     * `theme-admin light-theme`, sans égard pour ce qui s'y trouvait déjà — à CHAQUE
     * connexion et à CHAQUE vérification de session, c'est-à-dire à peu près à chaque
     * chargement de page pour un compte déjà connecté. Mesuré au navigateur : la classe
     * `pilot-technique-ui` posée ci-dessus disparaissait quelques centaines de
     * millisecondes plus tard, une fois `applyRoleTheme()` exécuté — la totalité de
     * l'habillage retombait alors sur l'interface classique SANS AUCUNE ERREUR, donc sans
     * rien qui l'aurait signalé.
     *
     * L'observateur de mutations plus bas ne le voit jamais : il n'écoute que l'AJOUT ou
     * le RETRAIT d'ÉLÉMENTS (`childList`/`subtree`), pas le changement d'un ATTRIBUT sur
     * un élément déjà en place. Celui-ci est donc dédié, restreint au seul attribut
     * `class` du SEUL `<body>` — pas une boucle sur tout le document — et ne fait rien
     * d'autre que remettre la classe si `applyRoleTheme()` vient de l'effacer pendant que
     * la prévisualisation reste active.
     */
    if (document.body && !document.body.dataset.pilotClassGuard) {
      document.body.dataset.pilotClassGuard = '1';
      new MutationObserver(() => {
        if (active && !document.body.classList.contains('pilot-technique-ui')) {
          document.body.classList.add('pilot-technique-ui');
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateBody, { once: true });
  } else {
    activateBody();
  }

  const observer = new MutationObserver(() => decorateShell());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.PilotTechniquePreview = Object.freeze({
    active: true,
    disable: deactivatePreview,
    classicUrl: cleanPilotParam()
  });
}