import { inferKnowledgeProfile, KNOWLEDGE_PROFILES } from './equipment-knowledge-contract.js';

const VERIFIED_AT = '2026-08-14';
const fact = (label, value, sourceUrl, options = {}) => Object.freeze({
  label, value:String(value), verificationStatus:options.verificationStatus || 'verified',
  confidence:options.confidence || 'high', scope:options.scope || 'manufacturer',
  sourceType:options.sourceType || 'manufacturer-doc', sourceLabel:options.sourceLabel || 'Documentation officielle constructeur',
  sourceUrl:sourceUrl || '', verifiedAt:VERIFIED_AT
});
const pack = (profile, sourceUrl, facts = [], extra = {}) => Object.freeze({
  profile, sourceUrl, facts:Object.freeze(facts), ...extra
});

/*
 * POURQUOI CETTE PREUVE DE PROJET N'EST PAS DÉPLACÉE, MAIS RETIRÉE (#142).
 *
 * `kb-axon-sfr08` affirmait publiquement le nombre de châssis, le site et les zones qui les
 * portent, en citant un document interne. C'était une donnée d'installation réelle dans un
 * actif anonyme, donc à retirer.
 *
 * La porte autorisée existante est celle de #137 : elle décide en résolvant l'ÉQUIPEMENT
 * Grille Centrale puis en vérifiant l'accès à CET équipement. Y faire passer une preuve qui
 * concerne d'autres zones donnerait le résultat inverse de celui qu'on cherche — visible
 * pour qui est habilité à la Grille et à elle seule, invisible pour qui est légitimement
 * habilité sur les zones concernées. Une autorisation approximative est un défaut, pas une
 * précaution.
 *
 * Aucune autre porte n'a la bonne sémantique dans le périmètre de ce lot, et en inventer une
 * pour conserver un paragraphe optionnel serait disproportionné. La preuve est donc retirée ;
 * la connaissance CONSTRUCTEUR Axon/Synapse, elle, reste publique et complète.
 */
const URL = Object.freeze({
  rossUltrix:'https://www.rossvideo.com/products/routing-systems/ultrix/ultrix-specifications/',
  rossOgx:'https://www.rossvideo.com/products/signal-processing/opengear/frames-accessories/ogx-frame/',
  platinum:'https://imaginecommunications.com/insights-and-resources/platinum-vx/',
  lt4610:'https://www.leader.co.jp/uploads/2022/01/ca_lt4610_lt4611_e_ver3_1.pdf',
  lt4448:'https://www.leader.co.jp/products/broadcast/sg/lt4448/',
  lv5300:'https://www.leader.co.jp/en/products/broadcast/waveform/lv5300a/',
  lv5350:'https://www.leader.co.jp/products/broadcast/waveform/lv5350/',
  nexis:'https://www.avid.com/products/avid-nexis/storage-and-specs',
  z440:'https://support.hp.com/us-en/product/setup-user-guides/hp-z440-workstation/6978828',
  lp2475:'https://support.hp.com/us-en/drivers/selfservice/hp-lp2475w-24-inch-widescreen-lcd-monitor/3648442',
  pdw1200:'https://www.sony.com/electronics/support/res/manuals/5019/db65f11e04491dc86d6f8dea29a144c5/50194151M.pdf',
  pdw1550:'https://www.sony.com/electronics/support/res/manuals/4542/a60001fca371b45fb7ffb38fedd0d506/45422735M.pdf',
  kramer:'https://k.kramerav.com/downloads/pdf/product/9/VS-81AV.pdf',
  riedel:'https://www.riedel.net/en/products-solutions/intercom/artist-matrix-intercom/hardware',
  ultritouch:'https://www.rossvideo.com/products/routing-systems/ultritouch/',
  mc1:'https://www.rossvideo.com/products/signal-processing/mc1/',
  mc1panel:'https://documentation.rossvideo.com/files/Manuals/Signal%20Processing/Master%20Control/MC1-PANEL/MC1_PANEL_16.pdf',
  dmon:'https://decimator.com/PRESS/DECIMATOR_DESIGN_NAB_2019_CATALOGUE.pdf',
  cisco9300:'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html',
  cisco9200:'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html',
  cisco110:'https://www.cisco.com/c/en/us/products/collateral/switches/110-series-unmanaged-switches/datasheet-c78-734450.html',
  fortigate:'https://www.fortinet.com/resources/data-sheets/fortigate-fortiwifi-40f-series',
  aja:'https://www.aja.com/products/og-fs-mini',
  cobalt:'https://cobaltdigital.com/products/9940-aco/',
  sra:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/sra-8802/',
  dra:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/dra-8804/',
  sfs:'https://www.rossvideo.com/products/signal-processing/opengear/timing-synchronization/sfs-8622-a/',
  uda:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/uda-8705a/',
  aap:'https://www.rossvideo.com/products/signal-processing/opengear/processing-monitoring/aap-8644/',
  ada:'https://www.rossvideo.com/products/signal-processing/opengear/distribution/ada-8405-c/',
  hdc:'https://www.rossvideo.com/products/signal-processing/opengear/conversion/hdc-8223a-s/',
  dmx:'https://www.rossvideo.com/products/signal-processing/opengear/audio-embedding/dmx-8259-4c-8c/',
  dell:'https://www.dell.com/support/kbdoc/en-us/000203856/poweredge-rack-and-tower-servers-hardware-tech-specifications-documentation-videos',
  tallyman:'https://tslproducts.com/product/tallyman-advanced-control-systems/',
  axon:'https://evs.com/products/real-time-media-processing/synapse/frames-housing-isolators-and-connectors'
});

