export const LOCATION_CONTRACT_VERSION = 1;

/**
 * @file location-contract.js — ville, région, département.
 *
 * CE QUI MANQUAIT
 * ---------------
 * La plateforme s'arrêtait à la salle. Au-dessus, il n'y avait qu'un champ `location`
 * libre sur chaque salle : du texte, sans structure, sans parent, impossible à parcourir
 * ni à totaliser. Deux salles du même bâtiment n'avaient aucun lien entre elles, et rien
 * ne permettait de dire « tout ce qui est à Casablanca ».
 *
 *     Ville → Région → Département → Salle → Baie → Équipement
 *
 * UN SEUL MAGASIN, PAS TROIS
 * --------------------------
 * Les trois niveaux se comportent exactement pareil : un nom, un parent, des enfants, et
 * une zone dessinable sur le plan. Trois magasins auraient triplé la surface — trois
 * entrées de synchronisation, trois jeux de gardes, trois chemins de création — pour
 * aucune différence de comportement. Le niveau est donc une PROPRIÉTÉ (`kind`), pas un
 * magasin, ce qui rend l'échelle extensible : ajouter « bâtiment » ou « étage » plus tard
 * sera une valeur de plus, pas une migration.
 *
 * DESSINABLE SUR LE PLAN
 * ----------------------
 * Une localisation porte une `shape` comme une salle : l'administrateur peut cerner une
 * ville ou un département sur le plan avec les mêmes gestes (rectangle, cercle, forme
 * libre) — voir map-shape-contract.js.
 */

export const LOCATION_KINDS = Object.freeze({
  CITY: 'city',
  REGION: 'region',
  DEPARTMENT: 'department'
});

/** Du plus large au plus fin. L'index EST le niveau. */
export const LOCATION_ORDER = Object.freeze([
  LOCATION_KINDS.CITY,
  LOCATION_KINDS.REGION,
  LOCATION_KINDS.DEPARTMENT
]);

export const LOCATION_LABELS = Object.freeze({
  [LOCATION_KINDS.CITY]: 'Ville',
  [LOCATION_KINDS.REGION]: 'Région',
  [LOCATION_KINDS.DEPARTMENT]: 'Département'
});

/** Pluriels, pour les titres de listes. */
export const LOCATION_LABELS_PLURAL = Object.freeze({
  [LOCATION_KINDS.CITY]: 'Villes',
  [LOCATION_KINDS.REGION]: 'Régions',
  [LOCATION_KINDS.DEPARTMENT]: 'Départements'
});

const ALIASES = Object.freeze({
  city: LOCATION_KINDS.CITY, ville: LOCATION_KINDS.CITY,
  region: LOCATION_KINDS.REGION, 'région': LOCATION_KINDS.REGION, zone: LOCATION_KINDS.REGION,
  department: LOCATION_KINDS.DEPARTMENT, 'département': LOCATION_KINDS.DEPARTMENT,
  departement: LOCATION_KINDS.DEPARTMENT, service: LOCATION_KINDS.DEPARTMENT
});

const texte = value => String(value ?? '').trim();

export function normalizeLocationKind(kind) {
  return ALIASES[texte(kind).toLowerCase()] || LOCATION_KINDS.CITY;
}

/**
 * Un `kind` ABSENT devient « city » par défaut — c'est voulu, pour un enregistrement
 * ancien qui n'a jamais porté ce champ. Un `kind` PRÉSENT mais non reconnu ("floor",
 * "batiment", une faute de frappe) ne doit PAS profiter du même repli : le confondre
 * avec une ville affirmerait quelque chose que personne n'a dit. Ce test isole les deux
 * cas — `normalizeLocationKind` seul ne les distingue pas.
 */
export function isRecognizedLocationKind(kind) {
  const valeur = texte(kind).toLowerCase();
  return valeur === '' || Object.prototype.hasOwnProperty.call(ALIASES, valeur);
}

export function locationLevel(kind) {
  return LOCATION_ORDER.indexOf(normalizeLocationKind(kind));
}

export function locationLabel(kind) {
  return LOCATION_LABELS[normalizeLocationKind(kind)] || 'Localisation';
}

