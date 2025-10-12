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
echo -e "${BLUE}   Building Windows Pre-baked Package${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

OUTPUT_DIR="docker/windows-installer"
TEMP_BUILD="/tmp/bytebot-windows-prebaked-build"
PACKAGE_ZIP="bytebotd-prebaked.zip"

echo -e "${BLUE}Step 1: Building packages on Linux host...${NC}"

# Build shared package first (required dependency)
echo "Building shared package..."
cd "$REPO_ROOT/packages/shared"
if [ ! -d "node_modules" ]; then
    echo "Installing shared dependencies (including devDeps for build)..."
    npm install
fi
npm run build
echo -e "${GREEN}✓ Shared built${NC}"

# Build bytebot-cv package
echo "Building bytebot-cv package..."
cd "$REPO_ROOT/packages/bytebot-cv"
if [ ! -d "node_modules" ]; then
    echo "Installing bytebot-cv dependencies (including devDeps for build)..."
    npm install
fi
npm run build
echo -e "${GREEN}✓ Bytebot-cv built${NC}"

# Build bytebotd package
echo "Building bytebotd package..."
cd "$REPO_ROOT/packages/bytebotd"
if [ ! -d "node_modules" ]; then
    echo "Installing bytebotd dependencies (including devDeps for build)..."
    npm install
fi
npm run build
echo -e "${GREEN}✓ Bytebotd built${NC}"

echo ""
echo -e "${BLUE}Step 2: Creating clean temp directory...${NC}"
rm -rf "$TEMP_BUILD"
mkdir -p "$TEMP_BUILD/bytebot/packages"
echo -e "${GREEN}✓ Temp directory created: $TEMP_BUILD${NC}"
echo ""

echo -e "${BLUE}Step 3: Copying compiled code (dist + package.json + node_modules)...${NC}"

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
echo -e "${BLUE}Step 4: Installing Windows-specific node_modules...${NC}"
echo "This will download Windows native binaries (~100-150MB)"
echo ""

# Install bytebotd dependencies
cd "$TEMP_BUILD/bytebot/packages/bytebotd"
echo "Installing bytebotd production dependencies..."

# Install sharp with Windows-native binaries FIRST
echo "  Installing sharp base package and Windows platform binaries..."
npm install --production --force sharp @img/sharp-win32-x64

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ sharp install failed${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Sharp installed with Windows binaries${NC}"

# Install remaining dependencies
echo "  Installing remaining dependencies..."
npm install --production --force

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Bytebotd dependencies installed${NC}"

# Install shared dependencies
cd "$TEMP_BUILD/bytebot/packages/shared"
echo "Installing shared dependencies..."
npm install --production 2>&1 | grep -v "npm warn" || echo "  (no dependencies, skipped)"

# Install bytebot-cv dependencies
cd "$TEMP_BUILD/bytebot/packages/bytebot-cv"
echo "Installing bytebot-cv dependencies..."
npm install --production

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ bytebot-cv npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Bytebot-cv dependencies installed${NC}"

echo ""
echo -e "${BLUE}Step 5: Copying helper scripts...${NC}"

# Copy installer script
cp "$REPO_ROOT/docker/oem/install-prebaked.ps1" "$TEMP_BUILD/bytebot/" 2>/dev/null || \
    echo -e "${YELLOW}⚠ install-prebaked.ps1 not found (will be created)${NC}"

# Copy helper scripts to bytebotd directory
if [ -f "$REPO_ROOT/docker/oem/start-bytebotd.bat" ]; then
    cp "$REPO_ROOT/docker/oem/start-bytebotd.bat" "$TEMP_BUILD/bytebot/packages/bytebotd/"
fi

if [ -f "$REPO_ROOT/docker/oem/bytebotd-tray.ps1" ]; then
    cp "$REPO_ROOT/docker/oem/bytebotd-tray.ps1" "$TEMP_BUILD/bytebot/packages/bytebotd/"
fi

if [ -f "$REPO_ROOT/docker/oem/diagnose.ps1" ]; then
    cp "$REPO_ROOT/docker/oem/diagnose.ps1" "$TEMP_BUILD/bytebot/packages/bytebotd/"
fi

echo -e "${GREEN}✓ Helper scripts copied${NC}"
echo ""

echo -e "${BLUE}Step 6: Creating ZIP archive...${NC}"
cd "$TEMP_BUILD"

# Use zip if available, fallback to tar
if command -v zip >/dev/null 2>&1; then
    zip -r -q "$PACKAGE_ZIP" bytebot/
    echo -e "${GREEN}✓ ZIP archive created${NC}"
else
    echo -e "${YELLOW}⚠ zip not found, creating tar.gz instead${NC}"
    tar -czf "${PACKAGE_ZIP%.zip}.tar.gz" bytebot/
    PACKAGE_ZIP="${PACKAGE_ZIP%.zip}.tar.gz"
    echo -e "${GREEN}✓ TAR.GZ archive created${NC}"
fi
echo ""

echo -e "${BLUE}Step 7: Moving to output directory...${NC}"
mkdir -p "$REPO_ROOT/$OUTPUT_DIR"
mv "$PACKAGE_ZIP" "$REPO_ROOT/$OUTPUT_DIR/"
echo -e "${GREEN}✓ Moved to $OUTPUT_DIR/$PACKAGE_ZIP${NC}"
echo ""

# Calculate size
ARCHIVE_SIZE=$(du -sh "$REPO_ROOT/$OUTPUT_DIR/$PACKAGE_ZIP" | cut -f1)

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Windows Pre-baked Package Built!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Location: $OUTPUT_DIR/$PACKAGE_ZIP"
echo "Size: $ARCHIVE_SIZE"
echo ""
echo "Package contents:"
echo "  ✓ Compiled TypeScript (dist/ folders)"
echo "  ✓ Windows node_modules (platform-specific binaries)"
echo "  ✓ PowerShell installer script"
echo "  ✓ Helper scripts (tray icon, diagnostics)"
echo ""
echo "Next steps:"
echo "  1. Build Docker image: ./scripts/build-windows-prebaked-image.sh"
echo "  2. Start container: ./scripts/start-stack.sh --os windows --prebaked"
echo ""

# Cleanup temp directory
rm -rf "$TEMP_BUILD"
echo -e "${BLUE}✓ Cleaned up temp directory${NC}"
echo ""
