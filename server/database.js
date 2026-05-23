'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'commerce.db');
const sqlite = new Database(dbPath);

// ── Performance pragmas ───────────────────────────────────────
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    userId TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    cost REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    category TEXT DEFAULT '',
    sizes TEXT DEFAULT '[]',
    colors TEXT DEFAULT '[]',
    status TEXT DEFAULT 'draft',
    emoji TEXT DEFAULT '📦',
    imageUrl TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    isForChildren INTEGER DEFAULT 0,
    ageRange TEXT DEFAULT '',
    views INTEGER DEFAULT 0,
    sales INTEGER DEFAULT 0,
    sku TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    totalOrders INTEGER DEFAULT 0,
    totalSpent REAL DEFAULT 0,
    lastOrderDate TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    notes TEXT DEFAULT '',
    vip INTEGER DEFAULT 0,
    trustScore INTEGER DEFAULT 80,
    buyerScore INTEGER DEFAULT 50,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    customerId TEXT DEFAULT '',
    customerName TEXT NOT NULL,
    customerPhone TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'manual',
    deliveryProvider TEXT DEFAULT '',
    trackingNumber TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    needsReview INTEGER DEFAULT 0,
    reviewReason TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    customerId TEXT DEFAULT '',
    customerName TEXT NOT NULL,
    customerPhone TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'active',
    lastMessage TEXT DEFAULT '',
    messages TEXT DEFAULT '[]',
    unread INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'medium',
    mood TEXT DEFAULT 'neutral',
    pinned INTEGER DEFAULT 0,
    label TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    user TEXT DEFAULT 'System',
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    type TEXT DEFAULT 'info',
    severity TEXT DEFAULT 'info',
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    read INTEGER DEFAULT 0,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS delivery_providers (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    websiteUrl TEXT DEFAULT '',
    addOrderPage TEXT DEFAULT '',
    trackingUrl TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    message TEXT NOT NULL,
    target TEXT DEFAULT 'all',
    sentTo INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    type TEXT DEFAULT 'custom',
    simulated INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS templates (
    userId TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── ID generator ──────────────────────────────────────────────
function uid() { return crypto.randomBytes(8).toString('hex'); }
function now() { return new Date().toISOString(); }

// ── Flat DB API (matches what all routes expect) ──────────────
const db = {
  // ── Users ────────────────────────────────────────────────────
  getUser(id) {
    return sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  },
  getUserByEmail(email) {
    return sqlite.prepare('SELECT * FROM users WHERE email = ?').get((email||'').toLowerCase()) || null;
  },
  listUsers() {
    return sqlite.prepare('SELECT * FROM users').all();
  },
  createUser({ name, email, password, role = 'admin' }) {
    const user = { id: uid(), name: name.trim(), email: email.toLowerCase().trim(), password, role, createdAt: now() };
    sqlite.prepare('INSERT INTO users (id, name, email, password, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.email, user.password, user.role, user.createdAt);
    return user;
  },
  updateUser(id, u) {
    const allowed = ['name', 'email', 'password', 'role'];
    const parts = []; const vals = [];
    for (const k of allowed) {
      if (u[k] !== undefined) { parts.push(`${k} = ?`); vals.push(u[k]); }
    }
    if (!parts.length) return;
    vals.push(id);
    sqlite.prepare(`UPDATE users SET ${parts.join(', ')} WHERE id = ?`).run(...vals);
  },

  // ── Settings ─────────────────────────────────────────────────
  getSettings(userId) {
    const row = sqlite.prepare('SELECT data FROM settings WHERE userId = ?').get(userId);
    return row ? JSON.parse(row.data) : null;
  },
  saveSettings(userId, data) {
    const json = JSON.stringify(data);
    sqlite.prepare('INSERT OR REPLACE INTO settings (userId, data, updatedAt) VALUES (?, ?, ?)').run(userId, json, now());
    return data;
  },

  // ── Products ─────────────────────────────────────────────────
  getProducts(userId) {
    return sqlite.prepare('SELECT * FROM products WHERE userId = ? ORDER BY createdAt DESC').all(userId).map(_parseProduct);
  },
  getProduct(id) {
    const p = sqlite.prepare('SELECT * FROM products WHERE id = ?').get(id);
    return p ? _parseProduct(p) : null;
  },
  createProduct(p) {
    const id = p.id || uid();
    const product = { id, userId: p.userId, name: p.name, description: p.description||'', price: +p.price||0, cost: +(p.cost||0), stock: +(p.stock||0), category: p.category||'', sizes: JSON.stringify(p.sizes||[]), colors: JSON.stringify(p.colors||[]), status: p.status||'draft', emoji: p.emoji||'📦', imageUrl: p.imageUrl||'', images: JSON.stringify(p.images||[]), isForChildren: p.isForChildren?1:0, ageRange: p.ageRange||'', views: 0, sales: 0, sku: p.sku||id.slice(0,8).toUpperCase(), createdAt: p.createdAt||now() };
    sqlite.prepare(`INSERT INTO products (id,userId,name,description,price,cost,stock,category,sizes,colors,status,emoji,imageUrl,images,isForChildren,ageRange,views,sales,sku,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(product.id,product.userId,product.name,product.description,product.price,product.cost,product.stock,product.category,product.sizes,product.colors,product.status,product.emoji,product.imageUrl,product.images,product.isForChildren,product.ageRange,product.views,product.sales,product.sku,product.createdAt);
    return _parseProduct(product);
  },
  updateProduct(id, u) {
    const allowed = ['name','description','price','cost','stock','category','sizes','colors','status','emoji','imageUrl','images','isForChildren','ageRange','views','sales','sku'];
    _update('products', id, u, allowed);
    return this.getProduct(id);
  },
  deleteProduct(id) {
    sqlite.prepare('DELETE FROM products WHERE id = ?').run(id);
  },

  // ── Customers ────────────────────────────────────────────────
  getCustomers(userId) {
    return sqlite.prepare('SELECT * FROM customers WHERE userId = ? ORDER BY totalSpent DESC').all(userId).map(_parseCustomer);
  },
  getCustomer(id) {
    const c = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    return c ? _parseCustomer(c) : null;
  },
  createCustomer(c) {
    const customer = { id: uid(), userId: c.userId, name: c.name, phone: c.phone||'', city: c.city||'', address: c.address||'', source: c.source||'manual', notes: c.notes||'', vip: c.vip?1:0, trustScore: c.trustScore||80, buyerScore: c.buyerScore||50, totalOrders: 0, totalSpent: 0, lastOrderDate: '', createdAt: now() };
    sqlite.prepare(`INSERT INTO customers (id,userId,name,phone,city,address,source,notes,vip,trustScore,buyerScore,totalOrders,totalSpent,lastOrderDate,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(customer.id,customer.userId,customer.name,customer.phone,customer.city,customer.address,customer.source,customer.notes,customer.vip,customer.trustScore,customer.buyerScore,0,0,'',customer.createdAt);
    return _parseCustomer(customer);
  },
  updateCustomer(id, u) {
    const allowed = ['name','phone','city','address','source','notes','vip','trustScore','buyerScore','totalOrders','totalSpent','lastOrderDate'];
    _update('customers', id, u, allowed);
    return this.getCustomer(id);
  },

  // ── Orders ───────────────────────────────────────────────────
  getOrders(userId) {
    return sqlite.prepare('SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC').all(userId).map(_parseOrder);
  },
  getOrder(id) {
    const o = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    return o ? _parseOrder(o) : null;
  },
  createOrder(o) {
    const order = { id: uid(), userId: o.userId, customerId: o.customerId||'', customerName: o.customerName, customerPhone: o.customerPhone||'', city: o.city||'', address: o.address||'', items: JSON.stringify(o.items||[]), total: +o.total||0, status: o.status||'pending', source: o.source||'manual', deliveryProvider: '', trackingNumber: '', notes: o.notes||'', needsReview: 0, reviewReason: '', createdAt: now() };
    sqlite.prepare(`INSERT INTO orders (id,userId,customerId,customerName,customerPhone,city,address,items,total,status,source,deliveryProvider,trackingNumber,notes,needsReview,reviewReason,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id,order.userId,order.customerId,order.customerName,order.customerPhone,order.city,order.address,order.items,order.total,order.status,order.source,order.deliveryProvider,order.trackingNumber,order.notes,order.needsReview,order.reviewReason,order.createdAt);
    return _parseOrder(order);
  },
  updateOrder(id, u) {
    const allowed = ['customerId','customerName','customerPhone','city','address','items','total','status','source','deliveryProvider','trackingNumber','notes','needsReview','reviewReason'];
    _update('orders', id, u, allowed);
    return this.getOrder(id);
  },

  // ── Conversations ─────────────────────────────────────────────
  getConversations(userId) {
    return sqlite.prepare('SELECT * FROM conversations WHERE userId = ? ORDER BY createdAt DESC').all(userId).map(_parseConv);
  },
  getConversation(id) {
    const c = sqlite.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    return c ? _parseConv(c) : null;
  },
  createConversation(c) {
    const conv = { id: uid(), userId: c.userId, customerId: c.customerId||'', customerName: c.customerName, customerPhone: c.customerPhone||'', source: c.source||'manual', status: c.status||'active', lastMessage: c.lastMessage||'', messages: JSON.stringify(c.messages||[]), unread: c.unread||0, priority: c.priority||'medium', mood: c.mood||'neutral', pinned: c.pinned?1:0, label: c.label||'', createdAt: now() };
    sqlite.prepare(`INSERT INTO conversations (id,userId,customerId,customerName,customerPhone,source,status,lastMessage,messages,unread,priority,mood,pinned,label,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(conv.id,conv.userId,conv.customerId,conv.customerName,conv.customerPhone,conv.source,conv.status,conv.lastMessage,conv.messages,conv.unread,conv.priority,conv.mood,conv.pinned,conv.label,conv.createdAt);
    return _parseConv(conv);
  },
  updateConversation(id, u) {
    const allowed = ['customerId','customerName','customerPhone','source','status','lastMessage','messages','unread','priority','mood','pinned','label'];
    _update('conversations', id, u, allowed);
    return this.getConversation(id);
  },
  addMessage(convId, { content, role }) {
    const conv = this.getConversation(convId);
    if (!conv) return null;
    const msg = { id: uid(), content, role, timestamp: Date.now() };
    const messages = [...conv.messages, msg];
    this.updateConversation(convId, { messages, lastMessage: content, unread: role === 'customer' ? (conv.unread || 0) + 1 : conv.unread });
    return msg;
  },

  // ── Delivery providers ────────────────────────────────────────
  getDeliveryProviders(userId) {
    return sqlite.prepare('SELECT * FROM delivery_providers WHERE userId = ? ORDER BY name').all(userId).map(p => ({ ...p, enabled: !!p.enabled, cost: +p.cost }));
  },
  upsertDeliveryProvider(p) {
    const existing = p.id ? sqlite.prepare('SELECT id FROM delivery_providers WHERE id = ?').get(p.id) : null;
    if (existing) {
      sqlite.prepare(`UPDATE delivery_providers SET name=?,websiteUrl=?,addOrderPage=?,trackingUrl=?,phone=?,cost=?,enabled=? WHERE id=?`).run(p.name,p.websiteUrl||'',p.addOrderPage||'',p.trackingUrl||'',p.phone||'',+(p.cost||0),p.enabled?1:1,p.id);
    } else {
      const id = uid();
      sqlite.prepare(`INSERT INTO delivery_providers (id,userId,name,websiteUrl,addOrderPage,trackingUrl,phone,cost,enabled,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,p.userId,p.name,p.websiteUrl||'',p.addOrderPage||'',p.trackingUrl||'',p.phone||'',+(p.cost||0),1,now());
    }
  },
  deleteDeliveryProvider(id) {
    sqlite.prepare('DELETE FROM delivery_providers WHERE id = ?').run(id);
  },

  // ── Broadcasts ────────────────────────────────────────────────
  getBroadcasts(userId) {
    return sqlite.prepare('SELECT * FROM broadcasts WHERE userId = ? ORDER BY createdAt DESC LIMIT 100').all(userId).map(b => ({ ...b, simulated: !!b.simulated }));
  },
  saveBroadcast({ userId, message, target, sentTo, failed, type, simulated }) {
    sqlite.prepare(`INSERT INTO broadcasts (id,userId,message,target,sentTo,failed,type,simulated,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`).run(uid(),userId,message,target||'all',sentTo||0,failed||0,type||'custom',simulated?1:0,now());
  },

  // ── Templates ─────────────────────────────────────────────────
  getTemplates(userId) {
    const row = sqlite.prepare('SELECT data FROM templates WHERE userId = ?').get(userId);
    return row ? JSON.parse(row.data) : [];
  },
  saveTemplates(userId, data) {
    sqlite.prepare('INSERT OR REPLACE INTO templates (userId, data, updatedAt) VALUES (?, ?, ?)').run(userId, JSON.stringify(data), now());
  },

  // ── Logs ─────────────────────────────────────────────────────
  addLog({ userId, user = 'System', action, details = '', type = 'info', severity = 'info' }) {
    sqlite.prepare('INSERT INTO audit_logs (userId, timestamp, user, action, details, type, severity) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, now(), user, action, details, type, severity);
  },
  getLogs(userId) {
    return sqlite.prepare('SELECT * FROM audit_logs WHERE userId = ? ORDER BY id DESC LIMIT 500').all(userId);
  },

  // ── Notifications ─────────────────────────────────────────────
  getNotifications(userId) {
    return sqlite.prepare('SELECT * FROM notifications WHERE userId = ? ORDER BY timestamp DESC LIMIT 200').all(userId).map(n => ({ ...n, read: !!n.read }));
  },
  addNotification({ userId, type = 'info', message }) {
    sqlite.prepare('INSERT INTO notifications (id, userId, type, message, timestamp, read) VALUES (?, ?, ?, ?, ?, 0)').run(uid(), userId, type, message, Date.now());
  },
  markAllRead(userId) {
    sqlite.prepare('UPDATE notifications SET read = 1 WHERE userId = ?').run(userId);
  },
  clearNotifications(userId) {
    sqlite.prepare('DELETE FROM notifications WHERE userId = ?').run(userId);
  },
};

// ── Private helpers ───────────────────────────────────────────
function _update(table, id, u, allowed) {
  const parts = []; const vals = [];
  for (const k of allowed) {
    if (u[k] !== undefined) {
      parts.push(`${k} = ?`);
      const v = u[k];
      vals.push(Array.isArray(v) || (typeof v === 'object' && v !== null) ? JSON.stringify(v) : (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    }
  }
  if (!parts.length) return;
  vals.push(id);
  sqlite.prepare(`UPDATE ${table} SET ${parts.join(', ')} WHERE id = ?`).run(...vals);
}

function _parseProduct(p) {
  return { ...p, sizes: _json(p.sizes, []), colors: _json(p.colors, []), images: _json(p.images, []), isForChildren: !!p.isForChildren };
}
function _parseCustomer(c) { return { ...c, vip: !!c.vip }; }
function _parseOrder(o) { return { ...o, items: _json(o.items, []), needsReview: !!o.needsReview }; }
function _parseConv(c) { return { ...c, messages: _json(c.messages, []), pinned: !!c.pinned }; }
function _json(v, def) { try { return v ? JSON.parse(v) : def; } catch { return def; } }

// Also expose nested API for routes that use db.conversations.* (webhooks, conversations route)
db.users = { listUsers: () => db.listUsers(), get: (id) => db.getUser(id), getByEmail: (e) => db.getUserByEmail(e) };
db.settings = { get: (uid) => db.getSettings(uid), save: (uid, data) => db.saveSettings(uid, data) };
db.products = { list: (uid) => db.getProducts(uid), get: (id) => db.getProduct(id) };
db.conversations = {
  list: (uid) => db.getConversations(uid),
  get: (id) => db.getConversation(id),
  create: (c) => db.createConversation(c),
  addMessage: (id, msg) => db.addMessage(id, msg),
};
db.notifications = { add: (n) => db.addNotification(n) };

module.exports = { db };

// ── LOYALTY SYSTEM (new — appended) ──────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS loyalty_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    customerId TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    totalEarned INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'silver',
    updatedAt TEXT NOT NULL,
    UNIQUE(userId, customerId),
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.getLoyalty = function(userId, customerId) {
  return sqlite.prepare('SELECT * FROM loyalty_points WHERE userId=? AND customerId=?').get(userId, customerId) || null;
};
db.getLoyaltyAll = function(userId) {
  return sqlite.prepare('SELECT * FROM loyalty_points WHERE userId=? ORDER BY totalEarned DESC').all(userId);
};
db.addLoyaltyPoints = function(userId, customerId, amount) {
  const pts = Math.floor(amount / 10); // 10 MAD = 1 point
  if (pts <= 0) return;
  const existing = db.getLoyalty(userId, customerId);
  if (existing) {
    const newTotal = (existing.totalEarned||0) + pts;
    const tier = newTotal >= 5000 ? 'diamond' : newTotal >= 2000 ? 'gold' : 'silver';
    sqlite.prepare('UPDATE loyalty_points SET points=points+?, totalEarned=totalEarned+?, tier=?, updatedAt=? WHERE userId=? AND customerId=?')
      .run(pts, pts, tier, new Date().toISOString(), userId, customerId);
  } else {
    const tier = pts >= 5000 ? 'diamond' : pts >= 2000 ? 'gold' : 'silver';
    sqlite.prepare('INSERT INTO loyalty_points (userId,customerId,points,totalEarned,tier,updatedAt) VALUES (?,?,?,?,?,?)')
      .run(userId, customerId, pts, pts, tier, new Date().toISOString());
  }
};
