#Requires -Version 5.1
<#
.SYNOPSIS
    Configures Windows display settings for Bytebot Desktop Agent

.DESCRIPTION
    This script sets the Windows display scaling to 125% DPI for improved readability
    at 1920x1080 resolution. It runs during Windows container first boot before
    bytebotd starts.

    Display configuration:
    - Resolution: 1920x1080 (set via dockur/windows RESOLUTION env var)
    - DPI Scaling: 125% (120 DPI, where 96 = 100%, 120 = 125%, 144 = 150%)

.NOTES
    Expected execution time: < 5 seconds
    Runs as SYSTEM user during first boot
    Changes persist across reboots
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Setup logging
$LogDir = "C:\Bytebot-Logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = Join-Path $LogDir "configure-display.log"
$ConfigTime = Get-Date

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogMessage = "[$Timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $LogMessage

    switch ($Level) {
        "ERROR"   { Write-Host $Message -ForegroundColor Red }
        "WARN"    { Write-Host $Message -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $Message -ForegroundColor Green }
        default   { Write-Host $Message -ForegroundColor Cyan }
    }
}

Write-Log "========================================"
Write-Log "  Windows Display Configuration"
Write-Log "  Started: $ConfigTime"
Write-Log "========================================"
Write-Log ""

# Step 1: Configure DPI Scaling (125% = 120 DPI)
Write-Log "Step 1: Configuring 125% DPI scaling..."

try {
    # Registry paths for DPI settings
    $DesktopKey = "HKCU:\Control Panel\Desktop"
    $WindowMetricsKey = "HKCU:\Control Panel\Desktop\WindowMetrics"

    # Ensure registry keys exist
    if (-not (Test-Path $DesktopKey)) {
        New-Item -Path $DesktopKey -Force | Out-Null
    }
    if (-not (Test-Path $WindowMetricsKey)) {
        New-Item -Path $WindowMetricsKey -Force | Out-Null
    }

    # Set 125% scaling (DPI = 120)
    # LogPixels: Controls system-wide DPI (96 = 100%, 120 = 125%, 144 = 150%)
    Set-ItemProperty -Path $DesktopKey -Name "LogPixels" -Value 120 -Type DWord
    Write-Log "  Set LogPixels to 120 (125% scaling)"

    # AppliedDPI: Actual applied DPI setting
    Set-ItemProperty -Path $WindowMetricsKey -Name "AppliedDPI" -Value 120 -Type DWord
    Write-Log "  Set AppliedDPI to 120"

    # Win8DpiScaling: Enable DPI scaling for Win8+ apps
    Set-ItemProperty -Path $DesktopKey -Name "Win8DpiScaling" -Value 1 -Type DWord
    Write-Log "  Enabled Win8DpiScaling"

    # DpiScalingVer: DPI scaling version (0 = Win7, 1 = Win8.1+)
    Set-ItemProperty -Path $DesktopKey -Name "DpiScalingVer" -Value 1 -Type DWord
    Write-Log "  Set DpiScalingVer to 1 (Win8.1+ mode)"

    Write-Log "✓ DPI scaling configured successfully" "SUCCESS"
} catch {
    Write-Log "ERROR: Failed to configure DPI scaling: $_" "ERROR"
    exit 1
}

Write-Log ""

# Step 2: Verify current display settings
Write-Log "Step 2: Verifying display settings..."

try {
    # Get current DPI setting
    $CurrentDPI = Get-ItemProperty -Path $DesktopKey -Name "LogPixels" -ErrorAction SilentlyContinue
    if ($CurrentDPI) {
        $DPIPercent = [math]::Round(($CurrentDPI.LogPixels / 96) * 100)
        Write-Log "  Current DPI: $($CurrentDPI.LogPixels) ($DPIPercent% scaling)"
    }

    # Get video controller information
    $VideoController = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1
    if ($VideoController) {
        Write-Log "  Video Controller: $($VideoController.Name)"
        Write-Log "  Current Resolution: $($VideoController.CurrentHorizontalResolution)x$($VideoController.CurrentVerticalResolution)"
        Write-Log "  Refresh Rate: $($VideoController.CurrentRefreshRate) Hz"
    }

    Write-Log "✓ Display settings verified" "SUCCESS"
} catch {
    Write-Log "WARN: Could not verify display settings: $_" "WARN"
}

Write-Log ""

# Step 3: Note about explorer restart
Write-Log "Step 3: Display changes will take effect..."
Write-Log "  - DPI scaling: Applied to new processes"
Write-Log "  - Full effect: After Windows restart or explorer.exe restart"
Write-Log "  - Bytebotd will start with 125% DPI scaling"

Write-Log ""

# Configuration summary
$ConfigDuration = (Get-Date) - $ConfigTime
Write-Log "========================================"
Write-Log "  Display Configuration Complete!"
Write-Log "  Duration: $([math]::Round($ConfigDuration.TotalSeconds, 1))s"
Write-Log "========================================"
Write-Log ""
Write-Log "Configuration applied:"
Write-Log "  - Resolution: 1920x1080 (via QEMU/dockur)"
Write-Log "  - DPI Scaling: 125% (120 DPI)"
Write-Log "  - Log file: $LogFile"
Write-Log ""

exit 0