/** Niveau attendu d'un enfant. `null` quand le niveau est déjà le plus fin. */
export function childKind(kind) {
  return LOCATION_ORDER[locationLevel(kind) + 1] || null;
}

/** Niveau attendu d'un parent. `null` pour une ville, qui est la racine. */
export function parentKind(kind) {
  const niveau = locationLevel(kind);
  return niveau > 0 ? LOCATION_ORDER[niveau - 1] : null;
}

/**
 * Met un enregistrement en règle.
 *
 * Une ville n'a pas de parent : lui en imposer un créerait une racine flottante,
 * invisible dans l'arbre. Un niveau inférieur SANS parent est en revanche accepté et
 * marqué `orphan` — c'est un état réel, celui d'un département créé avant sa région, et
 * le masquer le rendrait introuvable.
 */
export function normalizeLocation(source) {
  if (!source || typeof source !== 'object') return null;
  const nom = texte(source.name ?? source.nom);
  if (!nom) return null;
  const kind = normalizeLocationKind(source.kind);
  const parentId = kind === LOCATION_KINDS.CITY ? null : (texte(source.parentId) || null);
  return {
    ...source,
    id: source.id,
    kind,
    name: nom,
    parentId,
    code: texte(source.code) || null,
    description: texte(source.description) || null,
    orphan: kind !== LOCATION_KINDS.CITY && !parentId
  };
}

/** Un parent doit être du niveau immédiatement supérieur — jamais deux crans au-dessus. */
export function canParent(parent, child) {
  const enfant = normalizeLocationKind(child?.kind ?? child);
  const attendu = parentKind(enfant);
  if (!attendu) return false;
  return normalizeLocationKind(parent?.kind ?? parent) === attendu;
}

/**
 * Chemin depuis la racine jusqu'à la localisation, incluse.
 *
 * Une boucle dans les parents — que rien n'empêche à l'écriture — ferait tourner cette
 * fonction indéfiniment et figerait l'interface. Les identifiants déjà vus arrêtent le
 * parcours, et la boucle devient un chemin tronqué plutôt qu'un écran gelé.
 */
export function locationPath(locationId, locations = []) {
  const index = new Map(locations.filter(Boolean).map(item => [String(item.id), item]));
  const chemin = [];
  const vus = new Set();
  let courant = index.get(String(locationId));
  while (courant && !vus.has(String(courant.id))) {
    vus.add(String(courant.id));
    chemin.unshift(courant);
    courant = courant.parentId ? index.get(String(courant.parentId)) : null;
  }
  return chemin;
}

/** Fil d'Ariane lisible : « Casablanca › Siège › Régie ». */
export function locationBreadcrumb(locationId, locations = [], { separator = ' › ' } = {}) {
  return locationPath(locationId, locations).map(item => item.name).join(separator);
}

/** Descendants directs d'une localisation ; racines si `parentId` est nul. */
export function locationChildren(parentId, locations = []) {
  const cible = parentId === null || parentId === undefined ? null : String(parentId);
  return locations.filter(item => {
    const parent = item?.parentId === null || item?.parentId === undefined ? null : String(item.parentId);
    return parent === cible;
  });
}

/**
 * Tous les descendants, à toute profondeur. Sert à répondre « qu'y a-t-il à Casablanca ? »
 * et à refuser une suppression qui emporterait un sous-arbre.
 */
export function locationDescendants(locationId, locations = []) {
  const resultat = [];
  const file = [String(locationId)];
  const vus = new Set(file);
  while (file.length) {
    for (const enfant of locationChildren(file.shift(), locations)) {
      const cle = String(enfant.id);
      if (vus.has(cle)) continue;
      vus.add(cle);
      resultat.push(enfant);
      file.push(cle);
    }
  }
  return resultat;
}

/** Arbre complet, pour l'affichage. */
export function locationTree(locations = []) {
  const construire = parentId => locationChildren(parentId, locations)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'))
    .map(item => ({ ...item, children: construire(item.id) }));
  return construire(null);
}

/**
 * Une localisation est-elle supprimable ?
 *
 * Supprimer une ville qui porte des régions, ou un département qui porte des salles,
 * laisserait des enregistrements rattachés à un identifiant qui n'existe plus — le genre
 * de rupture qui ne se voit qu'une fois les données perdues.
 */
