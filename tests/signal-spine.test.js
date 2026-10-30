import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const spine = lire('signal-spine.js');
const css = lire('signal-spine.css');
const html = lire('index.html');
const salles = lire('salles.js');

// Les commentaires décrivent les défauts corrigés et en citent le code : on n'analyse
// que les règles réelles.
const code = spine.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => /^\s*(\/\/|\*)/.test(l) ? '' : l).join('\n');

test('le bandeau se pose sur TOUTES les sections, par un seul crochet', () => {
  // `loadSection` est le passage obligé de toutes les sections : l'envelopper une fois
  // suffit, et évite d'avoir à modifier dix-neuf composants.
  assert.match(code, /AdminUI\.prototype\.loadSection = async function loadSectionWithSpine/);
  // Après le rendu, jamais avant : `loadSection` remplace `innerHTML` et emporterait le
  // bandeau avec lui.
  const enveloppe = code.slice(code.indexOf('loadSectionWithSpine'));
  assert.ok(enveloppe.indexOf('await original.call') < enveloppe.indexOf('await monterBandeau'),
    'le bandeau est posé avant le rendu — il serait effacé');
});

test('le bandeau vit DANS le contenu, pour hériter de son alignement', () => {
  // Mesuré : `.admin-content` porte un `margin-left` disputé par cinq feuilles de style.
  // Poser un élément frère aurait imposé de dupliquer ce calcul — une sixième voix dans
  // un conflit déjà ouvert. Vérifié à l'exécution : x=272 pour un contenu à x=236, sur
  // les dix-neuf sections, sans débordement horizontal.
  assert.match(code, /getElementById\('admin-content'\)/);
  assert.match(code, /insertAdjacentHTML\('afterbegin', spineMarkup\(resume, \{ enCours \}\)\)/);
  assert.doesNotMatch(css, /\.signal-spine\{[^}]*margin-left/);
});

test('une garde posée avant un `await` ne garde rien', () => {
  // Défaut mesuré : deux navigations rapprochées franchissaient toutes deux la
  // vérification d'existence pendant la lecture asynchrone des données, et DEUX bandeaux
  // s'empilaient — dix segments au lieu de cinq. La seconde vérification, après l'attente,
  // est ce qui rend la pose réellement idempotente.
  const fonction = code.slice(code.indexOf('async function monterBandeau'), code.indexOf('export function installSignalSpine'));
  const gardes = [...fonction.matchAll(/getElementById\(HOST_ID\)/g)];
  assert.ok(gardes.length >= 2, `une seule garde (${gardes.length}) : le doublon reviendra`);
  const attente = fonction.indexOf('await lireChaine()');
  const derniereGarde = fonction.lastIndexOf('if (document.getElementById(HOST_ID)) return;');
  assert.ok(derniereGarde > attente, 'aucune garde après l’attente');
  assert.ok(derniereGarde < fonction.indexOf('insertAdjacentHTML'), 'la garde arrive après l’insertion');
});

