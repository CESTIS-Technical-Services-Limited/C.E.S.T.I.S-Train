@echo off
title C.E.S.T.I.S - Offline System
cd /d "%~dp0"

echo.
echo  ================================================================
echo    C.E.S.T.I.S  -  Starting the offline system
echo  ================================================================
echo.

where node >nul 2>nul
if %errorlevel%==0 goto RUNNODE

echo   Node.js was not found on this computer.
echo.
echo   Trying Python instead. The pages will work, but devices on the
echo   network will NOT share data without Node.js.
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  echo   Open http://localhost:8080/index.html when it starts.
  python -m http.server 8080
  goto END
)
echo   Python was not found either.
echo.
echo   Install Node.js from https://nodejs.org  ^(do this once, on a
echo   computer that has internet, then this folder works offline^).
echo.
pause
goto END

:RUNNODE
node cestis-offline-server.js
if %errorlevel% neq 0 (
  echo.
  echo   The server stopped with an error. Read the message above.
  echo.
)

:END
echo.
echo   The server has stopped. Nobody can reach the system now.
echo   Close this window, or run this file again to start it back up.
echo.
pause
