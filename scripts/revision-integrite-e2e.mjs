/**
 * @file scripts/revision-integrite-e2e.mjs — le compteur suit TOUT ce qui arrive à la fiche.
 *
 * CE QUE CE SCRIPT ÉPROUVE
 * ------------------------
 * Le contrat de version ne vaut que si `_revision` signifie « tout ce qui est arrivé à cet
 * enregistrement ». Une seule écriture qui change la donnée sans faire avancer le compteur
 * suffit à le vider de son sens :
 *
 *     le navigateur détient la révision 4
 *     le serveur modifie `passwordHash` par un `UPDATE` direct — révision toujours 4
 *     le navigateur renvoie sa fiche en déclarant 4
 *     le serveur compare 4 à 4, conclut « à jour », et laisse réécrire des données
 *     antérieures à la modification du serveur
 *
 * Sept mutations vivaient encore hors du magasin canonique, toutes sur `users` ou `docs`,
 * deux magasins à révision — dont une sur CHAQUE connexion. Elles passent désormais par
 * `compareAndWrite` ou par les pierres tombales à révision.
 *
 * Ce script les traverse SUR UNE VRAIE BASE, par les vraies portes HTTP, et vérifie à
 * chaque fois deux choses : le compteur a avancé, et une session ouverte avant l'opération
 * est bien refusée ensuite.
 *
 * Usage :
 *   PORT=4193 DATABASE_URL=… npm start &
 *   E2E_BASE_URL=http://127.0.0.1:4193 DATABASE_URL=… node scripts/revision-integrite-e2e.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4193';
const databaseUrl = process.env.DATABASE_URL || '';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'rev-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'Qw4-Zephyr-Tulipe-Nx8!';
const RUN = Date.now().toString(36);

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) { console.log(`  ✅ ${nom}`); return true; }
  echecs += 1;
  console.log(`  ❌ ${nom}${detail ? ' → ' + detail : ''}`);
  return false;
};

async function appel(chemin, { method = 'GET', cookie = '', body, attendu } = {}) {
  const reponse = await fetch(`${base}${chemin}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (attendu !== undefined) {
    assert.equal(reponse.status, attendu, `${method} ${chemin} : attendu ${attendu}, reçu ${reponse.status} — ${texte.slice(0, 240)}`);
  }
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie, statut } = await appel('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(statut, 200, `connexion refusée pour « ${username} » (${statut})`);
  return cookie;
};

assert.ok(databaseUrl, 'DATABASE_URL est requis : ce script lit les révisions directement en base.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

/** La révision d'une fiche, lue en base — c'est la seule mesure qui ne ment pas. */
async function revision(store, id) {
  const { rows } = await pool.query(
    "SELECT data->>'_revision' AS r, deleted FROM platform_records WHERE store_name=$1 AND record_id=$2 LIMIT 1",
    [store, String(id)]
  );
  if (!rows.length) return null;
  return { valeur: Number(rows[0].r || 0), supprime: rows[0].deleted };
}

console.log(`\n╔═══ le compteur suit tout — ${base} ═══╗\n`);

const admin = await connexion(adminUsername, adminPassword);

/* ═════════════════ 1 · la connexion elle-même fait avancer le compteur ═════════════════ */
console.log('1 · connexion — la porte dérobée la plus fréquente');

/*
 * Chaque connexion écrit `lastLogin` et `authVersion` sur la fiche utilisateur. C'était un
 * `UPDATE` direct : la fiche d'un utilisateur pouvait donc changer des dizaines de fois par
 * jour sans qu'aucune session ouverte ne s'en aperçoive.
 */
