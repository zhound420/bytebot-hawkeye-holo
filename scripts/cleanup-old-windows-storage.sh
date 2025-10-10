#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Cleaning Up Old Windows Storage Artifacts${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check disk usage before
echo -e "${BLUE}Disk usage before cleanup:${NC}"
df -h / | grep -v Filesystem
echo ""

# Calculate total size to be freed
TOTAL_SIZE=0
if [ -f "/opt/bytebot-windows.img" ]; then
    LOOP_SIZE=$(du -sh /opt/bytebot-windows.img 2>/dev/null | cut -f1)
    echo -e "${YELLOW}Found loop device: /opt/bytebot-windows.img (${LOOP_SIZE})${NC}"
    TOTAL_SIZE=$((TOTAL_SIZE + $(du -sb /opt/bytebot-windows.img 2>/dev/null | cut -f1)))
fi

if [ -d "/tmp/test-windows-storage-fresh" ]; then
    TEST_SIZE=$(du -sh /tmp/test-windows-storage-fresh 2>/dev/null | cut -f1)
    echo -e "${YELLOW}Found test storage: /tmp/test-windows-storage-fresh (${TEST_SIZE})${NC}"
    TOTAL_SIZE=$((TOTAL_SIZE + $(du -sb /tmp/test-windows-storage-fresh 2>/dev/null | cut -f1)))
fi

if [ -d "/tmp/windows-storage-clean" ]; then
    CLEAN_SIZE=$(du -sh /tmp/windows-storage-clean 2>/dev/null | cut -f1)
    echo -e "${YELLOW}Found tmpfs storage: /tmp/windows-storage-clean (${CLEAN_SIZE})${NC}"
    TOTAL_SIZE=$((TOTAL_SIZE + $(du -sb /tmp/windows-storage-clean 2>/dev/null | cut -f1)))
fi

if [ $TOTAL_SIZE -eq 0 ]; then
    echo -e "${GREEN}✓ No old storage artifacts found - nothing to clean up!${NC}"
    exit 0
fi

TOTAL_SIZE_GB=$((TOTAL_SIZE / 1024 / 1024 / 1024))
echo ""
echo -e "${BLUE}Total space to be freed: ~${TOTAL_SIZE_GB}GB${NC}"
echo ""

# Ask for confirmation
read -p "Continue with cleanup? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Cleanup cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}Starting cleanup...${NC}"
echo ""

# Unmount loop device if mounted
if mount | grep -q "/opt/bytebot-windows-storage"; then
    echo -e "${BLUE}[1/3] Unmounting loop device...${NC}"
    sudo umount /opt/bytebot-windows-storage
    echo -e "${GREEN}✓ Unmounted${NC}"
else
    echo -e "${BLUE}[1/3] Loop device not mounted${NC}"
fi
echo ""

# Remove loop device file
if [ -f "/opt/bytebot-windows.img" ]; then
    echo -e "${BLUE}[2/3] Removing loop device file...${NC}"
    sudo rm -f /opt/bytebot-windows.img
    echo -e "${GREEN}✓ Removed /opt/bytebot-windows.img${NC}"
else
    echo -e "${BLUE}[2/3] Loop device file not found${NC}"
fi
echo ""

# Remove mount point
if [ -d "/opt/bytebot-windows-storage" ]; then
    echo -e "${BLUE}Removing mount point...${NC}"
    sudo rmdir /opt/bytebot-windows-storage 2>/dev/null || true
    echo -e "${GREEN}✓ Removed /opt/bytebot-windows-storage${NC}"
fi
echo ""

# Remove temporary storage directories
echo -e "${BLUE}[3/3] Removing temporary storage directories...${NC}"
if [ -d "/tmp/test-windows-storage-fresh" ]; then
    sudo rm -rf /tmp/test-windows-storage-fresh
    echo -e "${GREEN}✓ Removed /tmp/test-windows-storage-fresh${NC}"
fi

if [ -d "/tmp/windows-storage-clean" ]; then
    sudo rm -rf /tmp/windows-storage-clean
    echo -e "${GREEN}✓ Removed /tmp/windows-storage-clean${NC}"
fi
echo ""

# Show disk usage after
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Cleanup Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Disk usage after cleanup:${NC}"
df -h / | grep -v Filesystem
echo ""
echo -e "${GREEN}✓ Freed approximately ${TOTAL_SIZE_GB}GB of disk space${NC}"
echo ""
