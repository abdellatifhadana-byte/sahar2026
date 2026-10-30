// Choix produit délibéré, verrouillé par tests/splash-phase20.test.js : le splash reste
// visible assez longtemps pour être lu. Ce plancher, plus les 420 ms de sortie, impose
// environ 2,6 s à chaque ouverture même quand tout est déjà prêt — c'est un arbitrage
// image de marque contre rapidité, tranché par le client, pas un défaut technique.
import { startupProgress, STARTUP_STEPS, STARTUP_PHASES } from './startup-progress.js';

const MIN_SPLASH_DURATION_MS = 2200;

// Les huit pièces réelles du symbole 2M, dans l'ordre de leur assemblage. Ce sont les
// polygones officiels du logo, pas une étoile générée : les coordonnées ne doivent pas
// être « simplifiées », sous peine de ne plus dessiner la marque.
const LOGO_PIECES = Object.freeze([
  { fill:'#F9C005', points:'124.04,54.10 124.04,193.01 175.76,242.64 194.96,223.59 194.91,118.55' },
  { fill:'#F89A21', points:'314.97,14.71 205.19,118.09 205.18,187.98 231.51,187.77 314.70,108.22' },
  { fill:'#EC5A48', points:'270.34,166.88 287.00,182.94 406.25,182.94 476.16,116.04 323.17,116.04' },
  { fill:'#D23E8C', points:'330.17,194.07 330.22,220.40 412.53,297.87 513.52,297.98 406.78,194.08' },
  { fill:'#665FAF', points:'353.35,256.70 333.08,277.33 333.04,385.67 404.86,454.93 405.00,306.61' },
  { fill:'#0189D7', points:'322.93,313.05 297.61,312.14 213.06,395.06 213.06,491.64 322.92,385.91' },
  { fill:'#019DC2', points:'53.46,386.96 206.02,386.96 259.29,335.54 240.48,317.05 123.55,317.08' },
  { fill:'#5BA532', points:'11.98,200.11 120.86,305.92 198.69,305.93 198.08,279.40 115.44,200.24' }
]);

// Les libellés vivent désormais dans le modèle de progression, aux côtés des poids issus
// des mesures : un libellé et le palier qu'il nomme ne peuvent plus diverger. C'est ce qui
// avait produit une étape « Synchronisation » annoncée APRÈS que la synchronisation avait
// eu lieu — mesuré : jamais affichée une seule image.
const ETAT_FINAL = Object.freeze({
  status: 'Plateforme prête',
  detail: 'Tous les composants nécessaires sont initialisés.',
  label: 'Prêt'
});

// Il n'y a PAS d'habillage « attente de connexion » ici, et c'est délibéré : `showLogin()`
// remplace `#app` (auth.js:159), donc l'écran de démarrage n'existe plus pendant l'attente.
// Un état qui ne peut jamais s'afficher est une décoration. C'est l'écran de connexion,
// lui, qui rend compte de cette phase — via `#login-progress`, désormais alimenté par le
// même modèle au lieu d'un chronomètre de 900 ms.

const STAGE_ORDER = Object.freeze(STARTUP_STEPS.map(step => step.id));

let splashStartedAt = 0;
let animationHandle = 0;
let resizeListener = null;
const assemblyTimers = [];
let rotationAngle = 0;
let lastFrameAt = 0;
let settling = false;

const prefersReducedMotion = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startupLogoMarkup({ compact = false, revealed = false } = {}) {
  const pieces = LOGO_PIECES.map((piece, index) => `<polygon class="startup-logo-segment piece-${index + 1}${revealed ? ' is-visible' : ''}" style="--piece-index:${index}" fill="${piece.fill}" points="${piece.points}"></polygon>`).join('');
  return `<svg class="startup-logo-svg startup-logo-assembly${compact ? ' startup-logo-compact' : ''}" viewBox="0 0 519 505" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Symbole 2M TECH">
    <g shape-rendering="geometricPrecision">${pieces}</g>
  </svg>`;
}

/* =========================================================================
   Fond « signal » : nœuds et liaisons orthogonales, comme un acheminement de
   signal plutôt qu'une constellation décorative.
   ========================================================================= */

const NETWORK_NODES = Object.freeze([
  [0.07, 0.18], [0.22, 0.12], [0.10, 0.48], [0.17, 0.78], [0.34, 0.89],
  [0.66, 0.11], [0.84, 0.20], [0.92, 0.47], [0.84, 0.78], [0.66, 0.90],
  [0.29, 0.31], [0.70, 0.31], [0.28, 0.67], [0.71, 0.68]
]);

