'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => {
  res.json(db.getLoyaltyAll(req.user.id));
});

router.get('/:customerId', auth, (req, res) => {
  const loyalty = db.getLoyalty(req.user.id, req.params.customerId);
  res.json(loyalty || { points: 0, totalEarned: 0, tier: 'silver' });
});

router.post('/add', auth, (req, res) => {
  const { customerId, amount } = req.body;
  if (!customerId || !amount) return res.status(400).json({ error: 'customerId and amount required' });
  db.addLoyaltyPoints(req.user.id, customerId, amount);
  const loyalty = db.getLoyalty(req.user.id, customerId);
  res.json(loyalty || { points: 0, totalEarned: 0, tier: 'silver' });
});

module.exports = router;
