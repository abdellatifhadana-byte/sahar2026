import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const media = read('equipment-media.js');
const seed = read('equipment-image-seed.js');
const batch2 = read('equipment-image-coverage-batch2.js');
const batch3 = read('equipment-image-coverage-batch3.js');
const batch4 = read('equipment-image-coverage-batch4.js');
const batch5 = read('equipment-image-coverage-batch5.js');
const integrity = read('integrity-center.js');
const index = read('index.html');
const serviceWorker = read('service-worker.js');

function position(haystack, needle) {
  const value = haystack.indexOf(needle);
  assert.notEqual(value, -1, `${needle} doit être présent`);
  return value;
}

test('le système média sépare instance, constructeur et candidat', () => {
  assert.match(media, /sourceType:'instance'/);
  assert.match(media, /Photo réelle 2M/);
  assert.match(media, /Photo constructeur/);
  assert.match(media, /Visuel externe à vérifier/);
  assert.match(media, /primary:\s*real\[0\]\s*\|\|\s*official\s*\|\|\s*candidates\[0\]/);
});

test('une édition sans nouveau fichier ne supprime plus les photos existantes', () => {
  assert.match(media, /uploaded = Boolean\(form\.images\?\.files\?\.length\)/);
  assert.match(media, /!uploaded && incoming\.length === 0 && asArray\(equipment\.images\)\.length/);
  assert.match(media, /images:\[\.\.\.equipment\.images\]/);
});

test('les images externes exigent HTTPS et les Data URLs terrain sont limitées aux formats bitmap sûrs', () => {
  assert.match(media, /SAFE_DATA_IMAGE_RE/);
  assert.match(media, /png\|jpe\?g\|webp\|gif/);
  assert.match(media, /if \(\/\^data:\/i\.test\(raw\)\) return ''/);
  assert.match(media, /url\.protocol === 'https:'/);
  assert.doesNotMatch(media, /svg\+xml/);
});

test('le seed v2 contient des images constructeur vérifiées et protège les choix Admin', () => {
  assert.match(seed, /EQUIPMENT_IMAGE_SEED_VERSION = 2/);
  assert.match(seed, /id:'kb-ross-ultrix'/);
  assert.match(seed, /rossvideo\.com\/wp-content\/uploads/);
  assert.match(seed, /id:'kb-sony-pdw-hd1200'/);
  assert.match(seed, /sony\.com\/image\/0ef023/);
  assert.match(seed, /id:'kb-sony-pdw-hd1550'/);
  assert.match(seed, /sony\.jp\/products\/picture\/PDW-HD1550\.jpg/);
  assert.match(seed, /sourceType:'manufacturer'/);
  assert.match(seed, /verificationStatus:'verified'/);
  assert.match(seed, /record\.officialImage\?\.origin === 'admin'/);
  assert.match(seed, /!adminImage && !record\.officialImage\?\.url/);
});

