'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// POST /api/media/upload  (multipart)
router.post('/upload', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/api/media/files/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

// POST /api/media/upload-base64  (base64 string)
router.post('/upload-base64', auth, (req, res) => {
  const { data, ext = 'jpg' } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });
  const base64 = data.replace(/^data:image\/\w+;base64,/, '');
  const filename = `${req.user.id}-${Date.now()}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  try {
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    res.json({ url: `/api/media/files/${filename}`, filename });
  } catch (e) { res.status(500).json({ error: 'Failed to save image' }); }
});

// Serve uploaded files
router.get('/files/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).send('Not found');
  res.sendFile(fp);
});

module.exports = router;
