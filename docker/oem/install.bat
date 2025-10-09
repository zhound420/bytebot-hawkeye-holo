@echo off
REM Bytebot Windows Installer - ZIP-based approach
REM This script is copied into the installer ZIP as install.bat
REM It's also available in C:\OEM for manual installation

echo ========================================
echo   Bytebot Windows Installation
echo ========================================
echo.
echo This installer will:
echo   1. Extract pre-built bytebotd package
echo   2. Create auto-start scheduled task
echo   3. Launch bytebotd service
echo.

REM Set paths
set BYTEBOT_ROOT=C:\bytebot\packages
set BYTEBOTD_PATH=%BYTEBOT_ROOT%\bytebotd
set INSTALLER_ZIP=C:\shared\bytebotd-windows-installer.zip
set TEMP_ZIP=C:\Windows\Temp\bytebot-installer.zip
set LOG_DIR=C:\Bytebot-Install-Logs
set BYTEBOTD_LOG_DIR=C:\Bytebot-Logs

REM Create log directory
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set LOG_FILE=%LOG_DIR%\install-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

echo Log file: %LOG_FILE%
echo. >> "%LOG_FILE%"
echo [%date% %time%] Installation started >> "%LOG_FILE%"

REM Check if Node.js is already installed
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Node.js already installed, skipping setup...
    echo [%date% %time%] Node.js found, skipping Chocolatey setup >> "%LOG_FILE%"
    goto ExtractPackage
)

REM Wait for network to be ready (Windows networking initializes slowly)
echo Waiting for network connectivity...
set NETWORK_WAIT=0
:WaitForNetwork
set /a NETWORK_WAIT+=1
ping -n 1 8.8.8.8 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Network is ready!
    goto NetworkReady
)
if %NETWORK_WAIT% GEQ 12 (
    echo WARNING: Network not responding after 60 seconds, proceeding anyway...
    goto NetworkReady
)
echo   Waiting for network... (attempt %NETWORK_WAIT%/12)
timeout /t 5 /nobreak >nul
goto WaitForNetwork
:NetworkReady

REM Install Chocolatey with retry logic
where choco >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto InstallChoco
goto ChocoExists

:InstallChoco
set CHOCO_ATTEMPTS=0
:RetryChoco
set /a CHOCO_ATTEMPTS+=1
echo Installing Chocolatey package manager (attempt %CHOCO_ATTEMPTS%/3)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% EQU 0 (
    set "PATH=C:\ProgramData\chocolatey\bin;%PATH%"
    echo Chocolatey installed successfully!
    goto ChocoExists
)

if %CHOCO_ATTEMPTS% LSS 3 (
    echo WARNING: Chocolatey install failed, retrying in 30 seconds...
    timeout /t 30 /nobreak >nul
    goto RetryChoco
)

echo ERROR: Chocolatey installation failed after 3 attempts
echo Trying alternative Node.js installation method...
goto DirectNodeInstall

:ChocoExists

REM Install Node.js via Chocolatey
echo Installing Node.js 20 via Chocolatey...
choco install nodejs --version=20.19.0 -y --force >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Node.js installed successfully via Chocolatey!
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto ExtractPackage
)

REM Chocolatey Node.js install failed, try direct download
:DirectNodeInstall
echo Attempting direct Node.js MSI download...
set NODE_MSI=C:\Windows\Temp\node-v20.19.0-x64.msi
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi' -OutFile '%NODE_MSI%'" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to download Node.js installer
    echo Check network connectivity and try manual installation
    pause
    exit /b 1
)

echo Installing Node.js from MSI...
msiexec /i "%NODE_MSI%" /qn /norestart >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js MSI installation failed
    pause
    exit /b 1
)

echo Node.js installed successfully via MSI!
del /f /q "%NODE_MSI%" 2>nul

REM Update PATH
set "PATH=C:\Program Files\nodejs;%PATH%"

:ExtractPackage
echo.
echo ========================================
echo   Extracting Bytebot Package
echo ========================================
echo.

