#!/bin/bash
# C.E.S.T.I.S - Offline System (Linux)
cd "$(dirname "$0")" || exit 1

echo
echo " ================================================================"
echo "   C.E.S.T.I.S  -  Starting the offline system"
echo " ================================================================"
echo

if command -v node >/dev/null 2>&1; then
  node cestis-offline-server.js
else
  echo "  Node.js was not found on this computer."
  echo
  echo "  Trying Python instead. The pages will work, but devices on the"
  echo "  network will NOT share data without Node.js."
  echo
  if command -v python3 >/dev/null 2>&1; then
    echo "  Open http://localhost:8080/index.html when it starts."
    python3 -m http.server 8080
  else
    echo "  Python was not found either."
    echo
    echo "  Install it with your package manager, e.g.:"
    echo "      sudo apt install nodejs        (Debian / Ubuntu / Mint)"
    echo "      sudo dnf install nodejs        (Fedora)"
    echo
  fi
fi

echo
echo "  The server has stopped. Nobody can reach the system now."
echo "  Close this window, or run this file again to start it back up."
echo
read -n 1 -s -r -p "  Press any key to close..."
echo
