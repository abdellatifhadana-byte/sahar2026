/**
 * @file tests/equipement-salle-baie.test.js — DATA-AUTH-01, la salle suit la baie.
 *
 * L'INVARIANT
 * -----------
 *     Équipement → Baie → Salle → Localisation
 *
 * Quand un équipement appartient à une baie, sa salle canonique est celle de cette baie.
 * `equipment.baieId = B` avec `equipment.roomId ≠ B.roomId` ne doit jamais durer. Un
 * équipement SANS baie garde son `roomId` direct : c'est légitime, et ce n'est pas ce que
 * ces épreuves regardent.
 *
 * CE QUI ÉTAIT OUVERT, MESURÉ CONTRE UN VRAI SERVEUR
 * ---------------------------------------------------
 *   A · déplacer une baie      le seul écrivain qui rompt l'invariant SANS toucher au
 *                              moindre équipement. Aucune validation d'équipement ne
 *                              pouvait le voir, et le client réalignait après coup, fiche
 *                              par fiche, hors transaction.
 *   B · paire contradictoire   DÉJÀ refusée par le serveur (`INVALID_EQUIPMENT_LOCATION`).
 *                              Vérifié, et conservé tel quel.
 *   C · import / restauration  `/api/sync/bootstrap` ne vérifiait pas la localisation :
 *                              restaurer permettait de réintroduire en une requête ce que
 *                              l'écriture unitaire refuse.
 *   D · autorisation           `resolveResourceZones` lisait `roomId` AVANT la baie. Une
 *                              salle périmée ne faisait donc pas qu'afficher un mauvais
 *                              libellé : elle décidait de l'accès.
 *
 * Le bout en bout vit dans `scripts/data-auth-e2e.mjs`, contre PostgreSQL. Ici on éprouve
 * les pièces qui décident : la dérivation canonique, la requête de réalignement, et la
 * résolution de zone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyBaieLocation, mergeEquipmentRecord } from '../equipment-write-contract.js';
import { realignEquipmentRoomsForBaie } from '../scripts/revision-store.js';
import { createAccessControl } from '../scripts/access-control.js';

const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

/* ═══════════════ La dérivation canonique ═══════════════ */

test('LOC·1 — la salle d’un équipement en baie est celle de la baie', () => {
  const derive = applyBaieLocation(
    { id: 'eq', baieId: 'baie-x', roomId: 'ancienne-salle' },
    { id: 'baie-x', roomId: 'nouvelle-salle' }
  );
  assert.equal(derive.roomId, 'nouvelle-salle');
  assert.equal(derive.baieId, 'baie-x', 'le rattachement à la baie n’est pas touché');
});

test('LOC·2 — sans baie, la salle directe reste légitime', () => {
  const inchange = applyBaieLocation({ id: 'eq', roomId: 'salle-directe' }, { id: 'baie-x', roomId: 'autre' });
  assert.equal(inchange.roomId, 'salle-directe',
    'un équipement posé directement dans une salle n’a aucune baie dont il devrait suivre le sort');
});

test('LOC·3 — une baie sans salle ne fait rien deviner', () => {
  const inchange = applyBaieLocation({ id: 'eq', baieId: 'baie-x', roomId: 'salle-connue' }, { id: 'baie-x' });
  assert.equal(inchange.roomId, 'salle-connue',
    'une relation incomplète ne se devine pas : inventer un rattachement fabriquerait une vérité');
});

test('LOC·4 — une baie qui n’est pas la sienne ne déplace rien', () => {
  const inchange = applyBaieLocation(
    { id: 'eq', baieId: 'baie-x', roomId: 'salle-connue' },
    { id: 'baie-y', roomId: 'ailleurs' }
  );
  assert.equal(inchange.roomId, 'salle-connue');
});

test('LOC·6 — sans baie, une baie MALFORMÉE ne déplace rien non plus', () => {
  /*
   * Éprouvé parce qu'une mutation a survécu, et elle avait raison de survivre : retirer la
   * garde `next.baieId == null` semblait sans effet, puisque la comparaison des
   * identifiants qui suit rattrape presque tous les cas. Presque — car une baie sans `id`
   * donne `String(undefined) !== String(undefined)`, qui est FAUX. La comparaison laisse
   * alors passer, et un équipement qu'aucune baie ne situe se voit poser la salle d'un
   * objet qui n'en est pas une.
   *
   * Le cas ne vient pas du Runtime, où l'appel est toujours protégé par `baieId != null`.
   * Il vient de la fonction elle-même, qui est publique et sert de règle canonique : elle
   * doit tenir seule, sans compter sur la prudence de ses appelants.
   */
  const inchange = applyBaieLocation({ id: 'eq', roomId: 'salle-directe' }, { roomId: 'salle-de-nulle-part' });
  assert.equal(inchange.roomId, 'salle-directe',
    'un équipement sans baie ne suit aucune salle dérivée, même face à une baie sans identité');
  assert.equal(inchange.baieId, undefined);
});

