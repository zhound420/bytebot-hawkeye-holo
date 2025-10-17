@echo off
REM Bytebot Windows Installer - Optimized with Portable Node.js
REM This script installs bytebotd as a Windows Service using pre-bundled Node.js
REM No network dependencies, no Chocolatey, no npm rebuild

REM Set paths
set INSTALL_ROOT=C:\bytebot
set BYTEBOTD_PATH=%INSTALL_ROOT%\packages\bytebotd
set NODE_PORTABLE=%INSTALL_ROOT%\node
set NODE_EXE=%NODE_PORTABLE%\node.exe
set LOG_DIR=C:\Bytebot-Logs
set INSTALL_LOG_DIR=C:\Bytebot-Install-Logs

REM ========================================
REM   Installation Guard
REM ========================================
if exist "%BYTEBOTD_PATH%\dist\main.js" (
    if exist "%NODE_EXE%" (
        echo Installation already complete
        echo Starting bytebotd service if not running...

        REM Check if service exists
        sc query BytebotService >nul 2>&1
        if %ERRORLEVEL% EQU 0 (
            echo Service exists, starting if stopped...
            sc start BytebotService >nul 2>&1
        ) else (
            echo WARNING: Service not found, please run full installation
        )

        echo.
        echo To reinstall, delete: %INSTALL_ROOT%
        exit /b 0
    )
)

echo ========================================
echo   Bytebot Windows Installation
echo ========================================
echo.
echo This installer will:
echo   1. Extract pre-built bytebotd + portable Node.js
echo   2. Create auto-start Windows Service
echo   3. Launch bytebotd service
echo.

REM Create log directory
if not exist "%INSTALL_LOG_DIR%" mkdir "%INSTALL_LOG_DIR%"
set LOG_FILE=%INSTALL_LOG_DIR%\install-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

echo Log file: %LOG_FILE%
echo. >> "%LOG_FILE%"
echo [%date% %time%] Installation started >> "%LOG_FILE%"

REM ========================================
REM   Extract Package from OEM Folder
REM ========================================
echo.
echo Extracting bytebotd package from C:\OEM...
echo [%date% %time%] Extracting bytebotd package >> "%LOG_FILE%"

REM Check if ZIP exists in OEM folder (copied during Windows installation)
set OEM_ZIP=C:\OEM\bytebotd-windows-installer.zip

if not exist "%OEM_ZIP%" (
    echo ERROR: Installer package not found: %OEM_ZIP%
    echo Expected package in C:\OEM folder
    echo.
    echo The package should be copied during Windows OOBE installation
    echo Check docker-compose.windows.yml OEM mount configuration
    echo [%date% %time%] ERROR: Installer ZIP not found in OEM folder >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo Found installer package: %OEM_ZIP%
echo Package size:
dir "%OEM_ZIP%" | find "bytebotd"

REM ========================================
REM   Download 7-Zip for Fast Extraction
REM ========================================
echo.
echo Downloading 7-Zip for fast extraction...
echo [%date% %time%] Downloading 7-Zip >> "%LOG_FILE%"

set SEVEN_ZIP_URL=https://www.7-zip.org/a/7zr.exe
set SEVEN_ZIP_DIR=%TEMP%\7zip
set SEVEN_ZIP_EXE=%SEVEN_ZIP_DIR%\7z.exe

if not exist "%SEVEN_ZIP_DIR%" mkdir "%SEVEN_ZIP_DIR%"

if not exist "%SEVEN_ZIP_EXE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%SEVEN_ZIP_URL%' -OutFile '%SEVEN_ZIP_EXE%' -UseBasicParsing -TimeoutSec 30" >> "%LOG_FILE%" 2>&1

    if %ERRORLEVEL% EQU 0 (
        echo 7-Zip downloaded successfully (~700KB)
        echo [%date% %time%] 7-Zip downloaded >> "%LOG_FILE%"
    ) else (
        echo WARNING: Failed to download 7-Zip, will use slower extraction
        echo [%date% %time%] 7-Zip download failed >> "%LOG_FILE%"
        set SEVEN_ZIP_EXE=
    )
) else (
    echo 7-Zip already available
    echo [%date% %time%] 7-Zip already cached >> "%LOG_FILE%"
)

REM ========================================
REM   Extract ZIP (7-Zip or Fallback)
REM ========================================
echo.
echo Extracting to C:\...
echo [%date% %time%] Starting extraction >> "%LOG_FILE%"

set EXTRACTION_START=%TIME%

