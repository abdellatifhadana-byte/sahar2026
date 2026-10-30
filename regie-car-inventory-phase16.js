import { db } from './db.js';
import { loadRegieCarDataset } from './regie-car-dataset.js';

export const REGIE_CAR_PHASE16_VERSION = 1;
export const REGIE_CAR_ROOM_KEY = 'field-room:regie-car';
export const REGIE_CAR_ROOM_ID = 'room-regie-car';
export const REGIE_CAR_BATCH_ID = 'field-batch-regie-car-2026-08-16';
export const REGIE_CAR_SOURCE_DATE = '2026-08-16';

/*
 * LE RELEVÉ N'EST PLUS ICI (A-5).
 *
 * Les baies réellement présentes, le matériel monté dans chacune, les repères
 * d'exploitation, les numéros d'inventaire et les résumés de photos de terrain vivaient
 * dans ce fichier, servi à la racine : 38 361 octets rendus à un client SANS session.
 *
 * Ils vivent désormais sous `scripts/private-operational-data/regie-car.js`, que le serveur
 * refuse de servir, et n'arrivent que par `/api/operational/regie-car/inventory`, après
 * autorisation sur la salle. Ce module garde la LOGIQUE — la politique d'amorçage, la fusion
 * non destructrice, l'identité des enregistrements — qui n'apprend rien sur l'installation.
 *
 * Ces quatre liaisons sont donc vides tant que le serveur n'a rien accordé, et
 * `runEnsureRegieCarPhase16()` ne touche à RIEN dans ce cas : pas de repli, pas de
 * reconstruction, pas d'écriture partielle.
 */
let REGIE_CAR_FIELD_EVIDENCE = [];
let REGIE_CAR_CATALOG = [];
let REGIE_CAR_BAIES = [];
let REGIE_CAR_EQUIPMENT = [];

