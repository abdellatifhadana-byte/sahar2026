/**
 * @file revision-contract.js — une écriture sait sur quelle version elle s'appuie.
 *
 * LE DÉFAUT QUE CE CONTRAT FERME
 * ------------------------------
 * `PUT /api/data/:store/:id` remplaçait l'enregistrement ENTIER par la charge reçue, sans
 * jamais comparer de version. La perte est donc silencieuse et banale :
 *
 *     session A ouvre une fiche       → elle en garde une copie à l'écran
 *     session B modifie un champ      → enregistré
 *     session A enregistre SA copie   → la modification de B disparaît
 *
 * Ce n'est pas une course rare entre deux requêtes : la fenêtre dure aussi longtemps
 * qu'une fiche reste ouverte. Mesuré sur `main` : les six magasins éprouvés perdaient la
 * modification concurrente, y compris `rooms.coordinates` et `walls.columns` — une
 * géométrie perdue se reconstruit à la main, parfois sur place.
 *
 * LA RÈGLE
 * --------
 * Chaque enregistrement porte une `_revision`, entier qui ne recule jamais. Une écriture
 * déclare la révision sur laquelle elle s'appuie ; le serveur compare et écrit de façon
 * ATOMIQUE, sous verrou de ligne. Si les révisions divergent, l'écriture est refusée —
 * jamais fusionnée d'office, jamais appliquée en silence.
 *
 * POURQUOI `_revision` ET NON `revision`
 * --------------------------------------
 * `revision` est DÉJÀ un champ métier de la plateforme, et depuis longtemps : l'étiquette
 * de révision d'un schéma technique (`diagram-contract.js`), d'un groupe de continuité
 * (`continuity-contract.js`), d'un synoptique (`signal-flow.js`). Elle est écrite par un
 * humain, affichée telle quelle — « Rév. v2.3 » — et c'est elle qui interdit de modifier un
 * schéma validé sans en créer une nouvelle version.
 *
 * La première écriture de ce contrat portait le même nom. Deux dégâts, tous deux constatés
 * en rejouant la séquence CI complète : la CRÉATION d'un schéma était refusée — son
 * étiquette « 1 » étant lue comme un compteur — et chaque écriture acceptée REMPLAÇAIT
 * l'étiquette de l'auteur par le compteur. Une perte silencieuse de donnée métier, soit
 * exactement ce que ce contrat existe pour empêcher.
 *
 * Le compteur porte donc un nom d'infrastructure, que rien d'autre n'utilise.
 *
 * CE QUE CE CONTRAT NE FAIT PAS
 * -----------------------------
 * Il ne fusionne AUCUN champ automatiquement. Deux modifications concurrentes de champs
 * différents ne sont pas « compatibles » du point de vue du serveur : il ne sait pas si
 * `statut` et `ports` peuvent coexister, et deviner à sa place produirait des états que
 * personne n'a voulus. Le refus rend la main à l'humain, avec la version courante.
 *
 * MIGRATION DES ENREGISTREMENTS HÉRITÉS
 * -------------------------------------
 * Un enregistrement sans `_revision` vaut la révision 0. Une session qui l'a lu déclare
 * donc 0, ce qui concorde, et la première écriture lui donne la révision 1. Deux sessions
 * qui l'ont lu ensemble déclarent 0 toutes les deux : la première écrit 1, la seconde est
 * refusée. La migration est donc déterministe et n'exige aucun remplissage préalable.
 */

/**
 * Le nom du compteur de concurrence. Le préfixe le range du côté de l'infrastructure et le
 * met hors d'atteinte des champs métier — `revision` est pris, voir l'en-tête.
 */
export const REVISION_FIELD = '_revision';

/**
 * Les magasins soumis au contrat : ceux qu'un HUMAIN édite depuis un écran.
 *
 * `logs` en est exclu : chaque entrée est un fait nouveau, jamais une modification d'un
 * fait ancien — deux journaux concurrents ne s'écrasent pas, ils s'ajoutent. `syncQueue`
 * et `backups` sont locaux au navigateur. Les magasins d'accès (`zones`, `zone_grants`,
 * `resource_zones`…) sont écrits par le serveur seul, par des opérations déjà
 * transactionnelles et déjà tracées.
 */
