#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Cleaning OpenCV Build Artifacts${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

echo -e "${YELLOW}This will remove OpenCV build artifacts that can cause npm install errors.${NC}"
echo ""

# Root node_modules
if [ -d "node_modules/@u4" ]; then
    echo -e "${BLUE}Cleaning root node_modules/@u4...${NC}"
    rm -rf node_modules/@u4/opencv-build 2>/dev/null || true
    rm -rf node_modules/@u4/.opencv-build-* 2>/dev/null || true
    echo -e "${GREEN}✓ Root cleaned${NC}"
fi

# bytebot-cv node_modules
if [ -d "packages/bytebot-cv/node_modules/@u4" ]; then
    echo -e "${BLUE}Cleaning bytebot-cv node_modules/@u4...${NC}"
    rm -rf packages/bytebot-cv/node_modules/@u4/opencv-build 2>/dev/null || true
    rm -rf packages/bytebot-cv/node_modules/@u4/.opencv-build-* 2>/dev/null || true
    echo -e "${GREEN}✓ bytebot-cv cleaned${NC}"
fi

# bytebot-agent node_modules
if [ -d "packages/bytebot-agent/node_modules/@u4" ]; then
    echo -e "${BLUE}Cleaning bytebot-agent node_modules/@u4...${NC}"
    rm -rf packages/bytebot-agent/node_modules/@u4/opencv-build 2>/dev/null || true
    rm -rf packages/bytebot-agent/node_modules/@u4/.opencv-build-* 2>/dev/null || true
    echo -e "${GREEN}✓ bytebot-agent cleaned${NC}"
fi

# bytebotd node_modules
if [ -d "packages/bytebotd/node_modules/@u4" ]; then
    echo -e "${BLUE}Cleaning bytebotd node_modules/@u4...${NC}"
    rm -rf packages/bytebotd/node_modules/@u4/opencv-build 2>/dev/null || true
    rm -rf packages/bytebotd/node_modules/@u4/.opencv-build-* 2>/dev/null || true
    echo -e "${GREEN}✓ bytebotd cleaned${NC}"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   OpenCV Artifacts Cleaned${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Now you can run:"
echo -e "  ${BLUE}./scripts/fresh-build.sh${NC}"
echo ""
