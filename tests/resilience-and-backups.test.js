import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_RETENTION } from '../backup-service.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sync = read('central-sync.js');
const backup = read('backup-service.js');
const settings = read('system-settings.js');
const shell = read('ui-shell-fixes.css');

/* ==========================================================================
   Expiration et annulation des requêtes
   ========================================================================== */

test('toute requête a un délai d’expiration', () => {
  // `api()` appelait `fetch` sans délai ni annulation, alors qu'une synchronisation
  // repart toutes les 20 secondes : une requête pendue n'était jamais abandonnée et les
  // suivantes s'empilaient derrière elle, chacune tenant une connexion.
  assert.match(sync, /const REQUEST_TIMEOUT_MS = \d+;/);
  assert.match(sync, /const controller = new AbortController\(\);/);
  assert.match(sync, /signal: controller\.signal/);
  assert.match(sync, /setTimeout\(\(\) => controller\.abort\('délai dépassé'\)/);
  // Le minuteur doit être levé quoi qu'il arrive, sinon il s'accumule.
  assert.match(sync, /\} finally \{\s*clearTimeout\(expiration\);\s*enVol\.delete\(controller\);/);
});

test('une expiration est transitoire, pas un rejet définitif', async () => {
  // L'expiration se nomme toujours ainsi côté synchronisation.
  assert.match(sync, /error\.status = 408;/);
  assert.match(sync, /error\.code = 'REQUEST_TIMEOUT';/);

  /*
   * La règle elle-même a QUITTÉ `central-sync.js` : deux couches en dépendent désormais —
   * la synchronisation, pour décider entre conflit et remise en file, et
   * `catalog-seed-guard`, pour décider si un enrichissement automatique doit céder devant
   * une vérité plus récente. Elle vit donc dans `revision-contract.js`, écrite une fois.
   *
   * Cette épreuve épinglait son TEXTE ; elle l'EXÉCUTE maintenant, ce qui la rend
   * insensible à l'endroit où la règle habite et sensible à ce qu'elle décide.
   */
  const { isPermanentSyncRejection } = await import('../revision-contract.js');
  for (const status of [401, 408, 429]) {
    assert.equal(isPermanentSyncRejection({ status }), false,
      `${status} est transitoire : l'opération doit être remise en file, pas perdue`);
  }
  for (const status of [400, 403, 404, 409, 422]) {
    assert.equal(isPermanentSyncRejection({ status }), true,
      `${status} est un refus examiné : le rejouer donnerait le même refus`);
  }
  // Une panne sans statut, ou un 5xx, ne dit rien du contenu : on retente.
  assert.equal(isPermanentSyncRejection({}), false);
  assert.equal(isPermanentSyncRejection({ status: 503 }), false);
});

test('les requêtes en vol sont annulables', () => {
  assert.match(sync, /export function cancelInFlightRequests/);
  assert.match(sync, /for \(const controller of enVol\) \{ try \{ controller\.abort\(raison\); \} catch \{\} \}/);
  // Onglet masqué et session fermée : deux moments où plus rien ne doit aboutir.
  assert.match(sync, /if \(document\.visibilityState === 'hidden'\) cancelInFlightRequests/);
  assert.match(sync, /addEventListener\('platform-session-closing', \(\) => cancelInFlightRequests/);
  assert.match(read('auth.js'), /new CustomEvent\('platform-session-closing'\)/);
});

/* ==========================================================================
   Sauvegardes conservées
   ========================================================================== */

test('la sauvegarde automatique conserve au lieu de télécharger', () => {
  // Elle appelait `exportToFile()` — un téléchargement — toutes les semaines sans geste
  // de l'utilisateur. Les navigateurs bloquent cela : rien n'était produit, rien conservé.
  assert.match(backup, /await this\.storeBackup\(\{reason:'auto'\}\)/);
  assert.doesNotMatch(backup, /setInterval\([\s\S]{0,200}await this\.exportToFile\(\)/,
    'la tâche périodique ne doit plus déclencher de téléchargement');
  // `exportToFile` subsiste pour un téléchargement DEMANDÉ.
  assert.match(backup, /async exportToFile\(\)/);
});

test('les sauvegardes sont listables, restaurables et bornées', () => {
  for (const method of ['storeBackup', 'listBackups', 'pruneBackups', 'restoreStoredBackup', 'downloadStoredBackup']) {
    assert.match(backup, new RegExp(`async ${method}\\(`), `méthode manquante : ${method}`);
  }
  assert.ok(BACKUP_RETENTION > 0 && BACKUP_RETENTION <= 32);
  // La liste ne doit pas ramener les charges utiles complètes en mémoire.
  assert.match(backup, /all\.map\(\(\{payload,\.\.\.meta\}\)=>meta\)/);
  // Une sauvegarde est une copie complète de la base du poste : jamais téléversée.
  assert.match(backup, /Local uniquement : une sauvegarde ne remonte jamais au serveur\./);
  assert.match(backup, /typeof db\.saveLocalOnly==='function'/);
});

test('le magasin des sauvegardes existe et reste hors synchronisation', () => {
  const migration = read('db-migration-v16.js');
  assert.match(migration, /createObjectStore\('backups', \{ keyPath: 'id' \}\)/);
  assert.match(migration, /createIndex\('createdAt', 'createdAt'\)/);
  assert.match(read('index.html'), /db-migration-v16\.js/);
  // Il ne doit jamais entrer dans la liste synchronisée.
  assert.doesNotMatch(read('central-sync.js'), /SYNC_STORES[\s\S]{0,400}'backups'/);
});

test('les sauvegardes sont VISIBLES dans les paramètres', () => {
  // Une capacité qui n'apparaît nulle part à l'écran n'existe pas pour l'utilisateur.
  assert.match(settings, /id="backup-list"/);
  assert.match(settings, /async refreshBackupList\(\)/);
  assert.match(settings, /data-backup-restore=/);
  assert.match(settings, /data-backup-download=/);
  assert.match(settings, /await this\.backupService\.storeBackup\(\{ reason:'manuelle' \}\)/);
  // Taille lisible plutôt qu'un nombre d'octets brut.
  assert.match(settings, /const formatOctets = value =>/);
  assert.match(settings, /formatOctets\(record\.sizeBytes\)/);
});

/* ==========================================================================
   Toutes les sections doivent être atteignables
   ========================================================================== */

test('la barre latérale défile son propre contenu', () => {
  // Contenu ~1008 px en `overflow-y: visible` : les sections qui dépassaient l'écran
  // débordaient SANS barre de défilement. Mesuré : 3 sections sur 19 hors d'atteinte à
  // 900 px de haut, 6 à 760 px, 8 à 640 px — dont « Paramètres » et « Accès zones ».
  assert.match(shell, /\.admin-page \.admin-sidebar \{[^}]*overflow-y: auto/);
  assert.match(shell, /overscroll-behavior: contain/);
  // Cible tactile d'au moins 44 px sur écran tactile.
  assert.match(shell, /@media \(pointer: coarse\)[\s\S]{0,160}min-height: 44px/);
});

test('une sauvegarde faite sans clic apparaît quand même à l’écran', () => {
  // La sauvegarde automatique part d'une minuterie : aucun appelant pour rafraîchir, et
  // personne n'écoutait l'annonce. La liste affichée restait celle du dernier affichage —
  // « Aucune sauvegarde conservée » alors qu'il venait d'y en avoir une. Vérifié dans le
  // navigateur après correction : 0 ligne → 1 ligne, sans intervention.
  const settings = read('system-settings.js');
  assert.match(settings, /bindBackupAnnouncements\(\)/);
  for (const annonce of ['backup-created', 'auto-backup-completed', 'backup-restored']) {
    assert.match(settings, new RegExp(`eventSystem\\.register\\('${annonce}', rafraichir\\)`),
      `l'annonce ${annonce} ne remet plus la liste à jour`);
  }
  // Enregistré une seule fois : `afterRender` s'exécute à chaque retour sur Paramètres.
  assert.match(settings, /if \(this\._backupAnnouncementsBound\) return;/);
  // Un échec de sauvegarde automatique doit se voir : croire protégé ce qui ne l'est plus
  // est le pire des cas.
  assert.match(settings, /eventSystem\.register\('auto-backup-failed'/);
});

test('l’événement des murs est documenté pour ce qu’il est', () => {
  // Le commentaire affirmait que `wall-data-changed` « reflète l'état réel des données ».
  // Vérifié : aucun module ne l'écoute. Le croire conduirait à retirer le réaffichage
  // explicite de l'appelant et à figer l'écran sur des données périmées.
  const manager = read('wall-manager.js');
  assert.match(manager, /`wall-data-changed` est une ANNONCE, pas le mécanisme de rafraîchissement/);
  assert.doesNotMatch(manager, /c'est lui qui reflète l'état réel des données/);
  // Le réaffichage explicite doit rester en place chez les appelants.
  assert.match(manager, /this\.renderCurrentWall\(\)/);
});
