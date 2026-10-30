/**
 * @file cable-endpoint-contract.js — QUI EST À CE BOUT DU CÂBLE, ET SOUS QUELLE IDENTITÉ.
 *
 * TROIS ÉTATS, ET IL FAUT LES DISTINGUER.
 *
 *   resolved   l'entité est connue : on la nomme.
 *   protected  le serveur a DÉLIBÉRÉMENT retiré l'extrémité — elle est hors périmètre.
 *   missing    l'identifiant est là, mais plus rien derrière : entité supprimée ou absente.
 *
 * DEUX DÉFAUTS QUE CE CONTRAT FERME.
 *
 * 1 · « Élément introuvable » pour une extrémité PROTÉGÉE.
 *     Le serveur retire `{side}Id`, `{side}EquipmentId`, `{side}ScreenId`,
 *     `{side}ComponentId`, `{side}ParentEquipmentId` et `{side}PortId`, puis pose un
 *     marqueur explicite `{side}Protected` (`scripts/serve.js`, sanitisation des câbles).
 *     Les écrans ignoraient ce marqueur, tentaient la résolution, échouaient, et
 *     affichaient « Élément introuvable » — disant à l'utilisateur que la donnée n'existe
 *     pas, alors qu'elle existe et ne le regarde pas. Deux faits différents, un seul
 *     message, et le mauvais.
 *
 * 2 · Le composant résolu par son seul `componentId`.
 *     Un `componentId` n'est unique que DANS son équipement parent : deux châssis peuvent
 *     chacun porter « slot-1 ». Le câble transporte `sourceParentEquipmentId` /
 *     `destinationParentEquipmentId` précisément pour lever l'ambiguïté — et la recherche
 *     les ignorait. Un câble vers EQ-B/slot-1 pouvait donc désigner EQ-A/slot-1 : le
 *     jumeau numérique montrait le mauvais appareil, ce qui est pire que ne rien montrer.
 *
 * Pur : ni DOM, ni IndexedDB, ni réseau.
 */

export const CABLE_ENDPOINT_CONTRACT_VERSION = 1;

export const ENDPOINT_STATES = Object.freeze(['resolved', 'protected', 'missing']);

/** Le libellé d'une extrémité hors périmètre. Jamais « introuvable ». */
export const PROTECTED_ENDPOINT_LABEL = 'Extrémité protégée — hors périmètre';

/** Le libellé d'une extrémité réellement absente. */
export const MISSING_ENDPOINT_LABEL = 'Extrémité introuvable';

const meme = (a, b) => a !== null && a !== undefined && a !== ''
  && b !== null && b !== undefined && b !== '' && String(a) === String(b);

const presente = value => value !== null && value !== undefined && value !== '';

/**
 * L'identité déclarée par le câble pour un bout donné, telle quelle.
 *
 * On ne DEVINE rien : si le serveur a retiré les identifiants, ils restent absents. Les
 * reconstruire à partir d'un autre champ reviendrait à contourner la protection qu'il
 * vient d'appliquer.
 */
export function endpointIdentity(cable = {}, side = 'source') {
  const protege = cable?.[`${side}Protected`];
  return Object.freeze({
    side,
    type: cable?.[`${side}Type`] ?? null,
    id: cable?.[`${side}Id`] ?? null,
    parentEquipmentId: cable?.[`${side}ParentEquipmentId`] ?? null,
    portId: cable?.[`${side}PortId`] ?? null,
    protege: protege ? Object.freeze({ ...protege }) : null
  });
}

/**
 * LE COMPOSANT SE RÉSOUT SUR SON IDENTITÉ COMPOSÉE.
 *
 * `parentEquipmentId` + `componentId`. Quand le câble ne porte PAS de parent — donnée
 * héritée — on retombe sur l'identifiant seul, mais uniquement s'il ne désigne qu'un seul
 * composant : une correspondance ambiguë ne vaut pas mieux qu'aucune, et en choisir une au
 * hasard, c'est exactement le défaut qu'on ferme.
 */
export function findComponent(components = [], { componentId, parentEquipmentId } = {}) {
  if (!presente(componentId)) return null;
  const liste = Array.isArray(components) ? components : [];
  if (presente(parentEquipmentId)) {
    return liste.find(item => meme(item?.id, componentId)
      && meme(item?.parentEquipmentId ?? item?.equipmentId, parentEquipmentId)) || null;
  }
  const candidats = liste.filter(item => meme(item?.id, componentId));
  return candidats.length === 1 ? candidats[0] : null;
}

/**
 * L'extrémité, résolue — avec son état, son libellé et son port.
 *
 * L'ordre des questions n'est pas indifférent : la PROTECTION se lit en premier. La
 * tester après la résolution ferait retomber une extrémité protégée dans le cas
 * « introuvable », qui est précisément le mensonge à supprimer.
 */
