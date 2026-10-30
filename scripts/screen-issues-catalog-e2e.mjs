/**
 * @file scripts/screen-issues-catalog-e2e.mjs — SCREEN-ISSUES-CATALOG-01 (#118), l'épreuve réseau.
 *
 * Réutilise le décor de #110 (`screen-diag-decor.mjs`) — deux zones, un technicien scopé A,
 * un visiteur A, l'incident opérationnel attaché à l'écran A — et y ajoute exactement la
 * matrice que #118 exige : le catalogue générique, un incident Zone B, un enregistrement
 * contradictoire, et les deux formes héritées.
 *
 * Doit ÉCHOUER (le technicien scopé ne reçoit pas le catalogue) sur `main@aa8f0b2`, et
 * PASSER sur cette branche.
 *
 * Prérequis :
 *   PORT=4220 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4220 node scripts/screen-issues-catalog-e2e.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  poserLeDecorScreenDiag, connexion, retirerGroupes,
  ZONE_A, ZONE_B, ECRAN_A, ECRAN_B, NOM_SALLE_B, NOM_ECRAN_B,
  COMPTE_TECHNICIEN, COMPTE_TECHNICIEN_SANS_ZONE, COMPTE_VISITEUR
} from './screen-diag-decor.mjs';
import { BASE, MOT_DE_PASSE } from './ui-polish-decor.mjs';

const base = process.env.E2E_BASE_URL || BASE;
const ADMIN_USERNAME = process.env.PLATFORM_ADMIN_USERNAME || 'demo-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || 'Kt5-Genepi-Sillon-Rz9!';

/*
 * Deux blocages relevés sur PR #150 à la tête 772e9ac : la lecture du catalogue ne
 * vérifiait que le PLAFOND du rôle (`roleAllows`), jamais l'adhésion ET l'habilitation
 * RÉELLES ; et l'écriture n'interdisait que la contradiction `scope:'catalog'` + pièce
 * jointe, jamais un nouvel enregistrement `{appliesToAll:true}` sans `scope` — qui devenait
 * pourtant lisible globalement via le même repli que les enregistrements hérités.
 *
 * Ce fichier réutilise la connexion Postgres directe (même schéma, même motif que
 * `revision-integrite-e2e.mjs`) pour semer LEGACY_CATALOGUE et LEGACY_ATTACHE — les deux
 * enregistrements SANS `scope` — car ils simulent des données ANTÉRIEURES au contrat de ce
 * lot : les poser via l'API reviendrait à les faire passer par une règle qui, historiquement,
 * n'existait pas encore pour elles. La nouvelle règle d'écriture (§ SIC-8/9 plus bas) refuse
 * précisément cette forme pour toute CRÉATION passant par l'API.
 */
