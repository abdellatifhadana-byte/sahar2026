/**
 * @file cable-route-presentation.js — LE CHEMINEMENT, DIT DANS LA LANGUE DE L'EXPLOITANT.
 *
 * L'utilisateur n'a pas à comprendre `segments[]`. Il lit un parcours :
 *
 *     STC (1) → Plan général → RF1 → STC (2)
 *
 * et, quand il faut insérer un passage manquant, il choisit un endroit dans CETTE phrase —
 * « entre Plan général et RF1 » — pas un indice de tableau.
 *
 * CE QUE CE MODULE NE FAIT PAS.
 *
 * Il ne trie rien. L'ordre affiché est l'ordre STOCKÉ, parce que cet ordre est une
 * affirmation physique : c'est le cheminement relevé. Classer par salle ou par type de
 * scène produirait une phrase lisible et fausse.
 *
 * Il n'invente aucun nom : une salle dont le nom n'est pas connu de l'appelant reste
 * désignée par ce qu'on sait d'elle, sans jamais prétendre l'avoir identifiée.
 *
 * Pur : ni DOM, ni réseau.
 */

import { routeStatusLabel, MISSING_ROUTE_LABEL, PARTIAL_ROUTE_LABEL } from './connectivity-contract.js';
import { nestedPlacement, SHAPE_IN_ROOM_FIELD, SHAPE_IN_BAIE_FIELD, SHAPE_IN_EQUIPMENT_FIELD } from './nested-shape-contract.js';

export const CABLE_ROUTE_PRESENTATION_VERSION = 1;

/** Le plan du site n'est pas une ressource nommée : c'est LE plan. */
export const MAP_SCENE_LABEL = 'Plan général';

/**
 * Deux passages consécutifs du MÊME niveau (salle→salle, baie→baie), sans le plan général
 * entre les deux, n'ont aucune scène commune documentée : rien dans le modèle ne relie
 * directement deux salles ou deux baies distinctes. C'est une rupture honnête, pas une
 * absence de tracé — le reste du cheminement reste vérifié.
 */
export const UNDOCUMENTED_TRANSITION_LABEL = 'Liaison non cartographiée';

const nomDe = (collection, id) => {
  const trouve = (Array.isArray(collection) ? collection : [])
    .find(item => String(item?.id) === String(id));
  return trouve?.name || trouve?.nom || null;
};

/**
 * Une rupture, c'est deux passages du même niveau (jamais le plan, qui EST la scène commune)
 * mais de scène distincte : rien ne documente comment on va de l'une à l'autre. Un
 * changement de niveau (salle↔baie, salle↔plan, baie↔plan) n'est jamais une rupture : c'est
 * la scène partagée elle-même qui documente le passage — c'est déjà le cas 2 ou le cas 3.
 */
const estUneRupture = (precedent, suivant) => {
  if (!precedent || !suivant) return false;
  if (precedent.sceneType !== suivant.sceneType) return false;
  if (precedent.sceneType === 'map') return false;
  return String(precedent.sceneId ?? '') !== String(suivant.sceneId ?? '');
};

/**
 * Le nom d'une scène, tel qu'un exploitant l'appelle.
 *
 * Sans nom connu, on rend une désignation honnête — « Salle 901 » — plutôt qu'un nom
 * inventé ou un identifiant nu présenté comme un nom.
 */
export function sceneLabel(scene = {}, { rooms = [], baies = [] } = {}) {
  if (scene.sceneType === 'map') return MAP_SCENE_LABEL;
  if (scene.sceneType === 'room') return nomDe(rooms, scene.sceneId) || `Salle ${scene.sceneId}`;
  if (scene.sceneType === 'baie') return nomDe(baies, scene.sceneId) || `Baie ${scene.sceneId}`;
  return 'Scène inconnue';
}

/**
 * LE PARCOURS, PASSAGE PAR PASSAGE.
 *
 * Une scène traversée plusieurs fois est NUMÉROTÉE — « STC (1) », « STC (2) » — parce que
 * deux passages portant le même nom seraient indiscernables au moment de choisir lequel
 * modifier. Une scène traversée une seule fois n'est pas numérotée : un « (1) » unique
 * suggérerait qu'il en existe un second.
 *
 * @param sequence  ce que rend `session.sequence()` : { insertAt, sceneType, sceneId, waypoints }
 */
