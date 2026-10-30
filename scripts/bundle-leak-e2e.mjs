/**
 * @file scripts/bundle-leak-e2e.mjs — ACCESS-LEAK-BUNDLE-01 (#137), l'épreuve comportementale.
 *
 * La garde `check-public-bundle.mjs` lit du code ; celle-ci PARLE AU SERVEUR. Les deux sont
 * nécessaires et ne prouvent pas la même chose : la première empêche la donnée de revenir
 * dans un fichier, la seconde vérifie qu'elle ne sort pas d'un socket.
 *
 * Elle doit ÉCHOUER sur la base 8f51238d et PASSER sur la candidate.
 *
 * Prérequis :
 *   PORT=4188 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4188 node scripts/bundle-leak-e2e.mjs
 *
 * Comptes attendus (le script les crée s'il peut) : un administrateur, un technicien
 * habilité sur la zone qui porte la Grille Centrale, un technicien d'une autre zone.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProtectedFingerprints,
  buildPublicModuleGraph,
  findOperationalResiduesInSource
} from './public-bundle-residue-guard.mjs';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const ENDPOINT = '/api/operational/grille-centrale/documented-map';

const MODULES_PUBLICS = [
  '/grille-centrale-documented-map.js',
  '/grille-centrale-topology.js',
  '/grille-centrale-knowledge.js',
  '/grille-centrale-physical-architecture.js',
  '/grille-centrale-field-verification.js',
  '/grille-centrale-dataset.js'
];

const CHEMINS_PRIVES = [
  '/scripts/private-operational-data/grille-centrale.js',
  '/scripts/serve.js',
  '/scripts/access-control.js'
];

/*
 * LES SONDES SONT STRUCTURELLES, PAS LEXICALES.
 *
 * Chacune décrit une NATURE de donnée d'installation — un libellé de port affecté, un repère
 * de câble, une implantation en baie, une capacité de matrice — et non un mot de la liste
 * « STC / RF ». Une transcription qui n'emploierait aucun de ces mots serait tout de même
 * attrapée, parce que c'est la forme qui trahit la donnée.
 */
const SONDES = Object.freeze({
  'libellé de port affecté': /"(?:STC|RF|VTR|AVID|NEWS|SAT|NEDIT|MIRE|RADAC|AUDIOMON|CNA|MUX|DEMUX)\s?\d+"/,
  'repère de câble': /\bGR\s?\d{1,4}\b/,
  'poste de contrôle nommé': /CTRL-[A-Z]/,
  'implantation en baie': /BAIE\s(?:\d|GR-\d)/,
  'capacité de matrice': /(?<!-)190\s*[x×✕✖*]\s*(?:184|190)|\d{2,4}\s*entrées\s*\/\s*\d{2,4}\s*sorties/iu,
  'document source interne': /DT\/EH\/11\/2011|LTS MAROC|Son Tran/,
  'sortie monitoring': /MONITORING\/OUT\.\d/,
  'destination châssis': /CHASSIS\s\d|DMUX\/\d/,
  /*
   * LES FORMES NARRATIVES (#142).
   *
   * Les sondes ci-dessus décrivent des tableaux et des repères. Elles ne voyaient pas la
   * même donnée écrite en phrase — « 190 entrées SDI × 184 sorties SDI », « Ports IN.64–181
   * non visibles » — qui est restée téléchargeable dans les fiches catalogue bien après #137.
   */
  'capacité racontée': /(?<!\d)190(?!\d)[^\d]{0,40}(?:entr[ée]es?|sorties?|inputs?|outputs?)[^\d]{0,40}(?<!\d)184(?!\d)/iu,
  'plage de ports documentée': /\b(?:IN|OUT)\.\s?\d{1,3}\s*[–—-]\s*\d{1,3}\b/u
});

