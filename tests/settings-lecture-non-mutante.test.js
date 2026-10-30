/**
 * @file tests/settings-lecture-non-mutante.test.js — SETTINGS-READ-MUTATE-01 (#117).
 *
 * CE QUI SE PASSAIT, MESURÉ AU NAVIGATEUR SUR `main@19446e3`
 * ---------------------------------------------------------
 * Cinq rôles non-admin, deux conditions réelles — un enregistrement hérité `settings/1`
 * dans la base locale, ou un magasin `settings` local vidé :
 *
 *   Manager · Chef · Responsable · Technicien · Visiteur
 *     PUT /api/data/settings/global → 403 « Action non autorisée pour ce rôle. »
 *     syncQueue : une entrée `failed` par session
 *     et la LECTURE ELLE-MÊME rejetait — le refus remontait jusqu'à l'appelant.
 *
 * Un rôle sans droit d'écriture ne pouvait donc plus lire ses propres paramètres.
 *
 * LA CAUSE
 * --------
 * `ensureCanonicalSettings()` — appelée à CHAQUE démarrage, pour TOUS les rôles, par
 * `core.js` — consolidait les enregistrements puis PERSISTAIT le résultat :
 *
 *   ensureCanonicalSettings → db.save('settings', …) → saveWithCentralSync
 *                           → pushRecord → PUT /api/data/settings/global → 403
 *
 * Le serveur avait raison : `access-control.js` réserve l'écriture `settings` à
 * l'administrateur, et doit rester fail-closed. Le défaut n'était pas le refus ; c'était
 * qu'une lecture prétende écrire.
 *
 * CE QUI EST ÉPROUVÉ ICI
 * ---------------------
 * Ces tests EXÉCUTENT le vrai module. Le serveur qui refuse est simulé au bon endroit —
 * `db.save` rejette, comme le fait le retour arrière après un 403 — et l'on compte les
 * écritures RÉELLEMENT tentées. La consolidation, elle, doit rester intacte : ce lot rend
 * la lecture inoffensive, il ne change pas ce qu'elle conclut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* ---------------- Un navigateur minimal, installé avant l'import ---------------- */
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const evenements = [];
globalThis.window = { dispatchEvent(e) { evenements.push(e); return true; }, addEventListener() {} };

/* ---------------- La base locale, et le serveur qui refuse ---------------- */
const magasins = new Map();
const table = nom => { if (!magasins.has(nom)) magasins.set(nom, new Map()); return magasins.get(nom); };

/** Toutes les écritures TENTÉES — y compris celles que le serveur refuserait. */
let tentatives = [];
/** Toutes les suppressions tentées. */
let suppressions = [];
/** Quand il est vrai, le serveur refuse : c'est la situation de tout rôle non-admin. */
let serveurRefuse = false;

const { db } = await import('../db.js');
db.open = async () => ({});
db.db = { objectStoreNames: { contains: () => true } };
db.get = async (nom, id) => table(nom).get(String(id)) ?? null;
db._getRaw = db.get;
db.getAll = async nom => [...table(nom).values()];
db.save = async (nom, enregistrement) => {
  tentatives.push({ store: nom, id: String(enregistrement?.id ?? ''), record: enregistrement });
  if (serveurRefuse) throw new Error('Action non autorisée pour ce rôle.');
  table(nom).set(String(enregistrement.id), { ...enregistrement });
  return enregistrement.id;
};
db.delete = async (nom, id) => { suppressions.push({ store: nom, id: String(id) }); table(nom).delete(String(id)); return true; };

const contrat = await import('../settings-contract.js');

const preparer = enregistrements => {
  magasins.clear(); tentatives = []; suppressions = []; evenements.length = 0;
  for (const e of enregistrements) table('settings').set(String(e.id), { ...e });
};
const GLOBAL_SERVEUR = Object.freeze({
  id: 'global', theme: 'light', language: 'fr', autoBackup: true, backupFrequency: 'weekly',
  autoLogout: 30, notifications: true, mapImageUrl: 'assets/plan-technique.PNG',
  _revision: 4, updatedAt: '2026-08-01T10:00:00.000Z'
});
const HERITE_PLUS_RECENT = Object.freeze({
  id: '1', theme: 'dark', language: 'fr', autoLogout: 45, notifications: true,
  backupFrequency: 'monthly', updatedAt: '2026-08-20T10:00:00.000Z'
});

/* Les deux conditions réelles, telles que le navigateur les a rencontrées. */
const CONDITIONS = [
  { nom: 'un enregistrement hérité settings/1 subsiste', records: [GLOBAL_SERVEUR, HERITE_PLUS_RECENT] },
  { nom: 'le magasin settings local est vide', records: [] },
  { nom: 'le magasin ne porte que settings/global', records: [GLOBAL_SERVEUR] }
];
/* Les cinq rôles ne diffèrent, pour ce défaut, que par une chose : le serveur les refuse. */
const ROLES_NON_ADMIN = ['manager', 'chef', 'responsable', 'technicien', 'visiteur'];

