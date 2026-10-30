import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXTRA_EQUIPMENT_CATALOG } from '../equipment-catalog-extra-seed.js';
// `equipment-knowledge-extra.js` utilise `MutationObserver`/`document` en dehors de tout
// garde `typeof window` — hérité, hors périmètre de ce correctif — donc pas importable tel
// quel ici. Le comportement de la barrière elle-même EST vérifié en exécution réelle dans
// `regie-car-inventory-phase16.test.js` ; ce fichier vérifie que celle-ci en est une copie
// caractère pour caractère, pas une variante qui aurait dérivé.
import { decisionSyncEtablie as decisionSyncEtablieVerifiee, attendreDecisionSync as attendreDecisionSyncVerifiee } from '../regie-car-inventory-phase16.js';

const source = fs.readFileSync(new URL('../equipment-knowledge-extra.js', import.meta.url), 'utf8');
const regieCarSource = fs.readFileSync(new URL('../regie-car-inventory-phase16.js', import.meta.url), 'utf8');
const centralSyncSource = fs.readFileSync(new URL('../central-sync.js', import.meta.url), 'utf8');
// Extrait un bloc `nom = ... { ... }` par comptage d'accolades — robuste au contenu
// imbriqué (une `Promise`, un écouteur) et à ce qui suit, contrairement à une recherche du
// prochain `}\n` littéral qui peut s'arrêter sur une accolade imbriquée.
const extraire = (texte, ancre) => {
  const debut = texte.search(ancre);
  assert.ok(debut >= 0, `motif introuvable : ${ancre}`);
  const ouverture = texte.indexOf('{', debut);
  assert.ok(ouverture >= 0, `accolade ouvrante introuvable après : ${ancre}`);
  let profondeur = 0;
  for (let i = ouverture; i < texte.length; i += 1) {
    if (texte[i] === '{') profondeur += 1;
    else if (texte[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return texte.slice(debut, i + 1);
    }
  }
  throw new Error(`accolade fermante introuvable pour : ${ancre}`);
};

test('catalogue technique enrichi: ids uniques et champs essentiels', () => {
  assert.ok(EXTRA_EQUIPMENT_CATALOG.length >= 35, 'le catalogue complémentaire doit contenir un socle significatif');
  const ids = EXTRA_EQUIPMENT_CATALOG.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'les ids du catalogue doivent être uniques');
  for (const item of EXTRA_EQUIPMENT_CATALOG) {
    assert.ok(item.manufacturer, `constructeur manquant pour ${item.id}`);
    assert.ok(item.model, `modèle manquant pour ${item.id}`);
    assert.ok(item.type, `type manquant pour ${item.id}`);
    assert.ok(item.category, `catégorie manquante pour ${item.id}`);
    assert.ok(['verified','verified-family','to-confirm'].includes(item.verificationStatus), `statut invalide pour ${item.id}`);
  }
});

test('catalogue technique enrichi: références terrain et inventaire attendues', () => {
  const ids = new Set(EXTRA_EQUIPMENT_CATALOG.map(item => item.id));
  for (const id of [
    'kb-leader-lt4610','kb-leader-lv5300a','kb-sony-pdw-hd1200','kb-kramer-vs81av',
    'kb-ross-ultritouch','kb-ross-mc1-panel16','kb-aja-ogfsmini','kb-cobalt-9940aco',
    'kb-ross-sra8802','kb-ross-sfs8622a','kb-ross-dra8804'
  ]) assert.ok(ids.has(id), `${id} doit être présent`);
});

test('#164 GREEN — la recréation spéculative du catalogue complémentaire ne se rejoue pas à chaque battement synced', () => {
  // `reconcileCentralCatalog` tourne à chaque `central-sync-status: synced` — un battement
  // périodique. Sans mémoire d'un envoi déjà tenté, un item durablement absent du dernier
  // instantané était réexpédié à CHAQUE battement, indéfiniment : la boucle #164.
  assert.match(source, /const dejaRetentes = new Set\(\);/);
  const loopBody = source.slice(source.indexOf('for (const item of EXTRA_EQUIPMENT_CATALOG) {'), source.indexOf('const remoteLt ='));
  assert.match(loopBody, /dejaRetentes\.delete\(String\(item\.id\)\)/, 'un item retrouvé dans l’instantané doit redevenir éligible à une future recréation');
  assert.match(loopBody, /if \(dejaRetentes\.has\(String\(item\.id\)\)\) continue;/, 'un item déjà retenté cette session ne doit pas être renvoyé à chaque battement');
  assert.match(loopBody, /dejaRetentes\.add\(String\(item\.id\)\)/);
});

