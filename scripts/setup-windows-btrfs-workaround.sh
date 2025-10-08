#!/usr/bin/env bash
set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
LOOP_FILE="/opt/bytebot-windows.img"
MOUNT_POINT="/opt/bytebot-windows-storage"
LOOP_SIZE="160G"  # Sparse file size

echo -e "${BLUE}Checking filesystem compatibility for Windows container...${NC}"

# Detect root filesystem type
FS_TYPE=$(df -T / | tail -1 | awk '{print $2}')
echo -e "${BLUE}Detected filesystem: ${YELLOW}${FS_TYPE}${NC}"

# If not BTRFS, no workaround needed
if [[ "$FS_TYPE" != "btrfs" ]]; then
    echo -e "${GREEN}✓ ${FS_TYPE} detected - no workaround needed${NC}"
    echo ""
    exit 0
fi

# BTRFS detected - need workaround
echo -e "${YELLOW}⚠️  BTRFS detected - Windows containers require ext4/xfs${NC}"
echo -e "${BLUE}Setting up ext4 loop device workaround...${NC}"
echo ""

# Check if already set up
if mount | grep -q "$MOUNT_POINT"; then
    echo -e "${GREEN}✓ Loop device already mounted at ${MOUNT_POINT}${NC}"
    echo "$MOUNT_POINT"
    exit 0
fi

# Check if loop file exists but not mounted
if [[ -f "$LOOP_FILE" ]]; then
    echo -e "${BLUE}Loop file exists, mounting...${NC}"

    # Create mount point if needed
    sudo mkdir -p "$MOUNT_POINT"

    # Mount the loop device
    if sudo mount -o loop "$LOOP_FILE" "$MOUNT_POINT" 2>/dev/null; then
        echo -e "${GREEN}✓ Mounted existing loop device${NC}"
        echo "$MOUNT_POINT"
        exit 0
    else
        echo -e "${YELLOW}Existing loop file appears corrupted, recreating...${NC}"
        sudo rm -f "$LOOP_FILE"
    fi
fi

# Need to create everything from scratch
echo -e "${BLUE}Creating new ext4 loop device for Windows storage...${NC}"
echo ""

# Check for sudo
if ! sudo -n true 2>/dev/null; then
    echo -e "${YELLOW}This operation requires sudo privileges${NC}"
    echo -e "${YELLOW}You may be prompted for your password${NC}"
    echo ""
fi

# Create sparse file (doesn't actually allocate 160GB upfront)
echo -e "${BLUE}[1/4] Creating ${LOOP_SIZE} sparse file at ${LOOP_FILE}${NC}"
echo -e "${BLUE}      (sparse file grows as needed, not 160GB upfront)${NC}"
if sudo dd if=/dev/zero of="$LOOP_FILE" bs=1 count=0 seek="$LOOP_SIZE" 2>&1 | grep -v "records"; then
    echo -e "${GREEN}✓ Sparse file created${NC}"
else
    echo -e "${RED}✗ Failed to create sparse file${NC}"
    exit 1
fi
echo ""

# Format as ext4
echo -e "${BLUE}[2/4] Formatting as ext4...${NC}"
if sudo mkfs.ext4 -F -q "$LOOP_FILE" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Formatted as ext4${NC}"
else
    echo -e "${RED}✗ Failed to format loop file${NC}"
    sudo rm -f "$LOOP_FILE"
    exit 1
fi
echo ""

# Create mount point
echo -e "${BLUE}[3/4] Creating mount point at ${MOUNT_POINT}${NC}"
if sudo mkdir -p "$MOUNT_POINT"; then
    echo -e "${GREEN}✓ Mount point created${NC}"
else
    echo -e "${RED}✗ Failed to create mount point${NC}"
    sudo rm -f "$LOOP_FILE"
    exit 1
fi
echo ""

# Mount the loop device
echo -e "${BLUE}[4/4] Mounting loop device...${NC}"
if sudo mount -o loop "$LOOP_FILE" "$MOUNT_POINT"; then
    echo -e "${GREEN}✓ Loop device mounted${NC}"
else
    echo -e "${RED}✗ Failed to mount loop device${NC}"
    sudo rm -f "$LOOP_FILE"
    sudo rmdir "$MOUNT_POINT" 2>/dev/null || true
    exit 1
fi
echo ""

# Set permissions so Docker can use it
echo -e "${BLUE}Setting permissions...${NC}"
sudo chmod 755 "$MOUNT_POINT"
echo -e "${GREEN}✓ Permissions set${NC}"
echo ""

# Check current actual size
ACTUAL_SIZE=$(du -sh "$LOOP_FILE" 2>/dev/null | cut -f1)
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Loop Device Setup Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Loop file:${NC} $LOOP_FILE"
echo -e "${BLUE}Mount point:${NC} $MOUNT_POINT"
echo -e "${BLUE}Max size:${NC} $LOOP_SIZE (sparse, grows as needed)"
echo -e "${BLUE}Current size:${NC} $ACTUAL_SIZE"
echo ""
echo -e "${YELLOW}Note: This mount will not persist across reboots${NC}"
echo -e "${YELLOW}Run this script again after reboot, or add to /etc/fstab:${NC}"
echo -e "${BLUE}  ${LOOP_FILE} ${MOUNT_POINT} ext4 loop 0 2${NC}"
echo ""

# Output the mount point for start-stack.sh to use
echo "$MOUNT_POINT"
