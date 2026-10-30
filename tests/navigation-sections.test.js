import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allowedSectionsForRole } from '../navigation-contract.js';

const racine = new URL('../', import.meta.url);
const lire = fichier => fs.readFileSync(new URL(fichier, racine), 'utf8');

// Les sections ne sont pas déclarées en un seul endroit : chaque module ajoute la sienne au
// registre de l'interface, sous la forme invariable `{ title, icon, component }`. On extrait
// donc les sections telles qu'elles s'enregistrent RÉELLEMENT, plutôt que de recopier une
// liste à la main — une liste recopiée dériverait au premier module ajouté.
const IGNORER = /^(LEGACY-ROOT|SOURCE-WALLS|app|assets|node_modules|tests|scripts)\//;
const MOTIFS = [
  /([A-Za-z][A-Za-z0-9]*)\s*:\s*\{\s*title\s*:[^}]{0,140}?icon\s*:/g,   // { cables: { title, icon, … } }
  /\.([A-Za-z][A-Za-z0-9]*)\s*=\s*\{\s*title\s*:[^}]{0,180}?icon\s*:/g  // ordered.cables = { title, icon, … }
];

function sectionsEnregistrees(fichiers) {
  const trouvees = new Set();
  for (const fichier of fichiers) {
    const source = lire(fichier);
    for (const motif of MOTIFS) for (const trouve of source.matchAll(motif)) trouvees.add(trouve[1]);
  }
  return trouvees;
}

const fichiersActifs = fs.readdirSync(fileURLToPath(racine))
  .filter(nom => nom.endsWith('.js') && !IGNORER.test(nom));

// Modules qui enregistrent des sections pour l'ADMIN. `responsible-ui.js` est exclu : il
// construit le registre du responsable, dont la composition est différente.
const MODULES_ADMIN = fichiersActifs.filter(nom => nom !== 'responsible-ui.js');

test('le contrat admin déclare exactement les sections réellement enregistrées', () => {
  // Vérifié à l'exécution le jour de l'écriture : les 19 clés extraites ici correspondent
  // une à une aux 19 entrées du menu latéral admin dans le navigateur, dans les deux sens.
  const enregistrees = sectionsEnregistrees(MODULES_ADMIN);
  const declarees = new Set(allowedSectionsForRole('admin'));

  const fournieNonDeclaree = [...enregistrees].filter(section => !declarees.has(section));
  const declareeNonFournie = [...declarees].filter(section => !enregistrees.has(section));

  // Une section fournie mais non déclarée est un piège : elle fonctionne tant que le routeur
  // admin dérive sa grille du registre vivant, et se bloque dès qu'un appelant fait confiance
  // au contrat. C'était le cas d'`exploitation`, `knowledge` et `zoneAccess`.
  assert.deepEqual(fournieNonDeclaree, [], `sections enregistrées mais absentes du contrat : ${fournieNonDeclaree.join(', ')}`);
  // Une section déclarée mais non fournie est le piège symétrique : un lien vers une page
  // qui n'existe pas.
  assert.deepEqual(declareeNonFournie, [], `sections déclarées mais jamais enregistrées : ${declareeNonFournie.join(', ')}`);
});

/*
 * LE REGISTRE DU RESPONSABLE NE TIENT PAS DANS `responsible-ui.js`.
 *
 * Quatre modules posent une section de plus sur `ResponsibleUI.prototype.renderBaseLayout`
 * après coup — exactement comme huit modules le font pour l'administrateur. Ne lire que
 * `responsible-ui.js` revenait donc à comparer le contrat à la moitié du registre : mesuré
 * dans le navigateur, le menu du responsable affichait onze entrées quand ce test n'en
 * connaissait que sept, et les quatre autres (`exploitation`, `continuity`, `diagrams`,
 * `screensDiagnostic`) échappaient à la vérification dans les DEUX sens.
 */
const MODULES_RESPONSABLE = Object.freeze([
  'responsible-ui.js',
  'operations-suite.js',      // exploitation
  'continuity-center.js',     // continuity
  'diagram-studio.js',        // diagrams
  'procedures-center.js',     // procedures
  'compat-integrations.js'    // screensDiagnostic (+ walls)
]);

