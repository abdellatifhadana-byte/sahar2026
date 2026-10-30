import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOGO_PIECES, MIN_SPLASH_DURATION_MS, STAGE_ORDER, startupLogoMarkup } from '../startup-splash.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const splash = read('startup-splash.js');
const css = read('startup-splash.css');
const core = read('core.js');
const centralSync = read('central-sync.js');
const progres = read('startup-progress.js');
const auth = read('auth.js');

// L'écran de démarrage reprend le langage « acheminement de signal » : les huit pièces
// RÉELLES du logo 2M s'allument au rythme des étapes que `core.js` traverse vraiment.

test('les huit pièces sont les polygones officiels du logo, pas une forme générée', () => {
  assert.equal(LOGO_PIECES.length, 8);
  const couleurs = LOGO_PIECES.map(piece => piece.fill);
  assert.equal(new Set(couleurs).size, 8, 'les huit couleurs de la marque doivent être distinctes');
  for (const piece of LOGO_PIECES) {
    assert.match(piece.fill, /^#[0-9A-F]{6}$/i);
    // Cinq sommets par pièce : ce sont les tracés officiels, ils ne se « simplifient » pas.
    assert.equal(piece.points.trim().split(/\s+/).length, 5);
  }
  const markup = startupLogoMarkup();
  assert.match(markup, /viewBox="0 0 519 505"/);
  assert.equal((markup.match(/<polygon/g) || []).length, 8);
  assert.doesNotMatch(markup, /<img/, 'le symbole reste vectoriel, sans dépendre d’un fichier image');
});

test('la variante compacte affiche le symbole entier, sans animation d’assemblage', () => {
  const compact = startupLogoMarkup({ compact:true, revealed:true });
  assert.match(compact, /startup-logo-compact/);
  assert.equal((compact.match(/is-visible/g) || []).length, 8);
  // L'écran de chargement technicien réutilise ce symbole : il ne doit pas rester noir.
  assert.match(css, /\.startup-logo-compact \.startup-logo-segment\{opacity:1/);
});

test('toute étape déclarée est réellement franchie par le code', () => {
  // Aucune étape décorative : annoncer un travail qui n'a pas lieu serait un progrès mis
  // en scène. L'ancienne étape « sync », annoncée à 72 % APRÈS que la synchronisation
  // avait eu lieu dans checkSession(), n'a jamais été affichée une seule image.
  //
  // La vérification porte sur les DEUX fichiers qui rendent compte : core.js orchestre le
  // démarrage, central-sync.js est le seul à connaître le coût du transfert.
  const rapporteurs = core + centralSync;
  for (const stage of STAGE_ORDER) {
    assert.match(rapporteurs, new RegExp(`startupProgress\\.complete\\('${stage}'\\)`),
      `étape déclarée que personne ne termine : ${stage}`);
  }
  assert.match(core, /finishStartupSplash\(\)/);
});

test('aucune étape ne fait avancer la barre en s’annonçant', () => {
  // Le défaut corrigé, dans sa forme la plus courte : `updateStartupSplash('database', 15)`
  // SUIVI de `await db.open()`. Le nombre précédait le travail, donc ne le mesurait pas.
  assert.doesNotMatch(core, /updateStartupSplash/);
  // `enter` dit ce qui commence sans rien créditer ; seul `complete` avance.
  const modele = fs.readFileSync(new URL('../startup-progress.js', import.meta.url), 'utf8');
  const enter = modele.slice(modele.indexOf('enter(id)'), modele.indexOf('report(id, fraction)'));
  assert.doesNotMatch(enter, /poser\(/, 'entrer dans une étape ne doit rien créditer');
  const complete = modele.slice(modele.indexOf('complete(id)'), modele.indexOf('awaitHuman()'));
  assert.match(complete, /poser\(bande\.fin\)/);
});

test('l’attente d’une personne n’est pas un chargement', () => {
  // La barre affichait 52 % pendant que la plateforme attendait qu'un humain tape ses
  // identifiants. Rien ne chargeait : c'était le mensonge le plus visible de l'écran.
  assert.match(core, /startupProgress\.awaitHuman\(\)/);
  assert.match(core, /startupProgress\.resumeAfterHuman\(\)/);
  // L'état est lisible dans le DOM, donc stylable.
  assert.match(splash, /dataset\.phase = etat\.phase/);
  // Mais l'écran de démarrage n'affiche PAS d'habillage d'attente : `showLogin()` remplace
  // `#app`, donc il n'existe plus à ce moment-là. Un état inaffichable est une décoration.
  assert.doesNotMatch(splash, /En attente de connexion/);
  assert.doesNotMatch(css, /data-phase="awaiting-human"/);
});

test('l’écran de connexion rend compte du travail réel, pas d’un chronomètre', () => {
  // Le même défaut vivait ici : `setTimeout(() => progress.textContent = 'Synchronisation
  // de vos données…', 900)`. Le message arrivait au bout de 900 ms que la synchronisation
  // ait commencé ou non, puis ne bougeait plus — alors que c'est ICI, dans `login()`, que
  // s'exécute le transfert de 285,5 kio qui pèse les deux tiers du démarrage.
  assert.doesNotMatch(auth, /setTimeout\([^)]*Synchronisation de vos données/);
  assert.match(auth, /startupProgress\.subscribe\(/);
  assert.match(auth, /progress\.textContent = `\$\{etat\.status\} \$\{etat\.value\}%`/);
  // L'abonnement est retiré dans les DEUX issues : succès et échec. Un abonné laissé en
  // place écrirait dans un élément détaché à chaque synchronisation ultérieure.
  assert.equal((auth.match(/desabonner\(\);/g) || []).length, 2,
    'le désabonnement manque sur l’une des deux issues de la connexion');
  // Et pendant l'attente pure, il n'écrase pas « Vérification des identifiants… ».
  assert.match(auth, /etat\.phase === STARTUP_PHASES\.AWAITING_HUMAN.*return/);
});

test('la règle des étapes montre le poids réel de chaque palier', () => {
  // Une barre unique ne dit pas OÙ l'on est. Chaque segment occupe la largeur de son poids
  // mesuré : « Réception des données » couvre les deux tiers, parce qu'il coûte les deux
  // tiers du temps. Un arrêt long se lit alors sur le segment qui le cause.
  assert.match(splash, /class="startup-steps"/);
  assert.match(splash, /style="flex:\$\{step\.weight\}"/);
  assert.match(css, /\.startup-step\[data-state="done"\]/);
  assert.match(css, /\.startup-step\[data-state="active"\]/);
  // Un segment par étape déclarée, ni plus ni moins.
  assert.match(splash, /STARTUP_STEPS\.map\(step =>/);
  // Le mouvement s'arrête quand le mouvement dérange.
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('une fois chargé, l’écran ne fait plus semblant de charger', () => {
  // La barre atteint 100 % avant la fin de l'assemblage du symbole — une durée VOULUE,
  // pas un chargement. Mesuré : 1 469 ms. Elle se pose au lieu de paraître bloquée.
  assert.match(css, /\.startup-splash\[data-phase="done"\] \.startup-progress-pulse\{animation:none/);
});

test('le téléchargement compte ses octets au lieu de rester immobile', () => {
  // Mesuré : l'instantané pèse 285,5 kio — 25 ms en localhost, mais 864 ms à 400 kio/s et
  // 3 155 ms sur une liaison mobile. Deux tiers du démarrage, réduits à un nombre figé.
  assert.match(centralSync, /onProgress/);
  // Le comptage vit dans startup-progress.js — central-sync.js ne peut pas être importé
  // hors navigateur, et une logique non testable est une logique non vérifiée.
  assert.match(centralSync, /readCountingBytes\(/);
  assert.match(progres, /const lecteur = response\.body\.getReader\(\)/);
  assert.match(centralSync, /startupProgress\.report\('download'/);
  // Sans dénominateur connu, on n'invente pas de fraction : ce serait le défaut d'origine.
  assert.match(centralSync, /if \(total > 0\) startupProgress\.report\('download'/);
  // L'écriture locale rend compte magasin par magasin.
  assert.match(centralSync, /startupProgress\.report\('apply', ecrits \/ parMagasin\.size\)/);
});

test('le symbole s’assemble en entier, quelle que soit la vitesse du réseau', () => {
  // Les pièces suivaient le prorata du progrès. Sur réseau lent, le démarrage stationne
  // longtemps à 52 % : l'utilisateur restait devant QUATRE pièces sur huit qui tournaient
  // — un logo mutilé tenu pour l'identité de la plateforme. Et si la synchronisation
  // n'aboutissait pas, le symbole ne se complétait jamais.
  assert.match(splash, /const LOGO_ASSEMBLY_MS = \d+;/);
  assert.match(splash, /function startLogoAssembly/);
  assert.match(splash, /assemblyTimers\.push\(setTimeout\(\(\) => revealPiece\(piece\)/);
  // Le progrès réel peut prendre de l'avance sur le calendrier, jamais du retard.
  assert.match(splash, /pieces\.forEach\(\(piece, index\) => \{ if \(index < target\) revealPiece\(piece\); \}\)/);
  // Filet final : personne n'entre sur un logo incomplet.
  assert.match(splash, /for \(const piece of splash\.querySelectorAll\('\.startup-logo-segment'\)\) revealPiece\(piece\);/);
  // Une pièce allumée ne s'éteint jamais.
  assert.doesNotMatch(splash, /classList\.remove\('is-visible'\)/);
});

test('la sortie attend le plus tardif des deux planchers', () => {
  // Le plancher de lisibilité décidé par le client ET le temps d'assemblage du symbole :
  // un démarrage très rapide ne doit pas escamoter la marque.
  assert.match(splash, /const lisibilite = Math\.max\(0, MIN_SPLASH_DURATION_MS - elapsed - AWAKEN_MS\)/);
  assert.match(splash, /const assemblage = Math\.max\(0, LOGO_ASSEMBLY_MS \+ \d+ - elapsed\)/);
  assert.match(splash, /const remaining = Math\.max\(lisibilite, assemblage\)/);
});

test('la barre de progression reste la mesure réelle, le symbole n’en est pas une', () => {
  // Le symbole est l'identité, la barre est la mesure : les confondre était l'erreur.
  // Les étapes et pourcentages continuent de venir de core.js, sans mise en scène.
  assert.match(splash, /splash\.querySelector\('\[data-startup-percent\]'\)\.textContent = `\$\{value\}%`/);
  assert.match(splash, /setAttribute\('aria-valuenow', String\(value\)\)/);
  assert.doesNotMatch(splash, /Math\.random/, 'aucun progrès inventé');
});

test('la boucle d’animation s’arrête au lieu de tourner toute la session', () => {
  assert.match(splash, /function stopSplashAnimation/);
  assert.match(splash, /cancelAnimationFrame\(animationHandle\)/);
  // Elle se coupe aussi d'elle-même si le splash quitte le document — l'écran de
  // connexion réécrit `#app` et l'emporte avec lui.
  assert.match(splash, /if \(!splash\.isConnected\) \{ stopSplashAnimation\(\); return; \}/);
  assert.match(splash, /removeEventListener\('resize', resizeListener\)/);
  // Et à la sortie normale.
  assert.match(splash, /await new Promise\(resolve => setTimeout\(resolve, 420\)\);\s*stopSplashAnimation\(\);/);
});

test('aucune variable de style n’est posée globalement', () => {
  // Sur `:root`, elles écraseraient les couleurs de thème de la plateforme et
  // survivraient à la disparition du splash.
  assert.doesNotMatch(css, /^:root\{/m);
  assert.doesNotMatch(css, /\n:root\s*\{/);
  assert.match(css, /\.startup-splash\{\s*--sp-bg-0/);
  // Le préfixe `--sp-` évite toute collision de nom même en cas d'héritage.
  const variables = [...css.matchAll(/(--[a-z0-9-]+):/g)].map(match => match[1]);
  for (const name of variables) assert.ok(name.startsWith('--sp-'), `variable non préfixée: ${name}`);
});

test('le splash est reconstruit après la connexion', () => {
  // `showLogin()` réécrit `#app` et détruit le splash : sans reconstruction, la
  // synchronisation initiale — l'étape la plus longue — se déroulait devant un écran vide.
  assert.match(core, /this\.currentUser = await this\.auth\.showLogin\(\);\s*startupProgress\.resumeAfterHuman\(\);\s*renderStartupSplash\(\);/);
  // Et il reprend à sa VALEUR : le modèle est monotone et se relivre à l'abonnement, au
  // lieu de repartir de 4 % pour re-sauter à 60 % — une régression visible de la barre.
  assert.match(splash, /if \(!splashStartedAt\) splashStartedAt = Date\.now\(\)/);
  assert.match(splash, /const depart = Math\.max\(0, Math\.min\(100, Math\.round\(etat\.value\)\)\)/);
  assert.doesNotMatch(splash, /aria-valuenow="4"/);
});

test('une initialisation en échec le dit, au lieu de rester figée', () => {
  assert.match(splash, /export function failStartupSplash/);
  assert.match(splash, /startup-error/);
  assert.match(core, /failStartupSplash\(error\)/);
  assert.match(css, /\.startup-splash\.startup-error/);
});

test('le plancher de durée reste celui décidé par le client', () => {
  assert.equal(MIN_SPLASH_DURATION_MS, 2200);
  // L'éveil lumineux est DÉCOMPTÉ de ce plancher, il ne s'y ajoute pas : la lueur
  // demandée par le client ne rallonge donc pas le démarrage.
  assert.match(splash, /Math\.max\(0, MIN_SPLASH_DURATION_MS - elapsed - AWAKEN_MS\)/);
  const eveil = Number(splash.match(/const AWAKEN_MS = (\d+)/)?.[1] || 0);
  assert.ok(eveil > 0 && eveil < MIN_SPLASH_DURATION_MS / 2,
    `durée d'éveil hors de proportion : ${eveil} ms`);
});

/* =========================================================================
   VEILLE ET ÉVEIL
   Demande du client : « les pièces apparaissent et disparaissent joliment ;
   à l'approche de la fin, le logo entier apparaît et s'illumine, comme si la
   plateforme se réveillait ; ensuite la première page s'affiche. »
   ========================================================================= */

test('l’onde de veille ne commence qu’une fois le symbole entier', () => {
  // Faire courir la lumière sur un symbole incomplet donnerait exactement l'impression
  // de logo mutilé corrigée précédemment.
  assert.match(splash, /setTimeout\(\(\) => splash\.classList\.add\('is-breathing'\), LOGO_ASSEMBLY_MS \+ \d+\)/);
});

test('la veille fait voyager la lumière sans jamais retirer de pièce', () => {
  // Mesuré dans le navigateur pendant la veille : les huit pièces restent présentes et
  // les opacités relevées se déplacent — [53,87,100,…] puis [28,30,57,90,…] puis
  // [83,48,27,32,61,92,…]. Au plus trois pièces sont atténuées à la fois, jamais toutes.
  assert.match(css, /\.startup-splash\.is-breathing \.startup-logo-segment\.is-visible\{/);
  assert.match(css, /animation-delay:calc\(var\(--piece-index,0\) \* \d+ms\)/);
  const trame = css.match(/@keyframes startup-wave\{[^}]*\}[^}]*\}/)?.[0] || '';
  assert.ok(trame, 'la trame de l’onde est absente');
  // Aucune étape ne doit descendre à l'opacité nulle : une pièce éteinte, c'est un trou
  // dans la marque.
  for (const opacite of trame.matchAll(/opacity:([\d.]+)/g)) {
    assert.ok(Number(opacite[1]) > 0.15, `une pièce descend à l’opacité ${opacite[1]} — la silhouette se troue`);
  }
});

test('l’éveil arrête l’onde et illumine le symbole entier avant l’entrée', () => {
  // L'ordre compte : symbole complet et immobile, PUIS lueur, PUIS la page.
  const sortie = splash.slice(splash.indexOf('export async function finishStartupSplash'));
  const ordre = ['revealPiece(piece)', "classList.remove('is-breathing')", "classList.add('is-awake')", "classList.add('startup-ready')"];
  let position = -1;
  for (const etape of ordre) {
    const trouve = sortie.indexOf(etape);
    assert.ok(trouve > position, `« ${etape} » n’arrive pas dans l’ordre attendu`);
    position = trouve;
  }
  // Le sélecteur d'éveil doit être au moins aussi spécifique que celui de la veille,
  // sinon l'onde continuerait de tourner sous la lueur.
  assert.match(css, /\.startup-splash\.is-awake \.startup-logo-segment\.is-visible\{\s*animation:none/);
  assert.match(css, /@keyframes startup-awaken\{/);
  // Uniquement les règles d'éveil : le bloc `prefers-reduced-motion` qui suit emploie
  // légitimement `!important` pour neutraliser toutes les animations.
  const blocEveil = css.slice(css.indexOf('.startup-splash.is-awake'), css.indexOf('@media(min-width:768px)'));
  assert.ok(blocEveil.length > 100, 'bloc d’éveil introuvable');
  assert.doesNotMatch(blocEveil, /!important/);
});

test('le mouvement réduit n’impose ni onde ni lueur', () => {
  assert.match(splash, /if \(!prefersReducedMotion\(\)\) \{[\s\S]{0,140}classList\.add\('is-awake'\)/);
});
