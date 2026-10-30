/**
 * @file snapshot-diff-contract.js — ce qu'un instantané a réellement changé.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME
 * ------------------------------
 * `applySnapshot` écrivait le contenu reçu du serveur dans la base locale et n'annonçait
 * RIEN. Une sauvegarde LOCALE, elle, émet `platform-entity-updated`, que
 * `data-visibility-recovery.js` consomme pour rafraîchir les vues ouvertes. Un changement
 * DISTANT n'empruntait pas ce chemin : il entrait en base en silence.
 *
 *   SYNC-01         B renomme une salle ; la base locale de A reçoit le nouveau nom, mais
 *                   l'écran de A affiche l'ancien jusqu'à une navigation ou un F5.
 *   DELETE-SYNC-02  B supprime une fiche ; elle quitte la persistance de A et reste
 *                   affichée — un fantôme sur lequel on peut encore cliquer.
 *   EVENT-DELETE-01 Un événement existait pour la sauvegarde, aucun pour la suppression :
 *                   le contrat était asymétrique, donc incomplet.
 *
 * LA RÈGLE
 * --------
 *     instantané serveur → différence canonique → écriture locale → événements → vues
 *
 * Dans cet ordre, et jamais un autre. Annoncer un changement que la base n'a pas encore,
 * c'est inviter chaque vue à relire l'ancien état et à se croire à jour.
 *
 * TROIS LISTES, ET RIEN DE PLUS
 * -----------------------------
 *   changedStores     les magasins où quelque chose a bougé ;
 *   changedEntities   `{ store, id }` — créées ou modifiées ;
 *   deletedEntities   `{ store, id }` — disparues du contenu autorisé.
 *
 * Une entité se désigne par son IDENTITÉ — magasin et identifiant — jamais par son libellé :
 * un nom change, et c'est précisément le cas qu'on cherche à propager.
 *
 * UNE DISPARITION N'EST PAS TOUJOURS UNE SUPPRESSION
 * --------------------------------------------------
 * Le serveur filtre l'instantané par zone. Quand un accès est révoqué, la ressource
 * disparaît du contenu autorisé sans être supprimée pour les autres. Du point de vue de
 * CETTE session, la conséquence est la même — elle ne doit plus être affichée — et le
 * contrat les traite donc de la même façon. C'est le comportement voulu : une donnée
 * devenue interdite ne reste pas à l'écran.
 */
import { sameReferenceContent } from './platform-reference-contract.js';

export const SNAPSHOT_DIFF_VERSION = 1;

/** Les trois événements du contrat. Les deux premiers sont symétriques : c'est le point. */
export const SNAPSHOT_EVENTS = Object.freeze({
  UPDATED: 'platform-entity-updated',
  DELETED: 'platform-entity-deleted',
  DIVERGED: 'platform-entity-diverged',
  APPLIED: 'platform-snapshot-applied'
});

const identifiant = enregistrement => String(enregistrement?.id ?? '');

/**
 * CE QUI A CHANGÉ ENTRE DEUX ÉTATS D'UN MAGASIN.
 *
 * La comparaison se fait PAR VALEUR, via `sameReferenceContent`. Comparer des textes
 * sérialisés serait inutilisable ici : PostgreSQL renormalise l'ordre des clés du `jsonb`,
 * si bien que CHAQUE entité paraîtrait modifiée à CHAQUE instantané. L'invalidation
 * deviendrait globale et permanente, c'est-à-dire sans information. C'est la leçon de
 * WRITE-02, et elle vaut ici encore plus qu'ailleurs.
 */
export function diffStore(avant = [], apres = []) {
  const anciens = new Map(avant.map(enregistrement => [identifiant(enregistrement), enregistrement]));
  const changed = [];

  for (const enregistrement of apres) {
    const id = identifiant(enregistrement);
    if (!id) continue;
    const ancien = anciens.get(id);
    if (!ancien || !sameReferenceContent(ancien, enregistrement)) changed.push(id);
    anciens.delete(id);
  }

  // Ce qui restait dans `anciens` n'est plus dans le contenu autorisé : disparu.
  return { changed, deleted: [...anciens.keys()] };
}

/**
 * L'ÉTAT « APRÈS » D'UN MAGASIN, DÉDUIT PLUTÔT QUE RELU.
 *
 * Relire le magasin une fois l'écriture terminée rouvrirait la fenêtre que le remplacement
 * atomique a fermée : un écrivain pourrait se glisser entre l'écriture et la relecture, et
 * la différence annoncée décrirait alors un état qui n'a jamais existé. L'état d'arrivée
 * est donc déduit de ce qui est entré dans la transaction, et de rien d'autre.
 *
 *   clearFirst   le magasin est vidé avant d'être rempli : seuls les enregistrements
 *                envoyés survivent. Sinon ils se posent sur ce qui s'y trouvait déjà.
 *   deleted      les pierres tombales, appliquées EN DERNIER — dans le même ordre que la
 *                transaction. Un instantané qui porterait à la fois une fiche et sa pierre
 *                tombale se résout donc en suppression, et non au hasard de l'ordre.
 *
 * C'est ce qui permet à une pierre tombale d'être une SUPPRESSION ORDINAIRE aux yeux du
 * diff : « avant » contient la fiche, « après » ne la contient plus. Aucun second système
 * de suppressions n'est nécessaire, et il ne faut surtout pas en fabriquer un : deux
 * sources pour le même fait finissent toujours par se contredire.
 */
