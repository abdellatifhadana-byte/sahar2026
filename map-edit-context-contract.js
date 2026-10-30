const EDITABLE_MAP_ENTITY_TYPES = Object.freeze(['room', 'baie']);

/**
 * La vue AFFICHÉE est la seule autorité pour décider quelle fiche la carte peut modifier.
 *
 * Ce contrat est volontairement sans état : une baie ouverte hier, un hotspot cliqué juste
 * avant ou un ancien bouton encore présent ne peuvent pas influencer la réponse. Seule la
 * vue fournie à cet instant compte.
 */
export function editableMapEntityFromView(view) {
  const type = String(view?.type || '');
  const id = view?.id;
  if (!EDITABLE_MAP_ENTITY_TYPES.includes(type) || id == null || String(id).trim() === '') return null;
  return Object.freeze({ type, id });
}
