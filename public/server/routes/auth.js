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


// In-memory OTP store (in production use Redis)
const otpStore = new Map(); // email -> { code, expires }

// POST /api/auth/request-otp — send OTP for 2FA
router.post('/request-otp', auth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  otpStore.set(user.email, { code, expires });
  
  // In production: send via email/SMS
  // For now: return in response (development mode)
  const isDev = process.env.NODE_ENV !== 'production';
  console.log(`[2FA] OTP for ${user.email}: ${code}`);
  
  res.json({ 
    sent: true, 
    email: user.email.replace(/(.{2}).*(@)/, '$1***$2'),
    ...(isDev ? { code } : {}) // Show code in dev mode only
  });
});

// POST /api/auth/verify-otp — verify OTP
router.post('/verify-otp', auth, (req, res) => {
  const { code } = req.body;
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const stored = otpStore.get(user.email);
  if (!stored) return res.status(400).json({ error: 'لم يتم طلب رمز التحقق' });
  if (Date.now() > stored.expires) { otpStore.delete(user.email); return res.status(400).json({ error: 'انتهت صلاحية الرمز — اطلب رمزاً جديداً' }); }
  if (stored.code !== code) return res.status(400).json({ error: 'رمز غير صحيح' });
  
  otpStore.delete(user.email);
  res.json({ verified: true, message: 'تم التحقق بنجاح' });
});

// POST /api/auth/change-password — change password (requires old password)
router.post('/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'كلا الحقلين مطلوبان' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  
  const hashed = await bcrypt.hash(newPassword, 10);
  db.updateUserPassword(req.user.id, hashed);
  res.json({ success: true, message: 'تم تغيير كلمة المرور' });
});

module.exports = router;