export function locationDeletionBlockers(locationId, { locations = [], rooms = [] } = {}) {
  const cle = String(locationId);
  const enfants = locationChildren(cle, locations);
  const salles = rooms.filter(salle => String(salle?.locationId ?? '') === cle);
  const empechements = [];
  if (enfants.length) {
    empechements.push(`${enfants.length} localisation(s) rattachée(s)`);
  }
  if (salles.length) empechements.push(`${salles.length} salle(s) rattachée(s)`);
  return empechements;
}

/** Localisations pouvant accueillir un enfant du niveau demandé. */
export function eligibleParents(kind, locations = []) {
  const attendu = parentKind(kind);
  if (!attendu) return [];
  return locations.filter(item => normalizeLocationKind(item?.kind) === attendu);
}

/**
 * LE GRAPHE EST-IL COHÉRENT — AVANT TOUTE ÉCRITURE ?
 *
 * Écrit pour la restauration de sauvegarde (P0-C), mais général : rien ici ne dépend de
 * `backup-service.js`. Une seule question posée à `records` (le lot à écrire), avec
 * `existingLocations` (ce qui est DÉJÀ en base) comme univers connu supplémentaire — la
 * restauration est additive, un parent absent du lot peut légitimement déjà exister.
 *
 * CE QUI EST REFUSÉ (le lot entier, jamais un tri silencieux) :
 *   - un identifiant dupliqué DANS LE LOT — deux fiches, un seul id, laquelle est vraie ?
 *   - une fiche qui se déclare son propre parent ;
 *   - un cycle : A → B → … → A, entièrement observable depuis le lot ;
 *   - un parent d'un niveau qui n'est pas immédiatement supérieur (`canParent`), SI ce
 *     parent est identifiable (dans le lot ou déjà en base) ;
 *   - un `kind` PRÉSENT mais non reconnu (voir `isRecognizedLocationKind`) — jamais
 *     rabattu sur « city » en silence ;
 *   - une fiche sans nom, qu'`normalizeLocation` rejette déjà (`null`).
 *
 *   - un `parentId` NON NUL qui ne correspond à RIEN, ni dans le lot ni en base
 *     (`UNKNOWN_PARENT`) — voir ci-dessous pourquoi ce n'est PAS l'état `orphan`.
 *
 * CE QUI N'EST PAS REFUSÉ, ET C'EST DÉLIBÉRÉ :
 *   - un `parentId` NUL sur une région ou un département. C'est exactement l'état que
 *     `normalizeLocation` nomme `orphan` (`kind !== city && !parentId`), celui qu'écrit
 *     l'option « — non rattaché — » de `locations-section.js`, et le SEUL chemin par
 *     lequel l'écran crée une localisation sans parent. `locationTree()` construit depuis
 *     `construire(null)` : une telle fiche est une RACINE de l'arbre, donc visible.
 *
 * POURQUOI UN `parentId` INCONNU EST UNE CORRUPTION, ET NON UN ORPHELIN :
 *   `normalizeLocation` calcule `orphan: kind !== city && !parentId`. Avec `parentId = 999`
 *   pointant vers rien, `!999` est faux : la fiche vaut `orphan: false`. Elle n'est donc
 *   pas l'état orphelin — elle prétend avoir un parent qui n'existe pas. `locationTree()`
 *   ne la place ni en racine (son `parentId` n'est pas nul) ni sous un parent (il est
 *   introuvable) : elle DISPARAÎT de l'arbre. `locations-section.js` la rattrape alors
 *   dans « Rattachement manquant » (`detachees` = tout ce qui n'est pas dans l'arbre,
 *   « n'ont plus de parent ») — un écran de RÉCUPÉRATION pour un parent supprimé après
 *   coup, pas une saisie que l'interface autorise. Importer une référence pendante
 *   fabriquerait cette corruption au lieu de la réparer.
 */
