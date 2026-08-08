@echo off
rem CESTIS MegaData - STEP 3: upload the committed migration to the live
rem broker, verify every record arrived, and SEAL the system.
rem After this succeeds, connected pages switch to shadow mode on next open.
rem Safe to re-run if interrupted - nothing is ever duplicated.
rem The secret is typed invisibly; the window is safe to screenshot.
rem NOTE for editors: never put ( or ) inside a bracketed if-block message -
rem cmd treats the ) as the end of the block and kills the whole script.
title CESTIS Migration - Upload and Seal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node is not installed yet.
  echo Open nodejs.org, download the LTS version, install with the defaults,
  echo then double-click this file again.
  pause
  exit /b 1
)

if not exist megadata-broker-url.txt (
  echo Run 1-MIGRATION-DRY-RUN.bat first - it remembers your broker address.
  pause
  exit /b 1
)
set /p URL=<megadata-broker-url.txt
if "%URL%"=="" (
  echo megadata-broker-url.txt is empty. Run 1-MIGRATION-DRY-RUN.bat again.
  pause
  exit /b 1
)

echo Now paste the HMAC secret and press Enter.
echo (Nothing will appear while you paste - that is on purpose.)
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$p=Read-Host -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($b)"`) do set "MEGADATA_SECRET=%%s"
if "%MEGADATA_SECRET%"=="" (
  echo No secret given.
  pause
  exit /b 1
)

echo.
node megadata\bootstrap-upload.js --url "%URL%" --seal
set "MEGADATA_SECRET="
echo.
echo ================================================================
echo  This window contains NO secrets - screenshot the whole thing
echo  and send it for review.
echo ================================================================
pause
