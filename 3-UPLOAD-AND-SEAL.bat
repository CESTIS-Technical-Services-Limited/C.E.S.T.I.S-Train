@echo off
rem CESTIS MegaData - STEP 3: upload the committed migration to the live
rem broker, verify every record arrived, and SEAL the system.
rem After this succeeds, connected pages switch to shadow mode on next open.
rem Safe to re-run if interrupted - nothing is ever duplicated.
rem The secret is typed invisibly; the window is safe to screenshot.
title CESTIS Migration - Upload and Seal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 ( echo Install Node first (nodejs.org, LTS) then run again. & pause & exit /b 1 )

if not exist megadata-broker-url.txt ( echo Run 1-MIGRATION-DRY-RUN.bat first. & pause & exit /b 1 )
set /p URL=<megadata-broker-url.txt

echo Now paste the HMAC secret and press Enter (nothing appears - on purpose).
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$p=Read-Host -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($b)"`) do set "MEGADATA_SECRET=%%s"
if "%MEGADATA_SECRET%"=="" ( echo No secret given. & pause & exit /b 1 )

node megadata\bootstrap-upload.js --url "%URL%" --seal
set "MEGADATA_SECRET="
echo.
pause
