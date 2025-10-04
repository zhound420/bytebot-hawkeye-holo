#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse command line arguments
FORCE_REINSTALL=false
for arg in "$@"; do
  case $arg in
    --force|-f)
      FORCE_REINSTALL=true
      shift
      ;;
  esac
done

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

# Function to validate GGUF model cache is complete
validate_model_cache() {
    local cache_dir="$1"

    # Check if directory exists
    if [[ ! -d "$cache_dir" ]]; then
        return 1
    fi

    # Check cache size (should be at least 5GB for GGUF Q4_K_M model + mmproj)
    local cache_size_mb=$(du -sm "$cache_dir" 2>/dev/null | awk '{print $1}' || echo "0")
    if [[ $cache_size_mb -lt 5000 ]]; then
        echo -e "${YELLOW}⚠ Incomplete cache detected: ${cache_size_mb}MB (expected ~6,000MB for GGUF)${NC}" >&2
        return 1
    fi

    # Check for GGUF model files (both model and mmproj)
    local gguf_files=$(find "$cache_dir" -type f -name "*.gguf" 2>/dev/null | wc -l)
    if [[ $gguf_files -lt 2 ]]; then
        echo -e "${YELLOW}⚠ Missing GGUF files (found ${gguf_files}, expected 2: model + mmproj)${NC}" >&2
        return 1
    fi

    return 0
}

# Function to clean incomplete cache
clean_incomplete_cache() {
    local cache_dir="$1"
    if [[ -d "$cache_dir" ]]; then
        echo -e "${YELLOW}Cleaning incomplete cache...${NC}"
        rm -rf "$cache_dir"
        echo -e "${GREEN}✓ Cache cleaned${NC}"
    fi
}

