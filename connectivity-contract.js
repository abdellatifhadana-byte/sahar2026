const TEXT_LIMIT = 500;

export const PORT_DIRECTIONS = Object.freeze(['IN', 'OUT', 'IN/OUT']);
export const PORT_BEHAVIOR_IDS = Object.freeze(['fixed', 'patch', 'bidirectional', 'passive']);
export const ENDPOINT_TYPES = Object.freeze(['equipment', 'component', 'screen']);
export const SIGNAL_DOMAINS = Object.freeze([
  'VIDEO', 'AUDIO', 'NETWORK', 'DATA', 'CONTROL', 'SYNC', 'TIMECODE',
  'RF', 'POWER', 'KVM', 'INTERCOM', 'UNKNOWN'
]);
export const PATH_ROLES = Object.freeze(['PROGRAM', 'BACKUP', 'MONITORING', 'SYNC', 'AUDIO', 'INTERCOM', 'OTHER']);
export const SIGNAL_MODES = Object.freeze(['DIRECT', 'MANUAL_PATCH', 'BIDIRECTIONAL', 'PHYSICAL_ONLY']);
export const VERIFICATION_STATUSES = Object.freeze(['verified', 'documented', 'observed', 'observed-handwritten', 'to-confirm', 'draft']);

export const PATH_ROLE_COLORS = Object.freeze({
  PROGRAM: '#16a34a',
  BACKUP: '#f97316',
  MONITORING: '#2563eb',
  SYNC: '#7c3aed',
  AUDIO: '#ca8a04',
  INTERCOM: '#db2777',
  OTHER: '#64748b'
});

const port = (connectors, signalDomains, protocols, extra = {}) => Object.freeze({
  connectors:Object.freeze(connectors), signalDomains:Object.freeze(signalDomains),
  protocols:Object.freeze(protocols), ...extra
});

/**
 * Catalogue de compatibilité générique. Il décrit uniquement la connectique et
 * les familles de signaux. Les capacités exactes d'une instance restent issues
 * de sa plaque, de ses cartes installées et d'une validation terrain.
 */
export const PORT_TYPE_DEFINITIONS = Object.freeze({
  'BNC / SDI': port(['BNC'], ['VIDEO'], ['SDI']),
  'HD-SDI': port(['BNC'], ['VIDEO'], ['SDI'], { formats:['HD-SDI'] }),
  '3G-SDI': port(['BNC'], ['VIDEO'], ['SDI'], { formats:['HD-SDI', '3G-SDI'] }),
  '6G-SDI': port(['BNC'], ['VIDEO'], ['SDI'], { formats:['HD-SDI', '3G-SDI', '6G-SDI'] }),
  '12G-SDI': port(['BNC'], ['VIDEO'], ['SDI'], { formats:['HD-SDI', '3G-SDI', '6G-SDI', '12G-SDI'] }),
  'HDMI': port(['HDMI'], ['VIDEO', 'AUDIO'], ['HDMI']),
  'DisplayPort': port(['DISPLAYPORT'], ['VIDEO', 'AUDIO'], ['DISPLAYPORT']),
  'DVI': port(['DVI'], ['VIDEO'], ['DVI']),
  'VGA': port(['VGA'], ['VIDEO'], ['VGA']),
  'RJ45 Ethernet': port(['RJ45'], ['NETWORK', 'DATA'], ['ETHERNET']),
  'SFP / SFP+': port(['SFP_CAGE'], ['NETWORK', 'DATA', 'VIDEO'], ['ETHERNET', 'IP']),
  'Fibre LC': port(['LC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE']),
  'Fibre SC': port(['SC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE']),
  'XLR analogique': port(['XLR3'], ['AUDIO'], ['AUDIO_ANALOG']),
  'AES/EBU': port(['XLR3', 'BNC'], ['AUDIO'], ['AES3'], { ambiguousConnector:true }),
  'RCA': port(['RCA'], ['AUDIO', 'VIDEO'], ['AUDIO_ANALOG', 'COMPOSITE_VIDEO']),
  'Jack 3.5': port(['JACK_35'], ['AUDIO'], ['AUDIO_ANALOG']),
  'Jack 6.35': port(['JACK_635'], ['AUDIO'], ['AUDIO_ANALOG']),
  'USB': port(['USB_A'], ['DATA', 'CONTROL', 'KVM'], ['USB']),
  'USB-C': port(['USB_C'], ['DATA', 'CONTROL', 'KVM', 'VIDEO', 'POWER'], ['USB', 'DISPLAYPORT_ALT_MODE', 'USB_PD']),
  'RS-232': port(['DE9', 'TERMINAL'], ['CONTROL', 'DATA'], ['RS232']),
  'RS-422': port(['DE9', 'TERMINAL'], ['CONTROL', 'DATA'], ['RS422']),
  'GPIO / GPI / Tally': port(['TERMINAL_GPIO'], ['CONTROL'], ['GPIO', 'GPI', 'TALLY']),
  'Genlock / REF': port(['BNC'], ['SYNC'], ['GENLOCK', 'BLACK_BURST', 'TRI_LEVEL_SYNC']),
  'LTC / Timecode': port(['BNC', 'XLR3'], ['TIMECODE', 'SYNC'], ['LTC'], { ambiguousConnector:true }),
  'Word Clock': port(['BNC'], ['SYNC', 'AUDIO'], ['WORD_CLOCK']),
  'RF F-Type': port(['F_TYPE'], ['RF'], ['RF']),
  'RF N-Type': port(['N_TYPE'], ['RF'], ['RF']),
  'SMA': port(['SMA'], ['RF'], ['RF']),
  'IEC alimentation': port(['IEC'], ['POWER'], ['AC_POWER']),
  'DC alimentation': port(['DC'], ['POWER'], ['DC_POWER']),
  'Autre': port(['UNKNOWN'], ['UNKNOWN'], ['UNKNOWN'])
});

const cable = (connectors, signalDomains, protocols, diagramColor, extra = {}) => Object.freeze({
  connectors:Object.freeze(connectors), signalDomains:Object.freeze(signalDomains),
  protocols:Object.freeze(protocols), diagramColor, ...extra
});

