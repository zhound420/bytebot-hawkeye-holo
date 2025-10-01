#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   OmniParser Platform Detection & Setup${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Detect architecture
ARCH=$(uname -m)
OS=$(uname -s)

echo -e "${BLUE}Detected Platform:${NC}"
echo "  OS: $OS"
echo "  Architecture: $ARCH"
echo ""

# Detect if running on Apple Silicon
if [[ "$ARCH" == "arm64" ]] && [[ "$OS" == "Darwin" ]]; then
    echo -e "${GREEN}✓ Apple Silicon detected (M1/M2/M3/M4)${NC}"
    echo -e "${YELLOW}→ Native setup recommended for GPU acceleration (MPS)${NC}"
    echo ""

    # Check if already set up
    if [[ -d "packages/bytebot-omniparser/venv" ]] || [[ -d "packages/bytebot-omniparser/weights/icon_detect" ]]; then
        echo -e "${GREEN}✓ OmniParser already set up${NC}"
        echo ""
        echo "To start OmniParser natively:"
        echo -e "  ${BLUE}./scripts/start-omniparser.sh${NC}"
        echo ""
        exit 0
    fi

    # Set up native OmniParser
    echo -e "${BLUE}Setting up native OmniParser for Apple Silicon...${NC}"
    cd packages/bytebot-omniparser

    # Run setup script
    if [[ -f "scripts/setup.sh" ]]; then
        bash scripts/setup.sh
    else
        echo -e "${RED}✗ Setup script not found${NC}"
        exit 1
    fi

    cd ../..

    # Update docker/.env.defaults to point to native OmniParser
    if [[ -f "docker/.env.defaults" ]]; then
        echo ""
        echo -e "${BLUE}Configuring Docker to use native OmniParser...${NC}"

        # Create backup
        cp docker/.env.defaults docker/.env.defaults.backup

        # Update URL to point to host
        if grep -q "OMNIPARSER_URL=" docker/.env.defaults; then
            sed -i.bak 's|OMNIPARSER_URL=.*|OMNIPARSER_URL=http://host.docker.internal:9989|' docker/.env.defaults
            rm docker/.env.defaults.bak
        fi

        # Set device to mps
        if grep -q "OMNIPARSER_DEVICE=" docker/.env.defaults; then
            sed -i.bak 's|OMNIPARSER_DEVICE=.*|OMNIPARSER_DEVICE=mps|' docker/.env.defaults
            rm docker/.env.defaults.bak
        fi

        echo -e "${GREEN}✓ Docker configuration updated (docker/.env.defaults)${NC}"
    fi

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Setup Complete!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start OmniParser (native with M4 GPU):"
    echo -e "   ${BLUE}./scripts/start-omniparser.sh${NC}"
    echo ""
    echo "2. In another terminal, start Docker stack:"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    echo "Performance: ~1-2s per frame with MPS GPU 🚀"
    echo ""

elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo -e "${GREEN}✓ x86_64 detected${NC}"

    # Check for NVIDIA GPU
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${GREEN}✓ NVIDIA GPU detected${NC}"
        nvidia-smi --query-gpu=name --format=csv,noheader | head -1
        echo ""
        echo -e "${YELLOW}→ Docker container with CUDA recommended${NC}"
        DOCKER_COMPOSE_EXTRA=""
    else
        echo -e "${YELLOW}⚠ No NVIDIA GPU detected${NC}"
        echo -e "${YELLOW}→ Docker container with CPU will be used${NC}"
        DOCKER_COMPOSE_EXTRA=""
    fi

    # Update docker/.env.defaults
    if [[ -f "docker/.env.defaults" ]]; then
        echo ""
        echo -e "${BLUE}Configuring Docker for container-based OmniParser...${NC}"

        # Create backup
        cp docker/.env.defaults docker/.env.defaults.backup

        # Update URL to point to container
        if grep -q "OMNIPARSER_URL=" docker/.env.defaults; then
            sed -i.bak 's|OMNIPARSER_URL=.*|OMNIPARSER_URL=http://bytebot-omniparser:9989|' docker/.env.defaults
            rm docker/.env.defaults.bak
        fi

        # Set device to auto
        if grep -q "OMNIPARSER_DEVICE=" docker/.env.defaults; then
            sed -i.bak 's|OMNIPARSER_DEVICE=.*|OMNIPARSER_DEVICE=auto|' docker/.env.defaults
            rm docker/.env.defaults.bak
        fi

        echo -e "${GREEN}✓ Docker configuration updated (docker/.env.defaults)${NC}"
    fi

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Setup Complete!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo "Next step:"
    echo ""
    echo "Start the full Docker stack (includes OmniParser):"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    if command -v nvidia-smi &> /dev/null; then
        echo "Performance: ~0.6s per frame with CUDA GPU 🚀"
    else
        echo "Performance: ~8-15s per frame with CPU"
    fi
    echo ""
else
    echo -e "${RED}✗ Unsupported architecture: $ARCH${NC}"
    exit 1
fi
