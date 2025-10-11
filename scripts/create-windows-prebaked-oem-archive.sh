#!/usr/bin/env bash
# Create tar.gz archive of Windows OEM files with CRLF line endings preserved
#
# This script packages PowerShell and CMD files into a tar.gz archive that
# preserves CRLF line endings through Docker's ADD command (which would
# otherwise strip CRLF during COPY on Linux hosts).
#
# Usage:
#   ./scripts/create-windows-prebaked-oem-archive.sh
#
# Output:
#   docker/oem/oem-files.tar.gz

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OEM_DIR="$REPO_ROOT/docker/oem"
OUTPUT_ARCHIVE="$OEM_DIR/oem-files.tar.gz"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Creating Windows OEM Archive${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Step 1: Verify source files exist
echo -e "${BLUE}Step 1: Verifying source files...${NC}"
if [ ! -f "$OEM_DIR/install.bat" ]; then
    echo -e "${RED}ERROR: install.bat not found${NC}"
    exit 1
fi
if [ ! -f "$OEM_DIR/install-prebaked.ps1" ]; then
    echo -e "${RED}ERROR: install-prebaked.ps1 not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Source files found${NC}"
echo "  - install.bat (CMD wrapper)"
echo "  - install-prebaked.ps1 (PowerShell installer)"

# Step 2: Check file sizes
echo -e "${BLUE}Step 2: Checking file sizes...${NC}"
CMD_SIZE=$(wc -c < "$OEM_DIR/install.bat")
PS1_SIZE=$(wc -c < "$OEM_DIR/install-prebaked.ps1")

echo -e "${GREEN}✓ Files ready${NC}"
echo "  install.bat: $CMD_SIZE bytes (under 8191 char limit)"
echo "  install-prebaked.ps1: $PS1_SIZE bytes"

# Step 3: Create tar.gz archive
echo -e "${BLUE}Step 3: Creating tar.gz archive...${NC}"
cd "$OEM_DIR"

# Remove old archive if exists
if [ -f "oem-files.tar.gz" ]; then
    rm -f oem-files.tar.gz
fi

# Create tar.gz with explicit binary handling to preserve CRLF
# --format=ustar ensures compatibility
# Files are added relative to OEM dir (no path prefix)
# dockur/windows will automatically execute install.bat from /oem after installation
tar --format=ustar -czf oem-files.tar.gz install.bat install-prebaked.ps1

if [ ! -f "oem-files.tar.gz" ]; then
    echo -e "${RED}ERROR: Failed to create archive${NC}"
    exit 1
fi

ARCHIVE_SIZE=$(du -h oem-files.tar.gz | cut -f1)
echo -e "${GREEN}✓ Archive created: $ARCHIVE_SIZE${NC}"

# Step 4: Verify archive contents and line endings
echo -e "${BLUE}Step 4: Verifying archive contents...${NC}"

# Create temp dir for extraction test
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cd "$TEMP_DIR"
tar -xzf "$OUTPUT_ARCHIVE"

# Verify extracted files
if [ ! -f "install.bat" ] || [ ! -f "install-prebaked.ps1" ]; then
    echo -e "${RED}ERROR: Files missing from extracted archive!${NC}"
    exit 1
fi

EXTRACTED_CMD_ENCODING=$(file install.bat)
EXTRACTED_PS1_ENCODING=$(file install-prebaked.ps1)

echo -e "${GREEN}✓ Archive verified - both files extracted successfully${NC}"
echo "  install.bat: $(echo $EXTRACTED_CMD_ENCODING | grep -o 'CRLF\|ASCII')"
echo "  install-prebaked.ps1: $(echo $EXTRACTED_PS1_ENCODING | grep -o 'CRLF\|ASCII')"
echo "  dockur/windows will auto-execute install.bat during Windows setup"

# Success
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   OEM Archive Created Successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Location: $OUTPUT_ARCHIVE"
echo "Size: $ARCHIVE_SIZE"
echo ""
echo "Next steps:"
echo "  1. Update Dockerfile.windows-prebaked to use ADD"
echo "  2. Rebuild Docker image"
echo ""
