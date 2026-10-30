const TEXT_LIMIT = 2000;
const FACT_LIMIT = 80;

export const KNOWLEDGE_STATUSES = Object.freeze(['verified', 'documented', 'observed', 'to-confirm']);
export const KNOWLEDGE_SOURCE_TYPES = Object.freeze([
  'nameplate', 'interface', 'plan', 'inventory', 'manufacturer-doc', 'operator', 'maintenance-report', 'other'
]);

const BASE_FIELDS = Object.freeze([
  { key:'rackPosition', label:'Position exacte dans la baie', group:'Implantation', placeholder:'Ex. U18–U19 / repère du plan' },
  { key:'operationalFunction', label:'Fonction opérationnelle réelle', group:'Implantation', placeholder:'Rôle de cette instance dans la chaîne' },
  { key:'criticality', label:'Criticité / service affecté', group:'Exploitation', type:'select', options:['Faible','Normale','Haute','Critique antenne'] },
  { key:'powerFeeds', label:'Alimentation / départs électriques', group:'Énergie', placeholder:'Ex. PDU-A + PDU-B / onduleur' },
  { key:'firmwareVersion', label:'Firmware / version logicielle', group:'Versions' },
  { key:'managementInterface', label:'Interface de gestion', group:'Réseau & contrôle', placeholder:'Nom DNS/IP de gestion — jamais de mot de passe' },
  { key:'supportReference', label:'Contrat / référence support', group:'Maintenance', placeholder:'Référence non secrète uniquement' },
  { key:'lastPreventiveMaintenance', label:'Dernière maintenance préventive', group:'Maintenance', type:'date' }
]);