test('batch 1 documente les sources officielles des familles à fort impact sans promouvoir les visuels secondaires', () => {
  for (const id of ['kb-ross-sra8802','kb-ross-sfs8622a','kb-ross-dra8804','kb-ross-uda8705a','kb-aja-ogfsmini','kb-decimator-dmonquad','kb-dell-r450','kb-dell-r750','kb-cisco-c9300x12y']) {
    assert.match(seed, new RegExp(`id:'${id}'`), `${id} doit être couvert par le batch image`);
  }
  assert.match(seed, /sourcePage:'https:\/\/www\.aja\.com\/products\/og-fs-mini'/);
  assert.match(seed, /sourcePage:'https:\/\/www\.cisco\.com\/c\/en\/us\/products\/collateral\/switches/);
  assert.match(seed, /sourceType:'secondary-source'/);
  assert.match(seed, /verificationStatus:'candidate'/);
  assert.doesNotMatch(seed, /officialImage:\{[\s\S]{0,240}markertek\.com/i);
  assert.doesNotMatch(seed, /officialImage:\{[\s\S]{0,240}serverorbit\.com/i);
});

test('batch 2 distingue sources constructeur exactes et références qui exigent un SKU terrain', () => {
  for (const id of ['kb-ross-ultritouch','kb-ross-ada8405c','kb-ross-aap8644','kb-ross-dmx82594c','kb-ross-hdc8223as','kb-kaleido-solo','kb-decimator-dmon12s','kb-fortigate40f','kb-dell-r350','kb-dell-r550','kb-cobalt-9940aco','kb-imagine-platinum-vx','kb-tsl-tallyman']) {
    assert.match(batch2, new RegExp(`'${id}'`), `${id} doit avoir une source constructeur documentée`);
  }
  for (const id of ['kb-viewsonic24','kb-blackbox-kvm-generic','kb-genelec-monitor','kb-iiyama43','kb-maudio-device','kb-konvision24','kb-konvision21']) {
    assert.match(batch2, new RegExp(`'${id}'`), `${id} doit rester model-required`);
  }
  assert.match(batch2, /status:'model-required'/);
  assert.match(batch2, /modelRequired:true/);
  assert.match(batch2, /sourceType:'manufacturer'/);
  assert.doesNotMatch(batch2, /candidateImages/);
  assert.match(batch2, /record\.officialImage\?\.url/);
  assert.doesNotMatch(batch2, /officialImage\s*:/);
});

test('batch 2 ne remplace pas une décision image verrouillée par Admin', () => {
  assert.match(batch2, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch2, /record\?\.imageResearch\?\.locked === true/);
  assert.match(batch2, /if \(isAdminLocked\(record\)\) continue/);
});

test('batch 3 promeut seulement des assets constructeur directs et conserve les autres en candidats', () => {
  for (const id of ['kb-ross-opengear-ogx','kb-ross-rcp-me','kb-leader-lt4610']) {
    assert.match(batch3, new RegExp(`id:'${id}'`), `${id} doit recevoir une image constructeur vérifiée`);
  }
  assert.match(batch3, /rossvideo\.com\/wp-content\/uploads\/2018\/04\/oGx-Home\.jpg/);
  assert.match(batch3, /rossvideo\.com\/wp-content\/uploads\/2018\/06\/RCP-ME\.jpg/);
  assert.match(batch3, /leader\.co\.jp\/uploads\/2020\/11\/LT4610_02main_sp_1\.png/);
  assert.match(batch3, /VERIFIED_CANDIDATE_IMAGES/);
  assert.match(batch3, /sourceType:'secondary-source'/);
  assert.match(batch3, /verificationStatus:'candidate'/);
  assert.match(batch3, /officialImage:hadOfficial \? record\.officialImage : officialImage/);
  assert.doesNotMatch(batch3, /officialImage:[\s\S]{0,180}(manualslib|bhphotovideo|markertek|router-switch|ubuy|europc|videocraft)/i);
});

test('batch 3 couvre une nouvelle vague de modèles exacts sans toucher aux références model-required', () => {
  for (const id of ['kb-ross-ultritouch','kb-ross-mc1-panel16','kb-ross-mc1uhd','kb-ross-rcp-qe18','kb-kaleido-solo','kb-fortigate40f','kb-cisco-c9300x12y','kb-leader-lt4448','kb-leader-lv5350','kb-hp-z440','kb-dell-r350','kb-dell-r550','kb-imagine-platinum-vx']) {
    assert.match(batch3, new RegExp(`id:'${id}'`), `${id} doit avoir un visuel candidat documenté`);
  }
  for (const id of ['kb-viewsonic24','kb-blackbox-kvm-generic','kb-genelec-monitor','kb-iiyama43','kb-maudio-device','kb-konvision24','kb-konvision21']) {
    assert.doesNotMatch(batch3, new RegExp(`id:'${id}'`), `${id} ne doit pas recevoir de photo générique`);
  }
});

test('batch 3 respecte les décisions Admin et reste idempotent par URL', () => {
  assert.match(batch3, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch3, /record\?\.officialImage\?\.locked === true/);
  assert.match(batch3, /record\?\.imageResearch\?\.locked === true/);
  assert.match(batch3, /const seen = new Set\(\)/);
  assert.match(batch3, /seen\.has\(key\)/);
  assert.match(batch3, /mergeImages\(record\.candidateImages, \[candidateImage\]\)/);
});

test('batch 4 ajoute les images constructeur directes Ross openGear, AJA et Cobalt', () => {
  for (const id of ['kb-ross-sra8802','kb-ross-sfs8622a','kb-ross-dra8804','kb-ross-uda8705a','kb-ross-ada8405c','kb-ross-aap8644','kb-ross-hdc8223as','kb-ross-dmx82594c','kb-aja-ogfsmini','kb-cobalt-9940aco']) {
    assert.match(batch4, new RegExp(`id:'${id}'`), `${id} doit avoir un asset officiel batch 4`);
  }
  assert.match(batch4, /TRUSTED_IMAGE_HOSTS/);
  assert.match(batch4, /'www\.rossvideo\.com':'manufacturer-direct'/);
  assert.match(batch4, /'d26ddnfpy9hzf8\.cloudfront\.net':'manufacturer-cdn'/);
  assert.match(batch4, /'cobaltdigital\.com':'manufacturer-direct'/);
  assert.match(batch4, /sourceTrust:'manufacturer-direct'/);
  assert.match(batch4, /sourceTrust:'manufacturer-cdn'/);
  assert.match(batch4, /verificationStatus:'verified'/);
});

test('batch 4 autorise les sources techniques de confiance sans les confondre avec une image constructeur exacte', () => {
  for (const id of ['kb-axon-sfr08','kb-decimator-dmon12s']) {
    assert.match(batch4, new RegExp(`id:'${id}'`), `${id} doit avoir un candidat de confiance`);
  }
  assert.match(batch4, /trusted-technical-catalog/);
  assert.match(batch4, /verificationStatus:'candidate'/);
  assert.match(batch4, /SFR08\/SFR18/);
  assert.match(batch4, /confirmer le châssis SFR08 exact/);
  assert.match(batch4, /trustedImage\(entry\.image\)/);
  assert.match(batch4, /url\.protocol === 'https:'/);
  for (const id of ['kb-viewsonic24','kb-blackbox-kvm-generic','kb-genelec-monitor','kb-iiyama43','kb-maudio-device','kb-konvision24','kb-konvision21']) {
    assert.doesNotMatch(batch4, new RegExp(`id:'${id}'`), `${id} doit rester sans photo générique`);
  }
});

test('batch 4 protège Admin et enrichit les métadonnées sans dupliquer les URLs', () => {
  assert.match(batch4, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch4, /record\?\.imageResearch\?\.locked === true/);
  assert.match(batch4, /record\?\.officialImage\?\.origin === 'admin'/);
  assert.match(batch4, /record\?\.officialImage\?\.locked === true/);
  assert.match(batch4, /const merged = new Map\(\)/);
  assert.match(batch4, /merged\.set\(key, \{ \.\.\.previous, \.\.\.image \}\)/);
  assert.match(batch4, /officialImage:hadOfficial \? record\.officialImage : officialImage/);
});

test('batch 5 couvre les références broadcast legacy avec provenance et niveau de correspondance explicites', () => {
  for (const id of ['kb-tc-dbmax','kb-kramer-vs81av','kb-wohler-amp2am','kb-riedel-artist','kb-tsl-tallyman','kb-harmonic-spectrum-vsx']) {
    assert.match(batch5, new RegExp(`id:'${id}'`), `${id} doit avoir un candidat batch 5`);
  }
  assert.match(batch5, /dbmax-front\.jpeg/);
  assert.match(batch5, /vs-81av\.jpg/);
  assert.match(batch5, /Artist-1024-Front/);
  assert.match(batch5, /tm1-mk3plus-front-and-back-panel\.png/);
  assert.match(batch5, /VSX\.webp/);
  assert.match(batch5, /0929100156_5f728784ef9f3\.jpg/);
  assert.match(batch5, /modelMatch:'exact'/);
  assert.match(batch5, /modelMatch:'family-example'/);
  assert.match(batch5, /modelMatch:'successor-family'/);
  assert.match(batch5, /requiresFieldConfirmation:true/);
});

test('batch 5 garde les sources secondaires et successeurs en candidats, jamais en image officielle', () => {
  assert.match(batch5, /trusted-broadcast-reseller/);
  assert.match(batch5, /trusted-technical-catalog/);
  assert.match(batch5, /manufacturer-successor/);
  assert.match(batch5, /verificationStatus:'candidate'/);
  assert.match(batch5, /trustedImage\(entry\.image\)/);
  assert.match(batch5, /url\.protocol === 'https:'/);
  assert.doesNotMatch(batch5, /officialImage\s*:/);
  assert.doesNotMatch(batch5, /officialImages\s*:/);
});

test('batch 5 protège explicitement les références génériques qui nécessitent encore le SKU terrain', () => {
  for (const id of ['kb-viewsonic24','kb-blackbox-kvm-generic','kb-genelec-monitor','kb-iiyama43','kb-maudio-device','kb-konvision24','kb-konvision21','kb-elgato-streamdeck','kb-cisco-110series5']) {
    assert.match(batch5, new RegExp(`'${id}'`), `${id} doit rester protégé`);
  }
  assert.match(batch5, /protectedGenericIds\.has\(id\)/);
  assert.match(batch5, /genericProtected/);
});

test('batch 5 respecte Admin, déduplique les URLs et conserve la note de validation terrain', () => {
  assert.match(batch5, /record\?\.imageResearch\?\.origin === 'admin'/);
  assert.match(batch5, /record\?\.imageResearch\?\.locked === true/);
  assert.match(batch5, /record\?\.officialImage\?\.origin === 'admin'/);
  assert.match(batch5, /record\?\.officialImage\?\.locked === true/);
  assert.match(batch5, /const merged = new Map\(\)/);
  assert.match(batch5, /merged\.set\(key, \{ \.\.\.previous, \.\.\.image \}\)/);
  assert.match(batch5, /candidateRequiresFieldConfirmation/);
  assert.match(batch5, /candidateMatchNote/);
});

test('les placeholders distinguent SKU requis, source officielle connue et source à rechercher', () => {
  assert.match(media, /Modèle\/SKU exact requis avant d’associer une photo produit/);
  assert.match(media, /Source officielle identifiée — image encore à collecter/);
  assert.match(media, /Source constructeur à rechercher/);
  assert.match(media, /researchPlaceholder/);
});

test('Intégrité expose des catégories média exclusives et les photos terrain séparément', () => {
  assert.match(integrity, /Couverture photos & média/);
  assert.match(integrity, /if \(hasOfficial\) coverage\.officialImages \+= 1;\s*else if \(hasCandidate\) coverage\.candidates \+= 1;\s*else if \(modelRequired\) coverage\.modelRequired \+= 1;\s*else if \(sourceKnown\) coverage\.sourceKnown \+= 1;\s*else coverage\.needsSource \+= 1;/s);
  assert.match(integrity, /realPhotoInstances/);
  assert.match(integrity, /realPhotoFiles/);
});

test('le seed transforme toutes les références catalogue en file de recherche image sans inventer une image', () => {
  assert.match(seed, /record\.documentationUrl \|\| ''/);
  assert.match(seed, /'source-page-known'/);
  assert.match(seed, /'needs-source'/);
});

test('le chargement respecte les dépendances: catalogue, seed, batch2, batch3, batch4, batch5, inventaire\/360 puis média', () => {
  const knowledge = position(index, 'src="equipment-knowledge.js"');
  const seedPos = position(index, 'src="equipment-image-seed.js"');
  const batch2Pos = position(index, 'src="equipment-image-coverage-batch2.js"');
  const batch3Pos = position(index, 'src="equipment-image-coverage-batch3.js"');
  const batch4Pos = position(index, 'src="equipment-image-coverage-batch4.js"');
  const batch5Pos = position(index, 'src="equipment-image-coverage-batch5.js"');
  const inventory = position(index, 'src="inventory-master.js"');
  const complete360 = position(index, 'src="equipment-360-complete.js"');
  const mediaPos = position(index, 'src="equipment-media.js"');
  assert.ok(knowledge < seedPos, 'le catalogue doit être initialisé avant le seed image');
  assert.ok(seedPos < batch2Pos, 'le batch 2 doit suivre le seed de base');
  assert.ok(batch2Pos < batch3Pos, 'le batch 3 doit suivre le batch 2');
  assert.ok(batch3Pos < batch4Pos, 'le batch 4 doit suivre le batch 3');
  assert.ok(batch4Pos < batch5Pos, 'le batch 5 doit suivre le batch 4');
  assert.ok(batch5Pos < inventory, 'la couverture image doit être prête avant les imports inventaire');
  assert.ok(inventory < mediaPos, 'le patch de préservation des métadonnées doit être installé avant le patch média');
  assert.ok(complete360 < mediaPos, 'Fiche 360 doit être installée avant son extension média');
});

test('PWA v5.19 contient les assets média et tous les batches de couverture', () => {
  assert.match(serviceWorker, /2mtech-v5\.19/);
  for (const asset of ['/equipment-media.css','/equipment-image-seed.js','/equipment-image-coverage-batch2.js','/equipment-image-coverage-batch3.js','/equipment-image-coverage-batch4.js','/equipment-image-coverage-batch5.js','/equipment-media.js']) {
    assert.ok(serviceWorker.includes(`'${asset}'`), `${asset} doit être mis en cache`);
  }
});