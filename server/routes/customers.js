'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => res.json(db.getCustomers(req.user.id)));

router.post('/', auth, (req, res) => {
  const c = db.createCustomer({ ...req.body, userId: req.user.id });
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Customer added: ${c.name}`, details: c.phone, type: 'customer', severity: 'info' });
  res.status(201).json(c);
});

router.get('/:id', auth, (req, res) => {
  const c = db.getCustomer(req.params.id);
  if (!c || c.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.put('/:id', auth, (req, res) => {
  const c = db.getCustomer(req.params.id);
  if (!c || c.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateCustomer(req.params.id, req.body));
});

router.delete('/:id', auth, (req, res) => {
  const c = db.getCustomer(req.params.id);
  if (!c || c.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  // Soft delete — just note in logs
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Customer removed: ${c.name}`, details: c.phone, type: 'customer', severity: 'warning' });
  res.json({ success: true });
});

module.exports = router;