const PROFILE_FIELDS = Object.freeze({
  generic: [],
  'router-matrix': [
    { key:'chassisVariant', label:'Variante / taille du châssis', group:'Matrice' },
    { key:'installedMatrix', label:'Capacité installée IN × OUT', group:'Matrice', placeholder:'Ex. 72 × 72' },
    { key:'signalDomains', label:'Formats réellement exploités', group:'Signaux', placeholder:'Ex. 3G-SDI, HD-SDI, AES' },
    { key:'installedIoCards', label:'Cartes E/S installées', group:'Composition', type:'textarea' },
    { key:'controlSystem', label:'Système / panneaux de contrôle', group:'Réseau & contrôle' },
    { key:'syncReferences', label:'Références Sync / Genlock', group:'Synchronisation', type:'textarea' },
    { key:'monitoringOutputs', label:'Sorties de monitoring', group:'Monitoring', type:'textarea' },
    { key:'routeDatabaseBackup', label:'Sauvegarde de configuration', group:'Maintenance', placeholder:'Date ou référence de sauvegarde — sans secret' }
  ],
  'modular-frame': [
    { key:'installedSlotCount', label:'Nombre de slots occupés', group:'Composition' },
    { key:'installedCards', label:'Cartes et slots installés', group:'Composition', type:'textarea' },
    { key:'rearModules', label:'Rear modules / connectique arrière', group:'Composition', type:'textarea' },
    { key:'frameController', label:'Contrôleur de châssis', group:'Réseau & contrôle' },
    { key:'referenceInputs', label:'Entrées de référence utilisées', group:'Synchronisation' },
    { key:'dashboardVersion', label:'Version DashBoard / outil de gestion', group:'Versions' },
    { key:'airflowState', label:'Ventilation / filtres / sens d’air', group:'Maintenance' }
  ],
  'broadcast-processor': [
    { key:'rearModule', label:'Rear module exact', group:'Composition' },
    { key:'inputMapping', label:'Entrées / sources raccordées', group:'Signaux', type:'textarea' },
    { key:'outputMapping', label:'Sorties / destinations raccordées', group:'Signaux', type:'textarea' },
    { key:'activeFormats', label:'Formats actifs', group:'Signaux' },
    { key:'referenceSource', label:'Source de référence active', group:'Synchronisation' },
    { key:'failoverPolicy', label:'Basculement / bypass configuré', group:'Exploitation', type:'textarea' },
    { key:'audioMapping', label:'Mapping audio actif', group:'Audio', type:'textarea' }
  ],
  'sync-generator': [
    { key:'lockSource', label:'Source de verrouillage active', group:'Synchronisation' },
    { key:'referenceOutputs', label:'Sorties de référence utilisées', group:'Synchronisation', type:'textarea' },
    { key:'timeSources', label:'Sources temps / PTP / GPS / LTC', group:'Synchronisation' },
    { key:'holdoverState', label:'État holdover / Stay-in-Sync', group:'Exploitation' },
    { key:'redundancyState', label:'État redondance alimentation/source', group:'Énergie' }
  ],
  'waveform-monitor': [
    { key:'licensedOptions', label:'Options / licences installées', group:'Configuration', type:'textarea' },
    { key:'monitoredInputs', label:'Entrées surveillées', group:'Signaux', type:'textarea' },
    { key:'externalDisplay', label:'Sortie / écran externe', group:'Affichage' },
    { key:'calibrationDate', label:'Dernier étalonnage', group:'Maintenance', type:'date' },
    { key:'presetBackup', label:'Sauvegarde des presets', group:'Maintenance' }
  ],
  server: [
    { key:'serviceTag', label:'Service Tag / identifiant constructeur', group:'Identité' },
    { key:'installedCpu', label:'CPU installés', group:'Matériel', type:'textarea' },
    { key:'installedMemory', label:'RAM installée', group:'Matériel' },
    { key:'installedStorage', label:'Disques / SSD / capacité', group:'Stockage', type:'textarea' },
    { key:'raidConfiguration', label:'RAID / contrôleur', group:'Stockage' },
    { key:'networkAdapters', label:'Cartes réseau / débits', group:'Réseau & contrôle', type:'textarea' },
    { key:'remoteManagement', label:'iDRAC / iLO / gestion distante', group:'Réseau & contrôle' },
    { key:'operatingSystem', label:"Système d’exploitation", group:'Versions' },
    { key:'applicationRoles', label:'Services / applications hébergés', group:'Exploitation', type:'textarea' },
    { key:'clusterRole', label:'Cluster / nœud / redondance', group:'Exploitation' },
    { key:'backupPolicy', label:'Politique / dernière sauvegarde', group:'Maintenance', type:'textarea' }
  ],
  workstation: [
    { key:'installedCpu', label:'CPU installé', group:'Matériel' },
    { key:'installedMemory', label:'RAM installée', group:'Matériel' },
    { key:'installedGpu', label:'GPU / carte graphique', group:'Matériel' },
    { key:'installedStorage', label:'Stockage installé', group:'Stockage' },
    { key:'networkAdapters', label:'Cartes réseau', group:'Réseau & contrôle' },
    { key:'operatingSystem', label:"Système d’exploitation", group:'Versions' },
    { key:'applicationRoles', label:'Logiciels / usage métier', group:'Exploitation', type:'textarea' },
    { key:'domainMembership', label:'Domaine / groupe de gestion', group:'Réseau & contrôle' }
  ],
  'network-switch': [
    { key:'exactSku', label:'SKU / suffixe exact', group:'Identité' },
    { key:'portPopulation', label:'Ports cuivre/fibre réellement utilisés', group:'Réseau & contrôle', type:'textarea' },
    { key:'uplinkModules', label:'Modules uplink', group:'Composition' },
    { key:'transceivers', label:'SFP / SFP+ / SFP28 installés', group:'Composition', type:'textarea' },
    { key:'stackRole', label:'Stack / rôle / priorité', group:'Exploitation' },
    { key:'networkOsVersion', label:'Version IOS / firmware', group:'Versions' },
    { key:'vlanRole', label:'VLAN / fonction réseau', group:'Exploitation', type:'textarea' },
    { key:'configBackup', label:'Dernière sauvegarde de configuration', group:'Maintenance' }
  ],
  firewall: [
    { key:'exactSku', label:'SKU / numéro matériel exact', group:'Identité' },
    { key:'haRole', label:'Rôle HA / cluster', group:'Exploitation' },
    { key:'portPopulation', label:'Interfaces et zones raccordées', group:'Réseau & contrôle', type:'textarea' },
    { key:'networkOsVersion', label:'Version FortiOS / firmware', group:'Versions' },
    { key:'subscriptions', label:'Licences / abonnements (sans clé)', group:'Support', type:'textarea' },
    { key:'configBackup', label:'Dernière sauvegarde de configuration', group:'Maintenance' }
  ],
  storage: [
    { key:'engineVariant', label:'Moteur / variante exacte', group:'Identité' },
    { key:'rawCapacity', label:'Capacité brute', group:'Stockage' },
    { key:'usableCapacity', label:'Capacité utile', group:'Stockage' },
    { key:'mediaPacks', label:'Media Packs / disques installés', group:'Composition', type:'textarea' },
    { key:'networkAdapters', label:'Interfaces réseau', group:'Réseau & contrôle' },
    { key:'fileSystemVersion', label:'Version VFS / système', group:'Versions' },
    { key:'workspaceRoles', label:'Workspaces / usages', group:'Exploitation', type:'textarea' },
    { key:'protectionPolicy', label:'Protection / miroir / spare', group:'Maintenance', type:'textarea' }
  ],
  display: [
    { key:'screenSize', label:'Taille de dalle', group:'Affichage' },
    { key:'nativeResolution', label:'Résolution native', group:'Affichage' },
    { key:'activeInput', label:'Entrée active / source', group:'Signaux' },
    { key:'wallPosition', label:'Position sur mur / pupitre', group:'Implantation' },
    { key:'colorPreset', label:'Preset couleur / gamma', group:'Configuration' },
    { key:'calibrationDate', label:'Dernier étalonnage', group:'Maintenance', type:'date' },
    { key:'usageHours', label:'Heures de fonctionnement', group:'Maintenance' }
  ],
  multiviewer: [
    { key:'inputMapping', label:'Entrées / sources', group:'Signaux', type:'textarea' },
    { key:'outputMapping', label:'Sorties / écrans', group:'Signaux', type:'textarea' },
    { key:'activeLayouts', label:'Layouts / mosaïques', group:'Configuration', type:'textarea' },
    { key:'licensedOptions', label:'Options / licences', group:'Configuration' },
    { key:'controlSoftware', label:'Logiciel de contrôle', group:'Versions' },
    { key:'referenceSource', label:'Référence / synchronisation', group:'Synchronisation' }
  ],
  vtr: [
    { key:'recordingFormat', label:'Format / codec exploité', group:'Signaux' },
    { key:'mediaType', label:'Support média', group:'Exploitation' },
    { key:'sdiMapping', label:'E/S SDI raccordées', group:'Signaux', type:'textarea' },
    { key:'audioMapping', label:'Canaux audio', group:'Audio' },
    { key:'remoteProtocol', label:'Commande distante / RS-422', group:'Réseau & contrôle' },
    { key:'networkFunctions', label:'Fonctions réseau / transfert', group:'Réseau & contrôle', type:'textarea' },
    { key:'headHours', label:'Compteur / heures laser-tête', group:'Maintenance' }
  ],
  'audio-processor': [
    { key:'inputMapping', label:'Entrées audio', group:'Audio', type:'textarea' },
    { key:'outputMapping', label:'Sorties audio', group:'Audio', type:'textarea' },
    { key:'audioFormat', label:'Format / niveau / impédance', group:'Audio' },
    { key:'activePreset', label:'Preset actif', group:'Configuration' },
    { key:'referenceSource', label:'Référence / horloge', group:'Synchronisation' },
    { key:'loudnessTarget', label:'Cible loudness / norme', group:'Configuration' },
    { key:'presetBackup', label:'Sauvegarde des presets', group:'Maintenance' }
  ],
  'control-panel': [
    { key:'controlledSystem', label:'Système contrôlé', group:'Exploitation' },
    { key:'panelAddress', label:'Adresse / identifiant panneau', group:'Réseau & contrôle' },
    { key:'buttonLayout', label:'Pages / touches / fonctions', group:'Configuration', type:'textarea' },
    { key:'controlProtocol', label:'Protocole de contrôle', group:'Réseau & contrôle' },
    { key:'panelSoftware', label:'Version / configuration panneau', group:'Versions' }
  ],
  intercom: [
    { key:'frameVariant', label:'Châssis / panneau exact', group:'Identité' },
    { key:'installedCards', label:'Cartes / interfaces installées', group:'Composition', type:'textarea' },
    { key:'configuredPorts', label:'Ports / abonnés configurés', group:'Exploitation' },
    { key:'networkTopology', label:'Anneau / trunks / réseau', group:'Réseau & contrôle', type:'textarea' },
    { key:'syncSource', label:'Source de synchronisation', group:'Synchronisation' },
    { key:'redundancyState', label:'Contrôleur / PSU redondants', group:'Énergie' }
  ],
  kvm: [
    { key:'exactSku', label:'Modèle / SKU exact', group:'Identité' },
    { key:'managedTargets', label:'Serveurs / postes desservis', group:'Exploitation', type:'textarea' },
    { key:'consoleType', label:'Console / écran / clavier', group:'Composition' },
    { key:'networkAccess', label:'Accès IP / réseau de gestion', group:'Réseau & contrôle' },
    { key:'firmwareVersion', label:'Version firmware', group:'Versions' }
  ]
});

