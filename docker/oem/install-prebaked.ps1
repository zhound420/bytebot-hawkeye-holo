#Requires -Version 5.1
<#
.SYNOPSIS
    Installs Bytebotd Desktop Agent from pre-baked package (PowerShell-based installer)

.DESCRIPTION
    This script runs during Windows container first boot to install the pre-baked
    Bytebotd package. It performs the same functions as an MSI installer but can be
    built entirely on Linux without WiX Toolset.

    Installation steps:
    1. Extract package to C:\Program Files\Bytebot\
    2. Rebuild Sharp module for Windows binaries
    3. Create scheduled task for auto-start
    4. Start service immediately
    5. Set up tray icon
    6. Verify health check

.NOTES
    Expected execution time: 30-40 seconds
    Runs as SYSTEM user during first boot
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Set up logging
$LogDir = "C:\Bytebot-Logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = Join-Path $LogDir "install-prebaked.log"
$InstallTime = Get-Date

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogMessage = "[$Timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $LogMessage

    switch ($Level) {
        "ERROR" { Write-Host $Message -ForegroundColor Red }
        "WARN"  { Write-Host $Message -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $Message -ForegroundColor Green }
        default { Write-Host $Message -ForegroundColor Cyan }
    }
}

Write-Log "============================================"
Write-Log "   Bytebotd Pre-baked Image Installer"
Write-Log "   Started: $InstallTime"
Write-Log "============================================"
Write-Log ""

# Configuration
$PackageZip = "C:\OEM\bytebotd-prebaked.zip"
$InstallRoot = "C:\Program Files\Bytebot"
$DataDir = "C:\ProgramData\Bytebot"
$ServiceName = "Bytebotd Desktop Agent"
$HealthUrl = "http://localhost:9990/health"

# Step 1: Verify package exists
Write-Log "Step 1: Verifying package..."
if (-not (Test-Path $PackageZip)) {
    Write-Log "ERROR: Package not found at $PackageZip" "ERROR"
    Write-Log "Expected location: C:\OEM\bytebotd-prebaked.zip" "ERROR"
    exit 1
}

$PackageSize = (Get-Item $PackageZip).Length / 1MB
Write-Log "✓ Package found: $([math]::Round($PackageSize, 2))MB"
Write-Log ""

# Step 2: Extract package
Write-Log "Step 2: Extracting package to $InstallRoot..."

if (Test-Path $InstallRoot) {
    Write-Log "Removing existing installation..." "WARN"
    Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
}

try {
    # Create install directory
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null

    # Extract ZIP
    Write-Log "Extracting ZIP archive (this may take 1-2 minutes)..."
    Expand-Archive -Path $PackageZip -DestinationPath $InstallRoot -Force

    # Move contents from bytebot subdirectory to root if needed
    $BytebotSubdir = Join-Path $InstallRoot "bytebot"
    if (Test-Path $BytebotSubdir) {
        Write-Log "Moving files from subdirectory..."
        Get-ChildItem -Path $BytebotSubdir | Move-Item -Destination $InstallRoot -Force
        Remove-Item -Path $BytebotSubdir -Force
    }

    Write-Log "✓ Package extracted" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to extract package: $_" "ERROR"
    exit 1
}

Write-Log ""

# Step 3: Rebuild Sharp module for Windows
Write-Log "Step 3: Rebuilding Sharp module for Windows..."

$BytebotdDir = Join-Path $InstallRoot "packages\bytebotd"
if (-not (Test-Path $BytebotdDir)) {
    Write-Log "ERROR: Bytebotd directory not found at $BytebotdDir" "ERROR"
    exit 1
}

try {
    Push-Location $BytebotdDir

    Write-Log "Running: npm rebuild sharp --verbose"
    $RebuildLog = Join-Path $LogDir "sharp-rebuild.log"
    npm rebuild sharp --verbose > $RebuildLog 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Log "WARN: Sharp rebuild exited with code $LASTEXITCODE" "WARN"
        Write-Log "Check log: $RebuildLog" "WARN"
        Write-Log "Continuing anyway (Sharp may still work)..." "WARN"
    } else {
        Write-Log "✓ Sharp rebuilt successfully" "SUCCESS"
    }

    Pop-Location
} catch {
    Write-Log "ERROR: Sharp rebuild failed: $_" "ERROR"
    Write-Log "Installation may not function correctly" "WARN"
}

Write-Log ""

# Step 4: Create data directories
Write-Log "Step 4: Creating data directories..."

@($DataDir, $LogDir) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Log "✓ Created $_"
    } else {
        Write-Log "Directory already exists: $_"
    }
}

Write-Log ""