export const CABLE_TYPE_DEFINITIONS = Object.freeze({
  'Vidéo': Object.freeze({
    'SDI': cable(['BNC'], ['VIDEO'], ['SDI'], '#1d4ed8'),
    'HD-SDI': cable(['BNC'], ['VIDEO'], ['SDI'], '#1d4ed8', { formats:['HD-SDI'] }),
    '3G-SDI': cable(['BNC'], ['VIDEO'], ['SDI'], '#1d4ed8', { formats:['HD-SDI', '3G-SDI'] }),
    '6G-SDI': cable(['BNC'], ['VIDEO'], ['SDI'], '#1d4ed8', { formats:['6G-SDI'] }),
    '12G-SDI': cable(['BNC'], ['VIDEO'], ['SDI'], '#1d4ed8', { formats:['12G-SDI'] }),
    'HDMI': cable(['HDMI'], ['VIDEO', 'AUDIO'], ['HDMI'], '#0f766e'),
    'DisplayPort': cable(['DISPLAYPORT'], ['VIDEO', 'AUDIO'], ['DISPLAYPORT'], '#0f766e'),
    'DVI': cable(['DVI'], ['VIDEO'], ['DVI'], '#0f766e'),
    'VGA': cable(['VGA'], ['VIDEO'], ['VGA'], '#0f766e')
  }),
  'Audio': Object.freeze({
    'XLR analogique': cable(['XLR3'], ['AUDIO'], ['AUDIO_ANALOG'], '#ca8a04'),
    'AES/EBU': cable(['XLR3', 'BNC'], ['AUDIO'], ['AES3'], '#ca8a04', { ambiguousConnector:true }),
    'RCA': cable(['RCA'], ['AUDIO'], ['AUDIO_ANALOG'], '#ca8a04'),
    'Jack 3.5': cable(['JACK_35'], ['AUDIO'], ['AUDIO_ANALOG'], '#ca8a04'),
    'Jack 6.35': cable(['JACK_635'], ['AUDIO'], ['AUDIO_ANALOG'], '#ca8a04'),
    'SpeakON': cable(['SPEAKON'], ['AUDIO'], ['SPEAKER_LEVEL'], '#ca8a04')
  }),
  'Réseau / Data': Object.freeze({
    'RJ45 Cat5e': cable(['RJ45'], ['NETWORK', 'DATA'], ['ETHERNET'], '#0891b2'),
    'RJ45 Cat6': cable(['RJ45'], ['NETWORK', 'DATA'], ['ETHERNET'], '#0891b2'),
    'RJ45 Cat6a': cable(['RJ45'], ['NETWORK', 'DATA'], ['ETHERNET'], '#0891b2'),
    'RJ45 Cat7': cable(['RJ45'], ['NETWORK', 'DATA'], ['ETHERNET'], '#0891b2'),
    'USB': cable(['USB_A'], ['DATA', 'CONTROL', 'KVM'], ['USB'], '#0891b2'),
    'USB-C': cable(['USB_C'], ['DATA', 'CONTROL', 'KVM', 'VIDEO', 'POWER'], ['USB', 'DISPLAYPORT_ALT_MODE', 'USB_PD'], '#0891b2'),
    'RS-232': cable(['DE9', 'TERMINAL'], ['CONTROL', 'DATA'], ['RS232'], '#64748b', { ambiguousConnector:true }),
    'RS-422': cable(['DE9', 'TERMINAL'], ['CONTROL', 'DATA'], ['RS422'], '#64748b', { ambiguousConnector:true })
  }),
  'Fibre optique': Object.freeze({
    'Monomode LC-LC': cable(['LC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE'], '#7c3aed'),
    'Multimode LC-LC': cable(['LC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE'], '#7c3aed'),
    'SC-SC': cable(['SC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE'], '#7c3aed'),
    'LC-SC': cable(['LC', 'SC'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET', 'SDI_OVER_FIBRE'], '#7c3aed', { asymmetric:true }),
    'MPO/MTP': cable(['MPO'], ['NETWORK', 'DATA', 'VIDEO', 'AUDIO'], ['IP', 'ETHERNET'], '#7c3aed')
  }),
  'RF / Satellite': Object.freeze({
    'Coaxial BNC': cable(['BNC'], ['RF', 'VIDEO', 'SYNC', 'AUDIO'], ['RF', 'SDI', 'GENLOCK', 'AES3'], '#be123c'),
    'F-Type': cable(['F_TYPE'], ['RF'], ['RF'], '#be123c'),
    'N-Type': cable(['N_TYPE'], ['RF'], ['RF'], '#be123c'),
    'SMA': cable(['SMA'], ['RF'], ['RF'], '#be123c'),
    'Câble satellite': cable(['F_TYPE'], ['RF'], ['RF'], '#be123c')
  }),
  'Énergie': Object.freeze({
    'IEC C13/C14': cable(['IEC'], ['POWER'], ['AC_POWER'], '#dc2626'),
    'IEC C19/C20': cable(['IEC'], ['POWER'], ['AC_POWER'], '#dc2626'),
    'Schuko': cable(['SCHUKO'], ['POWER'], ['AC_POWER'], '#dc2626'),
    'DC': cable(['DC'], ['POWER'], ['DC_POWER'], '#dc2626')
  }),
  'Synchronisation / Contrôle': Object.freeze({
    'Genlock / REF': cable(['BNC'], ['SYNC'], ['GENLOCK', 'BLACK_BURST', 'TRI_LEVEL_SYNC'], '#7c3aed'),
    'Word Clock': cable(['BNC'], ['SYNC', 'AUDIO'], ['WORD_CLOCK'], '#7c3aed'),
    'LTC / Timecode': cable(['BNC', 'XLR3'], ['TIMECODE', 'SYNC'], ['LTC'], '#7c3aed', { ambiguousConnector:true }),
    'GPIO / GPI / Tally': cable(['TERMINAL_GPIO'], ['CONTROL'], ['GPIO', 'GPI', 'TALLY'], '#64748b')
  })
});

export const PORT_TYPES = Object.freeze(Object.keys(PORT_TYPE_DEFINITIONS));
export const CABLE_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(CABLE_TYPE_DEFINITIONS).map(([category, definitions]) => [category, Object.freeze(Object.keys(definitions))])
));

const text = (value, max = TEXT_LIMIT) => String(value ?? '').trim().slice(0, max);
const unique = values => [...new Set((Array.isArray(values) ? values : values == null || values === '' ? [] : String(values).split(','))
  .map(value => text(value, 100).toUpperCase()).filter(Boolean))].slice(0, 64);

