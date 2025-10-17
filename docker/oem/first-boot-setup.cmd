@echo off
REM Bytebot First Boot Setup Script
REM This script is executed by dockur/windows during Windows setup (OOBE)
REM It creates auto-run mechanisms to trigger install.bat on first boot

echo ========================================
echo   Bytebot Auto-Install Bootstrap
echo ========================================
echo.

REM Create RunOnce registry entry to run install.bat on first user login
echo Creating RunOnce registry entry...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce" /v BytebotInstall /t REG_SZ /d "cmd /c C:\OEM\install.bat" /f
if %ERRORLEVEL% EQU 0 (
    echo   [OK] RunOnce entry created
) else (
    echo   [WARN] Failed to create RunOnce entry
)

REM Create scheduled task to run install.bat at system startup (30 second delay)
REM This runs as SYSTEM user so it doesn't require login
echo Creating startup scheduled task...
schtasks /create /tn "Bytebot First Boot Install" /tr "C:\OEM\install.bat" /sc onstart /delay 0000:30 /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Scheduled task created
) else (
    echo   [WARN] Failed to create scheduled task
)

echo.
echo ========================================
echo   Auto-Install Configuration Complete
echo ========================================
echo.
echo Installation will run automatically via:
echo   1. Scheduled task at system startup (30s delay)
echo   2. RunOnce registry on first user login
echo.
echo Bytebot Desktop Daemon will be available at:
echo   http://localhost:9990
echo.