test('LOC·5 — la fusion conserve la baie quand la charge ne la mentionne pas', () => {
  // Une charge partielle — un renommage, par exemple — ne doit pas détacher l'équipement
  // de sa baie par simple omission, sans quoi sa salle cesserait d'être dérivée.
  const fusion = mergeEquipmentRecord({ id: 'eq', baieId: 'baie-x', roomId: 'salle' }, { id: 'eq', name: 'Nouveau nom' });
  assert.equal(fusion.baieId, 'baie-x');
  assert.equal(fusion.roomId, 'salle');
});

/* ═══════════════ Le réalignement, dans la transaction de la baie ═══════════════ */

/** Un client PostgreSQL simulé qui retient la requête et rend ce qu'on lui dit. */
function clientSimule(lignes = []) {
  const requetes = [];
  return {
    requetes,
    async query(texte, parametres = []) {
      requetes.push({ texte, parametres });
      return { rows: lignes, rowCount: lignes.length };
    }
  };
}

test('REAL·1 — le réalignement écrit la salle ET fait avancer la révision', async () => {
  /*
   * Sans l'avancée de révision, une session restée ouverte sur l'ancienne version pourrait
   * réécrire la salle périmée sans être refusée — Batch B servirait à rien sur ce chemin —
   * et Batch C ne verrait pas passer le changement, si bien que l'écran garderait
   * l'ancienne salle.
   */
  const client = clientSimule([{ record_id: 'eq-1' }, { record_id: 'eq-2' }]);
  const resultat = await realignEquipmentRoomsForBaie(client, { baieId: 'baie-x', roomId: 'salle-b' });

  assert.equal(resultat.count, 2);
  assert.deepEqual(resultat.ids, ['eq-1', 'eq-2']);
  assert.equal(client.requetes.length, 1, 'un seul acte : la baie bouge avec tous ses équipements, ou rien ne bouge');

  const { texte, parametres } = client.requetes[0];
  assert.match(texte, /UPDATE platform_records/);
  assert.match(texte, /store_name = 'equipments'/);
  assert.match(texte, /deleted = FALSE/, 'une pierre tombale ne se réaligne pas');
  assert.match(texte, /data->>'baieId' = \$1/, 'seuls les équipements de CETTE baie');
  // Nommer le compteur ne suffit pas : il faut qu'il AVANCE. Une mutation qui retirait le
  // `+ 1` survivait à une assertion qui se contentait de trouver le nom du champ.
  assert.match(texte, /'\{_revision\}'/, 'le compteur doit être écrit');
  assert.match(texte, /COALESCE\(\(data->>'_revision'\)::int, 0\) \+ 1/,
    'la révision doit AVANCER, pas seulement être réécrite à sa valeur actuelle');
  assert.match(texte, /IS DISTINCT FROM/, 'on ne réécrit pas ce qui est déjà juste');
  assert.deepEqual(parametres, ['baie-x', '"salle-b"', 'salle-b']);
});

test('REAL·2 — une baie sans salle ne réaligne rien du tout', async () => {
  for (const salle of [null, undefined, '']) {
    const client = clientSimule();
    const resultat = await realignEquipmentRoomsForBaie(client, { baieId: 'baie-x', roomId: salle });
    assert.equal(resultat.count, 0);
    assert.equal(client.requetes.length, 0,
      `salle « ${salle} » : une relation incomplète ne doit produire aucune écriture`);
  }
});

test('REAL·3 — sans baie nommée, rien n’est écrit', async () => {
  const client = clientSimule();
  await realignEquipmentRoomsForBaie(client, { baieId: null, roomId: 'salle-b' });
  assert.equal(client.requetes.length, 0);
});

test('REAL·4 — la salle garde son type : un identifiant numérique ne devient pas du texte', async () => {
  // `jsonb_set` reçoit du JSON : passer `42` comme chaîne ferait diverger l'équipement de
  // sa salle pour toute comparaison ultérieure, y compris celle des zones.
  const client = clientSimule();
  await realignEquipmentRoomsForBaie(client, { baieId: 'baie-x', roomId: 42 });
  assert.deepEqual(client.requetes[0].parametres, ['baie-x', '42', '42']);
});

