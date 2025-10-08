# Bytebot Windows Diagnostic Script
# Run this to check why bytebotd and tray icon aren't starting

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Bytebot Windows Diagnostic" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check 1: Bytebot directory exists
Write-Host "[1/9] Checking Bytebot installation directory..." -ForegroundColor Yellow
if (Test-Path "C:\bytebot") {
    Write-Host "  OK: C:\bytebot exists" -ForegroundColor Green
    $bytebotSize = (Get-ChildItem C:\bytebot -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  Size: $([math]::Round($bytebotSize, 2)) MB" -ForegroundColor Gray
} else {
    Write-Host "  ERROR: C:\bytebot does not exist!" -ForegroundColor Red
    Write-Host "  Install.bat did not run or failed early" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check 2: Node.js installation
Write-Host "[2/9] Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "  OK: Node.js installed ($nodeVersion)" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Node.js not found in PATH" -ForegroundColor Red
    }
} catch {
    Write-Host "  ERROR: Node.js not installed or not in PATH" -ForegroundColor Red
}
Write-Host ""

# Check 3: npm installation
Write-Host "[3/9] Checking npm installation..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    if ($npmVersion) {
        Write-Host "  OK: npm installed ($npmVersion)" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: npm not found in PATH" -ForegroundColor Red
    }
} catch {
    Write-Host "  ERROR: npm not installed or not in PATH" -ForegroundColor Red
}
Write-Host ""

# Check 4: Build artifacts
Write-Host "[4/9] Checking build artifacts..." -ForegroundColor Yellow
$artifacts = @(
    "C:\bytebot\packages\shared\dist",
    "C:\bytebot\packages\bytebot-cv\dist",
    "C:\bytebot\packages\bytebotd\dist",
    "C:\bytebot\packages\bytebotd\dist\main.js"
)
$allExist = $true
foreach ($artifact in $artifacts) {
    if (Test-Path $artifact) {
        Write-Host "  OK: $artifact" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: $artifact missing" -ForegroundColor Red
        $allExist = $false
    }
}
if (-not $allExist) {
    Write-Host "  Build did not complete successfully!" -ForegroundColor Red
}
Write-Host ""

# Check 5: Log directory
Write-Host "[5/9] Checking log directory..." -ForegroundColor Yellow
if (Test-Path "C:\Bytebot-Logs") {
    Write-Host "  OK: C:\Bytebot-Logs exists" -ForegroundColor Green
    $logCount = (Get-ChildItem "C:\Bytebot-Logs" -Filter "*.log" -File -ErrorAction SilentlyContinue).Count
    Write-Host "  Log files: $logCount" -ForegroundColor Gray
    if ($logCount -gt 0) {
        $latestLog = Get-ChildItem "C:\Bytebot-Logs" -Filter "*.log" -File -ErrorAction SilentlyContinue |
                     Sort-Object LastWriteTime -Descending |
                     Select-Object -First 1
        Write-Host "  Latest log: $($latestLog.Name)" -ForegroundColor Gray
        Write-Host "  Modified: $($latestLog.LastWriteTime)" -ForegroundColor Gray
    }
} else {
    Write-Host "  WARNING: C:\Bytebot-Logs does not exist" -ForegroundColor Yellow
    Write-Host "  Logs may not be written yet" -ForegroundColor Gray
}
Write-Host ""

# Check 6: Scheduled tasks
Write-Host "[6/9] Checking scheduled tasks..." -ForegroundColor Yellow
$daemonTask = Get-ScheduledTask -TaskName "Bytebot Desktop Daemon" -ErrorAction SilentlyContinue
$trayTask = Get-ScheduledTask -TaskName "Bytebot Tray Monitor" -ErrorAction SilentlyContinue

