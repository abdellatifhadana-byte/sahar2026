import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { htmlEntryModules, relativeSpecifiers } from './module-graph.mjs';

/*
 * LA GARDE SUIT LE RÉPERTOIRE, PLUS UN NOM DE FICHIER (A-5).
 *
 * Elle dérivait ses empreintes d'UN seul fichier, `grille-centrale.js`. Le relevé de la
 * Régie Car est arrivé dans le même dossier — baies réelles, matériel par baie, repères
 * d'exploitation, numéro d'inventaire interne — et la garde ne l'aurait pas vu : un résidu
 * de CE jeu de données recopié dans un module public serait passé sans un mot.
 *
 * Les empreintes se dérivent donc de TOUS les jeux de données protégés, et un jeu de données
 * futur est couvert du seul fait d'exister dans ce dossier. Un dossier vide est une erreur,
 * pas un succès : c'est la différence entre « rien à protéger » et « garde débranchée ».
 */
const PRIVATE_DATASET_DIR = 'scripts/private-operational-data';

export function listPrivateDatasets(root) {
  const dossier = join(root, PRIVATE_DATASET_DIR);
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter(nom => nom.endsWith('.js') || nom.endsWith('.mjs'))
    .sort()
    .map(nom => `${PRIVATE_DATASET_DIR}/${nom}`);
}

