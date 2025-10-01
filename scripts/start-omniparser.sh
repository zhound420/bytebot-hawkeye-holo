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
    echo "On x86_64 systems, OmniParser runs in Docker automatically."
    echo "Just run: ./scripts/start-stack.sh"
    exit 1
fi

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting OmniParser (Native with MPS GPU)${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if setup has been run
if [[ ! -d "packages/bytebot-omniparser/venv" ]] && [[ ! -d "packages/bytebot-omniparser/weights/icon_detect" ]]; then
    echo -e "${RED}✗ OmniParser not set up yet${NC}"
    echo ""
    echo "Run setup first:"
    echo -e "  ${BLUE}./scripts/setup-omniparser.sh${NC}"
    exit 1
fi

cd packages/bytebot-omniparser

# Check if already running
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ OmniParser already running on port 9989${NC}"
    echo ""
    echo "To restart, first stop it:"
    echo -e "  ${BLUE}./scripts/stop-omniparser.sh${NC}"
    exit 0
fi

# Activate environment and start
echo -e "${BLUE}Activating Python environment...${NC}"
if [[ -d "venv" ]]; then
    source venv/bin/activate
elif command -v conda &> /dev/null && conda env list | grep -q "omniparser"; then
    eval "$(conda shell.bash hook)"
    conda activate omniparser
else
    echo -e "${RED}✗ No Python environment found${NC}"
    exit 1
fi

echo -e "${BLUE}Starting OmniParser service...${NC}"
export OMNIPARSER_DEVICE=mps
export OMNIPARSER_PORT=9989

# Start in background
nohup python -m src.server > ../../logs/omniparser.log 2>&1 &
OMNIPARSER_PID=$!

# Save PID for stopping later
mkdir -p ../../logs
echo $OMNIPARSER_PID > ../../logs/omniparser.pid

echo ""
echo -e "${GREEN}✓ OmniParser started (PID: $OMNIPARSER_PID)${NC}"
echo ""
echo "Service: http://localhost:9989"
echo "Logs: logs/omniparser.log"
echo ""
echo "Wait ~30 seconds for models to load..."

# Wait and check health
sleep 5
echo -ne "${BLUE}Checking health"
for i in {1..25}; do
    if curl -s http://localhost:9989/health >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        echo ""
        echo -e "${GREEN}================================================${NC}"
        echo -e "${GREEN}   OmniParser Ready!${NC}"
        echo -e "${GREEN}================================================${NC}"
        echo ""
        echo "Device: MPS (Apple Silicon GPU)"
        echo "Performance: ~1-2s per frame 🚀"
        echo ""
        echo "Now start the Docker stack:"
        echo -e "  ${BLUE}./scripts/start-stack.sh${NC}"
        echo ""
        echo "To stop OmniParser:"
        echo -e "  ${BLUE}./scripts/stop-omniparser.sh${NC}"
        echo ""
        exit 0
    fi
    echo -ne "."
    sleep 1
done

echo -e " ${YELLOW}⚠${NC}"
echo ""
echo -e "${YELLOW}Service may still be loading (check logs/omniparser.log)${NC}"
echo ""
