import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionTrail, FALLBACK_GROUP_ID } from '../navigation-groups.js';
import { allowedSectionsForRole } from '../navigation-contract.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ui = lire('admin-ui.js');

const TITRES = {
  dashboard: 'Tableau de bord', devices: 'Équipements', salles: 'Salles', baies: 'Baies',
  cables: 'Câbles', settings: 'Paramètres', logs: 'Journal', users: 'Utilisateurs',
  exploitation: 'Exploitation', walls: "Mur d'images", tickets: 'Tickets',
  screensDiagnostic: 'Diagnostic Écrans', reports: 'Rapports', locations: 'Localisations',
  signalFlow: 'Flux de signal', continuity: 'Continuité antenne', diagrams: 'Schémas techniques',
  knowledge: 'Base de connaissances', integrity: 'Intégrité', zoneAccess: 'Accès zones'
};

/*
 * LA COUCHE DE CONTEXTE — savoir où l'on est, sur chaque page.
 *
 * Chaque page se comportait comme une île : rien, au-dessus du contenu, ne disait à quelle
 * famille elle appartenait ni quel chemin y menait. Cette barre répond à la seule question
 * qu'on peut toujours trancher sans lire aucune donnée : « Infrastructure › Équipements ».
 *
 * Elle n'affiche PAS l'entité ouverte — salle, baie, appareil. Les sections n'exposent pas
 * encore de sélection courante de façon uniforme, et l'inventer afficherait une position que
 * personne n'a déclarée. Le chemin complet jusqu'à l'appareil existe déjà dans la Fiche 360.
 */

test('le chemin est toujours « famille › page »', () => {
  assert.deepEqual(sectionTrail('devices', TITRES).map(m => m.label),
    ['Infrastructure', 'Équipements']);
  assert.deepEqual(sectionTrail('settings', TITRES).map(m => m.label),
    ['Administration', 'Paramètres']);
  assert.deepEqual(sectionTrail('logs', TITRES).map(m => m.label),
    ['Opérations', 'Journal']);
});

test('chaque section de chaque rôle sait dire où elle se trouve', () => {
  // Une page sans contexte est exactement le défaut qu'on corrige : il ne doit en rester
  // aucune, pour aucun des six rôles.
  for (const role of ['admin', 'manager', 'chef', 'responsible', 'technician', 'visitor']) {
    for (const section of allowedSectionsForRole(role)) {
      const chemin = sectionTrail(section, TITRES);
      assert.equal(chemin.length, 2, `« ${section} » (${role}) n’a pas de chemin complet`);
      assert.ok(chemin.every(m => String(m.label).trim()), `« ${section} » a un maillon vide`);
    }
  }
});

test('la famille porte son icône, la page porte sa clé', () => {
  const [famille, page] = sectionTrail('devices', TITRES);
  assert.equal(famille.kind, 'group');
  assert.match(famille.icon, /^fas fa-/);
  assert.equal(page.kind, 'section');
  assert.equal(page.section, 'devices');
});

test('une section inconnue affiche sa clé plutôt qu’un vide', () => {
  // Un libellé vide donnerait un fil d'Ariane tronqué sans rien pour comprendre pourquoi.
  const chemin = sectionTrail('planning', {});
  assert.deepEqual(chemin.map(m => m.label), ['Autres', 'planning']);
  assert.equal(chemin[0].id, FALLBACK_GROUP_ID);
});

test('une entrée absurde ne produit pas de barre', () => {
  for (const valeur of ['', '   ', null, undefined]) {
    assert.deepEqual(sectionTrail(valeur, TITRES), [], `« ${String(valeur)} » a produit un chemin`);
  }
});

/* ------------------------------------------------------------------ le rendu */

test('la barre est reposée après CHAQUE rendu, y compris en erreur', () => {
  // `loadSection` remplace tout le contenu de `#admin-content` : sans cela la barre
  // disparaît à la première navigation. Le `finally` couvre aussi le chemin d'erreur, où
  // savoir sur quelle page on se trouve est le plus utile.
  const bloc = ui.slice(ui.indexOf('async loadSection(section)'), ui.indexOf('showTicketsSection() {'));
  assert.match(bloc, /\} finally \{[\s\S]*?this\.renderContextBar\(section\);/);
  // La section Tickets ne passe pas par `loadSection` quand on clique son entrée de menu :
  // elle repose la barre elle-même.
  assert.match(ui, /this\.renderContextBar\('tickets'\);/);
});