export function stripComments(source = '') {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/*
 * UN VRAI BALAYAGE, PAS UNE EXPRESSION RÉGULIÈRE.
 *
 * L'extraction appariait les guillemets avec `/(['"`])…\1/g`. Elle ne savait donc pas
 * qu'une expression régulière littérale peut CONTENIR des guillemets. Mesuré sur
 * `grille-centrale-documented-map.js` :
 *
 *     const esc = value => String(value ?? '').replace(/[&<>"']/g, …)
 *                                                      ↑ ce guillemet ouvrait
 *                                                        une chaîne fantôme
 *
 * Le `"` de la classe de caractères ouvrait une chaîne qui avalait ensuite 5 258 octets de
 * code réel. Deux conséquences, et la seconde est la grave :
 *
 *   · du CODE se retrouvait analysé comme un libellé — d'où deux faux positifs de capacité
 *     sur des fichiers parfaitement propres ;
 *   · et surtout, toute vraie chaîne située après ce point cessait d'être émise comme
 *     littéral distinct. Un résidu opérationnel placé plus bas dans un tel fichier pouvait
 *     donc échapper aux règles qui comparent littéral par littéral.
 *
 * Le balayage ci-dessous suit l'état réel du source : chaîne, gabarit, expression
 * régulière, commentaire. Il ne resynchronise jamais au hasard.
 */
export function extractStringLiterals(source = '') {
  const code = String(source);
  const values = [];
  // Un `/` ouvre une expression régulière quand ce qui précède ne peut pas être un opérande.
  const REGEX_ALLOWED_BEFORE = /[(,=:[!&|?{};+\-*%~^<>]$/;
  const KEYWORD_BEFORE = /\b(?:return|typeof|instanceof|case|in|of|new|delete|void|throw|do|else|yield|await)$/;

  const emit = raw => {
    const value = raw.replace(/\\(['"`\\])/g, '$1').trim();
    if (value) values.push(value);
  };

  let index = 0;
  let significant = '';
  while (index < code.length) {
    const char = code[index];

    if (char === '/' && code[index + 1] === '/') {
      while (index < code.length && code[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && code[index + 1] === '*') {
      index += 2;
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let raw = '';
      index += 1;
      while (index < code.length) {
        if (code[index] === '\\') { raw += code[index] + (code[index + 1] ?? ''); index += 2; continue; }
        if (code[index] === quote) { index += 1; break; }
        raw += code[index];
        index += 1;
      }
      emit(raw);
      significant = quote;
      continue;
    }
    if (char === '/') {
      const trimmed = significant.trimEnd();
      const opensRegex = trimmed === '' || REGEX_ALLOWED_BEFORE.test(trimmed) || KEYWORD_BEFORE.test(trimmed);
      if (opensRegex) {
        index += 1;
        let inClass = false;
        while (index < code.length) {
          const current = code[index];
          if (current === '\\') { index += 2; continue; }
          if (current === '[') inClass = true;
          else if (current === ']') inClass = false;
          else if (current === '/' && !inClass) { index += 1; break; }
          else if (current === '\n') break;
          index += 1;
        }
        significant = '/';
        continue;
      }
    }
    if (!/\s/.test(char)) significant += char;
    if (significant.length > 32) significant = significant.slice(-32);
    index += 1;
  }
  return values;
}

/*
 * LES VALEURS CALCULÉES COMPTENT AUTANT QUE LES VALEURS ÉCRITES (A-5).
 *
 * MESURÉ en généralisant cette garde : le relevé de la Régie Car nomme ses baies par un
 * GABARIT — `` `BAIE ${number}` `` — et non par des chaînes littérales. L'extraction de
 * littéraux, qui lit le texte du source, ne voyait donc jamais « BAIE 11 » : un résidu de ce
 * jeu de données recopié dans un module public serait passé sans un mot, alors même que la
 * garde prétendait le couvrir.
 *
 * `extraLiterals` reçoit les valeurs du jeu de données ÉVALUÉ. Elles traversent ensuite
 * exactement les mêmes règles de classement que les littéraux du source — un nom de
 * fabricant ou un modèle de catalogue n'y devient pas une empreinte pour autant.
 */
export function buildProtectedFingerprints(privateSource = '', extraLiterals = [], extraNarratives = []) {
  const code = stripComments(privateSource) + '\n' + extraLiterals.map(valeur => JSON.stringify(String(valeur))).join('\n');
  const cableRefs = new Set(code.match(/\bGR\d{2,5}\b/gi)?.map(value => value.toUpperCase()) || []);
  const labels = new Set(
    extractStringLiterals(code).filter(value =>
      /^(?:VTR|RF|SYNC|ST|MT|ISY|NEDIT|NEWS|EXT|CTRL|MONITORING|BAIE|CHASSIS|RESERVE)\b/i.test(value)
      || /\bGR\d{2,5}\b/i.test(value)
    )
  );
  // Les capacités protégées se DÉDUISENT du dataset privé, elles ne sont pas écrites ici.
  // Une garde qui code en dur « 190×184 » ne protège que ce couple-là et devient fausse le jour
  // où l'installation change ; elle laisserait aussi passer une résolution vidéo (1920×1080)
  // si on élargissait le motif au hasard.
  // On ne retient QUE la forme identifiant compacte (`190x184`, x ASCII, sans espace) :
  // c'est ainsi que le dataset privé écrit l'identité de la matrice de l'installation
  // (`router-gc190x184`, `kb-grille-centrale-190x184`). Les capacités constructeur qu'il cite
  // au passage — `72×72`, `16×16 à 288×288` du Platinum VX — sont en prose avec `×` : ce sont
  // des specs publiques de catalogue, pas la capacité protégée, et les prendre pour empreintes
  // faisait rejeter des fiches produit légitimes.
  const capacityPairs = new Set(
    (code.match(/(?<!\d)\d{2,4}x\d{2,4}(?!\d)/gi) || []).map(value => value.toLowerCase())
  );
  const literals = extractStringLiterals(code);
  // Implantations réelles : « BAIE 3 GRILLE CENTRALE », « CHASSIS 5 », « BAIE GR-1 ».
  /*
   * Une implantation doit être QUALIFIÉE pour être une empreinte.
   *
   * La règle acceptait `^(?:BAIE|CHASSIS)\s+\S`, donc « BAIE 2 » tout court. Or toute
   * installation possède une baie 2 : prise pour empreinte, elle faisait sonner
   * `equipment-field-evidence.js` sur « RACK 3.BAIE 2 », qui ne révèle pourtant rien du jeu
   * de données protégé. Ce qui identifie une implantation, c'est le qualificatif qui suit —
   * « BAIE 3 GRILLE CENTRALE », « BAIE GR-1 », « CHASSIS 4 — Harris Platinum ».
   */
  const locations = new Set(literals.filter(value => {
    if (!/^(?:BAIE|CHASSIS)\s+\S/i.test(value)) return false;
    // Un NUMÉRO NU ne désigne rien : toute installation a une baie 2. Ce qui identifie une
    // implantation, c'est le qualificatif — « BAIE GR-1 », « BAIE 3 GRILLE CENTRALE »,
    // « CHASSIS 4 — Harris Platinum ». Les baies de la Régie Car, elles, sont nommées
    // « BAIE 11 » tout court : elles sont protégées par leur IDENTIFIANT de fiche
    // (`regie-car-baie-11`), pas par un libellé que le métier entier partage.
    return !/^(?:BAIE|CHASSIS)\s+\d+$/i.test(value.trim());
  }));
  /*
   * LES IDENTIFIANTS INTERNES — ce qui ne peut venir que de CETTE installation.
   *
   * Les repères de la Régie Car (« CAM 1 », « GR SEC 1 ») ressemblent trop à du vocabulaire
   * métier pour être reconnus par motif sans faire sonner des modules légitimes. Ses
   * identifiants, eux, sont sans ambiguïté : un numéro d'inventaire 2M, une référence de
   * relevé terrain datée, un identifiant de fiche préfixé par la salle. Aucun de ces trois
   * ne peut apparaître dans un module public sans qu'il y ait eu recopie.
   */
  const identifiers = new Set(literals.filter(value => {
    // Un numéro d'inventaire interne : « 2M 003067 ». Rien d'autre ne s'écrit ainsi.
    if (/\b2M\s?\d{5,6}\b/.test(value)) return true;
    // Une référence de relevé terrain datée : « regiecar-2026-08-16:07 ».
    if (/^[a-z]+-\d{4}-\d{2}-\d{2}:\d{2}$/i.test(value)) return true;
    /*
     * Un identifiant de FICHE — « regie-car-baie-1 », « regie-car-b1-ccu1 ».
     *
     * Deux familles en sont exclues, et ce n'est pas une commodité :
     *   · les marqueurs de PROVENANCE (`…-phase16`, `…-phase17`) disent d'où vient une
     *     ligne, pas ce que contient l'installation. La logique publique les compare pour
     *     reconnaître ses propres écritures : ils doivent rester des deux côtés.
     *   · les CLÉS D'IDENTITÉ (`field-room:…`, `field-batch-…`) portent la continuité des
     *     enregistrements déjà persistés. Les rendre privées casserait l'appariement des
     *     fiches existantes, ce que ce lot s'interdit explicitement.
     */
    if (/^regie-car-[a-z0-9-]+$/i.test(value) && !/-phase\d+$/i.test(value)) return true;
    return false;
  }));
  // Interfaces opérationnelles. Le chiffre est exigé : « SERIAL » ou « Synchronisation
  // interne » sont des mots du métier, « SERIAL 2 » est un point de raccordement réel.
  const interfaces = new Set(literals.filter(value => /^(?:SYNCH|XY-|ENET-|SERIAL|MONITORING\/OUT)[\s./-]*\d/i.test(value)));
  /*
   * LES SOURCES DE PROJET INTERNES.
   *
   * Un fait CONSTRUCTEUR cite une datasheet publique : `sourceUrl` en https. Un fait de
   * PROJET cite un document interne — « Dataset Master v5 », un synoptique, une référence
   * de plan. Dans un actif servi sans authentification, cette seconde citation n'a aucune
   * raison d'être : elle nomme un document que le public ne doit pas savoir exister, et ce
   * qu'elle sert d'appui est, par construction, une affirmation d'installation réelle.
   */
  const projectSources = new Set(
    literals
      .filter(value => INTERNAL_SOURCE_IDENTITY.test(value))
      // Une DÉSIGNATION, pas une phrase : une note privée qui cite le document en passant
      // n'est pas elle-même une identité réutilisable.
      .filter(value => value.length <= 60 && !/[.;]\s/.test(value))
      .map(value => value.trim())
  );
  /*
   * LES NARRATIFS PROTÉGÉS — ce qu'aucune des autres règles ne sait voir (A-5, suite de revue).
   *
   * MESURÉ : `REGIE_CAR_PREPHOTO_GAPS` est resté public et précaché alors que ce lot
   * prétendait l'inverse. Ses entrées ne sont ni un identifiant, ni une implantation, ni une
   * capacité, ni un repère de câble — ce sont des PHRASES : « Ports arrière non relevés »,
   * « Patchfield non documenté », « Les références 01–18 existent ». Elles disent par où
   * CETTE installation est mal documentée, et aucune empreinte existante ne les classait.
   *
   * La catégorie est volontairement petite et EXPLICITE : elle ne devine rien, elle reprend
   * la valeur exacte de quelques champs du jeu protégé (voir `collectProtectedNarratives`).
   * Une phrase courte est écartée — en dessous de vingt caractères, on retombe sur du
   * vocabulaire métier partagé, pas sur un fait d'installation.
   */
  const narratives = new Set(extraNarratives
    .map(valeur => String(valeur).trim())
    .filter(valeur => valeur.length >= 20));

  return { cableRefs, labels, capacityPairs, locations, interfaces, projectSources, identifiers, narratives };
}

const CAPACITY_WORDS = /(?:entr[ée]es?|inputs?|sorties?|outputs?|matrice|matrix|voies?)/i;

/**
 * Un document INTERNE, par opposition à une datasheet constructeur.
 *
 * On reconnaît la FORME de la citation, pas un nom précis : « Dataset Master v5 » renommé
 * en « Dataset Master v6 » reste un document interne, et un champ renommé de `sourceLabel`
 * en `provenance` ne change rien à ce que la valeur dit.
 */
const INTERNAL_SOURCE_IDENTITY = /(?:\bdataset\s+master\s+v?\d|\b[A-Z]{2,}\/[A-Z]{2,}\/\d{1,2}\/\d{4}\b)/i;

/*
 * « synoptique », « plan », « extraction » sont des mots du MÉTIER, pas des identités de
 * document. Les inclure faisait sonner une étiquette de permission (« Consulter les plans et
 * synoptiques techniques »), un message de validation et un titre d'écran — treize faux
 * positifs mesurés. Ce qui trahit un document interne, c'est sa DÉSIGNATION : un nom versionné
 * (`Dataset Master v5`) ou une référence de document (`DT/EH/11/2011`).
 */

/**
 * Une affirmation d'IMPLANTATION : une quantité, un matériel, et un repère de site en
 * capitales — « 4 châssis MAROCMETRIE RF1/RF2 principal et secours ».
 *
 * Les nombres seuls ne suffisent pas : « Châssis Synapse 2RU à 8 slots » est une
 * caractéristique produit, pas une implantation, et ne porte aucun repère de site.
 */
const PLACEMENT_CLAIM = /\b\d+\s+(?:ch[âa]ssis|baies?|racks?|unit[ée]s?|[ée]quipements?|panneaux?)\b[^.]{0,80}?\b[A-Z]{3,}[0-9]*(?:\s*\/\s*[A-Z]{0,3}[0-9]+)?\b/;

/**
 * La capacité protégée écrite EN PROSE, et pas seulement en « 190×184 ».
 *
 * « 190 entrées SDI × 184 sorties SDI » disait exactement la même chose que le couple
 * compact, sans jamais le former : la garde précédente ne la voyait pas. On exige les DEUX
 * nombres protégés et un mot de capacité dans le même littéral — une gamme constructeur
 * (« 16×16 à 288×288 ») ne porte pas ces nombres-là et reste donc acceptée.
 */
export function narrativeCapacityIn(value, fingerprints) {
  if (!CAPACITY_WORDS.test(value)) return '';
  for (const pair of fingerprints.capacityPairs || []) {
    const [left, right] = pair.split('x');
    if (left === right) continue;
    /*
     * LES DEUX NOMBRES DOIVENT SE TENIR, ET LE MOT DE CAPACITÉ ÊTRE ENTRE EUX.
     *
     * Chercher « 190 » et « 184 » n'importe où dans le littéral suffisait à faire sonner un
     * gabarit HTML de 6 ko où les deux se croisaient par hasard dans des attributs. Ce qui
     * décrit une matrice, c'est « 190 entrées … 184 sorties » — une fenêtre courte, avec le
     * mot dedans.
     */
    for (const [a, b] of [[left, right], [right, left]]) {
      const span = new RegExp(`(?<!\\d)${a}(?!\\d)([^\\d]{0,40})(?<!\\d)${b}(?!\\d)`, 's');
      const found = value.match(span);
      if (found && CAPACITY_WORDS.test(found[1])) return pair;
    }
  }
  return '';
}

// « 190x184 » dans `router-gc190x184` est un identifiant machine canonique : il ne révèle
// aucun contenu opérationnel humain et des données déjà persistées en dépendent (#137).
// Le même couple dans « GRILLE CENTRALE 190×184 » est, lui, la capacité en clair.
function isCanonicalCapacityIdentifier(value) {
  return /^[a-z0-9_-]+$/i.test(value);
}

export function protectedCapacityIn(value, fingerprints) {
  for (const pair of fingerprints.capacityPairs || []) {
    const [left, right] = pair.split('x');
    if (new RegExp(`(?<!\\d)${left}\\s*[x×✕✖*]\\s*${right}(?!\\d)`, 'iu').test(value)) return pair;
  }
  return '';
}


// Extrait les chaînes contenues dans une table d'alias publique (`*_ALIASES = {...}`),
// quel que soit le nom des clés.
export function aliasTableValues(code = '') {
  const values = [];
  const re = /[A-Z0-9_]*ALIASES[A-Z0-9_]*\s*=\s*/g;
  for (const match of String(code).matchAll(re)) {
    let depth = 0;
    let started = false;
    let index = match.index + match[0].length;
    for (; index < code.length; index += 1) {
      const char = code[index];
      if (char === '{' || char === '[') { depth += 1; started = true; }
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (started && depth <= 0) break;
      }
    }
    if (started) values.push(...extractStringLiterals(code.slice(match.index, index + 1)));
  }
  return values;
}

/**
 * Les COMMENTAIRES d'un module servi sont des octets publics.
 *
 * Toutes les règles ci-dessous partaient de `stripComments()` : le commentaire disparaissait
 * AVANT le moindre contrôle. Écrire
 *
 *     // BAIE 3 GRILLE CENTRALE — repère GR691
 *
 * passait donc le CI sans rien coûter, alors que le navigateur télécharge cette ligne
 * exactement comme le code qui la suit. Une garde qui ne lit pas ce qu'elle sert ne garde
 * rien : elle nettoie les fichiers d'aujourd'hui sans empêcher la réintroduction de demain,
 * ce que #142 demande explicitement.
 *
 * Le texte des commentaires est donc analysé à son tour, avec les mêmes empreintes.
 */
export function extractComments(source = '') {
  const parts = [];
  for (const match of String(source).matchAll(/\/\*[\s\S]*?\*\//g)) parts.push(match[0]);
  for (const match of String(source).matchAll(/(?:^|\n)[^\n'"`]*?\/\/([^\n]*)/g)) parts.push(match[1]);
  return parts;
}

function commentResidues(file, source, fingerprints) {
  const issues = [];
  const comments = extractComments(source);
  if (!comments.length) return issues;
  const texte = comments.join('\n');

  for (const ref of fingerprints.cableRefs) {
    if (new RegExp(`\\b${ref}\\b`, 'i').test(texte)) {
      issues.push(`${file}: repère opérationnel protégé « ${ref} » écrit dans un commentaire servi.`);
      break;
    }
  }
  for (const comment of comments) {
    const location = [...(fingerprints.locations || [])].find(label => comment.toUpperCase().includes(label.toUpperCase()));
    if (location) {
      issues.push(`${file}: implantation réelle « ${location} » écrite dans un commentaire servi.`);
      break;
    }
  }
  for (const comment of comments) {
    if (protectedCapacityIn(comment, fingerprints) || narrativeCapacityIn(comment, fingerprints)) {
      issues.push(`${file}: capacité d'installation écrite dans un commentaire servi.`);
      break;
    }
  }
  for (const comment of comments) {
    const hits = [...(fingerprints.interfaces || [])].filter(name => comment.toUpperCase().includes(name.toUpperCase()));
    if (hits.length >= 3) {
      issues.push(`${file}: grappe d'interfaces opérationnelles écrite dans un commentaire servi.`);
      break;
    }
  }
  return issues;
}

export function findOperationalResiduesInSource(file, source, fingerprints) {
  const issues = [...commentResidues(file, source, fingerprints)];
  const code = stripComments(source);
  const publicStrings = extractStringLiterals(code);
  const publicStringSet = new Set(publicStrings);

  for (const ref of fingerprints.cableRefs) {
    if (new RegExp(`\\b${ref}\\b`, 'i').test(code)) {
      issues.push(`${file}: repère opérationnel protégé « ${ref} » présent dans un module public.`);
    }
  }

  const protectedLabelHits = [...fingerprints.labels].filter(label => publicStringSet.has(label));
  if (protectedLabelHits.length >= 4) {
    issues.push(`${file}: ${protectedLabelHits.length} libellés opérationnels privés ont été recopiés dans le bundle public.`);
  }

  for (const value of publicStrings) {
    if (protectedCapacityIn(value, fingerprints) && !isCanonicalCapacityIdentifier(value)) {
      issues.push(`${file}: capacité d'installation écrite en clair dans « ${value.slice(0, 90)} ».`);
      break;
    }
  }

  const capacityNumbers = [...new Set([...(fingerprints.capacityPairs || [])].flatMap(pair => pair.split('x')))];
  if (capacityNumbers.length
      && new RegExp(`(?:input|output)Capacity\\s*:\\s*(?:${capacityNumbers.join('|')})\\b`, 'u').test(code)) {
    issues.push(`${file}: capacité d'installation codée en dur dans le source public.`);
  }

  /*
   * LES FORMES NARRATIVES ET OBJET (#142).
   *
   * Les tableaux étaient partis, mais la même donnée restait en phrases dans les fiches
   * catalogue et les packs de connaissance : capacité en toutes lettres, implantation en
   * baie, grappes d'interfaces, plages de ports non documentées. Ces règles portent sur la
   * VALEUR, jamais sur le nom du champ ni sur celui de la constante : recopier la phrase
   * sous `summary`, `note` ou `libelle` ne la fait pas passer.
   */
  for (const value of publicStrings) {
    if (narrativeCapacityIn(value, fingerprints)) {
      issues.push(`${file}: capacité d'installation racontée en clair dans « ${value.slice(0, 90)} ».`);
      break;
    }
  }

  for (const value of publicStrings) {
    const location = [...(fingerprints.locations || [])].find(label => value.toUpperCase().includes(label.toUpperCase()));
    if (location) {
      issues.push(`${file}: implantation réelle « ${location} » exposée dans un module public.`);
      break;
    }
  }

  /*
   * Les identifiants internes se comparent à l'IDENTIQUE, pas par inclusion : ils sont déjà
   * sans ambiguïté, et une comparaison par inclusion ferait sonner un préfixe commun.
   */
  for (const value of publicStrings) {
    if (fingerprints.identifiers?.has(value)) {
      issues.push(`${file}: identifiant d'installation « ${value} » recopié dans un module public.`);
      break;
    }
  }

  /*
   * Un récit protégé se compare par INCLUSION : il peut être repris dans une phrase plus
   * longue, ou concaténé à un préfixe d'affichage, sans cesser d'être le même fait.
   */
  for (const value of publicStrings) {
    const recit = [...(fingerprints.narratives || [])].find(phrase => value.includes(phrase));
    if (recit) {
      issues.push(`${file}: état d'installation « ${recit.slice(0, 60)}… » exposé dans un module public.`);
      break;
    }
  }

  for (const value of publicStrings) {
    const hits = [...(fingerprints.interfaces || [])].filter(name => value.toUpperCase().includes(name.toUpperCase()));
    if (hits.length >= 3) {
      issues.push(`${file}: grappe d'interfaces opérationnelles (${hits.length}) exposée dans « ${value.slice(0, 60)} ».`);
      break;
    }
  }

  // Les plages non documentées ne figurent pas telles quelles dans le dataset privé : la
  // détection est donc structurelle — « IN.64–181 », « OUT.145–182 ».
  for (const value of publicStrings) {
    if (/\b(?:IN|OUT)\.\s?\d{1,3}\s*[–—-]\s*\d{1,3}\b/u.test(value)) {
      issues.push(`${file}: plage de ports documentée exposée dans « ${value.slice(0, 60)} ».`);
      break;
    }
  }

  /*
   * LA PREUVE DE PROJET (#142, troisième tour).
   *
   * `equipment-knowledge-packs.js` affirmait publiquement, sous `projectEvidence` :
   *
   *     'Implantation documentée' · <n châssis, site réel, zones réelles, principal/secours>
   *     sourceLabel: <document interne>
   *
   * Aucune de ces deux moitiés n'est acceptable dans un actif anonyme. La citation d'un
   * document INTERNE trahit son existence ; l'affirmation d'implantation trahit le site.
   *
   * Les deux règles portent sur la VALEUR : renommer `sourceLabel` en `provenance`, ou
   * déplacer la phrase sous `note` ou `summary`, ne change rien.
   */
  const citedInternalSource = publicStrings.find(value =>
    INTERNAL_SOURCE_IDENTITY.test(value) || (fingerprints.projectSources || new Set()).has(value.trim()));
  if (citedInternalSource) {
    issues.push(`${file}: source de projet interne citée dans un actif public — « ${citedInternalSource.slice(0, 70)} ».`);
  }

  const placement = publicStrings.find(value => PLACEMENT_CLAIM.test(value));
  if (placement && (citedInternalSource || /scope\s*:\s*['"]project['"]/.test(code))) {
    issues.push(`${file}: implantation de projet affirmée dans un actif public — « ${placement.slice(0, 70)} ».`);
  }

  // La table d'alias publique : ce qui est interdit, ce sont les VALEURS d'alias qui révèlent
  // l'installation — pas la clé de catalogue, qui est un identifiant machine canonique.
  // Contrôler la clé laissait passer la même donnée sous une clé renommée ; contrôler les
  // valeurs résiste au renommage.
  for (const value of aliasTableValues(code)) {
    if (protectedCapacityIn(value, fingerprints) || /\bGR\d{2,5}\b/i.test(value)) {
      issues.push(`${file}: alias d'installation protégé « ${value.slice(0, 60)} » réintroduit dans la table publique.`);
      break;
    }
  }

  if (file === 'rf-master-import.js') {
    const forbiddenInstallationDefaults = new Set(['STC', 'BAIE 3 GRILLE CENTRALE']);
    for (const value of publicStrings) {
      if (forbiddenInstallationDefaults.has(value)) {
        issues.push(`${file}: valeur d'implantation réelle utilisée comme valeur par défaut publique.`);
      }
      if (/Dataset Master .*\b(?:STC|RF1|RF2)\b/i.test(value)) {
        issues.push(`${file}: référence de dataset d'installation réelle exposée dans le bundle public.`);
      }
    }
  }

  return [...new Set(issues)];
}

/*
 * LE GRAPHE VIENT DE `module-graph.mjs`, ET DE LUI SEUL.
 *
 * Cette garde portait sa propre lecture des imports. Elle exigeait `from`, ou un guillemet
 * collé à `import` — si bien que `import './module.js';` ne produisait aucune arête. Douze
 * modules actifs sortaient donc du périmètre de la garde de sécurité, dont un qui portait
 * un résidu opérationnel réel. Une garde qui choisit elle-même ce qu'elle regarde finit par
 * ne plus rien garantir : l'analyseur est maintenant partagé avec le contrôleur canonique,
 * et un test compare les deux ensembles de fichiers.
 *
 * `<script type="module" src>` restait aussi trop étroit : `index.html` déclare ses modules
 * par `src="…"`, comme les lit le contrôleur canonique.
 */
const moduleEntries = html => htmlEntryModules(html).map(entry => entry.replace(/^\.\//, ''));
const relativeImports = source => relativeSpecifiers(source);

export function buildPublicModuleGraph(root) {
  const indexPath = join(root, 'index.html');
  const entries = moduleEntries(readFileSync(indexPath, 'utf8'));
  const seen = new Set();
  const files = [];

  function visit(file) {
    const clean = normalize(file).replace(/^([.][.][\\/])+/, '');
    if (seen.has(clean)) return;
    const absolute = join(root, clean);
    if (!existsSync(absolute)) return;
    seen.add(clean);
    files.push(clean.replace(/\\/g, '/'));
    const source = readFileSync(absolute, 'utf8');
    for (const specifier of relativeImports(source)) {
      const next = normalize(join(dirname(clean), specifier));
      if (!next.startsWith('..')) visit(next);
    }
  }

  for (const entry of entries) visit(entry);
  return files;
}

/*
 * LES CHAMPS QUI PORTENT UN RÉCIT D'INSTALLATION.
 *
 * Liste courte et assumée : ce sont les champs par lesquels un jeu de données protégé décrit
 * l'état réel du site — l'intitulé d'une lacune, la règle qui l'accompagne, le résumé d'une
 * photo de terrain, la note de relevé. Tout le reste est classé par les règles habituelles.
 */
const CHAMPS_NARRATIFS = Object.freeze(['rule', 'summary', 'sourceNote', 'portsNote']);

export function collectProtectedNarratives(value, out = [], profondeur = 0) {
  if (profondeur > 12 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectProtectedNarratives(item, out, profondeur + 1);
    return out;
  }
  for (const [cle, item] of Object.entries(value)) {
    if (typeof item === 'string' && CHAMPS_NARRATIFS.includes(cle)) out.push(item.trim());
    else collectProtectedNarratives(item, out, profondeur + 1);
  }
  return out;
}

/** Toutes les chaînes que porte un jeu de données construit, quelle que soit sa forme. */
export function collectStringValues(value, out = [], profondeur = 0) {
  if (profondeur > 12 || value === null || value === undefined) return out;
  if (typeof value === 'string') { const v = value.trim(); if (v) out.push(v); return out; }
  if (Array.isArray(value)) { for (const item of value) collectStringValues(item, out, profondeur + 1); return out; }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out, profondeur + 1);
  }
  return out;
}

/** Les valeurs réellement produites par chaque jeu de données protégé. */
export async function evaluatePrivateDatasets(root) {
  const valeurs = [];
  const recits = [];
  for (const chemin of listPrivateDatasets(root)) {
    const module = await import(pathToFileURL(join(root, chemin)).href);
    for (const exporte of Object.values(module)) {
      // Les jeux de données s'exposent par une FONCTION de construction : rien ne se
      // matérialise à l'import, ici pas davantage qu'en production.
      if (typeof exporte === 'function' && /^build/.test(exporte.name)) {
        try {
          const construit = exporte();
          collectStringValues(construit, valeurs);
          collectProtectedNarratives(construit, recits);
        } catch { /* une fabrique qui exige un argument n'est pas un jeu de données */ }
      } else if (exporte && typeof exporte === 'object') {
        collectStringValues(exporte, valeurs);
        collectProtectedNarratives(exporte, recits);
      } else if (typeof exporte === 'string') {
        valeurs.push(exporte);
      }
    }
  }
  return { valeurs, recits };
}

export async function scanPublicBundle(root) {
  const datasets = listPrivateDatasets(root);
  if (!datasets.length) {
    return [`Aucun jeu de données protégé sous ${PRIVATE_DATASET_DIR}/ : la garde n’a rien à comparer.`];
  }
  // Les empreintes de TOUS les jeux protégés, réunies : un résidu de n'importe lequel doit
  // faire sonner, quel que soit le fichier public qui le porte.
  const { valeurs, recits } = await evaluatePrivateDatasets(root);
  const fingerprints = buildProtectedFingerprints(
    datasets.map(chemin => readFileSync(join(root, chemin), 'utf8')).join('\n'),
    valeurs, recits
  );
  const issues = [];
  for (const file of buildPublicModuleGraph(root)) {
    const source = readFileSync(join(root, file), 'utf8');
    issues.push(...findOperationalResiduesInSource(file, source, fingerprints));
  }
  return [...new Set(issues)];
}

async function runCli() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const issues = await scanPublicBundle(root);
  if (issues.length) {
    console.error('\nBUNDLE PUBLIC — résidus opérationnels détectés:\n');
    for (const issue of issues) console.error(`  · ${issue}`);
    console.error('');
    process.exitCode = 1;
    return;
  }
  const graph = buildPublicModuleGraph(root);
  const datasets = listPrivateDatasets(root);
  console.log(`Bundle public résiduel vérifié: ${graph.length} modules, ${datasets.length} jeu(x) de données protégé(s), aucun repère/capacité/alias opérationnel protégé.`);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && invoked === fileURLToPath(import.meta.url)) await runCli();