# Detect if running on Apple Silicon
if [[ "$ARCH" == "arm64" ]] && [[ "$OS" == "Darwin" ]]; then
    echo -e "${GREEN}✓ Apple Silicon detected (M1/M2/M3/M4)${NC}"
    echo -e "${YELLOW}→ Native setup recommended for GPU acceleration (MPS)${NC}"
    echo ""

    # Check if already set up (venv + GGUF model cached)
    MODEL_CACHE="$HOME/.cache/huggingface/hub/models--mradermacher--Holo1.5-7B-GGUF"

    # Check if force reinstall requested
    if [[ "$FORCE_REINSTALL" == "true" ]]; then
        echo -e "${YELLOW}Force reinstall requested${NC}"
        if [[ -d "packages/bytebot-holo/venv" ]]; then
            echo "Removing existing Python environment..."
            rm -rf packages/bytebot-holo/venv
        fi
        clean_incomplete_cache "$MODEL_CACHE"
        echo ""
    fi

    # Validate existing setup
    if [[ -d "packages/bytebot-holo/venv" ]] && validate_model_cache "$MODEL_CACHE" 2>/dev/null; then
        echo -e "${GREEN}✓ Holo 1.5-7B GGUF already set up${NC}"
        echo ""
        echo "Setup includes:"
        echo "  ✓ Python environment (venv)"
        echo "  ✓ GGUF model cached (~6 GB at ~/.cache/huggingface/)"
        echo ""
        # Show actual cache size
        CACHE_SIZE_MB=$(du -sm "$MODEL_CACHE" 2>/dev/null | awk '{print $1}' || echo "0")
        CACHE_SIZE_GB=$(echo "scale=1; $CACHE_SIZE_MB/1024" | bc)
        echo "  Cache size: ${CACHE_SIZE_GB}GB"
        echo ""
        echo "To start Holo 1.5-7B natively:"
        echo -e "  ${BLUE}./scripts/start-holo.sh${NC}"
        echo ""
        echo "To force reinstall:"
        echo -e "  ${BLUE}./scripts/setup-holo.sh --force${NC}"
        echo ""
        exit 0
    elif [[ -d "packages/bytebot-holo/venv" ]]; then
        echo -e "${YELLOW}⚠ Partial setup detected${NC}"
        echo "  ✓ Python environment exists"
        echo "  ✗ GGUF model not cached or incomplete"
        echo ""

        # Show diagnostic info
        if [[ -d "$MODEL_CACHE" ]]; then
            CACHE_SIZE_MB=$(du -sm "$MODEL_CACHE" 2>/dev/null | awk '{print $1}' || echo "0")
            echo "  Current cache size: ${CACHE_SIZE_MB}MB (expected: ~6,000MB for GGUF)"
            GGUF_COUNT=$(find "$MODEL_CACHE" -type f -name "*.gguf" 2>/dev/null | wc -l | tr -d ' ')
            echo "  GGUF files: $GGUF_COUNT (expected: 2 - model + mmproj)"
        fi

        echo ""
        clean_incomplete_cache "$MODEL_CACHE"
        echo ""
        echo -e "${BLUE}Re-running full setup...${NC}"
        echo ""
        # Don't exit - continue to model download section
        # Skip venv creation, but MUST upgrade packages in case requirements changed
        cd packages/bytebot-holo
        source venv/bin/activate

        echo "Upgrading dependencies to latest versions..."
        pip install --upgrade pip -q
        pip install -r requirements.txt --upgrade

        SKIP_VENV_CREATION=true
    fi

    # Set up native Holo 1.5-7B
    if [[ "$SKIP_VENV_CREATION" != "true" ]]; then
    echo -e "${BLUE}Setting up native Holo 1.5-7B for Apple Silicon...${NC}"
    cd packages/bytebot-holo

    # Create virtual environment
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate

    # Install dependencies
    echo "Installing dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt
    fi  # End of SKIP_VENV_CREATION check

    # Note about GGUF model auto-download
    MODEL_CACHE="$HOME/.cache/huggingface/hub/models--mradermacher--Holo1.5-7B-GGUF"
    if validate_model_cache "$MODEL_CACHE" 2>/dev/null; then
        echo ""
        echo -e "${GREEN}✓ GGUF model already cached${NC}"
        echo "  Location: $MODEL_CACHE"
        CACHE_SIZE_MB=$(du -sm "$MODEL_CACHE" 2>/dev/null | awk '{print $1}' || echo "0")
        CACHE_SIZE_GB=$(echo "scale=1; $CACHE_SIZE_MB/1024" | bc)
        echo "  Size: ${CACHE_SIZE_GB}GB"
        echo "  Skipping download"
        echo ""
    else
        echo ""
        echo -e "${BLUE}GGUF Model Download${NC}"
        echo "  Model: mradermacher/Holo1.5-7B-GGUF (Q4_K_M quantization)"
        echo "  Size: ~6 GB (model + mmproj)"
        echo "  Location: ~/.cache/huggingface/"
        echo ""
        echo -e "${YELLOW}Note: GGUF models download automatically on first run${NC}"
        echo "  llama-cpp-python will download the model when you start the service"
        echo "  This may take 5-15 minutes depending on your internet speed"
        echo ""

        # Check disk space first
        available_gb=$(df -g . 2>/dev/null | tail -1 | awk '{print $4}' || echo "999")
        if [ "$available_gb" != "999" ] && [ "$available_gb" -lt 15 ]; then
            echo -e "${YELLOW}⚠ Warning: Less than 15GB free disk space${NC}"
            echo "  Available: ${available_gb}GB"
            echo "  Recommended: 15GB (model + cache + overhead)"
            read -p "Continue anyway? [y/N] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Setup cancelled. Free up disk space and try again."
                deactivate
                exit 1
            fi
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
    echo "1. Start Holo 1.5-7B GGUF (native with Apple Silicon MPS GPU):"
    echo -e "   ${BLUE}./scripts/start-holo.sh${NC}"
    echo ""
    echo "2. In another terminal, start Docker stack:"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    echo "Model: mradermacher/Holo1.5-7B-GGUF (Q4_K_M - 4.8GB)"
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
    echo "Start the full Docker stack (includes Holo 1.5-7B GGUF):"
    echo -e "   ${BLUE}./scripts/start-stack.sh${NC}"
    echo ""
    echo "Model: mradermacher/Holo1.5-7B-GGUF (Q4_K_M - 4.8GB)"
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