for (const role of ROLES_NON_ADMIN) {
  test(`A-E · ${role} : lire les paramètres n'écrit RIEN, quelles que soient les conditions`, async () => {
    for (const condition of CONDITIONS) {
      preparer(condition.records);
      serveurRefuse = true;                       // aucun rôle non-admin ne peut écrire settings
      const vue = await contrat.getPlatformSettings();
      assert.equal(tentatives.length, 0,
        `${role} · ${condition.nom} : ${tentatives.length} écriture(s) tentée(s) — ${JSON.stringify(tentatives[0] || null)}`);
      assert.equal(suppressions.length, 0, `${role} · ${condition.nom} : une suppression a été tentée pendant une lecture`);
      // La lecture ABOUTIT : c'est l'autre moitié du défaut. Avant, elle rejetait.
      assert.equal(vue.id, 'global');
      assert.equal(vue.language, 'fr');
    }
  });
}

test('F · la normalisation d’un objet incomplet rend une vue canonique, sans persistance', async () => {
  preparer([{ id: 'global', theme: 'nimportequoi', autoLogout: 5000, backupFrequency: 'jamais' }]);
  serveurRefuse = true;
  const vue = await contrat.getPlatformSettings();
  assert.equal(tentatives.length, 0, 'la normalisation a tenté de se persister');
  // La vue est bien canonique — les valeurs hors bornes sont ramenées, sans rien écrire.
  assert.equal(vue.theme, 'light');
  assert.equal(vue.autoLogout, 240);
  assert.equal(vue.backupFrequency, 'weekly');
  assert.equal(vue.settingsVersion, 2);
  // Et le magasin local est resté tel quel : aucune correction n'a été gravée.
  assert.equal((await db.get('settings', 'global')).theme, 'nimportequoi');
});

test('la consolidation reste INTACTE : l’héritier le plus récent gouverne toujours la vue', async () => {
  preparer([GLOBAL_SERVEUR, HERITE_PLUS_RECENT]);
  serveurRefuse = true;
  const vue = await contrat.getPlatformSettings();
  // Ce lot rend la lecture inoffensive ; il ne change pas ce qu'elle conclut.
  assert.equal(vue.theme, 'dark');
  assert.equal(vue.autoLogout, 45);
  assert.equal(vue.backupFrequency, 'monthly');
  assert.equal(tentatives.length, 0);
});

test('D · une écriture Admin reste une VRAIE écriture, et résorbe l’héritier', async () => {
  preparer([GLOBAL_SERVEUR, HERITE_PLUS_RECENT]);
  serveurRefuse = false;                          // l'administrateur, lui, a le droit
  const suivant = await contrat.savePlatformSettings({ autoLogout: 12, theme: 'light' });
  const ecrites = tentatives.filter(t => t.store === 'settings' && t.id === 'global');
  assert.equal(ecrites.length, 1, 'l’écriture Admin n’a pas produit exactement une mutation');
  assert.equal(suivant.autoLogout, 12);
  assert.equal(suivant.theme, 'light');
  assert.equal(suivant.id, 'global');
  // Le ménage de l'héritier se fait ici — sous l'autorité qui portait déjà le droit d'écrire.
  assert.deepEqual(suppressions, [{ store: 'settings', id: '1' }]);
  // Et l'écran est prévenu, comme avant.
  assert.ok(evenements.some(e => e.type === 'platform-settings-updated'));
});

test('D · une écriture Admin REFUSÉE ne supprime pas l’héritier', async () => {
  /*
   * L'ordre compte : si la mutation canonique échoue, `settings/1` reste la seule copie
   * des valeurs de l'exploitant. La retirer quand même les perdrait définitivement.
   */
  preparer([GLOBAL_SERVEUR, HERITE_PLUS_RECENT]);
  serveurRefuse = true;
  await assert.rejects(() => contrat.savePlatformSettings({ autoLogout: 12 }));
  assert.equal(suppressions.length, 0, 'l’héritier a été supprimé alors que l’écriture avait échoué');
  assert.ok(await db.get('settings', '1'), 'l’enregistrement hérité a disparu après un refus');
});

test('aucun chemin de LECTURE du contrat ne persiste', async () => {
  /*
   * `ensureCanonicalSettings` porte encore son nom — `core.js` l'appelle au démarrage pour
   * tous les rôles — mais elle ne consolide plus qu'en mémoire.
   */
  preparer([GLOBAL_SERVEUR, HERITE_PLUS_RECENT]);
  serveurRefuse = true;
  await contrat.ensureCanonicalSettings();
  await contrat.getPlatformSettings();
  await contrat.ensureCanonicalSettings();
  assert.equal(tentatives.length, 0, `${tentatives.length} écriture(s) pour trois lectures`);
  assert.equal(suppressions.length, 0);
});

