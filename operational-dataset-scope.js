/**
 * @file operational-dataset-scope.js — « pour qui, et avec quelle autorité MAINTENANT ».
 *
 * POURQUOI CE MODULE EXISTE (A-5)
 * -------------------------------
 * `grille-centrale-dataset.js` portait cette fonction en propre. Un second jeu de données
 * protégé — le relevé de la Régie Car — devait suivre EXACTEMENT la même règle de mémoire,
 * et la recopier aurait été le meilleur moyen de la voir diverger : deux copies d'une règle
 * de sécurité, c'est une règle qui finit par n'être vraie qu'à moitié.
 *
 * Elle est donc écrite une fois, ici, et les deux transports l'importent. Le module est
 * PUBLIC et le reste : il ne contient aucune valeur d'installation, seulement la façon de
 * décrire l'autorité courante.
 *
 * CE QUE LA PORTÉE DOIT CAPTURER, ET POURQUOI
 * -------------------------------------------
 * Le compte seul ne suffit pas. `revokeGrant()` écrit `status:'revoked'` sur l'habilitation
 * et ne touche jamais à `authVersion` : une mémoire indexée sur le seul numéro de session
 * survivrait donc à une révocation, et un jeu de données obtenu légitimement deviendrait une
 * autorisation locale permanente. On y joint l'empreinte du contexte d'accès que
 * `central-sync` réécrit à chaque instantané — l'adhésion et les habilitations vivantes,
 * telles que le serveur vient de les rendre. Une révocation la change au cycle suivant, et
 * la mémoire tombe.
 *
 * Rend `null` sans session : sans identité, on ne demande même pas.
 */

export function porteeOperationnelleCourante() {
  let compte = null;
  try {
    const brut = localStorage.getItem('auth');
    if (!brut) return null;
    compte = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!compte || compte.id === undefined || compte.id === null) return null;
  let contexte = '';
  try {
    const brut = localStorage.getItem('zone-access-context');
    if (brut) {
      const { memberships = [], grants = [], isGlobalAdmin = false } = JSON.parse(brut) || {};
      // Une empreinte, pas une copie : ce qui compte est qu'elle CHANGE quand l'autorité change.
      const vivantes = [
        ...memberships.map(item => `m:${item.zoneId}:${item.status ?? ''}:${item.responsible ? 1 : 0}`),
        ...grants.map(item => `g:${item.zoneId}:${item.permission}:${item.status ?? ''}:${item.expiresAt ?? ''}`)
      ].sort();
      contexte = `${isGlobalAdmin ? 'A' : '-'}|${vivantes.join('|')}`;
    }
  } catch {
    contexte = '';
  }
  return `${compte.id}:${compte.authVersion ?? 1}|${contexte}`;
}

export default Object.freeze({ porteeOperationnelleCourante });
