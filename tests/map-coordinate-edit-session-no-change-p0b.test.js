/**
 * @file tests/map-coordinate-edit-session-no-change-p0b.test.js — un scénario manquant du
 *       contrat existant `map-coordinate-edit-session.js` (non modifié, non rejoué ici).
 *
 * `tests/map-coordinate-edit-session.test.js` prouve déjà : restauration exacte (propriété
 * absente comprise), une fiche sale → exactement un appel de sauvegarde, succès + 409 →
 * partiel avec l'élément en conflit resté sale, échec total, nouvelle dette après succès.
 *
 * Un scénario du P0-B n'y était pourtant nommé nulle part : une session SANS AUCUNE fiche
 * sale ne doit produire AUCUN appel de sauvegarde. Ouvrir « Modifier les positions » sans
 * rien déplacer, puis cliquer « Enregistrer », est un geste réel — et silencieusement
 * envoyer une requête pour un contenu inchangé serait exactement le genre d'écriture
 * inutile que #98 (voir `tests/startup-sync-no-rewrite-98.test.js`) a déjà fermée ailleurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinateEditSession, saveCoordinateEditSession } from '../map-coordinate-edit-session.js';

test('aucune fiche sale : saveCoordinateEditSession n’appelle jamais la sauvegarde', async () => {
  const a = { id:'a', x_inRoom:10, y_inRoom:20 };
  const b = { id:'b', x_inRoom:30, y_inRoom:40 };
  const session = createCoordinateEditSession([a, b], ['x_inRoom', 'y_inRoom']);
  // Aucun markDirty n'est posé : rien n'a été déplacé.

  const appels = [];
  const result = await saveCoordinateEditSession(session, async record => { appels.push(record.id); });

  assert.deepEqual(appels, [], 'sans fiche sale, la fonction de sauvegarde ne doit jamais être invoquée');
  assert.equal(result.status, 'success', 'ne rien avoir à enregistrer est un succès, pas un échec');
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.pending, []);
});

test('un déplacement suivi d’Annuler avant Enregistrer : la session redevient propre, 0 sauvegarde ensuite', async () => {
  const record = { id:'a', x_inBaie:5, y_inBaie:6 };
  const session = createCoordinateEditSession([record], ['x_inBaie', 'y_inBaie']);
  record.x_inBaie = 99; session.markDirty(record);
  session.restore();

  const appels = [];
  const result = await saveCoordinateEditSession(session, async r => { appels.push(r.id); });
  assert.deepEqual(appels, [], 'après un Annuler, plus aucune fiche n’est sale : Enregistrer ne doit rien pousser');
  assert.equal(result.status, 'success');
});
