import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * #137 — LE JEU DE DONNÉES A CHANGÉ D'ADRESSE, PAS DE CONTENU.
 *
 * Ces vérifications portent sur les libellés, les repères et les invariants de la Grille
 * Centrale. Ils vivaient dans un module servi au navigateur ; ils vivent désormais sous
 * `scripts/private-operational-data/`, que le serveur refuse de servir. Le test les lit à
 * leur nouvelle adresse : Node y a accès, HTTP non — et c'est précisément ce que ce lot
 * établit. Aucune assertion n'est relâchée.
 */

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const batch8 = read('equipment-image-coverage-batch8.js');
const grille = read('scripts/private-operational-data/grille-centrale.js');
const grilleEcran = read('grille-centrale-knowledge.js');
const linkage = read('equipment-media-linkage.js');
const operations = read('operations-suite.js');
const media = read('equipment-media.js');
const bridge = read('equipment-360-host-bridge.js');
const index = read('index.html');
const worker = read('service-worker.js');

const pos = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `${token} doit être présent`);
  return value;
};

test('batch 8 promeut uniquement l’image Cisco C9300X-12Y exacte servie par Cisco', () => {
  assert.match(batch8, /id:'kb-cisco-c9300x12y'/);
  assert.match(batch8, /nb-06-cat9300-architecture-cte-en_7\.png/);
  assert.match(batch8, /'www\.cisco\.com':'manufacturer-direct'/);
  assert.match(batch8, /modelMatch:'exact'/);
  assert.match(batch8, /requiresFieldConfirmation:false/);
  assert.match(batch8, /verificationStatus:'verified'/);
});

test('batch 8 documente les sources constructeur sans fausse promotion pour Decimator Fortinet et Imagine', () => {
  for (const id of ['kb-decimator-dmonquad','kb-fortigate40f','kb-imagine-platinum-vx']) {
    assert.match(batch8, new RegExp(`id:'${id}'`));
  }
  assert.match(batch8, /DMON-QUAD/);
  assert.match(batch8, /docs\.fortinet\.com/);
  assert.match(batch8, /imaginecommunications\.com/);
  assert.match(batch8, /source-page-known/);
});

test('le clic sur le nom équipement est routé vers la Fiche 360 par operations-suite', () => {
  assert.match(operations, /function patchEquipmentQuickView\(\)/);
  assert.match(operations, /Equipements\.prototype\.showQuickView = async function\(eq\)/);
  assert.match(operations, /return await openEquipment360\(eq\)/);
  assert.match(operations, /modal\.id = 'ops-equipment-360'/);
});

test('le pont 360 intercepte le modal monté sous body et le place sous app pour déclencher tous les enrichisseurs', () => {
  assert.match(bridge, /observer\.observe\(document\.body, \{ childList:true, subtree:false \}\)/);
  assert.match(bridge, /modal\.id !== 'ops-equipment-360'/);
  assert.match(bridge, /app\.appendChild\(modal\)/);
  assert.match(bridge, /modal\.dataset\.observerBridge = 'app'/);
});

test('la fiche 360 garde les photos terrain, toutes les vues constructeur et tous les candidats', () => {
  assert.match(media, /Photos réelles 2M/);
  assert.match(media, /Photos constructeur du modèle/);
  assert.match(media, /media\.officials\.map/);
  assert.match(media, /Visuels externes candidats/);
  assert.match(media, /media\.candidates\.map/);
});

test('la Grille Centrale conserve 190x184 interne et documente séparément la preuve Harris 190x190', () => {
  assert.match(grille, /190 entrées × 184 sorties/);
  assert.match(grille, /Harris Broadcast/);
  assert.match(grille, /190×190 HARRIS/);
  assert.match(grille, /Écart de dimension à résoudre/);
  assert.match(grille, /Ne pas modifier la matrice 2M/);
  assert.match(grille, /Équipement distinct de GRILLE72 72×72/);
});

