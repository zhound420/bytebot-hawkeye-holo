@echo off
REM Manual start script for bytebotd tray monitor
REM Use this if the scheduled task didn't start the tray icon automatically

echo Starting Bytebot Tray Monitor...
echo.

REM Find the tray script (mounted from host at C:\shared\scripts)
set TRAY_SCRIPT=C:\shared\scripts\bytebotd-tray.ps1

if not exist "%TRAY_SCRIPT%" (
    echo ERROR: Tray script not found at:
    echo %TRAY_SCRIPT%
    echo.
    echo Please check if the scripts folder is mounted correctly
    pause
    exit /b 1
)

echo Starting tray monitor...
echo Look for the icon in the system tray (bottom-right)
echo.

REM Start the tray monitor (visible PowerShell window for debugging)
powershell.exe -ExecutionPolicy Bypass -File "%TRAY_SCRIPT%"
