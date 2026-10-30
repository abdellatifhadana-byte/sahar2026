/**
 * @file engineering-refs.js — le lien, dans les deux sens, entre un objet d'ingénierie et
 * les entités réelles qu'il désigne.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Deux contrats déjà en place désignent des entités par la MÊME forme, celle que
 * `normalizeEntityReference` produit — `{ type, id, label, … }` :
 *
 *   · une procédure de continuité (`continuity_procedure`) porte ses références dans
 *     `steps[].entityRefs` ;
 *   · un schéma technique (`technical_diagram`) porte les siennes dans `nodes[].entityRef`.
 *
 * Personne ne lisait ces références DANS L'AUTRE SENS. On pouvait ouvrir une procédure et
 * voir qu'elle parle de l'équipement X ; on ne pouvait pas ouvrir l'équipement X et savoir
 * quelles procédures et quels schémas le concernent. L'information était écrite, persistée,
 * validée côté serveur — et invisible là où le technicien la cherche.
 *
 * Ce module ne crée AUCUNE donnée. Il indexe ce qui est déjà écrit, et rien d'autre : une
 * référence dont la cible n'existe pas est rendue comme NON RÉSOLUE, jamais comme un lien
 * mort ni comme un objet inventé.
 *
 * Aucune dépendance au DOM ni à la base : les fonctions sont pures, donc éprouvables sans
 * navigateur (`tests/engineering-refs.test.js`).
 */

/**
 * Les cinq entités que le lot MVP sait ouvrir, plus le câble dont le magasin existe déjà.
 *
 * `ENTITY_REFERENCE_TYPES` (continuity-contract.js) en déclare quatorze. Les huit autres —
 * `port`, `component`, `signal-path`, `router`, `router-port`, `router-interface`,
 * `patch-point`, `service` — n'ont pas de magasin propre : elles vivent À L'INTÉRIEUR d'un
 * équipement ou d'un instantané de topologie. Les faire semblant d'être navigables
 * produirait précisément le bouton mort que ce lot s'interdit. Elles restent donc affichées,
 * avec leur type et leur libellé écrits, et signalées comme non navigables.
 */
export const NAVIGABLE_ENTITY_STORES = Object.freeze({
  room:Object.freeze({ store:'rooms', label:'Salle', icon:'fas fa-door-open' }),
  baie:Object.freeze({ store:'baies', label:'Baie', icon:'fas fa-server' }),
  equipment:Object.freeze({ store:'equipments', label:'Équipement', icon:'fas fa-microchip' }),
  wall:Object.freeze({ store:'walls', label:'Mur d’images', icon:'fas fa-th-large' }),
  screen:Object.freeze({ store:'screens', label:'Écran', icon:'fas fa-tv' }),
  cable:Object.freeze({ store:'cables', label:'Câble', icon:'fas fa-plug' })
});

/** Le libellé d'un type non navigable reste dit : l'utilisateur doit savoir ce qui est visé. */
export const NON_NAVIGABLE_ENTITY_LABELS = Object.freeze({
  component:'Composant', port:'Port', 'signal-path':'Chemin de signal', router:'Routeur',
  'router-port':'Port routeur', 'router-interface':'Interface routeur',
  'patch-point':'Point de brassage', service:'Service'
});

export const PROCEDURE_KIND = 'continuity_procedure';
export const DIAGRAM_KIND = 'technical_diagram';

const text = value => String(value ?? '').trim();
/** La clé d'index. `String()` des deux côtés : un id numérique et son écriture texte sont le même objet. */
export const refKey = (type, id) => `${text(type) || 'equipment'}:${String(id ?? '')}`;

/** Les références d'une procédure, à plat, dans l'ordre de ses étapes. */
export function procedureEntityRefs(procedure = {}) {
  const refs = [];
  for (const step of Array.isArray(procedure.steps) ? procedure.steps : []) {
    for (const ref of Array.isArray(step.entityRefs) ? step.entityRefs : []) {
      if (ref && ref.id !== null && ref.id !== undefined && ref.id !== '') refs.push(ref);
    }
  }
  return refs;
}

/** Les références d'un schéma, à plat. Un nœud sans `entityRef` est un libellé ou un cadre. */
export function diagramEntityRefs(diagram = {}) {
  const refs = [];
  for (const node of Array.isArray(diagram.nodes) ? diagram.nodes : []) {
    const ref = node?.entityRef;
    if (ref && ref.id !== null && ref.id !== undefined && ref.id !== '') refs.push(ref);
  }
  return refs;
}

/** Les références DÉDUPLIQUÉES, pour l'affichage : une étape qui répète l'équipement ne le répète pas à l'écran. */
export function uniqueRefs(refs = []) {
  const vus = new Set();
  const sortie = [];
  for (const ref of refs) {
    const cle = refKey(ref?.type, ref?.id);
    if (vus.has(cle)) continue;
    vus.add(cle);
    sortie.push(ref);
  }
  return sortie;
}

/**
 * L'index inverse : pour chaque entité citée, les procédures et les schémas qui la citent.
 *
 * Construit UNE fois par chargement plutôt qu'une recherche par fiche ouverte : la fiche 360
 * s'ouvre souvent, et parcourir toutes les procédures à chaque ouverture se paierait sur la
 * seule machine qui compte, celle du technicien en régie.
 */
