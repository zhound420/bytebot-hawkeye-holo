# Fix Bytebotd Scheduled Task Auto-Start Issue
#
# Problem: Scheduled task created by install-prebaked.ps1 fails with error 267009
# Root Cause: cmd.exe /c wrapper doesn't properly background node.exe
# Solution: Use PowerShell Start-Process for proper backgrounding
#
# Run this script inside Windows container to permanently fix auto-start

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

Write-Host "[4/5] Creating new scheduled task with PowerShell Start-Process..." -ForegroundColor Yellow

# Create PowerShell command that uses Start-Process for proper backgrounding
$StartupScript = @"
`$ErrorActionPreference = "SilentlyContinue"

# Change to bytebotd directory
Set-Location "C:\Program Files\Bytebot\packages\bytebotd"

# Kill any existing node processes
Get-Process -Name node | Stop-Process -Force

# Start bytebotd with Start-Process (proper backgrounding)
Start-Process -FilePath "node.exe" ``
    -ArgumentList "dist\main.js" ``
    -NoNewWindow ``
    -RedirectStandardOutput "C:\Bytebot-Logs\bytebotd-stdout.log" ``
    -RedirectStandardError "C:\Bytebot-Logs\bytebotd-stderr.log" ``
    -WorkingDirectory "C:\Program Files\Bytebot\packages\bytebotd"

# Give service 5 seconds to start
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
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartupScriptPath`""

# Create trigger (on boot)
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Create principal (run as SYSTEM with highest privileges)
$Principal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount `
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
    -Description "Bytebot Desktop Daemon - AI agent computer control service (Fixed with PowerShell Start-Process)" `
    -Force | Out-Null

Write-Host "  New task created successfully" -ForegroundColor Green

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
