'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { db }  = require('../database');

const SECRET  = process.env.JWT_SECRET;
const EXPIRES = '30d';

if (!SECRET) {
  console.error('[Auth] ⚠️  JWT_SECRET not set in .env! Using insecure default — change before production.');
}
const _secret = SECRET || 'ai-commerce-default-secret-change-me-NOW';

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, _secret, { expiresIn: EXPIRES });
}
function safe(user) { const { password: _, ...rest } = user; return rest; }

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, storeName } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (db.getUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

    const user = db.createUser({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: await bcrypt.hash(password, 10),
      role: 'admin',
    });

    const { defaultSettings } = require('../defaults');
    db.saveSettings(user.id, { ...defaultSettings, brand: { ...defaultSettings.brand, name: storeName || `${name}'s Store`, email: user.email } });
    db.addLog({ userId: user.id, user: 'System', action: 'Account registered', details: user.email, type: 'auth', severity: 'info' });

    res.status(201).json({ token: sign(user), user: safe(user) });
  } catch (e) { console.error('[Auth register]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = db.getUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    db.addLog({ userId: user.id, user: user.name, action: 'Login', details: '', type: 'auth', severity: 'info' });
    res.json({ token: sign(user), user: safe(user) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safe(user) });
});

// POST /api/auth/change-password
router.post('/change-password', require('../middleware/auth'), async (req, res) => {
  try {
    const { current, next } = req.body;
    if (!current || !next) return res.status(400).json({ error: 'Current and new password required' });
    if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const user = db.getUser(req.user.id);
    if (!user || !(await bcrypt.compare(current, user.password))) return res.status(401).json({ error: 'Current password incorrect' });
    db.updateUser(req.user.id, { password: await bcrypt.hash(next, 10) });
    db.addLog({ userId: req.user.id, user: user.name, action: 'Password changed', details: '', type: 'auth', severity: 'info' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
