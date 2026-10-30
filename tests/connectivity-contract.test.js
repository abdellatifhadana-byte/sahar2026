import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePort, normalizeCableRecord, cableAllowsReverse, evaluateConnection, validateCableShape,
  validateEquipmentConnectivity, validateSignalModeForPorts, isCableActive, CABLE_TYPES, PATH_ROLE_COLORS
} from '../connectivity-contract.js';

test('connectivité: centralise le catalogue historique sans supprimer les libellés actifs', () => {
  assert.ok(CABLE_TYPES['Vidéo'].includes('3G-SDI'));
  const port = normalizePort({ id:'p1', number:'OUT 1', type:'3G-SDI', direction:'OUT' });
  assert.deepEqual(port.connectorTypes, ['BNC']);
  assert.ok(port.protocols.includes('SDI'));
  assert.ok(port.formatCapabilities.includes('3G-SDI'));
  assert.deepEqual(port.formats, [], 'la capacité générique ne doit pas inventer le format actif');
});

test('connectivité: refuse une liaison directe PC USB vers XDCAM SDI', () => {
  const result = evaluateConnection({
    sourcePort:{ id:'usb', number:'USB', type:'USB', direction:'OUT' },
    destinationPort:{ id:'sdi', number:'SDI IN', type:'BNC / SDI', direction:'IN' },
    cable:{ category:'Vidéo', type:'SDI' }
  });
  assert.equal(result.status, 'incompatible');
});

test('connectivité: accepte un PC équipé d’une vraie carte SDI documentée', () => {
  const result = evaluateConnection({
    sourcePort:{ id:'card-out', number:'SDI OUT', type:'3G-SDI', direction:'OUT', formats:['3G-SDI'] },
    destinationPort:{ id:'deck-in', number:'SDI IN', type:'3G-SDI', direction:'IN', formats:['3G-SDI'] },
    cable:{ category:'Vidéo', type:'3G-SDI', pathRole:'PROGRAM' }
  });
  assert.equal(result.status, 'compatible');
  assert.equal(result.direct, true);
});

test('connectivité: exige de documenter le transceiver entre cage SFP et fibre LC', () => {
  const result = evaluateConnection({
    sourcePort:{ id:'sfp', number:'SFP 1', type:'SFP / SFP+', direction:'OUT' },
    destinationPort:{ id:'lc', number:'LC 1', type:'Fibre LC', direction:'IN' },
    cable:{ category:'Fibre optique', type:'Monomode LC-LC' }
  });
  assert.equal(result.status, 'to-confirm');
  assert.match(result.reasons.join(' '), /SFP|transceiver/i);
});

test('connectivité: les libellés AES ambigus restent à confirmer', () => {
  const result = evaluateConnection({
    sourcePort:{ id:'a', number:'AES OUT', type:'AES/EBU', direction:'OUT' },
    destinationPort:{ id:'b', number:'AES IN', type:'AES/EBU', direction:'IN' },
    cable:{ category:'Audio', type:'AES/EBU' }
  });
  assert.equal(result.status, 'to-confirm');
});

test('connectivité: bloque les identifiants et numéros de ports dupliqués', () => {
  const checked = validateEquipmentConnectivity({
    id:'eq-1',
    ports:[
      { id:'same', number:'1', type:'BNC / SDI', direction:'IN' },
      { id:'same', number:'1', type:'BNC / SDI', direction:'OUT' }
    ],
    components:[]
  });
  assert.ok(checked.errors.some(message => /dupliqué/i.test(message)));
});

test('connectivité: contrôle la hiérarchie des composants internes', () => {
  const checked = validateEquipmentConnectivity({
    id:'eq-1', ports:[],
    components:[{ id:'card-1', name:'Carte SDI', parentComponentId:'missing', ports:[] }]
  });
  assert.ok(checked.errors.some(message => /parent.*introuvable/i.test(message)));
});

