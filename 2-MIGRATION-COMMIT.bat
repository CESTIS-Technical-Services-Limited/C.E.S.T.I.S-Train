@echo off
rem CESTIS MegaData - STEP 2: the REAL migration run.
rem Run this ONLY after the step-1 printout has been reviewed and approved.
title CESTIS Migration - Commit
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 ( echo Install Node first (nodejs.org, LTS) then run again. & pause & exit /b 1 )

if not exist megadata-broker-url.txt ( echo Run 1-MIGRATION-DRY-RUN.bat first. & pause & exit /b 1 )
set /p URL=<megadata-broker-url.txt

echo This is the REAL run. It writes the migration output ready for upload.
echo Press Ctrl+C now if the dry-run printout was not reviewed yet.
pause
node megadata\bootstrap-cli.js --from-drive --url "%URL%" --commit
echo.
echo If it says "Committed", continue with 3-UPLOAD-AND-SEAL.bat
pause