export const DEVICE_KNOWLEDGE_PACKS = Object.freeze({
  'kb-ross-ultrix':pack('router-matrix', URL.rossUltrix, [
    fact('Tailles de châssis disponibles','1RU, 2RU, 5RU et 12RU',URL.rossUltrix),
    fact('Capacité vidéo maximale selon châssis','36×36 / 72×72 / 160×160 / 288×288',URL.rossUltrix),
    fact('E/S SDI intégrées','16×16 sur les châssis 1RU et 2RU',URL.rossUltrix),
    fact('Slots E/S / traitement','1 / 3 / 9 / 16 selon châssis',URL.rossUltrix),
    fact('Capacité matrice audio','768×768 à 6144×6144 selon châssis',URL.rossUltrix),
    fact('Gestion','Ethernet 1 GbE et Ross DashBoard / Ultricore',URL.rossUltrix)
  ], { identificationChecklist:['Référence exacte du frame ULTRIX-FR','Cartes I/O installées','Licences logicielles actives','Deux adresses de contrôle si redondées'] }),
  'kb-ross-opengear-ogx':pack('modular-frame', URL.rossOgx, [
    fact('Format','Châssis openGear 2RU',URL.rossOgx), fact('Capacité','Jusqu’à 20 cartes openGear',URL.rossOgx),
    fact('Alimentation','Alimentation redondante 600 W avec refroidissement intégré',URL.rossOgx),
    fact('Références','Deux entrées de référence indépendantes en boucle',URL.rossOgx),
    fact('Gestion locale','LCD frontal : nom, adresse IP et identification des défauts',URL.rossOgx),
    fact('Supervision','Ethernet, DashBoard et barre FrameGlow RGB',URL.rossOgx)
  ], { aliases:['OGX-FR-CN','oGx Frame'], identificationChecklist:['Contrôleur réseau exact','Référence de chaque rear module','Occupation des 20 slots','PSU A/B et départs PDU'] }),
  'kb-imagine-platinum-vx':pack('router-matrix', URL.platinum, [
    fact('Domaine','Routeur 3G/HD/SD-SDI pour installations petites à moyennes',URL.platinum),
    fact('Capacités de la gamme','16×16 à 288×288',URL.platinum),
    fact('Formats de châssis','1RU, 2RU, 4RU et 8RU',URL.platinum),
    fact('Contrôle','Outils Magellan intégrés et compatibilité Magellan Control System',URL.platinum),
    fact('Traitement Clean & Quiet','Deux canaux indépendants avec preview et transitions',URL.platinum)
    // La preuve d'implantation de cette fiche était ici en clair (#142) : elle nommait la
    // capacité de deux routeurs réels de l'installation. Elle arrive maintenant par
    // `knowledgeSeed.relatedCatalogEvidence`, après autorisation. Un commentaire se télécharge
    // aussi bien qu'une chaîne : celui-ci ne redit donc pas la valeur qu'il explique.
    // Les faits ci-dessus viennent de la documentation Imagine et restent publics.
  ]),
  // Les preuves projet de la Grille Centrale ÉTAIENT ICI, en clair : matrice, implantation
  // en baie, interfaces, plages IN/OUT non documentées (#142). Elles arrivent maintenant sur
  // la fiche catalogue par le jeu de données autorisé ; `resolveKnowledgePack` les lit sur
  // l'enregistrement. Le profil, lui, est une connaissance générique et reste public.
  'kb-grille-centrale-190x184':pack('router-matrix','',[]),
  'kb-leader-lt4610':pack('sync-generator',URL.lt4610,[
    fact('Format physique','1RU pleine largeur',URL.lt4610), fact('Fonction','Générateur de synchronisation multi-format',URL.lt4610),
    fact('Sources de verrouillage','GPS, PTP, CW, référence interne et genlock analogique selon options',URL.lt4610),
    fact('Sorties','Sync vidéo analogique, AES/EBU, word clock, timecode et 3G/HD/SD-SDI',URL.lt4610),
    fact('Haute disponibilité','Deux alimentations et fonction Stay-in-Sync',URL.lt4610),
    fact('Supervision','Ethernet / navigateur et SNMP',URL.lt4610)
  ]),
  'kb-leader-lt4448':pack('sync-generator',URL.lt4448,[fact('Fonction','Changeover automatique de sources de synchronisation',URL.lt4448)],{identificationChecklist:['Entrées primaire/secours de chaque canal','Seuils et délais de basculement','Révision matérielle et firmware']}),
  'kb-leader-lv5300a':pack('waveform-monitor',URL.lv5300,[fact('Format','Waveform monitor compact à écran tactile 7 pouces',URL.lv5300),fact('Domaine','Analyse de signaux SDI vidéo et audio',URL.lv5300),fact('Extension affichage','Sortie HDMI pour écran externe selon configuration',URL.lv5300)],{identificationChecklist:['Options SER installées','Entrées actives','Date d’étalonnage']}),
  'kb-leader-lv5350':pack('waveform-monitor',URL.lv5350,[fact('Format','Waveform monitor ZEN à écran 7 pouces',URL.lv5350),fact('Fonction','Mesure et analyse vidéo/audio SDI',URL.lv5350)],{identificationChecklist:['Options installées','Formats réellement surveillés','Date d’étalonnage']}),
  'kb-avid-nexis':pack('storage',URL.nexis,[
    fact('Fonction','Stockage partagé temps réel pour production vidéo et audio',URL.nexis),
    fact('Architecture','Moteurs E/F regroupables dans un pool de stockage',URL.nexis),
    fact('Système de fichiers','Avid NEXIS VFS',URL.nexis),
    fact('Évolutivité de la gamme','Du moteur de petite équipe aux systèmes multi-pétaoctets',URL.nexis)
  ],{identificationChecklist:['Moteur exact E/F/PRO','Nombre et capacité des Media Packs','Capacité brute/utile','Version VFS','Interfaces 10/25/40/50/100GbE réellement installées']}),
  'kb-hp-z440':pack('workstation',URL.z440,[fact('Famille','Station de travail HP Z',URL.z440),fact('Mémoire','DDR4 ECC Registered, configuration dépendante du CPU',URL.z440)],{identificationChecklist:['CPU exact','RAM installée','GPU','Disques','Cartes PCIe/NIC','OS et applications métier']}),
  'kb-hp-lp2475w':pack('display',URL.lp2475,[fact('Taille','24 pouces',URL.lp2475),fact('Famille','Écran professionnel large format HP LP',URL.lp2475)],{identificationChecklist:['Entrée réellement utilisée','Résolution/preset actif','Heures et état de dalle']}),
  'kb-sony-pdw-hd1200':pack('vtr',URL.pdw1200,[
    fact('Support','Professional Disc, y compris double couche 50 GB',URL.pdw1200),
    fact('Codec principal','MPEG HD422, HD 4:2:2 à 50 Mb/s',URL.pdw1200),
    fact('Audio','PCM 24 bits / 48 kHz, 8 canaux',URL.pdw1200),
    fact('Interfaces fonctionnelles','SDI I/O, i.LINK/FAM, FTP et SNMP selon configuration',URL.pdw1200),
    fact('Alimentation','AC, DC ou batterie avec adaptateur compatible',URL.pdw1200)
  ]),
  'kb-sony-pdw-hd1550':pack('vtr',URL.pdw1550,[fact('Fonction','Enregistreur/lecteur Professional Disc Full HD 1920×1080',URL.pdw1550),fact('Intégration','E/S SDI et fonctions réseau pour production fichier',URL.pdw1550),fact('Alimentation','AC, DC ou batterie',URL.pdw1550)],{identificationChecklist:['Confirmer PDW-HD1550 sur l’étiquette','Format/codec actif','Mapping SDI et commande distante']}),
  'kb-kramer-vs81av':pack('broadcast-processor',URL.kramer,[
    fact('Fonction','Sélecteur mécanique passif composite vidéo + audio stéréo 8×1',URL.kramer),
    fact('Entrées','8 vidéo BNC 75 Ω + 8 audio stéréo RCA',URL.kramer), fact('Sorties','1 vidéo BNC 75 Ω + 1 audio stéréo RCA',URL.kramer),
    fact('Bande passante','Vidéo 400 MHz ; audio 100 kHz',URL.kramer), fact('Format physique','19 pouces, 1RU',URL.kramer),
    fact('Alimentation','Aucune — commutation mécanique passive',URL.kramer)
  ]),
  'kb-riedel-artist':pack('intercom',URL.riedel,[fact('Architecture','Matrice intercom modulaire non bloquante',URL.riedel),fact('Évolutivité de la gamme','8×8 à 1024×1024 ports selon frame/licences',URL.riedel),fact('Interfaces possibles','SMPTE 2110-30/31 (AES67), Dante, MADI, AES3, AVB, VoIP et audio analogique selon cartes',URL.riedel),fact('Disponibilité','Cartes, contrôleurs et alimentations redondables/hot-swap selon frame',URL.riedel)],{identificationChecklist:['Frame exact Artist-32/64/128/1024','Cartes client/contrôleur/GPI','Topologie fibre','Panneaux et abonnés']}),
  'kb-ross-ultritouch':pack('control-panel',URL.ultritouch,[fact('Formats','Panneau tactile rackable 2RU ou 4RU',URL.ultritouch),fact('Plateforme','SmartTouch avec personnalisation DashBoard PanelBuilder',URL.ultritouch),fact('Interfaces à relever','Ethernet, HDMI et USB selon variante',URL.ultritouch)],{identificationChecklist:['Variante 2RU/4RU','Adresse et panneau DashBoard chargé','Systèmes contrôlés']}),
  'kb-ross-mc1uhd':pack('broadcast-processor',URL.mc1,[fact('Fonction','Master Control SD/HD/3G/UHD',URL.mc1),fact('Entrées directes','6 entrées SD/HD/3G/12G-SDI synchronisées',URL.mc1),fact('Composition vidéo','Bus A/B, 4 keyers dont 2 key/fill externes',URL.mc1),fact('Transitions','Cut, V-fade, crossfade et fade-to-black',URL.mc1),fact('Logos','Jusqu’à 4 logos statiques/animés selon format',URL.mc1),fact('Contrôle','DashBoard, panneau MC1, Ultritouch, GPI et protocoles automation selon configuration',URL.mc1)],{identificationChecklist:['Rear module R4 exact','Chaîne principale/secours','Key/fill et audio mappings','Licences/options actives']}),
  'kb-ross-mc1-panel16':pack('control-panel',URL.mc1panel,[fact('Fonction','Panneau matériel de contrôle MC1 à touches programmables',URL.mc1panel),fact('Gestion','Configuration et mises à jour via Ross DashBoard',URL.mc1panel)],{identificationChecklist:['Adresse réseau','Canal MC1 contrôlé','Affectation des 16 touches','Version logicielle']}),
  'kb-decimator-dmonquad':pack('multiviewer',URL.dmon,[fact('Fonction','Multiviewer / convertisseur compact',URL.dmon),fact('Format physique','Environ 79,5 × 123 × 29,5 mm',URL.dmon)],{identificationChecklist:['Nombre et format des entrées','Sorties SDI/HDMI raccordées','Layout actif']}),
  'kb-decimator-dmon12s':pack('multiviewer',URL.dmon,[fact('Fonction','Multiviewer 1 à 12 canaux avec sorties SDI et HDMI',URL.dmon)],{identificationChecklist:['Confirmer DMON-12S sur l’étiquette','Entrées utilisées','Layouts et sorties']}),
  'kb-cisco-c9300x12y':pack('network-switch',URL.cisco9300,[fact('Ports downlink','12 ports fibre 1/10/25 GbE SFP/SFP28',URL.cisco9300),fact('Uplinks','Modules uplink C9300X ; capacité matérielle jusqu’à 2×100G selon module',URL.cisco9300),fact('Alimentation standard indiquée','715 W AC',URL.cisco9300),fact('Empilage','StackWise-1T / StackPower+ pris en charge',URL.cisco9300)],{identificationChecklist:['Module uplink exact','SFP/SFP28 installés','Stack et priorité','Version IOS XE','Licence réseau']}),
  'kb-cisco-c9200l24':pack('network-switch',URL.cisco9200,[fact('Famille','Catalyst 9200L à uplinks fixes',URL.cisco9200),fact('Densité documentée','24 ports — type cuivre/PoE et suffixe à confirmer',URL.cisco9200),fact('Système','Cisco IOS XE, fonctions Layer 3 selon licence',URL.cisco9200)],{identificationChecklist:['SKU complet C9200L-24…','PoE/non-PoE','Uplinks 1G/10G','Version IOS XE et licence']}),
  'kb-cisco-c9200l48':pack('network-switch',URL.cisco9200,[fact('Famille','Catalyst 9200L à uplinks fixes',URL.cisco9200),fact('Densité documentée','48 ports — type cuivre/PoE et suffixe à confirmer',URL.cisco9200),fact('Système','Cisco IOS XE, fonctions Layer 3 selon licence',URL.cisco9200)],{identificationChecklist:['SKU complet C9200L-48…','PoE/non-PoE','Uplinks 1G/10G','Version IOS XE et licence']}),
  'kb-cisco-110series5':pack('network-switch',URL.cisco110,[fact('Famille','Switch non manageable Cisco Business 110',URL.cisco110),fact('Densité observée','5 ports ; vitesse exacte dépend du SKU',URL.cisco110)],{identificationChecklist:['SKU complet','Fast Ethernet ou Gigabit','Alimentation exacte']}),
  'kb-fortigate40f':pack('firewall',URL.fortigate,[fact('Fonction','NGFW, SD-WAN et sécurité convergée',URL.fortigate),fact('Système','FortiOS',URL.fortigate)],{identificationChecklist:['Révision/SKU exact','Ports et zones','Version FortiOS','Rôle HA','Licences FortiGuard — sans clés']}),
  'kb-aja-ogfsmini':pack('broadcast-processor',URL.aja,[
    fact('Fonction','Frame synchronizer openGear 3G/HD/SD-SDI avec up/down/cross conversion',URL.aja),
    fact('E/S vidéo','1× 3G-SDI entrée, sorties 3G-SDI et HDMI simultanées',URL.aja),
    fact('Audio','16 canaux embedded SDI ; 8 canaux HDMI ; 2 sorties analogiques symétriques',URL.aja),
    fact('Référence','Bi-level et tri-level',URL.aja), fact('Traitement','10 bits, délai nominal 1 frame',URL.aja),
    fact('Limite 3G','3G-SDI Level A uniquement, pas Level B',URL.aja), fact('Contrôle','Ross DashBoard',URL.aja)
  ]),
  'kb-cobalt-9940aco':pack('broadcast-processor',URL.cobalt,[
    fact('Fonction','Sélection / auto-changeover 3G/HD/SD-SDI avec critères de défaut',URL.cobalt),
    fact('Déclencheurs possibles','Loss of signal, image noire/figée et silence audio configurables',URL.cobalt),
    fact('Sorties','Jusqu’à 4 sorties BNC 75 Ω selon rear module',URL.cobalt),
    fact('Contrôle','DashBoard ou panneaux OGCP-9000',URL.cobalt), fact('Consommation','Moins de 18 W',URL.cobalt)
  ],{identificationChecklist:['Rear module RM20-9940-F exact','Entrées primaire/secours','Critères/délais de basculement','Mode frame sync']}),
  'kb-ross-sra8802':pack('broadcast-processor',URL.sra,[
    fact('Fonction','Distribution amplifier SDI reclocké 1×8 ou 1×4',URL.sra),
    fact('Débits','143 Mb/s à 2,97 Gb/s avec détection automatique',URL.sra),
    fact('Options rear module','Failover A/B (-R2), split (-R2S) ou bypass relais (-R2R)',URL.sra),
    fact('Égalisation indicative','3G 120 m, HD 200 m, SD 500 m',URL.sra), fact('Consommation','2,8 W',URL.sra)
  ]),
  'kb-ross-dra8804':pack('broadcast-processor',URL.dra,[fact('Fonction','Double distribution amplifier 3G/HD/SD-SDI',URL.dra),fact('Configurations','2 entrées / 8 ou 16 sorties selon rear module',URL.dra),fact('Failover','Basculement disponible selon configuration',URL.dra)]),
  'kb-ross-sfs8622a':pack('broadcast-processor',URL.sfs,[fact('Fonction','Frame synchronizer A/V openGear avec embedding/de-embedding audio',URL.sfs)],{identificationChecklist:['Rear module exact','Formats actifs','Référence','Mapping audio']}),
  'kb-ross-uda8705a':pack('broadcast-processor',URL.uda,[fact('Fonction','Distribution analogique / référence',URL.uda),fact('Configurations','1×8 ou 1×4 selon rear module',URL.uda)],{identificationChecklist:['Variante exacte UDA-8705A','Rear module','Signal PAL/Black/REF distribué']}),
  'kb-ross-aap8644':pack('audio-processor',URL.aap,[fact('Fonction','Advanced Audio Processor 3G/HD/SD-SDI',URL.aap),fact('E/S SDI','4 entrées et 4 sorties SD/HD/3G-SDI',URL.aap),fact('Audio externe','8 entrées AES et 4 entrées audio analogiques selon rear module',URL.aap)],{identificationChecklist:['Rear module R2C exact','Mapping AES/analogique/embedded','Preset actif']}),
  'kb-ross-ada8405c':pack('audio-processor',URL.ada,[fact('Fonction','Distribution amplifier audio analogique / timecode openGear',URL.ada)],{identificationChecklist:['Rear module exact','Nature audio ou LTC','Entrée et destinations']}),
  'kb-ross-hdc8223as':pack('broadcast-processor',URL.hdc,[fact('Fonction','Down-converter HD avec distribution et frame synchronization',URL.hdc)],{identificationChecklist:['Rear module exact','Format entrée/sortie','Mode frame sync et référence']}),
  'kb-ross-dmx82594c':pack('audio-processor',URL.dmx,[fact('Fonction','De-embedder audio depuis 3G/HD/SD-SDI',URL.dmx)],{identificationChecklist:['Confirmer DMX-8259-4C et non DMUX','Rear module R2C','Groupes audio extraits','Sorties et destinations']}),
  'kb-tsl-tallyman':pack('control-panel',URL.tallyman,[fact('Fonction','Système de contrôle et tally broadcast multi-constructeurs',URL.tallyman),fact('Interopérabilité','Intégration indépendante des protocoles, protocoles majeurs inclus selon contrôleur',URL.tallyman)],{identificationChecklist:['Contrôleur exact TM1/TM2','Protocoles et équipements raccordés','Redondance','Version TallyMan']}),
  'kb-axon-sfr08':pack('modular-frame',URL.axon,[fact('Format','Châssis Synapse 2RU à 8 slots',URL.axon),fact('Compatibilité','Modules Synapse interchangeables au sein de la gamme',URL.axon),fact('Fonctions possibles','Traitement, distribution, conversion et analyse audio/vidéo selon cartes',URL.axon)],{identificationChecklist:['Cartes Synapse des 8 slots','Contrôleur / Ethernet','Références centrales','Alimentations']}),
  'kb-dell-r350':pack('server',URL.dell,[fact('Format','Serveur rack 1U',URL.dell),fact('Processeur supporté','1× Intel Xeon E-2300, jusqu’à 8 cœurs',URL.dell),fact('Gestion','Dell iDRAC — version/licence à relever sur l’instance',URL.dell)],{identificationChecklist:['Service Tag','CPU/RAM/disques/RAID','NIC/OCP','iDRAC','OS et service hébergé']}),
  'kb-dell-r450':pack('server',URL.dell,[fact('Format','Serveur rack 1U',URL.dell),fact('Plateforme','PowerEdge 15e génération, configuration bi-processeur selon assemblage',URL.dell),fact('Stockage boot possible','BOSS-S1 avec 2 SSD M.2 selon configuration',URL.dell)],{identificationChecklist:['Service Tag','CPU/RAM','Baies disques et PERC/HBA','NIC/OCP','iDRAC','OS et service']}),
  'kb-dell-r550':pack('server',URL.dell,[fact('Format','Serveur rack 2U',URL.dell),fact('Réseau embarqué possible','2×1GbE LOM et options OCP selon configuration',URL.dell),fact('Alimentation','Jusqu’à deux PSU AC/DC selon configuration',URL.dell)],{identificationChecklist:['Service Tag','CPU/RAM','Disques/RAID','NIC/OCP','iDRAC','OS et service']}),
  'kb-dell-r750':pack('server',URL.dell,[fact('Format','Serveur rack 2U',URL.dell),fact('Plateforme','Serveur bi-processeur PowerEdge 15e génération',URL.dell),fact('Gestion','iDRAC et options réseau/stockage dépendantes de la configuration',URL.dell)],{identificationChecklist:['Service Tag','CPU/RAM','Disques/RAID','GPU/PCIe si présents','NIC/OCP','iDRAC','OS et service']}),
  'kb-dell-precision3930r':pack('workstation',URL.dell,[fact('Format','Workstation rack 1U',URL.dell)],{identificationChecklist:['Service Tag','CPU/RAM/GPU','Disques','NIC','OS et application métier']}),
  'kb-genelec-monitor':pack('audio-processor','',[],{identificationChecklist:['Modèle Genelec exact sur la plaque arrière','Type actif/passif','Entrée analogique/AES/IP','Calibration et position']}),
  'kb-maudio-device':pack('audio-processor','',[],{identificationChecklist:['Modèle M-Audio exact','Fonction réelle','Interfaces audio/MIDI/USB','Alimentation et pilote']}),
  'kb-recorder-systems':pack('server','',[],{identificationChecklist:['Constructeur et modèle exacts','Fonction ingest/record/playout','Canaux SDI/audio','OS, logiciel et stockage','Redondance et licences']}),
  'kb-tc-dbmax':pack('audio-processor','',[],{identificationChecklist:['Référence/révision exacte DBMAX','E/S numériques/analogiques','Preset et cible loudness','Référence horloge']}),
  'kb-orban2200':pack('audio-processor','',[],{identificationChecklist:['Appellation complète OPTIMOD 2200 sur façade/plaque','E/S et format audio','Preset actif','Mode analogique/numérique']}),
  'kb-harmonic-spectrum':pack('server','https://www.harmonicinc.com/video-streaming/spectrum/',[fact('Famille','Plateforme de serveurs média Spectrum pour ingest/playout', 'https://www.harmonicinc.com/video-streaming/spectrum/')],{identificationChecklist:['Modèle Spectrum/MediaCenter/VSX exact','Canaux et licences','Stockage raccordé','Version logicielle','Redondance']}),
  'kb-harmonic-spectrum-vsx':pack('server','https://www.harmonicinc.com/video-streaming/spectrum/',[fact('Famille','Serveur média / playout Harmonic Spectrum', 'https://www.harmonicinc.com/video-streaming/spectrum/')],{identificationChecklist:['Confirmer variante VSX','Canaux et licences','Interfaces vidéo','Version logicielle','Stockage et redondance']})
});

