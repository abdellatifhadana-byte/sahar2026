/**
 * @file tests/catalog-buffer-queue-98.test.js — #98 : une livraison de FOND ne fabrique pas
 *       un conflit que l'utilisateur devrait résoudre — et n'enlève rien à celui qu'il crée.
 *
 * POURQUOI CETTE ÉPREUVE MONTE LA VRAIE CHAÎNE
 * -------------------------------------------
 * Le défaut ne vit ni dans `catalog-seed-guard`, ni dans `central-sync`, mais dans leur
 * JOINTURE. Le garde livre par `previousSave`, qui EST le `db.save` de `central-sync` ; et
 * celui-ci, sur un refus définitif, écrit `syncQueue` AVANT de relancer l'erreur :
 *
 *     if (previous) await originalSave(storeName, previous);
 *     await recordRejectedOperation('save', storeName, id, saved, error);   ← status:'conflict'
 *     throw error;
 *
 * Le garde ne voit que l'exception. Il retire la charge périmée du tampon — donc plus de
 * rejeu — mais l'entrée de file est déjà écrite, et `conflict` est TERMINALE. Une épreuve
 * qui simulerait `db.save` par un simple `throw` serait AVEUGLE à cela : c'est précisément
 * ce qui manquait. Les deux modules sont donc chargés pour de vrai, dans leur ordre de
 * `index.html`, et le serveur est joué par un `fetch` qui arbitre les révisions.
 *
 * CE QUI EST MESURÉ AILLEURS
 * --------------------------
 * Le même scénario, navigateur réel contre PostgreSQL réel, sur `fae6538` :
 *
 *     PUT /api/data/docs/kb-aja-ogfsmini → 409 · charge rév. 1 · centre rév. 2
 *     syncQueue : conflict / STALE_WRITE — encore là après deux cycles d'instantané
 *     central-sync-status : state:'conflict' ×2
 *     témoin humain : conflit visible, conservé
 *
 * Les quatre épreuves ci-dessous tiennent cette mesure en CI, y compris la dernière ligne :
 * le contrat humain doit rester exactement ce qu'il était.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ── Les minuteries de `central-sync` (battement de 20 s) ne doivent pas retenir le banc ── */
const minuteries = [];
const vraiSetTimeout = globalThis.setTimeout;
const vraiSetInterval = globalThis.setInterval;
globalThis.setTimeout = (...arguments_) => { const jeton = vraiSetTimeout(...arguments_); minuteries.push(['t', jeton]); return jeton; };
globalThis.setInterval = (...arguments_) => { const jeton = vraiSetInterval(...arguments_); minuteries.push(['i', jeton]); return jeton; };
test.after(() => { for (const [genre, jeton] of minuteries) (genre === 'i' ? clearInterval : clearTimeout)(jeton); });