export const REVISION_STORES = Object.freeze([
  'rooms', 'baies', 'equipments', 'walls', 'screens', 'screen_groups', 'screen_issues',
  'diagnosis_history', 'cables', 'cable_reports', 'docs', 'faq', 'notes', 'attachments',
  'locations', 'settings', 'users', 'tickets', 'notifications'
]);

export const REVISION_ERRORS = Object.freeze({
  STALE_WRITE: 'STALE_WRITE',
  DELETED_ELSEWHERE: 'DELETED_ELSEWHERE',
  ALREADY_EXISTS: 'ALREADY_EXISTS'
});

/**
 * Le message que l'utilisateur lit. Il dit ce qui s'est passé ET quoi faire.
 *
 * Montrer « 409 » serait montrer notre plomberie à quelqu'un qui vient de perdre son
 * geste : il ne saurait ni pourquoi, ni comment récupérer sa saisie.
 */
export const STALE_WRITE_MESSAGE =
  'Cette donnée a été modifiée par un autre utilisateur. Rechargez la version actuelle avant d’enregistrer vos modifications.';

export const DELETED_ELSEWHERE_MESSAGE =
  'Cette donnée a été supprimée par un autre utilisateur. Rechargez la liste avant d’enregistrer vos modifications.';

export const ALREADY_EXISTS_MESSAGE =
  'Cette donnée vient d’être créée par un autre utilisateur. Rechargez la liste avant de recommencer.';

/** Ce magasin est-il soumis au contrat de révision ? */
export function storeUsesRevision(storeName) {
  return REVISION_STORES.includes(String(storeName));
}

/**
 * La révision d'un enregistrement — 0 quand il n'en porte pas encore.
 *
 * On ne lit QUE `REVISION_FIELD`. Un enregistrement peut porter par ailleurs un champ
 * métier nommé `revision` — l'étiquette d'un schéma technique — et le confondre avec le
 * compteur ferait refuser des créations parfaitement légitimes.
 */
export function revisionOf(record) {
  const brute = record?.[REVISION_FIELD];
  const nombre = Number(brute);
  return Number.isSafeInteger(nombre) && nombre > 0 ? nombre : 0;
}

/**
 * La révision sur laquelle une écriture DÉCLARE s'appuyer.
 *
 * `expectedRevision` explicite d'abord — c'est ce qu'un client attentif envoie. À défaut,
 * la révision portée par l'enregistrement lui-même : elle vient du serveur, un client qui
 * renvoie la fiche telle qu'il l'a lue la transporte sans y penser.
 */
export function expectedRevisionFrom(body, record = body) {
  const explicite = Number(body?.expectedRevision);
  if (Number.isSafeInteger(explicite) && explicite >= 0) return explicite;
  return revisionOf(record);
}

/** L'enregistrement tel qu'il sera stocké, estampillé de sa nouvelle révision. */
export function withRevision(record, revision) {
  return { ...record, [REVISION_FIELD]: revision };
}

/** Ce que le serveur répond à une écriture périmée : de quoi expliquer, et se resituer. */
export function staleWriteResponse(code, currentRevision, extra = {}) {
  const messages = {
    [REVISION_ERRORS.STALE_WRITE]: STALE_WRITE_MESSAGE,
    [REVISION_ERRORS.DELETED_ELSEWHERE]: DELETED_ELSEWHERE_MESSAGE,
    [REVISION_ERRORS.ALREADY_EXISTS]: ALREADY_EXISTS_MESSAGE
  };
  return { error: code, message: messages[code] || STALE_WRITE_MESSAGE, currentRevision, ...extra };
}

