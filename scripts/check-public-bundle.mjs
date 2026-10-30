/**
 * @file scripts/check-public-bundle.mjs — la garde qui empêche la donnée opérationnelle
 *       de revenir dans le bundle public.
 *
 * POURQUOI CE N'EST PAS UN `grep "STC"`
 * -------------------------------------
 * Une liste de mots interdits ne tient pas : elle rate ce qu'elle n'a pas prévu — un repère
 * de câble, un numéro de baie, une capacité de matrice — et elle bloque du texte innocent.
 * Elle donne surtout une fausse assurance : le jour où quelqu'un ajoute un tableau de
 * libellés que la liste ne connaît pas, elle passe au vert.
 *
 * Cette garde vérifie donc des propriétés STRUCTURELLES, qui restent vraies quel que soit le
 * vocabulaire employé :
 *
 *   1. le module privé n'est atteignable par AUCUN chemin d'import du graphe public ;
 *   2. son dossier est refusé par le serveur statique ;
 *   3. les modules d'affichage n'exportent ni ne figent plus de jeu de données —
 *      ni les tableaux nommés qui existaient, ni un tableau de même forme ;
 *   4. l'endpoint est bien gardé par le moteur d'accès, pas par un test de rôle ;
 *   5. le client ne lit ces données que par cet endpoint, et ne se replie sur rien.
 *
 * `node scripts/check-public-bundle.mjs`
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = chemin => readFileSync(join(racine, chemin), 'utf8');

const MODULE_PRIVE = 'scripts/private-operational-data/grille-centrale.js';
const PASSERELLE = 'grille-centrale-dataset.js';
const ENDPOINT = '/api/operational/grille-centrale/documented-map';

const echecs = [];
const verifier = (condition, message) => { if (!condition) echecs.push(message); };

/* ── 1. Le graphe public, tel que le navigateur le charge ───────────────────── */
const html = lire('index.html');
const entrees = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => m[1]);
const vus = new Set();
const graphe = [];
function parcourir(fichier) {
  if (vus.has(fichier) || !existsSync(join(racine, fichier))) return;
  vus.add(fichier);
  graphe.push(fichier);
  const source = lire(fichier);
  const imports = [
    ...[...source.matchAll(/(?:^|\n)\s*import[^'"]*['"](\.\/[^'"]+)['"]/g)].map(m => m[1]),
    ...[...source.matchAll(/import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)].map(m => m[1])
  ].map(chemin => chemin.replace(/^\.\//, ''));
  for (const suivant of imports) parcourir(suivant);
}
for (const entree of entrees) parcourir(entree);

verifier(!vus.has(MODULE_PRIVE),
  `Le module privé « ${MODULE_PRIVE} » est atteignable depuis le graphe public : il serait téléchargé par le navigateur.`);
verifier(!graphe.some(fichier => fichier.startsWith('scripts/')),
  'Un module sous « scripts/ » est importé par le bundle public ; ce dossier n’est pas servi.');

/* ── 2. Le serveur refuse le dossier privé ──────────────────────────────────── */
const serve = lire('scripts/serve.js');
verifier(/PRIVATE_PREFIXES\s*=\s*new Set\(\[[^\]]*'scripts'/.test(serve),
  '« scripts » ne figure plus dans PRIVATE_PREFIXES : le jeu de données redeviendrait téléchargeable.');

/* ── 3. Aucun jeu de données dans les modules d'affichage ───────────────────── */
const MODULES_PUBLICS = [
  'grille-centrale-documented-map.js',
  'grille-centrale-topology.js',
  'grille-centrale-knowledge.js',
  'grille-centrale-physical-architecture.js',
  'grille-centrale-field-verification.js',
  PASSERELLE
];

// Les noms qui portaient le jeu de données. Ils ne doivent plus être DÉFINIS ici.
const CONSTANTES_DEPLACEES = [
  'GRILLE_CENTRALE_INPUT_LABELS', 'GRILLE_CENTRALE_OUTPUT_LABELS', 'GRILLE_CENTRALE_DOCUMENTED_PORTS',
  'GRILLE_CENTRALE_SOURCE_DOCUMENT', 'GRILLE_CENTRALE_DOCUMENT_DOMAINS', 'GRILLE_CENTRALE_REFERENCE_INTERFACES',
  'GRILLE_CENTRALE_GR_OBSERVATIONS', 'GRILLE_CENTRALE_MONITORING_PATHS', 'GRILLE_CENTRALE_PHASE13_INVARIANTS',
  'GRILLE_CENTRALE_TOPOLOGY_INTERFACES', 'GRILLE_CENTRALE_FACTS', 'GRILLE_CENTRALE_PORTS',
  'GRILLE_CENTRALE_CANDIDATE_IMAGES', 'GRILLE_CENTRALE_PHYSICAL_NODES', 'GRILLE_CENTRALE_PHYSICAL_LINKS',
  'GRILLE_CENTRALE_PHYSICAL_INVARIANTS', 'GRILLE_CENTRALE_VENDOR_RESEARCH'
];

/*
 * LA RÈGLE DE FORME, CELLE QUI ATTRAPE CE QU'ON N'A PAS PRÉVU.
 *
 * Un jeu de données ressemble toujours à la même chose : un tableau figé d'au moins dix
 * éléments. Peu importe son nom et peu importe ce qu'il contient — un module d'affichage
 * n'a aucune raison d'en porter un. La limite est haute pour laisser passer les petites
 * listes de service (statuts autorisés, modes de preuve) et basse devant les 190 libellés.
 */
const SEUIL_JEU_DE_DONNEES = 10;

/**
 * Les tableaux figés d'un source, et leur nombre RÉEL d'éléments.
 *
 * On compte les virgules de premier niveau, pas les lignes : un jeu de données réintroduit
 * sur une seule ligne est exactement celui qu'une garde naïve laisse passer, et c'est la
 * forme qu'on obtient en collant une constante minifiée.
 */
function tableauxFiges(source) {
  const trouves = [];
  for (const amorce of source.matchAll(/Object\.freeze\(\[/g)) {
    const debut = amorce.index + amorce[0].length;
    let profondeur = 1;
    let elements = 1;
    let i = debut;
    let chaine = null;
    for (; i < source.length && profondeur > 0; i += 1) {
      const c = source[i];
      if (chaine) {
        if (c === '\\') i += 1;
        else if (c === chaine) chaine = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { chaine = c; continue; }
      if (c === '[' || c === '{' || c === '(') profondeur += 1;
      else if (c === ']' || c === '}' || c === ')') profondeur -= 1;
      else if (c === ',' && profondeur === 1) elements += 1;
    }
    // Un tableau vide compte zéro, pas un.
    if (!source.slice(debut, i - 1).trim()) elements = 0;
    trouves.push({ debut, elements });
  }
  return trouves;
}

for (const fichier of MODULES_PUBLICS) {
  const source = lire(fichier);
  const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const nom of CONSTANTES_DEPLACEES) {
    verifier(!new RegExp(`(?:const|let|var)\\s+${nom}\\s*=`).test(sansCommentaires),
      `${fichier} redéfinit « ${nom} » : ce jeu de données appartient au module privé.`);
  }

  for (const { debut, elements } of tableauxFiges(sansCommentaires)) {
    verifier(elements < SEUIL_JEU_DE_DONNEES,
      `${fichier} fige un tableau de ${elements} éléments (offset ${debut}) : un module d’affichage ne porte pas de jeu de données.`);
  }
}

/* ── 4. L'endpoint est gardé par le moteur d'accès ──────────────────────────── */
verifier(serve.includes(ENDPOINT), `L’endpoint ${ENDPOINT} a disparu de serve.js.`);
const bloc = serve.slice(serve.indexOf(ENDPOINT), serve.indexOf(ENDPOINT) + 1800);
verifier(/access\.canReadGrilleCentraleDataset\(/.test(bloc),
  'L’endpoint ne demande plus au moteur d’accès s’il doit répondre.');
verifier(!/role\s*===\s*'(admin|manager)'|isPlatformAdmin\(|seesEverything\(/.test(bloc),
  'L’endpoint décide sur le rôle au lieu de la ressource : l’autorisation doit passer par l’équipement canonique.');

const acces = lire('scripts/access-control.js');
const gardeBloc = acces.slice(acces.indexOf('async function canReadGrilleCentraleDataset'));
verifier(/canAccessRecord\(user, 'equipments'/.test(gardeBloc.slice(0, 900)),
  'canReadGrilleCentraleDataset ne s’appuie plus sur l’autorisation de l’équipement canonique.');

/* ── 5. Le client passe par l'endpoint, et ne se replie sur rien ────────────── */
const passerelle = lire(PASSERELLE);
verifier(passerelle.includes(ENDPOINT), `${PASSERELLE} n’appelle plus ${ENDPOINT}.`);
verifier(!/localStorage\.setItem|indexedDB|db\.save/.test(passerelle),
  `${PASSERELLE} persiste le jeu de données : il doit rester en mémoire de l’onglet.`);

for (const fichier of MODULES_PUBLICS.filter(nom => nom !== PASSERELLE)) {
  const source = lire(fichier);
  verifier(/from '\.\/grille-centrale-dataset\.js'/.test(source),
    `${fichier} n’obtient pas ses données par la passerelle autorisée.`);
}

/* ── 6. La capacité de la matrice ne revient pas en clair ───────────────────
 *
 * Cette sonde-là EST textuelle, et c'est assumé : elle ne remplace pas les règles
 * structurelles ci-dessus, elle rattrape un cas précis qu'elles ne voient pas — une capacité
 * réécrite à la main dans un libellé d'écran. Elle accepte les identifiants canoniques,
 * que #137 conserve délibérément, et refuse tout le reste. Le « × » typographique compte
 * autant que le « x » : c'est exactement par là que la première relecture est passée.
 */
const CAPACITE = [
  // « 190 × 184 » et ses variantes typographiques — le piège de la première relecture.
  /(?<!-)190\s*[x×✕✖*]\s*(?:184|190)/u,
  // « 190 entrées / 184 sorties » : la même capacité, écrite en toutes lettres.
  /\d{2,4}\s*(?:entrées|entrees|inputs)\s*\/\s*\d{2,4}\s*(?:sorties|outputs)/iu,
  // Une capacité posée en dur dans une fiche.
  /(?:input|output)Capacity\s*:\s*\d{2,4}/u,
  /logical(?:Inputs|Outputs)\s*:\s*\d{2,4}/u
];
for (const fichier of MODULES_PUBLICS) {
  for (const ligne of lire(fichier).split('\n')) {
    const sansIdentifiants = ligne.replace(/[a-z]+-[a-z-]*190x18[40]/g, '');
    verifier(!CAPACITE.some(sonde => sonde.test(sansIdentifiants)),
      `${fichier} écrit la capacité de la matrice en clair : « ${ligne.trim().slice(0, 90)} ».`);
  }
}

/* ── 7. Aucun panneau 360 ne se dessine sans autorisation ───────────────────
 *
 * Un panneau « dégradé » — un compteur à zéro, une liste vide, une capacité affichée sans
 * ses ports — enseigne déjà ce que ce lot retire. Chaque module qui construit un panneau
 * doit donc refuser AVANT de dessiner, et pas seulement s'abstenir d'écrire.
 */
for (const [fichier, garde] of [
  ['grille-centrale-documented-map.js', /if \(!ensured\.authorized\) return false;/],
  ['grille-centrale-topology.js', /if \(!ensured\.authorized\) return false;/],
  ['grille-centrale-physical-architecture.js', /if \(!ensured\.authorized\) return false;/],
  ['grille-centrale-field-verification.js', /if \(!snapshot\.authorized\) return false;/]
]) {
  verifier(garde.test(lire(fichier)),
    `${fichier} dessine son panneau 360 sans vérifier l’autorisation.`);
}

/* ── 8. Une surface qui s'ouvre redemande au serveur ────────────────────────
 *
 * Le blocage trouvé avant PR : le jeu de données restait en mémoire tant que
 * `${id}:${authVersion}` ne bougeait pas, alors que `revokeGrant()` ne touche jamais à cette
 * version. Une habilitation retirée laissait donc le panneau se dessiner. Chaque ouverture
 * de surface doit revalider ; la mémoire n'est jamais l'autorité.
 */
for (const fichier of MODULES_PUBLICS.filter(nom => nom !== PASSERELLE)) {
  const source = lire(fichier);
  if (!/enhance\w*360/.test(source)) continue;
  verifier(/revalidate:\s*true/.test(source),
    `${fichier} ouvre un panneau 360 sans revalider l’autorisation auprès du serveur.`);
}
/*
 * LA PORTÉE EST PARTAGÉE, ET LA GARDE LA SUIT (A-5).
 *
 * `porteeOperationnelleCourante()` vivait dans la passerelle Grille Centrale. Le relevé de
 * la Régie Car devant obéir EXACTEMENT à la même règle de mémoire, la fonction a été écrite
 * une seule fois dans `operational-dataset-scope.js` : deux copies d'une règle de sécurité,
 * c'est une règle qui finit par n'être vraie qu'à moitié.
 *
 * La garde vérifie donc DEUX choses, et elle couvre maintenant deux jeux de données au lieu
 * d'un : que la portée partagée lit bien le contexte d'accès vivant, et que CHAQUE transport
 * protégé s'en sert — sans quoi l'un d'eux pourrait se redonner une portée plus faible en
 * silence.
 */
// Le code de la passerelle, commentaires retirés : la note d'architecture cite volontairement
// l'ancienne forme fautive pour expliquer ce qui a été mesuré, et ne doit pas faire sonner.
const passerelleCode = passerelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PORTEE_PARTAGEE = 'operational-dataset-scope.js';
const TRANSPORTS_PROTEGES = Object.freeze([PASSERELLE, 'regie-car-dataset.js']);
const portee = lire(PORTEE_PARTAGEE);
const porteeCode = portee.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// La clé rendue doit JOINDRE le contexte d'accès au compte, pas s'arrêter au compte.
verifier(/return\s+`[^`]*\$\{contexte\}`/.test(porteeCode),
  'La portée mémorise à nouveau sur le seul numéro de session : `revokeGrant()` ne le modifie pas, une révocation n’invaliderait donc rien.');
verifier(/zone-access-context/.test(porteeCode),
  'La portée de la mémoire ne lit plus le contexte d’accès vivant.');

for (const transport of TRANSPORTS_PROTEGES) {
  const source = lire(transport).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  verifier(new RegExp(`import\\s*\\{[^}]*porteeOperationnelleCourante[^}]*\\}\\s*from\\s*'\\./${PORTEE_PARTAGEE.replace('.', '\\.')}'`).test(source),
    `${transport} n’indexe plus sa mémoire sur la portée partagée : une révocation ne l’invaliderait plus.`);
  // Aucun repli local : un transport qui relirait `auth` tout seul se redonnerait une portée
  // plus faible que celle que la garde ci-dessus vérifie.
  verifier(!/localStorage\.getItem\(\s*'auth'\s*\)/.test(source),
    `${transport} relit \`auth\` en propre au lieu d’utiliser la portée partagée.`);
}

/*
 * UNE OUVERTURE D'ÉCRAN EST UNE IDENTITÉ, PAS UN INSTANT.
 *
 * Le regroupement des dix revalidations d'une même ouverture s'est d'abord fait par une
 * fenêtre de deux secondes. Mesuré : une révocation à t+63 ms suivie d'une réouverture à
 * t+146 ms réutilisait le jeu de données sans rien demander au serveur. Le regroupement doit
 * donc se faire par jeton d'instance, jamais par horloge.
 */
verifier(/jetonDOuverture/.test(passerelleCode) && /WeakMap/.test(passerelleCode),
  'La passerelle ne regroupe plus les revalidations par jeton d’ouverture.');
verifier(!/Date\.now\(\)\s*-\s*\w+\s*<\s*\w*(?:RAFALE|FENETRE|WINDOW)\w*/i.test(passerelleCode),
  'La passerelle regroupe de nouveau les revalidations par une fenêtre temporelle : deux ouvertures distinctes rapprochées partageraient une seule décision serveur.');
for (const fichier of MODULES_PUBLICS.filter(nom => nom !== PASSERELLE)) {
  const source = lire(fichier);
  if (!/enhance\w*360/.test(source)) continue;
  verifier(/ouverture:\s*jetonDOuverture\(/.test(source),
    `${fichier} revalide sans jeton d’ouverture : sa surface ne serait pas distinguée de la précédente.`);
}

const serviceWorker = lire('service-worker.js');
verifier(/includes\('\/api\/'\)/.test(serviceWorker),
  'Le Service Worker ne distingue plus les routes /api/ : il pourrait mettre le jeu de données en cache.');

if (echecs.length) {
  console.error('\nBUNDLE PUBLIC — données opérationnelles détectées :\n');
  for (const echec of echecs) console.error(`  · ${echec}`);
  console.error('');
  process.exit(1);
}
console.log(`Bundle public vérifié : ${graphe.length} modules dans le graphe, aucun jeu de données opérationnel.`);
