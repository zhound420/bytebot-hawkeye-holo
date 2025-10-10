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
    echo "  Run: ./scripts/generate-base64-installer.sh"
    exit 1
fi
echo -e "${GREEN}✓ Source files found${NC}"
echo "  Note: PowerShell script is embedded as base64 inside install.bat"

# Step 2: Check CMD file encoding
echo -e "${BLUE}Step 2: Checking install.bat file...${NC}"
CMD_ENCODING=$(file "$OEM_DIR/install.bat")
CMD_SIZE=$(wc -c < "$OEM_DIR/install.bat")

echo -e "${GREEN}✓ CMD file ready${NC}"
echo "  Size: $CMD_SIZE bytes"
echo "  Encoding: $(echo $CMD_ENCODING | grep -o 'CRLF\|ASCII\|with very long lines')"
echo "  Contains: Base64-encoded PowerShell (immune to line ending issues)"

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
# NOTE: Only include install.bat (PowerShell is embedded as base64 inside)
# dockur/windows will automatically execute install.bat from /oem after installation
tar --format=ustar -czf oem-files.tar.gz install.bat

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

# Verify extracted files have CRLF
EXTRACTED_CMD_ENCODING=$(file install.bat)

if [[ ! "$EXTRACTED_CMD_ENCODING" =~ "CRLF" ]] && [[ ! "$EXTRACTED_CMD_ENCODING" =~ "with very long lines" ]]; then
    echo -e "${RED}ERROR: Extracted install.bat lost CRLF line endings!${NC}"
    echo "  Detected: $EXTRACTED_CMD_ENCODING"
    exit 1
fi

echo -e "${GREEN}✓ Archive verified - file extracted successfully${NC}"
echo "  Extracted install.bat: $(echo $EXTRACTED_CMD_ENCODING | grep -o 'CRLF\|with very long lines')"
echo "  Note: PowerShell script is embedded as base64 (immune to line ending issues)"
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
