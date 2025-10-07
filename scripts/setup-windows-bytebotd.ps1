# Bytebot Windows Setup Script
# Run this script inside the Windows 11 container to set up bytebotd

$ErrorActionPreference = "Stop"

Write-Host "=================================" -ForegroundColor Cyan
Write-Host "  Bytebot Windows Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Install Chocolatey if not already installed
Write-Host "Checking for Chocolatey package manager..." -ForegroundColor Blue
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Chocolatey..." -ForegroundColor Yellow
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

        # Refresh environment
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
            throw "Chocolatey installation failed - command not found after install"
        }

        Write-Host "✓ Chocolatey installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Failed to install Chocolatey: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Chocolatey already installed" -ForegroundColor Green
}

# Install Node.js 20
Write-Host ""
Write-Host "Checking for Node.js..." -ForegroundColor Blue
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Node.js 20..." -ForegroundColor Yellow
    try {
        choco install nodejs --version=20.19.0 -y
        if ($LASTEXITCODE -ne 0) {
            throw "Chocolatey install returned exit code $LASTEXITCODE"
        }

        # Refresh environment
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        if (!(Get-Command node -ErrorAction SilentlyContinue)) {
            throw "Node.js installation failed - command not found after install"
        }

        $nodeVersion = node --version
        Write-Host "✓ Node.js installed successfully: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Failed to install Node.js: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    $nodeVersion = node --version
    Write-Host "✓ Node.js already installed: $nodeVersion" -ForegroundColor Green
}

# Install Git (needed for cloning repo)
Write-Host ""
Write-Host "Checking for Git..." -ForegroundColor Blue
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..." -ForegroundColor Yellow
    try {
        choco install git -y
        if ($LASTEXITCODE -ne 0) {
            throw "Chocolatey install returned exit code $LASTEXITCODE"
        }

        # Refresh environment
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        if (!(Get-Command git -ErrorAction SilentlyContinue)) {
            throw "Git installation failed - command not found after install"
        }

        Write-Host "✓ Git installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Failed to install Git: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Git already installed" -ForegroundColor Green
}

# Create bytebotd directory
Write-Host ""
Write-Host "Setting up bytebotd directory..." -ForegroundColor Blue
$bytebotDir = "C:\bytebot"
try {
    if (!(Test-Path $bytebotDir)) {
        New-Item -ItemType Directory -Path $bytebotDir -Force | Out-Null
        Write-Host "✓ Created directory: $bytebotDir" -ForegroundColor Green
    } else {
        Write-Host "✓ Directory already exists: $bytebotDir" -ForegroundColor Green
    }
} catch {
    Write-Host "ERROR: Failed to create directory: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Get source code
Write-Host ""
Write-Host "Getting bytebot source code..." -ForegroundColor Blue

# Try multiple methods to get the source code
$sourceFound = $false

# Method 1: Check for shared folder (Docker volume mount)
$sharedDirs = @(
    "C:\shared\bytebot-hawkeye-holo",
    "\\host.docker.internal\shared",
    "/shared/bytebot-hawkeye-holo"
)

foreach ($sharedDir in $sharedDirs) {
    if (Test-Path $sharedDir) {
        Write-Host "Found shared folder: $sharedDir" -ForegroundColor Yellow
        try {
            Write-Host "Copying source code..." -ForegroundColor Yellow
            Copy-Item -Path "$sharedDir\*" -Destination $bytebotDir -Recurse -Force
            $sourceFound = $true
            Write-Host "✓ Source code copied successfully" -ForegroundColor Green
            break
        } catch {
            Write-Host "WARNING: Failed to copy from $sharedDir : $($_.Exception.Message)" -ForegroundColor Yellow
            continue
        }
    }
}

if (-not $sourceFound) {
    Write-Host "Shared folder not found. Please provide the repository:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Option 1: Clone from Git" -ForegroundColor Cyan
    Write-Host "  git clone <repository-url> $bytebotDir" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Option 2: Copy files manually to $bytebotDir" -ForegroundColor Cyan
    Write-Host ""
    $response = Read-Host "Do you want to continue with manual setup? (y/n)"
    if ($response -ne "y") {
        Write-Host "Setup cancelled. Please add source code and re-run this script." -ForegroundColor Yellow
        exit 0
    }
}

# Verify source code exists
Write-Host ""
Write-Host "Verifying source code..." -ForegroundColor Blue
$requiredDirs = @(
    "$bytebotDir\packages\shared",
    "$bytebotDir\packages\bytebot-cv",
    "$bytebotDir\packages\bytebotd"
)

foreach ($dir in $requiredDirs) {
    if (!(Test-Path $dir)) {
        Write-Host "ERROR: Required directory not found: $dir" -ForegroundColor Red
        Write-Host "Please ensure the complete source code is in $bytebotDir" -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "✓ Source code verified" -ForegroundColor Green

# Install dependencies
Write-Host ""
Write-Host "Installing bytebotd dependencies (this may take a few minutes)..." -ForegroundColor Blue

try {
    # Build shared package
    Write-Host "→ Building shared package..." -ForegroundColor Yellow
    Set-Location "$bytebotDir\packages\shared"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in shared" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed in shared" }
    Write-Host "  ✓ Shared package built" -ForegroundColor Green

    # Build bytebot-cv package
    Write-Host "→ Building bytebot-cv package..." -ForegroundColor Yellow
    Set-Location "$bytebotDir\packages\bytebot-cv"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in bytebot-cv" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed in bytebot-cv" }
    Write-Host "  ✓ bytebot-cv package built" -ForegroundColor Green

    # Build bytebotd package
    Write-Host "→ Building bytebotd package..." -ForegroundColor Yellow
    Set-Location "$bytebotDir\packages\bytebotd"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in bytebotd" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed in bytebotd" }
    Write-Host "  ✓ bytebotd package built" -ForegroundColor Green

} catch {
    Write-Host "ERROR: Failed to build packages: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check the output above for npm errors" -ForegroundColor Yellow
    exit 1
}

# Create startup script
Write-Host ""
Write-Host "Creating startup script..." -ForegroundColor Blue
try {
    $startupScript = @"
# Bytebot Startup Script
Write-Host "Starting Bytebot Desktop Daemon..." -ForegroundColor Cyan
Set-Location C:\bytebot\packages\bytebotd
node dist\main.js
"@
    $startupScript | Out-File -FilePath "C:\bytebot\start-bytebotd.ps1" -Encoding UTF8 -Force
    Write-Host "✓ Startup script created" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to create startup script: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create Windows Task Scheduler entry for auto-start
Write-Host ""
Write-Host "Setting up auto-start..." -ForegroundColor Blue
try {
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\bytebot\start-bytebotd.ps1"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    # Unregister existing task if present
    Unregister-ScheduledTask -TaskName "Bytebot Desktop Daemon" -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask -TaskName "Bytebot Desktop Daemon" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "✓ Auto-start configured" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Failed to create scheduled task: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "You'll need to start bytebotd manually" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host ""
Write-Host "Bytebotd will start automatically on next boot." -ForegroundColor White
Write-Host ""
Write-Host "To start manually now:" -ForegroundColor Yellow
Write-Host "  cd C:\bytebot\packages\bytebotd" -ForegroundColor Cyan
Write-Host "  node dist\main.js" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service will be available on:" -ForegroundColor White
Write-Host "  - API: http://localhost:9990" -ForegroundColor Cyan
Write-Host "  - Progress WS: ws://localhost:8081" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
