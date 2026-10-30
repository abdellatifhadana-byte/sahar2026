/**
 * @file scripts/field-evidence-containment-e2e.mjs — SEC-01 (#78), Phase 0, l'épreuve réseau.
 *
 * `tests/field-evidence-containment.test.js` lit du texte source et compare deux
 * implémentations du même prédicat ; celle-ci PARLE AU SERVEUR RÉEL. Les deux sont
 * nécessaires : la première empêche la régression dans le code, la seconde vérifie que les
 * octets ne sortent effectivement pas d'un socket, avec les vraies en-têtes HTTP.
 *
 * Doit ÉCHOUER sur `main@ef4be53` et PASSER sur cette branche.
 *
 * Prérequis :
 *   PORT=4210 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4210 node scripts/field-evidence-containment-e2e.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4210';

/*
 * LES CHEMINS SONT ADVERSARIAUX, PAS SEULEMENT NOMINAUX.
 *
 * Chacun est une FORME que le sous-arbre protégé peut prendre une fois traité par
 * `decodeURIComponent` puis séparé en segments — casse, encodage, séparateurs mêlés,
 * chaîne de requête, traversée. Un serveur qui ne fermerait qu'un chemin exact laisserait
 * passer n'importe laquelle des sept autres.
 */
const CHEMINS_PROTEGES = Object.freeze([
  '/assets/field-evidence/2026-08-16/2m-field-pack.bin',
  '/assets/field-evidence/2026-08-16/phase11-migration-01.b64',
  '/assets/field-evidence/2026-08-16/phase12-01.webp',
  '/assets/field-evidence/',
  '/Assets/Field-Evidence/2026-08-16/2m-field-pack.bin',
  '/assets/field-evidence%2f2026-08-16%2f2m-field-pack.bin',
  '/assets/field-evidence/2026-08-16/2m-field-pack.bin?x=1',
  '/assets/../assets/field-evidence/2026-08-16/2m-field-pack.bin',
  '//assets//field-evidence//2m-field-pack.bin'
]);

const CHEMINS_PUBLICS_VOISINS = Object.freeze([
  '/assets/webfonts/fa-solid-900.woff2',
  '/equipements.js',
  '/field-evidence-integration.js',
  '/assets/plan-technique.PNG'
]);

const resultats = [];
const controle = (nom, condition, detail = '') => {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'OK  ' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nFE-1 · le sous-arbre protégé est fermé, sous toutes ses formes');
for (const chemin of CHEMINS_PROTEGES) {
  const reponse = await fetch(base + chemin);
  const octets = new Uint8Array(await reponse.arrayBuffer()).length;
  controle(
    chemin,
    reponse.status === 404 && octets < 100 && reponse.headers.get('cache-control') === 'no-store' && reponse.headers.get('x-content-type-options') === 'nosniff',
    `HTTP ${reponse.status}, ${octets} octets, cache-control=${reponse.headers.get('cache-control')}`
  );
}

console.log('\nFE-2 · les actifs publics voisins ne sont pas affectés par la fermeture');
for (const chemin of CHEMINS_PUBLICS_VOISINS) {
  const reponse = await fetch(base + chemin);
  // `/assets/plan-technique.PNG` est fermé par #137, pour une autre raison : 404 y est
  // attendu aussi, mais ce test vérifie seulement qu'aucun code 200 caché n'apparaît par
  // erreur pour les DEUX autres, qui doivent rester des actifs publics ordinaires.
  const attendu = chemin === '/assets/plan-technique.PNG' ? 404 : 200;
  controle(`${chemin} (HTTP ${reponse.status})`, reponse.status === attendu);
}

console.log('\nFE-3 · le Service Worker servi ne précache plus les octets protégés');
{
  const reponse = await fetch(`${base}/service-worker.js`);
  const corps = await reponse.text();
  const debut = corps.indexOf('const ASSETS_TO_CACHE');
  const fin = corps.indexOf('];', debut);
  const precache = corps.slice(debut, fin);
  controle('aucune entrée assets/field-evidence dans ASSETS_TO_CACHE', !precache.includes('assets/field-evidence'));
  controle('le prédicat de fermeture est présent', corps.includes('isPrivateFieldEvidenceRequest'));
  controle('CACHE_ASSETS filtre son payload', corps.includes("isPrivateFieldEvidenceRequest(url)") && corps.includes("includes('/api/')"));
}

const echecs = resultats.filter(resultat => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error('\nOCTETS PROTÉGÉS ACCESSIBLES OU RÉGRESSION DÉTECTÉE :');
  for (const echec of echecs) console.error(`  · ${echec.nom}${echec.detail ? ` — ${echec.detail}` : ''}`);
  process.exit(1);
}