/** Ce refus vient-il d'un conflit de version ? Utilisé par la file hors ligne et l'écran. */
/**
 * UN REFUS DÉFINITIF, PAR OPPOSITION À UN INCIDENT PASSAGER.
 *
 * Un 4xx dit que le serveur a EXAMINÉ la charge et l'a refusée : la rejouer telle quelle
 * donnera le même refus. `401` (session à rétablir), `408` et `429` (le serveur demande
 * qu'on repasse plus tard) ne disent rien du contenu : ceux-là se retentent.
 *
 * La règle vit ICI, dans le contrat, parce que DEUX couches en dépendent et qu'elles ne
 * doivent jamais répondre différemment : `central-sync` décide s'il faut consigner un
 * conflit ou remettre en file, et `catalog-seed-guard` décide si un enrichissement
 * automatique doit céder devant une vérité plus récente ou rester dû. Deux copies de cette
 * règle se paieraient en données perdues d'un côté, en conflits perpétuels de l'autre.
 */
export function isPermanentSyncRejection(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

/**
 * LE JETON DE LIVRAISON DE FOND — QUI RÉPOND D'UN REFUS.
 *
 * Une écriture d'UTILISATEUR refusée laisse une trace dans la file, et c'est justice : un
 * geste a été posé par quelqu'un, il a été perdu, et seul un humain peut le reprendre —
 * relire la version courante, puis ressaisir. C'est le contrat 409 STALE_WRITE, et rien
 * ici ne l'assouplit.
 *
 * Une livraison de FOND n'a rien de tout cela. Personne ne l'a demandée, personne ne l'a
 * vue partir, et son émetteur — un producteur d'enrichissement idempotent — la recalculera
 * depuis la vérité fraîche au passage suivant. Lui ouvrir la file reviendrait à présenter à
 * l'utilisateur un conflit qu'il n'a pas créé et qu'aucun geste de sa part ne peut résoudre.
 *
 * Mesuré sur `fae6538`, navigateur réel contre PostgreSQL réel : un enrichissement
 * automatique calculé sur la révision 1, refusé par un centre passé à 2, laissait
 *
 *     syncQueue  docs/kb-aja-ogfsmini  status=conflict  lastErrorCode=STALE_WRITE
 *     central-sync-status  state:'conflict'  ×2
 *
 * et l'entrée survivait à deux cycles d'instantané complets — `conflict` est TERMINALE.
 *
 * CE QUE LE JETON NE FAIT PAS
 * ---------------------------
 * Il n'avale aucune erreur : le refus est relancé tel quel, et l'appelant en répond. Il ne
 * touche ni à la révision, ni à la restauration de la copie locale, ni au contrat serveur.
 * Il dit une seule chose — QUI est le propriétaire de la reprise — et il la dit d'avance,
 * pas après coup. Nettoyer la file ensuite exigerait de reconnaître un conflit automatique
 * d'un conflit humain sur le même magasin et le même identifiant : une devinette, avec la
 * saisie de quelqu'un pour enjeu.
 *
 * Le jeton se compare par IDENTITÉ : il faut l'importer pour l'obtenir, et un objet
 * littéral qui lui ressemble — `{ backgroundDelivery:true }` — ne l'ouvre pas. Une porte de
 * transport qui s'ouvrirait à qui la devine ne serait pas une porte.
 */
export const BACKGROUND_DELIVERY = Object.freeze({ backgroundDelivery: true });

/** Cette écriture est-elle une livraison de fond, qui répond elle-même de ses refus ? */
export function isBackgroundDelivery(option) {
  return option === BACKGROUND_DELIVERY;
}

export function isConflictCode(code) {
  return Object.values(REVISION_ERRORS).includes(String(code));
}

/**
 * LES ÉTATS D'UNE OPÉRATION EN ATTENTE, ET LE SEUL QUI PART DE LUI-MÊME.
 *
 *   pending    en attente d'une occasion de partir. Se rejoue : la cause est passagère —
 *              réseau coupé, serveur momentanément indisponible, session à renouveler.
 *   processing RÉCLAMÉE : une reprise l'a prise en charge et sa requête est en vol. Ce
 *              n'est pas un état d'arrivée mais une MAIN POSÉE, et c'est elle qui empêche
 *              qu'une même opération parte deux fois — voir `queueEntryIsClaimable`.
 *   conflict   refusée parce que la donnée a changé depuis la lecture. TERMINALE : la
 *              révision déclarée est périmée et ne le sera pas moins dans vingt secondes.
 *              Seul un geste humain — relire, puis ressaisir — peut la résoudre.
 *   failed     refusée pour une raison qui lui est propre (autorisation, validation).
 *              Terminale pour les mêmes raisons.
 *   done       partie. L'entrée est retirée de la file.
 *
 * CE QUE CETTE DISTINCTION FERME
 * ------------------------------
 * La file sélectionnait « tout ce qui n'est ni `done` ni `failed` », ce qui laissait passer
 * `conflict`. Or la synchronisation repart au retour sur l'onglet, au retour du réseau, et
 * toutes les vingt secondes. Une opération en conflit repartait donc indéfiniment vers un
 * serveur qui la refusera toujours : une requête inutile par cycle, un compteur de
 * tentatives qui gonfle, et la même alerte qui revient sans cesse — jusqu'à ce que
 * l'utilisateur cesse de la lire.
 *
 * Terminale ne veut pas dire jetée. L'entrée conserve la saisie, le code du refus, la
 * révision courante du serveur et l'horodatage : tout ce qu'une résolution manuelle exige.
 */
export const QUEUE_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  CONFLICT: 'conflict',
  FAILED: 'failed',
  DONE: 'done'
});