const GENERIC_CHECKLISTS = Object.freeze({
  generic:['Photo de la plaque signalétique','Constructeur, modèle, révision et numéro de série','Fonction réelle et connexions'],
  display:['Modèle exact sur la plaque arrière','Taille/résolution','Entrées actives','Position et calibration'],
  kvm:['Modèle exact','Nombre de cibles','Type de console','Accès IP et firmware'],
  server:['Modèle exact / Service Tag','CPU, RAM, stockage et RAID','NIC et gestion distante','OS, logiciels, licences et sauvegarde'],
  workstation:['Modèle exact','CPU, RAM, GPU, stockage','OS et logiciels métier'],
  multiviewer:['Modèle exact','Entrées/sorties','Layouts et licences','Version et référence'],
  'audio-processor':['Modèle/révision exacte','E/S et mapping','Preset/firmware','Référence et redondance'],
  'broadcast-processor':['Modèle et rear module','Entrées/sorties','Format, référence et firmware','Bypass/failover'],
  'control-panel':['Modèle exact','Système contrôlé','Adresse/protocole','Affectation des touches et version'],
  'modular-frame':['Modèle du frame','Cartes et slots','Rear modules','Contrôleur, références et PSU'],
  'router-matrix':['Châssis exact','Capacité installée','Cartes E/S','Contrôle, références et monitoring'],
  'network-switch':['SKU complet','Ports/SFP/uplinks','Stack, OS et licences','Sauvegarde de configuration'],
  firewall:['SKU et révision','Ports/zones','HA, OS et licences','Sauvegarde de configuration'],
  storage:['Moteur exact','Disques/packs et capacités','Réseau et VFS','Protection et sauvegarde'],
  vtr:['Modèle exact','Support/codec','E/S et commande','Compteurs et maintenance'],
  intercom:['Frame/panneau exact','Cartes/ports','Topologie et synchronisation','Redondance'],
  'sync-generator':['Modèle/révision','Sources de verrouillage','Sorties actives','Redondance et firmware'],
  'waveform-monitor':['Modèle/révision','Options/licences','Entrées actives','Étalonnage']
});

