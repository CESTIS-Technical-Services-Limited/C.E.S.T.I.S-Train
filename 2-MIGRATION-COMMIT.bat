@echo off
rem CESTIS MegaData - STEP 2: the REAL migration run.
rem Run this ONLY after the step-1 printout has been reviewed and approved.
rem The secret is typed invisibly; the window is safe to screenshot.
rem NOTE for editors: never put ( or ) inside a bracketed if-block message -
rem cmd treats the ) as the end of the block and kills the whole script.
title CESTIS Migration - Commit
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
echo This is the REAL run. It writes the migration output ready for upload.
echo If the dry-run printout was NOT reviewed yet, close this window now.
pause
echo.
node megadata\bootstrap-cli.js --from-drive --url "%URL%" --commit
set "MEGADATA_SECRET="
echo.
echo ================================================================
echo  DONE. If it says "Committed" above, run 3-UPLOAD-AND-SEAL.bat
echo  This window contains NO secrets - safe to screenshot.
echo ================================================================
pause
