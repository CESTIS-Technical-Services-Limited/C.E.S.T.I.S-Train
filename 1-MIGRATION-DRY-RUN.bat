@echo off
rem CESTIS MegaData - STEP 1: the migration DRY RUN (changes nothing).
rem Fetches every backup from Google Drive through the broker and prints
rem the full import plan for review. Safe to run as many times as you like.
rem The secret is typed INVISIBLY and never appears on screen, so the
rem window is always safe to screenshot.
title CESTIS Migration - Dry Run
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node is not installed yet.
  echo Open nodejs.org, download the LTS version, install with the defaults,
  echo then double-click this file again.
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

echo Now paste the HMAC secret and press Enter.
echo (Nothing will appear while you paste - that is on purpose.)
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$p=Read-Host -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($b)"`) do set "MEGADATA_SECRET=%%s"
if "%MEGADATA_SECRET%"=="" ( echo No secret given. & pause & exit /b 1 )

rem A dry run is cheap and must be a FRESH review artifact every time.
if exist megadata-bootstrap-staging rmdir /s /q megadata-bootstrap-staging

echo.
echo Running the DRY RUN (nothing is changed by this)...
echo.
node megadata\bootstrap-cli.js --from-drive --url "%URL%"
set "MEGADATA_SECRET="
echo.
echo ================================================================
echo  DONE. This window contains NO secrets - screenshot the whole
echo  thing and send it for review before running step 2.
echo ================================================================
pause
