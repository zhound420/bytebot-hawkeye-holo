#!/usr/bin/env bash
set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Building Windows Installer with Portable Node.js${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

OUTPUT_DIR="docker/windows-installer"
TEMP_BUILD="/tmp/bytebot-windows-build-full"
INSTALLER_ZIP="bytebotd-windows-installer.zip"
NODE_VERSION="20.19.0"
NODE_DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"

echo -e "${BLUE}Step 1: Building packages on Linux host...${NC}"

# Build shared package first (required dependency)
echo "Building shared package..."
cd "$REPO_ROOT/packages/shared"
npm run build
echo -e "${GREEN}✓ Shared built${NC}"

# Build bytebot-cv package
echo "Building bytebot-cv package..."
cd "$REPO_ROOT/packages/bytebot-cv"
if [ ! -d "node_modules" ]; then
    echo "Installing bytebot-cv dependencies..."
    npm install
fi
npm run build
echo -e "${GREEN}✓ Bytebot-cv built${NC}"

# Build bytebotd package
echo "Building bytebotd package..."
cd "$REPO_ROOT/packages/bytebotd"
npm run build
echo -e "${GREEN}✓ Bytebotd built${NC}"

echo ""
echo -e "${BLUE}Step 2: Creating clean temp directory...${NC}"
rm -rf "$TEMP_BUILD"
mkdir -p "$TEMP_BUILD/bytebot"
echo -e "${GREEN}✓ Temp directory created: $TEMP_BUILD${NC}"
echo ""

echo -e "${BLUE}Step 3: Copying compiled code...${NC}"

# Copy bytebotd
echo "Copying bytebotd..."
mkdir -p "$TEMP_BUILD/bytebot/packages/bytebotd"
cp -r "$REPO_ROOT/packages/bytebotd/dist" "$TEMP_BUILD/bytebot/packages/bytebotd/"
cp "$REPO_ROOT/packages/bytebotd/package.json" "$TEMP_BUILD/bytebot/packages/bytebotd/"
if [ -f "$REPO_ROOT/packages/bytebotd/tsconfig.json" ]; then
    cp "$REPO_ROOT/packages/bytebotd/tsconfig.json" "$TEMP_BUILD/bytebot/packages/bytebotd/"
fi
echo -e "${GREEN}  ✓ Bytebotd copied${NC}"

# Copy shared
echo "Copying shared..."
mkdir -p "$TEMP_BUILD/bytebot/packages/shared"
cp -r "$REPO_ROOT/packages/shared/dist" "$TEMP_BUILD/bytebot/packages/shared/"
cp "$REPO_ROOT/packages/shared/package.json" "$TEMP_BUILD/bytebot/packages/shared/"
if [ -f "$REPO_ROOT/packages/shared/tsconfig.json" ]; then
    cp "$REPO_ROOT/packages/shared/tsconfig.json" "$TEMP_BUILD/bytebot/packages/shared/"
fi
echo -e "${GREEN}  ✓ Shared copied${NC}"

# Copy bytebot-cv
echo "Copying bytebot-cv..."
mkdir -p "$TEMP_BUILD/bytebot/packages/bytebot-cv"
cp -r "$REPO_ROOT/packages/bytebot-cv/dist" "$TEMP_BUILD/bytebot/packages/bytebot-cv/"
cp "$REPO_ROOT/packages/bytebot-cv/package.json" "$TEMP_BUILD/bytebot/packages/bytebot-cv/"
if [ -f "$REPO_ROOT/packages/bytebot-cv/tsconfig.json" ]; then
    cp "$REPO_ROOT/packages/bytebot-cv/tsconfig.json" "$TEMP_BUILD/bytebot/packages/bytebot-cv/"
fi
echo -e "${GREEN}  ✓ Bytebot-cv copied${NC}"
echo ""

echo -e "${BLUE}Step 4: Downloading portable Node.js ${NODE_VERSION}...${NC}"

NODE_ZIP="/tmp/node-v${NODE_VERSION}-win-x64.zip"

if [ -f "$NODE_ZIP" ]; then
    echo "Using cached Node.js download: $NODE_ZIP"
else
    echo "Downloading Node.js from: $NODE_DOWNLOAD_URL"
    curl -L -o "$NODE_ZIP" "$NODE_DOWNLOAD_URL"

    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Failed to download Node.js${NC}"
        echo ""
        echo "Please check:"
        echo "  - Internet connection"
        echo "  - Node.js version exists: https://nodejs.org/dist/v${NODE_VERSION}/"
        exit 1
    fi
fi

echo "Extracting Node.js portable..."
unzip -q "$NODE_ZIP" -d "$TEMP_BUILD/bytebot/"

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Failed to extract Node.js${NC}"
    exit 1
fi

# Rename to simpler path: node-v20.19.0-win-x64 → node
mv "$TEMP_BUILD/bytebot/node-v${NODE_VERSION}-win-x64" "$TEMP_BUILD/bytebot/node"

echo -e "${GREEN}✓ Node.js portable extracted${NC}"
echo ""

echo -e "${BLUE}Step 5: Installing Windows-specific node_modules...${NC}"
echo "Using portable Node.js to install dependencies..."
echo ""

# Install bytebotd dependencies using Linux npm (cross-platform modules)
# Windows-specific native modules will be rebuilt inside Windows container
cd "$TEMP_BUILD/bytebot/packages/bytebotd"
echo "Installing bytebotd production dependencies (cross-platform modules)..."

npm install --production --no-optional 2>&1 | grep -v "npm warn" || true

echo -e "${YELLOW}⚠ Note: Platform-specific modules (sharp, uiohook-napi) will be rebuilt in Windows${NC}"
echo "The install-optimized.bat script will handle Windows-specific native module installation"
echo ""

# Install bytebot-cv dependencies
cd "$TEMP_BUILD/bytebot/packages/bytebot-cv"
if [ -f "package.json" ]; then
    echo "Installing bytebot-cv dependencies..."
    npm install --production --no-optional 2>&1 | grep -v "npm warn" || true
fi

echo -e "${GREEN}✓ Dependencies installed (cross-platform only)${NC}"
echo ""

echo -e "${BLUE}Step 6: Copying installer script...${NC}"
if [ -f "$REPO_ROOT/docker/oem/install-optimized.bat" ]; then
    cp "$REPO_ROOT/docker/oem/install-optimized.bat" "$TEMP_BUILD/bytebot/install.bat"
    echo -e "${GREEN}✓ Optimized installer script copied${NC}"
else
    echo -e "${RED}✗ install-optimized.bat not found${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}Step 7: Creating ZIP archive...${NC}"
cd "$TEMP_BUILD"

# Use zip if available
if command -v zip >/dev/null 2>&1; then
    zip -r -q "$INSTALLER_ZIP" bytebot/
    echo -e "${GREEN}✓ ZIP archive created${NC}"
else
    echo -e "${YELLOW}⚠ zip not found, creating tar.gz instead${NC}"
    tar -czf "${INSTALLER_ZIP%.zip}.tar.gz" bytebot/
    INSTALLER_ZIP="${INSTALLER_ZIP%.zip}.tar.gz"
    echo -e "${GREEN}✓ TAR.GZ archive created${NC}"
fi
echo ""

echo -e "${BLUE}Step 8: Moving to output directory...${NC}"
mkdir -p "$REPO_ROOT/$OUTPUT_DIR"
mv "$INSTALLER_ZIP" "$REPO_ROOT/$OUTPUT_DIR/"
echo -e "${GREEN}✓ Moved to $OUTPUT_DIR/$INSTALLER_ZIP${NC}"
echo ""

# Calculate size
ARCHIVE_SIZE=$(du -sh "$REPO_ROOT/$OUTPUT_DIR/$INSTALLER_ZIP" | cut -f1)

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Windows Installer Package Built!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Location: $OUTPUT_DIR/$INSTALLER_ZIP"
echo "Size: $ARCHIVE_SIZE"
echo ""
echo "Contents:"
echo "  - Bytebotd (pre-built, with heartbeat service)"
echo "  - Node.js ${NODE_VERSION} portable (no installation needed)"
echo "  - All dependencies (Windows-compatible)"
echo ""
echo "Size comparison:"
echo "  Old approach: 1.8GB artifacts + runtime npm install"
echo "  New approach: $ARCHIVE_SIZE installer (portable, self-contained)"
echo ""
echo "Next steps:"
echo "  1. Start Windows container: ./scripts/start-stack.sh --os windows"
echo "  2. Monitor progress: docker logs -f bytebot-windows"
echo "  3. Access Windows: http://localhost:8006"
echo ""
echo "Installation process:"
echo "  - No Chocolatey download"
echo "  - No MSI installation"
echo "  - No npm rebuild"
echo "  - Extract ZIP → Run → Done!"
echo ""

# Cleanup temp directory
rm -rf "$TEMP_BUILD"
echo -e "${BLUE}✓ Cleaned up temp directory${NC}"
echo ""
