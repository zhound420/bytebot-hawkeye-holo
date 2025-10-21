# Fix Bytebotd Scheduled Task Auto-Start Issue
#
# Problem: Keyboard/mouse input not working on Windows
# Root Cause: S4U/ServiceAccount tasks run in Session 0 where input is blocked (Windows 10+ security)
# Solution: Use Interactive logon type to run in active user session (Session 1+)
#
# Run this script inside Windows container to permanently fix keyboard/mouse automation

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Bytebotd Scheduled Task Fix Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Paths
$BytebotdPath = "C:\Program Files\Bytebot\packages\bytebotd"
$LogDir = "C:\Bytebot-Logs"
$TaskName = "Bytebotd Desktop Agent"

# Check if bytebotd exists
if (-not (Test-Path "$BytebotdPath\dist\main.js")) {
    Write-Host "ERROR: Bytebotd not found at $BytebotdPath\dist\main.js" -ForegroundColor Red
    Write-Host "Please ensure bytebotd is installed first." -ForegroundColor Red
    exit 1
}

# Ensure log directory exists
if (-not (Test-Path $LogDir)) {
    New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
}

Write-Host "[1/5] Stopping existing task..." -ForegroundColor Yellow
try {
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Host "  Stopped existing task" -ForegroundColor Green
    } else {
        Write-Host "  No existing task found" -ForegroundColor Gray
    }
} catch {
    Write-Host "  Warning: Could not stop task - $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "[2/5] Unregistering old task..." -ForegroundColor Yellow
try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  Unregistered old task" -ForegroundColor Green
} catch {
    Write-Host "  No old task to remove" -ForegroundColor Gray
}

Write-Host "[3/5] Killing any existing node.exe processes..." -ForegroundColor Yellow
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  Cleanup complete" -ForegroundColor Green

Write-Host "[4/5] Creating new scheduled task with Interactive logon..." -ForegroundColor Yellow

# Get current user for interactive session
$CurrentUser = $env:USERNAME
if (-not $CurrentUser) {
    $CurrentUser = "docker"  # Fallback for dockur/windows containers
}

# Create PowerShell command that uses Start-Process for proper backgrounding
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
        }
    }
} else {
    `$env:HOLO_URL = "http://bytebot-holo:9989"
}

# Set Holo environment variables
`$env:BYTEBOT_CV_USE_HOLO = "true"
`$env:HOLO_TIMEOUT = "120000"

# Kill any existing node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Wait for port to be released
Start-Sleep -Seconds 2

# Start bytebotd with Start-Process (proper backgrounding)
Start-Process -FilePath "node.exe" ``
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

# Save startup script
$StartupScriptPath = "$BytebotdPath\start-service.ps1"
Set-Content -Path $StartupScriptPath -Value $StartupScript -Encoding UTF8

# Create scheduled task action (direct PowerShell execution)
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$StartupScriptPath`"" `
    -WorkingDirectory $BytebotdPath

# Create trigger (on user logon - required for interactive session)
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser

# Create principal (Interactive runs in active user session Session 1+)
# This is required for keyboard/mouse automation on Windows 10+
$Principal = New-ScheduledTaskPrincipal `
    -UserId $CurrentUser `
    -LogonType Interactive `
    -RunLevel Highest

# Create settings
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Register new task
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "Bytebot Desktop Daemon - AI agent computer control service (Fixed with Interactive for keyboard/mouse)" `
    -Force | Out-Null

Write-Host "  New task created successfully with Interactive logon" -ForegroundColor Green
Write-Host "  Logon type: Interactive (Session 1+ for keyboard/mouse automation)" -ForegroundColor Green

Write-Host "[5/5] Starting task and verifying..." -ForegroundColor Yellow

# Start the task
Start-ScheduledTask -TaskName $TaskName

# Wait for service to start
Start-Sleep -Seconds 10

# Check if node.exe is running
$nodeProcess = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcess) {
    Write-Host "  Service started successfully (PID: $($nodeProcess.Id))" -ForegroundColor Green

    # Test HTTP endpoint
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:9990/health" -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host "  Health check passed: HTTP 200 OK" -ForegroundColor Green
        } else {
            Write-Host "  Warning: Health check returned HTTP $($response.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Warning: Health check failed - service may still be starting" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ERROR: Service did not start" -ForegroundColor Red
    Write-Host "  Check logs at:" -ForegroundColor Yellow
    Write-Host "    - $LogDir\bytebotd-stdout.log" -ForegroundColor Gray
    Write-Host "    - $LogDir\bytebotd-stderr.log" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Fix Applied Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Scheduled task details:" -ForegroundColor White
$taskInfo = Get-ScheduledTask -TaskName $TaskName
Write-Host "  Status: $($taskInfo.State)" -ForegroundColor Gray
Write-Host "  Last Run: $($taskInfo.LastRunTime)" -ForegroundColor Gray
Write-Host "  Last Result: $($taskInfo.LastTaskResult)" -ForegroundColor Gray
Write-Host ""
Write-Host "Service will now auto-start on every reboot." -ForegroundColor Green
Write-Host ""
Write-Host "To verify service status:" -ForegroundColor White
Write-Host "  Get-Process -Name node" -ForegroundColor Gray
Write-Host "  Invoke-WebRequest -Uri http://localhost:9990/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Logs available at:" -ForegroundColor White
Write-Host "  $LogDir\bytebotd-stdout.log" -ForegroundColor Gray
Write-Host "  $LogDir\bytebotd-stderr.log" -ForegroundColor Gray
Write-Host ""
