#!/bin/bash
# ================================================================
# AI Commerce OS — Sahar Shop
# Package Script (Mac/Linux)
# ================================================================

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║     AI Commerce OS — Sahar Shop  Package Script      ║"
echo "╚═══════════════════════════════════════════════════════╝"

# Clean
echo ""
echo "[1/5] تنظيف..."
rm -rf AI-Commerce-OS-Build AI-Commerce-OS-Final.zip
mkdir -p AI-Commerce-OS-Build

# Build Frontend
echo ""
echo "[2/5] بناء الواجهة..."
npm run build

# Copy Frontend
echo ""
echo "[3/5] نسخ الواجهة..."
cp -r dist AI-Commerce-OS-Build/frontend

# Copy Backend
echo ""
echo "[4/5] نسخ الخلفية..."
mkdir -p AI-Commerce-OS-Build/backend
cp -r server AI-Commerce-OS-Build/backend/
cp server/.env.example AI-Commerce-OS-Build/backend/
cp server/package.json AI-Commerce-OS-Build/backend/

# Copy Source
echo ""
echo "[5/5] نسخ الكود المصدري..."
mkdir -p AI-Commerce-OS-Build/source-code
cp -r src AI-Commerce-OS-Build/source-code/
cp -r server AI-Commerce-OS-Build/source-code/
cp -r public AI-Commerce-OS-Build/source-code/
cp package.json vite.config.ts tsconfig.json index.html README.md AI-Commerce-OS-Build/source-code/

# ZIP
echo ""
echo "ضغط المشروع..."
zip -r AI-Commerce-OS-Final.zip AI-Commerce-OS-Build

SIZE=$(du -h AI-Commerce-OS-Final.zip | cut -f1)
echo ""
echo "✅ تم إنشاء: AI-Commerce-OS-Final.zip ($SIZE)"
echo ""
echo "📂 المحتويات:"
echo "  ├── frontend/     ← ملفات جاهزة للنشر"
echo "  ├── backend/      ← خادم Node.js"
echo "  └── source-code/  ← الكود المصدري"
