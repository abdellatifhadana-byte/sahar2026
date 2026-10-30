/**
 * @file scripts/private-operational-data/regie-car.js — le relevé terrain de la Régie Car.
 *
 * CE QUI A CHANGÉ, ET POURQUOI (A-5)
 * ----------------------------------
 * Ces constantes vivaient dans `regie-car-inventory-phase16.js` et
 * `regie-car-prephoto-readiness.js`, servis à la racine. N'importe quel navigateur — sans
 * compte, sans session, sans cookie — pouvait les télécharger. Mesuré sur
 * `096cb47`, serveur local, aucun en-tête d'autorisation :
 *
 *     GET /regie-car-inventory-phase16.js    200   38 361 octets
 *     GET /regie-car-prephoto-readiness.js   200   25 732 octets
 *
 * Ce que ces octets disent : quelles baies existent (1, 2, 9, 10, 11, 12 — donc aussi
 * lesquelles n'existent pas), quel matériel est monté dans chacune, les repères
 * d'exploitation réels (`CAM 1`…`CAM 5`, `GR SEC 1`, `TG 1`, `REMOTE LSM 2`), un numéro
 * d'inventaire interne (`2M 003067`), un repère de commutateur réseau (`SW3.R100`), et
 * dix-huit résumés de photos de terrain qui décrivent l'installation baie par baie.
 *
 * C'est le relevé d'une unité mobile de la 2ᵉ chaîne. Ce n'est pas du catalogue.
 *
 * LA FRONTIÈRE, ÉNONCÉE UNE FOIS
 * ------------------------------
 * PUBLIC   le savoir générique : un fabricant, un modèle, une fiche produit, une URL de
 *          documentation. Il reste dans les modules de catalogue publics du dépôt, qui ne
 *          sont pas touchés par ce lot.
 * PRIVÉ    ce que CETTE installation possède et où : l'appairage matériel ↔ baie, les
 *          repères d'exploitation, les numéros d'inventaire, les observations de terrain.
 *
 * Le catalogue Régie Car ci-dessous est PRIVÉ malgré son apparence de catalogue : ce n'est
 * pas « ce que Sony fabrique », c'est « ce que la Régie Car contient ». L'ensemble des
 * entrées est lui-même une information d'installation, et chaque `summary`, `portsNote` et
 * `sourceNote` cite des observations faites sur place — « BAIE 2 : MSU-1000 lisible ».
 *
 * CE FICHIER NE SORT QUE PAR UNE ROUTE AUTORISÉE
 * ----------------------------------------------
 * Il vit sous `scripts/`, que le serveur refuse de servir, et n'arrive au navigateur que
 * par `/api/operational/regie-car/inventory`, après session ET après autorisation sur la
 * salle Régie Car — exactement comme `grille-centrale.js` avant lui.
 */

export const REGIE_CAR_ROOM_ID = 'room-regie-car';

// Les deux marqueurs d'origine que portent les fiches produites ici. Ils restent aussi
// déclarés côté public, où la logique les compare : ce sont des clés de provenance, pas
// des faits d'installation.
const ORIGIN = 'regie-car-phase16';
const REGIE_CAR_PREPHOTO_ORIGIN = 'regie-car-prephoto-phase17';

const fieldRefs = (...numbers) => Object.freeze(numbers.map(number => `regiecar-2026-08-16:${String(number).padStart(2,'0')}`));