const NETWORK_EDGES = Object.freeze([
  [0,1],[0,2],[1,10],[2,10],[2,3],[3,4],[3,12],[4,12],
  [5,6],[5,11],[6,7],[7,11],[7,8],[8,9],[8,13],[9,13],
  [10,12],[11,13],[10,11],[12,13]
]);

function drawSignalNetwork(context, width, height, now, animated) {
  context.clearRect(0, 0, width, height);
  const at = index => ({ x:NETWORK_NODES[index][0] * width, y:NETWORK_NODES[index][1] * height });

  const spacing = width < 600 ? 46 : 58;
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(83, 157, 196, .025)';
  for (let x = 0; x <= width; x += spacing) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  for (let y = 0; y <= height; y += spacing) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }

  context.strokeStyle = 'rgba(69, 157, 205, .105)';
  for (const [from, to] of NETWORK_EDGES) {
    const a = at(from); const b = at(to); const midX = (a.x + b.x) / 2;
    context.beginPath();
    context.moveTo(a.x, a.y); context.lineTo(midX, a.y); context.lineTo(midX, b.y); context.lineTo(b.x, b.y);
    context.stroke();
  }

  for (let index = 0; index < NETWORK_NODES.length; index += 1) {
    const point = at(index);
    context.beginPath(); context.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
    context.fillStyle = 'rgba(96, 190, 233, .32)'; context.fill();
    context.beginPath(); context.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(96, 190, 233, .07)'; context.stroke();
  }

  if (!animated) return;
  for (const [edgeIndex, offset] of [[1, 0], [6, 1000], [10, 1800], [14, 2600]]) {
    const [from, to] = NETWORK_EDGES[edgeIndex];
    const a = at(from); const b = at(to);
    const t = ((now + offset) % 3400) / 3400;
    const alpha = Math.sin(Math.PI * t);
    context.beginPath();
    context.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 2.2, 0, Math.PI * 2);
    context.fillStyle = `rgba(79, 195, 247, ${0.42 * alpha})`;
    context.fill();
  }
}

// Une boucle d'animation qui ne s'arrête jamais continue de redessiner le canevas bien
// après la disparition du splash — sur mobile, c'est la batterie qui paie pendant toute
// la session. Elle est donc explicitement annulée à la sortie, et se coupe d'elle-même
// dès que le splash n'est plus dans le document.
function stopSplashAnimation() {
  clearLogoAssembly();
  if (animationHandle) { cancelAnimationFrame(animationHandle); animationHandle = 0; }
  if (resizeListener && typeof window !== 'undefined') {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }
}

function startSplashAnimation(splash) {
  stopSplashAnimation();
  const canvas = splash.querySelector('[data-startup-canvas]');
  const turntable = splash.querySelector('[data-startup-turntable]');
  if (!canvas?.getContext) return;
  const context = canvas.getContext('2d', { alpha:true });
  if (!context) return;

  const animated = !prefersReducedMotion();
  let width = 0; let height = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  resizeListener = resize;
  window.addEventListener('resize', resizeListener, { passive:true });

  rotationAngle = 0;
  lastFrameAt = performance.now();
  settling = false;

  const frame = now => {
    // Le splash a pu être retiré du document — notamment par l'écran de connexion, qui
    // réécrit `#app`. Sans cette sortie, la boucle survivrait à sa propre interface.
    if (!splash.isConnected) { stopSplashAnimation(); return; }
    if (animated && !settling && turntable) {
      const delta = Math.min(now - lastFrameAt, 40) / 1000;
      rotationAngle = (rotationAngle + delta * 23) % 360;
      turntable.style.transform = `rotate(${rotationAngle}deg)`;
    }
    lastFrameAt = now;
    if (width && height) drawSignalNetwork(context, width, height, now, animated);
    animationHandle = requestAnimationFrame(frame);
  };
  animationHandle = requestAnimationFrame(frame);
}

