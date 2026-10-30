export const STARTUP_PROGRESS_VERSION = 1;

/**
 * @file startup-progress.js — le modèle de progression du démarrage.
 *
 * CE QUI N'ALLAIT PAS
 * -------------------
 * Les pourcentages étaient sept constantes écrites à la main, annoncées AVANT le travail
 * qu'elles prétendaient mesurer : `updateStartupSplash('database', 15)` puis `db.open()`.
 * La barre ne mesurait donc rien — elle récitait.
 *
 * Trois conséquences, toutes mesurées dans le navigateur :
 *
 * 1. ARRÊT À 52 %. `checkSession()` déclenche la synchronisation initiale COMPLÈTE
 *    (auth.js:113). L'instantané pèse 285,5 kio pour 200 enregistrements : 25 ms en
 *    localhost, mais 864 ms sur une liaison à 400 kio/s et 3 155 ms sur une liaison mobile
 *    à 100 kio/s. Pendant tout ce temps la barre affiche 52 % et le libellé annonce
 *    « Vérification de votre identité » — alors que ce qui se passe réellement est le
 *    téléchargement de toute la base. C'est le blocage signalé par le client.
 *
 * 2. SAUT À 100 %. Une fois la synchronisation finie, tout le reste est instantané :
 *    mesuré 52 % → 90 % en 155 ms. La barre saute donc, parce que les trois quarts du
 *    temps réel étaient enfermés dans un seul palier.
 *
 * 3. ÉTAPE FANTÔME. « Synchronisation de la plateforme » était annoncée à 72 %, après la
 *    session — or la synchronisation a déjà eu lieu, à 52 %. Mesuré : 72 % n'a jamais été
 *    affiché une seule image. Le libellé nommait une étape où il ne se passe rien.
 *
 * LA RÈGLE
 * --------
 * Une étape ne fait avancer la barre qu'en se TERMINANT. Une étape longue peut rendre
 * compte d'elle-même en cours de route — le téléchargement compte ses octets reçus, l'
 * écriture locale compte ses magasins écrits — et la barre progresse alors DANS la bande
 * de cette étape. Rien n'est jamais annoncé d'avance.
 *
 * L'ATTENTE HUMAINE N'EST PAS UN CHARGEMENT
 * -----------------------------------------
 * Quand la plateforme attend qu'une personne saisisse ses identifiants, elle ne charge
 * rien. Le modèle passe en `awaiting-human` : la valeur se fige et l'interface doit le
 * dire, au lieu de laisser courir une animation de chargement devant un formulaire.
 *
 * MONOTONE
 * --------
 * La valeur ne redescend jamais. Après une connexion, `core.js` reconstruit l'écran de
 * démarrage : il repartait de 4 % pour re-sauter à 60 %, une régression visible. Le modèle
 * survit à la reconstruction de l'écran et la barre reprend où elle en était.
 */

/**
 * Les étapes RÉELLES du démarrage, dans l'ordre où elles se produisent.
 *
 * Les poids ne sont pas choisis : ils viennent des durées mesurées sur une liaison
 * ordinaire (150 ms de latence, 400 kio/s), le cas où la barre a un sens — en localhost
 * tout est fini en 340 ms et personne ne la lit.
 *
 *   boot        85 ms   graphe de modules chargé, écran de démarrage posé
 *   database    64 ms   db.open() + ensureCanonicalSettings()
 *   integrity   35 ms   inspectDataIntegrity()
 *   session     40 ms   GET /api/auth/session
 *   download   864 ms   GET /api/sync — 285,5 kio mesurés
 *   apply      141 ms   écriture des 200 enregistrements dans IndexedDB
 *   interface   30 ms   construction de l'interface du rôle
 *              -------
 *             1259 ms
 *
 * Le téléchargement pèse donc les deux tiers du démarrage. C'est exactement le palier qui
 * était réduit à un nombre immobile.
 */
export const STARTUP_STEPS = Object.freeze([
  Object.freeze({ id: 'boot', label: 'Analyse des composants', weight: 7,
    status: 'Préparation de la plateforme…', detail: 'Chargement des composants essentiels.' }),
  Object.freeze({ id: 'database', label: 'Stockage local', weight: 5,
    status: 'Initialisation des données…', detail: 'Ouverture du stockage local sécurisé.' }),
  Object.freeze({ id: 'integrity', label: 'Sécurité & intégrité', weight: 3,
    status: 'Vérification de l’intégrité…', detail: 'Contrôle des relations entre salles, baies, équipements et données techniques.' }),
  Object.freeze({ id: 'session', label: 'Session utilisateur', weight: 3,
    status: 'Vérification de la session…', detail: 'Contrôle de votre identité et de vos autorisations.' }),
  Object.freeze({ id: 'download', label: 'Réception des données', weight: 62,
    status: 'Réception des données centrales…', detail: 'Téléchargement de l’inventaire depuis la base centrale.' }),
  Object.freeze({ id: 'apply', label: 'Écriture locale', weight: 15,
    status: 'Écriture des données locales…', detail: 'Enregistrement de l’inventaire dans le stockage du poste.' }),
  Object.freeze({ id: 'interface', label: 'Interface', weight: 5,
    status: 'Initialisation de l’interface…', detail: 'Préparation de votre espace de travail.' })
]);

