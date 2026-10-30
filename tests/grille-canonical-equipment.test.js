/**
 * @file tests/grille-canonical-equipment.test.js — #166 GRILLE-CANONICAL-01.
 *
 * CE QUE CES ÉPREUVES TIENNENT
 * -----------------------------
 * Le jeu de données protégé de la Grille Centrale ne se refuse plus À TOUT LE MONDE, mais
 * il ne s'ouvre pas non plus « parce qu'un rôle paraît puissant » : il s'ouvre parce qu'un
 * ÉQUIPEMENT canonique existe, porte le lien de catalogue, et se trouve dans une baie,
 * dans une salle, donc dans une zone.
 *
 * Elles éprouvent donc trois choses, et pas une de plus :
 *   · la fiche canonique ne contient QUE de la provenance documentée (rien d'inventé) ;
 *   · elle satisfait la résolution du serveur, sans que la règle de résolution ne bouge ;
 *   · le bootstrap crée une fois, ne corrige jamais, et ne pose JAMAIS de doublon.
 *
 * Aucune dépendance de développement : les deux chaînes d'intégration installent avec
 * `npm install --omit=dev`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildGrilleCentraleOperationalSeed,
  buildGrilleCentraleKnowledgeSeed,
  GRILLE_CENTRALE_CATALOG_ID,
  GRILLE_CENTRALE_ALIASES,
  GRILLE_CENTRALE_EQUIPMENT_ID,
  GRILLE_CENTRALE_ROOM_ID,
  GRILLE_CENTRALE_BAIE_ID
} from '../scripts/private-operational-data/grille-centrale.js';
import { ensureGrilleCentraleOperationalRecords, BOOTSTRAP_MARKER_ID } from '../scripts/grille-centrale-operational-bootstrap.js';
import { createAccessControl } from '../scripts/access-control.js';
import { estReconnuParLesEcransPublics } from '../scripts/grille-centrale-identity.js';
import {
  matchesPublicGrilleIdentity,
  declaresForeignCatalogIdentity,
  GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS,
  GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS
} from '../grille-centrale-public-identity.js';
import { resolveGrilleCentraleCandidate } from '../scripts/grille-centrale-identity.js';
import { resolveCatalogIdForMedia } from '../equipment-media-linkage.js';
import { validateEquipmentKnowledge } from '../equipment-knowledge-contract.js';

const lire = fichier => fs.readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');

/** Un magasin en mémoire qui répond comme `access.list`/`access.put`. */
function magasinDouble(initial = {}) {
  const donnees = new Map(Object.entries(initial).map(([nom, liste]) => [nom, [...liste]]));
  const ecritures = [];
  return {
    ecritures,
    access: {
      list: async nom => [...(donnees.get(nom) || [])],
      get: async (nom, id) => (donnees.get(nom) || []).find(item => String(item.id) === String(id)) || null,
      put: async (nom, id, enregistrement) => {
        ecritures.push({ magasin: nom, id: String(id) });
        const liste = donnees.get(nom) || [];
        donnees.set(nom, [...liste.filter(item => String(item.id) !== String(id)), enregistrement]);
        return enregistrement;
      }
    }
  };
}

