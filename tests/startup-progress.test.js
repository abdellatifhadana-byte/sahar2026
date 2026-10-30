import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createStartupProgress, STARTUP_STEPS, STARTUP_PHASES, startupProgress, readCountingBytes
} from '../startup-progress.js';

/** Une réponse dont le corps arrive en plusieurs tranches, comme sur une liaison lente. */
function reponseEnTranches(texte, tranches, { annonceTaille = true } = {}) {
  const octets = new TextEncoder().encode(texte);
  const taille = Math.ceil(octets.length / tranches);
  const flux = new ReadableStream({
    start(controller) {
      for (let i = 0; i < octets.length; i += taille) controller.enqueue(octets.slice(i, i + taille));
      controller.close();
    }
  });
  return {
    body: flux,
    headers: { get: nom => (nom === 'content-length' && annonceTaille ? String(octets.length) : null) },
    text: async () => texte
  };
}

/*
 * Le modèle de progression du démarrage, testé seul — sans DOM, sans réseau.
 *
 * Ce qu'il remplace : sept constantes écrites à la main dans core.js, annoncées AVANT le
 * travail qu'elles prétendaient mesurer. Mesuré dans le navigateur : la barre restait
 * immobile 1 461 ms à 90 % en localhost, et sur une liaison réelle elle reste bloquée à
 * 52 % pendant tout le téléchargement de l'instantané (285,5 kio → 864 ms à 400 kio/s,
 * 3 155 ms sur une liaison mobile), sous un libellé parlant d'identité.
 */

test('entrer dans une étape n’avance pas la barre ; la terminer, oui', () => {
  // C'est LA règle. `updateStartupSplash('database', 15)` puis `await db.open()` créditait
  // 15 % pour un travail qui n'avait pas commencé.
  const p = createStartupProgress();
  const depart = p.state().value;
  p.enter('database');
  assert.equal(p.state().value, depart, 'entrer dans une étape a crédité de la progression');
  p.complete('database');
  assert.ok(p.state().value > depart, 'terminer une étape n’a rien crédité');
});

test('la valeur ne redescend jamais', () => {
  // Après une connexion, core.js reconstruit l'écran de démarrage. L'ancien code repartait
  // de 4 % pour re-sauter à 60 % : une barre qui recule se lit comme une panne.
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database'); p.complete('integrity');
  const haut = p.state().value;
  p.report('database', 0);      // une sous-progression tardive d'une étape déjà finie
  assert.ok(p.state().value >= haut, `la barre est redescendue de ${haut} à ${p.state().value}`);
  p.enter('boot');              // un retour en arrière dans l'ordre des étapes
  assert.ok(p.state().value >= haut, 'revenir à une étape antérieure a fait reculer la barre');
});

test('une étape longue progresse à l’intérieur de sa propre bande', () => {
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database'); p.complete('integrity'); p.complete('session');
  const bande = p.bands().find(b => b.id === 'download');
  const avant = p.state().exact;
  assert.ok(Math.abs(avant - bande.start) < 0.01, 'le téléchargement ne commence pas au début de sa bande');
  p.report('download', 0.5);
  const milieu = p.state().exact;
  assert.ok(milieu > bande.start && milieu < bande.end, `sous-progression hors bande : ${milieu}`);
  // Et elle ne déborde jamais sur l'étape suivante, même en poussant au-delà de 1.
  p.report('download', 5);
  assert.ok(p.state().exact <= bande.end + 0.001, 'le téléchargement a débordé sur l’étape suivante');
});

test('le téléchargement pèse la majorité de la barre, comme il pèse la majorité du temps', () => {
  // Mesuré sur une liaison ordinaire : 864 ms de téléchargement sur 1 259 ms de démarrage.
  // Si ce poids retombait à une portion mineure, le blocage à 52 % reviendrait sous une
  // autre forme : des secondes d'attente enfermées dans quelques pour cent de barre.
  const p = createStartupProgress();
  const bande = p.bands().find(b => b.id === 'download');
  const largeur = bande.end - bande.start;
  assert.ok(largeur > 50, `le téléchargement ne pèse que ${largeur.toFixed(1)} % de la barre`);
});

test('les bandes couvrent exactement 0 → 100, sans trou ni chevauchement', () => {
  const p = createStartupProgress();
  const bandes = p.bands();
  assert.equal(bandes[0].start, 0);
  assert.ok(Math.abs(bandes[bandes.length - 1].end - 100) < 1e-9, 'la dernière bande ne finit pas à 100');
  for (let i = 1; i < bandes.length; i += 1) {
    assert.ok(Math.abs(bandes[i].start - bandes[i - 1].end) < 1e-9,
      `trou ou chevauchement entre ${bandes[i - 1].id} et ${bandes[i].id}`);
  }
});