export function projectStoreAfter(avant = [], ecrits = [], { clearFirst = false, deleted = [], conserves = [] } = {}) {
  const etat = new Map();
  const survivants = new Set([...conserves].map(String));
  for (const enregistrement of avant) {
    const id = identifiant(enregistrement);
    // `conserves` nomme les fiches que le vidage autoritaire n'a PAS touchées, parce que le
    // serveur ne les possède pas. Les oublier ici les ferait annoncer supprimées alors
    // qu'elles sont toujours en base : la différence mentirait dans l'autre sens.
    if (!clearFirst || survivants.has(id)) etat.set(id, enregistrement);
  }
  for (const enregistrement of ecrits) {
    const id = identifiant(enregistrement);
    if (id) etat.set(id, enregistrement);
  }
  for (const id of deleted) etat.delete(String(id));
  return [...etat.values()];
}

/**
 * La différence complète, magasin par magasin.
 *
 * `avantParMagasin` et `apresParMagasin` sont des `Map` de nom de magasin vers la liste de
 * ses enregistrements. Seuls les magasins réellement remplacés y figurent : un magasin
 * qu'on n'a pas touché ne peut rien avoir changé, et l'annoncer serait du bruit.
 */
export function buildSnapshotDiff(avantParMagasin, apresParMagasin) {
  const changedStores = [];
  const changedEntities = [];
  const deletedEntities = [];

  for (const [store, apres] of apresParMagasin) {
    const { changed, deleted } = diffStore(avantParMagasin.get(store) || [], apres || []);
    if (!changed.length && !deleted.length) continue;
    changedStores.push(store);
    for (const id of changed) changedEntities.push({ store, id });
    for (const id of deleted) deletedEntities.push({ store, id });
  }

  return { version: SNAPSHOT_DIFF_VERSION, changedStores, changedEntities, deletedEntities };
}

/** Cette différence a-t-elle quelque chose à annoncer ? */
export function diffIsEmpty(diff) {
  return !diff?.changedEntities?.length && !diff?.deletedEntities?.length;
}

/*
 * LES ÉDITEURS OUVERTS — pour qu'un instantané n'écrase pas une saisie en cours.
 *
 * Le serveur reste autoritaire : la base locale prend la version distante, et c'est normal.
 * Ce qui ne doit pas arriver, c'est qu'une vue remplace EN SILENCE ce qu'un humain est en
 * train de taper. Il doit apprendre que la donnée a bougé sous lui, et décider lui-même.
 *
 * Un écran qui édite une fiche se déclare ici. Tant qu'il est SALE — une saisie non
 * enregistrée — un changement distant sur cette fiche lui parvient comme une DIVERGENCE et
 * non comme un rafraîchissement. Un éditeur ouvert mais intact, lui, suit la version
 * distante : le protéger sans raison lui ferait afficher un état périmé.
 *
 * Une SUPPRESSION traverse toujours la protection : on ne garde pas sa saisie sur une fiche
 * qui n'existe plus. C'est un fait, pas un arbitrage.
 */
const editeursOuverts = new Map();
const cle = (store, id) => `${store}\u0000${id}`;

/** Un écran déclare qu'il édite cette fiche, et si une saisie non enregistrée s'y trouve. */
export function declareOpenEditor(store, id, { dirty = false } = {}) {
  editeursOuverts.set(cle(store, id), Boolean(dirty));
}

/** L'écran s'est fermé, ou a enregistré : la protection n'a plus lieu d'être. */
export function releaseOpenEditor(store, id) {
  editeursOuverts.delete(cle(store, id));
}

/** Une saisie non enregistrée porte-t-elle sur cette fiche ? */
export function hasDirtyEditor(store, id) {
  return editeursOuverts.get(cle(store, id)) === true;
}

/**
 * Une saisie non enregistrée est-elle en cours QUELQUE PART ?
 *
 * `data-visibility-recovery.js` s'en sert pour suspendre un rafraîchissement de section :
 * reconstruire l'écran sous un formulaire en cours détruirait la saisie. Il déduisait
 * jusqu'ici cette situation de la PRÉSENCE d'un nœud dans le document, ce qui était faux —
 * la page Équipements monte sa fenêtre d'édition cachée en permanence, et l'écran restait
 * donc figé pour toujours. Ce registre, lui, énonce un fait déclaré.
 */
export function anyDirtyEditor() {
  for (const sale of editeursOuverts.values()) if (sale === true) return true;
  return false;
}

/** Vider le registre. Réservé aux épreuves : chacune doit partir d'un état connu. */
export function resetOpenEditors() {
  editeursOuverts.clear();
}

/**
 * ANNONCER LA DIFFÉRENCE — APRÈS que l'écriture locale a réussi.
 *
 * `lire` rend l'enregistrement tel qu'il est DÉSORMAIS en base : l'événement porte la
 * version nouvelle, celle que les vues doivent afficher, et non celle qu'on vient de
 * remplacer.
 */
export async function emitSnapshotDiff(diff, lire, emettre) {
  if (!diff || typeof emettre !== 'function') return { emitted: 0 };
  let emis = 0;

  for (const { store, id } of diff.deletedEntities) {
    emettre(SNAPSHOT_EVENTS.DELETED, { storeName: store, id, deletedAt: new Date().toISOString() });
    emis += 1;
  }

  for (const { store, id } of diff.changedEntities) {
    const record = await lire(store, id);
    const type = hasDirtyEditor(store, id) ? SNAPSHOT_EVENTS.DIVERGED : SNAPSHOT_EVENTS.UPDATED;
    emettre(type, { storeName: store, id, record, updatedAt: new Date().toISOString() });
    emis += 1;
  }

  // Le récapitulatif part en dernier : une vue qui veut raisonner sur l'ensemble le reçoit
  // une fois que tous les faits individuels ont été annoncés.
  emettre(SNAPSHOT_EVENTS.APPLIED, diff);
  return { emitted: emis };
}
