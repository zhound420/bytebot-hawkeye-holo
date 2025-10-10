#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
FULL_RESET=false
for arg in "$@"; do
    case $arg in
        --full-reset)
            FULL_RESET=true
            shift
            ;;
    esac
done

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Bytebot Hawkeye - Fresh Build${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

if [ "$FULL_RESET" = true ]; then
    echo -e "${RED}⚠️  FULL RESET MODE ENABLED${NC}"
    echo -e "${RED}All Docker volumes, images, and data will be removed!${NC}"
    echo ""
fi

# Detect platform with enhanced Windows/WSL support
ARCH=$(uname -m)
OS=$(uname -s)

# Detect if running on Windows WSL
IS_WSL=false
if grep -qEi "(Microsoft|WSL)" /proc/version 2>/dev/null; then
    IS_WSL=true
    OS="WSL"
fi

# Normalize OS name
case "$OS" in
    Linux*)
        if [ "$IS_WSL" = true ]; then
            PLATFORM="Windows (WSL)"
        else
            PLATFORM="Linux"
        fi
        ;;
    Darwin*)
        PLATFORM="macOS"
        ;;
    CYGWIN*|MINGW*|MSYS*)
        PLATFORM="Windows (Git Bash)"
        ;;
    *)
        PLATFORM="$OS"
        ;;
esac

echo -e "${BLUE}Platform: $PLATFORM ($ARCH)${NC}"
echo ""

# Stop any running services
echo -e "${BLUE}Step 1: Stopping existing services...${NC}"

# Determine cleanup level
REMOVE_VOLUMES=false
REMOVE_IMAGES=false
CLEAR_BUILD_CACHE=false

if [ "$FULL_RESET" = true ]; then
    REMOVE_VOLUMES=true
    REMOVE_IMAGES=true
    CLEAR_BUILD_CACHE=true
    echo -e "${YELLOW}Auto-cleanup: volumes, images, and build cache${NC}"