export function normalizePortDirection(value) {
  const normalized = text(value, 20).toUpperCase();
  if (!normalized) return 'IN/OUT';
  if (['IN', 'INPUT', 'ENTREE', 'ENTRÉE'].includes(normalized)) return 'IN';
  if (['OUT', 'OUTPUT', 'SORTIE'].includes(normalized)) return 'OUT';
  return ['IN/OUT', 'BIDIRECTIONAL', 'BIDIRECTIONNEL'].includes(normalized) ? 'IN/OUT' : normalized;
}

export function portTypeDefinition(type) {
  return PORT_TYPE_DEFINITIONS[type] || PORT_TYPE_DEFINITIONS.Autre;
}

export function cableTypeDefinition(category, type) {
  return CABLE_TYPE_DEFINITIONS[category]?.[type] || null;
}

export function normalizePort(source = {}, index = 0, { fallbackBehavior = 'fixed', idPrefix = 'PORT' } = {}) {
  const type = PORT_TYPE_DEFINITIONS[source.type] ? source.type : text(source.type || 'Autre', 100);
  const definition = portTypeDefinition(type);
  const behavior = PORT_BEHAVIOR_IDS.includes(source.behavior || source.mode) ? (source.behavior || source.mode) : fallbackBehavior;
  const signalDomains = unique(source.signalDomains?.length ? source.signalDomains : definition.signalDomains);
  return {
    // Port records are an explicit contract. Unknown client fields are dropped
    // instead of being persisted through an unrestricted object spread.
    id:text(source.id, 160) || `${idPrefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    number:text(source.number ?? source.numero ?? index + 1, 100),
    type,
    direction:normalizePortDirection(source.direction || source.sens),
    behavior:PORT_BEHAVIOR_IDS.includes(behavior) ? behavior : 'fixed',
    label:text(source.label || source.nom, 240),
    connectorTypes:unique(source.connectorTypes?.length ? source.connectorTypes : definition.connectors),
    signalDomains,
    protocols:unique(source.protocols?.length ? source.protocols : definition.protocols),
    // `formats` means formats observed/configured on this instance. Capabilities
    // from the generic port type stay separate and cannot prove the active mode.
    formats:unique(source.formats || []),
    formatCapabilities:unique(source.formatCapabilities?.length ? source.formatCapabilities : definition.formats || []),
    status:text(source.status || 'available', 40).toLowerCase(),
    // One physical port represents one termination. Fan-out must be modelled by
    // a distribution device with distinct outputs, never by a client flag.
    allowMultipleConnections:false,
    verificationStatus:VERIFICATION_STATUSES.includes(source.verificationStatus) ? source.verificationStatus : 'to-confirm',
    confidence:text(source.confidence, 20).toLowerCase(),
    sourceRef:text(source.sourceRef, 500),
    notes:text(source.notes, 1000)
  };
}

export function normalizePorts(ports, options = {}) {
  return (Array.isArray(ports) ? ports : []).map((portValue, index) => normalizePort(portValue, index, options));
}

const FLEXIBLE_BEHAVIORS = new Set(['patch', 'bidirectional', 'passive']);
export const portCanSource = portValue => Boolean(portValue) && (['OUT', 'IN/OUT'].includes(normalizePortDirection(portValue.direction)) || FLEXIBLE_BEHAVIORS.has(portValue.behavior));
export const portCanDestination = portValue => Boolean(portValue) && (['IN', 'IN/OUT'].includes(normalizePortDirection(portValue.direction)) || FLEXIBLE_BEHAVIORS.has(portValue.behavior));

function endpointType(record, side) {
  const explicit = text(record[`${side}Type`], 30).toLowerCase();
  if (ENDPOINT_TYPES.includes(explicit)) return explicit;
  if (record[`${side}ScreenId`] != null) return 'screen';
  return 'equipment';
}

function endpointId(record, side, type) {
  if (record[`${side}Id`] != null && record[`${side}Id`] !== '') return record[`${side}Id`];
  if (type === 'screen') return record[`${side}ScreenId`];
  if (type === 'component') return record[`${side}ComponentId`];
  return record[`${side}EquipmentId`];
}


/* ═════════════════════════════════════════════════════════════════════════════
 * LE TRACÉ PHYSIQUE D'UN CÂBLE — ET CE QU'IL N'A PAS LE DROIT DE DIRE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * CE QU'EST UN TRACÉ.
 * Le chemin RÉELLEMENT relevé d'un câble à travers les scènes de l'installation : le plan
 * du site, une salle, une baie. Il vit DANS l'enregistrement du câble — décision arbitrée —
 * et non dans un magasin à lui : il n'a pas d'existence propre, il documente un câble, et
 * il partage donc sa révision.
 *
 * CE QU'UN TRACÉ N'EST PAS.
 * Ce n'est pas une ligne entre deux points. Un câble dont personne n'a relevé le
 * cheminement n'a PAS de tracé, et l'écran doit le dire — « Tracé physique non renseigné » —
 * plutôt que tirer un trait droit de la source à la destination. Un trait inventé se lit
 * comme un relevé : sur un plan d'installation, c'est une affirmation fausse sur le monde
 * physique, et quelqu'un finira par tirer un câble en s'y fiant.
 *
 * LE TRACÉ NE DOIT PAS DEVENIR UN CANAL DÉTOURNÉ.
 * Un câble peut être visible alors qu'une partie de son cheminement traverse une salle ou
 * une baie que le lecteur n'a pas le droit de voir. Les coordonnées de ce passage sont de
 * l'information physique sur une zone protégée : elles ne sortent pas. D'où deux formes du
 * même tracé — COMPLET tel qu'il est stocké, PARTIEL ce qu'un lecteur restreint reçoit.
 *
 * ET LA CONSÉQUENCE QUI COMPTE LE PLUS : un tracé PARTIEL ne doit jamais pouvoir être
 * réenregistré comme s'il était complet. Ce serait effacer, par une simple sauvegarde
 * honnête, les segments que le serveur venait de masquer. `routeIsPartial` existe pour que
 * l'écran ferme l'édition, et le serveur refuse indépendamment — voir `scripts/serve.js`.
 *
 * COORDONNÉES : pixels de l'image NATURELLE, jamais des pixels CSS, jamais des pourcentages
 * de fenêtre — la seule mesure qui désigne le même endroit physique après un
 * redimensionnement. Même convention que `map-coordinates-contract.js`.
 *
 * POURQUOI ICI PLUTÔT QUE DANS UN FICHIER À PART : le tracé est un sous-objet du câble, et
 * `normalizeCableRecord` doit pouvoir le valider. Or ce fichier ne peut RIEN importer sans
 * ouvrir un risque de cycle sur le contrat le plus dépendu du dépôt.
 * ═════════════════════════════════════════════════════════════════════════════ */
export const CABLE_ROUTE_VERSION = 1;

/** Ce que le relevé vaut. Trois états, et « proposé » ne se présente jamais comme vérifié. */
export const ROUTE_STATUSES = Object.freeze(['verified', 'proposed', 'unknown']);

/*
 * Les scènes d'une installation.
 *
 * `map-coordinates-contract.js` porte la même liste sous le nom `MAP_SCENES`, et on
 * préférerait l'importer. On ne le peut pas : ce fichier est une FEUILLE — aucun import —
 * et c'est ce qui permet aux quinze modules qui en dépendent de le faire sans risque de
 * cycle. La liste est donc redite ici, et une épreuve (`vocabulaire-partage`) vérifie que
 * les deux ne divergent jamais.
 */
export const ROUTE_SCENE_TYPES = Object.freeze(['map', 'room', 'baie']);

/** Les scènes qui désignent UN objet précis, et exigent donc son identifiant. */
const SCENES_A_IDENTIFIANT = Object.freeze(['room', 'baie']);

export const MISSING_ROUTE_LABEL = 'Tracé physique non renseigné';
export const PARTIAL_ROUTE_LABEL = 'Une partie du tracé est hors périmètre';

export const ROUTE_STATUS_LABELS = Object.freeze({
  verified: 'Tracé vérifié',
  proposed: 'Tracé proposé',
  unknown: 'Tracé non vérifié'
});

/** Un segment isolé ne décrit aucun chemin : il faut au moins deux points. */
const MIN_WAYPOINTS = 2;

const ANCHOR_ROLES = Object.freeze(['source', 'destination']);

const fini = value => typeof value === 'number' && Number.isFinite(value);
const nombre = value => (typeof value === 'number' ? value : Number(value));
const presente = value => value !== null && value !== undefined && value !== '';
const dimension = value => {
  const n = nombre(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * VALIDATION — on REFUSE, on ne répare pas.
 *
 * Une géométrie corrompue silencieusement « corrigée » devient une géométrie fausse que
 * plus personne ne sait fausse. Chaque défaut est donc nommé et remonté ; c'est l'écrivain
 * qui corrige, jamais le contrat.
 * ───────────────────────────────────────────────────────────────────────────── */

function validerPoint(point, { naturalWidth, naturalHeight }, chemin, errors) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) {
    errors.push(`${chemin} : un point doit être un objet { x, y }.`);
    return null;
  }
  const x = nombre(point.x);
  const y = nombre(point.y);
  if (!fini(x) || !fini(y)) {
    errors.push(`${chemin} : coordonnées non finies (x=${String(point.x)}, y=${String(point.y)}).`);
    return null;
  }
  // Hors de l'image, le point ne désigne aucun endroit physique.
  if (x < 0 || y < 0 || x > naturalWidth || y > naturalHeight) {
    errors.push(`${chemin} : point hors de l'image (${x}, ${y}) pour ${naturalWidth}×${naturalHeight}.`);
    return null;
  }
  return { x, y };
}

