export const NAVIGATION_GROUPS_VERSION = 1;

/**
 * @file navigation-groups.js — vingt entrées de menu deviennent sept familles.
 *
 * CE QUI N'ALLAIT PAS
 * -------------------
 * Mesuré sur le compte administrateur : 20 sections empilées dans une seule liste, sans
 * séparation ni hiérarchie. « Câbles », « Continuité », « Intégrité », « Schémas »,
 * « Zones » et « Journal » y ont exactement le même poids visuel que « Équipements », qui
 * est la page réellement utilisée tous les jours. Sur un écran de portable la liste dépasse
 * la hauteur visible : les six dernières sections ne sont atteignables qu'en faisant défiler
 * une barre latérale dont rien n'indique qu'elle défile.
 *
 * CE QUI CHANGE
 * -------------
 * Le REGROUPEMENT, et lui seul. Aucune section n'est retirée, renommée, fusionnée ou
 * déplacée d'un rôle à l'autre : `navigation-contract.js` reste seul maître de QUI voit
 * QUOI. Ce fichier ne décide que de l'ordre d'affichage et des intertitres.
 *
 * LA GARANTIE QUI COMPTE
 * ----------------------
 * Une section absente d'un groupe N'EST PAS PERDUE : elle rejoint « Autres ». C'est
 * délibéré. Les sections s'enregistrent en couches — huit modules en ajoutent une après
 * coup — et le jour où un module en ajoute une neuvième, elle doit apparaître dans le menu
 * SANS que personne n'ait pensé à modifier ce fichier. Une liste blanche silencieuse la
 * ferait disparaître de l'interface tout en la laissant accessible par URL : c'est
 * exactement le genre de trou qu'on ne découvre que des mois plus tard.
 */

export const FALLBACK_GROUP_ID = 'autres';

/**
 * Les six familles sont celles arrêtées par le propriétaire de la plateforme, avec leur
 * composition exacte. Deux intitulés seulement ont été traduits — « Signal & Broadcast » et
 * « Engineering » — parce que tout le reste de l'interface est en français : « Tableau de
 * bord », « Câbles », « Baies ». Deux titres anglais au milieu se remarqueraient.
 */
export const NAVIGATION_GROUPS = Object.freeze([
  Object.freeze({
    id: 'apercu', title: 'Aperçu', icon: 'fas fa-compass',
    sections: Object.freeze(['home', 'dashboard', 'exploitation', 'notifications'])
  }),
  Object.freeze({
    id: 'infrastructure', title: 'Infrastructure', icon: 'fas fa-sitemap',
    // L'ordre suit l'emboîtement réel : carte → salle → baie → équipement → câble.
    sections: Object.freeze(['map', 'salles', 'baies', 'devices', 'cables'])
  }),
  Object.freeze({
    id: 'signal', title: 'Signal & diffusion', icon: 'fas fa-satellite-dish',
    sections: Object.freeze(['continuity', 'signalFlow', 'walls', 'screensDiagnostic', 'screens'])
  }),
  Object.freeze({
    id: 'ingenierie', title: 'Ingénierie', icon: 'fas fa-drafting-compass',
    // `procedures` n'existe pas encore. La déclarer ICI plutôt qu'attendre : le jour où le
    // module s'enregistrera, sa place sera déjà décidée, au lieu d'atterrir dans « Autres ».
    sections: Object.freeze(['diagrams', 'knowledge', 'procedures'])
  }),
  Object.freeze({
    id: 'operations', title: 'Opérations', icon: 'fas fa-toolbox',
    sections: Object.freeze(['tickets', 'maintenance', 'requests', 'reports', 'logs'])
  }),
  Object.freeze({
    id: 'administration', title: 'Administration', icon: 'fas fa-user-shield',
    sections: Object.freeze(['users', 'zoneAccess', 'locations', 'integrity', 'settings'])
  })
]);

export const FALLBACK_GROUP = Object.freeze({
  id: FALLBACK_GROUP_ID, title: 'Autres', icon: 'fas fa-ellipsis-h', sections: Object.freeze([])
});

/** Index section → groupe, construit une fois. */
const INDEX = new Map();
for (const groupe of NAVIGATION_GROUPS) {
  for (const section of groupe.sections) INDEX.set(section, groupe.id);
}

