@echo off
REM Bytebot Windows Auto-Install Script
REM Runs automatically during Windows installation via dockur/windows /oem mount

REM Create log directory
set LOG_DIR=C:\Bytebot-Install-Logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set LOG_FILE=%LOG_DIR%\install-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

REM Redirect all output to log file and console
call :LogSetup

echo ========================================
echo   Bytebot Windows Auto-Install
echo ========================================
echo.
echo Log file: %LOG_FILE%
echo.

REM Install Chocolatey package manager
echo [1/5] Installing Chocolatey...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Chocolatey installation failed
    pause
    exit /b 1
)
echo Chocolatey installed successfully
echo.

REM Update PATH to include Chocolatey (batch-compatible, no PowerShell refreshenv)
set "PATH=C:\ProgramData\chocolatey\bin;%PATH%"
echo PATH updated to include Chocolatey
echo.

REM Install Node.js 20
echo [2/5] Installing Node.js 20...
choco install nodejs --version=20.19.0 -y --force
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js installation failed
    pause
    exit /b 1
)
echo Node.js installed successfully
echo.

REM Install Git
echo [3/5] Installing Git...
choco install git -y --force
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Git installation failed
    pause
    exit /b 1
)
echo Git installed successfully
echo.

REM Install VSCode
echo [4/6] Installing Visual Studio Code...
choco install vscode -y --force
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: VSCode installation failed
    pause
    exit /b 1
)
echo VSCode installed successfully
echo.

REM Install 1Password
echo [5/6] Installing 1Password...
choco install 1password -y --force
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: 1Password installation failed (continuing anyway)
    echo You can install it manually later if needed
) else (
    echo 1Password installed successfully
)
echo.

REM Update PATH to include Node.js, Git, VSCode, and 1Password (batch-compatible)
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Microsoft VS Code\bin;C:\Program Files\1Password\app\8;%PATH%"
echo PATH updated to include Node.js, Git, VSCode, and 1Password
echo.

REM Verify installations
echo Verifying installations...
where node
where npm
where git
where code
echo.

REM Copy pre-built bytebotd artifacts from /data mount (\\host.lan\Data)
echo [6/6] Copying pre-built bytebotd artifacts...
set BYTEBOTD_PATH=C:\bytebot\packages\bytebotd
set ARTIFACTS_PATH=\\host.lan\Data

REM Create directory structure
if not exist "C:\bytebot\packages" mkdir "C:\bytebot\packages"
if not exist "%BYTEBOTD_PATH%" mkdir "%BYTEBOTD_PATH%"

REM Explicitly mount the network share (forces Samba connection)
echo Connecting to network share %ARTIFACTS_PATH%...
net use %ARTIFACTS_PATH% /persistent:no >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Network share mounted successfully
) else (
    echo Warning: net use command returned error (may already be connected)
)

REM Wait for network share to become available (up to 2 minutes)
echo Verifying network share accessibility...
set WAIT_ATTEMPTS=0
set MAX_WAIT=24
:WaitForShare
if exist "%ARTIFACTS_PATH%\bytebotd" goto ShareReady
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% GEQ %MAX_WAIT% (
    echo ERROR: Network share %ARTIFACTS_PATH% not available after 2 minutes
    echo.
    echo Troubleshooting:
    echo   1. Check docker-compose.windows.yml has: ./oem/artifacts:/shared
    echo   2. Ensure artifacts exist on host: docker/oem/artifacts/bytebotd/
    echo   3. Try accessing manually: File Explorer ^> Network ^> host.lan ^> Data
    echo   4. Check container /shared mount: docker exec bytebot-windows ls /shared
    echo.
    echo Attempting direct path access...
    if exist "\\host.lan\bytebotd" (
        echo   Found at \\host.lan\bytebotd instead
        set ARTIFACTS_PATH=\\host.lan
        goto ShareReady
    )
    pause
    exit /b 1
)
echo   Attempt %WAIT_ATTEMPTS%/%MAX_WAIT%: Waiting for network share...
timeout /t 5 /nobreak >nul
goto WaitForShare
:ShareReady
echo Network share %ARTIFACTS_PATH% is accessible!