function validerSegment(source, index, errors) {
  const chemin = `segment ${index}`;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    errors.push(`${chemin} : un segment doit être un objet.`);
    return null;
  }
  const sceneType = source.sceneType;
  if (!ROUTE_SCENE_TYPES.includes(sceneType)) {
    errors.push(`${chemin} : scène inconnue « ${String(sceneType)} ».`);
    return null;
  }
  // Une salle ou une baie DÉSIGNE un objet : sans son identifiant, on ne saurait ni
  // l'afficher au bon endroit, ni décider qui a le droit de la voir.
  const sceneId = presente(source.sceneId) ? source.sceneId : null;
  if (SCENES_A_IDENTIFIANT.includes(sceneType) && sceneId === null) {
    errors.push(`${chemin} : une scène « ${sceneType} » exige son identifiant.`);
    return null;
  }
  if (sceneType === 'map' && sceneId !== null) {
    errors.push(`${chemin} : le plan du site n'a pas d'identifiant de scène.`);
    return null;
  }

  const naturalWidth = dimension(source.naturalWidth);
  const naturalHeight = dimension(source.naturalHeight);
  if (naturalWidth === null || naturalHeight === null) {
    errors.push(`${chemin} : dimensions naturelles de l'image absentes ou non positives.`);
    return null;
  }

  if (!Array.isArray(source.waypoints)) {
    errors.push(`${chemin} : « waypoints » doit être une liste.`);
    return null;
  }
  if (source.waypoints.length < MIN_WAYPOINTS) {
    errors.push(`${chemin} : un chemin exige au moins ${MIN_WAYPOINTS} points, ${source.waypoints.length} fourni(s).`);
    return null;
  }
  const waypoints = [];
  source.waypoints.forEach((point, rang) => {
    const propre = validerPoint(point, { naturalWidth, naturalHeight }, `${chemin}, point ${rang}`, errors);
    if (propre) waypoints.push(propre);
  });
  if (waypoints.length !== source.waypoints.length) return null;

  /*
   * ANCRES — optionnelles, et volontairement pauvres.
   *
   * Une ancre dit qu'une extrémité de CE segment est arrimée à la source ou à la
   * destination du câble, pour que le rendu puisse rejoindre le marqueur de l'appareil
   * plutôt que s'arrêter dans le vide. Elle ne porte rien d'autre : ni identifiant
   * d'équipement, ni port — le câble les porte déjà, et les redire ici en ferait une
   * seconde vérité à maintenir.
   */
  const ancresBrutes = source.anchors === undefined || source.anchors === null ? [] : source.anchors;
  if (!Array.isArray(ancresBrutes)) {
    errors.push(`${chemin} : « anchors » doit être une liste.`);
    return null;
  }
  const anchors = [];
  ancresBrutes.forEach((ancre, rang) => {
    if (!ancre || typeof ancre !== 'object' || !ANCHOR_ROLES.includes(ancre.role)) {
      errors.push(`${chemin}, ancre ${rang} : rôle attendu parmi ${ANCHOR_ROLES.join(', ')}.`);
      return;
    }
    const point = validerPoint(ancre, { naturalWidth, naturalHeight }, `${chemin}, ancre ${rang}`, errors);
    if (point) anchors.push({ role: ancre.role, ...point });
  });
  if (anchors.length !== ancresBrutes.length) return null;

  return { sceneType, sceneId, naturalWidth, naturalHeight, waypoints, anchors };
}

