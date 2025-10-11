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
TARGET_OS="linux"  # Default to Linux
USE_PREBAKED=false  # Use pre-baked Windows image

while [[ $# -gt 0 ]]; do
    case $1 in
        --full-reset)
            FULL_RESET=true
            shift
            ;;
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        --prebaked)
            USE_PREBAKED=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: $0 [--os linux|windows|macos] [--prebaked] [--full-reset]"
            exit 1
            ;;
    esac
done

# Validate TARGET_OS
if [[ "$TARGET_OS" != "linux" && "$TARGET_OS" != "windows" && "$TARGET_OS" != "macos" ]]; then
    echo -e "${RED}Invalid OS: $TARGET_OS${NC}"
    echo "Valid options: linux, windows, macos"
    exit 1
fi

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Bytebot Hawkeye - Fresh Build ($TARGET_OS)${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

if [ "$FULL_RESET" = true ]; then
    echo -e "${RED}⚠️  FULL RESET MODE ENABLED${NC}"
    echo -e "${RED}All Docker volumes, images, and data will be removed!${NC}"
    echo ""
fi

if [[ "$TARGET_OS" == "windows" ]] && [[ "$USE_PREBAKED" == "true" ]]; then
    echo -e "${BLUE}Target: Windows 11 (Pre-baked Image - 96% faster startup)${NC}"
    echo ""
elif [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${BLUE}Target: Windows 11 (Runtime Installation)${NC}"
    echo ""
elif [[ "$TARGET_OS" == "macos" ]]; then
    echo -e "${BLUE}Target: macOS Container${NC}"
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

# Interactive OS selection if not specified via flag
OS_SELECTED_INTERACTIVELY=false
if [[ "$TARGET_OS" == "linux" ]] && [[ "$#" -eq 0 || ! "$@" =~ "--os" ]]; then
    # Only show prompt if no --os flag was provided
    # (Check if we're running with default TARGET_OS and no flags were originally passed)
    if [[ ${TARGET_OS_FROM_FLAG:-} != "true" ]]; then
        echo ""
        echo -e "${BLUE}════════════════════════════════════════════════${NC}"
        echo -e "${BLUE}   Target OS Selection${NC}"
        echo -e "${BLUE}════════════════════════════════════════════════${NC}"
        echo ""
        echo "Which OS would you like to build for?"
        echo "  1) Linux (desktop container - default)"
        echo "  2) Windows 11 (requires KVM)"
        echo "  3) macOS (requires KVM, Apple hardware)"
        echo ""
        read -p "Select option [1-3] (default: 1): " -n 1 -r OS_CHOICE
        echo ""

        case $OS_CHOICE in
            2)
                TARGET_OS="windows"
                echo -e "${YELLOW}✓ Windows 11 selected${NC}"
                OS_SELECTED_INTERACTIVELY=true
                ;;
            3)
                TARGET_OS="macos"
                echo -e "${YELLOW}✓ macOS selected${NC}"
                OS_SELECTED_INTERACTIVELY=true
                ;;
            1|"")
                TARGET_OS="linux"
                echo -e "${GREEN}✓ Linux selected${NC}"
                OS_SELECTED_INTERACTIVELY=true
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to Linux${NC}"
                TARGET_OS="linux"
                OS_SELECTED_INTERACTIVELY=true
                ;;
        esac
        echo ""

        # If Windows selected, ask about pre-baked image
        if [[ "$TARGET_OS" == "windows" ]]; then
            echo -e "${BLUE}Use pre-baked Windows image?${NC}"
            echo "  • Pre-baked: 30-60 seconds startup (96% faster)"
            echo "  • Runtime:   8-15 minutes startup"
            read -p "Use pre-baked image? [Y/n] " -n 1 -r PREBAKED_CHOICE
            echo ""
            if [[ ! $PREBAKED_CHOICE =~ ^[Nn]$ ]]; then
                USE_PREBAKED=true
                echo -e "${GREEN}✓ Using pre-baked image${NC}"
            else
                echo -e "${YELLOW}✓ Using runtime installation${NC}"
            fi
            echo ""
        fi
    fi
fi

# Mark that TARGET_OS was set via flag (for future reference)
if [[ "$@" =~ "--os" ]]; then
    TARGET_OS_FROM_FLAG=true