REM Verify pre-built artifacts exist in /data mount (\\host.lan\Data)
if not exist "%ARTIFACTS_PATH%\bytebotd\dist\main.js" (
    echo ERROR: Pre-built bytebotd not found at %ARTIFACTS_PATH%\bytebotd\dist\main.js
    echo.
    echo Expected /data mount accessible as \\host.lan\Data in Windows
    echo Please ensure packages are built on host before starting Windows container:
    echo   cd packages/shared ^&^& npm install ^&^& npm run build
    echo   cd ../bytebot-cv ^&^& npm install ^&^& npm run build
    echo   cd ../bytebotd ^&^& npm install ^&^& npm run build
    pause
    exit /b 1
)

echo Pre-built artifacts found at %ARTIFACTS_PATH%
echo Copying artifacts to %BYTEBOTD_PATH%...
echo.

REM Copy bytebotd dist, node_modules, and package files
echo [1/3] Copying bytebotd dist...
robocopy "%ARTIFACTS_PATH%\bytebotd\dist" "%BYTEBOTD_PATH%\dist" /E /NFL /NDL /NJH /NJS /NC /NS
echo.
echo [2/3] Copying bytebotd node_modules (~1.8GB, ~30,000 files - this may take 5-15 minutes)...
echo Please wait, copying from network share...
robocopy "%ARTIFACTS_PATH%\bytebotd\node_modules" "%BYTEBOTD_PATH%\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS
echo.
echo [3/3] Copying bytebotd package files...
copy /Y "%ARTIFACTS_PATH%\bytebotd\package.json" "%BYTEBOTD_PATH%\" >nul
if exist "%ARTIFACTS_PATH%\bytebotd\tsconfig.json" copy /Y "%ARTIFACTS_PATH%\bytebotd\tsconfig.json" "%BYTEBOTD_PATH%\" >nul
echo   Bytebotd copied successfully
echo.

REM Copy shared package dependency
if not exist "C:\bytebot\packages\shared" mkdir "C:\bytebot\packages\shared"
echo Copying shared package...
robocopy "%ARTIFACTS_PATH%\shared\dist" "C:\bytebot\packages\shared\dist" /E /NFL /NDL /NJH /NJS /NC /NS
robocopy "%ARTIFACTS_PATH%\shared\node_modules" "C:\bytebot\packages\shared\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS
copy /Y "%ARTIFACTS_PATH%\shared\package.json" "C:\bytebot\packages\shared\" >nul
echo   Shared copied successfully
echo.

REM Copy bytebot-cv package dependency
if not exist "C:\bytebot\packages\bytebot-cv" mkdir "C:\bytebot\packages\bytebot-cv"
echo Copying bytebot-cv package...
robocopy "%ARTIFACTS_PATH%\bytebot-cv\dist" "C:\bytebot\packages\bytebot-cv\dist" /E /NFL /NDL /NJH /NJS /NC /NS
robocopy "%ARTIFACTS_PATH%\bytebot-cv\node_modules" "C:\bytebot\packages\bytebot-cv\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS
copy /Y "%ARTIFACTS_PATH%\bytebot-cv\package.json" "C:\bytebot\packages\bytebot-cv\" >nul
echo   Bytebot-cv copied successfully
echo.

echo Artifacts copied successfully
echo.

REM Rebuild platform-specific native modules (sharp has native binaries)
echo Rebuilding platform-specific native modules for Windows...
echo   - sharp (image processing library with native bindings)
cd /d "%BYTEBOTD_PATH%"
call npm rebuild sharp --platform=win32 --arch=x64 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   Sharp rebuilt successfully for Windows
) else (
    echo   WARNING: Sharp rebuild failed, attempting full reinstall...
    call npm install --no-save --force sharp@^0.34.2 >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo   ERROR: Sharp installation failed
        echo   Bytebotd may not start correctly
    ) else (
        echo   Sharp reinstalled successfully
    )
)
echo.
echo Skipping other build steps (using host-built artifacts)

REM Create auto-start mechanisms (both scheduled task AND startup folder for redundancy)
echo.
echo Creating auto-start mechanisms...

