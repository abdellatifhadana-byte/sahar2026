/**
 * @file tests/revision-accusee.test.js — SETTINGS-REVISION-01 (#120).
 *
 * CE QUI SE PASSAIT
 * -----------------
 * Une écriture partait avec la révision N. Le serveur l'acceptait et passait à N+1. Mais sa
 * réponse ne disait que « c'est écrit » : `{ ok: true, id }`. `pushRecord()` jetait de toute
 * façon cette réponse, et la projection locale restait à N. L'écriture légitime SUIVANTE
 * repartait donc avec N et se faisait refuser en 409 STALE_WRITE — un conflit sans deuxième
 * auteur. Mesuré sur `settings`, `rooms`, `equipments`, `docs` et `notes` : le défaut était
 * dans le contrat d'écriture central, pas dans les paramètres.
 *
 * CE QUI EST ÉPROUVÉ ICI
 * ----------------------
 * Ces tests EXÉCUTENT `saveWithCentralSync` : le serveur est simulé au niveau du transport
 * (`fetch`), la base locale est une carte en mémoire, et l'on observe ce que la projection
 * apprend. Ce qui compte n'est pas seulement qu'elle apprenne la révision, mais qu'elle
 * refuse de l'apprendre au prix d'une saisie plus récente : l'écriture locale précède
 * l'appel réseau, donc une autre modification peut occuper la place pendant l'attente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * `window` reste volontairement indéfini : le module s'en sert pour poser des écouteurs et
 * un `setInterval` de vingt secondes qui retiendrait le processus de test ouvert. Sans lui,
 * la diffusion d'état devient un no-op et la mécanique d'écriture — le sujet — reste intacte.
 */
let identite = '{"id":1,"role":"admin"}';
globalThis.localStorage = { getItem: cle => (cle === 'auth' ? identite : null), setItem() {}, removeItem() {} };

/* ── La base locale, avant que central-sync ne l'enveloppe ── */
const magasins = new Map();
const table = nom => { if (!magasins.has(nom)) magasins.set(nom, new Map()); return magasins.get(nom); };

/*
 * Une IndexedDB minimale, mais FIDÈLE sur les deux points qui comptent.
 *
 * `accorderRevision` relit et estampille dans UNE SEULE transaction : le faux magasin exécute
 * donc `get` puis `put` de façon asynchrone, comme le vrai.
 *
 * Le rejeu de la file, lui, RÉCLAME chaque entrée — lecture et marquage indivisibles — et
 * attend l'ACHÈVEMENT de la transaction pour savoir si la main s'est bien posée. La
 * transaction simulée tient donc le compte de ses requêtes et n'annonce sa fin qu'une fois la
 * dernière réglée, y compris celles émises depuis le succès d'une autre.
 */
const { db } = await import('../db.js');
db.open = async () => ({});
db.db = {
  objectStoreNames: { contains: () => true },
  transaction(nom) {
    const donnees = table(nom);
    const transaction = { oncomplete: null, onerror: null, onabort: null };
    let enCours = 0;
    let achevee = false;
    const acheve = () => {
      if (achevee || enCours > 0) return;
      achevee = true;
      queueMicrotask(() => transaction.oncomplete?.());
    };
    const requete = executer => {
      const objet = { result: undefined, error: null, onsuccess: null, onerror: null };
      enCours += 1;
      queueMicrotask(() => {
        try { objet.result = executer(); objet.onsuccess?.(); }
        catch (erreur) { objet.error = erreur; objet.onerror?.(); }
        finally { enCours -= 1; acheve(); }
      });
      return objet;
    };
    transaction.objectStore = () => ({
      get: cle => requete(() => (donnees.has(String(cle)) ? { ...donnees.get(String(cle)) } : undefined)),
      put: valeur => requete(() => { donnees.set(String(valeur.id), { ...valeur }); return valeur.id; }),
      delete: cle => requete(() => { donnees.delete(String(cle)); return undefined; })
    });
    return transaction;
  }
};
db._getRaw = async (nom, id) => { const v = table(nom).get(String(id)); return v ? { ...v } : null; };
db.get = db._getRaw;
db.getAll = async nom => [...table(nom).values()].map(v => ({ ...v }));
db.save = async (nom, enregistrement) => {
  const copie = { ...enregistrement };
  table(nom).set(String(copie.id), copie);
  return copie.id;
};
db._deleteRaw = async (nom, id) => { table(nom).delete(String(id)); return true; };

/* ── Le serveur, simulé au transport ── */
let revisionServeur = new Map();
/** Chaque requête réellement partie. */
let requetes = [];
/** Ce que le serveur doit répondre : 'ok' | 403 | 409 | 500. */
let regime = 'ok';
/** Exécuté juste après le départ de la requête, avant que la réponse soit traitée. */
let pendantLaRequete = null;

const reponse = (statut, corps) => ({
  ok: statut >= 200 && statut < 300,
  status: statut,
  text: async () => JSON.stringify(corps),
  clone() { return this; },
  json: async () => corps
});