fi

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
    if [[ "$TARGET_OS" == "windows" ]]; then
        echo -e "   ${YELLOW}• Windows container disk (~150GB) - REMOVES INSTALLED WINDOWS!${NC}"
        echo -e "   ${YELLOW}  Removing this forces full Windows reinstall (8-15 min)${NC}"
        echo -e "   ${YELLOW}  Keeping it allows fast boot of existing Windows (30-60s)${NC}"
    else
        echo "   • Windows container disk (~150GB if using Windows)"
    fi
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

# Capture baseline of existing containers before starting new ones
# This allows us to distinguish between orphaned containers (remove) and newly started ones (keep)
EXISTING_CONTAINERS=$(docker ps -a --format "{{.Names}}" 2>/dev/null || echo "")

# Execute cleanup
if [ -f "scripts/stop-stack.sh" ]; then
    if [ "$REMOVE_VOLUMES" = true ]; then
        ./scripts/stop-stack.sh --remove-volumes || true
    else
        ./scripts/stop-stack.sh || true
    fi
fi

# Smart cleanup: Only remove Windows containers that existed BEFORE this script run
# This prevents removing newly started containers while cleaning up orphans from previous sessions
if [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${BLUE}Cleaning up orphaned Windows containers (preserving new ones)...${NC}"

    WINDOWS_PORTS=(3389 8006 9990 8081)
    CLEANUP_COUNT=0

    for port in "${WINDOWS_PORTS[@]}"; do
        CONTAINER_NAME=$(docker ps -a --filter "publish=$port" --format "{{.Names}}" 2>/dev/null | head -n 1)

        if [ -n "$CONTAINER_NAME" ]; then
            # Only remove if it existed BEFORE this script run (orphaned container)
            if echo "$EXISTING_CONTAINERS" | grep -q "^${CONTAINER_NAME}$"; then
                echo "  Removing orphaned container: $CONTAINER_NAME (port $port)"
                docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
                ((CLEANUP_COUNT++))
            else
                echo "  Preserving newly started container: $CONTAINER_NAME"
            fi
        fi
    done

    if [ $CLEANUP_COUNT -eq 0 ]; then
        echo -e "${GREEN}✓ No orphaned containers found${NC}"
    else
        echo -e "${GREEN}✓ Cleaned up $CLEANUP_COUNT orphaned container(s)${NC}"
    fi
    echo ""
fi

# Windows volume intelligence: Detect and optionally remove existing Windows installation
# This gives users control over whether to reuse existing Windows (fast) or reinstall (slow but fresh)
if [[ "$TARGET_OS" == "windows" ]] && [[ "$REMOVE_VOLUMES" == "false" ]]; then
    # Check if windows_storage volume exists (named volumes from compose file)
    WINDOWS_VOLUME=$(docker volume ls --format "{{.Name}}" | grep -E "^bytebot_windows_storage$|^windows_storage$" | head -n 1)

    if [ -n "$WINDOWS_VOLUME" ]; then
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}   Existing Windows Installation Detected${NC}"
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
        echo ""
        echo "Found existing Windows 11 installation in Docker volume: $WINDOWS_VOLUME"
        echo ""
        echo "Options:"
        echo -e "  ${GREEN}• Keep (default):${NC} Boot existing Windows (30-60 seconds) ✅ FAST"
        echo -e "  ${YELLOW}• Remove:${NC}         Fresh Windows install (8-15 minutes) ⏱️  SLOW"
        echo ""
        read -p "Keep existing Windows installation? [Y/n] " -n 1 -r KEEP_WINDOWS
        echo ""
        echo ""

        if [[ $KEEP_WINDOWS =~ ^[Nn]$ ]]; then
            echo -e "${YELLOW}Removing Windows volume for fresh installation...${NC}"
            docker volume rm "$WINDOWS_VOLUME" 2>/dev/null || true
            echo -e "${GREEN}✓ Windows volume removed - will perform fresh install (8-15 min)${NC}"
        else
            echo -e "${GREEN}✓ Using existing Windows installation (30-60s boot)${NC}"
        fi
        echo ""
    fi

    # Clean up stale Windows installer artifacts if requested
    if [ -d "docker/windows-installer" ]; then
        INSTALLER_SIZE=$(du -sh docker/windows-installer 2>/dev/null | cut -f1 || echo "unknown")
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}   Windows Installer Artifacts Detected${NC}"
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
        echo ""
        echo "Found pre-built installer packages: $INSTALLER_SIZE"
        echo ""
        echo "These ZIPs contain compiled bytebotd packages and may become stale if:"
        echo "  • Source code in packages/bytebotd has changed"
        echo "  • Dependencies in package.json were updated"
        echo "  • You want to ensure truly fresh Windows installation"
        echo ""
        echo -e "${BLUE}Options:${NC}"
        echo -e "  ${GREEN}• Keep (default):${NC} Reuse existing installer (faster, may be stale)"
        echo -e "  ${YELLOW}• Remove:${NC}         Force rebuild installer (slower, always fresh)"
        echo ""
        read -p "Keep existing installer artifacts? [Y/n] " -n 1 -r KEEP_INSTALLER
        echo ""
        echo ""

        if [[ $KEEP_INSTALLER =~ ^[Nn]$ ]]; then
            echo -e "${YELLOW}Removing Windows installer artifacts...${NC}"
            rm -rf docker/windows-installer
            echo -e "${GREEN}✓ Installer artifacts removed (will rebuild on next run)${NC}"
        else
            echo -e "${GREEN}✓ Using existing installer artifacts${NC}"
        fi
        echo ""
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

