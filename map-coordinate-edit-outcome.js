/**
 * @file map-coordinate-edit-outcome.js — deux décisions pures autour d'une session de
 *       coordonnées (`map-coordinate-edit-session.js`), sans IndexedDB ni DOM.
 *
 * Ce fichier ne remplace pas `map-coordinate-edit-session.js` : celui-ci reste seul
 * responsable du snapshot, de la restauration et de l'acquittement. Ici vivent deux
 * questions différentes, posées par `interactive-map.js` :
 *
 *   1. Une navigation vers (type, id) doit-elle ABANDONNER la session en cours ?
 *   2. Un résultat `success | partial | failed` se dit COMMENT à l'utilisateur ?
 *
 * Les isoler ici les rend vérifiables sans monter tout le module de carte (modal, canvas,
 * glisser-déposer) : la charge la plus sensible de #P0-B — ne jamais afficher « tout
 * enregistré » sur un résultat partiel, toujours nommer un conflit de révision — s'exécute
 * et se prouve directement, au lieu de rester une inspection de texte.
 */

/**
 * La vue (type, id) qui possède actuellement la session, ou `null` si aucune n'est active.
 * Navigue-t-on VERS cette même vue ? Si oui, la session survit — c'est le seul cas où une
 * reprise (après une sauvegarde partielle, par exemple) ne doit rien annuler. Toute AUTRE
 * destination doit abandonner la session : voir `cancelCoordinateSession` dans
 * `interactive-map.js`.
 */
export function coordinateEditViewMatches(sessionView, type, id) {
  return !!sessionView && sessionView.type === type && String(sessionView.id) === String(id);
}

/** Un échec porte-t-il un conflit de révision (409 / STALE_WRITE), par opposition à autre chose ? */
function isRevisionConflict(echec) {
  return Number(echec?.status) === 409 || String(echec?.code || '') === 'STALE_WRITE';
}

const MESSAGE_CONFLIT = ' Conflit de révision : la donnée a été modifiée par un autre utilisateur.';

/**
 * CE QUE L'UTILISATEUR LIT APRÈS UN ENREGISTREMENT DE COORDONNÉES.
 *
 * `result` est exactement ce que rend `saveCoordinateEditSession` : `status`, `saved`,
 * `failed`, `pending`.
 *
 * LA RÈGLE QUI COMPTE : un résultat `partial` ou `failed` NE DOIT JAMAIS produire le
 * message d'un succès complet — ni « Coordonnées enregistrées. », ni « Toutes les
 * modifications ont été enregistrées. ». Un élément resté sale après un refus serveur
 * reste visible et nommé, jamais maquillé en réussite.
 *
 * LE COMPTE PRINCIPAL RESTE NEUTRE — « en échec », jamais « en conflit ».
 *
 * La première version nommait TOUT refus « conflit », y compris un 422 de validation qui
 * n'en est pas un : une revue indépendante l'a relevé avant la réunion. « en échec » est
 * vrai pour CHAQUE refus, quelle qu'en soit la cause — c'est le compte qui ne peut jamais
 * mentir. Quand au moins un refus EST un conflit de révision (409/STALE_WRITE), la phrase
 * qui l'explique s'ajoute — elle ne remplace jamais le compte, elle le complète.
 */
export function describeCoordinateSaveOutcome(result) {
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  const saved = Array.isArray(result?.saved) ? result.saved : [];
  const pending = Array.isArray(result?.pending) ? result.pending : [];
  const conflit = failed.some(isRevisionConflict);

  if (result?.status === 'success') {
    return Object.freeze({ level: 'success', message: 'Coordonnées enregistrées.' });
  }
  if (result?.status === 'partial') {
    return Object.freeze({
      level: 'warning',
      message: `Enregistrement partiel : ${saved.length} enregistré(s), ${failed.length} en échec, ${pending.length} restant(s).`
        + (conflit ? MESSAGE_CONFLIT : '')
    });
  }
  // 'failed' — ou toute valeur inattendue : ne jamais retomber sur un libellé de succès.
  return Object.freeze({
    level: 'error',
    message: `Échec de l'enregistrement : ${pending.length} élément(s) restent en attente.`
      + (conflit ? MESSAGE_CONFLIT : '')
  });
}
