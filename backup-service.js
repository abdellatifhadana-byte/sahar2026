import { db } from './db.js';
import { eventSystem } from './events.js';
import { extractLegacyWallScreens } from './wall-model.js';
import { ROOM_ZONE_TRANSFER_VERSION, readRoomTransfer } from './room-zone-transfer-contract.js';
// Le tri parent-avant-enfant et la validation de graphe vivent désormais avec l'écriture,
// c'est-à-dire côté serveur (`applyLocationsRestore`). Le client n'en garde rien : une
// seconde copie ici ne ferait que diverger de celle qui décide réellement.

/**
 * LES SALLES NE SE SAUVEGARDENT PAS SANS LEUR ZONE.
 *
 * `resource_zones` est la seule vérité de la zone d'une salle, et ce magasin n'existe pas
 * côté navigateur : il appartient au serveur. Une sauvegarde qui n'emportait que `rooms[]`
 * rendait donc, à la restauration, des salles rattachées à rien — invisibles à tout rôle à
 * périmètre, et introuvables depuis l'écran des accès.
 *
 * La sauvegarde va donc CHERCHER les rattachements auprès du serveur, et la restauration
 * les lui REND par le même chemin, en une transaction. Sans autorité centrale, elle refuse
 * plutôt que de produire une archive incomplète qui se croirait complète.
 */
export const ROOM_TRANSFER_ENDPOINT = '/api/rooms/transfer';

/**
 * LES LOCALISATIONS NON PLUS NE SE RESTAURENT PAS UNE PAR UNE.
 *
 * Même raison que les salles, une marche plus loin. `db.save('locations', …)` part en PUT
 * indépendant : une Ville acceptée puis une Région refusée laissait la Ville écrite et
 * l'arbre coupé en deux. Aucune boucle côté navigateur ne peut promettre « les N
 * écritures aboutiront toutes » — seule une transaction serveur le peut. Le graphe part
 * donc en UN lot vers `/api/locations/restore`, qui valide tout puis écrit tout dans une
 * seule transaction PostgreSQL, et `ROLLBACK` au moindre échec.
 */
export const LOCATIONS_RESTORE_ENDPOINT = '/api/locations/restore';

async function centralJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // `errors` porte le DÉTAIL nommé d'un refus de graphe (UNKNOWN_PARENT, CYCLE, …).
    // Sans lui, le compte rendu ne pourrait dire que « refusé », sans dire pourquoi.
    throw Object.assign(new Error(payload.message || payload.error || `Erreur serveur (${response.status})`),
      { code: payload.error, status: response.status, errors: payload.errors });
  }
  return payload;
}

const SANS_AUTORITE = 'La sauvegarde des salles exige la connexion centrale : sans elle, leur zone d’autorisation ne peut être ni lue ni rendue.';

// Nombre de sauvegardes conservées. Au-delà, les plus anciennes sont purgées : sans
// borne, chaque sauvegarde s'ajoute aux précédentes et le stockage local finit saturé.
export const BACKUP_RETENTION = 8;

/*
 * `locations` (P0-C) — VILLE → RÉGION → DÉPARTEMENT, voir location-contract.js.
 *
 * Absent d'ici, une sauvegarde conservait `rooms[].locationId` sans jamais conserver
 * l'arbre auquel il renvoie : la salle survivait à la restauration, mais son contexte
 * géographique/organisationnel disparaissait — une salle qui EXISTE mais dont plus rien
 * ne dit où elle est. `db.js` porte un second `createBackup()`, plus ancien, qui incluait
 * déjà `locations` dans sa propre liste : ce n'est pas lui qui écrit les sauvegardes de la
 * plateforme (rien ne l'appelle en dehors de LEGACY-ROOT/, exclu du graphe actif) — c'est
 * cette classe-ci, câblée depuis `system-settings.js`. La confusion venait de là.
 *
 * `restoreBackup()` la traite SÉPARÉMENT, avant la boucle générique ci-dessous : le lot
 * part ENTIER à `/api/locations/restore`, où la validation du graphe, l'ordre
 * parent-avant-enfant et l'écriture tiennent dans UNE transaction. Le client n'écrit
 * aucune localisation lui-même.
 */
export const BACKUP_STORES = Object.freeze([
  'users','locations','rooms','baies','equipments','walls','screens','screen_groups','screen_issues','diagnosis_history','tickets','notes','docs','faq','notifications','logs','attachments','cables','cable_reports','settings'
]);

