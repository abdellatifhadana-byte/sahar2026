import { db } from './db.js';
import { declareCatalogBuffered } from './record-ownership-contract.js';
import { BACKGROUND_DELIVERY, isPermanentSyncRejection } from './revision-contract.js';

export const CATALOG_SEED_GUARD_VERSION = 3;
export const CENTRAL_CATALOG_VERSION = 24;

const bufferedDocs = new Map();
const previousSave = db.save.bind(db);
const localOnlySave = typeof db.saveLocalOnly === 'function' ? db.saveLocalOnly.bind(db) : null;
let captureEnabled = true;
let centralSynced = false;
let installPromise = null;
let installTimer = null;
let releaseTimer = null;

const CATALOG_QUIET_WINDOW_MS = 1200;
const NON_ADMIN_CAPTURE_WINDOW_MS = 9000;
const seedOrigins = /(?:^|[-_])(seed|catalog|knowledge|evidence|coverage|bootstrap|migration|phase)(?:$|[-_])/i;
const seedIds = /^(?:kb-|gc-(?:in|out)-|grid-|gap-|field-|catalog-|routing-|regie-car-)/i;

function roleIsGlobalAdmin(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' || value === 'manager';
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem('auth') || 'null'); }
  catch { return null; }
}

function isAutomaticCatalogDoc(storeName, record) {
  if (storeName !== 'docs' || !record || typeof record !== 'object') return false;
  const id = String(record.id ?? record.targetId ?? '');
  const origin = String(record.origin ?? record.source ?? record.seedSource ?? '');
  const kind = String(record.kind ?? record.targetType ?? '');
  return seedIds.test(id) || seedOrigins.test(origin) || kind === 'equipment_catalog' || Boolean(record.seedVersion || record.catalogSeedVersion);
}

function cancelRelease() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
}

function releaseCaptureSoon(delay = 1800) {
  cancelRelease();
  releaseTimer = setTimeout(() => {
    captureEnabled = false;
    releaseTimer = null;
  }, delay);
}

function scheduleCatalogInstall(delay = CATALOG_QUIET_WINDOW_MS) {
  if (!centralSynced || !roleIsGlobalAdmin(currentUser()?.role)) return;
  if (installTimer) clearTimeout(installTimer);
  installTimer = setTimeout(() => {
    installTimer = null;
    installCentralCatalogOnce().finally(() => releaseCaptureSoon(2200));
  }, delay);
}

async function saveSeedLocally(record) {
  cancelRelease();
  const payload = { ...record, catalogSeedVersion:CENTRAL_CATALOG_VERSION };
  const id = localOnlySave ? await localOnlySave('docs', payload) : await previousSave('docs', payload);
  bufferedDocs.set(String(id), { ...payload, id });
  /*
   * LA RETENUE SE DÉCLARE, ELLE NE SE DEVINE PAS.
   *
   * `saveLocalOnly` contourne le réseau, ce qui n'est pas une déclaration de propriété : le
   * même appel sert ailleurs à écrire une fiche centrale sans la republier. Sans cette
   * ligne, l'instantané suivant effaçait la fiche — le serveur ne l'a pas encore — et onze
   * modules de réconciliation la ré-ensemençaient au signal `synced` suivant. Le cycle
   * complet recommençait toutes les vingt secondes, pour environ 450 documents.
   *
   * La retenue est TRANSITOIRE : `central-sync` la relâche dès que l'instantané porte la
   * fiche, et l'autorité revient au centre.
   */
  declareCatalogBuffered(id);

  // Certains modules complètent le catalogue après l'événement central-sync-status.
  // Chaque nouvelle fiche repousse donc l'installation jusqu'à une fenêtre calme.
  if (centralSynced) {
    if (roleIsGlobalAdmin(currentUser()?.role)) scheduleCatalogInstall();
    else releaseCaptureSoon(NON_ADMIN_CAPTURE_WINDOW_MS);
  }
  return id;
}

async function centralCatalogVersion() {
  const settings = await db.get('settings', 'global').catch(() => null);
  return Number(settings?.catalogSeedVersion || 0);
}

async function mirrorCentralVersion(version, installedAt = '') {
  const settings = await db.get('settings', 'global').catch(() => null) || { id:'global', language:'fr' };
  const payload = {
    ...settings,
    id:'global',
    language:'fr',
    catalogSeedVersion:version,
    catalogSeedUpdatedAt:installedAt || settings.catalogSeedUpdatedAt || new Date().toISOString()
  };
  if (localOnlySave) await localOnlySave('settings', payload);
}

async function refreshCentralMirror() {
  if (typeof db.enableCentralSync !== 'function') return;
  try { await db.enableCentralSync({ bootstrapLocal:false }); }
  catch (error) { console.warn('Catalogue installé, relecture centrale différée.', error); }
}

