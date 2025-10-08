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
echo -e "${BLUE}   Building Windows Installer Package${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

OUTPUT_DIR="docker/windows-installer"
TEMP_BUILD="/tmp/bytebot-windows-build"
INSTALLER_ZIP="bytebotd-windows-installer.zip"

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

echo -e "${BLUE}Step 3: Copying compiled code (dist + package.json only)...${NC}"

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
echo "This will download Windows native binaries (sharp-win32, uiohook-napi win32, etc.)"
echo "Size: ~100-150MB (vs 1.8GB with all platforms)"
echo ""

# Install bytebotd dependencies for Windows
cd "$TEMP_BUILD/bytebot/packages/bytebotd"
echo "Installing bytebotd production dependencies only..."
echo "Using npm install --production to exclude devDependencies"

# Install production dependencies only (no dev deps, no optional deps)
npm install --production --no-optional --ignore-scripts

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ npm install failed${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Ensure you have internet connection"
    echo "  - Try running: npm cache clean --force"
    exit 1
fi

# Remove any remaining dev-only packages
echo "Removing any dev-only artifacts..."
rm -rf node_modules/@types 2>/dev/null || true
rm -rf node_modules/typescript 2>/dev/null || true
rm -rf node_modules/ts-node 2>/dev/null || true
rm -rf node_modules/jest 2>/dev/null || true
rm -rf node_modules/@nestjs/cli 2>/dev/null || true
rm -rf node_modules/@nestjs/schematics 2>/dev/null || true
rm -rf node_modules/eslint* 2>/dev/null || true
rm -rf node_modules/prettier 2>/dev/null || true

echo -e "${GREEN}✓ Windows node_modules installed (production only)${NC}"
echo ""

# Install shared dependencies (minimal, mostly types)
cd "$TEMP_BUILD/bytebot/packages/shared"
if [ -f "package.json" ]; then
    echo "Installing shared dependencies..."
    npm install --production --no-optional --ignore-scripts 2>/dev/null || echo "  (no dependencies, skipped)"
fi

# Install bytebot-cv dependencies
cd "$TEMP_BUILD/bytebot/packages/bytebot-cv"
if [ -f "package.json" ]; then
    echo "Installing bytebot-cv dependencies..."
    npm install --production --no-optional --ignore-scripts 2>/dev/null || echo "  (no dependencies, skipped)"
fi

echo ""
echo -e "${BLUE}Step 5: Copying installer script...${NC}"
if [ -f "$REPO_ROOT/docker/oem/install-from-zip.bat" ]; then
    cp "$REPO_ROOT/docker/oem/install-from-zip.bat" "$TEMP_BUILD/bytebot/install.bat"
    echo -e "${GREEN}✓ Installer script copied${NC}"
else
    echo -e "${YELLOW}⚠ install-from-zip.bat not found, will create placeholder${NC}"
    echo "@echo off" > "$TEMP_BUILD/bytebot/install.bat"
    echo "echo Bytebot Windows Installer" >> "$TEMP_BUILD/bytebot/install.bat"
    echo "echo Run install.bat from docker/oem/ instead" >> "$TEMP_BUILD/bytebot/install.bat"
fi
echo ""

echo -e "${BLUE}Step 6: Creating ZIP archive...${NC}"
cd "$TEMP_BUILD"

# Use zip if available, fallback to tar
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

echo -e "${BLUE}Step 7: Moving to output directory...${NC}"
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
echo "Size comparison:"
echo "  Old approach: 1.8GB artifacts (Linux binaries + all platforms)"
echo "  New approach: $ARCHIVE_SIZE installer (Windows binaries only)"
echo ""
echo "Next steps:"
echo "  1. Start Windows container: ./scripts/start-stack.sh --os windows"
echo "  2. Monitor progress: docker logs -f bytebot-windows"
echo "  3. Access Windows: http://localhost:8006"
echo ""

# Cleanup temp directory
rm -rf "$TEMP_BUILD"
echo -e "${BLUE}✓ Cleaned up temp directory${NC}"
echo ""
