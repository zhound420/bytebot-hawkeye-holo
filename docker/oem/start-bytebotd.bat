@echo off
REM Manual start script for bytebotd
REM Use this if the scheduled task didn't start bytebotd automatically

echo Starting Bytebot Desktop Daemon...
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found in PATH
    echo Please ensure Node.js is installed and in PATH
    pause
    exit /b 1
)

REM Check if bytebotd exists
if not exist "C:\bytebot\packages\bytebotd\dist\main.js" (
    echo ERROR: bytebotd not found
    echo main.js not found at C:\bytebot\packages\bytebotd\dist\main.js
    echo.
    echo Please ensure packages are built on host:
    echo   cd packages/shared ^&^& npm run build
    echo   cd ../bytebot-cv ^&^& npm install ^&^& npm run build
    echo   cd ../bytebotd ^&^& npm install ^&^& npm run build
    echo.
    echo Then restart the Windows container
    pause
    exit /b 1
)

REM Kill any existing node processes (cleanup)
taskkill /F /IM node.exe >nul 2>&1

REM Start bytebotd
echo Starting bytebotd service...
cd C:\bytebot\packages\bytebotd
start "Bytebot Desktop Daemon" node dist\main.js

echo.
echo Bytebotd started!
echo API should be available at: http://localhost:9990
echo Logs: C:\Bytebot-Logs\bytebotd-*.log
echo.
echo If it doesn't work:
echo   - Check logs above
echo   - Run diagnostic: C:\OEM\diagnose.ps1
echo   - Check tray icon for status
echo.
echo Press any key to exit (bytebotd will continue running)...
pause >nul