# Windows-specific preparation
if [[ "$TARGET_OS" == "windows" ]]; then
    if [[ "$USE_PREBAKED" == "true" ]]; then
        echo -e "${BLUE}Step 1.5: Preparing Windows pre-baked image...${NC}"

        # Check if pre-baked image exists
        if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "bytebot-windows-prebaked:latest"; then
            echo -e "${YELLOW}Pre-baked image not found${NC}"
            echo ""
            echo "Building pre-baked image now..."
            echo ""

            # Build pre-baked image
            bash "./scripts/build-windows-prebaked-image.sh"

            if [ $? -ne 0 ]; then
                echo -e "${RED}✗ Failed to build pre-baked image${NC}"
                echo ""
                echo "Fallback to runtime installation:"
                echo -e "  ${BLUE}./scripts/fresh-build.sh --os windows${NC}"
                exit 1
            fi
        else
            echo -e "${GREEN}✓ Pre-baked image found${NC}"
        fi

        echo -e "${BLUE}Startup time: ~30-60 seconds (vs 8-15 minutes with runtime installation)${NC}"
        echo ""

    else
        echo -e "${BLUE}Step 1.5: Preparing Windows container artifacts (runtime installation)...${NC}"

        # Check if Windows installer package exists
        if [[ -f "docker/windows-installer/bytebotd-windows-installer.zip" ]]; then
            INSTALLER_SIZE=$(du -sh "docker/windows-installer/bytebotd-windows-installer.zip" | cut -f1)
            echo -e "${YELLOW}Windows installer package already exists (${INSTALLER_SIZE})${NC}"
            echo -e "${BLUE}Using existing installer from previous build${NC}"
            echo -e "${BLUE}To force rebuild: rm -rf docker/windows-installer${NC}"
        else
            echo -e "${BLUE}Building Windows installer package...${NC}"
            echo ""

            # Run the installer build script
            if [[ -f "scripts/build-windows-installer.sh" ]]; then
                bash "./scripts/build-windows-installer.sh"
            else
                echo -e "${RED}✗ Windows installer build script not found${NC}"
                echo ""
                echo "Expected: scripts/build-windows-installer.sh"
                exit 1
            fi
        fi

        echo -e "${BLUE}Installer will be available as \\\\host.lan\\Data\\bytebotd-windows-installer.zip in Windows container${NC}"
        echo ""
    fi
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

# Determine compose file based on TARGET_OS
if [[ "$TARGET_OS" == "windows" ]]; then
    if [[ "$USE_PREBAKED" == "true" ]]; then
        COMPOSE_FILE="docker-compose.windows-prebaked.yml"
        echo -e "${BLUE}Using: Windows Stack (Pre-baked Image)${NC}"
        DESKTOP_SERVICE="bytebot-windows"
    else
        COMPOSE_FILE="docker-compose.windows.yml"
        echo -e "${BLUE}Using: Windows Stack (Runtime Installation)${NC}"
        DESKTOP_SERVICE="bytebot-windows"
    fi
elif [[ "$TARGET_OS" == "macos" ]]; then
    COMPOSE_FILE="docker-compose.macos.yml"
    echo -e "${BLUE}Using: macOS Stack${NC}"
    DESKTOP_SERVICE="bytebot-macos"
else
    # Linux - check for proxy vs standard
    if [[ -f "docker-compose.proxy.yml" ]]; then
        COMPOSE_FILE="docker-compose.proxy.yml"
        echo -e "${BLUE}Using: Proxy Stack (with LiteLLM)${NC}"
    else
        COMPOSE_FILE="docker-compose.yml"
        echo -e "${BLUE}Using: Standard Stack${NC}"
    fi
    DESKTOP_SERVICE="bytebot-desktop"
