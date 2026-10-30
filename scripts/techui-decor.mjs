/**
 * @file scripts/techui-decor.mjs — le décor propre au lot TECHUI-01.
 *
 * POURQUOI UN DÉCOR EN PLUS
 * -------------------------
 * L'épreuve TECHUI clique des CARTES : un ticket récent, un équipement critique. Ces
 * cartes n'existent à l'écran que si la base porte, pour le technicien connecté, un
 * ticket dont il est l'auteur et un équipement réellement en panne DANS SA ZONE. Le décor
 * de UI-POLISH pose les comptes, les zones et les habilitations ; celui-ci ajoute ce que
 * TECHUI doit pouvoir ouvrir, et rien de plus.
 *
 * Les tickets ne sont PAS écrits par `/api/data/tickets` : le serveur refuse ce chemin
 * (`DEDICATED_REQUEST_ENDPOINT`) pour que l'auteur, la destination et l'historique
 * restent décidés par lui. On passe donc par `/api/service-requests`, connecté SOUS
 * L'IDENTITÉ DU TECHNICIEN — c'est ce qui fait de lui l'auteur, et donc ce qui fait
 * apparaître la carte dans « Mes Tickets ».
 */
import { BASE, MOT_DE_PASSE, COMPTES, ZONE, SALLE_LIBRE, motDePasseDe } from './ui-polish-decor.mjs';

export const EQUIPEMENT_CRITIQUE = 'techui-eq-critique';
export const SALLE_TECH = SALLE_LIBRE;

async function requete(chemin, { method = 'GET', cookie = '', body, expected = null } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null && reponse.status !== expected) {
    throw new Error(`${method} ${chemin} : attendu ${expected}, reçu ${reponse.status} — ${texte.slice(0, 300)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function connexion(compte) {
  const reponse = await requete('/api/auth/login', {
    method: 'POST', body: { username: compte.username, password: motDePasseDe(compte) }, expected: 200
  });
  return { cookie: reponse.cookie, utilisateur: reponse.charge?.user };
}

/** Les révisions en place, lues une fois : le décor est idempotent. */
async function revisions(cookie) {
  const instantane = await requete('/api/sync', { cookie, expected: 200 });
  const table = new Map();
  for (const [magasin, enregistrements] of Object.entries(instantane.charge?.data || {})) {
    for (const enregistrement of enregistrements || []) {
      if (enregistrement?.id === undefined || enregistrement?._revision === undefined) continue;
      table.set(`${magasin}:${enregistrement.id}`, enregistrement._revision);
    }
  }
  return table;
}

export async function poserLeDecorTechui({ trace = true } = {}) {
  const journal = message => { if (trace) console.log(message); };
  const admin = await connexion(COMPTES.admin);
  const table = await revisions(admin.cookie);

  /* Un équipement RÉELLEMENT en panne, dans la zone du technicien : c'est lui que la
     carte « Équipements Critiques » doit ouvrir, avec son identifiant canonique. */
  const revision = table.get(`equipments:${EQUIPEMENT_CRITIQUE}`);
  await requete(`/api/data/equipments/${EQUIPEMENT_CRITIQUE}`, {
    method: 'PUT', cookie: admin.cookie,
    body: {
      id: EQUIPEMENT_CRITIQUE, name: 'Convertisseur critique TECHUI', type: 'Convertisseur',
      roomId: SALLE_TECH, salleId: SALLE_TECH, baieId: 'ui-polish-baie',
      statut: 'Hors service', panne: true, numSerie: 'TECHUI-SN-0001',
      ...(revision === undefined ? {} : { expectedRevision: revision })
    },
    expected: 200
  });
  journal(`  · équipement critique posé : ${EQUIPEMENT_CRITIQUE} (panne, zone du technicien)`);

  /* Le ticket est créé PAR le technicien : sans cela il n'apparaît pas dans « Mes Tickets ». */
  const technicien = await connexion(COMPTES.technique);
  const existants = await requete('/api/sync', { cookie: technicien.cookie, expected: 200 });
  const deja = (existants.charge?.data?.tickets || []).find(ticket => ticket.subject === 'Panne convertisseur — épreuve TECHUI');
  let ticket = deja;
  if (!ticket) {
    const creation = await requete('/api/service-requests', {
      method: 'POST', cookie: technicien.cookie,
      body: {
        requestKind: 'incident', destinationZoneId: ZONE,
        subject: 'Panne convertisseur — épreuve TECHUI',
        description: 'Le convertisseur critique ne renvoie plus de signal. Ticket du décor TECHUI-01.',
        priority: 'haute', relatedType: 'equipment', relatedId: EQUIPEMENT_CRITIQUE,
        // `impact` est obligatoire pour un incident : le contrat le dit, le décor le respecte.
        details: { impact: 'Service dégradé', firstChecks: 'Alimentation et câblage vérifiés.' }
      },
      expected: 201
    });
    ticket = creation.charge?.request;
  }
  journal(`  · ticket du technicien : ${ticket?.id} (auteur « ${ticket?.createdBy} »)`);

  return { equipementCritique: EQUIPEMENT_CRITIQUE, ticket, technicien: COMPTES.technique };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\n╔═══ décor TECHUI-01 — ${BASE} ═══╗\n`);
  const resultat = await poserLeDecorTechui();
  console.log(`\n╚═══ décor posé (ticket ${resultat.ticket?.id}) ═══╝\n`);
}