test('#98 GREEN — le catalogue complémentaire attend la bascule de synchronisation avant de lire `docs`', () => {
  // `seedExtraCatalog` lisait `db.getAll('docs')` au chargement de la page, avant que
  // `enableCentralSync()` n'ait fini d'appliquer l'instantané serveur. Sur un rechargement,
  // la lecture arrivait trop tôt : ce module tentait de recréer des fiches déjà posées par
  // une session précédente — le 409 mesuré après reload.
  assert.match(source, /function attendreDecisionSync\(\)/);
  assert.match(source, /async function seedExtraCatalog\(\)\s*\{\s*\n\s*await attendreDecisionSync\(\);/);
});

// Compare le CODE, pas la prose : chaque fichier commente cette barrière avec ses propres
// mots, et c'est légitime. Seule une ligne de commentaire entière (`//…`) est retirée ;
// aucune des deux fonctions n'a de `//` ailleurs qu'en tête de ligne.
const sansCommentaires = bloc => bloc.split('\n').filter(ligne => !/^\s*\/\//.test(ligne)).join('\n');

test('#162 GREEN — la barrière de ce module exécute le même code que celui vérifié en exécution', () => {
  // `equipment-knowledge-extra.js` importe `MutationObserver`/`document` sans garde
  // `typeof window` — préexistant, hors périmètre — donc pas important tel quel dans
  // node:test. La preuve d'exécution réelle (CAS bloqué/libéré/déjà-tranché/terminal) est
  // apportée par `regie-car-inventory-phase16.test.js` sur `decisionSyncEtablie` et
  // `attendreDecisionSync` importés directement ; ce test garantit que la copie ICI n'a
  // pas dérivé de cette version vérifiée — pas seulement « une fonction du même nom ».
  const iciDecision = extraire(source, /export const decisionSyncEtablie = detail =>/);
  const verifieeDecision = extraire(regieCarSource, /export const decisionSyncEtablie = detail =>/);
  assert.equal(sansCommentaires(iciDecision), sansCommentaires(verifieeDecision), 'decisionSyncEtablie a divergé entre les deux fichiers');

  const iciBarriere = extraire(source, /export function attendreDecisionSync\(\)/);
  const verifieeBarriere = extraire(regieCarSource, /export function attendreDecisionSync\(\)/);
  assert.equal(sansCommentaires(iciBarriere), sansCommentaires(verifieeBarriere), 'attendreDecisionSync a divergé entre les deux fichiers');

  // Et la preuve d'exécution elle-même, pour que ce test ne soit pas qu'une comparaison de
  // texte : la fonction VÉRIFIÉE (importée, exécutée réellement) tient le contrat CAS 1-4.
  assert.equal(decisionSyncEtablieVerifiee({ state:'offline' }), false);
  assert.equal(decisionSyncEtablieVerifiee({ state:'warning' }), false);
  assert.equal(decisionSyncEtablieVerifiee({ state:'synced', updatedAt:'2026-01-01T00:00:00Z' }), true);
  assert.equal(decisionSyncEtablieVerifiee({ state:'unauthenticated' }), true);
});

test('#162 GREEN — (preuve d’exécution partagée) reste bloqué sur un signal de file, se libère sur un instantané réel', async () => {
  const { db } = await import('../db.js');
  const original = db.isCentralSyncReady;
  db.isCentralSyncReady = () => false;
  globalThis.window = new EventTarget();
  try {
    let reglee = false;
    const attente = attendreDecisionSyncVerifiee().then(() => { reglee = true; });

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'offline' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reglee, false, 'un `offline` sans updatedAt ne doit PAS libérer la lecture du catalogue');

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'warning' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reglee, false, 'un `warning` sans updatedAt ne doit PAS libérer la lecture du catalogue');

    globalThis.window.dispatchEvent(new CustomEvent('central-sync-status', { detail:{ state:'synced', updatedAt:'2026-01-01T00:00:00Z' } }));
    await attente;
    assert.equal(reglee, true, 'un `synced` avec updatedAt DOIT libérer la lecture du catalogue');
  } finally {
    db.isCentralSyncReady = original;
    delete globalThis.window;
  }
});

test('#162 GREEN — le filet de sécurité reste au-dessus du délai réseau de central-sync.js (25 s)', () => {
  const timeoutMatch = centralSyncSource.match(/const REQUEST_TIMEOUT_MS = (\d+);/);
  assert.ok(timeoutMatch, 'REQUEST_TIMEOUT_MS introuvable dans central-sync.js');
  const requestTimeoutMs = Number(timeoutMatch[1]);
  const filetMatch = source.match(/setTimeout\(regler, (\d+)\);/);
  assert.ok(filetMatch, 'filet de sécurité introuvable dans attendreDecisionSync');
  const filetMs = Number(filetMatch[1]);
  assert.ok(filetMs > requestTimeoutMs,
    `le filet (${filetMs} ms) doit rester AU-DESSUS du délai réseau (${requestTimeoutMs} ms)`);
});
