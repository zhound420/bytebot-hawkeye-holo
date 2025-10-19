#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions for waiting on container health and port availability
wait_for_container_health() {
    local container="$1"
    local timeout="${2:-360}"
    local interval="${3:-5}"

    if ! docker ps -a --format '{{.Names}}' | grep -qx "$container" 2>/dev/null; then
        echo -e "${YELLOW}Skipping health wait for ${container} (container not running)${NC}"
        return 0
    fi

    local waited=0
    echo -ne "${BLUE}Waiting for ${container} health${NC}"
    while (( waited < timeout )); do
        local status
        status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "")

        case "$status" in
            healthy)
                echo -e " ${GREEN}✓${NC}"
                return 0
                ;;
            unhealthy)
                echo -e " ${RED}✗${NC} (reported unhealthy)"
                docker logs "$container" --tail 40 || true
                return 1
                ;;
            "")
                # container not ready yet
                ;;
            *)
                # still starting
                ;;
        esac

        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    docker logs "$container" --tail 40 || true
    return 1
}

wait_for_port() {
    local label="$1"
    local port="$2"
    local host="${3:-localhost}"
    local timeout="${4:-300}"
    local interval="${5:-5}"

    local waited=0
    echo -ne "${BLUE}Waiting for ${label} (port ${port})${NC}"
    while (( waited < timeout )); do
        if (exec 3<>/dev/tcp/"$host"/"$port") 2>/dev/null; then
            exec 3>&-
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    return 1
}

wait_for_http() {
    local url="$1"
    local label="$2"
    local timeout="${3:-180}"
    local interval="${4:-5}"

    local waited=0
    echo -ne "${BLUE}Waiting for ${label}${NC}"
    while (( waited < timeout )); do
        if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    return 1
}

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

# LMStudio configuration prompt (for all OS types)
echo ""
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   LMStudio Local Models (Optional)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo ""
echo "Would you like to configure LMStudio for local models?"
echo "  • Runs models locally (FREE, no API costs)"
echo "  • Requires LMStudio server running on network"
echo "  • Models appear in UI under 'Local Models'"
echo ""
read -p "Configure LMStudio? [y/N] " -n 1 -r LMSTUDIO_CHOICE
echo ""
echo ""

if [[ $LMSTUDIO_CHOICE =~ ^[Yy]$ ]]; then
    # Get script directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [[ -f "$SCRIPT_DIR/setup-lmstudio.sh" ]]; then
        bash "$SCRIPT_DIR/setup-lmstudio.sh"
        if [ $? -ne 0 ]; then
            echo -e "${YELLOW}⚠ LMStudio setup failed or was cancelled${NC}"
            echo -e "${YELLOW}You can run it later: ./scripts/setup-lmstudio.sh${NC}"
            echo ""
        fi
    else
        echo -e "${RED}✗ LMStudio setup script not found${NC}"
        echo "Expected: $SCRIPT_DIR/setup-lmstudio.sh"
        echo ""
    fi
else
    echo -e "${YELLOW}✓ Skipping LMStudio configuration${NC}"
    echo "To configure later: ${CYAN}./scripts/setup-lmstudio.sh${NC}"
    echo ""
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