/**
 * Le tracé, validé — sans rien réparer.
 *
 * `value` n'est renseigné que si TOUT est valide : un tracé à moitié bon est un tracé faux,
 * et en garder la moitié reviendrait à inventer le reste.
 */
export function validateCableRoute(source) {
  if (source === null || source === undefined) return { valid: true, errors: [], value: null };
  const errors = [];
  if (typeof source !== 'object' || Array.isArray(source)) {
    return { valid: false, errors: ['Le tracé doit être un objet.'], value: null };
  }

  const version = nombre(source.version);
  if (version !== CABLE_ROUTE_VERSION) {
    errors.push(`Version de tracé non prise en charge : ${String(source.version)} (attendu ${CABLE_ROUTE_VERSION}).`);
  }
  const status = source.status;
  if (!ROUTE_STATUSES.includes(status)) {
    errors.push(`Statut de tracé inconnu « ${String(status)} ».`);
  }
  if (!Array.isArray(source.segments)) {
    errors.push('« segments » doit être une liste.');
    return { valid: false, errors, value: null };
  }
  if (!source.segments.length) {
    errors.push('Un tracé sans segment ne documente rien : ne pas en enregistrer plutôt qu\'en enregistrer un vide.');
  }

  const segments = [];
  source.segments.forEach((segment, index) => {
    const propre = validerSegment(segment, index, errors);
    if (propre) segments.push(propre);
  });

  if (errors.length) return { valid: false, errors, value: null };
  return {
    valid: true,
    errors: [],
    value: { version: CABLE_ROUTE_VERSION, status, segments, ...(source.partial === true ? { partial: true } : {}) }
  };
}

/**
 * La forme canonique du tracé, ou `null`.
 *
 * `null` couvre DEUX faits distincts que l'appelant doit déjà avoir séparés : « pas de
 * tracé » et « tracé refusé ». Utiliser `validateCableRoute` quand la différence compte —
 * c'est le cas partout où l'on écrit.
 */