const CATALOG_KIND = 'equipment_catalog';
const ORIGIN = 'regie-car-phase16';
const asArray = value => Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
const now = () => new Date().toISOString();
const text = (value,max=500) => String(value ?? '').trim().slice(0,max);
const normalize = value => text(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');


export const REGIE_CAR_PHASE16_POLICY = Object.freeze({
  additiveOnly:true,
  clearsOperationalStores:false,
  replaceOperational:false,
  preserveExistingUserData:true,
  protectAdminLockedRecords:true,
  fillMissingFieldsOnlyOnExistingRecords:true,
  fieldEvidenceSeparateFromOfficialImages:true,
  noAutomaticCableInference:true,
  noAutomaticRearPortMapping:true,
  noAutomaticCrosspointInference:true,
  exactModelRequiresReadableFieldMarking:true,
  familyOnlyWhenExactModelUnreadable:true,
  unresolvedRackPositionRemainsToConfirm:true
});


function adminLocked(record) {
  const origin = String(record?.origin || '').toLowerCase();
  return origin.startsWith('admin') || record?.locked === true || record?.adminLocked === true || record?.manualOverride === true;
}

function union(a,b) { return [...new Set([...asArray(a),...asArray(b)].filter(Boolean))]; }

/*
 * FUSIONNER N'EST PAS DATER (#164).
 *
 * `fillMissing` posait `updatedAt = now()` AVANT que l'appelant compare le résultat à
 * l'existant. La comparaison `JSON.stringify(next) !== JSON.stringify(existing)` était
 * donc TOUJOURS vraie — une horloge diffère toujours d'elle-même une milliseconde plus
 * tard — et chaque appel réécrivait, qu'une donnée métier ait changé ou non. Sur un
 * ensemencement qui tourne à chaque démarrage, et pour chaque enregistrement du lot,
 * c'est la boucle mesurée par #164 : rien n'avait changé, tout était réécrit.
 *
 * `fillMissing` ne touche donc plus `updatedAt` : c'est à l'appelant de comparer le
 * résultat à l'existant AVANT de dater, avec `estIdentique`, puis de ne dater et
 * persister QUE si une différence réelle existe — le même contrat que `saveSeedDoc`
 * applique déjà dans `grille-centrale-documented-map.js`.
 */
function fillMissing(existing,incoming) {
  const next = { ...existing };
  for (const [key,value] of Object.entries(incoming)) {
    if (['id','createdAt','updatedAt','origin'].includes(key)) continue;
    if (key === 'fieldEvidenceRefs') { next[key] = union(existing[key], value); continue; }
    if (key === 'technicalFacts') { next[key] = union(existing[key], value); continue; }
    const current = existing[key];
    const missing = current == null || current === '' || (Array.isArray(current) && current.length === 0);
    if (missing) next[key] = value;
  }
  return next;
}

const estIdentique = (next,existing) => JSON.stringify(next) === JSON.stringify(existing);

async function ensureCatalog() {
  let created = 0, enriched = 0, protectedCount = 0;
  for (const base of REGIE_CAR_CATALOG) {
    const incoming = { ...base,kind:CATALOG_KIND,targetType:CATALOG_KIND,targetId:base.id,origin:ORIGIN,visibility:'all-non-sensitive',verifiedAt:REGIE_CAR_SOURCE_DATE,updatedAt:now(),createdAt:now() };
    const existing = await db.get('docs', base.id).catch(() => null);
    if (!existing) { await db.save('docs',incoming); created += 1; continue; }
    if (adminLocked(existing)) { protectedCount += 1; continue; }
    const next = fillMissing(existing,incoming);
    if (!estIdentique(next,existing)) { await db.save('docs',{...next,updatedAt:now()}); enriched += 1; }
  }
  return { created,enriched,protected:protectedCount };
}

async function ensureEvidenceBatch() {
  const existing = await db.get('docs',REGIE_CAR_BATCH_ID).catch(() => null);
  if (existing && adminLocked(existing)) return existing;
  const base = {
    id:REGIE_CAR_BATCH_ID,kind:'field_evidence_batch',targetType:'field_evidence_batch',title:'Régie Car — lot terrain 2026-08-16',
    sourceContext:'mobile-production-unit',sourceLabel:'Régie Car',observedAt:'2026-08-16T12:00:00+01:00',status:'open',
    itemIds:REGIE_CAR_FIELD_EVIDENCE.map(item => item.id),evidenceCount:REGIE_CAR_FIELD_EVIDENCE.length,
    policy:'field-evidence-separated-from-inventory-and-official-images',binaryMediaStatus:'pending-pwa-pack',origin:ORIGIN,createdAt:existing?.createdAt || now()
  };
  const batch = existing ? fillMissing(existing,base) : base;
  if (!existing || !estIdentique(batch,existing)) await db.save('docs',{...batch,updatedAt:now()});
  for (const evidence of REGIE_CAR_FIELD_EVIDENCE) {
    const current = await db.get('docs',evidence.id).catch(() => null);
    if (current && adminLocked(current)) continue;
    const record = {
      id:evidence.id,kind:'field_evidence_intake',targetType:'field_evidence',batchId:REGIE_CAR_BATCH_ID,
      assetRef:evidence.id,captureType:evidence.kind,sourceContext:'mobile-production-unit',sourceLabel:'Régie Car',observedAt:'2026-08-16T12:00:00+01:00',
      classification:'physical-context',reviewState:'accepted',linkState:'candidate',summary:evidence.summary,mediaStatus:evidence.mediaStatus,
      automaticPromotionApplied:false,topologyCreated:false,cableCreated:false,crosspointCreated:false,origin:ORIGIN,createdAt:current?.createdAt || now()
    };
    const next = current ? fillMissing(current,record) : record;
    if (!current || !estIdentique(next,current)) await db.save('docs', {...next,updatedAt:now()});
  }
  return batch;
}

async function ensureRoom() {
  const rooms = await db.getAll('rooms');
  const existing = rooms.find(room => room.fieldIdentityKey === REGIE_CAR_ROOM_KEY || normalize(room.name || room.nom) === 'regie car');
  if (existing) {
    if (adminLocked(existing)) return existing;
    const next = fillMissing(existing,{
      fieldIdentityKey:REGIE_CAR_ROOM_KEY,source:'Lot photo terrain Régie Car 2026-08-16',verificationStatus:'field-photo-confirmed',sourceLayer:'current-field-evidence',mobileUnit:true,roomType:'mobile-production-unit',fieldEvidenceRefs:REGIE_CAR_FIELD_EVIDENCE.map(item => item.id)
    });
    if (estIdentique(next,existing)) return existing;
    const dated = {...next,updatedAt:now()};
    await db.save('rooms',dated);
    return dated;
  }
  const room = {
    id:REGIE_CAR_ROOM_ID,fieldIdentityKey:REGIE_CAR_ROOM_KEY,name:'Régie Car',nom:'Régie Car',description:'Unité mobile de production/réalisation broadcast — structure et équipements inventoriés progressivement à partir des preuves terrain.',
    roomType:'mobile-production-unit',mobileUnit:true,source:'Lot photo terrain Régie Car 2026-08-16',verificationStatus:'field-photo-confirmed',sourceLayer:'current-field-evidence',
    fieldEvidenceRefs:REGIE_CAR_FIELD_EVIDENCE.map(item => item.id),origin:ORIGIN,createdAt:now(),updatedAt:now()
  };
  await db.save('rooms',room);
  return room;
}

async function ensureBaies(roomId) {
  const baies = await db.getAll('baies');
  const result = [];
  for (const base of REGIE_CAR_BAIES) {
    const existing = baies.find(baie => baie.fieldIdentityKey === base.fieldIdentityKey || (String(baie.roomId) === String(roomId) && normalize(baie.name || baie.nom) === normalize(base.name)));
    if (existing) {
      if (adminLocked(existing)) { result.push(existing); continue; }
      const next = fillMissing(existing,{...base,roomId});
      if (estIdentique(next,existing)) { result.push(existing); continue; }
      const dated = {...next,updatedAt:now()};
      await db.save('baies',dated);
      result.push(dated);
      continue;
    }
    const record = {...base,roomId,createdAt:now(),updatedAt:now()};
    await db.save('baies',record);
    result.push(record);
  }
  return result;
}

function remapBaieId(equipment,baieBySeedId) {
  if (!equipment.baieId) return null;
  return baieBySeedId.get(String(equipment.baieId))?.id || equipment.baieId;
}

async function ensureEquipments(roomId,baies) {
  const existing = await db.getAll('equipments');
  const byFieldKey = new Map(existing.map(item => [String(item.fieldInventoryKey || ''),item]).filter(([key]) => key));
  const byId = new Map(existing.map(item => [String(item.id),item]));
  const baieBySeedId = new Map(REGIE_CAR_BAIES.map((base,index) => [String(base.id),baies[index]]));
  let created=0,enriched=0,protectedCount=0,collisions=0;
  for (const base of REGIE_CAR_EQUIPMENT) {
    const incoming = {...base,roomId,baieId:remapBaieId(base,baieBySeedId),inventorySource:{source:'Régie Car field-photo batch',batchId:REGIE_CAR_BATCH_ID,evidenceRefs:base.fieldEvidenceRefs},createdAt:now(),updatedAt:now()};
    let current = byFieldKey.get(base.fieldInventoryKey) || byId.get(String(base.id));
    if (!current && base.inventorySticker) current = existing.find(item => String(item.inventorySticker || '').trim() === String(base.inventorySticker).trim()) || null;
    if (!current) {
      await db.save('equipments',incoming); created += 1; byFieldKey.set(base.fieldInventoryKey,incoming); byId.set(String(base.id),incoming); continue;
    }
    if (current.fieldInventoryKey && current.fieldInventoryKey !== base.fieldInventoryKey && String(current.id) === String(base.id)) { collisions += 1; continue; }
    if (adminLocked(current)) { protectedCount += 1; continue; }
    const next = fillMissing(current,incoming);
    next.fieldEvidenceRefs = union(current.fieldEvidenceRefs,incoming.fieldEvidenceRefs);
    next.inventorySource = current.inventorySource || incoming.inventorySource;
    if (!estIdentique(next,current)) { await db.save('equipments',{...next,updatedAt:now()}); enriched += 1; }
  }
  return {created,enriched,protected:protectedCount,collisions,totalSeed:REGIE_CAR_EQUIPMENT.length};
}

/*
 * NE PAS ÉCRIRE À CHEVAL SUR LA BASCULE HORS LIGNE → EN LIGNE (#162).
 *
 * `db.save()` (`central-sync.js`) envoie IMMÉDIATEMENT au serveur si `remoteReady` est
 * déjà tranché, et sinon MET EN FILE pour un envoi plus tard, au rythme propre de cette
 * file. Si l'ensemencement commence AVANT que la bascule ne soit tranchée et que
 * `remoteReady` passe à vrai EN COURS DE ROUTE, ses premières écritures (salle, baies)
 * partent en file — à vider plus tard — tandis que ses écritures suivantes (équipements)
 * partent IMMÉDIATEMENT : un équipement peut alors atteindre le serveur avant que son
 * parent, resté en file, n'y soit lui-même arrivé. C'est exactement le
 * `INVALID_EQUIPMENT_LOCATION` mesuré : la salle ou la baie n'existe pas ENCORE côté
 * serveur au moment où le serveur reçoit l'équipement.
 *
 * Attendre que la bascule soit tranchée avant la première écriture garantit que TOUT
 * l'ensemencement tombe du même côté — file ou envoi immédiat — jamais à cheval.
 *
 * UN PREMIER `central-sync-status` NE PROUVE RIEN (revue externe).
 *
 * Le démarrage émet une rafale de `offline`/`warning`/`conflict` — des signaux de FILE,
 * posés par `db.save()`/`db.delete()` ou par le rejeu d'une entrée, SANS rapport avec la
 * bascule elle-même — bien avant que l'instantané central n'ait été appliqué. S'arrêter au
 * premier événement, quel qu'il soit, rouvrait exactement la course qu'on voulait fermer.
 *
 * Seuls comptent : un événement portant `updatedAt` — la preuve qu'un instantané a
 * RÉELLEMENT été appliqué (`enableCentralSync`, après `applySnapshot`, jamais avant) — ou
 * un échec terminal de la tentative centrale ELLE-MÊME (`local`, `unauthenticated` SANS
 * `updatedAt` : la requête d'instantané a échoué, ou une session expirée l'interrompt), qui
 * ferme la tentative sans qu'un instantané ne suive.
 */
export const decisionSyncEtablie = detail => {
  if (detail?.updatedAt) return true;
  const etat = String(detail?.state || '');
  return etat === 'local' || etat === 'unauthenticated';
};

export function attendreDecisionSync() {
  if (typeof window === 'undefined' || db.isCentralSyncReady?.()) return Promise.resolve();
  return new Promise(resolve => {
    let reglee = false;
    const regler = () => {
      if (reglee) return;
      reglee = true;
      window.removeEventListener('central-sync-status', ecouteur);
      resolve();
    };
    const ecouteur = event => { if (decisionSyncEtablie(event?.detail)) regler(); };
    window.addEventListener('central-sync-status', ecouteur);
    // Filet de sécurité : une session qui ne tente jamais la synchronisation centrale
    // n'émettrait jamais un événement recevable ici — l'ensemencement local ne doit pas en
    // dépendre indéfiniment. `central-sync.js` borne chaque requête à 25 s
    // (`REQUEST_TIMEOUT_MS`) ; ce filet reste délibérément AU-DESSUS, pour ne jamais
    // libérer pendant qu'une tentative en cours peut encore aboutir.
    setTimeout(regler, 30000);
  });
}

async function runEnsureRegieCarPhase16() {
  await attendreDecisionSync();
  /*
   * LE RELEVÉ D'ABORD, ET S'IL EST REFUSÉ ON NE FAIT RIEN.
   *
   * `null` veut dire « pas de session », « pas d'habilitation » ou « serveur injoignable ».
   * Dans les trois cas la réponse est la même : aucune écriture. Amorcer à moitié laisserait
   * une salle sans ses baies, ou des baies sans leur matériel — et surtout, un repli sur des
   * constantes locales rétablirait la fuite que ce lot vient de fermer.
   */
  const dataset = await loadRegieCarDataset();
  if (!dataset) {
    return { version:REGIE_CAR_PHASE16_VERSION, skipped:true, reason:'dataset-unavailable',
             roomId:null, baies:0, evidence:0, catalog:0, equipments:0, policy:REGIE_CAR_PHASE16_POLICY };
  }
  REGIE_CAR_FIELD_EVIDENCE = dataset.fieldEvidence || [];
  REGIE_CAR_CATALOG = dataset.catalog || [];
  REGIE_CAR_BAIES = dataset.baies || [];
  REGIE_CAR_EQUIPMENT = dataset.equipment || [];
  await db.open();
  const catalog = await ensureCatalog();
  const evidenceBatch = await ensureEvidenceBatch();
  const room = await ensureRoom();
  const baies = await ensureBaies(room.id);
  const equipments = await ensureEquipments(room.id,baies);
  const result = {version:REGIE_CAR_PHASE16_VERSION,roomId:room.id,baies:baies.length,evidence:REGIE_CAR_FIELD_EVIDENCE.length,catalog,equipments,policy:REGIE_CAR_PHASE16_POLICY};
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('regie-car-phase16-updated',{detail:result}));
  return result;
}

