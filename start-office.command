#!/bin/bash
# Starts BrainADZ HRMS on this Mac so others on the office Wi-Fi can use it.
# Double-click this file in Finder (first time: right-click > Open).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this again."
  read -r -p "Press Enter to close." _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing for the first time. This takes a few minutes..."
  npm install || { read -r -p "Install failed. Press Enter to close." _; exit 1; }
fi
if [ ! -f client/dist/index.html ]; then
  npm run build || { read -r -p "Build failed. Press Enter to close." _; exit 1; }
fi
npm start
