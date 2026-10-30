/**
 * @file scripts/private-operational-data/grille-centrale.js
 *       LE PLAN DOCUMENTÉ DE LA GRILLE CENTRALE — DONNÉE OPÉRATIONNELLE 2M, JAMAIS SERVIE.
 *
 * CE QUE CE FICHIER FERME (#137, sous-lot de #132)
 * ------------------------------------------------
 * Ces tableaux vivaient dans `grille-centrale-documented-map.js`,
 * `grille-centrale-topology.js`, `grille-centrale-knowledge.js` et
 * `grille-centrale-physical-architecture.js` — quatre modules servis à la racine, donc
 * téléchargeables par n'importe qui. Mesuré sur la base 8f51238d :
 *
 *     curl -s http://…/grille-centrale-documented-map.js | grep -o '"STC [0-9]*"'
 *     "STC 1" "STC 2" "STC 3" …                                    ← HTTP 200, aucun cookie
 *
 * 190 libellés d'entrée, 184 de sortie, les repères GR, les chemins monitoring vers
 * BAIE 3 / CHASSIS 5, les postes CTRL-STC et la référence du synoptique interne
 * (LTS MAROC — DT/EH/11/2011) partaient ainsi AVANT toute session, donc avant
 * `canAccessRecord`, avant `resource_zones`, avant `/api/sync`. Aucun filtre placé en aval
 * n'a de valeur tant que la donnée est en amont, dans un actif public.
 *
 * POURQUOI ICI, ET PAS DANS UN AUTRE FICHIER RACINE
 * -------------------------------------------------
 * `serve.js` refuse déjà tout chemin dont un segment appartient à `PRIVATE_PREFIXES`, et
 * `scripts` en fait partie : ce fichier n'est joignable par AUCUNE requête HTTP. Déplacer
 * le jeu de données vers un autre module racine, vers un JSON public, ou l'encoder en
 * base64 n'aurait rien fermé — le navigateur non authentifié en recevrait toujours les
 * octets. La seule règle qui tient est celle-ci : il n'est pas servi.
 *
 * IL N'Y A PAS DE LISTE DE MOTS INTERDITS ICI
 * -------------------------------------------
 * Le partage ne se fait pas sur « STC » ou « RF ». Il se fait sur la NATURE : ce fichier ne
 * contient que ce qui décrit l'installation réelle de 2M — libellés de ports affectés,
 * repères de câbles, implantation en baie, capacité de la matrice, document source interne.
 * Le code d'affichage, les types, les validateurs et les identifiants canoniques restent
 * publics : ils ne révèlent aucune installation.
 *
 * QUI PEUT LES LIRE
 * -----------------
 * `GET /api/operational/grille-centrale/documented-map`, et lui seul. L'autorisation n'y
 * est pas écrite en dur : elle résout l'ÉQUIPEMENT canonique de la Grille Centrale dans les
 * fiches centrales, puis pose au moteur d'accès la question qu'il pose pour tout autre
 * équipement. Équipement → Baie → Salle → Zone. Introuvable ou ambigu : refus.
 */

export const GRILLE_CENTRALE_SOURCE_DOCUMENT = Object.freeze({
  type:'site-engineering-synoptic',
  ownerLabel:'LTS MAROC',
  project:'GC 2M',
  documentId:'DT/EH/11/2011',
  documentDate:'2012-08-31',
  designation:'SYNOPTIQUE VIDEO GRILLE CENTRALE',
  revisionVisible:'V1-8…',
  format:'A0',
  author:'Son Tran',
  evidenceStatus:'field-photo-of-site-document',
  sourceAuthority:'2M engineering synoptic photographed on site',
  currentAsBuiltStatus:'not-yet-field-traced'
});

export const GRILLE_CENTRALE_INPUT_LABELS = Object.freeze([
  "VTR 1", "VTR 2", "VTR 3", "VTR 4", "VTR 5",
  "VTR 6", "VTR 7", "VTR 8", "VTR 9", "VTR 10",
  "VTR 11", "VTR 12", "VTR 13", "RF 1", "RF 13",
  "RF 2", "RF 23", "RF 3", "MIRE", "SYNC 9",
  "SYNC 10", "SYNC 11", "SYNC 12", "SYNC 13", "SYNC 14",
  "SYNC 15", "SYNC 16", "ST 11", "ST 12", "ST 21",
  "ST 22", "ST 31", "ST 13", "ST 14", "ST 23",
  "ST 24", "ST 15", "ST 53", "ST 33", "ST 45",
  "ST 52", "ST 32", "ST 41", "ST 42", "ST 43",
  "ST 44", "ST 51", "RESERVE 1", "MT 11", "MT 12",
  "MT 21", "MT 22", "ISY RVB1", "ISY RVB2", "ISY PICB",
  "ISY HALL", "ISY ASTON", "ISY PB3", "ISY DEKO 1", "ISY MAC 1",
  "ISY MAC 2", "ISY PB4", "ISY DEKO 2", "ISY CURIUS 1", "ISY CURIUS 2",
  "ISY ARTIST 1", "ISY ARTIST 2", "ISY VTR 1", "ISY VTR 2", "SYNC 1",
  "RF 12", "SYNC 2", "RF 14", "RF 15", "SYNC 3",
  "RF 22", "SYNC 4", "RF 24", "RF 25", "SYNC 7",
  "RF 32", "RF 33", "RF 34", "RF 35", "NEDIT 1",
  "NEDIT 2", "NEDIT 5", "NEDIT 4", "NEWS 1", "NEWS 2",
  "NEWS 3", "NEWS 4", "NEWS 5", "NEWS 6", "NEWS 7",
  "NEWS 8", "EXT 1", "EXT 2", "EXT 3", "EXT 4",
  "SAT 1", "SAT 2", "SAT 3", "SAT 4", "SAT 5",
  "SAT 6", "SAT 7", "SAT 8", "SAT 9", "SAT 10",
  "SAT 11", "SAT 12", "DEMUX 1", "DEMUX 2", "DEMUX 3",
  "MUX 1", "MUX 2", "MUX 3", "RADIO 1", "RADIO 2",
  "NOIR", "SYNC 8", "ST 46", "RESERVE 2", "RESERVE 3",
  "RESERVE 4", "RESERVE 5", "RESERVE 6", "HD VTR 1", "HD VTR 2",
  "HD VTR 3", "HD VTR 5", "HD VTR 6", "HD VTR 7", "HD VTR 8",
  "HD VTR 9", "HD VTR 10", "HD VTR 12", "HD ST 41", "HD ST 42",
  "HD ST 43", "HD ST 44", "HD ST 45", "HD ST 46", "AVID 1",
  "AVID 2", "AVID 3", "AVID 4", "AVID 5/HD", "AVID 6/HD",
  "AVID 7/HD", "AVID 8/HD", "SAT 13", "SAT 14", "SAT 15",
  "SAT 16", "SAT 17", "SAT 18", "SAT 19", "HD MIRE",
  "DEMUX 4/HD", "DEMUX 5/HD", "DEMUX 6/HD", "MUX 4/HD", "MUX 5/HD",
  "MUX 6/HD", "HD NOIR", "SAT 20", "RESERVE 7", "RESERVE 8",
  "RESERVE 9", "RESERVE 10", "RESERVE 11", "RESERVE 12", "RESERVE 13",
  "RESERVE 14", "RESERVE 15", "RESERVE 16", "RESERVE 17", "RESERVE 18",
  "RESERVE 19", "RESERVE 20", "RESERVE 21", "RESERVE 22", "RESERVE 23",
  "RESERVE 24", "RESERVE 25", "RESERVE 26", "RESERVE 27", "RESERVE 28",
]);

export const GRILLE_CENTRALE_OUTPUT_LABELS = Object.freeze([
  "VTR 1", "VTR 2", "VTR 3", "VTR 4", "VTR 5",
  "VTR 8", "VTR 9", "VTR 10", "ST 34", "ST 35",
  "ST 36", "CNA-1", "CNA-2", "CNA-3", "CNA-4",
  "SYNCH 7", "SYNCH 8", "SYNCH 9", "SYNCH 10", "SYNCH 11",
  "SYNCH 12", "SYNCH 13", "SYNCH 14", "SYNCH 15", "SYNCH 16",
  "ST 11", "ST 12", "ST 13", "ST 14", "ST 15",
  "ST 16", "ST 21", "ST 22", "ST 23", "ST 24",
  "ST 25", "ST 26", "ST 31", "ST 32", "ST 33",
  "VTR 11", "VTR 12", "VTR 13", "ST 51", "ST 52",
  "ST 53", "ST 54", "ST 41", "ST 42", "ST 43",
  "ST 44", "ST 45", "ST 46", "STC 1", "STC 2",
  "STC 3", "MT 14", "MT 21", "MT 22", "MT 23",
  "MT 24", "MIX 11", "MIX 12", "MIX 1", "MIX 21",
  "MIX 22", "MIX 2", "ISY RVB1", "ISY RVB2", "ISY PICB",
  "ISY PB 3", "ISY ASTON", "ISY VTR1", "ISY DEKO 1", "ISY HALL",
  "ISY DEKO 2", "VTR2 SYNTHESE", "MT 11", "MT 12", "MT 13",
  "STC 4", "STC 5", "STC 6", "STC 7", "STC 8",
  "STC 9", "STC 10", "STC 11", "RADIO 2", "RADIO 3",
  "STC 14", "STC 15", "AVID-1", "AVID-2", "AVID-3",
  "AVID-4", "AVID-5", "AVID-6", "AVID-7", "AVID-8",
  "NEDIT 1", "NEDIT 2", "NEDIT 5", "NEDIT 4", "2M TV 1",
  "2M TV 2", "CONF 1", "CONF 2", "RADAC", "MAINT 1",
  "MAINT 2", "RADIO 1", "STC 12", "STC 13", "NEWS 1",
  "NEWS 2", "EXT 1", "EXT 2", "NEWS 5", "NEWS 6",
  "NEWS 7", "NEWS 8", "NEWS 9", "NEWS 10", "NEWS 11",
  "NEWS 12", "NEWS 3", "NEWS 4", "EXT 3", "EXT 4",
  "DEMUX 1", "DEMUX 2", "DEMUX 3", "MUX 1", "MUX 2",
  "MUX 3", "RESERVE 1", "RESERVE 2", "RESERVE 3", "RESERVE 4",
  "RESERVE 5", "RESERVE 6", "RESERVE 7", "AUDIOMON", "HD VTR 1",
  "HD VTR 2", "HD VTR 3", "HD VTR 5", "HD VTR 6", "HD VTR 7",
  "HD VTR 8", "HD VTR 9", "HD VTR 10", "HD VTR 12", "HD ST 41",
  "HD ST 42", "HD ST 43", "HD ST 44", "HD ST 45", "HD ST 46",
  "DEMUX-4(HD)", "DEMUX-5(HD)", "DEMUX-6(HD)", "MUX-4(HD)", "MUX-5(HD)",
  "MUX-6(HD)", "RESERVE 9", "RESERVE 10", "RESERVE 11", "RESERVE 12",
  "RESERVE 13", "RESERVE 14", "RESERVE 15", "RESERVE 16", "RESERVE 17",
  "RESERVE 18", "RESERVE 19", "RESERVE 20", "RESERVE 21", "RESERVE 22",
  "RESERVE 23", "RESERVE 24", "RESERVE 25", "RESERVE 26",
]);