/*
 * UN SEUL VOL EN COURS (#98).
 *
 * `equipment-360-host-bridge.js` importe ce module ET `regie-car-prephoto-readiness.js`,
 * qui importe CE module et rappelle `ensureRegieCarPhase16()` depuis son propre code de
 * chargement. Les deux s'exécutent donc quasi ensemble, chacun relisant `rooms`/`baies`/
 * `equipments` PENDANT que l'autre écrit encore les siens : deux fusions concurrentes sur
 * le même enregistrement, chacune fondée sur une lecture que l'autre est en train de
 * périmer. Mesuré : la salle ou une baie encore absente d'un des deux appels, un
 * équipement envoyé avant que son parent n'ait été accepté par le serveur, et des `409`
 * de révision quand les deux fusions se succèdent sur le même document.
 *
 * Un second appel pendant que le premier tourne encore attend donc CE MÊME résultat, au
 * lieu de relancer sa propre traversée. Une fois l'ensemencement terminé — succès ou
 * échec — un appel ultérieur légitime (rechargement de page, nouvelle session) relance
 * normalement.
 */
let vol = null;
export function ensureRegieCarPhase16() {
  if (vol) return vol;
  vol = runEnsureRegieCarPhase16().finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined') {
  window.RegieCarPhase16 = Object.freeze({
    version:REGIE_CAR_PHASE16_VERSION,roomId:REGIE_CAR_ROOM_ID,batchId:REGIE_CAR_BATCH_ID,
    // Le relevé n'est PAS republié sur `window` : ce qui n'est pas servi statiquement ne
    // doit pas redevenir lisible par la console d'un poste non autorisé.
    policy:REGIE_CAR_PHASE16_POLICY,ensure:ensureRegieCarPhase16
  });
  ensureRegieCarPhase16().catch(error => console.warn('Régie Car Phase 16 non initialisée',error));
}
