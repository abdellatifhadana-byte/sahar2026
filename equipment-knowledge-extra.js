import { db } from './db.js';
import { EXTRA_EQUIPMENT_CATALOG } from './equipment-catalog-extra-seed.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';

const CATALOG_KIND = 'equipment_catalog';
const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const semanticKey = item => `${normalize(item?.manufacturer)}|${normalize(item?.model)}`;

/*
 * NE PAS LIRE `docs` AVANT QUE LE SNAPSHOT NE L'AIT REMPLI (#162, même famille).
 *
 * Ce module lisait `db.getAll('docs')` dès le chargement de la page, pour décider quels
 * items du catalogue complémentaire créer. Sur un rechargement, la base locale contient
 * déjà tout — mais seulement une fois que `enableCentralSync()` (central-sync.js) a fini
 * d'appliquer l'instantané serveur, ce qui prend un aller-retour réseau. Lu trop tôt,
 * `existing` semblait incomplet : ce module tentait de RECRÉER des fiches catalogue que le
 * serveur possédait déjà depuis une session précédente — d'où le `409` mesuré, un conflit
 * de révision sur un document qui n'avait pourtant pas besoin d'être écrit.
 *
 * Attendre que la bascule soit tranchée avant de lire garantit une base locale à jour.
 *
 * UN PREMIER `central-sync-status` NE PROUVE RIEN (revue externe).
 *
 * Le démarrage émet une rafale de `offline`/`warning`/`conflict` — des signaux de FILE,
 * posés par `db.save()`/`db.delete()` ou le rejeu d'une entrée, SANS rapport avec la
 * bascule elle-même — bien avant que l'instantané central n'ait été appliqué. Seuls
 * comptent : un événement portant `updatedAt` (preuve qu'un instantané a RÉELLEMENT été
 * appliqué), ou un échec terminal de la tentative centrale elle-même (`local`,
 * `unauthenticated` sans `updatedAt`).
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
    // Filet de sécurité, délibérément AU-DESSUS des 25 s (`REQUEST_TIMEOUT_MS` de
    // `central-sync.js`) : il ne doit jamais libérer pendant qu'une tentative en cours
    // peut encore aboutir.
    setTimeout(regler, 30000);
  });
}

/*
 * LA CORRECTION DU LT4448 — UNE SEULE RÈGLE, POUR LES DEUX CHEMINS QUI L'APPLIQUENT.
 *
 * Elle était écrite DEUX FOIS : ici, sur la fiche LOCALE au démarrage du module, et plus
 * bas dans `reconcileCentralCatalog`, sur la fiche DISTANTE à chaque `synced`. Deux copies
 * d'une même correction, c'est deux occasions de diverger — et c'est précisément ce qui
 * est arrivé : la seconde a été rendue idempotente, la première ne l'était pas, si bien que
 * chaque chargement de page réécrivait la fiche par le chemin d'amorçage.
 *
 * DEUX PIÈGES, DONC, ET UN SEUL ENDROIT POUR LES TENIR :
 *
 *   1. La condition de déclenchement reste VRAIE après la correction. La note corrigée cite
 *      elle-même la photo B01.RF2 — c'est tout son propos — et `origin` reste « seed ».
 *      Reconnaître plus finement ne réglerait rien : une condition raffinée se
 *      redéclencherait un jour de la même façon.
 *   2. Ce qui décide d'écrire doit donc être la COMPARAISON, pas la reconnaissance. On
 *      construit la fiche corrigée, on la compare à celle qui est déjà là, et l'on n'écrit
 *      que si elle en diffère vraiment. `updatedAt` est neutralisé pendant la comparaison :
 *      c'est l'horodatage de l'écriture, jamais une raison d'écrire — même neutralisation
 *      que dans `grille-centrale-topology.js`.
 *
 * Rend la fiche à écrire, ou `null` s'il n'y a rien à corriger. Aucune vérité métier ne
 * change : ni `origin`, ni le contenu de la note, ni la correction elle-même.
 */
const LT4448_ID = 'kb-leader-lt4448';
const LT4448_NOTE_CORRIGEE = 'Référence constructeur valide. La photo B01.RF2 montre un LT4610 ; ne pas attribuer LT4448 à cet emplacement sans preuve terrain.';

export function correctionLt4448(fiche) {
  if (!fiche || fiche.origin !== 'seed' || !String(fiche.sourceNote || '').includes('B01.RF2')) return null;
  const corrigee = {
    ...fiche,
    observed: false,
    verificationStatus: 'verified-family',
    sourceNote: LT4448_NOTE_CORRIGEE
  };
  if (recordsExactlyEqual({ ...corrigee, updatedAt: fiche.updatedAt }, fiche)) return null;
  return { ...corrigee, updatedAt: new Date().toISOString() };
}

async function correctLegacyLt4448() {
  const corrigee = correctionLt4448(await db.get('docs', LT4448_ID).catch(() => null));
  if (corrigee) await db.save('docs', corrigee);
}

