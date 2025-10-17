#!/bin/bash
#
# Bytebot macOS Bootstrap Script
# Run this ONCE after macOS installation completes
# Usage: sudo bash /shared/setup-macos.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Bytebot macOS Bootstrap${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}ERROR: This script must be run as root${NC}"
    echo -e "${YELLOW}Run with: sudo bash /shared/setup-macos.sh${NC}"
    exit 1
fi

# Check if already bootstrapped
if [ -f "/Library/LaunchDaemons/com.bytebot.firstboot.plist" ]; then
    echo -e "${YELLOW}⚠ Bootstrap already completed${NC}"
    echo -e "${BLUE}LaunchDaemon is installed and will run on next boot${NC}"
    echo ""
    echo -e "${BLUE}To run installer manually now:${NC}"
    echo -e "  ${CYAN}sudo bash /shared/install-macos-prebaked.sh${NC}"
    echo ""
    exit 0
fi

# Step 1: Create log directory
echo -e "${BLUE}Step 1: Creating log directory...${NC}"
mkdir -p /Users/Shared/bytebot-logs
echo -e "${GREEN}✓ Log directory created${NC}"
echo ""

# Step 2: Check installer script
echo -e "${BLUE}Step 2: Checking installer script...${NC}"
if [ -f "/shared/install-macos-prebaked.sh" ]; then
    chmod +x /shared/install-macos-prebaked.sh
    echo -e "${GREEN}✓ Installer script found${NC}"
else
    echo -e "${RED}ERROR: Installer script not found${NC}"
    echo -e "${YELLOW}Expected: /shared/install-macos-prebaked.sh${NC}"
    exit 1
fi
echo ""

# Step 3: Install LaunchDaemon
echo -e "${BLUE}Step 3: Installing first-boot LaunchDaemon...${NC}"

# Copy plist from /shared to /Library/LaunchDaemons/
if [ -f "/shared/com.bytebot.firstboot.plist" ]; then
    cp /shared/com.bytebot.firstboot.plist /Library/LaunchDaemons/
    chmod 644 /Library/LaunchDaemons/com.bytebot.firstboot.plist
    chown root:wheel /Library/LaunchDaemons/com.bytebot.firstboot.plist
    echo -e "${GREEN}✓ LaunchDaemon plist installed${NC}"
else
    echo -e "${RED}ERROR: LaunchDaemon plist not found at /shared/com.bytebot.firstboot.plist${NC}"
    exit 1
fi
echo ""

# Step 4: Load LaunchDaemon
echo -e "${BLUE}Step 4: Loading LaunchDaemon...${NC}"
launchctl load /Library/LaunchDaemons/com.bytebot.firstboot.plist
echo -e "${GREEN}✓ LaunchDaemon loaded${NC}"
echo ""

# Step 5: Run installer now (optional - or wait for next boot)
echo -e "${BLUE}Step 5: Installation Options${NC}"
echo ""
echo "The first-boot installer is now configured."
echo ""
echo -e "${CYAN}Option 1:${NC} Run installer NOW (takes 5-8 minutes)"
echo -e "  ${YELLOW}sudo bash /shared/install-macos-prebaked.sh${NC}"
echo ""
echo -e "${CYAN}Option 2:${NC} Wait for next boot (automatic)"
echo -e "  The LaunchDaemon will run the installer automatically"
echo ""

read -p "Run installer now? [Y/n] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    echo ""
    echo -e "${BLUE}Running installer...${NC}"
    echo ""
    bash /shared/install-macos-prebaked.sh
else
    echo ""
    echo -e "${GREEN}Bootstrap complete!${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "  1. Installer will run automatically on next boot"
    echo "  2. OR run manually: sudo bash /shared/install-macos-prebaked.sh"
    echo "  3. Bytebotd will be available at http://localhost:9990 after installation"
    echo ""
fi
