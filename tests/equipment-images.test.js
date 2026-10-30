import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const equipements = lire('equipements.js');
const editeur = lire('equipment-editor-service.js');
const liaison = lire('equipment-media-linkage.js');

/*
 * LES IMAGES D'ÉQUIPEMENT — pourquoi elles n'apparaissaient plus.
 *
 * Le mécanisme était complet : le catalogue porte des visuels constructeur, et
 * `equipment-media.js` décore la colonne « Images » et la Fiche 360. Trois choses
 * l'empêchaient d'aboutir, toutes mesurées dans la base réelle.
 */

test('la catégorie ne bloque plus l’enregistrement de tout le parc', () => {
  // MESURÉ : 78 équipements, DONT AUCUN ne portait de catégorie — et le champ était
  // `required`. Toute modification d'équipement était donc refusée par la validation du
  // navigateur, en silence : le formulaire ne se soumettait pas, aucun message n'était
  // affiché, et l'utilisateur ne pouvait rien enregistrer.
  const champ = equipements.slice(equipements.indexOf('<select name="categorie"'), equipements.indexOf('name="marque"'));
  assert.doesNotMatch(champ, /<select name="categorie"\s+required/);
  assert.match(champ, /Catégorie \(facultatif\)/);
});

test('les catégories décrivent un parc de diffusion, pas un parc de bureau', () => {
  // Les trois seules valeurs proposées — Réseau, Informatique, Énergie — ne décrivent ni
  // une caméra, ni un CCU, ni un magnétoscope, ni une grille de commutation. Le parc réel
  // compte 22 routeurs et 4 magnétoscopes, plus intercom, monitoring et mesure.
  for (const categorie of ['Vidéo', 'Audio', 'Commutation / routage', 'Monitoring', 'Mesure', 'Intercom']) {
    assert.ok(equipements.includes(`<option value="${categorie}">`), `catégorie « ${categorie} » absente`);
  }
  // Les anciennes valeurs restent : des enregistrements pourraient les porter.
  for (const ancienne of ['Réseau', 'Informatique', 'Énergie']) {
    assert.ok(equipements.includes(`<option value="${ancienne}">`), `catégorie « ${ancienne} » perdue`);
  }
});

test('une adresse d’image constructeur peut être saisie', () => {
  // C'est le chemin qui manquait : le catalogue porte des visuels officiels pour certains
  // modèles, mais pas pour ceux que 2M possède. Sans champ pour la coller, une adresse
  // trouvée sur le site du constructeur n'avait nulle part où être enregistrée.
  assert.match(equipements, /<input name="imageUrl" id="eq-image-url" type="url"/);
  assert.match(editeur, /const adresse = String\(form\.imageUrl\?\.value \|\| ''\)\.trim\(\)/);
  // Seul https est accepté : une image en http ferait basculer la page en contenu mixte
  // et le navigateur la bloquerait sans rien dire.
  assert.match(editeur, /if \(!\/\^https:\\\/\\\/\/i\.test\(adresse\)\)/);
});

test('l’adresse se relit à la réouverture, et remplace au lieu de s’empiler', () => {
  // Sans relecture, rouvrir la fiche puis enregistrer effacerait l'adresse. Sans
  // remplacement, la modifier trois fois laisserait trois visuels concurrents.
  assert.match(editeur, /if \(form\.imageUrl && Array\.isArray\(existing\?\.images\)\)/);
  assert.match(editeur, /const distante = existing\.images\.find\(item => \/\^https\?:/);
  assert.match(editeur, /data\.images = data\.images\.filter\(item => !\/\^https\?:/);
});

test('téléverser une photo n’efface plus les précédentes', () => {
  // L'ancienne forme conservait les images existantes seulement dans la branche `else` —
  // c'est-à-dire uniquement quand AUCUN fichier n'était ajouté. Ajouter une photo
  // supprimait donc toutes les autres.
  const bloc = editeur.slice(editeur.indexOf('Les photos DÉJÀ enregistrées'), editeur.indexOf('data.qr ='));
  assert.match(bloc, /if \(Array\.isArray\(existing\?\.images\)\) data\.images = \[\.\.\.existing\.images\];/);
  assert.doesNotMatch(bloc, /\} else if \(Array\.isArray\(existing\?\.images\)\) \{\s*data\.images = \[\.\.\.existing\.images\];/);
});

test('un rattachement de catalogue PENDANT est réparé', () => {
  // MESURÉ : douze équipements pointaient vers `kb-sony-vtr`, une entrée de catalogue qui
  // n'existe pas. La boucle de réparation les écartait parce qu'ils avaient DÉJÀ un
  // `catalogId` — sans vérifier qu'il désigne quelque chose. Ils étaient donc exclus de la
  // réparation à cause du lien cassé lui-même.
  assert.match(liaison, /const catalogueExiste = id => refreshedCatalogs\.some/);
  assert.match(liaison, /if \(actuel && catalogueExiste\(actuel\)\) continue;/);
  assert.doesNotMatch(liaison, /if \(String\(equipment\.catalogId \|\| ''\)\.trim\(\)\) continue/);
});

/* =========================================================================
   PORTS DE LA GRILLE CENTRALE
   ========================================================================= */

test('les ports de la grille sont LISTÉS, plus seulement comptés', () => {
  // Le défaut : la Fiche 360 n'affichait qu'un nombre — « Ports grille ↔ physiques
  // validés : 3 ». Or un port de grille porte son numéro physique, sa direction, son nom,
  // son alias logique, le type de signal, l'état de vérification et le port physique
  // d'aboutissement. Tout cela était CALCULÉ, puis réduit à un compteur. Un numéro seul
  // ne permet ni de repiquer un signal, ni de retrouver une entrée sur la face arrière.
  const relations = lire('equipment-relations-360.js');
  assert.match(relations, /function grillePortsMarkup\(ports = \[\]\)/);
  assert.match(relations, /\$\{grillePortsMarkup\(summary\.mappedRouterPorts\)\}/);
  // Les quatre informations demandées par le client, plus le port physique d'aboutissement.
  for (const champ of ['portNumber', 'direction', 'logicalAlias', 'signalType', 'physicalPortRef']) {
    assert.ok(relations.includes(champ), `le champ « ${champ} » n’est pas rendu`);
  }
  assert.match(relations, /port\.name \|\| port\.label/);
});

test('l’absence de port se dit, au lieu d’un tableau vide', () => {
  const relations = lire('equipment-relations-360.js');
  assert.match(relations, /Aucun port de grille rattaché à cet équipement/);
});

test('les ports sont triés dans l’ordre de la face arrière', () => {
  // Entrées puis sorties, chacune par numéro croissant : c'est l'ordre dans lequel on
  // cherche physiquement. Un tri par ordre d'insertion rendrait la table inutilisable
  // sur une grille de 190 entrées.
  const relations = lire('equipment-relations-360.js');
  assert.match(relations, /const tri = \(a, b\) => String\(a\.direction \|\| ''\)\.localeCompare/);
  assert.match(relations, /Number\(a\.portNumber \|\| 0\) - Number\(b\.portNumber \|\| 0\)/);
});

test('un tableau large défile dans son cadre, pas la fiche entière', () => {
  // La grille centrale est une 190×184 : la table est nécessairement large.
  const css = lire('operations-suite.css');
  assert.match(css, /\.gc-ports-wrap\{overflow-x:auto/);
  assert.match(css, /\.gc-ports\{[^}]*min-width:520px/);
});
