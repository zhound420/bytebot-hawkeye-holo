# Bytebot Desktop Daemon - System Tray Monitor
# Shows real-time status of bytebotd service in Windows system tray

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Error handling configuration - prevent crashes from errors
$ErrorActionPreference = "SilentlyContinue"

# Configuration
$script:BytebotdUrl = "http://localhost:9990/health"
$script:BytebotdPath = "C:\bytebot\packages\bytebotd"
$script:LogDir = "C:\Bytebot-Logs"
$script:CheckInterval = 5000 # 5 seconds

# Global state
$script:IsHealthy = $false
$script:LastStatus = "Checking..."

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
    $message = @"
Bytebot Desktop Daemon Status

Status: $script:LastStatus
Endpoint: $script:BytebotdUrl
Installation: C:\bytebot
Logs: $script:LogDir

Health checks run every 5 seconds.
Right-click the tray icon for options.
"@
    [System.Windows.Forms.MessageBox]::Show($message, "Bytebot Status", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})

# Health check function
function Test-BytebotdHealth {
    try {
        $response = Invoke-WebRequest -Uri $script:BytebotdUrl -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop

        if ($response.StatusCode -eq 200) {
            $script:IsHealthy = $true
            $script:LastStatus = "Running (Healthy)"
            $script:TrayIcon.Icon = $script:GreenIcon
            $script:TrayIcon.Text = "Bytebot: Running (Healthy)"
            if ($menuItemStatus) {
                $menuItemStatus.Text = "Status: Running (Healthy)"
            }
            return
        }
    } catch {
        # Health check failed - continue to process check
    }

    # Check if node.exe process is running
    # Note: CommandLine property not available in Windows PowerShell 5.1
    # In a container, any node.exe is likely bytebotd
    try {
        $nodeProcess = Get-Process -Name node -ErrorAction SilentlyContinue

        if ($nodeProcess) {
            $script:IsHealthy = $false
            $script:LastStatus = "Starting/Not Ready"
            $script:TrayIcon.Icon = $script:YellowIcon
            $script:TrayIcon.Text = "Bytebot: Starting/Not Ready"
            if ($menuItemStatus) {
                $menuItemStatus.Text = "Status: Starting/Not Ready"
            }
        } else {
            $script:IsHealthy = $false
            $script:LastStatus = "Stopped"
            $script:TrayIcon.Icon = $script:RedIcon
            $script:TrayIcon.Text = "Bytebot: Stopped"
            if ($menuItemStatus) {
                $menuItemStatus.Text = "Status: Stopped"
            }
        }
    } catch {
        # Process check failed - assume stopped
        $script:IsHealthy = $false
        $script:LastStatus = "Stopped (Error)"
        $script:TrayIcon.Icon = $script:RedIcon
        $script:TrayIcon.Text = "Bytebot: Stopped (Error)"
        if ($menuItemStatus) {
            $menuItemStatus.Text = "Status: Stopped (Error)"
        }
    }
}

# Create timer for periodic health checks
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = $script:CheckInterval
$script:Timer.Add_Tick({
    try {
        Test-BytebotdHealth
    } catch {
        # Timer callback error - ignore to prevent crash
        # Tray icon will show last known state
    }
})
$script:Timer.Start()

# Initial health check
try {
    Test-BytebotdHealth
} catch {
    # Initial health check failed - tray will show default "Checking..." state
}

# Show notification on startup
$script:TrayIcon.ShowBalloonTip(3000, "Bytebot Monitor", "Bytebotd monitor started. Right-click for options.", [System.Windows.Forms.ToolTipIcon]::Info)

# Run the application
[System.Windows.Forms.Application]::Run()

# Cleanup
$script:TrayIcon.Dispose()
$script:Timer.Dispose()
