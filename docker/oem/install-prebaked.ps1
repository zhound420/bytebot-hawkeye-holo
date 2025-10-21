#Requires -Version 5.1
<#
.SYNOPSIS
    Installs Bytebotd Desktop Agent from pre-baked package (PowerShell-based installer)

.DESCRIPTION
    This script runs during Windows container first boot to install the pre-baked
    Bytebotd package. It performs the same functions as an MSI installer but can be
    built entirely on Linux without WiX Toolset.

    Installation steps:
    1. Verify package exists
    2. Extract package with 7za.exe (10-30s) or Expand-Archive fallback (1-2min)
    3. Install Node.js portable
    4. Create data directories
    5. Create startup shortcut for auto-start
    5.5. Configure Windows Firewall for port 9990
    5.7. Install applications (VS Code, Firefox) with desktop icons
    6. Wait for user login, then start service
    7. Wait for service to be ready
    8. Verify health check
    9. Check heartbeat file
    10. Start tray icon monitor

.NOTES
    Expected execution time: 4-8 minutes (includes Node.js + 2 applications download/install)
    7za.exe is bundled in C:\OEM\ (no network dependency)
    Runs as SYSTEM user during first boot
    Installs: VS Code, Firefox (both with desktop shortcuts)
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

# Use local 7za.exe from OEM folder (bundled with installer)
$SevenZipExe = "C:\OEM\7za.exe"

if (Test-Path $InstallRoot) {
    Write-Log "Removing existing installation..." "WARN"
    Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
}

try {
    # Create install directory
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null

    # Extract ZIP (7za.exe multi-threaded or PowerShell fallback)
    $ExtractionStart = Get-Date

    if (Test-Path $SevenZipExe) {
        Write-Log "Using 7za.exe multi-threaded extraction (10-30 seconds)..."
        Write-Log "7za.exe location: $SevenZipExe"
        $Result = & $SevenZipExe x -y "-o$InstallRoot" $PackageZip 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Log "WARN: 7za.exe extraction failed (exit code $LASTEXITCODE), falling back to Expand-Archive..." "WARN"
            Expand-Archive -Path $PackageZip -DestinationPath $InstallRoot -Force
            $ExtractionTime = ((Get-Date) - $ExtractionStart).TotalSeconds
            Write-Log "✓ Expand-Archive completed in $([math]::Round($ExtractionTime, 1))s" "SUCCESS"
        } else {
            $ExtractionTime = ((Get-Date) - $ExtractionStart).TotalSeconds
            Write-Log "✓ 7za.exe extraction completed in $([math]::Round($ExtractionTime, 1))s" "SUCCESS"
        }
    } else {
        Write-Log "WARN: 7za.exe not found at $SevenZipExe, using Expand-Archive fallback..." "WARN"
        Write-Log "Using Expand-Archive (this may take 1-2 minutes, slower fallback)..."
        Expand-Archive -Path $PackageZip -DestinationPath $InstallRoot -Force
        $ExtractionTime = ((Get-Date) - $ExtractionStart).TotalSeconds
        Write-Log "✓ Expand-Archive completed in $([math]::Round($ExtractionTime, 1))s" "SUCCESS"
    }

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

# Step 3: Install Node.js (portable)
Write-Log "Step 3: Installing Node.js..."

$NodeInstallPath = "C:\Program Files\nodejs"
if (-not (Test-Path $NodeInstallPath)) {
    Write-Log "Downloading Node.js portable..."
    $NodeVersion = "v20.18.1"
    $NodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
    $NodeZip = Join-Path $env:TEMP "node.zip"

    try {
        # Download Node.js
        Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
        Write-Log "✓ Downloaded Node.js"

        # Extract to Program Files (use local 7za.exe if available)
        if (Test-Path $SevenZipExe) {
            Write-Log "Extracting Node.js with 7za.exe..."
            & $SevenZipExe x -y "-oC:\Program Files" $NodeZip 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Log "7za.exe failed, using Expand-Archive fallback..."
                Expand-Archive -Path $NodeZip -DestinationPath "C:\Program Files" -Force
            }
        } else {
            Expand-Archive -Path $NodeZip -DestinationPath "C:\Program Files" -Force
        }

        # Rename extracted folder
        $ExtractedFolder = Join-Path "C:\Program Files" "node-$NodeVersion-win-x64"
        if (Test-Path $ExtractedFolder) {
            Rename-Item -Path $ExtractedFolder -NewName "nodejs" -Force
        }

        # Clean up
        Remove-Item $NodeZip -Force -ErrorAction SilentlyContinue

        Write-Log "✓ Node.js installed to $NodeInstallPath" "SUCCESS"
    } catch {
        Write-Log "WARN: Failed to install Node.js: $_" "WARN"
        Write-Log "Bytebotd may not start without Node.js" "WARN"
    }
} else {
    Write-Log "✓ Node.js already installed" "SUCCESS"
}