/** Les sections que `fichier` pose sur la coque du responsable, et elles seules. */
function sectionsResponsable() {
  const trouvees = sectionsEnregistrees(['responsible-ui.js']);
  for (const fichier of MODULES_RESPONSABLE.slice(1)) {
    const source = lire(fichier);
    // On ne retient que ce qui est écrit DANS un patch de la coque responsable : ces
    // modules servent aussi l'administrateur, et prendre tout le fichier ferait entrer
    // dans le registre du responsable des sections qui ne lui sont jamais posées.
    for (const bloc of source.matchAll(/ResponsibleUI\.prototype\.renderBaseLayout\s*=\s*function[\s\S]{0,1200}?\n\s*\};/g)) {
      for (const motif of MOTIFS) for (const trouve of bloc[0].matchAll(motif)) trouvees.add(trouve[1]);
    }
  }
  return trouvees;
}

test('le contrat responsable tient compte des sections retirées et ajoutées', () => {
  const source = lire('responsible-ui.js');
  const construites = sectionsResponsable();

  // zone-access-integration.js retire `users` du responsable et lui ajoute `zoneAccess`.
  const integration = lire('zone-access-integration.js');
  assert.match(integration, /delete this\.sections\.users/, 'le retrait de `users` a disparu du module');
  assert.match(integration, /this\.sections\.zoneAccess\s*=/, 'l’ajout de `zoneAccess` a disparu du module');
  construites.delete('users');
  construites.add('zoneAccess');

  const declarees = new Set(allowedSectionsForRole('responsible'));
  assert.deepEqual([...construites].filter(s => !declarees.has(s)), [],
    'sections fournies au responsable mais absentes du contrat');
  assert.deepEqual([...declarees].filter(s => !construites.has(s)), [],
    'sections accordées au responsable mais jamais fournies');

  // `walls` reste conditionné à la permission ; le contrat autorise la route, la permission
  // décide de l'affichage. Les deux niveaux sont distincts et doivent le rester.
  assert.match(source, /PermissionManager\.check\(this\.user, 'walls', 'view'\)/);
});

test('chaque route technicien déclarée est traitée quelque part', () => {
  // Le technicien est le seul rôle dont le routeur n'a pas de filet : il ne passe pas
  // `allowedSections`, donc la liste figée du contrat EST la grille. Une route déclarée sans
  // traitement produirait « Section technicien non prise en charge ».
  const navigation = lire('role-navigation-integration.js');
  const traiteesExplicitement = new Set(
    [...navigation.matchAll(/route\.section === '([A-Za-z][A-Za-z0-9]*)'/g)].map(m => m[1])
  );
  const composants = new Set(
    [...(navigation.match(/technicianComponents\.set\(ui, \{[\s\S]*?\}\)/)?.[0] || '')
      .matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*new /g)].map(m => m[1])
  );
  const manquantes = allowedSectionsForRole('technician')
    .filter(section => !traiteesExplicitement.has(section) && !composants.has(section));
  assert.deepEqual(manquantes, [], `routes technicien sans traitement : ${manquantes.join(', ')}`);
});

test('le Journal reste hors de portée du technicien', () => {
  // Régression déjà corrigée : logsSection.js n'a aucun contrôle de permission, alors que la
  // matrice donne au technicien logs {view:false}. La route ne doit pas revenir.
  assert.ok(!allowedSectionsForRole('technician').includes('logs'));
  // Le composant reste instancié pour l'admin ; c'est la route qui ferme l'accès.
  assert.match(lire('role-navigation-integration.js'), /logs\s*:\s*new LogsSection/);
});

test('aucun rôle ne reçoit une section d’un autre rôle par accident', () => {
  const visiteur = allowedSectionsForRole('visitor');
  for (const section of ['users', 'settings', 'logs', 'integrity', 'zoneAccess']) {
    assert.ok(!visiteur.includes(section), `le visiteur ne doit pas atteindre ${section}`);
  }
  const technicien = allowedSectionsForRole('technician');
  for (const section of ['users', 'settings', 'integrity', 'zoneAccess']) {
    assert.ok(!technicien.includes(section), `le technicien ne doit pas atteindre ${section}`);
  }
});
