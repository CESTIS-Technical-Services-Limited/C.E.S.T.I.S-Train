#!/bin/bash
# C.E.S.T.I.S - Offline System (macOS)
cd "$(dirname "$0")" || exit 1

echo
echo " ================================================================"
echo "   C.E.S.T.I.S  -  Starting the offline system"
echo " ================================================================"
echo

# There used to be a Python fallback here. It served the records folder and
# the server's private key to every device on the network and shared nothing
# between devices, so it is gone: the system needs Node.js 14 or newer.
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js was not found on this Mac."
  NEED_NODE=1
elif ! node -e "process.exit(parseInt(process.versions.node,10)>=14?0:1)"; then
  echo "  The Node.js on this Mac ($(node -v)) is too old for the offline system."
  NEED_NODE=1
fi

if [ -n "$NEED_NODE" ]; then
  echo
  echo "  The offline system needs Node.js 14 or newer:"
  echo "    1. On a computer WITH internet, download the \"LTS\" installer"
  echo "       from https://nodejs.org and copy it onto a memory stick."
  echo "    2. Run the installer on THIS Mac."
  echo "    3. Double-click this file again."
  echo "  After that this folder never needs the internet again."
  echo
else
  node cestis-offline-server.js
fi

echo
echo "  The server has stopped. Nobody can reach the system now."
echo "  Close this window, or run this file again to start it back up."
echo
read -n 1 -s -r -p "  Press any key to close..."
echo
