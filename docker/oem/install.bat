@echo off
REM ================================================
REM   Bytebotd Pre-baked Image Installer
REM ================================================
REM This CMD wrapper calls the PowerShell installer script
REM Simple approach that avoids CMD's 8191-character line limit

echo ================================================
echo    Bytebotd Pre-baked Image Installer
echo ================================================
echo.

REM Execute PowerShell script from the same directory
REM %~dp0 = directory of this batch file (C:\OEM\)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-prebaked.ps1"

REM Capture exit code
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 0 (
    echo.
    echo ================================================
    echo    Installation completed successfully!
    echo ================================================
) else (
    echo.
    echo ================================================
    echo    Installation failed with error code: %EXIT_CODE%
    echo ================================================
    echo.
    echo Check logs at: C:\Bytebot-Logs\install-prebaked.log
    pause
)

exit /b %EXIT_CODE%