export function groupOfSection(section) {
  return INDEX.get(String(section ?? '')) || FALLBACK_GROUP_ID;
}

/**
 * Répartit des clés de section dans les groupes, dans l'ordre d'affichage.
 *
 * - Les groupes vides sont omis : un intertitre sans rien dessous n'apprend rien.
 * - Les clés inconnues terminent dans « Autres », dans leur ordre d'arrivée.
 * - Les doublons sont écartés : une section ne peut pas figurer deux fois dans un menu.
 */
export function groupSections(sections = []) {
  const restantes = [];
  const vues = new Set();
  for (const brute of sections) {
    const section = String(brute ?? '').trim();
    if (!section || vues.has(section)) continue;
    vues.add(section);
    restantes.push(section);
  }

  const resultat = [];
  for (const groupe of NAVIGATION_GROUPS) {
    const membres = groupe.sections.filter(section => vues.has(section));
    if (membres.length) {
      resultat.push(Object.freeze({ ...groupe, sections: Object.freeze(membres) }));
    }
  }
  const orphelines = restantes.filter(section => !INDEX.has(section));
  if (orphelines.length) {
    resultat.push(Object.freeze({ ...FALLBACK_GROUP, sections: Object.freeze(orphelines) }));
  }
  return Object.freeze(resultat);
}

/**
 * Ouvrir une section DÉPLIE son groupe, et oublie le repli.
 *
 * MESURÉ : en arrivant sur `#/devices` alors que « Parc technique » était replié, la page
 * s'ouvrait bien, mais son entrée de menu restait cachée — plus rien n'indiquait où l'on se
 * trouvait. Le menu est construit AVANT que la route ne soit lue : `currentSection` vaut
 * encore « dashboard » à ce moment-là, si bien qu'aucune vérification faite au rendu ne peut
 * suffire. Il faut agir aussi à la navigation.
 *
 * Le repli est OUBLIÉ plutôt que contredit temporairement : sans cela l'état mémorisé et
 * l'état affiché divergent, et l'utilisateur voit le menu se replier tout seul plus tard,
 * sans avoir rien demandé.
 */
export function revealGroupOf(collapsed = [], section = '') {
  const restant = new Set([...collapsed].map(String));
  restant.delete(groupOfSection(section));
  return restant;
}

/**
 * Le chemin de contexte d'une section : « Infrastructure › Équipements ».
 *
 * C'est la partie du fil d'Ariane qu'on peut TOUJOURS calculer, quelle que soit la page et
 * sans lire la moindre donnée : la famille vient de la table ci-dessus, le titre du registre
 * des sections. Le prolongement vers l'entité ouverte — salle, baie, appareil — dépend de la
 * page et viendra s'accrocher à la suite ; il n'est pas inventé ici.
 *
 * @param titres  registre `{ cléDeSection: titre affiché }`, tel que l'interface le tient.
 */
export function sectionTrail(section, titres = {}) {
  const cle = String(section ?? '').trim();
  if (!cle) return Object.freeze([]);
  const groupe = NAVIGATION_GROUPS.find(g => g.id === groupOfSection(cle)) || FALLBACK_GROUP;
  // Une section inconnue du registre garde sa clé : afficher un libellé vide serait pire
  // que d'afficher un identifiant technique, qui reste au moins une piste.
  const titre = String(titres?.[cle] ?? '').trim() || cle;
  return Object.freeze([
    Object.freeze({ kind: 'group', id: groupe.id, label: groupe.title, icon: groupe.icon }),
    Object.freeze({ kind: 'section', id: cle, label: titre, section: cle })
  ]);
}

/** Toutes les sections d'un regroupement, à plat, dans l'ordre où elles s'affichent. */
export function flattenGroups(groupes = []) {
  return groupes.flatMap(groupe => [...groupe.sections]);
}

export default Object.freeze({
  version: NAVIGATION_GROUPS_VERSION,
  NAVIGATION_GROUPS, FALLBACK_GROUP, FALLBACK_GROUP_ID,
  groupOfSection, groupSections, revealGroupOf, sectionTrail, flattenGroups
});
