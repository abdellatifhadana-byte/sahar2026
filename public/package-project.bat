@echo off
title AI Commerce OS - Package Script
color 0A

echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║     AI Commerce OS - Sahar Shop  Package Script      ║
echo ╚═══════════════════════════════════════════════════════╝

echo.
echo [1/5] تنظيف...
if exist AI-Commerce-OS-Build rmdir /s /q AI-Commerce-OS-Build
if exist AI-Commerce-OS-Final.zip del AI-Commerce-OS-Final.zip
mkdir AI-Commerce-OS-Build

echo.
echo [2/5] بناء الواجهة...
call npm run build

echo.
echo [3/5] نسخ الواجهة...
xcopy /E /I /Y dist AI-Commerce-OS-Build\frontend

echo.
echo [4/5] نسخ الخلفية...
mkdir AI-Commerce-OS-Build\backend
xcopy /E /I /Y server AI-Commerce-OS-Build\backend\server
copy server\.env.example AI-Commerce-OS-Build\backend\
copy server\package.json AI-Commerce-OS-Build\backend\

echo.
echo [5/5] نسخ الكود المصدري...
mkdir AI-Commerce-OS-Build\source-code
xcopy /E /I /Y src AI-Commerce-OS-Build\source-code\src
xcopy /E /I /Y server AI-Commerce-OS-Build\source-code\server
xcopy /E /I /Y public AI-Commerce-OS-Build\source-code\public
copy package.json AI-Commerce-OS-Build\source-code\
copy vite.config.ts AI-Commerce-OS-Build\source-code\
copy tsconfig.json AI-Commerce-OS-Build\source-code\
copy index.html AI-Commerce-OS-Build\source-code\
copy README.md AI-Commerce-OS-Build\source-code\

echo.
echo ضغط المشروع...
powershell -Command "Compress-Archive -Path 'AI-Commerce-OS-Build' -DestinationPath 'AI-Commerce-OS-Final.zip' -Force"

echo.
echo ✅ تم إنشاء: AI-Commerce-OS-Final.zip
echo.
echo 📂 المحتويات:
echo   ├── frontend/     ← ملفات جاهزة للنشر
echo   ├── backend/      ← خادم Node.js
echo   └── source-code/  ← الكود المصدري
echo.
pause
