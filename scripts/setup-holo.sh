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

    # Check if already set up (venv + model cached)
    MODEL_CACHE="$HOME/.cache/huggingface/hub/models--Hcompany--Holo1.5-7B"
    if [[ -d "packages/bytebot-omniparser/venv" ]] && [[ -d "$MODEL_CACHE" ]]; then
        echo -e "${GREEN}✓ Holo 1.5-7B already set up${NC}"
        echo ""
        echo "Setup includes:"
        echo "  ✓ Python environment (venv)"
        echo "  ✓ Model cached (~15.4 GB at ~/.cache/huggingface/)"
        echo ""
        echo "To start Holo 1.5-7B natively:"
        echo -e "  ${BLUE}./scripts/start-holo.sh${NC}"
        echo ""
        exit 0
    elif [[ -d "packages/bytebot-omniparser/venv" ]] && [[ ! -d "$MODEL_CACHE" ]]; then
        echo -e "${YELLOW}⚠ Partial setup detected${NC}"
        echo "  ✓ Python environment exists"
        echo "  ✗ Model not cached"
        echo ""
        echo -e "${BLUE}Re-running model download...${NC}"
        echo ""
        # Don't exit - continue to model download section
        # Skip venv creation, go straight to model download
        cd packages/bytebot-omniparser
        source venv/bin/activate
        SKIP_VENV_CREATION=true
    fi

    # Set up native Holo 1.5-7B
    if [[ "$SKIP_VENV_CREATION" != "true" ]]; then
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
    fi  # End of SKIP_VENV_CREATION check

    # Download Holo 1.5-7B model (~15.4 GB) - only if not cached
    MODEL_CACHE="$HOME/.cache/huggingface/hub/models--Hcompany--Holo1.5-7B"
    if [[ -d "$MODEL_CACHE" ]]; then
        echo ""
        echo -e "${GREEN}✓ Model already cached${NC}"
        echo "  Location: $MODEL_CACHE"
        echo "  Skipping download"
        echo ""
    else
        # Download Holo 1.5-7B model (~15.4 GB)
    echo ""
    echo -e "${BLUE}Downloading Holo 1.5-7B model...${NC}"
    echo "  Size: ~15.4 GB (one-time download)"
    echo "  Location: ~/.cache/huggingface/"
    echo "  This may take 5-30 minutes depending on your internet speed"
    echo ""

    # Check disk space first
    available_gb=$(df -g . 2>/dev/null | tail -1 | awk '{print $4}' || echo "999")
    if [ "$available_gb" != "999" ] && [ "$available_gb" -lt 25 ]; then
        echo -e "${YELLOW}⚠ Warning: Less than 25GB free disk space${NC}"
        echo "  Available: ${available_gb}GB"
        echo "  Recommended: 25GB (model + cache)"
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Setup cancelled. Free up disk space and try again."
            deactivate
            exit 1
        fi
    fi

    # Download with progress indication
    python << 'EOFDL'
from transformers import AutoModelForImageTextToText, AutoProcessor
import sys

print("📥 Downloading processor...")
try:
    processor = AutoProcessor.from_pretrained(
        "Hcompany/Holo1.5-7B",
        trust_remote_code=True
    )
    print("✓ Processor downloaded")
except Exception as e:
    print(f"✗ Processor download failed: {e}")
    sys.exit(1)

print("\n📥 Downloading model (this is the large file ~15.4 GB)...")
print("   Progress: Check ~/.cache/huggingface/ for download status")
try:
    model = AutoModelForImageTextToText.from_pretrained(
        "Hcompany/Holo1.5-7B",
        trust_remote_code=True
    )
    print("✓ Model downloaded successfully!")
    print("   Cached at: ~/.cache/huggingface/hub/")
except Exception as e:
    print(f"✗ Model download failed: {e}")
    print("   The model will download on first start instead.")
    sys.exit(1)
EOFDL

    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Model downloaded and cached${NC}"
    else
        echo ""
        echo -e "${YELLOW}⚠ Model download incomplete${NC}"
        echo "  The model will download on first start instead."
        echo "  This is not a fatal error - setup will continue."
    fi
    fi  # End of model cache check

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
    echo -e "   ${BLUE}./scripts/start-holo.sh${NC}"
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