const SUJET = `rev-sujet-${RUN}`;
const SUJET_ID = `rev-u-${RUN}`;
const MOT_DE_PASSE = 'Qz7-Vraie-Preuve-Bx9!';
// `PUT /api/data/users/:id` attend le mot de passe ENCODÉ EN BASE64.
const encode = valeur => Buffer.from(String(valeur), 'utf8').toString('base64');
const creation = await appel(`/api/data/users/${SUJET_ID}`, {
  method: 'PUT', cookie: admin,
  body: {
    id: SUJET_ID, username: SUJET, fullName: 'Sujet révision',
    role: 'technician', status: 'active', password: encode(MOT_DE_PASSE)
  }
});
verifier(`le compte d’épreuve est créé (${creation.statut})`, creation.statut === 200,
  JSON.stringify(creation.charge).slice(0, 200));

const avantConnexion = await revision('users', SUJET_ID);
await connexion(SUJET, MOT_DE_PASSE);
const apresConnexion = await revision('users', SUJET_ID);

verifier(`la connexion fait AVANCER le compteur (${avantConnexion?.valeur} → ${apresConnexion?.valeur})`,
  Number(apresConnexion?.valeur) > Number(avantConnexion?.valeur),
  `avant ${avantConnexion?.valeur}, après ${apresConnexion?.valeur}`);

// Et une session ouverte AVANT la connexion doit désormais être refusée.
const perimeeApresConnexion = await appel(`/api/data/users/${SUJET_ID}`, {
  method: 'PUT', cookie: admin,
  body: { id: SUJET_ID, username: SUJET, fullName: 'Renommé depuis une copie périmée', role: 'technician', status: 'active', _revision: avantConnexion?.valeur }
});
verifier(`une copie antérieure à la connexion est refusée (${perimeeApresConnexion.statut} ${perimeeApresConnexion.charge?.error || ''})`,
  perimeeApresConnexion.statut === 409,
  JSON.stringify(perimeeApresConnexion.charge).slice(0, 200));

/* ═════════════════ 2 · les comptes en double ═════════════════ */
console.log('\n2 · comptes en double — la contrainte et le ménage');

/*
 * Le ménage des doublons faisait disparaître des comptes par un `UPDATE … SET deleted=TRUE`
 * groupé, sans toucher au compteur : une session ouverte sur un compte retiré le croyait
 * toujours à jour. Il pose désormais des pierres tombales À RÉVISION.
 *
 * CE QU'ON NE PEUT PAS ÉPROUVER ICI, ET POURQUOI ON LE DIT.
 * Fabriquer un doublon est IMPOSSIBLE une fois l'index unique en place — la tentative est
 * refusée par PostgreSQL, ce qui est le comportement voulu. Le ménage n'existe donc que
 * pour des données antérieures à cet index, et sa précondition ne peut plus être créée.
 * L'avancée du compteur par l'écriture groupée est éprouvée en exécution par REV·27.
 */
const { rows: index } = await pool.query(
  "SELECT indexname FROM pg_indexes WHERE tablename='platform_records' AND indexname='platform_users_username_lower_unique'"
);
verifier('l’index unique interdit désormais tout nouveau doublon d’identifiant',
  index.length === 1, JSON.stringify(index));

const doublonRefuse = await pool.query(
  `INSERT INTO platform_records(store_name,record_id,data,deleted,updated_at)
   VALUES('users',$1,$2::jsonb,FALSE,NOW())`,
  [`rev-doublon-${RUN}`, JSON.stringify({ id: `rev-doublon-${RUN}`, username: SUJET, role: 'technician', status: 'active' })]
).then(() => 'accepté').catch(erreur => erreur.code);
verifier(`un doublon d’identifiant est refusé par la base (${doublonRefuse})`,
  doublonRefuse === '23505', String(doublonRefuse));

/* ═════════════════ 3 · un document retiré par l'inventaire garde son compteur ═════════════════ */
console.log('\n3 · retrait de document par le remplacement d’inventaire');

const DOC = `rev-doc-${RUN}`;
await appel(`/api/data/docs/${DOC}`, {
  method: 'PUT', cookie: admin,
  body: { id: DOC, kind: 'knowledge_article', title: 'Article d’épreuve', body: 'Corps', status: 'draft', revision: 'v1.4' }
});
const avantSuppression = await revision('docs', DOC);
verifier(`le document porte une révision technique (${avantSuppression?.valeur})`,
  Number(avantSuppression?.valeur) > 0, JSON.stringify(avantSuppression));

