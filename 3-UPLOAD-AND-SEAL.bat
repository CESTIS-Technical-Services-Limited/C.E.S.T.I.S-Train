@echo off
rem CESTIS MegaData - STEP 3: upload the committed migration to the live
rem broker, verify every record arrived, and SEAL the system.
rem After this succeeds, connected pages switch to shadow mode on next open.
rem Safe to re-run if it is interrupted - nothing is ever duplicated.
title CESTIS Migration - Upload and Seal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 ( echo Install Node first (nodejs.org, LTS) then run again. & pause & exit /b 1 )

if not exist megadata-broker-url.txt ( echo Run 1-MIGRATION-DRY-RUN.bat first. & pause & exit /b 1 )
set /p URL=<megadata-broker-url.txt

echo When it asks for the secret, paste it and press Enter.
echo.
node megadata\bootstrap-upload.js --url "%URL%" --seal
echo.
pause