export function validateLocationHierarchy(records = [], { existingLocations = [] } = {}) {
  const erreurs = [];
  const connu = new Map(); // id (chaîne) -> { kind } — lot validé + existant en base
  for (const item of existingLocations) {
    const id = item?.id;
    if (id === undefined || id === null) continue;
    connu.set(String(id), { kind: normalizeLocationKind(item?.kind) });
  }

  const lot = new Map(); // id (chaîne) -> localisation normalisée, LOT SEUL
  const vusDansLeLot = new Set();

  for (const source of Array.isArray(records) ? records : []) {
    const id = source?.id;
    if (id === undefined || id === null || texte(id) === '') {
      erreurs.push({ code: 'MISSING_ID', message: 'localisation sans identifiant' });
      continue;
    }
    const cle = String(id);
    if (vusDansLeLot.has(cle)) {
      erreurs.push({ code: 'DUPLICATE_ID', id: cle, message: `identifiant dupliqué dans le lot : ${cle}` });
      continue;
    }
    vusDansLeLot.add(cle);

    if (!isRecognizedLocationKind(source?.kind)) {
      erreurs.push({ code: 'INVALID_KIND', id: cle, message: `kind non reconnu pour ${cle} : « ${texte(source?.kind)} »` });
      continue;
    }
    const normalisee = normalizeLocation(source);
    if (!normalisee) {
      erreurs.push({ code: 'INVALID_RECORD', id: cle, message: `enregistrement invalide (nom manquant) : ${cle}` });
      continue;
    }
    if (String(normalisee.parentId ?? '') === cle) {
      erreurs.push({ code: 'SELF_PARENT', id: cle, message: `une localisation ne peut pas être son propre parent : ${cle}` });
      continue;
    }
    lot.set(cle, normalisee);
    connu.set(cle, { kind: normalisee.kind });
  }

  // Le niveau du parent, SI on le connaît — jamais deux crans, jamais le mauvais sens.
  for (const [cle, loc] of lot) {
    // `parentId` nul = orphelin déclaré (« — non rattaché — ») ou ville racine : accepté,
    // c'est l'état `orphan` du contrat, et `locationTree()` en fait une racine visible.
    if (loc.parentId === null || loc.parentId === undefined) continue;
    const parentCle = String(loc.parentId);
    const parent = lot.get(parentCle) || connu.get(parentCle);
    if (!parent) {
      // Référence pendante : ni dans le lot, ni en base. La fiche se dit rattachée à un
      // identifiant qui n'existe pas — elle vaut `orphan: false` et tombe hors de l'arbre.
      // On refuse d'importer la corruption ; on n'invente pas de parent et on ne rabat pas
      // silencieusement le `parentId` sur `null`.
      erreurs.push({
        code: 'UNKNOWN_PARENT', id: cle, parentId: parentCle,
        message: `parent introuvable pour ${cle} : ${parentCle} n'existe ni dans le lot ni en base`
      });
      continue;
    }
    if (!canParent(parent, loc)) {
      erreurs.push({
        code: 'INVALID_PARENT_KIND', id: cle,
        message: `« ${locationLabel(parent.kind)} » ne peut pas être le parent d'« ${locationLabel(loc.kind)} » (${cle})`
      });
    }
  }

  // Cycle : ne remonte qu'à travers le LOT — un parent déjà en base ferme la chaîne sans
  // pouvoir participer à un cycle qu'on n'a aucun moyen d'observer depuis ce lot.
  for (const depart of lot.keys()) {
    const vus = new Set();
    let courant = depart;
    while (courant && lot.has(courant)) {
      if (vus.has(courant)) {
        erreurs.push({ code: 'CYCLE', id: depart, message: `cycle détecté impliquant ${depart}` });
        break;
      }
      vus.add(courant);
      const suivant = lot.get(courant).parentId;
      courant = suivant === null || suivant === undefined ? null : String(suivant);
    }
  }

  return Object.freeze({ ok: erreurs.length === 0, errors: Object.freeze(erreurs) });
}

export default Object.freeze({
  version: LOCATION_CONTRACT_VERSION,
  LOCATION_KINDS, LOCATION_ORDER, LOCATION_LABELS, LOCATION_LABELS_PLURAL,
  normalizeLocationKind, isRecognizedLocationKind, locationLevel, locationLabel, childKind, parentKind,
  normalizeLocation, canParent, locationPath, locationBreadcrumb,
  locationChildren, locationDescendants, locationTree,
  locationDeletionBlockers, eligibleParents, validateLocationHierarchy
});
