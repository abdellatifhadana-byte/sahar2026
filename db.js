class Database {
  constructor() {
    if (Database.instance) return Database.instance;
    this.dbName = 'tech_platform_db';
    this.version = 14;
    this.db = null;
    this._opening = null;
    this.initSync();
    Database.instance = this;
  }

  async open() {
    if (this.db) return this.db;
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = event => this.createStores(event.target.result, event.target.transaction);
      request.onerror = () => reject(request.error || new Error("Impossible d'ouvrir la base locale"));
      request.onsuccess = async event => {
        this.db = event.target.result;
        this.db.onversionchange = () => { this.db?.close(); this.db = null; };
        try {
          await this.initializeData();
          // Aucun compte administrateur ni jeu de démonstration ne doit être créé dans le navigateur.
          // L'identité et les données de production proviennent du serveur central authentifié.
          resolve(this.db);
        } catch (error) { reject(error); }
      };
    }).finally(() => { this._opening = null; });
    return this._opening;
  }

  createStores(db, tx) {
    const ensure = (name, options, indexes = []) => {
      let store;
      if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, options);
      else if (tx) store = tx.objectStore(name);
      if (!store) return;
      for (const [indexName, keyPath, optionsIndex] of indexes) if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, optionsIndex || { unique: false });
    };
    ensure('equipments', { keyPath: 'id', autoIncrement: true }, [['baieId','baieId'],['roomId','roomId'],['status','status'],['type','type']]);
    ensure('screens', { keyPath: 'id', autoIncrement: true }, [['roomId','roomId'],['status','status'],['serialNumber','serialNumber'],['wallId','wallId'],['equipmentId','equipmentId']]);
    ensure('screen_issues', { keyPath: 'id', autoIncrement: true }, [['screenId','screenId'],['resolved','resolved'],['date','date']]);
    ensure('screen_groups', { keyPath: 'id' });
    ensure('tickets', { keyPath: 'id', autoIncrement: true }, [['type','type'],['status','status'],['createdBy','createdBy'],['relatedId','relatedId'],['createdAt','createdAt']]);
    ensure('users', { keyPath: 'id', autoIncrement: true }, [['username','username',{unique:true}],['role','role'],['status','status']]);
    ensure('rooms', { keyPath: 'id', autoIncrement: true }, [['name','name'],['responsibleId','responsibleId']]);
    ensure('baies', { keyPath: 'id', autoIncrement: true }, [['roomId','roomId'],['name','name']]);
    ensure('logs', { keyPath: 'id', autoIncrement: true }, [['type','type'],['timestamp','timestamp']]);
    ensure('notifications', { keyPath: 'id', autoIncrement: true }, [['userId','userId'],['read','read']]);
    ensure('attachments', { keyPath: 'id', autoIncrement: true }, [['entityType','entityType'],['entityId','entityId'],['isImage','isImage']]);
    ensure('settings', { keyPath: 'id' });
    ensure('syncQueue', { keyPath: 'id', autoIncrement: true }, [['action','action'],['timestamp','timestamp'],['status','status']]);
    ensure('diagnosis_history', { keyPath: 'id', autoIncrement: true });
    ensure('walls', { keyPath: 'id' }, [['roomId','roomId'],['updatedAt','updatedAt']]);
    for (const name of ['notes','docs','faq']) ensure(name, { keyPath: 'id', autoIncrement: true }, [['targetType','targetType'],['targetId','targetId']]);
    ensure('cables', { keyPath: 'id' }, [['roomId','roomId'],['status','status']]);
    ensure('cable_reports', { keyPath: 'id', autoIncrement: true }, [['roomId','roomId'],['createdAt','createdAt']]);
  }

  /*
   * L'AMORÇAGE NE DÉCLARE PAS LE PLAN.
   *
   * Cette fiche part au serveur — `db.save` est enveloppé par la synchronisation — et elle
   * portait `mapImageUrl:'assets/plan-technique.PNG'`. Sur un profil de navigateur neuf,
   * un administrateur REMPLAÇAIT donc, sans le savoir, le plan configuré sur la plateforme
   * par le désignateur du plan intégré : une image téléversée ou une URL distante étaient
   * perdues au premier démarrage sur un nouveau poste.
   *
   * Le champ est retiré de l'amorçage. Le serveur est seul à connaître la source du plan,
   * et il la conserve quand une écriture ne la mentionne pas. `settings-contract.js`
   * continue d'offrir le désignateur par défaut en LECTURE, ce qui est son rôle.
   */
  async initializeData() {
    if (!(await this.get('settings','global'))) await this.save('settings', { id:'global', theme:'light', language:'fr', autoBackup:true, backupFrequency:'weekly', autoLogout:30, notifications:true, updatedAt:new Date().toISOString() });
  }

  // Conservé uniquement pour les environnements de développement qui l'appellent explicitement.
  // Cette méthode n'est plus exécutée automatiquement à l'ouverture de la base.
  async populateDummyData() {
    try {
      if (await this.count('rooms')) return;
      const room1 = await this.save('rooms', { name:'Salle de contrôle principale', imageUrl:'', createdAt:new Date().toISOString() });
      const room2 = await this.save('rooms', { name:'Salle de réunion', imageUrl:'', createdAt:new Date().toISOString() });
      await this.save('screens', { roomId:room1, name:'Écran principal', serialNumber:'SCR-001', status:'ok' });
      await this.save('screens', { roomId:room1, name:'Écran latéral', serialNumber:'SCR-002', status:'error' });
      await this.save('screens', { roomId:room2, name:'Écran de présentation', serialNumber:'SCR-003', status:'ok' });
    } catch (error) { console.warn('Données de démonstration non initialisées', error); }
  }

  async save(storeName, data) {
    await this.open();
    const payload = { ...data };
    if (payload.id === '' || payload.id === undefined || payload.id === null) delete payload.id;
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction(storeName,'readwrite'); const req = tx.objectStore(storeName).put(payload);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, id) {
    await this.open();
    if (storeName === 'settings' && (id === 1 || id === 'global')) {
      const primary = await this._getRaw(storeName, id); if (primary) return primary;
      return this._getRaw(storeName, id === 1 ? 'global' : 1);
    }
    return this._getRaw(storeName,id);
  }
  _getRaw(storeName,id) { return new Promise((resolve,reject) => { const req=this.db.transaction(storeName,'readonly').objectStore(storeName).get(id); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  /*
   * L'ÉCRITURE NUE, SANS AUCUNE ENVELOPPE.
   *
   * `_getRaw` et `_deleteRaw` existaient déjà ; l'écriture, elle, n'avait pas d'équivalent,
   * et un module chargé APRÈS la synchronisation n'avait donc d'autre choix que d'ouvrir
   * lui-même une transaction. `credential-cache-guard.js` le faisait, ce qui le rendait
   * intestable ailleurs que dans un navigateur — or c'est exactement le module qui nettoie
   * les secrets résiduels. La primitive manquante est ajoutée ici, à sa place.
   */
  async _saveRaw(storeName,data) { await this.open(); return new Promise((resolve,reject) => { const req=this.db.transaction(storeName,'readwrite').objectStore(storeName).put(data); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }

  async getAll(storeName, indexName, indexValue) {
    await this.open();
    return new Promise((resolve,reject) => {
      const store=this.db.transaction(storeName,'readonly').objectStore(storeName);
      let req;
      if (indexName && indexValue !== undefined) {
        if (!store.indexNames.contains(indexName)) return reject(new Error(`Index ${indexName} absent de ${storeName}`));
        req=store.index(indexName).getAll(indexValue);
      } else req=store.getAll();
      req.onsuccess=()=>resolve(req.result || []); req.onerror=()=>reject(req.error);
    });
  }

  async _deleteRaw(storeName,id) { await this.open(); return new Promise((resolve,reject)=>{ const req=this.db.transaction(storeName,'readwrite').objectStore(storeName).delete(id); req.onsuccess=()=>resolve(true); req.onerror=()=>reject(req.error); }); }
  async delete(storeName,id) {
    if (storeName === 'rooms') return this.deleteRoomSafely(id);
    if (storeName === 'baies') return this.deleteBaieSafely(id);
    if (storeName === 'equipments') return this.deleteEquipmentSafely(id);
    if (storeName === 'screens') return this.deleteScreenSafely(id);
    return this._deleteRaw(storeName,id);
  }

  async count(storeName,indexName,indexValue) { const all = indexName ? await this.getAll(storeName,indexName,indexValue) : await this.getAll(storeName); return all.length; }
  async getRecent(storeName,limit=10,dateField='createdAt') { const records=await this.getAll(storeName); return records.sort((a,b)=>new Date(b[dateField]??b.timestamp??b.date??0)-new Date(a[dateField]??a.timestamp??a.date??0)).slice(0,Math.max(0,Number(limit)||0)); }

  async getRoomDependencies(roomId) { const [baies,equipments,walls,screens]=await Promise.all(['baies','equipments','walls','screens'].map(x=>this.getAll(x))); const same=x=>String(x.roomId)===String(roomId); return {baies:baies.filter(same),equipments:equipments.filter(same),walls:walls.filter(same),screens:screens.filter(same)}; }
  async deleteRoomSafely(roomId) { const deps=await this.getRoomDependencies(roomId); if(Object.values(deps).some(x=>x.length)){ const e=new Error('Cette salle contient encore des baies, équipements, murs ou écrans. Réaffectez-les avant la suppression.'); e.code='ROOM_HAS_DEPENDENCIES'; throw e; } const id=this.normalizeKey(roomId); await this._deleteRaw('rooms',id); if(String(await this.getCurrentRoomId())===String(id)) await this.setCurrentRoomId(null); return true; }
  async deleteBaieSafely(baieId) { const id=this.normalizeKey(baieId); const equipments=(await this.getAll('equipments')).filter(x=>String(x.baieId)===String(id)); if(equipments.length){ const e=new Error(`${equipments.length} équipement(s) appartiennent encore à cette baie. Réaffectez-les avant la suppression.`); e.code='BAIE_HAS_EQUIPMENTS'; throw e; } return this._deleteRaw('baies',id); }
  async deleteEquipmentSafely(equipmentId) { const id=this.normalizeKey(equipmentId); const screens=(await this.getAll('screens')).filter(x=>String(x.equipmentId)===String(id)); for(const screen of screens) await this.save('screens',{...screen,equipmentId:null,updatedAt:new Date().toISOString()}); await this._deleteRaw('equipments',id); return {deleted:true,detachedScreenIds:screens.map(x=>x.id)}; }
  async getScreenDependencies(screenId){ const same=v=>String(v)===String(screenId); const [groups,tickets,issues,history]=await Promise.all(['screen_groups','tickets','screen_issues','diagnosis_history'].map(x=>this.getAll(x))); return { groups:groups.filter(g=>(g.screenIds||[]).some(same)), tickets:tickets.filter(t=>(t.type==='screen'||t.relatedType==='screen')&&same(t.relatedId??t.targetId??t.entityId??t.idElement)), issues:issues.filter(i=>same(i.screenId)), history:history.filter(h=>same(h.screenId)||(h.screenIds||[]).some(same)) }; }
  async deleteScreenSafely(screenId){ const deps=await this.getScreenDependencies(screenId); if(deps.tickets.length||deps.issues.length||deps.history.length){ const e=new Error("Cet écran possède des tickets ou un historique de diagnostic. Archivez-le au lieu de le supprimer."); e.code='SCREEN_HAS_HISTORY'; throw e; } for(const g of deps.groups) await this.save('screen_groups',{...g,screenIds:g.screenIds.filter(id=>String(id)!==String(screenId))}); await this._deleteRaw('screens',this.normalizeKey(screenId)); return {deleted:true}; }

  normalizeKey(value){ if(value===null||value===undefined||value==='') return value; const n=Number(value); return Number.isNaN(n)?value:n; }
  async setCurrentRoomId(roomId){ const id = roomId===null||roomId===undefined||roomId==='' ? null : this.normalizeKey(roomId); if(id!==null && !(await this.get('rooms',id))) throw new Error('La salle sélectionnée est introuvable'); await this.save('settings',{id:'current-room',currentRoomId:id,updatedAt:new Date().toISOString()}); return id; }
  async getCurrentRoomId(){ const c=await this._getRaw('settings','current-room'); return c?.currentRoomId??c?.roomId??c?.idSalle??null; }
  async getCurrentRoom(){ const id=await this.getCurrentRoomId(); if(id===null||id===undefined) return null; const room=await this.get('rooms',id); return room?{...room,roomId:room.id}:null; }

  async search(query,{storeNames,limit=50,fields=[]}={}) { await this.open(); const names=storeNames||Array.from(this.db.objectStoreNames); const q=String(query||'').toLowerCase(); const results=[]; for(const name of names){ for(const item of await this.getAll(name)){ const keys=fields.length?fields:Object.keys(item); if(keys.some(k=>String(item[k]??'').toLowerCase().includes(q))){ results.push({store:name,item}); if(results.length>=limit)return results; } } } return results; }
  hashPassword(password){ return btoa(unescape(encodeURIComponent(String(password)))); }
  initSync(){ if(typeof window!=='undefined') window.addEventListener('online',()=>this.processSyncQueue()); }
  async processSyncQueue(){}
  async createBackup(){ const stores=['users','locations','rooms','baies','equipments','walls','screens','screen_groups','screen_issues','diagnosis_history','tickets','notes','docs','faq','notifications','logs','attachments','cables','cable_reports','settings']; const data={}; for(const name of stores) if(this.db?.objectStoreNames.contains(name)) data[name]=await this.getAll(name); return new Blob([JSON.stringify({formatVersion:2,schemaVersion:this.version,timestamp:new Date().toISOString(),data},null,2)],{type:'application/json'}); }
  async restoreBackup(obj){ const {BackupService}=await import('./backup-service.js'); return new BackupService().restoreBackup(obj); }
  async clearDatabase(){ await this.open(); for(const name of this.db.objectStoreNames){ const tx=this.db.transaction(name,'readwrite'); await new Promise((res,rej)=>{const r=tx.objectStore(name).clear();r.onsuccess=res;r.onerror=()=>rej(r.error);}); } }
  async saveImage(storeName,entityId,imageFile){ const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=()=>rej(r.error);r.readAsDataURL(imageFile);}); return this.save('attachments',{entityType:storeName,entityId,data,isImage:true,mimeType:imageFile.type,name:imageFile.name,size:imageFile.size,uploadedAt:new Date().toISOString()}); }
  async getImages(storeName,entityId){ return (await this.getAll('attachments')).filter(x=>x.entityType===storeName&&String(x.entityId)===String(entityId)&&x.isImage); }
}

export const db = new Database();
