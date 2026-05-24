'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { db } = require('../database');

router.get('/', auth, (req, res) => {
  const uid      = req.user.id;
  const products = db.getProducts(uid);
  const orders   = db.getOrders(uid);
  const customers= db.getCustomers(uid);
  const settings = db.getSettings(uid) || {};
  const currency = settings.brand?.currency || 'MAD';

  const active  = orders.filter(o => o.status !== 'cancelled');
  const revenue = active.reduce((s, o) => s + (o.total || 0), 0);
  const cost    = active.reduce((s, o) => s + (o.items || []).reduce((sum, item) => {
    const p = products.find(x => x.id === item.productId);
    return sum + (p?.cost || 0) * (item.quantity || 1);
  }, 0), 0);

  // Last 12 months
  const now = new Date();
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const label = d.toLocaleString('ar', { month: 'short' });
    const mo = active.filter(o => {
      const od = new Date(o.createdAt);
      return od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
    });
    return { label, revenue: mo.reduce((s,o) => s + (o.total||0), 0), count: mo.length };
  });

  // Top products by sales
  const topProducts = [...products].sort((a,b) => b.sales - a.sales).slice(0, 5);

  // Source distribution
  const sources = {};
  active.forEach(o => {
    if (!sources[o.source]) sources[o.source] = { orders: 0, revenue: 0 };
    sources[o.source].orders++;
    sources[o.source].revenue += (o.total || 0);
  });

  // Status distribution
  const statusDist = {};
  orders.forEach(o => { statusDist[o.status] = (statusDist[o.status] || 0) + 1; });

  // City distribution
  const cities = {};
  orders.forEach(o => {
    if (o.city) cities[o.city] = (cities[o.city] || 0) + 1;
  });
  const topCities = Object.entries(cities).sort(([,a],[,b]) => b-a).slice(0,5).map(([city,count]) => ({ city, count }));

  // Daily last 30 days
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split('T')[0];
    const dayOrders = active.filter(o => o.createdAt?.startsWith(dateStr));
    return { date: dateStr, revenue: dayOrders.reduce((s,o) => s+(o.total||0),0), count: dayOrders.length };
  });

  res.json({
    revenue, cost, profit: revenue - cost,
    totalOrders: orders.length, activeOrders: active.length,
    avgOrder: active.length ? Math.round(revenue / active.length) : 0,
    deliveryRate: orders.length ? Math.round((orders.filter(o=>o.status==='delivered').length / orders.length) * 100) : 0,
    totalCustomers: customers.length,
    vipCustomers: customers.filter(c=>c.vip).length,
    repeatCustomers: customers.filter(c=>c.totalOrders>=3).length,
    publishedProducts: products.filter(p=>p.status==='published').length,
    lowStock: products.filter(p=>p.stock>0 && p.stock<=5).length,
    outOfStock: products.filter(p=>p.stock===0).length,
    monthly, daily, topProducts, sources, statusDist, topCities, currency,
  });
});

module.exports = router;
