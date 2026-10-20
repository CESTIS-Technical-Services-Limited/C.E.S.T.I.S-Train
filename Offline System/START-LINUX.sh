#!/bin/bash
# C.E.S.T.I.S - Offline System (Linux)
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
  echo "  Node.js was not found on this computer."
  NEED_NODE=1
elif ! node -e "process.exit(parseInt(process.versions.node,10)>=14?0:1)"; then
  echo "  The Node.js on this computer ($(node -v)) is too old for the offline system."
  NEED_NODE=1
fi

if [ -n "$NEED_NODE" ]; then
  echo
  echo "  The offline system needs Node.js 14 or newer. The version in some"
  echo "  distributions' own package lists is older than that (Ubuntu 18.04"
  echo "  ships 8.x), so get the current \"LTS\" version from https://nodejs.org"
  echo "  (on a computer with internet; copy it onto a memory stick), install"
  echo "  it here, then start this again."
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
