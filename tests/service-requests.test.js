import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REQUEST_KINDS, requestKindOf, validateRequestPayload, slaEscalationState } from '../service-request-contract.js';
import { createAccessControl } from '../scripts/access-control.js';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('le centre de demandes couvre les workflows métier sans dupliquer Tickets', () => {
  assert.deepEqual(Object.keys(REQUEST_KINDS), ['incident','service','information','video-transfer','access','intervention']);
  assert.equal(requestKindOf({ category:'panne' }), 'incident');
  assert.equal(requestKindOf({ category:'maintenance' }), 'intervention');
  assert.equal(requestKindOf({ requestKind:'video-transfer' }), 'video-transfer');
});

test('une demande vidéo exige destination, source, serveur et délai', () => {
  const incomplete = validateRequestPayload({ requestKind:'video-transfer', destinationZoneId:'stc', subject:'Copie sujet', description:'Copier le sujet vers le serveur.', details:{} });
  assert.ok(incomplete.errors.some(error => error.includes('Source / emplacement')));
  assert.ok(incomplete.errors.some(error => error.includes('Serveur / destination')));
  assert.ok(incomplete.errors.some(error => error.includes('Livraison souhaitée')));

  const complete = validateRequestPayload({
    requestKind:'video-transfer', destinationZoneId:'stc', subject:'Copie sujet 20H', description:'Copier le sujet vers le serveur de production.', priority:'moyenne',
    details:{ mediaSource:'EVS 2 / clip 184', destinationServer:'Serveur NEWS', neededAt:'2026-08-14T18:00', format:'MXF' }
  });
  assert.deepEqual(complete.errors, []);
});

test('un incident peut rester lié à la preuve immuable du test de secours', () => {
  const checked = validateRequestPayload({
    requestKind:'incident', destinationZoneId:'rf1', subject:'Suivi après bascule',
    description:'Diagnostic à poursuivre après sécurisation du direct.',
    relatedType:'continuity-test', relatedId:'continuity-test-42',
    details:{ impact:'Aucun impact antenne' }
  });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.value.relatedType, 'continuity-test');
  assert.equal(checked.value.relatedId, 'continuity-test-42');
});

test("une demande d'accès reste dans le workflow d'autorisation existant", async () => {
  const validation = validateRequestPayload({ requestKind:'access', subject:'Accès STC', description:'Besoin temporaire', destinationZoneId:'stc' });
  assert.ok(validation.errors.some(error => error.includes('Accès zones')));
  const tickets = await source('tickets.js');
  assert.match(tickets, /openAccessRequestModal/);
  assert.match(tickets, /open-zone-access-workflow/);
  assert.doesNotMatch(tickets, /db\.save\('tickets'/);
});

test('le serveur fixe auteur et destination et réserve les mutations au workflow dédié', async () => {
  const server = await source('scripts/serve.js');
  assert.match(server, /POST' && url\.pathname === '\/api\/service-requests'/);
  assert.match(server, /createdById: user\.id/);
  assert.match(server, /destinationZoneId: zone\.id/);
  assert.match(server, /RELATED_RESOURCE_FORBIDDEN/);
  assert.match(server, /DEDICATED_REQUEST_ENDPOINT/);
  assert.match(server, /REQUEST_HISTORY_IMMUTABLE/);
  assert.match(server, /service-request\.comment/);
});

test('la visibilité combine propriétaire de la demande et permission de zone', async () => {
  const access = await source('scripts/access-control.js');
  const server = await source('scripts/serve.js');
  assert.match(access, /storeName === 'tickets' && action === 'read'/);
  assert.match(access, /record\.createdById \?\? record\.requestedBy/);
  assert.match(server, /canManageServiceRequest/);
  assert.match(server, /access\.canAccessRecord\(user, 'tickets', record, 'write', client\)/);
  assert.match(server, /output\.relatedProtected/);
});

test('le contrôle d’accès autorise concrètement auteur et équipe destinataire seulement', async () => {
  const records = {
    zone_memberships:[{ id:'m1', userId:20, zoneId:'stc', status:'active' }],
    zone_grants:[{ id:'g1', userId:20, zoneId:'stc', permission:'ticket.read', status:'active' }],
    resource_zones:[]
  };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('SELECT record_id,data,updated_at')) return { rows:(records[params[0]] || []).map(data => ({ data })) };
      throw new Error(`Requête inattendue: ${sql}`);
    }
  };
  const access = createAccessControl(pool);
  const ticket = { id:'REQ-1', createdById:10, zoneId:'stc' };
  assert.equal(await access.canAccessRecord({ id:10, role:'visitor' }, 'tickets', ticket, 'read'), true);
  assert.equal(await access.canAccessRecord({ id:20, role:'technician' }, 'tickets', ticket, 'read'), true);
  assert.equal(await access.canAccessRecord({ id:30, role:'technician' }, 'tickets', ticket, 'read'), false);
  assert.equal(await access.canAccessRecord({ id:10, role:'visitor' }, 'tickets', ticket, 'write'), false);
});

test('le formulaire dynamique et ses assets restent actifs dans le PWA', async () => {
  const [tickets, html, worker, css] = await Promise.all([source('tickets.js'), source('index.html'), source('service-worker.js'), source('service-requests.css')]);
  assert.match(tickets, /request-dynamic-fields/);
  assert.match(tickets, /destinationZoneId/);
  assert.match(html, /service-requests\.css/);
  assert.match(worker, /service-request-contract\.js/);
  assert.match(worker, /2mtech-v\d+\.\d+/);
  assert.match(css, /request-kind-grid/);
});