export function routeSequenceLabels(sequence = [], contexte = {}) {
  const liste = Array.isArray(sequence) ? sequence : [];
  const cle = etape => `${etape.sceneType}:${etape.sceneId ?? ''}`;
  const total = new Map();
  for (const etape of liste) total.set(cle(etape), (total.get(cle(etape)) || 0) + 1);

  const vus = new Map();
  return liste.map((etape, index) => {
    const identifiant = cle(etape);
    const rang = (vus.get(identifiant) || 0) + 1;
    vus.set(identifiant, rang);
    const nom = sceneLabel(etape, contexte);
    return Object.freeze({
      insertAt: etape.insertAt,
      sceneType: etape.sceneType,
      sceneId: etape.sceneId ?? null,
      occurrence: rang,
      repeated: total.get(identifiant) > 1,
      label: total.get(identifiant) > 1 ? `${nom} (${rang})` : nom,
      waypoints: etape.waypoints ?? 0,
      gapBefore: index > 0 && estUneRupture(liste[index - 1], etape)
    });
  });
}

/**
 * Le parcours en une phrase : « STC (1) → Plan général → RF1 → STC (2) ».
 *
 * Quand deux passages consécutifs n'ont aucune scène commune documentée, la phrase le DIT
 * au lieu de les relier par une simple flèche qui affirmerait un passage relevé : «  STC →
 * Liaison non cartographiée → RF2 ». Un plan général réel entre les deux reste toujours
 * préféré — cette rupture n'apparaît que quand la scène intermédiaire est absente du
 * cheminement stocké, jamais quand elle est là.
 */
export function routeSequenceSentence(sequence = [], contexte = {}) {
  const etapes = routeSequenceLabels(sequence, contexte);
  if (!etapes.length) return '';
  return etapes.reduce((phrase, etape, index) => {
    if (index === 0) return etape.label;
    const jonction = etape.gapBefore ? ` → ${UNDOCUMENTED_TRANSITION_LABEL} → ` : ' → ';
    return `${phrase}${jonction}${etape.label}`;
  }, '');
}

/**
 * OÙ INSÉRER UN PASSAGE — la question posée dans la phrase, pas dans un tableau.
 *
 * Les positions sont des rangs ABSOLUS du cheminement, ceux que `startSegment` exige. On
 * ne déduit rien de la scène ouverte : c'est à celui qui documente de dire où le passage
 * s'insère.
 */
export function insertionChoices(sequence = [], contexte = {}) {
  const etapes = routeSequenceLabels(sequence, contexte);
  if (!etapes.length) return [Object.freeze({ insertAt: 0, label: 'Premier passage du parcours' })];
  const choix = [Object.freeze({ insertAt: 0, label: `Avant ${etapes[0].label}` })];
  for (let index = 1; index < etapes.length; index += 1) {
    choix.push(Object.freeze({ insertAt: index, label: `Entre ${etapes[index - 1].label} et ${etapes[index].label}` }));
  }
  choix.push(Object.freeze({ insertAt: etapes.length, label: `Après ${etapes[etapes.length - 1].label}` }));
  return choix;
}

/**
 * LA PASTILLE D'ÉTAT — et elle ne ment pas.
 *
 * « Vérifié » atteste d'un cheminement observé sur le terrain ; « proposé » dit qu'il a été
 * dessiné et pas encore confirmé ; l'absence et le hors-périmètre sont deux faits
 * distincts. `tone` accompagne le texte SANS le remplacer : une pastille qui ne se
 * distinguerait que par sa couleur ne dirait rien à qui ne la distingue pas.
 */
export function routeBadge(route) {
  const texte = routeStatusLabel(route);
  if (texte === MISSING_ROUTE_LABEL) return Object.freeze({ text: texte, tone: 'absent', verified: false });
  if (texte === PARTIAL_ROUTE_LABEL) return Object.freeze({ text: texte, tone: 'protege', verified: false });
  if (route?.status === 'verified') return Object.freeze({ text: texte, tone: 'verifie', verified: true });
  if (route?.status === 'proposed') return Object.freeze({ text: texte, tone: 'propose', verified: false });
  return Object.freeze({ text: texte, tone: 'inconnu', verified: false });
}

/**
 * UNE COORDONNÉE HÉRITÉE A-T-ELLE VRAIMENT ÉTÉ RELEVÉE ?
 *
 * `nestedPlacement()` convertit chaque coordonnée par `Number()`. C'est le bon geste pour
 * DESSINER — il faut bien un nombre —, mais pas pour AFFIRMER qu'un relevé existe :
 * `Number(null)` et `Number('')` valent 0, un nombre parfaitement fini. Un équipement
 * ancien portant `x_inRoom: null` ressortait donc « point documenté en (0,0) », et le Flux
 * de signal annonçait un repère visuel que personne n'a jamais posé.
 *
 * Ce prédicat regarde donc la valeur D'ORIGINE, avant toute conversion :
 *
 *   nombre fini        un relevé — `0` compris : c'est le coin haut-gauche de la photo,
 *                      une position réelle, pas une absence ;
 *   texte non vide     un relevé s'il se lit comme un nombre fini — le stock hérité écrit
 *                      « 0 », « 140 », « 12.5 » en texte, et les refuser effacerait des
 *                      positions réellement documentées ;
 *   tout le reste      pas un relevé. `null`, `undefined`, une chaîne vide ou blanche, un
 *                      booléen, un tableau, un objet : `Number()` en tire volontiers un
 *                      nombre (`Number(true)` vaut 1, `Number([])` vaut 0), mais aucun
 *                      d'eux n'est une coordonnée que quelqu'un a relevée.
 */
