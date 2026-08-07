@echo off
rem CESTIS MegaData - STEP 1: the migration DRY RUN (changes nothing).
rem Fetches every backup from Google Drive through the broker and prints
rem the full import plan for review. Safe to run as many times as you like.
title CESTIS Migration - Dry Run
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node is not installed yet.
  echo Please install it first: open nodejs.org in your browser, download the
  echo LTS version, run the installer with all the default choices, then
  echo double-click this file again.
  echo.
  pause
  exit /b 1
)

if exist megadata-broker-url.txt (
  set /p URL=<megadata-broker-url.txt
) else (
  echo Paste your broker web address (the long https://script.google.com/.../exec one)
  set /p URL=Broker URL:
)
if "%URL%"=="" ( echo No URL given. & pause & exit /b 1 )
echo %URL%>megadata-broker-url.txt

echo.
echo Running the DRY RUN (nothing is changed by this)...
echo When it asks for the secret, paste it and press Enter.
echo.
node megadata\bootstrap-cli.js --from-drive --url "%URL%"
echo.
echo ================================================================
echo  DONE. Copy everything above (right-click the window title bar,
echo  Edit, Select All, then Enter) and send it for review before
echo  running step 2.
echo ================================================================
pause