/*
 * LES IDENTIFIANTS CANONIQUES SONT RETIRÉS AVANT DE SONDER, ET C'EST UNE DÉCISION.
 *
 * `router-gc190x184` et `kb-grille-centrale-190x184` contiennent la capacité de la matrice.
 * #137 les CONSERVE délibérément : ce sont les clés sur lesquelles reposent le contrat de
 * topologie, les fiches déjà écrites en base et la résolution d'autorisation côté serveur.
 * Les renommer serait une migration de données, pas une fermeture de fuite — et cette
 * migration n'est pas dans ce lot.
 *
 * Le résidu est donc assumé et nommé : un lecteur du bundle apprend « 190×184 » en lisant un
 * identifiant. Il n'apprend rien d'autre — ni quel port porte quel signal, ni où la matrice
 * est posée, ni vers quoi elle est câblée.
 */
const sansIdentifiantsCanoniques = texte => texte.replace(/[a-z]+-[a-z-]*190x18[40]/g, '');

const sondesTouchees = texte => {
  const utile = sansIdentifiantsCanoniques(texte);
  return Object.entries(SONDES).filter(([, rx]) => rx.test(utile)).map(([nom]) => nom);
};

async function requete(chemin, cookie = '') {
  const reponse = await fetch(base + chemin, { headers: cookie ? { cookie } : {} });
  return { statut: reponse.status, corps: await reponse.text(), entetes: reponse.headers };
}

async function connexion(username, password) {
  const reponse = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const cookie = reponse.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie.startsWith('tp_session='), `connexion impossible pour « ${username} » (${reponse.status})`);
  return cookie;
}

const comptes = {
  admin: { username: process.env.E2E_ADMIN_USERNAME || 'audit-admin', password: process.env.E2E_ADMIN_PASSWORD || '' },
  habilite: { username: process.env.E2E_GRILLE_USERNAME || '', password: process.env.E2E_GRILLE_PASSWORD || '' },
  horsScope: { username: process.env.E2E_OUTSIDE_USERNAME || '', password: process.env.E2E_OUTSIDE_PASSWORD || '' }
};