export class BackupService {
  constructor(){ this.backupInterval=null; }
  async createBackup(){
    await db.open(); const data={};
    for(const store of BACKUP_STORES) if(db.db.objectStoreNames.contains(store)) data[store]=await db.getAll(store);
    // Les rattachements viennent du serveur : ils n'existent nulle part ailleurs.
    const roomZones=await this.fetchRoomZones();
    return {
      schemaVersion:db.version, formatVersion:ROOM_ZONE_TRANSFER_VERSION,
      timestamp:new Date().toISOString(), roomZones, data
    };
  }

  /** Les rattachements canoniques des salles, dans le périmètre du demandeur. */
  async fetchRoomZones(){
    if(db.isCentralSyncReady?.()===false || typeof fetch!=='function'){
      throw Object.assign(new Error(SANS_AUTORITE),{ code:'CENTRAL_AUTHORITY_REQUIRED' });
    }
    try{
      const paquet=await centralJson(ROOM_TRANSFER_ENDPOINT);
      return Array.isArray(paquet.roomZones)?paquet.roomZones:[];
    }catch(error){
      throw Object.assign(new Error(`${SANS_AUTORITE} (${error.message})`),{ code:'CENTRAL_AUTHORITY_REQUIRED', cause:error });
    }
  }
  validateBackup(backup){ const data=backup?.data||backup?.database||backup; return !!data && typeof data==='object' && ['users','rooms','equipments'].some(name=>Array.isArray(data[name])); }
  normalizeBackup(backup){
    const source=backup.data||backup.database||backup; const data={};
    for(const [store,records] of Object.entries(source)) if(BACKUP_STORES.includes(store)&&Array.isArray(records)) data[store]=records.map(r=>({...r}));
    const legacy=[];
    data.walls=(data.walls||[]).map(record=>{ const converted=extractLegacyWallScreens(record); legacy.push(...converted.screens); return converted.wall; });
    const existing=new Set((data.screens||[]).map(x=>String(x.id)));
    data.screens=[...(data.screens||[]),...legacy.filter(x=>!existing.has(String(x.id)))];
    return data;
  }
  /**
   * Restauration tolérante aux rejets.
   *
   * Auparavant la boucle n'avait aucun try/catch : le premier enregistrement refusé
   * interrompait toute la restauration. Or `tickets` arrive en dixième position et le
   * serveur refuse systématiquement une écriture directe de ticket (409, le workflow des
   * demandes en est seul propriétaire). Tout ce qui suivait — notes, docs (schémas,
   * continuité, base de connaissances), faq, notifications, logs, attachments, cables,
   * cable_reports, settings — n'était donc jamais restauré, et l'utilisateur ne voyait
   * qu'un message d'erreur, sans savoir qu'une restauration partielle avait déjà eu lieu.
   *
   * Chaque enregistrement est désormais isolé, et la méthode retourne un compte rendu par
   * store au lieu d'un simple booléen.
   */
  async restoreBackup(backup){
    if(!this.validateBackup(backup)) throw new Error('Format de sauvegarde invalide');
    await db.open();
    const data=this.normalizeBackup(backup);
    const report={ restored:0, skipped:0, failed:0, stores:{}, errors:[] };

    /*
     * LES LOCALISATIONS D'ABORD — EN UN SEUL LOT ATOMIQUE, CÔTÉ SERVEUR (P0-C).
     *
     * `room.locationId` n'est vérifié par rien, ni client ni serveur (voir salles.js : un
     * renvoi dans le vide rend un chemin vide, sans erreur) — restaurer les salles avant
     * les localisations ne CASSE donc rien techniquement. Mais une salle qui EXISTE après
     * restauration alors que l'arbre auquel elle se rattache a disparu perd son contexte
     * sans que rien ne le signale : le jumeau numérique ment sur où se trouve une salle.
     * On restaure donc l'arbre d'abord, ET on refuse de poser les salles s'il a échoué.
     *
     * CE QUI A CHANGÉ, ET POURQUOI. Ce bloc validait le graphe puis écrivait fiche par
     * fiche : `for (record of ordonnees) { try { await db.save(...) } catch { continue } }`.
     * La validation répond « ce lot est cohérent » — jamais « les N écritures qui suivent
     * aboutiront toutes ». Une Ville acceptée puis une Région refusée (409, permission,
     * refus définitif) laissait la Ville écrite, l'arbre coupé, et le compte rendu
     * annonçait une restauration réussie. Une compensation après coup — supprimer ce qui
     * vient d'être écrit — serait une seconde série d'écritures, qui peut échouer à son
     * tour ou courir contre un autre auteur : elle ne rend aucune garantie.
     *
     * Le lot part donc ENTIER au serveur, qui valide puis écrit dans UNE transaction
     * PostgreSQL. Échec = `ROLLBACK` = zéro changement net. Le client n'écrit plus rien
     * lui-même dans `locations` — exactement le précédent déjà posé pour les salles.
     *
     * Une sauvegarde ANCIENNE, sans `locations` du tout, ne déclenche même pas ce bloc :
     * rien n'est inventé pour elle, `report.stores.locations` reste simplement absent, et
     * le transfert des salles se déroule comme avant.
     */
    let localisationsEnEchec=false;
    if(Object.prototype.hasOwnProperty.call(data,'locations')){
      const brutes=data.locations; delete data.locations;
      const summary={ total:brutes.length, restored:0, failed:0 };
      if(brutes.length){
        try{
          const rapport=await centralJson(LOCATIONS_RESTORE_ENDPOINT,{
            method:'POST', body:JSON.stringify({ locations:brutes })
          });
          summary.restored=Number(rapport.locations || 0); report.restored+=summary.restored;
        }catch(error){
          // Tout ou rien : le serveur a annulé la transaction, donc RIEN n'a été écrit.
          // On le dit, au lieu de laisser croire à une restauration partielle réussie.
          localisationsEnEchec=true;
          summary.failed=brutes.length; report.failed+=brutes.length;
          summary.reason='Graphe de localisations refusé : aucune localisation restaurée.';
          if(Array.isArray(error?.errors)) summary.errors=error.errors;
          report.errors.push({ store:'locations', id:null, message:String(error?.message||error) });
        }
      }
      report.stores.locations=summary;
    }

    /*
     * LES SALLES PASSENT PAR LE SERVEUR, avec leurs rattachements, en une transaction.
     *
     * Les rejouer une par une avec `db.save('rooms', …)` déposait des salles sans zone :
     * chacune était acceptée, et aucune n'appartenait plus à personne. Le contrat de
     * transfert relit aussi bien nos archives que les anciennes, dont le `room.zoneId`
     * n'est qu'une entrée de migration.
     */
    const paquetSalles=readRoomTransfer({
      formatVersion:Number(backup.formatVersion || 2),
      rooms:data.rooms || [],
      roomZones:backup.roomZones || []
    });
    delete data.rooms;
    /*
     * UNE SALLE NE SE POSE PAS SUR UN ARBRE QU'ON VIENT DE REFUSER (P0-C, blocage 3).
     *
     * `room.locationId` n'est validé NULLE PART — ni ici, ni dans `scripts/serve.js`. Si
     * le graphe de localisations vient d'être refusé et que les salles passent quand même,
     * on restaure des `room.locationId` qui désignent des localisations délibérément NON
     * écrites : très exactement le jumeau numérique qui ment sur où se trouve une salle,
     * c'est-à-dire l'état que tout ce bloc existe pour empêcher.
     *
     * On s'arrête donc AVANT l'écriture dépendante, plutôt que de la réparer après.
     */
    if(localisationsEnEchec && paquetSalles.rooms.length){
      const summary={ total:paquetSalles.rooms.length, restored:0, failed:paquetSalles.rooms.length, skipped:0 };
      report.failed+=paquetSalles.rooms.length;
      summary.reason='Salles non restaurées : le graphe de localisations a été refusé, leur rattachement pointerait dans le vide.';
      report.errors.push({ store:'rooms', id:null, message:summary.reason });
      report.stores.rooms=summary;
    } else if(paquetSalles.rooms.length){
      const summary={ total:paquetSalles.rooms.length, restored:0, failed:0 };
      try{
        const rapport=await centralJson(ROOM_TRANSFER_ENDPOINT,{ method:'POST', body:JSON.stringify(paquetSalles) });
        summary.restored=Number(rapport.rooms || 0); report.restored+=summary.restored;
        summary.roomZones=Number(rapport.roomZones || 0);
        summary.migratedFromLegacy=paquetSalles.migratedFromLegacy.length;
      }catch(error){
        // Tout ou rien : une restauration partielle des salles est précisément l'état
        // qu'on refuse. On le DIT, au lieu de laisser croire à un succès.
        summary.failed=paquetSalles.rooms.length; report.failed+=summary.failed;
        report.errors.push({ store:'rooms', id:null, message:String(error?.message||error) });
      }
      report.stores.rooms=summary;
    }

    for(const [store,records] of Object.entries(data)){
      if(!db.db.objectStoreNames.contains(store)) continue;
      const summary={ total:records.length, restored:0, failed:0 };

      // `tickets` appartient au serveur : il est conservé dans la sauvegarde pour l'archive,
      // mais rejouer une écriture directe est refusé par conception, pas par accident.
      if(store==='tickets'){
        summary.skipped=records.length; report.skipped+=records.length;
        summary.reason='Les demandes sont restaurées par le serveur, pas par écriture directe.';
        report.stores[store]=summary; continue;
      }

      for(const record of records){
        try { await db.save(store,record); summary.restored+=1; report.restored+=1; }
        catch(error){
          summary.failed+=1; report.failed+=1;
          if(report.errors.length<50) report.errors.push({ store, id:record?.id ?? null, message:String(error?.message||error) });
        }
      }
      report.stores[store]=summary;
    }

    eventSystem.dispatch('backup-restored',{timestamp:new Date().toISOString(),additive:true,report});
    return report;
  }
  async exportToFile(){
    const backup=await this.createBackup(); const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
    const link=document.createElement('a'); link.href=url; link.download=`2mtech-backup-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    eventSystem.dispatch('backup-created',{timestamp:new Date().toISOString(),size:blob.size}); return backup;
  }
  async importFromFile(file){ return this.restoreBackup(JSON.parse(await file.text())); }

  /**
   * Sauvegarde CONSERVÉE dans la plateforme.
   *
   * La sauvegarde automatique appelait `exportToFile()` — c'est-à-dire un téléchargement
   * de fichier — toutes les semaines, sans le moindre geste de l'utilisateur. Les
   * navigateurs bloquent un téléchargement non sollicité : la sauvegarde automatique ne
   * produisait donc probablement rien, et n'en laissait aucune trace. Rien n'était
   * conservé, rien n'était consultable, et personne ne pouvait le constater.
   *
   * Les sauvegardes sont désormais écrites dans un magasin local, listables et
   * restaurables. `exportToFile()` reste, mais pour un téléchargement DEMANDÉ.
   */
  async storeBackup({ reason='auto' }={}){
    const backup=await this.createBackup();
    const payload=JSON.stringify(backup);
    const record={
      id:`backup-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      createdAt:backup.timestamp, reason,
      schemaVersion:backup.schemaVersion, formatVersion:backup.formatVersion,
      sizeBytes:payload.length,
      counts:Object.fromEntries(Object.entries(backup.data).map(([store,records])=>[store,records.length])),
      payload
    };
    // Local uniquement : une sauvegarde ne remonte jamais au serveur.
    if(typeof db.saveLocalOnly==='function') await db.saveLocalOnly('backups',record);
    else await db.save('backups',record);
    await this.pruneBackups();
    eventSystem.dispatch('backup-created',{timestamp:record.createdAt,size:record.sizeBytes,id:record.id});
    return record;
  }

  async listBackups(){
    await db.open();
    if(!db.db.objectStoreNames.contains('backups')) return [];
    const all=await db.getAll('backups');
    // Sans la charge utile : une liste ne doit pas ramener plusieurs mégaoctets en mémoire.
    return all.map(({payload,...meta})=>meta).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Bornage : sans purge, chaque sauvegarde s'ajoute aux précédentes indéfiniment. */
  async pruneBackups(keep=BACKUP_RETENTION){
    await db.open();
    if(!db.db.objectStoreNames.contains('backups')) return { removed:0, kept:0 };
    const all=(await db.getAll('backups')).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    const surplus=all.slice(keep);
    for(const record of surplus){ try{ await db._deleteRaw('backups',record.id); }catch{} }
    return { removed:surplus.length, kept:Math.min(all.length,keep) };
  }

  async restoreStoredBackup(id){
    await db.open();
    const record=await db.get('backups',id);
    if(!record?.payload) throw Object.assign(new Error('Sauvegarde introuvable ou illisible.'),{code:'BACKUP_NOT_FOUND'});
    return this.restoreBackup(JSON.parse(record.payload));
  }

  async downloadStoredBackup(id){
    await db.open();
    const record=await db.get('backups',id);
    if(!record?.payload) throw Object.assign(new Error('Sauvegarde introuvable ou illisible.'),{code:'BACKUP_NOT_FOUND'});
    const blob=new Blob([record.payload],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a'); link.href=url;
    link.download=`2mtech-backup-${String(record.createdAt).slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    return record;
  }

  startAutoBackup(interval='weekly'){
    this.stopAutoBackup();
    const intervals={daily:86400000,weekly:604800000,monthly:2592000000};
    this.backupInterval=setInterval(async()=>{
      // Conserver, et non télécharger : un téléchargement sans geste utilisateur est
      // bloqué par le navigateur, et ne laissait aucune sauvegarde derrière lui.
      try{ await this.storeBackup({reason:'auto'}); eventSystem.dispatch('auto-backup-completed'); }
      catch(error){ eventSystem.dispatch('auto-backup-failed',{error}); }
    },intervals[interval]||intervals.weekly);
  }
  stopAutoBackup(){ if(this.backupInterval) clearInterval(this.backupInterval); this.backupInterval=null; }
}
