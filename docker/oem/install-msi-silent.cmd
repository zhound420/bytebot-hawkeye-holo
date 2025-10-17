@echo off
REM ============================================
REM   Bytebot Pre-baked Image - MSI Installer
REM ============================================
REM
REM This script runs during Windows OOBE (Out-of-Box Experience)
REM to silently install the Bytebotd MSI package.
REM
REM The MSI handles:
REM   - File installation to C:\Program Files\Bytebot\
REM   - Sharp module rebuild for Windows
REM   - Windows Service registration (Scheduled Task)
REM   - Service startup
REM
REM Expected execution time: 2-3 minutes
REM ============================================

setlocal enabledelayedexpansion

REM Set up logging
set LOG_DIR=C:\Bytebot-Logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set LOG_FILE=%LOG_DIR%\msi-install.log

echo ============================================ > "%LOG_FILE%"
echo   Bytebot Pre-baked Image Installer         >> "%LOG_FILE%"
echo   Started: %DATE% %TIME%                     >> "%LOG_FILE%"
echo ============================================ >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

echo [INFO] Starting Bytebotd MSI installation...
echo [INFO] Log file: %LOG_FILE%

REM Check if MSI exists
if not exist "C:\OEM\bytebotd-installer.msi" (
    echo [ERROR] MSI installer not found at C:\OEM\bytebotd-installer.msi >> "%LOG_FILE%"
    echo [ERROR] MSI installer not found!
    echo [ERROR] Expected location: C:\OEM\bytebotd-installer.msi
    exit /b 1
)

echo [INFO] MSI found: C:\OEM\bytebotd-installer.msi >> "%LOG_FILE%"
echo [INFO] MSI size: >> "%LOG_FILE%"
dir "C:\OEM\bytebotd-installer.msi" | findstr "bytebotd-installer.msi" >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

REM Install MSI silently
echo [INFO] Installing MSI (this may take 2-3 minutes)...
echo [INFO] Running: msiexec /i C:\OEM\bytebotd-installer.msi /qn /norestart >> "%LOG_FILE%"

msiexec /i C:\OEM\bytebotd-installer.msi /qn /norestart /l*v "%LOG_DIR%\msiexec-verbose.log"

set MSI_EXIT_CODE=%ERRORLEVEL%
echo [INFO] MSI exit code: %MSI_EXIT_CODE% >> "%LOG_FILE%"

if %MSI_EXIT_CODE% NEQ 0 (
    echo [ERROR] MSI installation failed with exit code %MSI_EXIT_CODE% >> "%LOG_FILE%"
    echo [ERROR] Check detailed log: %LOG_DIR%\msiexec-verbose.log >> "%LOG_FILE%"
    echo.
    echo [ERROR] MSI installation failed with code %MSI_EXIT_CODE%
    echo [ERROR] Check logs at: %LOG_DIR%
    exit /b %MSI_EXIT_CODE%
)

echo [SUCCESS] MSI installed successfully >> "%LOG_FILE%"
echo [SUCCESS] MSI installed successfully
echo. >> "%LOG_FILE%"

REM Wait for service to start (MSI custom action starts it)
echo [INFO] Waiting for service to start (30 seconds)... >> "%LOG_FILE%"
echo [INFO] Waiting for service to start (30 seconds)...
timeout /t 30 /nobreak >nul

REM Verify service is running via health check
echo [INFO] Verifying service health... >> "%LOG_FILE%"
echo [INFO] Verifying service health...

set HEALTH_URL=http://localhost:9990/health
set HEALTH_CHECK_ATTEMPTS=0
set MAX_HEALTH_CHECKS=6

:health_check_loop
if %HEALTH_CHECK_ATTEMPTS% GEQ %MAX_HEALTH_CHECKS% (
    echo [WARNING] Health check timeout after %MAX_HEALTH_CHECKS% attempts >> "%LOG_FILE%"
    echo [WARNING] Service may still be starting up >> "%LOG_FILE%"
    echo.
    echo [WARNING] Health check timeout, but installation complete
    echo [INFO] Service may take a few more moments to become ready
    goto health_check_done
)

set /a HEALTH_CHECK_ATTEMPTS+=1
echo [INFO] Health check attempt %HEALTH_CHECK_ATTEMPTS%/%MAX_HEALTH_CHECKS%... >> "%LOG_FILE%"

powershell -Command "try { $response = Invoke-WebRequest -Uri '%HEALTH_URL%' -TimeoutSec 5 -UseBasicParsing; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQ 0 (
    echo [SUCCESS] Service is healthy ^(attempt %HEALTH_CHECK_ATTEMPTS%^) >> "%LOG_FILE%"
    echo [SUCCESS] Service is healthy
    goto health_check_done
)

echo [INFO] Service not ready yet, waiting 10 seconds... >> "%LOG_FILE%"
timeout /t 10 /nobreak >nul
goto health_check_loop

:health_check_done
echo. >> "%LOG_FILE%"

REM Check for heartbeat file
echo [INFO] Checking for heartbeat file... >> "%LOG_FILE%"
if exist "C:\ProgramData\Bytebot\heartbeat.txt" (
    echo [SUCCESS] Heartbeat file found >> "%LOG_FILE%"
    echo [INFO] Heartbeat contents: >> "%LOG_FILE%"
    type "C:\ProgramData\Bytebot\heartbeat.txt" >> "%LOG_FILE%"
    echo [SUCCESS] Heartbeat file found
) else (
    echo [WARNING] Heartbeat file not found yet >> "%LOG_FILE%"
    echo [WARNING] Heartbeat file not found (may appear shortly)
)

echo. >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

REM Start tray icon (runs in background as current user)
echo [INFO] Starting tray icon monitor... >> "%LOG_FILE%"
start /B powershell -WindowStyle Hidden -File "C:\Program Files\Bytebot\packages\bytebotd\bytebotd-tray.ps1"
echo [INFO] Tray icon started >> "%LOG_FILE%"

echo. >> "%LOG_FILE%"
echo ============================================ >> "%LOG_FILE%"
echo   Installation Complete                      >> "%LOG_FILE%"
echo   Completed: %DATE% %TIME%                   >> "%LOG_FILE%"
echo ============================================ >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo Bytebotd Desktop Agent is now running.
echo.
echo Service status:
echo   - Scheduled Task: "Bytebotd Desktop Agent"
echo   - Port: 9990
echo   - Logs: %LOG_DIR%
echo   - Heartbeat: C:\ProgramData\Bytebot\heartbeat.txt
echo.
echo Access points:
echo   - Health check: http://localhost:9990/health
echo   - Web viewer: http://localhost:8006
echo   - RDP: localhost:3389
echo.

exit /b 0
