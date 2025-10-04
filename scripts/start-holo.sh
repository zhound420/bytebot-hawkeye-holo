#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ARCH=$(uname -m)
OS=$(uname -s)

# Only for Apple Silicon
if [[ "$ARCH" != "arm64" ]] || [[ "$OS" != "Darwin" ]]; then
    echo -e "${RED}✗ This script is for Apple Silicon Macs only${NC}"
    echo ""
    echo "On x86_64 systems, Holo 1.5-7B runs in Docker automatically."
    echo "Just run: ./scripts/start-stack.sh"
    exit 1
fi

# Function to validate GGUF model cache is complete (same as setup script)
validate_model_cache() {
    local cache_dir="$1"

    # Check if directory exists
    if [[ ! -d "$cache_dir" ]]; then
        return 1
    fi

    # Check cache size (should be at least 5GB for GGUF Q4_K_M model + mmproj)
    local cache_size_mb=$(du -sm "$cache_dir" 2>/dev/null | awk '{print $1}' || echo "0")
    if [[ $cache_size_mb -lt 5000 ]]; then
        return 1
    fi

    # Check for GGUF model files (both model and mmproj)
    local gguf_files=$(find "$cache_dir" -type f -name "*.gguf" 2>/dev/null | wc -l)
    if [[ $gguf_files -lt 2 ]]; then
        return 1
    fi

    return 0
}

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting Holo 1.5-7B (Native with MPS GPU)${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if setup has been run
if [[ ! -d "packages/bytebot-holo/venv" ]]; then
    echo -e "${RED}✗ Holo 1.5-7B not set up yet${NC}"
    echo ""
    echo "Run setup first:"
    echo -e "  ${BLUE}./scripts/setup-holo.sh${NC}"
    exit 1
fi

# Validate GGUF model cache is complete (pre-flight check)
MODEL_CACHE="$HOME/.cache/huggingface/hub/models--mradermacher--Holo1.5-7B-GGUF"
if ! validate_model_cache "$MODEL_CACHE"; then
    echo -e "${YELLOW}⚠ Holo 1.5-7B GGUF model not cached yet${NC}"
    echo ""
    echo -e "${BLUE}The model will download automatically on first request (~6 GB)${NC}"
    echo "This is normal for first-time setup with GGUF models."
    echo ""
    echo "If you want to pre-download the model, start the service and make a test request."
    echo ""
    # Don't exit - GGUF models download on first use
fi

cd packages/bytebot-holo

# Check if already running (verify it's actually Holo via PID file)
if [[ -f "../../logs/holo.pid" ]]; then
    PID=$(cat ../../logs/holo.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Holo 1.5-7B already running (PID: $PID)${NC}"
        echo ""
        echo "Service: http://localhost:9989"
        echo "To restart, first stop it:"
        echo -e "  ${BLUE}./scripts/stop-holo.sh${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠ Stale PID file found, cleaning up...${NC}"
        rm ../../logs/holo.pid
    fi
fi

# Also check port as a fallback (but warn it might not be Holo)
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port 9989 is in use by another process${NC}"
    echo ""
    echo "Check what's running:"
    echo -e "  ${BLUE}lsof -i :9989${NC}"
    echo ""
    echo "If it's not Holo, stop it first, then run this script again."
    exit 1
fi

# Activate environment and start
echo -e "${BLUE}Activating Python environment...${NC}"
if [[ -d "venv" ]]; then
    source venv/bin/activate
elif command -v conda &> /dev/null && conda env list | grep -q "holo"; then
    eval "$(conda shell.bash hook)"
    conda activate holo
else
    echo -e "${RED}✗ No Python environment found${NC}"
    exit 1
fi

echo -e "${BLUE}Starting Holo 1.5-7B service...${NC}"
export HOLO_DEVICE=mps
export HOLO_PORT=9989

# Start in background
nohup python -m src.server > ../../logs/holo.log 2>&1 &
HOLO_PID=$!

# Save PID for stopping later
mkdir -p ../../logs
echo $HOLO_PID > ../../logs/holo.pid

echo ""
echo -e "${GREEN}✓ Holo 1.5-7B started (PID: $HOLO_PID)${NC}"
echo ""
echo "Service: http://localhost:9989"
echo "Logs: logs/holo.log"
echo ""

# Model is validated by pre-flight check above, so it's always cached at this point
echo "Model cached: Loading from cache (~60 seconds)..."
echo ""

# Wait and check health
sleep 5
echo -ne "${BLUE}Checking health"
for i in {1..25}; do
    if curl -s http://localhost:9989/health >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        echo ""
        echo -e "${GREEN}================================================${NC}"
        echo -e "${GREEN}   Holo 1.5-7B GGUF Ready!${NC}"
        echo -e "${GREEN}================================================${NC}"
        echo ""
        echo "Model: mradermacher/Holo1.5-7B-GGUF (Q4_K_M quantization)"
        echo "Device: MPS (Apple Silicon GPU)"
        echo "Performance: ~1.5-2.5s per inference 🚀"
        echo ""
        echo "Now start the Docker stack:"
        echo -e "  ${BLUE}./scripts/start-stack.sh${NC}"
        echo ""
        echo "To stop Holo 1.5-7B:"
        echo -e "  ${BLUE}./scripts/stop-holo.sh${NC}"
        echo ""
        exit 0
    fi
    echo -ne "."
    sleep 1
done

echo -e " ${YELLOW}⚠${NC}"
echo ""
echo -e "${YELLOW}Service may still be loading (check logs/holo.log)${NC}"
echo ""
