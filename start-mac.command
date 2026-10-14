#!/bin/bash
# Double-click this file to start Subscription Manager on a Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed on this computer."
  echo "  Install the LTS version from https://nodejs.org (opening it now),"
  echo "  then double-click this file again."
  echo
  open https://nodejs.org
  read -r -p "Press Enter to close this window..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "  First start: installing the app. This takes a minute..."
  echo
  if ! npm install; then
    echo
    read -r -p "Installation failed - see the messages above. Press Enter to close..."
    exit 1
  fi
fi

OPEN_BROWSER=1 npm start
echo
read -r -p "Subscription Manager has stopped. Press Enter to close this window..."