export function indexEngineeringLinks(docs = []) {
  const procedures = new Map();
  const diagrams = new Map();
  const pousser = (index, cle, enregistrement) => {
    if (!index.has(cle)) index.set(cle, []);
    const liste = index.get(cle);
    if (!liste.some(item => String(item.id) === String(enregistrement.id))) liste.push(enregistrement);
  };

  for (const doc of Array.isArray(docs) ? docs : []) {
    if (doc?.kind === PROCEDURE_KIND) {
      for (const ref of uniqueRefs(procedureEntityRefs(doc))) pousser(procedures, refKey(ref.type, ref.id), doc);
    } else if (doc?.kind === DIAGRAM_KIND) {
      for (const ref of uniqueRefs(diagramEntityRefs(doc))) pousser(diagrams, refKey(ref.type, ref.id), doc);
    }
  }
  return { procedures, diagrams };
}

/** Ce qui cite cette entité, dans les deux familles. Jamais `undefined` : une liste vide est une réponse. */
export function linksForEntity(index, type, id) {
  const cle = refKey(type, id);
  return {
    procedures:index?.procedures?.get(cle) ? [...index.procedures.get(cle)] : [],
    diagrams:index?.diagrams?.get(cle) ? [...index.diagrams.get(cle)] : []
  };
}

/**
 * Ce qu'il faut savoir d'une référence pour l'AFFICHER honnêtement.
 *
 * `resolved` distingue trois états qu'il serait fautif de confondre :
 *   · navigable et trouvée  → on peut ouvrir la fiche ;
 *   · navigable et INTROUVABLE → la référence existe, sa cible non. On le dit ;
 *   · non navigable → le type n'a pas de fiche propre. On le dit aussi.
 */
export function describeRef(ref = {}, catalogs = {}) {
  const type = text(ref.type) || 'equipment';
  const id = ref.id ?? null;
  const navigable = NAVIGABLE_ENTITY_STORES[type] || null;
  const ecrit = text(ref.label);

  if (!navigable) {
    return {
      type, id, navigable:false, resolved:false, record:null,
      typeLabel:NON_NAVIGABLE_ENTITY_LABELS[type] || type,
      label:ecrit || `${NON_NAVIGABLE_ENTITY_LABELS[type] || type} ${id ?? ''}`.trim(),
      icon:'fas fa-link'
    };
  }

  const catalogue = catalogs[navigable.store];
  const record = catalogue instanceof Map
    ? (catalogue.get(String(id)) || null)
    : (Array.isArray(catalogue) ? catalogue.find(item => String(item?.id) === String(id)) || null : null);

  return {
    type, id, navigable:true, resolved:Boolean(record), record,
    store:navigable.store, typeLabel:navigable.label, icon:navigable.icon,
    // Le nom en base fait foi ; le libellé écrit dans la référence ne sert que si la cible a
    // disparu — sans quoi une entité renommée garderait son ancien nom dans chaque procédure.
    label:record ? (record.name || record.nom || ecrit || `#${id}`) : (ecrit || `#${id}`)
  };
}

/** Un index par magasin, prêt pour `describeRef`. */
export function buildCatalogs(collections = {}) {
  const catalogs = {};
  for (const [store, records] of Object.entries(collections)) {
    const index = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (record?.id !== undefined && record?.id !== null) index.set(String(record.id), record);
    }
    catalogs[store] = index;
  }
  return catalogs;
}

/**
 * La recherche porte sur ce qui est ÉCRIT, y compris le nom des entités citées.
 *
 * Chercher « Régie 2 » doit ramener la procédure qui cite la salle Régie 2, même si son
 * titre ne la nomme pas : c'est ainsi qu'on cherche une procédure en régie — par l'objet
 * qu'on a devant soi, pas par un intitulé qu'on ne connaît pas encore.
 */
export function procedureSearchText(procedure = {}, catalogs = {}) {
  const morceaux = [
    procedure.title, procedure.purpose, procedure.revision, procedure.status,
    procedure.fallbackSummary, procedure.rollbackSummary, procedure.escalation, procedure.notes
  ];
  for (const prerequis of Array.isArray(procedure.prerequisites) ? procedure.prerequisites : []) morceaux.push(prerequis);
  for (const check of Array.isArray(procedure.verificationChecks) ? procedure.verificationChecks : []) morceaux.push(check);
  for (const step of Array.isArray(procedure.steps) ? procedure.steps : []) {
    morceaux.push(step?.title, step?.instruction, step?.expectedResult, step?.type);
  }
  for (const ref of uniqueRefs(procedureEntityRefs(procedure))) {
    const decrit = describeRef(ref, catalogs);
    morceaux.push(decrit.label, decrit.typeLabel);
  }
  return morceaux.filter(Boolean).join(' ').toLowerCase();
}

/** Filtre non destructif : une requête vide rend la liste entière, jamais une liste vide. */
export function filterProcedures(procedures = [], query = '', catalogs = {}) {
  const besoin = text(query).toLowerCase();
  if (!besoin) return [...procedures];
  const termes = besoin.split(/\s+/).filter(Boolean);
  return procedures.filter(procedure => {
    const foin = procedureSearchText(procedure, catalogs);
    return termes.every(terme => foin.includes(terme));
  });
}

export default {
  NAVIGABLE_ENTITY_STORES, NON_NAVIGABLE_ENTITY_LABELS, PROCEDURE_KIND, DIAGRAM_KIND,
  refKey, procedureEntityRefs, diagramEntityRefs, uniqueRefs, indexEngineeringLinks,
  linksForEntity, describeRef, buildCatalogs, procedureSearchText, filterProcedures
};