const coordonneeRelevee = valeur => {
  if (typeof valeur === 'number') return Number.isFinite(valeur);
  if (typeof valeur === 'string') return valeur.trim() !== '' && Number.isFinite(Number(valeur));
  return false;
};

/**
 * UN `portId` LOGIQUE N'EST PAS UNE POSITION DE PIXEL.
 * --------------------------------------------------------------------------------------
 * Le câble porte `{side}PortId` — une IDENTITÉ, vérifiée contre les ports déclarés de
 * l'entité (`cable-endpoint-contract.js#resolveCableEndpoint`). Aucun ancrage aujourd'hui
 * n'associe un port à un pixel : les repères existants sont `source/destination + x/y`,
 * jamais `+ portId`. Prétendre connaître la position du CONNECTEUR à partir de la seule
 * identité du port serait inventer une précision qu'aucun relevé ne documente.
 *
 * Ce que le contrat des formes imbriquées (`nested-shape-contract.js`) documente bel et
 * bien, c'est la position de l'ENTITÉ PORTEUSE — la carte, le châssis, la baie — sur SA
 * photo. C'est un fait plus modeste que « voici le connecteur », mais un fait réel : on
 * peut aller le vérifier sur la photo. Cette fonction ne dit jamais rien de plus.
 */
export const PORT_POSITION_DOCUMENTED_LABEL = 'Repère visuel documenté sur sa photo';
export const PORT_POSITION_TO_CONFIRM_LABEL = 'Position visuelle du port à confirmer';

/**
 * Le repère visuel d'une extrémité RÉSOLUE — jamais plus précis que ce que le contrat des
 * formes imbriquées documente réellement pour ce type d'entité.
 *
 * Une extrémité protégée ou introuvable n'a pas d'entité à interroger : la question ne se
 * pose pas, la réponse honnête est la même que pour une position non documentée — on ne
 * sait pas la montrer, quelle qu'en soit la raison.
 *
 * Un écran ne porte aujourd'hui aucun champ de position sur une photo (voir
 * nested-shape-contract.js — seuls baie, équipement et composant en portent un) : l'absence
 * documentée est ici le seul fait honnête, pas une case qu'on ne sait pas remplir.
 */
export function endpointVisualPositionLabel(bout = {}) {
  if (bout.state !== 'resolved' || !bout.entity) return PORT_POSITION_TO_CONFIRM_LABEL;
  let place;
  let clesPoint = [];
  if (bout.type === 'component') {
    // Aucun `pointKeys` ici, et c'est voulu : un composant n'a pas de repère ponctuel
    // hérité — sa seule position documentée est `shapeInEquipment`.
    place = nestedPlacement(bout.entity, { shapeField: SHAPE_IN_EQUIPMENT_FIELD });
  } else if (bout.type === 'equipment') {
    clesPoint = bout.entity.baieId ? ['x_inBaie', 'y_inBaie'] : ['x_inRoom', 'y_inRoom'];
    place = nestedPlacement(bout.entity, {
      shapeField: bout.entity.baieId ? SHAPE_IN_BAIE_FIELD : SHAPE_IN_ROOM_FIELD,
      pointKeys: clesPoint
    });
  } else {
    return PORT_POSITION_TO_CONFIRM_LABEL;
  }
  if (place.kind === 'unplaced') return PORT_POSITION_TO_CONFIRM_LABEL;
  /*
   * Le durcissement ne porte QUE sur le repli ponctuel, et il est local à cette
   * présentation : `nestedPlacement()` garde son contrat de dessin inchangé, parce que
   * répondre « non placé » là-bas changerait ce que la carte AFFICHE, bien au-delà de la
   * phrase qu'on écrit ici. Une forme valide reste documentée quoi qu'il arrive.
   */
  if (place.kind === 'point' && !clesPoint.every(cle => coordonneeRelevee(bout.entity[cle]))) {
    return PORT_POSITION_TO_CONFIRM_LABEL;
  }
  return PORT_POSITION_DOCUMENTED_LABEL;
}

export default Object.freeze({
  version: CABLE_ROUTE_PRESENTATION_VERSION,
  MAP_SCENE_LABEL, UNDOCUMENTED_TRANSITION_LABEL, sceneLabel, routeSequenceLabels, routeSequenceSentence,
  insertionChoices, routeBadge,
  PORT_POSITION_DOCUMENTED_LABEL, PORT_POSITION_TO_CONFIRM_LABEL, endpointVisualPositionLabel
});
