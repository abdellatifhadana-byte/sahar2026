export function normalizeId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

// Une valeur illisible ne doit jamais atteindre une feuille de style : `left: NaN%`
// est ignoré par le navigateur et l'écran s'empile silencieusement à l'origine.
const clamp = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

export function normalizePosition(source = {}) {
  const p = source.position || source.layout || source;
  // Écrans hérités : la géométrie n'existait qu'en champs plats `positionX` / `positionY`.
  // Les lire ici évite qu'un tel écran soit placé en 0,0 faute de `position`.
  const x = p.x ?? source.positionX, y = p.y ?? source.positionY;
  const width = p.width ?? p.w ?? source.width, height = p.height ?? p.h ?? source.height;
  return {
    x: clamp(x, 0, 100, 0),
    y: clamp(y, 0, 100, 0),
    width: clamp(width, 1, 100, 20),
    height: clamp(height, 1, 100, 20),
    unit: '%'
  };
}

export function normalizeScreenStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['error','faulty','hs','offline','panne'].includes(value)) return 'error';
  if (['maintenance','maint'].includes(value)) return 'maintenance';
  return 'ok';
}

export function toCanonicalScreen(screen = {}, defaults = {}) {
  // L'écran entier, pas seulement `screen.position` : `normalizePosition` privilégie
  // la géométrie canonique et retombe sur les champs plats pour un écran hérité.
  const position = normalizePosition(screen);
  return {
    ...screen,
    id: normalizeId(screen.id) ?? `screen-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    name: screen.name || screen.nom || defaults.name || 'Écran',
    roomId: normalizeId(screen.roomId ?? defaults.roomId),
    wallId: normalizeId(screen.wallId ?? defaults.wallId),
    equipmentId: normalizeId(screen.equipmentId ?? screen.deviceLinked ?? defaults.equipmentId),
    status: normalizeScreenStatus(screen.status),
    position,
    // Miroir plat historique, sur lequel le plan de salle du Diagnostic écrans place ses
    // marqueurs. Il n'était écrit qu'à la création de l'écran — jamais lors d'un
    // déplacement ni d'un redimensionnement — donc le plan montrait indéfiniment l'écran
    // à sa position d'origine pendant que le mur affichait la nouvelle. Le recalculer ici
    // à partir de la géométrie canonique rend les deux impossibles à désynchroniser :
    // toute écriture d'écran passe par cette fonction.
    positionX: position.x,
    positionY: position.y,
    width: position.width,
    height: position.height,
    updatedAt: screen.updatedAt || new Date().toISOString()
  };
}

export function extractLegacyWallScreens(record = {}) {
  const wall = { ...record };
  const embedded = Array.isArray(wall.screens) ? wall.screens : [];
  delete wall.screens;
  wall.id = wall.id || `wall-${wall.roomId}`;
  wall.name = wall.name || wall.nom || 'Mur principal';
  delete wall.nom;
  wall.roomId = normalizeId(wall.roomId);
  wall.layout = wall.layout || {};
  const screens = embedded.map(screen => toCanonicalScreen(screen, { roomId: wall.roomId, wallId: wall.id }));
  return { wall, screens };
}

export function findOrphanReferences({ rooms = [], baies = [], equipments = [], walls = [], screens = [] } = {}) {
  const roomIds = new Set(rooms.map(x => String(x.id)));
  const baieIds = new Set(baies.map(x => String(x.id)));
  const equipmentIds = new Set(equipments.map(x => String(x.id)));
  const wallIds = new Set(walls.map(x => String(x.id)));
  return {
    baies: baies.filter(x => x.roomId != null && !roomIds.has(String(x.roomId))),
    equipments: equipments.filter(x => (x.roomId != null && !roomIds.has(String(x.roomId))) || (x.baieId != null && !baieIds.has(String(x.baieId)))),
    walls: walls.filter(x => x.roomId != null && !roomIds.has(String(x.roomId))),
    screens: screens.filter(x => (x.roomId != null && !roomIds.has(String(x.roomId))) || (x.wallId != null && !wallIds.has(String(x.wallId))) || (x.equipmentId != null && !equipmentIds.has(String(x.equipmentId))))
  };
}
