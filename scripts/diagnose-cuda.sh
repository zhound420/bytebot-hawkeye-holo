#!/bin/bash
# CUDA GPU Diagnostics for OmniParser Container
# Run this on your x86_64/NVIDIA system to diagnose GPU issues

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Bytebot CUDA GPU Diagnostics${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check platform
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]] && [[ "$ARCH" != "amd64" ]]; then
    echo -e "${RED}✗ This script is for x86_64 systems only${NC}"
    echo "  Detected: $ARCH"
    exit 1
fi

echo -e "${GREEN}✓ Platform: x86_64${NC}"
echo ""

# Check nvidia-smi
echo -e "${BLUE}1. Checking NVIDIA Driver...${NC}"
if command -v nvidia-smi &> /dev/null; then
    echo -e "${GREEN}✓ nvidia-smi found${NC}"
    nvidia-smi --query-gpu=name,driver_version,cuda_version --format=csv,noheader
    CUDA_VERSION=$(nvidia-smi --query-gpu=cuda_version --format=csv,noheader | head -1)
    echo "  CUDA Version: $CUDA_VERSION"
else
    echo -e "${RED}✗ nvidia-smi not found${NC}"
    echo "  Install NVIDIA drivers first"
    exit 1
fi
echo ""

# Check nvidia-container-toolkit
echo -e "${BLUE}2. Checking nvidia-container-toolkit...${NC}"
if command -v nvidia-ctk &> /dev/null; then
    echo -e "${GREEN}✓ nvidia-container-toolkit installed${NC}"
    nvidia-ctk --version
elif command -v nvidia-docker &> /dev/null; then
    echo -e "${GREEN}✓ nvidia-docker installed${NC}"
else
    echo -e "${RED}✗ nvidia-container-toolkit NOT installed${NC}"
    echo ""
    echo "Install with:"
    echo -e "${BLUE}distribution=\$(. /etc/os-release;echo \$ID\$VERSION_ID)${NC}"
    echo -e "${BLUE}curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -${NC}"
    echo -e "${BLUE}curl -s -L https://nvidia.github.io/nvidia-docker/\$distribution/nvidia-docker.list | \\${NC}"
    echo -e "${BLUE}  sudo tee /etc/apt/sources.list.d/nvidia-docker.list${NC}"
    echo -e "${BLUE}sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit${NC}"
    echo -e "${BLUE}sudo systemctl restart docker${NC}"
    exit 1
fi
echo ""

# Test Docker GPU access
echo -e "${BLUE}3. Testing Docker GPU Access...${NC}"
if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &>/dev/null; then
    echo -e "${GREEN}✓ Docker can access GPU${NC}"
    docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi --query-gpu=name --format=csv,noheader
else
    echo -e "${RED}✗ Docker cannot access GPU${NC}"
    echo ""
    echo "Check:"
    echo "1. Docker daemon.json includes nvidia runtime"
    echo "2. Docker restarted after toolkit install: sudo systemctl restart docker"
    exit 1
fi
echo ""

# Check OmniParser container status
echo -e "${BLUE}4. Checking OmniParser Container...${NC}"
if docker ps -a | grep -q bytebot-omniparser; then
    STATUS=$(docker inspect bytebot-omniparser --format='{{.State.Status}}')
    HEALTH=$(docker inspect bytebot-omniparser --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")

    echo "  Container Status: $STATUS"
    echo "  Health Status: $HEALTH"

    if [[ "$STATUS" == "running" ]]; then
        echo ""
        echo -e "${BLUE}Checking OmniParser GPU detection...${NC}"
        echo ""
        docker logs bytebot-omniparser 2>&1 | grep -A 15 "GPU Diagnostics" || echo "  (GPU diagnostics not found - may need rebuild)"

        echo ""
        echo -e "${BLUE}Running GPU verification script...${NC}"
        if docker exec bytebot-omniparser python /app/scripts/verify-gpu.py 2>/dev/null; then
            echo -e "${GREEN}✓ GPU verification passed${NC}"
        else
            echo -e "${RED}✗ GPU verification failed${NC}"
            echo ""
            echo "This means PyTorch cannot detect CUDA in the container."
            echo "Most common cause: CUDA version mismatch"
            echo ""
            echo "Solution: Rebuild with CUDA 12.1 support"
        fi
    else
        echo -e "${YELLOW}⚠ Container not running${NC}"
        echo ""
        echo "Check logs:"
        echo -e "  ${BLUE}docker logs bytebot-omniparser${NC}"
    fi
else
    echo -e "${RED}✗ OmniParser container not found${NC}"
    echo ""
    echo "Start it with:"
    echo -e "  ${BLUE}./scripts/start-stack.sh${NC}"
fi
echo ""

# Summary and recommendations
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Summary & Recommendations${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

if docker ps | grep -q bytebot-omniparser; then
    if docker exec bytebot-omniparser python /app/scripts/verify-gpu.py &>/dev/null; then
        echo -e "${GREEN}✓ GPU acceleration working correctly!${NC}"
        echo ""
        echo "Performance: ~0.6s per frame"
    else
        echo -e "${YELLOW}⚠ GPU detected on host but not in container${NC}"
        echo ""
        echo "Rebuild OmniParser with CUDA 12.1:"
        echo -e "  ${BLUE}cd docker${NC}"
        echo -e "  ${BLUE}docker compose down bytebot-omniparser${NC}"
        echo -e "  ${BLUE}docker compose build --no-cache bytebot-omniparser${NC}"
        echo -e "  ${BLUE}docker compose up -d${NC}"
        echo ""
        echo "Then verify:"
        echo -e "  ${BLUE}./scripts/diagnose-cuda.sh${NC}"
    fi
else
    echo -e "${YELLOW}⚠ OmniParser container not running${NC}"
    echo ""
    echo "Start the stack:"
    echo -e "  ${BLUE}./scripts/start-stack.sh${NC}"
fi
echo ""