// Ramène le symbole à son orientation d'origine en continuant vers l'avant, jamais en
// revenant en arrière : un rebond inverse juste avant l'arrêt se lit comme une erreur.
function settleLogo(splash) {
  const turntable = splash.querySelector('[data-startup-turntable]');
  if (!turntable) return Promise.resolve();
  settling = true;
  if (prefersReducedMotion()) {
    rotationAngle = 0;
    turntable.style.transform = 'rotate(0deg)';
    return Promise.resolve();
  }
  const normalized = (rotationAngle % 360 + 360) % 360;
  const remaining = normalized < 0.5 ? 0 : 360 - normalized;
  const startAngle = rotationAngle;
  const duration = Math.max(380, Math.min(940, 360 + remaining * 2.1));
  const startedAt = performance.now();
  return new Promise(resolve => {
    const step = now => {
      const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - t, 5);
      turntable.style.transform = `rotate(${startAngle + remaining * eased}deg)`;
      if (t < 1) { requestAnimationFrame(step); return; }
      rotationAngle = 0;
      turntable.style.transform = 'rotate(0deg)';
      resolve();
    };
    requestAnimationFrame(step);
  });
}

const echapper = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

/**
 * La règle du démarrage, rendue visible.
 *
 * Une barre unique ne dit pas OÙ l'on est : elle avance, et c'est tout. Ici chaque étape
 * réelle occupe la largeur de son poids mesuré, si bien que la structure du démarrage se
 * lit d'un coup d'œil — et qu'un arrêt long se voit sur le segment qui le cause, au lieu
 * de rester un nombre immobile sans explication.
 *
 * C'est aussi ce qui rend l'écran honnête à la lecture : le segment « Réception des
 * données » occupe visiblement les deux tiers de la règle, parce qu'il occupe les deux
 * tiers du temps.
 */
function stepsMarkup() {
  const segments = STARTUP_STEPS.map(step =>
    `<span class="startup-step" data-step="${echapper(step.id)}" data-state="pending"
           style="flex:${step.weight}" title="${echapper(step.label)}"></span>`).join('');
  return `<div class="startup-steps" data-startup-steps aria-hidden="true">${segments}</div>`;
}

export function renderStartupSplash() {
  const host = document.getElementById('app');
  if (!host) return null;
  // Le compte à rebours de lisibilité ne se remet à zéro qu'au PREMIER affichage. Après une
  // connexion, l'écran est reconstruit : le relancer imposerait 2,2 s de plus à quelqu'un
  // qui vient déjà d'attendre devant un formulaire.
  if (!splashStartedAt) splashStartedAt = Date.now();
  // La barre part de l'état réel du modèle, jamais d'un nombre écrit dans le gabarit.
  const etat = startupProgress.state();
  const depart = Math.max(0, Math.min(100, Math.round(etat.value)));
  host.style.display = 'block';
  host.innerHTML = `<section id="startup-splash" class="startup-splash" role="status" aria-live="polite" aria-busy="true" aria-label="Chargement de 2M TECH PLATFORM">
    <canvas class="startup-canvas" data-startup-canvas aria-hidden="true"></canvas>
    <div class="startup-matrix" aria-hidden="true"></div>
    <header class="startup-header">
      <div class="startup-system-id"><span class="startup-system-dot"></span><span>2M TECH INFRASTRUCTURE</span></div>
      <div class="startup-system-channel">BROADCAST SYSTEM</div>
    </header>
    <div class="startup-card">
      <div class="startup-logo-wrap">
        <span class="startup-route startup-route-in" aria-hidden="true"><span class="startup-port-label">IN</span></span>
        <div class="startup-turntable" data-startup-turntable>${startupLogoMarkup()}</div>
        <span class="startup-route startup-route-out" aria-hidden="true"><span class="startup-port-label">OUT</span></span>
        <span class="startup-lock tl" aria-hidden="true"></span><span class="startup-lock tr" aria-hidden="true"></span>
        <span class="startup-lock bl" aria-hidden="true"></span><span class="startup-lock br" aria-hidden="true"></span>
      </div>
      <div class="startup-copy">
        <h1>2M TECH PLATFORM</h1>
        <p class="startup-baseline">Broadcast Infrastructure · Digital Twin</p>
        <p class="startup-status" data-startup-status>${etat.status || 'Préparation de la plateforme…'}</p>
        <p class="startup-detail" data-startup-detail>${etat.detail || 'Chargement des composants essentiels.'}</p>
      </div>
      <div class="startup-progress-zone">
        <div class="startup-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${depart}"><span data-startup-progress style="width:${depart}%"></span><span class="startup-progress-pulse" data-startup-pulse style="left:${depart}%"></span></div>
        ${stepsMarkup()}
        <div class="startup-progress-meta"><span data-startup-percent>${depart}%</span><span data-startup-stage>${etat.label || 'Analyse des composants'}</span></div>
      </div>
    </div>
  </section>`;
  const splash = host.querySelector('#startup-splash');
  if (splash) { startSplashAnimation(splash); startLogoAssembly(splash); }
  return splash;
}