export function resolveCableEndpoint(cable = {}, side = 'source', {
  equipments = [], screens = [], components = []
} = {}) {
  const identite = endpointIdentity(cable, side);

  if (identite.protege) {
    const zone = identite.protege.zone;
    return Object.freeze({
      ...identite,
      state: 'protected',
      entity: null,
      port: null,
      // Le nom de zone est déjà public (`publicZoneSummaries`) : le dire aide à demander
      // l'accès. Rien d'autre ne sort — ni identifiant, ni port, ni nom privé.
      label: zone?.name ? `${PROTECTED_ENDPOINT_LABEL} · ${zone.name}` : PROTECTED_ENDPOINT_LABEL
    });
  }

  const entity = identite.type === 'screen'
    ? (screens.find(item => meme(item?.id, identite.id)) || null)
    : identite.type === 'component'
      ? findComponent(components, { componentId: identite.id, parentEquipmentId: identite.parentEquipmentId })
      : (equipments.find(item => meme(item?.id, identite.id)) || null);

  if (!entity) {
    return Object.freeze({ ...identite, state: 'missing', entity: null, port: null, label: MISSING_ENDPOINT_LABEL });
  }

  const port = (Array.isArray(entity.ports) ? entity.ports : []).find(item => meme(item?.id, identite.portId)) || null;
  const nom = identite.type === 'component'
    ? `Composant · ${entity.parentEquipmentName || entity.parentEquipmentId || '?'} › ${entity.name || entity.type || entity.id}`
    : `${identite.type === 'screen' ? 'Écran' : 'Équipement'} · ${entity.name || entity.nom || `#${entity.id}`}`;

  return Object.freeze({ ...identite, state: 'resolved', entity, port, label: nom });
}

/**
 * CE CÂBLE TOUCHE-T-IL CET ÉQUIPEMENT — directement OU par un de ses composants ?
 *
 * La Fiche360 ne regardait que `sourceType === 'equipment'` : un câble branché sur une
 * carte interne de l'appareil n'apparaissait donc pas dans sa propre fiche, alors que
 * c'est bien à lui qu'il est physiquement raccordé. On accepte les deux voies, des deux
 * côtés.
 *
 * LA MÊME IDENTITÉ DÉCIDE L'AFFICHAGE ET L'APPARTENANCE.
 * ------------------------------------------------------
 * Une première version répondait ici sur les seuls identifiants de composants de
 * l'appareil courant. Elle disait donc « oui » à EQ-A *et* à EQ-B pour un câble hérité qui
 * ne porte que `componentId = slot-1`, alors que `findComponent`, sur la même donnée,
 * répond « personne » parce que l'identité est ambiguë. Deux réponses contradictoires
 * pour une seule question : le câble s'affichait « Extrémité introuvable » et apparaissait
 * pourtant dans DEUX fiches comme s'il leur appartenait.
 *
 * La question passe donc par `findComponent`, avec l'ensemble CANONIQUE des composants —
 * le même que celui de la résolution. Il n'y a plus qu'une règle d'identité, donc plus de
 * contradiction possible : ce que l'écran ne sait pas nommer, il ne l'attribue à personne.
 *
 * La règle est décidée CÔTÉ PAR CÔTÉ (`endpointBelongsToEquipment`) : les appelants qui
 * doivent nommer « l'autre bout » ont besoin de savoir LEQUEL des deux est le leur, et
 * la redériver chez eux ferait exister deux versions de la même règle.
 */
export function endpointBelongsToEquipment(cable = {}, side = 'source', equipmentId, { components = [] } = {}) {
  if (!presente(equipmentId)) return false;
  const identite = endpointIdentity(cable, side);
  // Une extrémité protégée n'est pas la nôtre : si elle l'était, le serveur ne l'aurait
  // pas retirée — il ne protège que ce qui est hors de notre périmètre.
  if (identite.protege) return false;
  if (identite.type === 'component') {
    // Parent déclaré : il tranche, dans un sens comme dans l'autre.
    if (presente(identite.parentEquipmentId)) return meme(identite.parentEquipmentId, equipmentId);
    // Parent absent : exactement la question que `findComponent` sait trancher, et la
    // même réponse — un identifiant ambigu n'appartient à personne.
    const resolu = findComponent(components, { componentId: identite.id });
    return resolu ? meme(resolu.parentEquipmentId ?? resolu.equipmentId, equipmentId) : false;
  }
  if (identite.type === 'screen') return false;
  return meme(identite.id, equipmentId);
}

export function cableTouchesEquipment(cable = {}, equipmentId, options = {}) {
  return ['source', 'destination'].some(side => endpointBelongsToEquipment(cable, side, equipmentId, options));
}

/**
 * Les câbles d'un équipement — les siens et ceux de ses composants, sans doublon.
 *
 * `components` est l'ensemble CANONIQUE, tous équipements confondus : c'est lui qui permet
 * de dire si un `componentId` sans parent désigne un seul composant ou plusieurs. Un
 * ensemble partiel ferait retomber l'ambiguïté dans le silence — et c'est précisément ce
 * qu'on referme ici.
 */
export function cablesForEquipment(cables = [], equipmentId, { components = [] } = {}) {
  const vus = new Set();
  const sortie = [];
  for (const cable of Array.isArray(cables) ? cables : []) {
    if (!cableTouchesEquipment(cable, equipmentId, { components })) continue;
    const cle = String(cable?.id ?? '');
    if (cle && vus.has(cle)) continue;
    if (cle) vus.add(cle);
    sortie.push(cable);
  }
  return sortie;
}

export default Object.freeze({
  version: CABLE_ENDPOINT_CONTRACT_VERSION,
  ENDPOINT_STATES, PROTECTED_ENDPOINT_LABEL, MISSING_ENDPOINT_LABEL,
  endpointIdentity, findComponent, resolveCableEndpoint,
  endpointBelongsToEquipment, cableTouchesEquipment, cablesForEquipment
});