# Step 5: Create scheduled task for auto-start
Write-Log "Step 5: Creating Windows Service (Scheduled Task)..."

$TaskName = $ServiceName
$StartScript = Join-Path $BytebotdDir "start-bytebotd.bat"

# Check if start script exists, create if missing
if (-not (Test-Path $StartScript)) {
    Write-Log "Creating start-bytebotd.bat..."
    $BatchContent = @"
@echo off
cd /d "C:\Program Files\Bytebot\packages\bytebotd"
node dist\main.js > "C:\Bytebot-Logs\bytebotd-stdout.log" 2>&1
"@
    Set-Content -Path $StartScript -Value $BatchContent
}

try {
    # Delete existing task if present
    schtasks /delete /tn "$TaskName" /f 2>$null | Out-Null

    # Create scheduled task
    $TaskAction = New-ScheduledTaskAction -Execute $StartScript
    $TaskTrigger = New-ScheduledTaskTrigger -AtStartup
    $TaskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    $TaskPrincipal = New-ScheduledTaskPrincipal -UserID "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Settings $TaskSettings -Principal $TaskPrincipal -Force | Out-Null

    Write-Log "✓ Scheduled task created: $TaskName" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to create scheduled task: $_" "ERROR"
    exit 1
}

Write-Log ""

# Step 6: Start service
Write-Log "Step 6: Starting Bytebotd service..."

try {
    Start-ScheduledTask -TaskName $TaskName
    Write-Log "✓ Service started" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to start service: $_" "ERROR"
    exit 1
}

Write-Log ""

# Step 7: Wait for service to be ready
Write-Log "Step 7: Waiting for service to be ready (30 seconds)..."
Start-Sleep -Seconds 30

Write-Log ""

# Step 8: Verify health check
Write-Log "Step 8: Verifying service health..."

$MaxAttempts = 6
$AttemptDelay = 10

for ($i = 1; $i -le $MaxAttempts; $i++) {
    Write-Log "Health check attempt $i/$MaxAttempts..."

    try {
        $Response = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 5 -UseBasicParsing
        if ($Response.StatusCode -eq 200) {
            Write-Log "✓ Service is healthy (attempt $i)" "SUCCESS"
            $ServiceHealthy = $true
            break
        }
    } catch {
        Write-Log "Service not ready yet, waiting ${AttemptDelay}s..."
        Start-Sleep -Seconds $AttemptDelay
    }
}

if (-not $ServiceHealthy) {
    Write-Log "WARN: Health check timeout after $MaxAttempts attempts" "WARN"
    Write-Log "Service may still be starting up" "WARN"
}

Write-Log ""

# Step 9: Check heartbeat file
Write-Log "Step 9: Checking heartbeat file..."

$HeartbeatFile = Join-Path $DataDir "heartbeat.txt"
if (Test-Path $HeartbeatFile) {
    $HeartbeatContent = Get-Content $HeartbeatFile -Raw
    Write-Log "✓ Heartbeat file found" "SUCCESS"
    Write-Log "Heartbeat contents:"
    Write-Log $HeartbeatContent
} else {
    Write-Log "WARN: Heartbeat file not found yet (may appear shortly)" "WARN"
}

Write-Log ""

# Step 10: Start tray icon (optional)
Write-Log "Step 10: Starting tray icon monitor..."

$TrayScript = Join-Path $InstallRoot "packages\bytebotd\bytebotd-tray.ps1"
if (Test-Path $TrayScript) {
    try {
        Start-Process powershell -ArgumentList "-WindowStyle Hidden -File `"$TrayScript`"" -NoNewWindow
        Write-Log "✓ Tray icon started" "SUCCESS"
    } catch {
        Write-Log "WARN: Failed to start tray icon: $_" "WARN"
    }
} else {
    Write-Log "Tray icon script not found, skipping"
}

Write-Log ""

# Installation summary
$InstallDuration = (Get-Date) - $InstallTime
Write-Log "============================================"
Write-Log "   Installation Complete!"
Write-Log "   Duration: $([math]::Round($InstallDuration.TotalSeconds, 1))s"
Write-Log "============================================"
Write-Log ""
Write-Log "Bytebotd Desktop Agent is now running."
Write-Log ""
Write-Log "Service status:"
Write-Log "  - Scheduled Task: $TaskName"
Write-Log "  - Port: 9990"
Write-Log "  - Logs: $LogDir"
Write-Log "  - Heartbeat: $HeartbeatFile"
Write-Log ""
Write-Log "Access points:"
Write-Log "  - Health check: http://localhost:9990/health"
Write-Log "  - Web viewer: http://localhost:8006"
Write-Log "  - RDP: localhost:3389"
Write-Log ""

exit 0
