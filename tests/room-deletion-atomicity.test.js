import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deletion = fs.readFileSync(new URL('../room-deletion.js', import.meta.url), 'utf8');

// Piège C-07. La cascade de suppression d'une salle est une suite d'écritures
// indépendantes : IndexedDB ouvre une transaction par suppression et chacune part ensuite
// au serveur séparément. Aucune transaction ne les englobe, et aucune ne le peut depuis le
// navigateur. Un refus à mi-parcours — le serveur oppose un 409 sur un équipement qu'un
// schéma référence — laissait câbles, écrans et murs définitivement supprimés, la salle
// toujours là, et son contenu amputé sans trace de ce qui manquait.

test('tout ce qui peut être su à l’avance bloque avant la première suppression', () => {
  assert.match(deletion, /const blockers = \[\];/);
  assert.match(deletion, /error\.code = 'ROOM_HAS_PROTECTED_DEPENDENCIES';/);
  // Le refus doit dire explicitement que rien n'a été touché.
  assert.match(deletion, /Suppression impossible, rien n’a été supprimé/);

  // La prévalidation doit précéder toute suppression réelle.
  const prevalidation = deletion.indexOf("error.code = 'ROOM_HAS_PROTECTED_DEPENDENCIES';");
  const premièreSuppression = deletion.indexOf('await this.deleteScreenSafely(screen.id)');
  assert.ok(prevalidation > 0 && premièreSuppression > 0);
  assert.ok(prevalidation < premièreSuppression, 'la prévalidation doit courir avant la cascade');
});

test('les mêmes dépendances que celles opposées par le serveur sont éprouvées', () => {
  // `ensureResourceDeletable` refuse sur document technique et demande ouverte : les
  // vérifier côté client transforme un échec à mi-parcours en refus propre.
  assert.match(deletion, /referencedByDocument/);
  assert.match(deletion, /hasOpenTicket/);
  assert.match(deletion, /node\.entityRef\?\.type === type/);
  assert.match(deletion, /\['sourceEquipmentId','destinationEquipmentId','routerEquipmentId'\]/);
  // Les quatre familles d'entités de la salle sont couvertes, plus la salle elle-même.
  assert.match(deletion, /\[\['equipment', deps\.equipments\], \['screen', deps\.screens\], \['baie', deps\.baies\], \['wall', deps\.walls\]\]/);
  assert.match(deletion, /referencedByDocument\('room', id\)/);
});

test('une interruption imprévisible rapporte l’état exact au lieu de le laisser deviner', () => {
  assert.match(deletion, /error\.code = 'ROOM_DELETION_INTERRUPTED';/);
  assert.match(deletion, /error\.removed = \{/);
  assert.match(deletion, /error\.remaining = left;/);
  assert.match(deletion, /error\.cause = cause;/, 'la cause première doit rester lisible');
  // Le message doit nommer ce qui a été retiré ET ce qui reste, pour permettre la reprise.
  assert.match(deletion, /Déjà retiré : \$\{removed\.screens\.length\}/);
  assert.match(deletion, /existe toujours et contient encore/);
});

test('la cascade reste dans l’ordre relationnel et n’avale aucune erreur', () => {
  const ordre = ['deleteScreenSafely', "_deleteRaw('walls'", 'deleteEquipmentSafely', 'deleteBaieSafely', "_deleteRaw('rooms'"];
  let position = deletion.indexOf('  try {\n    for (const screen of deps.screens)');
  assert.ok(position > 0, 'la cascade doit être enveloppée dans un try');
  for (const étape of ordre) {
    const suivant = deletion.indexOf(étape, position);
    assert.ok(suivant > 0, `étape manquante : ${étape}`);
    position = suivant;
  }
  assert.doesNotMatch(deletion, /catch \(cause\) \{[\s\S]{0,120}return \{/,
    'une interruption ne doit jamais être présentée comme une suppression réussie');
});
