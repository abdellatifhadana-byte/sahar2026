#!/usr/bin/env bash
# ============================================================
# AI Commerce OS — Quick Start Script
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=================================================="
echo "   AI Commerce OS — Starting up"
echo "=================================================="

# 1. Frontend dependencies
if [ ! -d "node_modules" ]; then
  echo "[1/4] Installing frontend dependencies..."
  npm install
else
  echo "[1/4] Frontend deps already installed ✓"
fi

# 2. Backend dependencies
if [ ! -d "server/node_modules" ]; then
  echo "[2/4] Installing backend dependencies..."
  cd server && npm install && cd ..
else
  echo "[2/4] Backend deps already installed ✓"
fi

# 3. Setup .env
if [ ! -f "server/.env" ]; then
  echo "[3/4] Creating server/.env from example..."
  cp server/.env.example server/.env
  echo "⚠️  Edit server/.env to set JWT_SECRET and optionally OPENAI_API_KEY"
else
  echo "[3/4] server/.env exists ✓"
fi

# 4. Build frontend
echo "[4/4] Building frontend..."
npm run build

# 5. Start server
echo ""
echo "✅ Starting server at http://localhost:3001"
echo "   Press Ctrl+C to stop"
echo ""
cd server && node index.js