# Verify Sharp module
$BytebotdDir = Join-Path $InstallRoot "packages\bytebotd"
if (-not (Test-Path $BytebotdDir)) {
    Write-Log "ERROR: Bytebotd directory not found at $BytebotdDir" "ERROR"
    exit 1
}

$SharpPath = Join-Path $BytebotdDir "node_modules\sharp"
if (Test-Path $SharpPath) {
    Write-Log "✓ Sharp module found (pre-built for Windows)" "SUCCESS"
} else {
    Write-Log "WARN: Sharp module not found, image processing may not work" "WARN"
}

Write-Log ""

# Step 3.5: Install Visual C++ Redistributable (required for nut.js native addon)
Write-Log "Step 3.5: Installing Visual C++ Redistributable..."

try {
    # Check if already installed (registry key check)
    $VCRedistInstalled = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" -ErrorAction SilentlyContinue

    if ($VCRedistInstalled -and $VCRedistInstalled.Installed -eq 1) {
        Write-Log "✓ Visual C++ Redistributable already installed (version $($VCRedistInstalled.Version))" "SUCCESS"
    } else {
        Write-Log "Downloading Visual C++ Redistributable 2015-2022 (x64)..."
        $VCRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        $VCRedistExe = Join-Path $env:TEMP "vc_redist.x64.exe"

        # Download VC++ Redistributable
        Invoke-WebRequest -Uri $VCRedistUrl -OutFile $VCRedistExe -UseBasicParsing
        Write-Log "✓ Downloaded Visual C++ Redistributable"

        # Install silently (no restart required)
        Write-Log "Installing Visual C++ Redistributable (this may take 1-2 minutes)..."
        $InstallProcess = Start-Process -FilePath $VCRedistExe -ArgumentList "/install", "/quiet", "/norestart" -Wait -NoNewWindow -PassThru

        if ($InstallProcess.ExitCode -eq 0 -or $InstallProcess.ExitCode -eq 3010) {
            Write-Log "✓ Visual C++ Redistributable installed successfully" "SUCCESS"
        } elseif ($InstallProcess.ExitCode -eq 1638) {
            Write-Log "✓ Visual C++ Redistributable already installed (newer version)" "SUCCESS"
        } else {
            Write-Log "WARN: Visual C++ Redistributable installation returned exit code $($InstallProcess.ExitCode)" "WARN"
            Write-Log "nut.js may not work without Visual C++ Redistributable" "WARN"
        }

        # Clean up
        Remove-Item $VCRedistExe -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Log "WARN: Failed to install Visual C++ Redistributable: $_" "WARN"
    Write-Log "nut.js keyboard/mouse automation may not work" "WARN"
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

# Step 5: Create startup script for auto-start via Windows Startup folder
Write-Log "Step 5: Creating Windows Startup Script..."

$StartupScriptPath = Join-Path $BytebotdDir "start-service.ps1"
$NodeExe = Join-Path $NodeInstallPath "node.exe"

Write-Log "PowerShell startup script: $StartupScriptPath"
Write-Log "Node.js executable: $NodeExe"

# Create PowerShell startup script using Start-Process (proper backgrounding)
Write-Log "Creating PowerShell startup script..."

$StartupScript = @"
`$ErrorActionPreference = "SilentlyContinue"

# Change to bytebotd directory
Set-Location "C:\Program Files\Bytebot\packages\bytebotd"

# Load Holo IP configuration from container
if (Test-Path "C:\OEM\holo-config.bat") {
    `$holoConfigContent = Get-Content "C:\OEM\holo-config.bat"
    foreach (`$line in `$holoConfigContent) {
        if (`$line -match "set HOLO_URL=(.+)") {
            `$env:HOLO_URL = `$matches[1]
            Write-Host "Loaded Holo URL: `$(`$env:HOLO_URL)"
        }
    }
} else {
    Write-Host "WARNING: Holo config not found, using default"
    `$env:HOLO_URL = "http://bytebot-holo:9989"
}

# Set Holo environment variables
`$env:BYTEBOT_CV_USE_HOLO = "true"
`$env:HOLO_TIMEOUT = "120000"

# Kill any existing node processes (prevent port conflicts)
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Wait for port to be released
Start-Sleep -Seconds 2

# Start bytebotd with Start-Process (proper backgrounding)
Start-Process -FilePath "$NodeExe" ``
    -ArgumentList "dist\main.js" ``
    -NoNewWindow ``
    -RedirectStandardOutput "C:\Bytebot-Logs\bytebotd-stdout.log" ``
    -RedirectStandardError "C:\Bytebot-Logs\bytebotd-stderr.log" ``
    -WorkingDirectory "C:\Program Files\Bytebot\packages\bytebotd"

# Give service time to start
Start-Sleep -Seconds 5

# Verify service started
`$nodeProcess = Get-Process -Name node -ErrorAction SilentlyContinue
if (`$nodeProcess) {
    Write-Host "Bytebotd started successfully (PID: `$(`$nodeProcess.Id))"
    exit 0
} else {
    Write-Host "ERROR: Bytebotd failed to start"
    exit 1
}
"@

try {
    Set-Content -Path $StartupScriptPath -Value $StartupScript -Encoding UTF8 -Force -ErrorAction Stop
    Write-Log "✓ PowerShell startup script created" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to create startup script: $_" "ERROR"
    exit 1
}

try {
    # Stop any running instances
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Log "Creating interactive scheduled task for desktop access..."

    # Remove existing task if present
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue

    # Get current username for interactive task
    $CurrentUser = $env:USERNAME
    if (-not $CurrentUser) {
        $CurrentUser = "docker"  # Fallback for dockur/windows containers
    }

    # Create interactive scheduled task (Interactive logon type)
    # This runs in the user's interactive desktop session (Session 1+) where keyboard/mouse input works
    # Windows 10+ blocks keyboard/mouse input in Session 0, so S4U cannot be used
    # Requires user to be logged in (Windows container auto-login configured)
    # Critical for nut-js screen.capture() and keyboard/mouse input automation

    $TaskAction = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$StartupScriptPath`"" `
        -WorkingDirectory $BytebotdDir

    # Trigger on user logon (requires interactive session for keyboard/mouse)
    $TaskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser

    # Interactive logon type runs in active user session (Session 1+)
    # This is required for keyboard/mouse automation on Windows 10+
    $TaskPrincipal = New-ScheduledTaskPrincipal `
        -UserId $CurrentUser `
        -LogonType Interactive `
        -RunLevel Highest

    $TaskSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask `
        -TaskName $ServiceName `
        -Action $TaskAction `
        -Trigger $TaskTrigger `
        -Principal $TaskPrincipal `
        -Settings $TaskSettings `
        -Description "Bytebot Desktop Daemon - AI agent computer control service with Interactive desktop access" `
        -Force | Out-Null

    Write-Log "✓ Interactive scheduled task created: $ServiceName" "SUCCESS"
    Write-Log "✓ Logon type: Interactive (runs in active user session Session 1+)" "SUCCESS"
    Write-Log "✓ User: $CurrentUser (RunLevel: Highest)" "SUCCESS"
    Write-Log "Bytebotd will auto-start on user login with keyboard/mouse automation" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to create interactive scheduled task: $_" "ERROR"
    Write-Log "Falling back to startup shortcut approach..." "WARN"

    # Fallback: Create startup shortcut if interactive task fails
    try {
        $StartupFolder = [System.Environment]::GetFolderPath('Startup')
        $ShortcutPath = Join-Path $StartupFolder "Bytebotd Desktop Agent.lnk"

        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = "powershell.exe"
        $Shortcut.Arguments = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$StartupScriptPath`""
        $Shortcut.WorkingDirectory = $BytebotdDir
        $Shortcut.Description = "Bytebot Desktop Daemon - AI agent computer control service"
        $Shortcut.Save()

        Write-Log "✓ Startup shortcut created as fallback: $ShortcutPath" "SUCCESS"
        Write-Log "NOTE: Startup shortcut requires user login (same as Interactive task)" "WARN"
    } catch {
        Write-Log "ERROR: Both interactive task and startup shortcut failed: $_" "ERROR"
        exit 1
    }
}

Write-Log ""

# Step 5.5: Configure Windows Firewall
Write-Log "Step 5.5: Configuring Windows Firewall..."

try {
    # Remove existing rule if present
    Remove-NetFirewallRule -DisplayName "Bytebotd Desktop Agent" -ErrorAction SilentlyContinue

    # Create firewall rule for port 9990 (allow inbound connections)
    New-NetFirewallRule `
        -DisplayName "Bytebotd Desktop Agent" `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort 9990 `
        -Action Allow `
        -Profile Any `
        -Description "Allow inbound connections to Bytebotd API on port 9990" | Out-Null

    Write-Log "✓ Firewall rule created for port 9990" "SUCCESS"
} catch {
    Write-Log "WARN: Failed to create firewall rule: $_" "WARN"
    Write-Log "You may need to manually allow port 9990" "WARN"
}

Write-Log ""

# Step 5.7: Install common applications (VS Code, Firefox)
Write-Log "Step 5.7: Installing common applications..."

$PublicDesktop = "C:\Users\Public\Desktop"
if (-not (Test-Path $PublicDesktop)) {
    New-Item -ItemType Directory -Path $PublicDesktop -Force | Out-Null
}

# Install VS Code
Write-Log "Downloading VS Code..."
$VsCodeUrl = "https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-user"
$VsCodeInstaller = Join-Path $env:TEMP "VSCodeUserSetup.exe"

try {
    Invoke-WebRequest -Uri $VsCodeUrl -OutFile $VsCodeInstaller -UseBasicParsing
    Write-Log "Installing VS Code (silent mode)..."
    Start-Process -FilePath $VsCodeInstaller -ArgumentList "/VERYSILENT /NORESTART /MERGETASKS=!runcode,desktopicon" -Wait
    Remove-Item $VsCodeInstaller -Force -ErrorAction SilentlyContinue
    Write-Log "✓ VS Code installed" "SUCCESS"
} catch {
    Write-Log "WARN: Failed to install VS Code: $_" "WARN"
}

# Install Firefox
Write-Log "Downloading Firefox..."
$FirefoxUrl = "https://download.mozilla.org/?product=firefox-latest&os=win64&lang=en-US"
$FirefoxInstaller = Join-Path $env:TEMP "FirefoxSetup.exe"

try {
    Invoke-WebRequest -Uri $FirefoxUrl -OutFile $FirefoxInstaller -UseBasicParsing
    Write-Log "Installing Firefox (silent mode)..."
    Start-Process -FilePath $FirefoxInstaller -ArgumentList "/S /DesktopShortcut=true" -Wait
    Remove-Item $FirefoxInstaller -Force -ErrorAction SilentlyContinue
    Write-Log "✓ Firefox installed" "SUCCESS"
} catch {
    Write-Log "WARN: Failed to install Firefox: $_" "WARN"
}

Write-Log "✓ Application installation complete" "SUCCESS"
Write-Log ""

# Step 6: Wait for user login and start service
Write-Log "Step 6: Waiting for user login before starting service..."

try {
    # Wait for interactive user session (autologin should happen within 2 minutes)
    $MaxLoginWait = 120  # 2 minutes maximum wait
    $LoginCheckInterval = 5  # Check every 5 seconds
    $ElapsedTime = 0
    $UserLoggedIn = $false

    Write-Log "Waiting for autologin to complete (max ${MaxLoginWait}s)..."

    while ($ElapsedTime -lt $MaxLoginWait) {
        # Check for active console session (Session ID 1 or 2 is typically the interactive desktop)
        $ConsoleSessions = qwinsta | Select-String "Active|Console" | Select-String -NotMatch "services|Disc"

        if ($ConsoleSessions) {
            Write-Log "✓ User session detected" "SUCCESS"
            $UserLoggedIn = $true
            break
        }

        Start-Sleep -Seconds $LoginCheckInterval
        $ElapsedTime += $LoginCheckInterval

        if ($ElapsedTime % 20 -eq 0) {
            Write-Log "Still waiting for login... (${ElapsedTime}s elapsed)"
        }
    }

    if (-not $UserLoggedIn) {
        Write-Log "WARN: Autologin timeout after ${MaxLoginWait}s, starting service anyway" "WARN"
        Write-Log "Service may not have desktop access until user logs in" "WARN"
    }

    # Start the service in the user's session context
    Write-Log "Starting Bytebotd service in interactive session..."
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$StartupScriptPath`"" `
        -WorkingDirectory $BytebotdDir

    Write-Log "✓ Service start initiated" "SUCCESS"
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
Write-Log "  - Auto-start: Windows Startup folder (interactive desktop session)"
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
