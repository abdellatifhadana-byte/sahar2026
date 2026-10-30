/**
 * @file tests/catalog-buffer-stale-98.test.js — #98 : un enrichissement AUTOMATIQUE périmé
 *       cède devant la vérité du serveur, il ne s'installe pas en conflit perpétuel.
 *
 * LA SITUATION
 * ------------
 * Un producteur automatique enrichit une fiche de catalogue à partir de la révision N, et
 * `catalog-seed-guard` la retient. Pendant ce temps, quelqu'un d'autre modifie la MÊME
 * fiche au centre : le serveur passe à N+1. Quand la livraison part enfin, elle porte N —
 * et le serveur répond, à juste titre, 409 STALE_WRITE.
 *
 * CE QUI EST EN JEU
 * -----------------
 * La charge retenue est désormais OBSOLÈTE : elle a été calculée sur une version que plus
 * personne n'a. La rejouer produirait le même refus, indéfiniment — un conflit automatique
 * répété, né d'un ensemencement de fond, que l'utilisateur n'a pas demandé et ne peut pas
 * résoudre. C'est exactement ce que #98 interdit.
 *
 * LA RÈGLE
 * --------
 * Un enrichissement AUTOMATIQUE périmé CÈDE : il quitte le tampon. Le producteur, qui est
 * idempotent et repasse à chaque `synced`, le recalculera depuis la vérité fraîche s'il est
 * encore pertinent. On ne perd donc pas l'intention — on refuse seulement de la réémettre
 * sous une forme que le serveur a déjà démentie.
 *
 * CE QUE CETTE RÈGLE NE TOUCHE PAS
 * ---------------------------------
 * Le contrat 409 STALE_WRITE de l'UTILISATEUR. Une saisie humaine ne passe jamais par ce
 * tampon : `saveWithBootCatalogGuard` n'y détourne que les fiches de catalogue automatiques,
 * et seulement pendant la fenêtre d'amorçage. Le refus reste net, visible, et porté par la
 * file — c'est éprouvé ailleurs, et rien ici ne l'assouplit.
 *
 * CE QUE CETTE ÉPREUVE NE VOIT PAS
 * --------------------------------
 * La FILE. Le faux `db.save` ci-dessous relance le refus sans l'écrire, là où `central-sync`
 * consigne d'abord une entrée `conflict`. Céder le tampon arrête le rejeu ; cela n'efface
 * pas l'entrée déjà écrite. Cette moitié-là se prouve en montant la vraie chaîne, et c'est
 * `tests/catalog-buffer-queue-98.test.js` qui s'en charge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const minuteries = [];
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...arguments_) => { const jeton = vraiSetTimeout(...arguments_); minuteries.push(jeton); return jeton; };
test.after(() => { for (const jeton of minuteries) clearTimeout(jeton); });

const rien = () => {};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.window = { addEventListener: rien, removeEventListener: rien, dispatchEvent: () => true };
globalThis.document = { addEventListener: rien, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.localStorage = { getItem: cle => (cle === 'auth' ? JSON.stringify({ id: 1, role: 'admin' }) : null), setItem: rien, removeItem: rien };
globalThis.fetch = async () => ({ ok: false, status: 404, async text() { return ''; }, async json() { return {}; } });

const { db } = await import('../db.js');

const donnees = new Map();
let poussees = [];
/** Le serveur refuse-t-il la prochaine poussée, et avec quel code ? */
let refuserPoussee = null;

