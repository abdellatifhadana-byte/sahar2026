import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * #137 — LES VALEURS D'INSTALLATION ONT CHANGÉ D'ADRESSE.
 *
 * Elles vivent sous `scripts/private-operational-data/`, que le serveur ne sert pas. Node y
 * accède, HTTP non. Les assertions de contenu lisent donc là ; celles qui portent sur
 * l'écran continuent de lire l'écran.
 */
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const media = read('equipment-media.js');
const topology = read('scripts/private-operational-data/grille-centrale.js');
const topologyEcran = read('grille-centrale-topology.js');
const { buildGrilleCentraleTopologySeed } = await import('../scripts/private-operational-data/grille-centrale.js');
const routerSeed = buildGrilleCentraleTopologySeed().router;
const signalFlow = read('signal-flow.js');
const index = read('index.html');
const worker = read('service-worker.js');

const pos = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `${token} doit être présent`);
  return value;
};

test('la Fiche 360 ne dépend plus de la course data-equipment-id pour afficher Photos & média', () => {
  assert.match(media, /async function equipmentFor360\(modal\)/);
  assert.match(media, /modal\?\.querySelector\('\.ops-modal-head > div > div'\)/);
  assert.match(media, /matches\.length === 1 \? matches\[0\] : null/);
  assert.match(media, /modal\.dataset\.equipmentId = String\(equipment\.id\)/);
  assert.match(media, /schedule360Enhancement\(complete\)/);
  assert.match(media, /setTimeout\(\(\) => enhance360Media\(modal\).*80\)/);
  assert.match(media, /setTimeout\(\(\) => enhance360Media\(modal\).*450\)/);
});

test('la Fiche 360 affiche toutes les familles média même si officiel et candidat coexistent', () => {
  assert.match(media, /Photos réelles 2M/);
  assert.match(media, /Photos constructeur du modèle/);
  assert.match(media, /Visuels externes candidats/);
  assert.match(media, /return real \+ official \+ candidates \+ missing/);
  assert.match(media, /media\.officials\.map/);
  assert.match(media, /media\.candidates\.map/);
  assert.match(media, /enhance360:enhance360Media/);
});

test('la page Flux de signal & grille centrale est bien le domaine topologique de la Grille Centrale', () => {
  assert.match(signalFlow, /Flux de signal & grille centrale/);
  assert.match(signalFlow, /Grilles matricielles distinctes/);
  assert.match(signalFlow, /Entrées\s*\/\s*sorties de grille/);
  assert.match(signalFlow, /Crosspoints documentés/);
  assert.match(signalFlow, /Monitoring, Sync\/Ref et contrôle/);
});

test('la Grille Centrale 190x184 devient un routeur topologique lié à son équipement', () => {
  assert.match(topologyEcran, /GRILLE_CENTRALE_ROUTER_ID = 'router-gc190x184'/);
  // La capacité se DÉRIVE des invariants au lieu d'être écrite deux fois : on la vérifie sur
  // la fiche réellement produite (#137).
  assert.equal(routerSeed.inputCapacity, 190);
  assert.equal(routerSeed.outputCapacity, 184);
  assert.match(topologyEcran, /routerEquipmentId:equipment\?\.id \?\? null/);
  assert.match(topology, /matrixLabel:'190 × 184 — synoptique interne 2M'/);
  assert.match(topology, /distinctFrom:\['GRILLE72 72×72 \/ Imagine Platinum VX'\]/);
  assert.match(topology, /manufacturer:'Harris Broadcast — candidat historique'/);
  assert.match(topology, /model:'Platinum — famille candidate, châssis exact à confirmer'/);
});

test('la topologie seed uniquement les interfaces documentées et refuse d’inventer les crosspoints', () => {
  for (const token of ['SYNCH 1','SYNCH 2','SYNCH 3','SYNCH 4','XY-1','XY-2','ENET-1','ENET-2','SERIAL 1','SERIAL 2','MONITORING/OUT.1','MONITORING/OUT.2','CTRL-BAIE3','CTRL-STC 1','CTRL-STC 2']) {
    assert.ok(topology.includes(token), `${token} doit être seedé`);
  }
  assert.match(topology, /aucun crosspoint actif n’est créé ou déduit/i);
  assert.match(topologyEcran, /aucune entrée ni sortie de la matrice n’est créée/);
  assert.doesNotMatch(topologyEcran, /TOPOLOGY_KINDS\.CROSSPOINT,\s*\{/);
  assert.doesNotMatch(topology, /TOPOLOGY_KINDS\.ROUTER_PORT,\s*\{/);
});

test('la Fiche 360 Grille Centrale expose sa relation avec le même modèle de topologie', () => {
  assert.match(topologyEcran, /Flux de signal & grille centrale/);
  assert.match(topologyEcran, /Cette fiche est liée au même modèle de topologie/);
  assert.match(topologyEcran, /Interfaces documentées/);
  assert.match(topologyEcran, /Crosspoints documentés/);
  assert.match(topologyEcran, /aucun état actif déduit/);
  assert.match(topologyEcran, /grilleTopologyEnhanced/);
  // Et le panneau ne se dessine plus sans autorisation : l'invariant que #137 ajoute.
  assert.match(topologyEcran, /if \(!ensured\.authorized\) return false;/);
});

test('le module topologique est chargé après la connaissance Grille Centrale et mis en cache PWA', () => {
  const knowledge = pos(index, 'src="grille-centrale-knowledge.js"');
  const topologyPos = pos(index, 'src="grille-centrale-topology.js"');
  const linkage = pos(index, 'src="equipment-media-linkage.js"');
  assert.ok(knowledge < topologyPos && topologyPos < linkage);
  assert.ok(worker.includes("'/grille-centrale-topology.js'"));
});
