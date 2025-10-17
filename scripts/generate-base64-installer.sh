#!/usr/bin/env bash
# Generate base64-encoded PowerShell installer embedded in CMD wrapper
#
# This script solves the CRLF/LF line ending issues by:
# 1. Base64-encoding the PowerShell script (no line endings in base64)
# 2. Embedding it in a CMD wrapper
# 3. Using PowerShell's -EncodedCommand parameter (decodes in-memory)
#
# This approach is immune to dockur/windows's OEM folder line ending conversions

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OEM_DIR="$REPO_ROOT/docker/oem"

PS1_SOURCE="$OEM_DIR/install-prebaked.ps1"
CMD_OUTPUT="$OEM_DIR/install.bat"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Generating Base64 PowerShell Installer${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Step 1: Verify PowerShell script exists
if [ ! -f "$PS1_SOURCE" ]; then
    echo -e "${RED}ERROR: PowerShell script not found: $PS1_SOURCE${NC}"
    exit 1
fi

PS1_SIZE=$(wc -c < "$PS1_SOURCE")
echo -e "${BLUE}Step 1: PowerShell script found (${PS1_SIZE} bytes)${NC}"

# Step 2: Convert PowerShell to UTF-16LE and base64 encode
echo -e "${BLUE}Step 2: Converting to base64...${NC}"

# PowerShell -EncodedCommand expects UTF-16LE base64
# We'll use iconv to convert UTF-8 → UTF-16LE, then base64 encode
BASE64_SCRIPT=$(iconv -f UTF-8 -t UTF-16LE "$PS1_SOURCE" | base64 -w 0)

if [ -z "$BASE64_SCRIPT" ]; then
    echo -e "${RED}ERROR: Base64 encoding failed${NC}"
    exit 1
fi

BASE64_SIZE=${#BASE64_SCRIPT}
echo -e "${GREEN}✓ Base64 encoded (${BASE64_SIZE} bytes)${NC}"

# Check if base64 is too large for CMD (8191 char limit per line)
if [ $BASE64_SIZE -gt 8000 ]; then
    echo -e "${RED}WARNING: Base64 script is very large (${BASE64_SIZE} bytes)${NC}"
    echo -e "${RED}CMD has 8191 character line limit - may need chunking${NC}"
fi

# Step 3: Generate CMD wrapper
echo -e "${BLUE}Step 3: Generating CMD wrapper...${NC}"

cat > "$CMD_OUTPUT" << 'CMDEOF'
@echo off
REM ================================================
REM   Bytebotd Pre-baked Installer (Base64 Wrapper)
REM ================================================
REM This CMD wrapper executes a base64-encoded PowerShell script
REM to avoid CRLF/LF line ending issues during OEM folder copying

echo ================================================
echo    Bytebotd Pre-baked Image Installer
echo ================================================
echo.

REM Decode and execute PowerShell script using -EncodedCommand
REM The script is encoded in UTF-16LE base64 format
powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand BASE64_PLACEHOLDER

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ================================================
    echo    Installation completed successfully!
    echo ================================================
) else (
    echo.
    echo ================================================
    echo    Installation failed with error code: %ERRORLEVEL%
    echo ================================================
    echo.
    echo Check logs at: C:\Bytebot-Logs\install-prebaked.log
    pause
)

exit /b %ERRORLEVEL%
CMDEOF

# Replace BASE64_PLACEHOLDER with actual base64 script
# Use perl for in-place replacement to handle large strings
perl -i -pe "s/BASE64_PLACEHOLDER/$BASE64_SCRIPT/" "$CMD_OUTPUT"

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to embed base64 script in CMD${NC}"
    exit 1
fi

echo -e "${GREEN}✓ CMD wrapper generated${NC}"

# Step 4: Verify output
OUTPUT_SIZE=$(wc -c < "$CMD_OUTPUT")
echo -e "${BLUE}Step 4: Verifying output...${NC}"
echo "  Output file: $CMD_OUTPUT"
echo "  Output size: $OUTPUT_SIZE bytes"

# Check if file was created correctly
if [ ! -f "$CMD_OUTPUT" ]; then
    echo -e "${RED}ERROR: CMD wrapper not created${NC}"
    exit 1
fi

if [ $OUTPUT_SIZE -lt 1000 ]; then
    echo -e "${RED}ERROR: CMD wrapper seems too small (${OUTPUT_SIZE} bytes)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ CMD wrapper verified${NC}"

# Step 5: Add DOS line endings to CMD file (for safety)
echo -e "${BLUE}Step 5: Adding CRLF line endings to CMD...${NC}"
unix2dos "$CMD_OUTPUT" 2>/dev/null || sed -i 's/$/\r/' "$CMD_OUTPUT"

CMD_ENCODING=$(file "$CMD_OUTPUT")
if [[ "$CMD_ENCODING" =~ "CRLF" ]] || [[ "$CMD_ENCODING" =~ "CR" ]]; then
    echo -e "${GREEN}✓ CRLF line endings added${NC}"
else
    echo -e "${RED}WARNING: Failed to add CRLF (but may not be critical for base64 approach)${NC}"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Base64 Installer Generated Successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Files created:"
echo "  - $CMD_OUTPUT (${OUTPUT_SIZE} bytes)"
echo ""
echo "How it works:"
echo "  1. PowerShell script converted to UTF-16LE"
echo "  2. Base64-encoded to eliminate line ending issues"
echo "  3. Embedded in install.bat as single-line string"
echo "  4. PowerShell -EncodedCommand decodes and executes in-memory"
echo ""
echo "Benefits:"
echo "  ✓ No external .ps1 file needed"
echo "  ✓ Immune to CRLF/LF conversions"
echo "  ✓ Executes entirely in-memory"
echo "  ✓ Single-file deployment"
echo "  ✓ Auto-executes via dockur/windows (install.bat in /oem)"
echo ""
echo "Next steps:"
echo "  1. Regenerate OEM archive: ./scripts/create-windows-prebaked-oem-archive.sh"
echo "  2. Rebuild Docker image: ./scripts/build-windows-prebaked-image.sh"
echo ""
