'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => res.json(db.getOrders(req.user.id)));

router.post('/', auth, (req, res) => {
  const order = db.createOrder({ ...req.body, userId: req.user.id, status: 'pending' });
  db.addLog({ userId: req.user.id, user: 'AI', action: `New order: ${order.id}`, details: order.customerName, type: 'order', severity: 'info' });
  db.addNotification({ userId: req.user.id, type: 'info', message: `🛒 طلب جديد من ${order.customerName}` });
  req.app.get('broadcast')?.(req.user.id, { event: 'order_created', data: order });
  res.status(201).json(order);
});

router.get('/:id', auth, (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(o);
});

router.put('/:id', auth, (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateOrder(o.id, req.body));
});

router.put('/:id/approve', auth, (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  db.updateOrder(order.id, { status: 'approved' });

  // Update customer stats
  if (order.customerId) {
    const customer = db.getCustomer(order.customerId);
    if (customer) db.updateCustomer(order.customerId, {
      totalOrders: (customer.totalOrders || 0) + 1,
      totalSpent: (customer.totalSpent || 0) + (order.total || 0),
      lastOrderDate: new Date().toISOString().split('T')[0],
    });
  }

  // Reduce stock
  (order.items || []).forEach(item => {
    if (!item.productId) return;
    const p = db.getProduct(item.productId);
    if (p) db.updateProduct(p.id, {
      stock: Math.max(0, (p.stock || 0) - (item.quantity || 1)),
      sales: (p.sales || 0) + (item.quantity || 1),
    });
  });

  // Auto-delivery
  const settings = db.getSettings(req.user.id) || {};
  const providers = db.getDeliveryProviders(req.user.id).filter(p => p.enabled);
  if (settings.delivery?.autoSendOnApproval && providers.length > 0) {
    const prov = providers[0];
    const tracking = `TRK-${Math.floor(Math.random() * 900000 + 100000)}`;
    db.updateOrder(order.id, { status: 'processing', deliveryProvider: prov.name, trackingNumber: tracking });
    db.addLog({ userId: req.user.id, user: 'System', action: `Sent to delivery: ${order.id}`, details: `${prov.name} — ${tracking}`, type: 'delivery', severity: 'info' });
  }

  // Add loyalty points to customer
  if (order.customerId && order.total > 0) {
    try { db.addLoyaltyPoints(req.user.id, order.customerId, order.total); } catch(e) {}
  }
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Approved order: ${order.id}`, details: order.customerName, type: 'order', severity: 'success' });
  db.addNotification({ userId: req.user.id, type: 'success', message: `✅ تم تأكيد طلب ${order.customerName}` });
  // Try to send WhatsApp confirmation to customer (non-blocking)
  const approveSettings = db.getSettings(req.user.id) || {};
  const waToken = approveSettings.social?.whatsapp?.accessToken;
  const waPhoneId = approveSettings.social?.whatsapp?.pageId;
  const refreshedOrder = db.getOrder(order.id);
  if (waToken && waPhoneId && refreshedOrder?.customerPhone) {
    try {
      const cur = approveSettings.brand?.currency || 'MAD';
      const items = (refreshedOrder.items||[]).map(i=>`• ${i.productName} x${i.quantity||1}`).join('\n');
      const msg = `مرحباً ${refreshedOrder.customerName}! 👋\n\n✅ تم تأكيد طلبك!\n\n${items}\n\n💰 الإجمالي: ${refreshedOrder.total} ${cur}\n🚚 سيتم الشحن قريباً — 24-48 ساعة\n\nشكراً لثقتك! 🙏`;
      const body = JSON.stringify({ messaging_product:'whatsapp', to:refreshedOrder.customerPhone.replace(/\s/g,''), type:'text', text:{ body:msg } });
      const https2 = require('https');
      const r2 = https2.request({ hostname:'graph.facebook.com', path:`/v19.0/${waPhoneId}/messages`, method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${waToken}`, 'Content-Length':Buffer.byteLength(body) } }, res=>res.resume());
      r2.on('error',()=>{}); r2.write(body); r2.end();
    } catch {}
  }
  req.app.get('broadcast')?.(req.user.id, { event: 'order_updated', data: db.getOrder(order.id) });
  res.json(db.getOrder(order.id));
});

