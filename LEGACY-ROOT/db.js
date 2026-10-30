/**
 * db.js - إدارة قوية لـ IndexedDB مع نمط Singleton
 */

class Database {
  constructor() {
    if (!Database.instance) {
      this.dbName = 'tech_platform_db';
      this.version = 13; // زيادة الرقم عند تغيير بنية DB
      this.db = null;
      this.initSync();
      Database.instance = this;
    }
    return Database.instance;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = (event) => this.createStores(event.target.result);
      request.onsuccess = async (event) => {
        this.db = event.target.result;
        this.db.onerror = (e) => console.error('DB Error:', e.target.error);
        await this.initializeData();
        await this.populateDummyData();
        resolve(this.db);
      };
      request.onerror = (event) => reject(new Error("فشل فتح قاعدة البيانات: " + event.target.error));
    });
  }

  createStores(db) {
    // الأجهزة
    if (!db.objectStoreNames.contains('equipments')) {
      const eqStore = db.createObjectStore('equipments', { keyPath: 'id', autoIncrement: true });
      eqStore.createIndex('baieId', 'baieId', { unique: false });
      eqStore.createIndex('roomId', 'roomId', { unique: false });
      eqStore.createIndex('status', 'status', { unique: false });
      eqStore.createIndex('type', 'type', { unique: false });
    }
    // الشاشات
    if (!db.objectStoreNames.contains('screens')) {
      const scrStore = db.createObjectStore('screens', { keyPath: 'id', autoIncrement: true });
      scrStore.createIndex('roomId', 'roomId', { unique: false });
      scrStore.createIndex('status', 'status', { unique: false });
      scrStore.createIndex('serialNumber', 'serialNumber', { unique: false });
    }
    // أعطال الشاشات
    if (!db.objectStoreNames.contains('screen_issues')) {
      const issuesStore = db.createObjectStore('screen_issues', { keyPath: 'id', autoIncrement: true });
      issuesStore.createIndex('screenId', 'screenId', { unique: false });
      issuesStore.createIndex('resolved', 'resolved', { unique: false });
      issuesStore.createIndex('date', 'date', { unique: false });
    }
    // مجموعات الشاشات
    if (!db.objectStoreNames.contains('screen_groups')) {
      db.createObjectStore('screen_groups', { keyPath: 'id' });
    }
    // التذاكر
    if (!db.objectStoreNames.contains('tickets')) {
      const ticketsStore = db.createObjectStore('tickets', { keyPath: 'id', autoIncrement: true });
      ticketsStore.createIndex('type', 'type', { unique: false });
      ticketsStore.createIndex('status', 'status', { unique: false });
      ticketsStore.createIndex('createdBy', 'createdBy', { unique: false });
      ticketsStore.createIndex('relatedId', 'relatedId', { unique: false });
      ticketsStore.createIndex('createdAt', 'createdAt', { unique: false });
    }
    // المستخدمين
    if (!db.objectStoreNames.contains('users')) {
      const userStore = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
      userStore.createIndex('username', 'username', { unique: true });
      userStore.createIndex('role', 'role', { unique: false });
      userStore.createIndex('status', 'status', { unique: false });
    }
    // الغرف
    if (!db.objectStoreNames.contains('rooms')) {
      const roomStore = db.createObjectStore('rooms', { keyPath: 'id', autoIncrement: true });
      roomStore.createIndex('name', 'name', { unique: false });
      roomStore.createIndex('location', 'location', { unique: false });
      roomStore.createIndex('rect', 'rect', { unique: false });
    }
    // البايات
    if (!db.objectStoreNames.contains('baies')) {
      const baieStore = db.createObjectStore('baies', { keyPath: 'id', autoIncrement: true });
      baieStore.createIndex('roomId', 'roomId', { unique: false });
      baieStore.createIndex('name', 'name', { unique: false });
      baieStore.createIndex('rect', 'rect', { unique: false });
    }
    // السجلات
    if (!db.objectStoreNames.contains('logs')) {
      const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      logStore.createIndex('userId', 'userId', { unique: false });
      logStore.createIndex('action', 'action', { unique: false });
      logStore.createIndex('timestamp', 'timestamp', { unique: false });
    }
    // الإشعارات
    if (!db.objectStoreNames.contains('notifications')) {
      const notifStore = db.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true });
      notifStore.createIndex('userId', 'userId', { unique: false });
      notifStore.createIndex('read', 'read', { unique: false });
    }
    // الملفات المرفقة
    if (!db.objectStoreNames.contains('attachments')) {
      const attachStore = db.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
      attachStore.createIndex('entityType', 'entityType', { unique: false });
      attachStore.createIndex('entityId', 'entityId', { unique: false });
      attachStore.createIndex('isImage', 'isImage', { unique: false });
    }
    // الإعدادات
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'id' });
    }
    // طابور المزامنة
    if (!db.objectStoreNames.contains('syncQueue')) {
      const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      syncStore.createIndex('action', 'action', { unique: false });
      syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      syncStore.createIndex('status', 'status', { unique: false });
    }
    // سجل تشخيص الشاشات
    if (!db.objectStoreNames.contains('diagnosis_history')) {
      db.createObjectStore('diagnosis_history', { keyPath: 'id', autoIncrement: true });
    }
  }

  async initializeData() {
    // مستخدم أدمن افتراضي
    const users = await this.getAll('users', 'username', 'admin');
    if (!users || users.length === 0) {
      await this.save('users', {
        username: 'admin',
        password: this.hashPassword('admin123'),
        role: 'admin',
        fullName: 'مدير النظام',
        status: 'active',
        createdAt: new Date(),
        lastLogin: null
      });
    }
    // إعدادات افتراضية
    const settingsExists = await this.get('settings', 'global');
    if (!settingsExists) {
      await this.save('settings', {
        id: 'global',
        theme: 'dark',
        language: 'ar',
        autoBackup: true,
        backupInterval: 24,
        lastBackup: null,
        syncInterval: 30,
        lastSync: null,
      });
    }
  }

  async populateDummyData() {
    try {
      const roomsCount = await this.count('rooms');
      if (roomsCount === 0) {
        const tx = this.db.transaction(['rooms', 'screens'], 'readwrite');
        const room1Id = await tx.objectStore('rooms').add({ name: 'غرفة التحكم الرئيسية', imageUrl: '' });
        const room2Id = await tx.objectStore('rooms').add({ name: 'غرفة الاجتماعات', imageUrl: '' });
        await tx.objectStore('screens').add({ roomId: room1Id, name: 'الشاشة الرئيسية', serialNumber: 'SCR-001', status: 'online' });
        await tx.objectStore('screens').add({ roomId: room1Id, name: 'الشاشة الجانبية', serialNumber: 'SCR-002', status: 'offline' });
        await tx.objectStore('screens').add({ roomId: room2Id, name: 'شاشة العرض', serialNumber: 'SCR-003', status: 'online' });
        await tx.done;
      }
    } catch (error) {
      // لا شيء، dummy فقط
    }
  }

  // ========== CRUD ========== //
  async save(storeName, data) {
    await this.open();
    if (!data.id) delete data.id;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async get(storeName, id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async getAll(storeName, indexName, indexValue) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      let req;
      if (indexName && indexValue !== undefined) {
        if (!store.indexNames.contains(indexName)) {
          reject(new Error(`الفهرس ${indexName} غير موجود في ${storeName}`));
          return;
        }
        req = store.index(indexName).getAll(indexValue);
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async delete(storeName, id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
  async count(storeName, indexName, indexValue) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      let req;
      if (indexName && indexValue !== undefined) {
        if (!store.indexNames.contains(indexName)) {
          reject(new Error(`Index ${indexName} does not exist in ${storeName}`));
          return;
        }
        req = store.index(indexName).count(indexValue);
      } else {
        req = store.count();
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // بحث متقدم
  async search(query, options = {}) {
    const {
      storeNames = Array.from(this.db.objectStoreNames),
      limit = 50,
      fields = []
    } = options;
    const results = [];
    const queryLower = query.toLowerCase();
    for (const storeName of storeNames) {
      const allItems = await this.getAll(storeName);
      for (const item of allItems) {
        let matchFound = false;
        const searchFields = fields.length > 0 ? fields : Object.keys(item);
        for (const field of searchFields) {
          if (item[field] && item[field].toString().toLowerCase().includes(queryLower)) {
            matchFound = true;
            break;
          }
        }
        if (matchFound) {
          results.push({
            store: storeName,
            item: item
          });
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  // ========== Password Hash ==========
  hashPassword(password) {
    // استخدم bcrypt أو argon2 في الإنتاج الفعلي
    return btoa(unescape(encodeURIComponent(password)));
  }

  // ========== Sync/Backup ========== //
  initSync() {
    window.addEventListener('online', () => this.processSyncQueue && this.processSyncQueue());
  }
  async processSyncQueue() { /* ممكن إضافة مزامنة حقيقية لاحقاً */ }

  async createBackup() {
    const stores = [
      'users', 'rooms', 'baies', 'equipments', 'screens',
      'screen_issues', 'attachments', 'settings', 'tickets',
      'logs', 'notifications', 'screen_groups', 'diagnosis_history'
    ];
    const backup = {};
    for (const name of stores) {
      backup[name] = await this.getAll(name);
    }
    return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  }
  async restoreBackup(backupObj) {
    if (!backupObj) return;
    await this.clearDatabase();
    for (const [storeName, items] of Object.entries(backupObj)) {
      for (const item of items) {
        await this.save(storeName, item);
      }
    }
    return true;
  }
  async clearDatabase() {
    for (const name of this.db.objectStoreNames) {
      const all = await this.getAll(name);
      for (const item of all) await this.delete(name, item.id);
    }
  }

  // ========== Images ========== //
  async saveImage(storeName, entityId, imageFile) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          const result = await this.save('attachments', {
            entityType: storeName,
            entityId: entityId,
            data: event.target.result,
            isImage: true,
            mimeType: imageFile.type,
            name: imageFile.name,
            size: imageFile.size,
            uploadedAt: new Date()
          });
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(imageFile);
    });
  }
  async getImages(storeName, entityId) {
    return this.getAll('attachments').then(all =>
      all.filter(item => item.entityType === storeName && item.entityId === entityId && item.isImage)
    );
  }
}


const dbInstance = new Database();
export const db = dbInstance;

// أو بدلاً من ذلك يمكنك استخدام:
// export const db = Database.getInstance();