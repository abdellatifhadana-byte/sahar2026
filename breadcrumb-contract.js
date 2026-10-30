import { locationPath, normalizeLocationKind, LOCATION_LABELS } from './location-contract.js';

export const BREADCRUMB_CONTRACT_VERSION = 1;

/**
 * @file breadcrumb-contract.js — la chaîne complète, de la ville jusqu'à l'appareil.
 *
 * CE QUI MANQUAIT
 * ---------------
 * La plateforme savait déjà construire DEUX fils d'Ariane, et ne les avait jamais joints :
 *
 *   - `relationship-contract.js` rend « Salle › Baie › Équipement » — le chemin physique
 *     à l'intérieur d'un bâtiment ;
 *   - `location-contract.js` rend « Ville › Région › Département » — l'échelle
 *     géographique AU-DESSUS de la salle.
 *
 * Rien ne reliait les deux, alors que `rooms.locationId` existe depuis la migration v17.
 * Résultat mesuré dans la Fiche 360 : « Emplacement : STC › B01 › CAM 1 ». Sur un parc
 * réparti sur plusieurs sites, cela ne dit pas DANS QUELLE VILLE se trouve l'appareil —
 * l'information la plus utile quand il faut envoyer quelqu'un.
 *
 * CE QUE CE FICHIER NE FAIT PAS
 * -----------------------------
 * Il n'INVENTE aucun niveau. Une salle sans `locationId` rend un chemin qui commence à la
 * salle, et c'est la vérité : personne n'a encore rattaché cette salle à une ville.
 * Fabriquer « Casablanca » par défaut donnerait une plateforme qui affirme, avec l'aplomb
 * d'une donnée saisie, quelque chose que personne n'a jamais déclaré.
 */

/** Section d'administration à ouvrir quand on clique sur un maillon. */
export const BREADCRUMB_SECTIONS = Object.freeze({
  location: 'locations',
  room: 'salles',
  baie: 'baies',
  equipment: 'devices'
});

const texte = value => String(value ?? '').trim();

/**
 * Joint le chemin géographique au chemin physique.
 *
 * @param physicalPath  le `path` rendu par `resolveEquipmentLocation` :
 *                      `[{type:'room'|'baie'|'equipment', id, label, entity}]`.
 * @param locations     les enregistrements du magasin `locations`.
 */
export function fullBreadcrumbPath(physicalPath = [], locations = []) {
  const maillons = Array.isArray(physicalPath) ? physicalPath.filter(Boolean) : [];
  const salle = maillons.find(maillon => maillon.type === 'room');
  // `locationId` peut être porté par l'entité complète ou par le maillon lui-même, selon
  // l'appelant. Lire les deux évite un fil d'Ariane amputé pour une raison de forme.
  const locationId = salle?.entity?.locationId ?? salle?.locationId ?? null;

  const geographique = locationId ? locationPath(locationId, locations) : [];
  const chemin = [
    ...geographique.map(item => {
      const kind = normalizeLocationKind(item.kind);
      return {
        type: 'location', kind, id: item.id,
        label: texte(item.name),
        typeLabel: LOCATION_LABELS[kind] || 'Localisation',
        section: BREADCRUMB_SECTIONS.location
      };
    }),
    ...maillons
      .filter(maillon => BREADCRUMB_SECTIONS[maillon.type])
      .map(maillon => ({
        type: maillon.type, kind: maillon.type, id: maillon.id,
        label: texte(maillon.label),
        typeLabel: { room: 'Salle', baie: 'Baie', equipment: 'Équipement' }[maillon.type],
        section: BREADCRUMB_SECTIONS[maillon.type]
      }))
  ];
  // Un maillon sans nom afficherait un vide cliquable : mieux vaut ne pas le montrer.
  return Object.freeze(chemin.filter(maillon => maillon.label).map(Object.freeze));
}

/** Rendu texte, pour les journaux, les descriptions de ticket et les notifications. */
export function breadcrumbText(chemin = [], { separator = ' › ' } = {}) {
  return (Array.isArray(chemin) ? chemin : [])
    .map(maillon => texte(maillon?.label)).filter(Boolean).join(separator);
}

export default Object.freeze({
  version: BREADCRUMB_CONTRACT_VERSION,
  BREADCRUMB_SECTIONS, fullBreadcrumbPath, breadcrumbText
});