export const GRILLE_CENTRALE_DOCUMENT_DOMAINS = Object.freeze([
  Object.freeze({ id:'IN/SDI', direction:'INPUT', from:1, to:128, count:128, documentSignalLabel:'SDI' }),
  Object.freeze({ id:'IN/HD', direction:'INPUT', from:129, to:190, count:62, documentSignalLabel:'HD' }),
  Object.freeze({ id:'OUT/SDI', direction:'OUTPUT', from:1, to:144, count:144, documentSignalLabel:'SDI' }),
  Object.freeze({ id:'OUT/HD', direction:'OUTPUT', from:145, to:184, count:40, documentSignalLabel:'HD' })
]);

export const GRILLE_CENTRALE_REFERENCE_INTERFACES = Object.freeze([
  Object.freeze({ name:'SYNCH 1', function:'BLACK', class:'SYNC_REFERENCE', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'SYNCH 2', function:'Tri-Level', class:'SYNC_REFERENCE', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'SYNCH 3', function:'REF-AES', class:'SYNC_REFERENCE', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'SYNCH 4', function:'TDM SYNC (INTERNE)', class:'SYNC_REFERENCE', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'XY-1', function:'physical assignment to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'XY-2', function:'physical assignment to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'ENET-1', function:'protocol to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'ENET-2', function:'protocol to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'SERIAL 1', function:'protocol/pinout to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' }),
  Object.freeze({ name:'SERIAL 2', function:'protocol/pinout to confirm', class:'CONTROL', verificationStatus:'2M-synoptic-confirmed' })
]);

export const GRILLE_CENTRALE_GR_OBSERVATIONS = Object.freeze([
  Object.freeze({ id:'gc-gr-example-in-001', routerPort:'IN.1', nearRef:'GR1', farRef:'GR27', relationSymbol:'normalization-or-connection-symbol', pairEvidence:'2M-synoptic-confirmed', patchInterpretation:'probable', physicalPanelModel:null }),
  Object.freeze({ id:'gc-gr-example-in-002', routerPort:'IN.2', nearRef:'GR2', farRef:'GR28', relationSymbol:'normalization-or-connection-symbol', pairEvidence:'2M-synoptic-confirmed', patchInterpretation:'probable', physicalPanelModel:null }),
  Object.freeze({ id:'gc-gr-example-out-001', routerPort:'OUT.1', nearRef:'GR417', farRef:'GR443', relationSymbol:'normalization-or-connection-symbol', pairEvidence:'2M-synoptic-confirmed', patchInterpretation:'probable', physicalPanelModel:null }),
  Object.freeze({ id:'gc-gr-example-out-002', routerPort:'OUT.2', nearRef:'GR418', farRef:'GR444', relationSymbol:'normalization-or-connection-symbol', pairEvidence:'2M-synoptic-confirmed', patchInterpretation:'probable', physicalPanelModel:null })
]);

export const GRILLE_CENTRALE_MONITORING_PATHS = Object.freeze([
  Object.freeze({ id:'gc-monitoring-path-1', output:'MONITORING/OUT.1', grNear:'GR691', grFar:'GR717', relationSymbol:'normalization-or-connection-symbol', destination:Object.freeze({ rack:'BAIE 3', chassis:'CHASSIS 5', equipment:'DMUX/1', manufacturer:'Harris', model:'HDX6801+B4D', exactVariantStatus:'document-photo-confirmed' }), designMapping:'2M-synoptic-confirmed', currentPhysicalCableVerified:false }),
  Object.freeze({ id:'gc-monitoring-path-2', output:'MONITORING/OUT.2', grNear:'GR692', grFar:'GR718', relationSymbol:'normalization-or-connection-symbol', destination:Object.freeze({ rack:'BAIE 3', chassis:'CHASSIS 5', equipment:'DMUX/2', manufacturer:'Harris', familyCandidate:'HDX6801+', model:null, exactVariantStatus:'to-confirm' }), designMapping:'2M-synoptic-confirmed', currentPhysicalCableVerified:false })
]);

export const GRILLE_CENTRALE_PHASE13_INVARIANTS = Object.freeze({
  logicalInputs:190,
  logicalOutputs:184,
  dedicatedMonitoringOutputs:2,
  monitoringOutputsAreNotMatrixOutputs:true,
  monitoringOutputNumbers:Object.freeze(['MONITORING/OUT.1','MONITORING/OUT.2']),
  syncReferencesAreNotInputs:true,
  exactFrameSku:null,
  exactCardSlotPopulation:null,
  rearConnectorMappingStatus:'to-confirm',
  activeCrosspointsCreated:false,
  activeCrosspointsInferred:false,
  grReferencesAreNotHarrisPhysicalPortNumbers:true,
  grPatchInterpretationStatus:'probable',
  designDocumentIsNotCurrentAsBuiltProof:true
});

export const GRILLE_CENTRALE_TOPOLOGY_INTERFACES = Object.freeze([
  { id:'gc-topo-sync-1', interfaceType:'SYNC_REFERENCE', name:'SYNCH 1', function:'BLACK / référence vidéo', cableRefs:['GR1021'] },
  { id:'gc-topo-sync-2', interfaceType:'SYNC_REFERENCE', name:'SYNCH 2', function:'Tri-Level 75 Ω', cableRefs:['GR1002'] },
  { id:'gc-topo-sync-3', interfaceType:'SYNC_REFERENCE', name:'SYNCH 3', function:'REF-AES 75 Ω', cableRefs:['GR1003'] },
  { id:'gc-topo-sync-4', interfaceType:'SYNC_REFERENCE', name:'SYNCH 4', function:'TDM SYNC interne', cableRefs:[] },
  { id:'gc-topo-xy-1', interfaceType:'CONTROL', name:'XY-1', function:'Commande matrice', cableRefs:[] },
  { id:'gc-topo-xy-2', interfaceType:'CONTROL', name:'XY-2', function:'Commande matrice', cableRefs:[] },
  { id:'gc-topo-enet-1', interfaceType:'CONTROL', name:'ENET-1', function:'Contrôle réseau', cableRefs:[] },
  { id:'gc-topo-enet-2', interfaceType:'CONTROL', name:'ENET-2', function:'Contrôle réseau', cableRefs:[] },
  { id:'gc-topo-serial-1', interfaceType:'CONTROL', name:'SERIAL 1', function:'Contrôle série', cableRefs:[] },
  { id:'gc-topo-serial-2', interfaceType:'CONTROL', name:'SERIAL 2', function:'Contrôle série', cableRefs:[] },
  { id:'gc-topo-monitor-1', interfaceType:'MONITORING_OUTPUT', name:'MONITORING/OUT.1', function:'Monitoring sortie 1', cableRefs:['GR691','GR717'] },
  { id:'gc-topo-monitor-2', interfaceType:'MONITORING_OUTPUT', name:'MONITORING/OUT.2', function:'Monitoring sortie 2', cableRefs:['GR692','GR718'] },
  { id:'gc-topo-ctrl-baie3', interfaceType:'CONTROL_STATION', name:'CTRL-BAIE3', function:'Poste de contrôle Grille Centrale en baie 3', cableRefs:[] },
  { id:'gc-topo-ctrl-stc1', interfaceType:'CONTROL_STATION', name:'CTRL-STC 1', function:'Poste de contrôle Grille Centrale STC 1', cableRefs:[] },
  { id:'gc-topo-ctrl-stc2', interfaceType:'CONTROL_STATION', name:'CTRL-STC 2', function:'Poste de contrôle Grille Centrale STC 2', cableRefs:[] }
]);

export const GRILLE_CENTRALE_ALIASES = Object.freeze([
  'GRILLE CENTRALE',
  'Grille Centrale',
  'GRILLE CENTRALE 190x184',
  'Grille Centrale 190 x 184',
  'GRILLE CENTRALE 190×184'
]);

export const GRILLE_CENTRALE_CANDIDATE_IMAGES = Object.freeze([
  {
    url:'https://www.alliedbroadcast.com/web/image/product.template/36959/image_1920?unique=ca43ae0',
    sourcePage:'https://www.alliedbroadcast.com/shop/c2-harris-pt-fr-15-used-36959',
    sourceType:'secondary-source',
    sourceTrust:'trusted-broadcast-reseller',
    verificationStatus:'candidate',
    modelMatch:'capacity-compatible-family-example',
    requiresFieldConfirmation:true,
    view:'front/chassis-example',
    alt:'Harris Platinum PT-FR-15 — châssis de référence candidat, pas une photo confirmée de la Grille Centrale 2M',
    matchNote:'Référence visuelle seulement. Le projet 2M externe cite HARRIS 190x190. Un Platinum 15RU est une architecture de capacité compatible, mais le châssis exact 2M peut être différent ou plus grand. Comparer façade, hauteur RU, portes, modules et étiquette avant toute promotion.'
  }
]);

