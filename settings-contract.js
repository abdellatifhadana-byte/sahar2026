import { db } from './db.js';

export const PLATFORM_SETTINGS_ID = 'global';
export const DEFAULT_PLATFORM_SETTINGS = Object.freeze({
  id: PLATFORM_SETTINGS_ID,
  theme: 'light',
  language: 'fr',
  backupFrequency: 'weekly',
  autoLogout: 30,
  notifications: true,
  mapImageUrl: 'assets/plan-technique.PNG',
  mapImageWidth: null,
  mapImageHeight: null,
  settingsVersion: 2
});

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const timestamp = value => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

function normalizeSettings(source = {}) {
  const normalized = {
    ...clone(DEFAULT_PLATFORM_SETTINGS),
    ...source,
    id: PLATFORM_SETTINGS_ID,
    language: 'fr',
    settingsVersion: 2
  };
  normalized.autoLogout = Math.max(0, Math.min(240, Number(normalized.autoLogout) || 0));
  normalized.notifications = normalized.notifications !== false;
  normalized.theme = normalized.theme === 'dark' ? 'dark' : 'light';
  normalized.backupFrequency = ['daily', 'weekly', 'monthly'].includes(normalized.backupFrequency)
    ? normalized.backupFrequency
    : 'weekly';
  normalized.mapImageUrl = String(normalized.mapImageUrl || DEFAULT_PLATFORM_SETTINGS.mapImageUrl);
  normalized.mapImageWidth = Number.isFinite(Number(normalized.mapImageWidth)) && Number(normalized.mapImageWidth) > 0
    ? Number(normalized.mapImageWidth)
    : null;
  normalized.mapImageHeight = Number.isFinite(Number(normalized.mapImageHeight)) && Number(normalized.mapImageHeight) > 0
    ? Number(normalized.mapImageHeight)
    : null;
  return normalized;
}

function chooseBestSettings(records = []) {
  const candidates = records.filter(record => record && ['1', PLATFORM_SETTINGS_ID].includes(String(record.id)));
  if (!candidates.length) return normalizeSettings();
  candidates.sort((left, right) => {
    const rightUpdated = timestamp(right.updatedAt || right.createdAt);
    const leftUpdated = timestamp(left.updatedAt || left.createdAt);
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
    if (String(right.id) === PLATFORM_SETTINGS_ID && String(left.id) !== PLATFORM_SETTINGS_ID) return 1;
    if (String(left.id) === PLATFORM_SETTINGS_ID && String(right.id) !== PLATFORM_SETTINGS_ID) return -1;
    return 0;
  });
  return normalizeSettings(candidates[0]);
}

/**
 * LIRE LES PARAMÈTRES CANONIQUES — SANS RIEN ÉCRIRE.
 *
 * Cette fonction s'appelait déjà à chaque démarrage, pour TOUS les rôles (`core.js`). Elle
 * y consolidait les enregistrements hérités et PERSISTAIT le résultat. Or l'écriture de
 * `settings/global` est réservée à l'administrateur : le serveur la refuse, et il a raison
 * de le faire.
 *
 * Mesuré au navigateur, sur les cinq rôles non-admin, dès que la consolidation avait
 * quelque chose à consolider — un `settings/1` hérité, ou un magasin local vidé :
 *
 *     PUT /api/data/settings/global → 403 « Action non autorisée pour ce rôle. »
 *     syncQueue : une entrée `failed` par session
 *     et surtout : la LECTURE ELLE-MÊME échouait, car le refus remonte jusqu'à l'appelant.
 *
 * Un rôle sans droit d'écriture ne pouvait donc plus lire ses propres paramètres. Le
 * défaut n'était pas le refus du serveur ; c'était qu'une lecture prétende écrire.
 *
 * La consolidation reste EXACTEMENT la même — `chooseBestSettings()` continue de préférer
 * l'enregistrement le plus récent entre `settings/1` et `settings/global`. Ce qui change,
 * c'est qu'elle ne se persiste plus toute seule : elle produit une vue, en mémoire, que
 * tous les rôles obtiennent sans rien muter.
 */
export async function ensureCanonicalSettings() {
  const records = await db.getAll('settings').catch(() => []);
  return chooseBestSettings(records);
}

export async function getPlatformSettings() {
  return normalizeSettings(await ensureCanonicalSettings());
}