// Durée garantie d'assemblage du symbole. Le symbole n'est PAS une jauge : il ne doit
// jamais rester à demi assemblé, quelle que soit la vitesse du réseau.
const LOGO_ASSEMBLY_MS = 1400;

// Durée de l'éveil : le symbole entier, immobile, qui s'illumine avant que la première
// page apparaisse. Décomptée du plancher de lisibilité, donc sans allonger le démarrage.
const AWAKEN_MS = 760;

function revealPiece(piece) {
  if (!piece || piece.classList.contains('is-visible')) return;
  piece.classList.add('is-visible', 'just-connected');
  setTimeout(() => piece.classList.remove('just-connected'), 760);
}

/**
 * Assemblage du symbole sur son PROPRE calendrier.
 *
 * Les pièces s'allumaient au prorata du progrès réel. Sur un réseau lent, le démarrage
 * s'arrête longtemps à 52 % : l'utilisateur restait alors devant quatre pièces sur huit
 * qui tournaient — un logo mutilé, tenu pour l'identité de la plateforme pendant toute
 * l'attente. Et si la synchronisation n'aboutissait pas, le symbole ne se complétait
 * jamais.
 *
 * Le symbole s'assemble donc en un temps garanti, indépendamment du réseau, et
 * l'utilisateur voit toujours la marque entière tourner avant d'entrer. Le progrès, lui,
 * reste dit par la barre et le libellé d'étape — qui demeurent, eux, strictement réels.
 * Le symbole est l'identité ; la barre est la mesure. Les confondre était l'erreur.
 */
function startLogoAssembly(splash) {
  clearLogoAssembly();
  const pieces = [...splash.querySelectorAll('.startup-logo-segment')];
  if (!pieces.length) return;
  if (prefersReducedMotion()) { pieces.forEach(revealPiece); return; }
  const step = LOGO_ASSEMBLY_MS / pieces.length;
  pieces.forEach((piece, index) => {
    assemblyTimers.push(setTimeout(() => revealPiece(piece), Math.round(index * step)));
  });
  // Une fois le symbole entier, la lumière se met à le traverser. L'onde ne commence
  // qu'après l'assemblage : la faire courir sur un symbole incomplet donnerait
  // exactement l'impression de logo mutilé qu'on a corrigée.
  assemblyTimers.push(setTimeout(() => splash.classList.add('is-breathing'), LOGO_ASSEMBLY_MS + 120));
}

function clearLogoAssembly() {
  for (const timer of assemblyTimers) clearTimeout(timer);
  assemblyTimers.length = 0;
}

// Un démarrage plus rapide que le calendrier ne doit pas retarder le symbole : le progrès
// réel peut toujours prendre de l'avance, jamais du retard.
function revealPiecesForProgress(splash, value) {
  const pieces = splash.querySelectorAll('.startup-logo-segment');
  const target = Math.round((value / 100) * pieces.length);
  pieces.forEach((piece, index) => { if (index < target) revealPiece(piece); });
}

/**
 * Peint l'état du modèle. Cette fonction ne DÉCIDE plus rien : elle ne reçoit plus de
 * pourcentage d'un appelant, elle affiche celui que le modèle a calculé à partir d'étapes
 * réellement terminées. C'est tout l'objet de la correction.
 */
