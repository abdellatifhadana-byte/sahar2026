/**
 * @file tests/helpers/mini-dom.js — un document que l'on peut réellement manipuler.
 *
 * POURQUOI CELUI-CI EXISTE
 * ------------------------
 * Les épreuves d'interface de cette plateforme se contentaient souvent de LIRE le code
 * source et d'y chercher un motif. Une règle qu'une épreuve ne peut pas EXÉCUTER n'est pas
 * une règle vérifiée : elle survit à un module qu'on n'appelle plus, à un écouteur qu'on
 * n'installe jamais, à un bouton qui n'atteint plus personne. C'est précisément ce qui
 * avait laissé passer `platform-entity-diverged` — émis, jamais consommé, jamais vu.
 *
 * Ce document minimal n'imite pas un navigateur : il en implémente la partie dont les
 * modules de la plateforme se servent, et il l'implémente pour de vrai.
 *
 *   · un arbre de nœuds, avec parenté, insertion et retrait ;
 *   · `querySelector` / `matches` / `closest` sur un sous-ensemble utile de sélecteurs :
 *     balise, `#identifiant`, `.classe`, `[attribut]`, `[attribut="valeur"]`, et la
 *     combinaison par descendance ;
 *   · des événements qui CAPTURENT puis REMONTENT, comme dans un navigateur — sans quoi un
 *     écouteur délégué posé sur `document` ne serait jamais atteint ;
 *   · un `MutationObserver` qui livre ses enregistrements dans une micro-tâche, comme le
 *     vrai : un module qui réagit à l'ouverture d'une fenêtre est ainsi éprouvé dans les
 *     mêmes conditions de temps.
 *
 * Ce qu'il n'a pas : mise en page, styles calculés réels, focus. Aucune épreuve ne doit en
 * dépendre — et si l'une venait à en avoir besoin, c'est un navigateur qu'il lui faudrait,
 * pas un mensonge de plus dans ce fichier.
 */