/**
 * Écrire les paramètres — le seul chemin qui persiste, et il est déjà réservé.
 *
 * C'est ici, et nulle part ailleurs, que la consolidation devient durable : sous l'autorité
 * qui portait déjà le droit d'écrire. L'écran des paramètres est administrateur ; le
 * serveur reste fail-closed pour tout le reste. Aucun nouvel écrivain de fond n'est créé —
 * le ménage des enregistrements hérités se fait au moment où quelqu'un enregistre vraiment.
 */
export async function savePlatformSettings(patch = {}) {
  const records = await db.getAll('settings').catch(() => []);
  const current = normalizeSettings(chooseBestSettings(records));
  /*
   * LA RÉVISION DÉCLARÉE RESTE CELLE QUE L'APPELANT AVAIT SOUS LES YEUX.
   *
   * On a été tenté de la remplacer par celle de la projection fraîchement relue, pour
   * corriger #120. C'EST UN PIÈGE, et il a été mesuré : la projection est rafraîchie toute
   * seule par l'instantané central toutes les vingt secondes, tandis que l'écran, lui,
   * garde ses valeurs depuis son ouverture. La projection est donc EN AVANCE sur l'écran,
   * pas en retard. Prendre sa révision revenait à déclarer avoir vu une version qu'on n'a
   * jamais regardée — et un deuxième administrateur écrasait alors en silence le travail du
   * premier, sans le moindre 409. Le contrat de révision existe exactement pour l'empêcher.
   *
   * La révision voyage donc dans `patch` quand l'appelant en porte une : c'est sa
   * déclaration, et elle l'engage. #120 se corrige à l'autre bout — en lui RENDANT, après
   * son propre enregistrement, la fiche telle qu'elle est devenue.
   */
  const next = normalizeSettings({
    ...current,
    ...patch,
    id: PLATFORM_SETTINGS_ID,
    updatedAt: new Date().toISOString()
  });
  /*
   * LA SOURCE DU PLAN N'EST ENVOYÉE QUE SI L'APPELANT LA DÉCLARE.
   *
   * Depuis #131 le serveur retire `mapImageUrl` de l'instantané : la projection locale ne
   * la porte plus, et `normalizeSettings` lui substitue alors le désignateur PAR DÉFAUT —
   * ce qui est juste pour une LECTURE (« le plan livré avec la plateforme »), et faux pour
   * une écriture. Enregistrer le thème aurait remplacé un plan téléversé, ou une URL
   * distante configurée, par le plan intégré. Sans message, et sans retour possible.
   *
   * Le champ ne part donc que lorsqu'il figure explicitement dans `patch` — c'est-à-dire
   * quand l'administrateur vient d'agir sur le plan. Autrement il est omis, et le serveur
   * conserve ce qu'il détient. Les dimensions suivent la même source : les envoyer sans
   * elle décrirait une image qu'on ne fournit pas.
   */
  if (!Object.prototype.hasOwnProperty.call(patch, 'mapImageUrl')) {
    delete next.mapImageUrl;
    delete next.mapImageWidth;
    delete next.mapImageHeight;
  }
  await db.save('settings', next);
  /*
   * L'héritier n'est retiré qu'APRÈS une écriture canonique réussie : si la ligne
   * précédente a échoué, `settings/1` reste la seule copie des valeurs de l'exploitant et
   * la supprimer les perdrait.
   */
  const legacy = records.find(record => String(record?.id) === '1');
  if (legacy && typeof db.delete === 'function') {
    try { await db.delete('settings', legacy.id); } catch (error) { console.warn('Retrait des paramètres hérités différé.', error); }
  }
  /*
   * On rend la fiche TELLE QU'ELLE EST APRÈS L'ÉCRITURE, avec la révision que le serveur
   * vient d'accorder. L'écran range cette valeur dans sa copie mémoire : son enregistrement
   * suivant déclare donc une version à jour au lieu de répéter celle de son ouverture.
   */
  const range = await db.get('settings', PLATFORM_SETTINGS_ID).catch(() => null);
  const abouti = range ? normalizeSettings(range) : next;
  window.dispatchEvent?.(new CustomEvent('platform-settings-updated', { detail:{ settings:clone(abouti) } }));
  return abouti;
}

export function platformSettingsDefaults() {
  return clone(DEFAULT_PLATFORM_SETTINGS);
}

export { normalizeSettings };
