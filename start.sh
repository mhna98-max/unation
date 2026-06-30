#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo ""
  echo "  [ERROR] Node.js is not installed on this computer."
  echo ""
  echo "  Please install Node.js (LTS version) from:"
  echo "  https://nodejs.org"
  echo ""
  read -p "  Press Enter to exit..."
  exit 1
fi

node "$(dirname "$0")/launcher.js"
