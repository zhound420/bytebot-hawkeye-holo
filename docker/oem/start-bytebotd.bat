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

REM Check if bytebotd is mounted
if not exist "C:\app\bytebotd\dist\main.js" (
    echo ERROR: bytebotd not found
    echo main.js not found at C:\app\bytebotd\dist\main.js
    echo.
    echo Please ensure packages are built on host and container is running
    pause
    exit /b 1
)

REM Kill any existing node processes (cleanup)
taskkill /F /IM node.exe >nul 2>&1

REM Start bytebotd
echo Starting bytebotd service...
cd C:\app\bytebotd
start "Bytebot Desktop Daemon" node dist\main.js

echo.
echo Bytebotd started!
echo API should be available at: http://localhost:9990
echo.
echo Press any key to exit (bytebotd will continue running)...
pause >nul