const databaseUrl = process.env.DATABASE_URL || '';
assert.ok(databaseUrl, 'DATABASE_URL est requis : ce script sème directement en base les enregistrements hérités.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

async function semerEnregistrementHerite(storeName, recordId, data) {
  await pool.query(
    `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
     VALUES($1,$2,$3::jsonb,FALSE,NOW())
     ON CONFLICT(store_name,record_id) DO UPDATE SET data=EXCLUDED.data,deleted=FALSE,updated_at=NOW()`,
    [storeName, recordId, JSON.stringify(data)]
  );
}

const CATALOGUE = 'sic-catalogue-ecran-noir';
const ZONE_B_ISSUE = 'sic-zone-b-issue';
const CONTRADICTOIRE = 'sic-contradictoire';
const LEGACY_CATALOGUE = 'sic-legacy-catalogue';
const LEGACY_ATTACHE = 'sic-legacy-attache';
const NOM_CATALOGUE = 'Écran noir — catalogue générique';

/*
 * MATRICE DE PERMISSION EFFECTIVE (#150, blocker 1) — « plafond ∧ adhésion ∧ habilitation ».
 *
 * TECH_ZERO réutilise le compte du décor #110 (`COMPTE_TECHNICIEN_SANS_ZONE`), déjà membre
 * d'AUCUNE zone. TECH_VALID réutilise `COMPTE_TECHNICIEN`, déjà membre de ZONE_A avec
 * `diagnostic.run` dans CETTE MÊME zone. Les autres comptes sont propres à cette épreuve.
 */
const TECH_MEMBERSHIP_ONLY = Object.freeze({ id: 9401, username: 'sic-tech-adhesion-seule', role: 'technician', motDePasse: MOT_DE_PASSE });
const TECH_GRANT_ONLY = Object.freeze({ id: 9402, username: 'sic-tech-habilitation-seule', role: 'technician', motDePasse: MOT_DE_PASSE });
const TECH_MISMATCH = Object.freeze({ id: 9403, username: 'sic-tech-zones-disjointes', role: 'technician', motDePasse: MOT_DE_PASSE });
const CHEF_ZERO = Object.freeze({ id: 9404, username: 'sic-chef-zero', role: 'chef', motDePasse: MOT_DE_PASSE });
const RESP_ZERO = Object.freeze({ id: 9405, username: 'sic-responsable-zero', role: 'responsible', motDePasse: MOT_DE_PASSE });
const TECH_REVOKE = Object.freeze({ id: 9406, username: 'sic-tech-revocation', role: 'technician', motDePasse: MOT_DE_PASSE });
const TECH_MEMBERSHIP_EXPIRED = Object.freeze({ id: 9407, username: 'sic-tech-adhesion-expiree', role: 'technician', motDePasse: MOT_DE_PASSE });
const TECH_GRANT_EXPIRED = Object.freeze({ id: 9408, username: 'sic-tech-habilitation-expiree', role: 'technician', motDePasse: MOT_DE_PASSE });
const RAW_MISSING_SCOPE = 'sic-raw-missing-scope';
const RAW_UNKNOWN_SCOPE = 'sic-raw-unknown-scope';

async function requete(chemin, { method = 'GET', cookie = '', body } = {}) {
  const reponse = await fetch(`${base}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  return { statut: reponse.status, charge };
}

async function chargerRevisions(cookie) {
  const instantane = await requete('/api/sync', { cookie });
  const table = new Map();
  for (const [magasin, enregistrements] of Object.entries(instantane.charge?.data || {})) {
    for (const enregistrement of enregistrements || []) {
      if (enregistrement?.id === undefined || enregistrement?._revision === undefined) continue;
      table.set(`${magasin}:${enregistrement.id}`, enregistrement._revision);
    }
  }
  return table;
}

async function ecrire(table, cookie, magasin, id, corps) {
  const revision = table.get(`${magasin}:${id}`);
  const reponse = await requete(`/api/data/${magasin}/${encodeURIComponent(id)}`, {
    method: 'PUT', cookie,
    body: revision === undefined ? corps : { ...corps, expectedRevision: revision }
  });
  const posee = reponse.charge?.record?._revision;
  if (posee !== undefined) table.set(`${magasin}:${id}`, posee);
  return reponse;
}

async function affilier(cookieAdmin, userId, zoneId, { expiresAt = null, responsible = false } = {}) {
  return requete('/api/access/memberships', {
    method: 'POST', cookie: cookieAdmin, body: { userId, zoneId, responsible, expiresAt }
  });
}

async function habiliter(cookieAdmin, userId, zoneId, permission, { expiresAt = null } = {}) {
  return requete('/api/access/grants', {
    method: 'POST', cookie: cookieAdmin, body: { userId, zoneId, permission, expiresAt }
  });
}

async function revoquer(cookieAdmin, grantId) {
  return requete(`/api/access/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE', cookie: cookieAdmin });
}

const resultats = [];
const controle = (nom, condition, detail = '') => {
  resultats.push({ nom, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'OK  ' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\n╔═══ décor SCREEN-DIAG-TECH-01 (#110), base de #118 — ${base} ═══╗\n`);
await poserLeDecorScreenDiag();

const admin = await connexion({ username: ADMIN_USERNAME, motDePasse: ADMIN_PASSWORD });
const table = await chargerRevisions(admin.cookie);

console.log('\nSIC-0 · pose de la matrice #118');
{
  const catalogue = await ecrire(table, admin.cookie, 'screen_issues', CATALOGUE, {
    id: CATALOGUE, name: NOM_CATALOGUE, description: 'Aucun signal, aucune zone désignée.',
    appliesToAll: true, scope: 'catalog',
    steps: [{ question: 'Décrivez le résultat de vos vérifications', type: 'text' }],
    updatedAt: new Date().toISOString()
  });
  controle('CATALOG posé', catalogue.statut === 200, `HTTP ${catalogue.statut}`);

  const zoneB = await ecrire(table, admin.cookie, 'screen_issues', ZONE_B_ISSUE, {
    id: ZONE_B_ISSUE, name: 'Incident Zone B', description: 'Ne doit jamais atteindre le technicien A.',
    appliesToAll: false, scope: 'operational', screenIds: [ECRAN_B],
    steps: [{ question: 'Constat', type: 'text' }], updatedAt: new Date().toISOString()
  });
  controle('ZONE_B_ISSUE posé', zoneB.statut === 200, `HTTP ${zoneB.statut}`);

  /*
   * Semés DIRECTEMENT en base — jamais via `ecrire()` — précisément parce qu'ils simulent
   * des enregistrements ANTÉRIEURS au contrat d'écriture de #150 : aucun `scope`, l'un et
   * l'autre. Les poser via l'API échouerait désormais avec 400 INVALID_SCREEN_ISSUE_SCOPE
   * (SIC-8 le vérifie) puisqu'il s'agirait alors d'une CRÉATION — ce que ces deux fiches ne
   * sont historiquement pas.
   */
  await semerEnregistrementHerite('screen_issues', LEGACY_CATALOGUE, {
    id: LEGACY_CATALOGUE, name: 'Catalogue hérité', description: 'appliesToAll historique, sans scope.',
    appliesToAll: true, steps: [{ question: 'Constat', type: 'text' }], updatedAt: new Date().toISOString()
  });
  controle('LEGACY_CATALOG semé', true);

  await semerEnregistrementHerite('screen_issues', LEGACY_ATTACHE, {
    id: LEGACY_ATTACHE, name: 'Incident hérité attaché B', description: 'appliesToAll + attachement, sans scope.',
    appliesToAll: true, screenIds: [ECRAN_B], steps: [{ question: 'Constat', type: 'text' }], updatedAt: new Date().toISOString()
  });
  controle('LEGACY_ATTACHED semé', true);
  // Un enregistrement sans `_revision` vaut la révision 0 (revision-contract.js) : la
  // première écriture qui passera par l'API (SIC-9) doit donc la déclarer.
  table.set(`screen_issues:${LEGACY_CATALOGUE}`, 0);
  table.set(`screen_issues:${LEGACY_ATTACHE}`, 0);

  const contradictoire = await requete(`/api/data/screen_issues/${encodeURIComponent(CONTRADICTOIRE)}`, {
    method: 'PUT', cookie: admin.cookie,
    body: { id: CONTRADICTOIRE, name: 'Contradiction', scope: 'catalog', screenIds: [ECRAN_B], steps: [] }
  });
  controle('CONTRADICTORY rejeté 400', contradictoire.statut === 400 && contradictoire.charge?.error === 'INVALID_CATALOG_DEFINITION',
    `HTTP ${contradictoire.statut} ${contradictoire.charge?.error || ''}`);
  const verif = await requete(`/api/data/screen_issues/${encodeURIComponent(CONTRADICTOIRE)}`, { cookie: admin.cookie });
  controle('CONTRADICTORY non persisté', !table.has(`screen_issues:${CONTRADICTOIRE}`));
}

console.log('\nSIC-0b · pose des comptes de la matrice de permission effective (#150, blocker 1)');
{
  for (const compte of [TECH_MEMBERSHIP_ONLY, TECH_GRANT_ONLY, TECH_MISMATCH, CHEF_ZERO, RESP_ZERO,
    TECH_REVOKE, TECH_MEMBERSHIP_EXPIRED, TECH_GRANT_EXPIRED]) {
    const pose = await ecrire(table, admin.cookie, 'users', compte.id, {
      id: compte.id, username: compte.username, fullName: `Compte ${compte.username}`,
      role: compte.role, status: 'active',
      password: Buffer.from(compte.motDePasse).toString('base64'), authVersion: 1
    });
    controle(`compte ${compte.username} posé`, pose.statut === 200, `HTTP ${pose.statut}`);
  }

  // TECH_MEMBERSHIP_ONLY : adhésion Zone A, AUCUNE habilitation nulle part.
  const m1 = await affilier(admin.cookie, TECH_MEMBERSHIP_ONLY.id, ZONE_A);
  controle('TECH_MEMBERSHIP_ONLY affilié Zone A', m1.statut === 200, `HTTP ${m1.statut}`);

  // TECH_GRANT_ONLY : habilitation diagnostic.run Zone A, AUCUNE adhésion nulle part.
  const g1 = await habiliter(admin.cookie, TECH_GRANT_ONLY.id, ZONE_A, 'diagnostic.run');
  controle('TECH_GRANT_ONLY habilité Zone A', g1.statut === 200, `HTTP ${g1.statut}`);

  // TECH_MISMATCH : adhésion Zone A + habilitation Zone B — zones DISJOINTES, ne doit jamais se combiner.
  const m2 = await affilier(admin.cookie, TECH_MISMATCH.id, ZONE_A);
  const g2 = await habiliter(admin.cookie, TECH_MISMATCH.id, ZONE_B, 'diagnostic.run');
  controle('TECH_MISMATCH affilié Zone A + habilité Zone B', m2.statut === 200 && g2.statut === 200,
    `HTTP ${m2.statut}/${g2.statut}`);

  // CHEF_ZERO, RESP_ZERO : aucune adhésion, aucune habilitation — le plafond seul ne doit jamais suffire.

  // TECH_REVOKE : adhésion + habilitation valides Zone A — la révocation intervient plus loin (SIC-6).
  const m3 = await affilier(admin.cookie, TECH_REVOKE.id, ZONE_A);
  const g3 = await habiliter(admin.cookie, TECH_REVOKE.id, ZONE_A, 'diagnostic.run');
  controle('TECH_REVOKE affilié + habilité Zone A', m3.statut === 200 && g3.statut === 200,
    `HTTP ${m3.statut}/${g3.statut}`);

  // TECH_MEMBERSHIP_EXPIRED : adhésion Zone A déjà EXPIRÉE + habilitation Zone A valide.
  const passe = new Date(Date.now() - 3600_000).toISOString();
  const m4 = await affilier(admin.cookie, TECH_MEMBERSHIP_EXPIRED.id, ZONE_A, { expiresAt: passe });
  const g4 = await habiliter(admin.cookie, TECH_MEMBERSHIP_EXPIRED.id, ZONE_A, 'diagnostic.run');
  controle('TECH_MEMBERSHIP_EXPIRED affilié (expiré) + habilité Zone A', m4.statut === 200 && g4.statut === 200,
    `HTTP ${m4.statut}/${g4.statut}`);

  // TECH_GRANT_EXPIRED : adhésion Zone A valide + habilitation Zone A déjà EXPIRÉE.
  const m5 = await affilier(admin.cookie, TECH_GRANT_EXPIRED.id, ZONE_A);
  const g5 = await habiliter(admin.cookie, TECH_GRANT_EXPIRED.id, ZONE_A, 'diagnostic.run', { expiresAt: passe });
  controle('TECH_GRANT_EXPIRED affilié + habilité (expirée) Zone A', m5.statut === 200 && g5.statut === 200,
    `HTTP ${m5.statut}/${g5.statut}`);
}

async function sondeSync(compte, motDePasse) {
  const session = await connexion({ username: compte, motDePasse });
  const instantane = await requete('/api/sync', { cookie: session.cookie });
  const issues = instantane.charge?.data?.screen_issues || [];
  return { issues, texteComplet: JSON.stringify(instantane.charge) };
}

console.log('\nSIC-1 · Technicien Zone A — reçoit le catalogue, jamais Zone B');
{
  const { issues, texteComplet } = await sondeSync(COMPTE_TECHNICIEN.username, COMPTE_TECHNICIEN.motDePasse);
  const ids = issues.map(item => String(item.id));
  controle('CATALOG reçu', ids.includes(CATALOGUE), `reçus: ${ids.join(', ')}`);
  controle('LEGACY_CATALOG reçu (repli lecture historique)', ids.includes(LEGACY_CATALOGUE));
  controle('ZONE_B_ISSUE absent', !ids.includes(ZONE_B_ISSUE));
  controle('LEGACY_ATTACHED (Zone B) absent', !ids.includes(LEGACY_ATTACHE));
  controle('CONTRADICTORY absent (jamais persisté)', !ids.includes(CONTRADICTOIRE));
  controle('aucun identifiant Zone B dans la réponse sérialisée', !texteComplet.includes(ECRAN_B) && !texteComplet.includes(NOM_ECRAN_B) && !texteComplet.includes(NOM_SALLE_B),
    'écran B / salle B recherchés en clair dans /api/sync');
}

console.log('\nSIC-2 · Visiteur — aucun catalogue, aucun contenu diagnostic au-delà de ses permissions');
{
  const { issues } = await sondeSync(COMPTE_VISITEUR.username, COMPTE_VISITEUR.motDePasse);
  const ids = issues.map(item => String(item.id));
  controle('CATALOG absent pour le visiteur', !ids.includes(CATALOGUE));
  controle('LEGACY_CATALOG absent pour le visiteur', !ids.includes(LEGACY_CATALOGUE));
}

console.log('\nSIC-3 · Administrateur — comportement existant préservé');
{
  const { issues } = await sondeSync(ADMIN_USERNAME, ADMIN_PASSWORD);
  const ids = issues.map(item => String(item.id));
  controle('admin voit CATALOG', ids.includes(CATALOGUE));
  controle('admin voit ZONE_B_ISSUE', ids.includes(ZONE_B_ISSUE));
  controle('admin voit LEGACY_ATTACHED', ids.includes(LEGACY_ATTACHE));
}

console.log('\nSIC-4 · écriture — un rôle scopé ne gagne pas la capacité globale par diagnostic.run');
{
  const technicien = await connexion({ username: COMPTE_TECHNICIEN.username, motDePasse: COMPTE_TECHNICIEN.motDePasse });
  const tentative = await requete(`/api/data/screen_issues/sic-technicien-write-attempt`, {
    method: 'PUT', cookie: technicien.cookie,
    body: { id: 'sic-technicien-write-attempt', name: 'Tentative technicien', scope: 'catalog', steps: [] }
  });
  controle('technicien ne peut pas créer un catalogue global', tentative.statut !== 200, `HTTP ${tentative.statut}`);
}

console.log('\nSIC-5 · #150 blocker 1 — le plafond seul ne suffit jamais, quel que soit le rôle');
{
  const zero = await sondeSync(COMPTE_TECHNICIEN_SANS_ZONE.username, COMPTE_TECHNICIEN_SANS_ZONE.motDePasse);
  controle('TECH_ZERO (aucune adhésion, aucune habilitation) ne voit pas CATALOG',
    !zero.issues.map(item => String(item.id)).includes(CATALOGUE));

  const membreSeul = await sondeSync(TECH_MEMBERSHIP_ONLY.username, TECH_MEMBERSHIP_ONLY.motDePasse);
  controle('TECH_MEMBERSHIP_ONLY (adhésion sans habilitation) ne voit pas CATALOG',
    !membreSeul.issues.map(item => String(item.id)).includes(CATALOGUE));

  const habiliteSeul = await sondeSync(TECH_GRANT_ONLY.username, TECH_GRANT_ONLY.motDePasse);
  controle('TECH_GRANT_ONLY (habilitation sans adhésion) ne voit pas CATALOG',
    !habiliteSeul.issues.map(item => String(item.id)).includes(CATALOGUE));

  const disjoint = await sondeSync(TECH_MISMATCH.username, TECH_MISMATCH.motDePasse);
  controle('TECH_MISMATCH (adhésion Zone A + habilitation Zone B, zones disjointes) ne voit pas CATALOG',
    !disjoint.issues.map(item => String(item.id)).includes(CATALOGUE));

  const chefZero = await sondeSync(CHEF_ZERO.username, CHEF_ZERO.motDePasse);
  controle('CHEF_ZERO ne voit pas CATALOG', !chefZero.issues.map(item => String(item.id)).includes(CATALOGUE));

  const respZero = await sondeSync(RESP_ZERO.username, RESP_ZERO.motDePasse);
  controle('RESP_ZERO ne voit pas CATALOG', !respZero.issues.map(item => String(item.id)).includes(CATALOGUE));
}

console.log('\nSIC-6 · révocation — le catalogue disparaît dès que l’habilitation est révoquée');
{
  const avant = await sondeSync(TECH_REVOKE.username, TECH_REVOKE.motDePasse);
  controle('TECH_REVOKE voit CATALOG avant révocation',
    avant.issues.map(item => String(item.id)).includes(CATALOGUE));

  const grantId = `ZG-${TECH_REVOKE.id}-${ZONE_A}-diagnostic.run`;
  const revocation = await revoquer(admin.cookie, grantId);
  controle('révocation acceptée', revocation.statut === 200, `HTTP ${revocation.statut}`);

  const apres = await sondeSync(TECH_REVOKE.username, TECH_REVOKE.motDePasse);
  controle('TECH_REVOKE ne voit plus CATALOG après révocation',
    !apres.issues.map(item => String(item.id)).includes(CATALOGUE));
}

console.log('\nSIC-7 · expiration — adhésion expirée ou habilitation expirée, catalogue invisible');
{
  const adhesionExpiree = await sondeSync(TECH_MEMBERSHIP_EXPIRED.username, TECH_MEMBERSHIP_EXPIRED.motDePasse);
  controle('TECH_MEMBERSHIP_EXPIRED (adhésion expirée) ne voit pas CATALOG',
    !adhesionExpiree.issues.map(item => String(item.id)).includes(CATALOGUE));

  const habilitationExpiree = await sondeSync(TECH_GRANT_EXPIRED.username, TECH_GRANT_EXPIRED.motDePasse);
  controle('TECH_GRANT_EXPIRED (habilitation expirée) ne voit pas CATALOG',
    !habilitationExpiree.issues.map(item => String(item.id)).includes(CATALOGUE));
}

console.log('\nSIC-8 · #150 blocker 2 — une CRÉATION exige un scope explicite et connu');
{
  const sansScope = await requete(`/api/data/screen_issues/${encodeURIComponent(RAW_MISSING_SCOPE)}`, {
    method: 'PUT', cookie: admin.cookie,
    body: { id: RAW_MISSING_SCOPE, name: 'Sans scope, nouvelle création', appliesToAll: true, steps: [] }
  });
  controle('création sans scope refusée 400 INVALID_SCREEN_ISSUE_SCOPE',
    sansScope.statut === 400 && sansScope.charge?.error === 'INVALID_SCREEN_ISSUE_SCOPE',
    `HTTP ${sansScope.statut} ${sansScope.charge?.error || ''}`);

  const scopeInconnu = await requete(`/api/data/screen_issues/${encodeURIComponent(RAW_UNKNOWN_SCOPE)}`, {
    method: 'PUT', cookie: admin.cookie,
    body: { id: RAW_UNKNOWN_SCOPE, name: 'Scope inconnu', scope: 'archive', steps: [] }
  });
  controle('création à scope inconnu refusée 400 INVALID_SCREEN_ISSUE_SCOPE',
    scopeInconnu.statut === 400 && scopeInconnu.charge?.error === 'INVALID_SCREEN_ISSUE_SCOPE',
    `HTTP ${scopeInconnu.statut} ${scopeInconnu.charge?.error || ''}`);

  // `/api/data/:store/:id` n'expose pas de GET par identifiant : la seule preuve fiable de
  // non-persistance est l'absence dans l'instantané complet, comme pour CONTRADICTOIRE (SIC-0).
  const apresRefus = await chargerRevisions(admin.cookie);
  controle('RAW_MISSING_SCOPE non persisté', !apresRefus.has(`screen_issues:${RAW_MISSING_SCOPE}`));
  controle('RAW_UNKNOWN_SCOPE non persisté', !apresRefus.has(`screen_issues:${RAW_UNKNOWN_SCOPE}`));
}

console.log('\nSIC-9 · #150 blocker 2 — une MISE À JOUR sans scope se normalise, ne se refuse pas');
{
  const majCatalogue = await ecrire(table, admin.cookie, 'screen_issues', LEGACY_CATALOGUE, {
    id: LEGACY_CATALOGUE, name: 'Catalogue hérité (mis à jour)', description: 'appliesToAll historique, toujours sans scope fourni.',
    appliesToAll: true, steps: [{ question: 'Constat', type: 'text' }], updatedAt: new Date().toISOString()
  });
  controle('mise à jour LEGACY_CATALOGUE sans scope acceptée (200, pas 400)',
    majCatalogue.statut === 200, `HTTP ${majCatalogue.statut}`);

  const majAttache = await ecrire(table, admin.cookie, 'screen_issues', LEGACY_ATTACHE, {
    id: LEGACY_ATTACHE, name: 'Incident hérité attaché B (mis à jour)', description: 'appliesToAll + attachement, toujours sans scope fourni.',
    appliesToAll: true, screenIds: [ECRAN_B], steps: [{ question: 'Constat', type: 'text' }], updatedAt: new Date().toISOString()
  });
  controle('mise à jour LEGACY_ATTACHE sans scope acceptée (200, pas 400)',
    majAttache.statut === 200, `HTTP ${majAttache.statut}`);

  // `PUT` ne renvoie `record` que pour `docs` (serve.js) : la valeur normalisée se lit sur
  // l'instantané admin, comme SIC-3 le fait déjà pour le reste de la matrice.
  const { issues: issuesAdmin } = await sondeSync(ADMIN_USERNAME, ADMIN_PASSWORD);
  const parId = new Map(issuesAdmin.map(item => [String(item.id), item]));
  controle('LEGACY_CATALOGUE normalisé scope=catalog (non attaché, appliesToAll=true)',
    parId.get(LEGACY_CATALOGUE)?.scope === 'catalog', JSON.stringify(parId.get(LEGACY_CATALOGUE)));
  controle('LEGACY_ATTACHE normalisé scope=operational (attachement présent, jamais catalog par défaut)',
    parId.get(LEGACY_ATTACHE)?.scope === 'operational', JSON.stringify(parId.get(LEGACY_ATTACHE)));
}

await retirerGroupes(admin.cookie, [`screen_groups_sic_probe`]).catch(() => {});
await pool.end();

const echecs = resultats.filter(resultat => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error('\nPROJECTION CATALOGUE INCORRECTE :');
  for (const echec of echecs) console.error(`  · ${echec.nom}${echec.detail ? ` — ${echec.detail}` : ''}`);
  process.exit(1);
}