db.open = async () => ({});
db.normalizeKey = valeur => String(valeur);
db.isCentralSyncReady = () => true;
db.get = async (store, id) => {
  const trouve = donnees.get(`${store}|${id}`);
  return trouve ? JSON.parse(JSON.stringify(trouve)) : undefined;
};
db._getRaw = db.get;
db.getAll = async store => [...donnees.entries()].filter(([cle]) => cle.startsWith(`${store}|`)).map(([, v]) => JSON.parse(JSON.stringify(v)));
db.save = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${donnees.size}`);
  poussees.push({ store, id, enregistrement: JSON.parse(JSON.stringify(enregistrement)) });
  if (refuserPoussee) {
    /*
     * CE FAUX N'EST QU'UN TRANSPORT, ET IL FAUT LE DIRE.
     *
     * Il relance le refus, comme `central-sync`, mais il n'écrit PAS `syncQueue` — ce que
     * `central-sync` fait pourtant, par `recordRejectedOperation`, avant de relancer. Cette
     * épreuve-ci porte donc sur une seule chose : le TAMPON du garde, cède-t-il ou boucle-t-il.
     *
     * Ce qui reste dans la file après le refus est une autre question, et un faux qui n'écrit
     * pas la file serait aveugle à y répondre. Elle est traitée là où la vraie chaîne est
     * montée — `central-sync` puis le garde, dans l'ordre d'`index.html` — dans
     * `tests/catalog-buffer-queue-98.test.js`.
     */
    const erreur = new Error(refuserPoussee.message || 'Refus du serveur.');
    erreur.status = refuserPoussee.status;
    erreur.code = refuserPoussee.code;
    throw erreur;
  }
  donnees.set(`${store}|${id}`, JSON.parse(JSON.stringify({ ...enregistrement, id })));
  return id;
};
db.saveLocalOnly = async (store, enregistrement) => {
  const id = String(enregistrement?.id ?? `auto-${donnees.size}`);
  donnees.set(`${store}|${id}`, JSON.parse(JSON.stringify({ ...enregistrement, id })));
  return id;
};
db.delete = async (store, id) => donnees.delete(`${store}|${id}`);
db._deleteRaw = db.delete;

const garde = await import('../catalog-seed-guard.js');
const contrat = await import('../record-ownership-contract.js');

const FICHE = Object.freeze({
  id: 'kb-sonde-perimee', kind: 'equipment_catalog', targetType: 'equipment_catalog',
  manufacturer: 'Sonde', model: 'Périmée', origin: 'seed-extra'
});

function decor() {
  donnees.clear();
  poussees = [];
  refuserPoussee = null;
  contrat.resetCatalogBuffer();
  donnees.set('settings|global', { id: 'global', language: 'fr', catalogSeedVersion: garde.CENTRAL_CATALOG_VERSION });
  donnees.set(`docs|${FICHE.id}`, { ...FICHE, _revision: 1 });
}

/* ═══════ UN ENRICHISSEMENT AUTOMATIQUE PÉRIMÉ NE SE REJOUE PAS INDÉFINIMENT ═══════ */

test('enrichissement automatique refusé en 409 : il cède, il ne boucle pas', async () => {
  decor();

  // Le producteur enrichit depuis la révision 1, et le garde retient.
  await db.save('docs', { ...FICHE, _revision: 1, sondeEnrichissement: 'calculé-sur-revision-1' });
  assert.equal(contrat.recordOwnership('docs', FICHE.id), 'catalog-buffered',
    'l’enrichissement doit être retenu');

  // Entre-temps, quelqu'un d'autre a fait avancer la fiche au centre : la charge est périmée.
  refuserPoussee = { status: 409, code: 'STALE_WRITE', message: 'Cette donnée a été modifiée par un autre utilisateur.' };
  const premiere = await garde.installCentralCatalogOnce();
  assert.equal(premiere.delivered?.length ?? 0, 0, 'une charge refusée n’est pas « livrée »');
  assert.equal(poussees.length, 1, 'une seule tentative doit avoir eu lieu');

  // LE POINT QUI COMPTE : la charge périmée ne doit pas repartir aux tours suivants.
  const apresPremier = poussees.length;
  await garde.installCentralCatalogOnce();
  await garde.installCentralCatalogOnce();
  assert.equal(poussees.length, apresPremier,
    'la charge périmée est rejouée à chaque tour : conflit automatique perpétuel');
});

test('le producteur peut recalculer depuis la vérité fraîche, et CELUI-LÀ passe', async () => {
  decor();

  await db.save('docs', { ...FICHE, _revision: 1, sondeEnrichissement: 'calculé-sur-revision-1' });
  refuserPoussee = { status: 409, code: 'STALE_WRITE', message: 'Cette donnée a été modifiée par un autre utilisateur.' };
  await garde.installCentralCatalogOnce();

  // Le serveur a imposé sa vérité : la fiche locale porte maintenant la révision 2.
  donnees.set(`docs|${FICHE.id}`, { ...FICHE, _revision: 2 });
  refuserPoussee = null;

  // Le producteur, idempotent, repasse et recalcule depuis CETTE version-là.
  await db.save('docs', { ...FICHE, _revision: 2, sondeEnrichissement: 'recalculé-sur-revision-2' });
  const resultat = await garde.installCentralCatalogOnce();

  assert.deepEqual(resultat.delivered, [FICHE.id], 'le recalcul doit, lui, être livré');
  const derniere = poussees.at(-1);
  assert.equal(derniere.enregistrement.sondeEnrichissement, 'recalculé-sur-revision-2');
  assert.equal(derniere.enregistrement._revision, 2, 'et il porte la révision FRAÎCHE');
});

test('un refus PASSAGER, lui, n’efface rien : la charge reste due', async () => {
  /*
   * Tout refus n'est pas un démenti. Une coupure réseau ou un 503 ne dit rien du contenu :
   * la charge reste valable et doit être retentée. Seul un refus PERMANENT — le serveur a
   * une vérité plus récente — rend l'enrichissement automatique obsolète.
   */
  decor();
  await db.save('docs', { ...FICHE, _revision: 1, sondeEnrichissement: 'valeur' });

  // 503 : le serveur n'a pas examiné la charge. Rien n'est dit du contenu.
  refuserPoussee = { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service indisponible.' };
  await garde.installCentralCatalogOnce();
  const apresRefus = poussees.length;

  refuserPoussee = null;
  const reprise = await garde.installCentralCatalogOnce();
  assert.deepEqual(reprise.delivered, [FICHE.id],
    'une charge refusée passagèrement doit être retentée puis livrée');
  assert.ok(poussees.length > apresRefus);
});
