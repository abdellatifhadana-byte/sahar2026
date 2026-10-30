import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateEditViewMatches, describeCoordinateSaveOutcome } from '../map-coordinate-edit-outcome.js';

/* ═══════════════════ coordinateEditViewMatches ═══════════════════ */

test('aucune session active ne correspond à aucune vue', () => {
  assert.equal(coordinateEditViewMatches(null, 'room', 'r1'), false);
  assert.equal(coordinateEditViewMatches(undefined, 'baie', 'b1'), false);
});

test('la vue qui possède la session correspond, y compris à travers number/string', () => {
  assert.equal(coordinateEditViewMatches({ type:'room', id:'r1' }, 'room', 'r1'), true);
  assert.equal(coordinateEditViewMatches({ type:'room', id:1 }, 'room', '1'), true,
    'un identifiant numérique doit correspondre à sa forme chaîne');
  assert.equal(coordinateEditViewMatches({ type:'baie', id:'b1' }, 'baie', 'b1'), true);
});

test('un type différent, ou un identifiant différent, ne correspond pas', () => {
  assert.equal(coordinateEditViewMatches({ type:'room', id:'r1' }, 'baie', 'r1'), false,
    'même identifiant, magasin différent : ce n’est pas la même fiche');
  assert.equal(coordinateEditViewMatches({ type:'room', id:'r1' }, 'room', 'r2'), false);
  assert.equal(coordinateEditViewMatches({ type:'room', id:'r1' }, 'baie', 'b1'), false);
});

/* ═══════════════════ describeCoordinateSaveOutcome ═══════════════════ */

test('succès complet : niveau success, libellé exact', () => {
  const { level, message } = describeCoordinateSaveOutcome({ status:'success', saved:['a'], failed:[], pending:[] });
  assert.equal(level, 'success');
  assert.equal(message, 'Coordonnées enregistrées.');
});

test('sauvegarde partielle : les trois comptes apparaissent, jamais un libellé de succès', () => {
  const result = { status:'partial', saved:['r1'], failed:[{ id:'r2', code:'STALE_WRITE', status:409 }], pending:['r2'] };
  const { level, message } = describeCoordinateSaveOutcome(result);
  assert.equal(level, 'warning');
  assert.match(message, /^Enregistrement partiel : 1 enregistré\(s\), 1 en échec, 1 restant\(s\)\.?/);
  /*
   * LA LIGNE QUI COMPTE : un résultat partiel ne doit JAMAIS pouvoir être confondu avec un
   * succès complet. C'est l'exigence explicite du P0-B — afficher « Coordonnées
   * enregistrées » ou « Toutes les modifications ont été enregistrées » sur un résultat
   * partiel ferait croire que l'élément en échec est réglé, alors qu'il reste sale.
   */
  assert.doesNotMatch(message, /Coordonnées enregistrées/);
  assert.doesNotMatch(message, /Toutes les modifications ont été enregistrées/);
});

test('sauvegarde partielle avec un 409/STALE_WRITE : le conflit de révision est nommé explicitement', () => {
  const result = { status:'partial', saved:['r1'], failed:[{ id:'r2', code:'STALE_WRITE', status:409 }], pending:['r2'] };
  const { message } = describeCoordinateSaveOutcome(result);
  assert.match(message, /[Cc]onflit de révision/, 'un 409/STALE_WRITE doit être nommé comme un conflit de révision');
});

/*
 * LE DÉFAUT RELEVÉ EN REVUE INDÉPENDANTE, AVANT CE CORRECTIF : TOUT refus, quelle qu'en
 * soit la cause, était nommé « en conflit » dans le compte principal — y compris un 422 de
 * validation, qui n'a rien d'un conflit de révision. Le mot « conflit » ne doit donc
 * apparaître NULLE PART dans le message quand aucun refus n'en est un : ni dans le compte,
 * ni ailleurs. L'ancienne suite ne vérifiait que l'absence du mot « révision » — elle ne
 * voyait donc pas « en conflit » comme un compte, et n'aurait pas attrapé ce défaut.
 */
test('sauvegarde partielle avec un échec qui n’est PAS un conflit de révision : « en échec », jamais « conflit »', () => {
  const result = { status:'partial', saved:['r1'], failed:[{ id:'r2', code:'VALIDATION', status:422 }], pending:['r2'] };
  const { message } = describeCoordinateSaveOutcome(result);
  assert.match(message, /1 en échec/, 'un refus non-révision doit être compté sous un mot neutre, « en échec »');
  assert.doesNotMatch(message, /révision/, 'un 422 de validation n’est pas un conflit de révision : ne pas l’affirmer à tort');
  assert.doesNotMatch(message, /conflit/i, 'et le mot « conflit » ne doit apparaître NULLE PART pour un refus qui n’en est pas un');
});

test('sauvegarde partielle avec un mélange conflit + échec ordinaire : compte neutre, une seule mention de conflit', () => {
  const result = {
    status:'partial', saved:['r1'],
    failed:[{ id:'r2', code:'STALE_WRITE', status:409 }, { id:'r3', code:'VALIDATION', status:422 }],
    pending:['r2', 'r3']
  };
  const { message } = describeCoordinateSaveOutcome(result);
  // Le compte principal reste neutre et EXACT : deux refus au total, quelle qu'en soit la
  // nature — jamais « 2 en conflit », qui affirmerait à tort que le 422 en est un.
  assert.match(message, /2 en échec/);
  assert.doesNotMatch(message, /en conflit/);
  // La présence d'AU MOINS un conflit de révision reste dite, une seule fois.
  assert.equal((message.match(/révision/g) || []).length, 1);
});

test('échec total : jamais un libellé de succès, et le compte en attente est nommé', () => {
  const result = { status:'failed', saved:[], failed:[{ id:'r1', code:'HTTP_503', status:503 }], pending:['r1'] };
  const { level, message } = describeCoordinateSaveOutcome(result);
  assert.equal(level, 'error');
  assert.match(message, /1 élément\(s\) restent en attente/);
  assert.doesNotMatch(message, /Coordonnées enregistrées/);
  assert.doesNotMatch(message, /Toutes les modifications ont été enregistrées/);
});

test('échec total avec conflit de révision : nommé comme tel, toujours sans libellé de succès', () => {
  const result = { status:'failed', saved:[], failed:[{ id:'r1', code:'STALE_WRITE', status:409 }], pending:['r1'] };
  const { message } = describeCoordinateSaveOutcome(result);
  assert.match(message, /[Cc]onflit de révision/);
  assert.doesNotMatch(message, /Coordonnées enregistrées/);
});