test('connectivité: normalise rôle et couleurs sans confondre couleur physique et métier', () => {
  const record = normalizeCableRecord({
    id:'c1', reference:'GR1', category:'Vidéo', type:'SDI', pathRole:'BACKUP', physicalColor:'bleu',
    sourceType:'equipment', sourceId:'a', sourcePortId:'p1', destinationType:'equipment', destinationId:'b', destinationPortId:'p2'
  });
  assert.equal(record.diagramColor, PATH_ROLE_COLORS.BACKUP);
  assert.equal(record.physicalColor, 'bleu');
  assert.equal(validateCableShape(record).errors.length, 0);
});

test('connectivité: un câble direct ne peut être inversé sans mode de brassage explicite', () => {
  assert.equal(cableAllowsReverse({ signalMode:'DIRECT' }), false);
  assert.equal(cableAllowsReverse({ signalMode:'MANUAL_PATCH' }), true);
  assert.equal(cableAllowsReverse({ signalMode:'BIDIRECTIONAL' }), true);
  assert.ok(validateCableShape({
    id:'bad-mode', reference:'BAD', category:'Vidéo', type:'SDI', signalMode:'CLIENT_BYPASS',
    sourceType:'equipment', sourceId:'a', sourcePortId:'p1', destinationType:'equipment', destinationId:'b', destinationPortId:'p2'
  }).errors.some(message => /mode du signal/i.test(message)));
});

test('connectivité: le client ne peut pas désactiver la contrainte d’occupation', () => {
  const port = normalizePort({ id:'out', number:'OUT', type:'3G-SDI', direction:'OUT', allowMultipleConnections:true });
  assert.equal(port.allowMultipleConnections, false);
});

test('connectivité: le contrat de port supprime les champs arbitraires et borne les valeurs', () => {
  const port = normalizePort({
    id:'out', number:'OUT', type:'3G-SDI', direction:'OUT', opaqueHugeField:'x'.repeat(20_000),
    notes:'n'.repeat(5_000), protocols:Array.from({ length:100 }, (_, index) => `proto-${index}`)
  });
  assert.equal(port.opaqueHugeField, undefined);
  assert.equal(port.notes.length, 1_000);
  assert.equal(port.protocols.length, 64);
});

test('connectivité: BIDIRECTIONAL exige deux terminaisons réellement réversibles', () => {
  const fixedErrors = validateSignalModeForPorts(
    { signalMode:'BIDIRECTIONAL' },
    { id:'out', type:'3G-SDI', direction:'OUT', behavior:'fixed' },
    { id:'in', type:'3G-SDI', direction:'IN', behavior:'fixed' }
  );
  assert.ok(fixedErrors.some(message => /BIDIRECTIONAL/i.test(message)));
  assert.deepEqual(validateSignalModeForPorts(
    { signalMode:'BIDIRECTIONAL' },
    { id:'a', type:'BNC / SDI', direction:'IN/OUT', behavior:'patchable' },
    { id:'b', type:'BNC / SDI', direction:'IN/OUT', behavior:'patchable' }
  ), []);
});

test('connectivité: la quarantaine est inactive et ne peut pas former une liaison réelle', () => {
  assert.equal(isCableActive({ status:'Connecté', integrityState:'quarantined' }), false);
  assert.equal(isCableActive({ status:'Retiré' }), false);
  assert.equal(isCableActive({ status:'Connecté' }), true);
});

test('connectivité: une capacité 12G vers HD ne prouve pas le format actif', () => {
  const result = evaluateConnection({
    sourcePort:{ id:'out', number:'OUT', type:'12G-SDI', direction:'OUT' },
    destinationPort:{ id:'in', number:'IN', type:'HD-SDI', direction:'IN' },
    cable:{ category:'Vidéo', type:'HD-SDI' }
  });
  assert.equal(result.status, 'to-confirm');
  assert.match(result.reasons.join(' '), /format actif/i);
});
