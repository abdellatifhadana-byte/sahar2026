import { normalizeRole } from './roles.js';

export const NAVIGATION_CONTRACT_VERSION = 1;

// Les sections ne sont pas déclarées ici : elles s'enregistrent en couches, chaque module
// ajoutant la sienne au registre de l'interface. Cette liste doit donc REFLÉTER ce registre,
// pas prétendre le définir. `tests/navigation-sections.test.js` extrait les sections
// réellement enregistrées et échoue si les deux divergent.
const ROLE_ROUTES = Object.freeze({
  // 19 sections : les 11 de `AdminUI.initSections`, plus celles ajoutées par
  // broadcast-ports-cables (cables), signal-flow (signalFlow), integrity-center (integrity),
  // operations-suite (exploitation), equipment-knowledge (knowledge),
  // diagram-studio (diagrams), continuity-center (continuity), zone-access (zoneAccess).
  // `procedures` (procedures-center.js) rejoint « Ingénierie » aux côtés de `diagrams` :
  // navigation-groups.js lui réservait déjà sa place. Elle est ouverte aux rôles auxquels
  // `permissions.js` accorde `continuity {view}` — la section lit les mêmes documents.
  admin:Object.freeze(['dashboard','exploitation','screensDiagnostic','walls','devices','cables','locations','salles','baies','users','reports','tickets','logs','signalFlow','continuity','diagrams','procedures','knowledge','integrity','settings','zoneAccess']),
  // `logs` retiré : la matrice donne au technicien logs {view:false, export:false,
  // clear:false}, mais la route l'exposait, et logsSection.js ne contient aucun contrôle
  // de permission — un technicien atteignait donc le Journal avec Exporter, Importer
  // et Vider.
  technician:Object.freeze(['dashboard','devices','salles','baies','tickets','maintenance','notifications','screens']),
  // `users` retiré : zone-access-integration.js supprime `sections.users` du responsable,
  // qui ne gère plus les comptes globaux mais seulement les accès de ses zones. Le contrat
  // l'accordait encore. `walls` (sous permission) et `zoneAccess` étaient à l'inverse
  // fournis sans être déclarés.
  //
  // QUATRE SECTIONS DE PLUS, QUI ÉTAIENT DÉJÀ À L'ÉCRAN.
  //
  // Mesuré dans le navigateur sur un compte responsable : le menu affiche onze entrées, dont
  // `exploitation` (operations-suite.js), `continuity` (continuity-center.js), `diagrams`
  // (diagram-studio.js) et `screensDiagnostic` (compat-integrations.js) — quatre sections que
  // ces modules posent sur `ResponsibleUI` après coup, et que ce contrat ne déclarait pas.
  //
  // Ce n'est PAS un élargissement : `permissions.js` accorde déjà au responsable
  // `continuity {view}`, `diagrams {view}` et `screens {diagnose}`, et
  // `role-navigation-integration.js` route sur le registre vivant, si bien que ces pages
  // s'ouvrent aujourd'hui. C'est le piège que ce fichier décrit lui-même en tête : un
  // appelant qui fait confiance au contrat — et non au registre — refusait une page que
  // l'utilisateur atteint par le menu. Le contrat REFLÈTE le registre, il ne le définit pas.
  responsible:Object.freeze(['exploitation','devices','salles','walls','baies','screensDiagnostic','continuity','diagrams','procedures','reports','tickets','zoneAccess']),
  // MANAGER — « peut tout voir de ce qui concerne la chaîne ». Il partage donc les
  // sections de l'administrateur, à l'exception de `settings` : configurer la plateforme
  // est un acte d'exploitation, réservé à l'administrateur des variables Railway.
  // Auparavant `manager` était un ALIAS d'`admin` et recevait `settings` avec le reste.
  manager:Object.freeze(['dashboard','exploitation','screensDiagnostic','walls','devices','cables','locations','salles','baies','users','reports','tickets','logs','signalFlow','continuity','diagrams','procedures','knowledge','integrity','zoneAccess']),
  // CHEF — celui qui valide. Il encadre responsable, technicien et visiteur, et garde donc
  // les comptes, les rapports et les objets qui se valident (continuité, schémas).
  // `integrity` et `zoneAccess` restent au-dessus de lui.
  chef:Object.freeze(['dashboard','exploitation','screensDiagnostic','walls','devices','cables','locations','salles','baies','users','reports','tickets','logs','signalFlow','continuity','diagrams','procedures','knowledge']),
  visitor:Object.freeze(['home','map','requests'])
});