export function resolveKnowledgePack(catalogRecord = {}) {
  const specific = DEVICE_KNOWLEDGE_PACKS[catalogRecord.id] || {};
  const profile = specific.profile || inferKnowledgeProfile(catalogRecord);
  /*
   * Les preuves projet viennent de la FICHE, pas de ce module.
   *
   * Une preuve d'installation réelle n'a rien à faire dans un fichier téléchargeable sans
   * compte. Elle est écrite sur l'enregistrement catalogue par le producteur autorisé — pour
   * la Grille Centrale, `grille-centrale-knowledge.js` après réponse de l'endpoint protégé.
   * Une fiche non hydratée n'a donc pas de preuve projet, et c'est le comportement voulu.
   */
  const hydratedEvidence = Array.isArray(catalogRecord.projectEvidence) && catalogRecord.projectEvidence.length
    ? catalogRecord.projectEvidence
    : null;
  const hydratedChecklist = Array.isArray(catalogRecord.identificationChecklist) && catalogRecord.identificationChecklist.length
    ? catalogRecord.identificationChecklist
    : null;
  return Object.freeze({
    profile,
    profileLabel:KNOWLEDGE_PROFILES[profile]?.label || KNOWLEDGE_PROFILES.generic.label,
    sourceUrl:specific.sourceUrl || catalogRecord.documentationUrl || '',
    facts:specific.facts || Object.freeze([]),
    projectEvidence:Object.freeze(hydratedEvidence || specific.projectEvidence || []),
    aliases:specific.aliases || Object.freeze([]),
    identificationChecklist:Object.freeze(hydratedChecklist || specific.identificationChecklist || GENERIC_CHECKLISTS[profile] || GENERIC_CHECKLISTS.generic)
  });
}

export function enrichCatalogKnowledge(record = {}) {
  const knowledge = resolveKnowledgePack(record);
  return { ...record, knowledgeProfile:knowledge.profile, officialFacts:knowledge.facts, projectEvidence:knowledge.projectEvidence, identificationChecklist:knowledge.identificationChecklist, aliases:knowledge.aliases };
}

export { VERIFIED_AT as KNOWLEDGE_VERIFIED_AT };