router.put('/:id/reject', auth, (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.updateOrder(o.id, { status: 'cancelled' });
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Rejected order: ${o.id}`, details: req.body.reason || '', type: 'order', severity: 'error' });
  req.app.get('broadcast')?.(req.user.id, { event: 'order_updated', data: db.getOrder(o.id) });
  res.json(db.getOrder(o.id));
});

router.put('/:id/ship', auth, (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const tracking = req.body.trackingNumber || `TRK-${Math.floor(Math.random() * 900000 + 100000)}`;
  const prov = req.body.provider || db.getSettings(req.user.id)?.delivery?.defaultProvider || 'Amana';
  db.updateOrder(o.id, { status: 'shipped', trackingNumber: tracking, deliveryProvider: prov });
  db.addLog({ userId: req.user.id, user: 'Manager', action: `Shipped: ${o.id}`, details: tracking, type: 'delivery', severity: 'success' });
  db.addNotification({ userId: req.user.id, type: 'success', message: `🚚 Shipped — ${tracking}` });
  // Notify customer via WhatsApp
  const shipSettings2 = db.getSettings(req.user.id) || {};
  const shipWaToken = shipSettings2.social?.whatsapp?.accessToken;
  const shipWaPhoneId = shipSettings2.social?.whatsapp?.pageId;
  const shippedOrder = db.getOrder(o.id);
  if (shipWaToken && shipWaPhoneId && shippedOrder?.customerPhone) {
    try {
      const shipCur = shipSettings2.brand?.currency || 'MAD';
      const trackUrl = shipSettings.delivery?.trackingUrlTemplate ? shipSettings2.delivery.trackingUrlTemplate.replace('{tracking}', tracking) : '';
      const shipMsg = `مرحباً ${shippedOrder.customerName}! 👋\n\n🚚 طلبك في الطريق إليك!\n\n📦 رقم التتبع: ${tracking}\n🏢 شركة التوصيل: ${prov}\n⏱️ متوقع الوصول خلال: 24-48 ساعة\n${trackUrl ? `\n🔗 تتبع طلبك: ${trackUrl}` : ''}\n\nشكراً لثقتك! 🙏`;
      const shipBody = JSON.stringify({ messaging_product:'whatsapp', to:shippedOrder.customerPhone.replace(/\s/g,''), type:'text', text:{ body:shipMsg } });
      const https3 = require('https');
      const r3 = https3.request({ hostname:'graph.facebook.com', path:`/v19.0/${shipWaPhoneId}/messages`, method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${shipWaToken}`, 'Content-Length':Buffer.byteLength(shipBody) } }, res=>res.resume());
      r3.on('error',()=>{}); r3.write(shipBody); r3.end();
    } catch {}
  }
  req.app.get('broadcast')?.(req.user.id, { event: 'order_updated', data: db.getOrder(o.id) });
  res.json(db.getOrder(o.id));
});

router.put('/:id/deliver', auth, (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.updateOrder(o.id, { status: 'delivered' });
  db.addLog({ userId: req.user.id, user: 'System', action: `Delivered: ${o.id}`, details: o.customerName, type: 'order', severity: 'success' });
  req.app.get('broadcast')?.(req.user.id, { event: 'order_updated', data: db.getOrder(o.id) });
  res.json(db.getOrder(o.id));
});

// POST /api/orders/public — create order from storefront (no auth)
router.post('/public', async (req, res) => {
  const { userId, items, customerName, customerPhone, city, address, notes, total, source } = req.body;
  if (!userId || !items?.length || !customerName || !customerPhone)
    return res.status(400).json({ error: 'userId, items, name, phone required' });
  try {
    const order = db.createOrder({
      userId, customerName, customerPhone, city: city||'', address: address||'',
      items, total: +total||0, source: source||'Storefront',
      status: 'pending', notes: notes||'',
    });
    db.addNotification({ userId, type: 'info', message: `🛒 طلب جديد من ${customerName} — ${order.total} MAD` });
    db.addLog({ userId, user: 'Storefront', action: `New order: ${customerName}`, details: `${city} — ${total} MAD`, type: 'order', severity: 'info' });

    // Find/create customer
    const customers = db.getCustomers(userId);
    let customer = customers.find(c => c.phone === customerPhone);
    if (!customer) {
      customer = db.createCustomer({ userId, name: customerName, phone: customerPhone, city: city||'', address: address||'', source: source||'Storefront' });
    } else {
      db.updateCustomer(customer.id, { lastOrderDate: new Date().toISOString().split('T')[0] });
    }

    res.status(201).json({ order, customerId: customer.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/track/:phone — track order by phone (public)
router.get('/track/:phone', async (req, res) => {
  const { phone } = req.params;
  const { userId } = req.query;
  if (!phone || !userId) return res.status(400).json({ error: 'phone and userId required' });
  try {
    const orders = db.getOrders(userId).filter(o =>
      o.customerPhone?.replace(/\D/g,'').includes(phone.replace(/\D/g,''))
    );
    res.json(orders.map(o => ({
      id: o.id, status: o.status, total: o.total,
      trackingNumber: o.trackingNumber, deliveryProvider: o.deliveryProvider,
      createdAt: o.createdAt, items: o.items,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