fi

# Build services
echo ""

# Determine service list based on compose file
STACK_SERVICES=($DESKTOP_SERVICE bytebot-agent bytebot-ui postgres)
if [[ "$COMPOSE_FILE" == *"proxy"* ]]; then
    STACK_SERVICES+=(bytebot-llm-proxy)
fi

# Check if we should include Holo service (not for native Apple Silicon setup)
INCLUDE_HOLO=true
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]] && [[ "$TARGET_OS" == "linux" ]]; then
    INCLUDE_HOLO=false
fi

if [[ "$INCLUDE_HOLO" == "false" ]]; then
    echo -e "${YELLOW}Note: Running via Rosetta 2 on Apple Silicon${NC}"
    echo -e "${BLUE}Building without Holo container (using native with --no-cache)...${NC}"
    echo -e "${YELLOW}This ensures a truly fresh build but may take longer${NC}"
    # Build without Holo container (running natively with MPS)
    docker compose -f $COMPOSE_FILE build --no-cache "${STACK_SERVICES[@]}"

    echo ""
    echo -e "${BLUE}Starting services...${NC}"
    docker compose -f $COMPOSE_FILE up -d --no-deps "${STACK_SERVICES[@]}"
else
    # Standard build - includes all services
    echo -e "${BLUE}Building all services with --no-cache (truly fresh, may take longer)...${NC}"
    docker compose -f $COMPOSE_FILE build --no-cache
    echo ""

    # Verify Windows ports are available before starting (final safety check)
    if [[ "$TARGET_OS" == "windows" ]]; then
        echo -e "${BLUE}Verifying Windows ports are available...${NC}"

        PORTS_IN_USE=()
        for port in 3389 8006 9990 8081; do
            if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                PORTS_IN_USE+=($port)
            fi
        done

        if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
            echo -e "${RED}ERROR: Ports already in use: ${PORTS_IN_USE[@]}${NC}"
            echo ""
            echo "Run cleanup manually:"
            echo -e "  ${BLUE}./scripts/stop-stack.sh${NC}"
            echo ""
            echo "Or force remove containers:"
            for port in "${PORTS_IN_USE[@]}"; do
                CONTAINER=$(docker ps -a --filter "publish=$port" --format "{{.Names}}" 2>/dev/null | head -n 1)
                if [ -n "$CONTAINER" ]; then
                    echo -e "  ${BLUE}docker rm -f $CONTAINER${NC}"
                fi
            done
            exit 1
        fi

        echo -e "${GREEN}✓ All ports available${NC}"
        echo ""
    fi

    echo -e "${BLUE}Starting services...${NC}"
    docker compose -f $COMPOSE_FILE up -d
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

# Windows-specific help
if [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${BLUE}Windows Container Notes:${NC}"
    echo "  • First run: 8-15 min Windows install (one-time)"
    echo "  • Subsequent runs: 30-60s boot (reuses existing Windows)"
    echo "  • For fresh install: Remove volumes when prompted"
    echo "  • Web viewer: http://localhost:8006 (monitor Windows desktop)"
    echo "  • RDP access: localhost:3389"
    echo ""
fi

echo -e "${BLUE}Fresh Build Examples:${NC}"
echo "  • Interactive (prompts for OS):"
echo -e "    ${BLUE}./scripts/fresh-build.sh${NC}"
echo ""
echo "  • Linux (default):"
echo -e "    ${BLUE}./scripts/fresh-build.sh --os linux${NC}"
echo ""
echo "  • Windows 11 (runtime installation):"
echo -e "    ${BLUE}./scripts/fresh-build.sh --os windows${NC}"
echo ""
echo "  • Windows 11 (pre-baked - 96% faster):"
echo -e "    ${BLUE}./scripts/fresh-build.sh --os windows --prebaked${NC}"
echo ""
echo "  • macOS:"
echo -e "    ${BLUE}./scripts/fresh-build.sh --os macos${NC}"
echo ""
echo "  • Full reset (removes all data):"
echo -e "    ${BLUE}./scripts/fresh-build.sh --full-reset${NC}"
echo ""
echo "  • Windows + full reset:"
echo -e "    ${BLUE}./scripts/fresh-build.sh --os windows --prebaked --full-reset${NC}"
echo ""