async function seedExtraCatalog() {
  await attendreDecisionSync();
  const existing = await db.getAll('docs').catch(() => []);
  const ids = new Set(existing.map(item => String(item.id)));
  const keys = new Set(existing
    .filter(item => item.kind === CATALOG_KIND || item.targetType === CATALOG_KIND)
    .map(semanticKey));

  for (const item of EXTRA_EQUIPMENT_CATALOG) {
    if (ids.has(String(item.id)) || keys.has(semanticKey(item))) continue;
    await db.save('docs', {
      ...item,
      kind: CATALOG_KIND,
      targetType: CATALOG_KIND,
      targetId: item.id,
      origin: 'seed-extra',
      visibility: 'all-non-sensitive',
      verifiedAt: item.verificationStatus === 'verified' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    });
    keys.add(semanticKey(item));
  }
  await correctLegacyLt4448();
}

/*
 * UNE RECRÉATION SPÉCULATIVE NE SE REJOUE PAS À CHAQUE BATTEMENT (#164).
 *
 * `reconcileCentralCatalog` tourne à chaque `central-sync-status: synced` — un battement
 * périodique, pas un changement. Renvoyer l'exemplaire local dès qu'un item du catalogue
 * complémentaire manque au dernier instantané semblait prudent, mais sans mémoire d'un
 * envoi déjà fait, un item durablement absent du snapshot — parce que l'envoi précédent
 * n'a pas encore été rejoué, ou restera rejeté — était réexpédié à CHAQUE battement,
 * indéfiniment : la boucle mesurée par #164. Un identifiant déjà retenté cette session ne
 * l'est plus tant qu'il n'est pas réapparu dans un instantané — auquel cas la trace est
 * effacée, pour qu'une disparition FUTURE reste corrigeable.
 */
const dejaRetentes = new Set();

async function reconcileCentralCatalog() {
  if (!db.isCentralSyncReady?.()) return;
  try {
    const response = await fetch('/api/sync', { credentials:'include' });
    if (!response.ok) return;
    const snapshot = await response.json();
    const remoteDocs = snapshot?.data?.docs || [];
    const remoteIds = new Set(remoteDocs.map(item => String(item.id)));
    const remoteKeys = new Set(remoteDocs
      .filter(item => item.kind === CATALOG_KIND || item.targetType === CATALOG_KIND)
      .map(semanticKey));

    for (const item of EXTRA_EQUIPMENT_CATALOG) {
      if (remoteIds.has(String(item.id)) || remoteKeys.has(semanticKey(item))) { dejaRetentes.delete(String(item.id)); continue; }
      if (dejaRetentes.has(String(item.id))) continue;
      const local = await db.get('docs', item.id).catch(() => null);
      if (local) { await db.save('docs', local); dejaRetentes.add(String(item.id)); }
    }

    // La MÊME règle que le chemin d'amorçage, appliquée ici à la fiche distante : voir
    // `correctionLt4448` plus haut. Une seule écriture de la correction, deux appelants.
    const corrigee = correctionLt4448(remoteDocs.find(item => String(item.id) === LT4448_ID));
    if (corrigee) await db.save('docs', corrigee);
  } catch (error) {
    console.warn('Réconciliation du catalogue central différée', error);
  }
}

async function attachVerificationAction() {
  const select = document.getElementById('eq-catalog-id');
  const preview = document.getElementById('eq-catalog-preview');
  if (!select || !preview || preview.querySelector('[data-kb-verify]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn gray';
  button.dataset.kbVerify = '1';
  button.innerHTML = '<i class="fas fa-check-circle"></i> Vérifier / modifier la fiche catalogue';
  button.style.marginTop = '8px';
  button.onclick = async () => {
    if (!select.value) return;
    const record = await db.get('docs', db.normalizeKey ? db.normalizeKey(select.value) : select.value).catch(() => null);
    if (!record) return;
    window.EquipmentKnowledge?.openEditor?.(record, saved => {
      if (!saved) return;
      const option = [...select.options].find(item => String(item.value) === String(saved.id));
      if (option) option.textContent = `${saved.manufacturer} — ${saved.model}`;
      select.dispatchEvent(new Event('change', { bubbles:true }));
    });
  };
  preview.appendChild(button);
}

const observer = new MutationObserver(() => attachVerificationAction());
observer.observe(document.getElementById('app') || document.body, { childList:true, subtree:true });
document.addEventListener('change', event => {
  if (event.target?.id === 'eq-catalog-id') setTimeout(attachVerificationAction, 0);
}, true);
window.addEventListener('central-sync-status', event => {
  if (event.detail?.state === 'synced') reconcileCentralCatalog();
});

seedExtraCatalog().catch(error => console.error('Catalogue technique complémentaire non initialisé', error));

if (typeof window !== 'undefined') {
  window.EquipmentKnowledgeExtra = Object.freeze({ seed: seedExtraCatalog, reconcile: reconcileCentralCatalog });
}

export { seedExtraCatalog, reconcileCentralCatalog };