/* ═══════════════ Le serveur impose l'invariant, pas seulement l'écran ═══════════════ */

test('SRV·1 — le déplacement d’une baie et le réalignement sont une seule transaction', () => {
  /*
   * Le client réalignait après coup, fiche par fiche : `baies.js` sauvegarde la baie puis
   * boucle sur `db.save('equipments', …)`. Une panne au milieu laissait la baie déménagée
   * et une partie de ses équipements dans l'ancienne salle. La règle appartient au serveur,
   * qui est le seul point par lequel TOUS les écrivains passent — écran, import, sync.
   */
  const serveur = lire('scripts/serve.js');
  const debut = serveur.indexOf('const deplaceUneBaie');
  assert.notEqual(debut, -1, 'le déplacement de baie doit être reconnu comme tel');
  const bloc = serveur.slice(debut, debut + 1800);

  assert.match(bloc, /await client\.query\('BEGIN'\)/);
  assert.match(bloc, /realignEquipmentRoomsForBaie\(client, \{/,
    'le réalignement doit passer par le client de la transaction');
  assert.ok(bloc.indexOf('compareAndWrite') < bloc.indexOf('realignEquipmentRoomsForBaie'),
    'la baie s’écrit d’abord — sinon on réaligne sur une salle que le refus de version annulera');
  assert.ok(bloc.indexOf('realignEquipmentRoomsForBaie') < bloc.indexOf("client.query('COMMIT')"),
    'le réalignement doit être dans la transaction, pas après elle');
  assert.match(bloc, /ROLLBACK/, 'un échec ne doit jamais laisser un état partiel');
});

test('SRV·2 — l’import dérive la salle de la baie avant de valider', () => {
  // Restaurer une sauvegarde ancienne permettait de réintroduire en une requête toutes les
  // contradictions que l'écriture unitaire refuse depuis longtemps.
  const serveur = lire('scripts/serve.js');
  const debut = serveur.indexOf('body.data.equipments = body.data.equipments.map(normalizeIncomingEquipment)');
  assert.notEqual(debut, -1);
  const bloc = serveur.slice(debut, debut + 1600);
  assert.match(bloc, /applyBaieLocation\(record, baie\)/, 'l’import doit dériver la salle de la baie');
  assert.match(bloc, /assertEquipmentLocationExists\(record, bootstrapResourceLookup\)/,
    'et refuser ce qui reste vraiment ambigu, sans rien deviner');
  // On compare les APPELS, pas les mentions : le commentaire qui précède nomme aussi la
  // validation, et chercher le nom seul mesurerait l'ordre des phrases, pas celui du code.
  assert.ok(bloc.indexOf('applyBaieLocation(record, baie)') < bloc.indexOf('assertEquipmentLocationExists(record, bootstrapResourceLookup)'),
    'dériver d’abord : sinon une salle recalculable ferait échouer toute la restauration');
});

test('SRV·3 — l’écran ne repousse plus les équipements vers le serveur', () => {
  /*
   * Les deux écrans qui déplacent une baie poussaient une écriture PAR ÉQUIPEMENT, hors
   * transaction. Maintenant que le serveur réaligne lui-même, ces écritures seraient
   * doublement fautives :
   *
   *   · une tempête d'écritures proportionnelle à la taille de la baie ;
   *   · un `409` garanti sur chacune — le serveur vient d'avancer leur révision, et la
   *     copie que l'écran tient en main date d'avant le déplacement. L'utilisateur verrait
   *     un conflit par équipement pour une opération qui a parfaitement réussi.
   *
   * La projection locale est corrigée pour ne pas mentir à l'écran pendant les vingt
   * secondes qui séparent de l'instantané suivant. Rien de plus.
   */
  for (const fichier of ['baies.js', 'map-admin-entity-edit.js']) {
    const source = lire(fichier);
    const debut = source.indexOf('if (roomChanged)');
    assert.notEqual(debut, -1, `${fichier} : le cas du changement de salle est introuvable`);
    const bloc = source.slice(debut, source.indexOf('\n', source.indexOf('}', debut + 200)));
    assert.match(bloc, /saveLocalOnly\('equipments'/,
      `${fichier} doit corriger la projection locale sans repartir vers le serveur`);
    assert.doesNotMatch(bloc, /db\.save\('equipments'/,
      `${fichier} ne doit plus republier les équipements : le serveur l’a déjà fait, dans sa transaction`);
  }
});

/* ═══════════════ L'autorisation suit la baie, pas un reflet périmé ═══════════════ */

function poolSimule(records) {
  return { async query(sql, params = []) {
    if (sql.startsWith('SELECT data FROM')) {
      return { rows:(records[params[0]] || []).filter(item => String(item.id) === String(params[1])).map(data => ({ data })) };
    }
    if (sql.startsWith('SELECT record_id,data')) return { rows:(records[params[0]] || []).map(data => ({ data })) };
    throw new Error(`Requête inattendue: ${sql}`);
  } };
}

test('ZONE·1 — un équipement en baie prend la zone de sa baie, pas celle de son roomId', async () => {
  /*
   * C'est la conséquence qui dépasse l'affichage. Tant que le `roomId` stocké passait en
   * premier, une salle périmée accordait l'accès à qui possédait l'ANCIENNE salle et le
   * refusait à qui possède la nouvelle. L'écriture maintient désormais l'invariant ; cette
   * lecture ne s'y fie pas pour autant, parce qu'une base héritée peut encore porter des
   * paires contredites — et une décision d'autorisation ne doit pas dépendre d'une migration.
   */
  const records = {
    rooms:[{ id:'ancienne', name:'Ancienne' }, { id:'nouvelle', name:'Nouvelle' }],
    baies:[{ id:'baie-x', name:'Baie X', roomId:'nouvelle' }],
    zones:[{ id:'zone-ancienne', name:'Ancienne' }, { id:'zone-nouvelle', name:'Nouvelle' }],
    resource_zones:[
      { id:'m1', resourceType:'room', resourceId:'ancienne', zoneId:'zone-ancienne' },
      { id:'m2', resourceType:'room', resourceId:'nouvelle', zoneId:'zone-nouvelle' }
    ]
  };
  const access = createAccessControl(poolSimule(records));

  assert.deepEqual(
    await access.resolveResourceZones('equipments', { id:'eq-1', baieId:'baie-x', roomId:'ancienne' }),
    ['zone-nouvelle'],
    'la baie fait autorité, même quand le `roomId` stocké dit encore l’ancienne salle'
  );
});

test('ZONE·2 — un équipement SANS baie garde la zone de sa salle', async () => {
  const records = {
    rooms:[{ id:'salle', name:'Salle' }],
    zones:[{ id:'zone-salle', name:'Salle' }],
    resource_zones:[{ id:'m1', resourceType:'room', resourceId:'salle', zoneId:'zone-salle' }]
  };
  const access = createAccessControl(poolSimule(records));
  assert.deepEqual(
    await access.resolveResourceZones('equipments', { id:'eq-2', roomId:'salle' }),
    ['zone-salle'],
    'le repli par salle directe reste le chemin normal pour un équipement hors baie'
  );
});

test('ZONE·3 — une zone explicite sur l’équipement l’emporte sur toute dérivation', async () => {
  // `resource_zones` est la source de vérité quand elle nomme la ressource elle-même :
  // dériver par-dessus reviendrait à ignorer une décision d'accès explicite.
  const records = {
    rooms:[{ id:'nouvelle', name:'Nouvelle' }],
    baies:[{ id:'baie-x', roomId:'nouvelle' }],
    zones:[{ id:'zone-explicite', name:'Explicite' }, { id:'zone-nouvelle', name:'Nouvelle' }],
    resource_zones:[
      { id:'m1', resourceType:'equipment', resourceId:'eq-3', zoneId:'zone-explicite' },
      { id:'m2', resourceType:'room', resourceId:'nouvelle', zoneId:'zone-nouvelle' }
    ]
  };
  const access = createAccessControl(poolSimule(records));
  assert.deepEqual(
    await access.resolveResourceZones('equipments', { id:'eq-3', baieId:'baie-x', roomId:'nouvelle' }),
    ['zone-explicite']
  );
});

test('ZONE·4 — une baie introuvable ne prive pas l’équipement de toute zone', async () => {
  // Sinon un rattachement cassé rendrait la fiche invisible à tout le monde, y compris à
  // qui doit la réparer.
  const records = {
    rooms:[{ id:'salle', name:'Salle' }],
    baies:[],
    zones:[{ id:'zone-salle', name:'Salle' }],
    resource_zones:[{ id:'m1', resourceType:'room', resourceId:'salle', zoneId:'zone-salle' }]
  };
  const access = createAccessControl(poolSimule(records));
  assert.deepEqual(
    await access.resolveResourceZones('equipments', { id:'eq-4', baieId:'baie-absente', roomId:'salle' }),
    ['zone-salle']
  );
});
