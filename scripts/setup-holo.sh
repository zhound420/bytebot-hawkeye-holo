#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Holo 1.5-7B Platform Detection & Setup${NC}"
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
    if [[ -d "packages/bytebot-omniparser/venv" ]]; then
        echo -e "${GREEN}✓ Holo 1.5-7B already set up${NC}"
        echo ""
        echo "To start Holo 1.5-7B natively:"
        echo -e "  ${BLUE}./scripts/start-omniparser.sh${NC}"
        echo ""
        exit 0
    fi

    # Set up native Holo 1.5-7B
    echo -e "${BLUE}Setting up native Holo 1.5-7B for Apple Silicon...${NC}"
    cd packages/bytebot-omniparser

    # Create virtual environment
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate

    # Install dependencies
    echo "Installing dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt

    deactivate

    cd ../..

    # Update docker/.env to point to native Holo
    if [[ -f "docker/.env" ]]; then
        echo ""
        echo -e "${BLUE}Configuring Docker to use native Holo 1.5-7B...${NC}"

        # Create backup
        cp docker/.env docker/.env.backup

        # Update URL to point to host
        if grep -q "HOLO_URL=" docker/.env; then
            sed -i.bak 's|HOLO_URL=.*|HOLO_URL=http://host.docker.internal:9989|' docker/.env
            rm docker/.env.bak
        else
            echo "HOLO_URL=http://host.docker.internal:9989" >> docker/.env
        fi

        # Set device to mps
        if grep -q "HOLO_DEVICE=" docker/.env; then
            sed -i.bak 's|HOLO_DEVICE=.*|HOLO_DEVICE=mps|' docker/.env
            rm docker/.env.bak
        else
            echo "HOLO_DEVICE=mps" >> docker/.env
        fi

        echo -e "${GREEN}✓ Docker configuration updated (docker/.env)${NC}"
    fi

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Setup Complete!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start Holo 1.5-7B (native with Apple Silicon MPS GPU):"
    echo -e "   ${BLUE}./scripts/start-omniparser.sh${NC}"
    echo ""
    echo "2. In another terminal, start Docker stack:"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    echo "Performance: ~1.5-2.5s per inference with MPS GPU 🚀"
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

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Setup Complete!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo "Next step:"
    echo ""
    echo "Start the full Docker stack (includes Holo 1.5-7B):"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    if command -v nvidia-smi &> /dev/null; then
        echo "Performance: ~0.8-1.5s per inference with CUDA GPU 🚀"
    else
        echo "Performance: ~8-15s per inference with CPU"
    fi
    echo ""
else
    echo -e "${RED}✗ Unsupported architecture: $ARCH${NC}"
    exit 1
fi