/** Une entrée peut-elle repartir d'elle-même ? Seule `pending` le peut. */
export function queueEntryIsReplayable(status) {
  return String(status ?? QUEUE_STATUSES.PENDING) === QUEUE_STATUSES.PENDING;
}

/**
 * COMBIEN DE TEMPS UNE MAIN POSÉE RESTE CRÉDIBLE.
 *
 * Une réclamation sans échéance serait un verrou mort : l'onglet fermé au milieu d'un
 * rejeu emporterait l'entrée avec lui, `processing` pour toujours, et la modification
 * hors ligne ne repartirait JAMAIS. Une file qui protège contre le double envoi au prix
 * d'une perte silencieuse serait un plus mauvais marché que le défaut d'origine.
 *
 * L'échéance n'est pas choisie au hasard : aucune requête ne peut vivre plus de
 * `REQUEST_TIMEOUT_MS` (25 s, `central-sync.js`), délai au-delà duquel elle est abandonnée.
 * Une réclamation plus vieille que cela ne peut donc PLUS correspondre à une requête
 * vivante — elle appartient à un contexte disparu. La marge porte le seuil à soixante
 * secondes : assez pour ne jamais voler une entrée à un rejeu lent mais bien vivant, assez
 * peu pour qu'une reprise après fermeture brutale tienne dans le cycle suivant.
 */
export const QUEUE_CLAIM_LEASE_MS = 60000;

/** Cette réclamation a-t-elle survécu à son réclamant ? */
export function queueClaimIsExpired(entry, now = Date.now()) {
  if (String(entry?.status) !== QUEUE_STATUSES.PROCESSING) return false;
  const depuis = Date.parse(entry?.claimedAt ?? '');
  // Une réclamation sans date n'est pas datable : la croire vivante la rendrait éternelle.
  if (!Number.isFinite(depuis)) return true;
  return now - depuis >= QUEUE_CLAIM_LEASE_MS;
}

/**
 * Cette entrée peut-elle être PRISE MAINTENANT par une reprise ?
 *
 * `pending` le peut, évidemment. `processing` le peut aussi, mais seulement une fois son
 * échéance passée : c'est la reprise après un contexte disparu, et la seule.
 */
export function queueEntryIsClaimable(entry, now = Date.now()) {
  return queueEntryIsReplayable(entry?.status) || queueClaimIsExpired(entry, now);
}

/**
 * Cette entrée compte-t-elle encore comme du travail en attente ?
 *
 * Une entrée réclamée par une AUTRE reprise — un autre onglet — n'est pas partie pour
 * autant : l'annoncer comme réglée ferait dire à l'écran « tout est synchronisé » alors
 * qu'une modification est encore en vol ailleurs.
 */
export function queueEntryIsOutstanding(status) {
  const valeur = String(status ?? QUEUE_STATUSES.PENDING);
  return valeur === QUEUE_STATUSES.PENDING || valeur === QUEUE_STATUSES.PROCESSING;
}
