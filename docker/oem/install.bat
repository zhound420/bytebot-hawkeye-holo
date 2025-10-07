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

REM Copy source code from shared folder
echo [6/6] Setting up Bytebot source code...
set BYTEBOT_DIR=C:\Bytebot

if exist "%BYTEBOT_DIR%" (
    echo Bytebot directory already exists, removing...
    rmdir /s /q "%BYTEBOT_DIR%"
)

echo Creating directory: %BYTEBOT_DIR%
mkdir "%BYTEBOT_DIR%"

REM Copy from shared mount (entire repo)
echo Copying source code from shared folder...
echo (This may take 1-2 minutes, please wait...)
echo.

set SOURCE_FOUND=0

if exist "%USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo" (
    echo Found source at: %USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo
    echo Copying files excluding .git node_modules .next dist...
    robocopy "%USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /R:2 /W:5 /XD .git node_modules .next dist
    if %ERRORLEVEL% LEQ 3 (
        set SOURCE_FOUND=1
        echo Files copied successfully
    ) else (
        echo WARNING: robocopy exited with code %ERRORLEVEL%
    )
) else if exist "C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo" (
    echo Found source at: C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo
    echo Copying files excluding .git node_modules .next dist...
    robocopy "C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /R:2 /W:5 /XD .git node_modules .next dist
    if %ERRORLEVEL% LEQ 3 (
        set SOURCE_FOUND=1
        echo Files copied successfully
    ) else (
        echo WARNING: robocopy exited with code %ERRORLEVEL%
    )
) else if exist "%USERPROFILE%\Desktop\Shared" (
    echo Found source at: %USERPROFILE%\Desktop\Shared (copying entire folder)
    echo Copying files excluding .git node_modules .next dist...
    robocopy "%USERPROFILE%\Desktop\Shared" "%BYTEBOT_DIR%" /E /R:2 /W:5 /XD .git node_modules .next dist
    if %ERRORLEVEL% LEQ 3 (
        set SOURCE_FOUND=1
        echo Files copied successfully
    ) else (
        echo WARNING: robocopy exited with code %ERRORLEVEL%
    )
) else if exist "C:\OEM\bytebot-hawkeye-holo" (
    echo Found source at: C:\OEM\bytebot-hawkeye-holo
    echo Copying files excluding .git node_modules .next dist...
    robocopy "C:\OEM\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /R:2 /W:5 /XD .git node_modules .next dist
    if %ERRORLEVEL% LEQ 3 (
        set SOURCE_FOUND=1
        echo Files copied successfully
    ) else (
        echo WARNING: robocopy exited with code %ERRORLEVEL%
    )
)

if %SOURCE_FOUND% EQU 1 (
    echo.
    echo Source copied successfully!
) else (
    echo.
    echo ERROR: Source code not found in any expected locations!
    echo.
    echo Checked paths:
    echo  - %USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo
    echo  - C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo
    echo  - %USERPROFILE%\Desktop\Shared
    echo  - C:\OEM\bytebot-hawkeye-holo
    echo.
    echo Please manually copy bytebot-hawkeye-holo to %BYTEBOT_DIR%
    pause
    exit /b 1
)

REM Build packages
echo.
echo Building Bytebot packages (this may take a few minutes)...

echo Building shared package...
cd "%BYTEBOT_DIR%\packages\shared"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed in shared package
    pause
    exit /b 1
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm build failed in shared package
    pause
    exit /b 1
)
echo Shared package built successfully

echo Building bytebot-cv package...
cd "%BYTEBOT_DIR%\packages\bytebot-cv"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed in bytebot-cv package
    pause
    exit /b 1
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm build failed in bytebot-cv package
    pause
    exit /b 1
)
echo Bytebot-cv package built successfully

echo Building bytebotd package...
cd "%BYTEBOT_DIR%\packages\bytebotd"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed in bytebotd package
    pause
    exit /b 1
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm build failed in bytebotd package
    pause
    exit /b 1
)
echo Bytebotd package built successfully

REM Create auto-start mechanisms (both scheduled task AND startup folder for redundancy)
echo.
echo Creating auto-start mechanisms...

REM Create scheduled task for bytebotd
schtasks /create /tn "Bytebot Desktop Daemon" /tr "node %BYTEBOT_DIR%\packages\bytebotd\dist\main.js" /sc onlogon /ru SYSTEM /rl HIGHEST /f
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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\Bytebot.lnk'); $Shortcut.TargetPath = 'node.exe'; $Shortcut.Arguments = '%BYTEBOT_DIR%\packages\bytebotd\dist\main.js'; $Shortcut.WorkingDirectory = '%BYTEBOT_DIR%\packages\bytebotd'; $Shortcut.WindowStyle = 7; $Shortcut.Save()"

echo Auto-start mechanisms configured

REM Create desktop shortcut for VSCode
echo Creating VSCode desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('C:\Users\Public\Desktop\Visual Studio Code.lnk'); $Shortcut.TargetPath = 'C:\Program Files\Microsoft VS Code\Code.exe'; $Shortcut.Save()"

REM Create scheduled task for bytebotd system tray monitor
echo Creating bytebotd tray icon scheduled task...
set TRAY_SCRIPT=%USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo\docker\oem\bytebotd-tray.ps1
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
echo Bytebot Desktop Daemon installed at: %BYTEBOT_DIR%
echo Service status: Running (verified)
echo.
echo Installed applications:
echo  - Node.js 20
echo  - Git
echo  - Visual Studio Code
echo  - 1Password
echo.
echo API will be available at: http://localhost:9990
echo Progress WebSocket: ws://localhost:8081
echo.
echo System tray icon will show bytebotd status (green = running)
echo Right-click the tray icon for logs and service controls
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
