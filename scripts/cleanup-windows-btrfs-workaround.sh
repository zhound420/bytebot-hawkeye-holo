#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
LOOP_FILE="/opt/bytebot-windows.img"
MOUNT_POINT="/opt/bytebot-windows-storage"

echo -e "${BLUE}Cleaning up Windows BTRFS workaround...${NC}"
echo ""

# Check for sudo
if ! sudo -n true 2>/dev/null; then
    echo -e "${YELLOW}This operation requires sudo privileges${NC}"
    echo -e "${YELLOW}You may be prompted for your password${NC}"
    echo ""
fi

# Unmount if mounted
if mount | grep -q "$MOUNT_POINT"; then
    echo -e "${BLUE}Unmounting ${MOUNT_POINT}...${NC}"
    if sudo umount "$MOUNT_POINT" 2>/dev/null; then
        echo -e "${GREEN}✓ Unmounted${NC}"
    else
        echo -e "${RED}✗ Failed to unmount (may be in use)${NC}"
        echo -e "${YELLOW}Stop Windows container first: docker stop bytebot-windows${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Loop device not mounted${NC}"
fi

# Remove loop file
if [[ -f "$LOOP_FILE" ]]; then
    echo -e "${BLUE}Removing loop file ${LOOP_FILE}...${NC}"
    FILE_SIZE=$(du -sh "$LOOP_FILE" 2>/dev/null | cut -f1)
    if sudo rm -f "$LOOP_FILE"; then
        echo -e "${GREEN}✓ Removed loop file (was ${FILE_SIZE})${NC}"
    else
        echo -e "${RED}✗ Failed to remove loop file${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Loop file does not exist${NC}"
fi

# Remove mount point directory
if [[ -d "$MOUNT_POINT" ]]; then
    echo -e "${BLUE}Removing mount point ${MOUNT_POINT}...${NC}"
    if sudo rmdir "$MOUNT_POINT" 2>/dev/null; then
        echo -e "${GREEN}✓ Removed mount point${NC}"
    else
        echo -e "${YELLOW}Mount point not empty or in use, leaving it${NC}"
    fi
else
    echo -e "${YELLOW}Mount point does not exist${NC}"
fi

echo ""
echo -e "${GREEN}Cleanup complete!${NC}"
echo -e "${BLUE}You can now use standard Docker volumes for Windows container${NC}"
echo ""
