#!/bin/bash

# GPU Support Diagnostic Script for Bytebot OmniParser
# Run this before starting Docker to verify GPU setup

set -e

echo "=========================================="
echo "Bytebot OmniParser GPU Support Check"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS="${GREEN}✓${NC}"
FAIL="${RED}✗${NC}"
WARN="${YELLOW}⚠${NC}"

# Track overall status
ALL_CHECKS_PASSED=true

echo "1. Checking Host GPU Hardware..."
if command -v nvidia-smi &> /dev/null; then
    echo -e "$PASS NVIDIA GPU detected on host"
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader | while read line; do
        echo "   $line"
    done
    echo ""
else
    echo -e "$FAIL nvidia-smi not found - No NVIDIA GPU or drivers not installed"
    echo "   Install NVIDIA drivers from: https://www.nvidia.com/download/index.aspx"
    ALL_CHECKS_PASSED=false
    echo ""
fi

echo "2. Checking Docker Installation..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "$PASS Docker installed: $DOCKER_VERSION"
else
    echo -e "$FAIL Docker not installed"
    echo "   Install from: https://docs.docker.com/get-docker/"
    ALL_CHECKS_PASSED=false
fi
echo ""

echo "3. Checking NVIDIA Container Toolkit..."
if command -v nvidia-container-cli &> /dev/null; then
    NVIDIA_CLI_VERSION=$(nvidia-container-cli --version | head -n1)
    echo -e "$PASS nvidia-container-toolkit installed: $NVIDIA_CLI_VERSION"
else
    echo -e "$FAIL nvidia-container-toolkit not installed"
    echo "   This is required for GPU access in Docker containers"
    echo ""
    echo "   Installation instructions:"
    echo "   1. Add NVIDIA Docker repository:"
    echo "      distribution=\$(. /etc/os-release;echo \$ID\$VERSION_ID)"
    echo "      curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -"
    echo "      curl -s -L https://nvidia.github.io/libnvidia-container/\$distribution/libnvidia-container.list | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list"
    echo ""
    echo "   2. Install toolkit:"
    echo "      sudo apt-get update"
    echo "      sudo apt-get install -y nvidia-container-toolkit"
    echo ""
    echo "   3. Restart Docker:"
    echo "      sudo systemctl restart docker"
    echo ""
    ALL_CHECKS_PASSED=false
fi
echo ""

echo "4. Checking Docker GPU Runtime..."
if docker info 2>/dev/null | grep -q "Runtimes.*nvidia"; then
    echo -e "$PASS NVIDIA runtime registered with Docker"
else
    echo -e "$WARN NVIDIA runtime not found in 'docker info'"
    echo "   Modern CDI mode may still work if nvidia-container-toolkit is installed"
    echo "   To enable legacy runtime, configure /etc/docker/daemon.json:"
    echo ""
    echo "   {"
    echo "     \"runtimes\": {"
    echo "       \"nvidia\": {"
    echo "         \"path\": \"nvidia-container-runtime\","
    echo "         \"runtimeArgs\": []"
    echo "       }"
    echo "     }"
    echo "   }"
    echo ""
    echo "   Then restart Docker: sudo systemctl restart docker"
    echo ""
fi

echo "5. Testing GPU Access in Docker..."
if command -v docker &> /dev/null && command -v nvidia-smi &> /dev/null; then
    echo "   Running test container with GPU access..."
    if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &> /tmp/gpu-test.log; then
        echo -e "$PASS GPU accessible in Docker container"
        echo "   Test output:"
        grep -A 3 "CUDA Version" /tmp/gpu-test.log | sed 's/^/   /'
    else
        echo -e "$FAIL GPU not accessible in Docker container"
        echo "   Error output:"
        cat /tmp/gpu-test.log | sed 's/^/   /'
        ALL_CHECKS_PASSED=false
    fi
    rm -f /tmp/gpu-test.log
else
    echo -e "$WARN Skipping Docker GPU test (prerequisites missing)"
fi
echo ""

echo "6. Checking CDI Support (optional, for modern setups)..."
if [ -d "/etc/cdi" ] || [ -d "/var/run/cdi" ]; then
    echo -e "$PASS CDI directory found - modern CDI support available"
    if [ -f "/etc/cdi/nvidia.yaml" ]; then
        echo "   CDI config: /etc/cdi/nvidia.yaml"
    fi
else
    echo -e "$WARN CDI not configured (optional)"
    echo "   CDI provides smoother GPU access on modern systems"
    echo "   Your system may use legacy runtime instead"
fi
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
if [ "$ALL_CHECKS_PASSED" = true ]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    echo ""
    echo "Your system is ready for GPU-accelerated OmniParser."
    echo "Start the stack with: ./scripts/start-stack.sh"
    echo ""
    echo "OmniParser will use CUDA GPU automatically."
else
    echo -e "${RED}✗ Some critical checks failed${NC}"
    echo ""
    echo "OmniParser will fall back to CPU mode (slower performance)."
    echo "To enable GPU acceleration, fix the issues above."
    echo ""
    echo "You can still start the stack with: ./scripts/start-stack.sh"
    echo "But expect ~8-15s per detection instead of ~0.6s with GPU."
fi
echo "=========================================="