if defined SEVEN_ZIP_EXE (
    if exist "%SEVEN_ZIP_EXE%" (
        echo Using 7-Zip multithreaded extraction (10-20 seconds)...
        echo [%date% %time%] Extracting with 7-Zip >> "%LOG_FILE%"
        "%SEVEN_ZIP_EXE%" x -y -o"C:\" "%OEM_ZIP%" >> "%LOG_FILE%" 2>&1

        if %ERRORLEVEL% NEQ 0 (
            echo 7-Zip extraction failed, falling back to Expand-Archive...
            echo [%date% %time%] 7-Zip failed, using Expand-Archive fallback >> "%LOG_FILE%"
            powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%OEM_ZIP%' -DestinationPath 'C:\' -Force" >> "%LOG_FILE%" 2>&1
        )
    )
) else (
    echo Using Expand-Archive (1-2 minutes, slower fallback)...
    echo [%date% %time%] Extracting with Expand-Archive >> "%LOG_FILE%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%OEM_ZIP%' -DestinationPath 'C:\' -Force" >> "%LOG_FILE%" 2>&1
)

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to extract installer package
    echo Check log: %LOG_FILE%
    echo [%date% %time%] ERROR: Extraction failed >> "%LOG_FILE%"
    pause
    exit /b 1
)

set EXTRACTION_END=%TIME%
echo [%date% %time%] Extraction completed (started %EXTRACTION_START%, ended %EXTRACTION_END%) >> "%LOG_FILE%"

echo Package extracted successfully!
echo [%date% %time%] Package extracted successfully >> "%LOG_FILE%"

REM Verify extraction
if not exist "%BYTEBOTD_PATH%\dist\main.js" (
    echo ERROR: Bytebotd not found after extraction
    echo Expected: %BYTEBOTD_PATH%\dist\main.js
    echo [%date% %time%] ERROR: Bytebotd files not found after extraction >> "%LOG_FILE%"
    pause
    exit /b 1
)

if not exist "%NODE_EXE%" (
    echo ERROR: Node.js portable not found after extraction
    echo Expected: %NODE_EXE%
    echo [%date% %time%] ERROR: Node.js portable not found >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo Bytebotd files verified!
echo Node.js portable verified!

REM Test Node.js
echo Testing Node.js...
"%NODE_EXE%" --version >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Node.js test failed
    echo [%date% %time%] WARNING: Node.js test failed >> "%LOG_FILE%"
) else (
    echo Node.js working correctly
)

REM ========================================
REM   Rebuild Platform-Specific Modules
REM ========================================
echo.
echo ========================================
echo   Rebuilding Platform-Specific Modules
echo ========================================
echo.

cd /d "%BYTEBOTD_PATH%"

REM Check if sharp needs rebuild (test if it can load)
echo Checking if sharp module needs rebuild...
echo [%date% %time%] Testing sharp module >> "%LOG_FILE%"
"%NODE_EXE%" -e "require('sharp')" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Sharp module already works, skipping rebuild!
    echo [%date% %time%] Sharp module works, skipping rebuild >> "%LOG_FILE%"
    goto SharpReady
)

REM Rebuild sharp for Windows
echo Sharp needs rebuild for Windows platform...
echo This may take 2-3 minutes, please wait...
echo [%date% %time%] Rebuilding sharp for Windows >> "%LOG_FILE%"

REM Set npm to use portable Node.js
set "PATH=%NODE_PORTABLE%;%PATH%"

npm rebuild sharp >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Sharp rebuild failed, trying reinstall...
    echo [%date% %time%] Sharp rebuild failed, reinstalling >> "%LOG_FILE%"
    npm uninstall sharp >> "%LOG_FILE%" 2>&1
    npm install --save-exact sharp@0.33.5 >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install sharp
        echo [%date% %time%] Sharp installation failed >> "%LOG_FILE%"
        echo.
        echo Sharp is required for screenshot processing
        echo Check log: %LOG_FILE%
        pause
        exit /b 1
    )
)

echo Sharp rebuild completed!
echo [%date% %time%] Sharp rebuild completed >> "%LOG_FILE%"

:SharpReady

REM Verify sharp can load
echo Verifying sharp module...
"%NODE_EXE%" -e "require('sharp')" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Sharp verification failed
    echo [%date% %time%] Sharp verification failed >> "%LOG_FILE%"
    echo Check log: %LOG_FILE%
    pause
    exit /b 1
) else (
    echo Sharp verification passed!
    echo [%date% %time%] Sharp verification passed >> "%LOG_FILE%"
)

REM ========================================
REM   Create Windows Service
REM ========================================
echo.
echo ========================================
echo   Configuring Auto-Start Service
echo ========================================
echo.

REM Create log directory for bytebotd
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Create service wrapper script
echo Creating service wrapper...
echo [%date% %time%] Creating service wrapper >> "%LOG_FILE%"

