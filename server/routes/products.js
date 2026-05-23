'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => res.json(db.getProducts(req.user.id)));

router.post('/', auth, (req, res) => {
  const { name, price } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'Name and price are required' });
  const settings = db.getSettings(req.user.id) || {};
  const count    = db.getProducts(req.user.id).length;
  const sku      = settings.products?.autoSku
    ? `${settings.products.skuPrefix || 'PRD'}-${String(count + 1).padStart(3,'0')}`
    : req.body.sku || '';
  const product = db.createProduct({ ...req.body, sku, userId: req.user.id, price: +req.body.price, cost: +(req.body.cost || 0), stock: +(req.body.stock || 0) });
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Added product: ${name}`, details: `${product.price} ${settings.brand?.currency || 'MAD'}`, type: 'product', severity: 'success' });
  db.addNotification({ userId: req.user.id, type: 'success', message: `✅ تمت إضافة المنتج: ${name}` });
  req.app.get('broadcast')?.(req.user.id, { event: 'product_added', data: product });
  res.status(201).json(product);
});

router.get('/:id', auth, (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

router.put('/:id', auth, (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const updated = db.updateProduct(req.params.id, req.body);
  req.app.get('broadcast')?.(req.user.id, { event: 'product_updated', data: updated });
  res.json(updated);
});

router.delete('/:id', auth, (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.deleteProduct(req.params.id);
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Deleted product: ${p.name}`, details: '', type: 'product', severity: 'warning' });
  req.app.get('broadcast')?.(req.user.id, { event: 'product_deleted', data: { id: req.params.id } });
  res.json({ success: true });
});

// Public catalog (no auth)
router.get('/public/catalog', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const products = db.getProducts(userId).filter(p => p.status === 'published' && p.stock > 0);
  const settings = db.getSettings(userId) || {};
  const deliveryCosts = settings.deliveryCosts || {};
  res.json({ products, brand: settings.brand || {}, deliveryCosts });
});

module.exports = router;
