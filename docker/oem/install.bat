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
set INSTALLER_ZIP=\\host.lan\Data\bytebotd-windows-installer.zip
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

REM Wait for network share to become available
echo Waiting for network share %INSTALLER_ZIP%...
set WAIT_ATTEMPTS=0
set MAX_WAIT=24
:WaitForShare
if exist "%INSTALLER_ZIP%" goto ShareReady
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% GEQ %MAX_WAIT% (
    echo ERROR: Network share not available after 2 minutes
    echo.
    echo Troubleshooting:
    echo   1. Check docker-compose.windows.yml has: ./windows-installer:/shared
    echo   2. Ensure installer exists: docker/windows-installer/bytebotd-windows-installer.zip
    echo   3. Build installer: ./scripts/build-windows-installer.sh
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
cd /d "%BYTEBOTD_PATH%"
npm rebuild sharp --verbose >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Sharp rebuild failed, trying alternative approach...
    echo Reinstalling sharp for win32-x64...
    npm uninstall sharp >> "%LOG_FILE%" 2>&1
    npm install --save-exact sharp@0.33.5 >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install sharp
        echo Check log: %LOG_FILE%
        pause
        exit /b 1
    )
)
echo Sharp module ready for Windows!

echo.
echo ========================================
echo   Configuring Auto-Start
echo ========================================
echo.

REM Create log directory for bytebotd
if not exist "%BYTEBOTD_LOG_DIR%" mkdir "%BYTEBOTD_LOG_DIR%"

REM Verify Node.js
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" (
    echo ERROR: Node.js not found at %NODE_EXE%
    where node
    pause
    exit /b 1
)

echo Node.js: %NODE_EXE%
"%NODE_EXE%" --version

REM Create startup wrapper script
echo Creating startup wrapper...
(
  echo @echo off
  echo REM Bytebot Desktop Daemon Startup Wrapper
  echo.
  echo set LOG_FILE=%BYTEBOTD_LOG_DIR%\bytebotd-%%date:~-4,4%%%%date:~-10,2%%%%date:~-7,2%%-%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%.log
  echo set LOG_FILE=%%LOG_FILE: =0%%
  echo.
  echo echo [%%date%% %%time%%] Starting Bytebot Desktop Daemon... ^> "%%LOG_FILE%%"
  echo cd /d "%BYTEBOTD_PATH%" ^>^> "%%LOG_FILE%%" 2^>^&1
  echo "%NODE_EXE%" dist\main.js ^>^> "%%LOG_FILE%%" 2^>^&1
  echo echo [%%date%% %%time%%] Bytebotd exited with code %%ERRORLEVEL%% ^>^> "%%LOG_FILE%%"
) > "%BYTEBOTD_PATH%\start.bat"

echo Startup wrapper created

REM Create scheduled task
echo Creating scheduled task...
schtasks /create /tn "Bytebot Desktop Daemon" /tr "\"%BYTEBOTD_PATH%\start.bat\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Scheduled task created successfully

    REM Start task immediately
    echo Starting bytebotd service...
    schtasks /run /tn "Bytebot Desktop Daemon" >> "%LOG_FILE%" 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo WARNING: Failed to create scheduled task
)

REM Verify bytebotd is running
echo.
echo Verifying service...
timeout /t 5 /nobreak >nul

set VERIFY_ATTEMPTS=0
set MAX_VERIFY=10
:VerifyLoop
set /a VERIFY_ATTEMPTS+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9990/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: Bytebotd is running!
    goto InstallComplete
)

if %VERIFY_ATTEMPTS% LSS %MAX_VERIFY% (
    echo Waiting for bytebotd to start... (attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY%)
    timeout /t 2 /nobreak >nul
    goto VerifyLoop
)

echo.
echo WARNING: Bytebotd health check timeout
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
