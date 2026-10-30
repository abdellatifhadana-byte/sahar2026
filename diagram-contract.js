import { normalizeEntityReference } from './continuity-contract.js';

export const DIAGRAM_RECORD_KIND = 'technical_diagram';
export const DIAGRAM_TYPES = Object.freeze([
  'physical-plan', 'room-layout', 'rack-elevation', 'chassis-layout',
  'signal-synoptic', 'network-topology', 'router-matrix',
  'power-sync-control', 'wall-layout'
]);
export const DIAGRAM_STATUSES = Object.freeze(['draft', 'documented', 'validated', 'retired']);
export const DIAGRAM_NODE_TYPES = Object.freeze(['entity', 'boundary', 'label', 'port-anchor', 'image-marker', 'off-page-reference']);
export const DIAGRAM_EDGE_TYPES = Object.freeze([
  'physical-cable', 'logical-signal', 'contains', 'control', 'power',
  'sync', 'monitoring', 'primary-relation', 'backup-relation', 'dependency'
]);
export const DIAGRAM_RELATION_KINDS = Object.freeze([
  'topology_crosspoint', 'topology_rv_link', 'topology_signal_path',
  'continuity_protection_group'
]);

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const safeInternalImageReference = value => {
  const reference = String(value || '').trim();
  if (!reference) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(reference)
    && !reference.startsWith('//')
    && !reference.split(/[?#]/)[0].split('/').includes('..')
    && !/[\u0000-\u001f"'\\]/.test(reference);
};
const clamp = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function normalizeDiagramNode(source = {}, index = 0) {
  const type = source.type == null || source.type === '' ? 'entity' : String(source.type);
  return {
    ...source,
    id:source.id || `node-${index + 1}`,
    type,
    layerId:source.layerId || 'main',
    label:clean(source.label, 240),
    entityRef:source.entityRef ? normalizeEntityReference(source.entityRef) : null,
    anchorPortId:source.anchorPortId ?? null,
    referenceText:clean(source.referenceText, 300),
    targetDiagramId:source.targetDiagramId ?? null,
    x:clamp(source.x, 0, 100, 0),
    y:clamp(source.y, 0, 100, 0),
    width:clamp(source.width, 0.25, 100, type === 'boundary' ? 30 : 10),
    height:clamp(source.height, 0.25, 100, type === 'boundary' ? 20 : 8),
    rotation:clamp(source.rotation, -360, 360, 0),
    zIndex:Math.round(clamp(source.zIndex, -1000, 1000, index)),
    locked:source.locked === true,
    style:{
      color:clean(source.style?.color, 30),
      backgroundColor:clean(source.style?.backgroundColor, 30),
      borderColor:clean(source.style?.borderColor, 30),
      icon:clean(source.style?.icon, 80)
    }
  };
}

// Les libellés d'entité du studio arrivent préfixés du type : « Équipement · VTR-1 ».
const withoutTypePrefix = value => String(value ?? '').replace(/^[^·]+·\s+/, '');

/**
 * Libellé à afficher pour un nœud de schéma.
 *
 * Le studio propose « Laisser vide pour reprendre le nom officiel », mais matérialisait
 * ce nom dans `node.label` au moment du dessin. Renommer ensuite la salle, la baie ou
 * l'équipement laissait le schéma afficher l'ancien nom indéfiniment, sans que rien ne
 * signale la divergence — deux sources de vérité pour la même entité.
 *
 * Un libellé n'est tenu pour un choix de l'auteur que s'il diffère réellement du nom
 * officiel capturé dans `entityRef.label`, préfixe de type retiré. Sinon il est traité
 * comme l'instantané qu'il est, et le nom vivant le remplace.
 *
 * Repli sur le libellé stocké quand l'entité n'est pas résolvable : entité supprimée, ou
 * nœud caviardé par le serveur en « Dépendance protégée » — deux cas où l'instantané est
 * la seule information disponible et doit rester affichée.
 */
export function diagramNodeDisplayLabel(node = {}, liveEntityLabel = '') {
  const snapshot = clean(node?.entityRef?.label, 240);
  const stored = clean(node?.label, 240);
  const live = withoutTypePrefix(clean(liveEntityLabel, 240));
  const authored = Boolean(stored) && stored !== snapshot && stored !== withoutTypePrefix(snapshot);
  if (authored) return stored;
  // Le préfixe de type vient du sélecteur du studio, pas du nom de l'entité : il n'a pas
  // à réapparaître quand on retombe sur l'instantané.
  return live || stored || withoutTypePrefix(snapshot) || String(node?.id ?? '');
}

export function normalizeDiagramEdge(source = {}, index = 0) {
  return {
    ...source,
    id:source.id || `edge-${index + 1}`,
    type:source.type == null || source.type === '' ? 'logical-signal' : String(source.type),
    layerId:source.layerId || 'main',
    sourceNodeId:source.sourceNodeId ?? null,
    sourcePortId:source.sourcePortId ?? null,
    destinationNodeId:source.destinationNodeId ?? source.targetNodeId ?? null,
    destinationPortId:source.destinationPortId ?? source.targetPortId ?? null,
    cableId:source.cableId ?? null,
    relationId:source.relationId ?? null,
    pathRole:clean(source.pathRole || 'OTHER', 30).toUpperCase(),
    label:clean(source.label, 240),
    route:Array.isArray(source.route) ? source.route.slice(0, 100).map(point => ({ x:clamp(point.x, 0, 100), y:clamp(point.y, 0, 100) })) : [],
    style:{ color:clean(source.style?.color, 30), width:clamp(source.style?.width, 0.5, 20, 2), dashed:source.style?.dashed === true }
  };
}

export function normalizeDiagram(source = {}, current = null) {
  const timestamp = new Date().toISOString();
  const id = source.id || current?.id || `diagram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const type = source.diagramType == null || source.diagramType === '' ? 'signal-synoptic' : String(source.diagramType);
  const status = source.status == null || source.status === '' ? 'draft' : String(source.status);
  const layers = (Array.isArray(source.layers) && source.layers.length ? source.layers : [{ id:'main', name:'Principal', visible:true }]).map((layer, index) => ({
    id:layer.id || `layer-${index + 1}`, name:clean(layer.name || `Calque ${index + 1}`, 120),
    visible:layer.visible !== false, locked:layer.locked === true, order:index
  }));
  return {
    ...current,
    ...source,
    id,
    kind:DIAGRAM_RECORD_KIND,
    targetType:DIAGRAM_RECORD_KIND,
    targetId:id,
    title:clean(source.title ?? current?.title, 240),
    diagramType:type,
    status,
    revision:clean(source.revision ?? current?.revision ?? '1', 40),
    supersedesId:source.supersedesId ?? current?.supersedesId ?? null,
    zoneIds:[...new Set((Array.isArray(source.zoneIds ?? current?.zoneIds) ? (source.zoneIds ?? current?.zoneIds) : []).map(String))],
    background:{
      imageUrl:clean(source.background?.imageUrl ?? current?.background?.imageUrl, 3000),
      width:clamp(source.background?.width ?? current?.background?.width, 1, 50000, 2000),
      height:clamp(source.background?.height ?? current?.background?.height, 1, 50000, 1200),
      calibration:source.background?.calibration ?? current?.background?.calibration ?? null
    },
    layers,
    nodes:(Array.isArray(source.nodes ?? current?.nodes) ? (source.nodes ?? current?.nodes) : []).slice(0, 5000).map(normalizeDiagramNode),
    edges:(Array.isArray(source.edges ?? current?.edges) ? (source.edges ?? current?.edges) : []).slice(0, 10000).map(normalizeDiagramEdge),
    authorId:source.authorId ?? current?.authorId ?? null,
    validation:source.validation ?? current?.validation ?? null,
    notes:clean(source.notes ?? current?.notes),
    createdAt:current?.createdAt || source.createdAt || timestamp,
    updatedAt:timestamp,
    diagramVersion:2
  };
}

export function validateDiagram(record = {}) {
  const value = normalizeDiagram(record);
  const errors = [];
  if (record.kind && record.kind !== DIAGRAM_RECORD_KIND) errors.push('Type de document diagramme invalide.');
  if (!value.title) errors.push('Le diagramme doit avoir un titre.');
  if (value.supersedesId != null && String(value.supersedesId) === String(value.id)) errors.push('Un diagramme ne peut pas se remplacer lui-même.');
  if (!value.zoneIds.length) errors.push('Le diagramme doit être rattaché à au moins une zone.');
  if (!DIAGRAM_TYPES.includes(value.diagramType)) errors.push('Type de diagramme inconnu.');
  if (!safeInternalImageReference(value.background.imageUrl)) errors.push("L'image de fond doit utiliser un chemin interne sûr, sans schéma externe ni traversée de répertoire.");
  if (!DIAGRAM_STATUSES.includes(value.status)) errors.push('Statut de diagramme invalide.');
  const layerIds = new Set(); const nodeIds = new Set(); const edgeIds = new Set();
  for (const layer of value.layers) {
    if (layerIds.has(String(layer.id))) errors.push(`Calque dupliqué: ${layer.id}.`);
    layerIds.add(String(layer.id));
  }
  for (const node of value.nodes) {
    if (nodeIds.has(String(node.id))) errors.push(`Nœud dupliqué: ${node.id}.`);
    nodeIds.add(String(node.id));
    if (!DIAGRAM_NODE_TYPES.includes(node.type)) errors.push(`Type de nœud inconnu: ${node.type}.`);
    if (!layerIds.has(String(node.layerId))) errors.push(`Le nœud ${node.id} référence un calque introuvable.`);
    if (['entity', 'port-anchor'].includes(node.type) && (!node.entityRef || node.entityRef.id == null)) errors.push(`Le nœud technique ${node.id} doit référencer une entité existante.`);
    if (node.type === 'port-anchor' && !node.anchorPortId) errors.push(`Le point de brassage ${node.id} doit référencer un port canonique.`);
    if (node.type === 'label' && !node.label) errors.push(`Le texte libre ${node.id} ne peut pas être vide.`);
    if (node.type === 'boundary' && !node.label) errors.push(`Le cadre ${node.id} doit avoir un libellé.`);
    if (node.type === 'off-page-reference' && !node.referenceText && !node.targetDiagramId) errors.push(`Le renvoi ${node.id} doit indiquer une référence ou un schéma cible.`);
  }
  for (const edge of value.edges) {
    if (edgeIds.has(String(edge.id))) errors.push(`Relation graphique dupliquée: ${edge.id}.`);
    edgeIds.add(String(edge.id));
    if (!DIAGRAM_EDGE_TYPES.includes(edge.type)) errors.push(`Type de relation graphique inconnu: ${edge.type}.`);
    if (!nodeIds.has(String(edge.sourceNodeId))) errors.push(`La source de la relation ${edge.id} est introuvable.`);
    if (!nodeIds.has(String(edge.destinationNodeId))) errors.push(`La destination de la relation ${edge.id} est introuvable.`);
    if (!layerIds.has(String(edge.layerId))) errors.push(`La relation ${edge.id} référence un calque introuvable.`);
    if (String(edge.sourceNodeId) === String(edge.destinationNodeId) && String(edge.sourcePortId || '') === String(edge.destinationPortId || '')) errors.push(`La relation ${edge.id} boucle sur le même point.`);
    if (value.status === 'validated' && edge.type === 'physical-cable' && !edge.cableId) errors.push(`La liaison physique ${edge.id} doit référencer un câble enregistré avant validation.`);
    if (value.status === 'validated' && edge.type === 'physical-cable' && (!edge.sourcePortId || !edge.destinationPortId)) errors.push(`La liaison physique ${edge.id} doit indiquer les deux ports raccordés avant validation.`);
    if (value.status === 'validated' && edge.type !== 'physical-cable' && edge.type !== 'contains' && !edge.relationId) {
      errors.push(`La relation technique ${edge.id} doit référencer une relation métier enregistrée avant validation.`);
    }
  }
  if (value.status === 'validated' && (!value.validation?.validatedBy || !value.validation?.validatedAt)) errors.push('Un diagramme validé doit indiquer son validateur et sa date de validation.');
  return { value, errors:[...new Set(errors)] };
}

export function applyDiagramApproval(record, actor, { force = false } = {}) {
  /*
   * CE CONTRAT NE DÉCIDE PAS QUI A LE DROIT. IL DÉCIDE CE QU'EST UNE VALIDATION.
   *
   * Il portait une liste de rôles écrite à la main — une SECONDE politique, invisible
   * depuis `permissions.js` et depuis les zones. Le Chef, à qui la matrice accorde
   * `diagrams.validate` et que l'endpoint autorise déjà dans toutes ses zones, était refusé
   * ici. Y ajouter `chef` aurait fait passer le cas du jour en laissant le piège intact
   * pour le rôle suivant.
   *
   * L'autorisation appartient à l'endpoint et à `access-control` : session, visibilité,
   * appartenance aux zones, et `diagram.validate` dans TOUTES les zones concernées. Ce qui
   * reste ici est métier, et rien d'autre : un acteur IDENTIFIÉ — sans identité, il n'y a
   * personne à inscrire dans `validatedBy` et les quatre yeux n'ont plus de sens.
   */
  if (actor?.id === undefined || actor?.id === null || actor.id === '') throw Object.assign(new Error('La validation doit être signée par un utilisateur identifié.'), { status:403, code:'DIAGRAM_APPROVER_UNKNOWN' });
  if (!force && record.authorId != null && String(record.authorId) === String(actor.id)) throw Object.assign(new Error('Principe des quatre yeux: le validateur doit être différent de l’auteur.'), { status:409, code:'FOUR_EYES_REQUIRED' });
  const approved = normalizeDiagram({ ...record, status:'validated', validation:{ validatedBy:actor.id, validatedAt:new Date().toISOString(), previousStatus:record.status || 'draft' } }, record);
  const checked = validateDiagram(approved);
  if (checked.errors.length) throw Object.assign(new Error(checked.errors.join(' ')), { status:400, code:'INVALID_DIAGRAM_APPROVAL', details:checked.errors });
  return checked.value;
}