export function renderStartupProgress(etat) {
  const splash = document.getElementById('startup-splash');
  if (!splash) return;
  const fini = etat.phase === STARTUP_PHASES.DONE;
  const habillage = fini ? ETAT_FINAL : etat;
  const value = Math.max(0, Math.min(100, Math.round(Number(etat.value) || 0)));

  splash.dataset.stage = etat.stepId || 'boot';
  // L'attente humaine est un état à part entière, lisible dans le DOM et donc stylable :
  // la barre cesse de pulser, parce que rien ne charge.
  splash.dataset.phase = etat.phase;
  splash.querySelector('[data-startup-status]').textContent = habillage.status || '';
  splash.querySelector('[data-startup-detail]').textContent = habillage.detail || '';
  splash.querySelector('[data-startup-progress]').style.width = `${value}%`;
  const pulse = splash.querySelector('[data-startup-pulse]');
  if (pulse) pulse.style.left = `${value}%`;
  splash.querySelector('[data-startup-percent]').textContent = `${value}%`;
  splash.querySelector('.startup-progress').setAttribute('aria-valuenow', String(value));
  splash.querySelector('[data-startup-stage]').textContent = habillage.label || 'Initialisation';

  // La règle des étapes : chaque segment dit son propre état. Un arrêt long se voit alors
  // sur le segment qui le cause, au lieu d'être un nombre immobile sans explication.
  const termine = new Set(etat.completed || []);
  for (const segment of splash.querySelectorAll('.startup-step')) {
    const id = segment.dataset.step;
    segment.dataset.state = fini || termine.has(id)
      ? 'done'
      : (id === etat.stepId ? 'active' : 'pending');
  }

  revealPiecesForProgress(splash, value);
}

// L'écran s'abonne une fois pour toutes. Il est reconstruit après la connexion, et le
// modèle lui relivre aussitôt son état : la barre reprend à sa valeur au lieu de repartir
// de zéro puis de re-sauter, la régression visible de l'ancien parcours.
startupProgress.subscribe(renderStartupProgress);

// Une initialisation qui échoue ne doit pas laisser un splash figé à mi-course, sans dire
// pourquoi ni quoi faire.
export function failStartupSplash(error) {
  const splash = document.getElementById('startup-splash');
  // Le modèle est scellé même sans écran à peindre : plus rien ne doit faire avancer une
  // progression après un échec d'initialisation.
  startupProgress.fail(error);
  if (!splash) return false;
  stopSplashAnimation();
  splash.classList.add('startup-error');
  splash.setAttribute('aria-busy', 'false');
  splash.querySelector('[data-startup-status]').textContent = 'Initialisation interrompue';
  splash.querySelector('[data-startup-detail]').textContent = String(error?.message || error || 'Une étape technique n’a pas pu être chargée.');
  splash.querySelector('[data-startup-stage]').textContent = 'Signal perdu';
  return true;
}

export async function finishStartupSplash() {
  const splash = document.getElementById('startup-splash');
  if (!splash) return;
  const elapsed = splashStartedAt ? Date.now() - splashStartedAt : MIN_SPLASH_DURATION_MS;
  // Deux planchers, et l'on attend le plus tardif des deux : la durée de lecture décidée
  // par le client, ET le temps qu'il faut au symbole pour finir de s'assembler puis se
  // montrer entier. Un démarrage très rapide ne doit pas escamoter la marque.
  // L'éveil est décompté du plancher de lisibilité : ajouter la lueur ne rallonge donc
  // pas le démarrage, elle occupe une part du temps déjà prévu.
  const lisibilite = Math.max(0, MIN_SPLASH_DURATION_MS - elapsed - AWAKEN_MS);
  const assemblage = Math.max(0, LOGO_ASSEMBLY_MS + 320 - elapsed);
  const remaining = Math.max(lisibilite, assemblage);
  if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
  // Le modèle est SCELLÉ ici : la synchronisation de fond rappelle `/api/sync` toutes les
  // 20 s, et sans ce verrou elle ferait réapparaître une barre de démarrage en pleine
  // session de travail.
  startupProgress.finish();
  // Filet de sécurité : quoi qu'il soit arrivé au réseau, le symbole est entier avant
  // le verrouillage final. Personne n'entre sur un logo mutilé.
  clearLogoAssembly();
  for (const piece of splash.querySelectorAll('.startup-logo-segment')) revealPiece(piece);
  await settleLogo(splash);

  // ÉVEIL : l'onde s'arrête, le symbole se fige entier, et la lueur éclot — la
  // plateforme s'allume. C'est le seul moment où il est immobile et complet, et c'est
  // celui-là que l'utilisateur emporte avant d'entrer.
  splash.classList.remove('is-breathing');
  splash.setAttribute('aria-busy', 'false');
  if (!prefersReducedMotion()) {
    splash.classList.add('is-awake');
    await new Promise(resolve => setTimeout(resolve, AWAKEN_MS));
  }

  splash.classList.add('startup-ready');
  await new Promise(resolve => setTimeout(resolve, 420));
  stopSplashAnimation();
}

export const STARTUP_SPLASH_VERSION = 5;
export { MIN_SPLASH_DURATION_MS, STAGE_ORDER, LOGO_PIECES };