const resultats = [];
const controle = (nom, condition, detail = '') => {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'OK  ' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/*
 * BUNDLE-0 · LE BALAYAGE ANONYME COMPLET.
 *
 * BUNDLE-1 ne visitait que six modules `grille-centrale-*` — ceux que #137 venait de vider.
 * C'est exactement ce qui a laissé passer #142 : la capacité, l'implantation et les plages de
 * ports vivaient dans `equipment-catalog-extra-seed.js` et `equipment-knowledge-packs.js`,
 * hors de cette liste, donc jamais interrogés.
 *
 * Le balayage part maintenant d'`index.html` et suit les imports : TOUT actif JS que le
 * serveur rend à un client sans cookie est lu, et confronté aux empreintes DÉRIVÉES du
 * dataset privé — les mêmes que la garde statique, appliquées cette fois aux octets qui
 * sortent réellement du socket.
 */
const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const empreintes = buildProtectedFingerprints(readFileSync(join(racine, 'scripts/private-operational-data/grille-centrale.js'), 'utf8'));

console.log('\nBUNDLE-0 · balayage anonyme de tout le bundle public');
{
  const graphe = buildPublicModuleGraph(racine);
  const fuites = [];
  const horsLot = [];
  let servis = 0;
  let octets = 0;
  for (const module of graphe) {
    const { statut, corps } = await requete(`/${module}`);
    if (statut !== 200) continue;
    servis += 1;
    octets += corps.length;
    /*
     * DEUX INSTRUMENTS, DEUX PORTÉES — ET AUCUN N'EST TU.
     *
     * Le détecteur dérive ses empreintes du dataset privé de la Grille : c'est l'invariant
     * de #142, et il BLOQUE sur tout le graphe.
     *
     * Les sondes structurelles, elles, décrivent des FORMES (« BAIE <n> », « CHASSIS <n> »)
     * sans rien savoir de la Grille. Braquées sur les six modules `grille-centrale-*` — ce
     * que fait BUNDLE-1, sans changement — elles sont justes. Braquées sur les 163, elles
     * relèvent aussi l'implantation d'équipements qui n'ont rien à voir avec la Grille :
     * baies de la Régie Car, placement en rack de châssis tiers. C'est réel, c'est à traiter,
     * mais c'est le périmètre de #78 et non celui de ce lot.
     *
     * On les NOMME donc au lieu de les faire bloquer ici : taire un constat pour obtenir du
     * vert serait exactement le défaut que ce lot vient de corriger.
     */
    const residus = findOperationalResiduesInSource(module, corps, empreintes);
    if (residus.length) fuites.push(`${module} — ${residus.map(r => r.replace(`${module}: `, '')).join(' · ')}`);
    const sondes = sondesTouchees(corps);
    if (sondes.length && !MODULES_PUBLICS.includes(`/${module}`)) horsLot.push(`${module} — ${sondes.join(' · ')}`);
  }
  controle(`${servis}/${graphe.length} modules publics servis et sondés`, servis > 0, `${Math.round(octets / 1024)} Ko lus sans cookie`);
  controle('aucun résidu Grille protégé dans le bundle anonyme', fuites.length === 0,
    fuites.length ? fuites.slice(0, 8).join(' | ') : 'graphe complet propre');
  if (horsLot.length) {
    console.log(`  NOTE  ${horsLot.length} module(s) portent une implantation NON-Grille — périmètre #78, hors de ce lot :`);
    for (const ligne of horsLot) console.log(`          · ${ligne}`);
  }
}

console.log('\nBUNDLE-1 · les modules publics ne portent aucune donnée d’installation');
for (const module of MODULES_PUBLICS) {
  const { statut, corps } = await requete(module);
  const touchees = sondesTouchees(corps);
  controle(`${module} (HTTP ${statut})`, statut === 200 && touchees.length === 0,
    touchees.length ? touchees.join(' · ') : `${corps.length} octets, aucune sonde`);
}

console.log('\nBUNDLE-2 · le chemin privé n’est pas servi');
for (const chemin of CHEMINS_PRIVES) {
  const { statut, corps } = await requete(chemin);
  controle(`${chemin} (HTTP ${statut})`, statut === 404 && sondesTouchees(corps).length === 0);
}

console.log('\nBUNDLE-3 · l’endpoint exige une session');
{
  const { statut, corps } = await requete(ENDPOINT);
  controle(`anonyme → ${statut}`, statut === 401 && sondesTouchees(corps).length === 0);
}

if (comptes.horsScope.username) {
  console.log('\nBUNDLE-4 · un compte hors périmètre reçoit un refus vide');
  const cookie = await connexion(comptes.horsScope.username, comptes.horsScope.password);
  const { statut, corps } = await requete(ENDPOINT, cookie);
  controle(`hors périmètre → ${statut}`, statut === 403 && sondesTouchees(corps).length === 0,
    `${corps.length} octets`);
}

if (comptes.habilite.username) {
  console.log('\nBUNDLE-6 · un compte habilité reçoit le jeu de données complet');
  const cookie = await connexion(comptes.habilite.username, comptes.habilite.password);
  const { statut, corps, entetes } = await requete(ENDPOINT, cookie);
  const charge = statut === 200 ? JSON.parse(corps).dataset : null;
  controle(`habilité → ${statut}`, statut === 200 && charge?.documentedPorts?.length === 374,
    charge ? `${charge.documentedPorts.length} ports` : corps.slice(0, 80));
  controle('la réponse n’est jamais mise en cache', entetes.get('cache-control') === 'no-store',
    entetes.get('cache-control') || '(absent)');
}

if (comptes.admin.password) {
  console.log('\nBUNDLE-7 · l’administrateur passe par la même porte');
  const cookie = await connexion(comptes.admin.username, comptes.admin.password);
  const { statut, corps } = await requete(ENDPOINT, cookie);
  controle(`admin → ${statut}`, statut === 200 && JSON.parse(corps).dataset?.documentedPorts?.length === 374);
}

const echecs = resultats.filter(resultat => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error('\nDONNÉE OPÉRATIONNELLE ACCESSIBLE :');
  for (const echec of echecs) console.error(`  · ${echec.nom}${echec.detail ? ` — ${echec.detail}` : ''}`);
  process.exit(1);
}