# Windows ISO cache detection and management (supports multiple variants)
if [[ "$TARGET_OS" == "windows" ]]; then
    ISO_CACHE_DIR="docker/iso-cache"

    # Detect ALL cached ISOs (both Tiny11 and Nano11)
    TINY11_CACHED=false
    NANO11_CACHED=false
    TINY11_SIZE=""
    NANO11_SIZE=""

    if [ -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso" ]; then
        TINY11_CACHED=true
        TINY11_SIZE=$(du -sh "$ISO_CACHE_DIR/tiny11-2311-x64.iso" | cut -f1)
    fi

    if [ -f "$ISO_CACHE_DIR/nano11-25h2.iso" ]; then
        NANO11_CACHED=true
        NANO11_SIZE=$(du -sh "$ISO_CACHE_DIR/nano11-25h2.iso" | cut -f1)
    fi

    # Show interactive variant selection menu
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Windows ISO Variant Selection${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Which Windows ISO variant would you like to use?"
    echo ""

    # Build menu options dynamically based on what's cached
    if [[ "$TINY11_CACHED" == "true" ]] && [[ "$NANO11_CACHED" == "true" ]]; then
        # Both cached - offer both, redownload, or skip
        echo -e "${GREEN}1) Tiny11 2311 (${TINY11_SIZE} cached)${NC}"
        echo "   ✅ Serviceable and updateable"
        echo "   ✅ Windows Defender, Windows Update, Audio"
        echo "   ✅ Suitable for production/daily use"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (${NANO11_SIZE} cached)${NC}"
        echo "   ⚠️  Minimal footprint, testing/VMs only"
        echo "   ⚠️  NOT serviceable, no Windows Update, no Audio"
        echo ""
        echo -e "${BLUE}3) Redownload/replace existing ISO${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                echo -e "${YELLOW}✓ Using cached Nano11 25H2 (minimal variant)${NC}"
                ;;
            3)
                echo -e "${YELLOW}Choose variant to redownload:${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh
                    # Re-detect which ISO was downloaded
                    if [ -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso" ]; then
                        ISO_FILENAME="tiny11-2311-x64.iso"
                    elif [ -f "$ISO_CACHE_DIR/nano11-25h2.iso" ]; then
                        ISO_FILENAME="nano11-25h2.iso"
                    fi
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                echo -e "${GREEN}✓ Using cached Tiny11 2311 (recommended)${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to Tiny11${NC}"
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    elif [[ "$TINY11_CACHED" == "true" ]]; then
        # Only Tiny11 cached - offer Tiny11, download Nano11, redownload, or skip
        echo -e "${GREEN}1) Tiny11 2311 (${TINY11_SIZE} cached)${NC}"
        echo "   ✅ Serviceable and updateable"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (download ~2.3GB)${NC}"
        echo "   ⚠️  Minimal variant, testing only"
        echo ""
        echo -e "${BLUE}3) Redownload Tiny11${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Nano11 25H2...${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}Redownloading Tiny11...${NC}"
                rm -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                echo -e "${GREEN}✓ Using cached Tiny11 2311${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to cached Tiny11${NC}"
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    elif [[ "$NANO11_CACHED" == "true" ]]; then
        # Only Nano11 cached - offer Nano11, download Tiny11, redownload, or skip
        echo -e "${YELLOW}1) Nano11 25H2 (${NANO11_SIZE} cached)${NC}"
        echo "   ⚠️  Minimal variant, testing only"
        echo ""
        echo -e "${GREEN}2) Tiny11 2311 (download ~3.5GB)${NC}"
        echo "   ✅ Recommended for general use"
        echo ""
        echo -e "${BLUE}3) Redownload Nano11${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Tiny11 2311...${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}Redownloading Nano11...${NC}"
                rm -f "$ISO_CACHE_DIR/nano11-25h2.iso"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                echo -e "${YELLOW}✓ Using cached Nano11 25H2${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to cached Nano11${NC}"
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    else
        # No ISOs cached - offer download or skip
        echo -e "${GREEN}1) Tiny11 2311 (download ~3.5GB)${NC}"
        echo "   ✅ Recommended for general use"
        echo "   ✅ Serviceable, updateable, production-ready"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (download ~2.3GB)${NC}"
        echo "   ⚠️  Minimal variant, testing/VMs only"
        echo "   ⚠️  NOT serviceable, no Windows Update"
        echo ""
        echo -e "${BLUE}3) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-3] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Nano11 25H2...${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}✓ Skipping ISO download - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                echo -e "${BLUE}Downloading Tiny11 2311...${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, downloading Tiny11 (recommended)${NC}"
                if [ -f "scripts/download-windows-iso.sh" ]; then
                    ./scripts/download-windows-iso.sh --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
        esac
    fi
    echo ""
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

            # Build pre-baked image (skip test to prevent test-bytebot-windows creation)
            bash "./scripts/build-windows-prebaked-image.sh" --skip-test

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
echo -e "${BLUE}Step 6: Setting up Holo 1.5-7B (transformers backend)...${NC}"
if [ -f "scripts/setup-holo.sh" ]; then
    ./scripts/setup-holo.sh
else
    echo -e "${YELLOW}⚠ Holo 1.5-7B setup script not found, skipping${NC}"
fi
echo ""

# Pre-download Holo 1.5-7B model for Apple Silicon (better UX)
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    MODEL_CACHE="$HOME/.cache/huggingface/hub/models--Hcompany--Holo1.5-7B"

    # Only pre-download if model not already cached
    if [[ ! -d "$MODEL_CACHE" ]] || [[ $(find "$MODEL_CACHE" -type f \( -name "*.bin" -o -name "*.safetensors" \) 2>/dev/null | wc -l) -lt 1 ]]; then
        echo -e "${BLUE}Step 6.5: Pre-downloading Holo 1.5-7B model (~14GB)...${NC}"
        echo "  This improves first-run experience (vs blocking on first API call)"
        echo ""

        cd packages/bytebot-holo

        if [[ -d "venv" ]]; then
            source venv/bin/activate

            python3 << 'PYEOF'
import sys
print("Downloading Holo 1.5-7B transformers model (~14GB)...")
print("This may take 10-20 minutes depending on internet speed...")
print("")

try:
    from transformers import AutoProcessor, AutoModelForImageTextToText

    print("→ Downloading processor...")
    AutoProcessor.from_pretrained('Hcompany/Holo1.5-7B')
    print("✓ Processor downloaded")

    print("→ Downloading model (this is the large part)...")
    AutoModelForImageTextToText.from_pretrained('Hcompany/Holo1.5-7B', torch_dtype='auto')
    print("✓ Model downloaded and cached")
    print("")
    print("Model cache location: ~/.cache/huggingface/hub/models--Hcompany--Holo1.5-7B")

except Exception as e:
    print(f"✗ Download failed: {e}", file=sys.stderr)
    print("Model will be downloaded on first API request instead", file=sys.stderr)
    sys.exit(1)
PYEOF

            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✓ Holo 1.5-7B model pre-downloaded${NC}"
            else
                echo -e "${YELLOW}⚠ Pre-download failed, will download on first use${NC}"
            fi

            deactivate
        else
            echo -e "${YELLOW}⚠ venv not found, skipping pre-download${NC}"
        fi

        cd ../..
        echo ""
    else
        echo -e "${GREEN}✓ Holo 1.5-7B model already cached (skipping download)${NC}"
        echo ""
    fi
fi

# Start Holo 1.5-7B for Apple Silicon (native with MPS GPU)
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    echo -e "${BLUE}Step 7: Starting native Holo 1.5-7B (Apple Silicon with MPS GPU)...${NC}"
    if [ -f "scripts/start-holo.sh" ]; then
        ./scripts/start-holo.sh
        echo ""
        echo "Waiting for Holo 1.5-7B to be ready..."
        sleep 3

        # Verify Holo 1.5-7B is running
        if curl -s http://localhost:9989/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Holo 1.5-7B running natively on port 9989${NC}"
        else
            echo -e "${YELLOW}⚠ Holo 1.5-7B may not be ready yet${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Holo 1.5-7B start script not found${NC}"
    fi
    echo ""
else
    echo -e "${BLUE}Step 7: Holo 1.5-7B will run in Docker container${NC}"
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

# Enable ISO cache mount if requested (Windows only)
if [[ "$TARGET_OS" == "windows" ]] && [[ "${USE_CACHED_ISO:-false}" == "true" ]] && [[ -n "${ISO_FILENAME:-}" ]]; then
    echo -e "${BLUE}Enabling cached Windows ISO mount ($ISO_FILENAME)...${NC}"
    # Uncomment and update the ISO mount line in the compose file with actual filename
    sed -i "s|^      # - \./iso-cache/.*\.iso:/custom.iso:ro|      - ./iso-cache/$ISO_FILENAME:/custom.iso:ro|" "$COMPOSE_FILE"
    echo -e "${GREEN}✓ ISO cache enabled (saves 5-10 min download)${NC}"
    echo ""
fi

# Build services
echo ""

# Determine service list based on compose file
# Proxy is now always required for Hawkeye framework
STACK_SERVICES=($DESKTOP_SERVICE bytebot-agent bytebot-ui postgres bytebot-llm-proxy)

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
    # Optimize Windows builds: start Windows early to parallelize installation with remaining builds
    if [[ "$TARGET_OS" == "windows" ]]; then
        echo -e "${BLUE}Building Holo first (Windows dependency)...${NC}"
        docker compose -f $COMPOSE_FILE build --no-cache bytebot-holo
        echo ""

        # Pre-startup cleanup: Remove any Windows containers still holding ports
        # This must run BEFORE starting new containers to avoid network endpoint conflicts
        echo -e "${BLUE}Pre-startup cleanup (removing lingering containers)...${NC}"

        # Step 1: Check for and remove bytebot-windows container by NAME
        # (Port filters don't catch "Created" state containers, so check by name first)
        if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-windows" 2>/dev/null; then
            echo -e "${YELLOW}Existing bytebot-windows container found - removing...${NC}"
            docker compose -f $COMPOSE_FILE down bytebot-windows 2>/dev/null || true
            docker rm -f bytebot-windows 2>/dev/null || true
            echo -e "${GREEN}✓ Removed bytebot-windows container${NC}"
        fi

        # Step 2: Port-based cleanup (catches other orphaned containers)
        WINDOWS_PORTS=(3389 8006 9990 8081)
        FINAL_CLEANUP_COUNT=0
        CONTAINERS_TO_REMOVE=()

        # First pass: Identify all containers holding Windows ports
        for port in "${WINDOWS_PORTS[@]}"; do
            CONTAINER_NAME=$(docker ps -a --filter "publish=$port" --format "{{.Names}}" 2>/dev/null | head -n 1)
            if [ -n "$CONTAINER_NAME" ]; then
                # Check if this container is not the one we're about to start
                if [[ "$CONTAINER_NAME" != "bytebot-windows" ]]; then
                    CONTAINERS_TO_REMOVE+=("$CONTAINER_NAME:$port")
                fi
            fi
        done

        # Second pass: Remove containers (deduplicated)
        if [ ${#CONTAINERS_TO_REMOVE[@]} -gt 0 ]; then
            echo ""
            echo -e "${YELLOW}Found containers holding Windows ports:${NC}"
            UNIQUE_CONTAINERS=()
            for entry in "${CONTAINERS_TO_REMOVE[@]}"; do
                IFS=: read -r container_name port <<< "$entry"
                # Add to unique list if not already present
                if [[ ! " ${UNIQUE_CONTAINERS[@]} " =~ " ${container_name} " ]]; then
                    UNIQUE_CONTAINERS+=("$container_name")
                    echo "  • $container_name (port $port)"
                fi
            done

            echo ""
            echo -e "${YELLOW}Removing orphaned containers...${NC}"
            for container in "${UNIQUE_CONTAINERS[@]}"; do
                echo "  Removing: $container"
                docker rm -f "$container" 2>/dev/null || true
                ((FINAL_CLEANUP_COUNT++))
            done
            echo -e "${GREEN}✓ Cleaned up $FINAL_CLEANUP_COUNT container(s)${NC}"
            echo ""
        fi

        # Verify ports are now available using Docker's port filter (not lsof)
        echo -e "${BLUE}Verifying Windows ports are available...${NC}"
        PORTS_IN_USE=()
        CONFLICTING_CONTAINERS=()

        for port in "${WINDOWS_PORTS[@]}"; do
            CONTAINER=$(docker ps -a --filter "publish=$port" --format "{{.Names}}" 2>/dev/null | head -n 1)
            if [ -n "$CONTAINER" ] && [[ "$CONTAINER" != "bytebot-windows" ]]; then
                PORTS_IN_USE+=($port)
                CONFLICTING_CONTAINERS+=("$CONTAINER")
            fi
        done

        if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
            echo -e "${RED}✗ ERROR: Ports still in use after cleanup!${NC}"
            echo ""
            echo -e "${YELLOW}Conflicting containers:${NC}"
            printf '%s\n' "${CONFLICTING_CONTAINERS[@]}" | sort -u | while read container; do
                echo "  • $container"
            done
            echo ""
            echo -e "${YELLOW}Manual fix required:${NC}"
            echo "  1. Stop all containers:"
            echo -e "     ${BLUE}./scripts/stop-stack.sh${NC}"
            echo ""
            echo "  2. Force remove specific containers:"
            printf '%s\n' "${CONFLICTING_CONTAINERS[@]}" | sort -u | while read container; do
                echo -e "     ${BLUE}docker rm -f $container${NC}"
            done
            echo ""
            echo "  3. Re-run this script"
            exit 1
        fi

        echo -e "${GREEN}✓ All Windows ports available${NC}"
        echo ""

        echo -e "${BLUE}Starting Holo + Windows containers early...${NC}"
        docker compose -f $COMPOSE_FILE up -d --no-deps bytebot-holo bytebot-windows

        # Wait for Holo health before continuing (allows model download in parallel with builds)
        echo ""
        wait_for_container_health "bytebot-holo" 480 5 || {
            echo -e "${YELLOW}Warning: Holo health check timed out, continuing anyway${NC}"
        }
        echo ""

        if [[ "$USE_PREBAKED" == "true" ]]; then
            echo -e "${YELLOW}Windows will boot (~30-60s) while remaining services build${NC}"
        else
            echo -e "${YELLOW}Windows will install (~8-15 min) while remaining services build${NC}"
        fi
        echo ""

        # Build remaining services (exclude Holo and Windows which are already started)
        REMAINING_SERVICES=()
        for service in "${STACK_SERVICES[@]}"; do
            if [[ "$service" != "bytebot-holo" ]] && [[ "$service" != "$DESKTOP_SERVICE" ]]; then
                REMAINING_SERVICES+=("$service")
            fi
        done

        echo -e "${BLUE}Building remaining services (parallelized with Windows installation)...${NC}"
        docker compose -f $COMPOSE_FILE build --no-cache "${REMAINING_SERVICES[@]}"
        echo ""
    else
        echo -e "${BLUE}Building all services with --no-cache (truly fresh, may take longer)...${NC}"
        docker compose -f $COMPOSE_FILE build --no-cache
        echo ""
    fi

    echo -e "${BLUE}Starting services...${NC}"
    # If Windows stack, Holo and Windows are already running - start only remaining services
    if [[ "$TARGET_OS" == "windows" ]]; then
        docker compose -f $COMPOSE_FILE up -d --no-deps "${REMAINING_SERVICES[@]}"
    else
        # Linux/macOS: Start Holo first, wait for health, then start remaining services
        echo -e "${BLUE}Starting Holo 1.5-7B first...${NC}"
        docker compose -f $COMPOSE_FILE up -d --build bytebot-holo

        # Wait for Holo health (up to 8 minutes for model download)
        echo ""
        wait_for_container_health "bytebot-holo" 480 5 || {
            echo -e "${YELLOW}Warning: Holo health check timed out, continuing anyway${NC}"
        }
        echo ""

        # Start remaining services (excluding Holo which is already running)
        echo -e "${BLUE}Starting remaining services...${NC}"
        docker compose -f $COMPOSE_FILE up -d --build --no-deps "${STACK_SERVICES[@]}"
    fi
fi

cd ..

# Wait for services with comprehensive health checks
echo ""
echo -e "${BLUE}Waiting for services to start...${NC}"

all_healthy=true

# Core services - wait with timeout for port availability
if ! wait_for_port "UI" 9992 "localhost" 120 3; then
    all_healthy=false
fi

if ! wait_for_port "Agent" 9991 "localhost" 120 3; then
    all_healthy=false
fi

if ! wait_for_port "Desktop" 9990 "localhost" 120 3; then
    all_healthy=false
fi

# Holo - check HTTP health endpoint (only if container exists)
if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-holo" 2>/dev/null; then
    if ! wait_for_http "http://localhost:9989/health" "Holo 1.5-7B health" 60 3; then
        all_healthy=false
    fi
fi

# Agent container health check (if available)
if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-agent" 2>/dev/null; then
    if ! wait_for_container_health "bytebot-agent" 60 3; then
        all_healthy=false
    fi
fi

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
if [[ "$TARGET_OS" == "windows" ]]; then
    echo "  • Windows:   http://localhost:8006 (web viewer)"
    echo "               rdp://localhost:3389 (RDP)"
    echo "               http://localhost:9990 (bytebotd - after setup)"
elif [[ "$TARGET_OS" == "macos" ]]; then
    echo "  • macOS:     http://localhost:8006 (web viewer)"
    echo "               vnc://localhost:5900 (VNC)"
    echo "               http://localhost:9990 (bytebotd - after setup)"
else
    echo "  • Desktop:   http://localhost:9990"
fi
if [[ "$ARCH" == "arm64" ]] && [[ "$PLATFORM" == "macOS" ]]; then
    echo "  • Holo 1.5-7B: http://localhost:9989 (native with MPS GPU)"
else
    echo "  • Holo 1.5-7B: http://localhost:9989 (Docker, CUDA if available)"
fi

echo ""
echo -e "${BLUE}Platform Info:${NC}"
echo "  • Detected: $PLATFORM ($ARCH)"
echo "  • Docker:   x86_64 (linux/amd64) via docker-compose.override.yml"

echo ""
echo "View logs:"
echo -e "  ${BLUE}docker compose -f docker/$COMPOSE_FILE logs -f${NC}"
echo ""
echo "Test Holo 1.5-7B:"
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