test('l’état est dit en toutes lettres, pas seulement en couleur', () => {
  // Un bandeau d'état qui ne parle qu'en couleur est illisible pour une partie des
  // utilisateurs, et ambigu pour tous les autres sur un écran mal calibré.
  assert.match(code, /const ETAT_TEXTE = Object\.freeze\(/);
  for (const mot of ['verrouillé', 'dégradé', 'hors service', 'à vérifier', 'aucun équipement']) {
    assert.ok(code.includes(`'${mot}'`), `état sans libellé : ${mot}`);
  }
  // Vérifié sur la fonction QUI DESSINE les chiffres d'un segment, pas sur le fichier
  // entier : le bloc « non rattaché » emprunte désormais la même fonction, ce qui rend
  // impossible qu'un des deux perde son libellé sans l'autre.
  const dessinChiffres = code.slice(code.indexOf('function figuresMarkup'), code.indexOf('function segmentMarkup'));
  assert.match(dessinChiffres, /class="spine-segment-state">\$\{esc\(etatTexte\(item\)\)/);
  // Et `etatTexte` retombe TOUJOURS sur un mot, y compris quand rien n'est en panne.
  assert.match(code, /return ETAT_TEXTE\[item\.state\] \|\| item\.state;/);
});

test('le nombre du segment ne se lit jamais comme un nombre de pannes', () => {
  /*
   * LE CONSTAT P0-3, RENDU IMPOSSIBLE À REPRODUIRE.
   *
   * Le bloc affichait le TOTAL du segment immédiatement suivi du libellé d'état : dix-huit
   * équipements dont UN SEUL hors service se lisaient « 18 hors service ». Les deux
   * grandeurs sont désormais séparées — le total porte son unité, l'état porte SON propre
   * nombre — et l'état ne peut plus emprunter le chiffre du voisin.
   */
  const dessinChiffres = code.slice(code.indexOf('function figuresMarkup'), code.indexOf('function segmentMarkup'));
  assert.match(dessinChiffres, /class="spine-segment-count">\$\{item\.equipmentCount\}/);
  assert.match(dessinChiffres, /class="spine-segment-unit">\$\{esc\(unite\(item, item\.equipmentCount\)\)\}/);
  // Le nombre de pannes vient du contrat, jamais d'un total recyclé.
  assert.match(code, /if \(item\.downCount > 0\) return `\$\{item\.downCount\} hors service`;/);
  assert.match(code, /if \(item\.maintenanceCount > 0\) return `\$\{item\.maintenanceCount\} en maintenance`;/);
  // Aucun chemin ne remet le total au contact direct du libellé d'état.
  assert.doesNotMatch(code, /spine-segment-count">\$\{item\.equipmentCount\}<\/span>\s*<span class="spine-segment-state"/);
});

test('aucun nombre n’est annoncé comme définitif avant que la synchronisation ait conclu', () => {
  /*
   * LE CONSTAT P0-4. Le bandeau lit la base locale au moment où il se pose : mesuré au
   * navigateur, il affichait un total à t = 4,5 s alors que la convergence du catalogue
   * était encore en cours (124 fiches en attente, 508 six secondes plus tard). Le chiffre
   * pouvait donc changer APRÈS avoir été présenté comme acquis.
   *
   * Ce lot ne touche ni la synchronisation ni le catalogue : il OBSERVE le signal que
   * `central-sync.js` émet déjà, et s'abstient de conclure avant lui.
   */
  assert.match(code, /let premiereSyncConclue = false;/);
  assert.match(code, /addEventListener\('central-sync-status'/);
  assert.match(code, /premiereSyncConclue = true;/);
  /*
   * UN STATUT N'EST PAS UNE CONCLUSION.
   *
   * La première version sortait de l'attente au PREMIER `central-sync-status` venu. Un
   * Gate indépendant l'a mesuré sur base fraîche : un `offline` émis à t = 998 ms par
   * une écriture locale libérait les compteurs, le bandeau annonçait « 51 non
   * rattachés » à t = 4 630 ms, et le premier instantané central n'arrivait qu'à
   * t = 22 185 ms — la valeur devenait alors 56. Deux, parfois trois valeurs
   * définitives (51 → 5 → 56) pendant la seule initialisation.
   *
   * La conclusion exige désormais la PREUVE que `central-sync.js` appose déjà :
   * `updatedAt`, qui ne figure que sur les statuts postérieurs à `applySnapshot()`.
   * Le garde-fou est ici textuel ; la preuve de COMPORTEMENT — sept statuts joués
   * dans un vrai navigateur sur le module réellement servi — vit dans
   * `scripts/ui-polish-sync-timeline.mjs`, avec la chronologie complète.
   */
  assert.match(code, /const prouveUnInstantaneApplique = detail => Boolean\(detail && detail\.updatedAt\);/);
  assert.match(code, /if \(!prouveUnInstantaneApplique\(event\?\.detail\)\) return;/);
  // La conclusion ne peut PAS être posée avant cette garde : l'ordre est ce qui compte.
  const ecouteur = code.slice(code.indexOf("addEventListener('central-sync-status'"));
  const garde = ecouteur.indexOf('if (!prouveUnInstantaneApplique');
  const conclusion = ecouteur.indexOf('premiereSyncConclue = true;');
  assert.ok(garde >= 0 && garde < conclusion,
    'la conclusion est posée avant la garde : un statut sans preuve libérerait les compteurs');
  // Et le mot « synced » ne décide de rien : un `warning`/`offline` postérieur à
  // l'instantané en porte aussi la preuve, et doit conclure lui aussi.
  assert.doesNotMatch(ecouteur.slice(0, conclusion), /state === 'synced'/);
  assert.match(code, /if \(enCours\) return '<span class="spine-segment-sync">Synchronisation…<\/span>';/);
  // Le témoin est posé au CHARGEMENT du module : la synchronisation initiale se termine
  // avant le premier rendu de section, un écouteur posé au montage n'entendrait rien.
  assert.ok(code.indexOf("addEventListener('central-sync-status'") < code.indexOf('async function monterBandeau'),
    'l’écouteur est posé après le montage : il manquerait l’événement');
  // Et le bandeau déjà posé se corrige SUR PLACE, sans attendre une navigation.
  assert.match(code, /async function rafraichirBandeau\(\)/);
  assert.match(code, /if \(signature === signatureAffichee\) return;/);
});

test('le hors-chaîne compte comme les autres', () => {
  // Il affichait son nombre de SALLES là où les autres affichent des équipements, ce qui
  // donnait « 0 salle(s) » sur un bloc pourtant présent — le cas d'équipements rattachés à
  // aucune salle, qui est un problème réel mais différent.
  const bloc = code.slice(code.indexOf('const reste = resume.unassigned'), code.indexOf('return `\n    <nav'));
  // Il emprunte la MÊME fonction de dessin que les quatre segments : c'est ce qui garantit
  // qu'il compte la même chose qu'eux, aujourd'hui et après toute évolution.
  assert.match(bloc, /figuresMarkup\(resume\.unassigned, enCours\)/);
  assert.doesNotMatch(bloc, /spine-segment-count">\$\{resume\.unassigned\.roomCount\}/);
  const dessinChiffres = code.slice(code.indexOf('function figuresMarkup'), code.indexOf('function segmentMarkup'));
  assert.match(dessinChiffres, /item\.equipmentCount/);
});

test('la sortie est échappée', () => {
  // Un nom de salle est une donnée saisie : il ne doit jamais être interprété comme du
  // balisage sur un bandeau présent sur toutes les pages.
  assert.match(code, /const esc = value => String\(value \?\? ''\)\.replace/);
  assert.doesNotMatch(code, /\$\{item\.label\}/);
  assert.doesNotMatch(code, /\$\{item\.description\}/);
});

test('la feuille du bandeau ne prend pas la place de l’arbitre', () => {
  // `design-system.css` doit rester la dernière chargée, sinon il cesse d'arbitrer —
  // sauf `pilot-technique-preview.css`, dérogation nommée en détail dans
  // `design-system.test.js` : survol opt-in qui doit sciemment le suivre.
  const feuilles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m => m[1]);
  assert.ok(feuilles.includes('signal-spine.css'), 'feuille du bandeau non chargée');
  const derniere = feuilles.at(-1);
  assert.equal(derniere === 'pilot-technique-preview.css' ? feuilles.at(-2) : derniere, 'design-system.css');
  assert.ok(feuilles.indexOf('signal-spine.css') < feuilles.indexOf('design-system.css'));
  // Et le module doit être servi hors ligne comme les autres.
  const sw = lire('service-worker.js');
  assert.match(sw, /'\/signal-spine\.js'/);
  assert.match(sw, /'\/signal-chain-contract\.js'/);
  assert.match(sw, /'\/signal-spine\.css'/);
});

test('le rattachement d’une salle se saisit et se conserve', () => {
  // Sans cet écran, le fil ne peut pas vivre : tout resterait « non rattaché ».
  // Vérifié à l'exécution : cinq options, sélection « diffusion » enregistrée en base,
  // et le bandeau bascule sur `diffusion=unverified:51`.
  assert.match(salles, /import \{ chainSegmentOptions, roomChainSegment \} from '\.\/signal-chain-contract\.js'/);
  assert.match(salles, /<select name="chainSegment">/);
  assert.match(salles, /<option value="">Non rattachée<\/option>/);
  assert.match(salles, /chainSegment: form\.chainSegment\.value \|\| ''/);
  // L'explication doit rester à côté du champ : le rattachement n'est pas deviné, et
  // l'utilisateur doit savoir pourquoi on le lui demande.
  assert.match(salles, /Une salle non rattachée y apparaît explicitement/);
});