REM Wait for installer package to become available
echo Waiting for installer package %INSTALLER_ZIP%...
set WAIT_ATTEMPTS=0
set MAX_WAIT=24
:WaitForShare
if exist "%INSTALLER_ZIP%" goto ShareReady
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% GEQ %MAX_WAIT% (
    echo ERROR: Installer package not available after 2 minutes
    echo Expected: %INSTALLER_ZIP%
    echo.
    echo Troubleshooting:
    echo   1. Check docker-compose.windows.yml has: ./windows-installer:/shared
    echo   2. Ensure installer exists: docker/windows-installer/bytebotd-windows-installer.zip
    echo   3. Build installer: ./scripts/build-windows-installer.sh
    echo   4. Verify /shared mount is accessible in container
    echo.
    pause
    exit /b 1
)
echo   Attempt %WAIT_ATTEMPTS%/%MAX_WAIT%...
timeout /t 5 /nobreak >nul
goto WaitForShare
:ShareReady

echo Network share accessible!
echo.

REM Copy ZIP to temp location (faster than extracting from network share)
echo Copying installer package to local temp...
copy /Y "%INSTALLER_ZIP%" "%TEMP_ZIP%" >nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy installer ZIP
    pause
    exit /b 1
)
echo Installer copied to %TEMP_ZIP%

REM Extract ZIP to C:\ (creates C:\bytebot\packages\...)
echo Extracting package to C:\...
echo This may take 1-2 minutes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath 'C:\' -Force" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to extract installer ZIP
    echo Check log: %LOG_FILE%
    pause
    exit /b 1
)
echo Package extracted successfully!

REM Clean up temp ZIP
del /f /q "%TEMP_ZIP%" 2>nul

REM Verify extraction
if not exist "%BYTEBOTD_PATH%\dist\main.js" (
    echo ERROR: Bytebotd not found after extraction
    echo Expected: %BYTEBOTD_PATH%\dist\main.js
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Rebuilding Native Modules
echo ========================================
echo.

REM Rebuild sharp for Windows (Linux binaries don't work on Windows)
echo Rebuilding sharp module for Windows...
echo [%date% %time%] Rebuilding sharp for Windows >> "%LOG_FILE%"
cd /d "%BYTEBOTD_PATH%"
npm rebuild sharp --verbose >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Sharp rebuild failed, trying alternative approach...
    echo [%date% %time%] Sharp rebuild failed, reinstalling >> "%LOG_FILE%"
    echo Reinstalling sharp for win32-x64...
    npm uninstall sharp >> "%LOG_FILE%" 2>&1
    npm install --save-exact sharp@0.33.5 >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install sharp
        echo [%date% %time%] Sharp installation failed >> "%LOG_FILE%"
        echo Check log: %LOG_FILE%
        pause
        exit /b 1
    )
)
echo Sharp module ready for Windows!
echo [%date% %time%] Sharp module rebuilt successfully >> "%LOG_FILE%"

echo.
echo ========================================
echo   Configuring Auto-Start
echo ========================================
echo.

REM Create log directory for bytebotd
if not exist "%BYTEBOTD_LOG_DIR%" mkdir "%BYTEBOTD_LOG_DIR%"

REM Verify Node.js
echo [%date% %time%] Verifying Node.js installation >> "%LOG_FILE%"
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" (
    echo ERROR: Node.js not found at %NODE_EXE%
    echo [%date% %time%] Node.js not found at expected path >> "%LOG_FILE%"
    where node
    pause
    exit /b 1
)

echo Node.js: %NODE_EXE%
"%NODE_EXE%" --version >> "%LOG_FILE%" 2>&1
echo [%date% %time%] Node.js version verified >> "%LOG_FILE%"

