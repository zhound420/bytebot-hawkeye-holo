@echo off
REM Bytebot Windows Auto-Install Script
REM Runs automatically during Windows installation via dockur/windows /oem mount

echo ========================================
echo   Bytebot Windows Auto-Install
echo ========================================
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
echo [4/5] Installing Visual Studio Code...
choco install vscode -y --force
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: VSCode installation failed
    pause
    exit /b 1
)
echo VSCode installed successfully
echo.

REM Update PATH to include Node.js, Git, and VSCode (batch-compatible)
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Microsoft VS Code\bin;%PATH%"
echo PATH updated to include Node.js, Git, and VSCode
echo.

REM Verify installations
echo Verifying installations...
where node
where npm
where git
echo.

REM Copy source code from shared folder
echo [5/5] Setting up Bytebot source code...
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
    echo Copying files (excluding .git and node_modules)...
    robocopy "%USERPROFILE%\Desktop\Shared\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /NP /R:2 /W:5 /XD .git node_modules .next dist /NFL /NDL
    if %ERRORLEVEL% LEQ 3 set SOURCE_FOUND=1
) else if exist "C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo" (
    echo Found source at: C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo
    echo Copying files (excluding .git and node_modules)...
    robocopy "C:\Users\Docker\Desktop\Shared\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /NP /R:2 /W:5 /XD .git node_modules .next dist /NFL /NDL
    if %ERRORLEVEL% LEQ 3 set SOURCE_FOUND=1
) else if exist "%USERPROFILE%\Desktop\Shared" (
    echo Found source at: %USERPROFILE%\Desktop\Shared (copying entire folder)
    echo Copying files (excluding .git and node_modules)...
    robocopy "%USERPROFILE%\Desktop\Shared" "%BYTEBOT_DIR%" /E /NP /R:2 /W:5 /XD .git node_modules .next dist /NFL /NDL
    if %ERRORLEVEL% LEQ 3 set SOURCE_FOUND=1
) else if exist "C:\OEM\bytebot-hawkeye-holo" (
    echo Found source at: C:\OEM\bytebot-hawkeye-holo
    echo Copying files (excluding .git and node_modules)...
    robocopy "C:\OEM\bytebot-hawkeye-holo" "%BYTEBOT_DIR%" /E /NP /R:2 /W:5 /XD .git node_modules .next dist /NFL /NDL
    if %ERRORLEVEL% LEQ 3 set SOURCE_FOUND=1
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

REM Create scheduled task for auto-start
echo.
echo Creating auto-start scheduled task...
schtasks /create /tn "Bytebot Desktop Daemon" /tr "node %BYTEBOT_DIR%\packages\bytebotd\dist\main.js" /sc onlogon /ru SYSTEM /rl HIGHEST /f
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create scheduled task
    pause
    exit /b 1
)
echo Scheduled task created successfully

REM Create desktop shortcut for VSCode
echo Creating VSCode desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('C:\Users\Public\Desktop\Visual Studio Code.lnk'); $Shortcut.TargetPath = 'C:\Program Files\Microsoft VS Code\Code.exe'; $Shortcut.Save()"

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Bytebot Desktop Daemon installed at: %BYTEBOT_DIR%
echo Service will start automatically on next login
echo.
echo Installed applications:
echo  - Node.js 20
echo  - Git
echo  - Visual Studio Code
echo.
echo API will be available at: http://localhost:9990
echo Progress WebSocket: ws://localhost:8081
echo.
echo The system will continue Windows setup...