export const KNOWLEDGE_PROFILES = Object.freeze(Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key]) => [key, Object.freeze({
  key,
  label: ({
    generic:'Équipement générique', 'router-matrix':'Routeur / grille matricielle', 'modular-frame':'Châssis modulaire',
    'broadcast-processor':'Traitement broadcast', 'sync-generator':'Synchronisation / référence',
    'waveform-monitor':'Mesure / waveform', server:'Serveur', workstation:'Station de travail',
    'network-switch':'Switch réseau', firewall:'Firewall', storage:'Stockage média', display:'Écran / moniteur',
    multiviewer:'Multiviewer', vtr:'VTR / enregistreur', 'audio-processor':'Audio / monitoring',
    'control-panel':'Panneau de contrôle', intercom:'Intercom', kvm:'KVM / console'
  })[key],
  fields:Object.freeze([...BASE_FIELDS, ...PROFILE_FIELDS[key]])
})])));

const SECRET_PATTERN = /(password|mot\s*de\s*passe|secret|token|api\s*key|clé\s*api|private\s*key|clé\s*privée|credential)/i;
const clean = (value, max = TEXT_LIMIT) => String(value ?? '').trim().slice(0, max);

export function inferKnowledgeProfile(item = {}) {
  const text = [item.knowledgeProfile, item.equipmentProfile, item.type, item.category, item.categorie, item.family, item.model, item.modele, item.name]
    .filter(Boolean).join(' ').toLowerCase();
  if (/firewall|fortigate/.test(text)) return 'firewall';
  if (/switch réseau|catalyst|network switch/.test(text)) return 'network-switch';
  if (/routeur vidéo|matrice|router|grille/.test(text)) return 'router-matrix';
  if (/châssis|chassis|opengear|frame modulaire|synapse sfr/.test(text)) return 'modular-frame';
  if (/waveform|forme d.onde|analyse vidéo|lv53/.test(text)) return 'waveform-monitor';
  if (/sync|synchronisation|changeover|référence|reference|lt 46|lt 44/.test(text)) return 'sync-generator';
  if (/nexis|stockage média|storage/.test(text)) return 'storage';
  if (/serveur|server|poweredge|precision 3930|airspeed|spectrum/.test(text)) return 'server';
  if (/workstation|prodesk|thinkstation|poste de travail/.test(text)) return 'workstation';
  if (/multiview|kaleido|dmon/.test(text)) return 'multiviewer';
  if (/vtr|xdcam|professional disc|deck|enregistreur/.test(text)) return 'vtr';
  if (/intercom|riedel|artist/.test(text)) return 'intercom';
  if (/kvm|servview/.test(text)) return 'kvm';
  if (/panneau|panel|rcp|ultritouch|stream deck/.test(text)) return 'control-panel';
  if (/audio|wohler|dbmax|optimod|ada-|aap-/.test(text)) return 'audio-processor';
  if (/écran|monitor|display|moniteur/.test(text)) return 'display';
  if (/sdi|broadcast|frame sync|converter|convertisseur|distribution amplifier|de-embed|master control/.test(text)) return 'broadcast-processor';
  return 'generic';
}

