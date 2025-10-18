#!/bin/bash
#
# macOS First-Time Setup Script
# Run this AFTER completing Setup Assistant manually
# This script automates Homebrew, Node.js, and bytebotd installation
#

set -e  # Exit on error

# Set up logging
LOG_DIR="/Users/Shared/bytebot-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/first-time-setup.log"
SETUP_TIME=$(date +"%Y-%m-%d %H:%M:%S")

# Redirect all output to log file and console
exec > >(tee -a "$LOG_FILE") 2>&1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

write_log() {
    local message="$1"
    local level="${2:-INFO}"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    case "$level" in
        ERROR)
            echo -e "${RED}[${timestamp}] [${level}] ${message}${NC}"
            ;;
        WARN)
            echo -e "${YELLOW}[${timestamp}] [${level}] ${message}${NC}"
            ;;
        SUCCESS)
            echo -e "${GREEN}[${timestamp}] [${level}] ${message}${NC}"
            ;;
        *)
            echo -e "${CYAN}[${timestamp}] [${level}] ${message}${NC}"
            ;;
    esac
}

write_log "============================================"
write_log "   macOS First-Time Setup (Prebaked Image)"
write_log "   Started: $SETUP_TIME"
write_log "============================================"
write_log ""

# Configuration
PACKAGE_TAR="/shared/bytebotd-macos-prebaked.tar.gz"
INSTALL_ROOT="/Users/Shared/bytebot"
DATA_DIR="/Users/Shared/bytebot-data"

# Get actual user (not root)
ACTUAL_USER="${SUDO_USER:-$(who | grep console | awk '{print $1}' | head -n 1)}"
if [ -z "$ACTUAL_USER" ]; then
    ACTUAL_USER="docker"  # Default if detection fails
fi

write_log "Running as user: $ACTUAL_USER"
write_log ""

# Step 1: Install Homebrew
write_log "Step 1: Installing Homebrew package manager..."

if ! command -v brew &> /dev/null; then
    write_log "Installing Homebrew (this may take 3-5 minutes)..."

    # Install Homebrew non-interactively as the actual user
    sudo -u "$ACTUAL_USER" /bin/bash -c 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' || {
        write_log "ERROR: Homebrew installation failed" "ERROR"
        exit 1
    }

    # Add Homebrew to PATH
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        # Apple Silicon path
        eval "$(/opt/homebrew/bin/brew shellenv)"
        export PATH="/opt/homebrew/bin:$PATH"
    elif [[ -f "/usr/local/bin/brew" ]]; then
        # Intel Mac path
        eval "$(/usr/local/bin/brew shellenv)"
        export PATH="/usr/local/bin:$PATH"
    else
        write_log "ERROR: Homebrew installed but not found in expected locations" "ERROR"
        exit 1
    fi

    write_log "✓ Homebrew installed successfully" "SUCCESS"
else
    write_log "✓ Homebrew already installed" "SUCCESS"
    # Ensure PATH is set
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f "/usr/local/bin/brew" ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

write_log ""

# Step 2: Install Node.js
write_log "Step 2: Installing Node.js 20..."

if ! command -v node &> /dev/null; then
    write_log "Installing Node.js 20 via Homebrew (this may take 2-3 minutes)..."

    sudo -u "$ACTUAL_USER" brew install node@20 || {
        write_log "ERROR: Node.js installation failed" "ERROR"
        exit 1
    }

    # Link Node.js 20
    sudo -u "$ACTUAL_USER" brew link node@20 --force --overwrite || true

    # Add to PATH
    if [[ -d "/opt/homebrew/opt/node@20/bin" ]]; then
        export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif [[ -d "/usr/local/opt/node@20/bin" ]]; then
        export PATH="/usr/local/opt/node@20/bin:$PATH"
    fi

    if ! command -v node &> /dev/null; then
        write_log "ERROR: Node.js installed but not found in PATH" "ERROR"
        exit 1
    fi

    NODE_VERSION=$(node --version)
    write_log "✓ Node.js installed successfully: $NODE_VERSION" "SUCCESS"
else
    NODE_VERSION=$(node --version)
    write_log "✓ Node.js already installed: $NODE_VERSION" "SUCCESS"
fi

write_log ""

# Step 3: Verify package exists
write_log "Step 3: Verifying bytebotd package..."

if [ ! -f "$PACKAGE_TAR" ]; then
    write_log "ERROR: Package not found at $PACKAGE_TAR" "ERROR"
    write_log "Expected location: /shared/bytebotd-macos-prebaked.tar.gz" "ERROR"
    exit 1
fi

PACKAGE_SIZE=$(du -sh "$PACKAGE_TAR" | cut -f1)
write_log "✓ Package found: $PACKAGE_SIZE"
write_log ""

# Step 4: Extract package
write_log "Step 4: Extracting package to $INSTALL_ROOT..."

if [ -d "$INSTALL_ROOT" ]; then
    write_log "Removing existing installation directory..." "WARN"
    sudo rm -rf "$INSTALL_ROOT"
fi

EXTRACTION_START=$(date +%s)

# Create install directory
sudo mkdir -p "$INSTALL_ROOT"

# Extract tar.gz
write_log "Using tar to extract (10-30 seconds)..."
if sudo tar -xzf "$PACKAGE_TAR" -C "$INSTALL_ROOT" --strip-components=1; then
    EXTRACTION_END=$(date +%s)
    EXTRACTION_TIME=$((EXTRACTION_END - EXTRACTION_START))
    write_log "✓ Extraction completed in ${EXTRACTION_TIME}s" "SUCCESS"
else
    write_log "ERROR: Failed to extract package" "ERROR"
    exit 1