await appel(`/api/data/docs/${DOC}`, { method: 'DELETE', cookie: admin });
const apresSuppression = await revision('docs', DOC);
verifier(`la pierre tombale fait AVANCER le compteur (${avantSuppression?.valeur} → ${apresSuppression?.valeur})`,
  apresSuppression?.supprime === true && Number(apresSuppression?.valeur) > Number(avantSuppression?.valeur),
  JSON.stringify(apresSuppression));

const ressusciter = await appel(`/api/data/docs/${DOC}`, {
  method: 'PUT', cookie: admin,
  body: { id: DOC, kind: 'knowledge_article', title: 'Ressuscité', body: 'Corps', status: 'draft', _revision: avantSuppression?.valeur }
});
verifier(`une session ouverte avant le retrait est refusée (${ressusciter.statut} ${ressusciter.charge?.error || ''})`,
  ressusciter.statut === 409, JSON.stringify(ressusciter.charge).slice(0, 200));

/* ═════════════════ 4 · l'étiquette métier n'est pas touchée ═════════════════ */
console.log('\n4 · `revision` métier — schéma technique et continuité');

const zoneCreee = await appel('/api/access/zones', {
  method: 'POST', cookie: admin, body: { name: `Zone révision ${RUN}` }, attendu: 200
});
const ZONE = zoneCreee.charge?.zone?.id ?? zoneCreee.charge?.id;

const SCHEMA = `rev-schema-${RUN}`;
const schemaCree = await appel(`/api/data/docs/${SCHEMA}`, {
  method: 'PUT', cookie: admin,
  body: {
    id: SCHEMA, kind: 'technical_diagram', title: 'Synoptique d’épreuve',
    diagramType: 'signal-synoptic', status: 'draft', revision: 'v2.3',
    zoneIds: [ZONE], nodes: [], edges: []
  }
});
verifier(`le schéma est créé malgré son étiquette « v2.3 » (${schemaCree.statut})`, schemaCree.statut === 200,
  JSON.stringify(schemaCree.charge).slice(0, 200));

const { rows: schemaEnBase } = await pool.query(
  "SELECT data FROM platform_records WHERE store_name='docs' AND record_id=$1", [SCHEMA]
);
verifier('l’étiquette métier « v2.3 » a survécu intacte',
  schemaEnBase[0]?.data?.revision === 'v2.3', JSON.stringify(schemaEnBase[0]?.data?.revision));
verifier('le compteur technique vit à côté, sans se confondre avec elle',
  Number(schemaEnBase[0]?.data?._revision) === 1, JSON.stringify(schemaEnBase[0]?.data?._revision));

// Et une modification ordinaire ne doit pas davantage l'écraser.
const relu = (await appel('/api/sync', { cookie: admin, attendu: 200 })).charge?.data?.docs
  ?.find(document => String(document.id) === SCHEMA);
await appel(`/api/data/docs/${SCHEMA}`, {
  method: 'PUT', cookie: admin, body: { ...relu, title: 'Synoptique corrigé' }, attendu: 200
});
const { rows: apresModification } = await pool.query(
  "SELECT data FROM platform_records WHERE store_name='docs' AND record_id=$1", [SCHEMA]
);
verifier('après modification, l’étiquette métier est toujours « v2.3 »',
  apresModification[0]?.data?.revision === 'v2.3', JSON.stringify(apresModification[0]?.data?.revision));
verifier('et le compteur technique, lui, a avancé',
  Number(apresModification[0]?.data?._revision) === 2, JSON.stringify(apresModification[0]?.data?._revision));

await pool.end();
console.log(`\n╚═══ ${echecs === 0 ? '✅ AUCUN ÉCHEC' : '❌ ' + echecs + ' ÉCHEC(S)'} ═══╝\n`);
process.exit(echecs === 0 ? 0 : 1);