globalThis.fetch = async (chemin, options = {}) => {
  const methode = (options.method || 'GET').toUpperCase();
  const [, , , magasin, id] = String(chemin).split('/');
  const envoye = options.body ? JSON.parse(options.body) : null;
  requetes.push({ methode, magasin, id, envoye });
  if (pendantLaRequete) { const geste = pendantLaRequete; pendantLaRequete = null; await geste(); }
  if (regime === 403) return reponse(403, { error: 'FORBIDDEN', message: 'Action non autorisée pour ce rôle.' });
  if (regime === 500) return reponse(500, { error: 'BOOM', message: 'Panne serveur.' });
  const cle = `${magasin}/${id}`;
  const courante = revisionServeur.get(cle) || 0;
  if (regime === 409) return reponse(409, { error: 'STALE_WRITE', message: 'Modifiée par un autre utilisateur.', currentRevision: courante });
  // compare-and-write : la révision déclarée doit être celle du serveur
  const declaree = Number(envoye?._revision) || 0;
  if (declaree !== courante) return reponse(409, { error: 'STALE_WRITE', message: 'Modifiée par un autre utilisateur.', currentRevision: courante });
  const suivante = courante + 1;
  revisionServeur.set(cle, suivante);
  return reponse(200, { ok: true, id, revision: suivante });
};

const central = await import('../central-sync.js');
await db.enableCentralSync({ bootstrapLocal: false }).catch(() => {});

const reinitialiser = async (magasin = 'settings', id = 'global', revision = 1) => {
  magasins.clear(); requetes = []; regime = 'ok'; pendantLaRequete = null;
  revisionServeur = new Map([[`${magasin}/${id}`, revision]]);
  table(magasin).set(String(id), { id, autoLogout: 30, [`_revision`]: revision });
  await db.getAll('syncQueue');
};
const local = async (magasin, id) => db._getRaw(magasin, id);
const putsVers = (magasin, id) => requetes.filter(r => r.methode === 'PUT' && r.magasin === magasin && String(r.id) === String(id));

test('A · une écriture acceptée fait apprendre la révision du serveur à la projection', async () => {
  await reinitialiser();
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 });
  const fiche = await local('settings', 'global');
  assert.equal(fiche.autoLogout, 61, 'le contenu écrit a été perdu');
  assert.equal(fiche._revision, 2, `la projection est restée à ${fiche._revision} au lieu de 2`);
  assert.equal(putsVers('settings', 'global').length, 1, 'un geste doit produire exactement un PUT');
});

test('B · la sauvegarde suivante déclare la révision acquittée, pas l’ancienne', async () => {
  await reinitialiser();
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 });
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 62 });
  const puts = putsVers('settings', 'global');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].envoye._revision, 1, 'la première écriture déclare la révision lue');
  assert.equal(puts[1].envoye._revision, 2, 'la seconde écriture doit déclarer la révision acquittée');
  assert.equal((await local('settings', 'global'))._revision, 3);
});

test('C · cinq sauvegardes consécutives aboutissent, sans rechargement ni instantané', async () => {
  await reinitialiser();
  for (let n = 1; n <= 5; n += 1) {
    await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 30 + n });
  }
  assert.equal((await local('settings', 'global'))._revision, 6, 'la révision locale n’a pas suivi les cinq écritures');
  assert.equal((await local('settings', 'global')).autoLogout, 35);
  assert.equal(revisionServeur.get('settings/global'), 6);
  assert.equal(putsVers('settings', 'global').length, 5, 'cinq gestes = cinq PUT, pas davantage');
});

test('D · un refus 403 n’avance jamais la révision locale', async () => {
  await reinitialiser();
  regime = 403;
  const avant403 = await local('settings', 'global');
  await assert.rejects(() => db.save('settings', { ...avant403, autoLogout: 61 }));
  const fiche = await local('settings', 'global');
  assert.equal(fiche._revision, 1, 'la révision a été avancée alors que le serveur a refusé');
  assert.equal(fiche.autoLogout, 30, 'le retour arrière n’a pas restauré le contenu précédent');
});

test('E · un vrai conflit 409 n’avance pas la révision locale artificiellement', async () => {
  await reinitialiser();
  regime = 409;
  const avant409 = await local('settings', 'global');
  await assert.rejects(() => db.save('settings', { ...avant409, autoLogout: 61 }));
  assert.equal((await local('settings', 'global'))._revision, 1, 'un conflit ne doit rien accorder');
});

test('F · une panne serveur met en file et n’accorde aucune révision', async () => {
  await reinitialiser();
  regime = 500;
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 }).catch(() => {});
  assert.equal((await local('settings', 'global'))._revision, 1, 'une panne ne doit rien accorder');
  const file = await db.getAll('syncQueue');
  assert.ok(file.some(e => e.storeName === 'settings'), 'la modification aurait dû être mise en attente');
});

