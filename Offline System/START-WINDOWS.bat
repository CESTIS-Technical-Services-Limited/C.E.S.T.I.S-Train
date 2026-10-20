@echo off
title C.E.S.T.I.S - Offline System
cd /d "%~dp0"

echo.
echo  ================================================================
echo    C.E.S.T.I.S  -  Starting the offline system
echo  ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 goto NONODE

rem Node 14 or newer. An older one opens the pages but every video class fails.
node -e "process.exit(parseInt(process.versions.node,10)>=14?0:1)"
if %errorlevel% neq 0 goto OLDNODE

node cestis-offline-server.js
if %errorlevel% neq 0 (
  echo.
  echo   The server stopped with an error. Read the message above.
  echo.
)
goto END

:OLDNODE
echo   The Node.js on this computer is too old for the offline system.
echo.
goto ADVICE

:NONODE
echo   Node.js was not found on this computer.
echo.

:ADVICE
rem There used to be a Python fallback here. It served the records folder and
rem the server's private key to every device on the network, shared nothing
rem between devices, and on most Windows PCs only opened the Microsoft Store.
echo   The offline system needs Node.js 14 or newer:
echo     1. On a computer WITH internet, download the "LTS" installer
echo        from https://nodejs.org  and copy it onto a memory stick.
echo     2. Run the installer on THIS computer.
echo     3. Double-click this file again.
echo   After that this folder never needs the internet again.
echo.

:END
echo.
echo   The server has stopped. Nobody can reach the system now.
echo   Close this window, or run this file again to start it back up.
echo.
pause
