'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/',  auth, (req, res) => res.json(db.getDeliveryProviders(req.user.id)));

router.post('/', auth, (req, res) => {
  db.upsertDeliveryProvider({ ...req.body, userId: req.user.id });
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Delivery provider saved: ${req.body.name}`, details: '', type: 'delivery', severity: 'info' });
  res.json({ ok: true, providers: db.getDeliveryProviders(req.user.id) });
});

router.delete('/:id', auth, (req, res) => {
  db.deleteDeliveryProvider(req.params.id);
  res.json({ ok: true });
});

// Simulate delivery creation (placeholder for Playwright)
router.post('/simulate/:orderId', auth, (req, res) => {
  const order = db.getOrder(req.params.orderId);
  if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  const providers = db.getDeliveryProviders(req.user.id).filter(p => p.enabled);
  if (!providers.length) return res.status(400).json({ error: 'No delivery provider configured' });
  const prov = providers[0];
  const tracking = `TRK-${Math.floor(Math.random() * 900000 + 100000)}`;
  db.updateOrder(order.id, { status: 'processing', trackingNumber: tracking, deliveryProvider: prov.name });
  db.addLog({ userId: req.user.id, user: 'System', action: `Delivery created: ${order.id}`, details: `${prov.name} — ${tracking}`, type: 'delivery', severity: 'success' });
  res.json({ success: true, tracking, provider: prov.name, orderUrl: prov.addOrderPage || prov.websiteUrl });
});

module.exports = router;