test('la Grille Centrale expose rôle, synchro, contrôle, monitoring et câblage dans la Fiche 360', () => {
  for (const token of ['SYNCH 1','SYNCH 2','SYNCH 3','SYNCH 4','XY-1','XY-2','ENET-1','ENET-2','SERIAL 1','SERIAL 2','MONITORING/OUT.1','MONITORING/OUT.2','GR1–GR945','GR1001–GR1032']) {
    assert.ok(grille.includes(token), `${token} doit être documenté`);
  }
  // La fusion se fait toujours au même endroit ; ses deux sources arrivent toujours du jeu
  // de données autorisé au lieu d'être figées dans l'écran (#137). Ce contrat est intact.
  //
  // Seule la DESTINATION a changé (#166) : `technicalFacts` et `ports` sont deux champs
  // sous contrat — `equipment-knowledge-contract.js` n'accepte qu'une `key` de profil
  // déclarée, `connectivity-contract.js` que `IN`/`OUT`/`IN/OUT`. Les faits de la Grille
  // portent `{ id, label, source }` et ses interfaces `INTERNAL`/`CONTROL` : le serveur
  // rejetait donc l'écriture ENTIÈRE, en 400, dès qu'un équipement Grille existait pour la
  // recevoir. Ce que ces deux lignes vérifiaient n'a jamais pu être persisté ; elles
  // vérifient désormais la même fusion, vers les champs que la Grille possède.
  assert.match(grilleEcran, /grilleCentraleFacts:mergeById\(equipment\.grilleCentraleFacts, seed\.facts\)/);
  assert.match(grilleEcran, /grilleCentralePorts:mergeById\(equipment\.grilleCentralePorts, seed\.ports\)/);
  assert.match(grilleEcran, /const dataset = await loadGrilleCentraleDataset\(\{ revalidate, ouverture \}\);/);
  assert.match(grille, /Crosspoints actifs/);
  assert.match(grille, /Non déduits/);
});

test('la Grille Centrale garde une image Harris Platinum seulement comme candidat de comparaison terrain', () => {
  assert.match(grille, /alliedbroadcast\.com\/web\/image\/product\.template\/36959\/image_1920/);
  assert.match(grille, /sourceTrust:'trusted-broadcast-reseller'/);
  assert.match(grille, /verificationStatus:'candidate'/);
  assert.match(grille, /modelMatch:'capacity-compatible-family-example'/);
  assert.match(grille, /requiresFieldConfirmation:true/);
  assert.match(grille, /Harris Platinum PT-FR-15/);
  assert.match(grille, /pas une photo confirmée de la Grille Centrale 2M/);
  assert.match(grille, /Ne pas promouvoir le candidat comme photo constructeur/);
  assert.doesNotMatch(grille, /officialImage\s*:/);
});

test('la Grille Centrale conserve aussi les trois références de preuve internes', () => {
  for (const ref of ['13e8234a-5a25-4c4a-87c8-0988ca5cae57.png','033683b8-b181-4058-8215-70d26e655438.png','8417a9d0-050b-40aa-ae83-26b3207274f4.png']) {
    assert.ok(grille.includes(ref));
  }
  assert.match(grille, /aucune photo physique confirmée/);
});

test('la liaison média attend batch 8 et la connaissance Grille Centrale', () => {
  assert.match(linkage, /ensureEquipmentImageCoverageBatch8/);
  assert.match(linkage, /ensureGrilleCentraleKnowledge/);
  // La table n'écrit plus la clé en dur : elle réutilise l'identifiant canonique et la
  // liste d'alias déjà publiés par le module de connaissance, source unique depuis #137.
  assert.match(linkage, /GRILLE_CENTRALE_CATALOG_ID/);
  assert.match(linkage, /GRILLE_CENTRALE_ALIASES/);
  assert.match(linkage, /'kb-cisco-c9300x12y'/);
});

test('le shell et la PWA embarquent batch 8 Grille Centrale et le pont 360 dans le bon ordre', () => {
  const batch7 = pos(index, 'src="equipment-image-coverage-batch7.js"');
  const batch8Pos = pos(index, 'src="equipment-image-coverage-batch8.js"');
  const grillePos = pos(index, 'src="grille-centrale-knowledge.js"');
  const linkagePos = pos(index, 'src="equipment-media-linkage.js"');
  const mediaPos = pos(index, 'src="equipment-media.js"');
  const bridgePos = pos(index, 'src="equipment-360-host-bridge.js"');
  assert.ok(batch7 < batch8Pos && batch8Pos < grillePos && grillePos < linkagePos);
  assert.ok(mediaPos < bridgePos);
  for (const asset of ['/equipment-image-coverage-batch8.js','/grille-centrale-knowledge.js','/equipment-360-host-bridge.js']) {
    assert.ok(worker.includes(`'${asset}'`));
  }
});