export const REGIE_CAR_FIELD_EVIDENCE = Object.freeze([
  Object.freeze({id:'regiecar-2026-08-16:01',kind:'rack-overview-photo',summary:'Vue large de la zone VTR/LSM : plusieurs decks Sony, monitoring Wohler/Harris et poste opérateur.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:02',kind:'front-panel-photo',summary:'Contrôleur EVS legacy/LSM avec jog, lever, LCD et touches F1–F10.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:03',kind:'rack-front-photo',summary:'Monitoring Wohler triple-écran et panneaux Harris CTRL/VTR/LSM 1.3/LSM 1.4.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:04',kind:'rack-front-photo',summary:'BAIE 2 : Tektronix TG8000 ×2, ECO422D, Wohler RM-3357-HD, Sony MSU-1000, monitoring audio.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:05',kind:'rack-front-photo',summary:'BAIE 1 : Sony HSCU-300 ×4, Wohler RM-2443W-HD, Tektronix WFM 7100 et unités de contrôle visibles.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:06',kind:'front-panel-photo',summary:'EVS nano, repère REMOTE LSM 2, inventaire 2M 003067 lisible.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:07',kind:'operator-panel-photo',summary:'Cinq Sony RCP-1500 repérés CAM1 à CAM5 et un panneau Sony Remote Control Panel supplémentaire.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:08',kind:'patch-panel-photo',summary:'Grand patchfield/jackfield avec nombreuses liaisons physiques ; type de chaque rangée et mapping exact à confirmer.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:09',kind:'rack-front-photo',summary:'Vue baie avec HSCU-300, routeur 4×1 HD à modèle non lisible, switch réseau repéré SW3.R100 et équipements de monitoring.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:10',kind:'rack-front-photo',summary:'BAIE 9 : unité Sony, platine de sortie/audio et panneau Riedel Artist.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:11',kind:'rack-front-photo',summary:'BAIE 10 : deux panneaux Riedel Artist, Wohler AMP1A-LP10S, Telikou FM-804 Matrix Control Unit.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:12',kind:'rack-front-photo',summary:'BAIE 11 : Harris Panacea 32×8 COP, panneau GR SEC 2 et unité de commande/affichage supérieure.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:13',kind:'rack-front-photo',summary:'BAIE 12 : grande unité Sony de commande avec écran ; modèle exact non lisible.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:14',kind:'physical-context-photo',summary:'Compartiment/tiroir rack fermé ; fonction et contenu à confirmer.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:15',kind:'room-overview-photo',summary:'Poste principal de réalisation : mur d’écrans, surfaces de contrôle, moniteurs audio et pupitres.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:16',kind:'front-panel-photo',summary:'Wohler AMP1A-LP10S et Wohler RM-3357-HD, repères LSM visibles.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:17',kind:'front-panel-photo',summary:'Panneaux Harris CTRL/VTR/LSM 1.3/LSM 1.4 et connectique locale PLATINE LSM 2.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'}),
  Object.freeze({id:'regiecar-2026-08-16:18',kind:'front-panel-photo',summary:'Gros plan BAIE 2 : TG8000 TG1/TG2, ECO422D et haut du RM-3357-HD.',mediaStatus:'conversation-source-preserved; binary-pwa-pack-pending'})
]);