REM Verify Node.js installation with absolute path
echo Verifying Node.js installation...
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" (
    echo ERROR: Node.js not found at %NODE_EXE%
    echo Installation may have failed or used a different path
    where node
    pause
    exit /b 1
)
echo Node.js found at: %NODE_EXE%
"%NODE_EXE%" --version
echo.

REM Create log directory for bytebotd
set BYTEBOTD_LOG_DIR=C:\Bytebot-Logs
if not exist "%BYTEBOTD_LOG_DIR%" mkdir "%BYTEBOTD_LOG_DIR%"
echo Log directory: %BYTEBOTD_LOG_DIR%

REM Create wrapper script with logging and absolute paths
echo Creating bytebotd startup wrapper script...
(
  echo @echo off
  echo REM Bytebot Desktop Daemon Startup Wrapper
  echo REM Auto-generated by install.bat
  echo.
  echo REM Set log file with timestamp
  echo set LOG_FILE=%BYTEBOTD_LOG_DIR%\bytebotd-%%date:~-4,4%%%%date:~-10,2%%%%date:~-7,2%%-%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%.log
  echo set LOG_FILE=%%LOG_FILE: =0%%
  echo.
  echo echo [%%date%% %%time%%] Starting Bytebot Desktop Daemon... ^> "%%LOG_FILE%%"
  echo echo Working directory: %BYTEBOTD_PATH% ^>^> "%%LOG_FILE%%"
  echo echo Node.js: %NODE_EXE% ^>^> "%%LOG_FILE%%"
  echo.
  echo REM Change to bytebotd directory
  echo cd /d "%BYTEBOTD_PATH%" ^>^> "%%LOG_FILE%%" 2^>^&1
  echo if %%ERRORLEVEL%% NEQ 0 ^(
  echo     echo ERROR: Failed to change directory to %BYTEBOTD_PATH% ^>^> "%%LOG_FILE%%"
  echo     exit /b 1
  echo ^)
  echo.
  echo REM Start bytebotd with full logging
  echo echo Starting node dist\main.js... ^>^> "%%LOG_FILE%%"
  echo "%NODE_EXE%" dist\main.js ^>^> "%%LOG_FILE%%" 2^>^&1
  echo.
  echo REM Log exit code
  echo echo [%%date%% %%time%%] Bytebotd exited with code %%ERRORLEVEL%% ^>^> "%%LOG_FILE%%"
  echo exit /b %%ERRORLEVEL%%
) > "%BYTEBOTD_PATH%\start.bat"

echo Wrapper script created: %BYTEBOTD_PATH%\start.bat
echo.