test('demandeurs et responsables retrouvent le même centre de demandes', async () => {
  const [responsible, visitor, technician] = await Promise.all([source('responsible-ui.js'), source('visitor-ui.js'), source('techui.js')]);
  assert.match(responsible, /showTicketsPage\('responsible-content'\)/);
  assert.match(visitor, /Mes demandes/);
  assert.match(visitor, /showTicketsPage\('visitor-requests-content'\)/);
  assert.match(technician, /openTicketModal/);
});

/*
 * SLA VISUEL — sur la PROPORTION de délai restant, jamais sur des minutes brutes : un ticket
 * « haute » (6h) à 30 min de son échéance et un ticket « basse » (72h) à 30 min de la sienne
 * n'ont pas la même urgence en minutes, mais la même une fois rapportée à leur propre délai.
 * `now` est toujours injecté : un test SLA ne doit jamais dépendre de l'instant où il tourne.
 */
test('slaEscalationState : les statuts terminaux arrêtent le décompte, quel que soit le deadline', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const perime = { status: 'fermé', deadline: '2020-01-01T00:00:00Z' };
  assert.deepEqual(slaEscalationState(perime, now), { state: 'closed', label: 'Fermé', remainingRatio: null });
  const pretAFermer = { status: 'prêt-fermeture', deadline: '2020-01-01T00:00:00Z' };
  assert.deepEqual(slaEscalationState(pretAFermer, now), { state: 'closed', label: 'Prêt à fermer', remainingRatio: null });
});

test('slaEscalationState : quatre paliers, sur le POURCENTAGE de délai restant', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const slaMinutes = 1000; // délai rond, pourcentages lisibles
  const ticketA = (remainingMinutes) => ({ status: 'en cours', slaMinutes, deadline: new Date(now + remainingMinutes * 60_000).toISOString() });

  assert.equal(slaEscalationState(ticketA(600), now).state, 'normal');   // 60 % restant
  assert.equal(slaEscalationState(ticketA(400), now).state, 'warning');  // 40 % restant
  assert.equal(slaEscalationState(ticketA(150), now).state, 'urgent');   // 15 % restant
  assert.equal(slaEscalationState(ticketA(50), now).state, 'critical');  // 5 % restant

  // Les bornes elles-mêmes : pile à 50/25/10 % est encore le palier du DESSOUS (strictement
  // supérieur pour rester au palier calme), jamais le palier alarmant voisin.
  assert.equal(slaEscalationState(ticketA(500), now).state, 'warning', '50 % pile : pas encore normal');
  assert.equal(slaEscalationState(ticketA(250), now).state, 'urgent', '25 % pile : pas encore warning');
  assert.equal(slaEscalationState(ticketA(100), now).state, 'critical', '10 % pile : pas encore urgent');
});

test('slaEscalationState : dépassé rend l’état "overdue" avec la durée de dépassement, jamais le deadline brut', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ticket = { status: 'en cours', slaMinutes: 360, deadline: new Date(now - 18 * 60_000).toISOString() };
  const etat = slaEscalationState(ticket, now);
  assert.equal(etat.state, 'overdue');
  assert.equal(etat.label, 'SLA dépassé de 18 min');
  assert.equal(etat.remainingRatio, 0);
});

test('slaEscalationState : le libellé bascule en "h min" au-delà d’une heure, jamais "0 min" tant que le ticket est ouvert', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const dans204min = { status: 'en cours', slaMinutes: 1000, deadline: new Date(now + 204 * 60_000).toISOString() };
  assert.equal(slaEscalationState(dans204min, now).label, '3 h 24 min');
  const dans45min = { status: 'en cours', slaMinutes: 1000, deadline: new Date(now + 45 * 60_000).toISOString() };
  assert.equal(slaEscalationState(dans45min, now).label, '45 min');
  const dansUneDemiSeconde = { status: 'en cours', slaMinutes: 1000, deadline: new Date(now + 500).toISOString() };
  assert.notEqual(slaEscalationState(dansUneDemiSeconde, now).label, '0 min', 'un ticket encore ouvert ne doit jamais afficher 0 min');
});

test('slaEscalationState : `slaMinutes` stocké fait autorité, jamais recalculé depuis la priorité courante', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  // Un ticket "haute" (6h de contrat) dont le `slaMinutes` stocké dit 72h (basse) : le champ
  // stocké est la valeur RÉELLEMENT appliquée à la création, elle ne doit jamais être
  // silencieusement recalculée depuis `prio` — cette dernière n'est jamais modifiée après
  // création (confirmé par `updateServiceRequest`), mais la fonction ne doit pas le supposer.
  const ticket = { status: 'en cours', prio: 'haute', slaMinutes: 72 * 60, deadline: new Date(now + 40 * 60 * 60_000).toISOString() };
  assert.equal(slaEscalationState(ticket, now).state, 'normal', '~56% de 72h doit lire slaMinutes, pas recalculer 6h (haute) où ce délai serait très dépassé');
});

test('slaEscalationState : `slaMinutes` absent retombe sur la règle canonique par priorité, jamais sur une valeur inventée', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const ticketLegacy = { status: 'en cours', prio: 'haute', deadline: new Date(now + 180 * 60_000).toISOString() }; // 3h restantes sur 6h "haute" = 50%
  assert.equal(slaEscalationState(ticketLegacy, now).state, 'warning');
});

test('slaEscalationState : un deadline illisible rend un état honnête, jamais une exception ni un dépassement inventé', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.deepEqual(slaEscalationState({ status: 'en cours', deadline: 'pas-une-date' }, now), { state: 'normal', label: '—', remainingRatio: null });
  assert.deepEqual(slaEscalationState({ status: 'en cours' }, now), { state: 'normal', label: '—', remainingRatio: null });
});