const ROLE_DEFAULTS = Object.freeze({ admin:'dashboard', manager:'dashboard', chef:'dashboard', technician:'dashboard', responsible:'devices', visitor:'home' });


// Les mêmes raccourcis d'URL doivent fonctionner pour les rôles qui partagent l'écran de
// l'administrateur : sans cela, un lien `#/signal-flow` valide pour l'admin tombait en
// section inconnue pour un manager.
const RACCOURCIS_ADMIN = Object.freeze({ 'signal-flow':'signalFlow', signalflow:'signalFlow', screens:'screensDiagnostic' });
const SECTION_ALIASES = Object.freeze({
  admin:RACCOURCIS_ADMIN, manager:RACCOURCIS_ADMIN, chef:RACCOURCIS_ADMIN
});

const text = value => String(value ?? '').trim();
const decode = value => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/**
 * LA MÊME résolution que partout ailleurs.
 *
 * Ce fichier portait sa PROPRE carte d'alias, et il lui manquait `technicien` — le libellé
 * français que la plateforme affiche pourtant elle-même (`ROLE_LABELS`). Mesuré : un compte
 * enregistré « technicien » était rendu `visitor` ici, `technician` par `roles.js`, et
 * n'avait aucun plafond côté serveur. Trois couches, trois réponses.
 *
 * `manager` reste un rôle à part entière et non un alias d'`admin` : l'alias lui donnait
 * silencieusement l'écran complet, `settings` compris. C'est `roles.js` qui porte
 * désormais cette distinction, pour tout le monde à la fois.
 */
export function normalizeNavigationRole(role) {
  return normalizeRole(role);
}

export function normalizeNavigationSection(role, section) {
  const normalizedRole = normalizeNavigationRole(role);
  const raw = text(section);
  return SECTION_ALIASES[normalizedRole]?.[raw] || SECTION_ALIASES[normalizedRole]?.[raw.toLowerCase()] || raw;
}

export function allowedSectionsForRole(role) {
  return ROLE_ROUTES[normalizeNavigationRole(role)] || ROLE_ROUTES.visitor;
}

export function defaultSectionForRole(role) {
  return ROLE_DEFAULTS[normalizeNavigationRole(role)] || 'home';
}

export function parseHashRoute(hash = '', { role = 'visitor', allowedSections = null, defaultSection = null } = {}) {
  const normalizedRole = normalizeNavigationRole(role);
  const allowed = new Set(allowedSections || allowedSectionsForRole(normalizedRole));
  const fallback = normalizeNavigationSection(normalizedRole, defaultSection || defaultSectionForRole(normalizedRole));
  const raw = text(hash).replace(/^#\/?/, '');
  const [rawPath = '', rawQuery = ''] = raw.split('?');
  const segments = rawPath.split('/').filter(Boolean).map(decode);
  let section = normalizeNavigationSection(normalizedRole, segments[0] || fallback);

  // Un ancien lien technicien /screens/issues/<id> devient le même détail écran
  // sans créer une seconde section parallèle.
  if (normalizedRole === 'technician' && section === 'screens' && segments[1] === 'issues') segments.splice(1, 1);
  if (!allowed.has(section)) section = fallback;

  const query = {};
  for (const [key, value] of new URLSearchParams(rawQuery).entries()) query[key] = value;
  return Object.freeze({
    role:normalizedRole,
    section,
    segments:Object.freeze(segments.slice(1)),
    entityId:segments[1] || null,
    query:Object.freeze(query),
    valid:allowed.has(section),
    canonicalHash:buildHashRoute({ section, segments:segments.slice(1), query })
  });
}

export function buildHashRoute({ section, segments = [], query = {} } = {}) {
  const path = [section, ...(Array.isArray(segments) ? segments : [])]
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(value => encodeURIComponent(String(value)))
    .join('/');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return `#/${path}${suffix ? `?${suffix}` : ''}`;
}

export function sectionFromHash(hash, options = {}) {
  return parseHashRoute(hash, options).section;
}

export function routeEquals(left, right) {
  const a = typeof left === 'string' ? left : left?.canonicalHash;
  const b = typeof right === 'string' ? right : right?.canonicalHash;
  return text(a) === text(b);
}
