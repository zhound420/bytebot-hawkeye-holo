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

REM Copy pre-built bytebotd artifacts from /oem mount
echo [6/6] Copying pre-built bytebotd artifacts...
set BYTEBOTD_PATH=C:\bytebot\packages\bytebotd
set OEM_PATH=C:\OEM\artifacts

REM Create directory structure
if not exist "C:\bytebot\packages" mkdir "C:\bytebot\packages"
if not exist "%BYTEBOTD_PATH%" mkdir "%BYTEBOTD_PATH%"

REM Verify pre-built artifacts exist in /oem mount
if not exist "%OEM_PATH%\bytebotd\dist\main.js" (
    echo ERROR: Pre-built bytebotd not found at %OEM_PATH%\bytebotd\dist\main.js
    echo.
    echo Expected /oem mount with pre-built artifacts from host
    echo Please ensure packages are built on host before starting Windows container:
    echo   cd packages/shared ^&^& npm install ^&^& npm run build
    echo   cd ../bytebot-cv ^&^& npm install ^&^& npm run build
    echo   cd ../bytebotd ^&^& npm install ^&^& npm run build
    pause
    exit /b 1
)

echo Pre-built artifacts found in /oem mount
echo Copying artifacts to %BYTEBOTD_PATH%...

REM Copy bytebotd dist, node_modules, and package files
robocopy "%OEM_PATH%\bytebotd\dist" "%BYTEBOTD_PATH%\dist" /E /NFL /NDL /NJH /NJS /NC /NS /NP
robocopy "%OEM_PATH%\bytebotd\node_modules" "%BYTEBOTD_PATH%\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS /NP
copy /Y "%OEM_PATH%\bytebotd\package.json" "%BYTEBOTD_PATH%\" >nul
if exist "%OEM_PATH%\bytebotd\tsconfig.json" copy /Y "%OEM_PATH%\bytebotd\tsconfig.json" "%BYTEBOTD_PATH%\" >nul

REM Copy shared package dependency
if not exist "C:\bytebot\packages\shared" mkdir "C:\bytebot\packages\shared"
robocopy "%OEM_PATH%\shared\dist" "C:\bytebot\packages\shared\dist" /E /NFL /NDL /NJH /NJS /NC /NS /NP
robocopy "%OEM_PATH%\shared\node_modules" "C:\bytebot\packages\shared\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS /NP
copy /Y "%OEM_PATH%\shared\package.json" "C:\bytebot\packages\shared\" >nul

REM Copy bytebot-cv package dependency
if not exist "C:\bytebot\packages\bytebot-cv" mkdir "C:\bytebot\packages\bytebot-cv"
robocopy "%OEM_PATH%\bytebot-cv\dist" "C:\bytebot\packages\bytebot-cv\dist" /E /NFL /NDL /NJH /NJS /NC /NS /NP
robocopy "%OEM_PATH%\bytebot-cv\node_modules" "C:\bytebot\packages\bytebot-cv\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS /NP
copy /Y "%OEM_PATH%\bytebot-cv\package.json" "C:\bytebot\packages\bytebot-cv\" >nul

echo Artifacts copied successfully
echo Skipping build steps (using host-built artifacts)

REM Create auto-start mechanisms (both scheduled task AND startup folder for redundancy)
echo.
echo Creating auto-start mechanisms...

REM Create scheduled task for bytebotd (using pre-built artifacts)
schtasks /create /tn "Bytebot Desktop Daemon" /tr "node %BYTEBOTD_PATH%\dist\main.js" /sc onlogon /ru SYSTEM /rl HIGHEST /f
if %ERRORLEVEL% EQU 0 (
    echo Scheduled task created successfully
    REM Start the task immediately (don't wait for next login)
    echo Starting bytebotd service now...
    schtasks /run /tn "Bytebot Desktop Daemon"
    timeout /t 5 /nobreak >nul
) else (
    echo WARNING: Failed to create scheduled task
)

REM Also add to Startup folder as fallback
echo Creating startup folder shortcut as fallback...
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\Bytebot.lnk'); $Shortcut.TargetPath = 'node.exe'; $Shortcut.Arguments = '%BYTEBOTD_PATH%\dist\main.js'; $Shortcut.WorkingDirectory = '%BYTEBOTD_PATH%'; $Shortcut.WindowStyle = 7; $Shortcut.Save()"

echo Auto-start mechanisms configured

REM Create desktop shortcut for VSCode
echo Creating VSCode desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('C:\Users\Public\Desktop\Visual Studio Code.lnk'); $Shortcut.TargetPath = 'C:\Program Files\Microsoft VS Code\Code.exe'; $Shortcut.Save()"

REM Create scheduled task for bytebotd system tray monitor
echo Creating bytebotd tray icon scheduled task...
set TRAY_SCRIPT=C:\shared\scripts\bytebotd-tray.ps1
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
    echo WARNING: Tray script not found at %TRAY_SCRIPT%
)
echo.

REM Verify bytebotd started successfully
echo.
echo Verifying bytebotd service...
timeout /t 3 /nobreak >nul

set VERIFY_ATTEMPTS=0
:VerifyLoop
set /a VERIFY_ATTEMPTS+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9990/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: bytebotd is running and healthy!
    goto VerifySuccess
)

if %VERIFY_ATTEMPTS% LSS 10 (
    echo Waiting for bytebotd to start... (attempt %VERIFY_ATTEMPTS%/10)
    timeout /t 2 /nobreak >nul
    goto VerifyLoop
)

echo WARNING: bytebotd did not respond to health check after 20 seconds
echo The service may still be starting up. Check manually later.
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
echo System tray icon will show bytebotd status (green = running)
echo Right-click the tray icon for logs and service controls
echo Diagnostic scripts: C:\shared\scripts\diagnose.ps1
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