set SERVICE_WRAPPER=%INSTALL_ROOT%\run-service.bat
(
  echo @echo off
  echo REM Bytebot Desktop Daemon Service Wrapper
  echo.
  echo set LOG_FILE=%LOG_DIR%\bytebotd-service-%%date:~-4,4%%%%date:~-10,2%%%%date:~-7,2%%-%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%.log
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
  echo echo [%%date%% %%time%%] Starting Bytebot Desktop Daemon... ^>^> "%%LOG_FILE%%"
  echo cd /d "%BYTEBOTD_PATH%" ^>^> "%%LOG_FILE%%" 2^>^&1
  echo "%NODE_EXE%" dist\main.js ^>^> "%%LOG_FILE%%" 2^>^&1
  echo set EXIT_CODE=%%ERRORLEVEL%%
  echo echo [%%date%% %%time%%] Bytebotd exited with code %%EXIT_CODE%% ^>^> "%%LOG_FILE%%"
  echo.
  echo REM Auto-restart on crash after 5 second delay
  echo if %%EXIT_CODE%% NEQ 0 (
  echo   echo [%%date%% %%time%%] Service crashed, restarting in 5 seconds... ^>^> "%%LOG_FILE%%"
  echo   timeout /t 5 /nobreak ^>nul
  echo   goto :RestartLoop
  echo ^)
  echo.
  echo :RestartLoop
  echo REM This label allows the service to restart automatically
  echo goto :EOF
) > "%SERVICE_WRAPPER%"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create service wrapper
    echo [%date% %time%] ERROR: Failed to create service wrapper >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo Service wrapper created: %SERVICE_WRAPPER%
echo [%date% %time%] Service wrapper created >> "%LOG_FILE%"

REM Create Windows Service using sc command
echo Creating Windows Service...
echo [%date% %time%] Creating Windows Service >> "%LOG_FILE%"

REM Delete existing service if present
sc query BytebotService >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Removing existing service...
    sc stop BytebotService >nul 2>&1
    timeout /t 2 /nobreak >nul
    sc delete BytebotService >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM Create service
sc create BytebotService binPath= "\"%SERVICE_WRAPPER%\"" start= auto DisplayName= "Bytebot Desktop Daemon" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQU 0 (
    echo Service created successfully!
    echo [%date% %time%] Service created successfully >> "%LOG_FILE%"

    REM Configure service recovery (auto-restart on failure)
    sc failure BytebotService reset= 86400 actions= restart/5000/restart/10000/restart/30000 >> "%LOG_FILE%" 2>&1

    REM Set service description
    sc description BytebotService "Bytebot Desktop Daemon - AI-powered desktop automation service" >> "%LOG_FILE%" 2>&1

    REM Start service
    echo Starting BytebotService...
    echo [%date% %time%] Starting service >> "%LOG_FILE%"
    sc start BytebotService >> "%LOG_FILE%" 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo WARNING: Failed to create Windows Service
    echo Falling back to scheduled task...
    echo [%date% %time%] WARNING: Service creation failed, using scheduled task >> "%LOG_FILE%"

    REM Fallback: Create scheduled task
    schtasks /create /tn "Bytebot Desktop Daemon" /tr "\"%SERVICE_WRAPPER%\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo Scheduled task created successfully
        schtasks /run /tn "Bytebot Desktop Daemon" >> "%LOG_FILE%" 2>&1
        timeout /t 3 /nobreak >nul
    )
)

REM ========================================
REM   Verify Service is Running
REM ========================================
echo.
echo Verifying service...
echo [%date% %time%] Starting health check verification >> "%LOG_FILE%"

set VERIFY_ATTEMPTS=0
set MAX_VERIFY=15
:VerifyLoop
set /a VERIFY_ATTEMPTS+=1
echo [%date% %time%] Health check attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY% >> "%LOG_FILE%"

REM Check heartbeat file first (faster than HTTP)
if exist "C:\ProgramData\Bytebot\heartbeat.txt" (
    echo SUCCESS: Bytebotd is running! (heartbeat file detected)
    echo [%date% %time%] Heartbeat file detected - service is running >> "%LOG_FILE%"
    goto InstallComplete
)

REM Fallback to HTTP check
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9990/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: Bytebotd is running! (HTTP health check passed)
    echo [%date% %time%] HTTP health check passed - service is running >> "%LOG_FILE%"
    goto InstallComplete
)

if %VERIFY_ATTEMPTS% LSS %MAX_VERIFY% (
    echo Waiting for bytebotd to start... (attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY%)
    timeout /t 2 /nobreak >nul
    goto VerifyLoop
)

echo.
echo WARNING: Bytebotd health check timeout after %MAX_VERIFY% attempts
echo [%date% %time%] WARNING: Health check timeout >> "%LOG_FILE%"
echo Service may still be starting...
echo Check logs: %LOG_DIR%
echo Check service status: sc query BytebotService

:InstallComplete
echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Bytebot Desktop Daemon: %BYTEBOTD_PATH%
echo Node.js Portable: %NODE_PORTABLE%
echo API: http://localhost:9990
echo.
echo Logs:
echo   - Installation: %LOG_FILE%
echo   - Service: %LOG_DIR%\bytebotd-service-*.log
echo.
echo Service Management:
echo   - Check status: sc query BytebotService
echo   - Start service: sc start BytebotService
echo   - Stop service: sc stop BytebotService
echo   - View logs: notepad %LOG_DIR%\bytebotd-service-*.log
echo.

REM Log completion
echo [%date% %time%] Installation completed successfully >> "%LOG_FILE%"

REM Start tray monitor automatically
if exist "C:\OEM\start-tray.bat" (
    echo Starting tray monitor...
    start "" "C:\OEM\start-tray.bat"
)