export const STARTUP_PHASES = Object.freeze({
  RUNNING: 'running',
  AWAITING_HUMAN: 'awaiting-human',
  DONE: 'done',
  FAILED: 'failed'
});

const borne = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Modèle de progression. Aucune dépendance : il ne connaît ni le DOM, ni le réseau, ni
 * l'écran de démarrage — ce qui le rend testable seul et réutilisable si l'habillage change.
 */
export function createStartupProgress({ steps = STARTUP_STEPS, onChange = null } = {}) {
  const liste = steps.filter(step => step && step.id && Number(step.weight) > 0);
  const total = liste.reduce((somme, step) => somme + Number(step.weight), 0) || 1;

  // Bande occupée par chaque étape, en pourcentage : [début, fin].
  const bandes = new Map();
  let curseur = 0;
  for (const step of liste) {
    const largeur = Number(step.weight) * 100 / total;
    bandes.set(step.id, { debut: curseur, fin: curseur + largeur, step });
    curseur += largeur;
  }

  let valeur = 0;
  let etapeCourante = liste[0]?.id || null;
  let phase = STARTUP_PHASES.RUNNING;
  let scelle = false;
  let erreur = null;
  const terminees = new Set();

  const etat = () => {
    const bande = bandes.get(etapeCourante);
    return Object.freeze({
      value: Math.round(valeur),
      exact: valeur,
      stepId: etapeCourante,
      label: bande?.step.label || 'Initialisation',
      status: bande?.step.status || '',
      detail: bande?.step.detail || '',
      phase,
      error: erreur,
      completed: Object.freeze([...terminees])
    });
  };

  // Plusieurs observateurs : l'écran de démarrage rend la barre, et les tests observent la
  // suite exacte des états. Un rappel qui échoue ne doit pas interrompre le démarrage.
  const observateurs = new Set();
  if (typeof onChange === 'function') observateurs.add(onChange);
  const notifier = () => {
    const instantane = etat();
    for (const observateur of observateurs) { try { observateur(instantane); } catch {} }
  };

  /** La valeur ne redescend jamais : une régression visible se lit comme une panne. */
  const poser = cible => {
    const suivant = borne(cible, 0, 100);
    if (suivant <= valeur) return false;
    valeur = suivant;
    return true;
  };

  return {
    /**
     * Entre dans une étape. N'AVANCE PAS la barre : c'est tout le principe. Le libellé
     * change pour dire ce qui commence, la mesure attend le résultat.
     */
    enter(id) {
      if (scelle || !bandes.has(id)) return etat();
      etapeCourante = id;
      notifier();
      return etat();
    },

    /**
     * Rend compte de l'intérieur d'une étape longue. `fraction` va de 0 à 1 et positionne
     * la barre DANS la bande de l'étape. C'est ce qui fait vivre le téléchargement, qui
     * dure de 25 ms à plus de 3 s selon la liaison.
     */
    report(id, fraction) {
      if (scelle) return etat();
      const bande = bandes.get(id);
      if (!bande) return etat();
      // Un compte rendu de travail RÉEL met fin à l'attente : si des octets arrivent, la
      // plateforme n'attend plus personne. C'est indispensable, parce que la
      // synchronisation initiale du parcours « connexion » s'exécute À L'INTÉRIEUR de
      // `showLogin()` (auth.js) — donc avant que core.js ne reprenne la main. Une garde
      // qui bloquait tout jusqu'au retour de `showLogin()` faisait taire précisément la
      // progression qu'on venait de rendre mesurable.
      if (phase === STARTUP_PHASES.AWAITING_HUMAN) phase = STARTUP_PHASES.RUNNING;
      const part = borne(Number(fraction) || 0, 0, 1);
      etapeCourante = id;
      // On notifie même sans avancée : le libellé d'étape a pu changer, et une barre qui
      // n'avance pas parce que le réseau est lent doit tout de même dire ce qu'elle attend.
      poser(bande.debut + (bande.fin - bande.debut) * part);
      notifier();
      return etat();
    },

    /** L'étape est FINIE : c'est le seul événement qui garantit d'avancer. */
    complete(id) {
      if (scelle) return etat();
      const bande = bandes.get(id);
      if (!bande) return etat();
      terminees.add(id);
      poser(bande.fin);
      // On se place sur l'étape suivante non terminée, pour que le libellé dise la suite.
      const index = liste.findIndex(step => step.id === id);
      etapeCourante = liste[index + 1]?.id || id;
      notifier();
      return etat();
    },

    /**
     * La plateforme attend une personne. Ce n'est pas un chargement : la valeur se fige
     * et l'interface doit cesser d'afficher une progression.
     */
    awaitHuman() {
      if (scelle) return etat();
      phase = STARTUP_PHASES.AWAITING_HUMAN;
      notifier();
      return etat();
    },

    /** La personne a répondu : le chargement reprend là où il s'était arrêté. */
    resumeAfterHuman() {
      if (scelle || phase !== STARTUP_PHASES.AWAITING_HUMAN) return etat();
      phase = STARTUP_PHASES.RUNNING;
      notifier();
      return etat();
    },

    /**
     * Fin du démarrage. Le modèle est SCELLÉ : la synchronisation de fond, qui rappelle
     * `/api/sync` toutes les 20 s, ne doit pas faire réapparaître une barre de démarrage
     * une heure après l'ouverture de la session.
     */
    finish() {
      if (scelle) return etat();
      for (const step of liste) terminees.add(step.id);
      valeur = 100;
      phase = STARTUP_PHASES.DONE;
      etapeCourante = liste[liste.length - 1]?.id || etapeCourante;
      scelle = true;
      notifier();
      return etat();
    },

    fail(cause) {
      if (scelle) return etat();
      phase = STARTUP_PHASES.FAILED;
      erreur = cause || null;
      scelle = true;
      notifier();
      return etat();
    },

    /**
     * S'abonne aux changements. L'état courant est livré IMMÉDIATEMENT : l'écran de
     * démarrage est reconstruit après une connexion, et il doit repartir de la valeur
     * atteinte, pas attendre le prochain événement pour cesser d'afficher zéro.
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      observateurs.add(listener);
      try { listener(etat()); } catch {}
      return () => observateurs.delete(listener);
    },

    state: etat,
    get sealed() { return scelle; },
    /** Bandes exposées pour les tests : une étape ne doit pas déborder sur la suivante. */
    bands: () => Object.freeze([...bandes.entries()].map(([id, b]) =>
      Object.freeze({ id, start: b.debut, end: b.fin })))
  };
}