test('G · LE POINT CRITIQUE — une saisie plus récente pendant la requête n’est pas écrasée', async () => {
  /*
   * `saveWithCentralSync` écrit en local AVANT d'appeler le serveur. Entre le départ de la
   * requête et le traitement de sa réponse, une autre saisie peut remplacer la fiche.
   * Réécrire alors la charge envoyée, ne serait-ce que pour y poser la nouvelle révision,
   * ferait reculer le contenu : le correctif de la révision détruirait une modification
   * plus récente. C'est l'invariant que ce test protège.
   */
  await reinitialiser();
  pendantLaRequete = async () => {
    // saisie B, postérieure, posée directement dans la projection
    table('settings').set('global', { id: 'global', autoLogout: 222, theme: 'dark', _revision: 1 });
  };
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 });
  const fiche = await local('settings', 'global');
  assert.equal(fiche.autoLogout, 222, 'la saisie plus récente a été écrasée par l’accusé de la précédente');
  assert.equal(fiche.theme, 'dark', 'le contenu de la saisie plus récente a été perdu');
  assert.equal(fiche._revision, 1, 'une révision a été inventée pour une saisie que le serveur n’a pas acquittée');
});

test('H · la fiche disparue entre-temps n’est pas ressuscitée par l’accusé', async () => {
  await reinitialiser();
  pendantLaRequete = async () => { table('settings').delete('global'); };
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 });
  assert.equal(await local('settings', 'global'), null, 'l’accusé a fait renaître une fiche supprimée localement');
});

test('I · le rejeu de la file hors ligne accorde aussi la révision', async () => {
  await reinitialiser();
  regime = 500;
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 133 }).catch(() => {});
  assert.equal((await local('settings', 'global'))._revision, 1);
  regime = 'ok';
  await db.processSyncQueue();
  const fiche = await local('settings', 'global');
  assert.equal(fiche.autoLogout, 133, 'le contenu saisi hors ligne doit survivre au rejeu');
  assert.equal(fiche._revision, 2, 'le rejeu réussi doit accorder la révision du serveur');
  assert.equal((await db.getAll('syncQueue')).filter(e => e.storeName === 'settings').length, 0, 'la file doit être vidée');
});

test('J · un rejeu ne doit pas écraser une saisie survenue depuis la mise en attente', async () => {
  await reinitialiser();
  regime = 500;
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 133 }).catch(() => {});
  // saisie postérieure, pendant que la file attend
  table('settings').set('global', { id: 'global', autoLogout: 999, _revision: 1 });
  regime = 'ok';
  await db.processSyncQueue();
  const fiche = await local('settings', 'global');
  assert.equal(fiche.autoLogout, 999, 'le rejeu a écrasé une saisie plus récente');
  assert.equal(fiche._revision, 1, 'le rejeu a accordé une révision à une fiche qui n’est pas celle acquittée');
});

test('K · le contrat vaut pour tout magasin révisionné, pas seulement les paramètres', async () => {
  for (const magasin of ['rooms', 'equipments', 'docs', 'notes', 'tickets']) {
    await reinitialiser(magasin, 'x1', 4);
    await db.save(magasin, { ...(await local(magasin, 'x1')), autoLogout: 61 });
    assert.equal((await local(magasin, 'x1'))._revision, 5, `${magasin} : la révision locale n’a pas suivi`);
    await db.save(magasin, { ...(await local(magasin, 'x1')), autoLogout: 62 });
    assert.equal((await local(magasin, 'x1'))._revision, 6, `${magasin} : la deuxième écriture consécutive a échoué`);
  }
});

test('L · un magasin NON révisionné ne se voit poser aucune révision', async () => {
  // `logs` est synchronisé mais hors contrat de révision : chaque entrée est un fait
  // nouveau, jamais la modification d'un fait ancien.
  await reinitialiser('logs', 'l1', 0);
  table('logs').set('l1', { id: 'l1', message: 'test' });
  await db.save('logs', { id: 'l1', message: 'test', suite: 1 });
  const fiche = await local('logs', 'l1');
  assert.equal(fiche._revision, undefined, 'une révision a été posée sur un magasin hors contrat');
});

test('M · la révision posée vient de l’accusé, jamais d’un incrément local', async () => {
  await reinitialiser();
  // le serveur saute délibérément à 7 : un client qui ferait « local + 1 » écrirait 2.
  revisionServeur.set('settings/global', 1);
  const original = globalThis.fetch;
  globalThis.fetch = async (chemin, options = {}) => {
    const r = await original(chemin, options);
    if (r.status === 200) { const corps = await r.json(); return reponse(200, { ...corps, revision: 7 }); }
    return r;
  };
  await db.save('settings', { ...(await local('settings', 'global')), autoLogout: 61 });
  globalThis.fetch = original;
  assert.equal((await local('settings', 'global'))._revision, 7,
    'la révision locale doit être celle que le serveur annonce, pas un incrément deviné');
});

test('N · le serveur rend bien la révision dans son accusé de réception', () => {
  const source = readFileSync(new URL('../scripts/serve.js', import.meta.url), 'utf8');
  const ligne = source.split('\n').find(l => /json\(res, 200, \{ ok: true, id: record\.id/.test(l));
  assert.ok(ligne, 'la réponse du PUT révisionné est introuvable');
  assert.match(ligne, /revision: ecriture\.revision/, 'l’accusé de réception ne porte pas la révision');
  assert.match(ligne, /storeName === 'docs'/, 'le contrat particulier de docs a disparu');
});