test('attendre une personne se dit, et n’avance pas toute seule', () => {
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database');
  p.awaitHuman();
  const fige = p.state().value;
  assert.equal(p.state().phase, STARTUP_PHASES.AWAITING_HUMAN);
  // Nommer l'étape suivante ne doit rien créditer : personne ne travaille.
  p.enter('download');
  assert.equal(p.state().value, fige, 'la barre a avancé pendant une attente humaine');
  assert.equal(p.state().phase, STARTUP_PHASES.AWAITING_HUMAN, 'l’attente s’est terminée sans raison');
  p.resumeAfterHuman();
  assert.equal(p.state().phase, STARTUP_PHASES.RUNNING);
});

test('du travail réel met fin à l’attente, même sans reprise explicite', () => {
  // Le parcours « connexion » exécute la synchronisation initiale À L'INTÉRIEUR de
  // showLogin() : les octets arrivent avant que core.js ne reprenne la main. Une garde
  // bloquant jusqu'au retour de showLogin() faisait taire exactement la progression qu'on
  // venait de rendre mesurable — la barre serait restée figée pendant tout le transfert.
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database'); p.complete('integrity'); p.complete('session');
  p.awaitHuman();
  const fige = p.state().value;
  p.report('download', 0.5);
  assert.equal(p.state().phase, STARTUP_PHASES.RUNNING, 'l’arrivée d’octets n’a pas levé l’attente');
  assert.ok(p.state().value > fige, 'la barre est restée figée alors que des données arrivaient');
});

test('le modèle est scellé à la fin : la synchronisation de fond ne le ranime pas', () => {
  // `/api/sync` est rappelé toutes les 20 s et à chaque retour de focus, et il rend compte
  // au même modèle. Sans ce verrou, une barre de démarrage réapparaîtrait en pleine session.
  const p = createStartupProgress();
  p.finish();
  assert.equal(p.state().value, 100);
  assert.ok(p.sealed);
  p.report('download', 0.1);
  p.enter('database');
  p.awaitHuman();
  // `complete` doit obéir au sceau lui aussi : la mutation qui le lui retirait n'était
  // attrapée que par un autre test, ce qui laissait ce chemin réellement non vérifié.
  p.complete('download');
  assert.equal(p.state().value, 100, 'le modèle scellé a été ramené en arrière');
  assert.equal(p.state().phase, STARTUP_PHASES.DONE, 'le modèle scellé a changé de phase');
});

test('un échec scelle aussi le modèle', () => {
  const p = createStartupProgress();
  p.complete('boot');
  p.fail(new Error('base indisponible'));
  assert.equal(p.state().phase, STARTUP_PHASES.FAILED);
  const fige = p.state().value;
  p.complete('database');
  assert.equal(p.state().value, fige, 'la barre a avancé après un échec d’initialisation');
});

test('un abonné reçoit l’état courant immédiatement', () => {
  // L'écran de démarrage est reconstruit après la connexion : s'il devait attendre le
  // prochain événement, il afficherait zéro devant quelqu'un qui a déjà tout chargé.
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database');
  let recu = null;
  const desabonner = p.subscribe(etat => { recu = etat; });
  assert.ok(recu, 'aucun état livré à l’abonnement');
  assert.equal(recu.value, p.state().value);
  const fige = recu.value;
  desabonner();
  p.complete('integrity');
  assert.ok(p.state().value > fige, 'le modèle n’a pas avancé — le test ne prouve rien');
  assert.equal(recu.value, fige, 'le désabonnement n’a pas pris effet : l’abonné reçoit encore');
});

test('un abonné qui échoue n’interrompt pas le démarrage', () => {
  const p = createStartupProgress();
  p.subscribe(() => { throw new Error('rendu cassé'); });
  assert.doesNotThrow(() => p.complete('boot'));
  assert.ok(p.state().value > 0);
});

test('une étape inconnue est ignorée au lieu de fausser la barre', () => {
  const p = createStartupProgress();
  const avant = p.state().value;
  p.complete('etape-qui-nexiste-pas');
  p.report('etape-qui-nexiste-pas', 1);
  assert.equal(p.state().value, avant);
});

test('les étapes déclarées correspondent aux appels réels du code', () => {
  // Un pas de plus que la déclaration : chaque étape doit être TERMINÉE quelque part.
  const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const source = lire('core.js') + lire('central-sync.js');
  for (const step of STARTUP_STEPS) {
    assert.match(source, new RegExp(`complete\\('${step.id}'\\)`),
      `l'étape « ${step.id} » est déclarée mais jamais terminée`);
  }
});

/* =========================================================================
   LE COMPTEUR D'OCTETS — ce qui fait vivre le palier de 3 secondes
   ========================================================================= */