fi

# Set ownership
sudo chown -R "$ACTUAL_USER:staff" "$INSTALL_ROOT"

write_log ""

# Step 5: Create data directories
write_log "Step 5: Creating data directories..."

sudo mkdir -p "$DATA_DIR"
sudo mkdir -p "$LOG_DIR"
sudo chown -R "$ACTUAL_USER:staff" "$DATA_DIR"
sudo chown -R "$ACTUAL_USER:staff" "$LOG_DIR"

write_log "✓ Data directories created" "SUCCESS"
write_log ""

# Step 6: Create startup script
write_log "Step 6: Creating startup script..."

cat > "$INSTALL_ROOT/start-bytebotd.sh" <<'EOF'
#!/bin/bash
# Bytebot Startup Script
echo "Starting Bytebot Desktop Daemon..."

# Add Homebrew to PATH
if [[ -f "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -f "/usr/local/bin/brew" ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

# Add Node.js to PATH
if [[ -d "/opt/homebrew/opt/node@20/bin" ]]; then
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
elif [[ -d "/usr/local/opt/node@20/bin" ]]; then
    export PATH="/usr/local/opt/node@20/bin:$PATH"
fi

# Load Holo URL from container config if available
if [ -f "/shared/holo-config.sh" ]; then
    source "/shared/holo-config.sh"
    echo "Loaded Holo URL: $HOLO_URL"
else
    export HOLO_URL="${HOLO_URL:-http://bytebot-holo:9989}"
fi

# Set Holo environment variables
export BYTEBOT_CV_USE_HOLO=true
export HOLO_TIMEOUT=120000

cd /Users/Shared/bytebot/packages/bytebotd
node dist/main.js
EOF

chmod +x "$INSTALL_ROOT/start-bytebotd.sh"
chown "$ACTUAL_USER:staff" "$INSTALL_ROOT/start-bytebotd.sh"

write_log "✓ Startup script created" "SUCCESS"
write_log ""

# Step 7: Create LaunchAgent for auto-start
write_log "Step 7: Setting up auto-start..."

LAUNCH_AGENT_DIR="/Users/$ACTUAL_USER/Library/LaunchAgents"
sudo mkdir -p "$LAUNCH_AGENT_DIR"
sudo chown "$ACTUAL_USER:staff" "$LAUNCH_AGENT_DIR"

cat > "$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bytebot.bytebotd</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/Shared/bytebot/start-bytebotd.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/Shared/bytebot-logs/bytebotd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/Shared/bytebot-logs/bytebotd.error.log</string>
</dict>
</plist>
EOF

sudo chown "$ACTUAL_USER:staff" "$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist"

# Load LaunchAgent
sudo -u "$ACTUAL_USER" launchctl load "$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist" 2>/dev/null || {
    write_log "LaunchAgent will load on next login" "WARN"
}

write_log "✓ Auto-start configured" "SUCCESS"
write_log ""

# Step 8: Start bytebotd now
write_log "Step 8: Starting bytebotd service..."

sudo -u "$ACTUAL_USER" launchctl start com.bytebot.bytebotd 2>/dev/null || {
    write_log "Starting manually..." "WARN"
    cd "$INSTALL_ROOT/packages/bytebotd"
    sudo -u "$ACTUAL_USER" node dist/main.js &
    sleep 5
}

write_log "✓ Bytebotd started" "SUCCESS"
write_log ""

# Step 9: Wait for service to be ready
write_log "Step 9: Waiting for service to be ready (30 seconds)..."
sleep 30

# Step 10: Verify health check
write_log "Step 10: Verifying service health..."

MAX_ATTEMPTS=6
ATTEMPT_DELAY=10

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
    write_log "Health check attempt $i/$MAX_ATTEMPTS..."

    if curl -sf http://localhost:9990/health > /dev/null 2>&1; then
        write_log "✓ Service is healthy (attempt $i)" "SUCCESS"
        SERVICE_HEALTHY=true
        break
    else
        write_log "Service not ready yet, waiting ${ATTEMPT_DELAY}s..."
        sleep $ATTEMPT_DELAY
    fi
done

if [ "$SERVICE_HEALTHY" != "true" ]; then
    write_log "WARN: Health check timeout after $MAX_ATTEMPTS attempts" "WARN"
    write_log "Service may still be starting up" "WARN"
fi

write_log ""

# Installation summary
SETUP_DURATION=$(( $(date +%s) - $(date -j -f "%Y-%m-%d %H:%M:%S" "$SETUP_TIME" +%s 2>/dev/null || echo 0) ))
SETUP_MINUTES=$(( SETUP_DURATION / 60 ))
SETUP_SECONDS=$(( SETUP_DURATION % 60 ))

write_log "============================================"
write_log "   First-Time Setup Complete!"
write_log "   Duration: ${SETUP_MINUTES}m ${SETUP_SECONDS}s"
write_log "============================================"
write_log ""
write_log "Bytebotd Desktop Agent installed successfully."
write_log ""
write_log "Service status:"
write_log "  - Auto-start: LaunchAgent (runs on login)"
write_log "  - Port: 9990"
write_log "  - Logs: $LOG_DIR"
write_log "  - Install: $INSTALL_ROOT"
write_log ""
write_log "Access points:"
write_log "  - Health check: http://localhost:9990/health"
write_log "  - Web viewer: http://localhost:8006"
write_log "  - VNC: vnc://localhost:5900"
write_log ""
write_log -e "${CYAN}This container is now ready to be committed to a prebaked image.${NC}"
write_log -e "${CYAN}Run: docker commit <container> bytebot-macos-prebaked:latest${NC}"
write_log ""

exit 0