/**
 * Remettre sur la voie ordinaire ce que l'amorçage avait détourné.
 *
 * `previousSave` est `db.save` TEL QU'IL ÉTAIT avant que ce garde ne l'enveloppe :
 * `central-sync.js` est chargé avant nous (`index.html`), donc cette voie pousse bel et
 * bien vers le serveur, avec la comparaison de révision habituelle.
 *
 * ELLE PART SOUS LE JETON `BACKGROUND_DELIVERY`, ET C'EST TOUT LE PROPOS.
 *
 * Ces fiches n'ont pas d'auteur humain : ce sont des enrichissements de catalogue calculés
 * par des producteurs idempotents, retenus pendant l'amorçage, que PERSONNE n'a demandés et
 * que personne ne regarde partir. Sans le jeton, un refus définitif inscrivait dans la file
 * de l'utilisateur une entrée `conflict` TERMINALE — mesuré sur `fae6538`, navigateur réel
 * contre PostgreSQL réel :
 *
 *     PUT /api/data/docs/kb-aja-ogfsmini → 409 · charge rév. 1 · centre rév. 2
 *     syncQueue : status=conflict lastErrorCode=STALE_WRITE — survit à deux instantanés
 *     central-sync-status : state:'conflict' ×2
 *
 * Un conflit que l'utilisateur n'a pas créé, et qu'aucun geste de sa part ne résout : le
 * contenu périmé n'est plus nulle part, la fiche fraîche est déjà au centre. La pastille
 * rougissait donc pour rien, et à côté d'un VRAI conflit humain, indiscernable de lui.
 *
 * Le jeton dit d'avance qui reprend : NOUS. Une charge périmée quitte le tampon (voir plus
 * bas), un incident passager l'y laisse, et le producteur recalculera depuis la vérité
 * fraîche au `synced` suivant. Le 409 de l'UTILISATEUR, lui, ne passe jamais par ici — le
 * détournement est réservé aux fiches de catalogue automatiques, pendant la seule fenêtre
 * d'amorçage — et reste porté par la file, intact.
 */
/**
 * RETIRER DU TAMPON CE QUI A ÉTÉ ACQUITTÉ — ET RIEN D'AUTRE.
 *
 * Effacer par IDENTIFIANT après une attente réseau perd une modification légitime : pendant
 * l'envoi, un producteur peut écrire une version PLUS RÉCENTE de la même fiche, et
 * `saveSeedLocally` remplace alors l'entrée par un objet neuf. Un `delete(id)` aveugle
 * efface cette version-là, qui n'a jamais été envoyée ni acceptée. Une donnée disparaît en
 * silence — plus grave qu'une requête de trop.
 *
 * L'identité de l'objet tranche sans ambiguïté : `saveSeedLocally` pose un objet NEUF à
 * chaque écriture, donc l'entrée courante n'est celle qu'on a envoyée que si c'est
 * littéralement le même objet. Comparer les contenus serait une devinette ; comparer les
 * références est une certitude.
 */
function retirerSiInchange(id, envoye) {
  if (bufferedDocs.get(String(id)) === envoye) {
    bufferedDocs.delete(String(id));
    return true;
  }
  return false;
}

async function livrerParLaVoieOrdinaire(records) {
  const livrees = [];
  for (const record of records) {
    try {
      await previousSave('docs', record, BACKGROUND_DELIVERY);
      retirerSiInchange(record?.id, record);
      livrees.push(String(record.id));
    } catch (error) {
      /*
       * UN ENRICHISSEMENT AUTOMATIQUE PÉRIMÉ CÈDE — IL NE S'INSTALLE PAS EN CONFLIT.
       *
       * Un refus DÉFINITIF (409 STALE_WRITE, par exemple) dit que le centre possède une
       * vérité plus récente que celle sur laquelle cette charge a été calculée. La rejouer
       * produirait le même refus à chaque battement : un conflit automatique perpétuel, né
       * d'un ensemencement de fond, que l'utilisateur n'a pas demandé et ne peut pas
       * résoudre. Elle quitte donc le tampon.
       *
       * Rien n'est perdu pour autant : les producteurs sont idempotents et repassent à
       * chaque `synced`. S'il est encore pertinent, l'enrichissement sera RECALCULÉ depuis
       * la vérité fraîche, et c'est cette version-là qui partira.
       *
       * Un incident PASSAGER — coupure, 503, 429 — ne dit rien du contenu : la charge reste
       * valable, donc elle reste due. `isPermanentSyncRejection` fait cette distinction pour
       * toute la plateforme ; on ne s'en écrit pas une seconde version.
       *
       * Et cela ne touche EN RIEN le 409 de l'utilisateur : une saisie humaine ne passe
       * jamais par ce tampon, que `saveWithBootCatalogGuard` réserve aux fiches de catalogue
       * automatiques pendant la seule fenêtre d'amorçage.
       */
      if (isPermanentSyncRejection(error)) retirerSiInchange(record?.id, record);
      console.warn(`Enrichissement retenu non centralisé pour docs/${record?.id}`, error);
    }
  }
  return livrees;
}

