@echo off
REM Bytebot First Boot Setup Script - Optimized
REM This script is executed by dockur/windows during Windows setup (OOBE)
REM It copies the installer ZIP from /shared mount to C:\OEM for fast access

echo ========================================
echo   Bytebot Auto-Install Bootstrap
echo ========================================
echo.

REM Wait for C:\OEM to be fully accessible (dockur copies OEM folder during OOBE)
timeout /t 5 /nobreak >nul

REM Copy installer ZIP from network share to local OEM folder for faster installation
echo Copying installer package to C:\OEM...

REM Check if ZIP already exists in C:\OEM (avoid re-downloading)
if exist "C:\OEM\bytebotd-windows-installer.zip" (
    echo   [OK] Installer package already in C:\OEM
    goto CreateAutoRun
)

REM Copy from network share (\\host.lan\Data = /shared mount)
REM This is much faster than extracting directly from network share
if exist "\\host.lan\Data\bytebotd-windows-installer.zip" (
    echo   Copying from \\host.lan\Data...
    copy /Y "\\host.lan\Data\bytebotd-windows-installer.zip" "C:\OEM\bytebotd-windows-installer.zip" >nul 2>&1

    if %ERRORLEVEL% EQU 0 (
        echo   [OK] Installer package copied to C:\OEM
    ) else (
        echo   [WARN] Failed to copy from network share
        echo   Installation will attempt to use network path directly
    )
) else (
    echo   [WARN] Installer package not found on network share
    echo   Expected: \\host.lan\Data\bytebotd-windows-installer.zip
    echo.
    echo   Please ensure docker-compose.windows.yml has:
    echo     volumes:
    echo       - ./windows-installer:/shared
)

:CreateAutoRun

REM Create scheduled task to run install.bat at system startup (30 second delay)
REM This runs as SYSTEM user so it doesn't require login
echo Creating startup scheduled task...

REM Use optimized installer if available, fallback to regular installer
set INSTALL_SCRIPT=C:\OEM\install-optimized.bat
if not exist "%INSTALL_SCRIPT%" (
    set INSTALL_SCRIPT=C:\OEM\install.bat
)

schtasks /create /tn "Bytebot First Boot Install" /tr "%INSTALL_SCRIPT%" /sc onstart /delay 0000:30 /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Scheduled task created
) else (
    echo   [WARN] Failed to create scheduled task
)

REM Create RunOnce registry entry as backup (runs on first user login)
echo Creating RunOnce registry entry...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce" /v BytebotInstall /t REG_SZ /d "cmd /c %INSTALL_SCRIPT%" /f >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] RunOnce entry created
) else (
    echo   [WARN] Failed to create RunOnce entry
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
echo Installer Package: C:\OEM\bytebotd-windows-installer.zip
echo Install Script: %INSTALL_SCRIPT%
echo.
echo Bytebot Desktop Daemon will be available at:
echo   http://localhost:9990
echo.