else
    # Interactive prompts
    echo ""
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   Cleanup Options (Select Carefully!)${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo ""

    # Prompt 1: Docker volumes (DESTRUCTIVE)
    echo -e "${RED}⚠️  Remove Docker volumes?${NC}"
    echo "   • PostgreSQL database (all tasks, messages, settings)"
    echo "   • Holo 1.5-7B model weights (~5.5GB)"
    echo "   • Windows container disk (~150GB if using Windows)"
    echo -e "${RED}   THIS WILL DELETE ALL YOUR DATA!${NC}"
    read -p "Remove volumes? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_VOLUMES=true
        echo -e "${YELLOW}✓ Will remove volumes${NC}"
    else
        echo -e "${GREEN}✓ Volumes will be preserved${NC}"
    fi
    echo ""

    # Prompt 2: Docker images (safe but slower)
    echo -e "${BLUE}Remove Docker images?${NC}"
    echo "   • bytebot-agent, bytebot-holo, bytebot-ui images"
    echo "   • Forces complete rebuild (slower but truly fresh)"
    echo "   • Does NOT remove base images (dockurr/windows, postgres)"
    read -p "Remove images? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_IMAGES=true
        echo -e "${YELLOW}✓ Will remove images${NC}"
    else
        echo -e "${GREEN}✓ Images will be reused${NC}"
    fi
    echo ""

    # Prompt 3: Build cache (safe but slower)
    echo -e "${BLUE}Clear Docker build cache?${NC}"
    echo "   • Clears all cached build layers"
    echo "   • Slower build but ensures fresh dependencies"
    read -p "Clear build cache? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        CLEAR_BUILD_CACHE=true
        echo -e "${YELLOW}✓ Will clear build cache${NC}"
    else
        echo -e "${GREEN}✓ Build cache will be preserved${NC}"
    fi
    echo ""
fi

# Execute cleanup
if [ -f "scripts/stop-stack.sh" ]; then
    if [ "$REMOVE_VOLUMES" = true ]; then
        ./scripts/stop-stack.sh --remove-volumes || true
    else
        ./scripts/stop-stack.sh || true
    fi
fi
echo ""

# Remove Docker images if requested
if [ "$REMOVE_IMAGES" = true ]; then
    echo -e "${BLUE}Removing Bytebot Docker images...${NC}"
    # Remove bytebot images but keep base images (postgres, dockurr/windows)
    docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^bytebot|^ghcr.io/bytebot" | xargs -r docker rmi -f || true
    echo -e "${GREEN}✓ Docker images removed${NC}"
    echo ""
fi

# Clean Docker build cache if requested
if [ "$CLEAR_BUILD_CACHE" = true ]; then
    echo -e "${BLUE}Pruning Docker build cache...${NC}"
    docker builder prune -f
    echo -e "${GREEN}✓ Build cache cleared${NC}"
    echo ""
fi

# Clean problematic node_modules (OpenCV build artifacts)
echo -e "${BLUE}Step 2: Cleaning node_modules...${NC}"
if [ -d "node_modules/@u4/opencv-build" ]; then
    echo "Removing OpenCV build artifacts..."
    rm -rf node_modules/@u4/opencv-build
    rm -rf node_modules/@u4/.opencv-build-*
fi
if [ -d "packages/bytebot-cv/node_modules/@u4/opencv-build" ]; then
    echo "Removing CV OpenCV build artifacts..."
    rm -rf packages/bytebot-cv/node_modules/@u4/opencv-build
    rm -rf packages/bytebot-cv/node_modules/@u4/.opencv-build-*
fi
echo -e "${GREEN}✓ Cleaned node_modules${NC}"
echo ""

# Build shared package first (required dependency)
echo -e "${BLUE}Step 3: Building shared package...${NC}"
cd packages/shared
npm install
npm run build
echo -e "${GREEN}✓ Shared package built${NC}"
cd ../..
echo ""

# Build bytebot-cv package (depends on shared)
echo -e "${BLUE}Step 4: Building bytebot-cv package...${NC}"
cd packages/bytebot-cv
# Clean local node_modules if npm install fails
if [ -d "node_modules" ]; then
    echo "Cleaning bytebot-cv node_modules for fresh install..."
    rm -rf node_modules
fi
npm install --no-save
npm run build
echo -e "${GREEN}✓ CV package built${NC}"
cd ../..
echo ""

# Build bytebotd package (depends on shared and bytebot-cv)
echo -e "${BLUE}Step 5: Building bytebotd package...${NC}"
cd packages/bytebotd
npm install
npm run build
echo -e "${GREEN}✓ Bytebotd package built${NC}"
cd ../..
echo ""

# Setup Holo 1.5-7B if needed
echo -e "${BLUE}Step 6: Setting up Holo 1.5-7B...${NC}"
if [ -f "scripts/setup-holo.sh" ]; then
    ./scripts/setup-holo.sh
else
    echo -e "${YELLOW}⚠ OmniParser setup script not found, skipping${NC}"
fi
echo ""

# Start OmniParser for Apple Silicon (native with MPS GPU)
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    echo -e "${BLUE}Step 7: Starting native Holo 1.5-7B (Apple Silicon with MPS GPU)...${NC}"
    if [ -f "scripts/start-holo.sh" ]; then
        ./scripts/start-holo.sh
        echo ""
        echo "Waiting for OmniParser to be ready..."
        sleep 3

        # Verify OmniParser is running
        if curl -s http://localhost:9989/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓ OmniParser running natively on port 9989${NC}"
        else
            echo -e "${YELLOW}⚠ OmniParser may not be ready yet${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ OmniParser start script not found${NC}"
    fi
    echo ""
else
    echo -e "${BLUE}Step 7: OmniParser will run in Docker container${NC}"
    if [[ "$PLATFORM" == "Windows (WSL)" ]] || [[ "$PLATFORM" == "Linux" ]]; then
        echo -e "${BLUE}(CUDA GPU acceleration if available)${NC}"
    fi
    echo ""
fi

# Build and start Docker stack with fresh build
echo -e "${BLUE}Step 8: Building Docker containers (this may take several minutes)...${NC}"
echo ""

cd docker

# Determine compose file
if [[ -f "docker-compose.proxy.yml" ]]; then
    COMPOSE_FILE="docker-compose.proxy.yml"
    echo -e "${BLUE}Using: Proxy Stack (with LiteLLM)${NC}"
else
    COMPOSE_FILE="docker-compose.yml"
    echo -e "${BLUE}Using: Standard Stack${NC}"
fi

# Build services - now unified across all platforms with x86_64 architecture
echo -e "${BLUE}Building services (forced x86_64 architecture for consistency)...${NC}"

if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    echo -e "${YELLOW}Note: Running via Rosetta 2 on Apple Silicon${NC}"
    echo -e "${BLUE}Building without OmniParser container (using native)...${NC}"
    # Build without OmniParser container (running natively with MPS)
    docker compose -f $COMPOSE_FILE build \
        bytebot-desktop \
        bytebot-agent \
        bytebot-ui \
        $([ "$COMPOSE_FILE" = "docker-compose.proxy.yml" ] && echo "bytebot-llm-proxy" || echo "")

    echo ""
    echo -e "${BLUE}Starting services...${NC}"
    docker compose -f $COMPOSE_FILE up -d --no-deps \
        bytebot-desktop \
        bytebot-agent \
        bytebot-ui \
        postgres \
        $([ "$COMPOSE_FILE" = "docker-compose.proxy.yml" ] && echo "bytebot-llm-proxy" || echo "")
else
    # Linux and Windows (WSL) - build everything including OmniParser
    echo -e "${BLUE}Building all services including OmniParser...${NC}"
    docker compose -f $COMPOSE_FILE up -d --build
fi

cd ..

# Wait for services
echo ""
echo -e "${BLUE}Waiting for services to start...${NC}"
sleep 8

# Check service health
echo ""
echo -e "${BLUE}Service Health Check:${NC}"

services=("bytebot-ui:9992" "bytebot-agent:9991" "bytebot-desktop:9990")
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    services+=("OmniParser:9989")
fi

all_healthy=true
for service_port in "${services[@]}"; do
    IFS=: read -r service port <<< "$service_port"
    if (exec 3<>/dev/tcp/localhost/"$port") 2>/dev/null; then
        exec 3>&-
        echo -e "  ${GREEN}✓${NC} $service (port $port)"
    else
        echo -e "  ${RED}✗${NC} $service (port $port) - check logs"
        all_healthy=false
    fi
done

echo ""
if $all_healthy; then
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Fresh Build Complete! 🚀${NC}"
    echo -e "${GREEN}================================================${NC}"
else
    echo -e "${YELLOW}================================================${NC}"
    echo -e "${YELLOW}   Build Complete (some services may need time)${NC}"
    echo -e "${YELLOW}================================================${NC}"
fi

echo ""
echo "Services:"
echo "  • UI:        http://localhost:9992"
echo "  • Agent:     http://localhost:9991"
echo "  • Desktop:   http://localhost:9990"
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    echo "  • OmniParser: http://localhost:9989 (native with MPS GPU)"
else
    echo "  • OmniParser: http://localhost:9989 (Docker, CUDA if available)"
fi

echo ""
echo -e "${BLUE}Platform Info:${NC}"
echo "  • Detected: $PLATFORM ($ARCH)"
echo "  • Docker:   x86_64 (linux/amd64) via docker-compose.override.yml"

echo ""
echo "View logs:"
echo -e "  ${BLUE}docker compose -f docker/$COMPOSE_FILE logs -f${NC}"
echo ""
echo "Test OmniParser:"
echo -e "  ${BLUE}curl http://localhost:9989/health${NC}"
echo ""
echo "Stop stack:"
echo -e "  ${BLUE}./scripts/stop-stack.sh${NC}"
echo ""
echo "For Windows 11 container:"
echo -e "  ${BLUE}./scripts/start-stack.sh --os windows${NC}"
echo "For macOS container:"
echo -e "  ${BLUE}./scripts/start-stack.sh --os macos${NC}"
echo ""
echo "For complete reset (removes all data):"
echo -e "  ${BLUE}./scripts/fresh-build.sh --full-reset${NC}"
echo ""
