#!/bin/bash
# Bytebot macOS Setup Script
# Run this script inside the macOS container to set up bytebotd

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=================================${NC}"
echo -e "${CYAN}  Bytebot macOS Setup${NC}"
echo -e "${CYAN}=================================${NC}"
echo ""

# Check if running as root/sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}ERROR: This script must be run as root${NC}"
   echo -e "${YELLOW}Run with: sudo bash setup-macos-bytebotd.sh${NC}"
   exit 1
fi

# Get the actual user (not root)
ACTUAL_USER="${SUDO_USER:-$USER}"
echo -e "${BLUE}Running as: $ACTUAL_USER${NC}"
echo ""

# Install Homebrew if not already installed
echo -e "${BLUE}Checking for Homebrew package manager...${NC}"
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Installing Homebrew...${NC}"
    # Install Homebrew as the actual user, not root
    su - "$ACTUAL_USER" -c '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' || {
        echo -e "${RED}ERROR: Homebrew installation failed${NC}"
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
        echo -e "${RED}ERROR: Homebrew installed but not found in expected locations${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Homebrew installed successfully${NC}"
else
    echo -e "${GREEN}✓ Homebrew already installed${NC}"
    # Ensure PATH is set
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f "/usr/local/bin/brew" ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

# Install Node.js 20
echo ""
echo -e "${BLUE}Checking for Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js 20...${NC}"
    su - "$ACTUAL_USER" -c 'brew install node@20' || {
        echo -e "${RED}ERROR: Node.js installation failed${NC}"
        exit 1
    }

    # Link Node.js 20
    su - "$ACTUAL_USER" -c 'brew link node@20 --force --overwrite' || true

    # Add to PATH
    if [[ -d "/opt/homebrew/opt/node@20/bin" ]]; then
        export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif [[ -d "/usr/local/opt/node@20/bin" ]]; then
        export PATH="/usr/local/opt/node@20/bin:$PATH"
    fi

    if ! command -v node &> /dev/null; then
        echo -e "${RED}ERROR: Node.js installed but not found in PATH${NC}"
        exit 1
    fi

    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js installed successfully: $NODE_VERSION${NC}"
else
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js already installed: $NODE_VERSION${NC}"
fi

# Install Git (usually pre-installed on macOS, but check anyway)
echo ""
echo -e "${BLUE}Checking for Git...${NC}"
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Installing Git...${NC}"
    su - "$ACTUAL_USER" -c 'brew install git' || {
        echo -e "${RED}ERROR: Git installation failed${NC}"
        exit 1
    }
    echo -e "${GREEN}✓ Git installed successfully${NC}"
else
    echo -e "${GREEN}✓ Git already installed${NC}"
fi

# Create bytebotd directory
echo ""
echo -e "${BLUE}Setting up bytebotd directory...${NC}"
BYTEBOT_DIR="/Users/Shared/bytebot"
if [[ ! -d "$BYTEBOT_DIR" ]]; then
    mkdir -p "$BYTEBOT_DIR"
    chown -R "$ACTUAL_USER:staff" "$BYTEBOT_DIR"
    echo -e "${GREEN}✓ Created directory: $BYTEBOT_DIR${NC}"
else
    echo -e "${GREEN}✓ Directory already exists: $BYTEBOT_DIR${NC}"
fi

# Get source code
echo ""
echo -e "${BLUE}Getting bytebot source code...${NC}"

# Try multiple methods to get the source code
SOURCE_FOUND=false

# Try shared folder paths
SHARED_DIRS=(
    "/shared/bytebot-hawkeye-holo"
    "/Volumes/shared/bytebot-hawkeye-holo"
    "/mnt/shared/bytebot-hawkeye-holo"
)

for SHARED_DIR in "${SHARED_DIRS[@]}"; do
    if [[ -d "$SHARED_DIR" ]]; then
        echo -e "${YELLOW}Found shared folder: $SHARED_DIR${NC}"
        echo -e "${YELLOW}Copying source code...${NC}"
        cp -r "$SHARED_DIR"/* "$BYTEBOT_DIR/" || {
            echo -e "${YELLOW}WARNING: Failed to copy from $SHARED_DIR${NC}"
            continue
        }
        SOURCE_FOUND=true
        echo -e "${GREEN}✓ Source code copied successfully${NC}"
        break
    fi
done

if [[ "$SOURCE_FOUND" == "false" ]]; then
    echo -e "${YELLOW}Shared folder not found. Please provide the repository:${NC}"
    echo ""
    echo -e "${CYAN}Option 1: Clone from Git${NC}"
    echo -e "${NC}  git clone <repository-url> $BYTEBOT_DIR${NC}"
    echo ""
    echo -e "${CYAN}Option 2: Copy files manually to $BYTEBOT_DIR${NC}"
    echo ""
    read -p "Do you want to continue with manual setup? (y/n): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Setup cancelled. Please add source code and re-run this script.${NC}"
        exit 0
    fi
fi

# Verify source code exists
echo ""
echo -e "${BLUE}Verifying source code...${NC}"
REQUIRED_DIRS=(
    "$BYTEBOT_DIR/packages/shared"
    "$BYTEBOT_DIR/packages/bytebot-cv"
    "$BYTEBOT_DIR/packages/bytebotd"
)

for DIR in "${REQUIRED_DIRS[@]}"; do
    if [[ ! -d "$DIR" ]]; then
        echo -e "${RED}ERROR: Required directory not found: $DIR${NC}"
        echo -e "${YELLOW}Please ensure the complete source code is in $BYTEBOT_DIR${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ Source code verified${NC}"

# Install dependencies and build packages
echo ""
echo -e "${BLUE}Installing bytebotd dependencies (this may take a few minutes)...${NC}"

# Ensure ownership
chown -R "$ACTUAL_USER:staff" "$BYTEBOT_DIR"

# Build shared package
echo -e "${YELLOW}→ Building shared package...${NC}"
cd "$BYTEBOT_DIR/packages/shared"
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/shared' && npm install" || {
    echo -e "${RED}ERROR: npm install failed in shared${NC}"
    exit 1
}
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/shared' && npm run build" || {
    echo -e "${RED}ERROR: npm build failed in shared${NC}"
    exit 1
}
echo -e "${GREEN}  ✓ Shared package built${NC}"

# Build bytebot-cv package
echo -e "${YELLOW}→ Building bytebot-cv package...${NC}"
cd "$BYTEBOT_DIR/packages/bytebot-cv"
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/bytebot-cv' && npm install" || {
    echo -e "${RED}ERROR: npm install failed in bytebot-cv${NC}"
    exit 1
}
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/bytebot-cv' && npm run build" || {
    echo -e "${RED}ERROR: npm build failed in bytebot-cv${NC}"
    exit 1
}
echo -e "${GREEN}  ✓ bytebot-cv package built${NC}"

# Build bytebotd package
echo -e "${YELLOW}→ Building bytebotd package...${NC}"
cd "$BYTEBOT_DIR/packages/bytebotd"
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/bytebotd' && npm install" || {
    echo -e "${RED}ERROR: npm install failed in bytebotd${NC}"
    exit 1
}
su - "$ACTUAL_USER" -c "cd '$BYTEBOT_DIR/packages/bytebotd' && npm run build" || {
    echo -e "${RED}ERROR: npm build failed in bytebotd${NC}"
    exit 1
}
echo -e "${GREEN}  ✓ bytebotd package built${NC}"

# Create startup script
echo ""
echo -e "${BLUE}Creating startup script...${NC}"
cat > "$BYTEBOT_DIR/start-bytebotd.sh" <<'EOF'
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

cd /Users/Shared/bytebot/packages/bytebotd
node dist/main.js
EOF

chmod +x "$BYTEBOT_DIR/start-bytebotd.sh"
chown "$ACTUAL_USER:staff" "$BYTEBOT_DIR/start-bytebotd.sh"
echo -e "${GREEN}✓ Startup script created${NC}"

# Create LaunchAgent for auto-start
echo ""
echo -e "${BLUE}Setting up auto-start...${NC}"
LAUNCH_AGENT_DIR="/Users/$ACTUAL_USER/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENT_DIR"
chown "$ACTUAL_USER:staff" "$LAUNCH_AGENT_DIR"

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
    <string>/Users/Shared/bytebot/bytebotd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/Shared/bytebot/bytebotd.error.log</string>
</dict>
</plist>
EOF

chown "$ACTUAL_USER:staff" "$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist"

# Unload existing LaunchAgent if present
su - "$ACTUAL_USER" -c "launchctl unload '$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist' 2>/dev/null" || true

# Load LaunchAgent
su - "$ACTUAL_USER" -c "launchctl load '$LAUNCH_AGENT_DIR/com.bytebot.bytebotd.plist'" || {
    echo -e "${YELLOW}WARNING: Failed to load LaunchAgent${NC}"
    echo -e "${YELLOW}You'll need to start bytebotd manually${NC}"
}

echo -e "${GREEN}✓ Auto-start configured${NC}"

echo ""
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo -e "${NC}Bytebotd will start automatically on next login.${NC}"
echo ""
echo -e "${YELLOW}To start manually now:${NC}"
echo -e "${CYAN}  cd /Users/Shared/bytebot/packages/bytebotd${NC}"
echo -e "${CYAN}  node dist/main.js${NC}"
echo ""
echo -e "${NC}Service will be available on:${NC}"
echo -e "${CYAN}  - API: http://localhost:9990${NC}"
echo -e "${CYAN}  - Progress WS: ws://localhost:8081${NC}"
echo ""
echo -e "${NC}Logs:${NC}"
echo -e "${CYAN}  - Output: /Users/Shared/bytebot/bytebotd.log${NC}"
echo -e "${CYAN}  - Errors: /Users/Shared/bytebot/bytebotd.error.log${NC}"
echo ""
