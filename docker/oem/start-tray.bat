@echo off
REM Manual start script for bytebotd tray monitor
REM Use this if the scheduled task didn't start the tray icon automatically

echo Starting Bytebot Tray Monitor...
echo.

REM Find the tray script (copied to C:\OEM during installation)
set TRAY_SCRIPT=C:\OEM\bytebotd-tray.ps1

if not exist "%TRAY_SCRIPT%" (
    echo ERROR: Tray script not found at:
    echo %TRAY_SCRIPT%
    echo.
    echo This script should have been copied during installation
    echo Please check that install.bat completed successfully
    pause
    exit /b 1
)

echo Starting tray monitor...
echo Look for the icon in the system tray (bottom-right)
echo.

REM Start the tray monitor (visible PowerShell window for debugging)
powershell.exe -ExecutionPolicy Bypass -File "%TRAY_SCRIPT%"