export function fieldsForKnowledgeProfile(profile, existingFacts = []) {
  const base = KNOWLEDGE_PROFILES[profile] || KNOWLEDGE_PROFILES.generic;
  const known = new Map(Object.values(KNOWLEDGE_PROFILES).flatMap(item => item.fields).map(field => [field.key, field]));
  const extra = (Array.isArray(existingFacts) ? existingFacts : [])
    .map(fact => known.get(String(fact?.key || '')))
    .filter(field => field && !base.fields.some(item => item.key === field.key));
  return [...new Map([...base.fields, ...extra].map(field => [field.key, field])).values()];
}

export function normalizeEquipmentKnowledge(record = {}) {
  const knowledgeProfile = KNOWLEDGE_PROFILES[record.knowledgeProfile] ? record.knowledgeProfile : inferKnowledgeProfile(record);
  const allowed = new Set(Object.values(KNOWLEDGE_PROFILES).flatMap(item => item.fields.map(field => field.key)));
  const technicalFacts = [];
  const seen = new Set();
  for (const source of Array.isArray(record.technicalFacts) ? record.technicalFacts.slice(0, FACT_LIMIT) : []) {
    const key = clean(source?.key, 80);
    const value = clean(source?.value);
    const sensitiveText = [key, source?.label, source?.sourceLabel, source?.notes, value].filter(Boolean).join(' ');
    if (!key || !value || !allowed.has(key) || seen.has(key) || SECRET_PATTERN.test(sensitiveText)) continue;
    seen.add(key);
    technicalFacts.push({
      key,
      value,
      verificationStatus: KNOWLEDGE_STATUSES.includes(source?.verificationStatus) ? source.verificationStatus : 'to-confirm',
      sourceType: KNOWLEDGE_SOURCE_TYPES.includes(source?.sourceType) ? source.sourceType : 'other',
      sourceLabel: clean(source?.sourceLabel, 300),
      observedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(source?.observedAt || '')) ? source.observedAt : '',
      notes: clean(source?.notes, 500)
    });
  }
  return { ...record, knowledgeProfile, technicalFacts, knowledgeVersion:1 };
}

export function validateEquipmentKnowledge(record = {}) {
  const errors = [];
  if (record.knowledgeProfile && !KNOWLEDGE_PROFILES[record.knowledgeProfile]) errors.push('Profil de connaissance inconnu.');
  if (record.technicalFacts != null && !Array.isArray(record.technicalFacts)) errors.push('Les données techniques doivent être une liste.');
  if (Array.isArray(record.technicalFacts) && record.technicalFacts.length > FACT_LIMIT) errors.push(`Maximum ${FACT_LIMIT} données techniques par équipement.`);
  const normalized = normalizeEquipmentKnowledge(record);
  if (Array.isArray(record.technicalFacts) && normalized.technicalFacts.length !== record.technicalFacts.filter(item => String(item?.value || '').trim()).length) {
    errors.push('Une donnée technique contient une clé, une source ou une valeur non autorisée. Les secrets et mots de passe sont interdits.');
  }
  return { value:normalized, errors };
}

export const EQUIPMENT_KNOWLEDGE_LIMITS = Object.freeze({ text:TEXT_LIMIT, facts:FACT_LIMIT });
