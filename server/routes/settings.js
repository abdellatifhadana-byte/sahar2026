'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => {
  const settings = db.getSettings(req.user.id);
  res.json(settings || {});
});

router.put('/', auth, (req, res) => {
  const existing = db.getSettings(req.user.id) || {};
  const merged = deepMerge(existing, req.body);
  db.saveSettings(req.user.id, merged);
  db.addLog({ userId: req.user.id, user: 'Manager', action: 'Settings updated', details: Object.keys(req.body).join(', '), type: 'settings', severity: 'info' });
  res.json(merged);
});

router.get('/logs', auth, (req, res) => {
  res.json(db.getLogs(req.user.id));
});

router.get('/notifications', auth, (req, res) => {
  res.json(db.getNotifications(req.user.id));
});

router.post('/notifications/read', auth, (req, res) => {
  db.markAllRead(req.user.id);
  res.json({ ok: true });
});

router.delete('/notifications', auth, (req, res) => {
  db.clearNotifications(req.user.id);
  res.json({ ok: true });
});

router.get('/templates', auth, (req, res) => {
  res.json(db.getTemplates(req.user.id));
});

router.put('/templates', auth, (req, res) => {
  db.saveTemplates(req.user.id, req.body);
  res.json({ ok: true });
});

// Export data
router.get('/export', auth, (req, res) => {
  const uid = req.user.id;
  const data = {
    exportedAt: new Date().toISOString(),
    products: db.getProducts(uid),
    orders: db.getOrders(uid),
    customers: db.getCustomers(uid),
    settings: db.getSettings(uid),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="commerce-export.json"');
  res.json(data);
});

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object') {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// QR Code for catalog
router.get('/qr', auth, (req, res) => {
  const settings = db.getSettings(req.user.id) || {};
  const baseUrl = process.env.PRODUCTION_URL || `http://localhost:${process.env.PORT||3001}`;
  const catalogUrl = `${baseUrl}/store/${req.user.id}`;
  // Return URL for frontend to render QR (using existing QRCode component)
  res.json({ url: catalogUrl, userId: req.user.id });
});

module.exports = router;