test('les paramètres restent au serveur : aucune bascule vers localStorage', async () => {
  const source = fs.readFileSync(new URL('../settings-contract.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage/, 'le contrat des paramètres s’est mis à écrire dans localStorage');
  assert.match(source, /db\.getAll\('settings'\)/, 'la source de vérité locale n’est plus le magasin settings');
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SETTINGS-REVISION-01 (#120) — la métadonnée de concurrence ne vient jamais de l'appelant.
 *
 * L'écran des paramètres garde ses valeurs en mémoire et les repasse en bloc :
 *
 *     savePlatformSettings({ ...this.currentSettings, ...this.collectFormValues() })
 *
 * Cette copie transporte la révision telle qu'elle était à l'OUVERTURE de l'écran. Laissée
 * dans le correctif, elle écrasait par étalement la révision fraîchement relue, et la
 * plateforme déclarait au serveur une version qu'elle avait elle-même déjà dépassée : le
 * deuxième enregistrement était refusé en 409, sans aucun deuxième auteur.
 *
 * La règle retenue : les VALEURS peuvent venir de l'appelant, la RÉVISION vient toujours de
 * la projection canonique observée.
 * ─────────────────────────────────────────────────────────────────────────────
 */

test('#120 · la révision déclarée reste celle que l’appelant avait sous les yeux', () => {
  /*
   * On a été tenté de remplacer la révision de l'appelant par celle de la projection
   * fraîchement relue. Mesuré au navigateur, c'était une PERTE DE DONNÉES : l'instantané
   * central rafraîchit la projection toutes les vingt secondes, l'écran non. La projection
   * est donc en AVANCE sur l'écran, et emprunter sa révision revenait à déclarer avoir vu
   * une version jamais regardée — un deuxième administrateur écrasait alors en silence le
   * travail du premier, sans aucun 409.
   */
  const source = fs.readFileSync(new URL('../settings-contract.js', import.meta.url), 'utf8');
  const corps = source.slice(source.indexOf('export async function savePlatformSettings'));
  assert.match(corps.slice(0, corps.indexOf('await db.save')), /\.\.\.current,\s*\n\s*\.\.\.patch,/,
    'le correctif de l’appelant n’est plus étalé tel quel : sa révision déclarée a été confisquée');
});

test('#120 · un écran réellement périmé reste refusé, même si la projection a avancé', async () => {
  // La projection connaît déjà la révision 9 (instantané) ; l'écran, lui, est resté à 4.
  preparer([{ ...GLOBAL_SERVEUR, _revision: 9 }]);
  serveurRefuse = true;
  await assert.rejects(() => contrat.savePlatformSettings({ ...GLOBAL_SERVEUR, _revision: 4, autoLogout: 12 }));
  const ecrite = tentatives.find(t => t.store === 'settings' && t.id === 'global');
  assert.equal(ecrite.record._revision, 4,
    `la déclaration envoyée est ${ecrite.record._revision} au lieu de 4 : l’écran périmé emprunterait la version d’un autre`);
});

test('#120 · la fiche rendue porte la révision aboutie, pas celle d’avant l’écriture', async () => {
  preparer([{ ...GLOBAL_SERVEUR, _revision: 9 }]);
  serveurRefuse = false;
  /*
   * `db.save` est ici la porte générique : dans le produit, c'est elle qui pousse au serveur
   * puis range la révision acquittée. On reproduit ce rangement pour vérifier que le contrat
   * relit APRÈS, au lieu de rendre l'objet qu'il avait préparé AVANT.
   */
  const porteOriginale = db.save;
  db.save = async (nom, enregistrement) => {
    const id = await porteOriginale(nom, enregistrement);
    if (nom === 'settings') table('settings').set('global', { ...enregistrement, _revision: 10 });
    return id;
  };
  const rendue = await contrat.savePlatformSettings({ autoLogout: 12 });
  db.save = porteOriginale;
  assert.equal(rendue._revision, 10,
    `la fiche rendue porte ${rendue._revision} : l’écran repartirait avec une révision périmée`);
  const annonce = evenements.find(e => e.type === 'platform-settings-updated');
  assert.ok(annonce, 'l’écran n’est plus prévenu');
  assert.equal(annonce.detail.settings._revision, 10, 'l’événement annonce une révision périmée');
});

test('#120 · une vraie concurrence reste refusée : aucune relecture serveur avant l’écriture', async () => {
  /*
   * La révision retenue est celle de la base LOCALE. Si un autre poste a avancé le serveur
   * sans que l'instantané soit arrivé, la projection est réellement en retard, la
   * déclaration l'est aussi, et le serveur refuse — comme il doit. Le contrat ne va jamais
   * chercher la révision courante du serveur avant d'écrire : cela transformerait un geste
   * réellement périmé en écriture acceptée.
   */
  preparer([{ ...GLOBAL_SERVEUR, _revision: 4 }]);   // le serveur, lui, est déjà à 9
  serveurRefuse = true;                              // il refusera donc cette écriture
  await assert.rejects(() => contrat.savePlatformSettings({ autoLogout: 12 }));
  const ecrite = tentatives.find(t => t.store === 'settings' && t.id === 'global');
  assert.equal(ecrite.record._revision, 4,
    'le contrat a déclaré autre chose que la révision réellement observée localement');
  const source = fs.readFileSync(new URL('../settings-contract.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(/, 'le contrat va chercher une révision au serveur avant d’écrire');
});