test('la barre vit DANS le contenu, pas à côté', () => {
  // `#admin-content` porte une marge gauche qui suit la largeur de la barre latérale, et
  // cette largeur change à chaque palier. Poser la barre à côté obligerait à recopier ces
  // paliers dans une seconde règle — deux géométries à tenir d'accord à la main.
  assert.match(ui, /contenu\.prepend\(barre\)/);
  assert.doesNotMatch(lire('admin.css'), /\.context-bar\s*\{[^}]*margin-left/);
});

test('la barre précédente est retirée avant d’en poser une neuve', () => {
  // Sinon chaque navigation en empile une de plus. Mesuré : 1 seule barre après 20 allers-
  // retours entre deux sections.
  assert.match(ui, /contenu\.querySelector\(':scope > \.context-bar'\)\?\.remove\(\)/);
});

test('la barre est reposée même quand une section se rend en DEUX temps', () => {
  // MESURÉ sur « Équipements » : `loadSection` finit, la barre est posée, puis un
  // `afterRender` asynchrone remplace tout le contenu et l'emporte. 500 ms après la
  // navigation, il n'y avait plus de barre ; elle ne revenait qu'au rechargement suivant,
  // donc par accident.
  //
  // Surveiller le conteneur couvre tous les chemins de rendu, y compris ceux qui n'existent
  // pas encore — courir après chaque appelant, non.
  // Le surveillant doit être POSÉ au démarrage, pas seulement défini : un test de mutation
  // l'a montré en survivant au retrait de son appel, la définition suffisant à le satisfaire.
  assert.match(ui, /this\.bindEvents\(\);\s*\n\s*this\.watchContextBar\(\);/);
  assert.match(ui, /new MutationObserver\(\(\) => \{[\s\S]*?renderContextBar\(\)/);
  assert.match(ui, /\.observe\(contenu, \{ childList: true \}\)/);
  // Installé une seule fois : un observateur par navigation les empilerait.
  assert.match(ui, /if \(this\._observateurContexte\) return this\._observateurContexte;/);
  // Et la reposer ne doit se faire QUE si elle manque, sinon l'observateur se rappelle
  // lui-même sans fin.
  assert.match(ui, /if \(!contenu\.querySelector\(':scope > \.context-bar'\)\) this\.renderContextBar\(\)/);
});

test('les libellés sont échappés', () => {
  // Ils viennent du registre des sections, que des modules tiers enrichissent.
  // Borner sur la DÉFINITION de `renderLayout`, pas sur son appel dans le constructeur —
  // qui apparaît plus tôt dans le fichier et rendait cette tranche vide.
  const bloc = ui.slice(ui.indexOf('renderContextBar(section'), ui.indexOf('\n  renderLayout() {'));
  assert.ok(bloc.length > 200, 'la tranche analysée est vide : les bornes sont fausses');
  assert.match(bloc, /escapeHTML\(maillon\.icon\)/);
  // LES DEUX branches — famille et page courante. Vérifier qu'« un » échappement existe
  // laissait passer la mutation d'une seule des deux : un test de mutation y a survécu.
  assert.equal((bloc.match(/escapeHTML\(maillon\.label\)/g) || []).length, 2,
    'une des deux branches du fil d’Ariane n’échappe pas son libellé');
  assert.doesNotMatch(bloc, /\$\{maillon\.label\}/, 'un libellé est inséré sans échappement');
  assert.doesNotMatch(bloc, /\$\{maillon\.icon\}/, 'une icône est insérée sans échappement');
});

test('aucune feuille de style n’a été ajoutée pour la barre de contexte elle-même', () => {
  // Le compte de 34 date d'avant `pilot-technique-preview.css` (#PILOTE-UI-01) : un
  // survol opt-in unique, pas un précédent — il ne rouvre pas la porte à une 36e feuille
  // par composant. La barre de contexte, elle, n'en a toujours AUCUNE en propre.
  const html = lire('index.html');
  assert.equal((html.match(/href="[^"]+\.css"/g) || []).length, 35);
  assert.doesNotMatch(html, /context-bar[^"]*\.css/);
});
