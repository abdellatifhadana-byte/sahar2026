@echo off
REM ============================================================
REM AI Commerce OS — Quick Start (Windows)
REM ============================================================
cd /d "%~dp0"
echo ==================================================
echo    AI Commerce OS - Starting up
echo ==================================================

IF NOT EXIST node_modules (
  echo [1/4] Installing frontend dependencies...
  call npm install
) ELSE (
  echo [1/4] Frontend deps already installed
)

IF NOT EXIST server\node_modules (
  echo [2/4] Installing backend dependencies...
  cd server && call npm install && cd ..
) ELSE (
  echo [2/4] Backend deps already installed
)

IF NOT EXIST server\.env (
  echo [3/4] Creating server\.env...
  copy server\.env.example server\.env
  echo    EDIT server\.env to set JWT_SECRET ^& API keys
)

echo [4/4] Building frontend...
call npm run build

echo.
echo Starting server at http://localhost:3001
echo Press Ctrl+C to stop
echo.
cd server && node index.js