REM Create startup wrapper script
echo Creating startup wrapper...
echo [%date% %time%] Creating startup wrapper script >> "%LOG_FILE%"
(
  echo @echo off
  echo REM Bytebot Desktop Daemon Startup Wrapper
  echo.
  echo set LOG_FILE=%BYTEBOTD_LOG_DIR%\bytebotd-%%date:~-4,4%%%%date:~-10,2%%%%date:~-7,2%%-%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%.log
  echo set LOG_FILE=%%LOG_FILE: =0%%
  echo.
  echo REM Hawkeye/Holo 1.5-7B environment variables
  echo set BYTEBOT_CV_USE_HOLO=true
  echo set HOLO_URL=http://bytebot-holo:9989
  echo set HOLO_TIMEOUT=120000
  echo set BYTEBOT_ENFORCE_CV_FIRST=true
  echo set BYTEBOT_GRID_OVERLAY=true
  echo set BYTEBOT_GRID_DEBUG=false
  echo set BYTEBOT_PROGRESSIVE_ZOOM_USE_AI=true
  echo set BYTEBOT_UNIVERSAL_TEACHING=true
  echo set BYTEBOT_ADAPTIVE_CALIBRATION=true
  echo set BYTEBOT_ZOOM_REFINEMENT=true
  echo set BYTEBOT_COORDINATE_METRICS=true
  echo set BYTEBOT_POST_CLICK_CALIBRATION=true
  echo set BYTEBOT_DRIFT_COMPENSATION=true
  echo set BYTEBOT_DRIFT_SMOOTHING=0.2
  echo set BYTEBOT_PRECLICK_SNAP=true
  echo set BYTEBOT_SNAP_RADIUS=6
  echo set BYTEBOT_SNAP_PENALTY=0.25
  echo set BYTEBOT_CLICK_RETRY_ON_NOCHANGE=true
  echo set BYTEBOT_CLICK_VERIFY_DELAY=250
  echo set BYTEBOT_CLICK_VERIFY_RADIUS=12
  echo set BYTEBOT_CLICK_VERIFY_THRESHOLD=4.0
  echo set BYTEBOT_CLICK_RETRY_MAX=1
  echo.
  echo echo [%%date%% %%time%%] Starting Bytebot Desktop Daemon... ^> "%%LOG_FILE%%"
  echo cd /d "%BYTEBOTD_PATH%" ^>^> "%%LOG_FILE%%" 2^>^&1
  echo "%NODE_EXE%" dist\main.js ^>^> "%%LOG_FILE%%" 2^>^&1
  echo echo [%%date%% %%time%%] Bytebotd exited with code %%ERRORLEVEL%% ^>^> "%%LOG_FILE%%"
) > "%BYTEBOTD_PATH%\start.bat"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create startup wrapper
    echo [%date% %time%] Failed to create start.bat >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo Startup wrapper created
echo [%date% %time%] Startup wrapper created successfully >> "%LOG_FILE%"

REM Create scheduled task
echo Creating scheduled task...
echo [%date% %time%] Creating scheduled task >> "%LOG_FILE%"
schtasks /create /tn "Bytebot Desktop Daemon" /tr "\"%BYTEBOTD_PATH%\start.bat\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Scheduled task created successfully
    echo [%date% %time%] Scheduled task created successfully >> "%LOG_FILE%"

    REM Start task immediately
    echo Starting bytebotd service...
    echo [%date% %time%] Starting bytebotd service >> "%LOG_FILE%"
    schtasks /run /tn "Bytebot Desktop Daemon" >> "%LOG_FILE%" 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo WARNING: Failed to create scheduled task
    echo [%date% %time%] WARNING: Failed to create scheduled task >> "%LOG_FILE%"
)

REM Verify bytebotd is running
echo.
echo Verifying service...
echo [%date% %time%] Starting health check verification >> "%LOG_FILE%"
timeout /t 5 /nobreak >nul

set VERIFY_ATTEMPTS=0
set MAX_VERIFY=10
:VerifyLoop
set /a VERIFY_ATTEMPTS+=1
echo [%date% %time%] Health check attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY% >> "%LOG_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9990/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: Bytebotd is running!
    echo [%date% %time%] Health check passed - bytebotd is running >> "%LOG_FILE%"
    goto InstallComplete
)

if %VERIFY_ATTEMPTS% LSS %MAX_VERIFY% (
    echo Waiting for bytebotd to start... (attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY%)
    timeout /t 2 /nobreak >nul
    goto VerifyLoop
)

echo.
echo WARNING: Bytebotd health check timeout
echo [%date% %time%] WARNING: Health check timeout after %MAX_VERIFY% attempts >> "%LOG_FILE%"
echo Service may still be starting...
echo Check logs: %BYTEBOTD_LOG_DIR%

:InstallComplete
echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Bytebot Desktop Daemon: %BYTEBOTD_PATH%
echo API: http://localhost:9990
echo.
echo Logs: %BYTEBOTD_LOG_DIR%
echo   - Installation: %LOG_FILE%
echo   - Service: %BYTEBOTD_LOG_DIR%\bytebotd-*.log
echo.
echo Auto-start: Scheduled task runs on login
echo.

REM Log completion
echo [%date% %time%] Installation completed successfully >> "%LOG_FILE%"