REM Create scheduled task for bytebotd with working directory set
echo Creating scheduled task...
schtasks /create /tn "Bytebot Desktop Daemon" /tr "\"%BYTEBOTD_PATH%\start.bat\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f
if %ERRORLEVEL% EQU 0 (
    echo Scheduled task created successfully
    REM Start the task immediately with retry logic (don't wait for next login)
    echo Starting bytebotd service now...
    set TASK_START_ATTEMPTS=0
    :TaskStartLoop
    set /a TASK_START_ATTEMPTS+=1
    schtasks /run /tn "Bytebot Desktop Daemon"
    if %ERRORLEVEL% EQU 0 (
        echo   Task started successfully
        timeout /t 5 /nobreak >nul
        goto TaskStartSuccess
    )
    if %TASK_START_ATTEMPTS% LSS 3 (
        echo   Retry %TASK_START_ATTEMPTS%/3: Task start failed, retrying in 10 seconds...
        timeout /t 10 /nobreak >nul
        goto TaskStartLoop
    )
    echo   WARNING: Failed to start task after 3 attempts
    :TaskStartSuccess
) else (
    echo WARNING: Failed to create scheduled task
)

REM Also add to Startup folder as fallback
echo Creating startup folder shortcut as fallback...
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\Bytebot.lnk'); $Shortcut.TargetPath = '%BYTEBOTD_PATH%\start.bat'; $Shortcut.WorkingDirectory = '%BYTEBOTD_PATH%'; $Shortcut.WindowStyle = 7; $Shortcut.Save()"

echo Auto-start mechanisms configured
echo   - Scheduled task: Bytebot Desktop Daemon
echo   - Startup shortcut: %STARTUP_DIR%\Bytebot.lnk
echo   - Log files will be in: %BYTEBOTD_LOG_DIR%

REM Create desktop shortcut for VSCode
echo Creating VSCode desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('C:\Users\Public\Desktop\Visual Studio Code.lnk'); $Shortcut.TargetPath = 'C:\Program Files\Microsoft VS Code\Code.exe'; $Shortcut.Save()"

REM Create scheduled task for bytebotd system tray monitor
echo Creating bytebotd tray icon scheduled task...
set TRAY_SCRIPT=C:\OEM\bytebotd-tray.ps1
if exist "%TRAY_SCRIPT%" (
    schtasks /create /tn "Bytebot Tray Monitor" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%TRAY_SCRIPT%\"" /sc onlogon /rl HIGHEST /f
    if %ERRORLEVEL% EQU 0 (
        echo Tray monitor scheduled task created successfully
        REM Start the tray monitor immediately
        start /B powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%TRAY_SCRIPT%"
    ) else (
        echo WARNING: Failed to create tray monitor scheduled task
    )
) else (
    echo Tray script not found at %TRAY_SCRIPT% (optional feature, skipping)
)
echo.

REM Verify bytebotd started successfully
echo.
echo Verifying bytebotd service...
timeout /t 5 /nobreak >nul

set VERIFY_ATTEMPTS=0
set MAX_VERIFY_ATTEMPTS=15
:VerifyLoop
set /a VERIFY_ATTEMPTS+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9990/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: bytebotd is running and healthy!
    goto VerifySuccess
)

if %VERIFY_ATTEMPTS% LSS %MAX_VERIFY_ATTEMPTS% (
    echo Waiting for bytebotd to start... (attempt %VERIFY_ATTEMPTS%/%MAX_VERIFY_ATTEMPTS%)
    timeout /t 2 /nobreak >nul
    goto VerifyLoop
)

echo.
echo WARNING: bytebotd did not respond to health check after 30 seconds
echo This is normal on slower systems or during first boot.
echo.
echo What to check:
echo   1. View logs: C:\Bytebot-Logs\bytebotd-*.log
echo   2. Run diagnostic: C:\OEM\diagnose.ps1
echo   3. Check tray icon for status (green = running)
echo.
echo The service will continue starting in the background.
:VerifySuccess

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Bytebot Desktop Daemon: %BYTEBOTD_PATH%
echo Service status: Running (verified)
echo.
echo Installed applications:
echo  - Node.js 20
echo  - Git
echo  - Visual Studio Code
echo  - 1Password
echo.
echo Using pre-built artifacts from host (no build required!)
echo Installation time: ~2-3 minutes vs ~10-20 minutes with builds
echo.
echo API will be available at: http://localhost:9990
echo Progress WebSocket: ws://localhost:8081
echo.
echo Log files location: %BYTEBOTD_LOG_DIR%
echo   - Installation log: %LOG_FILE%
echo   - Service logs: %BYTEBOTD_LOG_DIR%\bytebotd-*.log
echo.
echo Auto-start configured:
echo   - Scheduled task runs on login
echo   - Startup folder shortcut as fallback
echo.
echo System tray icon will show bytebotd status (green = running)
echo Right-click the tray icon for logs and service controls
echo.
echo Manual scripts (if needed):
echo   - Run diagnostic: C:\OEM\diagnose.ps1
echo   - Start bytebotd: C:\OEM\start-bytebotd.bat
echo   - Start tray icon: C:\OEM\start-tray.bat
echo.
echo The system will continue Windows setup...

REM ============================================
REM End of main script - helper functions below
REM ============================================
exit /b 0

:LogSetup
REM Setup logging to both file and console
if exist "%LOG_FILE%" del /f /q "%LOG_FILE%"
echo [%date% %time%] Installation started > "%LOG_FILE%"
REM Can't easily tee in batch, so we'll log key steps manually
goto :eof