export const REGIE_CAR_CATALOG = Object.freeze([
  Object.freeze({id:'kb-sony-hscu-300',manufacturer:'Sony',model:'HSCU-300',family:'HSCU',type:'Camera Control Unit (CCU)',category:'Caméras / CCU',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'CCU compact HD/SD pour systèmes caméra Sony. Les quatre instances de la Régie Car portent HSCU-300 lisible en façade.',portsNote:'Sony documente notamment Camera triax, Remote, Ethernet, RS-422 trunk, retours HD/SD-SDI, référence et sorties HD/SD-SDI ; le câblage utilisé dans la Régie Car reste à relever sur l’arrière.',documentationUrl:'https://pro.sony/en_ME/products/camera-control-unit/hscu-300',sourceNote:'Photos terrain Régie Car : HSCU-300 lisible.',sourceOrigin:'field-photo+manufacturer'}),
  Object.freeze({id:'kb-sony-rcp-1500',manufacturer:'Sony',model:'RCP-1500',family:'RCP',type:'Remote Control Panel caméra',category:'Caméras / Contrôle',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Panneau de contrôle caméra Sony avec écran LCD/tactile, commandes directes et joystick iris/master black.',portsNote:'Sony documente Ethernet RJ-45, CCU/CNU multi-connector, AUX et EXT I/O D-sub 9 ; confirmer le mode de liaison réellement utilisé localement.',documentationUrl:'https://pro.sony/en_RO/products/camera-control-panels/rcp-1500',sourceNote:'Photo terrain : RCP-1500 lisible sur cinq panneaux CAM1–CAM5.',sourceOrigin:'field-photo+manufacturer'}),
  Object.freeze({id:'kb-sony-msu-1000',manufacturer:'Sony',model:'MSU-1000',family:'MSU',type:'Master Setup Unit multi-caméras',category:'Caméras / Contrôle',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Master Setup Unit horizontal pour configuration et maintenance de systèmes multi-caméras Sony.',portsNote:'Sony documente Ethernet, CCU/CNU, AUX, EXT I/O, AC IN et DC IN ; câblage local à confirmer.',documentationUrl:'https://pro.sony/en_CA/products/camera-control-panels/msu-1000',sourceNote:'Photo terrain BAIE 2 : MSU-1000 lisible.',sourceOrigin:'field-photo+manufacturer'}),
  Object.freeze({id:'kb-tektronix-tg8000',manufacturer:'Tektronix',model:'TG8000',family:'TG8000',type:'Test Signal Generator',category:'Synchronisation / Référence',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Générateur de signaux de test broadcast ; deux unités TG1/TG2 sont visibles dans BAIE 2.',portsNote:'Configuration de modules, références et sorties exactes à relever sur l’arrière ; ne pas déduire les options internes depuis la façade.',sourceNote:'Photos terrain BAIE 2 : TG8000 Test Signal Generator lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-tektronix-eco422d',manufacturer:'Tektronix',model:'ECO422D',family:'ECO',type:'SD/HD Changeover Unit',category:'Synchronisation / Référence',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Unité de changeover SD/HD utilisée pour le basculement entre références/sources primaire et secours.',portsNote:'Le câblage Primary/Backup et les sorties réellement utilisées doivent être relevés sur l’arrière.',sourceNote:'Photos terrain BAIE 2 : ECO422D SD/HD Changeover Unit lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-tektronix-wfm7100',manufacturer:'Tektronix',model:'WFM 7100',family:'WFM7000',type:'Waveform Monitor',category:'Contrôle / Mesure / Monitoring',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Waveform monitor Tektronix ; modèle WFM 7100 lisible dans BAIE 1.',portsNote:'Options/licences et entrées réellement câblées à confirmer sur l’unité.',sourceNote:'Photo terrain BAIE 1 : WFM 7100 lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-wohler-rm2443w-hd',manufacturer:'Wohler Technologies',model:'RM-2443W-HD',family:'RM',type:'Moniteur vidéo rack multi-écrans',category:'Contrôle / Mesure / Monitoring',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Moniteur vidéo rack à quatre écrans observé dans BAIE 1.',portsNote:'Entrées exactes et affectations CAM1–CAM4 à confirmer sur l’arrière.',sourceNote:'Photo terrain BAIE 1 : RM-2443W-HD lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-wohler-rm3357-hd',manufacturer:'Wohler Technologies',model:'RM-3357-HD',family:'RM',type:'Moniteur vidéo rack triple écran',category:'Contrôle / Mesure / Monitoring',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Moniteur vidéo rack triple écran observé à plusieurs emplacements dans la Régie Car.',portsNote:'Entrées et affectations locales à confirmer sur l’arrière.',sourceNote:'Photos terrain : RM-3357-HD lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-wohler-amp1a-lp10s',manufacturer:'Wohler Technologies',model:'AMP1A-LP10S',family:'AMP1A',type:'Analog Audio Monitor Panel',category:'Audio / Monitoring',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Panneau de monitoring audio analogique Wohler ; le modèle AMP1A-LP10S est lisible sur plusieurs vues.',portsNote:'Connectique et nombre de sources réellement raccordées dans la Régie Car à relever sur l’arrière.',documentationUrl:'https://www.wohler.com/end-of-life-product/',sourceNote:'Photos terrain + page EOL Wohler confirmant le modèle AMP1A-LP10S.',sourceOrigin:'field-photo+manufacturer'}),
  Object.freeze({id:'kb-evs-nano-lsm-remote',manufacturer:'EVS',model:'nano — Remote LSM',family:'LSM Remote',type:'Contrôleur replay / slow motion',category:'Replay / EVS',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Remote EVS de production replay avec LCD, touches F1–F10, jog et lever ; une instance est repérée REMOTE LSM 2.',portsNote:'Connexion serveur/réseau et génération exacte du contrôleur à confirmer sur la plaque arrière.',documentationUrl:'https://evs.com/services/training/e-learning/lsm-tutorials',sourceNote:'Photo terrain : EVS nano et REMOTE LSM 2 lisibles ; documentation EVS sur le workflow LSM Remote.',sourceOrigin:'field-photo+manufacturer'}),
  Object.freeze({id:'kb-harris-panacea-32x8-cop',manufacturer:'Harris Broadcast',model:'Panacea — 32x8 COP',family:'Panacea',type:'Panneau / routeur compact de production',category:'Routing / Contrôle',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Unité/panneau Harris Panacea portant le repère local 32x8 COP dans BAIE 11.',portsNote:'Le sens exact du repère 32x8 COP, la matrice physique et le câblage arrière restent à confirmer ; aucune capacité ni crosspoint live n’est déduit.',documentationUrl:'https://imaginecommunications.com/es/insights-and-resources/harris-broadcast-supports-new-channel-launches-for-infinity-tv-in-abu-dhabi/',sourceNote:'Photo terrain BAIE 11 : PANACEA | HARRIS et 32x8 COP lisibles ; source historique Imagine confirme Panacea comme gamme Harris de routing.',sourceOrigin:'field-photo+manufacturer-archive'}),
  Object.freeze({id:'kb-telikou-fm804',manufacturer:'Telikou',model:'FM-804',family:'FM',type:'Matrix Control Unit',category:'Intercom / Communication',verificationStatus:'field-photo-confirmed',confidence:'high',summary:'Unité de contrôle matriciel Telikou observée dans BAIE 10.',portsNote:'Matrice, bus, liaisons intercom et pinout à relever sur l’arrière avant création de topologie.',sourceNote:'Photo terrain BAIE 10 : TELIKOU FM-804 Matrix Control Unit lisible.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-harris-legacy-control-panel',manufacturer:'Harris Broadcast',model:'Control Panel — modèle exact à confirmer',family:'Harris Router Control',type:'Panneau de contrôle de routing',category:'Routing / Contrôle',verificationStatus:'verified-family',confidence:'high',summary:'Famille de panneaux Harris observés avec repères locaux CTRL, VTR, LSM 1.3, LSM 1.4 et GR SEC.',portsNote:'Référence fabricant, protocole, alimentation et liaison au routeur à confirmer sur étiquette/arrière.',sourceNote:'Photos terrain Régie Car : HARRIS lisible, modèles exacts non lisibles.',sourceOrigin:'field-photo'}),
  Object.freeze({id:'kb-regiecar-patchfield-family',manufacturer:'À confirmer',model:'Patchfield / jackfield — type exact à confirmer',family:'Patchfield',type:'Patch panel / jackfield',category:'Connectivité / Patching',verificationStatus:'to-confirm',confidence:'high',summary:'Grand patchfield physiquement visible dans la Régie Car. Le type de jack/connecteur, la normalisation et le mapping rangée par rangée ne sont pas lisibles sur la vue actuelle.',portsNote:'Aucune liaison n’est créée tant que les deux extrémités et les repères ne sont pas démontrés.',sourceNote:'Photo terrain dédiée au patchfield.',sourceOrigin:'field-photo'})
]);

export const REGIE_CAR_BAIES = Object.freeze([1,2,9,10,11,12].map(number => Object.freeze({
  id:`regie-car-baie-${number}`,
  fieldIdentityKey:`field-baie:regie-car:${number}`,
  name:`BAIE ${number}`,
  nom:`BAIE ${number}`,
  roomId:REGIE_CAR_ROOM_ID,
  source:'Photos terrain Régie Car — numéro de baie lisible',
  verificationStatus:'field-photo-confirmed',
  sourceLayer:'current-field-evidence',
  mobileUnit:true,
  origin:ORIGIN
})));

const exact = (id,name,baieId,catalogId,model,manufacturer,evidenceRefs,extra={}) => Object.freeze({
  id,name,nom:name,roomId:REGIE_CAR_ROOM_ID,baieId,catalogId,modele:model,marque:manufacturer,
  status:'Opérationnel — état actuel à confirmer',statut:'À vérifier',verificationStatus:'field-photo-confirmed',confidence:'high',
  evidenceStatus:'field-photo-confirmed',sourceLayer:'current-field-evidence',fieldEvidenceRefs:Object.freeze(evidenceRefs),
  fieldInventoryKey:`regie-car:${id}`,origin:ORIGIN,mobileUnit:true,exactModelConfirmed:true,...extra
});
const family = (id,name,baieId,catalogId,model,manufacturer,evidenceRefs,extra={}) => Object.freeze({
  id,name,nom:name,roomId:REGIE_CAR_ROOM_ID,baieId,catalogId,modele:model,marque:manufacturer,
  status:'À vérifier',statut:'À vérifier',verificationStatus:'verified-family',confidence:'medium',
  evidenceStatus:'field-photo-confirmed-family',sourceLayer:'current-field-evidence',fieldEvidenceRefs:Object.freeze(evidenceRefs),
  fieldInventoryKey:`regie-car:${id}`,origin:ORIGIN,mobileUnit:true,exactModelConfirmed:false,...extra
});

const vtrInstances = Array.from({length:12},(_,index) => family(
  `regie-car-vtr-${String(index+1).padStart(2,'0')}`,
  `Sony VTR ${String(index+1).padStart(2,'0')} — modèle à confirmer`,
  null,
  'kb-sony-vtr',
  'VTR / deck — modèle à confirmer',
  'Sony',
  fieldRefs(1),
  { physicalZone:'Rack VTR/LSM — baie exacte à confirmer', provisionalInstance:true, fieldCountBasis:'12 façades Sony VTR/deck distinctes visibles sur la vue terrain 01' }
));

export const REGIE_CAR_EQUIPMENT = Object.freeze([
  exact('regie-car-b1-ccu1','CCU 1 — Sony HSCU-300','regie-car-baie-1','kb-sony-hscu-300','HSCU-300','Sony',fieldRefs(5,9),{operationalLabel:'CCU 1'}),
  exact('regie-car-b1-ccu2','CCU 2 — Sony HSCU-300','regie-car-baie-1','kb-sony-hscu-300','HSCU-300','Sony',fieldRefs(5,9),{operationalLabel:'CCU 2'}),
  exact('regie-car-b1-ccu3','CCU 3 — Sony HSCU-300','regie-car-baie-1','kb-sony-hscu-300','HSCU-300','Sony',fieldRefs(5,9),{operationalLabel:'CCU 3'}),
  exact('regie-car-b1-ccu4','CCU 4 — Sony HSCU-300','regie-car-baie-1','kb-sony-hscu-300','HSCU-300','Sony',fieldRefs(5,9),{operationalLabel:'CCU 4'}),
  exact('regie-car-b1-rm2443','Wohler RM-2443W-HD — CAM1 à CAM4','regie-car-baie-1','kb-wohler-rm2443w-hd','RM-2443W-HD','Wohler Technologies',fieldRefs(5),{operationalRole:'Monitoring vidéo CAM1–CAM4'}),
  exact('regie-car-b1-wfm7100','Tektronix WFM 7100','regie-car-baie-1','kb-tektronix-wfm7100','WFM 7100','Tektronix',fieldRefs(5),{operationalRole:'Waveform / contrôle mesure'}),
  family('regie-car-b1-sony-control','Sony unité de contrôle vidéo — modèle à confirmer','regie-car-baie-1','', 'Unité de contrôle/monitoring — modèle à confirmer','Sony',fieldRefs(5),{requiresFieldConfirmation:true}),

  exact('regie-car-b2-tg1','TG 1 — Tektronix TG8000','regie-car-baie-2','kb-tektronix-tg8000','TG8000','Tektronix',fieldRefs(4,18),{operationalLabel:'TG 1'}),
  exact('regie-car-b2-eco','ECO — Tektronix ECO422D','regie-car-baie-2','kb-tektronix-eco422d','ECO422D','Tektronix',fieldRefs(4,18),{operationalLabel:'ECO'}),
  exact('regie-car-b2-tg2','TG 2 — Tektronix TG8000','regie-car-baie-2','kb-tektronix-tg8000','TG8000','Tektronix',fieldRefs(4,18),{operationalLabel:'TG 2'}),
  exact('regie-car-b2-rm3357','Wohler RM-3357-HD — LSM 1','regie-car-baie-2','kb-wohler-rm3357-hd','RM-3357-HD','Wohler Technologies',fieldRefs(4,18),{operationalRole:'Monitoring vidéo LSM'}),
  exact('regie-car-b2-msu1000','Sony MSU-1000','regie-car-baie-2','kb-sony-msu-1000','MSU-1000','Sony',fieldRefs(4),{operationalRole:'Master Setup multi-caméras'}),
  exact('regie-car-b2-audiomon','Wohler AMP1A-LP10S — BAIE 2','regie-car-baie-2','kb-wohler-amp1a-lp10s','AMP1A-LP10S','Wohler Technologies',fieldRefs(4),{operationalRole:'Monitoring audio analogique'}),

  exact('regie-car-rcp-cam1','CAM 1 — Sony RCP-1500',null,'kb-sony-rcp-1500','RCP-1500','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras',operationalLabel:'CAM 1'}),
  exact('regie-car-rcp-cam2','CAM 2 — Sony RCP-1500',null,'kb-sony-rcp-1500','RCP-1500','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras',operationalLabel:'CAM 2'}),
  exact('regie-car-rcp-cam3','CAM 3 — Sony RCP-1500',null,'kb-sony-rcp-1500','RCP-1500','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras',operationalLabel:'CAM 3'}),
  exact('regie-car-rcp-cam4','CAM 4 — Sony RCP-1500',null,'kb-sony-rcp-1500','RCP-1500','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras',operationalLabel:'CAM 4'}),
  exact('regie-car-rcp-cam5','CAM 5 — Sony RCP-1500',null,'kb-sony-rcp-1500','RCP-1500','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras',operationalLabel:'CAM 5'}),
  family('regie-car-sony-remote-panel','Sony Remote Control Panel — modèle exact à confirmer',null,'','Remote Control Panel — modèle exact à confirmer','Sony',fieldRefs(7),{physicalZone:'Pupitre caméras'}),
  exact('regie-car-evs-lsm2','REMOTE LSM 2 — EVS nano',null,'kb-evs-nano-lsm-remote','nano — Remote LSM','EVS',fieldRefs(6),{physicalZone:'Pupitre replay',operationalLabel:'REMOTE LSM 2',inventorySticker:'2M 003067'}),
  family('regie-car-evs-legacy-remote','EVS LSM Remote — modèle/génération à confirmer',null,'kb-evs-nano-lsm-remote','LSM Remote — génération à confirmer','EVS',fieldRefs(2),{physicalZone:'Pupitre replay',requiresFieldConfirmation:true}),

  family('regie-car-patchfield-main','Patchfield principal — type exact à confirmer',null,'kb-regiecar-patchfield-family','Patchfield / jackfield — type exact à confirmer','À confirmer',fieldRefs(8),{entityKind:'patch-panel',physicalZone:'Zone patching',requiresFieldConfirmation:true}),

  family('regie-car-b9-sony-unit','Sony unité vidéo — BAIE 9, modèle à confirmer','regie-car-baie-9','','Unité vidéo/contrôle — modèle à confirmer','Sony',fieldRefs(10),{requiresFieldConfirmation:true}),
  family('regie-car-b9-artist','Riedel Artist — BAIE 9','regie-car-baie-9','kb-riedel-artist','Artist — panneau exact à confirmer','Riedel Communications',fieldRefs(10),{operationalRole:'Intercom / communication'}),
  family('regie-car-b9-audio-panel','Platine sortie / audio — modèle à confirmer','regie-car-baie-9','','Panneau audio/monitoring — modèle à confirmer','À confirmer',fieldRefs(10),{requiresFieldConfirmation:true}),

  family('regie-car-b10-artist-a','Riedel Artist A — BAIE 10','regie-car-baie-10','kb-riedel-artist','Artist — panneau exact à confirmer','Riedel Communications',fieldRefs(11),{operationalRole:'Intercom / communication'}),
  exact('regie-car-b10-amp1a','Wohler AMP1A-LP10S — BAIE 10','regie-car-baie-10','kb-wohler-amp1a-lp10s','AMP1A-LP10S','Wohler Technologies',fieldRefs(11),{operationalRole:'Monitoring audio analogique'}),
  exact('regie-car-b10-telikou','Telikou FM-804 — BAIE 10','regie-car-baie-10','kb-telikou-fm804','FM-804','Telikou',fieldRefs(11),{operationalRole:'Matrix Control Unit'}),
  family('regie-car-b10-artist-b','Riedel Artist B — BAIE 10','regie-car-baie-10','kb-riedel-artist','Artist — panneau exact à confirmer','Riedel Communications',fieldRefs(11),{operationalRole:'Intercom / communication'}),

  exact('regie-car-b11-panacea','GR SEC 1 — Harris Panacea 32x8 COP','regie-car-baie-11','kb-harris-panacea-32x8-cop','Panacea — 32x8 COP','Harris Broadcast',fieldRefs(12),{operationalLabel:'GR SEC 1'}),
  family('regie-car-b11-grsec2','GR SEC 2 — Harris Control Panel','regie-car-baie-11','kb-harris-legacy-control-panel','Control Panel — modèle exact à confirmer','Harris Broadcast',fieldRefs(12),{operationalLabel:'GR SEC 2'}),
  family('regie-car-b11-upper-control','Unité de contrôle BAIE 11 — modèle à confirmer','regie-car-baie-11','','Panneau de contrôle/affichage — modèle à confirmer','À confirmer',fieldRefs(12),{requiresFieldConfirmation:true}),

  family('regie-car-b12-sony-control','Sony unité de commande à écran — BAIE 12','regie-car-baie-12','','Unité de commande/switcher — modèle exact à confirmer','Sony',fieldRefs(13),{requiresFieldConfirmation:true}),

  family('regie-car-harris-ctrl','CTRL — Harris Control Panel',null,'kb-harris-legacy-control-panel','Control Panel — modèle exact à confirmer','Harris Broadcast',fieldRefs(3,17),{physicalZone:'Rack/pupitre LSM/VTR',operationalLabel:'CTRL'}),
  family('regie-car-harris-vtr','VTR — Harris Control Panel',null,'kb-harris-legacy-control-panel','Control Panel — modèle exact à confirmer','Harris Broadcast',fieldRefs(3,17),{physicalZone:'Rack/pupitre LSM/VTR',operationalLabel:'VTR'}),
  family('regie-car-harris-lsm13','LSM 1.3 — Harris Control Panel',null,'kb-harris-legacy-control-panel','Control Panel — modèle exact à confirmer','Harris Broadcast',fieldRefs(3,17),{physicalZone:'Rack/pupitre LSM/VTR',operationalLabel:'LSM 1.3'}),
  family('regie-car-harris-lsm14','LSM 1.4 — Harris Control Panel',null,'kb-harris-legacy-control-panel','Control Panel — modèle exact à confirmer','Harris Broadcast',fieldRefs(3,17),{physicalZone:'Rack/pupitre LSM/VTR',operationalLabel:'LSM 1.4'}),

  ...vtrInstances
]);

export const REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT = Object.freeze([
  Object.freeze({
    id:'regie-car-observed-hd4x1-router',
    fieldInventoryKey:'regie-car:regie-car-observed-hd4x1-router',
    name:'Routeur 4×1 HD — modèle à confirmer', nom:'Routeur 4×1 HD — modèle à confirmer',
    roomId:REGIE_CAR_ROOM_ID, baieId:null, catalogId:'',
    modele:'4×1 HD Router — modèle à confirmer', marque:'À confirmer',
    status:'À vérifier', statut:'À vérifier', verificationStatus:'function-only', confidence:'medium',
    evidenceStatus:'field-photo-function-confirmed', sourceLayer:'current-field-evidence', fieldEvidenceRefs:Object.freeze(['regiecar-2026-08-16:09']),
    physicalZone:'Baie visible avec HSCU-300 — numéro exact à confirmer', operationalRole:'Routing vidéo 4×1 HD — fonction visible',
    exactModelConfirmed:false, requiresFieldConfirmation:true, provisionalInstance:true, mobileUnit:true,
    origin:REGIE_CAR_PREPHOTO_ORIGIN
  }),
  Object.freeze({
    id:'regie-car-observed-sw3-r100',
    fieldInventoryKey:'regie-car:regie-car-observed-sw3-r100',
    name:'SW3.R100 — switch réseau, modèle à confirmer', nom:'SW3.R100 — switch réseau, modèle à confirmer',
    roomId:REGIE_CAR_ROOM_ID, baieId:null, catalogId:'',
    modele:'Switch réseau — modèle à confirmer', marque:'À confirmer',
    status:'À vérifier', statut:'À vérifier', verificationStatus:'label-only', confidence:'medium',
    evidenceStatus:'field-photo-label-confirmed', sourceLayer:'current-field-evidence', fieldEvidenceRefs:Object.freeze(['regiecar-2026-08-16:09']),
    physicalZone:'Baie visible avec HSCU-300 — numéro exact à confirmer', operationalLabel:'SW3.R100', operationalRole:'Commutation réseau — modèle et interfaces à confirmer',
    exactModelConfirmed:false, requiresFieldConfirmation:true, provisionalInstance:true, mobileUnit:true,
    origin:REGIE_CAR_PREPHOTO_ORIGIN
  })
]);

export const REGIE_CAR_MANUFACTURER_SOURCE_PATCHES = Object.freeze([
  Object.freeze({
    id:'kb-tektronix-tg8000',
    manufacturerResearchSources:Object.freeze(['https://www.tek.com/en/support/datasheets-manuals-software-downloads']),
    researchNote:'Support constructeur Tektronix disponible pour la recherche de documentation legacy/current ; module/configuration exacte du TG8000 à confirmer sur site.'
  }),
  Object.freeze({
    id:'kb-tektronix-eco422d',
    manufacturerResearchSources:Object.freeze(['https://www.tek.com/en/support/datasheets-manuals-software-downloads']),
    researchNote:'Support constructeur Tektronix. Le câblage Primary/Backup et les sorties réellement utilisées restent des faits terrain.'
  }),
  Object.freeze({
    id:'kb-tektronix-wfm7100',
    documentationUrl:'https://www.tek.com/fr/support/faqs/what-difference-between-wfm6100-7000-and-7100',
    manufacturerResearchSources:Object.freeze(['https://www.tek.com/en/calibration-by-manufacturer/tektronix']),
    researchNote:'Tektronix référence officiellement WFM7100 et documente la famille WFM6100/7000/7100 ; options installées à confirmer sur l’instance.'
  }),
  Object.freeze({
    id:'kb-wohler-rm2443w-hd',
    documentationUrl:'https://www.wohler.com/end-of-life-product/',
    manufacturerResearchSources:Object.freeze(['https://www.wohler.com/end-of-life-product/']),
    researchNote:'Wohler référence RM-2443W-HD dans sa liste officielle End of Life ; ne pas confondre avec RM-2443WS-3G ou RM-2443W-3G2.'
  }),
  Object.freeze({
    id:'kb-wohler-rm3357-hd',
    documentationUrl:'https://www.wohler.com/end-of-life-product/',
    manufacturerResearchSources:Object.freeze(['https://www.wohler.com/end-of-life-product/']),
    researchNote:'Wohler référence RM-3357-HD dans sa liste officielle End of Life ; connectique réelle de l’instance à relever au dos.'
  }),
  Object.freeze({
    id:'kb-telikou-fm804',
    documentationUrl:'https://www.telikou.com/FM-804-4-Wire-Eight-Channel-Main-Station-p.html',
    manufacturerResearchSources:Object.freeze(['https://www.telikou.com/FM-804-4-Wire-Eight-Channel-Main-Station-p.html']),
    researchNote:'Telikou documente FM-804 comme station 4-wire huit canaux ; la configuration et les liaisons locales restent à confirmer.'
  }),
  Object.freeze({
    id:'kb-riedel-artist',
    documentationUrl:'https://www.riedel.net/en/products-solutions',
    manufacturerResearchSources:Object.freeze(['https://www.riedel.net/en/products-solutions']),
    researchNote:'Riedel confirme ARTIST comme famille Intercom ; le panneau/châssis exact observé en Régie Car reste à identifier.'
  })
]);

export const REGIE_CAR_PREPHOTO_GAPS = Object.freeze([
  Object.freeze({id:'exact-models',severity:'high',label:'Modèles exacts encore inconnus',rule:'Les familles/instances provisoires restent « à confirmer » jusqu’à lecture d’une étiquette ou façade suffisamment nette.'}),
  Object.freeze({id:'rack-position',severity:'high',label:'Positions physiques incomplètes',rule:'Les VTR/pupitres et les deux observations de la vue 09 ne reçoivent pas de baie arbitraire.'}),
  Object.freeze({id:'rear-ports',severity:'critical',label:'Ports arrière non relevés',rule:'Aucune liste de ports réellement installés n’est créée depuis une façade ou une brochure constructeur.'}),
  Object.freeze({id:'cables',severity:'critical',label:'Câbles non tracés de bout en bout',rule:'Aucune relation câble n’est créée tant que les deux extrémités ne sont pas démontrées.'}),
  Object.freeze({id:'patch-normalization',severity:'critical',label:'Patchfield non documenté',rule:'Type de jack, normalisation, rangées et mapping restent ouverts.'}),
  Object.freeze({id:'live-routing',severity:'critical',label:'Crosspoints/flux live inconnus',rule:'Une photo physique ne devient jamais un état de routage actif.'}),
  Object.freeze({id:'binary-media',severity:'normal',label:'Fichiers image Régie Car à intégrer',rule:'Les références 01–18 existent ; les binaires restent séparés jusqu’à réception/matérialisation des fichiers source.'})
]);

/**
 * L'ÉTAT D'AVANCEMENT COURANT DE CETTE UNITÉ.
 *
 * « Prête pour la prochaine série de photos », « attend encore ses fichiers source » : ce
 * sont des faits sur l'installation, pas une politique générique. Un poste sans habilitation
 * n'a pas à savoir si la Régie Car est documentée ou en attente.
 */
export const REGIE_CAR_PREPHOTO_READINESS = Object.freeze({
  planStatus:'ready-awaiting-photos',
  binaryMediaStatus:'awaiting-source-files',
  readyForNextPhotoBatch:true,
  safeToReceiveNewEvidence:true,
  binaryMediaStillRequired:true
});

/**
 * Le jeu de données complet, tel que la route autorisée le rend.
 *
 * Une FONCTION, et non un objet exporté : elle n'est appelée qu'après la décision
 * d'autorisation, et rien ne se matérialise à l'import.
 */
export function buildRegieCarDataset() {
  return {
    roomId: REGIE_CAR_ROOM_ID,
    fieldEvidence: REGIE_CAR_FIELD_EVIDENCE,
    catalog: REGIE_CAR_CATALOG,
    baies: REGIE_CAR_BAIES,
    equipment: REGIE_CAR_EQUIPMENT,
    additionalEquipment: REGIE_CAR_PHASE17_ADDITIONAL_EQUIPMENT,
    manufacturerSourcePatches: REGIE_CAR_MANUFACTURER_SOURCE_PATCHES,
    prephotoGaps: REGIE_CAR_PREPHOTO_GAPS,
    prephotoReadiness: REGIE_CAR_PREPHOTO_READINESS
  };
}
