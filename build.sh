#!/bin/bash
set -e
echo "══════════════════════════════════════════"
echo "  VINCI – macOS App Build (Apple Silicon)"
echo "══════════════════════════════════════════"

# 1. Dependencies
echo "→ npm install..."
npm install

# 2. Build .icns from iconset
if [ ! -f "assets/icon.icns" ]; then
  echo "→ icon.icns erstellen..."
  if command -v iconutil &>/dev/null; then
    iconutil -c icns assets/vinci.iconset -o assets/icon.icns
    echo "✓ icon.icns erstellt"
  else
    echo "⚠ iconutil nicht gefunden"
    exit 1
  fi
else
  echo "✓ icon.icns vorhanden"
fi

# 3. Build
echo "→ electron-vite build..."
./node_modules/.bin/electron-vite build

echo "→ electron-builder (arm64 DMG)..."
./node_modules/.bin/electron-builder --config electron-builder.config.js --mac --arm64

echo ""
echo "✓ Fertig!"
echo "  → release/VINCI-2.0.0.dmg öffnen"
echo "  → VINCI in Applications ziehen"
echo "══════════════════════════════════════════"