/**
 * Lit le corps d'une réponse en COMPTANT les octets reçus.
 *
 * C'est la pièce qui manquait pour que le téléchargement puisse rendre compte de lui-même.
 * Mesuré : l'instantané pèse 285,5 kio — 25 ms en localhost, mais 864 ms sur une liaison à
 * 400 kio/s et 3 155 ms sur une liaison mobile à 100 kio/s. Deux tiers du démarrage,
 * jusqu'ici enfermés dans un nombre immobile.
 *
 * `expectedSize` sert de dénominateur quand la réponse est compressée et n'annonce pas de
 * `Content-Length`. Sans dénominateur, `total` vaut 0 : on ne PRÉTEND pas connaître la
 * fraction. Inventer un dénominateur ramènerait exactement le défaut qu'on corrige.
 *
 * Vit ici, et non dans central-sync.js, parce que central-sync.js ne peut pas être importé
 * hors navigateur — il ouvre IndexedDB au chargement. Une logique non testable est une
 * logique non vérifiée.
 */
export async function readCountingBytes(response, onProgress, { expectedSize = 0 } = {}) {
  const rapporter = charge => { try { onProgress?.(charge); } catch {} };
  if (!response?.body || typeof response.body.getReader !== 'function') {
    // Pas de flux disponible : on lit d'un bloc et on annonce la fin, sans jamais
    // fabriquer d'étapes intermédiaires qui n'ont pas eu lieu.
    const texte = await response.text();
    rapporter({ received: texte.length, total: texte.length, done: true });
    return texte;
  }
  const annonce = Number(response.headers?.get?.('content-length'));
  const total = Number.isFinite(annonce) && annonce > 0
    ? annonce
    : (Number.isFinite(Number(expectedSize)) && Number(expectedSize) > 0 ? Number(expectedSize) : 0);

  const lecteur = response.body.getReader();
  const morceaux = [];
  let recus = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    recus += value.length;
    rapporter({ received: recus, total, done: false });
  }
  rapporter({ received: recus, total: recus, done: true });
  const assemble = new Uint8Array(recus);
  let offset = 0;
  for (const morceau of morceaux) { assemble.set(morceau, offset); offset += morceau.length; }
  return new TextDecoder().decode(assemble);
}

/**
 * Instance partagée du démarrage.
 *
 * Elle doit être unique : `core.js` orchestre les étapes, mais c'est `central-sync.js` qui
 * connaît le coût réel du téléchargement et de l'écriture — et la synchronisation peut être
 * déclenchée par deux chemins différents (session déjà ouverte, ou connexion). Les deux
 * rendent compte au même modèle.
 */
export const startupProgress = createStartupProgress();

export default Object.freeze({
  version: STARTUP_PROGRESS_VERSION,
  STARTUP_STEPS,
  STARTUP_PHASES,
  createStartupProgress,
  startupProgress
});