const MOTIF_COMPOSANT = /([#.][\w-]+)|(\[[^\]]*\])|(\*)|([a-zA-Z][\w-]*)/g;

function analyserComposant(texte) {
  const composant = { balise: null, id: null, classes: [], attributs: [] };
  for (const [piece] of texte.matchAll(MOTIF_COMPOSANT)) {
    if (piece === '*') continue;
    if (piece.startsWith('#')) composant.id = piece.slice(1);
    else if (piece.startsWith('.')) composant.classes.push(piece.slice(1));
    else if (piece.startsWith('[')) {
      const interieur = piece.slice(1, -1);
      const separation = interieur.indexOf('=');
      if (separation === -1) composant.attributs.push({ nom: interieur.trim(), valeur: null });
      else composant.attributs.push({
        nom: interieur.slice(0, separation).trim(),
        valeur: interieur.slice(separation + 1).trim().replace(/^["']|["']$/g, '')
      });
    } else composant.balise = piece.toLowerCase();
  }
  return composant;
}

/** `a b, c` devient deux chemins de composants, à lire de gauche à droite. */
const analyserSelecteur = selecteur => String(selecteur)
  .split(',')
  .map(part => part.trim())
  .filter(Boolean)
  .map(part => part.split(/\s+/).map(analyserComposant));

function correspondComposant(element, composant) {
  if (composant.balise && element.tagName.toLowerCase() !== composant.balise) return false;
  if (composant.id && element.getAttribute('id') !== composant.id) return false;
  if (composant.classes.some(classe => !element.classList.contains(classe))) return false;
  return composant.attributs.every(({ nom, valeur }) => {
    const present = element.getAttribute(nom);
    if (present === null) return false;
    return valeur === null || present === valeur;
  });
}

function correspondChemin(element, chemin) {
  if (!correspondComposant(element, chemin.at(-1))) return false;
  let courant = element.parentNode;
  for (let index = chemin.length - 2; index >= 0; index -= 1) {
    while (courant && !(courant.nodeType === 1 && correspondComposant(courant, chemin[index]))) courant = courant.parentNode;
    if (!courant) return false;
    courant = courant.parentNode;
  }
  return true;
}

/* ------------------------------- Observation ------------------------------- */

const observateurs = new Set();

function signaler(cible, ajoutes, retires) {
  for (const observateur of observateurs) {
    if (!observateur.racines.some(racine => racine === cible || contient(racine, cible))) continue;
    observateur.enregistrements.push({ type: 'childList', target: cible, addedNodes: ajoutes, removedNodes: retires });
    if (observateur.enregistrements.length === 1) {
      queueMicrotask(() => {
        const lot = observateur.enregistrements.splice(0);
        if (lot.length) observateur.rappel(lot, observateur.instance);
      });
    }
  }
}

const contient = (racine, noeud) => {
  for (let courant = noeud; courant; courant = courant.parentNode) if (courant === racine) return true;
  return false;
};

/* ---------------------------------- Nœuds ---------------------------------- */

class Noeud {
  constructor(type) {
    this.nodeType = type;
    this.parentNode = null;
    this.childNodes = [];
    this.ecouteurs = new Map();
  }

  get children() { return this.childNodes.filter(enfant => enfant.nodeType === 1); }

  appendChild(enfant) {
    enfant.parentNode?.removeChild(enfant);
    enfant.parentNode = this;
    this.childNodes.push(enfant);
    signaler(this, [enfant], []);
    return enfant;
  }

  insertBefore(enfant, reference) {
    const index = this.childNodes.indexOf(reference);
    if (index === -1) return this.appendChild(enfant);
    enfant.parentNode?.removeChild(enfant);
    enfant.parentNode = this;
    this.childNodes.splice(index, 0, enfant);
    signaler(this, [enfant], []);
    return enfant;
  }

  removeChild(enfant) {
    const index = this.childNodes.indexOf(enfant);
    if (index === -1) return enfant;
    this.childNodes.splice(index, 1);
    enfant.parentNode = null;
    signaler(this, [], [enfant]);
    return enfant;
  }

  remove() { this.parentNode?.removeChild(this); }

  addEventListener(type, fonction, options) {
    const capture = options === true || options?.capture === true;
    if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, []);
    this.ecouteurs.get(type).push({ fonction, capture });
  }

  removeEventListener(type, fonction) {
    const liste = this.ecouteurs.get(type) || [];
    const index = liste.findIndex(entree => entree.fonction === fonction);
    if (index !== -1) liste.splice(index, 1);
  }

  /** Capture de la racine vers la cible, puis remontée — l'ordre d'un vrai navigateur. */
  dispatchEvent(evenement) {
    evenement.target = evenement.target || this;
    const chemin = [];
    for (let courant = this; courant; courant = courant.parentNode) chemin.push(courant);
    if (chemin.at(-1) !== globalThis.document) chemin.push(globalThis.document);

    let arrete = false;
    evenement.stopPropagation = () => { arrete = true; };
    evenement.stopImmediatePropagation = () => { arrete = true; };
    evenement.preventDefault = () => { evenement.defaultPrevented = true; };

    const appeler = (noeud, capture) => {
      for (const { fonction, capture: enCapture } of [...(noeud.ecouteurs.get(evenement.type) || [])]) {
        if (enCapture !== capture) continue;
        evenement.currentTarget = noeud;
        fonction.call(noeud, evenement);
        if (arrete) return;
      }
    };

    for (let index = chemin.length - 1; index >= 0 && !arrete; index -= 1) appeler(chemin[index], true);
    if (evenement.bubbles !== false) for (let index = 0; index < chemin.length && !arrete; index += 1) appeler(chemin[index], false);
    else if (!arrete) appeler(chemin[0], false);
    return !evenement.defaultPrevented;
  }
}

class Texte extends Noeud {
  constructor(donnee) { super(3); this.data = String(donnee); }
  get textContent() { return this.data; }
  set textContent(valeur) { this.data = String(valeur); }
}

class Element extends Noeud {
  constructor(balise) {
    super(1);
    this.tagName = String(balise).toUpperCase();
    this.attributs = new Map();
    const element = this;
    this.dataset = new Proxy({}, {
      get: (_, nom) => element.attributs.get(`data-${enTiret(String(nom))}`),
      set: (_, nom, valeur) => { element.setAttribute(`data-${enTiret(String(nom))}`, valeur); return true; },
      deleteProperty: (_, nom) => { element.attributs.delete(`data-${enTiret(String(nom))}`); return true; },
      has: (_, nom) => element.attributs.has(`data-${enTiret(String(nom))}`)
    });
    this.classList = {
      add: (...noms) => element.setAttribute('class', [...new Set([...element.classes(), ...noms])].join(' ')),
      remove: (...noms) => element.setAttribute('class', element.classes().filter(nom => !noms.includes(nom)).join(' ')),
      contains: nom => element.classes().includes(nom),
      toggle: nom => (element.classes().includes(nom) ? element.classList.remove(nom) : element.classList.add(nom))
    };
    this.style = {};
  }

  classes() { return String(this.attributs.get('class') || '').split(/\s+/).filter(Boolean); }

  get className() { return this.attributs.get('class') || ''; }
  set className(valeur) { this.setAttribute('class', valeur); }
  get id() { return this.attributs.get('id') || ''; }
  set id(valeur) { this.setAttribute('id', valeur); }
  get hidden() { return this.attributs.has('hidden'); }
  set hidden(valeur) { if (valeur) this.setAttribute('hidden', ''); else this.attributs.delete('hidden'); }
  get disabled() { return this.attributs.get('disabled') === true || this.attributs.has('disabled'); }
  set disabled(valeur) { if (valeur) this.setAttribute('disabled', 'true'); else this.attributs.delete('disabled'); }
  get type() { return this.attributs.get('type') || ''; }
  set type(valeur) { this.setAttribute('type', valeur); }

  setAttribute(nom, valeur) { this.attributs.set(nom, String(valeur)); }
  getAttribute(nom) { return this.attributs.has(nom) ? this.attributs.get(nom) : null; }
  hasAttribute(nom) { return this.attributs.has(nom); }
  removeAttribute(nom) { this.attributs.delete(nom); }

  get textContent() { return this.childNodes.map(enfant => enfant.textContent).join(''); }
  set textContent(valeur) {
    for (const enfant of [...this.childNodes]) this.removeChild(enfant);
    if (valeur !== '' && valeur !== null && valeur !== undefined) this.appendChild(new Texte(valeur));
  }

  append(...noeuds) { for (const noeud of noeuds) this.appendChild(noeud); }

  matches(selecteur) { return analyserSelecteur(selecteur).some(chemin => correspondChemin(this, chemin)); }

  closest(selecteur) {
    for (let courant = this; courant; courant = courant.parentNode) {
      if (courant.nodeType === 1 && courant.matches(selecteur)) return courant;
    }
    return null;
  }

  querySelector(selecteur) { return this.querySelectorAll(selecteur)[0] || null; }

  querySelectorAll(selecteur) {
    const chemins = analyserSelecteur(selecteur);
    const trouves = [];
    const parcourir = noeud => {
      for (const enfant of noeud.childNodes) {
        if (enfant.nodeType !== 1) continue;
        if (chemins.some(chemin => correspondChemin(enfant, chemin))) trouves.push(enfant);
        parcourir(enfant);
      }
    };
    parcourir(this);
    return trouves;
  }

  /*
   * VISIBILITÉ — approximation assumée, et suffisante pour ce qu'on en demande.
   *
   * Un vrai navigateur calcule la mise en page ; ici on lit ce que la fenêtre a écrit dans
   * son propre style, plus l'héritage du `display:none` d'un ancêtre. C'est exactement ce
   * qui distingue une fenêtre d'édition MONTÉE ET CACHÉE d'une fenêtre RÉELLEMENT OUVERTE
   * — la distinction que `hasBlockingEditor` confondait. Aucune épreuve ne doit demander
   * plus que cela à ce document : la largeur, le chevauchement ou le défilement exigeraient
   * un navigateur.
   */
  estAffiche() {
    for (let courant = this; courant && courant.nodeType === 1; courant = courant.parentNode) {
      if (courant.style?.display === 'none' || courant.style?.visibility === 'hidden') return false;
      const enLigne = String(courant.getAttribute('style') || '');
      if (/display\s*:\s*none/.test(enLigne) || /visibility\s*:\s*hidden/.test(enLigne)) return false;
    }
    return true;
  }

  getClientRects() { return this.estAffiche() ? [{ width: 100, height: 100 }] : []; }
  focus() {}
  click() { this.dispatchEvent(new globalThis.Event('click', { bubbles: true })); }
}

const enTiret = nom => nom.replace(/[A-Z]/g, lettre => `-${lettre.toLowerCase()}`);

/* ------------------------------- Installation ------------------------------- */

/**
 * Installe un document neuf dans les globales. Rend de quoi l'inspecter et le démonter :
 * chaque épreuve part d'un document vierge, sinon elle mesure le résidu de la précédente.
 */
export function installerDom() {
  const document_ = new Noeud(9);
  document_.nodeType = 9;
  const racine = new Element('html');
  const corps = new Element('body');
  const tete = new Element('head');
  document_.appendChild(racine);
  racine.appendChild(tete);
  racine.appendChild(corps);

  document_.documentElement = racine;
  document_.body = corps;
  document_.head = tete;
  document_.visibilityState = 'visible';
  document_.createElement = balise => new Element(balise);
  document_.createTextNode = donnee => new Texte(donnee);
  document_.querySelector = selecteur => racine.querySelector(selecteur) || (racine.matches(selecteur) ? racine : null);
  document_.querySelectorAll = selecteur => racine.querySelectorAll(selecteur);
  document_.getElementById = identifiant => racine.querySelector(`#${identifiant}`);

  class EvenementLocal {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = init.bubbles !== false;
      this.detail = init.detail;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
    }
  }

  const fenetre = new Noeud(0);
  fenetre.document = document_;

  class ObservateurLocal {
    constructor(rappel) { this.rappel = rappel; this.racines = []; this.enregistrements = []; this.instance = this; }
    observe(racine) { this.racines.push(racine); observateurs.add(this); }
    disconnect() { observateurs.delete(this); }
    takeRecords() { return this.enregistrements.splice(0); }
  }

  globalThis.document = document_;
  globalThis.window = fenetre;
  globalThis.Event = EvenementLocal;
  globalThis.CustomEvent = EvenementLocal;
  globalThis.MutationObserver = ObservateurLocal;
  globalThis.getComputedStyle = element => {
    const enLigne = String(element?.getAttribute?.('style') || '');
    const cache = element?.style?.display === 'none' || /display\s*:\s*none/.test(enLigne);
    return {
      display: cache ? 'none' : (element?.style?.display || 'flex'),
      visibility: element?.style?.visibility || (/visibility\s*:\s*hidden/.test(enLigne) ? 'hidden' : 'visible')
    };
  };

  return {
    document: document_,
    window: fenetre,
    /** Laisse passer les micro-tâches : c'est là que le `MutationObserver` livre son lot. */
    respirer: async (tours = 3) => { for (let index = 0; index < tours; index += 1) await Promise.resolve(); },
    demonter: () => { observateurs.clear(); }
  };
}

export { Element, Texte, Noeud };
