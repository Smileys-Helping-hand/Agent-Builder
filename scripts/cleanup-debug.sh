#!/usr/bin/env bash
# ===============================================
# Agent Builder Ultra – Cleanup & Debug Utility
# ===============================================

set -euo pipefail

echo "🔧 Cleaning build artifacts..."
rm -rf dist node_modules dashboard/node_modules src-tauri/target

echo "🧩 Reinstalling dependencies..."
npm install --silent
npm --prefix dashboard install --silent
npm install --prefix src-tauri --silent

echo "🧹 Clearing caches..."
rm -rf ~/.npm/_cacache
rm -rf ./data/tmp ./logs/tmp

echo "🗃️  Running verification build..."
if ! npm run verify; then
  echo "❌ Build failed"
  exit 1
fi

echo "🩺 Checking services..."
curl -s http://localhost:4000/api/health || echo "Backend not running"
psql -d agentbuilder -c "\\dt" || echo "Database not reachable"

echo "🧠 Checking Redis/RabbitMQ connection..."
# Adjust commands depending on your queue provider
redis-cli ping 2>/dev/null || echo "Redis not responding"

echo "✅ Cleanup & debug complete. You can now run:"
echo "   npm run start   # Backend"
echo "   npm --prefix dashboard run dev   # Dashboard"