export const GRILLE_CENTRALE_FACTS = Object.freeze([
  { id:'gc-matrix', label:'Matrice documentée', value:'190 entrées × 184 sorties', verificationStatus:'documented', source:'Synoptique 2M — BAIE 3 GRILLE CENTRALE' },
  { id:'gc-domain', label:'Domaine signal', value:'SDI / vidéo broadcast', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-location', label:'Implantation', value:'BAIE 3 GRILLE CENTRALE', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-role', label:'Rôle', value:'Routeur matriciel central : sélectionne une source vidéo sur une entrée et établit un crosspoint vers une ou plusieurs destinations de sortie.', verificationStatus:'derived-from-documented-matrix', source:'Topologie 2M + principe de routage matriciel' },
  { id:'gc-not-grille72', label:'Relation avec GRILLE72', value:'Équipement distinct de GRILLE72 72×72 / Imagine Platinum VX. Ne jamais fusionner les deux sans preuve terrain.', verificationStatus:'documented', source:'Extraction topologique 2M' },
  { id:'gc-harris-evidence', label:'Constructeur candidat', value:'Harris Broadcast — une référence externe au projet 2M de septembre 2012 décrit une grille centrale 190×190 HARRIS.', verificationStatus:'external-project-evidence', source:'Sébastien Tardy — projet « GRILLE CENTRALE de 2M »' },
  { id:'gc-platinum-hypothesis', label:'Famille matérielle candidate', value:'Harris Platinum historique — hypothèse de famille seulement. Les châssis 15RU de cette gamme peuvent atteindre 256×256, donc la capacité est compatible avec 190×190, mais aucune étiquette 2M ne confirme PT-FR-15.', verificationStatus:'capacity-compatible-hypothesis', source:'Documentation/archives Harris Platinum + preuve projet 2M HARRIS' },
  { id:'gc-dimension-discrepancy', label:'Écart de dimension à résoudre', value:'Le synoptique interne documente 190×184 alors que la référence projet externe mentionne 190×190. Ne pas modifier la matrice 2M tant que le châssis/backplane n’est pas photographié et identifié.', verificationStatus:'to-confirm', source:'Comparaison synoptique interne / référence projet externe' },
  { id:'gc-sync', label:'Références de synchronisation', value:'SYNCH 1 BLACK (GR1021) · SYNCH 2 Tri-Level 75 Ω (GR1002) · SYNCH 3 REF-AES 75 Ω (GR1003) · SYNCH 4 TDM SYNC interne', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-control', label:'Interfaces de contrôle', value:'XY-1 · XY-2 · ENET-1 · ENET-2 · SERIAL 1 · SERIAL 2', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-monitoring', label:'Sorties monitoring', value:'MONITORING/OUT.1 (GR691/GR717) · MONITORING/OUT.2 (GR692/GR718)', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-cables', label:'Numérotation câbles', value:'VIDEO HD/SDI : GR1–GR945 · libres vidéo : GR885–GR999 · références vidéo : GR1001–GR1032 · légende incluant VIDEO PAL/REF et AUDIO AES', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-sources', label:'Familles de sources visibles', value:'VTR, RF, MIRE, SYNCH et autres sources documentées sur les entrées visibles.', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-destinations', label:'Familles de destinations visibles', value:'VTR, ST, CNA, SYNCH, STC, MT, MIX, AVID, NEDIT, 2MTV, CONF, RADAC, maintenance, radio, NEWS, MUX/DEMUX et réserves.', verificationStatus:'documented', source:'Synoptique 2M' },
  { id:'gc-crosspoints', label:'Crosspoints actifs', value:'Non déduits : le plan statique documente les ports et destinations, pas l’état de routage actif à un instant donné.', verificationStatus:'protected-no-inference', source:'Règle d’intégrité 2M' },
  { id:'gc-control-stations', label:'Postes de contrôle/monitoring', value:'GRILLE CENTRALE CTRL-BAIE3 + CTRL-STC 1 + CTRL-STC 2, avec monitoring REF A/B et mesure A/B/REF documentés.', verificationStatus:'documented', source:'Synoptique 2M' }
]);

export const GRILLE_CENTRALE_PORTS = Object.freeze([
  { id:'gc-sync-1', number:'SYNCH 1', label:'BLACK · câble GR1021', type:'Référence vidéo', direction:'INPUT', verificationStatus:'documented' },
  { id:'gc-sync-2', number:'SYNCH 2', label:'Tri-Level · 75 Ω · câble GR1002', type:'Référence vidéo', direction:'INPUT', verificationStatus:'documented' },
  { id:'gc-sync-3', number:'SYNCH 3', label:'REF-AES · 75 Ω · câble GR1003', type:'Référence audio/vidéo', direction:'INPUT', verificationStatus:'documented' },
  { id:'gc-sync-4', number:'SYNCH 4', label:'TDM SYNC (INTERNE)', type:'Synchronisation interne', direction:'INTERNAL', verificationStatus:'documented' },
  { id:'gc-xy-1', number:'XY-1', label:'Commande matrice', type:'Control', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-xy-2', number:'XY-2', label:'Commande matrice', type:'Control', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-enet-1', number:'ENET-1', label:'Contrôle réseau', type:'Ethernet', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-enet-2', number:'ENET-2', label:'Contrôle réseau', type:'Ethernet', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-serial-1', number:'SERIAL 1', label:'Contrôle série', type:'Serial', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-serial-2', number:'SERIAL 2', label:'Contrôle série', type:'Serial', direction:'CONTROL', verificationStatus:'documented' },
  { id:'gc-monitor-1', number:'MONITORING/OUT.1', label:'Segments GR691 / GR717', type:'Monitoring', direction:'OUTPUT', verificationStatus:'documented' },
  { id:'gc-monitor-2', number:'MONITORING/OUT.2', label:'Segments GR692 / GR718', type:'Monitoring', direction:'OUTPUT', verificationStatus:'documented' }
]);

/*
 * Trois vues dérivées des interfaces documentées. Elles vivaient en tête de
 * `grille-centrale-physical-architecture.js` et se calculaient à l'import du module public ;
 * elles suivent ici la donnée dont elles sont tirées.
 */
const asArray = value => Array.isArray(value) ? value : [];
const monitoringInterfaces = GRILLE_CENTRALE_TOPOLOGY_INTERFACES.filter(item => item.interfaceType === 'MONITORING_OUTPUT');
const controlSyncInterfaces = GRILLE_CENTRALE_TOPOLOGY_INTERFACES.filter(item => item.interfaceType === 'CONTROL' || item.interfaceType === 'SYNC_REFERENCE');
const monitoringNames = Object.freeze(monitoringInterfaces.map(item => item.name));
const monitoringCableRefs = Object.freeze([...new Set(monitoringInterfaces.flatMap(item => asArray(item.cableRefs)))]);
const logicalControlSyncNames = Object.freeze(controlSyncInterfaces.map(item => item.name));

export const GRILLE_CENTRALE_VENDOR_RESEARCH = Object.freeze([
  Object.freeze({
    id:'imagine-platinum-routing-portfolio',
    publisher:'Imagine Communications',
    url:'https://imaginecommunications.com/make-tv/products/production-infrastructure/platinum-routers/',
    scope:'vendor-family-only',
    supports:Object.freeze([
      'Platinum est une famille de solutions de routing broadcast.',
      'Le contrôle et le monitoring Magellan sont présentés comme une couche fonctionnelle distincte du routeur.'
    ]),
    doesNotProve:Object.freeze([
      'SKU du châssis 2M',
      'cartes ou slots installés chez 2M',
      'mapping physique GR-1 / GR-2 / GR-3',
      'capacité locale de la matrice'
    ])
  }),
  Object.freeze({
    id:'imagine-platinum-vx-2015',
    publisher:'Imagine Communications',
    url:'https://imaginecommunications.com/insights-and-resources/imagine-communications-introduces-platinum-vx-small-to-midsize-digital-video-router/',
    scope:'product-separation-only',
    supports:Object.freeze([
      'Platinum VX est un produit distinct de la famille Platinum.',
      'Les capacités annoncées par le constructeur dépendent du produit et du format de châssis.'
    ]),
    doesNotProve:Object.freeze([
      'que le Harris Platinum legacy photographié chez 2M est un Platinum VX',
      'que la matrice 2M est 288×288 ou toute autre capacité constructeur générique'
    ]),
    note:'La plage constructeur 16×16 à 288×288 du Platinum VX n’est jamais appliquée à la matrice interne 2M 190×184.'
  })
]);

export const GRILLE_CENTRALE_PHYSICAL_NODES = Object.freeze([
  Object.freeze({
    id:'gc-physical-gr1-inputs',
    name:'BAIE GR-1 — Inputs',
    zone:'BAIE GR-1',
    role:'INPUT_PATCH_ZONE',
    evidenceAssetId:'2m-field-01',
    verificationStatus:'field-photo-confirmed',
    visibleLabels:Object.freeze(['E.VIDEO-SD','E.VIDEO-HD','E.AUDIO','RS422']),
    exactPortMapping:'to-confirm',
    exactCableMapping:'to-confirm',
    note:'La vue terrain confirme la baie d’entrées et les familles de brassage visibles. Elle ne permet pas d’attribuer un connecteur à une entrée numérotée de la matrice.'
  }),
  Object.freeze({
    id:'gc-physical-platinum-core',
    name:'CHASSIS 4 — Harris Platinum',
    zone:'BAIE 3 GRILLE CENTRALE / CHASSIS 4',
    role:'ROUTING_CORE',
    evidenceAssetId:'2m-field-06',
    verificationStatus:'field-photo-confirmed',
    manufacturer:'Harris Broadcast',
    family:'Platinum (legacy)',
    exactChassisSku:null,
    exactSlotPopulation:null,
    documentedMatrix:'190 × 184',
    matrixSource:'Synoptique interne 2M',
    note:'La façade PLATINUM | Harris confirme le constructeur et la famille. Le SKU du châssis, les cartes, slots et capacités physiques par carte restent à confirmer.'
  }),
  Object.freeze({
    id:'gc-physical-gr2-outputs',
    name:'BAIE GR-2 — Outputs',
    zone:'BAIE GR-2',
    role:'OUTPUT_PATCH_ZONE',
    evidenceAssetId:'2m-field-02',
    verificationStatus:'field-photo-confirmed',
    visibleLabels:Object.freeze(['S.VIDEO-SD','S.VIDEO-HD','S.AUDIO']),
    exactPortMapping:'to-confirm',
    exactCableMapping:'to-confirm',
    note:'La vue terrain confirme la baie de sorties et ses familles de brassage. Aucun numéro de sortie de matrice n’est déduit de la position physique.'
  }),
  Object.freeze({
    id:'gc-physical-gr3-control-sync',
    name:'BAIE GR-3 — Control / Sync',
    zone:'BAIE GR-3',
    role:'CONTROL_SYNC_ZONE',
    evidenceAssetId:'2m-field-07',
    verificationStatus:'field-photo-confirmed',
    observedEquipment:Object.freeze(['Tektronix ECO422D','zone CHASSIS 4 / contrôle-synchronisation']),
    documentedLogicalInterfaces:logicalControlSyncNames,
    physicalInterfaceAssignment:'to-confirm',
    exactControlProtocol:'to-confirm',
    exactControlWiring:'to-confirm',
    exactSyncWiring:'to-confirm',
    note:'La zone Control/Sync est confirmée par la photo. Les interfaces XY/ENET/SERIAL/SYNCH documentées dans le synoptique restent logiques tant qu’un connecteur ou repère de câble ne prouve pas leur affectation physique GR-3 → Platinum.'
  }),
  Object.freeze({
    id:'gc-physical-monitoring',
    name:'Monitoring',
    zone:'GRILLE CENTRALE / destinations physiques à confirmer',
    role:'MONITORING_DEPENDENCY',
    verificationStatus:'documented-internal',
    documentedInterfaces:monitoringNames,
    documentedCableRefs:monitoringCableRefs,
    physicalEndpointMapping:'to-confirm',
    note:'Le synoptique interne documente les sorties Monitoring et leurs références de câble. La destination/connectique physique terminale reste distincte de cette preuve logique.'
  })
]);

export const GRILLE_CENTRALE_PHYSICAL_LINKS = Object.freeze([
  Object.freeze({
    id:'gc-physical-link-gr1-core',
    from:'gc-physical-gr1-inputs',
    to:'gc-physical-platinum-core',
    role:'INPUT_SIDE_FLOW',
    signalFamilies:Object.freeze(['VIDEO-SD','VIDEO-HD','AUDIO','RS422']),
    verificationStatus:'physical-role-confirmed',
    exactEndpointMapping:'to-confirm',
    exactCableRefs:Object.freeze([]),
    note:'Architecture physique supportée par les vues terrain GR-1 + CHASSIS 4 ; aucun port, câble ou crosspoint précis n’est créé.'
  }),
  Object.freeze({
    id:'gc-physical-link-core-gr2',
    from:'gc-physical-platinum-core',
    to:'gc-physical-gr2-outputs',
    role:'OUTPUT_SIDE_FLOW',
    signalFamilies:Object.freeze(['VIDEO-SD','VIDEO-HD','AUDIO']),
    verificationStatus:'physical-role-confirmed',
    exactEndpointMapping:'to-confirm',
    exactCableRefs:Object.freeze([]),
    note:'Architecture physique supportée par les vues terrain CHASSIS 4 + GR-2 ; aucun numéro de sortie n’est déduit.'
  }),
  Object.freeze({
    id:'gc-physical-link-gr3-core',
    from:'gc-physical-gr3-control-sync',
    to:'gc-physical-platinum-core',
    role:'CONTROL_SYNC_DEPENDENCY',
    signalFamilies:Object.freeze(['CONTROL','SYNC']),
    verificationStatus:'to-confirm',
    exactEndpointMapping:'to-confirm',
    exactCableRefs:Object.freeze([]),
    note:'La dépendance fonctionnelle Control/Sync est documentée, mais le protocole et le câblage exacts GR-3 → Platinum doivent être confirmés sur les connecteurs/repères.'
  }),
  Object.freeze({
    id:'gc-physical-link-core-monitoring',
    from:'gc-physical-platinum-core',
    to:'gc-physical-monitoring',
    role:'MONITORING_DEPENDENCY',
    signalFamilies:Object.freeze(['MONITORING']),
    verificationStatus:'documented-logical',
    exactEndpointMapping:'to-confirm',
    exactCableRefs:monitoringCableRefs,
    note:'Les références Monitoring proviennent du synoptique interne ; elles ne prouvent pas à elles seules le connecteur physique exact sur le châssis.'
  })
]);

export const GRILLE_CENTRALE_PHYSICAL_INVARIANTS = Object.freeze({
  canonicalMatrix:'190 × 184',
  matrixAuthority:'Synoptique interne 2M',
  manufacturer:'Harris Broadcast',
  family:'Platinum (legacy)',
  manufacturerFamilyStatus:'field-photo-confirmed',
  exactChassisSku:null,
  exactSlotPopulation:null,
  exactInputPortMap:'to-confirm',
  exactOutputPortMap:'to-confirm',
  activeCrosspointsCreated:false,
  activeCrosspointsInferred:false,
  legacyPlatinumIsNotPlatinumVX:true,
  capacityNeverDerivedFromVendorExample:true,
  fieldEvidenceNeverOfficialImage:true
});

/* ────────────────────────────────────────────────────────────────────────────
 * LES 374 PORTS DOCUMENTÉS.
 *
 * Ils se construisaient à l'import du module public, à partir des deux tableaux de
 * libellés ci-dessus. Ils ne sont la projection d'AUCUNE donnée autorisée : ce sont les
 * libellés eux-mêmes qui sont la source. Ils suivent donc les libellés ici, et se
 * construisent une seule fois, au premier appel autorisé.
 * ──────────────────────────────────────────────────────────────────────────── */

export const GRILLE_CENTRALE_SYNOPTIC_ID = 'gc-synoptic-video-2012';
export const GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID = 'gc-evidence-synoptic-photo-2012';
export const GRILLE_CENTRALE_MAP_RECORD_ID = 'gc-documented-port-cable-map';
export const GRILLE_CENTRALE_ROUTER_ID = 'router-gc190x184';
export const GRILLE_CENTRALE_SOURCE_REF = 'LTS MAROC — GC 2M — DT/EH/11/2011 — 31/08/2012';
export const GRILLE_CENTRALE_PORT_ORIGIN = 'seed-grille-synoptic-phase13';
const DOCUMENTED_MAP_VERSION = 1;

const domainFor = (direction, portNumber) => GRILLE_CENTRALE_DOCUMENT_DOMAINS
  .find(domain => domain.direction === direction && portNumber >= domain.from && portNumber <= domain.to);

function makePort(direction, portNumber, label) {
  const input = direction === 'INPUT';
  const domain = domainFor(direction, portNumber);
  const id = `gc-${input ? 'in' : 'out'}-${String(portNumber).padStart(3, '0')}`;
  return Object.freeze({
    id,
    kind:'topology_router_port',
    targetType:'broadcast_topology',
    targetId:id,
    routerId:GRILLE_CENTRALE_ROUTER_ID,
    direction,
    portNumber:String(portNumber),
    logicalAlias:label,
    logicalRole:'VIDEO',
    signalType:domain?.documentSignalLabel === 'SDI' ? 'SDI' : 'AUTRE',
    documentSignalDomain:domain?.id || null,
    documentSignalLabel:domain?.documentSignalLabel || null,
    signalStandardExact:domain?.documentSignalLabel === 'SDI' ? 'document-labeled-SDI' : 'to-confirm-beyond-HD-label',
    sourceDocumentId:GRILLE_CENTRALE_SYNOPTIC_ID,
    evidenceIds:Object.freeze([GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID]),
    designMappingStatus:'2M-synoptic-confirmed',
    currentPhysicalPortVerified:false,
    currentAsBuiltVerified:false,
    physicalPortRef:null,
    origin:GRILLE_CENTRALE_PORT_ORIGIN,
    visibility:'technical',
    confidence:'high',
    verificationStatus:'documented',
    grilleCentraleDocumentedMapVersion:DOCUMENTED_MAP_VERSION
  });
}

export const GRILLE_CENTRALE_DOCUMENTED_PORTS = Object.freeze([
  ...GRILLE_CENTRALE_INPUT_LABELS.map((label, index) => makePort('INPUT', index + 1, label)),
  ...GRILLE_CENTRALE_OUTPUT_LABELS.map((label, index) => makePort('OUTPUT', index + 1, label))
]);

/**
 * La charge utile rendue par `/api/operational/grille-centrale/documented-map`.
 *
 * UNE SEULE FORME, décidée ici, pour que la question « qu'est-ce qui est opérationnel ? »
 * ait une réponse unique. Les modules d'affichage ne connaissent plus que ce contrat ; ils
 * n'ont plus aucune constante à eux, donc plus rien à laisser fuir.
 */
export function buildGrilleCentraleDataset() {
  return {
    version:DOCUMENTED_MAP_VERSION,
    routerId:GRILLE_CENTRALE_ROUTER_ID,
    synopticId:GRILLE_CENTRALE_SYNOPTIC_ID,
    synopticEvidenceId:GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID,
    mapRecordId:GRILLE_CENTRALE_MAP_RECORD_ID,
    sourceRef:GRILLE_CENTRALE_SOURCE_REF,
    portOrigin:GRILLE_CENTRALE_PORT_ORIGIN,
    aliases:GRILLE_CENTRALE_ALIASES,
    sourceDocument:GRILLE_CENTRALE_SOURCE_DOCUMENT,
    inputLabels:GRILLE_CENTRALE_INPUT_LABELS,
    outputLabels:GRILLE_CENTRALE_OUTPUT_LABELS,
    documentDomains:GRILLE_CENTRALE_DOCUMENT_DOMAINS,
    referenceInterfaces:GRILLE_CENTRALE_REFERENCE_INTERFACES,
    grObservations:GRILLE_CENTRALE_GR_OBSERVATIONS,
    monitoringPaths:GRILLE_CENTRALE_MONITORING_PATHS,
    invariants:GRILLE_CENTRALE_PHASE13_INVARIANTS,
    documentedPorts:GRILLE_CENTRALE_DOCUMENTED_PORTS,
    topologyInterfaces:GRILLE_CENTRALE_TOPOLOGY_INTERFACES,
    candidateImages:GRILLE_CENTRALE_CANDIDATE_IMAGES,
    facts:GRILLE_CENTRALE_FACTS,
    ports:GRILLE_CENTRALE_PORTS,
    vendorResearch:GRILLE_CENTRALE_VENDOR_RESEARCH,
    physicalNodes:GRILLE_CENTRALE_PHYSICAL_NODES,
    physicalLinks:GRILLE_CENTRALE_PHYSICAL_LINKS,
    physicalInvariants:GRILLE_CENTRALE_PHYSICAL_INVARIANTS,
    seedRecords:buildGrilleCentraleSeedRecords(),
    topologySeed:buildGrilleCentraleTopologySeed(),
    knowledgeSeed:buildGrilleCentraleKnowledgeSeed(),
    physicalSeed:buildGrilleCentralePhysicalSeed(),
    physicalFactTargets:GRILLE_CENTRALE_PHYSICAL_FACT_TARGETS
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * LES FICHES D'ENSEMENCEMENT, CONSTRUITES ICI ET NON DANS L'ÉCRAN.
 *
 * `grille-centrale-documented-map.js` composait ces fiches lui-même, ce qui l'obligeait à
 * porter en clair le titre du synoptique, sa référence DT/EH/11/2011, son auteur, le
 * libellé « 190 × 184 », les plages IN/OUT et les chaînes GR691→GR717→DMUX/1. Retirer les
 * tableaux sans retirer ces fiches n'aurait déplacé le problème que de quelques lignes.
 *
 * Le module d'affichage reçoit donc des fiches TOUTES FAITES et n'a plus qu'à les écrire.
 * Il n'a plus une seule valeur d'installation à connaître.
 * ──────────────────────────────────────────────────────────────────────────── */

const monitoringPatchId = path => `${path.id}-patch`;

export function buildGrilleCentraleSeedRecords() {
  const version = DOCUMENTED_MAP_VERSION;
  const commun = {
    sourceRef:GRILLE_CENTRALE_SOURCE_REF,
    verificationStatus:'documented',
    confidence:'high',
    origin:GRILLE_CENTRALE_PORT_ORIGIN,
    grilleCentraleDocumentedMapVersion:version
  };
  return {
    version,
    synoptic:{
      ...commun,
      id:GRILLE_CENTRALE_SYNOPTIC_ID, kind:'topology_synoptic', targetType:'broadcast_topology',
      targetId:GRILLE_CENTRALE_SYNOPTIC_ID, title:'SYNOPTIQUE VIDEO GRILLE CENTRALE',
      reference:GRILLE_CENTRALE_SOURCE_DOCUMENT.documentId, project:GRILLE_CENTRALE_SOURCE_DOCUMENT.project,
      documentDate:GRILLE_CENTRALE_SOURCE_DOCUMENT.documentDate, ownerLabel:GRILLE_CENTRALE_SOURCE_DOCUMENT.ownerLabel,
      author:GRILLE_CENTRALE_SOURCE_DOCUMENT.author, format:GRILLE_CENTRALE_SOURCE_DOCUMENT.format,
      matrixLabel:`${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs} × ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs}`,
      domains:GRILLE_CENTRALE_DOCUMENT_DOMAINS, sourceDocument:GRILLE_CENTRALE_SOURCE_DOCUMENT
    },
    evidence:{
      ...commun,
      id:GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID, kind:'topology_evidence', targetType:'broadcast_topology',
      targetId:GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID, sourceType:'field-photo-of-site-document',
      title:'Photos terrain du synoptique Grille Centrale 2M', evidenceStatus:'2M-synoptic-confirmed',
      proves:['IN.1–IN.190','OUT.1–OUT.184','IN/SDI 1–128','IN/HD 129–190','OUT/SDI 1–144','OUT/HD 145–184',
        'SYNCH 1–4','XY-1/XY-2','ENET-1/ENET-2','SERIAL 1/SERIAL 2','MONITORING/OUT.1–2',
        'GR691→GR717→DMUX/1','GR692→GR718→DMUX/2'],
      doesNotProve:['Platinum frame SKU','card/slot population','rear BNC connector mapping',
        'current as-built cable continuity','active crosspoints']
    },
    monitoring:GRILLE_CENTRALE_MONITORING_PATHS.map(path => ({
      patch:{
        ...commun,
        id:monitoringPatchId(path), name:`${path.grNear} ↔ ${path.grFar}`,
        panel:'GC — point de connexion/normalisation documenté', signalType:'SDI',
        cableRefs:[path.grNear, path.grFar], relationSymbol:path.relationSymbol,
        interpretationStatus:'probable-normalization', evidenceIds:[GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID]
      },
      path:{
        ...commun,
        id:path.id, sourceLabel:`Harris Platinum — ${path.output}`,
        destinationLabel:`${path.destination.rack} / ${path.destination.chassis} / ${path.destination.equipment}`,
        signalType:'SDI', pathRole:'MONITORING', cableRefs:[path.grNear, path.grFar],
        patchPointIds:[monitoringPatchId(path)], evidenceIds:[GRILLE_CENTRALE_SYNOPTIC_EVIDENCE_ID],
        designMapping:path.designMapping, currentPhysicalCableVerified:false, destination:path.destination
      }
    })),
    mapRecord:{
      ...commun,
      id:GRILLE_CENTRALE_MAP_RECORD_ID, kind:'grille_documented_port_cable_map', targetType:'router',
      routerId:GRILLE_CENTRALE_ROUTER_ID, sourceDocument:GRILLE_CENTRALE_SOURCE_DOCUMENT,
      domains:GRILLE_CENTRALE_DOCUMENT_DOMAINS, logicalPortCount:GRILLE_CENTRALE_DOCUMENTED_PORTS.length,
      inputCount:GRILLE_CENTRALE_INPUT_LABELS.length, outputCount:GRILLE_CENTRALE_OUTPUT_LABELS.length,
      monitoring:GRILLE_CENTRALE_MONITORING_PATHS, grObservations:GRILLE_CENTRALE_GR_OBSERVATIONS,
      references:GRILLE_CENTRALE_REFERENCE_INTERFACES, invariants:GRILLE_CENTRALE_PHASE13_INVARIANTS
    }
  };
}

/**
 * La fiche du routeur et ses interfaces, telles que `grille-centrale-topology.js` les
 * composait en clair dans le bundle public : capacité 190×184, implantation BAIE 3,
 * constructeur candidat, postes CTRL-STC et repères de câbles.
 */
const TOPOLOGY_VERSION = 1;
const TOPOLOGY_UPDATED_AT = '2026-08-16';
const TOPOLOGY_ORIGIN = 'seed-grille-centrale-topology';
const TOPOLOGY_SOURCE_REF = 'Synoptique 2M — BAIE 3 GRILLE CENTRALE';

export function buildGrilleCentraleTopologySeed() {
  const commun = {
    routerId:GRILLE_CENTRALE_ROUTER_ID,
    verificationStatus:'documented',
    confidence:'high',
    origin:TOPOLOGY_ORIGIN,
    sourceRef:TOPOLOGY_SOURCE_REF,
    grilleCentraleTopologyVersion:TOPOLOGY_VERSION,
    grilleCentraleTopologyUpdatedAt:TOPOLOGY_UPDATED_AT
  };
  const { routerId:_sansRouterId, ...communRouteur } = commun;
  return {
    version:TOPOLOGY_VERSION,
    router:{
      ...communRouteur,
      id:GRILLE_CENTRALE_ROUTER_ID,
      name:'GRILLE CENTRALE',
      routerKey:'grille-centrale-190x184',
      inputCapacity:GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs,
      outputCapacity:GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs,
      matrixLabel:'190 × 184 — synoptique interne 2M',
      manufacturer:'Harris Broadcast — candidat historique',
      model:'Platinum — famille candidate, châssis exact à confirmer',
      location:'BAIE 3 GRILLE CENTRALE',
      signalDomains:['SDI','REF_BB','AUDIO','ETHERNET','SERIAL'],
      distinctFrom:['GRILLE72 72×72 / Imagine Platinum VX'],
      note:'La capacité 190×184 vient du synoptique interne. La preuve projet externe 2012 cite HARRIS 190×190. Aucun crosspoint actif n’est créé ou déduit par ce seed.'
    },
    interfaces:GRILLE_CENTRALE_TOPOLOGY_INTERFACES.map(item => ({ ...item, ...commun }))
  };
}

/**
 * L'enrichissement du catalogue Grille Centrale.
 *
 * `grille-centrale-knowledge.js` composait cet objet en clair : matrice documentée,
 * constructeur candidat, écart 190×184 / 190×190, faits d'implantation et ports de
 * référence avec leurs repères GR. Il suit ici la donnée dont il est fait.
 */
const KNOWLEDGE_VERSION = 2;
const KNOWLEDGE_REVIEWED_AT = '2026-08-16';
export const GRILLE_CENTRALE_CATALOG_ID = 'kb-grille-centrale-190x184';
const KNOWLEDGE_EVIDENCE_IMAGES = Object.freeze([
  '13e8234a-5a25-4c4a-87c8-0988ca5cae57.png',
  '033683b8-b181-4058-8215-70d26e655438.png',
  '8417a9d0-050b-40aa-ae83-26b3207274f4.png'
]);

/* ────────────────────────────────────────────────────────────────────────────
 * LA FICHE CATALOGUE ET LES PREUVES PROJET (#142).
 *
 * #137 a sorti les tableaux des modules `grille-centrale-*`. Mais `equipment-catalog-extra-seed.js`
 * et `equipment-knowledge-packs.js` — servis à la racine, eux aussi — décrivaient encore
 * l'installation en toutes lettres : la capacité de la matrice, l'implantation en baie, les
 * plages IN/OUT non documentées, les interfaces de synchronisation et de contrôle, la zone.
 * Mesuré sur 864e502, sans compte ni cookie :
 *
 *     curl -s http://…/equipment-knowledge-packs.js | grep -o 'BAIE 3 GRILLE CENTRALE'
 *
 * Retirer les tableaux sans retirer ces deux fiches n'aurait fermé qu'une porte sur trois.
 *
 * TOUT EST DÉRIVÉ, RIEN N'EST RECOPIÉ. Ces valeurs se calculent à partir des constantes
 * ci-dessus : une seule autorité pour la capacité, l'implantation et les interfaces. Une
 * correction sur le plan se propage, elle ne laisse pas une copie périmée derrière elle.
 * ──────────────────────────────────────────────────────────────────────────── */

const factValue = id => GRILLE_CENTRALE_FACTS.find(item => item.id === id)?.value || '';

/** Les plages que le plan ne montre pas : opérationnelles, donc jamais publiques. */
export const GRILLE_CENTRALE_UNDOCUMENTED_PORT_RANGES = Object.freeze(['IN.64–181', 'OUT.64–93', 'OUT.145–182']);
/** La zone d'inventaire de l'appareil. */
export const GRILLE_CENTRALE_INVENTORY_ZONE = 'STC';

const CATALOG_EVIDENCE_SOURCE = 'Dataset Master v5';
const CATALOG_LOCATION = factValue('gc-location');
const CATALOG_PLAN_SOURCE = `Plan ${CATALOG_LOCATION} — ${CATALOG_EVIDENCE_SOURCE}`;
const CATALOG_MATRIX_LABEL = `${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs} entrées SDI × ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs} sorties SDI`;
const CATALOG_UNDOCUMENTED_RANGES = GRILLE_CENTRALE_UNDOCUMENTED_PORT_RANGES.join(', ');
// Les interfaces se listent depuis le plan lui-même plutôt que d'être réécrites à la main.
const CATALOG_INTERFACES_LABEL = [
  ...GRILLE_CENTRALE_REFERENCE_INTERFACES.map(item => item.name),
  ...GRILLE_CENTRALE_MONITORING_PATHS.map(path => path.output)
].join(' · ');

/**
 * Les champs de la fiche catalogue que le seed public ne porte plus.
 *
 * Ils sont fusionnés sur la fiche APRÈS que l'endpoint protégé a répondu. Un client anonyme
 * garde la fiche générique — un routeur matriciel SDI, constructeur à identifier — et rien
 * de ce qui décrirait l'installation.
 */
export function buildGrilleCentraleCatalogSeed() {
  return {
    model:`Grille Centrale ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs}×${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs} — équipement documenté`,
    summary:`Grille matricielle distincte documentée avec ${CATALOG_MATRIX_LABEL} dans la ${CATALOG_LOCATION}. Le constructeur et le châssis doivent encore être relevés.`,
    portsNote:`Ne créer que les ports visibles dans le plan. ${CATALOG_UNDOCUMENTED_RANGES} restent non documentés. Aucun crosspoint actif ne doit être déduit.`,
    sourceNote:`${CATALOG_EVIDENCE_SOURCE} / plan ${CATALOG_LOCATION}. ${factValue('gc-not-grille72')}`,
    sourceOrigin:'plan',
    inventoryEvidence:{ zones:GRILLE_CENTRALE_INVENTORY_ZONE, knownUnits:1, pairs:0 }
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * LES PREUVES TERRAIN PROPRES À LA GRILLE (#142, second tour).
 *
 * `equipment-field-evidence.js` est servi à la racine, et n'était atteint par AUCUNE garde :
 * la marche du graphe public ignorait `import './x.js'`, or ce module n'est atteint que par
 * cette forme-là. Il y décrivait, en clair et sans authentification :
 *
 *     inventoryAliases:['…','GRILLE CENTRALE 190x184','Grille Centrale 190×184']
 *     evidence(…, 'BAIE GR-1 — patch E.VIDEO-SD / … / RS422 …', 'BAIE GR-1', …)
 *     evidence(…, 'CHASSIS 4 — façade portant PLATINUM | Harris', 'BAIE 3 GRILLE CENTRALE', …)
 *
 * soit la capacité de la matrice, l'implantation de ses baies d'entrée, de sortie et de
 * contrôle, et le contenu de ses panneaux de brassage.
 *
 * Ces fiches ne sont donc plus publiques : elles arrivent par la porte de #137, comme le
 * reste. Le SOUS-SYSTÈME de preuves terrain, lui, n'est pas touché ici — le pack binaire
 * statique et les preuves des autres zones relèvent de #78, qui est le lot suivant.
 * ──────────────────────────────────────────────────────────────────────────── */

const FIELD_EVIDENCE_OBSERVED_AT = '2026-08-16';

const fieldEvidence = (assetId, caption, zone, note = '', requiresFieldConfirmation = false) => ({
  assetId,
  caption,
  zone,
  sourceType:'2m-field-photo',
  verificationStatus:'field-observed',
  observedAt:FIELD_EVIDENCE_OBSERVED_AT,
  requiresFieldConfirmation,
  note
});

/**
 * La CONFIRMATION PAR PHOTO TERRAIN du constructeur et de la famille de la matrice.
 *
 * `field-evidence-integration.js` portait cette charge en clair et l'écrivait sur la fiche
 * ET sur le routeur SANS vérifier l'autorisation : il appelait bien `ensureGrilleCentraleKnowledge()`,
 * qui se tait sans habilitation, puis écrivait quand même ses propres constantes. Un client
 * anonyme obtenait donc « CHASSIS 4 », « façade PLATINUM | Harris » et l'implantation du
 * châssis. La charge vient maintenant du jeu de données autorisé ; sans lui, rien n'est écrit.
 */
export function buildGrilleCentraleFieldPhotoConfirmation() {
  const assetId = '2m-field-06';
  return {
    assetId,
    observedAt:FIELD_EVIDENCE_OBSERVED_AT,
    catalogFacts:[
      {
        id:'gc-harris-evidence',
        label:'Constructeur',
        value:'Harris Broadcast — confirmé par photo terrain 2M',
        source:'Photo terrain 2M — CHASSIS 4',
        verificationStatus:'field-photo-confirmed',
        confidence:'high'
      },
      {
        id:'gc-platinum-hypothesis',
        label:'Famille matérielle',
        value:'Harris Platinum — famille confirmée terrain ; châssis exact à confirmer',
        source:'Photo terrain 2M — façade PLATINUM | Harris',
        verificationStatus:'field-photo-confirmed',
        confidence:'high'
      }
    ],
    catalogFields:{
      manufacturer:'Harris Broadcast',
      manufacturerCandidate:'Harris Broadcast',
      manufacturerCandidateStatus:'field-photo-confirmed',
      hardwareFamilyCandidate:'Harris Platinum (legacy)',
      hardwareFamilyCandidateStatus:'field-photo-confirmed',
      fieldHardwareConfirmation:{
        assetId,
        observedAt:FIELD_EVIDENCE_OBSERVED_AT,
        manufacturer:'Harris Broadcast',
        family:'Harris Platinum',
        exactChassisConfirmed:false,
        note:'La façade porte clairement PLATINUM | Harris. Le SKU/châssis exact reste illisible et n’est pas déduit.'
      },
      imageResearchReason:'Harris Platinum est confirmé par la photo terrain 2M, mais le châssis/SKU exact reste illisible. Le visuel PT-FR-15 externe reste un candidat de famille, pas une identification de l’instance.'
    },
    routerFields:{
      manufacturer:'Harris Broadcast — confirmé terrain',
      model:'Platinum — famille confirmée terrain, châssis exact à confirmer',
      verificationStatus:'documented-field-confirmed'
    },
    routerNote:'Photo terrain 2M : la façade PLATINUM | Harris confirme le constructeur et la famille ; aucun SKU de châssis, port non documenté ou crosspoint actif n’est déduit.'
  };
}

/**
 * Les correctifs de fiche catalogue portant une preuve terrain PROPRE À LA GRILLE.
 *
 * Indexés par identifiant de catalogue : `grille-centrale-knowledge.js` les applique après
 * réponse de l'endpoint protégé, exactement comme `relatedCatalogEvidence`. Une fiche non
 * hydratée garde sa connaissance constructeur générique et aucune implantation.
 */
export function buildGrilleCentraleFieldEvidencePatches() {
  return {
    [GRILLE_CENTRALE_CATALOG_ID]:{
      inventoryAliases:[
        'GRILLE CENTRALE',
        'Grille Centrale',
        `GRILLE CENTRALE ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs}x${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs}`,
        `Grille Centrale ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs}×${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs}`
      ],
      fieldEvidenceImages:[
        fieldEvidence('2m-field-01','BAIE GR-1 — patch E.VIDEO-SD / E.VIDEO-HD / E.AUDIO / RS422 et équipements associés.','BAIE GR-1','Preuve de l’environnement physique de la Grille Centrale ; ne représente pas à elle seule le châssis matriciel.'),
        fieldEvidence('2m-field-02','BAIE GR-2 — patch S.VIDEO-SD / S.VIDEO-HD / S.AUDIO.','BAIE GR-2','Panneaux de sorties et brassage observés sur site.'),
        fieldEvidence('2m-field-03','Détail brassage/synchronisation LTS Maroc — repères SYNCH visibles.','GRILLE CENTRALE','Preuve terrain de la zone de synchronisation et de brassage.'),
        fieldEvidence('2m-field-06','CHASSIS 4 — façade portant clairement PLATINUM | Harris.','BAIE 3 GRILLE CENTRALE','Confirme physiquement le constructeur Harris et la famille Platinum. Le SKU exact du châssis reste illisible et à confirmer.',true),
        fieldEvidence('2m-field-07','BAIE GR-3 — équipements de contrôle/synchronisation et zone CHASSIS 4.','BAIE GR-3','Vue d’ensemble de la baie de contrôle de la Grille Centrale.')
      ]
    },
    'kb-sonifex-rb-ds2':{
      fieldEvidenceImages:[fieldEvidence('2m-field-01','Deux unités Sonifex RB-DS2 observées dans BAIE GR-1.','BAIE GR-1','Référence RB-DS2 lisible en façade.')]
    },
    'kb-harris-6800plus':{
      fieldEvidenceImages:[
        fieldEvidence('2m-field-04','Plusieurs châssis Harris 6800+ observés ; marquage FR6822+ partiellement lisible.','GRILLE CENTRALE','Famille confirmée ; configuration exacte de chaque châssis à confirmer.',true),
        fieldEvidence('2m-field-06','Châssis Harris 6800+ au-dessus du châssis Platinum.','CHASSIS 4','Contexte de baie ; ne pas confondre avec la matrice Platinum.',true)
      ]
    },
    'kb-sam-iq-modular':{
      fieldEvidenceImages:[
        fieldEvidence('2m-field-04','Châssis IQ Modular Infrastructure visible sous les Harris 6800+.','GRILLE CENTRALE','Famille IQ observée ; modules internes non déduits.',true),
        fieldEvidence('2m-field-05','Châssis IQ Modular Infrastructure sous CHASSIS 1.','CHASSIS 1','Famille observée ; configuration exacte des cartes à confirmer.',true)
      ]
    },
    'kb-harris-integrator':{
      fieldEvidenceImages:[fieldEvidence('2m-field-05','Grand châssis Harris INTEGRATOR observé sous CHASSIS 1.','CHASSIS 1','Famille/produit lisible ; référence matérielle exacte à confirmer.',true)]
    },
    'kb-tektronix-eco422d':{
      fieldEvidenceImages:[fieldEvidence('2m-field-07','Tektronix ECO 422D SD/HD Changeover Unit observé dans BAIE GR-3.','BAIE GR-3','Référence lisible en façade.')]
    },
    'kb-harris-neo-dvr':{
      fieldEvidenceImages:[fieldEvidence('2m-field-15','Deux unités Harris NEO avec étiquettes NEO VR DIGITAL VIDEO RECORDER / NEO 1RU FRAME.','BAIE 3 - R200','Famille et fonction observées ; SKU exact non lisible.',true)]
    }
  };
}

/** Les preuves projet de la fiche 360 — l'équivalent autorisé de l'ancien `projectEvidence` public. */
export function buildGrilleCentraleProjectEvidence() {
  const commun = {
    scope:'project',
    sourceType:'plan',
    verificationStatus:'documented',
    confidence:'high',
    sourceUrl:'',
    verifiedAt:KNOWLEDGE_REVIEWED_AT
  };
  return [
    { ...commun, label:'Matrice documentée', value:CATALOG_MATRIX_LABEL, sourceLabel:CATALOG_PLAN_SOURCE },
    { ...commun, label:'Localisation', value:CATALOG_LOCATION, sourceLabel:CATALOG_EVIDENCE_SOURCE },
    { ...commun, label:'Interfaces documentées', value:CATALOG_INTERFACES_LABEL, sourceLabel:CATALOG_EVIDENCE_SOURCE },
    { ...commun, label:'Séparation architecturale', value:factValue('gc-not-grille72'), sourceLabel:CATALOG_EVIDENCE_SOURCE }
  ];
}

/**
 * Les preuves d'IMPLANTATION portées par d'autres fiches catalogue.
 *
 * `kb-imagine-platinum-vx` affichait « GRILLE72 72×72 SDI — distincte de la Grille Centrale
 * 190×184 » sous le libellé « Implantation documentée », sourcé Dataset Master, dans un
 * module public. C'est la capacité de deux routeurs réels de l'installation : même nature
 * que le reste, donc même porte. Les faits CONSTRUCTEUR de cette fiche, eux, restent
 * publics — ils viennent de la documentation Imagine, pas du site.
 */
export const GRILLE_CENTRALE_RELATED_CATALOG_ID = 'kb-imagine-platinum-vx';

export function buildGrilleCentraleRelatedCatalogEvidence() {
  return {
    [GRILLE_CENTRALE_RELATED_CATALOG_ID]:[{
      label:'Implantation documentée',
      value:`GRILLE72 72×72 SDI — distincte de la Grille Centrale ${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalInputs}×${GRILLE_CENTRALE_PHASE13_INVARIANTS.logicalOutputs}`,
      scope:'project',
      sourceType:'plan',
      sourceLabel:CATALOG_EVIDENCE_SOURCE,
      sourceUrl:'',
      verificationStatus:'documented',
      confidence:'high',
      verifiedAt:KNOWLEDGE_REVIEWED_AT
    }]
  };
}

/** La liste d'identification : sa dernière ligne nomme les plages non documentées. */
export function buildGrilleCentraleIdentificationChecklist() {
  return [
    'Constructeur et référence du châssis',
    'Cartes / crosspoints installés',
    'Versions contrôleurs XY/ENET',
    `Ports ${CATALOG_UNDOCUMENTED_RANGES} non visibles dans les documents`
  ];
}

export function buildGrilleCentraleKnowledgeSeed() {
  return {
    version:KNOWLEDGE_VERSION,
    reviewedAt:KNOWLEDGE_REVIEWED_AT,
    catalogId:GRILLE_CENTRALE_CATALOG_ID,
    aliases:GRILLE_CENTRALE_ALIASES,
    facts:GRILLE_CENTRALE_FACTS,
    ports:GRILLE_CENTRALE_PORTS,
    candidateImages:GRILLE_CENTRALE_CANDIDATE_IMAGES,
    evidenceImageRefs:KNOWLEDGE_EVIDENCE_IMAGES,
    catalogSeed:buildGrilleCentraleCatalogSeed(),
    projectEvidence:buildGrilleCentraleProjectEvidence(),
    identificationChecklist:buildGrilleCentraleIdentificationChecklist(),
    relatedCatalogEvidence:buildGrilleCentraleRelatedCatalogEvidence(),
    fieldEvidencePatches:buildGrilleCentraleFieldEvidencePatches(),
    fieldPhotoConfirmation:buildGrilleCentraleFieldPhotoConfirmation(),
    catalogFields:{
      manufacturerCandidate:'Harris Broadcast',
      manufacturerCandidateStatus:'external-project-evidence',
      hardwareFamilyCandidate:'Harris Platinum (legacy) — à confirmer',
      hardwareFamilyCandidateStatus:'capacity-compatible-hypothesis',
      documentedMatrix:'190 x 184',
      signalDomain:'SDI / vidéo broadcast',
      externalProjectEvidence:{
        title:'GRILLE CENTRALE de 2M',
        date:'2012-09',
        claim:'Mise en place de la grille centrale 190x190 (HARRIS) de SOREAD 2M.',
        url:'https://ch.linkedin.com/in/s%C3%A9bastien-tardy-402a0b22/en',
        status:'external-project-evidence'
      },
      matrixDiscrepancyNote:'Synoptique interne 2M : 190x184. Référence projet externe : 190x190 HARRIS. Châssis exact à confirmer sur photo/étiquette.',
      imageResearchReason:'Les synoptiques réels 2M sont documentés et un châssis Harris Platinum PT-FR-15 est disponible comme référence visuelle candidate, mais aucune photo physique confirmée du châssis 2M / référence exacte n’est encore récupérée. Ne pas promouvoir le candidat comme photo constructeur de la Grille Centrale.'
    }
  };
}

/**
 * L'architecture physique — baies GR-1/GR-2/GR-3, étiquettes lisibles en façade, liens
 * observés et recherche constructeur. `grille-centrale-physical-architecture.js` composait
 * cette fiche en clair.
 */
const PHYSICAL_VERSION = 1;
export const GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID = 'gc-physical-architecture';

export function buildGrilleCentralePhysicalSeed() {
  return {
    version:PHYSICAL_VERSION,
    nodes:GRILLE_CENTRALE_PHYSICAL_NODES,
    links:GRILLE_CENTRALE_PHYSICAL_LINKS,
    record:{
      id:GRILLE_CENTRALE_PHYSICAL_ARCHITECTURE_ID,
      kind:'grille_physical_architecture',
      targetType:'router',
      routerId:GRILLE_CENTRALE_ROUTER_ID,
      catalogId:GRILLE_CENTRALE_CATALOG_ID,
      name:'Grille Centrale — architecture physique 2M',
      primaryFlow:['gc-physical-gr1-inputs','gc-physical-platinum-core','gc-physical-gr2-outputs'],
      sideDependencies:['gc-physical-gr3-control-sync','gc-physical-monitoring'],
      nodes:GRILLE_CENTRALE_PHYSICAL_NODES,
      links:GRILLE_CENTRALE_PHYSICAL_LINKS,
      invariants:GRILLE_CENTRALE_PHYSICAL_INVARIANTS,
      vendorResearch:GRILLE_CENTRALE_VENDOR_RESEARCH,
      evidencePolicy:'terrain-separate-from-official-and-instance-images',
      reviewedAt:KNOWLEDGE_REVIEWED_AT,
      origin:'seed-grille-physical-architecture',
      version:PHYSICAL_VERSION
    }
  };
}

/**
 * Les points de vérification portant sur le matériel physique lui-même : châssis, baies de
 * brassage GR-1/GR-2/GR-3 et raccordement contrôle/synchro. Ils nomment l'installation, ils
 * suivent donc le reste.
 */
export const GRILLE_CENTRALE_PHYSICAL_FACT_TARGETS = Object.freeze([
  Object.freeze({ id:'gc-field-core-chassis-sku', category:'CORE_IDENTITY', label:'CHASSIS 4 Harris Platinum · SKU exact', sourceRecordId:'gc-physical-platinum-core', expectedEvidence:Object.freeze(['étiquette constructeur / rear label lisible']), documentaryStatus:'family-field-photo-confirmed', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-core-slot-population', category:'CORE_SLOT_POPULATION', label:'CHASSIS 4 Harris Platinum · cartes / slots installés', sourceRecordId:'gc-physical-platinum-core', expectedEvidence:Object.freeze(['photos avant/arrière des slots', 'références cartes lisibles']), documentaryStatus:'family-field-photo-confirmed', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-gr1-port-map', category:'PATCH_PANEL_MAPPING', label:'BAIE GR-1 · mapping physique exact des entrées', sourceRecordId:'gc-physical-gr1-inputs', expectedEvidence:Object.freeze(['repères panneau', 'positions/connecteurs', 'correspondance IN.x démontrée']), documentaryStatus:'patch-zone-field-photo-confirmed', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-gr2-port-map', category:'PATCH_PANEL_MAPPING', label:'BAIE GR-2 · mapping physique exact des sorties', sourceRecordId:'gc-physical-gr2-outputs', expectedEvidence:Object.freeze(['repères panneau', 'positions/connecteurs', 'correspondance OUT.x démontrée']), documentaryStatus:'patch-zone-field-photo-confirmed', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-gr3-assignment', category:'CONTROL_SYNC_MAPPING', label:'BAIE GR-3 · affectation physique XY / ENET / SERIAL / SYNCH', sourceRecordId:'gc-physical-gr3-control-sync', expectedEvidence:Object.freeze(['connecteurs et labels visibles', 'repères câble', 'destination Platinum prouvée']), documentaryStatus:'control-sync-zone-field-photo-confirmed', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-gr3-protocol-wiring', category:'CONTROL_SYNC_MAPPING', label:'BAIE GR-3 · protocoles et câblage exacts de contrôle/synchro', sourceRecordId:'gc-physical-link-gr3-core', expectedEvidence:Object.freeze(['type connecteur', 'pinout/protocole si documenté', 'repères câble terrain']), documentaryStatus:'functional-dependency-documented', asBuiltStatus:'to-confirm' }),
  Object.freeze({ id:'gc-field-monitoring-endpoints', category:'MONITORING_CURRENT_PATH', label:'Monitoring · connecteurs physiques terminaux actuels', sourceRecordId:'gc-physical-monitoring', expectedEvidence:Object.freeze(['connecteur physique terminal', 'équipement/châssis/slot exact', 'repère câble actuel']), documentaryStatus:'monitoring-logical-documented', asBuiltStatus:'to-confirm' })
]);

/* ────────────────────────────────────────────────────────────────────────────
 * LA FICHE OPÉRATIONNELLE CANONIQUE DE LA GRILLE CENTRALE (#166).
 *
 * CE QUI MANQUAIT, ET POURQUOI TOUT ÉTAIT FERMÉ
 * ----------------------------------------------
 * `canReadGrilleCentraleDataset` ne s'autorise pas elle-même : elle résout l'ÉQUIPEMENT de
 * la Grille dans les fiches centrales, puis pose au moteur d'accès la question ordinaire.
 * Or aucun producteur ne créait cet équipement. Mesuré sur `cd541efc`, base neuve, après
 * convergence complète :
 *
 *     51 fiches `equipments`, toutes Régie Car ; aucune ne porte `kb-grille-centrale-190x184`,
 *     aucune ne s'appelle « Grille centrale ».
 *     GET /api/operational/grille-centrale/documented-map, session ADMINISTRATEUR
 *       → 403 GRILLE_SCOPE_FORBIDDEN   (`reason: not-found`)
 *
 * Le refus était donc CORRECT — un périmètre inconnu ferme — mais il fermait pour tout le
 * monde, et les quatre panneaux de la fiche 360 n'étaient pas exécutables.
 *
 * CE QUI EST ÉCRIT ICI, ET CE QUI NE L'EST PAS
 * ---------------------------------------------
 * Rien n'est inventé pour faire passer une épreuve. Chaque champ vient d'une provenance
 * déjà présente dans CE fichier, et ce qui n'est pas prouvé reste marqué non prouvé :
 *
 *   · nom            ← `GRILLE_CENTRALE_ALIASES` — les libellés sous lesquels l'inventaire
 *                      2M saisit l'appareil ;
 *   · implantation   ← fait `gc-location` (« documented », Synoptique 2M) et zone de la
 *                      preuve terrain `2m-field-06` ;
 *   · salle          ← `GRILLE_CENTRALE_INVENTORY_ZONE` — la zone d'inventaire de CETTE
 *                      unité (`knownUnits: 1`), que `inventory-master.js` reconnaît déjà
 *                      comme une salle (`ROOM_NAMES_BY_SHEET`) ;
 *   · constructeur   ← `gc-physical-platinum-core` — façade « PLATINUM | Harris » lue sur
 *                      la photo terrain, `field-photo-confirmed` ;
 *   · famille        ← idem, « Platinum (legacy) » ;
 *   · catalogue      ← `GRILLE_CENTRALE_CATALOG_ID`, le lien canonique.
 *
 * NE SONT PAS ÉCRITS, PARCE QU'AUCUNE PREUVE NE LES PORTE : le SKU du châssis
 * (`exactChassisSku: null`), la population de cartes/slots, le numéro de série, la position
 * en U dans la baie. Ils restent « à confirmer », comme le reste du dossier le dit déjà.
 *
 * LE SEUL LIEN DÉRIVÉ EST MARQUÉ COMME TEL
 * -----------------------------------------
 * Le synoptique nomme la baie ; l'inventaire nomme la zone. Aucune ligne ne dit
 * littéralement « BAIE 3 est dans STC ». Ce rattachement est donc porté par la baie sous
 * `containmentStatus: 'derived-from-inventory-zone'` : il est explicite, relisible, et
 * corrigible sans toucher au code.
 * ──────────────────────────────────────────────────────────────────────────── */

export const GRILLE_CENTRALE_ROOM_ID = 'room-stc';
export const GRILLE_CENTRALE_BAIE_ID = 'baie-stc-grille-centrale';
export const GRILLE_CENTRALE_EQUIPMENT_ID = 'equipment-gc190x184';
export const GRILLE_CENTRALE_OPERATIONAL_ORIGIN = 'seed-grille-centrale-operational';
export const GRILLE_CENTRALE_OPERATIONAL_VERSION = 1;

/** L'identité stable de l'appareil, indépendante de tout identifiant de base. */
export const GRILLE_CENTRALE_IDENTITY_KEY = 'canonical-equipment:grille-centrale-190x184';

const physicalNode = id => GRILLE_CENTRALE_PHYSICAL_NODES.find(item => item.id === id) || {};

/**
 * La salle, la baie et l'équipement canoniques de la Grille Centrale.
 *
 * Cette fonction ne persiste rien : elle COMPOSE. C'est le bootstrap serveur
 * (`scripts/grille-centrale-operational-bootstrap.js`) qui décide d'écrire, et lui seul.
 */
export function buildGrilleCentraleOperationalSeed() {
  const core = physicalNode('gc-physical-platinum-core');
  const implantation = factValue('gc-location');
  const provenance = Object.freeze({
    sourceDocument:GRILLE_CENTRALE_SOURCE_DOCUMENT.documentId,
    sourceRef:GRILLE_CENTRALE_SOURCE_REF,
    inventoryZone:GRILLE_CENTRALE_INVENTORY_ZONE,
    fieldEvidenceRefs:Object.freeze([core.evidenceAssetId].filter(Boolean)),
    observedAt:FIELD_EVIDENCE_OBSERVED_AT,
    documented:Object.freeze(['nom', 'implantation', 'zone d’inventaire', 'constructeur', 'famille', 'matrice documentée']),
    toConfirm:Object.freeze(['SKU châssis', 'population cartes/slots', 'numéro de série', 'position U en baie'])
  });

  return Object.freeze({
    version:GRILLE_CENTRALE_OPERATIONAL_VERSION,
    room:Object.freeze({
      id:GRILLE_CENTRALE_ROOM_ID,
      name:GRILLE_CENTRALE_INVENTORY_ZONE,
      nom:GRILLE_CENTRALE_INVENTORY_ZONE,
      description:'Zone d’inventaire 2M portant la Grille Centrale documentée.',
      source:`Inventaire 2M — zone ${GRILLE_CENTRALE_INVENTORY_ZONE}`,
      verificationStatus:'documented',
      sourceLayer:'documented-inventory',
      origin:GRILLE_CENTRALE_OPERATIONAL_ORIGIN,
      grilleCentraleOperationalVersion:GRILLE_CENTRALE_OPERATIONAL_VERSION
    }),
    baie:Object.freeze({
      id:GRILLE_CENTRALE_BAIE_ID,
      name:implantation,
      nom:implantation,
      roomId:GRILLE_CENTRALE_ROOM_ID,
      source:GRILLE_CENTRALE_SOURCE_REF,
      verificationStatus:'documented',
      sourceLayer:'documented-synoptic',
      // Le synoptique nomme la baie, l'inventaire nomme la zone : le rattachement des deux
      // est dérivé, et le dit.
      containmentStatus:'derived-from-inventory-zone',
      fieldEvidenceRefs:provenance.fieldEvidenceRefs,
      origin:GRILLE_CENTRALE_OPERATIONAL_ORIGIN,
      grilleCentraleOperationalVersion:GRILLE_CENTRALE_OPERATIONAL_VERSION
    }),
    equipment:Object.freeze({
      id:GRILLE_CENTRALE_EQUIPMENT_ID,
      name:GRILLE_CENTRALE_ALIASES[0],
      nom:GRILLE_CENTRALE_ALIASES[0],
      roomId:GRILLE_CENTRALE_ROOM_ID,
      baieId:GRILLE_CENTRALE_BAIE_ID,
      catalogId:GRILLE_CENTRALE_CATALOG_ID,
      type:'Routeur / grille matricielle SDI',
      marque:core.manufacturer || '',
      // La façade prouve le constructeur et la famille ; le SKU du châssis reste illisible.
      modele:`${core.family || ''} — SKU châssis à confirmer`.trim(),
      status:'À vérifier',
      statut:'À vérifier',
      verificationStatus:'verified-family',
      confidence:'medium',
      evidenceStatus:'field-photo-confirmed-family',
      exactModelConfirmed:false,
      sourceLayer:'documented-synoptic+field-photo',
      fieldIdentityKey:GRILLE_CENTRALE_IDENTITY_KEY,
      fieldEvidenceRefs:provenance.fieldEvidenceRefs,
      inventoryZone:GRILLE_CENTRALE_INVENTORY_ZONE,
      routerId:GRILLE_CENTRALE_ROUTER_ID,
      sourceRef:GRILLE_CENTRALE_SOURCE_REF,
      grilleCentraleProvenance:provenance,
      origin:GRILLE_CENTRALE_OPERATIONAL_ORIGIN,
      grilleCentraleOperationalVersion:GRILLE_CENTRALE_OPERATIONAL_VERSION
    })
  });
}
