import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';

async function request(path, { method = 'GET', cookie = '', body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.equal(response.status, expected, `${method} ${path}: attendu ${expected}, reçu ${response.status} ${text}`);
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function login(username, password) {
  const { payload, cookie } = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.ok(cookie.startsWith('tp_session='), 'cookie de session absent');
  return { user: payload.user, cookie };
}

const health = await request('/api/health');
assert.equal(health.payload.database, 'postgresql');
assert.equal(health.payload.zoneAccess, true);

const admin = await login(adminUsername, adminPassword);
assert.equal(admin.user.role, 'admin');

await request('/api/access/zones', { method: 'POST', cookie: admin.cookie, body: { id: 'stc', name: 'STC', publicSummary: 'Salle technique centrale' } });
await request('/api/access/zones', { method: 'POST', cookie: admin.cookie, body: { id: 'rf1', name: 'Régie Finale RF1', publicSummary: 'Régie finale' } });
await request('/api/data/rooms/1', { method: 'PUT', cookie: admin.cookie, body: { id: 1, name: 'STC' } });
await request('/api/data/rooms/2', { method: 'PUT', cookie: admin.cookie, body: { id: 2, name: 'Régie Finale RF1' } });
await request('/api/access/resource-zones', { method: 'POST', cookie: admin.cookie, body: { resourceType: 'room', resourceId: 1, zoneId: 'stc' } });
await request('/api/access/resource-zones', { method: 'POST', cookie: admin.cookie, body: { resourceType: 'room', resourceId: 2, zoneId: 'rf1' } });

await request('/api/data/equipments/10', { method: 'PUT', cookie: admin.cookie, body: { id: 10, name: 'Ultrix STC', roomId: 1, ports: [{ id: 'OUT1', number:'OUT1', direction: 'OUT', type: 'BNC / SDI', allowMultipleConnections:true, opaqueHugeField:'x'.repeat(20_000) }] } });
await request('/api/data/equipments/20', { method: 'PUT', cookie: admin.cookie, body: { id: 20, name: 'MC1 RF1 principal', roomId: 2, ports: [{ id: 'IN1', number:'IN1', direction: 'IN', type: 'BNC / SDI' }] } });
await request('/api/data/equipments/21', { method: 'PUT', cookie: admin.cookie, body: { id: 21, name: 'MC1 RF1 secours', roomId: 2, ports: [{ id: 'IN1-S', number:'IN1-S', direction: 'IN', type: 'BNC / SDI' }] } });
await request('/api/data/equipments/11', { method:'PUT', cookie:admin.cookie, body:{ id:11, name:'Source STC composant E2E', roomId:1, ports:[{ id:'OUT-COMP', number:'OUT-COMP', direction:'OUT', type:'BNC / SDI' }] } });
await request('/api/data/equipments/22', { method:'PUT', cookie:admin.cookie, body:{ id:22, name:'Châssis RF1 E2E', roomId:2, components:[{ id:'card22', name:'Carte SDI RF1', ports:[{ id:'IN-COMP', number:'IN-COMP', direction:'IN', type:'BNC / SDI' }] }] } });
await request('/api/data/cables/E2E-C1', { method: 'PUT', cookie: admin.cookie, body: {
  id: 'E2E-C1', category:'Vidéo', type: 'SDI', sourceType: 'equipment', sourceId: 10, sourcePortId: 'OUT1',
  destinationType: 'equipment', destinationId: 20, destinationPortId: 'IN1', status: 'ok'
} });
await request('/api/data/cables/E2E-COMP', { method:'PUT', cookie:admin.cookie, body:{
  id:'E2E-COMP', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:11, sourcePortId:'OUT-COMP',
  destinationType:'component', destinationId:'card22', destinationComponentId:'card22', destinationParentEquipmentId:22,
  destinationEquipmentId:22, destinationPortId:'IN-COMP', status:'Connecté'
} });
await request('/api/data/cables/E2E-C2', { method:'PUT', cookie:admin.cookie, expected:409, body:{
  id:'E2E-C2', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:10, sourcePortId:'OUT1',
  destinationType:'equipment', destinationId:21, destinationPortId:'IN1-S', status:'Connecté'
} });
const quarantinedBypass = await request('/api/data/cables/E2E-C3', { method:'PUT', cookie:admin.cookie, expected:409, body:{
  id:'E2E-C3', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:10, sourcePortId:'OUT1',
  destinationType:'equipment', destinationId:21, destinationPortId:'IN1-S', status:'Connecté',
  integrityState:'quarantined', integrityErrorCode:'CLIENT_BYPASS', integrityIssues:['ignore occupancy'], originalStatus:'Connecté'
} });
assert.equal(quarantinedBypass.payload.error, 'PORT_ALREADY_CONNECTED');
const invalidBidirectional = await request('/api/data/cables/E2E-C-BIDIRECTIONAL', { method:'PUT', cookie:admin.cookie, expected:400, body:{
  id:'E2E-C-BIDIRECTIONAL', category:'Vidéo', type:'SDI', signalMode:'BIDIRECTIONAL',
  sourceType:'equipment', sourceId:10, sourcePortId:'OUT1', destinationType:'equipment', destinationId:21,
  destinationPortId:'IN1-S', status:'Connecté'
} });
assert.equal(invalidBidirectional.payload.error, 'INVALID_SIGNAL_MODE_FOR_PORTS');
await request('/api/data/docs/diagram-cross-zone-private', { method:'PUT', cookie:admin.cookie, body:{
  id:'diagram-cross-zone-private', kind:'technical_diagram', title:'Détails STC / RF1 protégés', diagramType:'signal-synoptic',
  status:'draft', zoneIds:['stc','rf1'],
  nodes:[
    { id:'stc-node', type:'entity', entityRef:{ type:'equipment', id:10 } },
    { id:'rf1-node', type:'entity', entityRef:{ type:'equipment', id:20 } }
  ], edges:[{
    id:'protected-edge', type:'logical-signal', sourceNodeId:'stc-node', destinationNodeId:'rf1-node',
    sourcePortId:'OUT1', destinationPortId:'IN1', label:'Vers MC1 RF1 principal', description:'Port privé IN1'
  }]
} });

const techPassword = 'Tech-STC-Verrou-2026!';
await request('/api/data/users/2', { method: 'PUT', cookie: admin.cookie, body: {
  id: 2, username: 'tech.stc', fullName: 'Technicien STC', role: 'technician', status: 'active',
  password: Buffer.from(techPassword, 'utf8').toString('base64')
} });

const tech = await login('tech.stc', techPassword);
let sync = await request('/api/sync', { cookie: tech.cookie });
assert.equal(sync.payload.data?.users, undefined, 'un technicien ne doit jamais recevoir users');
assert.equal(sync.payload.data?.equipments, undefined, 'aucun détail technique avant grant');

await request('/api/access/memberships', { method: 'POST', cookie: admin.cookie, body: { userId: 2, zoneId: 'stc', responsible: false } });
for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit', 'cable.read', 'cable.edit', 'diagram.read', 'ticket.read', 'ticket.create', 'diagnostic.run']) {
  await request('/api/access/grants', { method: 'POST', cookie: admin.cookie, body: { userId: 2, zoneId: 'stc', permission } });
}

sync = await request('/api/sync', { cookie: tech.cookie });
assert.ok(sync.payload.data.rooms?.some(room => String(room.id) === '1'), 'STC doit être visible après grant');
assert.ok(!sync.payload.data.rooms?.some(room => String(room.id) === '2'), 'RF1 détaillée ne doit pas être visible');
assert.ok(sync.payload.data.equipments?.some(eq => String(eq.id) === '10'), 'équipement STC attendu');
assert.ok(!sync.payload.data.equipments?.some(eq => String(eq.id) === '20'), 'équipement RF1 protégé ne doit pas être envoyé');
assert.ok(!sync.payload.data.docs?.some(doc => doc.id === 'diagram-cross-zone-private'), 'un schéma détaillé interzone exige les droits sur toutes ses zones');

/*
 * LE PLAFOND DE RÔLE EST DÉSORMAIS LA PREMIÈRE QUESTION POSÉE.
 *
 * Une habilitation de zone DÉLÈGUE un pouvoir à l'intérieur d'un périmètre ; elle n'ÉLÈVE
 * pas le rôle qui la reçoit. Le technicien porte `equipment.edit` sur « stc », mais la
 * matrice canonique lui déclare `equipments.edit:false` et `equipments.delete:false` : il
 * est donc refusé AVANT toute lecture de dépendances, et le refus le dit — refus de rôle,
 * pas refus de zone.
 *
 * Cette épreuve attendait auparavant 409 sur ces deux requêtes. Ce qu'elle protégeait
 * réellement, c'est que le refus ne LAISSE PAS FUIR le titre ni l'identifiant d'un schéma
 * hors périmètre. Cette propriété est désormais satisfaite plus tôt et plus fortement : un
 * refus qui n'a consulté aucune dépendance ne peut en décrire aucune. Les assertions
 * d'absence de fuite sont CONSERVÉES, et tomberaient si le refus se remettait à décrire
 * ce qu'il a vu.
 */
const techRetention = await request('/api/data/equipments/10', { method:'PUT', cookie:tech.cookie, expected:403, body:{ id:10, name:'Ultrix STC', roomId:1, ports:[] } });
assert.equal(techRetention.payload.error, 'ROLE_ACTION_FORBIDDEN',
  'un refus de matrice de rôle ne doit pas se présenter comme un refus de zone');
assert.ok(!JSON.stringify(techRetention.payload).includes('Détails STC / RF1 protégés'), 'le titre du schéma hors périmètre ne doit pas apparaître dans la validation');
assert.ok(!JSON.stringify(techRetention.payload).includes('diagram-cross-zone-private'), 'l’identifiant du schéma hors périmètre ne doit pas apparaître dans la validation');

const techDeletion = await request('/api/data/equipments/10', { method:'DELETE', cookie:tech.cookie, expected:403 });
assert.equal(techDeletion.payload.error, 'ROLE_ACTION_FORBIDDEN');
assert.ok(!JSON.stringify(techDeletion.payload).includes('Détails STC / RF1 protégés'), 'le titre du schéma hors périmètre ne doit pas apparaître dans la suppression');
assert.ok(!JSON.stringify(techDeletion.payload).includes('diagram-cross-zone-private'), 'l’identifiant du schéma hors périmètre ne doit pas apparaître dans la suppression');

/*
 * LA VALIDATION MÉTIER RESTE VÉRIFIÉE — PAR UN RÔLE QUI L'ATTEINT VRAIMENT.
 *
 * Durcir la suppression sans replacer cette épreuve ferait disparaître du dépôt toute
 * vérification du chemin « conflit de dépendances SANS fuite ». On la déplace donc vers un
 * rôle À PÉRIMÈTRE que la matrice autorise réellement à éditer un équipement : le
 * Responsable (`equipments.edit:true`), membre de « stc » seulement — il ne voit donc pas
 * « rf1 », et la fuite éventuelle resterait une fuite pour lui.
 *
 * Aucune permission n'est inventée pour l'occasion : on utilise un rôle canonique existant,
 * avec les habilitations qu'un administrateur peut réellement lui accorder.
 */
const respPassword = 'Resp-STC-Verrou-2026!';
// Identifiant 4, et non 3 : l'épreuve réutilise `users/3` plus bas pour un Responsable de
// « rf1 ». Partager l'identifiant y transporterait l'adhésion « stc » posée ici, et
// l'oracle de référence protégée cesserait de mesurer ce qu'il prétend mesurer.
await request('/api/data/users/4', { method: 'PUT', cookie: admin.cookie, body: {
  id: 4, username: 'resp.stc', fullName: 'Responsable STC', role: 'responsible', status: 'active',
  password: Buffer.from(respPassword, 'utf8').toString('base64')
} });
const resp = await login('resp.stc', respPassword);
await request('/api/access/memberships', { method: 'POST', cookie: admin.cookie, body: { userId: 4, zoneId: 'stc', responsible: false } });
for (const permission of ['zone.summary.read', 'equipment.read', 'equipment.edit']) {
  await request('/api/access/grants', { method: 'POST', cookie: admin.cookie, body: { userId: 4, zoneId: 'stc', permission } });
}

const respRetention = await request('/api/data/equipments/10', { method:'PUT', cookie:resp.cookie, expected:409, body:{ id:10, name:'Ultrix STC', roomId:1, ports:[] } });
assert.equal(respRetention.payload.error, 'EQUIPMENT_CONNECTIVITY_IN_USE',
  'un rôle réellement autorisé doit atteindre la validation métier, pas être refusé plus tôt');
assert.ok(!JSON.stringify(respRetention.payload).includes('Détails STC / RF1 protégés'), 'le titre du schéma hors périmètre ne doit pas fuir vers un rôle à périmètre');
assert.ok(!JSON.stringify(respRetention.payload).includes('diagram-cross-zone-private'), 'l’identifiant du schéma hors périmètre ne doit pas fuir vers un rôle à périmètre');

/*
 * ET LA SUPPRESSION D'UN ÉQUIPEMENT ENCORE CÂBLÉ RESTE IMPOSSIBLE.
 *
 * Aucun rôle À PÉRIMÈTRE ne porte `equipments.delete` dans la matrice : le chemin
 * « 409 dépendances » n'est donc plus atteignable par un utilisateur restreint, et c'est
 * voulu. On ne fabrique pas une permission pour préserver l'ancienne épreuve — on vérifie
 * la garde de dépendances là où elle s'exerce encore.
 */
const dependanceAdmin = await request('/api/data/equipments/10', { method:'DELETE', cookie:admin.cookie, expected:409 });
assert.equal(dependanceAdmin.payload.error, 'RESOURCE_HAS_TECHNICAL_DEPENDENCIES',
  'un équipement porteur de dépendances techniques reste indestructible');

const cable = sync.payload.data.cables?.find(item => item.id === 'E2E-C1');
assert.ok(cable, 'la dépendance interzone doit rester visible comme relation');
assert.equal(cable.destinationId, undefined, 'ID destination protégée divulgué');
assert.equal(cable.destinationPortId, undefined, 'port destination protégé divulgué');
assert.equal(cable.destinationProtected?.relation, 'external-protected');
assert.equal(cable.destinationProtected?.zone?.id, 'rf1');
const componentCable = sync.payload.data.cables?.find(item => item.id === 'E2E-COMP');
assert.ok(componentCable, 'la dépendance interzone vers un composant doit rester visible comme relation');
assert.equal(componentCable.destinationId, undefined, 'ID composant protégé divulgué');
assert.equal(componentCable.destinationComponentId, undefined, 'alias composant protégé divulgué');
assert.equal(componentCable.destinationParentEquipmentId, undefined, 'parent du composant protégé divulgué');
assert.equal(componentCable.destinationPortId, undefined, 'port composant protégé divulgué');

await request('/api/data/equipments/20', { method: 'PUT', cookie: tech.cookie, expected: 403, body: { id: 20, name: 'Tentative interdite', roomId: 2 } });
await request('/api/data/equipments/20', { method: 'PUT', cookie: tech.cookie, expected: 403, body: { id: 20, name: 'Tentative de déplacement vers STC', roomId: 1 } });
await request('/api/data/cables/E2E-C1', { method: 'PUT', cookie: tech.cookie, expected: 403, body: {
  id:'E2E-C1', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:10, sourcePortId:'OUT1',
  destinationType:'equipment', destinationId:20, destinationPortId:'IN1', status:'modified'
} });

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LE PLAFOND DE RÔLE, EN CRÉATION, AUSSI TÔT QU'EN MODIFICATION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MESURÉ sur `PUT /api/data/cables/:id` AVANT correctif : la garde ci-dessus
 * (`ROLE_ACTION_FORBIDDEN` avant toute autre lecture) n'existait que pour la MODIFICATION
 * (`existing &&`-conditionnée). Une CRÉATION filait directement dans `normalizeIncomingCable`
 * puis `resolveIncomingCableRoute`, et son propre plafond de rôle n'arrivait qu'après —
 * cette dernière fonction ayant déjà répondu 400 `ROUTE_SCENE_INVALID` pour une scène
 * absente, ou 403 `ROUTE_SCENE_EDIT_FORBIDDEN` pour une scène réelle hors périmètre. Le
 * technicien — `equipments.create:false` dans la matrice canonique — apprenait ainsi si une
 * salle ou une baie qu'il ne peut même pas lire EXISTE, avant d'être refusé pour son rôle :
 * un oracle d'existence authentifié, ouvert à quiconque peut seulement se connecter et
 * composer un câble plausible.
 *
 * Les épreuves suivantes prouvent que la CRÉATION reçoit désormais EXACTEMENT le même refus,
 * au même endroit, que la MODIFICATION ci-dessus — quel que soit ce que la scène proposée
 * contient — tandis qu'un rôle réellement autorisé continue de recevoir le détail utile de
 * `resolveIncomingCableRoute`.
 */
await request('/api/data/equipments/40', { method: 'PUT', cookie: admin.cookie, body: {
  id: 40, name: 'FIX2 source STC', roomId: 1, ports: [{ id: 'FIX2-OUT', number: 'FIX2-OUT', direction: 'OUT', type: 'BNC / SDI' }]
} });
await request('/api/data/equipments/41', { method: 'PUT', cookie: admin.cookie, body: {
  id: 41, name: 'FIX2 destination STC', roomId: 1, ports: [{ id: 'FIX2-IN', number: 'FIX2-IN', direction: 'IN', type: 'BNC / SDI' }]
} });
const routeCorpsCable = (id, sceneId) => ({
  id, category: 'Vidéo', type: 'SDI', status: 'Connecté',
  sourceType: 'equipment', sourceId: 40, sourcePortId: 'FIX2-OUT',
  destinationType: 'equipment', destinationId: 41, destinationPortId: 'FIX2-IN',
  route: { version: 1, status: 'proposed', segments: [{
    sceneType: 'room', sceneId, naturalWidth: 2000, naturalHeight: 1200,
    waypoints: [{ x: 10, y: 10 }, { x: 20, y: 20 }], anchors: []
  }] }
});
const INEXISTANTE = 999999; // aucune salle ni baie ne porte cet identifiant.
const PROTEGEE = 2; // RF1 : réelle, mais hors du périmètre de « tech.stc ».

// 1 · scène INEXISTANTE, rôle SANS plafond de création : refusé par le RÔLE, pas par la donnée.
const techCreateInexistante = await request('/api/data/cables/FIX2-C-NEW', { method: 'PUT', cookie: tech.cookie, expected: 403,
  body: routeCorpsCable('FIX2-C-NEW', INEXISTANTE) });
assert.equal(techCreateInexistante.payload.error, 'ROLE_ACTION_FORBIDDEN',
  'une création par un rôle sans plafond doit être refusée par le rôle, jamais par ROUTE_SCENE_INVALID');

// 2 · scène RÉELLE PROTÉGÉE, MÊME rôle : le MÊME refus, au caractère près.
const techCreateProtegee = await request('/api/data/cables/FIX2-C-NEW', { method: 'PUT', cookie: tech.cookie, expected: 403,
  body: routeCorpsCable('FIX2-C-NEW', PROTEGEE) });
assert.equal(techCreateProtegee.payload.error, 'ROLE_ACTION_FORBIDDEN',
  'la même création vers une scène réelle mais protégée doit recevoir le même refus de rôle');

// 3 · L'ORACLE EST FERMÉ : les deux refus sont indiscernables l'un de l'autre.
assert.deepEqual(techCreateInexistante.payload, techCreateProtegee.payload,
  'scène inexistante et scène réelle protégée doivent produire EXACTEMENT le même refus — aucune fuite d’existence');

// 4 · Le câble n'a JAMAIS existé : aucune des deux tentatives n'a rien écrit.
const syncApresTech = await request('/api/sync', { cookie: admin.cookie });
assert.ok(!syncApresTech.payload.data.cables?.some(item => item.id === 'FIX2-C-NEW'),
  'un refus de rôle ne doit laisser aucune trace du câble refusé');

// 5 · LA GÉNÉRALITÉ DE LA GARDE : un AUTRE magasin, la même règle. Un technicien ne crée pas
// de salle (`rooms.create:false`) ; il doit être refusé AVANT toute validation de salle.
const techCreateRoom = await request('/api/data/rooms/9999999', { method: 'PUT', cookie: tech.cookie, expected: 403,
  body: { id: 9999999, name: 'Salle FIX2 non autorisée' } });
assert.equal(techCreateRoom.payload.error, 'ROLE_ACTION_FORBIDDEN', 'la création de salle suit le même plafond de rôle, dès la création');

// 6 · PRÉSERVÉ : un rôle réellement autorisé à créer un câble reçoit toujours le détail utile
// d'une scène inexistante — le correctif ne doit rien retirer à qui y a droit.
const adminCreateInexistante = await request('/api/data/cables/FIX2-C-AUTORISE', { method: 'PUT', cookie: admin.cookie, expected: 400,
  body: routeCorpsCable('FIX2-C-AUTORISE', INEXISTANTE) });
assert.equal(adminCreateInexistante.payload.error, 'ROUTE_SCENE_INVALID',
  'un auteur autorisé conserve le détail exact d’une scène inexistante');

// 7 · PRÉSERVÉ : le chemin de création normal, pour un auteur autorisé, réussit toujours de
// bout en bout — le correctif ne bloque personne qui a réellement le droit de créer.
await request('/api/data/cables/FIX2-C-AUTORISE', { method: 'PUT', cookie: admin.cookie, expected: 200,
  body: routeCorpsCable('FIX2-C-AUTORISE', 1) });
const syncApresCreation = await request('/api/sync', { cookie: admin.cookie });
const cableCree = syncApresCreation.payload.data.cables?.find(item => item.id === 'FIX2-C-AUTORISE');
assert.equal(cableCree?.route?.status, 'proposed', 'un câble créé avec un tracé réel doit le conserver');
await request('/api/data/cables/FIX2-C-AUTORISE', { method: 'DELETE', cookie: admin.cookie });

const responsiblePassword = 'Resp-RF1-Verrou-2026!';
await request('/api/data/users/3', { method:'PUT', cookie:admin.cookie, body:{
  id:3, username:'resp.rf1', fullName:'Responsable RF1', role:'responsible', status:'active',
  password:Buffer.from(responsiblePassword, 'utf8').toString('base64')
} });
await request('/api/access/memberships', { method:'POST', cookie:admin.cookie, body:{ userId:3, zoneId:'rf1', responsible:true } });
for (const permission of ['equipment.read','cable.read','topology.read','continuity.read','continuity.edit','continuity.validate','continuity.test','diagram.read','diagram.edit','diagram.validate']) {
  await request('/api/access/grants', { method:'POST', cookie:admin.cookie, body:{ userId:3, zoneId:'rf1', permission } });
}
const responsible = await login('resp.rf1', responsiblePassword);

const spoofedAuthorDiagram = {
  id:'diagram-author-spoof', kind:'technical_diagram', title:'Test auteur serveur', diagramType:'signal-synoptic',
  status:'draft', zoneIds:['rf1'], authorId:admin.user.id,
  nodes:[{ id:'n1', type:'entity', entityRef:{ type:'equipment', id:20 } }], edges:[]
};
await request('/api/data/docs/diagram-author-spoof', { method:'PUT', cookie:responsible.cookie, body:spoofedAuthorDiagram });
await request('/api/diagrams/diagram-author-spoof/validate', { method:'POST', cookie:responsible.cookie, body:{}, expected:409 });
await request('/api/data/docs/diagram-author-spoof', { method:'DELETE', cookie:responsible.cookie });

const protectionGroup = {
  id:'continuity-rf1', kind:'continuity_protection_group', name:'RF1 Principal / Secours', serviceName:'Diffusion RF1',
  protectionType:'dedicated-device', status:'draft', verificationStatus:'documented', zoneIds:['rf1'], authorId:admin.user.id,
  primaryPath:{ label:'RF1 principal', availability:'available', entityRefs:[{ type:'equipment', id:20, role:'PRIMARY', verificationStatus:'documented', sourceRef:'E2E' }] },
  backupPaths:[{ label:'RF1 secours', availability:'available', pathRole:'BACKUP', entityRefs:[{ type:'equipment', id:21, role:'BACKUP', verificationStatus:'documented', sourceRef:'E2E' }] }],
  sourceRefs:['E2E RF1 schema']
};
await request('/api/data/docs/continuity-rf1', { method:'PUT', cookie:admin.cookie, body:protectionGroup });
await request('/api/continuity/continuity-rf1/validate', { method:'POST', cookie:admin.cookie, body:{}, expected:409 });
await request('/api/continuity/continuity-rf1/validate', { method:'POST', cookie:responsible.cookie, body:{} });
await request('/api/data/docs/continuity-rf1', { method:'PUT', cookie:admin.cookie, expected:409, body:{ ...protectionGroup, notes:'Tentative de modification après validation' } });

const procedure = {
  id:'procedure-rf1-backup', kind:'continuity_procedure', protectionGroupId:'continuity-rf1', title:'Passage RF1 vers secours',
  status:'draft', verificationStatus:'documented', zoneIds:['rf1'], authorId:admin.user.id, evidenceRefs:['E2E procedure'],
  steps:[
    { type:'secure', title:'Préparer', instruction:'Confirmer la disponibilité du secours.' },
    { type:'switch', title:'Basculer', instruction:'Exécuter la bascule RF1 autorisée.' },
    { type:'verify', title:'Vérifier', instruction:'Contrôler image, audio et monitoring.' }
  ]
};
await request('/api/data/docs/procedure-rf1-backup', { method:'PUT', cookie:admin.cookie, body:procedure });
await request('/api/continuity/procedure-rf1-backup/validate', { method:'POST', cookie:responsible.cookie, body:{} });
const continuityTest = await request('/api/continuity/continuity-rf1/tests', { method:'POST', cookie:responsible.cookie, expected:201, body:{
  procedureId:'procedure-rf1-backup', result:'passed', observations:'Image, audio et monitoring conformes.', restoredPrimary:true, measuredSwitchSeconds:42
} });
await request(`/api/continuity/${encodeURIComponent(continuityTest.payload.record.id)}/validate`, { method:'POST', cookie:responsible.cookie, body:{}, expected:409 });
await request(`/api/data/docs/${encodeURIComponent(continuityTest.payload.record.id)}`, { method:'DELETE', cookie:admin.cookie, expected:409 });
const retiredProcedure = await request('/api/data/docs/procedure-rf1-backup/retire', { method:'POST', cookie:responsible.cookie, body:{ reason:'Procédure remplacée après essai documenté' } });
assert.equal(retiredProcedure.payload.record.status, 'retired');
await request('/api/data/docs/procedure-rf1-backup', { method:'DELETE', cookie:admin.cookie, expected:409 });

const invalidCrossZoneDiagram = {
  id:'diagram-invalid-zone', kind:'technical_diagram', title:'Mauvais périmètre', diagramType:'signal-synoptic', status:'draft', zoneIds:['stc'], authorId:admin.user.id,
  nodes:[{ id:'n1', type:'entity', entityRef:{ type:'equipment', id:20 } }], edges:[]
};
await request('/api/data/docs/diagram-invalid-zone', { method:'PUT', cookie:admin.cookie, body:invalidCrossZoneDiagram, expected:400 });

const diagram = {
  id:'diagram-rf1-backup', kind:'technical_diagram', title:'RF1 Principal / Secours', diagramType:'signal-synoptic', status:'draft', zoneIds:['rf1'], authorId:admin.user.id,
  nodes:[
    { id:'n1', type:'entity', label:'RF1 principal', entityRef:{ type:'equipment', id:20 }, x:10, y:20 },
    { id:'n2', type:'entity', label:'RF1 secours', entityRef:{ type:'equipment', id:21 }, x:60, y:20 }
  ],
  edges:[{ id:'e1', type:'backup-relation', sourceNodeId:'n1', destinationNodeId:'n2', relationId:'continuity-rf1', pathRole:'BACKUP' }]
};
await request('/api/data/docs/diagram-rf1-backup', { method:'PUT', cookie:admin.cookie, body:diagram });
await request('/api/diagrams/diagram-rf1-backup/validate', { method:'POST', cookie:responsible.cookie, body:{} });
await request('/api/data/docs/diagram-rf1-backup', { method:'PUT', cookie:admin.cookie, expected:409, body:{ ...diagram, title:'Tentative de modification validée' } });
const diagramRevision = { ...diagram, id:'diagram-rf1-backup-r2', targetId:'diagram-rf1-backup-r2', status:'draft', validation:null, supersedesId:'diagram-rf1-backup', revision:'2', authorId:admin.user.id };
await request('/api/data/docs/diagram-rf1-backup-r2', { method:'PUT', cookie:admin.cookie, body:diagramRevision });
await request('/api/data/docs/diagram-rf1-backup-r2-concurrent', { method:'PUT', cookie:admin.cookie, expected:400, body:{ ...diagramRevision, id:'diagram-rf1-backup-r2-concurrent', targetId:'diagram-rf1-backup-r2-concurrent' } });
await request('/api/data/docs/diagram-invalid-relation', { method:'PUT', cookie:admin.cookie, expected:400, body:{
  ...diagram, id:'diagram-invalid-relation', title:'Relation non canonique',
  edges:[{ ...diagram.edges[0], relationId:'procedure-rf1-backup' }]
} });
await request('/api/data/equipments/21', { method:'DELETE', cookie:admin.cookie, expected:409 });
const directRetirement = await request('/api/data/docs/diagram-rf1-backup', { method:'PUT', cookie:responsible.cookie, expected:409, body:{ ...diagram, status:'retired' } });
assert.equal(directRetirement.payload.error, 'DEDICATED_DOCUMENT_RETIREMENT');
const retiredDiagram = await request('/api/data/docs/diagram-rf1-backup/retire', { method:'POST', cookie:responsible.cookie, body:{ reason:'Remplacé par une nouvelle révision contrôlée' } });
assert.equal(retiredDiagram.payload.record.status, 'retired');
assert.equal(retiredDiagram.payload.record.retirement.retiredBy, responsible.user.id);
await request('/api/data/docs/diagram-rf1-backup', { method:'PUT', cookie:admin.cookie, expected:409, body:{ ...retiredDiagram.payload.record, title:'Altération interdite après retrait' } });
await request('/api/data/docs/diagram-rf1-backup', { method:'DELETE', cookie:admin.cookie, expected:409 });

await request('/api/access/memberships', { method:'POST', cookie:admin.cookie, body:{ userId:2, zoneId:'rf1', responsible:false } });
await request('/api/access/grants', { method:'POST', cookie:admin.cookie, body:{ userId:2, zoneId:'rf1', permission:'diagram.read' } });
await request('/api/access/memberships', { method:'POST', cookie:admin.cookie, body:{ userId:3, zoneId:'stc', responsible:false } });
await request('/api/access/grants', { method:'POST', cookie:admin.cookie, body:{ userId:3, zoneId:'stc', permission:'diagram.edit' } });
sync = await request('/api/sync', { cookie:tech.cookie });
const redactedDiagram = sync.payload.data.docs?.find(item => item.id === 'diagram-cross-zone-private');
assert.ok(redactedDiagram, 'le schéma interzone doit être visible après diagram.read dans toutes ses zones');
const protectedNode = redactedDiagram.nodes.find(node => node.entityRef?.protected === true);
assert.ok(protectedNode, 'la référence RF1 sans equipment.read doit être remplacée par un stub protégé');
assert.equal(protectedNode.label, 'Dépendance protégée');
assert.equal(protectedNode.entityRef.id, undefined, 'ID équipement divulgué dans le document redacté');
assert.ok(!JSON.stringify(protectedNode).includes('MC1 RF1'), 'nom équipement divulgué dans le document redacté');
const protectedEdge = redactedDiagram.edges.find(edge => edge.id === 'protected-edge');
assert.equal(protectedEdge.label, 'Dépendance protégée', 'le libellé de liaison ne doit pas révéler la cible');
assert.equal(protectedEdge.description, undefined, 'la description de liaison protégée doit être retirée');

const oracle = await request('/api/data/docs/oracle-hidden-reference', { method:'PUT', cookie:responsible.cookie, expected:404, body:{
  id:'oracle-hidden-reference', kind:'technical_diagram', title:'Oracle interdit', diagramType:'signal-synoptic', status:'draft', zoneIds:['stc'],
  nodes:[{ id:'hidden', type:'entity', entityRef:{ type:'equipment', id:10 } }], edges:[]
} });
assert.equal(oracle.payload.error, 'DOCUMENT_REFERENCE_UNAVAILABLE');
assert.ok(!JSON.stringify(oracle.payload).includes('10'), 'la réponse ne doit pas révéler l’identifiant testé');
const revisionOracle = await request('/api/data/docs/oracle-hidden-revision', { method:'PUT', cookie:responsible.cookie, expected:404, body:{
  id:'oracle-hidden-revision', kind:'technical_diagram', title:'Oracle révision interdit', diagramType:'signal-synoptic',
  status:'draft', zoneIds:['stc'], supersedesId:'diagram-cross-zone-private', nodes:[], edges:[]
} });
assert.equal(revisionOracle.payload.error, 'DOCUMENT_REFERENCE_UNAVAILABLE');
assert.ok(!JSON.stringify(revisionOracle.payload).includes('diagram-cross-zone-private'), 'la réponse ne doit pas révéler le document supersédé');

await request('/api/sync/bootstrap', { method:'POST', cookie:admin.cookie, body:{ data:{
  equipments:[
    { id:30, name:'Legacy source', roomId:1, ports:[
      { id:'LEG-OUT', number:'OUT', direction:'OUT', type:'BNC / SDI' },
      { id:'LEG-OUT-2', number:'OUT 2', direction:'OUT', type:'BNC / SDI' },
      { id:'LEG-OUT-3', number:'OUT 3', direction:'OUT', type:'BNC / SDI' }
    ] },
    { id:31, name:'Legacy destination A', roomId:1, ports:[{ id:'LEG-IN-A', number:'IN A', direction:'IN', type:'BNC / SDI' }] },
    { id:32, name:'Legacy destination B', roomId:1, ports:[{ id:'LEG-IN-B', number:'IN B', direction:'IN', type:'BNC / SDI' }] }
  ],
  cables:[
    { id:'LEG-C1', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:30, sourcePortId:'LEG-OUT', destinationType:'equipment', destinationId:31, destinationPortId:'LEG-IN-A', status:'Connecté' },
    { id:'LEG-C2', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:30, sourcePortId:'LEG-OUT', destinationType:'equipment', destinationId:32, destinationPortId:'LEG-IN-B', status:'Connecté' }
  ]
} } });
let adminSnapshot = await request('/api/sync', { cookie:admin.cookie });
assert.equal(
  adminSnapshot.payload.data.equipments.find(item => String(item.id) === '10')?.ports?.find(port => port.id === 'OUT1')?.allowMultipleConnections,
  false,
  'un client ne doit pas pouvoir désactiver la contrainte d’occupation du port'
);
assert.equal(
  adminSnapshot.payload.data.equipments.find(item => String(item.id) === '10')?.ports?.find(port => port.id === 'OUT1')?.opaqueHugeField,
  undefined,
  'un champ de port arbitraire ne doit pas être persisté'
);
assert.ok(adminSnapshot.payload.data.cables.some(item => item.id === 'LEG-C1'), 'premier câble legacy absent');
const cableEnQuarantaine = adminSnapshot.payload.data.cables.find(item => item.id === 'LEG-C2');
assert.equal(cableEnQuarantaine?.integrityState, 'quarantined', 'le conflit legacy doit être isolé');
// On corrige le câble À PARTIR DE CE QU'ON VIENT DE LIRE, comme le fait un écran réel :
// la fiche lue porte sa version, et c'est elle que le serveur compare. Reconstruire la
// charge de toutes pièces serait un écrasement à l'aveugle, que le contrat de version
// refuse — à juste titre, puisqu'il efface ce que la charge ne renomme pas.
await request('/api/data/cables/LEG-C2', { method:'PUT', cookie:admin.cookie, body:{
  ...cableEnQuarantaine,
  id:'LEG-C2', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:30, sourcePortId:'LEG-OUT-2',
  destinationType:'equipment', destinationId:32, destinationPortId:'LEG-IN-B', status:'Connecté',
  integrityState:'quarantined', integrityErrorCode:'CLIENT_BYPASS', integrityIssues:['sticky'], originalStatus:'Connecté'
} });
adminSnapshot = await request('/api/sync', { cookie:admin.cookie });
const repairedLegacyCable = adminSnapshot.payload.data.cables.find(item => item.id === 'LEG-C2');
assert.equal(repairedLegacyCable.integrityState, undefined, 'la quarantaine doit disparaître après correction validée');
assert.equal(repairedLegacyCable.integrityErrorCode, undefined);
assert.equal(repairedLegacyCable.integrityIssues, undefined);
assert.equal(repairedLegacyCable.originalStatus, undefined);
const repairedOccupancy = await request('/api/data/cables/LEG-C3', { method:'PUT', cookie:admin.cookie, expected:409, body:{
  id:'LEG-C3', category:'Vidéo', type:'SDI', sourceType:'equipment', sourceId:30, sourcePortId:'LEG-OUT-3',
  destinationType:'equipment', destinationId:32, destinationPortId:'LEG-IN-B', status:'Connecté'
} });
assert.equal(repairedOccupancy.payload.error, 'PORT_ALREADY_CONNECTED');
await request('/api/sync/bootstrap', { method:'POST', cookie:admin.cookie, expected:400, body:{ data:{ docs:[{ title:'Sans identifiant' }] } } });

await request('/api/data/docs/router-a', { method:'PUT', cookie:admin.cookie, body:{ id:'router-a', kind:'topology_router', targetType:'broadcast_topology', targetId:'router-a', name:'Router A', inputCapacity:2, outputCapacity:2 } });
await request('/api/data/docs/router-b', { method:'PUT', cookie:admin.cookie, body:{ id:'router-b', kind:'topology_router', targetType:'broadcast_topology', targetId:'router-b', name:'Router B', inputCapacity:2, outputCapacity:2 } });
await request('/api/data/docs/router-a-in-1', { method:'PUT', cookie:admin.cookie, body:{ id:'router-a-in-1', kind:'topology_router_port', targetType:'broadcast_topology', targetId:'router-a-in-1', routerId:'router-a', direction:'INPUT', portNumber:'1' } });
await request('/api/data/docs/router-b-out-1', { method:'PUT', cookie:admin.cookie, body:{ id:'router-b-out-1', kind:'topology_router_port', targetType:'broadcast_topology', targetId:'router-b-out-1', routerId:'router-b', direction:'OUTPUT', portNumber:'1' } });
await request('/api/data/docs/invalid-cross-router', { method:'PUT', cookie:admin.cookie, expected:400, body:{
  id:'invalid-cross-router', kind:'topology_crosspoint', targetType:'broadcast_topology', targetId:'invalid-cross-router',
  routerId:'router-a', inputPortId:'router-a-in-1', outputPortId:'router-b-out-1', state:'DOCUMENTED'
} });

await request('/api/data/users/2', { method: 'DELETE', cookie: admin.cookie });
await request('/api/sync', { cookie: tech.cookie, expected: 401 });

await request('/.git/config', { expected: 404 });
await request('/scripts/serve.js', { expected: 404 });

console.log('E2E sécurité PostgreSQL: PASS');
