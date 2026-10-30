/*
 * LA VÉRITÉ DE LA FILE, PAS CELLE DU DERNIER PASSAGE (#98/#164).
 *
 * CE QUI S'AFFICHAIT
 * -------------------
 * `enableCentralSync()` concluait à partir du RÉSULTAT DU PASSAGE EN COURS :
 * `queue.failed` compte les échecs de CE passage, `queue.pending` ne compte que les
 * entrées `pending`/`processing`. Or une entrée `conflict` ou `failed` est TERMINALE :
 * aucune reprise ne la réclame plus (`queueEntryIsClaimable` l'exclut). Au passage
 * suivant — vingt secondes plus tard — elle n'est donc comptée nulle part : ni dans les
 * échecs du passage, ni dans les entrées en attente. L'écran annonçait « Synchronisé »
 * alors qu'une modification refusée dormait dans IndexedDB, et personne ne pouvait le
 * savoir depuis l'interface.
 *
 * Symétriquement, une file non vide faisait afficher « Hors ligne / local » alors que le
 * serveur venait de répondre et que l'instantané venait d'être appliqué. Deux faits
 * distincts étaient rendus par une seule pastille.
 *
 * CE QUE CE CONTRAT SÉPARE
 * -------------------------
 * LA LIAISON CENTRALE — le serveur répond-il, l'instantané a-t-il été appliqué ?
 * L'ÉTAT DE LA FILE   — reste-t-il des modifications non parties, en conflit, refusées ?
 *
 * Les deux sont vrais en même temps : on peut être EN LIGNE avec trois modifications en
 * attente. « Hors ligne » redevient donc réservé à une indisponibilité réelle du central,
 * et « Synchronisé » n'est dit que lorsque la file est VIDE — les entrées terminales
 * comprises.
 *
 * Ce module ne décide de rien : il résume, et nomme. Il ne touche pas au « à vérifier »
 * de `signal-spine.js`, qui répond à une autre question — celle de la donnée métier.
 */

const nombre = valeur => Number.isFinite(Number(valeur)) ? Number(valeur) : 0;

/**
 * Résume la file ENTIÈRE, telle qu'elle est réellement en base.
 *
 * `entries` est le contenu du magasin `syncQueue`, pas le compte-rendu d'un passage.
 */
export function resumeQueueSync(entries = []) {
  const resume = { pending:0, processing:0, conflict:0, failed:0 };
  for (const entree of Array.isArray(entries) ? entries : []) {
    const statut = String(entree?.status ?? 'pending');
    if (statut === 'done') continue;
    if (Object.hasOwn(resume, statut)) resume[statut] += 1;
    // Un statut inconnu est du travail non terminé : le taire ferait dire « Synchronisé »
    // à une file qui ne l'est pas.
    else resume.pending += 1;
  }
  const enAttente = resume.pending + resume.processing;
  return { ...resume, enAttente, total:enAttente + resume.conflict + resume.failed };
}

/** La file est-elle réellement vide — entrées terminales comprises ? */
export function queueSyncEstVide(resume) {
  return nombre(resume?.total) === 0;
}

const pluriel = (n, singulier, plurielMot = `${singulier}s`) => `${n} ${n > 1 ? plurielMot : singulier}`;

/**
 * Le libellé exact de la pastille.
 *
 * `connecte` : le central a répondu et l'instantané a été appliqué.
 *
 * Quand plusieurs situations coexistent, elles sont TOUTES nommées : annoncer seulement
 * la plus grave laisserait croire que le reste est réglé.
 */
export function libelleQueueSync({ connecte = false, resume = null, etat = '' } = {}) {
  const compte = resume || resumeQueueSync([]);
  if (!connecte) {
    if (etat === 'unauthenticated') return 'Session requise';
    return queueSyncEstVide(compte)
      ? 'Hors ligne'
      : `Hors ligne · ${pluriel(compte.total, 'modification')} non synchronisée${compte.total > 1 ? 's' : ''}`;
  }

  if (queueSyncEstVide(compte)) return 'Synchronisé';

  const parties = [];
  if (compte.enAttente > 0) parties.push(`${pluriel(compte.enAttente, 'modification')} en attente`);
  if (compte.conflict > 0) parties.push(`${pluriel(compte.conflict, 'conflit')} à résoudre`);
  if (compte.failed > 0) parties.push(`${pluriel(compte.failed, 'modification')} rejetée${compte.failed > 1 ? 's' : ''}`);
  return parties.join(' · ');
}

/**
 * La classe visuelle de la pastille : elle ne doit jamais dire « tout va bien » pendant
 * qu'une entrée attend, ni crier à la panne parce qu'une modification est en vol.
 */
export function classeQueueSync({ connecte = false, resume = null } = {}) {
  const compte = resume || resumeQueueSync([]);
  if (!connecte) return 'offline';
  if (compte.conflict > 0 || compte.failed > 0) return 'error';
  if (compte.enAttente > 0) return 'pending';
  return 'synced';
}