test('un corps reçu en tranches fait avancer la barre à chaque tranche', () => {
  // Le cœur de la correction : sur une liaison lente, l'instantané arrive en dizaines de
  // tranches. Chacune doit faire bouger la barre. C'était le palier immobile à 52 %.
  const texte = JSON.stringify({ data: { equipments: Array.from({ length: 400 }, (_, i) => ({ id: i, nom: `E${i}` })) } });
  const vus = [];
  return readCountingBytes(reponseEnTranches(texte, 20), charge => vus.push(charge)).then(recu => {
    assert.equal(recu, texte, 'le corps reconstitué diffère de l’original');
    const intermediaires = vus.filter(v => !v.done);
    assert.ok(intermediaires.length >= 15,
      `seulement ${intermediaires.length} comptes rendus pour 20 tranches`);
    // Monotone et borné par le total annoncé.
    for (let i = 1; i < intermediaires.length; i += 1) {
      assert.ok(intermediaires[i].received > intermediaires[i - 1].received, 'les octets reçus ont reculé');
      assert.ok(intermediaires[i].received <= intermediaires[i].total, 'plus d’octets reçus qu’annoncés');
    }
    assert.ok(vus[vus.length - 1].done, 'la fin n’a pas été annoncée');
  });
});

test('sans Content-Length, on n’invente pas de dénominateur', () => {
  // Une réponse compressée n'annonce pas sa taille. Fabriquer une fraction serait
  // exactement le mensonge qu'on corrige : la barre reste où elle est, le libellé parle.
  const texte = 'x'.repeat(5000);
  const vus = [];
  return readCountingBytes(reponseEnTranches(texte, 10, { annonceTaille: false }), c => vus.push(c))
    .then(() => {
      const intermediaires = vus.filter(v => !v.done);
      assert.ok(intermediaires.length > 0);
      for (const v of intermediaires) assert.equal(v.total, 0, 'un total a été inventé');
    });
});

test('la taille du dernier instantané sert de repère au suivant', () => {
  // Le repère vient d'un téléchargement RÉEL, pas d'une estimation : c'est ce qui permet
  // à une réponse compressée de tout de même afficher une fraction honnête.
  const texte = 'y'.repeat(4000);
  const vus = [];
  return readCountingBytes(reponseEnTranches(texte, 8, { annonceTaille: false }), c => vus.push(c),
    { expectedSize: 4000 }).then(() => {
      const intermediaires = vus.filter(v => !v.done);
      for (const v of intermediaires) assert.equal(v.total, 4000);
      assert.ok(intermediaires.some(v => v.received / v.total > 0.5), 'la fraction n’a jamais dépassé la moitié');
    });
});

test('un compte rendu qui échoue n’interrompt pas le téléchargement', () => {
  const texte = 'z'.repeat(2000);
  return readCountingBytes(reponseEnTranches(texte, 5), () => { throw new Error('rendu cassé'); })
    .then(recu => assert.equal(recu, texte));
});

test('une réponse sans flux se lit d’un bloc, sans étapes inventées', () => {
  const vus = [];
  const sansFlux = { headers: { get: () => null }, text: async () => 'contenu' };
  return readCountingBytes(sansFlux, c => vus.push(c)).then(recu => {
    assert.equal(recu, 'contenu');
    assert.equal(vus.length, 1, 'des étapes intermédiaires ont été fabriquées');
    assert.ok(vus[0].done);
  });
});

test('bout en bout : les tranches poussent la barre dans la bande du téléchargement', () => {
  // Le compteur et le modèle assemblés, comme dans central-sync.js.
  const p = createStartupProgress();
  p.complete('boot'); p.complete('database'); p.complete('integrity'); p.complete('session');
  const bande = p.bands().find(b => b.id === 'download');
  const valeurs = [];
  const texte = 'w'.repeat(10000);
  return readCountingBytes(reponseEnTranches(texte, 25), ({ received, total, done }) => {
    if (done) { p.complete('download'); return; }
    if (total > 0) p.report('download', Math.min(received / total, 0.99));
    valeurs.push(p.state().exact);
  }).then(() => {
    assert.ok(valeurs.length >= 20, `la barre n’a été mise à jour que ${valeurs.length} fois`);
    assert.ok(valeurs[0] < valeurs[valeurs.length - 1], 'la barre n’a pas progressé');
    for (const v of valeurs) {
      assert.ok(v >= bande.start && v <= bande.end, `valeur ${v} hors de la bande du téléchargement`);
    }
    assert.ok(Math.abs(p.state().exact - bande.end) < 0.01, 'la fin du téléchargement ne clôt pas sa bande');
  });
});

test('l’instance partagée est unique', () => {
  // core.js orchestre, central-sync.js mesure le transfert : deux modèles distincts et la
  // barre ignorerait le poste dominant du démarrage.
  assert.ok(startupProgress);
  assert.equal(typeof startupProgress.complete, 'function');
  const source = fs.readFileSync(new URL('../central-sync.js', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*\bstartupProgress\b[^}]*\} from '\.\/startup-progress\.js'/);
  // Et il n'en fabrique pas un second : `createStartupProgress` n'a rien à faire ici.
  assert.doesNotMatch(source, /createStartupProgress/);
});
