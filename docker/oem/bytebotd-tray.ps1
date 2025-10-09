# Bytebot Desktop Daemon - System Tray Monitor
# Shows real-time status of bytebotd service in Windows system tray

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Error handling configuration - log errors instead of silent suppression
$ErrorActionPreference = "Continue"

# Configuration
$script:BytebotdUrl = "http://localhost:9990/health"
$script:BytebotdPath = "C:\bytebot\packages\bytebotd"
$script:LogDir = "C:\Bytebot-Logs"
$script:HeartbeatFile = "C:\ProgramData\Bytebot\heartbeat.txt"
$script:TrayLogFile = "$script:LogDir\tray-monitor.log"
$script:CheckInterval = 5000 # 5 seconds
$script:StartupDelayMs = 15000 # 15 second delay before first check

# Global state
$script:IsHealthy = $false
$script:LastStatus = "Checking..."
$script:StartupComplete = $false

# Ensure log directory exists
if (-not (Test-Path $script:LogDir)) {
    New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null
}

# Logging function
function Write-TrayLog {
    param([string]$Message, [string]$Level = "INFO")

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"

    try {
        Add-Content -Path $script:TrayLogFile -Value $logEntry -ErrorAction SilentlyContinue
    } catch {
        # Silent failure for logging - don't crash if log file is locked
    }

    # Also write to console for debugging
    if ($Level -eq "ERROR") {
        Write-Host $logEntry -ForegroundColor Red
    } elseif ($Level -eq "WARN") {
        Write-Host $logEntry -ForegroundColor Yellow
    } else {
        Write-Host $logEntry
    }
}

Write-TrayLog "Bytebot tray monitor starting..."

# Create NotifyIcon
$script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon

# Create icons (simple colored circles)
function New-ColoredIcon {
    param([System.Drawing.Color]$Color)

    $bitmap = New-Object System.Drawing.Bitmap(16, 16)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Fill background (transparent)
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Draw filled circle
    $brush = New-Object System.Drawing.SolidBrush($Color)
    $graphics.FillEllipse($brush, 2, 2, 12, 12)

    # Draw border
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)
    $graphics.DrawEllipse($pen, 2, 2, 12, 12)

    $graphics.Dispose()
    $brush.Dispose()
    $pen.Dispose()

    return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$script:GreenIcon = New-ColoredIcon -Color ([System.Drawing.Color]::LimeGreen)
$script:RedIcon = New-ColoredIcon -Color ([System.Drawing.Color]::Red)
$script:YellowIcon = New-ColoredIcon -Color ([System.Drawing.Color]::Orange)

# Create context menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$menuItemStatus = New-Object System.Windows.Forms.ToolStripMenuItem
$menuItemStatus.Text = "Status: Checking..."
$menuItemStatus.Enabled = $false
$contextMenu.Items.Add($menuItemStatus) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$menuItemViewLogs = New-Object System.Windows.Forms.ToolStripMenuItem
$menuItemViewLogs.Text = "View Logs"
$menuItemViewLogs.Add_Click({
    if (Test-Path $script:LogDir) {
        # Find most recent bytebotd log file
        $latestLog = Get-ChildItem -Path $script:LogDir -Filter "bytebotd-*.log" -File -ErrorAction SilentlyContinue |
                     Sort-Object LastWriteTime -Descending |
                     Select-Object -First 1

        if ($latestLog) {
            Start-Process notepad.exe -ArgumentList $latestLog.FullName
        } else {
            [System.Windows.Forms.MessageBox]::Show("No bytebotd log files found in: $script:LogDir", "Bytebot Logs")
        }
    } else {
        [System.Windows.Forms.MessageBox]::Show("Log directory not found: $script:LogDir", "Bytebot Logs")
    }
})
$contextMenu.Items.Add($menuItemViewLogs) | Out-Null

$menuItemRestart = New-Object System.Windows.Forms.ToolStripMenuItem
$menuItemRestart.Text = "Restart Service"
$menuItemRestart.Add_Click({
    try {
        # Stop any existing node processes
        Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2

        # Start bytebotd via scheduled task
        Start-ScheduledTask -TaskName "Bytebot Desktop Daemon" -ErrorAction Stop

        $script:LastStatus = "Restarting..."
        $script:TrayIcon.Icon = $script:YellowIcon
        $script:TrayIcon.Text = "Bytebot: Restarting..."

        [System.Windows.Forms.MessageBox]::Show("Bytebotd service restarted", "Bytebot")
    } catch {
        [System.Windows.Forms.MessageBox]::Show("Failed to restart: $_", "Bytebot Error")
    }
})
$contextMenu.Items.Add($menuItemRestart) | Out-Null