/* ── Un `window` qui distribue réellement les événements : la pastille doit être lisible ── */
const auditeurs = new Map();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = {
  addEventListener: (type, fonction) => { if (!auditeurs.has(type)) auditeurs.set(type, new Set()); auditeurs.get(type).add(fonction); },
  removeEventListener: (type, fonction) => auditeurs.get(type)?.delete(fonction),
  dispatchEvent: evenement => { for (const fonction of auditeurs.get(evenement.type) || []) fonction(evenement); return true; }
};
globalThis.document = { visibilityState:'visible', addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
const memoire = new Map([['auth', JSON.stringify({ id:1, role:'admin', username:'admin' })]]);
globalThis.localStorage = {
  getItem: cle => (memoire.has(cle) ? memoire.get(cle) : null),
  setItem: (cle, valeur) => memoire.set(cle, String(valeur)),
  removeItem: cle => memoire.delete(cle)
};

/* ════════════════════ LE SERVEUR — il arbitre les révisions, rien d'autre ════════════════════ */
const centre = new Map();
let panne = null;          // { status, error, message } imposé à la prochaine écriture
const requetes = [];

const reponse = (statut, corps) => ({
  ok: statut >= 200 && statut < 300,
  status: statut,
  headers: { get: () => null },
  async text() { return JSON.stringify(corps); }
});

globalThis.fetch = async (chemin, options = {}) => {
  const url = String(chemin);
  const methode = String(options.method || 'GET').toUpperCase();
  requetes.push({ methode, url });
  if (methode === 'GET' && url.startsWith('/api/sync')) {
    return reponse(200, { initialized:true, data:{}, deleted:[], authoritativeStores:[], access:{}, serverTime:new Date().toISOString() });
  }
  const ecriture = url.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
  if (ecriture && methode === 'PUT') {
    if (panne) return reponse(panne.status, { error:panne.error, message:panne.message });
    const [, store, id] = ecriture;
    const cle = `${store}|${decodeURIComponent(id)}`;
    const charge = JSON.parse(options.body || '{}');
    const courante = Number(centre.get(cle)?._revision || 0);
    const declaree = Number(charge?._revision || 0);
    if (declaree !== courante) {
      return reponse(409, { error:'STALE_WRITE', message:'Cette donnée a été modifiée par un autre utilisateur.', currentRevision:courante });
    }
    const suivante = courante + 1;
    centre.set(cle, { ...charge, _revision:suivante });
    return reponse(200, { record:{ ...charge, _revision:suivante }, revision:suivante });
  }
  return reponse(404, { error:'NOT_FOUND' });
};

/* ════════════════════ LA BASE LOCALE — assez pour que la file existe vraiment ════════════════════ */
const { db } = await import('../db.js');
const local = new Map();

db.open = async () => ({});
db.db = null;                       // pas d'IndexedDB : les boucles d'instantané se taisent
db.normalizeKey = valeur => String(valeur);
db.get = async (store, id) => {
  const trouve = local.get(`${store}|${id}`);
  return trouve ? JSON.parse(JSON.stringify(trouve)) : undefined;
};
db._getRaw = db.get;
db.getAll = async store => [...local.entries()].filter(([cle]) => cle.startsWith(`${store}|`)).map(([, v]) => JSON.parse(JSON.stringify(v)));
db.save = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${local.size}`);
  local.set(`${store}|${id}`, JSON.parse(JSON.stringify({ ...enregistrement, id })));
  return id;
};
db.delete = async (store, id) => local.delete(`${store}|${id}`);
db._deleteRaw = db.delete;

/* L'ordre d'`index.html` : `central-sync` enveloppe `db.save`, puis le garde l'enveloppe. */
await import('../central-sync.js');
const garde = await import('../catalog-seed-guard.js');
const contrat = await import('../record-ownership-contract.js');
const { QUEUE_STATUSES } = await import('../revision-contract.js');

/* `enableCentralSync` est ce qui pose `remoteReady` : sans lui, rien ne partirait. */
await db.enableCentralSync({ bootstrapLocal:false });
assert.equal(db.isCentralSyncReady(), true, 'la synchronisation centrale doit être prête');

const FICHE_ID = 'kb-sonde-file-98';
const gabarit = revision => ({
  id:FICHE_ID, kind:'equipment_catalog', targetType:'equipment_catalog',
  manufacturer:'Sonde', model:'File', origin:'seed-extra', _revision:revision
});

const etats = [];
window.addEventListener('central-sync-status', evenement => etats.push(evenement.detail?.state));

function decor({ revisionLocale = 1, revisionCentrale = 1 } = {}) {
  // Le tampon du garde n'a pas de remise à zéro, et c'est très bien : qu'il soit vide au
  // début de chaque épreuve est une PROPRIÉTÉ du remède — une charge livrée ou périmée en
  // sort d'elle-même. Le vérifier ici garde les épreuves indépendantes sans le forcer.
  assert.equal(window.CatalogSeedGuard.pending(), 0, 'chaque épreuve doit partir d’un tampon vide');
  local.clear();
  centre.clear();
  requetes.length = 0;
  etats.length = 0;
  panne = null;
  contrat.resetCatalogBuffer();
  local.set('settings|global', { id:'global', language:'fr', catalogSeedVersion:garde.CENTRAL_CATALOG_VERSION });
  local.set(`docs|${FICHE_ID}`, gabarit(revisionLocale));
  centre.set(`docs|${FICHE_ID}`, { ...gabarit(revisionCentrale), noteAutre:'écrite par quelqu’un d’autre' });
}

const file = async () => (await db.getAll('syncQueue')).map(entree => ({
  store:entree.storeName, id:String(entree.entityId), status:entree.status,
  code:entree.lastErrorCode ?? null, revisionCharge:entree.data?._revision ?? null
}));
const terminales = entrees => entrees.filter(e => e.status === QUEUE_STATUSES.CONFLICT || e.status === QUEUE_STATUSES.FAILED);
const refus409 = () => requetes.filter(r => r.methode === 'PUT' && r.url.includes(FICHE_ID)).length;

/* ═══════════ 1. LE DÉFAUT MESURÉ : un enrichissement automatique périmé ═══════════ */

test('automatique périmé : 409, le tampon cède, et AUCUN conflit n’entre dans la file', async () => {
  // Le centre est à la révision 2, la copie locale est restée à 1 : la charge naît périmée.
  decor({ revisionLocale:1, revisionCentrale:2 });

  await db.save('docs', { ...gabarit(1), enrichissement:'calculé-sur-revision-1' });
  assert.equal(contrat.recordOwnership('docs', FICHE_ID), 'catalog-buffered', 'la charge doit être retenue');

  await garde.installCentralCatalogOnce();

  assert.equal(refus409(), 1, 'la charge doit avoir été présentée au serveur, une fois');
  assert.deepEqual(terminales(await file()), [],
    'un enrichissement AUTOMATIQUE ne doit laisser aucun conflit à résoudre dans la file');
  assert.ok(!etats.includes('conflict'),
    'et la pastille ne doit jamais rougir pour une livraison que personne n’a demandée');

  // Elle a bel et bien CÉDÉ : rien ne repart aux tours suivants.
  await garde.installCentralCatalogOnce();
  await garde.installCentralCatalogOnce();
  assert.equal(refus409(), 1, 'la charge périmée ne doit pas être rejouée');
  assert.deepEqual(await file(), [], 'et la file reste entièrement vide');
});

/* ═══════════ 2. LE CONTRAT QUI NE BOUGE PAS : la même fiche, saisie par un HUMAIN ═══════════ */

test('humaine périmée sur la MÊME fiche : le conflit apparaît, et il reste', async () => {
  /*
   * C'est la contre-épreuve, et elle porte sur le même magasin et le même identifiant : si
   * le remède avait touché au contrat de révision — ou nettoyé la file après coup — c'est
   * ICI que la perte se verrait.
   */
  decor({ revisionLocale:1, revisionCentrale:2 });

  // Une saisie humaine ne passe pas par le tampon : hors fenêtre d'amorçage, voie ordinaire.
  await assert.rejects(
    () => db.save('equipments', { id:'equipment-sonde-98', name:'Saisie humaine', _revision:1 }),
    erreur => erreur.status === 409 && erreur.code === 'STALE_WRITE',
    'le serveur doit refuser une saisie humaine périmée');

  const entrees = terminales(await file());
  assert.equal(entrees.length, 1, 'le refus humain DOIT laisser une entrée dans la file');
  assert.equal(entrees[0].status, QUEUE_STATUSES.CONFLICT);
  assert.equal(entrees[0].code, 'STALE_WRITE');
  assert.ok(etats.includes('conflict'), 'et la pastille doit l’annoncer : un geste humain a été perdu');

  // Terminale veut dire terminale : aucun passage ultérieur ne l'efface.
  await garde.installCentralCatalogOnce();
  assert.equal(terminales(await file()).length, 1, 'le conflit humain ne doit jamais être balayé');
});

/* ═══════════ 3. UN INCIDENT PASSAGER NE DIT RIEN DU CONTENU ═══════════ */

test('automatique refusé passagèrement : la charge reste due, puis elle est livrée', async () => {
  decor({ revisionLocale:2, revisionCentrale:2 });

  await db.save('docs', { ...gabarit(2), enrichissement:'valeur' });
  panne = { status:503, error:'SERVICE_UNAVAILABLE', message:'Service indisponible.' };
  await garde.installCentralCatalogOnce();

  assert.deepEqual(await file(), [],
    'une livraison de fond n’occupe jamais la file de l’utilisateur, même en attente');
  assert.equal(contrat.recordOwnership('docs', FICHE_ID), 'catalog-buffered',
    'un refus PASSAGER ne dit rien du contenu : la charge reste due');

  panne = null;
  const reprise = await garde.installCentralCatalogOnce();
  assert.deepEqual(reprise.delivered, [FICHE_ID], 'et au rétablissement, elle part');
  assert.equal(centre.get(`docs|${FICHE_ID}`)?.enrichissement, 'valeur',
    'le contenu retenu doit avoir atteint le centre');
});

/* ═══════════ 4. RIEN N'EST PERDU : le producteur recalcule depuis la vérité fraîche ═══════════ */

test('recalcul depuis la révision fraîche : celui-là est accepté et atteint le centre', async () => {
  decor({ revisionLocale:1, revisionCentrale:2 });

  await db.save('docs', { ...gabarit(1), enrichissement:'calculé-sur-revision-1' });
  await garde.installCentralCatalogOnce();
  assert.deepEqual(terminales(await file()), [], 'le refus périmé n’a rien laissé derrière lui');

  // L'instantané suivant a imposé la vérité du serveur : la fiche locale porte 2.
  local.set(`docs|${FICHE_ID}`, gabarit(2));

  // Le producteur, idempotent, repasse au `synced` suivant et recalcule depuis CETTE version.
  await db.save('docs', { ...gabarit(2), enrichissement:'recalculé-sur-revision-2' });
  const resultat = await garde.installCentralCatalogOnce();

  assert.deepEqual(resultat.delivered, [FICHE_ID], 'le recalcul doit être livré');
  assert.equal(centre.get(`docs|${FICHE_ID}`)?.enrichissement, 'recalculé-sur-revision-2',
    'et c’est bien le contenu FRAIS qui est au centre');
  assert.equal(centre.get(`docs|${FICHE_ID}`)?._revision, 3, 'le serveur reste seul maître de la révision');
  assert.deepEqual(await file(), [], 'sans rien avoir laissé dans la file');
});

/* ═══════════ 5. LA PORTE RESTE ÉTROITE — RECENSEMENT SUR L'ARBRE RÉEL ═══════════ */

test('BACKGROUND_DELIVERY n’est ouvert qu’à la livraison de fond du catalogue', async () => {
  /*
   * Le remède ne vaut que tant que la porte reste étroite. Ouvrir ce jeton depuis un écran
   * ferait disparaître EN SILENCE le conflit d'un utilisateur : le geste serait perdu, la
   * file muette, la pastille verte. C'est précisément le dégât que #98 combat, retourné.
   *
   * Ce recensement ne fige aucune formulation : il parcourt les modules du dépôt et compte
   * QUI importe le jeton. Le contrat qui le définit et le transport qui l'interprète ne
   * l'importent pas — ils le déclarent. Un seul appelant, donc, et il est nommé.
   */
  const { readdirSync, readFileSync } = await import('node:fs');
  const racine = new URL('../', import.meta.url);
  // Le jeton se cite abondamment dans les commentaires : ce sont les IMPORTS qui comptent,
  // et un recensement qui compterait de la prose se romprait à la première relecture.
  const sansCommentaires = source => source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter(ligne => !/^\s*(\/\/|\*)/.test(ligne))
    .join('\n');
  const code = new Map(readdirSync(racine).filter(nom => nom.endsWith('.js'))
    .map(nom => [nom, sansCommentaires(readFileSync(new URL(nom, racine), 'utf8'))]));

  const porteurs = [...code].filter(([, source]) => /\bBACKGROUND_DELIVERY\b/.test(source)).map(([nom]) => nom);
  assert.deepEqual(porteurs.sort(), ['catalog-seed-guard.js', 'revision-contract.js'],
    'seuls le contrat qui déclare le jeton et la livraison de fond du catalogue le nomment');

  const guard = code.get('catalog-seed-guard.js');
  assert.equal((guard.match(/BACKGROUND_DELIVERY/g) || []).length, 2,
    'et le garde ne s’en sert qu’une fois : l’import, puis la livraison');
  assert.match(guard, /previousSave\('docs', record, BACKGROUND_DELIVERY\)/,
    'le jeton accompagne la livraison retenue, et rien d’autre');
});