if ($daemonTask) {
    Write-Host "  OK: 'Bytebot Desktop Daemon' task exists" -ForegroundColor Green
    Write-Host "    State: $($daemonTask.State)" -ForegroundColor Gray
    Write-Host "    Last Run: $((Get-ScheduledTaskInfo -TaskName 'Bytebot Desktop Daemon' -ErrorAction SilentlyContinue).LastRunTime)" -ForegroundColor Gray
    Write-Host "    Last Result: $((Get-ScheduledTaskInfo -TaskName 'Bytebot Desktop Daemon' -ErrorAction SilentlyContinue).LastTaskResult)" -ForegroundColor Gray
} else {
    Write-Host "  ERROR: 'Bytebot Desktop Daemon' task not found" -ForegroundColor Red
}

if ($trayTask) {
    Write-Host "  OK: 'Bytebot Tray Monitor' task exists" -ForegroundColor Green
    Write-Host "    State: $($trayTask.State)" -ForegroundColor Gray
    Write-Host "    Last Run: $((Get-ScheduledTaskInfo -TaskName 'Bytebot Tray Monitor' -ErrorAction SilentlyContinue).LastRunTime)" -ForegroundColor Gray
    Write-Host "    Last Result: $((Get-ScheduledTaskInfo -TaskName 'Bytebot Tray Monitor' -ErrorAction SilentlyContinue).LastTaskResult)" -ForegroundColor Gray
} else {
    Write-Host "  ERROR: 'Bytebot Tray Monitor' task not found" -ForegroundColor Red
}
Write-Host ""

# Check 7: Running processes
Write-Host "[7/9] Checking running processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "  OK: Found $($nodeProcesses.Count) Node.js process(es)" -ForegroundColor Green
    foreach ($proc in $nodeProcesses) {
        Write-Host "    PID: $($proc.Id), Memory: $([math]::Round($proc.WorkingSet64/1MB, 2)) MB" -ForegroundColor Gray
    }
} else {
    Write-Host "  WARNING: No Node.js processes running" -ForegroundColor Yellow
    Write-Host "  bytebotd is not running!" -ForegroundColor Red
}

$powershellProcesses = Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*bytebotd-tray.ps1*"
}
if ($powershellProcesses) {
    Write-Host "  OK: Tray monitor PowerShell process running" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Tray monitor PowerShell process not found" -ForegroundColor Yellow
}
Write-Host ""

# Check 8: Port 9990 listening
Write-Host "[8/9] Checking if port 9990 is listening..." -ForegroundColor Yellow
$listener = Get-NetTCPConnection -LocalPort 9990 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host "  OK: Port 9990 is listening" -ForegroundColor Green
    Write-Host "    Process ID: $($listener.OwningProcess)" -ForegroundColor Gray
} else {
    Write-Host "  ERROR: Port 9990 is not listening" -ForegroundColor Red
    Write-Host "  bytebotd API is not accessible!" -ForegroundColor Red
}
Write-Host ""

# Check 9: Test health endpoint
Write-Host "[9/9] Testing bytebotd health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:9990/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "  OK: Health endpoint responding (HTTP $($response.StatusCode))" -ForegroundColor Green
    Write-Host "  Response: $($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "  ERROR: Health endpoint not responding" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Gray
}
Write-Host ""

# Summary and recommendations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary & Recommendations" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($nodeProcesses -and $listener) {
    Write-Host "STATUS: bytebotd appears to be running correctly!" -ForegroundColor Green
    if (-not $powershellProcesses) {
        Write-Host "ISSUE: Tray icon not running. Try running:" -ForegroundColor Yellow
        Write-Host "  .\start-tray.bat" -ForegroundColor White
    }
} else {
    Write-Host "STATUS: bytebotd is NOT running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Recommended actions:" -ForegroundColor Yellow
    Write-Host "  1. Check if build completed: ls C:\bytebot\packages\bytebotd\dist\main.js" -ForegroundColor White
    Write-Host "  2. Try starting manually: .\start-bytebotd.bat" -ForegroundColor White
    Write-Host "  3. Check logs: C:\Bytebot-Logs\bytebotd-*.log" -ForegroundColor White
    Write-Host "  4. Re-run install.bat if build failed" -ForegroundColor White
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