async function installCentralCatalogOnce() {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const user = currentUser();
    if (!roleIsGlobalAdmin(user?.role) || !db.isCentralSyncReady?.()) return { installed:false, reason:'not-global-admin' };
    const installedVersion = await centralCatalogVersion();
    if (installedVersion >= CENTRAL_CATALOG_VERSION) {
      /*
       * VERSION À JOUR NE VEUT PAS DIRE TAMPON VIDE — ET UN TAMPON OUBLIÉ EST UNE PERTE.
       *
       * `catalog-install` est une MIGRATION VERSIONNÉE : le serveur refuse lui aussi une
       * charge dont la version n'est pas supérieure à la sienne (`already-current`, voir
       * `scripts/catalog-seed-preload.js`). Ce court-circuit est donc juste pour la
       * migration — mais il se trouvait AVANT la lecture du tampon, et emportait avec lui
       * tout ce que le tampon contenait.
       *
       * Or `saveWithBootCatalogGuard` DÉTOURNE les écritures de catalogue pendant la
       * fenêtre d'amorçage : une fiche retenue n'est pas partie par la voie ordinaire. Si
       * la migration ne la reprend pas, plus personne ne la livre. Mesuré sur un serveur
       * déjà en version 24, un enrichissement légitime écrit à t = 161 ms :
       *
       *     tampon = OUI · install = already-current · 0 mutation HTTP
       *     serveur : jamais reçu · instantané suivant : absent · local : écrasé
       *
       * Le remède ne touche ni la version, ni le contrat serveur, ni la révision : ce qui
       * a été DÉTOURNÉ est simplement remis sur la voie ordinaire, celle par laquelle il
       * serait parti sans nous. Le serveur reste seul maître — il arbitre la révision comme
       * pour toute écriture, et un refus légitime reste un refus visible.
       */
      const retenus = [...bufferedDocs.values()];
      if (!retenus.length) return { installed:false, reason:'already-current', version:installedVersion };
      const livrees = await livrerParLaVoieOrdinaire(retenus);
      return { installed:false, reason:'already-current', version:installedVersion, delivered:livrees };
    }

    const records = [...bufferedDocs.values()];
    if (!records.length) return { installed:false, reason:'catalog-buffer-empty' };
    const response = await fetch('/api/sync/catalog-install', {
      method:'POST',
      credentials:'include',
      cache:'no-store',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ version:CENTRAL_CATALOG_VERSION, records })
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { message:text }; }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || `Erreur serveur (${response.status})`);
      error.status = response.status;
      error.code = payload?.error;
      throw error;
    }
    /*
     * CE QUI EST CENTRALISÉ QUITTE LE TAMPON — SANS QUOI IL SERA RENVOYÉ.
     *
     * Le tampon n'était vidé nulle part. Tant que la migration était le SEUL chemin de
     * sortie, cela ne se voyait pas : le serveur refusait poliment la seconde tentative
     * (`already-current`) et l'on n'y pensait plus. Dès que le tampon a gagné un second
     * chemin de sortie — la voie ordinaire, pour les enrichissements tardifs — la dette
     * est devenue visible et coûteuse : au battement suivant, les ~500 fiches DÉJÀ
     * installées repartaient une à une, chacune avec la révision d'AVANT l'installation.
     *
     * Mesuré : 511 conflits 409 automatiques au premier login. C'est exactement ce que
     * #98 interdit, et c'est la mesure de non-régression qui l'a attrapé.
     *
     * On ne retire donc que ce qui vient d'être POSTÉ, seulement si le serveur l'a accepté,
     * et seulement si l'entrée du tampon est TOUJOURS celle qu'on a envoyée — voir
     * `retirerSiInchange`. Une fiche réécrite PENDANT l'envoi appartient au tour suivant, et
     * cette promesse est désormais tenue par l'identité de l'objet, pas par l'identifiant.
     */
    if (payload?.installed) for (const record of records) retirerSiInchange(record?.id, record);
    await mirrorCentralVersion(Number(payload?.version || CENTRAL_CATALOG_VERSION));
    if (payload?.installed) await refreshCentralMirror();
    window.dispatchEvent(new CustomEvent('central-catalog-installed', { detail:payload }));
    return payload;
  })().catch(error => {
    console.warn('Migration centrale du catalogue différée.', error);
    return { installed:false, reason:error.message || 'catalog-migration-failed' };
  }).finally(() => { installPromise = null; });
  return installPromise;
}

db.save = async function saveWithBootCatalogGuard(storeName, record, ...rest) {
  if (captureEnabled && isAutomaticCatalogDoc(storeName, record)) return saveSeedLocally(record);
  return previousSave(storeName, record, ...rest);
};

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    if (event.detail?.state !== 'synced') return;
    centralSynced = true;
    if (roleIsGlobalAdmin(currentUser()?.role)) {
      scheduleCatalogInstall();
    } else {
      // Le rôle connecté peut lire le catalogue filtré, mais ne le republie jamais.
      releaseCaptureSoon(NON_ADMIN_CAPTURE_WINDOW_MS);
    }
  });

  window.CatalogSeedGuard = Object.freeze({
    version:CATALOG_SEED_GUARD_VERSION,
    catalogVersion:CENTRAL_CATALOG_VERSION,
    quietWindowMs:CATALOG_QUIET_WINDOW_MS,
    isAutomaticCatalogDoc,
    pending:() => bufferedDocs.size,
    install:installCentralCatalogOnce
  });
}

export { isAutomaticCatalogDoc, installCentralCatalogOnce };
