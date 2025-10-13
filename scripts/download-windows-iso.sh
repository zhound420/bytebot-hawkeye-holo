#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# Configuration
CACHE_DIR="docker/iso-cache"

# ISO variants
TINY11_URL="https://archive.org/download/tiny11-2311/tiny11%202311%20x64.iso"
TINY11_FILENAME="tiny11-2311-x64.iso"
TINY11_SIZE="~3.5GB"
TINY11_DOWNLOAD_TIME="5-15 minutes"

NANO11_URL="https://archive.org/download/nano11_25h2/nano11%2025h2.iso"
NANO11_FILENAME="nano11-25h2.iso"
NANO11_SIZE="~2.3GB"
NANO11_DOWNLOAD_TIME="3-10 minutes"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Windows ISO Downloader${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Create cache directory if it doesn't exist
mkdir -p "$CACHE_DIR"

# Check if any ISO already exists
EXISTING_ISO=""
if [ -f "$CACHE_DIR/$TINY11_FILENAME" ]; then
    EXISTING_ISO="Tiny11"
    EXISTING_PATH="$CACHE_DIR/$TINY11_FILENAME"
    EXISTING_SIZE=$(du -sh "$EXISTING_PATH" | cut -f1)
elif [ -f "$CACHE_DIR/$NANO11_FILENAME" ]; then
    EXISTING_ISO="Nano11"
    EXISTING_PATH="$CACHE_DIR/$NANO11_FILENAME"
    EXISTING_SIZE=$(du -sh "$EXISTING_PATH" | cut -f1)
fi

if [ -n "$EXISTING_ISO" ]; then
    echo -e "${GREEN}✓ $EXISTING_ISO ISO already cached${NC}"
    echo "  Location: $EXISTING_PATH"
    echo "  Size: $EXISTING_SIZE"
    echo ""

    read -p "Redownload? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}Using existing ISO${NC}"
        exit 0
    fi

    echo -e "${YELLOW}Removing existing ISO...${NC}"
    rm -f "$EXISTING_PATH"
fi

# Prompt user to choose ISO variant
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Select Windows ISO Variant${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo ""
echo "Which Windows ISO would you like to download?"
echo ""
echo -e "${GREEN}1) Tiny11 2311 (Recommended for general use)${NC}"
echo "   • Size: $TINY11_SIZE"
echo "   • Download time: $TINY11_DOWNLOAD_TIME"
echo "   • Features:"
echo "     ✅ Serviceable and updateable"
echo "     ✅ Windows Defender included"
echo "     ✅ Windows Update works"
echo "     ✅ Audio and most drivers"
echo "     ✅ Suitable for production/daily use"
echo ""
echo -e "${YELLOW}2) Nano11 25H2 (Minimal - testing/VMs only)${NC}"
echo "   • Size: $NANO11_SIZE (34% smaller!)"
echo "   • Download time: $NANO11_DOWNLOAD_TIME"
echo "   • Features:"
echo "     ✅ Extremely minimal footprint"
echo "     ✅ Faster download and installation"
echo "     ⚠️  NOT serviceable (cannot add features/drivers)"
echo "     ⚠️  No Windows Update (no security patches)"
echo "     ⚠️  No Windows Defender"
echo "     ⚠️  No Audio service (sound may not work)"
echo "     ⚠️  Minimal drivers (VGA, Net, Storage only)"
echo "     ✅ Best for: Quick testbeds, development VMs, embedded systems"
echo ""
read -p "Select variant [1-2] (default: 1): " -n 1 -r ISO_CHOICE
echo ""
echo ""

# Determine selected ISO
case $ISO_CHOICE in
    2)
        ISO_NAME="Nano11"
        ISO_URL="$NANO11_URL"
        ISO_FILENAME="$NANO11_FILENAME"
        ISO_SIZE="$NANO11_SIZE"
        ISO_DOWNLOAD_TIME="$NANO11_DOWNLOAD_TIME"
        echo -e "${YELLOW}✓ Nano11 25H2 selected (minimal variant)${NC}"
        echo ""
        echo -e "${RED}⚠️  IMPORTANT: Nano11 Limitations${NC}"
        echo "   • Cannot add Windows features or drivers after installation"
        echo "   • No Windows Update - will not receive security patches"
        echo "   • No Audio service - sound may not work"
        echo "   • Only use for testing, development, or embedded VMs"
        echo ""
        read -p "Continue with Nano11? [y/N] " -n 1 -r NANO11_CONFIRM
        echo ""
        if [[ ! $NANO11_CONFIRM =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Defaulting to Tiny11 (safer choice)${NC}"
            ISO_NAME="Tiny11"
            ISO_URL="$TINY11_URL"
            ISO_FILENAME="$TINY11_FILENAME"
            ISO_SIZE="$TINY11_SIZE"
            ISO_DOWNLOAD_TIME="$TINY11_DOWNLOAD_TIME"
        fi
        ;;
    1|"")
        ISO_NAME="Tiny11"
        ISO_URL="$TINY11_URL"
        ISO_FILENAME="$TINY11_FILENAME"
        ISO_SIZE="$TINY11_SIZE"
        ISO_DOWNLOAD_TIME="$TINY11_DOWNLOAD_TIME"
        echo -e "${GREEN}✓ Tiny11 2311 selected (recommended)${NC}"
        ;;
    *)
        echo -e "${YELLOW}Invalid choice, defaulting to Tiny11${NC}"
        ISO_NAME="Tiny11"
        ISO_URL="$TINY11_URL"
        ISO_FILENAME="$TINY11_FILENAME"
        ISO_SIZE="$TINY11_SIZE"
        ISO_DOWNLOAD_TIME="$TINY11_DOWNLOAD_TIME"
        ;;
esac

ISO_PATH="$CACHE_DIR/$ISO_FILENAME"

echo ""
echo -e "${BLUE}Downloading $ISO_NAME ISO...${NC}"
echo "  URL: $ISO_URL"
echo "  Destination: $ISO_PATH"
echo "  Size: $ISO_SIZE (this may take $ISO_DOWNLOAD_TIME depending on your connection)"
echo ""

# Download with curl (shows progress)
if command -v curl >/dev/null 2>&1; then
    curl -L -o "$ISO_PATH" "$ISO_URL" --progress-bar
elif command -v wget >/dev/null 2>&1; then
    wget -O "$ISO_PATH" "$ISO_URL"
else
    echo -e "${RED}ERROR: Neither curl nor wget found${NC}"
    echo "Please install curl or wget to download the ISO"
    exit 1
fi

# Verify download
if [ ! -f "$ISO_PATH" ]; then
    echo -e "${RED}ERROR: Download failed${NC}"
    exit 1
fi

FINAL_SIZE=$(du -sh "$ISO_PATH" | cut -f1)
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   ISO Download Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Variant: $ISO_NAME"
echo "Location: $ISO_PATH"
echo "Size: $FINAL_SIZE"
echo ""
echo "Next steps:"
echo "  1. ISO will be automatically used by fresh-build.sh when starting Windows"
echo "  2. To use immediately, uncomment the ISO mount in docker-compose.windows*.yml"
echo "  3. Run: ./scripts/fresh-build.sh --os windows"
echo ""
echo -e "${BLUE}Benefits:${NC}"
if [[ "$ISO_NAME" == "Tiny11" ]]; then
    echo "  • No 3.5GB redownload on fresh Windows installs"
else
    echo "  • No 2.3GB redownload on fresh Windows installs"
fi
echo "  • Saves 5-10 minutes per fresh install"
echo "  • ISO persists even when Windows volume is removed"
echo ""
if [[ "$ISO_NAME" == "Nano11" ]]; then
    echo -e "${YELLOW}Remember: Nano11 is not serviceable${NC}"
    echo "  • Cannot add Windows features or drivers"
    echo "  • No Windows Update - will not receive security patches"
    echo "  • Best for testing and development only"
    echo ""
fi
