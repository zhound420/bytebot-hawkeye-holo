#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ISO_URL="https://archive.org/download/tiny11-2311/tiny11%202311%20x64.iso"
ISO_FILENAME="tiny11-2311-x64.iso"
CACHE_DIR="docker/iso-cache"
ISO_PATH="$CACHE_DIR/$ISO_FILENAME"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Tiny11 2311 ISO Downloader${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# Create cache directory if it doesn't exist
mkdir -p "$CACHE_DIR"

# Check if ISO already exists
if [ -f "$ISO_PATH" ]; then
    ISO_SIZE=$(du -sh "$ISO_PATH" | cut -f1)
    echo -e "${GREEN}✓ Tiny11 ISO already cached${NC}"
    echo "  Location: $ISO_PATH"
    echo "  Size: $ISO_SIZE"
    echo ""

    read -p "Redownload? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}Using existing ISO${NC}"
        exit 0
    fi

    echo -e "${YELLOW}Removing existing ISO...${NC}"
    rm -f "$ISO_PATH"
fi

echo -e "${BLUE}Downloading Tiny11 2311 ISO...${NC}"
echo "  URL: $ISO_URL"
echo "  Destination: $ISO_PATH"
echo "  Size: ~3.5GB (this may take 5-15 minutes depending on your connection)"
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

ISO_SIZE=$(du -sh "$ISO_PATH" | cut -f1)
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   ISO Download Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Location: $ISO_PATH"
echo "Size: $ISO_SIZE"
echo ""
echo "Next steps:"
echo "  1. ISO will be automatically used by fresh-build.sh when starting Windows"
echo "  2. To use immediately, uncomment the ISO mount in docker-compose.windows*.yml"
echo "  3. Run: ./scripts/fresh-build.sh --os windows"
echo ""
echo -e "${BLUE}Benefits:${NC}"
echo "  • No 3.5GB redownload on fresh Windows installs"
echo "  • Saves 5-10 minutes per fresh install"
echo "  • ISO persists even when Windows volume is removed"
echo ""
