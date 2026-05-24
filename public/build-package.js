#!/usr/bin/env node
/**
 * ================================================================
 * AI Commerce OS — Sahar Shop
 * Build & Package Script
 * ================================================================
 * هذا السكريبت يقوم بـ:
 * 1. بناء الواجهة الأمامية (Frontend Build)
 * 2. تجهيز الخلفية (Backend)
 * 3. جمع كل الصور والأصول
 * 4. ضغط المشروع في ملف ZIP جاهز للتوزيع
 * ================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

const PROJECT_ROOT = process.cwd();
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const BUILD_DIR = path.join(PROJECT_ROOT, 'AI-Commerce-OS-Build');
const ZIP_FILE = path.join(PROJECT_ROOT, 'AI-Commerce-OS-Final.zip');

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function step(num, total, msg) {
  log(`\n[${num}/${total}] ${msg}`, 'cyan');
  log('─'.repeat(60), 'blue');
}

// ── Main Build Function ───────────────────────────────────────
async function main() {
  log('\n╔═══════════════════════════════════════════════════════╗', 'green');
  log('║     AI Commerce OS — Sahar Shop  Build Script        ║', 'green');
  log('╚═══════════════════════════════════════════════════════╝', 'green');

  try {
    // Step 1: Clean previous builds
    step(1, 6, 'تنظيف الملفات السابقة...');
    if (fs.existsSync(BUILD_DIR)) fs.rmSync(BUILD_DIR, { recursive: true });
    if (fs.existsSync(ZIP_FILE)) fs.unlinkSync(ZIP_FILE);
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    log('✅ تم التنظيف', 'green');

    // Step 2: Build Frontend
    step(2, 6, 'بناء الواجهة الأمامية (React + Vite)...');
    log('⏳ جارٍ البناء...', 'yellow');
    execSync('npm run build', { stdio: 'inherit', cwd: PROJECT_ROOT });
    log('✅ تم بناء الواجهة بنجاح', 'green');

    // Step 3: Copy Frontend dist
    step(3, 6, 'نسخ ملفات الواجهة...');
    const frontendDir = path.join(BUILD_DIR, 'frontend');
    fs.mkdirSync(frontendDir, { recursive: true });
    copyDir(DIST_DIR, frontendDir);
    log(`✅ تم نسخ ${countFiles(frontendDir)} ملف`, 'green');

    // Step 4: Copy Backend
    step(4, 6, 'نسخ ملفات الخلفية (Node.js)...');
    const backendDir = path.join(BUILD_DIR, 'backend');
    fs.mkdirSync(backendDir, { recursive: true });
    copyDir(path.join(PROJECT_ROOT, 'server'), path.join(backendDir, 'server'));
    // Copy package.json for backend
    const backendPkg = {
      name: 'ai-commerce-backend',
      version: '1.0.0',
      description: 'Sahar Shop Backend Server',
      main: 'server/index.js',
      scripts: { start: 'node server/index.js', dev: 'node server/index.js' },
      dependencies: {
        express: '^4.18.2',
        cors: '^2.8.5',
        'express-rate-limit': '^7.1.5',
        jsonwebtoken: '^9.0.2',
        bcryptjs: '^2.4.3',
        multer: '^1.4.5-lts.1',
        ws: '^8.16.0',
      },
    };
    fs.writeFileSync(path.join(backendDir, 'package.json'), JSON.stringify(backendPkg, null, 2));
    fs.writeFileSync(path.join(backendDir, '.env.example'), fs.readFileSync(path.join(PROJECT_ROOT, 'server', '.env.example'), 'utf8'));
    fs.writeFileSync(path.join(backendDir, 'README.md'), `# Sahar Shop Backend\n\nnpm install\nnode server/index.js\n`);
    log('✅ تم نسخ الخلفية', 'green');

    // Step 5: Copy Source Code
    step(5, 6, 'نسخ الكود المصدري...');
    const srcDir = path.join(BUILD_DIR, 'source-code');
    fs.mkdirSync(srcDir, { recursive: true });
    copyDir(path.join(PROJECT_ROOT, 'src'), path.join(srcDir, 'src'));
    copyDir(path.join(PROJECT_ROOT, 'server'), path.join(srcDir, 'server'));
    copyDir(path.join(PROJECT_ROOT, 'public'), path.join(srcDir, 'public'));
    fs.copyFileSync(path.join(PROJECT_ROOT, 'package.json'), path.join(srcDir, 'package.json'));
    fs.copyFileSync(path.join(PROJECT_ROOT, 'vite.config.ts'), path.join(srcDir, 'vite.config.ts'));
    fs.copyFileSync(path.join(PROJECT_ROOT, 'tsconfig.json'), path.join(srcDir, 'tsconfig.json'));
    fs.copyFileSync(path.join(PROJECT_ROOT, 'index.html'), path.join(srcDir, 'index.html'));
    fs.copyFileSync(path.join(PROJECT_ROOT, 'README.md'), path.join(srcDir, 'README.md'));
    log('✅ تم نسخ الكود المصدري', 'green');

    // Step 6: Create ZIP
    step(6, 6, 'ضغط المشروع في ملف ZIP...');
    await createZip(BUILD_DIR, ZIP_FILE);
    const zipSize = (fs.statSync(ZIP_FILE).size / (1024 * 1024)).toFixed(2);
    log(`✅ تم إنشاء الملف: AI-Commerce-OS-Final.zip (${zipSize} MB)`, 'green');

    // Summary
    log('\n╔═══════════════════════════════════════════════════════╗', 'green');
    log('║              ✅ اكتمل البناء بنجاح!                  ║', 'green');
    log('╚═══════════════════════════════════════════════════════╝', 'green');
    log(`\n📦 الملف جاهز: ${ZIP_FILE}`, 'cyan');
    log(`📁 حجم الملف: ${zipSize} MB`, 'cyan');
    log('\n📂 محتويات الحزمة:', 'blue');
    log('  ├── frontend/          ← ملفات الواجهة الجاهزة للنشر', 'yellow');
    log('  ├── backend/           ← خادم Node.js + server/', 'yellow');
    log('  └── source-code/       ← الكود المصدري الكامل', 'yellow');
    log('\n🚀 للتشغيل:', 'blue');
    log('  Frontend:  افتح frontend/index.html في المتصفح', 'yellow');
    log('  Backend:   cd backend && npm install && npm start', 'yellow');

  } catch (error) {
    log(`\n❌ خطأ: ${error.message}`, 'red');
    process.exit(1);
  }
}

// ── Helper Functions ──────────────────────────────────────────

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count++;
  }
  return count;
}

function createZip(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      log(`📦 تم ضغط ${archive.pointer() / (1024 * 1024)} MB`, 'green');
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, 'AI-Commerce-OS-Final');
    archive.finalize();
  });
}

// ── Run ───────────────────────────────────────────────────────
main();