export function normalizeCableRoute(source) {
  return validateCableRoute(source).value;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * LECTURE PAR SCÈNE
 * ───────────────────────────────────────────────────────────────────────────── */

/** La scène d'un segment, sous une forme comparable. */
export function routeSceneRef(segment = {}) {
  return { sceneType: segment.sceneType ?? null, sceneId: segment.sceneId ?? null };
}

const memeScene = (a, b) => a.sceneType === b.sceneType && String(a.sceneId ?? '') === String(b.sceneId ?? '');

/**
 * Les segments à dessiner DANS CETTE SCÈNE — et rien d'autre.
 *
 * Un segment relevé dans la salle STC n'a aucun sens sur le plan du site ni dans une autre
 * salle : ses coordonnées appartiennent à une AUTRE image. Les dessiner ailleurs poserait
 * un trait exact au mauvais endroit, ce qui se lit comme un relevé.
 */
export function routeSegmentsForScene(route, scene = {}) {
  const cible = { sceneType: scene.sceneType ?? null, sceneId: scene.sceneId ?? null };
  if (!ROUTE_SCENE_TYPES.includes(cible.sceneType)) return [];
  if (SCENES_A_IDENTIFIANT.includes(cible.sceneType) && !presente(cible.sceneId)) return [];
  return (route?.segments || []).filter(segment => memeScene(routeSceneRef(segment), cible));
}

/** Ce tracé a-t-il été amputé par la protection ? */
export function routeIsPartial(route) {
  return Boolean(route && route.partial === true);
}

/** Y a-t-il un tracé à montrer ? */
export function routeIsDocumented(route) {
  return Boolean(route && Array.isArray(route.segments) && route.segments.length > 0);
}

/**
 * Ce que l'écran dit de ce tracé — une seule phrase, décidée ici.
 *
 * L'absence et la protection sont deux faits DIFFÉRENTS : « non renseigné » dit que
 * personne ne l'a relevé, « hors périmètre » dit qu'il existe et ne nous regarde pas.
 * Les confondre enverrait un exploitant relever un cheminement déjà documenté.
 */
export function routeStatusLabel(route) {
  if (routeIsPartial(route)) return PARTIAL_ROUTE_LABEL;
  if (!routeIsDocumented(route)) return MISSING_ROUTE_LABEL;
  return ROUTE_STATUS_LABELS[route.status] || ROUTE_STATUS_LABELS.unknown;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PROTECTION
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Le tracé tel qu'un lecteur restreint a le droit de le recevoir.
 *
 * `autoriseScene({ sceneType, sceneId })` est fourni par l'appelant — le serveur le
 * construit sur l'autorisation canonique de la ressource, jamais sur `cable.roomId`, qui
 * est un cache périmé et ne dit rien du cheminement.
 *
 * CE QUI SORT D'UN SEGMENT MASQUÉ : rien. Ni son identifiant de scène, ni ses coordonnées,
 * ni ses ancres, ni ses dimensions d'image — une image a une taille reconnaissable. Ni
 * COMBIEN il en manque : le nombre de scènes traversées est une information de topologie.
 * Le tracé partiel ne porte donc qu'un seul bit de plus que les segments autorisés :
 * `partial: true`.
 */
export function sanitizeCableRoute(route, autoriseScene) {
  if (!routeIsDocumented(route)) return null;
  const permis = typeof autoriseScene === 'function' ? autoriseScene : () => false;
  const visibles = route.segments.filter(segment => permis(routeSceneRef(segment)) === true);
  if (visibles.length === route.segments.length) {
    // Rien n'est masqué : on rend le tracé tel quel, sans y ajouter de marqueur.
    const { partial, ...complet } = route;
    return complet;
  }
  // Plus rien de visible : le lecteur apprend qu'un tracé existe et lui échappe. Le dire
  // reste préférable au silence, qui se lirait « non renseigné » — c'est-à-dire faux.
  return { version: route.version, status: route.status, segments: visibles, partial: true };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * COMPARAISON
 * ───────────────────────────────────────────────────────────────────────────── */

const memePoint = (a, b) => a.x === b.x && a.y === b.y;

const memeSegment = (a, b) => a.sceneType === b.sceneType
  && String(a.sceneId ?? '') === String(b.sceneId ?? '')
  && a.naturalWidth === b.naturalWidth && a.naturalHeight === b.naturalHeight
  && a.waypoints.length === b.waypoints.length
  && a.waypoints.every((point, index) => memePoint(point, b.waypoints[index]))
  && a.anchors.length === b.anchors.length
  && a.anchors.every((ancre, index) => ancre.role === b.anchors[index].role && memePoint(ancre, b.anchors[index]));

/**
 * Ces deux tracés sont-ils LE MÊME ?
 *
 * Le serveur s'en sert pour la question décisive : l'écrivain a-t-il touché au tracé, ou
 * renvoie-t-il simplement la vue qu'on lui avait servie ? De la réponse dépend le droit
 * d'écraser — ou le devoir de préserver ce qu'il n'a jamais vu.
 *
 * L'ORDRE DES SEGMENTS COMPTE : c'est l'ordre du cheminement physique.
 */
export function sameCableRoute(a, b) {
  const gauche = a ?? null;
  const droite = b ?? null;
  if (gauche === null || droite === null) return gauche === droite;
  return gauche.version === droite.version
    && gauche.status === droite.status
    && routeIsPartial(gauche) === routeIsPartial(droite)
    && (gauche.segments?.length || 0) === (droite.segments?.length || 0)
    && (gauche.segments || []).every((segment, index) => memeSegment(segment, droite.segments[index]));
}

/** Les scènes qu'un tracé traverse — pour interroger l'autorisation une fois par scène. */
export function routeScenes(route) {
  const vues = new Set();
  const sortie = [];
  for (const segment of route?.segments || []) {
    const ref = routeSceneRef(segment);
    const cle = `${ref.sceneType}:${ref.sceneId ?? ''}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    sortie.push(ref);
  }
  return sortie;
}

export function normalizeCableRecord(source = {}) {
  /*
   * `routeAccess` N'EST PAS UN CHAMP DE L'ENREGISTREMENT.
   *
   * C'est une RÉPONSE que le serveur calcule à chaque envoi — « cet utilisateur-ci peut-il
   * modifier ce tracé ? » — et que la synchronisation dépose sur la copie locale. Deux
   * raisons de l'écarter ici, à la source de la forme canonique : persistée, elle figerait
   * le verdict d'UN lecteur dans un enregistrement lu par tous ; et un client qui se
   * l'accorderait déverrouillerait son propre écran. Le serveur la retire déjà à l'entrée ;
   * la retirer AUSSI ici rend l'invariant vrai partout, pas seulement sur son chemin.
   */
  const { routeAccess: capaciteServie, ...reste } = source;
  source = reste;
  const sourceType = endpointType(source, 'source');
  const destinationType = endpointType(source, 'destination');
  const category = CABLE_TYPE_DEFINITIONS[source.category] ? source.category : text(source.category, 100);
  const type = text(source.type, 100);
  const definition = cableTypeDefinition(category, type);
  const pathRole = PATH_ROLES.includes(text(source.pathRole, 30).toUpperCase()) ? text(source.pathRole, 30).toUpperCase() : 'OTHER';
  const signalMode = text(source.signalMode || 'DIRECT', 30).toUpperCase();
  return {
    ...source,
    id:source.id || `CAB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reference:text(source.reference || source.id, 160),
    category,
    type,
    sourceType,
    sourceId:endpointId(source, 'source', sourceType),
    sourceParentEquipmentId:source.sourceParentEquipmentId ?? (sourceType === 'component' ? source.sourceEquipmentId : null),
    sourcePortId:source.sourcePortId ?? null,
    destinationType,
    destinationId:endpointId(source, 'destination', destinationType),
    destinationParentEquipmentId:source.destinationParentEquipmentId ?? (destinationType === 'component' ? source.destinationEquipmentId : null),
    destinationPortId:source.destinationPortId ?? null,
    signalDomains:unique(source.signalDomains?.length ? source.signalDomains : definition?.signalDomains || []),
    protocols:unique(source.protocols?.length ? source.protocols : definition?.protocols || []),
    formats:unique(source.formats || []),
    formatCapabilities:unique(source.formatCapabilities?.length ? source.formatCapabilities : definition?.formats || []),
    pathRole,
    signalMode,
    diagramColor:text(source.diagramColor || PATH_ROLE_COLORS[pathRole] || definition?.diagramColor, 30),
    physicalColor:text(source.physicalColor, 80),
    status:text(source.status || 'Connecté', 60),
    verificationStatus:VERIFICATION_STATUSES.includes(source.verificationStatus) ? source.verificationStatus : 'to-confirm',
    notes:text(source.notes, 2000),
    /*
     * LE TRACÉ EST UN SOUS-OBJET FORMEL — il ne survit pas « par chance » au `...source`.
     *
     * Dépendre de l'étalement pour conserver un champ, c'est lui donner une existence que
     * rien ne défend : la première normalisation qui listerait ses clés l'effacerait sans
     * qu'aucune épreuve ne tombe. Il est donc nommé, validé, et rendu sous sa forme
     * canonique — ou `null`. Un tracé MALFORMÉ ne devient jamais un tracé valide ici :
     * `validateCableShape` le signale et le serveur refuse l'écriture entière.
     */
    route:validateCableRoute(source.route).value
  };
}

export function cableAllowsReverse(record = {}) {
  return ['BIDIRECTIONAL', 'MANUAL_PATCH', 'PHYSICAL_ONLY'].includes(normalizeCableRecord(record).signalMode);
}

export function isCableActive(record = {}) {
  if (record?.integrityState === 'quarantined') return false;
  return !['réserve', 'reserve', 'déconnecté', 'deconnecte', 'disconnected', 'retiré', 'retire', 'retired']
    .includes(String(record?.status || '').trim().toLowerCase());
}

const CABLE_SIDES = Object.freeze(['source', 'destination']);

/**
 * Références physiques des deux extrémités d'un câble.
 * Un connecteur `component` n'a pas de localisation propre : c'est son équipement
 * parent qui la porte, donc c'est lui qui est retourné.
 */
export function cableEndpointRefs(record = {}) {
  const value = normalizeCableRecord(record);
  return CABLE_SIDES.map(side => {
    const type = value[`${side}Type`];
    if (type === 'component') {
      const parentId = value[`${side}ParentEquipmentId`];
      return parentId == null || parentId === '' ? null : { side, type:'equipment', id:parentId };
    }
    const id = value[`${side}Id`];
    return id == null || id === '' ? null : { side, type, id };
  }).filter(Boolean);
}

/**
 * Salles réellement touchées par un câble, déduites de ses extrémités.
 *
 * `cable.roomId` est un cache écrit une seule fois, depuis la salle de la source, au
 * moment de la création. Rien ne le met à jour lorsque l'équipement change de salle,
 * et un câble inter-salles — un départ STC vers la Régie Finale, cas courant — ne peut
 * de toute façon pas tenir dans un champ scalaire. Il ne doit donc jamais décider seul
 * d'une suppression ni d'une autorisation : la salle d'un câble se déduit de ses bouts.
 *
 * Le champ stocké ne sert plus que de repli, et uniquement quand AUCUNE extrémité n'est
 * résolvable — câble hérité ou extrémités déjà supprimées : sans ce repli, un tel câble
 * n'appartiendrait à aucune salle et deviendrait invisible.
 */
export function cableRoomIds(record = {}, { equipments = [], screens = [] } = {}) {
  const listsByType = { equipment:equipments || [], screen:screens || [] };
  const rooms = [];
  const seen = new Set();
  let anyEndpointResolved = false;
  const push = roomId => {
    if (roomId == null || roomId === '') return;
    const key = String(roomId);
    if (seen.has(key)) return;
    seen.add(key);
    rooms.push(roomId);
  };
  for (const ref of cableEndpointRefs(record)) {
    const entity = (listsByType[ref.type] || []).find(item => String(item?.id) === String(ref.id));
    if (!entity) continue;
    anyEndpointResolved = true;
    push(entity.roomId);
  }
  if (!anyEndpointResolved) push(record?.roomId);
  return rooms;
}

export function cableTouchesRoom(record = {}, roomId, context = {}) {
  if (roomId == null || roomId === '') return false;
  return cableRoomIds(record, context).some(value => String(value) === String(roomId));
}

/**
 * Valeur à écrire dans le cache `cable.roomId`. Retourne la salle de la source quand
 * elle est connue, sinon celle de la destination : un câble dont seule la destination
 * est localisée reste rattaché à une salle au lieu de n'appartenir à aucune.
 */
export function primaryCableRoomId(record = {}, context = {}) {
  const rooms = cableRoomIds(record, context);
  return rooms.length ? rooms[0] : null;
}

export function validateSignalModeForPorts(cableValue = {}, sourcePort, destinationPort) {
  const cableRecord = normalizeCableRecord(cableValue);
  if (cableRecord.signalMode !== 'BIDIRECTIONAL') return [];
  const canReverseAt = portValue => portCanSource(portValue) && portCanDestination(portValue);
  return canReverseAt(sourcePort) && canReverseAt(destinationPort)
    ? []
    : ['Le mode BIDIRECTIONAL exige deux ports réellement bidirectionnels ou de brassage; des ports fixes IN/OUT ne peuvent pas être inversés.'];
}

function intersects(left, right) {
  const rightSet = new Set(right || []);
  return (left || []).some(value => rightSet.has(value));
}

function known(values) {
  return (values || []).filter(value => value && value !== 'UNKNOWN');
}

function connectorAssessment(portValue, cableDefinition) {
  const connectors = known(portValue.connectorTypes);
  const cableConnectors = known(cableDefinition?.connectors || []);
  if (!connectors.length || !cableConnectors.length) return { status:'unknown' };
  if (intersects(connectors, cableConnectors)) return { status:'direct' };
  if (connectors.includes('SFP_CAGE') && cableConnectors.some(value => ['LC', 'SC', 'MPO'].includes(value))) {
    return { status:'transceiver-required', reason:'Le module SFP/transceiver et son connecteur fibre doivent être documentés.' };
  }
  return { status:'incompatible', reason:`Connectique ${connectors.join('/')} incompatible avec ${cableConnectors.join('/')}.` };
}

export function evaluateConnection({ sourcePort, destinationPort, cable: cableValue } = {}) {
  const source = sourcePort ? normalizePort(sourcePort, 0) : null;
  const destination = destinationPort ? normalizePort(destinationPort, 1) : null;
  const cableRecord = normalizeCableRecord(cableValue || {});
  const definition = cableTypeDefinition(cableRecord.category, cableRecord.type);
  const reasons = [];
  const suggestions = [];
  let status = 'compatible';

  if (!source || !destination) return { status:'to-confirm', direct:false, reasons:['Les deux ports doivent être résolus.'], suggestions:[] };
  if (!portCanSource(source)) reasons.push("Le port source n'est pas une sortie ni un point de brassage autorisé.");
  if (!portCanDestination(destination)) reasons.push("Le port destination n'est pas une entrée ni un point de brassage autorisé.");
  if (!definition) reasons.push('Le type de câble ne possède pas encore de définition de compatibilité validée.');
  if (reasons.some(reason => /source|destination/.test(reason))) status = 'incompatible';

  if (definition) {
    for (const [side, portValue] of [['source', source], ['destination', destination]]) {
      const assessment = connectorAssessment(portValue, definition);
      if (assessment.status === 'incompatible') { status = 'incompatible'; reasons.push(`${side === 'source' ? 'Source' : 'Destination'}: ${assessment.reason}`); }
      if (assessment.status === 'adapter' && status !== 'incompatible') { status = 'requires-adapter'; reasons.push(assessment.reason); suggestions.push('Documenter le transceiver/adaptateur comme composant intermédiaire.'); }
      if (assessment.status === 'transceiver-required' && status === 'compatible') {
        status = 'to-confirm'; reasons.push(assessment.reason); suggestions.push('Renseigner le transceiver installé et le connecteur réel (LC/SC/MPO).');
      }
      if (assessment.status === 'unknown' && status === 'compatible') status = 'to-confirm';
    }

    const domains = [known(source.signalDomains), known(destination.signalDomains), known(definition.signalDomains)];
    if (domains.every(values => values.length) && (!intersects(domains[0], domains[1]) || !intersects(domains[0], domains[2]) || !intersects(domains[1], domains[2]))) {
      status = 'incompatible'; reasons.push('Les domaines de signal des deux ports et du câble ne sont pas compatibles.');
    }

    const protocols = [known(source.protocols), known(destination.protocols), known(definition.protocols)];
    if (protocols[0].length && protocols[1].length && !intersects(protocols[0], protocols[1])) {
      if (status !== 'incompatible') {
        status = 'requires-converter'; reasons.push('Les protocoles source et destination diffèrent. Un équipement de conversion actif est requis.');
        suggestions.push('Ajouter un convertisseur ou une interface I/O comme équipement intermédiaire.');
      }
    } else if (status !== 'incompatible' && protocols.every(values => values.length) && (!intersects(protocols[0], protocols[2]) || !intersects(protocols[1], protocols[2]))) {
      status = 'incompatible'; reasons.push("Le câble ne transporte pas le protocole documenté par les ports.");
    }

    if (source.formats.length && destination.formats.length && !intersects(source.formats, destination.formats) && status !== 'incompatible') {
      status = 'requires-converter'; reasons.push('Les formats documentés ne se recoupent pas. Une conversion ou configuration intermédiaire est requise.');
      suggestions.push('Vérifier le format actif et documenter le frame-sync/convertisseur éventuel.');
    } else if ((!source.formats.length || !destination.formats.length) && source.formatCapabilities.length && destination.formatCapabilities.length && status === 'compatible') {
      status = 'to-confirm'; reasons.push("Le format actif n'est pas documenté sur les deux extrémités; une compatibilité de capacité ne suffit pas.");
    }

    if (definition.ambiguousConnector && status === 'compatible') {
      status = 'to-confirm'; reasons.push('Ce libellé peut utiliser plusieurs connecteurs physiques; préciser les deux extrémités réelles.');
    }
  }

  return { status, direct:status === 'compatible', reasons:[...new Set(reasons)], suggestions:[...new Set(suggestions)] };
}

export function validatePortCollection(ports, { ownerLabel = "l'équipement" } = {}) {
  const errors = [];
  const normalized = normalizePorts(ports);
  const ids = new Set(); const numbers = new Set();
  for (const portValue of normalized) {
    if (!portValue.id || ids.has(String(portValue.id))) errors.push(`Identifiant de port dupliqué dans ${ownerLabel}.`);
    ids.add(String(portValue.id));
    const numberKey = portValue.number.toLocaleLowerCase('fr-FR');
    if (!portValue.number) errors.push(`Un port de ${ownerLabel} ne possède pas de numéro.`);
    if (numberKey && numbers.has(numberKey)) errors.push(`Le port « ${portValue.number} » est dupliqué dans ${ownerLabel}.`);
    numbers.add(numberKey);
    if (!PORT_DIRECTIONS.includes(portValue.direction)) errors.push(`Direction invalide pour le port « ${portValue.number} ».`);
    if (!PORT_BEHAVIOR_IDS.includes(portValue.behavior)) errors.push(`Comportement invalide pour le port « ${portValue.number} ».`);
  }
  return { value:normalized, errors };
}

export function validateEquipmentConnectivity(record = {}) {
  const errors = [];
  const root = validatePortCollection(record.ports, { ownerLabel:"l'équipement" });
  errors.push(...root.errors);
  const componentIds = new Set(); const allPortIds = new Set(root.value.map(item => String(item.id)));
  const components = (Array.isArray(record.components) ? record.components : []).map((component, index) => {
    const id = component.id || `COMP-${Date.now()}-${index}`;
    if (componentIds.has(String(id))) errors.push(`Identifiant de composant dupliqué: ${id}.`);
    componentIds.add(String(id));
    const checked = validatePortCollection(component.ports, { ownerLabel:`le composant « ${component.name || id} »` });
    errors.push(...checked.errors);
    for (const portValue of checked.value) {
      if (allPortIds.has(String(portValue.id))) errors.push(`Identifiant de port dupliqué dans la composition interne: ${portValue.id}.`);
      allPortIds.add(String(portValue.id));
    }
    return { ...component, id, ports:checked.value };
  });
  for (const component of components) {
    if (component.parentComponentId && !componentIds.has(String(component.parentComponentId))) errors.push(`Le parent interne du composant « ${component.name || component.id} » est introuvable.`);
    if (String(component.parentComponentId || '') === String(component.id)) errors.push(`Un composant ne peut pas être son propre parent: ${component.id}.`);
  }
  return { value:{ ...record, ports:root.value, components, connectivityVersion:1 }, errors:[...new Set(errors)] };
}

export function validateScreenConnectivity(record = {}) {
  const checked = validatePortCollection(record.ports, { ownerLabel:"l'écran" });
  return { value:{ ...record, ports:checked.value, connectivityVersion:1 }, errors:checked.errors };
}

export function validateCableShape(record = {}) {
  const value = normalizeCableRecord(record);
  const errors = [];
  if (!value.reference) errors.push('La référence du câble est obligatoire.');
  if (!cableTypeDefinition(value.category, value.type)) errors.push('Le type de câble est inconnu ou ne correspond pas à sa catégorie.');
  if (!ENDPOINT_TYPES.includes(value.sourceType) || value.sourceId == null || value.sourceId === '') errors.push('La source du câble est invalide.');
  if (!ENDPOINT_TYPES.includes(value.destinationType) || value.destinationId == null || value.destinationId === '') errors.push('La destination du câble est invalide.');
  if (!value.sourcePortId) errors.push('Le port source est obligatoire.');
  if (!value.destinationPortId) errors.push('Le port destination est obligatoire.');
  if (!SIGNAL_MODES.includes(value.signalMode)) errors.push('Le mode du signal est invalide.');
  if (value.sourceType === 'component' && !value.sourceParentEquipmentId) errors.push("L'équipement parent du composant source est obligatoire.");
  if (value.destinationType === 'component' && !value.destinationParentEquipmentId) errors.push("L'équipement parent du composant destination est obligatoire.");
  if (value.sourceType === value.destinationType && String(value.sourceId) === String(value.destinationId) && String(value.sourcePortId) === String(value.destinationPortId)) errors.push('Un câble ne peut pas relier un port à lui-même.');
  /*
   * Le tracé est validé sur la donnée BRUTE, pas sur `value` : `normalizeCableRecord` a
   * déjà rendu `null` pour un tracé invalide, et valider sa sortie reviendrait à déclarer
   * conforme ce qu'on vient d'écarter. Une géométrie corrompue doit faire ÉCHOUER
   * l'écriture, jamais disparaître en silence.
   */
  const trace = validateCableRoute(record?.route);
  for (const erreur of trace.errors) errors.push(`Tracé : ${erreur}`);
  return { value, errors };
}

export const CONNECTIVITY_VERSION = 1;