/** Un `pool` PostgreSQL factice : `list()` ne fait qu'une requête, on la sert nous-mêmes. */
const poolDouble = equipments => ({
  query: async () => ({ rows: equipments.map(data => ({ record_id: String(data.id), data, updated_at: new Date() })) })
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — LA PROVENANCE : CE QUI EST ÉCRIT, ET CE QUI RESTE À CONFIRMER
 * ══════════════════════════════════════════════════════════════════════════ */

test('#166 · la fiche canonique ne porte que de la provenance documentée', () => {
  const { room, baie, equipment } = buildGrilleCentraleOperationalSeed();

  // Ce qui est affirmé l'est parce qu'une source le dit.
  assert.equal(equipment.catalogId, GRILLE_CENTRALE_CATALOG_ID);
  assert.equal(equipment.name, GRILLE_CENTRALE_ALIASES[0]);
  assert.equal(equipment.marque, 'Harris Broadcast');
  assert.equal(baie.name, 'BAIE 3 GRILLE CENTRALE');
  assert.equal(room.name, 'STC');
  assert.ok(equipment.sourceRef.includes('DT/EH/11/2011'), 'le document source doit être cité');
  assert.deepEqual(equipment.fieldEvidenceRefs, ['2m-field-06']);

  // Ce qui n'est pas prouvé n'est pas inventé.
  assert.equal(equipment.exactModelConfirmed, false);
  assert.match(equipment.modele, /à confirmer/i);
  for (const champ of ['numSerie', 'serialNumber', 'serial', 'rackPosition', 'rackUnit', 'chassisSku']) {
    assert.equal(equipment[champ], undefined, `« ${champ} » ne doit pas être deviné`);
  }
  assert.ok(equipment.grilleCentraleProvenance.toConfirm.length >= 4);

  // Le seul rattachement DÉDUIT se déclare comme tel.
  assert.equal(baie.containmentStatus, 'derived-from-inventory-zone');
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — ELLE SATISFAIT LA RÉSOLUTION, SANS QUE LA RÈGLE NE BOUGE
 * ══════════════════════════════════════════════════════════════════════════ */

test('#166 · le serveur résout la fiche canonique par son lien de catalogue', async () => {
  const { equipment } = buildGrilleCentraleOperationalSeed();
  const acces = createAccessControl(poolDouble([equipment]));
  const resolution = await acces.resolveGrilleCentraleEquipment();
  assert.equal(resolution.reason, 'catalog-id');
  assert.equal(resolution.equipment.id, GRILLE_CENTRALE_EQUIPMENT_ID);
});

test('#166 · sans fiche canonique, la résolution reste « not-found » — le refus n’a pas été affaibli', async () => {
  const acces = createAccessControl(poolDouble([{ id: 'regie-car-b2-tg1', name: 'TG 1', catalogId: 'kb-tektronix-tg8000' }]));
  assert.equal((await acces.resolveGrilleCentraleEquipment()).reason, 'not-found');

  /*
   * Le refus ne doit pas s'être ouvert par un chemin détourné. On lit la décision
   * elle-même : aucun court-circuit de rôle, aucune autorisation fondée sur la seule
   * existence du DOCUMENT de catalogue.
   */
  const source = lire('scripts/access-control.js');
  const decision = source.slice(source.indexOf('async function canReadGrilleCentraleDataset'));
  const corps = decision.slice(0, decision.indexOf('\n  }'));
  assert.ok(!/role\s*===\s*'admin'|isAdmin\(|seesEveryZone\(/.test(corps),
    'aucun court-circuit de rôle ne doit être écrit dans la décision Grille');
  assert.match(corps, /if \(!equipment\) return \{ allowed: false/);
  assert.match(corps, /canAccessRecord\(user, 'equipments', equipment, 'read', client\)/);
});

test('#166 · les QUATRE panneaux consomment le MÊME contrat public — aucune copie ne subsiste', () => {
  /*
   * Cette épreuve vérifiait que les trois écrans portant `grilleEquipmentMatches` comparaient
   * bien `catalogId` à la constante. Le contrat qu'elle défendait — les écrans reconnaissent
   * par le lien canonique et par l'alias court, rien d'autre — est intact, mais il ne peut
   * plus être vérifié copie par copie : IL N'Y A PLUS DE COPIE.
   *
   * Le quatrième panneau (`grille-centrale-topology.js`) échappait d'ailleurs à l'ancienne
   * version : il portait `equipmentMatches`, un filtre voisin mais différent — il lisait
   * `inventorySource.name` sans `reference`, les trois autres l'inverse. C'est exactement
   * l'écart que cette épreuve ne pouvait pas voir.
   */
  const PANNEAUX = ['grille-centrale-topology.js', 'grille-centrale-documented-map.js',
    'grille-centrale-physical-architecture.js', 'grille-centrale-field-verification.js'];

  for (const ecran of PANNEAUX) {
    const source = lire(ecran);
    assert.match(source, /import \{ matchesPublicGrilleIdentity \} from '\.\/grille-centrale-public-identity\.js';/,
      `${ecran} doit consommer le contrat public partagé`);
    assert.match(source, /const (grilleEquipmentMatches|equipmentMatches) = matchesPublicGrilleIdentity;/,
      `${ecran} ne doit pas garder sa propre définition`);
    assert.ok(!/function (grilleEquipmentMatches|equipmentMatches)\s*\(/.test(source),
      `${ecran} ne doit plus porter de filtre d’identité en propre`);
  }

  // Et le contrat lui-même : lien canonique, alias court, rien de plus.
  assert.equal(matchesPublicGrilleIdentity({ catalogId: GRILLE_CENTRALE_CATALOG_ID }), true);
  assert.equal(matchesPublicGrilleIdentity({ name: 'GRILLE CENTRALE' }), true);
  assert.equal(matchesPublicGrilleIdentity({ name: 'GRILLE CENTRALE 190x184' }), false);
  assert.equal(matchesPublicGrilleIdentity({ name: 'Armoire grille centrale secours' }), false);
});

test('#166 · le module qui POSE le lien canonique côté client lit la même liste de champs', () => {
  /*
   * LA CINQUIÈME COPIE, TROUVÉE EN NAVIGATEUR RÉEL.
   *
   * `grille-centrale-knowledge.js` écrit `catalogId` sur une fiche d'inventaire reconnue :
   * c'est LUI qui décide, côté poste, ce que les quatre panneaux verront ensuite. Il portait
   * sa propre liste de sept champs — exactement celle de `grille-centrale-topology.js` avant
   * cette revue, `reference` racine manquante. Une fiche dont la seule identité Grille vit
   * dans `reference` n'était donc jamais rattachée par le client.
   *
   * Mesuré sur PostgreSQL, Chromium, poste neuf : la fiche revenait de `/api/sync` sans lien
   * de catalogue, et ce module la rattachait — ou non — selon SA liste, pas celle du contrat.
   *
   * Il en sait légitimement plus que les panneaux : le jeu de données AUTORISÉ lui remet les
   * libellés documentés que #137 interdit de servir. Ce qui est vérifié ici, c'est qu'il les
   * cherche dans LES MÊMES champs, avec LA MÊME normalisation.
   */
  const source = lire('grille-centrale-knowledge.js');

  assert.match(source, /matchesPublicGrilleIdentity/,
    'le rapprochement client doit d’abord interroger le contrat public');
  assert.match(source, /GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS\.map/,
    'il doit parcourir la liste de champs du contrat, pas la sienne');
  assert.match(source, /GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS\.map/,
    'y compris pour les champs de la source d’inventaire');
  assert.ok(!/equipment\.inventorySource\?\.reference,\s*\n\s*equipment\.inventorySource\?\.label/.test(source),
    'il ne doit plus énumérer ses propres champs d’identité');
  assert.ok(!/const CATALOG_ID = 'kb-grille-centrale/.test(source),
    'la clé de catalogue vient du contrat, elle n’est plus recopiée ici');

  /*
   * L'INVARIANT : ce que les panneaux reconnaissent, le client le rattache. La première
   * ligne du rapprochement délègue au contrat — donc l'inclusion est structurelle, pas
   * une coïncidence de listes qui pourrait diverger à la prochaine modification.
   */
  const rapprochement = source.slice(source.indexOf('function exactGridMatch'));
  const corps = rapprochement.slice(0, rapprochement.indexOf('\n}'));
  assert.match(corps, /^\s*if \(matchesPublicGrilleIdentity\(equipment\)\) return true;/m,
    'le contrat public doit répondre AVANT toute recherche d’alias documenté');
});

test('#166 · le bootstrap pose salle → baie → équipement, dans cet ordre', async () => {
  const { ecritures, access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);

  assert.equal(rapport.created, 3);
  assert.deepEqual(ecritures.map(e => e.magasin), ['rooms', 'baies', 'equipments', 'docs'],
    'la salle et la baie doivent exister AVANT l’équipement (assertEquipmentLocationExists, #162)');
  assert.deepEqual(ecritures.map(e => e.id),
    [GRILLE_CENTRALE_ROOM_ID, GRILLE_CENTRALE_BAIE_ID, GRILLE_CENTRALE_EQUIPMENT_ID, BOOTSTRAP_MARKER_ID]);
});

test('#166 · une autorité qui efface n’est pas défaite au redémarrage suivant', async () => {
  /*
   * ROUGE, mesuré en intégration : `scripts/inventory-replace-e2e.mjs` installe l'inventaire
   * réel — `OPERATIONAL_RESET_STORES` retire `rooms`, `baies`, `equipments` — puis le serveur
   * redémarre. Un bootstrap qui crée « quand c'est absent » recréait la Grille :
   * 398 équipements au lieu de 397, 2 salles au lieu d'une, 2 baies au lieu d'une.
   *
   * « Créer une fois » et « créer quand c'est absent » ne sont pas la même règle. C'est la
   * première qui est juste : réinjecter ce que l'opérateur vient de retirer, c'est la
   * recréation spéculative fermée par #164/#165.
   */
  const { ecritures, access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  await ensureGrilleCentraleOperationalRecords(access);
  assert.ok(await access.get('docs', BOOTSTRAP_MARKER_ID), 'la trace doit être posée');

  // L'inventaire réel remplace les magasins opérationnels ; la trace, elle, survit.
  for (const magasin of ['equipments', 'rooms', 'baies']) {
    for (const enregistrement of await access.list(magasin)) {
      await access.put(magasin, enregistrement.id, enregistrement);
    }
  }
  const vide = magasinDouble({
    equipments: [], rooms: [], baies: [],
    docs: [await access.get('docs', BOOTSTRAP_MARKER_ID)]
  });
  const apres = await ensureGrilleCentraleOperationalRecords(vide.access);
  assert.equal(apres.created, 0, 'rien ne doit être recréé après un remplacement opérationnel');
  assert.equal(apres.skipped, 'already-bootstrapped');
  assert.equal(vide.ecritures.length, 0, 'aucune écriture, donc aucun équipement en trop');
  assert.equal(ecritures.filter(e => e.magasin === 'docs').length, 1, 'la trace ne porte aucune donnée d’installation, et ne se réécrit pas');
});

test('#166 · la trace du bootstrap ne porte aucune donnée d’installation', async () => {
  const { access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  await ensureGrilleCentraleOperationalRecords(access);
  const trace = await access.get('docs', BOOTSTRAP_MARKER_ID);
  const texte = JSON.stringify(trace);
  for (const fuite of ['BAIE 3', 'GRILLE CENTRALE', 'Harris', 'Platinum', 'STC', '190']) {
    assert.ok(!texte.includes(fuite), `la trace ne doit pas porter « ${fuite} »`);
  }
  // Et son `kind` n'est pas un document opérationnel : un remplacement ne l'emporte pas.
  assert.equal(trace.kind, 'platform_bootstrap_marker');
});

test('#166 · un second démarrage n’écrit rien', async () => {
  const { ecritures, access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  await ensureGrilleCentraleOperationalRecords(access);
  const apresPremier = ecritures.length;
  const rapport = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(rapport.created, 0);
  // La fiche canonique porte désormais le lien de catalogue : la résolution passe par lui,
  // et c'est un état d'arrivée stable. Aucune écriture n'en découle.
  assert.equal(rapport.skipped, 'catalog-id');
  assert.equal(ecritures.length, apresPremier, 'aucune écriture au second passage');
});

test('#166 · une fiche RÉELLE déjà présente n’est ni écrasée ni doublée', async () => {
  /*
   * Le cas qui compte : l'inventaire 2M a apporté la vraie fiche de l'appareil. Poser la
   * nôtre à côté rendrait la résolution AMBIGUË — donc fermerait le jeu de données.
   *
   * Deux formes, et deux conduites différentes : une fiche DÉJÀ reliée au catalogue est un
   * état d'arrivée, on n'y touche pas ; une fiche reconnue par un libellé documenté mais
   * sans lien reçoit ce lien, et rien d'autre (voir la matrice du bootstrap plus bas).
   */
  const dejaReliee = { id: 9202, name: 'GRILLE CENTRALE 190x184', catalogId: GRILLE_CENTRALE_CATALOG_ID };
  const { ecritures, access } = magasinDouble({ equipments: [dejaReliee], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(rapport.created, 0, 'aucune création quand la fiche réelle est déjà canonique');
  assert.deepEqual(ecritures.map(e => e.magasin), ['docs'], 'seule la trace est écrite : aucun écrasement');
  assert.equal((await access.get('equipments', 9202)).catalogId, GRILLE_CENTRALE_CATALOG_ID);

  const acces = createAccessControl(poolDouble([dejaReliee]));
  assert.ok((await acces.resolveGrilleCentraleEquipment()).equipment, 'la résolution reste décidable');
});

test('#166 · aucun module CLIENT ne compose la fiche canonique', () => {
  // §9 : consulter ne peut pas créer, parce qu'aucun actif servi ne sait la fabriquer.
  // `service-worker.js` liste les modules publics ; le bootstrap n'est pas des leurs.
  assert.ok(!lire('service-worker.js').includes('grille-centrale-operational-bootstrap'),
    'le bootstrap ne doit pas être un actif public');
  for (const ecran of ['grille-centrale-knowledge.js', 'grille-centrale-topology.js',
    'grille-centrale-documented-map.js', 'grille-centrale-physical-architecture.js',
    'grille-centrale-field-verification.js', 'field-evidence-integration.js']) {
    assert.ok(!lire(ecran).includes(GRILLE_CENTRALE_EQUIPMENT_ID),
      `${ecran} ne doit pas connaître l’identifiant canonique — il ne peut donc pas le créer`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * LES DEUX REJETS SERVEUR QUE #166 A RENDUS VISIBLES
 * ══════════════════════════════════════════════════════════════════════════ */

test('#166 · la fiche enrichie est acceptée par le contrat serveur (400 → 200)', () => {
  const { equipment } = buildGrilleCentraleOperationalSeed();
  const seed = buildGrilleCentraleKnowledgeSeed();

  /*
   * ROUGE, avant ce lot : `grille-centrale-knowledge.js` versait `seed.facts` dans
   * `technicalFacts` et `seed.ports` dans `ports`. Le serveur refusait l'écriture entière —
   * d'abord la clé, puis la direction — et la file de synchronisation empilait des `failed`
   * rejoués sans fin. Ces deux assertions sont les discriminants.
   */
  const ancienneForme = validateEquipmentKnowledge({ ...equipment, technicalFacts: seed.facts });
  assert.ok(ancienneForme.errors.length, 'les faits de la Grille ne satisfont pas le contrat `technicalFacts`');
  assert.equal(ancienneForme.value.technicalFacts.length, 0, 'aucun n’était retenu — ils n’arrivaient jamais');

  const formeActuelle = validateEquipmentKnowledge({
    ...equipment, grilleCentraleFacts: seed.facts, grilleCentralePorts: seed.ports
  });
  assert.deepEqual(formeActuelle.errors, []);
  assert.equal(formeActuelle.value.grilleCentraleFacts.length, seed.facts.length, 'les faits sont conservés');
  assert.equal(formeActuelle.value.grilleCentralePorts.length, seed.ports.length, 'les ports sont conservés');
});

test('#166 · l’enrichissement n’alimente plus les champs sous contrat', () => {
  const source = lire('grille-centrale-knowledge.js');
  const bloc = source.slice(source.indexOf('const equipments = await db.getAll'));
  assert.match(bloc, /grilleCentraleFacts:mergeById\(equipment\.grilleCentraleFacts, seed\.facts\)/);
  assert.match(bloc, /grilleCentralePorts:mergeById\(equipment\.grilleCentralePorts, seed\.ports\)/);
  assert.ok(!/technicalFacts:mergeById\(equipment\.technicalFacts, seed\.facts\)/.test(bloc),
    'les faits de la Grille ne doivent plus être versés dans `technicalFacts`');
  assert.ok(!/\bports:mergeById\(equipment\.ports, seed\.ports\)/.test(bloc),
    'les interfaces documentées ne doivent plus être versées dans `ports`');
});

test('#166 · la preuve terrain a préséance sur l’hypothèse documentaire', () => {
  // L'aller-retour mesuré : deux producteurs, les mêmes champs, deux forces. Le seed
  // documentaire pose la base et s'efface ensuite ; sinon la consultation réécrit sans fin.
  const connaissance = lire('grille-centrale-knowledge.js');
  assert.match(connaissance, /const dejaConfirme = Boolean\(confirmation && catalog\.fieldHardwareConfirmation\)/);
  assert.match(connaissance, /\.\.\.seed\.catalogFields,[\s\S]{0,200}\.\.\.champsConfirmes/,
    'les champs confirmés doivent être réappliqués APRÈS le seed documentaire');

  const topologie = lire('grille-centrale-topology.js');
  assert.match(topologie, /preserveWhen:'fieldEvidenceIntegrationVersion'/);
  assert.match(topologie, /\{ \.\.\.current, \.\.\.desired, \.\.\.conserves, id:desired\.id \}/,
    'les champs conservés doivent être réappliqués APRÈS le seed');

  // Et les champs protégés se DÉDUISENT du jeu de données, ils ne sont pas recopiés ici.
  const confirmation = buildGrilleCentraleKnowledgeSeed().fieldPhotoConfirmation;
  assert.ok(Object.keys(confirmation.catalogFields).includes('hardwareFamilyCandidateStatus'));
  assert.equal(confirmation.catalogFields.hardwareFamilyCandidateStatus, 'field-photo-confirmed');
  assert.ok(!topologie.includes('field-photo-confirmed'),
    'la topologie ne doit pas recopier les valeurs de la confirmation');
});

/* ══════════════════════════════════════════════════════════════════════════
 * L'IDENTITÉ EST UN CONTRAT UNIQUE — LE BOOTSTRAP ET LE SERVEUR NE PEUVENT PLUS DIVERGER
 *
 * ROUGE sur 2e8d32c : le dossier déclare cinq libellés légitimes ; le resolver serveur n'en
 * connaissait qu'un. Une fiche RÉELLE nommée « GRILLE CENTRALE 190x184 » était donc vue par
 * le bootstrap (qui s'abstenait et posait son marqueur) et ignorée par l'autorisation
 * (`not-found` → 403). Le marqueur gelait ensuite cette divergence : 403 permanent, sans
 * récupération automatique au redémarrage suivant.
 * ══════════════════════════════════════════════════════════════════════════ */

test('#166 · les DEUX côtés reconnaissent chaque libellé documenté — plus d’impasse d’identité', async () => {
  for (const alias of GRILLE_CENTRALE_ALIASES) {
    const fiche = { id: 9202, name: alias, nom: alias, catalogId: '', roomId: 'salle-stc', baieId: 'baie-3' };

    const resolution = await createAccessControl(poolDouble([fiche])).resolveGrilleCentraleEquipment();
    assert.ok(resolution.equipment, `le serveur doit résoudre « ${alias} » (était not-found)`);
    assert.equal(String(resolution.equipment.id), '9202');

    const { access } = magasinDouble({ equipments: [fiche], rooms: [], baies: [], docs: [] });
    const rapport = await ensureGrilleCentraleOperationalRecords(access);
    assert.equal(rapport.created, 0, `aucun doublon pour « ${alias} »`);

    // L'invariant qui manquait : le bootstrap ne s'abstient JAMAIS sur une fiche que le
    // serveur juge introuvable. Sinon le marqueur fige un 403 que rien ne peut lever.
    assert.notEqual(resolution.reason, 'not-found',
      `le marqueur ne doit pas geler une divergence sur « ${alias} »`);
    assert.equal(rapport.skipped, resolution.reason,
      `bootstrap et serveur doivent donner la MÊME raison pour « ${alias} »`);
  }
});

test('#166 · un nom seulement ressemblant n’est pas la Grille — aucun élargissement', async () => {
  for (const nom of ['Armoire GRILLE CENTRALE secours', 'grille centrale 72', 'GRILLE72', 'Grille']) {
    const fiche = { id: 7001, name: nom, nom, catalogId: '' };
    const resolution = await createAccessControl(poolDouble([fiche])).resolveGrilleCentraleEquipment();
    assert.equal(resolution.reason, 'not-found', `« ${nom} » ne doit pas être pris pour la Grille`);
  }
});

test('#166 · le contrat de résolution : catalogue, alias, ambiguïté, absence', async () => {
  const resolution = async fiches => createAccessControl(poolDouble(fiches)).resolveGrilleCentraleEquipment();
  const parCatalogue = id => ({ id, name: `fiche ${id}`, catalogId: GRILLE_CENTRALE_CATALOG_ID });

  assert.equal((await resolution([parCatalogue('a')])).reason, 'catalog-id');
  assert.equal((await resolution([{ id: 'b', name: 'Grille Centrale' }])).reason, 'name-alias');

  // L'ambiguïté FERME, et n'est pas assouplie : deux candidats, deux zones possibles.
  const deuxCatalogues = await resolution([parCatalogue('a'), parCatalogue('b')]);
  assert.equal(deuxCatalogues.reason, 'ambiguous-catalog-id');
  assert.equal(deuxCatalogues.equipment, null);
  assert.equal(deuxCatalogues.candidates, 2);

  const deuxAlias = await resolution([
    { id: 'a', name: 'GRILLE CENTRALE' }, { id: 'b', name: 'GRILLE CENTRALE 190x184' }
  ]);
  assert.equal(deuxAlias.reason, 'ambiguous-name-alias');
  assert.equal(deuxAlias.equipment, null);

  // Le lien de catalogue prime sur l'alias : une seule fiche liée décide, même en présence
  // d'homonymes.
  const catalogueEtAlias = await resolution([parCatalogue('a'), { id: 'b', name: 'Grille Centrale' }]);
  assert.equal(catalogueEtAlias.reason, 'catalog-id');
  assert.equal(catalogueEtAlias.equipment.id, 'a');

  assert.equal((await resolution([])).reason, 'not-found');
  assert.equal((await resolution([{ id: 'z', name: 'TG 1', catalogId: 'kb-tektronix-tg8000' }])).reason, 'not-found');
});

test('#166 · les écrans publics gardent leur forme étroite — la capacité ne revient pas dans le bundle', () => {
  /*
   * Trois des cinq alias portent « 190x184 », c'est-à-dire la CAPACITÉ de la matrice, que
   * #137 a retirée des actifs servis. Le contrat d'identité vit donc sous `scripts/`, et les
   * écrans n'y touchent pas : ils décident de ce qu'ils AFFICHENT, pas de ce qui est
   * autorisé. Cette épreuve empêche la dérive inverse.
   */
  // Ce qui doit rester dehors, ce sont les LIBELLÉS d'inventaire porteurs de la capacité —
  // pas la clé de catalogue `kb-grille-centrale-190x184`, qui est un identifiant machine
  // que le projet garde public à dessein et sur lequel s'appuie la résolution.
  const libellesSensibles = GRILLE_CENTRALE_ALIASES
    .filter(alias => /\d/.test(alias))
    .map(alias => alias.toLowerCase());
  assert.ok(libellesSensibles.length >= 3, 'le dossier doit bien déclarer des alias porteurs de capacité');

  for (const ecran of ['grille-centrale-documented-map.js', 'grille-centrale-physical-architecture.js',
    'grille-centrale-field-verification.js', 'grille-centrale-knowledge.js', 'grille-centrale-topology.js']) {
    const source = lire(ecran);
    assert.ok(!source.includes('grille-centrale-identity'),
      `${ecran} ne doit pas importer le contrat privé d’identité`);
    const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').toLowerCase();
    for (const libelle of libellesSensibles) {
      assert.ok(!sansCommentaires.includes(libelle),
        `${ecran} ne doit pas porter le libellé « ${libelle} »`);
    }
  }
  // Et le contrat, lui, est bien privé : `serve.js` refuse tout chemin sous `scripts`.
  assert.match(lire('scripts/serve.js'), /PRIVATE_PREFIXES = new Set\(\[[^\]]*'scripts'/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * §5 — LA MATRICE ACL, DANS LA CHAÎNE D'INTÉGRATION
 *
 * Les mesures navigateur du lot restent la preuve de bout en bout, mais elles ne tournent
 * pas en intégration : la chaîne n'exécute ni `grille-revocation-gate.mjs` ni la fiche 360.
 * Ce qui suit exerce la VRAIE décision — `canReadGrilleCentraleDataset()` — sur la vraie
 * ressource canonique, sans dépendance de développement et sans recopier la politique.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Un `pool` qui répond par magasin : `list()` filtre sur $1, `get()` sur $1 et $2. */
function poolMagasins(magasins = {}) {
  return {
    query: async (sql, params = []) => {
      const enregistrements = magasins[String(params[0])] || [];
      const lignes = enregistrements.map(data => ({ record_id: String(data.id), data, updated_at: new Date() }));
      if (params.length > 1) return { rows: lignes.filter(ligne => ligne.record_id === String(params[1])) };
      return { rows: lignes };
    }
  };
}

/** La Grille canonique, posée dans une baie, dans une salle, donc dans une zone. */
function siteGrille({ zoneDeLaSalle = 'zone-stc' } = {}) {
  const { room, baie, equipment } = buildGrilleCentraleOperationalSeed();
  return {
    equipments: [equipment],
    baies: [baie],
    rooms: [room],
    zones: [{ id: zoneDeLaSalle, name: 'STC' }, { id: 'zone-ailleurs', name: 'Ailleurs' }],
    resource_zones: [{ id: 'rz-1', resourceType: 'room', resourceId: room.id, zoneId: zoneDeLaSalle }],
    zone_memberships: [],
    zone_grants: []
  };
}

const PERMISSIONS_TECHNICIEN = ['zone.summary.read', 'equipment.read', 'screen.read', 'cable.read'];
const habilitations = (userId, zoneId) => PERMISSIONS_TECHNICIEN.map((permission, index) => ({
  id: `g-${userId}-${index}`, userId, zoneId, permission, status: 'active'
}));

async function decision(magasins, user) {
  return createAccessControl(poolMagasins(magasins)).canReadGrilleCentraleDataset(user);
}

test('#166 §5 · Admin et Manager reçoivent le jeu de données', async () => {
  const site = siteGrille();
  for (const role of ['admin', 'manager']) {
    const verdict = await decision(site, { id: `u-${role}`, role });
    assert.equal(verdict.allowed, true, `« ${role} » doit être autorisé`);
    assert.equal(verdict.reason, 'equipment-scope');
    assert.equal(verdict.equipmentId, GRILLE_CENTRALE_EQUIPMENT_ID);
  }
});

test('#166 §5 · un rôle à périmètre HABILITÉ sur la zone de la Grille est autorisé', async () => {
  const site = siteGrille();
  const sujet = { id: 'u-tech', role: 'technicien' };
  site.zone_memberships = [{ id: 'm-1', userId: sujet.id, zoneId: 'zone-stc', status: 'active' }];
  site.zone_grants = habilitations(sujet.id, 'zone-stc');

  const verdict = await decision(site, sujet);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.reason, 'equipment-scope');
});

test('#166 §5 · sans habilitation, sur une AUTRE zone, ou après révocation : refus', async () => {
  const sujet = { id: 'u-tech', role: 'technicien' };

  // Membre de la bonne zone, mais aucune habilitation.
  const sansHabilitation = siteGrille();
  sansHabilitation.zone_memberships = [{ id: 'm-1', userId: sujet.id, zoneId: 'zone-stc', status: 'active' }];
  let verdict = await decision(sansHabilitation, sujet);
  assert.equal(verdict.allowed, false, 'sans habilitation : refus');
  assert.equal(verdict.reason, 'equipment-forbidden');

  // Habilité, mais sur une zone qui ne porte pas la Grille.
  const mauvaiseZone = siteGrille();
  mauvaiseZone.zone_memberships = [{ id: 'm-1', userId: sujet.id, zoneId: 'zone-ailleurs', status: 'active' }];
  mauvaiseZone.zone_grants = habilitations(sujet.id, 'zone-ailleurs');
  verdict = await decision(mauvaiseZone, sujet);
  assert.equal(verdict.allowed, false, 'mauvaise zone : refus');

  // Habilitations révoquées, appartenance révoquée : le refus revient.
  const revoque = siteGrille();
  revoque.zone_memberships = [{ id: 'm-1', userId: sujet.id, zoneId: 'zone-stc', status: 'revoked' }];
  revoque.zone_grants = habilitations(sujet.id, 'zone-stc').map(g => ({ ...g, status: 'revoked' }));
  verdict = await decision(revoque, sujet);
  assert.equal(verdict.allowed, false, 'après révocation : refus');
});

test('#166 §5 · un rôle inconnu et une session absente sont refusés', async () => {
  const site = siteGrille();
  assert.equal((await decision(site, { id: 'u-x', role: 'supervisor-x' })).allowed, false);
  assert.equal((await decision(site, { id: 'u-x', role: 'supervisor-x' })).reason, 'unknown-role');
  assert.equal((await decision(site, null)).allowed, false);
});

test('#166 §5 · sans fiche canonique, MÊME l’administrateur est refusé — le fail-closed tient', async () => {
  const site = siteGrille();
  site.equipments = [];
  const verdict = await decision(site, { id: 'u-admin', role: 'admin' });
  assert.equal(verdict.allowed, false, 'un périmètre inconnu ferme, quel que soit le rôle');
  assert.equal(verdict.reason, 'not-found');
});

test('#166 §5 · deux candidats ferment aussi, pour tout le monde', async () => {
  const site = siteGrille();
  site.equipments = [...site.equipments, { ...site.equipments[0], id: 'doublon-gc' }];
  const verdict = await decision(site, { id: 'u-admin', role: 'admin' });
  assert.equal(verdict.allowed, false, 'une identification ambiguë ne s’ouvre pas');
  assert.equal(verdict.reason, 'ambiguous-catalog-id');
  assert.equal(verdict.candidates, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
 * LA MATRICE DU BOOTSTRAP ET DE SON MARQUEUR — A à G
 *
 * Deux règles distinctes, et c'est leur séparation qui compte :
 *   · CRÉER est gouverné par le marqueur — une autorité qui efface ne doit pas être défaite ;
 *   · RATTACHER ne l'est pas — compléter l'identité d'une fiche que l'opérateur a lui-même
 *     fournie n'est pas une résurrection, et le lien s'éteint de lui-même une fois posé.
 * ══════════════════════════════════════════════════════════════════════════ */

const marqueur = async access => access.get('docs', BOOTSTRAP_MARKER_ID);

test('#166 matrice A · aucune fiche Grille → la fiche canonique est créée, une fois', async () => {
  const { ecritures, access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  const premier = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(premier.created, 3);
  assert.equal((await marqueur(access)).decision, 'created');

  const second = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(second.created, 0);
  assert.equal(ecritures.filter(e => e.magasin === 'equipments').length, 1, 'un seul équipement, jamais deux');
});

test('#166 matrice B · fiche réelle DÉJÀ canonique → aucune mutation, aucun doublon', async () => {
  const reelle = { id: 4242, name: 'Grille du site', catalogId: GRILLE_CENTRALE_CATALOG_ID, numSerie: 'SN-9', roomId: 'r1' };
  const { ecritures, access } = magasinDouble({ equipments: [reelle], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(rapport.created, 0);
  assert.equal(rapport.linked, false);
  assert.deepEqual(ecritures.map(e => e.magasin), ['docs'], 'rien d’autre que la trace');
  assert.deepEqual(await access.get('equipments', 4242), reelle, 'la fiche réelle est inchangée, champ pour champ');
});

test('#166 matrice C · alias documenté unique sans catalogId → rattachée, ses données préservées', async () => {
  const reelle = {
    id: 'inv-9202', name: 'GRILLE CENTRALE 190x184', nom: 'GRILLE CENTRALE 190x184',
    roomId: 'salle-reelle', baieId: 'baie-reelle', marque: 'Harris', modele: 'PT-FR-15',
    numSerie: 'SN-REEL', statut: 'Opérationnel', inventoryKey: '2m-inventory:stc:19:1:grille'
  };
  const { access } = magasinDouble({ equipments: [reelle], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);

  assert.equal(rapport.created, 0, 'aucun doublon');
  assert.equal(rapport.linked, true);
  assert.equal((await marqueur(access)).decision, 'linked',
    'le marqueur ne dit « posé » qu’APRÈS que le rattachement a réussi');

  const apres = await access.get('equipments', 'inv-9202');
  assert.equal(apres.catalogId, GRILLE_CENTRALE_CATALOG_ID, 'seule l’identité est complétée');
  for (const champ of Object.keys(reelle)) {
    assert.equal(apres[champ], reelle[champ], `« ${champ} » doit être préservé`);
  }

  // Et le serveur la résout désormais par le lien canonique — le même chemin que les écrans.
  const resolution = await createAccessControl(poolDouble([apres])).resolveGrilleCentraleEquipment();
  assert.equal(resolution.reason, 'catalog-id');

  // Le rattachement s'éteint : un second passage n'écrit plus rien.
  const suivant = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(suivant.linked, false);
  assert.equal(suivant.skipped, 'catalog-id');
});

test('#166 matrice D · alias documenté + catalogId CONTRADICTOIRE → ferme, sans réassignation', async () => {
  const reelle = { id: 'inv-9202', name: 'GRILLE CENTRALE 190x184', catalogId: 'kb-imagine-platinum-vx' };
  const { ecritures, access } = magasinDouble({ equipments: [reelle], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);

  assert.equal(rapport.skipped, 'catalog-conflict');
  assert.equal(rapport.conflictingCatalogId, 'kb-imagine-platinum-vx');
  assert.equal(rapport.linked, false);
  assert.deepEqual(ecritures, [], 'un conflit n’écrit rien — pas même le marqueur');
  assert.equal(await marqueur(access), null, 'le marqueur ne doit pas clore un conflit non résolu');
  assert.equal((await access.get('equipments', 'inv-9202')).catalogId, 'kb-imagine-platinum-vx');
});

test('#166 matrice E · deux candidats → ambigu, fermé, et rien n’est figé', async () => {
  const deux = [
    { id: 'a', name: 'GRILLE CENTRALE' },
    { id: 'b', name: 'GRILLE CENTRALE 190x184' }
  ];
  const { ecritures, access } = magasinDouble({ equipments: deux, rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);

  assert.equal(rapport.skipped, 'ambiguous-name-alias');
  assert.equal(rapport.candidates, 2);
  assert.equal(rapport.created, 0);
  assert.deepEqual(ecritures, [], 'une ambiguïté n’écrit rien');
  assert.equal(await marqueur(access), null,
    'ne pas figer : l’opérateur peut encore retirer le doublon, et le bootstrap doit alors pouvoir agir');

  // Le serveur ferme de la même façon.
  assert.equal((await createAccessControl(poolDouble(deux)).resolveGrilleCentraleEquipment()).reason, 'ambiguous-name-alias');
});

test('#166 matrice F · remplacement autoritaire d’inventaire → aucune résurrection', async () => {
  const { access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  await ensureGrilleCentraleOperationalRecords(access);
  assert.ok(await marqueur(access));

  // L'inventaire réel remplace les magasins opérationnels ; la trace survit.
  const trace = await marqueur(access);
  const apresRemplacement = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [trace] });
  const rapport = await ensureGrilleCentraleOperationalRecords(apresRemplacement.access);
  assert.equal(rapport.created, 0);
  assert.equal(rapport.skipped, 'already-bootstrapped');
  assert.deepEqual(apresRemplacement.ecritures, [], 'rien n’est recréé');
});

test('#166 matrice G · suppression délibérée après bootstrap → reste supprimée', async () => {
  const { access } = magasinDouble({ equipments: [], rooms: [], baies: [], docs: [] });
  await ensureGrilleCentraleOperationalRecords(access);

  // L'opérateur retire la fiche. Le marqueur, lui, reste.
  const trace = await marqueur(access);
  const apresSuppression = magasinDouble({
    equipments: [], rooms: [], baies: [], docs: [trace]
  });
  const rapport = await ensureGrilleCentraleOperationalRecords(apresSuppression.access);
  assert.equal(rapport.created, 0);
  assert.deepEqual(apresSuppression.ecritures, []);

  // Sans équipement résoluble, le jeu de données se referme — c'est le comportement correct.
  const verdict = await createAccessControl(poolMagasins({ equipments: [] })).canReadGrilleCentraleDataset({ id: 'u', role: 'admin' });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, 'not-found');
});

/* ══════════════════════════════════════════════════════════════════════════
 * L'AUTORISATION NE DÉPASSE JAMAIS LA RECONNAISSANCE
 *
 * ROUGE sur 6d585ffc9608b5d713099e0ceffb491e270f8e3e : une fiche réelle
 * « GRILLE CENTRALE 190x184 » protégée par un administrateur était reconnue par le serveur
 * (`name-alias`) et autorisée (`equipment-scope`), alors que les écrans servis — qui ne
 * connaissent que le lien de catalogue ou l'alias COURT — ne la reconnaissaient pas :
 *
 *     serveur   allowed=true · reason=equipment-scope
 *     écrans    quatre panneaux false · 0 carte
 *
 * Deux états sont acceptables, et deux seulement :
 *   A. canonique et utilisable — le serveur reconnaît, l'ACL décide, les écrans rendent ;
 *   B. incomplète — le serveur ferme, et rien du jeu de données protégé ne sort.
 * L'état « serveur autorise / écran ne reconnaît pas » est désormais impossible.
 * ══════════════════════════════════════════════════════════════════════════ */

const ficheAdminAliasLong = alias => ({
  id: 'real-admin-gc', name: alias, nom: alias, origin: 'admin',
  roomId: 'salle-stc-reelle', baieId: 'baie-3-reelle',
  marque: 'Harris Broadcast', modele: 'Platinum PT-FR-15', numSerie: 'SN-ADMIN-1'
});

const siteAvecFiche = (equipment, { zoneDeLaSalle = 'zone-stc' } = {}) => ({
  equipments: [equipment],
  baies: [{ id: 'baie-3-reelle', name: 'BAIE 3', roomId: 'salle-stc-reelle' }],
  rooms: [{ id: 'salle-stc-reelle', name: 'STC' }],
  zones: [{ id: zoneDeLaSalle, name: 'STC' }],
  resource_zones: [{ id: 'rz-1', resourceType: 'room', resourceId: 'salle-stc-reelle', zoneId: zoneDeLaSalle }],
  zone_memberships: [], zone_grants: []
});

for (const alias of ['GRILLE CENTRALE 190x184', 'GRILLE CENTRALE 190×184']) {
  test(`#166 · « ${alias} » verrouillée par un administrateur : non retouchée, et le jeu de données FERME`, async () => {
    const fiche = ficheAdminAliasLong(alias);
    const { ecritures, access } = magasinDouble({ equipments: [fiche], rooms: [], baies: [], docs: [] });

    // 1. Le bootstrap respecte le verrou : il ne pose rien.
    const rapport = await ensureGrilleCentraleOperationalRecords(access);
    assert.equal(rapport.skipped, 'admin-locked');
    assert.equal(rapport.linked, false);
    assert.equal(rapport.created, 0, 'aucun doublon posé à côté de la fiche protégée');
    assert.deepEqual(ecritures, [], 'une fiche protégée n’est pas retouchée, marqueur compris');
    assert.equal((await access.get('equipments', fiche.id)).catalogId, undefined);

    // 2. Le marqueur n'a pas été écrit : une réparation explicite reste possible plus tard.
    assert.equal(await access.get('docs', BOOTSTRAP_MARKER_ID), null,
      'aucun marqueur ne doit empêcher une réparation explicite ultérieure');

    // 3. Le serveur la RECONNAÎT toujours, mais il n'AUTORISE plus.
    const acces = createAccessControl(poolMagasins(siteAvecFiche(fiche)));
    assert.equal((await acces.resolveGrilleCentraleEquipment()).reason, 'name-alias');
    for (const role of ['admin', 'manager', 'technicien']) {
      const verdict = await acces.canReadGrilleCentraleDataset({ id: `u-${role}`, role });
      assert.equal(verdict.allowed, false, `« ${role} » ne doit rien obtenir tant que le lien manque`);
      assert.equal(verdict.reason, 'canonical-link-required');
    }
  });

  test(`#166 · « ${alias} » après un rattachement EXPLICITE : l’ACL ordinaire reprend`, async () => {
    const reliee = { ...ficheAdminAliasLong(alias), catalogId: GRILLE_CENTRALE_CATALOG_ID };
    const site = siteAvecFiche(reliee);
    const acces = createAccessControl(poolMagasins(site));

    assert.equal((await acces.resolveGrilleCentraleEquipment()).reason, 'catalog-id');
    for (const role of ['admin', 'manager']) {
      const verdict = await acces.canReadGrilleCentraleDataset({ id: `u-${role}`, role });
      assert.equal(verdict.allowed, true, `« ${role} » doit à nouveau être autorisé`);
      assert.equal(verdict.reason, 'equipment-scope');
    }
    // Et l'ACL redevient l'ACL : un rôle à périmètre sans habilitation reste refusé.
    const refuse = await acces.canReadGrilleCentraleDataset({ id: 'u-tech', role: 'technicien' });
    assert.equal(refuse.allowed, false);
    assert.equal(refuse.reason, 'equipment-forbidden');

    // Le bootstrap n'a rien à faire sur une fiche déjà canonique.
    const { access } = magasinDouble({ equipments: [reliee], rooms: [], baies: [], docs: [] });
    const rapport = await ensureGrilleCentraleOperationalRecords(access);
    assert.equal(rapport.linked, false);
    assert.equal(rapport.skipped, 'catalog-id');
    assert.deepEqual((await access.get('equipments', reliee.id)), reliee, 'la fiche protégée reste intacte');
  });
}

test('#166 · l’alias COURT reste reconnu des deux côtés — c’est délibéré et documenté', () => {
  /*
   * `grille centrale` est le seul libellé que les écrans servis connaissent, et il est déjà
   * public (`grille-centrale-knowledge.js` l'exporte). Une fiche qui le porte est donc
   * reconnue par l'interface sans lien de catalogue : l'autorisation peut la suivre, il n'y
   * a pas d'écart. Ce comportement est intentionnel ; cette épreuve le fige.
   */
  for (const forme of ['GRILLE CENTRALE', 'Grille Centrale', 'grille centrale']) {
    assert.equal(estReconnuParLesEcransPublics({ name: forme }), true, `« ${forme} » est reconnu des écrans`);
  }
  // Et les libellés LONGS, eux, ne le sont pas : ils portent la capacité.
  for (const forme of ['GRILLE CENTRALE 190x184', 'Grille Centrale 190 x 184', 'GRILLE CENTRALE 190×184']) {
    assert.equal(estReconnuParLesEcransPublics({ name: forme }), false, `« ${forme} » n’est pas publié`);
    assert.equal(estReconnuParLesEcransPublics({ name: forme, catalogId: GRILLE_CENTRALE_CATALOG_ID }), true,
      'le lien de catalogue, lui, suffit');
  }
});

test('#166 · le serveur et les écrans appellent LA MÊME fonction, pas deux copies', () => {
  /*
   * La version précédente comparait le prédicat serveur au TEXTE de trois écrans. Elle ne
   * pouvait donc pas voir le quatrième — et c'est précisément là que l'écart se trouvait.
   * On ne compare plus deux textes : il n'y a plus qu'une fonction, et l'égalité de référence
   * le prouve mieux qu'aucune assertion de source.
   */
  assert.equal(estReconnuParLesEcransPublics, matchesPublicGrilleIdentity,
    'le serveur doit appeler la fonction des écrans, pas une reproduction');

  // Le contrat privé ne doit jamais être importé par du code servi.
  for (const ecran of ['grille-centrale-topology.js', 'grille-centrale-documented-map.js',
    'grille-centrale-physical-architecture.js', 'grille-centrale-field-verification.js',
    'grille-centrale-knowledge.js', 'grille-centrale-public-identity.js']) {
    // L'invariant porte sur l'IMPORT, pas sur la mention : le contrat public nomme le
    // contrat privé dans son commentaire pour expliquer la séparation, et c'est voulu.
    const sansCommentaires = lire(ecran).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/from\s+['"][^'"]*grille-centrale-identity[^'"]*['"]/.test(sansCommentaires),
      `${ecran} ne doit pas importer le contrat privé`);
    assert.ok(!/scripts\/(private-operational-data|grille-centrale-identity)/.test(sansCommentaires),
      `${ecran} ne doit atteindre aucun module privé`);
  }

  // Les champs retenus, un par un, avec le même verdict des deux côtés.
  for (const champ of ['name', 'nom', 'reference', 'modele', 'model']) {
    assert.equal(matchesPublicGrilleIdentity({ [champ]: 'GRILLE CENTRALE' }), true, `champ « ${champ} »`);
  }
  for (const champ of ['reference', 'label', 'name']) {
    assert.equal(matchesPublicGrilleIdentity({ inventorySource: { [champ]: 'Grille Centrale' } }), true,
      `champ « inventorySource.${champ} »`);
  }
  // Un champ délibérément NON retenu ne fabrique pas d'identité.
  assert.equal(matchesPublicGrilleIdentity({ description: 'GRILLE CENTRALE' }), false);
  assert.equal(matchesPublicGrilleIdentity({ marque: 'GRILLE CENTRALE' }), false);
});

test('#166 · l’état interdit « serveur autorise / écran ne reconnaît pas » est impossible', async () => {
  /*
   * Le contrat, éprouvé sur tous les cas de fiche que ce lot rencontre : dès que
   * l'autorisation dit oui, les écrans reconnaissent. Jamais l'inverse.
   */
  const cas = [
    ['canonique', { id: 'a', name: 'Grille du site', catalogId: GRILLE_CENTRALE_CATALOG_ID }],
    ['alias court', { id: 'b', name: 'GRILLE CENTRALE' }],
    ['alias long nu', { id: 'c', name: 'GRILLE CENTRALE 190x184' }],
    ['alias long verrouillé', { id: 'd', name: 'GRILLE CENTRALE 190×184', origin: 'admin' }],
    ['alias long relié', { id: 'e', name: 'Grille Centrale 190 x 184', catalogId: GRILLE_CENTRALE_CATALOG_ID }],
    ['catalogue étranger', { id: 'f', name: 'GRILLE CENTRALE 190x184', catalogId: 'kb-imagine-platinum-vx' }]
  ];
  for (const [nom, fiche] of cas) {
    const equipement = { ...fiche, roomId: 'salle-stc-reelle', baieId: 'baie-3-reelle' };
    const verdict = await createAccessControl(poolMagasins(siteAvecFiche(equipement)))
      .canReadGrilleCentraleDataset({ id: 'u-admin', role: 'admin' });
    if (verdict.allowed) {
      assert.equal(estReconnuParLesEcransPublics(equipement), true,
        `« ${nom} » : autorisé côté serveur, il DOIT être reconnu des écrans`);
    }
  }
});


/* ═══════════════════════════════════════════════════════════════════════════
 * LA PRÉSÉANCE — UN LIEN DE CATALOGUE DÉCLARÉ PASSE AVANT TOUT LIBELLÉ
 *
 * ROUGE sur `af4e14a4a0bd6575bf67363dd4451a7b8aed4c09`, fiche réelle portant
 * `catalogId = kb-imagine-platinum-vx` — un modèle qui EXISTE dans ce catalogue — et le
 * libellé COURT « GRILLE CENTRALE » :
 *
 *     resolver privé    name-alias · fiche retenue
 *     prédicat public   true
 *     autorisation      allowed=true · equipment-scope
 *     les 4 panneaux    true
 *
 * Idem avec `nom`, `reference`, `inventorySource.reference`. La revue 4 avait mis les quatre
 * panneaux et le serveur d'accord ; ils s'accordaient ici sur une identité FAUSSE, contre la
 * déclaration explicite de la fiche elle-même.
 *
 * L'épreuve « matrice D » ne pouvait pas le voir : elle utilise l'alias LONG, que le contrat
 * public ne reconnaît pas — elle fermait pour la mauvaise raison.
 *
 *   A. lien canonique            → la Grille ;
 *   B. lien présent et DIFFÉRENT → fermé, et le repli d'alias NE S'EXÉCUTE PAS ;
 *   C. aucun lien déclaré        → le repli d'alias opère.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CATALOGUE_ETRANGER = 'kb-imagine-platinum-vx';
const enBaie = fiche => ({ ...fiche, roomId: 'salle-stc-reelle', baieId: 'baie-3-reelle' });

test('#166 préséance 1 · alias court SANS lien → le repli d’alias opère, comme voulu', async () => {
  const fiche = enBaie({ id: 'p1', name: 'GRILLE CENTRALE' });
  assert.equal(matchesPublicGrilleIdentity(fiche), true);
  assert.equal(declaresForeignCatalogIdentity(fiche), false);
  assert.equal(resolveGrilleCentraleCandidate([fiche]).reason, 'name-alias');

  const verdict = await createAccessControl(poolMagasins(siteAvecFiche(fiche)))
    .canReadGrilleCentraleDataset({ id: 'u-admin', role: 'admin' });
  assert.equal(verdict.allowed, true, 'le comportement d’alias délibéré n’est pas retiré');
});

test('#166 préséance 2 · alias court + lien CANONIQUE → l’ACL ordinaire décide', async () => {
  const fiche = enBaie({ id: 'p2', name: 'GRILLE CENTRALE', catalogId: GRILLE_CENTRALE_CATALOG_ID });
  assert.equal(matchesPublicGrilleIdentity(fiche), true);
  assert.equal(resolveGrilleCentraleCandidate([fiche]).reason, 'catalog-id');

  const admin = await createAccessControl(poolMagasins(siteAvecFiche(fiche)))
    .canReadGrilleCentraleDataset({ id: 'u-admin', role: 'admin' });
  assert.equal(admin.allowed, true);
  assert.equal(admin.reason, 'equipment-scope');
});

test('#166 préséance 3 · alias court + catalogue ÉTRANGER VALIDE → fermé PARTOUT', async () => {
  const fiche = enBaie({ id: 'p3', name: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER });

  // Le contrat public, donc les quatre panneaux, qui l'appellent tous.
  assert.equal(declaresForeignCatalogIdentity(fiche), true);
  assert.equal(matchesPublicGrilleIdentity(fiche), false,
    'un libellé d’affichage ne renverse pas une identité de catalogue déclarée');

  // Le resolver privé : la fiche n'est pas candidate, et la cause est NOMMÉE.
  const resolution = resolveGrilleCentraleCandidate([fiche]);
  assert.equal(resolution.reason, 'catalog-conflict');
  assert.equal(resolution.equipment, null);
  assert.deepEqual(resolution.conflictingCatalogIds, [CATALOGUE_ETRANGER]);

  /*
   * L'autorisation, pour les trois familles de rôles. Le site monté ici ACCORDE la zone à
   * l'administrateur : si la décision atteignait `canAccessRecord` comme chemin d'ouverture,
   * elle dirait oui. Elle dit non — la préséance ferme AVANT.
   */
  const acces = createAccessControl(poolMagasins(siteAvecFiche(fiche)));
  for (const role of ['admin', 'manager', 'technicien']) {
    const verdict = await acces.canReadGrilleCentraleDataset({ id: `u-${role}`, role });
    assert.equal(verdict.allowed, false, `« ${role} » ne doit rien obtenir sur une identité en conflit`);
    assert.equal(verdict.reason, 'catalog-conflict',
      'la raison doit dire le conflit, pas un lien manquant : la fiche en déclare un');
    assert.equal(verdict.equipmentId, undefined, 'aucune fiche n’est retenue comme la Grille');
  }

  // Le bootstrap : rien réécrit, rien créé, rien figé.
  const { ecritures, access } = magasinDouble({ equipments: [fiche], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(rapport.skipped, 'catalog-conflict');
  assert.equal(rapport.created, 0, 'aucun DOUBLON canonique à côté de la fiche en conflit');
  assert.equal(rapport.linked, false);
  assert.deepEqual(ecritures, [], 'un conflit n’écrit rien — pas même le marqueur');
  assert.equal(await marqueur(access), null);
  assert.equal((await access.get('equipments', 'p3')).catalogId, CATALOGUE_ETRANGER,
    'le catalogue étranger est RESPECTÉ, jamais effacé automatiquement');
});

test('#166 préséance 4 · alias documenté LONG + catalogue étranger → fermé', async () => {
  for (const alias of ['GRILLE CENTRALE 190x184', 'GRILLE CENTRALE 190×184']) {
    const fiche = enBaie({ id: 'p4', name: alias, catalogId: CATALOGUE_ETRANGER });
    assert.equal(matchesPublicGrilleIdentity(fiche), false);
    assert.equal(resolveGrilleCentraleCandidate([fiche]).reason, 'catalog-conflict',
      `« ${alias} » + catalogue étranger doit dire le conflit`);
    const verdict = await createAccessControl(poolMagasins(siteAvecFiche(fiche)))
      .canReadGrilleCentraleDataset({ id: 'u-admin', role: 'admin' });
    assert.equal(verdict.allowed, false);
  }
});

test('#166 préséance 5 · CHAQUE champ public supporté + catalogue étranger → fermé', () => {
  /*
   * La liste des champs vient du contrat lui-même : ajouter un champ demain le fait entrer
   * ici automatiquement, et le veto devra tenir pour lui aussi.
   */
  for (const champ of GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS) {
    assert.equal(matchesPublicGrilleIdentity({ [champ]: 'GRILLE CENTRALE' }), true,
      `sans lien déclaré, « ${champ} » doit rester un repli valide`);
    assert.equal(matchesPublicGrilleIdentity({ [champ]: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER }), false,
      `« ${champ} » ne doit pas renverser un catalogue étranger`);
  }
  for (const champ of GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS) {
    assert.equal(matchesPublicGrilleIdentity({ inventorySource: { [champ]: 'GRILLE CENTRALE' } }), true);
    assert.equal(matchesPublicGrilleIdentity({ inventorySource: { [champ]: 'GRILLE CENTRALE' }, catalogId: CATALOGUE_ETRANGER }), false,
      `« inventorySource.${champ} » ne doit pas renverser un catalogue étranger`);
  }
});

test('#166 préséance 6 · réparation EXPLICITE étranger → canonique : tout reprend', async () => {
  const reparee = enBaie({ id: 'p6', name: 'GRILLE CENTRALE', catalogId: GRILLE_CENTRALE_CATALOG_ID, numSerie: 'SN-9' });

  assert.equal(matchesPublicGrilleIdentity(reparee), true);
  assert.equal(estReconnuParLesEcransPublics(reparee), true);
  assert.equal(resolveGrilleCentraleCandidate([reparee]).reason, 'catalog-id');

  const acces = createAccessControl(poolMagasins(siteAvecFiche(reparee)));
  const admin = await acces.canReadGrilleCentraleDataset({ id: 'u-admin', role: 'admin' });
  assert.equal(admin.allowed, true);
  assert.equal(admin.reason, 'equipment-scope');
  assert.equal(admin.equipmentId, 'p6');

  // Et le bootstrap n'y retouche pas : c'est un état d'arrivée stable.
  const { ecritures, access } = magasinDouble({ equipments: [reparee], rooms: [], baies: [], docs: [] });
  const rapport = await ensureGrilleCentraleOperationalRecords(access);
  assert.equal(rapport.skipped, 'catalog-id');
  assert.equal(rapport.created, 0);
  assert.deepEqual(ecritures.map(e => e.magasin), ['docs'], 'seule la trace du bootstrap est posée');
  assert.equal((await access.get('equipments', 'p6')).numSerie, 'SN-9', 'la fiche réparée reste intacte');
});

test('#166 préséance 7 · le rapprochement média n’écrase pas un catalogue étranger VALIDE', () => {
  /*
   * `equipment-media-linkage.js` est l'autre module qui écrit `catalogId` sur une fiche. Si
   * un alias pouvait lui faire remplacer un lien existant et valide, la préséance posée
   * ailleurs serait défaite par une écriture de fond.
   */
  const catalogues = [
    { id: CATALOGUE_ETRANGER, model: 'Platinum VX', family: 'Routeur', manufacturer: 'Imagine' },
    { id: GRILLE_CENTRALE_CATALOG_ID, model: 'Grille centrale — équipement documenté', family: 'Grille centrale', manufacturer: 'À identifier', inventoryAliases: ['GRILLE CENTRALE'] }
  ];
  const fiche = { id: 'p7', name: 'GRILLE CENTRALE', catalogId: CATALOGUE_ETRANGER };

  assert.equal(resolveCatalogIdForMedia(fiche, catalogues), CATALOGUE_ETRANGER,
    'un lien existant qui désigne un catalogue RÉEL est conservé tel quel');

  // Et le cas inverse reste vivant : sans lien, l'alias rapproche toujours.
  assert.equal(resolveCatalogIdForMedia({ id: 'p7b', name: 'GRILLE CENTRALE' }, catalogues),
    GRILLE_CENTRALE_CATALOG_ID);
});