$menuItemOpenFolder = New-Object System.Windows.Forms.ToolStripMenuItem
$menuItemOpenFolder.Text = "Open Installation Folder"
$menuItemOpenFolder.Add_Click({
    if (Test-Path "C:\bytebot") {
        Start-Process explorer.exe -ArgumentList "C:\bytebot"
    }
})
$contextMenu.Items.Add($menuItemOpenFolder) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$menuItemExit = New-Object System.Windows.Forms.ToolStripMenuItem
$menuItemExit.Text = "Exit Monitor"
$menuItemExit.Add_Click({
    $script:TrayIcon.Visible = $false
    $script:Timer.Stop()
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($menuItemExit) | Out-Null

# Configure tray icon
$script:TrayIcon.Icon = $script:YellowIcon
$script:TrayIcon.Text = "Bytebot: Checking..."
$script:TrayIcon.ContextMenuStrip = $contextMenu
$script:TrayIcon.Visible = $true

# Double-click to show status
$script:TrayIcon.Add_DoubleClick({
    $healthMethod = if ($script:StartupComplete) {
        "File-based (PRIMARY) + HTTP (SECONDARY)"
    } else {
        "Waiting for startup delay ($($script:StartupDelayMs / 1000)s)"
    }

    $message = @"
Bytebot Desktop Daemon Status

Status: $script:LastStatus
Endpoint: $script:BytebotdUrl
Heartbeat File: $script:HeartbeatFile
Installation: C:\bytebot
Logs: $script:LogDir
Tray Log: $script:TrayLogFile

Health Check Method: $healthMethod
Health checks run every 5 seconds.
Right-click the tray icon for options.
"@
    [System.Windows.Forms.MessageBox]::Show($message, "Bytebot Status", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})

# Health check function - File-based (PRIMARY) + HTTP (SECONDARY)
function Test-BytebotdHealth {
    $fileHealthy = $false
    $httpHealthy = $false

    # PRIMARY: Check heartbeat file
    try {
        if (Test-Path $script:HeartbeatFile) {
            $content = Get-Content -Path $script:HeartbeatFile -Raw -ErrorAction Stop
            $lines = $content -split "`n"

            if ($lines.Length -ge 1) {
                $timestampStr = $lines[0].Trim()
                $lastHeartbeat = [DateTime]::Parse($timestampStr)
                $now = Get-Date
                $ageSeconds = ($now - $lastHeartbeat).TotalSeconds

                if ($ageSeconds -lt 10) {
                    $fileHealthy = $true
                    Write-TrayLog "Heartbeat file is fresh (age: $([math]::Round($ageSeconds, 1))s)" -Level "DEBUG"
                } else {
                    Write-TrayLog "Heartbeat file is stale (age: $([math]::Round($ageSeconds, 1))s)" -Level "WARN"
                }
            }
        } else {
            Write-TrayLog "Heartbeat file not found: $script:HeartbeatFile" -Level "WARN"
        }
    } catch {
        Write-TrayLog "Failed to check heartbeat file: $($_.Exception.Message)" -Level "ERROR"
    }

    # SECONDARY: Check HTTP health endpoint
    try {
        $response = Invoke-WebRequest -Uri $script:BytebotdUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop

        if ($response.StatusCode -eq 200) {
            $httpHealthy = $true
            Write-TrayLog "HTTP health check passed" -Level "DEBUG"
        }
    } catch {
        Write-TrayLog "HTTP health check failed: $($_.Exception.Message)" -Level "WARN"
    }

    # Determine overall status
    if ($fileHealthy -and $httpHealthy) {
        # Both checks pass = fully healthy (GREEN)
        $script:IsHealthy = $true
        $script:LastStatus = "Running (Healthy)"
        $script:TrayIcon.Icon = $script:GreenIcon
        $script:TrayIcon.Text = "Bytebot: Running (Healthy)"
        if ($menuItemStatus) {
            $menuItemStatus.Text = "Status: Running (Healthy)"
        }
    } elseif ($fileHealthy) {
        # File healthy but HTTP not ready = starting up (YELLOW)
        $script:IsHealthy = $false
        $script:LastStatus = "Starting (HTTP not ready)"
        $script:TrayIcon.Icon = $script:YellowIcon
        $script:TrayIcon.Text = "Bytebot: Starting..."
        if ($menuItemStatus) {
            $menuItemStatus.Text = "Status: Starting (HTTP not ready)"
        }
        Write-TrayLog "Service starting - heartbeat OK but HTTP not responding" -Level "INFO"
    } elseif ($httpHealthy) {
        # HTTP healthy but file missing/stale = unusual state (YELLOW)
        $script:IsHealthy = $true
        $script:LastStatus = "Running (heartbeat file issue)"
        $script:TrayIcon.Icon = $script:YellowIcon
        $script:TrayIcon.Text = "Bytebot: Running (heartbeat file issue)"
        if ($menuItemStatus) {
            $menuItemStatus.Text = "Status: Running (heartbeat file issue)"
        }
        Write-TrayLog "Heartbeat file missing but HTTP responding - possible file write issue" -Level "WARN"
    } else {
        # Both checks fail = check process status (RED or YELLOW)
        try {
            $nodeProcess = Get-Process -Name node -ErrorAction SilentlyContinue

            if ($nodeProcess) {
                # Process running but not responding
                $script:IsHealthy = $false
                $script:LastStatus = "Not Responding"
                $script:TrayIcon.Icon = $script:YellowIcon
                $script:TrayIcon.Text = "Bytebot: Not Responding"
                if ($menuItemStatus) {
                    $menuItemStatus.Text = "Status: Not Responding"
                }
                Write-TrayLog "Node.exe process found but health checks failing" -Level "WARN"
            } else {
                # No process = stopped
                $script:IsHealthy = $false
                $script:LastStatus = "Stopped"
                $script:TrayIcon.Icon = $script:RedIcon
                $script:TrayIcon.Text = "Bytebot: Stopped"
                if ($menuItemStatus) {
                    $menuItemStatus.Text = "Status: Stopped"
                }
                Write-TrayLog "Node.exe process not found - service is stopped" -Level "ERROR"
            }
        } catch {
            # Process check failed
            $script:IsHealthy = $false
            $script:LastStatus = "Unknown (Error)"
            $script:TrayIcon.Icon = $script:RedIcon
            $script:TrayIcon.Text = "Bytebot: Unknown (Error)"
            if ($menuItemStatus) {
                $menuItemStatus.Text = "Status: Unknown (Error)"
            }
            Write-TrayLog "Failed to check node.exe process: $($_.Exception.Message)" -Level "ERROR"
        }
    }
}

# Create timer for periodic health checks
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = $script:CheckInterval
$script:Timer.Add_Tick({
    try {
        # Skip health checks during startup delay
        if (-not $script:StartupComplete) {
            return
        }

        Test-BytebotdHealth
    } catch {
        Write-TrayLog "Timer callback error: $($_.Exception.Message)" -Level "ERROR"
    }
})
$script:Timer.Start()

# Startup delay timer (wait 15 seconds before first health check)
Write-TrayLog "Waiting $($script:StartupDelayMs / 1000) seconds before first health check..."
$script:StartupTimer = New-Object System.Windows.Forms.Timer
$script:StartupTimer.Interval = $script:StartupDelayMs
$script:StartupTimer.Add_Tick({
    Write-TrayLog "Startup delay complete, beginning health checks"
    $script:StartupComplete = $true
    $script:StartupTimer.Stop()

    # Run first health check immediately
    try {
        Test-BytebotdHealth
    } catch {
        Write-TrayLog "Initial health check error: $($_.Exception.Message)" -Level "ERROR"
    }
})
$script:StartupTimer.Start()

# Show notification on startup
$script:TrayIcon.ShowBalloonTip(3000, "Bytebot Monitor", "Bytebotd monitor started. Right-click for options.", [System.Windows.Forms.ToolTipIcon]::Info)

# Run the application
[System.Windows.Forms.Application]::Run()

# Cleanup
$script:TrayIcon.Dispose()
$script:Timer.Dispose()
